import * as THREE from 'three';
import {
  terrainBlock, Batch, signs, addPalm, addBroadleaf, addPine, addHouse, blobGeometry, seededRandom,
  rgb, mixc, shade, clamp01, sstep, mix, noise2, fbm, ridged, smoothPath, pathDistance, sampledField, TAU,
} from '../geo/GeoKit.js';

// The Model Database's World Geography landscapes, each a block cut out of a real kind of place.
// See geo/GeoKit.js for how a block is made. Every vertical scale here is exaggerated, as raised
// relief models always are, and the cards say so.

// A boat is three solids: a hull, a mast and a sail. Small, but it gives the river a size.
function addSailboat(batch, x, y, z, size, yaw) {
  const hull = new THREE.SphereGeometry(1, 8, 5);
  batch.add(hull, 0x5a3d26, { position: [x, y + size * 0.05, z], scale: [size * 0.55, size * 0.11, size * 0.17], rotation: [0, yaw, 0] });
  batch.add(new THREE.CylinderGeometry(size * 0.012, size * 0.016, size * 0.9, 4), 0x3b2a1c, { position: [x, y + size * 0.48, z] });
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, size * 0.5, 0, 0, -size * 0.12, size * 0.85, 0, size * 0.5, 0, 0, 0, 0, 0, -size * 0.12, size * 0.85, 0], 3));
  sail.computeVertexNormals();
  batch.add(sail, 0xf4efe2, { position: [x, y + size * 0.12, z], rotation: [0, yaw, 0] });
}

// ---------------------------------------------------------------------------------------------
// River Delta: the Nile's, seen as it is from orbit, a green fan laid on desert at the sea.
// ---------------------------------------------------------------------------------------------
function buildRiverDelta() {
  const W = 18; const D = 13; const SEA = 2.2;
  const apex = [0.1, -3.9];
  const main = smoothPath([[-0.7, -6.8], [0.4, -5.6], [-0.2, -4.7], apex], 40);
  const mk = (pts) => smoothPath([apex, ...pts], 50);
  const rivers = [
    { path: mk([[-1.0, -2.3], [-2.2, -0.4], [-4.6, 1.4], [-6.3, 3.2]]), w: 0.17 },
    { path: mk([[1.1, -2.2], [2.5, -0.3], [4.0, 1.3], [5.9, 3.5]]), w: 0.17 },
  ];
  const twigs = [
    { path: smoothPath([[-2.2, -0.4], [-1.6, 1.1], [-2.2, 2.6], [-2.5, 4.2]], 30), w: 0.09 },
    { path: smoothPath([[2.5, -0.3], [1.5, 1.2], [1.3, 2.9], [1.7, 4.4]], 30), w: 0.09 },
    { path: smoothPath([[-0.45, -3.0], [-0.1, -0.8], [-0.4, 1.8], [0.05, 4.5]], 30), w: 0.08 },
    { path: smoothPath([[-4.6, 1.4], [-4.3, 2.6], [-4.5, 3.8]], 18), w: 0.06 },
    { path: smoothPath([[4.0, 1.3], [3.8, 2.6], [4.0, 4.0]], 18), w: 0.06 },
  ];
  // Where the land stops. The delta is a fan from the apex, its front a shallow bowed arc.
  const coast = (x) => 3.7 + 0.75 * Math.cos((x / 9) * Math.PI) + 0.14 * Math.sin(x * 2.3) + 0.09 * Math.sin(x * 5.1 + 1);
  const fan = (x, z) => {
    const dx = x - apex[0]; const dz = z - apex[1];
    const r = Math.hypot(dx, dz); const a = Math.abs(Math.atan2(dx, dz));
    const edge = 0.92 + 0.05 * noise2(r * 1.4, 3, 11) + 0.22 * (1 - sstep(r, 0, 3));
    return { r, inFan: 1 - sstep(a, edge - 0.13, edge + 0.13), a };
  };
  const channel = (x, z) => {
    let cut = 0; let near = 9;
    for (const list of [[{ path: main, w: 0.26 }], rivers, twigs]) {
      for (const river of list) {
        const { d } = pathDistance(river.path, x, z);
        cut = Math.max(cut, 1 - sstep(d, river.w * 0.75, river.w * 1.8));
        near = Math.min(near, d / river.w);
      }
    }
    return { cut, near };
  };
  const cutField = sampledField(W, D, 360, 260, (x, z) => channel(x, z).cut);
  const nearField = sampledField(W, D, 360, 260, (x, z) => Math.min(channel(x, z).near, 9));
  const channelAt = (x, z) => ({ cut: cutField(x, z), near: nearField(x, z) });
  const desert = (x, z) => SEA + 0.26 + 0.34 * sstep(-z, -1.5, 5) + 0.3 * (fbm(x * 0.5 + 9, z * 0.5, 4, 3) + 0.2) + 0.12 * sstep(Math.abs(x), 3, 9);
  const height = (x, z) => {
    const cz = coast(x);
    const offshore = sstep(z, cz - 0.05, cz + 2.6);
    const { inFan, r } = fan(x, z);
    const plain = SEA + 0.09 + 0.14 * (r / 9) * 0 + 0.02 * fbm(x * 2, z * 2, 2, 8) + 0.04 * sstep(-z, 0, 4);
    let y = mix(desert(x, z), plain, Math.max(inFan, sstep(z, 1.8, 3.4)));
    const { cut } = channelAt(x, z);
    y = mix(y, SEA - 0.16, cut);
    if (z > cz - 0.05) y = mix(SEA + 0.06, SEA - 1.05, offshore);
    return y;
  };
  const crops = [rgb(0x3f8a3a), rgb(0x5da045), rgb(0x2f7a36), rgb(0x86aa4c), rgb(0x4a9440)];
  const paint = (x, z, y, slope) => {
    const cz = coast(x);
    if (z > cz) return [212, 196, 150];
    const { inFan } = fan(x, z);
    const green = Math.max(inFan, sstep(z, 1.8, 3.2));
    const dust = fbm(x * 1.7, z * 1.7, 4, 21) * 0.5 + 0.5;
    const sand = mixc([214, 176, 118], [186, 140, 86], dust);
    const ripple = Math.sin((x + z * 0.4) * 34 + fbm(x, z, 2, 2) * 12) * 5;
    const dryLand = [sand[0] + ripple, sand[1] + ripple, sand[2] + ripple * 0.7];
    // Field patchwork: small rectangles, each with one crop, on a slightly rotated grid.
    const u = (x * 0.92 + z * 0.38) * 2.6; const v = (z * 0.92 - x * 0.38) * 2.6;
    const iu = Math.floor(u); const iv = Math.floor(v);
    const pick = (noise2(iu * 1.7 + 0.5, iv * 2.3 + 0.5, 4) * 0.5 + 0.5) * crops.length;
    let farm = crops[Math.min(crops.length - 1, Math.floor(pick))];
    const edge = Math.min(u - iu, 1 - (u - iu), v - iv, 1 - (v - iv));
    if (edge < 0.05) farm = shade(farm, 0.72);
    const beach = 1 - sstep(cz - z, 0.04, 0.3);
    let c = mixc(dryLand, farm, sstep(green, 0.3, 0.7));
    const { near } = channelAt(x, z);
    c = mixc(c, [52, 104, 52], 1 - sstep(near, 1.2, 3));
    c = mixc(c, [214, 196, 150], beach);
    if (slope > 0.7 && green < 0.5) c = shade(c, 0.86);
    return c;
  };
  // Silt the river is still carrying spreads out from each mouth and fades into blue.
  const mouths = [[-6.3, 3.2], [5.9, 3.5], [-2.5, 4.2], [1.7, 4.4], [0.05, 4.5]];
  const waterPaint = (x, z, depth) => {
    const onLand = z < coast(x) + 0.02;
    if (onLand) return [66, 118, 132];
    let silt = 0;
    for (const [mx, mz] of mouths) silt = Math.max(silt, 1 - sstep(Math.hypot(x - mx, (z - mz) * 1.4) + fbm(x * 1.2, z * 1.2, 3, 19) * 0.7, 0.2, 2.4));
    const sea = mixc([66, 164, 186], [26, 86, 140], sstep(depth, 0.05, 0.85));
    return mixc(sea, [156, 142, 96], silt * 0.8);
  };
  const strata = (x, z, y, ground) => {
    if (ground - y < 0.05) return [58, 44, 32];
    const wob = 0.09 * Math.sin(x * 1.3 + z) + 0.05 * noise2(x * 2, z * 2, 3);
    const band = (y + wob) * 7;
    const t = band - Math.floor(band);
    const silt = mixc([120, 92, 60], [156, 128, 88], t < 0.5 ? t * 2 : 2 - t * 2);
    if (y + wob < 0.8) return mixc([96, 84, 76], [110, 96, 84], noise2(x * 5, y * 18, 2) * 0.5 + 0.5);
    return silt;
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.32, nx: 168, nz: 121, height, water: SEA, strip: 300, paint, waterPaint, strata,
    labels: [{ text: 'Sea floor built of the silt the river dropped', x: 0, y: 0.68 }],
    lightAmount: 0.42,
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(614);
  for (const [x, z, yaw] of [[-3.2, 0.6, 0.6], [3.15, 0.6, -0.8], [0.3, -5.5, 1.4], [-5.3, 2.35, 0.4], [-0.15, 2.6, 1.7]]) {
    addSailboat(batch, x, SEA, z, 0.5, yaw);
  }
  let palms = 0; let guard = 0;
  while (palms < 24 && guard < 900) {
    guard += 1;
    const x = -6.5 + rng() * 13; const z = -3 + rng() * 6.2;
    const { inFan } = fan(x, z);
    const { near } = channel(x, z);
    if (inFan < 0.8 || near > 4.5 || near < 1.6 || z > coast(x) - 0.3) continue;
    addPalm(batch, x, height(x, z), z, 0.42 + rng() * 0.18, rng, { fronds: 6 });
    palms += 1;
  }
  // Towns: clusters of pale boxes where the river first divides, which is where Cairo stands.
  for (let i = 0; i < 26; i += 1) {
    const a = rng() * TAU; const r = 0.3 + rng() * 0.7;
    const x = apex[0] + Math.cos(a) * r * 1.2 + 0.62; const z = apex[1] + Math.sin(a) * r * 0.62;
    if (channel(x, z).near < 1.5) continue;
    batch.add(new THREE.BoxGeometry(0.1 + rng() * 0.09, 0.09 + rng() * 0.16, 0.1 + rng() * 0.09), 0xd6c6a6, { position: [x, height(x, z) + 0.06, z], rotation: [0, rng() * 1.5, 0] });
  }
  signs(root, batch, [
    { text: 'The river', x: -1.5, y: 3.9, z: -5.7, ground: height(-1.5, -5.7) },
    { text: 'Where it divides', x: 2.3, y: 3.5, z: -3.5, ground: height(2.3, -3.5) },
    { text: 'Distributaries', x: -3.6, y: 3.15, z: -0.9, ground: height(-3.6, -0.9) },
    { text: 'Silt reaching the sea', x: 3.6, y: 3.0, z: 5.2, ground: SEA - 0.1 },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// River Meanders: a floodplain river swinging in loops, with one loop already cut off.
// ---------------------------------------------------------------------------------------------
function buildMeanders() {
  const W = 16; const D = 12; const WATER = 1.5;
  const river = smoothPath([
    [-8.5, -2.6], [-6.5, -3.9], [-5.1, -1.8], [-6.2, 0.6], [-4.4, 2.4], [-2.3, 1.2], [-2.6, -1.9], [-0.9, -3.6],
    [0.9, -2.0], [0.4, 0.6], [1.5, 3.0], [3.6, 3.8], [4.6, 1.7], [3.7, -0.7], [4.7, -2.9], [6.5, -2.6], [7.1, -0.2], [8.6, 0.7],
  ], 340);
  // The oxbow: the old loop the river has abandoned, between the two bends that met.
  const oxbow = smoothPath([[-0.2, 3.6], [-1.6, 4.6], [-3.0, 4.75], [-3.6, 3.9], [-3.1, 3.3]], 60);
  const RW = 0.4;
  const curvature = (i) => {
    const a = river[Math.max(0, i - 6)]; const b = river[i]; const c = river[Math.min(river.length - 1, i + 6)];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  };
  const near = (x, z) => {
    let best = 9e9; let at = 0;
    for (let i = 0; i < river.length - 1; i += 2) {
      const d = (river[i][0] - x) ** 2 + (river[i][1] - z) ** 2;
      if (d < best) { best = d; at = i; }
    }
    const a = river[Math.max(0, at - 3)]; const b = river[Math.min(river.length - 1, at + 3)];
    const side = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    const inside = Math.sign(side) === Math.sign(curvature(at));
    return { d: Math.sqrt(best), inside, bend: Math.min(1, Math.abs(curvature(at)) * 3) };
  };
  // Signed on the inside of a bend, so one smooth number carries the side as well as the distance.
  const dField = sampledField(W, D, 340, 256, (x, z) => pathDistance(river, x, z).d);
  const insideField = sampledField(W, D, 170, 128, (x, z) => { const n = near(x, z); return n.inside ? n.bend : 0; });
  const nearAt = (x, z) => { const inner = insideField(x, z); return { d: dField(x, z), inside: inner > 0.12, bend: clamp01(inner) }; };
  const oxField = sampledField(W, D, 340, 256, (x, z) => pathDistance(oxbow, x, z).d);
  const oxDist = oxField;
  const height = (x, z) => {
    const plain = WATER + 0.34 + 0.05 * fbm(x * 0.8, z * 0.8, 3, 5);
    const bluff = 1.2 * sstep(-z, 4.3, 6) * (0.75 + 0.4 * fbm(x * 0.6, 3, 3, 9));
    const { d, inside, bend } = nearAt(x, z);
    let y = plain + bluff;
    // A cut bank drops straight into the water; a point bar slopes into it, on the inside of the bend.
    const bankOut = inside ? mix(0.36, 1.1, bend) : 0.16;
    const t = sstep(d, RW * 0.72, RW + bankOut);
    y = mix(WATER - 0.2, y, t);
    const ox = oxDist(x, z);
    if (ox < 0.75) y = mix(WATER - 0.13, y, sstep(ox, 0.2, 0.5));
    return y;
  };
  const fields = [rgb(0x6f9c47), rgb(0x8bb052), rgb(0x578c42), rgb(0xa8b65e)];
  const paint = (x, z, y, slope) => {
    const { d, inside, bend } = nearAt(x, z);
    const ox = oxDist(x, z);
    const u = (x * 0.8 + z * 0.3) * 1.1; const v = (z * 0.8 - x * 0.3) * 1.1;
    const iu = Math.floor(u); const iv = Math.floor(v);
    const pick = (noise2(iu + 0.4, iv + 0.7, 3) * 0.5 + 0.5) * fields.length;
    let c = fields[Math.min(fields.length - 1, Math.floor(pick))];
    const row = Math.sin((noise2(iu + 0.4, iv + 0.7, 8) > 0 ? u : v) * 70) * 2.5;
    c = [c[0] + row, c[1] + row, c[2] + row];
    if (Math.min(u - iu, 1 - (u - iu), v - iv, 1 - (v - iv)) < 0.03) c = shade(c, 0.74);
    // Natural meadow near water, where nobody ploughs because it floods.
    const wet = 1 - sstep(Math.min(d, ox + 0.2), 0.5, 1.5);
    c = mixc(c, mixc([78, 124, 62], [98, 138, 66], fbm(x * 2, z * 2, 3, 2) * 0.5 + 0.5), wet);
    c = mixc(c, [108, 132, 68], sstep(-z, 4.1, 5));
    if (inside) c = mixc(c, mixc([226, 200, 150], [200, 172, 122], fbm(x * 6, z * 6, 2, 3) * 0.5 + 0.5), (1 - sstep(d, RW + 0.2, RW + 0.28 + 0.74 * bend)) * clamp01(bend * 1.6));
    else if (d < RW + 0.3) c = mixc(c, [134, 106, 74], 1 - sstep(d, RW + 0.1, RW + 0.3));
    if (ox < 0.34) c = mixc(c, [88, 110, 60], 1 - sstep(ox, 0.22, 0.34));
    return c;
  };
  const waterPaint = (x, z, depth) => {
    const ox = oxDist(x, z);
    // A cut-off lake stops being refreshed and goes green and still. The river stays muddy.
    if (ox < 0.6) return mixc([80, 128, 92], [52, 104, 86], sstep(depth, 0, 0.1));
    // Silty, and clearer down the middle of the channel where the water runs deepest.
    return mixc([134, 132, 96], [88, 118, 116], sstep(nearAt(x, z).d, RW * 0.85, RW * 0.2));
  };
  const strata = (x, z, y, ground) => {
    if (ground - y < 0.09) return [62, 46, 30];
    const wob = 0.1 * Math.sin(x * 1.1) + 0.05 * noise2(x * 3, z * 3, 3);
    const band = (y + wob) * 8.5; const t = band - Math.floor(band);
    const c = mixc([122, 104, 74], [168, 142, 96], t < 0.42 ? 0 : 1);
    if (y + wob < 0.75) return mixc([120, 108, 90], [144, 130, 108], noise2(x * 9, y * 9, 4) * 0.5 + 0.5);
    return c;
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.3, nx: 166, nz: 124, height, water: WATER, paint, waterPaint, strata, lightAmount: 0.34, strip: 320, relief: 0.25,
    labels: [{ text: 'Sand and silt the river laid down as it wandered', x: 0, y: 0.92 }],
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(90);
  let trees = 0; let guard = 0;
  while (trees < 30 && guard < 2400) {
    guard += 1;
    const x = -7.7 + rng() * 15.4; const z = -5.6 + rng() * 11.2;
    const { d } = nearAt(x, z);
    const ox = oxDist(x, z);
    const onBluff = z < -4.5;
    if (!onBluff && (d < RW + 0.75 || d > 1.5) && (ox > 1.0 || ox < 0.65)) continue;
    if (d < RW + 0.7) continue;
    addBroadleaf(batch, x, height(x, z), z, 0.42 + rng() * 0.2, rng);
    trees += 1;
  }
  for (const [x, z, yaw] of [[-5.0, -5.1, 0.2], [-4.2, -4.9, 1.4], [6.0, 4.6, 0.3], [6.9, 4.2, 1.2]]) {
    addHouse(batch, x, height(x, z), z, 0.42, 0.3, 0.22, 0xe7dcc6, 0x8a4b36, yaw);
  }
  const at = (x, z, y) => ({ x, z, y, ground: height(x, z) });
  signs(root, batch, [
    { text: 'Oxbow lake', ...at(-1.8, 5.15, 3.0) },
    { text: 'Cut bank: fastest water', ...at(-7.1, -2.4, 3.1) },
    { text: 'Point bar: sand piles up', ...at(3.0, 1.45, 2.95) },
    { text: 'Neck about to break through', ...at(-1.0, 2.7, 3.35) },
  ]);
  root.add(batch.mesh());
  return root;
}

// ---------------------------------------------------------------------------------------------
// The Himalaya: Everest and its neighbours, wet and green to the south, a dry plateau to the north.
// ---------------------------------------------------------------------------------------------
function buildHimalaya() {
  const W = 17; const D = 12;
  const PEAKS = [
    { x: 0.5, z: -0.7, h: 7.1, r: 3.4 }, // Everest
    { x: 1.75, z: 0.45, h: 6.45, r: 2.3 }, // Lhotse
    { x: -0.75, z: 0.35, h: 5.95, r: 1.9 }, // Nuptse
    { x: 4.3, z: 0.1, h: 6.3, r: 2.7 }, // Makalu
    { x: -3.7, z: -0.5, h: 6.15, r: 2.9 }, // Cho Oyu
    { x: -6.6, z: 0.2, h: 5.4, r: 2.6 },
    { x: 7.0, z: -0.3, h: 5.3, r: 2.5 },
  ];
  const coarse = (x, z) => {
    // The range runs east-west. South of it (+z) falls in steps to the plain; north holds up as a plateau.
    const south = sstep(z, 0.7, 5.4);
    const north = sstep(-z, 1.7, 3.2);
    const ridgeLine = z + 0.32 * Math.sin(x * 0.7) + 0.2 * Math.sin(x * 1.7 + 1);
    const range = Math.exp(-(ridgeLine * ridgeLine) / 5.2);
    let y = mix(1.2, 3.2, range) + 1.75 * north * (1 - range);
    y -= 1.0 * south * (1 - range) * 0;
    y = mix(y, 1.1 + 1.0 * Math.pow(1 - south, 1.4) + 0.24 * (fbm(x * 0.7, z * 0.7, 3, 19) + 0.3), south);
    y += 2.5 * range * ridged(x * 0.34 + 2, z * 0.34, 5, 41);
    y += (0.5 * (1 - north * 0.75) + 0.1) * (1 - south * 0.55) * (ridged(x * 0.8, z * 0.8, 4, 12) - 0.3);
    for (const p of PEAKS) {
      const q = Math.hypot(x - p.x, z - p.z) / p.r;
      if (q < 1) {
        const lift = Math.pow(1 - q, 1.35);
        const crag = 1 + 0.13 * (ridged(x * 1.3 + p.x, z * 1.3, 3, 31) - 0.4);
        y = Math.max(y, mix(y, p.h * crag, lift));
      }
    }
    return y;
  };
  const fine = (x, z) => coarse(x, z)
    + 0.05 * (ridged(x * 6, z * 6, 4, 77) - 0.4) * sstep(coarse(x, z), 1.8, 3.2)
    + 0.01 * fbm(x * 22, z * 22, 2, 9);
  const SNOW = 4.3;
  const paint = (x, z, y, slope) => {
    const wet = sstep(z, -0.2, 2.4);
    const dust = fbm(x * 1.3, z * 1.3, 4, 3) * 0.5 + 0.5;
    const plateau = mixc([164, 136, 104], [134, 108, 86], dust);
    const forest = mixc([44, 96, 52], [76, 124, 58], fbm(x * 2.4, z * 2.4, 4, 8) * 0.5 + 0.5);
    const farmland = mixc([92, 116, 66], [122, 130, 78], fbm(x * 3.1, z * 3.1, 3, 4) * 0.5 + 0.5);
    let low = mixc(plateau, y < 1.85 ? farmland : forest, wet);
    // Bare rock above the tree line, sooner on steep ground.
    const rock = mixc([104, 96, 92], [136, 126, 118], fbm(x * 4, z * 4, 3, 5) * 0.5 + 0.5);
    const rockAmt = sstep(y + (slope - 1) * 0.3, mix(3.0, 2.5, wet), mix(3.65, 3.2, wet));
    let c = mixc(low, rock, rockAmt);
    // Snow stays lower on the wet south face, and cannot hold on the steepest walls.
    const line = mix(SNOW + 0.15, SNOW - 0.55, wet) + 0.25 * fbm(x * 2, z * 2, 3, 6);
    const snow = sstep(y, line, line + 0.55) * (1 - sstep(slope, 2.1, 3.2));
    c = mixc(c, [242, 245, 250], snow);
    return c;
  };
  const strata = (x, z, y, ground) => {
    if (ground - y < 0.1) return [70, 58, 46];
    const fold = y + 0.42 * Math.sin(x * 0.55 + z * 0.5 + 1) + 0.14 * Math.sin(x * 1.9 + z);
    const band = fold * 3.6; const t = band - Math.floor(band);
    return mixc([102, 92, 84], [134, 118, 100], t < 0.5 ? t * 2 : 2 - t * 2);
  };
  const block = terrainBlock({
    w: W, d: D, plinth: 0.32, nx: 180, nz: 125, height: coarse, fine, paint, strata, lightAmount: 0.6, relief: 0.7, strip: 300,
    labels: [{ text: 'Rock layers folded as India pushed into Asia', x: 0, y: 0.68 }],
    texW: 1500,
  });
  const root = block.root;
  const batch = new Batch();
  const rng = seededRandom(33);
  let trees = 0; let guard = 0;
  while (trees < 120 && guard < 2600) {
    guard += 1;
    const x = -8.2 + rng() * 16.4; const z = 1.5 + rng() * 4.2;
    const y = coarse(x, z);
    if (y < 1.5 || y > 2.75) continue;
    addPine(batch, x, y, z, 0.3 + rng() * 0.14, rng, 0x3e7a44);
    trees += 1;
  }
  const flag = new THREE.ConeGeometry(0.05, 0.12, 5);
  batch.add(flag, 0xd8452f, { position: [0.5, coarse(0.5, -0.9) + 0.1, -0.9] });
  const at = (x, z, y) => ({ x, z, y, ground: coarse(x, z) });
  signs(root, batch, [
    { text: 'Mount Everest', x: 0.5, z: -0.9, y: coarse(0.5, -0.9) + 0.42, ground: coarse(0.5, -0.9) },
    { text: 'Monsoon side: wet and green', ...at(-5.4, 5.1, 2.5) },
    { text: 'Dry plateau: the rain shadow', ...at(-3.2, -5.2, 6.1) },
  ]);
  root.add(batch.mesh());
  return root;
}

export const BUILDERS = {
  'river-delta': () => buildRiverDelta(),
  'river-meanders': () => buildMeanders(),
  'himalaya-relief': () => buildHimalaya(),
};
