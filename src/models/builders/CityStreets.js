import * as THREE from 'three';
import { mesh, standard, seededRandom, canvasTexture, relief } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lathe, alongMatrix, mix, tube as mkTube } from '../ModelKit.js';
import { ROAD, PALETTE } from '../town/TownKit.js';

// The city kit's street pieces: the road itself and the furniture that stands beside it.
//
//   road-straight      EXACTLY x = -10..10, z = -20..20, TownKit.ROAD's cross section. Its green arrow
//                      lays copies every 20ft along +X, so both X ends are the same plane cut.
//   road-intersection  EXACTLY 40 x 40. Its four edges carry the same cross section to the inch.
//   traffic-light      a 16ft pedestal signal with two heads back to back, which cycles by itself.
//   street-lamp        a 25ft LED cobra-head light on a tapered pole.
//   fire-hydrant       a 3ft hydrant with two hose outlets, a pumper outlet and a pentagon nut.
//   bus-stop           a shelter open to +Z with a glass back, a bench, a route map and a flag sign.
//
// Real life size in feet, origin at the base centre, front is +Z, fresh materials every build.
//
// THE CROSS SECTION, from the crown out to the back of walk (|z|):
//   0 .. 10.5    asphalt, top at ROAD.asphaltTop
//   10.5 .. 12   a concrete gutter pan, top at ROAD.asphaltTop (the storm drain sits in it)
//   12 .. 12.6   the kerb, its face 0.35ft tall above the pan and its nose chamfered, top at 0.5
//   12.6 .. 20   sidewalk, top at ROAD.sidewalkTop
// Every slab runs down to ROAD.base. Both road pieces build that section from the same KERB profile and
// the same numbers below, which is what makes the intersection's edge the road's end.

const GUTTER = 1.5; // width of the concrete pan in front of the kerb face
const KERB_W = 0.6; // kerb, face to back
const TOP = ROAD.sidewalkTop;
const ROADTOP = ROAD.asphaltTop;
const BASE = ROAD.base;
// The kerb, in (d, y), d measured from the kerb face back into the sidewalk.
const KERB = [[0, BASE], [KERB_W, BASE], [KERB_W, TOP], [0.12, TOP], [0, TOP - 0.1]];

// Paint stands 0.045ft proud: any less and it fights the asphalt for the depth buffer from across a street.
const PAINT_TOP = ROAD.asphaltTop + 0.045;
const ASPHALT_TILE = 4; // feet per texture tile; divides 20 and 40, so copies do not show a seam
const CONCRETE_TILE = 5; // the sidewalk joint spacing

// ---------------------------------------------------------------------------------------------
// A small solid-modelling soup: triangles oriented by an outward hint, flat faces.
// ---------------------------------------------------------------------------------------------
class Solid {
  constructor() { this.p = []; }

  tri(a, b, c, want = null) {
    if (want) {
      const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
      const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
      const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
      if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { const t = b; b = c; c = t; }
    }
    this.p.push(...a, ...b, ...c);
  }

  quad(a, b, c, d, want) { this.tri(a, b, c, want); this.tri(a, c, d, want); }

  get empty() { return this.p.length === 0; }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((this.p.length / 3) * 2), 2));
    return g;
  }
}

function signedArea2(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// Outward 2D normal of edge p -> q of a polygon of the given orientation.
function edgeOut(p, q, area) {
  const dx = q[0] - p[0]; const dy = q[1] - p[1];
  const s = area > 0 ? 1 : -1;
  return [dy * s, -dx * s];
}

function earcut(pts) {
  return THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
}

// A plan outline [[x, z]] stood up from bottom heights to top heights (numbers, or arrays per point).
// `topTris` overrides the cap triangulation when the top is not flat.
function planPrism(s, pts, y0, y1, topTris = null) {
  const n = pts.length;
  const area = signedArea2(pts);
  const b = (i) => (Array.isArray(y0) ? y0[i] : y0);
  const t = (i) => (Array.isArray(y1) ? y1[i] : y1);
  const tris = topTris ?? earcut(pts);
  for (const [i, j, k] of tris) {
    s.tri([pts[i][0], t(i), pts[i][1]], [pts[j][0], t(j), pts[j][1]], [pts[k][0], t(k), pts[k][1]], [0, 1, 0]);
    s.tri([pts[i][0], b(i), pts[i][1]], [pts[j][0], b(j), pts[j][1]], [pts[k][0], b(k), pts[k][1]], [0, -1, 0]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o = edgeOut(pts[i], pts[j], area);
    s.quad([pts[i][0], b(i), pts[i][1]], [pts[j][0], b(j), pts[j][1]], [pts[j][0], t(j), pts[j][1]], [pts[i][0], t(i), pts[i][1]], [o[0], 0, o[1]]);
  }
}

// An axis-aligned box from its extents.
function boxS(s, x0, x1, y0, y1, z0, z1) {
  planPrism(s, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], y0, y1);
}

// A profile [[d, y]] swept along a plan path [[x, z]] whose per-point normals [[nx, nz]] point the way d
// grows. Closed at both ends.
function planSweep(s, path, normals, profile) {
  const pa = signedArea2(profile);
  const at = (i, k) => [path[i][0] + normals[i][0] * profile[k][0], profile[k][1], path[i][1] + normals[i][1] * profile[k][0]];
  const m = profile.length;
  for (let i = 0; i < path.length - 1; i++) {
    const nx = (normals[i][0] + normals[i + 1][0]) / 2; const nz = (normals[i][1] + normals[i + 1][1]) / 2;
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const o = edgeOut(profile[k], profile[k2], pa);
      s.quad(at(i, k), at(i + 1, k), at(i + 1, k2), at(i, k2), [nx * o[0], o[1], nz * o[0]]);
    }
  }
  const tris = earcut(profile);
  const last = path.length - 1;
  const t0 = [path[0][0] - path[1][0], 0, path[0][1] - path[1][1]];
  const t1 = [path[last][0] - path[last - 1][0], 0, path[last][1] - path[last - 1][1]];
  for (const [a, b, c] of tris) {
    s.tri(at(0, a), at(0, b), at(0, c), t0);
    s.tri(at(last, a), at(last, b), at(last, c), t1);
  }
}

// Planar texture coordinates in feet, chosen by which way each face points, for a merged geometry
// whose texture is a tile of `tile` feet. World-aligned, so two copies 20ft apart continue the tile.
function planarUV(g, tile) {
  const P = g.attributes.position; const N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const ax = Math.abs(N.getX(i)); const ay = Math.abs(N.getY(i)); const az = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z; v = y; } else { u = x; v = y; }
    uv[i * 2] = u / tile; uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function part(solid, color) { return { geometry: solid.geometry(), color }; }

// ---------------------------------------------------------------------------------------------
// Near-white tiles. A map multiplies the vertex colour, so one tile serves every grey.
// ---------------------------------------------------------------------------------------------
function wrapDots(ctx, w, h, x, y, r, style) {
  ctx.fillStyle = style;
  for (const ox of [-w, 0, w]) {
    for (const oy of [-h, 0, h]) {
      if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function asphaltTexture(seed) {
  const rng = seededRandom(seed);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, w, h);
    // Broad, faint blotches: the binder is never one even black.
    for (let i = 0; i < 26; i++) {
      const a = 0.03 + rng() * 0.04;
      wrapDots(ctx, w, h, rng() * w, rng() * h, 14 + rng() * 34, rng() < 0.5 ? `rgba(170,170,170,${a})` : `rgba(255,255,255,${a * 2})`);
    }
    // Aggregate: thousands of small chips, a few of them darker binder.
    for (let i = 0; i < 3200; i++) {
      const r = 0.4 + rng() * rng() * 1.3;
      const g = 150 + (rng() * 70 | 0);
      wrapDots(ctx, w, h, rng() * w, rng() * h, r, rng() < 0.55 ? `rgba(255,255,255,${0.5 + rng() * 0.5})` : `rgba(${g},${g},${g + 3},${0.18 + rng() * 0.3})`);
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

// A concrete tile of CONCRETE_TILE feet with a tooled joint along u = 0 (so a joint every 5ft along X).
function concreteTexture(seed, { joints = true } = {}) {
  const rng = seededRandom(seed);
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#efece6';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 18; i++) {
      const a = 0.03 + rng() * 0.05;
      wrapDots(ctx, w, h, rng() * w, rng() * h, 18 + rng() * 40, rng() < 0.55 ? `rgba(150,140,128,${a})` : `rgba(255,255,255,${a})`);
    }
    for (let i = 0; i < 1500; i++) {
      const style = rng() < 0.5 ? `rgba(120,112,100,${0.12 + rng() * 0.25})` : `rgba(255,255,255,${0.2 + rng() * 0.4})`;
      wrapDots(ctx, w, h, rng() * w, rng() * h, 0.5 + rng() * 1.2, style);
    }
    if (joints) {
      // A tooled joint: a dark groove with a pale tooled margin each side, split across the seam.
      ctx.fillStyle = 'rgba(70,66,60,0.85)';
      ctx.fillRect(0, 0, 2, h); ctx.fillRect(w - 2, 0, 2, h);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(2, 0, 3, h); ctx.fillRect(w - 5, 0, 3, h);
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

function asphaltMaterial(seed) {
  const t = asphaltTexture(seed);
  return standard({ vertexColors: true, map: t, bumpMap: t, bumpScale: 0.6, roughness: 0.95, metalness: 0 });
}
function concreteMaterial(seed) {
  const t = concreteTexture(seed);
  return standard({ vertexColors: true, map: t, bumpMap: t, bumpScale: 0.5, roughness: 0.9, metalness: 0 });
}
function paintMaterial() {
  return standard({ vertexColors: true, roughness: 0.62, metalness: 0 });
}
// Paint is a few hundredths of a foot thick, so it casts nothing worth drawing, and drawn into the
// shadow map it shadows itself in streaks at any distance.
function paintMesh(parts) {
  const m = mesh(mergeParts(parts), paintMaterial());
  m.castShadow = false;
  return m;
}

function planarMesh(parts, material, tile) {
  const g = planarUV(mergeParts(parts), tile);
  return mesh(g, material);
}

// ---------------------------------------------------------------------------------------------
// road-straight
// ---------------------------------------------------------------------------------------------
const HALF = ROAD.length / 2; // 10

function roadStraight() {
  const asphalt = new Solid(); const conc = new Solid(); const kerb = new Solid(); const paint = []; const iron = [];
  // Carriageway and the two gutter pans.
  boxS(asphalt, -HALF, HALF, BASE, ROADTOP, -(ROAD.kerb - GUTTER), ROAD.kerb - GUTTER);
  for (const sz of [1, -1]) {
    const zFace = sz * ROAD.kerb;
    boxS(conc, -HALF, HALF, BASE, ROADTOP, Math.min(zFace, zFace - sz * GUTTER), Math.max(zFace, zFace - sz * GUTTER));
    // The kerb, swept straight along X with d growing away from the street.
    planSweep(kerb, [[-HALF, zFace], [HALF, zFace]], [[0, sz], [0, sz]], KERB);
    const z0 = sz * (ROAD.kerb + KERB_W); const z1 = sz * (ROAD.kerb + ROAD.sidewalk);
    boxS(conc, -HALF, HALF, BASE, TOP, Math.min(z0, z1), Math.max(z0, z1));
  }
  // Paint, sunk into the asphalt so its top stands a hundredth of a foot proud.
  const yellow = new Solid(); const white = new Solid();
  for (const sz of [1, -1]) boxS(yellow, -HALF, HALF, ROADTOP - 0.02, PAINT_TOP, sz > 0 ? 0.17 : -0.5, sz > 0 ? 0.5 : -0.17);
  for (const sz of [1, -1]) boxS(white, -HALF, HALF, ROADTOP - 0.02, PAINT_TOP, sz > 0 ? 9.9 : -10.25, sz > 0 ? 10.25 : -9.9);
  paint.push(part(yellow, PALETTE.laneYellow), part(white, PALETTE.laneWhite));

  // The storm drain: a grate in the +Z gutter and a curb inlet in the kerb face behind it.
  const voidS = new Solid(); const grate = new Solid();
  const gz0 = ROAD.kerb - GUTTER + 0.2; const gz1 = ROAD.kerb - 0.12;
  boxS(voidS, -1.5, 1.5, ROADTOP - 0.03, ROADTOP + 0.004, gz0, gz1);
  for (const [x0, x1, z0, z1] of [[-1.6, 1.6, gz0 - 0.1, gz0], [-1.6, 1.6, gz1, gz1 + 0.08], [-1.6, -1.5, gz0, gz1], [1.5, 1.6, gz0, gz1]]) {
    boxS(grate, x0, x1, ROADTOP - 0.03, ROADTOP + 0.025, z0, z1);
  }
  // Bars across the flow, the bicycle-safe way round.
  for (let i = 0; i < 12; i++) {
    const x = -1.5 + (i + 0.5) * (3 / 12);
    boxS(grate, x - 0.045, x + 0.045, ROADTOP - 0.02, ROADTOP + 0.02, gz0, gz1);
  }
  boxS(grate, -1.5, 1.5, ROADTOP - 0.02, ROADTOP + 0.02, (gz0 + gz1) / 2 - 0.04, (gz0 + gz1) / 2 + 0.04);
  // Curb inlet: a dark mouth a hair proud of the kerb face, under a steel hood.
  boxS(voidS, -2.2, 2.2, ROADTOP + 0.005, TOP - 0.17, ROAD.kerb - 0.02, ROAD.kerb + 0.02);
  boxS(grate, -2.3, 2.3, TOP - 0.17, TOP - 0.1, ROAD.kerb - 0.05, ROAD.kerb + 0.02);
  iron.push(part(voidS, 0x121314), part(grate, 0x44464a));

  const group = new THREE.Group();
  group.add(
    planarMesh([part(asphalt, PALETTE.asphalt)], asphaltMaterial(311), ASPHALT_TILE),
    planarMesh([part(conc, PALETTE.concrete), part(kerb, PALETTE.kerb)], concreteMaterial(312), CONCRETE_TILE),
    paintMesh([...paint, ...iron]),
  );
  return group;
}

// ---------------------------------------------------------------------------------------------
// road-intersection
// ---------------------------------------------------------------------------------------------
// One corner is drawn, the (+x, +z) one, and the other three are it turned by quarter turns about Y.
// Its kerb line runs from the +X edge along z = 12, round a radius-R return centred at (C, C), and out
// along x = 12 to the +Z edge. The diagonal curb ramp sits in the middle of the return, so the kerb is
// interrupted between its flares F1 and F2, and its front edge is a chord P1-P2.
const R = 6;
const C = ROAD.kerb + R; // 18
const E = ROAD.width / 2; // 20
const deg = Math.PI / 180;
const PHI_F = 45 * deg - Math.asin(3.8 / R); // the flares' outer ends
const PHI_P = 45 * deg - Math.asin(2.5 / R); // the run's front corners
const arcAt = (phi, r = R) => [C - Math.sin(phi) * r, C - Math.cos(phi) * r];
const radial = (phi) => [Math.sin(phi), Math.cos(phi)]; // pointing back into the corner

// Kerb line points and their normals (into the sidewalk).
function kerbLine() {
  const pts = [[E, ROAD.kerb], [C, ROAD.kerb]];
  const nrm = [[0, 1], [0, 1]];
  for (const phi of [PHI_F, PHI_P, 90 * deg - PHI_P, 90 * deg - PHI_F]) { pts.push(arcAt(phi)); nrm.push(radial(phi)); }
  pts.push([ROAD.kerb, C], [ROAD.kerb, E]);
  nrm.push([1, 0], [1, 0]);
  return { pts, nrm };
}

const turn = (k) => (p) => {
  // A quarter turn k times about +Y (x, z) -> (z, -x), which keeps a plan's handedness.
  let [x, z] = p;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) { const t = x; x = z; z = -t; }
  return [x, z];
};

function turnSolid(s, k) {
  // Rotates a finished Solid's triangles by k quarter turns (a rotation, so winding is untouched).
  const f = turn(k);
  const out = new Solid();
  for (let i = 0; i < s.p.length; i += 3) {
    const [x, z] = f([s.p[i], s.p[i + 2]]);
    out.p.push(x, s.p[i + 1], z);
  }
  return out;
}

function roadIntersection() {
  const { pts, nrm } = kerbLine();
  const offset = (i, d) => [pts[i][0] + nrm[i][0] * d, pts[i][1] + nrm[i][1] * d];

  // ---- one corner, in the (+,+) frame
  const conc = new Solid(); const kerb = new Solid(); const paint = new Solid(); const pad = new Solid();
  // Gutter pan along the whole kerb line, in front of it (d from -GUTTER to 0).
  planSweep(conc, pts, nrm, [[-GUTTER, BASE], [0, BASE], [0, ROADTOP], [-GUTTER, ROADTOP]]);
  // Kerb: before the ramp and after it.
  planSweep(kerb, pts.slice(0, 3), nrm.slice(0, 3), KERB);
  planSweep(kerb, pts.slice(5), nrm.slice(5), KERB);

  // The ramp. Its run is a plane falling along the corner's diagonal.
  const u = [Math.SQRT1_2, Math.SQRT1_2]; // up the ramp, into the corner
  const pp = [-Math.SQRT1_2, Math.SQRT1_2]; // across it
  const M = arcAt(45 * deg);
  const backC = [M[0] + u[0] * 5.5, M[1] + u[1] * 5.5];
  const F1 = pts[2]; const P1 = pts[3]; const P2 = pts[4]; const F2 = pts[5];
  const K1 = offset(2, KERB_W); const K2 = offset(5, KERB_W);
  const Q1 = [backC[0] - pp[0] * 2, backC[1] - pp[1] * 2];
  const Q2 = [backC[0] + pp[0] * 2, backC[1] + pp[1] * 2];
  const LOW = ROADTOP + 0.025;
  const rampPts = [F1, P1, P2, F2, K2, Q2, Q1, K1];
  const rampTop = [TOP, LOW, LOW, TOP, TOP, TOP, TOP, TOP];
  // Flare, run, flare.
  const rampTris = [[0, 1, 6], [0, 6, 7], [1, 2, 5], [1, 5, 6], [2, 3, 5], [3, 4, 5]];
  planPrism(conc, rampPts, BASE, rampTop, rampTris);
  // The run's plane, by distance a from M along u.
  const aP = (P1[0] - M[0]) * u[0] + (P1[1] - M[1]) * u[1];
  const aQ = 5.5;
  const runY = (a) => LOW + (TOP - LOW) * (a - aP) / (aQ - aP);

  // The sidewalk slab: the corner square, notched for the ramp.
  const slab = [[E, E], [E, ROAD.kerb + KERB_W], [C, ROAD.kerb + KERB_W], K1, Q1, Q2, K2, [ROAD.kerb + KERB_W, C], [ROAD.kerb + KERB_W, E]];
  planPrism(conc, slab, BASE, TOP);

  // The detectable warning pad: a yellow plate lying on the run, with truncated domes.
  const padAt = (a, w) => [M[0] + u[0] * a + pp[0] * w, M[1] + u[1] * a + pp[1] * w];
  const a0 = aP + 0.12; const a1 = aP + 2.12; const hw = 1.95;
  const padPts = [padAt(a0, -hw), padAt(a0, hw), padAt(a1, hw), padAt(a1, -hw)];
  planPrism(pad, padPts, [runY(a0) - 0.03, runY(a0) - 0.03, runY(a1) - 0.03, runY(a1) - 0.03],
    [runY(a0) + 0.02, runY(a0) + 0.02, runY(a1) + 0.02, runY(a1) + 0.02]);
  const domes = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 8; j++) {
      const a = mix(a0 + 0.25, a1 - 0.25, i / 3);
      const w = mix(-hw + 0.22, hw - 0.22, j / 7);
      const [x, z] = padAt(a, w);
      const g = new THREE.SphereGeometry(0.085, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 0.55, 1);
      // Close it, so a dome is a solid and not a cup: a 6-sided disc under it.
      const cap = new THREE.CircleGeometry(0.085, 6); cap.rotateX(Math.PI / 2);
      const d = mergeParts([{ geometry: g, color: 0xffffff }, { geometry: cap, color: 0xffffff }]);
      d.translate(x, runY(a) + 0.015, z);
      domes.push({ geometry: d, color: 0xd9ad22 });
    }
  }

  // ---- markings for the +X arm (the arm at x = 12..20). Traffic arriving on it heads -X and keeps
  // right, so its lane is z < 0 and its stop line stops there.
  const PY0 = ROADTOP - 0.02; const PY1 = PAINT_TOP;
  for (const zc of [-9, -5, -1, 1, 5, 9]) boxS(paint, 12.5, 18.1, PY0, PY1, zc - 1, zc + 1);
  boxS(paint, 19.0, 19.9, PY0, PY1, -(ROAD.kerb - GUTTER) + 0.25, -0.35);

  // ---- the four corners and the four arms
  const asphaltParts = []; const concParts = []; const paintParts = [];
  for (let k = 0; k < 4; k++) {
    concParts.push(part(turnSolid(conc, k), PALETTE.concrete), part(turnSolid(kerb, k), PALETTE.kerb));
    paintParts.push(part(turnSolid(paint, k), PALETTE.laneWhite), part(turnSolid(pad, k), 0xd9ad22));
    for (const d of domes) {
      const g = d.geometry.clone();
      g.rotateY(k * Math.PI / 2); // turn(1) is rotateY(+90): (x, z) -> (z, -x)
      paintParts.push({ geometry: g, color: d.color });
    }
  }
  // Asphalt: everything inside the four gutters' outer edges, cut into a centre square, two strips per
  // arm and a fillet per corner, all meeting vertex to vertex. One earcut over the whole cross gives
  // forty-foot slivers, and a sliver loses the depth fight with the paint lying on it.
  const gutterOuter = pts.map((_, i) => offset(i, -GUTTER));
  const g = ROAD.kerb - GUTTER; // 10.5
  const asphalt = new Solid();
  boxS(asphalt, -g, g, BASE, ROADTOP, -g, g);
  const quarter = new Solid();
  boxS(quarter, g, C, BASE, ROADTOP, -g, g);
  boxS(quarter, C, E, BASE, ROADTOP, -g, g);
  planPrism(quarter, [[g, g], ...gutterOuter.slice(1, -1)], BASE, ROADTOP);
  for (let k = 0; k < 4; k++) asphalt.p.push(...turnSolid(quarter, k).p);
  asphaltParts.push(part(asphalt, PALETTE.asphalt));

  const group = new THREE.Group();
  group.add(
    planarMesh(asphaltParts, asphaltMaterial(321), ASPHALT_TILE),
    planarMesh(concParts, concreteMaterial(322), CONCRETE_TILE),
    paintMesh(paintParts),
  );
  return group;
}


// ---------------------------------------------------------------------------------------------
// Street furniture helpers. Parts go in plain lists and each list becomes one mesh.
// ---------------------------------------------------------------------------------------------
function box3(list, x0, x1, y0, y1, z0, z1, color) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  list.push({ geometry: g, color });
}

function cylY(list, rBottom, rTop, y0, y1, color, x = 0, z = 0, segs = 20) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, segs);
  g.translate(x, (y0 + y1) / 2, z);
  list.push({ geometry: g, color });
}

// A round bar from a to b.
function rod(list, a, b, r, color, sides = 10, r2 = r) {
  const { m, len } = alongMatrix(a, b);
  const g = new THREE.CylinderGeometry(r2, r, len, sides);
  g.rotateX(Math.PI / 2); g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  list.push({ geometry: g, color });
}

// A lathe placed at (x, y, z), optionally turned by a matrix about its own base.
function spun(list, profile, color, { at = [0, 0, 0], m = null, segs = 28 } = {}) {
  const g = lathe(profile, segs);
  if (m) g.applyMatrix4(m);
  g.translate(at[0], at[1], at[2]);
  list.push({ geometry: g, color });
}

// A plan [[x, y]] extruded along +Z from z0 to z1, as a closed solid. Built in XZ and turned up by a
// rotation, so the winding the plan builder chose is kept.
function prismXY(pts, z0, z1) {
  const s = new Solid();
  planPrism(s, pts.map(([x, y]) => [x, -y]), z0, z1);
  const out = new Solid();
  for (let i = 0; i < s.p.length; i += 3) out.p.push(s.p[i], -s.p[i + 2], s.p[i + 1]);
  return out.geometry();
}

// Flat faces stay flat and a curve of many small facets shades as one surface.
function creased(g, degrees = 32) {
  return toCreasedNormals(g, degrees * Math.PI / 180);
}

function roundRect(hw, hh, r, steps = 4) {
  const pts = [];
  const corners = [[hw - r, hh - r, 0], [-(hw - r), hh - r, Math.PI / 2], [-(hw - r), -(hh - r), Math.PI], [hw - r, -(hh - r), -Math.PI / 2]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return pts;
}

function polygon(n, r, phase = Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}

function glowMaterial(hex, intensity = 1.4, extra = {}) {
  return standard({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.35, metalness: 0, ...extra });
}

// ---------------------------------------------------------------------------------------------
// traffic-light
// ---------------------------------------------------------------------------------------------
// A pedestal signal: a cast base, a 15ft pole and two three-section heads back to back on the pole top,
// one facing +Z and one facing -Z. Two heads facing opposite ways serve the two directions of the SAME
// street, so they always show the same colour, which is why one lit mesh per colour can hold both.
// (A head facing +X would face the cross street, and would have to be red while these are green.)
const SIG = {
  sec: 1.2, // one 12-inch section
  w: 1.12, // housing width
  depth: 0.72,
  back: 0.62, // housing back, from the pole axis
  midY: 13.55, // middle lens
  lens: 0.47,
};
const SIG_COLOURS = [
  { name: 'red', lit: 0xff2414, body: 0x8a1208, dark: 0x3a0f0c, dy: SIG.sec },
  { name: 'yellow', lit: 0xffa600, body: 0x8a5a00, dark: 0x3d2a08, dy: 0 },
  { name: 'green', lit: 0x00d66b, body: 0x006b36, dark: 0x0b2f1c, dy: -SIG.sec },
];
const SIG_DEFAULTS = { green: 8, yellow: 3, red: 8 };

function trafficLight() {
  const body = []; const lit = { red: [], yellow: [], green: [] };
  const STEEL = 0x8f959b; const HOUSING = 0xe0b021; const BLACK = 0x1f2124; const BORDER = 0xf2c62e;

  // Base plate, anchor nuts, the cast pedestal base and its access door.
  box3(body, -0.72, 0.72, -0.12, 0.08, -0.72, 0.72, 0x7d8288);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cylY(body, 0.07, 0.07, 0.05, 0.2, 0x5d6166, sx * 0.55, sz * 0.55, 6);
      cylY(body, 0.03, 0.03, 0.18, 0.3, 0x5d6166, sx * 0.55, sz * 0.55, 6);
    }
  }
  {
    const g = new THREE.CylinderGeometry(0.4, 0.58, 1.7, 4, 1);
    g.rotateY(Math.PI / 4); g.translate(0, 0.08 + 0.85, 0);
    body.push({ geometry: g, color: STEEL });
    // A moulded collar where the pole leaves the base.
    spun(body, [[0, 1.7], [0.36, 1.7], [0.36, 1.86], [0.3, 1.98], [0, 1.98]], STEEL);
    // The access door on the front face, a plate built forward of the sloping face.
    const door = prismXY(roundRect(0.22, 0.42, 0.06), 0, 0.03);
    door.rotateX(-Math.atan2(0.18, 1.7));
    door.translate(0, 0.86, 0.5);
    body.push({ geometry: door, color: 0x7d8288 });
  }
  // The pole, tapering, and its cap.
  spun(body, [[0, 1.9], [0.23, 1.9], [0.2, 15.7], [0.215, 15.72], [0.215, 15.9], [0.12, 16.02], [0, 16.05]], STEEL, { segs: 24 });
  // A pedestrian push button on the +X side, at hand height, with its little sign.
  box3(body, 0.19, 0.42, 3.4, 4.2, -0.17, 0.17, 0xd9b324);
  cylY(body, 0.07, 0.07, 0, 0.06, 0x2b2d30, 0, 0, 14);
  body[body.length - 1].geometry.rotateZ(-Math.PI / 2); body[body.length - 1].geometry.translate(0.4, 3.62, 0);
  box3(body, 0.2, 0.24, 4.35, 5.25, -0.32, 0.32, 0xeeeeea);

  // Two heads. Everything for the +Z head is authored here, then turned half round for the other.
  const head = []; const headLit = { red: [], yellow: [], green: [] };
  const zb = SIG.back; const zf = SIG.back + SIG.depth;
  const yTop = SIG.midY + SIG.sec * 1.5; const yBot = SIG.midY - SIG.sec * 1.5;
  // Housing: a rounded box, split into its three sections by two raised ribs.
  head.push({ geometry: (() => { const g = creased(prismXY(roundRect(SIG.w / 2, (yTop - yBot) / 2, 0.14), zb, zf)); g.translate(0, SIG.midY, 0); return g; })(), color: HOUSING });
  for (const dy of [-SIG.sec / 2, SIG.sec / 2]) box3(head, -SIG.w / 2 - 0.02, SIG.w / 2 + 0.02, SIG.midY + dy - 0.03, SIG.midY + dy + 0.03, zb, zf + 0.015, HOUSING);
  // Backplate with its yellow retroreflective border, behind the housing and pierced by it.
  const bw = 0.98; const bh = 2.25;
  head.push({ geometry: (() => { const g = prismXY(roundRect(bw, bh, 0.12), zb + 0.05, zb + 0.13); g.translate(0, SIG.midY, 0); return g; })(), color: BLACK });
  {
    for (const [x0, x1, y0, y1] of [[-bw, bw, bh - 0.15, bh], [-bw, bw, -bh, -bh + 0.15], [-bw, -bw + 0.15, -bh, bh], [bw - 0.15, bw, -bh, bh]]) {
      box3(head, x0 + 0.03, x1 - 0.03, SIG.midY + y0 + 0.03, SIG.midY + y1 - 0.03, zb + 0.12, zb + 0.15, BORDER);
    }
  }
  // Lenses, visors and the lit domes.
  for (const c of SIG_COLOURS) {
    const y = SIG.midY + c.dy;
    // The unlit lens face, a dark disc standing proud of the housing.
    const disc = new THREE.CylinderGeometry(SIG.lens, SIG.lens, 0.05, 28);
    disc.rotateX(Math.PI / 2); disc.translate(0, y, zf + 0.02);
    head.push({ geometry: disc, color: c.dark });
    // The visor: a hood over the top three quarters, a closed band of real thickness.
    const pts = [];
    const a0 = -0.25 * Math.PI; const a1 = 1.25 * Math.PI; const steps = 16;
    for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * (i / steps); pts.push([Math.cos(a) * 0.6, Math.sin(a) * 0.6]); }
    for (let i = steps; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / steps); pts.push([Math.cos(a) * 0.55, Math.sin(a) * 0.55]); }
    const visor = creased(prismXY(pts, zf - 0.02, zf + 0.78));
    visor.translate(0, y, 0);
    head.push({ geometry: visor, color: HOUSING });
    // Inside of the visor is black, a thin liner so the lit lens reads against dark.
    const liner = [];
    for (let i = 0; i <= steps; i++) { const a = a0 + (a1 - a0) * (i / steps); liner.push([Math.cos(a) * 0.55, Math.sin(a) * 0.55]); }
    for (let i = steps; i >= 0; i--) { const a = a0 + (a1 - a0) * (i / steps); liner.push([Math.cos(a) * 0.53, Math.sin(a) * 0.53]); }
    const lg = prismXY(liner, zf + 0.04, zf + 0.76); lg.translate(0, y, 0);
    head.push({ geometry: lg, color: 0x141517 });
    // The lit lens: a shallow dome over the dark disc, in its own mesh.
    const dome = lathe([[0, 0], [SIG.lens - 0.01, 0], [SIG.lens - 0.04, 0.04], [SIG.lens * 0.6, 0.075], [0, 0.085]], 28);
    dome.rotateX(Math.PI / 2); dome.translate(0, y, zf + 0.04);
    headLit[c.name].push({ geometry: dome, color: c.lit });
  }
  // Two mounting arms from the pole to the back of the housing, with clamp bands round the pole.
  for (const y of [yTop - 0.35, yBot + 0.35]) {
    rod(head, [0, y, 0.12], [0, y, zb + 0.08], 0.075, STEEL, 10);
    spun(body, [[0, y - 0.1], [0.25, y - 0.1], [0.25, y + 0.1], [0, y + 0.1]], 0x6d7278, { segs: 18 });
  }
  const half = new THREE.Matrix4().makeRotationY(Math.PI);
  for (const p of head) { body.push(p); body.push({ geometry: p.geometry.clone().applyMatrix4(half), color: p.color }); }
  for (const c of SIG_COLOURS) {
    for (const p of headLit[c.name]) { lit[c.name].push(p, { geometry: p.geometry.clone().applyMatrix4(half), color: p.color }); }
  }

  const group = new THREE.Group();
  group.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.5, metalness: 0.3 })));
  const lamps = {};
  for (const c of SIG_COLOURS) {
    const m = mesh(mergeParts(lit[c.name]), standard({ color: c.body, emissive: c.lit, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0 }));
    m.castShadow = false;
    m.name = `signal-${c.name}`;
    lamps[c.name] = m;
    group.add(m);
  }

  // THE CYCLE. The root never moves; only which lamp is visible changes. The durations are the light's
  // OWN program variables (the Chladni plate's mechanism), read fresh every frame, so a student who
  // changes `green` sees the next green last that long.
  const ORDER = ['green', 'yellow', 'red'];
  const seconds = (name) => {
    const v = Number(group.userData.programVars?.get?.(name));
    return Number.isFinite(v) && v > 0 ? v : SIG_DEFAULTS[name];
  };
  let phase = 0; let t = 0;
  const show = () => { for (const name of ORDER) lamps[name].visible = name === ORDER[phase]; };
  show();
  group.userData.tick = {
    update(dt) {
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      t += step;
      let guard = 0;
      while (t >= seconds(ORDER[phase]) && guard++ < 100) {
        t -= seconds(ORDER[phase]);
        phase = (phase + 1) % 3;
      }
      show();
    },
    dispose() {},
  };
  return group;
}

// ---------------------------------------------------------------------------------------------
// street-lamp
// ---------------------------------------------------------------------------------------------
// The pole stands 1.6ft behind the origin, so that the light's whole footprint, pole and arm and head,
// is centred on it: the head is what hangs over the street, out at +Z.
const LAMP_POLE_Z = -1.6;

// A closed loft along +Z of rounded sections: stations { z, w (half width), up, dn, y }.
function loftZ(stations, sides = 24, power = 2.6, powerDn = power) {
  const ring = (st) => {
    const out = [];
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a); const s = Math.sin(a);
      const ex = 2 / (s >= 0 ? power : powerDn);
      const x = Math.sign(c) * Math.abs(c) ** ex * st.w;
      const yy = Math.sign(s) * Math.abs(s) ** ex * (s >= 0 ? st.up : st.dn);
      out.push([x, st.y + yy, st.z]);
    }
    return out;
  };
  const rings = stations.map(ring);
  const s = new Solid();
  const centre = (st) => [0, st.y, st.z];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = rings[i][j]; const b = rings[i][j2]; const c = rings[i + 1][j2]; const d = rings[i + 1][j];
      const want = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - (stations[i].y + stations[i + 1].y) / 2, 0];
      s.quad(a, b, c, d, want);
    }
  }
  const f = stations[0]; const l = stations[stations.length - 1];
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    s.tri(centre(f), rings[0][j], rings[0][j2], [0, 0, -1]);
    s.tri(centre(l), rings[rings.length - 1][j], rings[rings.length - 1][j2], [0, 0, 1]);
  }
  return s.geometry();
}

function ledTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#8f8a80';
    ctx.fillRect(0, 0, w, h);
    const cols = 12; const rows = 6;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = (i + 0.5) * (w / cols); const y = (j + 0.5) * (h / rows);
        const r = Math.min(w / cols, h / rows) * 0.36;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#fff6e2'); g.addColorStop(1, 'rgba(255,240,210,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}

function streetLamp() {
  const body = []; const glow = [];
  const STEEL = 0x9aa0a6; const HEAD = 0x8b9095; const DARK = 0x55595e;
  const pz = LAMP_POLE_Z;
  // Concrete footing collar, base plate, nuts.
  cylY(body, 0.95, 0.9, -0.35, 0.12, 0xb3aea4, 0, pz, 24);
  box3(body, -0.62, 0.62, 0.1, 0.22, pz - 0.62, pz + 0.62, 0x7f858b);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylY(body, 0.07, 0.07, 0.2, 0.36, DARK, sx * 0.47, pz + sz * 0.47, 6);
  // The base cover: a cast skirt hiding the plate's bolts, then the tapered shaft.
  spun(body, [[0, 0.2], [0.58, 0.2], [0.58, 0.32], [0.5, 0.5], [0.4, 1.3], [0.36, 1.45], [0, 1.45]], STEEL, { at: [0, 0, pz], segs: 28 });
  spun(body, [[0, 1.4], [0.34, 1.4], [0.17, 24.0], [0.19, 24.05], [0.19, 24.3], [0.1, 24.42], [0, 24.45]], STEEL, { at: [0, 0, pz], segs: 24 });
  // A handhole cover low on the shaft, facing the sidewalk side.
  const hh = prismXY(roundRect(0.13, 0.28, 0.06), 0, 0.04);
  hh.rotateX(-Math.atan2(0.17, 22.6)); hh.translate(0, 2.4, pz - 0.335 - 0.035);
  body.push({ geometry: hh, color: 0x868c92 });
  // The davit arm: out of the pole near its top, rising and sweeping out over the street.
  const armPts = [[0, 22.6, pz + 0.05], [0, 23.4, pz + 0.9], [0, 24.0, pz + 2.4], [0, 24.25, pz + 4.4]];
  body.push({ geometry: mkTube(armPts, [0.13, 0.12, 0.11, 0.1], { sides: 12, steps: 18, round: 0 }), color: STEEL });
  spun(body, [[0, 22.35], [0.25, 22.35], [0.25, 23.0], [0, 23.0]], STEEL, { at: [0, 0, pz], segs: 20 });

  // The cobra head, a soft cast shell, nose a touch down.
  const hz = pz + 4.2;
  // Its underside is flat and level at y = 24, so the LED panel can lie on it.
  const st = [
    { z: hz, w: 0.2, up: 0.16, dn: 0.16, y: 24.25 },
    { z: hz + 0.35, w: 0.42, up: 0.26, dn: 0.27, y: 24.27 },
    { z: hz + 0.9, w: 0.6, up: 0.34, dn: 0.25, y: 24.25 },
    { z: hz + 1.6, w: 0.62, up: 0.3, dn: 0.2, y: 24.2 },
    { z: hz + 2.2, w: 0.53, up: 0.22, dn: 0.14, y: 24.14 },
    { z: hz + 2.55, w: 0.32, up: 0.13, dn: 0.1, y: 24.1 },
    { z: hz + 2.66, w: 0.12, up: 0.05, dn: 0.07, y: 24.08 },
  ];
  const shell = creased(loftZ(st, 32, 2.4, 7), 40);
  body.push({ geometry: shell, color: HEAD });
  // The slipfitter where the arm enters the back of the head.
  rod(body, [0, 24.25, hz - 0.25], [0, 24.25, hz + 0.25], 0.16, DARK, 14);
  // A twist-lock photocell on top: socket, body, a clear dome.
  spun(body, [[0, 0], [0.18, 0], [0.18, 0.05], [0.14, 0.08], [0, 0.08]], DARK, { at: [0, 24.52, hz + 0.95] });
  spun(body, [[0, 0], [0.13, 0], [0.13, 0.17], [0.11, 0.21], [0.05, 0.235], [0, 0.24]], 0x3e4247, { at: [0, 24.58, hz + 0.95] });
  // The LED panel on the underside, in its own glowing mesh: a flat lens set forward of the shell.
  const lens = prismXY(roundRect(0.44, 0.8, 0.12), 0, 0.04);
  lens.rotateX(Math.PI / 2); // lies flat, facing down
  lens.translate(0, 23.98, hz + 1.35);
  // Its texture coordinates: a flat projection, so the dot grid lies across the panel.
  {
    const P = lens.attributes.position; const uv = lens.attributes.uv;
    for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getX(i) + 0.44) / 0.88, (P.getZ(i) - (hz + 0.55)) / 1.6);
  }
  glow.push({ geometry: lens, color: 0xffffff });
  // A grey bezel round the lens, a hair proud of the shell.
  const bez = prismXY(roundRect(0.5, 0.86, 0.14), 0, 0.05);
  bez.rotateX(Math.PI / 2); bez.translate(0, 24.02, hz + 1.35);
  body.push({ geometry: bez, color: 0x6f747a });

  const group = new THREE.Group();
  group.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.5, metalness: 0.35 })));
  const tex = ledTexture();
  const lit = mesh(mergeParts(glow), standard({ color: 0xffffff, map: tex, emissive: 0xfff1d6, emissiveMap: tex, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0 }));
  lit.castShadow = false;
  group.add(lit);
  return group;
}

// ---------------------------------------------------------------------------------------------
// fire-hydrant
// ---------------------------------------------------------------------------------------------
// A dry-barrel hydrant, the American kind. Two 2.5-inch hose outlets at the sides and a 4.5-inch pumper
// outlet facing the street (+Z), all capped and chained, and the five-sided operating nut on the bonnet.
// The bonnet and caps are LIGHT BLUE, which in the NFPA colour code is Class AA: 1500 gallons a minute
// or more.
function fireHydrant() {
  const paint = []; const iron = [];
  const RED = PALETTE.fireRed; const BLUE = 0x6aa6d8; const IRON = 0x4d5054;
  // The body: riser below ground, flange, barrel, nozzle section, bonnet flange, bonnet.
  spun(paint, [
    [0, -0.3], [0.33, -0.3], [0.33, 0], [0.52, 0], [0.54, 0.04], [0.54, 0.12], [0.44, 0.15],
    [0.38, 0.22], [0.37, 1.05], [0.42, 1.12], [0.43, 1.95], [0.4, 2.02], [0, 2.02],
  ], RED, { segs: 36 });
  // Bonnet flange and dome, in the contrasting colour.
  spun(paint, [
    [0, 1.98], [0.47, 1.98], [0.49, 2.02], [0.49, 2.1], [0.45, 2.13], [0.43, 2.2], [0.38, 2.38],
    [0.3, 2.52], [0.2, 2.6], [0.17, 2.66], [0, 2.66],
  ], BLUE, { segs: 36 });
  // A weather shield, a thin disc under the nut.
  spun(paint, [[0, 2.62], [0.2, 2.62], [0.21, 2.66], [0.19, 2.69], [0, 2.69]], BLUE, { segs: 24 });
  // The operating nut: a true pentagon, 1.5in to a side scaled up a touch so it reads, and its stem.
  {
    const g = prismXY(polygon(5, 0.13), 0, 0.22);
    g.rotateX(-Math.PI / 2); // extruded along Z, stood on end so the prism runs up Y
    g.translate(0, 2.68, 0);
    iron.push({ geometry: g, color: IRON });
  }
  // Bolts round the ground flange and the bonnet flange.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const g = prismXY(polygon(6, 0.045, 0), 0, 0.07); g.rotateX(-Math.PI / 2);
    g.translate(Math.sin(a) * 0.46, 0.12, Math.cos(a) * 0.46);
    iron.push({ geometry: g, color: IRON });
    const g2 = prismXY(polygon(6, 0.04, 0), 0, 0.06); g2.rotateX(-Math.PI / 2);
    g2.translate(Math.sin(a + 0.4) * 0.45, 2.1, Math.cos(a + 0.4) * 0.45);
    iron.push({ geometry: g2, color: IRON });
  }
  // Outlets. Each is a nozzle out of the barrel, a collar, a cap with its own pentagon nut and an eye.
  // dir: outward direction in the plan; authored along +Z and turned to it.
  const outlet = (yaw, y, r, reach, capLen) => {
    const m = new THREE.Matrix4().makeRotationY(yaw);
    const add = (list, g, color) => { g.applyMatrix4(m); list.push({ geometry: g, color }); };
    const along = (profile) => { const g = lathe(profile, 28); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g; };
    // nozzle from inside the barrel to the cap
    add(paint, along([[0, 0.1], [r, 0.1], [r, reach - 0.06], [r + 0.04, reach - 0.04], [r + 0.04, reach], [0, reach]]), RED);
    // cap, in the bonnet colour, with a lug ring
    add(paint, along([[0, reach - 0.01], [r + 0.03, reach - 0.01], [r + 0.03, reach + capLen * 0.75], [r - 0.02, reach + capLen], [0, reach + capLen]]), BLUE);
    // the cap nut, a pentagon too, on the cap's face
    const nut = prismXY(polygon(5, r * 0.42), 0, 0.09); nut.translate(0, y, reach + capLen - 0.01);
    add(iron, nut, IRON);
    // the eye the chain hangs from, under the cap
    const eye = new THREE.TorusGeometry(0.035, 0.012, 6, 10);
    eye.translate(0, y - r - 0.04, reach + capLen * 0.45);
    add(iron, eye, IRON);
    // the chain: links swinging down from the eye and back up to a lug on the barrel
    const a = new THREE.Vector3(0, y - r - 0.075, reach + capLen * 0.45);
    const b = new THREE.Vector3(0, y - 0.38, 0.47);
    const n = 7;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * 0.12;
      pts.push(p);
    }
    for (let i = 0; i < n; i++) {
      const c = pts[i].clone().add(pts[i + 1]).multiplyScalar(0.5);
      const d = pts[i + 1].clone().sub(pts[i]);
      const link = new THREE.TorusGeometry(0.03, 0.009, 4, 8);
      link.scale(1, 1.6, 1); // long along local Y
      if (i % 2) link.rotateY(Math.PI / 2);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      link.applyQuaternion(q); link.translate(c.x, c.y, c.z);
      add(iron, link, 0x6a6e73);
    }
    // the barrel lug
    const lug = new THREE.BoxGeometry(0.06, 0.08, 0.1); lug.translate(0, y - 0.38, 0.43);
    add(paint, lug, RED);
  };
  outlet(0, 1.5, 0.27, 0.66, 0.2); // pumper, toward the street
  outlet(Math.PI / 2, 1.62, 0.16, 0.62, 0.15); // hose, +X
  outlet(-Math.PI / 2, 1.62, 0.16, 0.62, 0.15); // hose, -X

  const group = new THREE.Group();
  group.add(
    mesh(mergeParts(paint), standard({ vertexColors: true, roughness: 0.48, metalness: 0.1, ...relief('metal', { seed: 451, repeat: 2, strength: 0.15 }) })),
    mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.55, metalness: 0.45 })),
  );
  return group;
}

// ---------------------------------------------------------------------------------------------
// bus-stop
// ---------------------------------------------------------------------------------------------
// A 12ft shelter open on the street side (+Z): a glass back, a route map in the -X end, a bench, a lit
// canopy, and a separate flag sign on its own pole at the kerb. The +X end is open and the bench stops
// short of it, which leaves the 30 x 48 inch clear space a wheelchair needs inside the shelter.
const STOP_NAMES = ['Park', 'School', 'Library', 'City Hall', 'Main St', 'Hospital', 'Fire Station'];

function fitFont(ctx, text, weight, px, maxW, family = 'Arial, Helvetica, sans-serif') {
  ctx.font = `${weight} ${px}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > maxW) { px = Math.max(6, Math.floor((px * maxW) / w)); ctx.font = `${weight} ${px}px ${family}`; }
  return px;
}

// One 1024 x 1024 lettered sheet: the route map in the left half, the flag sign and route plate on the
// right. It is drawn once per build and used by two meshes (lit map, unlit sign).
const SHEET = {
  map: [0, 0, 512, 1024],
  flag: [512, 0, 512, 640],
  route: [512, 640, 512, 256],
};

function drawBus(ctx, x, y, w, h, fill) {
  // A side-on bus pictogram: body, windows, wheels, drawn as paths.
  ctx.fillStyle = fill;
  const r = h * 0.12;
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h * 0.82); ctx.lineTo(x, y + h * 0.82); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
  ctx.fillStyle = '#1d4f9c';
  const ww = w * 0.16;
  for (let i = 0; i < 4; i++) ctx.fillRect(x + w * 0.06 + i * (ww + w * 0.05), y + h * 0.14, ww, h * 0.3);
  ctx.fillRect(x + w * 0.06, y + h * 0.56, w * 0.88, h * 0.06);
  for (const cx of [x + w * 0.22, x + w * 0.78]) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, y + h * 0.84, h * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d4f9c'; ctx.beginPath(); ctx.arc(cx, y + h * 0.84, h * 0.07, 0, Math.PI * 2); ctx.fill();
  }
}

function busStopSheet() {
  return canvasTexture(1024, 1024, (ctx) => {
    // --- the route map
    const [mx, my, mw, mh] = SHEET.map;
    ctx.fillStyle = '#f4f1e8'; ctx.fillRect(mx, my, mw, mh);
    ctx.fillStyle = '#1d4f9c'; ctx.fillRect(mx, my, mw, 150);
    ctx.fillStyle = '#ffffff';
    fitFont(ctx, 'ROUTE 12', 'bold', 72, mw - 60); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ROUTE 12', mx + mw / 2, my + 62);
    fitFont(ctx, 'Crosstown', 'normal', 34, mw - 60); ctx.fillText('Crosstown', mx + mw / 2, my + 118);
    // A faint street grid behind the line.
    ctx.strokeStyle = 'rgba(160,150,130,0.35)'; ctx.lineWidth = 6;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(mx + i * mw / 5, my + 170); ctx.lineTo(mx + i * mw / 5, my + mh - 120); ctx.stroke(); }
    for (let i = 0; i < 8; i++) { const y = my + 200 + i * 90; ctx.beginPath(); ctx.moveTo(mx + 20, y); ctx.lineTo(mx + mw - 20, y); ctx.stroke(); }
    // A green park block.
    ctx.fillStyle = 'rgba(100,160,80,0.45)'; ctx.fillRect(mx + 300, my + 190, 160, 120);
    // The route: a thick line down the sheet with stops; a second route crosses it at a transfer.
    const lx = mx + 150;
    const y0 = my + 230; const y1 = my + mh - 170;
    ctx.strokeStyle = '#e0362c'; ctx.lineWidth = 18; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(lx, y0); ctx.lineTo(lx, y1); ctx.stroke();
    // Route 7 crosses at Main St, the transfer the footer names, and runs clear of the labels.
    const ty = y0 + (y1 - y0) * (4 / (STOP_NAMES.length - 1));
    ctx.strokeStyle = '#2e8b57'; ctx.lineWidth = 12; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(mx + 30, ty - 70); ctx.lineTo(lx, ty); ctx.lineTo(lx + 44, ty + 46); ctx.lineTo(mx + mw - 70, ty + 46); ctx.stroke();
    ctx.fillStyle = '#2e8b57'; ctx.beginPath(); ctx.arc(mx + mw - 48, ty + 46, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitFont(ctx, '7', 'bold', 34, 30); ctx.fillText('7', mx + mw - 48, ty + 47);
    ctx.textAlign = 'left';
    STOP_NAMES.forEach((name, i) => {
      const y = y0 + (y1 - y0) * (i / (STOP_NAMES.length - 1));
      const here = i === 4;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = here ? '#1d4f9c' : '#e0362c'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(lx, y, here ? 26 : 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#20242a';
      fitFont(ctx, name, here ? 'bold' : 'normal', 38, mw - (lx - mx) - 60);
      ctx.textBaseline = 'middle';
      ctx.fillText(name, lx + 46, y);
    });
    // You are here: a blue pin by the Main St stop.
    const yy = y0 + (y1 - y0) * (4 / (STOP_NAMES.length - 1));
    ctx.fillStyle = '#1d4f9c';
    ctx.beginPath(); ctx.arc(lx, yy, 11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1d4f9c'; ctx.fillRect(mx, my + mh - 110, mw, 110);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center';
    fitFont(ctx, 'YOU ARE HERE: MAIN ST', 'bold', 34, mw - 40);
    ctx.fillText('YOU ARE HERE: MAIN ST', mx + mw / 2, my + mh - 74);
    fitFont(ctx, 'Change here for Route 7', 'normal', 28, mw - 40);
    ctx.fillText('Change here for Route 7', mx + mw / 2, my + mh - 34);

    // --- the flag sign: blue, white border, bus pictogram, BUS STOP
    const [fx, fy, fw, fh] = SHEET.flag;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(fx, fy, fw, fh);
    ctx.fillStyle = '#1d4f9c'; ctx.fillRect(fx + 18, fy + 18, fw - 36, fh - 36);
    drawBus(ctx, fx + 96, fy + 70, fw - 192, 200, '#ffffff');
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitFont(ctx, 'BUS', 'bold', 150, fw - 90); ctx.fillText('BUS', fx + fw / 2, fy + 380);
    fitFont(ctx, 'STOP', 'bold', 150, fw - 90); ctx.fillText('STOP', fx + fw / 2, fy + 520);
    // --- the route plate: white, a blue rounded badge with 12
    const [rx, ry, rw, rh] = SHEET.route;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = '#1d4f9c'; ctx.lineWidth = 14; ctx.strokeRect(rx + 10, ry + 10, rw - 20, rh - 20);
    ctx.fillStyle = '#20242a';
    fitFont(ctx, 'ROUTE', 'bold', 70, 220); ctx.fillText('ROUTE', rx + 150, ry + rh / 2);
    ctx.fillStyle = '#e0362c';
    ctx.beginPath(); ctx.arc(rx + 380, ry + rh / 2, 92, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    fitFont(ctx, '12', 'bold', 120, 150); ctx.fillText('12', rx + 380, ry + rh / 2 + 4);
  });
}

// A flat panel in the plane x = const (facing +X or -X) or z = const (facing +Z or -Z), mapped to a
// region of the sheet so it reads the right way round from the side it faces.
function sheetPanel(region, { facing, centre, w, h, thick = 0.02 }) {
  const g = new THREE.BoxGeometry(facing === 'x' || facing === '-x' ? thick : w, h, facing === 'z' || facing === '-z' ? thick : w);
  g.translate(centre[0], centre[1], centre[2]);
  const [rx, ry, rw, rh] = region;
  const P = g.attributes.position; const N = g.attributes.normal; const uv = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    let s;
    const nx = N.getX(i); const nz = N.getZ(i);
    if (facing === 'x' || facing === '-x') s = (P.getZ(i) - centre[2]) / w * (nx > 0 ? -1 : 1);
    else s = (P.getX(i) - centre[0]) / w * (nz > 0 ? 1 : -1);
    const t = (P.getY(i) - centre[1]) / h;
    const u = (rx + (s + 0.5) * rw) / 1024;
    const v = 1 - (ry + (0.5 - t) * rh) / 1024;
    uv.setXY(i, u, v);
  }
  return g;
}

function busStop() {
  const body = []; const glass = []; const map = []; const sign = []; const light = [];
  const FRAME = 0x3b4148; const ROOF = 0xd9dde0; const CONC = PALETTE.concrete; const WOOD = 0x9b6b43;
  const X0 = -6; const X1 = 6; const ZB = -2.25; const ZF = 1.95; const TOPY = 8.3;
  // The floor slab, a hair above the ground, running down to the foundation depth.
  box3(body, X0 - 0.6, X1 + 1.7, BASE, 0.1, ZB - 0.6, ZF + 1.1, CONC);
  // Four posts, square tube, each on a little base plate.
  for (const x of [X0 + 0.15, X1 - 0.15]) {
    for (const z of [ZB, ZF]) {
      box3(body, x - 0.16, x + 0.16, 0.1, TOPY, z - 0.16, z + 0.16, FRAME);
      box3(body, x - 0.3, x + 0.3, 0.1, 0.16, z - 0.3, z + 0.3, FRAME);
    }
  }
  // Roof beams along each end and along the back and front.
  for (const x of [X0 + 0.15, X1 - 0.15]) box3(body, x - 0.18, x + 0.18, TOPY - 0.35, TOPY, ZB - 0.2, ZF + 0.2, FRAME);
  for (const z of [ZB, ZF]) box3(body, X0, X1, TOPY - 0.35, TOPY, z - 0.17, z + 0.17, FRAME);
  // The canopy: a shallow barrel arch running along X, overhanging the front and the back.
  {
    const prof = [];
    const za = ZB - 0.55; const zbb = ZF + 1.0; const steps = 14;
    const arch = (z) => 0.32 * (1 - ((z - (za + zbb) / 2) / ((zbb - za) / 2)) ** 2);
    for (let i = 0; i <= steps; i++) { const z = mix(za, zbb, i / steps); prof.push([z, TOPY + 0.02 + arch(z)]); }
    for (let i = steps; i >= 0; i--) { const z = mix(za, zbb, i / steps); prof.push([z, TOPY + 0.2 + arch(z)]); }
    const s = new Solid();
    planSweep(s, [[X0 - 0.4, 0], [X1 + 0.4, 0]], [[0, 1], [0, 1]], prof);
    body.push({ geometry: s.geometry(), color: ROOF });
    // A fascia along the front edge, carrying the canopy light.
    box3(body, X0 - 0.4, X1 + 0.4, TOPY - 0.1, TOPY + 0.12, zbb - 0.12, zbb + 0.02, FRAME);
    // The LED strip under the canopy's front.
    box3(light, X0 + 0.6, X1 - 0.6, TOPY - 0.03, TOPY + 0.03, ZF + 0.45, ZF + 0.65, 0xffffff);
  }
  // The glass back: three panes in a frame, with a kick rail and a frit band at eye height so nobody
  // walks into it.
  const GY0 = 0.55; const GY1 = TOPY - 0.4;
  for (const [x0, x1] of [[X0 + 0.31, -2.0], [-1.9, 1.9], [2.0, X1 - 0.31]]) {
    box3(glass, x0, x1, GY0, GY1, ZB - 0.025, ZB + 0.025, 0xffffff);
  }
  box3(body, X0 + 0.3, X1 - 0.3, 0.1, GY0 + 0.04, ZB - 0.08, ZB + 0.08, FRAME);
  for (const x of [-1.95, 1.95]) box3(body, x - 0.07, x + 0.07, GY0, GY1, ZB - 0.07, ZB + 0.07, FRAME);
  for (const sz of [-1, 1]) box3(body, X0 + 0.31, X1 - 0.31, 5.0, 5.18, ZB + sz * 0.027 - 0.002, ZB + sz * 0.027 + 0.002, 0xf2f2ee);

  // The map case in the -X end: a frame, the lit map on both faces.
  const mz0 = ZB + 0.2; const mz1 = ZB + 3.4; const my0 = 1.0; const my1 = 7.2;
  const mx = X0 + 0.15;
  box3(body, mx - 0.17, mx + 0.17, my0 - 0.15, my1 + 0.15, mz0 - 0.12, mz1 + 0.12, FRAME);
  box3(body, mx - 0.06, mx + 0.06, 0.1, my0, (mz0 + mz1) / 2 - 0.1, (mz0 + mz1) / 2 + 0.1, FRAME);
  const mw = mz1 - mz0; const mh = my1 - my0;
  map.push({ geometry: sheetPanel(SHEET.map, { facing: 'x', centre: [mx + 0.18, (my0 + my1) / 2, (mz0 + mz1) / 2], w: mw - 0.1, h: mh - 0.1 }), color: 0xffffff });
  map.push({ geometry: sheetPanel(SHEET.map, { facing: '-x', centre: [mx - 0.18, (my0 + my1) / 2, (mz0 + mz1) / 2], w: mw - 0.1, h: mh - 0.1 }), color: 0xffffff });

  // The bench, against the glass, stopping short of the open end.
  const bx0 = X0 + 0.5; const bx1 = 1.4;
  for (const x of [bx0 + 0.3, (bx0 + bx1) / 2, bx1 - 0.3]) {
    box3(body, x - 0.06, x + 0.06, 0.1, 1.45, ZB + 0.35, ZB + 0.47, FRAME);
    box3(body, x - 0.06, x + 0.06, 1.35, 1.45, ZB + 0.15, ZB + 1.45, FRAME);
    // An arm divider standing up from each support.
    rod(body, [x, 1.5, ZB + 1.3], [x, 2.15, ZB + 1.1], 0.05, FRAME, 8);
    rod(body, [x, 2.15, ZB + 1.1], [x, 2.15, ZB + 0.28], 0.05, FRAME, 8);
  }
  for (let i = 0; i < 4; i++) {
    const z = ZB + 0.3 + i * 0.3;
    box3(body, bx0, bx1, 1.45, 1.55, z, z + 0.24, WOOD);
  }
  for (let i = 0; i < 2; i++) {
    const y = 2.0 + i * 0.35;
    box3(body, bx0, bx1, y, y + 0.25, ZB + 0.23, ZB + 0.31, WOOD);
  }
  for (const x of [bx0 + 0.3, (bx0 + bx1) / 2, bx1 - 0.3]) box3(body, x - 0.05, x + 0.05, 1.35, 2.65, ZB + 0.15, ZB + 0.23, FRAME);
  // A litter bin by the open end, a closed drum.
  spun(body, [[0, 0.1], [0.62, 0.1], [0.62, 2.9], [0.66, 2.95], [0.66, 3.2], [0.3, 3.35], [0, 3.38]], 0x2f5a3d, { at: [X1 - 1.2, 0, ZB + 0.9], segs: 20 });

  // The flag sign, on its own pole at the kerb end of the stop.
  const sx = X1 + 1.1; const sz = ZF + 0.6;
  box3(body, sx - 0.35, sx + 0.35, 0.1, 0.16, sz - 0.35, sz + 0.35, 0x7f858b);
  spun(body, [[0, 0.1], [0.1, 0.1], [0.1, 9.6], [0.06, 9.7], [0, 9.72]], 0x9aa0a6, { at: [sx, 0, sz], segs: 14 });
  const fw = 1.5; const fh = fw * (640 / 512); const fy = 8.2;
  const rh = fw * (256 / 512); const ry = fy - fh / 2 - 0.15 - rh / 2;
  for (const [cy, hh] of [[fy, fh], [ry, rh]]) {
    box3(body, sx - fw / 2 - 0.03, sx + fw / 2 + 0.03, cy - hh / 2 - 0.03, cy + hh / 2 + 0.03, sz + 0.1, sz + 0.15, 0x9aa0a6);
    for (const y of [cy - hh / 2 + 0.15, cy + hh / 2 - 0.15]) box3(body, sx - 0.13, sx + 0.13, y - 0.05, y + 0.05, sz - 0.13, sz + 0.11, 0x6f757b);
  }
  sign.push({ geometry: sheetPanel(SHEET.flag, { facing: 'z', centre: [sx, fy, sz + 0.165], w: fw, h: fh }), color: 0xffffff });
  sign.push({ geometry: sheetPanel(SHEET.route, { facing: 'z', centre: [sx, ry, sz + 0.165], w: fw, h: rh }), color: 0xffffff });
  // The back of the plates, facing the shops: the same sign again, read the right way round.
  sign.push({ geometry: sheetPanel(SHEET.flag, { facing: '-z', centre: [sx, fy, sz + 0.085], w: fw, h: fh }), color: 0xffffff });
  sign.push({ geometry: sheetPanel(SHEET.route, { facing: '-z', centre: [sx, ry, sz + 0.085], w: fw, h: rh }), color: 0xffffff });

  const sheet = busStopSheet();
  const sheet2 = new THREE.CanvasTexture(sheet.image); sheet2.colorSpace = THREE.SRGBColorSpace; sheet2.anisotropy = 8; sheet2.needsUpdate = true;
  const group = new THREE.Group();
  group.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.62, metalness: 0.2 })));
  const g = mesh(mergeParts(glass), standard({ color: 0xb8d2dc, transparent: true, opacity: 0.26, roughness: 0.08, metalness: 0, depthWrite: false }));
  g.castShadow = false;
  group.add(g);
  const mapMesh = mesh(mergeParts(map), standard({ color: 0xffffff, map: sheet, emissive: 0xffffff, emissiveMap: sheet, emissiveIntensity: 0.45, roughness: 0.4, metalness: 0 }));
  group.add(mapMesh);
  group.add(mesh(mergeParts(sign), standard({ color: 0xffffff, map: sheet2, roughness: 0.45, metalness: 0 })));
  const strip = mesh(mergeParts(light), glowMaterial(0xfff3dc, 1.3));
  strip.castShadow = false;
  group.add(strip);
  return group;
}

export const BUILDERS = {
  'road-straight': roadStraight,
  'road-intersection': roadIntersection,
  'traffic-light': trafficLight,
  'street-lamp': streetLamp,
  'fire-hydrant': fireHydrant,
  'bus-stop': busStop,
};

// Exported for checking: the numbers both road pieces are cut from, and the signal's default timings.
export const STREET_SECTION = { GUTTER, KERB_W, KERB, R };
export const SIGNAL_DEFAULTS = SIG_DEFAULTS;
