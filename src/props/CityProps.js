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
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { photoMap } from '../SurfaceTextures.js';

// "1940's New York" -- a block of Broadway at Times Square, modelled from a colour
// photograph taken in the summer of 1949.
//
// Everything here follows the house rules at the top of PropKit.js: authored in FEET at
// scale 1, a Group whose origin is its BASE CENTRE, fresh materials per call, seeded
// randomness only.
//
// One extra convention that is local to this file and worth stating once, because every
// layout entry depends on it: **a building or a vehicle is authored FACING +Z.** A plain
// Object3D's forward is its own +Z (the same fact browserStation() relies on), so a
// west-side building whose front looks east across the street is placed with
// rotY = +PI/2, an east-side one with -PI/2, and a car driving north (-Z) with rotY = PI.
//
// The scale reference is the crowd in the photograph. A 1940s cab roof comes to about
// the shoulder of the man walking beside it, the theatre marquee clears the sidewalk by
// nearly two of him, and the Bond statues stand four storeys over the street. Those
// ratios are what every size below is checked against -- the player is 5ft.

// ---------------------------------------------------------------------------
// Shared palette + canvas helpers
// ---------------------------------------------------------------------------

// Window glass, mostly dark with a couple of sky-reflecting panes. These are diffuse
// colours on recessed boxes, not a transparency effect: a real window seen from the
// street at noon is a dark hole with a bright reflection across the top of it, and
// modelling that as colour costs nothing and never sorts wrongly against the facade.
const GLASS_SHADES = [0x2f3a45, 0x36434f, 0x293039, 0x3d4c5a, 0x242d36];

const STONE_LIGHT = 0xc9c0ad;
const STONE_MID = 0xb0a691;
const ASPHALT = 0x56555a;
const CONCRETE = 0x9c988d;

// Draws `text` centred (or aligned) at (x, y), shrinking the point size until it fits
// `maxWidth`. Sign copy is written by the layout, not measured by it, so every sign in
// this world would otherwise be one long film title away from running off its own board.
function fitText(ctx, text, x, y, maxWidth, size, font, align = 'center') {
  let s = size;
  ctx.font = font(s);
  while (s > 8 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = font(s);
  }
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  return s;
}

const SANS = (s) => `bold ${s}px "Helvetica Neue", Arial, sans-serif`;
const SANS_LIGHT = (s) => `${s}px "Helvetica Neue", Arial, sans-serif`;
const SERIF = (s) => `bold ${s}px Georgia, "Times New Roman", serif`;
const SCRIPT = (s) => `italic bold ${s}px Georgia, "Times New Roman", serif`;

// A ring of marquee bulbs painted around the edge of a sign canvas.
//
// These are painted, not modelled, everywhere except the hero theatre's own marquee. A
// Times Square sign carries a few hundred bulbs; at 4 triangles each that is affordable
// once and ruinous fifteen times, and from across a 44ft street a painted bulb with a
// soft halo under it is indistinguishable from a modelled one.
function bulbBorder(ctx, w, h, { spacing = 40, radius = 7, color = '#ffeec2', glow = 'rgba(255,214,130,0.45)' } = {}) {
  const dot = (x, y) => {
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const inset = radius * 2.2;
  const across = Math.max(2, Math.round((w - inset * 2) / spacing));
  const down = Math.max(2, Math.round((h - inset * 2) / spacing));
  for (let i = 0; i <= across; i++) {
    const x = inset + ((w - inset * 2) * i) / across;
    dot(x, inset);
    dot(x, h - inset);
  }
  for (let i = 1; i < down; i++) {
    const y = inset + ((h - inset * 2) * i) / down;
    dot(inset, y);
    dot(w - inset, y);
  }
}

// A lit sign face: a flat field, an optional bulb border, and a stack of centred lines.
// Each line is { text, size (fraction of canvas height), color, font, gap }.
function signTexture({ width = 1024, height = 320, face = '#16294f', lines = [], bulbs = true, pad = 0.09 }) {
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    if (bulbs) bulbBorder(ctx, w, h);

    const margin = w * pad;
    const totalWeight = lines.reduce((sum, line) => sum + line.size + (line.gap ?? 0.05), 0);
    // Vertically centre the whole stack rather than starting from a fixed baseline: a
    // one-line sign and a four-line one share this function, and a fixed top leaves the
    // short one sitting up under the bulbs.
    let y = (h - totalWeight * h) / 2;
    for (const line of lines) {
      const size = line.size * h;
      y += size;
      ctx.fillStyle = line.color || '#f6f1e4';
      fitText(ctx, line.text, w / 2, y, w - margin * 2, size, line.font || SANS);
      y += (line.gap ?? 0.05) * h;
    }
  });
}

// Vertical blade lettering -- one character per line down a tall, narrow canvas, which is
// how every one of these signs in the photograph is actually set. Rotating a horizontal
// word 90 degrees is the instinctive version and it is wrong: a blade sign is read from
// the street below, and stacked capitals is what makes that possible.
function bladeTexture(text, { face = '#8c1c22', ink = '#fdf3dc', width = 256 } = {}) {
  const letters = [...String(text).toUpperCase()];
  const height = Math.round((width * letters.length) / 1.15);
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = face;
    ctx.fillRect(0, 0, w, h);
    bulbBorder(ctx, w, h, { spacing: 46, radius: 8 });
    const cell = h / letters.length;
    ctx.fillStyle = ink;
    letters.forEach((ch, i) => {
      fitText(ctx, ch, w / 2, cell * (i + 0.5) + cell * 0.31, w * 0.62, cell * 0.8, SANS);
    });
  });
}

// ===========================================================================
// GEOMETRY KIT -- lofted hulls, swept profiles and mitred mouldings
// ===========================================================================
//
// This file was first built entirely from axis-aligned boxes, and for a city of stone
// that is nearly defensible: a building IS a box, and the interesting part of one is its
// mouldings. It was never defensible for the object this world is actually about. A 1948
// automobile has no flat panel anywhere on it -- the hood crowns, the fenders are
// pontoons swept over the wheels, the roof falls into the deck in a single curve -- and
// the taxi is parked 24ft from the spawn point facing the student, which is as close as
// anything in this app is ever looked at. It read as a carton on four cylinders.
//
// Four helpers replace the boxes, and between them they also make the gap rule
// STRUCTURAL rather than remembered:
//
//   bodyLoft()      a closed hull whose section changes shape along its length
//   sweepProfile()  a closed 2D outline swept along a 3D path on a parallel-transport
//                   frame, capped at both ends
//   mouldedRing()   a moulding profile mitred round a rectangle -- every cornice, plinth,
//                   belt course and parapet in the world
//   extrudeOutline() the same profile run straight, for sills, curbs and rails
//
// Every one of them emits a CLOSED solid. There is no path through this kit that leaves
// an open ring or an unmatched edge, which is the only way "leave no open spaces" holds
// up across a file this size.

// Catmull-Rom through a list of scalars, sampled by normalised position along the list.
// Each channel of a loft is splined SEPARATELY against station index -- including the
// station's own z -- so uneven spacing comes out smooth without the caller pre-solving
// arc length.
function splineAt(values, t) {
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
    2 * p1 +
    (p2 - p0) * f +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
    (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f
  );
}

// A point on a SUPERELLIPSE with independent half-heights and independent roundness
// above and below the axis.
//
// This is the single idea the whole vehicle rebuild rests on. `taperedTube` sweeps a
// CIRCLE, so a body's aspect ratio can only be faked by scaling the finished sweep --
// one ratio for the entire object. A car's section does not work like that: it is a
// broad shallow crown over the hood, a near-rectangle with softened corners through the
// doors, and a deep round pontoon at the fender. `round` = 1 is a true ellipse, 0.5 a
// squircle, 0.2 very nearly a rectangle with a filleted corner.
function superXY(u, a, bUp, bDn, roundUp, roundDn) {
  const theta = u * Math.PI * 2;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const up = s >= 0;
  const p = Math.max(0.08, up ? roundUp : roundDn);
  const x = Math.sign(c) * Math.pow(Math.abs(c), p) * a;
  const y = Math.sign(s) * Math.pow(Math.abs(s), p) * (up ? bUp : bDn);
  return [x, y];
}

// Averages the normals of the duplicated seam column a wrapped grid has to carry.
//
// A loft has to emit the vertices at u = 0 again as u = 1, because one vertex cannot hold
// both ends of a texture coordinate -- and computeVertexNormals then treats the two
// copies as unrelated surfaces and creases the result exactly where it should be
// smoothest. On a car body that is a hard line straight down the centre of the roof.
function weldSeam(geometry, ring, rows) {
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

// A closed hull lofted through a list of stations along Z.
//
// Station: { z, w (half-width), up, dn, x, y, round | roundUp, roundDn }. Every channel
// is splined independently, so width, crown height, rocker depth and section shape can
// each do their own thing along the length -- which is what carries a car, a bus roof or
// a fender pontoon.
//
// Both ends are ALWAYS closed with a fan, so a hull can never be looked into. Author the
// end stations small (w and up/dn of a few hundredths of a foot) and the fan is a point.
function loftSampler(stations) {
  const chan = (key, fallback) => stations.map((s) => (s[key] === undefined ? fallback : s[key]));
  const cz = chan('z', 0);
  const cw = chan('w', 1).map((v) => Math.max(1e-4, v));
  const cu = chan('up', 1).map((v) => Math.max(1e-4, v));
  const cd = chan('dn', 1).map((v) => Math.max(1e-4, v));
  const cx = chan('x', 0);
  const cy = chan('y', 0);
  const cru = stations.map((s) => s.roundUp ?? s.round ?? 1);
  const crd = stations.map((s) => s.roundDn ?? s.round ?? 1);

  const sample = (t, u) => {
    const A = Math.max(1e-4, splineAt(cw, t));
    const U = Math.max(1e-4, splineAt(cu, t));
    const D = Math.max(1e-4, splineAt(cd, t));
    const [px, py] = superXY(u, A, U, D, splineAt(cru, t), splineAt(crd, t));
    return [splineAt(cx, t) + px, splineAt(cy, t) + py, splineAt(cz, t)];
  };
  sample.axis = (t) => [splineAt(cx, t), splineAt(cy, t), splineAt(cz, t)];
  sample.forward = splineAt(cz, 1) >= splineAt(cz, 0);

  // Inverses, so a caller can say "the side window runs from z = -4.2 to z = 1.9 and from
  // y = 3.6 up to y = 5.3" instead of solving a superellipse by hand. Everything applied
  // to a lofted body -- glass, chrome sweeps, a cab's checkerboard -- is placed this way.
  sample.tAtZ = (z) => {
    let lo = 0;
    let hi = 1;
    const rising = splineAt(cz, 1) >= splineAt(cz, 0);
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if ((splineAt(cz, mid) < z) === rising) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // u on the +X flank only, where y is monotonic in u over (-1/4, 1/4).
  sample.uAtY = (t, y) => {
    let lo = -0.2499;
    let hi = 0.2499;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (sample(t, mid)[1] < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return sample;
}

function bodyLoft(stations, { sides = 22, samples = 30 } = {}) {
  const sample = loftSampler(stations);
  const ring = sides + 1;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    for (let j = 0; j <= sides; j++) {
      positions.push(...sample(t, j / sides));
      uvs.push(t, j / sides);
    }
  }

  // Winding follows the direction z actually runs. A car authored nose-first has its
  // stations in DECREASING z, and without this every panel on it renders inside out --
  // which under a MeshStandardMaterial reads as a black car, not as a missing one.
  const forward = sample.forward;
  const quad = (a, b, c, d) =>
    forward ? indices.push(a, d, b, b, d, c) : indices.push(a, b, d, b, c, d);
  for (let i = 1; i <= samples; i++) {
    for (let j = 1; j <= sides; j++) {
      quad(ring * (i - 1) + (j - 1), ring * i + (j - 1), ring * i + j, ring * (i - 1) + j);
    }
  }

  // End caps, as fans about each end station's own centre.
  for (const end of [0, 1]) {
    const centre = positions.length / 3;
    positions.push(...sample.axis(end));
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

// Signed area of a closed 2D outline, so a caller can write a profile in whichever
// direction reads best and still get outward-facing sides.
function outlineArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function normalisedOutline(points) {
  return outlineArea(points) < 0 ? [...points].reverse() : points;
}

// Triangulates a closed outline for an end cap. Ear clipping rather than a fan, because
// a moulding profile is not convex -- an ogee has a hollow in it, and a fan across that
// hollow puts triangles outside the solid.
function capTriangles(outline) {
  const contour = outline.map(([x, y]) => new THREE.Vector2(x, y));
  return THREE.ShapeUtils.triangulateShape(contour, []);
}

// A closed 2D outline extruded straight along +Z, with hard side edges and both ends
// capped. Curbs, sills, rails, chamfered boxes, the marquee fascia, the blade sign.
//
// Hard edges are the point: this is what mouldings and stonework want, and it is why
// these are not built with bodyLoft. Each side quad gets its own vertices, so
// computeVertexNormals gives a crisp arris at every break in the profile.
function extrudeOutline(outline, depth, { capStart = true, capEnd = true } = {}) {
  const pts = normalisedOutline(outline);
  const n = pts.length;
  const half = depth / 2;
  const positions = [];
  const uvs = [];
  const indices = [];

  let run = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const seg = Math.hypot(x2 - x1, y2 - y1);
    const base = positions.length / 3;
    positions.push(x1, y1, -half, x2, y2, -half, x2, y2, half, x1, y1, half);
    uvs.push(run, 0, run + seg, 0, run + seg, depth, run, depth);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    run += seg;
  }

  if (capStart || capEnd) {
    const faces = capTriangles(pts);
    for (const [z, want, flip] of [[-half, capStart, true], [half, capEnd, false]]) {
      if (!want) continue;
      const base = positions.length / 3;
      for (const [x, y] of pts) {
        positions.push(x, y, z);
        uvs.push(x, y);
      }
      for (const f of faces) {
        if (flip) indices.push(base + f[0], base + f[2], base + f[1]);
        else indices.push(base + f[0], base + f[1], base + f[2]);
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

// A moulding profile carried right round a rectangle and MITRED at the corners.
//
// The profile is a list of [out, up]: how far the point stands proud of the rectangle's
// face, and how high it sits. The trick that makes the mitre exact is that a profile
// point standing `out` proud of every face traces a rectangle of half-size
// (halfW + out, halfD + out) -- so the whole moulding is a stack of rectangles, and the
// corners meet at 45 degrees by construction with no mitre arithmetic anywhere.
//
// This one helper is most of what separates the rebuilt buildings from the first pass.
// A cornice is not a box that overhangs; it is a cyma over a corona over a bed mould, and
// the shadow line under it is what says "carved stone" from across the street.
function mouldedRing(profile, halfW, halfD, { closeTop = false, closeBottom = false } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const n = profile.length;

  // One quad strip per side, with its own vertices, so the four arrises stay sharp.
  const sides = [
    { nx: 0, nz: 1, span: halfW, axis: 'x' },
    { nx: 1, nz: 0, span: halfD, axis: 'z' },
    { nx: 0, nz: -1, span: halfW, axis: 'x' },
    { nx: -1, nz: 0, span: halfD, axis: 'z' },
  ];
  for (const side of sides) {
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const [out, up] = profile[i];
      const a = (side.axis === 'x' ? halfW : halfD) + out;
      const b = (side.axis === 'x' ? halfD : halfW) + out;
      const p0 = side.axis === 'x' ? [-a, up, side.nz * b] : [side.nx * b, up, a];
      const p1 = side.axis === 'x' ? [a, up, side.nz * b] : [side.nx * b, up, -a];
      positions.push(...p0, ...p1);
      uvs.push(0, up, 1, up);
    }
    for (let i = 1; i < n; i++) {
      const a = base + (i - 1) * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // +Z face runs -x -> +x; the winding below is what makes its normal face +Z, and
      // the other three sides inherit it through the coordinate swap above.
      if (side.nx + side.nz > 0) indices.push(a, b, c, b, d, c);
      else indices.push(a, c, b, b, c, d);
    }
  }

  // A ring is normally hidden against the wall it is applied to, but a free-standing one
  // (a parapet coping, a plinth cap) needs its top or bottom closed or you can see into
  // the band from above.
  const ends = [];
  if (closeBottom) ends.push({ index: 0, up: true });
  if (closeTop) ends.push({ index: n - 1, up: false });
  for (const end of ends) {
    const [out, up] = profile[end.index];
    const a = halfW + out;
    const b = halfD + out;
    const inner = 0.001;
    const base = positions.length / 3;
    positions.push(-a, up, b, a, up, b, a, up, -b, -a, up, -b);
    positions.push(-a * inner, up, b * inner, a * inner, up, b * inner, a * inner, up, -b * inner, -a * inner, up, -b * inner);
    for (let i = 0; i < 8; i++) uvs.push(0, 0);
    for (let i = 0; i < 4; i++) {
      const p = base + i;
      const q = base + ((i + 1) % 4);
      const r = base + 4 + ((i + 1) % 4);
      const s = base + 4 + i;
      if (end.up) indices.push(p, q, r, p, r, s);
      else indices.push(p, r, q, p, s, r);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// Parallel-transport frames along a curve.
//
// NOT Frenet frames, which is what taperedTube uses and what three.js supplies. A Frenet
// frame is defined by the curve's second derivative, so it spins wildly where the curve
// is nearly straight and flips outright through an inflection -- and a fender arch is
// exactly a curve with a straight run at each end and a bend in the middle. Transporting
// one frame along the curve instead keeps the section's "up" pointing where the caller
// put it for the whole sweep.
function transportFrames(curve, samples, up) {
  const tangents = [];
  for (let i = 0; i <= samples; i++) tangents.push(curve.getTangentAt(i / samples).normalize());

  const normals = [];
  const binormals = [];
  let normal = new THREE.Vector3().copy(up).projectOnPlane(tangents[0]);
  if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0).projectOnPlane(tangents[0]);
  normal.normalize();
  normals.push(normal.clone());
  binormals.push(new THREE.Vector3().crossVectors(tangents[0], normal).normalize());

  const q = new THREE.Quaternion();
  for (let i = 1; i <= samples; i++) {
    q.setFromUnitVectors(tangents[i - 1], tangents[i]);
    normal = normal.clone().applyQuaternion(q).normalize();
    normals.push(normal.clone());
    binormals.push(new THREE.Vector3().crossVectors(tangents[i], normal).normalize());
  }
  return { tangents, normals, binormals };
}

// A closed 2D outline swept along a 3D path, capped at both ends.
//
// `profile` is in the frame's (normal, binormal) plane. `at(t)` may return
// { su, sv, ou, ov } to scale and offset the section along the sweep, which is how a
// fender pontoon swells over the wheel and tucks back into the body at each end.
function sweepProfile(points, profile, {
  samples = 24,
  up = new THREE.Vector3(1, 0, 0),
  at = null,
  smooth = true,
} = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const frames = transportFrames(curve, samples, up);
  const pts = normalisedOutline(profile);
  const n = pts.length;
  const ring = n + 1; // duplicated seam column, welded below

  const positions = [];
  const uvs = [];
  const indices = [];
  const centre = new THREE.Vector3();

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPointAt(t, centre);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const k = at ? at(t) : null;
    const su = k?.su ?? 1;
    const sv = k?.sv ?? 1;
    const ou = k?.ou ?? 0;
    const ov = k?.ov ?? 0;
    for (let j = 0; j <= n; j++) {
      const [pu, pv] = pts[j % n];
      const u = pu * su + ou;
      const v = pv * sv + ov;
      positions.push(
        centre.x + N.x * u + B.x * v,
        centre.y + N.y * u + B.y * v,
        centre.z + N.z * u + B.z * v
      );
      uvs.push(t, j / n);
    }
  }

  for (let i = 1; i <= samples; i++) {
    for (let j = 1; j <= n; j++) {
      const a = ring * (i - 1) + (j - 1);
      const b = ring * i + (j - 1);
      const c = ring * i + j;
      const d = ring * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  // Caps. A swept solid that stops in mid-air shows straight through itself, which is
  // the same lesson BodyProps.capEnd() records for vessels -- a tube is a sleeve.
  const faces = capTriangles(pts);
  for (const end of [0, 1]) {
    const i = end === 0 ? 0 : samples;
    const t = end;
    curve.getPointAt(t, centre);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    const k = at ? at(t) : null;
    const su = k?.su ?? 1;
    const sv = k?.sv ?? 1;
    const ou = k?.ou ?? 0;
    const ov = k?.ov ?? 0;
    const base = positions.length / 3;
    for (const [pu, pv] of pts) {
      const u = pu * su + ou;
      const v = pv * sv + ov;
      positions.push(
        centre.x + N.x * u + B.x * v,
        centre.y + N.y * u + B.y * v,
        centre.z + N.z * u + B.z * v
      );
      uvs.push(pu, pv);
    }
    for (const f of faces) {
      if (end === 0) indices.push(base + f[0], base + f[1], base + f[2]);
      else indices.push(base + f[0], base + f[2], base + f[1]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  if (smooth) weldSeam(geometry, ring, samples + 1);
  return geometry;
}

// A closed slab lying ON a parametric surface, standing `lift` proud of it.
//
// LIFT HAS TO CLEAR THE HOST LOFT'S SAGITTA, not just its surface. Both the patch and the
// body it lies on are flat-sided approximations of the same smooth section, sampled at
// DIFFERENT spacings -- so between two of the patch's samples its quad cuts inside the
// body's, by roughly r(1 - cos(pi/sides)). On a 2.3ft cabin at 26 sides that is 0.017ft,
// and a patch lifted the 0.004 that looks generous on paper z-fights along its whole
// length: every roof in this world came out as a black and yellow checkerboard, which
// reads as a texture bug rather than as a depth one.
//
// This is how everything applied to a curved body is made: the glass in a cabin, the
// chrome sweep along a belt line, the checkerboard on a cab door. Sampling the body's
// OWN surface function is the point -- a flat panel stuck on a curved flank either cuts
// into it in the middle or floats off it at the edges, and on a car the eye reads that
// instantly as two objects rather than one.
//
// It is a closed solid, not a sheet: a front face, a back face and a rim joining them,
// with the rim emitted in BOTH windings so a patch can never be seen through from behind.
function surfacePatch(sample, {
  t0, t1, u0, u1, nt = 8, nu = 8, lift = 0.02, thick = 0.03, flipU = false,
} = {}) {
  const P = (a, b) => {
    const p = sample(a, b);
    return new THREE.Vector3(p[0], p[1], p[2]);
  };
  const eps = 1e-3;
  const rows = nt + 1;
  const cols = nu + 1;
  const front = [];
  const back = [];
  for (let i = 0; i <= nt; i++) {
    const a = THREE.MathUtils.lerp(t0, t1, i / nt);
    for (let j = 0; j <= nu; j++) {
      const b = THREE.MathUtils.lerp(u0, u1, j / nu);
      const p = P(a, b);
      const dt = P(Math.min(1, a + eps), b).sub(P(Math.max(0, a - eps), b));
      const du = P(a, b + eps).sub(P(a, b - eps));
      const n = new THREE.Vector3().crossVectors(du, dt).normalize();
      // Outward is away from the section's own axis, which is the only reliable test on a
      // surface whose parameterisation direction the caller is free to reverse.
      const axis = sample.axis ? sample.axis(a) : [0, 0, p.z];
      const outward = p.clone().sub(new THREE.Vector3(axis[0], axis[1], axis[2]));
      if (n.dot(outward) < 0) n.negate();
      front.push(p.clone().addScaledVector(n, lift + thick));
      back.push(p.clone().addScaledVector(n, lift));
    }
  }

  const positions = [];
  const uvs = [];
  const indices = [];
  const push = (list) => {
    const base = positions.length / 3;
    for (let i = 0; i < list.length; i++) {
      positions.push(list[i].x, list[i].y, list[i].z);
      // U runs along t (front to back), V up the section. `flipU` is needed on one flank
      // of anything carrying lettering: seen from +X the body's +Z runs to the left, so
      // without it a door decal comes out mirrored on that side and correct on the other.
      const su = Math.floor(i / cols) / nt;
      uvs.push(flipU ? 1 - su : su, (i % cols) / nu);
    }
    return base;
  };
  const fb = push(front);
  const bb = push(back);
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < nu; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      indices.push(fb + a, fb + b, fb + c, fb + a, fb + c, fb + d);
      indices.push(bb + a, bb + c, bb + b, bb + a, bb + d, bb + c);
    }
  }
  // The rim, in both windings. Eighty triangles against a whole class of inside-out bug.
  const edge = [];
  for (let j = 0; j < nu; j++) edge.push([j, j + 1]);
  for (let i = 0; i < nt; i++) edge.push([i * cols + nu, (i + 1) * cols + nu]);
  for (let j = nu; j > 0; j--) edge.push([nt * cols + j, nt * cols + j - 1]);
  for (let i = nt; i > 0; i--) edge.push([i * cols, (i - 1) * cols]);
  for (const [p, q] of edge) {
    indices.push(fb + p, fb + q, bb + q, fb + p, bb + q, bb + p);
    indices.push(fb + p, bb + q, fb + q, fb + p, bb + p, bb + q);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// A closed outline of a rounded rectangle, for profiles and chamfers.
function roundedOutline(halfW, halfH, radius, cornerSteps = 4) {
  const r = Math.min(radius, halfW, halfH);
  const out = [];
  const corners = [
    [halfW - r, halfH - r, 0],
    [-(halfW - r), halfH - r, Math.PI / 2],
    [-(halfW - r), -(halfH - r), Math.PI],
    [halfW - r, -(halfH - r), Math.PI * 1.5],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= cornerSteps; i++) {
      const a = a0 + (i / cornerSteps) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

// A box with its four long edges chamfered, extruded along Z. Cheap, and it is the
// difference between a sign box and a slab: a real fabricated sign has a rolled edge, and
// the highlight running along that edge is most of what makes it read as an object.
function chamferBox(w, h, d, chamfer = 0.12) {
  return extrudeOutline(roundedOutline(w / 2, h / 2, chamfer, 2), d);
}

// Lathe a closed profile about Y. Hydrant bonnets, lamp bases, hubcaps, tyres, finials,
// newel balls, traffic-signal visors -- most of the small hardware in this world is
// literally a casting turned about its own axis, and saying so gives both a better shape
// and fewer triangles than the stack of cylinders it replaces.
//
// Write the profile as a CLOSED loop (last point back at the first) and the result is a
// closed solid; a radius of exactly 0 at an end closes it on the axis instead.
function revolve(profile, segments = 18, start = 0, sweep = Math.PI * 2) {
  return new THREE.LatheGeometry(
    profile.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y)),
    segments,
    start,
    sweep
  );
}

// Adds a part to a merge list. Every builder here works through this so a part's colour,
// rotation and translation are always applied in the one order mergeColored applies them.
function put(list, geometry, color, position = null, rotation = null) {
  list.push({ geometry, color, position, rotation });
  return geometry;
}

// Bakes a full Matrix4 into a geometry, and reverses the winding if the matrix mirrors.
//
// mergeColored only carries axis-aligned Euler rotations applied X then Y then Z, which
// cannot express "swing this arch into the wall's plane and then tip it". Every part that
// needs a compound placement goes through here instead -- the same escape hatch
// RomeProps.xformed() and gooseSolid() exist for.
function xformed(geometry, matrix) {
  const g = geometry.clone();
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) {
    const index = g.index;
    if (index) {
      const a = index.array;
      for (let i = 0; i < a.length; i += 3) {
        const t = a[i + 1];
        a[i + 1] = a[i + 2];
        a[i + 2] = t;
      }
      index.needsUpdate = true;
    }
    g.computeVertexNormals();
  }
  return g;
}

// Multiplies a merged geometry's vertex colours by weathering: broad blotching, vertical
// grime streaks, and soot collecting toward the bottom of the elevation.
//
// This runs on the MERGED geometry rather than per part, and that is the whole reason it
// is affordable. Real coursed masonry is never one flat colour -- the sooty 1949 New York
// in the photograph least of all -- and putting that variation into geometry would mean
// hundreds of solids on every facade. As a per-vertex paint it costs nothing and it is
// the single biggest change to how the buildings read.
function soot(geometry, { amount = 0.09, scale = 0.055, streak = 0.5, base = 0, fade = 26, seed = 3 } = {}) {
  const color = geometry.attributes.color;
  const position = geometry.attributes.position;
  if (!color) return geometry;
  const wob = (x, y, z) =>
    Math.sin(x * scale * 3.1 + seed) * 0.5 +
    Math.sin(z * scale * 2.3 - seed * 1.7) * 0.3 +
    Math.sin((x + z) * scale * 5.7 + y * scale * 0.9 + seed * 2.3) * 0.2;
  for (let i = 0; i < color.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    let k = 1 + wob(x, y, z) * amount;
    if (streak > 0) {
      // Grime runs DOWN a facade, so the streak frequency is horizontal only and the
      // strength grows toward the bottom. A streak that varies with height as well reads
      // as camouflage rather than as weather.
      const s = Math.sin(x * 0.9 + seed * 3.3) * 0.5 + Math.sin(z * 1.31 - seed) * 0.5;
      const low = THREE.MathUtils.clamp(1 - (y - base) / fade, 0, 1);
      k *= 1 - streak * 0.16 * low * (0.55 + 0.45 * s * s);
    }
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
  }
  color.needsUpdate = true;
  return geometry;
}

// ---------------------------------------------------------------------------
// The street itself
// ---------------------------------------------------------------------------

// Roadway, curbs, sidewalks and markings, laid along Z as one prop.
//
// The road surface is one of the few places in this project where a PHOTOGRAPH earns its
// place (see the SurfaceTextures notes): it is big, dead flat, and walked over at close
// range, which is exactly the case generated noise loses. It is neutralised hard so the
// grey below decides the colour and the photo only supplies grit and wear.
//
// `crossings` are Z positions where a side street cuts through. The sidewalk is built as
// SEGMENTS between them rather than as one long slab with holes -- a 6in curb is a solid,
// and punching a gap in it after the fact would mean either CSG or a visible seam.
export function cityStreet({
  length = 280,
  roadWidth = 44,
  walkWidth = 12,
  crossings = [],
  seed = 5,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfRoad = roadWidth / 2;
  const outer = halfRoad + walkWidth;

  const asphalt = standard({
    color: ASPHALT,
    roughness: 1,
    // A tight repeat, deliberately. This photograph is being used for its GRIT, and at a
    // loose repeat its own large-scale variation reads as patches of a different material
    // spilled across the road rather than as asphalt.
    map: photoMap('ground-regolith.jpg', { repeat: 11, repeatY: 62, neutralize: 0.8 }),
    ...relief('soil', { seed: 11, repeat: 8, strength: 0.35 }),
  });

  // A CROWNED roadway, not a flat slab. Every street is built with a fall to the gutters
  // so it drains, and the crown is about four inches over twenty feet -- far too little
  // to notice as a slope and just enough that the highlight running down the middle of the
  // asphalt bends round parked cars instead of lying across the whole road in one band.
  const roadStations = [];
  const roadSteps = 8;
  for (let i = 0; i <= roadSteps; i++) {
    const f = (i / roadSteps) * 2 - 1;
    roadStations.push([f * halfRoad, 0.11 + (1 - f * f) * 0.30]);
  }
  const roadOutline = [
    ...roadStations,
    [halfRoad, -0.4],
    [-halfRoad, -0.4],
  ];
  const road = mesh(extrudeOutline(roadOutline, length), asphalt);
  road.castShadow = false; // a slab lying on the ground has nothing to cast onto
  g.add(road);

  for (const z of crossings) {
    // The cross street is the same crowned profile turned through 90 degrees, so the two
    // roadways meet crown to crown instead of one slab lying across the other's camber.
    const cross = mesh(extrudeOutline(roadOutline, outer * 2 + 24), asphalt);
    cross.rotation.y = Math.PI / 2;
    cross.position.set(0, 0.005, z);
    cross.castShadow = false;
    g.add(cross);
  }

  // Sidewalk: a concrete slab with a flagstone joint pattern drawn on it, plus a granite
  // curb along the roadway edge.
  const jointTile = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(70,68,62,0.42)';
    ctx.lineWidth = 5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo((w / 4) * i, 0);
      ctx.lineTo((w / 4) * i, h);
      ctx.moveTo(0, (h / 4) * i);
      ctx.lineTo(w, (h / 4) * i);
      ctx.stroke();
    }
  });
  jointTile.wrapS = THREE.RepeatWrapping;
  jointTile.wrapT = THREE.RepeatWrapping;
  jointTile.repeat.set(3, Math.max(3, Math.round(length / 16)));

  const walkMat = standard({ color: CONCRETE, roughness: 0.96, map: jointTile, bumpMap: jointTile, bumpScale: 0.5 });
  const curbMat = standard({ color: 0x7c7972, roughness: 0.9, ...relief('stone', { seed: 23, repeat: 6 }) });

  // A real curb has a ROUNDED NOSE and a batter on its face, and the highlight along that
  // nose is what draws the line between road and sidewalk from a hundred feet away. Built
  // as a plain box it is a grey step, and the two surfaces read as one.
  const curbOutline = [
    [-0.45, -0.5], [0.45, -0.5], [0.45, 0.34], [0.40, 0.48],
    [0.30, 0.57], [0.16, 0.60], [-0.45, 0.60],
  ];

  // Segments between the crossings. Sorted so a layout can list them in any order.
  const cuts = [...crossings].sort((a, b) => a - b);
  const edges = [-length / 2, ...cuts.flatMap((z) => [z - halfRoad, z + halfRoad]), length / 2];
  for (let i = 0; i < edges.length; i += 2) {
    const from = edges[i];
    const to = edges[i + 1];
    const span = to - from;
    if (span <= 0.5) continue;
    const cz = (from + to) / 2;
    for (const side of [-1, 1]) {
      const walk = box(walkWidth, 0.5, span, walkMat, side * (halfRoad + walkWidth / 2), 0.25, cz);
      walk.castShadow = false;
      g.add(walk);
      const curb = mesh(extrudeOutline(curbOutline, span), curbMat);
      curb.scale.x = side;
      curb.position.set(side * (halfRoad - 0.05), 0.25, cz);
      g.add(curb);
    }
  }

  // Markings. A 1940s New York avenue is marked far more sparsely than a modern one --
  // a dashed lane line and painted crosswalk ladders, no edge lines, no arrows.
  const paint = [];
  const white = 0xd8d4c6;
  for (let z = -length / 2 + 6; z < length / 2 - 6; z += 16) {
    if (cuts.some((c) => Math.abs(z - c) < halfRoad + 4)) continue;
    paint.push({ geometry: new THREE.BoxGeometry(0.5, 0.03, 7), position: [0, 0.42, z + 3.5], color: white });
  }
  for (const z of cuts) {
    for (const side of [-1, 1]) {
      const at = z + side * (halfRoad + 1.6);
      for (let i = 0; i < 9; i++) {
        const x = -halfRoad + 2.4 + i * ((roadWidth - 4.8) / 8);
        const drop = 0.41 - Math.pow(x / halfRoad, 2) * 0.30;
        paint.push({ geometry: new THREE.BoxGeometry(1.5, 0.03, 5.5), position: [x, drop, at], color: white });
      }
    }
  }
  if (paint.length) {
    const marks = mergedMesh(paint, { roughness: 0.95 });
    marks.castShadow = false;
    g.add(marks);
  }

  // Manhole covers and a couple of steam-vent plates, scattered off the lane line. The
  // cover is dished and lettered with a ring of radial ribs, which is what makes it read
  // as cast iron rather than as a coin dropped on the road.
  const iron = [];
  for (let i = 0; i < Math.max(3, Math.round(length / 42)); i++) {
    const z = randomIn(rng, -length / 2 + 20, length / 2 - 20);
    const x = randomIn(rng, -halfRoad + 5, halfRoad - 5);
    const drop = 0.40 - Math.pow(x / halfRoad, 2) * 0.30;
    iron.push({
      geometry: revolve([[0, 0], [1.02, 0], [1.14, 0.03], [1.18, 0.09], [1.18, -0.14], [0, -0.14]], 20),
      position: [x, drop, z],
      color: 0x4a453e,
    });
    for (let r = 0; r < 12; r++) {
      const a = (r / 12) * Math.PI * 2;
      iron.push({
        geometry: new THREE.BoxGeometry(0.62, 0.04, 0.14),
        rotation: [0, a, 0],
        position: [x + Math.cos(a) * 0.5, drop + 0.10, z + Math.sin(a) * 0.5],
        color: 0x565049,
      });
    }
  }
  const covers = mergedMesh(iron, { roughness: 0.85, metalness: 0.35, ...relief('metal', { seed: 61, repeat: 2 }) });
  covers.castShadow = false;
  g.add(covers);

  return g;
}

// ---------------------------------------------------------------------------
// Primary model 1 -- the yellow taxi (and the traffic around it)
// ---------------------------------------------------------------------------

// A station written the way a car is actually measured: a half-width, a TOP and a BOTTOM
// at that point along the body, plus how square the section is above and below its own
// mid-height. Converting to the loft's axis/up/dn form here rather than at every call
// site is worth it -- "the belt line is at 3.50 and the rocker at 0.92" is a statement a
// person can check against a photograph, and "y = 2.21, up = 1.29" is not.
const carStation = (z, w, top, bot, roundUp = 0.45, roundDn = 0.34) => ({
  z,
  w,
  y: (top + bot) / 2,
  up: (top - bot) / 2,
  dn: (top - bot) / 2,
  roundUp,
  roundDn,
});

// The shared skeleton of every car in this world, authored facing +Z.
//
// The whole of this used to be axis-aligned boxes, and the four rules it recorded were
// all correct and all defeated by the primitive they were written in. A 1948 automobile
// has no flat panel anywhere on it, and the hero cab is parked 24ft from the spawn point
// FACING the student -- the closest look this app ever asks anything to survive.
//
// So the body is now TWO lofted hulls and everything else is applied to their own surface
// functions. What each piece is for:
//
//  1. THE LOWER HULL is one closed solid from tail to nose -- deck, doors, cowl, hood and
//     the rounded prow the grille hangs on. Its section is a superellipse whose roundness
//     changes along the length: nearly rectangular with a soft corner through the doors,
//     a broad shallow crown over the hood, fully rounded at the prow. That single property
//     is most of what makes it a car. There is no seam anywhere on it, because there is
//     no join anywhere on it.
//  2. THE CABIN is a second hull sitting on the first, rooted four inches INSIDE it at the
//     belt line, falling in one curve from the roof into the deck. The glass is applied to
//     the cabin's own surface, so the body colour left showing between the panes IS the
//     pillar -- which is how a real greenhouse is read, and it means no pillar can ever
//     be a hair out of line with the roof it holds up.
//  3. THE FENDERS are closed pontoons swept over each wheel on a parallel-transport frame.
//     Their profile reaches far enough INBOARD to bury itself in the hull at every point
//     along the sweep, which is what closes the fender-to-body joint by construction.
//     They are emphatically not partial cylinders: a partial CylinderGeometry is capped at
//     its flat ends, and that cap is a solid half-disc sitting exactly where the wheel
//     should be seen. The first version of this file had that, and every car on the street
//     read as a bulldozer.
//  4. WHEELS ARE SOLIDS OF REVOLUTION, one closed profile each for tyre, whitewall and
//     hubcap. Three stacked cylinders cannot give a tyre a shoulder, and the shoulder is
//     where all of the light on a tyre is.
//
// The period cues that survive from the first pass, because they were never about the
// primitive: separate pontoon fenders with the wheel visible under the arch, running
// boards bridging them, a tall upright cabin well back over a long hood, and a SPLIT
// windshield -- flat safety glass could not be curved in 1948, so every screen of the
// period is two panes meeting at a shallow vee, and that centre bar is recognisable from
// right across the street.
function periodCarParts({
  bodyColor,
  roofColor,
  seed = 3,
  coupe = false,
  nose = 8.92,
  tail = -7.60,
  cabF = 2.55,
  cabR = -7.05,
  halfW = 2.48,
}) {
  const paint = [];
  const chrome = [];
  const dark = [];
  const glass = [];
  const lamps = [];

  const WHEEL_R = 1.25;
  const axleF = 5.05;
  const axleR = -4.45;
  const trackX = 2.36;
  const fenderX = 2.52;
  const BELT = 3.50;
  const ROOF = 5.60;
  const ROCKER = 0.92;
  const chromeColor = 0xcfd2d4;
  const glassColor = 0x243138;
  const shadeColor = 0x14161a;

  // --- the lower hull ------------------------------------------------------------------
  const lower = [
    // The tail is FULL, like the prow. A sedan of this date has a deep rounded trunk, and
    // running the loft to a point at both ends gives it a boat tail it never had.
    carStation(tail, 1.26, 3.02, 2.06, 1, 1),
    carStation(tail + 0.30, 1.72, 3.20, 1.72, 0.82, 0.66),
    carStation(tail + 0.85, 2.06, 3.32, 1.35, 0.62, 0.48),
    carStation(tail + 1.60, 2.30, 3.42, 1.06, 0.52, 0.40),
    carStation(axleR - 0.15, halfW - 0.04, 3.48, 0.96, 0.44, 0.32),
    carStation(-2.60, halfW - 0.01, BELT, ROCKER, 0.40, 0.28),
    carStation(0.00, halfW, BELT, ROCKER, 0.38, 0.27),
    carStation(2.10, halfW - 0.02, 3.52, 0.94, 0.40, 0.29),
    carStation(3.10, 2.32, 3.66, 1.02, 0.50, 0.34),
    carStation(4.30, 1.94, 3.74, 1.10, 0.62, 0.40),
    carStation(6.20, 1.88, 3.75, 1.14, 0.68, 0.42),
    // The prow does NOT taper to a point, and that is a correction rather than a style
    // choice. A 1948 front end is essentially the grille: the body carries a full section
    // right up to the face, gently bowed in plan. Run it to a rounded tip instead and the
    // grille has nowhere to sit -- the first pass tapered to 0.05ft at the nose and every
    // chrome bar ended up buried INSIDE the bodywork, so the cars had bare yellow faces.
    carStation(nose - 1.30, 1.80, 3.70, 1.22, 0.74, 0.50),
    carStation(nose - 0.60, 1.70, 3.56, 1.34, 0.80, 0.60),
    carStation(nose - 0.18, 1.56, 3.40, 1.56, 0.88, 0.72),
    carStation(nose, 1.34, 3.16, 1.86, 1, 1),
  ];
  const hull = loftSampler(lower);
  put(paint, bodyLoft(lower, { sides: 30, samples: 42 }), bodyColor);

  // --- the cabin -----------------------------------------------------------------------
  const cab = [
    carStation(cabR, 0.05, 3.28, 3.22, 1, 1),
    carStation(cabR + 0.35, 1.15, 3.62, 3.10, 0.70, 0.60),
    carStation(cabR + 0.95, 1.72, 4.02, 3.05, 0.60, 0.50),
    carStation(cabR + 1.75, 2.06, 4.52, 3.05, 0.50, 0.42),
    carStation(cabR + 2.65, 2.22, 4.98, 3.08, 0.42, 0.36),
    carStation(cabR + 3.85, 2.30, 5.34, 3.10, 0.34, 0.32),
    carStation(cabF - 3.75, 2.33, ROOF - 0.05, 3.12, 0.30, 0.30),
    carStation(cabF - 1.95, 2.33, ROOF, 3.12, 0.30, 0.30),
    carStation(cabF - 0.65, 2.28, ROOF - 0.04, 3.12, 0.32, 0.31),
    carStation(cabF, 2.14, 5.42, 3.14, 0.40, 0.36),
    carStation(cabF + 0.50, 1.92, 4.86, 3.20, 0.55, 0.45),
    carStation(cabF + 0.80, 1.72, 4.20, 3.30, 0.70, 0.60),
    carStation(cabF + 0.95, 0.05, 3.70, 3.60, 1, 1),
  ];
  const cabin = loftSampler(cab);
  put(paint, bodyLoft(cab, { sides: 26, samples: 34 }), bodyColor);

  // A DARK INTERIOR, just inside the cabin shell. Every pane on this car is a translucent
  // slab lying on the cabin's own surface, and what a viewer sees through it is whatever
  // is behind -- which, without this, is the yellow cabin itself. The windows came out as
  // murky yellow panels: present, correctly shaped, and reading as dirty plastic rather
  // than as glass. Cars are dark inside, and one inset loft is the whole fix.
  put(dark, bodyLoft(
    cab.map((s) => ({ ...s, w: s.w * 0.93, up: s.up * 0.9, dn: s.dn * 0.9, y: s.y + s.up * 0.04 })),
    { sides: 20, samples: 24 }
  ), shadeColor);

  // The ROOF PANEL is a patch over the crown of the cabin, not the whole cabin.
  //
  // Painting the entire greenhouse in the roof colour is the obvious thing to do and it
  // is wrong on any two-tone car: a New York cab is yellow to the drip rail with a black
  // TOP, and colouring the whole cabin dark turns the pillars, the window surrounds and
  // the quarter panels black as well -- which reads as a black box set down on a yellow
  // body rather than as a car with a painted roof.
  {
    const t0 = cabin.tAtZ(cabF + 0.02);
    const t1 = cabin.tAtZ(cabR + 0.45);
    const edge = cabin.uAtY(0.5, ROOF - 0.30);
    put(paint, surfacePatch(cabin, {
      t0, t1, u0: edge, u1: 0.5 - edge, nt: 18, nu: 14, lift: 0.032, thick: 0.035,
    }), roofColor);
  }

  // --- glass ---------------------------------------------------------------------------
  // Every pane is a slab lying on the CABIN's own surface, so the pillar between two of
  // them is simply the cabin showing through -- it cannot be a hair out of line with the
  // roof, because it IS the roof. Sizing a pane by eye against pillar positions was the
  // old way and it ran panes out of the back of the car on one body and left a stripe of
  // paint where a window should be on the other.
  const pane = (z0, z1, y0, y1, opts = {}) => {
    const t0 = cabin.tAtZ(z0);
    const t1 = cabin.tAtZ(z1);
    for (const side of [1, -1]) {
      const u0 = cabin.uAtY((t0 + t1) / 2, y0) * side;
      const u1 = cabin.uAtY((t0 + t1) / 2, y1) * side;
      const geometry = surfacePatch(cabin, {
        t0, t1, u0: side > 0 ? u0 : 0.5 - u0, u1: side > 0 ? u1 : 0.5 - u1,
        nt: opts.nt ?? 6, nu: 5, lift: 0.035, thick: 0.05,
      });
      put(glass, geometry, glassColor);
    }
  };
  pane(cabF - 3.55, cabF - 2.05, 3.72, 5.28); // front door
  pane(cabR + 2.35, cabF - 3.95, 3.72, 5.24); // rear door
  pane(cabR + 1.15, cabR + 2.05, 3.78, 4.62); // rear quarter light

  // Windshield and backlight sit across the CROWN of the cabin (u = 1/4), not across its
  // flank (u = 0). Both are surfaces swept by the top of the section as z advances -- a
  // raked screen and a fastback rear window are the same thing at opposite ends -- and
  // centring them on the equator by mistake puts the windscreen down the side of the car
  // where the doors are, which is a bug that reads as "the cabin has no glass at all".
  for (const [z0, z1, wide] of [[cabF - 0.10, cabF + 0.72, 0.145], [cabR + 0.80, cabR + 2.00, 0.135]]) {
    put(glass, surfacePatch(cabin, {
      t0: cabin.tAtZ(z0), t1: cabin.tAtZ(z1), u0: 0.25 - wide, u1: 0.25 + wide,
      nt: 6, nu: 10, lift: 0.035, thick: 0.05,
    }), glassColor);
  }
  // The split-screen centre bar. Flat safety glass could not be curved in 1948, so every
  // screen of the period is two panes meeting at a shallow vee, and that bar is
  // recognisable from right across the street.
  put(chrome, surfacePatch(cabin, {
    t0: cabin.tAtZ(cabF - 0.10), t1: cabin.tAtZ(cabF + 0.74), u0: 0.25 - 0.010, u1: 0.25 + 0.010,
    nt: 4, nu: 2, lift: 0.088, thick: 0.05,
  }), chromeColor);

  // --- fenders -------------------------------------------------------------------------
  // The profile reaches 0.95ft INBOARD of the crown line and only 0.55 outboard: the
  // outboard half is the pontoon a student sees, and the inboard half exists purely to be
  // buried in the hull for the whole length of the sweep. That asymmetry is the whole of
  // how the fender-to-body joint is closed -- there is no point along either fender where
  // its section does not overlap the body it grows out of.
  const fenderProfile = roundedOutline(0.75, 0.34, 0.30, 3).map(([u, v]) => [u - 0.20, v]);
  const fender = (path, taperStart, taperEnd) =>
    sweepProfile(path, fenderProfile, {
      samples: 22,
      up: new THREE.Vector3(1, 0, 0),
      at: (t) => {
        const ends = Math.min(
          THREE.MathUtils.smoothstep(t, 0, taperStart),
          THREE.MathUtils.smoothstep(1 - t, 0, taperEnd)
        );
        return { su: 0.62 + 0.38 * ends, sv: 0.55 + 0.45 * ends };
      },
    });

  const frontArch = [
    [fenderX, 2.98, 2.10], [fenderX, 3.14, 3.05], [fenderX, 3.24, 4.05],
    [fenderX, 3.27, axleF], [fenderX, 3.22, 6.00], [fenderX, 3.10, 6.95],
    [fenderX, 2.94, 7.75], [fenderX, 2.62, nose - 0.55],
  ];
  const rearArch = [
    [fenderX, 2.86, -2.10], [fenderX, 3.04, -3.05], [fenderX, 3.14, -3.85],
    [fenderX, 3.17, axleR], [fenderX, 3.10, -5.25], [fenderX, 2.94, -6.10],
    [fenderX, 2.66, -6.95], [fenderX, 2.30, tail + 0.30],
  ];
  for (const side of [1, -1]) {
    const flip = new THREE.Matrix4().makeScale(side, 1, 1);
    put(paint, xformed(fender(frontArch, 0.28, 0.22), flip), bodyColor);
    put(paint, xformed(fender(rearArch, 0.26, 0.24), flip), bodyColor);
  }

  // --- wheels --------------------------------------------------------------------------
  // A tyre has a SHOULDER, and the shoulder is where all of the light on a tyre is. Three
  // stacked cylinders cannot give it one; a closed profile revolved about the axle can,
  // and it costs about the same.
  const tyre = revolve([
    [0.56, -0.40], [0.86, -0.42], [1.06, -0.40], [1.19, -0.32], [1.245, -0.16],
    [1.25, 0], [1.245, 0.16], [1.19, 0.32], [1.06, 0.40], [0.86, 0.42], [0.56, 0.40],
    [0.52, 0.26], [0.52, -0.26], [0.56, -0.40],
  ], 26);
  // Whitewalls: standard on a fleet cab of this date and one of the loudest period cues
  // there is, so they are a PROUD ring rather than a painted stripe.
  //
  // A BAND, though, not the whole face. Run from the hubcap out to the tread and the
  // wheel is a pale disc with a thin dark rim -- which is what a modern low-profile tyre
  // looks like, and the exact opposite of the deep black sidewall these cars ran. The
  // painted wheel between hubcap and whitewall is most of what a period wheel is.
  const whitewall = revolve([
    [0.80, 0.41], [1.04, 0.41], [1.04, 0.455], [0.80, 0.455], [0.80, 0.41],
  ], 26);
  const hubcap = revolve([
    [0, 0.60], [0.12, 0.595], [0.24, 0.57], [0.35, 0.525], [0.43, 0.465],
    [0.47, 0.42], [0.48, 0.39], [0.48, 0.30], [0, 0.30],
  ], 24);
  const rim = revolve([[0.50, 0.40], [0.54, 0.40], [0.54, 0.16], [0.50, 0.16], [0.50, 0.40]], 20);
  for (const side of [-1, 1]) {
    for (const z of [axleF, axleR]) {
      // -side, not +side. A lathe is built about +Y, so the whitewall and the hubcap live
      // on its +Y face; rotateZ(+90) sends +Y to -X, which parks both of them on the
      // INBOARD side of the right-hand wheels where they are sealed inside the car. The
      // symptom is a wheel that is a plain black disc, which looks like a missing material
      // rather than a rotation off by a sign.
      const spin = [0, 0, -side * Math.PI / 2];
      const at = [side * trackX, WHEEL_R, z];
      put(dark, tyre, 0x1b1918, at, spin);
      put(dark, rim, 0x2a2723, at, spin);
      put(dark, revolve([[0.46, 0.415], [0.82, 0.415], [0.82, 0.44], [0.46, 0.44], [0.46, 0.415]], 22),
        0x2a2723, at, spin); // the painted wheel disc between hubcap and whitewall
      put(chrome, whitewall, 0xe6e2d6, at, spin);
      put(chrome, hubcap, chromeColor, at, spin);
    }
  }

  // --- running boards ------------------------------------------------------------------
  // Without them the gap between fender and door is a hole straight under the car.
  const boardOutline = [
    [1.78, 0.98], [2.74, 0.98], [2.80, 1.06], [2.80, 1.20],
    [2.70, 1.26], [2.58, 1.20], [1.78, 1.20],
  ];
  for (const side of [-1, 1]) {
    const board = extrudeOutline(boardOutline, axleF - axleR - 3.9);
    put(dark, xformed(board, new THREE.Matrix4().makeScale(side, 1, 1)), 0x33302b, [0, 0, (axleF + axleR) / 2]);
  }

  // --- the grille ----------------------------------------------------------------------
  // Horizontal bars in a shaped surround, each one swept along an arc that matches the
  // prow's plan curvature. Straight bars across a rounded nose stand off it at the
  // centre and cut into it at the ends, which is exactly how a generated car gives itself
  // away -- the bars are the one part of the front a person looks straight at.
  const grilleR = 4.0;
  const grilleZ = nose + 0.07;
  const grilleTop = 3.06;
  const grilleBot = 1.98;
  const grilleMid = (grilleTop + grilleBot) / 2;
  const grilleH = (grilleTop - grilleBot) / 2;
  const bow = (x) => grilleZ - grilleR + Math.sqrt(Math.max(0, grilleR * grilleR - x * x));
  const barPath = (halfSpan, y) => {
    const pts = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const x = -halfSpan + (i / steps) * halfSpan * 2;
      pts.push([x, y, bow(x)]);
    }
    return pts;
  };
  // The dark air space, a hair proud of the prow's own face, so the grille is a way INTO
  // the car and not a chrome plate laid on the paint.
  put(dark, extrudeOutline(roundedOutline(1.16, grilleH + 0.02, 0.34, 3), 0.10), 0x0d0e0f,
    [0, grilleMid, nose - 0.02]);
  const barProfile = roundedOutline(0.10, 0.075, 0.055, 2);
  for (let i = 0; i < 6; i++) {
    const y = grilleBot + 0.10 + (i / 5) * (grilleTop - grilleBot - 0.20);
    const k = Math.sqrt(Math.max(0.06, 1 - Math.pow((y - grilleMid) / (grilleH + 0.10), 2)));
    put(chrome, sweepProfile(barPath(1.14 * k, y), barProfile, { samples: 8, up: new THREE.Vector3(0, 1, 0) }), chromeColor);
  }
  // Centre spine and surround. The surround is a closed ring swept round the opening, so
  // the grille sits in something rather than being bars stuck on a nose.
  put(chrome, sweepProfile(
    [[0, grilleBot - 0.10, bow(0) - 0.02], [0, grilleMid, bow(0) + 0.02], [0, grilleTop + 0.10, bow(0) - 0.02]],
    roundedOutline(0.10, 0.10, 0.06, 2), { samples: 5, up: new THREE.Vector3(1, 0, 0) }
  ), chromeColor);
  const surroundPts = [];
  for (let i = 0; i <= 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const sx = Math.cos(a) * 1.26;
    const sy = grilleMid + Math.sin(a) * (grilleH + 0.20);
    surroundPts.push([sx, sy, bow(sx) - 0.06]);
  }
  put(chrome, sweepProfile(surroundPts, roundedOutline(0.09, 0.12, 0.06, 2), {
    samples: 30, up: new THREE.Vector3(0, 0, 1),
  }), chromeColor);

  // --- lamps, bumpers, brightwork ------------------------------------------------------
  // The lens goes in its OWN merge. There is no environment map in this app, and a
  // metalness-0.9 surface with nothing to reflect renders black -- which turned every
  // headlight on the street into a dark blob stuck to the fender. A lamp is a lit lens
  // anyway, so it wants low metalness and a little emissive.
  const bucket = revolve([
    [0, -0.34], [0.30, -0.34], [0.40, -0.20], [0.44, 0.02], [0.47, 0.12],
    [0.42, 0.14], [0.40, 0.10], [0.36, -0.06], [0.26, -0.20], [0, -0.20],
  ], 20);
  const lens = revolve([
    [0, 0.16], [0.16, 0.155], [0.28, 0.135], [0.37, 0.09], [0.41, 0.02],
    [0.41, -0.08], [0, -0.08],
  ], 20);
  for (const side of [-1, 1]) {
    // Seated ON the fender crown, not floating above it. The crown line at this station is
    // about y = 2.90 and the pontoon is 0.68 deep, so a lamp centred at 3.02 with a 0.47
    // bucket puts its top half in open air -- from ten feet that is a chrome ring hovering
    // clear of the wing, which is the loudest possible "these are separate objects".
    const at = [side * (fenderX - 0.10), 2.90, nose - 1.05];
    put(chrome, bucket, chromeColor, at, [Math.PI / 2, 0, 0]);
    put(lamps, lens, 0xfff4dc, at, [Math.PI / 2, 0, 0]);
    // Parking lamp in the fender crown, and a tail lamp on the rear quarter.
    put(lamps, revolve([[0, 0.10], [0.10, 0.095], [0.15, 0.05], [0.15, -0.05], [0, -0.05]], 14),
      0xffcf8a, [side * (fenderX + 0.02), 3.14, nose - 1.95], [Math.PI / 2, 0, 0]);
    put(lamps, revolve([[0, 0.11], [0.11, 0.10], [0.16, 0.04], [0.16, -0.06], [0, -0.06]], 14),
      0xc8362c, [side * (fenderX - 0.30), 2.72, tail + 0.42], [-Math.PI / 2, 0, 0]);
  }

  // Bumpers: a rolled blade swept on an arc, wider than the body, with two over-riders.
  //
  // The profile's u axis is the frame's normal (here vertical) and v is the binormal
  // (here Z). Getting those the wrong way round makes the blade 4in tall and 7in deep,
  // which from the kerb reads as a length of pipe lying across the front of the car.
  const bumperProfile = roundedOutline(0.27, 0.13, 0.11, 3);
  // Half-span 2.72 on a flat 8.6ft bow, not 3.22 on a 5.4. A bumper is about as wide as
  // the car over its fenders, and a tighter bow swings its ends so far back that they part
  // company with the corner they are supposed to protect.
  const BUMP_R = 8.6;
  const HALF_SPAN = 2.72;
  for (const [z, y, dir, apronTop] of [[nose + 0.16, 1.92, 1, 2.64], [tail - 0.22, 1.96, -1, 2.58]]) {
    const arc = (x) => z + dir * (Math.sqrt(Math.max(0, BUMP_R * BUMP_R - x * x)) - BUMP_R);

    // THE APRON, and it is the reason the bumper stopped floating.
    //
    // A bumper is wider than the body's nose and hangs well BELOW the fender crowns, so
    // out at its ends there is simply nothing behind it: the blade stood in mid-air past
    // the corner of the bodywork with daylight above and below it, on a model whose whole
    // brief was to leave no open spaces. The valance panel under the grille is what a real
    // car closes that with, and it doubles as the thing the blade is bolted to.
    const apronPts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -2.44 + (i / 8) * 4.88;
      apronPts.push([x, (apronTop + 1.46) / 2, arc(x) - dir * 0.36]);
    }
    put(paint, sweepProfile(apronPts, roundedOutline((apronTop - 1.46) / 2, 0.32, 0.24, 3), {
      samples: 12, up: new THREE.Vector3(0, 1, 0),
    }), bodyColor);

    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const x = -HALF_SPAN + (i / 8) * HALF_SPAN * 2;
      pts.push([x, y, arc(x)]);
    }
    put(chrome, sweepProfile(pts, bumperProfile, { samples: 12, up: new THREE.Vector3(0, 1, 0) }), chromeColor);
    for (const side of [-1, 1]) {
      // Over-riders sit ON the blade at the blade's own depth, not at the nose's. Placed
      // at a fixed z they float clear of a bumper that is bowed.
      put(chrome, revolve([
        [0, 0.46], [0.10, 0.44], [0.16, 0.36], [0.18, 0.22], [0.18, -0.30], [0.12, -0.38], [0, -0.38],
      ], 14), chromeColor, [side * 1.24, y, arc(side * 1.24) + dir * 0.09]);
      // Bumper irons back into the apron, so the blade is not floating in front of the car.
      put(dark, chamferBox(0.22, 0.30, 0.8, 0.06), 0x2a2723, [side * 1.02, y - 0.06, arc(side * 1.02) - dir * 0.36]);
    }
  }

  // A chrome sweep along the belt line, which is the one piece of trim that says how long
  // the car is. Laid on the hull's own surface for the same reason the glass is.
  for (const side of [1, -1]) {
    const t0 = hull.tAtZ(tail + 1.4);
    const t1 = hull.tAtZ(3.0);
    const u = hull.uAtY((t0 + t1) / 2, 3.02);
    const strip = surfacePatch(hull, {
      t0, t1,
      u0: side > 0 ? u - 0.012 : 0.5 - (u - 0.012),
      u1: side > 0 ? u + 0.012 : 0.5 - (u + 0.012),
      nt: 14, nu: 2, lift: 0.03, thick: 0.045,
    });
    put(chrome, strip, chromeColor);
    // Door handles.
    for (const z of coupe ? [0.9] : [1.35, -1.55]) {
      put(chrome, revolve([[0, 0.30], [0.07, 0.29], [0.09, 0.12], [0.09, -0.30], [0, -0.30]], 10),
        chromeColor, [side * (halfW + 0.03), 3.16, z], [0, 0, Math.PI / 2]);
    }
  }

  // Hood ornament, wipers and a wing mirror -- the small bright things at eye level.
  put(chrome, sweepProfile(
    [[0, 3.80, nose - 1.30], [0, 3.98, nose - 1.00], [0, 4.06, nose - 0.72]],
    [[-0.05, 0.16], [0.05, 0.16], [0.05, -0.10], [0, -0.16], [-0.05, -0.10]],
    { samples: 5, up: new THREE.Vector3(1, 0, 0) }
  ), chromeColor);
  for (const side of [-1, 1]) {
    put(dark, chamferBox(0.04, 0.04, 1.15, 0.015), 0x1c1a18, [side * 0.66, 4.06, cabF + 0.34], [-0.62, 0, side * 0.14]);
  }
  put(chrome, revolve([[0, 0.06], [0.30, 0.05], [0.34, 0], [0.30, -0.05], [0, -0.06]], 14),
    chromeColor, [-(halfW + 0.42), 3.92, cabF - 0.20], [Math.PI / 2, 0.5, 0]);
  put(chrome, chamferBox(0.07, 0.07, 0.5, 0.02), chromeColor, [-(halfW + 0.20), 3.86, cabF - 0.20], [0, 1.2, 0]);

  // The exhaust, and the dark underbody that closes the car off from below. Without the
  // floor pan you can see up into the hull from kerb height, which is exactly where a 5ft
  // student's eye is relative to a car parked next to them.
  put(dark, chamferBox(4.3, 0.34, axleF - axleR + 2.6, 0.14), 0x1e1c1a, [0, 1.02, (axleF + axleR) / 2]);
  put(dark, sweepProfile(
    [[0.9, 0.86, axleR + 1.2], [1.05, 0.80, axleR - 1.0], [1.15, 0.74, tail + 1.2], [1.15, 0.70, tail + 0.4]],
    roundedOutline(0.11, 0.11, 0.10, 2), { samples: 6, up: new THREE.Vector3(0, 1, 0) }
  ), 0x2f2c28);

  return { paint, chrome, dark, glass, lamps, hull, cabin, BELT, ROOF, ROCKER, halfW, nose, tail, cabF, cabR };
}

// Assembles the five merges every car in this world is made of. Paint, chrome, rubber,
// glass and lit lenses need genuinely different roughness/metalness, and mergedMesh takes
// ONE material per merge -- so five is the floor, not a missed optimisation.
function assembleCar(parts, seed) {
  const g = group();
  g.add(
    mergedMesh(parts.paint, {
      roughness: 0.32,
      metalness: 0.22,
      // Faint orange peel. Sprayed lacquer over hand-beaten panels is not a mirror, and a
      // perfectly smooth body is what makes a generated car read as plastic.
      ...relief('metal', { seed: seed * 3 + 1, repeat: 5, strength: 0.05 }),
    })
  );
  // metalness 0.55, not the 0.9 chrome actually has. There is no environment map anywhere
  // in this app, so a fully metallic surface has nothing to reflect and renders as black:
  // at 0.9 every bumper and grille on the street came out looking like cast iron.
  g.add(mergedMesh(parts.chrome, { roughness: 0.2, metalness: 0.55 }));
  g.add(mergedMesh(parts.dark, { roughness: 0.92, ...relief('metal', { seed: seed + 9, repeat: 6, strength: 0.2 }) }));
  // Glass at roughness 0.3, not the 0.1 that "glass" suggests. The old windshield was a
  // near-vertical box and never faced the sun; the lofted one is a raked surface that
  // does, and at a mirror roughness the whole screen blew out to flat white -- reading as
  // a sheet of card rather than as the brightest thing on the car.
  g.add(mergedMesh(parts.glass, { roughness: 0.3, metalness: 0.12, transparent: true, opacity: 0.72 }));
  g.add(
    mergedMesh(parts.lamps, {
      roughness: 0.18,
      metalness: 0.05,
      emissive: new THREE.Color(0xffe6b0),
      emissiveIntensity: 0.45,
    })
  );
  return g;
}

// A late-1940s New York cab: the livery, the roof flag and the whitewalls on top of the
// shared body above.
export function taxiCab({
  bodyColor = 0xe8a52c,
  roofColor = 0x2f2a26,
  fleetNumber = '2-B-71',
  seed = 7,
} = {}) {
  const rng = seededRandom(seed);
  const parts = periodCarParts({ bodyColor, roofColor, seed });
  const g = assembleCar(parts, seed);

  // A checkerboard band and the fleet number, painted on each front door -- and PAINTED
  // is the word: the decal is a slab lying on the hull's own surface, so it wraps round
  // the door's curvature instead of hovering off it at the ends like a sticker.
  const doorTexture = canvasTexture(512, 208, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const squares = 18;
    const cell = w / squares;
    for (let i = 0; i < squares; i++) {
      ctx.fillStyle = i % 2 ? '#1d1b19' : '#f2ead6';
      ctx.fillRect(i * cell, 6, cell, cell * 0.95);
    }
    ctx.fillStyle = '#1d1b19';
    fitText(ctx, 'TAXI', w / 2, h * 0.62, w * 0.44, h * 0.36, SANS);
    ctx.fillStyle = '#2b2723';
    fitText(ctx, fleetNumber, w / 2, h * 0.88, w * 0.34, h * 0.17, SANS_LIGHT);
  });
  const decalMat = standard({ map: doorTexture, transparent: true, roughness: 0.45, metalness: 0.1 });
  const t0 = parts.hull.tAtZ(-1.95);
  const t1 = parts.hull.tAtZ(1.75);
  const uLo = parts.hull.uAtY((t0 + t1) / 2, 2.20);
  const uHi = parts.hull.uAtY((t0 + t1) / 2, 3.26);
  for (const side of [1, -1]) {
    const decal = mesh(surfacePatch(parts.hull, {
      t0, t1,
      u0: side > 0 ? uLo : 0.5 - uLo,
      u1: side > 0 ? uHi : 0.5 - uHi,
      nt: 12, nu: 5, lift: 0.03, thick: 0.014,
      flipU: side > 0,
    }), decalMat);
    decal.castShadow = false;
    g.add(decal);
  }

  // Roof light box. Lit, because a cab with its flag up is what a cab looks like.
  const roofTexture = signTexture({
    width: 512,
    height: 160,
    face: '#f0b530',
    bulbs: false,
    lines: [{ text: 'TAXI', size: 0.52, color: '#231f1c', font: SANS }],
  });
  const roofSign = mesh(
    chamferBox(2.15, 0.66, 0.44, 0.10),
    standard({
      map: roofTexture,
      emissive: new THREE.Color(0xffd98a),
      emissiveMap: roofTexture,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    })
  );
  roofSign.position.set(0, parts.ROOF + 0.30, 0.4);
  g.add(roofSign);
  g.add(mergedMesh([
    { geometry: chamferBox(2.3, 0.16, 0.6, 0.06), position: [0, parts.ROOF - 0.02, 0.4], color: 0x2f2a26 },
  ], { roughness: 0.5, metalness: 0.4 }));

  // A slight settle on the springs, different for every cab, so a rank of them is not a
  // row of clones. Seeded, so a reloaded world gives back the same rank.
  g.rotation.z = randomIn(rng, -0.012, 0.012);
  return g;
}

// The traffic around the hero cab: the same body, no livery, and a notch shorter.
export function sedanCar({ bodyColor = 0x27303f, topColor = null, seed = 3, coupe = false } = {}) {
  const rng = seededRandom(seed);
  const parts = periodCarParts({
    bodyColor,
    roofColor: topColor ?? bodyColor,
    seed,
    coupe,
    nose: 8.55,
    tail: -7.25,
    halfW: 2.42,
    cabF: coupe ? 2.20 : 2.50,
    cabR: coupe ? -6.10 : -6.85,
  });
  const g = assembleCar(parts, seed);
  g.rotation.z = randomIn(rng, -0.01, 0.01);
  return g;
}

// A period transit bus -- cream over green, roof destination blind, standee windows.
//
// Built on the same loft as the cars, and for the same reason: every bus of this date is
// a monocoque with a domed roof and tumblehome sides, and squared off it reads as a
// shipping container on wheels.
export function cityBus({ bodyColor = 0xe6dcc0, skirtColor = 0x2f6b46, route = '7  BROADWAY', seed = 4 } = {}) {
  const g = group();
  const LEN = 33;
  const HALF = LEN / 2;
  const paint = [];
  const dark = [];
  const glass = [];
  const chrome = [];

  // Two numbers here are corrections, and both are the same class of mistake.
  //
  // The ends carry a FULL section (3.3 half-width, 7.8 tall), not a taper to nothing. A
  // bus front is very nearly flat, and running the loft to a point put the nose station
  // eight feet up in the air -- so the bumper, which is bolted across the front at 2.4ft,
  // had no bodywork within four feet of it and hung in space like a plank.
  //
  // roundDn is 0.62 rather than the near-rectangular 0.26 the sides want. That pinches
  // the section IN below the waist, which is what tumblehome actually is on a bus of this
  // date -- and it is the only thing that lets the wheels be seen. At a boxy section the
  // body is full width all the way down and the wheels, which sit inboard of it, are
  // sealed inside the skirt: the bus rendered with four black stubs poking out under a
  // slab, which reads as a vehicle sunk into the road.
  const shell = [
    carStation(-HALF, 3.30, 7.80, 2.30, 0.72, 0.60),
    carStation(-HALF + 0.9, 3.95, 8.45, 2.05, 0.45, 0.62),
    carStation(-HALF + 3.0, 4.10, 8.66, 1.95, 0.34, 0.62),
    carStation(-6, 4.12, 8.70, 1.90, 0.30, 0.62),
    carStation(6, 4.12, 8.70, 1.90, 0.30, 0.62),
    carStation(HALF - 3.0, 4.10, 8.66, 1.95, 0.34, 0.62),
    carStation(HALF - 0.9, 3.95, 8.45, 2.05, 0.45, 0.62),
    carStation(HALF, 3.35, 7.85, 2.30, 0.70, 0.60),
  ];
  const hull = loftSampler(shell);
  put(paint, bodyLoft(shell, { sides: 28, samples: 30 }), bodyColor);

  // A flat-bottomed SKIRT inside the tumblehome. The rounded section that lets the wheels
  // be seen also pinches the body to a keel at the very bottom, so between the axles there
  // was nothing but a narrowing edge -- and a wheel half-buried in an edge reads as a
  // wheel hanging in space. The skirt gives the underside a real width to emerge from and
  // is completely hidden above it.
  put(paint, extrudeOutline([
    [-3.32, 3.30], [3.32, 3.30], [3.32, 1.70], [3.10, 1.52], [-3.10, 1.52], [-3.32, 1.70],
  ], LEN - 1.4), skirtColor);

  // The skirt below the waist rail, in the darker of the two liveries. A patch on the
  // hull's own surface, so the two-tone break follows the tumblehome instead of cutting
  // across it.
  for (const side of [1, -1]) {
    const t0 = hull.tAtZ(-HALF + 0.6);
    const t1 = hull.tAtZ(HALF - 0.6);
    const uLo = hull.uAtY(0.5, 2.2);
    const uHi = hull.uAtY(0.5, 4.9);
    put(paint, surfacePatch(hull, {
      t0, t1,
      u0: side > 0 ? uLo : 0.5 - uLo,
      u1: side > 0 ? uHi : 0.5 - uHi,
      nt: 14, nu: 6, lift: 0.05, thick: 0.03,
    }), skirtColor);
    // Standee windows and the main glazing band, as SEPARATE panes with a pillar of body
    // colour between each pair. One continuous strip of glass down the flank is a bus with
    // no structure in it -- a thirty-three foot window.
    const BAYS = 7;
    const from = -HALF + 3.0;
    const to = HALF - 4.2;
    for (let b = 0; b < BAYS; b++) {
      const z0 = from + ((to - from) / BAYS) * (b + 0.06);
      const z1 = from + ((to - from) / BAYS) * (b + 0.94);
      for (const [y0, y1, lift] of [[5.25, 7.30, 0.055], [7.55, 8.15, 0.075]]) {
        const a = hull.uAtY(0.5, y0);
        const c = hull.uAtY(0.5, y1);
        put(glass, surfacePatch(hull, {
          t0: hull.tAtZ(z0), t1: hull.tAtZ(z1),
          u0: side > 0 ? a : 0.5 - a,
          u1: side > 0 ? c : 0.5 - c,
          nt: 3, nu: 4, lift, thick: 0.05,
        }), 0x33454f);
      }
    }
    // Wheels, and a mudguard flare over each so the arch is a real opening rather than a
    // hole where the bodywork happens to stop.
    for (const z of [HALF - 5, -HALF + 6]) {
      put(dark, revolve([
        [0.62, -0.45], [1.30, -0.48], [1.48, -0.36], [1.52, 0], [1.48, 0.36],
        [1.30, 0.48], [0.62, 0.45], [0.58, 0.28], [0.58, -0.28], [0.62, -0.45],
      ], 22), 0x1b1918, [side * 3.62, 1.52, z], [0, 0, -side * Math.PI / 2]);
      put(chrome, revolve([[0, 0.50], [0.24, 0.49], [0.40, 0.44], [0.44, 0.36], [0.44, 0.28], [0, 0.28]], 16),
        0xb9bcbe, [side * 3.62, 1.52, z], [0, 0, -side * Math.PI / 2]);
      put(paint, xformed(sweepProfile(
        [[3.30, 2.45, z - 2.35], [3.42, 3.10, z - 1.70], [3.48, 3.42, z - 0.7],
          [3.48, 3.42, z + 0.7], [3.42, 3.10, z + 1.70], [3.30, 2.45, z + 2.35]],
        roundedOutline(0.62, 0.26, 0.22, 3).map(([u, v]) => [u - 0.28, v]),
        { samples: 12, up: new THREE.Vector3(1, 0, 0) }
      ), new THREE.Matrix4().makeScale(side, 1, 1)), skirtColor);
    }
  }
  // The screens at each end are FLAT panels standing on the end face, not patches on the
  // loft's side surface. bodyLoft closes an end with a fan cap, and a surfacePatch can
  // only ever lie on the swept sides -- ask it for the front and what you get is a band
  // across the ROOF, which is where the bus's windscreen was for the first pass.
  for (const [z, dir] of [[HALF, 1], [-HALF, -1]]) {
    put(glass, chamferBox(5.6, 2.1, 0.14, 0.06), 0x33454f, [0, 6.45, z + dir * 0.10]);
    put(dark, chamferBox(6.6, 0.44, 0.62, 0.12), 0x4a4640, [0, 3.0, z + dir * 0.26]);
    for (const s of [-1, 1]) {
      put(chrome, revolve([[0, 0.16], [0.22, 0.15], [0.30, 0.08], [0.30, -0.06], [0, -0.06]], 14),
        0xfff0d0, [s * 2.2, 3.65, z + dir * 0.12], [dir * Math.PI / 2, 0, 0]);
    }
  }

  g.add(mergedMesh(paint, { roughness: 0.42, metalness: 0.16, ...relief('metal', { seed, repeat: 5, strength: 0.06 }) }));
  g.add(mergedMesh(dark, { roughness: 0.7, metalness: 0.4 }));
  g.add(mergedMesh(chrome, { roughness: 0.25, metalness: 0.5 }));
  g.add(mergedMesh(glass, { roughness: 0.14, metalness: 0.4, transparent: true, opacity: 0.6 }));

  const blind = signTexture({
    width: 768,
    height: 128,
    face: '#1c1b18',
    bulbs: false,
    lines: [{ text: route, size: 0.62, color: '#f5e2a6', font: SANS }],
  });
  const board = mesh(new THREE.PlaneGeometry(5.6, 0.95), standard({ map: blind, emissive: new THREE.Color(0xffe7a8), emissiveMap: blind, emissiveIntensity: 0.5, roughness: 0.7 }));
  board.position.set(0, 8.05, HALF + 0.08);
  g.add(board);
  return g;
}


// ---------------------------------------------------------------------------
// Primary model 4 -- the street light
// ---------------------------------------------------------------------------

// A closed outline of a FLUTED circular section: a circle with `count` hollows milled
// round it. Cast-iron columns of this pattern are fluted, and the flutes are the whole
// reason a 21ft shaft reads as ironwork instead of as a length of drainpipe -- each one
// catches a line of light down the full height.
function flutedOutline(radius, count = 12, depth = 0.16) {
  const pts = [];
  const n = count * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - depth * (0.5 + 0.5 * Math.cos(a * count));
    pts.push([Math.cos(a) * radius * k, Math.sin(a) * radius * k]);
  }
  return pts;
}

// A logarithmic spiral in the XY plane, for a wrought volute. A volute drawn as an arc of
// a circle is a hook; what makes it a scroll is that the radius keeps shrinking.
function volutePath(x, y, r0, turns, shrink, phase = 0, z = 0) {
  const pts = [];
  const steps = Math.max(8, Math.round(turns * 10));
  for (let i = 0; i <= steps; i++) {
    const a = phase + (i / steps) * turns * Math.PI * 2;
    const r = r0 * Math.pow(shrink, i / steps);
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r, z]);
  }
  return pts;
}

// The New York "bishop's crook": a fluted cast-iron column on a scrolled base, a single
// arm curling up and over the roadway, and a teardrop luminaire hanging from its tip.
//
// At most ONE real PointLight, in the main luminaire, and `light: false` on most of them.
// A dozen lamps down a street at two lights each is twenty-four point lights in one
// scene: three.js compiles the count into the shader, so every one of them is paid for on
// every fragment of every object in the world. The lamps that are lit are the ones a
// student stands next to; the rest are emissive glass, which is all that reads from 60ft
// away in daylight anyway. The lower globe is emissive-only on every lamp.
export function bishopCrookLamp({
  height = 21,
  reach = 7.5,
  color = 0xffeec6,
  intensity = 1.5,
  globe = true,
  light = true,
} = {}) {
  const g = group();
  const ironColor = 0x22272b;
  const parts = [];

  // Base: a stepped octagonal plinth under a flared, moulded collar.
  put(parts, revolve([
    [0, 0], [1.16, 0], [1.16, 0.30], [1.02, 0.42], [1.02, 0.60],
    [0.90, 0.72], [0.90, 1.10], [0.80, 1.24], [0.80, 1.42],
    [0.62, 1.72], [0.52, 2.20], [0.44, 2.70], [0.40, 3.10], [0, 3.10],
  ], 16), ironColor);
  // The scrolled corner brackets that give the base its name.
  for (let i = 0; i < 4; i++) {
    put(parts, sweepProfile(
      volutePath(0.62, 2.05, 0.52, 0.62, 0.42, Math.PI * 0.55),
      roundedOutline(0.085, 0.055, 0.05, 2),
      { samples: 8, up: new THREE.Vector3(0, 0, 1) }
    ), ironColor, null, [0, (i / 4) * Math.PI * 2, 0]);
  }

  // Shaft -- fluted, and tapered like a real cast column.
  const shaftTop = height - 1.2;
  put(parts, sweepProfile(
    [[0, 2.9, 0], [0, (2.9 + shaftTop) / 2, 0], [0, shaftTop, 0]],
    flutedOutline(0.34, 12, 0.20),
    { samples: 5, up: new THREE.Vector3(1, 0, 0), at: (t) => ({ su: 1 - 0.34 * t, sv: 1 - 0.34 * t }) }
  ), ironColor);
  // Collar rings -- cast iron of this pattern is banded, and the bands are what stop a
  // 21ft shaft reading as one continuous extrusion.
  for (const [y, r] of [[5.2, 0.37], [10.4, 0.33], [shaftTop - 0.2, 0.29]]) {
    put(parts, revolve([
      [r - 0.06, 0], [r, 0.06], [r + 0.03, 0.16], [r, 0.26], [r - 0.06, 0.32], [r - 0.06, 0],
    ], 16), ironColor, [0, y, 0]);
  }

  // The crook. A quarter turn up and over toward +X, falling away at the tip.
  const tipX = reach;
  const tipY = height + 2.4;
  const crook = taperedTube(
    [
      [0, shaftTop - 0.3, 0],
      [0.25, height + 1.6, 0],
      [1.5, height + 3.0, 0],
      [3.4, height + 3.4, 0],
      [tipX - 0.6, height + 3.1, 0],
      [tipX, tipY, 0],
    ],
    [0.24, 0.22, 0.19, 0.17, 0.15, 0.14],
    { tubularSegments: 30, radialSegments: 16 }
  );
  put(parts, crook, ironColor);

  // The scrolls under the crook -- the "crook" of the name, and real spirals rather than
  // torus arcs, because a wrought volute keeps tightening as it curls.
  put(parts, sweepProfile(
    volutePath(1.9, height + 1.5, 1.35, 0.7, 0.34, Math.PI * 0.9),
    roundedOutline(0.12, 0.075, 0.07, 2),
    { samples: 12, up: new THREE.Vector3(0, 0, 1) }
  ), ironColor);
  put(parts, sweepProfile(
    volutePath(4.0, height + 2.5, 0.72, 0.62, 0.36, Math.PI * 1.35),
    roundedOutline(0.10, 0.065, 0.06, 2),
    { samples: 10, up: new THREE.Vector3(0, 0, 1) }
  ), ironColor);

  // Luminaire fitter and its finial.
  put(parts, revolve([
    [0, 0.62], [0.20, 0.60], [0.30, 0.50], [0.34, 0.34], [0.50, 0.20],
    [0.62, 0.06], [0.66, -0.10], [0.60, -0.20], [0, -0.20],
  ], 16), ironColor, [tipX, tipY - 0.44, 0]);

  if (globe) {
    put(parts, sweepProfile(
      [[-0.1, 13.4, 0], [-1.1, 13.35, 0], [-2.05, 13.2, 0]],
      roundedOutline(0.115, 0.115, 0.10, 2),
      { samples: 4, up: new THREE.Vector3(0, 1, 0) }
    ), ironColor);
    put(parts, revolve([[0, 0.34], [0.16, 0.30], [0.26, 0.16], [0.28, 0], [0.16, -0.10], [0, -0.12]], 14),
      ironColor, [-2.05, 13.16, 0]);
  }

  g.add(mergedMesh(parts, { roughness: 0.5, metalness: 0.55, ...relief('metal', { seed: 71, repeat: 4 }) }));

  // Teardrop: an acorn shade, point down. This is the shade every photograph of the period
  // shows, and it is the reason the lamp reads as 1940s rather than as a modern cobra head.
  //
  // OPAQUE, and all of it in ONE mesh -- both on purpose, and both about the machines this
  // is meant to run on. Lit glass at opacity 0.92 is visually indistinguishable from solid
  // and costs a transparent draw, which on an integrated GPU means no early-Z, a sort every
  // frame and real overdraw; a dozen lamps down a street at three glass meshes apiece was
  // 36 of them and by itself the largest block of transparency in any world in this app.
  const acorn = revolve([
    [0, 0.40], [0.30, 0.36], [0.50, 0.24], [0.60, 0.06], [0.62, -0.16],
    [0.58, -0.46], [0.48, -0.82], [0.34, -1.18], [0.18, -1.46], [0.07, -1.62], [0, -1.66],
  ], 20);
  const lit = [{ geometry: acorn, position: [tipX, tipY - 0.72, 0], color: 0xfff6df }];
  if (globe) {
    lit.push({
      geometry: revolve([
        [0, 0.62], [0.28, 0.56], [0.48, 0.40], [0.60, 0.18], [0.62, -0.06],
        [0.54, -0.34], [0.36, -0.54], [0.16, -0.62], [0, -0.63],
      ], 18),
      position: [-2.05, 12.66, 0],
      color: 0xfff6df,
    });
  }
  const glassMesh = mergedMesh(lit, {
    emissive: new THREE.Color(color),
    emissiveIntensity: 1.9,
    roughness: 0.35,
  });
  glassMesh.castShadow = false;
  // Tagged so the "change color to" block tints the glow as well as the paint -- the same
  // hook light orbs use (see ColorTint.applyColorTint).
  glassMesh.userData.isGlowMesh = true;
  g.add(glassMesh);

  if (light) {
    const lamp = new THREE.PointLight(color, intensity, 46, 2);
    lamp.position.set(tipX, tipY - 1.6, 0);
    g.add(lamp);
  }

  return g;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

// Moulding profiles, as [out, up] polylines running up the face of a wall. Every one
// starts and ends at out = 0 so the band closes against the masonry behind it.
//
// These are the single biggest change to how the buildings read. A cornice is not a box
// that overhangs -- it is a bed mould under a corona under a cyma recta, and the deep
// shadow the corona throws is what says "carved stone" from across a 54ft street. The
// first version of this file crowned every building with two stacked slabs, which from
// the sidewalk is a grey line and nothing else.
const MOULDING = {
  cornice: (s = 1) => [
    [0, 0], [0.30 * s, 0.10 * s], [0.42 * s, 0.24 * s], [0.46 * s, 0.40 * s],
    [0.52 * s, 0.46 * s], [1.22 * s, 0.54 * s], [1.26 * s, 0.66 * s],
    [1.08 * s, 0.76 * s], [1.14 * s, 0.90 * s], [1.34 * s, 1.06 * s],
    [1.38 * s, 1.32 * s], [1.12 * s, 1.48 * s], [0.72 * s, 1.58 * s],
    [0.32 * s, 1.62 * s], [0, 1.64 * s],
  ],
  belt: (s = 1) => [
    [0, 0], [0.28 * s, 0.06 * s], [0.38 * s, 0.18 * s], [0.38 * s, 0.46 * s],
    [0.28 * s, 0.58 * s], [0.12 * s, 0.66 * s], [0, 0.70 * s],
  ],
  plinth: (s = 1) => [
    [0, 0], [0.58 * s, 0], [0.58 * s, 0.92 * s], [0.48 * s, 1.06 * s],
    [0.32 * s, 1.16 * s], [0.12 * s, 1.22 * s], [0, 1.26 * s],
  ],
  coping: (s = 1) => [
    [0, 0], [0.26 * s, 0.04 * s], [0.30 * s, 0.16 * s], [0.24 * s, 0.30 * s],
    [0, 0.36 * s],
  ],
  sill: (s = 1) => [
    [0, 0], [0.34 * s, 0], [0.36 * s, 0.10 * s], [0.30 * s, 0.16 * s],
    [0.30 * s, 0.26 * s], [0, 0.26 * s],
  ],
};

// A moulding profile run STRAIGHT along X rather than round a rectangle -- window sills,
// door heads, the band over a shopfront. `out` becomes +Z and `up` stays +Y.
function mouldedRun(profile, length) {
  const g = extrudeOutline(profile, length);
  g.rotateY(-Math.PI / 2);
  return g;
}

// Punches a grid of windows into one face of a merged building shell.
//
// Recessed geometry rather than a painted window texture, and the reason is silhouette. A
// facade is seen from the sidewalk at a raking angle, where a painted window is a flat
// decal and a real reveal throws a shadow down its own side.
//
// `detail` is the whole reason the eight background towers are affordable. A window a
// student can walk up to gets a frame, a mullion, a transom, a moulded sill with a drip
// and a lintel; one a hundred feet up the next street gets its reveal and a sill, which is
// all that survives the distance anyway. Spending the near treatment on all thirteen
// buildings costs about six times what the world can see.
function punchWindows(parts, {
  axis = 'z',
  sign = 1,
  faceAt,
  span,
  yStart,
  floors,
  floorHeight,
  bays,
  winW = 3.1,
  winH = 4.4,
  reveal = 0.55,
  frameColor = STONE_LIGHT,
  rng,
  litChance = 0.12,
  detail = 'near',
}) {
  const bayWidth = span / bays;
  const near = detail === 'near';
  // Sills and lintels are IDENTICAL on every window of a facade, so each is built once
  // and handed to the merge many times. mergeColored clones per part, so this costs
  // nothing at runtime and saves rebuilding the same profile eighty times at load.
  const sillGeom = near ? mouldedRun(MOULDING.sill(1), winW + 0.9) : null;
  const lintelGeom = near ? mouldedRun([[0, 0], [0.22, 0], [0.22, 0.52], [0, 0.58]], winW + 0.7) : null;

  for (let f = 0; f < floors; f++) {
    const y = yStart + floorHeight * (f + 0.55);
    for (let b = 0; b < bays; b++) {
      const u = -span / 2 + bayWidth * (b + 0.5);
      const glass = rng() < litChance
        ? [0xbda476, 0xa8905f][Math.floor(rng() * 2)]
        : GLASS_SHADES[Math.floor(rng() * GLASS_SHADES.length)];

      // `at` is the depth of a feature measured out from the wall face, positive being
      // toward the street. Everything below is written in that one coordinate so a bay
      // reads the same on all four elevations.
      const place = (depth) => faceAt + sign * depth;
      const add = (geometry, w, h, d, du, dy, color, rot = null) => {
        const g = geometry ?? (axis === 'z' ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(d, h, w));
        const position = axis === 'z' ? [u + du, y + dy, place(d === undefined ? 0 : 0)] : [place(0), y + dy, u + du];
        parts.push({ geometry: g, position, color, rotation: rot });
      };

      // The glass, sunk into its reveal.
      const gd = -reveal * 0.5;
      parts.push({
        geometry: axis === 'z' ? new THREE.BoxGeometry(winW, winH, reveal) : new THREE.BoxGeometry(reveal, winH, winW),
        position: axis === 'z' ? [u, y, place(gd)] : [place(gd), y, u],
        color: glass,
      });

      if (near) {
        // Frame: two stiles, head and cill rails, a centre mullion and a transom bar.
        // A period sash is DIVIDED, and the divisions are most of what makes a hole in a
        // wall read as a window from the street.
        const bar = (w, h, du, dy) => {
          parts.push({
            geometry: axis === 'z' ? new THREE.BoxGeometry(w, h, 0.16) : new THREE.BoxGeometry(0.16, h, w),
            position: axis === 'z' ? [u + du, y + dy, place(-0.16)] : [place(-0.16), y + dy, u],
            color: frameColor,
          });
        };
        bar(0.22, winH, -winW / 2 + 0.11, 0);
        bar(0.22, winH, winW / 2 - 0.11, 0);
        bar(winW, 0.22, 0, winH / 2 - 0.11);
        bar(winW, 0.22, 0, -winH / 2 + 0.11);
        bar(0.16, winH, 0, 0);
        bar(winW, 0.16, 0, winH * 0.22);

        // Moulded sill with a drip, and a flat lintel over.
        parts.push({
          geometry: sillGeom,
          position: axis === 'z' ? [u, y - winH / 2 - 0.26, faceAt] : [faceAt, y - winH / 2 - 0.26, u],
          color: frameColor,
          rotation: axis === 'z' ? (sign > 0 ? null : [0, Math.PI, 0]) : [0, sign * Math.PI / 2, 0],
        });
        parts.push({
          geometry: lintelGeom,
          position: axis === 'z' ? [u, y + winH / 2 + 0.02, faceAt] : [faceAt, y + winH / 2 + 0.02, u],
          color: frameColor,
          rotation: axis === 'z' ? (sign > 0 ? null : [0, Math.PI, 0]) : [0, sign * Math.PI / 2, 0],
        });
      } else {
        // Far: the reveal plus a plain sill. Anything more is invisible at the distance
        // these are placed and multiplies straight through eight towers.
        parts.push({
          geometry: axis === 'z'
            ? new THREE.BoxGeometry(winW + 0.7, 0.24, 0.42)
            : new THREE.BoxGeometry(0.42, 0.24, winW + 0.7),
          position: axis === 'z' ? [u, y - winH / 2 - 0.1, place(0.12)] : [place(0.12), y - winH / 2 - 0.1, u],
          color: frameColor,
        });
      }
    }
  }
}

// An engaged pilaster with a moulded base and a capital -- the vertical member that
// breaks a long facade into bays. Returns parts in the caller's own frame.
function pilaster(parts, { x, z, axis, width, from, to, color, projection = 0.55 }) {
  const w = width;
  const d = projection;
  const dim = (ww, dd) => (axis === 'z' ? [ww, dd] : [dd, ww]);
  const [bw, bd] = dim(w + 0.5, d + 0.22);
  const [sw, sd] = dim(w, d);
  const [cw, cd] = dim(w + 0.62, d + 0.30);
  parts.push({ geometry: new THREE.BoxGeometry(bw, 0.9, bd), position: [x, from + 0.45, z], color });
  parts.push({ geometry: new THREE.BoxGeometry(sw, to - from - 2.0, sd), position: [x, (from + to) / 2 - 0.2, z], color });
  parts.push({ geometry: new THREE.BoxGeometry(cw, 0.5, cd), position: [x, to - 0.85, z], color });
  parts.push({ geometry: new THREE.BoxGeometry(cw + 0.2, 0.34, cd + 0.14), position: [x, to - 0.42, z], color });
}

// A low-poly period city block: shell, window grid, ground-floor storefront band and a
// crowning cornice. Styles differ in the roof, which is the only part of a background
// building anyone ever identifies it by.
//
//   'stone'   -- limestone office block with a heavy projecting cornice
//   'brick'   -- narrower loft building, corbelled brick parapet
//   'setback' -- 1920s zoning-law tower stepping back twice as it rises
//   'mansard' -- green copper mansard with dormers (the Hotel Astor, centre distance)
export function cityBuilding({
  width = 44,
  depth = 34,
  height = 80,
  style = 'stone',
  wallColor = null,
  floorHeight = 9,
  baseHeight = 13,
  bays = 0,
  sides = true,
  detail = 'near',
  seed = 9,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const color = wallColor ?? (style === 'brick' ? 0x8d5c48 : style === 'mansard' ? 0xa89478 : STONE_MID);
  const parts = [];
  const halfW = width / 2;
  const halfD = depth / 2;
  const bayCount = bays || Math.max(3, Math.round(width / 6.5));
  const sideBays = Math.max(3, Math.round(depth / 6.5));
  const near = detail === 'near';

  const shellTop = style === 'mansard' ? height - 12 : height;
  const floors = Math.max(1, Math.floor((shellTop - baseHeight - 4) / floorHeight));

  if (style === 'setback') {
    // Three stacked masses. The zoning law of 1916 is why every tower of this date looks
    // like a wedding cake, and the steps are far more identifying than any detail on them.
    const tiers = [
      { w: width, d: depth, from: 0, to: shellTop * 0.5 },
      { w: width * 0.74, d: depth * 0.74, from: shellTop * 0.5, to: shellTop * 0.8 },
      { w: width * 0.48, d: depth * 0.48, from: shellTop * 0.8, to: shellTop },
    ];
    for (const t of tiers) {
      parts.push({
        geometry: new THREE.BoxGeometry(t.w, t.to - t.from, t.d),
        position: [0, (t.from + t.to) / 2, 0],
        color,
      });
      parts.push({
        geometry: mouldedRing(MOULDING.cornice(0.7), t.w / 2, t.d / 2),
        position: [0, t.to - 1.15, 0],
        color: STONE_LIGHT,
      });
      const tierFloors = Math.max(1, Math.floor((t.to - t.from - 3) / floorHeight));
      punchWindows(parts, {
        axis: 'z', sign: 1, faceAt: t.d / 2, span: t.w * 0.86,
        yStart: t.from + 1.5, floors: tierFloors, floorHeight,
        bays: Math.max(2, Math.round(t.w / 7)), rng, detail,
      });
      if (sides) {
        for (const s of [-1, 1]) {
          punchWindows(parts, {
            axis: 'x', sign: s, faceAt: s * (t.w / 2), span: t.d * 0.86,
            yStart: t.from + 1.5, floors: tierFloors, floorHeight,
            bays: Math.max(2, Math.round(t.d / 7)), rng, detail,
          });
        }
      }
    }
    // A crown on the top tier. A setback tower that simply stops is a stump; the whole
    // point of the form is that it climbs to something.
    const top = tiers[2];
    parts.push({
      geometry: mouldedRing(MOULDING.coping(1.2), top.w * 0.30, top.d * 0.30, { closeTop: true }),
      position: [0, shellTop + 2.6, 0],
      color: STONE_LIGHT,
    });
    parts.push({
      geometry: new THREE.BoxGeometry(top.w * 0.58, 3.2, top.d * 0.58),
      position: [0, shellTop + 1.4, 0],
      color: STONE_LIGHT,
    });
    parts.push({
      geometry: revolve([[0, 0], [1.5, 0], [1.3, 1.6], [0.9, 3.2], [0.4, 4.6], [0, 5.4]], 10),
      position: [0, shellTop + 2.8, 0],
      color: 0x6d7a72,
    });
  } else {
    parts.push({ geometry: new THREE.BoxGeometry(width, shellTop, depth), position: [0, shellTop / 2, 0], color });

    // Ground floor: a darker polished base with shop glazing, which is what every one of
    // these buildings actually has at eye level and the only part a walker sees closely.
    parts.push({
      geometry: new THREE.BoxGeometry(width + 0.5, baseHeight, depth + 0.5),
      position: [0, baseHeight / 2, 0],
      color: 0x4b433b,
    });
    parts.push({
      geometry: mouldedRing(MOULDING.plinth(1), halfW + 0.25, halfD + 0.25),
      position: [0, 0, 0],
      color: 0x3a342e,
    });
    const shopBays = Math.max(2, Math.round(width / 9));
    for (let i = 0; i < shopBays; i++) {
      const x = -width / 2 + (width / shopBays) * (i + 0.5);
      parts.push({
        geometry: new THREE.BoxGeometry((width / shopBays) * 0.76, baseHeight * 0.52, 0.5),
        position: [x, baseHeight * 0.52, halfD + 0.1],
        color: 0x2b3a44,
      });
      if (near) {
        parts.push({
          geometry: mouldedRun(MOULDING.sill(1.1), (width / shopBays) * 0.84),
          position: [x, baseHeight * 0.52 - baseHeight * 0.26 - 0.2, halfD + 0.3],
          color: 0x6d5c3a,
        });
      }
    }
    parts.push({
      geometry: mouldedRing(MOULDING.belt(1.3), halfW + 0.35, halfD + 0.35),
      position: [0, baseHeight, 0],
      color: STONE_LIGHT,
    });

    punchWindows(parts, {
      axis: 'z', sign: 1, faceAt: halfD, span: width * 0.88,
      yStart: baseHeight + 1.2, floors, floorHeight, bays: bayCount, rng, detail,
    });
    if (sides) {
      for (const s of [-1, 1]) {
        punchWindows(parts, {
          axis: 'x', sign: s, faceAt: s * halfW, span: depth * 0.88,
          yStart: baseHeight + 1.2, floors, floorHeight, bays: sideBays, rng, detail,
        });
      }
    }

    // Pilasters up the front, between the outer bays. They cost four boxes each and they
    // are what stops a tall facade reading as wallpaper.
    if (near) {
      const runTop = shellTop - 3.4;
      for (const s of [-1, 1]) {
        pilaster(parts, {
          x: s * (halfW - 1.6), z: halfD + 0.28, axis: 'z', width: 3.2,
          from: baseHeight + 0.9, to: runTop, color: STONE_LIGHT,
        });
      }
    }

    // A corbelled brick parapet, or a full stone entablature.
    if (style === 'brick') {
      const dentils = Math.max(6, Math.round(width / 2.2));
      for (let i = 0; i < dentils; i++) {
        const x = -halfW + (width / dentils) * (i + 0.5);
        for (const [z, d] of [[halfD + 0.30, 0.7], [-halfD - 0.30, 0.7]]) {
          parts.push({ geometry: new THREE.BoxGeometry((width / dentils) * 0.5, 0.55, d), position: [x, shellTop - 3.5, z], color });
        }
      }
      parts.push({
        geometry: mouldedRing(MOULDING.belt(1.5), halfW + 0.2, halfD + 0.2),
        position: [0, shellTop - 3.0, 0],
        color,
      });
      parts.push({ geometry: new THREE.BoxGeometry(width + 0.6, 2.4, depth + 0.6), position: [0, shellTop - 1.0, 0], color });
      parts.push({
        geometry: mouldedRing(MOULDING.coping(1.6), halfW + 0.3, halfD + 0.3, { closeTop: true }),
        position: [0, shellTop + 0.2, 0],
        color: STONE_LIGHT,
      });
    } else {
      parts.push({
        geometry: mouldedRing(MOULDING.cornice(1.5), halfW, halfD),
        position: [0, shellTop - 3.4, 0],
        color: STONE_LIGHT,
      });
      parts.push({ geometry: new THREE.BoxGeometry(width + 0.6, 2.2, depth + 0.6), position: [0, shellTop - 0.9, 0], color: STONE_LIGHT });
      parts.push({
        geometry: mouldedRing(MOULDING.coping(1.5), halfW + 0.3, halfD + 0.3, { closeTop: true }),
        position: [0, shellTop + 0.2, 0],
        color: STONE_LIGHT,
      });
    }
  }

  const shell = mergeColored(parts);
  soot(shell, { amount: 0.10, seed: seed * 0.7 + 1, streak: near ? 0.85 : 0.4, fade: Math.min(40, height * 0.6) });
  g.add(mesh(shell, standard({
    vertexColors: true,
    roughness: 0.9,
    ...relief('stone', { seed: seed + 3, repeat: 7 }),
  })));

  if (style === 'mansard') {
    // A truncated square pyramid. A 4-sided cylinder rotated 45deg gives flats facing the
    // axes; the radius has to be scaled by sqrt(2) for the FLATS (not the corners) to land
    // on the building's own width, which is the one bit of this that is easy to get wrong.
    const roofH = 12;
    const copper = standard({ color: 0x5d8f79, roughness: 0.75, metalness: 0.25, ...relief('metal', { seed: 83, repeat: 5 }) });
    const geometry = new THREE.CylinderGeometry((width * 0.62) / Math.SQRT2, (width * 1.02) / Math.SQRT2, roofH, 4);
    geometry.rotateY(Math.PI / 4);
    geometry.scale(1, 1, depth / width);
    const roof = mesh(geometry, copper, 0, shellTop + roofH / 2, 0);
    g.add(roof);

    const dormers = [];
    const count = Math.max(3, Math.round(width / 11));
    for (let i = 0; i < count; i++) {
      const x = -width / 2 + (width / count) * (i + 0.5);
      dormers.push({ geometry: new THREE.BoxGeometry(4.4, 5.2, 4.0), position: [x, shellTop + 3.6, depth * 0.4], color: 0x5d8f79 });
      dormers.push({ geometry: new THREE.BoxGeometry(3.0, 3.2, 0.4), position: [x, shellTop + 3.8, depth * 0.4 + 2.1], color: 0x2c3944 });
      dormers.push({
        geometry: new THREE.CylinderGeometry(2.5 / Math.SQRT2, 2.5 / Math.SQRT2, 2.0, 4),
        rotation: [0, Math.PI / 4, 0],
        position: [x, shellTop + 7.2, depth * 0.4],
        color: 0x4d7f69,
      });
    }
    g.add(mergedMesh(dormers, { roughness: 0.75, metalness: 0.25 }));
    g.add(box(width * 0.16, 9, depth * 0.16, standard({ color: 0x7a5a48, roughness: 0.95 }), width * 0.28, shellTop + roofH + 3, -depth * 0.2));
  }

  return g;
}

// ---------------------------------------------------------------------------
// Signage
// ---------------------------------------------------------------------------

// A projecting theatre marquee: the lit box hanging over the sidewalk, its soffit, and
// a modelled bulb chase around all three visible edges.
//
// The bulbs on THIS one are real geometry, unlike every other sign in the world. A
// marquee is the object a student stands directly underneath, close enough that painted
// dots on a flat soffit read as what they are.
function marquee({ width, projection, faceHeight, lines, face, atY, bulbColor = 0xffe6a8 }) {
  const g = group();
  const steel = standard({ color: 0x2b2f34, roughness: 0.55, metalness: 0.55, ...relief('metal', { seed: 91, repeat: 3 }) });

  const fascia = signTexture({
    width: 1024,
    height: Math.round((1024 * faceHeight) / width),
    face,
    lines,
  });
  const sideTexture = signTexture({
    width: 512,
    height: Math.round((512 * faceHeight) / projection),
    face,
    lines: lines.slice(0, 2),
  });

  const litMat = (map) =>
    standard({ map, emissive: new THREE.Color(0xfff0cc), emissiveMap: map, emissiveIntensity: 0.75, roughness: 0.6 });

  const bodyY = atY + faceHeight / 2;
  // The carcass is a chamfered box, and the fascia and its two returns are rolled into
  // the same edge. A fabricated sign has a rolled rim, and the highlight running along
  // that rim is most of what makes it read as an object hung over the street rather than
  // as a rectangle painted on the air.
  const carcass = mesh(chamferBox(width, faceHeight + 0.7, projection, 0.22), steel);
  carcass.position.set(0, bodyY, projection / 2);
  g.add(carcass);

  const front = mesh(new THREE.PlaneGeometry(width - 0.5, faceHeight), litMat(fascia));
  front.position.set(0, bodyY, projection + 0.02);
  g.add(front);
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.PlaneGeometry(projection - 0.4, faceHeight), litMat(sideTexture));
    panel.position.set(side * (width / 2 + 0.02), bodyY, projection / 2);
    panel.rotation.y = side * (Math.PI / 2);
    g.add(panel);
  }

  // Soffit: the underside is a lit ceiling in every one of these photographs, so it is a
  // pale emissive panel with a grid of bulbs in it, not a dark steel plate.
  const soffit = mesh(
    new THREE.PlaneGeometry(width - 0.6, projection - 0.4),
    standard({ color: 0xf0e2c4, emissive: new THREE.Color(0xffe3ad), emissiveIntensity: 0.5, roughness: 0.7, side: THREE.DoubleSide })
  );
  soffit.rotation.x = Math.PI / 2;
  soffit.position.set(0, atY - 0.24, projection / 2);
  g.add(soffit);

  // Coffers in the soffit, which is what a marquee ceiling actually is -- a coffered
  // plaster field with a lamp in each panel.
  const coffers = [];
  const across = Math.max(4, Math.round(width / 4.5));
  const along = Math.max(2, Math.round(projection / 4.0));
  for (let i = 0; i <= across; i++) {
    coffers.push({
      geometry: new THREE.BoxGeometry(0.18, 0.22, projection - 0.5),
      position: [-width / 2 + 0.35 + (i * (width - 0.7)) / across, atY - 0.32, projection / 2],
      color: 0xd8c69c,
    });
  }
  for (let i = 0; i <= along; i++) {
    coffers.push({
      geometry: new THREE.BoxGeometry(width - 0.7, 0.22, 0.18),
      position: [0, atY - 0.32, 0.3 + (i * (projection - 0.6)) / along],
      color: 0xd8c69c,
    });
  }
  const grid = mergedMesh(coffers, { roughness: 0.85 });
  grid.castShadow = false;
  g.add(grid);

  const bulbs = [];
  const bulb = revolve([[0, 0.19], [0.09, 0.175], [0.15, 0.12], [0.17, 0.02], [0.14, -0.08], [0.08, -0.13], [0, -0.14]], 8);
  const step = 1.35;
  for (let x = -width / 2 + 0.7; x <= width / 2 - 0.7; x += step) {
    bulbs.push({ geometry: bulb, position: [x, atY - 0.32, projection + 0.02], rotation: [Math.PI / 2, 0, 0], color: 0xfff2d2 });
    bulbs.push({ geometry: bulb, position: [x, atY + faceHeight + 0.28, projection + 0.02], rotation: [Math.PI / 2, 0, 0], color: 0xfff2d2 });
    bulbs.push({ geometry: bulb, position: [x, atY - 0.42, projection * 0.45], rotation: [Math.PI, 0, 0], color: 0xfff2d2 });
  }
  for (let z = 0.7; z <= projection - 0.4; z += step) {
    for (const side of [-1, 1]) {
      bulbs.push({ geometry: bulb, position: [side * (width / 2 + 0.02), atY - 0.32, z], rotation: [0, 0, side * Math.PI / 2], color: 0xfff2d2 });
      bulbs.push({ geometry: bulb, position: [side * (width / 2 + 0.02), atY + faceHeight + 0.28, z], rotation: [0, 0, side * Math.PI / 2], color: 0xfff2d2 });
    }
  }
  const chase = mergedMesh(bulbs, {
    emissive: new THREE.Color(bulbColor),
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });
  chase.castShadow = false;
  g.add(chase);

  // Hanger rods back to the wall, so the box is not floating.
  for (const side of [-1, 1]) {
    g.add(cyl(0.09, 0.09, 7.5, steel, side * (width / 2 - 1.5), atY + faceHeight + 3.4, projection * 0.75, 8));
  }
  return g;
}

// A vertical blade sign standing off the face of a building.
//
// It projects along +Z and its readable faces point +/-X, which is the opposite of what
// the instinct says: a blade is meant to be read by somebody walking ALONG the sidewalk,
// not standing in front of the building.
function bladeSign({ text, height, projection = 5.5, face = '#8c1c22', atY }) {
  const g = group();
  const steel = standard({ color: 0x2b2f34, roughness: 0.55, metalness: 0.5 });
  const texture = bladeTexture(text, { face });
  const litMat = standard({
    map: texture,
    emissive: new THREE.Color(0xffd9a8),
    emissiveMap: texture,
    emissiveIntensity: 0.85,
    roughness: 0.6,
  });

  const carcass = mesh(chamferBox(1.15, height, projection, 0.2), steel);
  carcass.position.set(0, atY + height / 2, projection / 2);
  g.add(carcass);
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.PlaneGeometry(projection, height), litMat);
    panel.position.set(side * 0.60, atY + height / 2, projection / 2);
    panel.rotation.y = side * (Math.PI / 2);
    g.add(panel);
  }
  // A crown and a foot, so the blade is a fabricated object with a top and a bottom
  // rather than a rectangle that simply stops.
  const trim = [];
  for (const [y, s] of [[atY + height + 0.18, 1], [atY - 0.18, -1]]) {
    trim.push({ geometry: chamferBox(1.5, 0.36, projection + 0.4, 0.1), position: [0, y, projection / 2], color: 0x33383d });
    trim.push({ geometry: chamferBox(0.9, 0.5, projection * 0.5, 0.1), position: [0, y + s * 0.36, projection * 0.5], color: 0x33383d });
  }
  g.add(mergedMesh(trim, { roughness: 0.5, metalness: 0.5 }));
  return g;
}

// A flat lit sign hung on a wall face. `worldPortal` aside, this is how every secondary
// piece of Times Square copy in this world is made.
export function wallSign({
  width = 16,
  height = 6,
  face = '#123a6b',
  lines = [],
  bulbs = true,
  frame = 0x2b2f34,
  emissiveIntensity = 0.8,
} = {}) {
  const g = group();
  const texture = signTexture({
    width: 1024,
    height: Math.max(160, Math.round((1024 * height) / width)),
    face,
    bulbs,
    lines,
  });
  const carcass = mesh(chamferBox(width + 0.5, height + 0.5, 0.45, 0.12), standard({ color: frame, roughness: 0.6, metalness: 0.4 }));
  carcass.position.z = -0.2;
  g.add(carcass);
  const panel = mesh(
    new THREE.PlaneGeometry(width, height),
    standard({ map: texture, emissive: new THREE.Color(0xfff0cc), emissiveMap: texture, emissiveIntensity, roughness: 0.6 })
  );
  panel.position.z = 0.04;
  g.add(panel);
  return g;
}

// ---------------------------------------------------------------------------
// Primary model 2 -- the Barkleys of Broadway theatre
// ---------------------------------------------------------------------------

// The picture palace on the left of the photograph: a limestone office block with a
// theatre carved out of its base, a blue marquee slung across the sidewalk, a blade sign
// climbing five storeys, and a hanging banner for the season.
//
// Authored facing +Z, origin base centre.
export function broadwayTheatre({
  width = 46,
  depth = 30,
  height = 96,
  seed = 15,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const parts = [];

  const BASE = 13.5; // top of the stone base, under the marquee
  const stone = STONE_MID;

  parts.push({ geometry: new THREE.BoxGeometry(width, height, depth), position: [0, height / 2, 0], color: stone });

  // Classical base: a moulded plinth, five engaged pilasters and a full entablature. The
  // photograph's building has exactly this, and it is what separates a theatre from an
  // office block at street level -- but only if the mouldings are mouldings. Built as
  // stacked boxes it is a grey podium, which is what the first pass gave it.
  parts.push({
    geometry: mouldedRing(MOULDING.plinth(1.3), halfW + 0.45, halfD + 0.45),
    position: [0, 0, 0],
    color: STONE_LIGHT,
  });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.9, BASE - 3.2, depth + 0.9), position: [0, 1.7 + (BASE - 3.2) / 2, 0], color: STONE_LIGHT });
  for (let i = 0; i < 5; i++) {
    const x = -halfW + 3.6 + i * ((width - 7.2) / 4);
    pilaster(parts, {
      x, z: halfD + 1.0, axis: 'z', width: 2.6, projection: 1.2,
      from: 1.7, to: BASE - 2.0, color: STONE_LIGHT,
    });
  }
  parts.push({
    geometry: mouldedRing(MOULDING.cornice(1.15), halfW + 0.6, halfD + 0.6),
    position: [0, BASE - 2.2, 0],
    color: STONE_LIGHT,
  });

  // Entrance: a recessed lobby, dark inside so it reads as a way in rather than as a
  // panel. Same lesson the Park's nature centre learned -- a single lit sheet across a
  // door opening is a board, and what makes it a door is the reveal and the divisions.
  const doorW = 15;
  parts.push({ geometry: new THREE.BoxGeometry(doorW, 10.5, 3.0), position: [0, 5.25, halfD - 1.3], color: 0x16130f });
  for (let i = 0; i < 4; i++) {
    const x = -doorW / 2 + 1.4 + i * ((doorW - 2.8) / 3);
    parts.push({ geometry: chamferBox(0.45, 9.6, 0.55, 0.1), position: [x, 4.8, halfD + 0.1], color: 0x8a6a2c });
  }
  parts.push({
    geometry: mouldedRun([[0, 0], [0.42, 0.06], [0.5, 0.2], [0.44, 0.5], [0.22, 0.62], [0, 0.66]], doorW + 1.2),
    position: [0, 9.8, halfD + 0.05],
    color: 0x8a6a2c,
  });
  parts.push({ geometry: chamferBox(doorW - 1.2, 1.5, 0.4, 0.1), position: [0, 10.9, halfD + 0.2], color: 0xb99a4c });

  // Shop bays either side of the lobby, glazed.
  for (const side of [-1, 1]) {
    parts.push({
      geometry: new THREE.BoxGeometry((width - doorW) / 2 - 5.5, 7.6, 0.55),
      position: [side * (doorW / 2 + (width - doorW) / 4 + 0.6), 5.4, halfD + 0.45],
      color: 0x2b3a44,
    });
  }

  // Office storeys above.
  const floors = Math.floor((height - BASE - 12) / 8.4);
  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: width * 0.86,
    yStart: BASE + 3.5, floors, floorHeight: 8.4, bays: 7, rng, winW: 3.0, winH: 4.6,
  });
  for (const s of [-1, 1]) {
    punchWindows(parts, {
      axis: 'x', sign: s, faceAt: s * halfW, span: depth * 0.84,
      yStart: BASE + 3.5, floors, floorHeight: 8.4, bays: 5, rng, winW: 3.0, winH: 4.6,
      detail: 'far',
    });
  }

  parts.push({
    geometry: mouldedRing(MOULDING.cornice(1.7), halfW, halfD),
    position: [0, height - 4.6, 0],
    color: STONE_LIGHT,
  });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.8, 2.6, depth + 0.8), position: [0, height - 1.6, 0], color: STONE_LIGHT });
  parts.push({
    geometry: mouldedRing(MOULDING.coping(1.6), halfW + 0.4, halfD + 0.4, { closeTop: true }),
    position: [0, height - 0.3, 0],
    color: STONE_LIGHT,
  });

  const shell = mergeColored(parts);
  soot(shell, { amount: 0.10, seed, streak: 0.9, fade: 46 });
  g.add(mesh(shell, standard({ vertexColors: true, roughness: 0.92, ...relief('stone', { seed, repeat: 8 }) })));

  // --- the marquee ---------------------------------------------------------------------
  const marqueeBox = marquee({
    width: width - 8,
    projection: 9.5,
    faceHeight: 6.4,
    atY: 12.2,
    face: '#152a56',
    lines: [
      { text: 'FRED ASTAIRE   ·   GINGER ROGERS', size: 0.155, color: '#f7f1de', font: SANS },
      { text: '"The Barkleys of BROADWAY"', size: 0.3, color: '#ffd766', font: SCRIPT, gap: 0.04 },
      { text: 'OSCAR LEVANT  ·  A TECHNICOLOR MUSICAL', size: 0.115, color: '#dfe6f5', font: SANS_LIGHT },
    ],
  });
  marqueeBox.position.z = halfD;
  g.add(marqueeBox);

  // --- blade sign ----------------------------------------------------------------------
  const blade = bladeSign({ text: 'STATE', height: 34, projection: 5.5, face: '#8c1c22', atY: 26 });
  blade.position.set(-halfW + 5.5, 0, halfD);
  g.add(blade);

  // --- poster boards flanking the entrance ----------------------------------------------
  const posterTexture = canvasTexture(384, 560, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1b3a74');
    grad.addColorStop(1, '#8d2440');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffd766';
    fitText(ctx, 'ASTAIRE', w / 2, h * 0.2, w * 0.86, h * 0.1, SANS);
    fitText(ctx, 'ROGERS', w / 2, h * 0.32, w * 0.86, h * 0.1, SANS);
    ctx.fillStyle = '#f7f1de';
    fitText(ctx, 'The Barkleys', w / 2, h * 0.56, w * 0.9, h * 0.11, SCRIPT);
    fitText(ctx, 'of BROADWAY', w / 2, h * 0.68, w * 0.9, h * 0.1, SCRIPT);
    ctx.fillStyle = '#e6d9b8';
    fitText(ctx, 'M-G-M  ·  TECHNICOLOR', w / 2, h * 0.86, w * 0.84, h * 0.055, SANS_LIGHT);
    ctx.strokeStyle = '#f0c86a';
    ctx.lineWidth = 10;
    ctx.strokeRect(12, 12, w - 24, h - 24);
  });
  const frameMat = standard({ color: 0x8a6a2c, roughness: 0.5, metalness: 0.55 });
  for (const x of [-doorW / 2 - 2.6, doorW / 2 + 2.6]) {
    const board = group();
    board.add(mesh(chamferBox(3.4, 5.2, 0.36, 0.09), frameMat));
    const face = mesh(new THREE.PlaneGeometry(3.0, 4.8), standard({ map: posterTexture, roughness: 0.75, emissive: new THREE.Color(0x6a5a3a), emissiveMap: posterTexture, emissiveIntensity: 0.35 }));
    face.position.z = 0.2;
    board.add(face);
    board.position.set(x, 6.4, halfD + 0.6);
    g.add(board);
  }

  // --- hanging season banner --------------------------------------------------------------
  // Angled off the wall on a bracket, exactly as it hangs in the photograph. Slightly
  // skewed rather than square-on: a banner that hangs perfectly flat reads as a sign.
  const bannerTexture = canvasTexture(360, 520, (ctx, w, h) => {
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#c1272d';
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, w - 20, h - 20);
    ctx.fillStyle = '#1f3f7a';
    fitText(ctx, "Loew's", w / 2, h * 0.2, w * 0.7, h * 0.12, SCRIPT);
    ctx.fillStyle = '#c1272d';
    fitText(ctx, 'BIG', w / 2, h * 0.46, w * 0.8, h * 0.24, SANS);
    ctx.fillStyle = '#1f3f7a';
    fitText(ctx, 'SHOW', w / 2, h * 0.66, w * 0.82, h * 0.14, SANS);
    fitText(ctx, 'SEASON', w / 2, h * 0.82, w * 0.86, h * 0.13, SANS);
  });
  const banner = group();
  banner.add(cyl(0.08, 0.08, 5.5, standard({ color: 0x2b2f34, roughness: 0.6, metalness: 0.5 }), 0, 3.9, -2.6, 8));
  const cloth = signPanel(4.6, 6.6, bannerTexture);
  cloth.position.set(0, 0, 0);
  banner.add(cloth);
  banner.position.set(-halfW + 13, 30, halfD + 2.8);
  banner.rotation.y = -0.35;
  g.add(banner);

  return g;
}

// ---------------------------------------------------------------------------
// Primary model 3 -- the BOND building
// ---------------------------------------------------------------------------

// A stylised classical figure in pale stone, for the pair that stand over the Bond sign.
//
// These are SCULPTURE, not people: smooth, abstracted, and quarry-coloured, closer to a
// war memorial than to a portrait. The brief's "no people" is about the crowd in the
// photograph, which is why there are no pedestrians anywhere in this world -- but the two
// colossi are the single most identifying thing about this building, and a Bond sign
// without them is not the Bond sign.
//
// Built from swept tubes with a SOCKET at every joint and a CAP at every open end, sized
// from the bend rather than from the fattest neighbouring radius -- the rule DinoProps
// and SeaProps both arrived at. Two tubes meeting at an angle each end in an open ring
// lying in its own plane, and wherever the planes disagree the surfaces cross; a ball at
// the bend is the only thing that closes it for every angle.
// `color` is a warm quarry buff, not the near-white it started at. These stand 60ft up
// against an open sky, and a figure lit from the front in almost the sky's own value has
// nothing to separate it from the background -- the pair read as two pale smudges over
// the sign. Weathered limestone is a good deal warmer and darker than instinct says.
function bondStatue({ height = 29, color = 0xd2c7ad, mirrored = false, seed = 41 } = {}) {
  const s = height / 24; // every number below is authored against a 24-unit figure
  const side = mirrored ? -1 : 1;
  const parts = [];
  const add = (geometry, position, rotation) => parts.push({ geometry, position, rotation, color });
  const at = (x, y, z = 0) => [x * s * side, y * s, z * s];

  const tube = (points, radii, segments = 24) =>
    taperedTube(points.map(([x, y, z]) => [x * s * side, y * s, (z || 0) * s]), radii.map((r) => r * s), {
      tubularSegments: segments,
      radialSegments: 16,
    });

  // A limb: a tube per span, a socket ball at every interior node and a cap at each open
  // end. The socket is sized from the BEND -- 1/cos(phi/2) covers the wedge the two end
  // planes leave on the outside of the angle, plus the flats' own inset. Sized from a
  // neighbouring radius instead, every joint comes out a balloon.
  const limb = (nodes) => {
    for (let i = 0; i < nodes.length - 1; i++) {
      add(tube([nodes[i].p, nodes[i + 1].p], [nodes[i].r, nodes[i + 1].r], 6));
    }
    for (let i = 1; i < nodes.length - 1; i++) {
      const a = new THREE.Vector3(...nodes[i - 1].p).sub(new THREE.Vector3(...nodes[i].p)).normalize();
      const b = new THREE.Vector3(...nodes[i + 1].p).sub(new THREE.Vector3(...nodes[i].p)).normalize();
      const phi = Math.PI - Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
      const r = (nodes[i].r * 1.02) / Math.max(0.66, Math.cos(phi / 2));
      add(new THREE.SphereGeometry(r * s, 14, 10), at(nodes[i].p[0], nodes[i].p[1], nodes[i].p[2]));
    }
    for (const end of [nodes[0], nodes[nodes.length - 1]]) {
      if (end.cap === false) continue;
      add(new THREE.SphereGeometry(end.r * 1.0 * s, 12, 9), at(end.p[0], end.p[1], end.p[2]));
    }
  };

  // Legs, weight on one of them. Contrapposto is the difference between a classical figure
  // and a shop dummy and it costs one displaced control point.
  limb([
    { p: [1.15, 0.55, 0.1], r: 0.62 },
    { p: [1.12, 3.4, 0.2], r: 0.95 },
    { p: [1.05, 6.6, 0.05], r: 0.80 },
    { p: [0.95, 9.0, -0.05], r: 1.15 },
    { p: [0.88, 11.2, 0], r: 1.32, cap: false },
  ]);
  limb([
    { p: [-1.25, 0.55, 0.55], r: 0.60 },
    { p: [-1.30, 3.5, 0.65], r: 0.92 },
    { p: [-1.35, 6.7, 0.4], r: 0.78 },
    { p: [-1.12, 9.1, 0.1], r: 1.12 },
    { p: [-0.88, 11.2, 0], r: 1.30, cap: false },
  ]);
  for (const [x, z] of [[1.15, 0.6], [-1.25, 1.05]]) {
    add(new THREE.BoxGeometry(1.5 * s, 0.7 * s, 3.0 * s), at(x, 0.35, z));
  }

  // Torso -- then FLATTENED, and that is the whole difference between a figure and a
  // snowman. A swept tube is as deep as it is wide by construction, so a chest sized to
  // look right from the front is a five-foot-deep barrel from the side, which is exactly
  // how the first pair read from the street. Scaling the finished geometry 1.3 wide and
  // 0.72 deep costs nothing (every control point is on x = 0, so nothing moves) and gives
  // the shallow, broad ribcage a human silhouette actually has.
  const torso = tube([[0, 10.6, 0], [0, 13.4, 0.2], [0, 16.2, 0.15], [0, 18.6, 0], [0, 19.8, -0.15]],
    [1.95, 1.6, 2.0, 2.15, 1.75]);
  torso.scale(1.3, 1, 0.72);
  add(torso);

  // A real shoulder line. Without it the arms grow straight out of the ribcage and the
  // whole upper body reads as one lump.
  const shoulders = new THREE.SphereGeometry(1.5 * s, 20, 14);
  shoulders.scale(1.8, 0.7, 0.78);
  add(shoulders, at(0, 19.3));

  // Drapery. A classical colossus is clothed, and a length of cloth falling from the hip
  // is what separates one from a mannequin -- it also closes the gap where two legs and a
  // torso meet, which on a figure this size is the widest crossing on the whole model.
  const cloth = tube([[0.1, 12.6, 0.1], [0.5, 10.2, 0.9], [0.7, 7.6, 1.15], [0.5, 5.2, 1.0], [0.2, 3.4, 0.7]],
    [2.25, 2.05, 1.65, 1.15, 0.7], 18);
  cloth.scale(1.12, 1, 0.62);
  add(cloth);

  // Arms. One down the flank, one raised across the body -- the pair in the photograph are
  // not mirror images, and a matched pair reads as a pattern rather than as sculpture.
  const raised = mirrored;
  limb(
    (raised
      ? [[2.9, 19.2, 0, 0.88], [3.7, 16.6, 0.9, 0.72], [4.0, 14.2, 1.9, 0.58], [3.6, 12.6, 2.7, 0.5]]
      : [[2.9, 19.2, 0, 0.88], [3.35, 16.4, 0.3, 0.72], [3.4, 13.6, 0.35, 0.58], [3.3, 11.9, 0.6, 0.5]]
    ).map(([x, y, z, r]) => ({ p: [x, y, z], r }))
  );
  limb([
    [-2.9, 19.2, 0, 0.88], [-3.3, 16.4, -0.1, 0.72], [-3.35, 13.6, 0.1, 0.58], [-3.2, 11.8, 0.5, 0.5],
  ].map(([x, y, z, r]) => ({ p: [x, y, z], r })));

  // Neck and head. A 24-unit figure gets a 3.2-unit head -- seven and a half heads tall,
  // the canonical proportion, and the neck has to be VISIBLE or the head sits on the
  // shoulders like a knob.
  add(tube([[0, 19.1, -0.1], [0, 21.0, 0]], [0.82, 0.72], 6));
  const head = new THREE.SphereGeometry(1.55 * s, 22, 16);
  head.scale(0.86, 1.12, 0.95);
  add(head, at(0, 22.4, 0.05));
  // Hair mass, which is what stops the head reading as an egg from below -- and from the
  // street below is the only place these are ever seen from.
  const hair = new THREE.SphereGeometry(1.62 * s, 18, 14);
  hair.scale(0.88, 1.02, 0.98);
  add(hair, at(0, 22.9, -0.18));

  return group(
    mergedMesh(parts, {
      roughness: 0.94,
      ...relief('stone', { seed, repeat: 4, strength: 0.45 }),
    })
  );
}

// The Bond clothing store: a dark storefront under a signboard four storeys high,
// carrying the giant BOND letters, the two colossi, and the illuminated disc between them.
//
// Authored facing +Z, origin base centre. It stands at the head of the avenue so the
// whole street terminates on it, which is exactly the job it does in the photograph.
export function bondBuilding({
  width = 68,
  depth = 32,
  seed = 27,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfW = width / 2;
  const halfD = depth / 2;
  const parts = [];

  const STORE = 15; // top of the storefront
  const WALL = 42; // top of the building proper -- the sign deck
  const SIGN_TOP = 56; // top of the BOND letter band

  parts.push({ geometry: new THREE.BoxGeometry(width, WALL, depth), position: [0, WALL / 2, 0], color: 0x8f8574 });
  // Polished dark base with big display windows. Bond's was a clothing store and the
  // whole ground floor is glass; the mullions between the bays are all that is solid.
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.6, STORE, depth + 0.6), position: [0, STORE / 2, 0], color: 0x2b2924 });
  parts.push({
    geometry: mouldedRing(MOULDING.plinth(1.1), halfW + 0.3, halfD + 0.3),
    position: [0, 0, 0],
    color: 0x22201c,
  });
  const bays = 7;
  for (let i = 0; i < bays; i++) {
    const x = -halfW + (width / bays) * (i + 0.5);
    parts.push({
      geometry: new THREE.BoxGeometry((width / bays) * 0.82, 8.4, 0.6),
      position: [x, 5.6, halfD + 0.35],
      color: 0x33434d,
    });
    parts.push({
      geometry: mouldedRun([[0, 0], [0.9, 0.06], [0.95, 0.2], [0.8, 0.46], [0.3, 0.56], [0, 0.58]], (width / bays) * 0.88),
      position: [x, 9.9, halfD + 0.3],
      color: 0x6d5c3a,
    });
  }
  parts.push({
    geometry: mouldedRing(MOULDING.belt(1.5), halfW + 0.5, halfD + 0.5),
    position: [0, STORE - 0.4, 0],
    color: 0xb3a892,
  });

  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: width * 0.8,
    yStart: STORE + 2.5, floors: 2, floorHeight: 9.5, bays: 6, rng, winW: 3.6, winH: 5.2,
  });
  for (const s of [-1, 1]) {
    punchWindows(parts, {
      axis: 'x', sign: s, faceAt: s * halfW, span: depth * 0.8,
      yStart: STORE + 2.5, floors: 3, floorHeight: 9.5, bays: 4, rng, detail: 'far',
    });
  }
  parts.push({
    geometry: mouldedRing(MOULDING.cornice(1.4), halfW, halfD),
    position: [0, WALL - 3.2, 0],
    color: STONE_LIGHT,
  });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.5, 1.6, depth + 0.5), position: [0, WALL - 0.8, 0], color: STONE_LIGHT });

  // The signboard: a solid backing wall standing on the roof, with the letter band
  // across its face. Backed solid on purpose -- a big flat panel seen from behind is a
  // black slab (the Mars lesson), and this one is seen from three quarters of the world.
  parts.push({ geometry: new THREE.BoxGeometry(width, SIGN_TOP - WALL, 2.4), position: [0, (WALL + SIGN_TOP) / 2, halfD - 1.2], color: 0x1c2b3f });
  // Truss legs behind the board, which is how these were actually held up.
  for (let i = 0; i < 5; i++) {
    const x = -halfW + 4 + i * ((width - 8) / 4);
    parts.push({ geometry: new THREE.BoxGeometry(0.7, SIGN_TOP - WALL + 6, 0.7), position: [x, (WALL + SIGN_TOP) / 2 + 3, halfD - 4.5], color: 0x33383d });
    parts.push({ geometry: new THREE.BoxGeometry(0.6, 0.6, 7), position: [x, WALL + 1.5, halfD - 4.0], color: 0x33383d });
    for (const dy of [-4, 4]) {
      parts.push({
        geometry: new THREE.BoxGeometry(0.4, 0.4, 7.6),
        rotation: [Math.sign(dy) * 0.75, 0, 0],
        position: [x, (WALL + SIGN_TOP) / 2 + dy, halfD - 3.0],
        color: 0x33383d,
      });
    }
  }

  const shell = mergeColored(parts);
  soot(shell, { amount: 0.09, seed, streak: 0.8, fade: 34 });
  g.add(mesh(shell, standard({ vertexColors: true, roughness: 0.9, ...relief('stone', { seed, repeat: 7 }) })));

  // --- the letters -----------------------------------------------------------------------
  const bondFace = signTexture({
    width: 1536,
    height: 420,
    face: '#152238',
    lines: [{ text: 'BOND', size: 0.68, color: '#fbf6e8', font: SANS }],
  });
  const letters = mesh(
    new THREE.PlaneGeometry(width - 3, SIGN_TOP - WALL - 1),
    standard({ map: bondFace, emissive: new THREE.Color(0xffffff), emissiveMap: bondFace, emissiveIntensity: 0.95, roughness: 0.55 })
  );
  letters.position.set(0, (WALL + SIGN_TOP) / 2, halfD + 0.05);
  g.add(letters);

  // --- storefront band -------------------------------------------------------------------
  const band = wallSign({
    width: width - 6,
    height: 4.6,
    face: '#111c2e',
    lines: [
      { text: 'BOND', size: 0.4, color: '#fbf6e8', font: SANS },
      { text: 'TWO  TROUSER  SUITS', size: 0.22, color: '#f0c86a', font: SANS },
    ],
  });
  band.position.set(0, 12.6, halfD + 0.9);
  g.add(band);

  // Vertical "CLOTHES" strip at the left edge of the storefront, as in the photograph.
  const clothes = bladeSign({ text: 'CLOTHES', height: 15, projection: 3.4, face: '#1c3f6b', atY: STORE + 2 });
  clothes.position.set(-halfW + 3.2, 0, halfD);
  g.add(clothes);

  // --- pedestals, statues, disc -------------------------------------------------------------
  const pedestalMat = standard({ color: 0xcdc4b0, roughness: 0.92, ...relief('stone', { seed: seed + 5, repeat: 3 }) });
  const statueX = halfW - 11;
  for (const side of [-1, 1]) {
    const plinth = group();
    plinth.add(box(11, 4.5, 9, pedestalMat, 0, 2.25, 0));
    plinth.add(mesh(mouldedRing(MOULDING.cornice(0.75), 5.5, 4.5), pedestalMat, 0, 4.4, 0));
    plinth.add(mesh(mouldedRing(MOULDING.plinth(0.7), 5.5, 4.5), pedestalMat, 0, 0, 0));
    plinth.position.set(side * statueX, SIGN_TOP, halfD - 5);
    g.add(plinth);

    // 29ft, on a shorter plinth. At 24 they were about one and a half times the height of
    // the letter band below them, and the photograph is nearer two and a half: from the
    // street the pair have to read as the biggest thing on the block, and a figure that
    // merely stands on a sign reads as a weathervane.
    const figure = bondStatue({ height: 29, mirrored: side < 0, seed: seed + (side > 0 ? 3 : 9) });
    figure.position.set(side * statueX, SIGN_TOP + 5.6, halfD - 5);
    // Turned a few degrees inward, toward each other and toward the street below.
    figure.rotation.y = side * -0.18;
    g.add(figure);
  }

  // The illuminated disc between them. Circular signs are drawn on a square canvas and
  // masked, not "drawn round" -- ring text is set by rotating the context about the
  // centre, one glyph at a time.
  const discTexture = canvasTexture(768, 768, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    // A LIT disc, not a dark one. Painted at the navy of the letter board it read as a
    // hole punched in the sky between the statues; the whole reason this thing is in the
    // photograph is that it glows.
    ctx.fillStyle = '#1c4b86';
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#f3e4b4';
    ctx.lineWidth = 9;
    for (const r of [w * 0.47, w * 0.335, w * 0.30]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const ring = (text, radius, size, color) => {
      const chars = [...text];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = color;
      ctx.font = SANS(size);
      ctx.textAlign = 'center';
      const step = (Math.PI * 2) / chars.length;
      chars.forEach((ch, i) => {
        ctx.save();
        ctx.rotate(i * step - Math.PI / 2 + step / 2);
        ctx.translate(0, -radius);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    };
    ring('★ BOND · CLOTHES · FOR · MEN · AND · WOMEN ', w * 0.40, 46, '#ffd766');

    ctx.fillStyle = '#fdfaf0';
    fitText(ctx, '1899', cx, cy + h * 0.05, w * 0.5, h * 0.3, SANS);
    ctx.fillStyle = '#d8e6f7';
    fitText(ctx, 'ESTABLISHED', cx, cy - h * 0.12, w * 0.36, h * 0.06, SANS_LIGHT);
    fitText(ctx, 'FIFTH  AVENUE  ·  BROADWAY', cx, cy + h * 0.18, w * 0.44, h * 0.05, SANS_LIGHT);

    // Painted bulbs round the rim, same reasoning as bulbBorder.
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      const r = w * 0.435;
      ctx.fillStyle = 'rgba(255,220,150,0.4)';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffeec2';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const discR = 9;
  const disc = group();
  const rim = mesh(revolve([
    [discR - 1.0, -0.9], [discR - 0.2, -0.9], [discR, -0.6], [discR, 0.6],
    [discR - 0.2, 0.9], [discR - 1.0, 0.9],
  ], 44), standard({ color: 0x22303f, roughness: 0.7, metalness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  disc.add(rim);
  const discFace = mesh(
    new THREE.CircleGeometry(discR - 0.15, 44),
    standard({ map: discTexture, emissive: new THREE.Color(0xffffff), emissiveMap: discTexture, emissiveIntensity: 1.25, roughness: 0.5 })
  );
  discFace.position.z = 0.86;
  disc.add(discFace);
  disc.position.set(0, SIGN_TOP + 13.5, halfD - 4.2);
  g.add(disc);

  return g;
}

// ---------------------------------------------------------------------------
// Other theatres, storefronts and street furniture
// ---------------------------------------------------------------------------

// A generic period movie house: a plain masonry front with a lit marquee and a blade.
// This is what "HOME OF THE BRAVE" and the Criterion are built from -- the same objects
// the hero theatre uses, without the classical base, the poster boards or the banner.
export function theatreFront({
  width = 40,
  depth = 26,
  height = 46,
  wallColor = 0xa08a6e,
  marqueeLines = [{ text: 'NOW SHOWING', size: 0.3, color: '#f7f1de', font: SANS }],
  marqueeFace = '#a8202b',
  bladeText = '',
  bladeFace = '#123a6b',
  bladeHeight = 20,
  seed = 19,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfD = depth / 2;
  const halfW = width / 2;
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(width, height, depth), position: [0, height / 2, 0], color: wallColor });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.6, 12, depth + 0.6), position: [0, 6, 0], color: 0x3f382f });
  parts.push({
    geometry: mouldedRing(MOULDING.plinth(1), halfW + 0.3, halfD + 0.3),
    position: [0, 0, 0],
    color: 0x322c25,
  });
  parts.push({ geometry: new THREE.BoxGeometry(13, 9.5, 2.6), position: [0, 4.75, halfD - 1.1], color: 0x14110e });
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: chamferBox(0.4, 8.6, 0.5, 0.09),
      position: [-6.5 + 1.3 + i * 3.3, 4.3, halfD + 0.1],
      color: 0xa08040,
    });
  }
  parts.push({
    geometry: mouldedRing(MOULDING.belt(1.2), halfW + 0.35, halfD + 0.35),
    position: [0, 12, 0],
    color: STONE_LIGHT,
  });
  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: width * 0.82,
    yStart: 24, floors: Math.max(1, Math.floor((height - 30) / 8.6)), floorHeight: 8.6,
    bays: Math.max(3, Math.round(width / 8)), rng,
  });
  parts.push({
    geometry: mouldedRing(MOULDING.cornice(1.3), halfW, halfD),
    position: [0, height - 3.4, 0],
    color: STONE_LIGHT,
  });
  parts.push({
    geometry: mouldedRing(MOULDING.coping(1.5), halfW + 0.35, halfD + 0.35, { closeTop: true }),
    position: [0, height - 1.0, 0],
    color: STONE_LIGHT,
  });
  parts.push({ geometry: new THREE.BoxGeometry(width + 0.5, 2.0, depth + 0.5), position: [0, height - 2.0, 0], color: STONE_LIGHT });

  const shell = mergeColored(parts);
  soot(shell, { amount: 0.10, seed, streak: 0.85, fade: 30 });
  g.add(mesh(shell, standard({ vertexColors: true, roughness: 0.9, ...relief('stone', { seed, repeat: 6 }) })));

  const box1 = marquee({
    width: width - 6,
    projection: 8.5,
    faceHeight: 5.6,
    atY: 11.5,
    face: marqueeFace,
    lines: marqueeLines,
  });
  box1.position.z = halfD;
  g.add(box1);

  if (bladeText) {
    const blade = bladeSign({ text: bladeText, height: bladeHeight, projection: 4.6, face: bladeFace, atY: 20 });
    blade.position.set(-width / 2 + 4.6, 0, halfD);
    g.add(blade);
  }
  return g;
}

// A run of low shops with canvas awnings, for the block ends. Authored facing +Z.
export function storefrontRow({
  length = 44,
  depth = 20,
  height = 22,
  shops = ['DRUGS', 'HABERDASHER', 'LUNCHEONETTE'],
  wallColor = 0x9a7f63,
  seed = 33,
} = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const halfD = depth / 2;
  const parts = [];

  parts.push({ geometry: new THREE.BoxGeometry(length, height, depth), position: [0, height / 2, 0], color: wallColor });
  parts.push({
    geometry: mouldedRing(MOULDING.plinth(0.9), length / 2 + 0.25, halfD + 0.25),
    position: [0, 0, 0],
    color: 0x6f5c46,
  });
  parts.push({
    geometry: mouldedRing(MOULDING.cornice(1.15), length / 2, halfD),
    position: [0, height - 2.6, 0],
    color: STONE_LIGHT,
  });
  parts.push({
    geometry: mouldedRing(MOULDING.coping(1.3), length / 2 + 0.3, halfD + 0.3, { closeTop: true }),
    position: [0, height - 0.6, 0],
    color: STONE_LIGHT,
  });
  parts.push({ geometry: new THREE.BoxGeometry(length + 0.4, 1.6, depth + 0.4), position: [0, height - 1.4, 0], color: STONE_LIGHT });
  punchWindows(parts, {
    axis: 'z', sign: 1, faceAt: halfD, span: length * 0.84,
    yStart: 13, floors: 1, floorHeight: 7.5, bays: shops.length * 2, rng, winW: 2.6, winH: 4.2,
  });

  const bayWidth = length / shops.length;
  for (let i = 0; i < shops.length; i++) {
    const x = -length / 2 + bayWidth * (i + 0.5);
    const bw = bayWidth * 0.9;
    parts.push({ geometry: new THREE.BoxGeometry(bw, 9, 0.6), position: [x, 5.2, halfD + 0.3], color: 0x2f3d47 });
    // A shopfront is a FRAME, not a hole: stallriser, stiles, transom and mullions. Left
    // as one dark panel per bay the whole ground floor reads as a row of black rectangles
    // punched in the wall, which is the same mistake a glazed door opening makes.
    parts.push({ geometry: new THREE.BoxGeometry(bw + 0.3, 1.5, 0.75), position: [x, 1.35, halfD + 0.4], color: 0x5b4a33 });
    for (const s of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(0.34, 9, 0.75), position: [x + s * bw / 2, 5.2, halfD + 0.4], color: 0x5b4a33 });
    }
    parts.push({ geometry: new THREE.BoxGeometry(bw, 0.3, 0.75), position: [x, 8.0, halfD + 0.4], color: 0x5b4a33 });
    for (const s of [-1, 1]) {
      parts.push({ geometry: new THREE.BoxGeometry(0.2, 6.0, 0.7), position: [x + s * bw * 0.24, 5.0, halfD + 0.4], color: 0x5b4a33 });
    }
    parts.push({
      geometry: mouldedRun([[0, 0], [0.62, 0.05], [0.66, 0.18], [0.52, 0.42], [0.2, 0.5], [0, 0.52]], bayWidth * 0.94),
      position: [x, 9.9, halfD + 0.35],
      color: 0x3a3128,
    });
  }
  const shell = mergeColored(parts);
  soot(shell, { amount: 0.10, seed: seed + 1, streak: 0.8, fade: 18 });
  g.add(mesh(shell, standard({ vertexColors: true, roughness: 0.92, ...relief('stone', { seed: seed + 1, repeat: 6 }) })));

  // Awnings, striped, sloping down toward the street. Every one of these fronts in the
  // photograph has one out, and the stripe is what identifies the period. They are SCALLOPED
  // along the leading edge and carried on real arms -- a flat rectangle of canvas on nothing
  // is a shelf, and the scallop is the one detail that says "awning" at any distance.
  const awningColors = ['#7d2f2f', '#2f5d7d', '#3f6b3f', '#7d6a2f'];
  for (let i = 0; i < shops.length; i++) {
    const x = -length / 2 + bayWidth * (i + 0.5);
    const tint = awningColors[Math.floor(rng() * awningColors.length)];
    const stripe = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#f2ead6';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = tint;
      for (let s = 0; s < 8; s += 2) ctx.fillRect((w / 8) * s, 0, w / 8, h);
    });
    // 5ft of reach, not the 6.4 this started at. A sidewalk here is only 10ft wide, and an
    // awning that covers half of it puts a canvas ceiling over the one place a student is
    // most likely to be standing -- they arrive looking at the underside of it rather than
    // at the street.
    const W = bayWidth * 0.86;
    // A plain BoxGeometry, not an extruded outline, and that is about UVs rather than
    // shape. extrudeOutline lays its texture coordinates out in FEET so a tiling bump map
    // sits at a fixed real-world scale -- right for a curb, wrong for a canvas whose
    // stripe has to span the awning exactly once. Clamped at u > 1 the whole canopy came
    // out as one flat off-white slab with the stripe nowhere on it.
    const canopy = mesh(
      new THREE.BoxGeometry(W, 0.26, 5.0),
      standard({ map: stripe, roughness: 0.95 })
    );
    canopy.position.set(x, 10.9, halfD + 2.5);
    canopy.rotation.x = 0.22;
    g.add(canopy);

    // The scalloped valance along the leading edge -- the one detail that says "awning"
    // rather than "shelf" at any distance. Built as a single scalloped OUTLINE extruded
    // through its own thickness: the first version lathed each scallop about Y, which
    // produces a half-disc lying flat like a saucer instead of a tab hanging down.
    const scallops = Math.max(4, Math.round(W / 1.5));
    const r = W / scallops / 2;
    const skirtOutline = [];
    for (let s = 0; s < scallops; s++) {
      const cx = -W / 2 + r * (2 * s + 1);
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        skirtOutline.push([cx + Math.cos(a) * r, Math.sin(a) * r * 0.9]);
      }
    }
    skirtOutline.push([W / 2, 0.34], [-W / 2, 0.34]);
    const skirt = mesh(extrudeOutline(skirtOutline, 0.07), standard({ map: stripe, roughness: 0.95 }));
    skirt.position.set(x, 10.62, halfD + 4.95);
    skirt.rotation.x = 0.22;
    g.add(skirt);

    for (const s of [-1, 1]) {
      g.add(mesh(
        chamferBox(0.09, 0.09, 5.2, 0.03),
        standard({ color: 0x33383a, roughness: 0.6, metalness: 0.5 }),
        x + s * W / 2, 10.85, halfD + 2.5
      ).rotateX(0.22));
    }

    const sign = wallSign({
      width: bayWidth * 0.8,
      height: 2.2,
      face: '#1d2b3f',
      bulbs: false,
      lines: [{ text: shops[i], size: 0.5, color: '#f0c86a', font: SANS }],
      emissiveIntensity: 0.5,
    });
    sign.position.set(x, 12.6, halfD + 0.5);
    g.add(sign);
  }
  return g;
}

// Post-mounted traffic signal, three lenses in a dark cast housing.
//
// The VISORS are the whole identity of a period signal: a 1940s head is three deep hoods
// stepping out of a cast body, and without them the object is a black box with three dots
// on it that could be any decade.
export function trafficSignal({ height = 13, seed = 12 } = {}) {
  const g = group();
  const iron = 0x2a2f31;
  const parts = [];
  put(parts, revolve([
    [0, 0], [0.82, 0], [0.82, 0.26], [0.70, 0.38], [0.70, 0.62],
    [0.44, 0.86], [0.36, 1.20], [0.34, 1.6], [0, 1.6],
  ], 14), iron);
  put(parts, sweepProfile(
    [[0, 1.4, 0], [0, height * 0.55, 0], [0, height + 0.4, 0]],
    flutedOutline(0.30, 10, 0.16),
    { samples: 4, up: new THREE.Vector3(1, 0, 0), at: (t) => ({ su: 1 - 0.26 * t, sv: 1 - 0.26 * t }) }
  ), iron);
  put(parts, chamferBox(1.6, 4.2, 1.4, 0.16), iron, [0, height + 1.6, 0]);
  put(parts, revolve([
    [0, 0], [0.95, 0], [1.0, 0.14], [0.9, 0.30], [0.7, 0.44], [0, 0.5],
  ], 12), iron, [0, height + 3.85, 0]);
  // Visors: a half-cone hood over each lens, open at the bottom.
  for (const dy of [1.2, 0, -1.2]) {
    put(parts, revolve([
      [0.44, 0], [0.50, 0], [0.56, -0.44], [0.50, -0.46], [0.44, -0.04],
    ], 14, 0, Math.PI), iron, [0, height + 1.6 + dy, 0.72], [Math.PI / 2, 0, 0]);
  }
  g.add(mergedMesh(parts, { roughness: 0.6, metalness: 0.5, ...relief('metal', { seed, repeat: 3 }) }));

  const lens = (color, y, lit) =>
    mesh(
      revolve([[0, 0.12], [0.20, 0.11], [0.33, 0.07], [0.40, 0], [0.40, -0.12], [0, -0.12]], 16),
      standard({
        color,
        emissive: new THREE.Color(color),
        emissiveIntensity: lit ? 2.4 : 0.12,
        roughness: 0.35,
      }),
      0,
      y,
      0.72
    );
  for (const [color, dy, lit] of [[0xd83a2a, 1.2, true], [0xe0a52c, 0, false], [0x39b862, -1.2, false]]) {
    const l = lens(color, height + 1.6 + dy, lit);
    l.rotation.x = Math.PI / 2;
    if (lit) l.userData.isGlowMesh = true;
    g.add(l);
  }
  return g;
}

// A curbside street-name blade plus a regulatory sign on the same post.
export function streetSign({ street = 'W 45 ST', notice = 'NO STANDING', height = 9 } = {}) {
  const g = group();
  const iron = standard({ color: 0x33383a, roughness: 0.6, metalness: 0.5 });
  g.add(mesh(revolve([
    [0, 0], [0.34, 0], [0.34, 0.22], [0.24, 0.34], [0.19, 0.5],
    [0.16, height * 0.5], [0.13, height - 0.3], [0.17, height - 0.18],
    [0.17, height], [0, height],
  ], 12), iron));

  const nameTexture = signTexture({
    width: 512,
    height: 128,
    face: '#1d4a2e',
    bulbs: false,
    lines: [{ text: street, size: 0.52, color: '#f4f1e6', font: SANS }],
  });
  const blade = signPanel(4.4, 1.1, nameTexture);
  blade.position.set(0, height - 0.8, 0.05);
  g.add(blade);
  g.add(mesh(chamferBox(4.5, 1.2, 0.1, 0.03), iron, 0, height - 0.8, 0));

  if (notice) {
    const noticeTexture = signTexture({
      width: 320,
      height: 400,
      face: '#f2efe4',
      bulbs: false,
      lines: [
        { text: notice.split(' ')[0], size: 0.19, color: '#8c1c22', font: SANS },
        { text: notice.split(' ').slice(1).join(' '), size: 0.19, color: '#8c1c22', font: SANS },
      ],
    });
    const plate = signPanel(1.5, 1.9, noticeTexture);
    plate.position.set(0, height - 3.2, 0.05);
    g.add(plate);
    g.add(mesh(chamferBox(1.6, 2.0, 0.1, 0.03), iron, 0, height - 3.2, 0));
  }
  return g;
}

// A cast-iron fire hydrant. Almost the whole object is a solid of revolution, which is
// what it actually is -- a casting turned about its own axis -- so a lathe gives both a
// better shape and fewer triangles than the stack of cylinders it replaces.
export function fireHydrant({ color = 0x9c3226 } = {}) {
  const parts = [];
  put(parts, revolve([
    [0, 0], [0.78, 0], [0.78, 0.18], [0.66, 0.30], [0.62, 0.42], [0, 0.42],
  ], 16), 0x3f3a33);
  put(parts, revolve([
    [0, 0.42], [0.56, 0.42], [0.52, 0.62], [0.44, 0.90], [0.42, 1.55],
    [0.44, 1.85], [0.52, 2.00], [0.54, 2.12], [0.46, 2.20],
    [0.44, 2.30], [0.50, 2.44], [0.46, 2.60], [0.34, 2.74],
    [0.20, 2.82], [0.09, 2.86], [0, 2.87],
  ], 18), color);
  // The two side nozzles with their caps, and the pumper nozzle facing the street.
  for (const [rot, at] of [
    [[0, 0, Math.PI / 2], [0.52, 1.62, 0]],
    [[0, 0, -Math.PI / 2], [-0.52, 1.62, 0]],
    [[Math.PI / 2, 0, 0], [0, 1.30, 0.52]],
  ]) {
    put(parts, revolve([
      [0, 0], [0.22, 0], [0.24, 0.14], [0.22, 0.22], [0.26, 0.26],
      [0.26, 0.34], [0.20, 0.40], [0, 0.42],
    ], 10), color, at, rot);
  }
  // The operating nut on top -- a five-sided pentagon nut, which is the detail that says
  // fire hydrant rather than bollard.
  put(parts, revolve([[0, 0], [0.19, 0], [0.19, 0.24], [0.13, 0.28], [0, 0.28]], 5), 0x7d2a20, [0, 2.87, 0]);
  return group(mergedMesh(parts, { roughness: 0.75, metalness: 0.2, ...relief('metal', { seed: 44, repeat: 2 }) }));
}

// A corner newsstand: a green board kiosk stacked with papers and magazines.
export function newsstand({ seed = 55 } = {}) {
  const g = group();
  const rng = seededRandom(seed);
  const parts = [];
  const W = 8;
  const D = 5;
  const H = 8;

  parts.push({ geometry: new THREE.BoxGeometry(W, 0.3, D), position: [0, 0.15, 0], color: 0x2f5340 });
  parts.push({ geometry: new THREE.BoxGeometry(W, H, 0.35), position: [0, H / 2, -D / 2], color: 0x2f5340 });
  for (const side of [-1, 1]) {
    parts.push({ geometry: new THREE.BoxGeometry(0.35, H, D), position: [side * (W / 2), H / 2, 0], color: 0x2f5340 });
  }
  parts.push({ geometry: new THREE.BoxGeometry(W, 3.2, 0.35), position: [0, H - 1.6, D / 2], color: 0x2f5340 });
  // A boarded roof with a real fascia and a slight overhang, rather than a flat lid.
  parts.push({ geometry: chamferBox(W + 2.4, 0.34, D + 2.6, 0.1), position: [0, H + 0.17, 0.9], color: 0x24402f });
  parts.push({
    geometry: mouldedRun([[0, 0], [0.34, 0.04], [0.36, 0.18], [0.26, 0.34], [0, 0.38]], W + 2.4),
    position: [0, H - 0.2, 0.9 + (D + 2.6) / 2],
    color: 0x1c3324,
  });
  parts.push({ geometry: new THREE.BoxGeometry(W, 0.35, 2.2), position: [0, 3.4, D / 2 + 0.6], color: 0x6d5c3a });
  g.add(mergedMesh(parts, { roughness: 0.9, ...relief('wood', { seed, repeat: 4 }) }));

  // Papers and magazines, seeded so a reload gives back the same stand.
  const stock = [];
  for (let i = 0; i < 22; i++) {
    const x = randomIn(rng, -W / 2 + 0.9, W / 2 - 0.9);
    const y = 3.75 + Math.floor(rng() * 3) * 0.12;
    const shade = [0xd8d2c0, 0xc9c2ad, 0xdcd0a8, 0xcbb9a0][Math.floor(rng() * 4)];
    stock.push({
      geometry: chamferBox(1.1, 0.09, 1.5, 0.02),
      rotation: [0, randomIn(rng, -0.3, 0.3), 0],
      position: [x, y, D / 2 + randomIn(rng, 0.1, 1.1)],
      color: shade,
    });
  }
  // A rack of magazines standing up against the back board, which is what actually fills
  // the eye at a stand -- flat stacks alone read as a table of paper.
  for (let i = 0; i < 12; i++) {
    stock.push({
      geometry: chamferBox(0.92, 1.25, 0.07, 0.02),
      rotation: [0, randomIn(rng, -0.12, 0.12), 0],
      position: [-W / 2 + 0.8 + i * ((W - 1.6) / 11), 5.5, -D / 2 + 0.45],
      color: [0xc2543f, 0x4a6f8c, 0xd8c47a, 0xb8b0a0][Math.floor(rng() * 4)],
    });
  }
  g.add(mergedMesh(stock, { roughness: 0.95 }));

  const header = wallSign({
    width: W - 0.6,
    height: 1.8,
    face: '#1b2c1f',
    bulbs: false,
    lines: [{ text: 'NEWS  ·  CIGARS  ·  CANDY', size: 0.42, color: '#f0c86a', font: SANS }],
    emissiveIntensity: 0.45,
  });
  header.position.set(0, H - 1.6, D / 2 + 0.3);
  g.add(header);
  return g;
}

// A cast-iron subway entrance kiosk with its railing and stair mouth -- the one piece of
// street furniture that says "New York" on its own.
export function subwayEntrance({ label = 'SUBWAY', seed = 66 } = {}) {
  const g = group();
  const iron = 0x2d3134;
  const parts = [];
  const W = 9;
  const D = 7;

  // The stair opening is a dark box sunk into the sidewalk, not a hole in the ground:
  // the terrain here is a solid mesh and nothing can be cut out of it.
  parts.push({ geometry: new THREE.BoxGeometry(W - 1.6, 1.2, D - 1.6), position: [0, -0.4, 0], color: 0x0d0f11 });
  // A few treads disappearing into it, so the box reads as stairs going down.
  for (let i = 0; i < 4; i++) {
    parts.push({
      geometry: new THREE.BoxGeometry(W - 1.8, 0.16, 0.9),
      position: [0, -0.05 - i * 0.34, D / 2 - 1.4 - i * 0.95],
      color: 0x55504a,
    });
  }
  for (const [w, d, x, z] of [[W, 0.5, 0, -D / 2], [W, 0.5, 0, D / 2], [0.5, D, -W / 2, 0], [0.5, D, W / 2, 0]]) {
    parts.push({ geometry: new THREE.BoxGeometry(w, 0.5, d), position: [x, 0.25, z], color: 0x6e6a61 });
  }
  // Railing: newels, a moulded top rail and turned balusters, three sides only -- the
  // fourth is the way in.
  const baluster = revolve([
    [0, 0], [0.10, 0], [0.10, 0.22], [0.065, 0.34], [0.065, 1.1],
    [0.115, 1.3], [0.115, 1.5], [0.065, 1.7], [0.065, 2.6],
    [0.10, 2.76], [0.10, 3.1], [0, 3.1],
  ], 8);
  for (const [x, z, along] of [[0, -D / 2, 'x'], [-W / 2, 0, 'z'], [W / 2, 0, 'z']]) {
    const span = along === 'x' ? W : D;
    const rail = mouldedRun([[0, 0], [0.16, 0.03], [0.18, 0.12], [0.12, 0.22], [0, 0.24]], span);
    parts.push({
      geometry: rail,
      position: [x, 3.24, z],
      color: iron,
      rotation: along === 'x' ? null : [0, Math.PI / 2, 0],
    });
    const count = Math.round(span / 0.9);
    for (let i = 0; i <= count; i++) {
      const t = -span / 2 + (span / count) * i;
      parts.push({
        geometry: baluster,
        position: along === 'x' ? [t, 0.2, z] : [x, 0.2, t],
        color: iron,
      });
    }
  }
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    parts.push({
      geometry: revolve([
        [0, 0.2], [0.26, 0.2], [0.26, 0.55], [0.20, 0.7], [0.20, 3.6],
        [0.28, 3.8], [0.28, 4.0], [0.20, 4.15], [0, 4.2],
      ], 10),
      position: [x, 0, z],
      color: iron,
    });
  }
  g.add(mergedMesh(parts, { roughness: 0.65, metalness: 0.5, ...relief('metal', { seed, repeat: 3 }) }));

  // The pair of glass globes on the front newels. New York put green globes on entrances
  // that were manned all night and red ones on the rest, and they are the single most
  // recognisable thing about a subway stair -- more than the railing, more than the sign.
  const globes = [];
  for (const x of [-W / 2, W / 2]) {
    globes.push({
      geometry: revolve([
        [0, 0.55], [0.24, 0.50], [0.40, 0.34], [0.46, 0.10], [0.44, -0.16],
        [0.32, -0.40], [0.16, -0.52], [0, -0.55],
      ], 14),
      position: [x, 4.85, 0],
      color: 0x3fa05a,
    });
  }
  const lit = mergedMesh(globes, { emissive: new THREE.Color(0x54d47a), emissiveIntensity: 1.4, roughness: 0.4 });
  lit.castShadow = false;
  lit.userData.isGlowMesh = true;
  g.add(lit);
  for (const x of [-W / 2, W / 2]) {
    g.add(mesh(revolve([[0, 0], [0.20, 0], [0.16, 0.14], [0.12, 0.24], [0, 0.26]], 10),
      standard({ color: iron, roughness: 0.6, metalness: 0.5 }), x, 4.2, 0));
  }

  // The sign rides the CLOSED back rail and faces outward (-Z), away from the stair.
  // Mounted on the open side it would hang over the way in, and facing +Z from the back
  // rail it would be readable only by somebody already standing on the steps.
  const sign = wallSign({
    width: 5.2,
    height: 1.7,
    face: '#0f2340',
    bulbs: false,
    lines: [{ text: label, size: 0.5, color: '#f4f1e6', font: SANS }],
    emissiveIntensity: 0.5,
  });
  sign.position.set(0, 5.6, -D / 2 - 0.3);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.add(cyl(0.12, 0.12, 2.6, standard({ color: iron, roughness: 0.6, metalness: 0.5 }), 0, 4.3, -D / 2 - 0.2, 8));
  return g;
}
