import * as THREE from 'three';
import {
  group, mesh, mergedMesh, standard, relief, seededRandom, randomIn,
} from '../../PropKit.js';
import { mergeParts, extrudeOutline, tintGeometry, smoothNoise3 } from '../LoftKit.js';

// Machu Picchu: the MASONRY. This is the teaching object of the whole world, so it is the one
// family here that is read from arm's length -- a student walks up to a wall, puts their nose
// on it, and is told a knife blade will not go into the joints. Everything below is spent on
// what survives that inspection and on nothing else.
//
// Three things separate this from "a wall made of stones", and only the first was here before:
//
//  1. A SOLID DARK BACKING behind the blocks, so the gaps between the faces read as JOINTS
//     rather than as glimpses of another block further back (see ashlarPanel).
//  2. PILLOWED FACES. Every stone's face BULGES and its edges are drafted back to the joint
//     plane. That is the whole reason a photograph of this masonry shows fine dark lines
//     between light faces from every angle, and why the wall sparkles in raking light: two
//     neighbouring domes falling away from one another cut a V between them that is in shadow
//     whatever the sun is doing. Flat-faced blocks have no such line -- they show a joint only
//     where the geometry happens to leave a slot, which is a different thing and looks like a
//     gap rather than like a joint.
//  3. VARYING PROJECTION. Real coursed polygonal work stands a couple of inches in and out
//     across a face. A COUPLE of inches on an eight-foot wall; more than that and it stops
//     reading as fitted stone and starts reading as collapsed rubble.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call, seededRandom
// never Math.random, everything merged. See PropKit.js.

const MS_GRANITE = 0x78746c;
const MS_GRANITE_LIGHT = 0x8b867d;
const MS_GRANITE_DARK = 0x605c55;
const MS_GRANITE_WARM = 0x7f7466;
const MS_STONE_TONES = [MS_GRANITE, MS_GRANITE_LIGHT, MS_GRANITE_DARK, MS_GRANITE_WARM, 0x6e6a62];
const MS_DRESSED_TONES = [MS_GRANITE, MS_GRANITE_LIGHT, MS_GRANITE_WARM];
// The backing, and the inside of every reveal. Dark, but NOT black: a big flat surface facing
// away from the sun already renders as a silhouette, and starting it at black leaves nothing
// for the joint lines to be darker than.
const MS_SHADOW = 0x4b463f;
const MS_REVEAL = 0x3f3a34;

// Depths inside a panel's own thickness, as fractions of `depth`. MS_FACE_Z is where a stone's
// joint plane sits; a block runs back past MS_BACKING_FRONT, so no amount of recessing a stone
// can ever expose the backing slab as a flat surface -- only as the dark line in a joint,
// which is the entire reason it is there.
const MS_FACE_Z = 0.42;
const MS_BLOCK_BACK = 0.10;
const MS_BACKING_FRONT = 0.14;
const MS_BACKING_REAR = 0.50;

// ---------------------------------------------------------------------------
// Stone primitives
// ---------------------------------------------------------------------------

// UVs laid out in FEET on a chosen plane, so one relief tile is the same size on a 3ft lintel
// and on a 60ft terrace wall. Every block here is scaled non-uniformly after it is built, and
// geometry.scale() does not touch UVs -- left alone, a small stone carries four times the
// grain of the big one standing next to it and the wall reads as two different rocks.
function ms_uvFeet(g, plane = 'xy') {
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const get = { x: (i) => pos.getX(i), y: (i) => pos.getY(i), z: (i) => pos.getZ(i) };
  const a = get[plane[0]];
  const b = get[plane[1]];
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = a(i);
    uv[i * 2 + 1] = b(i);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ONE ashlar stone: a polygon prism whose FACE IS A LOW DOME and whose rim drops back to the
// joint plane.
//
// Authored in a unit cell -- circumradius 0.5 in x and y, front face at z = 0 rising to
// z = `bulge`, back at z = -`back` -- so a caller can scale it to a block's own width and
// course height without touching the bulge, which is a real dimension in feet and must not
// stretch with the stone.
//
// The rim is DUPLICATED between the face and the back skirt on purpose. Shared, the arris
// blends the face's normals with the skirt's and every block shades like a cushion right out
// to its edge -- the same averaging that turned Ellis Island's mastabas into a grid of diamond
// studs. Duplicated, the face keeps its dome and the edge stays an edge.
//
// A closed solid: face fan, face-to-rim draft, back skirt, back cap. Six triangles per side,
// so 36 to 48 for the six-to-eight-sided stones this wall lays.
function ms_pillowBlock(sides, rot, bulge, back) {
  const pos = [];
  const idx = [];
  const R = 0.5;
  const ring = (radius, z) => {
    const base = pos.length / 3;
    for (let k = 0; k < sides; k++) {
      const a = rot + (k / sides) * Math.PI * 2;
      pos.push(Math.cos(a) * radius, Math.sin(a) * radius, z);
    }
    return base;
  };
  const centre = pos.length / 3;
  pos.push(0, 0, bulge);
  // 0.68 of the radius is where the face turns down. The blocks are overfilled 1.42 x 1.34
  // into their cells (below), so only the inner ~70% of each polygon is ever visible --
  // putting the turn there lands the drafted edge exactly on the joint a viewer can see.
  const face = ring(R * 0.68, bulge * 0.86);
  const rimFace = ring(R, 0);
  const rimSkirt = ring(R, 0);
  const rear = ring(R * 0.97, -back);
  const rearCentre = pos.length / 3;
  pos.push(0, 0, -back);

  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides;
    idx.push(centre, face + k, face + k1);
    idx.push(face + k, rimFace + k, rimFace + k1);
    idx.push(face + k, rimFace + k1, face + k1);
    idx.push(rimSkirt + k, rear + k, rear + k1);
    idx.push(rimSkirt + k, rear + k1, rimSkirt + k1);
    idx.push(rearCentre, rear + k1, rear + k);
  }

  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A dressed rectangular stone -- a lintel, a jamb, a quoin, a flying step, a kerb -- carrying
// the same pillowed faces the field blocks have. Without this the doorway's own stones are the
// only flat things in a wall of domes, which is exactly backwards: the big dressed stones are
// the ones a student stands closest to.
//
// The displacement goes to ZERO at every face border, so the box's edges stay welded and no
// amount of bulge can open a seam. Displacing an INDEXED BoxGeometry per vertex is safe for
// the same reason: three.js gives each face its own copy of the shared corners, and every one
// of those copies moves by zero.
function ms_pillowBox(w, h, d, { bulge = 0.05, segs = 4, depthSegs = 1, axes = 'xz' } = {}) {
  const g = new THREE.BoxGeometry(w, h, d, segs, segs, depthSegs);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  // Flat across the middle and falling away quickly near the border: a dressed face is DRAFTED
  // at its edges, not spherical. A plain cosine bulge reads as an upholstered cushion.
  const f = (t) => Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 3)), 0.6);
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const n = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
    const ax = n[0] ? 0 : n[1] ? 1 : 2;
    if (!axes.includes('xyz'[ax])) continue;
    p[0] = pos.getX(i); p[1] = pos.getY(i); p[2] = pos.getZ(i);
    const o1 = (ax + 1) % 3;
    const o2 = (ax + 2) % 3;
    p[ax] += n[ax] * bulge * f(p[o1] / half[o1]) * f(p[o2] / half[o2]);
    pos.setXYZ(i, p[0], p[1], p[2]);
  }
  g.computeVertexNormals();
  return g;
}

// Tone with a small per-stone drift on top. Five flat greys across four hundred blocks reads as
// five kinds of plastic -- the same finding as the flower beds -- and it costs nothing here,
// because mergeColored takes a Color as happily as a hex.
function ms_tone(rng, tones) {
  const c = new THREE.Color(tones[Math.floor(rng() * tones.length)]);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(
    hsl.h + randomIn(rng, -0.014, 0.014),
    THREE.MathUtils.clamp(hsl.s * randomIn(rng, 0.7, 1.35), 0, 0.28),
    THREE.MathUtils.clamp(hsl.l * randomIn(rng, 0.88, 1.11), 0.08, 0.9),
  );
  return c;
}

// ---------------------------------------------------------------------------
// ashlarPanel -- the shared helper the whole world's buildings are made of
// ---------------------------------------------------------------------------

// A panel of mortarless polygonal ashlar, authored in the XY plane with its base at y = 0, its
// face toward +Z and its thickness along Z. Returns an ARRAY OF PARTS with every transform
// already baked into the geometry, so a caller can `p.geometry.translate(...)` and hand the lot
// to mergeColored or to mergeParts without having to think about ordering.
//
// Each block is a many-sided polygon rather than a rectangle, because a wall of rectangles reads
// as brick and brick is the one thing this is not. Three numbers in here are hard-won and must
// not be relaxed:
//
//  * The DARK BACKING. Without it the wall came out as a heap of river cobbles: wherever two
//    polygons failed to meet you saw another block further back, so every joint read as a
//    rounded edge instead of as a line.
//  * The pi/sides BASE ROTATION with only a small jitter, which puts a flat edge along the top
//    and bottom of every stone. This is COURSED polygonal work -- the bed joints are roughly
//    level even though no two stones are the same shape. Rotated freely, the blocks point
//    corners at one another and the wall becomes crazy paving.
//  * The 1.42 x 1.34 OVERFILL. Inscribed in its cell -- or even at the 1.22 this started at --
//    a polygon leaves its corners open, the backing shows through in wedges, and the result
//    reads as cobbles bedded in mortar. Which is the exact opposite of the one thing this
//    masonry is famous for.
//
// Everything past the original three options is additive, with defaults that reproduce a sane
// wall, because this signature is called from four other files.
export function ashlarPanel(width, height, depth, rng, {
  course = 1.5, batter = 0, tones = MS_STONE_TONES,
  bulge = null, proud = 0.075, lap = 0, lapPhase = 0, backing = true,
} = {}) {
  const parts = [];
  const rows = Math.max(1, Math.round(height / course));
  const rowH = height / rows;

  if (backing) {
    // SHEARED to the same batter as the blocks. A plain upright slab is right on a vertical
    // wall and wrong on a leaning one: by the top course the blocks have moved back by the full
    // batter and the slab has not, so the two end up flush and every joint stops reading dark
    // exactly where the wall is most visible against the sky.
    const bd = (MS_BACKING_FRONT + MS_BACKING_REAR) * depth;
    const g = new THREE.BoxGeometry(width, height, bd, 1, 4, 1);
    g.translate(0, height / 2, MS_BACKING_FRONT * depth - bd / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) - batter * (pos.getY(i) / height));
    g.computeVertexNormals();
    parts.push({ geometry: ms_uvFeet(g), color: MS_SHADOW });
  }

  const placeBlock = (x, y, bw, bh, inset) => {
    const sides = 6 + Math.floor(rng() * 3);
    // The bulge is a real dimension, so it is tied to the SMALLER of the stone's two spans --
    // a long thin course stone bulges like a course stone, not like a boulder. Clamped either
    // side: under about an inch it stops catching the light at all, and over about an inch and
    // a half a fitted wall starts reading as cobbles again.
    const b = bulge ?? THREE.MathUtils.clamp(0.040 * Math.min(bw, bh), 0.022, 0.075);
    const g = ms_pillowBlock(
      sides, Math.PI / sides + randomIn(rng, -0.13, 0.13), b,
      depth * (MS_FACE_Z + MS_BLOCK_BACK),
    );
    g.scale(bw * 1.42, bh * 1.34, 1);
    // Varying projection, a couple of inches either way. This is what stops a big panel reading
    // as one machined surface with lines scribed on it.
    g.translate(x, y, depth * MS_FACE_Z - inset + randomIn(rng, -proud * 0.8, proud));
    parts.push({ geometry: ms_uvFeet(g), color: ms_tone(rng, tones) });
  };

  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * rowH;
    // Walls lean inward. `batter` is the total lean over the full height, so each course is a
    // little narrower and a little further back than the one below it.
    const inset = batter * (y / height);
    const w = width - inset * 2;
    let x = -w / 2;
    while (x < w / 2 - 0.05) {
      const bw = Math.min(randomIn(rng, rowH * 0.95, rowH * 2.4), w / 2 - x);
      if (bw < 0.12) break;
      placeBlock(x + bw / 2, y + randomIn(rng, -0.03, 0.03) * rowH, bw, rowH, inset);
      x += bw;
    }
    // CORNER INTERLOCK. Alternate courses run past the end of the panel, so where two panels
    // meet at a corner their stones bite into one another instead of leaving a vertical seam
    // straight down the arris -- which is what two flush panels always leave and which is the
    // loudest possible "these are two objects". Off by default, since a caller who is not
    // building a corner does not want stones hanging in the air off the end of a wall; a corner
    // passes `lap` on both panels and `lapPhase: 1` on one of them.
    if (lap > 0 && (r + lapPhase) % 2 === 0) {
      for (const side of [-1, 1]) placeBlock(side * (w / 2 + lap * 0.35), y, lap * 1.5, rowH * 0.92, inset);
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// A free-standing wall, with the trapezoidal doorway that is the lesson
// ---------------------------------------------------------------------------

// The doorway is the teaching object: wider at the sill than at the lintel, which is what every
// Inca opening does and what keeps the jambs standing when the ground moves. It has to read as
// a real OPENING, and three things do that and nothing else does:
//
//  * A DARK REVEAL. What says "this wall has thickness" is seeing the returns of the opening in
//    shadow. NOT a dark panel across the back -- that is a blind niche, and it is also the one
//    thing that would stop a student walking through the door.
//  * A LINTEL THAT IS ONE STONE, spanning the whole opening and bearing well onto both jambs.
//    These weigh several tons and were dragged up a mountain.
//  * JAMBS OF VISIBLY BIGGER STONE than the field: three tall blocks a side running the full
//    thickness of the wall, against a field course of a foot and a half.
//
// There is no CSG here, so the trapezoid is not cut out of anything. The field panels stop at
// the WIDEST point of the opening and the leaning jambs are what narrow it toward the lintel.
// The jamb's width therefore has a hard floor -- the sill-to-lintel taper PLUS the batter, since
// the field panel's inner edge leans away from the opening as it rises while the jamb's leans
// toward it. Under that floor a wedge of dark backing shows at the head of the door, which reads
// as a hole punched in the masonry rather than as a doorway.
export function incaWall({
  width = 18, height = 9, depth = 2.2, doorway = true, niches = 2, seed = 5,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const batter = height * 0.09;
  const insetAt = (y) => batter * (y / height);
  const faceAt = (y) => depth * MS_FACE_Z - insetAt(y);
  // A stone running the wall's FULL THICKNESS at height y, standing `out` proud of the face.
  //
  // `depth` is the panel's NOMINAL thickness and the wall's solid span is not that: it runs
  // from the face plane -- which the batter has already pulled back -- to the rear of the
  // backing slab, so at mid height it is barely two thirds of `depth`. Sizing a lintel or a
  // quoin at `depth` and centring it by eye is what put most of a foot of dressed stone out
  // through the BACK of the wall, where it reads as a beam left sticking out of the ruin.
  const through = (y, out = 0) => {
    const front = faceAt(y) + out;
    const back = -depth * MS_BACKING_REAR;
    return { d: front - back, cz: (front + back) / 2 };
  };

  const sillW = width * 0.2;
  const lintelW = sillW * 0.74;
  const doorH = height * 0.68;
  const lintelH = height * 0.115;
  const jambW = (sillW - lintelW) / 2 + batter + 0.8;
  const lean = Math.atan2((sillW - lintelW) / 2, doorH);
  const span = lintelW + jambW * 2 + 1.3;

  if (!doorway) {
    parts.push(...ashlarPanel(width, height, depth, rng, { batter }));
  } else {
    const sideW = (width - sillW) / 2;
    for (const side of [-1, 1]) {
      const panel = ashlarPanel(sideW, height, depth, rng, { batter });
      for (const p of panel) {
        p.geometry.translate(side * (sillW / 2 + sideW / 2), 0, 0);
        parts.push(p);
      }
    }

    // Jambs: three tall stones a side, leaning with the wall so the opening narrows upward.
    // Each is placed from the trapezoid's own line at ITS OWN mid-height rather than from one
    // guessed x -- a jamb positioned once and rotated about the wrong point slides off the line
    // it is meant to define, and that failure shows as daylight at one end only.
    const jambStones = 3;
    for (const side of [-1, 1]) {
      for (let j = 0; j < jambStones; j++) {
        const h = doorH / jambStones;
        const y = (j + 0.5) * h;
        const inner = sillW / 2 - ((sillW - lintelW) / 2) * (y / doorH);
        const t = through(y, 0.02);
        const g = ms_pillowBox(jambW, h * 1.03, t.d, { bulge: 0.06, segs: 3, depthSegs: 2 });
        ms_uvFeet(g);
        g.applyMatrix4(new THREE.Matrix4()
          .makeTranslation(side * (inner + jambW / 2), y, t.cz)
          .multiply(new THREE.Matrix4().makeRotationZ(side * lean)));
        parts.push({ geometry: g, color: ms_tone(rng, MS_DRESSED_TONES) });
      }
      // The reveal: the return face of the opening, standing just inside the jamb line and
      // running the wall's thickness. Dark because it never sees the sun, which is what a real
      // reveal is -- and what tells you at a glance that this is a hole and not a panel.
      const inner = sillW / 2 - ((sillW - lintelW) / 2) * 0.5;
      const tr = through(doorH / 2, -0.03);
      const rev = new THREE.BoxGeometry(0.16, doorH, tr.d * 0.97);
      ms_uvFeet(rev);
      rev.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(side * (inner - 0.05), doorH / 2, tr.cz)
        .multiply(new THREE.Matrix4().makeRotationZ(side * lean)));
      parts.push({ geometry: rev, color: MS_REVEAL });
    }

    // ONE lintel stone, standing very slightly proud of the wall face and past its thickness at
    // the back, because that is how a monolith bearing on two jambs actually sits and it is the
    // cheapest way to say "this is a single piece".
    const tl = through(doorH, 0.07);
    const lin = ms_pillowBox(span, lintelH, tl.d, { bulge: 0.07, segs: 4, depthSegs: 2 });
    lin.translate(0, doorH + lintelH / 2, tl.cz);
    parts.push({ geometry: ms_uvFeet(lin), color: MS_GRANITE_DARK });
    // The soffit -- the dark underside of the lintel inside the opening. Without it the head of
    // the door is a lit stone and the reveal stops half way up.
    const ts = through(doorH, -0.03);
    const sof = new THREE.BoxGeometry(lintelW * 1.02, 0.14, ts.d * 0.97);
    sof.translate(0, doorH - 0.05, ts.cz);
    parts.push({ geometry: ms_uvFeet(sof), color: MS_REVEAL });
    // A threshold stone, which closes the bottom of the opening where the two field panels and
    // both reveals otherwise stop in mid-air over the grass.
    const tt = through(0.15, 0.06);
    const sill = ms_pillowBox(sillW + jambW * 1.2, 0.3, tt.d, { bulge: 0.04, segs: 3, depthSegs: 2 });
    sill.translate(0, 0.15, tt.cz);
    parts.push({ geometry: ms_uvFeet(sill), color: MS_GRANITE_WARM });

    const capH = height - doorH - lintelH;
    if (capH > 0.3) {
      const midY = doorH + lintelH + capH / 2;
      const cap = ashlarPanel(span * 0.99, capH, depth, rng, { course: 1.15 });
      for (const p of cap) {
        // Set back by the batter at ITS OWN height, or the panel over the door stands forward of
        // the wall either side of it by most of a foot.
        p.geometry.translate(0, doorH + lintelH, -insetAt(midY));
        parts.push(p);
      }
    }
  }

  // END QUOINS. A free-standing stretch of wall has two ends and they are read from the side.
  // Left as the sliced edge of a field panel, what shows there is the flat cut face of the
  // backing slab -- a grey rectangle exactly where the stone should be turning the corner.
  // These are full-thickness stones alternating long and short up the end, which is what a
  // quoin is for and what closes the wall as a solid.
  const qh = height / Math.max(3, Math.round(height / 1.7));
  const qRows = Math.round(height / qh);
  for (const side of [-1, 1]) {
    for (let j = 0; j < qRows; j++) {
      const y = (j + 0.5) * qh;
      const inset = insetAt(y);
      const qw = j % 2 ? 1.55 : 1.05;
      const t = through(y, 0.03);
      const g = ms_pillowBox(qw, qh * 1.04, t.d, { bulge: 0.065, segs: 3, depthSegs: 2 });
      ms_uvFeet(g);
      g.translate(side * (width / 2 - inset - qw / 2), y, t.cz);
      parts.push({ geometry: g, color: ms_tone(rng, MS_DRESSED_TONES) });
    }
  }

  // Trapezoidal wall niches -- storage, and probably display. Same shape as the doors, for the
  // same reason.
  //
  // A niche IS blind, so unlike the doorway it wants a dark back. It cannot be cut back into the
  // panel, which is already solid: set behind the blocks it simply disappears, and laid on top
  // of them as a dark box it reads as a black sticker. It is built FORWARD -- dark panel a hair
  // proud of the stonework, jambs projecting past that, lintel and sill further still. The frame
  // is what casts the shadow, and the shadow is what says "hole".
  // NICHES ARE SPACED OVER THE PIERS, NOT OVER THE WHOLE WALL.
  //
  // Spacing them across the full width and then SKIPPING whichever land on the door is the
  // obvious way to do it, and it silently deletes them: at width/(niches+0.7) two niches sit
  // at 0.185*width, while any gate wide enough to clear the door structure is about
  // 0.28*width -- so both fall inside it. Measured, the wall built byte-identical geometry
  // at niches:2 and at niches:0, and both of this world's doorway walls were a blank field
  // of stone either side of the door, with 26 lines of comment above describing a feature
  // that never rendered once.
  //
  // Dividing the niches between the two piers cannot fail that way, because a pier is by
  // construction the part of the wall that is not the door.
  const nw = width * 0.1;
  const doorHalf = doorway ? sillW / 2 + jambW : 0;
  const pierW = Math.max(0, width / 2 - doorHalf);
  const slots = [];
  if (doorway) {
    const perSide = [Math.ceil(niches / 2), Math.floor(niches / 2)];
    for (const [k, side] of [[0, -1], [1, 1]]) {
      for (let j = 0; j < perSide[k]; j++) {
        slots.push(side * (doorHalf + pierW * ((j + 0.5) / perSide[k])));
      }
    }
  } else {
    for (let i = 0; i < niches; i++) slots.push((i - (niches - 1) / 2) * (width / (niches + 0.7)));
  }

  for (const x of slots) {
    // A narrow wall with a wide door has no pier left to put one in.
    if (Math.abs(x) + nw * 0.9 > width / 2 - 0.2) continue;
    if (doorway && Math.abs(x) < doorHalf + nw * 0.6) continue;
    const nh = height * 0.3;
    const ny = height * 0.34;
    const fz = faceAt(ny + nh / 2);
    const backP = new THREE.BoxGeometry(nw * 1.04, nh, depth * 0.06);
    backP.translate(x, ny + nh / 2, fz + depth * 0.02);
    parts.push({ geometry: ms_uvFeet(backP), color: MS_REVEAL });
    for (const side of [-1, 1]) {
      const jw = nw * 0.3;
      const g = ms_pillowBox(jw, nh, depth * 0.2, { bulge: 0.035, segs: 2, depthSegs: 1 });
      ms_uvFeet(g);
      g.applyMatrix4(new THREE.Matrix4()
        .makeTranslation(x + side * (nw * 0.52 + jw / 2 - 0.04), ny + nh / 2, fz + depth * 0.09)
        .multiply(new THREE.Matrix4().makeRotationZ(side * 0.07)));
      parts.push({ geometry: g, color: MS_GRANITE_LIGHT });
    }
    const nl = ms_pillowBox(nw * 1.75, height * 0.05, depth * 0.24, { bulge: 0.03, segs: 3, depthSegs: 1 });
    nl.translate(x, ny + nh + height * 0.025, fz + depth * 0.1);
    parts.push({ geometry: ms_uvFeet(nl), color: MS_GRANITE_DARK });
    const ns = ms_pillowBox(nw * 1.55, height * 0.035, depth * 0.22, { bulge: 0.025, segs: 3, depthSegs: 1 });
    ns.translate(x, ny - height * 0.015, fz + depth * 0.09);
    parts.push({ geometry: ms_uvFeet(ns), color: MS_GRANITE_WARM });
  }

  return group(mergedMesh(parts, { roughness: 0.95, ...relief('stone', { seed, repeat: 3 }) }));
}

// ---------------------------------------------------------------------------
// The andenes
// ---------------------------------------------------------------------------

// A maize leaf. Eight points extruded through their own thickness and then BENT by a function
// of position -- 32 triangles, closed, and indistinguishable at sixty feet from a lofted blade
// costing four times as much. The bend is a function of POSITION, never of vertex index, so
// every copy of a shared corner moves identically and the blade cannot tear.
function ms_leafGeometry(len, wide, droop, curl) {
  const pts = [];
  const n = 3;
  const halfW = (t) => Math.sin(Math.pow(t, 0.55) * Math.PI) * wide * 0.5 + wide * 0.06;
  for (let i = 0; i <= n; i++) pts.push([(i / n) * len, halfW(i / n)]);
  for (let i = n; i >= 0; i--) pts.push([(i / n) * len, -halfW(i / n)]);
  const g = extrudeOutline(pts, 0.035);
  // Built flat in XY with its thickness along Z, then rotated so the blade's WIDTH lies across
  // Z and its thickness is vertical, which is how a leaf hangs.
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i) / len;
    pos.setY(i, pos.getY(i) - droop * t * t + curl * Math.abs(pos.getZ(i)));
  }
  g.computeVertexNormals();
  return g;
}

// Maize and potato, built ONCE per call as merged vertex-coloured templates and then instanced.
// A terrace field is a couple of hundred plants, and a couple of hundred separate meshes is the
// one thing an integrated GPU cannot survive.
//
// They are read from sixty to a hundred feet, so what is spent here goes on SILHOUETTE -- an
// arching blade, a leaning stalk, a tassel breaking the line of the row -- and nothing at all
// on surface.
function ms_maizeTemplate(rng) {
  const parts = [];
  const h = randomIn(rng, 4.0, 5.2);
  const stalk = new THREE.CylinderGeometry(0.055, 0.1, h, 5, 1);
  stalk.translate(0, h / 2, 0);
  parts.push({ geometry: stalk, color: 0x6f8b3a });
  for (let i = 0; i < 3; i++) {
    parts.push({
      geometry: ms_leafGeometry(randomIn(rng, 1.5, 2.1), randomIn(rng, 0.3, 0.42), randomIn(rng, 0.55, 0.95), 0.16),
      color: i % 2 ? 0x7ea043 : 0x8cae4c,
      position: [0, h * (0.36 + i * 0.2), 0],
      rotation: [0, rng() * Math.PI * 2, 0],
    });
  }
  // The tassel: the thing that says "maize" from across a valley, and it is one cone.
  const tas = new THREE.ConeGeometry(0.11, 0.85, 5);
  tas.translate(0, h + 0.34, 0);
  parts.push({ geometry: tas, color: 0xc9b76a });
  return mergeParts(parts);
}

function ms_potatoTemplate(rng) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    const g = new THREE.SphereGeometry(randomIn(rng, 0.26, 0.46), 6, 3);
    g.scale(1, 0.72, 1);
    parts.push({
      geometry: g,
      color: i % 2 ? 0x4e6b2e : 0x5b7736,
      position: [Math.cos(a) * 0.34, 0.3 + rng() * 0.4, Math.sin(a) * 0.34],
    });
  }
  // Two flowers. A potato field in flower is pale violet, and that is the only cool colour on
  // the whole hillside, so the two dots earn their twenty triangles.
  for (let i = 0; i < 2; i++) {
    parts.push({
      geometry: new THREE.SphereGeometry(0.075, 5, 3),
      color: 0xd7cfe6,
      position: [randomIn(rng, -0.3, 0.3), randomIn(rng, 0.75, 0.95), randomIn(rng, -0.3, 0.3)],
    });
  }
  return mergeParts(parts);
}

// The andenes -- agricultural terraces. Not decoration, and not just flat ground: they are a
// soil-and-drainage machine. Each one is layered gravel, then sand, then topsoil carried up from
// the valley, so the mountain rain runs THROUGH the hillside instead of down it. It is why the
// site is still standing after five centuries of it.
//
// What has to read, in order: a stone WALL FACE, a GREEN PLANTED TREAD behind it, and the FLYING
// STEPS -- single stones let into the wall so they project as a staircase from one terrace to
// the next. That last one is the detail every photograph of this place has in it, and it was
// missing.
//
// Two junction rules, both of which were wrong before and both visible from a hundred feet:
//  * The soil must run HARD INTO THE BACK of the wall, not up to it. A butt joint between a box
//    of soil and a wall of irregular polygonal stone leaves daylight in every gap.
//  * The wall must stand PROUD of the tread. A retaining wall has a lip; flush with the soil it
//    stops being a retaining wall and the bank reads as a step in a stadium.
export function incaTerraces({
  width = 60, steps = 7, rise = 5, tread = 9, curve = 0, seed = 7,
  crops = 'mixed', flyingSteps = true,
} = {}) {
  const rng = seededRandom(seed);
  const wall = [];
  const soil = [];
  const field = [];
  const LIP = 0.45;
  const WALL_D = 1.6;

  const maize = crops !== 'none' && crops !== 'potato' ? ms_maizeTemplate(rng) : null;
  const potato = crops !== 'none' && crops !== 'maize' ? ms_potatoTemplate(rng) : null;

  for (let i = 0; i < steps; i++) {
    const y = i * rise;
    const z = -i * tread;
    // A gentle plan curve, because the terraces follow the contour of a ridge and a straight run
    // of seven reads as a staircase in a stadium.
    const bow = curve * (1 - Math.abs(i / steps - 0.5) * 2);
    const panel = ashlarPanel(width, rise + LIP, WALL_D, rng, { course: 1.2, batter: rise * 0.12 });
    for (const p of panel) {
      p.geometry.translate(0, y, z + bow);
      wall.push(p);
    }

    // The planting surface. Its front edge is buried INSIDE this wall's thickness and its back
    // edge inside the next wall's, so there is no seam at either end of the tread.
    const top = y + rise;
    const soilD = tread + 1.6;
    soil.push({
      geometry: ms_uvFeet(new THREE.BoxGeometry(width * 0.99, 1.5, soilD), 'xz'),
      color: i % 2 ? 0x5f6b3c : 0x687242,
      position: [0, top - 0.75, z + bow + 0.15 - soilD / 2],
    });

    // Furrow ridges. Rows of plants imply tilled ground, and a tint on a six-vertex box cannot
    // draw one -- a tint can only ever be as detailed as the mesh under it. Two low bars are
    // cheaper than subdividing the tread and read from further away.
    const rows = THREE.MathUtils.clamp(Math.floor(tread / 3.4), 1, 3);
    const rowZ = [];
    for (let r = 0; r < rows; r++) {
      const rz = z + bow - tread * ((r + 0.8) / (rows + 0.6));
      rowZ.push(rz);
      soil.push({
        geometry: ms_uvFeet(new THREE.BoxGeometry(width * 0.94, 0.24, 1.5), 'xz'),
        color: 0x6b6248,
        position: [0, top - 0.02, rz],
      });
    }

    // Maize and potato alternating by row and by level, which is roughly the real crop gradient
    // on this hillside and also stops seven identical fields stacking up the bank.
    if (crops !== 'none') {
      for (let r = 0; r < rows; r++) {
        const useMaize = maize && (crops === 'maize' || (i + r) % 2 === 0);
        const template = useMaize ? maize : (potato ?? maize);
        if (!template) break;
        const spacing = useMaize ? 3.9 : 3.0;
        const n = Math.max(1, Math.floor((width * 0.9) / spacing));
        for (let k = 0; k < n; k++) {
          const s = randomIn(rng, 0.82, 1.14);
          field.push({
            geometry: template,
            keepColor: true,
            position: [
              -width * 0.45 + (k + 0.5) * spacing + randomIn(rng, -0.35, 0.35),
              top - 0.05,
              rowZ[r] + randomIn(rng, -0.3, 0.3),
            ],
            rotation: [randomIn(rng, -0.07, 0.07), rng() * Math.PI * 2, randomIn(rng, -0.07, 0.07)],
            scale: [s, s * randomIn(rng, 0.9, 1.1), s],
            // keepColor leaves the template's own colours alone; the tint rides on top of them,
            // which is the only reason a shared template can still vary plant to plant.
            tint: (p, c) => {
              const k2 = 0.86 + smoothNoise3(p.x * 0.7, p.y * 0.7, p.z * 0.7) * 0.3;
              return [c.r * k2, c.g * k2, c.b * k2 * 0.97];
            },
          });
        }
      }
    }

    // FLYING STEPS: single stones let into the wall face, projecting, so you can climb from one
    // terrace to the next without a staircase eating any growing room. A FLIGHT, not three
    // stones -- three stones is a detail, a full climb is the thing people photograph. Each
    // stone runs back INTO the wall, which is both how they were built and what stops a
    // projecting slab showing a gap where it meets irregular stonework.
    if (flyingSteps) {
      const n = Math.max(3, Math.round((rise + LIP) / 0.95));
      const sx = (i % 2 ? 1 : -1) * width * randomIn(rng, 0.16, 0.32);
      for (let s = 0; s < n; s++) {
        // 2.6ft deep, centred ON the face plane: it stands 1.3ft proud, which is a stone you
        // could put a foot on, and its other 1.3ft is inside the wall's own 1.47ft of solid.
        // Set to project further it stops reading as a stone let INTO the wall and becomes a
        // shelf bolted onto it.
        const g = ms_pillowBox(1.75, 0.42, 2.6, { bulge: 0.04, segs: 3, depthSegs: 2, axes: 'xyz' });
        ms_uvFeet(g);
        g.translate(
          sx + (s % 2 ? 0.2 : -0.2),
          y + (s + 0.55) * ((rise + LIP) / (n + 0.25)),
          z + bow + WALL_D * MS_FACE_Z,
        );
        wall.push({ geometry: g, color: s % 2 ? MS_GRANITE_LIGHT : MS_GRANITE });
      }
    }
  }

  const g = group();
  g.add(mergedMesh(wall, { roughness: 0.95, ...relief('stone', { seed, repeat: 3 }) }));
  g.add(mergedMesh(soil, { roughness: 1, ...relief('soil', { seed: seed + 1, repeat: 4 }) }));
  if (field.length) {
    g.add(mesh(mergeParts(field), standard({ vertexColors: true, roughness: 0.92 })));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Stairs
// ---------------------------------------------------------------------------

// Inca stairs are very often cut from a SINGLE ROCK, and where they are built they are
// irregular and worn, with rounded nosings. So this is not a stack of boxes: it is ONE closed
// solid, the flight's whole side profile extruded through its width.
//
// That is both the cheaper answer and the more accurate one. A stack of boxes has an OPEN
// UNDERSIDE -- from anywhere off to the side you look straight in under the treads, which is
// what a timber stair looks like and what a rock-cut one never does -- and every pair of boxes
// leaves a slot between them unless they are made to overlap, which then has to be remembered
// at every edit. An extruded profile cannot have a gap in it, because it is one surface.
//
// The irregularity lives in the PROFILE: no two rises or runs are the same, every nosing is
// rounded off, and every tread dips slightly in the middle where five hundred years of feet
// have been. All three are free -- they are points on an outline that already exists.
export function incaStairs({ width = 6, steps = 12, rise = 1.1, run = 1.3, seed = 19 } = {}) {
  const rng = seededRandom(seed);
  const nose = Math.min(0.16, run * 0.14);

  // The profile, in (run, height). Drawn twice from the same seeded sequence would drift, so
  // the per-step dimensions are recorded here and the kerbs below read them back rather than
  // rolling their own -- a kerb built from a second draw sits beside a flight it does not fit.
  const cuts = [];
  const outline = [[0, 0]];
  let x = 0;
  let y = 0;
  for (let i = 0; i < steps; i++) {
    const r = rise * randomIn(rng, 0.93, 1.08);
    const d = run * randomIn(rng, 0.9, 1.12);
    cuts.push({ r, d, x, y });
    outline.push([x, y + r - nose]);
    // The nosing, as three points on a quarter round. A square nosing on a worn stone stair is
    // the single most computer-generated thing a flight of steps can have.
    for (let k = 1; k <= 3; k++) {
      const a = (k / 4) * (Math.PI / 2);
      outline.push([x + nose * (1 - Math.cos(a)), y + r - nose + nose * Math.sin(a)]);
    }
    // The tread, dished in the middle by a fraction of an inch of wear.
    outline.push([x + nose + (d - nose) * 0.5, y + r - randomIn(rng, 0.02, 0.055)]);
    outline.push([x + d, y + r]);
    x += d;
    y += r;
  }
  // The back of the flight and its underside, which is what closes the solid.
  outline.push([x + run * 0.55, y]);
  outline.push([x + run * 0.55, 0]);

  const core = extrudeOutline(outline, width);
  // extrudeOutline extrudes along Z; the flight's width belongs on X and its run on -Z.
  core.rotateY(Math.PI / 2);
  core.translate(0, 0, run * 0.55);
  ms_uvFeet(core, 'zy');
  // Worn stone is never one colour, and this is a single solid, so the only place tone can come
  // from is a per-vertex paint. The profile carries enough vertices along the flight for it to
  // land per tread rather than smear across the whole run -- a tint can only ever be as detailed
  // as the mesh under it.
  tintGeometry(core, (p) => {
    const n = smoothNoise3(p.x * 0.35, p.y * 0.9, p.z * 0.35);
    const c = new THREE.Color(MS_GRANITE);
    const wear = 0.88 + n * 0.26;
    return [c.r * wear, c.g * wear * 0.995, c.b * wear * 0.97];
  });
  // keepColor, or mergeParts overwrites everything the tint just computed -- the trap that left
  // the Space Needle uniformly white.
  const parts = [{ geometry: core, keepColor: true }];

  // Retaining kerbs either side, which is what stops the flight looking like a free stair
  // floating on a hill. A STEPPED run of stones, never one long raked slab: a box tall enough to
  // retain a fourteen-step flight and long enough to run beside it is twenty feet by eight, and
  // tipped to the rake it projects past both ends -- which reads as a grey ramp lying on the
  // grass. They overlap the flight in x by a third of their width and each other in y by more
  // than half a rise, so there is no seam anywhere along the run.
  for (const cut of cuts) {
    for (const side of [-1, 1]) {
      const kg = ms_pillowBox(1.0, cut.r * 1.6, cut.d * 1.18, { bulge: 0.05, segs: 3, depthSegs: 2, axes: 'xyz' });
      ms_uvFeet(kg, 'zy');
      kg.translate(side * (width / 2 + 0.28), cut.y + cut.r * 0.82, run * 0.55 - cut.x - cut.d / 2);
      parts.push({ geometry: kg, color: ms_tone(rng, MS_STONE_TONES) });
    }
  }

  return group(mesh(
    mergeParts(parts),
    standard({ vertexColors: true, roughness: 0.96, ...relief('stone', { seed, repeat: 3 }) }),
  ));
}
