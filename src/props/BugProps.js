import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn,
} from '../PropKit.js';

// A Bug's Life: an ant colony, at ant scale.
//
// THE STUDENT IS THE SIZE OF AN ANT, and that decision is the whole world. Every other
// preset here scales the SCENERY down to fit a 5ft person; this one leaves the person at
// 5ft and scales the world UP around them, so a grass blade is a fifty-foot tower, a
// pebble is a boulder and a breadcrumb is something you would need help to carry. It is
// the same trick Fantastic Voyage plays with organs, turned outward.
//
// The factor is about 60x rather than the literal 300x an ant-to-human ratio would give.
// At 300x a single blade of grass is 300ft tall -- past the world bound, past the fog, and
// past the point where a student can see the top of it. 60x keeps the sky visible, which
// matters: lose the sky and this stops being a meadow and becomes a cave.
//
// What makes an ant read as an ant, in order of how much each one buys:
//
//   1. THREE body sections with a genuinely NARROW WAIST between the middle and the rear.
//      That petiole is the single most recognisable thing about the whole order. A body
//      built as one smooth mass is a beetle, whatever else you do to it.
//   2. ELBOWED ANTENNAE -- bent at a sharp angle partway along, not straight feelers.
//   3. SIX legs, all six on the MIDDLE section only, and long enough to hold the body
//      clear of the ground.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const CHITIN = 0x7a3d1f;
const CHITIN_DARK = 0x54280f;
const CHITIN_LIGHT = 0x9a5a30;
const SOIL = 0x6b5236;
const SOIL_DARK = 0x4e3a26;
const SOIL_LIGHT = 0x8a6f4a;
const LEAF_GREEN = 0x4e8a34;
const LEAF_DARK = 0x35632a;
const LEAF_LIGHT = 0x6faa46;

// ---------------------------------------------------------------------------
// The ant
// ---------------------------------------------------------------------------

export function ant({ length = 5.5, color = CHITIN, soldier = false, seed = 3 } = {}) {
  const g = group();
  const S = length / 5.5;
  const parts = [];
  const dark = new THREE.Color(color).offsetHSL(0, 0.04, -0.11).getHex();
  const light = new THREE.Color(color).offsetHSL(0, -0.03, 0.09).getHex();

  // Standing height. An ant's legs hold it well clear of the ground -- a body resting on
  // the floor reads as a grub, and the gap under it is most of what says "insect".
  const BODY_Y = 1.35 * S;

  // --- Gaster (rear) ------------------------------------------------------
  // A fat teardrop, widest behind the waist and tapering to a point at the tip.
  const gaster = new THREE.SphereGeometry(0.78 * S, 18, 14);
  gaster.scale(0.86, 0.82, 1.15);
  parts.push({ geometry: gaster, color, position: [0, BODY_Y + 0.06 * S, -1.55 * S] });
  // Tergites: the overlapping plates across the top of it.
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const r = 0.79 * S * (1 - t * 0.42);
    const band = new THREE.TorusGeometry(r, 0.055 * S, 6, 18, Math.PI * 1.1);
    band.rotateY(Math.PI / 2);
    band.rotateZ(Math.PI / 2);
    parts.push({ geometry: band, color: dark, position: [0, BODY_Y + 0.06 * S, -1.15 * S - t * 0.82 * S] });
  }

  // --- The petiole -- the waist -------------------------------------------
  // Two small nodes on a thin stalk. This is the field mark, and it has to be visibly
  // THIN: it is the difference between an ant and a wasp-shaped nothing.
  parts.push({ geometry: new THREE.CylinderGeometry(0.1 * S, 0.1 * S, 0.42 * S, 8), color: dark, position: [0, BODY_Y + 0.02 * S, -0.68 * S], rotation: [Math.PI / 2, 0, 0] });
  const node = new THREE.SphereGeometry(0.19 * S, 10, 8);
  node.scale(0.85, 1.25, 0.85);
  parts.push({ geometry: node, color: dark, position: [0, BODY_Y + 0.16 * S, -0.78 * S] });
  parts.push({ geometry: node.clone().scale(0.86, 0.86, 0.86), color: dark, position: [0, BODY_Y + 0.12 * S, -0.5 * S] });

  // --- Mesosoma (middle) --------------------------------------------------
  // Humped, and every leg hangs off this one section.
  const meso = new THREE.SphereGeometry(0.44 * S, 16, 12);
  meso.scale(0.92, 0.98, 1.7);
  parts.push({ geometry: meso, color: light, position: [0, BODY_Y + 0.1 * S, 0.15 * S] });
  parts.push({ geometry: new THREE.SphereGeometry(0.3 * S, 12, 10), color, position: [0, BODY_Y + 0.24 * S, 0.55 * S] });

  // --- Head ---------------------------------------------------------------
  const headZ = 1.28 * S;
  const head = new THREE.SphereGeometry(0.5 * S, 16, 12);
  head.scale(1.06, 0.92, soldier ? 1.18 : 0.96);
  parts.push({ geometry: head, color: soldier ? dark : color, position: [0, BODY_Y + 0.26 * S, headZ] });

  // Compound eyes, on the SIDES of the head where an insect's are, not the front.
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.15 * S, 10, 8);
    eye.scale(0.75, 1, 1.15);
    parts.push({ geometry: eye, color: 0x171310, position: [side * 0.44 * S, BODY_Y + 0.33 * S, headZ + 0.06 * S] });
  }

  // Mandibles: a pair of curved pincers held open, projecting forward.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: taperedTube(
        [[side * 0.2 * S, BODY_Y + 0.14 * S, headZ + 0.4 * S],
          [side * 0.42 * S, BODY_Y + 0.1 * S, headZ + 0.78 * S],
          [side * 0.22 * S, BODY_Y + 0.08 * S, headZ + 1.02 * S]],
        [0.1 * S, 0.07 * S, 0.02 * S], { tubularSegments: 8, radialSegments: 7 },
      ),
      color: soldier ? 0x2e1a0c : dark,
    });
  }

  // Antennae. ELBOWED: a long straight scape out and forward, then a sharp bend and a
  // shorter funiculus. Drawn as one smooth curve they become a moth's feelers.
  //
  // They are the same tone as the body rather than the darkest one available, and they are
  // not thin. Against soil, at any distance, near-black detail on a near-black silhouette
  // is detail nobody can see -- and if the antennae do not read, half of what makes this
  // an ant has gone.
  for (const side of [-1, 1]) {
    const elbowX = side * 0.78 * S;
    const elbowY = BODY_Y + 0.92 * S;
    const elbowZ = headZ + 0.66 * S;
    parts.push({
      geometry: taperedTube(
        [[side * 0.2 * S, BODY_Y + 0.5 * S, headZ + 0.24 * S], [elbowX * 0.6, elbowY - 0.06 * S, elbowZ * 0.86], [elbowX, elbowY, elbowZ]],
        [0.085 * S, 0.07 * S, 0.062 * S], { tubularSegments: 8, radialSegments: 6 },
      ),
      color: light,
    });
    parts.push({
      geometry: taperedTube(
        [[elbowX, elbowY, elbowZ], [elbowX + side * 0.34 * S, elbowY - 0.3 * S, elbowZ + 0.56 * S], [elbowX + side * 0.5 * S, elbowY - 0.7 * S, elbowZ + 0.98 * S]],
        [0.062 * S, 0.05 * S, 0.034 * S], { tubularSegments: 8, radialSegments: 6 },
      ),
      color: light,
    });
    // A bead at the elbow, which is where the eye lands and what says "this bends here".
    parts.push({ geometry: new THREE.SphereGeometry(0.075 * S, 8, 6), color, position: [elbowX, elbowY, elbowZ] });
  }

  // --- Six legs, all on the mesosoma --------------------------------------
  // Each one goes out and UP to a raised knee, then down to the ground. A leg drawn
  // straight out to the floor is a table leg; the knee above the body is the insect.
  //
  // THIN, and not black. The first pass had them at 0.11 at the hip in the darkest tone
  // available, and six thick black legs splayed round a body is the silhouette of a
  // SPIDER -- which is the one thing this model must not be mistaken for. An ant's legs
  // are wiry, and they are the same colour as the rest of it.
  const hips = [0.62 * S, 0.16 * S, -0.3 * S];
  hips.forEach((hz, i) => {
    const reach = (0.98 + i * 0.1) * S;
    const sweep = (i - 1) * 0.46 * S;
    for (const side of [-1, 1]) {
      parts.push({
        geometry: taperedTube(
          [[side * 0.26 * S, BODY_Y + 0.04 * S, hz],
            [side * reach * 0.6, BODY_Y + 0.52 * S, hz + sweep * 0.5],
            [side * reach, BODY_Y * 0.44, hz + sweep],
            [side * reach * 1.04, 0.03 * S, hz + sweep * 1.35]],
          [0.068 * S, 0.045 * S, 0.031 * S, 0.017 * S],
          { tubularSegments: 12, radialSegments: 6 },
        ),
        color,
      });
      // The knee, where the two segments meet at an angle. Two tubes meeting at an angle
      // cannot close on their own -- see the joint note in CLAUDE.md.
      parts.push({
        geometry: new THREE.SphereGeometry(0.052 * S, 7, 5),
        color: light,
        position: [side * reach * 0.6, BODY_Y + 0.52 * S, hz + sweep * 0.5],
      });
    }
  });

  g.add(mergedMesh(parts, { roughness: 0.42, metalness: 0.12, ...relief('stone', { seed, repeat: 3 }) }));
  return g;
}

// An aphid. Ants farm these: they stroke them with their antennae and the aphid gives up a
// drop of honeydew. It is genuine agriculture, and it is fifty million years older than
// ours.
//
// The field mark is the pair of CORNICLES -- two little tailpipes standing up at the back
// end. Nothing else has them, and without them this is just a green blob.
export function aphid({ length = 2.6, color = 0x8fc44e, seed = 5 } = {}) {
  const g = group();
  const S = length / 2.6;
  const parts = [];
  const dark = new THREE.Color(color).offsetHSL(0, 0.05, -0.14).getHex();

  const body = new THREE.SphereGeometry(0.62 * S, 16, 12);
  body.scale(0.86, 0.9, 1.28);
  parts.push({ geometry: body, color, position: [0, 0.66 * S, 0] });
  parts.push({ geometry: new THREE.SphereGeometry(0.26 * S, 12, 10), color: dark, position: [0, 0.6 * S, 0.78 * S] });

  // The cornicles.
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.045 * S, 0.075 * S, 0.44 * S, 7), color: dark, position: [side * 0.26 * S, 1.06 * S, -0.6 * S], rotation: [-0.35, 0, side * -0.2] });
  }
  // A short tail spike between them (the cauda).
  parts.push({ geometry: new THREE.ConeGeometry(0.08 * S, 0.3 * S, 7), color: dark, position: [0, 0.66 * S, -0.86 * S], rotation: [-1.9, 0, 0] });

  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.07 * S, 8, 6), color: 0x231d16, position: [side * 0.2 * S, 0.66 * S, 0.94 * S] });
    for (const hz of [0.42 * S, 0.02 * S, -0.4 * S]) {
      parts.push({
        geometry: taperedTube(
          [[side * 0.2 * S, 0.6 * S, hz], [side * 0.5 * S, 0.78 * S, hz], [side * 0.62 * S, 0.03 * S, hz + 0.1 * S]],
          [0.05 * S, 0.035 * S, 0.02 * S], { tubularSegments: 7, radialSegments: 6 },
        ),
        color: dark,
      });
    }
  }
  // The stylet -- the straw it drinks sap through, pushed down into whatever it is on.
  parts.push({ geometry: new THREE.CylinderGeometry(0.02 * S, 0.03 * S, 0.6 * S, 6), color: dark, position: [0, 0.3 * S, 0.72 * S], rotation: [0.5, 0, 0] });

  g.add(mergedMesh(parts, { roughness: 0.55, ...relief('stone', { seed, repeat: 2 }) }));
  return g;
}

// A seven-spot ladybird. The elytra are a hard DOME -- a flattened disc reads as a sticker
// -- and the white cheek patches either side of the head are what stop it being a beetle.
export function ladybird({ length = 6.5, spots = 7, seed = 7 } = {}) {
  const g = group();
  const S = length / 6.5;
  const parts = [];

  for (const side of [-1, 1]) {
    for (const hz of [0.7 * S, 0.05 * S, -0.6 * S]) {
      parts.push({
        geometry: taperedTube(
          [[side * 0.4 * S, 0.7 * S, hz], [side * 0.9 * S, 0.85 * S, hz + 0.1 * S], [side * 1.05 * S, 0.04 * S, hz + 0.2 * S]],
          [0.09 * S, 0.06 * S, 0.03 * S], { tubularSegments: 7, radialSegments: 6 },
        ),
        color: 0x1c1712,
      });
    }
  }
  // Underside and the pronotum (the black shield behind the head).
  const under = new THREE.SphereGeometry(1.02 * S, 18, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  under.scale(1, 0.42, 1.18);
  parts.push({ geometry: under, color: 0x1c1712, position: [0, 0.78 * S, 0] });
  parts.push({ geometry: new THREE.SphereGeometry(0.42 * S, 12, 10), color: 0x1c1712, position: [0, 0.72 * S, 1.02 * S] });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.14 * S, 8, 6), color: 0xf2ece0, position: [side * 0.3 * S, 0.78 * S, 1.24 * S] });
  }
  g.add(mergedMesh(parts, { roughness: 0.4, metalness: 0.15 }));

  // The shell, as its own mesh: it is the one part carrying a map, and a map multiplied by
  // a vertex colour would mud the spots.
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#cf2b23';
    ctx.fillRect(0, 0, w, h);
    // The wing-case seam runs down the middle of the back, which on a sphere's UVs is the
    // u=0.25 and u=0.75 meridians.
    ctx.fillStyle = '#1c1712';
    ctx.fillRect(w * 0.25 - 3, 0, 6, h);
    ctx.fillRect(w * 0.75 - 3, 0, 6, h);
    const rng = seededRandom(seed);
    for (let i = 0; i < spots; i++) {
      const u = i === 0 ? 0.25 : (i % 2 ? 0.13 : 0.37) + Math.floor(i / 2) * 0.005;
      const v = i === 0 ? 0.24 : 0.3 + Math.floor((i - 1) / 2) * 0.17 + randomIn(rng, -0.02, 0.02);
      for (const uu of i === 0 ? [0.25, 0.75] : [u, u + 0.5]) {
        ctx.beginPath();
        ctx.ellipse(uu * w, v * h, w * 0.055, h * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
  const shell = new THREE.SphereGeometry(1.02 * S, 26, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(1, 0.86, 1.18);
  const shellMesh = mesh(shell, standard({ map: tex, roughness: 0.22, metalness: 0.2 }));
  shellMesh.position.set(0, 0.78 * S, 0);
  g.add(shellMesh);
  return g;
}

// ---------------------------------------------------------------------------
// The colony
// ---------------------------------------------------------------------------

// The mound: a ring of excavated soil pellets round a crater, with the entrance hole in
// the middle. Ants do not dig a hole and pile the earth beside it -- they carry every
// grain out and drop it, so the mound is made of PELLETS and the slope is the angle loose
// grain happens to sit at.
export function antHill({ radius = 34, height = 15, seed = 11 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];

  // The pellets stop well short of the middle, leaving a real crater rather than a dome
  // with a dark spot painted on it. An ant mound is a ring of spoil round a hole -- the
  // hole is the whole reason the ring is there.
  const craterR = radius * 0.26;
  const rings = 10;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const ringR = radius - t * (radius - craterR * 1.34);
    const y = height * Math.sin(t * Math.PI * 0.5) ** 1.25;
    const count = Math.max(8, Math.round((2 * Math.PI * ringR) / (radius * 0.062)));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng() * 0.35;
      const pr = radius * randomIn(rng, 0.026, 0.045);
      const lump = new THREE.SphereGeometry(pr, 7, 5);
      lump.scale(1, randomIn(rng, 0.6, 0.9), 1);
      parts.push({
        geometry: lump,
        color: [SOIL, SOIL_DARK, SOIL_LIGHT, 0x7a5f3e][Math.floor(rng() * 4)],
        position: [Math.cos(a) * ringR * randomIn(rng, 0.97, 1.03), y * randomIn(rng, 0.93, 1.05), Math.sin(a) * ringR * randomIn(rng, 0.97, 1.03)],
      });
    }
  }
  // The crater lip, and the dark hole itself.
  const lip = new THREE.CylinderGeometry(craterR * 1.08, craterR * 1.42, height * 0.16, 22);
  parts.push({ geometry: lip, color: SOIL_DARK, position: [0, height * 0.9, 0] });
  g.add(mergedMesh(parts, { roughness: 1, ...relief('soil', { seed, repeat: 6 }) }));

  // The entrance. A shaft rather than a disc: a flat dark circle on top of a mound reads
  // as a painted spot, and what says "hole" is being able to see a little way down it.
  const shaft = mesh(
    new THREE.CylinderGeometry(craterR, craterR * 0.55, height * 0.6, 22, 1, true),
    standard({ color: 0x2a2018, roughness: 1, side: THREE.DoubleSide }),
  );
  shaft.position.set(0, height * 0.66, 0);
  g.add(shaft);
  const floor = mesh(new THREE.CircleGeometry(craterR * 0.55, 22), standard({ color: 0x140f0a, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, height * 0.37, 0);
  g.add(floor);
  return g;
}

// A cutaway through the nest, presented like a formicarium: a slab of soil with the
// tunnels and chambers cut out of it, and what lives in each one.
//
// This is the exhibit that carries the biology. A mound on its own says "ants live here";
// this says how the place is organised -- brood chambers near the top where it is warm,
// the granary in the middle, the queen deep down, and the midden well away from the food.
export function nestCutaway({ width = 46, height = 30, depth = 4, seed = 13 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const soil = [];

  // The soil block, built as courses of lumps so the face is not a flat wall.
  // Rows are OFFSET by half a cell on alternate courses and every lump is a different
  // size. Laid on a straight grid -- which is what the first version did -- the vertical
  // joints line up all the way down the face and a wall of soil reads as pixel art.
  const rows = 15;
  const cols = 20;
  const cw = width / cols;
  const ch = height / rows;
  for (let r = 0; r < rows; r++) {
    const stagger = (r % 2) * 0.5;
    for (let c = 0; c <= cols; c++) {
      const x = ((c + stagger) / cols - 0.5) * width + randomIn(rng, -0.12, 0.12) * cw;
      const y = (r / (rows - 1)) * height + randomIn(rng, -0.12, 0.12) * ch;
      soil.push({
        geometry: new THREE.BoxGeometry(cw * randomIn(rng, 1.15, 1.75), ch * randomIn(rng, 1.1, 1.6), depth * randomIn(rng, 0.8, 1)),
        color: [SOIL, SOIL_DARK, SOIL_LIGHT, 0x634c31, 0x7c6240][Math.floor(rng() * 5)],
        position: [x, y, randomIn(rng, -0.25, 0.25)],
        rotation: [0, 0, randomIn(rng, -0.1, 0.1)],
      });
    }
  }
  g.add(mergedMesh(soil, { roughness: 1, ...relief('soil', { seed, repeat: 7 }) }));

  // The chambers, cut forward of the soil face so they read as voids rather than as
  // decals -- the same lesson the Inca wall niches taught.
  const CHAMBERS = [
    { x: 0.0, y: 0.93, w: 0.1, h: 0.09, label: 'ENTRANCE' },
    { x: -0.26, y: 0.72, w: 0.26, h: 0.15, label: 'NURSERY' },
    { x: 0.28, y: 0.68, w: 0.24, h: 0.14, label: 'GRANARY' },
    { x: -0.3, y: 0.42, w: 0.22, h: 0.13, label: 'MIDDEN' },
    { x: 0.06, y: 0.28, w: 0.34, h: 0.17, label: "QUEEN'S CHAMBER" },
    { x: 0.34, y: 0.44, w: 0.18, h: 0.11, label: '' },
  ];
  const voids = [];
  for (const ch of CHAMBERS) {
    voids.push({
      geometry: new THREE.BoxGeometry(width * ch.w * 2, height * ch.h, depth * 0.62),
      color: 0x241a12,
      position: [width * ch.x, height * ch.y, depth * 0.34],
    });
  }
  // Tunnels joining them: short segments angled between chamber centres.
  const links = [[0, 1], [0, 2], [1, 4], [2, 5], [4, 3], [2, 4]];
  for (const [a, b] of links) {
    const A = new THREE.Vector2(width * CHAMBERS[a].x, height * CHAMBERS[a].y);
    const B = new THREE.Vector2(width * CHAMBERS[b].x, height * CHAMBERS[b].y);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const len = A.distanceTo(B);
    const tunnel = new THREE.BoxGeometry(len, height * 0.045, depth * 0.62);
    tunnel.applyMatrix4(new THREE.Matrix4()
      .makeTranslation(mid.x, mid.y, depth * 0.34)
      .multiply(new THREE.Matrix4().makeRotationZ(Math.atan2(B.y - A.y, B.x - A.x))));
    voids.push({ geometry: tunnel, color: 0x241a12 });
  }
  g.add(mergedMesh(voids, { roughness: 1 }));

  // What is in them: eggs in the nursery, seeds in the granary, the queen below.
  const stuff = [];
  const FRONT = depth * 0.68;
  for (let i = 0; i < 18; i++) {
    const e = new THREE.SphereGeometry(width * 0.016, 8, 6);
    e.scale(1, 0.72, 1.4);
    stuff.push({ geometry: e, color: 0xf0e6cf, position: [width * (-0.35 + (i % 6) * 0.034), height * (0.68 + Math.floor(i / 6) * 0.036), FRONT] });
  }
  for (let i = 0; i < 15; i++) {
    stuff.push({
      geometry: new THREE.SphereGeometry(width * randomIn(rng, 0.016, 0.024), 8, 6),
      color: [0xc9a961, 0xb8944f, 0xd8bd7c][i % 3],
      position: [width * (0.19 + (i % 5) * 0.038), height * (0.645 + Math.floor(i / 5) * 0.035), FRONT],
    });
  }
  g.add(mergedMesh(stuff, { roughness: 0.7 }));

  // The queen: the same builder, half again as long, with the huge egg-laying gaster.
  const queen = ant({ length: width * 0.15, color: 0x8a4a24, seed: seed + 1 });
  queen.position.set(width * 0.02, height * 0.24, depth * 0.62);
  queen.scale.set(1, 1, 1.35);
  g.add(queen);

  // Labels for the chambers, on the face.
  for (const ch of CHAMBERS) {
    if (!ch.label) continue;
    const tex = canvasTexture(320, 64, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(250,244,232,0.94)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#3a2c1c';
      ctx.font = 'bold 30px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch.label, w / 2, h / 2 + 2);
    });
    const panel = signPanel(width * 0.2, height * 0.038, tex);
    panel.position.set(width * ch.x, height * (ch.y - ch.h / 2 - 0.035), depth * 0.66);
    g.add(panel);
  }
  return g;
}

// A pheromone trail: the dotted line an ant lays down on its way home from food, and that
// every ant after it follows and reinforces. It is how a colony with no leader and no map
// finds the shortest route to anything.
//
// Emissive and shadowless, because it is a scent being drawn rather than an object.
export function pheromoneTrail({ length = 60, curve = 12, dots = 26, color = 0x9be8c8, seed = 17 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < dots; i++) {
    const t = i / (dots - 1);
    const z = (t - 0.5) * length;
    const x = Math.sin(t * Math.PI) * curve + randomIn(rng, -0.7, 0.7);
    const r = 0.5 + Math.sin(t * Math.PI * 3) * 0.12;
    const d = new THREE.SphereGeometry(r, 9, 7);
    d.scale(1.5, 0.24, 1.5);
    parts.push({ geometry: d, color, position: [x, 0.1, z] });
  }
  const m = mergedMesh(parts, { roughness: 0.3, emissive: new THREE.Color(color).multiplyScalar(0.55), emissiveIntensity: 0.9, transparent: true, opacity: 0.72 });
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}

// The food the colony is collecting. One builder, several kinds, because at this scale
// they are all "a lump a student can be told to go and fetch".
export function foodItem({ kind = 'crumb', size = 4, seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const S = size;

  if (kind === 'crumb') {
    // Bread: an irregular block with an open, bubbly crumb.
    for (let i = 0; i < 9; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * S * 0.34;
      parts.push({
        geometry: new THREE.BoxGeometry(S * randomIn(rng, 0.3, 0.62), S * randomIn(rng, 0.26, 0.5), S * randomIn(rng, 0.3, 0.58)),
        color: [0xe8cf9a, 0xd8b87c, 0xf0dcae][i % 3],
        position: [Math.cos(a) * r, S * randomIn(rng, 0.18, 0.42), Math.sin(a) * r],
        rotation: [randomIn(rng, -0.3, 0.3), rng() * Math.PI, randomIn(rng, -0.3, 0.3)],
      });
    }
    parts.push({ geometry: new THREE.BoxGeometry(S * 0.72, S * 0.16, S * 0.66), color: 0xa9773f, position: [0, S * 0.6, 0], rotation: [0.1, 0.4, 0.06] });
  } else if (kind === 'seed') {
    const s = new THREE.SphereGeometry(S * 0.42, 14, 10);
    s.scale(0.72, 0.68, 1.25);
    parts.push({ geometry: s, color: 0xb8944f, position: [0, S * 0.3, 0], rotation: [0, 0.4, 0] });
    parts.push({ geometry: new THREE.ConeGeometry(S * 0.1, S * 0.34, 8), color: 0x8a6c34, position: [0, S * 0.3, S * 0.52], rotation: [1.35, 0, 0] });
  } else if (kind === 'berry') {
    const b = new THREE.SphereGeometry(S * 0.5, 18, 14);
    parts.push({ geometry: b, color: 0xa8243f, position: [0, S * 0.5, 0] });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push({ geometry: new THREE.ConeGeometry(S * 0.09, S * 0.24, 6), color: LEAF_DARK, position: [Math.cos(a) * S * 0.3, S * 0.94, Math.sin(a) * S * 0.3], rotation: [0.5, -a, 0] });
    }
  } else if (kind === 'sugar') {
    // A sugar cube: stacked crystals, and deliberately the only translucent food here.
    for (let i = 0; i < 12; i++) {
      parts.push({
        geometry: new THREE.BoxGeometry(S * 0.3, S * 0.3, S * 0.3),
        color: 0xf6f4ee,
        position: [((i % 3) - 1) * S * 0.3, S * (0.16 + Math.floor(i / 6) * 0.3), (Math.floor(i / 3) % 2 - 0.5) * S * 0.3],
        rotation: [randomIn(rng, -0.12, 0.12), randomIn(rng, -0.2, 0.2), randomIn(rng, -0.12, 0.12)],
      });
    }
  } else if (kind === 'leaf-piece') {
    // A cut disc of leaf, held up on edge -- what a leafcutter carries home.
    const disc = new THREE.CylinderGeometry(S * 0.6, S * 0.6, S * 0.05, 16);
    disc.rotateX(Math.PI / 2);
    parts.push({ geometry: disc, color: LEAF_GREEN, position: [0, S * 0.62, 0], rotation: [0, 0, 0.2] });
    for (let i = 0; i < 5; i++) {
      parts.push({ geometry: new THREE.BoxGeometry(S * 0.9, S * 0.02, S * 0.06), color: LEAF_DARK, position: [0, S * 0.62, 0], rotation: [0, 0, 0.2 + (i - 2) * 0.32] });
    }
  }
  return group(mergedMesh(parts, { roughness: kind === 'sugar' ? 0.35 : 0.85, ...(kind === 'sugar' ? { metalness: 0.1 } : relief('stone', { seed, repeat: 3 })) }));
}

// ---------------------------------------------------------------------------
// The meadow, at ant scale
// ---------------------------------------------------------------------------

// A blade of grass. It is a folded strap, not a flat ribbon -- there is a keel down the
// middle, which is what catches the light and stops it reading as a strip of paper -- and
// it arches over near the top under its own weight.
export function grassBlade({ height = 46, lean = 0.5, seed = 23 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const width = height * 0.05;
  const segs = 12;
  const bend = randomIn(rng, 0.5, 1.0) * lean;
  const yaw = rng() * Math.PI * 2;

  // The blade is sampled along a real CURVE and each segment is laid between two
  // consecutive points on it, oriented to the direction between them.
  //
  // The first version placed each segment at its own height and rotated it by the local
  // slope, which is not the same thing at all: the sideways displacement grows far faster
  // than the segment spacing, so by halfway up the blade the pieces no longer touch. From
  // any distance a clump of them read as a scatter of green dashes hanging in mid-air.
  // Interpolating positions and deriving the rotation FROM them cannot come apart.
  const tip = new THREE.Vector3(Math.cos(yaw) * height * bend * 0.62, height * 0.94, Math.sin(yaw) * height * bend * 0.62);
  const ctrl = new THREE.Vector3(Math.cos(yaw) * height * bend * 0.06, height * 0.62, Math.sin(yaw) * height * bend * 0.06);
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), ctrl, tip);
  const pts = curve.getPoints(segs);

  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    dir.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) continue;
    dir.normalize();
    mid.addVectors(a, b).multiplyScalar(0.5);
    q.setFromUnitVectors(up, dir);
    const t = i / segs;
    const w = width * (1 - t * 0.8);
    // A blade is a folded strap: wide one way, thin the other, with a keel down the
    // middle. Flat and it is a strip of paper; the fold is what catches the light.
    const seg = new THREE.BoxGeometry(w, len * 1.12, w * 0.3);
    seg.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    parts.push({ geometry: seg, color: [LEAF_GREEN, LEAF_DARK, LEAF_LIGHT][i % 3] });
    const keel = new THREE.BoxGeometry(w * 0.26, len * 1.12, w * 0.62);
    keel.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)));
    parts.push({ geometry: keel, color: LEAF_LIGHT });
  }
  // A sheath at the very bottom, so the blade rises out of something instead of being
  // stuck into the soil like a pin.
  parts.push({ geometry: new THREE.CylinderGeometry(width * 0.36, width * 0.55, height * 0.08, 7), color: 0x6f8f42, position: [0, height * 0.04, 0] });
  return group(mergedMesh(parts, { roughness: 0.82, side: THREE.DoubleSide }));
}

// A tuft of them, merged into one mesh.
export function grassClump({ height = 46, count = 7, spread = 6, seed = 29 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * spread;
    const blade = grassBlade({ height: height * randomIn(rng, 0.66, 1.12), lean: randomIn(rng, 0.4, 1.1), seed: seed + i * 7 });
    blade.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.add(blade);
  }
  return g;
}

// White clover: three heart-shaped leaflets on one stalk, each with the pale chevron that
// makes it recognisable from across a lawn.
export function clover({ height = 17, seed = 31 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const S = height / 17;

  parts.push({ geometry: new THREE.CylinderGeometry(0.28 * S, 0.4 * S, height * 0.72, 8), color: 0x4a7a30, position: [0, height * 0.36, 0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng();
    // Each leaflet is two overlapping lobes with a notch -- a plain disc is a lily pad.
    for (const lobe of [-1, 1]) {
      const l = new THREE.SphereGeometry(3.1 * S, 12, 8);
      l.scale(1, 0.13, 1.15);
      parts.push({
        geometry: l,
        color: [LEAF_GREEN, 0x57933a][i % 2],
        position: [Math.cos(a) * 4.2 * S + Math.cos(a + lobe * 1.15) * 2.1 * S, height * 0.74, Math.sin(a) * 4.2 * S + Math.sin(a + lobe * 1.15) * 2.1 * S],
        rotation: [Math.sin(a) * 0.16, 0, -Math.cos(a) * 0.16],
      });
    }
    // The chevron.
    const band = new THREE.TorusGeometry(2.0 * S, 0.28 * S, 5, 14, Math.PI * 0.85);
    band.rotateX(Math.PI / 2);
    parts.push({ geometry: band, color: 0xd6e6c2, position: [Math.cos(a) * 4.4 * S, height * 0.76, Math.sin(a) * 4.4 * S], rotation: [0, -a + Math.PI / 2, 0] });
  }
  g.add(mergedMesh(parts, { roughness: 0.85, side: THREE.DoubleSide, ...relief('bark', { seed, repeat: 3 }) }));
  return g;
}

// A dandelion clock. The pappus is a ball of individual parachutes on stalks -- painted as
// a solid fuzzy sphere it reads as a cotton bud, and the whole charm of the thing is that
// you can see through it.
export function dandelionClock({ height = 40, seed = 37 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const stem = [];
  stem.push({ geometry: new THREE.CylinderGeometry(0.55, 0.85, height * 0.78, 9), color: 0x6f8f42, position: [0, height * 0.39, 0] });
  stem.push({ geometry: new THREE.SphereGeometry(1.6, 10, 8), color: 0x7d9a4a, position: [0, height * 0.79, 0] });
  g.add(mergedMesh(stem, { roughness: 0.9, ...relief('bark', { seed, repeat: 3 }) }));

  const seeds = [];
  const R = height * 0.19;
  const n = 90;
  for (let i = 0; i < n; i++) {
    // Fibonacci sphere, so the parachutes are evenly spread instead of clustered at poles.
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(theta) * rad, y, Math.sin(theta) * rad);
    const base = dir.clone().multiplyScalar(R * 0.18);
    const tip = dir.clone().multiplyScalar(R);
    const stalk = new THREE.CylinderGeometry(0.07, 0.11, R * 0.82, 4);
    const m = new THREE.Matrix4().lookAt(base, tip, new THREE.Vector3(0, 1, 0));
    stalk.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    stalk.applyMatrix4(m);
    stalk.translate(base.x + dir.x * R * 0.42, base.y + dir.y * R * 0.42 + height * 0.86, base.z + dir.z * R * 0.42);
    seeds.push({ geometry: stalk, color: 0xf2ecdc });
    const puff = new THREE.SphereGeometry(R * randomIn(rng, 0.08, 0.12), 6, 4);
    seeds.push({ geometry: puff, color: 0xfbf7ec, position: [tip.x, tip.y + height * 0.86, tip.z] });
  }
  const m = mergedMesh(seeds, { roughness: 1, transparent: true, opacity: 0.9 });
  m.castShadow = false;
  g.add(m);
  return g;
}

// A fallen leaf lying on the ground. Big enough to walk on, which is the point of it --
// at this scale a leaf is a floor.
export function fallenLeaf({ length = 34, color = 0x8a6a2c, seed = 41 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const W = length * 0.52;
  const segs = 11;
  for (let i = 0; i < segs; i++) {
    const t = (i + 0.5) / segs;
    // An ellipse pinched to a point at both ends, which is a leaf; an actual ellipse is a
    // surfboard.
    const w = W * Math.sin(Math.PI * t) ** 0.72;
    const seg = new THREE.BoxGeometry(w, length * 0.016, length / segs * 1.1);
    parts.push({
      geometry: seg,
      color: i % 2 ? color : new THREE.Color(color).offsetHSL(0, 0, 0.05).getHex(),
      position: [Math.sin(t * Math.PI) * length * 0.03, length * (0.016 + Math.sin(t * Math.PI) * 0.05), (t - 0.5) * length],
      rotation: [0, 0, randomIn(rng, -0.05, 0.05)],
    });
  }
  // Midrib and side veins.
  parts.push({ geometry: new THREE.BoxGeometry(length * 0.03, length * 0.024, length * 0.98), color: new THREE.Color(color).offsetHSL(0, 0.05, -0.12).getHex(), position: [0, length * 0.055, 0] });
  for (let i = 0; i < 7; i++) {
    const t = (i + 1) / 8;
    const w = W * Math.sin(Math.PI * t) ** 0.72;
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(w * 0.9, length * 0.012, length * 0.014),
        color: new THREE.Color(color).offsetHSL(0, 0.04, -0.08).getHex(),
        position: [side * w * 0.24, length * (0.05 + Math.sin(t * Math.PI) * 0.045), (t - 0.5) * length],
        rotation: [0, side * 0.5, 0],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.9, side: THREE.DoubleSide, ...relief('bark', { seed, repeat: 4 }) }));
}

// A fallen twig. At ant scale this is a felled tree, and it is the obvious thing to build a
// bridge out of.
export function twig({ length = 54, thickness = 2.6, seed = 43 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const pts = [];
  const radii = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    pts.push([randomIn(rng, -1, 1) * length * 0.03, thickness * 0.9, (t - 0.5) * length]);
    radii.push(thickness * (1 - t * 0.42) * randomIn(rng, 0.9, 1.08));
  }
  parts.push({ geometry: taperedTube(pts, radii, { tubularSegments: 16, radialSegments: 9 }), color: 0x6b533a });
  // A couple of side branches, so it is a twig and not a dowel.
  for (let i = 0; i < 2; i++) {
    const t = 0.3 + i * 0.34;
    const a = rng() * Math.PI * 2;
    parts.push({
      geometry: taperedTube(
        [[0, thickness * 0.9, (t - 0.5) * length],
          [Math.cos(a) * length * 0.09, thickness * 1.5, (t - 0.5) * length + Math.sin(a) * length * 0.07],
          [Math.cos(a) * length * 0.17, thickness * 1.9, (t - 0.5) * length + Math.sin(a) * length * 0.13]],
        [thickness * 0.42, thickness * 0.26, thickness * 0.08], { tubularSegments: 8, radialSegments: 7 },
      ),
      color: 0x5d472f,
    });
  }
  return group(mergedMesh(parts, { roughness: 0.96, ...relief('bark', { seed, repeat: 5 }) }));
}

// Pebbles. Boulders, from down here.
export function pebbleField({ spread = 16, count = 7, size = 6, seed = 47 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * spread;
    const s = size * randomIn(rng, 0.5, 1.3);
    // SphereGeometry, not Icosahedron: anything from PolyhedronGeometry is non-indexed and
    // therefore flat-shaded whatever the material says. A pebble is worn smooth.
    const p = new THREE.SphereGeometry(s * 0.5, 12, 9);
    p.scale(randomIn(rng, 0.8, 1.3), randomIn(rng, 0.5, 0.8), randomIn(rng, 0.8, 1.3));
    parts.push({
      geometry: p,
      color: [0x9a948a, 0x847e74, 0xaaa298, 0x767068][i % 4],
      position: [Math.cos(a) * r, s * 0.22, Math.sin(a) * r],
      rotation: [randomIn(rng, -0.2, 0.2), rng() * Math.PI, randomIn(rng, -0.2, 0.2)],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.94, ...relief('stone', { seed, repeat: 3 }) }));
}

// A toadstool. Cap, stem, ring, and gills underneath -- the gills are what make it a
// mushroom rather than an umbrella, and they are only visible from ant height, which is
// exactly where the student is.
export function toadstool({ height = 22, capColor = 0xc4402e, seed = 53 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const capR = height * 0.62;

  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.1, height * 0.16, height * 0.86, 12), color: 0xf0e8d6, position: [0, height * 0.43, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(height * 0.19, height * 0.15, height * 0.05, 12), color: 0xe4dac2, position: [0, height * 0.66, 0] });

  // Gills: a radial fan under the cap.
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(capR * 0.78, height * 0.035, height * 0.012),
      color: 0xe8dcc4,
      position: [Math.cos(a) * capR * 0.46, height * 0.85, Math.sin(a) * capR * 0.46],
      rotation: [0, -a, 0],
    });
  }
  g.add(mergedMesh(parts, { roughness: 0.88, ...relief('bark', { seed, repeat: 3 }) }));

  const cap = new THREE.SphereGeometry(capR, 22, 14, 0, Math.PI * 2, 0, Math.PI * 0.52);
  cap.scale(1, 0.62, 1);
  const capMesh = mesh(cap, standard({ color: capColor, roughness: 0.62, ...relief('stone', { seed, repeat: 4 }) }));
  capMesh.position.y = height * 0.86;
  g.add(capMesh);

  // Warts.
  const warts = [];
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 0.86;
    const y = Math.sqrt(Math.max(0, 1 - d * d)) * 0.62;
    warts.push({
      geometry: new THREE.SphereGeometry(capR * randomIn(rng, 0.05, 0.09), 8, 6),
      color: 0xf6f1e4,
      position: [Math.cos(a) * capR * d, height * 0.86 + y * capR * 0.96, Math.sin(a) * capR * d],
    });
  }
  g.add(mergedMesh(warts, { roughness: 0.9 }));
  return g;
}

// A bead of water sitting on the soil. Surface tension holds a drop this size in a dome
// rather than a puddle, and at ant scale it is an obstacle you have to build across.
export function waterDrop({ radius = 13, seed = 59 } = {}) {
  const g = group();
  const dome = new THREE.SphereGeometry(radius, 30, 20, 0, Math.PI * 2, 0, Math.PI * 0.58);
  dome.scale(1, 0.52, 1);
  const m = mesh(dome, standard({
    color: 0x9fd6e8, roughness: 0.04, metalness: 0.25,
    transparent: true, opacity: 0.62, side: THREE.DoubleSide,
  }));
  m.castShadow = false;
  g.add(m);
  // A darker wet ring where it meets the soil, which is what seats it on the ground.
  const ring = mesh(new THREE.RingGeometry(radius * 0.94, radius * 1.16, 30), standard({ color: 0x4a3a26, roughness: 1 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  ring.castShadow = false;
  g.add(ring);
  return g;
}
