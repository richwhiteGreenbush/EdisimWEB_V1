import * as THREE from 'three';
import {
  standard, mesh, box, cyl, sphere, group, mergeColored, mergedMesh, relief,
  canvasTexture, signPanel, taperedTube, seededRandom, randomIn,
} from '../PropKit.js';

// Machu Picchu: the citadel on the ridge, at 7,970ft, with the cloud still in the valley.
//
// Unlike Rome and Egypt this world is mostly at TRUE SIZE. An Inca house is a house, a
// terrace wall is eight feet of stone, and the plaza is a plaza -- all of it fits. The one
// thing that cannot is Huayna Picchu, the sugarloaf behind the site, which stands 1,180ft
// above the ruins; it is built as a scaled peak at the edge of the world, the same
// compromise MarsProps.distantMountain() makes.
//
// The masonry is the lesson here, and it is worth stating what makes it different: the
// blocks are cut to fit each other rather than to a module, laid with NO mortar at all,
// and the walls lean inward. Every opening is a trapezoid, wider at the bottom. All three
// are earthquake engineering -- the region is seismically violent, and buildings the
// Spanish put up alongside these have fallen down twice since.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js.

const GRANITE = 0x9a958c;
const GRANITE_LIGHT = 0xb0aba0;
const GRANITE_DARK = 0x7c776e;
const GRANITE_WARM = 0xa39683;
// Ichu thatch, weathered. Deliberately desaturated: a fresh straw yellow reads as plastic
// on a smooth roof plane, and these roofs are grey-brown within a season of being laid.
const THATCH = 0x8f7d58;
const THATCH_DARK = 0x6b5d3e;

const STONE_TONES = [GRANITE, GRANITE_LIGHT, GRANITE_DARK, GRANITE_WARM, 0x8e897f];

// ---------------------------------------------------------------------------
// Masonry
// ---------------------------------------------------------------------------

// A panel of mortarless polygonal ashlar, authored in the XY plane with its base at y=0
// and its thickness along Z.
//
// Each block is a low CylinderGeometry with five to eight sides seen face-on, which is
// what gives the irregular many-angled faces the Inca stonework is famous for -- a wall
// of rectangles reads as brick, and brick is the one thing this is not. Blocks are laid
// in courses of varying height and overlap their neighbours slightly, because the joints
// have to be invisible: the whole claim about this masonry is that a knife blade will not
// go into one.
function ashlarPanel(width, height, depth, rng, {
  course = 1.5, batter = 0, tones = STONE_TONES,
} = {}) {
  const parts = [];
  const rows = Math.max(1, Math.round(height / course));
  const rowH = height / rows;

  // A SOLID DARK BACKING, and it is the whole trick.
  //
  // The first version of this had polygonal blocks and nothing behind them, and the wall
  // came out looking like a heap of river cobbles -- because wherever two polygons failed
  // to meet you saw another block further back, so every joint read as a rounded edge
  // rather than as a line. With a dark slab behind, the gaps between the faces become
  // JOINTS, which is precisely how a photograph of this masonry reads: light polygonal
  // faces separated by fine dark lines.
  parts.push({
    geometry: new THREE.BoxGeometry(width, height, depth * 0.62),
    color: 0x6a655c,
    position: [0, height / 2, -depth * 0.2],
  });

  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * rowH;
    // Walls lean inward. `batter` is the total lean over the full height, so each course
    // is a little narrower and a little further back than the one below it.
    const inset = batter * (y / height);
    const w = width - inset * 2;
    let x = -w / 2;
    while (x < w / 2 - 0.05) {
      const bw = Math.min(randomIn(rng, rowH * 0.95, rowH * 2.4), w / 2 - x);
      if (bw < 0.12) break;
      // Six to eight sides, so no two blocks have the same outline and none of them is a
      // rectangle -- the "many-angled stone" is the signature of this masonry.
      //
      // The base rotation is pi/sides, which puts a FLAT EDGE along the top and bottom of
      // every block, and the jitter on top of it is small. That matters: this is coursed
      // polygonal work, so the bed joints are roughly level even though no two stones are
      // the same shape. Rotated freely the blocks point corners at each other and the wall
      // turns into crazy paving.
      const sides = 6 + Math.floor(rng() * 3);
      const g = new THREE.CylinderGeometry(0.5, 0.5, depth * 0.52, sides);
      g.rotateX(Math.PI / 2);
      g.rotateZ(Math.PI / sides + randomIn(rng, -0.13, 0.13));
      // Heavily overfilled, so neighbouring faces bite into each other and what shows
      // between them is a fine dark JOINT. Inscribed in its cell -- or even at the 1.22
      // this started at -- a polygon leaves its four corners open, the backing shows
      // through in wedges, and the result reads as cobbles bedded in mortar. Which is the
      // exact opposite of the one thing this masonry is famous for.
      g.scale(bw * 1.42, rowH * 1.34, 1);
      g.translate(x + bw / 2, y + randomIn(rng, -0.03, 0.03) * rowH, depth * 0.2 - inset);
      parts.push({ geometry: g, color: tones[Math.floor(rng() * tones.length)] });
      x += bw;
    }
  }
  return parts;
}

// A free-standing stretch of that wall, with a trapezoidal doorway through it.
//
// The doorway is the teaching object: wider at the sill than at the lintel, which is what
// every Inca opening does and what keeps the jambs standing when the ground moves.
export function incaWall({
  width = 18, height = 9, depth = 2.2, doorway = true, niches = 2, seed = 5,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const batter = height * 0.09;

  if (!doorway) {
    parts.push(...ashlarPanel(width, height, depth, rng, { batter }));
  } else {
    const doorH = height * 0.68;
    const sillW = width * 0.2;
    const lintelW = sillW * 0.74;
    const gap = (sillW + lintelW) / 2;
    const sideW = (width - gap) / 2;
    for (const side of [-1, 1]) {
      const panel = ashlarPanel(sideW, height, depth, rng, { batter: batter * 0.6 });
      for (const p of panel) {
        p.geometry.translate(side * (gap / 2 + sideW / 2), 0, 0);
        parts.push(p);
      }
    }
    // The jambs actually lean, so the opening narrows toward the top.
    for (const side of [-1, 1]) {
      const jamb = new THREE.BoxGeometry(width * 0.035, doorH, depth);
      jamb.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(side * ((sillW + lintelW) / 4), doorH / 2, 0)
        .multiply(new THREE.Matrix4().makeRotationZ(side * Math.atan2((sillW - lintelW) / 2, doorH))));
      parts.push({ geometry: jamb, color: GRANITE_LIGHT });
    }
    // A single monolithic lintel. These weigh several tons and were dragged up a mountain.
    parts.push({ geometry: new THREE.BoxGeometry(lintelW * 2.1, height * 0.11, depth * 1.08), color: GRANITE_DARK, position: [0, doorH + height * 0.055, 0] });
    const capH = height - doorH - height * 0.11;
    if (capH > 0.3) {
      const cap = ashlarPanel(gap * 1.05, capH, depth, rng, {});
      for (const p of cap) {
        p.geometry.translate(0, doorH + height * 0.11, 0);
        parts.push(p);
      }
    }
  }

  // Trapezoidal wall niches -- storage, and probably display. Same shape as the doors,
  // for the same reason.
  //
  // A niche is a HOLE, and a dark rectangle laid on the wall face is not one: the first
  // pass put the dark box a couple of inches PROUD of the stonework, and every niche read
  // as a black sticker stuck on the outside. It needs a frame standing forward of the wall
  // with the dark panel set back behind it, which is what actually casts the shadow that
  // says "recess".
  for (let i = 0; i < niches; i++) {
    const x = (i - (niches - 1) / 2) * (width / (niches + 0.7));
    if (doorway && Math.abs(x) < width * 0.16) continue;
    const nh = height * 0.3;
    const nw = width * 0.1;
    const ny = height * 0.34;
    // ashlarPanel has already filled this wall solid and knows nothing about niches, so
    // the recess cannot be cut BACK into it -- set behind the blocks it simply disappears,
    // which is what the second attempt at this did. It is built forward instead: a dark
    // panel a hair proud of the stonework, and a frame projecting further still. The frame
    // is what casts the shadow, and the shadow is what says "hole".
    const faceZ = depth * 0.46;
    parts.push({ geometry: new THREE.BoxGeometry(nw * 1.05, nh, depth * 0.06), color: 0x322e2a, position: [x, ny + nh / 2, faceZ + depth * 0.02] });
    // Jambs, leaning like the doorway's -- a niche is a small door.
    for (const side of [-1, 1]) {
      const jamb = new THREE.BoxGeometry(width * 0.03, nh, depth * 0.2);
      jamb.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(side * nw * 0.58, ny + nh / 2, faceZ + depth * 0.08)
        .multiply(new THREE.Matrix4().makeRotationZ(side * 0.055)));
      parts.push({ geometry: jamb, color: GRANITE_LIGHT });
    }
    parts.push({ geometry: new THREE.BoxGeometry(nw * 1.55, height * 0.045, depth * 0.24), color: GRANITE_DARK, position: [x, ny + nh + height * 0.022, faceZ + depth * 0.09] });
    parts.push({ geometry: new THREE.BoxGeometry(nw * 1.4, height * 0.03, depth * 0.22), color: GRANITE_LIGHT, position: [x, ny - height * 0.012, faceZ + depth * 0.08] });
  }

  return group(mergedMesh(parts, { roughness: 0.95, ...relief('stone', { seed, repeat: 4 }) }));
}

// The andenes -- agricultural terraces. Not decoration and not just flat ground: they are
// a soil-and-drainage machine. Each one is layered gravel, then sand, then topsoil carried
// up from the valley, so the mountain rain runs THROUGH the hillside instead of down it.
// It is why the site is still standing after five centuries of it.
export function incaTerraces({
  width = 60, steps = 7, rise = 5, tread = 9, curve = 0, seed = 7,
} = {}) {
  const rng = seededRandom(seed);
  const wall = [];
  const soil = [];
  for (let i = 0; i < steps; i++) {
    const y = i * rise;
    const z = -i * tread;
    // A gentle plan curve, because the terraces follow the contour of a ridge and a
    // straight run of seven reads as a staircase in a stadium.
    const bow = curve * (1 - Math.abs(i / steps - 0.5) * 2);
    const panel = ashlarPanel(width, rise, 1.6, rng, { course: 1.2, batter: rise * 0.12 });
    for (const p of panel) {
      p.geometry.translate(0, y, z + bow);
      wall.push(p);
    }
    // The planting surface behind each wall.
    soil.push({
      geometry: new THREE.BoxGeometry(width * 0.99, 0.5, tread),
      color: i % 2 ? 0x5f6b3c : 0x6a7442,
      position: [0, y + rise - 0.25, z + bow - tread / 2],
    });
    // Flying steps: single stones let into the face, projecting, so you can climb from one
    // terrace to the next without a staircase eating any growing room. They are still there.
    if (i < steps - 1) {
      const sx = (i % 2 ? 1 : -1) * width * randomIn(rng, 0.18, 0.34);
      for (let s = 0; s < 3; s++) {
        wall.push({
          geometry: new THREE.BoxGeometry(1.5, 0.4, 1.9),
          color: GRANITE_LIGHT,
          position: [sx + (s - 1) * 0.5, y + rise * (0.25 + s * 0.3), z + bow + 0.9],
        });
      }
    }
  }
  const g = group();
  g.add(mergedMesh(wall, { roughness: 0.95, ...relief('stone', { seed, repeat: 5 }) }));
  g.add(mergedMesh(soil, { roughness: 1, ...relief('soil', { seed: seed + 1, repeat: 6 }) }));
  return g;
}

// ---------------------------------------------------------------------------
// The buildings
// ---------------------------------------------------------------------------

// The Torreón: the only curved wall on the site, and it is curved for a reason. One of its
// windows is aligned so that at the June solstice sunrise the light falls exactly along a
// line cut into the rock inside it. The building is an instrument.
export function templeOfTheSun({ radius = 11, height = 12, seed = 11 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];

  // The living rock the tower is built onto and around -- it is not on a foundation, it
  // grows out of a granite outcrop, and the masons cut the outcrop to receive it.
  const base = new THREE.SphereGeometry(radius * 1.28, 20, 12);
  base.scale(1, 0.34, 0.9);
  parts.push({ geometry: base, color: GRANITE_DARK, position: [0, radius * 0.1, 0] });

  // The curved wall: two thirds of a circle, open where the outcrop breaks through.
  const courses = Math.round(height / 1.3);
  for (let c = 0; c < courses; c++) {
    const y = radius * 0.34 + (c + 0.5) * (height / courses);
    const r = radius * (1 - (c / courses) * 0.06);
    const blocks = Math.max(10, Math.round((2 * Math.PI * r * 0.72) / 2.1));
    for (let i = 0; i < blocks; i++) {
      const a = -0.35 + (i / blocks) * Math.PI * 1.45;
      const bw = ((Math.PI * 1.45 * r) / blocks) * 1.12;
      const gm = new THREE.BoxGeometry(bw, (height / courses) * 1.04, 2.2);
      gm.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(Math.cos(a) * r, y, Math.sin(a) * r)
        .multiply(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2)));
      parts.push({ geometry: gm, color: STONE_TONES[Math.floor(rng() * STONE_TONES.length)] });
    }
  }

  g.add(mergedMesh(parts, { roughness: 0.94, ...relief('stone', { seed, repeat: 4 }) }));

  // The two windows, cut as dark trapezoid recesses. The solstice one faces northeast.
  const win = [];
  for (const a of [0.42, 1.62]) {
    const gm = new THREE.BoxGeometry(2.4, 3.1, 2.6);
    gm.applyMatrix4(new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * radius * 0.98, radius * 0.34 + height * 0.5, Math.sin(a) * radius * 0.98)
      .multiply(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2)));
    win.push({ geometry: gm, color: 0x2e2a26 });
    const lint = new THREE.BoxGeometry(3.2, 0.6, 2.9);
    lint.applyMatrix4(new THREE.Matrix4()
      .makeTranslation(Math.cos(a) * radius * 0.98, radius * 0.34 + height * 0.5 + 1.85, Math.sin(a) * radius * 0.98)
      .multiply(new THREE.Matrix4().makeRotationY(-a + Math.PI / 2)));
    win.push({ geometry: lint, color: GRANITE_LIGHT });
  }
  g.add(mergedMesh(win, { roughness: 0.9 }));
  return g;
}

// The Intihuatana -- "the place that ties the sun". A single piece of granite, carved in
// place out of the bedrock, with a short column standing up from a sculpted base.
//
// The Spanish smashed these wherever they found them, as idols. This one survived because
// they never found the site, which is the reason it is the most complete one left.
export function intihuatana({ height = 6, seed = 13 } = {}) {
  const g = group();
  const parts = [];

  // The carved bedrock it stands on: a set of shallow planes and steps, all one stone.
  parts.push({ geometry: new THREE.BoxGeometry(11, 1.5, 9), color: GRANITE, position: [0, 0.75, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(8.4, 1.2, 6.6), color: GRANITE_LIGHT, position: [0.4, 2.05, -0.2], rotation: [0, 0.12, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(5.6, 0.9, 4.4), color: GRANITE_WARM, position: [0.1, 3.05, 0.3], rotation: [0, -0.08, 0] });
  // Angled shoulders, so it reads as sculpted rather than as stacked slabs.
  for (const [sx, sz, ry] of [[-3.1, 0, 0.35], [3.2, 0.4, -0.4], [0, -2.6, 0.2]]) {
    parts.push({ geometry: new THREE.BoxGeometry(4.2, 0.8, 3), color: GRANITE_DARK, position: [sx, 2.4, sz], rotation: [0.16, ry, 0.1] });
  }

  // The gnomon: a squared-off pillar, leaning slightly, cut with flat faces. Its angles
  // are not arbitrary -- the pillar's edges point to the cardinal directions.
  const post = new THREE.CylinderGeometry(height * 0.15, height * 0.2, height * 0.62, 4);
  post.rotateY(Math.PI / 4);
  parts.push({ geometry: post, color: GRANITE_LIGHT, position: [0.1, 3.5 + height * 0.31, 0.3], rotation: [0.05, 0, 0.03] });
  parts.push({ geometry: new THREE.BoxGeometry(height * 0.3, height * 0.07, height * 0.3), color: GRANITE_WARM, position: [0.1, 3.5 + height * 0.65, 0.3] });

  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('stone', { seed, repeat: 3 }) }));
  return g;
}

// A canonical Inca building: stone walls to the eaves, then a very steep thatched roof.
//
// The pitch is the thing to get right. These roofs run to about 55 degrees, because the
// site gets six feet of rain a year and thatch only sheds water if it is nearly a wall.
// Modelled at a European 35 degrees the whole village stops looking Andean.
export function incaHouse({
  width = 16, depth = 11, wallHeight = 8, roofed = true, gableEnds = true, seed = 17,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const stone = [];
  const batter = wallHeight * 0.08;

  // Long walls, with the doorway in the downhill one.
  const doorW = width * 0.16;
  for (const side of [-1, 1]) {
    if (side === 1) {
      const seg = (width - doorW) / 2;
      for (const s of [-1, 1]) {
        const panel = ashlarPanel(seg, wallHeight, 1.8, rng, { batter: batter * 0.6, course: 1.25 });
        for (const p of panel) {
          p.geometry.translate(s * (doorW / 2 + seg / 2), 0, depth / 2);
          stone.push(p);
        }
      }
      stone.push({ geometry: new THREE.BoxGeometry(doorW * 1.7, wallHeight * 0.1, 2.1), color: GRANITE_DARK, position: [0, wallHeight * 0.72, depth / 2] });
      const capPanel = ashlarPanel(doorW * 1.2, wallHeight * 0.21, 1.8, rng, { course: 1.1 });
      for (const p of capPanel) {
        p.geometry.translate(0, wallHeight * 0.79, depth / 2);
        stone.push(p);
      }
    } else {
      const panel = ashlarPanel(width, wallHeight, 1.8, rng, { batter: batter * 0.6, course: 1.25 });
      for (const p of panel) {
        p.geometry.translate(0, 0, -depth / 2);
        stone.push(p);
      }
    }
  }
  // Gable ends, carried up to the ridge so the thatch has something to sit against.
  const ridgeH = roofed ? wallHeight + depth * 0.72 : wallHeight;
  for (const side of [-1, 1]) {
    const panel = ashlarPanel(depth, wallHeight, 1.8, rng, { batter: batter * 0.6, course: 1.25 });
    for (const p of panel) {
      p.geometry.rotateY(Math.PI / 2);
      p.geometry.translate(side * width / 2, 0, 0);
      stone.push(p);
    }
    if (roofed && gableEnds) {
      const tri = new THREE.Shape();
      tri.moveTo(-depth / 2, 0);
      tri.lineTo(depth / 2, 0);
      tri.lineTo(0, ridgeH - wallHeight);
      tri.closePath();
      const gable = new THREE.ExtrudeGeometry(tri, { depth: 1.6, bevelEnabled: false });
      gable.rotateY(Math.PI / 2);
      gable.translate(side * (width / 2 + 0.8), wallHeight, 0);
      stone.push({ geometry: gable, color: GRANITE });
    }
  }
  g.add(mergedMesh(stone, { roughness: 0.95, ...relief('stone', { seed, repeat: 5 }) }));

  if (!roofed) return g;

  // The thatch. Rows of overlapping courses rather than two smooth planes, because ichu
  // grass laid in bundles is lumpy and a flat plane reads as a tarpaulin.
  const thatch = [];
  // The pitch is measured from the HORIZONTAL, and that is not a detail. It was written
  // atan2(run, rise) at first -- the angle from vertical -- which put every course twenty
  // degrees off the plane it was supposed to lie in, so instead of overlapping they
  // splayed apart and the roof came out as a venetian blind with the sky showing through.
  const runH = (depth / 2) * 1.14;
  const runV = ridgeH - wallHeight + 0.6;
  const pitch = Math.atan2(runV, runH);
  const slope = Math.hypot(runH, runV);
  const rows = 13;
  const step = slope / rows;
  for (const side of [-1, 1]) {
    for (let i = 0; i < rows; i++) {
      const t = i / rows;
      const z = side * (depth / 2) * (1 - t) * 1.14;
      const y = wallHeight - 0.6 + t * (ridgeH - wallHeight + 0.6);
      // A course of thatch is a THIN layer laid a long way over the one below it, and
      // getting that section wrong is what made the first two attempts at this roof look
      // like a stack of planks: square-section bars, spaced about their own thickness,
      // are a woodpile from any angle. Half a step thick and two and a half steps long
      // means each course buries most of its neighbour and only its rounded lip shows.
      //
      // The length is constant too. Randomised, the courses overhang the gable by
      // different amounts and the verge comes out as a flight of steps.
      const th = new THREE.BoxGeometry(width * 1.07, step * 0.85, step * 2.5);
      th.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(0, y, z)
        .multiply(new THREE.Matrix4().makeRotationX(side * pitch)));
      // Alternating tones, and a real gap between them rather than a shade. Each course is
      // 0.85 of a step thick so its lower lip stands proud of the one below and casts a
      // line; at half a step the courses were flush enough that from fifty feet the whole
      // roof flattened into one tan panel that read as plywood.
      thatch.push({ geometry: th, color: [THATCH, THATCH_DARK][i % 2] });
    }
  }
  // Ridge bundle, tied down. Every one of these roofs has one.
  thatch.push({ geometry: new THREE.CylinderGeometry(0.55, 0.55, width * 1.1, 10), color: THATCH_DARK, position: [0, ridgeH + 0.15, 0], rotation: [0, 0, Math.PI / 2] });
  // A verge bundle down each gable slope. Without it the courses show their cut ends at
  // the gable and the roof reads as a stack of planks rather than as thatch -- the ends
  // are the one part of a course that is square, and four of them in a row is a woodpile.
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const verge = new THREE.BoxGeometry(0.8, 0.9, slope * 1.1);
      verge.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(end * width * 0.55, wallHeight + (ridgeH - wallHeight) / 2 - 0.4, side * depth * 0.3)
        .multiply(new THREE.Matrix4().makeRotationX(side * pitch)));
      thatch.push({ geometry: verge, color: THATCH_DARK });
    }
  }
  g.add(mergedMesh(thatch, { roughness: 1, ...relief('weave', { seed: seed + 2, repeat: 8 }) }));
  return g;
}

// A flight of the site's stairs: cut from single blocks, steep, and narrow. There are
// something like three thousand of them at Machu Picchu.
export function incaStairs({ width = 6, steps = 12, rise = 1.1, run = 1.3, seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < steps; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(width * randomIn(rng, 0.94, 1.04), rise * 1.1, run * 1.15),
      color: STONE_TONES[Math.floor(rng() * STONE_TONES.length)],
      position: [randomIn(rng, -0.1, 0.1), rise * (i + 0.5), -run * i],
      rotation: [0, randomIn(rng, -0.03, 0.03), 0],
    });
  }
  // Retaining kerbs either side, which is what stops the flight looking like a free stair
  // floating on a hill.
  //
  // They are built as a STEPPED run of small blocks, not as one long raked slab. A single
  // box tall enough to retain a fourteen-step flight and long enough to run beside it is
  // twenty feet by eight, and tipped to the stair's rake it projects far past both ends --
  // from any distance it reads as a grey ramp lying on the grass, which is what the first
  // version of this put in the foreground of the whole world.
  for (const side of [-1, 1]) {
    for (let i = 0; i < steps; i++) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.85, rise * 1.9, run * 1.1),
        color: i % 2 ? GRANITE_DARK : GRANITE,
        position: [side * (width / 2 + 0.35), rise * (i + 0.5) - rise * 0.45, -run * i],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 0.95, ...relief('stone', { seed, repeat: 4 }) }));
}

// One of the sixteen fountains: a channel cut in stone, a spout, and a basin. The water
// runs downhill through the whole city from a spring, and it is still running.
export function incaFountain({ height = 4.2, seed = 23 } = {}) {
  const g = group();
  const parts = [];
  parts.push({ geometry: new THREE.BoxGeometry(6, height * 0.75, 3.4), color: GRANITE, position: [0, height * 0.375, 0] });
  parts.push({ geometry: new THREE.BoxGeometry(6.4, height * 0.2, 3.8), color: GRANITE_LIGHT, position: [0, height * 0.85, 0] });
  // The channel across the top, and the notch the water leaves by.
  parts.push({ geometry: new THREE.BoxGeometry(4.6, height * 0.12, 1.1), color: 0x50525a, position: [0, height * 0.92, -0.5] });
  parts.push({ geometry: new THREE.BoxGeometry(1.1, height * 0.16, 1.5), color: 0x50525a, position: [0, height * 0.88, 1.2] });
  // The basin below, cut into the bedrock -- square, and deep enough to fill a jar. It is
  // built as a RIM with the water inside it: a dark slab laid flat on the grass reads as a
  // doormat, and what makes a basin a basin is the lip round the edge.
  for (const [sx, sz, w, d] of [[0, -1.9, 4.6, 0.7], [0, 1.9, 4.6, 0.7], [-1.95, 0, 0.7, 4.5], [1.95, 0, 0.7, 4.5]]) {
    parts.push({ geometry: new THREE.BoxGeometry(w, 0.85, d), color: GRANITE_LIGHT, position: [sx, 0.42, 3.2 + sz] });
  }
  parts.push({ geometry: new THREE.BoxGeometry(4.6, 0.25, 4.5), color: GRANITE_DARK, position: [0, 0.12, 3.2] });
  g.add(mergedMesh(parts, { roughness: 0.94, ...relief('stone', { seed, repeat: 4 }) }));

  const water = mesh(
    new THREE.BoxGeometry(0.4, height * 0.72, 0.22),
    standard({ color: 0xbfe0ea, transparent: true, opacity: 0.6, roughness: 0.18 }),
    0, height * 0.44, 1.9,
  );
  water.castShadow = false;
  g.add(water);
  const pool = mesh(
    new THREE.BoxGeometry(3.5, 0.12, 3.4),
    standard({ color: 0x35606e, roughness: 0.1, metalness: 0.4 }),
    0, 0.62, 3.2,
  );
  pool.castShadow = false;
  g.add(pool);
  return g;
}

// ---------------------------------------------------------------------------
// The landscape
// ---------------------------------------------------------------------------

// Huayna Picchu: the peak in every photograph of this place, standing behind the citadel.
//
// It is a sugarloaf -- steep-sided, almost a horn, with terraces and a path visible right
// up its flank. Built as a cone would be wrong: what makes it that mountain is that the
// sides are CONCAVE, sweeping out at the bottom and nearly vertical at the top.
export function andeanPeak({
  height = 120, baseRadius = 60, sugarloaf = true, snow = false, seed = 29,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);

  const rings = 16;
  const radial = 26;
  const positions = [];
  const colors = [];
  const indices = [];
  const tint = new THREE.Color();

  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    // Concave profile for a horn, convex for a rounded ridge.
    //
    // The horn does NOT taper to a point, and getting that wrong is what made the first
    // version of Huayna Picchu a needle you could have threaded. A pure (1-t)^1.9 is zero
    // at the top, so the last few rings collapse into a spire; the real summit is a blunt
    // knob about a seventh of the base across. So the profile bottoms out at `summit` and
    // only the top tenth is rounded off, which is a dome sitting on a horn rather than a
    // spike growing out of one.
    const summit = 0.14;
    const base = sugarloaf
      ? summit + (1 - summit) * (1 - t) ** 2.1
      : Math.cos((t * Math.PI) / 2) ** 0.75;
    const cap = Math.sin(Math.min(1, (1 - t) / 0.1) * (Math.PI / 2));
    const profile = sugarloaf ? base * cap : base;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      // Ridges and gullies -- a smooth cone of revolution reads as a spoil heap.
      const ridge = 1 + Math.sin(a * 5 + seed) * 0.08 + Math.sin(a * 9 - seed * 0.7) * 0.045;
      const r = baseRadius * profile * ridge * (1 + Math.sin(t * 7 + a * 2) * 0.03);
      const y = height * t;
      positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      // Green at the bottom, bare rock above, snow only if asked.
      const rock = THREE.MathUtils.smoothstep(t, 0.28, 0.62);
      const c1 = new THREE.Color(0x3f5730).lerp(new THREE.Color(0x6e6a5c), rock);
      // The snow line follows the RIDGES, not a level contour -- snow lies on the shoulders
      // and blows off the spurs, and a clean horizontal band reads as a knitted hat.
      if (snow) c1.lerp(new THREE.Color(0xe8eef2), THREE.MathUtils.smoothstep(t + Math.sin(a * 5 + seed) * 0.06, 0.66, 0.98));
      tint.copy(c1).offsetHSL(0, 0, (rng() - 0.5) * 0.05);
      colors.push(tint.r, tint.g, tint.b);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const peak = mesh(geometry, standard({
    vertexColors: true, roughness: 1, ...relief('stone', { seed, repeat: 9 }),
  }));
  g.add(peak);
  return g;
}

// Cloud lying in the valley below the ridge -- which is what "cloud forest" means and
// what makes the place look like the place.
//
// A flat sheet of merged squashed spheres, self-lit so it stays bright against a sunlit
// mountain, and NOT casting shadows: a 200ft cloud that casts would put the entire world
// in shade. It also has `fog: false` off deliberately -- unlike the sea's light shafts
// this IS an opaque surface, so fogging it is correct and keeps the far edge receding.
export function cloudBank({ width = 190, depth = 90, seed = 31 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const count = 34;
  for (let i = 0; i < count; i++) {
    const x = randomIn(rng, -width / 2, width / 2);
    const z = randomIn(rng, -depth / 2, depth / 2);
    const r = randomIn(rng, 11, 26);
    // SphereGeometry, not Icosahedron -- non-indexed geometry is flat-shaded whatever the
    // material says, and a flat-shaded cloud is a pile of grey boulders.
    const blob = new THREE.SphereGeometry(r, 12, 8);
    blob.scale(1, randomIn(rng, 0.2, 0.34), 1);
    parts.push({
      geometry: blob,
      color: [0xf2f4f6, 0xe4e9ee, 0xd6dde4][i % 3],
      position: [x, randomIn(rng, -2, 4), z],
    });
  }
  const m = mergedMesh(parts, { roughness: 1, emissive: 0x6d7a86, emissiveIntensity: 0.5 });
  m.castShadow = false;
  m.receiveShadow = false;
  return group(m);
}

// A llama. The pack animal that made the whole Inca road system work, and the reason
// there are no wheeled vehicles anywhere in this empire: a llama goes up a staircase.
//
// What makes it a llama rather than a sheep on stilts: the neck is long, held UPRIGHT and
// carried well clear of the back; the ears are long and curve inward like banana skins;
// there is no hump; and the legs are slender and long for the body.
export function llama({ height = 5.6, fleece = 0xd8cbb0, seed = 37 } = {}) {
  const g = group();
  const S = height / 5.6;
  const parts = [];
  const dark = new THREE.Color(fleece).offsetHSL(0, 0.02, -0.16).getHex();

  const body = taperedTube(
    [[0, 3.3 * S, -1.5 * S], [0, 3.5 * S, -0.6 * S], [0, 3.5 * S, 0.5 * S], [0, 3.35 * S, 1.25 * S]],
    [0.4 * S, 0.72 * S, 0.72 * S, 0.5 * S],
    { tubularSegments: 14, radialSegments: 12 },
  );
  body.scale(0.82, 1, 1);
  parts.push({ geometry: body, color: fleece });

  // Legs. Long, thin and straight, with a visible knee bulge -- a llama's legs are most of
  // its height, and short ones turn it into a sheep instantly.
  for (const [lx, lz] of [[-0.42 * S, -1.15 * S], [0.42 * S, -1.15 * S], [-0.42 * S, 0.95 * S], [0.42 * S, 0.95 * S]]) {
    parts.push({
      geometry: taperedTube(
        [[lx, 0.12 * S, lz], [lx, 1.5 * S, lz + 0.05 * S], [lx, 2.95 * S, lz]],
        [0.1 * S, 0.13 * S, 0.24 * S], { tubularSegments: 8, radialSegments: 9 },
      ),
      color: fleece,
    });
    parts.push({ geometry: new THREE.SphereGeometry(0.13 * S, 8, 6), color: dark, position: [lx, 0.13 * S, lz] });
  }

  // The neck: upright, and long enough that the head clears the back by a full body depth.
  const neck = taperedTube(
    [[0, 3.5 * S, 1.1 * S], [0, 4.3 * S, 1.5 * S], [0, 5.05 * S, 1.5 * S]],
    [0.34 * S, 0.24 * S, 0.2 * S], { tubularSegments: 10, radialSegments: 10 },
  );
  parts.push({ geometry: neck, color: fleece });

  // Head: a short wedge, not a ball.
  const head = new THREE.SphereGeometry(0.26 * S, 12, 9);
  head.scale(0.8, 0.95, 1.3);
  parts.push({ geometry: head, color: fleece, position: [0, 5.28 * S, 1.62 * S] });
  parts.push({ geometry: new THREE.SphereGeometry(0.16 * S, 10, 8), color: dark, position: [0, 5.18 * S, 1.95 * S] });
  // Ears -- long, and curving toward each other. This is the field mark.
  for (const side of [-1, 1]) {
    const ear = new THREE.CylinderGeometry(0.02 * S, 0.075 * S, 0.52 * S, 7);
    parts.push({ geometry: ear, color: fleece, position: [side * 0.15 * S, 5.66 * S, 1.5 * S], rotation: [-0.12, 0, side * -0.34] });
  }
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.SphereGeometry(0.055 * S, 8, 6), color: 0x2a231c, position: [side * 0.19 * S, 5.34 * S, 1.78 * S] });
  }
  // A short tail, held up.
  parts.push({
    geometry: taperedTube([[0, 3.35 * S, -1.5 * S], [0, 3.55 * S, -1.85 * S], [0, 3.4 * S, -2.05 * S]], [0.13 * S, 0.09 * S, 0.04 * S],
      { tubularSegments: 6, radialSegments: 8 }),
    color: fleece,
  });

  g.add(mergedMesh(parts, { roughness: 0.98, ...relief('weave', { seed, repeat: 5 }) }));
  return g;
}

// A granite outcrop breaking through the turf. The whole ridge is like this, and the Inca
// masons quarried where they built -- several of the site's walls run straight into the
// bedrock they came out of.
export function graniteOutcrop({ size = 8, seed = 41 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const count = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * size * 0.5;
    const w = randomIn(rng, size * 0.35, size * 0.8);
    parts.push({
      geometry: new THREE.BoxGeometry(w, randomIn(rng, size * 0.25, size * 0.6), randomIn(rng, size * 0.3, size * 0.7)),
      color: STONE_TONES[Math.floor(rng() * STONE_TONES.length)],
      position: [Math.cos(a) * r, randomIn(rng, size * 0.1, size * 0.26), Math.sin(a) * r],
      rotation: [randomIn(rng, -0.16, 0.16), rng() * Math.PI, randomIn(rng, -0.18, 0.18)],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.96, ...relief('stone', { seed, repeat: 3 }) }));
}

// Tussocky ichu grass -- the bunch grass of the high Andes, and the stuff the roofs are
// thatched with. Merged into one mesh per clump.
export function ichuGrass({ radius = 5, count = 18, seed = 43 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const h = randomIn(rng, 1.1, 2.2);
    const blades = 5;
    for (let b = 0; b < blades; b++) {
      const ba = (b / blades) * Math.PI * 2 + rng();
      parts.push({
        geometry: new THREE.CylinderGeometry(0.015, 0.07, h, 4),
        color: [0x8a8f52, 0x9aa062, 0x767c46][b % 3],
        position: [Math.cos(a) * r + Math.cos(ba) * 0.18, h / 2, Math.sin(a) * r + Math.sin(ba) * 0.18],
        rotation: [Math.cos(ba) * 0.3, 0, Math.sin(ba) * 0.3],
      });
    }
  }
  return group(mergedMesh(parts, { roughness: 1 }));
}
