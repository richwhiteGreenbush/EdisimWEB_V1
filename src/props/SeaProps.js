import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  standard,
  mesh,
  group,
  mergeColored,
  mergedMesh,
  canvasTexture,
  taperedTube,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "Under the Sea" -- a tropical coral reef about thirty feet down, modelled from a
// photograph of a reef wall with a shark cruising over it, a moray in a cave mouth, an
// octopus on the rubble and sea stars on the sand.
//
// Sizes are real against the 5ft student, and that is most of the lesson this world
// teaches. A reef looks like a garden in photographs because there is nothing in the
// frame to measure it by; standing in it, an 8ft shark passes overhead at twice your
// height, the moray's head is the size of your own, and the sea stars you have to crouch
// to see are the same animals that fill a postcard.
//
// ---------------------------------------------------------------------------------------
// THE REBUILD: NO THIN SHEETS, NO OPEN ENDS, NOTHING FLAT-SHADED
// ---------------------------------------------------------------------------------------
//
// The first pass of this file was built to a much weaker hardware assumption and it shows
// in three specific ways, all of which the rebuild reverses:
//
//  * EVERYTHING WAS `flatShading: true`. That reads as low-poly art, and -- exactly as on
//    Dinosaur Island -- it was also HIDING the crossings where a dozen separately-swept
//    tubes intersect. Dropping it is what makes higher segment counts worth paying for and
//    what makes the gap discipline below non-optional rather than a matter of care.
//  * EVERY FIN, BLADE AND FROND WAS A FLAT EXTRUSION rendered `DoubleSide`. A shark's
//    dorsal at 0.07ft thick with a square edge is a piece of card, and seen edge-on it
//    vanishes. `solidSurface()` replaces all of them with closed lens-section solids, and
//    `DoubleSide` is gone from every animal in the file -- which also halves what the
//    shading has to do.
//  * EVERY BODY WAS A CONSTANT-ASPECT SWEEP. `taperedTube` gives a circular section, so a
//    laterally-compressed animal could only be faked by scaling the whole sweep -- one
//    ratio for the entire body. But a fish's section changes shape ALONG its length: a
//    shark is round amidships, wider than deep at the head and a narrow blade at the tail
//    stalk. `bodySweep()` interpolates width, depth and centre height independently, which
//    is the single biggest realism change here.
//
// THE GAP RULES, which are the answer to "leave no open spaces", and every one of them is
// structural rather than remembered:
//
//  1. `chain()` emits a tube per span, a socket ball at every interior node and a cap at
//     each open end -- so an unclosed junction cannot be written. Socket size comes from
//     the BEND (1/cos(phi/2)), not from the fattest nearby radius; sized the other way a
//     1.5ft joint gets a 2.4ft ball and every limb reads as a stack of balloons.
//  2. A tube that stops at a real thickness gets a ball; one that tapers to 0 must not
//     have one, or the last segment becomes a cone with a bead on the end.
//  3. `spike()` is rooted: a cone on a curved surface leaves a crescent of daylight along
//     one side of its base disc.
//  4. `dome()` sinks its equator into the parent, because a hemisphere placed exactly on a
//     curved surface meets it along a circle that only closes if both curvatures agree.
//  5. `solidSurface()` closes its own rim, and emits the rim band with BOTH windings --
//     eighty triangles against a whole class of inside-out bug.
//
// Three things about colour that have not changed, because they were right:
//
//  * A merged, vertex-coloured mesh carrying a near-WHITE patterned `map` is the trick
//    behind the octopus's mottling and the moray's reticulation. `map` x `vertexColors`
//    MULTIPLIES -- normally the trap that turned the bear dens black, and here the entire
//    point: the map carries pattern with no colour of its own, the vertex colour carries
//    the hue. See mottleTexture().
//  * `seaSolid()` bakes a full Matrix4 into a geometry we already own, because mergeColored
//    only applies an axis-aligned Euler rotation and a translation per part.
//  * Anything transparent is counted. Water is the one environment where a naive build ends
//    up with dozens of transparent draws (every bubble, every shaft, every fin), and
//    transparency has no early-Z and is sorted per object. Every translucent thing in this
//    file merges into one mesh, and the water surface overhead is deliberately OPAQUE.

// The reef palette, sampled off the reference photograph. These are deliberately more
// saturated than a "realistic" render of them would be: water strips saturation with
// distance, so a coral painted at its true colour arrives on screen as grey mud.
const REEF = {
  sand: 0xd9cfae,
  // The rock tones are all LIGHTER than a photograph of reef limestone suggests, and
  // deliberately. A mound's overhangs and its whole north face are lit by nothing but the
  // ground bounce, so a colour chosen by eye against a lit sample renders as a black slab
  // where it actually matters -- the exact failure the Mars props hit. Pick these against
  // the SHADED face, not the lit one.
  rock: 0x9a8b73, // bare reef limestone
  rockDark: 0x746754,
  rockPink: 0xc09a94, // coralline algae, which crusts everything on a real reef
  rockPurple: 0x9689a2,
  algae: 0x94a066,
  // The coral colours. Named rather than indexed so a layout can ask for a particular
  // look, and so the gardens below can weight them.
  orange: 0xe0752a,
  amber: 0xd9a33a,
  gold: 0xcbb44f,
  cream: 0xd8c8a4,
  pink: 0xe08c9c,
  rose: 0xcf5f78,
  magenta: 0xb44a8e,
  lilac: 0xa48ec4,
  blue: 0x5f92cc,
  skyBlue: 0x7fc0dd,
  teal: 0x49a294,
  green: 0x789a4e,
  red: 0xc4432f,
  white: 0xe6e0d2,
};

// ---------------------------------------------------------------------------
// Segment budgets
// ---------------------------------------------------------------------------
//
// RADIAL is the number worth spending on and TUBULAR is the one to save. Radial sides are
// what close the notch where two tubes meet -- a tube's surface is inset from its nominal
// radius by cos(pi/n) at the flats, 4.9% at 10 sides and 1.5% at 18 -- and they are what
// stops a limb reading as a prism. Tubular segments only subdivide along a length that a
// sweep already makes smooth.
// The counts are also weighted by PLACEMENT COUNT, which is the lesson Dinosaur Island's
// araucaria taught: a garden is built 35 times in this world and a shark twice, so the same
// generosity that is right on the shark is 300,000 triangles of background coral. Anything
// below SEG is deliberately mean about tubular segments -- a coral branch is a straight
// stick and subdividing along it buys nothing at all.
const SEG = { tubularSegments: 16, radialSegments: 16 };
const SEG_LIMB = { tubularSegments: 7, radialSegments: 14 }; // one span of an octopus arm
const SEG_SMALL = { tubularSegments: 4, radialSegments: 8 }; // sponge stalks, soft coral
const SEG_TWIG = { tubularSegments: 3, radialSegments: 7 }; // coral branches, tentacles, fan net
const SEG_TINY = { tubularSegments: 3, radialSegments: 6 }; // grass blades, polyp stalks

// ---------------------------------------------------------------------------
// Shared body-building helpers
// ---------------------------------------------------------------------------

// Pushes one solid into `list` with a full position/rotation/scale/pivot baked into the
// geometry, so a whole school or a whole reef can share a single merge.
//
// mergeColored() applies only an axis-aligned Euler rotation and a translation per part,
// which is not enough for anything in this file: a fish is a swept body squashed
// sideways, an octopus arm's suckers each sit on their own frame, and a sea star's
// tubercles each stand on their own patch of a domed surface. Baking a Matrix4 into a
// geometry we already own costs nothing and buys all of it.
//
// `about` is the point the rotation and scale happen around, and skipping it is the
// classic bug: these bodies are authored in ABSOLUTE animal coordinates, so flattening a
// fish by 0.5 around the default origin does not flatten the fish, it drops it through
// the floor. Solids built at the origin pass `pos` and need no pivot.
function seaSolid(list, geometry, color, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], about = null } = {}, base = null) {
  const local = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])),
    new THREE.Vector3(scale[0], scale[1], scale[2])
  );
  let m;
  if (about) {
    m = new THREE.Matrix4()
      .makeTranslation(pos[0] + about[0], pos[1] + about[1], pos[2] + about[2])
      .multiply(local)
      .multiply(new THREE.Matrix4().makeTranslation(-about[0], -about[1], -about[2]));
  } else {
    m = new THREE.Matrix4().makeTranslation(pos[0], pos[1], pos[2]).multiply(local);
  }
  applyMatrix(geometry, base ? base.clone().multiply(m) : m);
  list.push({ geometry, color });
}

// applyMatrix4 with the winding fixed up when the matrix MIRRORS.
//
// three.js's BufferGeometry.applyMatrix4 transforms positions and normals and leaves the
// index alone, so a negative-determinant matrix -- which is exactly what `scale: [-1,1,1]`
// on a mirrored fin is -- turns the solid inside out. It went unnoticed for the whole life
// of the first pass because every fin here was DoubleSide; with the fins now closed solids
// on FrontSide, a mirrored pectoral would simply not be drawn.
function applyMatrix(geometry, matrix) {
  geometry.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    const index = geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const t = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, t);
      }
      index.needsUpdate = true;
    } else {
      const p = geometry.attributes.position;
      const n = geometry.attributes.normal;
      const uv = geometry.attributes.uv;
      for (let i = 0; i < p.count; i += 3) {
        for (const attribute of [p, n]) {
          if (!attribute) continue;
          const x = attribute.getX(i + 1); const y = attribute.getY(i + 1); const z = attribute.getZ(i + 1);
          attribute.setXYZ(i + 1, attribute.getX(i + 2), attribute.getY(i + 2), attribute.getZ(i + 2));
          attribute.setXYZ(i + 2, x, y, z);
        }
        if (uv) {
          const u = uv.getX(i + 1); const v = uv.getY(i + 1);
          uv.setXY(i + 1, uv.getX(i + 2), uv.getY(i + 2));
          uv.setXY(i + 2, u, v);
        }
      }
      p.needsUpdate = true;
    }
  }
  return geometry;
}

// Catmull-Rom through a list of scalars, so a body can be authored as a handful of
// stations and sampled as densely as the segment budget allows.
//
// Clamped at zero: the spline OVERSHOOTS, and a radius channel running down to 0 at a
// snout tip dips negative just before it, which inverts the last ring of the section.
function splineAt(values, t) {
  const n = values.length - 1;
  const x = THREE.MathUtils.clamp(t, 0, 1) * n;
  const i = Math.min(Math.floor(x), Math.max(0, n - 1));
  const f = x - i;
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[i];
  const p2 = values[Math.min(n, i + 1)];
  const p3 = values[Math.min(n, i + 2)];
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
  );
}

// Averages the normals across a wrapped grid's duplicated SEAM column.
//
// Any surface that wraps once round -- a swept body, a mound shell, a lathe -- has to
// duplicate the vertices at u = 0 as u = 1, because a single vertex cannot carry both ends
// of the texture coordinate. `computeVertexNormals()` then treats the two copies as
// unrelated points and gives each the average of only the faces on ITS side, so the surface
// gets a hard crease exactly where it should be smoothest. On a reef mound that is a seam
// line running from the apex to the sand, and it is visible from across the world.
//
// `ring` is the number of vertices per row (sides + 1); `rows` is how many rows precede any
// cap fans, which must not be touched.
function weldSeam(geometry, ring, rows) {
  const n = geometry.attributes.normal;
  for (let i = 0; i < rows; i++) {
    const a = i * ring;
    const b = a + ring - 1;
    const x = (n.getX(a) + n.getX(b)) / 2;
    const y = (n.getY(a) + n.getY(b)) / 2;
    const z = (n.getZ(a) + n.getZ(b)) / 2;
    const len = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / len, y / len, z / len);
    n.setXYZ(b, x / len, y / len, z / len);
  }
  n.needsUpdate = true;
  return geometry;
}

// A tapered sweep at the file's standard segment counts.
function sweep(points, radii, options) {
  return taperedTube(points, radii, { ...SEG, ...options });
}

// A sphere at whatever coarseness the caller asks for.
//
// The height-segment floor is 4. It was 3, which saved real triangles across a world made
// mostly of SMALL spheres -- an eye, a tentacle tip, a tubercle -- but 3 rings is a
// diamond in profile and the saving is not needed against the current hardware target.
// The WIDTH floor matters more and is the one that bit: at 4 width segments a sphere is
// SQUARE in cross-section, and 130 anemone tentacles tipped with detail-4 balls read as
// pale cubes on sticks.
function ball(radius, detail = 12, rings = null) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), rings ?? Math.max(4, detail >> 1));
}

// A short capped cylinder, for the small tubular details (nostrils, suckers, sponge walls).
function stub(radius, height, segments = 8, taper = 0.85) {
  return new THREE.CylinderGeometry(radius, radius * taper, height, segments);
}

// A CHAIN of tubes with a socket ball at every interior joint and a cap at each open end.
//
// See gap rule 1 at the top of the file. `nodes` is `[{ p: [x,y,z], r }]`; every interior
// node gets a ball sized from the angle the chain turns through there, and each end gets
// one unless the caller says that end tapers to nothing.
function chain(list, color, nodes, { capStart = true, capEnd = true, options, base = null, detail = 14 } = {}) {
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    // Three control points per span rather than two: a two-point Catmull-Rom is a straight
    // line and its radius then interpolates linearly, which loses the swell a real limb has.
    const mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
    seaSolid(list, sweep([a.p, mid, b.p], [a.r, (a.r + b.r) / 2, b.r], options), color, {}, base);
  }
  for (let i = 1; i < nodes.length - 1; i++) {
    const [ax, ay, az] = nodes[i - 1].p;
    const [bx, by, bz] = nodes[i].p;
    const [cx, cy, cz] = nodes[i + 1].p;
    const u = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
    const v = new THREE.Vector3(cx - bx, cy - by, cz - bz).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    // 1.02 when the chain runs straight -- invisible -- and 1.44 at a right angle, which
    // is where a joint has a bulge anyway.
    seaSolid(list, ball((nodes[i].r * 1.02) / Math.max(0.62, Math.cos(phi / 2)), detail), color,
      { pos: nodes[i].p }, base);
  }
  if (capStart && nodes[0].r > 0) seaSolid(list, ball(nodes[0].r * 1.02, detail), color, { pos: nodes[0].p }, base);
  const last = nodes[nodes.length - 1];
  if (capEnd && last.r > 0) seaSolid(list, ball(last.r * 1.02, detail), color, { pos: last.p }, base);
}

// A cone standing on a curved surface: a tooth, a spine, a papilla, a tubercle.
//
// ROOTED BY DEFAULT (gap rule 3). The ball is pushed back down the cone's own axis by a
// third of its length so it straddles the base disc rather than sitting on top of it, and
// the axis has to be derived from the same rotation the cone gets.
function spike(list, color, { length, radius, at, rot = [0, 0, 0], sides = 8, rooted = true, base = null }) {
  seaSolid(list, new THREE.ConeGeometry(radius, length, sides), color, { pos: at, rot }, base);
  if (rooted) {
    const axis = new THREE.Vector3(0, 1, 0)
      .applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
      .multiplyScalar(-length * 0.3);
    seaSolid(list, ball(radius * 0.8, 8), color,
      { pos: [at[0] + axis.x, at[1] + axis.y, at[2] + axis.z] }, base);
  }
}

// A flattened dome SUNK into whatever it sits on: a coralline crust knob, a sea star's
// tubercle, an octopus's papilla, a coral's lobe.
//
// `sink` is a fraction of the dome's own height, and it is the whole point (gap rule 4).
// Placed exactly on a curved surface, a hemisphere's rim only closes if both curvatures
// agree, and they never do.
function dome(list, color, { radius, height, at, rot = [0, 0, 0], detail = 10, sink = 0.45, base = null }) {
  const g = ball(radius, detail);
  g.scale(1, height / radius, 1);
  seaSolid(list, g, color, { pos: [at[0], at[1] - height * sink, at[2]], rot }, base);
}

// ---------------------------------------------------------------------------
// bodySweep -- an animal body whose SECTION SHAPE changes along its length
// ---------------------------------------------------------------------------
//
// This is the structural change that carries most of the realism in this file. Every
// animal here is a laterally compressed body, and its compression is not constant: a reef
// shark is nearly round amidships, distinctly wider than deep across the head, and a thin
// vertical blade at the tail stalk. A sea cucumber is flat on the bottom and domed on top.
// A reef fish is a plate at the shoulder and a rod at the peduncle.
//
// `taperedTube` cannot express any of that -- it sweeps a CIRCLE -- so the first pass faked
// it by scaling the finished sweep, which applies one aspect ratio to the whole animal and
// is why every body here used to be a sausage with fins on it.
//
// Stations are `{ z, w, hUp, hDn, y }`: the axial coordinate, the half-WIDTH, the half-depth
// ABOVE the centre line, the half-depth BELOW it, and the centre line's own height. `h`
// sets hUp and hDn together. Every channel is splined independently, so stations can be
// spaced as unevenly as the shape needs.
//
// `round` bends the section from an ellipse (1) toward a rounded box (2+), which is what a
// moray's head and a ray's disc actually are.
function bodySweep(stations, { sides = 20, samples = 40, round = 1, capStart = true, capEnd = true } = {}) {
  const zs = stations.map((s) => s.z);
  const ws = stations.map((s) => s.w);
  const ups = stations.map((s) => s.hUp ?? s.h ?? s.w);
  const dns = stations.map((s) => s.hDn ?? s.h ?? s.w);
  const ys = stations.map((s) => s.y ?? 0);
  const rounds = stations.map((s) => s.round ?? round);

  const positions = [];
  const uvs = [];
  const indices = [];
  const ring = sides + 1; // duplicated seam vertex, so the u wrap does not smear the map

  const centre = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = splineAt(zs, t);
    const w = Math.max(0, splineAt(ws, t));
    const up = Math.max(0, splineAt(ups, t));
    const dn = Math.max(0, splineAt(dns, t));
    const yc = splineAt(ys, t);
    const e = 1 / Math.max(0.35, splineAt(rounds, t));
    centre.push([0, yc, z]);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ct = Math.cos(a);
      const st = Math.sin(a);
      const ex = Math.sign(ct) * Math.pow(Math.abs(ct), e);
      const ey = Math.sign(st) * Math.pow(Math.abs(st), e);
      positions.push(w * ex, yc + (st >= 0 ? up : dn) * ey, z);
      uvs.push(t, j / sides);
    }
  }
  for (let i = 1; i <= samples; i++) {
    for (let j = 1; j <= sides; j++) {
      const a = ring * (i - 1) + (j - 1);
      const b = ring * i + (j - 1);
      const c = ring * i + j;
      const d = ring * (i - 1) + j;
      indices.push(a, d, b, b, d, c);
    }
  }

  // End caps as a fan to the centre point. A section that has already closed to a point
  // (w = h = 0) needs none, and giving it one leaves a fan of degenerate triangles.
  const cap = (index, outward) => {
    const [, cy, cz] = centre[index];
    const base = positions.length / 3;
    positions.push(0, cy, cz);
    uvs.push(index === 0 ? 0 : 1, 0.5);
    for (let j = 0; j < sides; j++) {
      const a = ring * index + j;
      const b = ring * index + j + 1;
      if (outward) indices.push(base, b, a);
      else indices.push(base, a, b);
    }
  };
  const closed = (i) => {
    const w = Math.max(0, splineAt(ws, i / samples));
    const up = Math.max(0, splineAt(ups, i / samples));
    return w < 1e-4 && up < 1e-4;
  };
  if (capStart && !closed(0)) cap(0, false);
  if (capEnd && !closed(samples)) cap(samples, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  weldSeam(geometry, ring, samples + 1);
  return geometry;
}

// ---------------------------------------------------------------------------
// solidSurface -- a CLOSED slab from a parametric mid-surface
// ---------------------------------------------------------------------------
//
// Every fin, web, frill and shell in this file is one of these. A fin is not a flat plate:
// it has a rounded leading edge, a thick root, a thin trailing edge and a tip that closes.
// Building it as a slab whose half-thickness is a function of position gives all of that,
// gives a real silhouette from every angle, and -- because the rim is closed -- lets the
// whole animal render FrontSide.
//
//  * `point(u, v)` is the mid-surface.
//  * `thick(u, v)` is the half-thickness, offset along `axis` if one is given and along
//    the surface normal otherwise. A fixed axis is right for anything nearly planar (every
//    fin) and is both cheaper and more predictable than a normal; a normal is right for a
//    curved shell.
//  * The rim band is emitted with BOTH windings. It is a few dozen triangles, one of the
//    two copies is backface-culled from any given side, and it removes the entire question
//    of which way round a mirrored or inverted patch came out.
function solidSurface({ nu = 10, nv = 6, point, thick, axis = null, closedU = false }) {
  const cols = closedU ? nu : nu + 1;
  const rows = nv + 1;
  const mid = [];
  const half = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const p = point(i / nu, j / nv);
      mid.push(new THREE.Vector3(p[0], p[1], p[2]));
      half.push(thick(i / nu, j / nv));
    }
  }
  const at = (i, j) => mid[((i + cols) % cols) * rows + THREE.MathUtils.clamp(j, 0, rows - 1)];

  const fixed = axis ? new THREE.Vector3(axis[0], axis[1], axis[2]).normalize() : null;
  const dirs = [];
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (fixed) { dirs.push(fixed.clone()); continue; }
      const iPrev = closedU ? i - 1 : Math.max(0, i - 1);
      const iNext = closedU ? i + 1 : Math.min(cols - 1, i + 1);
      du.copy(at(iNext, j)).sub(at(iPrev, j));
      dv.copy(at(i, j + 1)).sub(at(i, j - 1));
      const n = new THREE.Vector3().crossVectors(du, dv);
      dirs.push(n.lengthSq() > 1e-12 ? n.normalize() : new THREE.Vector3(0, 1, 0));
    }
  }

  // Which way round the top grid winds depends on the handedness of (du x dv) against the
  // offset direction, and that flips whenever a patch is authored mirrored -- which the
  // paired fins all are. Testing it once in the middle of the domain and flipping the whole
  // patch is what stops a mirrored pectoral rendering as a hole.
  let flip = false;
  {
    const i = Math.floor(cols / 2);
    const j = Math.floor(rows / 2);
    du.copy(at(i + 1, j)).sub(at(i - 1 < 0 ? 0 : i - 1, j));
    dv.copy(at(i, j + 1)).sub(at(i, j - 1));
    const n = new THREE.Vector3().crossVectors(du, dv);
    flip = n.dot(dirs[i * rows + j]) < 0;
  }

  const positions = [];
  const uvs = [];
  const indices = [];
  const top = (i, j) => ((i + cols) % cols) * rows + j;
  const bottom = (i, j) => cols * rows + top(i, j);
  for (const sign of [1, -1]) {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const k = i * rows + j;
        const p = mid[k];
        const d = dirs[k];
        const h = half[k] * sign;
        positions.push(p.x + d.x * h, p.y + d.y * h, p.z + d.z * h);
        uvs.push(i / nu, j / nv);
      }
    }
  }
  const iMax = closedU ? cols : cols - 1;
  for (let i = 0; i < iMax; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = top(i, j); const b = top(i + 1, j); const c = top(i + 1, j + 1); const d = top(i, j + 1);
      if (flip) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
      const e = bottom(i, j); const f = bottom(i + 1, j); const g = bottom(i + 1, j + 1); const h = bottom(i, j + 1);
      if (flip) indices.push(e, f, g, e, g, h);
      else indices.push(e, g, f, e, h, g);
    }
  }
  // The rim: every boundary edge where the slab still has thickness, both windings.
  //
  // Skipping the edges where the thickness has already vanished is not tidiness -- it is
  // most of the cost. A fin's thickness goes to zero at the leading edge, the trailing edge
  // and the tip, so three of its four boundary loops need no rim at all, and on a 5x3 patch
  // the degenerate rim was costing more triangles than the surface.
  const thin = (i, j) => half[((i + cols) % cols) * rows + j] < 1e-4;
  const band = (a, b, c, d) => indices.push(a, b, c, a, c, d, a, c, b, a, d, c);
  for (let i = 0; i < iMax; i++) {
    if (!(thin(i, 0) && thin(i + 1, 0))) band(top(i, 0), top(i + 1, 0), bottom(i + 1, 0), bottom(i, 0));
    if (!(thin(i, rows - 1) && thin(i + 1, rows - 1))) {
      band(top(i, rows - 1), top(i + 1, rows - 1), bottom(i + 1, rows - 1), bottom(i, rows - 1));
    }
  }
  if (!closedU) {
    for (let j = 0; j < rows - 1; j++) {
      if (!(thin(0, j) && thin(0, j + 1))) band(top(0, j), top(0, j + 1), bottom(0, j + 1), bottom(0, j));
      if (!(thin(cols - 1, j) && thin(cols - 1, j + 1))) {
        band(top(cols - 1, j), top(cols - 1, j + 1), bottom(cols - 1, j + 1), bottom(cols - 1, j));
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// A fin, as a lofted foil between a handful of ribs.
//
// Each rib is `{ le, te, t }` -- the leading-edge point, the trailing-edge point and the
// maximum half-thickness there -- and the ribs run from the ROOT (buried in the body) to
// the TIP. The leading and trailing edges are each splined through their own points, so
// three or four ribs describe a falcate shark fin exactly.
//
// The chordwise thickness is the NACA four-digit distribution, which is what gives a fin
// its rounded leading edge and its knife trailing edge. A symmetric lens would read as a
// leaf; this reads as something that swims.
function finFoil(ribs, { nu = 10, nv = 6, axis = [1, 0, 0] } = {}) {
  const lead = new THREE.CatmullRomCurve3(ribs.map((r) => new THREE.Vector3(...r.le)));
  const trail = new THREE.CatmullRomCurve3(ribs.map((r) => new THREE.Vector3(...r.te)));
  const ts = ribs.map((r) => r.t);
  const naca = (u) => {
    const x = THREE.MathUtils.clamp(u, 0, 1);
    return (
      5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1015 * x * x * x * x)
    );
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  return solidSurface({
    nu,
    nv,
    axis,
    point: (u, v) => {
      lead.getPoint(v, a);
      trail.getPoint(v, b);
      return [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u];
    },
    thick: (u, v) => naca(u) * Math.max(0, splineAt(ts, v)),
  });
}

// Resizes a finished body by scaling its MERGED geometry, rather than threading a scale
// factor through every coordinate in the builder.
//
// Object3D.scale is not available: WorldStore.applyTransform() REPLACES an object's scale
// from its record, so a builder that scaled its own Group would have that silently
// discarded on the next reload -- the same trap the startup assets' `targetHeight` field
// exists to work around. And threading `s` through the coordinates by hand is how you end
// up multiplying by it twice, which is exactly what happened to the shark's fins the first
// time round: the sweep helper scaled its points AND the placement scaled the result.
function sized(meshes, s) {
  if (s !== 1) for (const m of meshes) m.geometry.scale(s, s, s);
  return meshes;
}

// mergeColored(), plus two things it deliberately does not do: it can carry a PER-PART tint
// function, and it can leave a part's existing vertex colours alone.
//
// PropKit's mergeColored OVERWRITES the colour attribute with one flat colour per part, which
// is right for almost everything in this project and wrong twice here. It cost the sea fan
// its entire colour -- the net is built by its own merge, and handing that finished
// vertex-coloured geometry back as a single "part" repainted all twelve thousand of its
// vertices white -- and it is what stops a tube sponge's cavity being darker than its
// outside, since inner and outer wall are two faces of ONE closed solid and no flat colour
// can tell them apart.
//
// `keepColor` says "this geometry already carries colours". `tint` is applied to that part's
// own vertices only, in that part's own placed coordinates.
function mergeParts(parts) {
  const geometries = [];
  const mixed = parts.some((p) => p.geometry.index) && parts.some((p) => !p.geometry.index);
  const c = new THREE.Color();
  for (const part of parts) {
    let g = part.geometry.clone();
    if (mixed && g.index) g = g.toNonIndexed();
    g.clearGroups();
    const count = g.attributes.position.count;
    let colors = g.attributes.color;
    if (!part.keepColor || !colors) {
      colors = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
      c.set(part.color ?? 0xffffff);
      for (let i = 0; i < count; i++) colors.setXYZ(i, c.r, c.g, c.b);
      g.setAttribute('color', colors);
    }
    if (part.tint) {
      const pos = g.attributes.position;
      for (let i = 0; i < count; i++) {
        c.fromBufferAttribute(colors, i);
        part.tint(c, pos.getX(i), pos.getY(i), pos.getZ(i));
        colors.setXYZ(i, c.r, c.g, c.b);
      }
      colors.needsUpdate = true;
    }
    // The transform is applied AFTER the tint, so a tint function works in the coordinates
    // its builder authored the part in. Tinting a leaning tube in world space instead means
    // "distance from the axis" is measured from an axis that is no longer where it was.
    if (part.rotation) {
      const [rx, ry, rz] = part.rotation;
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      if (rz) g.rotateZ(rz);
    }
    if (part.position) g.translate(part.position[0], part.position[1], part.position[2]);
    geometries.push(g);
  }
  const merged = mergeGeometries(geometries, false);
  for (const g of geometries) g.dispose();
  return merged;
}

// Per-vertex colour as a function of POSITION, applied after the merge.
//
// mergeColored gives every part one flat colour, so tone could otherwise only change where
// one solid stops and the next begins -- which is why the shark's countershading used to be
// a separate pale tube and read as a panel bolted on. A colour map is the obvious fix and
// the wrong one: `map` x `vertexColors` multiplies, and every part here has its own UV
// scale (a 4ft flank and a 1in tooth both run u from 0 to 1), so no single repeat is right
// for both. Shading the merged colour attribute by position sidesteps all of it.
function tintGeometry(geometry, fn) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const color = geometry.attributes.color;
  if (!color) return geometry;
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    c.fromBufferAttribute(color, i);
    fn(c, position.getX(i), position.getY(i), position.getZ(i), normal ? normal.getY(i) : 0);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  color.needsUpdate = true;
  return geometry;
}

// Countershading, as one function of height.
//
// The CURVE matters more than the range, and on a shark far more than on a dinosaur: the
// line between grey and white on a real shark is startlingly crisp, and a linear or even a
// plain smoothstep fade pales the whole flank and loses the animal's form. `edge` is where
// the turnover sits as a fraction of the body's depth and `width` is how sharp it is.
function counterShade({ low, high, belly, edge = 0.38, width = 0.09, crown = 0, dapple = 0, seed = 1 }) {
  const bellyColor = new THREE.Color(belly);
  return (c, x, y) => {
    const t = THREE.MathUtils.clamp((y - low) / (high - low), 0, 1);
    const w = THREE.MathUtils.clamp((t - edge + width) / (2 * width), 0, 1);
    c.lerp(bellyColor, 1 - w * w * (3 - 2 * w));
    // The sun-exposed top darkens again on every large animal, and it is what stops the
    // back reading as the same tone as the shoulder.
    if (crown && t > 0.72) c.multiplyScalar(1 - (t - 0.72) * crown);
    if (dapple) {
      const n =
        Math.sin(x * 0.9 + seed) * Math.cos(y * 1.1 - seed * 0.7) +
        Math.cos((x + y) * 1.7 + seed * 1.3) * 0.6;
      c.multiplyScalar(1 + (n / 1.6) * dapple);
    }
  };
}

// One merged, vertex-coloured, SMOOTH-shaded animal, optionally with a second batch that
// the tint never touches -- teeth, eyes and claws, because a countershading gradient
// applied to a tooth is a grubby tooth.
function seaMesh(parts, { tint = null, material = {} } = {}) {
  const geometry = mergeColored(parts);
  if (tint) tintGeometry(geometry, tint);
  return mesh(geometry, standard({ vertexColors: true, roughness: 0.7, ...material }));
}

// relief() with the tile stretched to match the surface it lands on.
//
// A swept body's UVs run 0..1 along its whole length and 0..1 once around its girth, so a
// SQUARE repeat lands a 3:1 stretched cell on an animal three times as long as it is round
// -- and a mosaic pattern stretched 3:1 stops reading as skin and starts reading as
// lengthwise streaks down the flank. There is no single right answer in a merged mesh (the
// documented trap: a 4ft flank and a 1in tooth both run u from 0 to 1), so this sets the
// repeat for whichever part dominates what a student is looking at.
function stretchedRelief(kind, { seed, along, around, strength }) {
  const params = relief(kind, { seed, repeat: along, strength });
  params.bumpMap.repeat.set(along, around);
  return params;
}

// A tileable near-white blotch field, multiplied over a part's vertex colour to give it
// patterned skin.
//
// NEAR-WHITE is the whole contract. `map` x `vertexColors` multiplies, so anything the
// texture darkens is skin the vertex colour then tints; anything it leaves at 1.0 comes
// through as the vertex colour exactly. One texture therefore dresses the tan octopus,
// the yellow moray and the speckled sea cucumber, each keeping its own hue.
//
// Every blotch is drawn nine times, once per wrap offset, because a map that does not
// tile shows its seam as a hard line straight down an animal's flank.
function mottleTexture(seed, { spots = 70, min = 0.022, max = 0.075, floor = 0.42, size = 256, repeat = [3, 2] } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < spots; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = randomIn(rng, min, max) * w;
      const squash = randomIn(rng, 0.6, 1.5);
      const dark = randomIn(rng, floor, Math.min(1, floor + 0.4));
      const value = Math.round(dark * 255);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cx = x + dx * w;
          const cy = y + dy * h;
          if (cx < -r * 2 || cx > w + r * 2 || cy < -r * 2 || cy > h + r * 2) continue;
          // Soft-edged, for the same reason the Mars dust devil's streaks had to be:
          // a hard-edged blotch wrapped onto a curved body reads as a sticker on it.
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * squash);
          grad.addColorStop(0, `rgb(${value},${value},${value})`);
          grad.addColorStop(0.6, `rgba(${value},${value},${value},0.55)`);
          grad.addColorStop(1, `rgba(${value},${value},${value},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r * squash, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  return texture;
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 1 -- the reef shark
// ---------------------------------------------------------------------------

// A Caribbean reef shark, 8.5ft nose to caudal tip, cruising.
//
// What makes a shark read as a shark, in the order each one buys the most:
//
//  * THE FIRST DORSAL, and it has to be big, FALCATE, and a real foil rather than a plate.
//    It is the one part of this animal everybody on earth can draw. Its trailing edge is
//    concave and its rear corner is a free flap that overhangs the base.
//  * COUNTERSHADING -- grey over a hard-edged white belly, now a per-vertex gradient with a
//    crisp turnover rather than a separate pale tube slung under the body.
//  * A HETEROCERCAL TAIL: the upper lobe much longer than the lower and swept up. A
//    symmetrical tail is a tuna's, and it is the fastest way to make this look like a toy.
//  * A SECTION THAT CHANGES SHAPE. Round amidships, WIDER THAN DEEP across the head (a
//    shark's head is flattened top to bottom, which is why it looks broad from above and
//    thin from the front), and a narrow vertical blade at the tail stalk with keels.
//  * PECTORALS HELD OUT AND DOWN like wings, not folded back. A shark cannot stop
//    swimming and these are what it flies on.
//  * THE UNDERSIDE, because that is the view this world actually gives: the layout hangs
//    this animal fifteen feet overhead. So the mouth is a real crescent with two rows of
//    serrated teeth in a pale gum, the five gill slits read from below, and the snout
//    carries the pores of the ampullae of Lorenzini.
//
// The origin is about half a foot under the belly, so a layout's `y` reads as clear water
// beneath the animal.
export function reefShark({ length = 8.5, seed = 5, back = 0x76786f, belly = 0xf8f5ea } = {}) {
  const s = length / 8.5;
  const hide = new THREE.Color(back);
  const finTone = hide.clone().offsetHSL(0, 0.01, -0.035).getHex();
  const dusk = hide.clone().offsetHSL(0, 0.02, -0.13).getHex();
  const gum = new THREE.Color(belly).offsetHSL(-0.02, 0.12, -0.10).getHex();
  const parts = [];
  const detail = [];
  const AXIS = 1.3; // the body's centre line

  // --- body -----------------------------------------------------------------------------
  // One closed surface from the caudal peduncle to the snout, with the width, the depth
  // above the axis and the depth below it all splined separately.
  parts.push({
    geometry: bodySweep(
      [
        { z: -3.32, w: 0.055, hUp: 0.105, hDn: 0.085, y: AXIS + 0.02 },
        { z: -2.95, w: 0.078, hUp: 0.155, hDn: 0.120, y: AXIS + 0.01 },
        { z: -2.40, w: 0.135, hUp: 0.245, hDn: 0.190, y: AXIS },
        { z: -1.55, w: 0.250, hUp: 0.365, hDn: 0.305, y: AXIS - 0.01 },
        { z: -0.55, w: 0.375, hUp: 0.475, hDn: 0.425, y: AXIS - 0.02 },
        { z: 0.45, w: 0.455, hUp: 0.535, hDn: 0.495, y: AXIS - 0.03 },
        { z: 1.35, w: 0.485, hUp: 0.545, hDn: 0.505, y: AXIS - 0.02 },
        { z: 2.15, w: 0.470, hUp: 0.500, hDn: 0.480, y: AXIS },
        { z: 2.80, w: 0.435, hUp: 0.420, hDn: 0.415, y: AXIS + 0.01 },
        { z: 3.35, w: 0.375, hUp: 0.330, hDn: 0.340, y: AXIS + 0.01 },
        { z: 3.80, w: 0.290, hUp: 0.245, hDn: 0.265, y: AXIS },
        { z: 4.10, w: 0.185, hUp: 0.165, hDn: 0.185, y: AXIS - 0.02 },
        { z: 4.25, w: 0.070, hUp: 0.070, hDn: 0.080, y: AXIS - 0.04 },
      ],
      { sides: 32, samples: 68, round: 1.06 }
    ),
    color: back,
  });

  // The caudal keels -- a low ridge either side of the tail stalk. Small, and the reason
  // the peduncle reads as a driving surface rather than as a thin bit of tail.
  for (const side of [-1, 1]) {
    seaSolid(parts, ball(0.06, 10), back,
      { pos: [side * 0.062, AXIS + 0.02, -2.70], scale: [0.55, 0.40, 6.0] });
  }
  // The precaudal pit: a shallow dark crease on top of the stalk, right where a real one is.
  seaSolid(parts, ball(0.06, 8), dusk, { pos: [0, AXIS + 0.115, -2.95], scale: [1.4, 0.4, 2.8] });

  // --- fins ------------------------------------------------------------------------------
  // Ribs run root to tip; `le` is the leading edge, `te` the trailing. Each fin's root is
  // authored INSIDE the body surface so the foil's own rim is buried.
  const fin = (ribs, options) => parts.push({ geometry: finFoil(ribs, options), color: finTone });

  // First dorsal. The apex leans forward of the free rear tip and the rear margin is
  // slightly concave -- a straight-edged triangle is a dinghy's sail.
  fin([
    { le: [0, AXIS + 0.36, 0.98], te: [0, AXIS + 0.30, -0.62], t: 0.085 },
    { le: [0, AXIS + 0.78, 0.74], te: [0, AXIS + 0.62, -0.36], t: 0.070 },
    { le: [0, AXIS + 1.15, 0.50], te: [0, AXIS + 0.94, -0.14], t: 0.048 },
    { le: [0, AXIS + 1.42, 0.28], te: [0, AXIS + 1.26, 0.03], t: 0.026 },
    { le: [0, AXIS + 1.54, 0.16], te: [0, AXIS + 1.50, 0.11], t: 0.007 },
  ], { nu: 12, nv: 8 });

  // Second dorsal and anal fin: small, low, and set well back opposite one another.
  fin([
    { le: [0, AXIS + 0.20, -2.06], te: [0, AXIS + 0.18, -2.62], t: 0.05 },
    { le: [0, AXIS + 0.42, -2.20], te: [0, AXIS + 0.34, -2.60], t: 0.036 },
    { le: [0, AXIS + 0.55, -2.34], te: [0, AXIS + 0.50, -2.52], t: 0.006 },
  ], { nu: 7, nv: 4 });
  fin([
    { le: [0, AXIS - 0.22, -2.16], te: [0, AXIS - 0.20, -2.68], t: 0.048 },
    { le: [0, AXIS - 0.44, -2.30], te: [0, AXIS - 0.36, -2.64], t: 0.034 },
    { le: [0, AXIS - 0.55, -2.42], te: [0, AXIS - 0.50, -2.56], t: 0.006 },
  ], { nu: 7, nv: 4 });

  for (const side of [-1, 1]) {
    // Pectorals, held out and DOWN. A reef shark's are large and falcate, and the tip
    // sweeps back nearly to the level of the first dorsal's base.
    fin([
      { le: [side * 0.28, AXIS - 0.30, 1.72], te: [side * 0.24, AXIS - 0.36, 0.86], t: 0.075 },
      { le: [side * 0.70, AXIS - 0.44, 1.52], te: [side * 0.62, AXIS - 0.52, 0.74], t: 0.058 },
      { le: [side * 1.12, AXIS - 0.60, 1.16], te: [side * 1.00, AXIS - 0.68, 0.52], t: 0.038 },
      { le: [side * 1.46, AXIS - 0.74, 0.72], te: [side * 1.36, AXIS - 0.80, 0.30], t: 0.020 },
      { le: [side * 1.62, AXIS - 0.82, 0.44], te: [side * 1.56, AXIS - 0.84, 0.28], t: 0.006 },
    ], { nu: 12, nv: 8, axis: [0, 1, 0] });
    // Pelvics: small, flatter to the body, and further back.
    fin([
      { le: [side * 0.18, AXIS - 0.36, -1.12], te: [side * 0.16, AXIS - 0.38, -1.72], t: 0.05 },
      { le: [side * 0.46, AXIS - 0.48, -1.24], te: [side * 0.42, AXIS - 0.52, -1.70], t: 0.036 },
      { le: [side * 0.66, AXIS - 0.58, -1.42], te: [side * 0.62, AXIS - 0.60, -1.64], t: 0.006 },
    ], { nu: 7, nv: 4, axis: [0, 1, 0] });
  }

  // The caudal fin, as two lobes. Built separately the notch between them is exact and each
  // lobe carries its own foil; built as one outline the notch has to be guessed and comes
  // out either welded shut or as a slot.
  //
  // THE SWEEP ANGLE IS THE WHOLE TAIL. The first pass ran the upper lobe up at 48 degrees
  // and it read as a stubby dark flag stuck on the end of a torpedo; a shark's upper lobe
  // lies at about thirty, which is why the animal looks like it is being driven forward
  // rather than braking. The tip therefore has to reach nearly as far back as the snout
  // reaches forward -- the caudal fin is a quarter of a shark's total length.
  //
  // The trailing edge JOGS FORWARD at v = 0.86 and back again at the tip. That is the
  // subterminal notch, and it is the one feature that says shark rather than fish: without
  // it the upper lobe is a smooth blade and with it there is a small terminal lobe hanging
  // off the end of a long one.
  fin([
    { le: [0, AXIS + 0.10, -2.78], te: [0, AXIS - 0.16, -3.52], t: 0.085 },
    { le: [0, AXIS + 0.34, -3.30], te: [0, AXIS + 0.02, -3.98], t: 0.062 },
    { le: [0, AXIS + 0.62, -3.78], te: [0, AXIS + 0.30, -4.34], t: 0.042 },
    { le: [0, AXIS + 0.84, -4.16], te: [0, AXIS + 0.62, -4.56], t: 0.024 },
    { le: [0, AXIS + 0.94, -4.36], te: [0, AXIS + 0.82, -4.50], t: 0.012 },
    { le: [0, AXIS + 1.02, -4.48], te: [0, AXIS + 0.97, -4.62], t: 0.004 },
  ], { nu: 11, nv: 9 });
  fin([
    { le: [0, AXIS - 0.12, -2.78], te: [0, AXIS - 0.10, -3.50], t: 0.080 },
    { le: [0, AXIS - 0.42, -3.10], te: [0, AXIS - 0.26, -3.66], t: 0.052 },
    { le: [0, AXIS - 0.62, -3.36], te: [0, AXIS - 0.46, -3.76], t: 0.028 },
    { le: [0, AXIS - 0.72, -3.56], te: [0, AXIS - 0.64, -3.78], t: 0.006 },
  ], { nu: 9, nv: 6 });

  // --- head ------------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    // (The five gill slits are PAINTED by the tint below rather than placed as solids. A
    // thin dark lens has to sit exactly on a doubly-curved flank to read as a slit, and
    // "exactly" is a number that changes with every station of the body sweep -- the first
    // pass put all five a few hundredths inside the surface, where they were invisible from
    // every angle. A stripe expressed as a function of position is on the surface by
    // construction, wherever the surface happens to be.)
    // The eye: a real ball set into the head, with a pale nictitating rim under it. A
    // shark's eye is small and set high and forward, and the rim is what stops it reading
    // as a bead pushed into clay.
    seaSolid(detail, ball(0.085, 12), 0xd8d4c6, { pos: [side * 0.335, AXIS + 0.20, 3.24] });
    seaSolid(detail, ball(0.072, 12), 0x0e0c0a, { pos: [side * 0.365, AXIS + 0.20, 3.26], scale: [0.7, 1, 1] });
    dome(parts, hide.clone().offsetHSL(0, 0, 0.06).getHex(),
      { radius: 0.115, height: 0.05, at: [side * 0.345, AXIS + 0.10, 3.24], rot: [0, 0, side * 1.3], detail: 10, sink: 0.2 });
    // The nostril: a curved dark groove under the snout, not a hole. On a shark it is a
    // long slot with a flap across the middle of it.
    seaSolid(parts, ball(0.075, 8), 0x3b3833, {
      pos: [side * 0.155, AXIS - 0.235, 3.90], rot: [0, side * 0.5, 0], scale: [1.5, 0.36, 0.55],
    });
    // Spiracle-free, but the labial furrow at the corner of the mouth is worth two solids:
    // it is what makes the jaw line read as a jaw rather than as a painted crescent.
    seaSolid(parts, ball(0.055, 8), 0x4c4842, {
      pos: [side * 0.30, AXIS - 0.30, 3.06], rot: [0, side * 0.4, 0], scale: [0.35, 1.1, 0.5],
    });
  }

  // Ampullae of Lorenzini: the field of electroreceptor pores over the snout. Thirty tiny
  // sunk dots, and they are the detail that turns the front of the head from a smooth cone
  // into something that belongs on a shark.
  {
    const rng = seededRandom(seed + 11);
    for (let i = 0; i < 34; i++) {
      const t = randomIn(rng, 0, 1);
      const a = randomIn(rng, -1.15, 1.15);
      const z = 3.55 + t * 0.62;
      const r = 0.30 - t * 0.24;
      dome(parts, 0x4a4740, {
        radius: 0.034, height: 0.014,
        at: [Math.sin(a) * r, AXIS - 0.10 - Math.cos(a) * r * 0.75, z],
        rot: [0, 0, -a], detail: 6, sink: 0.1,
      });
    }
  }

  // --- the mouth, on the UNDERSIDE, which is the view this world gives -------------------
  // A shark's mouth is a transverse crescent well back under the snout. Drawn on the front
  // of the head it becomes a cartoon.
  // A CRESCENT, and it has to stand PROUD of the belly rather than being sunk into it.
  //
  // There is no CSG here, so a "recess" is a dark solid placed where the recess would be --
  // and the first pass put the cavity's centre on the body's own axis line, which buried
  // nine tenths of it inside the head. The mouth was invisible from directly underneath,
  // which is the one angle this world guarantees a student will see it from.
  //
  // It is also drawn as an ARC of overlapping solids rather than as one ellipse. A shark's
  // mouth is a broad bow that sweeps back at the corners; an ellipse under the snout is a
  // sucker.
  const JAW_Z = 3.24;
  const JAW_W = 0.40;
  const JAW_Y = AXIS - 0.335;
  const arc = (t) => {
    const a = t * 1.30;
    return [Math.sin(a) * JAW_W, Math.cos(a) * 0.30];
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 6; i++) {
      const [ax, az] = arc((i / 6) * side);
      // The dark of the mouth, then the two gums standing in it.
      seaSolid(parts, ball(0.115, 10), 0x241f1c, {
        pos: [ax, JAW_Y - 0.045, JAW_Z + az], scale: [1.05, 0.55, 0.95],
      });
      for (const jaw of [1, -1]) {
        seaSolid(parts, ball(0.075, 9), gum, {
          pos: [ax, JAW_Y - 0.03 + jaw * 0.055, JAW_Z + az + jaw * 0.012], scale: [1.15, 0.6, 0.75],
        });
      }
    }
  }
  // Two rows of teeth. A reef shark's are broad triangles with serrated edges, and ten a
  // side in each jaw is about what shows. Each is rooted, then sunk into its gum -- a tooth
  // balanced ON a gum leaves a crescent of daylight at its base.
  for (const jaw of [1, -1]) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 10; i++) {
        const t = (i / 9) * 0.97;
        const [ax, az] = arc(t * side);
        const h = 0.095 - t * 0.035;
        spike(detail, 0xf4efe0, {
          length: h, radius: h * 0.45, sides: 5,
          at: [ax, JAW_Y - 0.03 + jaw * 0.075, JAW_Z + az],
          rot: [jaw > 0 ? Math.PI - 0.20 : 0.20, side * t * 0.5, side * -t * 0.72],
        });
      }
    }
  }

  return group(...sized([
    seaMesh(parts, {
      // Countershading, plus the dusky fin tips a Caribbean reef shark actually has --
      // expressed as a function of how far a vertex is from the body's own mass, which
      // catches the pectoral tips and the lower caudal lobe together and needs no per-part
      // bookkeeping to do it.
      // COUNTERSHADING CANNOT BE A FUNCTION OF HEIGHT ALONE, and the pectorals are why.
      //
      // A fin is a plate a couple of inches thick held a long way below the body's centre
      // line, so every vertex on it -- top face and bottom face alike -- sits at a height
      // the belly rule calls white. The first pass therefore rendered both pectorals as
      // solid white paddles, which is the one thing on this animal nobody could miss.
      //
      // What countershading actually is, is which way a surface FACES: lit from above, so
      // dark on top and pale underneath. So anything held outboard of the body takes its
      // tone from its own normal instead of from its height, blended in over the fin root so
      // there is no line where the rule changes.
      tint: (() => {
        const shade = counterShade({
          low: AXIS - 0.55, high: AXIS + 0.55, belly, edge: 0.36, width: 0.07, crown: 0.28,
          dapple: 0.03, seed,
        });
        const duskColor = new THREE.Color(dusk);
        return (c, x, y, z, ny) => {
          const outboard = THREE.MathUtils.clamp((Math.abs(x) - 0.42) / 0.28, 0, 1);
          const faceY = AXIS + THREE.MathUtils.clamp(ny * 3, -1, 1) * 0.44;
          shade(c, x, THREE.MathUtils.lerp(y, faceY, outboard), z);
          // The dusky fin tips a Caribbean reef shark carries, as a function of how far a
          // vertex is from the body's own mass -- which catches the pectoral tips and the
          // lower caudal lobe together without any per-part bookkeeping.
          const out = Math.max((Math.abs(x) - 1.12) / 0.72, (-z - 4.05) / 0.75, 0);
          if (out > 0) c.lerp(duskColor, Math.min(0.42, out * 0.42));
          // The five gill slits, raked forward and down. `z + (y - AXIS) * 0.42` is the
          // coordinate they are perpendicular to, so a thresholded sine of it draws five
          // parallel bands lying at the right rake -- and being a function of position, each
          // one is exactly on the surface wherever the surface turns out to be.
          if (Math.abs(x) > 0.24 && z > 1.35 && z < 2.50 && y > AXIS - 0.42) {
            const rake = z + (y - AXIS) * 0.42;
            const band = Math.cos((rake - 1.42) * (Math.PI * 2) / 0.235);
            if (band > 0.86) c.multiplyScalar(0.52);
          }
        };
      })(),
      material: {
        roughness: 0.54,
        // Denticles. Shark skin is literally a pavement of tiny teeth, which is what makes
        // it feel like sandpaper one way and silk the other, and `hide` at a fine repeat is
        // the closest thing in the relief set to it. Stretched 3:1, because the body sweep's
        // u runs along eight and a half feet and its v runs once round three.
        ...stretchedRelief('hide', { seed, along: 34, around: 12, strength: 0.34 }),
      },
    }),
    seaMesh(detail, { material: { roughness: 0.3 } }),
  ], s));
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 2 -- the moray eel
// ---------------------------------------------------------------------------

// A moray looking out of its hole, which is the only way anybody ever sees one.
//
// The animal is DELIBERATELY its own object, separate from the cave it lives in. Anything
// a student is invited to click and program has to be a thing they can actually pick --
// built into the rock, "make the eel look around" would have turned the reef instead.
// reefCave() below is the hole; a layout puts the two together.
//
// Everything that makes it a moray:
//
//  * THE OPEN MOUTH, permanently. It is not a threat display -- a moray has no gill covers
//    to pump water with, so it breathes by gaping, and a closed-mouthed moray looks dead.
//    Build it closed and the two tooth rows also interpenetrate into one welded saw, the
//    same trap the T. rex's jaw hit. Both jaws' teeth swing about one hinge as one piece.
//  * A THROAT THAT GOES SOMEWHERE. The first pass filled the gape with a pink ball, which
//    from the front is a plug. It is now a real tapering cavity running back into the head,
//    so looking into the mouth shows depth -- and, being a closed tube with a capped far
//    end, it is not a hole through the skull either.
//  * A SECTION THAT FLATTENS. Round behind the head, a deep ribbon at the tail. That is
//    what an eel IS, and bodySweep is what finally makes it expressible.
//  * A CONTINUOUS DORSAL FIN running from behind the head all the way down -- and it is a
//    membrane with a real edge, not a squashed tube. No paired fins anywhere: a moray has
//    no pectorals at all, and adding them makes a fish.
//  * RETICULATED SKIN. Scaleless and slimy, so the material is much glossier than any other
//    animal here.
export function morayEel({ length = 6, seed = 11, skin = 0xc7a24e, gape = 0.42 } = {}) {
  const s = length / 6;
  const hide = new THREE.Color(skin);
  const pale = hide.clone().offsetHSL(0.01, -0.16, 0.16).getHex();
  const fin = hide.clone().offsetHSL(0.03, -0.26, 0.17).getHex();
  const body = [];
  const detail = [];

  // The jaw hinge, and the swing that opens the mouth.
  const HINGE = [0, 2.02, 2.42];
  const swing = ([x, y, z]) => {
    const dy = y - HINGE[1];
    const dz = z - HINGE[2];
    return [x, HINGE[1] + dy * Math.cos(gape) - dz * Math.sin(gape), HINGE[2] + dy * Math.sin(gape) + dz * Math.cos(gape)];
  };

  // --- body ------------------------------------------------------------------------------
  // An S-curve rising out of the rock. The lift matters as much as the curve: a moray holds
  // its head clear of the hole and swings it, and one lying flat is a rope.
  const spine = [
    [-0.85, 0.42, -2.70], [-0.55, 0.50, -1.80], [-0.22, 0.66, -0.90], [0.06, 0.94, 0.00],
    [0.20, 1.32, 0.85], [0.18, 1.68, 1.55], [0.08, 1.92, 2.10],
  ];
  const spineCurve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(...p)));
  const spineAt = (t) => spineCurve.getPoint(THREE.MathUtils.clamp(t, 0, 1));
  const GIRTH = [0.20, 0.36, 0.47, 0.48, 0.43, 0.37, 0.32];
  const girthAt = (t) => Math.max(0.02, splineAt(GIRTH, t));

  // The trunk is swept round and then flattened progressively toward the tail, which a
  // single scale cannot do. Sampling the curve and building the section by hand is the
  // price of a body that is a cylinder at the head and a blade at the tail.
  {
    const samples = 44;
    const sides = 22;
    const positions = [];
    const uvs = [];
    const indices = [];
    const ring = sides + 1;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const p = spineAt(t);
      const tangent = spineCurve.getTangent(THREE.MathUtils.clamp(t, 0, 1)).normalize();
      const across = new THREE.Vector3().crossVectors(up, tangent).normalize();
      const vertical = new THREE.Vector3().crossVectors(tangent, across).normalize();
      const r = girthAt(t);
      // Flat at the tail (t = 0), round at the head.
      const flat = THREE.MathUtils.lerp(0.44, 1.0, Math.min(1, t * 1.5));
      const tall = THREE.MathUtils.lerp(1.32, 1.02, Math.min(1, t * 1.5));
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        const w = Math.cos(a) * r * flat;
        const h = Math.sin(a) * r * tall;
        positions.push(
          p.x + across.x * w + vertical.x * h,
          p.y + across.y * w + vertical.y * h,
          p.z + across.z * w + vertical.z * h
        );
        uvs.push(t, j / sides);
      }
    }
    for (let i = 1; i <= samples; i++) {
      for (let j = 1; j <= sides; j++) {
        const a = ring * (i - 1) + (j - 1);
        const b = ring * i + (j - 1);
        const c = ring * i + j;
        const d = ring * (i - 1) + j;
        indices.push(a, d, b, b, d, c);
      }
    }
    // Cap the tail. It is down the hole and nobody will see it, and it is capped anyway:
    // an open ring four inches across is the kind of thing that shows the one time a
    // student picks the animal up with the Move tool.
    const tail = spineAt(0);
    const base = positions.length / 3;
    positions.push(tail.x, tail.y, tail.z);
    uvs.push(0, 0.5);
    for (let j = 0; j < sides; j++) indices.push(base, j, j + 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    weldSeam(geometry, ring, samples + 1);
    body.push({ geometry, color: skin });
  }

  // The dorsal fin: one continuous membrane along the back, as a real slab with an edge.
  // It runs from behind the head to the tail tip, which is what a moray has instead of the
  // separate fins a fish carries.
  body.push({
    geometry: solidSurface({
      nu: 34, nv: 4, axis: [1, 0, 0],
      point: (u, v) => {
        const t = 0.03 + u * 0.94;
        const p = spineAt(t);
        const tangent = spineCurve.getTangent(t).normalize();
        const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
        const vertical = new THREE.Vector3().crossVectors(tangent, across).normalize();
        const r = girthAt(t) * THREE.MathUtils.lerp(1.30, 1.02, Math.min(1, t * 1.5));
        // The crest is tallest over the middle of the animal and dies away at both ends.
        // Tallest over the back half and dying away at both ends. It has to be GENEROUS:
        // at the 0.3 the first pass used, the crest cleared the body by under four inches
        // and the one fin a moray has was invisible from standing height.
        const crest = Math.sin(Math.min(1, u * 1.12) * Math.PI) * 0.42 + 0.07;
        const h = r * 0.85 + crest * v;
        return [p.x + vertical.x * h, p.y + vertical.y * h, p.z + vertical.z * h];
      },
      thick: (u, v) => (0.050 + 0.022 * Math.sin(u * Math.PI)) * (1 - v * 0.92),
    }),
    color: fin,
  });

  // --- head ------------------------------------------------------------------------------
  // A moray's skull is deep and wide at the back for the jaw muscles and narrows to a blade
  // at the snout, so the head is its own bodySweep with its own changing section rather
  // than one more length of tube.
  {
    const g = bodySweep(
      [
        { z: 0.00, w: 0.315, hUp: 0.34, hDn: 0.30 },
        { z: 0.42, w: 0.310, hUp: 0.35, hDn: 0.28 },
        { z: 0.86, w: 0.265, hUp: 0.31, hDn: 0.23 },
        { z: 1.24, w: 0.195, hUp: 0.24, hDn: 0.17 },
        { z: 1.52, w: 0.115, hUp: 0.155, hDn: 0.105 },
        { z: 1.66, w: 0.045, hUp: 0.060, hDn: 0.045 },
      ],
      { sides: 22, samples: 26, round: 1.25 }
    );
    // Placed onto the end of the spine, tipped up the way the neck is running.
    seaSolid(body, g, skin, { pos: [0.08, 1.92, 2.05], rot: [-0.18, 0, 0] });
  }
  // The lower jaw, swung open about the hinge as one piece.
  {
    const g = bodySweep(
      [
        { z: 0.00, w: 0.255, hUp: 0.115, hDn: 0.150 },
        { z: 0.44, w: 0.240, hUp: 0.105, hDn: 0.140 },
        { z: 0.86, w: 0.195, hUp: 0.085, hDn: 0.115 },
        { z: 1.22, w: 0.130, hUp: 0.060, hDn: 0.080 },
        { z: 1.46, w: 0.048, hUp: 0.028, hDn: 0.034 },
      ],
      { sides: 18, samples: 22, round: 1.4 }
    );
    const p = swing([0.06, 1.80, 2.20]);
    seaSolid(body, g, skin, { pos: p, rot: [gape - 0.10, 0, 0] });
  }

  // The throat: a tapering cavity running back into the head, capped at the far end. This
  // is what gives the gape depth instead of a plug.
  chain(detail, 0x9c5f55, [
    { p: [0.04, 1.96, 2.42], r: 0.195 },
    { p: [0.06, 1.92, 2.02], r: 0.155 },
    { p: [0.10, 1.82, 1.62], r: 0.095 },
  ], { options: SEG_SMALL, detail: 10 });
  // The tongue-less floor of the mouth, and the pale roof above it.
  seaSolid(detail, ball(0.175, 12), 0xb87d70, { pos: swing([0.05, 1.90, 2.62]), scale: [1.0, 0.42, 1.5] });

  // Teeth: a row along each jaw plus the long recurved fangs a moray really has at the
  // front. Small, white, and the single most-read detail on the whole animal.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const z = 2.52 + t * 1.05;
      const long = i < 2 ? 1.95 : 1;
      const w = 0.185 - t * 0.115;
      spike(detail, 0xf6f1e2, {
        length: 0.16 * long, radius: 0.030, sides: 6,
        at: [side * w, 1.90 - t * 0.02, z], rot: [0.28, 0, side * 0.18],
      });
      const [, ly, lz] = swing([0, 1.86, z]);
      spike(detail, 0xf6f1e2, {
        length: 0.14 * long, radius: 0.028, sides: 6,
        at: [side * (w * 0.86), ly, lz], rot: [Math.PI - 0.26 + gape, 0, side * -0.18],
      });
    }
    // A moray also has a row of teeth on the ROOF of its mouth, down the midline, and it
    // is visible straight into the gape.
    if (side > 0) {
      for (let i = 0; i < 4; i++) {
        spike(detail, 0xf2ecdc, {
          length: 0.10, radius: 0.024, sides: 5,
          at: [0, 2.02 - i * 0.012, 2.62 + i * 0.20], rot: [Math.PI - 0.30, 0, 0],
        });
      }
    }
    // Eye: set BACK by the hinge, small, and pale-ringed. A moray's eye is milky and
    // catches the light, which is most of what gives the face its expression.
    seaSolid(detail, ball(0.088, 12), 0xd8cfae, { pos: [side * 0.235, 2.16, 2.70] });
    seaSolid(detail, ball(0.056, 10), 0x14110d, { pos: [side * 0.278, 2.16, 2.73] });
    dome(body, pale, { radius: 0.13, height: 0.045, at: [side * 0.235, 2.27, 2.70], rot: [0, 0, side * 1.2], detail: 10, sink: 0.3 });
    // The tubular anterior nostril on the snout tip -- small, and unmistakably eel.
    chain(body, pale, [
      { p: [side * 0.075, 2.06, 3.52], r: 0.030 },
      { p: [side * 0.085, 2.11, 3.60], r: 0.024 },
    ], { options: SEG_TINY, detail: 8 });
    // The gill pore: a round dark recess low behind the head. Morays have exactly one, and
    // it is the whole reason the mouth has to stay open.
    seaSolid(body, ball(0.085, 10), 0x4c3a22, { pos: [side * 0.30, 1.78, 1.58], scale: [0.45, 1, 1.1] });
  }

  return group(...sized([
    seaMesh(body, {
      // Countershading on the belly, and a slow dapple over everything. The map supplies
      // the reticulation; this supplies the tone, and the two multiply.
      tint: counterShade({ low: 0.20, high: 2.30, belly: pale, edge: 0.18, width: 0.16, dapple: 0.05, seed }),
      material: {
        roughness: 0.26,
        map: mottleTexture(seed, { spots: 150, min: 0.02, max: 0.055, floor: 0.34, repeat: [8, 4] }),
      },
    }),
    seaMesh(detail, { material: { roughness: 0.34 } }),
  ], s));
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 3 -- the octopus
// ---------------------------------------------------------------------------

// A common octopus sprawled over the rubble, arms out.
//
// The four things that carry it:
//
//  * THE EYE. It is the whole animal. A big domed lens set high on the side of the head
//    with a HORIZONTAL BAR pupil -- not a round one -- a gold iris around it, and a lid
//    fold above and below. Get that and a lump of clay reads as an octopus.
//  * THE INTERBRACHIAL WEB, and this is the rebuild's big change. The first pass used a
//    squashed sphere as a skirt, which is a plinth, not a web. A real octopus's arms are
//    joined by a membrane that is attached along each arm and SAGS between them, so the
//    free edge scallops out to a point over every arm. Eight lofted patches give exactly
//    that, and they are what stop eight tubes stuck into a ball from reading as a spider.
//  * ARMS THAT EACH DO SOMETHING DIFFERENT. Eight identical arms radiating evenly is a
//    fairground ride. Real ones sprawl, curl back on themselves and lift a tip to feel
//    about, and the variety is what makes it look alive rather than dead.
//  * SUCKERS, in two rows, biggest near the body and shrinking to the tip -- each a rim
//    with a dark recess in it rather than a peg. They are placed from the arm's own
//    sampled curve, because the Frenet frame a swept tube uses twists unpredictably along
//    a curling path and there is no fixed `v` in the UVs that means "underside".
//
// The mantle is the bulb at the BACK, and getting that backwards is the commonest mistake
// in drawing one: the eyes are not on it, they are on the smaller head in front of it.
export function octopus({ span = 6.5, seed = 17, skin = 0xb08b63 } = {}) {
  const s = span / 6.5;
  const rng = seededRandom(seed);
  const base = new THREE.Color(skin);
  const shade = base.clone().offsetHSL(-0.01, 0.06, -0.11).getHex();
  const pale = base.clone().offsetHSL(0.01, -0.10, 0.14).getHex();
  const skinParts = [];
  const detail = [];

  // --- mantle and head -------------------------------------------------------------------
  // The mantle as its own sweep so it can be a proper bag -- broad at the back, narrowing
  // to the neck -- rather than an ellipsoid.
  // The mantle's own frame, kept as a matrix because the papillae have to be placed ON it.
  // The first pass tipped the mantle with a rotation and then scattered the papillae in
  // unrotated coordinates, which left three dozen small domes hanging in the water above
  // the animal like flies -- the single most obvious fault on the model.
  const mantleFrame = new THREE.Matrix4()
    .makeTranslation(0, 1.30, 0)
    .multiply(new THREE.Matrix4().makeRotationX(0.22));
  {
    const g = bodySweep(
      [
        { z: -1.90, w: 0.10, h: 0.10 },
        { z: -1.66, w: 0.44, hUp: 0.40, hDn: 0.36 },
        { z: -1.30, w: 0.68, hUp: 0.60, hDn: 0.50 },
        { z: -0.92, w: 0.76, hUp: 0.66, hDn: 0.54 },
        { z: -0.50, w: 0.70, hUp: 0.60, hDn: 0.50 },
        { z: -0.16, w: 0.56, hUp: 0.46, hDn: 0.42 },
        { z: 0.10, w: 0.52, hUp: 0.42, hDn: 0.40 },
      ],
      { sides: 22, samples: 30, round: 1.05 }
    );
    applyMatrix(g, mantleFrame);
    skinParts.push({ geometry: g, color: skin });
  }
  // The head, in front of the mantle and smaller: this is what the eyes sit on.
  seaSolid(skinParts, ball(0.52, 16), skin, { pos: [0, 1.06, 0.20], scale: [1.16, 0.94, 1.02] });

  // --- arms -------------------------------------------------------------------------------
  // Eight bearings, unevenly spaced on purpose: an octopus is bilateral, so the front pair
  // reach forward and the back pair tuck under the mantle.
  const bearings = [-0.30, 0.30, -0.92, 0.98, -1.72, 1.66, -2.55, 2.62];
  const armCurves = [];
  const armRadius = [];
  for (let i = 0; i < bearings.length; i++) {
    const a = bearings[i];
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const reach = randomIn(rng, 0.82, 1.12) * 2.75;
    // How far this arm curls its tip up off the sand, and how much it swings sideways.
    // Three of the eight lifted and the rest flat is roughly what a settled octopus does.
    const lift = rng() < 0.4 ? randomIn(rng, 0.55, 1.15) : randomIn(rng, -0.02, 0.16);
    const sway = randomIn(rng, -0.75, 0.75);
    const r0 = 0.245;
    const nodes = [];
    const steps = 6;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const dist = 0.30 + t * reach;
      const bend = Math.sin(t * Math.PI * 0.85) * sway * t;
      const px = dx * dist - dz * bend;
      const pz = dz * dist + dx * bend;
      const py = 0.52 - Math.sin(t * Math.PI * 0.55) * 0.34 + Math.pow(t, 2.4) * lift + 0.16;
      nodes.push({ p: [px, Math.max(0.09, py), pz], r: r0 * Math.pow(1 - t, 0.72) + 0.022 });
    }
    // The root node is INSIDE the head, so the arm's own start cap is buried rather than
    // sitting on the surface as a visible bead.
    chain(skinParts, i % 2 === 0 ? skin : shade, nodes, { options: SEG_LIMB, detail: 13, capStart: false });
    armCurves.push(new THREE.CatmullRomCurve3(nodes.map((n) => new THREE.Vector3(...n.p))));
    armRadius.push((t) => r0 * Math.pow(Math.max(0, 1 - t), 0.72) + 0.022);
  }

  // The web. Eight patches, each spanning from one arm to the next: attached along both
  // arms for the first third of their length, with a free edge that sags between them.
  //
  // The bearings are not in ring order (they alternate left and right), so the patches have
  // to be built between ANGULAR neighbours or every other web crosses the animal.
  const order = bearings.map((a, i) => i).sort((p, q) => bearings[p] - bearings[q]);
  for (let k = 0; k < order.length; k++) {
    const left = armCurves[order[k]];
    const right = armCurves[order[(k + 1) % order.length]];
    const lr = armRadius[order[k]];
    const rr = armRadius[order[(k + 1) % order.length]];
    const ATTACH = 0.40; // how far along each arm the membrane is joined
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    skinParts.push({
      geometry: solidSurface({
        nu: 7, nv: 5, axis: [0, 1, 0],
        point: (u, v) => {
          left.getPoint(v * ATTACH, a);
          right.getPoint(v * ATTACH, b);
          // Across the span, and sagging. `sag` grows with v because the free edge is
          // further from the body and has more membrane to hang.
          //
          // CLAMPED ABOVE THE SEABED, which is what the first pass got wrong. The arms of a
          // sprawled octopus are already almost on the sand, so a catenary of any realistic
          // depth put the whole web underground -- the model rendered as eight bare arms
          // radiating from a ball, with the one feature that separates an octopus from a
          // spider buried in the floor.
          const sag = Math.sin(u * Math.PI) * v * 0.17;
          return [
            a.x + (b.x - a.x) * u,
            Math.max(0.13, a.y + (b.y - a.y) * u - sag),
            a.z + (b.z - a.z) * u,
          ];
        },
        // Thick where it meets an arm -- so the join is buried inside the arm tube -- and
        // vanishing at the free edge, which is what a membrane's edge is.
        thick: (u, v) => {
          const arm = Math.min(lr(v * ATTACH), rr(v * ATTACH));
          return arm * 0.95 * (1 - Math.pow(Math.sin(u * Math.PI), 1.5) * 0.74) * (1 - v * 0.22) + 0.016;
        },
      }),
      color: shade,
    });
  }

  // Suckers. Two rows down the underside of each arm, big near the body and shrinking to
  // the tip, each a raised rim with a dark recess in it.
  for (let i = 0; i < armCurves.length; i++) {
    const curve = armCurves[i];
    const radiusAt = armRadius[i];
    const count = 11;
    for (let k = 0; k < count; k++) {
      const t = 0.06 + (k / count) * 0.84;
      const p = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const armR = radiusAt(t);
      const across = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const under = new THREE.Vector3().crossVectors(across, tangent).normalize().multiplyScalar(-1);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), under);
      const size = armR * (0.52 - t * 0.10);
      for (const row of [-1, 1]) {
        const centre = new THREE.Vector3()
          .copy(p)
          .add(across.clone().multiplyScalar(row * armR * 0.42))
          .add(under.clone().multiplyScalar(armR * 0.70));
        const place = (geometry, color) => {
          applyMatrix(geometry, new THREE.Matrix4().compose(centre, q, new THREE.Vector3(1, 1, 1)));
          skinParts.push({ geometry, color });
        };
        // The rim, and the recess inside it. A sucker built as a plain peg reads as a stud;
        // what makes it a sucker is that the middle is DARKER and lower than the edge.
        place(new THREE.CylinderGeometry(size, size * 0.86, armR * 0.34, 8), pale);
        place(new THREE.CylinderGeometry(size * 0.56, size * 0.56, armR * 0.30, 8), 0x6f4a34);
      }
    }
  }

  // --- eyes --------------------------------------------------------------------------------
  for (const side of [-1, 1]) {
    // The eye turret: an octopus's eye stands proud of the head on its own dome.
    seaSolid(skinParts, ball(0.31, 14), skin, { pos: [side * 0.40, 1.30, 0.16], scale: [0.92, 0.98, 0.92] });
    // A raised brow papilla over each eye -- octopuses put these up, and it is the
    // difference between a face and a bump.
    dome(skinParts, shade, { radius: 0.16, height: 0.09, at: [side * 0.40, 1.56, 0.12], rot: [0, 0, side * 0.3], detail: 12, sink: 0.35 });
    dome(skinParts, shade, { radius: 0.13, height: 0.06, at: [side * 0.40, 1.05, 0.14], rot: [0, 0, side * -0.4], detail: 10, sink: 0.4 });
    // Iris, cornea and the bar pupil. The cornea is a shallow cap over the iris rather than
    // a full ball, so the eye has a wet highlight without being a marble.
    seaSolid(detail, ball(0.235, 14), 0xd8a63c, { pos: [side * 0.54, 1.33, 0.19], scale: [0.82, 0.86, 0.86] });
    seaSolid(detail, new THREE.BoxGeometry(0.05, 0.075, 0.34), 0x141110,
      { pos: [side * 0.665, 1.33, 0.19], rot: [0, 0, side * 0.1] });
    seaSolid(detail, ball(0.155, 14, 8), 0x3a2c22, { pos: [side * 0.635, 1.33, 0.19], scale: [0.4, 0.72, 1.02] });
  }
  // The siphon, tucked under the head on one side -- the only part of an octopus that
  // explains how it moves. A real tube, capped, rather than a peg.
  chain(skinParts, pale, [
    { p: [0.28, 0.86, 0.30], r: 0.135 },
    { p: [0.34, 0.78, 0.52], r: 0.115 },
    { p: [0.38, 0.74, 0.68], r: 0.090 },
  ], { options: SEG_SMALL, detail: 10 });

  // Papillae: an octopus can raise its skin into bumps, and a scatter of them over the
  // mantle is most of the difference between skin and rubber.
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2;
    const t = rng();
    const z = -1.78 + t * 1.72;
    const r = 0.24 + Math.sin(Math.min(1, t * 1.55) * Math.PI) * 0.50;
    dome(skinParts, rng() < 0.5 ? shade : pale, {
      radius: randomIn(rng, 0.05, 0.10), height: randomIn(rng, 0.025, 0.055),
      at: [Math.sin(a) * r, Math.cos(a) * r * 0.86, z],
      rot: [0, 0, -a], detail: 6, sink: 0.4, base: mantleFrame,
    });
  }

  return group(...sized([
    seaMesh(skinParts, {
      material: {
        roughness: 0.40,
        map: mottleTexture(seed + 3, { spots: 110, min: 0.03, max: 0.09, floor: 0.5, repeat: [5, 4] }),
      },
    }),
    seaMesh(detail, { material: { roughness: 0.22 } }),
  ], s));
}

// ---------------------------------------------------------------------------
// PRIMARY MODEL 4 -- the sea star
// ---------------------------------------------------------------------------

// A five-armed sea star, `size` feet from tip to opposite tip.
//
// Built as ONE closed surface over polar coordinates rather than as a disc with five arms
// stuck into it, which is both the realism change and the gap fix: the outline is a
// function of bearing, the height is a function of bearing and radius, and there is
// therefore no join anywhere on the animal to leave open. The arms taper from a real disc
// -- a star drawn as five spokes meeting at a dot is a Christmas decoration -- and the
// underside is FLAT, because it is lying on the sand.
//
// The beaded skin is the other half of it. A sea star's surface is covered in hard pale
// tubercles in rows down each arm, and they catch the light in a way the flat colour
// cannot. Every one is placed FROM the same surface function the body is built from and
// sunk into it, so none of them can float above the arm -- which is exactly what happened
// the first time, when they were sized off the unflattened sweep radius.
export function starfish({ size = 2, color = 0xd4392c, seed = 23, arms = 5 } = {}) {
  const rng = seededRandom(seed);
  const tint = new THREE.Color(color);
  const rim = tint.clone().offsetHSL(0.01, -0.04, 0.09).getHex();
  // The tubercles are the animal's OWN colour lightened, not white. Pure pale beads in
  // neat rows on a red star read as a painted toy: the eye finds the dots, not the animal.
  const bead = tint.clone().offsetHSL(0.005, -0.10, 0.15).getHex();
  const parts = [];
  const R = size / 2;

  // The outline: a disc of radius DISC with `arms` lobes reaching out to R. The exponent is
  // what makes the arms taper rather than bulge -- a plain cosine gives a flower.
  const DISC = 0.38;
  const twist = randomIn(rng, 0, Math.PI * 2);
  const lengths = [];
  for (let i = 0; i < arms; i++) lengths.push(randomIn(rng, 0.94, 1.04));
  const outline = (a) => {
    const k = ((a - twist) / (Math.PI * 2)) * arms;
    const i = Math.floor(k + 0.5);
    // 1.25, not the 1.55 first used: a higher exponent tapers the arm to a spike, and a
    // sea star's arms are BLUNT -- they are tubes of body, not spokes.
    const lobe = Math.pow(Math.max(0, Math.cos((k - i) * Math.PI)), 1.25);
    return R * (DISC + (lengths[((i % arms) + arms) % arms] - DISC) * lobe);
  };
  // The surface: a dome over the disc, thinning along each arm, with the tip curling up the
  // way a real sea star raises its arm tips when it moves.
  const heightAt = (a, d) => {
    const edge = outline(a);
    const t = THREE.MathUtils.clamp(d / Math.max(1e-4, edge), 0, 1);
    const arch = Math.pow(Math.max(0, 1 - t * t), 0.62);
    const thin = THREE.MathUtils.lerp(1, 0.30, THREE.MathUtils.clamp((d / R - DISC) / (1 - DISC), 0, 1));
    return R * 0.34 * arch * thin;
  };
  const lift = (a, d) => {
    const t = THREE.MathUtils.clamp(d / Math.max(1e-4, outline(a)), 0, 1);
    return R * 0.16 * Math.pow(t, 3.2);
  };

  parts.push({
    geometry: solidSurface({
      nu: 60, nv: 8, closedU: true, axis: [0, 1, 0],
      point: (u, v) => {
        const a = u * Math.PI * 2;
        const d = v * outline(a);
        const h = heightAt(a, d);
        return [Math.sin(a) * d, lift(a, d) + h / 2, Math.cos(a) * d];
      },
      thick: (u, v) => heightAt(u * Math.PI * 2, v * outline(u * Math.PI * 2)) / 2,
    }),
    color,
  });

  // The tubercles: a central row down each arm's ridge with a shorter row either side,
  // plus a ring round the disc. Placed from heightAt() and sunk, so they sit ON the animal.
  for (let i = 0; i < arms; i++) {
    const a = twist + (i / arms) * Math.PI * 2;
    const len = R * lengths[i];
    for (let k = 0; k < 9; k++) {
      const t = 0.06 + (k / 9) * 0.90;
      const d = t * len;
      for (const row of [-2, -1, 0, 1, 2]) {
        if (Math.abs(row) === 2 && t > 0.38) continue;
        if (Math.abs(row) === 1 && t > 0.74) continue;
        // Across the arm, in ANGLE -- the arm narrows as it goes out, so a fixed lateral
        // offset walks off the side of it.
        const across = row * 0.28 * (1 - t * 0.55);
        const bearing = a + across;
        const rr = R * (row === 0 ? 0.052 : 0.040) * (1 - t * 0.35);
        dome(parts, bead, {
          radius: rr, height: rr * 0.78,
          at: [Math.sin(bearing) * d, lift(bearing, d) + heightAt(bearing, d), Math.cos(bearing) * d],
          detail: 5, sink: 0.5,
        });
      }
    }
    // A paler swollen tip, and the single pale tube foot that pokes out beyond it -- the
    // terminal tentacle a sea star feels its way with.
    const tipD = len * 0.985;
    dome(parts, rim, {
      radius: R * 0.062, height: R * 0.05,
      at: [Math.sin(a) * tipD, lift(a, tipD) + heightAt(a, tipD), Math.cos(a) * tipD],
      detail: 9, sink: 0.35,
    });
  }
  // A ring of tubercles round the disc, which is what a real one has where the arms meet.
  for (let k = 0; k < arms * 4; k++) {
    // Jittered, because a perfect ring of identical bumps round the middle of a red star
    // reads as a target painted on it.
    const a = twist + (k / (arms * 4)) * Math.PI * 2 + Math.PI / arms + randomIn(rng, -0.16, 0.16);
    const d = R * randomIn(rng, 0.22, 0.30);
    dome(parts, bead, {
      radius: R * 0.045, height: R * 0.036,
      at: [Math.sin(a) * d, lift(a, d) + heightAt(a, d), Math.cos(a) * d], detail: 6, sink: 0.5,
    });
  }
  // The madreporite: the pale off-centre plate a sea star pumps sea water in through. One
  // dome, and it is the detail that tells a student this is an animal and not a shape.
  {
    const a = twist + Math.PI / arms;
    const d = R * 0.16;
    dome(parts, bead, {
      radius: R * 0.085, height: R * 0.05,
      at: [Math.sin(a) * d, lift(a, d) + heightAt(a, d), Math.cos(a) * d], detail: 10, sink: 0.3,
    });
  }

  return group(seaMesh(parts, {
    tint: (c, x, y, z) => {
      // A slow mottle over the arms, which every sea star has and which stops a bright red
      // one reading as moulded plastic.
      const n = Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 - seed) + Math.cos((x + z) * 7.7) * 0.5;
      c.multiplyScalar(1 + (n / 1.5) * 0.075);
      void y;
    },
    material: { roughness: 0.68, ...relief('hide', { seed, repeat: 9, strength: 0.6 }) },
  }));
}

// ---------------------------------------------------------------------------
// The reef itself -- rock, coral and sponge
// ---------------------------------------------------------------------------

// What separates a reef from a pile of rubble is that no two colonies next to each other
// are the same colour, so a large part of the budget in this half of the file goes into hue
// rather than into geometry. That is not a shortcut: a reef genuinely is simple shapes in
// impossible colours. What the rebuild adds is that the shapes are now CLOSED, SMOOTH and
// carry small-scale relief -- the difference between a coral and a coloured lozenge.

// Reef limestone, displaced at TWO frequencies.
//
// One frequency is a potato. What makes rock read as rock is detail at several scales at
// once: a large lumpy form, a knobbly surface on top of it, and grain below that. The first
// two are geometry here and the third is the bumpMap.
//
// The displacement must be a smooth function of DIRECTION, never a fresh random number per
// vertex: IcosahedronGeometry is NON-INDEXED, so every triangle owns its own copy of each
// corner, and per-vertex jitter tears the surface into loose overlapping shards.
function reefRock(radius, { seed = 1, detail = null, amount = 0.30, knob = 0.13, flatten = 0.85 } = {}) {
  // Subdivision by SIZE, not a flat count. An icosahedron at detail 1 is 80 faces, which on
  // a nine-foot mound is a three-foot facet -- a cut gemstone rather than rock. Detail 3 is
  // 1280, which is what the knob frequency below needs in order not to alias into noise.
  const level = detail ?? (radius > 3.2 ? 3 : radius > 1.4 ? 2 : 1);
  // mergeVertices() FIRST, and this line is the whole reason the reef used to look like
  // crumpled paper.
  //
  // IcosahedronGeometry -- everything from PolyhedronGeometry -- is NON-INDEXED, and
  // `computeVertexNormals()` on a non-indexed geometry can only compute FACE normals: each
  // triangle gets its own, so the result is flat-shaded whatever the material says. Every
  // rock in this world was therefore faceted no matter how much it was subdivided, and
  // subdividing it further just made the facets smaller. Welding the duplicate corners into
  // an index makes the normals average across the shared edges, which is what smooth means
  // -- and it drops the vertex count by a factor of six as a side effect.
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(radius, level));
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  const phase = (seed % 97) * 0.371;
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const len = p.length() || 1;
    const nx = p.x / len;
    const ny = p.y / len;
    const nz = p.z / len;
    const form =
      Math.sin(nx * 5.1 + phase) * Math.cos(ny * 4.3 - phase * 0.7) +
      Math.sin(nz * 6.7 + phase * 1.3) * 0.6 +
      Math.cos((nx + nz) * 3.3 - phase) * 0.4;
    // The knob term's frequency is held down to ~8 deliberately. At detail 3 the faces are
    // about 0.35 radians apart, so anything much above this aliases into noise instead of
    // reading as knobs -- and paying for detail 4 on fourteen bommies is 400k triangles of
    // background rock.
    const bumps =
      Math.sin(nx * 8.3 - phase * 2.1) * Math.sin(ny * 7.1 + phase) +
      Math.cos(nz * 9.7 + phase * 1.7) * 0.75;
    p.multiplyScalar(1 + (form / 2) * amount + (bumps / 1.75) * knob);
    p.y *= flatten;
    position.setXYZ(i, p.x, p.y, p.z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

// ENCRUSTING GROWTH AS A PER-VERTEX PAINT, which is the one affordable way to cover a
// nine-foot mound in coral.
//
// There is almost no bare rock on a living reef. Covering a bommie with enough small solids
// to say so costs a few hundred of them per mound, and fourteen mounds later that is the
// entire triangle budget for the world spent on background scenery. But coverage is a
// COLOUR problem, not a geometry one: a grey dome painted in irregular patches of coralline
// pink, purple, olive and ochre reads as encrusted from every distance, and the knobs then
// only have to supply the silhouette rather than the whole story.
//
// The patches are hard-edged on purpose. Blended smoothly, four hues over one rock average
// out to a uniform mud -- the boundaries between colonies are what the eye reads as
// separate organisms.
function encrustTint(seed, { strength = 0.45, scale = 0.62 } = {}) {
  // FOUR hues, all of them within reach of the limestone underneath. Six saturated ones at
  // full strength -- the first attempt -- turned every mound into a pastel Easter egg, which
  // is a more expensive mistake than bare grey rock because it is instantly wrong rather
  // than merely dull. Coralline algae is pink-mauve, the turf is olive, and the rest of a
  // reef mound is the colour of wet limestone.
  const hues = [
    new THREE.Color(REEF.rockPink), new THREE.Color(REEF.rockPurple),
    new THREE.Color(REEF.algae), new THREE.Color(REEF.rockDark),
  ];
  const phases = hues.map((_, i) => seed * 0.37 + i * 2.11);
  return (c, x, y, z) => {
    let best = -9;
    let pick = 0;
    for (let i = 0; i < hues.length; i++) {
      const p = phases[i];
      const f = scale * (0.7 + (i % 3) * 0.28);
      const v =
        Math.sin(x * f + p) * Math.cos(z * f * 0.86 - p * 0.7) +
        Math.sin(y * f * 0.74 + x * f * 0.4 + p * 1.3) * 0.8;
      if (v > best) { best = v; pick = i; }
    }
    if (best > 0.55) c.lerp(hues[pick], Math.min(1, (best - 0.55) / 0.8) * strength);
  };
}

// Coralline algae: the pink and purple crust that covers every square inch of a real reef's
// bare rock. A scatter of sunk domes over a mound, and it is most of what stops the rock
// reading as a grey boulder someone dropped in the sea.
function crustRock(parts, rng, { at, radius, count = 14, tones }) {
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const y = randomIn(rng, -0.35, 0.9);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const rr = radius * randomIn(rng, 0.14, 0.30);
    dome(parts, tones[Math.floor(rng() * tones.length)], {
      radius: rr, height: rr * randomIn(rng, 0.28, 0.5),
      at: [at[0] + Math.cos(a) * r * radius * 0.92, at[1] + y * radius * 0.80, at[2] + Math.sin(a) * r * radius * 0.92],
      rot: [0, 0, 0], detail: 9, sink: 0.55,
    });
  }
}

// THE SHAPE OF A REEF MOUND, AS ONE FUNCTION THAT THE ROCK AND THE CORAL BOTH READ.
//
// This is the load-bearing idea in this half of the file. A garden draped over a mound has
// to know where the rock is, and the first pass had the mound built as a heap of randomly
// placed lumps while the garden assumed a smooth dome. The two disagreed by several feet, so
// a third of every draped garden hung in open water beside its own rock -- coloured corals
// floating in mid-ocean, which is about the most obviously broken thing a reef can do.
//
// The obvious fix is to make the rock a clean half-ellipsoid, and that was the SECOND
// mistake: a mound of exactly that shape reads as a giant marshmallow half-buried in the
// sand, and no amount of colour rescues it. What a bommie actually looks like is an
// irregular mass, wider on one side than the other, with a shoulder and a lip.
//
// So the height is a function of BEARING as well as distance, seeded per mound -- and both
// the rock and the garden call it. The mound can then be as irregular as it likes and every
// colony still lands exactly on it.
function moundHeight(x, z, radius, height, seed) {
  const d = Math.hypot(x, z);
  const a = Math.atan2(x, z);
  const p = (seed % 89) * 0.4157;
  // The outline: which way this mound sprawls.
  const rr = radius * (1 + 0.19 * Math.sin(a * 2 + p) + 0.12 * Math.cos(a * 3 - p * 1.3) + 0.07 * Math.sin(a * 5 + p * 2.1));
  const t = d / rr;
  if (t >= 1) return 0;
  // The profile: a shouldered dome rather than a hemisphere, plus a swell round the bearing
  // so one side stands taller than the other, and a ripple in BOTH bearing and radius so the
  // flanks are lumpy rather than swept. All of it is deterministic, so the garden draped over
  // this lands on every lump -- which is the entire reason the height lives in one function.
  const swell = 1 + 0.17 * Math.sin(a * 2 - p * 0.7) + 0.09 * Math.cos(a * 4 + p);
  const lumps =
    1 + 0.11 * Math.sin(a * 7 + p * 1.9 + t * 6.0) +
    0.07 * Math.cos(a * 11 - p + t * 9.0) +
    0.05 * Math.sin(t * 14 + a * 3 + p * 2.7);
  return height * swell * lumps * Math.pow(1 - t * t, 0.55);
}

// The mound's own surface, as a closed solid: the dome plus a skirt that runs below the sand
// so a dip in the sea floor can never show daylight underneath it.
function moundShell(radius, height, seed, { rings = 15, sides = 58 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ring = sides + 1;
  const at = (a, t) => {
    const rr = radius * (1 + 0.19 * Math.sin(a * 2 + (seed % 89) * 0.4157) +
      0.12 * Math.cos(a * 3 - (seed % 89) * 0.4157 * 1.3) +
      0.07 * Math.sin(a * 5 + (seed % 89) * 0.4157 * 2.1));
    const d = t * rr;
    return [Math.sin(a) * d, moundHeight(Math.sin(a) * d, Math.cos(a) * d, radius, height, seed), Math.cos(a) * d];
  };
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const [x, y, z] = at(a, t);
      // The last ring drops below the sand rather than stopping on it.
      positions.push(x, i === rings ? -0.7 : y, z);
      uvs.push(j / sides, t);
    }
  }
  for (let i = 1; i <= rings; i++) {
    for (let j = 1; j <= sides; j++) {
      const a = ring * (i - 1) + (j - 1);
      const b = ring * i + (j - 1);
      const c = ring * i + j;
      const d = ring * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }
  // Apex fan and a floor, so the shell is closed.
  const apex = positions.length / 3;
  positions.push(0, moundHeight(0, 0, radius, height, seed), 0);
  uvs.push(0.5, 0);
  for (let j = 0; j < sides; j++) indices.push(apex, j + 1, j);
  const floor = positions.length / 3;
  positions.push(0, -0.7, 0);
  uvs.push(0.5, 1);
  for (let j = 0; j < sides; j++) indices.push(floor, ring * rings + j, ring * rings + j + 1);

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  weldSeam(geometry, ring, rings + 1);
  return geometry;
}

// A reef mound: the limestone lump everything else grows on.
export function coralBommie({ radius = 6, height = 5, seed = 41, color = REEF.rock } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const tones = [color, REEF.rockDark, REEF.rockPink, REEF.rockPurple, REEF.algae];
  // THE CRUST PALETTE IS CORAL COLOURS, not rock colours, and that is the whole difference
  // between a reef mound and a boulder. There is almost no bare rock on a living reef.
  // A WIDE tonal range, dark tones included. Thirteen mid-to-light coral colours over pale
  // limestone gave a mound the look of an iced cake: every knob read as a pastel sweet stuck
  // on the top, because nothing in the set was darker than the rock it sat on.
  const crust = [
    REEF.rockPink, REEF.rockPurple, REEF.algae, REEF.rose, REEF.magenta, REEF.lilac,
    REEF.amber, REEF.gold, REEF.teal, REEF.green, REEF.orange, REEF.cream,
    REEF.rockDark, REEF.rockDark, 0x5f5644, 0x6b5a3e, 0x4f6350, 0x7a4a52, REEF.red,
  ];

  parts.push({ geometry: moundShell(radius, height, seed), color });

  // Satellite masses. These are additive -- they can only push the surface outward, never
  // eat into the shape the garden is about to be draped over -- so they can be as aggressive
  // as the profile needs. Seated at a fraction of the local height instead of ON it they sit
  // INSIDE the mound and contribute nothing at all, which is what the first pass did.
  //
  // SMALL AND DEEPLY SUNK. At a third of the mound's radius and half buried, a satellite
  // presents a wide flat cap of its own -- and at the subdivision a rock that size gets, the
  // facets on that cap are half a foot across. Ten of them read as crumpled paper plates
  // stuck to the top of the mound, which is worse than no satellites at all.
  const lumps = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < lumps; i++) {
    const a = rng() * Math.PI * 2;
    const d = randomIn(rng, radius * 0.12, radius * 0.80);
    const r = radius * randomIn(rng, 0.15, 0.29);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    seaSolid(parts, reefRock(r, { seed: seed + i * 13, detail: 3, amount: randomIn(rng, 0.26, 0.42), flatten: randomIn(rng, 0.80, 1.05) }),
      tones[Math.floor(rng() * tones.length)], {
        pos: [x, moundHeight(x, z, radius, height, seed) - r * randomIn(rng, 0.48, 0.78), z],
      });
  }

  // Coralline crust: the knobbly encrusting growth that carries the mound's small-scale
  // silhouette. The COLOUR of the covering is painted per vertex instead (see encrustTint);
  // covering a nine-foot dome in solids costs a few hundred of them, and fourteen mounds
  // later that is the whole world's triangle budget spent on background scenery.
  //
  // Each one is oriented by the mound's own surface normal, taken from moundHeight by finite
  // difference. Tipped by a single Euler angle instead -- which is what a `rot: [0, 0, x]`
  // amounts to -- a knob out on the flank at a bearing of ninety degrees is tipped the wrong
  // way entirely, and eighty of them read as decals lying flat on the rock.
  const knobs = Math.round(radius * radius * 2.6);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < knobs; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.pow(rng(), 0.38) * radius * 0.97;
    const rr = radius * randomIn(rng, 0.035, 0.135);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const y = moundHeight(x, z, radius, height, seed);
    const e = 0.25;
    const n = new THREE.Vector3(
      -(moundHeight(x + e, z, radius, height, seed) - y) / e, 1,
      -(moundHeight(x, z + e, radius, height, seed) - y) / e
    ).normalize();
    const g = ball(rr, 8);
    g.scale(1, randomIn(rng, 0.30, 0.72), randomIn(rng, 0.65, 1.35));
    applyMatrix(g, new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z).addScaledVector(n, -rr * 0.32),
      new THREE.Quaternion().setFromUnitVectors(up, n),
      new THREE.Vector3(1, 1, 1)
    ));
    parts.push({ geometry: g, color: crust[Math.floor(rng() * crust.length)] });
  }
  return group(seaMesh(parts, {
    // The paint's patches were bigger than the rock they were painting. `scale` is a spatial
    // frequency in FEET, so at 0.5 one patch spans about twelve feet -- a nine-foot mound
    // came out as one or two flat washes of colour rather than as a mosaic of colonies.
    tint: encrustTint(seed, { strength: 0.55, scale: 1.7 }),
    material: {
      roughness: 0.95,
      // And the relief was invisible for the same class of reason. The shell's u runs once
      // round a fifty-odd-foot circumference and its v runs across nine feet of flank, so a
      // square repeat of 6 put a NINE-FOOT stone cell on the rock -- which is not grain, it
      // is another lump. The tile has to be sized to the surface, not to the number of parts.
      ...stretchedRelief('stone', { seed, along: 34, around: 9, strength: 0.9 }),
    },
  }));
}

// A reef mound with a hole in it, for the moray to live in. The opening faces +Z.
//
// The DARK INTERIOR BOX behind the mouth is what makes it a cave rather than a doorway.
// There is nothing back there, so without it a student sees straight through to the fogged
// water on the far side and the hole reads as a gap between two rocks -- the same fix a
// 1940's New York shopfront needed behind its glass.
export function reefCave({
  width = 16, height = 10, mouth = 5.5, mouthHeight = 6.5, recess = 5, seed = 43,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const dark = [];
  // No algae green in this tone set, unlike the open bommies'. Every surface framing this
  // hole is either an overhang or faces away from a near-vertical sun, so it is lit by the
  // ground bounce alone -- and the darkest colour in the palette, on the one face nothing
  // else lights, came out as a slab of black hanging over the entrance.
  const tones = [REEF.rock, REEF.rockPink, REEF.rockPurple, REEF.rockDark];
  const crust = [REEF.rockPink, REEF.rockPurple, REEF.rock];
  const hw = mouth / 2;

  const lump = (r, pos, flatten = 0.8) => {
    seaSolid(parts, reefRock(r, { seed: seed + Math.round(pos[0] * 7 + pos[1] * 11 + 3), amount: randomIn(rng, 0.20, 0.34), flatten }),
      tones[Math.floor(rng() * tones.length)], { pos });
    crustRock(parts, rng, { at: pos, radius: r, count: Math.round(r * 2.0), tones: crust });
  };

  // THE RECESS IS BUILT FIRST AND THE ROCK IS BUILT AROUND IT.
  //
  // The first version of this did it the other way -- a heap of boulders with a couple of
  // dark slabs shoved in behind -- and it produced neither a hole nor a cave: the slabs
  // stuck out through the rock as black fins, and the "mouth" was a two-foot slot with a
  // boulder filling it. Starting from the void and enclosing it is the only way to be sure
  // there is actually a way in.
  //
  // Deliberately not black: a pure black hole in a bright blue world reads as a rendering
  // fault rather than as depth. This is a very dark warm brown, which is what the inside of
  // a reef ledge looks like with a torch on it.
  //
  // THE VOID IS BUILT BIGGER THAN THE OPENING, which is the second thing this got wrong.
  // Sized to match, its four straight edges landed exactly at the gap between the rocks and
  // the cave read as a black RECTANGLE cut into the reef -- geometry, not a hole. Oversized
  // by half again, every edge of it is hidden behind rock.
  const t = 0.4;
  const vw = mouth * 1.6;
  const vh = mouthHeight * 1.4;
  dark.push({ geometry: new THREE.BoxGeometry(vw + t * 2, vh, t), color: 0x1b1712,
    position: [0, vh / 2, -recess] });
  dark.push({ geometry: new THREE.BoxGeometry(vw + t * 2, t, recess), color: 0x231c15,
    position: [0, vh, -recess / 2] });
  dark.push({ geometry: new THREE.BoxGeometry(vw + t * 2, t, recess), color: 0x2c241a,
    position: [0, 0.12, -recess / 2] });
  for (const side of [-1, 1]) {
    dark.push({ geometry: new THREE.BoxGeometry(t, vh, recess), color: 0x231c15,
      position: [side * (vw / 2 + t / 2), vh / 2, -recess / 2] });
  }

  // Now the rock, placed from the recess's own dimensions so it always encloses it. Each
  // flank lump's INNER edge lands a few inches inside the opening, which is what hides the
  // recess box's corners without narrowing the way in.
  const sideR = Math.max(2.6, (width - mouth) * 0.30);
  for (const side of [-1, 1]) {
    lump(sideR, [side * (hw + sideR * 0.95), height * 0.30, 1.1]);
    lump(sideR * 0.86, [side * (hw + sideR * 1.0), height * 0.58, -recess * 0.45]);
    lump(sideR * 0.7, [side * (hw + sideR * 1.35), height * 0.16, -recess * 0.95]);
    // The forward shoulders. Set out at 1.15 rather than the 0.7 this started at: parked
    // closer in they stood squarely in front of the opening from every approach angle and
    // narrowed a five-foot mouth to under three, which turned the cave -- and the animal
    // that is the whole reason for it -- into a slot glimpsed between two boulders.
    lump(sideR * 0.62, [side * (hw + sideR * 1.15), height * 0.12, 2.6], 0.7);
  }
  // The lintel over the mouth, dropped far enough to overlap the top of the recess, and
  // built as three overlapping masses rather than one. A single block wide enough to span
  // the opening presents one huge downward-facing facet, and a facet that size in permanent
  // shade is the most conspicuous surface on the whole prop.
  for (const off of [-1, 0, 1]) {
    lump(width * 0.17, [off * width * 0.15, mouthHeight + width * (0.11 + Math.abs(off) * 0.03), 0.6 - Math.abs(off) * 0.5], 0.62);
  }
  lump(width * 0.22, [0, mouthHeight + width * 0.19, -recess * 0.6], 0.7);
  lump(width * 0.30, [0, height * 0.38, -(recess + width * 0.20)]);
  lump(width * 0.20, [randomIn(rng, -2, 2), height * 0.72, -(recess + width * 0.24)], 0.7);

  return group(
    seaMesh(parts, {
      tint: encrustTint(seed, { strength: 0.34, scale: 0.45 }),
      material: { roughness: 0.95, ...relief('stone', { seed, repeat: 4 }) },
    }),
    mergedMesh(dark, { roughness: 1 })
  );
}

// The workhorse: a scatter of assorted corals and sponges, merged into ONE mesh.
//
// A reef is not a few big specimens, it is hundreds of small colonies packed shoulder to
// shoulder, and placing those as individual props would cost hundreds of draw calls for
// scenery nobody looks at directly. One garden is one draw call.
//
// THIS BUILDER IS PLACED THIRTY-FIVE TIMES, which is the constraint that shapes it: every
// triangle here is multiplied by 35, so the fidelity gain has to come from better SHAPES at
// a similar count rather than from tessellation. What changed in the rebuild is that every
// colony is now closed and smooth-shaded, the branch sweeps have enough sides not to read
// as prisms, and three new growth forms replace the three that read worst at size.
export function coralGarden({ radius = 7, count = 26, seed = 47, height = 1, palette, mound = 0, moundSeed = null } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const colors = palette ?? [
    REEF.orange, REEF.amber, REEF.gold, REEF.cream, REEF.pink, REEF.rose, REEF.magenta,
    REEF.lilac, REEF.blue, REEF.skyBlue, REEF.teal, REEF.green, REEF.red,
  ];
  const pick = () => {
    // Hue, saturation and lightness are jittered on top of the palette pick, for the same
    // reason the Park's flowers are: thirteen flat colours across a reef still reads as
    // thirteen kinds of plastic, however many of each there are.
    const c = new THREE.Color(colors[Math.floor(rng() * colors.length)]);
    // Biased toward MORE saturation and slightly darker, not symmetric about the palette
    // colour. A symmetric jitter desaturates on average, and under this world's very high
    // hemisphere fill -- which is physically right, light in water arrives from everywhere --
    // that lands the whole reef in pastel. Water strips saturation with distance too, so a
    // coral painted at its true colour arrives on screen as grey mud.
    c.offsetHSL(randomIn(rng, -0.03, 0.03), randomIn(rng, -0.02, 0.16), randomIn(rng, -0.11, 0.05));
    return c.getHex();
  };

  // How high the substrate is at a given distance from the middle.
  //
  // `mound` is what lets a garden be draped OVER a coral-bommie rather than laid on the
  // sand around its foot. Without it the reef came out as bare grey boulders standing in a
  // ring of coral, which is precisely backwards: on a real reef the rock is the skeleton of
  // the coral and there is barely a square inch of it uncovered.
  // The SAME function coralBommie builds its rock from, which is what keeps a draped garden
  // on its mound however irregular the mound is. `moundSeed` defaults to `seed - 1` because
  // every layout in this project pairs a mound with a garden one seed higher -- so records
  // written before this existed still land their colonies correctly.
  //
  // The small drop is deliberate: a colony seated exactly on the computed surface sits on a
  // knife edge, and two inches of overlap is invisible where two inches of gap is not.
  const rock = moundSeed ?? seed - 1;
  const substrate = (x, z) => (mound ? Math.max(0, moundHeight(x, z, radius, mound, rock) - 0.18) : 0);

  // Recursive antler branching, for staghorn and finger corals. Every tip is CAPPED -- a
  // branch that simply stops shows a ring straight down inside itself, and at smooth shading
  // that reads as a broken twig.
  // Three levels, not four. A fourth doubles the tube count for antler tips an inch across
  // on a colony a student never walks up to -- and this builder is placed 35 times.
  const branch = (x, y, z, dir, pitch, len, r, depth, color) => {
    if (depth > 2 || len < 0.16) return;
    const x2 = x + Math.sin(dir) * Math.cos(pitch) * len;
    const z2 = z + Math.cos(dir) * Math.cos(pitch) * len;
    const y2 = y + Math.sin(pitch) * len;
    parts.push({
      geometry: sweep([[x, y, z], [(x + x2) / 2, (y + y2) / 2, (z + z2) / 2], [x2, y2, z2]],
        [r, r * 0.86, r * 0.72], SEG_TWIG),
      color,
    });
    const spread = randomIn(rng, 0.4, 0.85);
    let grew = false;
    for (const turn of [-1, 1]) {
      if (depth < 2 && len * 0.6 >= 0.16) grew = true;
      branch(x2, y2, z2, dir + turn * spread, Math.min(1.45, pitch + randomIn(rng, 0.05, 0.3)),
        len * randomIn(rng, 0.6, 0.82), r * 0.7, depth + 1, color);
    }
    if (!grew) seaSolid(parts, ball(r * 0.74, 5), color, { pos: [x2, y2, z2] });
  };

  for (let i = 0; i < count; i++) {
    // sqrt for an even areal spread -- a plain uniform radius crowds everything into the
    // middle, which is exactly what a reef does NOT do.
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const y0 = substrate(x, z);
    // On the flank of a mound, a colony grows outward from the rock rather than straight up.
    // CAPPED HARD at about 17 degrees, though, and that cap does more work than the lean
    // does: left free to follow the real slope, plates and sponges out on a mound's flank
    // ended up at fifty-odd degrees, and a coloured slab tipped that far stops reading as
    // something growing and starts reading as litter dropped on the rock. Corals do lean,
    // but they always grow back toward the light.
    const slope = mound ? Math.min(0.30, Math.asin(THREE.MathUtils.clamp(d / radius, 0, 1)) * 0.30) : 0;
    const leanX = Math.sin(a) * slope;
    const leanZ = -Math.cos(a) * slope;
    const color = pick();
    const scale = height * randomIn(rng, 0.7, 1.35);
    // Plates and encrusting mats are dropped from a DRAPED garden. Both are essentially
    // flat, so on the flank of a mound they lie against the rock face and read as coloured
    // stickers pasted on it. On open sand, seen from above, they are two of the best shapes
    // here. Same colonies, opposite verdict, purely because of what they are seen against.
    const kinds = mound
      ? ['branch', 'brain', 'knob', 'tube', 'finger', 'knob', 'branch', 'whip', 'soft']
      : ['branch', 'plate', 'brain', 'knob', 'tube', 'mat', 'finger', 'mushroom', 'soft'];
    const kind = kinds[Math.floor(rng() * kinds.length)];

    if (kind === 'branch') {
      // Staghorn. Thick, because a thin one reads as a bare dead twig -- and the fix for
      // that was girth rather than more branches.
      branch(x, y0 + 0.12 * scale, z, rng() * 6.28, 1.15 - slope * 0.5, randomIn(rng, 0.55, 0.9) * scale, 0.16 * scale, 0, color);
    } else if (kind === 'plate') {
      // Table coral: a thin disc on a short trunk, which is the shape that catches the most
      // light in the least material -- the same reason a tree has a canopy. Built as a
      // shallow domed plate with a lifted rim and concentric growth ridges, because a flat
      // cylinder with a hard edge is a dropped paper plate.
      const r = randomIn(rng, 0.7, 1.4) * scale;
      seaSolid(parts, stub(0.15 * scale, 0.55 * scale, 8), color, { pos: [x, y0 + 0.28 * scale, z] });
      const g = solidSurface({
        nu: 26, nv: 4, closedU: true, axis: [0, 1, 0],
        point: (u, v) => {
          const ang = u * Math.PI * 2;
          const dd = v * r;
          // Slightly oval, and the rim lifts -- a real table coral's edge turns up.
          const wobble = 1 + Math.sin(ang * 3 + i) * 0.10;
          return [Math.sin(ang) * dd * wobble, Math.pow(v, 2.6) * r * 0.20, Math.cos(ang) * dd * wobble];
        },
        thick: (u, v) => 0.075 * scale * (1 - Math.pow(v, 3)) + 0.006,
      });
      seaSolid(parts, g, color, {
        pos: [x, y0 + 0.55 * scale, z],
        rot: [randomIn(rng, -0.16, 0.16) + leanZ, 0, randomIn(rng, -0.16, 0.16) - leanX],
      });
    } else if (kind === 'brain') {
      const r = randomIn(rng, 0.45, 0.95) * scale;
      seaSolid(parts, reefRock(r, { seed: seed + i * 7, detail: r > 0.7 ? 2 : 1, amount: 0.14, knob: 0.10, flatten: 0.72 }),
        color, { pos: [x, y0 + r * 0.46, z] });
    } else if (kind === 'knob') {
      const lobes = 3 + Math.floor(rng() * 4);
      for (let k = 0; k < lobes; k++) {
        const r = randomIn(rng, 0.16, 0.34) * scale;
        seaSolid(parts, ball(r, 7), color, {
          pos: [x + randomIn(rng, -0.4, 0.4) * scale, y0 + r * 0.9 + randomIn(rng, 0, 0.5) * scale, z + randomIn(rng, -0.4, 0.4) * scale],
        });
      }
    } else if (kind === 'tube') {
      // Tube sponges, each a real vase: an outer wall, an inner wall and a rim joining them,
      // so the cavity is a HOLE rather than a hollow-looking cylinder with a dark lid.
      const tubes = 2 + Math.floor(rng() * 4);
      for (let k = 0; k < tubes; k++) {
        const h = randomIn(rng, 0.7, 1.7) * scale;
        const r = randomIn(rng, 0.13, 0.22) * scale;
        const ox = x + randomIn(rng, -0.3, 0.3) * scale;
        const oz = z + randomIn(rng, -0.3, 0.3) * scale;
        const lean = [randomIn(rng, -0.2, 0.2) + leanZ, 0, randomIn(rng, -0.2, 0.2) - leanX];
        seaSolid(parts, new THREE.CylinderGeometry(r, r * 1.25, h, 10, 1, true), color, { pos: [ox, y0 + h / 2, oz], rot: lean });
        seaSolid(parts, new THREE.CylinderGeometry(r * 0.66, r * 0.82, h * 0.9, 10, 1, true), 0x4a382e,
          { pos: [ox, y0 + h * 0.5, oz], rot: lean });
        seaSolid(parts, new THREE.TorusGeometry(r * 0.83, r * 0.17, 5, 9), color,
          { pos: [ox, y0 + h - 0.01, oz], rot: [Math.PI / 2 + lean[0], 0, lean[2]] });
        seaSolid(parts, new THREE.CircleGeometry(r * 0.7, 10), 0x2b211b,
          { pos: [ox, y0 + h * 0.08, oz], rot: [-Math.PI / 2, 0, 0] });
      }
    } else if (kind === 'mat') {
      // An encrusting colony: a shallow DOME, not a disc. Built as a flat cylinder it reads
      // as a coloured puddle on the sand rather than as something growing.
      const r = randomIn(rng, 0.5, 1.1) * scale;
      seaSolid(parts, ball(r, 11), color, { pos: [x, y0 + r * 0.1, z], scale: [1, 0.32, 1] });
    } else if (kind === 'mushroom') {
      // Fungia -- a solitary mushroom coral, an oval domed disc lying free on the sand with
      // radial septa. Very common, very recognisable, and it is one closed solid.
      const r = randomIn(rng, 0.24, 0.42) * scale;
      const g = solidSurface({
        nu: 26, nv: 4, closedU: true, axis: [0, 1, 0],
        point: (u, v) => {
          const ang = u * Math.PI * 2;
          const dd = v * r;
          return [Math.sin(ang) * dd * 1.32, 0, Math.cos(ang) * dd];
        },
        // Septa: the radial ribs a fungia's surface is made of, as a ripple in thickness.
        thick: (u, v) => (r * 0.46 * Math.pow(Math.max(0, 1 - v * v), 0.7)) * (1 + Math.sin(u * Math.PI * 2 * 11) * 0.09) + 0.004,
      });
      seaSolid(parts, g, color, { pos: [x, y0 + r * 0.22, z], rot: [leanZ, rng() * 3, -leanX] });
    } else if (kind === 'whip') {
      // A sea whip: one tall unbranched rod that bows in the current. On a mound flank this
      // is the shape that reads best, because it stands clear of the rock instead of lying
      // against it.
      const h = randomIn(rng, 1.4, 2.6) * scale;
      const bend = randomIn(rng, -0.4, 0.4);
      chain(parts, color, [
        { p: [x, y0, z], r: 0.075 * scale },
        { p: [x + bend * h * 0.10, y0 + h * 0.4, z + bend * h * 0.06], r: 0.058 * scale },
        { p: [x + bend * h * 0.34, y0 + h * 0.75, z + bend * h * 0.22], r: 0.042 * scale },
        { p: [x + bend * h * 0.62, y0 + h, z + bend * h * 0.42], r: 0.020 * scale },
      ], { options: SEG_SMALL, detail: 8 });
    } else if (kind === 'soft') {
      // Soft coral: a fat translucent-looking trunk carrying a puffball of polyp lobes. It
      // is the growth form the first pass had none of, and it is half of what a Caribbean
      // reef actually looks like.
      const h = randomIn(rng, 0.5, 1.0) * scale;
      const r = randomIn(rng, 0.22, 0.38) * scale;
      chain(parts, color, [
        { p: [x, y0, z], r: r * 0.62 },
        { p: [x + leanX * h * 0.3, y0 + h * 0.55, z - leanZ * h * 0.3], r: r * 0.5 },
      ], { options: SEG_SMALL, detail: 7 });
      const lobes = 4 + Math.floor(rng() * 4);
      for (let k = 0; k < lobes; k++) {
        const la = rng() * Math.PI * 2;
        const ld = randomIn(rng, 0, r * 0.7);
        seaSolid(parts, ball(randomIn(rng, 0.5, 0.85) * r, 7), color, {
          pos: [x + Math.sin(la) * ld + leanX * h * 0.4, y0 + h * 0.72 + randomIn(rng, 0, r * 0.7), z + Math.cos(la) * ld - leanZ * h * 0.4],
          scale: [1, 0.86, 1],
        });
      }
    } else {
      const fingers = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < fingers; k++) {
        const h = randomIn(rng, 0.5, 1.1) * scale;
        const fx = x + randomIn(rng, -0.35, 0.35) * scale;
        const fz = z + randomIn(rng, -0.35, 0.35) * scale;
        chain(parts, color, [
          { p: [fx, y0, fz], r: 0.14 * scale },
          { p: [fx + randomIn(rng, -0.1, 0.1) + leanX * h * 0.5, y0 + h * 0.55, fz + randomIn(rng, -0.1, 0.1) - leanZ * h * 0.5], r: 0.11 * scale },
          { p: [fx + randomIn(rng, -0.2, 0.2) + leanX * h, y0 + h, fz + randomIn(rng, -0.2, 0.2) - leanZ * h], r: 0.07 * scale },
        ], { options: SEG_TWIG, detail: 6, capStart: false });
      }
    }
  }
  // `hide` rather than `stone`, and that is not a stretch: the relief kind is a wrapped
  // mosaic of cells with a crease between each pair, which is exactly what the corallites on
  // a coral's surface are. It reads as coral at arm's length where clumped grit reads as dirt.
  return group(mergedMesh(parts, { roughness: 0.80, ...relief('hide', { seed, repeat: 22, strength: 0.5 }) }));
}

// A big brain coral, as its own specimen.
//
// The meander is a MAP, not geometry -- and a near-white one, so that multiplying it against
// the flat colour leaves the colony's own hue intact and only darkens the valleys. Cutting
// real grooves into a boulder would multiply its triangle count by twenty for a pattern
// whose silhouette nobody can see anyway: the ridges on a real brain coral are about a
// centimetre apart on a three-foot boulder.
//
// What the rebuild changes is everything AROUND that: the form is a multi-lobed mass rather
// than one sphere, it is smooth-shaded at four times the subdivision, and the canvas now
// carries a fine corallite stipple under the meanders so the surface has two scales of
// detail rather than one.
export function brainCoral({ radius = 2.4, seed = 53, color = REEF.gold } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // Three overlapping lobes: a real brain coral is a hemisphere with a wavy top, and the
  // waviness is the growth pattern rather than erosion.
  seaSolid(parts, reefRock(radius, { seed, detail: 3, amount: 0.10, knob: 0.075, flatten: 0.66 }),
    color, { pos: [0, radius * 0.5, 0] });
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    const r = radius * randomIn(rng, 0.42, 0.62);
    seaSolid(parts, reefRock(r, { seed: seed + i * 17, detail: 2, amount: 0.12, knob: 0.08, flatten: 0.60 }),
      color, { pos: [Math.sin(a) * radius * 0.42, radius * randomIn(rng, 0.42, 0.66), Math.cos(a) * radius * 0.42] });
  }

  const maze = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // The fine scale first: the corallite stipple that sits under the meanders. Without it
    // the surface between two ridges is dead flat, and on a boulder a student walks up to
    // that is the largest smooth area on the model.
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const r = randomIn(rng, 1.2, 3.0);
      ctx.fillStyle = `rgba(150,124,86,${randomIn(rng, 0.06, 0.20).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Wandering parallel ridges, drawn FAT for the reason the Park's flower veins had to be:
    // a 2px line on a colony three feet across lands under one screen pixel and mips away.
    ctx.strokeStyle = 'rgba(88,64,38,0.85)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 30; i++) {
      ctx.lineWidth = randomIn(rng, 8, 15);
      ctx.beginPath();
      let y = (i / 30) * h + randomIn(rng, -5, 5);
      ctx.moveTo(-10, y);
      for (let x = 0; x <= w + 10; x += 22) {
        y += randomIn(rng, -11, 11);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      // A pale highlight along one side of each ridge. A groove is read almost entirely
      // from the light on the lip above it.
      ctx.strokeStyle = 'rgba(255,252,240,0.5)';
      ctx.lineWidth = randomIn(rng, 2, 4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(88,64,38,0.85)';
    }
  });
  maze.wrapS = THREE.RepeatWrapping;
  maze.wrapT = THREE.RepeatWrapping;
  maze.repeat.set(4, 3);
  return group(mesh(mergeColored(parts), standard({
    vertexColors: true, map: maze, bumpMap: maze, bumpScale: 0.9, roughness: 0.9,
  })));
}

// A gorgonian sea fan: a branching net that grows FLAT, across the current, because it feeds
// by filtering water that passes through it. Which is why one is always broadside to the
// prevailing flow, and why a layout should turn a group of them the same way.
//
// Two rebuild changes. Every branch tip is CAPPED, which is what lets the whole fan render
// FrontSide instead of DoubleSide -- the first pass showed a ring straight into the end of
// every one of a hundred and twenty twigs. And the net ANASTOMOSES: real gorgonian branches
// rejoin each other, and the cross-links are most of what makes it read as a mesh fine
// enough to strain plankton rather than as a shrub.
export function seaFan({ width = 5, height = 6, color = REEF.magenta, seed = 59 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const tint = new THREE.Color(color);
  const pale = tint.clone().offsetHSL(0, -0.12, 0.14).getHex();
  const polyp = tint.clone().offsetHSL(0.01, -0.45, 0.34).getHex();

  const nodes = [];
  const bow = (x) => Math.sin(x * 1.3) * 0.16;
  // Six levels, and the branches barely thin as they go. A gorgonian is a NET, not a shrub:
  // the first pass ran four levels of rapidly-thinning sticks and came out as a handful of
  // bare dead twigs.
  const grow = (x, y, angle, len, r, depth) => {
    if (depth > 5 || len < 0.12) return;
    const x2 = x + Math.sin(angle) * len;
    const y2 = y + Math.cos(angle) * len;
    parts.push({
      geometry: sweep([[x, y, bow(x)], [(x + x2) / 2, (y + y2) / 2, bow((x + x2) / 2)], [x2, y2, bow(x2)]],
        depth === 5 ? [r, r * 0.6, 0] : [r, r * 0.95, r * 0.90], SEG_TWIG),
      color: depth > 3 ? pale : color,
    });
    const spread = randomIn(rng, 0.34, 0.58);
    const childLen = len * randomIn(rng, 0.86, 0.99);
    nodes.push([x2, y2, r * 0.86, depth]);
    if (depth === 5 || childLen < 0.10) {
      // The twig ends at radius zero rather than at a capped stub. A gorgonian's tips do
      // taper to nothing, and sixty-four socket balls at the ends of sixty-four twigs cost
      // more than the whole net they finish.
      return;
    }
    grow(x2, y2, angle - spread, childLen, r * 0.88, depth + 1);
    grow(x2, y2, angle + spread, len * randomIn(rng, 0.84, 0.98), r * 0.88, depth + 1);
  };
  grow(0, 0.22, 0, height * 0.135, 0.075, 0);

  // ANASTOMOSES, and they are the difference between a sea fan and a small purple tree.
  //
  // Nothing about a branching recursion produces them: it can only ever divide, so what it
  // draws is a shrub with gaps between its limbs. A gorgonian's branches REJOIN, which is
  // what closes those gaps into a mesh fine enough to strain plankton out of the water -- and
  // that mesh is the entire reason the animal has the shape it has.
  //
  // Linking every node rather than only the tips is what makes it a net all the way down;
  // the first pass linked tips alone and produced a bush with a fringe.
  // Every candidate pair is collected FIRST and then shuffled, rather than being taken in
  // order. The recursion walks depth-first, so an in-order pass with any cap at all spends
  // the whole allowance on the first sub-branch it reaches -- which produced fans with one
  // corner meshed solid and the rest bare.
  const candidates = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.abs(nodes[i][3] - nodes[j][3]) > 1) continue;
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d > 0.08 && d < 0.95) candidates.push([i, j, rng()]);
    }
  }
  candidates.sort((a, b) => a[2] - b[2]);
  for (const [i, j] of candidates.slice(0, 58)) {
    const mx = (nodes[i][0] + nodes[j][0]) / 2;
    parts.push({
      geometry: sweep(
        [[nodes[i][0], nodes[i][1], bow(nodes[i][0])],
          [mx, (nodes[i][1] + nodes[j][1]) / 2, bow(mx)],
          [nodes[j][0], nodes[j][1], bow(nodes[j][0])]],
        [nodes[i][2] * 0.8, nodes[i][2] * 0.62, nodes[j][2] * 0.8], SEG_TINY
      ),
      color: pale,
    });
  }

  // The holdfast: a fan is glued to the rock by a disc, and without one it appears to be
  // balancing on its stem.
  seaSolid(parts, new THREE.CylinderGeometry(0.34, 0.44, 0.24, 12), REEF.rockPink, { pos: [0, 0.11, 0] });
  seaSolid(parts, sweep([[0, 0, 0], [0, 0.14, 0.01], [0, 0.26, 0.02]], [0.13, 0.10, 0.085], SEG_SMALL), color, {});

  const merged = mergeColored(parts);
  // Fitted to the requested envelope after the fact: a recursive shape's final extent is not
  // something the seed lets a caller predict, and a layout asking for a 5ft fan should get
  // one it can place against a 5ft gap.
  merged.computeBoundingBox();
  const size = merged.boundingBox.getSize(new THREE.Vector3());
  merged.scale(width / Math.max(0.1, size.x), height / Math.max(0.1, size.y), 1);
  // The polyps go on AFTER the fit, so they stay round rather than being stretched with the
  // net. A feeding gorgonian is fuzzy with white polyps and it is the first thing anybody
  // notices about one.
  const dressed = [{ geometry: merged, keepColor: true }];
  {
    const position = merged.attributes.position;
    // Every 90th vertex, not every 37th. A polyp is a 48-triangle bead and there are twelve
    // thousand vertices in a fitted net, so the fuzz was costing more than the net it sat on.
    for (let i = 0; i < position.count; i += 70) {
      if (rng() < 0.45) continue;
      seaSolid(dressed, ball(0.034, 6), polyp,
        { pos: [position.getX(i), position.getY(i), position.getZ(i)] });
    }
  }
  return group(mesh(mergeParts(dressed), standard({ vertexColors: true, roughness: 0.78 })));
}

// A sea anemone -- the clownfish's house, and the reason those fish are where they are.
//
// The tentacles are the whole prop, and what matters is that there are a LOT of them and
// that they are SLENDER. At sixty, thick enough to see individually, the crown came out as a
// bunch of orange matchsticks with white beads glued on -- each tentacle read as an object
// rather than the mass reading as an animal.
//
// The rebuild adds the two things a real anemone has that this did not: an ORAL DISC with a
// mouth in the middle of it, which is what the tentacles radiate from and the reason they
// are not just a lawn, and a column with vertical ridges rather than a smooth pot.
export function seaAnemone({ radius = 2.6, tentacles = 130, color = REEF.orange, tip = 0xf0d8c0, seed = 61 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const column = new THREE.Color(color).offsetHSL(0.01, -0.2, -0.12).getHex();
  const disc = new THREE.Color(color).offsetHSL(-0.02, 0.06, -0.06).getHex();
  // The tips are a pale peach rather than white. Pure white beads on 130 tentacles are the
  // brightest thing in the frame and the eye reads the crown as the beads, not as tentacles.
  const tipTone = new THREE.Color(tip).lerp(new THREE.Color(color), 0.34).getHex();

  // The column, mostly hidden under the crown, with the vertical ridges a real one has. An
  // anemone sits wedged in a crevice with only its disc showing, so this is deliberately
  // short and narrow -- built tall enough to see properly it reads as a plant pot with the
  // anemone standing in it.
  parts.push({
    geometry: bodySweep(
      [
        { z: 0.00, w: radius * 0.60, h: radius * 0.60 },
        { z: radius * 0.18, w: radius * 0.48, h: radius * 0.48 },
        { z: radius * 0.40, w: radius * 0.44, h: radius * 0.44 },
        { z: radius * 0.52, w: radius * 0.52, h: radius * 0.52 },
      ],
      { sides: 24, samples: 12 }
    ),
    color: column,
  });
  // Stand it up: bodySweep runs along Z and a column runs along Y.
  parts[parts.length - 1].geometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    seaSolid(parts, ball(radius * 0.05, 7), column, {
      pos: [Math.sin(a) * radius * 0.46, radius * 0.24, Math.cos(a) * radius * 0.46],
      scale: [1, 4.2, 1],
    });
  }
  // The oral disc: a slightly domed plate with a real slit mouth in the middle. The mouth is
  // what a student looks for once they know an anemone is an animal, and it is two solids.
  seaSolid(parts, ball(radius * 0.56, 20), disc, { pos: [0, radius * 0.50, 0], scale: [1, 0.42, 1] });
  seaSolid(parts, new THREE.TorusGeometry(radius * 0.115, radius * 0.045, 8, 16), disc,
    { pos: [0, radius * 0.60, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.6, 1] });
  seaSolid(parts, ball(radius * 0.11, 12), 0x53211d, { pos: [0, radius * 0.575, 0], scale: [1, 0.5, 0.42] });

  for (let i = 0; i < tentacles; i++) {
    // Golden-angle placement over the disc, so they never fall into visible rings.
    const a = i * 2.399963229728653;
    const d = radius * 0.16 + Math.sqrt((i + 0.5) / tentacles) * radius * 0.48;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const lean = (d / (radius * 0.62)) * randomIn(rng, 0.5, 1.1);
    // A very wide length range, and a sideways drift that grows along each tentacle.
    //
    // Both exist because of the same failure: at a narrow length range, radiating dead
    // straight, 130 tentacles put every pale tip on one smooth dome and the animal read as a
    // scrubbing brush. What a real anemone does is wave -- the tips are at every height and
    // every angle at once, and no two neighbours agree. Breaking up the tip surface is the
    // whole trick; the tentacles themselves barely matter.
    const len = radius * randomIn(rng, 0.34, 1.15);
    const dirX = d > 0.01 ? x / d : 0;
    const dirZ = d > 0.01 ? z / d : 1;
    const drift = randomIn(rng, -0.55, 0.55);
    const curl = randomIn(rng, -0.3, 0.55);
    const r0 = radius * randomIn(rng, 0.020, 0.030);
    const base = radius * 0.50;
    const along = (t) => [
      x + dirX * len * lean * t * 0.95 - dirZ * drift * len * t * t,
      base + len * (t * 1.05 - curl * t * t),
      z + dirZ * len * lean * t * 0.95 + dirX * drift * len * t * t,
    ];
    parts.push({ geometry: sweep([[x, base - r0, z], along(0.5), along(0.8), along(1)], [r0, r0 * 0.92, r0 * 0.80, r0 * 0.60], SEG_TWIG), color });
    // Pale swollen tips -- on a real anemone those are the stinging batteries, and they are
    // the single feature that stops the crown reading as a sea urchin. Detail SIX, not four:
    // at 4 width segments a sphere is SQUARE in cross-section, and 130 tips read as pale
    // cubes on sticks.
    seaSolid(parts, ball(r0 * 1.35, 7), tipTone, { pos: along(1) });
  }
  return group(mergedMesh(parts, { roughness: 0.58, ...relief('hide', { seed, repeat: 14, strength: 0.35 }) }));
}

// A cluster of barrel and tube sponges, standing proud of the reef.
//
// Each is a real VASE: an outer wall, an inner wall, a rim ring joining them and a floor
// down inside. That makes the cavity an actual hole in a closed solid rather than a
// cylinder with a dark disc stuck on top of it, and looking down into one is most of what
// makes a tube sponge recognisable. The outer wall is FLUTED, which every real one is.
export function tubeSponge({ count = 4, height = 3, color = REEF.orange, seed = 67 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const dark = new THREE.Color(color).offsetHSL(0.01, -0.30, -0.42);
  for (let i = 0; i < count; i++) {
    const h = height * randomIn(rng, 0.6, 1.15);
    const r = h * randomIn(rng, 0.16, 0.3);
    const a = rng() * Math.PI * 2;
    const d = randomIn(rng, 0, height * 0.8);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const lean = [randomIn(rng, -0.16, 0.16), 0, randomIn(rng, -0.16, 0.16)];
    const tint = new THREE.Color(color).offsetHSL(randomIn(rng, -0.02, 0.02), 0, randomIn(rng, -0.08, 0.08)).getHex();
    // Enough sides for the flutes to read. At 22 with nine flutes there are two sides per
    // flute, which is exactly Nyquist -- the ripple aliases away and the sponge renders as a
    // smooth traffic cone.
    const flutes = 8 + Math.floor(rng() * 5);
    const wall = 0.26 + rng() * 0.10;
    const g = solidSurface({
      nu: flutes * 4, nv: 7, closedU: true, axis: null,
      point: (u, v) => {
        const ang = u * Math.PI * 2;
        // A real tube sponge is a VASE: pinched at the holdfast, waisted, and flaring to the
        // lip. A straight cylinder is a drainpipe.
        const prof = 0.60 + Math.pow(v, 1.15) * 0.62 - Math.sin(v * Math.PI) * 0.14;
        const rr = r * prof * (1 + Math.cos(ang * flutes) * 0.15);
        return [Math.sin(ang) * rr, v * h, Math.cos(ang) * rr];
      },
      thick: (u, v) => r * wall * (1 - Math.pow(v, 2.4) * 0.55),
    });
    parts.push({
      geometry: g, color: tint,
      position: [x, 0, z], rotation: lean,
      // The cavity has to be DARKER than the outside, and inner and outer wall are two faces
      // of one closed solid -- so this is a per-vertex job, not a per-part one. Without it a
      // sponge is a tube whose inside is the same bright orange as its outside, and looking
      // down into one shows nothing at all.
      tint: (c, px, py, pz) => {
        const v = THREE.MathUtils.clamp(py / h, 0, 1);
        const prof = 0.60 + Math.pow(v, 1.15) * 0.62 - Math.sin(v * Math.PI) * 0.14;
        if (Math.hypot(px, pz) < r * prof) c.lerp(dark, 0.85);
      },
    });
    // The floor of the cavity, well down inside: a sponge's spongocoel is the darkest thing
    // on the reef.
    seaSolid(parts, ball(r * 0.7, 9), dark.getHex(), { pos: [x, h * 0.20, z], rot: lean, scale: [1, 0.4, 1] });
  }
  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.92, ...relief('soil', { seed, repeat: 6, strength: 0.62 }),
  })));
}

// A giant clam, wedged into the reef with its mantle out.
//
// The MANTLE is the animal: an iridescent blue-green frill between the shells, packed with
// the algae the clam farms for food. The shell is just the box it lives in, and building
// only the shell gives you a rock.
//
// Both halves are rebuilt. Each valve is now a fluted BOWL with a wall of real thickness
// and a visible rim -- the first pass used a bare hemisphere, which is open at the cut and
// showed the inside of the shell as a hole from anywhere below the gape. And the mantle is
// one wavy cushion filling the gape rather than fifteen separate blobs, with the spotted
// pattern a real Tridacna carries applied per vertex.
export function giantClam({ size = 2.6, seed = 71, mantle = 0x2fa0a8 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const shell = 0xcdbfa2;
  const shellDark = 0xa2947a;
  const GAPE = size * 0.44; // how far apart the two rims stand
  const FLUTES = 5; // Tridacna has four to six big radial folds, and they are its signature

  for (const half of [-1, 1]) {
    // A valve: a flattened, fluted bowl. `pMax` past a right angle brings the rim slightly
    // over the equator, which is what gives a clam its overhanging lip.
    const g = solidSurface({
      nu: 34, nv: 7, closedU: true, axis: null,
      point: (u, v) => {
        const ang = u * Math.PI * 2;
        const p = v * Math.PI * 0.56;
        const rr = size * 0.50 * (1 + Math.cos(ang * FLUTES) * 0.20);
        return [
          Math.sin(p) * rr * Math.cos(ang) * 1.06,
          Math.cos(p) * rr * 0.48,
          Math.sin(p) * rr * Math.sin(ang) * 0.80,
        ];
      },
      thick: () => size * 0.030,
    });
    seaSolid(parts, g, half > 0 ? shell : shellDark, {
      pos: [0, size * 0.30 + half * GAPE * 0.5, 0],
      rot: [half > 0 ? 0.16 : Math.PI - 0.16, 0, 0],
    });
  }

  // The mantle: a wavy cushion bulging out of the gape, with the folds a real one has. It
  // sits PROUD of the shell rims -- tucked inside, which is where it goes if you build it
  // from the shell's own centre, the clam reads as a plain white boulder with a couple of
  // coloured flecks on it, and the one feature that makes this animal worth a placard is
  // invisible from standing height.
  const MANTLE_Y = size * 0.30;
  parts.push({
    geometry: solidSurface({
      nu: 30, nv: 12, axis: [0, 1, 0],
      point: (u, v) => {
        const x = (u - 0.5) * size * 1.20;
        const z = (v - 0.5) * size * 0.78;
        const across = Math.cos((u - 0.5) * Math.PI);
        const along = Math.cos((v - 0.5) * Math.PI);
        return [x, MANTLE_Y + size * 0.16 * across * along, z];
      },
      thick: (u, v) => {
        const across = Math.pow(Math.max(0, Math.cos((u - 0.5) * Math.PI)), 0.6);
        const along = Math.pow(Math.max(0, Math.cos((v - 0.5) * Math.PI)), 0.7);
        // The wavy folds: a ripple across the gape, which is what a Tridacna mantle's edge
        // does and the reason it is never a smooth cushion.
        // Deep enough to STAND PROUD of both shell rims. At the depth the gape itself is,
        // the frill fills the slot and shows as a coloured line -- and the one feature that
        // makes this animal worth a placard is then invisible from standing height.
        return size * 0.30 * across * along * (1 + Math.sin(u * Math.PI * 2 * 4.5) * 0.24) + 0.004;
      },
    }),
    color: mantle,
  });
  // The excurrent siphon: the one dark opening in the mantle, and the thing a clam shuts
  // when a shadow passes over it.
  seaSolid(parts, ball(size * 0.085, 12), 0x123038, {
    pos: [size * 0.16, MANTLE_Y + size * 0.20, -size * 0.06], scale: [1, 0.7, 1.3],
  });
  // A byssal skirt of coralline crust where the shell meets the rock -- a clam this size has
  // been sitting in the same spot for fifty years and the reef grows over its base.
  crustRock(parts, rng, { at: [0, size * 0.12, 0], radius: size * 0.42, count: 9, tones: [REEF.rockPink, REEF.rockPurple, REEF.algae] });

  return group(seaMesh(parts, {
    tint: (c, x, y, z) => {
      // The mantle's pattern, and it applies only to the cushion. A Tridacna mantle is an
      // extraordinary mosaic of spots and wavy stripes, and it is the single thing anybody
      // remembers about the animal -- flat teal is a swimming-pool tile.
      if (y < MANTLE_Y + size * 0.06) return;
      const spots =
        Math.sin(x * 26 / size) * Math.cos(z * 31 / size) +
        Math.sin((x + z) * 19 / size + 1.7) * 0.8 +
        Math.cos(x * 44 / size - z * 37 / size) * 0.5;
      c.offsetHSL(spots * 0.020, spots * 0.05, spots * 0.085);
    },
    material: { roughness: 0.5, ...relief('stone', { seed, repeat: 5, strength: 0.5 }) },
  }));
}

// A long-spined sea urchin (Diadema), which is the one that lives on a Caribbean reef.
//
// Spines are oriented by quaternion from the body's own surface normal, the same trick the
// octopus's suckers use. Two things changed: they are six-sided tapered tubes with rooted
// bases rather than four-sided cones -- at four sides a cone is a BLADE, and fifty blades
// radiating from a ball is a caltrop -- and the BANDING comes free from the position tint,
// since a function of distance from the centre paints concentric rings, which on radiating
// spines is exactly what a Diadema's banding is.
export function seaUrchin({ radius = 0.65, spines = 52, seed = 73, color = 0x2b2230 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  // The test, with the five ambulacral rows of tubercles a real one has.
  seaSolid(parts, ball(radius, 16), color, { pos: [0, radius * 0.85, 0], scale: [1, 0.78, 1] });
  for (let i = 0; i < 20; i++) {
    const a = (i % 5) * (Math.PI * 2 / 5) + Math.floor(i / 5) * 0.11;
    const t = (Math.floor(i / 5) / 6) * 1.5 - 0.2;
    const y = Math.cos(t);
    const r = Math.sin(t);
    dome(parts, 0x554860, {
      radius: radius * 0.10, height: radius * 0.05,
      at: [Math.sin(a) * r * radius, radius * 0.85 + y * radius * 0.78, Math.cos(a) * r * radius],
      detail: 7, sink: 0.5,
    });
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spines; i++) {
    // Uniform over the sphere: sampling cos(phi) avoids the dense clump at the pole that
    // naive uniform-angle sampling gives.
    const theta = rng() * Math.PI * 2;
    const y = rng() * 1.7 - 0.5;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const dir = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
    const len = radius * randomIn(rng, 1.5, 2.9);
    const root = new THREE.Vector3(dir.x * radius * 0.72, radius * 0.85 + dir.y * radius * 0.62, dir.z * radius * 0.72);
    const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const m = new THREE.Matrix4().compose(root, q, new THREE.Vector3(1, 1, 1));
    // A real spine tapers to a needle and is hollow-looking near the base. Ending at radius
    // 0 closes it without a cap, which is right here and wrong for a limb.
    const g = taperedTube(
      [[0, 0, 0], [0, len * 0.45, 0], [0, len * 0.8, 0], [0, len, 0]],
      [radius * 0.052, radius * 0.038, radius * 0.024, 0],
      { tubularSegments: 3, radialSegments: 6 }
    );
    applyMatrix(g, m);
    parts.push({ geometry: g, color: rng() < 0.25 ? 0x50435c : color });
    // No base ball: the root is set at 0.72 of the test's radius, which is INSIDE the test at
    // every bearing, so the tube's open wide end is already buried in solid geometry. Fifty
    // spines' worth of socket balls cost more than the fifty spines did.
  }
  return group(seaMesh(parts, {
    tint: (c, x, y, z) => {
      const d = Math.hypot(x, y - radius * 0.85, z);
      // Banding, as rings at a fixed spacing outward from the animal's centre.
      const band = Math.sin(d * (11 / radius));
      if (band > 0.25) c.offsetHSL(0, -0.1, 0.16 * band);
    },
    material: { roughness: 0.42 },
  }));
}

// A sea cucumber, lying on the sand doing what it does: eating the sand.
//
// Two changes worth having. Its body is FLAT-BOTTOMED and domed on top, which is what a sea
// cucumber lying on the seabed actually is and what a round sweep flattened by a scale
// factor can never be -- bodySweep gives the section its own shape at every station. And it
// has the ring of branched feeding TENTACLES at its mouth, which is the field mark: without
// them a sea cucumber is a bumpy sausage, and with them it is obviously an animal facing a
// direction and doing something.
export function seaCucumber({ length = 2.4, seed = 79, color = 0x7a5636 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const detail = [];
  const r = length * 0.17;
  const pale = new THREE.Color(color).offsetHSL(0.02, -0.14, 0.18).getHex();

  parts.push({
    geometry: bodySweep(
      [
        { z: -length * 0.50, w: r * 0.30, hUp: r * 0.34, hDn: r * 0.16, y: r * 0.30 },
        { z: -length * 0.34, w: r * 0.72, hUp: r * 0.74, hDn: r * 0.40, y: r * 0.46 },
        { z: -length * 0.10, w: r * 0.98, hUp: r * 0.92, hDn: r * 0.50, y: r * 0.54 },
        { z: length * 0.14, w: r * 1.00, hUp: r * 0.94, hDn: r * 0.50, y: r * 0.54 },
        { z: length * 0.34, w: r * 0.82, hUp: r * 0.80, hDn: r * 0.44, y: r * 0.50 },
        { z: length * 0.46, w: r * 0.52, hUp: r * 0.52, hDn: r * 0.30, y: r * 0.42 },
        { z: length * 0.52, w: r * 0.30, hUp: r * 0.30, hDn: r * 0.20, y: r * 0.38 },
      ],
      { sides: 20, samples: 30, round: 1.15 }
    ),
    color,
  });
  // Papillae -- the soft spikes down its back, which is the whole difference between a sea
  // cucumber and a sausage.
  for (let i = 0; i < 26; i++) {
    const t = randomIn(rng, 0.06, 0.92);
    const across = randomIn(rng, -0.75, 0.75);
    const z = (t - 0.5) * length;
    const prof = Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.92);
    const rr = r * (0.32 + prof * 0.66);
    spike(parts, pale, {
      length: r * randomIn(rng, 0.4, 0.8), radius: r * 0.13, sides: 5,
      at: [across * rr, r * 0.5 + Math.sqrt(Math.max(0, 1 - across * across)) * rr * 0.88, z],
      rot: [randomIn(rng, -0.3, 0.3), 0, across * 0.95],
    });
  }
  // Tube feet: three rows of stubby pale feet along the flat underside. Only the outer rows
  // show from standing height, and they are what the animal walks on.
  for (let i = 0; i < 22; i++) {
    const t = 0.1 + (i % 11) / 11 * 0.8;
    const side = i < 11 ? -1 : 1;
    const z = (t - 0.5) * length;
    const prof = Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.92);
    seaSolid(parts, ball(r * 0.09, 6), pale, { pos: [side * r * (0.30 + prof * 0.60), r * 0.11, z], scale: [1, 0.7, 1] });
  }
  // The feeding crown: ten branched tentacles round the mouth at the front, mopping the sand.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const out = r * 0.30;
    const bx = Math.sin(a) * out;
    const by = r * 0.46 + Math.cos(a) * out * 0.7;
    chain(detail, pale, [
      { p: [bx * 0.5, r * 0.48, length * 0.50], r: r * 0.075 },
      { p: [bx, by, length * 0.58], r: r * 0.055 },
    ], { options: SEG_TINY, detail: 7, capStart: false, capEnd: false });
    for (const turn of [-1, 1]) {
      seaSolid(detail, ball(r * 0.085, 6), pale, {
        pos: [bx + Math.sin(a + turn * 0.9) * r * 0.11, by + Math.cos(a + turn * 0.9) * r * 0.09, length * 0.63],
        scale: [1, 1, 1.3],
      });
    }
  }
  return group(...sized([
    seaMesh(parts, {
      material: {
        roughness: 0.85,
        map: mottleTexture(seed, { spots: 70, min: 0.03, max: 0.07, floor: 0.5, repeat: [6, 3] }),
      },
    }),
    seaMesh(detail, { material: { roughness: 0.6 } }),
  ], 1));
}

// Seagrass or a stand of kelp, depending on `height`. Blades lean off a common bearing, so a
// bed reads as bending in one current rather than as grass on a lawn.
//
// The blades are now RIBBONS with capped tips at a real width, and they render FrontSide.
// The first pass swept them at four radial sides, which makes a flattened tube a DIAMOND in
// cross-section -- the same mistake Dinosaur Island's fronds made -- and then needed
// DoubleSide to hide the open end of every one of sixty.
export function seagrassPatch({ radius = 5, count = 60, height = 2.2, seed = 83, color = 0x4e7a3c, drift = 0.5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const bearing = randomIn(rng, 0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const h = height * randomIn(rng, 0.6, 1.4);
    const sway = drift * randomIn(rng, 0.6, 1.4);
    const bx = Math.sin(bearing) * sway * h;
    const bz = Math.cos(bearing) * sway * h;
    const tint = new THREE.Color(color).offsetHSL(randomIn(rng, -0.03, 0.03), randomIn(rng, -0.1, 0.1), randomIn(rng, -0.12, 0.12)).getHex();
    const g = sweep(
      [[x, 0, z], [x + bx * 0.2, h * 0.45, z + bz * 0.2], [x + bx * 0.6, h * 0.8, z + bz * 0.6], [x + bx, h, z + bz]],
      [h * 0.055, h * 0.052, h * 0.044, h * 0.026],
      { tubularSegments: 3, radialSegments: 6 }
    );
    seaSolid(parts, g, tint, { scale: [1, 1, 0.26], about: [x, 0, z], rot: [0, rng() * Math.PI, 0] });
    // The tip, capped at a real width. A blade that tapers to nothing reads as a needle.
    seaSolid(parts, ball(h * 0.027, 6), tint, {
      pos: [x + bx, h, z + bz], scale: [1, 1.4, 0.3], rot: [0, rng() * Math.PI, 0],
    });
  }
  return group(mergedMesh(parts, { roughness: 0.78 }));
}

// ---------------------------------------------------------------------------
// Fish
// ---------------------------------------------------------------------------

// Species presets. `bands` are z positions in the fish's own unit-length frame.
const FISH = {
  clownfish: { body: 0xe2661d, belly: 0xea9152, fin: 0xdc5a18, trim: 0x17120f, band: 0xf4efe2,
    bands: [0.30, 0.00, -0.28], tail: 'fan', deep: 1.15 },
  tang: { body: 0x2b5cc0, belly: 0x3d72d4, fin: 0x2b5cc0, trim: 0x0e1a33, tailColor: 0xe8c53a,
    bands: [], tail: 'fork', deep: 1.35 },
  anthias: { body: 0xe2685f, belly: 0xf0a892, fin: 0xd8a03c, trim: 0xba4038, bands: [], tail: 'fork', deep: 1.1 },
  yellow: { body: 0xe6bd2b, belly: 0xf2d762, fin: 0xe6bd2b, trim: 0xa8830f, bands: [], tail: 'fan', deep: 1.4 },
  damsel: { body: 0x2ea6c6, belly: 0x63cbdd, fin: 0x2ea6c6, trim: 0x155f78, bands: [], tail: 'fork', deep: 1.15 },
  butterfly: { body: 0xf0e2ae, belly: 0xf8f1d8, fin: 0xe8c53a, trim: 0x2a2520,
    bands: [0.34, -0.12], band: 0x2a2520, tail: 'fan', deep: 1.5 },
};

// The body's half-depth at a point along the fish, so a band can be sized to hug it. Kept as
// one function because the sweep's stations and the bands have to agree exactly -- a band
// sized off the nearest station rather than the interpolated value hangs off the body like a
// loose bangle, which is the mistake the stomach's rugae made.
const FISH_STATIONS = [
  { z: -0.46, w: 0.012, hUp: 0.016, hDn: 0.014 },
  { z: -0.34, w: 0.030, hUp: 0.058, hDn: 0.052 },
  { z: -0.20, w: 0.056, hUp: 0.118, hDn: 0.102 },
  { z: -0.04, w: 0.078, hUp: 0.176, hDn: 0.150 },
  { z: 0.12, w: 0.086, hUp: 0.196, hDn: 0.160 },
  { z: 0.26, w: 0.082, hUp: 0.172, hDn: 0.140 },
  { z: 0.38, w: 0.062, hUp: 0.118, hDn: 0.102 },
  { z: 0.46, w: 0.034, hUp: 0.062, hDn: 0.058 },
  { z: 0.50, w: 0.011, hUp: 0.017, hDn: 0.017 },
];
const FISH_Z = FISH_STATIONS.map((s) => s.z);
const FISH_W = FISH_STATIONS.map((s) => s.w);
const FISH_UP = FISH_STATIONS.map((s) => s.hUp);
function fishAtZ(z, channel) {
  // Invert the spline crudely by sampling: it is monotonic in z and this runs a handful of
  // times per species, once, because the templates are cached.
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const err = Math.abs(splineAt(FISH_Z, t) - z);
    if (err < bestErr) { bestErr = err; best = t; }
  }
  return Math.max(0.004, splineAt(channel, best));
}

// One fish, authored at unit length. The parts are built ONCE per species and cached, then
// cloned and matrix-placed per fish -- cloning a finished swept surface is far cheaper than
// re-sweeping it, and a school of eighteen used to rebuild eighteen identical bodies.
const FISH_TEMPLATES = new Map();
function fishTemplate(species) {
  if (FISH_TEMPLATES.has(species)) return FISH_TEMPLATES.get(species);
  const f = FISH[species] ?? FISH.clownfish;
  const list = [];

  // The body: laterally compressed, deeper above the axis than below, and a plate at the
  // shoulder narrowing to a rod at the peduncle. That change of section IS a reef fish.
  list.push({
    geometry: bodySweep(
      FISH_STATIONS.map((s) => ({ z: s.z, w: s.w, hUp: s.hUp * f.deep, hDn: s.hDn * f.deep })),
      { sides: 11, samples: 13, round: 1.08 }
    ),
    color: f.body,
  });
  // Countershading as a pale belly wedge sunk inside the body -- a fish is read as
  // three-dimensional almost entirely from this under a single overhead sun.
  seaSolid(list, ball(1, 7), f.belly, { pos: [0, -0.075 * f.deep, 0.05], scale: [0.070, 0.10 * f.deep, 0.30] });

  for (const z of f.bands) {
    const w = fishAtZ(z, FISH_W);
    const hUp = fishAtZ(z, FISH_UP) * f.deep;
    // The white bar, with a dark edge either side -- which is what a clownfish's bands
    // actually are, and painting the white alone loses most of the contrast.
    seaSolid(list, ball(1, 12), f.band ?? 0xf4efe2, { pos: [0, 0, z], scale: [w * 1.06, hUp * 1.10, 0.048] });
    for (const edge of [-1, 1]) {
      seaSolid(list, ball(1, 9), f.trim, { pos: [0, 0, z + edge * 0.055], scale: [w * 1.05, hUp * 1.09, 0.016] });
    }
  }

  // Fins as foils. A reef fish's are genuinely thin, so the thickness is small -- but a
  // closed foil still has a silhouette edge-on, where a flat plate disappears.
  const fin = (ribs, color, options) => list.push({ geometry: finFoil(ribs, { nu: 4, nv: 3, ...options }), color });
  // Caudal.
  if (f.tail === 'fork') {
    for (const lobe of [1, -1]) {
      fin([
        { le: [0, lobe * 0.01, -0.36], te: [0, lobe * 0.01, -0.46], t: 0.014 },
        { le: [0, lobe * 0.14, -0.44], te: [0, lobe * 0.10, -0.56], t: 0.011 },
        { le: [0, lobe * 0.25, -0.52], te: [0, lobe * 0.22, -0.60], t: 0.003 },
      ], f.tailColor ?? f.fin, { nu: 4, nv: 3 });
    }
  } else {
    fin([
      { le: [0, 0.00, -0.36], te: [0, 0.00, -0.48], t: 0.015 },
      { le: [0, 0.00, -0.44], te: [0, 0.00, -0.60], t: 0.012 },
      { le: [0, 0.00, -0.50], te: [0, 0.00, -0.66], t: 0.003 },
    ], f.tailColor ?? f.fin, { nu: 6, nv: 3, axis: [0, 1, 0] });
    // A fan tail is a round paddle, so it is built as a vertical sheet instead: two ribs in
    // the XY plane would give a rod. This one is a disc standing on the body's own plane.
    list.pop();
    list.push({
      geometry: solidSurface({
        nu: 7, nv: 3, axis: [1, 0, 0],
        point: (u, v) => {
          const a = (u - 0.5) * 2.1;
          const rr = 0.10 + v * 0.16;
          return [0, Math.sin(a) * rr * 1.25, -0.36 - Math.cos(a) * rr * 0.55 - v * 0.10];
        },
        thick: (u, v) => 0.016 * (1 - v * 0.85) + 0.002,
      }),
      color: f.tailColor ?? f.fin,
    });
  }
  // Dorsal: a long low sail with the spiny front a reef fish has.
  list.push({
    geometry: solidSurface({
      nu: 7, nv: 2, axis: [1, 0, 0],
      point: (u, v) => {
        const z = 0.30 - u * 0.58;
        const back = fishAtZ(z, FISH_UP) * f.deep;
        const crest = (0.055 + Math.sin(Math.min(1, u * 1.3) * Math.PI) * 0.075) * v;
        return [0, back * 0.94 + crest, z];
      },
      thick: (u, v) => 0.014 * (1 - v * 0.8) + 0.002,
    }),
    color: f.fin,
  });
  // Anal fin, mirroring it underneath and shorter.
  list.push({
    geometry: solidSurface({
      nu: 5, nv: 2, axis: [1, 0, 0],
      point: (u, v) => {
        const z = -0.02 - u * 0.30;
        const under = fishAtZ(z, FISH_UP) * f.deep * 0.82;
        const crest = (0.04 + Math.sin(Math.min(1, u * 1.4) * Math.PI) * 0.05) * v;
        return [0, -(under * 0.94 + crest), z];
      },
      thick: (u, v) => 0.013 * (1 - v * 0.8) + 0.002,
    }),
    color: f.fin,
  });
  for (const side of [-1, 1]) {
    // Pectoral, held out from the flank.
    fin([
      { le: [side * 0.045, -0.010, 0.20], te: [side * 0.040, -0.030, 0.10], t: 0.012 },
      { le: [side * 0.095, -0.055, 0.17], te: [side * 0.085, -0.075, 0.07], t: 0.009 },
      { le: [side * 0.130, -0.090, 0.12], te: [side * 0.122, -0.100, 0.06], t: 0.002 },
    ], f.fin, { axis: [0, 1, 0] });
    // The eye, as a real ball set into the head with a bright ring -- a fish's eye is huge
    // relative to its head and it is the first thing the eye finds on one.
    seaSolid(list, ball(0.040, 7), 0xf2ede0, { pos: [side * 0.058, 0.048, 0.345] });
    seaSolid(list, ball(0.028, 6), f.trim, { pos: [side * 0.072, 0.048, 0.352] });
    // The operculum: the gill cover's trailing edge, as a thin crease. Two solids, and it is
    // what turns the front third of the body into a head.
    seaSolid(list, ball(0.10, 6), f.trim, {
      pos: [side * 0.052, 0.010, 0.255], rot: [0, side * 0.3, 0], scale: [0.10, 1.05, 0.05],
    });
  }
  // The mouth: a small dark crease at the snout.
  seaSolid(list, ball(0.030, 6), 0x3a2a20, { pos: [0, -0.012, 0.475], scale: [1.1, 0.5, 0.6] });

  FISH_TEMPLATES.set(species, list);
  return list;
}

// One placement matrix for a fish, given its position and the bearing it is swimming on.
function fishAt(x, y, z, yaw, pitch, size) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')),
    new THREE.Vector3(size, size, size)
  );
}

function placeFish(list, species, base) {
  for (const part of fishTemplate(species)) {
    const geometry = part.geometry.clone();
    applyMatrix(geometry, base);
    list.push({ geometry, color: part.color });
  }
}

// A shoal, merged into ONE mesh however many fish are in it.
//
// The mesh is what makes this affordable: a reef needs fish everywhere, and a dozen fish at
// three draw calls apiece would cost more than the shark, the octopus and the eel put
// together. `length` is the real length of one fish in feet.
//
// The origin sits at the BOTTOM of the shoal's cloud, so a layout's `y` reads as "clear
// water underneath" rather than as "centre height", which is what a person means when they
// say the fish are eight feet up.
export function reefFishSchool({
  species = 'tang', count = 9, length = 0.9, radius = 4, rise = 3.5, seed = 89, heading = 0, scatter = 0.5,
} = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    // Fish in a shoal point roughly the same way, and the small spread is what stops it
    // reading as a rack of identical models: a perfectly aligned school looks stamped, and a
    // randomly aligned one looks like a fish tank after a fight.
    const yaw = heading + randomIn(rng, -scatter, scatter);
    const pitch = randomIn(rng, -0.22, 0.22);
    const size = length * randomIn(rng, 0.82, 1.18);
    placeFish(parts, species, fishAt(Math.sin(a) * d, rng() * rise + length * 0.6, Math.cos(a) * d, yaw, pitch, size));
  }
  return group(mergedMesh(parts, { roughness: 0.34 }));
}

// Clownfish, which is a different placement problem from a shoal: they never leave their
// anemone, so they hang in a tight ball around one spot at anemone height, most of them
// facing inward toward it.
export function clownfishSchool({ count = 7, radius = 2.4, height = 2.2, seed = 97, length = 0.62 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + randomIn(rng, -0.4, 0.4);
    const d = radius * randomIn(rng, 0.45, 1.0);
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    // Facing roughly inward and downward, the way they hover over the tentacles.
    const yaw = Math.atan2(-x, -z) + randomIn(rng, -0.7, 0.7);
    placeFish(parts, 'clownfish',
      fishAt(x, height * randomIn(rng, 0.55, 1.35), z, yaw, randomIn(rng, -0.4, 0.15), length * randomIn(rng, 0.78, 1.2)));
  }
  return group(mergedMesh(parts, { roughness: 0.34 }));
}

// ---------------------------------------------------------------------------
// Being under water
// ---------------------------------------------------------------------------
//
// The four props below carry no information and teach nothing. They are here because
// without them this world is a blue field with fish standing in it: what makes water read
// as WATER is that it is a volume with a lid, that light arrives through that lid in
// visible beams, that things drift in it, and that bubbles go up. Every one of them is
// built to cost almost nothing, because none of them is what a student came to look at.

// The surface, seen from below -- the ceiling of the world.
//
// DELIBERATELY OPAQUE, and that is the interesting decision. The instinct is to make water
// translucent, but from beneath, a wind-rippled surface is a mirror: it reflects the reef
// back down and you cannot see through it except at the very steepest angles. An opaque
// plane is therefore both more accurate AND free, where a transparent one at this size
// would be the single most expensive object in the app.
//
// castShadow is off, or the sun would be sealed out of the entire world -- the same trap
// the museum's skylight and the library's lantern roof each hit.
//
// TWO REBUILD CHANGES, both about the same failure: the first pass was a flat plane
// carrying one high-contrast caustic tile at repeat 18, and from the sea floor it read as
// LACE WALLPAPER -- an obviously repeating doily stretched over the sky.
//
//  * The plane is now DISPLACED by its own swell. A ceiling with no relief is a painted lid
//    whatever is printed on it; a few thousand triangles of real wave gives the light
//    something to break across and gives the surface a horizon that moves.
//  * The caustics are multi-scale and much softer. Real caustics are a web of bright lines
//    over a mid-blue field with cells of visibly DIFFERENT sizes, and the brightness varies
//    slowly across the surface. One frequency family at full contrast is a net.
export function waterSurface({ size = 360, height = 46, seed = 101, tint = 0x2f8fbe } = {}) {
  const caustics = canvasTexture(1024, 1024, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    const data = image.data;
    const base = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.18);
    // CONTRAST IS THE WHOLE PROBLEM, not the pattern. A caustic web IS a net of bright lines,
    // and drawn at full strength that is exactly what a ceiling of it reads as: lace
    // wallpaper stretched over the sky. Thirty feet of water diffuses it into a soft dapple,
    // so the highlight only ever sits a little way above the water colour and the sheet
    // survives being the largest single surface a student ever looks at.
    const lit = new THREE.Color(0xa9d8ee);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Every frequency is an INTEGER multiple of 2*PI/size, which is what makes the sheet
        // tile -- a caustic pattern with a visible seam draws a straight line across the sky.
        const u = (x / w) * Math.PI * 2;
        const v = (y / h) * Math.PI * 2;
        //
        // Wave trains combined with MIN, not a weighted sum. The sum gives parallel bands --
        // the surface came out looking combed -- because the strongest train dominates
        // everywhere. Taking the minimum lights a pixel wherever ANY train is at a node, so
        // the families of bright lines overlap into the closed cellular web a real caustic is.
        const a = Math.abs(Math.sin(u * 3 + Math.sin(v * 2) * 1.7));
        const b = Math.abs(Math.sin(v * 3 + Math.sin(u * 2) * 1.7));
        const c = Math.abs(Math.sin((u + v) * 2 + Math.sin((u - v) * 2) * 1.3));
        const fine = Math.min(
          Math.abs(Math.sin(u * 7 + Math.sin(v * 5) * 1.2)),
          Math.abs(Math.sin(v * 7 - Math.sin(u * 5) * 1.2))
        );
        const ridge = Math.min(a, Math.min(b, c));
        //
        // BROAD AND SOFT, not a net of thin bright lines. This is the one thing the first
        // pass got badly wrong, and the symptom was that the whole sky read as LACE
        // WALLPAPER: a high exponent narrows every bright band into a hairline, and a
        // surface covered in hairlines is a textile, not water. Sharp caustics happen in
        // three feet of water; at thirty the pattern has diffused into soft dapple, so the
        // exponent is low, the fine family is only a whisper on top, and the whole thing
        // only ever gets two thirds of the way to the highlight colour.
        //
        // The low-frequency "drift" that used to sit here went the same way. It varied over
        // one tile width, which is exactly the scale that tells the eye where the repeat is.
        // The exponent NARROWS the bright regions into lines, which is right -- taken the
        // other way (the second attempt) most of the sheet goes bright and the pattern
        // inverts into dark speckles on white, which reads as netting rather than as light.
        const light = Math.pow(Math.max(0, 1 - ridge), 3.4) * 0.86 + Math.pow(Math.max(0, 1 - fine), 4.5) * 0.22;
        const k = Math.min(1, light);
        const i = (y * w + x) * 4;
        data[i] = Math.round((base.r + (lit.r - base.r) * k) * 255);
        data[i + 1] = Math.round((base.g + (lit.g - base.g) * k) * 255);
        data[i + 2] = Math.round((base.b + (lit.b - base.b) * k) * 255);
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  caustics.wrapS = THREE.RepeatWrapping;
  caustics.wrapT = THREE.RepeatWrapping;
  // A 360ft sheet at repeat 7 puts the caustic cells about seventeen feet across, which from
  // the sea floor reads as a giant white net stretched over the sky rather than as dancing
  // light. Real cells at this depth are a few feet, so the tile has to be small.
  caustics.repeat.set(13, 13);

  // The swell. A subdivided plane displaced by a few wave trains at unrelated frequencies --
  // the same sum-of-sines the terrain uses, with the amplitude kept modest because from
  // below what matters is that the light BREAKS across the surface, not that it heaves.
  const geometry = new THREE.PlaneGeometry(size, size, 56, 56);
  {
    const position = geometry.attributes.position;
    const k = (Math.PI * 2) / size; // so the swell tiles with the plane's own edges
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      position.setZ(i,
        Math.sin(x * k * 7 + y * k * 3) * 0.62 +
        Math.sin(y * k * 9 - x * k * 4) * 0.44 +
        Math.sin((x + y) * k * 15 + 1.3) * 0.22);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  const plane = new THREE.Mesh(
    geometry,
    standard({
      map: caustics,
      roughness: 0.42,
      // Self-lit, because the sun is on the far side of it. Without this the ceiling is the
      // one surface in the world the light never reaches, and it renders as a slab of dark
      // grey exactly where the brightest thing in the scene belongs.
      emissive: new THREE.Color(0xffffff),
      emissiveMap: caustics,
      emissiveIntensity: 0.28,
      side: THREE.FrontSide,
    })
  );
  plane.rotation.x = Math.PI / 2; // face DOWN -- a PlaneGeometry looks along its own +Z
  plane.position.y = height;
  plane.castShadow = false;
  plane.receiveShadow = false;
  void seed;
  return group(plane);
}

// Sunbeams coming down through the surface.
//
// AdditiveBlending with `fog: false`, and both halves of that are deliberate. Additive is
// how light reads -- a beam brightens what is behind it rather than tinting it. And fog has
// to be off because three.js fogs a fragment BEFORE it is blended, so a fully-fogged
// additive fragment adds the fog colour on top of a background that is already the fog
// colour, and the far end of every shaft turns into a bright blue wall.
//
// The whole set merges into ONE transparent draw call. Twelve separately-placed shafts at
// two quads each would be the largest block of transparency in the app.
export function lightShafts({ count = 4, height = 44, spread = 22, width = 9, tilt = 0.36, seed = 103, opacity = 0.2 } = {}) {
  const rng = seededRandom(seed);
  const beam = canvasTexture(64, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    // Brightest at the top where it enters the water, gone before it reaches the sand --
    // which is what absorption actually does, and it also means the shafts never have to
    // resolve against the sea floor.
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.14, 'rgba(216,244,255,0.72)');
    grad.addColorStop(0.55, 'rgba(180,226,250,0.30)');
    grad.addColorStop(1, 'rgba(150,205,240,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    // Soft edges across the beam as well. A hard-edged additive quad reads as a pane of
    // glass standing in the water -- the same lesson as the Mars dust devil's streaks.
    const across = ctx.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, 'rgba(0,0,0,1)');
    across.addColorStop(0.5, 'rgba(0,0,0,0)');
    across.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, h);
  });

  // EVERY SHAFT LEANS THE SAME WAY, and it is worth saying why, because the first version
  // gave each one its own bearing and the result was unmistakably a laser show. Sunbeams are
  // PARALLEL -- they all come from the same sun -- and the only reason they appear to fan out
  // is perspective. Randomising the lean throws that away and the eye reads them as
  // independent objects rather than as light.
  //
  // The lean matches this theme's sun at [45, 175, 60]: the horizontal run is 75ft over a
  // 175ft drop, so the top of each shaft is offset toward (0.6, 0.8) in x/z.
  const t = Math.tan(tilt);
  const axis = new THREE.Vector3(0.6 * t, 1, 0.8 * t).normalize();
  const lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);

  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * spread;
    const x = Math.sin(a) * d;
    const z = Math.cos(a) * d;
    const h = height * randomIn(rng, 0.85, 1.1);
    // WIDE. A shaft narrower than it is tall by more than about ten to one stops being a
    // beam of light and becomes a rod of glass falling through the water.
    const w = width * randomIn(rng, 0.7, 1.45);
    // Two crossed quads per shaft, so a beam still reads when a student walks round it.
    // One quad alone vanishes edge-on, which on a moving camera looks like flickering.
    for (const turn of [0, Math.PI / 2]) {
      const g = new THREE.PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      g.rotateY(a + turn);
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), lean, new THREE.Vector3(1, 1, 1)));
      parts.push({ geometry: g, color: 0xffffff });
    }
  }

  const shafts = new THREE.Mesh(mergeColored(parts), new THREE.MeshBasicMaterial({
    map: beam,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexColors: true,
    fog: false,
  }));
  shafts.castShadow = false;
  shafts.receiveShadow = false;
  shafts.renderOrder = 2;
  return group(shafts);
}

// A stream of bubbles rising off the reef -- from a crevice, or from something breathing.
// All of them in one translucent mesh, for the reason at the top of this section.
export function bubbleColumn({ height = 14, count = 28, radius = 1.1, seed = 107 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    // Bubbles GROW as they rise -- the water pressure squeezing them drops the whole way up
    // -- and they spread out as they go. Both are free here and both are what makes a column
    // read as rising rather than as a string of beads.
    const r = 0.045 + t * 0.11 + rng() * 0.05;
    const a = rng() * Math.PI * 2;
    const d = radius * t * randomIn(rng, 0.3, 1.2);
    // Wobbled out of round, because a rising bubble is never a sphere -- it flattens and
    // oscillates, and a column of perfect balls reads as a bead curtain.
    seaSolid(parts, ball(r, 12), 0xdff2fb, {
      pos: [Math.sin(a) * d, 0.3 + t * height + randomIn(rng, -0.4, 0.4), Math.cos(a) * d],
      scale: [1, randomIn(rng, 0.72, 1.0), 1],
    });
  }
  const bubbles = mergedMesh(parts, {
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.42,
    emissive: new THREE.Color(0x9fd8ee),
    emissiveIntensity: 0.35,
  });
  bubbles.castShadow = false;
  return group(bubbles);
}

// Marine snow: the drifting flecks of organic debris that fill any real photograph taken
// under water, and the cheapest immersion in this file by a wide margin.
//
// A THREE.Points cloud, which is ONE draw call for the whole volume. It is also the only
// thing in the app that renders as points rather than triangles, and it needs to be: a
// fleck a couple of inches across is smaller than a triangle is worth.
export function marineSnow({ radius = 46, height = 30, count = 420, seed = 109 } = {}) {
  const rng = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius;
    positions[i * 3] = Math.sin(a) * d;
    positions[i * 3 + 1] = rng() * height + 0.5;
    positions[i * 3 + 2] = Math.cos(a) * d;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const snow = new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xdfe8e2,
    // sizeAttenuation ON, unlike the starfield's: those are meant to be infinitely far away
    // and these are a few feet from the player's face, so they have to grow as you approach
    // one or the whole cloud reads as dirt on the screen.
    size: 0.06,
    sizeAttenuation: true,
    transparent: true,
    // Faint on purpose. Marine snow only works subliminally: turned up far enough to
    // actually notice, a cloud of white specks overhead stops reading as debris in the water
    // and starts reading as a starfield, which is the one thing this sky must not be.
    opacity: 0.4,
    depthWrite: false,
    fog: true,
  }));
  return group(snow);
}
