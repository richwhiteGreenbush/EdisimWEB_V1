import * as THREE from 'three';
import {
  standard, mesh, box, cyl, group, mergeColored, mergedMesh, relief,
  taperedTube, seededRandom, randomIn, roughenSphere,
} from '../PropKit.js';

// The Great Barrier Reef -- about 25ft down on the outer reef, shallower and clearer than
// the `sea` world's 30ft patch reef.
//
// This world deliberately REUSES most of SeaProps: the water ceiling, light shafts, marine
// snow, bubble columns, bommies, gardens, clams, anemones and fish schools are all the
// same problems solved once. What is new here is the megafauna the Barrier Reef is
// actually known for -- a green turtle, a manta ray, and the branching staghorn thickets
// that build the reef itself.
//
// The lesson this world carries that `sea` does not: CORAL IS AN ANIMAL, and the reef is
// a limestone city built by generations of them. So the bleached section is here too, and
// it is not decoration -- a reef that is only ever shown healthy teaches that it is fine.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

// ---------------------------------------------------------------------------
// Green sea turtle
// ---------------------------------------------------------------------------

// What makes a turtle read as a turtle, in order: the SHELL IS FLAT AND WIDE, not domed
// (that is a tortoise); the front flippers are enormous, far bigger than the back pair,
// and they are held out like wings; and the head sticks straight forward on a short neck
// with no taper. Get a domed shell and small flippers and you have built a tortoise
// swimming, which reads as badly wrong to any child who has seen one.
export function seaTurtle({ length = 4.2, seed = 5 } = {}) {
  const parts = [];
  const shellColor = 0x5c6b3f;
  const shellDark = 0x44502e;
  const skin = 0x6f7d55;
  const pale = 0xc9c2a0;

  const L = length;
  const shellW = L * 0.78;

  // Carapace: a flattened dome, wider than long is wrong -- a green turtle's shell is a
  // touch longer than wide, and distinctly heart-shaped, wider at the shoulders.
  const shell = new THREE.SphereGeometry(L * 0.45, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(shellW / (L * 0.9), 0.42, 1.06);
  parts.push({ geometry: shell, color: shellColor, position: [0, 0.9, 0] });

  // Scutes: the plates. Five down the middle, four each side -- and the count is the thing
  // that identifies the species, so it is worth being exact about.
  for (let i = 0; i < 5; i++) {
    const z = -L * 0.3 + i * L * 0.16;
    const w = L * 0.2 * (1 - Math.abs(i - 2) * 0.12);
    parts.push({
      geometry: new THREE.BoxGeometry(w, 0.05, L * 0.14),
      color: shellDark,
      position: [0, 0.9 + L * 0.42 * (1 - Math.pow((z / (L * 0.5)), 2)) * 0.42, z],
    });
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z = -L * 0.26 + i * L * 0.18;
      parts.push({
        geometry: new THREE.BoxGeometry(L * 0.16, 0.05, L * 0.15),
        color: shellDark,
        position: [side * L * 0.26, 0.9 + L * 0.13, z],
        rotation: [0, 0, side * 0.4],
      });
    }
  }

  // Plastron -- the flat pale underside.
  const plastron = new THREE.SphereGeometry(L * 0.4, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  plastron.scale(shellW / (L * 0.95), 0.16, 1.0);
  parts.push({ geometry: plastron, color: pale, position: [0, 0.88, 0] });

  // Head: short neck, blunt head straight forward.
  const neck = taperedTube(
    [[0, 0.92, L * 0.42], [0, 0.95, L * 0.55], [0, 0.95, L * 0.66]],
    [L * 0.11, L * 0.1, L * 0.095],
    { tubularSegments: 8, radialSegments: 10 },
  );
  parts.push({ geometry: neck, color: skin });
  const head = new THREE.SphereGeometry(L * 0.1, 14, 12);
  head.scale(0.9, 0.85, 1.25);
  parts.push({ geometry: head, color: skin, position: [0, 0.95, L * 0.72] });
  // Beak.
  parts.push({ geometry: new THREE.ConeGeometry(L * 0.05, L * 0.07, 8), color: 0x8a8060, position: [0, 0.93, L * 0.8], rotation: [Math.PI / 2, 0, 0] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.SphereGeometry(L * 0.022, 8, 6), color: 0x1a1a14, position: [side * L * 0.065, 0.99, L * 0.76] });
  }

  // Front flippers -- huge, swept back, held out like wings. These are most of the animal.
  for (const side of [-1, 1]) {
    const flip = taperedTube(
      [
        [side * L * 0.25, 0.9, L * 0.26],
        [side * L * 0.55, 0.98, L * 0.2],
        [side * L * 0.85, 1.02, L * 0.02],
        [side * L * 1.02, 0.98, -L * 0.18],
      ],
      [L * 0.11, L * 0.1, L * 0.07, L * 0.028],
      { tubularSegments: 16, radialSegments: 8 },
    );
    // Flattened into a blade. Safe here: every control point is already at its final
    // place and the scale is applied about the tube's own swept coordinates, but the
    // flipper is authored around the body origin, so only Y is scaled -- scaling X would
    // drag it toward the centre line (the Sphinx-lappet trap).
    flip.scale(1, 0.3, 1);
    parts.push({ geometry: flip, color: skin });
  }

  // Rear flippers -- small, and that contrast is the identifying proportion.
  for (const side of [-1, 1]) {
    const rear = taperedTube(
      [[side * L * 0.22, 0.88, -L * 0.34], [side * L * 0.4, 0.88, -L * 0.46], [side * L * 0.5, 0.88, -L * 0.56]],
      [L * 0.08, L * 0.06, L * 0.03],
      { tubularSegments: 8, radialSegments: 8 },
    );
    rear.scale(1, 0.32, 1);
    parts.push({ geometry: rear, color: skin });
  }

  return group(mergedMesh(parts, { roughness: 0.82, ...relief('stone', { seed, repeat: 4, strength: 0.3 }) }));
}

// ---------------------------------------------------------------------------
// Manta ray
// ---------------------------------------------------------------------------

// A reef manta: up to 15ft across, and the widest thing on the reef. Three features carry
// it -- the wings are a single continuous DIAMOND with the body buried in the middle (not
// a body with wings attached), the two cephalic fins roll forward off the head like horns,
// and the underside is white with a spot pattern unique to the individual, the way a
// fingerprint is.
export function mantaRay({ span = 13, seed = 11 } = {}) {
  const parts = [];
  const back = 0x2b3442;
  const backEdge = 0x1b222c;
  const belly = 0xe4e6e2;

  const S = span;

  // The disc, built as one swept form across the span so the wings and body are continuous.
  const disc = taperedTube(
    [
      [-S * 0.5, 0, 0],
      [-S * 0.25, 0, S * 0.05],
      [0, 0, S * 0.06],
      [S * 0.25, 0, S * 0.05],
      [S * 0.5, 0, 0],
    ],
    [S * 0.02, S * 0.17, S * 0.24, S * 0.17, S * 0.02],
    { tubularSegments: 40, radialSegments: 14 },
  );
  disc.scale(1, 0.2, 1); // a manta is a sheet, and this is what makes it one
  parts.push({ geometry: disc, color: back });

  // The trailing edge sweeps BACK from the wingtips -- a straight trailing edge reads as
  // a kite. Built as a separate thin wedge behind the disc.
  for (const side of [-1, 1]) {
    const sweep = taperedTube(
      [
        [side * S * 0.48, 0, -S * 0.01],
        [side * S * 0.3, 0, -S * 0.1],
        [side * S * 0.12, 0, -S * 0.16],
        [0, 0, -S * 0.17],
      ],
      [S * 0.012, S * 0.03, S * 0.04, S * 0.045],
      { tubularSegments: 14, radialSegments: 8 },
    );
    sweep.scale(1, 0.16, 1);
    parts.push({ geometry: sweep, color: backEdge });
  }

  // Body bulge, on top of the middle of the disc.
  const body = new THREE.SphereGeometry(S * 0.13, 16, 12);
  body.scale(1, 0.6, 1.5);
  parts.push({ geometry: body, color: back, position: [0, S * 0.02, S * 0.02] });

  // White underside with spots.
  const under = taperedTube(
    [[-S * 0.42, -S * 0.012, 0], [0, -S * 0.014, S * 0.04], [S * 0.42, -S * 0.012, 0]],
    [S * 0.03, S * 0.2, S * 0.03],
    { tubularSegments: 24, radialSegments: 12 },
  );
  under.scale(1, 0.12, 1);
  parts.push({ geometry: under, color: belly });
  const rng = seededRandom(seed);
  for (let i = 0; i < 14; i++) {
    parts.push({
      geometry: new THREE.SphereGeometry(S * randomIn(rng, 0.008, 0.018), 6, 5),
      color: 0x3a4450,
      position: [randomIn(rng, -S * 0.2, S * 0.2), -S * 0.022, randomIn(rng, -S * 0.08, S * 0.1)],
    });
  }

  // Cephalic fins -- the rolled "horns" either side of the mouth. Nothing else in the sea
  // has these, and they are the give-away.
  for (const side of [-1, 1]) {
    const horn = taperedTube(
      [
        [side * S * 0.075, 0, S * 0.13],
        [side * S * 0.1, -S * 0.01, S * 0.2],
        [side * S * 0.085, -S * 0.03, S * 0.25],
      ],
      [S * 0.026, S * 0.02, S * 0.012],
      { tubularSegments: 10, radialSegments: 7 },
    );
    parts.push({ geometry: horn, color: back });
  }

  // The mouth: a wide terminal slot right at the front. A manta feeds by swimming with it
  // open, and it is at the FRONT, not underneath -- that is what separates it from a ray.
  parts.push({ geometry: new THREE.BoxGeometry(S * 0.14, S * 0.018, S * 0.03), color: 0x14181e, position: [0, 0, S * 0.155] });

  // Gill slits underneath.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      parts.push({
        geometry: new THREE.BoxGeometry(S * 0.012, S * 0.004, S * 0.05),
        color: 0x2b3038,
        position: [side * (S * 0.05 + i * S * 0.022), -S * 0.022, S * 0.05 - i * S * 0.012],
      });
    }
  }

  // Tail -- thin, whip-like, and SHORTER than the span. No sting.
  const tail = taperedTube(
    [[0, 0, -S * 0.17], [0, S * 0.005, -S * 0.32], [0, 0, -S * 0.46]],
    [S * 0.018, S * 0.008, S * 0.002],
    { tubularSegments: 12, radialSegments: 6 },
  );
  parts.push({ geometry: tail, color: backEdge });

  return group(mergedMesh(parts, { roughness: 0.68, ...relief('stone', { seed: seed + 1, repeat: 5, strength: 0.22 }) }));
}

// ---------------------------------------------------------------------------
// Reef-building coral
// ---------------------------------------------------------------------------

// Staghorn -- the branching Acropora that actually builds the Barrier Reef. Recursive
// forking, each branch thinner than its parent, tips paler than the trunk because that is
// where the growth is.
//
// `bleached` strips the colour to bone white and drops the tip highlight. It is here on
// purpose: a reef only ever shown healthy teaches that it is fine.
export function staghornCoral({ size = 5, seed = 7, bleached = false, color = 0xc98a4e } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const base = bleached ? 0xe8e4d8 : color;
  const tip = bleached ? 0xf2f0e8 : 0xe8c88a;

  const branch = (from, dir, len, radius, depth) => {
    const to = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len];
    const mid = [
      from[0] + dir[0] * len * 0.5 + randomIn(rng, -0.1, 0.1) * len,
      from[1] + dir[1] * len * 0.55,
      from[2] + dir[2] * len * 0.5 + randomIn(rng, -0.1, 0.1) * len,
    ];
    // A non-zero tip radius -- a branch tapering to a point is a spike, the same lesson
    // the dinosaur fronds and the neuron dendrites both taught.
    parts.push({
      geometry: taperedTube([from, mid, to], [radius, radius * 0.8, radius * 0.55], { tubularSegments: 7, radialSegments: 6 }),
      color: depth >= 2 ? tip : base,
    });
    if (depth >= 3 || len < 0.35) return;
    const forks = rng() > 0.35 ? 3 : 2;
    for (let i = 0; i < forks; i++) {
      const a = (i / forks) * Math.PI * 2 + rng() * 1.4;
      const spread = 0.55 + rng() * 0.4;
      const nd = [
        dir[0] * 0.55 + Math.cos(a) * spread,
        Math.max(0.35, dir[1] * 0.8 + randomIn(rng, -0.1, 0.25)),
        dir[2] * 0.55 + Math.sin(a) * spread,
      ];
      const m = Math.hypot(nd[0], nd[1], nd[2]) || 1;
      branch(to, [nd[0] / m, nd[1] / m, nd[2] / m], len * randomIn(rng, 0.6, 0.78), radius * 0.62, depth + 1);
    }
  };

  const trunks = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < trunks; i++) {
    const a = (i / trunks) * Math.PI * 2 + rng() * 0.8;
    const r = size * randomIn(rng, 0.05, 0.22);
    branch(
      [Math.cos(a) * r, 0.1, Math.sin(a) * r],
      [Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2],
      size * randomIn(rng, 0.3, 0.42),
      size * 0.055,
      0,
    );
  }

  // Rubble base, which is what a real thicket grows out of.
  for (let i = 0; i < 7; i++) {
    parts.push({
      geometry: roughenSphere(new THREE.IcosahedronGeometry(size * randomIn(rng, 0.06, 0.13), 1), { amount: 0.35, flatten: 0.6 }),
      color: bleached ? 0xd8d2c4 : 0xa89a80,
      position: [randomIn(rng, -size * 0.3, size * 0.3), 0.06, randomIn(rng, -size * 0.3, size * 0.3)],
    });
  }

  return group(mergedMesh(parts, {
    roughness: 0.92,
    ...relief('stone', { seed: seed + 3, repeat: 4, strength: 0.4 }),
  }));
}

// A plate coral -- the wide flat tables that shade the reef flat. Grows as a disc on a
// short stem, with concentric growth ridges.
export function plateCoral({ radius = 4, seed = 13, bleached = false, color = 0xb87a52 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const c = bleached ? 0xe8e4d8 : color;
  const rim = bleached ? 0xf2f0e8 : 0xd9a86e;

  parts.push({ geometry: new THREE.CylinderGeometry(radius * 0.16, radius * 0.24, 1.1, 10), color: bleached ? 0xd8d2c4 : 0x9a7a5c, position: [0, 0.55, 0] });

  // The table: stacked discs of decreasing height, tilted, with a raised rim.
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const r = radius * (0.42 + t * 0.58);
    parts.push({
      geometry: new THREE.CylinderGeometry(r, r * 0.96, 0.2, 26),
      color: i === 3 ? rim : c,
      position: [0, 1.05 + i * 0.16, 0],
    });
  }
  // Growth ridges radiating out.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(radius * 0.9, 0.1, 0.12),
      color: bleached ? 0xdcd8cc : 0xa06a46,
      position: [Math.cos(a) * radius * 0.5, 1.6, Math.sin(a) * radius * 0.5],
      rotation: [0, -a, 0],
    });
  }

  const m = mergedMesh(parts, { roughness: 0.93, ...relief('stone', { seed: seed + 2, repeat: 4 }) });
  // Tables grow tilted toward the light, and a level one reads as a table lamp.
  m.rotation.z = randomIn(rng, -0.14, 0.14);
  m.rotation.x = randomIn(rng, -0.12, 0.12);
  return group(m);
}

// A giant potato cod -- the reef's friendly heavyweight, up to 6ft and famously
// unbothered by divers. A big blunt head, a huge mouth, and blotches.
export function potatoCod({ length = 5, seed = 17 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const L = length;
  const body = 0xa8a08a;
  const blotch = 0x5a5445;

  const trunk = taperedTube(
    [
      [0, 0, -L * 0.5], [0, L * 0.02, -L * 0.28], [0, L * 0.03, 0],
      [0, L * 0.02, L * 0.26], [0, 0, L * 0.5],
    ],
    [L * 0.04, L * 0.15, L * 0.19, L * 0.17, L * 0.08],
    { tubularSegments: 26, radialSegments: 14 },
  );
  trunk.scale(0.82, 1, 1);
  parts.push({ geometry: trunk, color: body });

  // The mouth -- enormous, and a grouper's whole face is mouth.
  parts.push({ geometry: new THREE.BoxGeometry(L * 0.2, L * 0.03, L * 0.1), color: 0x2b2822, position: [0, -L * 0.02, L * 0.47] });
  parts.push({ geometry: new THREE.SphereGeometry(L * 0.09, 12, 10), color: body, position: [0, L * 0.04, L * 0.44] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.SphereGeometry(L * 0.022, 8, 7), color: 0x1a1a16, position: [side * L * 0.07, L * 0.07, L * 0.45] });
  }

  // Blotches, which is the whole reason it is called a potato cod.
  for (let i = 0; i < 18; i++) {
    const t = randomIn(rng, -0.42, 0.42);
    const a = rng() * Math.PI * 2;
    const r = L * (0.15 - Math.abs(t) * 0.13);
    parts.push({
      geometry: new THREE.SphereGeometry(L * randomIn(rng, 0.02, 0.045), 7, 6),
      color: blotch,
      position: [Math.cos(a) * r * 0.82, Math.sin(a) * r, t * L],
    });
  }

  // Fins.
  parts.push({
    geometry: new THREE.BoxGeometry(L * 0.02, L * 0.11, L * 0.4),
    color: body, position: [0, L * 0.17, -L * 0.02],
  });
  for (const side of [-1, 1]) {
    const pec = new THREE.SphereGeometry(L * 0.07, 10, 8);
    pec.scale(0.2, 1, 1.3);
    parts.push({ geometry: pec, color: body, position: [side * L * 0.14, 0, L * 0.2], rotation: [0, side * -0.4, 0] });
  }
  const tail = new THREE.SphereGeometry(L * 0.11, 10, 8);
  tail.scale(0.16, 1.1, 0.6);
  parts.push({ geometry: tail, color: body, position: [0, 0, -L * 0.55] });

  return group(mergedMesh(parts, { roughness: 0.74, ...relief('stone', { seed: seed + 1, repeat: 5, strength: 0.25 }) }));
}

// A patch of bleached reef. Not a separate species -- the same shapes as the living reef,
// stripped white, with algae starting on them. Placed as one object so a layout can put
// the healthy reef and the dying reef side by side, which is the only honest way to show
// it.
export function bleachedPatch({ size = 12, seed = 23 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * size * 0.42;
    const r = size * randomIn(rng, 0.08, 0.17);
    const lump = roughenSphere(new THREE.SphereGeometry(r, 12, 9), { amount: 0.3, flatten: 0.72, phase: i * 1.7 });
    parts.push({
      geometry: lump,
      color: [0xe8e4d8, 0xdcd6c6, 0xf0ece0][i % 3],
      position: [Math.cos(a) * d, r * 0.5, Math.sin(a) * d],
    });
    // Dead branch stubs.
    for (let b = 0; b < 4; b++) {
      const ba = rng() * Math.PI * 2;
      parts.push({
        geometry: new THREE.CylinderGeometry(size * 0.012, size * 0.02, size * randomIn(rng, 0.08, 0.18), 6),
        color: 0xd8d2c4,
        position: [Math.cos(a) * d + Math.cos(ba) * r * 0.6, r * 0.9, Math.sin(a) * d + Math.sin(ba) * r * 0.6],
        rotation: [randomIn(rng, -0.4, 0.4), 0, randomIn(rng, -0.4, 0.4)],
      });
    }
  }
  // Turf algae creeping over it -- the second stage, and what stops it ever coming back.
  for (let i = 0; i < 16; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * size * 0.44;
    parts.push({
      geometry: roughenSphere(new THREE.SphereGeometry(size * randomIn(rng, 0.03, 0.06), 8, 6), { amount: 0.4, flatten: 0.5 }),
      color: [0x6b7a4a, 0x54603a, 0x7d8a58][i % 3],
      position: [Math.cos(a) * d, size * 0.03, Math.sin(a) * d],
    });
  }

  return group(mergedMesh(parts, { roughness: 0.95, ...relief('stone', { seed: seed + 4, repeat: 5 }) }));
}
