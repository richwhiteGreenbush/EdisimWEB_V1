import * as THREE from 'three';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief,
} from '../PropKit.js';
import {
  solidLoft, grooveAt, revolve, solidSurface, extrudeOutline, gearWheel,
  ball, tube, chain, spike, mergeParts, tintGeometry, placed, xformed,
  roundedOutline, lensOutline, ringPts, put,
} from './LoftKit.js';

// The Robot Challenge World -- five programmable machines standing on painted test pads,
// with the workshop that services them planted round the edges.
//
// THE ONE DECISION THAT SHAPES THIS FILE: unlike every other world here, the hero model is
// something a student walks right up to and stands nose to nose with. The Space Needle is
// read at 220ft and spends its budget on silhouette; a dinosaur is read at forty. This
// robot is read at SIX, which is the distance at which every join, every seam and every
// crescent of daylight between two solids is not merely visible but is the only thing you
// can see. So the whole file is built on one rule -- NOTHING IS PLACED ON A SURFACE, IT IS
// SUNK INTO ONE -- and `stud`, `shellPatch` and `onShell` below exist to make that
// structural rather than remembered.
//
// The robot is in the style of the classroom coding robots this app is meant to sit
// alongside: a tri-lobe body, one enormous single eye, and a bright two-colour paint job.
// It is not a model of any particular product and carries no brand.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// FIVE ROBOTS THAT CAN BE TOLD APART FROM ACROSS THE FIELD, which is a stronger condition
// than five different colours. Each is a saturated shell against a near-complementary
// accent, and the five shells are spread right round the wheel -- cyan, coral, lime, amber,
// violet -- so no two are adjacent hues at any distance. The accent is what the eye's bezel
// and every button is painted, so it is a second, independent signal on the same object:
// the cyan robot has orange buttons and the amber one teal, and either half alone is enough
// to name which robot a board is talking about.
export const ROBOT_SKINS = {
  cyan: { body: 0x22b3cc, shade: 0x1a8ea3, accent: 0xf2661f, accentDeep: 0xc44e14 },
  coral: { body: 0xe0453c, shade: 0xb2352d, accent: 0xf7c948, accentDeep: 0xc79a2c },
  lime: { body: 0x74c043, shade: 0x569633, accent: 0x7d4ce0, accentDeep: 0x5f36ad },
  amber: { body: 0xf2971f, shade: 0xc27615, accent: 0x1aa79c, accentDeep: 0x13807a },
  violet: { body: 0x8352d9, shade: 0x6539ad, accent: 0xb7e04a, accentDeep: 0x8fb133 },
};

// The workshop the robots live in. Deliberately LOW SATURATION across the board: the five
// shells and the planting are the only saturated things in this world, and a workbench or a
// crate painted as brightly as a robot competes with the thing it is meant to serve.
const SHOP = {
  deck: 0xc3bdae,
  deckShade: 0xaba695,
  kerb: 0xd2cec2,
  paint: 0xf4f1e8,
  paintDark: 0x3d4046,
  steel: 0x9aa1a8,
  steelDark: 0x4d545b,
  steelBright: 0xc6ccd2,
  rubber: 0x35383d,
  timber: 0xa8814f,
  timberDark: 0x7c5c37,
  brass: 0xc19a4b,
  mulch: 0x4a3a2c,
};

// The gizmos: the ornamental, non-teaching props. These ARE allowed to be loud -- a
// robotics field is a place with orange cones and yellow beacons in it, and the whole
// reason to build a kinetic sculpture is that it catches the eye.
const GIZMO = [0xe0455f, 0xf2a541, 0x3fb37f, 0x3d8bf2, 0x8a5cf5, 0xf7c948, 0x1aa79c, 0xe8663f];

// ---------------------------------------------------------------------------
// Local helpers -- the three that make "leave no open spaces" structural
// ---------------------------------------------------------------------------

// `revolve` DECIDES ITS WINDING FROM THE PROFILE'S DIRECTION, so a profile written the way
// anybody writes one -- from the bottom up -- comes out INSIDE OUT, and under a FrontSide
// material that reads as a DARK surface rather than as a missing one. The full measurement
// is recorded in SeattleProps.js; nothing in this file calls `revolve` directly either.
function lathed(profile, opts) {
  return revolve([...profile].reverse(), opts);
}

// A lathe profile that does not start and end ON THE AXIS is an open tube, and the hole is
// at the top of the post where a student looking up sees straight down it. Every mast, post
// and cone in this file goes through here so that cannot be forgotten once per prop.
function closed(profile) {
  const out = [...profile];
  if (out[0][0] > 1e-4) out.unshift([0, out[0][1]]);
  const last = out[out.length - 1];
  if (last[0] > 1e-4) out.push([0, last[1]]);
  return out;
}

// mergeParts applies a part's rotation as ONE Euler in XYZ order, which composes as
// Rx * Ry * Rz -- so a middle Y term is applied BEFORE the X term, not after it. For a plate
// authored upright in XY and then laid down by Rx(pi/2), that is the entire difference
// between turning it IN PLAN and TILTING it out of the ground.
//
// Measured rather than reasoned about: the plate's own normal, which should stay at |y| = 1
// however far it is turned, comes back 0.958 at 0.29 radians, 0.894 at 0.4636 and 0.697 at
// 0.8 -- a 45 degree tilt. Every painted lane, square and chevron on the five test pads was
// standing at an angle out of the paving, and the symptom was not a rotation that looked
// wrong so much as pads whose bounding boxes measured four to nine FEET tall instead of six
// inches. Baking the pair as a matrix in the order actually wanted returns 1.000 at every
// angle.
function laid(geometry, rotY = 0, tip = Math.PI / 2) {
  return xformed(geometry, new THREE.Matrix4().makeRotationY(rotY)
    .multiply(new THREE.Matrix4().makeRotationX(tip)));
}

// extrudeOutline runs from -depth/2 to +depth/2, never from 0 -- right for the mouldings it
// was written for, and a trap for anything authored from the ground up. See SeattleProps.
function upright(list, colour, outline, height, { at = [0, 0, 0], rotY = 0, tint = null } = {}) {
  put(list, laid(extrudeOutline(outline, height), rotY, -Math.PI / 2), colour,
    [at[0], at[1] + height / 2, at[2]], null, tint ? { tint } : null);
}

function slab(list, colour, { halfW, halfD, thick, at, ease = 0.5, rotY = 0, tint = null }) {
  put(list, laid(extrudeOutline(roundedOutline(halfW, halfD, ease, 3), thick), rotY), colour,
    [at[0], at[1] - thick / 2, at[2]], null, tint ? { tint } : null);
}

// A point on an ellipsoid in a given direction, together with that surface's TRUE normal.
//
// Every button, port, grille and panel on this robot is positioned through here rather than
// by hand-picked coordinates, and that is not tidiness. A boss placed at a guessed point
// near a sphere is either floating -- which at six feet is a crescent of daylight round half
// its base -- or buried, and the two failures look nothing alike, so hand-placing means
// hunting each one separately. Asking the shell where its own surface is cannot produce
// either.
//
// The normal is NOT the direction: on an ellipsoid the outward normal is the gradient,
// which points somewhere else entirely wherever the three radii differ. Using the direction
// instead tips every stud on the robot's flattened face.
function onShell(centre, radii, dir) {
  const d = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const [rx, ry, rz] = radii;
  const k = 1 / Math.hypot(d.x / rx, d.y / ry, d.z / rz);
  const p = [centre[0] + d.x * k, centre[1] + d.y * k, centre[2] + d.z * k];
  const n = new THREE.Vector3((d.x * k) / (rx * rx), (d.y * k) / (ry * ry), (d.z * k) / (rz * rz));
  return { p, n: [n.x, n.y, n.z] };
}

// A CLOSED flattened ball sunk into whatever it stands on, aligned to that surface's normal.
// Every button, boss, lens, grille and port on this robot is one of these.
//
// It is a closed sphere flattened, never a partial one -- the rule Fantastic Voyage's
// `blister` was rewritten for. A partial sphere's rim is a hole and its inside is back
// faces, so unless the rim is completely buried you look straight through it, and on a
// convex host half the rim never is.
function stud(list, colour, {
  at, normal, radius, rise, wide = 1, long = 1, sink = 0.55, detail = 14,
}) {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]).normalize();
  const g = ball(radius, detail);
  g.scale(wide, rise / radius, long);
  const m = new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n),
  );
  m.setPosition(
    at[0] - n.x * rise * sink, at[1] - n.y * rise * sink, at[2] - n.z * rise * sink,
  );
  list.push({ geometry: xformed(g, m), color: colour });
}

// A panel lying ON a spherical shell -- the chest yoke, the head's rear hatch.
//
// A FLAT PLATE CANNOT LIE ON A SPHERE. Sink it far enough for its rim to disappear and its
// middle disappears too; raise its middle clear and its corners lift off. The first pass of
// the chest plate was a flat rounded box and it read as a black card taped to the robot, its
// bottom corners standing a full inch off the shell.
//
// So the panel is a real patch of a slightly LARGER concentric sphere, and the trick that
// closes it is that the mid-surface radius VARIES: proud of the host in the middle, inside
// it at every edge. The thickness goes to zero at the border, so solidSurface emits no rim
// there at all, and the panel ends by passing through the shell rather than by stopping on
// it.
function shellPatch(list, colour, {
  centre, radius, azimuth = 0, elevation = 0, halfA, halfE,
  taper = 1, thick = 0.055, proud = 0.02, bury = 0.05, nu = 14, nv = 12,
}) {
  const edge = (u, v) => {
    const e = Math.min(1, 3.2 * Math.min(u, 1 - u, v, 1 - v));
    return e * e * (3 - 2 * e);
  };
  const point = (u, v) => {
    const ha = halfA * (taper + (1 - taper) * v);
    const a = azimuth + (u - 0.5) * 2 * ha;
    const e = elevation + (v - 0.5) * 2 * halfE;
    const r = radius + proud - bury * (1 - edge(u, v));
    return [
      centre[0] + r * Math.cos(e) * Math.sin(a),
      centre[1] + r * Math.sin(e),
      centre[2] + r * Math.cos(e) * Math.cos(a),
    ];
  };
  list.push({ geometry: solidSurface({ nu, nv, point, thick: (u, v) => thick * edge(u, v) }), color: colour });
}

// A sphere as loft stations, with an INDEPENDENT front (+Z) extent.
//
// For a loft on the 'y' axis `up` is the +Z half-extent and `dn` the -Z one, so `front`
// squashes the face only and leaves the back of the shell perfectly round. That one number
// is what lets the eye pod stand proud of the head without the head bulging through it --
// see the note on the eye below.
function shellStations(radius, { rows = 22, front = 1, flat = 1 } = {}) {
  const st = [];
  for (let i = 0; i <= rows; i++) {
    const phi = (i / rows) * Math.PI;
    const r = Math.max(0.004, Math.sin(phi) * radius);
    st.push({
      d: -Math.cos(phi) * radius * flat, w: r, up: r * front, dn: r, round: 1,
    });
  }
  return st;
}

// The moulded parting line every shell on this robot carries, as a GROOVE in the shell's own
// surface rather than as an applied ring. A displacement of a surface cannot open a gap in
// it, and an applied ring on a sphere is a crescent of daylight waiting to happen.
//
// Half-width 0.022 against 44 samples is about three samples across the groove: narrow
// enough to read as a tool line, wide enough to escape the aliasing that turns an
// under-sampled warp into garbage normals.
const partingLine = (depth = 0.05) => (t) => grooveAt(t - 0.5, 0.022, depth);

// ---------------------------------------------------------------------------
// THE ROBOT
// ---------------------------------------------------------------------------

// Authored at 6.4ft tall and scaled at the end, so every number below is a real proportion
// rather than a fraction of an option. A classroom robot of this shape is about six inches
// tall, so this is roughly TWELVE TIMES life size, and its placard says so.
//
// Four things carry the identification, in the order they matter -- get any of them wrong
// and it is a generic droid:
//
//  1. THE EYE, which is most of the animal. It is enormous -- three quarters of the head's
//     width -- and it is a stack: an accent-coloured bezel ring, a white spoked LED disc,
//     a domed black pupil, and one specular highlight. Shrink it and the robot goes blank.
//  2. THE TRI-LOBE BODY. Two big lobes side by side with a third pushed forward between
//     them, all three the same family of size. Two lobes is a scooter; four is a car.
//  3. THE HEAD SITS IN THE NOTCH, not on a neck. It overlaps both rear lobes, and the black
//     collar fills what is left of the crease.
//  4. THE TWO-COLOUR PAINT. One saturated shell, one near-complementary accent, and nothing
//     else. A third colour anywhere and it stops reading as a moulded toy.
//
// SEGMENT COUNTS ARE HIGH HERE AND THAT IS DELIBERATE. Everything else in this app argues
// DOWN from viewing distance -- the Park's geese are 18-segment sweeps because they are read
// across a pond, and that argument is perceptual and survives any hardware target. This is
// the opposite case and the argument runs the other way: five of these stand on pads a
// student walks right onto, and at six feet a 20-sided sphere is visibly a polyhedron and a
// 34-sided one still shows its facets along the terminator.
//
// MEASURED: 28.6k triangles a robot, 143k for all five, in a world that draws 671k against
// an envelope of about 1.5M. The first pass ran the shells at 34 and 36 sides for 17.8k
// each, which left more than half this world's budget unspent -- and on the one object the
// whole world exists for, spare budget is not a virtue.
export function robot({
  seed = 5, height = 6.4, skin = 'cyan', body = null, accent = null,
} = {}) {
  const rng = seededRandom(seed);
  const tone = ROBOT_SKINS[skin] || ROBOT_SKINS.cyan;
  const SHELL = body ?? tone.body;
  const ACCENT = accent ?? tone.accent;
  const DEEP = tone.accentDeep;
  const parts = [];
  const glow = [];

  // --- the three body lobes ----------------------------------------------
  const LOBE_R = 1.80;
  const LOBE_X = 1.66;
  const LOBE_Y = 1.80;
  const LOBE_Z = -0.70;
  const FRONT_R = 1.66;
  const FRONT_Y = 1.66;
  const FRONT_Z = 1.34;
  const HEAD_R = 1.76;
  const HEAD_Y = 4.55;
  const HEAD_Z = 0.30;
  const HEAD_FRONT = 0.72;

  // EVERY PAIR OF LOBES OVERLAPS, which is the whole of why this cluster has no seams. The
  // two rear lobes are 3.32ft apart with 3.60ft of radius between them, the front lobe
  // overlaps each of them by 0.83, and the head overlaps the rear pair by 0.20 and the
  // front lobe by 0.26. Those margins are small on purpose -- large ones swallow the crease
  // that makes it three lobes rather than one blob -- so anything that moves a centre here
  // has to be re-checked against its neighbours' radii, not merely eyeballed.
  const lobe = solidLoft(shellStations(LOBE_R, { rows: 26 }), {
    sides: 46, samples: 58, axis: 'y', warp: partingLine(0.05),
  });
  put(parts, lobe, SHELL, [-LOBE_X, LOBE_Y, LOBE_Z]);
  put(parts, lobe, SHELL, [LOBE_X, LOBE_Y, LOBE_Z]);
  put(parts, solidLoft(shellStations(FRONT_R, { rows: 26 }), {
    sides: 46, samples: 58, axis: 'y', warp: partingLine(0.05),
  }), SHELL, [0, FRONT_Y, FRONT_Z]);

  // --- the head ----------------------------------------------------------
  put(parts, solidLoft(shellStations(HEAD_R, { front: HEAD_FRONT, rows: 26 }), {
    sides: 48, samples: 60, axis: 'y', warp: partingLine(0.045),
  }), SHELL, [0, HEAD_Y, HEAD_Z]);

  // The collar: a flattened closed ellipsoid filling the crease between the head and the
  // body. It reads as the black yoke these robots wear and it does a structural job as well
  // -- it overlaps the head above and the front lobe below, so the one place on the model
  // where three shells nearly meet is covered by a fourth.
  const collar = ball(1, 30);
  collar.scale(1.40, 0.60, 1.50);
  put(parts, collar, SHOP.paintDark, [0, 3.32, 0.70]);

  // The chest yoke, lying on the front lobe's own sphere.
  shellPatch(parts, SHOP.paintDark, {
    centre: [0, FRONT_Y, FRONT_Z], radius: FRONT_R,
    azimuth: 0, elevation: 0.34, halfA: 0.80, halfE: 0.50,
    taper: 0.44, thick: 0.06, proud: 0.022, bury: 0.06,
  });
  // The chest lamp -- clear, lit, and sunk into the yoke it sits on.
  {
    const { p, n } = onShell([0, FRONT_Y, FRONT_Z], [FRONT_R, FRONT_R, FRONT_R], [0, 0.36, 1]);
    stud(glow, 0xf4f8ff, { at: [p[0], p[1], p[2] + 0.03], normal: n, radius: 0.40, rise: 0.22, sink: 0.42 });
  }

  // --- THE EYE -----------------------------------------------------------
  //
  // The pod is ONE closed surface of revolution running from deep inside the head out to the
  // bezel crown, so the join between the eye and the head is not a join at all -- the pod
  // simply emerges. Its back rim sits at z = 0.20 from the head centre where the head's own
  // surface is at 0.90, so a quarter of the pod is buried and no camera angle can find an
  // edge.
  //
  // THE HEAD'S FRONT IS SQUASHED TO 0.72 FOR THIS ONE REASON. A round head of radius 1.76
  // reaches z = 1.76 at its pole, and the eye's face sits at 1.42 -- so on a round head the
  // shell bulges straight THROUGH the middle of the eye and the robot appears to have a
  // blue ball where its pupil should be. Flattening only the +Z half fixes it and leaves the
  // back of the head perfectly round, which is what `up` vs `dn` on a 'y' loft is for.
  const pod = lathed([
    [0.00, 0.18], [1.24, 0.20], [1.28, 0.70], [1.30, 1.16], [1.28, 1.38],
    [1.20, 1.52], [1.02, 1.58], [0.94, 1.46], [0.55, 1.44], [0.00, 1.42],
  ], { segments: 76 });
  put(parts, pod, 0xffffff, [0, HEAD_Y, HEAD_Z], [Math.PI / 2, 0, 0], {
    keepColor: true,
    // ONE SOLID, TWO COLOURS. The bezel and the dished face are the same closed lathe, split
    // by radius in the tint rather than built as two rings -- which is what guarantees there
    // is no seam between them to leave a gap at. The tint runs BEFORE the part's transform,
    // so the radius is measured in the lathe's own authored frame, about Y.
    tint: (p) => {
      const c = new THREE.Color(Math.hypot(p.x, p.z) > 0.90 ? ACCENT : SHOP.paint);
      return [c.r, c.g, c.b];
    },
  });

  // The lit ring. A full disc rather than an annulus: the pupil covers the middle anyway, and
  // an annulus is the one shape extrudeOutline cannot cap without throwing triangles across
  // its own hole.
  const led = new THREE.CylinderGeometry(0.96, 0.96, 0.10, 60);
  put(glow, led, 0xf6f9ff, [0, HEAD_Y, HEAD_Z + 1.50], [Math.PI / 2, 0, 0]);

  // Fourteen radial spokes. They live in the MATTE mesh, not the lit one, which is what
  // makes them read as the divisions between lit segments without needing a second emissive
  // colour -- an emissive is a flat material property and vertex colours do not multiply it,
  // so a dark spoke inside the glowing mesh would simply glow white too.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    put(parts, new THREE.BoxGeometry(0.44, 0.055, 0.11), 0xdfe3e8,
      [Math.cos(a) * 0.73, HEAD_Y + Math.sin(a) * 0.73, HEAD_Z + 1.54], [0, 0, a]);
  }

  // The pupil, domed and sunk two thirds into the ring, and one specular highlight. The
  // highlight is the cheapest thing on the model and close to the most important: without it
  // a matte black ball reads as a hole in the robot's face rather than as a lens.
  put(parts, ball(0.52, 34), 0x14161a, [0, HEAD_Y, HEAD_Z + 1.36]);
  put(glow, ball(0.115, 12), 0xffffff, [-0.208, HEAD_Y + 0.247, HEAD_Z + 1.736]);

  // --- buttons, ports and grilles ----------------------------------------
  //
  // Positioned by asking each shell where its surface is, never by hand.
  const HEAD_RADII = [HEAD_R, HEAD_R, HEAD_R * HEAD_FRONT];
  const LOBE_RADII = [LOBE_R, LOBE_R, LOBE_R];
  const button = (centre, radii, dir, r = 0.34, rise = 0.115, colour = ACCENT) => {
    const { p, n } = onShell(centre, radii, dir);
    stud(parts, colour, { at: p, normal: n, radius: r, rise });
  };

  button([0, HEAD_Y, HEAD_Z], HEAD_RADII, [-0.34, 1, -0.30]);
  button([0, HEAD_Y, HEAD_Z], HEAD_RADII, [0.34, 1, -0.30]);
  button([-LOBE_X, LOBE_Y, LOBE_Z], LOBE_RADII, [-1, 0.34, 0.10], 0.42, 0.13);
  button([LOBE_X, LOBE_Y, LOBE_Z], LOBE_RADII, [1, 0.34, 0.10], 0.42, 0.13);
  button([0, FRONT_Y, FRONT_Z], [FRONT_R, FRONT_R, FRONT_R], [-0.86, 0.30, 0.42], 0.36, 0.12);

  // The speaker grille, the top port and the power rocker -- all flattened studs, all sunk.
  {
    const g = onShell([LOBE_X, LOBE_Y, LOBE_Z], LOBE_RADII, [0.80, 0.06, 0.60]);
    stud(parts, SHOP.paintDark, { at: g.p, normal: g.n, radius: 0.30, rise: 0.06, wide: 1.7, long: 0.9, sink: 0.35 });
    const port = onShell([-LOBE_X, LOBE_Y, LOBE_Z], LOBE_RADII, [-0.28, 0.90, 0.34]);
    stud(parts, SHOP.paintDark, { at: port.p, normal: port.n, radius: 0.26, rise: 0.05, wide: 1.5, long: 0.85, sink: 0.35 });
    const sw = onShell([LOBE_X, LOBE_Y, LOBE_Z], LOBE_RADII, [0.84, -0.24, -0.48]);
    stud(parts, SHOP.paintDark, { at: sw.p, normal: sw.n, radius: 0.22, rise: 0.06, wide: 1.9, long: 0.8, sink: 0.3 });
  }

  // The rear hatch, on the head's round back where the shell is not squashed.
  shellPatch(parts, tone.shade, {
    centre: [0, HEAD_Y, HEAD_Z], radius: HEAD_R,
    azimuth: Math.PI, elevation: 0.10, halfA: 0.60, halfE: 0.46,
    taper: 0.86, thick: 0.05, proud: 0.018, bury: 0.05, nu: 12, nv: 10,
  });

  const scale = height / 6.4;
  const shellGeometry = mergeParts(parts);
  const glowGeometry = mergeParts(glow);

  return group(
    // Glossy moulded plastic, and DELIBERATELY WITHOUT a relief bump map. Every other
    // hand-built object in this app takes one, because a smooth analytic solid under a
    // single sun reads as plastic -- which is the complaint everywhere else and is the
    // objective here. Grain on this shell would make it look like unfinished resin.
    mesh(placed(shellGeometry, { scale: [scale, scale, scale] }),
      standard({ vertexColors: true, roughness: 0.26, metalness: 0.06 })),
    mesh(placed(glowGeometry, { scale: [scale, scale, scale] }),
      standard({
        vertexColors: true, roughness: 0.18, metalness: 0,
        emissive: 0xffffff, emissiveIntensity: 0.5,
      })),
  );
}

// ---------------------------------------------------------------------------
// The test pads
// ---------------------------------------------------------------------------

// A pad is a slab with the challenge's own path painted on it, and the painting is the
// point: challenge 3 asks a student to drive a square, and a square is painted on the floor
// for them to check their program against. A program that comes back to the wrong corner is
// then a thing you can SEE rather than a thing you have to remember.
//
// The marks are geometry, not a texture, for the same reason the museum's floor keeps its
// canvas: a painted line 0.5ft wide on a 17ft slab is four pixels of any texture a machine
// like this can afford, and it mips to nothing by the time a student is standing on it.
export function robotPad({
  seed = 3, size = 17, accent = 0x3d8bf2, mark = 'line', number = 1, name = '',
  start = [0, 0],
} = {}) {
  const parts = [];
  const half = size / 2;
  const TOP = 0.19;

  // The slab and its kerb. Two tones, because a single flat grey 17ft square in a green
  // field reads as a hole rather than as paving.
  slab(parts, SHOP.kerb, { halfW: half + 0.45, halfD: half + 0.45, thick: 0.30, at: [0, TOP - 0.06, 0], ease: 0.9 });
  slab(parts, SHOP.deck, { halfW: half, halfD: half, thick: 0.34, at: [0, TOP, 0], ease: 0.7 });

  // A painted bar. Everything below is built from these, and they OVERLAP at every corner
  // rather than butting -- four bars mitred to meet exactly is four chances to leave a
  // hairline of grey showing through the paint.
  const bar = (x, z, len, rot, width = 0.5, colour = accent) => {
    put(parts, laid(extrudeOutline(roundedOutline(len / 2, width / 2, width / 2.2, 2), 0.05), rot),
      colour, [x, TOP + 0.02, z]);
  };
  const chevron = (x, z, rot, colour = accent) => {
    put(parts, laid(extrudeOutline([[0, 0.9], [0.62, -0.1], [0.34, -0.42], [0, 0.16], [-0.34, -0.42], [-0.62, -0.1]], 0.05), rot),
      colour, [x, TOP + 0.02, z]);
  };
  // A painted ring, as a closed revolved profile -- the one shape that cannot be made from
  // bars without showing its facets.
  const ring2 = (x, z, radius, width, colour = accent) => {
    const r0 = radius - width / 2;
    const r1 = radius + width / 2;
    put(parts, lathed([[r0, 0], [r1, 0], [r1, 0.05], [r0, 0.05], [r0, 0]], { segments: 64 }),
      colour, [x, TOP + 0.005, z]);
  };
  const ring = (radius, width, colour = accent) => ring2(0, 0, radius, width, colour);

  if (mark === 'line') {
    // Challenge 1: out and back. A lane with a start bar and a turn mark at the far end.
    // `bar` runs its length along the outline's X, which `laid` maps to world X -- so the
    // LANE, which has to run the way the robot drives (its own +Z), takes pi/2 and the start
    // line across it takes 0. The first pass had these the other way round and the lane ran
    // across the pad, at right angles to every program written for it.
    bar(0, 0, size - 4, Math.PI / 2, 0.55);
    bar(start[0], start[1], 4.2, 0, 0.5, SHOP.paint);
    chevron(0, -half + 3.2, 0);
    chevron(0, -half + 4.6, 0);
  } else if (mark === 'spin') {
    // Challenge 2: spin on the spot. A ring with four tick marks, so a quarter turn is
    // something a student can count rather than guess.
    ring(4.9, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      bar(Math.sin(a) * 4.9, Math.cos(a) * 4.9, 1.5, a + Math.PI / 2, 0.42, SHOP.paint);
    }
    ring(1.5, 0.4, SHOP.paint);
  } else if (mark === 'square') {
    // Challenge 3: drive a square, and the paint is the path the board's program ACTUALLY
    // traces -- verified by running it. `repeat 4 { move forward 8, rotate 90 }` walks
    // (0,0) -> (0,8) -> (8,8) -> (8,0) -> (0,0) in the pad's own frame, so the robot starts
    // on a CORNER of the square rather than in the middle of it, and the layout offsets it
    // there. Painted round the pad's centre with the robot standing at that centre, the
    // traced square is the right size and in the wrong place, and a student comparing the
    // two concludes their program is broken.
    const s = 4;
    bar(0, -s, s * 2, 0);
    bar(0, s, s * 2, 0);
    bar(-s, 0, s * 2, Math.PI / 2);
    bar(s, 0, s * 2, Math.PI / 2);
    for (const [x, z] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
      put(parts, laid(extrudeOutline(roundedOutline(0.55, 0.55, 0.18, 2), 0.05)), SHOP.paint,
        [x, TOP + 0.03, z]);
    }
  } else if (mark === 'course') {
    // Challenge 4: a patrol with a hop in it. A square course with a marked hop zone, so
    // the `move up by` half of the program has somewhere to be aimed at.
    const s = 4.4;
    bar(0, -s, s * 2, 0, 0.45);
    bar(0, s, s * 2, 0, 0.45);
    bar(-s, 0, s * 2, Math.PI / 2, 0.45);
    bar(s, 0, s * 2, Math.PI / 2, 0.45);
    for (let i = 0; i < 3; i++) {
      bar(-s + 1.4 + i * 1.5, -s, 2.6, Math.PI / 2, 0.35, SHOP.paint);
    }
    chevron(s, -s + 2.2, -Math.PI / 2);
    chevron(-s, s - 2.2, Math.PI / 2);
  } else if (mark === 'signal') {
    // Challenge 5: the broadcast. Concentric arcs radiating from a transmitter mark, which
    // is the only picture that says "this one listens for something the others say".
    // THE RINGS HAVE TO CLEAR THE ROBOT STANDING ON THEM. At 2.2, 3.7 and 5.2 the first two
    // were entirely underneath a machine seven feet across and the pad read as blank -- the
    // one pad in the world whose marking is its whole explanation.
    ring(4.6, 0.5);
    ring(6.1, 0.4, SHOP.paint);
    ring(7.5, 0.34);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      bar(Math.sin(a) * 3.4, Math.cos(a) * 3.4, 1.6, a + Math.PI / 2, 0.3, SHOP.paint);
    }
  }

  // The start marker, at the exact spot the robot stands. Every closed path on these pads
  // begins and ends here, so it is the one mark a student checks their program against.
  if (mark !== 'spin' && mark !== 'signal') {
    ring2(start[0], start[1], 1.15, 0.34, SHOP.paint);
    put(parts, laid(extrudeOutline(roundedOutline(0.34, 0.34, 0.12, 2), 0.05)), accent,
      [start[0], TOP + 0.03, start[1]]);
  }

  // Corner studs, on every pad: they are what stop a slab reading as a rug.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    stud(parts, SHOP.steel, {
      at: [sx * (half - 0.7), TOP, sz * (half - 0.7)], normal: [0, 1, 0],
      radius: 0.28, rise: 0.09, sink: 0.4, detail: 10,
    });
  }

  const geometry = mergeParts(parts);
  const objects = [mesh(geometry, standard({
    vertexColors: true, roughness: 0.88, metalness: 0.04,
    ...relief('stone', { seed, repeat: 7, strength: 0.5 }),
  }))];

  // The bay number and the robot's name, on a plate at the near kerb. From the middle of the
  // avenue a pad is a grey square with a coloured scribble on it; the plate is what tells a
  // student which of the five boards is talking about the machine in front of them.
  if (name) {
    const texture = canvasTexture(512, 160, (ctx, w, h) => {
      ctx.fillStyle = '#2b2f36';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = `#${new THREE.Color(accent).getHexString()}`;
      ctx.fillRect(0, 0, 132, h);
      ctx.fillStyle = '#12141a';
      ctx.font = 'bold 108px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(number), 66, h / 2 + 4);
      ctx.fillStyle = '#f2f4f7';
      ctx.font = 'bold 74px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(name.toUpperCase(), 168, h / 2 + 4);
    });
    const plate = mesh(new THREE.PlaneGeometry(4.6, 1.44),
      standard({ map: texture, roughness: 0.6, metalness: 0.05 }));
    // OFF THE CENTRE OF THE NEAR EDGE, at the corner. Standing 0.6ft proud in the middle of
    // that edge it occluded a strip of the pad from every approach -- including the near side
    // of the painted path, which is the one thing on the pad a student is meant to be able to
    // compare their program against.
    plate.position.set(-(half - 3.6), TOP + 0.62, half - 0.35);
    plate.rotation.x = -0.42;
    objects.push(plate);
  }
  return group(...objects);
}

// ---------------------------------------------------------------------------
// The workshop
// ---------------------------------------------------------------------------

// A charging dock: a curved back shield, a ramp a robot could actually drive up, two
// contacts and a status lamp.
export function chargeDock({ seed = 11, accent = 0x3d8bf2, height = 5.4 } = {}) {
  const parts = [];
  const glow = [];
  const h = height;

  // The back shield is a partial lathe, which means its two radial faces have to be capped
  // or the shield is a hole seen edge-on. `revolve` closes them itself for any sweep under a
  // full turn -- the reason nothing here reaches for a half cylinder.
  //
  // IT IS SWEPT ABOUT -Z, NOT +Z, so its CONCAVE side faces the ramp and the student. Swept
  // about +Z the shell arcs forward over the ramp and presents its smooth convex back to
  // everyone walking up -- a featureless grey slab with the accent stripe and all three
  // lamps hidden behind it. That is MarsProps' relay dish and the station's antenna dish for
  // the third and fourth time, and it is worth stating as a rule: a partial lathe has a side
  // it is meant to be read from, and `start` decides which.
  put(parts, lathed([
    [2.5, 0], [2.66, 0.5], [2.66, h * 0.72], [2.5, h * 0.9], [2.16, h],
    [1.98, h], [2.3, h * 0.86], [2.3, 0.5], [2.16, 0], [2.5, 0],
  ], { segments: 26, start: Math.PI - 1.15, sweep: 2.30 }), SHOP.steelBright, [0, 0, 0.55]);

  // The base and the ramp.
  // Mid grey, not steelDark. The base and the two ramp treads are all UPWARD-facing plates
  // at the foot of a shield that shadows them, so they take almost no direct sun -- painted
  // at the dark tone they read as one black wedge lying on the grass in front of the dock.
  slab(parts, SHOP.steel, { halfW: 2.9, halfD: 2.5, thick: 0.42, at: [0, 0.42, 0.6], ease: 0.5 });
  put(parts, extrudeOutline([[-2.6, 0], [2.6, 0], [2.6, 0.42], [-2.6, 0.42]], 2.2), SHOP.steelBright,
    [0, 0.21, 2.35], [0, 0, 0]);
  put(parts, extrudeOutline([[-2.6, 0], [2.6, 0], [2.2, 0.42], [-2.2, 0.42]], 1.5), SHOP.steelBright,
    [0, 0.21, 3.9], [0, 0, 0]);

  // Two contact rails and the accent stripe that says which bay this is.
  for (const sx of [-1, 1]) {
    put(parts, extrudeOutline(roundedOutline(0.22, 1.1, 0.14, 2), 0.14), SHOP.brass,
      [sx * 1.1, 0.49, 0.6], [Math.PI / 2, 0, 0]);
  }
  put(parts, extrudeOutline(roundedOutline(1.75, 0.28, 0.14, 2), 0.14), accent,
    [0, h * 0.62, 1.28], [0, 0, 0]);
  stud(glow, 0xf4f8ff, { at: [0, h * 0.82, 1.22], normal: [0, 0.2, 1], radius: 0.36, rise: 0.2, sink: 0.4 });
  for (let i = 0; i < 3; i++) {
    stud(glow, 0xf4f8ff, { at: [-0.8 + i * 0.8, h * 0.42, 1.24], normal: [0, 0, 1], radius: 0.16, rise: 0.1, sink: 0.4 });
  }

  return group(
    mesh(mergeParts(parts), standard({
      vertexColors: true, roughness: 0.44, metalness: 0.4,
      ...relief('metal', { seed, repeat: 5, strength: 0.5 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.2, emissive: 0xbfe4ff, emissiveIntensity: 0.75,
    })),
  );
}

// A crate of spare parts: wheels, gears, bolts and offcuts. The gizmo colours are used at
// full strength here, because a crate of parts is exactly where a robotics room keeps its
// colour.
export function partsCrate({ seed = 21, size = 3.6, open = true } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const half = size / 2;
  const wall = 0.16;
  const h = size * 0.62;

  // Built as four walls and a floor, never as a box with a hole: a crate whose inside is the
  // back faces of a solid is invisible from above, which is the only angle anybody sees it
  // from.
  slab(parts, SHOP.timberDark, { halfW: half, halfD: half, thick: 0.2, at: [0, 0.2, 0], ease: 0.12 });
  for (const [dx, dz, w, d] of [
    [0, -half + wall / 2, half, wall / 2], [0, half - wall / 2, half, wall / 2],
    [-half + wall / 2, 0, wall / 2, half], [half - wall / 2, 0, wall / 2, half],
  ]) {
    put(parts, extrudeOutline(roundedOutline(w, d, 0.05, 1), h), SHOP.timber,
      [dx, 0.2 + h / 2, dz], [-Math.PI / 2, 0, 0]);
  }
  // A lip round the top, mitred by overlap.
  for (const [dx, dz, rot] of [[0, -half, 0], [0, half, 0], [-half, 0, Math.PI / 2], [half, 0, Math.PI / 2]]) {
    put(parts, laid(extrudeOutline(roundedOutline(half + 0.1, 0.16, 0.06, 1), 0.18), rot), SHOP.timberDark,
      [dx, 0.2 + h + 0.09, dz]);
  }

  if (open) {
    // The contents. Everything sits BELOW the lip and overlaps its neighbours, so the crate
    // reads as full rather than as a box with six ornaments balanced in it.
    for (let i = 0; i < 7; i++) {
      const c = GIZMO[Math.floor(rng() * GIZMO.length)];
      const x = randomIn(rng, -half + 0.5, half - 0.5);
      const z = randomIn(rng, -half + 0.5, half - 0.5);
      const kind = i % 3;
      if (kind === 0) {
        const g = gearWheel(randomIn(rng, 0.45, 0.62), 11, 0.16, { hub: 0.16, spokes: 4, spokeWidth: 0.1 });
        g.rotateX(Math.PI / 2);
        put(parts, g, c, [x, 0.2 + h * randomIn(rng, 0.82, 1.06), z], [randomIn(rng, -0.5, 0.5), rng() * 3, 0]);
      } else if (kind === 1) {
        const g = new THREE.TorusGeometry(0.42, 0.16, 8, 18);
        put(parts, g, SHOP.rubber, [x, 0.2 + h * randomIn(rng, 0.8, 1.02), z], [randomIn(rng, -1, 1), rng() * 3, 0.4]);
      } else {
        put(parts, new THREE.CylinderGeometry(0.11, 0.11, randomIn(rng, 0.7, 1.1), 8), SHOP.steelBright,
          [x, 0.2 + h * randomIn(rng, 0.85, 1.08), z], [randomIn(rng, -1.4, 1.4), rng() * 3, randomIn(rng, -1.4, 1.4)]);
      }
    }
  }

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.68, metalness: 0.2,
    ...relief('wood', { seed, repeat: 4, strength: 0.7 }),
  })));
}

// The kinetic ornament: three gears on one mast, and it ships already turning. The first
// thing anybody sees in this world is therefore a program running, which no amount of
// signage says as well -- the lesson the twister and the carousel both taught.
export function gearPylon({ seed = 31, height = 13, gears = 3 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  put(parts, lathed(closed([[1.9, 0], [1.9, 0.42], [1.3, 0.6], [0.4, 0.9], [0.34, height]]), { segments: 22 }),
    SHOP.steel);
  for (let i = 0; i < gears; i++) {
    const t = i / Math.max(1, gears - 1);
    const r = 3.4 - t * 1.5;
    const y = height * (0.38 + t * 0.38);
    // A machined sleeve between each pair. Without them the gears are three discs threaded
    // onto a bare pole at even spacing, which is a cake stand rather than a gear train.
    if (i > 0) {
      const y0 = height * (0.38 + ((i - 1) / Math.max(1, gears - 1)) * 0.38);
      put(parts, lathed(closed([[0.46, 0], [0.46, 0.3], [0.38, 0.5], [0.38, y - y0 - 0.5], [0.46, y - y0 - 0.3], [0.46, y - y0]]), { segments: 16 }),
        SHOP.steelBright, [0, y0, 0]);
    }
    const g = gearWheel(r, 12 + i * 3, 0.42, { hub: 0.52, spokes: 5, spokeWidth: 0.3 });
    g.rotateX(Math.PI / 2);
    // Each gear sits on a boss that straddles the mast, so the wheel does not read as a disc
    // threaded onto a pole with daylight either side of the hub.
    put(parts, g, GIZMO[(i * 3 + 1) % GIZMO.length], [0, y, 0], [0, i * 0.4, 0]);
    put(parts, new THREE.CylinderGeometry(0.6, 0.6, 0.72, 16), SHOP.steelDark, [0, y, 0]);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + i;
      stud(parts, SHOP.brass, {
        at: [Math.cos(a) * (r - 0.9), y + 0.21, Math.sin(a) * (r - 0.9)],
        normal: [0, 1, 0], radius: 0.2, rise: 0.1, sink: 0.4, detail: 10,
      });
    }
  }
  put(parts, ball(0.62, 16), GIZMO[4], [0, height + 0.2, 0]);
  spike(parts, GIZMO[1], { length: 1.4, radius: 0.34, at: [0, height + 1.2, 0], sides: 10 });

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.46, metalness: 0.45,
    ...relief('metal', { seed, repeat: 6, strength: 0.6 }),
  })));
}

// A beacon on a post. The lamp is opaque and emissive rather than translucent, for the
// reason the New York lamps are: a dozen translucent glass meshes is the largest block of
// transparency in a world, for glass nobody can tell from solid.
export function beaconPost({ seed = 41, height = 9, colour = 0xf2a541 } = {}) {
  const parts = [];
  const glow = [];
  put(parts, lathed(closed([[1.05, 0], [1.05, 0.34], [0.62, 0.55], [0.3, 0.9], [0.26, height - 1.2]]), { segments: 18 }),
    SHOP.steelDark);
  put(parts, lathed(closed([[0.8, 0], [0.8, 0.28], [0.55, 0.42]]), { segments: 18 }), SHOP.steel, [0, height - 1.2, 0]);
  put(glow, lathed([[0, 0], [0.72, 0.12], [0.78, 0.6], [0.6, 1.0], [0, 1.16]], { segments: 20 }),
    colour, [0, height - 0.9, 0]);
  put(parts, lathed(closed([[0.86, 0], [0.86, 0.16], [0.5, 0.3], [0, 0.34]]), { segments: 20 }), SHOP.steelDark,
    [0, height + 0.26, 0]);
  for (let i = 0; i < 3; i++) {
    put(parts, extrudeOutline(roundedOutline(0.34, 0.1, 0.06, 1), 0.1), SHOP.paint,
      [0, 1.4 + i * 0.9, 0.3], [0, 0, 0]);
  }
  return group(
    mesh(mergeParts(parts), standard({
      vertexColors: true, roughness: 0.5, metalness: 0.4,
      ...relief('metal', { seed, repeat: 5, strength: 0.5 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.3, emissive: colour, emissiveIntensity: 0.85,
    })),
  );
}

// A marker cone. Small, cheap, and placed by the dozen -- so it is ONE merged mesh of a
// lathe and a base, and its white bands are a tint rather than two more solids.
export function coneMarker({ seed = 51, height = 2.4, colour = 0xe8663f } = {}) {
  const parts = [];
  const h = height;
  put(parts, lathed(closed([
    [0.92, 0], [0.92, 0.12], [0.66, 0.2], [0.5, h * 0.35], [0.3, h * 0.72], [0.16, h], [0, h + 0.06],
  ]), { segments: 22 }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      const band = (p.y > h * 0.44 && p.y < h * 0.62) || (p.y > h * 0.78 && p.y < h * 0.92);
      const c = new THREE.Color(band ? SHOP.paint : colour);
      return [c.r, c.g, c.b];
    },
  });
  slab(parts, SHOP.paintDark, { halfW: 0.95, halfD: 0.95, thick: 0.14, at: [0, 0.14, 0], ease: 0.2 });
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.62, metalness: 0.05,
  })));
}

// The workbench: a top, a frame, a vice and a pegboard of tools. The frame goes through
// `chain`, which puts a socket ball at every interior node -- four legs and two rails is
// eight junctions, and eight junctions hand-built is eight chances to leave one open.
export function toolBench({ seed = 61, length = 8, depth = 3.2, height = 3.4 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const hl = length / 2;
  const hd = depth / 2;

  slab(parts, SHOP.timber, { halfW: hl, halfD: hd, thick: 0.3, at: [0, height, 0], ease: 0.16 });
  slab(parts, SHOP.timberDark, { halfW: hl + 0.1, halfD: hd + 0.1, thick: 0.12, at: [0, height - 0.28, 0], ease: 0.16 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      chain(parts, SHOP.steelDark, [
        { p: [sx * (hl - 0.5), 0.05, sz * (hd - 0.4)], r: 0.13 },
        { p: [sx * (hl - 0.5), height - 0.34, sz * (hd - 0.4)], r: 0.13 },
      ], { sides: 10 });
    }
    chain(parts, SHOP.steelDark, [
      { p: [sx * (hl - 0.5), 0.85, -(hd - 0.4)], r: 0.1 },
      { p: [sx * (hl - 0.5), 0.85, hd - 0.4], r: 0.1 },
    ], { sides: 8 });
  }
  // A lower shelf with a couple of boxes on it.
  slab(parts, SHOP.timberDark, { halfW: hl - 0.6, halfD: hd - 0.5, thick: 0.16, at: [0, 1.0, 0], ease: 0.12 });
  for (let i = 0; i < 3; i++) {
    put(parts, extrudeOutline(roundedOutline(0.55, 0.45, 0.12, 2), 0.6), GIZMO[(i * 2) % GIZMO.length],
      [-hl + 1.4 + i * 1.7, 1.3, 0], [-Math.PI / 2, 0, 0]);
  }
  // The pegboard, and tools hanging on it.
  put(parts, extrudeOutline(roundedOutline(hl - 0.2, 1.5, 0.15, 2), 0.14), SHOP.deckShade,
    [0, height + 1.62, -hd + 0.2], [0, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const x = -hl + 1.1 + i * ((length - 2.2) / 5);
    const c = GIZMO[(i * 3 + 2) % GIZMO.length];
    chain(parts, c, [
      { p: [x, height + 0.95, -hd + 0.3], r: 0.085 },
      { p: [x, height + 2.0, -hd + 0.3], r: 0.085 },
    ], { sides: 8 });
    put(parts, new THREE.TorusGeometry(0.2, 0.075, 6, 14), c, [x, height + 2.1, -hd + 0.3], [0, 0, 0]);
  }
  // The vice: the one thing on a bench with a recognisable silhouette.
  put(parts, extrudeOutline(roundedOutline(0.5, 0.42, 0.12, 2), 0.9), SHOP.steel,
    [hl - 1.3, height + 0.42, 0.2], [-Math.PI / 2, 0, 0]);
  chain(parts, SHOP.steelBright, [
    { p: [hl - 1.3, height + 0.5, 0.2], r: 0.1 },
    { p: [hl - 1.3, height + 0.5, 1.25], r: 0.1 },
  ], { sides: 8 });

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.62, metalness: 0.22,
    ...relief('wood', { seed, repeat: 5, strength: 0.6 }),
  })));
}

// The other kinetic gizmo: a spiral ball run. Three helical rails with balls threaded on
// them, and it ships turning too.
export function ballRun({ seed = 71, height = 11, turns = 2.2, radius = 3.0 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  put(parts, lathed(closed([[2.5, 0], [2.5, 0.4], [1.6, 0.62], [0.44, 0.95], [0.4, height]]), { segments: 22 }),
    SHOP.steelDark);
  for (let s = 0; s < 3; s++) {
    const phase = (s / 3) * Math.PI * 2;
    const pts = [];
    const steps = 26;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = phase + t * turns * Math.PI * 2;
      const r = radius * (1 - t * 0.34);
      pts.push([Math.cos(a) * r, 1.2 + t * (height - 2.0), Math.sin(a) * r]);
    }
    put(parts, tube(pts, [0.17, 0.15, 0.13], { sides: 9, tubular: 70 }), GIZMO[(s * 2 + 3) % GIZMO.length]);
    // Balls ON the rail, seated so the rail passes through each one -- a ball resting on a
    // tube is a ball with a crescent of daylight under it from every angle but one.
    for (let k = 0; k < 4; k++) {
      const t = 0.12 + k * 0.24;
      const a = phase + t * turns * Math.PI * 2;
      const r = radius * (1 - t * 0.34);
      put(parts, ball(0.36, 14), GIZMO[(s + k) % GIZMO.length],
        [Math.cos(a) * r, 1.2 + t * (height - 2.0), Math.sin(a) * r]);
    }
    // The spoke that ties each rail's head back to the mast.
    const a1 = phase + turns * Math.PI * 2;
    chain(parts, SHOP.steel, [
      { p: [0, height - 0.8, 0], r: 0.11 },
      { p: [Math.cos(a1) * radius * 0.66, height - 0.8, Math.sin(a1) * radius * 0.66], r: 0.1 },
    ], { sides: 8 });
  }
  put(parts, ball(0.7, 16), GIZMO[5], [0, height + 0.1, 0]);

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.4, metalness: 0.42,
    ...relief('metal', { seed, repeat: 5, strength: 0.5 }),
  })));
}

// The entrance arch. Its whole job is to say "the field starts here" from the spawn, so it
// is built wide and low rather than tall: an arch a student walks under frames what is
// beyond it, and one they walk past does not.
export function signalArch({ seed = 81, span = 26, height = 12, bands = 6 } = {}) {
  const parts = [];
  const glow = [];
  const halfSpan = span / 2;

  for (const sx of [-1, 1]) {
    put(parts, lathed(closed([[1.5, 0], [1.5, 0.5], [1.0, 0.8], [0.72, height * 0.62]]), { segments: 18 }),
      SHOP.steelDark, [sx * halfSpan, 0, 0]);
  }
  // The bow: one swept tube from foot to foot, so the two legs and the crown are a single
  // member with no joint in it at all.
  const bow = [];
  const steps = 30;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.PI * t;
    bow.push([-Math.cos(a) * halfSpan, height * 0.6 + Math.sin(a) * (height * 0.4), 0]);
  }
  // THE COLOUR BANDS ARE PAINT ON THE BOW, not rings threaded onto it. A ring's axis has to
  // follow the bow's own TANGENT, which turns through 180 degrees from foot to foot -- a
  // second rotation composed on top of the first, which is exactly what a single Euler
  // cannot express (see `laid` above). A per-vertex tint has no orientation to get wrong,
  // and it makes "the paint cannot come adrift from the member" literally true rather than
  // merely careful.
  put(parts, tube(bow, [0.7, 0.58, 0.7], { sides: 12, tubular: 72 }), 0xffffff, null, null, {
    keepColor: true,
    tint: (p) => {
      // Position along the bow read straight off x, which is monotonic from foot to foot and
      // needs no inverse. Six wide colour bands with a thin white ring between them: banded
      // half-and-half against the steel instead, the arch came out grey with smudges on it.
      const k = THREE.MathUtils.clamp((p.x + halfSpan) / (2 * halfSpan), 0, 0.9999) * bands;
      const c = new THREE.Color((k % 1) < 0.13 ? SHOP.paint : GIZMO[Math.floor(k) % GIZMO.length]);
      return [c.r, c.g, c.b];
    },
  });
  for (let i = 0; i < bands; i++) {
    const t = 0.12 + (i / (bands - 1)) * 0.76;
    const a = Math.PI * t;
    const p = [-Math.cos(a) * halfSpan, height * 0.6 + Math.sin(a) * (height * 0.4), 0];
    stud(glow, 0xfff2d0, { at: [p[0], p[1] - 0.68, p[2]], normal: [0, -1, 0], radius: 0.26, rise: 0.17, sink: 0.4 });
  }
  return group(
    mesh(mergeParts(parts), standard({
      vertexColors: true, roughness: 0.42, metalness: 0.45,
      ...relief('metal', { seed, repeat: 6, strength: 0.5 }),
    })),
    mesh(mergeParts(glow), standard({
      vertexColors: true, roughness: 0.25, emissive: 0xffe9b8, emissiveIntensity: 0.8,
    })),
  );
}
