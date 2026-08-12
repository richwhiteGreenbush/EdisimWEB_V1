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
  seededRandom,
  randomIn,
  roughenSphere,
} from '../PropKit.js';
import { earthTexture } from './Earth.js';

// "The Moon" -- an Apollo-era landing site, built to real proportions so the sizes
// themselves teach something: the rover really is about twice as long as a student is
// tall, and the lunar module really does loom three or four times over them.

// flatShading on the foil is what makes the descent stage read as the eight-sided box
// it actually is -- with smooth normals an 8-segment cylinder just looks like a barrel.
const FOIL = () =>
  standard({
    color: 0xd9a83c,
    roughness: 0.32,
    metalness: 0.95,
    flatShading: true,
    emissive: new THREE.Color(0x2a1c05),
    emissiveIntensity: 0.5,
  });
const WHITE_PAINT = () => standard({ color: 0xe8e6e0, roughness: 0.6 });
const DARK_METAL = () => standard({ color: 0x3a3d42, roughness: 0.45, metalness: 0.7 });

// ---------------------------------------------------------------------------
// Lunar Roving Vehicle
// ---------------------------------------------------------------------------

// One open wire wheel -- the LRV ran on woven piano-wire mesh, not rubber, because
// rubber outgasses and cracks in vacuum. Tire hoops, hub, radial spokes and chevron
// treads all merge into a single geometry, so four wheels cost four draw calls.
//
// Built with its AXLE ALONG X and centred on the origin; the caller yaws it to suit.
// Rotating by `a` about X maps +Y to (0, cos a, sin a), which is what puts each spoke
// and tread at its angle around the rim.
function wireWheel(radius, width) {
  const parts = [];
  const tire = 0xb9b6ae;

  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.TorusGeometry(radius, 0.09, 8, 28),
      rotation: [0, Math.PI / 2, 0],
      position: [(side * width) / 2, 0, 0],
      color: tire,
    });
  }

  parts.push({
    geometry: new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, width + 0.1, 14),
    rotation: [0, 0, Math.PI / 2],
    color: 0x6e7076,
  });

  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    parts.push({
      geometry: new THREE.CylinderGeometry(0.022, 0.022, radius * 0.86, 5),
      rotation: [angle, 0, 0],
      position: [0, Math.cos(angle) * radius * 0.55, Math.sin(angle) * radius * 0.55],
      color: tire,
    });
  }

  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(width * 0.72, 0.07, 0.3),
      rotation: [angle, 0, 0],
      position: [0, Math.cos(angle) * radius, Math.sin(angle) * radius],
      color: 0x8d8a83,
    });
  }

  return mergedMesh(parts, { roughness: 0.85, metalness: 0.15 });
}

// The Apollo Lunar Roving Vehicle at its real size: 10.2ft long, 6ft wide, 32in
// wheels. Parked, it is almost exactly twice as long as the student looking at it.
export function lunarRover({ length = 10.2, width = 6 } = {}) {
  const g = group();
  const frame = DARK_METAL();
  const foil = FOIL();
  const fender = standard({ color: 0xd9d5cb, roughness: 0.7 });
  const seatFabric = standard({ color: 0x2f4f7a, roughness: 0.95 });

  const wheelRadius = 32 / 12 / 2; // 32-inch wheels, in feet
  const deckY = wheelRadius + 0.55;

  // Chassis: three folding frame sections plus cross members.
  g.add(box(length * 0.86, 0.22, width * 0.62, frame, 0, deckY, 0));
  g.add(box(length * 0.9, 0.12, 0.22, frame, 0, deckY - 0.16, width * 0.3));
  g.add(box(length * 0.9, 0.12, 0.22, frame, 0, deckY - 0.16, -width * 0.3));
  g.add(box(length * 0.5, 0.16, width * 0.66, foil, -length * 0.16, deckY + 0.16, 0));

  // Wheels + fenders. The wheel builder makes an X-axled wheel, so each one is yawed
  // 90 degrees to put its axle across the rover's width (Z).
  const wheelWidth = 0.75;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * length * 0.38;
      const z = sz * (width / 2 - wheelWidth / 2 - 0.1);

      const wheel = wireWheel(wheelRadius, wheelWidth);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(x, wheelRadius, z);
      g.add(wheel);

      // Open-ended cylinder shell as the fender. Its sweep starts from +Z, and the
      // rotateX below maps +Z to +Y -- so a sweep centred on PI lands over the top.
      const guard = mesh(
        new THREE.CylinderGeometry(
          wheelRadius + 0.3,
          wheelRadius + 0.3,
          wheelWidth + 0.3,
          16,
          1,
          true,
          Math.PI * 0.55,
          Math.PI * 0.9
        ),
        fender,
        x,
        wheelRadius,
        z
      );
      guard.rotation.x = Math.PI / 2;
      guard.material.side = THREE.DoubleSide;
      g.add(guard);
    }
  }

  // Two side-by-side seats with webbed backs.
  for (const sz of [-1, 1]) {
    const z = sz * width * 0.19;
    g.add(box(1.9, 0.16, 1.7, seatFabric, -0.2, deckY + 0.45, z));
    const back = box(0.18, 1.9, 1.7, seatFabric, -1.05, deckY + 1.3, z);
    back.rotation.z = 0.16;
    g.add(back);
    g.add(box(2.0, 0.1, 0.12, frame, -0.2, deckY + 0.36, z + 0.85));
    g.add(box(2.0, 0.1, 0.12, frame, -0.2, deckY + 0.36, z - 0.85));
  }

  // Control console + T-handle between the seats.
  const console3D = box(1.1, 1.0, 1.3, frame, 1.6, deckY + 0.7, 0);
  console3D.rotation.z = -0.25;
  g.add(console3D);
  g.add(cyl(0.06, 0.06, 1.1, frame, 1.05, deckY + 0.85, 0, 8));
  const tHandle = cyl(0.05, 0.05, 0.7, frame, 1.05, deckY + 1.4, 0, 8);
  tHandle.rotation.x = Math.PI / 2;
  g.add(tHandle);

  // High-gain dish antenna: the rover's most recognisable feature. Aimed at Earth.
  const mast = cyl(0.07, 0.09, 3.4, frame, 2.2, deckY + 1.7, 0, 10);
  g.add(mast);
  const dish = mesh(
    new THREE.SphereGeometry(1.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6),
    standard({ color: 0xd8d5ce, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }),
    2.2,
    deckY + 3.6,
    0
  );
  dish.rotation.set(-0.7, 0, 0.35);
  g.add(dish);

  // Low-gain whip antenna, and the TV camera that broadcast the drives home.
  g.add(cyl(0.03, 0.03, 2.6, frame, 1.9, deckY + 1.5, -1.1, 6));
  g.add(box(0.55, 0.5, 0.5, standard({ color: 0xdedbd3, roughness: 0.6 }), 2.5, deckY + 1.6, 1.0));
  const lens = cyl(0.16, 0.16, 0.35, DARK_METAL(), 2.85, deckY + 1.6, 1.0, 12);
  lens.rotation.z = Math.PI / 2;
  g.add(lens);

  // Rear tool pallet with sample bags.
  g.add(box(1.5, 0.7, width * 0.55, foil, -length * 0.42, deckY + 0.5, 0));
  g.add(box(0.9, 0.9, 0.9, WHITE_PAINT(), -length * 0.42, deckY + 1.2, -0.9));

  return g;
}

// ---------------------------------------------------------------------------
// Lunar Module
// ---------------------------------------------------------------------------

// Apollo Lunar Module, near real scale: ~20ft to the top of the docking tunnel with a
// ~26ft footpad span. Gold Kapton foil on the descent stage, four legs with dish
// footpads, and the ladder the crew actually climbed down.
export function lunarModule({ height = 20, legSpan = 26 } = {}) {
  const g = group();
  const foil = FOIL();
  const white = WHITE_PAINT();
  const dark = DARK_METAL();

  const descentHeight = height * 0.28;
  const descentRadius = 6.6;
  const descentY = height * 0.2;

  // Descent stage: an octagonal foil-wrapped box.
  const descent = cyl(descentRadius, descentRadius, descentHeight, foil, 0, descentY + descentHeight / 2, 0, 8);
  g.add(descent);
  g.add(cyl(descentRadius * 1.02, descentRadius * 1.02, 0.3, dark, 0, descentY + descentHeight, 0, 8));

  // Descent engine bell underneath.
  g.add(cyl(0.9, 2.1, 3.0, dark, 0, descentY - 1.2, 0, 20));

  // Four legs, each a strut pair down to a dish footpad.
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const padX = dx * (legSpan / 2);
    const padZ = dz * (legSpan / 2);

    const legLength = Math.hypot(legSpan / 2 - descentRadius * 0.8, descentY + descentHeight * 0.5);
    const strut = cyl(0.22, 0.26, legLength * 1.12, white);
    strut.position.set((padX + dx * descentRadius * 0.8) / 2, (descentY + descentHeight * 0.5) / 2, (padZ + dz * descentRadius * 0.8) / 2);
    strut.lookAt(new THREE.Vector3(padX, 0.5, padZ));
    strut.rotateX(Math.PI / 2);
    g.add(strut);

    g.add(cyl(1.5, 1.4, 0.35, white, padX, 0.18, padZ, 16));
    g.add(cyl(0.13, 0.13, 2.6, white, padX * 0.86, 1.6, padZ * 0.86, 8));

    // Contact probe: the real feelers that told the crew they had touched down.
    g.add(cyl(0.05, 0.05, 4.4, dark, padX, -1.9, padZ, 6));
  }

  // Ascent stage: crew cabin, angled forward face, two triangular windows, and the
  // docking tunnel on top.
  const cabinY = descentY + descentHeight;
  const cabin = cyl(4.2, 4.6, height * 0.24, white, 0, cabinY + height * 0.12, 0, 12);
  g.add(cabin);
  g.add(box(6.2, height * 0.16, 1.2, white, 0, cabinY + height * 0.1, 4.2));

  const windowMat = standard({ color: 0x1a2b38, roughness: 0.15, metalness: 0.6 });
  for (const sx of [-1, 1]) {
    const window3D = box(1.5, 1.2, 0.16, windowMat, sx * 1.5, cabinY + height * 0.13, 4.82);
    window3D.rotation.x = 0.3;
    g.add(window3D);
  }

  g.add(cyl(4.4, 4.2, height * 0.1, foil, 0, cabinY + height * 0.29, 0, 12));
  g.add(cyl(1.9, 1.9, height * 0.09, dark, 0, cabinY + height * 0.38, 0, 16));
  g.add(cyl(2.1, 1.9, 0.4, white, 0, cabinY + height * 0.43, 0, 16));

  // RCS thruster quads at the cabin corners.
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const rcs = box(1.0, 1.0, 1.0, dark, Math.cos(angle) * 5.0, cabinY + height * 0.2, Math.sin(angle) * 5.0);
    g.add(rcs);
  }

  // Front porch + ladder on the +Z leg.
  g.add(box(3.4, 0.2, 2.2, white, 0, cabinY - 0.1, 6.4));
  const ladderRail = 0.09;
  for (const sx of [-1, 1]) {
    g.add(cyl(ladderRail, ladderRail, cabinY, white, sx * 0.7, cabinY / 2, 6.9, 6));
  }
  for (let i = 0; i < 9; i++) {
    const rung = cyl(0.06, 0.06, 1.4, white, 0, 0.7 + i * ((cabinY - 1.2) / 8), 6.9, 6);
    rung.rotation.z = Math.PI / 2;
    g.add(rung);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Site furniture
// ---------------------------------------------------------------------------

function flagTexture() {
  return canvasTexture(760, 400, (ctx, w, h) => {
    const stripeHeight = h / 13;
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
      ctx.fillRect(0, i * stripeHeight, w, stripeHeight);
    }
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, w * 0.4, stripeHeight * 7);

    ctx.fillStyle = '#ffffff';
    for (let row = 0; row < 9; row++) {
      const count = row % 2 === 0 ? 6 : 5;
      for (let col = 0; col < count; col++) {
        const x = (w * 0.4 * (col + (row % 2 === 0 ? 0.5 : 1))) / 6;
        const y = (stripeHeight * 7 * (row + 0.5)) / 9;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// The flag assembly, crossbar and all. The horizontal bar along the top is the whole
// teaching point: with no air on the Moon a flag would hang limp, so the crew carried
// one with a telescoping arm sewn into its top hem to hold it out flat.
export function lunarFlag({ poleHeight = 8 } = {}) {
  const g = group();
  const pole = standard({ color: 0xd8d5cd, roughness: 0.5, metalness: 0.4 });

  g.add(cyl(0.07, 0.09, poleHeight, pole, 0, poleHeight / 2, 0, 10));
  g.add(cyl(0.16, 0.2, 0.3, pole, 0, 0.15, 0, 12));

  const flagWidth = 5;
  const flagHeight = 3;
  const crossbar = cyl(0.05, 0.05, flagWidth, pole, flagWidth / 2, poleHeight - 0.15, 0, 8);
  crossbar.rotation.z = Math.PI / 2;
  g.add(crossbar);

  // A gentle ripple frozen into the cloth: the crease the flag kept after being
  // unrolled from its tube, which is why photographs look like it is waving.
  const flagGeometry = new THREE.PlaneGeometry(flagWidth, flagHeight, 24, 1);
  const position = flagGeometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    position.setZ(i, Math.sin((x / flagWidth) * Math.PI * 3) * 0.16);
  }
  flagGeometry.computeVertexNormals();

  const flag = mesh(
    flagGeometry,
    standard({ map: flagTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    flagWidth / 2,
    poleHeight - 0.15 - flagHeight / 2,
    0
  );
  g.add(flag);

  return g;
}

// ALSEP: the science station each crew deployed. Central transmitter with sun-facing
// panels, plus a seismometer and a laser retroreflector still in use today.
export function alsepStation() {
  const g = group();
  const foil = FOIL();
  const white = WHITE_PAINT();
  const dark = DARK_METAL();

  g.add(box(2.6, 1.4, 2.0, foil, 0, 0.9, 0));
  g.add(box(3.0, 0.2, 2.4, dark, 0, 0.18, 0));
  for (const sx of [-1, 1]) {
    const panel = box(2.4, 0.12, 2.0, standard({ color: 0xd8d5cd, roughness: 0.4, metalness: 0.6 }), sx * 2.6, 1.7, 0);
    panel.rotation.z = sx * 0.35;
    g.add(panel);
  }
  g.add(cyl(0.05, 0.05, 3.2, white, 0, 3.2, 0, 8));
  g.add(cyl(0.9, 0.9, 0.12, white, 0, 4.7, 0, 16));

  // Seismometer, under its own foil sun shield.
  g.add(box(1.6, 0.9, 1.6, foil, 4.5, 0.55, 1.8));
  g.add(box(2.2, 0.1, 2.2, standard({ color: 0xe8e4d8, roughness: 0.7 }), 4.5, 1.1, 1.8));

  // Laser retroreflector: a panel of corner-cube prisms.
  const retro = box(2.0, 0.35, 1.4, dark, -4.6, 0.9, 1.6);
  retro.rotation.x = -0.4;
  g.add(retro);
  const prismParts = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      prismParts.push({
        geometry: new THREE.SphereGeometry(0.11, 8, 6),
        position: [-4.6 + (c - 2.5) * 0.3, 1.12 + r * 0.02, 1.6 + (r - 1.5) * 0.3],
        color: 0xbfe4f2,
      });
    }
  }
  g.add(mergedMesh(prismParts, { roughness: 0.1, metalness: 0.4 }));

  return g;
}

// A shallow impact crater: dished floor inside a raised ejecta rim, with the outer
// apron dropping below y=0 so it beds into whatever the terrain is doing underneath.
export function moonCrater({ radius = 14, rimHeight = 1.6, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const profile = [
    [0.0, 0.03],
    [0.35, 0.0],
    [0.6, 0.22],
    [0.78, rimHeight * 0.72],
    [0.9, rimHeight],
    [1.0, 0.05],
    [1.14, -1.0],
  ].map(([r, y]) => new THREE.Vector2(r * radius, y));

  const geometry = new THREE.LatheGeometry(profile, 48);
  // Rough up the rim so it does not read as a machined ring.
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y > 0.15) position.setY(i, y * randomIn(rng, 0.78, 1.22));
  }
  geometry.computeVertexNormals();

  const crater = mesh(geometry, standard({ color: 0x6b6862, roughness: 1, flatShading: true }));
  crater.castShadow = false;

  const floor = mesh(
    new THREE.CircleGeometry(radius * 0.55, 32),
    standard({ color: 0x4f4d48, roughness: 1 }),
    0,
    0.04,
    0
  );
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;

  return group(crater, floor);
}

// A field of boulders and small rocks, all merged into one geometry.
export function moonRocks({ count = 9, spread = 9, scale = 1, seed = 23 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // Deliberately darker than they look "correct" on paper. Lunar regolith reflects
  // only about 12% of the light hitting it -- roughly as dark as worn asphalt -- and
  // under this theme's very strong sun anything lighter blows out to white paper.
  const greys = [0x605d57, 0x4e4c47, 0x6d6a63, 0x3f3d39];

  for (let i = 0; i < count; i++) {
    const size = randomIn(rng, 0.35, 1.5) * scale;
    // roughenSphere, not per-vertex jitter: IcosahedronGeometry is non-indexed, so
    // randomising each vertex index pulls the triangles apart into loose shards. See
    // the note on roughenSphere() in PropKit.
    const geometry = roughenSphere(new THREE.IcosahedronGeometry(size, 1), {
      amount: 0.4,
      flatten: randomIn(rng, 0.62, 0.9),
      phase: i * 2.3,
    });

    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * spread;
    parts.push({
      geometry,
      position: [Math.cos(angle) * distance, size * 0.55, Math.sin(angle) * distance],
      rotation: [randomIn(rng, 0, 1), randomIn(rng, 0, 6.28), randomIn(rng, 0, 1)],
      color: greys[Math.floor(rng() * greys.length)],
    });
  }

  return group(mergedMesh(parts, { roughness: 1, flatShading: true }));
}

// A trail of boot prints pressed into the regolith. There is no wind or water on the
// Moon to erase them, which is why the Apollo prints are still there -- worth its own
// object so a placard can sit next to it.
export function bootprintTrail({ count = 8, seed = 5 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(128, 200, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(72,70,64,0.85)';
    ctx.beginPath();
    ctx.roundRect(14, 10, w - 28, h - 20, 26);
    ctx.fill();

    ctx.fillStyle = 'rgba(150,147,138,0.9)';
    for (let r = 0; r < 9; r++) {
      ctx.fillRect(24, 24 + r * 19, w - 48, 9);
    }
    for (let c = 0; c < 3; c++) {
      ctx.fillRect(30 + c * 24, 24, 6, h - 48);
    }
  });

  const material = standard({ map: texture, transparent: true, roughness: 1, depthWrite: false });
  const g = group();

  for (let i = 0; i < count; i++) {
    const print = mesh(new THREE.PlaneGeometry(0.55, 0.95), material.clone(), 0, 0, 0);
    print.rotation.x = -Math.PI / 2;
    print.rotation.z = randomIn(rng, -0.25, 0.25);
    print.position.set((i % 2 === 0 ? -0.42 : 0.42) + randomIn(rng, -0.1, 0.1), 0.05, -i * 1.5);
    print.castShadow = false;
    print.receiveShadow = false;
    g.add(print);
  }

  return g;
}

// Earth hanging in the lunar sky. Deliberately fog-exempt and part-emissive so it
// stays crisp and visible against the black regardless of where the sun is.
export function earthInSky({ radius = 20 } = {}) {
  const map = earthTexture(1024);
  const g = group();

  const planet = sphere(
    radius,
    standard({
      map,
      emissiveMap: map,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.55,
      roughness: 0.9,
      fog: false,
    }),
    0,
    0,
    0,
    48
  );
  planet.castShadow = false;
  planet.receiveShadow = false;
  planet.rotation.y = -0.9;
  g.add(planet);

  // Atmospheric limb: a backside-only shell, the same cheap trick the light orbs use.
  const halo = mesh(
    new THREE.SphereGeometry(radius * 1.09, 40, 24),
    new THREE.MeshBasicMaterial({
      color: 0x7fb6ff,
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
  );
  halo.castShadow = false;
  g.add(halo);

  return g;
}

// A forward-looking Artemis-style habitat: pressurised dome, airlock, and a tilted
// solar array. Gives the world something to say about where lunar exploration is going.
export function moonHabitat({ radius = 10, height = 14 } = {}) {
  const g = group();
  const shell = standard({ color: 0xe4e2db, roughness: 0.55, metalness: 0.15 });
  const dark = DARK_METAL();

  const dome = mesh(new THREE.SphereGeometry(radius, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), shell, 0, 0.6, 0);
  dome.scale.y = height / radius;
  g.add(dome);
  g.add(cyl(radius * 1.02, radius * 1.06, 1.2, dark, 0, 0.6, 0, 32));

  // Ribs, so the dome reads as an engineered pressure vessel.
  for (let i = 0; i < 8; i++) {
    const rib = mesh(new THREE.TorusGeometry(radius * 0.99, 0.12, 8, 32, Math.PI), dark, 0, 0.6, 0);
    rib.rotation.set(0, (i / 8) * Math.PI, Math.PI / 2);
    rib.scale.y = height / radius;
    g.add(rib);
  }

  // Airlock tube out the front, capped with a hatch ring.
  const tube = cyl(2.2, 2.2, 8, shell, 0, 3.2, radius * 0.7 + 3.4, 20);
  tube.rotation.x = Math.PI / 2;
  g.add(tube);
  const hatch = cyl(2.5, 2.5, 0.5, dark, 0, 3.2, radius * 0.7 + 7.3, 20);
  hatch.rotation.x = Math.PI / 2;
  g.add(hatch);

  // Viewports set into the dome wall. lookAt() aims an object's +Z at the target and
  // a cylinder's axis is +Y, so the extra rotateX(90 deg) swings the axis onto the
  // outward-facing direction -- the same pairing the lander's legs use.
  const glass = standard({ color: 0x9fd6f2, emissive: new THREE.Color(0x2f6f96), emissiveIntensity: 0.7, roughness: 0.15 });
  for (let i = 0; i < 5; i++) {
    const angle = -0.9 + i * 0.45;
    const px = Math.sin(angle) * radius * 0.95;
    const pz = Math.cos(angle) * radius * 0.95;
    const port = cyl(1.1, 1.1, 0.5, glass, px, 6.5, pz, 16);
    port.lookAt(new THREE.Vector3(px * 2, 6.5, pz * 2));
    port.rotateX(Math.PI / 2);
    g.add(port);
  }

  return g;
}

export function solarArray({ panels = 3, width = 7, height = 5 } = {}) {
  const g = group();
  const frame = standard({ color: 0xb9b6ae, roughness: 0.4, metalness: 0.6 });
  // Kept fairly rough and only lightly metallic, with a standing emissive floor. At
  // high metalness a panel has almost no diffuse response, so away from the sun it
  // renders as a featureless black slab rather than as blue solar cells.
  const cell = standard({
    color: 0x24457d,
    roughness: 0.45,
    metalness: 0.25,
    emissive: new THREE.Color(0x16294d),
    emissiveIntensity: 0.9,
  });

  g.add(box(width * panels + 1, 0.4, 2.4, frame, 0, 0.2, 0));
  g.add(cyl(0.22, 0.28, 4, frame, 0, 2, 0, 12));
  g.add(box(width * panels, 0.22, 0.5, frame, 0, 4, 0));

  for (let i = 0; i < panels; i++) {
    const x = -((panels - 1) * width) / 2 + i * width;
    const panel = box(width - 0.4, 0.14, height, cell, x, 4.6, height * 0.28);
    panel.rotation.x = -0.6;
    g.add(panel);
    // Bright surround so each panel reads as a framed module from either side.
    const border = box(width - 0.2, 0.1, height + 0.2, frame, x, 4.55, height * 0.28);
    border.rotation.x = -0.6;
    g.add(border);
  }

  return g;
}

// The commemorative plaque bolted to the LM's front leg.
export function lunarPlaque({ width = 3.4 } = {}) {
  const height = width * 0.62;
  const g = group();
  const metal = standard({ color: 0xb9b6ae, roughness: 0.35, metalness: 0.85 });

  g.add(cyl(0.5, 0.55, 0.14, metal, 0, 0.07, 0, 18));
  g.add(cyl(0.1, 0.12, 3.4, metal, 0, 1.7, 0, 12));

  const texture = canvasTexture(760, 470, (ctx, w, h) => {
    ctx.fillStyle = '#b9b6ae';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5f5c55';
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, w - 32, h - 32);

    ctx.fillStyle = '#3a3833';
    ctx.textAlign = 'center';
    ctx.font = 'bold 40px Georgia, serif';
    ctx.fillText('HERE HUMANS FROM', w / 2, 110);
    ctx.fillText('THE PLANET EARTH', w / 2, 158);
    ctx.font = 'bold 36px Georgia, serif';
    ctx.fillText('FIRST SET FOOT UPON THE MOON', w / 2, 224);
    ctx.fillText('JULY 1969, A.D.', w / 2, 274);
    ctx.font = 'italic 34px Georgia, serif';
    ctx.fillText('WE CAME IN PEACE FOR ALL MANKIND', w / 2, 360);
  });

  const face = signPanel(width, height, texture);
  const head = group(box(width + 0.1, height + 0.1, 0.07, metal), face);
  face.position.z = 0.04;
  head.position.y = 3.4 + height * 0.2;
  head.rotation.x = -Math.PI / 7;
  g.add(head);

  return g;
}
