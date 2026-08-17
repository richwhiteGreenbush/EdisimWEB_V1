import * as THREE from 'three';
import {
  standard,
  mesh,
  group,
  mergedMesh,
  canvasTexture,
  taperedTube,
  roughenSphere,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "A Rabbit's Den" -- a warren in a chalk-downland bank, cut open so the tunnels and the
// nesting chamber are visible, with the meadow above it.
//
// EVERYTHING IS AT ABOUT 4x LIFE SIZE. A rabbit is 16 inches long, which at true scale is
// a knee-high object a student cannot walk round or read any detail on, and the burrow it
// lives in is a four-inch hole. At 4x the rabbit is about 5ft nose to tail -- a proper
// walk-around model at roughly the size of a large dog -- and the cutaway is a room. This
// is the same bargain A Bug's Life makes, and much gentler: at the 60x that world uses,
// grass is a tower and the sky is gone.
//
// THE HERO IS THE RABBIT and most of the detail budget is in `rabbit()`. What follows the
// goose's lesson in ParkProps: a species is a LIST OF FIELD MARKS, not a silhouette, and
// three spheres in the right arrangement is a blob. For a rabbit the marks are, in order
// of how much each one buys: the long ears with their pale inner surface; the huge
// hind foot lying flat along the ground rather than standing on a toe; the powerful haunch
// that sits ABOVE the line of the back; the eye set high and far to the SIDE of the head;
// and the split lip under a blunt nose.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

const FUR_BACK = 0x8b7355;      // agouti brown-grey
const FUR_MID = 0xa08a69;
const FUR_PALE = 0xd6c8ae;      // the belly, the underside of the tail, inside the ears
const FUR_DARK = 0x5f4e3a;
const EAR_PINK = 0xc99a90;
const EYE_DARK = 0x24201c;
const NOSE_PINK = 0xb98c85;
const SOIL = 0x6b563c;
const SOIL_DARK = 0x4a3928;
const SOIL_PALE = 0x8b7355;
const CHALK = 0xcfc7b0;
const GRASS_LIT = 0x86a844;
const GRASS_DEEP = 0x4d6a2b;
const NEST_FUR = 0xbfae92;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function tube(points, radii, color, options) {
  return { geometry: taperedTube(points, radii, options), color };
}

function ball(radius, detail = 12) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// A squashed sphere placed and turned by a full matrix.
//
// gooseSolid()'s reasoning applies exactly: nearly every piece of an animal here is a
// squashed sphere turned about an arbitrary axis, and mergeColored()'s per-part fields
// apply rotateX then rotateY then rotateZ in that fixed order, which cannot express it.
// `about` is the pivot and is NOT optional decoration -- the parts are authored in absolute
// animal coordinates, so scaling a haunch about the default origin does not squash the
// haunch, it moves it through the floor.
function solid(parts, { radius, scale = [1, 1, 1], at = [0, 0, 0], rot = [0, 0, 0], color, detail = 12 }) {
  const g = ball(radius, detail);
  const m = new THREE.Matrix4()
    .makeTranslation(at[0], at[1], at[2])
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')))
    .multiply(new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]));
  g.applyMatrix4(m);
  parts.push({ geometry: g, color });
}

// ---------------------------------------------------------------------------
// 1. The rabbit
// ---------------------------------------------------------------------------

// `pose` decides what the body is doing, and it changes real geometry rather than just
// tilting the group:
//   'sit'   -- upright on the haunches, ears up, forelegs tucked. The alert pose, and the
//              one that shows every field mark at once, so it is the default.
//   'feed'  -- head down, body horizontal, ears back.
//   'kit'   -- a young one: smaller, rounder, with ears that are too short for its head,
//              which is exactly how you tell a young rabbit from a small adult.
export function rabbit({ length = 5.2, pose = 'sit', seed = 7 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const body = [];       // matte fur
  const pale = [];       // belly, tail underside, inner ear -- its own merge, see below
  const detail = [];     // eyes, nose, claws: glossy

  const S = length / 5.2;                 // everything below is authored at length 5.2
  const kit = pose === 'kit';
  const k = kit ? 0.58 : 1;               // a kit is smaller in every dimension
  const feeding = pose === 'feed';

  // --- Body mass ----------------------------------------------------------
  // A rabbit's body is a wedge: narrow at the shoulder, deepest and widest at the haunch.
  // Built as two overlapping masses rather than one, because a single ellipsoid gives the
  // even barrel of a guinea pig.
  const hipY = (feeding ? 1.05 : 1.35) * S * k;
  const shoulderY = (feeding ? 0.92 : 1.55) * S * k;
  const hipZ = -0.85 * S * k;
  const shoulderZ = 0.55 * S * k;

  solid(body, {
    radius: 1.0 * S * k, scale: [0.82, 0.95, 1.15], at: [0, hipY, hipZ],
    color: FUR_BACK, detail: 16,
  });
  solid(body, {
    radius: 0.82 * S * k, scale: [0.8, 0.92, 1.0], at: [0, shoulderY, shoulderZ],
    rot: [feeding ? 0.25 : -0.35, 0, 0],
    color: FUR_BACK, detail: 16,
  });
  // The chest, filling between them.
  solid(body, {
    radius: 0.78 * S * k, scale: [0.78, 1.0, 0.95], at: [0, (hipY + shoulderY) / 2, (hipZ + shoulderZ) / 2],
    color: FUR_BACK, detail: 14,
  });

  // Pale underside. A BROAD pale mass whose axis sits INSIDE the body, not a tube slung
  // beneath it -- the lesson every animal in DinoProps had to be rebuilt for. A keel reads
  // as a plank strapped on; countershading needs a wide pale belly.
  solid(pale, {
    radius: 0.72 * S * k, scale: [0.72, 0.55, 1.5],
    at: [0, (hipY + shoulderY) / 2 - 0.28 * S * k, (hipZ + shoulderZ) / 2 + 0.1 * S * k],
    color: FUR_PALE, detail: 14,
  });

  // --- Haunch -------------------------------------------------------------
  // THE DRUMSTICK, and like the theropod's it has to break the body's outline. A rabbit's
  // thigh muscle rises ABOVE the line of its back when it sits; tucked inside the body it
  // hides in the silhouette and the animal reads as a loaf.
  for (const sx of [-1, 1]) {
    solid(body, {
      radius: 0.66 * S * k, scale: [0.62, 1.05, 0.85],
      at: [sx * 0.62 * S * k, hipY + 0.16 * S * k, hipZ - 0.05 * S * k],
      color: FUR_MID, detail: 14,
    });
    // Lower leg, folded forward under the haunch.
    solid(body, {
      radius: 0.3 * S * k, scale: [0.7, 0.8, 1.5],
      at: [sx * 0.58 * S * k, hipY - 0.6 * S * k, hipZ + 0.35 * S * k],
      color: FUR_MID, detail: 10,
    });
    // THE HIND FOOT, long and flat on the ground. This is the single most rabbit-specific
    // piece of the animal -- it is a leporid's whole locomotion -- and a foot modelled as
    // a paw standing on its toes turns it into a cat.
    const foot = new THREE.BoxGeometry(0.34 * S * k, 0.2 * S * k, 1.5 * S * k);
    foot.translate(sx * 0.58 * S * k, 0.1 * S * k, hipZ + 0.85 * S * k);
    body.push({ geometry: foot, color: FUR_MID });
    solid(body, {
      radius: 0.22 * S * k, scale: [0.8, 0.6, 1.0],
      at: [sx * 0.58 * S * k, 0.12 * S * k, hipZ + 1.6 * S * k],
      color: FUR_PALE, detail: 8,
    });
  }

  // --- Forelegs -----------------------------------------------------------
  // Short, held close, and nearly vertical in the sitting pose -- they carry almost no
  // weight, which is why they are so much thinner than the back legs.
  for (const sx of [-1, 1]) {
    const fz = shoulderZ + 0.3 * S * k;
    const drop = feeding ? 0.85 : 1.15;
    solid(body, {
      radius: 0.22 * S * k, scale: [0.85, drop * 1.5, 0.9],
      at: [sx * 0.42 * S * k, shoulderY - 0.62 * S * k * drop, fz],
      rot: [feeding ? 0.15 : -0.1, 0, 0],
      color: FUR_MID, detail: 10,
    });
    solid(detail, {
      radius: 0.17 * S * k, scale: [1, 0.7, 1.25],
      at: [sx * 0.42 * S * k, 0.13 * S * k, fz + 0.2 * S * k],
      color: FUR_PALE, detail: 8,
    });
  }

  // --- Head ---------------------------------------------------------------
  // Set well forward of the shoulder on a short neck. A rabbit has almost no visible neck,
  // so the head reads as joined straight onto the chest -- but there IS a gap, and closing
  // it with a ball is the joint() rule from DinoProps: two masses meeting at an angle
  // cannot close on their own.
  const headY = feeding ? 0.62 * S * k : shoulderY + 0.72 * S * k;
  const headZ = feeding ? shoulderZ + 1.1 * S * k : shoulderZ + 0.42 * S * k;

  solid(body, {
    radius: 0.52 * S * k, scale: [0.9, 0.95, 1.15], at: [0, headY, headZ],
    rot: [feeding ? 0.5 : -0.12, 0, 0],
    color: FUR_BACK, detail: 16,
  });
  // Muzzle: blunt and short. A long tapering snout is a rodent, not a lagomorph.
  solid(body, {
    radius: 0.34 * S * k, scale: [0.85, 0.8, 1.05],
    at: [0, headY - 0.16 * S * k, headZ + 0.42 * S * k],
    rot: [feeding ? 0.5 : -0.12, 0, 0],
    color: FUR_MID, detail: 12,
  });
  // Cheek, which is what makes the head look wide from the front.
  for (const sx of [-1, 1]) {
    solid(body, {
      radius: 0.28 * S * k, scale: [0.8, 0.85, 0.9],
      at: [sx * 0.3 * S * k, headY - 0.14 * S * k, headZ + 0.2 * S * k],
      color: FUR_MID, detail: 10,
    });
  }
  // Neck join.
  solid(body, {
    radius: 0.42 * S * k, at: [0, (headY + shoulderY) / 2, (headZ + shoulderZ) / 2],
    scale: [0.85, 0.9, 0.9], color: FUR_BACK, detail: 12,
  });

  // Nose and the split lip. Two small pale wedges either side of a pink nose -- tiny, and
  // the thing that makes a rabbit's face read as a rabbit's face rather than a generic
  // mammal's at close range.
  solid(detail, {
    radius: 0.11 * S * k, scale: [1.1, 0.8, 0.8],
    at: [0, headY - 0.16 * S * k, headZ + 0.74 * S * k],
    color: NOSE_PINK, detail: 8,
  });
  for (const sx of [-1, 1]) {
    solid(pale, {
      radius: 0.1 * S * k, scale: [0.8, 0.7, 0.6],
      at: [sx * 0.09 * S * k, headY - 0.3 * S * k, headZ + 0.68 * S * k],
      color: FUR_PALE, detail: 8,
    });
  }

  // EYES, set HIGH and far round the SIDE of the skull. A rabbit sees nearly 360 degrees
  // and that is a fact about where its eyes are -- put them on the front of the face like a
  // cat's and the animal instantly reads as a predator.
  for (const sx of [-1, 1]) {
    solid(detail, {
      radius: 0.145 * S * k, scale: [0.85, 1, 1],
      at: [sx * 0.44 * S * k, headY + 0.14 * S * k, headZ + 0.16 * S * k],
      color: EYE_DARK, detail: 10,
    });
    // A catchlight: a tiny pale bead. Without it a dark eye is a hole.
    solid(detail, {
      radius: 0.045 * S * k,
      at: [sx * 0.5 * S * k, headY + 0.2 * S * k, headZ + 0.24 * S * k],
      color: 0xe8e4dc, detail: 6,
    });
  }

  // --- EARS ---------------------------------------------------------------
  // The field mark that does the most work. Long, held up and slightly apart in the alert
  // pose, laid back along the shoulders when feeding, and SHORT on a kit.
  //
  // Each ear is a scoop, not a paddle: an outer face in back fur and a PALE inner face set
  // slightly forward of it. One flat blade in body colour reads as a leaf.
  const earLen = (kit ? 0.85 : 1.95) * S * k;
  const earSpread = feeding ? 0.55 : 0.22;
  const earPitch = feeding ? 1.25 : 0.14;
  for (const sx of [-1, 1]) {
    const base = [sx * 0.24 * S * k, headY + 0.4 * S * k, headZ - 0.12 * S * k];
    const rot = [earPitch, 0, sx * earSpread];

    solid(body, {
      radius: 0.26 * S * k, scale: [0.62, earLen / (0.26 * S * k) * 0.5, 0.42],
      at: [
        base[0] + Math.sin(sx * earSpread) * earLen * 0.5,
        base[1] + Math.cos(earPitch) * Math.cos(earSpread) * earLen * 0.5,
        base[2] - Math.sin(earPitch) * earLen * 0.5,
      ],
      rot, color: FUR_BACK, detail: 12,
    });
    solid(pale, {
      radius: 0.19 * S * k, scale: [0.6, earLen / (0.19 * S * k) * 0.46, 0.3],
      at: [
        base[0] + Math.sin(sx * earSpread) * earLen * 0.5,
        base[1] + Math.cos(earPitch) * Math.cos(earSpread) * earLen * 0.5,
        base[2] - Math.sin(earPitch) * earLen * 0.5 + 0.16 * S * k,
      ],
      rot, color: EAR_PINK, detail: 10,
    });
    // A dark rim along the ear's edge -- real ears are edged darker, and it stops the pale
    // inner face and the sky merging at the silhouette.
    solid(body, {
      radius: 0.07 * S * k, scale: [0.5, earLen / (0.07 * S * k) * 0.48, 0.5],
      at: [
        base[0] + Math.sin(sx * earSpread) * earLen * 0.52 + sx * 0.15 * S * k,
        base[1] + Math.cos(earPitch) * Math.cos(earSpread) * earLen * 0.52,
        base[2] - Math.sin(earPitch) * earLen * 0.52,
      ],
      rot, color: FUR_DARK, detail: 8,
    });
  }

  // --- Tail ---------------------------------------------------------------
  // The scut: a round white puff held up against the rump. It is a signal flag -- a fleeing
  // rabbit flashes it -- so it is bright, and it is on the UNDER-rear of the animal.
  solid(pale, {
    radius: 0.3 * S * k, scale: [1, 0.9, 0.85],
    at: [0, hipY - 0.2 * S * k, hipZ - 0.92 * S * k],
    color: 0xf0e8d8, detail: 12,
  });

  // --- Whiskers -----------------------------------------------------------
  // Long -- as wide as the body, which is how a rabbit judges a gap in the dark. Cheap:
  // six thin tubes.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const spread = 0.25 + i * 0.22;
      const pts = [
        [sx * 0.2 * S * k, headY - 0.12 * S * k, headZ + 0.62 * S * k],
        [sx * (0.55 + i * 0.1) * S * k, headY - 0.05 * S * k + i * 0.08 * S * k, headZ + 0.9 * S * k],
        [sx * (0.95 + i * 0.16) * S * k, headY - 0.2 * S * k + i * 0.16 * S * k, headZ + 1.05 * S * k],
      ];
      detail.push(tube(pts, [0.022 * S * k, 0.016 * S * k, 0.006 * S * k], 0xe4dccb, {
        tubularSegments: 8, radialSegments: 4,
      }));
    }
  }

  // Three merges, not one: the fur is matte, the pale parts want to stay light rather than
  // taking the same bump, and the eyes and nose are the only glossy things on the animal.
  g.add(mergedMesh(body, {
    color: 0xffffff, roughness: 0.95,
    ...relief('weave', { seed, repeat: 9, strength: 0.55 }),
  }));
  g.add(mergedMesh(pale, {
    color: 0xffffff, roughness: 0.92,
    ...relief('weave', { seed: seed + 5, repeat: 10, strength: 0.4 }),
  }));
  g.add(mergedMesh(detail, { color: 0xffffff, roughness: 0.3, metalness: 0.1 }));
  return g;
}

// ---------------------------------------------------------------------------
// 2. The warren, cut open
// ---------------------------------------------------------------------------

// A bank of soil with the burrow system exposed: the entrance, a run down to a chamber,
// a blind-ending bolt run, and the nest itself.
//
// BUILT VOID FIRST, which is the reef cave's rule. The dark tunnel volumes are placed and
// the soil is built AROUND them from those same dimensions. Done the other way -- soil
// first, then dark slabs pushed in -- the slabs stick out through the bank as black fins
// and there is no hole anywhere.
export function warrenCutaway({ width = 40, height = 20, depth = 14, seed = 11 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const soil = [];
  const voids = [];
  const FRONT = depth * 0.52;      // the cut face; everything visible sits at or before it

  // The tunnel system, as a list of boxes in the cut plane.
  const TUN = 2.6;
  const runs = [
    // [x0, y0, x1, y1, radius] -- a run from one point to another in the cut face
    [-width * 0.34, height * 0.86, -width * 0.2, height * 0.5, TUN],     // entrance shaft
    [-width * 0.2, height * 0.5, width * 0.04, height * 0.42, TUN],      // main run
    [width * 0.04, height * 0.42, width * 0.3, height * 0.52, TUN],      // to the second hole
    [width * 0.3, height * 0.52, width * 0.36, height * 0.85, TUN],      // bolt hole up
    [-width * 0.06, height * 0.44, -width * 0.16, height * 0.2, TUN * 0.9], // down to the nest
  ];
  for (const [x0, y0, x1, y1, r] of runs) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const t = new THREE.BoxGeometry(len + r, r, r * 1.6);
    t.rotateZ(Math.atan2(dy, dx));
    t.translate((x0 + x1) / 2, (y0 + y1) / 2, FRONT - r * 0.7);
    voids.push({ geometry: t, color: 0x140f0a });
  }

  // The nesting chamber -- wider than the runs, which is the whole point of a chamber.
  const nestX = -width * 0.19;
  const nestY = height * 0.17;
  const nestR = 5.2;
  const chamber = ball(nestR, 16);
  chamber.scale(1.25, 0.85, 0.7);
  chamber.translate(nestX, nestY, FRONT - nestR * 0.5);
  voids.push({ geometry: chamber, color: 0x140f0a });

  // --- Soil, built round the voids ----------------------------------------
  const bank = new THREE.BoxGeometry(width, height, depth);
  bank.translate(0, height / 2, 0);
  soil.push({ geometry: bank, color: SOIL });

  // Strata: pale chalk bands through the bank, which is what downland is and what makes a
  // 20ft cliff of one brown read as ground rather than as a wall.
  for (let i = 0; i < 5; i++) {
    const y = height * (0.12 + i * 0.18);
    const band = new THREE.BoxGeometry(width * 1.005, height * randomIn(rng, 0.02, 0.05), depth * 1.005);
    band.translate(0, y, 0);
    soil.push({ geometry: band, color: i % 2 ? CHALK : SOIL_PALE });
  }

  // A lumpy, staggered face. A straight grid of boxes is Minecraft -- nestCutaway's
  // lesson -- so alternate courses are offset by half a cell and every lump varies.
  const COLS = 16;
  const ROWS = 9;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const stagger = (r % 2) * (width / COLS) * 0.5;
      const x = -width / 2 + (c + 0.5) * (width / COLS) + stagger;
      const y = (r + 0.5) * (height / ROWS);
      if (Math.abs(x) > width / 2) continue;
      const s = randomIn(rng, 0.6, 1.35);
      const lump = ball(randomIn(rng, 0.8, 1.7), 6);
      lump.scale(s, s * randomIn(rng, 0.7, 1.1), 0.5);
      lump.translate(x, y, FRONT - randomIn(rng, 0.1, 0.5));
      soil.push({ geometry: lump, color: r % 3 === 0 ? SOIL_DARK : (r % 3 === 1 ? SOIL : SOIL_PALE) });
    }
  }

  // Grass turf capping the bank, overhanging the cut face -- the overhang is what says the
  // soil was cut away rather than built up.
  soil.push({
    geometry: (() => { const t = new THREE.BoxGeometry(width * 1.02, 1.3, depth * 1.12); t.translate(0, height + 0.4, 0); return t; })(),
    color: GRASS_DEEP,
  });

  // --- Wings, so this is a cut HILLSIDE and not a block on a lawn ---------
  // Without these the prop is a rectangular slab standing on flat grass, and it reads
  // unmistakably as a slice of cake: four vertical sides, a flat green top, and daylight
  // all the way round it. A bank has to run OUT of the frame at both ends and fall back
  // into the ground behind, so each end gets a turfed wedge that dies away to nothing.
  //
  // They are turf-coloured all over rather than soil-coloured, because they are the
  // UNCUT hillside -- only the face between them has been opened up.
  // Each wing is a BOX with its far end collapsed to the ground, NOT a hand-built
  // BufferGeometry. That is not fussiness: mergedMesh() merges these with everything else
  // in `soil`, and mergeGeometries() requires every input to carry the SAME attributes. A
  // raw geometry with only `position` and `normal` has no `uv`, the merge returns null,
  // and the entire bank disappears -- not just the wings. Starting from a box means the
  // uv set comes along for free and collapsing vertices cannot break it.
  for (const sx of [-1, 1]) {
    const wingLen = width * 0.5;
    const wing = new THREE.BoxGeometry(wingLen, height + 1, depth, 1, 1, 1);
    const pos = wing.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Everything at the OUTER end drops to ground level, which turns the box into a
      // wedge that dies away into the turf.
      if (pos.getX(i) > 0) pos.setY(i, -(height + 1) / 2);
    }
    wing.computeVertexNormals();
    if (sx < 0) wing.rotateY(Math.PI);
    wing.translate(sx * (width / 2 + wingLen / 2), (height + 1) / 2, 0);
    soil.push({ geometry: wing, color: GRASS_DEEP });
  }

  const soilMesh = mergedMesh(soil, {
    color: 0xffffff, roughness: 0.98,
    ...relief('soil', { seed, repeat: 6, strength: 0.9 }),
  });
  g.add(soilMesh);

  // The voids go LAST and are drawn as flat dark volumes with no bump: a tunnel is an
  // absence, and giving it surface detail makes it read as a dark object sitting in a hole.
  const voidMesh = mergedMesh(voids, { color: 0xffffff, roughness: 1 });
  voidMesh.castShadow = false;
  g.add(voidMesh);

  // --- What is IN the chamber ---------------------------------------------
  // Grass-and-fur lining, and three kits. They sit clearly in FRONT of the void's own front
  // face -- BugProps' granary came out empty because its seeds were at the slab's mid-depth,
  // which is inside the dark box.
  const nestZ = FRONT - nestR * 0.5 + nestR * 0.62;
  const lining = [];
  for (let i = 0; i < 26; i++) {
    const a = randomIn(rng, Math.PI * 0.15, Math.PI * 0.85);
    const rr = nestR * randomIn(rng, 0.55, 0.9);
    const strand = new THREE.BoxGeometry(randomIn(rng, 0.7, 1.8), 0.16, 0.16);
    strand.rotateZ(randomIn(rng, -1, 1));
    strand.translate(nestX + Math.cos(a) * rr * 1.2, nestY - Math.sin(a) * rr * 0.7 + nestR * 0.25, nestZ);
    lining.push({ geometry: strand, color: i % 3 === 0 ? NEST_FUR : 0x9a8a5e });
  }
  g.add(mergedMesh(lining, { color: 0xffffff, roughness: 0.95 }));

  return g;
}

// A burrow entrance in open ground: a dark hole with a fan of excavated soil below it.
// A dark spot on flat grass is a stain -- antHill's lesson -- so this is a real crater with
// a raised rim on the uphill side and spoil spread downhill.
export function burrowEntrance({ radius = 3.4, seed = 21 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];

  // Spoil heap, fanned to one side.
  for (let i = 0; i < 30; i++) {
    const a = randomIn(rng, -0.9, 0.9);
    const rr = radius * randomIn(rng, 0.9, 2.4);
    const s = randomIn(rng, 0.3, 0.9);
    const lump = ball(s, 6);
    lump.scale(1, 0.5, 1);
    lump.translate(Math.sin(a) * rr, s * 0.25, Math.cos(a) * rr);
    parts.push({ geometry: lump, color: i % 3 ? SOIL : SOIL_PALE });
  }
  // Rim.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const lump = ball(randomIn(rng, 0.5, 0.9), 6);
    lump.scale(1, 0.55, 1);
    lump.translate(Math.sin(a) * radius, 0.2, Math.cos(a) * radius);
    parts.push({ geometry: lump, color: SOIL_DARK });
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.98, ...relief('soil', { seed, repeat: 4, strength: 0.9 }) }));

  // The hole: a dark bowl sunk below ground, plus a shaft going back into the bank so it
  // reads as a way IN rather than as a saucer.
  const holeParts = [];
  const bowl = new THREE.SphereGeometry(radius * 0.82, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.scale(1, 0.8, 1);
  bowl.translate(0, 0.25, 0);
  holeParts.push({ geometry: bowl, color: 0x140f0a });
  const shaft = new THREE.CylinderGeometry(radius * 0.6, radius * 0.5, radius * 2.2, 14);
  shaft.rotateX(1.15);
  shaft.translate(0, -radius * 0.5, -radius * 0.7);
  holeParts.push({ geometry: shaft, color: 0x100c08 });
  const hm = mergedMesh(holeParts, { color: 0xffffff, roughness: 1 });
  hm.castShadow = false;
  g.add(hm);
  return g;
}

// ---------------------------------------------------------------------------
// 3. Meadow planting
// ---------------------------------------------------------------------------

// A clump of meadow grass with seed heads. Denser than it looks necessary -- StormProps'
// wheat proved that a thin scatter of blades reads as stubble, not as grass.
export function meadowClump({ radius = 7, count = 240, height = 2.6, seed = 31 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(randomIn(rng, 0, 1)) * radius;
    const h = height * randomIn(rng, 0.6, 1.35);
    const blade = new THREE.CylinderGeometry(0.02, 0.055, h, 4);
    blade.translate(0, h / 2, 0);
    blade.rotateZ(randomIn(rng, -0.3, 0.3));
    blade.rotateY(randomIn(rng, 0, Math.PI * 2));
    blade.translate(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    parts.push({ geometry: blade, color: rng() > 0.45 ? GRASS_LIT : GRASS_DEEP });
    if (i % 7 === 0) {
      const seedHead = new THREE.CylinderGeometry(0.07, 0.03, h * 0.3, 5);
      seedHead.translate(Math.cos(a) * rad, h * 1.05, Math.sin(a) * rad);
      parts.push({ geometry: seedHead, color: 0xc9b878 });
    }
  }
  const m = mergedMesh(parts, { color: 0xffffff, roughness: 0.95 });
  m.castShadow = false;
  g.add(m);
  return g;
}

// Dandelions and buttercups -- what a rabbit actually eats, and the only strong colour in
// an otherwise green world.
export function meadowFlowers({ radius = 6, count = 34, seed = 41 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(randomIn(rng, 0, 1)) * radius;
    const h = randomIn(rng, 1.4, 2.6);
    const x = Math.cos(a) * rad;
    const z = Math.sin(a) * rad;
    const stem = new THREE.CylinderGeometry(0.035, 0.05, h, 5);
    stem.translate(x, h / 2, z);
    parts.push({ geometry: stem, color: 0x4f7031 });

    const yellow = i % 3 !== 0;
    // A disc with a raised centre, not a sphere: a flower seen from above is a disc, and a
    // ball on a stick is the thing flowerBed() in ParkProps was rebuilt to stop being.
    // Smaller and DOMED. At 0.32-0.5 radius and 0.12 thick these were flat discs a foot
    // across on a bare stem, and a field of them read as little white tables rather than as
    // flowers. A flower head is shallow but it is not flat, and the dome is what catches
    // the light differently from the petals' rim.
    const petalR = randomIn(rng, 0.2, 0.3);
    const head = new THREE.CylinderGeometry(petalR, petalR * 0.72, 0.07, 10);
    head.translate(x, h, z);
    parts.push({ geometry: head, color: yellow ? 0xe8c22e : 0xf0ead6 });
    const dome = ball(petalR * 0.55, 7);
    dome.scale(1, 0.6, 1);
    dome.translate(x, h + 0.05, z);
    parts.push({ geometry: dome, color: yellow ? 0xc99a1e : 0xe0c43c });
    // Two leaves at the base.
    for (const sx of [-1, 1]) {
      const leaf = new THREE.BoxGeometry(0.7, 0.05, 0.24);
      leaf.rotateZ(sx * 0.3);
      leaf.rotateY(randomIn(rng, 0, Math.PI));
      leaf.translate(x + sx * 0.3, 0.25, z);
      parts.push({ geometry: leaf, color: 0x4f7031 });
    }
  }
  const m = mergedMesh(parts, { color: 0xffffff, roughness: 0.9 });
  m.castShadow = false;
  g.add(m);
  return g;
}

// A bramble thicket -- cover, which is the single thing a warren site is actually chosen
// for. Arching canes with thorns and a few blackberries.
export function brambleThicket({ radius = 8, canes = 16, seed = 51 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const fruit = [];

  for (let c = 0; c < canes; c++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const r0 = randomIn(rng, 0, radius * 0.5);
    const x0 = Math.cos(a) * r0;
    const z0 = Math.sin(a) * r0;
    const reach = randomIn(rng, radius * 0.6, radius * 1.15);
    const rise = randomIn(rng, 3.2, 6.0);
    const dir = randomIn(rng, 0, Math.PI * 2);
    // An ARCH: up and over, tip back down to the ground. That is what a bramble does and
    // it is why a thicket is impenetrable.
    const pts = [
      [x0, 0.1, z0],
      [x0 + Math.cos(dir) * reach * 0.35, rise, z0 + Math.sin(dir) * reach * 0.35],
      [x0 + Math.cos(dir) * reach * 0.8, rise * 0.85, z0 + Math.sin(dir) * reach * 0.8],
      [x0 + Math.cos(dir) * reach, rise * 0.25, z0 + Math.sin(dir) * reach],
    ];
    parts.push(tube(pts, [0.16, 0.13, 0.1, 0.07], 0x5c4a33, { tubularSegments: 14, radialSegments: 6 }));

    // Leaves along it.
    for (let i = 1; i < 5; i++) {
      const t = i / 5;
      const px = x0 + Math.cos(dir) * reach * t;
      const pz = z0 + Math.sin(dir) * reach * t;
      const py = rise * Math.sin(Math.PI * t * 0.85) * 0.95 + 0.3;
      const leaf = ball(randomIn(rng, 0.5, 0.85), 7);
      leaf.scale(1, 0.4, 1);
      leaf.rotateY(randomIn(rng, 0, Math.PI));
      leaf.translate(px, py, pz);
      parts.push({ geometry: leaf, color: rng() > 0.5 ? 0x3f5f28 : 0x51733a });
    }
    if (c % 4 === 0) {
      const px = x0 + Math.cos(dir) * reach * 0.75;
      const pz = z0 + Math.sin(dir) * reach * 0.75;
      fruit.push({ geometry: ball(0.28, 7), position: [px, rise * 0.5, pz], color: 0x241a2b });
    }
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.94, ...relief('bark', { seed, repeat: 5, strength: 0.6 }) }));
  if (fruit.length) g.add(mergedMesh(fruit, { color: 0xffffff, roughness: 0.4 }));
  return g;
}

// A hawthorn: the tree that grows on chalk downland, wind-shaped and low.
export function hawthornTree({ height = 22, seed = 61 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const wood = [];
  const leaves = [];
  const trunkH = height * 0.34;

  // The trunk LEANS and the crown is swept one way -- a hawthorn on open downland is
  // shaped by the prevailing wind, and a symmetrical one reads as a garden tree.
  const lean = 0.2;
  wood.push({
    geometry: (() => {
      const t = new THREE.CylinderGeometry(height * 0.028, height * 0.055, trunkH, 10);
      t.rotateZ(lean);
      t.translate(Math.sin(lean) * trunkH * 0.5, trunkH * 0.5, 0);
      return t;
    })(),
    color: 0x6b5a45,
  });
  for (let i = 0; i < 5; i++) {
    const a = randomIn(rng, -0.5, 1.4);
    const limb = new THREE.CylinderGeometry(height * 0.011, height * 0.024, height * 0.3, 7);
    limb.rotateZ(0.7 + randomIn(rng, -0.2, 0.3));
    limb.rotateY(a);
    limb.translate(Math.sin(lean) * trunkH + Math.sin(a) * height * 0.05, trunkH + height * 0.09, Math.cos(a) * height * 0.05);
    wood.push({ geometry: limb, color: 0x6b5a45 });
  }
  for (let i = 0; i < 8; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = randomIn(rng, 0, height * 0.19);
    const blob = ball(height * randomIn(rng, 0.13, 0.2), 10);
    blob.scale(1, randomIn(rng, 0.55, 0.78), 1);
    // Swept downwind: the crown's centre is offset, not centred on the trunk.
    blob.translate(Math.cos(a) * rad + height * 0.12, trunkH + height * randomIn(rng, 0.17, 0.36), Math.sin(a) * rad);
    leaves.push({ geometry: blob, color: i % 3 === 0 ? 0x3d5a26 : 0x4b6b30 });
  }
  g.add(mergedMesh(wood, { color: 0xffffff, roughness: 0.95, ...relief('bark', { seed, repeat: 4, strength: 0.8 }) }));
  g.add(mergedMesh(leaves, { color: 0xffffff, roughness: 0.96 }));
  return g;
}

// A butterfly -- the world's animated object. Two wing pairs and a body, built small and
// bright so it reads against the grass when it moves.
export function butterfly({ span = 1.6, color = 0xe8843c, seed = 71 } = {}) {
  const g = group();
  const parts = [];

  // Body.
  parts.push({ geometry: (() => { const b = ball(span * 0.09, 8); b.scale(0.7, 0.7, 2.2); return b; })(), position: [0, 0, 0], color: 0x2e2820 });
  // Antennae.
  for (const sx of [-1, 1]) {
    const a = new THREE.CylinderGeometry(0.012, 0.016, span * 0.28, 4);
    a.rotateX(-0.5);
    a.rotateZ(sx * 0.35);
    a.translate(sx * span * 0.04, span * 0.1, span * 0.2);
    parts.push({ geometry: a, color: 0x2e2820 });
  }
  // Wings: fore and hind, angled up in a shallow V so they read as wings from the side too.
  for (const sx of [-1, 1]) {
    const fore = ball(span * 0.32, 8);
    fore.scale(1, 0.08, 0.7);
    fore.rotateZ(sx * -0.35);
    fore.translate(sx * span * 0.3, span * 0.1, span * 0.06);
    parts.push({ geometry: fore, color });

    const hind = ball(span * 0.22, 8);
    hind.scale(1, 0.08, 0.75);
    hind.rotateZ(sx * -0.3);
    hind.translate(sx * span * 0.24, span * 0.05, -span * 0.16);
    parts.push({ geometry: hind, color });

    // Wing spots, the thing that makes it a butterfly rather than a leaf.
    parts.push({ geometry: (() => { const s = ball(span * 0.07, 6); s.scale(1, 0.1, 1); return s; })(), position: [sx * span * 0.38, span * 0.13, span * 0.08], color: 0x2e2820 });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.7, metalness: 0.05 }));
  // Lifted clear of the ground: this thing flies, and its origin being its base centre
  // would otherwise drag it through the grass.
  g.position.y = 0;
  return g;
}

// A chalk boulder with a flat top -- rabbits use these as lookouts, and it gives the
// meadow something with a hard edge among all the soft planting.
export function chalkBoulder({ radius = 3, seed = 81 } = {}) {
  const g = group();
  const geo = ball(radius, 14);
  roughenSphere(geo, { amount: 0.22, flatten: 0.62, phase: seed });
  geo.scale(1.25, 0.7, 1);
  geo.translate(0, radius * 0.5, 0);
  g.add(mesh(geo, standard({
    color: CHALK, roughness: 0.95,
    ...relief('stone', { seed, repeat: 3, strength: 0.85 }),
  })));
  return g;
}
