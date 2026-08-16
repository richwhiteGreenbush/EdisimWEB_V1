import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergeColored,
  mergedMesh,
  relief,
  canvasTexture,
  signPanel,
  taperedTube,
  seededRandom,
  randomIn,
  roughenSphere,
} from '../PropKit.js';

// The Water Cycle -- evaporation, condensation, precipitation, collection and
// transpiration, built at a size a student walks through rather than reads off a poster.
//
// The design problem specific to this world: a water cycle diagram is a LOOP, and a loop
// is the one thing a 3D landscape does not naturally show. Stand in a real valley and you
// see an ocean, a cloud and a river -- you do not see that they are the same water going
// round. So the arrows are not decoration here, they are the exhibit: five big labelled
// curved arrows, laid out as an actual circuit the student can walk, are what turn a
// landscape into a cycle. Everything else exists to give the arrows something to connect.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const WATER = 0x2f6ea8;
const WATER_LIGHT = 0x5296c9;

// ---------------------------------------------------------------------------
// The five stages
// ---------------------------------------------------------------------------

// A cumulus cloud big enough to stand under. Built as a merged cluster of roughened
// spheres with a FLAT BASE -- that flat bottom is the whole identity of a cumulus and the
// thing a ball-of-cotton-wool cloud always gets wrong: they form where rising air hits the
// condensation level, so every cloud in a field has its base at exactly the same height.
export function cumulusCloud({ size = 18, seed = 7, dark = false, height = 9 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const top = dark ? 0xb8bcc4 : 0xf4f7fb;
  const mid = dark ? 0x8d939e : 0xdde4ee;
  const base = dark ? 0x5f6672 : 0xa8b4c4;

  // SphereGeometry, NOT IcosahedronGeometry -- and this is the whole reason the first two
  // passes of this cloud read as a heap of grey boulders.
  //
  // Icosahedron (and everything else out of PolyhedronGeometry) is NON-INDEXED: every
  // triangle owns its own copy of each corner. roughenSphere() finishes by calling
  // computeVertexNormals(), which on non-indexed geometry can only produce per-FACE
  // normals -- so the result is flat-shaded no matter what the material asks for, and a
  // flat-shaded lump is a rock. SphereGeometry is indexed, its corners are shared, and the
  // same call produces smooth averaged normals. Nothing else about the cloud changed.
  //
  // (This is why the boulder fields elsewhere in the project use icosahedra and look
  // right: there, faceting IS the material.)
  const puffs = 13;
  for (let i = 0; i < puffs; i++) {
    const t = i / (puffs - 1);
    const r = size * randomIn(rng, 0.26, 0.46) * (1 - t * 0.3);
    const px = randomIn(rng, -size * 0.5, size * 0.5);
    const pz = randomIn(rng, -size * 0.34, size * 0.34);
    // The higher a puff sits, the more it is pulled toward the middle -- a cumulus is a
    // cauliflower, wider at the shoulders than the crown.
    const py = randomIn(rng, 0.1, 1) * height * 0.55;
    const geo = roughenSphere(new THREE.SphereGeometry(r, 16, 12), { amount: 0.2, flatten: 0.84, phase: i * 1.9 });
    parts.push({
      geometry: geo,
      color: py > height * 0.3 ? top : mid,
      position: [px * (1 - py / (height * 1.6)), height * 0.42 + py, pz * (1 - py / (height * 1.6))],
    });
  }

  // The flat base: a slab of darker puffs all sitting at ONE height.
  for (let i = 0; i < 8; i++) {
    const r = size * randomIn(rng, 0.24, 0.38);
    const geo = roughenSphere(new THREE.SphereGeometry(r, 14, 10), { amount: 0.14, flatten: 0.32, phase: i * 2.3 });
    parts.push({
      geometry: geo,
      color: base,
      position: [randomIn(rng, -size * 0.5, size * 0.5), height * 0.3, randomIn(rng, -size * 0.32, size * 0.32)],
    });
  }

  const m = mergedMesh(parts, { roughness: 1, flatShading: false });
  // A cloud that casts a shadow puts the valley under it in permanent night, and a cloud
  // that receives one has a hard dark line across it. Neither is what cloud does.
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}

// Rain falling out of a cloud base. Vertical streaks, not droplets: at any shutter speed
// a human eye uses, rain IS streaks, and a field of little spheres reads as hail.
//
// One mesh, additive, unfogged. `fog: false` for the reason the sea's light shafts need
// it: three.js fogs a fragment BEFORE blending, so a fully-fogged additive fragment adds
// the fog colour onto a background that is already the fog colour, and the far end of the
// curtain becomes a bright wall.
export function rainCurtain({ radius = 7, height = 14, count = 150, seed = 13 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const len = randomIn(rng, 0.9, 2.2);
    parts.push({
      geometry: new THREE.BoxGeometry(0.035, len, 0.035),
      color: 0xbfe0f5,
      position: [Math.cos(a) * r, randomIn(rng, 0.4, height), Math.sin(a) * r],
    });
  }
  const m = mesh(
    mergeColored(parts),
    standard({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      emissive: 0x8fc4e8,
      emissiveIntensity: 0.6,
      roughness: 1,
      depthWrite: false,
    }),
  );
  m.material.fog = false;
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}

// Water vapour rising -- evaporation off the sea, or transpiration off a canopy. Soft
// wisps that GET WIDER AND FAINTER as they rise, because that is what a plume does; a
// column of even width reads as a pipe.
export function vapourColumn({ height = 16, radius = 3, seed = 17, tint = 0xdff0fa } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const wisps = 9;
  for (let i = 0; i < wisps; i++) {
    const t = i / wisps;
    const y = t * height;
    const spread = radius * (0.35 + t * 1.5);
    const r = radius * randomIn(rng, 0.25, 0.5) * (0.6 + t);
    const geo = roughenSphere(new THREE.IcosahedronGeometry(r, 1), { amount: 0.3, flatten: 0.6, phase: i * 1.4 });
    parts.push({
      geometry: geo,
      color: tint,
      position: [Math.cos(i * 2.1) * spread * 0.35, y + 1, Math.sin(i * 1.7) * spread * 0.35],
    });
  }
  const m = mesh(
    mergeColored(parts),
    standard({ vertexColors: true, transparent: true, opacity: 0.3, roughness: 1, depthWrite: false, emissive: 0xbcd8e8, emissiveIntensity: 0.3 }),
  );
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}

// A body of open water with a wave-textured surface and a shelving bed under it, so the
// edge reads as a shore rather than as a plate of blue laid on grass.
export function waterBody({ width = 46, depth = 34, seed = 23, shore = true } = {}) {
  const g = group();
  const rng = seededRandom(seed);

  const waves = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2f6ea8';
    ctx.fillRect(0, 0, w, h);
    // Every frequency an integer multiple of 2pi/size, or the tile seams show as a line.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * Math.PI * 2;
        const v = (y / h) * Math.PI * 2;
        const n = Math.sin(u * 6 + Math.sin(v * 3) * 1.2) * 0.5 + Math.sin(v * 9 - u * 2) * 0.3 + Math.sin(u * 14 + v * 5) * 0.2;
        const l = 0.5 + n * 0.28;
        ctx.fillStyle = `rgba(${(70 + l * 90) | 0}, ${(130 + l * 90) | 0}, ${(180 + l * 60) | 0}, 1)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });

  // Bed first, then the surface just above it: a single plane at ground level z-fights
  // with the terrain, which shows as a shimmering rash across the whole pond.
  if (shore) {
    // The bed has to stay UNDER the water it is the bed of. The first pass spread lumps of
    // radius up to 0.3*width across +/-0.4*width, so the outermost reached 0.7 of the
    // half-width -- well past the surface plane's edge -- and the pond was ringed with
    // patches of bare brown ground that read as dug earth, not as a shore.
    //
    // Radius plus offset is now capped at 0.34 of the half-width, and the whole bed sits
    // lower, so every part of it is genuinely submerged.
    const bedParts = [];
    for (let i = 0; i < 9; i++) {
      const r = randomIn(rng, width * 0.1, width * 0.17);
      const geo = roughenSphere(new THREE.IcosahedronGeometry(r, 2), { amount: 0.2, flatten: 0.12, phase: i * 1.6 });
      bedParts.push({
        geometry: geo,
        color: i % 2 ? 0x6b5f45 : 0x7d7055,
        position: [randomIn(rng, -width * 0.24, width * 0.24), -1.1, randomIn(rng, -depth * 0.24, depth * 0.24)],
      });
    }
    g.add(mergedMesh(bedParts, { roughness: 1, ...relief('soil', { seed: seed + 3, repeat: 5 }) }));
  }

  const surface = mesh(
    new THREE.PlaneGeometry(width, depth, 1, 1),
    standard({ map: waves, bumpMap: waves, bumpScale: 0.5, roughness: 0.24, metalness: 0.1, transparent: true, opacity: 0.9 }),
    0, 0.55, 0,
  );
  surface.rotation.x = -Math.PI / 2;
  surface.castShadow = false;
  g.add(surface);
  return g;
}

// A mountain with a snow cap and an exposed rock face. This is the collection stage: snow
// is water in storage, and the snowline is the visible proof that height means cold.
export function mountainPeak({ height = 46, radius = 34, seed = 29, snowline = 0.55 } = {}) {
  const parts = [];
  const rng = seededRandom(seed);

  // The cone, roughened by direction (never per vertex -- the shattered-paper trap).
  const cone = new THREE.ConeGeometry(radius, height, 18, 6);
  const pos = cone.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const ridge = Math.sin(a * 5) * 0.1 + Math.sin(a * 9 + 1.3) * 0.06 + Math.sin(v.y * 0.3) * 0.04;
    v.x *= 1 + ridge;
    v.z *= 1 + ridge;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  cone.computeVertexNormals();
  cone.translate(0, height / 2, 0);

  // Vertex-colour the cone by HEIGHT, so the snowline is a property of the geometry rather
  // than a separate hat sitting on top. A snow cap built as its own cone always shows a
  // hard rim where it meets the rock.
  const colors = new Float32Array(pos.count * 3);
  const rock = new THREE.Color(0x5c5a52);
  const scree = new THREE.Color(0x7a7566);
  const snow = new THREE.Color(0xf2f6fa);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    // A ragged line, not a level one -- real snowlines follow aspect and shelter.
    const jitter = Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 7) * 0.06;
    if (t > snowline + jitter) c.copy(snow);
    else if (t > snowline + jitter - 0.12) c.lerpColors(scree, snow, (t - (snowline + jitter - 0.12)) / 0.12);
    else c.lerpColors(rock, scree, Math.min(1, t / snowline));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  cone.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const m = mesh(cone, standard({ vertexColors: true, roughness: 0.95, flatShading: true, ...relief('stone', { seed, repeat: 5 }) }));

  // Scree and boulders at the foot, which is what stops a cone reading as a party hat.
  const skirt = [];
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const d = radius * randomIn(rng, 0.85, 1.15);
    const r = randomIn(rng, 1.4, 3.6);
    skirt.push({
      geometry: roughenSphere(new THREE.IcosahedronGeometry(r, 1), { amount: 0.35, flatten: 0.7, phase: i * 2.2 }),
      color: [0x5c5a52, 0x6e6a5e, 0x7a7566][i % 3],
      position: [Math.cos(a) * d, r * 0.3, Math.sin(a) * d],
    });
  }
  return group(m, mergedMesh(skirt, { roughness: 1, flatShading: true, ...relief('stone', { seed: seed + 4, repeat: 2 }) }));
}

// A stream running downhill: a chain of water segments following a descending path, with
// banks. Used for runoff and for the river returning water to the sea.
export function streamCourse({ length = 60, drop = 6, width = 4, seed = 31, bends = 3 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const water = [];

  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const z = -length / 2 + t * length;
    const x = Math.sin(t * Math.PI * bends) * width * 1.4;
    const y = drop * (1 - t);
    const w = width * (0.85 + t * 0.4);

    // Bank on each side.
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(w * 0.5, 1.1, (length / steps) * 1.3),
        color: side > 0 ? 0x6b6a48 : 0x5f5f40,
        position: [x + side * w * 0.72, y + 0.2, z],
        rotation: [0, Math.cos(t * Math.PI * bends) * 0.25, 0],
      });
    }
    water.push({
      geometry: new THREE.BoxGeometry(w, 0.32, (length / steps) * 1.35),
      color: i % 3 === 0 ? WATER_LIGHT : WATER,
      position: [x, y + 0.32, z],
      rotation: [0, Math.cos(t * Math.PI * bends) * 0.25, 0],
    });
  }

  g.add(mergedMesh(parts, { roughness: 1, ...relief('soil', { seed: seed + 2, repeat: 4 }) }));
  const w = mesh(mergeColored(water), standard({ vertexColors: true, roughness: 0.22, metalness: 0.12, transparent: true, opacity: 0.9 }));
  w.castShadow = false;
  g.add(w);
  return g;
}

// A cutaway through the ground showing where rain goes after it lands: topsoil, then
// permeable rock, then the water table, then impermeable bedrock. This is the stage every
// water-cycle poster leaves out, and it is the one that explains wells and springs.
export function groundwaterCutaway({ width = 20, height = 9, depth = 7, seed = 37 } = {}) {
  const parts = [];
  const layers = [
    [0.74, 1.0, 0x5a4a2e, 'topsoil'],
    [0.44, 0.74, 0xa08a63, 'permeable rock'],
    [0.2, 0.44, 0x4d7fa8, 'saturated — the water table'],
    [0.0, 0.2, 0x4a4640, 'bedrock — water stops here'],
  ];
  for (const [a, b, color] of layers) {
    parts.push({
      geometry: new THREE.BoxGeometry(width, height * (b - a), depth),
      color,
      position: [0, height * (a + b) / 2, 0],
    });
  }
  // Percolation: a dotted trail of droplets soaking down through the permeable layer.
  const rng = seededRandom(seed);
  for (let i = 0; i < 26; i++) {
    parts.push({
      geometry: new THREE.SphereGeometry(0.16, 6, 5),
      color: 0x7fc0e8,
      position: [randomIn(rng, -width * 0.44, width * 0.44), randomIn(rng, height * 0.46, height * 0.98), depth / 2 + 0.05],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.92, ...relief('soil', { seed: seed + 1, repeat: 4 }) }));
}

// ---------------------------------------------------------------------------
// The arrows -- the actual exhibit
// ---------------------------------------------------------------------------

// A big labelled arc with a head on it. This is what makes the world a CYCLE rather than
// a landscape: five of them laid end to end are a circuit a student can follow on foot.
//
// The label is drawn on a panel that hangs under the arc rather than being painted on the
// arc itself -- a curved surface makes text unreadable from every angle but one, which is
// the same reason road markings are stretched.
export function cycleArrow({
  span = 26,
  rise = 12,
  label = 'EVAPORATION',
  sub = '',
  color = 0x3d8bf2,
  seed = 41,
} = {}) {
  const g = group();

  // The arc: a torus segment is the obvious choice and is wrong -- a torus's sweep is a
  // true circle, so span and rise cannot be set independently. A swept tube through three
  // points gives any arc shape asked for.
  const arc = taperedTube(
    [
      [-span / 2, 0.6, 0],
      [-span * 0.22, rise * 0.86, 0],
      [span * 0.22, rise * 0.86, 0],
      [span * 0.38, rise * 0.5, 0],
    ],
    [0.34, 0.4, 0.4, 0.34],
    { tubularSegments: 30, radialSegments: 10 },
  );
  const body = mesh(arc, standard({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.28 }));
  body.castShadow = false;
  g.add(body);

  // The head, aimed along the arc's own end tangent -- a cone bolted on at a guessed angle
  // is the tell that an arrow was assembled rather than drawn.
  const head = new THREE.ConeGeometry(1.05, 2.6, 14);
  const headMesh = mesh(head, standard({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.28 }), span * 0.44, rise * 0.36, 0);
  headMesh.rotation.z = -1.05;
  headMesh.castShadow = false;
  g.add(headMesh);

  const texture = canvasTexture(768, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4efe4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2a2622';
    ctx.font = `bold ${sub ? 76 : 92}px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(label, w / 2, sub ? h * 0.46 : h * 0.62);
    if (sub) {
      ctx.fillStyle = '#5a5450';
      ctx.font = '36px Georgia, serif';
      ctx.fillText(sub, w / 2, h * 0.74);
    }
  });
  const panel = signPanel(9, 3, texture);
  panel.position.set(0, rise * 0.86 + 2.4, 0);
  g.add(panel);

  return g;
}
