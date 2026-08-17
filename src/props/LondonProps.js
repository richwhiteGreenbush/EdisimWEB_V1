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

// Westminster: the Elizabeth Tower, the Palace of Westminster's river frontage, and the
// bridge, at about 1/2.2 life size.
//
// THIS WORLD IS ONE BUILDING. Everything else is here to give it a setting and a sense of
// scale, so the detail budget is spent almost entirely on `elizabethTower()` -- roughly
// two thirds of the world's triangles are in that one prop, which is the right split when
// a world has fifteen objects instead of a hundred.
//
// WHY 1/2.2: the tower is 316ft and WORLD_BOUND_RADIUS is 195, so at true size a student
// could not get far enough away to see the top -- they would need to stand 220ft back for
// it to fit a 70-degree vertical frame, and the world ends before that. At 144ft it fits
// from about 100ft, which is inside the bound with room to walk. The placard states the
// real height, the same bargain the Colosseum makes at 1/3.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

const STONE = 0xc9b98e;          // Anston limestone, honey-coloured
const STONE_DEEP = 0xa8976f;     // the shadowed faces of mouldings
const STONE_DARK = 0x8a7a58;
const IRON_GILT = 0xc9a227;      // the gilded cast-iron spire
const IRON_DARK = 0x4a4436;
const CLOCK_FACE = 0xe8e4d4;     // opal glass, off-white and warm
const CLOCK_INK = '#2a2a26';
const CLOCK_GOLD = '#c9a227';
const ROOF_LEAD = 0x6f7a78;
const BUS_RED = 0xa8231f;
const BOX_RED = 0xa01f22;
const GLASS = 0x3d5163;
const TARMAC = 0x40444a;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ball(radius, detail = 10) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), Math.max(3, detail >> 1));
}

// A four-sided pyramid, point up. `ConeGeometry` with 4 radial segments, turned 45 degrees
// so its flats face the axes rather than its corners -- otherwise every spire and pinnacle
// in the model is rotated half a bay off the building it sits on.
function pyramid(radius, height, segments = 4) {
  const g = new THREE.ConeGeometry(radius, height, segments);
  if (segments === 4) g.rotateY(Math.PI / 4);
  return g;
}

// A vertical moulded band running round a square tower: the string courses that divide a
// gothic tower into stages. Two slabs, the upper one slightly proud, which is what reads
// as a cornice rather than as a stripe of different-coloured stone.
function stringCourse(parts, y, width, depth, { thickness = 0.9, project = 0.7 } = {}) {
  parts.push({
    geometry: new THREE.BoxGeometry(width + project, thickness, depth + project),
    position: [0, y, 0],
    color: STONE_DEEP,
  });
  parts.push({
    geometry: new THREE.BoxGeometry(width + project * 1.5, thickness * 0.45, depth + project * 1.5),
    position: [0, y + thickness * 0.6, 0],
    color: STONE,
  });
}

// A gothic pointed arch, as a FLAT PLATE standing in a wall -- a window opening or a blind
// panel. Built from a box for the jambs and a triangular prism for the head.
//
// Not a real opening: these towers are solid, and a pane placed at the instinctive inner
// face would be sealed inside the masonry where nobody can ever see it -- the Park's nature
// centre paid for that lesson. Everything here sits PROUD of the wall face.
function lancet(parts, { x, y, z, width, height, color = STONE_DARK, depth = 0.3, rotY = 0 }) {
  const shaftH = height * 0.66;
  const headH = height - shaftH;

  const shaft = new THREE.BoxGeometry(width, shaftH, depth);
  shaft.translate(0, shaftH / 2, 0);

  // The head: a 3-sided cone squashed flat, point UP. Same reason MoscowProps.kokoshnik()
  // exists -- a 3-sided cone laid on its side is a horizontal spike, not a gable.
  const head = new THREE.ConeGeometry(width / 2, headH, 3);
  head.rotateY(Math.PI / 2);
  head.scale(1, 1, depth / width);
  head.translate(0, shaftH + headH / 2, 0);

  for (const g of [shaft, head]) {
    g.rotateY(rotY);
    g.translate(x, y, z);
    parts.push({ geometry: g, color });
  }
}

// ---------------------------------------------------------------------------
// 1. The Elizabeth Tower
// ---------------------------------------------------------------------------

// The clock face, drawn rather than modelled: 312 pieces of opal glass, gilded tracery,
// Roman numerals and a Latin inscription are a PICTURE, and geometry for them would cost
// thousands of triangles to look worse. The hands ARE geometry, because they stand off the
// face and catch light, and because one of them has to be pointed at a time.
function clockFaceTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const R = w * 0.47;

    ctx.fillStyle = '#0000';
    ctx.clearRect(0, 0, w, h);

    // Opal glass ground.
    ctx.fillStyle = '#e9e5d5';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    // The gilded outer ring and the ring of small squares outside the numerals.
    ctx.strokeStyle = CLOCK_GOLD;
    ctx.lineWidth = w * 0.028;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = w * 0.012;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.80, 0, Math.PI * 2);
    ctx.stroke();

    // 60 minute squares between the two rings.
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
      const rr = R * 0.895;
      const s = w * (i % 5 === 0 ? 0.019 : 0.011);
      ctx.fillStyle = CLOCK_GOLD;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }

    // Roman numerals. IV, not IIII -- this clock uses IV, and it is the sort of detail
    // somebody who knows the building will look for.
    const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.fillStyle = CLOCK_INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(w * 0.085)}px Georgia, "Times New Roman", serif`;
    ROMAN.forEach((n, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const rr = R * 0.665;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      // Upright, not radial: the real numerals stand up the way you read them.
      ctx.fillText(n, 0, 0);
      ctx.restore();
    });

    // The tracery: gilded radial bars dividing the glass into panes.
    ctx.strokeStyle = 'rgba(201,162,39,0.85)';
    ctx.lineWidth = w * 0.006;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.20, cy + Math.sin(a) * R * 0.20);
      ctx.lineTo(cx + Math.cos(a) * R * 0.79, cy + Math.sin(a) * R * 0.79);
      ctx.stroke();
    }
    for (const rr of [0.34, 0.50, 0.65]) {
      ctx.beginPath();
      ctx.arc(cx, cy, R * rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    // The inscription band under the dial: DOMINE SALVAM FAC REGINAM NOSTRAM VICTORIAM
    // PRIMAM. It runs round the base of each face on the real building.
    ctx.fillStyle = CLOCK_INK;
    ctx.font = `bold ${Math.round(w * 0.030)}px Georgia, "Times New Roman", serif`;
    ctx.fillText('DOMINE SALVAM FAC REGINAM NOSTRAM VICTORIAM PRIMAM', cx, cy + R * 0.905);

    // The centre boss the hands turn on.
    ctx.fillStyle = CLOCK_GOLD;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.055, 0, Math.PI * 2);
    ctx.fill();
  });
}

// One clock stage face: the dial, its stone surround, and the two hands.
//
// The hands are separate meshes standing PROUD of the dial and are given a fixed reading
// rather than being animated. `rotate` turns an object about the WORLD's vertical axis,
// and a clock hand has to turn about the axis through the dial -- which is horizontal.
// There is no block that does that, so an "animated" clock here would either not move or
// would swing the whole face round like a revolving door. The world animates the bus
// instead, which the blocks can actually drive.
function clockFace(parts, hands, { size, x, z, rotY }) {
  const R = size / 2;

  // Stone surround: a square block with a circular recess implied by a ring of stone.
  parts.push({
    geometry: (() => {
      const g = new THREE.BoxGeometry(size * 1.22, size * 1.22, 0.8);
      g.rotateY(rotY);
      g.translate(x, 0, z);
      return g;
    })(),
    color: STONE_DEEP,
  });

  // Gilded ring framing the dial, proud of the stone.
  {
    const g = new THREE.TorusGeometry(R * 1.03, R * 0.075, 8, 40);
    g.rotateY(rotY);
    g.translate(x + Math.sin(rotY) * 0.5, 0, z + Math.cos(rotY) * 0.5);
    parts.push({ geometry: g, color: IRON_GILT });
  }

  // The four corner spandrels between the round dial and its square frame.
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const g = new THREE.BoxGeometry(size * 0.2, size * 0.2, 0.5);
    g.rotateZ(Math.PI / 4);
    g.rotateY(rotY);
    const px = sx * size * 0.5;
    const py = sy * size * 0.5;
    g.translate(x + Math.cos(rotY) * px + Math.sin(rotY) * 0.55, py, z - Math.sin(rotY) * px + Math.cos(rotY) * 0.55);
    parts.push({ geometry: g, color: STONE });
  }

  // The hands. Sized off the real clock: the minute hand reaches the minute ring, the hour
  // hand only about two thirds of the way -- get that ratio wrong and it reads as a toy.
  //
  // Set to 12:00 deliberately. Every face shows the same time, which is what a real clock
  // tower does and what a student notices if it is wrong.
  const handAt = (lengthFrac, widthFrac, angle) => {
    const len = R * lengthFrac;
    const g = new THREE.BoxGeometry(R * widthFrac, len, 0.22);
    g.translate(0, len / 2 - R * 0.05, 0);      // pivot at the boss
    g.rotateZ(angle);
    g.rotateY(rotY);
    hands.push({
      geometry: g,
      position: [x + Math.sin(rotY) * 0.95, 0, z + Math.cos(rotY) * 0.95],
      color: IRON_DARK,
    });
  };
  handAt(0.86, 0.055, 0);        // minute hand, straight up
  handAt(0.58, 0.085, 0);        // hour hand, also up -- twelve o'clock
}

export function elizabethTower({ height = 144, base = 18, seed = 3 } = {}) {
  const g = group();
  const parts = [];
  const gilt = [];
  const hands = [];

  // Stage heights as fractions of the whole, taken off an elevation of the real tower.
  //
  // The SPIRE gets a fifth of the total, and it is the number to protect. The first pass
  // gave it 0.185 and made the corner pinnacles nearly as tall, and the top of the tower
  // came out as a flat belfry with four spikes on it -- which is a campanile, not this
  // building. The outline of the Elizabeth Tower is a tall steep spike above an open
  // belfry, and if that reads at a distance nothing else about the top matters much.
  const SHAFT_TOP = height * 0.50;      // where the clock stage begins
  const CLOCK_H = height * 0.135;        // taller, so the dial is big enough to read
  const BELFRY_H = height * 0.09;
  const SPIRE_BASE = SHAFT_TOP + CLOCK_H + BELFRY_H;
  const SPIRE_H = height - SPIRE_BASE;

  // --- Plinth -------------------------------------------------------------
  parts.push({ geometry: new THREE.BoxGeometry(base * 1.18, height * 0.035, base * 1.18), position: [0, height * 0.0175, 0], color: STONE_DARK });
  stringCourse(parts, height * 0.037, base * 1.14, base * 1.14, { thickness: 1.1, project: 0.9 });

  // --- Shaft --------------------------------------------------------------
  // Four stages separated by string courses, each slightly narrower than the one below --
  // the taper is small but it is what stops a 144ft box reading as a chimney.
  const STAGES = 4;
  for (let s = 0; s < STAGES; s++) {
    const y0 = height * 0.05 + (SHAFT_TOP - height * 0.05) * (s / STAGES);
    const y1 = height * 0.05 + (SHAFT_TOP - height * 0.05) * ((s + 1) / STAGES);
    const w0 = base * (1 - s * 0.012);
    parts.push({
      geometry: new THREE.BoxGeometry(w0, y1 - y0, w0),
      position: [0, (y0 + y1) / 2, 0],
      color: STONE,
    });

    // Corner pilasters, running the full height of the stage and standing proud. These are
    // what the low sun rakes across; without them the shaft is four blank walls.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      parts.push({
        geometry: new THREE.BoxGeometry(w0 * 0.13, y1 - y0, w0 * 0.13),
        position: [sx * w0 * 0.5, (y0 + y1) / 2, sz * w0 * 0.5],
        color: STONE_DEEP,
      });
    }

    // Blind lancet panels, two per face per stage.
    for (let f = 0; f < 4; f++) {
      const rotY = (f / 4) * Math.PI * 2;
      for (const off of [-w0 * 0.21, w0 * 0.21]) {
        const px = Math.cos(rotY) * off + Math.sin(rotY) * (w0 / 2 + 0.15);
        const pz = -Math.sin(rotY) * off + Math.cos(rotY) * (w0 / 2 + 0.15);
        lancet(parts, {
          x: px, y: y0 + (y1 - y0) * 0.2, z: pz,
          width: w0 * 0.22, height: (y1 - y0) * 0.6, rotY, color: STONE_DEEP, depth: 0.35,
        });
      }
    }

    stringCourse(parts, y1, w0, w0, { thickness: 0.8, project: 0.6 });
  }

  // --- Clock stage --------------------------------------------------------
  const clockW = base * 1.16;
  parts.push({
    geometry: new THREE.BoxGeometry(clockW, CLOCK_H, clockW),
    position: [0, SHAFT_TOP + CLOCK_H / 2, 0],
    color: STONE,
  });

  const dialSize = CLOCK_H * 0.66;
  const faceParts = [];
  const faceHands = [];
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    clockFace(faceParts, faceHands, {
      size: dialSize,
      x: Math.sin(rotY) * (clockW / 2),
      z: Math.cos(rotY) * (clockW / 2),
      rotY,
    });
  }
  // The stone surrounds merge into the tower; the dials themselves are their own meshes
  // because they carry a texture and the tower does not.
  for (const p of faceParts) parts.push(p);
  for (const h of faceHands) hands.push(h);

  // The four dials, as textured discs standing proud of their surrounds.
  const dialTex = clockFaceTexture();
  const dialMat = standard({
    map: dialTex,
    color: CLOCK_FACE,
    roughness: 0.55,
    metalness: 0.0,
    transparent: true,
    // Self-lit, because the real dials are backlit at night and because a north-facing
    // dial on an overcast day is otherwise a grey disc with nothing readable on it.
    emissive: 0xfff6e0,
    emissiveMap: dialTex,
    emissiveIntensity: 0.42,
  });
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    const disc = mesh(
      new THREE.CircleGeometry(dialSize / 2, 48),
      dialMat,
      Math.sin(rotY) * (clockW / 2 + 0.75),
      SHAFT_TOP + CLOCK_H / 2,
      Math.cos(rotY) * (clockW / 2 + 0.75),
    );
    disc.rotation.y = rotY;
    g.add(disc);
  }

  stringCourse(parts, SHAFT_TOP + CLOCK_H, clockW, clockW, { thickness: 1.2, project: 1.0 });

  // --- Belfry -------------------------------------------------------------
  // The open stage where the bells hang. Piers with louvred openings between them -- the
  // openings are what make it read as a belfry rather than as one more solid stage.
  const belfryY = SHAFT_TOP + CLOCK_H;
  const belfryW = base * 1.0;
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    // Three piers per face.
    for (const off of [-belfryW * 0.42, 0, belfryW * 0.42]) {
      const px = Math.cos(rotY) * off + Math.sin(rotY) * (belfryW / 2);
      const pz = -Math.sin(rotY) * off + Math.cos(rotY) * (belfryW / 2);
      const pier = new THREE.BoxGeometry(belfryW * 0.14, BELFRY_H, belfryW * 0.16);
      pier.rotateY(rotY);
      pier.translate(px, belfryY + BELFRY_H / 2, pz);
      parts.push({ geometry: pier, color: STONE });
    }
    // Louvres filling the two openings: horizontal slats, dark, angled.
    for (const off of [-belfryW * 0.21, belfryW * 0.21]) {
      for (let l = 0; l < 7; l++) {
        const ly = belfryY + BELFRY_H * (0.12 + l * 0.115);
        const slat = new THREE.BoxGeometry(belfryW * 0.24, BELFRY_H * 0.055, 0.35);
        slat.rotateX(0.4);
        slat.rotateY(rotY);
        const px = Math.cos(rotY) * off + Math.sin(rotY) * (belfryW / 2 - 0.1);
        const pz = -Math.sin(rotY) * off + Math.cos(rotY) * (belfryW / 2 - 0.1);
        slat.translate(px, ly, pz);
        parts.push({ geometry: slat, color: IRON_DARK });
      }
    }
  }
  stringCourse(parts, belfryY + BELFRY_H, belfryW, belfryW, { thickness: 1.0, project: 1.2 });

  // --- Spire --------------------------------------------------------------
  // Cast iron, gilded, and STEEP -- about 70 degrees. A shallow spire reads as a roof, and
  // the tower's whole outline depends on this being a spike.
  const spireY = belfryY + BELFRY_H;

  // Corner pinnacles at the spire's foot. Four of them, each its own little spire, which
  // is most of what makes the top of this tower busy rather than plain.
  // Kept deliberately SHORT -- a third of the spire's height, not most of it. They frame
  // the spire; they must not compete with it.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = sx * belfryW * 0.52;
    const pz = sz * belfryW * 0.52;
    parts.push({
      geometry: new THREE.BoxGeometry(belfryW * 0.15, SPIRE_H * 0.16, belfryW * 0.15),
      position: [px, spireY + SPIRE_H * 0.08, pz],
      color: STONE,
    });
    const cap = pyramid(belfryW * 0.12, SPIRE_H * 0.2);
    cap.translate(px, spireY + SPIRE_H * 0.26, pz);
    gilt.push({ geometry: cap, color: IRON_GILT });
  }

  // Lucarnes: the little gabled dormers round the foot of the spire.
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    const gable = new THREE.ConeGeometry(belfryW * 0.17, SPIRE_H * 0.2, 3);
    gable.rotateY(Math.PI / 2);
    gable.scale(1, 1, 0.35);
    gable.rotateY(rotY);
    gable.translate(Math.sin(rotY) * belfryW * 0.34, spireY + SPIRE_H * 0.14, Math.cos(rotY) * belfryW * 0.34);
    gilt.push({ geometry: gable, color: IRON_GILT });
  }

  // The spire proper. NARROW at the base and running most of the stage's height -- about
  // 74 degrees from horizontal. A wide shallow pyramid reads as a roof; this has to read as
  // a spike, and the base radius is what decides which.
  //
  // Two stages: a short splayed skirt where it meets the belfry (real spires have one --
  // it is what hides the join), then the long taper.
  const skirt = pyramid(belfryW * 0.5, SPIRE_H * 0.14);
  skirt.translate(0, spireY + SPIRE_H * 0.07, 0);
  gilt.push({ geometry: skirt, color: IRON_GILT });

  const mainSpire = pyramid(belfryW * 0.29, SPIRE_H * 0.76);
  mainSpire.translate(0, spireY + SPIRE_H * 0.13 + SPIRE_H * 0.38, 0);
  gilt.push({ geometry: mainSpire, color: IRON_GILT });

  // Ribs up the spire's arrises, standing proud -- what catches the light on the real one.
  // They lean IN with the spire's own taper; vertical ribs on a tapering cone stand off it
  // at the top and read as wires.
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * Math.PI * 2 + Math.PI / 4;
    const rib = new THREE.BoxGeometry(0.3, SPIRE_H * 0.7, 0.3);
    rib.rotateX(-0.18);
    rib.rotateY(a);
    rib.translate(Math.sin(a) * belfryW * 0.13, spireY + SPIRE_H * 0.48, Math.cos(a) * belfryW * 0.13);
    gilt.push({ geometry: rib, color: 0xd9b53a });
  }

  // Finial and the Ayrton Light -- the lantern lit when Parliament is sitting.
  gilt.push({ geometry: ball(belfryW * 0.075, 12), position: [0, spireY + SPIRE_H * 0.845, 0], color: IRON_GILT });
  const lantern = new THREE.CylinderGeometry(belfryW * 0.05, belfryW * 0.05, SPIRE_H * 0.08, 10);
  lantern.translate(0, spireY + SPIRE_H * 0.9, 0);
  gilt.push({ geometry: lantern, color: 0xf2e2a0 });
  const tip = pyramid(belfryW * 0.042, SPIRE_H * 0.13);
  tip.translate(0, spireY + SPIRE_H * 1.0, 0);
  gilt.push({ geometry: tip, color: IRON_GILT });

  const stoneMesh = mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.88,
    ...relief('stone', { seed, repeat: 7, strength: 0.7 }),
  });
  g.add(stoneMesh);

  // The gilt is its own merge with its own material: at the stone's roughness it reads as
  // yellow paint, and gold is mostly about a low roughness catching a highlight.
  g.add(mergedMesh(gilt, { color: 0xffffff, roughness: 0.34, metalness: 0.5 }));
  g.add(mergedMesh(hands, { color: 0xffffff, roughness: 0.5, metalness: 0.3 }));

  return g;
}

// ---------------------------------------------------------------------------
// 2. The Palace of Westminster's river frontage
// ---------------------------------------------------------------------------

// A run of perpendicular gothic frontage: a repeating bay of panelled wall, tall windows
// and pinnacles, with a pitched lead roof. Built as a repeating bay on purpose -- the real
// building is 873ft of almost exactly the same bay over and over, and that repetition IS
// its character.
export function westminsterWing({ bays = 9, bayWidth = 11, height = 40, depth = 26, seed = 12 } = {}) {
  const g = group();
  const parts = [];
  const width = bays * bayWidth;

  // Body.
  parts.push({ geometry: new THREE.BoxGeometry(width, height, depth), position: [0, height / 2, 0], color: STONE });
  // Plinth and cornice.
  parts.push({ geometry: new THREE.BoxGeometry(width + 1.4, height * 0.09, depth + 1.4), position: [0, height * 0.045, 0], color: STONE_DARK });
  stringCourse(parts, height * 0.52, width, depth, { thickness: 0.7, project: 0.7 });
  stringCourse(parts, height, width, depth, { thickness: 1.3, project: 1.4 });

  for (let b = 0; b < bays; b++) {
    const x = -width / 2 + (b + 0.5) * bayWidth;

    // Buttress between bays, standing proud and carrying a pinnacle.
    if (b > 0) {
      const bx = -width / 2 + b * bayWidth;
      parts.push({ geometry: new THREE.BoxGeometry(bayWidth * 0.16, height * 1.02, 1.5), position: [bx, height * 0.51, depth / 2 + 0.6], color: STONE_DEEP });
      parts.push({ geometry: new THREE.BoxGeometry(bayWidth * 0.2, height * 0.1, 2.0), position: [bx, height * 1.04, depth / 2 + 0.8], color: STONE_DEEP });
      const pin = pyramid(bayWidth * 0.11, height * 0.17);
      pin.translate(bx, height * 1.17, depth / 2 + 0.8);
      parts.push({ geometry: pin, color: STONE });
    }

    // Two tiers of tall windows per bay, on the river face.
    for (const [wy, wh] of [[height * 0.14, height * 0.32], [height * 0.58, height * 0.34]]) {
      lancet(parts, {
        x, y: wy, z: depth / 2 + 0.2,
        width: bayWidth * 0.46, height: wh, color: GLASS, depth: 0.5,
      });
    }
  }

  // Pitched lead roof with a cresting ridge.
  const roofH = height * 0.22;
  for (const sz of [-1, 1]) {
    const rise = roofH;
    const run = depth / 2;
    const len = Math.hypot(run, rise);
    const slope = new THREE.BoxGeometry(width, 0.6, len);
    // atan2(rise, run) -- from HORIZONTAL -- and +sz so the far end drops. See the note in
    // StormProps.wreckedFarmhouse: negated, this becomes a valley.
    slope.rotateX(sz * Math.atan2(rise, run));
    slope.translate(0, height + rise / 2 + 0.5, sz * depth / 4);
    parts.push({ geometry: slope, color: ROOF_LEAD });
  }
  for (let i = 0; i < Math.round(width / 3); i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(0.5, 1.1, 0.3),
      position: [-width / 2 + (i + 0.5) * 3, height + roofH + 1.1, 0],
      color: IRON_DARK,
    });
  }

  g.add(mergedMesh(parts, {
    color: 0xffffff,
    roughness: 0.86,
    ...relief('stone', { seed, repeat: 6, strength: 0.6 }),
  }));
  return g;
}

// The Victoria Tower: the square tower at the far end, taller than it is wide by about
// four to one, with a flat top and a flagstaff.
export function victoriaTower({ height = 88, base = 22, seed = 19 } = {}) {
  const g = group();
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(base * 1.12, height * 0.05, base * 1.12), position: [0, height * 0.025, 0], color: STONE_DARK });
  for (let s = 0; s < 5; s++) {
    const y0 = height * 0.05 + (height * 0.86 - height * 0.05) * (s / 5);
    const y1 = height * 0.05 + (height * 0.86 - height * 0.05) * ((s + 1) / 5);
    parts.push({ geometry: new THREE.BoxGeometry(base, y1 - y0, base), position: [0, (y0 + y1) / 2, 0], color: STONE });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      parts.push({ geometry: new THREE.BoxGeometry(base * 0.12, y1 - y0, base * 0.12), position: [sx * base * 0.5, (y0 + y1) / 2, sz * base * 0.5], color: STONE_DEEP });
    }
    for (let f = 0; f < 4; f++) {
      const rotY = (f / 4) * Math.PI * 2;
      lancet(parts, {
        x: Math.sin(rotY) * (base / 2 + 0.15), y: y0 + (y1 - y0) * 0.22, z: Math.cos(rotY) * (base / 2 + 0.15),
        width: base * 0.3, height: (y1 - y0) * 0.55, rotY, color: STONE_DEEP, depth: 0.35,
      });
    }
    stringCourse(parts, y1, base, base, { thickness: 0.7, project: 0.6 });
  }

  // Pierced parapet and corner turrets.
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    for (let i = 0; i < 7; i++) {
      const off = (-3 + i) * base * 0.135;
      const px = Math.cos(rotY) * off + Math.sin(rotY) * (base / 2);
      const pz = -Math.sin(rotY) * off + Math.cos(rotY) * (base / 2);
      const merlon = new THREE.BoxGeometry(base * 0.09, height * 0.05, base * 0.08);
      merlon.rotateY(rotY);
      merlon.translate(px, height * 0.895, pz);
      parts.push({ geometry: merlon, color: STONE });
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({ geometry: new THREE.BoxGeometry(base * 0.18, height * 0.12, base * 0.18), position: [sx * base * 0.5, height * 0.93, sz * base * 0.5], color: STONE });
    const cap = pyramid(base * 0.15, height * 0.09);
    cap.translate(sx * base * 0.5, height * 1.03, sz * base * 0.5);
    parts.push({ geometry: cap, color: STONE_DEEP });
  }
  parts.push({ geometry: new THREE.CylinderGeometry(0.22, 0.3, height * 0.16, 8), position: [0, height * 0.95, 0], color: 0xe6e2d6 });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.87, ...relief('stone', { seed, repeat: 6, strength: 0.6 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// 3. Westminster Bridge
// ---------------------------------------------------------------------------

// Seven segmental arches, cast-iron green, with the gothic-detailed parapet Charles Barry
// insisted on so it would sit beside his Palace.
export function westminsterBridge({ span = 130, width = 26, arches = 5, deckY = 5, seed = 27 } = {}) {
  const g = group();
  const parts = [];
  const GREEN = 0x2f5b4a;
  const bay = span / arches;

  // Deck.
  parts.push({ geometry: new THREE.BoxGeometry(span, 1.4, width), position: [0, deckY, 0], color: TARMAC });
  parts.push({ geometry: new THREE.BoxGeometry(span, 0.7, width + 1.6), position: [0, deckY - 0.9, 0], color: GREEN });

  for (let a = 0; a < arches; a++) {
    const cx = -span / 2 + (a + 0.5) * bay;

    // A segmental arch -- a shallow arc, not a semicircle, which is what makes it read as
    // a Victorian iron bridge rather than a Roman aqueduct. Voussoir blocks stepped round
    // a true circle; give the ring an independent rise and the blocks splay outward.
    const R = bay * 0.62;
    const rise = bay * 0.3;
    const springY = deckY - 1.3 - rise;
    const half = Math.asin(Math.min(1, (bay * 0.46) / R));
    const N = 13;
    for (let i = 0; i <= N; i++) {
      const t = -half + (2 * half) * (i / N);
      const bx = cx + Math.sin(t) * R;
      const by = springY + Math.cos(t) * R;
      const v = new THREE.BoxGeometry(bay * 0.1, 1.5, width + 1.2);
      v.rotateZ(-t);
      v.translate(bx, by, 0);
      parts.push({ geometry: v, color: GREEN });
    }

    // Pier below each springing.
    if (a > 0) {
      const px = -span / 2 + a * bay;
      parts.push({ geometry: new THREE.BoxGeometry(bay * 0.16, deckY + 4, width + 2), position: [px, (deckY - 4) / 2, 0], color: STONE_DARK });
    }
  }

  // Parapet: pierced quatrefoil panels between posts, both sides.
  for (const sz of [-1, 1]) {
    const z = sz * (width / 2 + 0.4);
    const posts = Math.round(span / 8);
    for (let i = 0; i <= posts; i++) {
      const x = -span / 2 + (i / posts) * span;
      parts.push({ geometry: new THREE.BoxGeometry(1.0, 3.4, 1.0), position: [x, deckY + 2.4, z], color: GREEN });
    }
    parts.push({ geometry: new THREE.BoxGeometry(span, 0.5, 1.2), position: [0, deckY + 3.9, z], color: GREEN });
    parts.push({ geometry: new THREE.BoxGeometry(span, 0.35, 0.7), position: [0, deckY + 2.2, z], color: GREEN });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.7, metalness: 0.25, ...relief('metal', { seed, repeat: 5, strength: 0.4 }) }));
  return g;
}

// A stretch of the Thames. One opaque plane -- see SeaProps.waterSurface for why a
// translucent one is both more expensive and less accurate.
export function thamesWater({ width = 300, depth = 120, seed = 31 } = {}) {
  const g = group();
  const texture = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#4b5f63';
    ctx.fillRect(0, 0, w, h);
    // Long flat streaks, not ripples: a tidal river seen from a bridge is mostly smeared
    // reflection, and round ripples read as a swimming pool.
    for (let i = 0; i < 260; i++) {
      const y = randomIn(rng, 0, h);
      const len = randomIn(rng, w * 0.05, w * 0.4);
      ctx.strokeStyle = `rgba(${randomIn(rng, 120, 190) | 0},${randomIn(rng, 140, 200) | 0},${randomIn(rng, 150, 205) | 0},${randomIn(rng, 0.04, 0.16).toFixed(3)})`;
      ctx.lineWidth = randomIn(rng, 1, 5);
      ctx.beginPath();
      ctx.moveTo(randomIn(rng, 0, w), y);
      ctx.lineTo(randomIn(rng, 0, w) + len, y + randomIn(rng, -2, 2));
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);

  const m = mesh(new THREE.PlaneGeometry(width, depth), standard({
    // WHITE, not RIVER. A material's `map` MULTIPLIES its `color`, and the canvas above is
    // already painted the river's own colour -- so passing that colour here squared it and
    // the Thames rendered near-black. The same multiply that turned the bear dens' facade
    // black in ParkProps, and the rule is the same: when a map carries the colour, the
    // material must not.
    color: 0xffffff, map: texture, roughness: 0.72, metalness: 0.05,
  }), 0, 0.05, 0);
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = false;
  m.castShadow = false;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// 4. Street furniture
// ---------------------------------------------------------------------------

// A K6 telephone box. Small, and the single most recognisable object in Britain -- worth
// its object slot purely for the scale it gives everything around it.
export function phoneBox({ height = 8.2, width = 3 } = {}) {
  const g = group();
  const parts = [];
  const glassParts = [];
  const bodyH = height * 0.78;

  parts.push({ geometry: new THREE.BoxGeometry(width * 1.12, 0.35, width * 1.12), position: [0, 0.17, 0], color: 0x4a4a4a });

  // Four corner posts and the panelled base -- a solid box with windows drawn on is the
  // trap every vehicle in CityProps hit; this is a frame with glass hung in it.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({ geometry: new THREE.BoxGeometry(width * 0.16, bodyH, width * 0.16), position: [sx * width * 0.42, bodyH / 2 + 0.3, sz * width * 0.42], color: BOX_RED });
  }
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.94, bodyH * 0.22, width * 0.94), position: [0, bodyH * 0.11 + 0.3, 0], color: BOX_RED });

  // Glazing: three sides of small panes, plus the door.
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    for (let r = 0; r < 4; r++) {
      const gy = bodyH * (0.32 + r * 0.16) + 0.3;
      const pane = new THREE.BoxGeometry(width * 0.72, bodyH * 0.13, 0.12);
      pane.rotateY(rotY);
      pane.translate(Math.sin(rotY) * width * 0.46, gy, Math.cos(rotY) * width * 0.46);
      glassParts.push({ geometry: pane, color: 0xbfd4d8 });
    }
  }

  // The crown-topped entablature and domed roof.
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.06, height * 0.09, width * 1.06), position: [0, bodyH + 0.3 + height * 0.045, 0], color: BOX_RED });
  const dome = new THREE.SphereGeometry(width * 0.52, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.55, 1);
  dome.translate(0, bodyH + 0.3 + height * 0.09, 0);
  parts.push({ geometry: dome, color: BOX_RED });
  // TELEPHONE panels under the roof, self-lit.
  for (let f = 0; f < 4; f++) {
    const rotY = (f / 4) * Math.PI * 2;
    const p = new THREE.BoxGeometry(width * 0.6, height * 0.05, 0.1);
    p.rotateY(rotY);
    p.translate(Math.sin(rotY) * width * 0.54, bodyH + 0.3 + height * 0.045, Math.cos(rotY) * width * 0.54);
    glassParts.push({ geometry: p, color: 0xf6f1de });
  }

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.55, metalness: 0.12 }));
  g.add(mergedMesh(glassParts, { color: 0xffffff, roughness: 0.2, metalness: 0.1, emissive: 0x3a4348, emissiveIntensity: 0.3 }));
  return g;
}

// A Routemaster. This is the object the world ANIMATES, so it is built to be read in
// motion and from a distance: the shape that matters is the open rear platform and the
// half-cab, not the panel gaps.
export function routemaster({ length = 13, width = 5.2, height = 7.6 } = {}) {
  const g = group();
  const parts = [];
  const glass = [];
  const wheelR = 0.95;
  const floor = wheelR * 0.85;
  const deckH = (height - floor) / 2;

  // Lower and upper deck bodies.
  parts.push({ geometry: new THREE.BoxGeometry(width, deckH, length), position: [0, floor + deckH / 2, 0], color: BUS_RED });
  parts.push({ geometry: new THREE.BoxGeometry(width, deckH, length * 0.97), position: [0, floor + deckH * 1.5, 0], color: BUS_RED });
  // The cream band between decks -- the thing that says London bus at a hundred feet.
  parts.push({ geometry: new THREE.BoxGeometry(width * 1.02, deckH * 0.12, length * 0.99), position: [0, floor + deckH, 0], color: 0xe8dfc4 });
  // Domed roof.
  const roof = new THREE.CylinderGeometry(width * 0.5, width * 0.5, length * 0.96, 14, 1, false, 0, Math.PI);
  roof.rotateZ(Math.PI / 2);
  roof.rotateY(Math.PI / 2);
  roof.scale(1, 0.42, 1);
  roof.translate(0, floor + deckH * 2, 0);
  parts.push({ geometry: roof, color: BUS_RED });

  // Windows, both decks, as a band of panes rather than one strip.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = -length * 0.38 + i * length * 0.145;
      for (const dy of [floor + deckH * 0.62, floor + deckH * 1.6]) {
        const pane = new THREE.BoxGeometry(0.12, deckH * 0.42, length * 0.115);
        pane.translate(sx * width * 0.5, dy, z);
        glass.push({ geometry: pane, color: GLASS });
      }
    }
  }
  // Front upper windscreen + the half-cab windscreen.
  glass.push({ geometry: new THREE.BoxGeometry(width * 0.8, deckH * 0.44, 0.12), position: [0, floor + deckH * 1.6, length / 2], color: GLASS });
  glass.push({ geometry: new THREE.BoxGeometry(width * 0.42, deckH * 0.4, 0.12), position: [-width * 0.22, floor + deckH * 0.66, length / 2], color: GLASS });

  // The open rear platform: a cutout at the near-side back corner with a pole. This is the
  // Routemaster's one unmistakable feature and it is worth the four extra parts.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.46, deckH, length * 0.16), position: [width * 0.27, floor + deckH / 2, -length * 0.42], color: 0x2b1c1a });
  parts.push({ geometry: new THREE.CylinderGeometry(0.09, 0.09, deckH, 8), position: [width * 0.06, floor + deckH / 2, -length * 0.42], color: 0xd8d2c0 });

  // Radiator + bonnet.
  parts.push({ geometry: new THREE.BoxGeometry(width * 0.44, deckH * 0.5, length * 0.07), position: [width * 0.2, floor + deckH * 0.4, length * 0.5], color: 0x8f9296 });

  for (const sx of [-1, 1]) {
    for (const pz of [length * 0.32, -length * 0.3]) {
      const w = new THREE.CylinderGeometry(wheelR, wheelR, 0.62, 14);
      w.rotateZ(Math.PI / 2);
      w.translate(sx * width * 0.48, wheelR, pz);
      parts.push({ geometry: w, color: 0x22242a });
    }
  }

  // Destination blind, self-lit.
  glass.push({ geometry: new THREE.BoxGeometry(width * 0.66, deckH * 0.2, 0.1), position: [0, floor + deckH * 1.92, length * 0.49], color: 0xf0e6b8 });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.55, metalness: 0.2 }));
  g.add(mergedMesh(glass, { color: 0xffffff, roughness: 0.2, metalness: 0.15, emissive: 0x2a2f36, emissiveIntensity: 0.25 }));
  return g;
}

// A Victorian cast-iron lamp standard with a lantern head.
export function embankmentLamp({ height = 15, seed = 41 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.CylinderGeometry(0.85, 1.05, height * 0.07, 12), position: [0, height * 0.035, 0], color: 0x22301f });
  parts.push({ geometry: new THREE.CylinderGeometry(0.3, 0.5, height * 0.78, 12), position: [0, height * 0.46, 0], color: 0x22301f });
  parts.push({ geometry: new THREE.SphereGeometry(0.55, 12, 8), position: [0, height * 0.86, 0], color: 0x22301f });
  const lantern = new THREE.CylinderGeometry(0.75, 0.95, height * 0.14, 6);
  lantern.translate(0, height * 0.94, 0);
  parts.push({ geometry: lantern, color: 0x22301f });
  const cap = pyramid(0.95, height * 0.07, 6);
  cap.translate(0, height * 1.03, 0);
  parts.push({ geometry: cap, color: 0x22301f });

  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.6, metalness: 0.35, ...relief('metal', { seed, repeat: 4, strength: 0.5 }) }));
  // The lit glass, opaque and merged -- the New York lamps' lesson: a dozen lamps at three
  // translucent glass meshes apiece was the largest block of transparency in any world,
  // for glass that was visually indistinguishable from solid.
  g.add(mergedMesh(
    [{ geometry: new THREE.CylinderGeometry(0.62, 0.8, height * 0.12, 6), position: [0, height * 0.94, 0], color: 0xffe9b0 }],
    { color: 0xffffff, roughness: 0.3, emissive: 0xffca62, emissiveIntensity: 0.85 },
  ));
  return g;
}

// A London plane, the tree that lines every embankment in the city. Its bark is the point:
// it flakes into pale patches, which is why the trunk is mottled rather than plain brown.
export function planeTree({ height = 26, seed = 51 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const trunk = [];
  const leaves = [];
  const trunkH = height * 0.42;

  trunk.push({ geometry: new THREE.CylinderGeometry(height * 0.028, height * 0.05, trunkH, 12), position: [0, trunkH / 2, 0], color: 0x8d8a72 });
  // Pale flaking patches.
  for (let i = 0; i < 14; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const y = randomIn(rng, trunkH * 0.15, trunkH * 0.95);
    const r = height * randomIn(rng, 0.02, 0.036);
    const patch = ball(r, 6);
    patch.scale(1, randomIn(rng, 0.5, 1.4), 0.35);
    patch.rotateY(a);
    patch.translate(Math.sin(a) * height * 0.032, y, Math.cos(a) * height * 0.032);
    trunk.push({ geometry: patch, color: 0xc9c4a8 });
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + randomIn(rng, -0.3, 0.3);
    const limb = new THREE.CylinderGeometry(height * 0.012, height * 0.022, height * 0.24, 8);
    limb.rotateZ(0.55);
    limb.rotateY(a);
    limb.translate(Math.sin(a) * height * 0.05, trunkH + height * 0.08, Math.cos(a) * height * 0.05);
    trunk.push({ geometry: limb, color: 0x8d8a72 });
  }

  for (let i = 0; i < 9; i++) {
    const a = randomIn(rng, 0, Math.PI * 2);
    const rad = randomIn(rng, 0, height * 0.2);
    const r = height * randomIn(rng, 0.13, 0.2);
    const blob = ball(r, 10);
    blob.scale(1, randomIn(rng, 0.62, 0.85), 1);
    blob.translate(Math.cos(a) * rad, trunkH + height * randomIn(rng, 0.2, 0.42), Math.sin(a) * rad);
    leaves.push({ geometry: blob, color: i % 3 === 0 ? 0x4e6b33 : 0x5f7d3c });
  }

  g.add(mergedMesh(trunk, { color: 0xffffff, roughness: 0.9, ...relief('bark', { seed, repeat: 4, strength: 0.8 }) }));
  g.add(mergedMesh(leaves, { color: 0xffffff, roughness: 0.95 }));
  return g;
}

// The riverside parapet wall along the embankment, with its cast-iron lions' head mooring
// rings -- a low object whose real job is to stop the ground and the river meeting at a
// bare seam.
export function embankmentWall({ length = 120, height = 4.2, seed = 61 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.BoxGeometry(length, height, 2.4), position: [0, height / 2, 0], color: 0x8d8574 });
  parts.push({ geometry: new THREE.BoxGeometry(length, 0.55, 3.2), position: [0, height, 0], color: 0x9a927f });
  const n = Math.round(length / 14);
  for (let i = 0; i < n; i++) {
    const x = -length / 2 + (i + 0.5) * (length / n);
    parts.push({ geometry: ball(0.6, 8), position: [x, height * 0.6, 1.4], color: 0x2f3a33 });
    parts.push({ geometry: new THREE.TorusGeometry(0.5, 0.11, 6, 14), position: [x, height * 0.35, 1.5], color: 0x2f3a33 });
  }
  g.add(mergedMesh(parts, { color: 0xffffff, roughness: 0.9, ...relief('stone', { seed, repeat: 6, strength: 0.6 }) }));
  return g;
}
