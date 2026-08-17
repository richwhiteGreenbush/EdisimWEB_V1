import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// LoftKit -- the shared solid-modelling helpers for Ancient Egypt, Ellis Island and
// Da Vinci's Studio.
//
// WHY THIS FILE EXISTS. Those three worlds were each built out of axis-aligned boxes and
// constant-radius swept tubes, and they each failed in the same three ways:
//
//  1. A HULL IS NOT A SCALED TUBE. `taperedTube` sweeps a CIRCLE, so the only thing that
//     can vary along the length is scale -- one aspect ratio for the whole object. A
//     steamship is a fine wedge at the bow, full and flat-bottomed amidships and a
//     counter at the stern; a lion's body is broader than deep at the shoulder and
//     narrow at the haunch. Neither is expressible as a scaled circle at any resolution,
//     which is why Khufu's barque and the SS Prinzessin were both sausages.
//  2. DETAIL LAID ON A SURFACE AS SEPARATE SOLIDS LEAVES GAPS. The Sphinx's weathering
//     bands, Liberty's drapery folds and the date palm's leaf-scar rings were all boxes
//     and toruses sitting on a curved surface they had to be sized against by hand -- and
//     every one of them was either sunk inside the body (contributing nothing) or floating
//     off it. A GROOVE IS A MODULATION OF ONE SURFACE, and a displacement of a surface
//     cannot open a gap in it. That is what `warp` is for, and it is the single idea that
//     makes "leave no open spaces" structural here rather than remembered.
//  3. A FLAT SHEET RENDERED DoubleSide IS A PIECE OF CARD. The ornithopter's membrane and
//     the aerial screw's sail were zero-thickness planes; edge-on they vanish.
//     `solidSurface` gives them a closed lens section with a real rim.
//
// The implementations are the refined ones from the four worlds already rebuilt --
// CityProps' superellipse loft and mitred mouldings, SeaProps' closed-rim surfaces and
// bend-sized sockets, BodyProps' warp callback -- collected so three worlds share one
// copy instead of three. CityProps keeps its own private originals: it is verified and
// shipped, and refactoring 3500 lines to import from here would risk world 9 for no gain
// a student can see.
//
// House rules are PropKit's: feet at scale 1, fresh materials per call, seededRandom
// never Math.random, merge everything.

// ---------------------------------------------------------------------------
// Splines and sections
// ---------------------------------------------------------------------------

// Catmull-Rom through a list of scalars, indexed by station. Every channel of a loft is
// splined independently with this, which is what lets width, height, centre-line and
// section roundness each do their own thing along the length.
export function splineAt(values, t) {
  const n = values.length;
  if (n === 1) return values[0];
  const span = (n - 1) * THREE.MathUtils.clamp(t, 0, 1);
  const i = Math.min(Math.floor(span), n - 2);
  const f = span - i;
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[i];
  const p2 = values[i + 1];
  const p3 = values[Math.min(n - 1, i + 2)];
  return 0.5 * (
    2 * p1
    + (p2 - p0) * f
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f
    + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f
  );
}

// A point on a SUPERELLIPSE with independent half-heights and independent roundness above
// and below the axis. `round` = 1 is a true ellipse, 0.5 a squircle, 0.2 very nearly a
// rectangle with a filleted corner.
//
// This is what makes a section change SHAPE rather than merely size: a ship is round at
// the bilge and hard-chined at the counter, a nemes headcloth is flat at the front and
// domed over the crown, a mastaba batters from a rectangle toward a softer top.
export function superXY(u, a, bUp, bDn, roundUp, roundDn) {
  const theta = u * Math.PI * 2;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const up = s >= 0;
  const p = Math.max(0.08, up ? roundUp : roundDn);
  return [
    Math.sign(c) * Math.pow(Math.abs(c), p) * a,
    Math.sign(s) * Math.pow(Math.abs(s), p) * (up ? bUp : bDn),
  ];
}

// Averages the normals of the duplicated seam column a wrapped grid has to carry.
//
// A loft emits the vertices at u = 0 again as u = 1, because one vertex cannot hold both
// ends of a texture coordinate -- and computeVertexNormals then treats the copies as
// unrelated surfaces and creases the result exactly where it should be smoothest. On a
// hull that is a hard line straight down the keel; on the Sphinx's back, a scar from the
// tail to the neck visible from across the plateau.
export function weldSeam(geometry, ring, rows) {
  const normal = geometry.attributes.normal;
  for (let r = 0; r < rows; r++) {
    const a = r * ring;
    const b = a + ring - 1;
    const nx = (normal.getX(a) + normal.getX(b)) / 2;
    const ny = (normal.getY(a) + normal.getY(b)) / 2;
    const nz = (normal.getZ(a) + normal.getZ(b)) / 2;
    const len = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(a, nx / len, ny / len, nz / len);
    normal.setXYZ(b, nx / len, ny / len, nz / len);
  }
  normal.needsUpdate = true;
  return geometry;
}

// ---------------------------------------------------------------------------
// solidLoft -- a closed solid whose SECTION CHANGES SHAPE along a curving axis
// ---------------------------------------------------------------------------

// Stations are `{ d, w, up, dn, a, b, round | roundUp, roundDn }`:
//   d      distance along the loft's axis
//   w      half-width in the first lateral direction
//   up/dn  half-extent above / below the section centre in the second lateral direction
//          (`h` sets both)
//   a, b   the section CENTRE's offset in those two lateral directions -- this is the
//          curving axis, and it is what carries a sheer line, a lion's dipped back or a
//          statue's contrapposto
//   round  section shape, per superXY
//
// `axis` picks which world axis `d` runs along: 'z' (default) maps (w -> x, up/dn -> y),
// 'y' maps (w -> x, up/dn -> z) for anything standing upright, 'x' maps (w -> z,
// up/dn -> y).
//
// Both ends are ALWAYS closed with a fan, so a lofted solid can never be looked into.
// Author an end station tiny (w and up/dn of a few hundredths of a foot) and the fan
// closes to a point.
// THE AXIS MAPPINGS FOR 'y' AND 'x' ARE ODD PERMUTATIONS, SO THEY FLIP HANDEDNESS.
//
// 'z' is the identity (p, q, d) -> (x, y, z) and is right-handed. 'y' sends the third
// coordinate to the middle slot, which is a single transposition -- an ODD permutation --
// and so is 'x'. A mirrored basis reverses the sense of every cross product, so a triangle
// wound counter-clockwise in the loft's own frame comes out clockwise in world space and
// the entire solid renders INSIDE OUT.
//
// Under a `FrontSide` MeshStandardMaterial that does not look like a missing surface: the
// outward faces are culled and what you see is the far inner wall of the solid, lit by its
// own inverted normals. It reads as a dark, muddy, oddly-shaded version of roughly the
// right shape -- which is exactly why it survived a first inspection on the Statue of
// Liberty and was only caught on the Sphinx, whose nemes headcloth came out a flat dark
// brown while its vertex colours measured LIGHTER than the body's.
//
// Two ways to fix it. Re-ordering the mapping to an even permutation works but silently
// swaps which lateral `w` and `up`/`dn` refer to, breaking every existing caller. Flipping
// the winding instead leaves the authoring meaning untouched, which is what `handedness`
// below is for.
function axisMap(axis) {
  if (axis === 'y') return (p, q, d) => [p, d, q];
  if (axis === 'x') return (p, q, d) => [d, q, p];
  return (p, q, d) => [p, q, d];
}

function handedness(axis) {
  return axis === 'z' ? 1 : -1;
}

export function loftSampler(stations, { axis = 'z' } = {}) {
  const chan = (key, fallback) => stations.map((s) => (s[key] === undefined ? fallback : s[key]));
  const cd = chan('d', 0);
  const cw = chan('w', 1).map((v) => Math.max(1e-4, v));
  const cu = stations.map((s) => Math.max(1e-4, s.up ?? s.h ?? 1));
  const cn = stations.map((s) => Math.max(1e-4, s.dn ?? s.h ?? 1));
  const ca = chan('a', 0);
  const cb = chan('b', 0);
  const cru = stations.map((s) => s.roundUp ?? s.round ?? 1);
  const crd = stations.map((s) => s.roundDn ?? s.round ?? 1);
  const place = axisMap(axis);

  const sample = (t, u) => {
    const [px, py] = superXY(
      u,
      Math.max(1e-4, splineAt(cw, t)),
      Math.max(1e-4, splineAt(cu, t)),
      Math.max(1e-4, splineAt(cn, t)),
      splineAt(cru, t),
      splineAt(crd, t),
    );
    return place(splineAt(ca, t) + px, splineAt(cb, t) + py, splineAt(cd, t));
  };
  // The section's own parameters at t, handed to a warp so it can size a groove against
  // the radius it is actually cutting into rather than against a number guessed outside.
  sample.at = (t) => ({
    d: splineAt(cd, t),
    w: Math.max(1e-4, splineAt(cw, t)),
    up: Math.max(1e-4, splineAt(cu, t)),
    dn: Math.max(1e-4, splineAt(cn, t)),
    a: splineAt(ca, t),
    b: splineAt(cb, t),
  });
  sample.centre = (t) => place(splineAt(ca, t), splineAt(cb, t), splineAt(cd, t));
  sample.forward = splineAt(cd, 1) >= splineAt(cd, 0);
  sample.place = place;

  // Inverses, so a caller can say "the porthole row runs from d = -40 to d = 38 at
  // b = 6.2" instead of solving a superellipse by hand. Everything applied to a lofted
  // body -- a window, a rubbing strake, a painted band -- is placed this way.
  sample.tAtD = (d) => {
    let lo = 0;
    let hi = 1;
    const rising = sample.forward;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if ((splineAt(cd, mid) < d) === rising) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // u on the +first-lateral flank only, where the second lateral coordinate is monotonic
  // in u over (-1/4, 1/4).
  sample.uAtB = (t, target) => {
    let lo = -0.2499;
    let hi = 0.2499;
    const idx = axis === 'z' ? 1 : axis === 'y' ? 2 : 1;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (sample(t, mid)[idx] < target) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return sample;
}

// `warp(t, u, section)` returns a displacement along the section's outward direction,
// positive being proud of the surface. Negative cuts a groove.
//
// TWO RULES, and both were learned by getting them wrong on the Voyage rebuild:
//
//  * EVERY WARP FREQUENCY IS BOUNDED BY THE SAMPLE COUNT. A field running more cycles
//    than roughly a ninth of `samples` is under Nyquist and produces aliasing rather than
//    ridges. Where detail has to be finer, raise `samples`, never the frequency.
//  * SEVERAL INDEPENDENT DISPLACEMENTS THAT EACH LOOK REASONABLE CAN EXCEED THE SECTION
//    RADIUS, at which point the surface passes through its own axis and turns inside out.
//    Clamp the total against the local radius -- `grooveAt` and the callers here hold to a
//    third of it.
export function solidLoft(stations, {
  sides = 24, samples = 32, warp = null, axis = 'z', capStart = true, capEnd = true,
} = {}) {
  const sample = loftSampler(stations, { axis });
  const ring = sides + 1;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const section = warp ? sample.at(t) : null;
    const centre = warp ? sample.centre(t) : null;
    for (let j = 0; j <= sides; j++) {
      const u = j / sides;
      const p = sample(t, u);
      if (warp) {
        const dx = p[0] - centre[0];
        const dy = p[1] - centre[1];
        const dz = p[2] - centre[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const push = warp(t, u, section);
        p[0] += (dx / len) * push;
        p[1] += (dy / len) * push;
        p[2] += (dz / len) * push;
      }
      positions.push(p[0], p[1], p[2]);
      uvs.push(t, u);
    }
  }

  // Winding follows the direction d actually runs, XOR'd with the axis's handedness. A hull
  // authored bow-first has its stations in DECREASING d, and a loft built on the 'y' or 'x'
  // axis sits in a mirrored basis -- either one alone reverses the winding, and both
  // together cancel. Without this every panel renders inside out, which under a
  // MeshStandardMaterial reads as a dark muddy object rather than as a missing one.
  const forward = handedness(axis) > 0 ? sample.forward : !sample.forward;
  const quad = (a, b, c, e) => (forward ? indices.push(a, e, b, b, e, c) : indices.push(a, b, e, b, c, e));
  for (let i = 1; i <= samples; i++) {
    for (let j = 1; j <= sides; j++) {
      quad(ring * (i - 1) + (j - 1), ring * i + (j - 1), ring * i + j, ring * (i - 1) + j);
    }
  }

  for (const end of [0, 1]) {
    if (end === 0 && !capStart) continue;
    if (end === 1 && !capEnd) continue;
    const centre = positions.length / 3;
    positions.push(...sample.centre(end));
    uvs.push(0.5, 0.5);
    const base = end === 0 ? 0 : ring * samples;
    for (let j = 0; j < sides; j++) {
      const a = base + j;
      const b = base + j + 1;
      if ((end === 0) === forward) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return weldSeam(geometry, ring, samples + 1);
}

// A NARROW CUT where a field crosses zero, rather than the trough of a wave.
//
// Feeding a wave field straight in as a displacement gives rolling undulation, which at
// any amplitude reads as a dented pillow because the ridges and the valleys are the same
// width. A fissure, a flute, a drapery fold and a leaf scar are all narrow.
//
// The transfer function is a GAUSSIAN and not a clamped ramp on |field|, because anything
// built on an absolute value has a kink at zero -- which is the bottom of every groove, so
// each one comes out as a hard crease.
export function grooveAt(field, halfWidth, depth) {
  const g = Math.exp(-(field * field) / (2 * halfWidth * halfWidth));
  return -g * depth;
}

// ---------------------------------------------------------------------------
// Swept profiles -- mouldings, spars, ropes, rails
// ---------------------------------------------------------------------------

// PARALLEL TRANSPORT, not Frenet. A Frenet frame is undefined on a straight run and flips
// through every inflection, and a moulding or a wing spar is mostly straight runs with
// inflections in them -- which is exactly where a Frenet sweep turns itself inside out.
export function transportFrames(curve, samples, up = new THREE.Vector3(0, 1, 0)) {
  const frames = [];
  let ref = up.clone().normalize();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const tangent = curve.getTangentAt(t).normalize();
    if (Math.abs(tangent.dot(ref)) > 0.999) ref = new THREE.Vector3(1, 0, 0);
    const binormal = new THREE.Vector3().crossVectors(tangent, ref).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();
    frames.push({ point: curve.getPointAt(t), tangent, normal, binormal });
    ref = normal;
  }
  return frames;
}

export function outlineArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

// Guarantees a counter-clockwise outline, so a caller can write a profile in whichever
// direction reads best and still get outward-facing sides.
export function normalisedOutline(points) {
  return outlineArea(points) < 0 ? [...points].reverse() : points;
}

// Fan triangulation from VERTEX 0. Only valid for a CONVEX outline, and kept because a
// few callers legitimately have one (a lens section, a plank end).
export function capTriangles(outline) {
  const tris = [];
  for (let i = 1; i < outline.length - 1; i++) tris.push([0, i, i + 1]);
  return tris;
}

// The centroid of an outline, for the cap fan below.
export function outlineCentre(points) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  return [cx / points.length, cy / points.length];
}

// FAN FROM AN INTERIOR POINT, which is what every cap here actually needs.
//
// A fan from vertex 0 is correct only for a CONVEX polygon, and the two outlines this kit
// exists to extrude are neither: an eleven-pointed star fort and a gear. Fanning a gear
// from a vertex on its root circle throws triangles straight across the tooth gaps, so
// every gear face came out as a solid disc with a torn edge and Fort Wood's parapet came
// out as a lumpy hendecagon with its points filled in.
//
// A fan from an interior point IS correct for any polygon that is star-shaped about that
// point -- which a star, a gear, a cross and every convex outline all are -- and costs one
// extra vertex. So this is the default and the vertex fan is the exception.
export function capFan(outline, centreIndex) {
  const tris = [];
  for (let i = 0; i < outline.length; i++) {
    tris.push([centreIndex, i, (i + 1) % outline.length]);
  }
  return tris;
}

// A closed outline swept along a path, capped at both ends. This is a moulding, a spar, a
// rope, a handrail, a wheel rim -- anything whose cross-section is a shape rather than a
// circle.
export function sweepProfile(points, profile, {
  samples = null, closed = false, capStart = true, capEnd = true,
  up = new THREE.Vector3(0, 1, 0), scale = null, twist = null, uvScale = 1,
} = {}) {
  const outline = normalisedOutline(profile);
  const n = outline.length;
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), closed, 'catmullrom', 0.5,
  );
  const steps = samples ?? Math.max(2, points.length * 6);
  const frames = transportFrames(curve, steps, up);

  const positions = [];
  const uvs = [];
  const indices = [];
  let run = 0;
  for (let i = 0; i <= steps; i++) {
    const f = frames[i];
    const t = i / steps;
    if (i > 0) run += f.point.distanceTo(frames[i - 1].point);
    const s = scale ? scale(t) : 1;
    const a = twist ? twist(t) : 0;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let j = 0; j < n; j++) {
      const [ox, oy] = outline[j];
      const px = (ox * ca - oy * sa) * s;
      const py = (ox * sa + oy * ca) * s;
      positions.push(
        f.point.x + f.binormal.x * px + f.normal.x * py,
        f.point.y + f.binormal.y * px + f.normal.y * py,
        f.point.z + f.binormal.z * px + f.normal.z * py,
      );
      uvs.push(run * uvScale, j / n);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < n; j++) {
      const a = i * n + j;
      const b = i * n + ((j + 1) % n);
      const c = (i + 1) * n + ((j + 1) % n);
      const d = (i + 1) * n + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  if (!closed) {
    // Centre-fan caps, so a non-convex profile (a gear tooth, a star point, a scalloped
    // valance) closes correctly rather than throwing triangles across its own notches.
    const [ox, oy] = outlineCentre(outline);
    for (const [end, flip] of [[0, true], [steps, false]]) {
      if (end === 0 && !capStart) continue;
      if (end === steps && !capEnd) continue;
      const f = frames[end];
      const centre = positions.length / 3;
      positions.push(
        f.point.x + f.binormal.x * ox + f.normal.x * oy,
        f.point.y + f.binormal.y * ox + f.normal.y * oy,
        f.point.z + f.binormal.z * ox + f.normal.z * oy,
      );
      uvs.push(0.5, 0.5);
      const base = end * n;
      for (const [, b, c] of capFan(outline, centre)) {
        if (flip) indices.push(centre, base + c, base + b);
        else indices.push(centre, base + b, base + c);
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

// A moulding MITRED round a rectangle -- a cornice, a plinth, a string course, a window
// architrave, a picture frame.
//
// The trick that makes the mitre exact with no mitre arithmetic anywhere: a profile point
// standing `out` proud of every face traces a rectangle of half-size
// `(halfW + out, halfD + out)`, so the corners meet at 45 degrees by construction. A
// cornice is then just a stack of rectangles.
//
// `profile` is a list of `[out, y]` pairs, read as a section cut through the moulding on
// any face: `out` is how far it stands proud, `y` its height above the ring's origin.
export function mouldedRing(profile, halfW, halfD, { closeTop = false, closeBottom = false } = {}) {
  const n = profile.length;
  const positions = [];
  const uvs = [];
  const indices = [];
  // Four corners, counter-clockwise seen from above, each repeated so the profile can
  // carry its own normals round the corner rather than smearing them.
  const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const ringLen = corners.length;

  for (let c = 0; c < ringLen; c++) {
    const [sx, sz] = corners[c];
    for (let i = 0; i < n; i++) {
      const [out, y] = profile[i];
      positions.push(sx * (halfW + out), y, sz * (halfD + out));
      uvs.push(c / ringLen, i / Math.max(1, n - 1));
    }
  }
  for (let c = 0; c < ringLen; c++) {
    const c2 = (c + 1) % ringLen;
    for (let i = 0; i < n - 1; i++) {
      const a = c * n + i;
      const b = c * n + i + 1;
      const d = c2 * n + i + 1;
      const e = c2 * n + i;
      indices.push(a, b, d, a, d, e);
    }
  }
  // Closing the ring's own top or bottom face turns a moulding into a CAP. A cornice that
  // closes its top spans the whole footprint and silently cancels every bit of glazing
  // above it -- the museum skylight trap -- so both default to off and a caller has to
  // ask.
  const closeFace = (index, flip) => {
    const centre = positions.length / 3;
    positions.push(0, profile[index][1], 0);
    uvs.push(0.5, 0.5);
    for (let c = 0; c < ringLen; c++) {
      const a = c * n + index;
      const b = ((c + 1) % ringLen) * n + index;
      if (flip) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  };
  if (closeBottom) closeFace(0, true);
  if (closeTop) closeFace(n - 1, false);

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// A closed outline extruded through its own thickness along Z, capped both ends.
//
// `uvFeet` lays UVs out in FEET, which is right for anything carrying a tiling relief map
// (a kerb, a plank, a stone block) and WRONG for anything whose texture must span the
// shape exactly once (a painted awning, a sail with a stripe). Pass false for those.
export function extrudeOutline(outline, depth, { capStart = true, capEnd = true, uvFeet = true } = {}) {
  const pts = normalisedOutline(outline);
  const n = pts.length;
  const positions = [];
  const uvs = [];
  const indices = [];
  let span = 0;
  const runs = [0];
  for (let i = 1; i <= n; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i % n];
    span += Math.hypot(x1 - x0, y1 - y0);
    runs.push(span);
  }
  // THE SIDES AND THE CAPS MUST NOT SHARE VERTICES.
  //
  // Sharing them is the obvious way to write this and it is wrong: `computeVertexNormals`
  // averages every face touching a vertex, so each corner would blend its two side normals
  // WITH the cap's, tilting them diagonally outward. The result is that a plain rectangular
  // block shades like a pillow -- and a wall built of them reads as a grid of diamond studs
  // rather than as masonry, which is exactly how the valley temple and every mastaba first
  // came out. Duplicating the rim for the caps costs 2n vertices and gives flat cap faces
  // and flat side faces, which is what a sawn block actually has.
  for (const z of [-depth / 2, depth / 2]) {
    for (let i = 0; i < n; i++) {
      positions.push(pts[i][0], pts[i][1], z);
      uvs.push(uvFeet ? runs[i] : runs[i] / (span || 1), uvFeet ? z + depth / 2 : (z + depth / 2) / (depth || 1));
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i;
    const b = (i + 1) % n;
    indices.push(a, b, n + b, a, n + b, n + a);
  }
  // Centre-fan caps, on their own copies of the rim. A fan from vertex 0 is only correct for
  // a CONVEX outline, and two of the shapes this function exists for -- a GEAR and an
  // eleven-pointed STAR FORT -- are not convex. See capFan.
  const [ox, oy] = outlineCentre(pts);
  for (const [z, flip, want] of [[-depth / 2, true, capStart], [depth / 2, false, capEnd]]) {
    if (!want) continue;
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      positions.push(pts[i][0], pts[i][1], z);
      uvs.push(uvFeet ? pts[i][0] : (pts[i][0] + 0.5), uvFeet ? pts[i][1] : (pts[i][1] + 0.5));
    }
    const centre = positions.length / 3;
    positions.push(ox, oy, z);
    uvs.push(uvFeet ? ox : 0.5, uvFeet ? oy : 0.5);
    for (let i = 0; i < n; i++) {
      const a = base + i;
      const b = base + ((i + 1) % n);
      if (flip) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// A surface of revolution from a `[radius, y]` profile. `sweep` under a full turn leaves
// an open pie slice, so it also closes the two radial faces -- a partial lathe with a hole
// in its side is the commonest way a dome or a bowl reads as broken.
export function revolve(profile, { segments = 24, start = 0, sweep = Math.PI * 2, capEnds = false } = {}) {
  const n = profile.length;
  const full = sweep >= Math.PI * 2 - 1e-6;
  const cols = full ? segments : segments + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let c = 0; c < cols; c++) {
    const a = start + (c / segments) * sweep;
    for (let i = 0; i < n; i++) {
      const [r, y] = profile[i];
      positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uvs.push(c / segments, i / Math.max(1, n - 1));
    }
  }
  const lim = full ? cols : cols - 1;
  for (let c = 0; c < lim; c++) {
    const c2 = (c + 1) % cols;
    for (let i = 0; i < n - 1; i++) {
      const p = c * n + i;
      const q = c * n + i + 1;
      const s = c2 * n + i + 1;
      const t = c2 * n + i;
      indices.push(p, q, s, p, s, t);
    }
  }
  if (!full) {
    for (const [c, flip] of [[0, true], [cols - 1, false]]) {
      const centre = positions.length / 3;
      const a = start + (c / segments) * sweep;
      positions.push(Math.sin(a) * 0, (profile[0][1] + profile[n - 1][1]) / 2, Math.cos(a) * 0);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < n - 1; i++) {
        const p = c * n + i;
        const q = c * n + i + 1;
        if (flip) indices.push(centre, q, p);
        else indices.push(centre, p, q);
      }
    }
  }
  if (capEnds) {
    for (const [i, flip] of [[0, true], [n - 1, false]]) {
      const centre = positions.length / 3;
      positions.push(0, profile[i][1], 0);
      uvs.push(0.5, 0.5);
      for (let c = 0; c < lim; c++) {
        const p = c * n + i;
        const q = ((c + 1) % cols) * n + i;
        if (flip) indices.push(centre, q, p);
        else indices.push(centre, p, q);
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

// ---------------------------------------------------------------------------
// solidSurface -- a plate with a real closed rim, never a DoubleSide plane
// ---------------------------------------------------------------------------

// A wing membrane, a sail panel, a linen screw blade, a drapery flap, a steering-oar blade,
// a palm leaflet. `point(u, v)` gives the mid-surface, `thick(u, v)` its half-thickness
// there; the result is a closed solid with both faces and a rim wherever the thickness has
// not already vanished.
//
// Skipping the degenerate rim edges is most of the cost, not tidiness: a blade's thickness
// goes to zero at the leading edge, the trailing edge and the tip, so three of its four
// boundary loops need no rim at all.
export function solidSurface({ nu = 10, nv = 6, point, thick, axis = null, closedU = false }) {
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
      const nrm = new THREE.Vector3().crossVectors(du, dv);
      dirs.push(nrm.lengthSq() > 1e-12 ? nrm.normalize() : new THREE.Vector3(0, 1, 0));
    }
  }

  // Which way round the top grid winds depends on the handedness of (du x dv) against the
  // offset direction, and that flips whenever a patch is authored mirrored -- which every
  // paired wing and lappet is. Testing once in the middle and flipping the whole patch is
  // what stops a mirrored wing rendering as a hole.
  let flip = false;
  {
    const i = Math.floor(cols / 2);
    const j = Math.floor(rows / 2);
    du.copy(at(i + 1, j)).sub(at(Math.max(0, i - 1), j));
    dv.copy(at(i, j + 1)).sub(at(i, j - 1));
    flip = new THREE.Vector3().crossVectors(du, dv).dot(dirs[i * rows + j]) < 0;
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
        const dir = dirs[k];
        const h = half[k] * sign;
        positions.push(p.x + dir.x * h, p.y + dir.y * h, p.z + dir.z * h);
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

// ---------------------------------------------------------------------------
// Gap-free runs: tubes, sockets, caps, rooted spikes, sunk domes
// ---------------------------------------------------------------------------

export function ball(radius, detail = 12, rings = null) {
  return new THREE.SphereGeometry(radius, Math.max(6, detail), rings ?? Math.max(3, detail >> 1));
}

export function tube(points, radii, { tubular = null, sides = 14 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const steps = tubular ?? Math.max(6, points.length * 5);
  const positions = [];
  const uvs = [];
  const indices = [];
  const frames = transportFrames(curve, steps);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const f = frames[i];
    const r = splineAt(radii, t);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a) * r;
      const s = Math.sin(a) * r;
      positions.push(
        f.point.x + f.binormal.x * c + f.normal.x * s,
        f.point.y + f.binormal.y * c + f.normal.y * s,
        f.point.z + f.binormal.z * c + f.normal.z * s,
      );
      uvs.push(t, j / sides);
    }
  }
  const ring = sides + 1;
  for (let i = 1; i <= steps; i++) {
    for (let j = 1; j <= sides; j++) {
      const a = ring * (i - 1) + (j - 1);
      const b = ring * i + (j - 1);
      const c = ring * i + j;
      const d = ring * (i - 1) + j;
      indices.push(a, d, b, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return weldSeam(geometry, ring, steps + 1);
}

// A run of tubes with a SOCKET BALL at every interior node and a CAP at each open end, so
// an unclosed junction is impossible rather than remembered.
//
// SOCKET SIZE COMES FROM THE BEND, not from the fattest nearby radius. Both tubes already
// carry that node's radius there, so the ball only has to cover the flats' inset plus the
// wedge the two end planes leave on the outside of the bend -- a factor of 1/cos(phi/2).
// Sized from neighbouring radii instead, a 1.5ft joint gets a 2.4ft ball and every frame
// member reads as a stack of balloons.
//
// A tube that stops at a real thickness needs a ball; one tapering to 0 must NOT have one
// -- radius 0 closes the end but turns the last segment into a cone, which is right for a
// tail or a frond tip and wrong for a spar or a rail.
export function chain(list, color, nodes, {
  capStart = true, capEnd = true, sides = 14, tubular = null, detail = 14, base = null,
} = {}) {
  const push = (geometry, position = null) => list.push(
    base ? { ...base, geometry, color, position } : { geometry, color, position },
  );
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    // Three control points per span: a two-point Catmull-Rom is a straight line whose
    // radius then interpolates linearly, losing the swell a real member has.
    const mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2, (a.p[2] + b.p[2]) / 2];
    push(tube([a.p, mid, b.p], [a.r, (a.r + b.r) / 2, b.r], { sides, tubular }));
  }
  for (let i = 1; i < nodes.length - 1; i++) {
    const u = new THREE.Vector3(...nodes[i].p).sub(new THREE.Vector3(...nodes[i - 1].p)).normalize();
    const v = new THREE.Vector3(...nodes[i + 1].p).sub(new THREE.Vector3(...nodes[i].p)).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    push(ball((nodes[i].r * 1.02) / Math.max(0.62, Math.cos(phi / 2)), detail), nodes[i].p);
  }
  if (capStart && nodes[0].r > 0) push(ball(nodes[0].r * 1.02, detail), nodes[0].p);
  const last = nodes[nodes.length - 1];
  if (capEnd && last.r > 0) push(ball(last.r * 1.02, detail), last.p);
}

// A cone standing on a curved surface: a tooth, a finial, a pyramidion, a spike.
// ROOTED BY DEFAULT -- a cone placed exactly on a curved surface leaves a crescent of
// daylight, so a ball at three quarters of the base radius is pushed a third of the length
// back down the axis to straddle the base disc rather than sit on it.
export function spike(list, color, {
  length, radius, at, rot = [0, 0, 0], sides = 8, rooted = true, base = null,
}) {
  const put = (geometry, position, rotation = null) => list.push(
    base ? { ...base, geometry, color, position, rotation } : { geometry, color, position, rotation },
  );
  put(new THREE.ConeGeometry(radius, length, sides), at, rot);
  if (rooted) {
    const axis = new THREE.Vector3(0, 1, 0)
      .applyEuler(new THREE.Euler(rot[0], rot[1], rot[2]))
      .multiplyScalar(-length * 0.3);
    put(ball(radius * 0.78, 8), [at[0] + axis.x, at[1] + axis.y, at[2] + axis.z]);
  }
}

// A flattened dome SUNK into whatever it sits on: a boss, a rivet, a knob, a boulder.
//
// It is a CLOSED sphere flattened, never a partial one. A partial sphere's rim is a hole
// and its inside is back faces, so unless the rim is completely buried you see straight
// through it -- and half the time it is not, because the thing bulging is often fatter
// than the surface it bulges from.
export function dome(list, color, {
  radius, height, at, rot = [0, 0, 0], detail = 10, sink = 0.45, base = null,
}) {
  const g = ball(radius, detail);
  g.scale(1, height / radius, 1);
  list.push(base
    ? { ...base, geometry: g, color, position: [at[0], at[1] - height * sink, at[2]], rotation: rot }
    : { geometry: g, color, position: [at[0], at[1] - height * sink, at[2]], rotation: rot });
}

// ---------------------------------------------------------------------------
// A gear with real teeth
// ---------------------------------------------------------------------------

// Da Vinci's Studio is why this exists. A gear drawn as a disc with boxes stuck round the
// rim is what the first pass had, and it reads as a cog in a diagram rather than a machined
// wheel: the teeth stand on the rim instead of growing out of it, so every one shows a
// seam, and their flanks are parallel where a real tooth's taper toward its tip is the
// thing your eye uses to read it as a gear at all.
//
// This is ONE closed outline -- root circle, flank, tip, flank, root -- extruded through
// the gear's thickness, so a tooth cannot be separate from the wheel it belongs to. The
// flanks are straight (an involute at this size is indistinguishable) and the corners are
// eased, because a real tooth is cut with a cutter of finite radius and a knife-sharp
// tooth reads as a saw.
export function gearOutline(radius, teeth, {
  toothDepth = null, tipRatio = 0.42, ease = 0.16,
} = {}) {
  const depth = toothDepth ?? radius * (2.1 / teeth) * 1.9;
  const root = radius - depth;
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  // Half-angles: the tooth occupies a little under half the pitch, which is what leaves
  // room for the mating tooth. A tooth filling its whole pitch is a knurl, not a gear.
  const halfTip = step * 0.5 * tipRatio;
  const halfRoot = step * 0.5 * 0.82;
  const e = step * ease;
  for (let i = 0; i < teeth; i++) {
    const c = i * step;
    const at = (a, r) => pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    at(c - halfRoot, root);
    at(c - halfRoot + e * 0.5, root);
    at(c - halfTip - e, radius - depth * 0.12);
    at(c - halfTip, radius);
    at(c + halfTip, radius);
    at(c + halfTip + e, radius - depth * 0.12);
    at(c + halfRoot - e * 0.5, root);
    at(c + halfRoot, root);
  }
  return pts;
}

export function gearWheel(radius, teeth, thickness, {
  toothDepth = null, tipRatio = 0.42, hub = 0, spokes = 0, spokeWidth = 0.16,
} = {}) {
  const parts = [];
  parts.push(extrudeOutline(gearOutline(radius, teeth, { toothDepth, tipRatio }), thickness));
  if (hub > 0) {
    parts.push(new THREE.CylinderGeometry(hub, hub, thickness * 1.6, 16)
      .rotateX(Math.PI / 2));
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      const len = radius - (toothDepth ?? radius * 0.16) - hub * 0.5;
      const bar = new THREE.BoxGeometry(len, spokeWidth, thickness * 0.7);
      bar.translate(hub * 0.5 + len / 2, 0, 0);
      bar.rotateZ(a);
      parts.push(bar);
    }
  }
  return parts.length === 1 ? parts[0] : mergeGeometries(parts.map(toNonIndexed), false);
}

function toNonIndexed(g) {
  return g.index ? g.toNonIndexed() : g;
}

// ---------------------------------------------------------------------------
// Colour on merged geometry
// ---------------------------------------------------------------------------

// Smooth 3D value noise. Used for weathering, soot, sand staining and stone mottle -- all
// of which are COLOUR problems, not geometry ones. Real coursed masonry is never one flat
// colour, and as geometry that would be hundreds of solids per facade.
export function noise3(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

export function smoothNoise3(x, y, z) {
  const xi = Math.floor(x); const yi = Math.floor(y); const zi = Math.floor(z);
  const xf = x - xi; const yf = y - yi; const zf = z - zi;
  const fade = (t) => t * t * (3 - 2 * t);
  const u = fade(xf); const v = fade(yf); const w = fade(zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => noise3(xi + i, yi + j, zi + k);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

// Multiplies a merged geometry's vertex colours by `fn(point, colour) -> [r, g, b]`.
//
// A TINT MULTIPLIES, so it cannot turn one hue into another. Where a builder needs a real
// colour change across one solid -- Liberty's unweathered copper against her patina, a
// stone's granite against its limestone -- the part is painted with a WHITE sentinel and
// the tint supplies the actual colour. Painted the first colour and then tinted, the best
// it can ever produce is a darker version of that colour.
export function tintGeometry(geometry, fn) {
  const pos = geometry.attributes.position;
  let col = geometry.attributes.color;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3);
    geometry.setAttribute('color', col);
  }
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
    const out = fn(p, c);
    if (out) col.setXYZ(i, out[0], out[1], out[2]);
  }
  col.needsUpdate = true;
  return geometry;
}

// Weathering as a per-vertex multiply: broad blotching plus a directional wash that
// strengthens toward `low`. Soot on brick, salt on a hull, wind-blown sand up a monument's
// windward face, dust on a workshop floor -- one function, different constants.
export function weather(geometry, {
  amount = 0.1, scale = 0.06, wash = 0.45, axis = 'y', low = 0, fade = 20, seed = 3, warm = 0,
} = {}) {
  const key = axis === 'x' ? 'x' : axis === 'z' ? 'z' : 'y';
  return tintGeometry(geometry, (p, c) => {
    const blotch = smoothNoise3(p.x * scale + seed, p.y * scale, p.z * scale + seed * 2);
    const grade = THREE.MathUtils.clamp(1 - (p[key] - low) / fade, 0, 1);
    const k = 1 - amount * blotch - wash * grade * grade * 0.5;
    return [c.r * k, c.g * k * (1 - warm * 0.04), c.b * k * (1 - warm * 0.12)];
  });
}

// ---------------------------------------------------------------------------
// Merging
// ---------------------------------------------------------------------------

// Bakes a full Matrix4 into a geometry.
//
// `mergeColored` applies a part's rotation as rotateX, then rotateY, then rotateZ, in that
// FIXED order, and cannot compose two rotations about different pivots. Anything needing a
// real compound transform -- a voussoir rotated into its ring and then swung to face out of
// a curved wall, a gear tipped onto an angled shaft, a feather rolled about its own long
// axis -- goes through here instead.
export function xformed(geometry, matrix) {
  const g = geometry.clone();
  g.applyMatrix4(matrix);
  return g;
}

export function placed(geometry, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1], about = null } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  if (about) {
    // Scale and rotate about an explicit pivot. Not optional decoration: a part swept in
    // absolute model coordinates does not stay put when scaled about the origin -- it is
    // dragged toward it, which is the trap DinoProps' scaleAbout exists for.
    const t1 = new THREE.Matrix4().makeTranslation(-about[0], -about[1], -about[2]);
    const s = new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]);
    const r = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const t2 = new THREE.Matrix4().makeTranslation(about[0] + pos[0], about[1] + pos[1], about[2] + pos[2]);
    m.multiplyMatrices(t2, new THREE.Matrix4().multiplyMatrices(r, new THREE.Matrix4().multiplyMatrices(s, t1)));
  } else {
    m.compose(
      new THREE.Vector3(pos[0], pos[1], pos[2]), q,
      new THREE.Vector3(scale[0], scale[1], scale[2]),
    );
  }
  return xformed(geometry, m);
}

// Merges `{ geometry, color, position, rotation, scale, about, keepColor, tint }` parts
// into ONE vertex-coloured geometry.
//
// Three things this does that `PropKit.mergeColored` does not, each learned by needing it:
//
//  * `keepColor` leaves a part's existing colour attribute alone. mergeColored OVERWRITES
//    it, which silently wipes any sub-assembly that was already tinted -- a finished
//    weathered wall handed back as one part came out flat white.
//  * `tint` applies a per-vertex function BEFORE the part's transform, so "distance from
//    the axis" is measured from an axis still where it was authored.
//  * NO mergeVertices AND NO computeVertexNormals afterwards. Every part arriving here
//    already carries correct smooth normals and the merge passes them straight through.
//    Re-welding throws away every seam weld a loft did -- so a hard line runs up the flank
//    of every hull -- and where a cap has left zero-area triangles it computes garbage
//    normals from them and smears those across the neighbours.
export function mergeParts(parts) {
  const geoms = [];
  let anyIndexed = false;
  let anyNonIndexed = false;
  for (const part of parts) {
    let g = part.geometry;
    if (part.tint) g = tintGeometry(g.clone(), part.tint);
    else g = g.clone();
    if (part.position || part.rotation || part.scale || part.about) {
      g = placed(g, {
        pos: part.position ?? [0, 0, 0],
        rot: part.rotation ?? [0, 0, 0],
        scale: part.scale ?? [1, 1, 1],
        about: part.about ?? null,
      });
    }
    if (!part.keepColor) {
      const c = new THREE.Color(part.color ?? 0xffffff);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    } else if (!g.attributes.color) {
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    // Keep only what every input shares, or mergeGeometries refuses the batch.
    for (const key of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (g.index) anyIndexed = true; else anyNonIndexed = true;
    geoms.push(g);
  }
  // mergeGeometries refuses a MIX of indexed and non-indexed inputs, and three.js is
  // inconsistent about which it returns -- Box/Cylinder/Sphere/Torus are indexed,
  // IcosahedronGeometry and everything else from PolyhedronGeometry is not.
  const list = anyIndexed && anyNonIndexed ? geoms.map(toNonIndexed) : geoms;
  return mergeGeometries(list, false);
}

// `computeVertexNormals()` on a NON-INDEXED geometry can only compute FACE normals, so
// everything from PolyhedronGeometry renders flat-shaded whatever the material says, and
// subdividing only makes the facets smaller. Welding first is the whole fix -- and it
// drops the vertex count severalfold as a side effect.
export function smoothed(geometry, tolerance = 1e-4) {
  const welded = mergeVertices(geometry, tolerance);
  welded.computeVertexNormals();
  return welded;
}

// ---------------------------------------------------------------------------
// Small outline builders
// ---------------------------------------------------------------------------

export function ringPts(radius, count, { start = 0, sweep = Math.PI * 2 } = {}) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * sweep;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

export function ovalPts(halfW, halfH, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push([Math.cos(a) * halfW, Math.sin(a) * halfH]);
  }
  return pts;
}

export function roundedOutline(halfW, halfH, radius, cornerSteps = 4) {
  const r = Math.min(radius, Math.min(halfW, halfH) * 0.98);
  const pts = [];
  const corners = [[halfW - r, halfH - r, 0], [-(halfW - r), halfH - r, Math.PI / 2],
    [-(halfW - r), -(halfH - r), Math.PI], [halfW - r, -(halfH - r), -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= cornerSteps; i++) {
      const a = a0 + (i / cornerSteps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

// A lens section -- two arcs meeting at points. The right profile for anything that has to
// be a plate rather than a slab: a blade, a rib, a fin, a drapery flap seen edge-on.
export function lensOutline(halfLen, halfThick, steps = 8) {
  const pts = [];
  for (const sign of [1, -1]) {
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * 2 - 1;
      if (sign < 0 && (i === 0 || i === steps)) continue;
      pts.push([t * halfLen * sign, sign * halfThick * Math.sqrt(Math.max(0, 1 - t * t))]);
    }
  }
  return pts;
}

export function put(list, geometry, color, position = null, rotation = null, extra = null) {
  const part = { geometry, color };
  if (position) part.position = position;
  if (rotation) part.rotation = rotation;
  if (extra) Object.assign(part, extra);
  list.push(part);
  return part;
}
