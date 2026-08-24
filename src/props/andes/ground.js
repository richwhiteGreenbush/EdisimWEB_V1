import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  standard, mesh, group, canvasTexture, seededRandom, randomIn, relief,
} from '../../PropKit.js';
import {
  ball, mergeParts, smoothNoise3, transportFrames, solidSurface, put,
} from '../LoftKit.js';

// Machu Picchu: ground cover, and the colour on a site that is otherwise grey stone and
// green turf.
//
// Everything here is read from FIVE TO TWENTY-FIVE FEET -- a student walks between these,
// stands over the flowers and puts a hand on the outcrop -- so the budget goes into what
// survives that range: the fracture flats on the rock, the arch of a grass blade, the
// peeling sheets of Polylepis bark, and a per-bloom colour drift. Nothing here spends on
// tessellation nobody can resolve at ten feet.
//
// The five plants are all genuinely on this site. That is not decoration policy, it is the
// whole point: this is a teaching world, and inventing scenery for an archaeological site
// would be worse than leaving it grey. Ichu is the bunch grass of the puna and the stuff
// the roofs are thatched with; Polylepis (quenua) is the highest-growing tree in the world
// and grows in the cloud forest right below the ruins; Bomarea, Salvia, lupins and small
// orange orchids all flower on the site, which holds over four hundred orchid species; and
// the andenes grew maize and potatoes, which is what they were terraced for.
//
// House rules: feet at scale 1, origin at base centre, fresh materials per call,
// seededRandom never Math.random. See PropKit.js and LoftKit.js.

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

// Andean granite: a pale grey with a warm feldspar cast, plus the two lichens that cover
// every exposed rock on this ridge -- a sulphur-yellow crustose and a rust-orange one.
const GD_GRANITE = [0x8d887e, 0xa8a297, 0xb7b1a5, 0x7b766d];
const GD_LICHEN_PALE = 0xa9ac68;
const GD_LICHEN_RUST = 0x9d6f3c;

// Ichu is a HIGH-ALTITUDE BUNCH GRASS and it is straw far more than it is green. Painted
// at meadow green it reads as an English lawn at 8,000ft, which is the one thing the puna
// is not; these are the tones of a tussock that spends its life in frost and UV.
const GD_ICHU = [0xb6a163, 0xa79a5f, 0x8e9055, 0xc6b483, 0x9c8b55];

const GD_TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Shared private helpers
// ---------------------------------------------------------------------------

// HSL jitter around a base colour. Eight flat colours across forty blooms still reads as
// eight kinds of plastic; nudging each one is what turns a palette into planting.
function gd_tone(hex, rng, dh = 0.03, ds = 0.08, dl = 0.07) {
  const c = new THREE.Color(hex);
  c.offsetHSL(randomIn(rng, -dh, dh), randomIn(rng, -ds, ds), randomIn(rng, -dl, dl));
  return c.getHex();
}

// The swept-solid core every stalk, blade and limb in this file is built on: a closed,
// CAPPED tube of elliptical section along a curve.
//
// THE WINDING IS THE ONE THING TO GET RIGHT, and it is measurable rather than arguable.
// With (binormal, normal) from a parallel-transported frame the ring runs CLOCKWISE about
// the tangent, so the quad order that reads as the natural one produces INWARD faces --
// which does not look like a missing surface, it looks like a DARK one, the failure mode
// this project has already recorded for revolve's bottom-up profiles and for LoftKit's odd
// axis permutations. Measured against THREE.TubeGeometry's own output on the same curve:
// (a, b, d)/(b, c, d) gives outward faces and the mirror of it gives inward ones.
//
// BOTH ENDS ARE ALWAYS CAPPED. A tube is otherwise a SLEEVE -- it does not close itself --
// and an uncapped end is a hole straight down the middle of a stalk. Capping costs `sides`
// triangles and makes "leave no open spaces" structural instead of remembered.
function gd_sweptSolid(curve, { spans, sides, wAt, tAt, bowAt = null }) {
  const frames = transportFrames(curve, spans);
  const positions = [];
  const uvs = [];
  const indices = [];
  const ring = sides + 1;

  for (let i = 0; i <= spans; i++) {
    const t = i / spans;
    const f = frames[i];
    const w = wAt(t);
    const d = tAt(t);
    const bow = bowAt ? bowAt(t) : 0;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * GD_TWO_PI;
      const c = Math.cos(a) * w;
      const s = Math.sin(a) * d + bow;
      positions.push(
        f.point.x + f.binormal.x * c + f.normal.x * s,
        f.point.y + f.binormal.y * c + f.normal.y * s,
        f.point.z + f.binormal.z * c + f.normal.z * s,
      );
      uvs.push(t, j / sides);
    }
  }
  for (let i = 1; i <= spans; i++) {
    for (let j = 1; j <= sides; j++) {
      const a = ring * (i - 1) + (j - 1);
      const b = ring * i + (j - 1);
      const c = ring * i + j;
      const d = ring * (i - 1) + j;
      indices.push(a, b, d, b, c, d);
    }
  }

  // The caps. Their winding is TESTED rather than reasoned about -- one end faces along
  // the tangent and the other against it, so a single hand-derived order is right at one
  // end and backwards at the other, and a cap wound the wrong way is a dark disc rather
  // than a missing one.
  const cap = (row, outward) => {
    const centre = frames[row].point;
    const ci = positions.length / 3;
    positions.push(centre.x, centre.y, centre.z);
    uvs.push(0.5, 0.5);
    const base = ring * row;
    const va = new THREE.Vector3();
    const vb = new THREE.Vector3();
    for (let j = 0; j < sides; j++) {
      const i0 = base + j;
      const i1 = base + j + 1;
      va.set(positions[i0 * 3] - centre.x, positions[i0 * 3 + 1] - centre.y, positions[i0 * 3 + 2] - centre.z);
      vb.set(positions[i1 * 3] - centre.x, positions[i1 * 3 + 1] - centre.y, positions[i1 * 3 + 2] - centre.z);
      if (new THREE.Vector3().crossVectors(va, vb).dot(outward) >= 0) indices.push(ci, i0, i1);
      else indices.push(ci, i1, i0);
    }
  };
  cap(0, frames[0].tangent.clone().negate());
  cap(spans, frames[spans].tangent.clone());

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

// A tapering blade, leaf or leaflet swept along a REAL CURVE.
//
// This is the answer to "a cone is a spike, not a blade", and it is also the answer to the
// trap recorded for A Bug's Life: placing each segment at its own height and rotating it by
// the local slope makes the pieces come apart halfway up, because the sideways displacement
// grows far faster than the vertical spacing -- a clump then reads as green dashes hanging
// in mid-air. Here nothing is "placed and rotated" at all: every ring is emitted AT a
// sampled point of a QuadraticBezierCurve3 on a parallel-transported frame, so the surface
// is continuous by construction.
//
// It is a CLOSED SOLID of lens-ish section, not a DoubleSide plane -- the lesson Under the
// Sea's rebuild paid for. And it NEVER tapers to a point: a blade that goes to zero width
// reads as a black needle (the Dinosaur Island frond lesson), so the tip is about a third
// of the base and gets a real cap.
function gd_ribbon(p0, p1, p2, {
  width, tipWidth = null, thick = null, spans = 4, sides = 4, curl = 0,
} = {}) {
  const wTip = tipWidth ?? width * 0.34;
  const th = thick ?? width * 0.24;
  const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
  return gd_sweptSolid(curve, {
    spans,
    sides,
    wAt: (t) => width + (wTip - width) * t,
    tAt: (t) => th * (1 - 0.5 * t),
    // A real blade is dished along its length, so the section's own centre rides a little
    // to one side. Flat sections read as plastic strapping.
    bowAt: (t) => curl * Math.sin(t * Math.PI) * (width + (wTip - width) * t),
  });
}

// A stem: one smooth swept solid, plus a swelling at the root. The radius blend is
// quadratic so a stalk thickens at the base rather than tapering along a straight line.
function gd_stem(parts, colour, pts, radii, { sides = 6, steps = 5, root = true, tint = null } = {}) {
  const curve = new THREE.QuadraticBezierCurve3(pts[0], pts[1], pts[2]);
  const rAt = (t) => (1 - t) * (1 - t) * radii[0] + 2 * (1 - t) * t * radii[1] + t * t * radii[2];
  const g = gd_sweptSolid(curve, { spans: steps, sides, wAt: rAt, tAt: rAt });
  const extra = tint ? { keepColor: true, tint } : null;
  put(parts, g, colour, null, null, extra);
  if (root) put(parts, ball(radii[0] * 1.15, 6), colour, [pts[0].x, pts[0].y, pts[0].z], null, extra);
  return g;
}

// A run of tubes with a SOCKET BALL at every interior node -- LoftKit's chain(), rebuilt
// here on gd_sweptSolid so the members are capped and outward-wound.
//
// SOCKET SIZE COMES FROM THE BEND, not from the fattest nearby radius. Both spans already
// carry that node's radius there, so the ball only has to cover the flats' inset plus the
// wedge the two end planes leave on the outside of the bend -- a factor of 1/cos(phi/2).
// Sized from a neighbouring radius instead, a 0.5ft joint gets an 0.8ft ball and every
// limb reads as a stack of balloons.
function gd_chain(list, colour, nodes, { sides = 10, steps = 4, detail = 8, base = null } = {}) {
  const push = (geometry, position = null) => put(list, geometry, colour, position, null, base);
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = new THREE.Vector3(...nodes[i].p);
    const b = new THREE.Vector3(...nodes[i + 1].p);
    const mid = a.clone().lerp(b, 0.5);
    const r0 = nodes[i].r;
    const r1 = nodes[i + 1].r;
    const rAt = (t) => r0 + (r1 - r0) * t;
    push(gd_sweptSolid(new THREE.QuadraticBezierCurve3(a, mid, b), { spans: steps, sides, wAt: rAt, tAt: rAt }));
  }
  for (let i = 1; i < nodes.length - 1; i++) {
    const u = new THREE.Vector3(...nodes[i].p).sub(new THREE.Vector3(...nodes[i - 1].p)).normalize();
    const v = new THREE.Vector3(...nodes[i + 1].p).sub(new THREE.Vector3(...nodes[i].p)).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    push(ball((nodes[i].r * 1.02) / Math.max(0.62, Math.cos(phi / 2)), detail), nodes[i].p);
  }
}

// A five- or six-pointed flower face. A CircleGeometry with alternate rim vertices pushed
// out to the tips: ten triangles, against forty for the little sphere it replaces, and it
// is the SHAPE while the veined texture and the vertex colour carry everything else.
//
// The UVs have to be rewritten from the final outline -- CircleGeometry lays them out for
// the circle it started as, and left alone they squeeze the veins into the notches.
function gd_starHead({ points = 5, notch = 0.62, dish = 0.26 } = {}) {
  const segments = points * 2;
  const geometry = new THREE.CircleGeometry(1, segments);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 1; i < pos.count; i++) {
    const s = (i - 1) % segments;
    const tip = s % 2 === 0;
    const r = tip ? 1 : notch;
    const a = (s / segments) * GD_TWO_PI;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    pos.setXYZ(i, x, y, tip ? 0 : -dish * 0.35);
    uv.setXY(i, x * 0.5 + 0.5, y * 0.5 + 0.5);
  }
  pos.setZ(0, -dish);
  geometry.computeVertexNormals();
  return geometry;
}

// A CLOSED, flattened, lobed corolla -- a small flower for a mesh that has no DoubleSide
// material to hide behind. The lobes come from a radial warp of a sphere, which is a
// function of DIRECTION, so shared corners move identically and the shell cannot tear.
function gd_lobedDisc(radius, lobes = 5, flat = 0.3, depth = 0.26) {
  // Detail 8, not 10: this flower is an inch and a half across.
  const g = ball(radius, 8);
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const len = p.length() || 1;
    // AN AZIMUTHAL WARP HAS TO FADE TO NOTHING AT THE POLES. A sphere's pole is a whole
    // row of coincident vertices, and three.js writes them with SIGNED ZEROS in x and z --
    // so atan2 hands back 0, +pi and -pi for different copies of the same point, and a
    // cos(lobes * a) term then pulls them to different heights and tears the pole open.
    // Measured: eight boundary edges per flower, invisible until they were counted.
    const hor = Math.hypot(p.x, p.z) / len;
    const r = radius * (1 + depth * hor * Math.cos(Math.atan2(p.z, p.x) * lobes)) / len;
    pos.setXYZ(i, p.x * r, p.y * r * flat, p.z * r);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// The near-WHITE veined disc every bloom is painted with.
//
// Same trick as ParkProps' flower bed, and it is the one place this project deliberately
// uses the map-times-vertexColors multiply it otherwise warns about: the map has no colour
// of its own, so it carries pattern at a scale vertices cannot reach while the vertex
// colour carries the hue. One canvas and one merge therefore give a drift in which no two
// blooms share a colour, each correctly veined.
//
// The veins are drawn FAT. A bloom is about thirty screen pixels across with a student
// standing over it, so a three-pixel line on a 256px canvas lands under one screen pixel
// and mips away to nothing -- which is exactly how the first pass of the Park's flowers
// rendered: flat coloured stars with no veining at all.
function gd_bloomTexture(seed = 5) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // A dark throat. Bomarea, Salvia and the site's orchids all have a deeper funnel and a
    // paler eye, and it is what stops a bloom reading as a flat chip of colour.
    const throat = ctx.createRadialGradient(cx, cy, R * 0.03, cx, cy, R * 0.5);
    throat.addColorStop(0, 'rgba(96,68,40,0.72)');
    throat.addColorStop(0.45, 'rgba(178,150,110,0.40)');
    throat.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = throat;
    ctx.fillRect(0, 0, w, h);

    const rng = seededRandom(seed);
    const petals = 6;
    for (let p = 0; p < petals; p++) {
      const mid = (p / petals) * GD_TWO_PI - Math.PI / 2;
      const vein = (angle, width, alpha, reach) => {
        ctx.strokeStyle = `rgba(122,80,44,${alpha})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * R * 0.1, cy + Math.sin(angle) * R * 0.1);
        // A bow, so the veins splay toward the petal edge. Straight spokes read as a
        // dartboard, which is what the eye notices first and never stops noticing.
        const bow = randomIn(rng, -0.1, 0.1);
        ctx.quadraticCurveTo(
          cx + Math.cos(angle + bow) * R * reach * 0.6, cy + Math.sin(angle + bow) * R * reach * 0.6,
          cx + Math.cos(angle + bow * 2.2) * R * reach, cy + Math.sin(angle + bow * 2.2) * R * reach,
        );
        ctx.stroke();
      };
      vein(mid, 11, 0.55, 0.97);
      for (const off of [-0.26, 0.26]) vein(mid + off, 6.5, 0.38, 0.88);
      for (const off of [-0.42, 0.42]) vein(mid + off, 4, 0.24, 0.7);
    }

    // Anthers. Drawn very light so whatever hue multiplies through, the centre stays the
    // palest part of the bloom -- which is what reads as "stamens" long after the shape
    // itself has stopped being resolvable.
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * GD_TWO_PI + 0.5;
      ctx.strokeStyle = 'rgba(255,250,226,0.85)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 0.05, cy + Math.sin(a) * R * 0.05);
      ctx.lineTo(cx + Math.cos(a) * R * 0.22, cy + Math.sin(a) * R * 0.22);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,246,214,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.05, 0, GD_TWO_PI);
    ctx.fill();
  });
}

// ---------------------------------------------------------------------------
// Granite outcrop
// ---------------------------------------------------------------------------

// A broken rock, as a pure function of DIRECTION.
//
// The version this replaces was rotated BOXES, and before that the technique in every
// other world was a noise-displaced sphere, which is a potato: convex everywhere, the same
// size along every axis, without one flat face or one sharp edge on it. WHAT MAKES STONE
// READ AS STONE IS THAT IT BROKE. Three things come out of one radial displacement --
// radial because a shared corner must move identically from every triangle that owns it,
// or the surface tears into loose shards (the puddingstone outcrops and the reef rocks
// each learned that separately):
//
//  * FRACTURE is the SUPPORT FUNCTION of a convex polyhedron: min(h_i / (d . n_i)) over
//    the planes facing direction d. A pure function of direction, so it cuts genuine flats
//    into a sphere with no CSG anywhere and no risk of tearing.
//  * MASS is a low-frequency lobe field plus a per-rock anisotropic scale. This is the half
//    that fixes "too symmetrical" -- a block 1.2 long, 0.85 wide and 0.95 tall has stopped
//    being a ball before any surface detail is applied.
//  * WEATHERING is two octaves of noise riding on both.
//
// Plane normals come off a golden-angle spiral WITH jitter: nine freely-drawn directions
// reliably leave one flank uncut, and an uncut flank is a bare piece of the original
// sphere -- the exact thing being removed.
//
// `toCreasedNormals` is what makes it worth paying for: it welds normals only where
// neighbouring faces are near coplanar, so the fracture flats stay flat, the arrises stay
// sharp and the weathered curve between them stays smooth. CREASE IS BOUNDED BELOW BY THE
// TESSELLATION -- at detail d a smooth sphere already turns 360/d per step, so a crease
// angle under that welds nothing and the whole rock flat-shades. 26 degrees is comfortably
// above the ~11 a detail-32 sphere runs at and below the 40-plus an arris makes.
function gd_rock(size, seed, {
  rough = 0.2, flatten = 1, detail = 32, angular = 0.66, facets = 10, crease = 26,
} = {}) {
  const rng = seededRandom(Math.round(seed * 97) + 11);
  const planes = [];
  for (let i = 0; i < facets; i++) {
    const yy = 1 - ((i + 0.5) / facets) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const a = i * 2.399963229728653;
    planes.push({
      n: new THREE.Vector3(
        Math.cos(a) * rr + (rng() - 0.5) * 0.6,
        yy + (rng() - 0.5) * 0.6,
        Math.sin(a) * rr + (rng() - 0.5) * 0.6,
      ).normalize(),
      // The SPREAD of offsets varies the face sizes. Every plane at one distance gives a
      // regular solid, which is a crystal: it reads as manufactured, not as broken.
      h: randomIn(rng, 0.62, 1.05),
    });
  }
  const sx = randomIn(rng, 0.84, 1.24);
  const sy = randomIn(rng, 0.8, 1.12);
  const sz = randomIn(rng, 0.84, 1.24);
  const lobeSeed = rng() * 40;

  const surfaceAt = (dir) => {
    const d = dir.clone().normalize();
    let poly = 1.5;
    for (const pl of planes) {
      const dot = d.dot(pl.n);
      if (dot > 1e-3) poly = Math.min(poly, pl.h / dot);
    }
    const lobe = 1 + (smoothNoise3(d.x * 1.15 + lobeSeed, d.y * 1.15, d.z * 1.15) - 0.5) * 0.42;
    const n = smoothNoise3(d.x * 2.6 + seed, d.y * 2.6, d.z * 2.6)
      + smoothNoise3(d.x * 6.4 + seed, d.y * 6.4, d.z * 6.4) * 0.4;
    const wear = 1 + (n - 0.7) * rough;
    // The 1.08 hands back the cutting's own shrinkage: ten planes at a mean offset of 0.84
    // take a sphere down to about that, and a block sized in feet by its caller should not
    // quietly come out a sixth smaller than asked for.
    const r = size * lobe * wear * (1 - angular + angular * poly) * 1.08;
    return new THREE.Vector3(d.x * r * sx, d.y * r * sy * flatten, d.z * r * sz);
  };

  const g = ball(size, detail);
  const pos = g.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const p = surfaceAt(d);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  const out = toCreasedNormals(g, (crease * Math.PI) / 180);
  out.userData.surfaceAt = surfaceAt;
  return out;
}

// A granite outcrop breaking through the turf. The whole ridge is like this, and the Inca
// masons quarried where they built -- several of the site's walls run straight into the
// bedrock they came out of.
//
// THIS IS BEDROCK, NOT BOULDERS, and three decisions carry that:
//
//  * ONE BEDDING PLANE. Every block takes the SAME dip, applied after its own yaw, because
//    a real outcrop's blocks are all tilted the same way -- they are one jointed rock mass,
//    and the joints are what the frost prised apart. Blocks tilted independently read as a
//    load of rubble tipped off a lorry. The dip is about world X for every outcrop on the
//    site on purpose: the same ridge, so the same bedding.
//  * BEDDED, NOT RESTING. Each block is sunk about a quarter of its own height below the
//    origin, so the prop's box.min.y is deliberately NEGATIVE. A rock whose lowest point is
//    exactly on the turf reads as a dropped pebble however good its shape is, and on a
//    slope the buried mass is what becomes the exposed face further downhill.
//  * BLOCKS OVERLAP. Spacing is less than the sum of neighbouring radii, so the mass is
//    continuous and there is no daylight between one block and the next.
export function graniteOutcrop({ size = 8, seed = 41 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  // The bedding. Rx is applied AFTER Ry in an XYZ Euler (the matrix is Rx.Ry.Rz), so a
  // per-block yaw turns the block on its own axis while the dip stays common to all of
  // them -- which is precisely the relationship a jointed mass has. Getting this backwards
  // rotates the dip direction per block and the shared bedding vanishes.
  const dip = randomIn(rng, 0.12, 0.24);
  const blocks = 4 + Math.floor(rng() * 2);
  const strikeStep = size * 0.32;

  const granite = (p, c, dampen) => {
    // Feldspar/biotite mottle, then lichen. Painted from a WHITE sentinel because a tint
    // MULTIPLIES: paint the block granite grey first and the best a lichen tint can ever
    // produce is a darker grey.
    const len = p.length() || 1;
    const up = p.y / len;
    const m = smoothNoise3(p.x * 2.4, p.y * 2.4, p.z * 2.4);
    const base = new THREE.Color(GD_GRANITE[Math.min(GD_GRANITE.length - 1, Math.floor(m * 4))]);
    base.lerp(new THREE.Color(GD_GRANITE[1]), 0.35);
    // Lichen is a CRUST -- patchy, hard-edged and only where the light is. Smeared evenly
    // over the whole rock it stops being lichen and becomes a paint job.
    const patch = smoothNoise3(p.x * 0.9 + 7, p.y * 0.9, p.z * 0.9 + 3);
    const patch2 = smoothNoise3(p.x * 1.8 + 21, p.y * 1.8, p.z * 1.8 + 11);
    if (up > 0.15 && patch > 0.62) {
      base.lerp(new THREE.Color(GD_LICHEN_PALE), Math.min(0.72, (patch - 0.62) * 2.6) * (up - 0.15) * 1.6);
    }
    if (patch2 > 0.7) {
      base.lerp(new THREE.Color(GD_LICHEN_RUST), Math.min(0.5, (patch2 - 0.7) * 1.9));
    }
    // Damp and shaded at the foot, where the turf holds water against the stone.
    const k = 1 - dampen * THREE.MathUtils.clamp(0.5 - up, 0, 1);
    return [base.r * c.r * k, base.g * c.g * k, base.b * c.b * k];
  };

  for (let i = 0; i < blocks; i++) {
    const r = size * randomIn(rng, 0.3, 0.48);
    const flat = randomIn(rng, 0.66, 0.84);
    const g = gd_rock(r, seed + i * 13, { flatten: flat, rough: randomIn(rng, 0.16, 0.26) });
    // Sunk 24% of its own height, so the block is bedded rather than balanced.
    const half = r * flat;
    const x = (i - (blocks - 1) / 2) * strikeStep + randomIn(rng, -size * 0.08, size * 0.08);
    const z = randomIn(rng, -size * 0.16, size * 0.16);
    put(parts, g, 0xffffff, [x, half * 0.52 + Math.abs(z) * Math.tan(dip) * 0.5, z],
      [dip + randomIn(rng, -0.05, 0.05), rng() * GD_TWO_PI, randomIn(rng, -0.06, 0.06)],
      { keepColor: true, tint: (p, c) => granite(p, c, 0.22) });
  }

  // Frost-shattered scree at the foot. Each fragment is SUNK to well past its own equator:
  // a pebble sitting fully proud reads as gravel glued on, and its underside is a crescent
  // of daylight the moment the ground is not perfectly flat.
  const scree = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < scree; i++) {
    const a = rng() * GD_TWO_PI;
    const d = size * randomIn(rng, 0.38, 0.66);
    const r = size * randomIn(rng, 0.05, 0.12);
    put(parts, gd_rock(r, seed + 400 + i * 7, { detail: 16, flatten: 0.62, angular: 0.8, facets: 7 }),
      0xffffff, [Math.cos(a) * d, r * 0.18, Math.sin(a) * d],
      [dip + randomIn(rng, -0.2, 0.2), rng() * GD_TWO_PI, randomIn(rng, -0.2, 0.2)],
      { keepColor: true, tint: (p, c) => granite(p, c, 0.34) });
  }

  return group(mesh(mergeParts(parts), standard({
    vertexColors: true, roughness: 0.94, metalness: 0, ...relief('stone', { seed, repeat: 4 }),
  })));
}

// ---------------------------------------------------------------------------
// Ichu grass
// ---------------------------------------------------------------------------

// Tussocky ichu -- the bunch grass of the high Andes, and the stuff the roofs are thatched
// with. `count` is the number of TUSSOCKS, which is what it always meant.
//
// Ichu grows in distinct dense clumps with BARE GROUND BETWEEN THEM, never as a lawn, so
// the tussock centres are rejection-sampled with a minimum separation. An even scatter of
// blades over the disc is the one arrangement this plant never makes.
//
// Each blade is a curved solid ribbon (see gd_ribbon) rather than a cone: a straight cone
// is a spike, and four-sided cones is what this prop was. Each tussock also carries a low
// pale dome of dead straw at its centre, which is both what a real tussock has and what
// closes the joint where every blade leaves the ground.
export function ichuGrass({ radius = 5, count = 18, seed = 43 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  // AN ABSOLUTE GAP, IN FEET, and a relax-and-retry so the sampler cannot under-deliver.
  //
  // At `radius * 0.42` the packing limit was scale-INVARIANT: the number of points that fit
  // at 0.42R separation inside radius R is about the same constant whatever R is, so `count`
  // saturated near 14 and was inert above it. Measured -- the shipped default (radius 5,
  // count 18) built 14 tussocks, and this world's own call (radius 6, count 20) built 13 on
  // one seed and 16 on another. Every ichu patch on the ridge was a third barer than the
  // layout asked for, and a layout author who doubled `count` to fill the gap would have got
  // back the identical 14 clumps with no way to see why.
  //
  // A tussock is about a foot across, so the gap is a foot. And a rejection sampler that
  // backs a PERSISTED option must never quietly return short: if the attempt budget runs out
  // it relaxes and goes again rather than accepting whatever it happened to get.
  const centres = [];
  let minGap = Math.min(1.15, radius * 0.42);
  for (let relax = 0; relax < 6 && centres.length < count; relax++) {
    for (let attempt = 0; attempt < count * 24 && centres.length < count; attempt++) {
      const a = rng() * GD_TWO_PI;
      const d = Math.sqrt(rng()) * radius;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (centres.some((c) => (c[0] - x) ** 2 + (c[1] - z) ** 2 < minGap * minGap)) continue;
      centres.push([x, z]);
    }
    minGap *= 0.8;
  }

  for (let t = 0; t < centres.length; t++) {
    const [cx, cz] = centres[t];
    const scale = randomIn(rng, 0.72, 1.25);
    const blades = 8 + Math.floor(rng() * 5);
    const tussock = gd_tone(GD_ICHU[Math.floor(rng() * GD_ICHU.length)], rng, 0.02, 0.08, 0.05);

    // The dead straw heart. Sunk past its equator so it beds into the turf rather than
    // sitting on it -- a flattened CLOSED sphere, never a partial one, whose rim would be
    // a hole you can see straight through.
    const bh = 0.16 * scale;
    const bg = ball(0.34 * scale, 8);
    bg.scale(1, bh / (0.34 * scale), 1);
    put(parts, bg, gd_tone(0xa6926a, rng, 0.02, 0.06, 0.05), [cx, bh * 0.15, cz]);

    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * GD_TWO_PI + randomIn(rng, -0.28, 0.28);
      const h = randomIn(rng, 1.1, 2.3) * scale;
      const lean = randomIn(rng, 0.35, 0.95) * h;
      const root = 0.1 * scale;
      const p0 = new THREE.Vector3(cx + Math.cos(a) * root, 0.03, cz + Math.sin(a) * root);
      // The control point is high and only a little out; the tip is low and far out. That
      // is what makes an ichu blade ARCH -- it stands up hard and then falls over, and a
      // control point placed halfway between the two gives a lazy banana instead.
      const p1 = new THREE.Vector3(cx + Math.cos(a) * lean * 0.22, h * 0.92, cz + Math.sin(a) * lean * 0.22);
      const p2 = new THREE.Vector3(cx + Math.cos(a) * lean, h * randomIn(rng, 0.45, 0.78), cz + Math.sin(a) * lean);
      const w = randomIn(rng, 0.032, 0.05) * scale;
      const g = gd_ribbon(p0, p1, p2, { width: w, tipWidth: w * 0.36, thick: w * 0.4, spans: 4, curl: 0.5 });
      const c = new THREE.Color(gd_tone(tussock, rng, 0.025, 0.1, 0.08));
      put(parts, g, 0xffffff, null, null, {
        keepColor: true,
        // Bleached toward the tip. Every blade of this stuff is paler where the sun and the
        // frost have been at it, and a flat-coloured tussock reads as astroturf.
        tint: (p) => {
          const k = 1 + THREE.MathUtils.clamp(p.y / Math.max(0.4, h), 0, 1) * 0.24;
          return [Math.min(1, c.r * k), Math.min(1, c.g * k), Math.min(1, c.b * k * 0.97)];
        },
      });
    }
  }

  return group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 1, metalness: 0 })));
}

// ---------------------------------------------------------------------------
// Polylepis (quenua)
// ---------------------------------------------------------------------------

// The highest-growing tree in the world -- Polylepis stands above 16,000ft in the Andes,
// and grows in the cloud forest right below this ridge. Gnarled, low, wind-shaped, with
// small dense grey-green leaves.
//
// THE BARK IS THE WHOLE REASON IT IS HERE. It is bright red-orange and peels in countless
// papery sheets, which insulate the trunk against the night frost; a smooth red cylinder
// would say nothing about it. So the trunk carries about forty separate curved sheets,
// each a solidSurface plate with a real closed rim, curling further from the trunk toward
// its lower free edge -- and the trunk UNDER them is painted a darker red, so anything a
// student sees between two sheets is fresh bark rather than daylight.
//
// Every sheet is placed by asking the limb where its own surface is (span axis + lerped
// radius), never by hand-picked coordinates: near a tapering, kinked trunk a guessed radius
// is either floating clear of the wood or sealed inside it, and the two failures look
// nothing alike.
export function polylepisTree({ height = 13, seed = 53 } = {}) {
  const rng = seededRandom(seed);
  // The authored skeleton reaches 8.7ft, so this is what makes `height` mean the tree's
  // actual height rather than the trunk's -- measured off the built model, not guessed.
  const k = height / 8.7;
  const wood = [];
  const leaves = [];

  const v = (x, y, z) => [x * k, y * k, z * k];

  // A short, twisting, leaning trunk. Polylepis is never straight -- it grows into the wind
  // and around the rock, and a plumb-vertical trunk reads as a young orchard tree.
  const trunk = [
    { p: v(0, 0, 0), r: 0.62 * k },
    { p: v(0.3, 1.4, 0.18), r: 0.5 * k },
    { p: v(0.12, 2.9, 0.6), r: 0.43 * k },
    { p: v(0.62, 4.3, 0.42), r: 0.36 * k },
    { p: v(0.4, 5.5, 0.05), r: 0.3 * k },
  ];
  gd_chain(wood, 0xffffff, trunk, { sides: 12, steps: 5, detail: 10, base: { keepColor: true, tint: gd_barkTint(0.6) } });

  // Limbs. Each one is ROOTED INSIDE the trunk rather than on its surface, which with the
  // socket ball gd_chain() puts at every interior node is what makes a junction impossible
  // to leave open.
  const limbs = [];
  const limbSpecs = [
    { from: 3, dir: [-1, 0.9, -0.55], len: 4.4, tw: 0.9 },
    { from: 4, dir: [0.85, 1.05, 0.7], len: 4.0, tw: 0.85 },
    { from: 4, dir: [-0.35, 1.15, 0.95], len: 3.6, tw: 0.75 },
    { from: 3, dir: [1.0, 0.75, -0.85], len: 3.2, tw: 0.7 },
  ];
  for (let i = 0; i < limbSpecs.length; i++) {
    const s = limbSpecs[i];
    const base = trunk[s.from].p;
    const d = new THREE.Vector3(s.dir[0], s.dir[1], s.dir[2]).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const r0 = trunk[s.from].r * s.tw;
    const nodes = [];
    // Start a third of a radius INSIDE the trunk.
    nodes.push({ p: [base[0] - d.x * r0 * 0.4, base[1] - d.y * r0 * 0.4, base[2] - d.z * r0 * 0.4], r: r0 });
    let cursor = new THREE.Vector3(base[0], base[1], base[2]);
    let dir = d.clone();
    const segs = 3;
    for (let j = 1; j <= segs; j++) {
      const step = (s.len * k) / segs;
      // A kink at every node, alternating side, and each one flattening toward horizontal.
      dir.addScaledVector(side, randomIn(rng, -0.34, 0.34) * (j % 2 ? 1 : -1));
      dir.y -= randomIn(rng, 0.1, 0.26);
      dir.normalize();
      cursor = cursor.clone().addScaledVector(dir, step);
      nodes.push({ p: [cursor.x, cursor.y, cursor.z], r: r0 * (1 - j / (segs + 0.6)) });
    }
    limbs.push(nodes);
    gd_chain(wood, 0xffffff, nodes, {
      sides: 9, steps: 4, detail: 8, base: { keepColor: true, tint: gd_barkTint(0.45) },
    });

    // Twigs, and a puff of foliage at every tip. The puff is centred a little BACK along
    // the twig so the twig's own cap is inside it -- foliage sitting on the end of a stick
    // leaves a visible joint at exactly the height a student is looking.
    const twigs = 2;
    for (let w = 0; w < twigs; w++) {
      const from = nodes[nodes.length - 1 - w];
      const td = dir.clone()
        .addScaledVector(side, randomIn(rng, -0.8, 0.8))
        .add(new THREE.Vector3(0, randomIn(rng, 0.1, 0.5), 0)).normalize();
      const tip = new THREE.Vector3(...from.p).addScaledVector(td, randomIn(rng, 0.9, 1.6) * k);
      gd_chain(wood, 0xffffff, [
        { p: from.p, r: from.r * 0.7 },
        { p: [tip.x, tip.y, tip.z], r: from.r * 0.34 },
      ], { sides: 6, steps: 3, detail: 6, base: { keepColor: true, tint: gd_barkTint(0.3) } });
      gd_foliagePuff(leaves, rng, tip.clone().addScaledVector(td, -0.22 * k), randomIn(rng, 0.85, 1.25) * k);
    }
    gd_foliagePuff(leaves, rng, new THREE.Vector3(...nodes[nodes.length - 1].p), randomIn(rng, 1.0, 1.45) * k);
  }

  // The peeling sheets. Placed per SPAN: gd_chain() sweeps each span through [a, mid, b],
  // which for a collinear midpoint IS the straight segment, so lerping a and b gives the
  // tube's own axis exactly. The sheet's inner radius clears the tube's SAGITTA --
  // r(1 - cos(pi/sides)), 3.4% at 12 sides -- because a patch lifted the 0.004ft that looks
  // generous on paper z-fights into a black checkerboard.
  const sheetRuns = [trunk, ...limbs.slice(0, 2)];
  const peelTones = [0xc4501f, 0xd2703a, 0xb8451c, 0xd8a066, 0x8f3a18];
  for (const run of sheetRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      const a = new THREE.Vector3(...run[i].p);
      const b = new THREE.Vector3(...run[i + 1].p);
      const axis = b.clone().sub(a);
      const spanLen = axis.length();
      axis.normalize();
      let ref = new THREE.Vector3(0, 1, 0);
      if (Math.abs(axis.dot(ref)) > 0.95) ref = new THREE.Vector3(1, 0, 0);
      const u1 = new THREE.Vector3().crossVectors(axis, ref).normalize();
      const u2 = new THREE.Vector3().crossVectors(axis, u1).normalize();
      const sheets = Math.max(3, Math.round(spanLen * 3.2));
      for (let s = 0; s < sheets; s++) {
        const t0 = randomIn(rng, 0.04, 0.9);
        const r = run[i].r + (run[i + 1].r - run[i].r) * t0;
        const hSheet = Math.min(spanLen * (0.92 - t0), randomIn(rng, 0.35, 0.85) * k);
        if (hSheet < 0.12 * k) continue;
        const a0 = rng() * GD_TWO_PI;
        const sweep = randomIn(rng, 1.1, 2.1);
        const peel = randomIn(rng, 0.22, 0.6);
        const clear = 1 + (1 - Math.cos(Math.PI / 12)) + 0.02;
        const tone = new THREE.Color(peelTones[Math.floor(rng() * peelTones.length)]);
        const g = solidSurface({
          nu: 5,
          nv: 3,
          point: (u, vv) => {
            const ang = a0 + (u - 0.5) * sweep;
            // v = 0 is the ATTACHED top edge; v = 1 is the free lower edge, which curls out.
            const rad = r * clear + peel * vv * vv * r;
            const along = a.clone().addScaledVector(axis, (t0 * spanLen) + vv * hSheet);
            const p = along
              .addScaledVector(u1, Math.cos(ang) * rad)
              .addScaledVector(u2, Math.sin(ang) * rad);
            return [p.x, p.y, p.z];
          },
          // Thickness goes to zero at the two side edges and the free edge, so solidSurface
          // emits no rim there -- which is what makes it read as PAPER. It keeps thickness
          // at the attached edge, which is buried in the wood anyway.
          thick: (u, vv) => 0.016 * k * (1 - vv * 0.85) * Math.sin(Math.PI * THREE.MathUtils.clamp(u, 0, 1)),
        });
        put(wood, g, 0xffffff, null, null, {
          keepColor: true,
          // Lighter at the curled free edge: a peel is thin enough there to be lit through.
          tint: (p) => {
            const along = p.clone().sub(a).dot(axis);
            const rel = THREE.MathUtils.clamp((along - t0 * spanLen) / Math.max(0.01, hSheet), 0, 1);
            const kk = 0.78 + rel * 0.5;
            return [Math.min(1, tone.r * kk), Math.min(1, tone.g * kk), Math.min(1, tone.b * kk)];
          },
        });
      }
    }
  }

  // Root flare. Five sunk domes at the base, which is what closes the trunk-to-ground
  // junction -- a trunk stopping dead on the turf reads as a post driven in.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * GD_TWO_PI + rng() * 0.5;
    const rr = randomIn(rng, 0.28, 0.45) * k;
    const g = ball(rr, 8);
    g.scale(1.7, 0.6, 1);
    put(wood, g, 0xffffff, [Math.cos(a) * 0.55 * k, rr * 0.18, Math.sin(a) * 0.55 * k],
      [0, a, 0], { keepColor: true, tint: gd_barkTint(0.9) });
  }

  return group(
    mesh(mergeParts(wood), standard({
      vertexColors: true, roughness: 0.86, metalness: 0, ...relief('bark', { seed, repeat: 4 }),
    })),
    mesh(mergeParts(leaves), standard({ vertexColors: true, roughness: 0.92, metalness: 0 })),
  );
}

// The bark UNDER the peel: deep red-brown, darker where it is old and in the hollows. Fed
// to gd_chain() as a `base` tint so every tube and socket in a limb takes it.
function gd_barkTint(dark) {
  const under = new THREE.Color(0x8e3a20);
  const old = new THREE.Color(0x5c2a19);
  return (p) => {
    const n = smoothNoise3(p.x * 2.6, p.y * 1.4, p.z * 2.6);
    const c = under.clone().lerp(old, THREE.MathUtils.clamp(n * dark + 0.1, 0, 1));
    return [c.r, c.g, c.b];
  };
}

// A puff of foliage. Polylepis leaves are tiny compound leaflets, so at ten feet what reads
// is a fine-textured grey-green MASS, not individual leaves -- a roughened oblate ball with
// a per-vertex dapple carries that for a fraction of the triangles leaflets would cost.
//
// The roughening is a function of DIRECTION, so shared corners move identically and the
// shell cannot tear -- the same constraint the rock is built under.
function gd_foliagePuff(list, rng, at, size) {
  const g = ball(size, 12);
  const pos = g.attributes.position;
  const d = new THREE.Vector3();
  const phase = rng() * 20;
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const len = d.length() || 1;
    // NYQUIST. A unit direction scaled by k traces a circle of circumference 2*pi*k lattice
    // cells round the equator; at k = 3.2 that is 20 cycles against the sphere's 12
    // azimuthal samples -- 0.6 samples per cycle, fifteen times past the nine this project
    // requires. It did not produce fine foliage texture, it produced aliasing: adjacent
    // equator radii jumped 0.31ft over a 0.63ft step, a 27-degree surface tilt that is pure
    // noise, and computeVertexNormals then smooth-shaded it into blotches that read as a
    // rendering fault. At 12 segments the highest frequency that carries is 12/(2*pi*9), so
    // this is the LOBE shape only; crown texture comes from having twelve puffs, not from
    // denting each one.
    const n = smoothNoise3(d.x / len * 0.42 + phase, d.y / len * 0.42, d.z / len * 0.42);
    const r = size * (0.82 + n * 0.36);
    pos.setXYZ(i, (d.x / len) * r, (d.y / len) * r * 0.72, (d.z / len) * r);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  const base = new THREE.Color(gd_tone(0x6d7a4e, rng, 0.03, 0.1, 0.08));
  put(list, g, 0xffffff, [at.x, at.y, at.z], null, {
    keepColor: true,
    tint: (p) => {
      const n = smoothNoise3(p.x * 4.5 + phase, p.y * 4.5, p.z * 4.5);
      const kk = 0.8 + n * 0.42;
      return [base.r * kk, base.g * kk, base.b * kk * 0.95];
    },
  });
}

// ---------------------------------------------------------------------------
// Andean flowers
// ---------------------------------------------------------------------------

// A low clump of the flowers that actually grow on this site: red-orange Bomarea bells,
// scarlet Salvia, purple lupins and the small yellow-orange orchids Machu Picchu is famous
// for -- there are over four hundred orchid species on the sanctuary.
//
// Built as ONE clump in TWO meshes, exactly as ParkProps' flower bed is: a stems mesh
// carrying stalks, leaves and the tubular flowers, and a heads mesh carrying the face
// flowers, painted with a near-white veined canvas MULTIPLIED by a per-bloom vertex colour.
// Size and colour are rolled TOGETHER -- rolled independently the clump comes out as big
// blooms on stubby stems next to pinheads on tall ones, which reads as broken rather than
// as varied.
export function andeanFlowers({ radius = 4, count = 34, seed = 67, palette } = {}) {
  const rng = seededRandom(seed);
  const stems = [];
  const heads = [];
  const star5 = gd_starHead({ points: 5, notch: 0.6 });
  const star6 = gd_starHead({ points: 6, notch: 0.66, dish: 0.18 });

  // Weighted so no one species dominates: orchids are the smallest and the most numerous,
  // lupins the tallest and the fewest, which is how the site actually looks.
  const kinds = ['orchid', 'orchid', 'salvia', 'bomarea', 'lupin', 'orchid', 'salvia'];
  const tones = palette || {
    orchid: [0xe8a021, 0xd9761c, 0xe6bb35],
    salvia: [0xc32a1c, 0xd2401f],
    bomarea: [0xd8541f, 0xe07a2a],
    lupin: [0x6d55b0, 0x8a63c4, 0x4f4a9c],
  };
  const leafGreen = 0x53703c;

  for (let i = 0; i < count; i++) {
    const a = rng() * GD_TWO_PI;
    const d = Math.sqrt(rng()) * radius;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const vigour = rng();
    const green = gd_tone(leafGreen, rng, 0.03, 0.08, 0.08);

    // Two basal leaves on every plant. A clump of bare sticks with blooms on top reads as
    // cut flowers pushed into the ground.
    for (let l = 0; l < 2; l++) {
      const la = a + randomIn(rng, -2.2, 2.2);
      const ll = randomIn(rng, 0.5, 0.95);
      put(stems, gd_ribbon(
        new THREE.Vector3(x, 0.02, z),
        new THREE.Vector3(x + Math.cos(la) * ll * 0.4, ll * 0.62, z + Math.sin(la) * ll * 0.4),
        new THREE.Vector3(x + Math.cos(la) * ll, ll * 0.2, z + Math.sin(la) * ll),
        { width: 0.075, tipWidth: 0.03, thick: 0.02, spans: 3, curl: 0.6 },
      ), green);
    }

    if (kind === 'lupin') {
      // A dense vertical raceme. The individual pea flowers are what a lupin IS -- a smooth
      // purple spike is a foxglove.
      const h = 1.4 + vigour * 1.1;
      const tip = new THREE.Vector3(x + randomIn(rng, -0.1, 0.1), h, z + randomIn(rng, -0.1, 0.1));
      gd_stem(stems, green, [
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, h * 0.55, z),
        tip,
      ], [0.038, 0.03, 0.022], { sides: 5, steps: 4 });
      const hue = gd_tone(tones.lupin[Math.floor(rng() * tones.lupin.length)], rng, 0.03, 0.1, 0.09);
      const whorls = 7 + Math.floor(vigour * 4);
      for (let w = 0; w < whorls; w++) {
        const t = w / whorls;
        const y = h * (0.42 + t * 0.56);
        const wa = w * 2.399963229728653;
        const rr = 0.16 * (1 - t * 0.45);
        const g = ball(0.085 * (1 - t * 0.35), 6);
        g.scale(1, 0.8, 1.35);
        put(stems, g, gd_tone(hue, rng, 0.015, 0.06, 0.06),
          [x + Math.cos(wa) * rr, y, z + Math.sin(wa) * rr], [0, -wa, 0.4]);
      }
    } else if (kind === 'salvia') {
      // Scarlet tubular flowers up an arching spike, each one a small ellipsoid with a
      // flared face. The TUBE is the identification: Andean salvias are hummingbird
      // flowers, and the length of that tube is the reason.
      const h = 1.2 + vigour * 0.9;
      const lean = randomIn(rng, 0.15, 0.5);
      const tip = new THREE.Vector3(x + Math.cos(a) * lean, h, z + Math.sin(a) * lean);
      gd_stem(stems, green, [
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x + Math.cos(a) * lean * 0.3, h * 0.6, z + Math.sin(a) * lean * 0.3),
        tip,
      ], [0.034, 0.028, 0.02], { sides: 5, steps: 4 });
      const hue = gd_tone(tones.salvia[Math.floor(rng() * tones.salvia.length)], rng, 0.02, 0.08, 0.07);
      const florets = 4 + Math.floor(vigour * 3);
      for (let f = 0; f < florets; f++) {
        const t = f / florets;
        const y = h * (0.5 + t * 0.48);
        const fa = a + Math.PI + f * 1.9;
        const px = x + Math.cos(a) * lean * (0.3 + t * 0.7) + Math.cos(fa) * 0.13;
        const pz = z + Math.sin(a) * lean * (0.3 + t * 0.7) + Math.sin(fa) * 0.13;
        const g = ball(0.055, 6);
        g.scale(1, 1, 2.6);
        put(stems, g, hue, [px, y, pz], [0.5, -fa, 0]);
        const hs = 0.075;
        put(heads, star5, gd_tone(hue, rng, 0.02, 0.08, 0.08),
          [px + Math.cos(fa) * 0.12, y - 0.03, pz + Math.sin(fa) * 0.12],
          [-Math.PI / 2 + 1.1, -fa, 0], { scale: [hs, hs, hs] });
      }
    } else if (kind === 'bomarea') {
      // An umbel of PENDANT bells on an arching stem -- Bomarea is a climbing lily and its
      // flowers always hang. Built upright they read as tulips, which is a different plant
      // on a different continent.
      const h = 1.5 + vigour * 0.9;
      const lean = randomIn(rng, 0.35, 0.8);
      const crown = new THREE.Vector3(x + Math.cos(a) * lean, h, z + Math.sin(a) * lean);
      gd_stem(stems, green, [
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x + Math.cos(a) * lean * 0.2, h * 0.72, z + Math.sin(a) * lean * 0.2),
        crown,
      ], [0.036, 0.03, 0.024], { sides: 5, steps: 5 });
      const hue = gd_tone(tones.bomarea[Math.floor(rng() * tones.bomarea.length)], rng, 0.025, 0.08, 0.07);
      const bells = 5 + Math.floor(vigour * 3);
      for (let b = 0; b < bells; b++) {
        const ba = (b / bells) * GD_TWO_PI + rng() * 0.4;
        const rr = randomIn(rng, 0.14, 0.26);
        const drop = randomIn(rng, 0.16, 0.3);
        const bx = crown.x + Math.cos(ba) * rr;
        const bz = crown.z + Math.sin(ba) * rr;
        // Pedicel, so the bell hangs from something rather than floating under the crown.
        gd_stem(stems, green, [
          new THREE.Vector3(crown.x, crown.y, crown.z),
          new THREE.Vector3((crown.x + bx) / 2, crown.y - drop * 0.35, (crown.z + bz) / 2),
          new THREE.Vector3(bx, crown.y - drop, bz),
        ], [0.016, 0.014, 0.012], { sides: 4, steps: 3, root: false });
        const g = ball(0.085, 8);
        g.scale(1, 1.7, 1);
        put(stems, g, gd_tone(hue, rng, 0.02, 0.07, 0.06), [bx, crown.y - drop - 0.13, bz], [0.25, ba, 0]);
        // The flared, green-tipped mouth, facing DOWN.
        const hs = 0.1;
        put(heads, star6, gd_tone(0xbcae4a, rng, 0.03, 0.1, 0.08),
          [bx, crown.y - drop - 0.26, bz], [Math.PI / 2, ba, 0], { scale: [hs, hs, hs] });
      }
    } else {
      // Orchid: a short spike carrying one to three small face flowers. Kept SMALL --
      // scaled up to compete with the lupins these stop being orchids and become daisies.
      const h = 0.55 + vigour * 0.7;
      const tip = new THREE.Vector3(x + randomIn(rng, -0.12, 0.12), h, z + randomIn(rng, -0.12, 0.12));
      gd_stem(stems, green, [
        new THREE.Vector3(x, 0, z),
        new THREE.Vector3(x, h * 0.6, z),
        tip,
      ], [0.028, 0.022, 0.016], { sides: 5, steps: 3 });
      const hue = gd_tone(tones.orchid[Math.floor(rng() * tones.orchid.length)], rng, 0.03, 0.1, 0.08);
      const blooms = 1 + Math.floor(rng() * 3);
      for (let b = 0; b < blooms; b++) {
        const ba = rng() * GD_TWO_PI;
        const rr = b === 0 ? 0 : randomIn(rng, 0.08, 0.16);
        const hs = (0.13 + vigour * 0.07) * randomIn(rng, 0.85, 1.15);
        put(heads, star6, gd_tone(hue, rng, 0.02, 0.08, 0.08),
          [tip.x + Math.cos(ba) * rr, h - b * 0.1, tip.z + Math.sin(ba) * rr],
          [-Math.PI / 2 + randomIn(rng, 0.25, 0.8), ba, 0], { scale: [hs, hs, hs] });
        // The lip -- the one part of an orchid everybody can name. A closed flattened ball
        // sunk into the face, never a partial sphere, whose rim would be a hole.
        const lip = ball(hs * 0.42, 6);
        lip.scale(1, 0.45, 1);
        put(stems, lip, gd_tone(0x8c3f16, rng, 0.02, 0.08, 0.07),
          [tip.x + Math.cos(ba) * rr, h - b * 0.1 + hs * 0.1, tip.z + Math.sin(ba) * rr]);
      }
    }
  }

  return group(
    mesh(mergeParts(stems), standard({ vertexColors: true, roughness: 0.85, metalness: 0 })),
    mesh(mergeParts(heads), standard({
      map: gd_bloomTexture(seed),
      vertexColors: true,
      // DoubleSide because half the blooms in a clump are tilted away from wherever the
      // student is standing, and a one-sided petal seen from behind is a hole.
      side: THREE.DoubleSide,
      roughness: 0.7,
      metalness: 0,
    })),
  );
}

// ---------------------------------------------------------------------------
// Terrace crops
// ---------------------------------------------------------------------------

// Rows of what the andenes actually grew. The terraces were an agricultural laboratory --
// the Inca bred thousands of potato varieties and moved crops up and down the mountain by
// microclimate -- so a terrace with nothing growing on it is a wall, not a farm.
//
// Placed ON a terrace tread, so it is a flat rectangular patch with its origin at its base
// centre, and everything is one merged mesh: this is scenery that gets repeated.
export function terraceCrop({ kind = 'maize', width = 12, depth = 5, seed = 71 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];
  const potato = kind === 'potato';

  // Worked soil, and RIDGED. Inca hoeing left the same ridges any hand-worked field has,
  // and a flat brown slab reads as a doormat. Each ridge is a closed cylinder sunk to past
  // its axis in the slab, so there is no seam where one meets the other.
  const rows = potato ? 3 : Math.max(2, Math.round(depth / 1.9));
  const rowZ = [];
  for (let r = 0; r < rows; r++) rowZ.push(-depth / 2 + (depth / rows) * (r + 0.5));
  put(parts, new THREE.BoxGeometry(width, 0.22, depth), 0x5b4630, [0, 0.11, 0], null, {
    keepColor: true,
    tint: (p) => {
      const n = smoothNoise3(p.x * 1.4, p.y, p.z * 1.4);
      const k = 0.78 + n * 0.5;
      return [0.36 * k, 0.28 * k, 0.19 * k];
    },
  });
  for (const z of rowZ) {
    const ridge = new THREE.CylinderGeometry(0.34, 0.34, width * 0.98, 8, 1);
    ridge.rotateZ(Math.PI / 2);
    put(parts, ridge, 0x6a5238, [0, 0.34, z]);
  }

  const green = potato ? 0x3f6b34 : 0x5c7a34;
  for (let r = 0; r < rows; r++) {
    const z0 = rowZ[r];
    const spacing = potato ? 1.55 : 1.7;
    const plants = Math.max(2, Math.floor((width - 0.9) / spacing));
    for (let i = 0; i < plants; i++) {
      const x = -((plants - 1) / 2) * spacing + i * spacing + randomIn(rng, -0.16, 0.16);
      const z = z0 + randomIn(rng, -0.2, 0.2);
      if (potato) gd_potatoPlant(parts, rng, x, z, green);
      else gd_maizePlant(parts, rng, x, z, green);
    }
  }

  return group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.9, metalness: 0 })));
}

// Maize: one stalk, arching leaves alternating up it, a tassel, and an ear in a husk. The
// LEAVES are the identification -- a bare stalk with a tuft on top is a reed.
function gd_maizePlant(parts, rng, x, z, green) {
  const h = randomIn(rng, 5.2, 7.0);
  const lean = randomIn(rng, 0.1, 0.45);
  const la = rng() * GD_TWO_PI;
  const top = new THREE.Vector3(x + Math.cos(la) * lean, h, z + Math.sin(la) * lean);
  const stalk = gd_tone(green, rng, 0.02, 0.08, 0.07);
  gd_stem(parts, stalk, [
    new THREE.Vector3(x, 0.2, z),
    new THREE.Vector3(x + Math.cos(la) * lean * 0.35, h * 0.55, z + Math.sin(la) * lean * 0.35),
    top,
  ], [0.11, 0.085, 0.05], { sides: 6, steps: 5 });

  const leaves = 6;
  for (let i = 0; i < leaves; i++) {
    const t = 0.2 + (i / leaves) * 0.68;
    // Alternate sides: maize leaves are strictly two-ranked, and a random scatter round the
    // stalk is the loudest way to make it look like a generic plant instead.
    const a = la + (i % 2 ? 0 : Math.PI) + randomIn(rng, -0.35, 0.35);
    const y = 0.2 + h * t;
    const reach = randomIn(rng, 1.5, 2.5);
    const base = new THREE.Vector3(x + Math.cos(la) * lean * t, y, z + Math.sin(la) * lean * t);
    put(parts, gd_ribbon(
      base,
      new THREE.Vector3(base.x + Math.cos(a) * reach * 0.45, y + randomIn(rng, 0.5, 0.95), base.z + Math.sin(a) * reach * 0.45),
      new THREE.Vector3(base.x + Math.cos(a) * reach, y - randomIn(rng, 0.4, 1.1), base.z + Math.sin(a) * reach),
      { width: 0.17, tipWidth: 0.055, thick: 0.028, spans: 4, curl: 0.8 },
    ), gd_tone(green, rng, 0.02, 0.08, 0.1));
  }

  // The tassel: five thin spikes splaying from the top. Pale straw, not green -- a tasselled
  // plant is a plant in flower, and it is the one part of maize that changes colour.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * GD_TWO_PI + rng();
    const reach = randomIn(rng, 0.35, 0.7);
    put(parts, gd_ribbon(
      top,
      new THREE.Vector3(top.x + Math.cos(a) * reach * 0.3, top.y + 0.55, top.z + Math.sin(a) * reach * 0.3),
      new THREE.Vector3(top.x + Math.cos(a) * reach, top.y + randomIn(rng, 0.55, 0.95), top.z + Math.sin(a) * reach),
      { width: 0.035, tipWidth: 0.014, thick: 0.02, spans: 3 },
    ), gd_tone(0xbba469, rng, 0.02, 0.08, 0.08));
  }

  // One ear, husked, at half height with its silk showing.
  const ea = la + Math.PI / 2 + randomIn(rng, -0.6, 0.6);
  const ey = 0.2 + h * 0.45;
  const ex = x + Math.cos(la) * lean * 0.45 + Math.cos(ea) * 0.16;
  const ez = z + Math.sin(la) * lean * 0.45 + Math.sin(ea) * 0.16;
  const ear = ball(0.16, 8);
  ear.scale(1, 2.6, 1);
  put(parts, ear, gd_tone(0x9fae5c, rng, 0.02, 0.06, 0.06), [ex, ey, ez], [0.45, -ea, 0]);
  put(parts, gd_ribbon(
    new THREE.Vector3(ex, ey + 0.38, ez),
    new THREE.Vector3(ex + Math.cos(ea) * 0.1, ey + 0.6, ez + Math.sin(ea) * 0.1),
    new THREE.Vector3(ex + Math.cos(ea) * 0.22, ey + 0.72, ez + Math.sin(ea) * 0.22),
    { width: 0.05, tipWidth: 0.02, thick: 0.02, spans: 2 },
  ), gd_tone(0xc99a54, rng, 0.02, 0.08, 0.08));
}

// Potato: low and bushy, with the broad compound leaflets and the white-to-purple flowers.
// Height is the whole difference from maize -- both are green, and a potato that stands up
// is a tomato plant.
function gd_potatoPlant(parts, rng, x, z, green) {
  const h = randomIn(rng, 0.85, 1.35);
  const stems = 3;
  for (let s = 0; s < stems; s++) {
    const sa = (s / stems) * GD_TWO_PI + rng() * 0.8;
    const out = randomIn(rng, 0.18, 0.4);
    const tip = new THREE.Vector3(x + Math.cos(sa) * out, 0.22 + h, z + Math.sin(sa) * out);
    gd_stem(parts, gd_tone(green, rng, 0.02, 0.06, 0.06), [
      new THREE.Vector3(x, 0.2, z),
      new THREE.Vector3(x + Math.cos(sa) * out * 0.4, 0.22 + h * 0.6, z + Math.sin(sa) * out * 0.4),
      tip,
    ], [0.045, 0.035, 0.025], { sides: 5, steps: 3 });

    // Leaflets in pairs up the stem, held nearly flat -- a potato leaf is a horizontal
    // plate, which is why a field of them reads as solid green from above.
    for (let l = 0; l < 2; l++) {
      const t = 0.4 + l * 0.34;
      const y = 0.22 + h * t;
      for (const side of [-1, 1]) {
        const a = sa + side * (1.1 + randomIn(rng, -0.3, 0.3));
        const reach = randomIn(rng, 0.32, 0.52);
        const bx = x + Math.cos(sa) * out * t;
        const bz = z + Math.sin(sa) * out * t;
        put(parts, gd_ribbon(
          new THREE.Vector3(bx, y, bz),
          new THREE.Vector3(bx + Math.cos(a) * reach * 0.5, y + 0.1, bz + Math.sin(a) * reach * 0.5),
          new THREE.Vector3(bx + Math.cos(a) * reach, y - 0.03, bz + Math.sin(a) * reach),
          { width: 0.14, tipWidth: 0.05, thick: 0.022, spans: 2, curl: 0.5 },
        ), gd_tone(green, rng, 0.02, 0.07, 0.11));
      }
    }

    if (s === 0) {
      // The flower head: a small cluster of five-pointed stars with a yellow centre cone,
      // white through to violet. This is the colour the crop rows contribute.
      const petal = rng() < 0.5 ? 0xe8e3ee : 0x9b7ec6;
      for (let f = 0; f < 3; f++) {
        const fa = rng() * GD_TWO_PI;
        const rr = randomIn(rng, 0.04, 0.13);
        const fs = randomIn(rng, 0.11, 0.16);
        // A CLOSED five-lobed corolla, not a flat disc. This mesh is FrontSide -- the
        // flower clump has its own DoubleSide material and this one does not -- so a
        // zero-thickness petal card would simply vanish from half the angles a student
        // walks the rows from.
        put(parts, gd_lobedDisc(fs, 5, 0.3, 0.26), gd_tone(petal, rng, 0.02, 0.05, 0.05),
          [tip.x + Math.cos(fa) * rr, tip.y + 0.05, tip.z + Math.sin(fa) * rr],
          [randomIn(rng, -0.35, 0.35), fa, randomIn(rng, -0.3, 0.3)]);
        const eye = ball(fs * 0.28, 6);
        eye.scale(1, 1.5, 1);
        put(parts, eye, 0xd8c24a, [tip.x + Math.cos(fa) * rr, tip.y + 0.08, tip.z + Math.sin(fa) * rr]);
      }
    }
  }
}
