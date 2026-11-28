import * as THREE from 'three';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { lathe, tube, outward, mix } from '../ModelKit.js';
import { ROAD, PALETTE, FUTURE } from '../town/TownKit.js';
import { STREET_SECTION } from './CityStreets.js';
import { reducedMotion } from '../../Settings.js';
import {
  Solid, planPrism, boxS, planSweep, planarUV, part, prismXY, creased, roundRect, pinUV, loftY,
  smartSurfaceTexture, solarTileTexture, concreteTexture, texturedMaterial, glowMaterial,
} from '../town/FutureStreetsKit.js';

// Build a Future City's street pieces.
//
//   smart-road          EXACTLY road-straight's slab: x = -10..10, z = -20..20, the same kerb, gutter,
//                       asphalt and sidewalk heights from the same STREET_SECTION numbers, so a Build a
//                       City road section butts onto either end with no step. Lane lines glow instead
//                       of being painted, one lane charges cars through coils under it, and the
//                       sidewalks are paved with solar tiles.
//   smart-intersection  EXACTLY road-intersection's 40 x 40 plan and edge section. No traffic lights:
//                       glowing crosswalks (one lights up bright and the light moves round the four
//                       arms by itself), glowing kerb edges, a sensor post on each corner and planters.
//   maglev-track        40ft of T-shaped guideway along X, its top at y = 3.2 and 3ft wide, on two
//                       pylons, with glowing magnets along both sides. Both ends are the same cut.
//   hyperloop-tube      40ft of 10ft tube along X, its centre line at y = 12, on two pylons, with a long
//                       window showing the rail inside. Both ends carry the same half joint flange.
//   ev-charging-hub     four chargers with battery screens under a leaf-shaped solar canopy.
//
// Real life size in feet, origin at the base centre, front toward +Z, fresh materials every build.

const { GUTTER, KERB_W, KERB, R: RETURN_R } = STREET_SECTION;
const TOP = ROAD.sidewalkTop;
const ROADTOP = ROAD.asphaltTop;
const BASE = ROAD.base;
const LINE_TOP = ROADTOP + 0.045; // light lines stand as proud as the city kit's paint
const TILE_SKIN = 0.05; // solar tiles are the top 0.05ft of the sidewalk slab
const HALF = ROAD.length / 2;

const SMART = {
  surface: 0x46506a, // smooth resin, blue charcoal
  charge: 0x5a4c95, // the charging lane
  gutter: 0xb4bac4,
  kerb: 0xc6ccd5,
  sidewalk: 0xaeb3bc,
  solar: 0x5477b4,
  coil: 0x2e3558,
  glowLane: 0x8ff6ff,
  glowEdge: 0xf2fbff,
  glowKerb: 0x5cf2ff,
  glowCoil: 0x3cf0d8,
  glowBolt: FUTURE.glowGold,
  glowLed: 0x9be8ff,
};

const deg = Math.PI / 180;

// A plan band between an outer and an inner closed outline of the same point count.
function bandPlan(s, outer, inner, y0, y1) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = outer[i]; const o1 = outer[j]; const i0 = inner[i]; const i1 = inner[j];
    s.quad([o0[0], y1, o0[1]], [o1[0], y1, o1[1]], [i1[0], y1, i1[1]], [i0[0], y1, i0[1]], [0, 1, 0]);
    s.quad([o0[0], y0, o0[1]], [o1[0], y0, o1[1]], [i1[0], y0, i1[1]], [i0[0], y0, i0[1]], [0, -1, 0]);
    const mx = (o0[0] + o1[0]) / 2; const mz = (o0[1] + o1[1]) / 2;
    const cx = (i0[0] + i1[0]) / 2; const cz = (i0[1] + i1[1]) / 2;
    s.quad([o0[0], y0, o0[1]], [o1[0], y0, o1[1]], [o1[0], y1, o1[1]], [o0[0], y1, o0[1]], [mx - cx, 0, mz - cz]);
    s.quad([i0[0], y0, i0[1]], [i1[0], y0, i1[1]], [i1[0], y1, i1[1]], [i0[0], y1, i0[1]], [cx - mx, 0, cz - mz]);
  }
}

function rrPlan(cx, cz, hw, hd, r, steps = 4) {
  return roundRect(hw, hd, r, steps).map(([x, z]) => [cx + x, cz + z]);
}

// A lightning bolt in plan, about a foot and a quarter long along z, scaled.
function boltPlan(cx, cz, s = 1, flip = false) {
  const pts = [[0.10, -0.62], [-0.32, 0.06], [-0.03, 0.06], [-0.13, 0.62], [0.32, -0.08], [0.03, -0.08]];
  return pts.map(([x, z]) => [cx + x * s * (flip ? -1 : 1), cz + z * s * (flip ? -1 : 1)]);
}

function circlePlan(cx, cz, r, n = 24) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}

// Every lit part in one unlit mesh. A part flagged `uvKeep` reads its own uvs from `map`; the rest are
// pinned to the map's white corner (or there is no map at all).
function glowMesh(parts, map = null) {
  const g = mergeParts(parts.map((p) => ({ ...p, geometry: p.uvKeep ? p.geometry : pinUV(p.geometry.clone()) })));
  const m = mesh(g, glowMaterial(map ? { map } : {}));
  m.castShadow = false;
  return m;
}

function bodyMaterial(extra = {}) {
  return standard({ vertexColors: true, roughness: 0.45, metalness: 0.2, ...extra });
}

// A slim sensor post standing on the sidewalk at (x, z), looking toward `face` (radians about Y,
// 0 = +Z). A white pole, a pill head with a glowing ring and a dark lens, and a little solar cap.
function sensorPost(body, glow, x, z, face, { height = 9.4, ring = SMART.glowKerb } = {}) {
  const y0 = TOP;
  const add = (list, g, color) => { g.rotateY(face); g.translate(x, 0, z); list.push({ geometry: g, color }); };
  add(body, lathe([[0, y0], [0.42, y0], [0.42, y0 + 0.07], [0.3, y0 + 0.16], [0.13, y0 + 0.4], [0.105, y0 + height - 0.3], [0.17, y0 + height], [0, y0 + height]], 12), FUTURE.white);
  const h0 = y0 + height - 0.05;
  add(body, lathe([[0, h0], [0.22, h0 + 0.05], [0.31, h0 + 0.3], [0.31, h0 + 0.95], [0.22, h0 + 1.15], [0, h0 + 1.2]], 16), FUTURE.pearl);
  add(glow, lathe([[0, h0 + 0.52], [0.325, h0 + 0.52], [0.325, h0 + 0.68], [0, h0 + 0.68]], 16), ring);
  // The lens, facing out from the head, and a smaller one under it.
  const lens = new THREE.SphereGeometry(0.15, 10, 6); lens.scale(1, 1, 0.55); lens.translate(0, h0 + 0.85, 0.27);
  add(body, lens, 0x1c2742);
  const lens2 = new THREE.SphereGeometry(0.09, 8, 5); lens2.scale(1, 1, 0.55); lens2.translate(0, h0 + 0.32, 0.29);
  add(body, lens2, 0x1c2742);
  // A glint in each lens, so it reads as glass rather than a hole.
  const glint = new THREE.SphereGeometry(0.035, 6, 3); glint.translate(0.05, h0 + 0.9, 0.345);
  add(glow, glint, 0xd8f6ff);
  // The solar cap: a tilted dark-blue disc on a stub.
  const cap = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 14); cap.rotateX(-0.35); cap.translate(0, h0 + 1.32, -0.05);
  add(body, cap, 0x31508c);
  const stub = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 8); stub.translate(0, h0 + 1.2, 0);
  add(body, stub, FUTURE.pearl);
  // A thin light line running up the pole face.
  const strip = new THREE.BoxGeometry(0.05, height - 1.4, 0.03); strip.translate(0, y0 + 0.7 + (height - 1.4) / 2, 0.115);
  add(glow, strip, ring);
}

// ---------------------------------------------------------------------------------------------
// smart-road
// ---------------------------------------------------------------------------------------------
function smartRoad() {
  const surface = new Solid(); const charge = new Solid(); const conc = new Solid(); const kerb = new Solid(); const solar = new Solid();
  const body = []; const glow = [];
  const g = ROAD.kerb - GUTTER; // 10.5
  // The carriageway in three bands: the +Z lane, the charging lane's coloured strip, and the rest.
  const cz0 = -9.65; const cz1 = -0.85;
  boxS(surface, -HALF, HALF, BASE, ROADTOP, cz1, g);
  boxS(charge, -HALF, HALF, BASE, ROADTOP, cz0, cz1);
  boxS(surface, -HALF, HALF, BASE, ROADTOP, -g, cz0);
  for (const sz of [1, -1]) {
    const zFace = sz * ROAD.kerb;
    boxS(conc, -HALF, HALF, BASE, ROADTOP, Math.min(zFace, zFace - sz * GUTTER), Math.max(zFace, zFace - sz * GUTTER));
    planSweep(kerb, [[-HALF, zFace], [HALF, zFace]], [[0, sz], [0, sz]], KERB);
    const z0 = sz * (ROAD.kerb + KERB_W); const z1 = sz * (ROAD.kerb + ROAD.sidewalk);
    // The sidewalk slab, its top skin the solar paving.
    boxS(conc, -HALF, HALF, BASE, TOP - TILE_SKIN, Math.min(z0, z1), Math.max(z0, z1));
    boxS(solar, -HALF, HALF, TOP - TILE_SKIN, TOP, Math.min(z0, z1), Math.max(z0, z1));
  }

  // Light lines, where the city road has paint: a double centre line and an edge line each side.
  const ly0 = ROADTOP - 0.02;
  const lines = new Solid(); const edges = new Solid();
  for (const sz of [1, -1]) boxS(lines, -HALF, HALF, ly0, LINE_TOP, sz > 0 ? 0.17 : -0.5, sz > 0 ? 0.5 : -0.17);
  for (const sz of [1, -1]) boxS(edges, -HALF, HALF, ly0, LINE_TOP, sz > 0 ? 9.9 : -10.25, sz > 0 ? 10.25 : -9.9);
  glow.push(part(lines, SMART.glowLane), part(edges, SMART.glowEdge));
  // A glowing line along each kerb top, a few inches back from its nose.
  for (const sz of [1, -1]) {
    const k = new Solid();
    const a = sz * (ROAD.kerb + 0.2); const b = sz * (ROAD.kerb + 0.36);
    boxS(k, -HALF, HALF, TOP - 0.01, TOP + 0.012, Math.min(a, b), Math.max(a, b));
    glow.push(part(k, SMART.glowKerb));
  }

  // The charging lane: four coil pads every 5ft, so copies 20ft apart keep the rhythm. Each is a dark
  // plate with three glowing coil rings and a bolt in the middle, and chevrons point the way cars go.
  const laneZ = (cz0 + cz1) / 2;
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    const plate = new Solid();
    planPrism(plate, rrPlan(x, laneZ, 1.85, 3.0, 0.6), ROADTOP - 0.02, ROADTOP + 0.025);
    body.push(part(plate, SMART.coil));
    const rings = new Solid();
    for (const [hw, hd, r] of [[1.6, 2.72, 0.5], [1.15, 2.05, 0.38], [0.7, 1.38, 0.26]]) {
      bandPlan(rings, rrPlan(x, laneZ, hw, hd, r), rrPlan(x, laneZ, hw - 0.11, hd - 0.11, Math.max(0.05, r - 0.11)), ROADTOP - 0.01, LINE_TOP);
    }
    glow.push(part(rings, SMART.glowCoil));
    const bolt = new Solid();
    planPrism(bolt, boltPlan(x, laneZ, 0.75), ROADTOP - 0.01, LINE_TOP);
    glow.push(part(bolt, SMART.glowBolt));
  }
  // Chevrons in the +Z lane pointing +X (traffic keeps right), 5ft apart.
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    const ch = new Solid();
    const zc = 5.4;
    const pts = [[x + 0.55, zc], [x - 0.35, zc + 1.6], [x - 0.75, zc + 1.6], [x + 0.15, zc], [x - 0.75, zc - 1.6], [x - 0.35, zc - 1.6]];
    planPrism(ch, pts, ROADTOP - 0.01, LINE_TOP);
    glow.push(part(ch, 0x63a9ff));
  }

  // LED studs set in the solar paving, one at each tile corner along a line down each sidewalk.
  for (const sz of [1, -1]) {
    for (let i = 0; i < 8; i++) {
      const x = -HALF + 1.25 + i * 2.5;
      const z = sz * 17.5;
      const d = new THREE.CylinderGeometry(0.13, 0.13, 0.025, 12); d.translate(x, TOP + 0.005, z);
      glow.push({ geometry: d, color: SMART.glowLed });
    }
  }

  // A slot drain in the +Z gutter: a dark slot with a steel lip, the modern grate.
  const slot = new Solid(); const lip = new Solid();
  const sz0 = ROAD.kerb - 0.95; const sz1 = ROAD.kerb - 0.75;
  boxS(slot, -3, 3, ROADTOP - 0.03, ROADTOP + 0.004, sz0, sz1);
  boxS(lip, -3.1, 3.1, ROADTOP - 0.03, ROADTOP + 0.012, sz0 - 0.06, sz0);
  boxS(lip, -3.1, 3.1, ROADTOP - 0.03, ROADTOP + 0.012, sz1, sz1 + 0.06);
  body.push(part(slot, 0x141822), part(lip, 0x8d96a3));

  // The sensor post on the +Z sidewalk, looking at the road.
  sensorPost(body, glow, 0, ROAD.kerb + 1.4, Math.PI);

  const group = new THREE.Group();
  const surf = planarUV(mergeParts([part(surface, SMART.surface), part(charge, SMART.charge)]), 4);
  group.add(mesh(surf, texturedMaterial(smartSurfaceTexture(411), { roughness: 0.55, bump: 0.25 })));
  const cg = planarUV(mergeParts([part(conc, SMART.gutter), part(kerb, SMART.kerb)]), 5);
  group.add(mesh(cg, texturedMaterial(concreteTexture(412), { roughness: 0.85, bump: 0.4 })));
  const sg = planarUV(mergeParts([part(solar, SMART.solar)]), 5);
  group.add(mesh(sg, texturedMaterial(solarTileTexture(413), { roughness: 0.32, bump: 0.3, metalness: 0.15 })));
  const bm = mesh(mergeParts(body), bodyMaterial());
  group.add(bm);
  group.add(glowMesh(glow));
  return group;
}

// ---------------------------------------------------------------------------------------------
// smart-intersection
// ---------------------------------------------------------------------------------------------
// road-intersection's plan, reproduced number for number: one corner drawn in the (+x, +z) frame and
// turned by quarter turns. Its kerb line runs from the +X edge along z = 12, round a radius-6 return
// centred at (18, 18), and out along x = 12, with a diagonal ramp in the middle of the return.
const R = RETURN_R;
const C = ROAD.kerb + R;
const E = ROAD.width / 2;
const PHI_F = 45 * deg - Math.asin(3.8 / R);
const PHI_P = 45 * deg - Math.asin(2.5 / R);
const arcAt = (phi, r = R) => [C - Math.sin(phi) * r, C - Math.cos(phi) * r];
const radial = (phi) => [Math.sin(phi), Math.cos(phi)];

function kerbLine() {
  const pts = [[E, ROAD.kerb], [C, ROAD.kerb]];
  const nrm = [[0, 1], [0, 1]];
  for (const phi of [PHI_F, PHI_P, 90 * deg - PHI_P, 90 * deg - PHI_F]) { pts.push(arcAt(phi)); nrm.push(radial(phi)); }
  pts.push([ROAD.kerb, C], [ROAD.kerb, E]);
  nrm.push([1, 0], [1, 0]);
  return { pts, nrm };
}

const turn = (k) => (p) => {
  let [x, z] = p;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) { const t = x; x = z; z = -t; }
  return [x, z];
};

function turnSolid(s, k) {
  const f = turn(k);
  const out = new Solid();
  for (let i = 0; i < s.p.length; i += 3) {
    const [x, z] = f([s.p[i], s.p[i + 2]]);
    out.p.push(x, s.p[i + 1], z);
  }
  return out;
}

function smartIntersection() {
  const { pts, nrm } = kerbLine();
  const offset = (i, d) => [pts[i][0] + nrm[i][0] * d, pts[i][1] + nrm[i][1] * d];

  // ---- one corner, in the (+,+) frame
  const conc = new Solid(); const kerb = new Solid(); const solar = new Solid(); const pad = new Solid();
  const dimBars = new Solid(); const white = new Solid(); const lane = new Solid(); const kerbGlow = new Solid();
  const cornerBody = []; const cornerGlow = [];
  planSweep(conc, pts, nrm, [[-GUTTER, BASE], [0, BASE], [0, ROADTOP], [-GUTTER, ROADTOP]]);
  planSweep(kerb, pts.slice(0, 3), nrm.slice(0, 3), KERB);
  planSweep(kerb, pts.slice(5), nrm.slice(5), KERB);
  // The kerb glow, the smart road's line carried round the corner.
  const glowProfile = [[0.2, TOP - 0.01], [0.36, TOP - 0.01], [0.36, TOP + 0.012], [0.2, TOP + 0.012]];
  planSweep(kerbGlow, pts.slice(0, 3), nrm.slice(0, 3), glowProfile);
  planSweep(kerbGlow, pts.slice(5), nrm.slice(5), glowProfile);

  const u = [Math.SQRT1_2, Math.SQRT1_2];
  const pp = [-Math.SQRT1_2, Math.SQRT1_2];
  const M = arcAt(45 * deg);
  const backC = [M[0] + u[0] * 5.5, M[1] + u[1] * 5.5];
  const F1 = pts[2]; const P1 = pts[3]; const P2 = pts[4]; const F2 = pts[5];
  const K1 = offset(2, KERB_W); const K2 = offset(5, KERB_W);
  const Q1 = [backC[0] - pp[0] * 2, backC[1] - pp[1] * 2];
  const Q2 = [backC[0] + pp[0] * 2, backC[1] + pp[1] * 2];
  const LOW = ROADTOP + 0.025;
  const rampPts = [F1, P1, P2, F2, K2, Q2, Q1, K1];
  const rampTop = [TOP, LOW, LOW, TOP, TOP, TOP, TOP, TOP];
  const rampTris = [[0, 1, 6], [0, 6, 7], [1, 2, 5], [1, 5, 6], [2, 3, 5], [3, 4, 5]];
  planPrism(conc, rampPts, BASE, rampTop, rampTris);
  const aP = (P1[0] - M[0]) * u[0] + (P1[1] - M[1]) * u[1];
  const aQ = 5.5;
  const runY = (a) => LOW + (TOP - LOW) * (a - aP) / (aQ - aP);

  // The sidewalk slab, notched for the ramp, with solar paving as its top skin.
  const slab = [[E, E], [E, ROAD.kerb + KERB_W], [C, ROAD.kerb + KERB_W], K1, Q1, Q2, K2, [ROAD.kerb + KERB_W, C], [ROAD.kerb + KERB_W, E]];
  planPrism(conc, slab, BASE, TOP - TILE_SKIN);
  planPrism(solar, slab, TOP - TILE_SKIN, TOP);

  // The warning pad on the ramp: a plate with truncated domes, in lime rather than yellow, and lit.
  const padAt = (a, w) => [M[0] + u[0] * a + pp[0] * w, M[1] + u[1] * a + pp[1] * w];
  const a0 = aP + 0.12; const a1 = aP + 2.12; const hw = 1.95;
  planPrism(pad, [padAt(a0, -hw), padAt(a0, hw), padAt(a1, hw), padAt(a1, -hw)],
    [runY(a0) - 0.03, runY(a0) - 0.03, runY(a1) - 0.03, runY(a1) - 0.03],
    [runY(a0) + 0.02, runY(a0) + 0.02, runY(a1) + 0.02, runY(a1) + 0.02]);
  // A glowing lime border round the pad, so the ramp's edge is lit at night.
  const padRing = new Solid();
  const ring = [padAt(a0 - 0.08, -hw - 0.08), padAt(a0 - 0.08, hw + 0.08), padAt(a1 + 0.08, hw + 0.08), padAt(a1 + 0.08, -hw - 0.08)];
  const inner = [padAt(a0 + 0.05, -hw + 0.05), padAt(a0 + 0.05, hw - 0.05), padAt(a1 - 0.05, hw - 0.05), padAt(a1 - 0.05, -hw + 0.05)];
  const ry = (p) => runY((p[0] - M[0]) * u[0] + (p[1] - M[1]) * u[1]);
  for (let q = 0; q < 4; q++) {
    const o0 = ring[q]; const o1 = ring[(q + 1) % 4]; const i0 = inner[q]; const i1 = inner[(q + 1) % 4];
    const lift = 0.035;
    padRing.quad([o0[0], ry(o0) + lift, o0[1]], [o1[0], ry(o1) + lift, o1[1]], [i1[0], ry(i1) + lift, i1[1]], [i0[0], ry(i0) + lift, i0[1]], [0, 1, 0]);
    padRing.quad([o0[0], ry(o0) - 0.05, o0[1]], [o1[0], ry(o1) - 0.05, o1[1]], [i1[0], ry(i1) - 0.05, i1[1]], [i0[0], ry(i0) - 0.05, i0[1]], [0, -1, 0]);
    padRing.quad([o0[0], ry(o0) - 0.05, o0[1]], [o1[0], ry(o1) - 0.05, o1[1]], [o1[0], ry(o1) + lift, o1[1]], [o0[0], ry(o0) + lift, o0[1]], [(o0[0] + o1[0]) / 2 - M[0] - u[0] * (a0 + a1) / 2, 0, (o0[1] + o1[1]) / 2 - M[1] - u[1] * (a0 + a1) / 2]);
    padRing.quad([i0[0], ry(i0) - 0.05, i0[1]], [i1[0], ry(i1) - 0.05, i1[1]], [i1[0], ry(i1) + lift, i1[1]], [i0[0], ry(i0) + lift, i0[1]], [-((i0[0] + i1[0]) / 2 - M[0] - u[0] * (a0 + a1) / 2), 0, -((i0[1] + i1[1]) / 2 - M[1] - u[1] * (a0 + a1) / 2)]);
  }

  // ---- the +X arm's light markings: six crosswalk bars, a stop line in the arriving lane, and the
  // smart road's double centre line carried in from the edge.
  const PY0 = ROADTOP - 0.02;
  for (const zc of [-9, -5, -1, 1, 5, 9]) {
    boxS(dimBars, 12.5, 18.1, PY0, LINE_TOP, zc - 1, zc + 1);
  }
  boxS(white, 19.0, 19.9, PY0, LINE_TOP, -(ROAD.kerb - GUTTER) + 0.25, -0.35);
  boxS(lane, 18.6, E, PY0, LINE_TOP, 0.17, 0.5);
  boxS(lane, 18.6, E, PY0, LINE_TOP, -0.5, -0.17);
  // The edge lines too, from the crosswalk to the edge, so the smart road's line has an end.
  boxS(white, 18.6, E, PY0, LINE_TOP, 9.9, 10.25);
  boxS(white, 18.6, E, PY0, LINE_TOP, -10.25, -9.9);

  // ---- the corner's furniture: a sensor post beside the crosswalk, a big planter in the corner and a
  // small one on the other side of the ramp.
  sensorPost(cornerBody, cornerGlow, 19.25, 13.55, -Math.PI / 2 - 0.5);
  planter(cornerBody, cornerGlow, 18.7, 18.7, 0.95, 701, { tree: true });

  // ---- the four corners and the four arms
  const concParts = []; const solarParts = []; const bodyParts = []; const glowParts = []; const litParts = [];
  for (let k = 0; k < 4; k++) {
    concParts.push(part(turnSolid(conc, k), SMART.gutter), part(turnSolid(kerb, k), SMART.kerb));
    solarParts.push(part(turnSolid(solar, k), SMART.solar));
    bodyParts.push(part(turnSolid(pad, k), 0xe9b63a));
    glowParts.push(part(turnSolid(white, k), SMART.glowEdge), part(turnSolid(lane, k), SMART.glowLane), part(turnSolid(kerbGlow, k), SMART.glowKerb));
    const rot = new THREE.Matrix4().makeRotationY(k * Math.PI / 2);
    glowParts.push(part(turnSolid(padRing, k), FUTURE.glowCyan));
    for (const p of cornerBody) bodyParts.push({ geometry: p.geometry.clone().applyMatrix4(rot), color: p.color });
    for (const p of cornerGlow) glowParts.push({ geometry: p.geometry.clone().applyMatrix4(rot), color: p.color });
  }
  // The crosswalks turn as one piece: three dim arms and the lit one, so nothing ever lies on top of
  // anything else and a quarter turn simply moves which arm is lit.
  litParts.push(part(dimBars, 0xd8fbff));
  for (let k = 1; k < 4; k++) litParts.push(part(turnSolid(dimBars, k), 0x2f9fc4));
  // Footprints walking across the lit crosswalk, glowing gold.
  for (let i = 0; i < 6; i++) {
    const zc = -7.5 + i * 3;
    for (const [dx, dz] of [[-0.35, -0.4], [0.35, 0.4]]) {
      const f = new Solid();
      planPrism(f, rrPlan(15.3 + dx, zc + dz, 0.22, 0.42, 0.18, 2), PY0, LINE_TOP + 0.03);
      litParts.push(part(f, FUTURE.glowGold));
    }
  }

  // The middle of the crossing: two rings of light, the "connected" hub every car talks to.
  {
    const rings = new Solid();
    bandPlan(rings, circlePlan(0, 0, 4.3, 48), circlePlan(0, 0, 4.05, 48), PY0, LINE_TOP);
    bandPlan(rings, circlePlan(0, 0, 2.2, 36), circlePlan(0, 0, 2.0, 36), PY0, LINE_TOP);
    glowParts.push(part(rings, 0x8a7bff));
    for (let k = 0; k < 4; k++) {
      const tick = new Solid();
      const a = k * Math.PI / 2;
      const c = Math.cos(a); const s = Math.sin(a);
      const pt = (r, w) => [c * r - s * w, s * r + c * w];
      planPrism(tick, [pt(2.6, -0.12), pt(3.7, -0.12), pt(3.7, 0.12), pt(2.6, 0.12)], PY0, LINE_TOP);
      glowParts.push(part(tick, 0x8a7bff));
    }
  }

  // Asphalt: road-intersection's decomposition exactly.
  const gutterOuter = pts.map((_, i) => offset(i, -GUTTER));
  const g = ROAD.kerb - GUTTER;
  const asphalt = new Solid();
  boxS(asphalt, -g, g, BASE, ROADTOP, -g, g);
  const quarter = new Solid();
  boxS(quarter, g, C, BASE, ROADTOP, -g, g);
  boxS(quarter, C, E, BASE, ROADTOP, -g, g);
  planPrism(quarter, [[g, g], ...gutterOuter.slice(1, -1)], BASE, ROADTOP);
  for (let k = 0; k < 4; k++) asphalt.p.push(...turnSolid(quarter, k).p);

  const group = new THREE.Group();
  group.add(mesh(planarUV(mergeParts([part(asphalt, SMART.surface)]), 4), texturedMaterial(smartSurfaceTexture(421), { roughness: 0.55, bump: 0.25 })));
  group.add(mesh(planarUV(mergeParts(concParts), 5), texturedMaterial(concreteTexture(422), { roughness: 0.85, bump: 0.4 })));
  group.add(mesh(planarUV(mergeParts(solarParts), 5), texturedMaterial(solarTileTexture(423), { roughness: 0.32, bump: 0.3, metalness: 0.15 })));
  group.add(mesh(mergeParts(bodyParts), bodyMaterial()));
  group.add(glowMesh(glowParts));

  // THE MOVING LIGHT. One crosswalk at a time lights up bright, as if somebody had stepped onto it,
  // and the light moves on to the next arm every few seconds. Only an inner group turns; the root
  // never moves.
  const lit = new THREE.Group();
  lit.add(glowMesh(litParts));
  group.add(lit);
  let t = 0; let arm = 0;
  group.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      t += Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      if (t >= 3.5) {
        t -= 3.5;
        arm = (arm + 1) % 4;
        lit.rotation.y = arm * Math.PI / 2;
      }
    },
    dispose() {},
  };
  return group;
}

// A round planter on the sidewalk: a white tub with a glowing band, soil, a clipped bush or a little
// tree, and bright flowers round the rim.
function planter(body, glow, x, z, r, seed, { tree = false } = {}) {
  const rng = seededRandom(seed);
  const y0 = TOP;
  const tub = lathe([[0, y0], [r * 0.86, y0], [r, y0 + 0.12], [r * 1.02, y0 + 1.4], [r * 1.1, y0 + 1.5], [r * 1.1, y0 + 1.6], [r * 0.95, y0 + 1.6], [r * 0.93, y0 + 1.45], [0, y0 + 1.45]], 18);
  tub.translate(x, 0, z);
  body.push({ geometry: tub, color: FUTURE.white });
  const band = lathe([[0, y0 + 0.5], [r * 1.025, y0 + 0.5], [r * 1.03, y0 + 0.62], [0, y0 + 0.62]], 18);
  band.translate(x, 0, z);
  glow.push({ geometry: band, color: FUTURE.glowLime });
  const soil = new THREE.CylinderGeometry(r * 0.93, r * 0.93, 0.08, 14); soil.translate(x, y0 + 1.48, z);
  body.push({ geometry: soil, color: 0x5a4330 });
  if (tree) {
    const trunk = tube([[x, y0 + 1.4, z], [x + 0.06, y0 + 3.0, z - 0.04], [x - 0.03, y0 + 4.3, z + 0.03]], [0.13, 0.1, 0.08], { sides: 6, steps: 8, round: 0 });
    body.push({ geometry: trunk, color: 0x7a5a3e });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4 + rng() * 0.3;
      const s = new THREE.IcosahedronGeometry(0.62 + rng() * 0.12, 1);
      s.translate(x + Math.cos(a) * 0.42, y0 + 4.5 + (rng() - 0.5) * 0.4, z + Math.sin(a) * 0.42);
      body.push({ geometry: s, color: i % 2 ? 0x3fa34d : 0x5bbd4f });
    }
    const top = new THREE.IcosahedronGeometry(0.7, 1); top.translate(x, y0 + 5.1, z);
    body.push({ geometry: top, color: 0x4fb35a });
  } else {
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2; const d = rng() * r * 0.45;
      const s = new THREE.IcosahedronGeometry(r * (0.4 + rng() * 0.15), 1);
      s.translate(x + Math.cos(a) * d, y0 + 1.65 + rng() * r * 0.3, z + Math.sin(a) * d);
      body.push({ geometry: s, color: rng() < 0.5 ? 0x3fa34d : 0x4fb35a });
    }
  }
  const flowerColours = [FUTURE.magenta, FUTURE.sun, FUTURE.violet, FUTURE.coral];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
    const f = new THREE.IcosahedronGeometry(0.13, 0);
    f.translate(x + Math.cos(a) * r * 0.74, y0 + 1.6 + rng() * 0.12, z + Math.sin(a) * r * 0.74);
    body.push({ geometry: f, color: flowerColours[i % 4] });
  }
}

// ---------------------------------------------------------------------------------------------
// Pieces of a solid of revolution about the X axis, for the tube and the maglev's pylons' saddles.
// theta is measured from +Z toward +Y, so (x, cy + r sin, r cos).
// ---------------------------------------------------------------------------------------------
class SmoothSoup {
  constructor() { this.p = []; this.n = []; }

  // Four corners with their normals; flipped if the geometric face disagrees with `want`.
  quad(a, b, c, d, na, nb, nc, nd, want) {
    const ux = b[0] - a[0]; const uy = b[1] - a[1]; const uz = b[2] - a[2];
    const vx = c[0] - a[0]; const vy = c[1] - a[1]; const vz = c[2] - a[2];
    const fx = uy * vz - uz * vy; const fy = uz * vx - ux * vz; const fz = ux * vy - uy * vx;
    if (fx * want[0] + fy * want[1] + fz * want[2] < 0) {
      [b, d] = [d, b]; [nb, nd] = [nd, nb];
    }
    this.p.push(...a, ...b, ...c, ...a, ...c, ...d);
    this.n.push(...na, ...nb, ...nc, ...na, ...nc, ...nd);
  }

  flat(a, b, c, d, want) {
    const L = Math.hypot(want[0], want[1], want[2]) || 1;
    const nn = [want[0] / L, want[1] / L, want[2] / L];
    this.quad(a, b, c, d, nn, nn, nn, nn, want);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((this.p.length / 3) * 2), 2));
    return g;
  }
}

const ringPt = (x, cy, r, th) => [x, cy + r * Math.sin(th), r * Math.cos(th)];
const ringN = (th, s = 1) => [0, s * Math.sin(th), s * Math.cos(th)];

// An annular sector about the X axis: x0..x1, theta ta..tb, radius r0..r1, closed. With a full turn the
// two radial sides are left off, since they would meet inside the solid.
function arcBand(soup, x0, x1, ta, tb, r0, r1, cy, segs) {
  const full = Math.abs(tb - ta - Math.PI * 2) < 1e-6;
  for (let i = 0; i < segs; i++) {
    const t0 = ta + (tb - ta) * (i / segs); const t1 = ta + (tb - ta) * ((i + 1) / segs);
    const tm = (t0 + t1) / 2;
    // outer and inner skins
    soup.quad(ringPt(x0, cy, r1, t0), ringPt(x1, cy, r1, t0), ringPt(x1, cy, r1, t1), ringPt(x0, cy, r1, t1), ringN(t0), ringN(t0), ringN(t1), ringN(t1), ringN(tm));
    soup.quad(ringPt(x0, cy, r0, t0), ringPt(x1, cy, r0, t0), ringPt(x1, cy, r0, t1), ringPt(x0, cy, r0, t1), ringN(t0, -1), ringN(t0, -1), ringN(t1, -1), ringN(t1, -1), ringN(tm, -1));
    // the two end annuli
    soup.flat(ringPt(x0, cy, r0, t0), ringPt(x0, cy, r1, t0), ringPt(x0, cy, r1, t1), ringPt(x0, cy, r0, t1), [-1, 0, 0]);
    soup.flat(ringPt(x1, cy, r0, t0), ringPt(x1, cy, r1, t0), ringPt(x1, cy, r1, t1), ringPt(x1, cy, r0, t1), [1, 0, 0]);
  }
  if (!full) {
    for (const [th, s] of [[ta, -1], [tb, 1]]) {
      const tn = [0, s * Math.cos(th), -s * Math.sin(th)];
      soup.flat(ringPt(x0, cy, r0, th), ringPt(x1, cy, r0, th), ringPt(x1, cy, r1, th), ringPt(x0, cy, r1, th), tn);
    }
  }
}

// The tube's sign: the canvas's top strip is white for the other lit parts, the rest is the sign.
const SIGN_V = 0.89;
function loopSignTexture() {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, 14);
    const y0 = 14; const sh = h - y0;
    ctx.fillStyle = '#0e2140';
    ctx.fillRect(0, y0, w, sh);
    ctx.strokeStyle = '#5cf2ff'; ctx.lineWidth = 6;
    ctx.strokeRect(6, y0 + 6, w - 12, sh - 12);
    // Chevrons either side, in pink, pointing along the line.
    ctx.fillStyle = '#ff5ccf';
    for (const [cx, dir] of [[44, 1], [w - 44, -1]]) {
      for (let k = 0; k < 2; k++) {
        const x = cx + dir * (k * 18 - 9);
        ctx.beginPath();
        ctx.moveTo(x - dir * 10, y0 + sh / 2 - 26); ctx.lineTo(x + dir * 10, y0 + sh / 2); ctx.lineTo(x - dir * 10, y0 + sh / 2 + 26);
        ctx.lineTo(x - dir * 18, y0 + sh / 2 + 26); ctx.lineTo(x + dir * 2, y0 + sh / 2); ctx.lineTo(x - dir * 18, y0 + sh / 2 - 26);
        ctx.closePath(); ctx.fill();
      }
    }
    const text = 'LOOP LINE';
    let px = 70;
    ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`;
    const maxW = w - 200;
    const mw = ctx.measureText(text).width;
    if (mw > maxW) { px = Math.floor(px * maxW / mw); ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8ff6ff';
    ctx.fillText(text, w / 2, y0 + sh / 2 + 3);
  });
}

// ---------------------------------------------------------------------------------------------
// hyperloop-tube
// ---------------------------------------------------------------------------------------------
export const HYPERLOOP = { length: 40, outerR: 5, centreY: 12, innerR: 4.55 };
const HL = HYPERLOOP;
const L2 = HL.length / 2;

function hyperloopTube() {
  const shell = new SmoothSoup();
  const N = 72;
  const thAt = (j) => -Math.PI + (j / N) * Math.PI * 2;
  const J0 = 25; const J1 = 42; // the window, from -55 to +30 degrees on the +Z side
  const WX = 12.5;
  const xs = [-L2, -WX, WX, L2];
  const cy = HL.centreY; const Ro = HL.outerR; const Ri = HL.innerR;
  const isWin = (j, k) => k === 1 && j >= J0 && j < J1;
  for (let j = 0; j < N; j++) {
    const t0 = thAt(j); const t1 = thAt(j + 1); const tm = (t0 + t1) / 2;
    for (let k = 0; k < 3; k++) {
      if (isWin(j, k)) continue;
      const a = xs[k]; const b = xs[k + 1];
      shell.quad(ringPt(a, cy, Ro, t0), ringPt(b, cy, Ro, t0), ringPt(b, cy, Ro, t1), ringPt(a, cy, Ro, t1), ringN(t0), ringN(t0), ringN(t1), ringN(t1), ringN(tm));
      shell.quad(ringPt(a, cy, Ri, t0), ringPt(b, cy, Ri, t0), ringPt(b, cy, Ri, t1), ringPt(a, cy, Ri, t1), ringN(t0, -1), ringN(t0, -1), ringN(t1, -1), ringN(t1, -1), ringN(tm, -1));
    }
    // End annuli at both ends, flush with x = +/-20.
    shell.flat(ringPt(-L2, cy, Ri, t0), ringPt(-L2, cy, Ro, t0), ringPt(-L2, cy, Ro, t1), ringPt(-L2, cy, Ri, t1), [-1, 0, 0]);
    shell.flat(ringPt(L2, cy, Ri, t0), ringPt(L2, cy, Ro, t0), ringPt(L2, cy, Ro, t1), ringPt(L2, cy, Ri, t1), [1, 0, 0]);
    // The window's two end reveals.
    if (j >= J0 && j < J1) {
      shell.flat(ringPt(-WX, cy, Ri, t0), ringPt(-WX, cy, Ro, t0), ringPt(-WX, cy, Ro, t1), ringPt(-WX, cy, Ri, t1), [1, 0, 0]);
      shell.flat(ringPt(WX, cy, Ri, t0), ringPt(WX, cy, Ro, t0), ringPt(WX, cy, Ro, t1), ringPt(WX, cy, Ri, t1), [-1, 0, 0]);
    }
  }
  // The window's sill and head reveals.
  for (const [j, s] of [[J0, 1], [J1, -1]]) {
    const th = thAt(j);
    shell.flat(ringPt(-WX, cy, Ri, th), ringPt(WX, cy, Ri, th), ringPt(WX, cy, Ro, th), ringPt(-WX, cy, Ro, th), [0, s * Math.cos(th), -s * Math.sin(th)]);
  }
  const shellG = shell.geometry();
  // Inside is a pale blue-grey, outside white: colour by radius.
  {
    const P = shellG.attributes.position;
    const col = new Float32Array(P.count * 3);
    const cOut = new THREE.Color(FUTURE.white); const cIn = new THREE.Color(0xa9bdd6);
    for (let i = 0; i < P.count; i++) {
      const r = Math.hypot(P.getY(i) - cy, P.getZ(i));
      const c = r < (Ro + Ri) / 2 && Math.abs(Math.abs(P.getX(i)) - L2) > 1e-4 ? cIn : cOut;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    shellG.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  const body = [{ geometry: shellG, keepColor: true }];
  const glow = [];
  const winA = thAt(J0); const winB = thAt(J1);

  // Mullions across the window, white ribs running the full wall thickness.
  const mull = new SmoothSoup();
  for (const x of [-8.4, -4.2, 0, 4.2, 8.4]) arcBand(mull, x - 0.09, x + 0.09, winA, winB, Ri + 0.05, Ro - 0.01, cy, 8);
  body.push({ geometry: mull.geometry(), color: FUTURE.pearl });

  // The joint flanges: a raised collar at each end, flush with the end, and its bolt heads.
  const collar = new SmoothSoup();
  arcBand(collar, -L2, -L2 + 0.45, 0, Math.PI * 2, Ro - 0.02, Ro + 0.28, cy, 64);
  arcBand(collar, L2 - 0.45, L2, 0, Math.PI * 2, Ro - 0.02, Ro + 0.28, cy, 64);
  body.push({ geometry: collar.geometry(), color: 0xc9d3de });
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 16; i++) {
      const th = (i / 16) * Math.PI * 2;
      const b = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6);
      b.translate(0, Ro + 0.31, 0); b.rotateX(Math.PI / 2 - th); b.translate(sx * (L2 - 0.22), cy, 0);
      body.push({ geometry: b, color: 0x8c96a4 });
    }
  }

  // Glowing rings either side of the window, a frame round it and a stripe the full length.
  const rings = new SmoothSoup();
  for (const x of [-16.25, 16.25]) arcBand(rings, x - 0.2, x + 0.2, 0, Math.PI * 2, Ro - 0.02, Ro + 0.045, cy, 72);
  glow.push({ geometry: rings.geometry(), color: FUTURE.glowCyan });
  const frame = new SmoothSoup();
  const fw = 1.3 * deg;
  arcBand(frame, -WX - 0.18, WX + 0.18, winA - fw, winA, Ro - 0.02, Ro + 0.04, cy, 4);
  arcBand(frame, -WX - 0.18, WX + 0.18, winB, winB + fw, Ro - 0.02, Ro + 0.04, cy, 4);
  arcBand(frame, -WX - 0.18, -WX, winA, winB, Ro - 0.02, Ro + 0.04, cy, 12);
  arcBand(frame, WX, WX + 0.18, winA, winB, Ro - 0.02, Ro + 0.04, cy, 12);
  glow.push({ geometry: frame.geometry(), color: 0x7ff6ff });
  const stripe = new SmoothSoup();
  for (const th of [52 * deg, 128 * deg]) arcBand(stripe, -L2 + 0.45, L2 - 0.45, th - 1.1 * deg, th + 1.1 * deg, Ro - 0.02, Ro + 0.03, cy, 2);
  glow.push({ geometry: stripe.geometry(), color: FUTURE.glowPink });
  // The line's name on a lit sign on each side, above the window: LOOP LINE.
  for (const side of [1, -1]) {
    const ta = side > 0 ? 33 * deg : 132 * deg; const tb = side > 0 ? 48 * deg : 147 * deg;
    const sx0 = -3.2; const sx1 = 3.2;
    const soup = new SmoothSoup();
    arcBand(soup, sx0, sx1, ta, tb, Ro - 0.02, Ro + 0.05, cy, 10);
    const g = soup.geometry();
    const P = g.attributes.position; const Nn = g.attributes.normal; const uv = g.attributes.uv;
    for (let k = 0; k < P.count; k++) {
      const y = P.getY(k) - cy; const z = P.getZ(k);
      const r = Math.hypot(y, z);
      const outer = Math.abs(r - (Ro + 0.05)) < 1e-3 && Math.abs(Nn.getX(k)) < 0.5;
      if (!outer) { uv.setXY(k, 0.5, 0.3); continue; }
      const th = Math.atan2(y, z);
      const fu = (P.getX(k) - sx0) / (sx1 - sx0);
      const fv = side > 0 ? (th - ta) / (tb - ta) : (tb - th) / (tb - ta);
      uv.setXY(k, side > 0 ? fu : 1 - fu, fv * SIGN_V);
    }
    glow.push({ geometry: g, color: 0xffffff, uvKeep: true });
  }

  // Inside: a deck across the bottom, the guide rail down its middle with glowing sides, and a light
  // line along the ceiling.
  const deck = new Solid();
  boxS(deck, -L2, L2, cy - 3.55, cy - 3.0, -3.25, 3.25);
  body.push(part(deck, 0x7c8aa0));
  const rail = new Solid();
  planPrism(rail, [[-L2, -0.35], [L2, -0.35], [L2, 0.35], [-L2, 0.35]], cy - 3.0, cy - 2.7);
  boxS(rail, -L2, L2, cy - 2.7, cy - 2.4, -0.62, 0.62);
  body.push(part(rail, 0x55607a));
  for (const sz of [1, -1]) {
    const s = new Solid();
    boxS(s, -L2, L2, cy - 2.66, cy - 2.46, sz > 0 ? 0.62 : -0.65, sz > 0 ? 0.65 : -0.62);
    glow.push(part(s, FUTURE.glowCyan));
  }
  // Two running strips on the deck either side of the rail.
  for (const sz of [1, -1]) {
    const s = new Solid();
    boxS(s, -L2, L2, cy - 3.0, cy - 2.97, sz * 1.9 - 0.25, sz * 1.9 + 0.25);
    glow.push(part(s, 0x6a7cff));
  }
  const ceil = new SmoothSoup();
  arcBand(ceil, -L2, L2, 87 * deg, 93 * deg, Ri - 0.04, Ri + 0.01, cy, 2);
  glow.push({ geometry: ceil.geometry(), color: 0xeafcff });

  // Two pylons at x = +/-10, so a line of tubes has one every 20ft. Each is a tapering column with a
  // violet saddle that cradles the tube, a glowing ring and a light line along the saddle's edge.
  for (const px of [-10, 10]) {
    const col = lathe([[0, -0.3], [1.55, -0.3], [1.55, 0.1], [1.25, 0.3], [0.82, 1.6], [0.62, 3.6], [0.7, 5.4], [1.05, 6.5], [0, 6.75]], 28);
    col.scale(1, 1, 0.82); col.translate(px, 0, 0);
    body.push({ geometry: col, color: FUTURE.pearl });
    const saddle = new SmoothSoup();
    arcBand(saddle, px - 1.15, px + 1.15, -125 * deg, -55 * deg, Ro - 0.03, Ro + 0.45, cy, 16);
    body.push({ geometry: saddle.geometry(), color: FUTURE.violet });
    const sg = new SmoothSoup();
    arcBand(sg, px - 1.19, px - 1.13, -123 * deg, -57 * deg, Ro + 0.05, Ro + 0.38, cy, 16);
    arcBand(sg, px + 1.13, px + 1.19, -123 * deg, -57 * deg, Ro + 0.05, Ro + 0.38, cy, 16);
    glow.push({ geometry: sg.geometry(), color: FUTURE.glowPink });
    const ringG = lathe([[0, 4.7], [0.68, 4.7], [0.69, 4.95], [0, 4.95]], 28);
    ringG.scale(1, 1, 0.82); ringG.translate(px, 0, 0);
    glow.push({ geometry: ringG, color: FUTURE.glowCyan });
    const foot = lathe([[0, -0.3], [1.62, -0.3], [1.62, 0.12], [0, 0.12]], 28);
    foot.scale(1, 1, 0.82); foot.translate(px, 0, 0);
    body.push({ geometry: foot, color: 0x9aa3b0 });
  }

  // The glass: one tinted, see-through pane in the wall's thickness.
  const glass = new SmoothSoup();
  arcBand(glass, -WX, WX, winA, winB, Ro - 0.24, Ro - 0.22, cy, J1 - J0);
  const glassG = glass.geometry();

  const group = new THREE.Group();
  group.add(mesh(mergeParts(body), bodyMaterial({ roughness: 0.38, metalness: 0.12 })));
  group.add(glowMesh(glow, loopSignTexture()));
  const gm = mesh(glassG, standard({ color: 0x8fe6ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }));
  gm.castShadow = false;
  group.add(gm);
  return group;
}

// ---------------------------------------------------------------------------------------------
// maglev-track
// ---------------------------------------------------------------------------------------------
export const MAGLEV = { length: 40, top: 3.2, width: 3 };

// A cross-section [[z, y]] extruded along X from x0 to x1.
function extrudeX(section, x0, x1) {
  const g = prismXY(section, x0, x1);
  g.rotateY(Math.PI / 2); // z -> x; the section's horizontal ends up along -z, and it is symmetric
  return g;
}

// A closed loft along X of superellipse sections { x, yc, hh, hw }: hh is the vertical half height
// and hw the half width across Z.
function loftX(stations, { sides = 24, p = 4 } = {}) {
  const pos = []; const idx = [];
  const e = 2 / p;
  for (const st of stations) {
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a); const s = Math.sin(a);
      pos.push(st.x, st.yc + st.hh * Math.sign(s) * Math.abs(s) ** e, st.hw * Math.sign(c) * Math.abs(c) ** e);
    }
  }
  const rows = stations.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      idx.push(i * sides + j, (i + 1) * sides + j, (i + 1) * sides + j2, i * sides + j, (i + 1) * sides + j2, i * sides + j2);
    }
  }
  // Flat end caps with their own vertices, so their normals stay flat.
  const cap = (st, sgn) => {
    const c0 = pos.length / 3;
    pos.push(st.x, st.yc, 0);
    const ring = pos.length / 3;
    const ri = sgn < 0 ? 0 : (rows - 1) * sides;
    for (let j = 0; j < sides; j++) pos.push(pos[(ri + j) * 3], pos[(ri + j) * 3 + 1], pos[(ri + j) * 3 + 2]);
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      if (sgn < 0) idx.push(c0, ring + j, ring + j2); else idx.push(c0, ring + j2, ring + j);
    }
  };
  cap(stations[0], -1); cap(stations[rows - 1], 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

function maglevTrack() {
  const body = []; const glow = [];
  const T = MAGLEV.top; const W = MAGLEV.width / 2;
  const SKIN = 0.025; // the running surface is the top skin of the flange
  // The beam is a T: a flange 3ft across with chamfered undersides, on a web whose underside swoops
  // down over each pylon and up between them. The swoop repeats every 20ft, so it runs on unbroken
  // from one section into the next and both ends are the same cut.
  const flange = [[-W, T - SKIN], [-W, T - 0.45], [-W + 0.2, T - 0.65], [W - 0.2, T - 0.65], [W, T - 0.45], [W, T - SKIN]];
  body.push({ geometry: creased(extrudeX(flange, -L2, L2), 20), color: FUTURE.white });
  const belly = (x) => 2.05 + 0.4 * Math.cos(Math.PI * x / 10);
  const web = [];
  for (let k = 0; k <= 40; k++) {
    const x = -L2 + k;
    const top = T - 0.45; const bot = belly(x);
    web.push({ x, yc: (top + bot) / 2, hh: (top - bot) / 2, hw: 0.62 });
  }
  body.push({ geometry: loftX(web, { sides: 20, p: 5 }), color: FUTURE.sky });
  // A light line riding the swoop along each side of the web.
  for (const sz of [1, -1]) {
    const pts = [];
    for (let k = 0; k <= 40; k++) { const x = -L2 + k; pts.push([x, belly(x) + 0.3, sz * 0.615]); }
    glow.push({ geometry: tube(pts, 0.055, { sides: 5, steps: 80, round: 0 }), color: FUTURE.glowLime });
  }
  // The running surface, a pale grey skin, with an inlaid glowing guide line down its middle and a
  // dark expansion joint at each end, half a joint per section.
  const JOINT = 0.06;
  for (const [a, b, c] of [[-W, -1.28, FUTURE.teal], [-1.28, -0.16, 0xb7c1cf], [0.16, 1.28, 0xb7c1cf], [1.28, W, FUTURE.teal]]) {
    const s = new Solid();
    boxS(s, -L2 + JOINT, L2 - JOINT, T - SKIN, T, a, b);
    body.push(part(s, c));
  }
  {
    const s = new Solid();
    boxS(s, -L2 + JOINT, L2 - JOINT, T - SKIN, T, -0.16, 0.16);
    glow.push(part(s, FUTURE.glowCyan));
    const j = new Solid();
    boxS(j, -L2, -L2 + JOINT, T - SKIN, T, -W, W);
    boxS(j, L2 - JOINT, L2, T - SKIN, T, -W, W);
    body.push(part(j, 0x3a4150));
  }
  // THE MAGNETS: a row of blocks along each side of the flange, alternating pink and cyan the way a
  // maglev's magnets alternate north and south. Twenty per side, 2ft apart, so a line of sections
  // keeps alternating across every joint.
  for (const sz of [1, -1]) {
    for (let i = 0; i < 20; i++) {
      const x = -L2 + 1 + i * 2;
      const s = new Solid();
      boxS(s, x - 0.78, x + 0.78, T - 0.4, T - 0.1, sz > 0 ? W - 0.01 : -W - 0.035, sz > 0 ? W + 0.035 : -W + 0.01);
      glow.push(part(s, i % 2 ? FUTURE.glowCyan : FUTURE.glowPink));
    }
    // And a continuous violet light line along the chamfer under them.
    const ln = new Solid();
    boxS(ln, -L2, L2, T - 0.6, T - 0.54, sz > 0 ? W - 0.16 : -W + 0.1, sz > 0 ? W - 0.1 : -W + 0.16);
    glow.push(part(ln, 0x9a7bff));
  }
  // Two sculpted pylons at x = +/-10: a flared oval foot, a waist with a ring of light, and a head that
  // spreads to carry the beam.
  for (const px of [-10, 10]) {
    const p = lathe([[0, -0.3], [1.35, -0.3], [1.35, 0.06], [1.15, 0.16], [0.72, 0.5], [0.52, 0.85], [0.5, 1.05], [0.62, 1.35], [0.95, 1.6], [1.1, 1.73], [0, 1.73]], 32);
    p.scale(1.35, 1, 0.85); p.translate(px, 0, 0);
    body.push({ geometry: p, color: FUTURE.coral });
    const ring = lathe([[0, 0.88], [0.53, 0.88], [0.53, 1.02], [0, 1.02]], 32);
    ring.scale(1.35, 1, 0.85); ring.translate(px, 0, 0);
    glow.push({ geometry: ring, color: FUTURE.glowGold });
  }

  const group = new THREE.Group();
  group.add(mesh(mergeParts(body), bodyMaterial({ roughness: 0.4, metalness: 0.15 })));
  group.add(glowMesh(glow));
  return group;
}

// ---------------------------------------------------------------------------------------------
// ev-charging-hub
// ---------------------------------------------------------------------------------------------
const HUB = {
  halfX: 16, halfZ: 10.5, padTop: 0.15,
  bayW: 7.5, bayZ0: -6.6, bayZ1: 9.6,
  chargerZ: -8.3,
  leafL: 15.6, leafW: 8.2, leafZ: 0.4,
};
const CHARGER_X = [-11.25, -3.75, 3.75, 11.25];
const CHARGER_COLOURS = [FUTURE.teal, FUTURE.violet, FUTURE.coral, FUTURE.sky];
const CHARGER_GLOWS = [FUTURE.glowCyan, 0xb18cff, 0xffa07a, 0x7fb8ff];
const CHARGE_START = [0.28, 0.64, 0.92, 0.47];

// The leaf canopy, as (u, v) in [-1, 1]^2: u along X, v across.
const leafW = (u) => Math.max(0.06, HUB.leafW * (1 - u * u) ** 0.62 * (1 - 0.16 * u));
// The cup across the leaf fades out toward the tips, or a narrow tip folds into a V.
const leafTop = (u, v) => { const k = leafW(u) / HUB.leafW; return 11.35 + 1.05 * (1 - u * u) + (1.35 * v * v - 0.25 * v) * k; };
const leafThick = (u, v) => 0.06 + 0.3 * (1 - v * v) * Math.sqrt(Math.max(0, 1 - u * u));
const leafXZ = (u, v) => [HUB.leafL * u, HUB.leafZ + v * leafW(u)];

function leafSolid(nu = 60, nv = 16) {
  const pos = []; const idx = [];
  const grid = (bottom) => {
    const start = pos.length / 3;
    for (let i = 0; i <= nu; i++) {
      const u = -1 + (2 * i) / nu;
      for (let j = 0; j <= nv; j++) {
        const v = -1 + (2 * j) / nv;
        const [x, z] = leafXZ(u, v);
        const y = leafTop(u, v) - (bottom ? leafThick(u, v) : 0);
        pos.push(x, y, z);
      }
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = start + i * (nv + 1) + j; const b = a + nv + 1; const c = b + 1; const d = a + 1;
        // (u, v) -> (x, z) is right handed downward, so the top is wound the other way round.
        if (bottom) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
      }
    }
    return start;
  };
  const top = grid(false); const bot = grid(true);
  const topG = new THREE.BufferGeometry();
  topG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  topG.setIndex(idx);
  topG.computeVertexNormals();
  // Split the two sheets so each carries its own uv and colour.
  const sheetTris = nu * nv * 6;
  const P = topG.attributes.position; const Nn = topG.attributes.normal;
  const take = (from, count) => {
    const g = new THREE.BufferGeometry();
    const p = []; const n = [];
    for (let t = from; t < from + count; t++) {
      const k = idx[t];
      p.push(P.getX(k), P.getY(k), P.getZ(k)); n.push(Nn.getX(k), Nn.getY(k), Nn.getZ(k));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    return g;
  };
  const topSheet = take(0, sheetTris);
  const botSheet = take(sheetTris, sheetTris);
  // The rim, round the whole border of the grid.
  const rim = new Solid();
  const loop = [];
  for (let i = 0; i <= nu; i++) loop.push([i, 0]);
  for (let j = 1; j <= nv; j++) loop.push([nu, j]);
  for (let i = nu - 1; i >= 0; i--) loop.push([i, nv]);
  for (let j = nv - 1; j >= 1; j--) loop.push([0, j]);
  const at = (base, [i, j]) => { const k = base + i * (nv + 1) + j; return [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]]; };
  for (let q = 0; q < loop.length; q++) {
    const A = loop[q]; const B = loop[(q + 1) % loop.length];
    const ta = at(top, A); const tb = at(top, B); const ba = at(bot, A); const bb = at(bot, B);
    const mx = (ta[0] + tb[0]) / 2; const mz = (ta[2] + tb[2]) / 2;
    rim.quad(ta, tb, bb, ba, [mx / HUB.leafL * 0.4, 0, (mz - HUB.leafZ) / HUB.leafW]);
  }
  return { topSheet, botSheet, rim: rim.geometry() };
}

function leafPoint(u, v, under = 0) {
  const [x, z] = leafXZ(u, v);
  return [x, leafTop(u, v) - leafThick(u, v) - under, z];
}

// The four charger screens share one canvas; its bottom strip is pure white for every other lit part.
const SCREEN = { w: 512, h: 256, sw: 112, sh: 150, y: 12 };
const screenX = (i) => 8 + i * 128;

function drawScreens(ctx, levels, full) {
  const { w, h, sw, sh, y } = SCREEN;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, h - 48, w, 48);
  for (let i = 0; i < 4; i++) {
    const x = screenX(i);
    const L = Math.max(0, Math.min(1, levels[i]));
    ctx.fillStyle = '#0d2142';
    ctx.fillRect(x, y, sw, sh);
    // The battery: an outline with a nub, filled to the level, colour going from amber to green.
    const bx = x + 26; const by = y + 30; const bw = 60; const bh = 88;
    ctx.fillStyle = '#d8f6ff';
    ctx.fillRect(bx + 20, by - 8, 20, 9);
    ctx.lineWidth = 5; ctx.strokeStyle = '#d8f6ff';
    ctx.strokeRect(bx, by, bw, bh);
    const fillH = (bh - 10) * L;
    const hue = 40 + 85 * L;
    ctx.fillStyle = `hsl(${hue}, 85%, 55%)`;
    ctx.fillRect(bx + 5, by + bh - 5 - fillH, bw - 10, fillH);
    // Bars inside the fill, so it reads as cells.
    ctx.fillStyle = 'rgba(13,33,66,0.35)';
    for (let k = 1; k < 4; k++) ctx.fillRect(bx + 5, by + bh - 5 - (bh - 10) * (k / 4) - 1, bw - 10, 2);
    // A bolt over the battery.
    ctx.fillStyle = full[i] ? '#ffffff' : '#ffd166';
    ctx.beginPath();
    const cx = bx + bw / 2; const cyy = by + bh / 2;
    const bolt = [[4, -30], [-14, 4], [-2, 4], [-6, 30], [14, -6], [2, -6]];
    bolt.forEach(([px, py], k) => (k ? ctx.lineTo(cx + px, cyy + py) : ctx.moveTo(cx + px, cyy + py)));
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#0d2142'; ctx.lineWidth = 2; ctx.stroke();
    // The number.
    ctx.fillStyle = full[i] ? '#b6ff5c' : '#d8f6ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px Arial, Helvetica, sans-serif';
    ctx.fillText(full[i] ? 'FULL' : `${Math.round(L * 100)}%`, x + sw / 2, y + 12);
    ctx.font = 'bold 15px Arial, Helvetica, sans-serif';
    ctx.fillText(`BAY ${i + 1}`, x + sw / 2, y + sh - 13);
  }
}

function hubPart(list, g, color) { list.push({ geometry: g, color }); }

function chargingHub() {
  const pad = new Solid(); const body = []; const paint = []; const glow = []; const screens = [];
  const { halfX, halfZ, padTop } = HUB;
  // The pad: a slab down to the foundation line, its top a few inches above the ground.
  boxS(pad, -halfX, halfX, BASE, padTop, -halfZ, halfZ);

  // Paint: bay lines, a green bay floor in each, a white bolt painted in it, and lime wheel stops.
  const py0 = padTop - 0.02; const py1 = padTop + 0.045;
  for (let i = 0; i <= 4; i++) {
    const s = new Solid();
    const x = -15 + i * HUB.bayW;
    boxS(s, x - 0.17, x + 0.17, py0, py1, HUB.bayZ0, HUB.bayZ1);
    paint.push(part(s, 0xf1f4f8));
  }
  CHARGER_X.forEach((cx, i) => {
    const s = new Solid();
    boxS(s, cx - HUB.bayW / 2 + 0.45, cx + HUB.bayW / 2 - 0.45, py0, padTop + 0.03, HUB.bayZ0 + 0.4, HUB.bayZ1 - 0.4);
    paint.push(part(s, i % 2 ? 0x3d9a5a : 0x36a36a));
    const b = new Solid();
    planPrism(b, boltPlan(cx, 4.2, 2.6, true), py0, padTop + 0.065);
    paint.push(part(b, 0xf6f8fb));
    const stop = new Solid();
    planPrism(stop, rrPlan(cx, HUB.bayZ0 + 0.45, 2.2, 0.28, 0.2, 3), padTop - 0.02, padTop + 0.3);
    body.push(part(stop, 0x39414f));
    const stopGlow = new Solid();
    boxS(stopGlow, cx - 2.0, cx + 2.0, padTop + 0.2, padTop + 0.31, HUB.bayZ0 + 0.18, HUB.bayZ0 + 0.72);
    glow.push(part(stopGlow, FUTURE.glowLime));
  });

  // The chargers, one at the head of each bay facing +Z.
  CHARGER_X.forEach((cx, i) => {
    const cz = HUB.chargerZ; const y0 = padTop - 0.02;
    const colour = CHARGER_COLOURS[i]; const lit = CHARGER_GLOWS[i];
    const st = (y, hw, hd) => ({ y, hw, hd, x: cx, z: cz });
    // A dark plinth, the white body and its accent-coloured skirt.
    hubPart(body, loftY([st(y0, 0.78, 0.55), st(y0 + 0.3, 0.78, 0.55), st(y0 + 0.36, 0.72, 0.5)], { sides: 32, p: 5 }), 0x39414f);
    const shell = loftY([st(y0 + 0.3, 0.62, 0.43), st(1.2, 0.6, 0.42), st(1.24, 0.6, 0.42), st(4.66, 0.538, 0.376), st(4.7, 0.537, 0.375), st(4.9, 0.53, 0.37), st(5.25, 0.46, 0.33)], { sides: 36, p: 6 });
    {
      const P = shell.attributes.position;
      const col = new Float32Array(P.count * 3);
      const cBody = new THREE.Color(FUTURE.white); const cAcc = new THREE.Color(colour);
      for (let k = 0; k < P.count; k++) {
        const y = P.getY(k); const c = y < 1.22 || y > 4.68 ? cAcc : cBody;
        col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      }
      shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    body.push({ geometry: shell, keepColor: true });
    // The glowing dome on top, in the charger's own colour.
    hubPart(glow, loftY([st(5.2, 0.47, 0.335), st(5.42, 0.4, 0.29), st(5.56, 0.25, 0.18), st(5.6, 0.05, 0.04)], { sides: 36, p: 5 }), lit);
    // The screen's bezel, standing a little proud of the curved front face, and the screen on it.
    const bezel = prismXY(roundRect(0.4, 0.52, 0.08, 3), cz + 0.34, cz + 0.4);
    bezel.translate(cx, 3.95, 0);
    hubPart(body, bezel, 0x1a2133);
    // A thin closed slab, every face mapped to this charger's part of the shared canvas.
    const scr = new THREE.BoxGeometry(0.66, 0.88, 0.012);
    scr.translate(cx, 3.95, cz + 0.4);
    {
      const uv = scr.attributes.uv;
      const u0 = screenX(i) / SCREEN.w; const u1 = (screenX(i) + SCREEN.sw) / SCREEN.w;
      const v1 = 1 - SCREEN.y / SCREEN.h; const v0 = 1 - (SCREEN.y + SCREEN.sh) / SCREEN.h;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, mix(u0, u1, uv.getX(k)), mix(v0, v1, uv.getY(k)));
    }
    screens.push({ geometry: scr, color: 0xffffff });
    // A light line up the front, under the screen.
    const strip = new THREE.BoxGeometry(0.09, 2.0, 0.04);
    strip.translate(cx, 2.3, cz + 0.42);
    hubPart(glow, strip, lit);
    // The holster on the +X side and the connector sitting in it.
    const hol = prismXY(roundRect(0.13, 0.32, 0.06, 2), -0.18, 0.18);
    hol.rotateY(Math.PI / 2); hol.translate(cx + 0.6, 3.3, cz + 0.02);
    hubPart(body, hol, 0x2a3142);
    const handle = tube([[cx + 0.68, 3.05, cz + 0.05], [cx + 0.74, 3.45, cz + 0.06], [cx + 0.7, 3.72, cz + 0.02]], [0.1, 0.12, 0.09], { sides: 10, round: 2 });
    hubPart(body, handle, colour);
    const tip = new THREE.CylinderGeometry(0.07, 0.07, 0.08, 10);
    tip.translate(cx + 0.7, 3.78, cz + 0.02);
    hubPart(glow, tip, lit);
    // The cable, hanging in a loop from the body to the handle.
    const cable = tube([
      [cx + 0.48, 2.15, cz + 0.12], [cx + 0.86, 1.35, cz + 0.24], [cx + 1.02, 0.72, cz + 0.26],
      [cx + 1.12, 1.25, cz + 0.16], [cx + 0.86, 2.55, cz + 0.06], [cx + 0.7, 3.02, cz + 0.05],
    ], 0.065, { sides: 8, steps: 40, round: 1 });
    hubPart(body, cable, 0x232833);
  });

  // The canopy: a cupped, gently arched leaf, its top paved with solar cells and its underside pale
  // mint with glowing veins and a glowing rim.
  const leaf = leafSolid();
  planarUV(leaf.topSheet, 5);
  body.push({ geometry: leaf.topSheet, color: 0x3f69bd, solar: true });
  body.push({ geometry: leaf.botSheet, color: 0xd4f5e4 });
  body.push({ geometry: leaf.rim, color: 0x9fe0c4 });
  // The rim light: a thin tube along each long edge at the rim's mid height, meeting at the tips.
  for (const v of [1, -1]) {
    const edge = [];
    for (let k = 0; k <= 40; k++) {
      const u = -0.995 + (1.99 * k) / 40;
      const [x, z] = leafXZ(u, v);
      edge.push([x, leafTop(u, v) - leafThick(u, v) / 2, z]);
    }
    glow.push({ geometry: tube(edge, 0.09, { sides: 7, steps: 64, round: 1 }), color: FUTURE.glowLime });
  }
  // The veins on the underside: a midrib and seven pairs of side veins sweeping toward the tip.
  {
    const mid = [];
    for (let k = 0; k <= 30; k++) mid.push(leafPoint(-0.96 + (1.9 * k) / 30, 0, 0.03));
    glow.push({ geometry: tube(mid, 0.11, { sides: 7, steps: 44, round: 1 }), color: FUTURE.glowLime });
    for (let s = 0; s < 7; s++) {
      const u0 = -0.78 + s * 0.24;
      for (const side of [1, -1]) {
        const vp = [];
        for (let k = 0; k <= 10; k++) {
          const f = k / 10;
          const uu = u0 + 0.22 * f * f + 0.1 * f;
          vp.push(leafPoint(Math.min(0.97, uu), side * 0.86 * Math.sin(f * Math.PI / 2), 0.025));
        }
        glow.push({ geometry: tube(vp, [0.075, 0.04], { sides: 5, steps: 12, round: 1 }), color: 0xd6ff7a });
      }
    }
  }
  // Two curving stems from the back of the pad up into the leaf's underside, each on a flared foot.
  for (const sx of [-1, 1]) {
    const x0 = sx * 7.5;
    const top = leafPoint(sx * 0.35, -0.34, -0.12);
    const stem = tube([[x0, padTop - 0.02, -9.4], [x0, 3, -9.0], [x0 - sx * 0.5, 7.5, -6.6], [top[0], top[1], top[2]]], [0.42, 0.36, 0.3, 0.26], { sides: 18, steps: 40, round: 0 });
    body.push({ geometry: stem, color: 0x9ad48f });
    const foot = lathe([[0, padTop - 0.02], [0.95, padTop - 0.02], [0.95, padTop + 0.12], [0.6, padTop + 0.4], [0.42, padTop + 0.9], [0, padTop + 0.9]], 24);
    foot.translate(x0, 0, -9.4);
    body.push({ geometry: foot, color: 0x9ad48f });
    const band = lathe([[0, 2.4], [0.39, 2.4], [0.39, 2.65], [0, 2.65]], 20);
    band.translate(x0, 0, -9.05);
    glow.push({ geometry: band, color: FUTURE.glowLime });
  }

  // The body mesh carries the solar texture: only the leaf's top reads it, every other part is pinned
  // to the texture's white grout so it simply takes its vertex colour.
  const bodyParts = body.map((p) => (p.solar ? p : { ...p, geometry: pinUV(p.geometry.clone(), 0.004, 0.5) }));
  const solarTex = solarTileTexture(431);
  const group = new THREE.Group();
  group.add(mesh(planarUV(mergeParts([part(pad, 0xb7bcc4)]), 5), texturedMaterial(concreteTexture(432), { roughness: 0.85, bump: 0.35 })));
  const pm = mesh(mergeParts(paint), standard({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  pm.castShadow = false;
  group.add(pm);
  group.add(mesh(mergeParts(bodyParts), standard({ vertexColors: true, map: solarTex, roughness: 0.38, metalness: 0.15 })));
  group.add(glowMesh(glow));

  // The screens: one canvas for all four, redrawn a few times a second as the batteries fill.
  const levels = [...CHARGE_START]; const full = [false, false, false, false]; const hold = [0, 0, 0, 0];
  const screenTex = canvasTexture(SCREEN.w, SCREEN.h, (ctx) => drawScreens(ctx, levels, full));
  const sm = mesh(mergeParts(screens), glowMaterial({ map: screenTex }));
  sm.castShadow = false;
  group.add(sm);
  let since = 0;
  group.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      for (let i = 0; i < 4; i++) {
        if (full[i]) {
          hold[i] += step;
          if (hold[i] > 4) { full[i] = false; hold[i] = 0; levels[i] = 0.12; }
        } else {
          levels[i] += step * (0.016 + i * 0.003);
          if (levels[i] >= 1) { levels[i] = 1; full[i] = true; }
        }
      }
      since += step;
      if (since >= 0.25) {
        since = 0;
        const ctx = screenTex.image?.getContext?.('2d');
        if (ctx) { drawScreens(ctx, levels, full); screenTex.needsUpdate = true; }
      }
    },
    dispose() {},
  };
  return group;
}

export const BUILDERS = {
  'smart-road': smartRoad,
  'smart-intersection': smartIntersection,
  'maglev-track': maglevTrack,
  'hyperloop-tube': hyperloopTube,
  'ev-charging-hub': chargingHub,
};

void PALETTE;
