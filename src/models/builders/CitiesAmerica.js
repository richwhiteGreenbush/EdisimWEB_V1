// City Dioramas: New York City and Boston. See src/models/city/CityKit.js for how a city is put
// together, and CLAUDE.md for why. Everything on these plans is placed from a real latitude and
// longitude, north at the back; heights and the landmarks' own footprints are enlarged, and each
// model's card says so.

import * as THREE from 'three';
import { City, addBoat, inPoly, TAU } from '../city/CityKit.js';
import { noise2 } from '../geo/GeoKit.js';

const gauss = (x, z, cx, cz, r) => Math.exp(-(((x - cx) ** 2 + (z - cz) ** 2) / (r * r)));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// A suspension bridge between two points on the plan: two towers, a deck and hanging cables.
function suspension(c, a, b, { h = 0.7, stone = 0x9b8d78, dark = 0x3a3530, width = 0.2, towers = [0.27, 0.73], cable = 0x51504c, gothic = false } = {}) {
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  c.bridge(a, b, { width, piers: 0, rise: 0.03, seg: 8 });
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const deckY = 0.05;
  for (const t of towers) {
    const [x, z] = at(t);
    const f = c.frame(x, z, { yaw });
    const leg = width * 0.34;
    f.box(0, -0.14, 0, width * 1.5, 0.15, 0.13, stone);
    if (gothic) {
      f.box(0, 0, 0, width * 1.45, h, 0.1, stone);
      // Two pointed openings, built forward of the solid tower. The frame's own edge is what says hole.
      for (const side of [-1, 1]) {
        for (const face of [-1, 1]) {
          f.box(side * width * 0.36, h * 0.3, face * 0.052, width * 0.38, h * 0.42, 0.006, dark);
          f.cone(side * width * 0.36, h * 0.72, face * 0.052, width * 0.19, h * 0.1, dark, 4);
        }
      }
      f.box(0, h, 0, width * 1.6, 0.03, 0.12, stone);
    } else {
      f.box(-width * 0.5, 0, 0, leg, h, 0.08, stone);
      f.box(width * 0.5, 0, 0, leg, h, 0.08, stone);
      f.box(0, h * 0.5, 0, width, 0.05, 0.05, stone);
      f.box(0, h * 0.94, 0, width * 1.25, 0.05, 0.06, stone);
    }
  }
  const frame = c.frame(a[0], a[1], { yaw });
  const stations = [0, towers[0], towers[1], 1];
  const ctop = h + 0.015;
  for (const side of [-1, 1]) {
    const off = width * 0.46 * side;
    for (let span = 0; span < 3; span += 1) {
      const t0 = stations[span]; const t1 = stations[span + 1];
      const y0 = span === 0 ? 0.06 : ctop; const y1 = span === 2 ? 0.06 : ctop;
      const N = 8;
      let prev = null;
      for (let i = 0; i <= N; i += 1) {
        const u = i / N;
        const sag = span === 1 ? (1 - (2 * u - 1) ** 2) * (h - 0.1) : (1 - (2 * u - 1) ** 2) * 0.06;
        const y = y0 + (y1 - y0) * u - sag;
        const here = [off, Math.max(y, deckY + 0.02), L * (t0 + (t1 - t0) * u)];
        if (prev) frame.bar(prev, here, 0.006, cable, 3);
        if (i > 0 && i < N) frame.bar(here, [off, deckY, here[2]], 0.0035, cable, 3);
        prev = here;
      }
    }
  }
}

function libertyFigure(f) {
  const stone = 0xb9ab90; const copper = 0x74b09b; const shade = 0x5a9884;
  // The star-shaped fort under the pedestal is real: Fort Wood, eleven points.
  const star = [];
  for (let i = 0; i < 22; i += 1) {
    const r = i % 2 ? 0.3 : 0.44;
    const a = (i / 22) * TAU;
    star.push([Math.sin(a) * r, Math.cos(a) * r]);
  }
  f.outline(star, 0, 0.14, 0xa59a84, { windows: false, roof: 0xb7ad97 });
  f.box(0, 0.14, 0, 0.36, 0.1, 0.36, stone);
  f.block(0, 0.24, 0, 0.3, 0.52, 0.3, stone, { top: [0.21, 0.21], windows: false });
  f.box(0, 0.76, 0, 0.25, 0.04, 0.25, stone);
  f.lathe(0, 0.8, 0, [[0, 0], [0.135, 0], [0.128, 0.16], [0.1, 0.4], [0.088, 0.62], [0.086, 0.7], [0.052, 0.8], [0.03, 0.86], [0, 0.88]], copper, 14);
  // Folds: a few vertical ribs on the robe, which a smooth cone would not have.
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * TAU;
    f.bar([Math.sin(a) * 0.135, 0.8, Math.cos(a) * 0.135], [Math.sin(a) * 0.09, 1.42, Math.cos(a) * 0.09], 0.011, shade, 4);
  }
  // Shoulders under the drape, then a neck. Without them she is a head balanced on a cone.
  f.ball(0, 1.53, 0, 0.1, copper, 10, 0.62);
  f.cyl(0, 1.58, 0.003, 0.028, 0.034, 0.12, copper, 8);
  f.ball(0, 1.74, 0.005, 0.054, copper, 12);
  // Crown, seven rays.
  for (let i = 0; i < 7; i += 1) {
    const a = ((i - 3) / 7) * 3.4;
    f.bar([Math.sin(a) * 0.05, 1.77, Math.cos(a) * 0.05], [Math.sin(a) * 0.125, 1.84, Math.cos(a) * 0.125], 0.007, copper, 3);
  }
  // The right arm goes up and it is the raised arm that identifies her from anywhere.
  f.bar([0.085, 1.54, 0], [0.125, 1.76, 0.012], 0.028, copper, 6);
  f.bar([0.125, 1.76, 0.012], [0.133, 1.96, 0.01], 0.023, copper, 6);
  f.ball(0.125, 1.76, 0.012, 0.028, copper, 6);
  f.cyl(0.133, 1.96, 0.01, 0.024, 0.016, 0.07, shade, 7);
  f.cyl(0.133, 2.03, 0.01, 0.045, 0.045, 0.012, shade, 8);
  f.cone(0.133, 2.04, 0.01, 0.028, 0.09, 0xf0c044, 7);
  // The tablet, in the crook of the left arm.
  f.bar([-0.07, 1.52, 0], [-0.11, 1.28, 0.05], 0.02, copper, 5);
  f.box(-0.12, 1.22, 0.06, 0.05, 0.15, 0.09, shade);
}

function empireState(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(0.68, 0.52);
  const stone = 0xa7a091; const pale = 0xc2bcac;
  f.block(0, 0, 0, 0.66, 0.5, 0.5, stone);
  f.block(0, 0.5, 0, 0.52, 0.42, 0.4, stone);
  f.block(0, 0.92, 0, 0.42, 0.44, 0.32, stone);
  f.block(0, 1.36, 0, 0.34, 1.84, 0.27, stone);
  // Corner shoulders in the upper shaft, which are what make the setback read from far off.
  f.block(0, 3.2, 0, 0.27, 0.22, 0.21, pale);
  f.block(0, 3.42, 0, 0.2, 0.2, 0.16, pale);
  f.lathe(0, 3.62, 0, [[0, 0], [0.09, 0], [0.085, 0.08], [0.052, 0.3], [0.04, 0.34], [0.014, 0.42], [0.009, 0.95], [0, 1]], 0xc9cdd0, 8);
}

function oneWorldTrade(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.17 }).reserve(0.58, 0.58);
  const glass = 0x9cc3de;
  f.block(0, 0, 0, 0.42, 0.42, 0.42, 0xb3b7bb);
  f.antiprism(0, 0.42, 0, 0.3, 0.215, 4.2, glass);
  f.block(0, 4.62, 0, 0.13, 0.05, 0.13, 0xdde3e8, { windows: false });
  f.cyl(0, 4.67, 0, 0.006, 0.022, 1.0, 0xe2e4e6, 6);
  // Bridge and plaza: the two pools where the Twin Towers stood.
  const pool = c.frame(x + 0.05, z + 0.5, { yaw: 0.17 });
  for (const off of [-0.17, 0.17]) {
    pool.box(off, 0, 0, 0.26, 0.012, 0.26, 0x8f9498);
    pool.box(off, 0, 0, 0.19, 0.016, 0.19, 0x2f5f7c);
  }
}

function chrysler(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(0.5, 0.5);
  const brick = 0xb6b2a9; const steel = 0xc6ced4;
  f.block(0, 0, 0, 0.46, 0.5, 0.46, brick);
  f.block(0, 0.5, 0, 0.36, 0.5, 0.36, brick);
  f.block(0, 1, 0, 0.27, 1.45, 0.27, brick);
  // The crown: seven arches stepping inward, each a shoulder on a lathe.
  const P = [[0, 0]];
  let r = 0.17; let y = 0;
  for (let i = 0; i < 7; i += 1) {
    P.push([r, y]);
    y += 0.1;
    P.push([r * 0.86, y - 0.012]);
    r *= 0.76;
    P.push([r, y]);
  }
  P.push([0.006, y + 0.46], [0, y + 0.47]);
  f.lathe(0, 2.45, 0, P, steel, 8);
}

function flatiron(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(0.34, 0.5, 0.02);
  const wedge = [[0, -0.27], [0.17, 0.24], [-0.17, 0.24]];
  f.outline(wedge, 0, 0.92, 0xcfc6ae, { roof: 0x9a9384 });
}

export function newYorkCity() {
  const c = new City({
    w: 12.5, d: 16, lat: 40.7425, lon: -73.99, km: 0.85, seed: 1811,
    landColor: '#8e8b84', waterColor: '#3f86ad', waterDeep: '#2f7099',
    tile: { feet: [0.3, 0.26], cols: 8, rows: 7, lit: 0.12, winW: 0.58, winH: 0.6 },
    title: 'NEW YORK CITY',
    subtitle: 'North is at the back.  Map scale: 1 foot = about half a mile.  Buildings and landmarks are much bigger than the map scale.',
  });
  // Manhattan's grid does not run north. Its avenues lean 29 degrees east, to fit the island.
  const GRID = -0.506;

  const hudsonEast = c.geo([[40.7003, -74.0150], [40.7075, -74.0185], [40.7150, -74.0165], [40.7245, -74.0120], [40.7350, -74.0105], [40.7450, -74.0090], [40.7550, -74.0050], [40.7650, -73.9960], [40.7750, -73.9900], [40.7850, -73.9840], [40.7950, -73.9775], [40.8120, -73.9650]], 5);
  const eastSide = c.geo([[40.8120, -73.9340], [40.8000, -73.9290], [40.7900, -73.9390], [40.7800, -73.9425], [40.7700, -73.9490], [40.7600, -73.9595], [40.7500, -73.9675], [40.7420, -73.9725], [40.7330, -73.9735], [40.7250, -73.9722], [40.7170, -73.9760], [40.7115, -73.9795], [40.7095, -73.9900], [40.7050, -74.0000], [40.7003, -74.0120]], 5);
  const manhattan = [...hudsonEast, ...eastSide];
  c.land(manhattan);

  const jersey = c.geo([[40.8200, -73.9800], [40.8040, -73.9880], [40.7900, -73.9990], [40.7800, -74.0050], [40.7650, -74.0190], [40.7450, -74.0265], [40.7300, -74.0300], [40.7150, -74.0340], [40.7080, -74.0390], [40.7000, -74.0520], [40.6900, -74.0650], [40.6800, -74.0780], [40.6700, -74.0900]], 5);
  const jerseyLand = c.land([...jersey, [-8.1, 8.1], [-8.1, -8.1], [jersey[0][0], -8.1]]);

  const brooklynShore = c.geo([[40.8200, -73.9050], [40.8040, -73.9090], [40.7900, -73.9150], [40.7830, -73.9210], [40.7730, -73.9360], [40.7620, -73.9490], [40.7500, -73.9590], [40.7350, -73.9610], [40.7180, -73.9640], [40.7080, -73.9690], [40.7020, -73.9790], [40.7005, -73.9920], [40.6950, -73.9990], [40.6880, -74.0040], [40.6800, -74.0120], [40.6700, -74.0220]], 5);
  const brooklyn = c.land([...brooklynShore, [brooklynShore[brooklynShore.length - 1][0], 8.1], [8.1, 8.1], [8.1, -8.1], [brooklynShore[0][0], -8.1]]);

  const blob = (lat, lon, rx, rz, n = 14) => {
    const [x, z] = c.at(lat, lon);
    const pts = [];
    for (let i = 0; i < n; i += 1) pts.push([x + Math.cos((i / n) * TAU) * rx, z + Math.sin((i / n) * TAU) * rz]);
    return pts;
  };
  c.ground(c.land(blob(40.6892, -74.0445, 0.62, 0.52)), '#7da858');
  c.ground(c.land(blob(40.6990, -74.0395, 0.24, 0.3)), '#8fae72');
  c.ground(c.land(blob(40.6895, -74.0165, 0.52, 0.42)), '#7da858');
  c.land(c.geo([[40.7520, -73.9620], [40.7650, -73.9510], [40.7720, -73.9440], [40.7705, -73.9420], [40.7630, -73.9490], [40.7510, -73.9600]]));
  c.ground(c.land(blob(40.7940, -73.9220, 0.5, 0.75)), '#7da858');

  // --- Central Park, true to its corners. Half a mile wide and two and a half long.
  const park = c.geo([[40.7644, -73.9730], [40.7681, -73.9819], [40.8005, -73.9582], [40.7969, -73.9493]]);
  const [resX, resZ] = c.at(40.7855, -73.9625);
  const [lakeX, lakeZ] = c.at(40.7775, -73.9710);
  const [meerX, meerZ] = c.at(40.7968, -73.9525);
  const [lawnX, lawnZ] = c.at(40.7812, -73.9665);
  c.park(park, {
    trees: 200, treeH: 0.27, color: '#7da858',
    paths: [c.geo([[40.7655, -73.9775], [40.7730, -73.9730], [40.7800, -73.9690], [40.7900, -73.9610], [40.7980, -73.9540]], 4)],
  });
  c.paintOver((ctx) => {
    const lake = (x, z, rx, rz, turn) => { ctx.fillStyle = '#4a93ba'; ctx.beginPath(); ctx.ellipse(x, z, rx, rz, turn, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(40,60,40,0.5)'; ctx.lineWidth = 0.02; ctx.stroke(); };
    lake(resX, resZ, 0.3, 0.45, 0.5);
    lake(lakeX, lakeZ, 0.15, 0.24, 0.8);
    lake(meerX, meerZ, 0.09, 0.15, 0.5);
    ctx.fillStyle = '#9dc873';
    ctx.beginPath(); ctx.ellipse(lawnX, lawnZ, 0.13, 0.22, 0.5, 0, TAU); ctx.fill();
  });

  // --- Broadway. Older than the grid, so it cuts straight across it.
  const broadway = c.geo([[40.7043, -74.0137], [40.7183, -74.0058], [40.7250, -73.9985], [40.7300, -73.9925], [40.7359, -73.9911], [40.7410, -73.9897], [40.7497, -73.9877], [40.7580, -73.9855], [40.7681, -73.9819], [40.7800, -73.9810], [40.7900, -73.9745], [40.8100, -73.9620]], 4);
  c.road(broadway, 0.1, { color: '#a8a39a', edge: '#7c7870' });
  const [timesX, timesZ] = c.at(40.7580, -73.9855);
  const [herald, heraldZ] = c.at(40.7497, -73.9877);
  c.reserveCircle(timesX, timesZ, 0.16);
  c.reserveCircle(herald, heraldZ, 0.12);

  // --- Landmarks claim their ground first, and the city fills what is left.
  const [wtcX, wtcZ] = c.at(40.7127, -74.0134);
  oneWorldTrade(c, wtcX, wtcZ);
  const [esbX, esbZ] = c.at(40.7484, -73.9857);
  empireState(c, esbX, esbZ, GRID);
  const [chrX, chrZ] = c.at(40.7516, -73.9755);
  chrysler(c, chrX, chrZ, GRID);
  const [fiX, fiZ] = c.at(40.7411, -73.9897);
  flatiron(c, fiX, fiZ, GRID + 0.18);
  c.frame(wtcX + 0.05, wtcZ + 0.5, { yaw: 0.17 }).reserve(0.7, 0.34, 0.02);
  const [libX, libZ] = c.at(40.6892, -74.0445);
  libertyFigure(c.frame(libX, libZ, { yaw: -0.5 }));

  // Times Square: the only colour in midtown that is not stone or glass.
  const ts = c.frame(timesX, timesZ, { yaw: GRID });
  for (const [ox, oz, col, wide, y, tall] of [
    [-0.16, -0.14, 0xe0354a, 0.2, 0.26, 0.3], [0.17, -0.1, 0x2c8fe0, 0.22, 0.34, 0.3], [-0.2, 0.08, 0xf0c21e, 0.18, 0.18, 0.28], [0.2, 0.12, 0xee5fae, 0.18, 0.2, 0.26],
  ]) {
    ts.box(ox, 0, oz, wide + 0.02, y + tall, 0.14, 0x4d545c);
    ts.box(ox, y, oz + 0.075, wide, tall, 0.012, col);
    ts.box(ox, y, oz - 0.075, wide, tall, 0.012, col);
  }

  // --- The city. Two clusters of towers, midtown and the Financial District, and a low city between.
  const midtown = c.at(40.7565, -73.9795);
  const downtown = c.at(40.7080, -74.0095);
  const stones = [0xa9a292, 0x98907f, 0xb6ad9b, 0xa2715a, 0x8d6450, 0x8f97a0];
  const glass = [0x7b9db8, 0x89a7bd, 0x6a8ca8, 0x93a8b3];
  const h = (x, z, rng) => {
    const m = gauss(x, z, midtown[0], midtown[1], 1.15); const d = gauss(x, z, downtown[0], downtown[1], 0.82);
    const base = 0.36 + 0.22 * noise2(x * 0.9, z * 0.9, 21);
    return Math.max(0.2, (base + 2.25 * m + 2.15 * d) * (0.62 + rng() * 0.62));
  };
  const color = (x, z, rng) => {
    const tall = gauss(x, z, midtown[0], midtown[1], 1.15) + gauss(x, z, downtown[0], downtown[1], 0.82);
    return rng() < tall * 0.62 ? pick(rng, glass) : pick(rng, stones);
  };
  const style = (x, z, height) => (height > 1.15 ? 'setback' : 'flat');
  const houston = c.at(40.7265, -74.0);
  // Below Houston Street the old city's streets were laid out before the grid, so it runs its own way.
  const isDowntown = (x, z) => z > houston[1] - (x - houston[0]) * 0.55;
  c.fill({
    poly: manhattan, where: isDowntown, yaw: -0.22, lot: [0.2, 0.2], every: [2, 3], street: [0.07, 0.06], warp: 0.14, warpF: 0.7, turn: 0.28, anchor: downtown, seed: 8,
    h, color, style, skip: 0,
  });
  c.fill({
    poly: manhattan, yaw: GRID, lot: [0.215, 0.25], every: [2, 2], street: [0.085, 0.05], anchor: [esbX, esbZ],
    h, color, style, skip: 0.02, seed: 9,
  });

  // --- Across the water. Low, brown and quiet, which is what makes the island read as a cluster.
  const low = [0x8c8074, 0x978c7e, 0x80766c, 0xa09486, 0x8a7a6c, 0x7d7f80];
  const outer = { lot: [0.23, 0.2], every: [3, 3], street: [0.075, 0.06], warp: 0.1, warpF: 0.4, turn: 0.1, skip: 0.08 };
  c.fill({ ...outer, poly: brooklyn, yaw: -0.42, seed: 12, anchor: c.at(40.72, -73.94), h: (x, z, rng) => 0.13 + rng() * 0.14, color: (x, z, rng) => pick(rng, low) });
  const exchange = c.at(40.7170, -74.0370);
  c.fill({ ...outer, poly: jerseyLand, yaw: -0.3, seed: 13, anchor: c.at(40.73, -74.05), h: (x, z, rng) => (0.13 + rng() * 0.14 + 1.0 * gauss(x, z, exchange[0], exchange[1], 0.55) * rng()), color: (x, z, rng) => pick(rng, low) });

  // --- Bridges, then the water traffic.
  const bb = [c.at(40.7075, -74.0002), c.at(40.7005, -73.9915)];
  suspension(c, bb[0], bb[1], { h: 0.72, gothic: true, width: 0.2 });
  suspension(c, c.at(40.7125, -73.9955), c.at(40.7030, -73.9845), { h: 0.72, stone: 0x6e8a9c, width: 0.2 });
  suspension(c, c.at(40.7175, -73.9775), c.at(40.7125, -73.9640), { h: 0.72, stone: 0x7b8690, width: 0.2 });
  c.bridge(c.at(40.7595, -73.9610), c.at(40.7515, -73.9520), { width: 0.17, piers: 3, rise: 0.1, color: 0x8b8f92 });
  c.boat(...c.at(40.7000, -74.0020), 0.7, 0.34, 0x3b4048, 0xd9d0bd);
  c.boat(...c.at(40.7300, -74.0170), 2.9, 0.42, 0xe8e2d4, 0x31506b);
  c.boat(...c.at(40.6920, -74.0260), 2.1, 0.5, 0x7a3b2b, 0xe0d9c8);
  // The Staten Island Ferry, orange since the 1920s, crossing the harbour for the whole of any visit.
  c.mover((f) => addBoat(f, 0.55, 0xe7762a, 0xf2e9d6), c.geo([[40.7005, -74.0115], [40.6960, -74.0200], [40.6900, -74.0310], [40.6830, -74.0450]], 5), { speed: 0.3 });

  // Finger piers down the Hudson side, which is what a working waterfront looked like for a century.
  for (const [la, lo] of [[40.7230, -74.0128], [40.7290, -74.0118], [40.7345, -74.0112], [40.7420, -74.0100], [40.7470, -74.0092], [40.7520, -74.0070], [40.7590, -74.0020], [40.7640, -73.9975]]) {
    const [px, pz] = c.at(la, lo);
    c.pier(px + 0.03, pz, -Math.PI / 2 - 0.5, 0.36);
  }
  // --- Words on the map, then the labels on posts.
  c.waterText_('HUDSON RIVER', c.geo([[40.7420, -74.0200], [40.7760, -73.9990]]), 0.26);
  c.waterText_('EAST RIVER', c.geo([[40.7240, -73.9670], [40.7540, -73.9640]]), 0.17);
  c.waterText_('UPPER NEW YORK BAY', c.geo([[40.6955, -74.0370], [40.6900, -74.0000]]), 0.2);
  c.landText_('CENTRAL PARK', c.geo([[40.7680, -73.9740], [40.7790, -73.9660]]), 0.15, 'rgba(250,250,235,0.92)');
  c.landText_('NEW JERSEY', c.geo([[40.7330, -74.0640], [40.7750, -74.0500]]), 0.3, 'rgba(255,250,235,0.6)');
  c.landText_('BROOKLYN', c.geo([[40.7000, -73.9500], [40.7000, -73.9200]]), 0.3, 'rgba(255,250,235,0.6)');
  c.landText_('QUEENS', c.geo([[40.7560, -73.9400], [40.7650, -73.9200]]), 0.3, 'rgba(255,250,235,0.6)');
  c.label('One World Trade Center', wtcX - 0.35, wtcZ + 0.35, 2.2);
  c.label('Statue of Liberty', libX, libZ + 0.62, 0.3);
  c.label('Empire State Building', esbX - 0.15, esbZ + 0.42, 2.3);
  c.label('Chrysler Building', chrX + 0.65, chrZ + 0.34, 1.75);
  c.label('Flatiron Building', fiX - 0.75, fiZ + 0.25, 1.3);
  c.label('Times Square', timesX - 0.62, timesZ + 0.25, 1.75);
  c.label('Central Park', lawnX - 0.1, lawnZ + 0.15, 0.62);
  c.label('Brooklyn Bridge', bb[1][0] + 0.1, bb[1][1] + 0.42, 0.5);
  return c.finish();
}

// ---------------------------------------------------------------------------------------------
// Boston
// ---------------------------------------------------------------------------------------------
function stateHouse(c, x, z) {
  const f = c.frame(x, z, { yaw: -0.12, s: 1.35 }).reserve(0.86, 0.6);
  const brick = 0xa8553c; const white = 0xe9e3d3; const gold = 0xe4b23a;
  f.block(0, 0, 0, 0.84, 0.42, 0.5, brick, { roof: 0x8a8378 });
  // The portico: a raised front on brick arches, with white columns above.
  f.box(0, 0, 0.3, 0.48, 0.16, 0.14, brick);
  f.box(0, 0.16, 0.3, 0.5, 0.025, 0.15, white);
  for (let i = 0; i < 6; i += 1) f.cyl(-0.2 + i * 0.08, 0.185, 0.35, 0.013, 0.015, 0.2, white, 6);
  f.box(0, 0.385, 0.3, 0.5, 0.05, 0.14, white);
  f.gable(0, 0.435, 0.3, 0.14, 0.5, 0.07, white, white, Math.PI / 2);
  f.block(0, 0.42, -0.02, 0.56, 0.08, 0.4, white, { windows: false });
  f.cyl(0, 0.5, -0.02, 0.15, 0.17, 0.09, white, 16);
  f.dome(0, 0.59, -0.02, 0.15, 0.2, gold, 18);
  f.cyl(0, 0.79, -0.02, 0.03, 0.035, 0.07, white, 8);
  f.ball(0, 0.875, -0.02, 0.022, gold, 8);
}

function steepleChurch(c, x, z, { yaw = 0, s = 1 } = {}) {
  const f = c.frame(x, z, { yaw, s }).reserve(0.34, 0.6);
  const brick = 0x9a4f38; const white = 0xe9e3d3;
  f.block(0, 0, -0.08, 0.28, 0.26, 0.42, brick, { roof: 0x4c463f });
  f.gable(0, 0.26, -0.08, 0.3, 0.44, 0.11, 0x4c463f, brick);
  f.block(0, 0, 0.2, 0.17, 0.46, 0.17, brick, { roof: 0x4c463f });
  f.box(0, 0.46, 0.2, 0.14, 0.12, 0.14, white);
  f.box(0, 0.58, 0.2, 0.1, 0.1, 0.1, white);
  f.cyl(0, 0.68, 0.2, 0.05, 0.065, 0.07, white, 8);
  f.cone(0, 0.75, 0.2, 0.048, 0.34, white, 8);
}

function bunkerHill(c, x, z) {
  const f = c.frame(x, z);
  c.reserveCircle(x, z, 0.56);
  f.lathe(0, 0, 0, [[0, 0], [0.56, 0], [0.5, 0.04], [0.34, 0.12], [0.22, 0.16], [0, 0.17]], 0x6b9a4c, 16);
  f.box(0, 0.16, 0, 0.16, 0.04, 0.16, 0x9f9c94);
  f.block(0, 0.2, 0, 0.13, 1.48, 0.13, 0xb2afa6, { top: [0.075, 0.075], windows: false });
  f.block(0, 1.68, 0, 0.075, 0.09, 0.075, 0xb2afa6, { top: [0.004, 0.004], windows: false });
}

function ironsides(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw, y: 0.77 });
  const L = 1.1;
  const hull = [[0, L / 2], [0.09, L * 0.3], [0.11, 0], [0.1, -L * 0.42], [0.06, -L / 2], [-0.06, -L / 2], [-0.1, -L * 0.42], [-0.11, 0], [-0.09, L * 0.3]];
  f.outline(hull, 0, 0.09, 0x1f1d1c, { windows: false, roof: 0x8d6d4a });
  f.outline(hull.map(([a, b]) => [a * 1.005, b * 1.005]), 0.09, 0.022, 0xe6e0d0, { windows: false, roof: 0x8d6d4a });
  for (const [m, h] of [[0.22, 0.86], [-0.02, 0.98], [-0.26, 0.8]]) {
    f.cyl(0, 0.1, m, 0.006, 0.012, h, 0x54402c, 5);
    for (const t of [0.42, 0.64, 0.82]) f.box(0, 0.1 + h * t, m, 0.25 * (1.25 - t), 0.008, 0.008, 0x54402c);
  }
  f.bar([0, 0.13, L / 2], [0, 0.22, L * 0.68], 0.005, 0x54402c, 3);
  f.bar([0, 0.22, L * 0.68], [0, 0.9, 0.22], 0.002, 0x3a332c, 3);
  f.bar([0, 0.9, 0.22], [0, 1.0, -0.02], 0.002, 0x3a332c, 3);
  f.bar([0, 1.0, -0.02], [0, 0.82, -0.26], 0.002, 0x3a332c, 3);
  f.bar([0, 0.82, -0.26], [0, 0.13, -L / 2], 0.002, 0x3a332c, 3);
  // A flag at the stern, the one colour on her.
  f.box(0, 0.74, -0.34, 0.006, 0.05, 0.1, 0xb2362e);
}

function faneuilHall(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(0.34, 1.0);
  const brick = 0xa8553c; const white = 0xe9e3d3;
  f.block(0, 0, 0.32, 0.3, 0.26, 0.42, brick, { roof: 0x4c463f });
  f.gable(0, 0.26, 0.32, 0.32, 0.44, 0.1, 0x4c463f, white);
  f.box(0, 0.33, 0.28, 0.07, 0.07, 0.07, white);
  f.cyl(0, 0.4, 0.28, 0.02, 0.035, 0.08, white, 8);
  // Quincy Market behind it: long and low, with a copper-green dome in the middle of its roof.
  f.block(0, 0, -0.26, 0.2, 0.2, 0.64, 0xc9bfa8, { roof: 0x6f6658 });
  f.gable(0, 0.2, -0.26, 0.22, 0.66, 0.06, 0x6f6658, 0xc9bfa8);
  f.dome(0, 0.25, -0.26, 0.07, 0.07, 0x7fa892, 10);
}

function hancock(c, x, z) {
  // A thin slanted rhombus in plan, and the sharp edge is what the whole skyline knows it by.
  const f = c.frame(x, z, { yaw: 0.6 }).reserve(0.62, 0.32);
  const plan = [[-0.3, -0.13], [0.34, -0.13], [0.3, 0.13], [-0.34, 0.13]];
  f.outline(plan, 0, 2.9, 0x8ebddb, { roof: 0x6a93ad, windows: false });
}

function prudential(c, x, z) {
  const f = c.frame(x, z, { yaw: -0.32 }).reserve(0.86, 0.72);
  const stone = 0xa4a7a9;
  f.block(0, 0, 0, 0.8, 0.2, 0.66, 0xb8b1a2);
  f.block(0, 0.2, 0, 0.36, 2.26, 0.28, stone);
  f.block(0, 2.46, 0, 0.29, 0.14, 0.22, 0x8d9195, { windows: false });
  f.cyl(0.08, 2.6, 0.02, 0.006, 0.009, 0.3, 0xc8ccd0, 4);
}

function customHouse(c, x, z) {
  const f = c.frame(x, z, { yaw: -0.1 }).reserve(0.5, 0.5);
  const pale = 0xcfc8b5;
  f.block(0, 0, 0, 0.44, 0.26, 0.44, pale);
  f.block(0, 0.26, 0, 0.22, 1.2, 0.22, pale);
  for (const [ox, oz] of [[0, 0.112], [0, -0.112], [0.112, 0], [-0.112, 0]]) {
    f.box(ox, 1.3, oz, oz ? 0.11 : 0.006, 0.11, oz ? 0.006 : 0.11, 0x2f6a58);
  }
  f.block(0, 1.46, 0, 0.22, 0.12, 0.22, pale, { top: [0.05, 0.05], windows: false, roof: 0xe0c070 });
  f.cone(0, 1.58, 0, 0.022, 0.1, 0xe0c070, 6);
}

function trinity(c, x, z) {
  const f = c.frame(x, z, { yaw: 0.6 }).reserve(0.46, 0.54);
  const stone = 0x8d6a52; const red = 0x7a3b2b;
  f.block(0, 0, 0, 0.2, 0.2, 0.5, stone, { roof: red });
  f.block(0, 0, 0, 0.44, 0.2, 0.2, stone, { roof: red });
  f.gable(0, 0.2, 0, 0.22, 0.52, 0.08, red, stone);
  f.block(0, 0.2, 0, 0.17, 0.2, 0.17, stone, { roof: red });
  f.block(0, 0.4, 0, 0.17, 0.17, 0.17, red, { top: [0.02, 0.02], windows: false });
}

function fenway(c, x, z, yaw) {
  const f = c.frame(x, z, { yaw }).reserve(1.05, 1.0, 0.02);
  // Stands on three sides, and on the fourth the wall that made the place famous.
  const grey = 0x7d8185;
  f.box(0, 0, 0.48, 1.0, 0.13, 0.08, grey);
  f.box(-0.48, 0, 0.06, 0.08, 0.13, 0.78, grey);
  f.box(0.5, 0, 0.26, 0.08, 0.13, 0.38, grey);
  f.box(0, 0, -0.44, 1.02, 0.25, 0.04, 0x2f6a3f);
  c.paintOver((ctx) => {
    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#3f8a3d';
    ctx.fillRect(-0.46, -0.42, 0.96, 0.88);
    // The dirt, and home plate towards the corner the stands wrap round.
    ctx.fillStyle = '#b48a58';
    ctx.beginPath();
    ctx.moveTo(-0.36, 0.34); ctx.lineTo(-0.36, 0.0); ctx.quadraticCurveTo(-0.14, -0.14, 0.0, 0.34); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#58a24e';
    ctx.beginPath();
    ctx.moveTo(-0.3, 0.28); ctx.lineTo(-0.3, 0.1); ctx.lineTo(-0.12, 0.28); ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

function zakim(c, a, b) {
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  c.bridge(a, b, { width: 0.2, piers: 0, rise: 0.02, deck: 0x7a7876 });
  const f = c.frame(a[0], a[1], { yaw });
  const white = 0xe6e6e0;
  for (const t of [0.3, 0.72]) {
    const zz = L * t;
    // An upside-down Y. Modelled on Bunker Hill's own obelisk, which it was designed to echo.
    f.bar([-0.14, -0.13, zz], [-0.03, 0.42, zz], 0.018, white, 4);
    f.bar([0.14, -0.13, zz], [0.03, 0.42, zz], 0.018, white, 4);
    f.bar([0, 0.42, zz], [0, 0.98, zz], 0.022, white, 4);
    for (let i = 1; i <= 7; i += 1) {
      const y = 0.46 + i * 0.07;
      for (const side of [-1, 1]) {
        for (const dir of [-1, 1]) {
          const reach = zz + dir * (0.09 + i * 0.1);
          if (reach < 0 || reach > L) continue;
          f.bar([0, y, zz], [side * 0.09, 0.05, reach], 0.0028, 0xd5d5ce, 3);
        }
      }
    }
  }
}

export function boston() {
  const c = new City({
    w: 16, d: 13, lat: 42.358, lon: -71.068, km: 0.375, seed: 1630,
    landColor: '#8e8b84', waterColor: '#4389a8', waterDeep: '#347797',
    tile: { feet: [0.28, 0.25], cols: 7, rows: 6, lit: 0.12, winW: 0.56, winH: 0.62 },
    title: 'BOSTON',
    subtitle: 'North is at the back.  Map scale: 1 foot = about a quarter of a mile.  Warm ground was dry land in 1630.  Pale ground is landfill.',
  });

  // --- The Charles, the harbour and the channel. Everything south-west of the dashed line was water.
  const charlesSouth = c.geo([[42.3530, -71.1100], [42.3510, -71.1000], [42.3530, -71.0910], [42.3545, -71.0840], [42.3560, -71.0780], [42.3585, -71.0720], [42.3625, -71.0712], [42.3665, -71.0690], [42.3682, -71.0640], [42.3685, -71.0590], [42.3685, -71.0545], [42.3660, -71.0505], [42.3625, -71.0490], [42.3580, -71.0490], [42.3550, -71.0500], [42.3520, -71.0525], [42.3470, -71.0555], [42.3400, -71.0590], [42.3320, -71.0620]], 5);
  const mainland = c.land([...charlesSouth, [-8.1, 6.6], [-8.1, charlesSouth[0][1]]].map((p) => p));
  const south = c.geo([[42.3320, -71.0590], [42.3400, -71.0555], [42.3470, -71.0520], [42.3510, -71.0480], [42.3530, -71.0440], [42.3510, -71.0380], [42.3490, -71.0330], [42.3470, -71.0280]], 5);
  const southBoston = c.land([...south, [8.1, 6.6]]);
  const northShore = c.geo([[42.3610, -71.1100], [42.3600, -71.1000], [42.3590, -71.0930], [42.3610, -71.0850], [42.3630, -71.0790], [42.3680, -71.0750], [42.3715, -71.0660], [42.3715, -71.0600], [42.3712, -71.0560], [42.3735, -71.0510], [42.3790, -71.0480], [42.3830, -71.0430]], 5);
  const northLand = c.land([...northShore, [northShore[northShore.length - 1][0], -6.6], [-8.1, -6.6]]);
  const east = c.geo([[42.3830, -71.0340], [42.3760, -71.0400], [42.3710, -71.0410], [42.3660, -71.0370], [42.3630, -71.0300], [42.3620, -71.0250]], 5);
  const eastBoston = c.land([...east, [8.1, -6.6]]);

  // The peninsula the first English settlers found: almost an island, joined by a neck of land a
  // few yards wide. Roughly drawn, and the whole reason the model exists.
  const shawmut = c.geo([[42.3380, -71.0720], [42.3425, -71.0690], [42.3465, -71.0675], [42.3520, -71.0690], [42.3585, -71.0700], [42.3620, -71.0680], [42.3650, -71.0610], [42.3680, -71.0575], [42.3672, -71.0525], [42.3625, -71.0520], [42.3590, -71.0530], [42.3560, -71.0555], [42.3510, -71.0600], [42.3440, -71.0645], [42.3380, -71.0680]], 4);
  c.ground(mainland, '#8f979a');
  c.ground(shawmut, '#c4a878');
  c.line([...shawmut, shawmut[0]], 0.05, '#f4f1e6', { dash: [0.14, 0.09], keep: true });
  c.ground(northLand, '#8e8b84');
  c.ground(southBoston, '#8f979a');
  c.ground(eastBoston, '#8e8b84');

  // --- Parks. The Common is the oldest public park in America, and the Garden beside it was marsh.
  const common = c.geo([[42.3575, -71.0663], [42.3564, -71.0620], [42.3537, -71.0628], [42.3527, -71.0663], [42.3548, -71.0692]]);
  c.park(common, { trees: 24, treeH: 0.28, color: '#7da858', paths: [c.geo([[42.3575, -71.0663], [42.3527, -71.0640]]), c.geo([[42.3564, -71.0620], [42.3537, -71.0680]])] });
  const garden = c.geo([[42.3560, -71.0695], [42.3535, -71.0690], [42.3518, -71.0702], [42.3528, -71.0725], [42.3553, -71.0728]]);
  c.park(garden, { trees: 16, treeH: 0.27, color: '#86b05e' });
  const [lagX, lagZ] = c.at(42.3540, -71.0706);
  c.paintOver((ctx) => { ctx.fillStyle = '#4a93ba'; ctx.beginPath(); ctx.ellipse(lagX, lagZ, 0.3, 0.1, 0.1, 0, TAU); ctx.fill(); });
  // The Esplanade, a strip of green along the river.
  c.park(bandFrom(c, [[42.3535, -71.0900], [42.3552, -71.0830], [42.3567, -71.0775], [42.3595, -71.0728], [42.3625, -71.0722]], 0.2, 1), { trees: 22, treeH: 0.24, color: '#7da858' });
  // Commonwealth Avenue: a boulevard copied from Paris, built on the fill.
  const comm = c.geo([[42.3530, -71.0728], [42.3515, -71.0790], [42.3500, -71.0850], [42.3490, -71.0905]]);
  c.road(comm, 0.2, { color: '#7da858', edge: '#6f6c66' });
  c.avenueTrees(comm, 0.2, 0.17, 0.05);
  const boylston = c.geo([[42.3528, -71.0640], [42.3517, -71.0715], [42.3497, -71.0770], [42.3470, -71.0875], [42.3460, -71.0950]]);
  c.road(boylston, 0.09);
  c.road(c.geo([[42.3485, -71.0805], [42.3440, -71.0830], [42.3380, -71.0880]]), 0.09);
  c.road(c.geo([[42.3380, -71.0730], [42.3480, -71.0640], [42.3530, -71.0625], [42.3580, -71.0580], [42.3640, -71.0570]]), 0.08);

  // --- The Freedom Trail. A red line in the pavement in real life and a red line here.
  const trail = c.geo([[42.3555, -71.0640], [42.3580, -71.0635], [42.3572, -71.0620], [42.3580, -71.0600], [42.3570, -71.0589], [42.3587, -71.0573], [42.3600, -71.0561], [42.3637, -71.0537], [42.3663, -71.0544], [42.3672, -71.0563], [42.3690, -71.0590]], 3);
  c.line(trail, 0.05, '#c4312c', { keep: true });
  const trail2 = c.geo([[42.3715, -71.0585], [42.3725, -71.0575], [42.3740, -71.0595], [42.3764, -71.0607]], 3);
  c.line(trail2, 0.05, '#c4312c', { keep: true });

  // --- Landmarks first.
  const P = (la, lo) => c.at(la, lo);
  const [shX, shZ] = P(42.3588, -71.0638); stateHouse(c, shX, shZ);
  const [onX, onZ] = P(42.3663, -71.0544); steepleChurch(c, onX, onZ, { yaw: -0.7, s: 1.15 });
  steepleChurch(c, ...P(42.3567, -71.0622), { yaw: 0.2, s: 0.8 });
  const [bhX, bhZ] = P(42.3764, -71.0607); bunkerHill(c, bhX, bhZ);
  const [faX, faZ] = P(42.3600, -71.0553); faneuilHall(c, faX, faZ, 1.3);
  const [hkX, hkZ] = P(42.3492, -71.0753); hancock(c, hkX, hkZ);
  const [puX, puZ] = P(42.3472, -71.0825); prudential(c, puX, puZ);
  const [chX, chZ] = P(42.3590, -71.0525); customHouse(c, chX, chZ);
  const [trX, trZ] = P(42.3499, -71.0740); trinity(c, trX, trZ);
  const [fwX, fwZ] = P(42.3467, -71.0972); fenway(c, fwX, fwZ, 0.65);
  const [mitX, mitZ] = P(42.3596, -71.0921);
  const mit = c.frame(mitX, mitZ, { yaw: 0.2 }).reserve(0.86, 0.5);
  mit.block(0, 0, 0, 0.84, 0.2, 0.3, 0xcfc8b5);
  mit.cyl(0, 0.2, 0, 0.13, 0.14, 0.09, 0xcfc8b5, 12);
  mit.dome(0, 0.29, 0, 0.13, 0.12, 0xb9b6ad, 12);

  // --- The city. Crooked and old on the peninsula; ruled and new on the fill.
  const towers = P(42.3560, -71.0570);
  const brick = [0x9a5a44, 0xa8674c, 0x8c5240, 0xb07a5c, 0x8f6a54, 0xa9937c];
  const stone = [0xa6a092, 0xb5ad9b, 0x8f97a0, 0x7f9db4];
  const onPeninsula = (x, z) => inPoly(shawmut, x, z);
  const tallness = (x, z) => gauss(x, z, towers[0], towers[1], 0.85);
  c.fill({
    poly: mainland, where: onPeninsula, yaw: 0.45, lot: [0.2, 0.17], every: [3, 2], street: [0.055, 0.05], warp: 0.2, warpF: 1.0, turn: 0.7, seed: 21,
    h: (x, z, rng) => (0.17 + rng() * 0.12 + 1.5 * tallness(x, z) * (0.3 + rng() * 0.9)),
    color: (x, z, rng) => (rng() < tallness(x, z) * 0.9 ? pick(rng, stone) : pick(rng, brick)),
    style: (x, z, height, rng) => (height < 0.3 && rng() < 0.5 ? 'gable' : 'flat'),
    roof: (x, z, rng) => pick(rng, [0x4c463f, 0x5a5146, 0x665c50]),
  });
  // The Back Bay was filled from the 1850s and laid out on a plan, so it runs dead straight.
  c.fill({
    poly: mainland, yaw: 0.26, lot: [0.2, 0.19], every: [3, 2], street: [0.06, 0.07], anchor: P(42.3515, -71.0790), seed: 22,
    h: (x, z, rng) => 0.2 + rng() * 0.14,
    color: (x, z, rng) => pick(rng, brick),
    skip: 0.02,
  });
  const low = [0x8c8074, 0x978c7e, 0x80766c, 0xa09486, 0x8a7a6c, 0x7d7f80];
  const outer = { lot: [0.22, 0.19], every: [3, 2], street: [0.065, 0.055], warp: 0.12, warpF: 0.5, turn: 0.2, skip: 0.07, h: (x, z, rng) => 0.13 + rng() * 0.15, color: (x, z, rng) => pick(rng, low) };
  c.fill({ ...outer, poly: northLand, yaw: 0.3, seed: 23 });
  c.fill({ ...outer, poly: southBoston, yaw: -0.15, seed: 24, h: (x, z, rng) => 0.16 + rng() * 0.3 });
  c.fill({ ...outer, poly: eastBoston, yaw: 0.1, seed: 25 });

  // --- Bridges and boats.
  const lf = [P(42.3610, -71.0716), P(42.3625, -71.0795)];
  c.bridge(lf[0], lf[1], { width: 0.14, piers: 4, rise: 0.04, color: 0xa39d90 });
  // The Longfellow's towers are nicknamed the salt and pepper shakers.
  const lfYaw = Math.atan2(lf[1][0] - lf[0][0], lf[1][1] - lf[0][1]);
  for (const t of [0.42, 0.58]) {
    const salt = c.frame(lf[0][0] + (lf[1][0] - lf[0][0]) * t, lf[0][1] + (lf[1][1] - lf[0][1]) * t, { yaw: lfYaw });
    for (const side of [-1, 1]) {
      salt.cyl(side * 0.095, -0.06, 0, 0.03, 0.04, 0.2, 0xb5aea0, 8);
      salt.dome(side * 0.095, 0.14, 0, 0.033, 0.05, 0x8d877c, 8);
    }
  }
  c.bridge(P(42.3545, -71.0920), P(42.3590, -71.0935), { width: 0.11, piers: 4, rise: 0.03, color: 0x8b8f92 });
  zakim(c, P(42.3690, -71.0632), P(42.3722, -71.0640));
  c.bridge(P(42.3686, -71.0592), P(42.3716, -71.0586), { width: 0.1, piers: 1, rise: 0.02 });
  c.bridge(P(42.3530, -71.0530), P(42.3510, -71.0492), { width: 0.08, piers: 1, rise: 0.02 });
  ironsides(c, ...P(42.3705, -71.0545), 1.35);
  for (const [la, lo, yw] of [[42.3665, -71.0505, 1.05], [42.3640, -71.0495, 1.45], [42.3615, -71.0492, 1.57], [42.3590, -71.0492, 1.57], [42.3565, -71.0495, 1.9]]) {
    const [px, pz] = c.at(la, lo);
    c.pier(px, pz, yw, 0.42, 0.1);
  }
  c.boat(...P(42.3640, -71.0440), 1.2, 0.38, 0xe8e2d4, 0x31506b);
  // Small sailing boats on the Charles, and one of them sailing.
  const sail = (f) => {
    f.box(0, 0, 0, 0.05, 0.03, 0.17, 0xf2ece0);
    f.cyl(0, 0.03, 0, 0.003, 0.004, 0.24, 0x54402c, 3);
    f.bar([0, 0.26, 0.002], [0, 0.04, -0.07], 0.0015, 0xf4f0e6, 3);
    f.city.b.add(triangleSail(), 0xf7f3ea, { position: f.p(0, 0.04, 0) });
  };
  c.mover(sail, c.geo([[42.3567, -71.1010], [42.3570, -71.0940], [42.3592, -71.0860], [42.3612, -71.0790]], 5), { speed: 0.18 });
  for (const [la, lo, yw] of [[42.3572, -71.0880, 0.9], [42.3580, -71.0820, 2.0], [42.3598, -71.0772, 0.2]]) {
    sail(c.frame(...P(la, lo), { yaw: yw, y: 0.77 }));
  }

  // --- Words.
  c.waterText_('CHARLES RIVER', c.geo([[42.3545, -71.1060], [42.3556, -71.0950]]), 0.2);
  c.waterText_('BOSTON HARBOR', c.geo([[42.3575, -71.0450], [42.3580, -71.0330]]), 0.3);
  c.label('Massachusetts State House', shX - 0.2, shZ + 0.5, 1.15);
  c.label('Old North Church', onX, onZ + 0.42, 1.15);
  c.label('Bunker Hill Monument', bhX, bhZ + 0.62, 0.6);
  c.label('USS Constitution', ...P(42.3695, -71.0528), 0.62);
  c.label('Faneuil Hall', faX + 0.32, faZ + 0.45, 0.68);
  c.label('Old John Hancock Tower', hkX + 0.15, hkZ + 0.5, 1.75);
  c.label('Prudential Tower', puX - 0.5, puZ + 0.62, 1.5);
  c.label('Fenway Park', fwX, fwZ + 0.76, 0.3);
  c.label('Boston Common', ...P(42.3535, -71.0635), 0.5);
  c.label('Back Bay: all landfill', ...P(42.3495, -71.0875), 0.72);
  c.label('Shore in 1630 (dashed)', ...P(42.3495, -71.0645), 0.55);
  c.label('Freedom Trail (red)', ...P(42.3625, -71.0560), 1.08);
  c.landText_('CAMBRIDGE', c.geo([[42.3660, -71.1050], [42.3680, -71.0900]]), 0.26, 'rgba(255,250,235,0.62)');
  return c.finish();
}

// A strip of ground on one side of a line, as a closed outline.
function bandFrom(c, points, width, side) {
  const a = c.geo(points, 3);
  const b = a.map((p, i) => {
    const prev = a[Math.max(0, i - 1)]; const next = a[Math.min(a.length - 1, i + 1)];
    const dx = next[0] - prev[0]; const dz = next[1] - prev[1]; const L = Math.hypot(dx, dz) || 1;
    return [p[0] + (dz / L) * side * width, p[1] - (dx / L) * side * width];
  });
  return [...a, ...b.reverse()];
}

function triangleSail() {
  const g = new THREE.BufferGeometry();
  // Both faces, since a sail has no back.
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.02, 0, 0, -0.1, 0, 0.22, 0.01, 0, 0, -0.1, 0, 0, 0.02, 0, 0.22, 0.01], 3));
  g.computeVertexNormals();
  return g;
}

export const BUILDERS = {
  'new-york-diorama': newYorkCity,
  'boston-diorama': boston,
};
