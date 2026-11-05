import * as THREE from 'three';
import {
  terrainBlock, Batch, signs, mixc, shade, clamp01, sstep, mix, noise2, fbm, ridged,
  smoothPath, pathDistance, sampledField, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';

// Jezero Crater, Mars, where NASA landed Perseverance. One idea carries it: IT IS A DRIED-UP LAKE,
// AND A RIVER BUILT A DELTA IN IT. Lakes and deltas lay down fine mud in layers, and that is the
// kind of rock that keeps signs of life on Earth, which is why the rover was sent here.
//
// THE CUT FACE RUNS THROUGH THE DELTA. Half the crater is shown, cut through its centre along the
// line from the delta to the middle of the floor, so the front face is the delta's own profile:
// layered sediment lying on the volcanic rock of the crater floor, and the rim beyond. That line
// runs about 35 degrees north of west, so the plan is turned to put it across the front and a
// north arrow is painted on the highlands. North at the back would have meant a cut that missed
// the delta, or a delta moved seven miles to meet the cut.
//
// THE LAKE IS SHOWN AS GONE. A dashed line on the walls marks the old shoreline, a pale band below
// it the carbonate rock found at about that height, and a sheet of glass at the cut face holds the
// water as it stood, labelled with its age. A full sheet of water across the crater would have
// hidden the very floor the rover drove on.
//
// One description of the ground used three times: the rock surface and the delta are sampled once
// on a grid twice as fine as the mesh, and the mesh, the painting of the top and the painting of
// the cut faces all read those samples, so the delta in section and the delta from above cannot
// disagree. Six meshes: ground, cut faces, base, scenery, signs, the lake's glass.
//
// Authored in feet, origin at the base centre, front toward +Z. 1 ft is about 3.4 km across the
// ground; heights are exaggerated about ten times, the delta a little more.

const W = 17; const D = 9;
const ZF = D / 2; // the crater's centre sits on the front edge
const NX = 200; const NZ = 106;
const RIM = 6.6;
// The foot of the inner wall. The real floor is about 35 km across inside a 45 km rim, so the wall is a
// narrow ring; drawn wider, it buried the delta that is the whole reason for the model.
const WALL = 5.2;
const FLOOR = 0.82;
const DELTA_TOP = 1.16;
export const LAKE = 1.5;
const DEG = Math.PI / 180;
export const NORTH_TURN_DEG = 35;
const THETA_OUT = -35 * DEG; // the outlet, on the east side
const FONT = 'Arial, Helvetica, sans-serif';

// The river's way in, through the western rim. (A smaller fan on the north side is left out: it
// read as a second, competing delta, and this model is about the western one.)
const CANYON = smoothPath([[-8.75, 2.62], [-8.05, 3.02], [-7.35, 3.55], [-6.6, 3.86], [-5.95, 4.02], [-5.35, 4.1]], 80);
// The main fan's apex is where the river left its canyon; it opens toward the crater's middle.
const FAN = { ax: -5.35, az: 4.1, dir: 0, R0: 2.72, spread: 1.6, top: DELTA_TOP };
// Old distributary channels, now standing as low ridges on the delta top.
const CHANNELS = [
  smoothPath([[-5.35, 4.1], [-4.75, 3.78], [-4.1, 3.36], [-3.55, 2.92], [-3.15, 2.62]], 60),
  smoothPath([[-5.35, 4.1], [-4.65, 4.18], [-3.95, 4.32], [-3.4, 4.26], [-2.98, 4.38]], 60),
  smoothPath([[-5.0, 3.92], [-4.75, 3.3], [-4.45, 2.72], [-4.15, 2.22]], 50),
];
// The rover's drive, roughly: landing, west to the delta front, up it, across to the old river
// channel where it drilled Cheyava Falls, then up toward the rim.
export const LANDING = [-2.0, 4.2];
export const CHEYAVA = [-5.12, 3.86];
const ROUTE = smoothPath([LANDING, [-1.72, 4.36], [-1.52, 4.12], [-1.9, 3.9], [-2.5, 3.94], [-3.1, 4.0], [-3.8, 4.06], [-4.5, 3.98], CHEYAVA, [-5.6, 3.7], [-5.95, 3.6]], 160);
// Rock craters, then craters on the delta itself (Belva is the big one on the delta top).
const CRATERS = [
  [-7.6, -2.8, 0.26], [-8.0, 1.4, 0.15], [-6.9, -0.6, 0.12], [1.5, 2.6, 0.22], [3.1, 1.1, 0.14], [-0.6, 0.7, 0.11],
  [0.4, 3.7, 0.09], [7.6, 3.2, 0.3], [7.25, -3.05, 0.2], [2.6, -3.6, 0.17], [-2.0, -3.9, 0.13], [4.6, -3.6, 0.1],
];
const DELTA_CRATERS = [[-4.15, 3.05, 0.2]];
// The north arrow, painted on the highlands.
const ARROW = { x: -7.6, z: -3.25, len: 0.95, dir: [-Math.sin(NORTH_TURN_DEG * DEG), -Math.cos(NORTH_TURN_DEG * DEG)] };

const frac = (v) => v - Math.floor(v);

function rimR(c, s) { return RIM + 0.16 * noise2(c * 1.7 + 5, s * 1.7 + 2, 9) + 0.06 * noise2(c * 4 + 1, s * 4, 3); }
function crestH(c, s) { return 2.8 - 0.32 * c + 0.09 * noise2(c * 2.3, s * 2.3 + 4, 4); }
// High old highlands to the west, falling toward the Isidis basin to the east.
function plain(x, z) {
  return mix(2.62, 1.22, sstep(x, -4.5, 6.5)) + 0.07 * fbm(x * 0.45, z * 0.45, 4, 3)
    + 0.16 * ridged(x * 0.35 + 3, z * 0.35, 3, 5) * (1 - sstep(x, -5, 1));
}

function smallCrater(y, x, z, [cx, cz, rad]) {
  const d = Math.hypot(x - cx, z - cz) / rad;
  if (d > 1.9) return y;
  const bowl = d < 1 ? -0.32 * rad * (1 - d * d) : 0;
  return y + bowl + 0.1 * rad * Math.exp(-(((d - 1) / 0.3) ** 2));
}

// A path's distance and how far along it, sampled once on a grid and read back smoothly. Only the
// samples within `margin` of the path's box are computed; the rest hold `margin`, which every caller
// treats as far away. Asking pathDistance per texel instead was most of this model's build time.
function pathField(paths, nx, nz, margin) {
  const X0 = -W / 2; const Z0 = -D / 2; const ring = nx + 1;
  const dist = new Float32Array(ring * (nz + 1)).fill(margin);
  const along = new Float32Array(ring * (nz + 1));
  let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
  for (const path of paths) for (const [x, z] of path) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const i0 = Math.max(0, Math.floor(((x0 - margin - X0) / W) * nx)); const i1 = Math.min(nx, Math.ceil(((x1 + margin - X0) / W) * nx));
  const j0 = Math.max(0, Math.floor(((z0 - margin - Z0) / D) * nz)); const j1 = Math.min(nz, Math.ceil(((z1 + margin - Z0) / D) * nz));
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const x = X0 + (i / nx) * W; const z = Z0 + (j / nz) * D;
      let best = margin; let t = 0;
      for (const path of paths) {
        const at = pathDistance(path, x, z);
        if (at.d < best) { best = at.d; t = at.t; }
      }
      dist[i + j * ring] = best; along[i + j * ring] = t;
    }
  }
  const read = (data) => (x, z) => {
    const fx = clamp01((x - X0) / W) * nx; const fz = clamp01((z - Z0) / D) * nz;
    const i = Math.min(nx - 1, Math.floor(fx)); const j = Math.min(nz - 1, Math.floor(fz));
    const u = fx - i; const v = fz - j; const k = i + j * ring;
    return (data[k] * (1 - u) + data[k + 1] * u) * (1 - v) + (data[k + ring] * (1 - u) + data[k + ring + 1] * u) * v;
  };
  return { d: read(dist), t: read(along) };
}

function fanAt(f, x, z) {
  const dx = x - f.ax; const dz = z - f.az;
  const rho = Math.hypot(dx, dz);
  let phi = Math.atan2(dz, dx) - f.dir;
  if (phi > Math.PI) phi -= TAU; else if (phi < -Math.PI) phi += TAU;
  const a = Math.abs(phi);
  if (a > f.spread + 0.05) return null;
  const q = phi / f.spread;
  const edge = f.R0 * (1 - 0.22 * q * q) + f.R0 * 0.055 * Math.sin(phi * 4.3 + 0.7) + f.R0 * 0.025 * noise2(phi * 3, 2, 17);
  const inside = (1 - sstep(rho, edge - 0.22, edge + 0.02)) * (1 - sstep(a, f.spread - 0.25, f.spread + 0.05));
  if (inside <= 0) return null;
  return { top: f.top + 0.08 * (1 - rho / edge) + 0.015 * fbm(x * 1.4, z * 1.4, 2, 31), inside, rho };
}

function buildJezero() {
  // The carve reaches about 1.5ft out from a valley's line before its banks rise past the rim.
  const { d: canyonD, t: canyonT } = pathField([CANYON], 680, 360, 1.8);

  // The rock: crater bowl, rim, flank, the two valleys and the craters. No sediment.
  const rockExact = (x, z) => {
    const dz = z - ZF; const r = Math.hypot(x, dz) || 1e-6;
    const c = x / r; const s = dz / r;
    const rr = rimR(c, s); const hc = crestH(c, s);
    const fl = FLOOR + 0.03 * fbm(x * 0.8, z * 0.8, 3, 12) + 0.012 * ridged(x * 1.6, z * 1.6, 2, 8);
    let y;
    if (r < rr) {
      const t = clamp01((r - WALL) / (rr - WALL));
      // Concave, with slumped benches: an eroded wall rather than a turned bowl.
      y = fl + (hc - fl) * t ** 1.7 + 0.09 * t * (1 - t) * fbm(x * 1.6, z * 1.6, 3, 21);
    } else {
      y = mix(hc, plain(x, z), sstep(r, rr, rr + 2.2) ** 0.75);
    }
    // The outlet: a notch in the east rim at the old lake level, and its valley running away.
    const dth = Math.atan2(s, c) - THETA_OUT;
    if (Math.cos(dth) > 0) {
      const along = r * Math.cos(dth); const across = Math.abs(r * Math.sin(dth));
      if (along > RIM - 1.0) {
        const floor = LAKE - 0.04 - 0.52 * sstep(along, RIM + 0.15, RIM + 2.8);
        y = Math.min(y, floor + Math.max(0, across - 0.11) * 1.4);
      }
    }
    // The river's canyon through the west rim.
    y = Math.min(y, mix(2.36, 1.24, canyonT(x, z) ** 0.85) + Math.max(0, canyonD(x, z) - 0.1) * 2.8);
    for (const k of CRATERS) y = smallCrater(y, x, z, k);
    return y;
  };
  const rock = sampledField(W, D, NX * 2, NZ * 2, rockExact);

  const heightExact = (x, z) => {
    const base = rock(x, z);
    let y = base;
    const at = fanAt(FAN, x, z);
    if (at) y = Math.max(y, mix(base, at.top, at.inside));
    if (y > base + 0.01) for (const k of DELTA_CRATERS) y = smallCrater(y, x, z, k);
    return y;
  };
  // Sampled on a grid twice the mesh's, so every mesh vertex reads an exact value.
  const height = sampledField(W, D, NX * 2, NZ * 2, heightExact);

  const { d: chanD } = pathField(CHANNELS, 680, 360, 0.25);
  const { d: routeD, t: routeT } = pathField([ROUTE], 1020, 540, 0.2);
  let routeLen = 0;
  for (let i = 1; i < ROUTE.length; i += 1) routeLen += Math.hypot(ROUTE[i][0] - ROUTE[i - 1][0], ROUTE[i][1] - ROUTE[i - 1][1]);
  const dots = routeLen / 0.075;

  // Shading only: the ridges of old channels and a little grit, too fine for the mesh.
  const fine = (x, z) => {
    const g = height(x, z);
    let y = g + 0.008 * fbm(x * 6, z * 6, 2, 44);
    if (g - rock(x, z) > 0.02) y += 0.014 * (1 - sstep(chanD(x, z), 0.018, 0.05));
    return y;
  };

  const inArrow = (x, z) => {
    const [ux, uz] = ARROW.dir;
    const px = x - ARROW.x; const pz = z - ARROW.z;
    const u = px * ux + pz * uz + ARROW.len / 2; const v = Math.abs(-px * uz + pz * ux);
    const head = 0.32;
    if (u < 0 || u > ARROW.len) return false;
    if (u < ARROW.len - head) return v < 0.04;
    return v < 0.15 * (ARROW.len - u) / head;
  };

  const paint = (x, z, y, slope) => {
    const g = height(x, z); const thick = g - rock(x, z);
    const dz = z - ZF; const r = Math.hypot(x, dz) || 1e-6;
    const c = x / r; const s = dz / r; const rr = rimR(c, s);
    const dust = fbm(x * 1.3, z * 1.3, 4, 21) * 0.5 + 0.5;
    let col;
    if (thick > 0.015) {
      // The delta: paler, finer sediment, with its old channels as light ridges and its layers
      // showing as bands wherever the front has worn back into a slope.
      col = mixc([192, 164, 134], [218, 194, 160], dust);
      if (slope > 0.4) {
        const b = 0.5 + 0.5 * Math.sin(y * 62.8 + 0.6 * noise2(x * 3, z * 3, 6));
        col = mixc(col, mixc([150, 120, 96], [222, 198, 164], b), sstep(slope, 0.4, 1.0));
      }
      col = mixc(col, [236, 220, 190], 0.8 * (1 - sstep(chanD(x, z), 0.016, 0.045)));
    } else if (r > rr + 0.03) {
      const rocky = sstep(fbm(x * 2.4, z * 2.4, 3, 9), 0.1, 0.45);
      col = mixc(mixc([180, 120, 80], [204, 148, 102], dust), [142, 94, 66], rocky * 0.55);
      col = mixc(col, [196, 140, 98], 0.45 * (1 - sstep(r, rr, rr + 1.5)));
      if (slope > 0.5) col = mixc(col, [138, 92, 66], sstep(slope, 0.5, 1.4) * 0.6);
    } else if (r < WALL + 0.05 || slope < 0.22) {
      // The floor: darker volcanic rock under a skin of dust, with dark wind-blown sand in ripples.
      col = mixc([112, 86, 70], [138, 104, 80], dust);
      const ripple = 0.5 + 0.5 * Math.sin(x * 22 + z * 7 + 6 * fbm(x * 0.6, z * 0.6, 2, 51));
      const sandy = sstep(fbm(x * 0.9 + 4, z * 0.9, 3, 52), 0.05, 0.35);
      col = mixc(col, [88, 68, 58], sandy * (0.35 + 0.35 * ripple));
    } else {
      col = mixc([166, 112, 78], [130, 88, 64], sstep(slope, 0.4, 1.5));
      // Gullies: streaks running down the slope, irregular in spacing and length.
      const a = Math.atan2(s, c) * r;
      const gully = sstep(fbm(a * 4.2, r * 0.9, 3, 61), 0.05, 0.4);
      col = shade(col, 1.04 - 0.16 * gully);
    }
    // Where the lake spilled out, the valley floor is darker and cut by water.
    {
      const dth = Math.atan2(s, c) - THETA_OUT;
      if (Math.cos(dth) > 0 && r * Math.cos(dth) > RIM - 1 && Math.abs(r * Math.sin(dth)) < 0.2) col = mixc(col, [118, 88, 70], 0.5 * (1 - sstep(Math.abs(r * Math.sin(dth)), 0.1, 0.2)));
    }
    if (r < rr && r > WALL - 0.05 && thick <= 0.015) {
      // The pale carbonate band, at about the old shoreline: strongest on the west, where it was found.
      if (y > LAKE - 0.17 && y < LAKE - 0.006 && slope > 0.16) {
        const w = 0.4 + 0.5 * sstep(-c, -0.3, 0.5);
        col = mixc(col, [224, 204, 168], w * (0.75 + 0.25 * noise2(x * 4, z * 4, 71)));
      }
    }
    // The old shoreline, dashed by distance round the crater.
    if (r < rr + 0.25) {
      const lw = Math.max(0.0035, slope * 0.014);
      if (Math.abs(y - LAKE) < lw && frac((Math.atan2(s, c) + Math.PI) * r * 3.4) < 0.6) col = [248, 244, 232];
    }
    // The rover's drive, dotted, with a dark edge so it reads on pale ground.
    const rd = routeD(x, z);
    if (rd < 0.034 && frac(routeT(x, z) * dots) < 0.6) {
      col = rd < 0.022 ? [255, 214, 84] : mixc(col, [70, 48, 36], 0.3);
    }
    if (inArrow(x, z)) col = [246, 240, 228];
    return col;
  };

  // The cut faces. Below the rock surface: the crater floor's two volcanic units over the old
  // crust; above it, where there is sediment, the delta's beds. Banding is held to periods the atlas
  // can draw (about 133 texels a foot up, 82 across).
  const strata = (x, z, y, ground) => {
    const base = rock(x, z);
    if (y > base + 1e-4) {
      const h = y - base; const thick = ground - base;
      const rho = Math.hypot(x - FAN.ax, z - FAN.az);
      if (h < Math.min(0.05, thick * 0.25)) {
        const b = 0.5 + 0.5 * Math.sin(y * 120);
        return mixc([98, 82, 72], [116, 96, 82], b);
      }
      if (y > ground - Math.min(0.095, thick * 0.32) + 0.012 * Math.sin(x * 3.1)) {
        const b = 0.5 + 0.5 * Math.sin(y * 55 + 0.4 * noise2(x * 2, y * 4, 5));
        return mixc([178, 140, 100], [206, 170, 126], b);
      }
      // Foresets: beds dipping out into the old lake, alternating sandier and muddier.
      const b = 0.5 + 0.5 * Math.sin((y + 0.42 * rho) * 48 + 0.3 * noise2(x * 2, y * 5, 8));
      return mixc([134, 102, 80], [178, 138, 100], b);
    }
    const depth = base - y;
    if (depth < 0.03) return mixc([156, 110, 80], [176, 124, 88], noise2(x * 9, y * 20, 2) * 0.5 + 0.5);
    const dz = z - ZF; const r = Math.hypot(x, dz) || 1e-6;
    const rr = rimR(x / r, dz / r);
    if (r < WALL + 0.3) {
      if (depth < 0.17) {
        // Maaz: lava flows, dark grey, in faint sheets.
        const b = 0.5 + 0.5 * Math.sin((y + 0.01 * noise2(x * 2, y, 3)) * 70);
        return mixc([84, 78, 76], [100, 92, 88], b);
      }
      if (depth < 0.36) {
        // Seitah: olivine crystals that settled in a magma body, dark green-brown and speckled.
        const sp = noise2(x * 18, y * 30, 4) * 0.5 + 0.5;
        return mixc([86, 84, 70], [108, 102, 82], sp);
      }
    }
    // The old crust: layered, bent up at the rim by the impact, with broken blocks in it.
    const lift = 0.28 * Math.exp(-(((r - RIM) / 0.9) ** 2));
    const band = (y - lift * (y - 0.3)) * 6.5 + 0.55 * noise2(x * 0.9, y * 2.5, 6);
    const t = frac(band);
    let col = t < 0.33 ? [134, 92, 66] : t < 0.66 ? [156, 110, 78] : [118, 82, 62];
    if (noise2(x * 11, y * 15, 7) > 0.62) col = mixc(col, [176, 132, 98], 0.4);
    return col;
  };

  const block = terrainBlock({
    w: W, d: D, plinth: 0.3, nx: NX, nz: NZ, height, fine, paint, strata, strip: 420,
    texW: 1500, lightAmount: 0.5, relief: 0.35, plinthColor: 0x3a2a1e,
    labels: [
      { text: 'Volcanic rock of the crater floor', x: 1.35, y: 0.55, size: 0.13 },
      { text: 'Old rock of the highlands', x: -7.55, y: 1.15, size: 0.12 },
    ],
  });
  const root = block.root;

  // --- the lake, as it stood: a sheet of glass at the cut face, from the ground up to the
  // shoreline, clipped by the ground so it fills only the bowl. ---
  const profile = [];
  // Only inside the rim: the plain to the east is lower than the old lake, but it was never under it.
  for (let i = 0; i <= NX; i += 1) {
    const x = -W / 2 + (i / NX) * W;
    profile.push([x, Math.abs(x) < WALL + 0.6 ? height(x, ZF) : LAKE + 1]);
  }
  let xMin = Infinity; let xMax = -Infinity;
  for (const [x, g] of profile) if (g < LAKE) { xMin = Math.min(xMin, x); xMax = Math.max(xMax, x); }
  xMin -= W / NX; xMax += W / NX;
  const yMin = FLOOR - 0.08;
  const pz = ZF + 0.006;
  const lakePos = []; const lakeUv = [];
  const P = (x, y) => { lakePos.push(x, y, pz); lakeUv.push((x - xMin) / (xMax - xMin), (y - yMin) / (LAKE - yMin)); };
  for (let i = 0; i < profile.length - 1; i += 1) {
    const [xa, ga] = profile[i]; const [xb, gb] = profile[i + 1];
    const ia = ga < LAKE; const ib = gb < LAKE;
    if (!ia && !ib) continue;
    if (ia && ib) { P(xa, ga); P(xb, gb); P(xb, LAKE); P(xa, ga); P(xb, LAKE); P(xa, LAKE); continue; }
    const xc = xa + (xb - xa) * (LAKE - ga) / (gb - ga);
    if (ia) { P(xa, ga); P(xc, LAKE); P(xa, LAKE); } else { P(xc, LAKE); P(xb, gb); P(xb, LAKE); }
  }
  const lakeGeo = new THREE.BufferGeometry();
  lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(lakePos, 3));
  lakeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(lakeUv, 2));
  lakeGeo.computeVertexNormals();
  const pxPerFt = 256;
  const lakeTex = canvasTexture(Math.round((xMax - xMin) * pxPerFt), Math.round((LAKE - yMin) * pxPerFt), (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(120, 186, 232, 0.5)');
    grad.addColorStop(1, 'rgba(56, 118, 186, 0.42)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(232, 246, 255, 0.95)';
    ctx.fillRect(0, 0, w, 4);
    const text = (words, x, y, size) => {
      const px = size * pxPerFt;
      ctx.font = `700 ${px}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = px * 0.18;
      ctx.strokeStyle = 'rgba(10, 30, 60, 0.85)';
      const cx = (x - xMin) * pxPerFt; const cy = (LAKE - y) * pxPerFt;
      ctx.strokeText(words, cx, cy);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(words, cx, cy);
    };
    text('Ancient lake, about 3.5 billion years ago', 0.95, FLOOR + (LAKE - FLOOR) * 0.5, 0.17);
    text('The delta: mud and sand from the river', -4.15, (DELTA_TOP + 0.1 + LAKE) / 2, 0.125);
  });
  const lake = mesh(lakeGeo, standard({
    map: lakeTex, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0,
    emissive: 0xffffff, emissiveMap: lakeTex, emissiveIntensity: 0.28,
  }));
  lake.castShadow = false;
  lake.receiveShadow = false;
  root.add(lake);

  // --- markers and signs ---
  const batch = new Batch();
  const ground = (x, z) => height(x, z);
  batch.add(new THREE.SphereGeometry(0.065, 12, 8), 0xff5a1f, { position: [LANDING[0], ground(...LANDING) + 0.02, LANDING[1]] });
  batch.add(new THREE.SphereGeometry(0.05, 12, 8), 0xffe14d, { position: [CHEYAVA[0], ground(...CHEYAVA) + 0.02, CHEYAVA[1]] });
  const at = (text, x, z, lift) => { const g = ground(x, z); return { text, x, z, y: g + lift, ground: g }; };
  const outlet = [Math.cos(THETA_OUT) * (RIM + 0.9), ZF + Math.sin(THETA_OUT) * (RIM + 0.9)];
  const shore = (theta, lift) => {
    // Walk in from the rim to where the wall stands at the lake's level.
    let r = RIM;
    while (r > WALL && height(Math.cos(theta) * r, ZF + Math.sin(theta) * r) > LAKE) r -= 0.01;
    return [Math.cos(theta) * r, ZF + Math.sin(theta) * r, lift];
  };
  const [sx, sz] = shore(-1.45, 0);
  const [bx, bz] = shore(-2.0, 0);
  const tip = [ARROW.x + ARROW.dir[0] * (ARROW.len / 2 + 0.18), ARROW.z + ARROW.dir[1] * (ARROW.len / 2 + 0.18)];
  const canyonAt = CANYON[Math.round(CANYON.length * 0.5)];
  signs(root, batch, [
    at('Jezero Crater, Mars', 0.4, -3.75, 0.75),
    at('River came in here', canyonAt[0], canyonAt[1], 1.5),
    at('The delta', -4.6, 2.65, 0.9),
    at('Lake spilled out here', outlet[0], outlet[1], 0.95),
    at('Old shoreline', sx, sz, 0.55),
    at('Pale carbonate band', bx, bz, 0.6),
    at('Perseverance landed, 2021', LANDING[0], LANDING[1], 0.72),
    at('Cheyava Falls rock, 2024', CHEYAVA[0], CHEYAVA[1], 0.48),
    at('North', tip[0], tip[1], 0.3),
  ], { plate: 0.26 });
  root.add(batch.mesh());
  return root;
}

export const BUILDERS = { 'jezero-crater': buildJezero };
