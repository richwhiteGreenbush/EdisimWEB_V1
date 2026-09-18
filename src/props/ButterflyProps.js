import * as THREE from 'three';
import {
  standard, mesh, group, seededRandom, relief,
} from '../PropKit.js';
import {
  solidLoft, revolve, solidSurface, extrudeOutline, ball, tube, chain, spike, dome,
  mergeParts, tintGeometry, placed, xformed, put, smoothNoise3, splineAt,
} from './LoftKit.js';

// The Butterfly Garden -- a planted nectar garden at twelve times life size, five
// species of butterfly flying through it, and the monarch's life cycle laid out along a
// walk you follow from egg to adult.
//
// THE SCALE, because every number in this file is measured against it:
//
//   GARDEN_SCALE = 12. A monarch's wingspan is 98mm, which comes out at 3.9ft -- wide
//   enough that a student standing on the path can read the black veins and the white
//   spots in its border as it goes past. At TRUE scale it is four inches, and a
//   four-inch animal next to a five-foot student is a speck: there is no amount of
//   modelling that rescues it, because nothing about it is ever more than a few pixels.
//   This is the inversion A Bug's Life makes at 60x and Sunflower at 40x -- the student
//   is not shrunk, the garden is grown, and the student ends up about five inches tall.
//
//   The flowers go up with it. A coneflower is 3ft and comes out at 36ft; its HEAD is
//   3in and comes out at 3ft, which is almost exactly a monarch's wingspan -- so a
//   butterfly settled on a flower covers its head, which is what a butterfly on a flower
//   actually looks like. That relationship is the whole reason to scale both by one
//   number rather than to pick sizes that look right one at a time.
//
//   THERE IS NO MAN-MADE GARDEN FURNITURE HERE, and that is a consequence rather than an
//   omission. An arch is 8ft and would come out at 96ft; a bench 4ft and 48ft. Sunflower
//   hit this and answered it the same way: the world is plants, ground and the app's own
//   boards, which stay at student scale in every world in this project because they are
//   read by the student and not by the mouse.
//
//   The LIFE CYCLE WALK is the one deliberate exception and it is stated on its own
//   board. The four stages span 1.2mm to 100mm -- a factor of eighty -- so no single
//   magnification can show all four: at the garden's 12x an egg is half an inch and
//   invisible. Each station is therefore blown up to about the same DISPLAY size so the
//   shapes can be compared, and each placard states the true size and the magnification.
//   That is Fantastic Voyage's rule ("each placard states the real size, so the
//   enlargement teaches instead of misleading"), and here the mismatch IS the lesson.
//
// House rules are PropKit's: feet at scale 1, origin at base centre, every prop faces its
// own +Z, fresh materials and textures per call, seededRandom and never Math.random,
// merge everything.

export const GARDEN_SCALE = 12;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const BF = {
  // Wings -- the five species, and these are the colours the canvases are painted from
  monarchOrange: 0xe86a17,
  monarchDeep: 0xc4490b,
  monarchVein: 0x1a1108,
  monarchSpot: 0xfff6e8,

  swallowYellow: 0xf7d13c,
  swallowDeep: 0xe0a91c,
  swallowBlack: 0x18140e,
  swallowBlue: 0x4a7fd4,
  swallowOrange: 0xef7b2a,

  morphoBlue: 0x2a72e8,
  morphoBright: 0x62b4ff,
  morphoRim: 0x101522,
  morphoUnder: 0x6b5238,
  morphoOcell: 0x1a1410,

  zebraBlack: 0x16130f,
  zebraYellow: 0xf4e04a,
  zebraRed: 0xc03a22,

  peacockRed: 0xa8281e,
  peacockDeep: 0x6e1a16,
  peacockEyeBlue: 0x3f6fd8,
  peacockEyeCream: 0xe8d9a8,
  peacockUnder: 0x1e1712,

  // Bodies
  bodyDark: 0x241c14,
  bodyBlack: 0x14110c,
  bodyFur: 0x3a2c1e,
  bodyPale: 0xcbb896,
  eyeDark: 0x120e0a,
  antenna: 0x1a150f,
  proboscis: 0x3d2f1e,

  // The life cycle
  eggCream: 0xf2e9c4,
  eggPale: 0xfbf6e2,
  catYellow: 0xf5d13a,
  catWhite: 0xf6f1e2,
  catBlack: 0x1c1913,
  catLeg: 0x241f16,
  chrysJade: 0x4fae6a,
  chrysDeep: 0x2f7a46,
  chrysGold: 0xf2c53d,
  chrysStalk: 0x2a2018,

  // Plants
  leaf: 0x4f9634,
  leafDeep: 0x357024,
  leafPale: 0x77b84a,
  stem: 0x4a8a2c,
  stemPale: 0x6ba63a,

  // Flowers -- vibrant on purpose; this is a garden planted to be looked at
  magenta: 0xd8348a,
  purple: 0x8347c4,
  violet: 0x6a5ad0,
  hotPink: 0xe8558f,
  coral: 0xf2603f,
  scarlet: 0xd92b2b,
  tangerine: 0xf5852a,
  gold: 0xf6be1f,
  cream: 0xf6efd2,
  lilac: 0xb98ce0,
  skyflower: 0x4f9ad8,
  rose: 0xe87ba8,
  discGold: 0xd9a226,
  discBrown: 0x4a3218,
  discGreen: 0x7a9c3a,
  pollen: 0xffd964,
  nectarGuide: 0xa8206a,

  // Ground
  soil: 0x5e4a30,
  soilDark: 0x3d3020,
  gravel: 0x9a9184,
  gravelPale: 0xbfb6a4,
  water: 0x4a6f7a,
  stone: 0x8d8579,
  plinth: 0x6f6a60,
  plinthDeep: 0x4c483f,
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MM_PER_FT = 304.8;

// Wingspan in feet at garden scale, from the real figure in millimetres.
const gardenSize = (mm) => (mm / MM_PER_FT) * GARDEN_SCALE;

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const col = (hex) => new THREE.Color(hex);
const lerpCol = (a, b, t) => col(a).lerp(col(b), THREE.MathUtils.clamp(t, 0, 1));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, t) => {
  const x = clamp01((t - a) / (b - a || 1e-6));
  return x * x * (3 - 2 * x);
};

// `revolve` decides its winding from the profile's direction: a bottom-up profile comes
// out inside out and renders DARK, not missing (the Seattle lesson, relearned in Chalk
// and in Sunflower). Every lathe in this file goes through here.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// A lathe profile that does not start and end ON the axis is an open tube, and the hole
// is at the top where a student looking up sees straight down it.
function closed(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// mergeParts composes its Euler as Rx*Ry*Rz -- Rz FIRST, then Ry, then Rx -- so "tip it
// over, THEN swing it round" cannot be said with one Euler. Bake the matrix in the order
// actually wanted (RobotProps' `laid`, WonderProps' `aimRot`, RomeProps' `xformed`).
function aimed(geometry, { yaw = 0, pitch = 0, roll = 0, at = [0, 0, 0] } = {}) {
  const m = new THREE.Matrix4().makeTranslation(at[0], at[1], at[2])
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeRotationX(pitch))
    .multiply(new THREE.Matrix4().makeRotationZ(roll));
  return xformed(geometry, m);
}

// A point on an ellipsoid in a given direction, with that surface's TRUE normal -- the
// gradient, which is NOT the direction wherever the radii differ. Every eye, antenna
// socket and leg root on these bodies is placed through this rather than by hand, because
// a hand-picked coordinate near a curved surface is either floating or buried and the two
// failures look nothing alike (RobotProps' onShell, the volcano's surfaceAt).
function onShell(centre, radii, dir) {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const [rx, ry, rz] = radii;
  const k = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
  const p = [centre[0] + d.x * k, centre[1] + d.y * k, centre[2] + d.z * k];
  const n = new THREE.Vector3((d.x * k) / (rx * rx), (d.y * k) / (ry * ry), (d.z * k) / (rz * rz)).normalize();
  return { p, n: [n.x, n.y, n.z] };
}

// Step `d` along a surface normal from a point on it.
const off = (p, n, d) => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d];

// A CLOSED flattened ball sunk along a surface's own normal. Closed, never partial: a
// partial sphere's rim is a hole and its inside is back faces.
function stud(list, colour, {
  at, normal = [0, 1, 0], radius, rise, wide = 1, long = 1, sink = 0.5, detail = 12, tint = null,
}) {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const g = ball(radius, detail);
  g.scale(wide, rise / radius, long);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n),
  );
  m.setPosition(at[0] - n.x * rise * sink, at[1] - n.y * rise * sink, at[2] - n.z * rise * sink);
  const part = { geometry: xformed(g, m), color: colour };
  if (tint) { part.tint = tint; part.keepColor = true; }
  list.push(part);
}

// LoftKit's tintGeometry hands the callback a POSITION and a COLOUR and nothing else, and
// several things here need the NORMAL instead -- a petal's back is duller than its front,
// and the pale underside of an abdomen is a question about which way a surface faces
// rather than about how high it is (the pectoral-fin lesson from Under the Sea).
function tintPN(geometry, fn) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  let c = geometry.attributes.color;
  if (!c) {
    c = new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    geometry.setAttribute('color', c);
  }
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const k = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (nor) n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    k.setRGB(c.getX(i), c.getY(i), c.getZ(i));
    const out = fn(p, n, k);
    if (out) c.setXYZ(i, out[0], out[1], out[2]);
  }
  c.needsUpdate = true;
  return geometry;
}

// Rewrites a geometry's UVs into one band of a shared atlas.
function bandUV(geometry, [u0, u1], { vScale = 1, vOffset = 0 } = {}) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + clamp01(uv.getX(i)) * (u1 - u0), uv.getY(i) * vScale + vOffset);
  }
  uv.needsUpdate = true;
  return geometry;
}

// Pins a geometry's UVs to a single point of the atlas -- the blank band, for anything
// carrying its colour per vertex rather than in the map.
function flatUV(geometry, [u, v]) {
  const uv = geometry.attributes.uv;
  if (!uv) return geometry;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  uv.needsUpdate = true;
  return geometry;
}

// A FRESH Texture per call wrapping a SHARED canvas.
//
// This is the one-level-lower rule SurfaceTextures.js follows and SunflowerProps repeats:
// PlacedRegistry.disposeObject3D() disposes a removed object's map outright, so one cached
// Texture handed to thirty butterflies is destroyed out from under twenty-nine of them the
// moment a student deletes the first. A canvas is not a GPU resource, so caching THAT is
// free -- the paint runs five times for the whole world instead of thirty.
function freshTexture(canvas, { srgb = true, wrapS = THREE.ClampToEdgeWrapping, wrapT = THREE.ClampToEdgeWrapping } = {}) {
  const texture = new THREE.Texture(canvas);
  texture.needsUpdate = true;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = wrapS;
  texture.wrapT = wrapT;
  texture.anisotropy = 4;
  // flipY is left at three's default TRUE, and the painters below compensate by writing
  // row 0 as v = 1. Turning it off here instead would be one flag against every canvas in
  // this file agreeing about which way up it is.
  texture.flipY = true;
  return texture;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

// ---------------------------------------------------------------------------
// 1. THE FIVE SPECIES -- one table, and it feeds four different things
// ---------------------------------------------------------------------------

// The wing OUTLINES, the painted patterns, the species board a student reads at the gate
// and every placard in the world all come out of this one table. That it is one table is
// why they agree: the monarch on the board is the monarch flying over the path, with the
// same wingspan printed beside it. Anything that edits a species edits it once.
//
// A WING IS A MEMBRANE PARAMETERISED BY (u, v), and everything else follows from that:
//
//   v  spanwise -- 0 at the root, on the thorax; 1 at the tip
//   u  chordwise -- 0 at the LEADING edge (the costa, toward +Z); 1 at the trailing edge
//
// so a wing station is a straight chord from `front(v)` to `back(v)` at `x(v)`. Three
// splines therefore describe a whole wing, and the SAME three are read by the painter
// below -- one description of the shape, used twice, which is what stops a painted
// marginal band drifting off the margin it is meant to be on (the volcano's rule).
//
// What that parameterisation cannot say is a SWALLOWTAIL'S TAIL. A tail is a thin
// projection off the trailing edge, and pushing `back(v)` out to reach it would widen the
// whole chord at that station -- filling in the gap between the tail and the body with
// membrane, which is the one thing a tail is not. It is a separate blade, rooted on the
// trailing edge. A scalloped margin is the opposite case and rides `back` happily, since
// a wobble does not make the chord non-convex.

const WING_ROOT = [0.05, 0.02, 0];

export const SPECIES = {
  monarch: {
    name: 'Monarch',
    latin: 'Danaus plexippus',
    wingspanMm: 98,
    bodyLen: 0.62,
    legs: 4, // Nymphalidae: the front pair is reduced to a brush and is not walked on
    family: 'Brush-footed (Nymphalidae)',
    where: 'North America',
    host: 'Milkweed',
    fact: 'Flies up to 3,000 miles to Mexico for the winter — and the butterfly that comes back is its great-grandchild.',
    body: BF.bodyBlack,
    bodySpots: true,
    antennaClub: 0.055,
    // A monarch is a strong, purposeful flier -- it crosses a continent on these.
    flapHz: 9.5, cruise: 1.00,
    fore: {
      x: [0.05, 0.31, 0.58, 0.83, 1.0],
      front: [0.15, 0.36, 0.45, 0.46, 0.35],
      back: [-0.10, -0.20, -0.22, -0.10, 0.29],
    },
    hind: {
      x: [0.04, 0.26, 0.49, 0.68, 0.78],
      front: [-0.06, 0.03, 0.01, -0.09, -0.22],
      back: [-0.34, -0.55, -0.62, -0.53, -0.31],
    },
  },

  swallowtail: {
    name: 'Eastern Tiger Swallowtail',
    latin: 'Papilio glaucus',
    wingspanMm: 110,
    bodyLen: 0.58,
    legs: 6, // Papilionidae walk on all six, which is the family's own field mark
    family: 'Swallowtail (Papilionidae)',
    where: 'Eastern North America',
    host: 'Tulip tree, wild cherry',
    fact: 'The tails are a decoy: a bird aims at them, takes a bite of nothing, and the butterfly flies off.',
    body: BF.swallowBlack,
    bodyStripe: BF.swallowYellow,
    antennaClub: 0.05,
    flapHz: 7.4, cruise: 0.92,
    fore: {
      x: [0.05, 0.32, 0.60, 0.84, 1.0],
      front: [0.16, 0.38, 0.49, 0.52, 0.40],
      back: [-0.12, -0.22, -0.26, -0.14, 0.33],
    },
    hind: {
      x: [0.04, 0.27, 0.51, 0.70, 0.80],
      front: [-0.08, 0.02, 0.00, -0.11, -0.26],
      back: [-0.36, -0.58, -0.66, -0.56, -0.34],
      scallop: { lobes: 3, depth: 0.028 },
      tail: { at: 0.36, length: 0.46, width: 0.072, sweep: 0.30 },
    },
  },

  morpho: {
    name: 'Blue Morpho',
    latin: 'Morpho peleides',
    wingspanMm: 115,
    bodyLen: 0.50,
    legs: 4,
    family: 'Brush-footed (Nymphalidae)',
    where: 'Central and South America',
    host: 'Rainforest vines',
    fact: 'That blue is not a colour. The scales are ridged so finely that they bend light — grind them up and the powder is brown.',
    body: BF.bodyBlack,
    antennaClub: 0.05,
    // Big wings on a short body: a morpho does not beat so much as it BOUNCES, a few
    // slow flaps and then a long glide, which is what makes the blue flash on and off.
    flapHz: 5.4, cruise: 0.74,
    fore: {
      x: [0.06, 0.33, 0.60, 0.84, 1.0],
      front: [0.18, 0.42, 0.53, 0.54, 0.35],
      back: [-0.14, -0.26, -0.31, -0.19, 0.27],
    },
    hind: {
      x: [0.05, 0.29, 0.54, 0.74, 0.85],
      front: [-0.08, 0.04, 0.02, -0.12, -0.28],
      back: [-0.40, -0.64, -0.72, -0.61, -0.37],
      scallop: { lobes: 3, depth: 0.022 },
    },
  },

  zebra: {
    name: 'Zebra Longwing',
    latin: 'Heliconius charithonia',
    wingspanMm: 88,
    bodyLen: 0.66,
    legs: 4,
    family: 'Brush-footed (Nymphalidae)',
    where: 'Florida, Central America',
    host: 'Passionflower',
    fact: 'The only butterfly that EATS POLLEN as well as drinking nectar — which is why it lives for months instead of weeks.',
    body: BF.zebraBlack,
    antennaClub: 0.045,
    // The slowest, driftiest flight of the five, and unmistakable for it.
    flapHz: 6.0, cruise: 0.58,
    // Long and narrow: the silhouette is half of what tells this one from the others, and
    // a longwing that is merely a smaller monarch reads as a monarch.
    fore: {
      x: [0.05, 0.31, 0.60, 0.85, 1.0],
      front: [0.12, 0.28, 0.33, 0.31, 0.18],
      back: [-0.12, -0.10, -0.08, -0.01, 0.11],
    },
    hind: {
      x: [0.04, 0.23, 0.42, 0.57, 0.64],
      front: [-0.14, -0.08, -0.10, -0.18, -0.27],
      back: [-0.33, -0.42, -0.45, -0.40, -0.32],
    },
  },

  peacock: {
    name: 'Peacock',
    latin: 'Aglais io',
    wingspanMm: 60,
    bodyLen: 0.60,
    legs: 4,
    family: 'Brush-footed (Nymphalidae)',
    where: 'Europe and Asia',
    host: 'Stinging nettle',
    fact: 'Shut, it is a dead leaf. Opened suddenly, four huge eyes stare back — and it HISSES, by scraping its wings together.',
    body: BF.bodyDark,
    antennaClub: 0.05,
    // The smallest here, so the fastest wingbeat: wingbeat goes UP as size comes down.
    flapHz: 11.2, cruise: 1.08,
    fore: {
      x: [0.06, 0.33, 0.60, 0.84, 1.0],
      front: [0.18, 0.40, 0.50, 0.50, 0.33],
      back: [-0.14, -0.24, -0.28, -0.15, 0.24],
      scallop: { lobes: 2, depth: 0.022 },
    },
    hind: {
      x: [0.05, 0.29, 0.54, 0.74, 0.85],
      front: [-0.08, 0.03, 0.01, -0.12, -0.29],
      back: [-0.38, -0.62, -0.70, -0.60, -0.36],
      scallop: { lobes: 3, depth: 0.030 },
    },
  },
};

export const SPECIES_ORDER = ['monarch', 'swallowtail', 'morpho', 'zebra', 'peacock'];

// ---------------------------------------------------------------------------
// 2. WING SHAPE -- three splines, read by both the geometry and the painter
// ---------------------------------------------------------------------------

// Exported for tools/check-butterfly.mjs and the wing preview, the way SceneSetup exports
// terrainHeightAt for the world exporter: the alternative is a second copy of the outline
// that is free to drift from the one the geometry is actually swept from.
export function wingShape(cfg) {
  const scallop = cfg.scallop || null;
  const backAt = (v) => {
    let z = splineAt(cfg.back, v);
    // A scalloped margin is a WOBBLE on the trailing edge, and its lobe count is bounded
    // by the spanwise sample count: this project's own rule is nine samples a cycle, and a
    // hero wing gets 24 spanwise rows, so three lobes is the ceiling. Asked for more it
    // does not make a finer scallop, it makes aliasing.
    if (scallop) z -= Math.abs(Math.sin(v * Math.PI * scallop.lobes)) * scallop.depth * smooth(0.12, 0.4, v);
    return z;
  };
  const span = splineAt(cfg.x, 1);
  return {
    span,
    x: (v) => splineAt(cfg.x, v),
    front: (v) => splineAt(cfg.front, v),
    back: backAt,
    // Everything the painter needs for one row, worked out once per row rather than once
    // per texel: the splines are the expensive part and they depend only on v.
    row(v) {
      const front = splineAt(cfg.front, v);
      const back = backAt(v);
      return { front, back, chord: Math.abs(front - back), x: splineAt(cfg.x, v), span, v };
    },
  };
}

// The membrane itself. A CLOSED SOLID with a real rim (solidSurface), never a
// zero-thickness DoubleSide plane: a plane is invisible edge-on, which on an animal whose
// wings turn through 110 degrees twice a second means it blinks out of existence twice a
// second (Under the Sea's rule, arrived at the one model that flaps).
function wingGeometry(shape, {
  nu, nv, thickness, dihedral, cup, origin = WING_ROOT, side = 1,
}) {
  return solidSurface({
    nu,
    nv,
    point: (u, v) => {
      const r = shape.row(v);
      const z = r.front + (r.back - r.front) * u;
      // A spread wing is not a flat plate: it carries a shallow dihedral and the trailing
      // half droops. Both are small, and both are what stop it reading as card.
      const y = dihedral * Math.pow(v, 1.3) + cup * Math.sin(Math.PI * u) * v;
      return [side * (r.x - origin[0]), y - origin[1], z - origin[2]];
    },
    // Thin at both margins and at the tip so solidSurface emits no rim there (its own
    // degenerate-rim skip), thickest just inside the leading edge, which is where the
    // costal vein -- the wing's one real structural spar -- actually runs.
    thick: (u, v) => thickness
      * Math.pow(Math.sin(Math.PI * clamp01(u)), 0.45)
      * (0.42 + 0.58 * Math.pow(1 - u, 1.2))
      * (1 - Math.pow(v, 2.6)),
  });
}

// A swallowtail's tail: its own blade, rooted on the hindwing's trailing edge.
function tailGeometry(shape, cfg, { thickness, origin, side }) {
  const r0 = shape.row(cfg.at);
  const rootX = r0.x;
  const rootZ = r0.back;
  return solidSurface({
    nu: 5,
    nv: 9,
    point: (u, v) => {
      const s = (u - 0.5) * 2;
      // Widest at the root and swelling again into the spatulate tip a swallowtail has --
      // a tail that tapers evenly to a point is a thorn, not a tail.
      const hw = cfg.width * (0.55 + 0.45 * Math.sin(Math.PI * Math.pow(clamp01(v * 1.04), 0.75)))
        * (1 - Math.pow(v, 6));
      const out = cfg.sweep * v * v;
      return [
        side * (rootX + out - origin[0] + s * hw * 0.25),
        -origin[1] - v * 0.035,
        rootZ - v * cfg.length - origin[2] + s * hw,
      ];
    },
    thick: (u, v) => thickness * 0.9
      * Math.pow(Math.sin(Math.PI * clamp01(u)), 0.45) * (1 - Math.pow(v, 3)),
  });
}

// ---------------------------------------------------------------------------
// 3. THE WING ATLAS -- the pattern is a PAINTING, and it has to be
// ---------------------------------------------------------------------------

// A BUTTERFLY IS ITS WING PATTERN. Take the pattern off a monarch and what is left is a
// generic insect; nothing else about the animal identifies it. So the pattern carries the
// whole model, and it cannot be a per-vertex tint: a monarch's veins are about 1mm on a
// 50mm wing, which at any mesh density this world can afford is well under one sample --
// this project's own most-repeated rule is that A TINT CAN ONLY BE AS DETAILED AS THE MESH
// UNDER IT, and the answer is always more mesh or a texture, never a hotter tint. Veins at
// two samples a vein do not make veins, they make aliasing.
//
// It is painted PER TEXEL FROM THE SAME SPLINES THE GEOMETRY IS SWEPT FROM, so a marginal
// band is "within 7% of a half-span of the real margin" and lands exactly on the margin at
// any wing shape -- including out along a swallowtail's scallops. Painted in a rectified
// (u, v) box with the margin guessed at instead, every band drifts off its own edge.
//
// THE UPPER AND UNDER SURFACES ARE DIFFERENT PAINTINGS, and for two of these five that is
// most of the animal: a Blue Morpho is brilliant blue above and a dead brown leaf with
// eyespots below, and a Peacock is four staring eyes above and near-black below. It is
// also the whole reason a morpho FLASHES as it flies. solidSurface lays its top sheet
// down first and its bottom sheet second, cols*rows each, so remapping the second half's
// u into a different band of the atlas is what buys that -- for no extra geometry.
//
// The atlas is deliberately small (288 x 224). It is created FRESH PER BUTTERFLY, because
// disposeObject3D() disposes a removed object's map outright and one cached Texture handed
// to thirty butterflies dies with the first one a student deletes; what is cached is the
// CANVAS, one level lower, which is not a GPU resource. Thirty of these is about 8MB of
// texture, which on shared-memory graphics comes out of system RAM.

const ATLAS_W = 288;
const ATLAS_H = 224;
const BAND_W = 68;

// Pixel ranges, then the UV bands inset two texels inside them so a coarse mip level
// cannot bleed one wing's pattern into the next one's.
export const ATLAS = { w: ATLAS_W, h: ATLAS_H, band: BAND_W };

const BANDS = {
  foreUp: [0, BAND_W],
  foreUn: [BAND_W, BAND_W * 2],
  hindUp: [BAND_W * 2, BAND_W * 3],
  hindUn: [BAND_W * 3, BAND_W * 4],
};
const UV = {
  foreUp: [2 / ATLAS_W, (BAND_W - 2) / ATLAS_W],
  foreUn: [(BAND_W + 2) / ATLAS_W, (BAND_W * 2 - 2) / ATLAS_W],
  hindUp: [(BAND_W * 2 + 2) / ATLAS_W, (BAND_W * 3 - 2) / ATLAS_W],
  hindUn: [(BAND_W * 3 + 2) / ATLAS_W, (BAND_W * 4 - 2) / ATLAS_W],
  blank: [(BAND_W * 4 + 8) / ATLAS_W, 0.5],
};

// One scratch pixel, because a painter runs 60,000 times per species and an allocation
// per texel is the difference between 80ms and four seconds.
const PX = new Float32Array(3);
const setPx = (hex) => {
  PX[0] = (hex >> 16) & 255; PX[1] = (hex >> 8) & 255; PX[2] = hex & 255;
};
const mixPx = (hex, t) => {
  if (t <= 0) return;
  const k = t > 1 ? 1 : t;
  PX[0] += (((hex >> 16) & 255) - PX[0]) * k;
  PX[1] += (((hex >> 8) & 255) - PX[1]) * k;
  PX[2] += ((hex & 255) - PX[2]) * k;
};

// --- painter primitives, all measured in HALF-SPAN UNITS so a band is the same width
// --- on a 60mm peacock and a 115mm morpho.

// How far this texel is from the wing's exposed OUTER margin.
//
// A forewing's trailing edge is two different things along its length: near the body it is
// the inner margin, tucked against the hindwing and never bordered, and past mid-span it is
// the termen, which carries the border. The gate is what says where one becomes the other;
// without it every monarch grows a black stripe down the edge that meets its own abdomen.
function outerDist(u, v, r, gateLo, gateHi) {
  const gate = smooth(gateLo, gateHi, v);
  return Math.min((1 - v) * r.span, (1 - u) * r.chord + (1 - gate) * 0.6);
}

// How strongly this texel sits on a vein, 0 to 1. Veins radiate from where the wing meets
// the body, so their spacing OPENS along the span -- parallel lines at fixed u read as
// printed stripes rather than as a skeleton.
//
// TWO THINGS HERE ARE CORRECTIONS, and both were found by painting the atlas and looking
// at it. The fan must NOT converge to a point: at spread = v^0.5 every vein meets at
// u = 0.5 at the root, which does not read as a wing base, it paints a solid black wedge
// across the bottom of every band -- a monarch with a black wing root. And the veins have
// to FADE OUT there as well, which is true of the animal anyway: the last half-inch of
// every vein is under the thorax fur and has never been visible on any butterfly.
function veinAt(u, v, r, veins, w0, w1) {
  const spread = 0.34 + 0.66 * Math.pow(clamp01(v), 0.5);
  let best = 9;
  for (let i = 0; i < veins.length; i++) {
    const d = Math.abs(u - (0.5 + (veins[i] - 0.5) * spread)) * r.chord;
    if (d < best) best = d;
  }
  return (1 - smooth(w0, w1, best)) * smooth(0.02, 0.17, v);
}

// A single round spot at a named place on the wing.
const spotAt = (u, v, r, cu, cv, rad) => Math.hypot((u - cu) * r.chord, (v - cv) * r.span) < rad;

// A row of round spots running ALONG the margin at a fixed depth into it. The along-margin
// coordinate is a real arc length, so the spots stay evenly spaced as they turn the apex
// instead of bunching where the parameterisation happens to be dense.
// A row of round spots running ALONG the margin at a fixed depth into it.
//
// THE ALONG-MARGIN COORDINATE DEGENERATES AT THE TIP and has to be stopped short of it.
// Where the chord goes to zero, `span + (1-u)*chord` stops depending on u at all, so a
// whole row of texels shares one phase and the spots smear into a solid cream bar right
// across the apex -- which is exactly what the first painted atlas showed on four of the
// five species. Past `vMax` the apex carries its own named spots instead, which is what
// the animal has: a monarch's apex spots are bigger than its marginal ones and sit in the
// black patch rather than in the border.
function marginSpot(u, v, r, dOuter, rowD, radius, spacing, vMax = 0.86) {
  if (v > vMax) return false;
  const dTip = (1 - v) * r.span;
  const dBack = (1 - u) * r.chord;
  const s = dTip < dBack ? r.span + (1 - u) * r.chord : v * r.span;
  const k = ((s / spacing) % 1 + 1) % 1;
  return Math.hypot(dOuter - rowD, (k - 0.5) * spacing) < radius;
}

// One eyespot: concentric rings from the pupil out. `rings` is [[radiusFraction, colour]].
function eyespot(u, v, r, spot) {
  const d = Math.hypot(((u - spot.cu) * r.chord) / spot.rx, ((v - spot.cv) * r.span) / spot.ry);
  if (d > 1) return -1;
  for (let i = 0; i < spot.rings.length; i++) if (d <= spot.rings[i][0]) return spot.rings[i][1];
  return -1;
}

// A band crossing the wing from the leading edge to the trailing edge -- a tiger stripe, a
// longwing's bar. Slanted, because a stripe square across the wing reads as a barcode.
function crossBand(u, v, at, halfWidth, slant) {
  return 1 - smooth(halfWidth * 0.55, halfWidth, Math.abs(v - at - (u - 0.5) * slant));
}

const VEIN_FORE = [0.12, 0.26, 0.40, 0.55, 0.70, 0.86];
const VEIN_HIND = [0.15, 0.32, 0.50, 0.68, 0.85];

// Eyespots, which on two of these five are the animal. A real ocellus is concentric rings
// with a white catchlight off-centre of a black pupil -- that catchlight is what makes it
// read as an EYE rather than as a target, and it is one ring of the list.
const MORPHO_FORE_OCELLI = [
  { cu: 0.70, cv: 0.66, rx: 0.052, ry: 0.052, rings: [[0.20, 0xf2ecdc], [0.58, 0x181310], [0.84, 0xc9a06a], [1, 0x7a5f40]] },
  { cu: 0.74, cv: 0.85, rx: 0.042, ry: 0.042, rings: [[0.20, 0xf2ecdc], [0.58, 0x181310], [0.84, 0xc9a06a], [1, 0x7a5f40]] },
];
const MORPHO_HIND_OCELLI = [0.26, 0.47, 0.68, 0.87].map((cv, i) => ({
  cu: 0.66, cv, rx: 0.062 - i * 0.006, ry: 0.062 - i * 0.006,
  rings: [[0.18, 0xf4eee0], [0.56, 0x161210], [0.82, 0xd0a86e], [1, 0x7a5f40]],
}));
const PEACOCK_FORE_EYE = {
  cu: 0.30, cv: 0.79, rx: 0.135, ry: 0.145,
  rings: [[0.20, 0x14100e], [0.34, 0xdfe6f2], [0.56, 0x3a5fb8], [0.74, 0x14100e], [0.90, 0xe2cf92], [1, 0x8a3a24]],
};
const PEACOCK_HIND_EYE = {
  cu: 0.58, cv: 0.52, rx: 0.185, ry: 0.185,
  rings: [[0.18, 0x14100e], [0.30, 0xdfe6f2], [0.55, 0x2f56b4], [0.76, 0x14100e], [0.92, 0xc9b184], [1, 0x5e2a20]],
};

const PAINTERS = {
  monarch: {
    foreUp(u, v, r) {
      setPx(BF.monarchOrange);
      mixPx(BF.monarchDeep, smooth(0.55, 0.05, v) * 0.30);
      mixPx(BF.monarchVein, veinAt(u, v, r, VEIN_FORE, 0.006, 0.017));
      mixPx(BF.monarchVein, 1 - smooth(0.005, 0.015, u * r.chord));
      // A monarch's APEX is black right across the chord, not merely bordered, and that
      // black triangle is half of what you recognise in the air.
      mixPx(BF.monarchVein, smooth(0.34, 0.17, (1 - v) * r.span) * 0.95);
      const dOut = outerDist(u, v, r, 0.30, 0.52);
      mixPx(BF.monarchVein, 1 - smooth(0.058, 0.080, dOut));
      if (marginSpot(u, v, r, dOut, 0.020, 0.017, 0.088)) setPx(BF.monarchSpot);
      if (marginSpot(u, v, r, dOut, 0.052, 0.013, 0.088)) setPx(BF.monarchSpot);
      // The apex spots, which a monarch wears BIGGER than its marginal ones and in two
      // colours -- the outer pair white, the inner pair the same orange as the wing.
      if (spotAt(u, v, r, 0.30, 0.94, 0.022) || spotAt(u, v, r, 0.52, 0.90, 0.020)) setPx(BF.monarchSpot);
      if (spotAt(u, v, r, 0.22, 0.83, 0.024) || spotAt(u, v, r, 0.46, 0.79, 0.022)) setPx(BF.monarchOrange);
    },
    foreUn(u, v, r) {
      setPx(0xd98a38);
      mixPx(0xc4732a, smooth(0.60, 0.05, v) * 0.30);
      mixPx(0xf0dfc0, veinAt(u, v, r, VEIN_FORE, 0.016, 0.030));
      mixPx(BF.monarchVein, veinAt(u, v, r, VEIN_FORE, 0.008, 0.020));
      mixPx(BF.monarchVein, 1 - smooth(0.005, 0.015, u * r.chord));
      mixPx(BF.monarchVein, smooth(0.34, 0.17, (1 - v) * r.span) * 0.93);
      const dOut = outerDist(u, v, r, 0.30, 0.52);
      mixPx(BF.monarchVein, 1 - smooth(0.058, 0.082, dOut));
      if (marginSpot(u, v, r, dOut, 0.022, 0.020, 0.088)) setPx(0xfdf4e2);
      if (marginSpot(u, v, r, dOut, 0.056, 0.016, 0.088)) setPx(0xfdf4e2);
      if (spotAt(u, v, r, 0.30, 0.94, 0.024) || spotAt(u, v, r, 0.52, 0.90, 0.022)) setPx(0xfdf4e2);
      if (spotAt(u, v, r, 0.22, 0.83, 0.026) || spotAt(u, v, r, 0.46, 0.79, 0.024)) setPx(0xe8a24a);
    },
    hindUp(u, v, r) {
      setPx(BF.monarchOrange);
      mixPx(BF.monarchDeep, smooth(0.65, 0.05, v) * 0.34);
      mixPx(BF.monarchVein, veinAt(u, v, r, VEIN_HIND, 0.006, 0.018));
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(BF.monarchVein, 1 - smooth(0.056, 0.078, dOut));
      if (marginSpot(u, v, r, dOut, 0.020, 0.017, 0.086)) setPx(BF.monarchSpot);
      if (marginSpot(u, v, r, dOut, 0.052, 0.013, 0.086)) setPx(BF.monarchSpot);
    },
    // The hindwing underside is the one a roosting monarch shows, and it is a different
    // animal: buff rather than orange, with the veins picked out in cream twice their
    // width. A monarch hanging in a Mexican fir looks like a dead leaf for this reason.
    hindUn(u, v, r) {
      setPx(0xd9b878);
      mixPx(0xc9a25e, smooth(0.65, 0.05, v) * 0.30);
      mixPx(0xf6ebd2, veinAt(u, v, r, VEIN_HIND, 0.018, 0.034));
      mixPx(BF.monarchVein, veinAt(u, v, r, VEIN_HIND, 0.009, 0.022));
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(BF.monarchVein, 1 - smooth(0.056, 0.080, dOut));
      if (marginSpot(u, v, r, dOut, 0.022, 0.020, 0.086)) setPx(0xfdf4e2);
      if (marginSpot(u, v, r, dOut, 0.056, 0.016, 0.086)) setPx(0xfdf4e2);
    },
  },

  swallowtail: {
    foreUp(u, v, r) {
      setPx(BF.swallowYellow);
      mixPx(BF.swallowDeep, smooth(0.70, 0.10, v) * 0.22);
      let s = crossBand(u, v, 0.14, 0.055, -0.10);
      s = Math.max(s, crossBand(u, v, 0.37, 0.050, -0.10));
      s = Math.max(s, crossBand(u, v, 0.58, 0.045, -0.09));
      s = Math.max(s, crossBand(u, v, 0.78, 0.040, -0.08));
      mixPx(BF.swallowBlack, s);
      mixPx(BF.swallowBlack, 1 - smooth(0.010, 0.026, u * r.chord));
      const dOut = outerDist(u, v, r, 0.28, 0.50);
      mixPx(BF.swallowBlack, 1 - smooth(0.070, 0.098, dOut));
      if (marginSpot(u, v, r, dOut, 0.030, 0.023, 0.095)) setPx(BF.swallowYellow);
      if (spotAt(u, v, r, 0.26, 0.93, 0.020) || spotAt(u, v, r, 0.48, 0.90, 0.018)) setPx(BF.swallowYellow);
    },
    foreUn(u, v, r) {
      setPx(0xf0dc86);
      mixPx(0xd8bc58, smooth(0.70, 0.10, v) * 0.24);
      let s = crossBand(u, v, 0.14, 0.052, -0.10);
      s = Math.max(s, crossBand(u, v, 0.37, 0.048, -0.10));
      s = Math.max(s, crossBand(u, v, 0.58, 0.043, -0.09));
      s = Math.max(s, crossBand(u, v, 0.78, 0.038, -0.08));
      mixPx(0x2a2418, s * 0.9);
      const dOut = outerDist(u, v, r, 0.28, 0.50);
      mixPx(0x2a2418, 1 - smooth(0.072, 0.100, dOut));
      if (marginSpot(u, v, r, dOut, 0.030, 0.024, 0.095)) setPx(0xf6e9a8);
    },
    hindUp(u, v, r) {
      setPx(BF.swallowYellow);
      mixPx(BF.swallowDeep, smooth(0.70, 0.10, v) * 0.18);
      mixPx(BF.swallowBlack, veinAt(u, v, r, VEIN_HIND, 0.008, 0.020));
      const dOut = outerDist(u, v, r, 0.14, 0.34);
      // Blue scaling sits JUST INSIDE the black border, never on it -- a band, not a wash.
      mixPx(BF.swallowBlue, (1 - smooth(0.085, 0.135, dOut)) * smooth(0.055, 0.085, dOut) * 1.6);
      mixPx(BF.swallowBlack, 1 - smooth(0.060, 0.085, dOut));
      if (marginSpot(u, v, r, dOut, 0.026, 0.020, 0.090)) setPx(BF.swallowYellow);
      // The orange eyespot at the inner angle, beside the tail.
      if (Math.hypot((u - 0.80) * r.chord, (v - 0.20) * r.span) < 0.050) setPx(BF.swallowOrange);
    },
    hindUn(u, v, r) {
      setPx(0xf0dc86);
      mixPx(0x2a2418, veinAt(u, v, r, VEIN_HIND, 0.008, 0.022));
      const dOut = outerDist(u, v, r, 0.14, 0.34);
      // The underside carries a full ROW of orange lunules -- the loudest difference
      // between the two faces of this species, and the reason it is worth painting twice.
      if (marginSpot(u, v, r, dOut, 0.052, 0.030, 0.092)) setPx(BF.swallowOrange);
      mixPx(BF.swallowBlue, (1 - smooth(0.090, 0.140, dOut)) * smooth(0.058, 0.090, dOut) * 1.3);
      mixPx(0x2a2418, 1 - smooth(0.056, 0.080, dOut));
      if (marginSpot(u, v, r, dOut, 0.024, 0.019, 0.092)) setPx(0xf6e9a8);
    },
  },

  morpho: {
    foreUp(u, v, r) {
      setPx(BF.morphoBlue);
      // The blue is BRIGHTEST through the middle of the wing and cools at both ends. A
      // morpho painted one flat blue is a piece of blue card; what the eye reads as
      // iridescence is the gradient moving as the wing turns.
      mixPx(BF.morphoBright, smooth(0.12, 0.50, v) * (1 - smooth(0.60, 0.98, v)) * 0.85);
      mixPx(BF.morphoBright, (1 - smooth(0.12, 0.34, Math.abs(u - 0.45) * r.chord)) * 0.25);
      mixPx(BF.morphoRim, veinAt(u, v, r, VEIN_FORE, 0.012, 0.034) * 0.22);
      const dOut = outerDist(u, v, r, 0.24, 0.46);
      mixPx(BF.morphoRim, 1 - smooth(0.075, 0.115, dOut));
      mixPx(BF.morphoRim, 1 - smooth(0.010, 0.030, u * r.chord));
      if (marginSpot(u, v, r, dOut, 0.032, 0.010, 0.072)) setPx(0xd8e4f2);
    },
    foreUn(u, v, r) {
      setPx(BF.morphoUnder);
      mixPx(0x8a6a48, Math.max(0, Math.sin(v * 9.0)) * 0.30);
      mixPx(0x4e3a26, (1 - smooth(0.05, 0.16, Math.abs(v - 0.46))) * 0.5);
      mixPx(0xcbb48c, (1 - smooth(0.02, 0.07, Math.abs(v - 0.57))) * 0.55);
      const dOut = outerDist(u, v, r, 0.24, 0.46);
      mixPx(0x33261a, 1 - smooth(0.050, 0.090, dOut));
      for (let i = 0; i < MORPHO_FORE_OCELLI.length; i++) {
        const c = eyespot(u, v, r, MORPHO_FORE_OCELLI[i]);
        if (c >= 0) setPx(c);
      }
    },
    hindUp(u, v, r) {
      setPx(BF.morphoBlue);
      mixPx(BF.morphoBright, smooth(0.10, 0.45, v) * (1 - smooth(0.58, 0.98, v)) * 0.85);
      mixPx(BF.morphoRim, veinAt(u, v, r, VEIN_HIND, 0.012, 0.034) * 0.22);
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(BF.morphoRim, 1 - smooth(0.080, 0.125, dOut));
      if (marginSpot(u, v, r, dOut, 0.034, 0.010, 0.070)) setPx(0xd8e4f2);
    },
    hindUn(u, v, r) {
      setPx(BF.morphoUnder);
      mixPx(0x8a6a48, Math.max(0, Math.sin(v * 8.0 + 1.2)) * 0.30);
      mixPx(0x4e3a26, (1 - smooth(0.05, 0.15, Math.abs(v - 0.40))) * 0.5);
      mixPx(0xcbb48c, (1 - smooth(0.02, 0.07, Math.abs(v - 0.50))) * 0.55);
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(0x33261a, 1 - smooth(0.050, 0.090, dOut));
      for (let i = 0; i < MORPHO_HIND_OCELLI.length; i++) {
        const c = eyespot(u, v, r, MORPHO_HIND_OCELLI[i]);
        if (c >= 0) setPx(c);
      }
    },
  },

  zebra: {
    foreUp(u, v, r) {
      setPx(BF.zebraBlack);
      let y = crossBand(u, v, 0.30, 0.070, 0.16);
      y = Math.max(y, crossBand(u, v, 0.60, 0.058, 0.13));
      y = Math.max(y, crossBand(u, v, 0.86, 0.034, 0.10));
      mixPx(BF.zebraYellow, y);
      const dOut = outerDist(u, v, r, 0.20, 0.42);
      mixPx(BF.zebraBlack, 1 - smooth(0.030, 0.050, dOut));
      if (marginSpot(u, v, r, dOut, 0.016, 0.008, 0.065)) setPx(0xe8dfc0);
    },
    foreUn(u, v, r) {
      setPx(0x241f18);
      let y = crossBand(u, v, 0.30, 0.068, 0.16);
      y = Math.max(y, crossBand(u, v, 0.60, 0.056, 0.13));
      y = Math.max(y, crossBand(u, v, 0.86, 0.032, 0.10));
      mixPx(0xefe4a8, y);
      const dOut = outerDist(u, v, r, 0.20, 0.42);
      mixPx(0x241f18, 1 - smooth(0.030, 0.050, dOut));
      if (marginSpot(u, v, r, dOut, 0.016, 0.008, 0.065)) setPx(0xe8dfc0);
    },
    hindUp(u, v, r) {
      setPx(BF.zebraBlack);
      mixPx(BF.zebraYellow, crossBand(u, v, 0.46, 0.085, 0.10));
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(BF.zebraBlack, 1 - smooth(0.028, 0.048, dOut));
      if (marginSpot(u, v, r, dOut, 0.015, 0.008, 0.058)) setPx(0xe8dfc0);
    },
    hindUn(u, v, r) {
      setPx(0x241f18);
      mixPx(0xefe4a8, crossBand(u, v, 0.46, 0.082, 0.10));
      // The red basal spots, which only the underside has.
      if (Math.hypot((u - 0.42) * r.chord, (v - 0.12) * r.span) < 0.028) setPx(BF.zebraRed);
      if (Math.hypot((u - 0.62) * r.chord, (v - 0.18) * r.span) < 0.024) setPx(BF.zebraRed);
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(0x241f18, 1 - smooth(0.028, 0.048, dOut));
      if (marginSpot(u, v, r, dOut, 0.015, 0.008, 0.058)) setPx(0xe8dfc0);
    },
  },

  peacock: {
    foreUp(u, v, r) {
      setPx(BF.peacockRed);
      mixPx(BF.peacockDeep, smooth(0.55, 0.0, v) * 0.55);
      mixPx(0x3a1c16, crossBand(u, v, 0.16, 0.060, 0.0) * 0.80);
      mixPx(0x201512, 1 - smooth(0.012, 0.032, u * r.chord));
      const dOut = outerDist(u, v, r, 0.28, 0.50);
      mixPx(0x2a1a14, 1 - smooth(0.045, 0.075, dOut));
      const c = eyespot(u, v, r, PEACOCK_FORE_EYE);
      if (c >= 0) setPx(c);
    },
    // Shut, a peacock is a dead leaf. That is not decoration: it is why the eyes work at
    // all, because a bird has already decided the thing is a leaf before it opens.
    foreUn(u, v, r) {
      setPx(BF.peacockUnder);
      mixPx(0x0e0b09, (0.5 + 0.5 * Math.sin(v * 46 + u * 6)) * 0.35);
      mixPx(0x352a20, (1 - smooth(0.02, 0.09, Math.abs(v - 0.55))) * 0.35);
      mixPx(0x0a0808, 1 - smooth(0.040, 0.090, outerDist(u, v, r, 0.20, 0.45)));
    },
    hindUp(u, v, r) {
      setPx(BF.peacockRed);
      mixPx(BF.peacockDeep, smooth(0.70, 0.0, v) * 0.70);
      mixPx(0x241611, smooth(0.34, 0.02, v) * 0.85);
      const dOut = outerDist(u, v, r, 0.12, 0.32);
      mixPx(0x2a1a14, 1 - smooth(0.045, 0.075, dOut));
      const c = eyespot(u, v, r, PEACOCK_HIND_EYE);
      if (c >= 0) setPx(c);
    },
    hindUn(u, v, r) {
      setPx(BF.peacockUnder);
      mixPx(0x0e0b09, (0.5 + 0.5 * Math.sin(v * 40 + u * 5)) * 0.38);
      mixPx(0x30261d, (1 - smooth(0.02, 0.08, Math.abs(v - 0.46))) * 0.30);
      mixPx(0x0a0808, 1 - smooth(0.040, 0.090, outerDist(u, v, r, 0.12, 0.34)));
    },
  },
};

// THE CANVAS IS CACHED AND THE TEXTURE IS NOT (see freshTexture above). Painting is
// 60,000 painter calls per species, so this runs five times for the whole world rather
// than thirty; the splines are lifted out of the inner loop into one row context, which
// is the difference between 80ms and four seconds.
const atlasCache = new Map();

export function wingAtlas(speciesKey) {
  if (atlasCache.has(speciesKey)) return atlasCache.get(speciesKey).canvas;
  const cfg = SPECIES[speciesKey] || SPECIES.monarch;
  const paint = PAINTERS[speciesKey] || PAINTERS.monarch;
  const shapes = { fore: wingShape(cfg.fore), hind: wingShape(cfg.hind) };

  const canvas = makeCanvas(ATLAS_W, ATLAS_H);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(ATLAS_W, ATLAS_H);
  // createImageData hands back an ImageData, NOT the array -- writing indices onto the
  // object itself silently does nothing and putImageData then lays down the all-zero
  // buffer it was created with, which renders as a completely black wing.
  const data = image.data;

  const bands = [
    ['foreUp', shapes.fore], ['foreUn', shapes.fore],
    ['hindUp', shapes.hind], ['hindUn', shapes.hind],
  ];
  for (const [key, shape] of bands) {
    const [x0, x1] = BANDS[key];
    const painter = paint[key];
    const w = x1 - x0 - 1;
    for (let py = 0; py < ATLAS_H; py++) {
      // flipY is on, so canvas row 0 is sampled at uv.y = 1 -- the wing TIP.
      const v = 1 - py / (ATLAS_H - 1);
      const row = shape.row(v);
      for (let px = x0; px < x1; px++) {
        painter((px - x0) / w, v, row);
        const i = (py * ATLAS_W + px) * 4;
        data[i] = PX[0]; data[i + 1] = PX[1]; data[i + 2] = PX[2]; data[i + 3] = 255;
      }
    }
  }
  // The blank band: pure white, so anything whose UVs are pinned here comes through the
  // map's multiply untouched and carries its own per-vertex colour instead.
  for (let py = 0; py < ATLAS_H; py++) {
    for (let px = BAND_W * 4; px < ATLAS_W; px++) {
      const i = (py * ATLAS_W + px) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  atlasCache.set(speciesKey, { canvas, data });
  return canvas;
}

// The atlas's pixels, for anything that needs to READ the painting rather than sample it
// on the GPU -- the species board, which draws all five species from the same atlases the
// animals are textured with.
export function atlasPixels(speciesKey) {
  wingAtlas(speciesKey);
  return atlasCache.get(speciesKey).data;
}

// ---------------------------------------------------------------------------
// 4. THE BUTTERFLY
// ---------------------------------------------------------------------------

// WHICH SHEET OF A solidSurface IS THE UPPER ONE CANNOT BE ASSUMED, and getting it wrong
// puts a Blue Morpho's cryptic brown underside on top and its blue underneath.
//
// solidSurface lays its two sheets down consecutively -- cols*rows each, and exactly that,
// since the rim bands only add indices -- but the sheet it builds FIRST is the one along
// its own computed offset direction, which is cross(du, dv). A mirrored wing has one of
// those two tangents reversed, so the first sheet is the top on one side of the animal and
// the bottom on the other. solidSurface's own `flip` test fixes the WINDING and says
// nothing about this. Summing the first sheet's normal.y settles it by measurement.
function applyWingBands(geometry, upBand, unBand) {
  const uv = geometry.attributes.uv;
  const nor = geometry.attributes.normal;
  const half = uv.count / 2;
  let sum = 0;
  for (let i = 0; i < half; i++) sum += nor.getY(i);
  const firstIsUp = sum > 0;
  for (let i = 0; i < uv.count; i++) {
    const band = (i < half) === firstIsUp ? upBand : unBand;
    uv.setXY(i, band[0] + clamp01(uv.getX(i)) * (band[1] - band[0]), clamp01(uv.getY(i)));
  }
  uv.needsUpdate = true;
  return geometry;
}

// Shrinks a wing toward its own root and corrugates it, for the emergence station.
//
// The wrinkle is a function of the DIRECTION out from the root rather than of vertex
// index: solidSurface's geometry is indexed and welded along the seam, and a per-index
// jitter on any welded surface tears it into loose shards -- the puddingstone outcrop's
// lesson, which this project has now recorded for three separate surfaces.
function crumpleWing(geometry, scale, span) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).multiplyScalar(scale);
    const r = Math.hypot(v.x, v.z);
    const a = Math.atan2(v.z, v.x);
    v.y += Math.sin(a * 6.5) * Math.sin((r / (span * 0.5)) * 11) * span * 0.016;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

const DETAIL = {
  hero: { nu: 15, nv: 20, sides: 15, samples: 16, fur: 28, legDetail: 6, ball: 11, legTub: 5, legSides: 5 },
  field: { nu: 10, nv: 14, sides: 11, samples: 12, fur: 10, legDetail: 5, ball: 8, legTub: 4, legSides: 4 },
  far: { nu: 7, nv: 10, sides: 8, samples: 9, fur: 0, legDetail: 4, ball: 6, legTub: 3, legSides: 4 },
};

// One butterfly.
//
//   species  monarch | swallowtail | morpho | zebra | peacock
//   size     full wingspan in feet; defaults to this species at the garden's 12x
//   pose     'fly' wanders its own patch of air | 'perch' sits and opens and closes
//            | 'spread' a pinned specimen, dead still, for the life-cycle plinth
//
// THE ROOT NEVER MOVES. Everything that flies, flaps, banks or bobs happens on an inner
// rig -- the animation contract in RootMotion.js, and not a detail: four separate places
// in this app read the LIVE transform off a registered object and write it into IndexedDB,
// so a butterfly that animated its own root would have a mid-flight pose baked in the
// moment anybody touched it with the build gizmo, and again on the next refresh, and would
// walk across the garden over a term with no way to put it back.
export function butterfly({
  species = 'monarch', size = null, seed = 5, detail = 'hero', pose = 'fly',
  range = 22, ceiling = 14, floor = 4, speed = 1, flapRate = null,
} = {}) {
  const cfg = SPECIES[species] || SPECIES.monarch;
  const D = DETAIL[detail] || DETAIL.hero;
  const rng = seededRandom(seed);
  const full = size || gardenSize(cfg.wingspanMm);
  const S = full / 2; // half-span units -> feet
  const L = cfg.bodyLen;

  const body = [];

  // --- the three body sections ---------------------------------------------
  // A butterfly is head, thorax and abdomen and they are nothing like each other: a small
  // round head almost entirely taken up by two eyes, a short barrel of flight muscle, and
  // a long soft tapering abdomen. Built as one even tube it is a caterpillar with wings.
  const thorax = solidLoft([
    { d: -0.14 * L, w: 0.085 * L, up: 0.080 * L, dn: 0.075 * L, round: 1 },
    { d: -0.04 * L, w: 0.128 * L, up: 0.125 * L, dn: 0.110 * L, round: 1 },
    { d: 0.10 * L, w: 0.135 * L, up: 0.132 * L, dn: 0.115 * L, round: 1 },
    { d: 0.24 * L, w: 0.110 * L, up: 0.105 * L, dn: 0.092 * L, round: 1 },
    { d: 0.30 * L, w: 0.060 * L, up: 0.058 * L, dn: 0.052 * L, round: 1 },
  ], { sides: D.sides, samples: Math.max(8, D.samples - 6), axis: 'z' });
  put(body, thorax, cfg.body);

  const abdomen = solidLoft([
    { d: -0.60 * L, w: 0.020 * L, up: 0.020 * L, dn: 0.020 * L, round: 1 },
    { d: -0.48 * L, w: 0.055 * L, up: 0.055 * L, dn: 0.050 * L, round: 1 },
    { d: -0.30 * L, w: 0.082 * L, up: 0.082 * L, dn: 0.074 * L, round: 1 },
    { d: -0.14 * L, w: 0.098 * L, up: 0.096 * L, dn: 0.086 * L, round: 1 },
    { d: -0.02 * L, w: 0.100 * L, up: 0.098 * L, dn: 0.088 * L, round: 1 },
  ], { sides: D.sides, samples: D.samples, axis: 'z' });
  // The abdomen is SEGMENTED and the segments are what stop it reading as a sausage: ten
  // rings, each a little darker at its trailing lip where the next one overlaps it. On a
  // monarch they carry white spots, on a swallowtail a yellow stripe down each flank --
  // both of which are visible on the animal and neither of which is on the wings.
  tintPN(abdomen, (p, n) => {
    const c = col(cfg.body);
    const seg = Math.abs(((p.z / (0.058 * L)) % 1 + 1) % 1 - 0.5) * 2;
    c.multiplyScalar(0.80 + 0.30 * seg);
    if (cfg.bodySpots && Math.abs(n.y) < 0.75 && seg > 0.58) c.lerp(col(0xf2ead8), 0.62);
    if (cfg.bodyStripe && Math.abs(n.x) > 0.55) c.lerp(col(cfg.bodyStripe), 0.72);
    // Every butterfly is paler underneath, which is the only thing separating an abdomen
    // from its own shadow when it is seen against a bright sky.
    c.lerp(col(BF.bodyPale), clamp01(-n.y) * 0.28);
    return [c.r, c.g, c.b];
  });
  put(body, abdomen, 0xffffff, null, null, { keepColor: true });

  const headC = [0, 0.012 * L, 0.36 * L];
  const headR = [0.098 * L, 0.100 * L, 0.092 * L];
  const head = ball(1, D.ball);
  head.scale(headR[0], headR[1], headR[2]);
  put(body, placed(head, { pos: headC }), cfg.body);

  // --- eyes, and they are most of the head ---------------------------------
  // A butterfly's compound eyes wrap right round its head: two dark domes with a thin
  // strip of face between them. Built small and beady the animal reads as a wasp.
  for (const sx of [-1, 1]) {
    const e = onShell(headC, headR, [sx * 0.92, 0.12, 0.30]);
    stud(body, 0x17120e, {
      at: e.p, normal: e.n, radius: 0.082 * L, rise: 0.052 * L, wide: 1.06, long: 1.12, sink: 0.42,
      detail: D.ball,
      // The facets: a compound eye is thousands of lenses, and what carries that at any
      // size you can actually see it is that the dome is not one flat tone.
      //
      // A TINT MUST SUPPLY THE COLOUR, NOT MULTIPLY THE ONE BESIDE IT. This is the
      // `keepColor` trap Sunflower recorded, arriving from the other direction: `stud`
      // sets keepColor whenever a tint is given, so mergeParts does NOT write the 0x17120e
      // above, and tintGeometry seeds an absent colour attribute to WHITE. Multiplying
      // that by 0.72-1.27 gave a luminance near 1.0 -- so every butterfly in the garden
      // had two white ping-pong balls for eyes, measured at 246 near-white vertices across
      // a region three times the width of the catchlight that was blamed for them.
      tint: (p) => {
        const f = smoothNoise3(p.x * 240, p.y * 240, p.z * 240);
        const c = lerpCol(0x0e0b08, 0x2a231c, clamp01(f));
        return [c.r, c.g, c.b];
      },
    });
    // The catchlight. Without it a matte black dome is a hole in the head, which is the
    // same reason every eye in the Wonderland world carries one.
    const h = onShell(headC, headR, [sx * 0.80, 0.55, 0.62]);
    stud(body, 0xa8b4c0, {
      at: off(h.p, h.n, 0.032 * L), normal: h.n, radius: 0.016 * L, rise: 0.009 * L, detail: 7,
    });
  }

  // --- antennae: the one feature that says BUTTERFLY and not MOTH -----------
  // Clubbed, and the club has to be obvious. A moth's are feathered or tapering; every
  // butterfly on earth carries a little knob on the end of each one, and at this size it
  // is readable from across the path.
  for (const sx of [-1, 1]) {
    const root = onShell(headC, headR, [sx * 0.40, 0.80, 0.42]);
    const tip = [sx * 0.30 * L, 0.62 * L, 0.92 * L];
    chain(body, BF.antenna, [
      { p: root.p, r: 0.016 * L },
      { p: [sx * 0.16 * L, 0.34 * L, 0.64 * L], r: 0.013 * L },
      { p: tip, r: 0.011 * L },
    ], { sides: D.legSides + 1, detail: D.legDetail - 1, tubular: D.legTub, capStart: false });
    const club = ball(cfg.antennaClub * L * 1.35, 8);
    club.scale(0.72, 0.72, 1.5);
    put(body, placed(club, {
      pos: [tip[0] + sx * 0.035 * L, tip[1] + 0.055 * L, tip[2] + 0.085 * L],
      rot: [-0.55, sx * 0.22, 0],
    }), BF.antenna);
  }

  // --- the proboscis, coiled -----------------------------------------------
  // A drinking straw as long as the animal, kept rolled up under the head when it is not
  // in a flower. It is a watch-spring, not a hook: the coil is what a student recognises.
  if (detail !== 'far') {
    const pts = [];
    const radii = [];
    const turns = 2.1;
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * Math.PI * 2 * turns;
      const rr = 0.115 * L * (1 - t * 0.78);
      pts.push([0, headC[1] - 0.115 * L + rr * Math.cos(a), headC[2] + 0.02 * L + rr * Math.sin(a)]);
      radii.push(0.016 * L * (1 - t * 0.35));
    }
    put(body, tube(pts, radii, { sides: 5, tubular: 30 }), BF.proboscis);
    // Labial palps: the two little furry beaks either side of it.
    for (const sx of [-1, 1]) {
      put(body, tube([
        [sx * 0.035 * L, headC[1] - 0.06 * L, headC[2] + 0.04 * L],
        [sx * 0.042 * L, headC[1] - 0.09 * L, headC[2] + 0.16 * L],
      ], [0.030 * L, 0.006 * L], { sides: 5, tubular: 4 }), BF.bodyFur);
    }
  }

  // --- legs ----------------------------------------------------------------
  // FOUR OR SIX, AND IT IS A REAL FIELD MARK. Four of these five are brush-footed
  // (Nymphalidae): their front pair is shrunk to a furry stub held folded against the
  // chest and never walked on, so a monarch, a morpho, a zebra longwing and a peacock all
  // stand on four legs. The swallowtail is a Papilionid and stands on six. It is on the
  // species board, and a student who looks can check it.
  //
  // AND A FLYING BUTTERFLY TUCKS THEM UP. Legs splayed out in mid-air read as a spider,
  // which is the second time this file has had to stop an insect reading as the wrong
  // order of animal -- the first was the caterpillar's filaments. Down and braced is the
  // perched pose; folded against the chest is the flying one.
  const tucked = pose === 'fly' || pose === 'emerge';
  const legPairs = tucked ? [
    { z: 0.20 * L, out: 0.24, down: 0.30, reach: 0.34 },
    { z: 0.02 * L, out: 0.30, down: 0.40, reach: 0.30 },
    { z: -0.14 * L, out: 0.30, down: 0.38, reach: 0.26 },
  ] : [
    { z: 0.20 * L, out: 0.30, down: 0.62, reach: 0.30 },
    { z: 0.02 * L, out: 0.42, down: 0.78, reach: 0.10 },
    { z: -0.14 * L, out: 0.40, down: 0.74, reach: -0.16 },
  ];
  legPairs.forEach((leg, i) => {
    for (const sx of [-1, 1]) {
      if (i === 0 && cfg.legs === 4) {
        // The reduced foreleg: a hairy brush, not a leg, and tucked up under the chin.
        put(body, tube([
          [sx * 0.10 * L, -0.06 * L, leg.z],
          [sx * 0.15 * L, -0.15 * L, leg.z + 0.10 * L],
        ], [0.026 * L, 0.014 * L], { sides: 5, tubular: 4 }), BF.bodyFur);
        continue;
      }
      const hip = [sx * 0.11 * L, -0.055 * L, leg.z];
      chain(body, cfg.body, [
        { p: hip, r: 0.024 * L },
        { p: [sx * leg.out * L, -leg.down * 0.55 * L, leg.z + leg.reach * 0.35 * L], r: 0.018 * L },
        { p: [sx * leg.out * 1.16 * L, -leg.down * L, leg.z + leg.reach * L], r: 0.012 * L },
        { p: [sx * leg.out * 1.10 * L, -leg.down * 1.12 * L, leg.z + leg.reach * 1.5 * L], r: 0.006 * L },
      ], { sides: D.legSides, detail: D.legDetail, tubular: D.legTub, capStart: false });
    }
  });

  // --- the thorax fur ------------------------------------------------------
  // A butterfly's thorax is genuinely shaggy -- it is flight muscle that has to stay warm,
  // and the scales over it stand up like pile. Smooth, it reads as moulded plastic.
  for (let i = 0; i < D.fur; i++) {
    const a = i * GOLDEN_ANGLE;
    const t = (i + 0.5) / D.fur;
    const dir = [Math.cos(a) * 0.9, Math.sin(a) * 0.9, (t - 0.45) * 1.7];
    const s = onShell([0, 0, 0.08 * L], [0.135 * L, 0.130 * L, 0.24 * L], dir);
    const len = (0.052 + rng() * 0.048) * L;
    put(body, tube([
      off(s.p, s.n, -0.02 * L),
      off(s.p, s.n, len * 0.55),
      off(s.p, s.n, len),
    ], [0.011 * L, 0.007 * L, 0], { sides: 4, tubular: 3 }),
    rng() < 0.3 ? BF.bodyFur : cfg.body);
  }

  // --- wings ---------------------------------------------------------------
  const foreShape = wingShape(cfg.fore);
  const hindShape = wingShape(cfg.hind);
  const THICK = 0.0075;
  const spread = pose === 'spread';
  const emerging = pose === 'emerge';
  // A butterfly that has just come out of its case has wings about a third of their final
  // span, soft and folded. It hangs and pumps blood into the veins for an hour to open
  // them; a model with full-size wings cannot say any of that.
  const wingScale = emerging ? 0.34 : 1;
  const wingMeshes = [];
  const pivots = [];

  for (const sx of [-1, 1]) {
    const parts = [];
    const geo = (shape, cfgWing, upBand, unBand, dihedral, cup) => {
      const g = wingGeometry(shape, {
        nu: D.nu, nv: D.nv, thickness: THICK, dihedral, cup, side: sx,
      });
      applyWingBands(g, upBand, unBand);
      if (emerging) crumpleWing(g, wingScale, full);
      // WHITE per-vertex, because on these meshes the MAP carries the colour. A material
      // with both a map and vertexColors multiplies them, which is the bug that turned the
      // bear dens black and is used here on purpose -- so the vertex side has to be 1.
      put(parts, g, 0xffffff);
      if (cfgWing.tail) {
        const t = tailGeometry(shape, cfgWing.tail, { thickness: THICK, origin: WING_ROOT, side: sx });
        applyWingBands(t, upBand, unBand);
        if (emerging) crumpleWing(t, wingScale, full);
        put(parts, t, 0xffffff);
      }
    };
    // The hindwing sits a little BELOW the forewing and a little further back, which is
    // how they overlap on the animal and is also what stops the two membranes z-fighting
    // along the strip where they cross.
    geo(foreShape, cfg.fore, UV.foreUp, UV.foreUn,
      spread ? 0.012 : emerging ? -0.06 : 0.055, emerging ? -0.12 : -0.022);
    const hindParts = [];
    {
      const g = wingGeometry(hindShape, {
        nu: D.nu, nv: D.nv, thickness: THICK,
        dihedral: spread ? 0.008 : 0.042, cup: emerging ? -0.10 : -0.018,
        origin: [WING_ROOT[0], WING_ROOT[1] + 0.028, WING_ROOT[2]], side: sx,
      });
      applyWingBands(g, UV.hindUp, UV.hindUn);
      if (emerging) crumpleWing(g, wingScale, full);
      put(hindParts, g, 0xffffff);
      if (cfg.hind.tail) {
        const t = tailGeometry(hindShape, cfg.hind.tail, {
          thickness: THICK, origin: [WING_ROOT[0], WING_ROOT[1] + 0.028, WING_ROOT[2]], side: sx,
        });
        applyWingBands(t, UV.hindUp, UV.hindUn);
        if (emerging) crumpleWing(t, wingScale, full);
        put(hindParts, t, 0xffffff);
      }
    }
    parts.push(...hindParts);
    wingMeshes.push({ parts, sx });
  }

  // --- assemble ------------------------------------------------------------
  // ONE material for the whole animal, so a butterfly is THREE meshes -- body, left wings,
  // right wings -- and not six. Thirty of them is ninety draw calls, which is where this
  // world spends most of its call budget and is exactly what the brief asked for.
  const material = standard({
    vertexColors: true,
    map: freshTexture(wingAtlas(species)),
    roughness: 0.62,
    metalness: species === 'morpho' ? 0.18 : 0.04,
    ...relief('weave', { seed, repeat: 9, strength: 0.28 }),
  });

  const root = group();
  const rig = new THREE.Group();
  rig.scale.setScalar(S);
  root.add(rig);

  const bodyGeo = mergeParts(body);
  flatUV(bodyGeo, UV.blank);
  rig.add(mesh(bodyGeo, material));

  for (const { parts, sx } of wingMeshes) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * WING_ROOT[0], WING_ROOT[1], WING_ROOT[2]);
    const m = mesh(mergeParts(parts), material);
    // A wing is a big thin plate turning through 110 degrees twice a second. It casts a
    // real shadow and that shadow flickering across the path is worth the second pass;
    // what it must NOT do is receive one, because a plate this thin self-shadows into
    // banding at every grazing angle (the Mars dome's lesson).
    m.receiveShadow = false;
    pivot.add(m);
    rig.add(pivot);
    pivots.push({ pivot, sx });
  }

  root.userData.tick = butterflyTick(rig, pivots, {
    pose, rng, size: full, range, ceiling, floor, speed: speed * (cfg.cruise ?? 1),
    flapRate: flapRate || cfg.flapHz,
  });
  root.userData.species = species;
  return root;
}

// ---------------------------------------------------------------------------
// 5. THE FLUTTER
// ---------------------------------------------------------------------------

// WHAT A BUTTERFLY'S FLIGHT ACTUALLY LOOKS LIKE, in the order the recognition depends on.
// This is the one thing in the brief that no amount of modelling can deliver, and it is
// also the thing everybody can tell is wrong without being able to say why.
//
//  1. THE WINGBEAT IS SLOW ENOUGH TO SEE. A monarch beats at about 9 or 10 a second,
//     against a bumblebee's two hundred -- which is why the bee in the Sunflower world
//     draws a BLUR and this one draws the actual stroke. At 60fps that is six frames a
//     beat, so every frame of it is on screen.
//  2. THE STROKE IS NOT A SINE. The downstroke is the power stroke and it is quick; the
//     recovery is slower. A symmetric flap reads as a mechanical toy, and the fix is a
//     phase-warped sine -- sin(p + k*sin p) -- which compresses one half of the cycle and
//     stretches the other for one multiply.
//  3. THE ARC IS ENORMOUS. The wings very nearly clap over the back and come down past
//     the horizontal: about +72 to -40 degrees. Anything shy of that is a bird.
//  4. THE BODY BOBS, and it bobs because the wings are pushing it. Lift is made on the
//     DOWNstroke, so the body rises through it -- the bob is -cos(phase) against a flap of
//     sin(phase), and getting that sign backwards makes it look like it is being dropped.
//  5. THE PATH IS ERRATIC. This is the famous part, and it is an anti-predator adaptation:
//     nothing can lead a target that jinks. A butterfly on rails with perfect wings still
//     reads as a kite.
//
// Euler order matters here and is easy to get backwards. three composes an 'XYZ' Euler as
// Rx*Ry*Rz, so the Z term is applied to the vector FIRST -- which means rotation.set(twist,
// sweep, flap) flaps the wing, then sweeps it forward, then twists it, in that order. That
// is the order a wing actually moves in; written the other way the sweep turns the flap
// axis and the wing scythes sideways.
function butterflyTick(rig, pivots, {
  pose, rng, size, range, ceiling, floor, speed, flapRate,
}) {
  const UP_ANGLE = 1.26;    // ~72 degrees, wings nearly touching over the back
  const DOWN_ANGLE = -0.70; // ~-40 degrees, well past the horizontal
  const MID = (UP_ANGLE + DOWN_ANGLE) / 2;
  const AMP = (UP_ANGLE - DOWN_ANGLE) / 2;

  let phase = rng() * 6.283;
  let clock = rng() * 40;
  const baseY = rig.position.y;

  // Perched: the wings open and close slowly, with long holds at each end -- which is what
  // a basking butterfly does, and doing it as a plain sine makes it look like it is
  // fanning itself. The hold comes out of the same phase warp the flight stroke uses,
  // turned up hard.
  if (pose !== 'fly') {
    let t = rng() * 10;
    return {
      update(dt) {
        t += dt;
        let a;
        if (pose === 'spread') {
          a = -0.06;                 // a pinned specimen: flat, and dead still
        } else if (pose === 'emerge') {
          // Not a flap. A butterfly whose wings have not opened cannot flap them; what it
          // does is hang still and TREMBLE, opening them a few degrees at a time over an
          // hour. Anything faster reads as a healthy butterfly stuck in a bag.
          a = 0.34 + 0.05 * Math.sin(t * 0.9) + 0.012 * Math.sin(t * 7.3);
          rig.position.y = baseY + Math.sin(t * 1.4) * size * 0.006;
        } else {
          // Basking: open and closed with a long HOLD at each end, which is what a
          // butterfly on a flower actually does. A plain sine reads as fanning itself, and
          // the hold comes out of the same phase warp the flight stroke uses, turned up.
          const p = t * 0.62;
          a = 0.52 + 0.58 * Math.sin(p + 0.85 * Math.sin(p));
          rig.rotation.y = Math.sin(t * 0.31) * 0.06;
          rig.position.y = baseY + Math.sin(t * 0.9) * size * 0.004;
        }
        for (const { pivot, sx } of pivots) pivot.rotation.set(0, 0, sx * a);
      },
    };
  }

  // --- flying --------------------------------------------------------------
  // The local flight state. It is all LOCAL to the rig, so the record's own transform is
  // the centre of this animal's patch of air and never moves.
  let yaw = rng() * 6.283;
  let px = (rng() - 0.5) * range * 0.5;
  let pz = (rng() - 0.5) * range * 0.5;
  let py = floor + rng() * (ceiling - floor);
  let tx = (rng() - 0.5) * range;
  let tz = (rng() - 0.5) * range;
  let ty = floor + rng() * (ceiling - floor);
  let bank = 0;
  let hover = 0;
  const cruise = size * 1.45 * speed;
  const wander = [rng() * 6.28, rng() * 6.28, rng() * 6.28];

  // A TARGET HAS TO TIME OUT, not merely be arrived at.
  //
  // Measured, this is the difference between a butterfly that uses the air it is given and
  // one that looks tethered. The wander term is deliberately strong -- it is the erratic
  // path the whole flight model exists for -- and it is strong enough that the animal
  // often never comes within an arrival radius of where it was heading. With arrival as
  // the only trigger a butterfly handed five-to-twenty feet of air flew a measured 13.3 to
  // 17.9 over thirty seconds, because it repicked its height twice in that whole time.
  let nextPick = 0;
  const pickTarget = () => {
    const a = rng() * Math.PI * 2;
    const rr = range * (0.35 + rng() * 0.65);
    tx = Math.cos(a) * rr;
    tz = Math.sin(a) * rr;
    nextPick = 2.0 + rng() * 3.0;
    // Butterflies stop. A flight that never pauses reads as a patrol, and the pauses are
    // when a student can actually look at the wings.
    hover = rng() < 0.28 ? 0.8 + rng() * 2.2 : 0;
  };
  // Height is picked on its OWN clock and a faster one, because a butterfly's height
  // changes far more often than its heading does -- rising over a flower, dropping into
  // the next gap -- and tying the two together makes it fly like a paper plane.
  let nextRise = 0;
  const pickHeight = () => {
    ty = floor + rng() * (ceiling - floor);
    nextRise = 0.9 + rng() * 2.4;
  };
  pickTarget();
  pickHeight();

  return {
    update(dt) {
      const step = Math.min(dt, 0.05); // a tab that was in the background must not teleport
      clock += step;
      phase += flapRate * Math.PI * 2 * step;
      if (phase > 1e6) phase -= 1e6;

      // THE WING STROKE. The warp is what makes the downstroke snap and the recovery
      // drift; at k = 0 this is a metronome.
      const warped = phase + 0.52 * Math.sin(phase);
      const flap = MID + AMP * Math.sin(warped);
      // The wing also sweeps FORWARD as it comes down and rakes back as it goes up, and
      // twists along its own span. Both are small and both are most of what separates a
      // wingbeat from a pair of hinged flaps.
      const sweep = 0.20 * Math.cos(warped);
      const twist = 0.16 * Math.cos(warped + 0.9);

      let goalSpeed = cruise;
      if (hover > 0) {
        hover -= step;
        goalSpeed = cruise * 0.12;
      }

      // Steer toward the target, but never straight at it: two wander terms at
      // incommensurate frequencies keep the heading drifting, and a jink every so often
      // breaks the line altogether.
      const want = Math.atan2(tx - px, tz - pz);
      let turn = want - yaw;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      const drift = Math.sin(clock * 1.7 + wander[0]) * 0.9 + Math.sin(clock * 0.61 + wander[1]) * 1.3;
      const rate = turn * 1.5 + drift;
      yaw += rate * step;

      const forward = goalSpeed * (0.72 + 0.28 * Math.sin(clock * 2.3 + wander[2]));
      px += Math.sin(yaw) * forward * step;
      pz += Math.cos(yaw) * forward * step;

      // Vertical: the climb toward the target, PLUS the bob, which is the wingbeat itself
      // showing in the path. -cos(phase) against a flap of +sin(phase) puts the top of the
      // bob in the middle of the downstroke, where the lift is.
      // Height chases its target fast enough to actually use the air it is given: at the
      // first pass's 0.55 the time constant was longer than the gap between targets, so a
      // butterfly handed 5-to-16 feet flew a measured 11.3 to 14.5 and looked tethered.
      py += (ty - py) * 1.05 * step;
      const bob = -Math.cos(warped) * size * 0.085;
      // A butterfly that leaves its own patch of air is pulled back into it. Nothing in
      // this app collides with anything, and WORLD_BOUND_RADIUS only ever clamped the
      // player -- a wanderer with no leash walks out into the fog and cannot be got back.
      const out = Math.hypot(px, pz);
      if (out > range * 1.25) {
        px *= (range * 1.25) / out;
        pz *= (range * 1.25) / out;
        pickTarget();
      }
      nextPick -= step;
      nextRise -= step;
      if (nextRise <= 0) pickHeight();
      if (nextPick <= 0 || (Math.hypot(tx - px, tz - pz) < size * 1.6 && hover <= 0)) pickTarget();

      rig.position.set(px, baseY + THREE.MathUtils.clamp(py, floor, ceiling) + bob, pz);
      // Bank into the turn, and pitch nose-up slightly through the downstroke. A butterfly
      // that stays perfectly level while jinking reads as a sprite on a wire.
      bank += (THREE.MathUtils.clamp(-rate * 0.30, -0.5, 0.5) - bank) * Math.min(1, step * 6);
      rig.rotation.set(Math.sin(warped) * 0.09 - 0.05, yaw, bank);

      for (const { pivot, sx } of pivots) {
        pivot.rotation.set(twist * sx, sweep * sx, sx * flap);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 6. THE LIFE CYCLE
// ---------------------------------------------------------------------------

// FOUR STAGES THAT SPAN A FACTOR OF EIGHTY IN SIZE, which is the whole problem this walk
// has to solve. A monarch egg is 1.2mm and the adult that comes out of it is 100mm across:
// at the garden's own twelve times life size the egg is half an inch and there is nothing
// to look at. So each station is blown up to roughly the same DISPLAY size -- which is what
// lets a student compare the shapes, which is the point -- and every placard states the
// true size and the magnification. That is Fantastic Voyage's rule, and here the mismatch
// is not a compromise, it IS the lesson: the board at the head of the walk says so.

// A monarch egg. Real: 1.2mm tall, the size of a pinhead, glued one at a time to the
// UNDERSIDE of a milkweed leaf -- a female lays several hundred, one per leaf.
//
// It is a ribbed cone, and the ribs are what make it an egg rather than a bead. Nyquist
// decides how many it can have: this project's rule is nine samples a cycle, so 18 ribs
// needs 162 sides and gets 180. Asked for the 25 a real egg has, at any affordable sample
// count, the ribs do not come out finer -- they come out as aliasing.
export function butterflyEgg({ height = 7, seed = 11, ribs = 18, colour = null } = {}) {
  const H = height;
  const R = H * 0.34;
  const shell = solidLoft([
    { d: 0, w: R * 0.62, up: R * 0.62, dn: R * 0.62, round: 1 },
    { d: H * 0.14, w: R * 0.95, up: R * 0.95, dn: R * 0.95, round: 1 },
    { d: H * 0.34, w: R, up: R, dn: R, round: 1 },
    { d: H * 0.62, w: R * 0.86, up: R * 0.86, dn: R * 0.86, round: 1 },
    { d: H * 0.85, w: R * 0.52, up: R * 0.52, dn: R * 0.52, round: 1 },
    { d: H, w: R * 0.12, up: R * 0.12, dn: R * 0.12, round: 1 },
  ], {
    sides: ribs * 10,
    samples: 46,
    axis: 'y',
    // The ribs run from the flattened base up to the micropyle and DIE at both ends. A
    // warp that is still running at an end cap shows as a scalloped rosette, because the
    // cap fans from the section's un-warped centre out to its warped rim.
    warp: (t, u) => {
      const fade = Math.sin(Math.PI * Math.pow(clamp01(t), 0.8)) ** 0.6;
      const rib = Math.cos(u * Math.PI * 2 * ribs) * 0.5 + 0.5;
      const cross = Math.cos(t * Math.PI * 2 * 5) * 0.5 + 0.5;
      return R * (0.075 * rib + 0.012 * cross) * fade;
    },
  });
  const base = colour || BF.eggCream;
  tintPN(shell, (p) => {
    const rr = Math.hypot(p.x, p.z);
    // The ribs catch the light on their crests and hold shade in the flutes, and that is
    // recovered here by comparing a point's radius against the section's nominal one --
    // the same trick Egypt's sunk relief uses to find the paint that survived in the cuts.
    const t = clamp01(p.y / H);
    const nominal = R * (0.62 + 0.38 * Math.sin(Math.PI * Math.pow(t, 0.7)));
    const crest = clamp01((rr - nominal * 0.94) / (R * 0.09));
    const c = lerpCol(BF.eggCream, BF.eggPale, crest);
    // A fertile egg darkens toward the top as the caterpillar's head forms inside it, and
    // goes almost black just before it hatches.
    c.lerp(col(0x9c8a52), smooth(0.62, 0.97, t) * 0.55);
    c.multiplyScalar(0.86 + 0.20 * crest);
    return [c.r, c.g, c.b];
  });
  const g = group(mesh(shell, standard({
    vertexColors: true, roughness: 0.42, metalness: 0.02,
    ...relief('weave', { seed, repeat: 14, strength: 0.35 }),
  })));
  return g;
}

// A fifth-instar monarch caterpillar. Real: 45mm, from a 2mm hatchling in two weeks, and
// it eats nothing but milkweed the whole time.
//
// What makes it read as THIS caterpillar rather than as a grub, in order:
//   * the BANDING -- black, cream-white and yellow repeating on every segment, in that
//     order, bold and hard-edged. It is a warning, not camouflage: milkweed is poisonous
//     and the caterpillar keeps the poison.
//   * TWO PAIRS OF BLACK FILAMENTS, a long pair behind the head and a short pair at the
//     tail. They are not antennae and not stingers; they wave when it is disturbed.
//   * TRUE LEGS in front and PROLEGS behind, which are different things -- three pairs of
//     pointed jointed legs on the thorax, then a gap, then four pairs of fat fleshy stubs
//     and a pair of claspers. Give it ten identical legs and it is a centipede.
export function monarchCaterpillar({ length = 11, seed = 13, arch = 0.10, detail = 'hero' } = {}) {
  const L = length;
  const SEG = 13;
  const R = L * 0.082;
  const hero = detail !== 'far';
  const parts = [];
  const gold = [];

  // The body rides a gentle arch so it reads as lying ON something rather than floating.
  const lift = (t) => Math.sin(Math.PI * clamp01(t)) * L * arch;
  const bodyStations = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const taper = 0.52 + 0.48 * Math.sin(Math.PI * Math.pow(clamp01(t * 1.02), 0.72));
    bodyStations.push({
      d: (t - 0.5) * L * 0.92,
      w: R * taper,
      up: R * taper * 1.02,
      dn: R * taper * 0.86,
      round: 0.92,
      y: lift(t),
    });
  }
  const samples = hero ? 120 : 46;
  const body = solidLoft(bodyStations.map((st) => ({ ...st })), {
    sides: hero ? 26 : 14,
    samples,
    axis: 'z',
    // Segment creases: 13 of them over 120 samples is 9.2 samples a segment, which is
    // this project's floor. At the 90 the first pass used they aliased into a ripple.
    warp: (t) => R * 0.055 * (Math.cos(t * Math.PI * 2 * SEG) * 0.5 - 0.5),
  });
  // solidLoft takes its centre-line from the stations' own d/w/up/dn, so the arch is put
  // in afterwards -- a station carrying a y is not something the sampler reads.
  {
    const pos = body.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = clamp01((pos.getZ(i) / (L * 0.92)) + 0.5);
      pos.setY(i, pos.getY(i) + lift(t));
    }
    pos.needsUpdate = true;
    body.computeVertexNormals();
  }
  tintPN(body, (p, n) => {
    const t = clamp01(p.z / (L * 0.92) + 0.5);
    const k = ((t * SEG) % 1 + 1) % 1;
    // Black / cream / yellow, hard-edged, in that order down every segment.
    let c;
    if (k < 0.30) c = col(BF.catBlack);
    else if (k < 0.46) c = col(BF.catWhite);
    else if (k < 0.74) c = col(BF.catYellow);
    else c = col(BF.catWhite);
    // The bands are boldest on the back and wash out toward the pale belly, which is what
    // a real one does and is also the only thing keeping the underside off pure black.
    c.lerp(col(0xdcd2a8), clamp01(-n.y) * 0.45);
    c.multiplyScalar(0.94 + 0.10 * smoothNoise3(p.x * 6, p.y * 6, p.z * 6));
    return [c.r, c.g, c.b];
  });
  put(parts, body, 0xffffff, null, null, { keepColor: true });

  const headZ = L * 0.46 + lift(1) * 0;
  const headY = lift(1) + R * 0.12;
  const headR = R * 0.82;
  const head = ball(headR, hero ? 16 : 8);
  head.scale(1, 0.94, 1.06);
  put(parts, placed(head, { pos: [0, headY, headZ + headR * 0.55] }), BF.catBlack);
  // The head's pale inverted V, and the mouthparts under it.
  for (const sx of [-1, 1]) {
    put(parts, placed(ball(headR * 0.30, 7), {
      pos: [sx * headR * 0.42, headY + headR * 0.34, headZ + headR * 1.08], scale: [1, 1.5, 0.5],
      rot: [0, 0, sx * 0.5],
    }), BF.catYellow);
    // Stemmata -- the six simple eyes a caterpillar sees with, in an arc on each cheek.
    put(parts, placed(ball(headR * 0.11, 6), {
      pos: [sx * headR * 0.74, headY - headR * 0.22, headZ + headR * 0.92],
    }), 0x120f0c);
  }
  put(parts, placed(ball(headR * 0.44, 8), {
    pos: [0, headY - headR * 0.56, headZ + headR * 0.98], scale: [1.1, 0.7, 0.9],
  }), 0x2c2620);

  // The two pairs of filaments.
  const filament = (z, len, back, thick) => {
    for (const sx of [-1, 1]) {
      const t = clamp01(z / (L * 0.92) + 0.5);
      const y0 = lift(t) + R * 0.72;
      chain(parts, BF.catBlack, [
        { p: [sx * R * 0.34, y0, z], r: thick },
        { p: [sx * R * 0.72, y0 + len * 0.52, z + back * 0.35], r: thick * 0.72 },
        { p: [sx * R * 1.00, y0 + len * 0.88, z + back * 0.85], r: thick * 0.38 },
        { p: [sx * R * 1.10, y0 + len, z + back], r: 0 },
      ], { sides: hero ? 8 : 5, detail: hero ? 8 : 5, tubular: hero ? 7 : 4, capStart: false });
    }
  };
  filament(L * 0.30, R * 2.7, L * 0.12, R * 0.26);
  filament(-L * 0.30, R * 1.6, -L * 0.11, R * 0.21);

  // Legs: three pairs of pointed TRUE legs up front, then four pairs of fat prolegs and a
  // pair of claspers. Two different organs, and the difference is visible and teachable.
  for (let i = 0; i < 3; i++) {
    const z = L * (0.30 - i * 0.075);
    const t = clamp01(z / (L * 0.92) + 0.5);
    for (const sx of [-1, 1]) {
      chain(parts, BF.catLeg, [
        { p: [sx * R * 0.52, lift(t) - R * 0.52, z], r: R * 0.10 },
        { p: [sx * R * 0.78, lift(t) - R * 1.02, z + R * 0.10], r: R * 0.06 },
        { p: [sx * R * 0.88, lift(t) - R * 1.30, z + R * 0.22], r: 0 },
      ], { sides: 5, detail: 5, tubular: 4, capStart: false });
    }
  }
  for (let i = 0; i < 5; i++) {
    const z = i < 4 ? -L * (0.02 + i * 0.095) : -L * 0.44;
    const t = clamp01(z / (L * 0.92) + 0.5);
    for (const sx of [-1, 1]) {
      const pro = ball(R * 0.30, hero ? 9 : 6);
      pro.scale(1, 1.25, 0.9);
      put(parts, placed(pro, { pos: [sx * R * 0.62, lift(t) - R * 0.80, z] }),
        i < 4 ? BF.catBlack : BF.catBlack);
      // The crochets: the ring of tiny hooks a proleg actually grips with.
      put(parts, placed(ball(R * 0.20, 6), {
        pos: [sx * R * 0.66, lift(t) - R * 1.12, z], scale: [1, 0.45, 1],
      }), 0x3a322a);
    }
  }
  // Spiracles -- the row of breathing holes down each flank. Nine a side, and they are the
  // only thing on the animal that is neither black, cream nor yellow.
  if (hero) {
    for (let i = 0; i < 9; i++) {
      const t = 0.12 + i * 0.086;
      const z = (t - 0.5) * L * 0.92;
      const taper = 0.52 + 0.48 * Math.sin(Math.PI * Math.pow(clamp01(t * 1.02), 0.72));
      for (const sx of [-1, 1]) {
        put(gold, placed(ball(R * 0.07, 6), {
          pos: [sx * R * taper * 0.99, lift(t) - R * taper * 0.30, z], scale: [0.5, 1, 1.5],
        }), 0x6a3a1e);
      }
    }
  }

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.55, metalness: 0.02,
    ...relief('hide', { seed, repeat: 10, strength: 0.32 }),
  })));
  if (gold.length) g.add(mesh(mergeParts(gold), standard({ vertexColors: true, roughness: 0.6 })));
  return g;
}

// The profile of a monarch chrysalis, as a radius fraction at height fraction t measured
// from the HEAD END (t = 0, hanging downward) up to the cremaster (t = 1).
//
// ONE description, read by the whole chrysalis and again by the split empty case at the
// next station along -- so the case a student compares against the intact one is the same
// shape, which is the only reason the comparison says anything.
function chrysalisRadius(t) {
  return splineAt([0.42, 0.88, 1.00, 0.99, 0.94, 0.80, 0.42, 0.10], clamp01(t));
}

// A monarch chrysalis. Real: 25mm, and it hangs for 9 to 14 days while the caterpillar
// inside it dissolves almost completely and rebuilds as something else.
//
// THE GOLD IS THE WHOLE MODEL. That crown of metallic dots round its shoulder is the one
// thing everybody remembers, and it is real metal-looking structural colour, not paint. It
// needs its own material -- one merged vertex-coloured mesh cannot carry two metalnesses --
// and the metalness has to stay near 0.45, because at the 0.9 that "gold" suggests it
// renders BLACK: there is no environment map anywhere in this app, so a mirror has nothing
// to reflect (the chrome-bumper trap from 1940's New York).
export function chrysalis({
  height = 7.5, seed = 17, dots = 13, detail = 'hero', hanger = true, hang = 3.2,
} = {}) {
  const H = height;
  const R = H * 0.29;
  const hero = detail !== 'far';
  const parts = [];
  const goldParts = [];

  const stations = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const r = R * chrysalisRadius(t);
    stations.push({ d: t * H, w: r, up: r, dn: r, round: 1 });
  }
  const shell = solidLoft(stations, {
    sides: hero ? 60 : 22,
    samples: hero ? 54 : 22,
    axis: 'y',
    // The wing cases: eight soft ridges down the head half only, dying out before the
    // abdomen. They fade at both ends, or the cap fans into a rosette.
    warp: (t, u) => {
      const zone = (1 - smooth(0.34, 0.60, t)) * smooth(0.02, 0.16, t);
      return R * 0.030 * (Math.cos(u * Math.PI * 2 * 8) * 0.5 + 0.5) * zone;
    },
  });
  tintPN(shell, (p) => {
    const t = clamp01(p.y / H);
    const c = lerpCol(BF.chrysJade, BF.chrysDeep, smooth(0.10, 0.62, t) * 0.55);
    // Pale at the head end where the wing cases are, and the abdomen SEGMENTED above the
    // gold band -- a chrysalis is not one smooth bead.
    c.lerp(col(0x8ecf92), (1 - smooth(0.05, 0.34, t)) * 0.30);
    if (t > 0.56) {
      const seg = Math.abs(((t - 0.56) / 0.062 % 1 + 1) % 1 - 0.5) * 2;
      c.multiplyScalar(0.88 + 0.20 * seg);
    }
    // The dark band right under the cremaster.
    c.lerp(col(0x1e2a1c), smooth(0.86, 0.97, t) * 0.85);
    return [c.r, c.g, c.b];
  });
  put(parts, shell, 0xffffff, null, null, { keepColor: true });

  // The cremaster: the black stalk it hangs by, and the silk pad it is hooked into.
  put(parts, tube([
    [0, H * 0.95, 0], [0, H * 1.03, 0], [0, H * 1.10, 0],
  ], [R * 0.085, R * 0.055, R * 0.048], { sides: 8, tubular: 5 }), BF.chrysStalk);
  put(parts, placed(ball(R * 0.15, 9), { pos: [0, H * 1.12, 0], scale: [1.5, 0.55, 1.5] }), 0xd8d2c0);

  // The gold. A CROWN of dots round the shoulder, plus a scatter over the wing cases.
  const goldAt = (t, a, rad) => {
    const rr = R * chrysalisRadius(t);
    dome(goldParts, BF.chrysGold, {
      radius: rad, height: rad * 0.55,
      at: [Math.sin(a) * rr, t * H, Math.cos(a) * rr],
      rot: [Math.PI / 2, a, 0], detail: 8, sink: 0.30,
    });
  };
  for (let i = 0; i < dots; i++) {
    goldAt(0.575, (i / dots) * Math.PI * 2, R * (i % 2 ? 0.060 : 0.080));
  }
  for (let i = 0; i < 6; i++) {
    goldAt(0.16 + (i % 3) * 0.085, (i / 6) * Math.PI * 2 + 0.4, R * 0.050);
  }

  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.34, metalness: 0.06,
    ...relief('weave', { seed, repeat: 12, strength: 0.25 }),
  })));
  g.add(mesh(mergeParts(goldParts), standard({
    vertexColors: true, roughness: 0.22, metalness: 0.45,
    emissive: new THREE.Color(0x5a4208), emissiveIntensity: 0.5,
  })));
  if (hanger) {
    g.children.forEach((m) => { m.position.y += hang; });
    g.add(mesh(twigGeometry(H, R, hang), standard({
      vertexColors: true, roughness: 0.9, ...relief('bark', { seed: seed + 5, repeat: 5 }),
    })));
  }
  return g;
}

// The stem a chrysalis is hung from, so the prop stands on its own base like every other
// prop in this project. A chrysalis sitting on the ground is the one place one is never
// found -- it spends its whole fortnight hanging, and a student who sees it any other way
// has been told something false about it.
function twigGeometry(H, R, hang) {
  const parts = [];
  const top = H * 1.12 + hang;
  put(parts, tube([
    [0, 0, -R * 0.45], [0, top * 0.42, -R * 0.62], [0, top * 0.86, -R * 0.50], [0, top, -R * 0.12],
  ], [R * 0.16, R * 0.12, R * 0.10, R * 0.075], { sides: 9, tubular: 12 }), 0x5a4a34);
  put(parts, tube([
    [0, top, -R * 0.12], [R * 0.22, top + R * 0.04, R * 0.18], [R * 0.40, top - R * 0.05, R * 0.44],
  ], [R * 0.075, R * 0.055, 0], { sides: 7, tubular: 6 }), 0x5a4a34);
  // Two leaves, so the twig is a plant and not a post.
  for (const sx of [-1, 1]) {
    const leaf = solidSurface({
      nu: 5,
      nv: 8,
      point: (u, v) => {
        const s = (u - 0.5) * 2;
        const hw = R * 0.34 * Math.sin(Math.PI * Math.pow(clamp01(v), 0.55));
        return [sx * (R * 0.12 + v * R * 1.5) + s * hw * 0.2, top - R * 0.25 - v * v * R * 0.5, s * hw];
      },
      thick: (u, v) => R * 0.022 * Math.sin(Math.PI * clamp01(u)) * (1 - Math.pow(v, 3)),
    });
    put(parts, leaf, sx > 0 ? BF.leaf : BF.leafDeep);
  }
  return mergeParts(parts);
}

// The moment of emergence: the split, empty case with the adult hanging out of it, wings
// still crumpled and no bigger than its own body.
//
// A FRESHLY EMERGED BUTTERFLY'S WINGS ARE TINY, and that is the fact this station exists
// for. It hangs head-down for an hour pumping blood out of its swollen abdomen into the
// wing veins; if it cannot hang, the wings set crumpled and it never flies. Modelled with
// full-size wings the exhibit says nothing at all.
export function emergingAdult({
  species = 'monarch', caseHeight = 5.0, seed = 19, detail = 'hero', hang = 3.6,
} = {}) {
  const H = caseHeight;
  const R = H * 0.29;
  const hero = detail !== 'far';
  const g = group();

  // THE EMPTY CASE IS A SHELL, NOT A SOLID. A partial `revolve` looks like the right tool
  // and is not: it closes a part-sweep with radial caps to the axis, so what comes out is
  // a solid wedge of chrysalis rather than a hollow one, and the split reads as a slice cut
  // out of a bar of soap. solidSurface gives it two faces and a rim all the way round.
  const openFrom = -0.98, openTo = 0.98; // the split gapes toward +Z, the walk-up
  const caseShell = solidSurface({
    nu: hero ? 34 : 14,
    nv: hero ? 30 : 12,
    point: (u, v) => {
      const a = openTo + u * (Math.PI * 2 - (openTo - openFrom));
      // The split gapes: the two halves spring apart at the head end, which is how a real
      // case looks once the butterfly has pushed out of it.
      // The two halves spring APART at the head end and stay closed at the cremaster,
      // which is what a burst case does: it splits from the bottom and peels back.
      const gape = 1 + (1 - smooth(0.0, 0.62, v)) * 0.40 * Math.cos((u - 0.5) * Math.PI);
      const rr = R * chrysalisRadius(v) * gape;
      return [Math.sin(a) * rr, v * H, Math.cos(a) * rr];
    },
    thick: () => R * 0.035,
  });
  tintPN(caseShell, (p) => {
    const t = clamp01(p.y / H);
    // An emptied case has lost its colour: it goes clear and papery, with the old wing-case
    // pattern showing as a ghost.
    const c = lerpCol(0xcfd8c2, 0x9aa88e, smooth(0.10, 0.70, t) * 0.6);
    c.lerp(col(0x1e2a1c), smooth(0.86, 0.99, t) * 0.7);
    return [c.r, c.g, c.b];
  });
  const caseMesh = mesh(caseShell, standard({
    vertexColors: true, roughness: 0.22, metalness: 0.03, side: THREE.DoubleSide,
    transparent: true, opacity: 0.66,
  }));
  caseMesh.castShadow = false;
  g.add(caseMesh);
  const stalk = [];
  put(stalk, tube([[0, H * 0.95, 0], [0, H * 1.06, 0]], [R * 0.08, R * 0.05], { sides: 7, tubular: 4 }), BF.chrysStalk);
  put(stalk, placed(ball(R * 0.15, 8), { pos: [0, H * 1.10, 0], scale: [1.5, 0.5, 1.5] }), 0xd8d2c0);
  g.add(mesh(mergeParts(stalk), standard({ vertexColors: true, roughness: 0.7 })));
  g.children.forEach((m) => { m.position.y += hang; });
  g.add(mesh(twigGeometry(H, R, hang), standard({
    vertexColors: true, roughness: 0.9, ...relief('bark', { seed: seed + 5, repeat: 5 }),
  })));

  // The adult, clinging to the split case with its head UP and its abdomen hanging -- which
  // is the position it has to hold for an hour, and the reason the station exists.
  const adult = butterfly({
    species,
    size: gardenSize(SPECIES[species].wingspanMm) * 0.92,
    seed: seed + 3,
    detail: hero ? 'hero' : 'field',
    pose: 'emerge',
  });
  // Hanging BELOW the opening and out in front of it, which is where the animal actually
  // is and is also the only place it is not hidden behind its own case.
  adult.position.set(0, hang + H * 0.10, R * 1.05);
  adult.rotation.set(Math.PI * 0.42, 0, 0);
  g.add(adult);
  return g;
}

// The display stand every life-cycle station shares.
//
// ONE ACCENT COLOUR PER STATION, carried by the ring and the number plate, is the cheapest
// legibility in the world: from the far end of the walk the only thing a student can
// resolve is a coloured ring, and that says which stage they are looking at before a single
// word is readable (Fantastic Voyage's system colours, doing the same job for four stages
// instead of seven body systems).
export function lifecyclePlinth({
  radius = 4.2, height = 2.4, accent = '#d8348a', number = 1, title = 'EGG',
  subtitle = '', magnify = '',
} = {}) {
  const g = group();
  const stone = standard({
    color: BF.plinth, roughness: 0.82, ...relief('stone', { seed: 23, repeat: 4 }),
  });
  const drum = lathed(closed([
    [radius * 1.06, 0], [radius * 1.06, height * 0.07], [radius * 0.94, height * 0.13],
    [radius * 0.94, height * 0.80], [radius, height * 0.88], [radius, height * 0.95],
    [radius * 0.97, height],
  ]), { segments: 40 });
  g.add(mesh(drum, stone));
  // The accent ring.
  const ring = new THREE.TorusGeometry(radius * 0.99, height * 0.045, 8, 44);
  ring.rotateX(Math.PI / 2);
  const ringMesh = mesh(ring, standard({
    color: new THREE.Color(accent), roughness: 0.4, metalness: 0.15,
    emissive: new THREE.Color(accent), emissiveIntensity: 0.14,
  }));
  ringMesh.position.y = height * 0.905;
  g.add(ringMesh);

  // The number plate, raked toward a standing student.
  const plate = canvasPlate(number, title, subtitle, magnify, accent);
  const panelW = radius * 1.30;
  const panel = mesh(new THREE.PlaneGeometry(panelW, panelW * 0.5), standard({
    map: plate, roughness: 0.8, side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffffff), emissiveMap: plate, emissiveIntensity: 0.16,
  }));
  panel.position.set(0, height * 0.62, radius * 1.02);
  panel.rotation.x = -0.34;
  g.add(panel);
  return g;
}

function canvasPlate(number, title, subtitle, magnify, accent) {
  const W = 512, H = 256;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1d2420';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 12);
  // The stage number, big, in the station's own colour.
  ctx.fillStyle = accent;
  ctx.font = 'bold 132px Georgia, serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(String(number), 34, 168);
  const numW = ctx.measureText(String(number)).width;
  const x = 34 + numW + 34;
  // FIT THE TITLE, never draw it at a guessed size. This is the fifth time this project
  // has recorded the same bug -- cardTexture's body, standingSign's title, welcomeBoard's
  // lead, the chalk blackboard's headline -- and it is always the same fix: measure it.
  let size = 62;
  ctx.fillStyle = '#f4efe2';
  do {
    ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
    size -= 3;
  } while (ctx.measureText(title).width > W - x - 28 && size > 22);
  ctx.fillText(title, x, 112);
  ctx.fillStyle = '#b9c4b6';
  size = 30;
  do {
    ctx.font = `${size}px Georgia, serif`;
    size -= 2;
  } while (ctx.measureText(subtitle).width > W - x - 28 && size > 13);
  ctx.fillText(subtitle, x, 156);
  ctx.fillStyle = accent;
  size = 28;
  do {
    ctx.font = `bold ${size}px "Helvetica Neue", Arial, sans-serif`;
    size -= 2;
  } while (ctx.measureText(magnify).width > W - x - 28 && size > 12);
  ctx.fillText(magnify, x, 204);
  return freshTexture(canvas);
}

// ---------------------------------------------------------------------------
// 7. THE PLANTING
// ---------------------------------------------------------------------------

// ONE NEAR-WHITE ATLAS FOR EVERY PETAL, LEAF, DISC AND STEM IN THE GARDEN.
//
// A material carrying both a `map` and `vertexColors` MULTIPLIES them -- normally the bug
// that turned the bear dens black, and used deliberately here exactly as the Park's flower
// beds and the volcano's rock specimens use it: the map has no colour of its own, so it
// carries vein, floret and fibre at a scale vertices cannot reach, while the vertex tint
// goes on carrying the hue. That is what lets ONE canvas serve a magenta coneflower, a gold
// susan and a scarlet zinnia, and it is the difference between 740 individually veined
// blooms and 740 flat coloured stars.
//
// Four bands in u plus a blank, so a whole plant -- stem, leaves, petals and disc -- is one
// material and therefore ONE MESH.
const FLORA = {
  petal: [0.004, 0.246], leaf: [0.254, 0.496], disc: [0.504, 0.746],
  stem: [0.754, 0.926], blank: [0.97, 0.5],
};
let floraCanvas = null;

export function floralAtlas() {
  if (floraCanvas) return floraCanvas;
  const W = 192, H = 192;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H);
  const d = image.data;
  const set = (x, y, v) => {
    const i = (y * W + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = 255;
  };
  const bandPx = (b) => [Math.round(b[0] * W), Math.round(b[1] * W)];

  // PETAL: veins radiating from the base, and a NECTAR GUIDE -- the darker landing strip
  // at the throat that points an insect at the nectar. It is a real feature, it is most of
  // why a flower looks like a flower close up, and on this atlas it costs nothing.
  {
    const [x0, x1] = bandPx(FLORA.petal);
    for (let y = 0; y < H; y++) {
      const v = 1 - y / (H - 1);                 // v = 0 at the petal base
      for (let x = x0; x < x1; x++) {
        const u = (x - x0) / (x1 - x0 - 1);
        let k = 251;
        // seven veins converging on the base
        const spread = 0.22 + 0.78 * Math.pow(clamp01(v), 0.45);
        let vein = 9;
        for (let i = 0; i < 7; i++) {
          const uv = 0.5 + ((i / 6) - 0.5) * spread;
          vein = Math.min(vein, Math.abs(u - uv));
        }
        k -= (1 - smooth(0.012, 0.045, vein)) * 34;
        k -= (1 - smooth(0.0, 0.19, v)) * 72;      // the guide, darkest at the throat
        k -= (1 - smooth(0.0, 0.05, Math.min(u, 1 - u))) * 16; // a touch of edge shading
        k += Math.sin(v * 210) * 3;                 // the fine ribbing along a petal
        set(x, y, [k, k * 0.995, k * 0.985]);
      }
    }
  }
  // LEAF: a midrib with pinnate side veins running out and forward from it.
  {
    const [x0, x1] = bandPx(FLORA.leaf);
    for (let y = 0; y < H; y++) {
      const v = 1 - y / (H - 1);
      for (let x = x0; x < x1; x++) {
        const u = (x - x0) / (x1 - x0 - 1);
        const s = (u - 0.5) * 2;
        let k = 249;
        k -= (1 - smooth(0.010, 0.036, Math.abs(s))) * 32;        // midrib
        const rib = Math.abs(((v * 9 - Math.abs(s) * 2.6) % 1 + 1) % 1 - 0.5) * 2;
        k -= (1 - smooth(0.62, 0.95, rib)) * 20 * smooth(0.04, 0.2, Math.abs(s));
        k -= (1 - smooth(0.0, 0.06, 1 - Math.abs(s))) * 12;
        set(x, y, [k * 0.99, k, k * 0.96]);
      }
    }
  }
  // DISC: the packed floret head at a daisy's centre, on the golden angle, so a coneflower's
  // cone is a real spiral rather than a stippled dome.
  {
    const [x0, x1] = bandPx(FLORA.disc);
    const w = x1 - x0;
    const sites = [];
    for (let i = 0; i < 200; i++) {
      const a = i * GOLDEN_ANGLE;
      const rr = 0.5 * Math.sqrt((i + 0.5) / 200);
      sites.push([0.5 + Math.cos(a) * rr, 0.5 + Math.sin(a) * rr]);
    }
    for (let y = 0; y < H; y++) {
      const v = 1 - y / (H - 1);
      for (let x = x0; x < x1; x++) {
        const u = (x - x0) / (w - 1);
        let best = 9;
        for (let i = 0; i < sites.length; i++) {
          const dd = Math.hypot(u - sites[i][0], v - sites[i][1]);
          if (dd < best) best = dd;
        }
        // Bright on each floret's crown, shaded in the seams between them.
        const k = 199 + (1 - smooth(0.004, 0.030, best)) * 54;
        set(x, y, [k, k * 0.96, k * 0.86]);
      }
    }
  }
  // STEM: vertical fibre.
  {
    const [x0, x1] = bandPx(FLORA.stem);
    for (let y = 0; y < H; y++) {
      const v = 1 - y / (H - 1);
      for (let x = x0; x < x1; x++) {
        const u = (x - x0) / (x1 - x0 - 1);
        const k = 244 + Math.sin(u * Math.PI * 2 * 9) * 7 + Math.sin(v * 160 + u * 20) * 4;
        set(x, y, [k * 0.99, k, k * 0.97]);
      }
    }
  }
  // BLANK: white, so anything pinned here carries its own vertex colour untouched.
  {
    const x0 = Math.round(0.95 * W);
    for (let y = 0; y < H; y++) for (let x = x0; x < W; x++) set(x, y, [255, 255, 255]);
  }
  ctx.putImageData(image, 0, 0);
  floraCanvas = canvas;
  return canvas;
}

function floraMaterial(seed, extra = {}) {
  return standard({
    vertexColors: true,
    map: freshTexture(floralAtlas()),
    roughness: 0.74,
    ...relief('weave', { seed, repeat: 7, strength: 0.22 }),
    ...extra,
  });
}

// The eight kinds this garden is planted with. Every one is a real butterfly-garden plant
// and two of them are here for reasons beyond colour: BUDDLEIA is called the butterfly bush
// because it is the best nectar plant there is, and MILKWEED is the only thing a monarch
// caterpillar will eat, so the whole life-cycle walk hangs off it.
export const FLOWERS = {
  coneflower: {
    name: 'Purple coneflower', latin: 'Echinacea purpurea', form: 'ray',
    petal: BF.magenta, petalTip: BF.rose, disc: BF.tangerine, discDeep: 0x9c4a18,
    rays: 18, droop: 0.62, rayLen: 1.05, rayWide: 0.26, cone: 1.35, headR: 1.9,
    leaf: 'lance', leaves: 6, stem: BF.stem, height: 34, heads: 5,
  },
  susan: {
    name: 'Black-eyed Susan', latin: 'Rudbeckia hirta', form: 'ray',
    petal: BF.gold, petalTip: 0xffd85c, disc: BF.discBrown, discDeep: 0x2a1c0c,
    rays: 16, droop: 0.20, rayLen: 1.05, rayWide: 0.30, cone: 0.45, headR: 1.85,
    leaf: 'lance', leaves: 6, stem: BF.stem, height: 30, heads: 6,
  },
  aster: {
    name: 'New England aster', latin: 'Symphyotrichum novae-angliae', form: 'ray',
    petal: BF.violet, petalTip: BF.lilac, disc: BF.discGold, discDeep: 0xa87a12,
    rays: 21, droop: 0.06, rayLen: 1.05, rayWide: 0.13, cone: 0.28, headR: 1.4,
    leaf: 'lance', leaves: 6, stem: BF.stem, height: 26, heads: 6,
  },
  cosmos: {
    name: 'Cosmos', latin: 'Cosmos bipinnatus', form: 'ray',
    petal: BF.hotPink, petalTip: 0xf7b2d0, disc: BF.discGold, discDeep: 0xb8860c,
    rays: 8, droop: 0.10, rayLen: 1.05, rayWide: 0.50, cone: 0.22, headR: 2.1,
    leaf: 'thread', leaves: 6, stem: BF.stemPale, height: 32, heads: 5, notch: 0.22,
  },
  zinnia: {
    name: 'Zinnia', latin: 'Zinnia elegans', form: 'pompon',
    petal: BF.scarlet, petalTip: BF.coral, disc: BF.discGold, discDeep: 0xa8781a,
    rows: 4, rays: 11, rayWide: 0.44, headR: 2.3,
    leaf: 'oval', leaves: 6, stem: BF.stem, height: 28, heads: 3,
  },
  marigold: {
    name: 'Marigold', latin: 'Tagetes erecta', form: 'pompon',
    petal: BF.tangerine, petalTip: BF.gold, disc: BF.tangerine, discDeep: 0xc4560c,
    rows: 4, rays: 11, rayWide: 0.56, headR: 1.9,
    leaf: 'thread', leaves: 6, stem: BF.stem, height: 22, heads: 4,
  },
  lantana: {
    name: 'Lantana', latin: 'Lantana camara', form: 'cluster',
    petal: BF.tangerine, petalTip: BF.gold, inner: BF.scarlet, headR: 1.15,
    florets: 26, leaf: 'oval', leaves: 7, stem: BF.stem, height: 20, heads: 6,
  },
  milkweed: {
    name: 'Common milkweed', latin: 'Asclepias syriaca', form: 'umbel',
    petal: BF.rose, petalTip: 0xf0c2ce, inner: 0xd8a0ae, headR: 1.9,
    florets: 22, leaf: 'broad', leaves: 8, stem: 0x6f8a4a, height: 42, heads: 4,
  },
  buddleia: {
    name: 'Butterfly bush', latin: 'Buddleja davidii', form: 'spike',
    petal: BF.purple, petalTip: BF.lilac, eye: BF.gold,
    spikeLen: 9, spikeR: 1.5, florets: 60,
    leaf: 'long', leaves: 10, stem: 0x6b7a52, height: 46, heads: 5,
  },
};

// THREE TIERS, AND THE THIRD NUMBER IS THE ONE THAT MATTERS. Tessellation is the obvious
// lever and it is the weak one: a bed of eleven plants measured 128k triangles and dropping
// every petal's mesh in half only took it to 90k, because the cost is in HOW MANY petals
// there are, not how smooth each one is. `density` scales the counts -- rays, rows,
// florets, leaves -- and it is what makes a background border cost a fifth of a specimen
// rather than four fifths of one. This is the araucaria trap, met for the fifth time in
// this project and answered the way it always has to be answered.
//
// `ball` floors its width segments at 6 whatever it is asked for, and that is the right
// floor: at 4 a sphere is SQUARE in cross-section, and a bed with two hundred florets in it
// reads as a heap of pale cubes (Under the Sea's anemone tips).
const PLANT_DETAIL = {
  hero: { pnu: 4, pnv: 5, lnu: 3, lnv: 5, sides: 7, lathe: 16, floret: 7, density: 0.86 },
  field: { pnu: 3, pnv: 4, lnu: 3, lnv: 4, sides: 6, lathe: 10, floret: 6, density: 0.42 },
  far: { pnu: 2, pnv: 3, lnu: 2, lnv: 3, sides: 5, lathe: 8, floret: 6, density: 0.17 },
};

// A five-lobed floret as ONE flat star plate instead of five balls and a crown.
//
// The arithmetic that forces this: a milkweed umbel is 22 florets and a plant carries four
// of them, so at twelve parts a floret that is a thousand solids on ONE plant -- measured,
// 51k triangles, more than five butterflies. A star plate is about forty, it reads
// correctly as a small five-pointed flower at the ten feet these are actually seen from,
// and the character that matters (reflexed petals, raised crown) survives as a tilt and a
// single bead.
function starFloret(r, lobes = 5, inner = 0.42) {
  const pts = [];
  for (let i = 0; i < lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2;
    const rr = r * (i % 2 ? inner : 1);
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
  }
  const g = extrudeOutline(pts, r * 0.16, { uvFeet: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

// One ray floret -- a daisy's "petal". A closed lens-section blade, never a flat
// DoubleSide card: a card is invisible edge-on, and a flower head is a ring of them seen
// from every angle at once, so a third of any bloom would be missing at any moment.
//
// `tipFull` is what separates a coneflower's tapering strap from a cosmos's broad squared
// one, and it is most of what tells the kinds apart at a distance.
function rayPetal(D, { len, wide, droop, tipFull = 0.2, curl = 0.26 }) {
  return solidSurface({
    nu: D.pnu,
    nv: D.pnv,
    point: (u, v) => {
      const s = (u - 0.5) * 2;
      const taper = Math.sin(Math.PI * Math.pow(clamp01(v), 0.55));
      const broad = smooth(0, 0.20, v) * (1 - smooth(0.88, 1.0, v));
      const hw = wide * (taper * (1 - tipFull) + broad * tipFull);
      // A petal is a CHANNEL, not a plank: it cups along its length, which is what catches
      // the light down its middle and throws its edges into shade.
      return [s * hw, -droop * len * v * v + Math.abs(s) * hw * curl, v * len];
    },
    thick: (u, v) => len * 0.011 * Math.pow(Math.sin(Math.PI * clamp01(u)), 0.5) * (1 - Math.pow(v, 3)),
  });
}

// A leaf. Five outlines, and they are per-species rather than decorative: milkweed's broad
// blunt oblong is the thing a student is told to look for when hunting for eggs.
function leafBlade(D, kind, len) {
  const W = { lance: 0.15, oval: 0.34, broad: 0.40, long: 0.11, thread: 0.05 }[kind] ?? 0.2;
  const P = { lance: 0.52, oval: 0.62, broad: 0.72, long: 0.46, thread: 0.5 }[kind] ?? 0.55;
  return solidSurface({
    nu: D.lnu,
    nv: D.lnv,
    point: (u, v) => {
      const s = (u - 0.5) * 2;
      const hw = len * W * Math.sin(Math.PI * Math.pow(clamp01(v * 1.02), P));
      // Leaves fold along the midrib and arch downward toward the tip.
      return [s * hw, -v * v * len * 0.30 + Math.abs(s) * hw * 0.30, v * len];
    },
    thick: (u, v) => len * 0.008 * Math.pow(Math.sin(Math.PI * clamp01(u)), 0.5) * (1 - Math.pow(v, 4)),
  });
}

// Maps a disc's own (x, z) into the atlas's floret band, top-down, so the golden-angle
// packing painted there lands square on the face of the head rather than smeared round it
// by a lathe's own angular UVs.
function discUV(geometry, R) {
  const pos = geometry.attributes.position;
  let uv = geometry.attributes.uv;
  if (!uv) {
    uv = new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2);
    geometry.setAttribute('uv', uv);
  }
  const [u0, u1] = FLORA.disc;
  for (let i = 0; i < pos.count; i++) {
    const u = clamp01(0.5 + pos.getX(i) / (2 * R));
    const v = clamp01(0.5 + pos.getZ(i) / (2 * R));
    uv.setXY(i, u0 + u * (u1 - u0), v);
  }
  uv.needsUpdate = true;
  return geometry;
}

// A daisy head: the disc, then a ring of rays round it. Returns parts in the head's own
// frame, with +Y up out of the face.
function rayHead(parts, D, cfg, R, rng, open = 1) {
  const coneH = R * cfg.cone;
  const disc = lathed(closed([
    [R * 0.08, coneH],
    [R * 0.46, coneH * 0.94],
    [R * 0.72, coneH * 0.62],
    [R * 0.80, coneH * 0.22],
    [R * 0.76, 0],
  ]), { segments: D.lathe });
  discUV(disc, R * 0.8);
  tintPN(disc, (p) => {
    const c = lerpCol(cfg.discDeep, cfg.disc, clamp01(p.y / Math.max(1e-4, coneH)) * 0.9 + 0.1);
    return [c.r, c.g, c.b];
  });
  put(parts, disc, 0xffffff, null, null, { keepColor: true });

  const n = Math.max(3, Math.round(cfg.rays * (0.55 + 0.45 * open) * D.density));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.08;
    const len = R * cfg.rayLen * (0.88 + rng() * 0.24) * (0.35 + 0.65 * open);
    const petal = rayPetal(D, {
      len,
      wide: R * cfg.rayWide,
      droop: cfg.droop * (0.8 + rng() * 0.4),
      tipFull: cfg.notch ? 0.62 : 0.20,
    });
    bandUV(petal, FLORA.petal);
    tintPN(petal, (p) => {
      const t = clamp01(p.z / len);
      const c = lerpCol(cfg.petal, cfg.petalTip, Math.pow(t, 0.8) * 0.85);
      // Petals are DARKEST at the throat, which is where the nectar guide is and where a
      // butterfly actually lands.
      c.multiplyScalar(0.70 + 0.30 * smooth(0.0, 0.30, t));
      return [c.r, c.g, c.b];
    });
    // Rays sit on the rim of the disc and tilt out of it -- rooted at the centre they
    // sprout from the cone's own face, which is not where a floret comes from.
    put(parts, aimed(petal, {
      yaw: a, pitch: -0.42 + cfg.droop * 0.30, at: [Math.sin(a) * R * 0.64, coneH * 0.28, Math.cos(a) * R * 0.64],
    }), 0xffffff, null, null, { keepColor: true });
  }
}

// A pompon head -- zinnia, marigold: rows of petals, each row smaller, shorter and more
// upright than the one outside it, with only a glimpse of disc left at the middle.
function pomponHead(parts, D, cfg, R, rng, open = 1) {
  const rows = Math.max(2, Math.round(cfg.rows * (0.5 + 0.5 * D.density)));
  for (let row = 0; row < rows; row++) {
    const t = row / Math.max(1, rows - 1);
    const rr = R * (1 - t * 0.66);
    const n = Math.max(5, Math.round(cfg.rays * (1 - t * 0.35)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + row * 0.7 + rng() * 0.12;
      const len = rr * (0.86 + rng() * 0.26) * (0.4 + 0.6 * open);
      const petal = rayPetal(D, {
        len, wide: rr * cfg.rayWide, droop: 0.16 + t * 0.10, tipFull: 0.55, curl: 0.36,
      });
      bandUV(petal, FLORA.petal);
      tintPN(petal, (p) => {
        const q = clamp01(p.z / len);
        const c = lerpCol(cfg.petal, cfg.petalTip, Math.pow(q, 0.9) * (0.35 + t * 0.5));
        c.multiplyScalar(0.66 + 0.34 * smooth(0.0, 0.34, q) + t * 0.10);
        return [c.r, c.g, c.b];
      });
      put(parts, aimed(petal, {
        yaw: a, pitch: -1.02 + t * 0.78,
        at: [Math.sin(a) * rr * 0.30, R * 0.16 + t * R * 0.30, Math.cos(a) * rr * 0.30],
      }), 0xffffff, null, null, { keepColor: true });
    }
  }
  const eye = ball(R * 0.20, D.floret);
  eye.scale(1, 0.6, 1);
  discUV(eye, R * 0.2);
  put(parts, placed(eye, { pos: [0, R * 0.50, 0] }), cfg.disc);
}

// A flat-topped cluster -- lantana. Two dozen tiny five-lobed tubes packed into a dome,
// and the reason it is on every butterfly-garden list is that the whole head is one
// landing pad with two dozen drinks on it.
function clusterHead(parts, D, cfg, R, rng, open = 1) {
  const n = Math.max(6, Math.round(cfg.florets * (0.5 + 0.5 * open) * D.density));
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = R * 0.92 * Math.sqrt((i + 0.4) / n);
    const y = R * 0.30 * (1 - Math.pow(rr / R, 1.6));
    // LANTANA CHANGES COLOUR AS IT AGES, outside in -- the ring at the edge opened first
    // and has already turned. It is the most recognisable thing about the plant.
    const age = clamp01(rr / (R * 0.92));
    const tone = lerpCol(cfg.inner, lerpCol(cfg.petal, cfg.petalTip, age), Math.pow(age, 0.7));
    const fr = R * 0.20;
    put(parts, placed(starFloret(fr, 5, 0.48), {
      pos: [Math.sin(a) * rr, y, Math.cos(a) * rr], rot: [0, a * 1.7, 0],
    }), tone.getHex());
    put(parts, placed(ball(fr * 0.26, D.floret), {
      pos: [Math.sin(a) * rr, y + fr * 0.14, Math.cos(a) * rr], scale: [1, 0.6, 1],
    }), 0xf6e07a);
  }
}

// A milkweed umbel: a drooping ball of star-shaped florets on their own stalks, all
// springing from one point. The host plant, and the only thing a monarch caterpillar eats.
function umbelHead(parts, D, cfg, R, rng, open = 1) {
  const n = Math.max(6, Math.round(cfg.florets * (0.5 + 0.5 * open) * D.density));
  for (let i = 0; i < n; i++) {
    const a = i * GOLDEN_ANGLE;
    const t = (i + 0.5) / n;
    const dip = Math.sqrt(t);
    const px = Math.sin(a) * R * dip;
    const pz = Math.cos(a) * R * dip;
    const py = -R * 0.78 * dip * dip;
    put(parts, tube([[0, 0, 0], [px * 0.5, py * 0.42, pz * 0.5], [px, py, pz]],
      [R * 0.035, R * 0.028, R * 0.024], { sides: 4, tubular: 4 }), cfg.stem);
    // A milkweed floret is five petals REFLEXED downward under a raised crown of five
    // hoods -- nothing like a daisy, and the tilt is what says so.
    const fr = R * 0.26;
    put(parts, placed(starFloret(fr, 5, 0.40), {
      pos: [px, py - fr * 0.20, pz], rot: [0.55, a, 0],
    }), cfg.petal);
    const crown = ball(fr * 0.34, D.floret);
    crown.scale(1, 0.8, 1);
    put(parts, placed(crown, { pos: [px, py + fr * 0.16, pz] }), cfg.petalTip);
  }
}

// A buddleia panicle: a long tapering cone of hundreds of tiny florets, each with an
// orange eye. The cone is a loft and the florets are beads on its own surface, which is
// what keeps a nine-foot spike affordable at five spikes a bush.
function spikeHead(parts, D, cfg, R, len, rng, open = 1) {
  const radiusAt = (t) => R * Math.sin(Math.PI * Math.pow(clamp01(t * 0.92 + 0.04), 0.62)) * (1 - t * 0.28);
  const core = solidLoft(
    Array.from({ length: 7 }, (_, i) => {
      const t = i / 6;
      const r = radiusAt(t) * 0.72;
      return { d: t * len, w: r, up: r, dn: r, round: 1 };
    }), { sides: Math.max(8, D.sides + 3), samples: 14, axis: 'y' },
  );
  bandUV(core, FLORA.disc);
  put(parts, core, cfg.petal);

  const n = Math.max(8, Math.round(cfg.florets * (0.45 + 0.55 * open) * D.density));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const a = i * GOLDEN_ANGLE * 3.1;
    const rr = radiusAt(t);
    const fr = R * 0.20;
    const px = Math.sin(a) * rr;
    const pz = Math.cos(a) * rr;
    const py = t * len;
    const floret = ball(fr, Math.min(6, D.floret));
    floret.scale(1, 0.55, 1);
    // A panicle opens from the BOTTOM UP, so the tip is still in bud while the base is in
    // full flower -- which is why a buddleia spike is two colours at once.
    const openness = smooth(0.92, 0.35, t);
    const c = lerpCol(cfg.petal, cfg.petalTip, openness * 0.7);
    put(parts, placed(floret, {
      pos: [px, py, pz],
      rot: [Math.PI / 2 - 0.5, a, 0],
    }), c.getHex());
    // The orange eye each floret carries, and only on the ones that have actually opened.
    if (openness > 0.55) {
      put(parts, placed(ball(fr * 0.30, 5), {
        pos: [px * 1.16, py + fr * 0.10, pz * 1.16],
      }), cfg.eye);
    }
  }
}

// Everything of one plant, as PARTS rather than as a prop, so a specimen by the path and a
// bed of nine in the background come out of the same code and cannot drift apart.
function flowerParts(parts, D, cfg, {
  height, seed, bloom, lean, leanZ, heads, at = [0, 0, 0], scale = 1,
}) {
  const rng = seededRandom(seed);
  const H = height * scale;
  const n = Math.max(1, Math.round((heads ?? cfg.heads ?? 1) * (D.density * 0.6 + 0.4)));
  const stemR = H * 0.011;

  for (let h = 0; h < n; h++) {
    const a = n === 1 ? 0 : (h / n) * Math.PI * 2 + rng();
    const out = n === 1 ? 0 : H * (0.05 + rng() * 0.10);
    const hh = H * (n === 1 ? 1 : 0.72 + rng() * 0.28);
    const tipX = at[0] + Math.sin(a) * out + lean * hh * 0.30;
    const tipZ = at[2] + Math.cos(a) * out + leanZ * hh * 0.30;
    const tip = [tipX, at[1] + hh, tipZ];
    // Rooted a little UNDER the ground, so a plant on a slope never shows daylight at its
    // own foot -- the grass-blade rule from A Bug's Life.
    const stem = tube([
      [at[0], at[1] - H * 0.03, at[2]],
      [at[0] + (tipX - at[0]) * 0.28, at[1] + hh * 0.42, at[2] + (tipZ - at[2]) * 0.28],
      [at[0] + (tipX - at[0]) * 0.74, at[1] + hh * 0.80, at[2] + (tipZ - at[2]) * 0.74],
      tip,
    ], [stemR * 1.35, stemR * 1.1, stemR * 0.9, stemR * 0.8], { sides: D.sides, tubular: 10 });
    bandUV(stem, FLORA.stem, { vScale: 6 });
    put(parts, stem, cfg.stem ?? BF.stem);

    // Leaves, in OPPOSITE PAIRS up the stem for milkweed and buddleia and alternating for
    // the rest, because that is a real difference between them and it is visible.
    const opposite = cfg.leaf === 'broad' || cfg.leaf === 'long';
    const leafN = Math.max(2, Math.round(((cfg.leaves ?? 5) / (n > 2 ? 2.4 : 1)) * D.density));
    for (let i = 0; i < leafN; i++) {
      const t = 0.07 + (i / Math.max(1, leafN)) * 0.70;
      const lx = at[0] + (tipX - at[0]) * t * t;
      const lz = at[2] + (tipZ - at[2]) * t * t;
      const ly = at[1] + hh * t;
      const len = H * (cfg.leaf === 'broad' ? 0.20 : cfg.leaf === 'long' ? 0.22 : 0.15)
        * (1 - t * 0.35) * (0.85 + rng() * 0.3);
      const yaw = opposite ? i * Math.PI + a : i * 2.39996 + a;
      const sides = opposite ? [0, Math.PI] : [0];
      for (const extra of sides) {
        if (cfg.leaf === 'thread') {
          // A finely divided leaf is a spray of threads, and drawn as one blade it turns a
          // cosmos into a daisy.
          for (let k = 0; k < 5; k++) {
            const th = tube([
              [lx, ly, lz],
              [lx + Math.sin(yaw + extra) * len * 0.5, ly + len * 0.12 - k * len * 0.03,
                lz + Math.cos(yaw + extra) * len * 0.5],
              [lx + Math.sin(yaw + extra + (k - 2) * 0.26) * len, ly - len * 0.16 - k * len * 0.05,
                lz + Math.cos(yaw + extra + (k - 2) * 0.26) * len],
            ], [len * 0.018, len * 0.012, 0], { sides: 4, tubular: 4 });
            bandUV(th, FLORA.stem);
            put(parts, th, BF.leafDeep);
          }
          continue;
        }
        const blade = leafBlade(D, cfg.leaf ?? 'lance', len);
        bandUV(blade, FLORA.leaf);
        tintPN(blade, (p, nr) => {
          const c = lerpCol(BF.leaf, BF.leafDeep, clamp01(0.45 - nr.y * 0.45));
          c.lerp(col(BF.leafPale), clamp01(nr.y) * 0.22);
          return [c.r, c.g, c.b];
        });
        put(parts, aimed(blade, {
          yaw: yaw + extra, pitch: -0.55 - rng() * 0.25, at: [lx, ly, lz],
        }), 0xffffff, null, null, { keepColor: true });
      }
    }

    // The head.
    const open = clamp01(bloom * (0.55 + rng() * 0.6));
    const headParts = [];
    const R = H * 0.048 * (cfg.headR ?? 1.4);
    if (cfg.form === 'ray') rayHead(headParts, D, cfg, R, rng, open);
    else if (cfg.form === 'pompon') pomponHead(headParts, D, cfg, R, rng, open);
    else if (cfg.form === 'cluster') clusterHead(headParts, D, cfg, R, rng, open);
    else if (cfg.form === 'umbel') umbelHead(headParts, D, cfg, R, rng, open);
    else if (cfg.form === 'spike') spikeHead(headParts, D, cfg, R * 0.9, H * 0.19, rng, open);
    // A head NODS off the top of its stem rather than sitting square on it: a ring of
    // blooms all facing straight up is a row of satellite dishes.
    const nod = cfg.form === 'spike' ? 0 : 0.10 + rng() * 0.26;
    const nodA = rng() * Math.PI * 2;
    for (const part of headParts) {
      parts.push({
        ...part,
        geometry: placed(part.geometry, {
          pos: tip,
          rot: [Math.sin(nodA) * nod, rng() * 0.4, Math.cos(nodA) * nod],
        }),
      });
    }
  }
}

// One specimen plant, for the borders a student walks along.
export function gardenFlower({
  kind = 'coneflower', height = null, seed = 7, detail = 'hero',
  bloom = 1, lean = 0, leanZ = 0, heads = null,
} = {}) {
  const cfg = FLOWERS[kind] || FLOWERS.coneflower;
  const D = PLANT_DETAIL[detail] || PLANT_DETAIL.hero;
  const parts = [];
  flowerParts(parts, D, cfg, {
    height: height ?? cfg.height, seed, bloom, lean, leanZ, heads,
  });
  return group(mesh(mergeParts(parts), floraMaterial(seed)));
}

// A BED of them, merged. A background prop's cost is multiplied by its placement count --
// the araucaria trap this project has now hit in four worlds -- and a garden is a hundred
// and fifty plants, so a bed of nine has to cost what one specimen does.
export function nectarBed({
  kinds = ['coneflower', 'susan'], count = 7, spread = 16, height = 26,
  seed = 7, detail = 'field', bloom = 1, jitter = 0.35,
} = {}) {
  const rng = seededRandom(seed);
  const D = PLANT_DETAIL[detail] || PLANT_DETAIL.field;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = i * GOLDEN_ANGLE + rng() * 0.4;
    const rr = spread * Math.sqrt((i + 0.4) / count);
    const kind = kinds[i % kinds.length];
    const cfg = FLOWERS[kind] || FLOWERS.coneflower;
    flowerParts(parts, D, cfg, {
      // Height and bloom size are the SAME roll. Rolled apart, a drift comes out as big
      // flowers on stubby stems beside pinheads on tall ones, which reads as broken rather
      // than as varied (the Park's flower-bed lesson).
      height: height * (1 - jitter / 2 + rng() * jitter),
      seed: seed + i * 13,
      bloom: bloom * (0.72 + rng() * 0.4),
      lean: (rng() - 0.5) * 0.18,
      leanZ: (rng() - 0.5) * 0.18,
      heads: null,
      at: [Math.sin(a) * rr, 0, Math.cos(a) * rr],
    });
  }
  return group(mesh(mergeParts(parts), floraMaterial(seed)));
}

// ---------------------------------------------------------------------------
// 8. THE GARDEN ITSELF
// ---------------------------------------------------------------------------

// The mown path down the middle of the garden. Flat on the ground, so it casts no shadow
// (it cannot, without drawing a dark line along its own edge) and receives every one.
export function gardenPath({
  points = [[0, 0], [0, -60]], width = 16, seed = 29, litter = 90,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const a = Math.atan2(bx - ax, bz - az);
    const slab = new THREE.BoxGeometry(width, 0.22, len + width * 0.5);
    put(parts, placed(slab, { pos: [(ax + bx) / 2, 0.11, (az + bz) / 2], rot: [0, a, 0] }),
      rng() < 0.5 ? 0x8a7f62 : 0x7d7259);
  }
  // Fallen petals and cut grass on it, which is what says MOWN rather than paved.
  for (let i = 0; i < litter; i++) {
    const t = rng();
    const seg = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
    const f = t * (points.length - 1) - seg;
    const [ax, az] = points[seg];
    const [bx, bz] = points[seg + 1];
    const a = Math.atan2(bx - ax, bz - az);
    const off2 = (rng() - 0.5) * width * 0.92;
    const x = ax + (bx - ax) * f + Math.cos(a) * off2;
    const z = az + (bz - az) * f - Math.sin(a) * off2;
    const petal = rng();
    const bit = ball(0.22 + rng() * 0.30, 5);
    bit.scale(1.6, 0.16, 0.7);
    put(parts, placed(bit, { pos: [x, 0.24, z], rot: [0, rng() * 6.28, 0] }),
      petal < 0.34 ? 0xc9b878 : petal < 0.62 ? 0x8fa860 : petal < 0.82 ? BF.rose : BF.gold);
  }
  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.95, ...relief('soil', { seed, repeat: 22, strength: 0.6 }),
  })));
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// A PUDDLING POOL. Butterflies drink from wet ground far more than from open water -- they
// are after dissolved salt and minerals, not the water -- and a patch of damp gravel with a
// dozen of them shoulder to shoulder on it is one of the things a real butterfly garden is
// deliberately built with. It is here because it is a behaviour a student can be told to
// go and watch for, not because the garden needed a pond.
export function puddlingPool({ radius = 9, seed = 31, stones = 40 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const water = [];
  const dish = lathed(closed([
    [radius * 1.08, 0.5], [radius * 0.96, 0.22], [radius * 0.74, 0.05], [radius * 0.3, -0.16],
  ]), { segments: 30 });
  tintPN(dish, (p) => {
    const rr = Math.hypot(p.x, p.z) / radius;
    const c = lerpCol(0x6b5f48, BF.gravelPale, smooth(0.25, 1.0, rr));
    c.multiplyScalar(0.86 + 0.24 * smoothNoise3(p.x * 0.5, 0, p.z * 0.5));
    return [c.r, c.g, c.b];
  });
  put(parts, dish, 0xffffff, null, null, { keepColor: true });
  for (let i = 0; i < stones; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = radius * 0.95 * Math.sqrt((i + 0.4) / stones);
    const s = 0.22 + rng() * 0.55;
    const st = ball(s, 6);
    st.scale(1, 0.5 + rng() * 0.3, 0.8 + rng() * 0.4);
    put(parts, placed(st, {
      pos: [Math.sin(a) * rr, 0.10 + s * 0.18 - rr * 0.02, Math.cos(a) * rr], rot: [0, rng() * 6.28, 0],
    }), rng() < 0.3 ? BF.gravelPale : BF.gravel);
  }
  // The wet middle: a shallow disc of standing water, and the ONE transparent surface in
  // the garden apart from the emptied chrysalis case.
  const pool = lathed(closed([[radius * 0.62, 0.06], [radius * 0.3, 0.02], [0.4, -0.02]]), { segments: 26 });
  put(water, pool, BF.water);
  const g = group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.92, ...relief('stone', { seed, repeat: 9, strength: 0.7 }),
  })));
  const w = mesh(mergeParts(water), standard({
    vertexColors: true, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.72,
  }));
  w.castShadow = false;
  g.add(w);
  g.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
  return g;
}

// A tussock of mown lawn, for the ground between the borders.
export function gardenGrass({ radius = 7, height = 4.5, blades = 34, seed = 37 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const a = i * GOLDEN_ANGLE;
    const rr = radius * Math.sqrt((i + 0.4) / blades);
    const h = height * (0.5 + rng() * 0.7);
    const lean = (rng() - 0.5) * h * 0.5;
    const leanZ = (rng() - 0.5) * h * 0.5;
    const blade = tube([
      [Math.sin(a) * rr, -0.3, Math.cos(a) * rr],
      [Math.sin(a) * rr + lean * 0.3, h * 0.55, Math.cos(a) * rr + leanZ * 0.3],
      [Math.sin(a) * rr + lean, h, Math.cos(a) * rr + leanZ],
    ], [h * 0.035, h * 0.022, 0], { sides: 4, tubular: 4 });
    put(parts, blade, rng() < 0.28 ? BF.leafPale : rng() < 0.6 ? BF.leaf : BF.leafDeep);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.88, ...relief('weave', { seed, repeat: 6, strength: 0.3 }),
  })));
}

// The board at the gate naming the five, WITH EACH ONE PAINTED FROM ITS OWN ATLAS.
//
// That the picture is drawn from the same wing splines and the same painter the animal is
// built from is the whole point of it: the monarch on this board is the monarch flying over
// the path, with the same wingspan printed beside it. A hand-drawn board is a second
// description of five species that is free to drift from the first (the Constellations
// world's one star table, doing the same job).
export function speciesBoard({
  width = 22, height = 9.5, postHeight = 12, seed = 41,
} = {}) {
  const W = 1280, H = 560;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H);
  const d = image.data;
  const bg = [30, 42, 34];
  for (let i = 0; i < W * H; i++) { d[i*4] = bg[0]; d[i*4+1] = bg[1]; d[i*4+2] = bg[2]; d[i*4+3] = 255; }

  const AW = ATLAS_W, AH = ATLAS_H;
  const colW = Math.floor(W / SPECIES_ORDER.length);
  SPECIES_ORDER.forEach((key, si) => {
    const cfg = SPECIES[key];
    const src = atlasPixels(key);
    const bandX = { fore: 0, hind: BAND_W * 2 };
    // Scaled so the widest species fills its column and the rest stay in PROPORTION -- five
    // butterflies all drawn the same size on one board teaches the wrong thing about a
    // peacock, which is genuinely half a monarch.
    const maxMm = Math.max(...SPECIES_ORDER.map((k) => SPECIES[k].wingspanMm));
    const scale = (colW * 0.44) * (cfg.wingspanMm / maxMm);
    const cx = si * colW + colW / 2;
    const cy = 190;
    const plot = (x, y, rgb) => {
      const px = Math.round(cx + x * scale);
      const py = Math.round(cy - y * scale);
      if (px < si * colW + 2 || px >= (si + 1) * colW - 2 || py < 24 || py >= 330) return;
      const i = (py * W + px) * 4;
      d[i] = rgb[0]; d[i+1] = rgb[1]; d[i+2] = rgb[2];
    };
    for (const wing of ['hind', 'fore']) {
      const shape = wingShape(cfg[wing]);
      const bx = bandX[wing];
      for (let i = 0; i <= 420; i++) {
        const v = i / 420;
        const r = shape.row(v);
        for (let j = 0; j <= 200; j++) {
          const u = j / 200;
          const z = r.front + (r.back - r.front) * u;
          const sx0 = bx + Math.min(BAND_W - 1, Math.round(u * (BAND_W - 1)));
          const sy0 = Math.min(AH - 1, Math.round((1 - v) * (AH - 1)));
          const k = (sy0 * AW + sx0) * 4;
          const rgb = [src[k], src[k+1], src[k+2]];
          plot(r.x, z, rgb); plot(-r.x, z, rgb);
        }
      }
      // The tails, where a species has them. An Eastern Tiger Swallowtail identified on a
      // board with no tails on it has been identified by everything except the feature it
      // is named for.
      const tc = cfg[wing].tail;
      if (tc) {
        const r0 = shape.row(tc.at);
        const sx0 = bx + Math.round(0.975 * (BAND_W - 1)); // the margin, which is where a tail is coloured from
        const sy0 = Math.min(AH - 1, Math.round((1 - tc.at) * (AH - 1)));
        const k = (sy0 * AW + sx0) * 4;
        const rgb = [src[k], src[k + 1], src[k + 2]];
        for (let i = 0; i <= 200; i++) {
          const v = i / 200;
          const hw = tc.width * (0.55 + 0.45 * Math.sin(Math.PI * Math.pow(Math.min(1, v * 1.04), 0.75)))
            * (1 - Math.pow(v, 6));
          for (let j = -22; j <= 22; j++) {
            const sgn = j / 22;
            const x = r0.x + tc.sweep * v * v + sgn * hw * 0.25;
            const z = r0.back - v * tc.length + sgn * hw;
            plot(x, z, rgb); plot(-x, z, rgb);
          }
        }
      }
    }
    // The body, so it is a butterfly and not two wings.
    for (let i = 0; i <= 260; i++) {
      const t = i / 260;
      const z = 0.32 - t * cfg.bodyLen;
      const w = 0.085 * Math.sin(Math.PI * Math.pow(t, 0.5)) + 0.014;
      for (let j = -22; j <= 22; j++) plot((j / 22) * w, z, [34, 28, 22]);
    }
  });
  ctx.putImageData(image, 0, 0);

  // The text, over the painted wings.
  ctx.fillStyle = '#f6efd8';
  ctx.font = 'bold 42px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FIVE BUTTERFLIES IN THIS GARDEN', W / 2, 52);
  ctx.font = 'italic 25px Georgia, serif';
  ctx.fillStyle = '#b8cbae';
  ctx.fillText('Every one is drawn at its own true size against the others', W / 2, 86);
  SPECIES_ORDER.forEach((key, si) => {
    const cfg = SPECIES[key];
    const cx = si * colW + colW / 2;
    const maxW = colW - 26;
    const fit = (text, weight, family, start, floor) => {
      let size = start;
      do { ctx.font = `${weight} ${size}px ${family}`; size -= 2; }
      while (ctx.measureText(text).width > maxW && size > floor);
      return text;
    };
    ctx.fillStyle = '#ffd97a';
    ctx.fillText(fit(cfg.name.toUpperCase(), 'bold', '"Helvetica Neue", Arial, sans-serif', 30, 13), cx, 372);
    ctx.fillStyle = '#c8d6bc';
    ctx.fillText(fit(cfg.latin, 'italic', 'Georgia, serif', 24, 11), cx, 402);
    ctx.fillStyle = '#f2e9cf';
    ctx.fillText(fit(`${(cfg.wingspanMm / 25.4).toFixed(1)} in across  ·  ${cfg.legs} walking legs`,
      '', '"Helvetica Neue", Arial, sans-serif', 21, 10), cx, 432);
    ctx.fillStyle = '#9fb495';
    const words = cfg.fact.split(/\s+/);
    ctx.font = '18px Georgia, serif';
    const lines = [];
    let line = '';
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (ctx.measureText(cand).width > maxW && line) { lines.push(line); line = w; } else line = cand;
    }
    if (line) lines.push(line);
    lines.slice(0, 4).forEach((ln, i) => ctx.fillText(ln, cx, 464 + i * 23));
  });
  ctx.textAlign = 'left';

  const texture = freshTexture(canvas);
  const g = group();
  const panel = mesh(new THREE.PlaneGeometry(width, height), standard({
    map: texture, roughness: 0.82, side: THREE.DoubleSide,
    emissive: new THREE.Color(0xffffff), emissiveMap: texture, emissiveIntensity: 0.2,
  }));
  panel.position.y = postHeight;
  g.add(panel);
  const frame = [];
  const wood = 0x4a3c28;
  // POSTS OUTSIDE THE PANEL, not tucked inside its edges: this board's five columns run
  // right to its margins, so an inset post stands on the first letter of a species name
  // (the activity-board rule).
  for (const sx of [-1, 1]) {
    put(frame, new THREE.BoxGeometry(0.85, postHeight + height * 0.5, 0.85),
      wood, [sx * (width / 2 + 0.6), (postHeight + height * 0.5) / 2, 0]);
  }
  put(frame, new THREE.BoxGeometry(width + 2.4, 0.6, 0.7), wood, [0, postHeight + height / 2 + 0.4, 0]);
  put(frame, new THREE.BoxGeometry(width + 2.4, 0.5, 0.7), wood, [0, postHeight - height / 2 - 0.3, 0]);
  g.add(mesh(mergeParts(frame), standard({
    vertexColors: true, roughness: 0.9, ...relief('wood', { seed, repeat: 5 }),
  })));
  return g;
}

