import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, classicalColumn, pediment,
  seededRandom, randomIn, roughenSphere,
} from '../PropKit.js';

// Ancient Pompeii, 24 August AD 79 -- the town as the ash starts to fall.
//
// The thing this world has to get right is that Pompeii is NOT a ruin here. Every picture
// a student has seen is of broken stumps of wall in bright sunshine; the whole point of
// the place is that it was an ordinary working town on an ordinary afternoon. So the
// buildings stand, the shop counters are stocked, the street is intact -- and Vesuvius is
// going up behind them. The ruin is the consequence, not the subject.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const TUFF = 0xc4b49a;      // the grey-yellow volcanic stone the town is built from
const TUFF_DARK = 0xa2937c;
const PLASTER = 0xe4d5bb;
const POMPEIIAN_RED = 0x9e3b28; // the famous fresco red
const OCHRE = 0xc98b3a;
const BASALT = 0x5a564f;    // the black lava paving of the streets
const ASH = 0x8e8578;

// ---------------------------------------------------------------------------
// Vesuvius
// ---------------------------------------------------------------------------

// The eruption column is the whole silhouette of this world, and its shape is a specific,
// named thing: a PLINIAN column -- named after Pliny the Younger, who watched this exact
// eruption from across the bay and wrote it down. He described it as an umbrella pine,
// and that is exactly right: a narrow vertical trunk of gas going up fast, which stops
// dead where the atmosphere stops it rising and spreads out flat into a wide canopy.
//
// A plume that just widens steadily as it rises is a bonfire, not a Plinian column. The
// flat-topped umbrella is the identifying feature and the reason Pliny's name is on it.
export function vesuvius({ height = 88, baseRadius = 96, seed = 3, columnHeight = 150 } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  // --- The mountain -------------------------------------------------------
  // Vesuvius in AD 79 had ONE peak, not today's broken caldera with Monte Somma beside it
  // -- the summit we see now is the hole this eruption left. So this is a single cone.
  const cone = new THREE.ConeGeometry(baseRadius, height, 26, 8);
  const pos = cone.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const gully = Math.sin(a * 7) * 0.07 + Math.sin(a * 13 + 2.1) * 0.04 + Math.sin(v.y * 0.12) * 0.03;
    v.x *= 1 + gully;
    v.z *= 1 + gully;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  cone.computeVertexNormals();
  cone.translate(0, height / 2, 0);

  // Colour by height: wooded lower slopes (Vesuvius was farmed and vineyarded right up
  // its flanks, which is why so many people lived under it), bare rock above.
  const colors = new Float32Array(pos.count * 3);
  const wood = new THREE.Color(0x4a5c38);
  const scrub = new THREE.Color(0x6b6a4c);
  const rock = new THREE.Color(0x6e6459);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    if (t < 0.45) c.lerpColors(wood, scrub, t / 0.45);
    else c.lerpColors(scrub, rock, (t - 0.45) / 0.55);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  cone.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.add(mesh(cone, standard({ vertexColors: true, roughness: 0.97, flatShading: true, ...relief('stone', { seed, repeat: 8 }) })));

  // --- The column ---------------------------------------------------------
  // Smooth spheres, NOT icosahedra: this is the cloud lesson from the Water Cycle. A
  // faceted lump reads as rock, and rock going up in the sky reads as nothing at all.
  const puffs = [];
  const trunkTop = columnHeight * 0.62;

  // The trunk: narrow, near-vertical, and it barely widens. This is the part everyone
  // draws too fat.
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const y = height * 0.9 + t * trunkTop;
    const r = 7 + t * 11;
    const drift = t * t * 26; // the wind only starts to tell higher up
    puffs.push({
      geometry: roughenSphere(new THREE.SphereGeometry(r, 14, 10), { amount: 0.24, phase: i * 1.7 }),
      color: i < 4 ? 0x3b342c : i < 9 ? 0x6b6154 : 0x9a9184,
      position: [drift + Math.sin(i * 2.3) * r * 0.3, y, Math.cos(i * 1.9) * r * 0.3],
    });
  }

  // The canopy: where the column stops rising and spreads FLAT. Wide, thin, and level.
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * 82;
    const r = randomIn(rng, 13, 26);
    puffs.push({
      geometry: roughenSphere(new THREE.SphereGeometry(r, 14, 10), { amount: 0.28, flatten: 0.5, phase: i * 2.1 }),
      color: [0xa8a094, 0x8e8578, 0xbdb5a8, 0x746c60][i % 4],
      position: [26 + Math.cos(a) * d, height * 0.9 + trunkTop + randomIn(rng, -8, 16), Math.sin(a) * d * 0.7],
    });
  }

  const plume = mergedMesh(puffs, { roughness: 1, flatShading: false });
  plume.castShadow = false;   // a shadow this size would put the whole town in night
  plume.receiveShadow = false;
  g.add(plume);

  return g;
}

// ---------------------------------------------------------------------------
// The town
// ---------------------------------------------------------------------------

// Pompeii's streets are the best-preserved Roman roads anywhere, and two details make
// them instantly recognisable: deep CART RUTS worn into the basalt, and raised STEPPING
// STONES across the road at junctions -- because the street doubled as the drain, and you
// crossed it without stepping in it. The gaps between the stones are exactly a cart axle
// wide, which is why carts could still pass.
export function pompeiiStreet({ length = 60, width = 15, seed = 11, crossing = true } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // Polygonal basalt paving -- irregular slabs, not bricks.
  const cols = 5;
  const rows = Math.round(length / 3);
  for (let r = 0; r < rows; r++) {
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      const w = (width * 0.72) / cols;
      parts.push({
        geometry: new THREE.BoxGeometry(w * randomIn(rng, 0.86, 1.02), 0.42, 3 * randomIn(rng, 0.82, 1.0)),
        color: [BASALT, 0x63605a, 0x504d47, 0x6d6963][(r + cIdx) % 4],
        position: [
          -width * 0.36 + (cIdx + 0.5) * w + randomIn(rng, -0.1, 0.1),
          0.21,
          -length / 2 + (r + 0.5) * 3,
        ],
        rotation: [0, randomIn(rng, -0.05, 0.05), 0],
      });
    }
  }

  // Cart ruts: two grooves at a fixed gauge, sunk into the paving.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.5, 0.16, length),
      color: 0x3d3a35,
      position: [side * 2.2, 0.36, 0],
    });
  }

  // Raised kerbs and footways either side -- Pompeii's pavements are a good foot up.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(width * 0.14, 1.0, length),
      color: TUFF,
      position: [side * (width * 0.43), 0.5, 0],
    });
  }

  // The stepping stones.
  if (crossing) {
    for (let i = 0; i < 3; i++) {
      parts.push({
        geometry: new THREE.CylinderGeometry(1.15, 1.3, 1.05, 8),
        color: 0x6d6963,
        position: [-3.6 + i * 3.6, 0.55, length * 0.22],
      });
    }
  }

  return group(mergedMesh(parts, { roughness: 0.95, ...relief('stone', { seed: seed + 2, repeat: 7 }) }));
}

// A Pompeian townhouse seen from the street: shop fronts either side of a door, a first
// floor with small windows, and a tiled roof. The fresco panel beside the door is the
// famous "Beware of the dog" mosaic's job -- a house says who lives here at its threshold.
export function pompeiiVilla({ width = 26, depth = 20, height = 16, seed = 17, shops = true } = {}) {
  const g = group();
  const parts = [];
  const wall = 1.1;

  // Walls, coursed so the block joints show.
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const y = (height / rows) * (r + 0.5);
    const shade = r % 2 ? PLASTER : 0xd8c8ad;
    // Front wall is broken by the door and shop openings, so it is built as piers.
    const frontPiers = shops ? [[-width * 0.42, width * 0.16], [0, width * 0.14], [width * 0.42, width * 0.16]]
                             : [[0, width]];
    for (const [px, pw] of frontPiers) {
      // Above door height the front is continuous.
      const isLintel = y > height * 0.5;
      parts.push({
        geometry: new THREE.BoxGeometry(isLintel ? width : pw, (height / rows) * 0.98, wall),
        color: shade,
        position: [isLintel ? 0 : px, y, depth / 2 - wall / 2],
      });
    }
    for (const [x, z, w, d] of [
      [0, -depth / 2 + wall / 2, width, wall],
      [-width / 2 + wall / 2, 0, wall, depth],
      [width / 2 - wall / 2, 0, wall, depth],
    ]) {
      parts.push({ geometry: new THREE.BoxGeometry(w, (height / rows) * 0.98, d), color: shade, position: [x, y, z] });
    }
  }

  // A dark doorway, so the front is not a blank plastered slab.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.11, height * 0.42, 0.5), color: 0x2b2419, position: [0, height * 0.21, depth / 2 - 0.2] });

  // The dado: Pompeian walls carry a painted band at about waist height, with plaster
  // above, and that two-tone split is as characteristic as the architecture.
  //
  // Kept SHORT and muted deliberately. At a fifth of the building's height in full
  // Pompeian red it stopped being a dado and became the building -- a red plinth three
  // feet tall wrapping every wall, which from any distance read as the whole town being
  // painted scarlet. The real thing is a band you notice when you are standing next to it.
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.004, height * 0.11, depth * 1.004), color: 0x8a4434, position: [0, height * 0.075, 0] });

  // Small upper windows -- Roman houses face INWARD onto their courtyards, so a street
  // frontage has hardly any openings, which is itself worth seeing.
  for (let i = 0; i < 3; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width * 0.07, height * 0.1, 0.4),
      color: 0x2b2419,
      position: [-width * 0.28 + i * width * 0.28, height * 0.72, depth / 2 - 0.1],
    });
  }

  const body = mergedMesh(parts, { roughness: 0.93, ...relief('stone', { seed, repeat: 5 }) });
  g.add(body);

  // Terracotta pantile roof, built as overlapping rows -- one flat slab is the single
  // fastest way to make a Roman building look like a shoebox.
  const roof = [];
  const tileRows = 7;
  for (let r = 0; r < tileRows; r++) {
    const t = r / (tileRows - 1);
    roof.push({
      geometry: new THREE.BoxGeometry(width * 1.08, 0.3, (depth * 1.1) / tileRows),
      color: r % 2 ? 0xa8532e : 0xbb6238,
      position: [0, height + 0.3 + Math.sin(t * Math.PI) * 1.6, -depth * 0.55 + (r + 0.5) * ((depth * 1.1) / tileRows)],
      rotation: [Math.cos(t * Math.PI) * 0.16, 0, 0],
    });
  }
  g.add(mergedMesh(roof, { roughness: 0.95, ...relief('stone', { seed: seed + 3, repeat: 6 }) }));

  return g;
}

// A thermopolium -- the Roman fast-food bar. An L-shaped masonry counter with round DOLIA
// (storage jars) sunk into its top, opening straight onto the street. There are about 80
// of these in Pompeii, and they are the clearest single sign that this was a town where
// ordinary people bought hot food on the way home rather than cooking it.
export function thermopolium({ length = 12, seed = 23 } = {}) {
  const parts = [];
  const counterH = 3.6;

  // The counter, faced in broken marble scraps -- which is exactly how the real ones are
  // finished, and it is why they look like crazy paving.
  parts.push({ geometry: new THREE.BoxGeometry(length, counterH, 2.6), color: 0xbdb2a0, position: [0, counterH / 2, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(3.4, counterH, 6), color: 0xbdb2a0, position: [length / 2 - 1.7, counterH / 2, -4.3] });
  const rng = seededRandom(seed);
  for (let i = 0; i < 34; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(randomIn(rng, 0.5, 1.3), randomIn(rng, 0.4, 0.9), 0.08),
      color: [0xd8cfc0, 0x9a8f7e, 0xc4b8a4, 0x7d7466][i % 4],
      position: [randomIn(rng, -length / 2 + 0.6, length / 2 - 0.6), randomIn(rng, 0.4, counterH - 0.4), 1.32],
      rotation: [0, 0, randomIn(rng, -0.3, 0.3)],
    });
  }
  // Counter top.
  parts.push({ geometry: new THREE.BoxGeometry(length + 0.5, 0.3, 3.1), color: 0x8e8272, position: [0, counterH + 0.15, 0] });

  // The dolia, sunk in: dark circles in the counter top.
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.CylinderGeometry(0.95, 0.8, 0.4, 14),
      color: 0x3b3229,
      position: [-length / 2 + 1.8 + i * ((length - 3.6) / 3), counterH + 0.28, 0],
    });
  }

  // Amphorae leaning against the end of the counter.
  for (let i = 0; i < 3; i++) {
    const amph = taperedTube(
      [[0, 0, 0], [0, 1.1, 0], [0, 2.2, 0], [0, 3.0, 0]],
      [0.12, 0.62, 0.44, 0.16],
      { tubularSegments: 12, radialSegments: 10 },
    );
    parts.push({
      geometry: amph,
      color: 0xb08256,
      position: [-length / 2 - 0.9 - i * 0.75, 0.4, 1.2 - i * 0.5],
      rotation: [0.16, 0, 0.2 + i * 0.05],
    });
  }

  return group(mergedMesh(parts, { roughness: 0.92, ...relief('stone', { seed: seed + 1, repeat: 4 }) }));
}

// The forum colonnade: a two-storey portico down one side of the town's main square.
export function forumColonnade({ bays = 7, spacing = 8, height = 15, seed = 29 } = {}) {
  const g = group();
  const stone = standard({ color: TUFF, roughness: 0.92, ...relief('stone', { seed, repeat: 4 }) });
  const width = bays * spacing;

  // Stylobate.
  g.add(box(width + 4, 1.4, 12, stone, 0, 0.7, 0));
  for (let i = 0; i <= bays; i++) {
    const col = classicalColumn(height, 0.95, stone);
    col.position.set(-width / 2 + i * spacing, 1.4, 4);
    g.add(col);
  }
  // Entablature and the back wall of the portico.
  g.add(box(width + 3, 1.7, 3, stone, 0, 1.4 + height + 0.85, 4));
  g.add(box(width + 3, height + 2, 1.2, stone, 0, 1.4 + (height + 2) / 2, -1.4));

  // Upper storey -- shorter columns above, which is how a Roman two-tier portico works.
  for (let i = 0; i <= bays; i++) {
    const col = classicalColumn(height * 0.62, 0.72, stone);
    col.position.set(-width / 2 + i * spacing, 1.4 + height + 1.7, 4);
    g.add(col);
  }
  g.add(box(width + 3, 1.2, 3, stone, 0, 1.4 + height + 1.7 + height * 0.62 + 0.6, 4));

  return g;
}

// The amphitheatre: Pompeii's is the oldest surviving stone amphitheatre anywhere, built
// about 70 BC -- a century and a half before the Colosseum. Built into an earthen bank
// rather than raised on vaults, which is why it survived.
export function amphitheatre({ radiusX = 40, radiusZ = 32, height = 14, seed = 31 } = {}) {
  const parts = [];
  const tiers = 8;

  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const rx = radiusX * (0.52 + f * 0.48);
    const rz = radiusZ * (0.52 + f * 0.48);
    const y = f * height;
    const segs = 44;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const w = (2 * Math.PI * ((rx + rz) / 2)) / segs;
      parts.push({
        geometry: new THREE.BoxGeometry(w * 1.06, height / tiers, (radiusX - radiusX * 0.52) / tiers * 1.4),
        color: t % 2 ? TUFF : TUFF_DARK,
        position: [Math.cos(a) * rx, y + height / tiers / 2, Math.sin(a) * rz],
        rotation: [0, -a, 0],
      });
    }
  }

  // The arena floor, sunk inside the seating.
  parts.push({
    geometry: new THREE.CylinderGeometry(radiusX * 0.5, radiusX * 0.5, 0.4, 40),
    color: 0xc2ac86,
    position: [0, 0.2, 0],
  });

  const m = mergedMesh(parts, { roughness: 0.95, ...relief('stone', { seed, repeat: 8 }) });
  // Flatten the whole thing into the true oval -- an amphitheatre is not circular, and the
  // word means "theatre on both sides", which is the shape.
  m.geometry.scale(1, 1, radiusZ / radiusX * 1.25);
  return group(m);
}

// The plaster casts. In 1863 Giuseppe Fiorelli realised the voids in the ash were
// body-shaped, and poured plaster into them. These are the most affecting objects in
// archaeology and the reason most people know Pompeii at all.
//
// Built curled, which is what the real ones are: not dramatic poses, but people who lay
// down and covered their heads. The colour is plaster white, deliberately not flesh --
// these are casts of an absence, and making them look like bodies would be worse.
export function plasterCast({ pose = 'curled', seed = 37 } = {}) {
  const parts = [];
  const cast = 0xded5c4;
  const shade = 0xc2b8a4;

  if (pose === 'curled') {
    // Torso, curled on its side.
    const torso = taperedTube(
      [[-1.6, 0.9, 0], [-0.5, 1.15, 0.1], [0.7, 1.0, 0.05], [1.5, 0.7, 0]],
      [0.42, 0.66, 0.6, 0.38],
      { tubularSegments: 18, radialSegments: 12 },
    );
    parts.push({ geometry: torso, color: cast });
    // Head, tucked down.
    parts.push({ geometry: new THREE.SphereGeometry(0.46, 14, 12), color: cast, position: [1.85, 0.62, 0.05] });
    // Arms drawn up over the face -- the pose that makes these unbearable to look at.
    for (const side of [-1, 1]) {
      const arm = taperedTube(
        [[0.7, 1.1, side * 0.35], [1.3, 1.0, side * 0.45], [1.75, 0.85, side * 0.28]],
        [0.2, 0.17, 0.14], { tubularSegments: 10, radialSegments: 8 },
      );
      parts.push({ geometry: arm, color: shade });
    }
    // Legs drawn up.
    for (const side of [-1, 1]) {
      const leg = taperedTube(
        [[-1.4, 0.85, side * 0.28], [-0.7, 0.55, side * 0.42], [0.1, 0.42, side * 0.5]],
        [0.3, 0.26, 0.2], { tubularSegments: 12, radialSegments: 8 },
      );
      parts.push({ geometry: leg, color: shade });
    }
  } else {
    // Seated, hunched.
    parts.push({ geometry: new THREE.SphereGeometry(0.46, 14, 12), color: cast, position: [0, 2.5, 0.2] });
    const torso = taperedTube(
      [[0, 0.7, 0], [0, 1.5, 0.1], [0, 2.2, 0.15]],
      [0.55, 0.6, 0.42], { tubularSegments: 12, radialSegments: 12 },
    );
    parts.push({ geometry: torso, color: cast });
    for (const side of [-1, 1]) {
      const leg = taperedTube(
        [[side * 0.3, 0.7, 0], [side * 0.36, 0.4, 0.7], [side * 0.34, 0.28, 1.3]],
        [0.28, 0.24, 0.18], { tubularSegments: 10, radialSegments: 8 },
      );
      parts.push({ geometry: leg, color: shade });
    }
  }

  // The ash bed they lie in.
  parts.push({
    geometry: roughenSphere(new THREE.SphereGeometry(2.4, 14, 10), { amount: 0.16, flatten: 0.12 }),
    color: ASH,
    position: [0, 0.1, 0],
  });

  return group(mergedMesh(parts, { roughness: 0.96, ...relief('soil', { seed, repeat: 4 }) }));
}

// A painted wall panel in the Pompeian Fourth Style: deep red fields divided by slim
// architectural borders with a small framed scene in the middle. This is the decoration
// scheme the town is named for in art history.
export function frescoWall({ width = 14, height = 10, seed = 41 } = {}) {
  const texture = canvasTexture(768, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#9e3b28';
    ctx.fillRect(0, 0, w, h);
    // Black dado.
    ctx.fillStyle = '#2b211c';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
    // Slim ochre borders dividing the wall into three fields.
    ctx.strokeStyle = '#c98b3a';
    ctx.lineWidth = 7;
    for (const x of [w * 0.32, w * 0.68]) { ctx.beginPath(); ctx.moveTo(x, h * 0.06); ctx.lineTo(x, h * 0.78); ctx.stroke(); }
    ctx.strokeRect(w * 0.03, h * 0.05, w * 0.94, h * 0.73);
    // Centre panel: a small framed picture on a pale ground.
    ctx.fillStyle = '#e8dcc4';
    ctx.fillRect(w * 0.38, h * 0.2, w * 0.24, h * 0.34);
    ctx.strokeStyle = '#2b211c'; ctx.lineWidth = 4;
    ctx.strokeRect(w * 0.38, h * 0.2, w * 0.24, h * 0.34);
    // A suggestion of a figure and a garland, not a real painting -- inventing a specific
    // lost fresco would be a fabrication, so this reads as "a scene" and no more.
    ctx.fillStyle = '#8a6a3c';
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.33, w * 0.028, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(w * 0.492, h * 0.37, w * 0.016, h * 0.12);
    ctx.strokeStyle = '#5c7a35'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.24, w * 0.05, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    // Candelabra motifs on the side fields.
    for (const x of [w * 0.17, w * 0.83]) {
      ctx.strokeStyle = '#c98b3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x, h * 0.22); ctx.lineTo(x, h * 0.7); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const y = h * (0.28 + i * 0.11);
        ctx.beginPath(); ctx.moveTo(x - w * 0.035, y); ctx.lineTo(x + w * 0.035, y); ctx.stroke();
      }
    }
    // Age: soot and loss.
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(40,30,24,${0.03 + rng() * 0.07})`;
      ctx.beginPath(); ctx.arc(randomIn(rng, 0, w), randomIn(rng, 0, h), randomIn(rng, 10, 50), 0, Math.PI * 2); ctx.fill();
    }
  });

  const g = group();
  const wall = standard({ color: TUFF, roughness: 0.95, ...relief('stone', { seed: seed + 2, repeat: 3 }) });
  g.add(box(width + 1, height + 1, 1.2, wall, 0, (height + 1) / 2, -0.7));
  const face = signPanel(width, height, texture);
  face.position.set(0, (height + 1) / 2, -0.05);
  g.add(face);
  return g;
}

// Ash falling, and drifted ash on the ground. The fall on the first day was pumice --
// light, dry, and it piled up like grey snow, which is what buried the ground floors.
export function ashFall({ radius = 26, height = 40, count = 220, seed = 43 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    parts.push({
      geometry: new THREE.BoxGeometry(0.09, randomIn(rng, 0.2, 0.5), 0.09),
      color: i % 3 === 0 ? 0xd8d2c8 : 0xb0a89a,
      position: [Math.cos(a) * r, randomIn(rng, 1, height), Math.sin(a) * r],
      rotation: [randomIn(rng, -0.4, 0.4), 0, randomIn(rng, -0.4, 0.4)],
    });
  }
  const m = mesh(mergeColored(parts), standard({
    vertexColors: true, transparent: true, opacity: 0.65, roughness: 1,
    emissive: 0x8a8478, emissiveIntensity: 0.25, depthWrite: false,
  }));
  m.material.fog = false;
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}
