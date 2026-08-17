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
  relief,
} from '../PropKit.js';

// "Inside a Twister" -- an EF4 on open wheat country, with the storm structure above it
// and the wreckage of a farmstead in its path.
//
// THE ONE THING THIS FILE IS ORGANISED AROUND: the funnel has to LOOK like it is turning.
//
// It is turned by an ordinary `forever { rotate }` program shipped on the record, so what
// actually happens every frame is `rotation.y += a bit`. And a surface of revolution spun
// about its own axis is PIXEL-IDENTICAL at every angle -- a smooth grey cone rotating at
// any speed is a smooth grey cone standing still. Every visual decision in tornadoFunnel()
// below exists to defeat that:
//
//   * the shell is corrugated into helical ribs, so there are edges that travel,
//   * the ribs are wound at different rates on each nested shell, so the layers shear
//     past one another the way real condensation does,
//   * two sub-vortices spiral around the outside at their own radius,
//   * the debris cloud at the base is a ring of individual chunks, not a haze.
//
// Take any one of those away and it still reads as rotating. Take them all away and the
// spin is invisible no matter how fast it is set.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

const FUNNEL_TOP = 0x8e94a0;      // condensation up near the cloud base -- pale, wet
const FUNNEL_MID = 0x6b7280;
const FUNNEL_DARK = 0x4a4f5a;     // where it is full of dirt
const DEBRIS_BROWN = 0x6b5a3e;
const CLOUD_DARK = 0x4e5563;
const CLOUD_MID = 0x6f7787;
const CLOUD_EDGE = 0x99a2b0;
const RAIN = 0x7f8b9c;
const WHEAT_LIT = 0xd6b45c;
const WHEAT_DEEP = 0x9a7f34;
const TIMBER = 0x9c8a6a;
const PAINT_WHITE = 0xf0e9d8;
const BARN_RED = 0x8f3a2c;
const RUST = 0x7a4a30;
const STEEL = 0x555d68;
const TYRE = 0x24272c;
const GLASS = 0x2b3a48;
const CHASE_BLUE = 0x2f5f8f;
const DISH_WHITE = 0xd8dde4;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function tube(points, radii, color, options) {
  return { geometry: taperedTube(points, radii, options), color };
}

function ball(radius, detail = 10) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// ---------------------------------------------------------------------------
// 1. The funnel
// ---------------------------------------------------------------------------

// A corrugated shell of revolution whose ribs WIND as they rise.
//
// Built as an explicit indexed grid rather than with LatheGeometry, because a lathe can
// only take a profile -- it has no way to vary the radius with the angle, which is the
// entire point here. The radius at (angle, height) is the profile radius times a rib
// term whose phase depends on BOTH, and that phase shift with height is what makes the
// ribs a helix instead of a set of vertical flutes.
//
// Vertex-coloured rather than textured: the funnel is dirty and dark at the bottom and
// pale wet condensation at the top, and that gradient is most of what makes it read as a
// tornado rather than a grey cone. A colour map would have to tile round the seam and
// would fight the vertex colours anyway (a material with both multiplies them).
function helicalShell({
  height,
  topRadius,
  waistRadius,
  groundFlare = 1.0,
  ribs = 9,
  ribDepth = 0.11,
  turns = 1.4,
  segments = 40,
  rows = 34,
  colorLow = FUNNEL_DARK,
  colorHigh = FUNNEL_TOP,
  wobble = 0.06,
  seed = 3,
}) {
  const rng = seededRandom(seed);
  // A per-shell random phase so two shells built with the same numbers do not line their
  // ribs up and fuse into one thicker rib.
  const phase = randomIn(rng, 0, Math.PI * 2);

  const positions = [];
  const colors = [];
  const indices = [];
  const low = new THREE.Color(colorLow);
  const high = new THREE.Color(colorHigh);
  const c = new THREE.Color();

  for (let r = 0; r <= rows; r++) {
    const t = r / rows;                       // 0 at the ground, 1 at the cloud base
    const y = t * height;

    // The profile. A real funnel is widest where it meets the cloud, pinches to a waist,
    // and then FLARES again at the ground where it is picking material up -- that bottom
    // flare is the debris cloud and leaving it out is what makes a funnel look like a
    // traffic cone.
    const rise = t ** 1.55;
    let profile = waistRadius + (topRadius - waistRadius) * rise;
    const flare = Math.max(0, 1 - t / 0.16);
    profile += waistRadius * groundFlare * flare * flare * 1.9;

    // A slow lean, so the column is not a plumb line. Real funnels tilt with the storm's
    // inflow and a perfectly vertical one looks like a chimney.
    const leanX = Math.sin(t * 1.9) * height * 0.035;
    const leanZ = Math.sin(t * 2.7 + 1.1) * height * 0.022;

    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      // THE HELIX. `turns * t * 2π` is the phase shift with height: at turns = 1.4 a rib
      // wraps almost one and a half times from the ground to the cloud.
      const ribPhase = a * ribs + turns * t * Math.PI * 2 + phase;
      const rib = 1 + ribDepth * Math.sin(ribPhase);
      // A second, slower term so the outline is ragged rather than a clean scallop.
      const rough = 1 + wobble * Math.sin(a * 3 + t * 7.3 + phase * 1.7);
      const rad = profile * rib * rough;

      positions.push(
        Math.cos(a) * rad + leanX,
        y,
        Math.sin(a) * rad + leanZ,
      );

      // Dirty at the bottom, pale at the top, with the transition low down where the
      // debris actually is rather than halfway up.
      c.copy(low).lerp(high, Math.min(1, t ** 0.62));
      colors.push(c.r, c.g, c.b);
    }
  }

  const stride = segments + 1;
  for (let r = 0; r < rows; r++) {
    for (let s = 0; s < segments; s++) {
      const a0 = r * stride + s;
      const b0 = a0 + 1;
      const a1 = (r + 1) * stride + s;
      const b1 = a1 + 1;
      indices.push(a0, a1, b0, b0, a1, b1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// The tornado. Nested shells + sub-vortices + a debris ring, all in one Group whose origin
// is on the ground at its own axis -- so `rotate` spins it in place.
export function tornadoFunnel({
  height = 92,
  topRadius = 21,
  waistRadius = 5.2,
  seed = 11,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);

  // --- The shells ---------------------------------------------------------
  // Three, wound at DIFFERENT rates. Same rate on every layer and they turn as one solid
  // object again, which is the thing this whole model is trying not to look like.
  const shells = [
    { scale: 1.00, opacity: 0.72, turns: 1.35, ribs: 9,  ribDepth: 0.13, low: FUNNEL_DARK, high: FUNNEL_MID },
    { scale: 0.88, opacity: 0.55, turns: 2.10, ribs: 7,  ribDepth: 0.16, low: 0x3d424c,   high: FUNNEL_TOP },
    { scale: 1.14, opacity: 0.30, turns: 0.85, ribs: 12, ribDepth: 0.09, low: 0x5b6270,   high: 0xa5adba },
  ];

  shells.forEach((s, i) => {
    const geometry = helicalShell({
      height,
      topRadius: topRadius * s.scale,
      waistRadius: waistRadius * s.scale,
      ribs: s.ribs,
      ribDepth: s.ribDepth,
      turns: s.turns,
      colorLow: s.low,
      colorHigh: s.high,
      seed: seed + i * 7,
      // The outermost shell is the loose dust sheath, so it is the raggedest.
      wobble: i === 2 ? 0.1 : 0.06,
    });
    const m = mesh(geometry, standard({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: s.opacity,
      // DoubleSide here, unlike the cell's organelles: a funnel is a hollow sheet of cloud
      // and you are meant to see its far wall through the near one. That is what gives it
      // depth, and it is also why the opacities are low -- three DoubleSide shells is six
      // layers, and at higher alpha the stack turns into a solid grey pillar.
      side: THREE.DoubleSide,
      depthWrite: false,
      ...relief('stone', { seed: seed + i, repeat: 4, strength: 0.6 }),
    }));
    // No shadow. A 92ft column that casts one lays a black stripe right across the wheat
    // the low sun is there to light, and three transparent shells would each cast it.
    m.castShadow = false;
    m.receiveShadow = false;
    g.add(m);
  });

  // --- Sub-vortices -------------------------------------------------------
  // Thin ropes spiralling up the outside. These are the single strongest rotation cue in
  // the model: they are narrow and off-axis, so when the group turns they visibly sweep
  // around the column rather than staying put the way a symmetric surface does.
  const ropes = [];
  for (let v = 0; v < 2; v++) {
    const pts = [];
    const radii = [];
    const base = v * Math.PI + randomIn(rng, -0.4, 0.4);
    const STEPS = 16;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const y = t * height * 0.82;
      const rise = t ** 1.55;
      const profile = waistRadius + (topRadius - waistRadius) * rise;
      const a = base + t * Math.PI * 3.1;
      const rad = profile * 1.16;
      pts.push([Math.cos(a) * rad, y + 1.5, Math.sin(a) * rad]);
      // Fat at the bottom, tapering out to nothing as it is absorbed into the main
      // circulation near the top.
      radii.push(Math.max(0.25, (1 - t) * waistRadius * 0.42));
    }
    ropes.push(tube(pts, radii, 0x5d646f, { tubularSegments: 40, radialSegments: 8 }));
  }
  const ropeMesh = mergedMesh(ropes, {
    color: 0xffffff,
    roughness: 0.95,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  ropeMesh.castShadow = false;
  g.add(ropeMesh);

  // --- Debris ring --------------------------------------------------------
  // Individual chunks orbiting the base at assorted radii and heights. Chunks and not a
  // haze, deliberately: a soft cloud of dust is symmetric and vanishes the moment it
  // rotates, whereas thirty distinguishable objects going round are unmistakable.
  const chunks = [];
  const flare = waistRadius * 2.9;
  for (let i = 0; i < 34; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = flare * randomIn(rng, 0.55, 1.5);
    const y = randomIn(rng, 0.6, height * 0.3);
    // Higher chunks sit further out -- material thrown from the base spirals outward as
    // it rises, and a straight cylinder of debris looks like a fence.
    const spread = 1 + (y / (height * 0.3)) * 0.5;
    const size = randomIn(rng, 0.5, 2.3);
    const kind = Math.floor(randomIn(rng, 0, 3));
    let geometry;
    if (kind === 0) geometry = new THREE.BoxGeometry(size * 2.4, size * 0.24, size * 0.7);
    else if (kind === 1) geometry = new THREE.BoxGeometry(size, size * 0.8, size * 0.3);
    else geometry = ball(size * 0.5, 6);
    geometry.rotateX(randomIn(rng, 0, Math.PI));
    geometry.rotateY(randomIn(rng, 0, Math.PI));
    geometry.rotateZ(randomIn(rng, 0, Math.PI));
    geometry.translate(Math.cos(a) * rad * spread, y, Math.sin(a) * rad * spread);
    chunks.push({ geometry, color: i % 4 === 0 ? TIMBER : DEBRIS_BROWN });
  }
  const debrisMesh = mergedMesh(chunks, { color: 0xffffff, roughness: 0.9 });
  debrisMesh.castShadow = false;
  g.add(debrisMesh);

  return g;
}

// ---------------------------------------------------------------------------
// 2. The storm above it
// ---------------------------------------------------------------------------

// The underside of the supercell: a broad dark cloud base with a lowered, rotating wall
// cloud where the funnel comes out of it.
//
// castShadow is OFF and that is not an optimisation. This thing is two hundred feet
// across and hangs over the whole world; casting a shadow would put every object in the
// world into flat darkness and cancel the low warm sun the entire theme is built around.
// It is the museum skylight's rule at landscape scale.
export function supercellBase({
  span = 190,
  thickness = 16,
  wallCloud = true,
  seed = 21,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];

  // The base itself: a raft of overlapping squashed spheres. Lumpy on the UNDERSIDE
  // specifically, since that is the only face anybody in this world can see.
  for (let i = 0; i < 46; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(randomIn(rng, 0, 1)) * span * 0.5;
    const r = randomIn(rng, span * 0.07, span * 0.15);
    const geometry = ball(r, 12);
    geometry.scale(1, randomIn(rng, 0.3, 0.5), 1);
    geometry.translate(
      Math.cos(a) * rad,
      randomIn(rng, -thickness * 0.3, thickness * 0.45),
      Math.sin(a) * rad,
    );
    // Darker toward the middle where the storm is deepest, paler at the ragged edge.
    const edge = rad / (span * 0.5);
    parts.push({ geometry, color: edge > 0.75 ? CLOUD_EDGE : (edge > 0.45 ? CLOUD_MID : CLOUD_DARK) });
  }

  // The wall cloud: a lowered, roughly circular block hanging below the base, which is
  // where a tornado actually descends from. Without it the funnel appears to grow out of
  // a flat ceiling, and the single most recognisable piece of supercell structure is gone.
  if (wallCloud) {
    for (let i = 0; i < 16; i++) {
      const a = randomIn(rng, 0, Math.PI * 2);
      const rad = Math.sqrt(randomIn(rng, 0, 1)) * span * 0.16;
      const r = randomIn(rng, span * 0.045, span * 0.085);
      const geometry = ball(r, 12);
      geometry.scale(1, randomIn(rng, 0.45, 0.7), 1);
      geometry.translate(Math.cos(a) * rad, -thickness * randomIn(rng, 0.5, 1.15), Math.sin(a) * rad);
      parts.push({ geometry, color: CLOUD_DARK });
    }
  }

  const m = mergedMesh(parts, { color: 0xffffff, roughness: 1, metalness: 0 });
  m.castShadow = false;
  m.receiveShadow = false;
  g.add(m);
  return g;
}

// A curtain of rain trailing out of the storm. Vertical streaks on a translucent sheet.
//
// `fog: false` on the material, for the reason Under the Sea's light shafts needed it:
// three.js fogs a fragment BEFORE blending, so a fogged translucent fragment adds the fog
// colour onto a background that is already the fog colour, and the far end of the sheet
// turns into a bright wall.
export function rainCurtain({ width = 60, height = 55, seed = 33 } = {}) {
  const g = group();
  const texture = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const rng = seededRandom(seed);
    for (let i = 0; i < 260; i++) {
      const x = randomIn(rng, 0, w);
      const y = randomIn(rng, 0, h);
      const len = randomIn(rng, h * 0.08, h * 0.3);
      ctx.strokeStyle = `rgba(190,205,220,${randomIn(rng, 0.05, 0.22).toFixed(3)})`;
      ctx.lineWidth = randomIn(rng, 1, 2.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      // A slight lean, because rain under a storm is being driven sideways.
      ctx.lineTo(x + len * 0.16, y + len);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  const m = mesh(new THREE.PlaneGeometry(width, height), standard({
    color: RAIN,
    map: texture,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
    fog: false,
  }), 0, height / 2, 0);
  m.castShadow = false;
  m.receiveShadow = false;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// 3. The chase vehicle
// ---------------------------------------------------------------------------

// A modern storm-chase SUV: roof rack, instrument mast, hail guards over the glass.
//
// The cabin is a FRAME -- belt rail, pillars, roof panel -- with the glass hung outside
// it, not a solid box with windows drawn on. That is the trap every vehicle in New York
// hit: at any body width the glass panels end up inside the box and the greenhouse reads
// as a painted black slab.
export function chaseVehicle({ length = 15, width = 6.4, color = CHASE_BLUE } = {}) {
  const g = group();
  const parts = [];
  const bodyH = 2.5;
  const wheelR = 1.35;
  const floor = wheelR * 0.72;

  // --- Body ---------------------------------------------------------------
  parts.push({ geometry: new THREE.BoxGeometry(width, bodyH, length), position: [0, floor + bodyH / 2, 0], color });
  // A lower sill band in a darker tone, so a 15ft slab has a horizontal line in it.
  parts.push({
    geometry: new THREE.BoxGeometry(width * 1.02, 0.55, length * 0.98),
    position: [0, floor + 0.3, 0],
    color: 0x24303c,
  });

  // --- Cabin frame --------------------------------------------------------
  const cabH = 2.1;
  const cabLen = length * 0.5;
  const cabY = floor + bodyH + cabH / 2;
  // Roof panel
  parts.push({
    geometry: new THREE.BoxGeometry(width * 0.94, 0.22, cabLen),
    position: [0, floor + bodyH + cabH, -length * 0.04],
    color,
  });
  // Pillars: three a side.
  for (const sx of [-1, 1]) {
    for (const pz of [-cabLen / 2 + 0.2, 0, cabLen / 2 - 0.2]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.3, cabH, 0.34),
        position: [sx * (width * 0.47), cabY, pz - length * 0.04],
        color,
      });
    }
  }
  // Glass hung OUTSIDE the pillars, inset a hair so the frame reads in front of it.
  const glass = [];
  for (const sx of [-1, 1]) {
    glass.push({
      geometry: new THREE.BoxGeometry(0.1, cabH * 0.82, cabLen * 0.92),
      position: [sx * (width * 0.475), cabY, -length * 0.04],
      color: GLASS,
    });
  }
  glass.push({
    geometry: new THREE.BoxGeometry(width * 0.86, cabH * 0.8, 0.1),
    position: [0, cabY, -length * 0.04 + cabLen / 2],
    color: GLASS,
  });

  // --- Hail guards --------------------------------------------------------
  // The detail that says "this vehicle drives INTO the storm" rather than "this is a car".
  const guards = [];
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      guards.push({
        geometry: new THREE.BoxGeometry(0.08, cabH * 0.86, 0.12),
        position: [sx * (width * 0.5), cabY, -length * 0.04 - cabLen * 0.42 + i * cabLen * 0.21],
        color: STEEL,
      });
    }
  }

  // --- Wheels -------------------------------------------------------------
  // Whole cylinders lying on their sides. NOT partial cylinders for the arches -- a
  // partial CylinderGeometry is capped at its flat ends, so a "half cylinder" arch comes
  // out as a solid half disc exactly where the wheel should show, and every vehicle in
  // the world reads as a bulldozer.
  for (const sx of [-1, 1]) {
    for (const pz of [length * 0.31, -length * 0.31]) {
      const w = new THREE.CylinderGeometry(wheelR, wheelR, 0.85, 16);
      w.rotateZ(Math.PI / 2);
      w.translate(sx * (width * 0.5), wheelR, pz);
      parts.push({ geometry: w, color: TYRE });
      const hub = new THREE.CylinderGeometry(wheelR * 0.45, wheelR * 0.45, 0.9, 12);
      hub.rotateZ(Math.PI / 2);
      hub.translate(sx * (width * 0.5), wheelR, pz);
      parts.push({ geometry: hub, color: 0x9aa3ad });
    }
  }

  // --- Instrument mast ----------------------------------------------------
  const mastH = 6.4;
  const mastY = floor + bodyH + cabH;
  parts.push({
    geometry: new THREE.CylinderGeometry(0.13, 0.16, mastH, 10),
    position: [0, mastY + mastH / 2, -length * 0.34],
    color: STEEL,
  });
  // A three-cup anemometer, which is the one weather instrument a person recognises on
  // sight. The cups are hemispheres on arms; a bare cross would read as an aerial.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6);
    arm.rotateZ(Math.PI / 2);
    arm.translate(Math.cos(a) * 0.75, mastY + mastH, Math.sin(a) * 0.75);
    arm.rotateY(0);
    parts.push({ geometry: arm, color: STEEL });
    const cup = new THREE.SphereGeometry(0.32, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    cup.rotateX(Math.PI / 2);
    cup.rotateY(a);
    cup.translate(Math.cos(a) * 1.5, mastY + mastH, Math.sin(a) * 1.5);
    parts.push({ geometry: cup, color: 0xe6e9ee });
  }
  // A wind vane on a short second mast.
  const vane = new THREE.BoxGeometry(0.08, 0.9, 1.5);
  vane.translate(0, mastY + mastH - 1.4, -length * 0.34 - 0.9);
  parts.push({ geometry: vane, color: 0xe6e9ee });

  // --- Light bar ----------------------------------------------------------
  parts.push({
    geometry: new THREE.BoxGeometry(width * 0.7, 0.28, 0.4),
    position: [0, floor + bodyH + cabH + 0.28, -length * 0.04 + cabLen / 2 - 0.4],
    color: 0x1b2028,
  });

  const bodyMesh = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.55,
    // 0.55 and not higher: there is no environment map anywhere in this app, and
    // metalness up at 0.9 renders BLACK. Every chrome bumper in New York learned this.
    metalness: 0.35,
    ...relief('metal', { seed: 4, repeat: 3, strength: 0.4 }),
  });
  g.add(bodyMesh);

  const glassMesh = mergedMesh(glass, {
    color: 0xffffff,
    roughness: 0.16,
    metalness: 0.2,
    transparent: true,
    opacity: 0.72,
  });
  glassMesh.castShadow = false;
  g.add(glassMesh);

  g.add(mergedMesh(guards, { color: 0xffffff, roughness: 0.5, metalness: 0.4 }));

  // Emissive light bar lenses, kept as their own low-metalness merge -- at high metalness
  // with no env map these come out as dark blobs stuck to the roof.
  const lamps = [];
  for (let i = -2; i <= 2; i++) {
    lamps.push({
      geometry: new THREE.BoxGeometry(width * 0.11, 0.2, 0.32),
      position: [i * width * 0.14, floor + bodyH + cabH + 0.28, -length * 0.04 + cabLen / 2 - 0.58],
      color: i % 2 === 0 ? 0xd8443c : 0x3f7fd8,
    });
  }
  g.add(mergedMesh(lamps, {
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.1,
    emissive: 0x552222,
    emissiveIntensity: 0.5,
  }));

  return g;
}

// ---------------------------------------------------------------------------
// 4. The wrecked farmstead
// ---------------------------------------------------------------------------

// A farmhouse with its roof taken off and one wall gone. The damage is the model -- an
// intact house next to a tornado is scenery, a broken one is evidence.
// THE HALF THAT IS STILL STANDING IS WHAT MAKES IT A HOUSE.
//
// The first version tore all four walls evenly and came out as a ring of grey battlements
// -- unmistakably a ruined castle, not a farmhouse. Damage on its own carries no identity:
// with no gable, no roof pitch, no chimney and no windows there was nothing left for the
// eye to recognise, and the ragged tops were regular enough to read as crenellations.
//
// So one END is kept intact, complete with its gable triangle, its chimney and a lit
// window, and the storm side is torn off from there. A student reads the whole house from
// the surviving half and then sees where the rest went. That asymmetry is also how a real
// tornado damages a building -- it does not sand a house evenly down to a stump.
export function wreckedFarmhouse({ width = 22, depth = 16, wallH = 10, seed = 44 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const glass = [];
  const wall = 0.6;
  const ridgeH = wallH + 6.5;

  // Floor deck, so the inside is a room rather than a hole in the ground.
  parts.push({ geometry: new THREE.BoxGeometry(width, 0.5, depth), position: [0, 0.25, 0], color: TIMBER });

  // --- The surviving end (-X) --------------------------------------------
  // Full-height wall plus the gable above it. The gable is the single strongest signal in
  // the model: a triangle on top of a rectangle is a house at any distance and in any
  // silhouette.
  parts.push({
    geometry: new THREE.BoxGeometry(wall, wallH, depth),
    position: [-width / 2, wallH / 2, 0],
    color: PAINT_WHITE,
  });
  // Gable: a stepped triangle, built as a stack of slabs that each narrow toward the
  // ridge. Deliberately NOT a rotated cone -- a 3-sided cone has to be turned twice to end
  // up as an upright plate, the two rotations do not commute, and getting it wrong gives
  // either a horizontal spike or a solid wedge. Nine stacked boxes need no rotation at all,
  // read as a gable from any distance a student will see it, and cost about as much.
  const gableRise = ridgeH - wallH;
  const GSTEPS = 9;
  for (let i = 0; i < GSTEPS; i++) {
    const t = i / GSTEPS;
    const step = gableRise / GSTEPS;
    parts.push({
      geometry: new THREE.BoxGeometry(wall, step * 1.06, depth * (1 - t)),
      position: [-width / 2, wallH + (i + 0.5) * step, 0],
      color: PAINT_WHITE,
    });
  }

  // Chimney -- a house tells you it is lived in by having one.
  parts.push({
    geometry: new THREE.BoxGeometry(2.2, wallH * 0.55, 2.2),
    position: [-width / 2 + 3.4, wallH + 2.4, -depth / 4],
    color: 0x8d5f4c,
  });
  parts.push({
    geometry: new THREE.BoxGeometry(2.7, 0.5, 2.7),
    position: [-width / 2 + 3.4, wallH + 2.4 + wallH * 0.28, -depth / 4],
    color: 0x6e483a,
  });

  // --- The two side walls, tearing away toward +X -------------------------
  // The height falls off with a smooth curve toward the storm end rather than a random
  // one per column, so the tear reads as one event that swept through. Columns are wide
  // and few -- narrow uniform ones are what produced battlements.
  for (const sx of [-1, 1]) {
    const cols = 7;
    for (let i = 0; i < cols; i++) {
      const t = (i + 0.5) / cols;                 // 0 at the surviving end
      const x = -width / 2 + t * width;
      // Full height for the first third, then falling away with a ragged edge on it.
      const fall = Math.max(0, (t - 0.3) / 0.7);
      const h = wallH * Math.max(0.12, (1 - fall ** 1.4) * randomIn(rng, 0.88, 1.06));
      parts.push({
        geometry: new THREE.BoxGeometry((width / cols) * 1.03, h, wall),
        position: [x, h / 2, sx * depth / 2],
        color: PAINT_WHITE,
      });
      // A window in the surviving stretch of the near wall. Dark glass in a white frame
      // reads as a window at a hundred feet; a plain dark rectangle reads as a hole.
      if (sx === 1 && (i === 1 || i === 2) && h > wallH * 0.72) {
        glass.push({
          geometry: new THREE.BoxGeometry(2.2, 2.6, 0.18),
          position: [x, wallH * 0.55, sx * (depth / 2 + 0.1)],
          color: 0x2c3a46,
        });
        parts.push({
          geometry: new THREE.BoxGeometry(2.7, 3.1, 0.12),
          position: [x, wallH * 0.55, sx * (depth / 2 + 0.02)],
          color: 0xf2ece0,
        });
      }
    }
  }

  // --- What is left of the roof ------------------------------------------
  // A real pitched slope over the surviving third, then bare rafters, then nothing. The
  // slope is what the gable is holding up, and without it the gable reads as a fin.
  const roofRun = width * 0.4;
  for (const sz of [-1, 1]) {
    const rise = ridgeH - wallH;
    const len = Math.hypot(depth / 2, rise);
    const geometry = new THREE.BoxGeometry(roofRun, 0.45, len);
    // atan2(rise, run) -- the angle from HORIZONTAL, and the sign flips per side because a
    // box's long axis is bidirectional. Machu Picchu's thatch is where both halves of this
    // were learned.
    //
    // The sign is `+sz`, not `-sz`. R_x(theta) sends local +Z to (0, -sin theta, cos theta),
    // so a POSITIVE angle drops the far +Z end -- which is what the +Z slope needs, since
    // the ridge is at z = 0 and the eaves are outboard. Negated, both slopes tip the wrong
    // way and the roof comes out as a V: a valley between two walls instead of a peak, and
    // from the end it reads as one solid brown box.
    geometry.rotateX(sz * Math.atan2(rise, depth / 2));
    geometry.translate(-width / 2 + roofRun / 2, wallH + rise / 2, sz * depth / 4);
    parts.push({ geometry, color: 0x7d5b46 });
  }
  // Snapped rafters carrying on past where the roof stops.
  for (let i = 0; i < 6; i++) {
    const x = -width / 2 + roofRun + 0.8 + i * 1.9;
    if (x > width / 2) break;
    const len = randomIn(rng, 3.5, depth * 0.8);
    const geometry = new THREE.BoxGeometry(0.35, 0.45, len);
    geometry.rotateX(randomIn(rng, -0.45, 0.45));
    geometry.rotateZ(randomIn(rng, -0.25, 0.1));
    geometry.translate(x, wallH * randomIn(rng, 0.9, 1.15), randomIn(rng, -1.5, 1.5));
    parts.push({ geometry, color: TIMBER });
  }

  const m = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.85,
    // A WEAK bump, and that is the opposite of the instinct. This wall is built from a row
    // of separate boxes so the relief tile restarts on each one, and every box edge lands
    // where a tile seam does: at any strength worth having, the result is a grid of raised
    // rectangles and the house renders as grey block masonry rather than white clapboard.
    // The tear in the wall is already carrying all the texture this needs.
    ...relief('wood', { seed, repeat: 10, strength: 0.18 }),
  });
  g.add(m);

  if (glass.length) {
    const gm = mergedMesh(glass, { color: 0xffffff, roughness: 0.2, metalness: 0.2 });
    g.add(gm);
  }
  return g;
}

// A barn, leaning but up. Red, because a red barn on gold wheat under a slate sky is the
// whole colour story of this world in one object.
export function prairieBarn({ width = 26, depth = 18, wallH = 12, lean = 0.06, seed = 51 } = {}) {
  const g = group();
  const parts = [];
  const ridgeH = wallH + 8;

  for (const sx of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.7, wallH, depth), position: [sx * width / 2, wallH / 2, 0], color: BARN_RED });
  }
  for (const sz of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(width, wallH, 0.7), position: [0, wallH / 2, sz * depth / 2], color: BARN_RED });
  }

  // Gambrel roof: two pitches a side, which is what makes a barn a barn rather than a
  // shed. The sign of the rotation is PER SIDE -- a box's long axis is bidirectional, so
  // the same angle that is right on one slope is mirrored on the other.
  const slope = (side, x0, y0, x1, y1) => {
    const run = x1 - x0;
    const rise = y1 - y0;
    const len = Math.hypot(run, rise);
    const geometry = new THREE.BoxGeometry(len, 0.5, depth * 1.06);
    // atan2(rise, run) -- the angle from HORIZONTAL. atan2(run, rise) is the angle from
    // vertical and lands 90 degrees out, which is how Machu Picchu's thatch turned into a
    // venetian blind.
    geometry.rotateZ(side * Math.atan2(rise, run));
    geometry.translate(side * (x0 + x1) / 2, (y0 + y1) / 2, 0);
    parts.push({ geometry, color: 0x6d2a20 });
  };
  for (const side of [1, -1]) {
    slope(side, width / 2, wallH, width * 0.28, wallH + 5.2);
    slope(side, width * 0.28, wallH + 5.2, 0.2, ridgeH);
  }

  // Big sliding door, plus its rail -- the one opening a barn always has.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.34, wallH * 0.66, 0.4), position: [0, wallH * 0.33, depth / 2 + 0.2], color: 0x5d2119 });
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.5, 0.3, 0.3), position: [0, wallH * 0.7, depth / 2 + 0.25], color: RUST });
  // White trim on the door frame: without it the door is a slightly different red on red.
  for (const sx of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.4, wallH * 0.66, 0.45), position: [sx * width * 0.17, wallH * 0.33, depth / 2 + 0.22], color: PAINT_WHITE });
  }

  const m = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.9,
    ...relief('wood', { seed, repeat: 4, strength: 0.7 }),
  });
  m.rotation.z = lean;
  g.add(m);
  return g;
}

// A grain silo, dented. Corrugated, because a smooth cylinder at this size is a tin can.
export function grainSilo({ height = 24, radius = 5, seed = 61 } = {}) {
  const g = group();
  const parts = [];

  // The corrugations are separate thin rings rather than a texture, so the silhouette
  // itself is ribbed -- relief() fakes lighting and never changes an outline.
  const rings = Math.round(height / 1.5);
  for (let i = 0; i < rings; i++) {
    const y = (i + 0.5) * (height / rings);
    const r = radius * (i > rings - 3 ? 0.99 : 1);
    parts.push({
      geometry: new THREE.CylinderGeometry(r, r, height / rings * 0.82, 22),
      position: [0, y, 0],
      color: 0xb9bec6,
    });
  }
  // Domed cap.
  const cap = new THREE.SphereGeometry(radius * 1.02, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.55, 1);
  cap.translate(0, height, 0);
  parts.push({ geometry: cap, color: 0x9aa1aa });

  // A dent: two panels pushed in on the storm side.
  for (let i = 0; i < 2; i++) {
    const geometry = new THREE.BoxGeometry(radius * 0.9, 3.2, 1.4);
    geometry.rotateY(0.3);
    geometry.translate(radius * 0.72, height * (0.34 + i * 0.16), radius * 0.5);
    parts.push({ geometry, color: 0x8d939b });
  }

  const m = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.4,
    ...relief('metal', { seed, repeat: 5, strength: 0.55 }),
  });
  g.add(m);
  return g;
}

// The farm water-pump windmill: a lattice tower and a multi-blade fan. Iconic on the
// plains, and its fan is a second thing in the world that reads as spinning.
export function farmWindmill({ height = 26, blades = 16, seed = 71 } = {}) {
  const g = group();
  const parts = [];
  const baseW = 4.2;
  const topW = 1.1;

  // Four legs plus cross bracing. The bracing is what makes it a lattice tower rather
  // than four sticks.
  const legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [lx, lz] of legs) {
    const geometry = new THREE.BoxGeometry(0.22, height, 0.22);
    const from = new THREE.Vector3(lx * baseW / 2, 0, lz * baseW / 2);
    const to = new THREE.Vector3(lx * topW / 2, height, lz * topW / 2);
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const dir = to.clone().sub(from);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quat));
    geometry.translate(mid.x, mid.y, mid.z);
    parts.push({ geometry, color: STEEL });
  }
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const y = t * height;
    const w = baseW + (topW - baseW) * t;
    for (const sz of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(w, 0.16, 0.16), position: [0, y, sz * w / 2], color: STEEL });
    }
    for (const sx of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(0.16, 0.16, w), position: [sx * w / 2, y, 0], color: STEEL });
    }
  }

  // The fan. Many narrow blades on a hub -- a four-blade fan is a different machine.
  const hubY = height + 1.6;
  parts.push({ geometry: new THREE.CylinderGeometry(0.5, 0.5, 0.7, 12), position: [0, hubY, 0], color: RUST });
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const geometry = new THREE.BoxGeometry(0.1, 2.6, 0.55);
    geometry.translate(0, 1.9, 0);
    geometry.rotateZ(0.35);
    geometry.rotateX(a);
    geometry.translate(0, hubY, 0);
    parts.push({ geometry, color: 0xc6ccd4 });
  }
  // Tail vane.
  const tail = new THREE.BoxGeometry(0.1, 2.2, 3.4);
  tail.translate(0, hubY, -3.6);
  parts.push({ geometry: tail, color: 0xc6ccd4 });

  const m = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.42,
    ...relief('metal', { seed, repeat: 4, strength: 0.5 }),
  });
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// 5. The Doppler radar truck
// ---------------------------------------------------------------------------

// A flatbed with a parabolic dish on a turntable -- the thing that actually measures a
// tornado's wind speed, and therefore the object in this world that has the strongest
// claim to being the science.
//
// The dish is a SHALLOW cap opening toward the storm. Mars's relay dish is the cautionary
// tale: too deep a sweep is a bowl whose convex back reads as a solid ball on a stick, and
// a cap is authored around its sphere's pole, so the sphere centre has to be offset by
// exactly the radius or the dish floats clear of the mast it is bolted to.
export function dopplerTruck({ length = 18, width = 7, dishRadius = 6 } = {}) {
  const g = group();
  const parts = [];
  const wheelR = 1.5;
  const deck = wheelR * 1.5;

  // Flatbed + cab.
  parts.push({ geometry: new THREE.BoxGeometry(width, 1.1, length), position: [0, deck, 0], color: 0x3c4550 });
  const cabLen = length * 0.28;
  parts.push({
    geometry: new THREE.BoxGeometry(width * 0.94, 3.4, cabLen),
    position: [0, deck + 0.55 + 1.7, length / 2 - cabLen / 2],
    color: 0xd6dae0,
  });
  parts.push({
    geometry: new THREE.BoxGeometry(width * 0.86, 1.5, 0.12),
    position: [0, deck + 0.55 + 2.3, length / 2 - 0.06],
    color: GLASS,
  });
  // Outriggers -- the legs that steady it while the dish turns. A radar truck without
  // them looks like a delivery lorry with a satellite dish.
  for (const sx of [-1, 1]) {
    for (const pz of [-length * 0.28, length * 0.02]) {
      parts.push({ geometry: new THREE.BoxGeometry(2.6, 0.35, 0.6), position: [sx * (width / 2 + 1.1), deck - 0.3, pz], color: RUST });
      parts.push({ geometry: new THREE.CylinderGeometry(0.22, 0.42, deck - 0.3, 8), position: [sx * (width / 2 + 2.1), (deck - 0.3) / 2, pz], color: STEEL });
    }
  }

  for (const sx of [-1, 1]) {
    for (const pz of [length * 0.33, length * 0.06, -length * 0.3]) {
      const w = new THREE.CylinderGeometry(wheelR, wheelR, 0.9, 16);
      w.rotateZ(Math.PI / 2);
      w.translate(sx * (width * 0.5), wheelR, pz);
      parts.push({ geometry: w, color: TYRE });
    }
  }

  // Turntable + mast.
  const mastY = deck + 0.55;
  parts.push({ geometry: new THREE.CylinderGeometry(1.7, 2.0, 0.7, 18), position: [0, mastY + 0.35, -length * 0.22], color: 0x60686f });
  parts.push({ geometry: new THREE.CylinderGeometry(0.42, 0.5, 3.6, 12), position: [0, mastY + 2.5, -length * 0.22], color: STEEL });

  const dishY = mastY + 4.4;
  const dishZ = -length * 0.22;

  // SOUTH cap -- opens upward-and-outward toward the storm. A north cap opens downward and
  // aims the concave face at the ground.
  const sweep = Math.PI * 0.30;                     // shallow: 54deg of the sphere
  const sphereR = dishRadius / Math.sin(sweep);
  const dish = new THREE.SphereGeometry(sphereR, 30, 14, 0, Math.PI * 2, Math.PI - sweep, sweep);
  // The cap is authored around the sphere's pole, so lift by exactly the sphere radius to
  // put the bowl's vertex on the mount rather than floating the dish off it.
  dish.translate(0, sphereR, 0);
  dish.rotateX(-Math.PI / 2.6);                     // tip it up toward the storm
  dish.translate(0, dishY, dishZ);
  parts.push({ geometry: dish, color: DISH_WHITE });

  // Feed horn on three struts, which is what stops the dish reading as an umbrella.
  const feedOffset = new THREE.Vector3(0, Math.sin(Math.PI / 2.6), -Math.cos(Math.PI / 2.6)).multiplyScalar(dishRadius * 0.72);
  parts.push({
    geometry: new THREE.CylinderGeometry(0.3, 0.42, 1.0, 10),
    position: [0, dishY + feedOffset.y, dishZ + feedOffset.z],
    color: 0x3a424c,
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const rimX = Math.cos(a) * dishRadius * 0.8;
    const rimY = dishY + Math.sin(a) * dishRadius * 0.8 * Math.sin(Math.PI / 2.6);
    const rimZ = dishZ - Math.sin(a) * dishRadius * 0.8 * Math.cos(Math.PI / 2.6);
    const from = new THREE.Vector3(rimX, rimY, rimZ);
    const to = new THREE.Vector3(0, dishY + feedOffset.y, dishZ + feedOffset.z);
    const dir = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(0.09, 0.09, dir.length(), 6);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quat));
    const mid = from.clone().add(to).multiplyScalar(0.5);
    geometry.translate(mid.x, mid.y, mid.z);
    parts.push({ geometry, color: 0x9aa3ad });
  }

  const m = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.55,
    metalness: 0.38,
    ...relief('metal', { seed: 9, repeat: 3, strength: 0.45 }),
  });
  g.add(m);
  return g;
}

// A deployable ground probe -- the squat armoured pod chasers leave in a tornado's path to
// measure pressure from inside it. Low, heavy and finned so the wind pushes it DOWN.
export function stormProbe({ radius = 2.2, height = 1.6 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(radius, radius * 1.25, height, 16), position: [0, height / 2, 0], color: 0xd8a33c });
  const cap = new THREE.SphereGeometry(radius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.42, 1);
  cap.translate(0, height, 0);
  parts.push({ geometry: cap, color: 0xd8a33c });
  // Fins.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const geometry = new THREE.BoxGeometry(radius * 1.1, 0.28, 0.2);
    geometry.translate(radius * 0.9, height * 0.28, 0);
    geometry.rotateY(a);
    parts.push({ geometry, color: 0x3a424c });
  }
  // Instrument stub on top.
  parts.push({ geometry: new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), position: [0, height + 0.55, 0], color: STEEL });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.6, metalness: 0.3 }));
  return g;
}

// ---------------------------------------------------------------------------
// Landscape and damage
// ---------------------------------------------------------------------------

// A patch of standing wheat. Many thin blades merged to one mesh -- the Park's flower beds'
// lesson: anything placed by the hundred must be one draw call.
export function wheatPatch({ radius = 9, count = 130, height = 3.2, seed = 81 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(randomIn(rng, 0, 1)) * radius;
    const h = height * randomIn(rng, 0.7, 1.25);
    // A modest lean. At the 0.08-0.42 radians this started at, every stalk was pitched
    // over far enough that the patch read as flattened stubble rather than standing crop
    // -- and standing gold crop under a black sky is the one image this world exists for.
    // The wind belongs in the CONSISTENCY of the lean, not in its size.
    const lean = randomIn(rng, 0.04, 0.19);
    const stalk = new THREE.CylinderGeometry(0.035, 0.055, h, 4);
    stalk.translate(0, h / 2, 0);
    // All leaning roughly the same way -- wind. Independently-oriented stalks read as a
    // lawn, and this is a field being blown flat by a storm.
    stalk.rotateZ(lean);
    stalk.rotateY(randomIn(rng, -0.5, 0.5));
    stalk.translate(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    parts.push({ geometry: stalk, color: rng() > 0.5 ? WHEAT_LIT : WHEAT_DEEP });
    // The head -- an ear of grain. Without it this is grass, not wheat.
    const head = new THREE.CylinderGeometry(0.09, 0.05, h * 0.24, 5);
    head.translate(0, h * 1.02, 0);
    head.rotateZ(lean);
    head.translate(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    parts.push({ geometry: head, color: WHEAT_LIT });
  }
  const m = mergedMesh(parts, { color: 0xffffff, roughness: 0.85 });
  m.castShadow = false;   // 130 blades casting shadows, times a dozen patches
  g.add(m);
  return g;
}

// Scattered wreckage: planks, sheet metal, a wheel, fence pickets.
export function debrisField({ radius = 12, count = 26, seed = 91 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = Math.sqrt(randomIn(rng, 0, 1)) * radius;
    const kind = Math.floor(randomIn(rng, 0, 4));
    let geometry;
    let color = TIMBER;
    if (kind === 0) {
      geometry = new THREE.BoxGeometry(randomIn(rng, 3, 8), 0.22, 0.7);
    } else if (kind === 1) {
      geometry = new THREE.BoxGeometry(randomIn(rng, 2.5, 5), 0.1, randomIn(rng, 2, 4));
      color = 0x9aa1a9;                                  // sheet metal
    } else if (kind === 2) {
      geometry = new THREE.CylinderGeometry(0.9, 0.9, 0.4, 12);
      geometry.rotateX(Math.PI / 2 + randomIn(rng, -0.4, 0.4));
      color = TYRE;
    } else {
      geometry = new THREE.BoxGeometry(0.5, randomIn(rng, 1.5, 3), 0.5);
      color = PAINT_WHITE;
    }
    // Lying at all angles, and mostly LYING -- debris after a tornado is flat on the
    // ground, not standing up.
    geometry.rotateY(randomIn(rng, 0, Math.PI * 2));
    geometry.rotateZ(randomIn(rng, -0.5, 0.5));
    geometry.translate(Math.cos(a) * rad, randomIn(rng, 0.1, 0.6), Math.sin(a) * rad);
    parts.push({ geometry, color });
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.9, ...relief('wood', { seed, repeat: 3, strength: 0.5 }) }));
  return g;
}

// A power pole, upright or snapped. `broken` shears it partway up and drops the top.
export function powerPole({ height = 20, broken = false, seed = 101 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const breakAt = broken ? height * randomIn(rng, 0.35, 0.6) : height;

  parts.push({
    geometry: new THREE.CylinderGeometry(0.32, 0.42, breakAt, 10),
    position: [0, breakAt / 2, 0],
    color: 0x6b5a44,
  });

  if (broken) {
    // The top, lying on the ground beside the stump with its crossarm still on it.
    const fallen = height - breakAt;
    const geometry = new THREE.CylinderGeometry(0.28, 0.32, fallen, 10);
    geometry.rotateZ(Math.PI / 2 - 0.12);
    geometry.translate(fallen / 2 + 1.2, 0.4, randomIn(rng, -1.5, 1.5));
    parts.push({ geometry, color: 0x6b5a44 });
    parts.push({
      geometry: new THREE.BoxGeometry(0.35, 0.35, 6),
      position: [fallen * 0.85, 0.7, 0],
      color: 0x6b5a44,
    });
  } else {
    parts.push({ geometry: new THREE.BoxGeometry(0.35, 0.35, 7), position: [0, height - 1.4, 0], color: 0x6b5a44 });
    for (const sz of [-1, 1]) {
      parts.push({ geometry: new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8), position: [0, height - 1.0, sz * 2.9], color: 0x8fa3b4 });
    }
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.92, ...relief('bark', { seed, repeat: 4, strength: 0.7 }) }));
  return g;
}

// A round hay bale. Cheap, and half a dozen of them scattered across the wheat is what
// makes the field read as farmed rather than as wild grass.
export function hayBale({ radius = 2.4, width = 3.2, seed = 111 } = {}) {
  const g = group();
  const geometry = new THREE.CylinderGeometry(radius, radius, width, 20);
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(0, radius, 0);
  const m = mesh(geometry, standard({
    color: 0xc0a04c,
    roughness: 0.95,
    ...relief('weave', { seed, repeat: 5, strength: 0.9 }),
  }));
  g.add(m);
  return g;
}

// A snapped tree -- trunk standing, crown gone, remaining branches all swept one way.
// The sweep is the point: it records which way the wind went.
export function snappedTree({ height = 14, seed = 121 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const trunkH = height * randomIn(rng, 0.5, 0.72);
  parts.push({
    geometry: new THREE.CylinderGeometry(0.5, 0.95, trunkH, 12),
    position: [0, trunkH / 2, 0],
    color: 0x5c4a36,
  });
  // A splintered top rather than a flat cut.
  for (let i = 0; i < 5; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const geometry = new THREE.ConeGeometry(0.22, randomIn(rng, 1, 2.6), 5);
    geometry.translate(Math.cos(a) * 0.3, trunkH + 0.8, Math.sin(a) * 0.3);
    parts.push({ geometry, color: 0x8a7452 });
  }
  for (let i = 0; i < 4; i++) {
    const y = trunkH * randomIn(rng, 0.35, 0.85);
    const len = randomIn(rng, 2.5, 5);
    const geometry = new THREE.CylinderGeometry(0.14, 0.26, len, 7);
    geometry.rotateZ(Math.PI / 2);
    geometry.translate(len / 2, 0, 0);
    // Every branch swept the same way.
    geometry.rotateZ(randomIn(rng, -0.35, 0.05));
    geometry.rotateY(randomIn(rng, -0.6, 0.6));
    geometry.translate(0, y, 0);
    parts.push({ geometry, color: 0x5c4a36 });
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.92, ...relief('bark', { seed, repeat: 4, strength: 0.8 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// The EF scale board
// ---------------------------------------------------------------------------

// A chart, not a model -- the same split Fantastic Voyage draws between organs you walk
// round and systems you read. Wind speed against damage is a RELATIONSHIP, and no amount
// of walking around a funnel shows it.
export function efScaleBoard({ width = 11, postHeight = 3.6, highlight = 4 } = {}) {
  const g = group();
  const height = width * 0.72;

  const ROWS = [
    ['EF0', '65–85 mph', 'Branches broken, shingles off'],
    ['EF1', '86–110 mph', 'Roofs stripped, mobile homes pushed'],
    ['EF2', '111–135 mph', 'Roofs gone, large trees snapped'],
    ['EF3', '136–165 mph', 'Whole storeys destroyed, trains overturned'],
    ['EF4', '166–200 mph', 'Well-built houses levelled, cars thrown'],
    ['EF5', 'over 200 mph', 'Houses swept away, steel structures bent'],
  ];

  const texture = canvasTexture(1024, 736, (ctx, w, h) => {
    ctx.fillStyle = '#f3efe4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#232a33';
    ctx.fillRect(0, 0, w, 104);
    ctx.fillStyle = '#f3efe4';
    ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('THE ENHANCED FUJITA SCALE', 34, 70);

    const top = 128;
    const rowH = (h - top - 34) / ROWS.length;
    ROWS.forEach((row, i) => {
      const y = top + i * rowH;
      const isHere = i === highlight;
      // The banding is doing real work: six rows of identical cream is a table nobody
      // reads, and the highlighted row is what connects the chart to the funnel outside.
      ctx.fillStyle = isHere ? '#d8452f' : (i % 2 ? '#e6e0d2' : '#efe9dc');
      ctx.fillRect(24, y, w - 48, rowH - 6);

      ctx.fillStyle = isHere ? '#fff3ee' : '#2b3038';
      ctx.font = 'bold 46px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(row[0], 44, y + rowH * 0.62);
      ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(row[1], 150, y + rowH * 0.62);
      ctx.font = '30px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(row[2], 380, y + rowH * 0.62);

      if (isHere) {
        ctx.font = 'bold 28px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('◀ THIS ONE', w - 200, y + rowH * 0.62);
      }
    });
  });

  const panel = signPanel(width, height, texture, { emissive: 0x6b6252, emissiveIntensity: 0.22 });
  panel.position.y = postHeight + height / 2;
  g.add(panel);

  // A solid dark backing board. A big flat panel seen from behind is a black slab, which
  // is what anatomyChart() puts a backing on for and what the Mars cabinet taught.
  const back = box(width * 1.03, height * 1.03, 0.3, standard({ color: 0x2b3038, roughness: 0.85 }),
    0, postHeight + height / 2, -0.18);
  g.add(back);

  // Posts OUTSIDE the panel, not inset. An activity board's text is left-aligned and starts
  // a few inches in, so an inset post stands in front of the first character of every line.
  const postMat = standard({ color: 0x3b424b, roughness: 0.7, metalness: 0.3 });
  for (const sx of [-1, 1]) {
    g.add(cyl(0.19, 0.24, postHeight + height * 0.5, postMat, sx * (width * 0.53), (postHeight + height * 0.5) / 2, -0.18));
  }
  return g;
}
