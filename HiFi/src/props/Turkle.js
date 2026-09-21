// TURKLE STREET, at HiFi fidelity.
//
// This world is the app's first HiFi-FIRST world: it was laid out for this edition, and what
// `src/props/TurkleProps.js` builds is the pickable, measurable, programmable three.js twin
// of everything below rather than the thing anybody looks at. So these builders are where
// the fidelity lives, and the brief they answer is unusually literal -- match six
// photographs of a real corner in Park City, Kansas.
//
// WHAT "AS REAL AS POSSIBLE" ACTUALLY COSTS, in the order it matters here:
//
//  1. THE ROAD IS A TROUGH, NOT A STRIPE. A curbed residential street sits five inches below
//     the lawn at the gutter and crowns back up to nearly lawn level in the middle. Every
//     first pass lays it as one flat slab, and then the kerb has nothing to do, the gutter is
//     a painted line, and the whole street reads as a texture rather than as civil
//     engineering. The section comes from `src/props/turkle/plan.js`, which the three.js
//     edition reads too -- one description, two renderers, and they cannot disagree about
//     where the kerb is.
//  2. THE SURFACES ARE PHOTOGRAPHS, and which photograph matters more than the tint. Asphalt
//     is `Gravel022` (asphalt IS aggregate, and a smooth grey set reads as painted card);
//     kerbs, aprons, drives and walks are `Concrete034`; lap siding is `Planks012` turned a
//     quarter turn so its boards run horizontally; roofs are `RoofingTiles013A` at a small
//     tile, which is what three-tab shingle courses look like at fifty feet.
//  3. EVERY EDGE IS CHAMFERED. `kit.box`'s default bevel is most of the difference between
//     this and a render of a cardboard model: a dead-sharp arris never catches a highlight,
//     and a house is nothing but arrises.
//  4. THE GLASS GOES WARM AT DUSK. Every window in every house here is on the night hook, so
//     walking the block with the Time of Day slider is the thing this world is for.
//
// House rules are the Kit's: feet at scale 1, origin at the base centre, facing +Z, seeded
// randomness only, and a prop merges to one mesh per material.

import { Mesh, VertexData, Vector3, Color3, PBRMaterial, DynamicTexture, Texture } from '@babylonjs/core';
import { seededRandom, linear } from './Kit.js';
import { shrub, turkleTree } from './Trees.js';
import { ichuGrass } from './Flora.js';
import {
  PLAN, pavementPatches, curbRuns, roadHeight, isPan, apronRows, apronHeight, sinkAt,
} from '../../../src/props/turkle/plan.js';

// ---------------------------------------------------------------------------
// Palette -- the same names and the same numbers as the three.js twin
// ---------------------------------------------------------------------------

const TS = {
  asphalt: 0x5a5854,
  // Weathered sidewalk concrete measures about 0.4 albedo, not the 0.75 that `light grey`
  // suggests. At the first pass's value every slab in the world blew out to white under a
  // 4.7 sun and the drive read as a sheet of paper laid on the lawn.
  concrete: 0xa09a8d,
  concreteOld: 0x928c81,
  siding: 0xcdb17a,
  sidingWhite: 0xe9e6dc,
  trimDark: 0x4e3a2a,
  trimWhite: 0xf0ebe0,
  doorBrown: 0x4a3226,
  shingle: 0x6f6152,
  foundation: 0x968f80,
  garageDoor: 0xe6e2d6,
  glass: 0x2b3238,
  brass: 0xbf9a4e,
  galv: 0xb4b7ba,
  galvDark: 0x8d9194,
  steel: 0x6e7174,
  cedar: 0x9c8467,
  cedarGrey: 0x8b7a63,
  cedarDark: 0x6d5f4c,
  pole: 0x6f6050,
  mulch: 0x54402f,
  brickEdge: 0x9c5a42,
  pumpkin: 0xd2711f,
  flagRed: 0xaa2a30,
  flagBlue: 0x27356b,
  flagWhite: 0xf2efe6,
};

// Blend two sRGB hex colours. Integer arithmetic rather than a Color3 round trip: these are
// material KEYS as much as colours, and `kit.mat`/`kit.flat` cache on the exact number.
function mix(a, b, t) {
  const ch = (sh) => Math.round((((a >> sh) & 255) * (1 - t)) + (((b >> sh) & 255) * t)) & 255;
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ---------------------------------------------------------------------------
// Ground-plane geometry
// ---------------------------------------------------------------------------

// BABYLON CULLS AS LEFT-HANDED EVEN IN A RIGHT-HANDED SCENE, so every hand-built triangle
// here has to be wound the opposite way from the three.js twin's. Rather than remember which
// way that is per surface -- and it is different for a road's top, its bottom and its skirt
// -- each triangle is emitted through this, which measures its own geometric normal and
// swaps two indices when it comes out on the wrong side. A whole road rendered inside out is
// not invisible, it is DARK, which is the failure mode this file's own notes keep recording.
function tri(idx, pos, a, b, c, out) {
  const ax = pos[a * 3]; const ay = pos[a * 3 + 1]; const az = pos[a * 3 + 2];
  const ux = pos[b * 3] - ax; const uy = pos[b * 3 + 1] - ay; const uz = pos[b * 3 + 2] - az;
  const vx = pos[c * 3] - ax; const vy = pos[c * 3 + 1] - ay; const vz = pos[c * 3 + 2] - az;
  const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
  // Babylon's front face is the one whose index order is CLOCKWISE seen from outside, i.e.
  // whose right-hand-rule normal points INWARD -- see Kit.plane, which is wound this way.
  if (nx * out[0] + ny * out[1] + nz * out[2] > 0) { idx.push(a, c, b); } else { idx.push(a, b, c); }
}

function quad(idx, pos, a, b, c, d, out) { tri(idx, pos, a, b, c, out); tri(idx, pos, a, c, d, out); }

// A paved surface from a grid of [x, z] rows, lifted by `hAt`, closed by a skirt and a
// bottom. UVs are laid out in WORLD FEET, so one aggregate tile is the same size whether it
// is in the gutter or out in the middle of the junction -- and so the two halves of a road
// cut from one grid line up exactly where they meet.
function gridMesh(scene, name, rows, hAt, { base = -1.4, filter = null } = {}) {
  const nz = rows.length; const nx = rows[0].length;
  const pos = []; const nrm = []; const uv = []; const idx = [];
  const top = []; const bot = [];
  const EPS = 0.35;
  for (let i = 0; i < nz; i++) {
    top.push([]); bot.push([]);
    for (let j = 0; j < nx; j++) {
      const [x, z] = rows[i][j];
      const y = hAt(x, z);
      // The surface normal from the height field itself, which is exact and does not care
      // which way the triangles ended up wound.
      const gx = (hAt(x + EPS, z) - hAt(x - EPS, z)) / (2 * EPS);
      const gz = (hAt(x, z + EPS) - hAt(x, z - EPS)) / (2 * EPS);
      const l = Math.hypot(-gx, 1, -gz);
      top[i].push(pos.length / 3); pos.push(x, y, z); nrm.push(-gx / l, 1 / l, -gz / l); uv.push(x, z);
      bot[i].push(pos.length / 3); pos.push(x, base, z); nrm.push(0, -1, 0); uv.push(x, z);
    }
  }
  const area = (i, j) => {
    const p = rows[i][j]; const q = rows[i][j + 1]; const r = rows[i + 1][j + 1]; const s = rows[i + 1][j];
    return Math.abs((q[0] - p[0]) * (s[1] - p[1]) - (s[0] - p[0]) * (q[1] - p[1]))
      + Math.abs((r[0] - q[0]) * (s[1] - q[1]) - (s[0] - q[0]) * (r[1] - q[1]));
  };
  const live = [];
  for (let i = 0; i < nz - 1; i++) {
    live.push([]);
    for (let j = 0; j < nx - 1; j++) {
      const cx = (rows[i][j][0] + rows[i + 1][j + 1][0]) / 2;
      const cz = (rows[i][j][1] + rows[i + 1][j + 1][1]) / 2;
      const on = area(i, j) > 1e-5 && (!filter || filter(cx, cz));
      live[i].push(on);
      if (!on) continue;
      quad(idx, pos, top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j], [0, 1, 0]);
      quad(idx, pos, bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i][j], [0, -1, 0]);
    }
  }
  const edge = (a, b, outward) => quad(idx, pos, top[a[0]][a[1]], top[b[0]][b[1]], bot[b[0]][b[1]], bot[a[0]][a[1]], outward);
  const outOf = (p, q) => {
    const dx = rows[q[0]][q[1]][0] - rows[p[0]][p[1]][0];
    const dz = rows[q[0]][q[1]][1] - rows[p[0]][p[1]][1];
    const l = Math.hypot(dx, dz) || 1;
    return [dz / l, 0, -dx / l];
  };
  for (let j = 0; j < nx - 1; j++) {
    if (live[0][j]) edge([0, j], [0, j + 1], outOf([0, j + 1], [0, j]));
    if (live[nz - 2][j]) edge([nz - 1, j], [nz - 1, j + 1], outOf([nz - 1, j], [nz - 1, j + 1]));
  }
  for (let i = 0; i < nz - 1; i++) {
    if (live[i][0]) edge([i, 0], [i + 1, 0], outOf([i, 0], [i + 1, 0]));
    if (live[i][nx - 2]) edge([i, nx - 1], [i + 1, nx - 1], outOf([i + 1, nx - 1], [i, nx - 1]));
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nrm; vd.uvs = uv; vd.indices = idx;
  vd.applyToMesh(m);
  m.metadata = { uvDone: true };
  return m;
}

// Sweeps a closed 2D profile (distance into the road, height) along a run of kerb frames,
// capping both ends. The frames carry their own normal, which is what lets a kerb follow a
// corner return: a Frenet frame flips through the inflection every return has, and a fixed
// up vector cannot turn a corner at all.
function sweepMesh(scene, name, run, profile) {
  const n = profile.length;
  const pos = []; const uv = []; const idx = [];
  let along = 0;
  for (let i = 0; i < run.length; i++) {
    const f = run[i];
    if (i > 0) along += Math.hypot(f.x - run[i - 1].x, f.z - run[i - 1].z);
    const sink = sinkAt(f.x, f.z);
    for (const [d, y] of profile) { pos.push(f.x + f.nx * d, y - sink, f.z + f.nz * d); uv.push(along, y); }
  }
  for (let i = 0; i < run.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      // outward from the profile's own centroid, which is convex for every profile here
      const a = i * n + k; const b = i * n + k2; const c = (i + 1) * n + k2; const d = (i + 1) * n + k;
      const mx = (pos[a * 3] + pos[c * 3]) / 2; const my = (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2; const mz = (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2;
      const f = run[i];
      const cy = profile.reduce((s, p) => s + p[1], 0) / n;
      const cd = profile.reduce((s, p) => s + p[0], 0) / n;
      const ox = mx - (f.x + f.nx * cd); const oy = my - cy; const oz = mz - (f.z + f.nz * cd);
      quad(idx, pos, a, b, c, d, [ox, oy, oz]);
    }
  }
  for (const [base, dir] of [[0, -1], [(run.length - 1) * n, 1]]) {
    const f = run[base ? run.length - 1 : 0];
    const tx = base ? f.nz : -f.nz; const tz = base ? -f.nx : f.nx;
    for (let k = 1; k < n - 1; k++) tri(idx, pos, base, base + k, base + k + 1, [tx * dir, 0, tz * dir]);
  }
  // The normals come from the PROFILE, not from ComputeNormals. A swept kerb is a closed
  // polygon dragged along a path, so its outward direction is known exactly at every vertex
  // -- and computing it instead means trusting a winding convention that this file has
  // already had to measure once. A kerb lit from inside is not missing, it is DARK.
  let signed = 0;
  for (let k = 0; k < n; k++) {
    const [d0, y0] = profile[k]; const [d1, y1] = profile[(k + 1) % n];
    signed += d0 * y1 - d1 * y0;
  }
  const flip = signed > 0 ? 1 : -1;
  const nrm = new Array(pos.length).fill(0);
  for (let i = 0; i < run.length; i++) {
    const f = run[i];
    for (let k = 0; k < n; k++) {
      const [pd, py] = profile[(k - 1 + n) % n];
      const [cd, cy] = profile[k];
      const [nd, ny] = profile[(k + 1) % n];
      // average of the two adjacent edge normals, which rounds the chamfers and keeps the
      // flats flat
      let ed = 0; let ey = 0;
      for (const [ax, ay, bx, by] of [[pd, py, cd, cy], [cd, cy, nd, ny]]) {
        const dx = bx - ax; const dy = by - ay;
        const l = Math.hypot(dx, dy) || 1;
        ed += (dy / l) * flip; ey += (-dx / l) * flip;
      }
      const l = Math.hypot(ed, ey) || 1;
      const v = (i * n + k) * 3;
      nrm[v] = (ed / l) * f.nx; nrm[v + 1] = ey / l; nrm[v + 2] = (ed / l) * f.nz;
    }
  }
  const m = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos; vd.uvs = uv; vd.indices = idx; vd.normals = nrm;
  vd.applyToMesh(m);
  m.metadata = { uvDone: true };
  return m;
}


// The four kerb returns, as a band to stamp and to cut. A return's flare is the crescent
// between an arc of radius 18 and the square corner outside it, which is deepest (7.5ft) on
// the 45-degree bearing and pinches to nothing at both tangents -- so the band is centred on
// the MID-RADIUS, 21.7ft out from the arc's centre, and laid along the tangent there.
//
// The first pass centred it on the middle of the 18x18 corner square instead. That point is
// 12.7ft from the arc's centre, which is INSIDE the quarter disc -- so every return painted a
// triangle of somebody's front lawn as gravel and cut a wedge out of the grass beside the
// hackberry. [x, z, yaw]
const RETURN_BANDS = [
  [-54.3, 18.3, -Math.PI / 4],
  [-85.7, 18.3, Math.PI / 4],
  [-54.3, 49.7, Math.PI / 4],
  [-85.7, 49.7, -Math.PI / 4],
];

// ---------------------------------------------------------------------------
// THE STREET
// ---------------------------------------------------------------------------

export function street(kit, { seed = 1, aprons = [] } = {}) {
  const b = kit.builder('ts-street');
  // Asphalt is AGGREGATE. A smooth grey set reads as painted card at any tint, and the one
  // thing that makes a sixty-year-old chip seal look like itself is that you can see the
  // stones in it. Rough almost to matt, with the normal map turned down: at a grazing angle
  // -- which is every angle you see a road from -- a strong normal map turns tarmac into
  // gravel you could turn an ankle on.
  // `neutral: 0.72`, not 0.9, and a WARMER tint. Gravel022 photographs warm (0.227/0.213/
  // 0.174), so neutralising it fully swings the correction blue -- and under a blue sky
  // with a blue ambient the road came out navy. Leaving a quarter of the aggregate's own
  // warmth in is what makes it read as tarmac rather than as slate.
  const asphalt = kit.mat('Gravel022', { tint: TS.asphalt, neutral: 0.72, tile: 5.5, rough: 1.0, bump: 0.55 });
  const concrete = kit.mat('Concrete034', { tint: TS.concreteOld, neutral: 1, tile: 7, rough: 0.94, bump: 0.7 });

  for (const patch of pavementPatches()) {
    b.add(gridMesh(kit.scene, `road-${patch.name}`, patch.rows, roadHeight, { filter: (x, z) => !isPan(x, z) }), asphalt);
    b.add(gridMesh(kit.scene, `pan-${patch.name}`, patch.rows, roadHeight, { filter: (x, z) => isPan(x, z) }), concrete);
  }
  // The kerb. A slight batter on the face is not decoration: a dead-vertical kerb face never
  // catches the sun, so a whole street of them reads as a painted line rather than as six
  // inches of concrete standing up out of the gutter.
  const CURB_PROFILE = [
    [-PLAN.curbBack, PLAN.curbTop],
    [0, PLAN.curbTop],
    [0.05, PLAN.flow + 0.02],
    [0.05, PLAN.curbBase],
    [-PLAN.curbBack, PLAN.curbBase],
  ];
  curbRuns(aprons).forEach((run, i) => b.add(sweepMesh(kit.scene, `curb-${i}`, run, CURB_PROFILE), concrete));
  aprons.forEach((a, i) => b.add(gridMesh(kit.scene, `apron-${i}`, apronRows(a), (x, z) => apronHeight(x, z, a)), concrete));

  const root = b.finish({ castShadows: false, receiveShadows: true });
  // The street declares its own footprint so the lawn is kept off it without the mask having
  // to read six thousand road triangles back out of the scene. Both carriageways, full
  // length, plus the junction: the returns' flares are inside the two bands' reach.
  root.metadata.footprint = [
    { w: PLAN.reach * 2, d: PLAN.turkleS - PLAN.turkleN + 2.2, cx: 0, cz: (PLAN.turkleN + PLAN.turkleS) / 2, channel: 'path' },
    { w: PLAN.seventhE - PLAN.seventhW + 2.2, d: PLAN.reach * 2, cx: (PLAN.seventhW + PLAN.seventhE) / 2, cz: 0, channel: 'path' },
    // The four kerb returns. A square centred on the arc's CENTRE is exactly wrong -- that
    // point is the middle of the quarter-disc of LAWN the return curves around, so the first
    // pass painted eighteen feet of somebody's front garden as carriageway and the corner of
    // the hero lot came back as gravel. The flare is the band between the arc and the square
    // corner, so it is stamped as a rectangle lying along the DIAGONAL, which is the one
    // axis-aligned shape that fits a crescent.
    ...RETURN_BANDS.map(([cx, cz, yaw]) => ({ w: 23, d: 7.6, cx, cz, yaw, channel: 'path', strength: 0.9 })),
  ];
  root.metadata.instanceable = false;
  return root;
}

// ---------------------------------------------------------------------------
// Flatwork
// ---------------------------------------------------------------------------

// A concrete driveway, scored into panels. THE JOINTS ARE REAL GROOVES, because a driveway
// photographed at this angle is mostly joints -- and a joint drawn as a texture line has no
// shadow in it and reads as a pencil mark on a grey rectangle.
export function driveway(kit, { seed = 2, length = 52, width = 16, thickness = 0.42, panel = 10.5, crown = 0.05, lot = 0.06 } = {}) {
  const rng = seededRandom(seed);
  const b = kit.builder('ts-driveway');
  const slabMat = kit.mat('Concrete034', { tint: TS.concrete, neutral: 1, tile: 6, rough: 0.95, bump: 0.8 });
  const jointMat = kit.flat(0x59544a, { rough: 0.98 });
  const half = width / 2;
  const panels = Math.max(1, Math.round(length / panel));
  const zs = []; const joints = [];
  for (let i = 0; i <= panels; i++) {
    const z = -(length * i) / panels;
    if (i > 0 && i < panels) { zs.push(z + 0.06, z - 0.06); joints.push(z); } else zs.push(z);
  }
  const xs = [];
  for (let i = 0; i <= 10; i++) xs.push(-half + (width * i) / 10);
  const lift = new Map();
  for (let i = 0; i <= panels; i++) lift.set(i, (rng() - 0.5) * 0.035);
  const panelAt = (z) => Math.min(panels - 1, Math.max(0, Math.floor((-z / length) * panels + 0.5001)));
  const hAt = (x, z) => lot + crown * (1 - (Math.abs(x) / half) ** 2) + (lift.get(panelAt(z)) ?? 0);
  b.add(gridMesh(kit.scene, 'drive', zs.map((z) => xs.map((x) => [x, z])), hAt, { base: lot - thickness }), slabMat);
  for (const z of joints) b.add(kit.box(width, 0.1, 0.2, { bevel: 0.01 }), jointMat, { pos: [0, lot + 0.01, z] });
  b.add(kit.box(0.16, 0.09, length, { bevel: 0.01 }), jointMat, { pos: [0, lot + 0.012, -length / 2] });
  // The weeds in the joints. Every drive in these photographs has them, and they are the
  // cheapest thing in the file that says "somebody lives here" rather than "this was laid
  // last week".
  const weed = kit.flat(0x4d5c33, { rough: 0.9, doubleSided: true });
  for (const z of joints) {
    for (let t = 0; t < 3; t++) {
      if (rng() > 0.62) continue;
      const x = (rng() - 0.5) * width * 0.92;
      for (let k = 0; k < 4; k++) {
        b.add(kit.box(0.03, 0.3 + rng() * 0.22, 0.02), weed, { pos: [x + (rng() - 0.5) * 0.3, lot + 0.16, z], rot: [(rng() - 0.5) * 0.9, rng() * 3, (rng() - 0.5) * 0.9] });
      }
    }
  }
  const root = b.finish({ castShadows: false, receiveShadows: true });
  root.metadata.footprint = { w: width + 0.4, d: length + 0.4, cz: -length / 2, channel: 'path' };
  root.metadata.instanceable = false;
  return root;
}

// A concrete walk: the front walk from the porch to the drive, and the public sidewalk
// across the street. Scored every four feet.
export function walk(kit, { seed = 3, length = 30, width = 3.6, lot = 0.05, thickness = 0.3, panel = 4 } = {}) {
  const rng = seededRandom(seed);
  const b = kit.builder('ts-walk');
  const slabMat = kit.mat('Concrete034', { tint: TS.concreteOld, neutral: 1, tile: 6, rough: 0.95, bump: 0.8 });
  const jointMat = kit.flat(0x59544a, { rough: 0.98 });
  const half = width / 2;
  const panels = Math.max(1, Math.round(length / panel));
  const zs = []; const joints = [];
  for (let i = 0; i <= panels; i++) {
    const z = -(length * i) / panels;
    if (i > 0 && i < panels) { zs.push(z + 0.05, z - 0.05); joints.push(z); } else zs.push(z);
  }
  const tilt = new Map();
  for (let i = 0; i <= panels; i++) tilt.set(i, (rng() - 0.5) * 0.05);
  const panelAt = (z) => Math.min(panels - 1, Math.max(0, Math.floor((-z / length) * panels + 0.5001)));
  b.add(gridMesh(kit.scene, 'walk', zs.map((z) => [[-half, z], [0, z], [half, z]]),
    (x, z) => lot + (tilt.get(panelAt(z)) ?? 0) * (x / half), { base: lot - thickness }), slabMat);
  for (const z of joints) b.add(kit.box(width, 0.08, 0.14, { bevel: 0.01 }), jointMat, { pos: [0, lot + 0.01, z] });
  const root = b.finish({ castShadows: false, receiveShadows: true });
  root.metadata.footprint = { w: width + 0.3, d: length + 0.3, cz: -length / 2, channel: 'path' };
  root.metadata.instanceable = false;
  return root;
}

// ---------------------------------------------------------------------------
// Shared building parts
// ---------------------------------------------------------------------------

// Window glass that goes warm after dark. One shared pair per building kind, so a whole
// street lights up on one hook rather than three hundred.
function litGlass(kit, key, tint = 0x2c3b46) {
  // A CLEARCOAT rather than a lower roughness. A window seen from outside in daylight is a
  // dark pane with a hard sky reflection on it, and a plain dielectric at metallic 0 gives
  // the reflection nothing to bite on -- every window on the street came back as a flat
  // black rectangle, which is what a hole in a wall looks like, not glass.
  const m = kit.flat(tint, { rough: 0.05, metal: 0, emissive: 0xffc27a, emissiveIntensity: 0.0001, clearcoat: 1 });
  const glow = linear(0xffc27a);
  // 1.1, not 2.2. A lit pane is a LIGHT SOURCE in a bloom pipeline and its apparent size
  // grows with its brightness, so at the value that looks right on a 2ft bathroom window the
  // 8.6ft picture window beside it blooms into a white rectangle with no frame left in it.
  return { m, night: (dusk) => { m.emissiveColor = glow.scale(0.002 + dusk * 1.1); } };
}

// A HIP ROOF: four slopes, no gable ends, which is the shape of nearly every house on this
// block. The two end planes are TRIANGLES whose apexes land on the ends of a ridge that is
// `width - depth` long, and the overhang hangs BELOW the eave line rather than level with
// it. Built level, an overhang reads as a flat brim and the house looks like it is wearing a
// hat.
function hipRoof(kit, b, mat, { width, depth, eaveY, rise, overhang = 1.5, thick = 0.34, pos = [0, 0, 0] }) {
  const pitch = Math.atan2(rise, depth / 2);
  const ridgeHalf = Math.max(0.2, width / 2 - depth / 2);
  const eaveDrop = eaveY - overhang * Math.tan(pitch);
  const runZ = depth / 2 + overhang;
  const slopeZ = runZ / Math.cos(pitch);
  const halfW = width / 2 + overhang;
  const plane = (outline, yaw, eave) => {
    const nx = Math.sin(yaw) * Math.sin(pitch);
    const nz = Math.cos(yaw) * Math.sin(pitch);
    b.add(kit.prism(outline, thick), mat, {
      pos: [pos[0] + eave[0] - nx * thick * 0.5, pos[1] + eave[1] - Math.cos(pitch) * thick * 0.5, pos[2] + eave[2] - nz * thick * 0.5],
      rot: [pitch - Math.PI / 2, yaw, 0],
    });
  };
  const trap = [[-halfW, 0], [halfW, 0], [ridgeHalf, slopeZ], [-ridgeHalf, slopeZ]];
  plane(trap, 0, [0, eaveDrop, runZ]);
  plane(trap, Math.PI, [0, eaveDrop, -runZ]);
  const triangle = [[-runZ, 0], [runZ, 0], [0, slopeZ]];
  plane(triangle, Math.PI / 2, [halfW, eaveDrop, 0]);
  plane(triangle, -Math.PI / 2, [-halfW, eaveDrop, 0]);
  b.add(kit.box(ridgeHalf * 2 + 0.5, 0.22, 0.62, { bevel: 0.06 }), mat, { pos: [pos[0], pos[1] + eaveY + rise + thick * 0.62, pos[2]] });
  return { pitch, eaveDrop };
}

function gableRoof(kit, b, mat, { width, depth, eaveY, rise, overhang = 1.2, thick = 0.3, axis = 'x', pos = [0, 0, 0] }) {
  const span = (axis === 'x' ? depth : width) / 2;
  const pitch = Math.atan2(rise, span);
  const run = span + overhang;
  const slope = run / Math.cos(pitch);
  const len = (axis === 'x' ? width : depth) + overhang * 2;
  const eaveDrop = eaveY - overhang * Math.tan(pitch);
  for (const side of [1, -1]) {
    const yaw = axis === 'x' ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const nx = Math.sin(yaw) * Math.sin(pitch);
    const nz = Math.cos(yaw) * Math.sin(pitch);
    const eave = axis === 'x' ? [0, eaveDrop, side * run] : [side * run, eaveDrop, 0];
    b.add(kit.prism([[-len / 2, 0], [len / 2, 0], [len / 2, slope], [-len / 2, slope]], thick), mat, {
      pos: [pos[0] + eave[0] - nx * thick * 0.5, pos[1] + eave[1] - Math.cos(pitch) * thick * 0.5, pos[2] + eave[2] - nz * thick * 0.5],
      rot: [pitch - Math.PI / 2, yaw, 0],
    });
  }
  const capLen = len + 0.12;
  b.add(axis === 'x' ? kit.box(capLen, 0.2, 0.62, { bevel: 0.05 }) : kit.box(0.62, 0.2, capLen, { bevel: 0.05 }),
    mat, { pos: [pos[0], pos[1] + eaveY + rise + thick * 0.6, pos[2]] });
  return { pitch, eaveDrop };
}

// A window, built FORWARD of a solid wall -- there is no CSG here, so an opening cannot be
// cut, and what reads as a recess is the casing's own shadow. Pane 0.03 proud, muntin 0.07,
// casing 0.12, sill furthest of all. The same numbers as the three.js twin, so the two
// editions put the glass in the same place.
function windowUnit(kit, b, {
  x, y, z, w = 3, h = 3.6, ry = 0, lights = 2, rails = 1, sill = true, screen = false,
  trimMat, glassMat, screenMat,
}) {
  const c = Math.cos(ry); const s = Math.sin(ry);
  const at = (dx, dy, out) => [x + dx * c + out * s, y + dy, z - dx * s + out * c];
  const R = [0, ry, 0];
  b.add(kit.box(w, h, 0.05), glassMat, { pos: at(0, 0, 0.03), rot: R });
  if (screen && screenMat) b.add(kit.box(w - 0.1, h / 2 - 0.06, 0.04), screenMat, { pos: at(0, -h / 4, 0.055), rot: R });
  for (let i = 1; i < lights; i++) b.add(kit.box(0.1, h, 0.05, { bevel: 0.015 }), trimMat, { pos: at(-w / 2 + (i * w) / lights, 0, 0.07), rot: R });
  for (let i = 1; i <= rails; i++) b.add(kit.box(w, 0.1, 0.05, { bevel: 0.015 }), trimMat, { pos: at(0, -h / 2 + (i * h) / (rails + 1), 0.07), rot: R });
  for (const sx of [-1, 1]) b.add(kit.box(0.22, h + 0.34, 0.12, { bevel: 0.025 }), trimMat, { pos: at(sx * (w / 2 + 0.1), 0, 0.07), rot: R });
  b.add(kit.box(w + 0.54, 0.24, 0.14, { bevel: 0.03 }), trimMat, { pos: at(0, h / 2 + 0.16, 0.08), rot: R });
  if (sill) b.add(kit.box(w + 0.62, 0.16, 0.34, { bevel: 0.03 }), trimMat, { pos: at(0, -h / 2 - 0.11, 0.14), rot: R });
}

// The front door, and the ALUMINIUM STORM DOOR in front of it. At any distance the door
// itself is invisible: what you see is a bright frame round a dark rectangle, a mid-rail and
// a kick panel. Modelling the panelled door alone and leaving the storm off is the single
// easiest way to make an American house look European.
function doorUnit(kit, b, {
  x, y, z, w = 3.2, h = 6.7, ry = 0, storm = true,
  doorMat, trimMat, metalMat, glassMat, brassMat,
}) {
  const c = Math.cos(ry); const s = Math.sin(ry);
  const at = (dx, dy, out) => [x + dx * c + out * s, y + dy, z - dx * s + out * c];
  const R = [0, ry, 0];
  b.add(kit.box(w, h, 0.16, { bevel: 0.03 }), doorMat, { pos: at(0, h / 2, 0.08), rot: R });
  for (const [dy, dh] of [[h * 0.71, h * 0.26], [h * 0.3, h * 0.34]]) {
    b.add(kit.box(w * 0.66, dh, 0.04, { bevel: 0.02 }), doorMat, { pos: at(0, dy, 0.165), rot: R });
  }
  b.add(kit.sphere(0.09, { segments: 10 }), brassMat, { pos: at(w * 0.33, h * 0.5, 0.2) });
  if (storm) {
    for (const dy of [h - 0.06, h * 0.46, h * 0.2]) b.add(kit.box(w + 0.1, 0.12, 0.09, { bevel: 0.02 }), metalMat, { pos: at(0, dy, 0.24), rot: R });
    for (const sx of [-1, 1]) b.add(kit.box(0.14, h, 0.09, { bevel: 0.02 }), metalMat, { pos: at(sx * (w / 2 + 0.02), h / 2, 0.24), rot: R });
    b.add(kit.box(w - 0.16, h * 0.5, 0.03), glassMat, { pos: at(0, h * 0.72, 0.22), rot: R });
    b.add(kit.box(0.1, 0.5, 0.1, { bevel: 0.02 }), metalMat, { pos: at(w * 0.3, h * 0.5, 0.29), rot: R });
  }
  for (const sx of [-1, 1]) b.add(kit.box(0.24, h + 0.28, 0.2, { bevel: 0.03 }), trimMat, { pos: at(sx * (w / 2 + 0.14), (h + 0.28) / 2 - 0.14, 0.1), rot: R });
  b.add(kit.box(w + 0.7, 0.26, 0.22, { bevel: 0.03 }), trimMat, { pos: at(0, h + 0.14, 0.11), rot: R });
}

// ---------------------------------------------------------------------------
// Generated surface patterns -- the one place this world does NOT use a photograph
// ---------------------------------------------------------------------------
//
// THERE IS NO LAP SIDING AND NO ASPHALT SHINGLE IN THE TEXTURE LIBRARY, and those are two of
// the three surfaces this world is mostly made of. `Planks012` is a staggered plank FLOOR --
// on a wall it reads as brickwork -- and `RoofingTiles013A` is barrel clay tile, which is a
// Mediterranean roof and not a Kansas one. Tinting either of them harder does not help,
// because what is wrong is the PATTERN, not the colour.
//
// So these four are drawn: a near-white height field turned into an albedo and a real
// tangent-space NORMAL map, with the paint colour carried by `albedoColor`. That is the main
// app's own "surface courses are texture, never geometry and never tint" rule arriving here,
// and it buys the thing a photograph cannot: the courses are at the RIGHT SPACING. Lap siding
// is a four-inch exposure. At any tile that makes a plank photo's boards four inches, its
// mortar-like staggered joints become a grid of 4in blocks, which is stucco.
//
// The normal map is a Sobel of the height field and it WRAPS, because the tile tiles.
// Materials are cached per (kind, colour) at module scope: a street of nineteen buildings in
// six colours is six materials, not nineteen.

const PATTERNS = new Map();

function patternCanvas(kind, seed) {
  const px = 512;
  const alb = document.createElement('canvas'); alb.width = alb.height = px;
  const hgt = document.createElement('canvas'); hgt.width = hgt.height = px;
  const a = alb.getContext('2d'); const h = hgt.getContext('2d');
  const rand = seededRandom(seed);
  const grey = (ctx, v) => { const b = Math.round(Math.max(0, Math.min(1, v)) * 255); ctx.fillStyle = `rgb(${b},${b},${b})`; };

  if (kind === 'lap' || kind === 'board') {
    // Sixteen courses over the tile. `board` is the same field turned a quarter turn, which
    // is what a fence is: the same sawn stock stood on end.
    const n = 16;
    const step = px / n;
    grey(a, 0.95); a.fillRect(0, 0, px, px);
    grey(h, 0.8); h.fillRect(0, 0, px, px);
    for (let i = 0; i < n; i++) {
      const y = i * step;
      const v = 0.9 + rand() * 0.1;
      grey(a, v); a.fillRect(0, y, px, step);
      // the lit strip just under the butt above, and the shadow reveal at the butt itself
      grey(a, Math.min(1, v + 0.05)); a.fillRect(0, y + step * 0.12, px, step * 0.3);
      grey(a, v * 0.62); a.fillRect(0, y + step - step * 0.13, px, step * 0.13);
      grey(h, 0.86 + rand() * 0.1); h.fillRect(0, y, px, step * 0.87);
      grey(h, 0.18); h.fillRect(0, y + step * 0.87, px, step * 0.13);
      // grain: fine streaks ALONG the board, which is what stops a flat course reading as card
      for (let k = 0; k < 90; k++) {
        const gy = y + rand() * step * 0.85;
        grey(a, v * (0.965 + rand() * 0.05)); a.fillRect(rand() * px, gy, 40 + rand() * 120, 1);
      }
    }
  } else if (kind === 'shingle') {
    // Three-tab: eight courses, each with tab slots, staggered half a tab per course. The
    // SLOTS are what stops a roof reading as a painted plane at fifty feet.
    const n = 8;
    const step = px / n;
    const tabs = 6;
    grey(a, 0.93); a.fillRect(0, 0, px, px);
    grey(h, 0.75); h.fillRect(0, 0, px, px);
    for (let i = 0; i < n; i++) {
      const y = i * step;
      const v = 0.88 + rand() * 0.12;
      grey(a, v); a.fillRect(0, y, px, step);
      // granules
      for (let k = 0; k < 900; k++) { grey(a, v * (0.82 + rand() * 0.3)); a.fillRect(rand() * px, y + rand() * step, 1.6, 1.6); }
      grey(a, v * 0.55); a.fillRect(0, y + step - step * 0.11, px, step * 0.11);
      grey(h, 0.8 + rand() * 0.12); h.fillRect(0, y, px, step * 0.89);
      grey(h, 0.12); h.fillRect(0, y + step * 0.89, px, step * 0.11);
      const off = (i % 2) * (px / (tabs * 2));
      for (let t = 0; t < tabs; t++) {
        const x = off + (t * px) / tabs;
        grey(a, v * 0.6); a.fillRect(x, y + step * 0.3, 3, step * 0.62);
        grey(h, 0.3); h.fillRect(x, y + step * 0.3, 3, step * 0.62);
      }
    }
  } else { // 'seam' -- standing-seam metal
    const n = 6;
    const step = px / n;
    grey(a, 0.97); a.fillRect(0, 0, px, px);
    grey(h, 0.55); h.fillRect(0, 0, px, px);
    for (let i = 0; i < n; i++) {
      const x = i * step;
      grey(a, 0.93 + rand() * 0.06); a.fillRect(x, 0, step, px);
      grey(a, 0.74); a.fillRect(x, 0, 5, px);
      grey(a, 1.0); a.fillRect(x + 5, 0, 4, px);
      grey(h, 0.5); h.fillRect(x, 0, step, px);
      grey(h, 1.0); h.fillRect(x, 0, 9, px);
    }
  }
  return { alb, hgt, px };
}

// Height field -> tangent-space normal map, wrapped. The bump slot in Babylon takes NORMALS,
// never heights, and a height map pushed into it renders as a smear of blue.
function normalFromHeight(hgt, px, strength) {
  const src = hgt.getContext('2d').getImageData(0, 0, px, px).data;
  const out = document.createElement('canvas'); out.width = out.height = px;
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(px, px);
  const at = (x, y) => src[(((y + px) % px) * px + ((x + px) % px)) * 4] / 255;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(-dx, -dy, 1);
      const o = (y * px + x) * 4;
      img.data[o] = Math.round(((-dx / l) * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round(((-dy / l) * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function patternMat(kit, kind, colour, { tile, rough = 0.78, metal = 0, seed = 7, strength = 9 } = {}) {
  const key = `${kind}|${colour}|${tile}|${rough}|${metal}`;
  if (PATTERNS.has(key)) return PATTERNS.get(key);
  const { alb, hgt, px } = patternCanvas(kind, seed);
  const m = new PBRMaterial(`ts-${kind}-${colour.toString(16)}`, kit.scene);
  const albTex = new DynamicTexture(`${key}-a`, alb, kit.scene, true);
  albTex.anisotropicFilteringLevel = 16;
  albTex.update(true);
  const nrmTex = new DynamicTexture(`${key}-n`, normalFromHeight(hgt, px, strength), kit.scene, false);
  nrmTex.anisotropicFilteringLevel = 8;
  nrmTex.update(true);
  // A DynamicTexture does NOT wrap by default, and these are sampled in FEET -- the Builder
  // box-projects a wall's UVs as position/tile, so v runs past 1 on anything taller than the
  // tile. Clamped, every wall above 5.3ft showed the canvas's last texel row stretched to the
  // eave: a flat olive band across the top half of every house and garage on the street,
  // with the courses stopping dead at a horizontal line halfway up. It read as a lighting
  // artifact and was an address-mode one.
  for (const t of [albTex, nrmTex]) { t.wrapU = Texture.WRAP_ADDRESSMODE; t.wrapV = Texture.WRAP_ADDRESSMODE; }
  m.albedoTexture = albTex;
  m.bumpTexture = nrmTex;
  m.invertNormalMapX = false;
  m.invertNormalMapY = false;
  m.albedoColor = linear(colour);
  m.metallic = metal;
  m.roughness = rough;
  m.metadata = { tile };
  PATTERNS.set(key, m);
  return m;
}

// Lap siding at a FOUR-INCH exposure: sixteen courses over a 5.3ft tile. TWO numbers decide
// whether it reads at all.
//
// `neutral` is the first -- see below. The second is that the boards have to run
// HORIZONTALLY, and they already do: the Builder box-projects a wall's UVs in feet from its
// own dominant axis, so u runs across the elevation and v up it, and `Planks012` is
// photographed with its planks along u. Turning them with `uvRot` -- which looked like the
// obvious thing to do -- clad the entire street in vertical barn board, and at a 6in board
// width that does not read as barn board either; it reads as corduroy.
const lapMat = (kit, colour) => patternMat(kit, 'lap', colour, { tile: 5.33, rough: 0.82, seed: 11, strength: 7 });
const shingleMat = (kit, colour) => patternMat(kit, 'shingle', colour, { tile: 3.2, rough: 0.92, seed: 13, strength: 8 });
const seamMat = (kit, colour) => patternMat(kit, 'seam', colour, { tile: 4.0, rough: 0.42, metal: 0.55, seed: 17, strength: 12 });
const boardMat = (kit, colour) => patternMat(kit, 'board', colour, { tile: 3.0, rough: 0.94, seed: 19, strength: 8 });

// ---------------------------------------------------------------------------
// THE HERO: 1400 North Turkle Avenue
// ---------------------------------------------------------------------------

export function ranchHouse(kit, {
  seed = 11, width = 46, depth = 28, eave = 10.2, rise = 4.4,
  siding = TS.siding, roofColour = TS.shingle, trimCol = TS.trimDark, sashCol = TS.trimWhite,
  doorCol = TS.doorBrown, gableWidth = 14, gableRise = 5.6,
  porchFrom = -9.5, porchTo = 12.5, porchDepth = 7, flag = true, cellar = true,
} = {}) {
  const b = kit.builder('ts-ranch-house');
  const lap = lapMat(kit, siding);
  const roof = shingleMat(kit, roofColour);
  const block = kit.mat('Concrete034', { tint: TS.foundation, neutral: 1, tile: 4, rough: 0.94, bump: 0.8 });
  const trim = kit.flat(trimCol, { rough: 0.55 });
  const sash = kit.flat(sashCol, { rough: 0.5 });
  const door = kit.flat(doorCol, { rough: 0.42, clearcoat: 0.35 });
  const metal = kit.flat(TS.galv, { rough: 0.3, metal: 0.85 });
  const brass = kit.flat(TS.brass, { rough: 0.28, metal: 0.9 });
  const screen = kit.flat(0x1b2126, { rough: 0.95 });
  const conc = kit.mat('Concrete034', { tint: TS.concreteOld, neutral: 1, tile: 5, rough: 0.95, bump: 0.7 });
  const glass = litGlass(kit, 'ts-house');
  const white = kit.flat(TS.trimWhite, { rough: 0.44 });

  const halfW = width / 2; const halfD = depth / 2;
  const FLOOR = 1.35; const BLOCK = 1.5;

  // shell: painted block foundation, then lap siding. `uvRot` on every wall is what lays the
  // courses horizontally -- see lapMat.
  b.add(kit.box(width + 0.36, BLOCK, depth + 0.36, { bevel: 0.06 }), block, { pos: [0, BLOCK / 2, 0] });
  b.add(kit.box(width, eave - BLOCK, depth, { bevel: 0.05 }), lap, { pos: [0, BLOCK + (eave - BLOCK) / 2, 0] });

  hipRoof(kit, b, roof, { width, depth, eaveY: eave, rise, overhang: 1.5 });
  const gx = -halfW + gableWidth / 2;
  gableRoof(kit, b, roof, { width: gableWidth, depth, eaveY: eave, rise: gableRise, overhang: 1.2, axis: 'z', pos: [gx, 0, 0] });
  for (const sz of [1, -1]) {
    b.add(kit.prism([[-gableWidth / 2, 0], [gableWidth / 2, 0], [0, gableRise]], 0.5), lap, { pos: [gx, eave, sz * (halfD - 0.25)] });
    b.add(kit.box(1.6, 1.1, 0.14, { bevel: 0.03 }), trim, { pos: [gx, eave + gableRise * 0.5, sz * (halfD + 0.06)] });
  }

  const W = { trimMat: sash, glassMat: glass.m, screenMat: screen };
  windowUnit(kit, b, { x: -16.5, y: FLOOR + 4.6, z: halfD, w: 3.0, h: 3.6, lights: 2, screen: true, ...W });
  windowUnit(kit, b, { x: 17.5, y: FLOOR + 4.7, z: halfD, w: 8.6, h: 4.2, lights: 3, rails: 0, ...W });
  windowUnit(kit, b, { x: 4.6, y: FLOOR + 4.3, z: halfD, w: 4.4, h: 3.2, lights: 2, rails: 0, screen: true, ...W });
  doorUnit(kit, b, { x: -4.0, y: FLOOR, z: halfD, doorMat: door, trimMat: sash, metalMat: metal, glassMat: glass.m, brassMat: brass });

  // --- the porch ---
  const pw = porchTo - porchFrom;
  const pcx = (porchFrom + porchTo) / 2;
  const DECK = 1.05;
  const pz = halfD + porchDepth;
  b.add(kit.box(pw + 0.6, DECK, porchDepth + 0.3, { bevel: 0.05 }), conc, { pos: [pcx, DECK / 2, halfD + porchDepth / 2 + 0.15] });
  b.add(kit.box(pw + 0.9, 0.16, porchDepth + 0.5, { bevel: 0.04 }), conc, { pos: [pcx, DECK + 0.08, halfD + porchDepth / 2 + 0.15] });
  for (let i = 0; i < 2; i++) b.add(kit.box(5.2, 0.36, 1.05 - i * 0.05, { bevel: 0.04 }), conc, { pos: [-4.0, 0.18 + i * 0.36, pz + 0.5 - i * 0.55] });
  const POST_TOP = eave - 1.05;
  for (const x of [porchFrom + 0.5, porchFrom + pw * 0.34, porchFrom + pw * 0.67, porchTo - 0.5]) {
    b.add(kit.box(0.52, POST_TOP - DECK, 0.52, { bevel: 0.04 }), trim, { pos: [x, DECK + (POST_TOP - DECK) / 2, pz - 0.5] });
    b.add(kit.box(0.72, 0.14, 0.72, { bevel: 0.03 }), trim, { pos: [x, POST_TOP - 0.07, pz - 0.5] });
    b.add(kit.box(0.7, 0.12, 0.7, { bevel: 0.03 }), trim, { pos: [x, DECK + 0.06, pz - 0.5] });
  }
  b.add(kit.box(pw + 1.1, 0.62, 0.5, { bevel: 0.05 }), trim, { pos: [pcx, POST_TOP + 0.31, pz - 0.5] });
  // The porch roof is a SEPARATE SHED whose low fascia sits at exactly the main roof's
  // fascia height, which is what makes the eave read as one straight line across the whole
  // front -- what the photographs show -- without the hip having to grow a stepped eave.
  const mainPitch = Math.atan2(rise, halfD);
  const fascia = eave - 1.5 * Math.tan(mainPitch);
  const porchHigh = eave + 0.45;
  const porchRun = porchDepth + 1.1;
  const porchTilt = Math.atan2(porchHigh - fascia, porchRun);
  b.add(kit.box(pw + 1.8, 0.3, Math.hypot(porchRun, porchHigh - fascia), { bevel: 0.04 }), roof, {
    pos: [pcx, (fascia + porchHigh) / 2 + 0.16, halfD + porchRun / 2 - 0.55], rot: [-porchTilt, 0, 0],
  });
  b.add(kit.box(pw + 1.9, 0.5, 0.22, { bevel: 0.03 }), trim, { pos: [pcx, fascia - 0.14, pz + 0.55] });
  b.add(kit.box(pw + 0.7, 0.1, porchDepth + 0.7), kit.flat(mix(sashCol, 0x000000, 0.08), { rough: 0.7 }), { pos: [pcx, fascia - 0.02, halfD + porchDepth / 2] });
  b.add(kit.box(0.4, 0.2, 0.3, { bevel: 0.03 }), trim, { pos: [-6.1, FLOOR + 5.4, halfD + 0.16] });
  b.add(kit.lathe([[0, 0], [0.3, 0.2], [0.24, 0.62], [0.1, 0.72], [0, 0.74]], { sides: 10 }), glass.m, { pos: [-6.1, FLOOR + 5.2, halfD + 0.34] });

  // --- fascia, gutters, downspouts ---
  for (const sz of [1, -1]) {
    b.add(kit.box(width + 3.2, 0.42, 0.18, { bevel: 0.03 }), trim, { pos: [0, fascia - 0.2, sz * (halfD + 1.48)] });
    b.add(kit.box(width + 3.2, 0.34, 0.34, { bevel: 0.05 }), kit.flat(mix(trimCol, 0xffffff, 0.1), { rough: 0.5 }), { pos: [0, fascia - 0.5, sz * (halfD + 1.36)] });
  }
  const spout = kit.flat(mix(trimCol, 0xffffff, 0.1), { rough: 0.5 });
  for (const [sx, sz] of [[-1, 1], [1, -1]]) {
    const x = sx * (halfW - 0.5); const z = sz * (halfD + 0.22);
    b.add(kit.box(0.3, fascia - 0.6, 0.24, { bevel: 0.03 }), spout, { pos: [x, (fascia - 0.6) / 2, z] });
    b.add(kit.box(0.34, 0.3, 0.9, { bevel: 0.03 }), spout, { pos: [x, 0.15, z + sz * 0.4] });
  }

  // --- other elevations ---
  windowUnit(kit, b, { x: halfW, y: FLOOR + 4.6, z: 4, ry: Math.PI / 2, w: 2.6, h: 3.4, screen: true, ...W });
  windowUnit(kit, b, { x: halfW, y: FLOOR + 4.6, z: -5.5, ry: Math.PI / 2, w: 2.6, h: 3.4, screen: true, ...W });
  windowUnit(kit, b, { x: -halfW, y: FLOOR + 4.6, z: -4, ry: -Math.PI / 2, w: 2.6, h: 3.4, screen: true, ...W });
  windowUnit(kit, b, { x: -halfW, y: FLOOR + 4.6, z: -10, ry: -Math.PI / 2, w: 2.2, h: 2.4, ...W });
  windowUnit(kit, b, { x: -8, y: FLOOR + 4.6, z: -halfD, ry: Math.PI, w: 3.2, h: 3.4, screen: true, ...W });
  windowUnit(kit, b, { x: 4, y: FLOOR + 4.6, z: -halfD, ry: Math.PI, w: 3.2, h: 3.4, screen: true, ...W });
  doorUnit(kit, b, { x: 13, y: FLOOR, z: -halfD, ry: Math.PI, w: 3.0, doorMat: door, trimMat: sash, metalMat: metal, glassMat: glass.m, brassMat: brass });
  b.add(kit.box(4.6, 0.5, 3.4, { bevel: 0.05 }), conc, { pos: [13, 0.25, -halfD - 1.7] });

  // --- chimney ---
  b.add(kit.box(2.0, eave + rise + 1.4, 1.6, { bevel: 0.05 }), block, { pos: [8, (eave + rise + 1.4) / 2, -3] });
  b.add(kit.box(2.34, 0.4, 1.94, { bevel: 0.05 }), block, { pos: [8, eave + rise + 1.6, -3] });
  b.add(kit.box(0.7, 0.5, 0.5, { bevel: 0.04 }), kit.flat(TS.galvDark, { rough: 0.5, metal: 0.7 }), { pos: [8, eave + rise + 2.0, -3] });

  // --- the flag ---
  // A 3x5 raked out of a wall bracket at forty degrees, with a fold in it. The rake and the
  // droop are the whole thing: a flat plate on the wall reads as a poster.
  if (flag) {
    const bx = -10.5; const by = FLOOR + 6.3;
    const rake = 0.72;
    const dir = [0, Math.sin(rake), Math.cos(rake)];
    b.add(kit.box(0.34, 0.34, 0.2, { bevel: 0.03 }), trim, { pos: [bx, by, halfD + 0.1] });
    b.add(kit.cyl(0.075, 0.09, 5.6, { sides: 8 }), kit.flat(mix(TS.brass, 0xffffff, 0.35), { rough: 0.3, metal: 0.8 }),
      { pos: [bx, by + (dir[1] * 5.6) / 2, halfD + 0.2 + (dir[2] * 5.6) / 2], rot: [Math.PI / 2 - rake, 0, 0] });
    b.add(kit.sphere(0.13, { segments: 8 }), kit.flat(mix(TS.brass, 0xffffff, 0.5), { rough: 0.25, metal: 0.9 }),
      { pos: [bx, by + dir[1] * 5.6, halfD + 0.2 + dir[2] * 5.6] });
    const red = kit.flat(TS.flagRed, { rough: 0.85 });
    const wht = kit.flat(TS.flagWhite, { rough: 0.85 });
    const blu = kit.flat(TS.flagBlue, { rough: 0.85 });
    const FW = 3.0; const FH = 1.9;
    for (let i = 0; i < 12; i++) {
      const t0 = i / 12; const t1 = (i + 1) / 12;
      const a0 = 1.0 + t0 * FW; const a1 = 1.0 + t1 * FW;
      const y0 = by + dir[1] * a0 - t0 * t0 * 0.55; const y1 = by + dir[1] * a1 - t1 * t1 * 0.55;
      const z0 = halfD + 0.2 + dir[2] * a0; const z1 = halfD + 0.2 + dir[2] * a1;
      const len = Math.hypot(y1 - y0, z1 - z0) + 0.02;
      const wave = Math.sin(t0 * 5.2) * 0.12;
      for (let k = 0; k < 6; k++) {
        const yy = -FH / 2 + (FH * (k + 0.5)) / 6;
        const mat = t0 < 0.42 && k >= 3 ? blu : (k + Math.floor(t0 * 7)) % 2 ? wht : red;
        b.add(kit.box(0.06, FH / 6 + 0.01, len), mat, {
          pos: [bx + wave + yy * 0.05, (y0 + y1) / 2 + yy + FH / 2 - 0.1, (z0 + z1) / 2],
          rot: [rake - 0.32 - t0 * 0.12, Math.PI / 2, 0],
        });
      }
    }
  }

  // --- the cellar bulkhead, at the west end of the FRONT elevation ---
  // Two steel leaves meeting at a low ridge, leaning back on the foundation. A single flat
  // plate reads as a slab of polystyrene; it is the ridge and the two slopes that say "this
  // opens". It is in three of the six photographs and nobody ever models one.
  if (cellar) {
    const cx = -halfW + 3.6; const cz = halfD + 1.55;
    for (const sx of [-1, 1]) b.add(kit.box(0.42, 1.55, 3.3, { bevel: 0.04 }), block, { pos: [cx + sx * 2.1, 0.78, cz] });
    b.add(kit.box(4.6, 0.36, 0.4, { bevel: 0.04 }), block, { pos: [cx, 0.18, cz + 1.65] });
    for (const sx of [-1, 1]) b.add(kit.box(2.3, 0.13, 3.5, { bevel: 0.03 }), white, { pos: [cx + sx * 1.05, 0.92, cz], rot: [0, 0, sx * -0.42] });
    b.add(kit.box(0.26, 0.16, 3.6, { bevel: 0.04 }), kit.flat(mix(TS.trimWhite, 0x000000, 0.22), { rough: 0.5 }), { pos: [cx, 1.63, cz - 0.02] });
    b.add(kit.box(4.5, 0.12, 0.3, { bevel: 0.03 }), kit.flat(mix(TS.trimWhite, 0x000000, 0.3), { rough: 0.5 }), { pos: [cx, 0.62, cz + 1.62] });
    b.add(kit.box(0.5, 0.1, 0.2, { bevel: 0.02 }), kit.flat(TS.galvDark, { rough: 0.4, metal: 0.8 }), { pos: [cx + 1.4, 0.72, cz + 1.6] });
  }

  const root = b.finish();
  root.metadata.nightLights = [glass.night];
  root.metadata.lights = [{ pos: [-6.1, FLOOR + 5.2, halfD + 1.2], color: 0xffcf8a, intensity: 26, range: 22 }];
  root.metadata.footprint = { w: width + 5, d: depth + porchDepth + 5, cz: porchDepth / 2 };
  return root;
}

// ---------------------------------------------------------------------------
// The detached garage
// ---------------------------------------------------------------------------

export function garage(kit, {
  seed = 12, width = 26, depth = 24, eave = 9.2, rise = 4.6,
  siding = TS.siding, roofColour = TS.shingle, trimCol = TS.trimDark, doorColour = TS.garageDoor,
  doorWidth = 16, doorHeight = 7.2,
} = {}) {
  const b = kit.builder('ts-garage');
  const lap = lapMat(kit, siding);
  const roof = shingleMat(kit, roofColour);
  const block = kit.mat('Concrete034', { tint: TS.foundation, neutral: 1, tile: 4, rough: 0.94, bump: 0.8 });
  const trim = kit.flat(trimCol, { rough: 0.55 });
  const panelMat = kit.flat(doorColour, { rough: 0.45 });
  const panelDark = kit.flat(mix(doorColour, 0x000000, 0.28), { rough: 0.5 });
  const white = kit.flat(TS.trimWhite, { rough: 0.5 });
  const reveal = kit.flat(mix(trimCol, 0x000000, 0.45), { rough: 0.85 });
  const glass = litGlass(kit, 'ts-garage');
  const halfW = width / 2; const halfD = depth / 2;

  b.add(kit.box(width + 0.4, 0.55, depth + 0.4, { bevel: 0.05 }), block, { pos: [0, 0.27, 0] });
  b.add(kit.box(width, eave, depth, { bevel: 0.05 }), lap, { pos: [0, eave / 2, 0] });
  gableRoof(kit, b, roof, { width, depth, eaveY: eave, rise, overhang: 1.1, axis: 'z' });
  for (const sz of [1, -1]) {
    b.add(kit.prism([[-halfW, 0], [halfW, 0], [0, rise]], 0.5), lap, { pos: [0, eave, sz * (halfD - 0.25)] });
    b.add(kit.box(width + 2.4, 0.4, 0.2, { bevel: 0.03 }), trim, { pos: [0, eave - 0.2, sz * (halfD + 1.02)] });
  }

  // The overhead door is the whole elevation: four rows of stamped panels in near-white, a
  // dark reveal round them, and nothing else at all.
  const dz = halfD + 0.02;
  b.add(kit.box(doorWidth + 0.5, doorHeight + 0.3, 0.2), reveal, { pos: [0, doorHeight / 2, dz] });
  b.add(kit.box(doorWidth, doorHeight, 0.1, { bevel: 0.02 }), kit.flat(mix(doorColour, 0x000000, 0.12), { rough: 0.5 }), { pos: [0, doorHeight / 2, dz + 0.1] });
  for (let r = 0; r < 4; r++) {
    const y = (doorHeight * (r + 0.5)) / 4;
    for (let c = 0; c < 4; c++) {
      b.add(kit.box(doorWidth / 4 - 0.16, doorHeight / 4 - 0.16, 0.12, { bevel: 0.03 }), panelMat, { pos: [-doorWidth / 2 + (doorWidth * (c + 0.5)) / 4, y, dz + 0.16] });
    }
    b.add(kit.box(doorWidth, 0.1, 0.16, { bevel: 0.02 }), panelDark, { pos: [0, y + doorHeight / 8, dz + 0.14] });
  }
  b.add(kit.box(doorWidth + 0.9, 0.3, 0.34, { bevel: 0.03 }), white, { pos: [0, doorHeight + 0.2, dz + 0.1] });
  for (const sx of [-1, 1]) b.add(kit.box(0.34, doorHeight + 0.4, 0.34, { bevel: 0.03 }), white, { pos: [sx * (doorWidth / 2 + 0.34), (doorHeight + 0.4) / 2, dz + 0.1] });
  b.add(kit.box(1.9, 0.5, 0.26, { bevel: 0.03 }), trim, { pos: [0, doorHeight + 0.9, dz + 0.12] });

  doorUnit(kit, b, {
    x: halfW, y: 0, z: -6, ry: Math.PI / 2, w: 2.9, h: 6.6, storm: false,
    doorMat: lapMat(kit, mix(siding, 0x000000, 0.12)), trimMat: trim, metalMat: white, glassMat: glass.m, brassMat: kit.flat(TS.brass, { rough: 0.3, metal: 0.9 }),
  });
  const W = { trimMat: white, glassMat: glass.m };
  windowUnit(kit, b, { x: halfW, y: 5.2, z: 2, ry: Math.PI / 2, w: 2.4, h: 2.6, ...W });
  windowUnit(kit, b, { x: -halfW, y: 5.2, z: 0, ry: -Math.PI / 2, w: 2.4, h: 2.6, ...W });

  const root = b.finish();
  root.metadata.nightLights = [glass.night];
  root.metadata.footprint = { w: width + 4, d: depth + 4 };
  return root;
}

// ---------------------------------------------------------------------------
// The neighbours
// ---------------------------------------------------------------------------

export function neighborHouse(kit, {
  seed = 21, width = 38, depth = 26, eave = 9.6, rise = 4.7,
  siding = TS.sidingWhite, roofColour = 0x6b6d70, roofKind = 'shingle',
  trimCol = TS.trimWhite, doorCol = TS.doorBrown, roof = 'hip',
  garage: hasGarage = false, garageWidth = 13, stoop = true, chimney = true,
} = {}) {
  const b = kit.builder('ts-neighbor-house');
  const lap = lapMat(kit, siding);
  const roofMat = roofKind === 'seam'
    ? seamMat(kit, roofColour)
    : shingleMat(kit, roofColour);
  const block = kit.mat('Concrete034', { tint: TS.foundation, neutral: 1, tile: 4, rough: 0.94, bump: 0.8 });
  const trim = kit.flat(trimCol, { rough: 0.5 });
  const door = kit.flat(doorCol, { rough: 0.42, clearcoat: 0.3 });
  const conc = kit.mat('Concrete034', { tint: TS.concreteOld, neutral: 1, tile: 5, rough: 0.95, bump: 0.7 });
  const metal = kit.flat(TS.galv, { rough: 0.3, metal: 0.85 });
  const brass = kit.flat(TS.brass, { rough: 0.28, metal: 0.9 });
  const screen = kit.flat(0x1b2126, { rough: 0.95 });
  const glass = litGlass(kit, 'ts-nb');
  const FLOOR = 1.2;
  const halfD = depth / 2;
  const bodyW = hasGarage ? width - garageWidth : width;
  const halfB = bodyW / 2;
  const bx = hasGarage ? -garageWidth / 2 : 0;

  b.add(kit.box(bodyW + 0.32, 1.3, depth + 0.32, { bevel: 0.05 }), block, { pos: [bx, 0.65, 0] });
  b.add(kit.box(bodyW, eave - 1.3, depth, { bevel: 0.05 }), lap, { pos: [bx, 1.3 + (eave - 1.3) / 2, 0] });
  if (roof === 'hip') hipRoof(kit, b, roofMat, { width: bodyW, depth, eaveY: eave, rise, overhang: 1.4, pos: [bx, 0, 0] });
  else {
    gableRoof(kit, b, roofMat, { width: bodyW, depth, eaveY: eave, rise, overhang: 1.1, axis: 'x', pos: [bx, 0, 0] });
    for (const sx of [1, -1]) b.add(kit.prism([[-halfD, 0], [halfD, 0], [0, rise]], 0.45), lap, { pos: [bx + sx * (halfB - 0.22), eave, 0], rot: [0, Math.PI / 2, 0] });
  }

  const fz = halfD;
  const W = { trimMat: trim, glassMat: glass.m, screenMat: screen };
  doorUnit(kit, b, { x: bx + halfB * 0.45, y: FLOOR, z: fz, w: 3.0, h: 6.6, doorMat: door, trimMat: trim, metalMat: metal, glassMat: glass.m, brassMat: brass });
  if (stoop) {
    b.add(kit.box(5.0, FLOOR, 4.0, { bevel: 0.05 }), conc, { pos: [bx + halfB * 0.45, FLOOR / 2, fz + 2.0] });
    b.add(kit.box(5.4, 0.14, 4.4, { bevel: 0.04 }), conc, { pos: [bx + halfB * 0.45, FLOOR + 0.07, fz + 2.0] });
  }
  windowUnit(kit, b, { x: bx - halfB * 0.45, y: FLOOR + 4.4, z: fz, w: 6.4, h: 3.8, lights: 3, rails: 0, ...W });
  windowUnit(kit, b, { x: bx + halfB * 0.02, y: FLOOR + 4.4, z: fz, w: 2.8, h: 3.4, screen: true, ...W });
  for (const sx of [-1, 1]) windowUnit(kit, b, { x: bx + sx * halfB, y: FLOOR + 4.4, z: -3, ry: (sx * Math.PI) / 2, w: 2.6, h: 3.2, screen: true, ...W });
  windowUnit(kit, b, { x: bx - halfB * 0.4, y: FLOOR + 4.4, z: -halfD, ry: Math.PI, w: 2.8, h: 3.2, screen: true, ...W });
  if (chimney) {
    b.add(kit.box(1.8, eave + rise + 1.2, 1.4, { bevel: 0.05 }), block, { pos: [bx - halfB * 0.6, (eave + rise + 1.2) / 2, -2] });
    b.add(kit.box(2.1, 0.36, 1.7, { bevel: 0.05 }), block, { pos: [bx - halfB * 0.6, eave + rise + 1.4, -2] });
  }
  if (hasGarage) {
    const gx = halfB + bx + garageWidth / 2;
    const gEave = eave - 1.1;
    const gDepth = depth - 3;
    const gz = halfD - gDepth / 2;
    b.add(kit.box(garageWidth, gEave, gDepth, { bevel: 0.05 }), lap, { pos: [gx, gEave / 2, gz] });
    if (roof === 'hip') hipRoof(kit, b, roofMat, { width: garageWidth, depth: gDepth, eaveY: gEave, rise: rise * 0.7, overhang: 1.2, pos: [gx, 0, gz] });
    else gableRoof(kit, b, roofMat, { width: garageWidth, depth: gDepth, eaveY: gEave, rise: rise * 0.7, overhang: 1.0, axis: 'x', pos: [gx, 0, gz] });
    const dz = halfD + 0.02; const dw = garageWidth - 2.4; const dh = 6.9;
    b.add(kit.box(dw + 0.4, dh + 0.24, 0.18), kit.flat(mix(trimCol, 0x000000, 0.45), { rough: 0.85 }), { pos: [gx, dh / 2, dz] });
    b.add(kit.box(dw, dh, 0.09, { bevel: 0.02 }), kit.flat(mix(TS.garageDoor, 0x000000, 0.1), { rough: 0.5 }), { pos: [gx, dh / 2, dz + 0.09] });
    for (let r = 0; r < 4; r++) {
      const y = (dh * (r + 0.5)) / 4;
      for (let c = 0; c < 3; c++) b.add(kit.box(dw / 3 - 0.14, dh / 4 - 0.14, 0.12, { bevel: 0.03 }), kit.flat(TS.garageDoor, { rough: 0.45 }), { pos: [gx - dw / 2 + (dw * (c + 0.5)) / 3, y, dz + 0.15] });
    }
    b.add(kit.box(dw + 0.8, 0.28, 0.3, { bevel: 0.03 }), trim, { pos: [gx, dh + 0.18, dz + 0.1] });
  }
  const totalW = hasGarage ? width : bodyW;
  for (const sz of [1, -1]) b.add(kit.box(totalW + 2.6, 0.36, 0.18, { bevel: 0.03 }), trim, { pos: [bx + (hasGarage ? garageWidth / 2 : 0), eave - rise * 0.32 - 0.2, sz * (halfD + 1.36)] });

  const root = b.finish();
  root.metadata.nightLights = [glass.night];
  root.metadata.footprint = { w: totalW + 5, d: depth + 6, cx: hasGarage ? garageWidth / 2 : 0, cz: 1.5 };
  return root;
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

// A six-foot dog-eared cedar privacy fence. THE BOARD-TO-BOARD VALUE CHANGE IS THE WHOLE
// READ: painted one flat brown it is a wall, and what makes it a fence is that no two boards
// weathered at the same rate. Four tones is enough, because four tones is four materials and
// therefore four merged meshes -- which is the price of it and is worth paying.
export function privacyFence(kit, { seed = 31, length = 24, height = 6, picket = 0.48, gap = 0.04, gate = false } = {}) {
  const rng = seededRandom(seed);
  const b = kit.builder('ts-privacy-fence');
  const tones = [TS.cedar, mix(TS.cedar, TS.cedarGrey, 0.5), TS.cedarGrey, mix(TS.cedarGrey, TS.cedarDark, 0.45)]
    .map((c) => boardMat(kit, c));
  const rail = boardMat(kit, TS.cedarGrey);
  const post = kit.mat('Wood049', { tint: TS.cedarDark, neutral: 0.8, tile: 2.2, rough: 0.94, bump: 1.0 });
  const iron = kit.flat(TS.galvDark, { rough: 0.45, metal: 0.8 });
  const pitch = picket + gap;
  const n = Math.max(1, Math.floor(length / pitch));
  const span = n * pitch;
  const ear = picket * 0.5;
  // The dog ear is cut, not implied. It is the only thing the eye has to count boards by at
  // thirty feet, and a fence of square-topped pickets reads as corrugated sheet.
  const outline = [
    [-picket / 2, 0], [picket / 2, 0], [picket / 2, height - ear],
    [picket / 2 - ear, height], [-picket / 2 + ear, height], [-picket / 2, height - ear],
  ];
  for (let i = 0; i < n; i++) {
    const x = -span / 2 + i * pitch + picket / 2;
    const drop = rng() < 0.08 ? rng() * 0.22 : 0;
    b.add(kit.prism(outline, 0.07), tones[Math.floor(rng() * tones.length)], {
      pos: [x, -drop, 0], rot: [0, 0, (rng() - 0.5) * 0.012], uvRot: true,
    });
  }
  for (const y of [height * 0.22, height * 0.78]) b.add(kit.box(span, 0.34, 0.13, { bevel: 0.02 }), rail, { pos: [0, y, -0.1] });
  const posts = Math.max(2, Math.round(span / 8) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -span / 2 + (span * i) / (posts - 1);
    b.add(kit.box(0.36, height + 0.5, 0.36, { bevel: 0.03 }), post, { pos: [x, (height + 0.5) / 2 - 0.25, -0.2] });
    b.add(kit.lathe([[0, 0], [0.26, 0.06], [0.16, 0.2], [0, 0.3]], { sides: 4 }), post, { pos: [x, height + 0.25, -0.2], rot: [0, Math.PI / 4, 0] });
  }
  if (gate) {
    b.add(kit.box(0.16, height - 0.3, 0.1, { bevel: 0.02 }), post, { pos: [0, (height - 0.3) / 2, 0.06] });
    b.add(kit.box(3.6, 0.28, 0.1, { bevel: 0.02 }), post, { pos: [1.9, height * 0.8, 0.06] });
    b.add(kit.box(4.2, 0.24, 0.1, { bevel: 0.02 }), post, { pos: [1.9, height * 0.45, 0.06], rot: [0, 0, -0.5] });
    b.add(kit.box(0.3, 0.12, 0.26, { bevel: 0.02 }), iron, { pos: [3.6, height * 0.55, 0.12] });
  }
  const root = b.finish();
  root.metadata.footprint = { w: span, d: 1.6, channel: 'worn', strength: 0.5 };
  return root;
}

// Galvanised chain link. THE FABRIC IS AN ALPHA-TESTED PLANE and has to be: a diamond mesh is
// ten thousand wires and at any honest gauge it is sub-pixel from six feet. What must be
// geometry is the FRAME -- terminal posts, line posts, top rail, tension bands -- because
// that is what catches the sun and tells you the fence is there at all.
function chainCanvas() {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  // THIN, AND MOSTLY HOLE. The first pass drew 5px wire on a four-cell tile repeated every
  // two feet, which is about forty per cent coverage at a six-inch mesh -- and forty per cent
  // of anything with `metallic` on it is a wall, not a fence. Real chain link is 2in wire at
  // 2in centres seen from twenty feet: what survives is a faint grey veil.
  ctx.strokeStyle = 'rgba(214,220,226,1)';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'square';
  const cell = px / 4;
  for (let i = -4; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell + px, px); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * cell, px); ctx.lineTo(i * cell + px, 0); ctx.stroke();
  }
  return c;
}

export function chainFence(kit, { seed = 32, length = 30, height = 4 } = {}) {
  const b = kit.builder('ts-chain-fence');
  const galv = kit.mat('Metal032', { tint: TS.galv, neutral: 0.9, tile: 2, rough: 0.34, metal: true, bump: 0.5 });
  const dark = kit.flat(TS.galvDark, { rough: 0.38, metal: 0.9 });
  const bays = Math.max(1, Math.round(length / 10));
  for (let i = 0; i <= bays; i++) {
    const x = -length / 2 + (length * i) / bays;
    const terminal = i === 0 || i === bays;
    const r = terminal ? 0.13 : 0.1;
    b.add(kit.cyl(r, r, height + 0.3, { sides: 10, tile: 2 }), terminal ? dark : galv, { pos: [x, (height + 0.3) / 2 - 0.15, 0] });
    b.add(kit.lathe([[0, 0], [r + 0.02, 0.06], [r * 0.6, 0.14], [0, 0.16]], { sides: 10 }), dark, { pos: [x, height + 0.15, 0] });
    if (terminal) for (const y of [height * 0.28, height * 0.72]) b.add(kit.torus(r + 0.03, 0.06, { sides: 10 }), dark, { pos: [x, y, 0], rot: [0, 0, Math.PI / 2] });
  }
  b.add(kit.cyl(0.085, 0.085, length, { sides: 10, tile: 2 }), galv, { pos: [0, height - 0.12, 0], rot: [0, 0, Math.PI / 2] });
  b.add(kit.cyl(0.025, 0.025, length, { sides: 6, tile: 2 }), dark, { pos: [0, 0.22, 0], rot: [0, 0, Math.PI / 2] });
  const root = b.finish();
  const fabric = kit.plane(length, height - 0.25);
  const mat = kit.canvasMat(`ts-chainlink`, chainCanvas(), { emissive: 0, rough: 0.35, alpha: true });
  mat.albedoTexture.uScale = length / 0.9;
  mat.albedoTexture.vScale = (height - 0.25) / 0.9;
  mat.albedoTexture.wrapU = Texture.WRAP_ADDRESSMODE; mat.albedoTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  mat.albedoColor = linear(0x9fa6ab);
  // A low metallic, not a high one. Galvanised wire is DULL, and at 0.5 the fabric mirrored
  // the sky and a chain-link fence read as a sheet of blue glass down the property line.
  mat.metallic = 0.15; mat.roughness = 0.62; mat.backFaceCulling = false; mat.twoSidedLighting = true;
  fabric.material = mat;
  fabric.position.set(0, (height - 0.25) / 2 + 0.1, 0.02);
  fabric.parent = root;
  fabric.isPickable = false;
  root.metadata.instanceable = false;
  return root;
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

// A creosoted wood distribution pole. The wires are the point: three of the six photographs
// are framed by them, and a pole with no span on it reads as a dead tree. Spans are given in
// the pole's OWN frame, so a layout puts one down at yaw zero and just says where the wire
// ends up. Each is a real catenary -- the sag is most of what a power line looks like.
export function utilityPole(kit, { seed = 41, height = 32, crossarm = true, transformer = true, spans = [], drops = [] } = {}) {
  const b = kit.builder('ts-utility-pole');
  const wood = kit.mat('Wood049', { tint: TS.pole, neutral: 0.85, tile: 3, rough: 0.96, bump: 1.2 });
  const woodDark = kit.mat('Wood049', { tint: mix(TS.pole, 0x000000, 0.3), neutral: 0.85, tile: 2.4, rough: 0.96, bump: 1.2 });
  const steel = kit.flat(TS.galvDark, { rough: 0.42, metal: 0.85 });
  const porcelain = kit.flat(0x4a5b52, { rough: 0.18, clearcoat: 0.6 });
  const wire = kit.flat(0x22242a, { rough: 0.55, metal: 0.4 });
  const armY = height - 2.0;

  b.add(kit.cyl(0.42, 0.62, height, { sides: 14, tile: 3 }), wood, { pos: [0, height / 2, 0] });
  b.add(kit.lathe([[0, 0], [0.42, 0], [0.4, 0.1], [0.18, 0.34], [0, 0.38]], { sides: 14 }), woodDark, { pos: [0, height, 0] });
  if (crossarm) {
    b.add(kit.box(8.0, 0.42, 0.34, { bevel: 0.04 }), woodDark, { pos: [0, armY, 0] });
    b.add(kit.box(0.3, 1.6, 0.26, { bevel: 0.03 }), woodDark, { pos: [0, armY - 0.9, 0.3], rot: [0.6, 0, 0] });
    for (const x of [-3.2, 0, 3.2]) {
      b.add(kit.cyl(0.07, 0.07, 0.8, { sides: 8 }), steel, { pos: [x, armY + 0.6, 0] });
      b.add(kit.lathe([[0, 0], [0.3, 0.02], [0.34, 0.1], [0.2, 0.18], [0.3, 0.26], [0.16, 0.42], [0, 0.44]], { sides: 12 }), porcelain, { pos: [x, armY + 0.9, 0] });
    }
  }
  if (transformer) {
    b.add(kit.cyl(1.0, 1.0, 3.2, { sides: 18, tile: 3 }), steel, { pos: [0, height - 8.5, 1.5] });
    b.add(kit.lathe([[0, 0], [1.0, 0], [1.04, 0.12], [0.6, 0.34], [0.2, 0.4], [0, 0.42]], { sides: 18 }), steel, { pos: [0, height - 6.9, 1.5] });
    b.add(kit.box(0.5, 3.4, 0.3, { bevel: 0.03 }), steel, { pos: [0, height - 8.5, 0.62] });
    for (const x of [-0.5, 0.5]) b.add(kit.lathe([[0, 0], [0.18, 0.02], [0.22, 0.08], [0.12, 0.16], [0.2, 0.24], [0.1, 0.38], [0, 0.4]], { sides: 10 }), porcelain, { pos: [x, height - 6.8, 1.5] });
  }
  b.add(kit.cyl(0.035, 0.035, height - 2, { sides: 6, tile: 3 }), steel, { pos: [0.44, (height - 2) / 2, -0.28] });
  for (let i = 0; i < 6; i++) b.add(kit.cyl(0.05, 0.05, 0.8, { sides: 6 }), steel, { pos: [(i % 2 ? 1 : -1) * 0.5, height - 12 + i * 1.8, 0], rot: [0, 0, Math.PI / 2] });

  const catenary = (from, to, sag, radius) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(new Vector3(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t - Math.sin(Math.PI * t) * sag,
        from[2] + (to[2] - from[2]) * t,
      ));
    }
    b.add(kit.tube(pts, radius, { sides: 5, tile: 4 }), wire);
  };
  for (const s of spans) {
    const n = s.wires ?? 3;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -3.2 + (6.4 * i) / (n - 1);
      catenary([x, armY + 1.1, 0], [(s.dx ?? 0) + x * 0.6, armY + 1.1 + (s.dy ?? 0), s.dz ?? 0], s.sag ?? 2.2, 0.05);
    }
    if (s.neutral !== false) catenary([0, height - 10.5, 0], [s.dx ?? 0, height - 10.5 + (s.dy ?? 0), s.dz ?? 0], (s.sag ?? 2.2) * 1.35, 0.055);
  }
  for (const d of drops) catenary([0.3, height - 11.5, 0.6], [d.dx, height - 11.5 + (d.dy ?? -7), d.dz], d.sag ?? 2.6, 0.085);

  const root = b.finish();
  // A SHADOW-MAPPED WIRE IS A FLICKERING DASHED LINE at every cascade split -- it is a
  // one-inch cylinder a hundred feet long, which is under a texel wide at any shadow
  // resolution. The pole casts; the spans do not. Matched by material rather than by name,
  // because a material's name is a cache key and not a contract.
  root.metadata.casters = root.metadata.casters.filter((m) => m.material !== wire);
  root.metadata.footprint = { r: 2.2, channel: 'worn', strength: 0.6 };
  return root;
}

function bladeCanvas(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#12542f'; ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#f2f4ee'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = '#f7f9f4'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let size = 76;
  do { ctx.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`; size -= 2; }
  while (ctx.measureText(text).width > 452 && size > 20);
  ctx.fillText(text, 256, 68);
  return c;
}

export function streetSign(kit, { top = '7th ST', bottom = 'TURKLE AVE', height = 9 } = {}) {
  const b = kit.builder('ts-street-sign');
  const steel = kit.flat(TS.galvDark, { rough: 0.42, metal: 0.8 });
  const bolt = kit.flat(0x33383c, { rough: 0.5, metal: 0.7 });
  b.add(kit.box(0.22, height, 0.16, { bevel: 0.02 }), steel, { pos: [0, height / 2, 0] });
  for (let i = 0; i < 14; i++) b.add(kit.box(0.1, 0.1, 0.06), bolt, { pos: [0, 0.7 + i * 0.6, 0.1] });
  b.add(kit.box(0.42, 0.42, 0.42, { bevel: 0.03 }), steel, { pos: [0, height - 0.6, 0] });
  const root = b.finish();
  for (const [text, y, yaw] of [[top, height - 0.35, 0], [bottom, height - 1.5, Math.PI / 2]]) {
    const mat = kit.canvasMat(`ts-blade-${text}`, bladeCanvas(text), { emissive: 0.05, rough: 0.35 });
    mat.backFaceCulling = false; mat.twoSidedLighting = true;
    const face = kit.plane(4.2, 1.05);
    face.material = mat;
    face.position.set(0, y, 0);
    face.rotation.y = yaw;
    face.parent = root;
    face.isPickable = false;
  }
  root.metadata.instanceable = false;
  return root;
}

export function mailbox(kit, { seed = 43, height = 3.9, flagUp = false } = {}) {
  const b = kit.builder('ts-mailbox');
  const post = kit.mat('Wood049', { tint: TS.cedarGrey, neutral: 0.8, tile: 2, rough: 0.95, bump: 1.0 });
  const steel = kit.mat('Metal032', { tint: TS.steel, neutral: 0.9, tile: 1.6, rough: 0.42, metal: true, bump: 0.5 });
  const dark = kit.flat(mix(TS.steel, 0x000000, 0.35), { rough: 0.5, metal: 0.7 });
  const red = kit.flat(TS.flagRed, { rough: 0.5 });
  b.add(kit.box(0.42, height, 0.42, { bevel: 0.03 }), post, { pos: [0, height / 2, 0] });
  b.add(kit.box(1.9, 0.26, 0.5, { bevel: 0.03 }), post, { pos: [0, height - 0.13, 0.6] });
  b.add(kit.box(0.4, 0.9, 0.3, { bevel: 0.03 }), post, { pos: [0, height - 0.5, 0.42], rot: [0.7, 0, 0] });
  const R = 0.46; const L = 1.7;
  const tunnel = [];
  for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); tunnel.push([-Math.cos(a) * R, Math.sin(a) * R * 1.05]); }
  tunnel.push([R, -0.02], [-R, -0.02]);
  b.add(kit.prism(tunnel, L), steel, { pos: [0, height + R * 0.5, 0.5] });
  b.add(kit.box(R * 2 + 0.06, 0.06, L + 0.06), dark, { pos: [0, height + 0.02, 0.5] });
  b.add(kit.prism(tunnel, 0.07), kit.mat('Metal032', { tint: mix(TS.steel, 0xffffff, 0.12), neutral: 0.9, tile: 1.6, rough: 0.4, metal: true }), { pos: [0, height + R * 0.5, 0.5 + L / 2 + 0.04] });
  b.add(kit.cyl(0.06, 0.06, 0.22, { sides: 8 }), dark, { pos: [0, height + 0.22, 0.5 + L / 2 + 0.12], rot: [Math.PI / 2, 0, 0] });
  const fy = flagUp ? height + 0.95 : height + 0.32;
  const rot = flagUp ? 0 : -Math.PI / 2;
  b.add(kit.box(0.07, 0.86, 0.07, { bevel: 0.01 }), red, { pos: [R + 0.09, fy, 0.5 - L * 0.3], rot: [0, 0, rot] });
  b.add(kit.box(0.06, 0.52, 0.42, { bevel: 0.01 }), red, { pos: [R + 0.09 + (flagUp ? 0 : 0.42), fy + (flagUp ? 0.62 : 0), 0.5 - L * 0.3], rot: [0, 0, rot] });
  const root = b.finish();
  root.metadata.footprint = { r: 1.3, channel: 'worn', strength: 0.5 };
  return root;
}

export function acUnit(kit, { seed = 44, size = 2.6, height = 2.8 } = {}) {
  const b = kit.builder('ts-ac-unit');
  const conc = kit.mat('Concrete034', { tint: TS.concreteOld, neutral: 1, tile: 4, rough: 0.95, bump: 0.7 });
  const shell = kit.mat('Metal032', { tint: mix(TS.galv, 0x000000, 0.3), neutral: 0.9, tile: 2.4, rough: 0.5, metal: true, bump: 0.6 });
  const louvre = kit.flat(mix(TS.galv, 0x000000, 0.12), { rough: 0.46, metal: 0.7 });
  const grille = kit.flat(TS.galvDark, { rough: 0.4, metal: 0.85 });
  b.add(kit.box(size + 0.9, 0.35, size + 0.9, { bevel: 0.04 }), conc, { pos: [0, 0.17, 0] });
  b.add(kit.box(size, height, size, { bevel: 0.05 }), shell, { pos: [0, 0.35 + height / 2, 0] });
  for (let i = 0; i < 14; i++) {
    const y = 0.75 + (i * (height - 1.0)) / 14;
    for (const [dx, dz, yaw] of [[0, size / 2 + 0.01, 0], [0, -size / 2 - 0.01, 0], [size / 2 + 0.01, 0, Math.PI / 2], [-size / 2 - 0.01, 0, Math.PI / 2]]) {
      b.add(kit.box(size - 0.2, 0.09, 0.04), louvre, { pos: [dx, y, dz], rot: [0, yaw, 0] });
    }
  }
  b.add(kit.cyl(size * 0.46, size * 0.46, 0.12, { sides: 22 }), kit.flat(mix(TS.galv, 0x000000, 0.5), { rough: 0.55, metal: 0.6 }), { pos: [0, 0.35 + height + 0.06, 0] });
  for (let i = 0; i < 7; i++) b.add(kit.torus(size * 0.06 + i * size * 0.06, 0.03, { sides: 20 }), grille, { pos: [0, 0.35 + height + 0.13, 0], rot: [Math.PI / 2, 0, 0] });
  const root = b.finish();
  root.metadata.footprint = { w: size + 1.4, d: size + 1.4, channel: 'bare' };
  return root;
}

export function trashCart(kit, { seed = 45, colour = 0x2e5aa0, height = 3.6 } = {}) {
  const b = kit.builder('ts-trash-cart');
  const body = kit.flat(colour, { rough: 0.62, clearcoat: 0.25 });
  const lid = kit.flat(mix(colour, 0x000000, 0.25), { rough: 0.62, clearcoat: 0.25 });
  const rubber = kit.flat(0x24262a, { rough: 0.9 });
  const steel = kit.flat(TS.galvDark, { rough: 0.4, metal: 0.8 });
  const W = 2.1; const D = 2.5;
  b.add(kit.prism([[-W / 2, 0], [W / 2, 0], [W / 2 + 0.12, height], [-W / 2 - 0.12, height]], D), body, { pos: [0, 0.42, 0] });
  b.add(kit.box(W + 0.34, 0.22, D + 0.3, { bevel: 0.04 }), lid, { pos: [0, height + 0.5, -0.1], rot: [-0.09, 0, 0] });
  b.add(kit.box(W * 0.6, 0.14, 0.4, { bevel: 0.03 }), lid, { pos: [0, height + 0.58, D / 2 + 0.1] });
  for (const sx of [-1, 1]) b.add(kit.cyl(0.42, 0.42, 0.28, { sides: 14 }), rubber, { pos: [sx * (W / 2 + 0.06), 0.42, -D / 2 + 0.5], rot: [0, 0, Math.PI / 2] });
  b.add(kit.cyl(0.08, 0.08, W + 0.4, { sides: 8 }), steel, { pos: [0, 0.42, -D / 2 + 0.5], rot: [0, 0, Math.PI / 2] });
  return b.finish();
}

// A pumpkin on the porch step. It is October, and this is the one object in this world that
// says so. The ribs are GEOMETRY as well as colour: a tinted sphere is still a sphere from
// the one angle that matters, which is against the sky.
export function pumpkin(kit, { seed = 46, radius = 0.55, colour = TS.pumpkin } = {}) {
  const b = kit.builder('ts-pumpkin');
  const skin = kit.flat(colour, { rough: 0.44, clearcoat: 0.5 });
  const lobeMat = kit.flat(mix(colour, 0xffffff, 0.08), { rough: 0.44, clearcoat: 0.5 });
  const stem = kit.flat(0x6c6a34, { rough: 0.92 });
  b.add(kit.sphere(radius, { segments: 20, sy: 0.82 }), skin, { pos: [0, radius * 0.86, 0] });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.add(kit.sphere(radius * 0.42, { segments: 12, sx: 0.9, sy: 0.8, sz: 0.9 }), lobeMat, { pos: [Math.cos(a) * radius * 0.72, radius * 0.86, Math.sin(a) * radius * 0.72] });
  }
  b.add(kit.cyl(0.06, 0.1, 0.42, { sides: 7 }), stem, { pos: [0.02, radius * 1.52, 0.01], rot: [0.2, 0, 0.25] });
  return b.finish();
}

// ---------------------------------------------------------------------------
// Planting and ground detail
// ---------------------------------------------------------------------------

// A brick-edged ring of bark mulch round the corner hackberry, with the ornaments a Kansas
// front yard actually has in it: a concrete birdbath, a pair of urns, a shepherd's hook. All
// of them are in the corner photograph, and between them they say more about who lives here
// than the house does.
export function mulchRing(kit, { seed = 71, radius = 7, birdbath = true, urns = 2, hook = true } = {}) {
  const rng = seededRandom(seed);
  const b = kit.builder('ts-mulch-ring');
  const mulch = kit.mat('Ground068', { tint: TS.mulch, neutral: 0.85, tile: 2.2, rough: 0.98, bump: 1.2 });
  const bricks = [TS.brickEdge, mix(TS.brickEdge, 0x7a4a3a, 0.6), mix(TS.brickEdge, 0xc08a62, 0.55)]
    .map((c) => kit.mat('PavingStones070', { tint: c, neutral: 0.9, tile: 1.4, rough: 0.9, bump: 0.8 }));
  const stone = kit.mat('Concrete034', { tint: 0xa9a396, neutral: 1, tile: 2.4, rough: 0.9, bump: 0.8 });
  const water = kit.flat(0x51616b, { rough: 0.06, metal: 0.1, clearcoat: 0.8 });
  const iron = kit.flat(0x2c3034, { rough: 0.45, metal: 0.8 });
  const pot = kit.flat(0x39424a, { rough: 0.6 });

  b.add(kit.cyl(radius - 0.22, radius - 0.22, 0.2, { sides: 34, tile: 2.2 }), mulch, { pos: [0, 0.06, 0] });
  const n = Math.round((Math.PI * 2 * radius) / 0.72);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.04;
    const rr = radius - 0.12 + (rng() - 0.5) * 0.08;
    b.add(kit.box(0.7, 0.42, 0.34, { bevel: 0.025 }), bricks[Math.floor(rng() * 3)], {
      pos: [Math.cos(a) * rr, 0.2 + rng() * 0.03, Math.sin(a) * rr], rot: [(rng() - 0.5) * 0.12, -a, (rng() - 0.5) * 0.1],
    });
  }
  if (birdbath) {
    const bx = radius * 0.5; const bz = -radius * 0.32;
    b.add(kit.lathe([[0, 0], [0.85, 0], [0.8, 0.14], [0.34, 0.4], [0.26, 1.9], [0.4, 2.1], [1.28, 2.28], [1.34, 2.5], [1.2, 2.56], [1.15, 2.4], [0.3, 2.34], [0, 2.34]], { sides: 26 }), stone, { pos: [bx, 0.12, bz] });
    b.add(kit.cyl(1.1, 1.1, 0.06, { sides: 24 }), water, { pos: [bx, 2.48, bz] });
  }
  for (let i = 0; i < urns; i++) {
    const a = 2.2 + i * 0.9;
    const ux = Math.cos(a) * radius * 0.62; const uz = Math.sin(a) * radius * 0.62;
    b.add(kit.lathe([[0, 0], [0.52, 0], [0.5, 0.12], [0.3, 0.2], [0.34, 0.8], [0.56, 1.35], [0.62, 1.5], [0.58, 1.58], [0.4, 1.5], [0, 1.46]], { sides: 18 }), pot, { pos: [ux, 0.12, uz] });
    const spill = shrub(kit, { radius: 0.8, seed: seed * 3 + i, kind: 'flowering' });
    spill.position.set(ux, 1.5, uz);
    b.attach(spill);
  }
  if (hook) {
    const hx = -radius * 0.55; const hz = radius * 0.3;
    b.add(kit.cyl(0.05, 0.05, 5.2, { sides: 8 }), iron, { pos: [hx, 2.6, hz] });
    b.add(kit.torus(0.62, 0.06, { sides: 16 }), iron, { pos: [hx + 0.62, 5.2, hz], rot: [Math.PI / 2, 0, 0] });
    b.add(kit.lathe([[0, 0], [0.34, 0.24], [0.4, 0.62], [0.24, 0.7], [0.1, 0.62], [0, 0.6]], { sides: 14 }), kit.flat(0x7b2c30, { rough: 0.55 }), { pos: [hx + 1.24, 4.5, hz] });
  }
  const root = b.finish();
  root.metadata.footprint = { r: radius + 0.4 };
  root.metadata.instanceable = false;
  return root;
}

// The planting bed along the front of a house: brick edging, bark mulch, a row of shrubs.
export function foundationBed(kit, { seed = 81, width = 22, depth = 4.5, plants = 'mixed' } = {}) {
  const rng = seededRandom(seed);
  const b = kit.builder('ts-foundation-bed');
  const mulch = kit.mat('Ground068', { tint: TS.mulch, neutral: 0.85, tile: 2.2, rough: 0.98, bump: 1.2 });
  const bricks = [TS.brickEdge, mix(TS.brickEdge, 0x7a4a3a, 0.6), mix(TS.brickEdge, 0xc08a62, 0.55)]
    .map((c) => kit.mat('PavingStones070', { tint: c, neutral: 0.9, tile: 1.4, rough: 0.9, bump: 0.8 }));
  const halfW = width / 2; const halfD = depth / 2;
  b.add(kit.box(width, 0.3, depth, { bevel: 0.06 }), mulch, { pos: [0, 0.16, 0] });
  const per = 0.74;
  const n = Math.round((width * 2 + depth * 2) / per);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * (width * 2 + depth * 2);
    let x; let z; let a;
    if (t < width) { x = -halfW + t; z = halfD; a = 0; } else if (t < width + depth) { x = halfW; z = halfD - (t - width); a = Math.PI / 2; } else if (t < width * 2 + depth) { x = halfW - (t - width - depth); z = -halfD; a = 0; } else { x = -halfW; z = -halfD + (t - width * 2 - depth); a = Math.PI / 2; }
    b.add(kit.box(0.68, 0.36, 0.3, { bevel: 0.025 }), bricks[Math.floor(rng() * 3)], {
      pos: [x, 0.18 + rng() * 0.02, z], rot: [(rng() - 0.5) * 0.1, a + (rng() - 0.5) * 0.09, (rng() - 0.5) * 0.09],
    });
  }
  const kinds = plants === 'juniper' ? ['conifer'] : plants === 'green' ? ['hedge'] : ['conifer', 'hedge', 'hedge', 'flowering'];
  const count = Math.max(2, Math.round(width / 3.4));
  for (let i = 0; i < count; i++) {
    const x = -halfW + 1.4 + ((width - 2.8) * i) / Math.max(1, count - 1);
    const bush = shrub(kit, { radius: 1.0 + rng() * 0.7, seed: seed * 7 + i, kind: kinds[Math.floor(rng() * kinds.length)] });
    bush.position.set(x + (rng() - 0.5) * 0.5, 0.3, (rng() - 0.5) * (depth - 2.2));
    b.attach(bush);
  }
  const root = b.finish();
  root.metadata.footprint = { w: width + 0.6, d: depth + 0.6 };
  root.metadata.instanceable = false;
  return root;
}

// Fallen leaves, as one alpha-tested card each. The trees here are shedding in the first week
// of October and the lawn under the big hackberry is half covered -- which is a real part of
// what the photographs look like, and it is nearly free.
function leafCanvas() {
  const px = 256;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, px, px);
  const rand = seededRandom(913);
  for (const [cx, cy, s, hue] of [[64, 64, 1, 34], [190, 60, 0.86, 44], [70, 190, 0.92, 24], [186, 190, 0.8, 38]]) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rand() * 6.28); ctx.scale(s, s);
    ctx.fillStyle = `hsl(${hue + rand() * 14 - 7},${44 + rand() * 24}%,${30 + rand() * 20}%)`;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.bezierCurveTo(34, -34, 46, 4, 0, 52);
    ctx.bezierCurveTo(-46, 4, -34, -34, 0, -52);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,28,14,0.5)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(0, -50); ctx.lineTo(0, 50); ctx.stroke();
    ctx.restore();
  }
  return c;
}

export function leafDrift(kit, { seed = 91, radius = 12, count = 220 } = {}) {
  const rng = seededRandom(seed);
  const b = kit.builder('ts-leaf-drift');
  const mat = kit.canvasMat('ts-leaf', leafCanvas(), { emissive: 0, rough: 0.94, alpha: true });
  mat.backFaceCulling = false; mat.twoSidedLighting = true;
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    // drifted, not scattered: leaves pile toward the edge of a mulch ring and along a kerb
    const rr = radius * (0.25 + 0.75 * Math.sqrt(rng()));
    const q = Math.floor(rng() * 4);
    const card = kit.plane(0.62, 0.62);
    const uv = card.getVerticesData('uv');
    for (let k = 0; k < uv.length; k += 2) { uv[k] = uv[k] * 0.5 + (q % 2) * 0.5; uv[k + 1] = uv[k + 1] * 0.5 + (q >> 1) * 0.5; }
    card.setVerticesData('uv', uv);
    b.add(card, mat, {
      pos: [Math.cos(a) * rr, 0.045 + rng() * 0.05, Math.sin(a) * rr],
      rot: [-Math.PI / 2 + (rng() - 0.5) * 0.45, rng() * Math.PI * 2, 0],
      scale: 0.75 + rng() * 0.9,
    });
  }
  const root = b.finish({ castShadows: false, receiveShadows: true });
  // The lawn under a hackberry is THINNER, and that is most of what breaks a mown front
  // yard up. Without it the terrain's own colour drift runs at a hundred and fifty feet,
  // which is nearly uniform across one lot, and the grass reads as a single bright mat --
  // the model-railroad failure this world's whole palette is arranged against.
  root.metadata.footprint = { r: radius * 0.85, channel: 'worn', strength: 0.75 };
  root.metadata.instanceable = false;
  return root;
}

// ---------------------------------------------------------------------------
// The two dispatchers
// ---------------------------------------------------------------------------
//
// `ts-street-tree` and `ts-shrub` each carry a `kind` in their record, so one PROP_BUILDERS
// key stands for five trees and five shrubs. A native builder must take the same options the
// main-app builder takes, so the dispatch happens here rather than in the NATIVE table --
// and because `Natives.build` caches its template on `key:JSON.stringify(options)`, each
// kind still gets its own hardware-instanced template for free.

const TREE_SPECIES = {
  hackberry: 'hackberry', elm: 'americanElm', oak: 'pinOak', maple: 'silverMaple', autumn: 'kansasGold',
};

export function streetTree(kit, { seed = 51, height = 38, kind = 'hackberry' } = {}) {
  return turkleTree(kit, { height, seed, kind: TREE_SPECIES[kind] ?? 'hackberry' });
}

// Junipers are needled and everything else on these foundations is broadleaf, so the two go
// to different foliage paintings. The dried ornamental grass by the step is a blade field
// rather than a card cluster -- at a foot across, cards read as a green pincushion.
const SHRUB_SPECIES = { juniper: 'conifer', boxwood: 'hedge', yew: 'conifer', spirea: 'hedge' };

export function turkleShrub(kit, { seed = 61, radius = 1.6, kind = 'juniper' } = {}) {
  if (kind === 'grass') return ichuGrass(kit, { radius: radius * 0.7, count: 3, seed });
  return shrub(kit, { radius, seed, kind: SHRUB_SPECIES[kind] ?? 'hedge' });
}
