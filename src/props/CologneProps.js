import * as THREE from 'three';
import {
  standard,
  mesh,
  group,
  mergedMesh,
  canvasTexture,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// Cologne Cathedral -- the Cathedral of St Peter -- at about 1/3 life size.
//
// WHY 1/3: it is 515ft to the spire tips and 474ft long, and WORLD_BOUND_RADIUS is 195. At
// true size a student could not stand far enough away to see the top of it. At 1/3 the
// spires reach 172ft and the whole church is 158ft long, which fits with room to walk
// round. The placard states the real figures, the same bargain the Colosseum makes.
//
// THE OPENWORK SPIRES ARE THE BUILDING. Everything about this cathedral that a person
// recognises is in those two filigree spikes: they are not solid masonry but a stone
// LATTICE you can see daylight through, and they were the tallest structures on earth when
// they were finished in 1880. A pair of smooth cones here would be a different cathedral
// entirely, so `openworkSpire()` builds real ribs with real gaps and takes the triangle
// budget it needs -- about half this world's total.
//
// THE STONE IS NEARLY BLACK. Cologne's sandstone weathers to soot and the building is
// famously dark, which is a lighting problem rather than a colour one: a black object needs
// a bright background or it is a silhouette with no readable detail. That is what the
// `cologne` theme's very light sky and high hemisphere fill are for, and the fill is
// specifically what gets INTO the openwork.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

const STONE = 0x4a4a48;          // soot-blackened sandstone
const STONE_LIT = 0x666663;      // the faces that catch the sun
const STONE_PALE = 0x7d7c76;     // cleaned stone, and the newer repairs
const STONE_DEEP = 0x33332f;
const ROOF_LEAD = 0x5a6360;
const GLASS_WARM = 0xb8823c;
const GLASS_COOL = 0x3d5f8a;
const GLASS_RED = 0x8a3a35;
const GOLD = 0xb99433;
const CRANE_YELLOW = 0xc8a33a;
const PAVING = 0xa39c90;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ball(radius, detail = 10) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// A pyramid, point up, flats facing the axes.
function pyramid(radius, height, segments = 4) {
  const g = new THREE.ConeGeometry(radius, height, segments);
  if (segments === 4) g.rotateY(Math.PI / 4);
  return g;
}

// A gothic pinnacle: a slender shaft with a steep spirelet and a crocketed finial. There
// are hundreds of these on the real building and they are most of its bristling outline,
// so this is the most-called helper in the file.
function pinnacle(parts, { x, y, z, width, height, color = STONE }) {
  parts.push({ geometry: new THREE.BoxGeometry(width, height * 0.42, width), position: [x, y + height * 0.21, z], color });
  const spike = pyramid(width * 0.72, height * 0.58);
  spike.translate(x, y + height * 0.42 + height * 0.29, z);
  parts.push({ geometry: spike, color });
  // Crockets: the little leafy knobs up the spirelet's edges. Four of them, tiny, and
  // collectively the difference between "gothic" and "a spike".
  for (let i = 0; i < 3; i++) {
    const t = 0.25 + i * 0.25;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      parts.push({
        geometry: ball(width * 0.13, 5),
        position: [
          x + dx * width * 0.4 * (1 - t),
          y + height * 0.42 + height * 0.58 * t,
          z + dz * width * 0.4 * (1 - t),
        ],
        color,
      });
    }
  }
}

// A pointed-arch opening, standing PROUD of a wall rather than cut into it -- these walls
// are solid boxes and an opening set at the inner face would be sealed inside the masonry.
function gothicArch(parts, { x, y, z, width, height, rotY = 0, depth = 0.5, color = STONE_DEEP }) {
  const shaftH = height * 0.62;
  const shaft = new THREE.BoxGeometry(width, shaftH, depth);
  shaft.translate(0, shaftH / 2, 0);
  const head = new THREE.ConeGeometry(width / 2, height - shaftH, 3);
  head.rotateY(Math.PI / 2);
  head.scale(1, 1, depth / width);
  head.translate(0, shaftH + (height - shaftH) / 2, 0);
  for (const g of [shaft, head]) {
    g.rotateY(rotY);
    g.translate(x, y, z);
    parts.push({ geometry: g, color });
  }
}

// ---------------------------------------------------------------------------
// 1. The openwork spire
// ---------------------------------------------------------------------------

// A tapering LATTICE, not a cone.
//
// Eight ribs rising to the finial, tied by horizontal rings, with the gaps left open. The
// silhouette a student sees is therefore full of holes, which is the whole identity of
// these two spires -- and it only works because the ribs are real geometry: relief() and
// any texture trick fake lighting, never silhouette, so neither can put a hole in anything.
//
// Built as a stack of RINGS of short segments rather than as continuous tapering tubes,
// because each ring can then carry its own gablets and crockets at its own radius, and
// because a merged stack of boxes is far cheaper than eight swept tubes with the same
// visible detail.
function openworkSpire(parts, { x, z, baseY, height, baseRadius, ribs = 8, seed = 5 }) {
  const RINGS = 14;
  const rng = seededRandom(seed);

  for (let r = 0; r < RINGS; r++) {
    const t0 = r / RINGS;
    const t1 = (r + 1) / RINGS;
    // The taper is CONCAVE -- fast at the bottom, slowing near the top -- which is what a
    // gothic spire does. A straight linear taper reads as a party hat.
    const rad0 = baseRadius * (1 - t0) ** 1.25;
    const rad1 = baseRadius * (1 - t1) ** 1.25;
    const y0 = baseY + height * t0;
    const y1 = baseY + height * t1;

    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2;
      const p0 = new THREE.Vector3(Math.cos(a) * rad0, y0, Math.sin(a) * rad0);
      const p1 = new THREE.Vector3(Math.cos(a) * rad1, y1, Math.sin(a) * rad1);
      const dir = p1.clone().sub(p0);
      const len = dir.length();
      const thick = Math.max(0.32, baseRadius * 0.075 * (1 - t0 * 0.5));

      const rib = new THREE.BoxGeometry(thick, len, thick);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      rib.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      rib.translate(x + mid.x, mid.y, z + mid.z);
      parts.push({ geometry: rib, color: r % 3 === 0 ? STONE_LIT : STONE });
    }

    // A tie ring at each stage: short bars between adjacent ribs. Without them the ribs
    // read as eight separate poles and the spire has no structure.
    if (r % 2 === 0) {
      for (let i = 0; i < ribs; i++) {
        const a0 = (i / ribs) * Math.PI * 2;
        const a1 = ((i + 1) / ribs) * Math.PI * 2;
        const p0 = new THREE.Vector3(Math.cos(a0) * rad0, y0, Math.sin(a0) * rad0);
        const p1 = new THREE.Vector3(Math.cos(a1) * rad0, y0, Math.sin(a1) * rad0);
        const dir = p1.clone().sub(p0);
        const bar = new THREE.BoxGeometry(dir.length(), baseRadius * 0.07, baseRadius * 0.05);
        bar.rotateY(-Math.atan2(dir.z, dir.x));
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        bar.translate(x + mid.x, mid.y, z + mid.z);
        parts.push({ geometry: bar, color: STONE_LIT });
      }
      // Crockets on the ribs at this ring -- the knobbly edge that makes the silhouette
      // bristle. On the real spires there are thousands.
      for (let i = 0; i < ribs; i++) {
        const a = (i / ribs) * Math.PI * 2;
        parts.push({
          geometry: ball(Math.max(0.22, baseRadius * 0.055), 5),
          position: [x + Math.cos(a) * rad0 * 1.08, y0 + height / RINGS * 0.5, z + Math.sin(a) * rad0 * 1.08],
          color: STONE_LIT,
        });
      }
    }
  }

  // Finial + cross.
  const tipY = baseY + height;
  parts.push({ geometry: pyramid(baseRadius * 0.1, height * 0.05), position: [x, tipY + height * 0.02, z], color: STONE_LIT });
  parts.push({ geometry: new THREE.BoxGeometry(0.35, height * 0.055, 0.35), position: [x, tipY + height * 0.055, z], color: GOLD });
  parts.push({ geometry: new THREE.BoxGeometry(height * 0.026, 0.35, 0.35), position: [x, tipY + height * 0.052, z], color: GOLD });
}

// ---------------------------------------------------------------------------
// 2. The cathedral
// ---------------------------------------------------------------------------

// The rose window over the west portal. Drawn, not modelled -- tracery this fine would cost
// thousands of triangles and read worse, exactly as the Elizabeth Tower's clock dial does.
function roseWindowTexture(seed = 3) {
  return canvasTexture(768, 768, (ctx, w, h) => {
    const rng = seededRandom(seed);
    const cx = w / 2;
    const cy = h / 2;
    const R = w * 0.47;

    ctx.fillStyle = '#1b1b19';
    ctx.fillRect(0, 0, w, h);

    const petal = (r0, r1, a0, a1, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, r1, a0, a1);
      ctx.arc(cx, cy, r0, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#141412';
      ctx.lineWidth = w * 0.011;
      ctx.stroke();
    };

    const HUES = ['#c0392b', '#2f6ba8', '#c9a227', '#3f7a4a', '#7a3f86', '#b8823c'];
    // Three concentric rings of lights, each ring with more of them -- which is how a rose
    // window is actually laid out and why it reads as a flower.
    const RINGS = [
      { r0: R * 0.16, r1: R * 0.40, n: 8 },
      { r0: R * 0.40, r1: R * 0.68, n: 16 },
      { r0: R * 0.68, r1: R * 0.94, n: 24 },
    ];
    for (const ring of RINGS) {
      for (let i = 0; i < ring.n; i++) {
        const a0 = (i / ring.n) * Math.PI * 2;
        const a1 = ((i + 1) / ring.n) * Math.PI * 2;
        petal(ring.r0, ring.r1, a0 + 0.02, a1 - 0.02, HUES[Math.floor(randomIn(rng, 0, HUES.length))]);
      }
    }
    // The oculus at the centre.
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#141412';
    ctx.lineWidth = w * 0.018;
    ctx.stroke();

    // The stone rim.
    ctx.strokeStyle = '#33332f';
    ctx.lineWidth = w * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.97, 0, Math.PI * 2);
    ctx.stroke();
  });
}

// A tall lancet of stained glass, as a texture. Cologne's windows are mostly narrow and
// very tall, and their colour is the only warmth on the whole building.
function lancetGlassTexture(seed = 9) {
  return canvasTexture(128, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#20201d';
    ctx.fillRect(0, 0, w, h);
    const HUES = ['#b03a2e', '#2f6ba8', '#c9a227', '#3f7a4a', '#7a3f86'];
    const rows = 18;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = HUES[Math.floor(randomIn(rng, 0, HUES.length))];
        ctx.fillRect(
          c * (w / 3) + w * 0.04,
          r * (h / rows) + h * 0.004,
          w / 3 - w * 0.08,
          h / rows - h * 0.008,
        );
      }
    }
  });
}

export function cologneCathedral({ length = 158, height = 172, navWidth = 30, seed = 5 } = {}) {
  const g = group();
  const parts = [];
  const glassParts = [];

  const NAVE_H = height * 0.32;          // the nave roof ridge
  const AISLE_H = NAVE_H * 0.62;
  const TOWER_W = navWidth * 0.62;
  const TOWER_H = height * 0.46;         // the square part, below the spires
  const SPIRE_H = height - TOWER_H;

  // --- Nave and aisles ----------------------------------------------------
  // The body runs along +Z from the west front. Aisles either side, lower than the nave,
  // which is what makes the section read as a cathedral rather than a shed.
  const bodyLen = length * 0.72;
  const bodyZ = bodyLen / 2 + navWidth * 0.55;

  parts.push({ geometry: new THREE.BoxGeometry(navWidth, NAVE_H, bodyLen), position: [0, NAVE_H / 2, bodyZ], color: STONE });
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(navWidth * 0.42, AISLE_H, bodyLen),
      position: [sx * (navWidth * 0.5 + navWidth * 0.21), AISLE_H / 2, bodyZ],
      color: STONE,
    });
  }

  // Steep pitched roofs. The sign is per side -- atan2(rise, run) from HORIZONTAL, and +sz
  // so the far end drops; negated it becomes a valley (see StormProps.wreckedFarmhouse).
  const roof = (w, h, len, cz, colour) => {
    for (const sz of [-1, 1]) {
      const rise = w * 0.75;
      const run = w / 2;
      const slope = new THREE.BoxGeometry(Math.hypot(run, rise), 0.9, len);
      slope.rotateZ(sz * -Math.atan2(rise, run));
      slope.translate(sz * w / 4, h + rise / 2, cz);
      parts.push({ geometry: slope, color: colour });
    }
  };
  roof(navWidth, NAVE_H, bodyLen, bodyZ, ROOF_LEAD);
  for (const sx of [-1, 1]) {
    roof(navWidth * 0.42, AISLE_H, bodyLen, bodyZ, ROOF_LEAD);
    // shift the aisle roofs outward
    for (let i = parts.length - 2; i < parts.length; i++) {
      parts[i].geometry.translate(sx * (navWidth * 0.5 + navWidth * 0.21), 0, 0);
    }
  }

  // --- Flying buttresses ---------------------------------------------------
  // A row of them each side. These are what actually hold a gothic nave up, and visually
  // they are the ribs along the flanks that stop the building being a box.
  const BAYS = 7;
  for (let b = 0; b < BAYS; b++) {
    const z = navWidth * 0.55 + (b + 0.5) * (bodyLen / BAYS);
    for (const sx of [-1, 1]) {
      const pierX = sx * (navWidth * 0.5 + navWidth * 0.42 + 3.5);
      // Outer pier.
      parts.push({ geometry: new THREE.BoxGeometry(5, AISLE_H * 1.15, 5), position: [pierX, AISLE_H * 0.575, z], color: STONE });
      pinnacle(parts, { x: pierX, y: AISLE_H * 1.15, z, width: 4, height: NAVE_H * 0.42, color: STONE });

      // The flyer: a bar from the pier top up to the nave wall. Sloped, so it reads as a
      // prop rather than as a shelf.
      const from = new THREE.Vector3(pierX, AISLE_H * 1.08, z);
      const to = new THREE.Vector3(sx * navWidth * 0.5, NAVE_H * 0.86, z);
      const dir = to.clone().sub(from);
      const flyer = new THREE.BoxGeometry(dir.length(), 2.0, 1.6);
      flyer.rotateZ(Math.atan2(dir.y, dir.x));
      const mid = from.clone().add(to).multiplyScalar(0.5);
      flyer.translate(mid.x, mid.y, mid.z);
      parts.push({ geometry: flyer, color: STONE_LIT });
    }

    // Clerestory windows down the nave.
    for (const sx of [-1, 1]) {
      gothicArch(parts, {
        x: sx * (navWidth * 0.5 + 0.3), y: NAVE_H * 0.52, z,
        width: 4.5, height: NAVE_H * 0.4, rotY: Math.PI / 2, depth: 0.6, color: STONE_DEEP,
      });
      glassParts.push({
        geometry: (() => {
          const p = new THREE.BoxGeometry(0.2, NAVE_H * 0.3, 3.6);
          p.translate(sx * (navWidth * 0.5 + 0.55), NAVE_H * 0.66, z);
          return p;
        })(),
        color: GLASS_WARM,
      });
    }
  }

  // --- Apse ---------------------------------------------------------------
  // The east end is a half-polygon of tall windows, which is how a French-plan gothic
  // choir ends and is quite unlike the square east end of an English one.
  const apseZ = navWidth * 0.55 + bodyLen;
  const apseR = navWidth * 0.62;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI;
    const px = Math.cos(a) * apseR;
    const pz = apseZ + Math.sin(a) * apseR * 0.55;
    const wall = new THREE.BoxGeometry(apseR * 0.55, NAVE_H, 4);
    wall.rotateY(-a + Math.PI / 2);
    wall.translate(px, NAVE_H / 2, pz);
    parts.push({ geometry: wall, color: STONE });
    if (i > 0 && i < 6) {
      glassParts.push({
        geometry: (() => {
          const p = new THREE.BoxGeometry(apseR * 0.3, NAVE_H * 0.5, 0.3);
          p.rotateY(-a + Math.PI / 2);
          p.translate(px * 1.02, NAVE_H * 0.5, pz * 1.0 + Math.sin(a) * 1.6);
          return p;
        })(),
        color: GLASS_COOL,
      });
    }
  }

  // --- The west front: two towers -----------------------------------------
  for (const sx of [-1, 1]) {
    const tx = sx * (TOWER_W * 0.62);

    // Four diminishing stages, each with tall arched openings and corner turrets.
    const STAGES = 4;
    for (let s = 0; s < STAGES; s++) {
      const y0 = (TOWER_H / STAGES) * s;
      const y1 = (TOWER_H / STAGES) * (s + 1);
      const w = TOWER_W * (1 - s * 0.045);
      parts.push({ geometry: new THREE.BoxGeometry(w, y1 - y0, w), position: [tx, (y0 + y1) / 2, 0], color: STONE });

      // Corner buttresses running the stage's height, standing proud.
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        parts.push({
          geometry: new THREE.BoxGeometry(w * 0.16, y1 - y0, w * 0.16),
          position: [tx + dx * w * 0.5, (y0 + y1) / 2, dz * w * 0.5],
          color: STONE_LIT,
        });
      }

      // Tall two-light openings on every face. On the upper stages these are OPEN belfry
      // lights, which is why they are dark rather than glazed.
      for (let f = 0; f < 4; f++) {
        const rotY = (f / 4) * Math.PI * 2;
        for (const off of [-w * 0.2, w * 0.2]) {
          const px = tx + Math.cos(rotY) * off + Math.sin(rotY) * (w / 2 + 0.2);
          const pz = -Math.sin(rotY) * off + Math.cos(rotY) * (w / 2 + 0.2);
          gothicArch(parts, {
            x: px, y: y0 + (y1 - y0) * 0.18, z: pz,
            width: w * 0.24, height: (y1 - y0) * 0.66, rotY, depth: 0.5,
            color: s >= 2 ? 0x1b1b18 : STONE_DEEP,
          });
        }
      }

      // Corner pinnacles at each stage top -- the bristle that runs all the way up.
      if (s < STAGES - 1) {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          pinnacle(parts, {
            x: tx + dx * w * 0.5, y: y1, z: dz * w * 0.5,
            width: w * 0.13, height: TOWER_H * 0.1, color: STONE_LIT,
          });
        }
      }
    }

    // The octagonal drum the spire springs from.
    const drum = new THREE.CylinderGeometry(TOWER_W * 0.44, TOWER_W * 0.47, TOWER_H * 0.1, 8);
    drum.rotateY(Math.PI / 8);
    drum.translate(tx, TOWER_H + TOWER_H * 0.05, 0);
    parts.push({ geometry: drum, color: STONE });

    // Corner pinnacles round the spire's foot, taller than the stage ones.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      pinnacle(parts, {
        x: tx + Math.cos(a) * TOWER_W * 0.52, y: TOWER_H, z: Math.sin(a) * TOWER_W * 0.52,
        width: TOWER_W * 0.11, height: SPIRE_H * 0.3, color: STONE_LIT,
      });
    }

    // THE SPIRE.
    openworkSpire(parts, {
      x: tx, z: 0,
      baseY: TOWER_H + TOWER_H * 0.1,
      height: SPIRE_H - TOWER_H * 0.1,
      baseRadius: TOWER_W * 0.42,
      ribs: 8,
      seed: seed + (sx > 0 ? 1 : 2),
    });
  }

  // --- The west portal ----------------------------------------------------
  // Between the towers: a deeply recessed doorway under a gable, with the rose window
  // above it. The recession is the point -- a gothic portal is a tunnel of archivolts, and
  // a flat door with an arch drawn on it reads as a garage.
  const portalW = TOWER_W * 0.62;
  const portalH = TOWER_H * 0.42;
  parts.push({ geometry: new THREE.BoxGeometry(TOWER_W * 0.72, TOWER_H * 0.86, navWidth * 0.4), position: [0, TOWER_H * 0.43, 0], color: STONE });

  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    gothicArch(parts, {
      x: 0, y: 1.5, z: navWidth * 0.2 - i * 1.4,
      width: portalW * (1 - t * 0.16), height: portalH * (1 - t * 0.1),
      depth: 1.2, color: i === 4 ? 0x121210 : (i % 2 ? STONE_LIT : STONE),
    });
  }

  // Gable over the portal, with a crocketed edge.
  const gable = new THREE.ConeGeometry(TOWER_W * 0.42, TOWER_H * 0.24, 3);
  gable.rotateY(Math.PI / 2);
  gable.scale(1, 1, 0.18);
  gable.translate(0, TOWER_H * 0.42 + TOWER_H * 0.12, navWidth * 0.2);
  parts.push({ geometry: gable, color: STONE_LIT });

  // Rose window.
  const roseR = TOWER_W * 0.3;
  const roseY = TOWER_H * 0.68;
  const roseTex = roseWindowTexture(seed);
  const rose = mesh(new THREE.CircleGeometry(roseR, 40), standard({
    map: roseTex, color: 0xffffff, roughness: 0.5,
    emissive: 0xffffff, emissiveMap: roseTex, emissiveIntensity: 0.5,
  }), 0, roseY, navWidth * 0.2 + 0.4);
  g.add(rose);
  parts.push({ geometry: new THREE.TorusGeometry(roseR * 1.08, roseR * 0.09, 8, 36), position: [0, roseY, navWidth * 0.2 + 0.2], color: STONE_LIT });

  // --- Meshes -------------------------------------------------------------
  g.add(mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.92,
    ...relief('stone', { seed, repeat: 8, strength: 0.75 }),
  }));

  // Stained glass, self-lit so it reads as glass rather than as dark panels on a dark wall.
  const glassTex = lancetGlassTexture(seed + 4);
  g.add(mergedMesh(glassParts, {
    color: 0xffffff,
    map: glassTex,
    roughness: 0.35,
    emissive: 0xffffff,
    emissiveMap: glassTex,
    emissiveIntensity: 0.55,
  }));

  return g;
}

// ---------------------------------------------------------------------------
// 3. The restoration crane -- the animated object
// ---------------------------------------------------------------------------

// There has been scaffolding and a crane somewhere on this cathedral continuously since it
// was finished; the local saying is that the world will end when the work does. So a
// slewing crane is not a liberty here -- it is arguably as characteristic of the building
// as the spires, and it happens to be an object a `rotate` block can actually animate,
// because it turns about the VERTICAL.
export function restorationCrane({ height = 62, jib = 38, seed = 15 } = {}) {
  const g = group();
  const parts = [];
  const mast = 3.4;

  // Lattice mast: four legs plus cross bracing, so it reads as a tower crane and not a
  // pole. Bracing is what makes a lattice; four sticks is a fence.
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.42, height, 0.42),
      position: [dx * mast / 2, height / 2, dz * mast / 2],
      color: CRANE_YELLOW,
    });
  }
  const RUNGS = Math.round(height / 5);
  for (let i = 1; i < RUNGS; i++) {
    const y = (i / RUNGS) * height;
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      parts.push({
        geometry: new THREE.BoxGeometry(ax ? mast : 0.3, 0.3, az ? mast : 0.3),
        position: [az ? mast / 2 : 0, y, ax ? mast / 2 : 0],
        color: CRANE_YELLOW,
      });
      parts.push({
        geometry: new THREE.BoxGeometry(ax ? mast : 0.3, 0.3, az ? mast : 0.3),
        position: [az ? -mast / 2 : 0, y, ax ? -mast / 2 : 0],
        color: CRANE_YELLOW,
      });
    }
    // Diagonals.
    const diag = new THREE.BoxGeometry(Math.hypot(mast, height / RUNGS), 0.26, 0.26);
    diag.rotateZ(Math.atan2(height / RUNGS, mast) * (i % 2 ? 1 : -1));
    diag.translate(0, y - height / RUNGS / 2, mast / 2);
    parts.push({ geometry: diag, color: CRANE_YELLOW });
  }

  // Slewing ring + cab.
  parts.push({ geometry: new THREE.CylinderGeometry(mast * 0.9, mast * 0.9, 1.6, 12), position: [0, height + 0.8, 0], color: 0x8f8f8f });
  parts.push({ geometry: new THREE.BoxGeometry(3.0, 3.0, 3.6), position: [0, height + 3.2, mast * 1.1], color: 0xdadada });
  parts.push({ geometry: new THREE.BoxGeometry(2.4, 1.6, 0.2), position: [0, height + 3.4, mast * 1.1 + 1.85], color: 0x2c3742 });

  // The jib, running +Z, and a shorter counter-jib with its ballast running -Z. The
  // counterweight is what stops a crane reading as a lamp post with an arm.
  const jibY = height + 3.6;
  parts.push({ geometry: new THREE.BoxGeometry(1.6, 1.4, jib), position: [0, jibY, jib / 2], color: CRANE_YELLOW });
  for (let i = 1; i < 9; i++) {
    const z = (i / 9) * jib;
    const d = new THREE.BoxGeometry(0.24, Math.hypot(1.4, jib / 9), 0.24);
    d.rotateX(Math.atan2(jib / 9, 1.4) * (i % 2 ? 1 : -1));
    d.translate(0, jibY, z);
    parts.push({ geometry: d, color: CRANE_YELLOW });
  }
  parts.push({ geometry: new THREE.BoxGeometry(1.6, 1.3, jib * 0.38), position: [0, jibY, -jib * 0.19], color: CRANE_YELLOW });
  parts.push({ geometry: new THREE.BoxGeometry(3.2, 2.6, 3.0), position: [0, jibY - 0.6, -jib * 0.36], color: 0x6d6d6d });

  // A-frame and tie bars -- the triangle above the jib that a real tower crane has.
  parts.push({ geometry: new THREE.BoxGeometry(0.5, 8, 0.5), position: [0, jibY + 4, 0], color: CRANE_YELLOW });
  for (const [z0, len] of [[jib * 0.62, Math.hypot(8, jib * 0.62)], [-jib * 0.3, Math.hypot(8, jib * 0.3)]]) {
    const tie = new THREE.BoxGeometry(0.22, len, 0.22);
    tie.rotateX(Math.atan2(z0, 8));
    tie.translate(0, jibY + 4, z0 / 2);
    parts.push({ geometry: tie, color: 0xb0b0b0 });
  }

  // Trolley, hoist rope and hook -- hanging free, which is what tells you it is working.
  const trolleyZ = jib * 0.62;
  parts.push({ geometry: new THREE.BoxGeometry(1.4, 0.8, 1.8), position: [0, jibY - 1.0, trolleyZ], color: 0x5b5b5b });
  parts.push({ geometry: new THREE.BoxGeometry(0.14, 14, 0.14), position: [0, jibY - 8, trolleyZ], color: 0x3a3a3a });
  parts.push({ geometry: new THREE.BoxGeometry(1.1, 1.3, 1.1), position: [0, jibY - 15.2, trolleyZ], color: 0x8a8a8a });

  g.add(mergedMesh(parts, {
    color: 0xffffff, roughness: 0.62, metalness: 0.4,
    ...relief('metal', { seed, repeat: 4, strength: 0.45 }),
  }));
  return g;
}

// A run of scaffolding against a wall -- the crane's reason for being there.
export function scaffoldBay({ width = 22, height = 40, depth = 5, seed = 25 } = {}) {
  const g = group();
  const parts = [];
  const LIFTS = Math.round(height / 6);
  const BAYS = Math.round(width / 5);

  for (let l = 0; l <= LIFTS; l++) {
    const y = (l / LIFTS) * height;
    parts.push({ geometry: new THREE.BoxGeometry(width, 0.24, 0.24), position: [0, y, depth / 2], color: 0x9aa0a6 });
    parts.push({ geometry: new THREE.BoxGeometry(width, 0.24, 0.24), position: [0, y, -depth / 2], color: 0x9aa0a6 });
    if (l < LIFTS) {
      // Boards on alternate lifts, so it reads as a place people stand.
      if (l % 2 === 0) {
        parts.push({ geometry: new THREE.BoxGeometry(width * 0.98, 0.18, depth * 0.8), position: [0, y + 0.2, 0], color: 0xb59a68 });
      }
    }
  }
  for (let b = 0; b <= BAYS; b++) {
    const x = -width / 2 + (b / BAYS) * width;
    for (const dz of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(0.26, height, 0.26), position: [x, height / 2, dz * depth / 2], color: 0x9aa0a6 });
    }
    parts.push({ geometry: new THREE.BoxGeometry(0.22, 0.22, depth), position: [x, height * 0.5, 0], color: 0x9aa0a6 });
    // A diagonal brace every other bay.
    if (b % 2 === 0 && b < BAYS) {
      const d = new THREE.BoxGeometry(Math.hypot(width / BAYS, height), 0.2, 0.2);
      d.rotateZ(Math.atan2(height, width / BAYS));
      d.translate(x + width / BAYS / 2, height / 2, depth / 2);
      parts.push({ geometry: d, color: 0x9aa0a6 });
    }
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.55, metalness: 0.45, ...relief('metal', { seed, repeat: 5, strength: 0.4 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// 4. The square
// ---------------------------------------------------------------------------

// The Domplatte: the raised paved deck the cathedral stands on.
export function domplatte({ width = 150, depth = 150, seed = 35 } = {}) {
  const g = group();
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#a39c90';
    ctx.fillRect(0, 0, w, h);
    // Radial-ish paving: big rectangular slabs with staggered joints, which is what the
    // real Domplatte is. A grid with aligned joints reads as a tiled bathroom.
    const rows = 16;
    for (let r = 0; r < rows; r++) {
      const stagger = (r % 2) * (w / 12) * 0.5;
      for (let c = -1; c < 13; c++) {
        const x = c * (w / 12) + stagger;
        const y = r * (h / rows);
        const v = randomIn(rng, -14, 14) | 0;
        ctx.fillStyle = `rgb(${163 + v},${156 + v},${144 + v})`;
        ctx.fillRect(x + 1.5, y + 1.5, w / 12 - 3, h / rows - 3);
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);

  const m = mesh(new THREE.PlaneGeometry(width, depth), standard({
    color: PAVING, map: texture, roughness: 0.94,
    ...relief('stone', { seed, repeat: 8, strength: 0.5 }),
  }), 0, 0.08, 0);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  m.castShadow = false;
  g.add(m);
  return g;
}

// A German city building -- steep-roofed, gabled, narrow-fronted. The square is ringed with
// these, and their job is to give the cathedral something ordinary to be enormous next to.
export function altstadtHouse({ width = 16, height = 34, depth = 18, color = 0xb8a68c, seed = 45 } = {}) {
  const g = group();
  const parts = [];
  const glass = [];
  const bodyH = height * 0.68;

  parts.push({ geometry: new THREE.BoxGeometry(width, bodyH, depth), position: [0, bodyH / 2, 0], color });
  // Stepped gable on the front -- northern-European, and instantly not English or French.
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const w = width * (1 - t * 0.8);
    const h = (height - bodyH) / steps;
    parts.push({
      geometry: new THREE.BoxGeometry(w, h, 1.6),
      position: [0, bodyH + h * (i + 0.5), depth / 2 - 0.8],
      color,
    });
  }
  // Roof.
  for (const sx of [-1, 1]) {
    const rise = height - bodyH;
    const run = width / 2;
    const slope = new THREE.BoxGeometry(Math.hypot(run, rise), 0.7, depth);
    slope.rotateZ(sx * -Math.atan2(rise, run));
    slope.translate(sx * width / 4, bodyH + rise / 2, 0);
    parts.push({ geometry: slope, color: 0x6b4a3c });
  }
  // Windows in a regular grid -- the repetition is what makes it read as a town house.
  const cols = 3;
  const rows = Math.max(2, Math.round(bodyH / 9));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -width / 2 + (c + 0.5) * (width / cols);
      const y = bodyH * (0.18 + r * (0.72 / rows));
      glass.push({ geometry: new THREE.BoxGeometry(width * 0.16, bodyH * 0.13, 0.2), position: [x, y, depth / 2 + 0.05], color: 0x3f4d5c });
      parts.push({ geometry: new THREE.BoxGeometry(width * 0.21, bodyH * 0.17, 0.12), position: [x, y, depth / 2 - 0.02], color: 0xe8e0d0 });
    }
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.9, ...relief('stone', { seed, repeat: 5, strength: 0.5 }) }));
  g.add(mergedMesh(glass, { color: 0xffffff, roughness: 0.25, metalness: 0.15, emissive: 0x1e262e, emissiveIntensity: 0.3 }));
  return g;
}
