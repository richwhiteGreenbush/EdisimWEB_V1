import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn, roughenSphere,
} from '../PropKit.js';

// Ellis Island, 1907 -- the busiest year the station ever had: 1,004,756 people came
// through. The world is the harbour approach, because that is the part of the story that
// is actually about arriving.
//
// The one thing this world must not do is make it look easy or grand. The Main Building is
// handsome and the Registry Room is enormous, but the experience was a queue, a numbered
// tag pinned to your coat, a doctor looking at your eyes for thirty seconds, and a chalk
// letter on your shoulder if something was wrong. The props are built to say that: the
// baggage is the largest single object on the dock, and the inspection line has a rail.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const BRICK = 0xa8593c;
const BRICK_DARK = 0x8a4630;
const LIMESTONE = 0xd8cfbc;
const COPPER = 0x74b09a;   // oxidised, which Liberty already was by 1907
const SLATE = 0x4a5058;
const TIMBER = 0x6b5842;

// ---------------------------------------------------------------------------
// The Main Building
// ---------------------------------------------------------------------------

// Red brick with limestone trim and four copper-domed corner towers. The towers are what
// make it recognisable from the water, which is the only angle most arrivals ever saw it
// from -- so they are the detail worth spending geometry on.
export function ellisMainBuilding({ width = 74, depth = 34, height = 26, seed = 5 } = {}) {
  const g = group();
  const parts = [];

  // Main block, coursed so the brick reads as brick.
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width, (height / rows) * 0.99, depth),
      color: r % 2 ? BRICK : BRICK_DARK,
      position: [0, (height / rows) * (r + 0.5), 0],
    });
  }

  // Limestone banding: a plinth, a string course and a cornice. Three horizontal lines are
  // most of what stops a brick box looking like a warehouse.
  parts.push({ geometry: new THREE.BoxGeometry(width + 1.4, 2.2, depth + 1.4), color: LIMESTONE, position: [0, 1.1, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.8, 1.0, depth + 0.8), color: LIMESTONE, position: [0, height * 0.52, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(width + 1.8, 1.8, depth + 1.8), color: LIMESTONE, position: [0, height - 0.9, 0] });

  // The three great arched windows across the front -- the Registry Room's windows, and
  // the building's face. Built as a recess plus a voussoir ring, same as any arch here.
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * width * 0.26;
    const R = width * 0.085;
    parts.push({ geometry: new THREE.BoxGeometry(R * 2, height * 0.38, 1.0), color: 0x2f3742, position: [x, height * 0.42, depth / 2 - 0.4] });
    // Glazing bars, so the opening reads as a window rather than a hole.
    for (let b = 1; b < 5; b++) {
      parts.push({ geometry: new THREE.BoxGeometry(0.22, height * 0.38, 1.1), color: LIMESTONE, position: [x - R + (b * 2 * R) / 5, height * 0.42, depth / 2 - 0.35] });
    }
    for (let b = 1; b < 4; b++) {
      parts.push({ geometry: new THREE.BoxGeometry(R * 2, 0.22, 1.1), color: LIMESTONE, position: [x, height * 0.42 - height * 0.19 + (b * height * 0.38) / 4, depth / 2 - 0.35] });
    }
    const vous = 11;
    for (let v = 0; v < vous; v++) {
      const a = Math.PI * (v + 0.5) / vous;
      parts.push({
        geometry: new THREE.BoxGeometry(R * 0.36, (Math.PI * R) / vous * 1.15, 1.2),
        color: LIMESTONE,
        position: [x + Math.cos(a) * R * 1.16, height * 0.61 + Math.sin(a) * R * 1.16, depth / 2 - 0.35],
        rotation: [0, 0, a - Math.PI / 2],
      });
    }
    // Fan glazing inside the arch head.
    parts.push({ geometry: new THREE.CylinderGeometry(R, R, 0.9, 16, 1, false, 0, Math.PI), color: 0x2f3742, position: [x, height * 0.61, depth / 2 - 0.4], rotation: [Math.PI / 2, 0, 0] });
  }

  // Doorway.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.1, height * 0.22, 1.2), color: 0x2b2419, position: [0, height * 0.11, depth / 2 - 0.3] });

  g.add(mergedMesh(parts, { roughness: 0.92, ...relief('stone', { seed, repeat: 8 }) }));

  // --- The four towers ----------------------------------------------------
  const towers = [];
  const domes = [];
  const tR = 4.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (width / 2 - tR * 0.6);
    const z = sz * (depth / 2 - tR * 0.6);
    const tH = height * 1.32;
    for (let r = 0; r < 11; r++) {
      towers.push({
        geometry: new THREE.BoxGeometry(tR * 2, (tH / 11) * 0.99, tR * 2),
        color: r % 2 ? BRICK : BRICK_DARK,
        position: [x, (tH / 11) * (r + 0.5), z],
      });
    }
    towers.push({ geometry: new THREE.BoxGeometry(tR * 2.4, 1.4, tR * 2.4), color: LIMESTONE, position: [x, tH + 0.7, z] });

    // The dome: a hemisphere, then a lantern and a finial. Copper, oxidised green.
    const dome = new THREE.SphereGeometry(tR * 1.08, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 1.15, 1);
    domes.push({ geometry: dome, color: COPPER, position: [x, tH + 1.4, z] });
    domes.push({ geometry: new THREE.CylinderGeometry(tR * 0.32, tR * 0.38, 2.4, 10), color: COPPER, position: [x, tH + 1.4 + tR * 1.24 + 1.2, z] });
    domes.push({ geometry: new THREE.ConeGeometry(tR * 0.34, 2.0, 10), color: COPPER, position: [x, tH + 1.4 + tR * 1.24 + 3.4, z] });
    domes.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 2.2, 6), color: 0x3f4a44, position: [x, tH + 1.4 + tR * 1.24 + 5.4, z] });
  }
  g.add(mergedMesh(towers, { roughness: 0.92, ...relief('stone', { seed: seed + 1, repeat: 6 }) }));
  g.add(mergedMesh(domes, { roughness: 0.55, metalness: 0.35, ...relief('metal', { seed: seed + 2, repeat: 4 }) }));

  // Slate roof over the main block, with the ridge running the long way.
  const roof = [];
  for (let r = 0; r < 6; r++) {
    const t = r / 5;
    roof.push({
      geometry: new THREE.BoxGeometry(width * 1.02, 0.4, (depth * 1.04) / 6),
      color: r % 2 ? SLATE : 0x565d66,
      position: [0, height + 0.6 + Math.sin(t * Math.PI) * 3.2, -depth * 0.52 + (r + 0.5) * ((depth * 1.04) / 6)],
      rotation: [Math.cos(t * Math.PI) * 0.3, 0, 0],
    });
  }
  g.add(mergedMesh(roof, { roughness: 0.8, ...relief('stone', { seed: seed + 3, repeat: 5 }) }));

  return g;
}

// ---------------------------------------------------------------------------
// The Statue of Liberty
// ---------------------------------------------------------------------------

// Seen across the water from Ellis Island, about half a mile off. She is 305ft to the
// torch including the pedestal; at that distance she is a silhouette, and the silhouette
// is entirely made of four things: the raised right arm, the seven-ray crown, the tablet
// held against the left side, and the huge stepped pedestal.
//
// The chains at her feet are the detail nobody expects and the one that changes what the
// statue means -- she is walking out of a broken shackle.
export function statueOfLiberty({ scale = 0.42, seed = 11 } = {}) {
  const g = group();
  const parts = [];
  const S = scale;
  const pedH = 89 * S;
  const figH = 151 * S;

  // Fort Wood's eleven-pointed star base, then the pedestal.
  const starParts = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    starParts.push({
      geometry: new THREE.BoxGeometry(30 * S, 8 * S, 14 * S),
      color: 0x8a8578,
      position: [Math.cos(a) * 26 * S, 4 * S, Math.sin(a) * 26 * S],
      rotation: [0, -a, 0],
    });
  }
  g.add(mergedMesh(starParts, { roughness: 0.95, ...relief('stone', { seed, repeat: 5 }) }));

  // Pedestal: a tapering granite block with a cornice.
  parts.push({ geometry: new THREE.BoxGeometry(38 * S, pedH * 0.24, 38 * S), color: 0x9a9186, position: [0, 8 * S + pedH * 0.12, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(30 * S, pedH * 0.58, 30 * S), color: 0xa89f92, position: [0, 8 * S + pedH * 0.24 + pedH * 0.29, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(34 * S, pedH * 0.08, 34 * S), color: 0x9a9186, position: [0, 8 * S + pedH * 0.86, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(26 * S, pedH * 0.12, 26 * S), color: 0xa89f92, position: [0, 8 * S + pedH * 0.94, 0] });

  const baseTop = 8 * S + pedH;

  // The robe: a swept tube that flares to the ground, and it must be WIDE at the hem --
  // the whole lower half of the statue is drapery, and a narrow one reads as a person in
  // a dress rather than as a classical figure.
  const robe = taperedTube(
    [
      [0, baseTop, 0],
      [0, baseTop + figH * 0.22, 0],
      [-figH * 0.02, baseTop + figH * 0.44, 0],
      [0, baseTop + figH * 0.6, 0],
    ],
    [figH * 0.15, figH * 0.115, figH * 0.085, figH * 0.07],
    { tubularSegments: 22, radialSegments: 16 },
  );
  parts.push({ geometry: robe, color: COPPER });

  // Fold lines down the robe -- vertical ribs, which is what reads as drapery at distance.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(figH * 0.012, figH * 0.5, figH * 0.02),
      color: 0x69a48f,
      position: [Math.cos(a) * figH * 0.115, baseTop + figH * 0.26, Math.sin(a) * figH * 0.115],
      rotation: [0, -a, Math.cos(a) * 0.05],
    });
  }

  // Head and crown.
  const headY = baseTop + figH * 0.68;
  parts.push({ geometry: new THREE.SphereGeometry(figH * 0.045, 16, 14), color: COPPER, position: [0, headY, 0] });
  parts.push({ geometry: new THREE.CylinderGeometry(figH * 0.05, figH * 0.055, figH * 0.03, 14), color: COPPER, position: [0, headY + figH * 0.04, 0] });
  // Seven rays -- one for each continent and sea, and the count is the point.
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.5 + (i / 6 - 0.5) * Math.PI * 1.25;
    parts.push({
      geometry: new THREE.ConeGeometry(figH * 0.012, figH * 0.1, 5),
      color: COPPER,
      position: [Math.sin(a) * figH * 0.055, headY + figH * 0.09, Math.cos(a) * figH * 0.055],
      rotation: [Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5],
    });
  }

  // The raised right arm and torch -- she holds it up and slightly forward, not straight up.
  const arm = taperedTube(
    [
      [figH * 0.05, baseTop + figH * 0.56, 0],
      [figH * 0.1, baseTop + figH * 0.72, -figH * 0.02],
      [figH * 0.11, baseTop + figH * 0.88, -figH * 0.03],
    ],
    [figH * 0.03, figH * 0.022, figH * 0.018],
    { tubularSegments: 12, radialSegments: 10 },
  );
  parts.push({ geometry: arm, color: COPPER });
  parts.push({ geometry: new THREE.CylinderGeometry(figH * 0.022, figH * 0.014, figH * 0.06, 12), color: COPPER, position: [figH * 0.115, baseTop + figH * 0.93, -figH * 0.03] });

  // The tablet, held against the left side, tipped back. July IV MDCCLXXVI.
  parts.push({
    geometry: new THREE.BoxGeometry(figH * 0.075, figH * 0.11, figH * 0.02),
    color: 0x7fb6a0,
    position: [-figH * 0.09, baseTop + figH * 0.5, figH * 0.04],
    rotation: [0.25, 0, 0.3],
  });
  const leftArm = taperedTube(
    [
      [-figH * 0.05, baseTop + figH * 0.56, 0],
      [-figH * 0.08, baseTop + figH * 0.5, figH * 0.02],
      [-figH * 0.09, baseTop + figH * 0.46, figH * 0.03],
    ],
    [figH * 0.028, figH * 0.022, figH * 0.02],
    { tubularSegments: 10, radialSegments: 8 },
  );
  parts.push({ geometry: leftArm, color: COPPER });

  // The broken shackle and chain at her feet.
  for (let i = 0; i < 5; i++) {
    const t = new THREE.TorusGeometry(figH * 0.014, figH * 0.005, 6, 10);
    t.rotateY(i % 2 ? Math.PI / 2 : 0);
    parts.push({ geometry: t, color: 0x5f8f7c, position: [figH * (0.06 + i * 0.022), baseTop + figH * 0.012, figH * 0.09] });
  }

  const body = mesh(mergeColored(parts), standard({
    vertexColors: true, roughness: 0.62, metalness: 0.2, ...relief('metal', { seed: seed + 1, repeat: 6 }),
  }));
  g.add(body);

  // The torch flame -- gold leaf, and self-lit so it reads at half a mile.
  const flame = mesh(
    new THREE.ConeGeometry(figH * 0.026, figH * 0.075, 12),
    standard({ color: 0xf2d98a, emissive: 0xd9a83c, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0.5 }),
    figH * 0.115, baseTop + figH * 0.99, -figH * 0.03,
  );
  flame.castShadow = false;
  g.add(flame);

  return g;
}

// ---------------------------------------------------------------------------
// The harbour
// ---------------------------------------------------------------------------

// An immigrant steamship at the pier: black hull, white upperworks, one or two funnels
// with the line's bands. Third class was below the waterline at the stern, over the
// propellers -- the noisiest, roughest berth on the ship, and where most arrivals travelled.
export function steamship({ length = 96, seed = 17, funnels = 2 } = {}) {
  const parts = [];
  const beam = length * 0.13;

  // Hull, swept so the bow is fine and the stern is full.
  const hull = taperedTube(
    [
      [0, length * 0.055, -length * 0.5],
      [0, length * 0.05, -length * 0.28],
      [0, length * 0.05, 0],
      [0, length * 0.05, length * 0.3],
      [0, length * 0.07, length * 0.48],
    ],
    [beam * 0.28, beam * 0.66, beam * 0.72, beam * 0.6, beam * 0.16],
    { tubularSegments: 40, radialSegments: 16 },
  );
  hull.scale(1, 0.86, 1);
  parts.push({ geometry: hull, color: 0x24262b });

  // Boot topping and the white line along the sheer -- two stripes do most of the work of
  // making a black hull read as a ship rather than a log.
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.46, 1.2, length * 0.92), color: 0x8a2f24, position: [0, length * 0.018, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.48, 0.7, length * 0.9), color: 0xd8d2c6, position: [0, length * 0.085, 0] });

  // Superstructure: two white decks, shorter than the hull.
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.16, length * 0.045, length * 0.5), color: 0xe0dad0, position: [0, length * 0.115, -length * 0.02] });
  parts.push({ geometry: new THREE.BoxGeometry(beam * 0.92, length * 0.04, length * 0.34), color: 0xe8e2d8, position: [0, length * 0.157, -length * 0.04] });
  // Bridge.
  parts.push({ geometry: new THREE.BoxGeometry(beam * 1.0, length * 0.03, length * 0.07), color: 0xf0eae0, position: [0, length * 0.192, -length * 0.14] });

  // Funnels, raked aft as they were.
  for (let i = 0; i < funnels; i++) {
    const z = -length * 0.04 + (i - (funnels - 1) / 2) * length * 0.12;
    parts.push({ geometry: new THREE.CylinderGeometry(beam * 0.16, beam * 0.18, length * 0.12, 16), color: 0xb5562e, position: [0, length * 0.235, z], rotation: [-0.1, 0, 0] });
    parts.push({ geometry: new THREE.CylinderGeometry(beam * 0.165, beam * 0.165, length * 0.03, 16), color: 0x1c1c1c, position: [0, length * 0.29, z + length * 0.006], rotation: [-0.1, 0, 0] });
  }

  // Masts and derricks.
  for (const z of [-length * 0.32, length * 0.3]) {
    parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.45, length * 0.2, 8), color: TIMBER, position: [0, length * 0.17, z] });
    parts.push({ geometry: new THREE.BoxGeometry(beam * 1.1, 0.3, 0.3), color: TIMBER, position: [0, length * 0.24, z] });
  }

  // Portholes along the hull -- a row of them is what gives a ship its length.
  for (let i = 0; i < 22; i++) {
    parts.push({
      geometry: new THREE.CylinderGeometry(0.34, 0.34, 0.2, 8),
      color: 0xc9b06a,
      position: [beam * 0.73, length * 0.062, -length * 0.4 + i * (length * 0.8) / 21],
      rotation: [0, 0, Math.PI / 2],
    });
  }

  return group(mergedMesh(parts, { roughness: 0.72, metalness: 0.2, ...relief('metal', { seed, repeat: 7 }) }));
}

// A timber pier with bollards and a gangway.
export function ferryPier({ length = 44, width = 16, seed = 23 } = {}) {
  const parts = [];
  const deckY = 3.0;

  const planks = Math.round(length / 2);
  for (let i = 0; i < planks; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width, 0.35, (length / planks) * 0.92),
      color: i % 3 === 0 ? 0x7d6a50 : i % 3 === 1 ? TIMBER : 0x5f5040,
      position: [0, deckY, -length / 2 + (i + 0.5) * (length / planks)],
    });
  }
  // Piles.
  for (let i = 0; i <= 5; i++) {
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.5, 0.6, deckY + 1, 10),
        color: 0x4a3f31,
        position: [side * (width / 2 - 0.8), (deckY + 1) / 2 - 0.6, -length / 2 + i * (length / 5)],
      });
    }
  }
  // Bollards.
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.CylinderGeometry(0.42, 0.52, 1.6, 12),
      color: 0x3a3a3a,
      position: [width / 2 - 1.4, deckY + 0.8, -length * 0.35 + i * (length * 0.23)],
    });
    parts.push({ geometry: new THREE.SphereGeometry(0.46, 10, 8), color: 0x3a3a3a, position: [width / 2 - 1.4, deckY + 1.6, -length * 0.35 + i * (length * 0.23)] });
  }
  return group(mergedMesh(parts, { roughness: 0.9, ...relief('wood', { seed, repeat: 6 }) }));
}

// The baggage. Deliberately the biggest single mass on the dock: what people brought was
// everything they owned, and the photographs of the baggage room are the ones that carry
// the weight of it.
export function baggagePile({ count = 26, spread = 9, seed = 29 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const leathers = [0x6b4a2c, 0x4f3a26, 0x8a6a42, 0x3f3128, 0x7d5f3c];

  for (let i = 0; i < count; i++) {
    const w = randomIn(rng, 1.6, 3.4);
    const h = randomIn(rng, 1.0, 1.9);
    const d = randomIn(rng, 1.1, 2.0);
    const layer = Math.floor(i / 9);
    const x = randomIn(rng, -spread, spread) * (1 - layer * 0.22);
    const z = randomIn(rng, -spread * 0.6, spread * 0.6) * (1 - layer * 0.22);
    const y = layer * 1.7 + h / 2;
    const rotY = randomIn(rng, -0.5, 0.5);
    const color = leathers[i % leathers.length];
    parts.push({ geometry: new THREE.BoxGeometry(w, h, d), color, position: [x, y, z], rotation: [0, rotY, 0] });
    // Straps and a lighter lid band -- a plain box is a crate, and a trunk is defined by
    // its bands.
    for (const t of [-0.28, 0.28]) {
      parts.push({
        geometry: new THREE.BoxGeometry(w * 0.1, h * 1.03, d * 1.03),
        color: 0x2f2419,
        position: [x + Math.cos(rotY) * w * t, y, z - Math.sin(rotY) * w * t],
        rotation: [0, rotY, 0],
      });
    }
    parts.push({ geometry: new THREE.BoxGeometry(w * 1.02, h * 0.14, d * 1.02), color: 0x2f2419, position: [x, y + h * 0.32, z], rotation: [0, rotY, 0] });
    // A few bundles tied in cloth, which is what most people actually carried.
    if (i % 5 === 0) {
      parts.push({
        geometry: roughenSphere(new THREE.SphereGeometry(randomIn(rng, 0.7, 1.1), 12, 9), { amount: 0.22 }),
        color: [0x8a7a5c, 0x6b6a48, 0x9a8464][i % 3],
        position: [x + randomIn(rng, -1.4, 1.4), y + h * 0.6, z + randomIn(rng, -1, 1)],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.9, ...relief('weave', { seed: seed + 1, repeat: 4 }) }));
}

// The inspection line: a rail with a numbered pen behind it, and the doctor's desk. The
// rail is the exhibit -- the Registry Room was divided into iron pens and you queued in
// one for hours.
export function inspectionLine({ length = 26, seed = 31 } = {}) {
  const parts = [];
  const iron = 0x3a3f45;

  for (const zOff of [0, -7]) {
    for (let i = 0; i <= Math.round(length / 3.5); i++) {
      parts.push({ geometry: new THREE.CylinderGeometry(0.11, 0.13, 3.4, 8), color: iron, position: [-length / 2 + i * 3.5, 1.7, zOff] });
    }
    for (const y of [1.4, 2.7, 3.3]) {
      parts.push({ geometry: new THREE.CylinderGeometry(0.07, 0.07, length, 6), color: iron, position: [0, y, zOff], rotation: [0, 0, Math.PI / 2] });
    }
  }

  // The desk at the head of the line, with a ledger open on it.
  parts.push({ geometry: new THREE.BoxGeometry(5.4, 0.3, 2.6), color: TIMBER, position: [length / 2 + 3.6, 3.0, -3.5] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.32, 3.0, 0.32), color: 0x4a3f31, position: [length / 2 + 3.6 + sx * 2.3, 1.5, -3.5 + sz * 1.0] });
  }
  parts.push({ geometry: new THREE.BoxGeometry(2.2, 0.16, 1.5), color: 0xe0d8c4, position: [length / 2 + 3.6, 3.24, -3.5], rotation: [0, 0.2, 0] });
  // A stool.
  parts.push({ geometry: new THREE.CylinderGeometry(0.7, 0.7, 0.24, 12), color: TIMBER, position: [length / 2 + 3.6, 2.2, -6.0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push({ geometry: new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6), color: 0x4a3f31, position: [length / 2 + 3.6 + Math.cos(a) * 0.5, 1.1, -6.0 + Math.sin(a) * 0.5] });
  }

  return group(mergedMesh(parts, { roughness: 0.75, metalness: 0.25, ...relief('metal', { seed, repeat: 5 }) }));
}

// A manifest board: the ship's name, the date, and the numbers. The tag pinned to a
// coat carried the manifest page and line number you were on -- which is how a person
// became a row in a ledger.
export function manifestBoard({ ship = 'SS PRINZESSIN', date = '14 APRIL 1907', souls = '1,806', seed = 37 } = {}) {
  const g = group();
  const texture = canvasTexture(896, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e8dfc8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a2f22'; ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#3a2f22';
    ctx.font = 'bold 30px Georgia, serif';
    ctx.fillText('ARRIVING TODAY', w / 2, 76);
    ctx.font = 'bold 62px Georgia, serif';
    ctx.fillText(ship, w / 2, 150);
    ctx.font = '34px Georgia, serif';
    ctx.fillText(date, w / 2, 200);
    ctx.strokeStyle = '#8a6a3c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * 0.2, 226); ctx.lineTo(w * 0.8, 226); ctx.stroke();
    ctx.font = 'bold 96px Georgia, serif';
    ctx.fillText(souls, w / 2, 330);
    ctx.font = '30px Georgia, serif';
    ctx.fillText('steerage passengers to be inspected', w / 2, 378);
    ctx.font = 'italic 26px Georgia, serif';
    ctx.fillStyle = '#5a4a34';
    ctx.fillText('Have your manifest number ready and pinned', w / 2, 440);
  });
  const post = standard({ color: 0x4a3f31, roughness: 0.85, ...relief('wood', { seed, repeat: 3 }) });
  for (const side of [-1, 1]) g.add(cyl(0.2, 0.24, 7.4, post, side * 3.6, 3.7, 0, 10));
  const panel = signPanel(8.4, 4.8, texture);
  panel.position.set(0, 6.4, 0.14);
  g.add(panel);
  return g;
}
