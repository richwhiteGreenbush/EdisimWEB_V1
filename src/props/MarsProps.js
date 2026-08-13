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
  seededRandom,
  randomIn,
  roughenSphere,
  relief,
} from '../PropKit.js';
import { moonCrater, moonRocks } from './MoonProps.js';

// "On Mars" -- a rust-coloured plain with a theoretical crewed outpost on it. The
// hardware is deliberately near-future/fictional rather than a copy of any one mission
// concept, but every size is real against the 5ft student: the Habitation Dome is 20ft
// to its apex and 44ft across, the rover is about 10ft long (twice the student's
// height), and Ingenuity-class helicopter is barely knee-high.

// Painted hull plate, not bare metal -- fine orbital dust settles on everything here,
// which is exactly what a low-amplitude relief on a big pale panel looks like.
const HULL = () => standard({ color: 0xdedbd2, roughness: 0.55, metalness: 0.18, ...relief('metal', { seed: 37, repeat: 3, strength: 0.22 }) });
const DARK = () => standard({ color: 0x3b3e44, roughness: 0.45, metalness: 0.7, ...relief('metal', { seed: 43, repeat: 3 }) });
const TRIM = () => standard({ color: 0xb5502c, roughness: 0.6, metalness: 0.2, ...relief('metal', { seed: 47, repeat: 4 }) });
// Kept only lightly metallic with a standing emissive floor, for the same reason the
// Moon's arrays are: at high metalness a panel has almost no diffuse response and
// renders as a black slab whenever it is not facing the sun.
const CELL = () =>
  standard({
    color: 0x24457d,
    roughness: 0.45,
    metalness: 0.25,
    emissive: new THREE.Color(0x16294d),
    emissiveIntensity: 0.9,
  });

const CROP_GREENS = [0x4f8f3a, 0x6cae45, 0x3f7a33, 0x77bb4e];

// ---------------------------------------------------------------------------
// Shared canvas artwork
// ---------------------------------------------------------------------------

// The instrument-panel look every piece of base hardware wears: a title, then a stack
// of ruled readout lines. Shared so the drill, the life-support rack, the weather mast
// and the lander all read as parts of one base rather than four unrelated machines.
function techPanelTexture(title, readouts, { face = '#1b2430', accent = '#ff8a4c', ink = '#e8eef5' } = {}) {
  return canvasTexture(640, 400, (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    ctx.fillStyle = accent;
    ctx.font = 'bold 34px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText(String(title).toUpperCase(), 42, 76);

    ctx.font = '26px "Helvetica Neue", Arial, sans-serif';
    readouts.forEach((line, i) => {
      const y = 136 + i * 48;
      ctx.fillStyle = ink;
      ctx.fillText(line, 42, y);
      ctx.strokeStyle = 'rgba(232,238,245,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(42, y + 14);
      ctx.lineTo(w - 42, y + 14);
      ctx.stroke();
    });
  });
}

// ---------------------------------------------------------------------------
// The Habitation Dome
// ---------------------------------------------------------------------------

// Deck plating for the dome floor: concentric rings and radial seams. CircleGeometry's
// UVs map the disc into the unit square, so a pattern drawn concentrically on the
// canvas lands concentrically on the floor.
function deckTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    ctx.fillStyle = '#8f8b83';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#716d66';
    ctx.lineWidth = 3;
    for (let i = 1; i <= 7; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (i / 7) * cx * 0.99, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * cx, cy + Math.sin(a) * cy);
      ctx.stroke();
    }

    // Hazard ring around the middle of the floor, and a crew marshalling circle.
    ctx.strokeStyle = '#c4762f';
    ctx.lineWidth = 10;
    ctx.setLineDash([26, 18]);
    ctx.beginPath();
    ctx.arc(cx, cy, cx * 0.22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Mirrored on purpose. The floor is a CircleGeometry laid down by a -90 deg X
    // rotation, which flips the texture's handedness -- drawn the normal way round,
    // the word comes out backwards underfoot.
    ctx.save();
    ctx.scale(-1, 1);
    ctx.fillStyle = '#5f5b55';
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('MUSTER', -cx, cy + 10);
    ctx.restore();
  });
}

function domeSignTexture(label) {
  return canvasTexture(1024, 280, (ctx, w, h) => {
    ctx.fillStyle = '#241009';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#ff9a5c';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, w - 28, h - 28);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f6e7d8';
    ctx.font = 'bold 96px Georgia, "Times New Roman", serif';
    ctx.fillText(label, w / 2, 130);

    ctx.fillStyle = '#ff9a5c';
    ctx.font = '38px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('PRESSURIZED HABITAT · KEEP HATCHES SEALED', w / 2, 202);
  });
}

// The world's centrepiece: a pressurised dome a student can actually walk into, 20ft to
// the apex and 44ft across, with a doorway front and back so it is a place you pass
// THROUGH rather than a solid lump you walk around.
//
// **The glazing, the ribs and the apex hub all have castShadow = false, and that is the
// only reason there is daylight inside.** three.js has no light transmission through
// transparent materials, so whether the sun reaches an interior floor is decided purely
// by what casts into the shadow map -- exactly the same trick the museum's skylight and
// the library's lantern roof use. Make the shell cast and the interior goes black no
// matter how transparent the material is.
export function habitationDome({ radius = 22, height = 20, wallHeight = 5, label = 'MARS BASE ONE' } = {}) {
  const g = group();
  const dark = DARK();
  const trim = TRIM();
  const shell = standard({ color: 0xd8d4ca, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  const glass = standard({
    color: 0xbfe2f0,
    transparent: true,
    opacity: 0.3,
    roughness: 0.12,
    metalness: 0.1,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x2b5568),
    emissiveIntensity: 0.4,
  });
  const rise = height - wallHeight;

  // --- Base ring wall, opened by a doorway front (+Z) and back (-Z) ---------
  // CylinderGeometry lays its vertices out as (r sin0, y, r cos0), so theta = 0 is +Z
  // and the two arcs below are simply "the ring, minus the two door gaps".
  const doorHalf = Math.asin(3.6 / radius); // a ~7.2ft opening
  for (const start of [doorHalf, Math.PI + doorHalf]) {
    const length = Math.PI - doorHalf * 2;
    const segments = Math.max(10, Math.round((length / (Math.PI * 2)) * 64));
    const wall = mesh(
      new THREE.CylinderGeometry(radius, radius, wallHeight, segments, 1, true, start, length),
      shell,
      0,
      wallHeight / 2,
      0
    );
    // A smoothly curved, zero-thickness surface is the worst case for shadow-map acne,
    // and at this scale it shows up as wavy bands right across the wall inside and out.
    // The wall has no thickness to shadow itself with anyway, so it simply opts out.
    wall.receiveShadow = false;
    g.add(wall);
  }

  // Plinth and curb rings. Both are TORI, not discs: a solid cylinder here would cap the
  // dome and cancel every bit of the glazing above it.
  for (const [y, tube] of [
    [0.25, 0.3],
    [wallHeight, 0.26],
  ]) {
    const ring = mesh(new THREE.TorusGeometry(radius, tube, 8, 64), dark, 0, y, 0);
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = false;
    g.add(ring);
  }

  // --- Glazed upper dome ---------------------------------------------------
  const dome = mesh(new THREE.SphereGeometry(radius, 44, 22, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, wallHeight, 0);
  dome.scale.y = rise / radius;
  dome.castShadow = false;
  dome.receiveShadow = false;
  g.add(dome);

  // Structural ribs: twelve meridian arcs and two latitude hoops, all one mesh. The
  // meridian geometry is squashed BEFORE merging, since mergeColored only carries
  // position and rotation -- and a Y-scale survives a later Y-rotation unchanged.
  const ribParts = [];
  const squash = rise / radius;
  const ribColor = 0xbdb9af;
  for (let i = 0; i < 12; i++) {
    const meridian = new THREE.TorusGeometry(radius, 0.14, 6, 22, Math.PI / 2);
    meridian.scale(1, squash, 1);
    ribParts.push({ geometry: meridian, rotation: [0, (i / 12) * Math.PI * 2, 0], position: [0, wallHeight, 0], color: ribColor });
  }
  for (const phi of [0.5, 1.0]) {
    const hoop = new THREE.TorusGeometry(Math.cos(phi) * radius, 0.11, 6, 48);
    hoop.rotateX(Math.PI / 2);
    ribParts.push({ geometry: hoop, position: [0, wallHeight + Math.sin(phi) * rise, 0], color: ribColor });
  }
  const ribs = mergedMesh(ribParts, { roughness: 0.5, metalness: 0.5 });
  ribs.castShadow = false;
  g.add(ribs);

  const hub = cyl(1.7, 2.0, 0.6, dark, 0, height - 0.25, 0, 18);
  hub.castShadow = false;
  g.add(hub);

  // --- Floor ---------------------------------------------------------------
  // Laid at ground level rather than on a raised stylobate: the player walks on the
  // terrain mesh, not on props, so a raised interior floor would leave a student's eyes
  // sunk below the deck they appear to be standing on.
  const floor = mesh(
    new THREE.CircleGeometry(radius - 0.25, 64),
    standard({ map: deckTexture(), roughness: 0.85 }),
    0,
    0.08,
    0
  );
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  g.add(floor);

  // --- Door frames ---------------------------------------------------------
  const frameParts = [];
  for (const facing of [0, Math.PI]) {
    for (const side of [-1, 1]) {
      const a = facing + side * doorHalf;
      frameParts.push({
        geometry: new THREE.BoxGeometry(0.42, wallHeight, 0.7),
        rotation: [0, a, 0],
        position: [Math.sin(a) * radius, wallHeight / 2, Math.cos(a) * radius],
        color: 0xb5502c,
      });
    }
    frameParts.push({
      geometry: new THREE.BoxGeometry(radius * Math.sin(doorHalf) * 2 + 0.8, 0.5, 0.7),
      rotation: [0, facing, 0],
      position: [Math.sin(facing) * radius, wallHeight - 0.25, Math.cos(facing) * radius],
      color: 0xb5502c,
    });
  }
  g.add(mergedMesh(frameParts, { roughness: 0.6 }));

  // --- Airlock tube on the front door --------------------------------------
  const tubeR = 3.7;
  const tubeLength = 9;
  const tubeZ = radius + tubeLength / 2 - 1.2;
  const tube = mesh(new THREE.CylinderGeometry(tubeR, tubeR, tubeLength, 22, 1, true), shell, 0, tubeR, tubeZ);
  tube.rotation.x = Math.PI / 2;
  tube.receiveShadow = false; // same curved-surface shadow acne as the ring wall
  g.add(tube);
  g.add(box(5.2, 0.18, tubeLength, standard({ color: 0x6f6c66, roughness: 0.9 }), 0, 0.11, tubeZ));

  const mouthZ = radius + tubeLength - 1.2;
  const collar = mesh(new THREE.TorusGeometry(tubeR, 0.32, 8, 26), trim, 0, tubeR, mouthZ);
  g.add(collar); // a torus already lies in XY, so its axis is +Z -- no rotation needed

  // The hatch, standing open on its hinge. Parented to a group so the swing is a plain
  // Y-rotation applied after the disc has been stood upright -- and swung OUTWARD (a
  // positive rotation here), because a negative one carries the leaf back across the
  // tube's mouth and plugs the doorway the student is supposed to walk through.
  // There is deliberately no swung-open hatch leaf here. A 7ft disc standing on the
  // ground beside the tube is a big flat surface with one side permanently facing away
  // from the sun, so at every hinge angle tried it read as a dark blob parked at the
  // entrance rather than as a door. The collar ring alone says "hatch" perfectly well.

  // --- Signage on the wall, beside the front door --------------------------
  if (label) {
    const a = 0.62;
    const panel = signPanel(7, 1.9, domeSignTexture(label));
    panel.position.set(Math.sin(a) * (radius + 0.35), 3.0, Math.cos(a) * (radius + 0.35));
    panel.rotation.y = a;
    g.add(panel);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Habitat interior
// ---------------------------------------------------------------------------

// A hydroponic growing rack: crops in trays under magenta LED bars, no soil anywhere.
// The colour is the teaching point -- plants only use the red and blue parts of
// sunlight for photosynthesis, so a grow light skips the green it would waste.
export function hydroponicRack({ tiers = 3, width = 8, depth = 2.6, seed = 5 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const parts = [];
  const frameColor = 0xb9b5ab;
  const tierGap = 2.2;
  const postHeight = tiers * tierGap + 0.6;

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.18, postHeight, 0.18),
        position: [sx * (width / 2 - 0.15), postHeight / 2, sz * (depth / 2 - 0.15)],
        color: frameColor,
      });
    }
  }

  for (let t = 0; t < tiers; t++) {
    const y = 0.9 + t * tierGap;
    parts.push({ geometry: new THREE.BoxGeometry(width, 0.35, depth), position: [0, y, 0], color: 0xd6d2c8 });
    parts.push({
      geometry: new THREE.CylinderGeometry(0.11, 0.11, width, 10),
      rotation: [0, 0, Math.PI / 2],
      position: [0, y + 0.26, depth / 2 - 0.32],
      color: 0x9aa0a6,
    });

    const columns = Math.max(4, Math.round(width / 0.85));
    for (let c = 0; c < columns; c++) {
      const x = -width / 2 + 0.55 + (c * (width - 1.1)) / (columns - 1);
      for (const zOffset of [-depth * 0.22, depth * 0.22]) {
        const leaf = randomIn(rng, 0.24, 0.38);
        parts.push({
          geometry: new THREE.IcosahedronGeometry(leaf, 0),
          rotation: [rng() * 3, rng() * 3, rng() * 3],
          position: [x, y + 0.18 + leaf * 0.7, zOffset],
          color: CROP_GREENS[Math.floor(rng() * CROP_GREENS.length)],
        });
      }
    }
  }
  g.add(mergedMesh(parts, { roughness: 0.8, flatShading: true }));

  // The LED bars stay a separate mesh: they are the only emissive part, and tagging
  // them isGlowMesh lets a "change colour to" program block retint the glow itself
  // rather than just the housing.
  const ledParts = [];
  for (let t = 0; t < tiers; t++) {
    ledParts.push({
      geometry: new THREE.BoxGeometry(width - 0.6, 0.16, 0.34),
      position: [0, 0.9 + t * tierGap + 1.72, 0],
      color: 0xff7ad9,
    });
  }
  const leds = mergedMesh(ledParts, {
    roughness: 0.4,
    emissive: new THREE.Color(0xff4fc3),
    emissiveIntensity: 1.7,
  });
  leds.userData.isGlowMesh = true;
  leds.castShadow = false;
  g.add(leds);

  return g;
}

// Two-berth crew sleeping pod, open on its +Z face.
export function bunkPod({ width = 7, depth = 4.2, height = 7.4 } = {}) {
  const g = group();
  const parts = [];
  const shellColor = 0xdedbd2;
  const trimColor = 0x8c8880;

  parts.push({ geometry: new THREE.BoxGeometry(width, height, 0.24), position: [0, height / 2, -depth / 2], color: shellColor });
  parts.push({ geometry: new THREE.BoxGeometry(width, 0.24, depth), position: [0, height, 0], color: shellColor });
  parts.push({ geometry: new THREE.BoxGeometry(width, 0.24, depth), position: [0, 0.12, 0], color: trimColor });
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.24, height, depth),
      position: [sx * (width / 2 - 0.12), height / 2, 0],
      color: shellColor,
    });
  }

  // Two berths. The mattress is deliberately thick and light-toned and the curtain rail
  // sits right at the front edge: a thin dark pad on an open shelf reads as storage
  // racking, not as somewhere a person sleeps.
  for (const bunkY of [0.95, 4.2]) {
    parts.push({ geometry: new THREE.BoxGeometry(width - 0.7, 0.24, depth - 0.6), position: [0, bunkY, 0.1], color: trimColor });
    parts.push({ geometry: new THREE.BoxGeometry(width - 1.0, 0.62, depth - 0.9), position: [0, bunkY + 0.43, 0.1], color: 0xd2dae4 });
    // Blanket folded down over the foot of the bunk.
    parts.push({ geometry: new THREE.BoxGeometry(width - 1.0, 0.5, 1.5), position: [width / 2 - 1.4, bunkY + 0.5, 0.1], color: 0xb2563f });
    parts.push({ geometry: new THREE.BoxGeometry(1.7, 0.42, 1.2), position: [-width / 2 + 1.3, bunkY + 0.92, 0.1], color: 0xf1eee5 });
    // Padded head end, and the curtain rail with its curtain pushed to one side.
    parts.push({ geometry: new THREE.BoxGeometry(0.3, 1.6, depth - 0.9), position: [-width / 2 + 0.4, bunkY + 1.0, 0.1], color: 0x5c6470 });
    parts.push({
      geometry: new THREE.CylinderGeometry(0.06, 0.06, width - 0.6, 8),
      rotation: [0, 0, Math.PI / 2],
      position: [0, bunkY + 2.5, depth / 2 - 0.3],
      color: 0x9aa0a6,
    });
    // Light fabric, not navy: a dark curtain across a berth that is already in the
    // pod's own shadow just reads as a black hole in the side of the unit.
    parts.push({ geometry: new THREE.BoxGeometry(1.8, 2.3, 0.16), position: [width / 2 - 1.4, bunkY + 1.35, depth / 2 - 0.3], color: 0xc9a76a });
  }

  // Ladder up to the top berth.
  for (const sz of [-0.45, 0.45]) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.12, 4.4, 0.12),
      position: [width / 2 - 0.9, 2.6, sz + 1.2],
      color: 0x9aa0a6,
    });
  }
  for (let i = 0; i < 5; i++) {
    parts.push({
      geometry: new THREE.CylinderGeometry(0.06, 0.06, 1.0, 8),
      rotation: [Math.PI / 2, 0, 0],
      position: [width / 2 - 0.9, 1.1 + i * 0.8, 1.2],
      color: 0x9aa0a6,
    });
  }

  g.add(mergedMesh(parts, { roughness: 0.75 }));

  const readingLights = mergedMesh(
    [0.95, 4.2].map((bunkY) => ({
      geometry: new THREE.SphereGeometry(0.16, 10, 8),
      position: [width / 2 - 1.4, bunkY + 1.9, -depth / 2 + 0.55],
      color: 0xffe4b5,
    })),
    { emissive: new THREE.Color(0xffcf8a), emissiveIntensity: 1.8, roughness: 0.4 }
  );
  readingLights.userData.isGlowMesh = true;
  readingLights.castShadow = false;
  g.add(readingLights);

  return g;
}

// The machinery that actually keeps the dome alive: CO2 scrubbers turning Martian air
// into breathable oxygen, plus water storage. NASA's MOXIE really did make oxygen from
// Martian CO2 on Perseverance in 2021, which is what this is extrapolating from.
export function lifeSupportRack({ width = 8, height = 7 } = {}) {
  const g = group();
  const hull = HULL();
  // Mid-grey rather than DARK(): a 8x7ft slab at metalness 0.7 has almost no diffuse
  // response and, indoors under orb light, renders as a flat black hole in the room.
  const cabinet = standard({ color: 0x6d727b, roughness: 0.6, metalness: 0.3 });

  g.add(box(width, height, 2.4, cabinet, 0, height / 2, 0));
  g.add(box(width + 0.4, 0.4, 2.8, hull, 0, height, 0));
  g.add(box(width + 0.3, 0.3, 2.8, hull, 0, 0.15, 0));

  const face = signPanel(width - 1.2, 3.0, techPanelTexture('Life support', [
    'CO₂  SCRUBBER    NOMINAL',
    'O₂  OUTPUT       21.0 %',
    'PRESSURE         14.7 psi',
    'WATER RECLAIM    96 %',
  ]), { emissive: '#3a6f8c' });
  face.position.set(0, height * 0.62, 1.22);
  g.add(face);

  // Gas tanks either side, hooped like real pressure vessels.
  for (const sx of [-1, 1]) {
    g.add(cyl(1.0, 1.0, height - 1.2, hull, sx * (width / 2 + 1.3), (height - 1.2) / 2 + 0.3, 0, 18));
    g.add(cyl(1.06, 1.06, 0.22, TRIM(), sx * (width / 2 + 1.3), height * 0.35, 0, 18));
    g.add(cyl(1.06, 1.06, 0.22, TRIM(), sx * (width / 2 + 1.3), height * 0.72, 0, 18));
    const pipe = cyl(0.16, 0.16, width / 2 + 1.3, hull, (sx * (width / 2 + 1.3)) / 2, height - 0.6, 0.9, 10);
    pipe.rotation.z = Math.PI / 2;
    g.add(pipe);
  }

  const status = mesh(
    new THREE.SphereGeometry(0.18, 12, 8),
    standard({ color: 0xbfffd0, emissive: new THREE.Color(0x3ddb72), emissiveIntensity: 2.0, roughness: 0.3 }),
    width / 2 - 0.6,
    height - 0.7,
    1.25
  );
  status.userData.isGlowMesh = true;
  status.castShadow = false;
  g.add(status);

  return g;
}

// The base's command desk: a curved console with three live-looking readout screens.
export function commandConsole({ width = 8 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();

  g.add(box(width, 0.3, 2.6, hull, 0, 2.5, 0));
  g.add(box(width - 0.7, 2.3, 2.2, dark, 0, 1.25, 0));
  for (const sx of [-1, 1]) {
    const top = box(3.6, 0.3, 2.4, hull, sx * (width / 2 + 1.3), 2.5, -1.2);
    top.rotation.y = sx * 0.55;
    g.add(top);
    const under = box(3.2, 2.3, 2.0, dark, sx * (width / 2 + 1.3), 1.25, -1.2);
    under.rotation.y = sx * 0.55;
    g.add(under);
  }

  const screens = [
    {
      x: -2.9,
      rotY: 0.42,
      texture: techPanelTexture('Habitat', ['SOL              412', 'PRESSURE  14.7 psi', 'O₂            21.0 %', 'CREW        6 ABOARD']),
    },
    {
      x: 0,
      rotY: 0,
      texture: techPanelTexture('Outside now', ['TEMPERATURE   −67 °F', 'WIND          19 mph', 'AIR PRESSURE  0.6 % OF EARTH', 'DUST OPACITY  MODERATE']),
    },
    {
      x: 2.9,
      rotY: -0.42,
      texture: techPanelTexture('Link to Earth', ['DISTANCE   142 M MILES', 'SIGNAL DELAY  12 m 43 s', 'NEXT WINDOW   04:18', 'QUEUE      7 MESSAGES']),
    },
  ];

  for (const screen of screens) {
    g.add(cyl(0.1, 0.12, 1.4, dark, screen.x, 3.3, -0.4, 8));
    const panel = signPanel(2.7, 1.7, screen.texture, { emissive: '#6fc6ff' });
    panel.position.set(screen.x, 4.5, -0.3);
    panel.rotation.set(-0.12, screen.rotY, 0);
    g.add(panel);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Outside the dome
// ---------------------------------------------------------------------------

// An inflatable growing tunnel: a half-cylinder of glazing over two crop beds. Like the
// dome, its shell casts no shadow, which is the whole reason the beds inside are lit.
export function greenhouseTunnel({ length = 26, radius = 7, seed = 9 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const hull = HULL();
  const glass = standard({
    color: 0xcfeaf2,
    transparent: true,
    opacity: 0.26,
    roughness: 0.15,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x2f5f6e),
    emissiveIntensity: 0.35,
  });

  // Rotating the cylinder onto the Z axis maps its (sin0, y, cos0) layout to
  // (sin0, -cos0, y), so the UPPER half is theta = PI/2 .. 3PI/2.
  const shellMesh = mesh(
    new THREE.CylinderGeometry(radius, radius, length, 26, 1, true, Math.PI / 2, Math.PI),
    glass,
    0,
    0,
    0
  );
  shellMesh.rotation.x = Math.PI / 2;
  shellMesh.castShadow = false;
  shellMesh.receiveShadow = false;
  g.add(shellMesh);

  // Back wall is a solid half-disc; the front is a half ANNULUS, whose inner radius
  // leaves a walk-in doorway at the bottom centre without any geometry subtraction.
  const back = mesh(new THREE.CircleGeometry(radius, 26, 0, Math.PI), hull, 0, 0, -length / 2);
  back.castShadow = false;
  g.add(back);
  const front = mesh(new THREE.RingGeometry(3.2, radius, 26, 1, 0, Math.PI), hull, 0, 0, length / 2);
  front.castShadow = false;
  g.add(front);

  const collar = mesh(new THREE.TorusGeometry(3.2, 0.2, 8, 20, Math.PI), TRIM(), 0, 0, length / 2 + 0.05);
  collar.castShadow = false;
  g.add(collar);

  // Hoop ribs, and the two planting beds, all merged.
  const parts = [];
  for (let i = 0; i <= 5; i++) {
    const hoop = new THREE.TorusGeometry(radius, 0.1, 6, 24, Math.PI);
    parts.push({ geometry: hoop, position: [0, 0, -length / 2 + (i * length) / 5], color: 0xbdb9af });
  }
  for (const sx of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry(3.2, 1.5, length - 3),
      position: [sx * 3.0, 0.75, 0],
      color: 0xb9b5ab,
    });
    parts.push({
      geometry: new THREE.BoxGeometry(2.8, 0.4, length - 3.4),
      position: [sx * 3.0, 1.5, 0],
      color: 0x4a3527,
    });
    const rows = Math.floor((length - 4) / 1.3);
    for (let i = 0; i < rows; i++) {
      const z = -(length - 4) / 2 + i * 1.3;
      for (const offset of [-0.75, 0.75]) {
        const leaf = randomIn(rng, 0.3, 0.5);
        parts.push({
          geometry: new THREE.IcosahedronGeometry(leaf, 0),
          rotation: [rng() * 3, rng() * 3, rng() * 3],
          position: [sx * 3.0 + offset, 1.7 + leaf * 0.6, z],
          color: CROP_GREENS[Math.floor(rng() * CROP_GREENS.length)],
        });
      }
    }
  }
  const interior = mergedMesh(parts, { roughness: 0.8, flatShading: true });
  interior.castShadow = false;
  g.add(interior);

  return g;
}

// A rig drilling for the water ice buried under much of Mars. Water is the reason a
// real base would be sited over ice: it is drinking water, breathable oxygen, and --
// split into hydrogen and oxygen -- rocket propellant for the trip home.
export function iceDrillRig({ height = 16 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();

  // Derrick: four legs converging to a crown, plus cross-bracing. All one mesh.
  const parts = [];
  const spread = 3.4;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.14, 0.18, height, 8);
      parts.push({
        geometry: leg,
        rotation: [(-sz * spread) / height, 0, (sx * spread) / height],
        position: [(sx * spread) / 2, height / 2, (sz * spread) / 2],
        color: 0xb9b5ab,
      });
    }
  }
  for (let i = 1; i <= 4; i++) {
    const y = (i * height) / 5;
    const ringSize = spread * (1 - y / height / 1.6);
    for (const [rot, offset] of [
      [[0, 0, Math.PI / 2], [0, y, ringSize]],
      [[0, 0, Math.PI / 2], [0, y, -ringSize]],
      [[Math.PI / 2, 0, 0], [ringSize, y, 0]],
      [[Math.PI / 2, 0, 0], [-ringSize, y, 0]],
    ]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.07, 0.07, ringSize * 2, 6),
        rotation: rot,
        position: offset,
        color: 0x9aa0a6,
      });
    }
  }
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.4 }));

  g.add(box(3.0, 0.5, 3.0, dark, 0, height + 0.25, 0));
  g.add(cyl(0.3, 0.3, height - 1.5, dark, 0, (height - 1.5) / 2, 0, 12)); // drill string
  g.add(cyl(0.62, 0.42, 1.6, TRIM(), 0, 0.8, 0, 14)); // bit at the collar

  // Spoil heap thrown out beside the hole.
  const spoil = mesh(
    roughenSphere(new THREE.IcosahedronGeometry(3.4, 2), { amount: 0.34, flatten: 0.28, phase: 1.7 }),
    standard({ color: 0x6d3a22, roughness: 1, flatShading: true }),
    5.2,
    0.2,
    2.6
  );
  spoil.castShadow = false;
  g.add(spoil);

  // Core tubes racked up beside the rig -- the ice they pulled out.
  const cores = [];
  for (let i = 0; i < 6; i++) {
    cores.push({
      geometry: new THREE.CylinderGeometry(0.2, 0.2, 3.4, 10),
      rotation: [0, 0, 0.22],
      position: [-4.6 + i * 0.55, 1.9, -2.8],
      color: i % 2 === 0 ? 0xcfe9f5 : 0xa9cfe0,
    });
  }
  cores.push({ geometry: new THREE.BoxGeometry(4.4, 0.3, 1.0), position: [-3.2, 0.4, -2.8], color: 0x8c8880 });
  g.add(mergedMesh(cores, { roughness: 0.5 }));

  g.add(cyl(2.0, 2.0, 4.0, hull, -6.5, 2.0, 3.0, 20)); // water tank
  const label = signPanel(3.0, 1.9, techPanelTexture('Ice extraction', [
    'DEPTH        18 ft',
    'CORE TEMP    −58 °F',
    'YIELD        41 L / sol',
    'PURITY       98 %',
  ]));
  label.position.set(-6.5, 2.4, 5.05);
  g.add(label);

  return g;
}

// A dish aimed at Earth. Signals take between about 3 and 22 minutes each way depending
// on where the two planets are in their orbits, so nobody on Mars has a conversation
// with home -- they leave messages.
export function commsRelay({ height = 18 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();

  const parts = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.11, 0.14, height, 6),
        rotation: [(-sz * 1.9) / height, 0, (sx * 1.9) / height],
        position: [(sx * 1.9) / 2, height / 2, (sz * 1.9) / 2],
        color: 0xbdb9af,
      });
    }
  }
  for (let i = 1; i <= 5; i++) {
    const y = (i * height) / 6;
    const size = 1.9 * (1 - y / height / 1.5);
    parts.push({ geometry: new THREE.TorusGeometry(size, 0.06, 5, 4), rotation: [Math.PI / 2, Math.PI / 4, 0], position: [0, y, 0], color: 0x9aa0a6 });
  }
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.4 }));

  // Parabolic dish on a short pedestal at the mast head. Three things had to be right
  // here and all three were wrong at first:
  //   * a SHALLOW cap. A 67 deg sweep is a bowl, and its convex back reads as a solid
  //     black ball stuck on a pole.
  //   * the SOUTH cap, so the bowl opens upward. The north cap gives a dome, and its
  //     concave face points at the ground.
  //   * tipped so the approach sees the lit, concave side. The outside of a dish is a
  //     flat silhouette from every angle the sun is not directly behind.
  // The cap is authored around the sphere's south pole, so lifting the sphere centre by
  // exactly its radius puts the bowl's vertex on the mount origin -- without that the
  // dish floats several feet clear of the mast it is supposed to be bolted to.
  g.add(cyl(0.4, 0.52, 1.6, hull, 0, height + 0.3, 0, 12));

  const dishRadius = 7;
  const sweep = Math.PI / 5;
  const dishMaterial = standard({ color: 0xe4e1d8, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
  const mount = new THREE.Group();
  mount.position.set(0, height + 1.0, 0);
  mount.rotation.set(0.55, 0, 0.15);
  mount.add(
    mesh(
      new THREE.SphereGeometry(dishRadius, 30, 10, 0, Math.PI * 2, Math.PI - sweep, sweep),
      dishMaterial,
      0,
      dishRadius,
      0
    )
  );
  mount.add(cyl(0.1, 0.1, 3.2, dark, 0, 2.6, 0, 8)); // feed horn, up the dish axis
  mount.add(cyl(0.42, 0.42, 0.34, dark, 0, 4.35, 0, 10));
  g.add(mount);

  g.add(box(3.4, 2.6, 2.2, hull, 3.4, 1.3, 0));
  const panel = signPanel(2.4, 1.5, techPanelTexture('Deep space link', [
    'TARGET       EARTH',
    'DELAY        12 m 43 s',
    'DOWNLINK     2.1 Mbps',
    'STATUS       LOCKED',
  ]), { emissive: '#3a6f8c' });
  panel.position.set(3.4, 1.6, 1.12);
  g.add(panel);

  const beacon = mesh(
    new THREE.SphereGeometry(0.3, 12, 8),
    standard({ color: 0xffb0a0, emissive: new THREE.Color(0xff3b2f), emissiveIntensity: 2.2, roughness: 0.3 }),
    0,
    height + 0.6,
    0
  );
  beacon.userData.isGlowMesh = true;
  beacon.castShadow = false;
  g.add(beacon);

  return g;
}

// The cargo lander that delivered the base: a raised deck on four legs, with the ramp
// still down and crates still on it.
export function marsLander({ deckHeight = 7, deckRadius = 7 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();
  const foil = standard({
    color: 0xd9a83c,
    roughness: 0.32,
    metalness: 0.9,
    flatShading: true,
    emissive: new THREE.Color(0x2a1c05),
    emissiveIntensity: 0.5,
  });

  g.add(cyl(deckRadius, deckRadius, 1.1, foil, 0, deckHeight, 0, 8));
  g.add(cyl(deckRadius * 1.02, deckRadius * 1.02, 0.28, dark, 0, deckHeight + 0.6, 0, 8));

  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const padX = dx * (deckRadius + 3.4);
    const padZ = dz * (deckRadius + 3.4);

    const strutLength = Math.hypot(deckRadius + 3.4 - deckRadius * 0.7, deckHeight) * 1.06;
    const strut = cyl(0.2, 0.24, strutLength, hull);
    strut.position.set((padX + dx * deckRadius * 0.7) / 2, deckHeight / 2, (padZ + dz * deckRadius * 0.7) / 2);
    strut.lookAt(new THREE.Vector3(padX, 0.4, padZ));
    strut.rotateX(Math.PI / 2); // lookAt aims +Z; a cylinder's axis is +Y
    g.add(strut);
    g.add(cyl(1.4, 1.3, 0.34, hull, padX, 0.17, padZ, 14));
  }

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2;
    g.add(cyl(0.6, 1.1, 1.7, dark, Math.cos(angle) * 3.2, deckHeight - 1.3, Math.sin(angle) * 3.2, 14));
  }

  // Ramp down off the +Z edge, and cargo still waiting on the deck.
  const ramp = box(6.0, 0.3, Math.hypot(deckHeight, 9), standard({ color: 0x9aa0a6, roughness: 0.8 }), 0, deckHeight / 2, deckRadius + 4.0);
  ramp.rotation.x = Math.atan2(deckHeight, 9);
  g.add(ramp);

  g.add(box(3.0, 2.6, 3.0, hull, -2.2, deckHeight + 1.9, -1.4));
  g.add(box(2.2, 2.0, 2.4, TRIM(), 1.8, deckHeight + 1.6, 1.6));
  g.add(box(2.6, 1.6, 2.6, hull, 2.4, deckHeight + 1.4, -2.2));

  for (const sx of [-1, 1]) {
    const wing = box(6.5, 0.16, 4.2, CELL(), sx * (deckRadius + 3.2), deckHeight + 2.6, 0);
    wing.rotation.z = sx * 0.3;
    g.add(wing);
  }

  return g;
}

// A weather mast. The readings are the point: Martian air is about 0.6% of Earth's
// pressure, so a 60 mph wind there pushes about as hard as a 4 mph breeze here.
export function weatherMast({ height = 12 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();

  g.add(cyl(0.9, 1.1, 0.5, dark, 0, 0.25, 0, 14));
  g.add(cyl(0.14, 0.2, height, hull, 0, height / 2, 0, 12));

  // Anemometer: three cups on arms.
  const cups = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    cups.push({
      geometry: new THREE.CylinderGeometry(0.1, 0.1, 1.5, 6),
      rotation: [0, -angle, Math.PI / 2],
      position: [Math.cos(angle) * 0.75, height, Math.sin(angle) * 0.75],
      color: 0x9aa0a6,
    });
    cups.push({
      geometry: new THREE.SphereGeometry(0.34, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.6),
      rotation: [Math.PI / 2, 0, -angle],
      position: [Math.cos(angle) * 1.5, height, Math.sin(angle) * 1.5],
      color: 0xd6d2c8,
    });
  }
  cups.push({ geometry: new THREE.CylinderGeometry(0.2, 0.2, 0.4, 10), position: [0, height, 0], color: 0x9aa0a6 });
  g.add(mergedMesh(cups, { roughness: 0.6, metalness: 0.3 }));

  // Wind vane, a little lower down.
  const vane = box(0.08, 1.1, 1.8, standard({ color: 0xb5502c, roughness: 0.7 }), 0, height - 2.2, 1.3);
  g.add(vane);
  g.add(box(0.06, 0.1, 2.6, hull, 0, height - 2.2, 0.4));

  g.add(box(2.2, 2.0, 1.4, dark, 0, 1.6, 0.9));
  const panel = signPanel(1.8, 1.2, techPanelTexture('Weather', [
    'TEMP     −67 °F',
    'WIND      19 mph',
    'PRESSURE  0.09 psi',
    'DUST      MODERATE',
  ]), { emissive: '#3a6f8c' });
  panel.position.set(0, 1.7, 1.62);
  g.add(panel);

  const solar = box(2.4, 0.1, 1.6, CELL(), 0, height - 4.2, 0.9);
  solar.rotation.x = -0.5;
  g.add(solar);

  return g;
}

// ---------------------------------------------------------------------------
// The rover and the helicopter
// ---------------------------------------------------------------------------

// One rover wheel: a rolled-aluminium drum with grouser cleats around it. Real Mars
// rover wheels are metal, not rubber -- rubber would go brittle at −100 F and outgas in
// near-vacuum. Merged, so six wheels cost six draw calls rather than sixty.
//
// Built with its AXLE ALONG X, like the Moon's wire wheels; the caller yaws it. A
// rotation of `a` about X maps +Y to (0, cos a, sin a), which is what puts each cleat
// at its angle around the rim.
function roverWheel(radius, width) {
  const parts = [];
  const rim = 0xc4c0b6;

  parts.push({
    geometry: new THREE.CylinderGeometry(radius, radius, width, 24, 1, true),
    rotation: [0, 0, Math.PI / 2],
    color: rim,
  });
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.CylinderGeometry(radius * 0.96, radius * 0.96, 0.08, 24),
      rotation: [0, 0, Math.PI / 2],
      position: [(side * width) / 2, 0, 0],
      color: 0xa8a49a,
    });
  }
  parts.push({
    geometry: new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, width + 0.3, 14),
    rotation: [0, 0, Math.PI / 2],
    color: 0x6e7076,
  });

  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    parts.push({
      geometry: new THREE.BoxGeometry(width * 0.98, 0.09, 0.3),
      rotation: [angle, 0, 0],
      position: [0, Math.cos(angle) * radius, Math.sin(angle) * radius],
      color: 0x8d8a83,
    });
  }

  // Curved compliant spokes, the springy "wheel within a wheel" that gives these
  // wheels their suspension.
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.06, radius * 0.68, 0.1),
        rotation: [angle + 0.35, 0, 0],
        position: [(side * width) / 3, Math.cos(angle) * radius * 0.62, Math.sin(angle) * radius * 0.62],
        color: 0xb0aca2,
      });
    }
  }

  return mergedMesh(parts, { roughness: 0.7, metalness: 0.35 });
}

// A six-wheeled science rover on a rocker-bogie suspension, about 10ft long -- twice
// the height of the student looking at it, which is the size lesson.
export function marsRover({ length = 10 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();

  const wheelRadius = 0.85;
  const wheelWidth = 1.3;
  const track = 4.6; // wheel centre to wheel centre, across
  const deckY = wheelRadius + 1.5;

  // Warm electronics box, with its slanted radiator top.
  g.add(box(length * 0.66, 2.0, track * 0.82, hull, 0, deckY, 0));
  g.add(box(length * 0.7, 0.24, track * 0.86, dark, 0, deckY + 1.1, 0));
  g.add(box(length * 0.3, 0.5, track * 0.7, dark, -length * 0.16, deckY + 1.35, 0));

  const wheelX = [-length * 0.34, 0, length * 0.34];
  for (const x of wheelX) {
    for (const sz of [-1, 1]) {
      const z = (sz * track) / 2;
      const wheel = roverWheel(wheelRadius, wheelWidth);
      wheel.rotation.y = Math.PI / 2;
      wheel.position.set(x, wheelRadius, z);
      g.add(wheel);

      // Rocker-bogie strut from the body down to each hub.
      const strut = cyl(0.1, 0.12, Math.hypot(Math.abs(x) * 0.55 + 0.6, deckY - wheelRadius) * 1.1, hull);
      strut.position.set(x * 0.7, (deckY + wheelRadius) / 2 - 0.2, z * 0.78);
      strut.lookAt(new THREE.Vector3(x, wheelRadius, z));
      strut.rotateX(Math.PI / 2);
      g.add(strut);
    }
    if (x !== 0) {
      for (const sz of [-1, 1]) {
        const beam = cyl(0.11, 0.11, length * 0.36, hull, x / 2, deckY - 0.9, ((sz * track) / 2) * 0.86, 8);
        beam.rotation.z = Math.PI / 2;
        g.add(beam);
      }
    }
  }

  // Camera mast. The head goes ON TOP of the mast, about 7.5ft up -- roughly where a
  // tall adult's eyes would be, since these rovers are deliberately built to see a
  // scene the way a standing human would.
  const mastX = -length * 0.24;
  const mastBase = deckY + 1.2;
  const mastTop = mastBase + 4.2;
  g.add(cyl(0.16, 0.2, 4.2, hull, mastX, mastBase + 2.1, 1.2, 10));
  g.add(box(2.1, 0.85, 0.75, hull, mastX, mastTop + 0.4, 1.2));
  for (const sx of [-0.68, 0.68]) {
    const eye = cyl(0.21, 0.21, 0.36, standard({ color: 0x1a2b38, roughness: 0.15, metalness: 0.7 }), mastX + sx, mastTop + 0.4, 1.6);
    eye.rotation.x = Math.PI / 2;
    g.add(eye);
  }
  g.add(box(0.5, 0.3, 0.4, dark, mastX, mastTop + 0.95, 1.2));

  // Robotic arm, reaching out over the ground in front, with its instrument turret on
  // the end. Every joint is kept above ~0.6ft: hung any lower the turret sinks into
  // the regolith and reads as a stray part lying beside the rover.
  const shoulderX = length * 0.3;
  g.add(cyl(0.3, 0.3, 0.7, dark, shoulderX, deckY - 0.15, 1.0, 12));
  const upper = box(3.0, 0.38, 0.38, hull, shoulderX + 1.2, deckY - 0.25, 1.0);
  upper.rotation.z = -0.55;
  g.add(upper);
  const fore = box(2.4, 0.32, 0.32, hull, shoulderX + 2.6, deckY - 1.05, 1.0);
  fore.rotation.z = 0.35;
  g.add(fore);
  g.add(cyl(0.42, 0.42, 0.6, dark, shoulderX + 3.6, deckY - 1.3, 1.0, 12));

  // Nuclear battery: a finned drum slung off the tail, its axis ALONG the rover rather
  // than raked across it. Tilted the other way it skewers the chassis diagonally and
  // reads as a pipe run through the vehicle rather than as a fitting bolted to it.
  const rtgX = -length * 0.44;
  const rtgY = deckY + 0.6;
  const rtgColor = 0x8f9298;
  g.add(box(0.9, 0.5, 1.5, hull, -length * 0.34, rtgY, 0));
  const rtgParts = [
    { geometry: new THREE.CylinderGeometry(0.72, 0.72, 2.6, 16), rotation: [0, 0, Math.PI / 2], position: [rtgX, rtgY, 0], color: rtgColor },
  ];
  for (let i = 0; i < 8; i++) {
    rtgParts.push({
      geometry: new THREE.BoxGeometry(2.3, 0.07, 0.62),
      rotation: [(i / 8) * Math.PI * 2, 0, 0],
      position: [rtgX, rtgY, 0],
      color: 0xa5a8ae,
    });
  }
  g.add(mergedMesh(rtgParts, { roughness: 0.6, metalness: 0.45 }));

  // Flat high-gain antenna up top.
  const antenna = box(1.9, 0.12, 1.9, standard({ color: 0xdedbd2, roughness: 0.5, metalness: 0.3 }), length * 0.12, deckY + 1.8, -1.1);
  antenna.rotation.set(-0.35, 0.4, 0);
  g.add(antenna);
  g.add(cyl(0.1, 0.12, 0.9, hull, length * 0.12, deckY + 1.4, -1.1, 8));

  return g;
}

// The scout helicopter on its pad. Barely knee-high, and its rotors are enormous
// relative to it: Martian air is so thin that Ingenuity had to spin its blades at about
// 2,400 rpm -- roughly five times a helicopter on Earth -- just to get off the ground.
export function marsHelicopter({ rotorSpan = 4 } = {}) {
  const g = group();
  const hull = HULL();
  const dark = DARK();

  const pad = mesh(
    new THREE.CircleGeometry(4.4, 40),
    standard({
      map: canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#5c5852';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#e8e2d6';
        ctx.lineWidth = 9;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#e8e2d6';
        ctx.textAlign = 'center';
        ctx.font = 'bold 84px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText('H', w / 2, h / 2 + 30);
      }),
      roughness: 0.95,
    }),
    0,
    0.05,
    0
  );
  pad.rotation.x = -Math.PI / 2;
  pad.castShadow = false;
  g.add(pad);

  const bodyY = 1.15;
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const leg = cyl(0.035, 0.045, 1.5, dark, Math.cos(angle) * 0.5, bodyY / 2, Math.sin(angle) * 0.5, 6);
    leg.rotation.set(Math.sin(angle) * 0.45, 0, -Math.cos(angle) * 0.45);
    g.add(leg);
  }

  g.add(box(0.9, 0.7, 0.55, hull, 0, bodyY + 0.35, 0));
  g.add(cyl(0.05, 0.05, 1.5, dark, 0, bodyY + 1.3, 0, 8));
  g.add(box(1.5, 0.05, 0.9, CELL(), 0, bodyY + 2.15, 0));

  // Two coaxial rotors, counter-rotating on the real machine, offset here so both read.
  const blades = [];
  for (const [y, twist] of [
    [bodyY + 1.72, 0],
    [bodyY + 2.0, Math.PI / 2],
  ]) {
    for (let i = 0; i < 2; i++) {
      blades.push({
        geometry: new THREE.BoxGeometry(rotorSpan, 0.05, 0.3),
        rotation: [0, twist + (i * Math.PI) / 2, 0],
        position: [0, y, 0],
        color: 0xd6d2c8,
      });
    }
    blades.push({ geometry: new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10), position: [0, y, 0], color: 0x6e7076 });
  }
  g.add(mergedMesh(blades, { roughness: 0.6, metalness: 0.3 }));

  return g;
}

// Wheel tracks pressed into the dust. Mars does have wind, so unlike the Moon's boot
// prints these do eventually blur away -- over years, not minutes.
export function roverTracks({ count = 12, seed = 5, gauge = 4.6 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(96, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(84,44,26,0.42)';
    ctx.fillRect(8, 6, w - 16, h - 12);
    ctx.fillStyle = 'rgba(150,96,64,0.5)';
    for (let r = 0; r < 5; r++) ctx.fillRect(12, 12 + r * 24, w - 24, 11);
  });

  // All the prints merge into ONE mesh. Left as individual planes -- the way the Moon's
  // boot prints are -- a 20-print trail is 40 draw calls of two triangles each, which is
  // most of a prop's budget spent on tyre marks.
  //
  // The vertex colours are pure white on purpose: a material carrying BOTH a map and
  // vertexColors multiplies the two, so anything other than white would tint the tread
  // texture on top of itself.
  const parts = [];
  for (let i = 0; i < count; i++) {
    for (const sz of [-1, 1]) {
      parts.push({
        geometry: new THREE.PlaneGeometry(1.25, 1.0),
        rotation: [-Math.PI / 2, randomIn(rng, -0.08, 0.08), 0],
        position: [(sz * gauge) / 2 + randomIn(rng, -0.12, 0.12), 0.05, -i * 1.15],
        color: 0xffffff,
      });
    }
  }

  const trail = mergedMesh(parts, { map: texture, transparent: true, roughness: 1, depthWrite: false });
  trail.castShadow = false;
  trail.receiveShadow = false;

  return group(trail);
}

// ---------------------------------------------------------------------------
// Landscape
// ---------------------------------------------------------------------------

// A dust devil: a column of lifted dust that really does wander across Martian plains,
// and which has more than once cleaned a rover's solar panels for free. Click it and
// give it a "rotate forever" block -- that is the intended lesson here.
// `color` and `tint` are options because the Dinosaur Island world reuses this builder
// as a volcanic smoke plume -- a lifted column of particles is the same soft shape
// whichever planet it is on, and only the palette changes.
export function dustDevil({ height = 40, radius = 6, seed = 3, color = 0xd6a074, tint = '214,150,104' } = {}) {
  const rng = seededRandom(seed);
  const g = group();

  // Every streak is a soft-edged ellipse filled with a gradient that fades to nothing
  // at both ends, and the whole sheet is then faded top and bottom. Painted RECTANGLES
  // -- the obvious way to draw dust -- do not survive being wrapped around a 40ft
  // cylinder: they read as literal floating panels hanging over the landscape.
  const texture = canvasTexture(256, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 150; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const length = 40 + rng() * 190;
      const width = 8 + rng() * 30;
      const alpha = 0.06 + rng() * 0.2 * (1 - y / h);
      const grad = ctx.createLinearGradient(0, y, 0, y + length);
      grad.addColorStop(0, `rgba(${tint},0)`);
      grad.addColorStop(0.5, `rgba(${tint},${alpha.toFixed(3)})`);
      grad.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y + length / 2, width / 2, length / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Canvas y=0 lands at the TOP of the cylinder, where a dust devil is most diffuse.
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,0.08)');
    fade.addColorStop(0.35, 'rgba(0,0,0,0.85)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  });

  const dust = () =>
    standard({
      map: texture,
      color,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 1,
    });

  const column = mesh(
    new THREE.CylinderGeometry(radius * 1.25, radius * 0.3, height, 26, 6, true),
    dust(),
    0,
    height / 2,
    0
  );
  column.castShadow = false;
  column.receiveShadow = false;
  g.add(column);

  const skirt = mesh(new THREE.ConeGeometry(radius * 1.1, radius * 0.75, 24, 1, true), dust(), 0, radius * 0.38, 0);
  skirt.material.opacity = 0.28;
  skirt.castShadow = false;
  skirt.receiveShadow = false;
  g.add(skirt);

  return g;
}

// Phobos, the larger of the two Martian moons -- a captured-asteroid-looking lump only
// about 14 miles across. It orbits so fast that from the surface it rises in the WEST
// and sets in the east, twice every day. Fog-exempt and part-emissive so it stays
// readable against the dusty sky, exactly like Earth in the Moon world.
export function phobosInSky({ radius = 9 } = {}) {
  const geometry = roughenSphere(new THREE.IcosahedronGeometry(radius, 3), { amount: 0.4, flatten: 0.86, phase: 2.1 });

  // Stickney, the huge crater on one end: pulled in as a smooth function of DIRECTION,
  // for the same reason roughenSphere is -- this geometry is non-indexed, so anything
  // keyed to vertex index would tear the surface apart.
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  const axis = new THREE.Vector3(0.82, 0.24, 0.52).normalize();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const alignment = Math.max(0, p.clone().normalize().dot(axis));
    p.multiplyScalar(1 - 0.3 * Math.pow(alignment, 6));
    position.setXYZ(i, p.x, p.y, p.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  const map = standard({
    color: 0xa89e92,
    roughness: 1,
    flatShading: true,
    emissive: new THREE.Color(0x7d746a),
    emissiveIntensity: 0.55,
    fog: false,
  });
  const moon = mesh(geometry, map);
  moon.castShadow = false;
  moon.receiveShadow = false;
  moon.rotation.set(0.3, -0.7, 0.15);

  return group(moon);
}

// A shield volcano on the horizon. Olympus Mons is the tallest in the solar system --
// about 16 miles high and roughly the size of Arizona -- but its slopes are so gentle
// that standing on it you would not know you were on a mountain at all, which is why
// this profile is so wide and low.
// `baseRadius` should be several times `height`. A shield volcano built to the
// proportions of a hill -- roughly as wide as it is tall -- comes out as a sharp dark
// cone on the skyline, which is the one silhouette Mars does not have.
export function distantMountain({ height = 44, baseRadius = 130, caldera = true, color = 0xa05e38 } = {}) {
  const profile = [
    [0.0, caldera ? height - height * 0.09 : height],
    [0.07, caldera ? height - height * 0.09 : height],
    [0.11, height],
    [0.26, height * 0.79],
    [0.45, height * 0.55],
    [0.68, height * 0.28],
    [0.88, height * 0.09],
    [1.0, 0],
    [1.1, -8],
  ].map(([r, y]) => new THREE.Vector2(r * baseRadius, y));

  const mountain = mesh(
    new THREE.LatheGeometry(profile, 30),
    standard({ color, roughness: 1, flatShading: true })
  );
  // Beyond the shadow camera's useful range and far too big to self-shadow usefully;
  // leaving it out of both passes keeps a 60ft-tall backdrop nearly free.
  mountain.castShadow = false;
  mountain.receiveShadow = false;

  return group(mountain);
}

// Craters and rock fields are the Moon's, in Martian colours. The shapes are the same
// physics either way -- what changes is that Martian rock and dust are stained red by
// iron oxide, which is literally rust.
export function marsCrater(options = {}) {
  return moonCrater({ rimColor: 0x8a4a2e, floorColor: 0x5f331f, ...options });
}

export function marsRocks(options = {}) {
  return moonRocks({ colors: [0x8a4c2f, 0x6f3a24, 0x9c5c3a, 0x5a2f1d], ...options });
}
