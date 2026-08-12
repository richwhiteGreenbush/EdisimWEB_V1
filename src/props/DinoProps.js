import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergedMesh,
  canvasTexture,
  signPanel,
  taperedTube,
  seededRandom,
  randomIn,
  roughenSphere,
} from '../PropKit.js';
import { moonRocks } from './MoonProps.js';
import { dustDevil } from './MarsProps.js';

// "Dinosaur Island" -- the very end of the Cretaceous, about 66 million years ago, on
// the kind of warm coastal floodplain the Hell Creek fossil beds record. Everything
// alive here really did share that time and place with Tyrannosaurus, which is the
// quiet lesson underneath the spectacle: the famous dinosaurs of the toy box mostly
// did NOT live together. Stegosaurus was longer dead by then than T. rex is from us.
//
// Sizes are real against the 5ft student. T. rex stands 13ft at the hip and runs 40ft
// nose to tail; Triceratops is 10ft at the shoulder; a Pachycephalosaurus is only
// about head-and-shoulders taller than the student looking at it.

const BONE = 0xe4dcc2;
const TOOTH = 0xf0e9d6;
const EYE = 0x171512;

// ---------------------------------------------------------------------------
// Body-building helpers
// ---------------------------------------------------------------------------

// One tapered limb/neck/tail/torso segment, ready for mergeColored(). `s` scales the
// whole thing about the animal's origin, which is how a builder offers a size option
// without ever touching Object3D.scale -- WorldStore.applyTransform() REPLACES an
// object's scale from the record, so a builder that scaled its own Group would have
// that silently thrown away on the next reload.
function tube(points, radii, color, s = 1, options) {
  return {
    geometry: taperedTube(
      points.map(([x, y, z]) => [x * s, y * s, z * s]),
      radii.map((r) => r * s),
      options
    ),
    color,
  };
}

// Scales a geometry about a chosen point rather than the world origin. Scaling a skull
// in place needs this: a plain geometry.scale() also multiplies its position, so a head
// 14ft up the animal quietly relocates to 17ft when you make it 20% deeper.
function scaleAbout(geometry, [cx, cy, cz], [sx, sy, sz]) {
  geometry.translate(-cx, -cy, -cz);
  geometry.scale(sx, sy, sz);
  geometry.translate(cx, cy, cz);
  return geometry;
}

function blob(radius, color, [x, y, z], s = 1, detail = 10) {
  return {
    geometry: new THREE.SphereGeometry(radius * s, detail, Math.max(6, detail >> 1)),
    position: [x * s, y * s, z * s],
    color,
  };
}

// A cone standing on the surface it is attached to: teeth, horns, spikes, claws.
function spike(length, radius, color, [x, y, z], rotation, s = 1) {
  return {
    geometry: new THREE.ConeGeometry(radius * s, length * s, 7),
    rotation,
    position: [x * s, y * s, z * s],
    color,
  };
}

// Every animal is ONE merged, vertex-coloured, flat-shaded mesh. Flat shading is doing
// real work: it reads as scaled hide on a low-poly form, and it hides the seams where a
// dozen separately-swept tubes intersect. side: DoubleSide is for the pterosaur's
// membrane sheets and is harmless on the rest.
function creature(parts) {
  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true, side: THREE.DoubleSide }));
}

// ---------------------------------------------------------------------------
// Tyrannosaurus rex
// ---------------------------------------------------------------------------

// Built in the modern posture: spine roughly horizontal, tail held clear of the ground
// as a counterweight to the head. The upright, tail-dragging "Godzilla" pose museums
// used until the 1970s would have dislocated the animal's hips.
export function tyrannosaurus({ scale = 1, back = 0x7d7c53, belly = 0xc6ba8e, seed = 3 } = {}) {
  const s = scale;
  const parts = [];

  // Torso, neck, skull, jaw.
  parts.push(tube([[-3.5, 12.4, 0], [0, 13.1, 0], [4.5, 13.2, 0], [9, 12.5, 0]], [2.3, 3.0, 2.9, 2.1], back, s));
  parts.push(tube([[-3, 10.6, 0], [1, 10.7, 0], [6, 10.6, 0], [9, 11.0, 0]], [1.5, 1.9, 1.8, 1.3], belly, s));
  parts.push(tube([[9, 12.5, 0], [11.4, 13.6, 0], [13.4, 14.2, 0]], [2.0, 1.5, 1.15], back, s, { tubularSegments: 14 }));

  const skull = tube([[13.4, 14.3, 0], [16.2, 14.2, 0], [18.9, 13.7, 0]], [1.45, 1.35, 0.5], back, s, { tubularSegments: 14 });
  scaleAbout(skull.geometry, [16 * s, 14 * s, 0], [1, 1.28, 0.86]);
  parts.push(skull);

  const jaw = tube([[13.6, 12.8, 0], [16.2, 12.7, 0], [18.6, 12.6, 0]], [0.85, 0.75, 0.35], back, s, { tubularSegments: 12 });
  scaleAbout(jaw.geometry, [16 * s, 12.7 * s, 0], [1, 0.9, 0.8]);
  parts.push(jaw);

  // Teeth. The big ones are up front, and the largest T. rex tooth found is about the
  // size of a banana -- which is exactly the comparison the placard nearby makes.
  for (let i = 0; i < 9; i++) {
    const x = 14.4 + i * 0.5;
    const length = 0.85 - i * 0.045;
    for (const side of [-1, 1]) {
      parts.push(spike(length, 0.17, TOOTH, [x, 13.35, side * 0.72], [Math.PI, 0, 0], s));
      parts.push(spike(length * 0.85, 0.15, TOOTH, [x, 13.05, side * 0.6], [0, 0, 0], s));
    }
  }

  // Eyes, set forward on the skull -- T. rex had overlapping fields of view, which is
  // how a hunter judges distance.
  for (const side of [-1, 1]) parts.push(blob(0.34, EYE, [16.9, 15.0, side * 1.0], s, 8));
  for (const side of [-1, 1]) parts.push(blob(0.5, back, [16.5, 15.5, side * 0.95], s, 8));

  // Tail: long, deep at the base, tapering to a whip. It is the counterweight.
  parts.push(
    tube(
      [[-3.5, 12.4, 0], [-8, 12.5, 0], [-13, 11.7, 0], [-18, 10.3, 0], [-22.5, 9.1, 0]],
      [2.3, 1.75, 1.1, 0.6, 0.16],
      back,
      s
    )
  );

  // Legs. Digitigrade -- the animal walks on its toes, and what looks like a backwards
  // knee halfway up is really its ankle.
  for (const side of [-1, 1]) {
    const z = side * 2.5;
    parts.push(tube([[0.2, 12.2, z * 0.95], [0.6, 8.6, z * 1.15]], [2.1, 1.2], back, s, { tubularSegments: 10 }));
    parts.push(tube([[0.6, 8.6, z * 1.15], [-0.9, 4.8, z * 1.15]], [1.15, 0.62], back, s, { tubularSegments: 10 }));
    parts.push(tube([[-0.9, 4.8, z * 1.15], [0.5, 1.35, z * 1.15]], [0.6, 0.42], back, s, { tubularSegments: 8 }));
    // Three forward toes plus the little reversed hallux, each with a claw.
    for (const spread of [-0.75, 0, 0.75]) {
      parts.push(
        tube([[0.5, 1.0, z * 1.15], [1.9, 0.42, z * 1.15 + spread]], [0.42, 0.24], back, s, { tubularSegments: 6 })
      );
      parts.push(spike(0.7, 0.16, BONE, [2.4, 0.3, z * 1.15 + spread * 1.25], [0, 0, -Math.PI / 2 - 0.3], s));
    }
    parts.push(tube([[0.4, 1.1, z * 1.15], [-0.5, 0.5, z * 1.15]], [0.3, 0.18], back, s, { tubularSegments: 6 }));

    // The famous arms. Two fingers, and shorter than a human's -- but they could curl
    // about 400 pounds, so "useless" is the one thing they were not.
    parts.push(tube([[8.3, 11.2, side * 2.0], [9.2, 9.9, side * 2.4]], [0.62, 0.42], back, s, { tubularSegments: 6 }));
    parts.push(tube([[9.2, 9.9, side * 2.4], [10.4, 9.2, side * 2.3]], [0.4, 0.28], back, s, { tubularSegments: 6 }));
    for (const finger of [-0.22, 0.22]) {
      parts.push(spike(0.9, 0.13, BONE, [11.0, 9.0, side * 2.3 + finger], [0, 0, -Math.PI / 2 - 0.5], s));
    }
  }

  return creature(parts);
}

// ---------------------------------------------------------------------------
// Triceratops
// ---------------------------------------------------------------------------

// 10ft at the shoulder, 28ft long, and the skull alone is over 7ft -- one of the
// largest heads any land animal has ever carried.
export function triceratops({ scale = 1, hide = 0x93977a, frill = 0xa07f56, seed = 5 } = {}) {
  const s = scale;
  const parts = [];

  parts.push(tube([[-8.5, 8.6, 0], [-3.5, 9.3, 0], [1.5, 9.5, 0], [6, 9.0, 0]], [2.3, 3.4, 3.5, 3.0], hide, s));
  parts.push(tube([[-7, 6.6, 0], [0, 6.4, 0], [5.5, 6.9, 0]], [2.0, 2.6, 2.2], 0xa2a084, s));
  parts.push(tube([[6, 9.0, 0], [8.4, 8.7, 0]], [2.7, 2.3], hide, s, { tubularSegments: 8 }));

  // Skull and beak. The beak is a parrot-like shear, not a chewing mouth.
  const skull = tube([[8.4, 8.7, 0], [11, 8.3, 0], [13.6, 7.4, 0]], [2.1, 1.55, 0.6], hide, s, { tubularSegments: 14 });
  scaleAbout(skull.geometry, [11 * s, 8.3 * s, 0], [1, 1.15, 0.9]);
  parts.push(skull);
  parts.push(spike(1.7, 0.75, BONE, [14.1, 7.0, 0], [0, 0, -Math.PI / 2 - 0.35], s));

  // The frill: a disc standing behind the skull. A cylinder's axis is +Y, so rotating
  // it 90 degrees about Z lays the disc into the YZ plane, facing along the animal.
  // Sized and seated so the whole animal tops out around 14ft with its head up. Set any
  // higher -- the first attempt had the frill centred at 11.4ft with a 4.7ft radius --
  // and Triceratops ends up taller than it is at the shoulder by half again, which
  // wrecks the one comparison the world is making against a 5ft student.
  const frillRadius = 4.0;
  const frillGeometry = new THREE.CylinderGeometry(frillRadius, frillRadius, 0.5, 24);
  frillGeometry.rotateZ(Math.PI / 2);
  scaleAbout(frillGeometry, [0, 0, 0], [1, 1.18, 0.92]);
  parts.push({ geometry: frillGeometry, rotation: [0, 0, -0.42], position: [7.3 * s, 10.2 * s, 0], color: frill });
  // Epoccipitals -- the scalloped bumps around the rim.
  for (let i = 0; i < 11; i++) {
    const angle = -1.15 + (i / 10) * 2.3;
    parts.push(
      spike(
        0.85,
        0.32,
        BONE,
        [7.3 + Math.sin(angle) * 0.3, 10.2 + Math.cos(angle) * frillRadius * 1.12, Math.sin(angle) * frillRadius * 0.95],
        [angle, 0, -0.42],
        s
      )
    );
  }

  // Three horns: two long brow horns and a short nose horn.
  for (const side of [-1, 1]) {
    parts.push(spike(3.4, 0.5, BONE, [11.6, 10.1, side * 1.25], [0.15, 0, -0.6], s));
  }
  parts.push(spike(1.4, 0.42, BONE, [12.9, 8.6, 0], [0, 0, -0.25], s));

  // Four columnar legs. The front pair are shorter and set slightly wider.
  for (const side of [-1, 1]) {
    parts.push(tube([[4.6, 8.2, side * 2.6], [5.0, 4.4, side * 3.1], [4.6, 0.9, side * 3.1]], [2.0, 1.15, 0.95], hide, s, { tubularSegments: 12 }));
    parts.push(blob(1.15, hide, [4.6, 0.6, side * 3.1], s, 8));
    parts.push(tube([[-5.2, 8.4, side * 2.7], [-5.6, 4.6, side * 3.0], [-5.2, 1.0, side * 3.0]], [2.2, 1.25, 1.0], hide, s, { tubularSegments: 12 }));
    parts.push(blob(1.2, hide, [-5.2, 0.65, side * 3.0], s, 8));
  }

  parts.push(tube([[-8.5, 8.6, 0], [-11.5, 8.0, 0], [-14.5, 7.0, 0]], [2.2, 1.2, 0.28], hide, s, { tubularSegments: 12 }));
  for (const side of [-1, 1]) parts.push(blob(0.3, EYE, [11.3, 9.2, side * 1.85], s, 8));

  return creature(parts);
}

// ---------------------------------------------------------------------------
// Ankylosaurus
// ---------------------------------------------------------------------------

// A living tank: 20ft long but only 5.5ft tall, so it is one of the few animals here a
// student can look over the top of. The club on the end of the tail was solid bone.
export function ankylosaurus({ scale = 1, hide = 0x847768, armor = 0x9c9280, seed = 7 } = {}) {
  const s = scale;
  const rng = seededRandom(seed);
  const parts = [];

  // Squashed hard and widened: the whole point of this animal is that it is one of the
  // few here a student can see over the top of, so its back has to sit near 5.5ft.
  const body = tube([[-6.5, 3.2, 0], [-2, 3.6, 0], [2.5, 3.6, 0], [6.5, 3.0, 0]], [2.2, 2.9, 2.9, 2.0], hide, s);
  scaleAbout(body.geometry, [0, 3.3 * s, 0], [1, 0.78, 1.45]);
  parts.push(body);

  // Head: a low wide wedge with a horn at each rear corner.
  const head = tube([[6.5, 3.3, 0], [8.6, 3.1, 0], [10.2, 2.8, 0]], [2.0, 1.7, 1.1], hide, s, { tubularSegments: 10 });
  scaleAbout(head.geometry, [8.4 * s, 3.1 * s, 0], [1, 0.8, 1.25]);
  parts.push(head);
  for (const side of [-1, 1]) {
    parts.push(spike(1.5, 0.45, armor, [7.0, 3.4, side * 2.2], [0.5, 0, -side * 0.9], s));
    parts.push(blob(0.26, EYE, [9.3, 3.4, side * 1.7], s, 8));
  }

  // Osteoderm armour: paired rows of bony plates down the back, and a fringe of spikes
  // along each flank. Randomised through seededRandom so a reloaded world rebuilds the
  // same animal rather than reshuffling every scute.
  for (let i = 0; i < 9; i++) {
    const x = -6 + i * 1.5;
    const t = i / 8;
    const width = 3.9 - Math.abs(t - 0.45) * 2.4;
    for (const side of [-1, 1]) {
      parts.push(spike(randomIn(rng, 0.6, 0.9), 0.5, armor, [x, 4.2 - Math.abs(t - 0.5) * 0.8, side * width * 0.32], [0, 0, 0], s));
      parts.push(spike(randomIn(rng, 1.0, 1.5), 0.42, armor, [x, 3.1, side * width], [0, 0, -side * 1.25], s));
    }
  }

  // Tail and club.
  parts.push(tube([[-6.5, 3.1, 0], [-9.6, 3.2, 0], [-12.6, 3.0, 0]], [2.0, 1.1, 0.7], hide, s, { tubularSegments: 12 }));
  const club = roughenSphere(new THREE.IcosahedronGeometry(1.45 * s, 1), { amount: 0.3, flatten: 0.85, phase: 1.1 });
  parts.push({ geometry: club, position: [-13.8 * s, 2.9 * s, 0], color: armor });
  for (const side of [-1, 1]) parts.push(spike(0.8, 0.35, armor, [-13.8, 2.9, side * 1.35], [0, 0, -side * 1.57], s));

  // Four short stumpy legs.
  for (const side of [-1, 1]) {
    for (const x of [4.0, -3.8]) {
      parts.push(tube([[x, 3.0, side * 2.6], [x, 0.8, side * 2.9]], [1.4, 1.0], hide, s, { tubularSegments: 8 }));
      parts.push(blob(1.0, hide, [x, 0.55, side * 2.9], s, 8));
    }
  }

  return creature(parts);
}

// ---------------------------------------------------------------------------
// Edmontosaurus
// ---------------------------------------------------------------------------

// The duck-billed plant-eater T. rex actually ate: Edmontosaurus fossils have been
// found with healed T. rex bite marks, which is how we know some of them got away.
// Browsing on all fours here -- these animals could rear up on two legs to run.
export function edmontosaurus({ scale = 1, hide = 0xa89873, stripe = 0x7a6b45, seed = 11 } = {}) {
  const s = scale;
  const parts = [];

  parts.push(tube([[-7, 9.4, 0], [-2, 10.4, 0], [3, 10.4, 0], [7.5, 9.4, 0]], [2.3, 3.1, 3.0, 2.1], hide, s));
  parts.push(tube([[-6, 7.6, 0], [0, 7.6, 0], [6, 8.0, 0]], [1.6, 2.1, 1.6], 0xc4b68a, s));

  // Long low neck down to the bill -- a browser's reach, not a hunter's strike.
  parts.push(tube([[7.5, 9.4, 0], [10.5, 9.0, 0], [13.2, 7.6, 0]], [2.0, 1.4, 1.0], hide, s, { tubularSegments: 14 }));
  const bill = tube([[13.2, 7.6, 0], [15.2, 6.8, 0], [16.8, 6.4, 0]], [1.1, 0.95, 0.75], hide, s, { tubularSegments: 10 });
  scaleAbout(bill.geometry, [15.5 * s, 6.9 * s, 0], [1, 0.55, 1.5]);
  parts.push(bill);
  for (const side of [-1, 1]) parts.push(blob(0.28, EYE, [13.4, 8.2, side * 1.15], s, 8));

  // Deep tail, flattened side to side -- it counterbalances the front half.
  const tail = tube([[-7, 9.4, 0], [-11.5, 9.2, 0], [-16, 8.4, 0], [-20, 7.6, 0]], [2.3, 1.8, 1.0, 0.2], hide, s);
  scaleAbout(tail.geometry, [-13 * s, 9 * s, 0], [1, 1.25, 0.72]);
  parts.push(tail);

  // A dark stripe down the flank. Skin impressions survive for this animal, so we know
  // the scale pattern -- though not, unfortunately, the colour.
  parts.push(tube([[-9, 10.6, 0], [-2, 11.9, 0], [4, 11.8, 0], [9, 10.2, 0]], [0.45, 0.5, 0.5, 0.35], stripe, s));

  for (const side of [-1, 1]) {
    parts.push(tube([[-3.2, 9.6, side * 2.4], [-3.0, 5.6, side * 2.8], [-3.4, 1.3, side * 2.8]], [2.1, 1.2, 0.8], hide, s, { tubularSegments: 12 }));
    parts.push(blob(0.95, hide, [-3.0, 0.6, side * 2.8], s, 8));
    parts.push(tube([[5.0, 8.8, side * 2.2], [5.6, 5.4, side * 2.5], [5.2, 1.0, side * 2.5]], [1.3, 0.8, 0.6], hide, s, { tubularSegments: 12 }));
    parts.push(blob(0.75, hide, [5.4, 0.5, side * 2.5], s, 8));
  }

  return creature(parts);
}

// ---------------------------------------------------------------------------
// Pachycephalosaurus
// ---------------------------------------------------------------------------

// Only about 6ft at the hip, so this one is roughly eye-to-eye with a student -- which
// is exactly why it is worth having. The skull roof is up to 10 INCHES of solid bone.
export function pachycephalosaurus({ scale = 1, hide = 0x9c7c53, dome = 0xd0b98b } = {}) {
  const s = scale;
  const parts = [];

  parts.push(tube([[-2.5, 5.6, 0], [0.5, 6.0, 0], [3.5, 5.6, 0]], [1.1, 1.5, 1.1], hide, s));
  parts.push(tube([[3.5, 5.6, 0], [5.2, 6.3, 0], [6.6, 6.5, 0]], [1.0, 0.8, 0.65], hide, s, { tubularSegments: 10 }));

  const skull = tube([[6.6, 6.5, 0], [7.9, 6.4, 0], [9.0, 6.0, 0]], [0.75, 0.62, 0.3], hide, s, { tubularSegments: 10 });
  parts.push(skull);
  parts.push(blob(0.95, dome, [7.2, 6.9, 0], s, 12));
  // Bony knobs ringing the back of the dome.
  for (let i = 0; i < 7; i++) {
    const angle = -1.2 + (i / 6) * 2.4;
    parts.push(spike(0.35, 0.16, dome, [6.5, 6.7 + Math.cos(angle) * 0.75, Math.sin(angle) * 0.8], [angle, 0, 0.5], s));
  }
  for (const side of [-1, 1]) parts.push(blob(0.2, EYE, [8.1, 6.4, side * 0.55], s, 8));

  parts.push(tube([[-2.5, 5.6, 0], [-6, 5.4, 0], [-9.5, 4.8, 0]], [1.1, 0.7, 0.12], hide, s, { tubularSegments: 12 }));

  for (const side of [-1, 1]) {
    parts.push(tube([[0.2, 5.2, side * 1.2], [0.5, 3.2, side * 1.4], [-0.2, 1.5, side * 1.4], [0.6, 0.3, side * 1.4]], [1.0, 0.55, 0.35, 0.28], hide, s, { tubularSegments: 12 }));
    parts.push(tube([[3.2, 5.2, side * 1.0], [4.0, 3.9, side * 1.2]], [0.35, 0.22], hide, s, { tubularSegments: 6 }));
  }

  return creature(parts);
}

// ---------------------------------------------------------------------------
// Quetzalcoatlus
// ---------------------------------------------------------------------------

// A pterosaur, NOT a dinosaur -- a distinction the placard under it makes, because it
// is the single most common mix-up in the room. Wingspan about 33ft, which is wider
// than a small plane, and it walked on all fours like a giant folded umbrella.
//
// The wing membranes are flat ShapeGeometry sheets: a membrane has no thickness, and
// building one out of tubes would give it the look of a inflatable pool toy.
export function quetzalcoatlus({ scale = 1, hide = 0xd6cfbe, wing = 0x9d8f7a } = {}) {
  const s = scale;
  const parts = [];

  parts.push(tube([[-2.2, 0, 0], [0, 0.3, 0], [2.4, 0.1, 0]], [0.9, 1.5, 1.1], hide, s, { tubularSegments: 12 }));
  parts.push(tube([[2.4, 0.1, 0], [4.6, 1.0, 0], [6.4, 1.4, 0]], [0.95, 0.7, 0.55], hide, s, { tubularSegments: 12 }));
  parts.push(tube([[6.4, 1.4, 0], [9.5, 1.2, 0], [12.5, 0.5, 0]], [0.6, 0.42, 0.12], hide, s, { tubularSegments: 12 }));
  parts.push(blob(0.75, hide, [6.6, 1.7, 0], s, 10));
  // Head crest.
  const crest = new THREE.CylinderGeometry(1.5 * s, 0.3 * s, 0.16 * s, 3);
  crest.rotateZ(Math.PI / 2);
  parts.push({ geometry: crest, rotation: [Math.PI / 2, 0, 0.5], position: [6.9 * s, 2.6 * s, 0], color: hide });
  for (const side of [-1, 1]) parts.push(blob(0.2, EYE, [6.9, 1.9, side * 0.5], s, 8));

  for (const side of [-1, 1]) {
    // Leading edge: upper arm, forearm, then the single enormous wing finger.
    parts.push(tube([[1.4, 0.5, side * 1.0], [0.4, 1.0, side * 5.5]], [0.55, 0.4], hide, s, { tubularSegments: 6 }));
    parts.push(tube([[0.4, 1.0, side * 5.5], [1.0, 1.2, side * 10.5]], [0.4, 0.3], hide, s, { tubularSegments: 6 }));
    parts.push(tube([[1.0, 1.2, side * 10.5], [-1.5, 0.8, side * 16.5]], [0.3, 0.08], hide, s, { tubularSegments: 8 }));

    // The membrane, as a flat polygon from the shoulder out to the tip and back to the
    // ankle. Drawn in XY, then laid down into the horizontal plane.
    const shape = new THREE.Shape();
    shape.moveTo(1.4, 0.9);
    shape.lineTo(0.4, side * 5.5 * 0.999);
    shape.lineTo(1.0, side * 10.5);
    shape.lineTo(-1.5, side * 16.5);
    shape.lineTo(-3.4, side * 9.0);
    shape.lineTo(-2.6, side * 1.6);
    shape.closePath();
    const membrane = new THREE.ShapeGeometry(shape);
    membrane.rotateX(-Math.PI / 2);
    membrane.scale(s, s, s);
    membrane.translate(0, 0.9 * s, 0);
    parts.push({ geometry: membrane, color: wing });

    parts.push(tube([[-2.4, 0.2, side * 1.0], [-3.2, -0.6, side * 1.8]], [0.32, 0.2], hide, s, { tubularSegments: 6 }));
  }

  return creature(parts);
}

// ---------------------------------------------------------------------------
// A nest
// ---------------------------------------------------------------------------

// Dinosaurs built nests, sat on them, and looked after what hatched. That behaviour is
// one of the strongest links between them and the birds outside the window.
export function dinoNest({ radius = 4.5, eggs = 7, seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  // Rim of scraped earth and trampled plant matter.
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2;
    parts.push({
      geometry: new THREE.SphereGeometry(randomIn(rng, 0.55, 0.85), 8, 6),
      position: [Math.cos(angle) * radius, randomIn(rng, 0.25, 0.5), Math.sin(angle) * radius],
      color: [0x4b3a26, 0x5c4a30, 0x3f3120][Math.floor(rng() * 3)],
    });
  }
  parts.push({
    geometry: new THREE.CylinderGeometry(radius * 0.95, radius * 1.05, 0.3, 24),
    position: [0, 0.15, 0],
    color: 0x4a3b28,
  });

  const shell = 0xd9cdae;
  for (let i = 0; i < eggs; i++) {
    const angle = (i / eggs) * Math.PI * 2 + 0.4;
    const distance = radius * randomIn(rng, 0.25, 0.6);
    const egg = new THREE.SphereGeometry(0.85, 12, 9);
    egg.scale(1, 1.45, 1);
    parts.push({
      geometry: egg,
      rotation: [randomIn(rng, -0.5, 0.5), 0, randomIn(rng, -0.5, 0.5)],
      position: [Math.cos(angle) * distance, 0.95, Math.sin(angle) * distance],
      color: shell,
    });
  }

  const g = group(mergedMesh(parts, { roughness: 0.95, flatShading: true }));

  // One egg has hatched. The hatchling is a quarter-scale animal, which is a size
  // comparison a student gets instantly by standing next to both.
  const hatchling = tyrannosaurus({ scale: 0.11 });
  hatchling.position.set(radius * 0.15, 0.6, -radius * 0.3);
  hatchling.rotation.y = 2.1;
  g.add(hatchling);

  return g;
}

// ---------------------------------------------------------------------------
// Cretaceous flora
// ---------------------------------------------------------------------------

// One drooping frond, built as a flattened tapered tube so it curves. Shared by the
// tree fern and the cycad.
function frond(length, droop, color, origin, angle, s = 1) {
  const [ox, oy, oz] = origin;
  const points = [];
  const radii = [];
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    points.push([
      ox + Math.cos(angle) * length * t,
      oy + Math.sin(1.1 - t * 1.9) * droop,
      oz + Math.sin(angle) * length * t,
    ]);
    // A generous width that only tapers to a third. The first version narrowed to 15%
    // and every frond in the world read as a black needle rather than as a leaf.
    radii.push(0.95 * (1 - t * 0.68));
  }
  // Deliberately coarse. A frond is a flat blade that gets squashed to 30% thickness
  // two lines below, so radial detail is invisible -- and the ground-fern patches place
  // these by the hundred, where the difference is tens of thousands of triangles.
  const geometry = taperedTube(
    points.map(([x, y, z]) => [x * s, y * s, z * s]),
    radii.map((r) => r * s),
    { tubularSegments: 6, radialSegments: 4 }
  );
  // Flattened into a blade. Scaling about the frond's own base keeps it attached to the
  // crown rather than sliding off it.
  scaleAbout(geometry, [ox * s, oy * s, oz * s], [1, 0.3, 1]);
  return { geometry, color };
}

// Tree ferns are the signature plant of this world -- ferns are far older than flowers
// and made up much of the understory a Triceratops would have been eating.
export function treeFern({ height = 14, fronds = 11, seed = 3, leaf = 0x4f7f35 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkColor = 0x5b4a35;

  parts.push({
    geometry: new THREE.CylinderGeometry(0.6, 0.95, height, 10),
    position: [0, height / 2, 0],
    color: trunkColor,
  });
  // Old frond scars spiralling up the trunk -- how a tree fern actually grows.
  for (let i = 0; i < 14; i++) {
    const t = i / 14;
    const angle = t * 9;
    parts.push({
      geometry: new THREE.ConeGeometry(0.28, 0.5, 5),
      rotation: [0, -angle, -1.2],
      position: [Math.cos(angle) * 0.85, height * (0.15 + t * 0.75), Math.sin(angle) * 0.85],
      color: 0x6b5a41,
    });
  }

  for (let i = 0; i < fronds; i++) {
    const angle = (i / fronds) * Math.PI * 2 + rng() * 0.3;
    const length = height * randomIn(rng, 0.42, 0.6);
    const shade = new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.85, 1.15)).getHex();
    parts.push(frond(length, height * 0.16, shade, [0, height, 0], angle));
  }
  // A tight fiddlehead at the crown -- the new frond, still coiled.
  parts.push({ geometry: new THREE.TorusGeometry(0.55, 0.22, 6, 12), rotation: [0, 0.6, 0], position: [0, height + 0.9, 0], color: leaf });

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// Cycads look like palms and are not remotely related to them. They were so abundant in
// the Mesozoic that it is sometimes called the Age of Cycads as well as of dinosaurs.
export function cycad({ height = 6, seed = 5, leaf = 0x3f6f30 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const trunk = new THREE.CylinderGeometry(1.1, 1.35, height, 12);
  parts.push({ geometry: trunk, position: [0, height / 2, 0], color: 0x60513a });
  for (let ring = 0; ring < 5; ring++) {
    parts.push({
      geometry: new THREE.TorusGeometry(1.2, 0.16, 5, 14),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, height * (0.12 + ring * 0.18), 0],
      color: 0x6f5f45,
    });
  }

  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + rng() * 0.2;
    const shade = new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.85, 1.15)).getHex();
    parts.push(frond(height * randomIn(rng, 0.75, 1.0), height * 0.3, shade, [0, height, 0], angle));
  }

  return group(mergedMesh(parts, { roughness: 0.85, flatShading: true }));
}

// Ginkgo: a living fossil. The tree in a car park today is near-identical to the one a
// Triceratops walked past, which makes it the best "you can go and touch one" prop here.
export function ginkgoTree({ height = 26, seed = 7, leaf = 0x9cbb46 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const trunkColor = 0x6a5540;
  const trunkHeight = height * 0.5;

  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.028, height * 0.055, trunkHeight, 10), position: [0, trunkHeight / 2, 0], color: trunkColor });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + 0.4;
    const lean = randomIn(rng, 0.6, 0.95);
    const limb = height * randomIn(rng, 0.22, 0.32);
    parts.push({
      geometry: new THREE.CylinderGeometry(height * 0.012, height * 0.026, limb, 7),
      rotation: [Math.sin(angle) * lean, 0, -Math.cos(angle) * lean],
      position: [Math.cos(angle) * limb * 0.4, trunkHeight + limb * 0.32, Math.sin(angle) * limb * 0.4],
      color: trunkColor,
    });
  }

  // Fan-shaped foliage: wide flat clumps rather than spheres, which is what gives a
  // ginkgo its layered, slightly untidy silhouette.
  const crownY = trunkHeight + height * 0.2;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.8;
    const distance = height * randomIn(rng, 0.1, 0.26);
    const clump = new THREE.IcosahedronGeometry(height * randomIn(rng, 0.11, 0.17), 1);
    clump.scale(1, 0.55, 1);
    parts.push({
      geometry: clump,
      position: [Math.cos(angle) * distance, crownY + randomIn(rng, -0.1, 0.22) * height, Math.sin(angle) * distance],
      color: new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.82, 1.15)).getHex(),
    });
  }

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// Araucaria -- the monkey-puzzle family. Whorls of branches up a straight trunk give
// the Mesozoic skyline its distinctive stepped shape, and they were what the biggest
// long-necked plant-eaters browsed on.
export function araucariaTree({ height = 40, seed = 9, needle = 0x2f5b34 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const bare = height * 0.55;

  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.016, height * 0.04, height, 10), position: [0, height / 2, 0], color: 0x5a4a38 });

  const whorls = 6;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = bare + t * (height - bare) * 0.95;
    const reach = height * 0.19 * (1 - t * 0.72) + height * 0.03;
    const arms = 7;
    for (let i = 0; i < arms; i++) {
      const angle = (i / arms) * Math.PI * 2 + w * 0.45;
      parts.push({
        geometry: new THREE.CylinderGeometry(height * 0.006, height * 0.012, reach, 6),
        rotation: [Math.sin(angle) * 1.35, 0, -Math.cos(angle) * 1.35],
        position: [Math.cos(angle) * reach * 0.42, y, Math.sin(angle) * reach * 0.42],
        color: 0x5a4a38,
      });
      const tuft = new THREE.IcosahedronGeometry(reach * randomIn(rng, 0.3, 0.4), 0);
      tuft.scale(1, 0.6, 1);
      parts.push({
        geometry: tuft,
        position: [Math.cos(angle) * reach * 0.85, y + reach * 0.1, Math.sin(angle) * reach * 0.85],
        color: new THREE.Color(needle).multiplyScalar(randomIn(rng, 0.85, 1.18)).getHex(),
      });
    }
  }
  parts.push({ geometry: new THREE.ConeGeometry(height * 0.07, height * 0.16, 8), position: [0, height * 1.02, 0], color: needle });

  return group(mergedMesh(parts, { roughness: 0.92, flatShading: true }));
}

// Horsetails. The same plant still grows by ditches today, but in the Cretaceous some
// species reached well over head height.
export function horsetailPatch({ count = 26, radius = 5, height = 7, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const stemHeight = height * randomIn(rng, 0.6, 1.15);
    parts.push({
      geometry: new THREE.CylinderGeometry(0.09, 0.13, stemHeight, 6),
      position: [x, stemHeight / 2, z],
      color: 0x6f9243,
    });
    // Whorls of fine branchlets at each joint -- the giveaway feature of a horsetail.
    const joints = Math.max(2, Math.round(stemHeight / 1.4));
    for (let j = 1; j <= joints; j++) {
      const y = (j / (joints + 1)) * stemHeight;
      const ring = new THREE.ConeGeometry(0.5, 0.7, 6, 1, true);
      parts.push({ geometry: ring, rotation: [Math.PI, 0, 0], position: [x, y, z], color: 0x86a94f });
    }
    parts.push({ geometry: new THREE.ConeGeometry(0.16, 0.6, 6), position: [x, stemHeight + 0.3, z], color: 0xa8b25c });
  }

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// Low ground ferns, in a merged clump.
export function fernPatch({ count = 14, radius = 5, seed = 13, leaf = 0x3e7331 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const size = randomIn(rng, 1.4, 2.6);
    for (let f = 0; f < 6; f++) {
      const spread = (f / 6) * Math.PI * 2 + rng();
      parts.push(
        frond(size, size * 0.5, new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.8, 1.2)).getHex(), [x, 0.4, z], spread)
      );
    }
  }

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// Magnolia. Flowering plants were brand new in the Cretaceous -- T. rex lived alongside
// the very first flowers, and magnolias are among the oldest kinds still around.
export function magnoliaShrub({ height = 9, seed = 17, leaf = 0x35662e, petal = 0xf4ecdc } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.45, height * 0.45, 8), position: [0, height * 0.22, 0], color: 0x5c4a36 });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + rng() * 0.4;
    const distance = height * randomIn(rng, 0.14, 0.26);
    parts.push({
      geometry: new THREE.IcosahedronGeometry(height * randomIn(rng, 0.16, 0.24), 1),
      position: [Math.cos(angle) * distance, height * randomIn(rng, 0.5, 0.75), Math.sin(angle) * distance],
      color: new THREE.Color(leaf).multiplyScalar(randomIn(rng, 0.82, 1.15)).getHex(),
    });
  }
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + 0.7;
    const distance = height * randomIn(rng, 0.16, 0.3);
    const y = height * randomIn(rng, 0.55, 0.9);
    for (let p = 0; p < 5; p++) {
      const petalAngle = (p / 5) * Math.PI * 2;
      const blade = new THREE.SphereGeometry(0.38, 7, 5);
      blade.scale(1, 0.28, 0.6);
      parts.push({
        geometry: blade,
        rotation: [0, petalAngle, 0.5],
        position: [
          Math.cos(angle) * distance + Math.cos(petalAngle) * 0.32,
          y,
          Math.sin(angle) * distance + Math.sin(petalAngle) * 0.32,
        ],
        color: petal,
      });
    }
    parts.push({ geometry: new THREE.SphereGeometry(0.16, 7, 5), position: [Math.cos(angle) * distance, y + 0.1, Math.sin(angle) * distance], color: 0xe0c86a });
  }

  return group(mergedMesh(parts, { roughness: 0.88, flatShading: true }));
}

// ---------------------------------------------------------------------------
// The field-science site
// ---------------------------------------------------------------------------

function researchBoardTexture() {
  return canvasTexture(900, 620, (ctx, w, h) => {
    ctx.fillStyle = '#20302a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c8b98d';
    ctx.lineWidth = 7;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    ctx.fillStyle = '#f0e6cd';
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillText('WHO IS RELATED TO WHOM?', 48, 86);

    ctx.strokeStyle = '#8fb98a';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#dfe9d6';
    ctx.font = '25px "Helvetica Neue", Arial, sans-serif';

    // A simple cladogram: the branching diagram palaeontologists actually use.
    const trunkX = 90;
    const rows = [
      ['Triceratops', 190],
      ['Ankylosaurus', 262],
      ['Edmontosaurus', 334],
      ['Pachycephalosaurus', 406],
      ['Tyrannosaurus', 478],
      ['Birds — still here', 550],
    ];
    ctx.beginPath();
    ctx.moveTo(trunkX, 150);
    ctx.lineTo(trunkX, rows[rows.length - 1][1]);
    ctx.stroke();
    for (const [label, y] of rows) {
      ctx.beginPath();
      ctx.moveTo(trunkX, y);
      ctx.lineTo(trunkX + 120 + (y % 40), y);
      ctx.stroke();
      ctx.fillText(label, trunkX + 150 + (y % 40), y + 9);
    }

    ctx.fillStyle = '#c8b98d';
    ctx.font = 'italic 24px Georgia, serif';
    ctx.fillText('Pterosaurs are NOT on this tree. They are cousins, not dinosaurs.', 48, h - 48);
  });
}

// An open-sided field camp: thatch over a frame, a research board, work tables and
// crates. Deliberately at ground level and open on every side, so a student walks
// straight through it -- the player moves on the terrain, never on top of props, so a
// raised platform would only be somewhere they could look at and never stand.
export function fieldCamp({ width = 20, depth = 14, postHeight = 9 } = {}) {
  const g = group();
  const timber = standard({ color: 0x7a5c3a, roughness: 0.92 });
  const dark = standard({ color: 0x4b3a26, roughness: 0.9 });
  const thatch = standard({ color: 0xa88b4e, roughness: 1, flatShading: true });

  const structure = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      structure.push({
        geometry: new THREE.CylinderGeometry(0.34, 0.42, postHeight, 9),
        position: [sx * (width / 2 - 0.6), postHeight / 2, sz * (depth / 2 - 0.6)],
        color: 0x7a5c3a,
      });
    }
  }
  for (const sz of [-1, 1]) {
    structure.push({ geometry: new THREE.BoxGeometry(width, 0.4, 0.4), position: [0, postHeight, sz * (depth / 2 - 0.6)], color: 0x6b502f });
  }
  for (const sx of [-1, 1]) {
    structure.push({ geometry: new THREE.BoxGeometry(0.4, 0.4, depth), position: [sx * (width / 2 - 0.6), postHeight, 0], color: 0x6b502f });
  }
  g.add(mergedMesh(structure, { roughness: 0.92 }));

  // Thatched hip roof. It DOES cast shadow -- that shade is the point of the shelter,
  // and the light orbs hung underneath are what make the interior readable.
  const roof = mesh(new THREE.ConeGeometry(width * 0.78, 4.2, 4), thatch, 0, postHeight + 2.1, 0);
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = depth / width;
  g.add(roof);
  g.add(box(width * 1.05, 0.35, depth * 1.05, dark, 0, postHeight + 0.25, 0));

  // Research board on the back edge.
  const boardFrame = box(11, 7, 0.3, timber, 0, 4.6, -depth / 2 + 0.4);
  g.add(boardFrame);
  const board = signPanel(10.2, 6.4, researchBoardTexture());
  board.position.set(0, 4.6, -depth / 2 + 0.58);
  g.add(board);

  // Work tables with trays of finds, and a stack of field crates.
  for (const sx of [-1, 1]) {
    const table = [];
    table.push({ geometry: new THREE.BoxGeometry(7, 0.3, 3), position: [sx * 5.5, 2.9, 2.6], color: 0x8a6a44 });
    for (const lx of [-3, 3]) {
      for (const lz of [-1.2, 1.2]) {
        table.push({ geometry: new THREE.BoxGeometry(0.3, 2.9, 0.3), position: [sx * 5.5 + lx, 1.45, 2.6 + lz], color: 0x6b502f });
      }
    }
    for (let i = 0; i < 3; i++) {
      table.push({ geometry: new THREE.BoxGeometry(1.7, 0.3, 1.2), position: [sx * 5.5 - 2 + i * 2, 3.2, 2.6], color: 0xc9bb96 });
    }
    g.add(mergedMesh(table, { roughness: 0.9 }));
  }

  const crates = [];
  for (const [cx, cy, cz, size] of [
    [-7.5, 1.1, -3.5, 2.2],
    [-7.4, 3.3, -3.4, 2.0],
    [-5.0, 1.0, -4.2, 2.0],
    [7.6, 1.2, -3.8, 2.4],
  ]) {
    crates.push({ geometry: new THREE.BoxGeometry(size, size, size), position: [cx, cy, cz], color: 0x8a6a44 });
    crates.push({ geometry: new THREE.BoxGeometry(size * 1.03, 0.2, size * 1.03), position: [cx, cy + size * 0.35, cz], color: 0x5f4830 });
  }
  g.add(mergedMesh(crates, { roughness: 0.9 }));

  return g;
}

// A dig in progress: a pegged-out grid, a partly-freed skeleton, spoil heaps and tools.
// This is the answer to "how does anyone know any of this", which is the most useful
// thing in the world to leave standing next to a 40ft reconstructed animal.
export function fossilDig({ width = 22, depth = 16, seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const g = group();

  // Cut floor, a shade lighter than the surrounding ground so the pit reads as a pit.
  const floor = mesh(
    new THREE.BoxGeometry(width, 0.3, depth),
    standard({ color: 0x8d7a58, roughness: 1 }),
    0,
    0.12,
    0
  );
  floor.castShadow = false;
  g.add(floor);

  // Spoil berm around three sides.
  const berm = [];
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const angle = t * Math.PI * 2;
    const rx = width / 2 + 1.1;
    const rz = depth / 2 + 1.1;
    berm.push({
      geometry: new THREE.SphereGeometry(randomIn(rng, 0.8, 1.4), 7, 5),
      position: [Math.cos(angle) * rx, randomIn(rng, 0.2, 0.55), Math.sin(angle) * rz],
      color: [0x5c4a30, 0x6d5941, 0x4a3b28][Math.floor(rng() * 3)],
    });
  }
  g.add(mergedMesh(berm, { roughness: 1, flatShading: true }));

  // The excavation grid: string lines on pegs. This is really how a site is recorded --
  // every bone's position within its square is written down before anything is lifted.
  const grid = [];
  const cols = 4;
  const rows = 3;
  for (let i = 0; i <= cols; i++) {
    const x = -width / 2 + (i * width) / cols;
    grid.push({ geometry: new THREE.BoxGeometry(0.07, 0.07, depth), position: [x, 1.5, 0], color: 0xe8e2cc });
    for (const sz of [-1, 1]) {
      grid.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 1.9, 6), position: [x, 0.95, (sz * depth) / 2], color: 0x8a6a44 });
    }
  }
  for (let i = 0; i <= rows; i++) {
    const z = -depth / 2 + (i * depth) / rows;
    grid.push({ geometry: new THREE.BoxGeometry(width, 0.07, 0.07), position: [0, 1.5, z], color: 0xe8e2cc });
  }
  g.add(mergedMesh(grid, { roughness: 0.8 }));

  // The skeleton itself, half out of the rock: skull, spine, ribs, a hip and a femur.
  //
  // spineY has to clear the trench floor's top face (0.27) by enough that the RIBS read.
  // At 0.55 the ribs swept down to about floor level and vanished into it, leaving a row
  // of neural spines that looked like a picket fence rather than an animal.
  const bones = [];
  const spineY = 1.0;
  for (let i = 0; i < 16; i++) {
    const x = -7 + i * 0.95;
    bones.push({ geometry: new THREE.BoxGeometry(0.75, 0.6, 0.55), position: [x, spineY, Math.sin(i * 0.4) * 0.5], color: BONE });
    bones.push({ geometry: new THREE.ConeGeometry(0.2, 1.1, 5), position: [x, spineY + 0.75, Math.sin(i * 0.4) * 0.5], color: BONE });
  }
  for (let i = 0; i < 9; i++) {
    const x = -5 + i * 0.9;
    for (const side of [-1, 1]) {
      const rib = taperedTube(
        [
          [x, spineY + 0.2, Math.sin(i * 0.4) * 0.5],
          [x - 0.3, spineY - 0.15, side * (1.7 + Math.sin(i * 0.5) * 0.6)],
          [x - 0.5, spineY - 0.5, side * (2.9 + Math.sin(i * 0.5) * 0.9)],
        ],
        [0.2, 0.17, 0.11],
        { tubularSegments: 8, radialSegments: 5 }
      );
      bones.push({ geometry: rib, color: BONE });
    }
  }
  // Skull, lying on its side at the head of the trench.
  const skull = taperedTube([[8.5, 1.2, 0.4], [10.6, 1.25, 0.2], [12.6, 1.05, -0.1]], [1.1, 0.95, 0.35], { tubularSegments: 12, radialSegments: 7 });
  scaleAbout(skull, [10.6, 1.2, 0.2], [1, 0.85, 1.15]);
  bones.push({ geometry: skull, color: BONE });
  for (let i = 0; i < 7; i++) {
    bones.push({
      geometry: new THREE.ConeGeometry(0.13, 0.6, 5),
      rotation: [0, 0, -1.9],
      position: [9.3 + i * 0.45, 0.75, 0.55],
      color: TOOTH,
    });
  }
  // Hip and a femur pulled slightly out of line, as bones usually are.
  bones.push({ geometry: new THREE.BoxGeometry(2.6, 0.5, 2.2), position: [-8.4, spineY, 0.2], color: BONE });
  const femur = taperedTube([[-8.6, 0.95, 1.8], [-9.9, 1.0, 3.6], [-10.6, 0.95, 5.4]], [0.55, 0.42, 0.6], { tubularSegments: 8, radialSegments: 6 });
  bones.push({ geometry: femur, color: BONE });
  g.add(mergedMesh(bones, { roughness: 0.85, flatShading: true }));

  // Tools left on the edge: brushes, a pick, a bucket, and plaster jackets ready to lift.
  const kit = [];
  kit.push({ geometry: new THREE.CylinderGeometry(0.9, 0.75, 1.5, 12), position: [width / 2 - 2.5, 0.75, depth / 2 - 2], color: 0xb45a3a });
  kit.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 3.2, 6), rotation: [0, 0.4, 1.3], position: [width / 2 - 4.5, 0.5, depth / 2 - 3], color: 0x8a6a44 });
  kit.push({ geometry: new THREE.BoxGeometry(1.1, 0.25, 0.35), rotation: [0, 0.4, 0], position: [width / 2 - 5.6, 0.35, depth / 2 - 3.6], color: 0x53555c });
  for (let i = 0; i < 3; i++) {
    kit.push({
      geometry: new THREE.CylinderGeometry(1.1, 1.2, 0.9, 10),
      rotation: [0, 0, 1.57],
      position: [-width / 2 + 3 + i * 2.6, 0.7, depth / 2 - 2.4],
      color: 0xe6e2d5,
    });
  }
  g.add(mergedMesh(kit, { roughness: 0.9 }));

  return g;
}

// A timber boardwalk segment. Laid end to end by the layout to make a path through the
// undergrowth -- the same navigational job the Park's flagstone runs do.
export function boardwalk({ length = 14, width = 6, seed = 23 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const planks = Math.round(length / 1.2);
  for (let i = 0; i < planks; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width, 0.22, 1.0),
      rotation: [0, randomIn(rng, -0.02, 0.02), 0],
      position: [0, 0.2, -length / 2 + 0.6 + i * (length / planks)],
      color: new THREE.Color(0x8a6a44).multiplyScalar(randomIn(rng, 0.82, 1.12)).getHex(),
    });
  }
  for (const sx of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.35, 0.3, length), position: [sx * (width / 2 - 0.3), 0.05, 0], color: 0x5f4830 });
  }

  const walk = mergedMesh(parts, { roughness: 0.95 });
  walk.castShadow = false;
  return group(walk);
}

// A three-toed theropod trackway. Real trackways tell you things a skeleton cannot:
// how fast the animal moved, whether it travelled alone, and how it held its feet.
export function dinoTracks({ count = 8, seed = 5, stride = 6, gauge = 2.4 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(128, 160, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(58,44,28,0.62)';
    // Three forward toes and a heel pad.
    for (const [tx, ty, angle] of [
      [64, 44, 0],
      [30, 62, -0.5],
      [98, 62, 0.5],
    ]) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 40, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(64, 112, 30, 30, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  const parts = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    parts.push({
      geometry: new THREE.PlaneGeometry(2.6, 3.2),
      rotation: [-Math.PI / 2, randomIn(rng, -0.12, 0.12), 0],
      position: [(side * gauge) / 2 + randomIn(rng, -0.2, 0.2), 0.06, -i * stride],
      color: 0xffffff,
    });
  }

  // One mesh, and pure-white vertex colours so the map is not multiplied by a tint.
  const trail = mergedMesh(parts, { map: texture, transparent: true, roughness: 1, depthWrite: false });
  trail.castShadow = false;
  trail.receiveShadow = false;
  return group(trail);
}

// ---------------------------------------------------------------------------
// Reused from other worlds, in this island's colours
// ---------------------------------------------------------------------------

// Boulders and a volcanic plume are the same shapes wherever they appear; only the
// palette changes. Same arrangement as the Mars world's craters and rocks.
export function jungleRocks(options = {}) {
  return moonRocks({ colors: [0x5f6355, 0x4c5245, 0x6d7060, 0x3f4438], ...options });
}

export function volcanicSmoke(options = {}) {
  return dustDevil({ height: 70, radius: 11, color: 0x8d8a86, tint: '150,146,140', ...options });
}
