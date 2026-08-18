import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief,
} from '../PropKit.js';
import {
  solidLoft, revolve, extrudeOutline, mouldedRing, solidSurface,
  ball, tube, chain, spike, mergeParts, tintGeometry, weather, placed, xformed,
  roundedOutline, ringPts, put, smoothNoise3,
} from './LoftKit.js';
import { greenbushMark } from './ObservatoryProps.js';

// The Greenbush Science Center, Girard, Kansas -- the building this whole app is made in,
// modelled from a photograph of its front elevation.
//
// WHAT MAKES IT THIS BUILDING, in the order the identification depends on:
//
//  1. THE TWIN BARREL VAULTS. Two dark green standing-seam arches, nested, the nearer one
//     smaller and lower, each with a cream fascia band following its curve. Nothing else on
//     the elevation is curved, and they are what anybody would draw from memory.
//  2. THE CURVED ENTRY CANOPY, a third and much smaller arch of the same family, standing
//     out over the drive on slender white columns with cross-braces.
//  3. THE BRICK TOWER at the left end, taller than everything else, flat-topped with a deep
//     green fascia, carrying a cream panel with the globe emblem standing proud of it.
//  4. THE LONG LOW WING to the right, punched windows with green panels, a white gutter
//     line, and one very visible white downspout.
//
// THE DOORWAY IS A REAL OPENING and the hall behind it is walkable, which drives more of
// this file than anything else. There is no CSG here, so an opening cannot be cut out of a
// wall that has already been built -- the front wall is assembled AROUND the door as two
// piers and a header, the same way a real one is. See `wallWithOpening`.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Sampled off the photograph rather than invented. The building is only three materials --
// red brick, dark green metal, cream trim -- and the whole of its character is that the
// green is DARK and slightly blue, not a grass green, and that the brick is a warm orange
// red rather than the plum red of a modern facing brick.
const SHELL = {
  brick: 0x93503f,
  brickWarm: 0x9d5a44,
  brickDeep: 0x7a4030,
  brickPale: 0xad6f57,
  mortar: 0xbcae9d,
  // Standing-seam roof and fascia. `green` is the roof in sun, `greenShade` the same paint
  // on a face turned away -- carried as two colours rather than left to the lighting,
  // because the roof planes on this building face four different ways and a single flat
  // green renders the whole of it as one silhouette.
  green: 0x1f5c4a,
  greenLit: 0x2a7359,
  greenShade: 0x143f33,
  cream: 0xe8e2d2,
  creamShade: 0xd2caba,
  white: 0xf2f0ea,
  stone: 0xcfc8b8,
  glass: 0x22282c,
  glassPale: 0x39454b,
  steel: 0xa8afb4,
  steelDark: 0x5a6166,
  asphalt: 0x6b6764,
  concrete: 0xbdb8ac,
  concreteDark: 0x9d988d,
};

// The Science Center's own emblem: a teal globe with pale latitude bands and a ring round
// it. It is the one saturated thing on the whole elevation and it is what the eye lands on.
const EMBLEM = {
  globe: 0x2e8f86,
  globeDeep: 0x1d6a63,
  band: 0xd8e8e4,
  ring: 0xbcc6c8,
};

// Kansas planting, and this is where the colour the brief asks for actually comes from. A
// brick-and-green building on mown grass is a two-colour scene; everything vivid in this
// world is a plant, a gizmo or a robot.
const PLANT = {
  boxwood: 0x40663a,
  boxwoodPale: 0x5d8a4c,
  hedge: 0x2f5030,
  lawn: 0x517f3a,
  bark: 0x54402f,
  mulch: 0x4a3527,
};

const GIZMO = [0xe0455f, 0xf2a541, 0x3fb37f, 0x3d8bf2, 0x8a5cf5, 0xf7c948, 0x1aa79c, 0xe8663f];

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

// mergeParts applies a part's rotation as ONE Euler in XYZ order, composing as Rx*Ry*Rz --
// so a middle Y term lands BEFORE the X term, not after it, and a plate laid down by
// Rx(pi/2) then "turned in plan" is TILTED instead. Measured in RobotProps: the plate's own
// normal falls from 1.000 to 0.697 by 0.8 radians. Anything that needs "lay it down, THEN
// turn it" bakes the pair as a matrix.
function laid(geometry, rotY = 0, tip = Math.PI / 2) {
  return xformed(geometry, new THREE.Matrix4().makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeRotationX(tip)));
}

// `revolve` decides its winding from the profile's direction and a bottom-up profile comes
// out INSIDE OUT -- which under a FrontSide material reads as a DARK surface, not a missing
// one. Measured in SeattleProps.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// A lathe profile that does not start and end ON THE AXIS is an open tube.
function closed(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// A plain rectangular solid, given its two opposite corners in world feet. Every wall,
// pier, header, slab and band in this building goes through here, so nothing in the file
// ever has to convert a centre and a half-extent by hand -- which is where the arithmetic
// errors in a building this size actually come from.
function boxAt(list, colour, [x0, y0, z0], [x1, y1, z1], extra = null) {
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  const d = Math.abs(z1 - z0);
  put(list, new THREE.BoxGeometry(w, h, d), colour,
    [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], null, extra);
}

// A WALL WITH A HOLE IN IT, built as two piers and a header.
//
// There is no CSG in this project, so an opening cannot be cut out of a wall that has
// already been built -- a dark panel laid on a solid wall is the trap Machu Picchu's niches
// and Ellis Island's windows both hit, and it reads as a sticker rather than as a way in.
// A real wall is assembled around its opening and so is this one.
function wallWithOpening(list, colour, {
  x0, x1, y0, y1, z0, z1, openX0, openX1, openTop, extra = null,
}) {
  boxAt(list, colour, [x0, y0, z0], [openX0, y1, z1], extra);
  boxAt(list, colour, [openX1, y0, z0], [x1, y1, z1], extra);
  boxAt(list, colour, [openX0, openTop, z0], [openX1, y1, z1], extra);
}

// A LUNETTE OUTLINE: the half-moon under an arch, as a closed 2D outline with the arc on top
// and the springing line across the bottom. Handed to extrudeOutline it caps correctly,
// because a half-disc's centroid lies inside it.
function lunetteOutline(halfSpan, rise, segments = 30) {
  const R = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  const cy = rise - R;
  const half = Math.asin(Math.min(1, halfSpan / R));
  const pts = [[-halfSpan, 0]];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (i / segments) * half * 2;
    pts.push([Math.sin(a) * R, cy + Math.cos(a) * R]);
  }
  pts.push([halfSpan, 0]);
  return pts;
}

// A BARREL VAULT AS A CLOSED SHELL, built directly rather than by extruding an arc band.
//
// `extrudeOutline` caps with a fan from the outline's own centroid, and an arc band's
// centroid lies in the HOLLOW under the arch -- so the cap throws triangles straight across
// the opening, which is the gear and the star-fort trap wearing a different hat. The cap
// here is a quad strip between the outer and inner arcs, which is what an arc band's section
// actually is, and the result is a genuinely closed solid: outer face, inner face, two end
// strips and two springing faces.
//
// The standing seams are a TINT rather than ribs. A seam stands about an inch proud on a
// roof twenty to thirty feet up and seen from sixty feet out, which is comfortably
// sub-pixel; as geometry it would need ten samples per seam to escape aliasing and would buy
// nothing at any distance this building is ever looked at from.
function barrelShell({
  halfSpan, rise, thickness, z0, z1, segments = 64, colour, colourShade, seams = 14,
}) {
  const R = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  const cy = rise - R;
  const half = Math.asin(Math.min(1, halfSpan / R));
  const pos = [];
  const idx = [];
  const uvs = [];
  // Ring order: outer arc left->right, then inner arc right->left, so one closed section.
  const section = [];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (i / segments) * half * 2;
    section.push([Math.sin(a) * (R + thickness), cy + Math.cos(a) * (R + thickness)]);
  }
  for (let i = segments; i >= 0; i--) {
    const a = -half + (i / segments) * half * 2;
    section.push([Math.sin(a) * R, cy + Math.cos(a) * R]);
  }
  const n = section.length;
  for (const z of [z0, z1]) {
    for (const [sx, sy] of section) { pos.push(sx, sy, z); uvs.push(sx / 8, z / 8); }
  }
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    idx.push(j, k, n + j, k, n + k, n + j);
  }
  // The two end strips: a quad between outer[i] and its opposite inner point.
  for (const [base, flip] of [[0, false], [n, true]]) {
    for (let i = 0; i < segments; i++) {
      const o0 = base + i;
      const o1 = base + i + 1;
      const i0 = base + (n - 1 - i);
      const i1 = base + (n - 2 - i);
      if (flip) idx.push(o0, o1, i0, o1, i1, i0);
      else idx.push(o0, i0, o1, o1, i0, i1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  // Seams as fine darker lines, plus a shade on the two flanks so the arch reads as curved
  // rather than as one flat green band.
  tintGeometry(g, (p) => {
    const a = Math.atan2(p.x, p.y - cy) / half;
    const seam = Math.abs(((a * seams + 100) % 1) - 0.5) < 0.09;
    const c = new THREE.Color(seam ? colourShade : colour);
    const k = 0.86 + 0.14 * Math.cos(a * Math.PI * 0.5);
    return [c.r * k, c.g * k, c.b * k];
  });
  return g;
}

// The face of an arch, as a solid crescent: the cream fascia band that follows each vault's
// curve at its gable end. Same quad-strip reasoning as the shell.
function arcBand({ halfSpan, rise, depth, band, z, segments = 48 }) {
  const parts = [];
  const R = (halfSpan * halfSpan + rise * rise) / (2 * rise);
  const cy = rise - R;
  const half = Math.asin(Math.min(1, halfSpan / R));
  for (let i = 0; i < segments; i++) {
    const a0 = -half + (i / segments) * half * 2;
    const a1 = -half + ((i + 1) / segments) * half * 2;
    const mid = (a0 + a1) / 2;
    const len = Math.abs(Math.sin(a1) * R - Math.sin(a0) * R) + Math.abs(Math.cos(a1) * R - Math.cos(a0) * R);
    const g = new THREE.BoxGeometry(Math.max(0.6, len * 1.25), band, depth);
    put(parts, g, SHELL.cream,
      [Math.sin(mid) * (R + band * 0.5), cy + Math.cos(mid) * (R + band * 0.5), z],
      [0, 0, -mid]);
  }
  return parts;
}

// Coursed brick as a COLOUR problem, not a geometry one. Real brickwork is never one flat
// tone -- it is a hundred slightly different bricks in courses -- and as geometry that is
// thousands of solids per elevation. Horizontal course banding plus a broad blotch, with a
// grime wash that strengthens toward the bottom of the wall where the rain splashes back.
function brickTint(geometry) {
  const warm = new THREE.Color(SHELL.brickWarm);
  const deep = new THREE.Color(SHELL.brickDeep);
  const pale = new THREE.Color(SHELL.brickPale);
  return tintGeometry(geometry, (p, c) => {
    const course = Math.floor(p.y / 0.29);
    const jitter = Math.abs(Math.sin(course * 12.9898 + Math.floor(p.x / 0.75) * 78.233
      + Math.floor(p.z / 0.75) * 37.719) * 43758.5453) % 1;
    const mottle = smoothNoise3(p.x * 0.09, p.y * 0.14, p.z * 0.09);
    const pick = jitter < 0.17 ? deep : jitter > 0.86 ? pale : warm;
    // The mortar line: every fifth sample band reads lighter, which at wall scale is what
    // gives brickwork its horizontal grain without a single extra triangle.
    const bed = (course % 3 === 0) ? 1.06 : 1;
    const k = (0.9 + mottle * 0.22) * bed;
    return [c.r * pick.r * k, c.g * pick.g * k, c.b * pick.b * k];
  });
}

// ---------------------------------------------------------------------------
// THE SCIENCE CENTER
// ---------------------------------------------------------------------------

// The elevation runs left to right exactly as the photograph does: tower, entry, twin
// vaults, long wing, gable end. It is built at about two thirds of the real building's
// footprint -- 146ft of frontage against roughly 220 -- because WORLD_BOUND_RADIUS is 195ft
// and a student has to be able to stand far enough back to see all of it at once. The
// placard by the door states the real figure, the same contract Egypt and the Colosseum
// hold to.
//
// FOUR MESHES for the whole building: brick, metal, trim and glass. Everything is merged by
// material rather than by mass, which is what keeps a 146ft building at four draw calls.
export function scienceCenter({ seed = 7 } = {}) {
  const brick = [];
  const metal = [];
  const trim = [];
  const glass = [];
  // THE HALL'S ROOF IS ITS OWN MESH, and that is the only reason it is separate from `metal`.
  // castShadow lives on the Mesh, not on a part, so anything that has to let the sun through
  // cannot be merged with anything that has to block it.
  const roof = [];

  // Interior floor, at GROUND LEVEL. PlayerController walks on the terrain and never on
  // props, so a raised interior floor puts a student's eyes below the deck they appear to
  // be standing on -- tolerable in a gallery you look across, obvious in a hall you walk
  // into. Mars learned this; the museum and the library are the counter-example.
  const FRONT = -4;      // the front wall plane of the hall
  const BACK = -46;
  const HALL_X0 = -34;
  const HALL_X1 = 36;
  const WALL_H = 20;
  const DOOR_X0 = -26;
  const DOOR_X1 = -14;
  const DOOR_H = 12;

  boxAt(trim, SHELL.concrete, [HALL_X0, -0.5, FRONT], [HALL_X1, 0.06, BACK]);

  // --- the hall's shell -------------------------------------------------
  wallWithOpening(brick, 0xffffff, {
    x0: HALL_X0, x1: HALL_X1, y0: 0, y1: WALL_H, z0: FRONT, z1: FRONT - 1.4,
    openX0: DOOR_X0, openX1: DOOR_X1, openTop: DOOR_H, extra: { keepColor: true },
  });
  boxAt(brick, 0xffffff, [HALL_X0, 0, FRONT], [HALL_X0 + 1.4, WALL_H, BACK], { keepColor: true });
  boxAt(brick, 0xffffff, [HALL_X1 - 1.4, 0, FRONT], [HALL_X1, WALL_H, BACK], { keepColor: true });
  boxAt(brick, 0xffffff, [HALL_X0, 0, BACK + 1.4], [HALL_X1, WALL_H, BACK], { keepColor: true });

  // The door reveal and its glazing. The opening is generous -- 12ft by 12 -- because it is
  // the only way in and a doorway a student has to hunt for is a doorway they do not find.
  // THE DOORWAY IS GENUINELY OPEN, and the first pass glazed it shut.
  //
  // Nothing in this app has collision, so a student could always have walked through -- but a
  // full-width sheet of dark glass across the opening reads as a WINDOW, and a student who
  // reads it as a window does not try. The glass is now two narrow sidelights at the jambs
  // with a transom over, and the middle eight feet is nothing at all: from the canopy you can
  // see the lit hall and the exhibits standing in it, which is the only invitation that works.
  for (const x of [DOOR_X0, DOOR_X1 - 2.0]) {
    boxAt(glass, SHELL.glass, [x, 0, FRONT - 1.5], [x + 2.0, DOOR_H - 2.4, FRONT - 1.7]);
    boxAt(trim, SHELL.steelDark, [x - 0.18, 0, FRONT - 1.42], [x + 0.18, DOOR_H, FRONT - 1.78]);
    boxAt(trim, SHELL.steelDark, [x + 1.82, 0, FRONT - 1.42], [x + 2.18, DOOR_H, FRONT - 1.78]);
  }
  boxAt(glass, SHELL.glass, [DOOR_X0, DOOR_H - 2.2, FRONT - 1.5], [DOOR_X1, DOOR_H, FRONT - 1.7]);
  boxAt(trim, SHELL.steelDark, [DOOR_X0, DOOR_H - 2.4, FRONT - 1.42], [DOOR_X1, DOOR_H - 2.1, FRONT - 1.78]);
  // A mat and a threshold, so the floor visibly continues through the opening.
  boxAt(trim, SHELL.concreteDark, [DOOR_X0 + 1.9, 0, FRONT - 1.2], [DOOR_X1 - 1.9, 0.09, FRONT - 5.5]);

  // --- the twin barrel vaults -------------------------------------------
  //
  // The nearer one is smaller and lower and sits IN FRONT of the bigger one, which is the
  // arrangement in the photograph and the single thing that makes the roofline recognisable.
  // castShadow is off on both: three.js has no light transmission, so whether the sun
  // reaches the floor of this hall depends only on whether something above it casts a
  // shadow. That is how the museum's skylight and the library's lantern work.
  // THE CEILING IS A FLAT DECK AND THE VAULTS SIT ON IT.
  //
  // The vaults were the ceiling on the first pass and they do not between them cover a
  // rectangular hall: two arcs 30 and 40ft wide over a room 70ft wide leave open strips at
  // both ends, and from inside those were bands of BLUE SKY across the top of the room. A
  // deck at the wall head closes it by construction, and the vaults become what they are on
  // the real building anyway -- roof form over a flat ceiling.
  //
  // castShadow = false on all of it, which is the only thing that decides whether sun
  // reaches an interior floor in three.js: there is no light transmission, so a roof that
  // casts no shadow is a roof the sun comes through. The museum's skylight and the library's
  // lantern are the same trick, and here the story is the two glazed clerestories.
  boxAt(roof, SHELL.greenShade, [HALL_X0, WALL_H - 0.6, FRONT], [HALL_X1, WALL_H, BACK]);
  // THE HALL HAS AN INTERIOR FINISH, and it is not decoration -- it is what makes the room
  // legible. A deck soffit in roof green and walls in face brick are both surfaces that face
  // AWAY from every light in the world, so the ceiling rendered as pure black and the walls
  // as dark red: the room read as a cave with exhibits in it. A pale lining is also simply
  // what an exhibit hall has, and it doubles as the thing the light orbs bounce off.
  boxAt(trim, SHELL.cream, [HALL_X0 + 1.3, WALL_H - 0.75, FRONT - 1.3], [HALL_X1 - 1.3, WALL_H - 0.62, BACK + 1.3]);
  const LIN = 0.34;
  boxAt(trim, SHELL.cream, [HALL_X0 + 1.4, 0, FRONT - 1.4], [HALL_X0 + 1.4 + LIN, WALL_H - 0.75, BACK + 1.4]);
  boxAt(trim, SHELL.cream, [HALL_X1 - 1.4 - LIN, 0, FRONT - 1.4], [HALL_X1 - 1.4, WALL_H - 0.75, BACK + 1.4]);
  boxAt(trim, SHELL.cream, [HALL_X0 + 1.4, 0, BACK + 1.4], [HALL_X1 - 1.4, WALL_H - 0.75, BACK + 1.4 + LIN]);
  // The front wall's lining stops either side of the doorway, which is the whole point of
  // building the wall as piers and a header in the first place.
  boxAt(trim, SHELL.cream, [HALL_X0 + 1.4, 0, FRONT - 1.4], [DOOR_X0, WALL_H - 0.75, FRONT - 1.4 - LIN]);
  boxAt(trim, SHELL.cream, [DOOR_X1, 0, FRONT - 1.4], [HALL_X1 - 1.4, WALL_H - 0.75, FRONT - 1.4 - LIN]);
  boxAt(trim, SHELL.cream, [DOOR_X0, DOOR_H, FRONT - 1.4], [DOOR_X1, WALL_H - 0.75, FRONT - 1.4 - LIN]);
  // A dark base to the lining, so the wall meets the floor on a line rather than fading out.
  for (const [a, b] of [
    [[HALL_X0 + 1.4, 0, FRONT - 1.4], [HALL_X0 + 1.9, 0.9, BACK + 1.4]],
    [[HALL_X1 - 1.9, 0, FRONT - 1.4], [HALL_X1 - 1.4, 0.9, BACK + 1.4]],
    [[HALL_X0 + 1.4, 0, BACK + 1.4], [HALL_X1 - 1.4, 0.9, BACK + 1.9]],
  ]) boxAt(trim, SHELL.steelDark, a, b);

  // Both spring from the SAME wall head and differ in radius, which is what the photograph
  // shows -- the nesting is a difference of size and depth, not of eaves height.
  const vaults = [
    { halfSpan: 15, rise: 7.5, springs: WALL_H - 0.6, z0: FRONT + 2, z1: -22, cx: -6 },
    { halfSpan: 20, rise: 11, springs: WALL_H - 0.6, z0: -12, z1: BACK - 1.5, cx: 14 },
  ];
  for (const v of vaults) {
    const shell = barrelShell({
      halfSpan: v.halfSpan, rise: v.rise, thickness: 1.7, z0: v.z0, z1: v.z1,
      segments: 104, colour: SHELL.green, colourShade: SHELL.greenShade, seams: 13,
    });
    put(roof, shell, 0xffffff, [v.cx, v.springs, 0], null, { keepColor: true });
    // The cream fascia following the curve at the near gable end.
    //
    // IT SITS INSIDE THE GREEN, not outside it. Placed at halfSpan + 0.9 it became the
    // OUTERMOST ring of the whole arch, so from the road each vault read as a cream dome with
    // a thin green rim -- the exact inverse of the photograph, where the green roof is the
    // wide band and the cream is a slim line under it. Radius, not width, is what decides
    // which of two concentric bands dominates.
    for (const part of arcBand({
      halfSpan: v.halfSpan - 1.3, rise: v.rise - 1.3, depth: 1.3, band: 2.0, z: 0, segments: 72,
    })) {
      trim.push({ ...part, position: [part.position[0] + v.cx, part.position[1] + v.springs, v.z0 + 0.4] });
    }
    // The gable wall filling the arch's own end, so the vault is a roof on a building rather
    // than a tube lying on a wall.
    //
    // ONE SMOOTH LUNETTE, not a stack of boxes stepping up the curve. The stack is the
    // obvious construction and it came out as an unmistakable STAIRCASE -- twenty-two red
    // blocks climbing the arch, which is the "a grid of boxes is pixel art" failure wearing a
    // different shape. An arch's infill is a half-disc, its centroid is inside it, and so
    // extrudeOutline's centre fan caps it correctly with no special case at all.
    // GLAZED, not cream. Filled with stucco it is a bright half-disc bigger than anything
    // else on the elevation, and the two vaults read as a pair of cream domes; filled with
    // dark glass the same shape reads as what a science centre actually puts under a barrel
    // vault -- an arched clerestory -- and the green arc becomes the thing you see.
    put(glass, extrudeOutline(lunetteOutline(v.halfSpan - 3.3, v.rise - 3.4, 30), 0.9),
      SHELL.glass, [v.cx, v.springs, v.z0 - 0.55]);
    for (let m = -2; m <= 2; m++) {
      const R2 = ((v.halfSpan - 3.3) ** 2 + (v.rise - 3.4) ** 2) / (2 * (v.rise - 3.4));
      const mx = m * (v.halfSpan - 4.6) / 2.4;
      const mh = (v.rise - 3.4 - R2) + Math.sqrt(Math.max(0, R2 * R2 - mx * mx));
      boxAt(trim, SHELL.creamShade,
        [v.cx + mx - 0.22, v.springs, v.z0 - 0.05], [v.cx + mx + 0.22, v.springs + mh - 0.3, v.z0 - 0.45]);
    }
  }

  // --- the left tower ----------------------------------------------------
  const T0 = -62;
  const T1 = HALL_X0;
  boxAt(brick, 0xffffff, [T0, 0, 0], [T1, 29, -28], { keepColor: true });
  // The deep green fascia capping it, as a mitred ring so its corners meet by construction.
  put(metal, mouldedRing([[0, 0], [0.5, 0.3], [0.5, 3.4], [0, 3.7]],
    (T1 - T0) / 2 + 0.2, 14.2, { closeTop: true }), SHELL.green,
    [(T0 + T1) / 2, 29, -14]);
  boxAt(metal, SHELL.greenShade, [T0 - 0.6, 32.4, 0.6], [T1 + 0.6, 33.1, -28.6]);

  // The cream panel and the globe emblem. The panel is a real recess: its dark reveal stands
  // a hair proud of the brick, the stucco proud of that, the emblem proud of everything --
  // the frame's own shadow is what reads as depth, which is the only way to get a recess
  // without CSG.
  boxAt(trim, SHELL.creamShade, [T0 + 5.2, 15.4, 0.06], [T1 - 5.2, 27.4, -0.2]);
  boxAt(trim, SHELL.cream, [T0 + 5.6, 15.8, 0.3], [T1 - 5.6, 27, 0.02]);
  for (const x of [-54, -48, -42]) {
    boxAt(trim, SHELL.stone, [x - 1.5, 11.2, 0.22], [x + 1.5, 13.4, -0.1]);
  }
  emblem(metal, trim, { at: [(T0 + T1) / 2, 21.4, 0.4], radius: 3.4 });

  // --- the entry canopy ---------------------------------------------------
  //
  // A third arch of the same family as the vaults, and the only one a student walks under.
  const CAN_X = -20;
  const canopy = barrelShell({
    halfSpan: 11, rise: 3.6, thickness: 0.55, z0: FRONT - 0.5, z1: 17,
    segments: 72, colour: SHELL.green, colourShade: SHELL.greenShade, seams: 9,
  });
  put(metal, canopy, 0xffffff, [CAN_X, 13.4, 0], null, { keepColor: true });
  for (const part of arcBand({ halfSpan: 11.6, rise: 4.1, depth: 1.0, band: 1.3, z: 0 })) {
    trim.push({ ...part, position: [part.position[0] + CAN_X, part.position[1] + 13.4, 16.6] });
  }
  // Columns, and the cross-braces that are most of what the canopy looks like from the road.
  for (const cx of [CAN_X - 9.4, CAN_X + 9.4]) {
    for (const cz of [15.4, 3.6]) {
      boxAt(trim, SHELL.white, [cx - 0.55, 0, cz - 0.55], [cx + 0.55, 13.6, cz + 0.55]);
      boxAt(trim, SHELL.concreteDark, [cx - 1.0, 0, cz - 1.0], [cx + 1.0, 1.1, cz + 1.0]);
    }
    for (const [y0, y1] of [[5.2, 9.4], [9.4, 13.2]]) {
      put(trim, new THREE.BoxGeometry(0.3, Math.hypot(11.8, y1 - y0), 0.3), SHELL.white,
        [cx, (y0 + y1) / 2, 9.5], [Math.atan2(11.8, y1 - y0) * (y1 > 9 ? 1 : -1), 0, 0]);
    }
    boxAt(trim, SHELL.white, [cx - 0.28, 9.2, 3.6], [cx + 0.28, 9.7, 15.4]);
  }

  // --- the right wing ------------------------------------------------------
  const W0 = HALL_X1;
  const W1 = 66;
  boxAt(brick, 0xffffff, [W0, 0, 1], [W1, 16.5, -34], { keepColor: true });
  // A shallow hipped roof. Built as a loft on the 'x' axis so the ridge is a real line and
  // the two slopes meet along it rather than merely near it.
  put(metal, solidLoft([
    { d: W0 - 1.2, w: 18.5, up: 0.001, dn: 0.9, round: 0.25 },
    { d: W0 + 4, w: 18.5, up: 3.1, dn: 0.9, round: 0.25 },
    { d: W1 - 4, w: 18.5, up: 3.1, dn: 0.9, round: 0.25 },
    { d: W1 + 1.2, w: 18.5, up: 0.001, dn: 0.9, round: 0.25 },
  ], { sides: 8, samples: 22, axis: 'x' }), SHELL.green, [0, 16.9, -16.5]);
  // The white gutter line, and the one downspout the photograph makes unmissable.
  boxAt(trim, SHELL.white, [W0 - 1.4, 15.7, 2.6], [W1 + 1.4, 16.6, 2.0]);
  boxAt(trim, SHELL.white, [W0 - 1.4, 15.7, 2.6], [W0 - 0.6, 16.6, -35.6]);
  boxAt(trim, SHELL.white, [W1 + 0.6, 15.7, 2.6], [W1 + 1.4, 16.6, -35.6]);
  put(trim, new THREE.CylinderGeometry(0.42, 0.42, 15.8, 10), SHELL.white, [W1 - 3.2, 7.9, 1.7]);
  put(trim, new THREE.CylinderGeometry(0.46, 0.46, 1.2, 10), SHELL.white, [W1 - 3.2, 15.9, 1.7]);
  // Punched windows with the green spandrel panels.
  for (const x of [W0 + 8, W0 + 19, W0 + 26]) {
    boxAt(trim, SHELL.stone, [x - 3.4, 7.4, 1.15], [x + 3.4, 13.2, 0.85]);
    boxAt(glass, SHELL.glass, [x - 3.0, 7.8, 1.3], [x + 3.0, 12.8, 1.0]);
    boxAt(metal, SHELL.green, [x - 3.3, 6.2, 1.25], [x + 3.3, 7.5, 0.95]);
  }

  // --- the far gable end ----------------------------------------------------
  const G0 = W1;
  const G1 = 84;
  boxAt(brick, 0xffffff, [G0, 0, 2], [G1, 15, -30], { keepColor: true });
  // The gable, as a prism standing on the wall head. `laid` bakes the lay-down and the turn
  // in the order actually wanted.
  // NO `laid` HERE, and that is the whole note. extrudeOutline already gives an upright
  // outline in XY extruded along Z, which is precisely what a gable is; laying it down as
  // well tips the triangle flat and turns its 33ft of DEPTH into 33ft of HEIGHT -- which
  // rendered as a pale slab standing twice the height of the building it belongs to. `laid`
  // is for things authored upright that have to end up FLAT, not for things already right.
  put(trim, extrudeOutline([
    [-(G1 - G0) / 2 - 1.2, 0], [(G1 - G0) / 2 + 1.2, 0], [0, 8.2],
  ], 33), SHELL.cream, [(G0 + G1) / 2, 15, -14]);
  for (const s of [-1, 1]) {
    put(metal, new THREE.BoxGeometry(Math.hypot((G1 - G0) / 2 + 1.6, 8.4), 0.7, 33.6), SHELL.green,
      [(G0 + G1) / 2 + s * ((G1 - G0) / 4 + 0.8), 19.2, -14],
      [0, 0, -s * Math.atan2(8.4, (G1 - G0) / 2 + 1.6)]);
  }
  // The arched window: a real reveal, built forward of the wall in four layers.
  {
    const cx = (G0 + G1) / 2;
    const arch = (r, colour, z, list) => {
      for (let i = 0; i < 16; i++) {
        const a = Math.PI * (i + 0.5) / 16;
        put(list, new THREE.BoxGeometry(r * 0.22, 1.1, 0.34), colour,
          [cx + Math.cos(a) * r, 9.4 + Math.sin(a) * r, z], [0, 0, a - Math.PI / 2]);
      }
      boxAt(list, colour, [cx - r - 0.5, 3.6, z + 0.17], [cx + r + 0.5, 9.4, z - 0.17]);
    };
    boxAt(glass, SHELL.glass, [cx - 6.2, 3.4, 2.1], [cx + 6.2, 15.2, 1.9]);
    arch(6.6, SHELL.stone, 2.35, trim);
    for (const x of [cx - 3.2, cx, cx + 3.2]) {
      boxAt(trim, SHELL.steelDark, [x - 0.2, 3.6, 2.3], [x + 0.2, 14.4, 2.0]);
    }
  }

  // --- roof furniture --------------------------------------------------------
  //
  // The wind turbine on its mast is the one thing on the roof that says what the building is
  // FOR, and it is in the photograph.
  put(trim, new THREE.CylinderGeometry(0.16, 0.24, 13, 10), SHELL.white, [6, 37.5, -30]);
  put(trim, new THREE.CylinderGeometry(0.5, 0.5, 1.3, 10), SHELL.white, [6, 44.4, -30], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    put(trim, laid(extrudeOutline([[0, -0.3], [3.6, -0.14], [3.6, 0.14], [0, 0.42]], 0.16), 0, 0),
      SHELL.white, [6, 44.4, -29.3], [0, 0, a]);
  }
  boxAt(metal, SHELL.steelDark, [-8, 20, -14], [-4.4, 23.2, -18]);
  boxAt(metal, SHELL.steel, [-8.3, 23.2, -13.7], [-4.1, 23.7, -18.3]);

  // --- the masonry detail that makes brick read as brick ---------------------
  //
  // A wall of face brick with nothing on it is a coloured box, and at 6.7k triangles the
  // building was by a wide margin the LIGHTEST thing in its own world -- lighter than one
  // tree. What brick architecture is actually read from is its horizontal lines: a stone
  // base course where the wall meets the ground, a soldier band under the eaves, sills and
  // lintels round every opening. Each is a mitred ring or a flat band, which is a handful of
  // triangles apiece and the single cheapest fidelity in this file.
  const course = (colour, halfW, halfD, cx, cy, cz, profile) => {
    put(trim, mouldedRing(profile, halfW, halfD), colour, [cx, cy, cz]);
  };
  const BASE = [[0, 0], [0.34, 0.12], [0.34, 1.5], [0.1, 1.75]];
  const BAND = [[0.06, 0], [0.3, 0.16], [0.3, 1.0], [0.06, 1.16]];
  // Tower
  course(SHELL.stone, 14, 14, -48, 0, -14, BASE);
  course(SHELL.brickDeep, 14, 14, -48, 25.6, -14, BAND);
  // Hall
  course(SHELL.stone, (HALL_X1 - HALL_X0) / 2, (FRONT - BACK) / 2, (HALL_X0 + HALL_X1) / 2, 0, (FRONT + BACK) / 2, BASE);
  course(SHELL.brickDeep, (HALL_X1 - HALL_X0) / 2, (FRONT - BACK) / 2, (HALL_X0 + HALL_X1) / 2, WALL_H - 2.4, (FRONT + BACK) / 2, BAND);
  // Wing and gable end
  course(SHELL.stone, (W1 - W0) / 2, 17.5, (W0 + W1) / 2, 0, -16.5, BASE);
  course(SHELL.brickDeep, (W1 - W0) / 2, 17.5, (W0 + W1) / 2, 14.0, -16.5, BAND);
  course(SHELL.stone, (G1 - G0) / 2, 16, (G0 + G1) / 2, 0, -14, BASE);

  // Sills and lintels on the wing's windows. A punched opening with no sill is a hole cut in
  // a sheet; the sill's own shadow is what says the wall has thickness.
  for (const x of [W0 + 8, W0 + 19, W0 + 26]) {
    boxAt(trim, SHELL.stone, [x - 3.9, 6.9, 1.55], [x + 3.9, 7.45, 0.7]);
    boxAt(trim, SHELL.stone, [x - 3.9, 13.1, 1.4], [x + 3.9, 13.75, 0.7]);
    for (const mx of [x - 1.1, x + 1.1]) {
      boxAt(trim, SHELL.steelDark, [mx - 0.13, 7.8, 1.35], [mx + 0.13, 12.8, 1.05]);
    }
  }
  // A soldier arch over the doorway, which is where a brick building shows its craft.
  for (let i = 0; i < 13; i++) {
    const t = (i + 0.5) / 13;
    boxAt(trim, SHELL.stone,
      [DOOR_X0 - 0.5 + t * (DOOR_X1 - DOOR_X0 + 1) - 0.52, DOOR_H, FRONT + 0.12],
      [DOOR_X0 - 0.5 + t * (DOOR_X1 - DOOR_X0 + 1) + 0.52, DOOR_H + 1.5, FRONT - 1.5]);
  }

  const brickGeometry = brickTint(mergeParts(brick));
  weather(brickGeometry, { amount: 0.08, wash: 0.3, low: 0, fade: 9, seed: seed });

  const roofMesh = mesh(mergeParts(roof), standard({
    vertexColors: true, roughness: 0.42, metalness: 0.35,
    ...relief('metal', { seed: seed + 2, repeat: 14, strength: 0.35 }),
  }));
  roofMesh.castShadow = false;

  return group(
    roofMesh,
    mesh(brickGeometry, standard({
      vertexColors: true, roughness: 0.92, metalness: 0.02,
      ...relief('stone', { seed, repeat: 26, strength: 0.85 }),
    })),
    mesh(mergeParts(metal), standard({
      vertexColors: true, roughness: 0.42, metalness: 0.35,
      ...relief('metal', { seed: seed + 1, repeat: 14, strength: 0.35 }),
    })),
    mesh(mergeParts(trim), standard({
      vertexColors: true, roughness: 0.72, metalness: 0.06,
    })),
    mesh(mergeParts(glass), standard({
      vertexColors: true, roughness: 0.16, metalness: 0.55,
    })),
  );
}

// The Science Center's globe emblem, standing proud of the panel on a bracket -- which is
// what it is in the photograph, not a painted sign. Latitude bands as a tint on the sphere's
// own surface rather than as applied rings: a ring laid on a sphere is a crescent of daylight
// waiting to happen, and a tint cannot come adrift from what it is painted on.
function emblem(metal, trim, { at, radius }) {
  const g = ball(radius, 30);
  tintGeometry(g, (p) => {
    const lat = Math.asin(THREE.MathUtils.clamp(p.y / radius, -1, 1)) / (Math.PI / 2);
    const band = Math.abs(((lat * 3.4 + 100) % 1) - 0.5) < 0.17;
    const c = new THREE.Color(band ? EMBLEM.band : (p.z > 0 ? EMBLEM.globe : EMBLEM.globeDeep));
    return [c.r, c.g, c.b];
  });
  metal.push({ geometry: g, color: 0xffffff, position: [at[0], at[1], at[2] + radius * 0.55], keepColor: true });
  // The ring, tipped so it reads as an orbit rather than as a collar.
  put(metal, new THREE.TorusGeometry(radius * 1.22, radius * 0.05, 8, 44), EMBLEM.ring,
    [at[0], at[1], at[2] + radius * 0.55], [0.22, 0, 0.16]);
  // The bracket that holds it off the wall.
  boxAt(trim, SHELL.steel,
    [at[0] - 0.34, at[1] - radius * 1.5, at[2] - 0.1], [at[0] + 0.34, at[1] - radius * 0.5, at[2] + 0.5]);
  boxAt(trim, SHELL.steel,
    [at[0] - radius * 1.5, at[1] - radius * 1.6, at[2] - 0.1], [at[0] + radius * 1.5, at[1] - radius * 1.3, at[2] + 0.7]);
}

// ---------------------------------------------------------------------------
// The exhibits
// ---------------------------------------------------------------------------

// A plinth with a name plate, which every exhibit in the hall stands on. It is what turns a
// model sitting on a floor into an exhibit: from the door the only thing a student can
// resolve is a coloured band, so the plinth's ring is the label before a single word is
// readable -- the same argument Fantastic Voyage's per-system accents are built on.
export function exhibitPlinth({
  seed = 3, radius = 3.2, height = 2.1, accent = '#3fb37f', label = '', sub = '',
} = {}) {
  const parts = [];
  put(parts, lathed(closed([
    [radius, 0], [radius, height - 0.5], [radius - 0.28, height - 0.34], [radius - 0.28, height],
  ]), { segments: 34 }), SHELL.concrete);
  put(parts, lathed(closed([[radius + 0.12, 0], [radius + 0.12, 0.34], [radius, 0.46]]), { segments: 34 }),
    new THREE.Color(accent).getHex());
  put(parts, lathed(closed([[radius - 0.05, height - 0.5], [radius - 0.05, height - 0.16]]), { segments: 34 }),
    new THREE.Color(accent).getHex());

  const objects = [mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.72, metalness: 0.06,
    ...relief('stone', { seed, repeat: 4, strength: 0.5 }),
  }))];
  if (label) {
    const texture = canvasTexture(512, 200, (ctx, w, h) => {
      ctx.fillStyle = '#1d2126';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = accent;
      ctx.fillRect(0, 0, w, 16);
      ctx.textAlign = 'center';
      // Both lines shrink to fit. A caller cannot predict the limit -- it depends on the
      // plate's width -- and an exhibit whose name is clipped mid-word is worse than one set
      // a point smaller. Same fitter welcomeBoard and standingSign both needed.
      const fit = (text, size, weight, max) => {
        let px = size;
        ctx.font = `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`;
        while (px > 10 && ctx.measureText(text).width > max) {
          px -= 2;
          ctx.font = `${weight} ${px}px "Helvetica Neue", Arial, sans-serif`;
        }
        return px;
      };
      ctx.fillStyle = '#f4f2ec';
      fit(label, 58, 'bold', w - 44);
      ctx.fillText(label, w / 2, sub ? 92 : 118);
      if (sub) {
        ctx.fillStyle = 'rgba(244,242,236,0.72)';
        fit(sub, 32, 'normal', w - 60);
        ctx.fillText(sub, w / 2, 146);
      }
    });
    const plate = mesh(new THREE.PlaneGeometry(radius * 1.5, radius * 0.59),
      standard({ map: texture, roughness: 0.6, metalness: 0.05 }));
    plate.position.set(0, height - 0.24, radius - 0.2);
    plate.rotation.x = -0.5;
    objects.push(plate);
  }
  return group(...objects);
}

// A plasma globe. The filaments are the exhibit, and they are real swept tubes rather than a
// texture: they have to fan from the electrode to the glass in three dimensions or the ball
// reads as a marble with scribble printed on it.
export function plasmaGlobe({ seed = 11, radius = 2.6, height = 4.2, filaments = 9 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const glow = [];
  put(parts, lathed(closed([
    [1.9, 0], [1.9, 0.5], [1.5, 0.9], [1.1, 1.3], [0.7, height - radius * 0.7],
  ]), { segments: 26 }), SHELL.steelDark);
  put(glow, ball(0.42, 14), 0xffd9a0, [0, height, 0]);
  for (let i = 0; i < filaments; i++) {
    const a = (i / filaments) * Math.PI * 2 + rng() * 0.5;
    const pitch = randomIn(rng, -0.8, 1.0);
    const pts = [];
    for (let k = 0; k <= 5; k++) {
      const t = k / 5;
      const r = 0.4 + t * (radius - 0.45);
      const aa = a + Math.sin(t * 3.1) * 0.34;
      pts.push([Math.cos(aa) * r, height + Math.sin(pitch) * r * 0.85 + Math.sin(t * 4) * 0.12, Math.sin(aa) * r]);
    }
    put(glow, tube(pts, [0.075, 0.055, 0.03], { sides: 6, tubular: 22 }), 0xc07af0);
  }
  // The glass LAST and OPAQUE-adjacent: at 0.34 opacity it is the one transparent surface in
  // the hall, and a plasma globe is the single exhibit where you genuinely cannot show the
  // thing without seeing through its shell.
  const shell = ball(radius, 26);
  return group(
    mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.4, metalness: 0.5 })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.2, emissive: 0xb46cff, emissiveIntensity: 1.15,
    })),
    mesh(placed(shell, { pos: [0, height, 0] }), standard({
      color: 0xbcd4e8, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.26,
      side: THREE.FrontSide, depthWrite: false,
    })),
  );
}

// A Van de Graaff generator. The sphere is the whole silhouette, so it is large and the
// column under it is deliberately slim -- get that ratio wrong and it is a lamp.
export function vanDeGraaff({ seed = 13, radius = 3.0, height = 9.5 } = {}) {
  const parts = [];
  const glow = [];
  put(parts, lathed(closed([
    [3.4, 0], [3.4, 0.7], [2.4, 1.1], [1.15, 1.6], [1.05, height - radius],
  ]), { segments: 28 }), SHELL.creamShade);
  const dome = ball(radius, 30);
  dome.scale(1, 0.82, 1);
  put(parts, dome, SHELL.steel, [0, height, 0]);
  put(parts, new THREE.TorusGeometry(radius * 0.62, radius * 0.16, 10, 30), SHELL.steel,
    [0, height - radius * 0.66, 0], [Math.PI / 2, 0, 0]);
  // The grounded discharge sphere on its arm, which is what makes it read as a demonstration
  // rather than as an ornament.
  chain(parts, SHELL.steelDark, [
    { p: [radius + 3.4, 0.4, 0], r: 0.34 },
    { p: [radius + 3.4, height - 0.6, 0], r: 0.24 },
    { p: [radius + 1.4, height - 0.2, 0], r: 0.2 },
  ], { sides: 12 });
  put(parts, ball(0.85, 20), SHELL.steel, [radius + 0.85, height - 0.15, 0]);
  put(glow, ball(0.3, 12), 0xdff0ff, [radius + 0.2, height - 0.1, 0]);
  return group(
    mesh(mergeParts(parts), standard({
      vertexColors: true, roughness: 0.3, metalness: 0.62,
      ...relief('metal', { seed, repeat: 5, strength: 0.4 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.15, emissive: 0x9fd8ff, emissiveIntensity: 1.3,
    })),
  );
}

// A Foucault pendulum: a brass bob on a long wire over a compass rose, with a ring of pegs
// for it to knock over. The pegs are the point of the exhibit -- without them it is a weight
// on a string.
export function foucaultPendulum({ seed = 17, height = 17, radius = 6.5, pegs = 24 } = {}) {
  const parts = [];
  put(parts, lathed(closed([
    [radius + 1.2, 0], [radius + 1.2, 0.45], [radius + 0.9, 0.65], [0, 0.65],
  ]), { segments: 44 }), SHELL.concrete);
  // The rose, as wedges of two tones rather than a texture: at floor level a student stands
  // right over it, where a 512px canvas is a handful of pixels per degree.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    put(parts, laid(extrudeOutline([
      [0, 0], [Math.cos(0.19) * radius * 0.92, Math.sin(0.19) * radius * 0.92],
      [Math.cos(-0.19) * radius * 0.92, Math.sin(-0.19) * radius * 0.92],
    ], 0.06), a), i % 2 ? SHELL.concreteDark : SHELL.stone, [0, 0.68, 0]);
  }
  for (let i = 0; i < pegs; i++) {
    const a = (i / pegs) * Math.PI * 2;
    put(parts, new THREE.CylinderGeometry(0.13, 0.16, 1.1, 8), 0xd8b25a,
      [Math.cos(a) * radius, 1.2, Math.sin(a) * radius]);
  }
  put(parts, new THREE.CylinderGeometry(0.07, 0.07, height - 3.1, 8), SHELL.steel, [0, height / 2 + 1.4, 0]);
  put(parts, lathed(closed([[0.9, 0], [0.9, 0.5], [0.35, 0.9]]), { segments: 18 }), SHELL.steelDark,
    [0, height - 1.7, 0]);
  const bob = ball(1.05, 22);
  bob.scale(1, 1.45, 1);
  put(parts, bob, 0xc9a24a, [0, 2.6, 0]);
  spike(parts, 0xc9a24a, { length: 0.9, radius: 0.32, at: [0, 1.25, 0], rot: [Math.PI, 0, 0], sides: 10 });
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.44, metalness: 0.48,
    ...relief('metal', { seed, repeat: 6, strength: 0.4 }),
  })));
}

// A lab bench: worktop, frame, sink, and the microscopes and glassware that say what it is.
export function labBench({ seed = 19, length = 12, depth = 3.4, height = 3.2 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const glow = [];
  const hl = length / 2;
  const hd = depth / 2;
  put(parts, extrudeOutline(roundedOutline(hl, hd, 0.2, 3), 0.36), 0x2f3338,
    [0, height - 0.18, 0], [Math.PI / 2, 0, 0]);
  put(parts, extrudeOutline(roundedOutline(hl - 0.3, hd - 0.25, 0.15, 2), height - 0.36), SHELL.cream,
    [0, (height - 0.36) / 2, 0], [-Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    boxAt(parts, SHELL.steelDark, [sx * hl - sx * 0.24, 0, -hd + 0.2], [sx * hl, 0.34, hd - 0.2]);
  }
  // The sink, as a real recess in the top: a rim proud of the worktop with a dark well
  // inside it, since a dark rectangle painted on a surface is a sticker rather than a basin.
  boxAt(parts, SHELL.steel, [hl - 3.6, height - 0.16, -1.0], [hl - 0.9, height + 0.06, 1.0]);
  boxAt(parts, 0x1a1d20, [hl - 3.4, height - 0.5, -0.82], [hl - 1.1, height - 0.02, 0.82]);
  chain(parts, SHELL.steel, [
    { p: [hl - 2.25, height + 0.05, -0.75], r: 0.11 },
    { p: [hl - 2.25, height + 1.5, -0.75], r: 0.09 },
    { p: [hl - 2.25, height + 1.5, -0.1], r: 0.08 },
  ], { sides: 8 });
  // Two microscopes: a foot, an arm, a barrel and a stage. The elbowed arm is what makes the
  // silhouette read at all.
  for (const mx of [-hl + 2.1, -hl + 5.2]) {
    put(parts, lathed(closed([[0.75, 0], [0.75, 0.22], [0.5, 0.4]]), { segments: 16 }), 0x23262a,
      [mx, height + 0.18, 0]);
    put(parts, laid(extrudeOutline([[0, 0], [0.36, 0], [0.36, 1.5], [0.9, 2.1], [0.55, 2.4], [0, 1.7]], 0.42), 0, 0),
      0x2c3035, [mx, height + 0.4, 0], [0, Math.PI / 2, 0]);
    put(parts, new THREE.CylinderGeometry(0.19, 0.24, 1.5, 12), 0x1a1d20,
      [mx + 0.62, height + 1.85, 0], [0.32, 0, 0]);
    boxAt(parts, 0x2c3035, [mx + 0.3, height + 1.0, -0.5], [mx + 1.1, height + 1.14, 0.5]);
    put(glow, new THREE.CylinderGeometry(0.13, 0.13, 0.1, 10), 0xf2f6ff, [mx + 0.7, height + 0.62, 0]);
  }
  // Glassware, in the colours a chemistry set actually is.
  for (let i = 0; i < 5; i++) {
    const gx = -hl + 6.6 + i * 0.95;
    const h = randomIn(rng, 0.7, 1.15);
    put(glow, lathed(closed([
      [0.34, 0], [0.36, h * 0.55], [0.17, h * 0.8], [0.16, h],
    ]), { segments: 14 }), GIZMO[(i * 3) % GIZMO.length], [gx, height + 0.18, randomIn(rng, -0.6, 0.6)]);
  }
  return group(
    mesh(mergeParts(parts), standard({
      vertexColors: true, roughness: 0.5, metalness: 0.3,
      ...relief('metal', { seed, repeat: 6, strength: 0.35 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.2, emissive: 0x8fd8ff, emissiveIntensity: 0.35,
    })),
  );
}

// The periodic table, as a real wall chart. THE CATEGORY COLOURS ARE THE EXHIBIT: a student
// can read the shape of the table -- the s block, the d block, the lanthanide strip pulled
// out below -- from across the hall long before a single symbol is legible, and that shape
// is most of what the table teaches.
export function periodicWall({ seed = 23, width = 22, height = 12 } = {}) {
  const parts = [];
  boxAt(parts, SHELL.steelDark, [-width / 2 - 0.4, -0.5, 0.16], [width / 2 + 0.4, height + 0.4, -0.16]);
  const texture = canvasTexture(1536, 840, (ctx, w, h) => {
    ctx.fillStyle = '#12161a';
    ctx.fillRect(0, 0, w, h);
    const cols = 18;
    const rows = 7;
    const pad = 44;
    const cw = (w - pad * 2) / cols;
    const ch = (h - pad * 2 - 70) / (rows + 2.2);
    const cat = {
      alkali: '#e0455f', alkaline: '#f2a541', tm: '#3d8bf2', post: '#7f8c99',
      metalloid: '#3fb37f', nonmetal: '#a8cc39', halogen: '#f7c948', noble: '#8a5cf5',
      lan: '#e8663f', act: '#d2447c',
    };
    // (group, period, span) for the main body -- the two-column s block, the ten-column d
    // block from period 4, and the p block on the right, which is the shape being taught.
    const cell = (g, p, colour, sym) => {
      const x = pad + (g - 1) * cw;
      const y = pad + 60 + (p - 1) * ch;
      ctx.fillStyle = colour;
      ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      ctx.fillStyle = 'rgba(10,12,15,0.82)';
      ctx.font = `bold ${Math.round(ch * 0.42)}px "Helvetica Neue", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (sym) ctx.fillText(sym, x + cw / 2, y + ch / 2);
    };
    const row = (p, spec) => { for (const [g, c, s] of spec) cell(g, p, c, s); };
    row(1, [[1, cat.nonmetal, 'H'], [18, cat.noble, 'He']]);
    row(2, [[1, cat.alkali, 'Li'], [2, cat.alkaline, 'Be'], [13, cat.metalloid, 'B'], [14, cat.nonmetal, 'C'],
      [15, cat.nonmetal, 'N'], [16, cat.nonmetal, 'O'], [17, cat.halogen, 'F'], [18, cat.noble, 'Ne']]);
    row(3, [[1, cat.alkali, 'Na'], [2, cat.alkaline, 'Mg'], [13, cat.post, 'Al'], [14, cat.metalloid, 'Si'],
      [15, cat.nonmetal, 'P'], [16, cat.nonmetal, 'S'], [17, cat.halogen, 'Cl'], [18, cat.noble, 'Ar']]);
    const tmRow = (p, syms) => {
      const spec = [[1, cat.alkali, syms[0]], [2, cat.alkaline, syms[1]]];
      for (let g = 3; g <= 12; g++) spec.push([g, cat.tm, syms[g - 1] || '']);
      for (let g = 13; g <= 18; g++) {
        const c = g >= 18 ? cat.noble : g >= 17 ? cat.halogen : g >= 15 ? cat.nonmetal : cat.post;
        spec.push([g, c, syms[g - 1] || '']);
      }
      row(p, spec);
    };
    tmRow(4, ['K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr']);
    tmRow(5, ['Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe']);
    tmRow(6, ['Cs', 'Ba', '', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn']);
    tmRow(7, ['Fr', 'Ra', '', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og']);
    // The two pulled-out strips, offset below and to the right exactly as a real chart has
    // them -- that offset is the whole reason they are recognisable.
    for (let i = 0; i < 15; i++) {
      cell(3 + i, 8.5, cat.lan, ['La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'][i]);
      cell(3 + i, 9.5, cat.act, ['Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr'][i]);
    }
    ctx.fillStyle = '#f2f4f7';
    ctx.textAlign = 'left';
    ctx.font = 'bold 44px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('THE PERIODIC TABLE OF THE ELEMENTS', pad, 46);
  });
  const board = mesh(new THREE.PlaneGeometry(width, height),
    standard({ map: texture, roughness: 0.62, metalness: 0.04, emissive: 0xffffff, emissiveIntensity: 0.12, emissiveMap: texture }));
  board.position.set(0, height / 2, 0.2);
  return group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.6, metalness: 0.2 })), board);
}

// A demonstration wind turbine, matching the one on the roof. Three real aerofoil blades on
// a nacelle that yaws, which is the difference between a turbine and a pinwheel.
export function turbineDemo({ seed = 29, height = 13, blade = 5.2, colour = 0xf2f0ea } = {}) {
  const parts = [];
  put(parts, lathed(closed([[2.1, 0], [2.1, 0.5], [0.9, 0.9], [0.42, 1.4], [0.3, height]]), { segments: 22 }),
    SHELL.steelDark);
  put(parts, solidLoft([
    { d: -1.5, w: 0.62, up: 0.62, dn: 0.62, round: 1 },
    { d: 0.6, w: 0.8, up: 0.8, dn: 0.8, round: 1 },
    { d: 2.3, w: 0.5, up: 0.5, dn: 0.5, round: 1 },
  ], { sides: 14, samples: 12, axis: 'z' }), colour, [0, height, -0.3]);
  put(parts, lathed(closed([[0.55, 0], [0.62, 0.35], [0.3, 0.7]]), { segments: 14 }), colour,
    [0, height, 1.9], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    // A real aerofoil section, twisted from root to tip -- flat plates read as a paper fan.
    put(parts, solidSurface({
      nu: 10, nv: 8, closedU: true,
      point: (u, v) => {
        const t = v;
        const chord = 0.95 - t * 0.5;
        const tw = (1 - t) * 0.55;
        const th = Math.sin(u * Math.PI * 2);
        const cx = Math.cos(u * Math.PI * 2) * chord * 0.5;
        const cy = th * chord * 0.11 * (1 - t * 0.4);
        const r = 0.7 + t * blade;
        return [
          Math.cos(a) * r - Math.sin(a) * (cx * Math.cos(tw) - cy * Math.sin(tw)),
          Math.sin(a) * r + Math.cos(a) * (cx * Math.cos(tw) - cy * Math.sin(tw)),
          cx * Math.sin(tw) + cy * Math.cos(tw),
        ];
      },
      thick: () => 0.012,
    }), colour, [0, height, 1.75]);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.42, metalness: 0.3,
    ...relief('metal', { seed, repeat: 5, strength: 0.35 }),
  })));
}

// Newton's cradle, at exhibit scale. The frame is the model: five balls hanging from a
// rectangle of bar with the wires crossing to a single plane, which is what stops them
// swinging sideways and is visible from three feet away.
export function newtonCradle({ seed = 31, height = 5.4, balls = 5 } = {}) {
  const parts = [];
  const w = 4.4;
  const d = 2.6;
  put(parts, extrudeOutline(roundedOutline(w / 2 + 0.5, d / 2 + 0.5, 0.25, 3), 0.4), 0x2f3338,
    [0, 0.2, 0], [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      chain(parts, SHELL.steel, [
        { p: [sx * w / 2, 0.35, sz * d / 2], r: 0.11 },
        { p: [sx * w / 2, height, sz * d / 2], r: 0.09 },
      ], { sides: 8 });
    }
    chain(parts, SHELL.steel, [
      { p: [sx * w / 2, height, -d / 2], r: 0.09 },
      { p: [sx * w / 2, height, d / 2], r: 0.09 },
    ], { sides: 8 });
  }
  const r = w / (balls * 2.15);
  for (let i = 0; i < balls; i++) {
    const x = (i - (balls - 1) / 2) * r * 2.05;
    put(parts, ball(r, 18), 0xc9ccd1, [x, height - 2.6, 0]);
    for (const sz of [-1, 1]) {
      chain(parts, 0xdad6c8, [
        { p: [x, height - 2.6 + r * 0.2, 0], r: 0.028 },
        { p: [x, height - 0.05, sz * d / 2], r: 0.028 },
      ], { sides: 5, capStart: false, capEnd: false });
    }
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.32, metalness: 0.62,
  })));
}

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

// The parking lot, which is most of the photograph's foreground and is what a student
// actually arrives standing on. Asphalt, a kerb, a sidewalk and painted bays.
//
// THE STRIPES ARE GEOMETRY, NOT A TEXTURE, for the reason the robot pads' markings are: a
// 4-inch line across a 150ft lot is a pixel or two of any texture this machine can afford,
// and it mips to nothing by the time somebody is standing on it.
export function parkingLot({
  seed = 37, width = 170, depth = 74, bays = 16, kerb = true,
} = {}) {
  const parts = [];
  const hw = width / 2;
  const hd = depth / 2;
  put(parts, extrudeOutline(roundedOutline(hw, hd, 1.2, 3), 0.34), SHELL.asphalt,
    [0, 0.17, 0], [Math.PI / 2, 0, 0]);
  const stripe = (x, z, len, rot, wide = 0.42, colour = 0xe8e4d6) => {
    put(parts, laid(extrudeOutline(roundedOutline(len / 2, wide / 2, wide / 2.4, 2), 0.05), rot),
      colour, [x, 0.36, z]);
  };
  // Two ranks of bays either side of a drive aisle.
  for (let i = 0; i <= bays; i++) {
    const x = -hw + 4 + (i * (width - 8)) / bays;
    stripe(x, -hd + 10, 17, Math.PI / 2);
    stripe(x, hd - 10, 17, Math.PI / 2);
  }
  stripe(0, 0, width - 14, 0, 0.5, 0xe0c94a);
  if (kerb) {
    for (const sz of [-1, 1]) {
      put(parts, laid(extrudeOutline(roundedOutline(hw + 1.4, 0.7, 0.25, 2), 0.75), 0), SHELL.concrete,
        [0, 0.38, sz * (hd + 0.7)]);
    }
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.95, metalness: 0.02,
    ...relief('stone', { seed, repeat: 30, strength: 0.7 }),
  })));
}

// A clipped boxwood ball. The row of them along the tower wall is the single most
// recognisable piece of landscaping in the photograph.
//
// It is a ROUGHENED sphere and not a smooth one: a clipped shrub is trimmed, not moulded, so
// its outline is a circle with a slight nap on it, and a perfectly smooth ball at this size
// reads as a bowling ball painted green.
export function clippedShrub({ seed = 41, radius = 1.9, hue = null } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const g = ball(radius, 22);
  g.scale(1, 0.92, 1);
  tintGeometry(g, (p) => {
    const n = smoothNoise3(p.x * 2.6 + seed, p.y * 2.6, p.z * 2.6);
    const lit = THREE.MathUtils.clamp(0.62 + p.y / radius * 0.45, 0, 1);
    const base = new THREE.Color(hue ?? PLANT.boxwood);
    const pale = new THREE.Color(PLANT.boxwoodPale);
    const c = base.clone().lerp(pale, lit * (0.45 + n * 0.5));
    return [c.r, c.g, c.b];
  });
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + (smoothNoise3(x * 3.4 + seed, y * 3.4, z * 3.4) - 0.5) * 0.14;
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  parts.push({ geometry: g, color: 0xffffff, position: [0, radius * 0.88, 0], keepColor: true });
  put(parts, lathed(closed([[radius * 0.95, 0], [radius * 0.85, 0.18]]), { segments: 20 }), PLANT.mulch);
  for (let i = 0; i < 3; i++) {
    put(parts, new THREE.CylinderGeometry(0.1, 0.14, radius * 0.5, 6), PLANT.bark,
      [randomIn(rng, -0.2, 0.2), radius * 0.25, randomIn(rng, -0.2, 0.2)]);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.88, metalness: 0.02,
    ...relief('bark', { seed, repeat: 5, strength: 0.5 }),
  })));
}

// The monument sign at the road, carrying the Greenbush mark. `greenbushMark` is drawn in
// code in ObservatoryProps and reused here rather than copied: it is the organisation's own
// mark and there should be exactly one of it in this repo.
export function monumentSign({ seed = 43, width = 11, height = 6.4 } = {}) {
  const parts = [];
  boxAt(parts, SHELL.brickDeep, [-width / 2 - 0.9, 0, -1.5], [width / 2 + 0.9, 1.1, 1.5]);
  boxAt(parts, SHELL.brick, [-width / 2, 1.1, -1.1], [width / 2, height, 1.1]);
  put(parts, mouldedRing([[0, 0], [0.55, 0.28], [0.55, 0.85], [0, 1.1]], width / 2 + 0.1, 1.2,
    { closeTop: true }), SHELL.green, [0, height, 0]);
  const face = canvasTexture(700, 470, greenbushMark);
  const board = mesh(new THREE.PlaneGeometry(width - 1.6, (width - 1.6) * 0.67),
    standard({ map: face, roughness: 0.55, metalness: 0.04 }));
  board.position.set(0, height * 0.58, 1.16);
  const back = board.clone();
  back.position.z = -1.16;
  back.rotation.y = Math.PI;
  return group(
    mesh(brickTint(mergeParts(parts)), standard({
      vertexColors: true, roughness: 0.9, metalness: 0.03,
      ...relief('stone', { seed, repeat: 8, strength: 0.8 }),
    })),
    board, back,
  );
}

// A flagpole. The flag is a real solid with a wave in it -- a zero-thickness plane vanishes
// edge-on, and a flag seen edge-on is exactly what a flagpole gives you half the time.
export function flagPole({ seed = 47, height = 32, flag = true } = {}) {
  const parts = [];
  put(parts, lathed(closed([[1.5, 0], [1.5, 0.6], [1.0, 0.95], [0.36, 1.5], [0.22, height]]), { segments: 20 }),
    SHELL.steel);
  put(parts, ball(0.42, 14), 0xd8b25a, [0, height + 0.2, 0]);
  if (flag) {
    const stripes = 13;
    for (let i = 0; i < stripes; i++) {
      const t = i / stripes;
      put(parts, solidSurface({
        nu: 12, nv: 2,
        point: (u, v) => {
          const x = 0.25 + u * 9.5;
          return [x, height - 2.2 - (t + v / stripes) * 5.6, Math.sin(u * 4.2) * (0.25 + u * 0.9)];
        },
        thick: () => 0.035,
      }), i % 2 ? 0xc8102e : 0xf4f2ec);
    }
    put(parts, solidSurface({
      nu: 8, nv: 2,
      point: (u, v) => [0.25 + u * 3.9, height - 2.2 - v * 3.0, Math.sin(u * 4.2) * (0.25 + u * 0.55)],
      thick: () => 0.045,
    }), 0x1c3a70);
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.5, metalness: 0.35,
  })));
}
