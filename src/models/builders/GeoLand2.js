import * as THREE from 'three';
import {
  terrainBlock, Batch, signs, addPalm, addBroadleaf, addPine, addHouse, addCrown, blobGeometry, seededRandom,
  rgb, mixc, shade, clamp01, sstep, mix, noise2, fbm, ridged, smoothPath, pathDistance, sampledField, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard } from '../../PropKit.js';
import { tube } from '../ModelKit.js';

// More of the World Geography landscapes: the Grand Canyon, the Sahara, a Norwegian fjord, a Pacific
// atoll, the Amazon and the Philippine rice terraces. See geo/GeoKit.js.

// ---------------------------------------------------------------------------------------------
// The Grand Canyon. Its cliffs and slopes come from one table, because that is the real reason it
// looks the way it does: hard layers stand as cliffs and soft ones wear back into slopes.
// ---------------------------------------------------------------------------------------------
const CANYON_LAYERS = [
  // top y, horizontal run in feet, colour, name
  { top: 2.5, run: 0.38, c: [62, 52, 56], name: 'Vishnu Schist' },
  { top: 2.76, run: 0.1, c: [120, 92, 70], name: 'Tapeats Sandstone' },
  { top: 3.32, run: 1.05, c: [136, 138, 104], name: 'Bright Angel Shale' },
  { top: 3.52, run: 0.1, c: [142, 126, 100], name: 'Muav Limestone' },
  { top: 4.34, run: 0.2, c: [168, 88, 62], name: 'Redwall Limestone' },
  { top: 5.08, run: 0.72, c: [176, 94, 66], name: 'Supai Group' },
  { top: 5.4, run: 0.38, c: [158, 76, 56], name: 'Hermit Shale' },
  { top: 5.86, run: 0.1, c: [226, 208, 170], name: 'Coconino Sandstone' },
  { top: 6.12, run: 0.3, c: [190, 170, 132], name: 'Toroweap Formation' },
  { top: 6.5, run: 0.1, c: [214, 202, 174], name: 'Kaibab Limestone' },
];
const CANYON_FLOOR = 1.5;

function buildGrandCanyon() {
  const W = 16; const D = 12;
  const rimY = CANYON_LAYERS[CANYON_LAYERS.length - 1].top;
  // It runs front to back, so the block's cut face is the canyon's own profile. Looking down it this
  // way is looking east, the way the river's course is usually mapped, so north is to the left.
  const centre = (z) => 0.75 * Math.sin(z * 0.46 + 0.6) + 0.34 * Math.sin(z * 1.07 + 2.1);
  // Side canyons come in from the rim, each a wedge that deepens toward the river.
  const SIDE = [[-4.3, -1, 0.25], [-1.6, 1, -0.3], [1.0, -1, 0.3], [3.7, 1, 0.2], [-4.2, 1, 0.3]];
  const dist = (x, z) => {
    const c = centre(z);
    const across = Math.abs(x - c);
    let d = across * (1 + 0.28 * fbm(x * 0.7 + 3, z * 0.7, 3, 14)) + 0.16 * fbm(x * 2.2, z * 2.2, 3, 2);
    for (const [sz, side, lean] of SIDE) {
      if (Math.sign(x - c) !== side) continue;
      const lat = Math.abs(z - sz - lean * across - 0.2 * Math.sin(across * 1.6)) * 1.25;
      const s = lat + Math.max(0, across - 0.9) * 0.62 + 0.62;
      d = -Math.log(Math.exp(-d * 5) + Math.exp(-s * 5)) / 5; // a smooth minimum, so the walls bend round
    }
    return Math.max(0, d);
  };
  const rw = 0.26;
  const height = (x, z) => {
    let d = dist(x, z) - rw;
    if (d < 0) return mix(CANYON_FLOOR, CANYON_FLOOR + 0.5, 1 + d / rw);
    let y = CANYON_FLOOR + 0.5;
    for (const layer of CANYON_LAYERS) {
      const rise = layer.top - y;
      if (d < layer.run) return y + rise * (d / layer.run);
      d -= layer.run; y = layer.top;
    }
    return rimY + 0.05 * fbm(x * 0.8, z * 0.8, 2, 8);
  };
  const fine = (x, z) => {
    const y = height(x, z);
    return y + 0.022 * fbm(x * 9, z * 9, 3, 3) + 0.009 * Math.sin(y * 90 + fbm(x * 2, z * 2, 2, 5) * 6);
  };
  const rockAt = (x, z, y) => {
    let prev = CANYON_FLOOR;
    const wob = 0.018 * noise2(x * 1.4, z * 1.4, 2);
    for (const layer of CANYON_LAYERS) {
      if (y + wob <= layer.top) {
        const f = (y + wob - prev) / (layer.top - prev);
        const beds = Math.sin(f * 40 + noise2(x, z, 4) * 3) * 6;
        return [layer.c[0] + beds, layer.c[1] + beds, layer.c[2] + beds];
      }
      prev = layer.top;
    }
    return CANYON_LAYERS[CANYON_LAYERS.length - 1].c;
  };
  const paint = (x, z, y, slope) => {
    let c = rockAt(x, z, y);
    const n = fbm(x * 3.1, z * 3.1, 3, 7) * 0.5 + 0.5;
    c = mixc(c, shade(c, 0.82), n);
    // Scrub on the flat benches, and juniper and pine dark across the rim.
    if (y > rimY - 0.02) c = mixc(mixc([168, 158, 120], [122, 128, 86], n), [70, 92, 58], sstep(fbm(x * 7, z * 7, 2, 9), 0.1, 0.4) * 0.7);
    else if (slope < 0.8) c = mixc(c, [128, 130, 88], 0.45 * (1 - sstep(slope, 0.25, 0.8)));
    return c;
  };
  const strata = (x, z, y, ground) => rockAt(x, z, y);
  const labels = [
    ['Kaibab Limestone', 6.31], ['Coconino Sandstone', 5.63], ['Supai Group', 4.71], ['Redwall Limestone', 3.93], ['Bright Angel Shale', 3.04], ['Vishnu Schist', 2.15],
  ].map(([text, y]) => ({ text, x: -6.3, y, size: 0.21 }));
  const block = terrainBlock({
    w: W, d: D, plinth: 0.34, nx: 180, nz: 135, height, fine, water: CANYON_FLOOR + 0.3, paint, strata, labels,
    waterPaint: (x, z, depth) => mixc([92, 142, 112], [58, 112, 104], sstep(depth, 0, 0.3)),
    lightAmount: 0.55, relief: 0.4, strip: 420, waterSeed: 3, sectionWater: () => [72, 126, 110],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(211);
  let trees = 0; let guard = 0;
  while (trees < 70 && guard < 1800) {
    guard += 1;
    const x = -7.7 + rng() * 15.4; const z = -5.7 + rng() * 11.4;
    if (height(x, z) < rimY - 0.04) continue;
    addPine(batch, x, height(x, z), z, 0.28 + rng() * 0.16, rng, 0x3f6a45);
    trees += 1;
  }
  const at = (x, z, y) => ({ x, z, y, ground: height(x, z) });
  signs(root, batch, [
    { text: 'Colorado River', x: centre(1.2), z: 1.2, y: 3.1, ground: CANYON_FLOOR + 0.3 },
    { text: 'North Rim', ...at(-6.2, -2.0, 7.3) },
    { text: 'South Rim', ...at(6.2, -2.0, 7.3) },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// The Sahara. Crescent dunes on the sand sea, and an oasis in the one place the ground dips to the
// water table. The cut face runs through the pool so the water can be followed underground.
// ---------------------------------------------------------------------------------------------
function addCamel(batch, x, y, z, s, yaw, rng) {
  const c = Math.cos(yaw); const k = Math.sin(yaw);
  const P = (lx, ly, lz) => [x + lx * c * s + lz * k * s, y + ly * s, z - lx * k * s + lz * c * s];
  const coat = 0x8a5f34;
  batch.add(blobGeometry(rng, 1, 0.03), coat, { position: P(0, 0.62, 0), scale: [0.42 * s, 0.2 * s, 0.17 * s], rotation: [0, yaw, 0] });
  batch.add(blobGeometry(rng, 1, 0.03), 0x7a5229, { position: P(0, 0.84, 0), scale: [0.18 * s, 0.15 * s, 0.12 * s] });
  batch.add(tube([P(0.34, 0.68, 0), P(0.5, 0.86, 0), P(0.56, 1.04, 0)], [0.07 * s, 0.05 * s, 0.05 * s], { sides: 6, steps: 5 }), coat);
  batch.add(blobGeometry(rng, 1, 0.02), coat, { position: P(0.65, 1.05, 0), scale: [0.13 * s, 0.06 * s, 0.06 * s], rotation: [0, yaw, 0] });
  for (const [lx, lz] of [[0.28, 0.1], [0.28, -0.1], [-0.3, 0.1], [-0.3, -0.1]]) {
    batch.add(tube([P(lx, 0.55, lz), P(lx, 0.02, lz)], [0.045 * s, 0.03 * s], { sides: 5, steps: 2, straight: true }), 0x7a5229);
  }
}

function buildSahara() {
  const W = 16; const D = 12; const TABLE = 2.3;
  const oasis = [1.6, 4.3];
  const toOasis = (x, z) => Math.hypot(x - oasis[0], (z - oasis[1]) * 1.15);
  // A crescent dune is steep on its downwind face. So: a sawtooth along the wind, rounded at the
  // crest, whose phase and height wander so no ridge runs straight across the block.
  const dune = (x, z, wave, seed) => {
    const warp = 1.25 * fbm(x * 0.14 + seed, z * 0.28, 3, seed);
    const u = (x + warp * 2.1 + 0.55 * Math.sin(z * 0.62 + seed)) / wave + 3;
    const t = u - Math.floor(u);
    const body = t < 0.74 ? Math.pow(t / 0.74, 1.25) : 1 - sstep(t, 0.74, 0.98);
    return body;
  };
  const height = (x, z) => {
    const swell = 0.75 + 0.85 * (fbm(x * 0.2, z * 0.26, 3, 6) * 0.5 + 0.5);
    let y = TABLE + 0.5 + 1.05 * swell * dune(x, z, 4.6, 1) + 0.22 * dune(x + 1.4, z, 1.9, 7) * swell;
    const r = toOasis(x, z);
    const near = 1 - sstep(r, 1.5, 3.9);
    y = mix(y, TABLE + 0.24 + 0.04 * fbm(x * 2, z * 2, 2, 4), near);
    if (r < 1.65) y = mix(TABLE - 0.42, y, sstep(r, 0.98, 1.65));
    return y;
  };
  const paint = (x, z, y, slope) => {
    const n = fbm(x * 0.8, z * 0.8, 3, 3) * 0.5 + 0.5;
    let c = mixc([232, 176, 102], [214, 146, 76], n);
    const r = toOasis(x, z);
    // Wind ripples run across the slope, and go away where sand is sliding on the steep face.
    const ripple = Math.sin((x * 0.86 + z * 0.5) * 38 + fbm(x * 1.6, z * 1.6, 2, 9) * 9) * 7 * (1 - sstep(slope, 0.5, 0.9));
    c = [c[0] + ripple, c[1] + ripple, c[2] + ripple * 0.7];
    if (r < 3.7) {
      const green = 1 - sstep(r + fbm(x * 2.2, z * 2.2, 3, 5) * 0.7, 1.45, 2.65);
      c = mixc(c, mixc([104, 118, 58], [72, 112, 56], n), green);
      c = mixc(c, [152, 134, 88], 1 - sstep(r, 1.08, 1.42));
    }
    return c;
  };
  const strata = (x, z, y, ground) => {
    const wob = 0.09 * Math.sin(x * 0.6) + 0.05 * noise2(x * 2.3, 1, 5);
    if (y > TABLE + 0.42 + wob) {
      const beds = Math.sin(y * 34 + x * 2.6) * 5;
      return [224 + beds, 170 + beds, 100 + beds * 0.7];
    }
    if (y > 1.06 + wob) {
      // Sandstone with water held in its pores, drawn as flecks of blue in the grain.
      const fleck = noise2(x * 26, y * 34, 8) > 0.4 ? 1 : 0;
      return mixc(mixc([116, 138, 148], [96, 122, 140], noise2(x * 5, y * 9, 2) * 0.5 + 0.5), [62, 124, 176], fleck * 0.8);
    }
    return mixc([92, 72, 62], [112, 88, 70], noise2(x * 7, y * 20, 2) * 0.5 + 0.5);
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.32, nx: 156, nz: 117, height, water: TABLE, paint, strata, lightAmount: 0.42, relief: 0.2, strip: 340,
    sectionWater: () => [54, 136, 150],
    waterPaint: (x, z, depth) => mixc([92, 164, 148], [34, 112, 132], sstep(depth, 0, 0.3)),
    labels: [
      { text: 'Dry sand', x: -6.4, y: TABLE + 0.34 },
      { text: 'Rock full of underground water', x: -3.2, y: 1.75 },
      { text: 'Hard rock the water cannot pass', x: -3.2, y: 0.74 },
    ],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(19);
  let palms = 0; let guard = 0;
  while (palms < 26 && guard < 800) {
    guard += 1;
    const a = rng() * TAU; const r = 1.2 + rng() * 1.45;
    const x = oasis[0] + Math.cos(a) * r; const z = oasis[1] + Math.sin(a) * r / 1.15;
    if (z > 5.85 || height(x, z) < TABLE + 0.03) continue;
    addPalm(batch, x, height(x, z), z, 0.62 + rng() * 0.42, rng, { frond: 0x4a8a3c, fronds: 7 });
    palms += 1;
  }
  for (const [ox, oz, w, d, h] of [[-1.35, 3.7, 0.5, 0.42, 0.32], [-1.0, 3.1, 0.42, 0.36, 0.26], [-1.75, 3.05, 0.38, 0.42, 0.3], [-0.45, 2.6, 0.4, 0.34, 0.27], [2.25, 2.9, 0.46, 0.4, 0.3]]) {
    const x = oasis[0] + ox; const z = oasis[1] + oz - 3.2;
    const y = height(x, z);
    batch.add(new THREE.BoxGeometry(w, h + 0.1, d), 0xc08f60, { position: [x, y + h / 2 - 0.03, z], rotation: [0, 0.25, 0] });
    batch.add(new THREE.BoxGeometry(w * 0.3, h * 0.55, 0.012), 0x4a3424, { position: [x + 0.05, y + h * 0.27, z + d / 2 + 0.01], rotation: [0, 0.25, 0] });
  }
  // A caravan coming down off the sand toward the water, single file.
  for (let i = 0; i < 5; i += 1) {
    const x = -4.9 + i * 0.86; const z = 1.2 + i * 0.36;
    addCamel(batch, x, height(x, z) - 0.02, z, 0.72, -0.4, rng);
  }
  const at = (x, z, y) => ({ x, z, y, ground: height(x, z) });
  signs(root, batch, [
    { text: 'Oasis', ...at(oasis[0] - 0.2, 2.1, 3.65) },
    { text: 'Steep side away from the wind', ...at(-3.4, -3.6, 5.2) },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// A Norwegian fjord. Above the water it is a canyon; the cut face at the front shows the part nobody
// sees, the deep U of the old glacier's valley running on below sea level.
// ---------------------------------------------------------------------------------------------
function buildFjord() {
  const W = 16; const D = 12; const SEA = 3.1;
  const axis = (z) => 0.95 * Math.sin(z * 0.44 + 0.7) + 0.35 * Math.sin(z * 1.05);
  const half = (z) => 1.75 + 0.3 * (z + 6) / 12 + 0.1 * Math.sin(z * 1.3);
  const coarse = (x, z) => {
    const q = (x - axis(z)) / half(z);
    const aq = Math.abs(q);
    // The U: a flat floor, walls curving up to vertical, then the shoulder where the ice stopped.
    const sillRise = 1.05 * Math.exp(-(((z - 3.9) / 0.95) ** 2));
    const floor = 1.05 + sillRise;
    const u = floor + (SEA + 2.1 - floor) * Math.pow(Math.min(aq, 1.6) / 1.6, 2.5);
    const plateau = SEA + 2.0 + 0.8 * (ridged(x * 0.23 + 4, z * 0.23, 4, 22) - 0.25) + 0.4 * sstep(Math.abs(x), 4, 8);
    let y = mix(u, plateau, sstep(aq, 1.35, 2.0));
    // A hanging valley: a side valley whose small glacier never cut as deep as the main one, so it
    // runs in from the left and simply stops in mid-air high on the wall.
    const floorH = SEA + 1.05 + (-x - 3) * 0.1;
    const across = Math.abs(z + 0.8 + 0.2 * Math.sin(x));
    if (x < axis(z) - half(z) * 1.05) y = Math.min(y, mix(floorH, y, sstep(across, 0.28, 1.0)));
    // A low green shelf at the head of the water, the one place flat enough to build on.
    const shelfQ = Math.hypot((x + 3.0) / 1.25, (z + 5.4) / 0.85);
    if (shelfQ < 1.6) y = mix(SEA + 0.16 + 0.05 * shelfQ, y, sstep(shelfQ, 0.85, 1.6));
    return y;
  };
  const shelf = (x, z) => coarse(x, z);
  const fine = (x, z) => {
    const y = coarse(x, z);
    const steep = sstep(y, SEA - 0.1, SEA + 0.5);
    return y + steep * (0.06 * (ridged(x * 3.1, z * 1.1, 4, 18) - 0.4) + 0.02 * fbm(x * 13, z * 13, 2, 6));
  };
  const falls = [[axis(-0.8) - half(-0.8) * 1.15, -0.8], [axis(-3) + half(-3) * 1.1, -3], [axis(2.4) + half(2.4) * 1.1, 2.4]];
  const paint = (x, z, y, slope) => {
    const n = fbm(x * 2.4, z * 2.4, 4, 3) * 0.5 + 0.5;
    const rock = mixc([98, 100, 104], [132, 130, 128], n);
    const a = y - SEA;
    const birch = mixc([62, 104, 58], [88, 124, 62], fbm(x * 5, z * 5, 3, 9) * 0.5 + 0.5);
    let c = rock;
    const green = (1 - sstep(a, 0.8, 1.7)) * (1 - sstep(slope, 2.6, 4.6));
    c = mixc(c, birch, green);
    c = mixc(c, mixc([120, 124, 86], [146, 136, 92], n), sstep(a, 1.7, 2.1) * (1 - sstep(slope, 0.8, 1.6)) * (1 - sstep(a, 2.4, 3)));
    const snow = sstep(a + 0.75 * fbm(x * 1.1, z * 1.1, 3, 5), 2.05, 2.5) * (1 - sstep(slope, 1.35, 2.3));
    c = mixc(c, [244, 246, 250], snow);
    // Pale wet streaks below each snowfield. They are the falls, seen as what they do to the rock.
    for (const [fx, fz] of falls) {
      const d = Math.abs(z - fz + 0.1 * Math.sin(a * 5)) * 7;
      if (d < 1 && a > 0 && a < 1.2 && Math.abs(x - fx) < 1.1) c = mixc(c, [238, 243, 246], (1 - d) * 0.92);
    }
    if (a < 0.08) c = mixc(c, [96, 92, 80], 1 - sstep(a, 0.02, 0.08));
    return c;
  };
  const strata = (x, z, y, ground) => {
    if (ground - y < 0.035) return [66, 70, 66];
    const n = noise2(x * 4, y * 9, 5) * 0.5 + 0.5;
    return mixc([98, 94, 92], [122, 116, 112], n);
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.32, nx: 180, nz: 135, height: coarse, fine, water: SEA, paint, strata, lightAmount: 0.7, relief: 0.55, strip: 440,
    waterPaint: (x, z, depth) => mixc([70, 134, 138], [20, 62, 86], sstep(depth, 0, 0.6)),
    labels: [
      { text: 'Solid rock', x: -6.0, y: 1.2 },
      { text: 'The valley the glacier carved, now full of sea', x: axis(6), y: 1.85, size: 0.21 },
    ],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(45);
  // A village on the green shelf at the head, red and white, with its one ferry.
  for (const [x, z, wall, roof, yaw] of [
    [-2.78, -5.15, 0xb4372c, 0x45403a, 0.2], [-2.45, -5.4, 0xece6da, 0x4a4239, -0.3], [-3.15, -5.45, 0xb4372c, 0x46423a, 0.5],
    [-2.8, -5.68, 0xdcae52, 0x45403a, 0.1], [-3.4, -5.1, 0xece6da, 0x4a4239, 0.3], [-3.5, -5.7, 0xb4372c, 0x46423a, -0.2],
  ]) {
    addHouse(batch, x, shelf(x, z), z, 0.34, 0.25, 0.19, wall, roof, yaw);
  }
  const hull = new THREE.SphereGeometry(1, 10, 6);
  const fx = axis(0.9) + 0.25; const fz = 0.9;
  batch.add(hull, 0x24303c, { position: [fx, SEA + 0.03, fz], scale: [0.17, 0.08, 0.68] });
  batch.add(new THREE.BoxGeometry(0.2, 0.15, 0.72), 0xf0ece2, { position: [fx, SEA + 0.15, fz] });
  batch.add(new THREE.BoxGeometry(0.14, 0.09, 0.34), 0xf0ece2, { position: [fx, SEA + 0.26, fz + 0.07] });
  batch.add(new THREE.CylinderGeometry(0.035, 0.04, 0.12, 8), 0xc23a2a, { position: [fx, SEA + 0.36, fz - 0.15] });
  let trees = 0; let guard = 0;
  while (trees < 56 && guard < 1800) {
    guard += 1;
    const x = -7.7 + rng() * 15.4; const z = -5.7 + rng() * 11.4;
    const y = coarse(x, z);
    if (y < SEA + 0.12 || y > SEA + 1.2) continue;
    if (Math.hypot(coarse(x + 0.1, z) - y, coarse(x, z + 0.1) - y) > 0.26) continue;
    addPine(batch, x, y, z, 0.26 + rng() * 0.12, rng, 0x2f5f3b);
    trees += 1;
  }
  // Waterfalls, each a thin ribbon laid down the wall from the lip of its shelf to the sea. The one
  // from the hanging valley is the point of the feature: the side valley simply ends in the air.
  for (const [fz, side] of [[-0.8, -1], [-3, 1], [2.4, 1]]) {
    const pts = [];
    for (let i = 0; i <= 26; i += 1) {
      const x = axis(fz) + side * half(fz) * (1.62 - (i / 26) * 0.72);
      const y = coarse(x, fz);
      if (y <= SEA + 0.01 || y > SEA + 1.8) continue;
      pts.push([x + side * 0.012, y + 0.025, fz]);
    }
    if (pts.length > 2) batch.add(tube(pts, 0.05, { sides: 5, steps: pts.length * 2 }), 0xf2f6f8);
  }
  const at = (x, z, y) => ({ x, z, y, ground: coarse(x, z) });
  signs(root, batch, [
    { text: 'Hanging valley', x: -5.6, z: -0.8, y: SEA + 2.45, ground: coarse(-5.6, -0.8) },
    { text: 'Sill: the shallow mouth', x: axis(3.9), z: 3.9, y: SEA + 0.8, ground: SEA },
    { text: 'Fjord village', x: -3.0, z: -5.75, y: shelf(-3.0, -5.75) + 0.9, ground: shelf(-3.0, -5.75) },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// A coral atoll, cut through its centre. Half a ring of islands on top, and in the cut face the
// volcano that sank with the reef growing up on it, which is the whole point of Darwin's idea.
// ---------------------------------------------------------------------------------------------
function buildAtoll() {
  const W = 15; const D = 8.5; const SEA = 5.4;
  const cz = D / 2 - 0.05;
  const ringR = (a) => 4.75 + 0.28 * Math.sin(a * 3 + 1) + 0.16 * Math.sin(a * 7 + 2) + 0.08 * Math.sin(a * 13);
  const polar = (x, z) => ({ r: Math.hypot(x, z - cz), a: Math.atan2(z - cz, x) });
  const gaps = [-2.45, -1.2, -0.42];
  const isIsland = (a) => {
    let on = 1;
    for (const g of gaps) on = Math.min(on, sstep(Math.abs(a - g), 0.05, 0.11));
    return on;
  };
  const height = (x, z) => {
    const { r, a } = polar(x, z);
    const R = ringR(a);
    const n = 0.04 * fbm(x * 1.7, z * 1.7, 3, 4);
    if (r < R - 0.5) {
      // The lagoon floor, shelving up to the back of the reef.
      return SEA - 0.62 + 0.5 * sstep(r, R - 1.55, R - 0.5) + 0.16 * fbm(x * 1.1, z * 1.1, 3, 9) * (fbm(x * 0.5, z, 2, 2) > 0 ? 1 : 0.2) + n;
    }
    if (r < R + 0.2) {
      const island = isIsland(a);
      const crown = Math.sin(clamp01((r - R + 0.5) / 0.7) * Math.PI);
      return SEA - 0.1 + crown * (0.14 + 0.3 * island) * (0.25 + 0.75 * island) + n * 0.5;
    }
    // The outer wall, falling into deep water far faster than the lagoon does.
    const f = (r - R - 0.2) / 2.5;
    return Math.max(0.55, SEA - 0.06 - 4.9 * Math.pow(clamp01(f), 0.62)) + n * 2;
  };
  const paint = (x, z, y) => {
    const a = y - SEA;
    const n = fbm(x * 5, z * 5, 3, 7) * 0.5 + 0.5;
    if (a < 0) return mixc([232, 222, 186], [190, 186, 158], n);
    const sand = mixc([244, 234, 200], [226, 212, 172], n);
    return mixc(sand, mixc([66, 124, 56], [92, 142, 62], fbm(x * 7, z * 7, 2, 2) * 0.5 + 0.5), sstep(a, 0.08, 0.2));
  };
  const waterPaint = (x, z, depth) => {
    const { r, a } = polar(x, z);
    const R = ringR(a);
    const reef = depth < 0.12 ? 1 - depth / 0.12 : 0;
    if (r < R) {
      const n = fbm(x * 1.4, z * 1.4, 3, 12) * 0.5 + 0.5;
      const c = mixc([136, 226, 212], [44, 178, 190], sstep(depth, 0.05, 0.6) * (0.55 + 0.45 * n));
      return mixc(c, [214, 244, 226], reef * 0.75);
    }
    // Surf on the seaward edge, then a very quick drop to ocean blue.
    const out = r - R;
    const surf = (1 - sstep(out, 0.08 + 0.05 * Math.sin(a * 40), 0.34)) * (0.75 + 0.25 * Math.sin(a * 90 + r * 6));
    return mixc(mixc([42, 142, 186], [14, 56, 116], sstep(out, 0.2, 1.1)), [248, 252, 252], clamp01(surf));
  };
  const strata = (x, z, y, ground) => {
    const r = Math.abs(x);
    // The old volcano: a cone of basalt whose top has sunk well below the reef. Its peak once stood
    // above the sea; everything over it is coral grown since.
    const basaltTop = 3.15 - 0.74 * r + 0.1 * noise2(r * 2.2, x, 3);
    if (y < basaltTop) {
      const hot = noise2(x * 5, y * 6, 5) * 0.5 + 0.5;
      return mixc([44, 40, 46], [66, 58, 62], hot);
    }
    const age = (y - basaltTop) * 3.5 + noise2(x * 0.8, y * 0.8, 8) * 0.4;
    const t = age - Math.floor(age);
    const coral = mixc([206, 196, 164], [222, 212, 184], t < 0.5 ? t * 2 : 2 - t * 2);
    return shade(coral, 0.9 + 0.1 * (noise2(x * 14, y * 14, 2) * 0.5 + 0.5));
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.32, nx: 170, nz: 96, height, water: SEA, paint, waterPaint, strata, lightAmount: 0.28, relief: 0.12, strip: 480,
    labels: [
      { text: 'The old volcano, sunk far below the sea', x: 0, y: 1.7, size: 0.24 },
      { text: 'Coral rock, built up over millions of years', x: 0, y: 4.25, size: 0.24 },
      { text: 'Lagoon', x: 0, y: SEA - 0.32, size: 0.22 },
      { text: 'Open ocean', x: 6.1, y: 3.8, size: 0.22 },
    ],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(64);
  let palms = 0; let guard = 0;
  while (palms < 44 && guard < 1800) {
    guard += 1;
    const a = -Math.PI + rng() * Math.PI; const R = ringR(a) - 0.5 + rng() * 0.62;
    const x = Math.cos(a) * R; const z = cz + Math.sin(a) * R;
    if (Math.abs(x) > 7.3 || z < -4.1 || height(x, z) < SEA + 0.13) continue;
    addPalm(batch, x, height(x, z), z, 0.46 + rng() * 0.24, rng, { fronds: 5, frond: 0x2f8a3c });
    palms += 1;
  }
  for (const [a, r] of [[-1.75, 4.45], [-1.9, 4.5], [-2.0, 4.42], [-1.65, 4.55]]) {
    const x = Math.cos(a) * r; const z = cz + Math.sin(a) * r;
    batch.add(new THREE.BoxGeometry(0.2, 0.16, 0.16), 0xece1c6, { position: [x, height(x, z) + 0.08, z], rotation: [0, a, 0] });
    batch.add(new THREE.ConeGeometry(0.17, 0.14, 4), 0xb9713f, { position: [x, height(x, z) + 0.23, z], rotation: [0, a + 0.8, 0] });
  }
  const at = (x, z, y) => ({ x, z, y, ground: height(x, z) });
  signs(root, batch, [
    { text: 'Low coral islands', ...at(Math.cos(-2.0) * 4.55, cz + Math.sin(-2.0) * 4.55, SEA + 1.35) },
    { text: 'Gap in the reef', x: Math.cos(-0.42) * 4.75, z: cz + Math.sin(-0.42) * 4.75, y: SEA + 0.95, ground: SEA },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// The Amazon's four layers. Not a landscape read from above: it is read from the side, so the trees
// are placed so that the river bank stays open and each layer can be seen through the one before.
// ---------------------------------------------------------------------------------------------
function addMacaw(batch, x, y, z, s, colors, yaw, rng) {
  const c = Math.cos(yaw); const k = Math.sin(yaw);
  const [body, wing, tail] = colors;
  batch.add(blobGeometry(rng, 1, 0.02), body, { position: [x, y, z], scale: [0.09 * s, 0.17 * s, 0.09 * s] });
  batch.add(blobGeometry(rng, 1, 0.02), body, { position: [x, y + 0.2 * s, z], scale: [0.075 * s, 0.075 * s, 0.075 * s] });
  batch.add(new THREE.ConeGeometry(0.03 * s, 0.09 * s, 6), 0x20242a, { position: [x + k * 0.08 * s, y + 0.19 * s, z + c * 0.08 * s], rotation: [Math.PI / 2 + 0.5, yaw, 0] });
  for (const side of [-1, 1]) {
    batch.add(blobGeometry(rng, 1, 0.02), wing, { position: [x + c * side * 0.08 * s, y + 0.01 * s, z - k * side * 0.08 * s], scale: [0.03 * s, 0.15 * s, 0.07 * s], rotation: [0, yaw, 0] });
  }
  batch.add(tube([[x, y - 0.1 * s, z], [x - k * 0.04 * s, y - 0.34 * s, z - c * 0.04 * s], [x - k * 0.05 * s, y - 0.58 * s, z - c * 0.05 * s]], [0.042 * s, 0.03 * s, 0], { sides: 5, steps: 5 }), tail);
}

function buildRainforest() {
  const W = 13; const D = 10; const RIVER = 1.0;
  const bank = (x) => 3.1 + 0.3 * Math.sin(x * 0.7) + 0.12 * Math.sin(x * 1.9);
  const height = (x, z) => {
    const b = bank(x);
    const land = RIVER + 0.42 + 0.14 * fbm(x * 0.8, z * 0.8, 3, 3) + 0.2 * sstep(-z, -1, 5);
    return mix(land, RIVER - 0.36, sstep(z, b - 0.25, b + 0.25));
  };
  const paint = (x, z, y) => {
    const n = fbm(x * 3.3, z * 3.3, 4, 4) * 0.5 + 0.5;
    if (y < RIVER + 0.14) return mixc([146, 118, 82], [118, 96, 66], n);
    const leaf = fbm(x * 12, z * 12, 2, 11) * 0.5 + 0.5;
    return mixc(mixc([74, 56, 36], [104, 78, 44], leaf), [52, 92, 44], sstep(fbm(x * 2.4, z * 2.4, 3, 9), -0.05, 0.3) * 0.65);
  };
  const strata = (x, z, y, ground) => {
    // Rainforest soil is famously thin and poor: a dark skin of leaf-rot over pale leached clay.
    if (ground - y < 0.14) return [40, 30, 22];
    const n = noise2(x * 6, y * 11, 5) * 0.5 + 0.5;
    return mixc([176, 104, 62], [146, 84, 50], n);
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.3, nx: 80, nz: 62, height, water: RIVER, paint, strata, lightAmount: 0.22, relief: 0.3, strip: 170, texW: 1100,
    sectionWater: () => [118, 100, 70],
    waterPaint: (x, z, depth) => mixc([136, 112, 74], [96, 86, 62], sstep(depth, 0, 0.3)), // a "whitewater" Amazon river, the colour of its silt
    labels: [{ text: 'Thin dark soil over poor red clay', x: 0, y: 0.72, size: 0.16 }],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(151);
  const LEAF = { emergent: [0x3e7a33, 0x4d8a38, 0x35702f], canopy: [0x2f7031, 0x377a33, 0x286528, 0x43853a], under: [0x4d9a3f, 0x5aa646, 0x3f8c3a] };
  const trunkTone = 0x8a7558;
  const buttress = (x, y, z, r, h) => {
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * TAU + rng();
      batch.add(tube([[x + Math.cos(a) * r * 2.6, y - 0.03, z + Math.sin(a) * r * 2.6], [x + Math.cos(a) * r * 1.2, y + h * 0.05, z + Math.sin(a) * r * 1.2], [x + Math.cos(a) * r * 0.3, y + h * 0.13, z + Math.sin(a) * r * 0.3]], [r * 0.22, r * 0.3, r * 0.3], { sides: 5, steps: 5 }), trunkTone);
    }
  };
  const bigTree = (x, z, h, crownW, crownH, puffs, leaves, r, detail) => {
    const y = height(x, z);
    const lean = rng() * TAU; const bend = h * 0.03;
    batch.add(tube([[x, y - 0.05, z], [x + Math.cos(lean) * bend, y + h * 0.5, z + Math.sin(lean) * bend], [x, y + h * 0.93, z]], [r, r * 0.74, r * 0.46], { sides: 9, steps: 6 }), trunkTone);
    buttress(x, y, z, r, h);
    addCrown(batch, x, y + h - crownH * 0.2, z, crownW, crownH, puffs, leaves, rng, detail);
    // Limbs up into the crown, so it is held rather than balanced.
    for (let i = 0; i < 3; i += 1) {
      const a = rng() * TAU;
      batch.add(tube([[x, y + h * 0.72, z], [x + Math.cos(a) * crownW * 0.55, y + h * 0.9, z + Math.sin(a) * crownW * 0.55]], [r * 0.34, r * 0.14], { sides: 6, steps: 2, straight: true }), trunkTone);
    }
    return { x, y, z };
  };
  // Emergents burst through the canopy, canopy trees stand behind the middle of the block, and the
  // front is left to the understory so the two tall layers can be seen from the bank.
  const emergents = [[-3.4, -3.4, 13.0, 2.5, 1.5], [3.6, -2.2, 13.8, 2.8, 1.6], [0.4, -3.8, 12.4, 2.3, 1.45]];
  for (const [x, z, h, w, ch] of emergents) bigTree(x, z, h, w, ch, 22, LEAF.emergent, 0.3, 1);
  const canopy = [[-5.5, -3.8], [-1.7, -2.0], [1.9, -4.0], [5.4, -3.6], [-4.2, -1.4], [1.5, -0.9], [5.2, -0.9], [-0.5, -1.0], [-5.6, -0.3], [3.4, -4.3], [-2.0, -4.4], [3.3, 0.1]];
  for (const [x, z] of canopy) bigTree(x, z, 7.4 + rng() * 1.3, 1.75 + rng() * 0.4, 1.5 + rng() * 0.4, 13, LEAF.canopy, 0.16, 1);
  // The understory: slim stems and big soft leaves, thin enough to see past.
  for (let i = 0; i < 18; i += 1) {
    const x = -5.9 + rng() * 11.8; const z = -4.5 + rng() * 6.5;
    const y = height(x, z); const h = 2.2 + rng() * 1.7;
    batch.add(new THREE.CylinderGeometry(h * 0.02, h * 0.035, h * 0.8, 5), 0x6c5a44, { position: [x, y + h * 0.4, z] });
    addCrown(batch, x, y + h * 0.86, z, h * 0.34, h * 0.3, 8, LEAF.under, rng, 0);
  }
  for (let i = 0; i < 10; i += 1) {
    const x = -5.9 + rng() * 11.8; const z = -3.5 + rng() * 6.0;
    if (z > bank(x) - 0.6) continue;
    addPalm(batch, x, height(x, z), z, 1.9 + rng() * 1.0, rng, { frond: 0x4f9a42, trunk: 0x6a5a42, fronds: 8 });
  }
  // The floor: ferns and fallen logs in the deep shade.
  for (let i = 0; i < 30; i += 1) {
    const x = -6.2 + rng() * 12.4; const z = -4.6 + rng() * 7.2;
    if (z > bank(x) - 0.4) continue;
    const y = height(x, z);
    for (let k = 0; k < 4; k += 1) {
      const a = (k / 4) * TAU + rng(); const len = 0.35 + rng() * 0.25;
      batch.add(tube([[x, y, z], [x + Math.cos(a) * len * 0.5, y + len * 0.42, z + Math.sin(a) * len * 0.5], [x + Math.cos(a) * len, y + len * 0.14, z + Math.sin(a) * len]], [0.012, 0.05, 0], { sides: 3, steps: 4 }), 0x3f8a3c);
    }
  }
  batch.add(tube([[-2.5, height(-2.5, 1.5) + 0.14, 1.5], [-0.9, height(-0.9, 2.0) + 0.16, 2.0]], [0.17, 0.13], { sides: 8, steps: 3, straight: true }), 0x4f3c28);
  // Lianas: what the climbers do to get to the light.
  for (const [x, z, top, far] of [[-1.7, -2.0, 7.6, 0.7], [1.5, -0.9, 7.8, -0.6], [-4.2, -1.4, 7.4, 0.5], [5.2, -0.9, 7.8, -0.7]]) {
    const y = height(x, z);
    batch.add(tube([[x + far, y + top, z], [x + far * 1.4, y + top * 0.6, z + 0.2], [x + far * 0.9, y + top * 0.28, z + 0.1], [x + far * 0.35, y, z]], [0.022, 0.03, 0.03, 0.035], { sides: 4, steps: 12 }), 0x5c5a34);
  }
  const SCARLET = [0xcf2f2a, 0x2f62c4, 0xcf2f2a]; const BLUEGOLD = [0x2f7fd0, 0xf0c13a, 0x2f7fd0];
  addMacaw(batch, 2.9, 9.75, 0.3, 1.9, SCARLET, 0.5, rng);
  addMacaw(batch, -1.1, 9.5, 0.2, 1.9, BLUEGOLD, -0.2, rng);
  addMacaw(batch, 4.6, 11.0, -0.8, 1.9, SCARLET, 0.1, rng);
  addMacaw(batch, -3.2, 11.2, -1.9, 1.9, BLUEGOLD, 0.4, rng);
  // A dugout on the river, the one thing that says how big any of this is.
  batch.add(new THREE.SphereGeometry(1, 10, 6), 0x4d3724, { position: [-1.6, RIVER + 0.03, 4.0], scale: [0.72, 0.09, 0.13], rotation: [0, 0.2, 0] });
  batch.add(new THREE.CylinderGeometry(0.03, 0.06, 0.26, 6), 0xc9583a, { position: [-1.7, RIVER + 0.2, 4.02] });
  batch.add(new THREE.SphereGeometry(0.052, 8, 6), 0x7a5236, { position: [-1.7, RIVER + 0.37, 4.02] });

  // A measuring pole down the left front corner, with the four layers marked on it.
  const px = -6.0; const pz = 2.5; const py = height(px, pz);
  const band = (from, to, color) => batch.add(new THREE.CylinderGeometry(0.075, 0.075, to - from, 10), color, { position: [px, py + (from + to) / 2, pz] });
  band(0, 1.1, 0x7a5a3a); band(1.1, 4.6, 0x62ad4f); band(4.6, 10.2, 0x2f7a35); band(10.2, 13.6, 0xe7c34a);
  signs(root, batch, [
    { text: 'Emergent trees: 200 ft or more', left: px + 0.14, z: pz, y: py + 11.7, ground: py + 11.7 },
    { text: 'Canopy: the living roof', left: px + 0.14, z: pz, y: py + 7.3, ground: py + 7.3 },
    { text: 'Understory: dim and still', left: px + 0.14, z: pz, y: py + 2.8, ground: py + 2.8 },
    { text: 'Forest floor: 2 to 5% of the sun', left: px + 0.14, z: pz, y: py + 0.36, ground: py + 0.36 },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// Rice terraces. A height grid cannot draw these: a step whose edge runs at an angle across the grid
// comes out as a sawtooth. So the hill is built in rings that follow the contours themselves, every
// tread and riser a real strip, and a flooded tread gets a glossier material than the stone beside it.
// ---------------------------------------------------------------------------------------------
function buildRiceTerraces() {
  const W = 16; const D = 14; const FLOOR = 1.0;
  const stream = smoothPath([[-8.5, 5.6], [-4, 5.0], [0, 5.9], [4, 5.1], [8.5, 5.9]], 60);
  const streamField = sampledField(W, D, 200, 175, (x, z) => pathDistance(stream, x, z).d);
  const height = (x, z) => {
    const d = streamField(x, z);
    const y = FLOOR + 0.2 + 0.06 * fbm(x * 1.1, z * 1.1, 3, 3);
    return mix(FLOOR + 0.03, y, sstep(d, 0.16, 0.42));
  };
  const paint = (x, z, y) => {
    const n = fbm(x * 2.2, z * 2.2, 4, 8) * 0.5 + 0.5;
    if (y < FLOOR + 0.1) return mixc([100, 160, 170], [76, 134, 152], n);
    return mixc([62, 118, 54], [88, 140, 62], n);
  };
  const strata = (x, z, y, ground) => {
    if (ground - y < 0.09) return [62, 44, 30];
    const n = noise2(x * 5, y * 8, 6) * 0.5 + 0.5;
    return mixc([128, 96, 66], [102, 80, 60], n);
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.3, nx: 86, nz: 76, height, paint, strata, lightAmount: 0.25, relief: 0.2, strip: 96, texW: 1000,
    labels: [{ text: 'Clay packed under each field keeps the water in', x: 0, y: 0.62, size: 0.17 }],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(301);
  const CX = 0; const CZ = -0.8; const RINGS = 17; const SEG = 132; const STEP = 0.235;
  const outer = (a) => 5.75 + 0.62 * Math.sin(a * 3 + 0.5) + 0.3 * Math.sin(a * 5 + 1.4) + 0.14 * Math.sin(a * 11 + 2.2);
  // Terrace i's contour: ever smaller, and a little wobbly, because a real one follows the ground.
  const rad = (i, a) => {
    const t = i / RINGS;
    return (1.05 + (outer(a) - 1.05) * Math.pow(1 - t, 0.82)) + 0.07 * Math.sin(a * (6 + i % 5) + i * 1.9) * (1 - t);
  };
  const yOf = (i) => FLOOR + 0.2 + i * STEP;
  const P = (r, a, y) => [CX + Math.cos(a) * r, y, CZ + Math.sin(a) * r];
  const wetPos = []; const wetCol = []; const stonePos = []; const stoneCol = [];
  const quad = (list, cols, a, b, c, e, col) => {
    for (const v of [a, b, c, a, c, e]) { list.push(v[0], v[1], v[2]); cols.push(col[0], col[1], col[2]); }
  };
  const FLOOD = [[0.3, 0.56, 0.66], [0.38, 0.62, 0.72], [0.25, 0.5, 0.62]];
  const RICE = [[0.14, 0.42, 0.07], [0.2, 0.5, 0.08], [0.3, 0.56, 0.09], [0.42, 0.56, 0.1]];
  const lip = 0.055; const bund = 0.04;
  for (let i = 0; i < RINGS; i += 1) {
    const y = yOf(i);
    let patch = FLOOD[0];
    for (let s = 0; s < SEG; s += 1) {
      const a0 = (s / SEG) * TAU; const a1 = ((s + 1) / SEG) * TAU;
      // Fields change every few segments, with the division where a field's short wall would be.
      if (s % 6 === 0) {
        const pick = noise2(i * 3.1, s * 0.37, 9);
        patch = pick > 0.16 ? FLOOD[Math.floor(rng() * FLOOD.length)] : RICE[Math.floor(rng() * RICE.length)];
      }
      const ro0 = rad(i, a0); const ro1 = rad(i, a1);
      const ri0 = rad(i + 1, a0); const ri1 = rad(i + 1, a1);
      // Wound outward from the axis, counter-clockwise from above. a0 -> a1 runs +x toward +z.
      quad(wetPos, wetCol, P(ri0, a0, y + bund * 0.5), P(ri1, a1, y + bund * 0.5), P(ro1 - lip, a1, y + bund * 0.5), P(ro0 - lip, a0, y + bund * 0.5), patch);
      const k = 0.82 + 0.3 * (noise2(i * 2.2, s * 0.9, 4) * 0.5 + 0.5);
      const earth = [0.2 * k, 0.15 * k, 0.1 * k]; const top = [0.3 * k, 0.3 * k, 0.14 * k];
      // The bund round the field's outer edge, and the stone wall that drops to the terrace below.
      quad(stonePos, stoneCol, P(ro0 - lip, a0, y + bund), P(ro1 - lip, a1, y + bund), P(ro1, a1, y + bund), P(ro0, a0, y + bund), top);
      quad(stonePos, stoneCol, P(ro0, a0, y + bund), P(ro1, a1, y + bund), P(ro1 + 0.02, a1, y - STEP), P(ro0 + 0.02, a0, y - STEP), earth);
      // The inner wall of the bund, what the water laps against.
      quad(stonePos, stoneCol, P(ro0 - lip, a0, y + bund * 0.5), P(ro1 - lip, a1, y + bund * 0.5), P(ro1 - lip, a1, y + bund), P(ro0 - lip, a0, y + bund), top);
    }
  }
  // The crown: a forested cap that closes the top of the hill.
  const capY = yOf(RINGS) + bund;
  for (let s = 0; s < SEG; s += 1) {
    const a0 = (s / SEG) * TAU; const a1 = ((s + 1) / SEG) * TAU;
    const c = [0.16, 0.3, 0.1];
    const p0 = P(rad(RINGS, a0), a0, capY - STEP * 0.5); const p1 = P(rad(RINGS, a1), a1, capY - STEP * 0.5);
    const hub = P(0, 0, capY + 0.5);
    for (const v of [p0, hub, p1]) { stonePos.push(v[0], v[1], v[2]); stoneCol.push(c[0], c[1], c[2]); }
  }
  const asGeo = (pos, col) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  };
  const wet = mesh(asGeo(wetPos, wetCol), standard({ vertexColors: true, roughness: 0.22, metalness: 0.05 }));
  wet.castShadow = false;
  root.add(wet);
  batch.add(asGeo(stonePos, stoneCol), null);
  for (let i = 0; i < 18; i += 1) {
    const a = rng() * TAU; const r = rng() * 1.0;
    addBroadleaf(batch, CX + Math.cos(a) * r, capY + 0.42 - r * 0.42, CZ + Math.sin(a) * r, 0.8 + rng() * 0.5, rng, [0x2f6b2e, 0x3a7a33, 0x28602b]);
  }
  // Ifugao houses: small, on posts, under a tall pyramid of thatch. They stand on one high terrace.
  for (const a of [0.9, 1.15, 1.42, 1.72, 2.0]) {
    const i = 12; const r = (rad(i, a) + rad(i + 1, a)) / 2 + 0.03; const y = yOf(i) + bund;
    const [x, , z] = P(r, a, 0);
    for (const [dx, dz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) {
      batch.add(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5), 0x3f2d1c, { position: [x + dx, y + 0.1, z + dz] });
    }
    batch.add(new THREE.BoxGeometry(0.25, 0.1, 0.25), 0x5c4128, { position: [x, y + 0.23, z] });
    batch.add(new THREE.ConeGeometry(0.28, 0.4, 4), 0xa4835a, { position: [x, y + 0.48, z], rotation: [0, Math.PI / 4, 0] });
  }
  // Water falling from the forest, field to field, down the front of the hill.
  const fall = (i, a) => { const r = rad(i, a); return P(r + 0.03, a, yOf(i)); };
  const lineA = 1.57;
  const pts = [];
  for (let i = RINGS - 1; i >= 0; i -= 1) pts.push(fall(i, lineA + 0.05 * Math.sin(i * 0.9)));
  batch.add(tube(pts, 0.022, { sides: 5, steps: pts.length * 3 }), 0x7fbfd8);
  const at = (a, i, y) => { const r = rad(i, a); const [x, , z] = P(r, a, 0); return { x, z, y, ground: yOf(i) }; };
  signs(root, batch, [
    { text: 'Forest catches the rain', x: 0, z: CZ, y: capY + 1.75, ground: capY + 0.3 },
    { text: 'Flooded field', ...at(0.75, 3, yOf(3) + 1.35) },
    { text: 'Stone wall holds it', ...at(2.45, 2, yOf(2) + 1.15) },
    { text: 'Ifugao houses', ...at(1.3, 12, yOf(12) + 1.3) },
  ]);
  root.add(batch.mesh());
  return root;
}

export const BUILDERS = {
  'grand-canyon': () => buildGrandCanyon(),
  'sahara-oasis': () => buildSahara(),
  'norway-fjord': () => buildFjord(),
  'coral-atoll': () => buildAtoll(),
  'rainforest-layers': () => buildRainforest(),
  'rice-terraces': () => buildRiceTerraces(),
};
