// City Dioramas: London, Paris and Moscow. See src/models/city/CityKit.js for how a city is put
// together. Each of the three was built round one idea about why a city has the shape it has: London
// grew from a river crossing and never had a plan, Paris was cut open by one, and Moscow grew outward
// from a fortress in rings. Everything is placed from a real latitude and longitude, north at the
// back; heights and the landmarks' own footprints are enlarged, and each card says so.

import * as THREE from 'three';
import { City, bank, addBoat, TAU, LAND_Y } from '../city/CityKit.js';
import { lathe } from '../ModelKit.js';

const gauss = (x, z, cx, cz, r) => Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (r * r)));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const closed = (list) => [...list, list[0]];

// ---------------------------------------------------------------------------------------------
// Paris
// ---------------------------------------------------------------------------------------------
function eiffel(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.72 }).reserve(1.3, 1.3);
  const iron = 0x7c6a58; const deck = 0x5e5145;
  // The curve is the whole tower: each leg's reach falls away exponentially as the load gathers.
  const reach = (y) => 0.82 * Math.exp(-0.74 * y) + 0.02;
  const LEVELS = [0, 0.86, 1.74, 4.2, 5];
  const N = 22;
  const yAt = (i) => (i / N) * 4.92;
  for (let q = 0; q < 4; q += 1) {
    const sx = q < 2 ? 1 : -1; const sz = q % 2 ? 1 : -1;
    for (let i = 0; i < N; i += 1) {
      const y0 = yAt(i); const y1 = yAt(i + 1);
      const r0 = reach(y0); const r1 = reach(y1);
      // Each leg is its own square column low down, closing into one above the second deck.
      const w0 = 0.15 * Math.exp(-0.55 * y0) * Math.min(1, r0 / 0.25) + 0.005;
      const w1 = 0.15 * Math.exp(-0.55 * y1) * Math.min(1, r1 / 0.25) + 0.005;
      for (const [ox, oz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        f.bar([sx * (r0 - 0.5 * w0) + ox * w0 * 0.5, y0, sz * (r0 - 0.5 * w0) + oz * w0 * 0.5], [sx * (r1 - 0.5 * w1) + ox * w1 * 0.5, y1, sz * (r1 - 0.5 * w1) + oz * w1 * 0.5], 0.008 + 0.012 * (1 - i / N), iron, 3);
      }
      // The lattice: crossed braces on the two outer faces of each leg.
      if (i % 2 === 0) {
        for (const face of [0, 1]) {
          const a = face ? [sx * (r0 - w0), y0, sz * r0] : [sx * r0, y0, sz * (r0 - w0)];
          const b = face ? [sx * r1, y1, sz * r1] : [sx * r1, y1, sz * r1];
          const e = face ? [sx * r0, y0, sz * r0] : [sx * r0, y0, sz * r0];
          const g = face ? [sx * (r1 - w1), y1, sz * r1] : [sx * r1, y1, sz * (r1 - w1)];
          f.bar(a, b, 0.0055, iron, 3);
          f.bar(e, g, 0.0055, iron, 3);
        }
      }
    }
  }
  // The arches under the first deck carry nothing. They were added because the tower looked wrong
  // without them, and they are a large part of what people recognise.
  for (let side = 0; side < 4; side += 1) {
    const yaw = (side * Math.PI) / 2; const S = Math.sin(yaw); const C = Math.cos(yaw);
    const r = reach(0.5);
    let prev = null;
    for (let i = 0; i <= 12; i += 1) {
      const a = (i / 12) * Math.PI;
      const lx = Math.cos(a) * r * 0.86; const y = 0.32 + Math.sin(a) * 0.46;
      const here = [lx * C + r * 1.03 * S, y, -lx * S + r * 1.03 * C];
      if (prev) f.bar(prev, here, 0.012, iron, 3);
      prev = here;
    }
  }
  for (let i = 1; i <= 3; i += 1) {
    const y = LEVELS[i]; const r = reach(y) + (i === 3 ? 0.03 : 0.05);
    const h = i === 1 ? 0.08 : i === 2 ? 0.06 : 0.04;
    f.box(0, y - h / 2, 0, r * 2, h, r * 2, deck);
    if (i < 3) f.box(0, y + h / 2, 0, r * 1.6, 0.03, r * 1.6, iron);
  }
  f.cyl(0, 4.9, 0, 0.018, 0.04, 0.12, iron, 8);
  f.cyl(0, 5.02, 0, 0.004, 0.012, 0.36, 0xa6a099, 5);
  return f;
}

function arcDeTriomphe(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.5 }).reserve(0.8, 0.5, 0.02);
  const stone = 0xc9bea6; const shade = 0xa89d86;
  const W = 0.68; const D = 0.34; const H = 0.74;
  // A real hole, not a dark panel: two piers and a lintel, so a student can look through it.
  const pier = 0.2;
  for (const side of [-1, 1]) f.box(side * (W - pier) / 2, 0, 0, pier, H * 0.68, D, stone);
  f.box(0, H * 0.68, 0, W, H * 0.32, D, stone);
  f.box(0, H * 0.965, 0, W * 1.03, 0.03, D * 1.03, shade);
  f.box(0, H * 0.74, 0, W * 1.02, 0.018, D * 1.02, shade);
  // The arch's own curve, stepped under the lintel from each pier.
  const open = W - 2 * pier;
  for (let i = 1; i <= 4; i += 1) {
    const inset = (open / 2) * (1 - Math.cos((i / 5) * (Math.PI / 2)));
    const drop = (H * 0.2) * (1 - Math.sin((i / 5) * (Math.PI / 2)));
    for (const side of [-1, 1]) f.box(side * (open / 2 - inset / 2), H * 0.68 - drop - 0.01, 0, inset, drop + 0.012, D * 0.98, stone);
  }
  // Sculpture panels on the piers.
  for (const side of [-1, 1]) for (const face of [-1, 1]) f.box(side * (W - pier) / 2, H * 0.18, face * (D / 2 + 0.003), pier * 0.62, H * 0.3, 0.006, shade);
  f.box(0, H, 0, W * 0.92, 0.025, D * 0.92, stone);
}

function louvre(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw });
  f.reserve(2.2, 1.1, 0.02);
  const stone = 0xcabf9f; const zinc = 0x66707a;
  const wing = (lx, lz, w, d) => {
    f.block(lx, 0, lz, w, 0.26, d, stone, { roof: zinc });
    f.block(lx, 0.26, lz, w, 0.09, d, zinc, { top: [w * 0.82, d * 0.72], windows: false, roof: zinc });
  };
  // The courtyard to the east, and two long wings running west along the river and along Rivoli.
  wing(0.82, -0.32, 0.56, 0.14);
  wing(0.82, 0.32, 0.56, 0.14);
  wing(1.03, 0, 0.14, 0.52);
  wing(0.6, 0, 0.14, 0.5);
  wing(-0.18, -0.42, 1.5, 0.16);
  wing(-0.18, 0.42, 1.5, 0.16);
  for (const lz of [-0.42, 0.42]) f.block(0.2, 0.26, lz, 0.2, 0.16, 0.2, zinc, { top: [0.08, 0.1], windows: false });
  // The glass pyramid in the open end. Pei's, in 1989, and small because it really is.
  const glass = [[-0.11, -0.11], [0.11, -0.11], [0.11, 0.11], [-0.11, 0.11]];
  f.outline(glass, 0, 0.2, 0x9cc7dc, { top: [[-0.002, -0.002], [0.002, -0.002], [0.002, 0.002], [-0.002, 0.002]], windows: false });
}

function notreDame(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.2 }).reserve(0.5, 1.1, 0.02);
  const stone = 0xc2b79d; const roof = 0x4e5a64; const dark = 0x4a4438; const blue = 0x3f5f88;
  // West front towards +Z: the two square towers face the plaza and the apse the island's end.
  f.block(0, 0, -0.08, 0.26, 0.3, 0.86, stone, { roof, windows: false });
  f.gable(0, 0.3, -0.08, 0.28, 0.88, 0.14, roof, stone);
  f.block(0, 0, -0.1, 0.5, 0.26, 0.17, stone, { roof, windows: false });
  f.gable(0, 0.26, -0.1, 0.52, 0.18, 0.12, roof, stone, Math.PI / 2);
  f.cyl(0, 0, -0.52, 0.12, 0.14, 0.3, stone, 10);
  f.cone(0, 0.3, -0.52, 0.125, 0.14, roof, 10);
  // Tall windows down the flanks: a gothic wall is nearly all glass, and that is what the arms hold up.
  for (const side of [-1, 1]) {
    for (const lz of [-0.38, -0.26, -0.14, 0.02, 0.14, 0.26]) f.box(side * 0.132, 0.1, lz, 0.004, 0.16, 0.05, dark);
    f.block(side * 0.1, 0, 0.42, 0.14, 0.62, 0.14, stone, { roof: 0x8a7f6a, windows: false });
    // The towers' tall louvres, on the three faces a student can see.
    f.box(side * 0.1, 0.38, 0.491, 0.09, 0.18, 0.004, dark);
    f.box(side * 0.171, 0.38, 0.42, 0.004, 0.18, 0.09, dark);
    // Flying buttresses: the arms that hold the walls up, and the reason the walls can be windows.
    for (const lz of [-0.32, -0.2, -0.08, 0.04, 0.16]) {
      f.box(side * 0.22, 0, lz, 0.05, 0.16, 0.05, stone);
      f.bar([side * 0.22, 0.16, lz], [side * 0.12, 0.27, lz], 0.009, stone, 3);
    }
  }
  // The west front between the towers, with its three doors and the rose window.
  f.box(0, 0, 0.42, 0.06, 0.62, 0.14, stone);
  f.box(0, 0.42, 0.42, 0.34, 0.09, 0.145, stone);
  for (const ox of [-0.1, 0, 0.1]) f.box(ox, 0, 0.494, 0.06, 0.11, 0.005, dark);
  f.bar([0, 0.3, 0.49], [0, 0.3, 0.5], 0.042, blue, 12);
  // The spire over the crossing, thin, as the rebuilt one is.
  f.cone(0, 0.4, -0.1, 0.022, 0.46, roof, 6);
}

function sacreCoeur(c, x, z) {
  const f = c.frame(x, z, { yaw: 0, s: 1.25 });
  c.reserveCircle(x, z, 1.05);
  // Montmartre: the only real hill on the plan.
  f.lathe(0, 0, 0, [[0, 0], [0.82, 0], [0.72, 0.1], [0.5, 0.3], [0.34, 0.45], [0, 0.48]], 0x8aa167, 18);
  const white = 0xf0ebdc;
  f.box(0, 0.46, 0.14, 0.34, 0.1, 0.16, white);
  f.block(0, 0.46, -0.08, 0.36, 0.24, 0.4, white, { windows: false });
  f.cyl(0, 0.7, -0.08, 0.1, 0.11, 0.18, white, 12);
  f.dome(0, 0.88, -0.08, 0.11, 0.2, white, 14, 0.3);
  f.cone(0, 1.08, -0.08, 0.018, 0.09, white, 6);
  for (const [ox, oz] of [[-0.17, 0.08], [0.17, 0.08], [-0.17, -0.24], [0.17, -0.24]]) {
    f.cyl(ox, 0.7, oz, 0.04, 0.045, 0.1, white, 8);
    f.dome(ox, 0.8, oz, 0.045, 0.09, white, 8, 0.3);
  }
  f.block(0, 0.46, -0.36, 0.1, 0.42, 0.1, white, { windows: false });
  f.dome(0, 0.88, -0.36, 0.055, 0.08, white, 8);
}

function invalides(c, x, z) {
  const f = c.frame(x, z, { yaw: 0, s: 1.3 }).reserve(0.9, 1.0, 0.02);
  const stone = 0xc8bda0; const zinc = 0x5e6a74; const gold = 0xe2b23c;
  f.block(0, 0, 0.1, 0.84, 0.2, 0.62, stone, { roof: zinc });
  f.block(0, 0, -0.32, 0.36, 0.26, 0.3, stone, { roof: zinc });
  f.cyl(0, 0.26, -0.32, 0.14, 0.15, 0.16, stone, 14);
  f.dome(0, 0.42, -0.32, 0.14, 0.25, gold, 16);
  f.cyl(0, 0.67, -0.32, 0.024, 0.03, 0.06, stone, 6);
  f.cone(0, 0.73, -0.32, 0.018, 0.12, gold, 6);
}

function pantheon(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.05, s: 1.3 }).reserve(0.52, 0.72, 0.02);
  const stone = 0xd3c9af;
  f.block(0, 0, 0, 0.3, 0.22, 0.62, stone, { windows: false, roof: 0x8e8671 });
  f.block(0, 0, 0, 0.5, 0.22, 0.26, stone, { windows: false, roof: 0x8e8671 });
  f.cyl(0, 0.22, 0, 0.11, 0.12, 0.17, stone, 14);
  f.dome(0, 0.39, 0, 0.11, 0.16, 0x7f8a90, 14);
  f.cyl(0, 0.55, 0, 0.02, 0.022, 0.05, stone, 6);
  f.gable(0, 0.22, 0.28, 0.3, 0.1, 0.07, stone, stone);
}

function montparnasse(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.35 }).reserve(0.5, 0.34, 0.02);
  f.block(0, 0, 0, 0.46, 2.3, 0.28, 0x7a8590, { roof: 0x4f5760 });
}

function opera(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.3 }).reserve(0.46, 0.68, 0.02);
  const stone = 0xc8b98e; const green = 0x6c9c86; const gold = 0xe2b23c;
  f.block(0, 0, 0, 0.42, 0.24, 0.64, stone, { roof: green });
  f.block(0, 0.24, -0.04, 0.34, 0.13, 0.2, stone, { roof: green });
  f.dome(0, 0.24, 0.16, 0.13, 0.13, green, 12);
  for (const side of [-1, 1]) f.ball(side * 0.17, 0.39, -0.04, 0.018, gold, 6);
}

export function paris() {
  const c = new City({
    w: 16, d: 14.6, lat: 48.8635, lon: 2.33, km: 0.41, seed: 1853,
    landColor: '#a3a096', waterColor: '#467f98', waterDeep: '#3c7189',
    tile: { feet: [0.24, 0.09], cols: 6, rows: 2, lit: 0.06, winW: 0.42, winH: 0.68, win: '#4a5560', wall: '#f6f2e6', band: 0.3 },
    title: 'PARIS',
    subtitle: 'North is at the back.  Map scale: 1 foot = about a quarter of a mile.  Landmarks are much bigger than the map scale.',
  });
  const P = (la, lo) => c.at(la, lo);

  // --- The Seine: in from the south-east, a long arc to the north, out to the south-west.
  const seine = c.geo([[48.8340, 2.3830], [48.8380, 2.3780], [48.8405, 2.3720], [48.8428, 2.3647], [48.8497, 2.3590], [48.8530, 2.3510], [48.8552, 2.3455], [48.8568, 2.3412], [48.8583, 2.3375], [48.8600, 2.3295], [48.8635, 2.3197], [48.8640, 2.3135], [48.8636, 2.3012], [48.8600, 2.2928], [48.8558, 2.2875], [48.8497, 2.2815], [48.8440, 2.2760]], 6);
  const widthAt = (t) => 0.52 + 0.62 * Math.exp(-(((t - 0.36) / 0.15) ** 2));
  const north = bank(seine, widthAt, 1);
  const south = bank(seine, widthAt, -1);
  c.land([...north, [-8.1, -8.1], [8.1, -8.1]]);
  c.land([...south, [-8.1, 8.1], [8.1, 8.1]]);
  c.land(c.geo([[48.8580, 2.3392], [48.8578, 2.3425], [48.8572, 2.3470], [48.8552, 2.3512], [48.8516, 2.3532], [48.8520, 2.3480], [48.8536, 2.3440], [48.8560, 2.3402]], 4));
  c.land(c.geo([[48.8528, 2.3545], [48.8528, 2.3580], [48.8508, 2.3620], [48.8497, 2.3610], [48.8510, 2.3560]], 4));

  // --- Parks and open squares.
  const champ = c.geo([[48.8550, 2.3005], [48.8522, 2.3082], [48.8492, 2.3050], [48.8520, 2.2972]]);
  c.park(champ, { trees: 26, treeH: 0.22, color: '#80ab5c', paths: [c.geo([[48.8535, 2.2990], [48.8507, 2.3066]])] });
  const tuileries = c.geo([[48.8660, 2.3235], [48.8655, 2.3315], [48.8625, 2.3300], [48.8635, 2.3225]]);
  c.park(tuileries, { trees: 24, treeH: 0.21, color: '#92b268', paths: [c.geo([[48.8650, 2.3232], [48.8640, 2.3308]])] });
  const lux = c.geo([[48.8488, 2.3320], [48.8488, 2.3395], [48.8430, 2.3385], [48.8430, 2.3345], [48.8455, 2.3322]]);
  c.park(lux, { trees: 28, treeH: 0.23, color: '#7da858' });
  const monceau = c.geo([[48.8805, 2.3055], [48.8810, 2.3115], [48.8780, 2.3115], [48.8780, 2.3060]]);
  c.park(monceau, { trees: 18, treeH: 0.22, color: '#7da858' });
  const plantes = c.geo([[48.8445, 2.3560], [48.8465, 2.3625], [48.8420, 2.3650], [48.8395, 2.3590]]);
  c.park(plantes, { trees: 22, treeH: 0.22, color: '#7da858' });
  c.park(c.geo([[48.8640, 2.2860], [48.8650, 2.2935], [48.8615, 2.2935], [48.8605, 2.2880]]), { trees: 14, treeH: 0.22, color: '#7da858' });
  c.park(c.geo([[48.8582, 2.3090], [48.8582, 2.3130], [48.8620, 2.3130], [48.8620, 2.3090]]), { trees: 0, color: '#86ad60' });
  const [lucX, lucZ] = P(48.8467, 2.3370);
  c.paintOver((ctx) => { ctx.fillStyle = '#4a93ba'; ctx.beginPath(); ctx.ellipse(lucX, lucZ, 0.13, 0.09, 0, 0, TAU); ctx.fill(); });

  // --- The Etoile: twelve avenues from one circle.
  const [arcX, arcZ] = P(48.8738, 2.2950);
  const STAR = 12;
  const circle = [];
  for (let i = 0; i < 28; i += 1) circle.push([arcX + Math.cos((i / 28) * TAU) * 0.62, arcZ + Math.sin((i / 28) * TAU) * 0.62]);
  c.plaza(circle, '#b9b3a4');
  const champsEnd = P(48.8656, 2.3212);
  const champsYaw = Math.atan2(champsEnd[1] - arcZ, champsEnd[0] - arcX);
  for (let i = 0; i < STAR; i += 1) {
    const a = champsYaw + (i / STAR) * TAU;
    const end = [arcX + Math.cos(a) * 5.4, arcZ + Math.sin(a) * 5.4];
    if (i === 0) continue;
    c.road([[arcX + Math.cos(a) * 0.55, arcZ + Math.sin(a) * 0.55], end], 0.1, { color: '#b3ad9e', edge: '#8a867b' });
    c.avenueTrees([[arcX + Math.cos(a) * 1.0, arcZ + Math.sin(a) * 1.0], [arcX + Math.cos(a) * 2.8, arcZ + Math.sin(a) * 2.8]], 0.34, 0.12, 0.08);
  }
  // The great axis. A straight line laid across the city for kings and then kept by every government
  // after them, from the Louvre through the Tuileries, the Concorde and the Champs-Elysees to the Arc.
  const champs = [[arcX, arcZ], champsEnd];
  c.road(champs, 0.2, { color: '#c6bfae', edge: '#8a867b' });
  c.avenueTrees(champs, 0.24, 0.14, 0.13);
  const [conX, conZ] = P(48.8656, 2.3212);
  c.reserveCircle(conX, conZ, 0.42);
  c.plaza(circleOf(conX, conZ, 0.4), '#c9c3b2');
  const obelisk = c.frame(conX, conZ);
  obelisk.block(0, 0, 0, 0.05, 0.42, 0.05, 0xd6b98a, { top: [0.024, 0.024], windows: false });
  obelisk.cone(0, 0.42, 0, 0.02, 0.05, 0xe2b23c, 4);

  // --- Haussmann's cuts: straight, wide and planted, driven through the medieval city in the 1850s
  // and 60s. These are the lesson, so they are drawn wider than life.
  const boulevards = [
    [[48.8538, 2.3695], [48.8560, 2.3520], [48.8600, 2.3370], [48.8655, 2.3275], [48.8692, 2.3215]], // Rivoli
    [[48.8730, 2.3300], [48.8716, 2.3200], [48.8745, 2.3100], [48.8760, 2.3010], [48.8775, 2.2960]], // Haussmann
    [[48.8665, 2.3625], [48.8690, 2.3440], [48.8700, 2.3360], [48.8712, 2.3320], [48.8690, 2.3250], [48.8692, 2.3215]], // the Grands Boulevards
    [[48.8390, 2.3360], [48.8440, 2.3400], [48.8530, 2.3442], [48.8580, 2.3480], [48.8660, 2.3515], [48.8755, 2.3585], [48.8840, 2.3600]], // Saint-Michel, Sebastopol, Strasbourg
    [[48.8505, 2.3565], [48.8500, 2.3480], [48.8530, 2.3380], [48.8535, 2.3280], [48.8590, 2.3180]], // Saint-Germain
    [[48.8712, 2.3320], [48.8660, 2.3350], [48.8630, 2.3355]], // Avenue de l'Opera
    [[48.8538, 2.3695], [48.8660, 2.3625], [48.8700, 2.3640], [48.8830, 2.3640]], // from the Bastille north
    [[48.8421, 2.3220], [48.8450, 2.3100], [48.8510, 2.3045], [48.8560, 2.3070]],
    [[48.8421, 2.3220], [48.8450, 2.3370], [48.8380, 2.3530], [48.8400, 2.3700]], // Montparnasse, Port-Royal
  ];
  for (const b of boulevards) {
    const path = c.geo(b, 4);
    c.road(path, 0.11, { color: '#b9b3a4', edge: '#8a867b' });
    c.avenueTrees(path, 0.36, 0.11, 0.07);
  }

  // --- Landmarks.
  const [efX, efZ] = P(48.8562, 2.2985); eiffel(c, efX, efZ);
  arcDeTriomphe(c, arcX, arcZ, Math.atan2(champsEnd[0] - arcX, champsEnd[1] - arcZ));
  const [lvX, lvZ] = P(48.8612, 2.3360);
  louvre(c, lvX, lvZ, -0.28);
  const [ndX, ndZ] = P(48.8530, 2.3499);
  notreDame(c, ndX, ndZ, -2.02);
  const [scX, scZ] = P(48.8867, 2.3431); sacreCoeur(c, scX, scZ);
  const [inX, inZ] = P(48.8550, 2.3125); invalides(c, inX, inZ);
  const [phX, phZ] = P(48.8462, 2.3464); pantheon(c, phX, phZ);
  const [mnX, mnZ] = P(48.8421, 2.3220); montparnasse(c, mnX, mnZ);
  const [opX, opZ] = P(48.8720, 2.3316); opera(c, opX, opZ, -0.42);

  // --- The city itself: the same few floors and the same grey roof, over and over, on purpose.
  const stones = [0xcfc4a8, 0xd6ccb2, 0xc6bb9f, 0xd2c7a4, 0xbfb59c];
  const zinc = [0x7f8b95, 0x8a96a0, 0x75818b];
  c.fill({
    yaw: 0.42, lot: [0.28, 0.22], every: [3, 2], street: [0.06, 0.06], warp: 0.32, warpF: 0.5, turn: 0.55, seed: 31, skip: 0.01,
    h: (x, z, rng) => 0.23 + rng() * 0.05,
    color: (x, z, rng) => pick(rng, stones),
    style: () => 'mansard',
    roof: (x, z, rng) => pick(rng, zinc),
  });

  // --- Bridges, boats, words.
  const crossings = [
    [[48.8590, 2.2860], [48.8530, 2.2895]], [[48.8628, 2.2885], [48.8572, 2.2965]], [[48.8660, 2.3012], [48.8612, 2.3012]],
    [[48.8660, 2.3135], [48.8618, 2.3135]], [[48.8655, 2.3197], [48.8615, 2.3197]], [[48.8625, 2.3295], [48.8580, 2.3295]],
    [[48.8612, 2.3375], [48.8562, 2.3375]], [[48.8590, 2.3412], [48.8570, 2.3415]], [[48.8556, 2.3412], [48.8535, 2.3405]],
    [[48.8560, 2.3480], [48.8540, 2.3490]], [[48.8530, 2.3475], [48.8500, 2.3470]], [[48.8525, 2.3590], [48.8507, 2.3605]],
    [[48.8470, 2.3660], [48.8440, 2.3600]],
  ];
  for (const [a, b] of crossings) c.bridge(P(...a), P(...b), { width: 0.11, piers: 2, rise: 0.03, color: 0xb3a98f, deck: 0x8a867b });
  // A bateau-mouche working the great curve, as they have since the 1950s.
  c.mover((f) => addBoat(f, 0.5, 0xe9e3d2, 0x3a5a78), c.geo([[48.8640, 2.3080], [48.8628, 2.3190], [48.8598, 2.3295], [48.8578, 2.3380]], 5), { speed: 0.2 });
  c.boat(...P(48.8605, 2.2950), 2.2, 0.4, 0xe9e3d2, 0x8d3b2c);
  c.waterText_('LA SEINE', c.geo([[48.8580, 2.3060], [48.8615, 2.3220]].reverse()), 0.2);
  c.label('Eiffel Tower', efX + 0.72, efZ + 0.62, 0.95);
  c.label('Arc de Triomphe', arcX + 0.1, arcZ + 0.72, 1.2);
  c.label('Champs-Elysees', ...P(48.8672, 2.3120), 0.5);
  c.label('The Louvre', lvX, lvZ + 0.68, 0.62);
  c.label('Notre-Dame', ndX + 0.25, ndZ + 0.58, 1.05);
  c.label('Sacre-Coeur', scX, scZ + 0.82, 1.55);
  c.label('Les Invalides', inX - 0.1, inZ + 0.72, 1.12);
  c.label('Pantheon', phX, phZ + 0.56, 0.86);
  c.label('Montparnasse Tower', mnX, mnZ + 0.28, 1.1);
  c.label('Opera Garnier', opX, opZ + 0.58, 0.6);
  c.label('Luxembourg Gardens', ...P(48.8445, 2.3360), 0.42);
  return c.finish();
}

function circleOf(x, z, r, n = 24) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push([x + Math.cos((i / n) * TAU) * r, z + Math.sin((i / n) * TAU) * r]);
  return out;
}

// ---------------------------------------------------------------------------------------------
// London
// ---------------------------------------------------------------------------------------------
function westminster(c, x, z, yaw, s = 1) {
  // The palace runs north to south along the river with the clock tower at the north end.
  const f = c.frame(x, z, { yaw, s }).reserve(0.5, 1.5, 0.02);
  const stone = 0xc2ad7d; const roof = 0x5a6a72; const gold = 0xd9b04a;
  f.block(0, 0, 0, 0.36, 0.22, 1.36, stone, { roof, windows: false });
  for (let i = 0; i < 12; i += 1) f.box(0.181, 0.05, -0.62 + i * 0.113, 0.004, 0.12, 0.05, 0x5a4c34);
  for (let i = 0; i < 12; i += 1) f.box(-0.181, 0.05, -0.62 + i * 0.113, 0.004, 0.12, 0.05, 0x5a4c34);
  f.gable(0, 0.22, 0, 0.26, 1.2, 0.08, roof, stone);
  // Crowded skyline: many small pinnacles, which is what the eye takes for gothic.
  for (let i = 0; i < 9; i += 1) {
    const lz = -0.6 + i * 0.15;
    for (const side of [-1, 1]) f.cone(side * 0.17, 0.22, lz, 0.016, 0.1, stone, 4);
  }
  f.block(0, 0.22, 0, 0.12, 0.3, 0.12, stone, { windows: false });
  f.cone(0, 0.52, 0, 0.075, 0.2, roof, 8);
  // The Victoria Tower, square and enormous, at the south end.
  f.block(0, 0, 0.72, 0.26, 0.94, 0.26, stone, { windows: false });
  for (const [ox, oz, w, d] of [[0, 0.132, 0.1, 0.004], [0, -0.132, 0.1, 0.004], [0.132, 0, 0.004, 0.1], [-0.132, 0, 0.004, 0.1]]) f.box(ox, 0.4, 0.72 + oz, w, 0.42, d, 0x5a4c34);
  for (const [ox, oz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) f.cone(ox * 0.12, 0.94, 0.72 + oz * 0.12, 0.025, 0.1, gold, 4);
  // The Elizabeth Tower, holding Big Ben, at the north end.
  const T = c.frame(...worldOf(f, -0.1, -0.74), { yaw, s }).reserve(0.24, 0.24, 0.01);
  T.block(0, 0, 0, 0.2, 1.42, 0.2, stone, { windows: false, roof });
  T.block(0, 1.42, 0, 0.225, 0.24, 0.225, stone, { windows: false, roof });
  T.block(0, 1.66, 0, 0.225, 0.09, 0.225, gold, { windows: false, top: [0.17, 0.17] });
  T.block(0, 1.75, 0, 0.17, 0.26, 0.17, roof, { windows: false, top: [0.03, 0.03] });
  T.cone(0, 2.01, 0, 0.022, 0.14, gold, 5);
}

const worldOf = (f, lx, lz) => { const p = f.p(lx, 0, lz); return [p[0], p[2]]; };

function clockFace(c, frame, y, r) {
  // Four white discs, each proud of its own face of the tower, with two dark hands.
  const white = 0xf4eeda; const dark = 0x25211c;
  const W = 0.1135;
  for (const [ox, oz, a] of [[0, W, 0], [0, -W, Math.PI], [W, 0, Math.PI / 2], [-W, 0, -Math.PI / 2]]) {
    const q = c.frame(...worldOf(frame, ox, oz), { yaw: frame.yaw + a, s: frame.s });
    q.bar([0, y, -0.008], [0, y, 0.008], r, white, 12);
    q.bar([0, y, 0.008], [0, y + r * 0.8, 0.012], 0.006, dark, 3);
    q.bar([0, y, 0.008], [r * 0.5, y + r * 0.2, 0.012], 0.007, dark, 3);
  }
}

function stPauls(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.4 }).reserve(0.74, 1.3, 0.02);
  const stone = 0xc9c4b4; const lead = 0x6f7c84; const gold = 0xdcb44c;
  // A cross in plan. The west front faces the top of Ludgate Hill.
  f.block(0, 0, 0, 0.3, 0.26, 1.2, stone, { roof: lead, windows: false });
  f.block(0, 0, -0.08, 0.72, 0.26, 0.28, stone, { roof: lead, windows: false });
  for (const side of [-1, 1]) {
    f.block(side * 0.1, 0.26, 0.5, 0.1, 0.16, 0.1, stone, { windows: false, roof: lead });
    f.cone(side * 0.1, 0.42, 0.5, 0.05, 0.1, lead, 8);
  }
  // The dome: a drum with a ring of columns, then the great lead dome, then the lantern.
  f.cyl(0, 0.26, -0.08, 0.2, 0.22, 0.1, stone, 18);
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * TAU;
    f.cyl(Math.sin(a) * 0.19, 0.36, -0.08 + Math.cos(a) * 0.19, 0.008, 0.008, 0.12, stone, 4);
  }
  f.cyl(0, 0.36, -0.08, 0.165, 0.165, 0.12, 0x8b8678, 14);
  f.cyl(0, 0.48, -0.08, 0.19, 0.2, 0.05, stone, 18);
  f.dome(0, 0.53, -0.08, 0.175, 0.3, lead, 20);
  f.cyl(0, 0.82, -0.08, 0.026, 0.034, 0.1, stone, 8);
  f.cone(0, 0.92, -0.08, 0.02, 0.06, gold, 6);
  f.ball(0, 0.985, -0.08, 0.012, gold, 6);
}

function towerBridge(c, a, b) {
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const S = 1.45;
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const L = span / S;
  const f = c.frame(a[0], a[1], { yaw, s: S });
  const stone = 0xc0b49a; const blue = 0x5e9cc0; const cap = 0x6c7a80;
  const t0 = L * 0.36; const t1 = L * 0.64;
  // The deck. Shut, the two bascules read as one road, which is how it spends most of the day.
  c.road([a, b], 0.2, { color: '#5f7f90', edge: '#4d6877' });
  c.bridge(a, b, { width: 0.2, piers: 0, rise: 0.01, deck: 0x5f7f90, seg: 4 });
  for (const tz of [t0, t1]) {
    f.box(0, -0.1, tz, 0.3, 0.1, 0.34, stone);
    for (const side of [-1, 1]) {
      f.box(side * 0.1, 0, tz, 0.08, 0.72, 0.16, stone);
      for (const oz of [-1, 1]) {
        for (const ox of [-1, 1]) f.cone(side * 0.1 + ox * 0.03, 0.72, tz + oz * 0.07, 0.016, 0.12, cap, 4);
      }
    }
    f.box(0, 0.5, tz, 0.28, 0.08, 0.16, stone);
    f.box(0, 0.72, tz, 0.28, 0.06, 0.14, stone);
    f.gable(0, 0.78, tz, 0.26, 0.14, 0.15, cap, stone);
    f.cone(0, 0.92, tz, 0.012, 0.1, 0xd9b04a, 4);
  }
  // The high walkways, and the blue suspension chains falling from them to the shore.
  for (const side of [-1, 1]) f.box(side * 0.07, 0.6, (t0 + t1) / 2, 0.035, 0.05, t1 - t0, blue);
  const chain = (from, to, y0, y1) => {
    for (const side of [-1, 1]) {
      let prev = null;
      for (let i = 0; i <= 6; i += 1) {
        const u = i / 6;
        const here = [side * 0.1, y0 + (y1 - y0) * u ** 1.5, from + (to - from) * u];
        if (prev) f.bar(prev, here, 0.012, blue, 4);
        prev = here;
      }
    }
  };
  chain(t0, 0, 0.56, 0.04);
  chain(t1, L, 0.56, 0.04);
  for (const end of [0.02, L - 0.02]) f.box(0, 0, end, 0.16, 0.12, 0.05, stone);
}

function towerOfLondon(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.2 }).reserve(0.96, 0.96, 0.02);
  const stone = 0xb8ae98; const dark = 0x8d8472;
  // The moat, dry and grassed since the 1840s.
  c.park(circleSquare(x, z, 0.6, yaw), { trees: 0, color: '#86ad60' });
  for (const [ox, oz, w, d] of [[0, -0.38, 0.8, 0.05], [0, 0.38, 0.8, 0.05], [0.38, 0, 0.05, 0.8], [-0.38, 0, 0.05, 0.8]]) {
    f.box(ox, 0, oz, w, 0.14, d, stone);
  }
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]]) f.cyl(ox * 0.38, 0, oz * 0.38, 0.045, 0.05, 0.19, dark, 8);
  f.block(0, 0, 0.03, 0.34, 0.3, 0.28, 0xd8d0ba, { windows: false, roof: 0x8d8472 });
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    f.block(ox * 0.17, 0.3, 0.03 + oz * 0.14, 0.05, 0.11, 0.05, 0xd8d0ba, { windows: false, roof: 0x8d8472 });
    f.dome(ox * 0.17, 0.41, 0.03 + oz * 0.14, 0.032, 0.05, 0x6f7c84, 6);
  }
}

function circleSquare(x, z, half, yaw) {
  const C = Math.cos(yaw); const S = Math.sin(yaw);
  return [[-half, -half], [half, -half], [half, half], [-half, half]].map(([a, b]) => [x + C * a + S * b, z - S * a + C * b]);
}

function buckingham(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.25 }).reserve(1.0, 0.64, 0.02);
  const stone = 0xd2c9b2; const roof = 0x7a7f80;
  f.block(0, 0, 0.12, 0.96, 0.25, 0.14, stone, { roof });
  f.block(-0.4, 0, -0.1, 0.16, 0.22, 0.34, stone, { roof });
  f.block(0.4, 0, -0.1, 0.16, 0.22, 0.34, stone, { roof });
  f.block(0, 0, -0.28, 0.84, 0.22, 0.12, stone, { roof });
  f.box(0, 0.25, 0.2, 0.3, 0.04, 0.02, stone);
  // The memorial in the roundabout at the end of the Mall.
  const m = c.frame(...worldOf(f, 0, 0.55), { yaw, s: 1.25 });
  m.cyl(0, 0, 0, 0.12, 0.14, 0.04, 0xd8d3c3, 12);
  m.cyl(0, 0.04, 0, 0.022, 0.05, 0.24, 0xe2dccb, 8);
  m.ball(0, 0.3, 0, 0.022, 0xd9b04a, 6);
}

function shard(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.5 }).reserve(0.5, 0.5, 0.02);
  // Eight faces leaning in, and they never quite meet: the top is left open and broken.
  const ring = (r) => { const out = []; for (let i = 0; i < 8; i += 1) { const a = (i / 8) * TAU + 0.39; out.push([Math.sin(a) * r, Math.cos(a) * r]); } return out; };
  f.outline(ring(0.32), 0, 3.5, 0xa5c8df, { top: ring(0.024), windows: false });
}

function gherkin(c, x, z) {
  const f = c.frame(x, z).reserve(0.4, 0.4, 0.01);
  const H = 2.05;
  const prof = [[0, 0], [0.16, 0]];
  for (let i = 1; i <= 14; i += 1) {
    const t = i / 14;
    prof.push([Math.max(0.004, 0.16 * (1 + 0.32 * Math.sin(t * 2.6)) * Math.sqrt(Math.max(0, 1 - t ** 5.5))), t * H]);
  }
  prof.push([0, H]);
  // A rising spiral of dark glass, worked out vertex by vertex from where each point stands.
  const cx = f.x; const cz = f.z;
  const color = (px, py, pz) => {
    const a = Math.atan2(px - cx, pz - cz);
    const phase = (a * 6) / TAU + ((py - LAND_Y) / H) * 4.5;
    return phase - Math.floor(phase) < 0.5 ? [0.1, 0.24, 0.36] : [0.3, 0.52, 0.66];
  };
  c.b.add(lathe(prof, 30), color, { position: [x, LAND_Y, z] });
}

function londonEye(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(0.5, 0.5, 0.02);
  const R = 0.92;
  const steel = 0xd4d8dc;
  // The legs lean from the bank on one side only: it is really held up from one side.
  const hub = R + 0.1;
  f.bar([-0.3, 0, -0.2], [0, hub, 0], 0.02, steel, 4);
  f.bar([0.3, 0, -0.2], [0, hub, 0], 0.02, steel, 4);
  f.bar([0, 0, 0.32], [0, hub, 0], 0.012, 0x9aa0a6, 3);
  c.rotor((w) => {
    let prev = null;
    for (let i = 0; i <= 40; i += 1) {
      const a = (i / 40) * TAU;
      const here = [Math.cos(a) * R, Math.sin(a) * R, 0];
      if (prev) w.bar(prev, here, 0.016, steel, 4);
      prev = here;
    }
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * TAU;
      w.bar([0, 0, 0], [Math.cos(a) * R, Math.sin(a) * R, 0], 0.004, steel, 3);
    }
    for (let i = 0; i < 32; i += 1) {
      const a = (i / 32) * TAU;
      w.ball(Math.cos(a) * (R + 0.03), Math.sin(a) * (R + 0.03), 0, 0.03, 0xdce9ef, 6);
    }
    w.cyl(0, -0.012, 0, 0.03, 0.03, 0.024, steel, 8);
  }, { x, y: LAND_Y + hub, z, yaw, rate: 0.05 });
}

export function london() {
  const c = new City({
    w: 16, d: 11, lat: 51.5105, lon: -0.12, km: 0.5, seed: 1666,
    landColor: '#8f8b83', waterColor: '#4f7f8a', waterDeep: '#467482',
    tile: { feet: [0.26, 0.22], cols: 7, rows: 6, lit: 0.1, winW: 0.5, winH: 0.66 },
    title: 'LONDON',
    subtitle: 'North is at the back.  Map scale: 1 foot = about a third of a mile.  Landmarks are much bigger than the map scale.',
  });
  const P = (la, lo) => c.at(la, lo);
  const thames = c.geo([[51.4640, -0.2050], [51.4720, -0.1900], [51.4765, -0.1790], [51.4820, -0.1650], [51.4850, -0.1450], [51.4875, -0.1270], [51.4950, -0.1220], [51.5008, -0.1225], [51.5065, -0.1205], [51.5087, -0.1165], [51.5100, -0.1040], [51.5095, -0.0985], [51.5079, -0.0877], [51.5055, -0.0754], [51.5050, -0.0600], [51.5070, -0.0480]], 6);
  const north = bank(thames, 0.56, -1);
  const south = bank(thames, 0.56, 1);
  const northLand = c.land([...north, [8.1, -5.6], [-8.1, -5.6], [-8.1, 5.6]]);
  const southLand = c.land([...south, [8.1, 5.6]]);

  // --- The royal parks. Royal hunting grounds first, which is why they survived at all.
  const hyde = c.geo([[51.5125, -0.1860], [51.5105, -0.1590], [51.5030, -0.1520], [51.5015, -0.1860]]);
  c.park(hyde, { trees: 70, treeH: 0.24, color: '#7da858', paths: [c.geo([[51.5100, -0.1855], [51.5035, -0.1540]])] });
  const serp = c.geo([[51.5065, -0.1760], [51.5075, -0.1680], [51.5050, -0.1590], [51.5040, -0.1600], [51.5060, -0.1690], [51.5050, -0.1770]], 3);
  c.paintOver((ctx) => { ctx.fillStyle = '#4f93b0'; ctx.beginPath(); serp.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }); ctx.closePath(); ctx.fill(); });
  const regents = c.geo([[51.5350, -0.1620], [51.5365, -0.1500], [51.5265, -0.1470], [51.5235, -0.1520], [51.5240, -0.1620]]);
  c.park(regents, { trees: 40, treeH: 0.24, color: '#7da858' });
  c.park(c.geo([[51.5075, -0.1475], [51.5065, -0.1395], [51.5025, -0.1425], [51.5030, -0.1505]]), { trees: 22, treeH: 0.22, color: '#86ad60' });
  const stJames = c.geo([[51.5048, -0.1385], [51.5062, -0.1280], [51.5030, -0.1280], [51.5018, -0.1355]]);
  c.park(stJames, { trees: 24, treeH: 0.22, color: '#7da858' });
  const [sjX, sjZ] = P(51.5032, -0.1330);
  c.paintOver((ctx) => { ctx.fillStyle = '#4f93b0'; ctx.beginPath(); ctx.ellipse(sjX, sjZ, 0.42, 0.06, -0.1, 0, TAU); ctx.fill(); });
  c.park(c.geo([[51.4830, -0.1680], [51.4815, -0.1500], [51.4765, -0.1505], [51.4770, -0.1660]]), { trees: 24, treeH: 0.22, color: '#7da858' });

  // --- The Mall, red all the way to the palace.
  const mall = c.geo([[51.5060, -0.1285], [51.5030, -0.1395], [51.5018, -0.1412]]);
  c.road(mall, 0.09, { color: '#b24a3a', edge: '#7a3a2e' });
  const [trafX, trafZ] = P(51.5080, -0.1281);
  c.plaza(squareAt(trafX, trafZ, 0.17), '#c9c3b2');
  const nelson = c.frame(trafX, trafZ);
  nelson.block(0, 0, 0, 0.05, 0.08, 0.05, 0xc9c3b2, { windows: false });
  nelson.cyl(0, 0.08, 0, 0.012, 0.016, 0.56, 0xc9c3b2, 6);
  nelson.ball(0, 0.65, 0, 0.018, 0x5a5a56, 5);

  // --- The roads. Almost all of them follow a route older than the buildings on it.
  const main = [
    [[51.5165, -0.1930], [51.5135, -0.1650], [51.5150, -0.1430], [51.5165, -0.1300], [51.5180, -0.1200], [51.5170, -0.1050], [51.5158, -0.0930], [51.5150, -0.0800], [51.5160, -0.0550]], // Oxford St, Holborn, Cheapside, Cornhill
    [[51.5135, -0.1600], [51.5065, -0.1500], [51.5080, -0.1400], [51.5080, -0.1281]], // Piccadilly
    [[51.5080, -0.1281], [51.5115, -0.1180], [51.5140, -0.1060], [51.5135, -0.0980], [51.5130, -0.0880], [51.5125, -0.0810], [51.5125, -0.0660], [51.5120, -0.0520]], // Strand, Fleet Street
    [[51.5080, -0.1281], [51.5030, -0.1265], [51.4998, -0.1270]], // Whitehall
    [[51.4998, -0.1270], [51.4965, -0.1360], [51.4930, -0.1450], [51.4900, -0.1600], [51.4870, -0.1820], [51.4870, -0.1950]], // Victoria St, King's Road
    [[51.5240, -0.1900], [51.5250, -0.1600], [51.5260, -0.1300], [51.5300, -0.1230], [51.5305, -0.1050], [51.5240, -0.0880], [51.5210, -0.0780], [51.5150, -0.0720]], // Euston Road
    [[51.5150, -0.1430], [51.5100, -0.1340], [51.5080, -0.1281]], // Regent Street
    [[51.5115, -0.1180], [51.5180, -0.1200], [51.5260, -0.1240]], // Kingsway
    [[51.5005, -0.1160], [51.5030, -0.1120], [51.5025, -0.1030], [51.5000, -0.0950], [51.4950, -0.1000], [51.4890, -0.1000], [51.4800, -0.1000], [51.4720, -0.1030]], // Waterloo, Elephant and on south
    [[51.5068, -0.0880], [51.5020, -0.0920], [51.4950, -0.1000]], // Borough High St
    [[51.5280, -0.0800], [51.5210, -0.0780], [51.5150, -0.0800], [51.5090, -0.0875]], // Bishopsgate, to London Bridge: the old Roman road north
    [[51.4950, -0.1000], [51.4900, -0.0850], [51.4800, -0.0700]],
    [[51.5005, -0.1160], [51.4950, -0.1160], [51.4880, -0.1150], [51.4780, -0.1230]],
  ];
  for (const r of main) c.road(c.geo(r, 4), 0.095, { color: '#a6a298', edge: '#7d7a72' });

  // --- London Wall: the Romans' line, which still bounds the City of London almost two thousand
  // years on, painted on the ground it stood on.
  const wall = c.geo([[51.5095, -0.0755], [51.5140, -0.0755], [51.5165, -0.0815], [51.5180, -0.0885], [51.5175, -0.0970], [51.5155, -0.1010], [51.5140, -0.1030], [51.5112, -0.1035]], 3);
  c.ground(wall, '#b9ac8a');
  c.line(closed(wall), 0.05, '#a44a38', { dash: [0.12, 0.07] });

  // --- Landmarks.
  const [wmX, wmZ] = P(51.4985, -0.1266);
  const palaceYaw = 0.06;
  const palaceS = 1.25;
  westminster(c, wmX, wmZ, palaceYaw, palaceS);
  const [towerClockX, towerClockZ] = worldOf(c.frame(wmX, wmZ, { yaw: palaceYaw, s: palaceS }), -0.1, -0.74);
  clockFace(c, c.frame(towerClockX, towerClockZ, { yaw: palaceYaw, s: palaceS }), 1.54, 0.085);
  const abbey = c.frame(...P(51.4995, -0.1290), { yaw: 1.45 }).reserve(0.34, 0.86, 0.01);
  abbey.block(0, 0, 0, 0.22, 0.28, 0.7, 0xb5ab92, { windows: false, roof: 0x5a6a72 });
  abbey.gable(0, 0.28, 0, 0.24, 0.72, 0.11, 0x5a6a72, 0xb5ab92);
  abbey.block(0, 0, -0.1, 0.42, 0.24, 0.16, 0xb5ab92, { windows: false, roof: 0x5a6a72 });
  for (const side of [-1, 1]) abbey.block(side * 0.07, 0, 0.36, 0.1, 0.56, 0.1, 0xb5ab92, { windows: false, roof: 0x5a6a72 });
  const [eyX, eyZ] = P(51.5033, -0.1196);
  londonEye(c, eyX + 0.15, eyZ, -0.25);
  const [spX, spZ] = P(51.5138, -0.0984); stPauls(c, spX, spZ, 1.45);
  const tb = [P(51.5095, -0.0735), P(51.5015, -0.0748)];
  towerBridge(c, tb[0], tb[1]);
  const [tlX, tlZ] = P(51.5095, -0.0800); towerOfLondon(c, tlX, tlZ, 0.15);
  const [shX, shZ] = P(51.5045, -0.0865); shard(c, shX, shZ);
  const [ghX, ghZ] = P(51.5145, -0.0803); gherkin(c, ghX, ghZ);
  const [bpX, bpZ] = P(51.5010, -0.1419); buckingham(c, bpX, bpZ, 1.2);

  // --- The city. No plan and no ruler: villages that grew together, streets that wander because a
  // stream or a footpath did, and in the Square Mile a cluster of towers on Roman ground.
  const city = P(51.5135, -0.0860);
  const brick = [0xa8846a, 0xb58e70, 0xbd9674, 0x9a7a64, 0xbcae98, 0xc6b9a0, 0xaab0b4];
  const dull = [0xa89c8e, 0xb0a596, 0x9e9488, 0xb8ac9c, 0x9b9ea0];
  const glass = [0x7f9fb6, 0x8cabc0, 0x6f8fa8];
  const tall = (x, z) => gauss(x, z, city[0], city[1], 1.05);
  c.fill({
    poly: northLand, yaw: 0.16, lot: [0.24, 0.2], every: [3, 2], street: [0.06, 0.055], warp: 0.42, warpF: 0.7, turn: 0.75, seed: 41, skip: 0.02,
    h: (x, z, rng) => (0.18 + rng() * 0.12 + 1.7 * tall(x, z) * (0.2 + rng() * 0.85)),
    color: (x, z, rng) => (rng() < tall(x, z) * 0.85 ? pick(rng, glass) : pick(rng, brick)),
    style: (x, z, height, rng) => (height < 0.3 && rng() < 0.55 ? 'gable' : 'flat'),
    roof: (x, z, rng) => pick(rng, [0x4f4a44, 0x5e5850, 0x6b5a4c]),
  });
  c.fill({
    poly: southLand, yaw: -0.2, lot: [0.24, 0.2], every: [3, 2], street: [0.06, 0.055], warp: 0.42, warpF: 0.6, turn: 0.75, seed: 42, skip: 0.05,
    h: (x, z, rng) => 0.15 + rng() * 0.12,
    color: (x, z, rng) => pick(rng, dull),
    style: (x, z, height, rng) => (rng() < 0.4 ? 'gable' : 'flat'),
    roof: (x, z, rng) => pick(rng, [0x4f4a44, 0x5e5850]),
  });

  // --- Bridges. The Thames here had just one until the middle of the 1700s.
  const crossings = [
    [[51.4840, -0.1640], [51.4800, -0.1650]], [[51.4890, -0.1270], [51.4860, -0.1270]], [[51.4950, -0.1240], [51.4950, -0.1200]],
    [[51.5008, -0.1250], [51.5008, -0.1195]], [[51.5068, -0.1230], [51.5060, -0.1180]], [[51.5102, -0.1180], [51.5072, -0.1150]],
    [[51.5118, -0.1040], [51.5085, -0.1040]], [[51.5112, -0.0985], [51.5078, -0.0985]], [[51.5098, -0.0870], [51.5060, -0.0885]],
  ];
  for (const [a, b] of crossings) c.bridge(P(...a), P(...b), { width: 0.1, piers: 2, rise: 0.03, color: 0x9a9587, deck: 0x7d7a72 });
  c.boat(...P(51.5082, -0.1060), 1.57, 0.36, 0xe8e2d4, 0x8d3b2c);
  c.boat(...P(51.5052, -0.0680), 1.45, 0.42, 0x3f4a50, 0xd9d0bd);
  addBoat(c.frame(...P(51.4945, -0.1218), { yaw: 0.1, y: 0.77 }), 0.32, 0xe8e2d4, 0x3a5a78);

  // --- Words.
  c.waterText_('RIVER THAMES', c.geo([[51.4830, -0.1560], [51.4865, -0.1330]]), 0.2);
  c.label('Big Ben', towerClockX - 0.62, towerClockZ + 0.1, 1.7);
  c.label('Houses of Parliament', wmX - 0.85, wmZ + 0.9, 0.42);
  c.label('Westminster Abbey', ...P(51.4975, -0.1320), 0.72);
  c.label('London Eye', eyX + 0.62, eyZ + 0.5, 0.42);
  c.label("St Paul's Cathedral", spX, spZ + 0.9, 1.45);
  c.label('Tower of London', tlX - 0.15, tlZ + 0.72, 0.5);
  c.label('Tower Bridge', tb[1][0] + 0.1, tb[1][1] + 0.3, 0.4);
  c.label('The Shard', shX + 0.05, shZ + 0.42, 1.25);
  c.label('The Gherkin', ghX + 0.1, ghZ + 0.3, 1.5);
  c.label('Buckingham Palace', bpX - 0.15, bpZ + 0.72, 0.62);
  c.label('Hyde Park', ...P(51.5040, -0.1700), 0.4);
  c.label("Regent's Park", ...P(51.5240, -0.1550), 0.4);
  c.label('Roman wall of the City', ...P(51.5158, -0.1012), 1.0);
  return c.finish();
}

function squareAt(x, z, h) { return [[x - h, z - h], [x + h, z - h], [x + h, z + h], [x - h, z + h]]; }


// ---------------------------------------------------------------------------------------------
// Moscow
// ---------------------------------------------------------------------------------------------
const K_BRICK = 0xa8473a;

function onion(f, lx, ly, lz, r, color, neck = 0xe8e2d0) {
  f.cyl(lx, ly, lz, r * 0.62, r * 0.68, r * 0.9, neck, 8);
  const y = ly + r * 0.9;
  const P = [[0, 0], [r * 0.6, 0], [r * 1.02, r * 0.5], [r * 0.98, r * 0.92], [r * 0.6, r * 1.42], [r * 0.2, r * 1.92], [r * 0.03, r * 2.26], [0, r * 2.3]];
  f.lathe(lx, y, lz, P, color, 12);
  f.bar([lx, y + r * 2.3, lz], [lx, y + r * 2.7, lz], r * 0.05, 0xe2b23c, 3);
}

function kremlinTower(f, lx, lz, h, { spire = 0x4f7f5c, wide = 0.12, round = false, star = false } = {}) {
  if (round) f.cyl(lx, 0, lz, wide * 0.54, wide * 0.6, h * 0.6, K_BRICK, 10);
  else f.box(lx, 0, lz, wide, h * 0.6, wide, K_BRICK);
  f.box(lx, h * 0.6, lz, wide * 0.78, h * 0.14, wide * 0.78, K_BRICK);
  f.block(lx, h * 0.74, lz, wide * 0.78, h * 0.26, wide * 0.78, spire, { top: [wide * 0.05, wide * 0.05], windows: false });
  if (star) f.ball(lx, h * 1.03, lz, wide * 0.15, 0xb8292c, 6);
}

function kremlin(c) {
  const P = (la, lo) => c.at(la, lo);
  // A triangle in plan, on the hill above the bend in the river.
  const corners = [[55.7490, 37.6118], [55.7498, 37.6232], [55.7558, 37.6160]].map(([la, lo]) => P(la, lo));
  // Enlarged from the river wall, so the south side stays on the bank and only the rest moves.
  const pivot = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2 - 0.08];
  const grow = (p) => [pivot[0] + (p[0] - pivot[0]) * 1.3, pivot[1] + (p[1] - pivot[1]) * 1.3];
  const [A, B, N] = corners.map(grow);
  const centroid = [(A[0] + B[0] + N[0]) / 3, (A[1] + B[1] + N[1]) / 3];
  const inside = [A, B, N];
  c.ground(inside, '#7d9d62');
  c.reservePoly(inside.map((p) => [centroid[0] + (p[0] - centroid[0]) * 1.08, centroid[1] + (p[1] - centroid[1]) * 1.08]));
  const wallTo = (p, q, withTowers) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const yaw = Math.atan2(q[0] - p[0], q[1] - p[1]);
    const w = c.frame(p[0], p[1], { yaw });
    w.box(0, 0, L / 2, 0.055, 0.22, L, K_BRICK);
    // Swallow-tail battlements, every one, because they are what makes it read as this wall.
    const n = Math.floor(L / 0.075);
    for (let i = 0; i < n; i += 1) w.box(0, 0.22, (i + 0.5) * (L / n), 0.04, 0.045, L / n * 0.52, 0xb65040);
    for (const [t, h, opt] of withTowers) {
      kremlinTower(w, 0, L * t, h, opt);
    }
  };
  wallTo(A, B, [
    [0.2, 0.6, {}], [0.5, 0.56, {}], [0.78, 0.6, {}],
  ]);
  wallTo(B, N, [
    [0.24, 1.2, { wide: 0.18, star: true }], [0.46, 0.58, {}], [0.62, 0.56, {}], [0.82, 0.86, { star: true, wide: 0.15 }],
  ]);
  wallTo(N, A, [
    [0.22, 0.6, {}], [0.46, 1.06, { wide: 0.16, star: true }], [0.76, 0.82, { star: true, wide: 0.14 }],
  ]);
  for (const [p, h] of [[A, 0.84], [B, 0.72], [N, 0.74]]) {
    kremlinTower(c.frame(p[0], p[1]), 0, 0, h, { wide: 0.2, round: true, star: p !== N });
  }
  // Inside: the cathedrals and the bell tower on their square, and the palaces round them.
  const q = c.frame(centroid[0], centroid[1], { s: 1.25 });
  const white = 0xece6d4; const gold = 0xe4b43a; const yellow = 0xd9b56a; const green = 0x567f66;
  // Ivan the Great Bell Tower, the tallest thing in the Kremlin for centuries.
  q.cyl(0.26, 0, -0.12, 0.1, 0.1, 0.34, white, 8);
  q.cyl(0.26, 0.34, -0.12, 0.112, 0.112, 0.02, 0xd8d0ba, 8);
  q.cyl(0.26, 0.36, -0.12, 0.08, 0.08, 0.24, white, 8);
  q.cyl(0.26, 0.6, -0.12, 0.09, 0.09, 0.02, 0xd8d0ba, 8);
  q.cyl(0.26, 0.62, -0.12, 0.058, 0.058, 0.2, white, 8);
  q.dome(0.26, 0.82, -0.12, 0.05, 0.09, gold, 10);
  q.bar([0.26, 0.91, -0.12], [0.26, 0.97, -0.12], 0.004, gold, 3);
  // The Assumption Cathedral: five gold domes on a white block.
  q.block(-0.06, 0, -0.26, 0.26, 0.24, 0.3, white, { windows: false });
  onion(q, -0.06, 0.24, -0.26, 0.045, gold);
  for (const [ox, oz] of [[-0.09, -0.1], [0.09, -0.1], [-0.09, 0.1], [0.09, 0.1]]) onion(q, -0.06 + ox, 0.24, -0.26 + oz, 0.032, gold);
  // The Archangel and the Annunciation.
  q.block(-0.08, 0, 0.08, 0.2, 0.2, 0.2, white, { windows: false });
  onion(q, -0.08, 0.2, 0.08, 0.04, 0xdfe4e6);
  q.block(-0.34, 0, -0.14, 0.13, 0.17, 0.13, white, { windows: false });
  onion(q, -0.34, 0.17, -0.14, 0.03, gold);
  // The Grand Kremlin Palace above the river wall, with a green roof.
  q.block(-0.58, 0, 0.16, 0.5, 0.24, 0.16, yellow, { roof: green });
  q.block(-0.58, 0.24, 0.16, 0.5, 0.05, 0.16, green, { top: [0.4, 0.08], windows: false });
  // The Senate: the yellow triangle by the north-east wall, with a green dome.
  q.block(0.16, 0, -0.72, 0.34, 0.2, 0.16, yellow, { roof: green });
  q.cyl(0.16, 0.2, -0.72, 0.05, 0.055, 0.06, yellow, 8);
  q.dome(0.16, 0.26, -0.72, 0.055, 0.06, green, 10);
  q.block(-0.02, 0, -0.95, 0.2, 0.2, 0.5, yellow, { roof: green });
  return { N, B, A, centroid };
}

function stBasils(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.25, s: 1.45 }).reserve(0.7, 0.7, 0.01);
  const brick = 0xa8493a; const trim = 0xe4d6b8;
  f.box(0, 0, 0, 0.56, 0.1, 0.56, trim);
  f.block(0, 0.1, 0, 0.42, 0.14, 0.42, brick, { windows: false });
  // The central tent, the tallest thing on it, surrounded by eight chapels.
  f.cyl(0, 0.24, 0, 0.09, 0.11, 0.28, brick, 8);
  f.cyl(0, 0.52, 0, 0.082, 0.09, 0.05, trim, 8);
  f.cone(0, 0.57, 0, 0.082, 0.32, 0x4f7f5c, 8);
  onion(f, 0, 0.89, 0, 0.022, 0xe4b43a, trim);
  // No two alike is the single most-repeated fact about this building, so this is written out as a
  // table rather than generated: a loop over hue gives eight of the same dome.
  const chapels = [
    [0, 0.25, 0.068, 0x2f8f6a, 0xe4d6b8, 0.36, 0.11],
    [0.18, 0.18, 0.054, 0xd8b43a, 0xc23a3a, 0.26, 0.1],
    [0.26, 0, 0.064, 0xc23a3a, 0x3a7a5c, 0.32, 0.11],
    [0.18, -0.18, 0.054, 0x3a7abf, 0xe8e0c8, 0.26, 0.1],
    [0, -0.25, 0.068, 0x3f9f7a, 0xe4b43a, 0.34, 0.11],
    [-0.18, -0.18, 0.054, 0xd96a3a, 0x3a5a9a, 0.26, 0.1],
    [-0.26, 0, 0.064, 0xe0c23a, 0x2f8f6a, 0.32, 0.11],
    [-0.18, 0.18, 0.054, 0x8a3a8f, 0xe8e0c8, 0.26, 0.1],
  ];
  for (const [ox, oz, r, a, b, h, w] of chapels) {
    f.cyl(ox, 0.1, oz, w * 0.5, w * 0.58, h, brick, 8);
    f.cyl(ox, 0.1 + h, oz, w * 0.42, w * 0.5, 0.03, trim, 8);
    const y = 0.13 + h;
    f.cyl(ox, y, oz, r * 0.62, r * 0.68, r * 0.9, trim, 8);
    // A dome in bands of two colours, the way the real ones are striped.
    const cy = y + r * 0.9;
    f.city.b.add(onionGeometry(r), (px, py, pz) => {
      const p = f.p(ox, cy, oz);
      const ang = Math.atan2(px - p[0], pz - p[2]);
      const band = Math.floor((ang + (py - p[1]) * 12) * (6 / TAU));
      return band % 2 === 0 ? lin3(a) : lin3(b);
    }, { position: f.p(ox, cy, oz) });
    f.bar([ox, cy + r * 2.3, oz], [ox, cy + r * 2.8, oz], r * 0.05, 0xe4b43a, 3);
  }
}

function lin3(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }

function onionGeometry(r) {
  return lathe([[0, 0], [r * 0.6, 0], [r * 1.02, r * 0.5], [r * 0.98, r * 0.92], [r * 0.6, r * 1.42], [r * 0.2, r * 1.92], [r * 0.03, r * 2.26], [0, r * 2.3]], 14);
}

function mausoleum(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(0.3, 0.26, 0.01);
  const dark = 0x5a2e2a;
  f.box(0, 0, 0, 0.28, 0.05, 0.24, dark);
  f.box(0, 0.05, 0, 0.2, 0.05, 0.16, 0x3a2a2a);
  f.box(0, 0.1, 0, 0.12, 0.05, 0.1, dark);
  f.box(0, 0.15, 0, 0.08, 0.035, 0.06, 0x3a2a2a);
}

function gum(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.4 }).reserve(0.36, 1.2, 0.01);
  const stone = 0xd1c5a6; const glass = 0x9cc7dc;
  f.block(0, 0, 0, 0.34, 0.24, 1.18, stone, { roof: 0x7f8a90 });
  for (const lz of [-0.36, 0, 0.36]) f.gable(0, 0.24, lz, 0.16, 0.32, 0.06, glass, glass);
}

function historicalMuseum(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.4 }).reserve(0.58, 0.38, 0.01);
  const red = 0xa84436; const roof = 0x565f64;
  f.block(0, 0, 0, 0.52, 0.24, 0.34, red, { roof });
  for (const [ox, oz, h] of [[0.17, 0.14, 0.26], [-0.17, 0.14, 0.26], [0.2, -0.14, 0.18], [-0.2, -0.14, 0.18]]) {
    f.block(ox, 0.24, oz, 0.07, 0.1, 0.07, red, { windows: false });
    f.block(ox, 0.34, oz, 0.07, h, 0.07, roof, { top: [0.005, 0.005], windows: false });
  }
  for (const ox of [0.06, -0.06]) f.block(ox, 0.24, 0.14, 0.05, 0.28, 0.05, roof, { top: [0.005, 0.005], windows: false });
}

function christTheSaviour(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.1, s: 1.35 }).reserve(0.78, 0.78, 0.01);
  const white = 0xf0ebda; const gold = 0xe4b43a;
  f.block(0, 0, 0, 0.62, 0.42, 0.62, white, { windows: false });
  f.block(0, 0, 0, 0.74, 0.3, 0.32, white, { windows: false });
  f.block(0, 0, 0, 0.32, 0.3, 0.74, white, { windows: false });
  f.cyl(0, 0.42, 0, 0.16, 0.18, 0.22, white, 14);
  onion(f, 0, 0.64, 0, 0.13, gold, white);
  for (const [ox, oz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    f.cyl(ox * 0.24, 0.42, oz * 0.24, 0.05, 0.055, 0.12, white, 8);
    onion(f, ox * 0.24, 0.54, oz * 0.24, 0.042, gold, white);
  }
}

function bolshoi(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, s: 1.35 }).reserve(0.48, 0.74, 0.01);
  const cream = 0xd8c48a; const white = 0xefe9d8;
  f.block(0, 0, -0.06, 0.44, 0.3, 0.6, cream, { roof: 0x7a8588 });
  f.box(0, 0, 0.27, 0.3, 0.03, 0.1, white);
  for (let i = 0; i < 8; i += 1) f.cyl(-0.13 + i * 0.037, 0.03, 0.3, 0.008, 0.009, 0.24, white, 5);
  f.box(0, 0.27, 0.27, 0.32, 0.03, 0.1, white);
  f.gable(0, 0.3, 0.26, 0.11, 0.32, 0.07, white, white, Math.PI / 2);
  // The four-horse chariot of Apollo on the top. A bronze blob at this size, in the right place.
  f.box(0, 0.37, 0.28, 0.07, 0.05, 0.05, 0x7f6a3c);
}

// A Stalinist high-rise: stepped wings rising to a central tower and a spire with a star on it.
function sister(c, x, z, h, yaw = 0) {
  const f = c.frame(x, z, { yaw }).reserve(0.9, 0.9, 0.01);
  const stone = 0xd4c8ab; const shade = 0xbfb394;
  for (const [ox, oz, w, d, hh] of [[-0.3, 0, 0.3, 0.42, 0.34], [0.3, 0, 0.3, 0.42, 0.34], [0, -0.3, 0.42, 0.3, 0.34], [0, 0.3, 0.42, 0.3, 0.34]]) {
    f.block(ox, 0, oz, w, h * hh, d, stone);
    f.block(ox, h * hh, oz, w * 0.62, h * 0.08, d * 0.62, shade, { windows: false });
  }
  f.block(0, 0, 0, 0.42, h * 0.56, 0.42, stone);
  f.block(0, h * 0.56, 0, 0.32, h * 0.16, 0.32, stone);
  f.block(0, h * 0.72, 0, 0.22, h * 0.09, 0.22, stone);
  f.block(0, h * 0.81, 0, 0.14, h * 0.06, 0.14, shade, { windows: false });
  f.block(0, h * 0.87, 0, 0.14, h * 0.1, 0.14, 0xe2d8bc, { top: [0.02, 0.02], windows: false });
  f.bar([0, h * 0.97, 0], [0, h * 1.04, 0], 0.005, 0xe4b43a, 3);
  f.ball(0, h * 1.05, 0, 0.022, 0xd9b04a, 6);
  for (const [ox, oz] of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) f.block(ox, h * 0.56, oz, 0.05, h * 0.09, 0.05, shade, { top: [0.006, 0.006], windows: false });
}

export function moscow() {
  const c = new City({
    w: 16, d: 15, lat: 55.7545, lon: 37.613, km: 0.34, seed: 1147,
    landColor: '#94918a', waterColor: '#47768c', waterDeep: '#3d6a7f',
    tile: { feet: [0.26, 0.22], cols: 7, rows: 5, lit: 0.1, winW: 0.46, winH: 0.62, wall: '#f4f0e4' },
    title: 'MOSCOW',
    subtitle: 'North is at the back.  Map scale: 1 foot = about a fifth of a mile.  Landmarks are much bigger than the map scale.',
  });
  const P = (la, lo) => c.at(la, lo);

  const moskva = c.geo([[55.7180, 37.5730], [55.7240, 37.5800], [55.7300, 37.5885], [55.7345, 37.5985], [55.7400, 37.6025], [55.7445, 37.6045], [55.7480, 37.6100], [55.7485, 37.6165], [55.7488, 37.6235], [55.7485, 37.6330], [55.7480, 37.6390], [55.7440, 37.6480], [55.7340, 37.6560], [55.7240, 37.6620], [55.7180, 37.6660]], 6);
  const north = bank(moskva, 0.52, -1);
  const south = bank(moskva, 0.52, 1);
  // Travelling east, the north side is the left-hand one: the land side of the city.
  const northLand = c.land([...north, [8.1, 8.1], [8.1, -8.1], [-8.1, -8.1], [-8.1, 8.1]]);
  const southLand = c.land([...south]);

  // --- The rings. Each one follows a line of walls or ramparts the city had outgrown.
  const garden = c.geo(closed([[55.7345, 37.5985], [55.7365, 37.5880], [55.7480, 37.5820], [55.7600, 37.5810], [55.7700, 37.5960], [55.7730, 37.6150], [55.7720, 37.6330], [55.7690, 37.6480], [55.7570, 37.6590], [55.7410, 37.6530], [55.7300, 37.6380], [55.7270, 37.6240], [55.7300, 37.6100]]), 5);
  c.road(garden, 0.2, { color: '#b3aea1', edge: '#7f7c74' });
  const boulevardRing = c.geo([[55.7450, 37.6020], [55.7525, 37.6010], [55.7575, 37.6010], [55.7650, 37.6055], [55.7680, 37.6225], [55.7650, 37.6385], [55.7590, 37.6465], [55.7500, 37.6470]], 6);
  c.road(boulevardRing, 0.17, { color: '#7da858', edge: '#6f6c66' });
  c.avenueTrees(boulevardRing, 0.18, 0.16, 0.05);
  // Radial roads, all pointing back at the Kremlin.
  const radials = [
    [[55.7575, 37.6135], [55.7650, 37.6055], [55.7700, 37.5960], [55.7790, 37.5880]], // Tverskaya
    [[55.7525, 37.6010], [55.7530, 37.5880], [55.7510, 37.5650]], // New Arbat
    [[55.7580, 37.6265], [55.7650, 37.6385], [55.7690, 37.6480], [55.7790, 37.6610]], // Myasnitskaya
    [[55.7560, 37.6280], [55.7590, 37.6465], [55.7570, 37.6590], [55.7560, 37.6750]], // Pokrovka
    [[55.7450, 37.6020], [55.7365, 37.5880], [55.7250, 37.5720]], // Komsomolsky
    [[55.7440, 37.6130], [55.7300, 37.6100], [55.7180, 37.6020]], // Yakimanka, Leninsky
    [[55.7440, 37.6265], [55.7270, 37.6240], [55.7180, 37.6250]], // Pyatnitskaya
    [[55.7600, 37.6170], [55.7680, 37.6225], [55.7730, 37.6150], [55.7830, 37.6170]], // Petrovka
    [[55.7600, 37.6280], [55.7720, 37.6330], [55.7830, 37.6330]], // Sretenka
  ];
  for (const r of radials) c.road(c.geo(r, 4), 0.11, { color: '#a9a498', edge: '#7f7c74' });
  // The Drainage Canal, dug in the 1780s to take the river's floods round the old town.
  const canal = c.geo([[55.7385, 37.6040], [55.7405, 37.6120], [55.7430, 37.6230], [55.7450, 37.6330], [55.7465, 37.6400]], 4);
  c.line(canal, 0.14, '#47768c', { keep: true });

  // --- Parks.
  const gorky = c.geo([[55.7345, 37.5960], [55.7290, 37.5920], [55.7230, 37.5880], [55.7210, 37.5975], [55.7300, 37.6040]]);
  c.park(gorky, { trees: 60, treeH: 0.27, color: '#7da858' });
  const alex = c.geo([[55.7500, 37.6090], [55.7556, 37.6150], [55.7562, 37.6130], [55.7520, 37.6080]]);
  c.park(alex, { trees: 16, treeH: 0.2, color: '#86ad60' });
  const zaryadye = c.geo([[55.7510, 37.6240], [55.7520, 37.6300], [55.7500, 37.6310], [55.7498, 37.6245]]);
  c.park(zaryadye, { trees: 14, treeH: 0.2, color: '#7da858' });
  c.park(c.geo([[55.7660, 37.6000], [55.7670, 37.6060], [55.7640, 37.6070], [55.7630, 37.6015]]), { trees: 8, treeH: 0.2, color: '#7da858' });

  // --- The Kremlin and Red Square, which everything else on this plan is arranged around.
  const k = kremlin(c);
  const [redA, redB] = [k.B, k.N];
  const dx = redB[0] - redA[0]; const dz = redB[1] - redA[1];
  const L = Math.hypot(dx, dz);
  const ux = dx / L; const uz = dz / L;
  const nx = -uz; const nz = ux; // away from the Kremlin wall
  const sq = (t, n) => [redA[0] + ux * L * t + nx * n, redA[1] + uz * L * t + nz * n];
  const redSquare = [sq(-0.26, 0.08), sq(1.08, 0.08), sq(1.08, 1.05), sq(-0.26, 1.05)];
  c.plaza(redSquare, '#6e6a68');
  const redYaw = Math.atan2(ux, uz);
  const [sbX, sbZ] = sq(-0.1, 0.56); stBasils(c, sbX, sbZ);
  const [muX, muZ] = sq(0.46, 0.2); mausoleum(c, muX, muZ, redYaw);
  const [gmX, gmZ] = sq(0.56, 1.28); gum(c, gmX, gmZ, redYaw);
  const [hmX, hmZ] = sq(1.2, 0.52); historicalMuseum(c, hmX, hmZ, redYaw + Math.PI);
  const [ctX, ctZ] = P(55.7447, 37.6054); christTheSaviour(c, ctX, ctZ);
  const [boX, boZ] = P(55.7601, 37.6186); bolshoi(c, boX, boZ, 0.02);
  c.plaza(squareAt(boX, boZ + 0.5, 0.18), '#a9a498');
  const [ksX, ksZ] = P(55.7475, 37.6425); sister(c, ksX, ksZ, 2.3);
  const [kdX, kdZ] = P(55.7595, 37.5825); sister(c, kdX, kdZ, 1.95);
  const [mfX, mfZ] = P(55.7464, 37.5831); sister(c, mfX, mfZ, 2.1);

  // --- The city: old and low inside the Boulevard Ring, pale and classical to the Garden Ring, and
  // taller and plainer beyond it, which is the order it was built in.
  const pastel = [0xd9c08c, 0xd6b98e, 0xcfa98a, 0xc9c0a4, 0xc4ad8e, 0xb78d78, 0xd8cdb2];
  const plain = [0xa9a69e, 0xb4afa4, 0x9d9a94, 0xbdb7a8, 0xa6a2a0, 0xc2b79e];
  const centre = k.centroid;
  const dist = (x, z) => Math.hypot(x - centre[0], z - centre[1]);
  const shared = { lot: [0.28, 0.22], every: [3, 2], street: [0.06, 0.06], warp: 0.3, warpF: 0.55, turn: 0.6, skip: 0.02 };
  const height = (x, z, rng) => {
    const d = dist(x, z);
    if (d < 3.4) return 0.2 + rng() * 0.09;
    if (d < 6.2) return 0.26 + rng() * 0.12;
    return 0.32 + rng() * 0.22;
  };
  const tone = (x, z, rng) => (dist(x, z) < 6.2 ? pick(rng, pastel) : pick(rng, plain));
  const style = (x, z, h, rng) => (h < 0.4 && rng() < 0.35 ? 'hip' : 'flat');
  const roof = (x, z, rng) => pick(rng, [0x6b7c74, 0x7a6a5a, 0x5f6a70, 0x8a8478]);
  c.fill({ ...shared, poly: northLand, yaw: 0.3, seed: 51, h: height, color: tone, style, roof });
  c.fill({ ...shared, poly: southLand, yaw: -0.25, seed: 52, h: height, color: tone, style, roof });

  // --- Bridges.
  const crossings = [
    [[55.7360, 37.5960], [55.7330, 37.6010]], [[55.7470, 37.6020], [55.7425, 37.6065]], [[55.7500, 37.6100], [55.7458, 37.6100]],
    [[55.7505, 37.6235], [55.7470, 37.6235]], [[55.7500, 37.6390], [55.7462, 37.6390]],
  ];
  for (const [a, b] of crossings) c.bridge(P(...a), P(...b), { width: 0.13, piers: 2, rise: 0.04, color: 0x8e8a80, deck: 0x6f6c66 });
  c.mover((f) => addBoat(f, 0.5, 0xe8e2d4, 0x31506b), c.geo([[55.7400, 37.6025], [55.7445, 37.6045], [55.7480, 37.6100], [55.7485, 37.6165], [55.7488, 37.6235], [55.7485, 37.6330]], 5), { speed: 0.22 });
  c.boat(...P(55.7352, 37.5982), 0.8, 0.36, 0xe8e2d4, 0x8d3b2c);

  // --- Words.
  c.waterText_('MOSKVA RIVER', c.geo([[55.7320, 37.5920], [55.7360, 37.5990]]), 0.16);
  c.label('The Kremlin', k.centroid[0] - 0.95, k.centroid[1] + 0.5, 0.7);
  c.label('Spasskaya Tower', ...sq(0.24, 0.1), 1.3);
  c.label("St Basil's Cathedral", sbX + 0.5, sbZ + 0.7, 0.62);
  c.label('Red Square', ...sq(0.72, 0.6), 0.3);
  c.label('Lenin Mausoleum', muX - 0.1, muZ + 0.3, 0.5);
  c.label('GUM', gmX + 0.1, gmZ + 0.5, 0.55);
  c.label('State Historical Museum', hmX, hmZ + 0.42, 0.92);
  c.label('Cathedral of Christ the Saviour', ctX, ctZ + 0.72, 1.45);
  c.label('Bolshoi Theatre', boX, boZ + 0.7, 0.72);
  c.label('Kotelnicheskaya Tower', ksX, ksZ + 0.62, 1.05);
  c.label('Foreign Ministry', mfX, mfZ + 0.62, 1.05);
  c.label('Kudrinskaya Tower', kdX, kdZ + 0.62, 1.05);
  c.label('Gorky Park', ...P(55.7325, 37.5950), 0.42);
  c.label('Boulevard Ring', ...P(55.7650, 37.6250), 0.6);
  c.label('Garden Ring', ...P(55.7718, 37.6050), 0.65);
  return c.finish();
}

export const BUILDERS = {
  'london-diorama': london,
  'paris-diorama': paris,
  'moscow-diorama': moscow,
};
