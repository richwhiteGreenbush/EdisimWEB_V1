// Builders for the Model Database's fifth organic set: the human skull, the human spine, the
// bacteriophage, the giraffe and the polar bear. Two bones read at arm's length, one virus built as a
// machine, and two animals whose coats have to carry the identification.

import * as THREE from 'three';
import { mergeParts, smoothNoise3, solidSurface } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  lin, clamp01, mix, sstep, fieldD, sphereP, ellipsoidP, segsP, curveP, boxP, Sculpt, onSurface, fieldNormal, pathOn, polygonize, tube, lathe, mirrorX, tintVertices,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const E = ellipsoidP;

// A half space, or any function, as a solid for Sculpt.sub. It has no raw bounds, so it never widens the grid.
const fieldP = (f) => ({ box: [-1e4, -1e4, -1e4, 1e4, 1e4, 1e4], f });

// A flat-sectioned strip following a path in one plane: the jaw's body, an alveolar ridge, the sacrum. The
// points are [a, b, centre, halfWide, halfHigh], where (a, b) lie in the plane named by `plane` and `centre`
// is the third coordinate. A rounded box in (distance to the path, height) is the section.
function ribbonP(points, { plane = 'xz', round = 0.02 } = {}) {
  const n = points.length - 1;
  const pick = plane === 'xz' ? (x, y, z, o) => { o[0] = x; o[1] = z; o[2] = y; } : (x, y, z, o) => { o[0] = z; o[1] = y; o[2] = x; };
  let lo = [1e9, 1e9, 1e9]; let hi = [-1e9, -1e9, -1e9];
  for (const [a, b, c, w, h] of points) {
    const reach = w + h + round;
    lo = [Math.min(lo[0], a - reach), Math.min(lo[1], b - reach), Math.min(lo[2], c - h - round)];
    hi = [Math.max(hi[0], a + reach), Math.max(hi[1], b + reach), Math.max(hi[2], c + h + round)];
  }
  const box = plane === 'xz' ? [lo[0], lo[2], lo[1], hi[0], hi[2], hi[1]] : [lo[2], lo[1], lo[0], hi[2], hi[1], hi[0]];
  const o = [0, 0, 0];
  return {
    box,
    f: (x, y, z) => {
      pick(x, y, z, o);
      let best = 1e18; let bi = 0; let bt = 0;
      for (let i = 0; i < n; i++) {
        const p = points[i]; const q = points[i + 1];
        const dx = q[0] - p[0]; const dy = q[1] - p[1];
        const L = dx * dx + dy * dy;
        let t = L > 0 ? ((o[0] - p[0]) * dx + (o[1] - p[1]) * dy) / L : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = o[0] - p[0] - dx * t; const ey = o[1] - p[1] - dy * t;
        const d = ex * ex + ey * ey;
        if (d < best) { best = d; bi = i; bt = t; }
      }
      const p = points[bi]; const q = points[bi + 1];
      const lat = Math.sqrt(best) - mix(p[3], q[3], bt);
      const up = Math.abs(o[2] - mix(p[2], q[2], bt)) - mix(p[4], q[4], bt);
      const ox = Math.max(lat, 0); const oy = Math.max(up, 0);
      return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(lat, up), 0) - round;
    },
  };
}

// A plate cut to an outline in the (z, y) plane, standing at x = cx. The exact polygon distance, extruded.
function plateP(outline, cx, half, round = 0.015, lean = 0) {
  const n = outline.length;
  let z0 = 1e9; let z1 = -1e9; let y0 = 1e9; let y1 = -1e9;
  for (const [a, b] of outline) { z0 = Math.min(z0, a); z1 = Math.max(z1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); }
  const yMid = (y0 + y1) / 2;
  const slack = Math.abs(lean) * (y1 - y0) + half + round;
  return {
    box: [cx - slack, y0 - round, z0 - round, cx + slack, y1 + round, z1 + round],
    f: (x, y, z) => {
      let best = 1e18; let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const [ai, bi] = outline[i]; const [aj, bj] = outline[j];
        const ex = aj - ai; const ey = bj - bi;
        const wx = z - ai; const wy = y - bi;
        const L = ex * ex + ey * ey;
        let t = L > 0 ? (wx * ex + wy * ey) / L : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = wx - ex * t; const qy = wy - ey * t;
        const d = qx * qx + qy * qy;
        if (d < best) best = d;
        if ((bi > y) !== (bj > y) && z < (aj - ai) * (y - bi) / (bj - bi) + ai) inside = !inside;
      }
      const inPlane = (inside ? -1 : 1) * Math.sqrt(best);
      const off = Math.abs(x - cx - lean * (y - yMid)) - half;
      const ox = Math.max(inPlane, 0); const oy = Math.max(off, 0);
      return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(inPlane, off), 0) - round;
    },
  };
}

// Rounds a coarse outline by sampling a closed Catmull-Rom through it.
function smoothOutline(points, perSpan = 4) {
  const c = new THREE.CatmullRomCurve3(points.map(([a, b]) => new THREE.Vector3(a, b, 0)), true, 'catmullrom', 0.5);
  const out = [];
  const N = points.length * perSpan;
  for (let i = 0; i < N; i++) { const v = c.getPoint(i / N); out.push([v.x, v.y]); }
  return out;
}

// One field, two densities. `build(cell)` makes the sculpt; each zone polygonises finely inside its box, and the
// coarse pass over everything then drops what those boxes cover. Both passes walk their vertices onto one true
// surface and colour them from one function, so the overlap a cell or two wide cannot be seen, and a face can
// carry four times the triangles per square foot of the smooth dome it grows out of.
function zoned(build, coarseCell, zones, options = () => ({})) {
  const out = [];
  for (const zone of zones) {
    const s = build(zone.cell);
    out.push(polygonize(s, { ...options(s), bounds: zone.box }));
  }
  const s = build(coarseCell);
  const g = polygonize(s, options(s));
  const P = g.attributes.position;
  const idx = g.index;
  const inBox = (i, b) => {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    return x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5];
  };
  const kept = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    if (zones.some((zone) => inBox(a, zone.box) && inBox(b, zone.box) && inBox(c, zone.box))) continue;
    kept.push(a, b, c);
  }
  g.setIndex(kept);
  out.push(g);
  return out;
}

// Drops every triangle wholly inside a predicate's region: roots buried in bone, undersides on the ground.
function dropWhere(geometry, fn) {
  const P = geometry.attributes.position;
  const idx = geometry.index;
  const kept = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    if (fn(P.getX(a), P.getY(a), P.getZ(a)) && fn(P.getX(b), P.getY(b), P.getZ(b)) && fn(P.getX(c), P.getY(c), P.getZ(c))) continue;
    kept.push(a, b, c);
  }
  geometry.setIndex(kept);
  return geometry;
}

// ---------------------------------------------------------------------------------------------
// Human skull
// ---------------------------------------------------------------------------------------------

// Five times life, in the anatomical (Frankfurt) position, on a turned stand whose stem enters the foramen
// magnum. Everything is one field cut by one plane: the braincase below it, the cap above it, so the two
// cut rims are the same curve and the wall is really there. The sutures are a painting on a direction map
// about the middle of the head, which is why a suture runs on across the cut from the base onto the cap and
// shows on the inside of the wall as well, as it does on a real one.
const SKULL = {
  CX: [0, 3.3, -0.2],
  WALL: 0.17,
  // The cut, running from just above the brows down to the back of the head.
  cut: (y, z) => (y - (3.42 + 0.145 * z)) * 0.99,
  JAW: { y: 2.74, z: -0.12, open: 0.16 },
  // Rests on the stem: the stem is the origin's axis, so the whole head moves forward by this much.
  DZ: 0.42,
};

// Mesiodistal crown widths, in mm, central incisor to third molar: ordinary textbook figures, within a mm.
const UPPER_TEETH = [8.5, 6.5, 7.6, 7.0, 6.8, 10.2, 9.5, 8.6];
const LOWER_TEETH = [5.0, 5.5, 6.8, 7.0, 7.0, 11.0, 10.5, 10.0];
const TOOTH_KIND = ['incisor', 'incisor', 'canine', 'premolar', 'premolar', 'molar', 'molar', 'molar'];

function archTable(W, L, zF) {
  const N = 120;
  const pts = [];
  for (let i = 0; i <= N; i++) { const x = (i / N) * W; pts.push([x, zF - L * (x / W) ** 2.2]); }
  const s = [0];
  for (let i = 1; i <= N; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = s[N];
  const at = (d) => {
    let i = 0;
    while (i < N - 1 && s[i + 1] < d) i += 1;
    const t = clamp01((d - s[i]) / (s[i + 1] - s[i]));
    const x = mix(pts[i][0], pts[i + 1][0], t); const z = mix(pts[i][1], pts[i + 1][1], t);
    const tx = pts[i + 1][0] - pts[i][0]; const tz = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(tx, tz);
    return { x, z, tx: tx / len, tz: tz / len };
  };
  return { at, total };
}

// Where each tooth stands on one half of an arch, with the widths scaled to fill it.
function toothStations(arch, widths) {
  const sum = widths.reduce((a, b) => a + b, 0);
  const k = (arch.total * 0.985) / sum;
  let d = 0;
  return widths.map((w, i) => {
    const wide = w * k;
    const c = d + wide / 2;
    d += wide;
    return { ...arch.at(c), wide, kind: TOOTH_KIND[i], n: i };
  });
}

// One tooth, crown toward +Y from a neck at y = 0, with its width along X and a real root. The root is cut away
// afterward where the bone will hide it, because 32 buried roots are a quarter of the teeth's triangles.
function toothTemplate(kind) {
  const s = new Sculpt(0.033);
  const IV = lin(0xe9dfc4);
  if (kind === 'incisor') {
    s.add(segsP([[0, -0.2, 0], [0, 0, 0], [0, 0.12, 0], [0, 0.17, 0]], [0.035, 0.078, 0.086, 0.09]), IV);
    s.sub(fieldP((x, y) => 0.2 - y), null, { k: 0.02 });
    s.sub(E([0, 0.15, -0.14], [0.11, 0.13, 0.1]), null, { k: 0.02 }); // the lingual scoop
    s.sub(fieldP((x, y, z) => Math.abs(z) > 0.058 ? 0.058 - Math.abs(z) : 0.058 - Math.abs(z)), null, { k: 0.02 });
  } else if (kind === 'canine') {
    s.add(segsP([[0, -0.26, 0], [0, 0, 0], [0, 0.1, 0], [0, 0.17, 0], [0, 0.23, 0]], [0.04, 0.078, 0.078, 0.05, 0.012]), IV);
  } else if (kind === 'premolar') {
    s.add(segsP([[0, -0.16, 0], [0, 0, 0], [0, 0.06, 0]], [0.04, 0.07, 0.085]), IV);
    s.add(sphereP([0, 0.11, 0.045], 0.052), IV, { k: 0.03 });
    s.add(sphereP([0, 0.1, -0.045], 0.048), IV, { k: 0.03 });
  } else {
    s.add(boxP([0, 0.045, 0], [0.058, 0.045, 0.055], null, 0.038), IV);
    s.add(segsP([[0, -0.15, 0], [0, 0, 0]], [0.05, 0.075]), IV, { k: 0.03 });
    for (const a of [-1, 1]) for (const b of [-1, 1]) s.add(sphereP([a * 0.052, 0.105, b * 0.05], 0.05), IV, { k: 0.028 });
    s.sub(boxP([0, 0.17, 0], [0.13, 0.03, 0.007], null, 0.006), null, { k: 0.016 });
    s.sub(boxP([0, 0.17, 0], [0.007, 0.03, 0.13], null, 0.006), null, { k: 0.016 });
  }
  const g = polygonize(s, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      // Enamel over the crown, warmer dentine showing at the neck, and a stain in the fissures.
      const neck = 1 - sstep(y, -0.03, 0.05);
      const dip = 1 - sstep(y, 0.09, 0.14);
      const k = 0.96 + 0.08 * smoothNoise3(x * 30, y * 30, z * 30);
      rgb[0] = mix(0.8, 0.5, neck) * k; rgb[1] = mix(0.74, 0.37, neck) * k; rgb[2] = mix(0.57, 0.2, neck) * k;
      if (kind === 'molar' || kind === 'premolar') { const t = dip * sstep(y, 0.02, 0.1) * 0.12; rgb[0] *= 1 - t; rgb[1] *= 1 - t; rgb[2] *= 1 - t * 1.3; }
    },
  });
  dropWhere(g, (x, y) => y < -0.035);
  return g;
}

// The whole braincase and face as one list of operations, built once per density.
function skullField(cell) {
  const s = new Sculpt(cell);
  const B = lin(0xcfc0a0);
  // The dome.
  s.add(E([0, 3.35, -0.24], [1.17, 1.03, 1.46]), B);
  s.add(E([0, 3.42, 0.5], [0.94, 0.96, 0.78]), B, { k: 0.6 });
  s.add(E([0, 3.0, -1.16], [0.84, 0.66, 0.54]), B, { k: 0.3 });
  for (const q of [1, -1]) s.add(E([q * 0.62, 3.62, -0.5], [0.56, 0.62, 0.8]), B, { k: 0.6 }); // the parietal bosses
  // The flat under the back of the head, before anything is added to it.
  s.sub(fieldP((x, y, z) => Math.max(y - 2.5, z - 0.3)), null, { k: 0.34 });
  s.add(E([0, 2.76, -1.0], [0.66, 0.34, 0.56]), B, { k: 0.34 }); // the back of the base, curving under toward the neck
  // The temple hollows, which are most of why a skull does not look like an egg with a face.
  for (const q of [1, -1]) s.sub(E([q * 1.42, 2.98, 0.42], [0.62, 0.62, 0.72]), null, { k: 0.3 });
  // The wall of the braincase is this surface moved inward, so it cannot be thin anywhere and no later hollow can
  // break through it by accident.
  const vault = s.snapshot();
  for (const q of [1, -1]) s.sub(E([q * 1.02, 2.28, 0.2], [0.46, 0.38, 0.46]), null, { k: 0.1 }); // under the arch
  // The face block.
  s.add(E([0, 2.38, 1.0], [0.74, 0.6, 0.54]), B, { k: 0.12 });
  s.add(curveP([[0, 3.18, 1.28], [0, 2.95, 1.36], [0, 2.72, 1.52]], [0.11, 0.115, 0.125], 8), B, { k: 0.1 }); // the nasal bones
  s.add(E([0, 3.27, 1.24], [0.28, 0.13, 0.11]), B, { k: 0.12 }); // the glabella
  for (const q of [1, -1]) {
    // The ring of the orbit, four strong bars meeting at the corners.
    s.add(curveP([[q * 0.92, 3.2, 0.88], [q * 0.56, 3.3, 1.13], [q * 0.17, 3.2, 1.28]], [0.07, 0.078, 0.08], 10), B, { k: 0.1 });
    s.add(curveP([[q * 0.92, 3.2, 0.88], [q * 0.95, 2.96, 0.86], [q * 0.9, 2.72, 0.92]], [0.07, 0.06, 0.075], 8), B, { k: 0.08 });
    s.add(curveP([[q * 0.9, 2.7, 0.94], [q * 0.56, 2.64, 1.16], [q * 0.24, 2.76, 1.28]], [0.075, 0.065, 0.07], 10), B, { k: 0.1 });
    s.add(curveP([[q * 0.24, 2.6, 1.36], [q * 0.18, 2.95, 1.25], [q * 0.17, 3.2, 1.26]], [0.09, 0.08, 0.08], 8), B, { k: 0.08 });
    // The cheekbone and the arch springing back from it, with clear air behind.
    s.add(E([q * 0.88, 2.58, 0.9], [0.11, 0.14, 0.2], [0, q * 0.5, q * -0.3]), B, { k: 0.14 });
    s.add(ribbonP([[q * 0.98, 0.84, 2.6, 0.03, 0.12], [q * 1.1, 0.52, 2.62, 0.016, 0.075], [q * 1.15, 0.2, 2.7, 0.012, 0.055], [q * 1.15, -0.08, 2.8, 0.014, 0.05], [q * 1.08, -0.34, 2.88, 0.03, 0.05]], { round: 0.026 }), B, { k: 0.05 });
    s.add(curveP([[q * 1.08, 2.88, -0.32], [q * 1.12, 2.98, -0.78], [q * 0.98, 2.96, -1.1]], [0.07, 0.05, 0.03], 8), B, { k: 0.1 }); // the crest behind the ear
    // The mastoid, a thumb hanging behind the ear.
    s.add(E([q * 0.9, 2.54, -0.58], [0.13, 0.22, 0.16], [0.15, 0, q * 0.06]), B, { k: 0.3 });
    // The socket the jaw sits in, a ledge with a hollow under it.
    s.add(E([q * 0.88, 2.86, -0.12], [0.26, 0.14, 0.24]), B, { k: 0.08 });
  }
  // The arch that holds the upper teeth, and the palate inside it.
  const arch = archTable(0.52, 0.85, 1.46);
  const side = [];
  for (let i = 0; i <= 8; i++) { const p = arch.at((i / 8) * arch.total); side.push(p); }
  const ridge = [...side.slice(1).reverse().map((p) => [-p.x, p.z, 2.08, 0.075, 0.13]), ...side.map((p) => [p.x, p.z, 2.08, 0.075, 0.13])];
  s.add(ribbonP(ridge, { round: 0.055 }), B, { k: 0.1 });
  s.add(E([0, 2.12, 1.0], [0.5, 0.1, 0.5]), B, { k: 0.08 });
  for (const q of [1, -1]) {
    // One bulge per root, over the canine above all.
    for (const st of toothStations(arch, UPPER_TEETH)) {
      const nx = -st.tz; const nz = st.tx;
      s.add(E([q * (st.x + nx * 0.1), st.kind === 'canine' ? 2.13 : 2.08, st.z + nz * 0.1], [st.wide * 0.42, st.kind === 'canine' ? 0.27 : 0.2, 0.06]), B, { k: 0.05 });
    }
    // The pterygoid plates behind the upper jaw.
    s.add(curveP([[q * 0.36, 2.62, 0.42], [q * 0.4, 2.3, 0.42], [q * 0.42, 2.1, 0.46]], [0.075, 0.05, 0.03], 6), B, { k: 0.08 });
    // The canine fossa, under the eye.
    s.sub(E([q * 0.48, 2.38, 1.5], [0.2, 0.15, 0.1]), null, { k: 0.14 });
  }
  // The orbits: a rounded square at the front going back to a cone, tipped down and outward.
  const DARK = lin(0x4a3a28);
  // The cone of bone each orbit is hollowed out of. Behind the rim nothing else is solid there, so without this
  // its floor and outer wall are a hole into the temple.
  for (const q of [1, -1]) s.add(E([q * 0.44, 2.93, 0.74], [0.38, 0.4, 0.56], [0, q * 0.22, 0]), B, { k: 0.1 });
  for (const q of [1, -1]) {
    s.sub(boxP([q * 0.54, 2.96, 1.2], [0.19, 0.16, 0.24], [0.03, q * 0.22, q * -0.14], 0.11), DARK, { k: 0.05, ck: 0.24 });
    s.sub(E([q * 0.41, 2.97, 0.76], [0.25, 0.25, 0.44], [0, q * 0.22, 0]), DARK, { k: 0.12, ck: 0.2 });
    s.sub(E([q * 0.28, 2.99, 0.38], [0.045, 0.045, 0.12]), lin(0x1e1610), { k: 0.03 }); // the optic canal
    s.sub(curveP([[q * 0.36, 3.04, 0.42], [q * 0.56, 3.1, 0.56]], [0.026, 0.02], 3), lin(0x1e1610), { k: 0.02 }); // the fissure above it
    s.sub(curveP([[q * 0.42, 2.76, 0.56], [q * 0.68, 2.78, 0.72]], [0.026, 0.018], 3), lin(0x1e1610), { k: 0.02 }); // and the one below
  }
  // The nose: pear shaped, with the cavity going a long way back.
  s.sub(E([0, 2.42, 1.42], [0.235, 0.26, 0.5]), DARK, { k: 0.03, ck: 0.045 });
  s.sub(E([0, 2.6, 1.46], [0.135, 0.17, 0.46]), DARK, { k: 0.05, ck: 0.045 });
  s.sub(E([0, 2.5, 0.98], [0.21, 0.32, 0.4]), DARK, { k: 0.08, ck: 0.1 });
  s.add(boxP([0, 2.5, 1.0], [0.018, 0.3, 0.36], null, 0.014), lin(0xb8a888), { k: 0.012, ck: 0.01 }); // the septum
  s.add(E([0, 2.2, 1.53], [0.03, 0.022, 0.07]), B, { k: 0.05 }); // the nasal spine
  for (const q of [1, -1]) {
    s.add(E([q * 0.16, 2.36, 1.0], [0.065, 0.08, 0.26]), lin(0x7c6a4e), { k: 0.03 }); // the inferior concha
    s.add(E([q * 0.15, 2.58, 0.96], [0.055, 0.06, 0.2]), lin(0x6c5a40), { k: 0.03 }); // the middle concha
  }
  // The small named holes on the face.
  const PIT = lin(0x241a10);
  for (const q of [1, -1]) {
    s.sub(E([q * 0.44, 2.54, 1.32], [0.026, 0.032, 0.1]), PIT, { k: 0.012 }); // infraorbital foramen
    s.sub(E([q * 0.42, 3.33, 1.22], [0.02, 0.014, 0.07]), PIT, { k: 0.012 }); // supraorbital notch
    // The ear canal.
    s.sub(curveP([[q * 1.32, 2.88, -0.42], [q * 0.95, 2.87, -0.42], [q * 0.76, 2.85, -0.4]], [0.1, 0.095, 0.05], 5), PIT, { k: 0.03, ck: 0.05 });
    s.sub(E([q * 0.88, 2.74, -0.12], [0.18, 0.095, 0.13]), null, { k: 0.03 }); // the jaw's socket
  }
  // The hollow, with the three steps of its floor: the fossae, each lower than the one in front.
  const floorY = (x, z) => {
    const front = sstep(z, -0.02, 0.26);
    const midOuter = 2.92 - 0.1 * sstep(Math.abs(x), 0.2, 0.7);
    const back = sstep(z, -0.62, -0.32);
    return mix(mix(2.66, midOuter, back), 3.38 - 0.08 * (1 - sstep(Math.abs(x), 0.1, 0.5)), front);
  };
  const IN = lin(0xb09a78);
  s.sub({ box: [-1.2, 2.5, -1.8, 1.2, 4.5, 1.4], f: (x, y, z) => Math.max(vault.d(x, y, z) + SKULL.WALL, floorY(x, z) - y) }, IN, { ck: 0.05 });
  for (const q of [1, -1]) {
    // The petrous ridge, the step of hard bone running in from behind each ear.
    s.add(curveP([[q * 0.98, 2.98, -0.42], [q * 0.56, 3.02, -0.28], [q * 0.18, 2.98, -0.1]], [0.09, 0.08, 0.05], 8), IN, { k: 0.08 });
    s.sub(E([q * 0.08, 2.9, 0.42], [0.03, 0.08, 0.12]), PIT, { k: 0.02 }); // the optic canal's inner end
  }
  s.add(E([0, 2.96, 0.02], [0.16, 0.06, 0.13]), IN, { k: 0.06 }); // the body of the sphenoid
  s.sub(E([0, 3.03, 0.02], [0.07, 0.04, 0.07]), null, { k: 0.02 }); // the saddle in it
  s.add(E([0, 3.36, 0.92], [0.018, 0.09, 0.1]), IN, { k: 0.03 }); // the crista galli
  s.add(curveP([[0, 2.9, -0.82], [0, 3.1, -1.05], [0, 3.38, -1.3]], [0.03, 0.035, 0.03], 6), IN, { k: 0.05 }); // the internal occipital crest
  // The stem's way in.
  s.sub(E([0, 2.46, -0.42], [0.21, 0.42, 0.31]), lin(0x60503c), { k: 0.03, ck: 0.06 });
  for (const q of [1, -1]) s.add(E([q * 0.26, 2.44, -0.36], [0.085, 0.05, 0.17], [0, q * -0.25, 0]), B, { k: 0.03 }); // the condyles
  // A faint ridge across the back of the head, from which the neck muscles hang.
  s.add(curveP([[-0.72, 2.8, -1.2], [0, 2.86, -1.7], [0.72, 2.8, -1.2]], [0.03, 0.05, 0.03], 10), B, { k: 0.14 });
  return s;
}

// Direction about the middle of the head, flattened onto a disc: the one projection of a nearly round thing that
// has no seam on any surface a student can see. The centre of the disc is the top of the head.
function discUV(x, y, z) {
  const dx = x - SKULL.CX[0]; const dy = y - SKULL.CX[1]; const dz = z - SKULL.CX[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const a = Math.acos(Math.max(-1, Math.min(1, dy / len)));
  const h = Math.hypot(dx, dz) || 1e-6;
  const rho = a / Math.PI;
  return [0.5 + 0.5 * rho * (dx / h), 0.5 + 0.5 * rho * (dz / h)];
}
function applyDiscUV(geometry) {
  const P = geometry.attributes.position;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const [u, v] = discUV(P.getX(i), P.getY(i), P.getZ(i));
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// Every suture on the head, in the head's own feet. The interdigitation is what the card asks about, so each line
// wanders at several frequencies at once, with the tightest squiggle on the sagittal and the lambdoid.
function skullPainting() {
  const S = 1024;
  const rng = seededRandom(9101);
  const toPx = (p) => { const [u, v] = discUV(p[0], p[1], p[2]); return [u * S, (1 - v) * S]; };
  const LINES = [];
  const line = (pts, amp, tight) => LINES.push({ pts, amp, tight });
  line([[0, 4.36, 0.32], [0, 4.4, -0.2], [0, 4.25, -0.8], [0, 3.92, -1.28]], 4.2, 1); // sagittal
  for (const q of [1, -1]) {
    line([[0, 4.36, 0.32], [q * 0.5, 4.14, 0.42], [q * 0.84, 3.72, 0.5], [q * 0.94, 3.22, 0.56], [q * 0.9, 3.02, 0.6]], 3.2, 0.8); // coronal
    line([[0, 3.92, -1.28], [q * 0.5, 3.56, -1.38], [q * 0.86, 3.12, -1.22], [q * 0.98, 2.84, -0.96]], 5.2, 1.15); // lambdoid
    line([[q * 0.9, 3.02, 0.6], [q * 1.1, 3.28, 0.06], [q * 1.15, 3.24, -0.5], [q * 1.04, 2.98, -0.92], [q * 0.98, 2.84, -0.96]], 1.4, 0.55); // squamous
    line([[q * 0.9, 3.02, 0.6], [q * 0.94, 3.0, 0.8], [q * 0.97, 3.12, 0.88]], 0.7, 0.5); // sphenofrontal to the orbit's corner
    line([[q * 0.9, 3.02, 0.6], [q * 0.9, 2.74, 0.68]], 1.4, 0.6); // sphenosquamous, down to the arch
    line([[q * 1.14, 2.72, 0.24], [q * 1.15, 2.64, 0.3]], 1.1, 0.6); // the join across the arch
    line([[q * 0.74, 2.46, 1.14], [q * 0.62, 2.64, 1.18]], 0.6, 0.5); // zygomaticomaxillary
    line([[q * 0.13, 3.12, 1.34], [q * 0.16, 2.8, 1.52]], 0.7, 0.5); // the nasal bone's edge
  }
  line([[-0.26, 3.1, 1.28], [0, 3.13, 1.36], [0.26, 3.1, 1.28]], 0.8, 0.5); // frontonasal
  line([[0, 3.12, 1.36], [0, 2.76, 1.6]], 0.8, 0.5); // between the nasal bones
  line([[0, 2.14, 1.58], [0, 1.96, 1.52]], 0.9, 0.5); // between the maxillae
  const paint = (ctx) => {
    ctx.fillStyle = '#f3f1ea';
    ctx.fillRect(0, 0, S, S);
    // Slow staining, the age of a real specimen, kept near white so the vertex colour keeps the hue.
    for (let i = 0; i < 160; i++) {
      const x = rng() * S; const y = rng() * S; const r = 24 + rng() * 80;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const warm = rng() > 0.5;
      g.addColorStop(0, warm ? 'rgba(214,192,160,0.16)' : 'rgba(255,253,246,0.2)');
      g.addColorStop(1, 'rgba(240,235,225,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // Pores.
    for (let i = 0; i < 5200; i++) {
      const v = 150 + rng() * 60;
      ctx.fillStyle = `rgba(${v},${v * 0.93},${v * 0.82},${0.2 + rng() * 0.35})`;
      ctx.beginPath(); ctx.arc(rng() * S, rng() * S, 0.4 + rng() * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const { pts, amp, tight } of LINES) {
      const curve = new THREE.CatmullRomCurve3(pts.map(V3), false, 'catmullrom', 0.5);
      // Walked in pixels, so a squiggle has the same size everywhere on the map.
      const N = 60;
      let L = 0;
      let prev = toPx(pts[0]);
      for (let i = 1; i <= N; i++) { const v = curve.getPoint(i / N); const q = toPx([v.x, v.y, v.z]); L += Math.hypot(q[0] - prev[0], q[1] - prev[1]); prev = q; }
      const steps = Math.max(8, Math.round(L / 1.4));
      const path = [];
      const ph = rng() * 100;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const v = curve.getPoint(t);
        const a = toPx([v.x, v.y, v.z]);
        const w = curve.getPoint(Math.min(1, t + 0.004));
        const b = toPx([w.x, w.y, w.z]);
        const tx = b[0] - a[0]; const ty = b[1] - a[1]; const len = Math.hypot(tx, ty) || 1;
        const s = t * L;
        const wob = amp * (Math.sin(s * 0.42 * tight + ph) * 0.7 + Math.sin(s * 0.97 * tight + ph * 1.7) * 0.5 + Math.sin(s * 0.13 + ph * 0.4) * 0.8);
        path.push([a[0] - (ty / len) * wob, a[1] + (tx / len) * wob]);
      }
      const stroke = (style, width, ox = 0, oy = 0) => {
        ctx.strokeStyle = style; ctx.lineWidth = width;
        ctx.beginPath();
        path.forEach(([x, y], i) => (i ? ctx.lineTo(x + ox, y + oy) : ctx.moveTo(x + ox, y + oy)));
        ctx.stroke();
      };
      stroke('rgba(255,252,242,0.5)', 1.8, 0.7, 0.7); // the lit lip on the far side of the groove
      stroke('rgba(120,92,62,0.4)', 2.2);
      stroke('rgba(60,42,26,0.92)', 1.05);
    }
  };
  return canvasTexture(S, S, paint);
}

function humanSkull() {
  const cutFace = (y, z) => Math.abs(SKULL.cut(y, z));
  const tintOf = (s) => {
    const ops = s.ops;
    return {
      uvScale: 1,
      extraReach: 0.04,
      snap: (x, y, z) => SKULL.cut(y, z),
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const reach = 0.16;
        const open = clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
        const ao = mix(0.46, 1, open);
        const n = smoothNoise3(x * 2.4, y * 2.4, z * 2.4);
        const n2 = smoothNoise3(x * 7 + 3, y * 7, z * 7);
        const k = (0.9 + 0.16 * n + 0.06 * n2) * ao;
        rgb[0] *= k; rgb[1] *= k * (0.98 + 0.02 * n); rgb[2] *= k * (0.94 + 0.08 * n);
        // The sawn edge is paler, with the spongy layer showing as a darker band down the middle of the wall.
        if (cutFace(y, z) < 0.008 && ny > 0.6) {
          const sponge = 0.84 + 0.2 * n2;
          rgb[0] = 0.66 * sponge; rgb[1] = 0.56 * sponge; rgb[2] = 0.38 * sponge;
        }
      },
    };
  };
  const FACE_BOX = [-0.92, 1.76, 0.42, 0.92, 3.4, 1.75];
  const baseField = (cell) => {
    const s = skullField(cell);
    s.sub(fieldP((x, y, z) => -SKULL.cut(y, z)));
    return s;
  };
  const parts = [];
  for (const g of zoned(baseField, 0.082, [{ cell: 0.052, box: FACE_BOX }, { cell: 0.056, box: [0.86, 2.3, -0.5, 1.3, 3.1, 1.0] }, { cell: 0.056, box: [-1.3, 2.3, -0.5, -0.86, 3.1, 1.0] }], tintOf)) parts.push({ geometry: applyDiscUV(g), keepColor: true });

  // The cap, the same field from the other side of the same plane. Lifted, and tipped back so its open side faces
  // the student, the way a lid is held up to be looked under.
  const capField = (() => {
    const s = skullField(0.084);
    s.sub(fieldP((x, y, z) => SKULL.cut(y, z)));
    return s;
  })();
  const capGeo = applyDiscUV(polygonize(capField, {
    ...tintOf(capField),
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const reach = 0.16;
      const open = clamp01(fieldD(capField.ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
      const k = (0.9 + 0.16 * smoothNoise3(x * 2.4, y * 2.4, z * 2.4)) * mix(0.5, 1, open);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      if (cutFace(y, z) < 0.008 && ny < -0.6) {
        const sponge = 0.84 + 0.2 * smoothNoise3(x * 7, y * 7, z * 7);
        rgb[0] = 0.66 * sponge; rgb[1] = 0.56 * sponge; rgb[2] = 0.38 * sponge;
      }
    },
  }));
  const capM = new THREE.Matrix4().makeTranslation(0, 3.4 + 0.4, -0.2)
    .multiply(new THREE.Matrix4().makeRotationX(-0.14))
    .multiply(new THREE.Matrix4().makeTranslation(0, -3.4, 0.2));
  capGeo.applyMatrix4(capM);
  parts.push({ geometry: capGeo, keepColor: true });

  // --- The lower jaw --------------------------------------------------------------------------------
  const jaw = new Sculpt(0.058);
  const B = lin(0xc9b998);
  const lowerArch = archTable(0.5, 0.85, 1.41);
  // The body: wider than the teeth at the back, where it carries them on its inner side.
  const bodyPts = [
    [0.68, 0.0, 1.78, 0.06, 0.19], [0.62, 0.32, 1.67, 0.07, 0.21], [0.53, 0.68, 1.55, 0.08, 0.23], [0.38, 1.0, 1.47, 0.085, 0.25], [0.19, 1.25, 1.45, 0.085, 0.27], [0, 1.33, 1.45, 0.085, 0.29],
  ];
  const fullBody = [...bodyPts.map((p) => [-p[0], p[1], p[2], p[3], p[4]]), ...bodyPts.slice(0, -1).reverse()];
  jaw.add(ribbonP(fullBody, { round: 0.045 }), B);
  const lowSide = [];
  for (let i = 0; i <= 8; i++) lowSide.push(lowerArch.at((i / 8) * lowerArch.total));
  jaw.add(ribbonP([...lowSide.slice(1).reverse().map((p) => [-p.x, p.z, 1.58, 0.09, 0.1]), ...lowSide.map((p) => [p.x, p.z, 1.58, 0.09, 0.1])], { round: 0.02 }), B, { k: 0.1 });
  // The chin: a triangle on the front of the bone, not a ball.
  jaw.add(E([0, 1.26, 1.42], [0.2, 0.13, 0.08]), B, { k: 0.1 });
  for (const q of [1, -1]) {
    jaw.add(E([q * 0.16, 1.24, 1.38], [0.1, 0.08, 0.07]), B, { k: 0.08 });
    jaw.add(curveP([[q * 0.83, 2.2, 0.26], [q * 0.77, 1.8, 0.28], [q * 0.56, 1.6, 0.7], [q * 0.4, 1.34, 1.1]], [0.045, 0.05, 0.04, 0.02], 10), B, { k: 0.07 }); // the oblique line
    // The ramus, flat, with a notch between its two processes.
    const ramus = smoothOutline([
      [-0.19, 1.68], [-0.21, 1.98], [-0.18, 2.35], [-0.2, 2.62], [-0.06, 2.62], [-0.03, 2.46], [0.08, 2.34], [0.2, 2.42], [0.3, 2.66], [0.37, 2.6], [0.38, 2.3], [0.42, 1.98], [0.56, 1.7], [0.3, 1.56], [-0.04, 1.54],
    ], 3);
    jaw.add(plateP(ramus, q * 0.8, 0.04, 0.028, q * 0.09), B, { k: 0.12 });
    jaw.add(E([q * 0.73, 1.68, -0.06], [0.07, 0.14, 0.14]), B, { k: 0.12 }); // the corner of the jaw
    // The condyle, wide across and round front to back: it has to fill its socket.
    jaw.add(E([q * 0.88, 2.735, -0.12], [0.19, 0.1, 0.135]), lin(0xd6c8a8), { k: 0.05 });
    jaw.add(curveP([[q * 0.86, 2.34, -0.12], [q * 0.87, 2.72, -0.12]], [0.07, 0.06], 4), B, { k: 0.05 });
    jaw.sub(E([q * 0.5, 1.46, 1.11], [0.026, 0.024, 0.09], [0, q * 0.6, 0]), lin(0x241a10), { k: 0.012 }); // the mental foramen
    jaw.sub(curveP([[q * 0.76, 2.1, 0.12], [q * 0.74, 1.98, 0.3]], [0.03, 0.022], 3), lin(0x2c2014), { k: 0.012 }); // where the nerve goes in
  }
  const jawOps = jaw.ops;
  const jawGeo = applyDiscUV(polygonize(jaw, {
    uvScale: 1,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const reach = 0.14;
      const open = clamp01(fieldD(jawOps, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
      const k = (0.9 + 0.16 * smoothNoise3(x * 2.4, y * 2.4, z * 2.4)) * mix(0.5, 1, open);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k * 0.97;
    },
  }));
  const hinge = new THREE.Matrix4().makeTranslation(0, SKULL.JAW.y, SKULL.JAW.z)
    .multiply(new THREE.Matrix4().makeRotationX(SKULL.JAW.open))
    .multiply(new THREE.Matrix4().makeTranslation(0, -SKULL.JAW.y, -SKULL.JAW.z));
  jawGeo.applyMatrix4(hinge);
  parts.push({ geometry: jawGeo, keepColor: true });

  // --- The teeth, 16 and 16, counted --------------------------------------------------------------
  const tpl = { incisor: toothTemplate('incisor'), canine: toothTemplate('canine'), premolar: toothTemplate('premolar'), molar: toothTemplate('molar') };
  const NOMINAL = { incisor: 0.15, canine: 0.14, premolar: 0.15, molar: 0.19 };
  const teeth = [];
  let toothCount = 0;
  const seat = (st, upper, jitter) => {
    const k = st.wide / NOMINAL[st.kind];
    const T = new THREE.Vector3(st.tx, 0, st.tz);
    // Upper teeth look down, lower teeth up, and the crown always leans a touch outward.
    const Y = new THREE.Vector3(0, upper ? -1 : 1, 0);
    const X = upper ? T.clone().negate() : T.clone();
    const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    const out = new THREE.Vector3(-st.tz, 0, st.tx);
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    const lean = new THREE.Matrix4().makeRotationAxis(T, (upper ? -1 : 1) * (0.04 + jitter * 0.03));
    const scale = new THREE.Matrix4().makeScale(k, Math.min(1.25, 0.72 + k * 0.28), Math.max(0.82, k * 0.92));
    const neckY = upper ? 1.9 : 1.665;
    const pos = new THREE.Matrix4().makeTranslation(st.x + out.x * 0.012, neckY, st.z + out.z * 0.012);
    const g = tpl[st.kind].clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(pos, lean).multiply(m).multiply(scale));
    return g;
  };
  const upperArch = archTable(0.52, 0.85, 1.46);
  const rngT = seededRandom(9102);
  for (const [arch, widths, upper] of [[upperArch, UPPER_TEETH, true], [lowerArch, LOWER_TEETH, false]]) {
    for (const st of toothStations(arch, widths)) {
      const g = seat(st, upper, rngT());
      if (!upper) g.applyMatrix4(hinge);
      teeth.push({ geometry: g, keepColor: true });
      // Mirrored after the hinge, which is symmetrical about x = 0, so it lands in the same place.
      teeth.push({ geometry: mirrorX(g), keepColor: true });
      toothCount += 2;
    }
  }
  if (toothCount !== 32) throw new Error(`human-skull: ${toothCount} teeth, not 32`);

  // --- The stand and the rod ------------------------------------------------------------------------
  const WALNUT = 0x5a3a24; const BRASS = 0xb08d4e;
  const stand = [];
  stand.push({
    geometry: lathe([[0, 0], [1.34, 0], [1.34, 0.11], [1.28, 0.16], [1.22, 0.17], [0.78, 0.26], [0.42, 0.34], [0.22, 0.46], [0.15, 0.62], [0.13, 0.85], [0.17, 0.98], [0.12, 1.1], [0.1, 1.5], [0, 1.5]], 56),
    color: WALNUT,
  });
  // Brass from there up, to a cup that meets the condyles.
  stand.push({
    geometry: lathe([[0, 1.44], [0.125, 1.44], [0.15, 1.52], [0.105, 1.6], [0.095, 2.2], [0.14, 2.28], [0.2, 2.34], [0.2, 2.43], [0, 2.43]], 32),
    color: BRASS,
  });
  // The rod runs from the stem through the braincase to a pad on the inside of the cap, which is asked where it is.
  const capLocal = capField.snapshot();
  const invCap = capM.clone().invert();
  const ROD_Z = -0.42;
  let rodTop = 4.6;
  for (let y = 3.6; y < 5.4; y += 0.01) {
    const q = new THREE.Vector3(0, y, ROD_Z).applyMatrix4(invCap);
    if (capLocal.d(q.x, q.y, q.z) < 0) { rodTop = y; break; }
  }
  stand.push({ geometry: lathe([[0, 2.4], [0.035, 2.4], [0.035, rodTop - 0.06], [0.1, rodTop - 0.02], [0.12, rodTop + 0.03], [0, rodTop + 0.03]], 18), color: BRASS });
  stand.push({ geometry: lathe([[0, 2.4], [0.08, 2.4], [0.09, 2.62], [0.05, 2.72], [0, 2.72]], 18), color: BRASS });

  const shift = new THREE.Matrix4().makeTranslation(0, 0, SKULL.DZ);
  const root = new THREE.Group();
  root.name = 'human-skull';
  const boneMap = skullPainting();
  const boneMerged = mergeParts(parts); boneMerged.applyMatrix4(shift);
  root.add(mesh(boneMerged, standard({ vertexColors: true, map: boneMap, bumpMap: boneMap, bumpScale: 0.7, roughness: 0.74, metalness: 0 })));
  const teethMerged = mergeParts(teeth); teethMerged.applyMatrix4(shift);
  root.add(mesh(teethMerged, standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  root.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.42, metalness: 0.28 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Human spine
// ---------------------------------------------------------------------------------------------

// Two and a half times life, seen in profile from +X with the front of the body toward +Z. Every level is one of
// six sculpted templates, set onto one S-curve, so the curve is the only place the posture lives. The bodies carry
// the weight, so they grow going down; a disc is built between the two end plates it really lies between, tilted
// to match each, and there is deliberately none between the atlas and the axis, because a real spine has none.
const SPINE_COLORS = { cervical: 0xd8413a, thoracic: 0x2f9e5b, lumbar: 0x7b4fc8, sacrum: 0xe8841e, coccyx: 0x2c86d2 };

// Name, height, disc below it, body width and depth in real millimetres. Ordinary textbook ranges, smoothed.
function spineLevels() {
  const out = [];
  const lerp = (a, b, i, n) => mix(a, b, n <= 1 ? 0 : i / (n - 1));
  out.push({ name: 'C1', region: 'cervical', kind: 'C1', h: 11, disc: 0, W: 22, D: 18 });
  out.push({ name: 'C2', region: 'cervical', kind: 'C2', h: 18, disc: 5, W: 20, D: 18 });
  for (let i = 0; i < 5; i++) out.push({ name: `C${i + 3}`, region: 'cervical', kind: i === 4 ? 'C7' : 'C', h: lerp(12.5, 14, i, 5), disc: lerp(5, 5.5, i, 5), W: lerp(20, 26, i, 5), D: lerp(16, 18, i, 5) });
  for (let i = 0; i < 12; i++) out.push({ name: `T${i + 1}`, region: 'thoracic', kind: 'T', h: lerp(15.5, 24, i, 12), disc: lerp(4, 6.5, i, 12), W: lerp(27, 39, i, 12), D: lerp(20, 32, i, 12) });
  for (let i = 0; i < 5; i++) out.push({ name: `L${i + 1}`, region: 'lumbar', kind: 'L', h: lerp(26, 29, i, 5), disc: lerp(9, 12, i, 5), W: lerp(42, 53, i, 5), D: lerp(29, 34, i, 5) });
  return out;
}

// A vertebral body in a unit where its full width is 1 and its height 0.6: an oval drum, waisted, flat at both ends.
function bodyP(rx, rz, hy, waist, heart = 0) {
  return {
    box: [-rx, -hy, -rz, rx, hy, rz],
    f: (x, y, z) => {
      const t = clamp01(Math.abs(y) / hy);
      const k = 1 - waist * (1 - t * t);
      const rr = rx * (1 - heart * (z / rz));
      const q = Math.hypot(x / (rr * k), z / (rz * k));
      const d = (q - 1) * rz * k;
      const dy = Math.abs(y) - hy;
      const ox = Math.max(d, 0); const oy = Math.max(dy, 0);
      return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(d, dy), 0) - 0.02;
    },
  };
}

function vertebraTemplate(kind) {
  const B = lin(0xd2c29c);
  const CELL = { L: 0.1, T: 0.113, C: 0.12, C7: 0.12, C2: 0.115, C1: 0.11 };
  const s = new Sculpt(CELL[kind]);
  const c = (a, r, k = 0.08, n = 6) => s.add(curveP(a, r, n), B, { k });
  let tip = [0, 0, -1.5];
  if (kind === 'L') {
    s.add(bodyP(0.46, 0.32, 0.27, 0.09), B);
    s.add(plateP(smoothOutline([[-0.8, 0.16], [-1.46, 0.2], [-1.62, 0.06], [-1.58, -0.18], [-1.3, -0.26], [-0.8, -0.22]], 2), 0, 0.055, 0.04), B, { k: 0.1 });
    tip = [0, -0.04, -1.62];
    for (const q of [1, -1]) {
      c([[q * 0.31, 0.12, -0.22], [q * 0.33, 0.09, -0.58]], [0.11, 0.1]);
      c([[q * 0.32, 0.06, -0.6], [q * 0.21, -0.03, -0.86], [0, -0.06, -0.96]], [0.1, 0.095, 0.1]);
      c([[q * 0.3, 0.08, -0.44], [q * 0.72, 0.08, -0.5], [q * 1.0, 0.1, -0.56]], [0.09, 0.066, 0.056], 0.06);
      c([[q * 0.33, 0.14, -0.58], [q * 0.4, 0.54, -0.68]], [0.105, 0.08]);
      s.add(sphereP([q * 0.46, 0.46, -0.72], 0.075), B, { k: 0.05 });
      c([[q * 0.2, -0.1, -0.86], [q * 0.22, -0.5, -0.85]], [0.095, 0.07]);
    }
  } else if (kind === 'T') {
    s.add(bodyP(0.46, 0.38, 0.27, 0.07, 0.12), B);
    s.add(plateP(smoothOutline([[-0.88, 0.02], [-1.25, -0.35], [-1.6, -0.92], [-1.72, -1.04], [-1.6, -1.1], [-1.34, -0.84], [-1.0, -0.44], [-0.86, -0.2]], 2), 0, 0.05, 0.04), B, { k: 0.1 });
    tip = [0, -1.06, -1.68];
    for (const q of [1, -1]) {
      c([[q * 0.27, 0.16, -0.28], [q * 0.31, 0.14, -0.64]], [0.1, 0.095]);
      c([[q * 0.31, 0.06, -0.66], [q * 0.18, -0.04, -0.94], [0, -0.1, -1.02]], [0.1, 0.1, 0.1]);
      c([[q * 0.28, 0.12, -0.6], [q * 0.66, 0.2, -0.82], [q * 0.86, 0.24, -0.92]], [0.1, 0.085, 0.09], 0.06);
      s.add(sphereP([q * 0.88, 0.24, -0.9], 0.11), B, { k: 0.05 });
      c([[q * 0.28, 0.18, -0.62], [q * 0.3, 0.52, -0.62]], [0.09, 0.07]);
      c([[q * 0.16, -0.1, -0.92], [q * 0.18, -0.52, -0.9]], [0.09, 0.066]);
      s.sub(E([q * 0.5, 0.21, -0.2], [0.06, 0.09, 0.1]), lin(0xa89a78), { k: 0.03 }); // the rib's facet
    }
  } else if (kind === 'C' || kind === 'C7') {
    s.add(bodyP(0.46, 0.34, 0.27, 0.05), B);
    if (kind === 'C7') {
      c([[0, -0.08, -1.5], [0, -0.3, -2.3], [0, -0.44, -2.75]], [0.14, 0.11, 0.14]);
      s.add(sphereP([0, -0.46, -2.8], 0.16), B, { k: 0.08 });
      tip = [0, -0.46, -2.92];
    } else {
      c([[0, -0.06, -1.48], [0, -0.14, -1.78]], [0.14, 0.12]);
      for (const q of [1, -1]) c([[0, -0.14, -1.78], [q * 0.2, -0.24, -2.1]], [0.1, 0.08], 0.06, 3);
      tip = [0.2, -0.24, -2.14];
    }
    for (const q of [1, -1]) {
      c([[q * 0.42, 0.06, -0.3], [q * 0.66, 0.04, -0.74]], [0.14, 0.13]);
      c([[q * 0.68, 0.0, -0.86], [q * 0.4, -0.04, -1.34], [0, -0.06, -1.5]], [0.13, 0.12, 0.13]);
      // The transverse process, with the hole the vertebral artery runs through.
      s.add(E([q * 0.82, 0.02, -0.26], [0.32, 0.17, 0.26]), B, { k: 0.08 });
      s.add(sphereP([q * 1.1, 0.02, -0.08], 0.11), B, { k: 0.05 });
      s.add(sphereP([q * 1.1, 0.02, -0.44], 0.11), B, { k: 0.05 });
      s.add(E([q * 0.74, 0.0, -0.82], [0.2, 0.46, 0.22], [0.35, 0, 0]), B, { k: 0.08 }); // the articular pillar
      s.sub(segsP([[q * 0.78, -0.5, -0.26], [q * 0.78, 0.5, -0.26]], [0.13, 0.13]), lin(0x5a4630), { k: 0.03, ck: 0.03 });
      s.add(E([q * 0.46, 0.3, 0.0], [0.08, 0.09, 0.26]), B, { k: 0.05 }); // the lips on the top of a neck vertebra
    }
  } else if (kind === 'C2') {
    s.add(bodyP(0.5, 0.42, 0.3, 0.05), B);
    s.sub(E([0, 0, -1.02], [0.62, 0.8, 0.56]), null, { k: 0.05 });
    c([[0, 0.22, 0.1], [0, 0.55, 0.1], [0, 0.86, 0.08]], [0.26, 0.2, 0.13], 0.1); // the dens, the peg the atlas turns on
    c([[0, -0.08, -1.54], [0, -0.2, -1.95]], [0.2, 0.16]);
    for (const q of [1, -1]) {
      c([[0, -0.2, -1.95], [q * 0.28, -0.32, -2.3]], [0.14, 0.11], 0.06, 3);
      c([[q * 0.42, 0.06, -0.3], [q * 0.68, 0.04, -0.78]], [0.15, 0.14]);
      c([[q * 0.7, 0.0, -0.9], [q * 0.42, -0.08, -1.4], [0, -0.08, -1.54]], [0.14, 0.14, 0.16]);
      s.add(E([q * 0.56, 0.42, -0.1], [0.28, 0.14, 0.3]), B, { k: 0.08 }); // the shoulders the atlas sits on
      s.add(E([q * 0.92, 0.04, -0.26], [0.26, 0.15, 0.2]), B, { k: 0.08 });
      s.sub(segsP([[q * 0.86, -0.5, -0.26], [q * 0.86, 0.5, -0.26]], [0.11, 0.11]), lin(0x3a2c1c), { k: 0.03, ck: 0.04 });
    }
    tip = [0.28, -0.32, -2.34];
  } else {
    // The atlas: a ring with no body at all, and the dens stands where its body would be.
    const ring = [[0, 0.02, 0.52], [0.42, 0.02, 0.36], [0.78, 0, -0.26], [0.66, 0, -1.0], [0.28, 0, -1.48], [0, 0.0, -1.62]];
    s.add(curveP(ring, [0.15, 0.17, 0.2, 0.13, 0.11, 0.14], 14), B);
    s.add(curveP(ring.map(([x, y, z]) => [-x, y, z]), [0.15, 0.17, 0.2, 0.13, 0.11, 0.14], 14), B, { k: 0.05 });
    s.add(sphereP([0, 0.02, 0.6], 0.12), B, { k: 0.08 });
    s.add(sphereP([0, 0, -1.68], 0.13), B, { k: 0.08 });
    for (const q of [1, -1]) {
      s.add(E([q * 0.74, 0, -0.26], [0.3, 0.36, 0.42]), B, { k: 0.08 }); // the lateral mass
      s.add(E([q * 1.26, 0.02, -0.22], [0.3, 0.14, 0.17]), B, { k: 0.06 });
      s.sub(segsP([[q * 1.14, -0.5, -0.22], [q * 1.14, 0.5, -0.22]], [0.09, 0.09]), lin(0x3a2c1c), { k: 0.03, ck: 0.04 });
    }
    tip = [0, 0, -1.8];
  }
  const ops = s.ops;
  const g = polygonize(s, {
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const reach = 0.14;
      const open = clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
      const k = mix(0.5, 1, open);
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });
  // A body is a turned shape with a clean rim, which a grid can only saw, so everything but the atlas and the axis
  // gets an analytic drum. The sculpted body inside it is only there to fillet the pedicles against, and goes.
  let drumG = null;
  if (kind !== 'C1' && kind !== 'C2') {
    const depth = DRUM_DEPTH[kind]; const heart = kind === 'T' ? 0.12 : 0;
    const inside = (x, y, z) => Math.abs(y) < 0.31 && Math.hypot(x / 0.49, z / (depth * 0.97)) < 1;
    dropWhere(g, inside);
    drumG = drumGeometry(depth, kind === 'L' ? 0.09 : 0.07, heart);
  }
  return { g, tip, drumG };
}

const DRUM_DEPTH = { L: 0.36, T: 0.42, C: 0.38, C7: 0.38 };
const BAND_HALF = 0.065;

// A flatter back than front, where the body faces the canal.
const drumPoint = (a, rx, rz, heart = 0) => {
  const sa = Math.sin(a); const ca = Math.cos(a);
  const z = sa >= 0 ? sa * rz : sa * rz * (1 - 0.34 * ca * ca);
  return [ca * rx * (1 - heart * (z / rz)), z];
};

// Waisted, with the raised rim a real body has at each end plate, and rows where the painted band's edges fall so
// that the band can be crisp. Open at the ends: a disc always closes them.
function drumGeometry(rz, waist, heart) {
  const H = 0.3;
  const rows = [-H - 0.015, -H + 0.005, -H + 0.04, -0.17, -BAND_HALF - 0.004, -BAND_HALF + 0.004, BAND_HALF - 0.004, BAND_HALF + 0.004, 0.17, H - 0.04, H - 0.005, H + 0.015];
  const SIDES = 22;
  const positions = []; const index = [];
  for (const y of rows) {
    const t = clamp01(Math.abs(y) / H);
    const lip = 0.018 * sstep(t, 0.82, 0.95) * (1 - sstep(t, 1.0, 1.05));
    const k = 1 - waist * (1 - t * t) + lip;
    for (let j = 0; j < SIDES; j++) {
      const [x, z] = drumPoint((j / SIDES) * Math.PI * 2, 0.5 * k, rz * k, heart);
      positions.push(x, y, z);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < SIDES; j++) {
      const j2 = (j + 1) % SIDES;
      const p = r * SIDES + j; const q = r * SIDES + j2; const u = (r + 1) * SIDES + j2; const v = (r + 1) * SIDES + j;
      index.push(p, u, q, p, v, u);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function humanSpine() {
  const FT_PER_MM = 0.0082;
  const WIDEN = 1.22; // a little wider than true, since at this size a true neck vertebra is two inches across
  const P = [[-0.02, 1.5], [0.12, 1.72], [0.24, 2.02], [0.22, 2.36], [0.06, 2.72], [-0.14, 3.1], [-0.3, 3.55], [-0.32, 4.0], [-0.2, 4.45], [-0.02, 4.85], [0.14, 5.1], [0.26, 5.35], [0.27, 5.6], [0.19, 5.82]];
  const curve = new THREE.CatmullRomCurve3(P.map(([z, y]) => new THREE.Vector3(0, y, z)), false, 'catmullrom', 0.5);
  curve.arcLengthDivisions = 400;
  const arc = curve.getLength();
  const levels = spineLevels();
  // Exactly what the card and the brief promise, checked rather than trusted.
  const count = (r) => levels.filter((l) => l.region === r).length;
  if (count('cervical') !== 7 || count('thoracic') !== 12 || count('lumbar') !== 5) throw new Error('human-spine: wrong vertebra count');
  const rawTotal = levels.reduce((a, l) => a + l.h + l.disc, 0);
  const k = arc / rawTotal;
  let d = 0;
  // Stacked from the bottom: each level's own disc lies under it.
  for (let i = levels.length - 1; i >= 0; i--) {
    const l = levels[i];
    l.discFrom = d;
    d += l.disc * k;
    l.from = d;
    d += l.h * k;
    l.to = d;
    l.H = l.h * k;
    l.DH = l.disc * k;
    l.wFt = l.W * FT_PER_MM * WIDEN;
    l.dFt = l.D * FT_PER_MM * WIDEN;
  }
  const frameAt = (s) => {
    const u = clamp01(s / arc);
    const p = curve.getPointAt(u); const T = curve.getTangentAt(u);
    return { c: p, Y: T.clone(), Z: new THREE.Vector3(0, -T.z, T.y).normalize(), X: new THREE.Vector3(1, 0, 0) };
  };
  const frameOf = (l) => frameAt((l.from + l.to) / 2);
  // A point in a level's own template units.
  const onLevel = (l, x, y, z) => {
    const f = frameOf(l);
    return f.c.clone().addScaledVector(f.X, x * l.wFt).addScaledVector(f.Y, y * (l.H / 0.6)).addScaledVector(f.Z, z * l.wFt);
  };

  const parts = [];
  const templates = {};
  for (const kind of ['C1', 'C2', 'C', 'C7', 'T', 'L']) templates[kind] = vertebraTemplate(kind);
  const rng = seededRandom(9201);
  const i2 = (l) => levels.indexOf(l) * 3.7;
  for (const l of levels) {
    const f = frameOf(l);
    const band = lin(SPINE_COLORS[l.region]);
    const g = templates[l.kind].g.clone();
    // The band: a short strip of the region's colour painted across the front of the body.
    const tone = 0.94 + rng() * 0.1;
    const col = g.attributes.color;
    const pos = g.attributes.position;
    for (let i = 0; i < col.count; i++) {
      let r = col.getX(i) * tone; let gg = col.getY(i) * tone; let b = col.getZ(i) * tone;
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const onBody = l.kind === 'C1' ? (z > 0.42 && Math.abs(x) < 0.36) : l.kind === 'C2' ? (z > -0.3 && Math.abs(x) < 0.52) : false;
      const halfBand = 0.08;
      if (onBody && Math.abs(y) < halfBand) {
        const t = 1 - sstep(Math.abs(y), halfBand * 0.72, halfBand);
        r = mix(r, band[0], t); gg = mix(gg, band[1], t); b = mix(b, band[2], t);
      }
      col.setXYZ(i, r, gg, b);
    }
    const m = new THREE.Matrix4().makeBasis(f.X, f.Y, f.Z);
    m.scale(new THREE.Vector3(l.wFt, l.H / 0.6, l.wFt));
    m.setPosition(f.c);
    g.applyMatrix4(m);
    parts.push({ geometry: g, keepColor: true });
    const drum = templates[l.kind].drumG;
    if (drum) {
      const dg = drum.clone();
      const BONE = lin(0xd2c29c);
      tintVertices(dg, (x, y, z, out) => {
        // Darker just inside each rim, where a real body waists in, and in the back, away from the light.
        const t = clamp01(Math.abs(y) / 0.3);
        const shade = (0.8 + 0.2 * sstep(t, 0.5, 0.95)) * tone * (0.93 + 0.1 * smoothNoise3(x * 5 + i2(l), y * 7, z * 5));
        const on = Math.abs(y) < BAND_HALF ? 1 : 0;
        out[0] = mix(BONE[0] * shade, band[0], on); out[1] = mix(BONE[1] * shade, band[1], on); out[2] = mix(BONE[2] * shade, band[2], on);
      });
      dg.applyMatrix4(m);
      parts.push({ geometry: dg, keepColor: true });
    }
  }

  // --- The discs --------------------------------------------------------------------------------------
  const discs = [];
  const SIDES = 22;
  const WHITE = lin(0xdbe9f2); const BLUE = lin(0x9cc8e6); const DEEP = lin(0x6fa8d6);
  let discCount = 0;
  const ringPoint = (a, wide, deep) => drumPoint(a, wide, deep);
  for (let i = 1; i < levels.length; i++) {
    const up = levels[i - 1]; // the level above
    const low = levels[i]; // the one this disc sits on top of
    if (up.disc <= 0) continue;
    discCount += 1;
    const a = low.to - 0.012; const b = up.from + 0.012;
    const ROWS = 4;
    const positions = []; const colors = []; const index = [];
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const f = frameAt(mix(a, b, t));
      const wide = mix(low.wFt, up.wFt, t) * 0.5; const deep = mix(low.wFt * (DRUM_DEPTH[low.kind] ?? 0.38), up.wFt * (DRUM_DEPTH[up.kind] ?? 0.38), t);
      const bulge = 0.96 + 0.075 * Math.sin(Math.PI * t);
      for (let j = 0; j < SIDES; j++) {
        const [xx, zz] = ringPoint((j / SIDES) * Math.PI * 2, wide * bulge, deep * bulge);
        positions.push(f.c.x + xx, f.c.y + f.Z.y * zz, f.c.z + f.Z.z * zz);
        const lines = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2 + 1);
        const c = mix(0, 1, Math.sin(Math.PI * t));
        colors.push(mix(mix(DEEP[0], BLUE[0], c), WHITE[0], c * lines), mix(mix(DEEP[1], BLUE[1], c), WHITE[1], c * lines), mix(mix(DEEP[2], BLUE[2], c), WHITE[2], c * lines));
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let j = 0; j < SIDES; j++) {
        const j2 = (j + 1) % SIDES;
        const p = r * SIDES + j; const q = r * SIDES + j2; const u = (r + 1) * SIDES + j2; const v = (r + 1) * SIDES + j;
        index.push(p, u, q, p, v, u);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    discs.push({ geometry: g, keepColor: true });
  }
  // Including the one under L5, onto the sacrum.
  {
    const low = levels[levels.length - 1];
    const a = 0.012; const b = low.from + 0.012;
    const positions = []; const colors = []; const index = [];
    for (let r = 0; r <= 4; r++) {
      const t = r / 4;
      const f = frameAt(mix(a, b, t));
      const bulge = 0.96 + 0.075 * Math.sin(Math.PI * t);
      const c = Math.sin(Math.PI * t);
      for (let j = 0; j < SIDES; j++) {
        const [xx, zz] = ringPoint((j / SIDES) * Math.PI * 2, low.wFt * 0.5 * bulge, low.wFt * 0.36 * bulge);
        positions.push(f.c.x + xx, f.c.y + f.Z.y * zz, f.c.z + f.Z.z * zz);
        colors.push(mix(DEEP[0], WHITE[0], c), mix(DEEP[1], WHITE[1], c), mix(DEEP[2], WHITE[2], c));
      }
    }
    for (let r = 0; r < 4; r++) {
      for (let j = 0; j < SIDES; j++) {
        const j2 = (j + 1) % SIDES;
        const p = r * SIDES + j; const q = r * SIDES + j2; const u = (r + 1) * SIDES + j2; const v = (r + 1) * SIDES + j;
        index.push(p, u, q, p, v, u);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    discs.push({ geometry: g, keepColor: true });
    discCount += 1;
  }
  if (discCount !== 23) throw new Error(`human-spine: ${discCount} discs, not 23`);

  // --- The sacrum and the tailbone ----------------------------------------------------------------------
  const sacrum = new Sculpt(0.03);
  const SB = lin(0xcbb994);
  const sacPath = [[-0.03, 1.5, 0, 0.13, 0.3], [-0.17, 1.3, 0, 0.12, 0.33], [-0.28, 1.1, 0, 0.09, 0.27], [-0.34, 0.92, 0, 0.055, 0.17], [-0.33, 0.8, 0, 0.03, 0.09]];
  sacrum.add(ribbonP(sacPath, { plane: 'zy', round: 0.03 }), SB);
  const f0 = frameAt(0);
  sacrum.add(ellipsoidP([0, f0.c.y - 0.12, f0.c.z - 0.03], [levels[23].wFt * 0.5, 0.15, levels[23].wFt * 0.34]), SB, { k: 0.06 });
  // Its top is a real end plate for the last disc, cut square to the spine there.
  sacrum.sub(fieldP((x, y, z) => -((y - f0.c.y) * f0.Y.y + (z - f0.c.z) * f0.Y.z)), null, { k: 0.015 });
  // The wings, the broad part that meets the pelvis.
  for (const q of [1, -1]) sacrum.add(E([q * 0.25, 1.33, -0.2], [0.13, 0.2, 0.11]), SB, { k: 0.12 });
  // The fused bodies on the front, each line a real ridge; the foramina either side of them, where nerves leave.
  const sacAt = (t) => {
    const n = sacPath.length - 1; const f = clamp01(t) * n; const i = Math.min(n - 1, Math.floor(f)); const a = sacPath[i]; const b = sacPath[i + 1]; const u = f - i;
    const z = mix(a[0], b[0], u); const y = mix(a[1], b[1], u);
    const tz = b[0] - a[0]; const ty = b[1] - a[1]; const len = Math.hypot(tz, ty);
    return { z, y, half: mix(a[4], b[4], u), thick: mix(a[3], b[3], u), front: [Math.abs(ty) / len, tz / len] };
  };
  const SAC = [0.13, 0.34, 0.53, 0.72];
  const sacFor = [];
  for (const t of SAC) {
    const a = sacAt(t);
    const nz = a.front[0]; const ny = a.front[1];
    sacrum.add(segsP([[-a.half * 0.5, a.y + ny * (a.thick + 0.03), a.z + nz * (a.thick + 0.03)], [a.half * 0.5, a.y + ny * (a.thick + 0.03), a.z + nz * (a.thick + 0.03)]], [0.016, 0.016]), SB, { k: 0.04 });
    for (const q of [1, -1]) {
      const fx = q * a.half * 0.62;
      const at = (o) => [fx, a.y + 0.075 + ny * o, a.z + nz * o];
      sacrum.sub(segsP([at(a.thick + 0.2), at(-a.thick - 0.2)], [0.036, 0.036]), lin(0x332618), { k: 0.012, ck: 0.03 });
      sacFor.push({ q, t, front: at(a.thick + 0.03), y: a.y + 0.075, z: a.z, nz, ny });
    }
  }
  // The crest down the back.
  sacrum.add(curveP([[0, 1.42, -0.2], [0, 1.2, -0.37], [0, 1.0, -0.44], [0, 0.84, -0.4]], [0.03, 0.035, 0.03, 0.02], 8), SB, { k: 0.05 });
  // The tailbone: four small bones fused end to end, curving forward.
  const coc = [[-0.33, 0.77, 0.075], [-0.3, 0.68, 0.06], [-0.25, 0.61, 0.046], [-0.2, 0.56, 0.032]];
  for (const [z, y, r] of coc) sacrum.add(E([0, y, z], [r * 1.15, r * 0.92, r * 0.9]), lin(0xc2b08a), { k: 0.022 });
  const SA = lin(SPINE_COLORS.sacrum); const CO = lin(SPINE_COLORS.coccyx);
  const sacOps = sacrum.ops;
  parts.push({
    geometry: polygonize(sacrum, {
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const reach = 0.1;
        const open = clamp01(fieldD(sacOps, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
        const k = mix(0.5, 1, open) * (0.93 + 0.12 * smoothNoise3(x * 8, y * 8, z * 8));
        rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
        // The band of colour for each, as on the vertebrae: across the front of the sacrum and round the tailbone.
        const sb = (1 - sstep(Math.abs(y - 1.36), 0.035, 0.055)) * sstep(nz, 0.2, 0.5) * (1 - sstep(Math.abs(x), 0.2, 0.26));
        rgb[0] = mix(rgb[0], SA[0], sb); rgb[1] = mix(rgb[1], SA[1], sb); rgb[2] = mix(rgb[2], SA[2], sb);
        const cb = 1 - sstep(Math.abs(y - 0.655), 0.02, 0.04);
        rgb[0] = mix(rgb[0], CO[0], cb); rgb[1] = mix(rgb[1], CO[1], cb); rgb[2] = mix(rgb[2], CO[2], cb);
      },
    }),
    keepColor: true,
  });

  // --- The cord and the nerves ----------------------------------------------------------------------------
  const nerve = [];
  const canalZ = { C1: -0.72, C2: -0.98, C: -0.98, C7: -0.98, T: -0.66, L: -0.58 };
  const canalAt = (l) => onLevel(l, 0, 0, canalZ[l.kind]);
  const canalGap = (up, low) => canalAt(up).clone().add(canalAt(low)).multiplyScalar(0.5);
  const cordPts = [];
  // A short stub above the atlas, cut where the brain would begin, so its route in is plain.
  const top = canalAt(levels[0]);
  cordPts.push([top.x, top.y + 0.22, top.z + 0.03], [top.x, top.y + 0.1, top.z + 0.01]);
  const CONUS = levels.findIndex((l) => l.name === 'L1');
  for (let i = 0; i <= CONUS; i++) {
    const a = canalAt(levels[i]);
    cordPts.push([a.x, a.y, a.z]);
    if (i < CONUS) { const g = canalGap(levels[i], levels[i + 1]); cordPts.push([g.x, g.y, g.z]); }
  }
  const conusEnd = canalGap(levels[CONUS], levels[CONUS + 1]);
  cordPts.push([conusEnd.x, conusEnd.y, conusEnd.z]);
  const cordR = cordPts.map((p, i) => {
    const t = i / (cordPts.length - 1);
    // Thick where the arm and leg nerves join, tapering to the cone at L1-L2.
    return 0.036 + 0.012 * Math.exp(-(((t - 0.22) / 0.1) ** 2)) + 0.01 * Math.exp(-(((t - 0.88) / 0.05) ** 2)) - 0.03 * sstep(t, 0.93, 1);
  });
  const YEL = lin(0xf5c92e); const YELD = lin(0xd89f1a);
  const nerveTint = (g, dark = 0) => tintVertices(g, (x, y, z, out) => {
    const n = 0.9 + 0.2 * smoothNoise3(x * 14, y * 14, z * 14);
    out[0] = mix(YEL[0], YELD[0], dark) * n; out[1] = mix(YEL[1], YELD[1], dark) * n; out[2] = mix(YEL[2], YELD[2], dark) * n;
  });
  nerve.push({ geometry: nerveTint(tube(cordPts, cordR, { sides: 10, steps: Math.max(60, cordPts.length * 2), round: 2 })), keepColor: true });

  // Each nerve leaves through the gap below its own vertebra, except in the neck, where there is one more nerve than
  // there are vertebrae, so the first leaves above the atlas and the eighth below C7.
  let nerveCount = 0;
  const root = (from, viaCanal, foramen, out, r = 0.022, dark = 0) => {
    // A rounded blunt end where the root stops, and the swelling of its ganglion just outside the gap.
    const mid = [mix(foramen[0], out[0], 0.34), mix(foramen[1], out[1], 0.34), mix(foramen[2], out[2], 0.34)];
    const end = [mix(foramen[0], out[0], 0.7), mix(foramen[1], out[1], 0.7), mix(foramen[2], out[2], 0.7)];
    const pts = [from, ...viaCanal, foramen, mid, end, out];
    const n = pts.length;
    const radii = pts.map((_, i) => (i === n - 3 ? r * 1.5 : i === n - 4 ? r * 1.05 : r));
    const steps = Math.max(6, n + 2);
    nerve.push({ geometry: nerveTint(tube(pts, radii, { sides: 5, steps, round: 1 }), dark), keepColor: true });
    nerve.push({ geometry: mirrorX(nerve[nerve.length - 1].geometry), keepColor: true });
    nerveCount += 1;
  };
  const arr = (v) => [v.x, v.y, v.z];
  // The first cervical nerve, between skull and atlas.
  {
    const l = levels[0];
    const a = onLevel(l, 0.02, 0.9, canalZ.C1);
    const b = onLevel(l, 0.5, 0.75, -1.0);
    const c = onLevel(l, 1.3, 0.4, -1.0);
    root(arr(a), [], arr(b), arr(c), 0.013);
  }
  for (let i = 0; i < levels.length; i++) {
    const up = levels[i]; const low = levels[i + 1] ?? null;
    const lateral = up.kind === 'L' ? 0.52 : up.kind === 'T' ? 0.46 : 0.88;
    const zF = up.kind === 'L' ? -0.42 : up.kind === 'T' ? -0.44 : -0.62;
    const yBelow = -(0.3 + (up.DH / 2) / (up.H / 0.6));
    const span = up.kind === 'L' ? 0.86 : up.kind === 'T' ? 0.8 : 1.32;
    const foramen = onLevel(up, lateral, yBelow, zF);
    const out = onLevel(up, span, yBelow - 0.55, zF + 0.22);
    const r = up.kind === 'L' ? 0.02 : up.kind === 'T' ? 0.0135 : 0.016;
    if (i <= CONUS) {
      const inCanal = low ? canalGap(up, low) : canalAt(up);
      const from = onLevel(up, 0.015 / up.wFt, 0.1, canalZ[up.kind]);
      root(arr(from), i === 0 ? [] : [[0.04, inCanal.y + 0.02, inCanal.z]], arr(foramen), arr(out), r);
    } else {
      // Below the end of the cord the roots run down the canal as the horse's tail before each one leaves.
      const n = i - CONUS;
      const via = [];
      for (let j = CONUS + 1; j <= i; j++) { const c = canalAt(levels[j]); via.push([0.018 + 0.012 * n, c.y, c.z - 0.008 * n]); }
      root([0.012, conusEnd.y + 0.02, conusEnd.z], via, arr(foramen), arr(out), r);
    }
  }
  // Five sacral and one coccygeal, leaving through the foramina on the front and at the tip.
  const lastL = levels[levels.length - 1];
  const lastC = canalAt(lastL);
  const sacVia = (n) => [[0.02 + 0.012 * n, lastC.y, lastC.z - 0.01 * n], [0.03 + 0.012 * n, 1.42, -0.16 - 0.01 * n]];
  for (const [i, t] of SAC.entries()) {
    const fp = sacFor.find((a) => a.q === 1 && a.t === t);
    root([0.012, conusEnd.y + 0.02, conusEnd.z], [...sacVia(i + 6), [fp.front[0] * 0.5, fp.y + 0.02, fp.z]], fp.front, [fp.front[0] + 0.08, fp.y - 0.14, fp.front[2] + 0.13], 0.014 - i * 0.001);
  }
  root([0.012, conusEnd.y + 0.02, conusEnd.z], [...sacVia(10), [0.03, 1.0, -0.33]], [0.05, 0.82, -0.31], [0.1, 0.7, -0.26], 0.009);
  root([0.012, conusEnd.y + 0.02, conusEnd.z], [...sacVia(11), [0.025, 0.98, -0.33]], [0.04, 0.74, -0.31], [0.09, 0.62, -0.24], 0.008);
  if (nerveCount !== 31) throw new Error(`human-spine: ${nerveCount} pairs of nerves, not 31`);

  // --- The stand: walnut, with a rod behind that the spine hangs on, and a cup at each place it touches ----
  const BRASS = 0xb08d4e; const ROD_Z = -1.16;
  const stand = [];
  stand.push({ geometry: lathe([[0, 0], [1.42, 0], [1.42, 0.13], [1.36, 0.17], [1.3, 0.18], [1.2, 0.26], [0, 0.26]], 64), color: 0x5a3a24 });
  stand.push({ geometry: lathe([[0, 0.24], [0.1, 0.24], [0.1, 0.3], [0.06, 0.36], [0.036, 0.42], [0.036, 5.5], [0.024, 5.55], [0, 5.55]], 12), color: 0x34302c, position: [0, 0, ROD_Z] });
  const arm = (to, r = 0.02) => {
    const y0 = to[1] + 0.05;
    const from = [0, y0, ROD_Z];
    stand.push({ geometry: tube([from, [0, y0, (ROD_Z + to[2]) / 2], to], r, { sides: 8, steps: 6, round: 1 }), color: BRASS });
    stand.push({ geometry: new THREE.SphereGeometry(0.05, 10, 8).translate(0, y0, ROD_Z), color: BRASS });
    stand.push({ geometry: new THREE.SphereGeometry(r * 2, 10, 8).translate(to[0], to[1], to[2]), color: BRASS });
  };
  const tipOf = (name) => { const l = levels.find((a) => a.name === name); const t = templates[l.kind].tip; return onLevel(l, 0, t[1], t[2] + 0.02); };
  arm(arr(tipOf('C7')));
  arm(arr(tipOf('T7')));
  arm(arr(tipOf('L3')));
  arm([0, 1.05, -0.47]);
  // The sleeve for each region, a short block of its colour on the rod, level with what it names.
  const yOf = (name) => { const l = levels.find((a) => a.name === name); return onLevel(l, 0, 0, 0).y; };
  const sleeve = (y, color) => stand.push({
    geometry: lathe([[0, y - 0.13], [0.052, y - 0.13], [0.058, y - 0.12], [0.058, y + 0.12], [0.052, y + 0.13], [0, y + 0.13]], 14),
    color, position: [0, 0, ROD_Z],
  });
  sleeve(yOf('C4'), SPINE_COLORS.cervical);
  sleeve(yOf('T6'), SPINE_COLORS.thoracic);
  sleeve(yOf('L3') - 0.04, SPINE_COLORS.lumbar);
  sleeve(1.2, SPINE_COLORS.sacrum);
  sleeve(0.67, SPINE_COLORS.coccyx);

  const group = new THREE.Group();
  group.name = 'human-spine';
  group.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.66, metalness: 0 })));
  group.add(mesh(mergeParts(discs), standard({ vertexColors: true, roughness: 0.42, metalness: 0 })));
  group.add(mesh(mergeParts(nerve), standard({ vertexColors: true, roughness: 0.45, metalness: 0 })));
  group.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.42, metalness: 0.2 })));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Bacteriophage T4
// ---------------------------------------------------------------------------------------------

// Standing on a patch of its host. Real T4 dimensions at about 0.028ft to the nanometre: head 110 x 85nm, tail 100nm
// by 24nm, baseplate about 50nm, long fibres about 145nm, with 24 rings in the sheath. The head is an elongated
// icosahedron: two five-fold caps and two bands between them, a closed shell with one trapezoid of facets left out
// to show the coiled genome. The palette is a teaching model's, chosen for legibility; a virus has no colour.
function ringLobed(profile, sides, lobes, depth, phase, tintFn) {
  const positions = []; const index = [];
  for (const [r, y] of profile) {
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const k = r * (1 + depth * Math.cos(lobes * (a - phase)));
      positions.push(k * Math.sin(a), y, k * Math.cos(a));
    }
  }
  // Written bottom-up, with the angle running from +Z toward +X, and a grid that way round faces outward.
  for (let i = 0; i < profile.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j; const b = i * sides + j2; const c = (i + 1) * sides + j2; const d = (i + 1) * sides + j;
      index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  if (tintFn) tintVertices(g, tintFn);
  return g;
}

// A capsid is a lattice of hexamers, so each facet is printed with one, as a near-white tile in feet.
function capsidTile() {
  const texture = canvasTexture(256, 256, (ctx, W, H) => {
    ctx.fillStyle = '#e4eeee';
    ctx.fillRect(0, 0, W, H);
    const N = 4;
    const dx = W / N; const dy = H / (N * 2);
    const hex = (cx, cy, r) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; const x = cx + Math.cos(a) * r; const y = cy + Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath();
    };
    for (let j = -1; j <= N * 2 + 1; j++) {
      for (let i = -1; i <= N + 1; i++) {
        const cx = (i + (j % 2 ? 0.5 : 0)) * dx; const cy = j * dy;
        hex(cx, cy, dx * 0.5); ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(40,86,96,0.42)'; ctx.stroke();
        hex(cx, cy, dx * 0.2); ctx.fillStyle = 'rgba(70,120,130,0.4)'; ctx.fill();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// The outer face of a Gram-negative cell seen close up: a mass of little molecules, pale and busy.
function membraneMap() {
  const rng = seededRandom(9301);
  const texture = canvasTexture(512, 512, (ctx, W, H) => {
    ctx.fillStyle = '#f2ece2';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2400; i++) {
      const x = rng() * W; const y = rng() * H; const r = 2.4 + rng() * 5.2;
      const v = rng();
      ctx.fillStyle = v > 0.72 ? 'rgba(255,255,255,0.9)' : v > 0.34 ? 'rgba(206,194,186,0.55)' : 'rgba(176,164,176,0.42)';
      for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { ctx.beginPath(); ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2); ctx.fill(); }
    }
  });
  texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function bacteriophage() {
  const SURF = (x, z) => 0.86 - (x * x + z * z) / 22;
  const R = 1.2; const HC = 0.72; const HB = 0.86; const Y0 = 4.76;
  const deg = Math.PI / 180;
  const ring = (y, phase) => { const out = []; for (let k = 0; k < 5; k++) { const a = (k * 72 + phase) * deg; out.push([R * Math.sin(a), y, R * Math.cos(a)]); } return out; };
  const bottom = [0, Y0, 0];
  const A = ring(Y0 + HC, 36); const B = ring(Y0 + HC + HB, 0); const C = ring(Y0 + HC + 2 * HB, 36);
  const top = [0, Y0 + 2 * HC + 2 * HB, 0];
  const faces = [];
  for (let k = 0; k < 5; k++) {
    const n = (k + 1) % 5;
    faces.push([bottom, A[n], A[k]]); // bottom cap
    faces.push([A[k], A[n], B[n]]); // up-pointing in band 1 (B[n] sits between A[k] and A[n], since B leads by 36)
    faces.push([A[k], B[n], B[k]]); // down-pointing in band 1
    faces.push([B[k], B[n], C[k]]); // down-pointing in band 2 (C[k] sits between B[k] and B[n])
    faces.push([C[k], B[n], C[n]]); // up-pointing in band 2
    faces.push([top, C[k], C[n]]); // top cap
  }
  // Every face wound outward, measured, since it is a hand-written list.
  const centre = [0, Y0 + HC + HB, 0];
  const faceN = (f) => {
    const u = V3(f[1]).sub(V3(f[0])); const v = V3(f[2]).sub(V3(f[0]));
    return u.cross(v).normalize();
  };
  for (const f of faces) {
    const c = [(f[0][0] + f[1][0] + f[2][0]) / 3, (f[0][1] + f[1][1] + f[2][1]) / 3, (f[0][2] + f[1][2] + f[2][2]) / 3];
    if (faceN(f).dot(V3(c).sub(V3(centre))) < 0) { const t = f[1]; f[1] = f[2]; f[2] = t; }
  }
  if (faces.length !== 30) throw new Error(`bacteriophage: ${faces.length} facets, not 30`);
  // The window: the three facets of the upper band facing the student.
  const isWindow = (f) => {
    const cy = (f[0][1] + f[1][1] + f[2][1]) / 3; const cx = (f[0][0] + f[1][0] + f[2][0]) / 3; const cz = (f[0][2] + f[1][2] + f[2][2]) / 3;
    const a = Math.atan2(cx, cz);
    return cy > Y0 + HC + HB && cy < Y0 + HC + 2 * HB && Math.abs(a) < 47 * deg;
  };
  const rng = seededRandom(9302);
  // A flat-shaded triangle list, with UVs laid in feet in the facet's own plane so the tile never stretches.
  const pos = []; const nor = []; const col = []; const uvs = [];
  const INNER = 0.92;
  const shrink = (p) => [p[0] * INNER, centre[1] + (p[1] - centre[1]) * INNER, p[2] * INNER];
  const TEAL = lin(0x1ba6a8); const TEAL2 = lin(0x1590a8); const LINER = lin(0x0f2a3c); const RIM = lin(0x8fe9d9);
  const tri = (a, b, c, color, uv = null) => {
    const n = faceN([a, b, c]);
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) { nor.push(n.x, n.y, n.z); col.push(color[0], color[1], color[2]); }
    if (uv) uvs.push(...uv); else uvs.push(0, 0, 0, 0, 0, 0);
  };
  const facetUV = (f) => {
    const o = V3(f[0]); const e1 = V3(f[1]).sub(o).normalize(); const n = faceN(f); const e2 = new THREE.Vector3().crossVectors(n, e1);
    const T = 0.62;
    return f.flatMap((p) => { const d = V3(p).sub(o); return [d.dot(e1) / T, d.dot(e2) / T]; });
  };
  const edgeKey = (p, q) => { const a = p.join(); const b = q.join(); return a < b ? `${a}|${b}` : `${b}|${a}`; };
  const edges = new Map();
  const windowEdges = new Map();
  let kept = 0;
  for (const f of faces) {
    const open = isWindow(f);
    if (!open) {
      kept += 1;
      const t = 0.5 + 0.5 * Math.sin(rng() * 6.283);
      const c = [mix(TEAL[0], TEAL2[0], t), mix(TEAL[1], TEAL2[1], t), mix(TEAL[2], TEAL2[2], t)];
      tri(f[0], f[1], f[2], c, facetUV(f));
      // The inside of the shell, wound the other way.
      tri(shrink(f[0]), shrink(f[2]), shrink(f[1]), LINER);
    }
    for (let i = 0; i < 3; i++) {
      const p = f[i]; const q = f[(i + 1) % 3];
      const key = edgeKey(p, q);
      edges.set(key, [p, q]);
      if (open) windowEdges.set(key, (windowEdges.get(key) ?? 0) + 1);
    }
  }
  // The cut edge of the shell, real thickness all round the window, wound by asking which way is out of the wall.
  const windowRim = [...windowEdges.entries()].filter(([, n]) => n === 1).map(([k]) => edges.get(k));
  const winMid = V3(faces.filter(isWindow).flat().reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])).multiplyScalar(1 / 9);
  for (const [p, q] of windowRim) {
    const a = p; const b = q; const c = shrink(q); const e = shrink(p);
    const n = faceN([a, b, c]);
    const mid = V3(a).add(V3(c)).multiplyScalar(0.5);
    const inward = winMid.clone().sub(mid);
    if (n.dot(inward) > 0) { tri(a, b, c, RIM); tri(a, c, e, RIM); } else { tri(a, c, b, RIM); tri(a, e, c, RIM); }
  }
  const headG = new THREE.BufferGeometry();
  headG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  headG.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  headG.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  headG.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  const hard = [];
  // The welded seam along every edge of the polyhedron, and a boss at each vertex: what makes the facets read as flat.
  const SEAM = lin(0x7fe6d4);
  const seamRod = (p, q, r, color) => {
    const g = tube([p, q], r, { sides: 7, steps: 1, round: 0, straight: true });
    tintVertices(g, (x, y, z, o) => { o[0] = color[0]; o[1] = color[1]; o[2] = color[2]; });
    hard.push({ geometry: g, keepColor: true });
  };
  const windowKeys = new Set(windowRim.map(([p, q]) => edgeKey(p, q)));
  for (const [key, [p, q]] of edges) {
    if (windowEdges.get(key) === 2) continue; // an edge between two missing facets is not there at all
    seamRod(p, q, windowKeys.has(key) ? 0.034 : 0.024, SEAM);
  }
  for (const v of [bottom, top, ...A, ...B, ...C]) hard.push({ geometry: new THREE.SphereGeometry(0.05, 10, 8).translate(v[0], v[1], v[2]), color: 0xa2f0e0 });

  // --- The genome, wound in the head as tight layers ------------------------------------------------------
  const planes = faces.map((f) => { const n = faceN(f); return { n, d: n.dot(V3(shrink(f[0]))) }; });
  const rMax = (y, a) => {
    const dx = Math.sin(a); const dz = Math.cos(a);
    let best = 9;
    for (const { n, d } of planes) {
      const den = n.x * dx + n.z * dz;
      if (den < 1e-4) continue;
      best = Math.min(best, (d - n.y * y) / den);
    }
    return best;
  };
  const DNA_R = 0.05; const PITCH = 0.128;
  const dnaPts = [];
  const yLo = Y0 + 0.5; const yHi = top[1] - 0.5;
  const TURN = 26;
  let t = 0;
  // Each turn a true circle, as big as fits at that height: DNA packed in a head winds as a spool.
  const rCircle = (y) => { let m = 9; for (let i = 0; i < 20; i++) m = Math.min(m, rMax(y, (i / 20) * Math.PI * 2)); return m; };
  for (const [layer, dir] of [[0, 1], [1, -1], [2, 1]]) {
    const turns = (yHi - yLo) / PITCH;
    const total = Math.round(turns * TURN);
    for (let i = 0; i <= total; i++) {
      const y = dir > 0 ? mix(yLo, yHi, i / total) : mix(yHi, yLo, i / total);
      const a = t * (Math.PI * 2 / TURN);
      t += 1;
      const r = Math.max(0.12, rCircle(y) - 0.09 - layer * 0.13);
      dnaPts.push([r * Math.sin(a), y, r * Math.cos(a)]);
    }
  }
  const SIDES_DNA = 6;
  const dna = tube(dnaPts, DNA_R, { sides: SIDES_DNA, steps: dnaPts.length - 1, round: 0 });
  const CORAL = lin(0xf0563c); const CREAM = lin(0xffd166);
  tintVertices(dna, (x, y, z, o, i) => {
    const row = Math.floor(i / SIDES_DNA);
    const on = row % 7 < 5;
    const c = on ? CORAL : CREAM;
    const k = 0.92 + 0.12 * Math.sin(row * 0.31);
    o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k;
  });
  hard.push({ geometry: dna, keepColor: true });
  hard.push({ geometry: new THREE.SphereGeometry(1, 20, 14).scale(0.72, 1.05, 0.72).translate(0, centre[1], 0), color: 0x2a0f18 });

  // --- The collar, the neck the head sits in -------------------------------------------------------------
  const COLLAR = 0x256f8f;
  const SHEATH_TOP = 4.62;
  hard.push({
    geometry: lathe([[0, SHEATH_TOP - 0.06], [0.24, SHEATH_TOP - 0.06], [0.24, 4.68], [0.56, 4.74], [0.6, 4.79], [0.52, 4.84], [0.34, 4.9], [0.46, 5.0], [0.47, 5.06], [0.38, 5.1], [0, 5.1]], 40),
    color: COLLAR,
  });

  // --- The sheath: 24 real rings, each a little turned on the last ---------------------------------------
  const BASE_TOP = 1.84;
  const RINGS = 24;
  const ringH = (SHEATH_TOP - BASE_TOP) / RINGS;
  const G1 = lin(0xf0b92a); const G2 = lin(0xc68716); const GD = lin(0x5c3a08);
  for (let i = 0; i < RINGS; i++) {
    const y0 = BASE_TOP + i * ringH; const y1 = y0 + ringH;
    const c = i % 2 ? G2 : G1;
    const prof = [[0.27, y0], [0.325, y0 + ringH * 0.13], [0.35, y0 + ringH * 0.32], [0.35, y1 - ringH * 0.32], [0.325, y1 - ringH * 0.13], [0.27, y1]];
    const g = ringLobed(prof, 36, 6, 0.045, i * 17.2 * deg, (x, y, z, o) => {
      const r = Math.hypot(x, z);
      const e = sstep(r, 0.28, 0.32);
      o[0] = mix(GD[0], c[0], e); o[1] = mix(GD[1], c[1], e); o[2] = mix(GD[2], c[2], e);
    });
    hard.push({ geometry: g, keepColor: true });
  }
  hard.push({ geometry: lathe([[0, BASE_TOP - 0.05], [0.285, BASE_TOP - 0.05], [0.285, SHEATH_TOP + 0.02], [0, SHEATH_TOP + 0.02]], 24), color: 0x4c3006 });

  // --- The baseplate: a six-pointed hub ------------------------------------------------------------------
  const BP = lin(0x2a5fa0); const BP2 = lin(0x4e8fd0);
  const lobes = 6;
  const plate = ringLobed([[0.02, 1.52], [0.5, 1.52], [0.7, 1.56], [0.74, 1.62], [0.74, 1.74], [0.62, 1.82], [0.34, 1.87], [0.02, 1.89]], 72, lobes, 0.2, 30 * deg, (x, y, z, o) => {
    const e = sstep(y, 1.6, 1.8);
    o[0] = mix(BP[0], BP2[0], e); o[1] = mix(BP[1], BP2[1], e); o[2] = mix(BP[2], BP2[2], e);
  });
  hard.push({ geometry: plate, keepColor: true });
  // The caps of that hub, and the tail's needle below it, which is what will go through the wall.
  hard.push({ geometry: lathe([[0, 1.1], [0.02, 1.12], [0.05, 1.3], [0.09, 1.5], [0.1, 1.56], [0, 1.56]], 16), color: 0xc58a18 });
  // Six short pins under it, which are the short tail fibres folded against the plate.
  const MAG = lin(0xdb2a92); const MAG2 = lin(0xf05cb4);
  for (let k = 0; k < 6; k++) {
    const a = (k * 60) * deg;
    const g = tube([[Math.sin(a) * 0.32, 1.54, Math.cos(a) * 0.32], [Math.sin(a) * 0.5, 1.42, Math.cos(a) * 0.5], [Math.sin(a) * 0.62, 1.47, Math.cos(a) * 0.62]], [0.04, 0.03, 0.02], { sides: 7, steps: 8, round: 1 });
    hard.push({ geometry: g, color: 0x1f4a7c });
  }

  // --- The six long fibres, each a thigh and a shin with a knee between ----------------------------------
  const fibreTint = (color) => (x, y, z, o) => {
    const k = 0.92 + 0.14 * Math.sin((x + z) * 40 + y * 30);
    o[0] = color[0] * k; o[1] = color[1] * k; o[2] = color[2] * k;
  };
  const beaded = (n, r0, r1) => { const out = []; for (let i = 0; i <= n; i++) { const t2 = i / n; out.push(mix(r0, r1, t2) * (1 + 0.14 * Math.sin(t2 * n * 1.4))); } return out; };
  let fibres = 0;
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 + 30) * deg;
    const sa = Math.sin(a); const ca = Math.cos(a);
    const at = (r, y, off = 0) => [sa * r + ca * off, y, ca * r - sa * off];
    const hip = at(0.82, 1.7);
    const knee = at(2.34, 2.72, 0.05);
    const footR = 3.12;
    const foot = at(footR, SURF(sa * footR, ca * footR) + 0.04, 0.02);
    const thigh = [hip, at(1.2, 2.06, 0.03), at(1.8, 2.5, 0.05), knee];
    hard.push({ geometry: tintVertices(tube(thigh, beaded(14, 0.072, 0.066), { sides: 9, steps: 28, round: 1 }), fibreTint(MAG)), keepColor: true });
    // The kink: a real knuckle, then the shin leaving at a sharp angle with a second smaller kink on the way down.
    const shin = [knee, at(2.72, 2.1, 0.07), at(2.86, 1.42, 0.03), at(3.06, 0.86, 0.02), foot];
    hard.push({ geometry: tintVertices(tube(shin, beaded(14, 0.058, 0.044), { sides: 9, steps: 30, round: 1 }), fibreTint(MAG2)), keepColor: true });
    hard.push({ geometry: new THREE.SphereGeometry(0.1, 14, 10).scale(1, 1, 1).translate(knee[0], knee[1], knee[2]), color: 0xb5167a });
    hard.push({ geometry: new THREE.SphereGeometry(0.12, 14, 10).translate(hip[0], hip[1], hip[2]), color: 0xb5167a });
    const fp = new THREE.SphereGeometry(0.09, 12, 9).scale(1, 0.7, 1).translate(foot[0], foot[1] - 0.02, foot[2]);
    hard.push({ geometry: fp, color: 0xf9c04a }); // the tip, gripping a receptor on the surface
    fibres += 1;
  }
  if (fibres !== 6) throw new Error('bacteriophage: six long fibres');

  // --- The patch of cell surface ---------------------------------------------------------------------------
  const RIMR = 3.75;
  const bump = (x, z) => 0.03 * smoothNoise3(x * 1.6 + 9, 0.4, z * 1.6) + 0.012 * smoothNoise3(x * 5, 2.1, z * 5);
  const ROWS = 30; const SEG = 80;
  const sp = []; const su = []; const sc = []; const si = [];
  const PALE = lin(0xeadcc6); const PALE2 = lin(0xd9d0e0);
  const rowR = [];
  for (let i = 0; i <= ROWS; i++) rowR.push((i / ROWS) * RIMR);
  const rim = SURF(RIMR, 0);
  const pushRing = (r, yFn, colFn, onWall = false) => {
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const x = r * Math.sin(a); const z = r * Math.cos(a);
      const y = yFn(x, z);
      sp.push(x, y, z);
      if (onWall) su.push(0.96, 0.96); else su.push(x / 1.7, z / 1.7);
      const c = colFn(x, y, z);
      sc.push(c[0], c[1], c[2]);
    }
  };
  const topCol = (x, y, z) => {
    const t = clamp01(0.5 + 1.6 * (smoothNoise3(x * 0.8, 5, z * 0.8) - 0.5));
    return [mix(PALE[0], PALE2[0], t), mix(PALE[1], PALE2[1], t), mix(PALE[2], PALE2[2], t)];
  };
  for (const r of rowR) {
    pushRing(Math.max(r, 0.001), (x, z) => SURF(x, z) + bump(x, z) * sstep(RIMR - Math.hypot(x, z), 0, 0.25), topCol);
  }
  // The cut edge shows the layers of the wall, so the rim is a teaching section too.
  const wallYs = [rim - 0.002, rim * 0.72, rim * 0.5, rim * 0.28, 0];
  wallYs.forEach((yy, n) => {
    const c = n === 0 ? PALE : n === 1 ? lin(0xc66f7a) : n === 2 ? lin(0xe8cf7a) : n === 3 ? lin(0xc66f7a) : lin(0x8c6aa8);
    pushRing(RIMR, () => yy, () => c, true);
  });
  pushRing(0.001, () => 0, () => lin(0x8c6aa8), true);
  const rows = ROWS + 1 + wallYs.length + 1;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const j2 = (j + 1) % SEG;
      const a = i * SEG + j; const b = i * SEG + j2; const c = (i + 1) * SEG + j2; const d = (i + 1) * SEG + j;
      si.push(a, c, b, a, d, c);
    }
  }
  const patch = new THREE.BufferGeometry();
  patch.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  patch.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  patch.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  patch.setIndex(si);
  patch.computeVertexNormals();

  const root = new THREE.Group();
  root.name = 'bacteriophage';
  const tile = capsidTile();
  root.add(mesh(headG, standard({ vertexColors: true, map: tile, bumpMap: tile, bumpScale: 0.4, roughness: 0.42, metalness: 0, flatShading: true })));
  root.add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.4, metalness: 0 })));
  const skin = membraneMap();
  root.add(mesh(patch, standard({ vertexColors: true, map: skin, bumpMap: skin, bumpScale: 0.9, roughness: 0.82, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Coats: shared by the two animals
// ---------------------------------------------------------------------------------------------

function hermiteTable(xs, ys, size = 256) {
  const n = xs.length;
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
    m[i] = (ys[b] - ys[a]) / (xs[b] - xs[a]);
  }
  const x0 = xs[0]; const x1 = xs[n - 1];
  const table = new Float64Array(size + 1);
  let k = 0;
  for (let i = 0; i <= size; i++) {
    const x = mix(x0, x1, i / size);
    while (k < n - 2 && x > xs[k + 1]) k += 1;
    const h = xs[k + 1] - xs[k];
    const t = clamp01((x - xs[k]) / h);
    const t2 = t * t; const t3 = t2 * t;
    table[i] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  }
  return (x) => {
    const f = clamp01((x - x0) / (x1 - x0)) * size;
    const i = Math.min(size - 1, Math.floor(f));
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
}

// One smooth body with its section splined along z: [z, centreY, halfWidth, above, below].
function axisLoft(stations) {
  const along = stations.map((q) => q[0]);
  const c = hermiteTable(along, stations.map((q) => q[1]));
  const w = hermiteTable(along, stations.map((q) => q[2]));
  const up = hermiteTable(along, stations.map((q) => q[3]));
  const dn = hermiteTable(along, stations.map((q) => q[4]));
  const a0 = along[0]; const a1 = along[along.length - 1];
  const wide = Math.max(...stations.map((q) => q[2]));
  const lo = Math.min(...stations.map((q) => q[1] - q[4]));
  const hi = Math.max(...stations.map((q) => q[1] + q[3]));
  return {
    box: [-wide, lo, a0, wide, hi, a1],
    centre: c, width: w, above: up, below: dn,
    f: (x, y, z) => {
      const t = z < a0 ? a0 : z > a1 ? a1 : z;
      const db = y - c(t);
      const rw = Math.max(1e-3, w(t));
      const rb = Math.max(1e-3, db > 0 ? up(t) : dn(t));
      const q = Math.hypot(x / rw, db / rb);
      const d = (q - 1) * Math.min(rw, rb);
      const over = z < a0 ? a0 - z : z > a1 ? z - a1 : 0;
      return over > 0 ? Math.hypot(Math.max(d, 0), over) : d;
    },
  };
}

function squash(prim, [sx, sy, sz], about = [0, 0, 0]) {
  const m = Math.min(sx, sy, sz);
  const [ax, ay, az] = about;
  const b = prim.box;
  const X = (v) => ax + (v - ax) * sx; const Y = (v) => ay + (v - ay) * sy; const Z = (v) => az + (v - az) * sz;
  return {
    box: [X(b[0]), Y(b[1]), Z(b[2]), X(b[3]), Y(b[4]), Z(b[5])],
    f: (x, y, z) => prim.f(ax + (x - ax) / sx, ay + (y - ay) / sy, az + (z - az) / sz) * m,
  };
}

// A ring standing on a surface, as a field: an eyelid.
function torusOn(c, axis, R, r) {
  const a = V3(axis).normalize();
  const reach = R + r;
  return {
    box: [c[0] - reach, c[1] - reach, c[2] - reach, c[0] + reach, c[1] + reach, c[2] + reach],
    f: (x, y, z) => {
      const px = x - c[0]; const py = y - c[1]; const pz = z - c[2];
      const h = px * a.x + py * a.y + pz * a.z;
      const rx = px - a.x * h; const ry = py - a.y * h; const rz = pz - a.z * h;
      const l = Math.sqrt(rx * rx + ry * ry + rz * rz) - R;
      return Math.sqrt(l * l + h * h) - r;
    },
  };
}

// One overlapping lock of hair: a closed, arched, pointed solid whose thickness goes to nothing at its edge.
function lockGeo(root, dir, normal, L, W, { nv = 3, lift = 0.22, droop = 0.1, th = 0.03 } = {}) {
  const side = new THREE.Vector3().crossVectors(normal, dir).normalize();
  return solidSurface({
    nu: 2, nv,
    point: (u, v) => {
      const U = u * 2 - 1;
      const w = (W / 2) * Math.max(0.03, (0.62 + 0.38 * sstep(v, 0, 0.36)) * (1 - v ** 2.3));
      const arch = (1 - U * U) * w * 0.34;
      const a = L * v;
      const n = L * (lift * v - lift * 0.72 * v * v) + arch;
      const q = U * w;
      return [
        root[0] + dir.x * a + normal.x * n + side.x * q,
        root[1] + dir.y * a + normal.y * n + side.y * q - droop * L * v * v,
        root[2] + dir.z * a + normal.z * n + side.z * q,
      ];
    },
    thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * clamp01(v)),
  });
}

// Long hairs running with v, near white so a lock's own colour carries the hue.
function strandMap(seed, size = 256, lines = 260) {
  return canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i++) {
      const x = rng() * w;
      const light = rng() > 0.55;
      ctx.strokeStyle = light ? `rgba(255,255,255,${0.35 + rng() * 0.5})` : `rgba(150,150,150,${0.35 + rng() * 0.55})`;
      ctx.lineWidth = 0.8 + rng() * 2;
      const bow = (rng() - 0.5) * 14;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x + bow, h / 2, x, h);
      ctx.stroke();
    }
  });
}

// Short hair over a whole body: fine streaks that tile, read on the skew UVs a sculpt lays down, so the coat has
// a nap wherever the light rakes it, with no colour of its own.
function napMap(seed, { size = 512, lines = 2600, wrapBoth = true } = {}) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#eeeeee';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (let i = 0; i < lines; i++) {
      const x = rng() * w; const y = rng() * h; const L = 7 + rng() * 15;
      const a = Math.PI * 0.5 + (rng() - 0.5) * 0.7;
      const v = rng() > 0.5 ? 255 : 150;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.22 + rng() * 0.45})`;
      ctx.lineWidth = 0.7 + rng() * 1.2;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.lineTo(x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L);
          ctx.stroke();
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = wrapBoth ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return texture;
}

// Cuts a mesh along the zero line of a field, so a painted edge is exactly as sharp as a triangle's edge however
// coarse the mesh under it is. A tint interpolates across a triangle, and that is why a coat drawn with one comes
// out soft. So any triangle the line may cross is divided and then clipped along it, and the vertices on the cut are
// doubled, with a different colour either side. `side(x, y, z)` is negative on one side of the line and `group` says
// which patch a point lies in, since a line thinner than a triangle can pass between its three corners unnoticed.
// `paint(x, y, z, nx, ny, nz, c0, c1, c2, positive, out)` colours a corner, given the mesh's own colour there.
function crispSplit(geometry, { side, group, paint, depth = 1 }) {
  const P = geometry.attributes.position; const N = geometry.attributes.normal; const U = geometry.attributes.uv; const C = geometry.attributes.color;
  const idx = geometry.index;
  const V = []; // x y z, nx ny nz, u v, c0 c1 c2, s
  const out = { pos: [], nor: [], uv: [], col: [] };
  const rgb = [0, 0, 0];
  const emit = (v, positive) => {
    let nx = v[3]; let ny = v[4]; let nz = v[5];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    paint(v[0], v[1], v[2], nx, ny, nz, v[8], v[9], v[10], positive, rgb);
    out.pos.push(v[0], v[1], v[2]); out.nor.push(nx, ny, nz); out.uv.push(v[6], v[7]); out.col.push(rgb[0], rgb[1], rgb[2]);
  };
  const lerpV = (a, b, t) => {
    const o = new Array(12);
    for (let i = 0; i < 11; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    return o;
  };
  const score = (v) => { v[11] = side(v[0], v[1], v[2]); return v; };
  const clip = (a, b, c) => {
    const sa = a[11] >= 0; const sb = b[11] >= 0; const sc = c[11] >= 0;
    if (sa === sb && sb === sc) { emit(a, sa); emit(b, sa); emit(c, sa); return; }
    // Rotate so that `a` is the corner alone on its side.
    let p = a; let q = b; let r = c;
    if (sa === sb) { p = c; q = a; r = b; } else if (sa === sc) { p = b; q = c; r = a; }
    const cut = (x, y) => {
      // The field is not linear across an edge, so the crossing is walked in by a couple of false-position steps.
      let lo = x; let hi = y;
      let v = null;
      for (let i = 0; i < 3; i++) {
        const t = clamp01(lo[11] / (lo[11] - hi[11]));
        v = score(lerpV(lo, hi, t));
        if ((v[11] >= 0) === (lo[11] >= 0)) lo = v; else hi = v;
      }
      return v;
    };
    const pq = cut(p, q); const pr = cut(p, r);
    const pos = p[11] >= 0;
    emit(p, pos); emit(pq, pos); emit(pr, pos);
    emit(q, !pos); emit(r, !pos); emit(pr, !pos);
    emit(q, !pos); emit(pr, !pos); emit(pq, !pos);
  };
  const walk = (a, b, c, d) => {
    if (d > 0) {
      const sa = a[11] >= 0;
      const mixed = sa !== (b[11] >= 0) || sa !== (c[11] >= 0);
      const ga = group(a[0], a[1], a[2]);
      // Clipping handles a line it can see. Only a line that has slipped between all three corners needs a division.
      if (!mixed && (ga !== group(b[0], b[1], b[2]) || ga !== group(c[0], c[1], c[2]))) {
        const ab = score(lerpV(a, b, 0.5)); const bc = score(lerpV(b, c, 0.5)); const ca = score(lerpV(c, a, 0.5));
        walk(a, ab, ca, d - 1); walk(ab, b, bc, d - 1); walk(ca, bc, c, d - 1); walk(ab, bc, ca, d - 1);
        return;
      }
    }
    clip(a, b, c);
  };
  for (let i = 0; i < P.count; i++) V.push(score([P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), U.getX(i), U.getY(i), C.getX(i), C.getY(i), C.getZ(i), 0]));
  for (let t = 0; t < idx.count; t += 3) walk(V[idx.getX(t)], V[idx.getX(t + 1)], V[idx.getX(t + 2)], depth);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  return g;
}

function shuffled(n, rng) {
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  return order;
}

// ---------------------------------------------------------------------------------------------
// Giraffe
// ---------------------------------------------------------------------------------------------

// True size, with the catalogue's 0.6 applied by the record. Its coat is the identification, and a coat this
// regular cannot be a texture: a neck is a long thin thing and a leg a longer, thinner one, and any projection
// that keeps a patch square on the flank drags it into a streak there. So the patches are a Voronoi diagram of seed
// points scattered ON the animal, closer together on the neck and legs and closer again on the face, evaluated in 3D
// at every vertex. The edge of each patch is what `snap` slides the mesh onto, so it comes out a clean line.
function giraffeField(cell) {
  const s = new Sculpt(cell);
  const C = [1, 1, 1]; // the coat, a sentinel the tint replaces
  const torso = axisLoft([
    [-4.35, 8.95, 0.5, 0.42, 0.5],
    [-3.95, 8.95, 1.02, 0.78, 0.98],
    [-3.0, 8.9, 1.24, 0.92, 1.1],
    [-1.6, 8.95, 1.36, 1.12, 1.42],
    [0, 9.1, 1.46, 1.38, 1.82],
    [1.5, 9.35, 1.36, 1.88, 2.14],
    [2.6, 9.4, 1.1, 2.04, 2.22],
    [3.45, 9.6, 0.78, 1.5, 1.8],
    [3.95, 9.85, 0.42, 0.78, 0.98],
  ]);
  s.add(torso, C);
  s.add(E([0, 11.22, 2.1], [0.4, 0.5, 1.1]), C, { k: 0.5 }); // the withers
  // The neck: one sweep, deep from front to back and narrow across.
  const neck = squash(curveP([[0, 10.2, 2.95], [0, 11.6, 3.7], [0, 13.2, 4.62], [0, 14.9, 5.58], [0, 16.3, 6.38], [0, 17.05, 6.92]], [1.24, 0.98, 0.76, 0.6, 0.47, 0.42], 26), [0.62, 1, 1]);
  s.add(neck, C, { k: 0.5 });
  s.add(curveP([[0, 11.5, 2.6], [0, 13.6, 3.85], [0, 15.6, 5.15], [0, 17.1, 6.4]], [0.14, 0.13, 0.12, 0.1], 14), C, { k: 0.26 }); // the ridge the mane grows from
  // Shoulders and the great slope of the hip, which show through the skin.
  for (const q of [1, -1]) {
    s.add(E([q * 0.95, 10.15, 2.2], [0.3, 1.25, 0.82], [0.32, 0, q * -0.07]), C, { k: 0.6 });
    s.add(E([q * 0.95, 9.1, -3.0], [0.42, 0.72, 0.95], [0, 0, q * 0.06]), C, { k: 0.6 });
    // The front leg. A giraffe's is nearly straight, with a knob of a knee in the middle of it.
    const fz = q > 0 ? 3.14 : 2.72;
    s.add(curveP([[q * 0.98, 9.0, 2.7], [q * 0.98, 7.5, 2.86], [q * 0.92, 6.0, 2.92], [q * 0.86, 4.5, fz - 0.02]], [0.84, 0.58, 0.42, 0.29], 18), C, { k: 0.5 });
    s.add(E([q * 0.86, 3.98, fz + 0.04], [0.235, 0.34, 0.27]), C, { k: 0.26 }); // the knee
    s.add(curveP([[q * 0.86, 3.75, fz], [q * 0.84, 2.6, fz + 0.02], [q * 0.84, 1.15, fz + 0.04]], [0.215, 0.16, 0.17], 12), C, { k: 0.2 });
    s.add(E([q * 0.84, 1.02, fz + 0.03], [0.2, 0.2, 0.23]), C, { k: 0.08 }); // the fetlock
    s.add(curveP([[q * 0.84, 1.0, fz + 0.04], [q * 0.84, 0.5, fz + 0.2]], [0.16, 0.2], 4), C, { k: 0.06 });
    // The hind leg: heavy thigh, angled shank, and the sharp point of the hock behind.
    const hz = q > 0 ? -3.9 : -3.5;
    s.add(curveP([[q * 0.95, 9.0, -3.1], [q * 1.04, 7.3, -2.72], [q * 0.94, 6.1, -3.3], [q * 0.84, 5.05, hz + 0.02]], [0.92, 0.76, 0.42, 0.26], 18), C, { k: 0.5 });
    s.add(E([q * 0.84, 4.86, hz - 0.06], [0.2, 0.34, 0.3], [0.3, 0, 0]), C, { k: 0.1 }); // the hock
    s.add(sphereP([q * 0.84, 5.12, hz - 0.26], 0.12), C, { k: 0.12 });
    s.add(curveP([[q * 0.84, 4.65, hz + 0.02], [q * 0.83, 2.9, hz + 0.22], [q * 0.83, 1.15, hz + 0.32]], [0.21, 0.15, 0.165], 12), C, { k: 0.16 });
    s.add(E([q * 0.83, 1.02, hz + 0.32], [0.2, 0.2, 0.23]), C, { k: 0.08 });
    s.add(curveP([[q * 0.83, 1.0, hz + 0.33], [q * 0.83, 0.5, hz + 0.47]], [0.16, 0.2], 4), C, { k: 0.06 });
    // The hooves, cloven, each toe its own wedge sunk into the pastern.
    const HOOF = lin(0x2a241e);
    for (const [hx, hzz] of [[q * 0.84, fz + 0.26], [q * 0.83, hz + 0.53]]) {
      for (const t of [1, -1]) {
        s.add(boxP([hx + t * 0.1, 0.17, hzz + 0.05], [0.055, 0.1, 0.17], [0.32, 0, 0], 0.07), HOOF, { k: 0.015, ck: 0.015 });
      }
    }
  }
  // --- The head -----------------------------------------------------------------------------------
  // About 2.4ft long, deep at the jaw and narrowing to a long upper lip, carried nearly level.
  s.add(curveP([[0, 17.26, 7.0], [0, 17.2, 7.7], [0, 16.98, 8.4], [0, 16.7, 9.02]], [0.47, 0.46, 0.33, 0.25], 14), C, { k: 0.3 });
  s.add(E([0, 16.84, 7.52], [0.37, 0.46, 0.6]), C, { k: 0.25 }); // the deep cheek and jaw
  s.add(E([0, 17.42, 7.88], [0.15, 0.15, 0.36], [-0.2, 0, 0]), C, { k: 0.14 }); // the bump on the forehead, a third, lower horn
  s.add(E([0, 16.56, 9.2], [0.235, 0.2, 0.27]), C, { k: 0.16 }); // the muzzle
  s.add(E([0, 16.34, 8.96], [0.17, 0.1, 0.36]), C, { k: 0.1 }); // the lower jaw
  s.add(E([0, 16.3, 9.24], [0.12, 0.075, 0.15]), C, { k: 0.05 }); // the chin
  s.add(E([0, 16.54, 8.55], [0.19, 0.22, 0.66]), C, { k: 0.1 }); // the solid between the jaws
  s.add(curveP([[0, 16.56, 7.8], [0, 16.4, 8.4], [0, 16.3, 9.1]], [0.17, 0.13, 0.1], 8), C, { k: 0.12 }); // the line of the jaw beneath, closing the mouth
  const OSS = lin(0x8a5a2e);
  for (const q of [1, -1]) {
    s.add(E([q * 0.36, 17.4, 7.84], [0.16, 0.11, 0.28]), C, { k: 0.1 }); // the brow
    s.add(E([q * 0.22, 16.9, 7.66], [0.2, 0.28, 0.36]), C, { k: 0.12 });
    // The ossicones grow out of the skull, as a smooth run of the same skin, not stuck on.
    s.add(curveP([[q * 0.2, 17.38, 7.26], [q * 0.27, 17.72, 7.14], [q * 0.3, 18.02, 7.06]], [0.21, 0.135, 0.145], 8), OSS, { k: 0.18, ck: 0.34 });
    s.add(ellipsoidP([q * 0.44, 17.48, 7.02], [0.2, 0.14, 0.14], [0, q * 0.3, q * 0.3]), C, { k: 0.1 }); // the root of the ear
    // The nostril, a long slit that can close against dust and thorns.
    s.add(E([q * 0.09, 16.46, 9.38], [0.125, 0.1, 0.12]), C, { k: 0.05 }); // the long upper lip
    s.sub(curveP([[q * 0.11, 16.63, 9.43], [q * 0.17, 16.72, 9.27]], [0.034, 0.024], 4), lin(0x18120e), { k: 0.02, ck: 0.03 });
    s.sub(curveP([[q * 0.22, 16.39, 8.98], [q * 0.22, 16.37, 9.2], [q * 0.13, 16.35, 9.42]], [0.024, 0.024, 0.024], 5), lin(0x241a14), { k: 0.012, ck: 0.03 }); // the line of the lips
  }
  s.sub(curveP([[-0.13, 16.35, 9.42], [0, 16.34, 9.47], [0.13, 16.35, 9.42]], [0.024, 0.024, 0.024], 5), lin(0x241a14), { k: 0.012, ck: 0.03 });
  s.sub({ box: [-9, -2, -12, 9, 0, 16], f: (x, y) => y }); // flat on the ground
  return s;
}

function giraffe() {
  const rng = seededRandom(9401);
  // --- Where the patches are -------------------------------------------------------------------------
  const scaleAt = (x, y, z) => {
    if (z > 6.7 && y > 16) return z > 8.6 ? 0.2 : 0.3;
    if (y < 4.6) return mix(0.26, 0.48, sstep(y, 1.5, 4.6));
    if (y < 7.4 && Math.abs(x) > 0.5) return mix(0.48, 0.8, sstep(y, 4.6, 7.4));
    return mix(0.94, 0.56, sstep(y + z * 0.25, 12, 17.5));
  };
  const coarse = polygonize(giraffeField(0.2));
  const P = coarse.attributes.position;
  const seeds = [];
  const HASH = 1.25;
  const buckets = new Map();
  const cellKey = (i, j, k) => (i + 64) * 16384 + (j + 64) * 128 + (k + 64);
  const addSeed = (p, sc) => {
    const sd = { p, s: sc, tone: 0.82 + rng() * 0.3, warm: rng() };
    seeds.push(sd);
    const k = cellKey(Math.floor(p[0] / HASH), Math.floor(p[1] / HASH), Math.floor(p[2] / HASH));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(sd);
  };
  // Every seed within one cell of a point, gathered once per cell.
  let around = new Map();
  const nearList = (x, y, z) => {
    const ci = Math.floor(x / HASH); const cj = Math.floor(y / HASH); const ck = Math.floor(z / HASH);
    const key = cellKey(ci, cj, ck);
    let list = around.get(key);
    if (!list) {
      list = [];
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const b = buckets.get(cellKey(ci + i, cj + j, ck + k));
        if (b) list.push(...b);
      }
      around.set(key, list);
    }
    return list;
  };
  for (const i of shuffled(P.count, rng)) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const sc = scaleAt(x, y, z);
    let free = true;
    around = new Map();
    for (const sd of nearList(x, y, z)) { if (Math.hypot(sd.p[0] - x, sd.p[1] - y, sd.p[2] - z) < (sc + sd.s) * 0.5) { free = false; break; } }
    if (free) addSeed([x, y, z], sc);
  }
  around = new Map();
  // Two nearest seeds, each distance measured in its own patch's size, with the line's width growing where the coat
  // fades. `lastSeed` is the patch a point lies in.
  let lastSeed = null; let lastF1 = 0;
  const lineGap = (x, y, z) => {
    const wx = x + 0.1 * (smoothNoise3(x * 0.9, y * 0.9, z * 0.9) - 0.5);
    const wy = y + 0.1 * (smoothNoise3(x * 0.9 + 7, y * 0.9, z * 0.9) - 0.5);
    let f1 = 1e9; let f2 = 1e9; let best = null;
    const list = nearList(wx, wy, z);
    for (let i = 0; i < list.length; i++) {
      const sd = list[i];
      const dx = sd.p[0] - wx; const dy = sd.p[1] - wy; const dz = sd.p[2] - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / sd.s;
      if (d < f1) { f2 = f1; f1 = d; best = sd; } else if (d < f2) f2 = d;
    }
    lastSeed = best; lastF1 = f1;
    return (f2 - f1);
  };
  const fadeAt = (x, y, z) => {
    let f = (1 - sstep(y, 0.9, 2.9)) * 0.95; // pale stockings below the knee and hock
    if (y < 8.2 && y > 5 && Math.abs(x) < 0.62) f = Math.max(f, 0.45 * sstep(0.62 - Math.abs(x), 0, 0.3)); // inside the legs
    f = Math.max(f, 0.55 * sstep(8.1 - y, 0, 0.5) * sstep(y, 6.5, 7) * (1 - sstep(Math.abs(x), 0.5, 1.2))); // under the belly
    if (z > 6.7 && y > 16) f = Math.max(f, mix(0.1, 1, sstep(z, 8.3, 9.05))); // the pale nose
    return f;
  };
  const widthAt = (x, y, z) => mix(0.2, 0.76, fadeAt(x, y, z));
  const edge = (x, y, z) => lineGap(x, y, z) - widthAt(x, y, z);
  const CHEST = lin(0x8a4518); const LIVER = lin(0x5e2c10); const AMBER = lin(0xa9621f); const CREAM = lin(0xe3d4ac);
  // The mesh carries how shaded each corner is and how much of it is coat at all; the colour comes last, from the
  // patch, once the mesh has been cut along the lines between patches.
  const optionsFor = (s) => {
    const ops = s.ops;
    return {
      uvScale: 0.9,
      extraReach: 0.06,
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const reach = 0.3;
        const open = clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
        const under = 0.86 + 0.14 * sstep(ny, -0.6, 0.3);
        // The sentinel white comes out as blue 1, and the ossicone's and the hoof's own colours are far below it.
        const a = sstep(rgb[2], 0.12, 0.95);
        const pit = rgb[2] < 0.1 && rgb[0] < 0.1 && y > 1; // nostrils and the mouth
        rgb[0] = mix(0.52, 1, open) * under * (pit ? 0.25 : 1);
        rgb[1] = pit ? 0 : a;
        rgb[2] = pit ? 0.5 : y < 1 ? 0 : 1; // which bare colour, if it is not coat: hoof or horn
      },
    };
  };
  const HOOF_C = lin(0x2a241e); const OSS_C = lin(0x8a5a2e); const PIT_C = lin(0x1a120c);
  const paint = (x, y, z, nx, ny, nz, shade, coat, which, inPatch, o) => {
    let r = CREAM[0]; let g = CREAM[1]; let b = CREAM[2];
    if (inPatch) {
      lineGap(x, y, z);
      const warm = lastSeed ? lastSeed.warm : 0.5;
      const t = warm * 2;
      const q0 = warm < 0.5 ? LIVER : CHEST; const q1 = warm < 0.5 ? CHEST : AMBER;
      const u = warm < 0.5 ? t : t - 1;
      // A slightly different brown for every patch, darker toward its heart.
      const heart = 0.84 + 0.22 * sstep(lastF1, 0.08, 0.5);
      r = mix(q0[0], q1[0], u) * heart; g = mix(q0[1], q1[1], u) * heart; b = mix(q0[2], q1[2], u) * heart;
    }
    const bare = which < 0.25 ? HOOF_C : which < 0.75 ? PIT_C : OSS_C;
    const a = clamp01(coat);
    r = mix(bare[0], r, a); g = mix(bare[1], g, a); b = mix(bare[2], b, a);
    // The bare dusky skin of the lips and round the nostrils.
    const lip = sstep(z, 9.02, 9.28) * sstep(16.92 - y, 0, 0.12);
    r = mix(r, 0.09, lip * 0.85); g = mix(g, 0.075, lip * 0.85); b = mix(b, 0.07, lip * 0.85);
    o[0] = r * shade; o[1] = g * shade; o[2] = b * shade;
  };
  const skin = [];
  for (const g of zoned(giraffeField, 0.235, [
    { cell: 0.07, box: [-0.9, 15.95, 6.75, 0.9, 18.5, 9.8] },
    { cell: 0.13, box: [-1.1, 11.6, 2.6, 1.1, 18.5, 7.0] },
    { cell: 0.14, box: [-1.3, -0.1, -4.6, 1.3, 4.7, 4.0] },
  ], optionsFor)) {
    skin.push({
      geometry: crispSplit(g, {
        side: edge,
        group: (x, y, z) => { lineGap(x, y, z); return lastSeed; },
        paint,
        depth: 1,
      }),
      keepColor: true,
    });
  }

  const headField = giraffeField(0.06).snapshot();
  const hard = [];
  // --- The eye, big and dark, standing out from the side of the skull under its brow ----------------------
  const eyes = [1, -1].map((q) => {
    const p = onSurface(headField, [q * 0.5, 17.22, 7.84]);
    const n = fieldNormal(headField, p);
    return { p, n, q };
  });
  for (const { p, n, q } of eyes) {
    const c = [p[0] - n[0] * 0.03, p[1] - n[1] * 0.03, p[2] - n[2] * 0.03];
    hard.push({ geometry: new THREE.SphereGeometry(0.135, 18, 14).translate(c[0], c[1], c[2]), color: 0x1d120c });
    hard.push({ geometry: new THREE.SphereGeometry(0.028, 8, 6).translate(c[0] + n[0] * 0.115, c[1] + n[1] * 0.1 + 0.05, c[2] + n[2] * 0.11 + 0.03), color: 0xf0e8da });
    // The lid: a dark ring round the ball, lying on the skin.
    const lidUp = V3(n).cross(new THREE.Vector3(0, 0, 1)).normalize();
    const lidFw = V3(n).cross(lidUp).normalize();
    const lid = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      lid.push([c[0] + (lidUp.x * Math.cos(a) + lidFw.x * Math.sin(a)) * 0.135 + n[0] * 0.03, c[1] + (lidUp.y * Math.cos(a) + lidFw.y * Math.sin(a)) * 0.125 + n[1] * 0.03, c[2] + (lidUp.z * Math.cos(a) + lidFw.z * Math.sin(a)) * 0.135 + n[2] * 0.03]);
    }
    hard.push({ geometry: tube(lid, 0.03, { sides: 6, steps: 36, round: 0 }), color: 0x20150e });
    // The long lashes that keep thorns out, on the upper lid only.
    for (let i = 0; i < 9; i++) {
      const a = ((i - 4) / 4) * 1.0;
      const root = [c[0] + n[0] * 0.05, c[1] + 0.125 * Math.cos(a) + n[1] * 0.05, c[2] + 0.16 * Math.sin(a) + n[2] * 0.05];
      const end = [root[0] + n[0] * 0.13 + q * 0.02, root[1] + 0.07, root[2] + 0.07 * Math.sin(a) + 0.04];
      hard.push({ geometry: tube([root, [(root[0] + end[0]) / 2, (root[1] + end[1]) / 2 + 0.008, (root[2] + end[2]) / 2], end], [0.009, 0.007, 0.002], { sides: 4, steps: 3, round: 0 }), color: 0x120c08 });
    }
  }

  // --- The tufts on the ossicones, a dark tassel on a dark knob ---------------------------------------------
  const fur = [];
  const DARKT = lin(0x17110c); const CHESTN = lin(0x6e3a16); const CHEST2 = lin(0x8c5522);
  const addLock = (root, dir, n, L, W, c, opts) => {
    const g = lockGeo(root, dir, n, L, W, opts);
    tintVertices(g, (x, y, z, o) => {
      const d = Math.hypot(x - root[0], y - root[1], z - root[2]) / L;
      const k = mix(0.8, 1.08, sstep(d, 0, 0.9));
      o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k;
    });
    fur.push({ geometry: g, keepColor: true });
  };
  const rand3 = () => V3([rng() - 0.5, rng() - 0.5, rng() - 0.5]);
  for (const q of [1, -1]) {
    const tip = V3([q * 0.3, 18.04, 7.06]);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 * 3.1; const up = rng();
      const n = V3([Math.cos(a), up * 0.9 - 0.15, Math.sin(a)]).normalize();
      const dir = V3([Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5]).add(rand3().multiplyScalar(0.3)).normalize();
      const root = [tip.x + n.x * 0.08, tip.y + n.y * 0.08 - 0.05, tip.z + n.z * 0.08];
      addLock(root, dir, n, 0.15 + rng() * 0.08, 0.075, DARKT, { nv: 3, lift: 0.1, droop: 0, th: 0.014 });
    }
  }

  // --- The mane: short, stiff and upright, a brush along the top of the neck -------------------------------
  const crest = new THREE.CatmullRomCurve3([[0, 11.7, 2.05], [0, 13.75, 3.62], [0, 15.75, 5.0], [0, 17.2, 6.26], [0, 17.6, 6.72]].map(V3));
  const LOCKS = 132;
  for (let i = 0; i < LOCKS; i++) {
    const t = (i + 0.5) / LOCKS;
    const c0 = crest.getPointAt(t);
    const tan = crest.getTangentAt(t);
    // Asked where the back of the neck is, then sunk in.
    const on = onSurface(headField, [0, c0.y, c0.z]);
    const back = V3([0, tan.z, -tan.y]).normalize(); // up and back, square to the neck
    const side = (i % 2 ? 1 : -1) * (0.012 + rng() * 0.05);
    const fall = (1 - sstep(t, 0, 0.14)) * 0.5 + 0.28;
    const dir = back.clone().addScaledVector(tan, -0.18 - fall).add(V3([side * 3, 0, 0])).normalize();
    const L = (0.25 + 0.06 * Math.sin(t * Math.PI)) * (0.8 + rng() * 0.3);
    const root = [side, on[1] - back.y * 0.05, on[2] - back.z * 0.05];
    const c = rng() > 0.4 ? CHESTN : CHEST2;
    addLock(root, dir, V3([Math.sign(side), 0, 0]), L + 0.05, 0.18 + rng() * 0.06, c, { nv: 2, lift: 0.03, droop: 0.02, th: 0.03 });
  }

  // --- The ears, long and leaf-shaped, held out and a little back ------------------------------------------
  const EAR_OUT = lin(0x9a6a32); const EAR_IN = lin(0xe6d6b4); const EAR_TIP = lin(0x2a1a10);
  const earGeo = (q) => {
    const e1 = V3([q * 0.88, 0.32, -0.34]).normalize();
    const e2 = V3([0, 1, 0.22]).normalize();
    const e3 = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const e2b = new THREE.Vector3().crossVectors(e3, e1).normalize();
    const L = 1.18;
    const Ori = V3([q * 0.44, 17.48, 7.02]);
    const g = solidSurface({
      nu: 8, nv: 14,
      point: (u, v) => {
        const a = L * v;
        const W = 0.27 * Math.sin(Math.PI * clamp01(v ** 0.72)) ** 0.8 + 0.02;
        const U = u * 2 - 1;
        const cup = -0.16 * (1 - U * U) * Math.sin(Math.PI * v);
        return [Ori.x + e1.x * a + e2b.x * U * W + e3.x * cup, Ori.y + e1.y * a + e2b.y * U * W + e3.y * cup, Ori.z + e1.z * a + e2b.z * U * W + e3.z * cup];
      },
      thick: (u, v) => 0.03 * (1 - 0.7 * v) * Math.max(0.05, 1 - (u * 2 - 1) ** 4),
    });
    // Which sheet faces forward is measured, since one ear is the mirror of the other.
    const half = g.attributes.position.count / 2;
    let sum = 0;
    for (let i = 0; i < half; i++) sum += g.attributes.normal.getZ(i) + g.attributes.normal.getY(i) * 0.1;
    const firstFront = sum > 0;
    tintVertices(g, (x, y, z, o, i) => {
      const front = i < half ? firstFront : !firstFront;
      const d = Math.hypot(x - Ori.x, y - Ori.y, z - Ori.z) / L;
      // Pale inside with a darker hollow down the middle of it.
      const off = V3([x - Ori.x, y - Ori.y, z - Ori.z]);
      const along = off.dot(e1);
      const across = Math.abs(off.dot(e2b)) / (0.27 * Math.sin(Math.PI * clamp01(clamp01(along / L) ** 0.72)) ** 0.8 + 0.03);
      const c = front ? [mix(EAR_OUT[0] * 0.7, EAR_IN[0], sstep(across, 0.15, 0.65)), mix(EAR_OUT[1] * 0.7, EAR_IN[1], sstep(across, 0.15, 0.65)), mix(EAR_OUT[2] * 0.7, EAR_IN[2], sstep(across, 0.15, 0.65))] : EAR_OUT;
      const tip = sstep(d, 0.86, 1);
      const k = 0.9 + 0.14 * smoothNoise3(x * 8, y * 8, z * 8);
      o[0] = mix(c[0], EAR_TIP[0], tip) * k; o[1] = mix(c[1], EAR_TIP[1], tip) * k; o[2] = mix(c[2], EAR_TIP[2], tip) * k;
    });
    return g;
  };
  const earParts = [earGeo(1), earGeo(-1)];

  // --- The tail: a long thin rope with a great black tassel -------------------------------------------------
  const tail = [[0, 9.4, -4.3], [0, 9.0, -4.62], [0, 7.9, -4.82], [0, 6.6, -4.9], [0, 5.5, -4.9]];
  const tailG = tube(tail, [0.2, 0.14, 0.085, 0.07, 0.065], { sides: 9, steps: 22, round: 1 });
  const TAILC = lin(0x8a5a2a);
  tintVertices(tailG, (x, y, z, o) => { const k = 0.9 + 0.14 * smoothNoise3(x * 4, y * 4, z * 4); o[0] = TAILC[0] * k; o[1] = TAILC[1] * k; o[2] = TAILC[2] * k; });
  hard.push({ geometry: tailG, keepColor: true });
  for (let i = 0; i < 40; i++) {
    const a = rng() * Math.PI * 2;
    const y = 5.9 - rng() * 0.75;
    const n = V3([Math.cos(a), 0, Math.sin(a)]);
    const dir = V3([Math.cos(a) * 0.12, -1, Math.sin(a) * 0.12]).normalize();
    addLock([n.x * 0.05, y, -4.9 + n.z * 0.05], dir, n, 1.15 + rng() * 0.8, 0.08, DARKT, { nv: 4, lift: 0.03, droop: 0, th: 0.012 });
  }

  const DZ = -2.65;
  const root = new THREE.Group();
  root.name = 'giraffe';
  const add = (g, params) => { g.translate(0, 0, DZ); root.add(mesh(g, standard(params))); };
  const nap = napMap(9402);
  add(mergeParts(skin), { vertexColors: true, map: nap, bumpMap: nap, bumpScale: 0.45, roughness: 0.78, metalness: 0 });
  const strands = strandMap(9403);
  add(mergeParts([...fur, ...earParts.map((geometry) => ({ geometry, keepColor: true }))]), { vertexColors: true, map: strands, bumpMap: strands, bumpScale: 0.5, roughness: 0.74, metalness: 0 });
  add(mergeParts(hard), { vertexColors: true, roughness: 0.4, metalness: 0 });
  return root;
}

// ---------------------------------------------------------------------------------------------
// Polar bear
// ---------------------------------------------------------------------------------------------

// True size, with the catalogue's 0.7 applied by the record, walking across a floe. What separates it from every
// other bear, in the order the eye takes it: the long neck and small, narrow, wedge-shaped head; no shoulder hump, with
// the rump as high as or higher than the shoulders; the very small ears; and enormous furred paws. The surface under
// the fur is coarse on purpose. The silhouette and the direction of the hair are carried by real tufts.
const BEAR_G = 0.6;
function bearLegs() {
  // Each is [points, radii] down to the wrist or ankle, then a paw: centre and its heading.
  const g = BEAR_G;
  return [
    { // Left fore: reaching forward, just planted.
      q: 1, kind: 'fore',
      pts: [[0.98, 4.45, 2.05], [1.14, 3.2, 2.6], [1.14, 2.05, 3.2], [1.16, g + 0.62, 3.72]], r: [0.92, 0.78, 0.55, 0.47],
      paw: [1.18, g + 0.3, 3.92], head: 0.12, L: 0.86, W: 0.66,
    },
    { // Right fore: at the end of its stance, the leg sloping back under the body.
      q: -1, kind: 'fore',
      pts: [[-0.98, 4.45, 1.9], [-1.12, 3.15, 1.25], [-1.1, 2.0, 0.78], [-1.12, g + 0.62, 0.62]], r: [0.92, 0.78, 0.55, 0.47],
      paw: [-1.14, g + 0.3, 0.86], head: -0.1, L: 0.86, W: 0.66,
    },
    { // Left hind: pushing off behind, the long foot of a plantigrade animal.
      q: 1, kind: 'hind',
      pts: [[1.1, 4.5, -2.55], [1.26, 3.1, -2.3], [1.24, 2.0, -3.3], [1.24, g + 0.5, -3.65]], r: [1.14, 0.86, 0.5, 0.44],
      paw: [1.24, g + 0.28, -3.3], head: 0.04, L: 1.04, W: 0.62,
    },
    { // Right hind: swung forward, flat on the ice under the belly.
      q: -1, kind: 'hind',
      pts: [[-1.1, 4.5, -2.45], [-1.26, 3.2, -1.5], [-1.24, 2.0, -1.72], [-1.24, g + 0.5, -1.62]], r: [1.14, 0.86, 0.5, 0.44],
      paw: [-1.26, g + 0.28, -1.15], head: -0.08, L: 1.04, W: 0.62,
    },
  ];
}

function bearField(cell) {
  const s = new Sculpt(cell);
  const C = [1, 1, 1];
  const torso = axisLoft([
    [-4.05, 4.2, 0.5, 0.55, 0.6],
    [-3.5, 4.3, 1.26, 1.36, 1.38],
    [-2.3, 4.15, 1.62, 1.78, 1.62],
    [-0.9, 4.0, 1.72, 1.66, 1.58],
    [0.6, 3.95, 1.64, 1.5, 1.52],
    [1.8, 4.05, 1.4, 1.36, 1.42],
    [2.8, 4.25, 1.02, 1.0, 1.15],
    [3.3, 4.4, 0.7, 0.7, 0.82],
  ]);
  s.add(torso, C);
  // The long neck, reaching out and low, which no other bear has.
  s.add(curveP([[0, 4.55, 2.6], [0, 4.5, 3.5], [0, 4.3, 4.3], [0, 4.14, 4.95]], [1.02, 0.84, 0.66, 0.54], 16), C, { k: 0.5 });
  s.add(E([0, 4.05, 3.6], [0.72, 0.62, 0.8]), C, { k: 0.4 }); // the loose skin of the throat
  for (const leg of bearLegs()) {
    s.add(curveP(leg.pts, leg.r, 18), C, { k: 0.5 });
    if (leg.kind === 'hind') s.add(E([leg.pts[0][0], 4.3, leg.pts[0][2]], [0.5, 1.1, 1.1]), C, { k: 0.6 });
    else s.add(E([leg.q * 1.02, 4.3, 2.0], [0.42, 0.85, 0.85]), C, { k: 0.6 });
    // The paw, far bigger than the leg above it, broad and flat, with five toes.
    const [px, py, pz] = leg.paw; const h = leg.head; const sh = Math.sin(h); const ch = Math.cos(h);
    s.add(E([px, py + 0.1, pz], [leg.W, 0.34, leg.L], [0, h, 0]), C, { k: 0.26 });
    s.add(curveP([leg.pts[3], [px, py + 0.28, pz - ch * 0.22]], [leg.r[3], 0.42], 4), C, { k: 0.26 });
    for (let t = -2; t <= 2; t++) {
      const off = t * leg.W * 0.39;
      const fw = leg.L * (0.82 - 0.05 * t * t);
      s.add(E([px + ch * off + sh * fw, py - 0.02, pz - sh * off + ch * fw], [0.15, 0.17, 0.2], [0, h, 0]), C, { k: 0.075 });
    }
  }
  s.add(E([0, 4.72, -4.05], [0.24, 0.3, 0.36], [0.5, 0, 0]), C, { k: 0.26 }); // the short tail
  // --- The head ------------------------------------------------------------------------------------------
  s.add(E([0, 4.13, 5.3], [0.52, 0.48, 0.62]), C, { k: 0.28 }); // the skull, small and long
  s.add(curveP([[0, 4.17, 5.62], [0, 4.1, 6.05], [0, 3.97, 6.42]], [0.42, 0.32, 0.25], 8), C, { k: 0.2 }); // the long Roman nose
  s.add(E([0, 3.7, 5.92], [0.27, 0.16, 0.52]), C, { k: 0.16 }); // the lower jaw
  const BLACK = lin(0x0e0c0c);
  s.add(E([0, 3.99, 6.6], [0.2, 0.15, 0.13]), BLACK, { k: 0.05, ck: 0.05 }); // the nose
  for (const q of [1, -1]) {
    s.add(E([q * 0.3, 4.32, 5.62], [0.14, 0.09, 0.2]), C, { k: 0.1 }); // the brow
    s.add(E([q * 0.42, 3.88, 5.48], [0.2, 0.28, 0.32]), C, { k: 0.16 }); // the cheek
    s.add(E([q * 0.42, 4.56, 4.98], [0.17, 0.17, 0.1], [0, q * -0.4, q * 0.3]), C, { k: 0.05 }); // the ear, small and round
    s.sub(E([q * 0.46, 4.58, 5.06], [0.08, 0.09, 0.05], [0, q * -0.4, q * 0.3]), lin(0x332c28), { k: 0.03, ck: 0.03 });
    s.sub(E([q * 0.09, 4.02, 6.72], [0.055, 0.04, 0.05]), lin(0x050404), { k: 0.012, ck: 0.015 }); // the nostril
  }
  // The black lips, a line lying in the crease of the jaw, asked where the surface is rather than placed by eye.
  const face = s.snapshot();
  for (const q of [1, -1]) {
    const lip = pathOn(face, [[q * 0.03, 3.8, 6.5], [q * 0.17, 3.79, 6.36], [q * 0.27, 3.82, 6.08], [q * 0.34, 3.86, 5.82], [q * 0.38, 3.9, 5.62]], 14, 0);
    s.sub(segsP(lip, lip.map((_, i) => 0.042 - 0.018 * (i / (lip.length - 1)))), BLACK, { k: 0.015, ck: 0.02 });
  }
  s.sub(curveP([[0, 3.9, 6.64], [0, 3.8, 6.5]], [0.02, 0.024], 3), BLACK, { k: 0.012, ck: 0.02 }); // the groove down from the nose
  s.sub({ box: [-9, -2, -12, 9, BEAR_G - 0.02, 12], f: (x, y) => y - (BEAR_G - 0.02) });
  return s;
}

// Painted once per texel for the whole top of the floe: snow, what wind has done to it, cracks, the lead of open water
// down one edge, and the tracks the bear has made.
function floeTexture(X, Z, edgeX) {
  const W = 1024; const H = Math.round((W * Z) / X);
  const rng = seededRandom(9501);
  const toPx = (x, z) => [((x + X / 2) / X) * W, H - ((z + Z / 2) / Z) * H];
  const ft = W / X;
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#f7fafb';
    ctx.fillRect(0, 0, W, H);
    // The long soft shapes wind leaves.
    for (let i = 0; i < 120; i++) {
      const x = rng() * W; const y = rng() * H; const r = (0.5 + rng() * 2.2) * ft;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const cold = rng() > 0.45;
      g.addColorStop(0, cold ? 'rgba(188,214,232,0.34)' : 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(240,246,250,0)');
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.5); ctx.scale(1.8, 0.7); ctx.translate(-x, -y);
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (let i = 0; i < 7000; i++) {
      const v = rng();
      ctx.fillStyle = v > 0.55 ? 'rgba(255,255,255,0.9)' : 'rgba(170,198,220,0.4)';
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 1.4, 1 + rng() * 1.4);
    }
    // Paw prints going back the way it came, each a broad pad with a row of toe marks in front.
    const print = (x, z, a, big = 1) => {
      const [px, py] = toPx(x, z);
      ctx.save();
      ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = 'rgba(132,170,204,0.72)';
      ctx.beginPath(); ctx.ellipse(0, 0.12 * ft * big, 0.3 * ft * big, 0.4 * ft * big, 0, 0, Math.PI * 2); ctx.fill();
      for (let t = -2; t <= 2; t++) { ctx.beginPath(); ctx.arc(t * 0.17 * ft * big, (-0.42 + Math.abs(t) * 0.05) * ft * big, 0.085 * ft * big, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(92,134,176,0.5)';
      for (let t = -2; t <= 2; t++) { ctx.beginPath(); ctx.arc(t * 0.19 * ft * big, (-0.62 + Math.abs(t) * 0.05) * ft * big, 0.03 * ft * big, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    print(-1.3, -5.85, 0.08); print(1.2, -5.6, -0.1);
    print(-1.2, -4.0, 0.04, 0.96);
    // The lead: dark water, with the broken edge of the ice standing in it.
    const edgePath = [];
    for (let z = -Z / 2; z <= Z / 2 + 0.01; z += 0.2) edgePath.push([edgeX(z), z]);
    ctx.beginPath();
    edgePath.forEach(([x, z], i) => { const [a, b] = toPx(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
    ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.closePath();
    const water = ctx.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, '#163f5e'); water.addColorStop(1, '#0f3350');
    ctx.fillStyle = water; ctx.fill();
    ctx.strokeStyle = 'rgba(120,190,226,0.8)'; ctx.lineWidth = 0.1 * ft; ctx.stroke();
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(160,214,240,0.25)';
    ctx.save(); ctx.clip();
    for (let i = 0; i < 90; i++) {
      const x = W * (0.6 + rng() * 0.4); const y = rng() * H; const L = (0.3 + rng() * 0.7) * ft;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + L * 0.5, y - 2, x + L, y); ctx.stroke();
    }
    ctx.restore();
    // Cracks in the floe running in from the lead, each a dark blue line with a lit edge.
    const crack = (x0, z0, heading, len) => {
      let x = x0; let z = z0; let a = heading;
      const pts = [toPx(x, z)];
      const n = Math.floor(len / 0.32);
      for (let i = 0; i < n; i++) { a += (rng() - 0.5) * 0.9; x += Math.cos(a) * 0.32; z += Math.sin(a) * 0.32; pts.push(toPx(x, z)); }
      const draw = (style, width, oy = 0) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath(); pts.forEach(([p, q], i) => (i ? ctx.lineTo(p, q + oy) : ctx.moveTo(p, q + oy))); ctx.stroke(); };
      draw('rgba(255,255,255,0.8)', 4, 1.8);
      draw('rgba(70,132,178,0.9)', 2.6);
      if (rng() > 0.4 && len > 1.4) crack(x - Math.cos(a) * len * 0.3, z - Math.sin(a) * len * 0.3, a + 1.1 * (rng() > 0.5 ? 1 : -1), len * 0.5);
    };
    for (const z of [5.7, 4.2, 2.6, 0.9, -0.8, -2.4, -3.9]) crack(edgeX(z), z, Math.PI + (rng() - 0.5) * 0.7, 1.0 + rng() * 1.6);
  });
}

function polarBear() {
  const rng = seededRandom(9502);
  const WARM = [0.74, 0.665, 0.46]; const COOL = [0.62, 0.66, 0.67]; const CREAM = [0.73, 0.69, 0.56];
  const coatInto = (x, y, z, ny, out) => {
    const n = smoothNoise3(x * 0.7, y * 0.7, z * 0.7);
    const n2 = smoothNoise3(x * 2.1 + 4, y * 2.1, z * 2.1);
    // Yellower where it is stained, down the legs and along the flank; cooler where the back takes the sky.
    const warm = clamp01(0.42 + 0.5 * (n - 0.5) * 2 + 0.26 * (1 - sstep(y, 1.2, 3.6)) - 0.4 * sstep(ny, 0.3, 0.9));
    const cool = sstep(ny, 0.2, 0.95) * 0.75;
    const k = 0.92 + 0.14 * n2;
    out[0] = mix(mix(CREAM[0], WARM[0], warm), COOL[0], cool) * k;
    out[1] = mix(mix(CREAM[1], WARM[1], warm), COOL[1], cool) * k;
    out[2] = mix(mix(CREAM[2], WARM[2], warm), COOL[2], cool) * k;
  };
  const optionsFor = (s) => {
    const ops = s.ops;
    const c = [0, 0, 0];
    return {
      uvScale: 1.1,
      extraReach: 0.05,
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const reach = 0.34;
        const open = clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
        const ao = mix(0.66, 1, open);
        const a = sstep(rgb[2], 0.2, 0.9);
        coatInto(x, y, z, ny, c);
        // Skin shows darker round the eye and the base of the muzzle.
        rgb[0] = mix(rgb[0], c[0] * ao, a); rgb[1] = mix(rgb[1], c[1] * ao, a); rgb[2] = mix(rgb[2], c[2] * ao, a);
      },
    };
  };
  const legs = bearLegs();
  const zones = [{ cell: 0.058, box: [-0.82, 3.3, 4.9, 0.82, 4.9, 6.85] }];
  for (const leg of legs) {
    const [px, , pz] = leg.paw;
    const ch = Math.max(leg.L, leg.W) + 0.32;
    zones.push({ cell: 0.078, box: [px - ch, 0.5, pz - ch, px + ch, 1.3, pz + ch] });
  }
  const skin = zoned(bearField, 0.19, zones, optionsFor).map((geometry) => ({ geometry, keepColor: true }));

  const hard = [];
  const field = bearField(0.08).snapshot();
  // --- The eyes, small, dark and set close to the top of the muzzle ---------------------------------------
  for (const q of [1, -1]) {
    const p = onSurface(field, [q * 0.4, 4.18, 5.86]);
    const n = fieldNormal(field, p);
    const c = [p[0] - n[0] * 0.02, p[1] - n[1] * 0.02, p[2] - n[2] * 0.02];
    hard.push({ geometry: new THREE.SphereGeometry(0.075, 14, 10).translate(c[0], c[1], c[2]), color: 0x120c08 });
    hard.push({ geometry: new THREE.SphereGeometry(0.016, 8, 6).translate(c[0] + n[0] * 0.066, c[1] + n[1] * 0.066 + 0.025, c[2] + n[2] * 0.066 + 0.015), color: 0xf2ece4 });
    // A dark lid, lying on the fur.
    const up = V3(n).cross(new THREE.Vector3(0, 0, 1)).normalize(); const fw = V3(n).cross(up).normalize();
    const ringPts = [];
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ringPts.push([c[0] + (up.x * Math.cos(a) + fw.x * Math.sin(a)) * 0.078 + n[0] * 0.02, c[1] + (up.y * Math.cos(a) + fw.y * Math.sin(a)) * 0.065 + n[1] * 0.02, c[2] + (up.z * Math.cos(a) + fw.z * Math.sin(a)) * 0.085 + n[2] * 0.02]);
    }
    hard.push({ geometry: tube(ringPts, 0.016, { sides: 5, steps: 28, round: 0 }), color: 0x17120f });
  }
  // --- The claws: short, black and hooked, out of each toe ---------------------------------------------------
  let claws = 0;
  for (const leg of legs) {
    const [px, py, pz] = leg.paw; const h = leg.head; const sh = Math.sin(h); const ch = Math.cos(h);
    for (let t = -2; t <= 2; t++) {
      const off = t * leg.W * 0.39;
      const fw = leg.L * (0.82 - 0.05 * t * t);
      const base = [px + ch * off + sh * fw, py - 0.02, pz - sh * off + ch * fw];
      const dx = sh; const dz = ch;
      const a = [base[0] + dx * 0.09, base[1] + 0.03, base[2] + dz * 0.09];
      const b = [base[0] + dx * 0.22, base[1] + 0.03, base[2] + dz * 0.22];
      const e = [base[0] + dx * 0.31, BEAR_G + 0.02, base[2] + dz * 0.31];
      hard.push({ geometry: tube([a, b, e], [0.07, 0.05, 0.01], { sides: 7, steps: 7, round: 0 }), color: 0x161311 });
      claws += 1;
    }
  }
  if (claws !== 20) throw new Error('polar-bear: five claws on each of four paws');

  // --- The fur's silhouette: real tufts lying the way the hair lies -----------------------------------------
  const fur = [];
  const placing = polygonize(bearField(0.17));
  const P = placing.attributes.position; const N = placing.attributes.normal;
  const seen = new Set();
  const flow = new THREE.Vector3(); const nrm = new THREE.Vector3();
  const c = [0, 0, 0];
  const SP = 0.36;
  for (const i of shuffled(P.count, rng)) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const key = `${Math.floor(x / SP)},${Math.floor(y / SP)},${Math.floor(z / SP)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (y < 1.0) continue; // the paws stay neat, so the toes read
    const nx = N.getX(i); const ny = N.getY(i); const nz = N.getZ(i);
    if (z > 5.5 && y < 4.45 && Math.abs(x) < 0.5) continue; // the bare front of the face
    if (z > 5.4 && Math.abs(x) > 0.2 && Math.abs(y - 4.18) < 0.16) continue; // the eyes
    if (Math.abs(x) > 0.25 && y > 4.4 && z > 4.8 && z < 5.2) continue; // the ears
    if (y < 2.4 && Math.abs(x) < 0.7) continue; // inside the legs, unseen
    nrm.set(nx, ny, nz);
    const onHead = z > 4.9;
    const onLeg = y < 3.0;
    if (onHead) flow.set(x * 0.8, -0.1, -1);
    else if (onLeg) flow.set(Math.sign(x) * 0.08, -1, -0.18);
    else flow.set(Math.sign(x) * 0.2, -0.45, -1);
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.02) flow.set(0, -1, -0.2);
    flow.normalize();
    // Longest on the neck's underside, the backs of the forelegs and the haunches, where a real coat hangs.
    const neckRuff = z > 2.6 && z < 5 && ny < -0.1 ? 0.3 : 0;
    const pants = onLeg && nz < -0.1 ? 0.24 : 0;
    const belly = ny < -0.3 && !onLeg ? 0.2 : 0;
    let L = (onHead ? 0.22 : 0.56 + neckRuff + pants + belly) * (0.8 + rng() * 0.45);
    if (y < 1.7) L *= mix(0.45, 1, sstep(y, 1.0, 1.7)); // short over the paws, so a lock never lies across the toes
    if (z < -3.7 && y > 3.8) { L *= 0.6; flow.set(Math.sign(x) * 0.2, -1, -0.3).normalize(); } // and round the tail
    const W = onHead ? 0.15 : 0.3 + rng() * 0.08;
    coatInto(x, y, z, ny, c);
    const dark = mix(0.86, 1, sstep(ny, -0.9, 0.2));
    const tone = [c[0] * dark, c[1] * dark, c[2] * dark];
    const j = 0.94 + rng() * 0.12;
    const root = [x - nx * 0.05, y - ny * 0.05, z - nz * 0.05];
    const g = lockGeo(root, flow.clone(), nrm.clone(), L, W, { nv: 2, lift: 0.16, droop: 0.05, th: 0.03 });
    tintVertices(g, (px, py, pz, o) => {
      const d = Math.hypot(px - root[0], py - root[1], pz - root[2]) / L;
      const k = j * mix(0.92, 1.02, sstep(d, 0.05, 0.85));
      o[0] = Math.min(0.8, tone[0] * k); o[1] = Math.min(0.8, tone[1] * k); o[2] = Math.min(0.8, tone[2] * k);
    });
    // A lock shaded as itself reads as a scale. Shaded mostly as the body it lies on, it adds an outline and a nap and
    // never a tile.
    const Ng = g.attributes.normal;
    for (let v = 0; v < Ng.count; v++) {
      const ax = mix(Ng.getX(v), nx, 0.8); const ay = mix(Ng.getY(v), ny, 0.8); const az = mix(Ng.getZ(v), nz, 0.8);
      const l = Math.hypot(ax, ay, az) || 1;
      Ng.setXYZ(v, ax / l, ay / l, az / l);
    }
    fur.push({ geometry: g, keepColor: true });
  }

  const DZ = -1.0;
  const shift = (g) => { g.translate(0, 0, DZ); return g; };

  // --- The floe -------------------------------------------------------------------------------------------
  const XS = 8.4; const ZS = 13.4;
  const edgeX = (z) => 3.0 + 0.42 * Math.sin(z * 0.8 + 1) + 0.18 * Math.sin(z * 2.3) - 0.5 * sstep(z, 0, 6);
  const NX = 46; const NZ = 66;
  const ix = []; const uv = []; const pos = []; const col = [];
  const WHITE = [0.8, 0.84, 0.88]; const ICE = lin(0x6fb3dc); const DEEP = lin(0x2d6fa8);
  const Hgt = (x, z) => {
    const drift = 0.05 * (smoothNoise3(x * 0.5, 3, z * 0.4) - 0.5) * 2 + 0.018 * (smoothNoise3(x * 2, 1, z * 2) - 0.5) * 2;
    const inWater = sstep(x - edgeX(z), -0.13, 0.13);
    return mix(BEAR_G + drift, 0.16, inWater);
  };
  // A rounded outline, a little irregular, so a slab reads as ice rather than as a cake.
  const outline = (u, v) => {
    const a = u * 2 - 1; const b = v * 2 - 1;
    const r = 1 - 0.14 * (a * a * b * b);
    return [a * r * (XS / 2), b * r * (ZS / 2)];
  };
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const [x, z] = outline(i / NX, j / NZ);
      pos.push(x, Hgt(x, z), z);
      uv.push((x + XS / 2) / XS, (z + ZS / 2) / ZS);
      col.push(WHITE[0], WHITE[1], WHITE[2]);
    }
  }
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i; const b = a + 1; const d = a + NX + 1; const e = d + 1;
      ix.push(a, d, b, b, d, e);
    }
  }
  // The skirt, a wall of blue ice the whole way round, with its own vertices so it has its own colour.
  const ringIdx = [];
  for (let i = 0; i <= NX; i++) ringIdx.push([i / NX, 0]);
  for (let j = 1; j <= NZ; j++) ringIdx.push([1, j / NZ]);
  for (let i = NX - 1; i >= 0; i--) ringIdx.push([i / NX, 1]);
  for (let j = NZ - 1; j >= 1; j--) ringIdx.push([0, j / NZ]);
  const nRing = ringIdx.length;
  const baseV = pos.length / 3;
  const LEVELS = [1, 0.74, 0.42, 0];
  for (const lv of LEVELS) {
    for (const [u, v] of ringIdx) {
      const [x, z] = outline(u, v);
      const top = Hgt(x, z);
      const wob = lv === 1 ? 0 : 0.05 * (smoothNoise3(x * 1.2, lv * 4, z * 1.2) - 0.5);
      pos.push(x * (1 + wob * 0.2) + (lv < 1 ? wob : 0), top * lv, z + (lv < 1 ? wob : 0));
      uv.push(0.02, 0.98);
      const t = 1 - lv;
      const c0 = lv === 1 ? [0.74, 0.82, 0.88] : [mix(ICE[0], DEEP[0], t), mix(ICE[1], DEEP[1], t), mix(ICE[2], DEEP[2], t)];
      const n = 0.86 + 0.28 * smoothNoise3(x * 2.4, lv * 7, z * 2.4);
      col.push(c0[0] * n, c0[1] * n, c0[2] * n);
    }
  }
  for (let l = 0; l < LEVELS.length - 1; l++) {
    for (let k = 0; k < nRing; k++) {
      const k2 = (k + 1) % nRing;
      const a = baseV + l * nRing + k; const b = baseV + l * nRing + k2; const c2 = baseV + (l + 1) * nRing + k2; const d = baseV + (l + 1) * nRing + k;
      ix.push(a, b, d, b, c2, d);
    }
  }
  const floe = new THREE.BufferGeometry();
  floe.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  floe.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  floe.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  floe.setIndex(ix);
  floe.computeVertexNormals();
  // Broken pieces standing in the lead, each a rough slab of the same snow and ice.
  const floeHard = [];
  const FLOES = [[3.42, 4.9, 0.3], [3.72, 3.5, 0.2], [3.5, 2.0, 0.34], [3.82, 0.9, 0.18], [3.66, -0.9, 0.26], [3.74, 5.9, 0.16]];
  const ICE_TOP = [0.76, 0.82, 0.86];
  for (const [x, z, r] of FLOES) {
    const m = Math.max(0.1, r);
    const g = lathe([[0, 0.1], [m * 0.92, 0.1], [m, 0.2], [m * 0.9, 0.28], [0, 0.3]], 7);
    g.scale(1 + rng() * 0.5, 1, 0.8 + rng() * 0.4);
    g.rotateY(rng() * 3);
    g.translate(x, 0, z);
    tintVertices(g, (a, b, c3, o) => { const t = sstep(b, 0.18, 0.26); o[0] = mix(ICE[0], ICE_TOP[0], t); o[1] = mix(ICE[1], ICE_TOP[1], t); o[2] = mix(ICE[2], ICE_TOP[2], t); });
    floeHard.push({ geometry: g, keepColor: true });
  }

  const root = new THREE.Group();
  root.name = 'polar-bear';
  const nap = napMap(9503);
  root.add(mesh(shift(mergeParts(skin)), standard({ vertexColors: true, bumpMap: nap, bumpScale: 0.5, roughness: 0.84, metalness: 0 })));
  const strands = strandMap(9504);
  // Tufts do not cast shadows. Eleven hundred little shadows on the coat read as shingles, and the body under them
  // already throws the animal's own shadow on the ice.
  const furMesh = mesh(shift(mergeParts(fur)), standard({ vertexColors: true, bumpMap: strands, bumpScale: 0.4, roughness: 0.84, metalness: 0 }));
  furMesh.castShadow = false;
  root.add(furMesh);
  root.add(mesh(shift(mergeParts(hard)), standard({ vertexColors: true, roughness: 0.32, metalness: 0 })));
  const iceMap = floeTexture(XS, ZS, edgeX);
  root.add(mesh(floe, standard({ vertexColors: true, map: iceMap, bumpMap: iceMap, bumpScale: 0.5, roughness: 0.55, metalness: 0 })));
  root.add(mesh(mergeParts(floeHard), standard({ vertexColors: true, roughness: 0.45, metalness: 0 })));
  return root;
}

export const BUILDERS = {
  'human-skull': humanSkull,
  'human-spine': humanSpine,
  bacteriophage,
  giraffe,
  'polar-bear': polarBear,
};
