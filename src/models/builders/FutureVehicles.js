import * as THREE from 'three';
import { canvasTexture, mesh, standard } from '../../PropKit.js';
import { solidLoft, mergeParts } from '../../props/LoftKit.js';
import { tube, lathe } from '../ModelKit.js';
import { FUTURE, TYRE } from '../town/TownKit.js';
import {
  TAU, mixN, part, paintGeo, slab, rbox, ellipsoid, loftSurface, flankSlab, crownSlab, tuSlab,
  glowAtlas, rotorMesh, addTick, wheel, assemble, rayHost, onSurface, Tris,
} from '../town/FutureVehiclesKit.js';

// Build a Future City: the five vehicles. air-taxi, self-driving-pod, maglev-train, delivery-drone
// and robo-bus. Life size in feet, origin at the base centre, front toward +Z, the driver's side +X
// and the kerb side -X.
//
// Every one is bright, rounded and lit, and three of them move parts by themselves while the root
// stays put, so a program can still carry the whole vehicle: the air taxi's six rotors and the
// drone's four turn (rotorMesh rewrites their few vertices), the pod's lidar spins on the roof, and
// the robo-bus folds its ramp away whenever it is moving and lays it out again when it stops.
// Under reduced motion the rotors and the lidar hold still and the ramp arrives at once.
//
// SIX MESHES AT MOST: paint, trim (rubber, seats, interiors), opaque glass, glow (one unlit mesh,
// vertex coloured, every lamp and lit sign), the one transparent canopy where seats must show
// through, and whatever spins.

const GRAPHITE = 0x3d4252;
const DARK = 0x2a2e38;
const GLOW_CYAN = FUTURE.glowCyan;
const GLOW_PINK = FUTURE.glowPink;
const GLOW_LIME = FUTURE.glowLime;

// A tube between two points (or through several), outward wound and closed.
function rod(list, pts, r, color, sides = 10, extra = {}) {
  const steps = extra.steps ?? Math.min(48, Math.max(2, (pts.length - 1) * 6));
  const { steps: _s, ...rest } = extra;
  part(list, tube(pts, r, { sides, steps, round: 2, straight: pts.length === 2 }), color, null, null, rest);
}

// A small canvas of flat swatches, read with NearestFilter, for a spinning part that must both
// take the light and glow in places: its uvs pick a swatch from an emissive map.
function swatches(colors) {
  const tex = canvasTexture(colors.length * 4, 4, (ctx) => {
    colors.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 4, 0, 4, 4); });
  });
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  const at = (i) => [(i * 4 + 2) / (colors.length * 4), 0.5];
  return { tex, at };
}
function uvAll(g, uv) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 2] = uv[0]; a[i * 2 + 1] = uv[1]; }
  g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
  return g;
}

// ---------------------------------------------------------------------------------------------
// self-driving-pod
// ---------------------------------------------------------------------------------------------
// A 13ft four-seat pod: a teal tub on hidden wheels, a big tinted glass bubble over it with two
// benches facing each other inside and nothing to steer with, a cyan light bar wrapped round the
// nose and a pink one round the tail, forward chevrons on both flanks, and a lidar spinning on the
// roof.
function selfDrivingPod() {
  const paint = []; const trim = []; const glow = []; const clear = []; const glass = [];
  const atlas = glowAtlas([]);
  const B = 1.75;
  const st = (d, w, up, dn = up) => ({ d, w, up, dn, b: B, roundUp: 0.32, roundDn: 0.45 });
  const tubSt = [
    st(-6.5, 0.06, 0.06), st(-6.25, 2.05, 1.05, 1.0), st(-5.6, 2.78, 1.22, 1.2), st(-4.2, 2.98, 1.25),
    st(-1.4, 2.98, 1.25), st(1.4, 2.98, 1.25), st(4.2, 2.98, 1.25), st(5.6, 2.78, 1.22, 1.2),
    st(6.25, 2.05, 1.05, 1.0), st(6.5, 0.06, 0.06),
  ];
  const tub = loftSurface(tubSt);
  const tubG = solidLoft(tubSt, { sides: 36, samples: 45 });
  const tubHit = rayHost(tubG);
  paintGeo(tubG, (p, n) => {
    if (p.y < 0.78) return GRAPHITE;
    if (n.y > 0.75 && p.y > 2.85) return 0xb9b6cc;
    return FUTURE.teal;
  });
  part(paint, tubG, 0xffffff, null, null, { keepColor: true });
  // A pearl rubbing band along each flank just under the glass.
  for (const side of [1, -1]) {
    part(paint, flankSlab(tub, side, -5.3, 5.3, 2.62, 2.86, { nz: 30, ny: 2, thick: 0.05 }), FUTURE.pearl);
  }

  // The glass bubble: one closed transparent shell standing on the tub.
  const gst = (d, w, up) => ({ d, w, up, dn: 0.1, b: 3.02, roundUp: 0.5, roundDn: 1 });
  const glassSt = [
    gst(-5.75, 0.06, 0.06), gst(-5.5, 1.9, 1.6), gst(-4.8, 2.62, 2.55), gst(-3.6, 2.82, 2.95),
    gst(-1.2, 2.86, 3.0), gst(1.2, 2.86, 3.0), gst(3.6, 2.82, 2.95), gst(4.8, 2.62, 2.55),
    gst(5.5, 1.9, 1.6), gst(5.75, 0.06, 0.06),
  ];
  const cab = loftSurface(glassSt);
  part(clear, solidLoft(glassSt, { sides: 36, samples: 36 }), 0x7fc4dc);
  // Roof cap and the pillar hoops, lying on the glass.
  part(paint, crownSlab(cab, -4.1, 4.1, 2.25, -2.25, { nz: 12, nx: 8, lift: 0.01, thick: 0.14 }), FUTURE.pearl);
  for (const z of [-4.35, -2.0, 2.0, 4.35]) {
    const t0 = cab.tAtD(z - 0.2); const t1 = cab.tAtD(z + 0.2);
    part(paint, tuSlab(cab, t0, t1, 0.005, 0.495, { nt: 2, nu: 16, lift: 0.01, thick: 0.09 }), FUTURE.pearl);
  }
  const roofY = cab.crown(0, 0).p[1] + 0.15;

  // Inside: two benches facing each other across a little round table.
  for (const dir of [1, -1]) {
    const zc = -3.05 * dir;
    part(trim, rbox(4.5, 0.55, 1.5, 0.35, 8), FUTURE.coral, [0, 3.18, zc]);
    part(trim, rbox(4.5, 2.1, 0.45, 0.35, 8), FUTURE.coral, [0, 4.05, zc - 0.88 * dir], [-0.12 * dir, 0, 0]);
    for (const x of [-1.15, 1.15]) part(trim, rbox(0.95, 0.5, 0.32, 0.4, 8), FUTURE.sun, [x, 5.28, zc - 1.02 * dir], [-0.12 * dir, 0, 0]);
  }
  part(paint, new THREE.CylinderGeometry(0.16, 0.24, 0.9, 14), FUTURE.pearl, [0, 3.4, 0]);
  part(paint, new THREE.CylinderGeometry(0.75, 0.72, 0.1, 30), FUTURE.pearl, [0, 3.9, 0]);
  part(glow, new THREE.TorusGeometry(0.74, 0.045, 6, 24), GLOW_CYAN, [0, 3.9, 0], [Math.PI / 2, 0, 0]);

  // The light bars: one rope of light round the nose at the tub's centre line, one round the tail.
  const bar = (tA, tB) => {
    const pts = [];
    const n = 26;
    for (let i = 0; i <= n; i++) pts.push(tub.P(mixN(tA, tB, i / n), 0));
    for (let i = n - 1; i >= 0; i--) pts.push(tub.P(mixN(tA, tB, i / n), 0.5));
    return pts;
  };
  rod(glow, bar(tub.tAtD(5.62), 1), 0.13, GLOW_CYAN, 8, { steps: 36 });
  rod(glow, bar(tub.tAtD(-5.62), 0), 0.13, GLOW_PINK, 8, { steps: 36 });
  // Forward chevrons on both flanks: the pod says which way it is going.
  for (const side of [1, -1]) {
    for (const zc of [-1.2, 0, 1.2]) {
      const at = (z, y) => { const s = tub.flank(z, y, side); return [s.p[0] + s.n[0] * 0.03, s.p[1] + s.n[1] * 0.03, s.p[2] + s.n[2] * 0.03]; };
      rod(glow, [at(zc - 0.15, B + 0.36), at(zc + 0.25, B), at(zc - 0.15, B - 0.36)], 0.07, GLOW_LIME, 6, { steps: 8 });
    }
  }
  // Camera bumps at the corners of the roof.
  for (const z of [-4.0, 4.0]) {
    for (const x of [-1.9, 1.9]) part(trim, ellipsoid(0.22, 0.14, 0.22, 12), DARK, [x, roofY - 0.02, z]);
  }

  // Wheels, mostly behind the tub's smooth fairings: a dark arch on the fairing says where each
  // one is, rimmed with light.
  const WY = TYRE.car.r - 0.02; const AR = 1.32;
  for (const z of [-4.25, 4.25]) {
    for (const side of [1, -1]) {
      wheel(paint, trim, { x: 2.35 * side, z, size: TYRE.car, side });
      const half = Math.sqrt(AR * AR - (0.62 - WY) ** 2);
      part(trim, flankSlab(tub, side, z - half, z + half, 0.62, (zz) => WY + Math.sqrt(Math.max(0, AR * AR - (zz - z) ** 2)), { nz: 16, ny: 6, lift: 0.02, thick: 0.03 }), 0x3a4052);
      const arc = [];
      for (let i = 0; i <= 16; i++) {
        const a = mixN(-0.18, Math.PI + 0.18, i / 16);
        const s2 = tub.flank(z + Math.cos(a) * (AR + 0.08), WY + Math.sin(a) * (AR + 0.08), side);
        arc.push([s2.p[0] + s2.n[0] * 0.03, s2.p[1] + s2.n[1] * 0.03, s2.p[2] + s2.n[2] * 0.03]);
      }
      rod(glow, arc, 0.055, GLOW_CYAN, 6, { steps: 20 });
    }
  }
  // A friendly face: two glowing eyes on the nose, two pink lamps on the tail.
  for (const x of [-1.35, 1.35]) {
    const f = tubHit([x, 2.42, 12], [0, 0, -1]);
    const eye = ellipsoid(0.44, 0.24, 0.12, 12); eye.applyMatrix4(onSurface(f, 0.04));
    part(glow, eye, 0xd8fdff);
    const r = tubHit([x, 2.42, -12], [0, 0, 1]);
    const lamp = ellipsoid(0.44, 0.18, 0.12, 12); lamp.applyMatrix4(onSurface(r, 0.04));
    part(glow, lamp, GLOW_PINK);
  }

  // The lidar: a fixed pedestal and a puck that spins, lit in one window.
  part(trim, new THREE.CylinderGeometry(0.3, 0.38, 0.22, 20), DARK, [0, roofY + 0.09, 0.3]);
  const sw = swatches(['#000000', '#5cf2ff']);
  const puck = [];
  const body = lathe([[0, 0], [0.42, 0], [0.44, 0.08], [0.44, 0.36], [0.36, 0.46], [0, 0.48]], 28);
  part(puck, uvAll(body, sw.at(0)), GRAPHITE);
  const win = new THREE.CylinderGeometry(0.455, 0.455, 0.14, 10, 1, false, -0.6, 1.2);
  part(puck, uvAll(win, sw.at(1)), 0x203040, [0, 0.22, 0]);
  part(puck, uvAll(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), sw.at(1)), 0x203040, [0, 0.5, 0]);
  const lidar = new THREE.Group();
  lidar.position.set(0, roofY + 0.2, 0.3);
  const puckMesh = mesh(mergeParts(puck), standard({
    vertexColors: true, roughness: 0.35, metalness: 0.2, emissive: 0xffffff, emissiveMap: sw.tex, emissiveIntensity: 1,
  }));
  lidar.add(puckMesh);

  const group = assemble({ paint, trim, glass, glow, clear }, atlas, { clear: { opacity: 0.32 }, extra: [lidar] });
  addTick(group, (dt, reduced) => { if (!reduced) lidar.rotation.y = (lidar.rotation.y + dt * 4) % TAU; });
  return group;
}


// ---------------------------------------------------------------------------------------------
// air-taxi
// ---------------------------------------------------------------------------------------------
// About 30ft across six ducted rotors: a violet and pearl hull with a clear bubble over four seats,
// a pearl fairing behind it carrying the tail, six yellow ducts on gull arms with a ring of light
// round each, landing skids on the ground, and the six rotors turning, each the other way from its
// neighbour so the taxi does not spin.
const TAXI_ROTORS = [[6.0, 9.2], [11.0, 0.4], [6.0, -8.4], [-6.0, -8.4], [-11.0, 0.4], [-6.0, 9.2]];
const DUCT_Y = 5.9;

function airTaxi() {
  const paint = []; const trim = []; const glow = []; const clear = []; const glass = [];
  const atlas = glowAtlas([{ text: 'AIR TAXI', fg: '#5cf2ff', bg: '#2a1650', aspect: 6 }]);
  const hs = (d, w, up, dn, b = 2.45) => ({ d, w, up, dn, b, roundUp: 0.55, roundDn: 0.75 });
  const hullSt = [
    hs(-7.4, 0.12, 0.12, 0.12, 3.05), hs(-6.6, 0.9, 0.45, 0.45, 2.85), hs(-5.4, 2.0, 0.72, 0.75, 2.6),
    hs(-3.6, 2.75, 0.82, 0.85), hs(-1.0, 2.95, 0.85, 0.85), hs(1.6, 2.95, 0.85, 0.85), hs(3.8, 2.65, 0.8, 0.82),
    hs(5.4, 1.9, 0.68, 0.7, 2.4), hs(6.3, 0.9, 0.4, 0.45, 2.3), hs(6.7, 0.1, 0.1, 0.1, 2.25),
  ];
  const hull = loftSurface(hullSt);
  const hullG = solidLoft(hullSt, { sides: 32, samples: 40 });
  paintGeo(hullG, (p, n) => {
    if (n.y > 0.8 && p.y > 3.15) return 0xb4b8c8;
    return p.y < 2.42 ? FUTURE.violet : FUTURE.pearl;
  });
  part(paint, hullG, 0xffffff, null, null, { keepColor: true });
  // A coral stripe where the two colours meet, and the name on both flanks.
  for (const side of [1, -1]) {
    part(paint, flankSlab(hull, side, -5.0, 5.0, 2.36, 2.5, { nz: 36, ny: 1, thick: 0.04 }), FUTURE.coral);
    const [z0, z1] = side > 0 ? [0.8, -3.4] : [-3.4, 0.8];
    part(glow, flankSlab(hull, side, z0, z1, 1.82, 2.28, { nz: 16, ny: 2, thick: 0.03, uv: atlas.rects[0] }), 0xffffff, null, null, { keepUV: true });
  }

  // The bubble: clear, closed, standing on the hull top.
  const cs = (d, w, up) => ({ d, w, up, dn: 0.1, b: 3.25, roundUp: 0.85, roundDn: 1 });
  const canSt = [cs(-3.3, 0.1, 0.1), cs(-2.8, 2.2, 2.6), cs(-1.6, 2.75, 3.65), cs(0.8, 2.85, 3.95), cs(3.0, 2.55, 3.2), cs(4.4, 1.6, 1.6), cs(4.9, 0.1, 0.1)];
  part(clear, solidLoft(canSt, { sides: 32, samples: 30 }), 0x86c8e6);
  // The pearl fairing behind it, which the bubble tucks into.
  const fs = (d, w, up) => ({ d, w, up, dn: 0.2, b: 3.2, roundUp: 0.7, roundDn: 1 });
  const fairSt = [fs(-7.0, 0.1, 0.1), fs(-6.2, 1.5, 1.2), fs(-4.8, 2.45, 2.4), fs(-3.2, 2.6, 3.1), fs(-2.4, 2.3, 2.85), fs(-1.9, 0.1, 0.25)];
  const fair = loftSurface(fairSt);
  part(paint, solidLoft(fairSt, { sides: 32, samples: 30 }), FUTURE.pearl);
  // A cyan light band round the fairing's waist.
  for (const side of [1, -1]) {
    part(glow, flankSlab(fair, side, -6.0, -2.9, 4.15, 4.32, { nz: 16, ny: 1, thick: 0.03 }), GLOW_CYAN);
  }
  // A coral V-tail.
  for (const side of [1, -1]) {
    const fin = rbox(0.14, 1.9, 1.3, 0.45, 10);
    part(paint, fin, FUTURE.coral, [0.55 * side, 4.35, -6.25], [0, 0, -0.62 * side]);
    part(glow, ellipsoid(0.09, 0.09, 0.09, 8), 0xffffff, [1.08 * side, 5.12, -6.25]);
  }

  // Inside: four seats in two rows and a lit dashboard.
  for (const zc of [2.0, -0.6]) {
    for (const x of [-1.05, 1.05]) {
      part(trim, rbox(1.45, 0.45, 1.4, 0.4, 8), FUTURE.magenta, [x, 3.42, zc]);
      part(trim, rbox(1.45, 2.0, 0.36, 0.4, 8), FUTURE.magenta, [x, 4.45, zc - 0.82], [-0.15, 0, 0]);
      part(trim, rbox(0.85, 0.5, 0.3, 0.45, 8), FUTURE.sun, [x, 5.62, zc - 1.0], [-0.15, 0, 0]);
    }
  }
  part(trim, rbox(3.6, 0.7, 0.8, 0.4, 8), GRAPHITE, [0, 3.55, 3.55]);
  part(glow, rbox(2.6, 0.06, 0.5, 0.4, 8), GLOW_CYAN, [0, 3.92, 3.5], [0.35, 0, 0]);

  // Landing skids on y = 0, two struts each up into the belly.
  for (const side of [1, -1]) {
    const x = 2.35 * side;
    rod(trim, [[x, 0.13, -4.4], [x, 0.13, 2.4], [x, 0.16, 3.9], [x, 0.42, 4.9], [x, 0.85, 5.35]], 0.13, GRAPHITE, 10, { steps: 24 });
    for (const z of [-2.6, 2.4]) rod(paint, [[x, 0.13, z], [1.6 * side, 2.0, z * 0.95]], 0.11, FUTURE.pearl, 8);
    part(glow, flankSlab(hull, side, -3.2, 3.6, 1.95, 2.05, { nz: 24, ny: 1, thick: 0.03 }), GLOW_LIME);
  }

  // Six ducts, each on a gull arm, with a ring of light on top and a pink one underneath.
  const ductProfile = [[3.55, -0.45], [3.9, -0.5], [4.02, -0.25], [4.0, 0.3], [3.85, 0.52], [3.62, 0.55], [3.48, 0.35], [3.48, -0.3], [3.55, -0.45]];
  const rotors = [];
  TAXI_ROTORS.forEach(([cx, cz], k) => {
    const duct = lathe(ductProfile, 28);
    paintGeo(duct, (p) => (Math.hypot(p.x, p.z) > 3.86 && p.y < 0.42 ? FUTURE.sun : FUTURE.pearl));
    part(paint, duct, 0xffffff, [cx, DUCT_Y, cz], null, { keepColor: true });
    part(glow, new THREE.TorusGeometry(3.74, 0.075, 3, 32), GLOW_CYAN, [cx, DUCT_Y + 0.56, cz], [Math.PI / 2, 0, 0]);
    part(glow, new THREE.TorusGeometry(3.95, 0.06, 3, 32), GLOW_PINK, [cx, DUCT_Y - 0.44, cz], [Math.PI / 2, 0, 0]);
    // the motor pod and three stators holding it
    part(paint, lathe([[0, -0.62], [0.3, -0.55], [0.46, -0.3], [0.46, 0.1], [0, 0.12]], 14), FUTURE.pearl, [cx, DUCT_Y, cz]);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU + 0.5;
      const g = new THREE.BoxGeometry(3.2, 0.1, 0.16); g.translate(2.0, -0.25, 0); g.rotateY(a);
      part(trim, g, GRAPHITE, [cx, DUCT_Y, cz]);
    }
    // the arm, from the body to the duct's outer wall
    const len = Math.hypot(cx, cz);
    const ex = cx - (cx / len) * 3.92; const ez = cz - (cz / len) * 3.92;
    let start;
    if (Math.abs(cz) < 3) start = [2.6 * Math.sign(cx), 2.95, 0.3];
    else if (cz > 0) start = [2.25 * Math.sign(cx), 2.95, 3.5];
    else start = [2.0 * Math.sign(cx), 3.75, -4.6];
    const end = [ex, DUCT_Y, ez];
    const mid = [mixN(start[0], end[0], 0.5), mixN(start[1], end[1], 0.5) + 0.2, mixN(start[2], end[2], 0.5)];
    part(paint, tube([start, mid, end], [0.34, 0.25, 0.21], { sides: 10, steps: 12, round: 2 }), FUTURE.pearl);
    part(glow, tube([[start[0], start[1] + 0.26, start[2]], [mid[0], mid[1] + 0.23, mid[2]], [end[0], end[1] + 0.2, end[2]]], 0.06, { sides: 5, steps: 12, round: 1 }), GLOW_CYAN);
    // the spinning rotor
    const blades = [];
    const capG = lathe([[0, 0], [0.36, 0], [0.32, 0.18], [0.16, 0.3], [0, 0.33]], 12);
    part(blades, capG, FUTURE.coral);
    for (let j = 0; j < 3; j++) {
      const g = rbox(3.15, 0.09, 0.56, 0.5, 8);
      paintGeo(g, (p) => (p.x > 1.05 ? FUTURE.coral : FUTURE.white));
      g.translate(1.85, 0.08, 0); g.rotateX(0.24); g.rotateY((j / 3) * TAU);
      part(blades, g, 0xffffff, null, null, { keepColor: true });
    }
    rotors.push({ parts: blades, centre: [cx, DUCT_Y + 0.12, cz], speed: k % 2 ? -8.5 : 8.5, phase: k * 0.7 });
  });
  // Navigation lights on the outermost ducts: red on the left (+X), green on the right.
  part(glow, ellipsoid(0.2, 0.16, 0.2, 10), 0xff4a5a, [11.0 + 4.0, DUCT_Y, 0.4]);
  part(glow, ellipsoid(0.2, 0.16, 0.2, 10), 0x5cff8a, [-11.0 - 4.0, DUCT_Y, 0.4]);

  const spin = rotorMesh(rotors, standard({ vertexColors: true, roughness: 0.4, metalness: 0.15 }));
  const group = assemble({ paint, trim, glass, glow, clear }, atlas, { clear: { opacity: 0.28 }, extra: [spin.mesh] });
  addTick(group, (dt, reduced) => { if (!reduced) spin.update(dt); });
  return group;
}


// ---------------------------------------------------------------------------------------------
// delivery-drone
// ---------------------------------------------------------------------------------------------
// About 5ft across: a yellow and violet body with two glowing eyes, four arms lit cyan in front
// and pink behind, a magenta guard round each of the four spinning rotors, a claw gripping a
// cardboard parcel, and four landing legs whose feet are the lowest thing on it (y = 0). The card
// lifts it 8ft into the air.
function deliveryDrone() {
  const paint = []; const trim = []; const glow = []; const glass = [];
  const atlas = glowAtlas([]);
  const BY = 1.4;
  const body = ellipsoid(0.62, 0.3, 0.82, 24);
  body.translate(0, BY, 0);
  const bodyHit = rayHost(body);
  paintGeo(body, (p) => (p.y > BY + 0.07 ? FUTURE.violet : FUTURE.sun));
  part(paint, body, 0xffffff, null, null, { keepColor: true });
  // The waist light, and two eyes on the front.
  const ring = new THREE.TorusGeometry(1, 0.045, 5, 40); ring.rotateX(Math.PI / 2); ring.scale(0.628, 1, 0.828);
  part(glow, ring, GLOW_CYAN, [0, BY + 0.04, 0]);
  for (const x of [-0.2, 0.2]) {
    const h = bodyHit([x, BY + 0.0, 3], [0, 0, -1]);
    const eye = ellipsoid(0.11, 0.08, 0.05, 10); eye.applyMatrix4(onSurface(h, 0.015));
    part(glow, eye, 0xdcfdff);
  }
  const cam = bodyHit([0, BY - 0.16, 3], [0, 0, -1]);
  const lens = ellipsoid(0.13, 0.11, 0.09, 12); lens.applyMatrix4(onSurface(cam, 0.03));
  part(glass, lens, FUTURE.glass);

  // Arms, motors, guards, and the four spinning rotors.
  const M = 1.36; const MY = BY + 0.1;
  const rotors = [];
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sz], k) => {
    const mx = M * sx; const mz = M * sz;
    rod(trim, [[0.3 * sx, BY + 0.02, 0.42 * sz], [mx, MY, mz]], 0.075, GRAPHITE, 10);
    rod(glow, [[0.36 * sx, BY + 0.085, 0.5 * sz], [mx - 0.12 * sx, MY + 0.07, mz - 0.12 * sz]], 0.028, sz > 0 ? GLOW_CYAN : GLOW_PINK, 5);
    part(trim, lathe([[0, -0.16], [0.17, -0.16], [0.17, 0.1], [0.12, 0.17], [0, 0.17]], 16), GRAPHITE, [mx, MY, mz]);
    part(paint, new THREE.TorusGeometry(0.88, 0.045, 6, 36), FUTURE.magenta, [mx, MY + 0.17, mz], [Math.PI / 2, 0, 0]);
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * TAU + Math.atan2(sx, sz);
      rod(trim, [[mx + Math.sin(a) * 0.15, MY - 0.06, mz + Math.cos(a) * 0.15], [mx + Math.sin(a) * 0.86, MY + 0.15, mz + Math.cos(a) * 0.86]], 0.025, GRAPHITE, 5);
    }
    part(glow, new THREE.TorusGeometry(0.88, 0.022, 4, 36), sz > 0 ? GLOW_CYAN : GLOW_PINK, [mx, MY + 0.1, mz], [Math.PI / 2, 0, 0]);
    const blades = [];
    part(blades, lathe([[0, 0], [0.1, 0], [0.09, 0.05], [0, 0.09]], 10), FUTURE.coral);
    for (let j = 0; j < 2; j++) {
      const g = rbox(0.8, 0.035, 0.15, 0.5, 8);
      paintGeo(g, (p) => (p.x > 0.28 ? FUTURE.coral : FUTURE.white));
      g.translate(0.42, 0.03, 0); g.rotateX(0.22 * (k % 2 ? -1 : 1)); g.rotateY(j * Math.PI);
      part(blades, g, 0xffffff, null, null, { keepColor: true });
    }
    rotors.push({ parts: blades, centre: [mx, MY + 0.2, mz], speed: k % 2 ? -13 : 13, phase: k * 0.9 });
  });

  // Landing legs: the feet are the lowest point, on y = 0.
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      rod(trim, [[0.36 * sx, BY - 0.18, 0.46 * sz], [0.62 * sx, 0.5, 0.68 * sz], [0.8 * sx, 0.08, 0.86 * sz]], 0.045, GRAPHITE, 8, { steps: 10 });
      const foot = ellipsoid(0.11, 0.07, 0.11, 10); foot.translate(0.8 * sx, 0.07, 0.86 * sz);
      part(trim, foot, FUTURE.magenta);
    }
  }

  // The claw and the parcel it holds.
  part(trim, rbox(0.5, 0.16, 0.42, 0.4, 10), GRAPHITE, [0, BY - 0.3, 0]);
  for (const sx of [1, -1]) {
    rod(trim, [[0.16 * sx, BY - 0.34, 0], [0.55 * sx, BY - 0.42, 0], [0.54 * sx, 0.62, 0]], 0.045, FUTURE.sun, 8, { steps: 10 });
    part(trim, rbox(0.08, 0.32, 0.3, 0.4, 8), GRAPHITE, [0.49 * sx, 0.56, 0]);
  }
  part(trim, new THREE.BoxGeometry(0.9, 0.7, 0.9), 0xb5884f, [0, 0.5, 0]);
  part(trim, new THREE.BoxGeometry(0.2, 0.712, 0.912), 0xd9bb8c, [0, 0.5, 0]);
  part(trim, new THREE.BoxGeometry(0.92, 0.712, 0.16), 0xd9bb8c, [0, 0.5, 0]);
  part(paint, new THREE.BoxGeometry(0.26, 0.22, 0.02), FUTURE.teal, [0.27, 0.6, 0.455]);
  part(paint, new THREE.BoxGeometry(0.2, 0.04, 0.025), FUTURE.white, [0.27, 0.6, 0.458]);
  part(paint, new THREE.BoxGeometry(0.26, 0.22, 0.02), FUTURE.teal, [-0.27, 0.6, -0.455]);

  const spin = rotorMesh(rotors, standard({ vertexColors: true, roughness: 0.4, metalness: 0.15 }));
  const group = assemble({ paint, trim, glass, glow }, atlas, { extra: [spin.mesh] });
  addTick(group, (dt, reduced) => { if (!reduced) spin.update(dt); });
  return group;
}


// ---------------------------------------------------------------------------------------------
// maglev-train
// ---------------------------------------------------------------------------------------------
// Two 40ft cars coupled at z = 0, each a white loft with a long sloping nose (the rear car is the
// same car turned round, as a two-ended train is), a sky-blue sweep along the bottom, a row of dark
// windows over a cyan light line, a door near the coupling, and "MAGLEV" on the nose.
//
// THE UNDERSIDE STRADDLES A 3FT BEAM. The card hovers the train 3.2ft, which puts its y = 0 on the
// top of a Maglev Track's guideway. The two side skirts come down to y = 0 well outside the beam,
// the body's floor over the beam stands half a foot clear of it (the levitation gap, lit cyan), and
// two dark aprons hang inside the skirts to y = -0.45, their inner faces at x = +/-1.67, just outside
// the beam and its magnet blocks (half-width 1.535),
// so the train wraps the top of the guideway the way a real maglev does.
const MAG_STRIPE = (z) => (z < 26 ? 5.6 : mixN(5.6, 2.25, Math.min(1, ((z - 26) / 13.4) ** 1.2)));

function maglevCar(atlas) {
  const paint = []; const trim = []; const glow = []; const glass = [];
  const ms = (d, w, b, up, dn, ru = 0.6, rd = 0.3) => ({ d, w, b, up, dn, roundUp: ru, roundDn: rd });
  const st = [
    ms(0.45, 4.9, 6.3, 5.5, 5.7), ms(2.0, 5.1, 6.3, 5.7, 5.75), ms(8, 5.1, 6.3, 5.7, 5.75), ms(14, 5.1, 6.3, 5.7, 5.75),
    ms(20, 5.1, 6.3, 5.7, 5.75), ms(25, 5.1, 6.25, 5.65, 5.7), ms(29, 5.0, 5.75, 5.0, 5.2, 0.65, 0.32),
    ms(33, 4.55, 4.6, 3.55, 4.05, 0.72, 0.35), ms(36.5, 3.4, 3.3, 2.05, 2.75, 0.8, 0.4), ms(39, 1.6, 2.15, 0.95, 1.5, 0.9, 0.6),
    ms(40, 0.12, 1.85, 0.1, 0.1, 1, 1),
  ];
  const L = loftSurface(st);
  const bodyG = solidLoft(st, { sides: 32, samples: 44 });
  paintGeo(bodyG, (p) => (p.z > 38.5 ? FUTURE.sky : p.y > 11.3 ? FUTURE.pearl : FUTURE.white));
  part(paint, bodyG, 0xffffff, null, null, { keepColor: true });

  for (const side of [1, -1]) {
    // the sky-blue sweep, laid on the flank so its edge is exact
    part(paint, flankSlab(L, side, 1.0, 38.7, 0.3, MAG_STRIPE, { nz: 52, ny: 4, lift: 0.035, thick: 0.03 }), FUTURE.sky);
    // the light lines: a cyan one over the edge of the blue, a pink one under it
    part(glow, flankSlab(L, side, 1.0, 38.6, (z) => MAG_STRIPE(z) + 0.02, (z) => MAG_STRIPE(z) + 0.3, { nz: 44, ny: 1, lift: 0.05, thick: 0.03 }), GLOW_CYAN);
    part(glow, flankSlab(L, side, 1.0, 38.3, (z) => MAG_STRIPE(z) - 0.42, (z) => MAG_STRIPE(z) - 0.3, { nz: 44, ny: 1, lift: 0.075, thick: 0.03 }), GLOW_PINK);
    // windows
    for (const zc of [8.3, 11.3, 14.3, 17.3, 20.3, 23.3]) {
      part(glass, flankSlab(L, side, zc - 1.2, zc + 1.2, 6.3, 8.9, { nz: 4, ny: 4, lift: 0.03, thick: 0.05 }), FUTURE.glass);
    }
    // the door, with its own window and a lit button
    part(paint, flankSlab(L, side, 2.8, 5.6, 0.95, 9.3, { nz: 4, ny: 12, lift: 0.075, thick: 0.05 }), 0xc7d0dd);
    part(glass, flankSlab(L, side, 3.2, 5.2, 6.3, 8.9, { nz: 3, ny: 4, lift: 0.13, thick: 0.04 }), FUTURE.glass);
    part(glow, flankSlab(L, side, 5.75, 6.05, 4.6, 4.95, { nz: 1, ny: 1, lift: 0.06, thick: 0.04 }), GLOW_LIME);
    // headlights near the tip
    part(glow, flankSlab(L, side, 36.4, 38.2, (z) => mixN(2.05, 1.75, (z - 36.4) / 1.8), (z) => mixN(2.7, 2.3, (z - 36.4) / 1.8), { nz: 6, ny: 2, lift: 0.07, thick: 0.04 }), 0xe8fcff);
    // the name on the nose, in reading order
    const [z0, z1] = side > 0 ? [32.2, 26.6] : [26.6, 32.2];
    part(glow, flankSlab(L, side, z0, z1, 3.05, 4.25, { nz: 12, ny: 3, lift: 0.075, thick: 0.03, uv: atlas.rects[0] }), 0xffffff, null, null, { keepUV: true });
  }
  // the windscreen over the nose
  part(glass, slab(10, 8, (a, b) => {
    const z = mixN(30.0, 35.2, a);
    const hx = mixN(3.5, 2.3, a);
    return L.crown(z, mixN(hx, -hx, b));
  }, { lift: 0.015, thick: 0.05 }), FUTURE.glass);

  // The underside: two skirts, two aprons, and the lit levitation gap over the beam.
  const ss = (d, a, w, up, dn) => ({ d, a, w, up, dn, b: 0.75, roundUp: 1, roundDn: 0.22 });
  for (const sx of [1, -1]) {
    const sk = [ss(1.4, 3.3 * sx, 0.2, 0.2, 0.2), ss(1.9, 3.35 * sx, 1.5, 0.65, 0.72), ss(8, 3.35 * sx, 1.6, 0.7, 0.75),
      ss(16, 3.35 * sx, 1.6, 0.7, 0.75), ss(24, 3.35 * sx, 1.6, 0.7, 0.75), ss(30, 3.25 * sx, 1.5, 0.7, 0.75),
      ss(33.5, 3.0 * sx, 1.25, 0.6, 0.7), ss(35.8, 2.6 * sx, 0.9, 0.45, 0.55), ss(36.6, 2.4 * sx, 0.15, 0.15, 0.15)];
    part(trim, solidLoft(sk, { sides: 12, samples: 24 }), 0x473f69);
    rod(glow, [[4.88 * sx, 0.14, 2.2], [4.92 * sx, 0.14, 18], [4.82 * sx, 0.14, 30], [4.2 * sx, 0.16, 33.6]], 0.055, 0x3fc9d8, 5, { steps: 24 });
    part(trim, rbox(0.34, 1.12, 30, 0.25, 12), GRAPHITE, [1.84 * sx, 0.11, 18.2]);
    part(glow, new THREE.BoxGeometry(0.04, 0.12, 29), 0x3fc9d8, [1.665 * sx, 0.02, 18.2]);
  }
  part(glow, new THREE.BoxGeometry(2.9, 0.05, 29.5), 0x3fc9d8, [0, 0.53, 18.2]);
  return { paint, trim, glow, glass };
}

function maglevTrain() {
  const atlas = glowAtlas([{ text: 'MAGLEV', fg: '#5cf2ff', bg: '#16224a', aspect: 4.6 }]);
  const lists = { paint: [], trim: [], glow: [], glass: [] };
  const front = maglevCar(atlas);
  const back = maglevCar(atlas);
  for (const key of Object.keys(lists)) {
    lists[key].push(...front[key]);
    // The rear car is the same car turned round: a two-ended train.
    for (const p of back[key]) {
      const g = bake(p);
      g.rotateY(Math.PI);
      lists[key].push({ geometry: g, color: p.color, keepColor: p.keepColor, keepUV: p.keepUV });
    }
  }
  // The gangway between the cars: dark, ribbed bellows.
  const bel = [-0.62, -0.2, 0.2, 0.62].map((d) => ({ d, w: 4.0, b: 6.2, up: 4.8, dn: 5.2, roundUp: 0.6, roundDn: 0.35 }));
  part(lists.trim, solidLoft(bel, { sides: 24, samples: 15, warp: (t) => -0.12 * (1 - Math.cos(TAU * 5 * t)) / 2 }), DARK);
  return assemble(lists, atlas);
}

// A part's geometry with its own position/rotation already applied, ready to be moved again.
function bake(p) {
  let g = p.geometry.clone();
  if (p.position || p.rotation) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(p.position ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rotation ?? [0, 0, 0]), 'XYZ')),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(m);
  }
  return g;
}


// ---------------------------------------------------------------------------------------------
// robo-bus
// ---------------------------------------------------------------------------------------------
// A 20ft driverless shuttle: a rounded pebble of glass on a yellow skirt, a violet roof carrying
// three solar panels, seats and grab poles inside, a smiling face of light at each end, "LOOP 1"
// lit front, back and over the door, and an open doorway on the kerb side (-X) whose ramp folds out
// to the ground whenever the bus is standing still and slides away under the floor when it moves.
//
// THE BODY IS ONE ANALYTIC SURFACE: a superellipse in plan whose size changes with height
// (`BUS_ROWS`). The glass, the chassis, the roof and every panel, pillar, lamp and sign are laid on
// that one function, so nothing can float off the body or sink into it.
const BUS_P = 0.3;
const BUS_ROWS = [[0.72, 3.42, 9.6], [1.45, 3.62, 9.8], [3.0, 3.7, 9.92], [6.6, 3.64, 9.88], [7.95, 3.46, 9.7], [8.4, 3.38, 9.62], [8.75, 3.05, 9.3], [8.92, 2.6, 8.8]];
const BUS_WHEEL_Z = 7.0;
const BUS_HINGE = [-3.62, 1.43];

function busWL(y) {
  const R = BUS_ROWS;
  if (y <= R[0][0]) return [R[0][1], R[0][2]];
  for (let i = 1; i < R.length; i++) {
    if (y <= R[i][0]) {
      const t = (y - R[i - 1][0]) / (R[i][0] - R[i - 1][0]);
      return [mixN(R[i - 1][1], R[i][1], t), mixN(R[i - 1][2], R[i][2], t)];
    }
  }
  return [R[R.length - 1][1], R[R.length - 1][2]];
}
// A point of the superellipse |x/W|^n + |z/L|^n = 1 at POLAR angle th. The usual |cos|^p form is
// so steep at the middle of each flat side that a table of it cannot be inverted there, and a sign
// laid on the side came out with its letters squeezed at one end and stretched at the other.
const BUS_N = 2 / BUS_P;
const supXZ = (th, W, L) => {
  const c = Math.cos(th); const s = Math.sin(th);
  const r = (Math.abs(c / W) ** BUS_N + Math.abs(s / L) ** BUS_N) ** (-1 / BUS_N);
  return [r * c, r * s];
};
// u is a fraction of the way round the plan, BY ARC LENGTH, from +X through +Z (the front), -X and
// -Z. Even steps in angle would put nearly every sample on the four corners of so square a shape.
const BUS_THETA = (() => {
  const N = 4000; const cum = [0]; let prev = supXZ(0, 3.65, 9.85);
  for (let i = 1; i <= N; i++) {
    const p = supXZ((i / N) * TAU, 3.65, 9.85);
    cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])); prev = p;
  }
  const total = cum[N];
  return (u) => {
    const f = ((u % 1) + 1) % 1 * total;
    let lo = 0; let hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] < f) lo = m; else hi = m; }
    const t = (f - cum[lo]) / Math.max(1e-9, cum[hi] - cum[lo]);
    return ((lo + t) / N) * TAU;
  };
})();
function busP(u, y) { const [W, L] = busWL(y); const [x, z] = supXZ(BUS_THETA(u), W, L); return [x, y, z]; }
function busS(u, y) {
  const e = 0.0008;
  const a = busP(u + e, y); const b = busP(u - e, y); const c = busP(u, y + 0.01); const d = busP(u, y - 0.01);
  const pu = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; const py = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let n = [pu[1] * py[2] - pu[2] * py[1], pu[2] * py[0] - pu[0] * py[2], pu[0] * py[1] - pu[1] * py[0]];
  const p = busP(u, y);
  if (n[0] * p[0] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return { p, n: [n[0] / len, n[1] / len, n[2] / len] };
}
// The u at which a face reaches a coordinate: face 'px' / 'nx' by z, 'pz' / 'nz' by x.
function busU(face, v) {
  const spec = {
    px: [-0.2, 0.2, (u) => busP(u, 3)[2], 1], nx: [0.3, 0.7, (u) => busP(u, 3)[2], -1],
    pz: [0.05, 0.45, (u) => busP(u, 3)[0], -1], nz: [0.55, 0.95, (u) => busP(u, 3)[0], 1],
  }[face];
  let [lo, hi] = spec; const f = spec[2]; const rising = spec[3] > 0;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if ((f(m) < v) === rising) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// A slab on the body between two u and two heights (y0 may be a function of the point's z).
function busSlab(u0, u1, y0, y1, { nu = 8, ny = 2, lift = 0.02, thick = 0.05, uv = null } = {}) {
  const Y0 = typeof y0 === 'function' ? y0 : () => y0;
  return slab(nu, ny, (a, b) => {
    const u = mixN(u0, u1, a);
    const z = busP(u, 1.5)[2];
    return busS(u, mixN(Y0(z), y1, b));
  }, { lift, thick, uv });
}
// A vertical loft of the body between rows of heights, optionally with triangles cut away.
function busLoft(ys, { nU = 120, inset = 0, capTop = true, capBottom = true, cut = null } = {}) {
  const T = new Tris();
  const rings = ys.map((y) => {
    const ring = [];
    for (let i = 0; i < nU; i++) {
      const p = busP(i / nU, y);
      const [W] = busWL(y);
      const k = inset ? (W - inset) / W : 1;
      ring.push(T.v([p[0] * k, y, p[2] * (inset ? 1 - inset / 9.8 : 1)]));
    }
    return ring;
  });
  const P = T.pos;
  const keep = (a, b, c) => {
    if (!cut) return true;
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3; const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3; const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    return !cut(cx, cy, cz);
  };
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < nU; i++) {
      const a = rings[r][i]; const b = rings[r][(i + 1) % nU]; const c = rings[r + 1][(i + 1) % nU]; const d = rings[r + 1][i];
      const want = [P[a * 3], 0, P[a * 3 + 2]];
      if (keep(a, b, c)) T.tri(a, b, c, want);
      if (keep(a, c, d)) T.tri(a, c, d, want);
    }
  }
  const cap = (ring, y, dir) => {
    const ctr = T.v([0, y, 0]);
    for (let i = 0; i < nU; i++) T.tri(ctr, ring[i], ring[(i + 1) % nU], [0, dir, 0]);
  };
  if (capBottom) cap(rings[0], ys[0], -1);
  if (capTop) cap(rings[rings.length - 1], ys[ys.length - 1], 1);
  return T.geometry();
}

function roboBus() {
  const paint = []; const trim = []; const glow = []; const clear = []; const glass = [];
  const atlas = glowAtlas([
    { text: 'LOOP 1', fg: '#ffd166', bg: '#11131c', aspect: 6 },
    {
      aspect: 1, bg: '#2f6fd6',
      draw: (ctx, x, y, w, h) => {
        // The access symbol, drawn as paths: a head, a back and seat, and a wheel.
        ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const S = w / 100; const X = (v) => x + v * S; const Y = (v) => y + v * S;
        ctx.beginPath(); ctx.arc(X(42), Y(17), 8 * S, 0, TAU); ctx.fill();
        ctx.lineWidth = 9 * S;
        ctx.beginPath(); ctx.moveTo(X(40), Y(30)); ctx.lineTo(X(42), Y(58)); ctx.lineTo(X(66), Y(58)); ctx.lineTo(X(76), Y(80)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(X(42), Y(44)); ctx.lineTo(X(62), Y(44)); ctx.stroke();
        ctx.lineWidth = 7 * S;
        ctx.beginPath(); ctx.arc(X(44), Y(68), 20 * S, -0.9, Math.PI * 1.25); ctx.stroke();
      },
    },
  ]);

  // The glass all round, open in the kerb-side doorway.
  const doorCut = (x, y, z) => x < 0 && Math.abs(z) < 2.05 && y < 7.9;
  part(clear, busLoft([1.45, 2.2, 3.0, 4.5, 6.0, 6.6, 7.3, 7.95], { nU: 128, capBottom: false, cut: doorCut }), 0x86c8e6, null, null, { open: true });
  // The roof, violet, closed.
  const roofG = busLoft([7.9, 8.2, 8.5, 8.7, 8.84, 8.92], { nU: 96 });
  paintGeo(roofG, (p) => (p.y > 8.9 ? 0x7a52d8 : FUTURE.violet));
  part(paint, roofG, 0xffffff, null, null, { keepColor: true });
  // The chassis: narrow, between the wheels, dark.
  part(trim, busLoft([0.72, 1.3], { nU: 64, inset: 1.15 }), GRAPHITE);

  // The yellow skirt all round, arched over the wheels, with a gap for the door.
  const uD1 = busU('nx', 2.05); const uD2 = busU('nx', -2.05);
  const archY = (z) => {
    const dz = Math.abs(Math.abs(z) - BUS_WHEEL_Z);
    return dz < 1.8 ? 0.76 + 1.88 * Math.sqrt(1 - (dz / 1.8) ** 2) : 0.76;
  };
  part(paint, busSlab(uD2, uD1 + 1, archY, 2.76, { nu: 140, ny: 4, lift: 0.015, thick: 0.07 }), FUTURE.sun);
  part(paint, busSlab(uD2, uD1 + 1, 2.7, 2.9, { nu: 110, ny: 1, lift: 0.08, thick: 0.05 }), FUTURE.teal);
  part(paint, busSlab(0, 1, 7.28, 7.95, { nu: 110, ny: 1, lift: 0.015, thick: 0.06 }), FUTURE.pearl);
  // Pillars.
  const pillars = [['px', -8.9], ['px', -4.6], ['px', 0], ['px', 4.6], ['px', 8.9], ['nx', -8.9], ['nx', -4.6], ['nx', -2.2], ['nx', 2.2], ['nx', 4.6], ['nx', 8.9]];
  for (const [face, z] of pillars) {
    const u = busU(face, z);
    part(paint, busSlab(u - 0.0045, u + 0.0045, 2.85, 7.3, { nu: 2, ny: 6, lift: 0.015, thick: 0.08 }), FUTURE.pearl);
  }
  // The sliding door leaves, parked open either side of the doorway.
  for (const [za, zb] of [[2.25, 4.45], [-4.45, -2.25]]) {
    const ua = busU('nx', za); const ub = busU('nx', zb);
    part(clear, busSlab(ua, ub, 1.5, 7.25, { nu: 4, ny: 4, lift: 0.16, thick: 0.06 }), 0x86c8e6);
    part(paint, busSlab(ua, ub, 7.1, 7.27, { nu: 4, ny: 1, lift: 0.16, thick: 0.07 }), FUTURE.pearl);
  }
  // Under the arches: a dark liner round the top of each wheel.
  for (const zw of [-BUS_WHEEL_Z, BUS_WHEEL_Z]) {
    for (const side of [1, -1]) {
      wheel(paint, trim, { x: 3.0 * side, z: zw, size: TYRE.van, side, rimColor: FUTURE.white, hubColor: FUTURE.teal });
      part(trim, slab(16, 1, (a, b) => {
        const th = mixN(0.05, Math.PI - 0.05, a);
        const nz = -Math.cos(th) / 1.74; const ny = -Math.sin(th) / 1.84; const k = Math.hypot(nz, ny);
        return { p: [side * mixN(2.4, 3.45, b), 0.76 + Math.sin(th) * 1.84, zw + Math.cos(th) * 1.74], n: [0, ny / k, nz / k] };
      }, { lift: 0, thick: 0.06 }), DARK);
    }
  }

  // Faces: a smile of light and two eyes in front, pink lamps behind.
  for (const [face, sgn, col] of [['pz', 1, 0xdcfdff], ['nz', -1, GLOW_PINK]]) {
    for (const x of [-1.75, 1.75]) {
      const h = busS(busU(face, x), 2.15);
      const e = ellipsoid(0.55, 0.32, 0.12, 14); e.applyMatrix4(onSurface(h, -0.06));
      part(glow, e, col);
    }
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const x = mixN(-1.1, 1.1, i / 12);
      const h = busS(busU(face, x), 1.42 + 0.3 * (x / 1.1) ** 2);
      pts.push([h.p[0] + h.n[0] * 0.1, h.p[1], h.p[2] + h.n[2] * 0.1]);
    }
    rod(glow, pts, 0.07, sgn > 0 ? GLOW_CYAN : GLOW_PINK, 6, { steps: 20 });
  }
  // "LOOP 1" front, back and over the door, each in reading order from outside.
  const sign = (ua, ub) => part(glow, busSlab(ua, ub, 7.33, 7.9, { nu: 8, ny: 2, lift: 0.08, thick: 0.03, uv: atlas.rects[0] }), 0xffffff, null, null, { keepUV: true });
  sign(busU('pz', -1.75), busU('pz', 1.75));
  sign(busU('nz', 1.75), busU('nz', -1.75));
  sign(busU('nx', -1.75), busU('nx', 1.75));
  part(glow, busSlab(busU('nx', -5.35), busU('nx', -4.5), 1.4, 2.25, { nu: 3, ny: 2, lift: 0.09, thick: 0.03, uv: atlas.rects[1] }), 0xffffff, null, null, { keepUV: true });

  // Solar panels on the flat of the roof.
  for (const zc of [-5.2, 0, 5.2]) {
    part(paint, rbox(4.1, 0.16, 4.85, 0.25, 10), 0xb7c0cc, [0, 8.98, zc]);
    part(glass, new THREE.BoxGeometry(3.9, 0.06, 4.62), 0x22408a, [0, 9.07, zc]);
    for (let i = -2; i <= 2; i++) part(paint, new THREE.BoxGeometry(0.035, 0.03, 4.62), 0x9aa6b8, [i * 0.78, 9.11, zc]);
    for (let j = -3; j <= 3; j++) part(paint, new THREE.BoxGeometry(3.9, 0.03, 0.035), 0x9aa6b8, [0, 9.11, zc + j * 0.66]);
  }

  // Inside: a floor, raised decks over the wheels with benches facing each other, a side bench,
  // grab poles and a strip of light along the ceiling.
  part(trim, new THREE.BoxGeometry(6.9, 0.15, 10.7), 0xb6bccb, [0, 1.375, 0]);
  part(trim, new THREE.BoxGeometry(1.25, 0.7, 4.1), GRAPHITE, [-2.95, 1.08, 0]);
  part(glow, new THREE.BoxGeometry(0.08, 0.05, 4.0), GLOW_LIME, [-3.55, 1.43, 0]);
  for (const dir of [1, -1]) {
    part(trim, rbox(6.0, 1.6, 3.6, 0.2, 10), 0x9ea6b8, [0, 2.2, 7.2 * dir]);
    part(trim, rbox(5.4, 0.45, 1.5, 0.35, 8), FUTURE.coral, [0, 3.2, 6.35 * dir]);
    part(trim, rbox(5.4, 2.0, 0.4, 0.35, 8), FUTURE.sky, [0, 4.25, 7.3 * dir], [-0.12 * dir, 0, 0]);
  }
  part(trim, rbox(1.3, 1.3, 4.6, 0.25, 8), GRAPHITE, [2.65, 2.1, 0]);
  part(trim, rbox(1.5, 0.45, 4.8, 0.35, 8), FUTURE.coral, [2.6, 2.95, 0]);
  part(trim, rbox(0.4, 1.9, 4.8, 0.35, 8), FUTURE.sky, [3.2, 3.95, 0]);
  for (const [x, z] of [[-1.5, 2.6], [-1.5, -2.6], [1.3, 4.5], [1.3, -4.5]]) rod(paint, [[x, 1.45, z], [x, 7.9, z]], 0.07, FUTURE.sun, 8);
  for (const x of [-1.5, 1.3]) rod(paint, [[x, 7.55, -5.0], [x, 7.55, 5.0]], 0.06, FUTURE.sun, 8);
  part(glow, new THREE.BoxGeometry(0.5, 0.05, 11), GLOW_CYAN, [0, 7.86, 0]);

  // The ramp: its own small mesh in a group hinged at the door sill. Its yellow rails glow.
  const sw = swatches(['#000000', '#b6ff5c']);
  const rampParts = [];
  part(rampParts, uvAll(rbox(3.0, 0.12, 3.4, 0.25, 10), sw.at(0)), 0x5a6070, [-1.5, -0.06, 0]);
  for (let i = 0; i < 6; i++) part(rampParts, uvAll(new THREE.BoxGeometry(0.08, 0.03, 3.1), sw.at(0)), 0x7c8394, [-0.35 - i * 0.48, 0.01, 0]);
  for (const sz of [1, -1]) part(rampParts, uvAll(new THREE.BoxGeometry(3.0, 0.1, 0.12), sw.at(1)), FUTURE.sun, [-1.5, 0.03, 1.64 * sz]);
  const ramp = new THREE.Group();
  const rampMesh = mesh(mergeParts(rampParts), standard({
    vertexColors: true, roughness: 0.6, metalness: 0.1, emissive: 0xffffff, emissiveMap: sw.tex, emissiveIntensity: 0.9,
  }));
  ramp.add(rampMesh);
  // The deployed angle puts the far bottom edge of the plate exactly on the ground.
  let alpha = 0.5;
  for (let i = 0; i < 30; i++) {
    const f = BUS_HINGE[1] - 3.0 * Math.sin(alpha) - 0.12 * Math.cos(alpha);
    alpha += f * 0.3;
  }
  const pose = (s) => {
    const slide = s < 0.5 ? 1 - s / 0.5 : 0;
    ramp.position.set(BUS_HINGE[0] + 3.3 * slide, BUS_HINGE[1], 0);
    ramp.rotation.z = s > 0.5 ? alpha * ((s - 0.5) / 0.5) : 0;
  };
  let s = 1; pose(s);

  const group = assemble({ paint, trim, glass, glow, clear }, atlas, { clear: { opacity: 0.26 }, extra: [ramp] });
  // Out when standing still, away when moving: the root's own position says which.
  const last = new THREE.Vector3(); const now = new THREE.Vector3();
  let primed = false; let still = 1; let target = 1;
  addTick(group, (dt, reduced) => {
    group.updateWorldMatrix(true, false);
    now.setFromMatrixPosition(group.matrixWorld);
    const moved = primed && now.distanceToSquared(last) > 1e-6;
    last.copy(now); primed = true;
    if (moved) { still = 0; target = 0; } else { still += dt; if (still > 0.5) target = 1; }
    if (reduced) s = target;
    else s = s < target ? Math.min(target, s + dt * 1.4) : Math.max(target, s - dt * 2.2);
    pose(s);
  });
  return group;
}

export const BUILDERS = {
  'air-taxi': airTaxi,
  'self-driving-pod': selfDrivingPod,
  'maglev-train': maglevTrain,
  'delivery-drone': deliveryDrone,
  'robo-bus': roboBus,
};
