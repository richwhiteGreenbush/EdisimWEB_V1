import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  sphere,
  group,
  mergedMesh,
  canvasTexture,
  signPanel,
  pediment,
  seededRandom,
  randomIn,
  roughenSphere,
  relief,
  taperedTube,
} from '../PropKit.js';

// "The Park" -- the default world, laid out like a large Olmsted-style city park in
// the manner of Boston's Franklin Park: a great meadow, a pond, a bandstand, an
// overlook shelter, stone arch bridges, the historic bear dens, and outcrops of the
// Roxbury puddingstone the real park is built on and around.

// Roxbury puddingstone: a conglomerate of rounded pebbles set in a fine purple-grey
// matrix, and the Massachusetts state rock. Olmsted deliberately built Franklin Park's
// walls, bridges and shelters out of the stone already lying on the site, so every
// masonry prop in this world shares this one palette.
const PUDDINGSTONE_MATRIX = 0x6f6259;
const PUDDINGSTONE_COBBLES = [0x8c7d6e, 0x5c5049, 0x9a8b76, 0x7b6a5d, 0xa79683];

// One tile covers roughly 4 world feet at the repeats used below, and the cobbles are
// sized to land at about 2-6 inches across -- which is what they actually are. Drawn
// any larger they read as a cartoon cobblestone wall rather than as conglomerate rock.
function puddingstoneTexture(repeatX = 1, repeatY = 1, seed = 3) {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#6f6259';
    ctx.fillRect(0, 0, w, h);
    // Rounded cobbles embedded in the matrix -- the defining look of a conglomerate.
    for (let i = 0; i < 320; i++) {
      const r = randomIn(rng, 3, 11);
      const cx = randomIn(rng, 0, w);
      const cy = randomIn(rng, 0, h);
      const shade = PUDDINGSTONE_COBBLES[Math.floor(rng() * PUDDINGSTONE_COBBLES.length)];
      ctx.fillStyle = `#${shade.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * randomIn(rng, 0.6, 1), randomIn(rng, 0, 3.14), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(50,44,40,0.45)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

// The colour map doubles as the bump map. The cobbles ARE the relief in a conglomerate,
// so the same tile that draws them can just as well displace them -- and reusing it
// costs nothing, since a texture's dispose() is idempotent no matter how many material
// slots point at it.
const stoneMat = (repeatX = 2, repeatY = 1, seed = 3) => {
  const map = puddingstoneTexture(repeatX, repeatY, seed);
  return standard({ map, bumpMap: map, bumpScale: 0.55, roughness: 0.95 });
};

const timberMat = () => standard({ color: 0x6b4a2c, roughness: 0.85, ...relief('wood', { seed: 61, repeat: 5 }) });
const shingleMat = () => standard({ color: 0x50412f, roughness: 0.9, ...relief('wood', { seed: 67, repeat: 8 }) });
const IRON = () => standard({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6, ...relief('metal', { seed: 71, repeat: 3 }) });

// ---------------------------------------------------------------------------
// Planting
// ---------------------------------------------------------------------------

// Cone-shaped evergreen, built from stacked skirts. ~24ft, so it reads as a mature
// tree next to a 5ft student rather than a nursery sapling.
export function coniferTree({ height = 24, seed = 2, needleColor = 0x2f5c3a } = {}) {
  const rng = seededRandom(seed);
  const trunkHeight = height * 0.22;
  const parts = [];

  parts.push({
    geometry: new THREE.CylinderGeometry(height * 0.02, height * 0.045, trunkHeight * 1.4, 8),
    position: [0, trunkHeight * 0.7, 0],
    color: 0x4d3a28,
  });

  const shade = new THREE.Color(needleColor);
  const tiers = 6;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = trunkHeight + (height - trunkHeight) * t * 0.85;
    const radius = height * 0.19 * (1 - t * 0.82) + 0.3;
    parts.push({
      geometry: new THREE.ConeGeometry(radius, height * 0.26, 9),
      rotation: [0, randomIn(rng, 0, 1), 0],
      position: [0, y + height * 0.1, 0],
      color: shade.clone().multiplyScalar(0.82 + t * 0.3).getHex(),
    });
  }
  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true, ...relief('bark', { seed, repeat: 4 }) }));
}

// Blossom tree -- the spring colour in the entrance beds and along the pond bank.
export function floweringTree({ height = 16, seed = 5, blossomColor = 0xf2a8c4 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const trunkHeight = height * 0.45;

  const wood = [];
  wood.push({
    geometry: new THREE.CylinderGeometry(height * 0.022, height * 0.045, trunkHeight, 8),
    position: [0, trunkHeight / 2, 0],
    color: 0x584231,
  });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.4;
    const limb = height * 0.26;
    wood.push({
      geometry: new THREE.CylinderGeometry(height * 0.011, height * 0.022, limb, 6),
      rotation: [Math.sin(angle) * 0.75, 0, -Math.cos(angle) * 0.75],
      position: [Math.cos(angle) * limb * 0.34, trunkHeight + limb * 0.3, Math.sin(angle) * limb * 0.34],
      color: 0x584231,
    });
  }
  const crownY = trunkHeight + height * 0.24;
  const crownR = height * 0.31;
  const shade = new THREE.Color(blossomColor);
  wood.push({ geometry: new THREE.IcosahedronGeometry(crownR, 1), position: [0, crownY, 0], color: blossomColor });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + 0.9;
    wood.push({
      geometry: new THREE.IcosahedronGeometry(crownR * randomIn(rng, 0.5, 0.68), 1),
      rotation: [rng() * 3, rng() * 3, rng() * 3],
      position: [
        Math.cos(angle) * crownR * 0.8,
        crownY + randomIn(rng, -0.3, 0.35) * crownR,
        Math.sin(angle) * crownR * 0.8,
      ],
      color: shade.clone().multiplyScalar(randomIn(rng, 0.85, 1.12)).getHex(),
    });
  }
  g.add(mergedMesh(wood, { roughness: 0.92, flatShading: true, ...relief('bark', { seed, repeat: 3 }) }));
  return g;
}

// A planted bed: low soil mound, clipped edging, and a scatter of flower heads on
// stems. Everything merges to one geometry, so a bed of 120 blooms costs one call.
export function flowerBed({ width = 10, depth = 6, seed = 7, palette } = {}) {
  const rng = seededRandom(seed);
  const colors = palette || [0xe0455f, 0xf2a541, 0xf5f5f5, 0x8a5cf5, 0xf2d541, 0xe8709a];
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(width, 0.5, depth), position: [0, 0.25, 0], color: 0x3d2f22 });
  // Stone edging blocks.
  const edging = Math.round(width / 1.2);
  for (let i = 0; i < edging; i++) {
    const x = -width / 2 + (width / edging) * (i + 0.5);
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(width / edging - 0.06, 0.7, 0.5),
        position: [x, 0.35, (sz * depth) / 2],
        color: 0x8a8073,
      });
    }
  }

  const blooms = Math.round(width * depth * 2.6);
  for (let i = 0; i < blooms; i++) {
    const x = randomIn(rng, -width / 2 + 0.7, width / 2 - 0.7);
    const z = randomIn(rng, -depth / 2 + 0.7, depth / 2 - 0.7);
    const stem = randomIn(rng, 0.8, 1.7);
    parts.push({
      geometry: new THREE.CylinderGeometry(0.03, 0.04, stem, 4),
      position: [x, 0.5 + stem / 2, z],
      color: 0x3f7a3a,
    });
    parts.push({
      geometry: new THREE.SphereGeometry(randomIn(rng, 0.16, 0.26), 6, 5),
      position: [x, 0.5 + stem, z],
      color: colors[Math.floor(rng() * colors.length)],
    });
  }

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// A loose drift of meadow wildflowers with no bed around it -- for the edges of the
// great lawn, where a formal bed would look wrong.
export function wildflowers({ radius = 7, count = 150, seed = 11, palette } = {}) {
  const rng = seededRandom(seed);
  const colors = palette || [0xf2d541, 0xf5f5f5, 0x8a5cf5, 0xe0455f, 0xf2a541];
  const parts = [];

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const stem = randomIn(rng, 0.6, 1.4);
    parts.push({
      geometry: new THREE.CylinderGeometry(0.025, 0.03, stem, 4),
      position: [x, stem / 2, z],
      color: 0x4a8040,
    });
    parts.push({
      geometry: new THREE.SphereGeometry(randomIn(rng, 0.11, 0.2), 5, 4),
      position: [x, stem, z],
      color: colors[Math.floor(rng() * colors.length)],
    });
  }

  return group(mergedMesh(parts, { roughness: 0.9, flatShading: true }));
}

// ---------------------------------------------------------------------------
// Stonework
// ---------------------------------------------------------------------------

// An outcrop of Roxbury puddingstone breaking through the turf. The single best
// teaching object in the park: a conglomerate whose rounded pebbles are visibly
// individual stones, cemented together, and the reason Boston's parks look the way
// they do -- the rock was already here, so Olmsted built with it.
export function puddingstoneOutcrop({ size = 9, seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const rock = stoneMat(2.6, 2.6, seed);

  const masses = [
    [0, 0, 0, 1],
    [size * 0.42, -0.15, size * 0.2, 0.62],
    [-size * 0.38, -0.2, -size * 0.16, 0.55],
    [size * 0.1, 0.16, -size * 0.4, 0.44],
  ];
  masses.forEach(([x, dy, z, scale], i) => {
    const geometry = roughenSphere(new THREE.IcosahedronGeometry((size * scale) / 2, 2), {
      amount: 0.32,
      flatten: 0.72,
      phase: i * 1.7 + 0.4,
    });
    const lump = mesh(geometry, rock, x, size * scale * 0.3 + dy, z);
    lump.rotation.y = randomIn(rng, 0, 6.28);
    g.add(lump);
  });

  // Loose cobbles weathered out of the outcrop and lying at its foot.
  const looseParts = [];
  for (let i = 0; i < 10; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = size * randomIn(rng, 0.55, 0.95);
    const r = randomIn(rng, 0.2, 0.5);
    looseParts.push({
      geometry: new THREE.IcosahedronGeometry(r, 0),
      position: [Math.cos(angle) * distance, r * 0.6, Math.sin(angle) * distance],
      rotation: [rng() * 3, rng() * 3, rng() * 3],
      color: PUDDINGSTONE_COBBLES[Math.floor(rng() * PUDDINGSTONE_COBBLES.length)],
    });
  }
  g.add(mergedMesh(looseParts, { roughness: 0.95, flatShading: true }));

  return g;
}

// Olmsted's signature: a masonry arch carrying an upper path over a lower one, with a
// parapet and stepped voussoirs around the ring.
//
// A TRUE SEMICIRCLE, springing from `springY`, so the crown lands at springY + span/2
// -- comfortably over a 5ft walker, which matters because students walk through this
// opening rather than over it. The barrel depth (`width`) is kept deliberately slim: a
// wide barrel plus wide abutments plus a long deck turns the whole thing into one dark
// masonry block with a hole in it, which is how the first version read.
//
// The arch must be circular and not elliptical. Each voussoir is rotated by
// `angle - 90 degrees`, which points it along the curve only when the ring's X and Y
// radii match; give the arch a separate `rise` and the blocks stop lying flush and
// splay outward like a starburst.
export function stoneArchBridge({ span = 14, width = 7 } = {}) {
  const g = group();
  const stone = stoneMat(6, 3, 21);
  const radius = span / 2;
  const springY = 1.2; // the arch springs from here, so the jambs stay full height
  const ringRadius = radius + 0.6;
  const crownY = springY + ringRadius;
  const deckY = crownY + 1.4;

  // Abutments either side of the opening.
  for (const sx of [-1, 1]) {
    g.add(box(3.6, crownY, width, stone, sx * (radius + 1.8), crownY / 2, 0));
  }

  // Arch ring: voussoir blocks stepped around the semicircle, spanning the full barrel.
  const voussoirs = 15;
  const arcStep = (Math.PI * ringRadius) / voussoirs;
  const ringParts = [];
  for (let v = 0; v < voussoirs; v++) {
    const angle = (Math.PI * (v + 0.5)) / voussoirs;
    ringParts.push({
      geometry: new THREE.BoxGeometry(arcStep * 1.04, 1.3, width + 0.3),
      rotation: [0, 0, angle - Math.PI / 2],
      position: [Math.cos(angle) * ringRadius, springY + Math.sin(angle) * ringRadius, 0],
      color: PUDDINGSTONE_COBBLES[v % PUDDINGSTONE_COBBLES.length],
    });
  }
  g.add(mergedMesh(ringParts, { roughness: 0.95 }));

  // Spandrels: masonry between the arch ring and the deck, left and right of the
  // crown only, so the opening stays open.
  for (const sx of [-1, 1]) {
    g.add(box(radius * 0.55, deckY - crownY + 1.2, width, stone, sx * (radius * 0.72), (deckY + crownY - 1.2) / 2 + 0.6, 0));
  }
  g.add(box(span + 7.2, 1.4, width, stone, 0, deckY - 0.7, 0));

  // Deck and parapets.
  g.add(box(span + 8, 0.5, width, standard({ color: 0x9a8f7d, roughness: 1 }), 0, deckY + 0.25, 0));
  for (const sz of [-1, 1]) {
    g.add(box(span + 8, 2.2, 0.7, stone, 0, deckY + 1.6, (sz * (width - 0.7)) / 2));
    g.add(box(span + 8.5, 0.35, 1.0, standard({ color: 0x8a8073, roughness: 0.9 }), 0, deckY + 2.85, (sz * (width - 0.7)) / 2));
  }

  return g;
}

// A flight of dressed stone steps with low cheek walls -- Franklin Park's wooded
// slopes are stitched together by stairs exactly like these.
export function stoneSteps({ steps = 9, width = 8, rise = 0.6, tread = 1.3 } = {}) {
  const g = group();
  const stone = stoneMat(2, 1, 31);
  for (let i = 0; i < steps; i++) {
    g.add(box(width, rise, tread + 0.2, stone, 0, rise * (i + 0.5), -tread * i));
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < steps; i++) {
      g.add(box(0.7, rise + 1.4, tread + 0.2, stone, (sx * (width + 0.7)) / 2, rise * (i + 0.5) + 0.7, -tread * i));
    }
  }
  return g;
}

// A run of flagstones.
//
// Deliberately SEGMENTED rather than one long slab: the park terrain rolls, and a
// single flat ribbon would bury one end and float the other. Each segment is its own
// record placed at its own ground height, and within a 14ft segment the ground barely
// moves, so the stones sit flush. The slight step between segments reads as paving.
export function pathStones({ length = 14, width = 5, seed = 17 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const greys = [0x9a9184, 0x8b8175, 0xa79d8e, 0x7d746a];

  let z = -length / 2;
  while (z < length / 2) {
    const rowDepth = randomIn(rng, 1.4, 2.3);
    let x = -width / 2;
    while (x < width / 2) {
      const stoneWidth = randomIn(rng, 1.2, 2.2);
      const w = Math.min(stoneWidth, width / 2 - x);
      if (w < 0.5) break;
      parts.push({
        geometry: new THREE.BoxGeometry(w - 0.12, 0.35, rowDepth - 0.12),
        rotation: [0, randomIn(rng, -0.05, 0.05), 0],
        position: [x + w / 2, 0.1, z + rowDepth / 2],
        color: greys[Math.floor(rng() * greys.length)],
      });
      x += w;
    }
    z += rowDepth;
  }

  const paving = mergedMesh(parts, { roughness: 1 });
  paving.castShadow = false;
  return group(paving);
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

// Octagonal bandstand, ~15ft to the finial: stone base, eight posts, a turned
// railing, and a shingled cone roof. The park's central gathering point.
export function bandstand({ radius = 9, postHeight = 9 } = {}) {
  const g = group();
  const stone = stoneMat(3, 1, 41);
  const timber = timberMat();
  const rail = standard({ color: 0xe8e2d2, roughness: 0.8 });

  // Stepped base.
  g.add(cyl(radius + 1.6, radius + 2.2, 0.55, stone, 0, 0.275, 0, 8));
  g.add(cyl(radius + 0.9, radius + 1.5, 0.55, stone, 0, 0.825, 0, 8));
  g.add(cyl(radius, radius, 0.5, standard({ color: 0xb5a68e, roughness: 0.95 }), 0, 1.35, 0, 8));
  const deckY = 1.6;

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(angle) * (radius - 0.7);
    const z = Math.sin(angle) * (radius - 0.7);
    g.add(cyl(0.26, 0.32, postHeight, timber, x, deckY + postHeight / 2, z, 10));

    // Railing panel and decorative bracket to the next post.
    const next = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
    const nx = Math.cos(next) * (radius - 0.7);
    const nz = Math.sin(next) * (radius - 0.7);
    const midX = (x + nx) / 2;
    const midZ = (z + nz) / 2;
    const segLength = Math.hypot(nx - x, nz - z);
    const facing = Math.atan2(nx - x, nz - z);

    // The entrance bay is left open so students can walk up onto the deck.
    if (i !== 1) {
      const panel = box(0.16, 1.1, segLength, rail, midX, deckY + 1.7, midZ);
      panel.rotation.y = facing;
      g.add(panel);
      const capRail = box(0.34, 0.18, segLength, rail, midX, deckY + 2.35, midZ);
      capRail.rotation.y = facing;
      g.add(capRail);
    }

    const bracket = box(0.2, 0.6, segLength * 0.8, timber, midX, deckY + postHeight - 0.5, midZ);
    bracket.rotation.y = facing;
    g.add(bracket);
  }

  // Steps up to the open bay.
  const entryAngle = (1 / 8) * Math.PI * 2 + Math.PI / 8;
  const steps = group();
  for (let s = 0; s < 3; s++) {
    steps.add(box(5, 0.55, 1.4, stone, 0, 0.275 + s * 0.55, -1.4 * s));
  }
  steps.position.set(Math.cos(entryAngle) * (radius + 1.4), 0, Math.sin(entryAngle) * (radius + 1.4));
  steps.rotation.y = Math.PI / 2 - entryAngle;
  g.add(steps);

  // Roof: an eight-sided cone, plus a fascia band and a finial.
  const roofY = deckY + postHeight;
  g.add(cyl(radius + 0.6, radius + 0.6, 0.5, timber, 0, roofY + 0.25, 0, 8));
  g.add(mesh(new THREE.ConeGeometry(radius + 1.4, 4.6, 8), shingleMat(), 0, roofY + 2.8, 0));
  g.add(cyl(0.16, 0.22, 1.4, timber, 0, roofY + 5.6, 0, 8));
  g.add(sphere(0.42, standard({ color: 0xc9a227, roughness: 0.35, metalness: 0.8 }), 0, roofY + 6.5, 0, 14));

  return g;
}

// The Overlook Shelter: an open-sided stone-and-timber pavilion, ~15ft to the ridge.
// Somewhere to sit out of the sun, and the natural spot for a light orb.
export function parkPavilion({ width = 22, depth = 14, postHeight = 9 } = {}) {
  const g = group();
  const stone = stoneMat(4, 1, 51);
  const timber = timberMat();

  g.add(box(width + 3, 0.5, depth + 3, standard({ color: 0xb5a68e, roughness: 0.95 }), 0, 0.25, 0));
  g.add(box(width + 1.4, 0.35, depth + 1.4, standard({ color: 0xa2967f, roughness: 1 }), 0, 0.62, 0));
  const floorY = 0.8;

  // Masonry piers at the corners and mid-spans.
  const pierXs = [-width / 2 + 1.4, 0, width / 2 - 1.4];
  for (const px of pierXs) {
    for (const sz of [-1, 1]) {
      const pz = (sz * (depth - 2.8)) / 2;
      g.add(box(2.2, postHeight * 0.55, 2.2, stone, px, floorY + (postHeight * 0.55) / 2, pz));
      g.add(cyl(0.32, 0.38, postHeight * 0.45, timber, px, floorY + postHeight * 0.55 + (postHeight * 0.45) / 2, pz, 10));
    }
  }

  // A low stone back wall on the -Z side, so it reads as a shelter rather than a roof
  // on stilts, while three open sides keep the view (and the daylight) through it.
  g.add(box(width, postHeight * 0.5, 1.2, stone, 0, floorY + (postHeight * 0.5) / 2, -depth / 2 + 0.6));

  // Timber roof: tie beams, rafters and a shingled gable.
  const plateY = floorY + postHeight;
  g.add(box(width + 2, 0.5, 0.6, timber, 0, plateY, -depth / 2 + 0.3));
  g.add(box(width + 2, 0.5, 0.6, timber, 0, plateY, depth / 2 - 0.3));
  for (const px of pierXs) g.add(box(0.5, 0.5, depth, timber, px, plateY, 0));

  const ridgeY = plateY + 4.2;
  g.add(box(width + 2, 0.55, 0.55, timber, 0, ridgeY, 0));
  const slopeLength = Math.hypot(depth / 2, ridgeY - plateY) + 1.2;
  for (const sz of [-1, 1]) {
    const roof = box(width + 3, 0.5, slopeLength, shingleMat(), 0, (ridgeY + plateY) / 2 + 0.2, (sz * depth) / 4);
    roof.rotation.x = sz * Math.atan2(ridgeY - plateY, depth / 2);
    g.add(roof);
  }

  return g;
}

// The nature centre: the park's visitor building, and the thing the "Start your visit
// here" placard is pointing at.
//
// This replaced the downloaded little-library .obj that used to stand here. That model
// was a street-corner book box scaled up to 12ft, so it read as a garden shed with a
// glass front rather than as a building anyone could go into, and being sized by HEIGHT
// it came with a 36ft-square footprint it did not visually earn. Built in code it can be
// the right shape for the job -- long, low, deep-eaved, with a porch you can read as an
// entrance from across the lawn -- and it drops one fetch from every load of this world.
export function natureCentre({ width = 30, depth = 18, wallHeight = 9 } = {}) {
  const g = group();
  const stone = stoneMat(5, 1, 71);
  const timber = timberMat();
  const trim = standard({ color: 0x8a6a3f, roughness: 0.8, ...relief('wood', { seed: 89, repeat: 4 }) });
  // Warm interior light behind the glass. Emissive rather than transparent: there is no
  // interior behind these windows, and a see-through pane would show the far wall's
  // inside face, which is unlit and reads as a hole in the building.
  const glass = standard({
    color: 0x24333d,
    roughness: 0.22,
    metalness: 0.35,
    emissive: new THREE.Color(0xffd79a),
    emissiveIntensity: 0.3,
  });

  // Fieldstone plinth, then the timber box on top of it.
  g.add(box(width + 2.4, 1.1, depth + 2.4, stone, 0, 0.55, 0));
  const sillY = 1.1;

  const wall = 0.7;
  // Side and back walls are solid; the front is built as two returns either side of the
  // porch opening, which is what gives the building a door without cutting geometry.
  g.add(box(wall, wallHeight, depth, timber, -width / 2 + wall / 2, sillY + wallHeight / 2, 0));
  g.add(box(wall, wallHeight, depth, timber, width / 2 - wall / 2, sillY + wallHeight / 2, 0));
  g.add(box(width, wallHeight, wall, timber, 0, sillY + wallHeight / 2, -depth / 2 + wall / 2));
  const doorWidth = 7;
  for (const side of [-1, 1]) {
    const runWidth = (width - doorWidth) / 2;
    g.add(box(runWidth, wallHeight, wall, timber, side * (doorWidth + runWidth) / 2, sillY + wallHeight / 2, depth / 2 - wall / 2));
  }
  // A header over the opening, so the front wall reads as one continuous plane.
  const doorHeight = 7.4;
  g.add(box(doorWidth, wallHeight - doorHeight, wall, timber, 0, sillY + wallHeight - (wallHeight - doorHeight) / 2, depth / 2 - wall / 2));

  // The entrance. Glazing the whole opening as one sheet is what a first pass does and
  // it is wrong every time: a 7ft x 7ft pane of lit glass has no features at all, so it
  // reads as a blank illuminated board rather than as a way in. What makes it a door is
  // the divisions -- a dark reveal behind, a transom above, a centre mullion, and rails
  // at handle height. The glass is dimmer than it looks like it should be, too: this
  // pane is under a deep porch in permanent shade, so anything brighter glows.
  const reveal = standard({ color: 0x1b1f22, roughness: 0.95 });
  const doorFace = depth / 2 - wall - 0.02;
  g.add(box(doorWidth - 0.5, doorHeight - 0.3, 0.1, reveal, 0, sillY + (doorHeight - 0.3) / 2, doorFace + 0.02));
  const transomY = sillY + doorHeight - 1.1;
  g.add(box(doorWidth - 0.9, 1.3, 0.14, glass, 0, transomY, doorFace));
  for (const side of [-1, 1]) {
    g.add(box(doorWidth / 2 - 0.75, doorHeight - 2.1, 0.14, glass, side * (doorWidth / 4 + 0.05), sillY + (doorHeight - 2.1) / 2, doorFace));
    g.add(box(0.16, doorHeight - 2.1, 0.22, trim, side * (doorWidth / 2 - 0.42), sillY + (doorHeight - 2.1) / 2, doorFace + 0.04));
    // Push bar, at the height a door actually has one.
    g.add(box(doorWidth / 2 - 1.4, 0.14, 0.22, trim, side * (doorWidth / 4 + 0.05), sillY + 3.3, doorFace + 0.09));
  }
  g.add(box(0.34, doorHeight - 0.3, 0.24, trim, 0, sillY + (doorHeight - 0.3) / 2, doorFace + 0.04));
  g.add(box(doorWidth - 0.5, 0.24, 0.24, trim, 0, transomY - 0.75, doorFace + 0.04));

  // Windows: three a side on the flanks, one either side of the door on the front.
  //
  // These hang on the OUTSIDE face of the wall, not its inside face. There is no
  // interior in this building -- the walls are solid boxes -- so a pane set at
  // `width / 2 - wall` (the instinctive "inner face", and where these started) is
  // sealed inside the timber and can never be seen from anywhere a student can stand.
  // Frame first, glass proud of it, both clear of the wall surface.
  const paneH = 4;
  const paneY = sillY + 4.4;
  const flankX = width / 2;
  for (const side of [-1, 1]) {
    for (const dz of [-5.5, 0, 5.5]) {
      g.add(box(0.3, paneH + 0.7, 4.3, trim, side * (flankX + 0.06), paneY, dz));
      g.add(box(0.16, paneH, 3.6, glass, side * (flankX + 0.2), paneY, dz));
    }
    const frontX = side * (doorWidth / 2 + 4.2);
    g.add(box(4.1, paneH + 0.7, 0.3, trim, frontX, paneY, depth / 2 + 0.06));
    g.add(box(3.4, paneH, 0.16, glass, frontX, paneY, depth / 2 + 0.2));
  }

  // Deep-eaved gable roof. The eaves overhang by 2.5ft, which is most of what makes a
  // small building read as a park shelter rather than as a shed.
  const plateY = sillY + wallHeight;
  const ridgeY = plateY + 5;
  const pitch = Math.atan2(ridgeY - plateY, depth / 2 + 2.5);
  const slope = Math.hypot(depth / 2 + 2.5, ridgeY - plateY);

  g.add(box(width + 5.4, 0.55, 0.7, timber, 0, plateY + 0.25, -depth / 2 - 0.2));
  g.add(box(width + 5.4, 0.55, 0.7, timber, 0, plateY + 0.25, depth / 2 + 0.2));
  g.add(box(width + 5.4, 0.6, 0.6, timber, 0, ridgeY, 0));
  for (const sz of [-1, 1]) {
    const roof = box(width + 5, 0.45, slope, shingleMat(), 0, (ridgeY + plateY) / 2 + 0.3, (sz * (depth / 2 + 2.5)) / 2);
    roof.rotation.x = sz * pitch;
    g.add(roof);
  }
  // Gable ends, filling the triangle the two roof planes leave open.
  for (const sx of [-1, 1]) {
    const gable = pediment(depth + 1.2, ridgeY - plateY, 0.6, timber);
    gable.position.set(sx * (width / 2 - 0.3), plateY, 0);
    gable.rotation.y = Math.PI / 2;
    g.add(gable);
  }

  // Porch: four posts under a lower shed roof, covering the entrance.
  const porchDepth = 6;
  const porchPlate = sillY + 7.4;
  for (const px of [-doorWidth / 2 - 1.2, doorWidth / 2 + 1.2]) {
    for (const pz of [depth / 2 + 1, depth / 2 + porchDepth - 1]) {
      g.add(cyl(0.3, 0.36, porchPlate - sillY, timber, px, sillY + (porchPlate - sillY) / 2, pz, 12));
    }
  }
  g.add(box(doorWidth + 4, 0.4, porchDepth + 1, timber, 0, porchPlate, depth / 2 + porchDepth / 2));
  const canopy = box(doorWidth + 5, 0.35, porchDepth + 2, shingleMat(), 0, porchPlate + 0.9, depth / 2 + porchDepth / 2);
  canopy.rotation.x = -0.22;
  g.add(canopy);
  // Steps down to the lawn.
  for (let i = 0; i < 3; i++) {
    g.add(box(doorWidth + 2, 0.4, 1.2 - i * 0.1, stone, 0, sillY - 0.2 - i * 0.4, depth / 2 + porchDepth + 0.6 + i * 1.1));
  }

  // The hanging name board under the porch.
  const board = signPanel(
    6.4,
    1.6,
    canvasTexture(640, 160, (ctx, w, h) => {
      ctx.fillStyle = '#20401f';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = '#f3ead6';
      ctx.textAlign = 'center';
      ctx.font = 'bold 54px Georgia, "Times New Roman", serif';
      ctx.fillText('NATURE CENTRE', w / 2, h * 0.52);
      ctx.fillStyle = '#c9a227';
      ctx.font = '24px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('MAPS · TRAIL GUIDES · RANGERS', w / 2, h * 0.8);
    })
  );
  board.position.set(0, porchPlate - 1.4, depth / 2 + porchDepth - 0.4);
  g.add(board);

  return g;
}

// The historic bear dens: a run of barred stone alcoves under a heavy cornice. Kept
// because they are the most-visited ruin in the real park, and because "why did we
// stop keeping animals like this?" is a genuinely good question for a 13-year-old.
export function bearDens({ dens = 3, denWidth = 9, height = 14 } = {}) {
  const g = group();
  const stone = stoneMat(5, 1.4, 61);
  const width = dens * denWidth + 3;

  g.add(box(width + 2, 0.6, 12, standard({ color: 0xa2967f, roughness: 1 }), 0, 0.3, 0));
  const baseY = 0.6;

  // Back and side walls of the enclosure.
  g.add(box(width, height, 1.4, stone, 0, baseY + height / 2, -5));
  for (const sx of [-1, 1]) g.add(box(1.4, height, 10, stone, (sx * width) / 2 - 0.7 * sx, baseY + height / 2, 0));

  // Front wall with an arched opening per den.
  //
  // The pier width is fixed by the arch: pier = denWidth - 2*archRadius, and the piers
  // must be EXACTLY that. Padding them "so they overlap nicely" narrows every opening
  // while the arch ring keeps its radius, and the result is a row of rectangular holes
  // with voussoir blocks apparently floating loose in the wall above them.
  const archRadius = denWidth * 0.31;
  const archBase = 6.6;
  const pierWidth = denWidth - archRadius * 2;
  const frontZ = 4.6;
  const denCenter = (d) => (d - (dens - 1) / 2) * denWidth;
  const wallParts = [];
  const rng = seededRandom(67);
  // Per-block shade variation, seeded rather than Math.random(), so a rehydrated world
  // rebuilds the identical wall instead of reshuffling its stonework on every load.
  //
  // These are near-WHITE, not stone-coloured. This mesh carries both a puddingstone map
  // and vertex colours, and three.js multiplies the two: tinting the vertices to the
  // same dark stone the map already is squares it, and the facade comes out near black.
  // The map supplies the colour; the vertex colours only vary the brightness.
  const jitter = () => new THREE.Color(0xffffff).multiplyScalar(randomIn(rng, 0.82, 1.12)).getHex();

  // Interior piers, then the two end piers stretched out to the wall's edges.
  for (let d = 1; d < dens; d++) {
    wallParts.push({
      geometry: new THREE.BoxGeometry(pierWidth, archBase + archRadius, 1.4),
      position: [denCenter(d) - denWidth / 2, baseY + (archBase + archRadius) / 2, frontZ],
      color: jitter(),
    });
  }
  for (const [edge, openEdge] of [
    [-width / 2, denCenter(0) - archRadius],
    [width / 2, denCenter(dens - 1) + archRadius],
  ]) {
    wallParts.push({
      geometry: new THREE.BoxGeometry(Math.abs(openEdge - edge), archBase + archRadius, 1.4),
      position: [(edge + openEdge) / 2, baseY + (archBase + archRadius) / 2, frontZ],
      color: jitter(),
    });
  }

  for (let d = 0; d < dens; d++) {
    const cx = denCenter(d);
    for (let v = 0; v < 11; v++) {
      const angle = (Math.PI * (v + 0.5)) / 11;
      wallParts.push({
        geometry: new THREE.BoxGeometry(0.6, 0.85, 1.4),
        rotation: [0, 0, angle - Math.PI / 2],
        position: [cx + Math.cos(angle) * (archRadius + 0.4), baseY + archBase + Math.sin(angle) * (archRadius + 0.4), frontZ],
        // Light greys for the same reason as jitter() above -- the map is doing the
        // colouring, so a stone-coloured vertex tint here would just darken it twice.
        color: [0xf2efe8, 0xd8d2c6, 0xe9e3d8, 0xcac3b6, 0xfaf7f0][v % 5],
      });
    }
    wallParts.push({
      geometry: new THREE.BoxGeometry(denWidth, height - archBase - archRadius, 1.4),
      position: [cx, baseY + (height + archBase + archRadius) / 2, frontZ],
      color: jitter(),
    });
  }
  // vertexColors AND a map together: the merged geometry keeps each block's own 0..1
  // UVs, so the puddingstone tiles once per stone, which is what a coursed wall of it
  // would actually look like.
  const facade = mergedMesh(wallParts, { roughness: 0.95, vertexColors: true });
  facade.material.map = puddingstoneTexture(1, 1, 67);
  g.add(facade);

  // Cornice. Kept shallow at the front: a deep overhang throws the whole facade into
  // its own shadow, and these arches are already the darkest thing in the park.
  g.add(box(width + 2, 1.1, 11.6, stone, 0, baseY + height + 0.55, -0.6));

  // Iron bars across each opening.
  const barParts = [];
  for (let d = 0; d < dens; d++) {
    const cx = denCenter(d);
    const bars = 9;
    for (let b = 0; b < bars; b++) {
      const bx = cx - archRadius + ((archRadius * 2) / (bars - 1)) * b;
      const reach = Math.sqrt(Math.max(0, archRadius * archRadius - (bx - cx) * (bx - cx)));
      barParts.push({
        geometry: new THREE.CylinderGeometry(0.09, 0.09, archBase + reach, 6),
        position: [bx, baseY + (archBase + reach) / 2, frontZ],
        color: 0x2b2f33,
      });
    }
    barParts.push({
      geometry: new THREE.CylinderGeometry(0.11, 0.11, archRadius * 2, 6),
      rotation: [0, 0, Math.PI / 2],
      position: [cx, baseY + archBase, frontZ],
      color: 0x2b2f33,
    });
  }
  g.add(mergedMesh(barParts, { roughness: 0.5, metalness: 0.6 }));

  return g;
}

// Stone gate piers with an iron overthrow carrying the park's name -- the threshold
// the world opens on.
export function parkGate({ name = 'FRANKLIN PARK', opening = 16, pierHeight = 11 } = {}) {
  const g = group();
  const stone = stoneMat(1.5, 2, 71);
  const iron = IRON();

  for (const sx of [-1, 1]) {
    const x = (sx * (opening + 3.6)) / 2;
    g.add(box(4.4, 0.6, 4.4, stone, x, 0.3, 0));
    g.add(box(3.6, pierHeight, 3.6, stone, x, 0.6 + pierHeight / 2, 0));
    g.add(box(4.4, 0.7, 4.4, standard({ color: 0x8a8073, roughness: 0.9 }), x, 0.6 + pierHeight + 0.35, 0));
    g.add(sphere(1.0, standard({ color: 0x7d7468, roughness: 0.9 }), x, 0.6 + pierHeight + 1.3, 0, 16));
  }

  // Iron overthrow arch across the opening, with the park name on it.
  const arcRadius = opening / 2 + 1.8;
  const arch = mesh(
    new THREE.TorusGeometry(arcRadius, 0.16, 8, 32, Math.PI),
    iron,
    0,
    0.6 + pierHeight - 1.2,
    0
  );
  g.add(arch);
  for (let i = 0; i < 9; i++) {
    const angle = (Math.PI * (i + 0.5)) / 9;
    g.add(cyl(0.06, 0.06, 1.6, iron, Math.cos(angle) * arcRadius * 0.94, 0.6 + pierHeight - 1.2 + Math.sin(angle) * arcRadius * 0.94 - 0.8, 0, 6));
  }

  const texture = canvasTexture(1024, 200, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#1f2a24';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 22);
    ctx.fill();
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 16);
    ctx.stroke();
    ctx.fillStyle = '#f2e7c8';
    ctx.textAlign = 'center';
    ctx.font = 'bold 92px Georgia, "Times New Roman", serif';
    ctx.fillText(name, w / 2, h * 0.7);
  });
  const nameplate = signPanel(opening * 0.85, opening * 0.85 * (200 / 1024), texture);
  nameplate.position.set(0, 0.6 + pierHeight - 1.2 + arcRadius * 0.52, 0.1);
  g.add(nameplate);

  return g;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

function waterTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2f6f8f');
    grad.addColorStop(0.5, '#3b8099');
    grad.addColorStop(1, '#27607d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const rng = seededRandom(97);
    ctx.strokeStyle = 'rgba(210,238,248,0.3)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 150; i++) {
      ctx.lineWidth = randomIn(rng, 1, 3.2);
      const x = randomIn(rng, 0, w);
      const y = randomIn(rng, 0, h);
      const len = randomIn(rng, 16, 60);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len / 2, y + randomIn(rng, -5, 5), x + len, y);
      ctx.stroke();
    }
  });
}

// Scarboro Pond: a shallow basin with a planted bank, a water surface, lily pads,
// cattails and a pair of geese.
//
// Same construction as the moon's craters -- a lathe bank whose outer apron drops
// below y=0 so it beds into whatever the terrain is doing, with the water plane held
// just inside the rim. That keeps the pond flat and level on rolling ground without
// needing to cut the terrain mesh.
export function parkPond({ radius = 22, seed = 23, geese = true } = {}) {
  const rng = seededRandom(seed);
  const g = group();

  const profile = [
    [0.0, -1.4],
    [0.5, -1.3],
    [0.82, -0.5],
    [0.95, 0.55],
    [1.0, 0.75],
    [1.12, 0.1],
    [1.3, -1.6],
  ].map(([r, y]) => new THREE.Vector2(r * radius, y));

  const bankGeometry = new THREE.LatheGeometry(profile, 56);
  const position = bankGeometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y > 0.1) position.setY(i, y * randomIn(rng, 0.7, 1.3));
  }
  bankGeometry.computeVertexNormals();
  const bank = mesh(bankGeometry, standard({ color: 0x4f6b3a, roughness: 1, flatShading: true }));
  bank.castShadow = false;
  g.add(bank);

  // The painted ripple streaks double as the bump map, which is what turns a flat disc
  // of blue-grey into a surface the sun actually glints off as you walk round it. A
  // near-mirror surface (roughness 0.12) is the one place relief pays off most, since
  // every bump swings a specular highlight rather than just shading a diffuse face.
  const ripples = waterTexture();
  const water = mesh(
    new THREE.CircleGeometry(radius * 0.93, 64),
    standard({
      map: ripples,
      bumpMap: ripples,
      bumpScale: 0.35,
      roughness: 0.12,
      metalness: 0.45,
      transparent: true,
      opacity: 0.9,
    }),
    0,
    -0.15,
    0
  );
  water.rotation.x = -Math.PI / 2;
  water.castShadow = false;
  g.add(water);

  // Lily pads.
  const padParts = [];
  for (let i = 0; i < 26; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = randomIn(rng, 0.25, 0.82) * radius;
    padParts.push({
      geometry: new THREE.CylinderGeometry(randomIn(rng, 0.5, 1.0), randomIn(rng, 0.5, 1.0), 0.07, 9),
      position: [Math.cos(angle) * distance, -0.07, Math.sin(angle) * distance],
      color: 0x3f7a3a,
    });
    if (rng() < 0.3) {
      padParts.push({
        geometry: new THREE.SphereGeometry(0.22, 7, 6),
        position: [Math.cos(angle) * distance, 0.06, Math.sin(angle) * distance],
        color: 0xf6f0f5,
      });
    }
  }
  const pads = mergedMesh(padParts, { roughness: 0.85, flatShading: true });
  pads.castShadow = false;
  g.add(pads);

  // Cattails and reeds around the margin.
  const reedParts = [];
  for (let i = 0; i < 130; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = randomIn(rng, 0.9, 1.06) * radius;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const tall = randomIn(rng, 2.2, 4.2);
    reedParts.push({
      geometry: new THREE.CylinderGeometry(0.045, 0.06, tall, 4),
      rotation: [randomIn(rng, -0.12, 0.12), 0, randomIn(rng, -0.12, 0.12)],
      position: [x, tall / 2 + 0.2, z],
      color: 0x6f8a3f,
    });
    if (rng() < 0.45) {
      reedParts.push({
        geometry: new THREE.CylinderGeometry(0.15, 0.15, 0.9, 6),
        position: [x, tall + 0.2, z],
        color: 0x6b4522,
      });
    }
  }
  g.add(mergedMesh(reedParts, { roughness: 0.9, flatShading: true }));

  // The geese are an option rather than a fixture -- see pondGeese() below. The whole
  // group goes in, not `.children[0]`: a goose is three merged meshes now (matte
  // underparts, matte plumage, glossy head), not the single blob it used to be.
  if (geese) g.add(pondGeese({ spread: radius * 0.3 }));

  return g;
}

// ---------------------------------------------------------------------------
// Canada goose (Branta canadensis)
// ---------------------------------------------------------------------------

// Modelled from a photograph of a bird standing on grass, and the plumage below is
// really a list of the field marks that photograph shows -- because those marks, not the
// overall blob, are what makes a goose read as a goose:
//
//   * a GLOSSY BLACK head and neck, held tall, on a body that is not black at all
//   * the white CHINSTRAP sweeping up the cheek from under the throat -- the single
//     diagnostic mark of the species, and the first thing to get right
//   * a barred brown back and folded wing, every feather edged in pale buff, tiled like
//     roof slates so the whole flank reads as scalloped rather than as one brown patch
//   * a pale greyish breast that is much lighter than instinct suggests
//   * a WHITE undertail band under a short black tail, with the dark primaries crossing
//     back over it
//   * black webbed feet on short legs set well back under the body
//
// Sizes are real: 2.8ft to the crown of a standing bird, 2.7ft bill to tail. Against a
// 5ft player that is a bird a child could look in the eye if it stood on a bench, which
// is exactly the impression a real Canada goose makes and the old three-sphere version
// (2.1ft, no wing, no chinstrap) entirely missed.
const GOOSE = {
  black: 0x17171c, // head and neck
  bill: 0x121114,
  chin: 0xf4f1e8, // chinstrap and cheek
  back: 0x7d6a50, // mantle and wing coverts
  backDark: 0x584a35, // secondaries and the folded primaries
  edge: 0xd8c9ad, // the pale feather edging that makes the barring
  edgeDark: 0xa8977c,
  // Much paler than instinct says. On a real Canada goose the breast is a light greyish
  // buff, not a mid brown -- it is nearly as light as the belly, and darkening it is the
  // fastest way to turn the bird into an anonymous dark lump.
  breast: 0xd4cbb7,
  belly: 0xefeade, // belly and the undertail band
  tail: 0x252220,
  leg: 0x35332e,
};

// Pushes one solid into `list` with a full position/rotation/scale baked into the
// geometry, so a whole flock can share one merge.
//
// mergeColored() applies only a Euler rotation and a translation per part, and a bird
// needs neither of those things on their own: nearly every piece here is a squashed
// sphere or a feather rolled about its own long axis, and a pair of geese wants to come
// out as three draw calls TOTAL rather than three per bird. Baking a Matrix4 into a
// geometry we already own costs nothing and buys both.
// `about` is the point the rotation and scale happen around, and it is not optional
// decoration: the swept tubes here are authored in ABSOLUTE bird coordinates, so
// flattening the belly by 0.6 with the default origin pivot does not squash the belly,
// it drops it half a foot through the floor. Solids built at the origin (every sphere and
// every feather) need no pivot and pass `pos` instead.
function gooseSolid(list, geometry, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], about = null } = {}, base = null) {
  let m = new THREE.Matrix4().compose(
    new THREE.Vector3(pos[0], pos[1], pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  if (about) {
    m = new THREE.Matrix4()
      .makeTranslation(pos[0] + about[0], pos[1] + about[1], pos[2] + about[2])
      .multiply(new THREE.Matrix4().compose(
        new THREE.Vector3(0, 0, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
        new THREE.Vector3(scale[0], scale[1], scale[2])
      ))
      .multiply(new THREE.Matrix4().makeTranslation(-about[0], -about[1], -about[2]));
  }
  geometry.applyMatrix4(base ? base.clone().multiply(m) : m);
  list.push({ geometry, color });
}

// Builds one goose into the three shared part lists.
//
// THREE merges, not one, and not ten: matte plumage, matte pale underparts and a glossy
// near-black head all need genuinely different roughness, and mergedMesh takes one
// material per merge. Everything else -- every feather, the legs, the bill -- is sorted
// into whichever of the three it belongs to.
function gooseParts({ pale, plumage, dark }, { pose = 'stand', headTurn = 0, seed = 3, base = null } = {}) {
  const rng = seededRandom(seed);
  // A swimming bird is the same bird sunk to its waterline with its legs out of sight.
  // The waterline is local y = 0 in that pose, which is the one deliberate break from the
  // "origin is the base centre" house rule -- a floating bird has no base.
  const lift = pose === 'swim' ? -1.28 : 0;
  const put = (list, geometry, color, t = {}) =>
    gooseSolid(list, geometry, color, { ...t, pos: [t.pos?.[0] ?? 0, (t.pos?.[1] ?? 0) + lift, t.pos?.[2] ?? 0] }, base);

  // Low segment counts on purpose. These birds are read from across a pond on a school
  // Chromebook, and at that distance a 26-segment sweep and an 18-segment one are the same
  // goose -- the barring and the chinstrap carry the identification, not the smoothness of
  // the belly. Trimming every sweep and sphere here took the pair from 11.5k triangles to
  // under 8k for no visible change at any distance a student actually stands.
  const tube = (points, radii, segments = 16) =>
    taperedTube(points, radii, { tubularSegments: segments, radialSegments: 10 });

  // --- body ------------------------------------------------------------------------
  // One swept tube from the tail to the breast. A goose body is a teardrop with the fat
  // end forward, which is a taper, so this is exactly what taperedTube is for -- a pair
  // of spheres cannot make the long fall from breast to tail that gives the bird its line.
  put(pale, tube(
    [[0, 1.24, -1.28], [0, 1.22, -0.92], [0, 1.26, -0.45], [0, 1.32, 0.05], [0, 1.40, 0.52], [0, 1.52, 0.86], [0, 1.62, 1.04]],
    [0.16, 0.35, 0.54, 0.60, 0.55, 0.40, 0.20], 18
  ), GOOSE.breast, { scale: [0.96, 1.02, 1], about: [0, 1.32, 0] });

  // Belly and undertail, both distinctly whiter than the flanks.
  put(pale, tube(
    [[0, 1.00, -0.80], [0, 0.96, -0.30], [0, 0.98, 0.20], [0, 1.06, 0.66]],
    [0.24, 0.35, 0.37, 0.30], 12
  ), GOOSE.belly, { scale: [1.12, 0.58, 1], about: [0, 1.00, 0] });
  put(pale, new THREE.SphereGeometry(0.30, 10, 8), GOOSE.belly, {
    pos: [0, 1.16, -1.14], scale: [0.86, 0.60, 1.20],
  });

  // --- folded wing and mantle ---------------------------------------------------------
  // A SOLID wing shell first, feather rows laid over it second -- and that order is the
  // fix for the first version of this bird, which had rows and nothing under them. Widely
  // spaced blocks floating on a bare flank do not read as a wing; they read as planks
  // stacked on a goose. The shell supplies the mass and the silhouette, the rows supply
  // the barring, and neither does the other's job.
  //
  // The shell starts BEHIND the shoulder (z = 0.56) so the pale breast in front of it
  // stays exposed. On the real bird that pale breast is a third of what you see from the
  // side, and burying it under the wing is what made the first pass read as a dark lump.
  for (const side of [-1, 1]) {
    put(plumage, tube(
      [[side * 0.30, 1.72, 0.56], [side * 0.42, 1.64, 0.16], [side * 0.45, 1.50, -0.32],
        [side * 0.41, 1.36, -0.78], [side * 0.33, 1.28, -1.20]],
      [0.20, 0.28, 0.29, 0.23, 0.13], 12
    ), GOOSE.back, { scale: [0.62, 1, 1], about: [side * 0.40, 1.52, -0.3] });
  }
  // Mantle: a flattened cap along the spine, closing the gap between the two wings.
  put(plumage, tube(
    [[0, 1.80, 0.42], [0, 1.86, 0], [0, 1.82, -0.45], [0, 1.72, -0.85]],
    [0.22, 0.26, 0.24, 0.18], 12
  ), GOOSE.back, { scale: [1.5, 0.5, 1], about: [0, 1.82, 0] });

  // Feather rows tiled over the shell like roof slates, each one a shallow ridge with a
  // PALE BLOCK ON ITS TRAILING TIP. That pale tip is the whole trick: a Canada goose's
  // back is not brown, it is brown feathers with buff edges, and painting it one flat
  // brown loses the bird completely.
  //
  // They OVERLAP -- the step down the row is half a feather, not a whole one. Spaced
  // feather-to-feather they came out as a row of separate slats with the shell showing
  // between them, which is a fence and not plumage.
  //
  // The pale tip is translated in the feather's own space BEFORE the placement matrix, so
  // it orbits into position with the feather instead of needing its own trigonometry.
  // Each row's `x` is set to land just OUTSIDE the shell at that row's own height, which
  // is why they are not a straight line: the shell is a flattened tube, so it is widest at
  // its middle (y ~1.5) and narrows toward the spine and the flank. Set to a constant the
  // rows sink inside the shell and the barring vanishes entirely -- the wing goes back to
  // being one flat brown mass, which is the exact thing the rows exist to prevent.
  const rows = [
    { y: 1.80, x: 0.36, roll: 0.20, len: 0.34, w: 0.15, n: 6, z: 0.42, dz: -0.20, color: GOOSE.back, edge: GOOSE.edge },
    { y: 1.66, x: 0.50, roll: 0.55, len: 0.38, w: 0.16, n: 6, z: 0.36, dz: -0.22, color: GOOSE.back, edge: GOOSE.edge },
    { y: 1.50, x: 0.56, roll: 0.90, len: 0.42, w: 0.16, n: 6, z: 0.26, dz: -0.24, color: GOOSE.backDark, edge: GOOSE.edge },
    { y: 1.35, x: 0.52, roll: 1.15, len: 0.46, w: 0.16, n: 5, z: 0.10, dz: -0.26, color: GOOSE.backDark, edge: GOOSE.edgeDark },
  ];
  for (const side of [-1, 1]) {
    for (const row of rows) {
      for (let i = 0; i < row.n; i++) {
        const len = row.len * (1 + i * 0.05);
        const t = {
          pos: [side * row.x, row.y - i * 0.012, row.z + row.dz * i],
          rot: [0.20, side * -0.06, side * row.roll],
        };
        put(plumage, new THREE.BoxGeometry(row.w, 0.04, len), row.color, t);
        const tip = new THREE.BoxGeometry(row.w * 0.94, 0.05, len * 0.30);
        tip.translate(0, 0, -len * 0.35);
        put(plumage, tip, row.edge, t);
      }
    }

    // The folded primaries: three long dark quills crossing back OVER the tail, which is
    // what gives a standing goose its pointed stern. Without them the bird ends bluntly.
    for (let i = 0; i < 3; i++) {
      put(plumage, new THREE.BoxGeometry(0.09, 0.038, 0.95), GOOSE.backDark, {
        pos: [side * (0.26 - i * 0.05), 1.40 - i * 0.06, -1.03 - i * 0.04],
        rot: [0.28, side * -0.04, side * (1.35 + i * 0.08)],
      });
    }
  }

  // Short black tail, fanned and dropping away at the rear.
  for (let i = 0; i < 5; i++) {
    const t = (i - 2) / 2;
    put(plumage, new THREE.BoxGeometry(0.13, 0.04, 0.50), GOOSE.tail, {
      pos: [t * 0.22, 1.16 - Math.abs(t) * 0.02, -1.42],
      rot: [0.30, t * 0.20, t * 0.14],
    });
  }

  // --- neck, head, bill --------------------------------------------------------------
  // A LONG neck, and long is the point. A Canada goose carries its head a full body-depth
  // clear of its back; shortened to something that looks reasonable on paper the bird
  // reads as hunched, which is a sick goose or a duck and not this one.
  put(dark, tube(
    [[0, 1.50, 0.68], [0, 1.78, 0.76], [0, 2.10, 0.84], [0, 2.44, 0.90], [0, 2.66, 0.96]],
    [0.30, 0.22, 0.175, 0.155, 0.155], 16
  ), GOOSE.black);

  // Head turn pivots at the TOP of the neck, not at the shoulders -- a goose swivels its
  // head on the neck it is already holding, and pivoting lower swings the whole bird.
  const pivot = new THREE.Vector3(0, 2.66 + lift, 0.96);
  const headBase = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new THREE.Matrix4().makeRotationY(headTurn))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  const headM = base ? base.clone().multiply(headBase) : headBase;
  const head = (list, geometry, color, t = {}) =>
    gooseSolid(list, geometry, color, { ...t, pos: [t.pos?.[0] ?? 0, (t.pos?.[1] ?? 0) + lift, t.pos?.[2] ?? 0] }, headM);

  head(dark, new THREE.SphereGeometry(0.25, 12, 9), GOOSE.black, {
    pos: [0, 2.82, 1.05], scale: [0.84, 0.92, 1.16],
  });

  // THE CHINSTRAP. Not a white disc on the cheek: it is a strap, narrow up by the eye and
  // broadening down to meet its opposite number under the throat, and getting that sweep
  // is most of what makes the species identifiable at fifty feet.
  //
  // It goes in the PALE merge, not the dark one -- it is the same matte white as the
  // belly, and a glossy chinstrap reads as wet plastic.
  for (const side of [-1, 1]) {
    head(pale, new THREE.SphereGeometry(0.22, 10, 8), GOOSE.chin, {
      pos: [side * 0.163, 2.70, 1.02], rot: [0, 0, side * 0.34], scale: [0.26, 0.54, 0.66],
    });
  }
  head(pale, new THREE.SphereGeometry(0.20, 10, 8), GOOSE.chin, {
    pos: [0, 2.62, 1.01], scale: [0.78, 0.28, 0.78],
  });

  head(dark, tube(
    [[0, 2.80, 1.26], [0, 2.79, 1.38], [0, 2.77, 1.49], [0, 2.76, 1.545]],
    [0.10, 0.088, 0.062, 0.028], 8
  ), GOOSE.bill, { scale: [1.3, 0.72, 1], about: [0, 2.78, 1.4] });

  // Eyes, in the glossy merge so they catch a highlight. A dark eye on a black head is
  // almost invisible as diffuse colour and entirely present as a specular glint, which is
  // exactly how it looks on the real bird.
  for (const side of [-1, 1]) {
    head(dark, new THREE.SphereGeometry(0.034, 6, 5), 0x241c14, { pos: [side * 0.192, 2.86, 1.16] });
  }

  // --- legs -----------------------------------------------------------------------------
  if (pose !== 'swim') {
    for (const side of [-1, 1]) {
      const splay = side * randomIn(rng, 0.9, 1.06);
      put(dark, tube(
        [[splay * 0.21, 1.05, -0.02], [splay * 0.20, 0.72, 0.02], [splay * 0.19, 0.36, 0.06], [splay * 0.185, 0.09, 0.09]],
        [0.085, 0.070, 0.060, 0.055], 8
      ), GOOSE.leg);
      // Webbed foot: one flattened paddle with three toes laid over it. A goose's foot is
      // most of what it stands on and reads clearly from a child's eye height.
      put(dark, new THREE.SphereGeometry(0.22, 8, 6), GOOSE.leg, {
        pos: [splay * 0.19, 0.045, 0.20], rot: [0, side * 0.12, 0], scale: [0.62, 0.20, 1.02],
      });
      for (const toe of [-1, 0, 1]) {
        put(dark, new THREE.BoxGeometry(0.05, 0.05, 0.40), GOOSE.leg, {
          pos: [splay * 0.19 + toe * 0.085, 0.062, 0.24],
          rot: [0, side * 0.12 + toe * 0.26, 0],
        });
      }
    }
  }
}

// A single Canada goose, standing or swimming, as its own placed object.
export function canadaGoose({ pose = 'stand', headTurn = 0, seed = 3 } = {}) {
  const lists = { pale: [], plumage: [], dark: [] };
  gooseParts(lists, { pose, headTurn, seed });
  return group(...gooseMeshes(lists, seed));
}

// The three merges every goose (or flock of them) comes out as.
function gooseMeshes({ pale, plumage, dark }, seed) {
  return [
    // A fine crosshatch bump on both matte merges. Down is not smooth, and a goose lit by
    // one sun with a perfectly smooth breast reads as a porcelain ornament.
    mergedMesh(pale, { roughness: 0.84, ...relief('weave', { seed: seed + 11, repeat: 9, strength: 0.16 }) }),
    mergedMesh(plumage, { roughness: 0.74, ...relief('weave', { seed: seed + 5, repeat: 7, strength: 0.24 }) }),
    // The head and neck are the one genuinely SHINY part of this bird -- black plumage
    // with a visible sheen, plus the bill and the eyes.
    mergedMesh(dark, { roughness: 0.40, metalness: 0.14 }),
  ];
}

// A pair of Canada geese on the water, as their OWN placed object rather than part of
// the pond.
//
// They were built into parkPond(), which meant clicking one selected the entire pond --
// so "program the geese to paddle about" moved the water, the bank and the cattails with
// them. Anything a student is invited to program has to be a thing they can actually
// pick, and that is a placement decision, not a modelling one. parkPond keeps drawing
// its own pair by default so every world already saved with a pond is unchanged; the
// Park now asks for `geese: false` and places this separately on top.
//
// Both birds are built into ONE set of three merges rather than being two groups of
// three, which is why gooseParts() takes a matrix -- a pair costs the same three draw
// calls a single bird does.
export function pondGeese({ spread = 6.6 } = {}) {
  const lists = { pale: [], plumage: [], dark: [] };
  // Kept at the offsets and headings the old pair used, so a saved world's geese are
  // where the student left them; only the bird itself has changed.
  const birds = [
    { x: 0, z: spread * 0.6, turn: 0.6, headTurn: -0.5, seed: 3 },
    { x: spread * 0.53, z: -spread * 0.33, turn: -1.1, headTurn: 0.35, seed: 8 },
  ];
  for (const bird of birds) {
    const base = new THREE.Matrix4()
      .makeTranslation(bird.x, -0.15, bird.z)
      .multiply(new THREE.Matrix4().makeRotationY(bird.turn));
    gooseParts(lists, { pose: 'swim', headTurn: bird.headTurn, seed: bird.seed, base });
  }
  return group(...gooseMeshes(lists, 3));
}

// Tiered stone fountain. The falling water is a pair of thin translucent cones --
// there is no particle system in this app, and at park scale the silhouette is what
// sells it anyway.
export function stoneFountain({ radius = 7 } = {}) {
  const g = group();
  const stone = stoneMat(3, 1, 83);
  const waterMat = () =>
    standard({ color: 0x74c4e0, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.72 });

  g.add(cyl(radius, radius + 0.5, 0.6, stone, 0, 0.3, 0, 28));
  g.add(cyl(radius - 0.9, radius - 0.9, 1.5, stone, 0, 1.05, 0, 28));
  const pool = mesh(new THREE.CircleGeometry(radius - 1.2, 32), waterMat(), 0, 1.55, 0);
  pool.rotation.x = -Math.PI / 2;
  pool.castShadow = false;
  g.add(pool);

  g.add(cyl(0.8, 1.3, 3.2, stone, 0, 3.2, 0, 16));
  g.add(cyl(radius * 0.42, radius * 0.3, 0.5, stone, 0, 5.0, 0, 20));
  const upperPool = mesh(new THREE.CircleGeometry(radius * 0.36, 24), waterMat(), 0, 5.28, 0);
  upperPool.rotation.x = -Math.PI / 2;
  upperPool.castShadow = false;
  g.add(upperPool);

  g.add(cyl(0.35, 0.6, 2.4, stone, 0, 6.4, 0, 14));
  g.add(sphere(0.7, stone, 0, 7.9, 0, 16));

  // Falling sheets of water between the tiers.
  const fall = mesh(new THREE.CylinderGeometry(radius * 0.34, radius * 0.42, 3.3, 24, 1, true), waterMat(), 0, 3.4, 0);
  fall.material.side = THREE.DoubleSide;
  fall.castShadow = false;
  g.add(fall);
  const jet = mesh(new THREE.ConeGeometry(0.5, 2.2, 14, 1, true), waterMat(), 0, 9.0, 0);
  jet.material.side = THREE.DoubleSide;
  jet.castShadow = false;
  g.add(jet);

  return g;
}

// ---------------------------------------------------------------------------
// Park furniture and recreation
// ---------------------------------------------------------------------------

// Picnic table with attached benches, plus a charcoal grill on a post.
export function picnicSet({ length = 7 } = {}) {
  const g = group();
  const wood = standard({ color: 0x9a6b3d, roughness: 0.9 });
  const frame = IRON();

  g.add(box(length, 0.22, 3, wood, 0, 2.5, 0));
  for (const sz of [-1, 1]) {
    g.add(box(length, 0.2, 1.2, wood, 0, 1.5, sz * 2.6));
  }
  for (const sx of [-1, 1]) {
    const x = (sx * (length - 1.6)) / 2;
    for (const sz of [-1, 1]) {
      const leg = box(0.22, 2.6, 0.22, frame, x, 1.3, sz * 2.6);
      leg.rotation.x = sz * -0.32;
      g.add(leg);
    }
    g.add(box(0.24, 0.24, 5.6, frame, x, 1.5, 0));
  }

  const grill = group();
  grill.add(cyl(0.16, 0.2, 3, frame, 0, 1.5, 0, 10));
  grill.add(box(2.2, 0.9, 1.5, frame, 0, 3.3, 0));
  grill.add(box(2.0, 0.1, 1.3, standard({ color: 0x8a8f94, roughness: 0.4, metalness: 0.7 }), 0, 3.8, 0));
  grill.position.set(length / 2 + 3.5, 0, -1);
  g.add(grill);

  return g;
}

// Playground: swing set, slide, climbing dome and a sandbox.
export function playground({ seed = 29 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const frame = standard({ color: 0x2f6b8f, roughness: 0.5, metalness: 0.4 });
  const accent = standard({ color: 0xf2a541, roughness: 0.6 });
  const rubber = standard({ color: 0x7d4a3a, roughness: 1 });

  // Safety surfacing.
  const surface = mesh(new THREE.CircleGeometry(17, 36), rubber, 0, 0.06, 0);
  surface.rotation.x = -Math.PI / 2;
  surface.castShadow = false;
  g.add(surface);

  // Swing set: two A-frames and a top beam.
  const swingH = 9;
  const swingSpan = 12;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = cyl(0.2, 0.24, swingH * 1.12, frame, (sx * swingSpan) / 2, swingH / 2, sz * 2.6, 10);
      leg.rotation.x = sz * 0.26;
      g.add(leg);
    }
  }
  g.add(cyl(0.22, 0.22, swingSpan + 1, frame, 0, swingH, 0, 12).rotateZ(Math.PI / 2));
  for (const sx of [-1, 1]) {
    const x = sx * 3;
    for (const chain of [-0.7, 0.7]) {
      g.add(cyl(0.05, 0.05, swingH - 2.2, frame, x + chain, (swingH + 2.2) / 2, 0, 5));
    }
    g.add(box(1.9, 0.16, 0.7, accent, x, 2.2, 0));
  }

  // Slide: platform, ladder, and an angled chute.
  const platY = 7;
  const platX = -13;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cyl(0.18, 0.2, platY, frame, platX + sx * 1.8, platY / 2, sz * 1.8, 8));
    }
  }
  g.add(box(4.4, 0.3, 4.4, accent, platX, platY, 0));
  g.add(box(4.4, 3, 0.16, frame, platX, platY + 1.5, -2.1));
  for (let i = 0; i < 7; i++) {
    const rung = cyl(0.08, 0.08, 3.4, frame, platX, 0.9 + i * ((platY - 0.9) / 6), 2.4, 6);
    rung.rotation.z = Math.PI / 2;
    g.add(rung);
  }
  const chute = box(3, 0.22, 10.5, standard({ color: 0xf2d541, roughness: 0.4, metalness: 0.3 }), platX, platY / 2 + 0.6, 5.6);
  chute.rotation.x = Math.atan2(platY - 0.4, 9.5);
  g.add(chute);
  for (const sx of [-1, 1]) {
    const kerb = box(0.25, 1, 10.5, accent, platX + sx * 1.6, platY / 2 + 0.9, 5.6);
    kerb.rotation.x = chute.rotation.x;
    g.add(kerb);
  }

  // Climbing dome, built from stacked rings of struts.
  const domeParts = [];
  const domeR = 5.2;
  const rings = 3;
  for (let r = 1; r <= rings; r++) {
    const phi = (Math.PI / 2) * (r / (rings + 0.35));
    const ringR = Math.sin(phi) * domeR;
    const ringY = Math.cos(phi) * domeR;
    const segs = 12;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2;
      const a1 = ((s + 1) / segs) * Math.PI * 2;
      const x0 = Math.cos(a0) * ringR;
      const z0 = Math.sin(a0) * ringR;
      const x1 = Math.cos(a1) * ringR;
      const z1 = Math.sin(a1) * ringR;
      domeParts.push({
        geometry: new THREE.CylinderGeometry(0.1, 0.1, Math.hypot(x1 - x0, z1 - z0) * 1.05, 5),
        rotation: [0, Math.atan2(x1 - x0, z1 - z0), Math.PI / 2],
        position: [(x0 + x1) / 2, ringY + 0.1, (z0 + z1) / 2],
        color: 0x3fb37f,
      });
    }
  }
  for (let s = 0; s < 12; s++) {
    const a = (s / 12) * Math.PI * 2;
    domeParts.push({
      geometry: new THREE.CylinderGeometry(0.1, 0.1, domeR * 1.6, 5),
      rotation: [Math.cos(a) * 0.85, 0, -Math.sin(a) * 0.85],
      position: [Math.sin(a) * domeR * 0.42, domeR * 0.52, Math.cos(a) * domeR * 0.42],
      color: 0x3fb37f,
    });
  }
  const dome = mergedMesh(domeParts, { roughness: 0.5, metalness: 0.3 });
  dome.position.set(12, 0, 2);
  g.add(dome);

  // Sandbox with a scatter of toys.
  const sand = group();
  for (const [dx, dz, w, d] of [[0, 3.4, 7, 0.5], [0, -3.4, 7, 0.5], [3.25, 0, 0.5, 6.8], [-3.25, 0, 0.5, 6.8]]) {
    sand.add(box(w, 0.7, d, standard({ color: 0x9a6b3d, roughness: 0.9 }), dx, 0.35, dz));
  }
  sand.add(box(6.6, 0.5, 6.6, standard({ color: 0xd9c99a, roughness: 1 }), 0, 0.3, 0));
  for (let i = 0; i < 4; i++) {
    sand.add(
      box(
        0.7, 0.5, 0.7,
        standard({ color: [0xe0455f, 0x3d8bf2, 0xf2a541, 0x3fb37f][i], roughness: 0.7 }),
        randomIn(rng, -2.4, 2.4),
        0.75,
        randomIn(rng, -2.4, 2.4)
      )
    );
  }
  sand.position.set(2, 0, -12);
  g.add(sand);

  return g;
}

// The Playstead: a ball field with a chain-link backstop, bases and a pitcher's mound.
// The backstop mesh is a single alpha-mapped plane -- modelling real chain link would
// be tens of thousands of triangles for something you look straight through.
export function ballField({ baseline = 30 } = {}) {
  const g = group();
  const frame = standard({ color: 0x6f7276, roughness: 0.5, metalness: 0.5 });

  const chainLink = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#c8ccd0';
    ctx.lineWidth = 5;
    for (let i = -w; i < w * 2; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + w, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, h);
      ctx.lineTo(i + w, 0);
      ctx.stroke();
    }
  });
  chainLink.wrapS = THREE.RepeatWrapping;
  chainLink.wrapT = THREE.RepeatWrapping;
  chainLink.repeat.set(9, 3);

  const meshMat = standard({
    map: chainLink,
    alphaMap: chainLink,
    transparent: true,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0.4,
  });

  // Backstop: a central panel with two angled wings.
  const panels = [
    { w: 20, x: 0, z: 0, rot: 0 },
    { w: 10, x: -13.6, z: 4.2, rot: 0.9 },
    { w: 10, x: 13.6, z: 4.2, rot: -0.9 },
  ];
  for (const panel of panels) {
    const screen = mesh(new THREE.PlaneGeometry(panel.w, 12), meshMat, panel.x, 6, panel.z);
    screen.rotation.y = panel.rot;
    screen.castShadow = false;
    g.add(screen);
    for (const sx of [-1, 1]) {
      const post = cyl(0.24, 0.28, 12.6, frame, panel.x + Math.cos(panel.rot) * ((sx * panel.w) / 2), 6.3, panel.z - Math.sin(panel.rot) * ((sx * panel.w) / 2), 10);
      g.add(post);
    }
  }
  g.add(box(42, 0.3, 0.3, frame, 0, 12.3, 2));

  // Infield: dirt diamond, mound, bases and home plate.
  const dirt = standard({ color: 0xa8794a, roughness: 1 });
  const infield = mesh(new THREE.CircleGeometry(baseline * 0.62, 40), dirt, 0, 0.05, 0);
  infield.rotation.x = -Math.PI / 2;
  infield.castShadow = false;
  infield.position.z = -baseline * 0.72;
  g.add(infield);

  const white = standard({ color: 0xf5f5f5, roughness: 0.85 });
  g.add(box(1.4, 0.12, 1.4, white, 0, 0.12, -6));
  const basePositions = [
    [baseline * 0.62, -baseline * 0.72],
    [0, -baseline * 1.06],
    [-baseline * 0.62, -baseline * 0.72],
  ];
  for (const [bx, bz] of basePositions) g.add(box(1.3, 0.14, 1.3, white, bx, 0.13, bz));

  const mound = mesh(new THREE.SphereGeometry(4.4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), dirt, 0, 0, -baseline * 0.72);
  mound.scale.y = 0.16;
  mound.castShadow = false;
  g.add(mound);
  g.add(box(1.6, 0.12, 0.5, white, 0, 0.72, -baseline * 0.72));

  return g;
}

// A painted park map on a roofed board -- map reading is a skill, and this one shows
// students where everything in the world actually is.
export function mapKiosk({ width = 8, height = 5.4 } = {}) {
  const g = group();
  const timber = timberMat();

  for (const sx of [-1, 1]) {
    g.add(cyl(0.22, 0.28, 8.4, timber, (sx * (width - 0.9)) / 2, 4.2, 0, 10));
  }

  const texture = canvasTexture(1024, 690, (ctx, w, h) => {
    ctx.fillStyle = '#e9e2cd';
    ctx.fillRect(0, 0, w, h);

    // Lawns and woods.
    ctx.fillStyle = '#b9d49a';
    ctx.fillRect(40, 90, w - 80, h - 150);
    ctx.fillStyle = '#7fa864';
    for (const [x, y, rx, ry] of [[170, 480, 120, 90], [860, 200, 130, 100], [830, 520, 120, 80], [420, 150, 150, 60]]) {
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pond.
    ctx.fillStyle = '#5b9dc4';
    ctx.beginPath();
    ctx.ellipse(250, 300, 130, 88, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#3c7799';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Paths.
    ctx.strokeStyle = '#d9c9a3';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(512, h - 60);
    ctx.bezierCurveTo(512, 500, 470, 400, 512, 300);
    ctx.bezierCurveTo(560, 200, 540, 160, 512, 110);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(512, 430);
    ctx.bezierCurveTo(400, 400, 330, 360, 250, 300);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(512, 380);
    ctx.bezierCurveTo(680, 360, 780, 330, 880, 280);
    ctx.stroke();

    const pins = [
      [512, h - 90, 'YOU ARE HERE', '#c0392b'],
      [512, 300, 'Bandstand', '#2c3e50'],
      [250, 300, 'Scarboro Pond', '#2c3e50'],
      [860, 300, 'The Playstead', '#2c3e50'],
      [800, 560, 'Bear Dens', '#2c3e50'],
      [330, 560, 'Overlook Shelter', '#2c3e50'],
      [700, 150, 'Puddingstone', '#2c3e50'],
      [300, 130, 'Playground', '#2c3e50'],
    ];
    for (const [x, y, label, color] of pins) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 22px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y - 18);
    }

    ctx.fillStyle = '#2c3e50';
    ctx.textAlign = 'left';
    ctx.font = 'bold 42px Georgia, serif';
    ctx.fillText('PARK MAP', 46, 62);
    ctx.font = '22px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('N ↑    ·    1 square ≈ 40 feet', w - 46, 60);
  });

  const board = signPanel(width, height, texture);
  board.position.set(0, 5.2, 0.09);
  g.add(box(width + 0.5, height + 0.5, 0.16, timber, 0, 5.2, 0), board);
  // Little gable roof to keep the "paper" dry.
  for (const sz of [-1, 1]) {
    const slope = box(width + 1.4, 0.3, 2.2, shingleMat(), 0, 8.7, sz * 0.9);
    slope.rotation.x = sz * 0.5;
    g.add(slope);
  }

  return g;
}

// A fingerpost of directional arms -- what makes a network of paths navigable.
export function trailSign({ arms = [], height = 8 } = {}) {
  const g = group();
  const timber = timberMat();
  g.add(cyl(0.19, 0.26, height, timber, 0, height / 2, 0, 10));
  g.add(sphere(0.3, timber, 0, height + 0.15, 0, 12));

  const list = arms.length ? arms : [{ label: 'THIS WAY', angle: 0 }];
  list.forEach((arm, i) => {
    const y = height - 1.2 - i * 1.5;
    const texture = canvasTexture(512, 110, (ctx, w, h) => {
      ctx.fillStyle = '#3f5f3a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f2ead6';
      ctx.textAlign = 'center';
      ctx.font = 'bold 46px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(arm.label, w / 2 - 20, h * 0.66);
      // Arrow head at the pointing end.
      ctx.beginPath();
      ctx.moveTo(w - 12, h / 2);
      ctx.lineTo(w - 62, 16);
      ctx.lineTo(w - 62, h - 16);
      ctx.closePath();
      ctx.fill();
    });
    const blade = signPanel(4.6, 1.0, texture);
    const holder = group(box(4.7, 1.1, 0.12, timber), blade);
    blade.position.z = 0.08;
    holder.position.set(Math.sin(arm.angle) * 2.5, y, Math.cos(arm.angle) * 2.5);
    holder.rotation.y = arm.angle + Math.PI / 2;
    g.add(holder);
  });

  return g;
}

// Drinking fountain -- small, but it is the kind of ordinary detail that makes a
// modelled place feel like somewhere people actually go.
export function drinkingFountain() {
  const g = group();
  const stone = stoneMat(1, 1, 91);
  g.add(cyl(1.0, 1.2, 0.3, stone, 0, 0.15, 0, 16));
  g.add(box(1.5, 2.6, 1.3, stone, 0, 1.45, 0));
  g.add(cyl(0.62, 0.62, 0.35, standard({ color: 0xb9bdc2, roughness: 0.35, metalness: 0.7 }), 0, 2.9, 0.1, 16));
  const spout = cyl(0.07, 0.07, 0.6, standard({ color: 0xb9bdc2, roughness: 0.3, metalness: 0.8 }), 0, 3.1, -0.25, 8);
  spout.rotation.x = 0.6;
  g.add(spout);
  return g;
}
