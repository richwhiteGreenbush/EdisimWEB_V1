// Native vegetation for the worlds where realism is the point: Dinosaur Island's Cretaceous
// flora, Machu Picchu's high-Andean scrub, the hedgerow of A Rabbit's Den and the street trees
// of The Neighborhood. (The stylised worlds -- Whimsical World, the chalk drawings, Wonderland --
// keep the main app's own models on purpose: their look IS their point.)
//
// Every builder here takes the SAME options as the main-app prop it stands in for, on the same
// origin, at the same size, so a world file needs no changes to pick it up.
//
// Two construction ideas carry the file:
//   * FRONDS ARE RIBBONS. A fern, a cycad leaf and an araucaria bough are each one painted
//     frond laid along a curved, folded strip -- a dozen triangles -- rather than hundreds of
//     leaflet solids. The curve is integrated from a start and end ELEVATION, so "arching" and
//     "stiff" are two numbers rather than two pieces of code.
//   * A PLANT IS A LIST OF FIELD MARKS. An araucaria is a bare pole under an umbrella of
//     upswept ropes; a cycad is a fat barrel with a stiff shuttlecock on it; a tree fern is a
//     thin fibrous trunk with a drooping fountain. Each builder is written around its marks.

import { Vector3, TransformNode, Mesh, VertexData, PBRMaterial } from '@babylonjs/core';
import { seededRandom, linear } from './Kit.js';
import { Cards, cluster, randomUnit, foliageMaterial, autumnMapleTree, goldMapleTree, shadeTree, coniferTree } from './Trees.js';

const UP = new Vector3(0, 1, 0);

// Lays one frond along a curve that starts at `base` heading out along `azimuth` at elevation
// e0 and ends at elevation e1 (radians above horizontal; negative droops).
function frond(cards, base, azimuth, length, width, e0, e1, { segments = 9, twist = 0, keel = 0.22 } = {}) {
  const out = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const side0 = new Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
  const rows = [];
  let p = base.clone();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const e = e0 + (e1 - e0) * Math.pow(t, 0.85);
    const dir = out.scale(Math.cos(e)).add(UP.scale(Math.sin(e)));
    const normal = UP.scale(Math.cos(e)).subtract(out.scale(Math.sin(e)));
    const roll = twist * t;
    const side = side0.scale(Math.cos(roll)).add(normal.scale(Math.sin(roll)));
    // The painted frond carries its own outline; the strip only has to be wide enough for it.
    rows.push({ centre: p.clone(), side: side.scale(width * 0.5), normal: normal.scale(Math.cos(roll)).subtract(side0.scale(Math.sin(roll))).normalize(), v: t });
    p = p.add(dir.scale(length / segments));
  }
  cards.ribbon(rows, keel);
}

function finishFoliage(kit, root, cards, species, name) {
  const mesh = cards.toMesh(`${name}:foliage`, kit.scene);
  mesh.material = foliageMaterial(kit, species);
  mesh.parent = root;
  mesh.receiveShadows = true;
  root.metadata = root.metadata ?? { casters: [] };
  root.metadata.casters.push(mesh);
  return mesh;
}

// ---- Dinosaur Island ---------------------------------------------------------------------
// ARAUCARIA. The marks: a dead-straight pole, bare for most of its height where the lower
// boughs have been shed; boughs in regular WHORLS; every bough sweeping out level and then
// turning UP at the tip; and the whole crown a flattened umbrella, not a cone.
export function araucariaTree(kit, { height = 40, seed = 9 } = {}, _ctx, _three, lod = false) {
  const rand = seededRandom(seed * 23 + 5);
  const H = height;
  const bark = kit.mat('Bark012', { tint: 0x9a8672, tile: 3.2, bump: 1.6 });
  const b = kit.builder('araucaria');
  const r0 = H * 0.026;
  const lean = (rand() - 0.5) * H * 0.02;
  const pts = kit.curve([[0, -0.5, 0], [lean * 0.3, H * 0.4, 0], [lean, H * 0.8, lean * 0.4], [lean, H * 0.985, lean * 0.4]], 12);
  b.add(kit.tube(pts, pts.map((_, i) => { const t = i / (pts.length - 1); return r0 * (1 - t * 0.78) * (1 + Math.exp(-t * 18) * 0.7); }), { sides: lod ? 6 : 16, tile: 3.2 }), bark);
  const cards = new Cards();
  const whorls = lod ? 5 : 9;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = H * (0.5 + t * 0.47);
    const reach = H * (0.3 - Math.abs(t - 0.35) * 0.22);
    const n = lod ? 5 : 7;
    for (let k = 0; k < n; k++) {
      const az = (k / n) * Math.PI * 2 + w * 0.47 + rand() * 0.25;
      const at = new Vector3(lean * t, y, lean * 0.4 * t);
      const len = reach * (0.85 + rand() * 0.3);
      // the bough's wood, out to two thirds of its length
      if (!lod) {
        const o = new Vector3(Math.cos(az), 0, Math.sin(az));
        b.add(kit.tube([at, at.add(o.scale(len * 0.35)).add(UP.scale(-len * 0.04)), at.add(o.scale(len * 0.66)).add(UP.scale(len * 0.02))],
          [r0 * 0.3 * (1 - t * 0.5), r0 * 0.2 * (1 - t * 0.5), r0 * 0.08], { sides: 5, tile: 3.2 }), bark);
      }
      // older, lower boughs sag before they turn up; young top ones rise all the way
      frond(cards, at, az, len, len * 0.62, -0.22 + t * 0.5, 0.95 + t * 0.2, { segments: lod ? 4 : 7, keel: 0.32 });
      if (!lod) frond(cards, at.add(UP.scale(-0.1)), az + 0.08, len * 0.94, len * 0.5, -0.3 + t * 0.5, 0.8 + t * 0.2, { segments: 6, twist: 1.4, keel: 0.1 });
    }
  }
  // the leader: a tuft of upright shoots closing the top of the umbrella
  for (let k = 0; k < (lod ? 3 : 6); k++) frond(cards, new Vector3(lean, H * 0.95, lean * 0.4), (k / 6) * Math.PI * 2, H * 0.1, H * 0.07, 1.25, 1.45, { segments: 3 });
  const root = b.finish();
  finishFoliage(kit, root, cards, 'araucaria', 'araucaria');
  if (!lod) root.metadata.lod = araucariaTree(kit, { height, seed }, null, null, true);
  return root;
}

// TREE FERN. A thin dark fibrous trunk, slightly flared at the base by its own root mantle, and
// a fountain of long arching fronds from ONE point at the top -- plus the skirt of dead brown
// fronds hanging down the trunk, which is what makes it a tree fern and not a palm.
export function treeFern(kit, { height = 14, fronds = 11, seed = 3 } = {}) {
  const rand = seededRandom(seed * 19 + 3);
  const H = height;
  const b = kit.builder('tree-fern');
  const fibre = kit.mat('Bark012', { tint: 0x5d4a3a, tile: 1.6, bump: 2.0 });
  const trunkH = H * 0.62;
  const lx = (rand() - 0.5) * H * 0.1; const lz = (rand() - 0.5) * H * 0.1;
  const pts = kit.curve([[0, -0.3, 0], [lx * 0.4, trunkH * 0.5, lz * 0.4], [lx, trunkH, lz]], 8);
  b.add(kit.tube(pts, pts.map((_, i) => { const t = i / (pts.length - 1); return H * 0.034 * (1 + Math.exp(-t * 6) * 0.9) * (1 - t * 0.2); }), { sides: 12, tile: 1.6 }), fibre);
  b.add(kit.sphere(H * 0.05, { segments: 10, sy: 0.8 }), fibre, { pos: [lx, trunkH, lz] });
  const crown = new Vector3(lx, trunkH + H * 0.02, lz);
  const cards = new Cards();
  const n = Math.round(fronds * 1.5);
  for (let i = 0; i < n; i++) {
    const az = (i / n) * Math.PI * 2 * 1.618 + rand() * 0.5;
    const young = i % 3 === 0;
    const len = H * (young ? 0.34 : 0.52) * (0.85 + rand() * 0.3);
    frond(cards, crown, az, len, len * 0.34, young ? 1.15 : 0.75 + rand() * 0.2, young ? 0.2 : -0.75 - rand() * 0.3, { segments: 10, twist: (rand() - 0.5) * 0.8 });
  }
  const root = b.finish();
  finishFoliage(kit, root, cards, 'fern', 'tree-fern');
  // the dead skirt: last year's fronds, brown, hanging straight down the trunk
  const dead = new Cards();
  for (let i = 0; i < 7; i++) frond(dead, crown.add(UP.scale(-H * 0.02)), rand() * 6.283, H * 0.3, H * 0.09, -0.9, -1.5, { segments: 5 });
  const skirt = dead.toMesh('tree-fern:skirt', kit.scene);
  skirt.material = foliageMaterial(kit, 'fernDead');
  skirt.parent = root; skirt.receiveShadows = true;
  root.metadata.casters.push(skirt);
  return root;
}

// CYCAD. A short, fat, armoured barrel of a trunk and a STIFF crown: the leaves rise steeply,
// arch only near the tip, and never droop. Fern-soft fronds here would make it a fern.
export function cycad(kit, { height = 6, seed = 5 } = {}) {
  const rand = seededRandom(seed * 29 + 1);
  const H = height;
  const b = kit.builder('cycad');
  const armour = kit.mat('Bark012', { tint: 0x7a6248, tile: 1.1, bump: 2.4 });
  const trunkH = H * 0.34; const r = H * 0.13;
  b.add(kit.lathe([[0, 0], [r * 1.05, 0], [r * 1.15, trunkH * 0.3], [r, trunkH * 0.8], [r * 0.6, trunkH], [0, trunkH * 1.04]], { sides: 18, tile: 1.1 }), armour);
  const cards = new Cards();
  const n = 22;
  for (let i = 0; i < n; i++) {
    const ring = i / n;
    const az = i * 2.39996 + rand() * 0.2;
    const len = H * (0.85 + rand() * 0.2) * (0.75 + ring * 0.3);
    frond(cards, new Vector3(0, trunkH * 0.96, 0), az, len, len * 0.3, 1.25 - ring * 0.85, 0.35 - ring * 0.7, { segments: 8, keel: 0.34 });
  }
  const root = b.finish();
  finishFoliage(kit, root, cards, 'cycad', 'cycad');
  return root;
}

// GROUND FERNS: rosettes, fronds rising and arching over, a young fiddlehead or two upright.
export function fernPatch(kit, { count = 14, radius = 5, seed = 13 } = {}) {
  const rand = seededRandom(seed * 7 + 11);
  const root = new TransformNode('fern-patch', kit.scene);
  const cards = new Cards();
  for (let c = 0; c < count; c++) {
    const a = rand() * 6.283; const d = radius * Math.sqrt(rand());
    const at = new Vector3(Math.cos(a) * d, 0.05, Math.sin(a) * d);
    const size = 1.6 + rand() * 1.9;
    const n = 7 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const az = (i / n) * 6.283 + rand() * 0.6;
      frond(cards, at, az, size * (0.8 + rand() * 0.4), size * 0.36, 1.0 + rand() * 0.25, -0.35 - rand() * 0.4, { segments: 7, twist: (rand() - 0.5) * 0.7 });
    }
  }
  finishFoliage(kit, root, cards, 'fern', 'fern-patch');
  root.metadata.instanceable = false;
  return root;
}

// One ground-fern rosette as a bare mesh, for the grass system to scatter by the hundred as
// thin instances: the same painted frond the tree ferns carry, so the forest floor and the
// canopy are visibly the same plants.
export function fernRosetteMesh(kit) {
  const rand = seededRandom(77);
  const cards = new Cards();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const az = (i / n) * 6.283 + rand() * 0.5;
    const len = 2.0 + rand() * 0.9;
    frond(cards, new Vector3(0, 0.04, 0), az, len, len * 0.36, 1.05 + rand() * 0.2, -0.4 - rand() * 0.35, { segments: 6, twist: (rand() - 0.5) * 0.6 });
  }
  const mesh = cards.toMesh('undergrowth-ferns', kit.scene);
  mesh.material = foliageMaterial(kit, 'fern');
  return mesh;
}

// HORSETAILS: a stand of jointed green stems, each a pair of crossed cards of whorled branchlets.
export function horsetailPatch(kit, { count = 26, radius = 5, height = 7, seed = 11 } = {}) {
  const rand = seededRandom(seed * 13 + 2);
  const root = new TransformNode('horsetail-patch', kit.scene);
  const cards = new Cards();
  for (let c = 0; c < count * 2; c++) {
    const a = rand() * 6.283; const d = radius * Math.sqrt(rand());
    const h = height * (0.55 + rand() * 0.6); const w = h * 0.24;
    const base = new Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    const lean = new Vector3((rand() - 0.5) * 0.16, 1, (rand() - 0.5) * 0.16).normalize();
    const yaw = rand() * Math.PI;
    for (const turn of [0, Math.PI / 2]) {
      const s = new Vector3(Math.cos(yaw + turn), 0, Math.sin(yaw + turn));
      const nrm = Vector3.Cross(s, lean).normalize().add(UP.scale(0.6)).normalize();
      cards.quad(base.add(lean.scale(h / 2)), s.scale(w), lean.scale(h / 2), nrm);
    }
  }
  finishFoliage(kit, root, cards, 'horsetail', 'horsetail-patch');
  root.metadata.instanceable = false;
  return root;
}

// ---- grasses ---------------------------------------------------------------------------------
// Real blades, as geometry with vertex colour, for the places a layout asks for LONG grass:
// puna tussocks and an unmown meadow. (The lawn itself is the instanced grass system.)
let bladeMat = null;
function bladeMaterial(kit) {
  if (bladeMat) return bladeMat;
  bladeMat = new PBRMaterial('long-grass', kit.scene);
  bladeMat.metallic = 0; bladeMat.roughness = 0.8; bladeMat.backFaceCulling = false; bladeMat.twoSidedLighting = false;
  // Blades are shaded with near-vertical normals (so a clump reads as one soft mass), which
  // also points every one of them at the sky probe: left at full strength the Fresnel term
  // paints a meadow blue-grey. Grass is not a mirror.
  bladeMat.specularIntensity = 0.12;
  bladeMat.environmentIntensity = 0.3;
  bladeMat.subSurface.isTranslucencyEnabled = true; bladeMat.subSurface.translucencyIntensity = 0.45;
  bladeMat.subSurface.tintColor = linear(0xb8e05a);
  return bladeMat;
}

function bladeField(kit, name, clumps, { rootColor, tipColor, seedHeads = 0, seedColor }) {
  const p = []; const n = []; const col = []; const idx = [];
  const rc = linear(rootColor); const tc = linear(tipColor); const sc = seedColor ? linear(seedColor) : tc;
  for (const c of clumps) {
    const rand = seededRandom(c.seed);
    for (let i = 0; i < c.blades; i++) {
      const az = rand() * 6.283; const lean = 0.15 + rand() * (c.splay ?? 0.7);
      const len = c.height * (0.55 + rand() * 0.6); const w = 0.035 + rand() * 0.03;
      const ox = c.x + Math.cos(az) * c.spread * rand(); const oz = c.z + Math.sin(az) * c.spread * rand();
      const dx = Math.cos(az); const dz = Math.sin(az); const sx = -dz; const sz = dx;
      const shade = 0.8 + rand() * 0.4;
      const base = p.length / 3; const SEG = 4;
      for (let s = 0; s <= SEG; s++) {
        const t = s / SEG; const bend = lean * t * t;
        const cx = ox + dx * bend * len; const cy = (t - bend * bend * 0.3) * len; const cz = oz + dz * bend * len;
        const ww = w * (1 - t * 0.9);
        p.push(cx - sx * ww, cy, cz - sz * ww, cx + sx * ww, cy, cz + sz * ww);
        const nx = dx * 0.3 * t; const nz = dz * 0.3 * t; const l = Math.hypot(nx, 1, nz);
        n.push(nx / l, 1 / l, nz / l, nx / l, 1 / l, nz / l);
        const head = seedHeads && t > 0.82 && i % seedHeads === 0;
        const k = (0.5 + 0.5 * t) * shade;
        const r = head ? sc.r : rc.r + (tc.r - rc.r) * t; const g = head ? sc.g : rc.g + (tc.g - rc.g) * t; const bl = head ? sc.b : rc.b + (tc.b - rc.b) * t;
        col.push(r * k, g * k, bl * k, 1, r * k, g * k, bl * k, 1);
      }
      for (let s = 0; s < SEG; s++) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const mesh = new Mesh(name, kit.scene);
  const vd = new VertexData(); vd.positions = p; vd.normals = n; vd.colors = col; vd.indices = idx; vd.applyToMesh(mesh);
  mesh.material = bladeMaterial(kit); mesh.receiveShadows = true;
  return mesh;
}

// ICHU: the bunch grass of the puna. Dense golden tussocks, every blade springing from one
// crown and arching outward -- a fountain, not a lawn.
export function ichuGrass(kit, { radius = 5, count = 18, seed = 43 } = {}) {
  const rand = seededRandom(seed * 5 + 3);
  const clumps = [];
  for (let i = 0; i < count; i++) { const a = rand() * 6.283; const d = radius * Math.sqrt(rand()); clumps.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, blades: 95, height: 1.7 + rand() * 1.3, spread: 0.32, splay: 1.0, seed: seed * 100 + i }); }
  const root = new TransformNode('ichu-grass', kit.scene);
  const mesh = bladeField(kit, 'ichu-grass', clumps, { rootColor: 0x6a6a34, tipColor: 0xd8c070, seedHeads: 6, seedColor: 0xe8d8a0 });
  mesh.parent = root;
  root.metadata = { casters: [], instanceable: false };
  return root;
}

// An unmown meadow: taller, greener, looser, with seed heads catching the light.
export function meadowClump(kit, { radius = 7, count = 240, height = 2.6, seed = 31 } = {}) {
  const rand = seededRandom(seed * 3 + 7);
  const clumps = [];
  const n = Math.round(count * 0.5);
  for (let i = 0; i < n; i++) { const a = rand() * 6.283; const d = radius * Math.sqrt(rand()); clumps.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, blades: 26, height: height * (0.7 + rand() * 0.6), spread: 0.5, splay: 0.6, seed: seed * 100 + i }); }
  const root = new TransformNode('meadow-clump', kit.scene);
  const mesh = bladeField(kit, 'meadow-clump', clumps, { rootColor: 0x3a7a22, tipColor: 0xa8d24e, seedHeads: 4, seedColor: 0xe0cc88 });
  mesh.parent = root;
  root.metadata = { casters: [], instanceable: false };
  return root;
}

// ---- hedgerow -----------------------------------------------------------------------------------
// BRAMBLE: long canes arching up and over to root again at the tip, in a tangle, carrying leaf
// and the odd flower. The arch is the mark -- a bramble is a heap of hoops.
export function brambleThicket(kit, { radius = 8, canes = 16, seed = 51 } = {}) {
  const rand = seededRandom(seed * 17 + 9);
  const b = kit.builder('bramble');
  const cane = kit.flat(0x5a3a34, { rough: 0.7 });
  const berry = kit.flat(0x1a0f24, { rough: 0.25, clearcoat: 0.5 });
  const cards = new Cards();
  const centre = new Vector3(0, radius * 0.28, 0);
  for (let c = 0; c < canes * 2; c++) {
    const a = rand() * 6.283; const r0 = rand() * radius * 0.5;
    const from = new Vector3(Math.cos(a) * r0, 0, Math.sin(a) * r0);
    const a2 = a + (rand() - 0.5) * 2.4; const reach = radius * (0.5 + rand() * 0.55);
    const to = from.add(new Vector3(Math.cos(a2) * reach, 0, Math.sin(a2) * reach));
    const top = from.add(to).scale(0.5).add(UP.scale(radius * (0.3 + rand() * 0.34)));
    const pts = kit.curve([from, from.add(top).scale(0.5).add(UP.scale(radius * 0.12)), top, to.add(top).scale(0.5).add(UP.scale(radius * 0.06)), to], 12);
    b.add(kit.tube(pts, 0.035, { sides: 5 }), cane);
    for (let k = 1; k < pts.length - 1; k++) {
      cluster(cards, rand, pts[k], radius * 0.07, centre, 3, radius * 0.17);
      if (rand() < 0.22) b.add(kit.sphere(0.075, { segments: 6 }), berry, { pos: [pts[k].x + (rand() - 0.5) * 0.3, pts[k].y - 0.12, pts[k].z + (rand() - 0.5) * 0.3] });
    }
  }
  const root = b.finish();
  finishFoliage(kit, root, cards, 'bramble', 'bramble');
  root.metadata.instanceable = false;
  return root;
}

// A CLIPPED HEDGE, `length` along X. A leafy solid underneath so it is opaque from every side,
// and a coat of small leaf cards over it so its outline is leaves and not a box.
export function nbHedge(kit, { seed = 17, length = 10, height = 2.6 } = {}) {
  const rand = seededRandom(seed * 11 + 5);
  const b = kit.builder('hedge');
  const depth = Math.max(1.6, height * 0.62);
  const core = kit.mat('Ground037', { tint: 0x5c8a3a, gain: 0.9, tile: 3, bump: 1.6 });
  b.add(kit.box(length - 0.3, height - 0.3, depth - 0.3, { bevel: 0.12 }), core, { pos: [0, (height - 0.3) / 2, 0] });
  const root = b.finish();
  const cards = new Cards();
  const centre = new Vector3(0, height * 0.35, 0);
  const n = Math.round(length * height * 9);
  for (let i = 0; i < n; i++) {
    // points on the hedge's own surface: top and the two long faces, a few on the ends
    const f = rand(); let pos;
    if (f < 0.4) pos = new Vector3((rand() - 0.5) * length, height - 0.1, (rand() - 0.5) * depth);
    else if (f < 0.9) pos = new Vector3((rand() - 0.5) * length, rand() * height, (rand() < 0.5 ? -1 : 1) * depth * 0.5);
    else pos = new Vector3((rand() < 0.5 ? -1 : 1) * length * 0.5, rand() * height, (rand() - 0.5) * depth);
    const local = new Vector3(pos.x * 0.15, centre.y, 0); // shade outward from the hedge's own spine
    cluster(cards, rand, pos, 0.16, local, 2, 1.25);
  }
  finishFoliage(kit, root, cards, 'hedge', 'hedge');
  return root;
}

// The Neighborhood's street trees, in their three colours.
export function nbTree(kit, { seed = 15, height = 24, variant = 'green' } = {}) {
  const make = variant === 'autumn' ? autumnMapleTree : variant === 'gold' ? goldMapleTree : shadeTree;
  return make(kit, { height, seed });
}
export function nbConifer(kit, { seed = 16, height = 20 } = {}) { return coniferTree(kit, { height, seed }); }

export { randomUnit };
