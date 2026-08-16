import * as THREE from 'three';
import {
  standard, mesh, box, cyl, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn, roughenSphere,
} from '../PropKit.js';

// The Delta River Boat -- a sternwheel packet at a Mississippi landing, about 1870, at
// golden hour.
//
// The boat is the world. Everything else is there to give it somewhere to be: the levee it
// is tied to, the cypress swamp behind, the cargo it came for. So the steamer is built at
// close to true size -- a middling packet was around 180ft, and this one is 120 -- and it
// is the one object a student is meant to walk the whole length of.
//
// Three things make a sternwheeler read correctly, and all three are commonly got wrong:
// the hull is almost FLAT-BOTTOMED and draws only a few feet (these boats worked water "too
// thick to drink and too thin to plough"); the decks are open galleries with turned posts,
// not solid walls; and the twin chimneys are TALL and stand forward, near the bow, not
// amidships -- because the boilers are forward and the engines are aft, driving the wheel.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const WHITE = 0xe8e2d4;
const WHITE_SHADE = 0xd0c9ba;
const HULL = 0x4a3f31;
const RED = 0x9a3226;
const IRON = 0x33312c;
const TIMBER = 0x6b5842;

// ---------------------------------------------------------------------------
// The steamer
// ---------------------------------------------------------------------------

export function paddleSteamer({ length = 120, seed = 5, name = 'DELTA QUEEN' } = {}) {
  const g = group();
  const parts = [];
  const white = [];
  const beam = length * 0.24;
  const hullH = length * 0.055;
  const waterline = 0.9; // the boat sits in the river, not on the ground

  // --- Hull ---------------------------------------------------------------
  // Flat-bottomed and barge-like, with a spoon bow. Built as a box with a tapered forward
  // section rather than a swept tube: these hulls really are slab-sided, and a rounded
  // tube reads as a seagoing ship.
  parts.push({ geometry: new THREE.BoxGeometry(beam, hullH, length * 0.78), color: HULL, position: [0, waterline + hullH / 2, -length * 0.04] });
  const bow = taperedTube(
    [[0, waterline + hullH / 2, length * 0.35], [0, waterline + hullH / 2, length * 0.44], [0, waterline + hullH * 0.62, length * 0.5]],
    [beam * 0.5, beam * 0.4, beam * 0.16],
    { tubularSegments: 10, radialSegments: 10 },
  );
  bow.scale(1, hullH / (beam * 0.9), 1);
  parts.push({ geometry: bow, color: HULL });
  // Guards -- the decks overhang the hull well past its sides, which is why these boats
  // look so wide for their draft.
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.34, 0.5, length * 0.84), color: HULL, position: [0, waterline + hullH, -length * 0.04] });
  // Boot stripe.
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.02, 0.8, length * 0.79), color: RED, position: [0, waterline + hullH * 0.2, -length * 0.04] });

  // --- Main deck ----------------------------------------------------------
  const deck1 = waterline + hullH + 0.5;
  white.push({ geometry: new THREE.BoxGeometry(beam * 1.34, 0.4, length * 0.84), color: WHITE, position: [0, deck1, -length * 0.04] });

  // Boilers forward, on the main deck: a row of cylinders. Visible, because on a real
  // packet they are right out in the open and they are what everyone crowded round.
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.CylinderGeometry(beam * 0.1, beam * 0.1, length * 0.16, 14),
      color: IRON,
      position: [(i - 1.5) * beam * 0.22, deck1 + beam * 0.12, length * 0.22],
      rotation: [Math.PI / 2, 0, 0],
    });
  }
  // Firebox doors.
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.CylinderGeometry(beam * 0.055, beam * 0.055, 0.3, 10),
      color: 0x1a1712,
      position: [(i - 1.5) * beam * 0.22, deck1 + beam * 0.12, length * 0.3],
      rotation: [Math.PI / 2, 0, 0],
    });
  }

  // --- Upper decks --------------------------------------------------------
  // Two more galleries, each shorter than the one below. The posts are what make it a
  // riverboat: slim turned columns with fretwork between them, not walls.
  const deckHeights = [length * 0.09, length * 0.155];
  const deckLengths = [0.78, 0.62];
  for (let d = 0; d < 2; d++) {
    const y = deck1 + deckHeights[d];
    const dl = length * deckLengths[d];
    const dw = beam * (1.28 - d * 0.14);
    white.push({ geometry: new THREE.BoxGeometry(dw, 0.36, dl), color: d === 0 ? WHITE : WHITE_SHADE, position: [0, y, -length * 0.04] });

    // Cabin block, inset from the deck edge so there is a promenade all round.
    white.push({
      geometry: new THREE.BoxGeometry(dw * 0.72, deckHeights[d] === deckHeights[1] ? length * 0.05 : length * 0.062, dl * 0.88),
      color: WHITE,
      position: [0, y + (d === 0 ? length * 0.031 : length * 0.025), -length * 0.04],
    });

    // Windows and doors along the cabin.
    const bays = 14 - d * 3;
    for (let i = 0; i < bays; i++) {
      const z = -length * 0.04 - dl * 0.4 + (i / (bays - 1)) * dl * 0.8;
      for (const side of [-1, 1]) {
        parts.push({
          geometry: new THREE.BoxGeometry(0.3, length * 0.026, length * 0.018),
          color: 0x2f2a22,
          position: [side * dw * 0.36, y + length * 0.028, z],
        });
      }
    }

    // Posts and fretwork -- the gingerbread. Twenty slim posts a side, with a scalloped
    // valance between them, is the single most recognisable thing about these boats.
    const posts = 18 - d * 3;
    for (let i = 0; i < posts; i++) {
      const z = -length * 0.04 - dl * 0.44 + (i / (posts - 1)) * dl * 0.88;
      for (const side of [-1, 1]) {
        white.push({
          geometry: new THREE.CylinderGeometry(length * 0.006, length * 0.007, deckHeights[Math.min(d + 1, 1)] - deckHeights[d] || length * 0.065, 8),
          color: WHITE,
          position: [side * dw * 0.48, y + (length * 0.065) / 2, z],
        });
        // Scalloped valance.
        white.push({
          geometry: new THREE.BoxGeometry(0.16, length * 0.014, dl * 0.88 / posts * 0.8),
          color: WHITE,
          position: [side * dw * 0.48, y + length * 0.058, z],
        });
      }
    }
    // Railing.
    for (const side of [-1, 1]) {
      white.push({ geometry: new THREE.BoxGeometry(0.14, 0.14, dl * 0.92), color: WHITE, position: [side * dw * 0.48, y + length * 0.022, -length * 0.04] });
    }
  }

  // --- Pilot house --------------------------------------------------------
  const phY = deck1 + deckHeights[1] + length * 0.05;
  white.push({ geometry: new THREE.BoxGeometry(beam * 0.44, length * 0.042, beam * 0.4), color: WHITE, position: [0, phY + length * 0.021, length * 0.14] });
  // Windows all round -- a pilot house is nearly all glass.
  for (let i = 0; i < 5; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(beam * 0.075, length * 0.026, 0.3),
      color: 0x3a4a52,
      position: [-beam * 0.16 + i * beam * 0.08, phY + length * 0.026, length * 0.14 + beam * 0.2],
    });
  }
  // Roof and the bell.
  white.push({ geometry: new THREE.BoxGeometry(beam * 0.52, 0.3, beam * 0.48), color: WHITE_SHADE, position: [0, phY + length * 0.043, length * 0.14] });
  parts.push({ geometry: new THREE.CylinderGeometry(beam * 0.05, beam * 0.07, beam * 0.09, 12), color: 0xb08d4a, position: [0, phY + length * 0.058, length * 0.2] });

  // --- Chimneys -----------------------------------------------------------
  // Tall, forward, and crowned with the fluted "feather" tops these boats carried. The
  // height is functional: it is what makes the draught that keeps the fires hot.
  for (const side of [-1, 1]) {
    const cx = side * beam * 0.26;
    const cz = length * 0.26;
    parts.push({ geometry: new THREE.CylinderGeometry(beam * 0.055, beam * 0.06, length * 0.3, 14), color: IRON, position: [cx, deck1 + length * 0.16, cz] });
    // The feathered crown.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push({
        geometry: new THREE.BoxGeometry(beam * 0.016, length * 0.03, beam * 0.03),
        color: IRON,
        position: [cx + Math.cos(a) * beam * 0.062, deck1 + length * 0.32, cz + Math.sin(a) * beam * 0.062],
        rotation: [Math.cos(a) * 0.3, -a, Math.sin(a) * 0.3],
      });
    }
    // Guy wires to the deck, which every one of these had.
    parts.push({
      geometry: new THREE.CylinderGeometry(0.06, 0.06, length * 0.2, 4),
      color: 0x4a453c,
      position: [cx, deck1 + length * 0.14, cz - length * 0.06],
      rotation: [0.5, 0, 0],
    });
  }

  // --- The sternwheel -----------------------------------------------------
  // The whole reason it is called a sternwheeler, and it must be BIG -- as tall as two
  // decks. Built as a pair of rims with radial arms and flat paddle buckets between them.
  const wheelR = length * 0.105;
  const wheelZ = -length * 0.46;
  const wheelY = waterline + hullH * 0.5 + wheelR * 0.55;
  for (const side of [-1, 1]) {
    const rim = new THREE.TorusGeometry(wheelR, length * 0.006, 6, 26);
    parts.push({ geometry: rim, color: RED, position: [side * beam * 0.42, wheelY, wheelZ], rotation: [0, Math.PI / 2, 0] });
    const rim2 = new THREE.TorusGeometry(wheelR * 0.55, length * 0.005, 6, 20);
    parts.push({ geometry: rim2, color: RED, position: [side * beam * 0.42, wheelY, wheelZ], rotation: [0, Math.PI / 2, 0] });
  }
  const buckets = 16;
  for (let i = 0; i < buckets; i++) {
    const a = (i / buckets) * Math.PI * 2;
    // The paddle bucket.
    parts.push({
      geometry: new THREE.BoxGeometry(beam * 0.84, length * 0.026, length * 0.008),
      color: TIMBER,
      position: [0, wheelY + Math.sin(a) * wheelR, wheelZ + Math.cos(a) * wheelR],
      rotation: [-a, 0, 0],
    });
    // Radial arms each side.
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(length * 0.005, wheelR, length * 0.008),
        color: RED,
        position: [side * beam * 0.42, wheelY + Math.sin(a) * wheelR * 0.5, wheelZ + Math.cos(a) * wheelR * 0.5],
        rotation: [-a, 0, 0],
      });
    }
  }
  // Shaft and the pitman arms driving it from the engines.
  parts.push({ geometry: new THREE.CylinderGeometry(length * 0.011, length * 0.011, beam * 0.95, 12), color: IRON, position: [0, wheelY, wheelZ], rotation: [0, 0, Math.PI / 2] });
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(length * 0.008, length * 0.008, length * 0.17),
      color: IRON,
      position: [side * beam * 0.36, wheelY + wheelR * 0.4, wheelZ + length * 0.09],
      rotation: [0.35, 0, 0],
    });
  }

  // Name boards on the paddle box and between the chimneys.
  const nameTex = canvasTexture(768, 192, (ctx, w, h) => {
    ctx.fillStyle = '#e8e2d4'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9a3226'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#9a3226';
    ctx.textAlign = 'center';
    ctx.font = 'bold 84px Georgia, serif';
    ctx.fillText(name, w / 2, h * 0.66);
  });
  const board = signPanel(beam * 0.9, length * 0.028, nameTex);
  board.position.set(0, deck1 + deckHeights[1] + length * 0.02, length * 0.335);
  g.add(board);

  g.add(mergedMesh(parts, { roughness: 0.8, metalness: 0.18, ...relief('wood', { seed, repeat: 8 }) }));
  g.add(mergedMesh(white, { roughness: 0.85, ...relief('wood', { seed: seed + 2, repeat: 7 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// The landing
// ---------------------------------------------------------------------------

// A cotton bale: a compressed block wrapped in jute and bound with iron bands. Stacked on
// the levee they are what the boat came for, and a Delta landing is mostly bales.
export function cottonBales({ count = 14, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / 5);
    const w = 4.4, h = 2.6, d = 2.4;
    const x = (i % 5) * (w + 0.3) - 2 * (w + 0.3) + randomIn(rng, -0.2, 0.2);
    const z = randomIn(rng, -0.6, 0.6) + layer * 0.4;
    const y = layer * (h + 0.12) + h / 2;
    const rotY = randomIn(rng, -0.08, 0.08);
    parts.push({ geometry: new THREE.BoxGeometry(w, h, d), color: [0xbdb096, 0xc9bfa6, 0xafa288][i % 3], position: [x, y, z], rotation: [0, rotY, 0] });
    // Iron bands -- six to a bale, and they are what stops it reading as a hay block.
    for (const t of [-0.3, 0, 0.3]) {
      parts.push({
        geometry: new THREE.BoxGeometry(w * 0.05, h * 1.03, d * 1.03),
        color: 0x4a453c,
        position: [x + Math.cos(rotY) * w * t, y, z - Math.sin(rotY) * w * t],
        rotation: [0, rotY, 0],
      });
    }
    // Cotton bursting out of the corners.
    if (i % 3 === 0) {
      parts.push({
        geometry: roughenSphere(new THREE.SphereGeometry(0.35, 8, 6), { amount: 0.4 }),
        color: 0xf0ece0,
        position: [x + w * 0.44, y + h * 0.3, z + d * 0.4],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.95, ...relief('weave', { seed, repeat: 5 }) }));
}

// The levee and its landing stage: a sloped earth bank faced with timber, with a stage and
// a gangplank. Steamboats did not use piers -- they nosed straight into the bank and ran a
// stage out, which is why a Delta landing has no dock.
export function leveeLanding({ width = 46, seed = 17 } = {}) {
  const g = group();
  const parts = [];

  // The bank: a wedge of earth sloping down to the water.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    parts.push({
      geometry: new THREE.BoxGeometry(width, 1.2, 5),
      color: i % 2 ? 0x6b5f45 : 0x7d7055,
      position: [0, 4.2 - t * 4.2, -8 + t * 15],
    });
  }
  // Timber facing on the slope.
  for (let i = 0; i < 12; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width / 12 * 0.9, 0.4, 17),
      color: [0x5f5040, TIMBER, 0x4a3f31][i % 3],
      position: [-width / 2 + (i + 0.5) * (width / 12), 2.4, -1],
      rotation: [-0.5, 0, 0],
    });
  }
  // Mooring posts and a capstan.
  for (const x of [-width * 0.36, width * 0.36]) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.7, 0.85, 4.2, 10), color: 0x4a3f31, position: [x, 4.4, -8] });
    parts.push({ geometry: new THREE.SphereGeometry(0.8, 10, 8), color: 0x4a3f31, position: [x, 6.5, -8] });
  }
  parts.push({ geometry: new THREE.CylinderGeometry(1.3, 1.6, 2.4, 12), color: IRON, position: [0, 5.4, -10] });

  g.add(mergedMesh(parts, { roughness: 0.94, ...relief('soil', { seed, repeat: 6 }) }));

  // The stage -- a long plank gangway running down to the water, which is how everything
  // and everyone got on and off.
  const stage = [];
  for (let i = 0; i < 5; i++) {
    stage.push({
      geometry: new THREE.BoxGeometry(1.5, 0.28, 26),
      color: i % 2 ? TIMBER : 0x7d6a50,
      position: [-3 + i * 1.6, 3.0, 12],
      rotation: [-0.22, 0, 0],
    });
  }
  for (const side of [-1, 1]) {
    stage.push({ geometry: new THREE.BoxGeometry(0.2, 0.2, 26), color: 0x5f5040, position: [side * 4.2, 4.4, 12], rotation: [-0.22, 0, 0] });
    for (let i = 0; i < 5; i++) {
      stage.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6), position: [side * 4.2, 3.9 + i * 0.02, 2 + i * 5], color: 0x5f5040 });
    }
  }
  g.add(mergedMesh(stage, { roughness: 0.9, ...relief('wood', { seed: seed + 2, repeat: 5 }) }));
  return g;
}

// A bald cypress -- the tree of the Delta swamp. Three features and nothing else matters:
// a hugely FLARED buttressed base, the "knees" standing up out of the water around it, and
// a thin flat-topped crown draped in Spanish moss.
export function cypressTree({ height = 42, seed = 23, moss = true } = {}) {
  const parts = [];
  const rng = seededRandom(seed);
  const bark = 0x6b5a48;
  const barkDark = 0x53463a;

  // The trunk: a very wide flare for the first fifth, then almost parallel.
  const trunk = taperedTube(
    [
      [0, 0, 0],
      [0, height * 0.08, 0],
      [0, height * 0.2, 0],
      [randomIn(rng, -0.4, 0.4), height * 0.55, randomIn(rng, -0.4, 0.4)],
      [randomIn(rng, -0.7, 0.7), height * 0.86, randomIn(rng, -0.7, 0.7)],
    ],
    [height * 0.1, height * 0.06, height * 0.038, height * 0.026, height * 0.016],
    { tubularSegments: 22, radialSegments: 14 },
  );
  parts.push({ geometry: trunk, color: bark });

  // Buttress fins round the base -- a cypress's flare is fluted, not a smooth cone.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const fin = taperedTube(
      [
        [Math.cos(a) * height * 0.1, 0, Math.sin(a) * height * 0.1],
        [Math.cos(a) * height * 0.06, height * 0.09, Math.sin(a) * height * 0.06],
        [Math.cos(a) * height * 0.03, height * 0.2, Math.sin(a) * height * 0.03],
      ],
      [height * 0.022, height * 0.014, height * 0.007],
      { tubularSegments: 8, radialSegments: 6 },
    );
    parts.push({ geometry: fin, color: barkDark });
  }

  // The knees -- pneumatophores. Nobody is certain what they do, which is worth a placard.
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2;
    const d = height * randomIn(rng, 0.12, 0.3);
    const kh = height * randomIn(rng, 0.03, 0.075);
    const knee = taperedTube(
      [[Math.cos(a) * d, 0, Math.sin(a) * d], [Math.cos(a) * d * 1.03, kh * 0.6, Math.sin(a) * d * 1.03], [Math.cos(a) * d * 1.02, kh, Math.sin(a) * d * 1.02]],
      [height * 0.016, height * 0.011, height * 0.004],
      { tubularSegments: 7, radialSegments: 7 },
    );
    parts.push({ geometry: knee, color: barkDark });
  }

  // Branches and a flat, sparse crown -- a cypress is not a lollipop.
  const foliage = [];
  const branches = 7;
  for (let i = 0; i < branches; i++) {
    const t = 0.58 + (i / branches) * 0.4;
    const a = (i / branches) * Math.PI * 2 + rng();
    const len = height * randomIn(rng, 0.13, 0.24) * (1 - (t - 0.58) * 0.8);
    const y = height * t;
    const br = taperedTube(
      [[0, y, 0], [Math.cos(a) * len * 0.5, y + height * 0.02, Math.sin(a) * len * 0.5], [Math.cos(a) * len, y + height * 0.015, Math.sin(a) * len]],
      [height * 0.012, height * 0.007, height * 0.003],
      { tubularSegments: 8, radialSegments: 6 },
    );
    parts.push({ geometry: br, color: barkDark });
    // Needle sprays -- flattened, so the crown is a layer rather than a ball.
    for (let s = 0; s < 3; s++) {
      const sd = len * (0.4 + s * 0.28);
      const spray = roughenSphere(new THREE.SphereGeometry(height * randomIn(rng, 0.035, 0.06), 10, 8), { amount: 0.3, flatten: 0.42 });
      foliage.push({
        geometry: spray,
        color: [0x5c7a4a, 0x6b8a52, 0x4e6b3e][s % 3],
        position: [Math.cos(a) * sd, y + height * 0.018, Math.sin(a) * sd],
      });
    }
  }

  // Spanish moss: hanging strands. It is not a parasite and not a moss -- it is an
  // air plant related to the pineapple, which is a fact worth a sign.
  if (moss) {
    for (let i = 0; i < 22; i++) {
      const a = rng() * Math.PI * 2;
      const d = height * randomIn(rng, 0.08, 0.22);
      const y = height * randomIn(rng, 0.6, 0.92);
      const drop = height * randomIn(rng, 0.06, 0.18);
      const strand = taperedTube(
        [
          [Math.cos(a) * d, y, Math.sin(a) * d],
          [Math.cos(a) * d * 1.05, y - drop * 0.5, Math.sin(a) * d * 1.05],
          [Math.cos(a) * d * 1.02, y - drop, Math.sin(a) * d * 1.02],
        ],
        [height * 0.012, height * 0.009, height * 0.004],
        { tubularSegments: 8, radialSegments: 5 },
      );
      foliage.push({ geometry: strand, color: [0x9a9a7c, 0x8a8a6e, 0xa8a68a][i % 3] });
    }
  }

  return group(
    mergedMesh(parts, { roughness: 0.94, ...relief('bark', { seed, repeat: 5 }) }),
    mergedMesh(foliage, { roughness: 0.92, flatShading: false }),
  );
}

// A pirogue -- the flat-bottomed Cajun dug-out, poled through water too shallow for
// anything else.
export function pirogue({ length = 14, seed = 29 } = {}) {
  const parts = [];
  const wood = 0x7d6446;

  const hull = taperedTube(
    [[0, 0.5, -length / 2], [0, 0.32, -length * 0.2], [0, 0.32, length * 0.2], [0, 0.5, length / 2]],
    [0.16, length * 0.075, length * 0.075, 0.16],
    { tubularSegments: 22, radialSegments: 12 },
  );
  hull.scale(1, 0.5, 1);
  parts.push({ geometry: hull, color: wood });
  // Gunwales and thwarts.
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.18, 0.16, length * 0.86), color: 0x5f5040, position: [side * length * 0.072, 0.62, 0] });
  }
  for (const z of [-length * 0.2, 0, length * 0.2]) {
    parts.push({ geometry: new THREE.BoxGeometry(length * 0.15, 0.14, 0.6), color: 0x5f5040, position: [0, 0.58, z] });
  }
  // A pole lying across it.
  parts.push({ geometry: new THREE.CylinderGeometry(0.09, 0.07, length * 1.1, 8), color: 0x8a7150, position: [0, 0.72, 0], rotation: [0, 0.12, Math.PI / 2] });
  return group(mergedMesh(parts, { roughness: 0.9, ...relief('wood', { seed, repeat: 5 }) }));
}

// A channel marker: the day board that told a pilot where the safe water was. River
// navigation was memory work -- Mark Twain's whole point in Life on the Mississippi is
// that a pilot had to know the shape of a river that changed every season.
export function channelMarker({ height = 14, seed = 31, red = true } = {}) {
  const g = group();
  const post = standard({ color: 0x5f5040, roughness: 0.9, ...relief('wood', { seed, repeat: 4 }) });
  g.add(cyl(0.3, 0.4, height, post, 0, height / 2, 0, 10));
  const board = red
    ? mesh(new THREE.CylinderGeometry(0, 2.0, 3.4, 3), standard({ color: 0xb5382a, roughness: 0.85 }), 0, height - 1.6, 0.2)
    : mesh(new THREE.BoxGeometry(3.0, 3.0, 0.24), standard({ color: 0x2f6b3a, roughness: 0.85 }), 0, height - 1.6, 0.2);
  if (!red) board.rotation.z = Math.PI / 4;
  g.add(board);
  return g;
}

// Reeds and river grass along the bank.
export function reedBed({ radius = 8, count = 90, seed = 37 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    const h = randomIn(rng, 3, 7);
    const lean = randomIn(rng, -0.22, 0.22);
    parts.push({
      geometry: new THREE.CylinderGeometry(0.03, 0.07, h, 4),
      color: [0x7d8a52, 0x6b7a48, 0x8e9a60, 0xa89a68][i % 4],
      position: [Math.cos(a) * d, h / 2, Math.sin(a) * d],
      rotation: [lean, 0, randomIn(rng, -0.22, 0.22)],
    });
    // Seed heads on some.
    if (i % 4 === 0) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.11, 0.06, 0.9, 5),
        color: 0x8a7550,
        position: [Math.cos(a) * d + lean * h * 0.5, h + 0.35, Math.sin(a) * d],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.95, flatShading: true }));
}
