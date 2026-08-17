import * as THREE from 'three';
import {
  standard,
  mesh,
  box,
  cyl,
  group,
  mergeColored,
  mergedMesh,
  canvasTexture,
  wrapText,
  signPanel,
  taperedTube,
  seededRandom,
  randomIn,
  relief,
} from '../PropKit.js';

// "Fantastic Voyage" -- a walk-through human-anatomy exhibition, built at exhibition
// scale rather than life size. A real liver is the size of a football; at that size a
// student cannot walk around it, read it, or see what it is joined to. Every organ here
// is enlarged roughly fifteen to twenty times, and each placard states the REAL size, so
// the enlargement teaches rather than misleads.
//
// The split the world is organised around:
//   * The primary organs are real 3D models you can walk around.
//   * Whole SYSTEMS are diagrams (anatomyChart), because a system is a set of
//     relationships and a labelled drawing shows relationships far better than geometry
//     does. Nothing here can show you where the ureters run by being walked around.
//
// THE ONE IDEA THIS FILE IS BUILT ON: every primary organ is HALF WHOLE AND HALF
// SECTIONED. A lung, a kidney, a brain and a stomach each teach two completely different
// things -- what the outside looks like, and what is inside it -- and an anatomy hall
// shows you both. Building it that way also removed almost all of this world's
// transparency, which used to be the highest in the app: the first pass made organs
// see-through so their interiors would show, and a see-through organ is a glass bulb
// with sticks in it. A cut face shows more, costs less and is what a real specimen is.
//
// House rules from PropKit.js apply: feet at scale 1, origin at base centre, fresh
// materials per call, seededRandom rather than Math.random.

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------

// Anatomical models are POLYCHROME, and the first pass here was not: nearly everything
// was one of four warm red-browns, so a liver, a kidney and a heart read as the same
// object three times. Real specimen colour is a code a student can learn -- scarlet is
// oxygenated, indigo is not, yellow is nerve, green is bile, blue-white is cartilage --
// and using the whole of it is what makes a hall of warm tissue legible.
const TISSUE = {
  // Respiratory
  lung: 0xdb8f94,
  lungCut: 0xc0737c,
  lungDeep: 0x9c5560,
  cartilage: 0xd5e2ec,
  airway: 0xe9dcbc,
  airwayDeep: 0xcbb98e,

  // Circulatory
  arterial: 0xc9382c,
  arterialHi: 0xe0574a,
  venous: 0x3a5da4,
  venousHi: 0x5479c4,
  myocardium: 0xa8362f,
  myocardiumR: 0x3f5c9b,
  endocard: 0xe8c4b8,

  // Digestive
  gastric: 0xd98d76,
  serosa: 0xe7cbb6,
  mucosa: 0xc05f56,
  mucosaHi: 0xdb8478,
  liver: 0x8f4335,
  liverHi: 0xa85847,
  liverLo: 0x5e2a20,
  bile: 0x6f9c48,
  bileHi: 0x8fbb62,
  gut: 0xd6907a,
  colon: 0xc98d66,
  colonBand: 0xe4c9a2,
  fat: 0xefd88c,

  // Urinary
  kidney: 0x9f4a3a,
  kidneyHi: 0xbb6151,
  cortex: 0xc26a58,
  medulla: 0x8e3a2f,
  pelvis: 0xe6d6ae,
  urine: 0xe2d49a,
  adrenal: 0xe3c878,

  // Nervous
  cortexPink: 0xd7a79d,
  cortexDeep: 0xa87a76,
  whiteMatter: 0xf3ead6,
  cerebellum: 0xc08a82,
  nerve: 0xe8d38c,
  myelin: 0xf6efdc,

  // Structural
  bone: 0xe8dfc8,
  boneShadow: 0xc3b696,
  steel: 0x39424c,
  chrome: 0x8e99a4,
};

// One accent hue per body SYSTEM, used on that system's plinth ring, name plate, placard
// rule and chart header. The first pass painted all of them the same teal, so twenty
// exhibits looked like twenty copies of one exhibit; a hue per system means a student can
// see from across the hall that the kidney and the bladder chart belong together.
const SYSTEM = {
  respiratory: '#57c4e5',
  circulatory: '#ff5f6d',
  digestive: '#f4a83a',
  urinary: '#3fc09b',
  nervous: '#a78bfa',
  skeletal: '#d8cba6',
  cellular: '#e879b8',
  voyage: '#5fc9dd',
};

// Short names for the handful of tissues that come up in nearly every builder. Everything
// else reads TISSUE directly, so there is one source of truth for a colour and no chance
// of two spellings of "artery" drifting apart.
const ARTERY = TISSUE.arterial;
const VEIN = TISSUE.venous;
const BONE = TISSUE.bone;
const STEEL = TISSUE.steel;
const NERVE_CREAM = TISSUE.nerve;
const GUT_PINK = TISSUE.gut;
const AIRWAY = TISSUE.airway;
const MUSCLE = TISSUE.myocardium;

const CHART_INK = '#3c3730';
const CHART_PAPER = '#f6f1e4';
const CHART_TEAL = '#2f5d6b';

// ---------------------------------------------------------------------------
// The soft-tissue kit
//
// Anatomy is lobed masses and branching tubes, and almost nothing else. The first pass
// built the masses as ellipsoids with isotropic noise on them and the tubes as sweeps
// that stopped in mid air, which is why a liver read as two brown eggs and why the
// hepatic artery showed a hole straight through itself. Four helpers replace all of
// that, and between them they make "leave no open spaces" STRUCTURAL rather than
// remembered -- none of them has a path that emits an open ring or an unmatched edge.
// ---------------------------------------------------------------------------

// Catmull-Rom through scalars, indexed by station. t is in [0,1] across the whole list.
function splineAt(values, t) {
  const n = values.length;
  if (n === 1) return values[0];
  const span = (n - 1) * Math.min(1, Math.max(0, t));
  const i = Math.min(n - 2, Math.floor(span));
  const f = span - i;
  const p0 = values[Math.max(0, i - 1)];
  const p1 = values[i];
  const p2 = values[i + 1];
  const p3 = values[Math.min(n - 1, i + 2)];
  const f2 = f * f;
  const f3 = f2 * f;
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

// One span of a closed Catmull-Rom, on scalars.
function crSpan(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}

// Resample a closed 2D outline to `out` points, evenly in PARAMETER rather than in arc
// length. Parameter-uniform on purpose: it keeps control point i at exactly u = i/n, so a
// feature authored against a control point (a lung's anterior border, a heart's sulcus)
// lands where it was authored no matter how the neighbouring radii are tuned.
function resampleClosed(pts, out) {
  const n = pts.length;
  const res = new Array(out);
  for (let s = 0; s < out; s++) {
    const t = (s / out) * n;
    const i = Math.floor(t);
    const f = t - i;
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i % n];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    res[s] = [crSpan(p0[0], p1[0], p2[0], p3[0], f), crSpan(p0[1], p1[1], p2[1], p3[1], f)];
  }
  return res;
}

// Parallel-transport frames along a curve.
//
// NOT Frenet: a Frenet frame spins unpredictably on a near-straight run and flips right
// through an inflection, and an organ axis is full of both -- a stomach's J and a colon's
// frame are nothing but inflections. Parallel transport carries one frame smoothly along
// the whole path, which is what lets a section keep its authored orientation from one end
// of an organ to the other.
function transportFrames(curve, samples, up = new THREE.Vector3(0, 1, 0)) {
  const points = [];
  const tangents = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    points.push(curve.getPoint(t));
    tangents.push(curve.getTangent(t).normalize());
  }
  const normals = [];
  const binormals = [];
  let normal = new THREE.Vector3().crossVectors(tangents[0], up);
  if (normal.lengthSq() < 1e-6) normal = new THREE.Vector3().crossVectors(tangents[0], new THREE.Vector3(1, 0, 0));
  normal.normalize();
  for (let i = 0; i <= samples; i++) {
    if (i > 0) {
      const axis = new THREE.Vector3().crossVectors(tangents[i - 1], tangents[i]);
      if (axis.lengthSq() > 1e-10) {
        axis.normalize();
        const angle = Math.acos(Math.min(1, Math.max(-1, tangents[i - 1].dot(tangents[i]))));
        normal.applyAxisAngle(axis, angle);
      }
      normal.addScaledVector(tangents[i], -normal.dot(tangents[i])).normalize();
    }
    normals.push(normal.clone());
    binormals.push(new THREE.Vector3().crossVectors(tangents[i], normal).normalize());
  }
  return { points, tangents, normals, binormals };
}

// A wrapped grid's duplicated SEAM column has to have its normals welded, or
// computeVertexNormals treats the two copies as unrelated surfaces and creases the
// geometry exactly where it should be smoothest -- a hard line straight up the flank of
// every organ in the hall.
function weldSeam(geometry, ring, rows) {
  const normal = geometry.attributes.normal;
  for (let r = 0; r < rows; r++) {
    const a = r * (ring + 1);
    const b = a + ring;
    const nx = normal.getX(a) + normal.getX(b);
    const ny = normal.getY(a) + normal.getY(b);
    const nz = normal.getZ(a) + normal.getZ(b);
    const len = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(a, nx / len, ny / len, nz / len);
    normal.setXYZ(b, nx / len, ny / len, nz / len);
  }
  normal.needsUpdate = true;
}

// THE ORGAN LOFT -- a closed solid whose cross-section changes SHAPE, not merely scale,
// along a curving axis.
//
// This is the helper the whole file turns on, and the reason is that an organ's identity
// lives in its section. A lung is domed laterally and flat against the mediastinum; a
// liver is a dome on top of a flat plate with a knife-sharp lower border; a kidney's
// section is nearly round but its AXIS is a bean. taperedTube sweeps a circle and
// SphereGeometry scales an ellipsoid, so with either of those the only thing that can
// change along the length is the size -- which is exactly why the first pass came out as
// a hall of eggs.
//
// Stations are { at: [x,y,z], pts: [[u,v], ...] } with the SAME number of control points
// at every station; each point's u,v is splined along the axis and each ring is then
// resampled by a closed Catmull-Rom. Both ends are fan-capped, so the solid is closed by
// construction -- there is no code path here that leaves a hole.
//
//   capRise  offsets a cap's centre vertex ALONG the axis: negative dishes the end in,
//            which is what a lung's diaphragmatic base and a heart's atrial roof need.
//            A flat cap on a curved organ reads as a slice, and a hemisphere reads as a
//            bubble; almost every real organ end is somewhere between the two.
//   warp     is where fissures, sulci, rugae, haustra and hila come from. It is called
//            with the section coordinates and the world point and returns an inward
//            displacement in feet. A groove produced this way is a MODULATION OF THE
//            SURFACE and therefore cannot open a gap -- which is the whole reason the
//            lobes of these lungs touch and the first pass's did not.
function organLoft(stations, {
  sides = 30,
  samples = 44,
  capStart = true,
  capEnd = true,
  capRise = [0, 0],
  warp = null,
  up = new THREE.Vector3(0, 1, 0),
} = {}) {
  const count = stations[0].pts.length;
  const curve = new THREE.CatmullRomCurve3(stations.map((s) => new THREE.Vector3(...s.at)));
  const frames = transportFrames(curve, samples, up);

  // Spline every control point's u and v along the axis.
  const us = [];
  const vs = [];
  for (let k = 0; k < count; k++) {
    us.push(stations.map((s) => s.pts[k][0]));
    vs.push(stations.map((s) => s.pts[k][1]));
  }

  const position = [];
  const uv = [];
  const rows = samples + 1;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const ring = [];
    for (let k = 0; k < count; k++) ring.push([splineAt(us[k], t), splineAt(vs[k], t)]);
    const outline = resampleClosed(ring, sides);
    const P = frames.points[i];
    const N = frames.normals[i];
    const B = frames.binormals[i];

    for (let s = 0; s <= sides; s++) {
      const idx = s % sides;
      let [u, v] = outline[idx];
      if (warp) {
        const len = Math.hypot(u, v) || 1;
        const p = new THREE.Vector3()
          .copy(P)
          .addScaledVector(N, u)
          .addScaledVector(B, v);
        const d = warp(idx / sides, t, p, u, v);
        if (d) {
          u -= (u / len) * d;
          v -= (v / len) * d;
        }
      }
      position.push(P.x + N.x * u + B.x * v, P.y + N.y * u + B.y * v, P.z + N.z * u + B.z * v);
      uv.push(s / sides, t);
    }
  }

  const index = [];
  for (let i = 0; i < samples; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * (sides + 1) + s;
      const b = a + sides + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  // Fan caps. The centre vertex rides `capRise` along the axis, so an end can be dished,
  // flat or domed without any extra geometry.
  const capAt = (row, sign, rise) => {
    const P = frames.points[row];
    const T = frames.tangents[row];
    const base = position.length / 3;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let s = 0; s < sides; s++) {
      const o = (row * (sides + 1) + s) * 3;
      cx += position[o];
      cy += position[o + 1];
      cz += position[o + 2];
    }
    position.push(cx / sides + T.x * rise * sign, cy / sides + T.y * rise * sign, cz / sides + T.z * rise * sign);
    uv.push(0.5, sign > 0 ? 1 : 0);
    void P;
    for (let s = 0; s < sides; s++) {
      const a = row * (sides + 1) + s;
      const b = row * (sides + 1) + ((s + 1) % sides);
      if (sign > 0) index.push(a, b, base);
      else index.push(b, a, base);
    }
  };
  if (capStart) capAt(0, -1, capRise[0]);
  if (capEnd) capAt(samples, 1, capRise[1]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  weldSeam(geometry, sides, rows);
  return geometry;
}

// A closed SHELL over part of a loft's section -- an outer surface, an inner surface
// offset inward by `wall`, and rim strips joining the two down both cut edges and around
// both ends.
//
// This is what a sectioned hollow organ is: a stomach opened down its front, an artery
// you walk through, a cell with a wedge taken out. The point of building it as a shell
// rather than as a one-sided surface is that a zero-thickness wall shows its own zero
// edge -- the cut mouth of the first artery tunnel was a paper rim, and no material
// setting fixes that. A wall with real thickness has an annulus at the cut, which is
// where the three layers of an artery can actually be seen.
//
// It is also why nothing in this file needs DoubleSide: a closed shell is closed from
// both sides already.
function shellLoft(stations, {
  sides = 30,
  samples = 44,
  wall = 0.3,
  u0 = 0,
  u1 = 1,
  warp = null,
  innerWarp = null,
  up = new THREE.Vector3(0, 1, 0),
} = {}) {
  const count = stations[0].pts.length;
  const curve = new THREE.CatmullRomCurve3(stations.map((s) => new THREE.Vector3(...s.at)));
  const frames = transportFrames(curve, samples, up);
  const us = [];
  const vs = [];
  for (let k = 0; k < count; k++) {
    us.push(stations.map((s) => s.pts[k][0]));
    vs.push(stations.map((s) => s.pts[k][1]));
  }

  const span = u1 - u0;
  const cols = sides;
  const position = [];
  const uv = [];
  const index = [];

  const layer = (inset, warpFn) => {
    const base = position.length / 3;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const ring = [];
      for (let k = 0; k < count; k++) ring.push([splineAt(us[k], t), splineAt(vs[k], t)]);
      const outline = resampleClosed(ring, Math.max(64, sides * 3));
      const P = frames.points[i];
      const N = frames.normals[i];
      const B = frames.binormals[i];
      for (let s = 0; s <= cols; s++) {
        const uu = u0 + (s / cols) * span;
        const idx = Math.round(((uu % 1) + 1) % 1 * outline.length) % outline.length;
        let [u, v] = outline[idx];
        const len = Math.hypot(u, v) || 1;
        if (warpFn) {
          const p = new THREE.Vector3().copy(P).addScaledVector(N, u).addScaledVector(B, v);
          const d = warpFn(uu, t, p, u, v);
          if (d) {
            u -= (u / len) * d;
            v -= (v / len) * d;
          }
        }
        const scale = Math.max(0.02, len - inset) / len;
        position.push(P.x + N.x * u * scale + B.x * v * scale, P.y + N.y * u * scale + B.y * v * scale, P.z + N.z * u * scale + B.z * v * scale);
        uv.push(s / cols, t);
      }
    }
    return base;
  };

  const outer = layer(0, warp);
  const inner = layer(wall, innerWarp || warp);
  const stride = cols + 1;

  // The wall's OUTSIDE, its two cut rims and its two end annuli all belong to one
  // material -- serosa, or muscle -- and the inside belongs to another: mucosa, or
  // endothelium. So the two layers come back as separate geometries rather than one.
  // Returning a single mesh would force a hollow organ to be one flat colour inside and
  // out, which is the opposite of what a sectioned specimen is for; a stomach's whole
  // point is that the pale muscle outside and the folded red lining inside are different
  // tissues.
  const wallIndex = [];
  for (let i = 0; i < samples; i++) {
    for (let s = 0; s < cols; s++) {
      const a = outer + i * stride + s;
      const b = a + stride;
      wallIndex.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // The two cut rims wind OPPOSITE ways, and so do the two end annuli. Each of these four
  // strips faces a different direction -- out of one cut edge, out of the other, back down
  // the axis, forward up it -- so a single winding rule cannot serve all of them. Getting
  // one wrong does not make it invisible, which is what makes this easy to miss: a strip
  // with inverted normals is still drawn, just lit from behind, so it renders as a hard
  // BLACK BAND along the cut. That is what a sectioned stomach's rim looked like.
  for (let i = 0; i < samples; i++) {
    const oa = outer + i * stride;
    const ob = oa + stride;
    const ia = inner + i * stride;
    const ib = ia + stride;
    wallIndex.push(oa, ob, ia, ia, ob, ib);
    const oc = outer + i * stride + cols;
    const od = oc + stride;
    const ic = inner + i * stride + cols;
    const id = ic + stride;
    wallIndex.push(oc, od, ic, ic, od, id);
  }
  for (let s = 0; s < cols; s++) {
    const oa = outer + s;
    const ia = inner + s;
    wallIndex.push(oa, ia, oa + 1, ia, ia + 1, oa + 1);
    const ob = outer + samples * stride + s;
    const ib = inner + samples * stride + s;
    wallIndex.push(ob, ob + 1, ib, ob + 1, ib + 1, ib);
  }
  for (let i = 0; i < samples; i++) {
    for (let s = 0; s < cols; s++) {
      const c = inner + i * stride + s;
      const d = c + stride;
      index.push(c, c + 1, d, c + 1, d + 1, d);
    }
  }

  const build = (idx) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    return geometry;
  };
  return { outer: build(wallIndex), inner: build(index) };
}

// A vessel: ONE smooth sweep through all its nodes, capped at both free ends.
//
// One sweep and not a tube per span, which is the opposite of what an animal's limb
// wants. A limb bends at a joint and the socket ball is what closes the wedge; a blood
// vessel is a continuous smooth curve, so a single Catmull-Rom sweep has no interior
// joins to close at all. The only gaps a vessel can have are at its two ends, and those
// are what `cap` handles.
//
// A tube that stops at a real thickness gets a ball. One tapering to 0 must NOT have one
// -- radius 0 closes the end already and a ball there is a bead on a needle. That is the
// same rule the dinosaurs' tails and the reef's fronds follow.
function vessel(list, color, nodes, { capStart = true, capEnd = true, sides = 12, along = 24, detail = 12 } = {}) {
  const points = nodes.map((n) => [n[0], n[1], n[2]]);
  const radii = nodes.map((n) => n[3]);
  list.push({
    geometry: taperedTube(points, radii, { tubularSegments: along, radialSegments: sides }),
    color,
  });
  const cap = (node) => {
    if (node[3] <= 0.001) return;
    list.push({
      geometry: new THREE.SphereGeometry(node[3], detail, Math.max(6, detail >> 1)),
      position: [node[0], node[1], node[2]],
      color,
    });
  };
  if (capStart) cap(nodes[0]);
  if (capEnd) cap(nodes[nodes.length - 1]);
}

// A branching tree of vessels: the bronchial tree, the coronaries, the portal triad, a
// neuron's dendrites, a capillary bed.
//
// The socket at a bifurcation is sized from the BEND, not from the fattest nearby radius.
// Both tubes already carry that node's radius there, so the ball only has to cover the
// flats' inset (cos(pi/sides)) plus the wedge the two end planes leave on the OUTSIDE of
// the bend, which is 1/cos(phi/2). Sized from neighbouring radii instead, every branch
// point grows a bead and a bronchial tree reads as a string of pearls -- the same mistake
// the first pass of the dinosaurs' limbs made.
function vesselTree(list, color, root, { sides = 12, along = 20, detail = 12, capLeaves = true } = {}) {
  const walk = (node, parentDir, parentR) => {
    const kids = node.kids || [];
    // A one-node chain is a bare junction point -- a root that only exists to hang kids
    // off. It has no length to sweep, and handing a single point to taperedTube builds a
    // Catmull-Rom with nothing to interpolate.
    if (node.chain && node.chain.length > 1) {
      vessel(list, node.color || color, node.chain, {
        capStart: false,
        capEnd: capLeaves && !kids.length,
        sides,
        along,
        detail,
      });
    }
    if (kids.length) {
      const here = node.chain ? node.chain[node.chain.length - 1] : node.at;
      // Sized from the radii meeting AT THIS NODE, never from an ancestor's. A trachea is
      // twice the width of a lobar bronchus four generations down, and carrying its radius
      // into every socket below it puts a bead on every twig.
      const r = Math.max(...kids.map((k) => k.chain[0][3]), here[3] || 0);
      const dirs = kids.map((k) => {
        const a = k.chain[0];
        const b = k.chain[1] || k.chain[0];
        return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      });
      // The turn at this node is the widest angle between any two tubes meeting here. The
      // parent ARRIVES, so its direction is reversed before being compared -- measuring
      // against the incoming direction instead makes an upper-lobe bronchus (which really
      // does leave almost backwards) read as a 140 degree turn, and the wedge factor for
      // that is nearly 3. That is how the first pass grew a two-foot khaki ball over each
      // lung: the socket has to cover two tube ENDS, not the reflex angle between them.
      const all = parentDir ? [new THREE.Vector3().copy(parentDir).negate(), ...dirs] : dirs;
      let turn = 0;
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          turn = Math.max(turn, Math.acos(Math.min(1, Math.max(-1, all[i].dot(all[j])))));
        }
      }
      // Clamped hard on purpose. Past about 45 degrees of turn the honest fix is a gentler
      // branch, not a bigger ball -- a socket allowed to grow without limit is a bead, and
      // a tree of beads reads as a string of pearls.
      const wedge = Math.min(1.45, 1 / Math.cos(Math.min(Math.PI / 2.4, turn) / 2));
      const socket = (r / Math.cos(Math.PI / sides)) * wedge;
      list.push({
        geometry: new THREE.SphereGeometry(socket, detail + 2, Math.max(7, (detail + 2) >> 1)),
        position: [here[0], here[1], here[2]],
        color: node.color || color,
      });
      const myDir = node.chain && node.chain.length > 1
        ? new THREE.Vector3(
            node.chain[node.chain.length - 1][0] - node.chain[node.chain.length - 2][0],
            node.chain[node.chain.length - 1][1] - node.chain[node.chain.length - 2][1],
            node.chain[node.chain.length - 1][2] - node.chain[node.chain.length - 2][2]
          ).normalize()
        : parentDir;
      for (const k of kids) walk(k, myDir, here[3]);
    }
  };
  walk(root, null, 0);
}

// A ball, for closing an end or seating a junction by hand.
function knot(list, color, at, radius, detail = 12) {
  list.push({
    geometry: new THREE.SphereGeometry(radius, detail, Math.max(6, detail >> 1)),
    position: at,
    color,
  });
}

// A blister sitting on whatever it grows out of -- a papilla, a bouton, an alveolus, an
// adrenal gland, the pons, a fat tag on a colon.
//
// It is a CLOSED sphere flattened along its own axis, never a partial one, and that is the
// whole point. A partial sphere is an open shell: its rim is a hole, its inside is back
// faces, and with FrontSide those are culled -- so the moment the rim is not completely
// buried in the host you can see straight through the blister. That only works when the
// blister is smaller than the thing it sits on, and half the time here it is not: the pons
// is fatter than the brainstem it bulges from and an adrenal gland is wider than the pole of
// the kidney it caps. Both rendered as pale wedges with holes in them.
//
// A closed sphere cannot do that. `sink` now flattens it instead of cutting it: 0 is a full
// ball and 2 is a shallow lens, and the caller buries as much of it as they like by placing
// it. Either way there is no rim to leak.
function blister(list, color, { at, radius, rot = [0, 0, 0], detail = 10, sink = 0.4 }) {
  const geometry = new THREE.SphereGeometry(radius, detail + 2, Math.max(6, detail >> 1));
  geometry.scale(1, Math.max(0.18, 1 - sink * 0.42), 1);
  list.push({ geometry, position: at, rotation: rot, color });
}

// Multiply a merged geometry's vertex colours by a function of world position.
//
// mergeColored gives each part ONE flat colour, so without this an organ's tone can only
// change where one solid stops and the next begins -- which is why the first pass's
// countershading and its lobe boundaries were always separate objects with a visible
// seam between them. Shading the merged colour attribute instead gives a liver a paler
// margin, a heart a red left side and a blue right one across a single mass, and a lung a
// darker hilum, all with no extra geometry and no seam anywhere.
//
// A colour MAP is the obvious alternative and the wrong one here: `map` x `vertexColors`
// multiplies, and every part in an organ has its own UV scale, so no single repeat is
// right for a 12ft lobe and a 2in vessel at the same time.
function tint(geometry, fn) {
  const position = geometry.attributes.position;
  const color = geometry.attributes.color;
  if (!color) return geometry;
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    c.fromBufferAttribute(color, i);
    const m = fn(p, c);
    if (m) color.setXYZ(i, c.r * m[0], c.g * m[1], c.b * m[2]);
  }
  color.needsUpdate = true;
  return geometry;
}

// Smooth 3D value noise, for tissue mottle and for the gyri of a brain. Cheap, tileable
// enough at these scales, and -- unlike Math.random -- identical on every rebuild, which
// is the rule every prop in this project follows.
function noise3(x, y, z) {
  const s = Math.sin(x * 1.7 + y * 0.9 - z * 1.3) * 0.5
    + Math.sin(y * 2.3 - z * 1.1 + x * 0.6) * 0.3
    + Math.sin(z * 1.9 + x * 1.2 - y * 0.7) * 0.2;
  return s;
}

// Merge a part list and hand back a geometry ready to be tinted.
//
// It does NOT re-weld or recompute normals, and that is the whole point. Every part that
// reaches here already carries correct smooth normals -- organLoft computes and seam-welds
// its own, and three.js's spheres and cylinders ship with theirs -- and mergeColored
// carries the normal attribute straight through. Running mergeVertices + recompute over
// the merged result instead does two kinds of damage: it throws away the seam weld that
// stops a hard line running up the flank of every organ, and where a cut face has left
// zero-area triangles it computes garbage normals from them and smears those across the
// neighbours. A whole lung came out looking like creased fabric that way.
//
// It is also 300ms per organ cheaper, which at eighteen exhibits is the difference
// between a world that loads and one a student waits for.
function organMesh(parts, { tint: tintFn = null, material = {} } = {}) {
  const geometry = mergeColored(parts);
  if (tintFn) tint(geometry, tintFn);
  const m = mesh(geometry, standard({ vertexColors: true, roughness: 0.62, ...material }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}


// ---------------------------------------------------------------------------
// Small shared helpers carried over
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

function tube(points, radii, color, options) {
  return { geometry: taperedTube(points, radii, options), color };
}

function ellipsoid(radius, [sx, sy, sz], detail = 20) {
  const geometry = new THREE.SphereGeometry(radius, detail, Math.max(8, detail >> 1));
  geometry.scale(sx, sy, sz);
  return geometry;
}

// A rounded stump closing the open end of a swept tube.
//
// taperedTube() does not cap its ends -- it is a sleeve, and a sleeve that stops in mid
// air shows the hole straight through it. That is what made every great vessel on the
// heart look broken: the aorta's branches, both venae cavae and the pulmonary arteries
// all end where the model ends, and each one was a flat ring with nothing behind it.
// A sphere of the tube's own end radius closes it and reads as a cut vessel, which is
// exactly what an anatomical specimen has.
//
// Tubes that end INSIDE another mass do not need this -- and neither do tails, fronds or
// dendrites, which taper to a genuine point by ending at radius 0.
function capEnd(parts, position, radius, color, detail = 14) {
  parts.push({
    geometry: new THREE.SphereGeometry(radius, detail, Math.max(8, detail >> 1)),
    position,
    color,
  });
}

// A specimen stand: a weighted base plate and a rod up to `top`. Every organ model here
// is a shape that would not stand up on its own, exactly as a real museum specimen is.
function standParts(parts, { top, x = 0, z = 0, rod = 0.18, plate = 1.5, color = STEEL }) {
  parts.push({
    geometry: new THREE.CylinderGeometry(plate, plate * 1.12, 0.22, 22),
    position: [x, 0.11, z],
    color,
  });
  parts.push({
    geometry: new THREE.CylinderGeometry(rod, rod * 1.25, top, 12),
    position: [x, top / 2 + 0.2, z],
    color,
  });
}

// A ring sitting square across a curve at parameter t -- sphincters, cartilage rings,
// the muscle bands of a vessel. A TorusGeometry already lies in XY with its axis on +Z,
// so aligning +Z to the curve's tangent is the whole job. The rotation is baked into the
// geometry with a matrix because mergeColored() only carries Euler rotations, and this
// one is not expressible as an axis-aligned Euler triple.
function ringOnCurve(curve, t, radius, thickness, color, segments = 22) {
  const point = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const geometry = new THREE.TorusGeometry(radius, thickness, 8, segments);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quaternion));
  geometry.translate(point.x, point.y, point.z);
  return { geometry, color };
}

function curveThrough(points) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
}

// ---------------------------------------------------------------------------
// Display plinth
// ---------------------------------------------------------------------------

function plinthLabelTexture(label, sublabel, accent) {
  return canvasTexture(768, 192, (ctx, w, h) => {
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, '#1b242c');
    wash.addColorStop(1, '#0e151b');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.strokeRect(12, 12, w - 24, h - 24);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f4efe4';
    ctx.font = 'bold 74px Georgia, "Times New Roman", serif';
    ctx.fillText(String(label).toUpperCase(), w / 2, sublabel ? 92 : 118);

    if (sublabel) {
      ctx.fillStyle = accent;
      ctx.font = '34px "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(sublabel, w / 2, 146);
    }
  });
}

// The drum every organ model stands on. The name plate is a flat panel on the front and
// back rather than a texture wrapped round the drum: a texture on a cylinder's side is
// mirrored or stretched depending on which way you walk round it, and a name that reads
// backwards from one side of an exhibit is worse than no name at all.
//
// `accent` is that exhibit's SYSTEM colour, and it does three jobs at once -- the lit
// ring, the plate rule and the plate's subtitle. It is the cheapest legibility in the
// world: from the far end of the hall the only thing a student can resolve is a coloured
// ring, and a violet one means nervous system before a single word is readable.
export function organPlinth({ height = 3, radius = 3.6, label = '', sublabel = '', accent = SYSTEM.voyage } = {}) {
  const g = group();
  const stone = standard({ color: 0x2b343d, roughness: 0.7, metalness: 0.15, ...relief('stone', { seed: 3, repeat: 5, strength: 0.22 }) });
  const cap = standard({ color: 0x3d4956, roughness: 0.5, metalness: 0.35 });

  g.add(cyl(radius * 1.1, radius * 1.16, 0.3, cap, 0, 0.15, 0, 44));
  g.add(cyl(radius, radius * 1.04, height - 0.6, stone, 0, height / 2, 0, 44));
  g.add(cyl(radius * 1.08, radius * 1.02, 0.3, cap, 0, height - 0.15, 0, 44));

  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.03, 0.09, 8, 48),
    standard({ color: 0xdff6fb, emissive: new THREE.Color(accent), emissiveIntensity: 2.2, roughness: 0.4 })
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = height - 0.42;
  g.add(glow);

  if (label) {
    const texture = plinthLabelTexture(label, sublabel, accent);
    for (const facing of [0, Math.PI]) {
      const plate = signPanel(radius * 1.5, radius * 0.375, texture);
      plate.position.set(Math.sin(facing) * (radius * 1.02), height * 0.55, Math.cos(facing) * (radius * 1.02));
      plate.rotation.y = facing;
      g.add(plate);
    }
  }

  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 1 -- the lungs
// ---------------------------------------------------------------------------

// A lung's section, authored anatomically: +x lateral, +z anterior. organLoft's section
// plane for a vertical axis with up = +Z spans (x, -z), so `sec` is the one place that
// conversion lives and every outline below reads as a plan view of a real lung.
const sec = (x, z) => [x, -z];

// Domed laterally, flattened against the mediastinum, with a sharp anterior border and a
// thick rounded posterior one lying in the costovertebral groove. That asymmetry is the
// single reason these read as lungs and the first pass's ellipsoids did not: an ellipse
// has no medial surface, no anterior border and nowhere for a hilum to be.
function lungOutline() {
  return [
    sec(1.00, 0.00),
    sec(0.90, 0.55),
    sec(0.55, 0.88),
    sec(0.10, 0.99),
    sec(-0.30, 0.88),
    sec(-0.50, 0.46),
    sec(-0.56, 0.00),
    sec(-0.50, -0.46),
    sec(-0.30, -0.86),
    sec(0.20, -0.97),
    sec(0.70, -0.74),
    sec(0.95, -0.37),
  ];
}

// Widest at the base, tapering to a rounded apex -- a lung is a cone, and the taper is
// half of what makes the silhouette right.
const LUNG_PROFILE = [
  [0.00, 0.99, 0.97],
  [0.13, 1.00, 1.00],
  [0.30, 0.95, 0.97],
  [0.47, 0.85, 0.90],
  [0.63, 0.72, 0.79],
  [0.77, 0.57, 0.65],
  [0.88, 0.41, 0.48],
  [0.96, 0.24, 0.29],
  [1.00, 0.10, 0.13],
];

function lungStations(height, halfW, halfD, { mirror = 1, cutV = null } = {}) {
  const outline = lungOutline();
  return LUNG_PROFILE.map(([f, sx, sz]) => {
    let pts = outline.map(([u, v]) => [u * halfW * sx * mirror, v * halfD * sz]);
    if (cutV !== null) pts = cutOutline(pts, cutV);
    return { at: [0, height * f, 0], pts };
  });
}

// The lungs: one whole and one SECTIONED, which is the arrangement this whole file is
// built on. The right lung carries its two fissures and its three lobes; the left is cut
// in the coronal plane so a student walks up to the bronchial tree standing inside an
// open lung rather than squinting at it through two layers of pink haze.
//
// The first pass made all five lobes translucent for that reason, and translucency was
// the wrong tool twice over: it cost five of this world's transparent draws, and a
// see-through lobe loses most of its apparent colour, so the lungs read as glass bulbs.
// A cut face is opaque, cheaper, and is what a real specimen looks like.
export function lungsModel({ height = 16 } = {}) {
  const g = group();
  const H = height * 0.68;
  const halfW = height * 0.20;
  const halfD = height * 0.17;
  const baseY = height * 0.14;
  const midX = height * 0.075;

  // --- Fissures -----------------------------------------------------------
  // A fissure is a GROOVE IN ONE SURFACE, not a gap between two solids, and that is the
  // whole reason these lobes touch. The first pass built five separate ellipsoids and
  // spaced them apart, so the right lung had daylight between its upper and middle lobes
  // from every angle. Cut as a warp it is impossible for the surface to come apart.
  const oblique = (p, originY, sign) => {
    // Runs posterosuperior to anteroinferior. Normal lies in the y-z plane.
    const ny = 0.74;
    const nz = 0.67;
    return (p.y - originY) * ny + p.z * nz * sign;
  };
  const groove = (d, halfWidth, depth) => {
    const a = Math.abs(d) / halfWidth;
    return a >= 1 ? 0 : depth * (1 - a * a) * (1 - a * a);
  };

  // A fissure is a SLIT, and what a student sees of one is a line. Narrow and shallow
  // beats wide and deep at this scale twice over: a 1ft-deep trough on a 6ft lung cuts a
  // hard V wherever it crosses the silhouette, and a groove narrower than the ring spacing
  // cannot be resolved at all. These are about a third of a foot deep over two thirds of a
  // foot wide, which reads as a fissure from ten feet and never breaks the outline.
  const FISS_W = H * 0.05;
  const FISS_D = halfW * 0.17;

  const rightWarp = (u, t, p) => {
    let d = 0;
    // Oblique fissure -- present all the way round, dividing lower from upper and middle.
    d += groove(oblique(p, baseY + H * 0.52, 1), FISS_W, FISS_D);
    // Horizontal fissure -- anterior and lateral only, fading out where it meets the
    // oblique. One that runs all the way round would cut the lung in half.
    if (p.z > -halfD * 0.15 && p.y < baseY + H * 0.66) {
      const fade = Math.min(1, (p.z + halfD * 0.15) / (halfD * 0.5));
      d += groove(p.y - (baseY + H * 0.40), FISS_W * 0.85, FISS_D * fade);
    }
    // Hilum: a real concavity on the medial face, so the bronchus and the vessels enter
    // INTO something instead of butting against a smooth wall.
    const medial = Math.min(1, Math.max(0, (p.x + midX) / (halfW * 0.55)));
    if (medial > 0) {
      const dy = (p.y - (baseY + H * 0.50)) / (H * 0.16);
      const dz = p.z / (halfD * 0.42);
      const r2 = dy * dy + dz * dz;
      if (r2 < 1) d += halfW * 0.34 * (1 - r2) * medial;
    }
    return d;
  };

  const parts = [];

  // --- Right lung: whole, three lobes -------------------------------------
  const rightStations = lungStations(H, halfW, halfD, { mirror: -1 }).map((s) => ({
    at: [-midX + s.at[0], baseY + s.at[1], s.at[2]],
    pts: s.pts,
  }));
  const right = organLoft(rightStations, {
    sides: 62,
    samples: 54,
    // Dished at the base, because a lung sits ON the dome of the diaphragm. A flat cap
    // reads as a slice and a domed one reads as a balloon; a real lung base is neither.
    capRise: [-halfD * 0.55, halfD * 0.22],
    warp: rightWarp,
    up: new THREE.Vector3(0, 0, 1),
  });
  parts.push({ geometry: right, color: TISSUE.lung });

  // --- Left lung: cut in the coronal plane --------------------------------
  // The cut is made in the SECTIONS themselves rather than by clipping a finished solid:
  // every control point with z forward of the cut plane is pulled back onto it, so the
  // loft closes over a flat face and the result is a genuine closed solid. Clipping would
  // have left an open shell needing DoubleSide, which is the trap the cell nucleus fell
  // into -- looking into an opening means looking at back faces.
  // The plane sits ANTERIOR of the axis, not on it. A cut through the middle of a tapering
  // organ removes almost the whole of its narrow end -- at the apex, where the lung is only
  // eight inches deep, a central cut leaves a knife edge, and the exhibit ends in a blade.
  // Forward of centre it only bites where the lung is deep enough to have an inside, so the
  // apex stays whole and the cut face narrows into it the way a real section does.
  const cutZ = halfD * 0.16;
  const leftStations = lungStations(H, halfW, halfD, { mirror: 1, cutV: -cutZ }).map((s) => ({
    at: [midX + s.at[0], baseY + s.at[1], s.at[2]],
    pts: s.pts,
  }));
  const leftWarp = (u, t, p) => {
    let d = groove(oblique(p, baseY + H * 0.50, 1), FISS_W, FISS_D);
    // Cardiac notch: the bite out of the left lung's anterior border where the heart
    // sits. It is the one asymmetry that says at a glance which lung is which.
    const medial = Math.min(1, Math.max(0, (midX - p.x) / (halfW * 0.6)));
    if (medial > 0 && p.z > -halfD * 0.4) {
      const dy = (p.y - (baseY + H * 0.34)) / (H * 0.20);
      if (Math.abs(dy) < 1) d += halfW * 0.30 * (1 - dy * dy) * medial;
    }
    return d;
  };
  const left = organLoft(leftStations, {
    sides: 62,
    samples: 54,
    capRise: [-halfD * 0.55, halfD * 0.22],
    warp: leftWarp,
    up: new THREE.Vector3(0, 0, 1),
  });
  parts.push({ geometry: left, color: TISSUE.lung });

  // --- Airway -------------------------------------------------------------
  // Cartilage rings are a CORRUGATION OF THE TRACHEA, not hoops around it. Built as
  // separate toruses they read as a spring balanced on a wishbone, and every one of them
  // was a ring that had to be sized against a radius it did not own. Corrugating the
  // trachea's own surface cannot be the wrong size and cannot leave a gap.
  const trachTop = baseY + H * 1.30;
  const carina = baseY + H * 0.92;
  const trachR = height * 0.052;
  const rings = 9;
  const trachea = organLoft(
    [
      { at: [0, carina - 0.1, 0], pts: ringPts(trachR * 1.06, 14) },
      { at: [0, (carina + trachTop) / 2, 0], pts: ringPts(trachR * 1.02, 14) },
      { at: [0, trachTop, 0], pts: ringPts(trachR, 14) },
    ],
    {
      sides: 34,
      samples: 62,
      capStart: false,
      capEnd: true,
      capRise: [0, 0],
      warp: (u, t) => {
        // A tracheal ring is C-shaped -- the back of the windpipe is soft muscle, which
        // is what lets a swallowed mouthful bulge into it. Fading the corrugation out
        // across the posterior third is one line and it is a real fact about the shape.
        const back = Math.cos((u - 0.5) * Math.PI * 2);
        const soft = Math.max(0, Math.min(1, (back + 0.35) / 0.7));
        return (Math.sin(t * Math.PI * 2 * rings) * 0.5 + 0.5) * trachR * 0.075 * soft;
      },
      up: new THREE.Vector3(0, 0, 1),
    }
  );
  parts.push({ geometry: trachea, color: TISSUE.airway });

  // Bronchial tree. The right main bronchus is WIDER and STEEPER than the left, which is
  // why an inhaled peanut nearly always ends up in the right lung -- the one fact about
  // this shape worth building the geometry around.
  const lobar = (sign, from, to, r0, r1) => ({
    chain: [
      [from[0], from[1], from[2], r0],
      [(from[0] + to[0]) / 2 + sign * 0.1, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2, (r0 + r1) / 2],
      [to[0], to[1], to[2], r1],
    ],
  });
  const rb = trachR * 0.86;
  const lb = trachR * 0.70;
  const tree = {
    chain: [[0, carina + 0.5, 0, trachR * 1.02], [0, carina, 0, trachR * 1.04]],
    kids: [
      {
        chain: [
          [0, carina, 0, rb],
          [-midX * 0.5, carina - H * 0.10, 0.05, rb * 0.94],
          [-midX * 1.0, carina - H * 0.20, 0.1, rb * 0.86],
        ],
        kids: [
          lobar(-1, [-midX, carina - H * 0.20, 0.1], [-midX * 1.9, carina - H * 0.06, halfD * 0.30], rb * 0.55, rb * 0.30),
          lobar(-1, [-midX, carina - H * 0.20, 0.1], [-midX * 2.0, carina - H * 0.34, halfD * 0.42], rb * 0.48, rb * 0.26),
          lobar(-1, [-midX, carina - H * 0.20, 0.1], [-midX * 1.8, carina - H * 0.58, -halfD * 0.10], rb * 0.55, rb * 0.28),
        ],
      },
      {
        chain: [
          [0, carina, 0, lb],
          [midX * 0.6, carina - H * 0.08, 0.05, lb * 0.94],
          [midX * 1.15, carina - H * 0.16, 0.1, lb * 0.86],
        ],
        kids: [
          lobar(1, [midX * 1.15, carina - H * 0.16, 0.1], [midX * 2.0, carina - H * 0.02, halfD * 0.22], lb * 0.58, lb * 0.30),
          lobar(1, [midX * 1.15, carina - H * 0.16, 0.1], [midX * 1.9, carina - H * 0.46, -halfD * 0.05], lb * 0.58, lb * 0.30),
        ],
      },
    ],
  };
  vesselTree(parts, TISSUE.airwayDeep, tree, { sides: 14, along: 16, detail: 12 });

  // Segmental branches inside the CUT lung, which is the whole reason it is cut open.
  const segRoot = [midX * 1.9, carina - H * 0.46, -halfD * 0.05];
  const segTop = [midX * 2.0, carina - H * 0.02, halfD * 0.22];
  const rng = seededRandom(7);
  for (const [root, spread, n] of [[segRoot, -1, 5], [segTop, 1, 4]]) {
    const kids = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.6;
      const reach = randomIn(rng, 0.5, 0.9) * halfW;
      kids.push({
        chain: [
          [root[0], root[1], root[2], lb * 0.28],
          [root[0] + Math.cos(a) * reach * 0.5 + midX * 0.3, root[1] + spread * reach * 0.35, root[2] + Math.sin(a) * reach * 0.35 - halfD * 0.2, lb * 0.17],
          [root[0] + Math.cos(a) * reach + midX * 0.5, root[1] + spread * reach * 0.7, root[2] + Math.sin(a) * reach * 0.6 - halfD * 0.35, lb * 0.08],
        ],
      });
    }
    vesselTree(parts, TISSUE.airwayDeep, { chain: [[root[0], root[1], root[2], lb * 0.30]], kids }, { sides: 9, along: 12, detail: 9 });
  }

  // --- Pulmonary vessels ---------------------------------------------------
  // The famous reversal, and it is worth the geometry: the pulmonary ARTERY carries
  // blue blood (heading to the lungs to be loaded) and the pulmonary VEINS carry red
  // (coming back loaded). Every other artery in the body is the other way round.
  const pa = [
    [midX * 0.2, carina - H * 0.30, halfD * 0.55, trachR * 0.72],
    [midX * 0.1, carina - H * 0.18, halfD * 0.34, trachR * 0.70],
    [0, carina - H * 0.12, halfD * 0.16, trachR * 0.68],
  ];
  vesselTree(parts, TISSUE.venous, {
    chain: pa,
    kids: [
      { chain: [[0, carina - H * 0.12, halfD * 0.16, trachR * 0.52], [-midX * 1.1, carina - H * 0.16, halfD * 0.28, trachR * 0.40], [-midX * 1.8, carina - H * 0.24, halfD * 0.22, trachR * 0.26]] },
      { chain: [[0, carina - H * 0.12, halfD * 0.16, trachR * 0.50], [midX * 1.1, carina - H * 0.14, halfD * 0.26, trachR * 0.38], [midX * 1.75, carina - H * 0.22, halfD * 0.16, trachR * 0.24]] },
    ],
  }, { sides: 13, along: 16 });

  for (const side of [-1, 1]) {
    for (const lift of [0.30, 0.12]) {
      vessel(parts, TISSUE.arterial, [
        [side * midX * 1.75, carina - H * (0.34 + lift * 0.3), halfD * 0.14, trachR * 0.20],
        [side * midX * 0.8, carina - H * (0.36 + lift * 0.2), halfD * 0.30, trachR * 0.23],
        [side * midX * 0.15, carina - H * (0.40 + lift * 0.1), halfD * 0.42, trachR * 0.26],
      ], { sides: 10, along: 12, capEnd: true, capStart: true });
    }
  }

  const airway = organMesh(parts, {
    tint: (p) => {
      // Cut faces darker and slightly cooler than the pleural surface -- a cut lung shows
      // spongy parenchyma, and painting it the same pink as the polished outside is what
      // makes a section read as a flat sticker rather than as an opening.
      const isCut = Math.abs(p.z - cutZ) < 0.09 && p.x > 0;
      const shade = 0.94 + noise3(p.x * 0.55, p.y * 0.4, p.z * 0.55) * 0.09;
      if (isCut) return [shade * 0.82, shade * 0.72, shade * 0.74];
      const depth = 1 - Math.min(0.16, Math.max(0, (p.y - baseY) / H) * 0.16);
      return [shade * depth, shade * depth * 0.985, shade * depth * 0.99];
    },
    material: { roughness: 0.66, ...relief('hide', { seed: 5, repeat: 7, strength: 0.22 }) },
  });
  g.add(airway);

  // --- Diaphragm ------------------------------------------------------------
  // The muscle that actually does the breathing: it pulls DOWN and the lungs fill. Built
  // as a shallow dome NARROWER than the lungs are wide -- at the obvious "wide enough to
  // sit under everything" radius it came out as a red pancake broader than the organ it
  // belongs to and read as a table the lungs were standing on.
  // Narrower than the lungs are wide, and shallow. At the obvious "wide enough to sit
  // under everything" radius it came out as a red pancake broader than the organ it
  // belongs to, reading as a table the lungs were standing on -- and because a big
  // shallow dome at eye height is seen almost edge on, its unlit underside rendered as a
  // black rim right across the exhibit. Both are fixed by making it smaller than the
  // thing it supports, which is also what a real diaphragm is relative to a rib cage.
  const dia = [];
  const domeR = (midX + halfW) * 0.86;
  const domeStations = [];
  // A MOUND that reaches the ground, not a saucer on a stalk -- and that is a lighting
  // decision, not a modelling one. A wide shallow dome whose crown sits at a 5ft student's
  // eye line is seen almost exactly edge on, so what they actually look at is its
  // UNDERSIDE, which the sun never reaches: the first version rendered as a black smile
  // slung under the exhibit. Running the skirt down to the plinth top means there is no
  // underside to see. The crown reaches baseY, where the lungs' dished bases sit, because
  // daylight between the muscle and the organ it holds up is the loudest possible "these
  // are two separate objects".
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const r = domeR * Math.sqrt(Math.max(0.03, 1 - f * f * 0.97));
    domeStations.push({ at: [0, baseY * f * 1.02, 0], pts: ringPts(r, 16) });
  }
  dia.push({
    geometry: organLoft(domeStations, {
      sides: 44,
      samples: 26,
      capRise: [0, 0.06],
      // Radial muscle fibres, as a corrugation of the dome's own surface. A diaphragm is
      // read almost entirely from the fibres fanning out of its central tendon, and as
      // separate solids that would be sixty of them.
      warp: (u, t) => Math.sin(u * Math.PI * 2 * 24) * domeR * 0.012 * t,
      up: new THREE.Vector3(0, 0, 1),
    }),
    color: TISSUE.myocardium,
  });
  // The central tendon -- the pale sheet the muscle fibres pull against, which is what
  // makes this a muscle rather than a red bowl.
  blister(dia, TISSUE.serosa, { at: [0, baseY * 0.90, -halfD * 0.06], radius: domeR * 0.34, sink: 1.72, detail: 20 });
  g.add(organMesh(dia, {
    tint: (p) => {
      const radial = Math.min(1, Math.hypot(p.x, p.z) / domeR);
      const fibre = 0.96 + Math.sin(Math.atan2(p.z, p.x) * 24) * 0.045 * radial;
      return [fibre, fibre * 0.96, fibre * 0.95];
    },
    material: { roughness: 0.78 },
  }));

  return g;
}

// Cut a section outline off along a straight chord, keeping the half with v >= cutV and
// REDISTRIBUTING the discarded points evenly along the cut line.
//
// The obvious way to do this is to clamp every point past the plane onto it, and that is
// what the first pass did. It produces the right outline and a broken surface: seven of
// twelve control points land on one spot, the closed resample then emits thousands of
// zero-area triangles along the chord, and their normals are garbage. A cut lung came out
// looking like creased fabric. Spreading the same number of points along the chord keeps
// the count identical -- which loft stations require -- with no two of them coincident.
function cutOutline(outline, cutV) {
  const n = outline.length;
  const keep = outline.map((p) => p[1] >= cutV);
  const total = keep.filter(Boolean).length;
  if (total === 0 || total === n) return outline;

  // The kept points are one CYCLICALLY contiguous run, and they have to be collected in
  // that order. Scanning 0..n-1 and pushing every kept point instead looks equivalent and
  // is not: as soon as the run wraps past index 0 the array comes out as [0, 6, 7, ...],
  // the outline crosses itself, and the loft renders as a folded curtain you can see
  // through. Finding the run's real start is the whole fix.
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i] && !keep[(i - 1 + n) % n]) {
      start = i;
      break;
    }
  }
  const kept = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!keep[i]) break;
    kept.push(outline[i]);
  }

  const crossAt = (i, j) => {
    const a = outline[i];
    const b = outline[j];
    const f = (cutV - a[1]) / (b[1] - a[1]);
    return a[0] + (b[0] - a[0]) * f;
  };
  const last = (start + kept.length - 1) % n;
  const xExit = crossAt(last, (last + 1) % n);
  const xEntry = crossAt(start, (start - 1 + n) % n);

  const spare = n - kept.length;
  const flat = [];
  for (let i = 0; i < spare; i++) {
    const f = (i + 1) / (spare + 1);
    flat.push([xExit + (xEntry - xExit) * f, cutV]);
  }
  return [...kept, ...flat];
}

// N points evenly round a circle, as loft control points.
function ringPts(radius, count = 14) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

// An oval outline, for sections that are wider than they are deep.
function ovalPts(halfW, halfH, count = 14) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push([Math.cos(a) * halfW, Math.sin(a) * halfH]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 2 -- the stomach
// ---------------------------------------------------------------------------

// The J-curve is the whole shape, so the stomach is ONE loft along its own curving axis:
// fundus dome at the top, the body ballooning out, the antrum narrowing to the pylorus.
// The first pass swept the body as a tube and then bolted the fundus on as a separate
// sphere, which left a seam across the one part of a stomach everybody recognises.
//
// It is SECTIONED down the front, and that is what replaced the translucency. The rugae --
// the folds that let an empty stomach stretch to four times its size -- are the reason
// this model exists, and the first pass showed them through a 55%-opacity wall, which read
// as a pink balloon with something vague inside it. They are also now MODULATIONS OF THE
// LINING'S OWN SURFACE rather than separate rings laid on it: every one of those rings had
// to be sized against a radius it did not own, and down in the narrowing antrum they came
// out oversized and hung outside the stomach like loose bangles. A fold that IS the
// surface cannot be the wrong size and cannot leave a gap.
export function stomachModel({ height = 13 } = {}) {
  const g = group();
  const S = height / 13;

  // Section coordinates: u lies in the plane of the J, v is the front-to-back depth.
  const oval = (a, b, n = 16) => ovalPts(a, b, n);

  const axis = [
    [-2.3 * S, 12.2 * S, 0],
    [-2.9 * S, 10.5 * S, 0],
    [-2.5 * S, 8.2 * S, 0],
    [-1.2 * S, 6.1 * S, 0],
    [1.1 * S, 4.6 * S, 0],
    [3.3 * S, 5.0 * S, 0],
    [4.7 * S, 6.3 * S, 0],
  ];
  // Fat through the fundus and body, pinching hard at the pylorus. A stomach is flatter
  // front-to-back than it is across, which is what `depth` is doing.
  const width = [2.15, 2.75, 2.90, 2.40, 1.55, 1.05, 0.80].map((r) => r * S);
  const depth = width.map((r) => r * 0.84);

  const stations = axis.map((at, i) => ({ at, pts: oval(width[i], depth[i]) }));

  // Pyloric sphincter: a thickening of the muscle wall, not a ring around it. Built as a
  // ring it was one more bangle; built as a bulge on the outside with a matching
  // constriction on the inside it is what a sphincter actually is -- and it is visibly
  // squeezing the lumen shut, which is the whole teaching point.
  const sphincter = (t, at, halfWidth, amount) => {
    const d = Math.abs(t - at) / halfWidth;
    return d >= 1 ? 0 : amount * (1 - d * d) * (1 - d * d);
  };
  const outerWarp = (u, t) => -sphincter(t, 0.90, 0.07, 0.34 * S) - sphincter(t, 0.135, 0.05, 0.14 * S);
  const innerWarp = (u, t, p, uu, vv) => {
    let d = sphincter(t, 0.90, 0.07, 0.30 * S) + sphincter(t, 0.135, 0.05, 0.16 * S);
    // Longitudinal rugae: a modulation in u only, so the folds run ALONG the stomach the
    // way real ones do. Faded out through the antrum, where a real stomach is smooth.
    const fade = Math.max(0, Math.min(1, (0.80 - t) / 0.22)) * Math.min(1, t / 0.12);
    d -= (Math.sin(uu * 0 + u * Math.PI * 2 * 11) * 0.5 + 0.5) * 0.26 * S * fade;
    void vv;
    return d;
  };

  // u from 0 to 0.5 runs from one edge of the cut, round the back, to the other -- the
  // posterior half. The anterior half is the part taken away.
  const shell = shellLoft(stations, {
    sides: 54,
    samples: 66,
    wall: 0.34 * S,
    u0: 0.0,
    u1: 0.5,
    warp: outerWarp,
    innerWarp,
  });

  const parts = [];
  parts.push({ geometry: shell.outer, color: TISSUE.serosa });
  parts.push({ geometry: shell.inner, color: TISSUE.mucosa });

  // Oesophagus into the cardia, and the duodenum out of the pylorus. Both are rooted a
  // little way INSIDE the wall rather than butted against it, which is the difference
  // between a tube joining an organ and a tube parked next to one.
  vessel(parts, TISSUE.gastric, [
    [-1.9 * S, 15.6 * S, 0, 0.62 * S],
    [-2.1 * S, 14.0 * S, 0, 0.66 * S],
    [-2.5 * S, 12.2 * S, 0, 0.72 * S],
    [-2.7 * S, 11.0 * S, 0, 0.80 * S],
  ], { sides: 16, along: 22, capEnd: false });

  // The duodenum's C, wrapping round the head of the pancreas.
  vessel(parts, TISSUE.gut, [
    [4.6 * S, 6.4 * S, 0, 0.74 * S],
    [5.8 * S, 5.6 * S, 0.3 * S, 0.80 * S],
    [6.3 * S, 3.9 * S, 0.5 * S, 0.82 * S],
    [5.6 * S, 2.6 * S, 0.4 * S, 0.80 * S],
    [4.0 * S, 2.3 * S, 0.1 * S, 0.76 * S],
    [2.9 * S, 3.0 * S, -0.2 * S, 0.70 * S],
  ], { sides: 15, along: 30, capStart: false });

  g.add(organMesh(parts, {
    tint: (p) => {
      const mottle = 0.95 + noise3(p.x * 0.8, p.y * 0.6, p.z * 0.8) * 0.07;
      // The greater curvature carries more vessels than the lesser one, so it is a shade
      // deeper -- a real specimen is never one flat colour and the gradient is free.
      const curve = 1 - Math.max(0, Math.min(0.10, (6.5 * S - p.y) * 0.02));
      return [mottle * curve, mottle * curve * 0.985, mottle * curve * 0.98];
    },
    material: { roughness: 0.58, ...relief('hide', { seed: 11, repeat: 9, strength: 0.2 }) },
  }));

  // Stands go where the organ actually is. The first pass put one under the fundus, which
  // is ten feet up -- so it stood in open air holding nothing, and the stomach appeared to
  // float above a spare post.
  const frame = [];
  standParts(frame, { top: 3.5 * S, x: 1.0 * S, z: -1.6 * S });
  standParts(frame, { top: 2.4 * S, x: 5.2 * S, z: -1.2 * S, plate: 1.2 });
  g.add(mergedMesh(frame, { roughness: 0.45, metalness: 0.6 }));

  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 3 -- the liver
// ---------------------------------------------------------------------------

// Section coordinates for an organ swept along +X with up = +Y: u runs anterior, v runs
// DOWN. `lsec` is the one place that sign lives.
const lsec = (anterior, up) => [anterior, -up];

// A liver is a WEDGE, and the wedge is entirely a property of its section: a smooth dome
// on top, a flat plate underneath, and the two meeting at a knife-sharp anterior border.
// The first pass was two flattened ellipsoids, which have no border at all -- and an
// ellipsoid seen from anywhere a student stands is an egg. The sharp margin is the single
// most recognisable thing about this organ and it cost nothing but authoring the section.
function liverOutline() {
  return [
    lsec(1.00, 0.06),
    lsec(0.80, 0.55),
    lsec(0.45, 0.85),
    lsec(0.00, 0.96),
    lsec(-0.50, 0.83),
    lsec(-0.86, 0.46),
    lsec(-1.00, 0.02),
    lsec(-0.90, -0.28),
    lsec(-0.55, -0.44),
    lsec(0.00, -0.47),
    lsec(0.55, -0.40),
    lsec(0.90, -0.19),
  ];
}

export function liverModel() {
  const g = group();
  const parts = [];
  const halfZ = 3.5;
  const halfY = 2.7;
  // High enough that the gallbladder in its fossa and the three ducts leaving the visceral
  // surface all stay ABOVE y = 0. Every builder here returns a Group whose origin is its
  // base centre, and the first pass put the porta hepatis nearly three feet underground --
  // so on its plinth the ducts vanished into the stone and the exhibit lost the one part
  // that explains what a liver is plumbed into.
  const lift = 5.1;
  const outline = liverOutline();

  const profile = [
    [-4.9, 0.26, 0.20],
    [-4.3, 0.78, 0.76],
    [-3.0, 0.98, 1.00],
    [-1.4, 1.00, 0.96],
    [0.3, 0.90, 0.78],
    [1.9, 0.79, 0.60],
    [3.4, 0.60, 0.42],
    [4.5, 0.28, 0.19],
  ];
  const stations = profile.map(([x, sz, sy]) => ({
    at: [x, lift + (1 - sy) * 0.25, x > 1 ? (x - 1) * 0.09 : 0],
    pts: outline.map(([u, v]) => [u * halfZ * sz, v * halfY * sy]),
  }));

  const groove = (d, halfWidth, depth) => {
    const a = Math.abs(d) / halfWidth;
    return a >= 1 ? 0 : depth * (1 - a * a) * (1 - a * a);
  };

  const liver = organLoft(stations, {
    sides: 60,
    samples: 56,
    capRise: [0.18, 0.14],
    warp: (u, t, p) => {
      let d = 0;
      // Falciform ligament: the deep notch on the TOP surface that divides the big right
      // lobe from the small left one. Gated to the upper half -- run all the way round it
      // would saw the organ in two.
      if (p.y > lift + halfY * 0.1) {
        d += groove(p.x - 0.45, 0.42, halfZ * 0.19) * Math.min(1, (p.y - lift) / (halfY * 0.5));
      }
      // The groove for the inferior vena cava, along the posterior border.
      if (p.z < -halfZ * 0.5) d += groove(p.x + 1.5, 0.7, halfZ * 0.12);
      // Gallbladder fossa: a real dimple in the underside, so the gallbladder sits IN
      // something. A pear resting against a smooth flat plate reads as a pear that has
      // been left there.
      const dy = (p.y - (lift - halfY * 0.55)) / (halfY * 0.5);
      if (dy < 0.6) {
        const dx = (p.x + 2.0) / 1.5;
        const dz = (p.z - halfZ * 0.42) / 1.3;
        const r2 = dx * dx + dz * dz;
        if (r2 < 1) d += halfY * 0.42 * (1 - r2);
      }
      return d;
    },
    up: new THREE.Vector3(0, 1, 0),
  });
  parts.push({ geometry: liver, color: TISSUE.liver });

  // Gallbladder, in its fossa: a pear, not a ball, and MOSTLY HIDDEN. A real gallbladder is
  // buried in the liver's underside with only its rounded fundus projecting past the
  // anterior border, which is the one bit of it anybody ever sees. Built at a radius that
  // looked right on its own it came out as a green ball parked under the organ -- bigger
  // than the fossa holding it and reading as a separate object entirely.
  const gbAxis = [
    [-2.55, lift - halfY * 0.62, halfZ * 0.98],
    [-2.15, lift - halfY * 0.72, halfZ * 0.68],
    [-1.70, lift - halfY * 0.72, halfZ * 0.34],
    [-1.30, lift - halfY * 0.62, halfZ * 0.04],
  ];
  const gbR = [0.52, 0.50, 0.34, 0.17];
  parts.push({
    geometry: organLoft(
      gbAxis.map((at, i) => ({ at, pts: ringPts(gbR[i], 12) })),
      { sides: 24, samples: 20, capRise: [gbR[0] * 0.75, 0], up: new THREE.Vector3(0, 1, 0) }
    ),
    color: TISSUE.bile,
  });

  // The portal triad at the porta hepatis: portal vein (indigo -- blood arriving from the
  // gut), hepatic artery (scarlet -- oxygen), bile duct (green -- bile leaving). Three
  // colours saying three directions of flow, which is most of what this organ does.
  //
  // They are STUMPS, not stilts. A specimen's vessels are cut a few inches from the organ,
  // and the first pass ran them two and a half feet straight down into the plinth, where
  // they read as three coloured legs holding the liver up.
  vessel(parts, TISSUE.venous, [
    [-0.9, lift - halfY * 0.78, -0.2, 0.30],
    [-0.8, lift - halfY * 1.12, 0.35, 0.42],
    [-0.7, lift - halfY * 1.42, 0.85, 0.48],
  ], { sides: 13, along: 12 });
  vessel(parts, TISSUE.arterial, [
    [0.4, lift - halfY * 0.74, -0.45, 0.20],
    [0.5, lift - halfY * 1.06, 0.1, 0.26],
    [0.6, lift - halfY * 1.34, 0.6, 0.30],
  ], { sides: 11, along: 12 });
  vessel(parts, TISSUE.bileHi, [
    [-1.3, lift - halfY * 0.62, 0.04, 0.17],
    [-1.0, lift - halfY * 0.96, 0.4, 0.18],
    [-0.85, lift - halfY * 1.30, 0.8, 0.19],
  ], { sides: 10, along: 12 });

  standParts(parts, { top: lift - halfY * 0.9, x: -3.4, z: -1.7 });
  standParts(parts, { top: lift - halfY * 0.75, x: 3.0, z: -1.5, plate: 1.2 });

  g.add(organMesh(parts, {
    tint: (p) => {
      // The sharp anterior margin is thin enough to be paler than the mass behind it, and
      // the whole surface carries the lobule mottle a real liver has. One flat brown is
      // what made the first pass read as a moulded plastic egg.
      const edge = Math.max(0, 1 - Math.abs(p.z - halfZ * 0.85) / (halfZ * 0.35));
      const mottle = 0.94 + noise3(p.x * 1.5, p.y * 1.3, p.z * 1.5) * 0.085;
      const pale = 1 + edge * 0.14;
      return [mottle * pale, mottle * pale * 0.97, mottle * pale * 0.95];
    },
    material: { roughness: 0.54, ...relief('hide', { seed: 5, repeat: 11, strength: 0.26 }) },
  }));
  return g;
}

// ---------------------------------------------------------------------------
// PRIMARY ORGAN 4 -- the kidneys
// ---------------------------------------------------------------------------

// The whole urinary tract in one exhibit, because a kidney on its own does not explain
// itself: two kidneys, the vessels at each hilum, both ureters running down, and the
// bladder they drain into.
//
// One kidney is WHOLE and the other is SECTIONED, and the sectioned one is the exhibit.
// The single most important fact about a kidney is that it is not a solid lump -- it is a
// pale cortex over a set of dark pyramids that drain into a funnel -- and the first pass,
// two smooth beans, said none of it. A million filters is a claim the model has to back up.
export function kidneyModel({ withBladder = true } = {}) {
  const g = group();
  const parts = [];
  const kidneyY = 7.6;
  const halfLat = 1.55;
  const halfDeep = 1.30;
  const halfTall = 2.75;

  const groove = (d, halfWidth, depth) => {
    const a = Math.abs(d) / halfWidth;
    return a >= 1 ? 0 : depth * (1 - a * a) * (1 - a * a);
  };

  // Fat in the middle, rounded at both poles.
  const beanProfile = [
    [0.00, 0.20],
    [0.10, 0.62],
    [0.26, 0.90],
    [0.50, 1.00],
    [0.74, 0.90],
    [0.90, 0.62],
    [1.00, 0.20],
  ];

  for (const side of [-1, 1]) {
    // The right kidney (body's right, -X) rides lower, pushed down by the liver above it.
    const y = kidneyY + (side < 0 ? -0.75 : 0);
    const x = side * 3.8;
    const sectioned = side > 0;
    const cutZ = halfDeep * 0.22;

    const stations = beanProfile.map(([f, s]) => {
      let pts = ovalPts(halfLat * s, halfDeep * s, 14);
      if (sectioned) pts = cutOutline(pts, -cutZ);
      return { at: [x, y - halfTall + f * halfTall * 2, 0], pts };
    });

    // The hilum: a real notch in the middle of the MEDIAL border, which is the one feature
    // that makes a bean a kidney rather than a potato -- and it is where every vessel and
    // the ureter enter, so building it as a concavity means all four of them arrive inside
    // something instead of butting against a smooth wall.
    const hilum = (u, t, p) => {
      const medial = Math.min(1, Math.max(0, ((x - p.x) * side) / (halfLat * 0.7)));
      const dy = (p.y - y) / (halfTall * 0.34);
      if (Math.abs(dy) >= 1) return 0;
      return halfLat * 0.62 * (1 - dy * dy) * medial;
    };

    parts.push({
      geometry: organLoft(stations, {
        sides: sectioned ? 44 : 46,
        samples: 44,
        capRise: [halfDeep * 0.55, halfDeep * 0.55],
        warp: hilum,
        up: new THREE.Vector3(0, 0, 1),
      }),
      color: sectioned ? TISSUE.cortex : TISSUE.kidney,
    });

    if (sectioned) {
      // On the cut face: the medullary pyramids, their calyces and the renal pelvis. Each
      // pyramid points INWARD toward the hilum, which is the direction urine travels, and
      // they sit a hair proud of the cut plane so they read as structures in a section
      // rather than as paint on a wall.
      // Everything on the cut face is a FLAT PLATE lying in the plane of the section, not a
      // solid poking out of it. The first pass used real cones for the pyramids and real
      // hemispherical cups for the calyces, and a section is the one place where solids are
      // the wrong answer: eight of them stacked up an arc read unmistakably as a spine with
      // vertebrae, and the exhibit looked like a piece of the wrong animal. A section shows
      // CUT surfaces, so a triangle drawn in the plane says "pyramid" and a solid does not.
      const face = cutZ - 0.02;
      const plate = (geometry) => {
        geometry.scale(1, 1, 0.14);
        return geometry;
      };
      // A medullary pyramid is BROAD-BASED and SHORT: its base is the whole thickness of
      // the cortex above it and its blunt apex just reaches the pelvis. Built taller than
      // it is wide -- which is what "pyramid" suggests -- six of them in a row read as a
      // set of shark's teeth biting into the kidney, and nothing about that says medulla.
      for (let i = 0; i < 6; i++) {
        const a = -0.86 + (i / 5) * 1.72;
        const lean = side * (Math.PI / 2 - a * 0.62);
        const cone = plate(new THREE.ConeGeometry(halfTall * 0.235, halfLat * 0.62, 3, 1));
        cone.rotateZ(lean);
        parts.push({
          geometry: cone,
          position: [x + side * (halfLat * 0.40 - Math.cos(a) * halfLat * 0.08), y + Math.sin(a) * halfTall * 0.56, face],
          color: TISSUE.medulla,
        });
      }
      // The renal pelvis: the funnel every pyramid drains into, tapering to the ureter --
      // also a flat plate, for the same reason.
      const funnel = plate(new THREE.ConeGeometry(halfTall * 0.50, halfLat * 0.86, 3, 1));
      funnel.rotateZ(side * -Math.PI / 2);
      parts.push({ geometry: funnel, position: [x - side * halfLat * 0.26, y, face - 0.015], color: TISSUE.pelvis });
    }

    // Renal artery and vein, from the hilum to the great vessels on the midline. They END
    // ON the aorta and the vena cava below rather than stopping in open air: the first pass
    // ran them halfway to the middle and left them there, so the exhibit had four fat
    // coloured bars apparently floating between the two kidneys. A vessel has to come from
    // somewhere, and once it does it is also explaining where the blood is going.
    const hx = x - side * halfLat * 0.42;
    vessel(parts, TISSUE.arterial, [
      [hx + side * 0.3, y + 0.50, -0.1, 0.26],
      [hx - side * 1.5, y + 0.62, 0.12, 0.27],
      [side * 0.55, y + 0.72, 0.2, 0.28],
    ], { sides: 12, along: 16, capStart: false, capEnd: false });
    vessel(parts, TISSUE.venous, [
      [hx + side * 0.3, y - 0.42, 0.22, 0.32],
      [hx - side * 1.5, y - 0.52, 0.42, 0.33],
      [-side * 0.05, y - 0.60, 0.5, 0.34],
    ], { sides: 12, along: 16, capStart: false, capEnd: false });

    // Adrenal gland: the cap that sits ON the kidney and is a completely different organ --
    // it makes adrenaline, and it is not part of the urinary system at all. Small and sunk
    // deep. At the radius that looked right on its own it was three times the width of the
    // pole it sits on, so it read as a beret, and a shallow sink left a crescent of daylight
    // between the two along the whole join.
    blister(parts, TISSUE.adrenal, {
      at: [x - side * 0.18, y + halfTall * 0.86, -0.04],
      radius: halfLat * 0.46,
      rot: [0.25, 0, side * 0.35],
      detail: 14,
      sink: 1.35,
    });

    if (withBladder) {
      vessel(parts, TISSUE.pelvis, [
        [hx - side * 0.15, y - halfTall * 0.42, 0.05, 0.24],
        [x - side * 0.2, y - halfTall * 1.5, 0.2, 0.22],
        [side * 1.5, 3.9, 0.3, 0.21],
        [side * 0.75, 2.7, 0.25, 0.20],
      ], { sides: 10, along: 26, capStart: false, capEnd: false });
    }
  }

  // The abdominal aorta and the inferior vena cava on the midline, which is what the four
  // renal vessels above actually plug into. Two short trunks, and they turn what was a set
  // of floating coloured stubs into a circuit that explains where the blood goes.
  vessel(parts, ARTERY, [
    [0.55, kidneyY + 3.4, 0.2, 0.38],
    [0.55, kidneyY - 0.6, 0.2, 0.42],
    [0.55, kidneyY - 3.8, 0.2, 0.38],
  ], { sides: 14, along: 14 });
  vessel(parts, VEIN, [
    [-0.05, kidneyY + 3.4, 0.5, 0.44],
    [-0.05, kidneyY - 0.6, 0.5, 0.48],
    [-0.05, kidneyY - 3.8, 0.5, 0.44],
  ], { sides: 14, along: 14 });

  if (withBladder) {
    // A bladder is a muscular bag with a neck at the bottom -- so a loft, not a sphere.
    // TALLER THAN IT IS WIDE, with a neck at the bottom. Built to its widest radius over a
    // short axis it came out as a flat yellow saucer -- a lampshade, not a bag -- because a
    // bladder's fullness is mostly vertical: it rises out of the pelvis as it fills.
    const bl = [];
    for (let i = 0; i <= 7; i++) {
      const f = i / 7;
      const r = Math.sin(Math.PI * (0.13 + f * 0.80)) * 1.85;
      bl.push({ at: [0, 1.0 + f * 3.5, 0], pts: ovalPts(r, r * 0.90, 14) });
    }
    parts.push({
      geometry: organLoft(bl, { sides: 38, samples: 30, capRise: [0.30, 0.34], up: new THREE.Vector3(0, 0, 1) }),
      color: TISSUE.urine,
    });
    vessel(parts, TISSUE.pelvis, [[0, 1.15, 0, 0.28], [0, 0.6, 0.05, 0.25], [0, 0.1, 0.1, 0.23]], { sides: 10, along: 8, capStart: false });
  }

  standParts(parts, { top: kidneyY - halfTall - 0.7, x: -3.8, z: -1.7, plate: 1.3 });
  standParts(parts, { top: kidneyY - halfTall, x: 3.8, z: -1.7, plate: 1.3 });

  g.add(organMesh(parts, {
    tint: (p) => {
      const mottle = 0.95 + noise3(p.x * 1.6, p.y * 1.4, p.z * 1.6) * 0.07;
      // A pale cortex OVER a dark medulla, as a gradient by distance from the nearer
      // kidney's own vertical axis -- so the cut face shades outward with no second
      // material. Measured against the axis in the xz plane, not against x alone: the
      // first pass brightened everything near each kidney's mid-plane, which is the
      // inside of the organ, and shaded the surface that should have been palest.
      const dx = Math.min(Math.abs(p.x + 3.8), Math.abs(p.x - 3.8));
      const radial = Math.hypot(dx, p.z) / halfLat;
      const shell = 1 + Math.max(0, Math.min(1, (radial - 0.45) / 0.55)) * 0.13;
      return [mottle * shell, mottle * shell * 0.97, mottle * shell * 0.96];
    },
    material: { roughness: 0.58, ...relief('hide', { seed: 17, repeat: 10, strength: 0.22 }) },
  }));
  return g;
}

// ---------------------------------------------------------------------------
// Supporting organ models
// ---------------------------------------------------------------------------

// A groove profile: full depth on the line, nothing past halfWidth. Used by every fissure,
// sulcus, sacculation and sphincter in this file.
function grooveAt(d, halfWidth, depth) {
  const a = Math.abs(d) / halfWidth;
  return a >= 1 ? 0 : depth * (1 - a * a) * (1 - a * a);
}

// Four chambers, the great vessels, and the coronary arteries that feed the muscle itself.
//
// A heart is a CONE with two ears on it. The ventricular mass is one solid tapering to the
// apex you can feel beating against your ribs, and the atria sit on top of it -- which is
// why they are called auricles. The first pass was two big ellipsoids side by side with a
// separate cone stuck underneath, and that arrangement has three problems at once: the
// join between the two balls is a hard vertical crease down the middle of the organ, the
// cone's rim is a visible hard edge where no edge exists, and the two halves being separate
// solids is the only reason their colours could differ at all.
//
// Here the ventricles are ONE loft and the red-left, blue-right convention is a per-vertex
// TINT across it, with the boundary falling exactly in the interventricular sulcus. So the
// colour change lands on a real anatomical landmark instead of on a modelling seam -- and
// the coronary arteries, which run IN that sulcus and in the coronary one, sit in grooves
// warped into the surface rather than hovering over it. The first pass's coronaries were
// visibly floating a few inches clear of the ventricle they are supposed to be embedded in.
// Hoisted, because the tint below runs once per vertex and allocating two Colors inside it
// would be twenty thousand throwaway objects per heart.
const LEFT_HEART = new THREE.Color(TISSUE.myocardium);
const RIGHT_HEART = new THREE.Color(TISSUE.myocardiumR);

export function heartModel() {
  const g = group();
  const parts = [];
  const apexY = 2.1;
  const baseY = 8.4;
  const H = baseY - apexY;

  // The interventricular sulcus runs from the base down to the right of the apex. Both the
  // groove and the colour boundary read this one function, which is what keeps them
  // together no matter how the shape is tuned.
  const septumX = (y) => -0.45 + ((baseY - y) / H) * 1.35;

  const axis = [
    [0.95, apexY, 0.55],
    [0.70, apexY + H * 0.22, 0.45],
    [0.42, apexY + H * 0.48, 0.25],
    [0.16, apexY + H * 0.74, 0.0],
    [0.0, baseY, -0.22],
  ];
  // Wider than it is deep, and widest just below the base. A heart's section is a rounded
  // triangle -- fuller on the left, flatter on the right where the thin-walled right
  // ventricle wraps around it.
  const vsec = (w, d) => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const flat = 1 - Math.max(0, -Math.cos(a)) * 0.22;
      pts.push([Math.cos(a) * w * flat, Math.sin(a) * d * flat]);
    }
    return pts;
  };
  const vprofile = [
    [0.00, 0.30, 0.28],
    [0.16, 1.30, 1.15],
    [0.40, 2.05, 1.80],
    [0.62, 2.45, 2.10],
    [0.82, 2.60, 2.22],
    [1.00, 2.50, 2.15],
  ];
  const vstations = vprofile.map(([f, w, d]) => {
    const t = f;
    const i = Math.min(axis.length - 1, Math.floor(t * (axis.length - 1) + 0.5));
    void i;
    return { at: null, f: t, pts: vsec(w, d) };
  });
  // Positions come off the axis curve so the section list and the axis list need not match
  // in length.
  const vcurve = new THREE.CatmullRomCurve3(axis.map((a) => new THREE.Vector3(...a)));
  const ventricles = organLoft(
    vstations.map((s) => {
      const p = vcurve.getPoint(s.f);
      return { at: [p.x, p.y, p.z], pts: s.pts };
    }),
    {
      sides: 54,
      samples: 50,
      // A heart's apex is ROUNDED, not pointed. At the rise the first pass used, the fan
      // cap's centre vertex pulled a thin spike out of the bottom of the organ -- and a
      // spike is exactly what the apex is not: it is the blunt tip you can feel thumping
      // against your ribs.
      capRise: [0.34, -0.55],
      warp: (u, t, p) => {
        let d = 0;
        // Anterior interventricular sulcus, on the front only.
        if (p.z > -0.4) d += grooveAt(p.x - septumX(p.y), 0.55, 0.34) * Math.min(1, (p.z + 0.4) / 1.2);
        // Posterior interventricular sulcus.
        if (p.z < -0.6) d += grooveAt(p.x - septumX(p.y) * 0.55, 0.5, 0.26);
        // Coronary sulcus: the groove encircling the whole organ where the atria meet the
        // ventricles, and the one landmark that says which end is which.
        d += grooveAt(p.y - (baseY - 0.35), 0.42, 0.30);
        return d;
      },
      up: new THREE.Vector3(0, 0, 1),
    }
  );
  // WHITE on purpose, and it is a sentinel. The red-left / blue-right convention is applied
  // by the per-vertex tint below, and a tint MULTIPLIES -- so starting from a red base it
  // can only ever produce darker reds, never a blue. The first pass painted this part
  // myocardium red and then asked the tint to make half of it indigo, which came out as one
  // uniformly red heart. Starting from white gives the tint the whole gamut, and a colour no
  // real tissue has makes the ventricular mass trivially identifiable in the merged mesh.
  parts.push({ geometry: ventricles, color: 0xffffff });

  // The two atria, seated ON the base of the ventricles above the coronary sulcus.
  for (const side of [-1, 1]) {
    const ax = side < 0 ? -1.45 : 1.35;
    const st = [];
    for (let i = 0; i <= 5; i++) {
      const f = i / 5;
      const r = Math.sin(Math.PI * (0.18 + f * 0.70)) * (side < 0 ? 1.62 : 1.52);
      st.push({ at: [ax + f * side * 0.12, baseY - 0.55 + f * 2.0, -0.35 - f * 0.12], pts: ovalPts(r, r * 0.90, 14) });
    }
    parts.push({
      geometry: organLoft(st, { sides: 34, samples: 24, capRise: [-0.35, 0.55], up: new THREE.Vector3(0, 0, 1) }),
      color: side < 0 ? TISSUE.myocardiumR : TISSUE.myocardium,
    });
    // The auricle -- the ear-shaped flap that gives the atrium its name, wrapping forward
    // round the great vessels.
    blister(parts, side < 0 ? TISSUE.myocardiumR : TISSUE.myocardium, {
      at: [ax + side * 1.05, baseY + 0.55, 0.55],
      radius: 0.86,
      rot: [0.5, side * 0.6, 0],
      detail: 14,
      sink: 0.7,
    });
  }

  // --- Great vessels -------------------------------------------------------
  // Aortic arch, with the three head-and-arm branches off the top of it: brachiocephalic,
  // left common carotid, left subclavian. They are what makes an arch read as the aorta
  // rather than as a handle.
  vesselTree(parts, ARTERY, {
    chain: [
      [0.75, baseY + 0.4, -0.1, 0.86],
      [0.55, baseY + 2.3, -0.5, 0.82],
      [-0.30, baseY + 3.5, -0.95, 0.78],
    ],
    kids: [
      {
        chain: [
          [-0.30, baseY + 3.5, -0.95, 0.76],
          [-1.55, baseY + 3.0, -1.15, 0.72],
          [-2.10, baseY + 1.2, -1.20, 0.68],
          [-2.20, baseY - 0.6, -1.20, 0.64],
        ],
      },
      { chain: [[-0.05, baseY + 3.6, -0.95, 0.28], [0.10, baseY + 4.6, -1.05, 0.24], [0.20, baseY + 5.5, -1.15, 0.20]] },
      { chain: [[-0.45, baseY + 3.7, -1.0, 0.26], [-0.50, baseY + 4.7, -1.1, 0.22], [-0.55, baseY + 5.6, -1.2, 0.19]] },
      { chain: [[-0.85, baseY + 3.6, -1.0, 0.26], [-1.05, baseY + 4.5, -1.1, 0.22], [-1.20, baseY + 5.4, -1.2, 0.19]] },
    ],
  }, { sides: 15, along: 22 });

  // Pulmonary trunk, crossing IN FRONT of the aorta before it splits -- which is what it
  // really does, and the crossing is most of why a heart looks complicated at the top.
  vesselTree(parts, VEIN, {
    chain: [
      [-0.55, baseY - 0.1, 0.95, 0.78],
      [-0.30, baseY + 1.6, 0.70, 0.74],
      [-0.10, baseY + 2.9, 0.20, 0.66],
    ],
    kids: [
      { chain: [[-0.10, baseY + 2.9, 0.20, 0.50], [-1.60, baseY + 3.0, 0.10, 0.42], [-3.00, baseY + 2.9, 0.0, 0.34]] },
      { chain: [[-0.10, baseY + 2.9, 0.20, 0.48], [1.50, baseY + 3.0, 0.05, 0.40], [2.90, baseY + 2.9, -0.05, 0.32]] },
    ],
  }, { sides: 14, along: 18 });

  // Superior and inferior vena cava, both entering the right atrium.
  vessel(parts, VEIN, [
    [-2.55, baseY + 4.4, 0.1, 0.62],
    [-2.35, baseY + 2.4, 0.0, 0.66],
    [-2.05, baseY + 0.6, -0.15, 0.72],
  ], { sides: 14, along: 14, capEnd: false });
  vessel(parts, VEIN, [
    [-1.85, apexY + 0.5, 0.2, 0.60],
    [-2.05, apexY + 2.3, 0.1, 0.64],
    [-2.10, baseY - 0.7, -0.1, 0.70],
  ], { sides: 14, along: 14, capEnd: false });

  // Four pulmonary veins into the left atrium, carrying RED blood -- the reversal that
  // catches everybody, and worth the four extra tubes.
  for (const [dz, dy] of [[1.0, 1.5], [1.0, 0.3], [-1.0, 1.5], [-1.0, 0.3]]) {
    vessel(parts, ARTERY, [
      [1.35, baseY + dy, -0.35 + dz * 0.2, 0.30],
      [2.55, baseY + dy + 0.1, dz * 0.9, 0.28],
      [3.55, baseY + dy + 0.2, dz * 1.5, 0.26],
    ], { sides: 10, along: 12, capStart: false });
  }

  // --- Coronary arteries ---------------------------------------------------
  // These lie IN the sulci, which is exactly why the grooves above exist. Tapering to
  // nothing at their far ends, because a coronary really does branch down to invisibility.
  vesselTree(parts, TISSUE.arterialHi, {
    chain: [[1.10, baseY - 0.30, 0.90, 0.20], [0.60, baseY - 0.42, 1.55, 0.19]],
    kids: [
      // Left anterior descending, down the anterior interventricular sulcus.
      {
        chain: [
          [0.60, baseY - 0.42, 1.55, 0.18],
          [septumX(baseY - H * 0.35) + 0.1, baseY - H * 0.35, 1.75, 0.15],
          [septumX(apexY + H * 0.30) + 0.1, apexY + H * 0.30, 1.30, 0.10],
          [1.05, apexY + 0.55, 0.75, 0.02],
        ],
      },
      // Circumflex, round the coronary sulcus to the left.
      {
        chain: [
          [0.60, baseY - 0.42, 1.55, 0.16],
          [2.10, baseY - 0.40, 0.85, 0.13],
          [2.55, baseY - 0.45, -0.55, 0.09],
          [1.85, baseY - 0.50, -1.55, 0.02],
        ],
      },
    ],
  }, { sides: 9, along: 20, detail: 9 });
  vessel(parts, TISSUE.arterialHi, [
    [-1.15, baseY - 0.30, 0.85, 0.18],
    [-2.15, baseY - 0.42, 0.15, 0.15],
    [-2.30, baseY - 0.55, -1.05, 0.11],
    [-1.55, baseY - 0.80, -1.85, 0.02],
  ], { sides: 9, along: 18, capEnd: false });

  standParts(parts, { top: apexY + 0.4, x: -2.4, z: -1.9, plate: 1.3 });
  standParts(parts, { top: apexY + 0.9, x: 2.5, z: -1.9, plate: 1.3 });

  g.add(organMesh(parts, {
    tint: (p, c) => {
      const mottle = 0.95 + noise3(p.x * 1.7, p.y * 1.5, p.z * 1.7) * 0.07;
      // Anything not painted with the white sentinel keeps its own colour and only takes
      // the mottle.
      if (c.r < 0.97 || c.g < 0.97 || c.b < 0.97) return [mottle, mottle, mottle];
      // Red on the left, indigo on the right -- the convention every anatomy textbook uses,
      // and the whole teaching point: the blue side is not cold, it is carrying blood that
      // has not been to the lungs yet. Applied across ONE solid, with the boundary falling
      // in the interventricular sulcus, so the colour change lands on a real anatomical
      // landmark instead of on a modelling seam. The first pass could only do this by
      // building the two halves as separate balls, which put a hard crease down the middle
      // of the organ and was the loudest wrong thing on it.
      // Narrow crossover, not a linear ramp: a wide blend puts a broad purple band down the
      // middle of the heart, and every textbook shows the division as close to a hard line.
      const raw = Math.max(0, Math.min(1, (p.x - septumX(p.y)) / 0.55 + 0.5));
      const f = raw * raw * (3 - 2 * raw);
      return [
        (RIGHT_HEART.r + (LEFT_HEART.r - RIGHT_HEART.r) * f) * mottle,
        (RIGHT_HEART.g + (LEFT_HEART.g - RIGHT_HEART.g) * f) * mottle,
        (RIGHT_HEART.b + (LEFT_HEART.b - RIGHT_HEART.b) * f) * mottle,
      ];
    },
    material: { roughness: 0.5, ...relief('hide', { seed: 13, repeat: 9, strength: 0.24 }) },
  }));
  return g;
}

// Cerebrum in two gyrified hemispheres, cerebellum behind and below, brain stem running
// down into a length of spinal cord.
//
// GYRI ARE ANISOTROPIC, and that is the whole difference between this and the first pass,
// which used roughenSphere at a high amount and produced a cauliflower. Real convolutions
// run in characteristic directions -- mostly front-to-back over the top, swinging round the
// temporal lobe -- so isotropic lumps read as a vegetable rather than as a brain however
// deep they are. Three named sulci are cut explicitly on top of that field, because those
// are the ones a student can be shown: the longitudinal fissure between the hemispheres, the
// lateral (Sylvian) fissure that separates the temporal lobe, and the central sulcus.
//
// The first pass also sat the brain in a bowl of bone, to stop a lobed mass on a vertical
// stem reading as a tree. That bowl is gone: with a real brainstem under it -- midbrain,
// PONS and medulla, the pons being the bulge that makes a brainstem recognisable -- the
// shape no longer needs rescuing, and the bowl itself read as a grey saucer.
export function brainModel() {
  const g = group();
  const parts = [];
  const lift = 6.8;
  // A brain is only a little longer than it is WIDE -- roughly 6.7 by 5.5 by 3.6 inches --
  // and the first pass made it 7.4ft long against 3.4ft across, which is the proportion of a
  // lens. Seen from the front, where every student meets it, it read as a flat pillow with
  // no convolutions visible at all, because the whole gyral field was compressed into an
  // edge. Width is what makes a brain read from the arrival direction.
  const halfW = 2.35;
  const halfH = 1.95;

  // Section coordinates for an axis along -Z with up = +Y: u runs lateral, v runs DOWN.
  const bsec = (lat, up) => [lat, -up];
  const hemiOutline = (mirror) => [
    bsec(1.00 * mirror, 0.10),
    bsec(0.92 * mirror, 0.62),
    bsec(0.62 * mirror, 0.95),
    bsec(0.20 * mirror, 1.06),
    bsec(-0.08 * mirror, 1.00),
    bsec(-0.14 * mirror, 0.55),
    bsec(-0.14 * mirror, 0.02),
    bsec(-0.14 * mirror, -0.48),
    bsec(-0.06 * mirror, -0.82),
    bsec(0.36 * mirror, -1.00),
    bsec(0.80 * mirror, -0.82),
    bsec(1.00 * mirror, -0.38),
  ];
  // Frontal pole small, widest across the parietal, occipital pole small again.
  const hemiProfile = [
    [3.30, 0.26, 0.30],
    [2.85, 0.66, 0.66],
    [1.95, 0.92, 0.90],
    [0.75, 1.00, 1.00],
    [-0.65, 0.99, 0.99],
    [-1.95, 0.90, 0.88],
    [-2.95, 0.62, 0.60],
    [-3.55, 0.24, 0.26],
  ];

  for (const side of [-1, 1]) {
    const cx = side * (halfW * 0.155 + 0.10);
    const outline = hemiOutline(side);
    const stations = hemiProfile.map(([z, sw, sh]) => ({
      at: [cx, lift + (1 - sh) * 0.18, z],
      pts: outline.map(([u, v]) => [u * halfW * sw, v * halfH * sh]),
    }));

    parts.push({
      geometry: organLoft(stations, {
        sides: 76,
        samples: 84,
        capRise: [0.30, 0.28],
        warp: (u, t, p) => {
          // The gyral field: three wave trains at different frequencies running in
          // different directions, which is what produces the wandering, branching ridges a
          // cortex has. Isotropic noise gives a cauliflower and a single high frequency
          // gives corduroy; crossed trains give convolutions.
          //
          // EVERY FREQUENCY HERE IS BOUNDED BY THE SAMPLE COUNT, and that is not a detail.
          // The first pass ran the along-axis train at 26 cycles over 66 samples -- two and
          // a half samples per ridge, which is under the Nyquist limit -- so instead of
          // ridges it produced aliasing, and the brain rendered as a crumpled paper bag
          // with tears in it. Nine samples per cycle is what makes a ridge a ridge.
          const along = t * 7;
          const around = u * Math.PI * 2;
          const field =
            Math.sin(around * 3.1 + along * 1.7) * 0.62 +
            Math.sin(around * 1.7 + along * 2.6) * 0.42;
          // A SULCUS IS A NARROW DEEP CUT, not the trough of a wave, and that distinction is
          // the whole difference between a brain and a beanbag. Feeding the wave field
          // straight in as a displacement gives smooth rolling undulation, which at any
          // amplitude reads as a dented pillow because the ridges and the valleys are the
          // same width. Cutting only where the field crosses ZERO turns the same field into a
          // branching network of narrow clefts between broad flat gyri.
          //
          // The transfer function is a GAUSSIAN and not a clamped linear ramp, because
          // anything built on |field| has a kink at field = 0 -- which is the bottom of every
          // sulcus, so the deepest line of each one came out as a hard crease and the whole
          // cortex rendered as sawtoothed crumpled paper.
          //
          // Cleft WIDTH is bounded by the mesh, not by anatomy. A real sulcus is about 3mm
          // on a 14cm brain, which at this model's twelvefold enlargement is a tenth of a
          // foot -- one quad. Asking for that gives aliasing, not detail, so these gyri are
          // deliberately broader and fewer than a real cortex's: about six samples across
          // each cleft, which is the finest that can actually be drawn.
          const cleft = Math.exp(-(field * field) / (2 * 0.26 * 0.26));
          let d = cleft * halfW * 0.19;

          // Longitudinal fissure: the deep cleft between the two hemispheres. SMOOTH, not a
          // binary test on which side of the midline a vertex is -- a step function in a
          // displacement field is a cliff, and it tore the surface open along its whole
          // length.
          const medial = Math.max(0, Math.min(1, (cx * side - p.x * side) / (halfW * 0.35) + 0.5));
          const above = Math.max(0, Math.min(1, (p.y - lift) / (halfH * 0.3)));
          d += medial * above * halfW * 0.13;

          // Lateral (Sylvian) fissure: the deep diagonal groove separating the temporal
          // lobe. Without it there is no temporal lobe, only a bulge.
          const syl = (p.y - (lift - halfH * 0.30)) - (p.z * 0.30);
          d += grooveAt(syl, halfH * 0.17, halfW * 0.30);

          // Central sulcus: down and forward from the vertex.
          const cen = (p.z + 0.35) + (p.y - lift) * 0.55;
          if (p.y > lift + halfH * 0.15) d += grooveAt(cen, 0.38, halfW * 0.17);

          // Nothing may cut deeper than a third of the local radius, whatever the terms add
          // up to. Four independent displacements that each look reasonable can together
          // exceed the section radius, at which point the surface passes through its own
          // axis and turns inside out.
          const local = Math.hypot(p.x - cx, p.y - lift);
          return Math.min(d, Math.max(0.05, local) * 0.34);
        },
        up: new THREE.Vector3(0, 1, 0),
      }),
      color: TISSUE.cortexPink,
    });

  }

  // Cerebellum: FINE PARALLEL FOLIA, not gyri. Its surface texture is completely different
  // from the cerebrum's -- dozens of tight transverse leaves rather than a few broad
  // wandering ridges -- and getting that contrast right is what stops it reading as a third,
  // smaller hemisphere.
  //
  // THE FOLIA RUN ACROSS THE ORGAN, so they are a function of the SECTION ANGLE and not of
  // distance along the axis. The first pass drove them off the length instead, over an axis
  // less than a foot long, which wrapped sixteen tight rings round a small sausage: the
  // result read unmistakably as a snail shell, twice, one under each occipital lobe. It is
  // also ONE piece spanning the midline with a vermis groove down it, which is what a
  // cerebellum is -- two lobes joined by a worm-shaped ridge.
  const cb = [];
  const cbHalf = 1.75;
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const x = -cbHalf + f * cbHalf * 2;
    const s = Math.sqrt(Math.max(0.04, 1 - (x / (cbHalf * 1.06)) ** 2));
    cb.push({ at: [x, lift - 1.62 - (1 - s) * 0.12, -2.72], pts: ovalPts(1.22 * s, 0.94 * s, 14) });
  }
  parts.push({
    geometry: organLoft(cb, {
      sides: 54,
      samples: 40,
      capRise: [0.22, 0.22],
      warp: (u, t) => {
        // Transverse leaves: 13 of them round the section, which at 54 sides is four samples
        // a leaf -- the finest that will resolve.
        const folia = (Math.sin(u * Math.PI * 2 * 13) * 0.5 + 0.5) * 0.075;
        // The vermis: the ridge down the middle joining the two lobes.
        return folia + grooveAt(t - 0.5, 0.055, 0.24);
      },
      up: new THREE.Vector3(0, 1, 0),
    }),
    color: TISSUE.cerebellum,
  });

  // Brainstem: midbrain, pons, medulla, then the cord. The PONS is the bulge, and it is the
  // single feature that makes a brainstem read as a brainstem rather than as a stalk.
  // Deliberately SLENDER and a shade darker than the cortex. Built at the radius that felt
  // structurally right -- around a foot thick, in the same pale cream -- the result was a
  // fat pale trunk under a lumpy canopy, and the whole exhibit read as a tree. That is what
  // the first pass's bowl of bone was there to rescue, and with the stem this size and a
  // real pons on it the bowl is no longer needed.
  const stem = 0xdcc7a8;
  vessel(parts, stem, [
    [0, lift - 0.60, -1.05, 0.44],
    [0, lift - 1.35, -1.35, 0.52],
    [0, lift - 2.05, -1.55, 0.46],
    [0, lift - 2.75, -1.70, 0.36],
    [0, lift - 3.60, -1.85, 0.32],
  ], { sides: 18, along: 24, capStart: false, capEnd: false });
  // The PONS: the bulge on the front of the brainstem, and the single feature that makes a
  // brainstem read as one rather than as a stalk.
  blister(parts, stem, {
    at: [0, lift - 1.62, -1.16, 0],
    radius: 0.68,
    rot: [0.35, 0, 0],
    detail: 18,
    sink: 0.9,
  });
  vessel(parts, stem, [
    [0, lift - 3.60, -1.85, 0.32],
    [0, lift - 5.20, -1.95, 0.30],
    [0, lift - 6.60, -2.05, 0.28],
  ], { sides: 16, along: 16, capStart: false });

  // Optic nerves and chiasm, on the underside: the one cranial nerve pair anybody can name,
  // and they give the base of the brain a front.
  // Tucked UNDER the frontal lobes and angled down, not laid across the underside. Run
  // straight forward at the same height they read as a yellow stick lying on the brain.
  vesselTree(parts, TISSUE.nerve, {
    chain: [[0, lift - 1.05, 0.10, 0.19], [0, lift - 1.22, 0.70, 0.21]],
    kids: [
      { chain: [[0, lift - 1.22, 0.70, 0.17], [-0.50, lift - 1.42, 1.50, 0.15], [-0.86, lift - 1.72, 2.20, 0.13]] },
      { chain: [[0, lift - 1.22, 0.70, 0.17], [0.50, lift - 1.42, 1.50, 0.15], [0.86, lift - 1.72, 2.20, 0.13]] },
    ],
  }, { sides: 9, along: 12, detail: 9 });

  standParts(parts, { top: lift - 3.9, x: 0, z: -4.1, plate: 1.9 });
  g.add(organMesh(parts, {
    tint: (p, c) => {
      // Mottle only. The first pass also darkened by "distance from the hemisphere's own
      // axis in the section plane", meaning to shade the depths of the sulci -- but that
      // quantity is small at BOTH POLES as well, where the section is small, so it dimmed the
      // frontal and occipital lobes by a third and the brain read as a dark mass from
      // exactly the direction a student arrives. The sulci do not need painting: they are
      // real geometry, and the sun shades them for free.
      void c;
      const mottle = 0.96 + noise3(p.x * 2.1, p.y * 1.9, p.z * 2.1) * 0.06;
      return [mottle, mottle * 0.98, mottle * 0.99];
    },
    material: { roughness: 0.66, ...relief('hide', { seed: 17, repeat: 13, strength: 0.2 }) },
  }));
  return g;
}

// The small intestine coiled inside the frame of the large intestine, which is exactly how
// they sit in the abdomen -- the colon runs up the right side, across, and down the left,
// and the small intestine fills the middle.
//
// HAUSTRA ARE SACCULATIONS OF THE COLON'S OWN WALL, and the taeniae coli are what make
// them. Three ribbons of muscle run the length of the large intestine and they are SHORTER
// than the tube they are on, so the tube puckers between them into a row of pouches -- that
// is the whole mechanism, and once the taeniae are there the pouches follow for free. The
// first pass drew the constrictions as separate rings, each of which had to be sized against
// a radius it did not own; a pucker built into the surface cannot be the wrong size.
export function intestineCoil({ turns = 4.2, seed = 5 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(seed);

  // A real small intestine is a jumble of loops, not a spring. The radius, the height and
  // the depth all wobble on different frequencies, which is what stops any two loops
  // sitting parallel -- a clean helix whose rise per turn is smaller than its own diameter
  // merges into a stack of flat sausages.
  const coil = [];
  const steps = 74;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2 * turns;
    const radius = 3.4 - t * 0.95 + Math.sin(angle * 2.3) * 0.85 + Math.cos(angle * 0.9) * 0.45;
    coil.push([
      Math.cos(angle) * radius,
      1.9 + t * 4.5 + Math.sin(angle * 1.6) * 0.75,
      Math.sin(angle) * radius * 0.8 + Math.sin(angle * 3.1) * 0.35 + randomIn(rng, -0.1, 0.1),
      0.60,
    ]);
  }
  vessel(parts, GUT_PINK, coil, { sides: 16, along: 210 });

  // Large intestine: caecum bottom-right, ascending, transverse, descending, sigmoid.
  const colonPath = [
    [-5.4, 1.5, -1.6],
    [-5.7, 3.4, -1.7],
    [-5.5, 6.5, -1.7],
    [-2.0, 7.7, -1.6],
    [2.0, 7.7, -1.6],
    [5.5, 6.5, -1.7],
    [5.7, 3.5, -1.7],
    [4.6, 1.5, -1.5],
    [1.6, 1.0, -1.2],
    [0.2, 0.5, -0.9],
  ];
  const colonRadii = [1.30, 1.22, 1.18, 1.14, 1.14, 1.18, 1.14, 1.04, 0.94, 0.78];
  const colonStations = colonPath.map((at, i) => ({ at, pts: ringPts(colonRadii[i], 12) }));
  parts.push({
    geometry: organLoft(colonStations, {
      sides: 40,
      samples: 130,
      capRise: [0.5, 0.2],
      warp: (u, t) => {
        // Three taeniae stand PROUD (negative displacement) and the wall puckers inward
        // between them and between each pair of pouches.
        const band = Math.cos(u * Math.PI * 2 * 3);
        const taenia = Math.max(0, (band - 0.72) / 0.28);
        const pouch = (Math.sin(t * Math.PI * 2 * 26) * 0.5 + 0.5) * (1 - taenia);
        return pouch * 0.20 - taenia * 0.11;
      },
      up: new THREE.Vector3(0, 1, 0),
    }),
    color: TISSUE.colon,
  });

  // Caecum and appendix. The appendix is three inches of dead-end tube that everybody has
  // heard of and no model of a gut should leave out.
  const caecum = [];
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const r = Math.sin(Math.PI * (0.26 + f * 0.60)) * 1.42;
    caecum.push({ at: [-5.35, 1.6 - f * 1.25, -1.55 + f * 0.1], pts: ringPts(r, 12) });
  }
  parts.push({
    geometry: organLoft(caecum, { sides: 30, samples: 22, capRise: [0.2, 0.55], up: new THREE.Vector3(0, 1, 0) }),
    color: TISSUE.colon,
  });
  vessel(parts, TISSUE.gut, [
    [-5.6, 0.55, -1.15, 0.24],
    [-5.9, 0.30, -0.35, 0.21],
    [-5.7, 0.42, 0.45, 0.17],
    [-5.2, 0.65, 1.05, 0.12],
  ], { sides: 9, along: 16, capStart: false });

  // Appendices epiploicae -- the little fat tags hanging off a colon. Small, cheap, and
  // they are half of what makes a large intestine look like one rather than like a hose.
  for (let i = 0; i < 26; i++) {
    const t = 0.08 + (i / 26) * 0.84;
    const idx = Math.min(colonPath.length - 2, Math.floor(t * (colonPath.length - 1)));
    const f = t * (colonPath.length - 1) - idx;
    const a = colonPath[idx];
    const b = colonPath[idx + 1];
    const r = colonRadii[idx] * 1.02;
    const ang = randomIn(rng, 0, Math.PI * 2);
    blister(parts, TISSUE.fat, {
      at: [
        a[0] + (b[0] - a[0]) * f + Math.cos(ang) * r * 0.7,
        a[1] + (b[1] - a[1]) * f + Math.sin(ang) * r * 0.7,
        a[2] + (b[2] - a[2]) * f + r * 0.55,
      ],
      radius: randomIn(rng, 0.20, 0.34),
      detail: 8,
      sink: 0.9,
    });
  }

  standParts(parts, { top: 1.4, x: -5.6, z: -1.6, plate: 1.4 });
  standParts(parts, { top: 1.4, x: 5.6, z: -1.6, plate: 1.4 });

  g.add(organMesh(parts, {
    tint: (p, c) => {
      const mottle = 0.95 + noise3(p.x * 1.5, p.y * 1.3, p.z * 1.5) * 0.075;
      // The taeniae are paler than the wall they run along, which is what a real colon
      // looks like -- and it makes the mechanism visible without a single extra triangle.
      void c;
      return [mottle, mottle * 0.98, mottle * 0.97];
    },
    material: { roughness: 0.62, ...relief('hide', { seed: 19, repeat: 14, strength: 0.24 }) },
  }));
  return g;
}

// A single alveolar sac wrapped in its capillary net, at a scale where a student can see
// what is actually happening: this is the only place in the body where air and blood come
// within a fraction of a millimetre of each other.
//
// The capillary net is a real NET now, built with vesselTree, rather than three tilted
// toruses. A capillary bed is the point of an alveolus -- the whole exchange happens across
// it -- and three rings read as hoops thrown over a bunch of grapes.
export function alveoliCluster({ height = 10, seed = 7 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(seed);

  // The terminal bronchiole feeding the sac, branching twice on the way.
  vesselTree(parts, AIRWAY, {
    chain: [[0, 0.25, 0, 0.55], [0, 2.3, 0, 0.50], [0, 4.4, 0, 0.46]],
    kids: [],
  }, { sides: 14, along: 14, capLeaves: false });

  const clusters = [
    [-2.2, height - 2.6, 0.4],
    [2.3, height - 2.2, -0.5],
    [0.2, height - 0.4, 0.6],
  ];
  for (const [ci, [cx, cy, cz]] of clusters.entries()) {
    vessel(parts, AIRWAY, [
      [0, 4.4, 0, 0.40],
      [cx * 0.6, (4.4 + cy) / 2, cz * 0.6, 0.30],
      [cx, cy - 1.15, cz, 0.24],
    ], { sides: 12, along: 16, capStart: false, capEnd: false });

    // The sac: a cluster of alveoli budding off one duct, each SUNK into its neighbours so
    // the bunch is one connected mass rather than a handful of loose balls.
    const centre = [cx, cy + 0.2, cz];
    knot(parts, TISSUE.lung, centre, 1.05, 16);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + ci * 0.7;
      const tilt = randomIn(rng, -0.5, 0.7);
      const r = randomIn(rng, 0.80, 1.18);
      knot(parts, TISSUE.lung, [
        cx + Math.cos(a) * 1.28,
        cy + tilt,
        cz + Math.sin(a) * 1.28,
      ], r, 14);
    }

    // The capillary net: one arteriole in (blue -- this blood has not been oxygenated yet),
    // a mesh of capillaries over the sac, one venule out (red). The colour swap across the
    // bed IS the lesson.
    // The rings GRAZE the sacs, and the tolerance either side is small. A cluster's outer
    // surface reaches about 2.28: at 2.05 each ring was buried in the tissue and only the
    // short arc crossing the front showed, so a net read as one red bar and one blue bar laid
    // across the bunch -- and at 2.62 they cleared the surface entirely and read as three
    // loose hoops orbiting it, like a diagram of an atom. A capillary bed lies ON an
    // alveolus, which means within a couple of inches of its skin at this scale.
    const ring = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      ring.push([
        cx + Math.cos(a) * 2.34,
        cy + Math.sin(a * 2) * 0.62 + 0.1,
        cz + Math.sin(a) * 2.34,
        0.105,
      ]);
    }
    vessel(parts, i2c(ci), ring, { sides: 8, along: 44, capStart: false, capEnd: false });
    const ring2 = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 + 1.4;
      ring2.push([
        cx + Math.cos(a) * 2.26,
        cy + Math.cos(a * 2) * 0.70 - 0.15,
        cz + Math.sin(a) * 2.26,
        0.095,
      ]);
    }
    vessel(parts, ci === 1 ? VEIN : TISSUE.arterialHi, ring2, { sides: 8, along: 44, capStart: false, capEnd: false });
    // A third strand tipped out of the horizontal, so the three cross each other and the
    // whole thing reads as a mesh rather than as two hoops.
    const ring3 = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 + 2.6;
      ring3.push([
        cx + Math.cos(a) * 2.20,
        cy + Math.sin(a) * 1.42,
        cz + Math.cos(a) * 0.7 + Math.sin(a) * 1.35,
        0.085,
      ]);
    }
    vessel(parts, ci === 1 ? TISSUE.arterialHi : VEIN, ring3, { sides: 7, along: 40, capStart: false, capEnd: false });
  }

  standParts(parts, { top: 0.6, x: 0, z: 0, plate: 1.6 });
  g.add(organMesh(parts, {
    tint: (p) => {
      const m = 0.96 + noise3(p.x * 2.4, p.y * 2.2, p.z * 2.4) * 0.06;
      return [m, m, m];
    },
    material: { roughness: 0.58 },
  }));
  return g;
}

function i2c(i) {
  return i === 1 ? TISSUE.arterialHi : VEIN;
}

// The finger-like projections that line the small intestine, and the reason a 22-foot tube
// has the absorbing surface of a studio flat. Ground cover for the digestive wing.
//
// Villi are not smooth fingers: each one is covered in microvilli, and between them the
// lining dips into CRYPTS. The crypts are what stop a patch of these reading as a bed of
// worms -- a real lining is a surface with pits in it, not a lawn of separate objects.
export function villiPatch({ count = 44, radius = 6, seed = 11 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  // The mucosal lining the villi stand ON, as a real slab.
  //
  // Without it the patch is a scatter of pink pegs on the bare floor of the hall -- the same
  // "colour on open sand is litter" problem the reef's sand gardens had, and here it is worse
  // because a lining IS a surface and the villi are only interesting as its texture.
  //
  // It is a low CYLINDER and not a displaced disc, which was the first attempt: a
  // CircleGeometry is a triangle FAN with a single centre vertex and no interior vertices at
  // all, so displacing it vertically cannot make a dimpled surface -- it just swings each
  // rim vertex up or down about the centre and shreds the fan into loose triangles standing
  // at angles. Half a dozen of them were visible lying on the floor like dropped petals.
  const slab = new THREE.CylinderGeometry(radius * 1.04, radius * 1.10, 0.44, 46);
  parts.push({ geometry: slab, position: [0, 0.22, 0], color: TISSUE.mucosa });

  // Crypts: the pits between the villi where the lining dips down and new cells are made.
  // Sunk dark beads, which is all a pit needs to be at this scale.
  for (let i = 0; i < 30; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * radius * 0.90;
    blister(parts, 0x8f4038, {
      at: [Math.cos(a) * d, 0.42, Math.sin(a) * d],
      radius: randomIn(rng, 0.24, 0.40),
      detail: 8,
      sink: 1.5,
    });
  }

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius * 0.94;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const height = randomIn(rng, 1.7, 3.1);
    const lean = randomIn(rng, -0.45, 0.45);
    const tip = [x + lean, height, z + lean * 0.7];
    // Rounded at the tip, not pointed: a villus that tapers to nothing is a spike, which is
    // the same lesson the reef's fronds and the neuron's dendrites each taught.
    vessel(parts, i % 5 === 0 ? TISSUE.mucosaHi : GUT_PINK, [
      [x, 0.05, z, 0.30],
      [x + lean * 0.4, height * 0.55, z + lean * 0.3, 0.26],
      [tip[0], tip[1], tip[2], 0.17],
    ], { sides: 9, along: 12, capStart: false });
    // The central lacteal: the lymph vessel up the middle of every villus that carries away
    // the fat. One pale core per villus, visible at the cut tip.
    if (i % 3 === 0) {
      vessel(parts, TISSUE.bileHi, [
        [x, 0.3, z, 0.08],
        [tip[0] * 0.7 + x * 0.3, height * 0.8, tip[2] * 0.7 + z * 0.3, 0.06],
      ], { sides: 6, along: 6, capStart: false, capEnd: false });
    }
  }

  return group(organMesh(parts, {
    tint: (p) => {
      const m = 0.95 + noise3(p.x * 3.1, p.y * 2.8, p.z * 3.1) * 0.08;
      return [m, m * 0.99, m * 0.98];
    },
    material: { roughness: 0.66 },
  }));
}

// ---------------------------------------------------------------------------
// Cells and molecules
// ---------------------------------------------------------------------------

// Red cells, white cells and platelets adrift in plasma. Everything floats: this prop hangs
// inside the artery tunnel and above the walkways, so its contents occupy the volume ABOVE
// its origin rather than resting on it.
//
// A red cell's biconcave dimple is a LatheGeometry profile rather than a squashed sphere,
// because the dimple is the functional detail -- it is what gives the cell the extra surface
// area and the flexibility to fold through a capillary narrower than itself.
export function bloodCells({ count = 16, radius = 7, height = 11, seed = 5 } = {}) {
  const rng = seededRandom(seed);
  const parts = [];

  const profile = [
    [0.02, -0.10],
    [0.36, -0.15],
    [0.64, -0.22],
    [0.86, -0.23],
    [1.00, 0.00],
    [0.86, 0.23],
    [0.64, 0.22],
    [0.36, 0.15],
    [0.02, 0.10],
  ].map(([x, y]) => new THREE.Vector2(x, y));

  for (let i = 0; i < count; i++) {
    const x = randomIn(rng, -radius, radius);
    const z = randomIn(rng, -radius, radius);
    const y = randomIn(rng, height * 0.3, height);
    const roll = [randomIn(rng, 0, Math.PI), randomIn(rng, 0, Math.PI), randomIn(rng, 0, Math.PI)];

    if (i % 7 === 3) {
      // A white cell, with the LOBED nucleus that is the whole difference between a
      // neutrophil and a ball. A plain sphere here reads as a bubble.
      const white = new THREE.SphereGeometry(randomIn(rng, 1.15, 1.5), 22, 14);
      parts.push({ geometry: white, position: [x, y, z], color: 0xe9eff3 });
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + i;
        knot(parts, 0xa88cc4, [
          x + Math.cos(a) * 0.42,
          y + Math.sin(a * 1.7) * 0.34,
          z + Math.sin(a) * 0.42,
        ], 0.40, 10);
      }
    } else if (i % 7 === 5) {
      // A platelet: a small irregular disc with pseudopodia, not a smooth chip.
      const plate = new THREE.SphereGeometry(0.52, 12, 8);
      plate.scale(1, 0.34, 1);
      parts.push({ geometry: plate, rotation: roll, position: [x, y, z], color: 0xe6cba8 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + i;
        vessel(parts, 0xe6cba8, [
          [x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2, 0.10],
          [x + Math.cos(a) * 0.7, y + 0.08, z + Math.sin(a) * 0.7, 0.04],
        ], { sides: 5, along: 4, capStart: false, capEnd: false });
      }
    } else {
      const cell = new THREE.LatheGeometry(profile, 26);
      cell.scale(1.5, 1.5, 1.5);
      parts.push({ geometry: cell, rotation: roll, position: [x, y, z], color: 0xba362c });
    }
  }

  return group(organMesh(parts, { material: { roughness: 0.5 } }));
}

// An animal cell with its organelles, CUT OPEN.
//
// The first pass wrapped it in a 22%-opacity membrane so the inside would show, and paid for
// that with two of this world's transparent draws and an exhibit that read as a bubble with
// confetti in it. Taking a wedge out instead means the interior is genuinely lit and
// genuinely visible, and the cut edge shows the membrane's own thickness -- which is a real
// thing about a cell membrane worth seeing.
export function cellModel({ radius = 6 } = {}) {
  const g = group();
  const centre = radius + 0.5;
  const rng = seededRandom(23);
  const parts = [];

  // The membrane, as a shell with a wedge removed. Its own thickness shows at the cut.
  const shellStations = [];
  for (let i = 0; i <= 12; i++) {
    const f = i / 12;
    const a = Math.PI * (0.06 + f * 0.88);
    const r = Math.sin(a) * radius;
    shellStations.push({ at: [0, centre - Math.cos(a) * radius, 0], pts: ringPts(Math.max(0.35, r), 16) });
  }
  // THE OPENING FACES +Z, which is where a student stands. Section fraction 0 is the +X
  // direction and 0.75 is +Z, so the covered range runs from just past +Z round the back and
  // returns just short of it -- and it has to wrap past 1, which shellLoft handles. Left
  // centred on u = 0 the wedge opened sideways, and the exhibit presented a smooth pale
  // blue ball to everybody who walked up to it.
  const shell = shellLoft(shellStations, {
    sides: 46,
    samples: 34,
    wall: 0.30,
    u0: 0.87,
    u1: 1.63,
    up: new THREE.Vector3(0, 0, 1),
  });
  parts.push({ geometry: shell.outer, color: 0x86c3d4 });
  parts.push({ geometry: shell.inner, color: 0xa9dcea });

  // Nucleus: envelope, nucleolus, and the PORES in the envelope -- the holes that everything
  // has to travel through, which is most of what a nuclear envelope is for.
  const nucR = radius * 0.36;
  const nucAt = [-radius * 0.12, centre + radius * 0.10, 0];
  const nucStations = [];
  for (let i = 0; i <= 10; i++) {
    const f = i / 10;
    const a = Math.PI * (0.08 + f * 0.84);
    nucStations.push({ at: [nucAt[0], nucAt[1] - Math.cos(a) * nucR, nucAt[2]], pts: ringPts(Math.max(0.2, Math.sin(a) * nucR), 14) });
  }
  const nucleus = shellLoft(nucStations, {
    sides: 34,
    samples: 26,
    wall: 0.18,
    u0: 0.90,
    u1: 1.60,
    up: new THREE.Vector3(0, 0, 1),
  });
  parts.push({ geometry: nucleus.outer, color: 0x8f6fbb });
  parts.push({ geometry: nucleus.inner, color: 0xb99ede });
  knot(parts, 0x5c3f86, [nucAt[0] + nucR * 0.15, nucAt[1] - nucR * 0.1, nucAt[2]], nucR * 0.34, 16);
  for (let i = 0; i < 22; i++) {
    const a = rng() * Math.PI * 2;
    const b = Math.acos(randomIn(rng, -0.75, 0.9));
    blister(parts, 0x6f4f9e, {
      at: [
        nucAt[0] + Math.sin(b) * Math.cos(a) * nucR,
        nucAt[1] + Math.cos(b) * nucR,
        nucAt[2] + Math.sin(b) * Math.sin(a) * nucR,
      ],
      radius: nucR * 0.10,
      detail: 7,
      sink: 1.1,
    });
  }

  // Mitochondria, with CRISTAE -- the folded inner membrane that multiplies the working
  // surface area. The folds ARE the organelle: a smooth capsule is just a capsule, and the
  // first pass had six of them.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + 0.4;
    const distance = radius * randomIn(rng, 0.46, 0.64);
    const len = radius * 0.34;
    const rr = radius * 0.085;
    const st = [];
    for (let k = 0; k <= 6; k++) {
      const f = k / 6;
      st.push({ at: [-len / 2 + f * len, 0, 0], pts: ringPts(rr * Math.sin(Math.PI * (0.16 + f * 0.68)) / 0.9, 12) });
    }
    const mito = organLoft(st, {
      sides: 26,
      samples: 30,
      capRise: [rr * 0.4, rr * 0.4],
      warp: (u, t) => (Math.sin(t * Math.PI * 2 * 9) * 0.5 + 0.5) * rr * 0.34,
      up: new THREE.Vector3(0, 1, 0),
    });
    mito.rotateZ(randomIn(rng, -1.1, 1.1));
    mito.rotateY(angle);
    parts.push({
      geometry: mito,
      position: [Math.cos(angle) * distance, centre + randomIn(rng, -0.5, 0.6) * radius * 0.6, Math.sin(angle) * distance],
      color: 0xd88a3c,
    });
  }

  // Golgi apparatus: a stack of flattened, slightly curved sacs, with vesicles budding off
  // the far face -- which is the one thing a Golgi body actually does.
  for (let i = 0; i < 5; i++) {
    const sac = new THREE.TorusGeometry(radius * (0.21 - i * 0.012), radius * 0.028, 8, 24, Math.PI * 1.15);
    sac.scale(1, 0.4, 1);
    parts.push({
      geometry: sac,
      rotation: [Math.PI / 2, 0.6, 0],
      position: [radius * 0.44, centre - radius * 0.34 + i * radius * 0.085, radius * 0.2],
      color: 0x46a08c,
    });
  }
  for (let i = 0; i < 6; i++) {
    knot(parts, 0x5fbba4, [
      radius * (0.52 + randomIn(rng, -0.06, 0.14)),
      centre - radius * (0.34 - randomIn(rng, -0.05, 0.42)),
      radius * (0.30 + randomIn(rng, -0.1, 0.16)),
    ], radius * randomIn(rng, 0.022, 0.042), 8);
  }

  // Rough endoplasmic reticulum: folded sheets round the nucleus, STUDDED with ribosomes.
  // "Rough" is literally what the ribosomes make it, so a smooth sheet is the wrong
  // organelle drawn under the right label.
  for (let i = 0; i < 3; i++) {
    const rad = radius * (0.46 + i * 0.06);
    const sheet = new THREE.TorusGeometry(rad, radius * 0.026, 8, 34, Math.PI * 1.3);
    sheet.scale(1, 0.55, 1);
    const rx = Math.PI / 2 + randomIn(rng, -0.3, 0.3);
    const ry = randomIn(rng, 0, Math.PI);
    const pos = [-radius * 0.1, centre + randomIn(rng, -0.2, 0.2) * radius, 0];
    parts.push({ geometry: sheet, rotation: [rx, ry, 0], position: pos, color: 0xd0728a });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 1.3;
      const local = new THREE.Vector3(Math.cos(a) * rad, 0, Math.sin(a) * rad);
      local.applyEuler(new THREE.Euler(rx, ry, 0, 'XYZ'));
      knot(parts, 0xf0d97a, [pos[0] + local.x, pos[1] + local.y * 0.55, pos[2] + local.z], radius * 0.020, 6);
    }
  }

  // Lysosomes and free ribosomes.
  for (let i = 0; i < 8; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = radius * randomIn(rng, 0.28, 0.66);
    knot(parts, 0xe0b24f, [
      Math.cos(angle) * distance,
      centre + randomIn(rng, -0.7, 0.7) * radius * 0.7,
      Math.sin(angle) * distance,
    ], radius * randomIn(rng, 0.035, 0.065), 10);
  }

  // Cytoskeleton: the filaments that hold all of this in place. Almost free, and without
  // them the organelles read as objects floating in a jar.
  for (let i = 0; i < 9; i++) {
    const a1 = rng() * Math.PI * 2;
    const a2 = a1 + randomIn(rng, 1.4, 4.6);
    const y1 = centre + randomIn(rng, -0.7, 0.7) * radius * 0.7;
    const y2 = centre + randomIn(rng, -0.7, 0.7) * radius * 0.7;
    vessel(parts, 0x9fd0dd, [
      [Math.cos(a1) * radius * 0.74, y1, Math.sin(a1) * radius * 0.74, 0.045],
      [Math.cos((a1 + a2) / 2) * radius * 0.3, (y1 + y2) / 2, Math.sin((a1 + a2) / 2) * radius * 0.3, 0.045],
      [Math.cos(a2) * radius * 0.74, y2, Math.sin(a2) * radius * 0.74, 0.045],
    ], { sides: 5, along: 8, capStart: false, capEnd: false });
  }

  const cell = organMesh(parts, {
    tint: (p) => {
      const m = 0.97 + noise3(p.x * 1.3, p.y * 1.2, p.z * 1.3) * 0.05;
      return [m, m, m];
    },
    material: { roughness: 0.5 },
  });
  cell.castShadow = false;
  g.add(cell);

  // A cradle ring, so a 12ft ball has something to sit in. Its radius comes from where the
  // sphere actually IS at the ring's height, not picked by eye -- set wider, the ball
  // appears to hover inside a hoop it never touches.
  const ringY = radius * 0.2;
  const ringRadius = Math.sqrt(Math.max(0.01, radius * radius - (centre - ringY) ** 2));
  const steel = standard({ color: STEEL, roughness: 0.45, metalness: 0.6 });
  const cradle = mesh(new THREE.TorusGeometry(ringRadius, 0.26, 10, 34), steel, 0, ringY, 0);
  cradle.rotation.x = Math.PI / 2;
  g.add(cradle);
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(cyl(0.16, 0.2, ringY, steel, Math.cos(angle) * ringRadius, ringY / 2, Math.sin(angle) * ringRadius, 10));
  }

  return g;
}

// A DNA double helix. Two sugar-phosphate backbones and the base pairs between them,
// coloured four ways -- the four-letter alphabet is the whole idea.
//
// The two backbones are NOT diametrically opposite, and that is the one structural fact the
// first pass got wrong. Offsetting them by about 140 degrees rather than 180 is what creates
// the MAJOR AND MINOR GROOVES -- the wide side and the narrow side of the spiral -- and
// those grooves are how every protein that reads DNA finds its way along it. Set opposite,
// the model is a symmetrical twisted ladder and no groove exists at all.
export function dnaHelix({ height = 22, turns = 3.2, radius = 2.2 } = {}) {
  const parts = [];
  const baseColors = [0x4fa3d1, 0xe0b84f, 0x62b565, 0xd15f5f];
  const steps = 108;
  const base = 1.2;
  const OFFSET = Math.PI * 0.78;

  for (const phase of [0, OFFSET]) {
    const nodes = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI * 2 * turns + phase;
      nodes.push([Math.cos(angle) * radius, base + t * (height - base), Math.sin(angle) * radius, 0.30]);
    }
    vessel(parts, 0xd3dae1, nodes, { sides: 12, along: 190 });
    // The sugar-phosphate repeat: one bead per base along each backbone, which is what makes
    // it read as a chain of units rather than as a smooth wire.
    const rungs = Math.round(turns * 10);
    for (let i = 0; i <= rungs; i++) {
      const t = i / rungs;
      const angle = t * Math.PI * 2 * turns + phase;
      knot(parts, 0xbcc6cf, [Math.cos(angle) * radius, base + t * (height - base), Math.sin(angle) * radius], 0.40, 10);
    }
  }

  // Base pairs as flat PLATES, which is what a base pair is -- two flat rings hydrogen
  // bonded edge to edge and stacked like coins up the middle of the helix. Round rods say
  // nothing about that.
  const rungs = Math.round(turns * 10);
  for (let i = 0; i <= rungs; i++) {
    const t = i / rungs;
    const a0 = t * Math.PI * 2 * turns;
    const a1 = a0 + OFFSET;
    const y = base + t * (height - base);
    const p0 = new THREE.Vector3(Math.cos(a0) * radius, y, Math.sin(a0) * radius);
    const p1 = new THREE.Vector3(Math.cos(a1) * radius, y, Math.sin(a1) * radius);
    const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    const pairColor = baseColors[i % 2 === 0 ? i % 4 : (i + 2) % 4];
    const partner = baseColors[(baseColors.indexOf(pairColor) + 1) % 4];
    const across = new THREE.Vector3().subVectors(p1, p0);
    const yaw = Math.atan2(across.x, across.z);

    for (const half of [0, 1]) {
      const from = half ? mid : p0;
      const to = half ? p1 : mid;
      const c = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
      const plate = new THREE.BoxGeometry(0.30, 0.16, from.distanceTo(to) * 0.94);
      plate.rotateY(yaw);
      parts.push({ geometry: plate, position: [c.x, c.y, c.z], color: half ? partner : pairColor });
    }
  }

  parts.push({
    geometry: new THREE.CylinderGeometry(radius * 1.5, radius * 1.65, 1.2, 34),
    position: [0, 0.6, 0],
    color: STEEL,
  });

  return group(organMesh(parts, { material: { roughness: 0.5, metalness: 0.2 } }));
}

// A single nerve cell stretched out to a length you can walk beside: dendrites gathering
// signals at one end, a myelinated axon carrying them, terminals handing them on.
//
// The NODES OF RANVIER are the point of the model and the first pass had none -- it laid
// overlapping capsules end to end, so there were no gaps for the signal to leap between.
// A myelinated axon is fast precisely because the sheath is INTERRUPTED: the impulse jumps
// from one bare node to the next instead of crawling along the whole membrane. So the
// sheath segments are separated here, and the axon is visibly narrower where it is bare.
export function neuronModel({ length = 24 } = {}) {
  const g = group();
  const parts = [];
  const rng = seededRandom(31);
  const axonY = 7.2;

  // The soma, with the dendrite roots swelling out of it. A dendrite that leaves a sphere at
  // its full thickness is a spike stuck into a ball; a real one flares where it joins.
  const somaStations = [];
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const a = Math.PI * (0.06 + f * 0.88);
    somaStations.push({ at: [0, axonY - Math.cos(a) * 1.72, 0], pts: ringPts(Math.max(0.22, Math.sin(a) * 1.72), 14) });
  }
  parts.push({
    geometry: organLoft(somaStations, {
      sides: 34,
      samples: 30,
      capRise: [0.3, 0.3],
      warp: (u, t) => -(Math.sin(u * Math.PI * 2 * 7) * 0.5 + 0.5) * Math.sin(t * Math.PI) * 0.24,
      up: new THREE.Vector3(0, 0, 1),
    }),
    color: 0xe0c48a,
  });
  knot(parts, 0xbf9a5c, [0.1, axonY + 0.1, 0.1], 0.68, 14);

  // Dendrites, each branching to a fork and carrying SPINES -- the little knobs where
  // synapses actually land. Tapered to a single point instead, they came out as needles and
  // the cell body read as a sea urchin.
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const reach = randomIn(rng, 2.8, 4.6);
    const lift = randomIn(rng, 0.4, 1.5);
    const tip = [Math.cos(angle) * reach - 2.4, axonY + lift, Math.sin(angle) * reach];
    const mid = [Math.cos(angle) * reach * 0.5 - 1.2, axonY + lift * 0.6, Math.sin(angle) * reach * 0.5];
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    vesselTree(parts, NERVE_CREAM, {
      chain: [[0, axonY, 0, 0.40], mid.concat(0.24), tip.concat(0.15)],
      kids: [-1, 1].map((fork) => ({
        chain: [
          tip.concat(0.14),
          [tip[0] + dirX * 0.6 - dirZ * fork * 0.5, tip[1] + fork * 0.25, tip[2] + dirZ * 0.6 + dirX * fork * 0.5, 0.10],
          [tip[0] + dirX * 1.15 - dirZ * fork * 1.15, tip[1] + fork * 0.62, tip[2] + dirZ * 1.15 + dirX * fork * 1.15, 0.07],
        ],
      })),
    }, { sides: 8, along: 14, detail: 8 });
    for (let k = 0; k < 5; k++) {
      const f = 0.25 + (k / 5) * 0.6;
      const a2 = rng() * Math.PI * 2;
      blister(parts, TISSUE.myelin, {
        at: [
          mid[0] + (tip[0] - mid[0]) * f + Math.cos(a2) * 0.16,
          mid[1] + (tip[1] - mid[1]) * f + Math.sin(a2) * 0.16,
          mid[2] + (tip[2] - mid[2]) * f,
        ],
        radius: 0.13,
        detail: 6,
        sink: 0.6,
      });
    }
  }

  // The axon, narrow and bare, with the myelin over it in separate segments.
  const axonEnd = length - 3.5;
  vessel(parts, 0xd6bf86, [
    [1.4, axonY, 0, 0.28],
    [axonEnd * 0.35, axonY + 0.3, 0, 0.25],
    [axonEnd * 0.7, axonY - 0.2, 0, 0.25],
    [axonEnd, axonY, 0, 0.23],
  ], { sides: 10, along: 46, capStart: false, capEnd: false });

  const sheaths = 7;
  const run = axonEnd - 4.4;
  for (let i = 0; i < sheaths; i++) {
    const x0 = 3.0 + (i / sheaths) * run;
    const len = run / sheaths - 0.62;
    // Nearly CYLINDRICAL with softened ends, not lens-shaped. A myelin segment is a sheet of
    // membrane wrapped many times round the axon, so its profile is a tube -- swept off a
    // sine the sheaths came out as a row of pale ellipsoids and the axon read as a string of
    // glass beads on a wire, which hides the very thing they are here to show.
    const st = [];
    for (let k = 0; k <= 6; k++) {
      const f = k / 6;
      const taper = f < 0.14 ? f / 0.14 : f > 0.86 ? (1 - f) / 0.14 : 1;
      st.push({
        at: [x0 + f * len, axonY + Math.sin(((x0 + f * len) / axonEnd) * 3) * 0.1, 0],
        pts: ringPts(0.30 + 0.22 * (0.35 + 0.65 * taper), 12),
      });
    }
    parts.push({
      geometry: organLoft(st, { sides: 22, samples: 16, capRise: [0.05, 0.05], up: new THREE.Vector3(0, 1, 0) }),
      color: 0xeee3c6,
    });
  }

  // Terminals, each ending in a BOUTON -- the swelling that holds the neurotransmitter.
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const tipX = axonEnd + 2.6;
    const tipY = axonY + Math.cos(angle) * 1.9;
    const tipZ = Math.sin(angle) * 1.9;
    vessel(parts, NERVE_CREAM, [
      [axonEnd, axonY, 0, 0.22],
      [axonEnd + 1.4, axonY + Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, 0.17],
      [tipX, tipY, tipZ, 0.13],
    ], { sides: 8, along: 12, capStart: false, capEnd: false });
    knot(parts, 0xc8a35e, [tipX, tipY, tipZ], 0.44, 12);
  }

  // A patch of the NEXT cell's membrane for the terminals to synapse onto. Without it the
  // boutons hand their signal to nothing, and "handed to the next cell at the tips" is a claim
  // the model should back up.
  //
  // A closed lens, not a partial sphere. A cut sphere is an open shell whose inside is back
  // faces, so with FrontSide it renders as a thin crescent of rim and nothing else -- which is
  // exactly how this looked, an odd hoop floating past the end of the axon.
  const target = new THREE.SphereGeometry(2.1, 30, 18);
  target.scale(0.26, 1, 1);
  parts.push({ geometry: target, position: [axonEnd + 3.4, axonY, 0], color: 0xcdb488 });

  for (const x of [0, axonEnd * 0.5, axonEnd + 1.6]) {
    standParts(parts, { top: axonY - 1.9, x, z: -1.4, plate: 1.3 });
  }

  g.add(organMesh(parts, {
    tint: (p) => {
      const m = 0.96 + noise3(p.x * 1.1, p.y * 2.0, p.z * 2.0) * 0.06;
      return [m, m, m * 0.99];
    },
    material: { roughness: 0.6 },
  }));
  return g;
}

// ---------------------------------------------------------------------------
// Walk-through structures
// ---------------------------------------------------------------------------

// A rib cage you walk up the inside of, spine along the top.
//
// Each rib pair is one tapered sweep rather than a torus arc, because a real rib is thick
// where it meets the spine and thin where it reaches the sternum, and that taper is most of
// what makes a pile of curved bars read as a rib cage.
//
// Two things the first pass left out, and the placard beside it promised both. It said the
// top seven pairs join the breastbone through FLEXIBLE CARTILAGE -- and there was no
// breastbone and no cartilage, so the ribs ended in mid-air on either side of an empty gap.
// The costal cartilages are blue-white here, which is what cartilage is and what every
// anatomical model colours it, so the join reads as a different material and not just as
// more rib.
export function ribCageArch({ span = 15, height = 13, pairs = 7, spacing = 3.4 } = {}) {
  const parts = [];
  const a = span / 2;
  const b = height;
  const depth = (pairs - 1) * spacing;

  for (let i = 0; i < pairs; i++) {
    const z = -depth / 2 + i * spacing;
    // Lower ribs are shorter and angle down more steeply, as they do in a real cage.
    const shrink = 1 - Math.abs(i - (pairs - 1) * 0.45) * 0.045;
    const nodes = [];
    const segments = 16;
    for (let s = 0; s <= segments; s++) {
      const angle = Math.PI * (0.05 + (s / segments) * 0.90);
      const edge = Math.abs(s / segments - 0.5) * 2;
      nodes.push([
        Math.cos(angle) * a * shrink,
        Math.sin(angle) * b * shrink,
        z + Math.sin(angle) * 0.8,
        0.22 + edge * 0.20,
      ]);
    }
    vessel(parts, BONE, nodes, { sides: 12, along: 52, capStart: true, capEnd: true });

    // Costal cartilage: from each rib's free end forward and IN to the sternum. Only the top
    // pairs reach it directly, which is why the run gets longer and shallower going down.
    if (i < pairs - 1) {
      // Each cartilage runs from its rib's free end inward and DOWN to the sternum on the
      // tunnel floor. Its far end has to actually arrive there: the first pass aimed them at
      // a fraction of the half-span and left them stopping in open air well short of the bone
      // they are named for joining.
      for (const end of [nodes[0], nodes[nodes.length - 1]]) {
        const inward = Math.sign(end[0]) || 1;
        vessel(parts, TISSUE.cartilage, [
          [end[0], end[1], end[2], 0.22],
          [end[0] * 0.56, end[1] * 0.58, end[2] + 0.34, 0.20],
          [inward * 0.60, 0.52, end[2] + 0.58, 0.18],
        ], { sides: 9, along: 14, capStart: false, capEnd: false });
      }
    }

    // A real vertebra: a drum-shaped body, a spinous process pointing back, and a pair of
    // transverse processes for the ribs to articulate with. Three boxes cannot say that, and
    // the spine is the one part of this structure a student walks directly under.
    // A vertebral BODY's axis runs along the spine, which in this tunnel is Z -- so the drum
    // is laid on its side. Left upright (CylinderGeometry's default) the column reads as a
    // stack of coins seen end on, with a flat lid on the top one.
    const vy = b * shrink + 0.5;
    parts.push({
      geometry: new THREE.CylinderGeometry(0.78, 0.78, spacing * 0.62, 18),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, vy, z],
      color: 0xdad0b6,
    });
    parts.push({
      geometry: new THREE.BoxGeometry(0.42, 0.62, 1.55),
      position: [0, vy + 0.85, z - 0.95],
      color: 0xcfc4a8,
    });
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.BoxGeometry(1.15, 0.34, 0.56),
        rotation: [0, 0, side * -0.25],
        position: [side * 0.86, vy + 0.52, z - 0.30],
        color: 0xcfc4a8,
      });
    }
    // Intervertebral disc: the pad between two vertebrae, and the thing people slip.
    if (i < pairs - 1) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.74, 0.74, spacing * 0.30, 18),
        rotation: [Math.PI / 2, 0, 0],
        position: [0, b * (1 - Math.abs(i + 0.5 - (pairs - 1) * 0.45) * 0.045) + 0.5, z + spacing / 2],
        color: 0xc0b394,
      });
    }
  }

  // The sternum: manubrium, body and xiphoid process -- three pieces, because it is three
  // pieces, and the joint between the top two is the notch you can feel on yourself.
  //
  // It runs ALONG THE FLOOR OF THE TUNNEL, and working that out is the whole trick. This cage
  // is a row of hoops spread along Z with the spine on top, so it is a rib cage lying on its
  // back -- which puts the breastbone opposite the spine, down the middle of the floor, with
  // every costal cartilage curving inward to meet it. The first pass placed it as one upright
  // slab at a single Z past the end of the cage, where it stood in mid-air twenty feet from
  // the nearest cartilage it was supposed to join.
  const runs = [
    [0.95, -depth / 2 - 0.4, -depth / 2 + spacing * 1.4],
    [0.80, -depth / 2 + spacing * 1.4, depth / 2 - spacing * 0.9],
    [0.48, depth / 2 - spacing * 0.9, depth / 2 + 0.6],
  ];
  for (const [w, z0, z1] of runs) {
    const len = z1 - z0;
    parts.push({
      geometry: chamferBoxBody(w * 2, len, 0.52, 0.12),
      rotation: [Math.PI / 2, 0, 0],
      position: [0, 0.34, (z0 + z1) / 2],
      color: 0xe2d8bf,
    });
  }

  return group(organMesh(parts, {
    tint: (p) => {
      const m = 0.96 + noise3(p.x * 1.4, p.y * 1.2, p.z * 1.4) * 0.06;
      return [m, m, m * 0.98];
    },
    material: { roughness: 0.72, ...relief('stone', { seed: 23, repeat: 7, strength: 0.3 }) },
  }));
}

// A box with its edges taken off, so bone does not read as joinery.
function chamferBoxBody(w, h, d, c) {
  const st = [];
  const steps = [0, c, h - c, h];
  const scale = [0.82, 1, 1, 0.82];
  for (let i = 0; i < 4; i++) {
    st.push({ at: [0, steps[i], 0], pts: ovalPts((w / 2) * scale[i], (d / 2) * scale[i], 12) });
  }
  const g = organLoft(st, { sides: 22, samples: 12, capRise: [0.04, 0.04], up: new THREE.Vector3(0, 0, 1) });
  g.translate(0, -h / 2, 0);
  return g;
}

function endotheliumTexture() {
  return canvasTexture(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#8e2f2b';
    ctx.fillRect(0, 0, w, h);
    const rng = seededRandom(97);

    // Endothelial cells: long, flat, aligned with the flow. Drawn as soft ellipses so they
    // read as a living lining rather than as tiling -- painted rectangles on a curved
    // surface read as literal floating panels, which is the trap the Mars dust devil hit.
    for (let i = 0; i < 220; i++) {
      const x = rng() * w;
      const y = rng() * h;
      const rx = randomIn(rng, 26, 54);
      const ry = randomIn(rng, 9, 17);
      const shade = Math.floor(randomIn(rng, 150, 200));
      ctx.fillStyle = `rgba(${shade}, ${Math.floor(shade * 0.42)}, ${Math.floor(shade * 0.4)}, 0.5)`;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, randomIn(rng, -0.16, 0.16), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,18,18,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

// The tunnel a miniaturised visitor walks through to get into the exhibition: a length of
// artery, lit from inside.
//
// The axis sits BELOW the tube's radius on purpose, so the ground plane cuts the tube well
// below its centre line. That leaves a wide opening at ground level with the vessel arching
// overhead -- which is walkable, whereas a tube centred at head height would put its floor
// underground and its walls in the student's face. PlayerController walks on the terrain,
// never on props, so there is no floor to stand on inside it either way.
//
// It is a SHELL with real thickness now, not a single-sided cylinder, and that is what makes
// the mouth teach something. An artery has three layers -- a slick endothelium, a thick
// muscular media, a tough outer coat -- and the only place they can be seen is the cut end.
// The first pass's mouth was a paper rim with no thickness at all, which is the one thing a
// vessel wall definitely is not.
export function arteryTunnel({ length = 30, radius = 6.5 } = {}) {
  const g = group();
  const axisY = radius * 0.45;
  const wall = radius * 0.13;

  const stations = [];
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    stations.push({ at: [0, axisY, -length / 2 + f * length], pts: ringPts(radius, 18) });
  }
  const shell = shellLoft(stations, {
    sides: 54,
    samples: 26,
    wall,
    u0: 0,
    u1: 1,
    up: new THREE.Vector3(0, 1, 0),
  });

  const outer = mesh(
    shell.outer,
    standard({ color: 0x7c2622, roughness: 0.72, ...relief('hide', { seed: 29, repeat: 6, strength: 0.3 }) })
  );
  outer.receiveShadow = false; // curved surface, near zero thickness -- pure shadow-map acne
  g.add(outer);

  const inner = mesh(
    shell.inner,
    standard({
      map: endotheliumTexture(),
      roughness: 0.5,
      emissive: new THREE.Color(0x3a1211),
      emissiveIntensity: 0.55,
    })
  );
  inner.receiveShadow = false;
  g.add(inner);

  // Bands of smooth muscle around the outside, which is what lets an artery squeeze.
  const bands = [];
  const count = Math.max(3, Math.round(length / 6));
  for (let i = 0; i <= count; i++) {
    const z = -length / 2 + (i / count) * length;
    const ring = new THREE.TorusGeometry(radius + wall * 0.4, 0.42, 8, 44);
    bands.push({ geometry: ring, position: [0, axisY, z], color: 0x6d221f });
  }
  const muscle = mergedMesh(bands, { roughness: 0.8 });
  muscle.receiveShadow = false;
  g.add(muscle);

  return g;
}

// ---------------------------------------------------------------------------
// The micro-sub
// ---------------------------------------------------------------------------

// The world's premise, parked at the entrance: a 1966 film imagined a submarine and its crew
// shrunk small enough to be injected into a patient. The placard beside it in the layout is
// where the real version of the idea lives -- swallowable pill cameras, which have been in
// hospital use since 2001.
//
// The hull is a LOFT rather than a capsule, so it can have a fine bow, a full midsection and
// a tapered run to the thruster the way a submarine does. A capsule is the same radius from
// end to end, which is a pill -- accidentally apt and not what this needs to look like.
export function microSub({ length = 12 } = {}) {
  const g = group();
  const hullY = 3.4;
  const parts = [];
  const R = 1.72;

  const hullProfile = [
    [-0.50, 0.13],
    [-0.44, 0.52],
    [-0.34, 0.78],
    [-0.16, 0.96],
    [0.06, 1.00],
    [0.24, 0.97],
    [0.38, 0.84],
    [0.47, 0.56],
    [0.50, 0.20],
  ];
  const hullStations = hullProfile.map(([f, s]) => ({
    at: [0, hullY, f * length],
    pts: ringPts(R * s, 14),
  }));
  parts.push({
    geometry: organLoft(hullStations, {
      sides: 40,
      samples: 46,
      capRise: [R * 0.22, R * 0.30],
      // Plating seams along the hull -- a smooth pod has no scale, and a row of seams is the
      // cheapest way to say "this is built out of panels".
      warp: (u, t) => grooveAt(((t * 7) % 1) - 0.5, 0.06, 0.035),
      up: new THREE.Vector3(0, 1, 0),
    }),
    color: 0xd8dde2,
  });

  const trim = 0x3f8ba3;

  // The conning tower, FAIRED into the hull: its base sections are wider and sunk into the
  // deck so it grows out of the hull instead of being parked on it.
  const sailStations = [];
  for (let i = 0; i <= 5; i++) {
    const f = i / 5;
    const w = 0.72 - f * 0.10;
    const d = 1.62 - f * 0.28;
    sailStations.push({ at: [0, hullY + 0.55 + f * 1.5, 0.6 + f * 0.12], pts: ovalPts(w, d, 12) });
  }
  parts.push({
    geometry: organLoft(sailStations, { sides: 26, samples: 20, capRise: [0, 0.22], up: new THREE.Vector3(0, 0, 1) }),
    color: trim,
  });
  parts.push({
    geometry: new THREE.CylinderGeometry(0.08, 0.08, 1.9, 8),
    position: [0, hullY + 3.15, -0.3],
    color: TISSUE.chrome,
  });

  // Dive planes and rudder, as tapered foils rather than boxes.
  for (const [rz, px, py] of [
    [0, 0, hullY + 1.85],
    [Math.PI / 2, 1.72, hullY],
    [Math.PI / 2, -1.72, hullY],
  ]) {
    const foil = [];
    for (let i = 0; i <= 4; i++) {
      const f = i / 4;
      foil.push({ at: [0, 0, -1.25 + f * 2.5], pts: ovalPts(0.16 * (1 - f * 0.35), 0.86 * (1 - f * 0.42), 10) });
    }
    const fin = organLoft(foil, { sides: 18, samples: 12, capRise: [0.05, 0.05], up: new THREE.Vector3(0, 1, 0) });
    parts.push({ geometry: fin, rotation: [0, 0, rz], position: [px, py, -length * 0.3], color: trim });
  }

  // Portholes, each in a RECESS in the hull -- a ring stuck on the outside reads as a washer
  // glued to the flank.
  for (const side of [-1, 1]) {
    for (const z of [2.0, 0.4, -1.2]) {
      const ring = new THREE.TorusGeometry(0.34, 0.09, 8, 18);
      ring.rotateY((side * Math.PI) / 2);
      parts.push({ geometry: ring, position: [side * 1.58, hullY + 0.3, z], color: trim });
      const glass = new THREE.CylinderGeometry(0.3, 0.3, 0.10, 16);
      glass.rotateZ(Math.PI / 2);
      parts.push({ geometry: glass, position: [side * 1.58, hullY + 0.3, z], color: 0xbfe4f2 });
    }
  }

  // Ducted thruster. Kept slim and pale on purpose: at the first size and colour tried, a fat
  // near-black ring read as a tyre bolted to the back of the sub and dominated the silhouette.
  const shroud = new THREE.TorusGeometry(1.15, 0.2, 10, 30);
  parts.push({ geometry: shroud, position: [0, hullY, -length / 2 + 0.4], color: 0x8c96a1 });
  for (let i = 0; i < 5; i++) {
    const blade = [];
    for (let k = 0; k <= 3; k++) {
      const f = k / 3;
      blade.push({ at: [0, f * 1.9, 0], pts: ovalPts(0.07 * (1 - f * 0.3), 0.30 - f * 0.06, 8) });
    }
    const b = organLoft(blade, { sides: 14, samples: 8, capRise: [0.02, 0.02], up: new THREE.Vector3(0, 0, 1) });
    b.rotateX(0.42);
    b.rotateZ((i / 5) * Math.PI * 2);
    parts.push({ geometry: b, position: [0, hullY, -length / 2 + 0.4], color: 0xb9c2ca });
  }

  // Cradle: two A-frames, so the sub reads as parked and serviced rather than as a vehicle
  // that happens to be hovering.
  for (const z of [-length * 0.26, length * 0.26]) {
    for (const side of [-1, 1]) {
      parts.push({
        geometry: new THREE.CylinderGeometry(0.16, 0.2, hullY + 0.4, 10),
        rotation: [0, 0, side * 0.28],
        position: [side * (hullY * 0.22), (hullY + 0.4) / 2, z],
        color: STEEL,
      });
    }
    parts.push({ geometry: new THREE.BoxGeometry(4.4, 0.3, 0.9), position: [0, 0.15, z], color: STEEL });
  }

  g.add(organMesh(parts, {
    material: { roughness: 0.45, metalness: 0.5, ...relief('metal', { seed: 29, repeat: 4, strength: 0.2 }) },
  }));

  // Canopy: a bubble on the FRONT of the sail, where it clears the hull. Sunk into the hull
  // line -- which is where it started -- a canopy the width of the hull is simply inside it
  // and renders as nothing at all.
  const canopy = mesh(
    new THREE.SphereGeometry(1.18, 26, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    standard({
      color: 0x9fd8e6,
      transparent: true,
      opacity: 0.58,
      roughness: 0.12,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x2b6577),
      emissiveIntensity: 0.7,
    }),
    0,
    hullY + 1.30,
    2.35
  );
  canopy.castShadow = false;
  g.add(canopy);

  // Navigation lights, low and forward on the flanks -- port red, starboard green, the real
  // convention. At the size and height first tried they read as ears.
  for (const side of [-1, 1]) {
    const lamp = mesh(
      new THREE.SphereGeometry(0.24, 12, 10),
      standard({
        color: 0xfff6da,
        emissive: new THREE.Color(side > 0 ? 0x62e0a0 : 0xe06262),
        emissiveIntensity: 2.4,
        roughness: 0.4,
      }),
      side * 1.0,
      hullY - 0.75,
      length / 2 - 1.9
    );
    lamp.userData.isGlowMesh = true;
    g.add(lamp);
  }

  // On both flanks, and emissive: one flank always faces away from the sun, and a flat unlit
  // panel renders as a black slab rather than as a dark one.
  const nameTexture = canvasTexture(640, 108, (ctx, w, h) => {
    ctx.fillStyle = '#e7ebee';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1e4a58';
    ctx.textAlign = 'center';
    ctx.font = 'bold 54px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('MICRO-SUB  MV-1', w / 2, 74);
  });
  for (const side of [-1, 1]) {
    const name = signPanel(2.7, 0.45, nameTexture, { emissive: '#5a6a74' });
    name.position.set(side * 1.70, hullY + 1.05, -0.5);
    name.rotation.y = (side * Math.PI) / 2;
    g.add(name);
  }

  return g;
}

// ---------------------------------------------------------------------------
// The anatomy charts -- where whole SYSTEMS are taught
// ---------------------------------------------------------------------------

const CHART_W = 768;
const CHART_H = 1024;

// The silhouette every system chart is drawn onto, in its own coordinate space: origin
// at the centre of the head-top, 840 units tall, +x to the viewer's right. Callers work
// in that space via withBody(), so an organ drawn at (-40, 430) lands in the same place
// on every chart it appears on.
function bodyOutline(ctx, { fill = '#efdfd5', stroke = '#b1907f' } = {}) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.ellipse(0, 78, 60, 76, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-28, 138);
  ctx.lineTo(-30, 176);
  ctx.quadraticCurveTo(-118, 194, -132, 250);
  ctx.lineTo(-174, 470);
  ctx.lineTo(-192, 640);
  ctx.lineTo(-156, 648);
  ctx.lineTo(-134, 474);
  ctx.lineTo(-108, 302);
  ctx.quadraticCurveTo(-102, 400, -96, 468);
  ctx.quadraticCurveTo(-118, 520, -110, 582);
  ctx.lineTo(-94, 830);
  ctx.lineTo(-30, 830);
  ctx.lineTo(-22, 600);
  ctx.lineTo(0, 556);
  ctx.lineTo(22, 600);
  ctx.lineTo(30, 830);
  ctx.lineTo(94, 830);
  ctx.lineTo(110, 582);
  ctx.quadraticCurveTo(118, 520, 96, 468);
  ctx.quadraticCurveTo(102, 400, 108, 302);
  ctx.lineTo(134, 474);
  ctx.lineTo(156, 648);
  ctx.lineTo(192, 640);
  ctx.lineTo(174, 470);
  ctx.lineTo(132, 250);
  ctx.quadraticCurveTo(118, 194, 30, 176);
  ctx.lineTo(28, 138);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

// Runs `draw` inside the silhouette's coordinate space and hands back a mapper so the
// caller can put a label leader on a canvas-space point that lines up with a body-space
// one.
function withBody(ctx, cx, top, height, draw) {
  const s = height / 840;
  ctx.save();
  ctx.translate(cx, top);
  ctx.scale(s, s);
  draw(ctx);
  ctx.restore();
  return (bx, by) => [cx + bx * s, top + by * s];
}

function fillPath(ctx, fill, stroke, build) {
  ctx.beginPath();
  build(ctx);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// --- Organ shapes, all in body space ---------------------------------------

function shapeLungs(ctx) {
  ctx.strokeStyle = '#bfae83';
  ctx.lineCap = 'round';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(0, 186);
  ctx.lineTo(0, 262);
  ctx.stroke();
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(0, 262);
  ctx.lineTo(-34, 296);
  ctx.moveTo(0, 262);
  ctx.lineTo(34, 296);
  ctx.stroke();

  for (const side of [-1, 1]) {
    fillPath(ctx, '#e0989c', '#a3666a', (c) => {
      c.moveTo(side * 14, 258);
      c.bezierCurveTo(side * 66, 252, side * 84, 320, side * 74, 386);
      c.bezierCurveTo(side * 66, 428, side * 34, 424, side * 20, 388);
      c.bezierCurveTo(side * 14, 340, side * 14, 300, side * 14, 258);
      c.closePath();
    });
    // Fissures: three lobes on the body's right (-x), two on the left.
    ctx.strokeStyle = '#a3666a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(side * 18, 316);
    ctx.lineTo(side * 78, 342);
    if (side < 0) {
      ctx.moveTo(side * 22, 356);
      ctx.lineTo(side * 74, 350);
    }
    ctx.stroke();
  }
}

function shapeHeart(ctx) {
  fillPath(ctx, '#b8362f', '#7d211c', (c) => {
    c.moveTo(6, 300);
    c.bezierCurveTo(38, 288, 56, 322, 44, 352);
    c.bezierCurveTo(36, 374, 18, 392, 4, 404);
    c.bezierCurveTo(-12, 388, -28, 366, -30, 342);
    c.bezierCurveTo(-32, 314, -14, 290, 6, 300);
    c.closePath();
  });
  ctx.strokeStyle = '#7d211c';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(2, 300);
  ctx.quadraticCurveTo(-6, 268, -26, 268);
  ctx.stroke();
}

function shapeLiver(ctx) {
  fillPath(ctx, '#8e4034', '#5f2820', (c) => {
    c.moveTo(-104, 408);
    c.quadraticCurveTo(-30, 396, 30, 412);
    c.quadraticCurveTo(46, 432, 22, 452);
    c.quadraticCurveTo(-40, 474, -96, 454);
    c.quadraticCurveTo(-110, 434, -104, 408);
    c.closePath();
  });
  fillPath(ctx, '#6e8a45', '#4a5f2c', (c) => {
    c.ellipse(-40, 458, 14, 9, 0.1, 0, Math.PI * 2);
  });
}

function shapeStomach(ctx) {
  fillPath(ctx, '#d4837a', '#9a5750', (c) => {
    c.moveTo(20, 400);
    c.bezierCurveTo(74, 396, 96, 440, 82, 476);
    c.bezierCurveTo(70, 506, 30, 512, 14, 492);
    c.bezierCurveTo(26, 486, 46, 480, 52, 462);
    c.bezierCurveTo(60, 436, 44, 416, 20, 400);
    c.closePath();
  });
  ctx.strokeStyle = '#9a5750';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(22, 400);
  ctx.quadraticCurveTo(14, 350, 8, 300);
  ctx.stroke();
}

function shapeIntestines(ctx) {
  ctx.strokeStyle = '#a7603f';
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-62, 570);
  ctx.lineTo(-62, 500);
  ctx.quadraticCurveTo(-62, 486, -46, 486);
  ctx.lineTo(46, 486);
  ctx.quadraticCurveTo(62, 486, 62, 502);
  ctx.lineTo(62, 566);
  ctx.stroke();

  // The small intestine, serpentined inside the colon's frame. The row count and the
  // vertical span are both fixed on purpose: driven by a per-loop increment instead, the
  // coil ran off the bottom of the abdomen and down between the figure's legs.
  ctx.strokeStyle = '#d0836f';
  ctx.lineWidth = 11;
  ctx.beginPath();
  const top = 500;
  const rows = 4;
  const step = 14;
  let x = -36;
  ctx.moveTo(x, top);
  for (let i = 0; i < rows; i++) {
    const y0 = top + i * step;
    const y1 = y0 + step;
    const nx = -x;
    ctx.bezierCurveTo(x * 1.8, y0 + step * 0.4, nx * 1.8, y1 - step * 0.4, nx, y1);
    x = nx;
  }
  ctx.stroke();
}

function shapeKidneys(ctx) {
  for (const side of [-1, 1]) {
    const y = side < 0 ? 446 : 434;
    fillPath(ctx, '#9d4a3b', '#68291f', (c) => {
      c.moveTo(side * 46, y - 26);
      c.bezierCurveTo(side * 74, y - 22, side * 74, y + 22, side * 46, y + 26);
      c.bezierCurveTo(side * 56, y + 12, side * 56, y - 12, side * 46, y - 26);
      c.closePath();
    });
    ctx.strokeStyle = '#e0cfa4';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(side * 50, y + 16);
    ctx.quadraticCurveTo(side * 40, y + 60, side * 18, 552);
    ctx.stroke();
  }
  fillPath(ctx, '#d8c98a', '#9b8b4b', (c) => {
    c.ellipse(0, 566, 26, 20, 0, 0, Math.PI * 2);
  });
}

function shapeBrain(ctx) {
  fillPath(ctx, '#d7a9a2', '#9c7069', (c) => {
    c.ellipse(0, 62, 46, 44, 0, 0, Math.PI * 2);
  });
  ctx.strokeStyle = '#9c7069';
  ctx.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-42, 40 + i * 11);
    ctx.bezierCurveTo(-16, 30 + i * 11, 16, 52 + i * 11, 42, 40 + i * 11);
    ctx.stroke();
  }
  fillPath(ctx, '#be8a80', '#8f5f57', (c) => {
    c.ellipse(0, 116, 26, 15, 0, 0, Math.PI * 2);
  });
}

// --- Chart drawers ---------------------------------------------------------

function chartFrame(ctx, title, caption) {
  ctx.fillStyle = CHART_PAPER;
  ctx.fillRect(0, 0, CHART_W, CHART_H);
  ctx.fillStyle = CHART_TEAL;
  ctx.fillRect(18, 18, CHART_W - 36, 96);
  ctx.strokeStyle = CHART_TEAL;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, CHART_W - 36, CHART_H - 36);

  ctx.textAlign = 'center';
  ctx.fillStyle = CHART_PAPER;
  ctx.font = 'bold 52px Georgia, "Times New Roman", serif';
  ctx.fillText(String(title).toUpperCase(), CHART_W / 2, 84);

  // The caption block starts high enough for six wrapped lines to land inside the frame.
  // Set to a comfortable-looking 25px starting near the bottom, every caption longer
  // than about three lines simply ran off the panel and the last sentence was lost.
  if (caption) {
    ctx.textAlign = 'left';
    ctx.fillStyle = CHART_INK;
    ctx.font = '22px Georgia, "Times New Roman", serif';
    wrapText(ctx, caption, 54, 858, CHART_W - 108, 28);
  }
  ctx.textAlign = 'left';
}

function leader(ctx, from, to, text, align = 'left') {
  ctx.strokeStyle = CHART_INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
  ctx.fillStyle = CHART_INK;
  ctx.beginPath();
  ctx.arc(from[0], from[1], 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = align;
  ctx.font = 'bold 23px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(text, to[0] + (align === 'left' ? 10 : -10), to[1] + 8);
}

const CHART_DRAWERS = {
  // The whole-body map: this is the chart the world is built around, and the one that
  // answers "where is the thing I just walked around, and what is it next to?"
  'body-systems': (ctx) => {
    chartFrame(
      ctx,
      'The organ systems',
      'Ten or so systems share one body, and they overlap: the same blood the heart pumps is cleaned by the kidneys, loaded with oxygen by the lungs and fed by the gut. Left and right on this chart are the BODY’S left and right — so its right lung is on your left.'
    );
    const map = withBody(ctx, 300, 150, 700, (c) => {
      bodyOutline(c);
      shapeBrain(c);
      shapeLungs(c);
      shapeHeart(c);
      shapeLiver(c);
      shapeStomach(c);
      shapeKidneys(c);
      shapeIntestines(c);
    });

    leader(ctx, map(0, 62), [560, 210], 'Brain');
    leader(ctx, map(-60, 320), [110, 300], 'Lungs', 'right');
    leader(ctx, map(20, 340), [560, 330], 'Heart');
    leader(ctx, map(-70, 430), [110, 430], 'Liver', 'right');
    leader(ctx, map(60, 452), [560, 430], 'Stomach');
    leader(ctx, map(56, 434), [560, 500], 'Kidneys');
    leader(ctx, map(0, 530), [560, 580], 'Intestines');
    leader(ctx, map(0, 566), [560, 650], 'Bladder');
  },

  respiratory: (ctx) => {
    chartFrame(
      ctx,
      'Respiratory system',
      'Air travels nose → trachea → bronchi → bronchioles → alveoli. Only in the alveoli does anything actually cross into the blood. You do this about 20,000 times a day without deciding to.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      shapeLungs(c);
    });
    leader(ctx, map(0, 210), [590, 250], 'Trachea (windpipe)');
    leader(ctx, map(-30, 292), [130, 330], 'Bronchi', 'right');
    leader(ctx, map(-60, 300), [590, 330], 'Right lung — 3 lobes');
    leader(ctx, map(60, 300), [590, 400], 'Left lung — 2 lobes');
    leader(ctx, map(0, 420), [590, 470], 'Diaphragm pulls down');
  },

  circulatory: (ctx) => {
    chartFrame(
      ctx,
      'Circulatory system',
      'One pump, two circuits: the right side of the heart sends blood to the lungs for oxygen, the left side sends it to everything else. End to end, one person’s blood vessels would run about 60,000 miles — twice around the Earth.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      c.lineCap = 'round';
      // Arteries out, veins back.
      c.strokeStyle = '#c0392b';
      c.lineWidth = 7;
      c.beginPath();
      c.moveTo(-8, 320);
      c.quadraticCurveTo(-16, 200, -12, 120);
      c.moveTo(-8, 330);
      c.quadraticCurveTo(-70, 340, -140, 420);
      c.moveTo(8, 330);
      c.quadraticCurveTo(70, 340, 140, 420);
      c.moveTo(0, 380);
      c.quadraticCurveTo(-6, 520, -50, 700);
      c.moveTo(4, 380);
      c.quadraticCurveTo(10, 520, 52, 700);
      c.stroke();
      c.strokeStyle = '#40598f';
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(16, 320);
      c.quadraticCurveTo(24, 200, 18, 124);
      c.moveTo(-18, 340);
      c.quadraticCurveTo(-80, 356, -150, 430);
      c.moveTo(18, 340);
      c.quadraticCurveTo(80, 356, 150, 430);
      c.moveTo(-14, 390);
      c.quadraticCurveTo(-20, 524, -62, 700);
      c.moveTo(18, 390);
      c.quadraticCurveTo(26, 524, 64, 700);
      c.stroke();
      shapeLungs(c);
      shapeHeart(c);
    });
    leader(ctx, map(8, 348), [600, 300], 'Heart');
    leader(ctx, map(-60, 320), [140, 300], 'Lungs', 'right');
    leader(ctx, map(-70, 500), [140, 520], 'Arteries (red)', 'right');
    leader(ctx, map(70, 520), [600, 540], 'Veins (blue)');
  },

  digestive: (ctx) => {
    chartFrame(
      ctx,
      'Digestive system',
      'A single tube about 30 feet long, from mouth to end. The stomach mostly churns and acidifies; nearly all the ABSORBING happens further down, in the small intestine, through millions of tiny finger-shaped villi.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      shapeIntestines(c);
      shapeLiver(c);
      shapeStomach(c);
    });
    leader(ctx, map(10, 300), [600, 280], 'Oesophagus');
    leader(ctx, map(56, 452), [600, 360], 'Stomach');
    leader(ctx, map(-80, 430), [130, 400], 'Liver', 'right');
    leader(ctx, map(-40, 458), [130, 470], 'Gall bladder', 'right');
    leader(ctx, map(0, 540), [600, 470], 'Small intestine');
    leader(ctx, map(-62, 520), [130, 560], 'Large intestine', 'right');
  },

  urinary: (ctx) => {
    chartFrame(
      ctx,
      'Urinary system',
      'The kidneys filter roughly 180 litres of fluid out of your blood every day — and put about 99% of it straight back. What is left, around 1.5 litres, runs down the ureters to the bladder.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      shapeKidneys(c);
    });
    leader(ctx, map(-58, 446), [130, 400], 'Right kidney (sits lower)', 'right');
    leader(ctx, map(58, 434), [600, 380], 'Left kidney');
    leader(ctx, map(34, 500), [600, 470], 'Ureter');
    leader(ctx, map(0, 566), [600, 560], 'Bladder');
  },

  nervous: (ctx) => {
    chartFrame(
      ctx,
      'Nervous system',
      'The brain is about 2% of your body weight and uses about 20% of your oxygen. Signals travel along nerves at up to 120 metres per second — roughly 270 miles per hour.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      c.strokeStyle = '#c9a227';
      c.lineWidth = 7;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(0, 130);
      c.lineTo(0, 470);
      c.stroke();
      c.lineWidth = 4;
      c.beginPath();
      for (let i = 0; i < 9; i++) {
        const y = 200 + i * 30;
        c.moveTo(0, y);
        c.quadraticCurveTo(-60, y + 10, -120, y + 60);
        c.moveTo(0, y);
        c.quadraticCurveTo(60, y + 10, 120, y + 60);
      }
      c.moveTo(0, 470);
      c.quadraticCurveTo(-24, 600, -60, 800);
      c.moveTo(0, 470);
      c.quadraticCurveTo(24, 600, 60, 800);
      c.stroke();
      shapeBrain(c);
    });
    leader(ctx, map(0, 62), [600, 230], 'Brain');
    leader(ctx, map(0, 116), [130, 300], 'Cerebellum', 'right');
    leader(ctx, map(0, 380), [600, 420], 'Spinal cord');
    leader(ctx, map(80, 560), [600, 560], 'Nerves');
  },

  skeletal: (ctx) => {
    chartFrame(
      ctx,
      'Skeletal system',
      'An adult has 206 bones; a newborn has around 300, and some of them fuse together as you grow. Bone is living tissue — it is being broken down and rebuilt inside you right now.'
    );
    const map = withBody(ctx, 320, 170, 660, (c) => {
      bodyOutline(c, { fill: '#f1e6de', stroke: '#c0a595' });
      c.fillStyle = '#e4dbc4';
      c.strokeStyle = '#9a8f74';
      c.lineWidth = 3;

      // Skull, jaw, spine, ribs, pelvis, limb bones.
      c.beginPath();
      c.ellipse(0, 74, 46, 54, 0, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      for (let i = 0; i < 14; i++) {
        c.beginPath();
        c.rect(-11, 180 + i * 26, 22, 18);
        c.fill();
        c.stroke();
      }

      for (let i = 0; i < 7; i++) {
        const y = 236 + i * 30;
        for (const side of [-1, 1]) {
          c.beginPath();
          c.moveTo(side * 8, y);
          c.quadraticCurveTo(side * (86 + i * 3), y + 12, side * 30, y + 76);
          c.lineWidth = 7;
          c.strokeStyle = '#d7cdb2';
          c.stroke();
        }
      }
      c.lineWidth = 3;
      c.strokeStyle = '#9a8f74';

      c.beginPath();
      c.moveTo(-72, 540);
      c.quadraticCurveTo(0, 512, 72, 540);
      c.quadraticCurveTo(60, 610, 20, 600);
      c.quadraticCurveTo(0, 570, -20, 600);
      c.quadraticCurveTo(-60, 610, -72, 540);
      c.closePath();
      c.fill();
      c.stroke();

      for (const side of [-1, 1]) {
        c.lineWidth = 15;
        c.strokeStyle = '#e4dbc4';
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(side * 116, 250);
        c.lineTo(side * 152, 460);
        c.moveTo(side * 152, 470);
        c.lineTo(side * 176, 626);
        c.moveTo(side * 46, 590);
        c.lineTo(side * 60, 720);
        c.moveTo(side * 60, 732);
        c.lineTo(side * 62, 820);
        c.stroke();
      }
      c.lineWidth = 3;
    });
    leader(ctx, map(0, 74), [600, 230], 'Skull');
    leader(ctx, map(0, 330), [130, 330], 'Spine — 33 vertebrae', 'right');
    leader(ctx, map(60, 300), [600, 330], 'Rib cage — 12 pairs');
    leader(ctx, map(0, 545), [600, 520], 'Pelvis');
    leader(ctx, map(60, 700), [600, 660], 'Femur — longest bone');
  },

  cell: (ctx) => {
    chartFrame(
      ctx,
      'The animal cell',
      'You are built from roughly 37 trillion of these. Every one carries the same instruction book — about two metres of DNA, coiled up inside a nucleus a hundredth of a millimetre across.'
    );
    const cx = 330;
    const cy = 480;
    const r = 250;

    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#dceff4';
    ctx.fill();
    ctx.strokeStyle = '#2f5d6b';
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx - 30, cy - 20, 86, 0, Math.PI * 2);
    ctx.fillStyle = '#b9a3d6';
    ctx.fill();
    ctx.strokeStyle = '#6b4f96';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 46, cy - 34, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#7f5fae';
    ctx.fill();

    const rng = seededRandom(41);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + 0.5;
      const x = cx + Math.cos(angle) * r * 0.62;
      const y = cy + Math.sin(angle) * r * 0.54;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(randomIn(rng, -1, 1));
      ctx.beginPath();
      ctx.ellipse(0, 0, 44, 19, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d88a3c';
      ctx.fill();
      ctx.strokeStyle = '#96591f';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      for (let k = -3; k <= 3; k++) {
        ctx.moveTo(k * 11, -14);
        ctx.quadraticCurveTo(k * 11 + 8, 0, k * 11, 14);
      }
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(cx + 150, cy + 110 + i * 20, 62 - i * 6, 12, 0.12, 0, Math.PI);
      ctx.strokeStyle = '#46a08c';
      ctx.lineWidth = 9;
      ctx.stroke();
    }

    leader(ctx, [cx - 30, cy - 20], [600, 300], 'Nucleus');
    leader(ctx, [cx + 110, cy - 130], [600, 370], 'Mitochondria');
    leader(ctx, [cx + 150, cy + 130], [600, 640], 'Golgi apparatus');
    leader(ctx, [cx - r + 20, cy + 90], [110, 700], 'Cell membrane', 'right');
  },

  'kidney-section': (ctx) => {
    chartFrame(
      ctx,
      'Inside a kidney',
      'Each kidney holds about a million nephrons — microscopic filters. Blood arrives under pressure, water and waste are squeezed out in the cortex, and what the body still needs is reabsorbed on the way back through.'
    );
    const cx = 320;
    const cy = 470;

    ctx.beginPath();
    ctx.moveTo(cx + 96, cy - 210);
    ctx.bezierCurveTo(cx + 250, cy - 180, cx + 250, cy + 180, cx + 96, cy + 210);
    ctx.bezierCurveTo(cx + 150, cy + 90, cx + 150, cy - 90, cx + 96, cy - 210);
    ctx.closePath();
    ctx.fillStyle = '#c4675a';
    ctx.fill();
    ctx.strokeStyle = '#68291f';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx + 96, cy - 210);
    ctx.bezierCurveTo(cx + 250, cy - 180, cx + 250, cy + 180, cx + 96, cy + 210);
    ctx.bezierCurveTo(cx + 150, cy + 90, cx + 150, cy - 90, cx + 96, cy - 210);
    ctx.closePath();
    ctx.clip();

    // Medulla pyramids, pointing in toward the pelvis.
    for (let i = 0; i < 5; i++) {
      const angle = -1.0 + i * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx + 118, cy + Math.sin(angle) * 150);
      ctx.lineTo(cx + 232, cy + Math.sin(angle) * 190 - 46);
      ctx.lineTo(cx + 232, cy + Math.sin(angle) * 190 + 46);
      ctx.closePath();
      ctx.fillStyle = '#9d4a3b';
      ctx.fill();
      ctx.strokeStyle = '#6d2b20';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.restore();

    // Renal pelvis and the ureter leaving it.
    ctx.beginPath();
    ctx.moveTo(cx + 116, cy - 90);
    ctx.quadraticCurveTo(cx + 60, cy, cx + 116, cy + 90);
    ctx.quadraticCurveTo(cx + 140, cy, cx + 116, cy - 90);
    ctx.closePath();
    ctx.fillStyle = '#e6d7ab';
    ctx.fill();
    ctx.strokeStyle = '#9b8b4b';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.strokeStyle = '#e6d7ab';
    ctx.lineWidth = 20;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 100, cy + 40);
    ctx.quadraticCurveTo(cx + 30, cy + 130, cx + 40, cy + 250);
    ctx.stroke();

    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(cx + 108, cy - 40);
    ctx.lineTo(cx - 10, cy - 70);
    ctx.stroke();
    ctx.strokeStyle = '#40598f';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(cx + 110, cy);
    ctx.lineTo(cx - 10, cy + 20);
    ctx.stroke();

    leader(ctx, [cx + 236, cy - 150], [612, 260], 'Cortex — filtering happens here');
    leader(ctx, [cx + 200, cy + 40], [612, 420], 'Medulla pyramids');
    leader(ctx, [cx + 116, cy], [612, 520], 'Renal pelvis');
    leader(ctx, [cx - 10, cy - 70], [120, 300], 'Renal artery in', 'right');
    leader(ctx, [cx - 10, cy + 20], [120, 380], 'Renal vein out', 'right');
    leader(ctx, [cx + 40, cy + 230], [120, 700], 'Ureter to bladder', 'right');
  },
};

// A large standing diagram on two posts. This is the world's "image" half: a system is a
// set of relationships, and a labelled drawing carries relationships that no amount of
// walking around a 3D organ can.
export function anatomyChart({ chart = 'body-systems', width = 9, postHeight = 3 } = {}) {
  const draw = CHART_DRAWERS[chart] || CHART_DRAWERS['body-systems'];
  const height = (width * CHART_H) / CHART_W;
  const g = group();
  const frameMaterial = standard({ color: 0x2b3a42, roughness: 0.5, metalness: 0.4 });

  const inset = width / 2 - 0.35;
  g.add(cyl(0.17, 0.22, postHeight, frameMaterial, -inset, postHeight / 2, 0, 12));
  g.add(cyl(0.17, 0.22, postHeight, frameMaterial, inset, postHeight / 2, 0, 12));
  g.add(box(width * 0.7, 0.24, 1.4, frameMaterial, -inset, 0.12, 0));
  g.add(box(width * 0.7, 0.24, 1.4, frameMaterial, inset, 0.12, 0));

  const panelY = postHeight + height / 2;
  g.add(box(width + 0.3, height + 0.3, 0.14, frameMaterial, 0, panelY, -0.05));

  const face = signPanel(width, height, canvasTexture(CHART_W, CHART_H, (ctx) => draw(ctx)));
  face.position.set(0, panelY, 0.03);
  g.add(face);

  return g;
}
