import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergedMesh,
  mergeColored,
  canvasTexture,
  signPanel,
  taperedTube,
  roughenSphere,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "Telescope Observatory" -- a working research observatory on a dry hilltop, modelled from
// two photographs: the domed building from outside, and the telescope standing under the
// open shutter inside it.
//
// THE ONE STRUCTURAL DECISION EVERYTHING ELSE FOLLOWS FROM: the building is TWO props, not
// one. `observatoryDrum()` is the fixed part -- stone base, corrugated wall, door, the
// circular track round the top -- and `observatoryDome()` is the cap, which is a separate
// object placed on top of it and given a `rotate` program. That is not a modelling
// convenience, it is how a real observatory works: the dome turns and the building does not,
// and the telescope inside turns with the dome so the open slit stays in front of it. Both
// carry the same rotation rate in the layout, which is a detail worth more than it costs --
// a student who notices they move together has understood what a dome is FOR.
//
// The second thing worth knowing before editing: this is a building a student walks INTO,
// so it obeys the rules this project has already paid for.
//   * The floor is at GROUND LEVEL. PlayerController walks on the terrain mesh and never on
//     props, so a raised observing floor would put a student's eyes below the deck they
//     appear to be standing on.
//   * The dome shell sets `castShadow = false`. There is no light transmission in three.js,
//     so the only thing that decides whether the sky reaches an interior floor is whether
//     something above it casts a shadow -- the museum skylight's lesson, at dome scale.
//   * The wall has a REAL opening. A door painted on a solid cylinder is a door nobody can
//     use, and this one is the way in.
//   * Curved zero-thickness shells set `receiveShadow = false`: they have no thickness to
//     shadow themselves with, and a smooth curved surface is the worst case for shadow-map
//     acne (the Mars dome, again).
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh materials
// per call, seededRandom never Math.random.

const WALL_TAN = 0xb0a087;
const WALL_TAN_DK = 0x8f8169;
const TRIM_GREEN = 0x2c5745;
const DOME_SILVER = 0xd8dde2;
const DOME_RIB = 0xbcc2c8;
const DOME_IN = 0xc9ccd0;
const FLAGSTONE = 0x8c8271;
const CONCRETE = 0x9b988e;
const CONCRETE_DK = 0x7d7a72;
const SCOPE_BLUE = 0x3b83b3;
const SCOPE_BLUE_DK = 0x2a6088;
const SCOPE_GREY = 0xa5aab0;
const SCOPE_CREAM = 0xd8d2c0;
const IRON = 0x272a2e;
const HAZARD = 0xd8ac25;
const SAGE = 0x4e6b3c;

// Where the door and the dome's shutter both sit: dead ahead of the prop's own +Z, which is
// the direction every prop in this project is authored to face. A layout that turns the drum
// to face the spawn therefore gets the door AND the slit pointing at the student with no
// second angle to keep in step.
const DOOR_HALF = 0.135; // radians; ~3.5ft of opening at a 13ft radius

// three.js's CylinderGeometry measures theta from +Z (x = r·sinθ, z = r·cosθ) while its
// SphereGeometry measures phi from -X (x = -r·cos φ·sin θ). Those two conventions are the
// single easiest thing to get wrong in this file -- a shutter built on the cylinder's
// convention comes out on the dome's left ear -- so the sphere's offset is written down once,
// here, and used everywhere.
const SPHERE_PHI_AT_PLUS_Z = Math.PI / 2;

// A partial ring of horizontal structure (a purlin, a track, a rail) with a gap left in it.
//
// A TorusGeometry sweeps its arc from +X toward +Y in its own XY plane; rotateX(PI/2) lays
// that down so the arc runs from +X toward +Z. So an arc of `arc` radians leaves its gap
// between `arc` and 2PI, and the azimuth `gapAt` that gap has to sit at is reached by
// turning the whole ring by (midGap - PI/2) about Y.
function gappedRing(radius, tube, arc, { gapAt = 0, segments = 64, radialSegments = 7 } = {}) {
  const t = new THREE.TorusGeometry(radius, tube, radialSegments, Math.max(8, Math.round(segments * (arc / (Math.PI * 2)))), arc);
  t.rotateX(Math.PI / 2);
  const midGap = (arc + Math.PI * 2) / 2;
  t.rotateY(midGap - Math.PI / 2 + gapAt);
  return t;
}

// ---------------------------------------------------------------------------
// 1. The drum -- the building the dome sits on
// ---------------------------------------------------------------------------

export function observatoryDrum({
  radius = 13,
  wallHeight = 11.5,
  seed = 7,
  interior = true,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const BASE_H = 2.5; // the stone course, straight off the photograph
  const stone = [];
  const wall = [];
  const trim = [];
  const concrete = [];

  // --- Flagstone base course ----------------------------------------------
  // Laid as individual stones in staggered courses, not as one grey band. Four courses of
  // random blocks is the difference between masonry and a plinth -- and the stagger matters
  // for the reason nestCutaway found: on a straight grid the vertical joints line up all the
  // way down and a wall of stone reads as pixel art.
  const COURSES = 4;
  for (let c = 0; c < COURSES; c++) {
    const h = BASE_H / COURSES;
    const y = h * (c + 0.5);
    const count = 34 + (c % 2 ? 3 : 0);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (c % 2 ? Math.PI / count : 0);
      if (Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI) < DOOR_HALF * 1.3) continue;
      const w = (Math.PI * 2 * radius / count) * randomIn(rng, 0.72, 0.95);
      const stoneGeom = new THREE.BoxGeometry(w, h * randomIn(rng, 0.82, 0.96), randomIn(rng, 0.5, 0.8));
      stoneGeom.translate(0, y, radius + 0.1);
      stoneGeom.rotateY(a);
      const shade = randomIn(rng, 0.82, 1.12);
      stone.push({ geometry: stoneGeom, color: new THREE.Color(FLAGSTONE).multiplyScalar(shade).getHex() });
    }
  }
  // A cap course, level, so the wall above it has something to sit on.
  stone.push({ geometry: gappedRing(radius + 0.16, 0.16, Math.PI * 2 - DOOR_HALF * 2.4, { gapAt: 0 }), position: [0, BASE_H + 0.02, 0], color: 0x9d9382 });
  g.add(mergedMesh(stone, { roughness: 0.95, ...relief('stone', { seed: seed + 1, repeat: 3 }) }));

  // --- Corrugated wall -----------------------------------------------------
  // The shell is DoubleSide because this building is entered: with FrontSide the wall simply
  // is not there from inside, and a student standing in the dome looks straight out at the
  // landscape through it.
  const shellH = wallHeight - BASE_H;
  const shell = new THREE.CylinderGeometry(radius, radius, shellH, 72, 1, true, DOOR_HALF, Math.PI * 2 - DOOR_HALF * 2);
  shell.translate(0, BASE_H + shellH / 2, 0);
  wall.push({ geometry: shell, color: WALL_TAN });
  // An inner lining a few inches in, in a paler shade: from inside, a working dome is a
  // lighter room than its outside suggests, and the two shells give the wall thickness at
  // the door reveal where a single one would show as paper.
  const lining = new THREE.CylinderGeometry(radius - 0.42, radius - 0.42, shellH, 72, 1, true, DOOR_HALF, Math.PI * 2 - DOOR_HALF * 2);
  lining.translate(0, BASE_H + shellH / 2, 0);
  wall.push({ geometry: lining, color: 0xc4bdb0 });

  // The corrugation itself: a vertical rib about every foot. This is what makes tan paint
  // read as sheet metal, and it is the only thing in the whole building that catches the low
  // sun as a highlight.
  const RIBS = 74;
  for (let i = 0; i < RIBS; i++) {
    const a = (i / RIBS) * Math.PI * 2;
    const signedA = ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(signedA) < DOOR_HALF + 0.03) continue;
    const rib = new THREE.CylinderGeometry(0.11, 0.11, shellH, 6);
    rib.translate(0, BASE_H + shellH / 2, radius + 0.06);
    rib.rotateY(a);
    wall.push({ geometry: rib, color: i % 2 ? WALL_TAN_DK : WALL_TAN });
  }
  g.add(mergedMesh(wall, {
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.32,
    side: THREE.DoubleSide,
    ...relief('metal', { seed: seed + 2, repeat: 6 }),
  }));

  // --- Door reveal, frame and steps ---------------------------------------
  // The jambs and lintel are separate solids rather than a box with a hole, because the wall
  // already has the hole in it -- this is the lining of a real opening.
  const doorW = radius * 2 * Math.sin(DOOR_HALF);
  const doorH = 7.2;
  for (const side of [-1, 1]) {
    const jamb = new THREE.BoxGeometry(0.34, doorH, 1.1);
    jamb.translate(side * (doorW / 2 + 0.14), doorH / 2, radius - 0.1);
    trim.push({ geometry: jamb, color: TRIM_GREEN });
  }
  trim.push({ geometry: new THREE.BoxGeometry(doorW + 0.9, 0.42, 1.1), position: [0, doorH + 0.2, radius - 0.1], color: TRIM_GREEN });
  // A small projecting hood over the door -- every one of these buildings has one, and it
  // gives the entrance a shadow line that says "this is the way in" from across the site.
  trim.push({ geometry: new THREE.BoxGeometry(doorW + 2.4, 0.3, 2.6), position: [0, doorH + 0.62, radius + 0.9], color: TRIM_GREEN });
  for (const side of [-1, 1]) {
    const brace = new THREE.BoxGeometry(0.16, 1.5, 1.5);
    brace.rotateX(-0.72);
    brace.translate(side * (doorW / 2 + 0.5), doorH - 0.3, radius + 0.7);
    trim.push({ geometry: brace, color: TRIM_GREEN });
  }
  // The green fascia band round the top of the wall, and the dome's running track above it.
  trim.push({ geometry: gappedRing(radius + 0.2, 0.34, Math.PI * 2, { gapAt: 0 }), position: [0, wallHeight - 0.5, 0], color: TRIM_GREEN });
  g.add(mergedMesh(trim, { roughness: 0.6, metalness: 0.3, ...relief('metal', { seed: seed + 3, repeat: 3 }) }));

  // The door leaf itself, standing open against the wall -- a shut door on a building a
  // student is meant to walk into is a closed sign.
  const leaf = group();
  const leafMat = standard({ color: 0xd7d3c8, roughness: 0.55, metalness: 0.25, ...relief('metal', { seed: seed + 4, repeat: 2 }) });
  const panel = box(doorW * 0.92, doorH - 0.35, 0.16, leafMat, 0, (doorH - 0.35) / 2, 0);
  leaf.add(panel);
  leaf.add(box(doorW * 0.55, 1.5, 0.06, standard({ color: 0x101820, roughness: 0.3, metalness: 0.1 }), 0, doorH * 0.72, 0.1));
  leaf.add(cyl(0.05, 0.05, 0.9, standard({ color: 0x8a8d92, roughness: 0.4, metalness: 0.6 }), doorW * 0.34, doorH * 0.45, 0.16, 8));
  leaf.position.set(-doorW / 2 - 0.2, 0, radius - 0.05);
  leaf.rotation.y = -1.9; // swung back flat against the wall
  g.add(leaf);

  // --- Concrete threshold and steps ---------------------------------------
  concrete.push({ geometry: new THREE.BoxGeometry(doorW + 3.4, 0.5, 3.2), position: [0, 0.25, radius + 1.5], color: CONCRETE });
  concrete.push({ geometry: new THREE.BoxGeometry(doorW + 4.2, 0.28, 1.5), position: [0, 0.14, radius + 3.6], color: CONCRETE_DK });
  if (interior) {
    // The observing floor: at ground level, deliberately (see the header note).
    concrete.push({ geometry: new THREE.CylinderGeometry(radius - 0.45, radius - 0.45, 0.18, 56), position: [0, 0.09, 0], color: 0x8e8b83 });
    // Painted joint lines, as shallow darker strips. A perfectly plain slab under a
    // telescope reads as a putting green.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      const joint = new THREE.BoxGeometry(0.1, 0.2, (radius - 0.5) * 2);
      joint.rotateY(a);
      joint.translate(0, 0.14, 0);
      concrete.push({ geometry: joint, color: 0x7c7a73 });
    }
  }
  g.add(mergedMesh(concrete, { roughness: 0.95, ...relief('stone', { seed: seed + 5, repeat: 5 }) }));

  // --- Wall furniture -----------------------------------------------------
  const kit = [];
  // A louvred vent -- a dome has to be at outside temperature before it opens, or the
  // telescope looks through its own rising heat. It is the least decorative object here and
  // the one a placard gets to explain.
  const ventA = 1.15;
  for (let i = 0; i < 7; i++) {
    const slat = new THREE.BoxGeometry(2.4, 0.16, 0.3);
    slat.rotateX(-0.5);
    slat.translate(0, BASE_H + 2.4 + i * 0.34, radius + 0.14);
    slat.rotateY(ventA);
    kit.push({ geometry: slat, color: 0x5b5648 });
  }
  const ventFrame = new THREE.BoxGeometry(2.9, 2.9, 0.22);
  ventFrame.translate(0, BASE_H + 3.4, radius + 0.02);
  ventFrame.rotateY(ventA);
  kit.push({ geometry: ventFrame, color: 0x494538 });
  // A meter cabinet and its conduit.
  const cab = new THREE.BoxGeometry(1.5, 2.0, 0.5);
  cab.translate(0, BASE_H + 2.6, radius + 0.2);
  cab.rotateY(-1.35);
  kit.push({ geometry: cab, color: 0x6f7378 });
  for (let i = 0; i < 9; i++) {
    const conduit = new THREE.CylinderGeometry(0.075, 0.075, 0.5, 6);
    conduit.translate(0, BASE_H + 1.6 - i * 0.24, radius + 0.16);
    conduit.rotateY(-1.35 + i * 0.012);
    kit.push({ geometry: conduit, color: 0x8b8f94 });
  }
  g.add(mergedMesh(kit, { roughness: 0.6, metalness: 0.35, ...relief('metal', { seed: seed + 6, repeat: 3 }) }));

  // --- The handrail beside the steps ---------------------------------------
  const rail = [];
  for (const side of [-1, 1]) {
    const x = side * (doorW / 2 + 1.5);
    rail.push({ geometry: new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), position: [x, 1.7, radius + 1.7] });
    rail.push({ geometry: new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), position: [x, 1.6, radius + 4.1] });
    const top = new THREE.CylinderGeometry(0.09, 0.09, 2.6, 8);
    top.rotateX(Math.PI / 2);
    top.translate(x, 3.3, radius + 2.9);
    rail.push({ geometry: top });
    const mid = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6);
    mid.rotateX(Math.PI / 2);
    mid.translate(x, 2.3, radius + 2.9);
    rail.push({ geometry: mid });
  }
  g.add(mergedMesh(rail.map((p) => ({ ...p, color: 0x9aa0a6 })), { roughness: 0.45, metalness: 0.55 }));

  // --- The building's name plate -------------------------------------------
  const plate = canvasTexture(640, 200, (ctx, w, h) => {
    ctx.fillStyle = '#1f2a35';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c9a45a';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f2e9d4';
    ctx.font = 'bold 52px Georgia, "Times New Roman", serif';
    ctx.fillText('EAST DOME', w / 2, 76);
    ctx.fillStyle = '#c9a45a';
    ctx.font = 'bold 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('36-INCH  REFLECTOR  ·  1962', w / 2, 122);
    ctx.fillStyle = '#9fb0c2';
    ctx.font = 'italic 23px Georgia, "Times New Roman", serif';
    ctx.fillText('Visitors welcome — mind the step', w / 2, 162);
    ctx.textAlign = 'left';
  });
  // A FLAT SIGN ON A ROUND WALL HAS TO BE TANGENT TO IT, and it has to be placed by AZIMUTH
  // rather than by x/z. This cost a rebuild: both wall signs were first positioned in
  // Cartesian coordinates with a hand-guessed yaw, and because a chord cuts INSIDE the circle
  // it joins, one end of each sign was buried in the corrugation -- the Greenbush wordmark came
  // out reading "GREENBUS", clipped dead straight by a wall it appeared to be mounted on.
  //
  // Mounted this way it cannot happen: a tangent line's points are all FURTHER from the axis
  // than the point it touches (sqrt(r² + d²) > r), so the ends stand a couple of inches proud
  // of the curve and nothing can sink into it. Note the yaw is the azimuth ITSELF, not its
  // negative -- CylinderGeometry measures theta from +Z as x = r·sinθ, z = r·cosθ, which is the
  // same convention an Object3D's rotation.y uses, so the two agree with no sign flip.
  const mount = (object3D, azimuth, y, standoff = 0.14) => {
    object3D.position.set(Math.sin(azimuth) * (radius + standoff), y, Math.cos(azimuth) * (radius + standoff));
    object3D.rotation.y = azimuth;
    g.add(object3D);
  };

  mount(signPanel(3.4, 1.06, plate, { emissive: '#ffffff', emissiveIntensity: 0.5 }), 0.315, 5.6);

  // --- The Greenbush sign, on the wall left of the door --------------------
  // Mounted on a standoff frame rather than painted flat on the corrugation, which is how a
  // real sign goes on a metal building -- and the standoff is what gives it a shadow line, so
  // it reads as a fixed sign rather than as a decal.
  //
  // The mark is DRAWN, not an image file. Every texture in this project is generated in code,
  // and it matters more than usual here: a `preset-prop` record carries only a name and its
  // options, so a world file that referenced a logo bitmap would either have to embed it (and
  // this world is meant to stay under a megabyte) or fetch it at load time and break wherever
  // that fetch fails.
  const sign = group();
  const board = canvasTexture(560, 378, greenbushMark);
  const signW = 5.0;
  const signH = signW * (378 / 560);
  sign.add(box(signW + 0.26, signH + 0.26, 0.16, standard({
    color: 0x3d4349, roughness: 0.6, metalness: 0.35, ...relief('metal', { seed: seed + 9, repeat: 2 }),
  }), 0, 0, -0.09));
  // Emissive, at the same strength as the nameplate: this world is at dusk and a white sign
  // that is only lit by a sunset behind it is a grey sign.
  const face = signPanel(signW, signH, board, { emissive: '#ffffff', emissiveIntensity: 0.55 });
  face.position.z = 0.005;
  sign.add(face);
  // Round to the LEFT of the door as a visitor faces the building: the drum's own +Z is the
  // door, a camera looking at it from +Z has -X on its left, and x = r·sin(azimuth) makes that
  // a negative angle. Far enough round to clear both the door frame (0.135 rad) and the sign's
  // own half width (atan(2.63 / 15) = 0.174).
  mount(sign, -0.40, 5.9, 0.18);

  return g;
}

// The Greenbush mark: three overlapping canopy discs over a spreading trunk, with the
// wordmark under it.
//
// Drawn rather than loaded, for the reason at the call site. Three things carry the
// resemblance and are worth keeping if this is ever adjusted: the three discs are DIFFERENT
// sizes and three different greens with the palest one in FRONT and lowest; the trunk spreads
// sideways far wider than it is tall, with a stub branch to the left; and both lines of type
// are widely letter-spaced, which is most of the wordmark's character.
export function greenbushMark(ctx, w, h) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const disc = (cx, cy, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // Back to front: upper-left largest, upper-right a shade darker, lower-centre palest.
  disc(w * 0.415, h * 0.215, w * 0.105, '#4f9d54');
  disc(w * 0.545, h * 0.170, w * 0.088, '#5cb35f');
  disc(w * 0.492, h * 0.320, w * 0.077, '#7cc47f');

  // The trunk: a slender branch rising left to right under the canopy, then spreading flat.
  // Drawn as a STROKE with a round cap rather than as a filled blob -- a filled outline at this
  // size reads as a mound of earth, and what makes the mark a tree is that the trunk is
  // visibly thinner than the discs it carries.
  ctx.strokeStyle = '#7a5330';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = h * 0.052;
  ctx.beginPath();
  ctx.moveTo(w * 0.318, h * 0.378);
  ctx.quadraticCurveTo(w * 0.408, h * 0.372, w * 0.462, h * 0.322);
  ctx.stroke();
  // The spur, pointing left and slightly up -- the one asymmetry in the mark.
  ctx.lineWidth = h * 0.036;
  ctx.beginPath();
  ctx.moveTo(w * 0.372, h * 0.376);
  ctx.quadraticCurveTo(w * 0.322, h * 0.336, w * 0.276, h * 0.344);
  ctx.stroke();
  // The base, spreading right and tapering away, which is what stops the trunk looking cut off.
  ctx.lineWidth = h * 0.044;
  ctx.beginPath();
  ctx.moveTo(w * 0.352, h * 0.398);
  ctx.quadraticCurveTo(w * 0.468, h * 0.418, w * 0.552, h * 0.400);
  ctx.stroke();
  ctx.lineWidth = h * 0.026;
  ctx.beginPath();
  ctx.moveTo(w * 0.520, h * 0.404);
  ctx.quadraticCurveTo(w * 0.586, h * 0.396, w * 0.628, h * 0.386);
  ctx.stroke();

  // Both lines are letter-spaced by hand. `ctx.letterSpacing` exists in current Chrome and
  // nowhere reliably else, and this app runs on school Chromebooks of unknown vintage -- so the
  // spacing is done by measuring and placing each character, which cannot silently no-op.
  const spaced = (text, size, weight, y, spacing, color) => {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px "Helvetica Neue", Arial, sans-serif`;
    const widths = [...text].map((ch) => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    let x = (w - total) / 2;
    [...text].forEach((ch, i) => {
      ctx.fillText(ch, x, y);
      x += widths[i] + spacing;
    });
  };
  spaced('GREENBUSH', Math.round(h * 0.155), 'bold', h * 0.685, w * 0.017, '#2c2c2c');
  spaced('THE EDUCATION SERVICE CENTER', Math.round(h * 0.058), 'normal', h * 0.845, w * 0.0105, '#3a3a3a');
}

// ---------------------------------------------------------------------------
// 2. The dome -- the cap that turns
// ---------------------------------------------------------------------------

// A galvanised ribbed dome with its shutter OPEN, built to be placed on top of a drum with
// an `absoluteY` and given a `rotate` program.
//
// The slit faces the prop's +Z, like the drum's door, so one yaw aims both.
export function observatoryDome({
  radius = 13.4,
  shutter = 0.30, // half-width of the slit, in radians
  seed = 9,
  skirt = 1.6,
} = {}) {
  const g = group();
  const shellParts = [];
  const ribParts = [];

  // --- The shell -----------------------------------------------------------
  // Everything below the gap. `phiStart` is offset by SPHERE_PHI_AT_PLUS_Z so the slit lands
  // on +Z rather than on the sphere's own phi = 0, which is out on -X.
  const shell = new THREE.SphereGeometry(
    radius, 72, 26,
    SPHERE_PHI_AT_PLUS_Z + shutter,
    Math.PI * 2 - shutter * 2,
    0, Math.PI / 2,
  );
  const shellMesh = mesh(shell, standard({
    color: DOME_SILVER,
    roughness: 0.42,
    metalness: 0.5,
    side: THREE.DoubleSide,
    ...relief('metal', { seed, repeat: 8 }),
  }));
  // castShadow off, or the dome caps the building and the interior goes black -- there is no
  // light transmission in three.js, so a shadow-caster IS an opaque roof. receiveShadow off
  // as well: a smooth curved zero-thickness shell is the worst case for shadow acne, and it
  // has no thickness to shadow itself with anyway.
  shellMesh.castShadow = false;
  shellMesh.receiveShadow = false;
  g.add(shellMesh);

  // A darker inner liner, a few inches in. Photo-real and useful: a single shell lit from
  // outside gives the interior a flat grey ceiling, and the liner picks up the orb light in
  // a different tone so the ribs below read against something.
  const liner = new THREE.SphereGeometry(
    radius - 0.3, 56, 20,
    SPHERE_PHI_AT_PLUS_Z + shutter, Math.PI * 2 - shutter * 2, 0, Math.PI / 2,
  );
  const linerMesh = mesh(liner, standard({ color: DOME_IN, roughness: 0.85, side: THREE.BackSide }));
  linerMesh.castShadow = false;
  linerMesh.receiveShadow = false;
  g.add(linerMesh);

  // --- Meridian ribs ------------------------------------------------------
  // A quarter torus is exactly a meridian arc: it sweeps from +X up to +Y in its own plane,
  // which is the equator-to-pole quarter circle. Turning it by (azimuth - PI/2) about Y puts
  // it on the meridian wanted.
  const RIBS = 30;
  for (let i = 0; i < RIBS; i++) {
    const az = (i / RIBS) * Math.PI * 2;
    const signed = ((az + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(signed) < shutter + 0.04) continue;
    for (const [r, tube, color] of [[radius + 0.11, 0.13, DOME_RIB], [radius - 0.42, 0.1, 0xb0b4b9]]) {
      const rib = new THREE.TorusGeometry(r, tube, 6, 16, Math.PI / 2);
      rib.rotateY(az - Math.PI / 2);
      ribParts.push({ geometry: rib, color });
    }
  }

  // --- Interior purlins ---------------------------------------------------
  // The horizontal rings that turn the ribs into the lattice a dome interior actually is.
  // Each is a small circle on the sphere: radius r·sin(t) at height r·cos(t).
  for (const t of [0.30, 0.58, 0.86, 1.14]) {
    const rr = (radius - 0.5) * Math.sin(t);
    const yy = (radius - 0.5) * Math.cos(t);
    const arc = Math.PI * 2 - shutter * 2.15;
    const purlin = gappedRing(rr, 0.085, arc, { gapAt: 0, segments: 60, radialSegments: 6 });
    purlin.translate(0, yy, 0);
    ribParts.push({ geometry: purlin, color: 0xa8acb1 });
  }

  // --- Apex ring ----------------------------------------------------------
  ribParts.push({ geometry: new THREE.CylinderGeometry(1.25, 1.45, 0.34, 24), position: [0, radius - 0.18, 0], color: DOME_RIB });
  ribParts.push({ geometry: new THREE.TorusGeometry(1.35, 0.12, 7, 24), rotation: [Math.PI / 2, 0, 0], position: [0, radius - 0.02, 0], color: 0xc4c8cc });

  // --- The shutter, drawn back --------------------------------------------
  // Two leaves parked flanking the slit at a slightly larger radius, with a lip along each
  // opening edge. It is what makes the gap read as an OPENED shutter rather than as a piece
  // of the dome that failed to render.
  for (const side of [-1, 1]) {
    const leaf = new THREE.SphereGeometry(
      radius + 0.34, 20, 20,
      SPHERE_PHI_AT_PLUS_Z + side * shutter + (side > 0 ? 0 : -0.30), 0.30,
      0.02, Math.PI / 2 - 0.02,
    );
    const leafMesh = mesh(leaf, standard({ color: 0x9ea4aa, roughness: 0.45, metalness: 0.5, side: THREE.DoubleSide }));
    leafMesh.castShadow = false;
    leafMesh.receiveShadow = false;
    g.add(leafMesh);
    // The raised edge rail the leaf runs on.
    const lip = new THREE.TorusGeometry(radius + 0.2, 0.16, 6, 20, Math.PI / 2);
    lip.rotateY(side * shutter - Math.PI / 2);
    ribParts.push({ geometry: lip, color: 0x878d93 });
  }

  // --- The base skirt and its bogies ---------------------------------------
  // The skirt is what overlaps the drum's track so no gap shows at the join, and the little
  // wheels under it are the only visible answer to "what is it standing on".
  const skirtGeom = new THREE.CylinderGeometry(radius + 0.22, radius + 0.22, skirt, 72, 1, true);
  skirtGeom.translate(0, -skirt / 2 + 0.15, 0);
  const skirtMesh = mesh(skirtGeom, standard({
    color: 0xa9aeb4, roughness: 0.5, metalness: 0.45, side: THREE.DoubleSide, ...relief('metal', { seed: seed + 1, repeat: 8 }),
  }));
  skirtMesh.castShadow = false;
  skirtMesh.receiveShadow = false;
  g.add(skirtMesh);
  ribParts.push({ geometry: new THREE.TorusGeometry(radius + 0.3, 0.18, 7, 60), rotation: [Math.PI / 2, 0, 0], position: [0, 0.1, 0], color: TRIM_GREEN });
  for (let i = 0; i < 8; i++) {
    const az = (i / 8) * Math.PI * 2 + 0.2;
    const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.26, 12);
    wheel.rotateZ(Math.PI / 2);
    wheel.translate(0, -skirt + 0.42, radius - 0.1);
    wheel.rotateY(az);
    ribParts.push({ geometry: wheel, color: IRON });
  }

  g.add(mergedMesh(ribParts, {
    color: 0xffffff, roughness: 0.45, metalness: 0.5, ...relief('metal', { seed: seed + 2, repeat: 4 }),
  }));

  // Two hazard-yellow marks on the skirt, 180 degrees apart: the dome's own azimuth index.
  for (const side of [0, Math.PI]) {
    const markGeom = new THREE.BoxGeometry(0.9, skirt * 0.7, 0.12);
    const markMesh = mesh(markGeom, standard({ color: HAZARD, roughness: 0.6, emissive: 0x2a1f00, emissiveIntensity: 0.8 }));
    markMesh.position.set(Math.sin(side) * (radius + 0.3), -skirt * 0.4, Math.cos(side) * (radius + 0.3));
    markMesh.rotation.y = side;
    markMesh.castShadow = false;
    g.add(markMesh);
  }

  return g;
}

// ---------------------------------------------------------------------------
// 3. The great telescope -- the hero
// ---------------------------------------------------------------------------

// A 24-inch equatorial reflector, built from the interior photograph: a concrete pier, a
// cream polar-axis housing, the big black toothed drive wheel, a counterweight shaft, and a
// blue open-truss tube with a grey mirror box at its foot.
//
// WHAT MAKES IT READ AS A RESEARCH TELESCOPE AND NOT AS A CARDBOARD TUBE ON A TRIPOD, in
// order of how much each one buys:
//
//  1. THE TUBE IS OPEN. A big reflector is a skeleton -- a mirror box at the bottom, a ring
//     at the top and eight struts between them -- because a closed tube traps warm air in
//     the light path and because the steel would weigh tons. Painting a solid cylinder blue
//     gets everything else right and still looks like a toy.
//  2. THE DRIVE WHEEL. The one part that says this thing is DRIVEN: a four-foot toothed
//     wheel on the polar axis, turning once a day against the sky's own turn. Everything
//     else on the mount is structure; this is the machine.
//  3. THE SPIDER AND THE SECONDARY. Four thin vanes across the top ring holding a small
//     mirror facing back down the tube. It is the whole optical principle in one detail, and
//     it is what a visitor looking up the open end actually sees.
//  4. THE COUNTERWEIGHTS. A telescope is balanced, not held; without the shaft and its two
//     black discs the tube reads as bolted to a post.
//
// It is built as NESTED GROUPS rather than one merged mesh, and deliberately: the tube
// assembly needs one rotation applied to every part in it, and mergeColored can only bake
// axis-aligned Euler rotations per part. A group whose rotation is set once is both simpler
// and impossible to get subtly wrong.
export function greatTelescope({
  aperture = 3.6, // tube diameter in feet -- a 36-inch mirror in its cell
  elevation = 38, // degrees above the horizon; aim it at the dome's slit
  latitude = 31,
  seed = 13,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const PIER_H = 4.6;
  const POLAR = THREE.MathUtils.degToRad(latitude);

  // --- Pier ---------------------------------------------------------------
  const pier = [];
  pier.push({ geometry: new THREE.BoxGeometry(7.4, 0.7, 7.4), position: [0, 0.35, 0], color: CONCRETE_DK });
  pier.push({ geometry: new THREE.BoxGeometry(6.2, 0.5, 6.2), position: [0, 0.95, 0], color: CONCRETE });
  pier.push({ geometry: new THREE.CylinderGeometry(2.0, 2.4, PIER_H - 1.2, 28), position: [0, (PIER_H - 1.2) / 2 + 1.2, 0], color: CONCRETE });
  pier.push({ geometry: new THREE.CylinderGeometry(2.3, 2.1, 0.42, 28), position: [0, PIER_H - 0.21, 0], color: 0x8d8a82 });
  // Anchor bolts round the top flange.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.11, 0.11, 0.3, 6);
    bolt.translate(Math.cos(a) * 1.95, PIER_H + 0.05, Math.sin(a) * 1.95);
    pier.push({ geometry: bolt, color: 0x5f6266 });
  }
  g.add(mergedMesh(pier, { roughness: 0.95, ...relief('stone', { seed, repeat: 4 }) }));

  // --- Mount base ---------------------------------------------------------
  const base = [];
  base.push({ geometry: new THREE.CylinderGeometry(1.9, 2.05, 0.55, 24), position: [0, PIER_H + 0.32, 0], color: SCOPE_BLUE_DK });
  base.push({ geometry: new THREE.BoxGeometry(3.4, 1.5, 2.6), position: [0, PIER_H + 1.3, 0], color: SCOPE_BLUE });
  // A cast wedge carrying the polar axis at the site's latitude -- the one angle on the
  // whole instrument that is not adjustable, because it is set by where the building is.
  const wedge = new THREE.BoxGeometry(2.6, 2.6, 1.9);
  wedge.rotateX(POLAR);
  wedge.translate(0, PIER_H + 2.6, 0);
  base.push({ geometry: wedge, color: SCOPE_BLUE });
  g.add(mergedMesh(base, { roughness: 0.5, metalness: 0.4, ...relief('metal', { seed: seed + 1, repeat: 3 }) }));

  // --- The polar axis assembly --------------------------------------------
  // Everything from here up is carried in `polar`, a group tipped to the latitude, so its
  // own +Y is the polar axis and nothing inside it has to know the angle.
  const polar = group();
  polar.position.set(0, PIER_H + 2.9, 0);
  // The axis points at the celestial pole: up by the latitude, toward -Z (north). Rotating
  // about X by -(90 - latitude) takes the group's +Y from vertical to that bearing.
  polar.rotation.x = -(Math.PI / 2 - POLAR);
  g.add(polar);

  const housing = [];
  housing.push({ geometry: new THREE.CylinderGeometry(1.25, 1.25, 5.4, 24), position: [0, 0, 0], color: SCOPE_CREAM });
  housing.push({ geometry: new THREE.CylinderGeometry(1.42, 1.42, 0.4, 24), position: [0, 2.5, 0], color: 0xc6c0ae });
  housing.push({ geometry: new THREE.CylinderGeometry(1.42, 1.42, 0.4, 24), position: [0, -2.5, 0], color: 0xc6c0ae });
  polar.add(mergedMesh(housing, { roughness: 0.55, metalness: 0.25, ...relief('metal', { seed: seed + 2, repeat: 3 }) }));

  // The drive wheel: a four-foot toothed disc on the axis, with spokes and a worm drive.
  const wheel = [];
  const WR = 3.0;
  wheel.push({ geometry: new THREE.CylinderGeometry(WR, WR, 0.16, 56), position: [0, -2.0, 0], color: IRON });
  wheel.push({ geometry: new THREE.CylinderGeometry(WR * 1.03, WR * 1.03, 0.34, 56, 1, true), position: [0, -2.0, 0], color: 0x1b1e21 });
  wheel.push({ geometry: new THREE.CylinderGeometry(0.85, 0.85, 0.52, 20), position: [0, -2.0, 0], color: 0x33373b });
  // Gear teeth. 96 of them, which is a plausible number for a worm wheel and also the thing
  // that makes it unmistakably a gear rather than a brake disc.
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const tooth = new THREE.BoxGeometry(0.11, 0.3, 0.22);
    tooth.translate(0, -2.0, WR * 1.04);
    tooth.rotateY(a);
    wheel.push({ geometry: tooth, color: 0x2c3034 });
  }
  // Spokes, as six lightening holes' worth of structure.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.42, 0.2, WR * 0.95);
    spoke.translate(0, -2.0, WR * 0.47);
    spoke.rotateY(a);
    wheel.push({ geometry: spoke, color: 0x3a3e42 });
  }
  polar.add(mergedMesh(wheel, { roughness: 0.55, metalness: 0.5, ...relief('metal', { seed: seed + 3, repeat: 3 }) }));

  // The worm gearbox and its motor, hanging off the wheel's rim.
  const drive = [];
  drive.push({ geometry: new THREE.BoxGeometry(1.0, 0.9, 1.6), position: [0, -2.0, WR + 0.75], color: SCOPE_BLUE_DK });
  drive.push({ geometry: new THREE.CylinderGeometry(0.34, 0.34, 1.1, 14), rotation: [Math.PI / 2, 0, 0], position: [0, -2.0, WR + 1.9], color: 0x4b5055 });
  drive.push({ geometry: new THREE.BoxGeometry(0.7, 0.7, 0.5), position: [0, -1.2, WR + 0.9], color: 0x2f3338 });
  polar.add(mergedMesh(drive, { roughness: 0.5, metalness: 0.5 }));

  // --- The declination axis ------------------------------------------------
  // Perpendicular to the polar axis, carrying the tube on one side and the counterweights on
  // the other. Held in its own group so the tube can be swung in declination.
  const dec = group();
  dec.position.set(0, 1.5, 0);
  polar.add(dec);

  const decParts = [];
  decParts.push({ geometry: new THREE.CylinderGeometry(0.85, 0.85, 6.6, 20), rotation: [0, 0, Math.PI / 2], position: [0, 0, 0], color: SCOPE_BLUE });
  decParts.push({ geometry: new THREE.CylinderGeometry(1.0, 1.0, 0.4, 20), rotation: [0, 0, Math.PI / 2], position: [1.9, 0, 0], color: SCOPE_BLUE_DK });
  // The declination setting circle: a graduated disc, which is how a telescope was pointed
  // before there was a computer to do it.
  decParts.push({ geometry: new THREE.CylinderGeometry(1.5, 1.5, 0.1, 40), rotation: [0, 0, Math.PI / 2], position: [-2.0, 0, 0], color: 0xb9b3a2 });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const tick = new THREE.BoxGeometry(0.12, 0.32, 0.06);
    tick.translate(0, 1.36, 0);
    tick.rotateX(a);
    tick.rotateZ(Math.PI / 2);
    tick.translate(-2.06, 0, 0);
    decParts.push({ geometry: tick, color: i % 9 === 0 ? 0x2a2a2a : 0x6a6a6a });
  }
  dec.add(mergedMesh(decParts, { roughness: 0.5, metalness: 0.4, ...relief('metal', { seed: seed + 4, repeat: 3 }) }));

  // Counterweight shaft and its two discs, out on the far side.
  const weights = [];
  weights.push({ geometry: new THREE.CylinderGeometry(0.32, 0.32, 4.6, 14), rotation: [0, 0, Math.PI / 2], position: [-5.0, 0, 0], color: 0x8d9298 });
  for (const x of [-4.3, -5.6]) {
    weights.push({ geometry: new THREE.CylinderGeometry(1.15, 1.15, 0.66, 24), rotation: [0, 0, Math.PI / 2], position: [x, 0, 0], color: IRON });
    weights.push({ geometry: new THREE.CylinderGeometry(1.18, 1.18, 0.16, 24), rotation: [0, 0, Math.PI / 2], position: [x, 0, 0], color: 0x35393d });
  }
  weights.push({ geometry: new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12), rotation: [0, 0, Math.PI / 2], position: [-7.35, 0, 0], color: HAZARD });
  dec.add(mergedMesh(weights, { roughness: 0.55, metalness: 0.5, ...relief('metal', { seed: seed + 5, repeat: 2 }) }));

  // --- The tube -----------------------------------------------------------
  // Its own group, tipped so it points up by `elevation` and toward +Z -- the same direction
  // the dome's slit faces, so one yaw on both of them keeps the telescope looking out.
  const tube = group();
  tube.position.set(2.6, 0, 0);
  tube.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(elevation);
  // Undo the polar tip so `elevation` is measured from the real horizon rather than from the
  // polar axis -- the number a student can check against the dome slit.
  tube.rotation.x += (Math.PI / 2 - POLAR);
  dec.add(tube);

  // Tube length is set by what has to fit INSIDE a 13ft dome at 38 degrees of elevation, not
  // by the optics: at the mirror box's height and that angle, the top ring lands about 9ft
  // out from the dome's axis and 19ft up, where the inner shell is 11ft out. Lengthen the
  // truss and the telescope goes through its own roof -- which is invisible from outside and
  // unmissable from the observing floor.
  const R = aperture / 2;
  const MIRROR_BOX_H = 3.2;
  const TRUSS_H = 9.0;

  // The mirror box: the grey wrapped drum from the photograph, with the primary mirror
  // sitting in the bottom of it.
  const boxParts = [];
  boxParts.push({ geometry: new THREE.CylinderGeometry(R * 1.06, R * 1.06, MIRROR_BOX_H, 28), position: [0, MIRROR_BOX_H / 2, 0], color: SCOPE_GREY });
  for (let i = 0; i < 9; i++) {
    boxParts.push({
      geometry: new THREE.TorusGeometry(R * 1.08, 0.075, 6, 28),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.3 + i * 0.4, 0],
      color: 0x8f949a,
    });
  }
  boxParts.push({ geometry: new THREE.CylinderGeometry(R * 1.12, R * 1.12, 0.34, 28), position: [0, MIRROR_BOX_H - 0.1, 0], color: SCOPE_BLUE });
  boxParts.push({ geometry: new THREE.CylinderGeometry(R * 1.14, R * 1.14, 0.42, 28), position: [0, 0.2, 0], color: SCOPE_BLUE });
  tube.add(mergedMesh(boxParts, { roughness: 0.5, metalness: 0.45, ...relief('metal', { seed: seed + 6, repeat: 4 }) }));

  // The primary mirror, face up, at the bottom of the box. Visible to anybody who walks
  // round to the open end and looks in -- which is the point of leaving the tube open.
  const primary = mesh(new THREE.CircleGeometry(R * 0.94, 40), new THREE.MeshStandardMaterial({
    color: 0xdfe8f2, roughness: 0.06, metalness: 0.95, emissive: 0x1a2634, emissiveIntensity: 0.6,
  }), 0, 0.55, 0);
  primary.rotation.x = -Math.PI / 2;
  primary.castShadow = false;
  tube.add(primary);
  // The hole in the middle of it: a Cassegrain sends the light back out through the primary.
  const hole = mesh(new THREE.CircleGeometry(R * 0.2, 20), standard({ color: 0x0b0d10, roughness: 1 }), 0, 0.57, 0);
  hole.rotation.x = -Math.PI / 2;
  hole.castShadow = false;
  tube.add(hole);

  // The Serrurier truss: eight struts in crossed pairs, plus two square stiffening rings.
  // Crossed pairs rather than eight parallel poles, because a truss only resists twist if it
  // is triangulated -- and visually, the X-bracing is most of what says "engineering".
  const truss = [];
  const TOP = MIRROR_BOX_H + TRUSS_H;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const a2 = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4;
    const from = new THREE.Vector3(Math.cos(a) * R, MIRROR_BOX_H, Math.sin(a) * R);
    const to = new THREE.Vector3(Math.cos(a2) * R * 0.86, TOP, Math.sin(a2) * R * 0.86);
    const from2 = new THREE.Vector3(Math.cos(a2) * R, MIRROR_BOX_H, Math.sin(a2) * R);
    const to2 = new THREE.Vector3(Math.cos(a) * R * 0.86, TOP, Math.sin(a) * R * 0.86);
    for (const [p, q] of [[from, to], [from2, to2]]) {
      const dir = new THREE.Vector3().subVectors(q, p);
      const len = dir.length();
      const strut = new THREE.CylinderGeometry(0.13, 0.13, len, 8);
      const m = new THREE.Matrix4();
      m.lookAt(new THREE.Vector3(0, 0, 0), dir.clone().normalize(), new THREE.Vector3(0, 0, 1));
      // lookAt builds a -Z-forward basis; a cylinder is authored along +Y, so rotate it into
      // the frame first.
      strut.rotateX(Math.PI / 2);
      strut.applyMatrix4(m);
      strut.translate((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2);
      truss.push({ geometry: strut, color: SCOPE_BLUE });
    }
  }
  // Two mid-tube rings, which is what stops eight long struts reading as a wireframe.
  for (const [t, rr] of [[0.36, 0.95], [0.72, 0.9]]) {
    truss.push({
      geometry: new THREE.TorusGeometry(R * rr, 0.1, 6, 28),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, MIRROR_BOX_H + TRUSS_H * t, 0],
      color: SCOPE_BLUE_DK,
    });
  }
  // The top ring assembly and its dew shield lip.
  truss.push({ geometry: new THREE.TorusGeometry(R * 0.86, 0.15, 7, 32), rotation: [Math.PI / 2, 0, 0], position: [0, TOP, 0], color: SCOPE_BLUE });
  truss.push({ geometry: new THREE.CylinderGeometry(R * 0.88, R * 0.88, 1.5, 28, 1, true), position: [0, TOP + 0.7, 0], color: SCOPE_BLUE_DK });
  tube.add(mergedMesh(truss, { roughness: 0.45, metalness: 0.45, side: THREE.DoubleSide, ...relief('metal', { seed: seed + 7, repeat: 3 }) }));

  // The spider and the secondary mirror: four thin vanes across the top ring holding a small
  // mirror that faces back down the tube. This is the optical principle in one detail.
  const spider = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const vane = new THREE.BoxGeometry(R * 0.84, 0.16, 0.05);
    vane.translate(R * 0.42, 0, 0);
    vane.rotateY(a);
    vane.translate(0, TOP + 0.1, 0);
    spider.push({ geometry: vane, color: 0x2a2d31 });
  }
  spider.push({ geometry: new THREE.CylinderGeometry(R * 0.24, R * 0.26, 0.5, 20), position: [0, TOP + 0.1, 0], color: 0x35393d });
  tube.add(mergedMesh(spider, { roughness: 0.5, metalness: 0.4 }));
  const secondary = mesh(new THREE.CircleGeometry(R * 0.23, 20), new THREE.MeshStandardMaterial({
    color: 0xe4edf6, roughness: 0.05, metalness: 0.95, emissive: 0x1c2836, emissiveIntensity: 0.7,
  }), 0, TOP - 0.16, 0);
  secondary.rotation.x = Math.PI / 2;
  secondary.castShadow = false;
  tube.add(secondary);

  // The instrument package under the mirror box: a vacuum dewar for the camera, an
  // electronics crate and a filter wheel. This is where the light finally arrives, and on a
  // real telescope it is the heaviest thing on the tube.
  const instrument = [];
  instrument.push({ geometry: new THREE.CylinderGeometry(0.95, 0.95, 1.7, 20), position: [0, -1.0, 0], color: 0xc3c8ce });
  instrument.push({ geometry: new THREE.CylinderGeometry(1.05, 1.05, 0.2, 20), position: [0, -0.2, 0], color: 0x9aa0a6 });
  instrument.push({ geometry: new THREE.CylinderGeometry(0.55, 0.55, 0.9, 16), position: [0, -2.2, 0], color: 0x8d9298 });
  instrument.push({ geometry: new THREE.BoxGeometry(1.9, 1.1, 1.4), position: [1.1, -1.5, 0.9], color: 0x2b2f33 });
  instrument.push({ geometry: new THREE.BoxGeometry(1.5, 0.9, 1.1), position: [-1.2, -1.3, -0.8], color: 0x33383d });
  // Cable runs, as short cylinders following a slack curve. A real instrument is festooned
  // with them and a clean one looks like a render.
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const cable = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 5);
    cable.rotateZ(0.9 - t * 1.8);
    cable.translate(-0.2 + t * 2.2, -1.6 - Math.sin(t * Math.PI) * 0.85, 0.95);
    instrument.push({ geometry: cable, color: 0x1a1c1f });
  }
  tube.add(mergedMesh(instrument, { roughness: 0.45, metalness: 0.5, ...relief('metal', { seed: seed + 8, repeat: 3 }) }));

  // The finder scope, on two rings alongside. Small, and the one part of the instrument a
  // visitor recognises as "a telescope".
  const finder = [];
  finder.push({ geometry: new THREE.CylinderGeometry(0.28, 0.32, 4.4, 16), position: [R * 1.5, MIRROR_BOX_H + 3.4, 0], color: 0x2f3338 });
  for (const y of [MIRROR_BOX_H + 1.7, MIRROR_BOX_H + 5.0]) {
    finder.push({ geometry: new THREE.TorusGeometry(0.4, 0.08, 6, 16), rotation: [Math.PI / 2, 0, 0], position: [R * 1.5, y, 0], color: SCOPE_BLUE });
    finder.push({ geometry: new THREE.BoxGeometry(0.7, 0.16, 0.16), position: [R * 1.5 - 0.5, y, 0], color: SCOPE_BLUE });
  }
  finder.push({ geometry: new THREE.CylinderGeometry(0.16, 0.16, 0.7, 12), position: [R * 1.5, MIRROR_BOX_H + 1.0, 0], color: 0x22252a });
  tube.add(mergedMesh(finder, { roughness: 0.5, metalness: 0.4 }));
  const finderGlass = mesh(new THREE.CircleGeometry(0.27, 16), new THREE.MeshBasicMaterial({ color: 0x2b4c6b, fog: false }), R * 1.5, MIRROR_BOX_H + 5.62, 0);
  finderGlass.rotation.x = -Math.PI / 2;
  finderGlass.castShadow = false;
  tube.add(finderGlass);

  // --- The hand paddle on its coiled cable ---------------------------------
  // Hanging off the mount at about chest height. It is a tiny object and it does more for
  // "somebody uses this" than anything else on the model.
  const paddle = group();
  const paddleBody = box(0.7, 1.2, 0.28, standard({ color: 0x3a3f45, roughness: 0.6 }), 0, 0, 0);
  paddle.add(paddleBody);
  const buttons = [];
  for (let i = 0; i < 4; i++) {
    buttons.push({
      geometry: new THREE.CylinderGeometry(0.09, 0.09, 0.08, 8),
      rotation: [Math.PI / 2, 0, 0],
      position: [(i % 2 ? 0.16 : -0.16), 0.3 - Math.floor(i / 2) * 0.34, 0.16],
      color: i < 2 ? 0xc94b3a : 0x3f8f5a,
    });
  }
  paddle.add(mergedMesh(buttons, { roughness: 0.5, emissive: 0x140a06, emissiveIntensity: 1 }));
  // The coil, as a helix of short segments.
  const coil = [];
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const a = t * Math.PI * 6;
    const seg = new THREE.CylinderGeometry(0.045, 0.045, 0.3, 5);
    seg.rotateZ(Math.PI / 2 - 0.3);
    seg.translate(Math.cos(a) * 0.28, 1.0 + t * 2.4, Math.sin(a) * 0.28);
    coil.push({ geometry: seg, color: 0x1c1e21 });
  }
  paddle.add(mergedMesh(coil, { roughness: 0.7 }));
  paddle.position.set(3.1, PIER_H + 1.1, 2.3);
  paddle.rotation.y = 0.4;
  g.add(paddle);

  // --- Maker's plate on the pier ------------------------------------------
  const plate = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#26303a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b99a52';
    ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8dfc8';
    ctx.font = 'bold 40px Georgia, "Times New Roman", serif';
    ctx.fillText('36-INCH REFLECTOR', w / 2, 72);
    ctx.fillStyle = '#b99a52';
    ctx.font = '24px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('CASSEGRAIN  ·  f/13.5', w / 2, 112);
    ctx.fillStyle = '#9fb0c2';
    ctx.font = '21px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('EQUATORIAL FORK MOUNT', w / 2, 156);
    ctx.fillText('MIRROR CAST 1959  ·  FIRST LIGHT 1962', w / 2, 190);
    ctx.textAlign = 'left';
  });
  const plateMesh = signPanel(2.3, 1.15, plate, { emissive: '#ffffff', emissiveIntensity: 0.55 });
  plateMesh.position.set(0, 2.6, 2.45);
  g.add(plateMesh);

  void rng;
  return g;
}

// ---------------------------------------------------------------------------
// 4. The interior gallery
// ---------------------------------------------------------------------------

// The steel walkway round the inside of the dome, with the yellow railing from the
// photograph. Scenery rather than floor -- PlayerController walks on the terrain and never
// on props -- so it is deliberately hung high and narrow, where nobody would expect to
// stand, and a student walks underneath it.
export function domeCatwalk({ radius = 12.2, height = 8.6, gap = 0.42, seed = 17 } = {}) {
  const g = group();
  const parts = [];
  const arc = Math.PI * 2 - gap * 2;

  // The grating: a wide flat ring, drawn as a band of short radial planks so it reads as
  // grating rather than as a solid shelf.
  const PLANKS = 72;
  for (let i = 0; i < PLANKS; i++) {
    const a = (i / PLANKS) * Math.PI * 2;
    const signed = ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(signed) < gap) continue;
    const plank = new THREE.BoxGeometry(Math.PI * 2 * radius / PLANKS * 0.82, 0.1, 2.6);
    plank.translate(0, height, radius - 1.3);
    plank.rotateY(a);
    parts.push({ geometry: plank, color: i % 3 ? 0x5c6165 : 0x686d71 });
  }
  // Its edge beam and the brackets holding it off the wall.
  parts.push({ geometry: gappedRing(radius - 2.6, 0.14, arc, { gapAt: 0, segments: 64 }), position: [0, height - 0.1, 0], color: 0x4a4f53 });
  parts.push({ geometry: gappedRing(radius - 0.05, 0.12, arc, { gapAt: 0, segments: 64 }), position: [0, height - 0.1, 0], color: 0x4a4f53 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const signed = ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(signed) < gap + 0.1) continue;
    const bracket = new THREE.BoxGeometry(0.18, 1.5, 1.5);
    bracket.rotateX(0.72);
    bracket.translate(0, height - 0.85, radius - 0.7);
    bracket.rotateY(a);
    parts.push({ geometry: bracket, color: 0x44484c });
  }
  g.add(mergedMesh(parts, { roughness: 0.65, metalness: 0.45, ...relief('metal', { seed, repeat: 4 }) }));

  // The railing, in observatory yellow -- and it is yellow for a reason worth a placard:
  // this is a room that works in the dark, so everything you could walk into is painted the
  // brightest colour there is.
  const rail = [];
  const POSTS = 26;
  for (let i = 0; i < POSTS; i++) {
    const a = (i / POSTS) * Math.PI * 2;
    const signed = ((a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(signed) < gap + 0.08) continue;
    const post = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8);
    post.translate(0, height + 1.6, radius - 2.55);
    post.rotateY(a);
    rail.push({ geometry: post, color: HAZARD });
  }
  for (const dy of [3.1, 1.6]) {
    rail.push({ geometry: gappedRing(radius - 2.55, 0.075, arc, { gapAt: 0, segments: 64, radialSegments: 6 }), position: [0, height + dy, 0], color: HAZARD });
  }
  g.add(mergedMesh(rail, { roughness: 0.6, metalness: 0.2, emissive: 0x2a2000, emissiveIntensity: 0.9 }));

  return g;
}

// ---------------------------------------------------------------------------
// 5. The control desk
// ---------------------------------------------------------------------------

// Where the observing actually happens: two screens, a keyboard, a rack of electronics and a
// red lamp. Nobody looks through a research telescope with their eye -- the light goes to a
// camera and the astronomer sits at a desk, often in a different room -- and this desk is
// the honest version of that, which is a genuinely surprising thing for a visitor to learn.
export function controlDesk({ width = 7.6, seed = 23 } = {}) {
  const g = group();
  const DESK_H = 2.5;
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(width, 0.16, 3.0), position: [0, DESK_H, 0], color: 0x6b5b45 });
  parts.push({ geometry: new THREE.BoxGeometry(width, 0.1, 0.34), position: [0, DESK_H - 0.12, 1.4], color: 0x4d4234 });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.22, DESK_H, 2.7), position: [side * (width / 2 - 0.3), DESK_H / 2, 0], color: 0x3c4046 });
    parts.push({ geometry: new THREE.BoxGeometry(0.5, 0.1, 2.9), position: [side * (width / 2 - 0.3), 0.05, 0], color: 0x2f3338 });
  }
  // A drawer unit under one end.
  parts.push({ geometry: new THREE.BoxGeometry(2.0, 1.9, 2.4), position: [-width / 2 + 1.6, 0.95, -0.1], color: 0x4a4f55 });
  for (let i = 0; i < 3; i++) {
    parts.push({ geometry: new THREE.BoxGeometry(1.7, 0.06, 0.1), position: [-width / 2 + 1.6, 0.5 + i * 0.6, 1.15], color: 0x9aa0a6 });
  }
  g.add(mergedMesh(parts, { roughness: 0.7, metalness: 0.2, ...relief('wood', { seed, repeat: 3 }) }));

  // --- The screens --------------------------------------------------------
  // A telescope control display and a camera readout. Both emissive, because a screen is a
  // light source, and both are the only bright thing in a darkened dome -- which is exactly
  // what the inside of a working observatory looks like at night.
  const tcs = canvasTexture(768, 480, (ctx, w, h) => {
    ctx.fillStyle = '#050b12';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0d2033';
    ctx.fillRect(0, 0, w, 44);
    ctx.fillStyle = '#6fd0ff';
    ctx.font = 'bold 24px "Courier New", monospace';
    ctx.fillText('TELESCOPE CONTROL SYSTEM', 16, 31);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4fe07a';
    ctx.fillText('TRACKING', w - 16, 31);
    ctx.textAlign = 'left';

    const rows = [
      ['TARGET', 'M42  ORION NEBULA'],
      ['R.A.', '05h 35m 17.3s'],
      ['DEC.', '-05° 23′ 28″'],
      ['ALTITUDE', '+54.2°'],
      ['AZIMUTH', '178.6°'],
      ['DOME AZ.', '178.4°   [ FOLLOWING ]'],
      ['SIDEREAL', '05h 41m 02s'],
      ['AIRMASS', '1.23'],
    ];
    rows.forEach(([k, v], i) => {
      const y = 88 + i * 40;
      ctx.fillStyle = '#4a7fa8';
      ctx.font = '21px "Courier New", monospace';
      ctx.fillText(k, 22, y);
      ctx.fillStyle = i === 5 ? '#4fe07a' : '#d8ecff';
      ctx.font = 'bold 22px "Courier New", monospace';
      ctx.fillText(v, 200, y);
      ctx.strokeStyle = 'rgba(80,140,190,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(16, y + 12);
      ctx.lineTo(w - 16, y + 12);
      ctx.stroke();
    });
    ctx.fillStyle = '#ffb347';
    ctx.font = '19px "Courier New", monospace';
    ctx.fillText('> guider locked   > shutter open   > focus 12.84mm', 22, h - 22);
  });

  const cam = canvasTexture(768, 480, (ctx, w, h) => {
    const rng = seededRandom(seed + 1);
    ctx.fillStyle = '#02060c';
    ctx.fillRect(0, 0, w, h);
    // A CCD frame of a star field, with one bright target in the middle in a box. This is
    // what the telescope is actually producing while a student stands there.
    for (let i = 0; i < 240; i++) {
      const r = randomIn(rng, 0.6, 2.6);
      const x = randomIn(rng, 0, w);
      const y = randomIn(rng, 34, h);
      const a = randomIn(rng, 0.2, 1);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      grad.addColorStop(0, `rgba(226,238,255,${a})`);
      grad.addColorStop(1, 'rgba(226,238,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // The nebula.
    const nx = w * 0.48;
    const ny = h * 0.55;
    for (const [r, c, a] of [[150, 'rgba(120,170,220,0.30)'], [92, 'rgba(180,140,200,0.30)'], [48, 'rgba(255,255,255,0.42)']]) {
      const grad = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
      grad.addColorStop(0, c);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, Math.PI * 2);
      ctx.fill();
      void a;
    }
    ctx.strokeStyle = '#4fe07a';
    ctx.lineWidth = 2;
    ctx.strokeRect(nx - 70, ny - 60, 140, 120);
    ctx.fillStyle = '#4fe07a';
    ctx.font = 'bold 18px "Courier New", monospace';
    ctx.fillText('M42', nx - 68, ny - 70);
    ctx.fillStyle = '#0d2033';
    ctx.fillRect(0, 0, w, 34);
    ctx.fillStyle = '#6fd0ff';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.fillText('CCD  ·  300s  ·  H-ALPHA', 14, 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffb347';
    ctx.fillText('EXPOSING  214s', w - 14, 24);
    ctx.textAlign = 'left';
  });

  const screenFrame = standard({ color: 0x1c1f23, roughness: 0.5 });
  [[-1.9, tcs, 0.24], [1.9, cam, -0.24]].forEach(([x, texture, yaw]) => {
    const monitor = group();
    monitor.add(box(3.5, 2.2, 0.2, screenFrame, 0, 0, 0));
    const face = mesh(new THREE.PlaneGeometry(3.26, 1.98), new THREE.MeshBasicMaterial({
      map: texture, fog: false, toneMapped: false,
    }), 0, 0, 0.11);
    face.castShadow = false;
    monitor.add(face);
    monitor.add(box(0.5, 0.16, 0.9, screenFrame, 0, -1.2, 0));
    monitor.add(box(1.4, 0.1, 0.9, screenFrame, 0, -1.28, 0));
    monitor.position.set(x, DESK_H + 1.4, -0.9);
    monitor.rotation.y = yaw;
    g.add(monitor);
  });

  // Keyboard, mouse, mug, logbook.
  const kit = [];
  kit.push({ geometry: new THREE.BoxGeometry(2.2, 0.1, 0.8), rotation: [-0.05, 0, 0], position: [0, DESK_H + 0.13, 0.7], color: 0x2a2d31 });
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 14; c++) {
      kit.push({
        geometry: new THREE.BoxGeometry(0.12, 0.04, 0.12),
        position: [-1.0 + c * 0.15, DESK_H + 0.2, 0.45 + r * 0.16],
        color: 0x3d4146,
      });
    }
  }
  kit.push({ geometry: new THREE.SphereGeometry(0.18, 10, 6), position: [1.5, DESK_H + 0.13, 0.7], color: 0x33373b });
  kit.push({ geometry: new THREE.CylinderGeometry(0.22, 0.19, 0.44, 14), position: [-2.6, DESK_H + 0.3, 0.9], color: 0xd8cfc0 });
  kit.push({ geometry: new THREE.TorusGeometry(0.11, 0.035, 6, 12), rotation: [0, Math.PI / 2, 0], position: [-2.85, DESK_H + 0.32, 0.9], color: 0xd8cfc0 });
  kit.push({ geometry: new THREE.BoxGeometry(1.5, 0.14, 1.1), rotation: [0, 0.3, 0], position: [2.7, DESK_H + 0.15, 0.75], color: 0x8a6b3c });
  g.add(mergedMesh(kit, { roughness: 0.6, metalness: 0.15 }));

  // The electronics rack beside the desk: black boxes and a column of LEDs, which is the one
  // thing in this world that looks like it is doing something while nobody watches.
  const rack = group();
  rack.add(box(2.4, 5.2, 2.2, standard({ color: 0x23262a, roughness: 0.6, metalness: 0.3 }), 0, 2.6, 0));
  const units = [];
  const leds = [];
  for (let i = 0; i < 7; i++) {
    const y = 0.7 + i * 0.62;
    units.push({ geometry: new THREE.BoxGeometry(2.24, 0.5, 0.14), position: [0, y, 1.12], color: i % 2 ? 0x33383d : 0x2b2f34 });
    for (let k = 0; k < 4; k++) {
      leds.push({
        geometry: new THREE.SphereGeometry(0.045, 6, 3),
        position: [-0.9 + k * 0.28, y, 1.2],
        color: (i + k) % 5 === 0 ? 0xff4433 : (i + k) % 3 === 0 ? 0xffc233 : 0x44dd77,
      });
    }
  }
  rack.add(mergedMesh(units, { roughness: 0.6, metalness: 0.35 }));
  const ledMesh = new THREE.Mesh(mergeColored(leds), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }));
  ledMesh.castShadow = false;
  rack.add(ledMesh);
  rack.position.set(width / 2 + 1.6, 0, -0.3);
  rack.rotation.y = -0.4;
  g.add(rack);

  // The red desk lamp. Red, for the reason every light in a working dome is red.
  const lamp = group();
  lamp.add(cyl(0.34, 0.4, 0.1, standard({ color: 0x2c2f33, roughness: 0.6 }), 0, 0.05, 0, 12));
  const stem = cyl(0.05, 0.05, 1.5, standard({ color: 0x3a3e42, roughness: 0.5, metalness: 0.5 }), 0, 0.8, 0, 8);
  stem.rotation.x = 0.2;
  lamp.add(stem);
  const shade = mesh(new THREE.CylinderGeometry(0.34, 0.16, 0.42, 14, 1, true), standard({
    color: 0x3a3e42, roughness: 0.6, side: THREE.DoubleSide,
  }), 0, 1.5, 0.28);
  shade.rotation.x = 1.1;
  lamp.add(shade);
  const bulb = mesh(new THREE.SphereGeometry(0.12, 8, 5), new THREE.MeshBasicMaterial({ color: 0xff3524, fog: false, toneMapped: false }), 0, 1.38, 0.36);
  bulb.castShadow = false;
  lamp.add(bulb);
  const light = new THREE.PointLight(0xff4a2a, 1.1, 12, 2);
  light.position.set(0, 1.3, 0.4);
  light.userData.isLight = true;
  lamp.add(light);
  lamp.position.set(-width / 2 + 0.9, DESK_H + 0.08, -0.7);
  g.add(lamp);

  // A stool, so the desk is somewhere a person sits.
  const stool = group();
  const steel = standard({ color: 0x484d52, roughness: 0.55, metalness: 0.45 });
  stool.add(cyl(0.9, 0.9, 0.16, standard({ color: 0x2a2d31, roughness: 0.8 }), 0, 1.85, 0, 18));
  stool.add(cyl(0.16, 0.16, 1.8, steel, 0, 0.9, 0, 10));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 1.1), steel);
    foot.position.set(Math.sin(a) * 0.5, 0.08, Math.cos(a) * 0.5);
    foot.rotation.y = a;
    foot.castShadow = true;
    stool.add(foot);
  }
  stool.position.set(0.4, 0, 2.6);
  g.add(stool);

  return g;
}

// ---------------------------------------------------------------------------
// 6. The rest of the site
// ---------------------------------------------------------------------------

// The low wing attached to the dome building: offices, the plate store and the workshop.
// Corrugated metal on a stone base, a shed roof, and dark windows -- straight off the
// photograph, where it is the long building to the right of the dome.
export function observatoryWing({ length = 34, width = 14, height = 9.5, seed = 29 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const BASE_H = 1.6;

  parts.push({ geometry: new THREE.BoxGeometry(length + 0.5, BASE_H, width + 0.5), position: [0, BASE_H / 2, 0], color: FLAGSTONE });
  parts.push({ geometry: new THREE.BoxGeometry(length, height - BASE_H, width), position: [0, BASE_H + (height - BASE_H) / 2, 0], color: WALL_TAN });
  // Vertical corrugation on the two long faces.
  const RIBS = Math.round(length / 1.1);
  for (let i = 0; i <= RIBS; i++) {
    const x = -length / 2 + (i / RIBS) * length;
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.1, 0.1, height - BASE_H, 6),
        position: [x, BASE_H + (height - BASE_H) / 2, side * (width / 2 + 0.05)],
        color: i % 2 ? WALL_TAN_DK : WALL_TAN,
      });
    }
  }
  // A shed roof, leaning one way, with a deep eave.
  const roof = new THREE.BoxGeometry(length + 1.6, 0.32, width + 2.2);
  roof.rotateX(-0.10);
  roof.translate(0, height + 0.6, 0);
  parts.push({ geometry: roof, color: 0x8f959b });
  for (let i = 0; i <= Math.round(width / 1.4); i++) {
    const z = -width / 2 - 1 + i * 1.4;
    const seam = new THREE.BoxGeometry(length + 1.6, 0.12, 0.14);
    seam.rotateX(-0.10);
    seam.translate(0, height + 0.78 - z * 0.1, z);
    parts.push({ geometry: seam, color: 0xa2a8ae });
  }
  parts.push({ geometry: new THREE.BoxGeometry(length + 1.6, 0.4, 0.3), position: [0, height + 0.35, width / 2 + 1.05], color: TRIM_GREEN });
  g.add(mergedMesh(parts, {
    color: 0xffffff, roughness: 0.68, metalness: 0.3, ...relief('metal', { seed, repeat: 8 }),
  }));

  // Windows and a door on the long face, hung PROUD of the wall. A pane set on the inner
  // face is sealed inside the timber and can never be seen -- the trap the Park's nature
  // centre paid for.
  const glass = standard({
    color: 0x1a2732, roughness: 0.25, metalness: 0.4, emissive: 0x2c3f52, emissiveIntensity: 0.55,
  });
  const frame = standard({ color: TRIM_GREEN, roughness: 0.6, metalness: 0.2 });
  for (let i = 0; i < 4; i++) {
    const x = -length / 2 + length * (0.22 + i * 0.19);
    const win = group();
    win.add(box(3.2, 2.6, 0.22, frame, 0, 0, 0));
    win.add(box(2.9, 2.3, 0.1, glass, 0, 0, 0.14));
    win.add(box(0.12, 2.3, 0.14, frame, 0, 0, 0.17));
    win.position.set(x, height * 0.62, width / 2 + 0.1);
    g.add(win);
  }
  const door = group();
  door.add(box(3.8, 7.0, 0.3, frame, 0, 3.5, 0));
  door.add(box(3.2, 6.6, 0.14, standard({ color: 0xd2cec2, roughness: 0.6, metalness: 0.2 }), 0, 3.3, 0.16));
  door.add(box(1.6, 1.2, 0.06, glass, 0, 5.2, 0.24));
  door.position.set(-length / 2 + length * 0.08, 0, width / 2 + 0.12);
  g.add(door);
  g.add(box(5.0, 0.4, 2.6, standard({ color: CONCRETE, roughness: 0.95, ...relief('stone', { seed: seed + 1, repeat: 3 }) }),
    -length / 2 + length * 0.08, 0.2, width / 2 + 1.5));

  // Roof kit: a vent stack and a swamp cooler, because a flat metal roof with nothing on it
  // reads as a model rather than a building.
  const kit = [];
  kit.push({ geometry: new THREE.BoxGeometry(3.0, 2.2, 3.0), position: [length * 0.22, height + 1.7, -width * 0.1], color: 0x9aa0a6 });
  kit.push({ geometry: new THREE.BoxGeometry(3.3, 0.3, 3.3), position: [length * 0.22, height + 2.9, -width * 0.1], color: 0x7f858b });
  kit.push({ geometry: new THREE.CylinderGeometry(0.5, 0.5, 2.6, 14), position: [-length * 0.28, height + 1.9, 0], color: 0x8f959b });
  kit.push({ geometry: new THREE.CylinderGeometry(0.8, 0.62, 0.5, 14), position: [-length * 0.28, height + 3.3, 0], color: 0x6f757b });
  g.add(mergedMesh(kit, { roughness: 0.6, metalness: 0.4, ...relief('metal', { seed: seed + 2, repeat: 3 }) }));

  void rng;
  return g;
}

// A second, smaller dome across the site -- the student telescope, shutter closed. Built as
// one prop rather than as a drum-and-cap pair because it does not turn: only the big dome
// needs to be two objects.
export function studentDome({ radius = 7, wallHeight = 7.5, seed = 31 } = {}) {
  const g = group();
  const parts = [];
  const BASE_H = 1.6;

  parts.push({ geometry: new THREE.CylinderGeometry(radius + 0.2, radius + 0.3, BASE_H, 32), position: [0, BASE_H / 2, 0], color: FLAGSTONE });
  parts.push({ geometry: new THREE.CylinderGeometry(radius, radius, wallHeight - BASE_H, 40), position: [0, BASE_H + (wallHeight - BASE_H) / 2, 0], color: WALL_TAN });
  const RIBS = 40;
  for (let i = 0; i < RIBS; i++) {
    const a = (i / RIBS) * Math.PI * 2;
    const rib = new THREE.CylinderGeometry(0.09, 0.09, wallHeight - BASE_H, 6);
    rib.translate(0, BASE_H + (wallHeight - BASE_H) / 2, radius + 0.05);
    rib.rotateY(a);
    parts.push({ geometry: rib, color: i % 2 ? WALL_TAN_DK : WALL_TAN });
  }
  parts.push({ geometry: new THREE.TorusGeometry(radius + 0.18, 0.26, 7, 36), rotation: [Math.PI / 2, 0, 0], position: [0, wallHeight - 0.35, 0], color: TRIM_GREEN });
  // The cap, closed: a hemisphere with the shutter line drawn on it as a pair of raised
  // seams, which is what a shut dome looks like.
  parts.push({ geometry: new THREE.SphereGeometry(radius + 0.15, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2), position: [0, wallHeight, 0], color: DOME_SILVER });
  for (let i = 0; i < 18; i++) {
    const az = (i / 18) * Math.PI * 2;
    const rib = new THREE.TorusGeometry(radius + 0.24, 0.09, 6, 14, Math.PI / 2);
    rib.rotateY(az - Math.PI / 2);
    rib.translate(0, wallHeight, 0);
    parts.push({ geometry: rib, color: DOME_RIB });
  }
  for (const side of [-0.16, 0.16]) {
    const seam = new THREE.TorusGeometry(radius + 0.3, 0.13, 6, 16, Math.PI / 2);
    seam.rotateY(side - Math.PI / 2);
    seam.translate(0, wallHeight, 0);
    parts.push({ geometry: seam, color: 0x878d93 });
  }
  parts.push({ geometry: new THREE.CylinderGeometry(0.7, 0.85, 0.3, 18), position: [0, wallHeight + radius - 0.1, 0], color: DOME_RIB });
  // A door, painted on: this one is not a building a student can enter, so a real opening
  // would be an invitation to an empty shell.
  parts.push({ geometry: new THREE.BoxGeometry(3.2, 6.4, 0.3), position: [0, 3.2, radius + 0.1], color: TRIM_GREEN });
  parts.push({ geometry: new THREE.BoxGeometry(2.7, 6.0, 0.2), position: [0, 3.1, radius + 0.24], color: 0xd2cec2 });
  parts.push({ geometry: new THREE.BoxGeometry(4.4, 0.4, 2.4), position: [0, 0.2, radius + 1.3], color: CONCRETE });
  g.add(mergedMesh(parts, {
    color: 0xffffff, roughness: 0.6, metalness: 0.38, ...relief('metal', { seed, repeat: 6 }),
  }));
  return g;
}

// An amateur Dobsonian on the lawn: a tube in a plywood rocker box. It is here as the
// "you can do this too" object -- the whole point of a Dob is that it is a big mirror on the
// cheapest possible mount, and one of these costs less than a phone.
export function dobsonianTelescope({ tubeLength = 5.4, elevation = 52, seed = 37 } = {}) {
  const g = group();
  const R = 0.62;

  const boxParts = [];
  // Ground board and rocker box, in birch ply.
  boxParts.push({ geometry: new THREE.CylinderGeometry(1.55, 1.55, 0.18, 24), position: [0, 0.09, 0], color: 0xc4a273 });
  boxParts.push({ geometry: new THREE.CylinderGeometry(1.5, 1.5, 0.14, 24), position: [0, 0.25, 0], color: 0xb08f61 });
  for (const side of [-1, 1]) {
    boxParts.push({ geometry: new THREE.BoxGeometry(0.14, 1.9, 2.4), position: [side * 1.05, 1.25, 0], color: 0xc4a273 });
  }
  boxParts.push({ geometry: new THREE.BoxGeometry(2.1, 1.6, 0.16), position: [0, 1.1, -1.12], color: 0xb08f61 });
  boxParts.push({ geometry: new THREE.BoxGeometry(2.1, 0.16, 2.3), position: [0, 0.4, 0], color: 0xb08f61 });
  g.add(mergedMesh(boxParts, { roughness: 0.8, ...relief('wood', { seed, repeat: 3 }) }));

  // The tube, tipped up, with its altitude bearings.
  const tube = group();
  tube.position.set(0, 2.0, 0);
  tube.rotation.x = Math.PI / 2 - THREE.MathUtils.degToRad(elevation);
  g.add(tube);

  const tubeParts = [];
  tubeParts.push({ geometry: new THREE.CylinderGeometry(R, R, tubeLength, 22, 1, true), position: [0, tubeLength / 2 - 1.4, 0], color: 0x25303c });
  tubeParts.push({ geometry: new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.3, 22), position: [0, tubeLength - 1.5, 0], color: 0x8fa0b0 });
  tubeParts.push({ geometry: new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.4, 22), position: [0, -1.2, 0], color: 0x8fa0b0 });
  // The eyepiece, up near the top and out to the side -- which is where a Newtonian's is,
  // and it surprises everybody the first time.
  const focuser = new THREE.CylinderGeometry(0.2, 0.22, 0.9, 14);
  focuser.rotateZ(Math.PI / 2);
  focuser.translate(R + 0.4, tubeLength - 2.1, 0);
  tubeParts.push({ geometry: focuser, color: 0x2f3338 });
  const eyepiece = new THREE.CylinderGeometry(0.14, 0.16, 0.5, 12);
  eyepiece.rotateZ(Math.PI / 2);
  eyepiece.translate(R + 1.0, tubeLength - 2.1, 0);
  tubeParts.push({ geometry: eyepiece, color: 0x15181b });
  // A finder and its bracket.
  const finder = new THREE.CylinderGeometry(0.11, 0.13, 1.5, 10);
  finder.translate(R + 0.3, tubeLength - 2.6, 0.35);
  tubeParts.push({ geometry: finder, color: 0x1c1f23 });
  for (const [t, r] of [[0.28, 0.9], [0.62, 0.88]]) {
    tubeParts.push({
      geometry: new THREE.TorusGeometry(R * 1.05, 0.07, 6, 18),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, tubeLength * t - 1.4, 0],
      color: 0x3b444d,
    });
  }
  tube.add(mergedMesh(tubeParts, { roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide, ...relief('metal', { seed: seed + 1, repeat: 3 }) }));

  // The primary, down at the bottom, and the diagonal up top.
  const primary = mesh(new THREE.CircleGeometry(R * 0.94, 28), new THREE.MeshStandardMaterial({
    color: 0xd8e4f0, roughness: 0.08, metalness: 0.9, emissive: 0x18222e, emissiveIntensity: 0.6,
  }), 0, -0.95, 0);
  primary.rotation.x = -Math.PI / 2;
  primary.castShadow = false;
  tube.add(primary);
  const diagonal = mesh(new THREE.CircleGeometry(R * 0.34, 16), new THREE.MeshStandardMaterial({
    color: 0xe0eaf4, roughness: 0.06, metalness: 0.9,
  }), 0, tubeLength - 2.1, 0);
  diagonal.rotation.x = Math.PI / 4;
  diagonal.castShadow = false;
  tube.add(diagonal);

  // Altitude bearings: two big discs on the tube sides riding in the rocker box. They are
  // the whole mount, and they are what makes it a Dobsonian.
  const bearings = [];
  for (const side of [-1, 1]) {
    bearings.push({
      geometry: new THREE.CylinderGeometry(1.0, 1.0, 0.16, 24),
      rotation: [0, 0, Math.PI / 2],
      position: [side * (R + 0.42), 2.0, 0],
      color: 0xd8c39a,
    });
  }
  g.add(mergedMesh(bearings, { roughness: 0.8, ...relief('wood', { seed: seed + 2, repeat: 2 }) }));

  return g;
}

// ---------------------------------------------------------------------------
// 7. Vegetation -- the dry hilltop the site sits on
// ---------------------------------------------------------------------------

// A mesquite: low, wide, multi-trunked and twisted, with fine grey-green foliage. What makes
// it read as desert scrub rather than as a shade tree is that it is WIDER THAN IT IS TALL and
// that its trunks lean apart from ground level -- a single upright trunk with a ball on top
// is a park tree wherever you put it.
export function mesquiteTree({ height = 13, seed = 41 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const TRUNKS = 3;

  for (let t = 0; t < TRUNKS; t++) {
    const bearing = (t / TRUNKS) * Math.PI * 2 + randomIn(rng, -0.4, 0.4);
    const lean = randomIn(rng, 0.5, 0.95);
    const top = height * randomIn(rng, 0.55, 0.72);
    const points = [];
    const radii = [];
    const STEPS = 5;
    for (let i = 0; i <= STEPS; i++) {
      const f = i / STEPS;
      const out = Math.pow(f, 0.8) * lean * height * 0.28;
      points.push([
        Math.cos(bearing) * out + randomIn(rng, -0.3, 0.3) * f,
        f * top,
        Math.sin(bearing) * out + randomIn(rng, -0.3, 0.3) * f,
      ]);
      radii.push(height * (0.038 - 0.024 * f));
    }
    parts.push({ geometry: taperedTube(points, radii, { tubularSegments: 12, radialSegments: 10 }), color: 0x5a4632 });

    // Branches, and then the foliage sitting on the ends of them. Foliage floating clear of its
    // own branch is the single most obvious way a procedural tree gives itself away.
    //
    // THE CROWN HAS TO BE A DOMED MASS, not a flat plate, and the first pass got this wrong in
    // the one way that is fatal: sixteen puffs squashed to 0.62 and scattered on a horizontal
    // spread merged into a single dark disc, so a 13ft tree read as an umbrella on sticks. What
    // fixes it is puffs that are nearly ROUND (flatten 0.85), smaller, more numerous, and lifted
    // by an amount that falls off with distance from the trunk -- which is what builds a crown
    // with a top and a silhouette instead of a lid.
    const tip = points[points.length - 1];
    for (let b = 0; b < 6; b++) {
      const ba = bearing + randomIn(rng, -1.3, 1.3);
      const blen = height * randomIn(rng, 0.16, 0.28);
      const end = [
        tip[0] + Math.cos(ba) * blen,
        tip[1] + randomIn(rng, 0.25, 0.6) * blen,
        tip[2] + Math.sin(ba) * blen,
      ];
      parts.push({
        geometry: taperedTube([tip, [(tip[0] + end[0]) / 2, (tip[1] + end[1]) / 2 + 0.3, (tip[2] + end[2]) / 2], end],
          [height * 0.016, height * 0.011, height * 0.005], { tubularSegments: 6, radialSegments: 7 }),
        color: 0x53412f,
      });
      for (let p = 0; p < 5; p++) {
        const spread = height * 0.055;
        const dx = randomIn(rng, -spread, spread);
        const dz = randomIn(rng, -spread, spread);
        // Domed: a puff near the branch end sits high, one further out sits lower.
        const dome = 1 - Math.min(1, Math.hypot(dx, dz) / (spread * 1.45));
        const puff = new THREE.SphereGeometry(height * randomIn(rng, 0.05, 0.085), 10, 7);
        roughenSphere(puff, { amount: 0.32, flatten: 0.85, phase: randomIn(rng, 0, 6) });
        puff.translate(end[0] + dx, end[1] + dome * height * 0.055 + randomIn(rng, -0.2, 0.3), end[2] + dz);
        parts.push({ geometry: puff, color: [0x5f7a45, 0x4d6838, 0x6b8750][p % 3] });
      }
    }
  }
  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('bark', { seed, repeat: 3 }) }));
  return g;
}

// A rounded desert shrub -- creosote or similar. A mound of small roughened spheres with a
// few bare twigs poking out of it, which is what stops it reading as a green cushion.
export function desertShrub({ radius = 2.6, seed = 43 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const COUNT = 16;

  for (let i = 0; i < COUNT; i++) {
    const a = i * 2.399;
    const d = Math.sqrt((i + 0.4) / COUNT) * radius * 0.72;
    const r = radius * randomIn(rng, 0.28, 0.46);
    const puff = new THREE.SphereGeometry(r, 9, 6);
    roughenSphere(puff, { amount: 0.34, flatten: 0.78, phase: randomIn(rng, 0, 6) });
    puff.translate(
      Math.cos(a) * d,
      radius * randomIn(rng, 0.34, 0.72) - r * 0.15,
      Math.sin(a) * d,
    );
    const shade = randomIn(rng, 0.85, 1.2);
    parts.push({ geometry: puff, color: new THREE.Color(SAGE).multiplyScalar(shade).getHex() });
  }
  for (let i = 0; i < 7; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const twig = new THREE.CylinderGeometry(0.03, 0.05, radius * randomIn(rng, 0.8, 1.3), 5);
    twig.rotateZ(randomIn(rng, -0.5, 0.5));
    twig.rotateY(a);
    twig.translate(Math.cos(a) * radius * 0.3, radius * 0.55, Math.sin(a) * radius * 0.3);
    parts.push({ geometry: twig, color: 0x6b5c44 });
  }
  g.add(mergedMesh(parts, { roughness: 0.92, ...relief('bark', { seed, repeat: 4 }) }));
  return g;
}

// A clump of dry bunch grass, for scattering along the edges of the site. Blades rather than
// puffs: at this scale the individual stems are what read, and a mound would be a shrub.
export function dryGrass({ radius = 1.6, height = 2.2, blades = 26, seed = 47 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < blades; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const d = Math.sqrt(rng()) * radius;
    const h = height * randomIn(rng, 0.5, 1.2);
    const lean = randomIn(rng, 0.15, 0.5);
    const blade = new THREE.CylinderGeometry(0.012, 0.055, h, 4);
    blade.rotateZ(lean);
    blade.rotateY(a * 1.7);
    blade.translate(Math.cos(a) * d, h * 0.46, Math.sin(a) * d);
    parts.push({ geometry: blade, color: randomIn(rng, 0, 1) > 0.45 ? 0x9a8a52 : 0x7d7040 });
  }
  return group(mergedMesh(parts, { roughness: 0.95, ...relief('bark', { seed, repeat: 4 }) }));
}

// ---------------------------------------------------------------------------
// 8. Site instruments
// ---------------------------------------------------------------------------

// An all-sky camera on a short post: a glass dome looking straight up, which photographs the
// whole sky every minute so the observers can see cloud coming before it arrives. Given a
// slow `rotate` in the layout, since the one thing on this site that is always working is the
// thing watching the weather.
export function allSkyCamera({ height = 5.5, seed = 53 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(0.85, 1.0, 0.3, 18), position: [0, 0.15, 0], color: CONCRETE_DK });
  parts.push({ geometry: new THREE.CylinderGeometry(0.2, 0.26, height, 14), position: [0, height / 2, 0], color: 0x8d9298 });
  parts.push({ geometry: new THREE.BoxGeometry(1.5, 1.0, 1.5), position: [0, height + 0.5, 0], color: 0xd6d2c8 });
  parts.push({ geometry: new THREE.CylinderGeometry(0.85, 0.85, 0.18, 20), position: [0, height + 1.05, 0], color: 0xb7b3a9 });
  // A junction box and its conduit down the post.
  parts.push({ geometry: new THREE.BoxGeometry(0.7, 0.9, 0.4), position: [0, height * 0.5, 0.42], color: 0x6f7378 });
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.4, ...relief('metal', { seed, repeat: 3 }) }));

  // The acrylic dome. Transparent, and one of very few transparent meshes in this world --
  // which is the right place to spend it, since a solid white ball on a post is a lamp.
  const dome = mesh(new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({
    color: 0xbcd4e8, transparent: true, opacity: 0.42, roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide,
  }), 0, height + 1.1, 0);
  dome.castShadow = false;
  g.add(dome);
  const lens = mesh(new THREE.SphereGeometry(0.22, 14, 8), standard({
    color: 0x0d1218, roughness: 0.1, metalness: 0.6, emissive: 0x16283a, emissiveIntensity: 0.8,
  }), 0, height + 1.16, 0);
  lens.castShadow = false;
  g.add(lens);
  return g;
}

// A radio dish on a fork mount, out on the far side of the site. It gets a `rotate` in the
// layout, and it is the one object here that shows that not all astronomy is done with light.
//
// The bowl OPENS TOWARD +Z and the shell is DoubleSide, both of which are load-bearing: a cap
// turned the wrong way renders as a smooth egg on a post, and turned the right way with
// FrontSide it renders as a hoop with three spokes and no dish, because the surface you are
// then looking at is the cap's inside -- its back faces. Both mistakes are in this project's
// history.
export function radioDish({ radius = 8, seed = 59 } = {}) {
  const g = group();
  const MAST = 6.5;
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(4.4, 0.6, 4.4), position: [0, 0.3, 0], color: CONCRETE_DK });
  parts.push({ geometry: new THREE.CylinderGeometry(0.62, 0.85, MAST, 18), position: [0, MAST / 2 + 0.5, 0], color: 0xb9bcc0 });
  parts.push({ geometry: new THREE.CylinderGeometry(1.1, 1.1, 1.0, 18), position: [0, MAST + 0.7, 0], color: 0x8d9298 });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.5, radius * 0.55, 0.7), position: [side * radius * 0.42, MAST + 1.6 + radius * 0.2, 0], color: 0xb9bcc0 });
  }
  g.add(mergedMesh(parts, { roughness: 0.55, metalness: 0.45, ...relief('metal', { seed, repeat: 3 }) }));

  // The bowl: a shallow spherical cap, seated with its vertex at the origin before it is
  // tipped, because BufferGeometry.rotateX turns about the geometry's own origin.
  const sphereR = radius * 1.5;
  const sweep = Math.asin(radius / sphereR);
  const cap = new THREE.SphereGeometry(sphereR, 40, 18, 0, Math.PI * 2, Math.PI - sweep, sweep);
  cap.translate(0, sphereR, 0);
  cap.rotateX(-Math.PI / 2 + 0.32); // opening tipped up and toward +Z
  cap.translate(0, MAST + 1.6 + radius * 0.42, 0);
  const bowl = mesh(cap, standard({
    color: 0xd8dade, roughness: 0.45, metalness: 0.35, side: THREE.DoubleSide, ...relief('metal', { seed: seed + 1, repeat: 5 }),
  }));
  bowl.receiveShadow = false;
  g.add(bowl);

  // Feed legs and the receiver at the focus.
  const feed = [];
  const focusY = MAST + 1.6 + radius * 0.42;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const leg = new THREE.CylinderGeometry(0.11, 0.13, radius * 0.95, 7);
    leg.rotateZ(0.34);
    leg.rotateY(a);
    leg.translate(Math.cos(a) * radius * 0.38, focusY + radius * 0.44, Math.sin(a) * radius * 0.38 + radius * 0.26);
    feed.push({ geometry: leg, color: 0xa8abaf });
  }
  feed.push({ geometry: new THREE.CylinderGeometry(0.5, 0.62, 1.5, 14), position: [0, focusY + radius * 0.82, radius * 0.26], color: 0x6f7378 });
  feed.push({ geometry: new THREE.ConeGeometry(0.6, 1.1, 14), rotation: [Math.PI, 0, 0], position: [0, focusY + radius * 0.62, radius * 0.26], color: 0x5b5f63 });
  g.add(mergedMesh(feed, { roughness: 0.5, metalness: 0.5 }));

  return g;
}
