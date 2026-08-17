import * as THREE from 'three';
import {
  standard,
  mesh,
  group,
  mergedMesh,
  roughenSphere,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "Whimsical World" -- a storybook landscape built as a place to PROGRAM things in.
//
// The hero is `carousel()`, and it earns that for a reason beyond being pretty: a carousel
// turns about the VERTICAL, which is the only axis the `rotate` block drives. So the most
// elaborate model in the world is also the one a student can immediately make do something,
// and the program that turns it is four blocks long.
//
// COLOUR IS THE MATERIAL HERE. Everywhere else in this app a palette is chosen to let
// exhibits win against their background; this world has no exhibits, only things that are
// meant to be a pleasure to look at, so the props are saturated and the only restraint is
// on the ground (see the `whimsy` theme note). Every prop takes a `hue` so a layout can
// tune the spread rather than every mushroom being the same red.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

const CANDY = [0xf2545b, 0xf2a541, 0xf7d154, 0x6fcf72, 0x4fc3d9, 0x7a6ff0, 0xe86bb5];
const CREAM = 0xfdf3e0;
const BRASS = 0xd9a441;
const WOOD_WARM = 0xa8763f;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ball(radius, detail = 12) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// A colour from the candy palette, shifted a little so no two calls with different seeds
// come out identical. Eight flat colours across a whole world reads as eight kinds of
// plastic -- the lesson flowerBed() in ParkProps was rebuilt for.
function candy(rng, hue = null) {
  const base = new THREE.Color(hue ?? CANDY[Math.floor(randomIn(rng, 0, CANDY.length))]);
  const hsl = {};
  base.getHSL(hsl);
  base.setHSL(
    (hsl.h + randomIn(rng, -0.03, 0.03) + 1) % 1,
    Math.min(1, hsl.s * randomIn(rng, 0.9, 1.1)),
    Math.min(0.92, hsl.l * randomIn(rng, 0.92, 1.12)),
  );
  return base.getHex();
}

// A scalloped skirt: the wavy hanging edge on a fairground canopy, a mushroom's gills, an
// awning. Built as a ring of small overlapping spheres, which is far cheaper than a real
// scalloped lathe and reads identically from more than a few feet away.
function scallop(parts, { radius, y, count, size, color, squash = 0.7 }) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const s = ball(size, 8);
    s.scale(1, squash, 1);
    s.translate(Math.cos(a) * radius, y, Math.sin(a) * radius);
    parts.push({ geometry: s, color });
  }
}

// ---------------------------------------------------------------------------
// 1. The carousel
// ---------------------------------------------------------------------------

// A carved horse. Small, and there are eight of them, so it is built from a dozen squashed
// spheres rather than swept tubes -- but the SHAPE matters: a horse reads as a horse from
// the arch of its neck and the fact that its legs are not all doing the same thing.
function carouselHorse(parts, { x, z, rotY, body, mane, seed }) {
  const rng = seededRandom(seed);
  const put = (radius, scale, at, color, rot = [0, 0, 0]) => {
    const g = ball(radius, 10);
    const m = new THREE.Matrix4()
      .makeRotationY(rotY)
      .multiply(new THREE.Matrix4().makeTranslation(at[0], at[1], at[2]))
      .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')))
      .multiply(new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]));
    g.applyMatrix4(m);
    g.translate(x, 0, z);
    parts.push({ geometry: g, color });
  };

  // Barrel, chest, hindquarters.
  put(0.62, [0.62, 0.72, 1.25], [0, 2.5, 0], body);
  put(0.5, [0.6, 0.72, 0.8], [0, 2.62, 0.72], body);
  put(0.55, [0.62, 0.8, 0.85], [0, 2.6, -0.72], body);

  // Neck, arched UP and forward -- the single thing that makes it a carousel horse rather
  // than a pony standing still.
  put(0.32, [0.55, 1.05, 0.6], [0, 3.25, 1.05], body, [-0.5, 0, 0]);
  // Head, tipped down at the muzzle.
  put(0.28, [0.5, 0.55, 1.0], [0, 3.85, 1.55], body, [0.45, 0, 0]);
  put(0.16, [0.6, 0.5, 0.8], [0, 3.7, 1.95], body, [0.45, 0, 0]);
  // Ears.
  for (const sx of [-1, 1]) put(0.09, [0.6, 1.4, 0.5], [sx * 0.13, 4.08, 1.42], body);

  // Legs -- front pair reaching forward, back pair tucked, which is the galloping pose
  // every carousel horse is carved in.
  for (const sx of [-1, 1]) {
    put(0.14, [0.7, 1.5, 0.5], [sx * 0.28, 1.85, 0.86], body, [-0.7, 0, 0]);
    put(0.12, [0.7, 1.3, 0.5], [sx * 0.28, 1.1, 1.35], body, [-0.35, 0, 0]);
    put(0.16, [0.7, 1.4, 0.55], [sx * 0.3, 1.85, -0.8], body, [0.75, 0, 0]);
    put(0.12, [0.7, 1.2, 0.5], [sx * 0.3, 1.15, -1.28], body, [0.3, 0, 0]);
  }

  // Mane and tail in the contrast colour -- what carries most of the horse's colour and
  // the reason each one on a real carousel is painted differently.
  for (let i = 0; i < 5; i++) {
    put(0.15, [0.45, 0.7, 0.5], [0, 3.55 - i * 0.16, 1.28 - i * 0.13], mane);
  }
  for (let i = 0; i < 4; i++) {
    put(0.16 - i * 0.02, [0.5, 0.7, 0.6], [0, 2.85 - i * 0.28, -1.35 - i * 0.1], mane, [0.5, 0, 0]);
  }
  // Saddle.
  put(0.34, [0.68, 0.35, 0.75], [0, 3.02, 0.06], mane);
  // A brass pole through it -- the thing that makes it a carousel horse and not a statue.
  const pole = new THREE.CylinderGeometry(0.075, 0.075, 7.6, 8);
  pole.translate(0, 3.8, 0);
  pole.applyMatrix4(new THREE.Matrix4().makeRotationY(rotY));
  pole.translate(x, 0, z);
  parts.push({ geometry: pole, color: BRASS });

  void rng;
}

export function carousel({ radius = 13, horses = 8, seed = 3 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const paint = [];
  const brass = [];
  const lamps = [];

  const DECK_Y = 1.6;
  const ROOF_Y = 9.2;

  // --- Base and deck ------------------------------------------------------
  paint.push({ geometry: new THREE.CylinderGeometry(radius * 1.06, radius * 1.12, 0.9, 32), position: [0, 0.45, 0], color: 0xf0e2c8 });
  paint.push({ geometry: new THREE.CylinderGeometry(radius, radius, 0.7, 32), position: [0, DECK_Y - 0.35, 0], color: 0xdd5a4a });
  // Deck boards, as alternating wedges. A plain disc reads as a table top; the radial
  // divisions are what make it a floor you would stand on.
  for (let i = 0; i < 24; i++) {
    const a0 = (i / 24) * Math.PI * 2;
    const wedge = new THREE.CylinderGeometry(radius * 0.99, radius * 0.99, 0.12, 4, 1, false, a0, Math.PI * 2 / 24);
    wedge.translate(0, DECK_Y + 0.02, 0);
    paint.push({ geometry: wedge, color: i % 2 ? 0xf7e9cf : 0xead6b4 });
  }

  // --- Centre column ------------------------------------------------------
  paint.push({ geometry: new THREE.CylinderGeometry(1.5, 1.7, ROOF_Y - DECK_Y, 16), position: [0, (DECK_Y + ROOF_Y) / 2, 0], color: CREAM });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const stripe = new THREE.BoxGeometry(0.3, ROOF_Y - DECK_Y, 0.3);
    stripe.translate(Math.cos(a) * 1.55, (DECK_Y + ROOF_Y) / 2, Math.sin(a) * 1.55);
    paint.push({ geometry: stripe, color: 0xdd5a4a });
  }

  // --- Canopy -------------------------------------------------------------
  // A shallow cone with a scalloped valance and a finial. The valance is what says
  // fairground; without it a conical roof is a tent.
  const canopy = new THREE.ConeGeometry(radius * 1.12, 4.2, 32);
  canopy.translate(0, ROOF_Y + 2.1, 0);
  paint.push({ geometry: canopy, color: CREAM });
  // Radial stripes on the canopy, alternating candy colours.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const seg = new THREE.ConeGeometry(radius * 1.13, 4.22, 32, 1, true, a, Math.PI * 2 / 32);
    seg.translate(0, ROOF_Y + 2.1, 0);
    paint.push({ geometry: seg, color: i % 2 ? 0xdd5a4a : 0x4fb0d9 });
  }
  scallop(paint, { radius: radius * 1.1, y: ROOF_Y - 0.1, count: 30, size: 0.75, color: 0xf7d154 });
  scallop(paint, { radius: radius * 1.1, y: ROOF_Y - 0.75, count: 30, size: 0.45, color: CREAM });

  // Finial.
  brass.push({ geometry: new THREE.CylinderGeometry(0.28, 0.4, 1.6, 10), position: [0, ROOF_Y + 4.4, 0], color: BRASS });
  brass.push({ geometry: ball(0.75, 14), position: [0, ROOF_Y + 5.5, 0], color: BRASS });
  const spike = new THREE.ConeGeometry(0.3, 2.0, 8);
  spike.translate(0, ROOF_Y + 7.0, 0);
  brass.push({ geometry: spike, color: BRASS });

  // --- Lights round the rim ----------------------------------------------
  // The single most carousel thing there is. Opaque and merged into ONE mesh, not thirty
  // translucent ones -- the New York lamps' lesson.
  const LAMPS = 30;
  for (let i = 0; i < LAMPS; i++) {
    const a = (i / LAMPS) * Math.PI * 2;
    lamps.push({
      geometry: ball(0.3, 8),
      position: [Math.cos(a) * radius * 1.14, ROOF_Y + 0.35, Math.sin(a) * radius * 1.14],
      color: i % 3 === 0 ? 0xfff0b8 : (i % 3 === 1 ? 0xffd0d8 : 0xd8f0ff),
    });
  }

  // --- Horses -------------------------------------------------------------
  const HORSE_R = radius * 0.66;
  for (let i = 0; i < horses; i++) {
    const a = (i / horses) * Math.PI * 2;
    carouselHorse(paint, {
      x: Math.cos(a) * HORSE_R,
      z: Math.sin(a) * HORSE_R,
      // Facing along the circle, which is the way they travel.
      rotY: -a + Math.PI / 2,
      body: i % 2 === 0 ? CREAM : candy(rng),
      mane: candy(rng),
      seed: seed + i,
    });
  }

  g.add(mergedMesh(paint, { color: 0xffffff, roughness: 0.62, ...relief('wood', { seed, repeat: 6, strength: 0.35 }) }));
  g.add(mergedMesh(brass, { color: 0xffffff, roughness: 0.3, metalness: 0.55 }));
  g.add(mergedMesh(lamps, {
    color: 0xffffff, roughness: 0.3,
    emissive: 0xfff0c0, emissiveIntensity: 0.9,
  }));
  return g;
}

// ---------------------------------------------------------------------------
// 2. Storybook scenery
// ---------------------------------------------------------------------------

// A toadstool with a door in it. The cap has to OVERHANG a long way and the gills have to
// be visible from below -- a dome on a post is a lamp, not a mushroom.
export function mushroomHouse({ height = 14, hue = null, seed = 11 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const glow = [];
  const capColor = candy(rng, hue ?? 0xf2545b);
  const stalkR = height * 0.16;
  const capR = height * 0.46;
  const capY = height * 0.66;

  // Stalk, wider at the foot.
  parts.push({ geometry: new THREE.CylinderGeometry(stalkR * 0.86, stalkR * 1.25, capY, 18), position: [0, capY / 2, 0], color: 0xf4ecd8 });

  // Cap: a squashed hemisphere.
  const cap = new THREE.SphereGeometry(capR, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.72, 1);
  cap.translate(0, capY, 0);
  parts.push({ geometry: cap, color: capColor });
  // Underside gills -- radial blades, visible because the cap overhangs.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const gill = new THREE.BoxGeometry(capR * 0.82, 0.12, 0.16);
    gill.rotateY(-a);
    gill.translate(Math.cos(a) * capR * 0.5, capY - 0.1, Math.sin(a) * capR * 0.5);
    parts.push({ geometry: gill, color: 0xe8dcc0 });
  }
  // Spots.
  for (let i = 0; i < 11; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const t = randomIn(rng, 0.25, 0.85);
    const r = capR * Math.sin(t * Math.PI / 2);
    const y = capY + Math.cos(t * Math.PI / 2) * capR * 0.72;
    const spot = ball(capR * randomIn(rng, 0.09, 0.15), 8);
    spot.scale(1, 0.35, 1);
    spot.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    parts.push({ geometry: spot, color: 0xfdf3e0 });
  }

  // Door and windows, cut PROUD of the stalk -- these stalks are solid.
  const door = new THREE.BoxGeometry(stalkR * 0.8, capY * 0.42, 0.3);
  door.translate(0, capY * 0.21, stalkR * 1.05);
  parts.push({ geometry: door, color: WOOD_WARM });
  const arch = new THREE.CylinderGeometry(stalkR * 0.4, stalkR * 0.4, 0.3, 12, 1, false, 0, Math.PI);
  arch.rotateX(Math.PI / 2);
  arch.translate(0, capY * 0.42, stalkR * 1.05);
  parts.push({ geometry: arch, color: WOOD_WARM });
  glow.push({ geometry: ball(stalkR * 0.22, 10), position: [stalkR * 0.75, capY * 0.55, stalkR * 0.8], color: 0xffe9a8 });
  glow.push({ geometry: ball(stalkR * 0.22, 10), position: [-stalkR * 0.75, capY * 0.55, stalkR * 0.8], color: 0xffe9a8 });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.8, ...relief('weave', { seed, repeat: 5, strength: 0.4 }) }));
  g.add(mergedMesh(glow, { color: 0xffffff, roughness: 0.3, emissive: 0xffcf6a, emissiveIntensity: 0.9 }));
  return g;
}

// A lollipop tree: a straight candy-striped trunk under a ball of colour.
export function lollipopTree({ height = 18, hue = null, seed = 21 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const trunkH = height * 0.52;
  const crownR = height * 0.28;

  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.035, height * 0.055, trunkH, 12), position: [0, trunkH / 2, 0], color: WOOD_WARM });
  // A helical stripe up the trunk -- the candy-cane trick, and cheap.
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const band = new THREE.BoxGeometry(height * 0.085, height * 0.022, height * 0.085);
    band.rotateY(t * 5.4);
    band.translate(0, trunkH * (0.06 + t * 0.9), 0);
    parts.push({ geometry: band, color: 0xfdf3e0 });
  }

  // Crown: three overlapping balls at slightly different colours, which reads as foliage
  // where one perfect sphere reads as a balloon.
  const base = candy(rng, hue ?? 0x6fcf72);
  for (let i = 0; i < 3; i++) {
    const b = ball(crownR * randomIn(rng, 0.78, 1.0), 14);
    b.scale(1, randomIn(rng, 0.82, 1.0), 1);
    b.translate(
      randomIn(rng, -crownR * 0.3, crownR * 0.3),
      trunkH + crownR * randomIn(rng, 0.65, 0.95),
      randomIn(rng, -crownR * 0.3, crownR * 0.3),
    );
    parts.push({ geometry: b, color: i === 0 ? base : candy(rng, base) });
  }
  // A few berries.
  for (let i = 0; i < 7; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rr = crownR * randomIn(rng, 0.55, 0.95);
    parts.push({
      geometry: ball(crownR * 0.11, 7),
      position: [Math.cos(a) * rr, trunkH + crownR * randomIn(rng, 0.5, 1.2), Math.sin(a) * rr],
      color: 0xf2545b,
    });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.78 }));
  return g;
}

// A rainbow: seven concentric arcs. Emissive, because a rainbow is light rather than paint
// and a matte one reads as a painted plywood arch.
export function rainbowArch({ span = 60, bands = 7, thickness = 1.5, seed = 31 } = {}) {
  const g = group();
  const parts = [];
  const HUES = [0xf2545b, 0xf28c41, 0xf7d154, 0x6fcf72, 0x4fc3d9, 0x4a63d9, 0x8a5fd9];
  const R = span / 2;
  for (let b = 0; b < bands; b++) {
    const r = R - b * thickness;
    if (r <= 0) continue;
    const arc = new THREE.TorusGeometry(r, thickness * 0.5, 8, 40, Math.PI);
    arc.translate(0, 0, 0);
    parts.push({ geometry: arc, color: HUES[b % HUES.length] });
  }
  const m = mergedMesh(parts, {
    color: 0xffffff, roughness: 0.5,
    emissive: 0xffffff, emissiveIntensity: 0.28,
    transparent: true, opacity: 0.9,
  });
  m.castShadow = false;
  g.add(m);
  void seed;
  return g;
}

// A floating island: a chunk of grassy rock hanging in the air with a waterfall off it.
// `absoluteY` in the layout is what puts it up there -- the builder's origin is still its
// own base, so it can be seated normally if a layout wants it on the ground.
export function floatingIsland({ radius = 12, hue = null, seed = 41 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];

  // The rock: a cone pointing DOWN, roughened. That downward point is the whole idea --
  // a flat-bottomed island looks like a table.
  const rock = new THREE.ConeGeometry(radius, radius * 1.9, 14);
  rock.rotateX(Math.PI);
  roughenSphere(rock, { amount: 0.16, phase: seed });
  rock.translate(0, radius * 0.95, 0);
  parts.push({ geometry: rock, color: 0x8a7358 });

  // Grass cap, overhanging the rock a little.
  const cap = new THREE.CylinderGeometry(radius * 1.04, radius * 0.98, radius * 0.28, 18);
  cap.translate(0, radius * 1.9 - radius * 0.1, 0);
  parts.push({ geometry: cap, color: candy(rng, hue ?? 0x6fcf72) });

  // Tufts and a couple of little rocks on top.
  for (let i = 0; i < 12; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rr = Math.sqrt(randomIn(rng, 0, 1)) * radius * 0.85;
    const tuft = ball(radius * randomIn(rng, 0.07, 0.13), 7);
    tuft.scale(1, randomIn(rng, 0.5, 0.9), 1);
    tuft.translate(Math.cos(a) * rr, radius * 1.9 + radius * 0.06, Math.sin(a) * rr);
    parts.push({ geometry: tuft, color: 0x4f9c3f });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.9, ...relief('stone', { seed, repeat: 4, strength: 0.7 }) }));
  return g;
}

// A hot-air balloon: envelope, basket, ropes. This is one of the things a challenge board
// asks a student to fly, so it is built to read clearly while moving.
export function hotAirBalloon({ height = 22, hue = null, seed = 51 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const envR = height * 0.32;
  const envY = height * 0.62;

  // Envelope: a sphere pulled into a teardrop, with vertical gores in alternating colours.
  const a1 = candy(rng, hue ?? 0xf2545b);
  const a2 = candy(rng, 0x4fc3d9);
  const GORES = 12;
  for (let i = 0; i < GORES; i++) {
    const a0 = (i / GORES) * Math.PI * 2;
    const gore = new THREE.SphereGeometry(envR, 10, 16, a0, Math.PI * 2 / GORES);
    // Pull the bottom in to a neck: scale y and taper by moving the low rings inward.
    const pos = gore.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = (y + envR) / (2 * envR);              // 0 bottom, 1 top
      const pinch = 0.28 + 0.72 * Math.sin(Math.min(1, t * 1.18) * Math.PI * 0.62);
      pos.setX(v, pos.getX(v) * pinch);
      pos.setZ(v, pos.getZ(v) * pinch);
      pos.setY(v, y * 1.25);
    }
    gore.computeVertexNormals();
    gore.translate(0, envY, 0);
    parts.push({ geometry: gore, color: i % 2 ? a1 : a2 });
  }

  // Basket.
  const basketY = height * 0.1;
  parts.push({ geometry: new THREE.BoxGeometry(height * 0.16, height * 0.14, height * 0.16), position: [0, basketY, 0], color: 0xb8863f });
  parts.push({ geometry: new THREE.BoxGeometry(height * 0.175, height * 0.02, height * 0.175), position: [0, basketY + height * 0.07, 0], color: 0x8a6330 });
  // Ropes from the basket corners to the envelope's neck.
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const from = new THREE.Vector3(dx * height * 0.08, basketY + height * 0.07, dz * height * 0.08);
    const to = new THREE.Vector3(dx * height * 0.05, envY - envR * 0.95, dz * height * 0.05);
    const dir = to.clone().sub(from);
    const rope = new THREE.CylinderGeometry(0.06, 0.06, dir.length(), 5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    rope.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
    const mid = from.clone().add(to).multiplyScalar(0.5);
    rope.translate(mid.x, mid.y, mid.z);
    parts.push({ geometry: rope, color: 0x6b5a3f });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.72 }));
  return g;
}

// A wind-up toy: the thing a patrol challenge sends walking. A round body, a key in its
// back, big feet, and a face -- it needs a FRONT, because the whole point of a patrol
// program is watching it turn corners.
export function windUpToy({ height = 6, hue = null, seed = 61 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const face = [];
  const body = candy(rng, hue ?? 0x4fc3d9);
  const bodyR = height * 0.3;
  const bodyY = height * 0.48;

  parts.push({ geometry: (() => { const b = ball(bodyR, 16); b.scale(1, 1.12, 0.95); return b; })(), position: [0, bodyY, 0], color: body });
  // Head.
  parts.push({ geometry: ball(bodyR * 0.62, 14), position: [0, bodyY + bodyR * 1.2, 0], color: body });
  // Feet -- big, and set forward, which is what makes it look like it walks.
  for (const sx of [-1, 1]) {
    const foot = ball(bodyR * 0.32, 10);
    foot.scale(1, 0.6, 1.5);
    foot.translate(sx * bodyR * 0.5, bodyR * 0.22, bodyR * 0.35);
    parts.push({ geometry: foot, color: 0xf2a541 });
  }
  // Arms.
  for (const sx of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(bodyR * 0.11, bodyR * 0.09, bodyR * 1.0, 7);
    arm.rotateZ(sx * 0.9);
    arm.translate(sx * bodyR * 0.85, bodyY + bodyR * 0.3, 0);
    parts.push({ geometry: arm, color: 0xf2a541 });
  }
  // The winding key, on its BACK (-Z), so the front is unambiguous.
  const key = new THREE.TorusGeometry(bodyR * 0.3, bodyR * 0.07, 6, 14);
  key.translate(0, bodyY + bodyR * 0.35, -bodyR * 1.15);
  parts.push({ geometry: key, color: BRASS });
  parts.push({ geometry: new THREE.CylinderGeometry(bodyR * 0.07, bodyR * 0.07, bodyR * 0.5, 6), position: [0, bodyY + bodyR * 0.35, -bodyR * 0.95], color: BRASS });

  // Face on +Z.
  for (const sx of [-1, 1]) {
    face.push({ geometry: ball(bodyR * 0.12, 8), position: [sx * bodyR * 0.24, bodyY + bodyR * 1.3, bodyR * 0.55], color: 0x2b2b2b });
  }
  face.push({ geometry: (() => { const s = new THREE.TorusGeometry(bodyR * 0.2, bodyR * 0.045, 6, 12, Math.PI); s.rotateZ(Math.PI); return s; })(), position: [0, bodyY + bodyR * 1.12, bodyR * 0.56], color: 0x2b2b2b });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.55, metalness: 0.12 }));
  g.add(mergedMesh(face, { color: 0xffffff, roughness: 0.4 }));
  return g;
}

// A giant flower, the kind you could sit in. Petals as flattened spheres round a domed
// centre -- and a real stem with leaves, because a head on a stick is a lollipop.
export function giantFlower({ height = 12, petals = 8, hue = null, seed = 71 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const petalColor = candy(rng, hue ?? 0xe86bb5);
  const headR = height * 0.3;

  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.03, height * 0.045, height * 0.86, 8), position: [0, height * 0.43, 0], color: 0x4f9c3f });
  for (const sx of [-1, 1]) {
    const leaf = ball(height * 0.13, 9);
    leaf.scale(1.5, 0.16, 0.75);
    leaf.rotateZ(sx * 0.5);
    leaf.rotateY(randomIn(rng, -0.4, 0.4));
    leaf.translate(sx * height * 0.13, height * randomIn(rng, 0.3, 0.5), 0);
    parts.push({ geometry: leaf, color: 0x3f7a34 });
  }

  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const p = ball(headR * 0.62, 10);
    p.scale(1, 0.22, 1.5);
    p.rotateX(-0.35);
    p.rotateY(-a);
    p.translate(Math.cos(a) * headR * 0.72, height * 0.9, Math.sin(a) * headR * 0.72);
    parts.push({ geometry: p, color: i % 2 ? petalColor : candy(rng, petalColor) });
  }
  const centre = ball(headR * 0.46, 14);
  centre.scale(1, 0.55, 1);
  centre.translate(0, height * 0.94, 0);
  parts.push({ geometry: centre, color: 0xf7d154 });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.72 }));
  return g;
}

// A gumdrop boulder -- translucent-looking sugary rock, for scattering.
export function gumdropRock({ radius = 3.5, hue = null, seed = 81 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const geo = ball(radius, 14);
  geo.scale(1, randomIn(rng, 0.7, 0.95), 1);
  roughenSphere(geo, { amount: 0.1, phase: seed });
  geo.translate(0, radius * 0.62, 0);
  g.add(mesh(geo, standard({
    color: candy(rng, hue ?? 0x7a6ff0),
    roughness: 0.35,
    metalness: 0.05,
    emissive: 0x221133,
    emissiveIntensity: 0.18,
  })));
  return g;
}

// A cloud, for hanging in the sky over the world. Opaque and merged; a soft transparent
// cloud costs far more and reads no better at this size.
export function cloudPuff({ width = 16, hue = 0xfdfcff, seed = 91 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const b = ball(width * randomIn(rng, 0.2, 0.34), 12);
    b.scale(1, randomIn(rng, 0.55, 0.8), 1);
    b.translate(
      randomIn(rng, -width * 0.42, width * 0.42),
      randomIn(rng, -width * 0.05, width * 0.09),
      randomIn(rng, -width * 0.2, width * 0.2),
    );
    parts.push({ geometry: b, color: hue });
  }
  const m = mergedMesh(parts, { color: 0xffffff, roughness: 1, emissive: 0x8899bb, emissiveIntensity: 0.16 });
  m.castShadow = false;
  g.add(m);
  return g;
}

// A twisting striped tower, the kind that leans slightly and has a flag on top.
export function spiralTower({ height = 30, hue = null, seed = 101 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const flag = [];
  const c1 = candy(rng, hue ?? 0x7a6ff0);
  const c2 = 0xfdf3e0;

  const DRUMS = 9;
  for (let i = 0; i < DRUMS; i++) {
    const t = i / DRUMS;
    const r = height * (0.12 - t * 0.055);
    const h = height * 0.1;
    const drum = new THREE.CylinderGeometry(r * 0.92, r, h, 14);
    // Each drum leans a little more than the one below, so the tower curves.
    drum.rotateZ(t * 0.1);
    drum.translate(Math.sin(t * 1.6) * height * 0.05, h * (i + 0.5), 0);
    parts.push({ geometry: drum, color: i % 2 ? c1 : c2 });
  }
  // Conical roof + flag.
  const roof = new THREE.ConeGeometry(height * 0.075, height * 0.16, 12);
  roof.translate(Math.sin(1.6) * height * 0.05, height * 0.9 + height * 0.08, 0);
  parts.push({ geometry: roof, color: c1 });
  const mast = new THREE.CylinderGeometry(0.12, 0.12, height * 0.14, 6);
  mast.translate(Math.sin(1.6) * height * 0.05, height * 1.05, 0);
  parts.push({ geometry: mast, color: 0x8a6330 });
  const pennant = new THREE.BoxGeometry(height * 0.11, height * 0.05, 0.1);
  pennant.translate(Math.sin(1.6) * height * 0.05 + height * 0.055, height * 1.09, 0);
  flag.push({ geometry: pennant, color: 0xf2545b });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.7 }));
  g.add(mergedMesh(flag, { color: 0xffffff, roughness: 0.6, emissive: 0x551111, emissiveIntensity: 0.25 }));
  return g;
}

// Stepping stones across the grass -- a path that leads somewhere, which is what stops a
// pretty field from being a place with no route through it.
export function steppingStones({ count = 9, spacing = 5, hue = null, seed = 111 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const stone = new THREE.CylinderGeometry(randomIn(rng, 1.5, 2.2), randomIn(rng, 1.6, 2.3), 0.4, 9);
    stone.rotateY(randomIn(rng, 0, Math.PI));
    stone.translate(randomIn(rng, -1.4, 1.4), 0.2, (i - count / 2) * spacing);
    parts.push({ geometry: stone, color: candy(rng, hue ?? 0x4fc3d9) });
  }
  const m = mergedMesh(parts, { color: 0xffffff, roughness: 0.7, ...relief('stone', { seed, repeat: 3, strength: 0.5 }) });
  m.castShadow = false;
  g.add(m);
  return g;
}
