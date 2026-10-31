// Builders for the Model Database's fourth organic set: the bone section, the blood vessel, the
// beehive, the sprouting bean and the African elephant. Five models with one thing in common: each is
// carried by a surface a vertex tint cannot draw (a lace of trabeculae, thousands of hexagons, soil, an
// elephant's hide), so each has one canvas doing the work, and the geometry exists to hold it up.

import * as THREE from 'three';
import { mergeParts, smoothNoise3, extrudeOutline, roundedOutline, solidSurface, smoothed } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  lin, clamp01, mix, sstep, fieldD, sphereP, ellipsoidP, segsP, curveP, Sculpt, onSurface, fieldNormal, pathOn, polygonize, tube, lathe, mirrorX, tintVertices, grainBump, outward, flipped, sampleCurve,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

// Marching squares over f(a, b), negative inside. Returns closed loops of [a, b] with the inside on
// the left, so an outer boundary is counter-clockwise and a hole clockwise.
function contour(f, [a0, b0, a1, b1], cell) {
  const na = Math.ceil((a1 - a0) / cell) + 1;
  const nb = Math.ceil((b1 - b0) / cell) + 1;
  const v = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = f(a0 + i * cell, b0 + j * cell);
  const H = (i, j) => (i + j * na) * 2;
  const Ve = (i, j) => (i + j * na) * 2 + 1;
  const point = (edge) => {
    const horizontal = edge % 2 === 0;
    const at = Math.floor(edge / 2);
    const i = at % na; const j = Math.floor(at / na);
    const p = v[at]; const q = v[horizontal ? at + 1 : at + na];
    const t = p / (p - q);
    return horizontal ? [a0 + (i + t) * cell, b0 + j * cell] : [a0 + i * cell, b0 + (j + t) * cell];
  };
  const next = new Map();
  for (let j = 0; j < nb - 1; j++) {
    for (let i = 0; i < na - 1; i++) {
      const c0 = v[i + j * na]; const c1 = v[i + 1 + j * na]; const c2 = v[i + 1 + (j + 1) * na]; const c3 = v[i + (j + 1) * na];
      const mask = (c0 < 0 ? 1 : 0) | (c1 < 0 ? 2 : 0) | (c2 < 0 ? 4 : 0) | (c3 < 0 ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      const e0 = H(i, j); const e1 = Ve(i + 1, j); const e2 = H(i, j + 1); const e3 = Ve(i, j);
      const centre = (c0 + c1 + c2 + c3) < 0;
      const link = (p, q) => next.set(p, q);
      switch (mask) {
        case 1: link(e0, e3); break;
        case 2: link(e1, e0); break;
        case 3: link(e1, e3); break;
        case 4: link(e2, e1); break;
        case 5: if (centre) { link(e0, e1); link(e2, e3); } else { link(e0, e3); link(e2, e1); } break;
        case 6: link(e2, e0); break;
        case 7: link(e2, e3); break;
        case 8: link(e3, e2); break;
        case 9: link(e0, e2); break;
        case 10: if (centre) { link(e3, e0); link(e1, e2); } else { link(e1, e0); link(e3, e2); } break;
        case 11: link(e1, e2); break;
        case 12: link(e3, e1); break;
        case 13: link(e0, e1); break;
        case 14: link(e3, e0); break;
        default: break;
      }
    }
  }
  const loops = [];
  const used = new Set();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop = [];
    let e = start;
    while (e !== undefined && !used.has(e)) {
      used.add(e);
      loop.push(point(e));
      e = next.get(e);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

const loopArea = (loop) => {
  let s = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) s += loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1];
  return s / 2;
};

function insideLoop(p, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i]; const [xj, yj] = loop[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A flat plate from contour loops. `at(a, b)` puts a point in the world, `uv(a, b)` on the painting,
// and `normal` says which way it faces. The triangulation's own winding is measured, not assumed.
function plate(loops, at, uv, normal) {
  const outers = loops.filter((l) => loopArea(l) > 0);
  const holes = loops.filter((l) => loopArea(l) <= 0);
  const positions = []; const uvs = []; const normals = []; const index = [];
  for (const outer of outers) {
    const mine = holes.filter((h) => insideLoop(h[0], outer));
    const contourPts = outer.map(([x, y]) => new THREE.Vector2(x, y));
    const holePts = mine.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const faces = THREE.ShapeUtils.triangulateShape(contourPts, holePts);
    const base = positions.length / 3;
    for (const [a, b] of [...outer, ...mine.flat()]) {
      const p = at(a, b); positions.push(p[0], p[1], p[2]);
      const t = uv(a, b); uvs.push(t[0], t[1]);
      normals.push(normal[0], normal[1], normal[2]);
    }
    for (const [i, j, k] of faces) index.push(base + i, base + j, base + k);
  }
  const P = positions;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const ux = P[b * 3] - P[a * 3]; const uy = P[b * 3 + 1] - P[a * 3 + 1]; const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3]; const vy = P[c * 3 + 1] - P[a * 3 + 1]; const vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    if (nx * normal[0] + ny * normal[1] + nz * normal[2] < 0) { index[t + 1] = c; index[t + 2] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

// A sculpt ended at the plane z = plane, its rim pressed onto the plane so it meets the plate.
function trimmedAt(sculpt, plane, options = {}) {
  const margin = sculpt.cell * 1.6;
  const reach = 200;
  sculpt.sub({
    box: [-reach, -reach, plane + margin, reach, reach, plane + margin + reach],
    f: (x, y, z) => plane + margin - z,
  });
  const g = polygonize(sculpt, options);
  const p = g.attributes.position;
  const idx = g.index;
  const kept = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    if (p.getZ(a) >= plane && p.getZ(b) >= plane && p.getZ(c) >= plane) continue;
    kept.push(a, b, c);
  }
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > plane) p.setZ(i, plane);
  g.setIndex(kept);
  return g;
}

// The inside of a void: a sculpt of it, trimmed at the plane and turned inside out.
const hollowAt = (sculpt, plane, options) => flipped(trimmedAt(sculpt, plane, options));

// A distance field slice as a function of (a, b), from any sculpt's ops.
function sliceOf(ops, z) {
  return (x, y) => {
    let d = 1e9;
    for (const op of ops) {
      if (op.kind === 0) {
        const v = op.f(x, y, z);
        if (op.k > 0) {
          const h = Math.max(op.k - Math.abs(d - v), 0) / op.k;
          d = Math.min(d, v) - h * h * op.k * 0.25;
        } else if (v < d) d = v;
      } else if (op.kind === 1) {
        const c = -op.f(x, y, z);
        if (op.k > 0) {
          const h = Math.max(op.k - Math.abs(d - c), 0) / op.k;
          d = Math.max(d, c) + h * h * op.k * 0.25;
        } else if (c > d) d = c;
      } else if (d < 1e8) d = op.map(d, x, y, z);
    }
    return d;
  };
}

// A slow field read once onto a grid and bilinearly after that.
function gridded(f, [a0, b0, a1, b1], cell) {
  const na = Math.ceil((a1 - a0) / cell) + 1;
  const nb = Math.ceil((b1 - b0) / cell) + 1;
  const v = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = f(a0 + i * cell, b0 + j * cell);
  return (a, b) => {
    const x = Math.max(0, Math.min(na - 1.001, (a - a0) / cell));
    const y = Math.max(0, Math.min(nb - 1.001, (b - b0) / cell));
    const i = Math.floor(x); const j = Math.floor(y);
    const s = x - i; const t = y - j;
    const p = i + j * na;
    return (v[p] * (1 - s) + v[p + 1] * s) * (1 - t) + (v[p + na] * (1 - s) + v[p + na + 1] * s) * t;
  };
}

function pathLoops(ctx, loops, map) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}
function fillLoops(ctx, loops, map, style) {
  pathLoops(ctx, loops, map);
  if (style) ctx.fillStyle = style;
  ctx.fill('evenodd');
}
function traceLoops(ctx, loops, map, style, width) {
  pathLoops(ctx, loops, map);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}
function clipLoops(ctx, loops, map) {
  pathLoops(ctx, loops, map);
  ctx.clip('evenodd');
}

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

// One smooth body whose section is splined along z. Stations are [z, centreY, halfWidth, above, below],
// so a belly can hang deeper than a back without a second solid.
function axisLoft(stations) {
  const along = stations.map((s) => s[0]);
  const c = hermiteTable(along, stations.map((s) => s[1]));
  const w = hermiteTable(along, stations.map((s) => s[2]));
  const up = hermiteTable(along, stations.map((s) => s[3]));
  const dn = hermiteTable(along, stations.map((s) => s[4]));
  const a0 = along[0]; const a1 = along[along.length - 1];
  const wide = Math.max(...stations.map((s) => s[2]));
  const lo = Math.min(...stations.map((s) => s[1] - s[4]));
  const hi = Math.max(...stations.map((s) => s[1] + s[3]));
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
  const mapX = (v) => ax + (v - ax) * sx;
  const mapY = (v) => ay + (v - ay) * sy;
  const mapZ = (v) => az + (v - az) * sz;
  return {
    box: [mapX(b[0]), mapY(b[1]), mapZ(b[2]), mapX(b[3]), mapY(b[4]), mapZ(b[5])],
    f: (x, y, z) => prim.f(ax + (x - ax) / sx, ay + (y - ay) / sy, az + (z - az) / sz) * m,
  };
}

// The little plinth a specimen stands on: walnut with a brass line round it.
function plinth(parts, x0, x1, z0, z1, h = 0.32, { color = 0x5b3a24, trim = 0xb08d4e } = {}) {
  const hw = (x1 - x0) / 2; const hd = (z1 - z0) / 2;
  const slab = (w, d, r, y0, y1, c) => {
    const g = extrudeOutline(roundedOutline(w, d, r, 5), y1 - y0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parts.push({ geometry: g, color: c });
  };
  slab(hw, hd, 0.2, 0, h * 0.62, color);
  slab(hw - 0.04, hd - 0.04, 0.18, h * 0.62, h * 0.72, trim);
  slab(hw - 0.1, hd - 0.1, 0.14, h * 0.72, h, color);
}

// ---------------------------------------------------------------------------------------------
// Bone section
// ---------------------------------------------------------------------------------------------

// The upper end of a right thigh bone, sawn in half in the plane z = ZC and seen from the front, so the
// head points to the viewer's left (the body's midline) and the greater trochanter to the right.
//
// The numbers are a real femur's at about ten times life size, which is what puts this much of the bone
// in six feet: head 46mm across, neck 125 degrees off the shaft, shaft 28mm. Behind the plane it is a
// whole bone, carrying what only shows from behind: the lesser trochanter, the crest between the two
// trochanters and the linea aspera.
//
// THE LACE IS PAINTED PER TEXEL, as a Worley network whose cells are stretched along the line real
// trabeculae follow. Spongy bone is not random: its struts run along the lines of stress, fanning up from
// the thick inner wall of the neck into the top of the head (the compressive group) and arching over from
// the outer wall (the tensile group), crossing in a pointed arch with a sparse patch under it (Ward's
// triangle). Those two families are drawn over the lace, because that arch is what makes the section read
// as a femur and not as a sponge.
function boneSection() {
  const ZC = 0.35; const OX = 0.3;
  const P = (x, y, dz = 0) => [x + OX, y, ZC + dz];
  const rng = seededRandom(4401);
  const H = P(-1.15, 5.12); const R = 0.78;
  const OUT = [-0.82, 0.57];

  const T = new Sculpt(0.05);
  const IVORY = lin(0xe3d4b4);
  T.add(curveP([P(0, 0.15), P(0.03, 1.5), P(0.07, 2.6), P(0.12, 3.4)], [0.46, 0.46, 0.47, 0.56], 14), IVORY);
  T.add(ellipsoidP(P(0.25, 4.05), [0.78, 0.95, 0.62]), IVORY, { k: 0.4 });
  T.add(curveP([P(0.05, 4.3), P(-0.5, 4.68), P(-1.0, 5.02)], [0.62, 0.5, 0.52], 10), IVORY, { k: 0.3 });
  T.add(sphereP(H, R), IVORY, { k: 0.1 });
  T.add(ellipsoidP(P(0.74, 4.66), [0.56, 0.74, 0.62], [0, 0, -0.14]), IVORY, { k: 0.3 });
  // Behind the cut: the fossa behind the trochanter, the crest, the lesser trochanter and the linea aspera.
  T.sub(sphereP(P(0.3, 5.25, -0.42), 0.2), null, { k: 0.2 });
  T.add(curveP([P(0.92, 4.5, -0.52), P(0.4, 3.95, -0.56), P(-0.32, 3.5, -0.34)], [0.14, 0.13, 0.12], 10), IVORY, { k: 0.2 });
  T.add(ellipsoidP(P(-0.44, 3.42, -0.3), [0.25, 0.33, 0.24]), IVORY, { k: 0.18 });
  T.add(curveP([P(0, 0.15, -0.46), P(0.05, 2, -0.48), P(0.1, 3.3, -0.44)], 0.09, 12), IVORY, { k: 0.16 });
  // The fovea, the pit on the head where a small ligament holds it in the hip socket.
  T.sub(sphereP([H[0] - 0.93 * R, H[1] - 0.37 * R, ZC], 0.09), null, { k: 0.05 });
  T.sub({ box: [-9, -2, -9, 9, 0.15, 9], f: (x, y) => y - 0.15 });

  const X0 = -1.85; const X1 = 1.75; const Y0 = 0.05; const Y1 = 6.0;
  const outer = gridded(sliceOf(T.ops, ZC), [X0 - 0.1, Y0 - 0.1, X1 + 0.1, Y1 + 0.1], 0.02);

  // The medullary cavity, a shallow void running up the shaft and fading out in the neck of the bone.
  const V = new Sculpt(0.035);
  const MARROW_Y = lin(0xeab83c);
  V.add(squash(curveP([P(0, 0.4), P(0.02, 1.5), P(0.06, 2.5), P(0.09, 3.12)], [0.25, 0.25, 0.265, 0.2], 14), [1, 1, 0.55], [0, 0, ZC]), MARROW_Y);
  V.map((d, x, y) => d + (smoothNoise3(x * 5.5, y * 5.5, 3.1) - 0.5) * 0.05);
  const hollow = gridded(sliceOf(V.ops, ZC), [X0 - 0.1, Y0 - 0.1, X1 + 0.1, Y1 + 0.1], 0.012);
  const hollowG = hollowAt(V, ZC, {
    uvScale: 1.5,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      // Fat lobules, each a little domed cushion, darker in the crevices.
      const lob = Math.abs(smoothNoise3(x * 15, y * 11, z * 15) - 0.5) * 2;
      const k = (0.86 + 0.3 * sstep(lob, 0, 0.5)) * mix(1, 0.84, sstep(ZC - z, 0.02, 0.15));
      rgb[0] = 0.95 * k; rgb[1] = 0.62 * k; rgb[2] = 0.07 * k;
    },
  });

  // How thick the compact shell is at each point: a thick wall in the shaft, a thin shell at the ends,
  // and the extra-thick medial buttress under the neck (the calcar) that takes the body's weight.
  const cortexT = (x, y) => {
    const lx = x - OX;
    const calcar = (1 - sstep(lx, -0.28, 0.02)) * sstep(y, 3.0, 3.55) * (1 - sstep(y, 4.1, 4.75));
    return mix(0.205, 0.05, sstep(y, 2.95, 3.95)) + 0.12 * calcar;
  };
  const inner = (x, y) => outer(x, y) + cortexT(x, y);

  // --- The cut face --------------------------------------------------------------------------
  const plateLoops = contour((x, y) => Math.max(outer(x, y), -hollow(x, y)), [X0, Y0, X1, Y1], 0.016);
  const plateG = plate(plateLoops, (x, y) => [x, y, ZC], (x, y) => [(x - X0) / (X1 - X0), (y - Y0) / (Y1 - Y0)], [0, 0, 1]);
  const W = 1024; const PX = W / (X1 - X0); const HT = Math.round((Y1 - Y0) * PX);
  const map = (x, y) => [(x - X0) * PX, HT - (y - Y0) * PX];
  const region = (f, c = 0.014) => contour(f, [X0 - 0.05, Y0 - 0.05, X1 + 0.05, Y1 + 0.05], c);
  const hx = H[0]; const hy = H[1];
  // The direction the cells stretch along: fanning from the calcar in the head and neck, and from the
  // outer wall in the trochanter.
  const CAL = [OX - 0.42, 3.25]; const LAT = [OX + 0.55, 3.0];
  const density = (x, y) => {
    const lx = x - OX;
    let d = 0.72;
    d = mix(d, 0.95, 1 - sstep(Math.hypot(x - hx, y - hy), 0.55, 0.8)); // the head is the densest
    d = mix(d, 0.45, sstep(lx, 0.2, 0.7) * sstep(y, 3.9, 4.6)); // the trochanter is airier
    d = mix(d, 0.1, 1 - sstep(Math.hypot(lx - 0.02, (y - 4.22) * 0.9), 0.08, 0.3)); // Ward's triangle
    d *= sstep(y, 2.98, 3.42); // thinning out into the cavity
    return d;
  };
  const makeSeeds = (cell, seed) => {
    const r = seededRandom(seed);
    const nx = Math.ceil((X1 - X0) / cell) + 6; const ny = Math.ceil((Y1 - Y0) / cell) + 6;
    const data = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = (i + j * nx) * 3;
        data[k] = X0 + (i - 3 + 0.14 + 0.72 * r()) * cell; data[k + 1] = Y0 + (j - 3 + 0.14 + 0.72 * r()) * cell; data[k + 2] = r();
      }
    }
    return { cell, nx, ny, data };
  };
  const fine = makeSeeds(0.082, 4402); const coarse = makeSeeds(0.2, 4403);
  // F2 - F1 in a metric stretched along (ex, ey), which is near zero exactly on a cell boundary.
  const scratch = [0, 0];
  const worley = (S, x, y, ex, ey, stretch, reach) => {
    const ci = Math.floor((x - X0) / S.cell) + 3; const cj = Math.floor((y - Y0) / S.cell) + 3;
    let f1 = 1e9; let f2 = 1e9; let id = 0;
    for (let j = Math.max(0, cj - reach); j <= Math.min(S.ny - 1, cj + reach); j++) {
      for (let i = Math.max(0, ci - reach); i <= Math.min(S.nx - 1, ci + reach); i++) {
        const k = (i + j * S.nx) * 3;
        const dx = x - S.data[k]; const dy = y - S.data[k + 1];
        const a = (dx * ex + dy * ey) / stretch; const b = -dx * ey + dy * ex;
        const d = a * a + b * b;
        if (d < f1) { f2 = f1; f1 = d; id = S.data[k + 2]; } else if (d < f2) f2 = d;
      }
    }
    scratch[0] = Math.sqrt(f2) - Math.sqrt(f1); scratch[1] = id;
    return scratch;
  };
  const faceMap = canvasTexture(W, HT, (ctx) => {
    // --- The lace, per texel ---------------------------------------------------------
    const img = ctx.createImageData(W, HT);
    const data = img.data;
    for (let j = 0; j < HT; j++) {
      const y = Y1 - (j + 0.5) / PX;
      for (let i = 0; i < W; i++) {
        const x = X0 + (i + 0.5) / PX;
        const k = (i + j * W) * 4;
        data[k + 3] = 255;
        if (inner(x, y) > 0.03 || hollow(x, y) < -0.03) { data[k] = 168; data[k + 1] = 40; data[k + 2] = 44; continue; }
        const lx = x - OX;
        const towardTroch = sstep(lx, 0.05, 0.45);
        let ex = mix(x - CAL[0], x - LAT[0], towardTroch); let ey = mix(y - CAL[1], y - LAT[1], towardTroch);
        const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
        const dens = density(x, y);
        const wob = (smoothNoise3(x * 3.7, y * 3.7, 1.3) - 0.5) * 0.3;
        const eF = worley(fine, x, y, ex + wob * ey, ey - wob * ex, 1.55, 2);
        const fineE = eF[0]; const fineId = eF[1];
        const eC = worley(coarse, x, y, ex, ey, 1.25, 2);
        const coarseE = eC[0]; const coarseId = eC[1];
        const wF = 0.0155 * sstep(dens, 0.14, 0.62);
        const wC = 0.0105 + 0.006 * dens;
        const bone = Math.max(1 - coarseE / wC, wF > 0 ? 1 - fineE / wF : 0);
        if (bone > 0) {
          // A strut: pale along its spine and a warmer tan where it dips into the marrow.
          const s = sstep(bone, 0, 0.6);
          data[k] = mix(186, 242, s); data[k + 1] = mix(146, 230, s); data[k + 2] = mix(88, 196, s);
        } else {
          const near = Math.min(wF > 0 ? (fineE - wF) / 0.03 : 1, (coarseE - wC) / 0.03);
          const shade = clamp01(near);
          const tone = (dens > 0.2 ? fineId : coarseId) * 0.32 + 0.82;
          const v = mix(0.62, 1, shade) * tone;
          data[k] = 186 * v; data[k + 1] = 34 * v; data[k + 2] = 42 * v;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // --- The two stress families, over the lace ---------------------------------------
    const strut = (pts, wid, tone = '#efe3c2') => {
      // A wandering stroke whose width changes along it, which is what stops it reading as a ruled line.
      ctx.lineCap = 'round';
      ctx.strokeStyle = tone;
      const n = 22;
      const curve = new THREE.CatmullRomCurve3(pts.map(([a, b]) => new THREE.Vector3(a, b, 0)));
      let px = null;
      for (let i = 0; i <= n; i++) {
        const v = curve.getPoint(i / n);
        const a = v.x + (rng() - 0.5) * 0.012; const b = v.y + (rng() - 0.5) * 0.012;
        const [mx, my] = map(a, b);
        if (px) {
          ctx.lineWidth = wid * (0.7 + 0.6 * rng());
          ctx.beginPath(); ctx.moveTo(px[0], px[1]); ctx.lineTo(mx, my); ctx.stroke();
        }
        px = [mx, my];
      }
    };
    ctx.save();
    clipLoops(ctx, region(inner), map);
    // The compressive group: from the calcar straight up into the weight-bearing top of the head.
    for (let i = 0; i < 13; i++) {
      const t = i / 12;
      const a0 = OX - 0.58 + t * 0.42; const b0 = 3.7 + t * 0.34;
      const ang = mix(2.75, 0.85, t);
      const ex = hx + Math.cos(ang) * 0.68; const ey = hy + Math.sin(ang) * 0.68;
      strut([[a0, b0], [mix(a0, ex, 0.5) + 0.03, mix(b0, ey, 0.5)], [ex, ey]], 2.4 + 1.4 * Math.sin(t * Math.PI));
    }
    // The tensile group: arching from the outer wall, under the top of the neck and into the head.
    for (let i = 0; i < 11; i++) {
      const t = i / 10;
      const a0 = OX + 0.5 - t * 0.02; const b0 = 3.35 + t * 0.85;
      const top = 4.95 + t * 0.32;
      strut([[a0, b0], [OX + 0.12, mix(4.32, 4.86, t)], [OX - 0.46, top - 0.02], [hx + 0.2, hy - 0.14 + t * 0.34], [hx - 0.68 * Math.cos(0.5 - t * 0.9), hy - 0.68 * Math.sin(0.5 - t * 0.9)]], 2.2 + 1.3 * Math.sin(t * Math.PI));
    }
    // The trochanter's own group, running up from the outer wall.
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      strut([[OX + 0.3 + t * 0.5, 3.72 + t * 0.3], [OX + 0.4 + t * 0.62, 4.5], [OX + 0.34 + t * 0.82, 5.2]], 2.2);
    }
    // The growth plate's scar, a thin dense line across the head and the trochanter, left from childhood.
    ctx.lineCap = 'round';
    const scar = (pts) => strut(pts, 3.4, '#f4ebd2');
    scar([[hx + 0.66, hy + 0.28], [hx + 0.42, hy - 0.02], [hx + 0.18, hy - 0.36], [hx + 0.02, hy - 0.62]]);
    ctx.restore();

    // --- Compact bone ------------------------------------------------------------------
    const cortexLoops = region((x, y) => Math.max(outer(x, y), -inner(x, y)));
    fillLoops(ctx, cortexLoops, map, '#ece1c6');
    ctx.save();
    clipLoops(ctx, cortexLoops, map);
    // In a lengthwise cut the osteons lie along the bone, so their canals show as long thin lines rather
    // than as the rings a cut across the shaft shows, each flanked by the faint lines of its lamellae.
    for (let i = 0; i < 620; i++) {
      const x = mix(X0, X1, rng()); const y = mix(0.3, 4.9, rng());
      if (outer(x, y) > -0.05 || inner(x, y) < 0.02) continue;
      const L = (0.12 + rng() * 0.3) * PX;
      const lean = (rng() - 0.5) * 0.09;
      const [a, b] = map(x, y);
      ctx.strokeStyle = 'rgba(165,132,86,0.42)'; ctx.lineWidth = 1.1;
      for (const off of [-3.4, 3.4]) { ctx.beginPath(); ctx.moveTo(a + off, b - L / 2); ctx.lineTo(a + off + lean * L, b + L / 2); ctx.stroke(); }
      ctx.strokeStyle = 'rgba(150,62,58,0.82)'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.moveTo(a, b - L / 2 + 3); ctx.lineTo(a + lean * L, b + L / 2 - 3); ctx.stroke();
    }
    // The nutrient canal, the slot the vessels climb through.
    ctx.strokeStyle = '#5c2a22'; ctx.lineCap = 'round'; ctx.lineWidth = 0.21 * PX;
    ctx.beginPath();
    for (const [i, [a, b]] of [[-0.62, 1.68], [-0.42, 1.98], [-0.2, 2.3]].entries()) { const [mx, my] = map(a + OX, b); if (i) ctx.lineTo(mx, my); else ctx.moveTo(mx, my); }
    ctx.stroke();
    // Lamellae running parallel to the surface, and a slightly darker line where the shell meets the lace.
    for (const off of [0.05, 0.09]) traceLoops(ctx, region((x, y) => outer(x, y) + off, 0.02), map, 'rgba(176,150,104,0.38)', 1.2);
    ctx.restore();
    traceLoops(ctx, region(inner, 0.016), map, 'rgba(120,70,50,0.55)', 1.8);

    // --- The membrane, the cartilage cap, the cavity's edge ----------------------------
    const outerLoops = region(outer, 0.012);
    fillLoops(ctx, region((x, y) => Math.max(outer(x, y), -(outer(x, y) + 0.038)), 0.012), map, '#cf6d58');
    const tc = (x, y) => {
      const lx = x - hx; const ly = y - hy;
      return 0.105 * sstep(lx * OUT[0] + ly * OUT[1], -0.34, 0.06);
    };
    const cartF = (x, y) => Math.max(outer(x, y), -(outer(x, y) + tc(x, y)));
    fillLoops(ctx, region(cartF, 0.012), map, '#dceff6');
    ctx.save();
    clipLoops(ctx, region(cartF, 0.012), map);
    traceLoops(ctx, region((x, y) => outer(x, y) + 0.05, 0.016), map, 'rgba(140,175,190,0.5)', 1.2);
    ctx.restore();
    traceLoops(ctx, region(hollow, 0.012), map, 'rgba(120,70,30,0.8)', 2.6);
    traceLoops(ctx, outerLoops, map, 'rgba(90,40,30,0.45)', 1.4);
  });

  // --- The whole bone behind ------------------------------------------------------------------
  const field = T.snapshot();
  const backG = trimmedAt(T, ZC, {
    uvScale: 2.1,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const dx = x - hx; const dy = y - hy; const dz = z - ZC;
      const r = Math.hypot(dx, dy, dz);
      const cart = sstep((dx * OUT[0] + dy * OUT[1]) / Math.max(0.01, r) * R, -0.3, -0.2) * (1 - sstep(r, R + 0.03, R + 0.08));
      const n = smoothNoise3(x * 2.2, y * 2.2, z * 2.2);
      const n2 = smoothNoise3(x * 6, y * 3, z * 6);
      const warm = 0.9 + 0.2 * n;
      // The living surface is a pale pinkish cream, a little warmer along the muscle attachments.
      rgb[0] = mix(0.76 * warm, 0.66, cart); rgb[1] = mix(0.6 * warm, 0.76, cart); rgb[2] = mix(0.42 * warm * (0.92 + 0.14 * n2), 0.8, cart);
    },
  });

  // --- The nutrient vessels, real and half sunk in the plate -----------------------------------
  const soft = [];
  const lay = (points, radii, color, sides = 9) => soft.push({ geometry: tube(points, radii, { sides, steps: (points.length - 1) * 5, round: 2 }), color });
  const ART = 0xd8222a; const VEIN = 0x2c50b8;
  // They come up from below, reach the bone's inner edge and climb through the wall into the cavity: a
  // thigh bone's nutrient canal really does slope upward, away from the knee.
  const bundle = (off, r, col) => {
    lay([P(-1.05 + off, 0.3, 0.05), P(-1.02 + off, 0.82, 0.1), P(-0.82 + off * 0.8, 1.3, 0.08), P(-0.5 + off * 0.3, 1.74 + off * 0.3, 0.02), P(-0.34, 1.98 + off * 0.8, -0.005), P(-0.2, 2.22 + off * 0.8, -0.02)], [r * 1.1, r * 1.05, r, r * 0.92, r * 0.8, r * 0.7], col);
  };
  bundle(0, 0.052, ART);
  bundle(0.11, 0.056, VEIN);
  // Inside the cavity they branch up and down across the marrow.
  const cav = (x, y, d = -0.02) => P(x, y, d);
  lay([cav(-0.2, 2.22), cav(-0.1, 2.5, -0.06), cav(0.02, 2.75, -0.08), cav(0.08, 3.02, -0.05)], [0.034, 0.03, 0.026, 0.016], ART);
  lay([cav(-0.2, 2.22), cav(-0.08, 1.9, -0.06), cav(-0.03, 1.5, -0.08), cav(0.04, 1.02, -0.06)], [0.034, 0.03, 0.026, 0.016], ART);
  lay([cav(-0.2, 2.308), cav(-0.02, 2.5, -0.05), cav(0.14, 2.62, -0.07)], [0.036, 0.026, 0.014], VEIN);
  lay([cav(-0.2, 2.308), cav(-0.02, 2.0, -0.05), cav(0.12, 1.7, -0.07)], [0.036, 0.026, 0.014], VEIN);
  lay([cav(-0.04, 1.48, -0.08), cav(-0.16, 1.2, -0.05), cav(-0.18, 0.92, -0.03)], [0.022, 0.018, 0.012], ART);
  // Fine periosteal vessels creeping over the back of the shaft.
  for (const [pts, r, col] of [
    [[P(0.4, 0.8, -0.3), P(0.32, 1.6, -0.36), P(0.42, 2.4, -0.3), P(0.34, 3.2, -0.38)], 0.018, ART],
    [[P(-0.3, 1.1, -0.3), P(-0.24, 1.9, -0.35), P(-0.34, 2.8, -0.26)], 0.016, ART],
    [[P(0.28, 1.4, -0.38), P(0.42, 2.0, -0.28), P(0.36, 2.9, -0.34)], 0.014, VEIN],
  ]) {
    const path = pathOn(field, pts, 18, -0.002);
    lay(path, r, col, 6);
  }

  // --- Assembly -----------------------------------------------------------------------------
  const wood = [];
  plinth(wood, -2.1, 2.1, -1.25, 1.35, 0.36);
  const collarX = OX + 0.02;
  wood.push({
    geometry: lathe([[0, 0.3], [0.8, 0.3], [0.8, 0.4], [0.72, 0.46], [0.66, 0.5], [0.62, 0.66], [0.66, 0.72], [0.6, 0.76], [0, 0.76]], 48).translate(collarX, 0, ZC),
    color: 0xb08d4e,
  });

  const root = new THREE.Group();
  root.name = 'bone-section';
  root.add(mesh(mergeParts([{ geometry: plateG, color: 0xffffff }]), standard({ map: faceMap, bumpMap: faceMap, bumpScale: 1.4, roughness: 0.62, metalness: 0 })));
  const grain = grainBump(4404, { size: 256, dots: 1800, contrast: 0.35 });
  grain.repeat.set(1, 1);
  root.add(mesh(mergeParts([{ geometry: backG, keepColor: true }, { geometry: hollowG, keepColor: true }]), standard({ vertexColors: true, roughness: 0.56, metalness: 0, bumpMap: grain, bumpScale: 0.5 })));
  root.add(mesh(mergeParts([...soft, ...wood]), standard({ vertexColors: true, roughness: 0.44, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Blood vessel
// ---------------------------------------------------------------------------------------------

// Long parallel streaks, near white, for anything with a grain.
function streakMap(seed, { size = 256, lines = 300, dark = 150, alpha = 0.5, base = '#f0f0f0', bow = 8 } = {}) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i++) {
      const x = rng() * w;
      const light = rng() > 0.55;
      const v = light ? 255 : dark;
      ctx.strokeStyle = `rgba(${v},${v},${v},${(0.3 + rng() * 0.7) * alpha})`;
      ctx.lineWidth = 0.7 + rng() * 2;
      const b = (rng() - 0.5) * bow;
      for (const off of [-w, 0, w]) {
        ctx.beginPath();
        ctx.moveTo(x + off, 0); ctx.quadraticCurveTo(x + off + b, h / 2, x + off, h);
        ctx.stroke();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// A grid of quads whose facing is MEASURED against `want(i, j)` rather than assumed, since the handedness
// of a (row, column) order is exactly the thing that comes out wrong.
function strip(rows, cols, point, want, uv = null) {
  const positions = []; const uvs = []; const index = [];
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const p = point(i / rows, j / cols);
      positions.push(p[0], p[1], p[2]);
      const t = uv ? uv(i / rows, j / cols) : [j / cols, i / rows];
      uvs.push(t[0], t[1]);
    }
  }
  const w = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * w + j; const b = a + 1; const c = a + w + 1; const d = a + w;
      index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  const P = g.attributes.position;
  const mid = (Math.floor(rows / 2) * w) + Math.floor(cols / 2);
  const a = V3([P.getX(mid), P.getY(mid), P.getZ(mid)]);
  const b = V3([P.getX(mid + 1), P.getY(mid + 1), P.getZ(mid + 1)]).sub(a);
  const c = V3([P.getX(mid + w + 1), P.getY(mid + w + 1), P.getZ(mid + w + 1)]).sub(a);
  const n = b.cross(c);
  const wantDir = V3(want(a.x, a.y, a.z));
  if (n.dot(wantDir) < 0) {
    const idx = g.index;
    for (let t = 0; t < idx.count; t += 3) { const q = idx.getX(t + 1); idx.setX(t + 1, idx.getX(t + 2)); idx.setX(t + 2, q); }
  }
  g.computeVertexNormals();
  return g;
}

// Evans and Fung's measured outline of a red cell: z = (R/2) sqrt(1 - p^2) (0.207 + 2.003 p^2 - 1.123 p^4).
// It is the real biconcave shape, written as a formula, so the dimple cannot come out as a bead.
function redCellGeometry(R, segments = 20) {
  const half = (p) => (R / 2) * Math.sqrt(Math.max(0, 1 - p * p)) * (0.207 + 2.003 * p * p - 1.123 * p ** 4);
  const steps = [0.22, 0.44, 0.64, 0.8, 0.92, 0.98];
  const prof = [[0, -half(0)]];
  for (const p of steps) prof.push([R * p, -half(p)]);
  prof.push([R, 0]);
  for (let i = steps.length - 1; i >= 0; i--) prof.push([R * steps[i], half(steps[i])]);
  prof.push([0, half(0)]);
  const g = lathe(prof, segments);
  const RIM = lin(0xb80f1c); const DIMPLE = lin(0xe63a48);
  tintVertices(g, (x, y, z, out) => {
    const t = 1 - sstep(Math.hypot(x, z) / R, 0.16, 0.66);
    out[0] = mix(RIM[0], DIMPLE[0], t); out[1] = mix(RIM[1], DIMPLE[1], t); out[2] = mix(RIM[2], DIMPLE[2], t);
  });
  return g;
}

// A white cell: a ball with its surface folded into ruffles. Every vertex is pushed along its own
// direction by a function of that direction, so a shared corner cannot tear.
function whiteCellGeometry(R, seed) {
  const rng = seededRandom(seed);
  const base = smoothed(new THREE.IcosahedronGeometry(1, 11));
  const bumps = [];
  for (let i = 0; i < 74; i++) {
    const y = 1 - (2 * (i + 0.5)) / 74; const r = Math.sqrt(1 - y * y); const a = i * 2.39996 + rng() * 0.5;
    bumps.push([r * Math.cos(a) + (rng() - 0.5) * 0.16, y + (rng() - 0.5) * 0.16, r * Math.sin(a) + (rng() - 0.5) * 0.16, 0.13 + rng() * 0.08, 0.05 + rng() * 0.05]);
  }
  const P = base.attributes.position;
  const col = new Float32Array(P.count * 3);
  const LIGHT = lin(0xeeebe6); const DEEP = lin(0xbdb0c4);
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const l = Math.hypot(x, y, z) || 1; const dx = x / l; const dy = y / l; const dz = z / l;
    let h = 0;
    for (const [bx, by, bz, w, amp] of bumps) {
      const d = Math.hypot(dx - bx, dy - by, dz - bz);
      if (d < w * 2.4) h += amp * Math.exp(-(d * d) / (w * w));
    }
    const lump = (smoothNoise3(dx * 1.7 + seed, dy * 1.7, dz * 1.7) - 0.5) * 0.2;
    const r = (1 + h + lump) * R;
    P.setXYZ(i, dx * r, dy * r, dz * r);
    const t = sstep(h, 0.015, 0.075);
    col[i * 3] = mix(DEEP[0], LIGHT[0], t); col[i * 3 + 1] = mix(DEEP[1], LIGHT[1], t); col[i * 3 + 2] = mix(DEEP[2], LIGHT[2], t);
  }
  base.setAttribute('color', new THREE.BufferAttribute(col, 3));
  base.computeVertexNormals();
  return base;
}

// A platelet is a scrap of cell, not a cell: a flattened irregular fragment, here with the short spines
// it puts out when it activates.
function plateletGeometry(R, seed) {
  const rng = seededRandom(seed);
  const base = smoothed(new THREE.IcosahedronGeometry(1, 3));
  const P = base.attributes.position;
  const spines = [];
  for (let i = 0; i < 5; i++) {
    const a = rng() * Math.PI * 2;
    spines.push([Math.cos(a), (rng() - 0.5) * 0.4, Math.sin(a)]);
  }
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const l = Math.hypot(x, y, z) || 1; const dx = x / l; const dy = y / l; const dz = z / l;
    let h = (smoothNoise3(dx * 1.6 + seed, dy * 1.6, dz * 1.6) - 0.5) * 0.3;
    for (const [bx, by, bz] of spines) h += 0.3 * Math.exp(-((dx - bx) ** 2 + (dy - by) ** 2 + (dz - bz) ** 2) / 0.12);
    const r = (1 + h) * R;
    P.setXYZ(i, dx * r, dy * r * 0.55, dz * r);
  }
  base.computeVertexNormals();
  return base;
}

// A fibre tile: short wavy strands crossing at a shallow angle, the way collagen lies, near white so the
// vertex colours keep the hue. Straight parallel streaks on a tan tube read as wood.
function fibreMap(seed) {
  const texture = canvasTexture(256, 256, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 620; i++) {
      const x = rng() * w; const y = rng() * h; const a = (rng() > 0.5 ? 0.32 : -0.32) + (rng() - 0.5) * 0.3;
      const L = 18 + rng() * 40;
      const v = rng() > 0.5 ? 255 : 196;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.4})`;
      ctx.lineWidth = 0.8 + rng() * 1.3;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.moveTo(x + ox, y + oy);
          ctx.quadraticCurveTo(x + ox + (Math.cos(a) * L) / 2 + 3, y + oy + (Math.sin(a) * L) / 2 - 3, x + ox + Math.cos(a) * L, y + oy + Math.sin(a) * L);
          ctx.stroke();
        }
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Each point flagged true is a hard corner: an extruded outline shares one vertex per point along its side
// band, so a plain corner smears the two wall normals into a pillow unless it is doubled.
function crisp(points, eps = 0.004) {
  const n = points.length; const out = [];
  points.forEach((p, i) => {
    if (!p[2]) { out.push([p[0], p[1]]); return; }
    const a = points[(i + n - 1) % n]; const b = points[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1; const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    out.push([p[0] + ((a[0] - p[0]) / la) * eps, p[1] + ((a[1] - p[1]) / la) * eps]);
    out.push([p[0] + ((b[0] - p[0]) / lb) * eps, p[1] + ((b[1] - p[1]) / lb) * eps]);
  });
  return out;
}

// An artery cut open along its length, lying along X, the cut toward the viewer and tipped up so the floor
// can be seen. The wall is one closed solid in three colours: the seen surfaces are the lining and the
// outer coat, and the three layers show where they should, on the cut. The cells are NOT to scale with the
// vessel, as the card says: at this size a real artery a foot across would hold millions.
const VESSEL = { L: 12, rI: 1.62, rM: 1.72, rA: 2.2, rO: 2.44, YC: 3.08, A0: THREE.MathUtils.degToRad(102), A1: THREE.MathUtils.degToRad(318) };

function bloodVessel() {
  const { L, rI, rM, rA, rO, YC, A0, A1 } = VESSEL;
  const rng = seededRandom(5501);
  const warp = (x, a) => 0.04 * Math.sin(0.62 * x + 0.4) + 0.034 * Math.sin(1.3 * x + 2.1) + 0.02 * Math.sin(a * 3 + x * 0.5);
  const at = (x, a, r) => { const q = r + warp(x, a); return [x, YC + q * Math.sin(a), q * Math.cos(a)]; };
  const X = (t) => (t - 0.5) * L;
  const AN = (t) => mix(A0, A1, t);
  const NX = 36; const NA = 48;
  const parts = [];

  const INTIMA = lin(0xf7e6e0); const LINING = lin(0xf1b7b2); const YEL = lin(0xf0c84e); const MEDIA = lin(0xdf5f73); const MEDIA_D = lin(0xc2445e); const ADV = lin(0xefd9bd); const ADV_D = lin(0xdcb79c);
  const outFromAxis = (x, y, z) => [0, y - YC, z];
  const towardAxis = (x, y, z) => [0, YC - y, -z];
  // The lining, smooth and pale, going to the straw of plasma across the floor.
  const lining = strip(NX, NA, (u, v) => at(X(u), AN(v), rI), towardAxis, () => [0.001, 0.001]);
  tintVertices(lining, (x, y, z, out) => {
    const a = Math.atan2(y - YC, z);
    const floor = sstep(Math.cos(a + Math.PI / 2), 0.25, 0.8);
    const ripple = 0.97 + 0.05 * smoothNoise3(x * 0.8, y * 2, z * 2);
    out[0] = mix(LINING[0], YEL[0], floor) * ripple; out[1] = mix(LINING[1], YEL[1], floor) * ripple; out[2] = mix(LINING[2], YEL[2], floor) * ripple;
  });
  parts.push({ geometry: lining, keepColor: true });
  // The tough outer coat.
  const outer = strip(NX, NA, (u, v) => at(X(u), AN(v), rO), outFromAxis, (u, v) => [u * 6, v * 5]);
  tintVertices(outer, (x, y, z, out) => {
    const n = smoothNoise3(x * 1.4, y * 1.6, z * 1.6);
    out[0] = mix(ADV_D[0], ADV[0], n); out[1] = mix(ADV_D[1], ADV[1], n); out[2] = mix(ADV_D[2], ADV[2], n);
  });
  parts.push({ geometry: outer, keepColor: true });
  // The two long cuts and the two ends, each showing the three layers as three separate bands.
  const LAYERS = [[rI, rM, INTIMA, INTIMA, 1], [rM, rA, MEDIA, MEDIA_D, 3], [rA, rO, ADV, ADV_D, 1]];
  for (const [r0, r1, c0, c1, cols] of LAYERS) {
    const paint = (g) => tintVertices(g, (x, y, z, out) => {
      const n = smoothNoise3(x * 3.1, y * 5, z * 5);
      out[0] = mix(c1[0], c0[0], n); out[1] = mix(c1[1], c0[1], n); out[2] = mix(c1[2], c0[2], n);
    });
    for (const [A, sign] of [[A0, -1], [A1, 1]]) {
      const tan = [0, Math.cos(A) * sign, -Math.sin(A) * sign];
      parts.push({ geometry: paint(strip(NX, cols, (u, v) => at(X(u), A, mix(r0, r1, v)), () => tan, (u, v) => [u * 8, v * (r1 - r0) * 2])), keepColor: true });
    }
    for (const sx of [-1, 1]) {
      parts.push({ geometry: paint(strip(NA, cols, (u, v) => at((sx * L) / 2, AN(u), mix(r0, r1, v)), () => [sx, 0, 0], (u, v) => [v * (r1 - r0) * 2, u * 5])), keepColor: true });
    }
  }

  // --- The vessels that feed the wall itself, on the outside ------------------------------------
  const vasa = [];
  const onOuter = (x, a) => at(x, a, rO - 0.008);
  const runs = [
    [[-5.2, 3.4], [-3.4, 3.2], [-1.6, 3.5], [0.2, 3.25]],
    [[-3.4, 3.2], [-2.8, 2.8], [-2.2, 2.65]],
    [[-1.6, 3.5], [-1.2, 3.9], [-0.6, 4.1]],
    [[1.4, 2.6], [2.8, 2.9], [4.2, 2.65], [5.6, 2.9]],
    [[2.8, 2.9], [3.3, 3.3], [3.9, 3.45]],
    [[4.2, 2.65], [4.5, 2.3], [5.1, 2.2]],
    [[-4.6, 4.5], [-3, 4.7], [-1.2, 4.55]],
    [[0.8, 4.6], [2.2, 4.85], [3.8, 4.6]],
  ];
  runs.forEach((run, i) => {
    const { P } = sampleCurve(run.map(([x, a]) => onOuter(x, a)), 1, run.length * 6);
    const Q = P.map(([x, y, z]) => onOuter(x, Math.atan2(y - YC, z) < 0 ? Math.atan2(y - YC, z) + Math.PI * 2 : Math.atan2(y - YC, z)));
    const r = run.length > 3 ? 0.038 : 0.024;
    vasa.push({ geometry: tube(Q, [r, r * 0.9, r * 0.6], { sides: 7, steps: Q.length, round: 1 }), color: i % 3 === 2 ? 0x34509c : 0xc4232c });
  });

  // --- The cells ---------------------------------------------------------------------------------
  const placed = []; // [x, y, z, boundingRadius]
  const clear = (c, r) => placed.every((o) => Math.hypot(c[0] - o[0], c[1] - o[1], c[2] - o[2]) > r + o[3] + 0.02);
  const wallAt = (x, y, z) => rI + warp(x, Math.atan2(y - YC, z));
  // Measured on the object's own rim, so a disc tilted toward the wall cannot poke through it.
  const fits = (c, q, R, thick) => {
    const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q); const v = new THREE.Vector3(0, 0, 1).applyQuaternion(q); const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const s of [-1, 1]) {
        const x = c[0] + (u.x * Math.cos(a) + v.x * Math.sin(a)) * R + n.x * thick * s;
        const y = c[1] + (u.y * Math.cos(a) + v.y * Math.sin(a)) * R + n.y * thick * s;
        const z = c[2] + (u.z * Math.cos(a) + v.z * Math.sin(a)) * R + n.z * thick * s;
        if (Math.hypot(y - YC, z) > wallAt(x, y, z) - 0.03) return false;
      }
    }
    return Math.abs(c[0]) + R < L / 2 - 0.1;
  };
  const cells = [];
  const white = [];
  const small = [];
  const RC = 0.46;
  const redT = redCellGeometry(RC);
  const pushRed = (c, q, k = 1) => {
    const g = redT.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(V3(c), q, new THREE.Vector3(k, k, k)));
    cells.push({ geometry: g, keepColor: true });
  };
  // Five white cells first, where they can be found: one resting on the floor, the rest in the stream.
  [[-0.6, 2.0, 1.02, 0.68, 0.86], [2.45, 0.2, 0.3, 0.62, 1.0], [4.5, 2.25, 0.66, 0.6, 1.0], [-4.3, 0.3, -0.5, 0.6, 1.0], [1.35, 1.35, -0.72, 0.64, 1.0]].forEach(([x, dy, dz, R, flat], i) => {
    const g = whiteCellGeometry(R, 5510 + i);
    const y = i === 0 ? YC - rI + R * 0.86 + 0.14 : YC + dy - (i === 2 ? 2.25 : 0) + (i === 2 ? -0.08 : 0) - (i === 4 ? 0.2 : 0);
    const z = i === 0 ? 0.25 : dz;
    if (flat !== 1) g.scale(1, flat, 1);
    g.translate(x, y, z);
    white.push({ geometry: g, keepColor: true });
    placed.push([x, y, z, R * 1.2]);
  });
  const randomQ = (flatTo = null) => {
    if (flatTo) return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), flatTo);
    const e = new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2);
    return new THREE.Quaternion().setFromEuler(e);
  };
  const BOUND = RC * 1.02;
  let reds = 0;
  // A rouleau, the stack red cells really do form when the flow slows.
  {
    const c0 = [-3.0, YC + 0.1, 0.2];
    const n = new THREE.Vector3(0.82, 0.24, 0.5).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    for (let i = 0; i < 5; i++) {
      const c = [c0[0] + n.x * i * 0.27, c0[1] + n.y * i * 0.27, c0[2] + n.z * i * 0.27];
      pushRed(c, q); reds += 1;
    }
    placed.push([c0[0] + n.x * 0.54, c0[1] + n.y * 0.54, c0[2] + n.z * 0.54, 0.86]);
  }
  // A dozen lying on the floor, each tilted to the wall under it.
  for (let i = 0, guard = 0; i < 12 && guard < 900; guard++) {
    const x = mix(-5.3, 5.3, rng());
    const a = -Math.PI / 2 + (rng() - 0.5) * 2.05;
    const wall = rI + warp(x, a);
    const n = new THREE.Vector3(0, -Math.sin(a), -Math.cos(a));
    const up = new THREE.Vector3((rng() - 0.5) * 0.4, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.3).add(n).normalize();
    const c = [x, YC + (wall - 0.2 - rng() * 0.05) * Math.sin(a), (wall - 0.2 - rng() * 0.05) * Math.cos(a)];
    const q = randomQ(up);
    if (!clear(c, BOUND) || !fits(c, q, RC, 0.15)) continue;
    pushRed(c, q);
    placed.push([c[0], c[1], c[2], BOUND]);
    i += 1; reds += 1;
  }
  // The rest in the stream, at every angle.
  for (let guard = 0; reds < 40 && guard < 9000; guard++) {
    const x = mix(-5.4, 5.4, rng());
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (rI - 0.3);
    const c = [x, YC + r * Math.sin(a) - 0.1, r * Math.cos(a)];
    if (c[1] > YC + 0.8) continue;
    const q = randomQ();
    if (!clear(c, BOUND) || !fits(c, q, RC, 0.15)) continue;
    pushRed(c, q);
    placed.push([c[0], c[1], c[2], BOUND]);
    reds += 1;
  }
  // Twelve platelets, drifting and a few gathered on the wall, which is where they do their work.
  for (let i = 0, guard = 0; i < 12 && guard < 2000; guard++) {
    const x = mix(-5.4, 5.4, rng());
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (rI - 0.3);
    const c = i < 4 ? [x, YC + 1.32 * Math.sin(-1.9 + (rng() - 0.5) * 1.2), 1.32 * Math.cos(-1.9 + (rng() - 0.5) * 1.2)] : [x, YC + r * Math.sin(a) - 0.1, r * Math.cos(a)];
    if (c[1] > YC + 0.9) continue;
    const R = 0.14 + rng() * 0.035;
    if (!clear(c, R * 1.4) || Math.hypot(c[1] - YC, c[2]) + R * 1.4 > wallAt(c[0], c[1], c[2]) - 0.02) continue;
    const g = plateletGeometry(R, 5530 + i);
    g.applyQuaternion(randomQ());
    g.translate(c[0], c[1], c[2]);
    small.push({ geometry: g, color: 0xf0a31e });
    placed.push([c[0], c[1], c[2], R * 1.7]);
    i += 1;
  }

  // --- The plasma: a shallow pool lying in the floor ----------------------------------------------
  const levelY = YC - rI + 0.26;
  const poolOutline = [];
  const half = Math.acos((YC - levelY) / (rI - 0.02));
  for (let i = 0; i <= 28; i++) {
    const a = -Math.PI / 2 - half + (i / 28) * 2 * half;
    poolOutline.push([-(rI - 0.02) * Math.cos(a), YC + (rI - 0.02) * Math.sin(a)]);
  }
  const poolG = outward(extrudeOutline(poolOutline, L - 0.02).rotateY(Math.PI / 2));

  // --- The cradle ---------------------------------------------------------------------------------
  const wood = [];
  const base = extrudeOutline(roundedOutline(6.5, 2.35, 0.25, 5), 0.16).rotateX(-Math.PI / 2).translate(0, 0.08, 0);
  wood.push({ geometry: base, color: 0x5b3a24 });
  const rc = rO + 0.09;
  for (const x of [-4.1, 0, 4.1]) {
    const a0 = THREE.MathUtils.degToRad(40);
    const reach = rc * Math.sin(a0);
    const top = YC - rc * Math.cos(a0);
    const outline = [[-2.2, 0.14, true], [2.2, 0.14, true], [2.2, top, true], [reach, top, true]];
    for (let i = 1; i < 24; i++) {
      const a = a0 - (i / 24) * 2 * a0;
      outline.push([rc * Math.sin(a), YC - rc * Math.cos(a)]);
    }
    outline.push([-reach, top, true], [-2.2, top, true]);
    wood.push({ geometry: outward(extrudeOutline(crisp(outline), 0.9).rotateY(Math.PI / 2).translate(x, 0, 0)), color: 0x7a4f30 });
    // Two brass bolts through the foot of each saddle.
    for (const z of [-1.8, 1.8]) wood.push({ geometry: lathe([[0, 0.14], [0.13, 0.14], [0.13, 0.2], [0.09, 0.24], [0, 0.24]], 14).translate(x + 0.58, 0, z), color: 0xb08d4e });
  }

  const root = new THREE.Group();
  root.name = 'blood-vessel';
  const fibre = fibreMap(5502);
  root.add(mesh(mergeParts(parts), standard({ vertexColors: true, map: fibre, bumpMap: fibre, bumpScale: 0.5, roughness: 0.46, metalness: 0 })));
  root.add(mesh(mergeParts([...cells, ...small, ...vasa]), standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  root.add(mesh(mergeParts(white), standard({ vertexColors: true, roughness: 0.62, metalness: 0 })));
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, roughness: 0.58, metalness: 0 })));
  const plasma = mesh(mergeParts([{ geometry: poolG, color: 0xefc758 }]), standard({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, roughness: 0.18, metalness: 0 }));
  plasma.castShadow = false;
  root.add(plasma);
  return root;
}

// ---------------------------------------------------------------------------------------------
// Beehive
// ---------------------------------------------------------------------------------------------

// The comb's cells, in pixels of paint. A real cell is 5.3mm across its flats, and at four times
// life size that is 0.07ft. The rows run across the frame with a point of each hexagon up, which is how a
// bee builds them, and the odd rows are shifted by exactly half a pitch. Exported so the regularity can be
// asserted by arithmetic and not only by looking.
export const COMB = { W: 2048, H: 958, PITCH: 28 };
export function combCentres() {
  const { W, H, PITCH } = COMB;
  const rowH = (PITCH * Math.sqrt(3)) / 2;
  const out = [];
  const rows = Math.ceil(H / rowH) + 1;
  const cols = Math.ceil(W / PITCH) + 2;
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c < cols; c++) out.push([(c + (r % 2 ? 0.5 : 0)) * PITCH, (r + 0.5) * rowH, r, c]);
  }
  return out;
}

// What is in a cell, from where it is on the comb: the brood nest in the middle with its oldest (capped)
// brood at the centre, a band of pollen round it, and honey up in the top corners, where the bees store it
// furthest from the nest and highest in the hive.
function combZone(nu, nv, rng) {
  const wob = (smoothNoise3(nu * 3.1 + 7, nv * 3.1, 2.2) - 0.5) * 0.24;
  const e = Math.hypot(nu / 0.86, (nv + 0.1) / 0.92) + wob;
  const top = nv > 0.05;
  if (e < 0.46) return rng() < 0.9 ? 'capped' : (rng() < 0.6 ? 'larva' : 'empty');
  if (e < 0.66) { const q = rng(); return q < 0.5 ? 'larva' : q < 0.82 ? 'capped' : q < 0.92 ? 'egg' : 'empty'; }
  if (e < 0.76) { const q = rng(); return q < 0.55 ? 'egg' : q < 0.8 ? 'larva' : 'empty'; }
  if (e < 1.0) return rng() < 0.9 ? 'pollen' : 'empty';
  if (top || e > 1.14) {
    if (!top) return rng() < 0.8 ? 'empty' : 'pollen';
    return e < 1.09 ? (rng() < 0.65 ? 'nectar' : 'honey') : (rng() < 0.94 ? 'honey' : 'nectar');
  }
  return rng() < 0.75 ? 'empty' : 'nectar';
}

function combPainting() {
  const { W, H, PITCH } = COMB;
  const rng = seededRandom(6601);
  const R = PITCH / Math.sqrt(3); // centre to corner
  const inset = R - 2.5;
  const hex = (ctx, x, y, r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 3;
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  const radial = (ctx, x, y, r, stops, ox = 0, oy = 0) => {
    const g = ctx.createRadialGradient(x + ox, y + oy, 0.5, x, y, r);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    return g;
  };
  const POLLEN = ['#f2a01e', '#f6c324', '#e8821a', '#f4d43c', '#d9731c', '#eeb22a', '#c9931e', '#c8501e'];
  return canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#f0d47e'; // the wax of the cell walls
    ctx.fillRect(0, 0, W, H);
    for (const [x, y] of combCentres()) {
      const nu = (x / W) * 2 - 1; const nv = 1 - (y / H) * 2;
      const kind = combZone(nu, nv, rng);
      hex(ctx, x, y, inset);
      if (kind === 'honey') {
        // A wax cap over honey: flat, golden, faintly wrinkled.
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, '#fbdc72'], [0.7, '#eeb838'], [1, '#c98c1e']], -2, -3);
        ctx.fill();
      } else if (kind === 'nectar') {
        // Open cell of nectar: a dark pit with a wet surface in it.
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, '#e88a10'], [0.75, '#b85f08'], [1, '#7a3c06']]);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,240,190,0.85)';
        ctx.beginPath(); ctx.ellipse(x - 3.2, y - 4, 2.7, 1.6, -0.5, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'capped') {
        // A brood cap: domed and pale, the colour of biscuit, darker where it meets the wall.
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, '#f0d9ae'], [0.55, '#dcb981'], [1, '#a57a42']], -2, -3);
        ctx.fill();
      } else if (kind === 'larva') {
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, '#f6e6b8'], [0.7, '#cfa45c'], [1, '#6c4418']]);
        ctx.fill();
        // A white grub curled in a C in the bottom of the cell, segmented, with its head tucked in.
        const a0 = rng() * Math.PI * 2; const sweep = 3.5;
        ctx.strokeStyle = '#fffdf4'; ctx.lineCap = 'round'; ctx.lineWidth = 5.2;
        ctx.beginPath(); ctx.arc(x, y, 5.4, a0, a0 + sweep); ctx.stroke();
        ctx.strokeStyle = 'rgba(190,170,120,0.34)'; ctx.lineWidth = 0.7;
        for (let k = 1; k < 6; k++) {
          const a = a0 + (k / 6) * sweep;
          ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * 3.2, y + Math.sin(a) * 3.2); ctx.lineTo(x + Math.cos(a) * 7.6, y + Math.sin(a) * 7.6); ctx.stroke();
        }
      } else if (kind === 'egg') {
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, '#7a5222'], [0.7, '#5a3814'], [1, '#2e1a08']]);
        ctx.fill();
        ctx.fillStyle = '#fffef2';
        ctx.beginPath(); ctx.ellipse(x, y, 1.5, 4.3, rng() * 3, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'pollen') {
        const c = POLLEN[Math.floor(rng() * POLLEN.length)];
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, c], [0.72, c], [1, '#6a3c10']]);
        ctx.fill();
        // A packed pellet surface, stippled.
        for (let k = 0; k < 7; k++) {
          const a = rng() * Math.PI * 2; const d = rng() * inset * 0.68;
          ctx.fillStyle = rng() > 0.5 ? 'rgba(255,240,170,0.5)' : 'rgba(120,60,10,0.34)';
          ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.2 + rng(), 0, Math.PI * 2); ctx.fill();
        }
      } else {
        // An empty cell: a pit going dark at the bottom, with a little of the far wall lit.
        ctx.fillStyle = radial(ctx, x, y, inset, [[0, '#4a2a10'], [0.6, '#7c5222'], [1, '#c79a50']], 2, 3);
        ctx.fill();
      }
      // The lit lip of the wall on the upper left, the shadowed one on the lower right.
      ctx.lineWidth = 1;
      hex(ctx, x, y, inset + 0.5);
      ctx.strokeStyle = 'rgba(120,76,24,0.5)';
      ctx.stroke();
    }
  });
}

// A slab whose faces take a colour from their normal and a grain running along `grain`.
function slab(parts, x0, x1, y0, y1, z0, z1, color, grain = 'x') {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const P = g.attributes.position; const N = g.attributes.normal; const U = g.attributes.uv;
  const col = new Float32Array(P.count * 3);
  const G = 0.55;
  for (let i = 0; i < P.count; i++) {
    const nx = N.getX(i); const ny = N.getY(i); const nz = N.getZ(i);
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const along = grain === 'x' ? x : grain === 'y' ? y : z;
    const off = Math.abs(nx) > 0.5 ? (grain === 'y' ? z : y) : Math.abs(ny) > 0.5 ? (grain === 'x' ? z : x) : (grain === 'y' ? x : y);
    U.setXY(i, off * 0.8 + (x0 + z0) * 0.37, along * G);
    const c = typeof color === 'function' ? color(nx, ny, nz) : color;
    const rgb = Array.isArray(c) ? c : lin(c);
    col[i * 3] = rgb[0]; col[i * 3 + 1] = rgb[1]; col[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push({ geometry: g, keepColor: true });
}

// A bee, one unit long-ish, with its head along +X, its back up along +Z and its feet at z = -0.2, so it
// stands on anything placed at that distance. Merged per bee and transformed whole: fifteen of them are one
// template and no extra meshes.
function beeTemplate({ abLen = 1, amber = 0xd8901e, band = 0x2c1a0a, fur = 0xa8783a }) {
  const parts = [];
  const AMB = lin(amber); const BAND = lin(band);
  // The abdomen: a tapered lathe along -X, painted in bands.
  const prof = [[0, 0]];
  const N = 18;
  for (let i = 1; i < N; i++) {
    const t = i / N;
    prof.push([0.15 * Math.sin(Math.PI * t ** 0.82) ** 0.72, t * 0.6 * abLen]);
  }
  prof.push([0, 0.6 * abLen]);
  const ab = lathe(prof, 12);
  tintVertices(ab, (x, y, z, out) => {
    const t = y / (0.6 * abLen);
    const stripe = Math.sin(t * Math.PI * 2 * 3.1 + 0.6) > 0.1 ? 1 : 0;
    const c = t < 0.12 ? AMB : (t > 0.9 || !stripe ? BAND : AMB);
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  });
  ab.rotateZ(Math.PI / 2); // head of the lathe toward -X
  ab.translate(0.02, 0, 0);
  parts.push({ geometry: ab, keepColor: true });
  // The thorax, tawny with fur, and the head, dark.
  parts.push({ geometry: new THREE.SphereGeometry(1, 12, 9).scale(0.17, 0.155, 0.155).translate(0.14, 0, 0.005), color: fur });
  parts.push({ geometry: new THREE.SphereGeometry(1, 10, 8).scale(0.09, 0.125, 0.115).translate(0.35, 0, -0.005), color: 0x2a1c10 });
  for (const s of [1, -1]) {
    parts.push({ geometry: new THREE.SphereGeometry(1, 8, 6).scale(0.055, 0.045, 0.085).translate(0.36, s * 0.095, 0.01), color: 0x120c08 });
    // Antennae, elbowed.
    parts.push({ geometry: tube([[0.42, s * 0.03, 0.04], [0.5, s * 0.08, 0.12], [0.62, s * 0.13, 0.09]], [0.014, 0.012, 0.009], { sides: 4, steps: 4, round: 0 }), color: 0x1e140c });
    // Three legs a side, reaching down to the comb.
    for (const [xh, dx] of [[0.24, 0.13], [0.14, -0.04], [0.04, -0.2]]) {
      parts.push({ geometry: tube([[xh, s * 0.1, -0.08], [xh + dx * 0.5, s * 0.23, -0.1], [xh + dx, s * 0.33, -0.2]], [0.019, 0.014, 0.008], { sides: 4, steps: 4, round: 0 }), color: 0x241810 });
    }
  }
  const wings = [];
  for (const s of [1, -1]) {
    const fore = new THREE.SphereGeometry(1, 10, 6).scale(0.27, 0.085, 0.008);
    fore.rotateZ(s * 0.16);
    fore.translate(-0.13, s * 0.115, 0.17);
    wings.push({ geometry: fore, color: 0xe9edf0 });
    const hind = new THREE.SphereGeometry(1, 10, 6).scale(0.19, 0.068, 0.008);
    hind.rotateZ(s * 0.3);
    hind.translate(-0.1, s * 0.15, 0.16);
    wings.push({ geometry: hind, color: 0xe9edf0 });
  }
  return { parts, wings };
}

// A Langstroth deep box at about 3.6 times life size, long side to the viewer with that side taken away,
// so the frames hang in front of the student with the comb showing, and the row of top bars runs back from
// them. Ten slots; the one nearest the front is empty, because that frame is standing on the rack beside
// the hive. The lid is set down under the rack. The hive and the rack are one model and stand well apart, so the
// whole group is about twice the box's six feet.
function beehiveCutaway() {
  const rng = seededRandom(6602);
  const HX = -3.0; // centre of the hive
  const RX = 3.95; // centre of the rack
  const RZ = 0.75;
  const L = 6.0; const D = 4.9; const WALL = 0.225;
  const STAND = 1.3; const BOARD = 0.2;
  const Y0 = STAND + BOARD; const Y1 = Y0 + 2.9;
  const RABBET = 0.3;
  const WHITE = lin(0xe9e6dc); const RAW = lin(0xd9b277); const STAIN = lin(0xb9894c); const CEDAR = lin(0x8f5f38); const CEDAR_D = lin(0x74492a);
  const wood = [];
  // White outside, bare pine inside and on every sawn edge. `inward` is which way the inside of the box is.
  const paint = (inward) => (nx, ny, nz) => (nx * inward[0] + ny * inward[1] + nz * inward[2] > 0.5 ? RAW : WHITE);

  // --- The stand and the bottom board ---------------------------------------------------------
  const sx0 = HX - L / 2 - 0.15; const sx1 = HX + L / 2 + 0.15; const sz0 = -D / 2 - 0.1; const sz1 = D / 2 + 0.1;
  for (const x of [sx0, sx1 - 0.34]) for (const z of [sz0, sz1 - 0.34]) slab(wood, x, x + 0.34, 0, STAND - 0.2, z, z + 0.34, CEDAR, 'y');
  slab(wood, sx0, sx1, STAND - 0.3, STAND, sz0, sz0 + 0.3, CEDAR_D);
  slab(wood, sx0, sx1, STAND - 0.3, STAND, sz1 - 0.3, sz1, CEDAR_D);
  slab(wood, sx0, sx0 + 0.3, STAND - 0.3, STAND, sz0, sz1, CEDAR_D, 'z');
  slab(wood, sx1 - 0.3, sx1, STAND - 0.3, STAND, sz0, sz1, CEDAR_D, 'z');
  for (let i = 1; i < 4; i++) { const x = mix(sx0, sx1, i / 4); slab(wood, x - 0.12, x + 0.12, STAND - 0.3, STAND - 0.02, sz0, sz1, CEDAR_D, 'z'); }
  // The bottom board, running out past the hive's end as the bees' landing board.
  slab(wood, HX - L / 2, HX + L / 2 + 0.55, STAND, Y0, -D / 2, D / 2, (nx, ny) => (ny > 0.5 ? RAW : WHITE));
  // --- The three walls left standing -------------------------------------------------------------
  slab(wood, HX - L / 2, HX + L / 2, Y0, Y1, -D / 2, -D / 2 + WALL, paint([0, 0, 1]));
  for (const s of [-1, 1]) {
    const ox = HX + (s * L) / 2; const ix = ox - s * WALL; const mx = ox - s * WALL * 0.45;
    const inward = [-s, 0, 0];
    // The end walls carry the rabbet, the ledge the frames' lugs hang on. The entrance is under the +X end.
    const bottom = s > 0 ? Y0 + 0.14 : Y0;
    slab(wood, Math.min(ox, ix), Math.max(ox, ix), bottom, Y1 - RABBET, -D / 2, D / 2, paint(inward), 'z');
    slab(wood, Math.min(ox, mx), Math.max(ox, mx), Y1 - RABBET, Y1, -D / 2, D / 2, paint(inward), 'z');
    // A routed hand hold: a dark slot with a white lip round it, built forward of the wall.
    const hy = Y0 + 2.05;
    const nudge = (d) => [Math.min(ox, ox + s * d), Math.max(ox, ox + s * d)];
    const lip = extrudeOutline(roundedOutline(0.74, 0.17, 0.15, 5), 0.03).rotateY(Math.PI / 2).translate(ox + s * 0.015, hy, 0);
    wood.push({ geometry: outward(lip), color: 0xf0ede4 });
    const slot = extrudeOutline(roundedOutline(0.64, 0.1, 0.09, 5), 0.03).rotateY(Math.PI / 2).translate(ox + s * 0.025, hy, 0);
    wood.push({ geometry: outward(slot), color: 0x3a2a18 });
    // Finger joints at the back corners: a Langstroth's corners are its signature, even under paint.
    const FING = 8;
    for (let i = 0; i < FING; i += 2) {
      const y0 = mix(Y0, Y1, i / FING); const y1 = mix(Y0, Y1, (i + 1) / FING);
      const [c0, c1] = nudge(0.008);
      slab(wood, c0, c1, y0, y1, -D / 2, -D / 2 + WALL, 0xdcd7c8, 'y');
    }
    for (let i = 1; i < FING; i += 2) {
      const y0 = mix(Y0, Y1, i / FING); const y1 = mix(Y0, Y1, (i + 1) / FING);
      slab(wood, Math.min(ox, ix), Math.max(ox, ix), y0, y1, -D / 2 - 0.008, -D / 2, 0xdcd7c8, 'y');
    }
  }

  // --- A frame, which is the same object in the box and on the rack -------------------------------
  const FH = 2.74; const FW = 2.7; const LUG = 2.86;
  const COMB_W = 2.56; const combY = (top) => [top - FH + 0.13, top - 0.225];
  const combs = [];
  const buildFrame = (cx, top, cz, face = true, flipU = false) => {
    const bot = top - FH;
    const tint = (a, b) => (nx, ny) => (ny > 0.5 ? a : b);
    const propolis = mix(0, 1, rng());
    const topC = [mix(RAW[0], STAIN[0], propolis), mix(RAW[1], STAIN[1], propolis), mix(RAW[2], STAIN[2], propolis)];
    slab(wood, cx - LUG, cx + LUG, top - 0.225, top, cz - 0.16, cz + 0.16, tint(topC, RAW));
    for (const s of [-1, 1]) {
      const a = cx + s * COMB_W; const b = cx + s * FW;
      slab(wood, Math.min(a, b), Math.max(a, b), bot, top - 0.2, cz - 0.17, cz + 0.17, RAW, 'y');
    }
    slab(wood, cx - FW, cx + FW, bot, bot + 0.13, cz - 0.14, cz + 0.14, RAW);
    const [y0, y1] = combY(top);
    // The comb is a slab with the painting on both faces. It stands a hair back from the wood of the frame.
    const u0 = flipU ? 1 : 0; const u1 = flipU ? 0 : 1;
    for (const sgn of [1, -1]) {
      const g = new THREE.PlaneGeometry(COMB_W * 2, y1 - y0);
      if (sgn < 0) g.rotateY(Math.PI);
      g.translate(cx, (y0 + y1) / 2, cz + sgn * 0.125);
      const U = g.attributes.uv;
      for (let i = 0; i < U.count; i++) U.setX(i, U.getX(i) > 0.5 ? u1 : u0);
      combs.push({ geometry: g, color: 0xffffff });
    }
    if (!face) return;
    return { y0, y1, z: cz + 0.125 };
  };
  const SLOT = 0.4125;
  const slotZ = (i) => (i - 4.5) * SLOT;
  const hangTop = Y1 - 0.03;
  let hung = null;
  for (let i = 0; i < 9; i++) {
    const r = buildFrame(HX, hangTop, slotZ(i), true, i % 2 === 0);
    if (i === 8) hung = r;
  }
  const LZ = RZ - 1.95; // where the lid sits, mostly behind the frame so it does not fill the view
  // The rack: two notched posts on a base, with the frame hanging by its lugs like a coat on a rail.
  const RTOP = Y1 + 0.2;
  const held = buildFrame(RX, RTOP, RZ, true, false);
  for (const s of [-1, 1]) {
    const x = RX + s * (LUG - 0.1);
    slab(wood, x - 0.13, x + 0.13, 0.27, RTOP - 0.225, RZ - 0.13, RZ + 0.13, CEDAR, 'y');
    slab(wood, x - 0.13, x + 0.13, 0, 0.27, RZ - 1.05, RZ + 1.05, CEDAR_D, 'z');
    // The notch's little cheeks, either side of the lug.
    for (const d of [-1, 1]) slab(wood, x - 0.13, x + 0.13, RTOP - 0.225, RTOP - 0.06, RZ + d * 0.16 + (d < 0 ? -0.04 : 0), RZ + d * 0.16 + (d > 0 ? 0.04 : 0), CEDAR, 'y');
  }
  slab(wood, RX - LUG, RX + LUG, 0.06, 0.26, RZ - 0.1, RZ + 0.1, CEDAR_D);
  slab(wood, RX - LUG, RX + LUG, 0.06, 0.26, LZ - 2.9, LZ - 2.7, CEDAR_D);
  slab(wood, RX - LUG, RX + LUG, 0.06, 0.26, LZ + 2.7, LZ + 2.9, CEDAR_D);

  // --- The lid, set down on the rack's base ---------------------------------------------------------
  // A telescoping cover: a shallow white tray with a zinc-clad top, sitting where a beekeeper puts one, on
  // the ground out of the way, with the frame hanging over it.
  {
    const LW = 6.5; const LD = 5.24; const LH = 0.46; const ZINC = lin(0x9fa8ad);
    const y0 = 0.27; const z0 = LZ;
    const X0 = RX - LD / 2; const X1 = RX + LD / 2; const Z0 = z0 - LW / 2; const Z1 = z0 + LW / 2;
    slab(wood, X0, X1, y0 + LH, y0 + LH + 0.05, Z0, Z1, ZINC, 'z');
    slab(wood, X0, X1, y0, y0 + LH, Z0, Z0 + 0.1, WHITE);
    slab(wood, X0, X1, y0, y0 + LH, Z1 - 0.1, Z1, WHITE);
    slab(wood, X0, X0 + 0.1, y0, y0 + LH, Z0, Z1, WHITE, 'z');
    slab(wood, X1 - 0.1, X1, y0, y0 + LH, Z0, Z1, WHITE, 'z');
  }

  // --- The bees ------------------------------------------------------------------------------
  const worker = beeTemplate({});
  const queen = beeTemplate({ abLen: 1.62, amber: 0xc97a18, band: 0x3a200c, fur: 0x8f5c2a });
  const bodies = []; const wingParts = [];
  const put = (tpl, x, y, z, angle, s) => {
    const m = new THREE.Matrix4().makeRotationZ(angle);
    m.scale(new THREE.Vector3(s, s, s));
    m.setPosition(x, y, z + 0.205 * s);
    for (const p of tpl.parts) { const g = p.geometry.clone(); g.applyMatrix4(m); bodies.push({ geometry: g, color: p.color, keepColor: p.keepColor }); }
    for (const p of tpl.wings) { const g = p.geometry.clone(); g.applyMatrix4(m); wingParts.push({ geometry: g, color: p.color }); }
  };
  const WS = 0.19; const QS = 0.235;
  const taken = [];
  const free = (x, y, frame, r) => taken.every((o) => o[2] !== frame || Math.hypot(x - o[0], y - o[1]) > r + o[3]);
  // The queen is on the rack's frame, down in the brood where she lays, with her court round her, every
  // one of them facing her. That ring is how a beekeeper finds a queen, and it is how a student will.
  const qx = RX - 0.55; const qy = (held.y0 + held.y1) / 2 - 0.2;
  put(queen, qx, qy, held.z, 0.5, QS);
  taken.push([qx, qy, 'r', 0.3]);
  for (let i = 0; i < 6; i++) {
    const a = 0.3 + (i / 6) * Math.PI * 2;
    const x = qx + Math.cos(a) * 0.33 * 1.1; const y = qy + Math.sin(a) * 0.33 * 0.95;
    put(worker, x, y, held.z, a + Math.PI + (rng() - 0.5) * 0.3, WS);
    taken.push([x, y, 'r', 0.14]);
  }
  const scatter = (frame, cx, area, count) => {
    for (let n = 0, guard = 0; n < count && guard < 400; guard++) {
      const x = cx + (rng() * 2 - 1) * (COMB_W - 0.2);
      const y = mix(area.y0 + 0.15, area.y1 - 0.15, rng());
      if (!free(x, y, frame, 0.2)) continue;
      put(worker, x, y, area.z, rng() * Math.PI * 2, WS);
      taken.push([x, y, frame, 0.16]);
      n += 1;
    }
  };
  scatter('r', RX, held, 4);
  scatter('h', HX, hung, 5);

  // --- Assembly -------------------------------------------------------------------------------
  const DX = -0.3;
  const root = new THREE.Group();
  root.name = 'beehive-cutaway';
  const grain = streakMap(6603, { size: 256, lines: 150, dark: 212, alpha: 0.42, base: '#f8f8f8', bow: 12 });
  const addMesh = (g, params) => { g.translate(DX, 0, 0.95); const m = mesh(g, standard(params)); root.add(m); return m; };
  addMesh(mergeParts(wood), { vertexColors: true, map: grain, bumpMap: grain, bumpScale: 0.25, roughness: 0.66, metalness: 0 });
  const comb = combPainting();
  addMesh(mergeParts(combs), { map: comb, bumpMap: comb, bumpScale: 2.2, roughness: 0.46, metalness: 0 });
  addMesh(mergeParts(bodies), { vertexColors: true, roughness: 0.5, metalness: 0 });
  const w = addMesh(mergeParts(wingParts), { vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, roughness: 0.25, metalness: 0 });
  w.castShadow = false;
  return root;
}

// ---------------------------------------------------------------------------------------------
// Bean seed sprouting
// ---------------------------------------------------------------------------------------------

// A small seeded noise tile, read bilinearly. A soil painting asks for millions of samples and a general
// 3D noise function would spend most of a second on it.
function tileNoise(seed, size = 128) {
  const rng = seededRandom(seed);
  const a = new Float32Array(size * size);
  for (let i = 0; i < a.length; i++) a[i] = rng();
  const m = size - 1;
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    let u = x - xi; let v = y - yi;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const i0 = xi & m; const i1 = (xi + 1) & m; const j0 = yi & m; const j1 = (yi + 1) & m;
    const p = a[i0 + j0 * size]; const q = a[i1 + j0 * size]; const r = a[i0 + j1 * size]; const t = a[i1 + j1 * size];
    return (p + (q - p) * u) * (1 - v) + (r + (t - r) * u) * v;
  };
}

// A bean, long axis along X with its hollow side down. `exposed(x, y, z)` is negative where the coat has
// gone and the pale cotyledon shows, and the mesh is snapped to that line so the torn edge stays crisp.
function beanGeo({ L, fat = 1, seed = 1, wrinkle = 0, exposed = null }) {
  const S = new Sculpt(L / 25);
  const COAT = lin(0xd8b184); const MOTTLE = lin(0x8f5230); const COTY = lin(0xf5eac8); const TORN = lin(0x4a2a14);
  S.add(squash(curveP(
    [[-0.42 * L, -0.05 * L, 0], [-0.22 * L, 0.05 * L, 0], [0, 0.08 * L, 0], [0.22 * L, 0.05 * L, 0], [0.42 * L, -0.05 * L, 0]],
    [0.19 * L * fat, 0.285 * L * fat, 0.31 * L * fat, 0.285 * L * fat, 0.19 * L * fat], 16,
  ), [1, 1, 0.78]), COAT);
  S.sub(ellipsoidP([0, -0.24 * L * fat, 0.09 * L], [0.07 * L, 0.04 * L, 0.05 * L]), null, { k: 0.03 * L });
  if (wrinkle) S.map((d, x, y, z) => d + (smoothNoise3(x * 19 + seed, y * 19, z * 19) - 0.5) * wrinkle + (smoothNoise3(x * 8, y * 8 + seed, z * 8) - 0.5) * wrinkle * 0.8);
  return polygonize(S, {
    uvScale: 1,
    snap: exposed,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const mot = sstep(smoothNoise3((x / L) * 6.2 + seed, (y / L) * 6.2, (z / L) * 6.2), 0.44, 0.66) * 0.9;
      let r = mix(COAT[0], MOTTLE[0], mot); let g = mix(COAT[1], MOTTLE[1], mot); let b = mix(COAT[2], MOTTLE[2], mot);
      // The hilum: a pale scar with a dark ring, where the seed was joined to its pod.
      const hd = Math.hypot((x / L) / 0.11, ((y / L) + 0.25 * fat) / 0.06);
      if (hd < 1.5) { const t = 1 - sstep(hd, 0.7, 1.0); const k = sstep(hd, 1.0, 1.5); r = mix(mix(0.14, r, k), 0.9, t); g = mix(mix(0.07, g, k), 0.85, t); b = mix(mix(0.04, b, k), 0.7, t); }
      if (exposed) {
        const e = exposed(x, y, z);
        const t = 1 - sstep(e, -0.002, 0.002);
        const edge = 1 - sstep(Math.abs(e), L * 0.012, L * 0.045);
        const c = 0.92 + 0.14 * smoothNoise3(x * 16, y * 16, z * 16);
        r = mix(mix(r, COTY[0] * c, t), TORN[0], edge * 0.8); g = mix(mix(g, COTY[1] * c, t), TORN[1], edge * 0.8); b = mix(mix(b, COTY[2] * c, t), TORN[2], edge * 0.8);
      }
      rgb[0] = r; rgb[1] = g; rgb[2] = b;
    },
  });
}

// A torn opening in a seed coat: an ellipse with a wandering edge, negative inside.
const tear = (cx, cy, rx, ry, seed) => (x, y) => {
  const a = Math.atan2((y - cy) / ry, (x - cx) / rx);
  const wob = 0.11 * Math.sin(a * 3 + seed) + 0.07 * Math.sin(a * 7 + seed * 2.3) + 0.04 * Math.sin(a * 13 + seed);
  return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1 - wob) * Math.min(rx, ry);
};

// One thick seed leaf, sprung from `base` along `dir`, flatter than it is wide, fleshy, closed.
function cotyledonGeo(L, W, T, { tone = 0x9fbe42, tip = 0xc6cf62, wrinkle = 0, seed = 3 } = {}) {
  const S = new Sculpt(Math.max(0.017, L / 24));
  const A = lin(tone); const B = lin(tip);
  S.add(squash(curveP([[0, 0, 0], [0.32 * L, 0.04 * L, 0], [0.68 * L, 0.04 * L, 0], [L, -0.03 * L, 0]], [0.12 * W, 0.46 * W, 0.42 * W, 0.12 * W], 12), [1, T / W, 1]), A);
  if (wrinkle) S.map((d, x, y, z) => d + (smoothNoise3(x * 22 + seed, y * 22, z * 22) - 0.5) * wrinkle);
  return polygonize(S, {
    uvScale: 1,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const t = sstep(x / L, 0.1, 1);
      const n = 0.92 + 0.16 * smoothNoise3(x * 14 + seed, y * 14, z * 14);
      const under = ny < 0 ? 0.8 : 1;
      rgb[0] = mix(A[0], B[0], t) * n * under; rgb[1] = mix(A[1], B[1], t) * n * under; rgb[2] = mix(A[2], B[2], t) * n * under;
    },
  });
}

// A heart-shaped first true leaf, with real thickness. u runs across and v along, for the vein map.
function trueLeafGeo(base, dir, up, L, W) {
  const d = V3(dir).normalize();
  const n = V3(up).addScaledVector(d, -V3(up).dot(d)).normalize();
  const side = new THREE.Vector3().crossVectors(d, n).normalize();
  const g = solidSurface({
    nu: 10, nv: 16,
    point: (u, v) => {
      const s = u * 2 - 1;
      // Broad near the base with the two rounded lobes running back past the stalk, then a drawn-out tip.
      const w = W * Math.max(0.012, Math.sin(Math.PI * clamp01(v ** 0.62)) ** 0.82);
      const back = -0.11 * L * (Math.abs(s) ** 2) * (1 - sstep(v, 0, 0.42));
      const a = L * v + back;
      const fold = Math.abs(s) * w * 0.24;
      const droop = -0.26 * L * v * v;
      const wave = 0.018 * L * Math.sin(v * 9 + s * 3);
      return [
        base[0] + d.x * a + side.x * s * w + n.x * (fold + droop + wave),
        base[1] + d.y * a + side.y * s * w + n.y * (fold + droop + wave),
        base[2] + d.z * a + side.z * s * w + n.z * (fold + droop + wave),
      ];
    },
    thick: (u, v) => 0.012 * (1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * clamp01(v)) + 0.003,
  });
  return g;
}

function leafVeinMap(seed) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#d4d4d4';
    ctx.fillRect(0, 0, w, h);
    // Netting, then the side veins curving up from the midrib, then the midrib. v is up the canvas.
    ctx.strokeStyle = 'rgba(245,245,245,0.5)'; ctx.lineWidth = 0.9;
    for (let i = 0; i < 280; i++) {
      const x = rng() * w; const y = rng() * h; const a = rng() * Math.PI * 2; const l = 5 + rng() * 9;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const y = h - (0.05 + i * 0.145) * h;
      for (const sgn of [1, -1]) {
        ctx.lineWidth = 3.4 - i * 0.3;
        ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.quadraticCurveTo(w / 2 + sgn * w * 0.26, y - h * 0.05, w / 2 + sgn * w * 0.47, y - h * 0.2); ctx.stroke();
      }
    }
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(w / 2, 0); ctx.stroke();
  });
}

// A slice of soil in a frame. Everything grows in the plane of the cut, half sunk in it, so a root reads as
// a root lying exposed on a sawn face. Six plants in six bays, each bay a stage. The enlargement is about ten
// times, so a bean is six inches long and the last seedling about 2.3ft above the ground.
//
// Roots, stems and leaf stalks are all tapered tubes that start INSIDE whatever they grow from, and the plant
// is built from its growth: it is epigeal, so in stage 4 the hook is the stem doubled over with the seed still
// on its far end, being dragged backward out of the soil. Stage 5 is that hook straightened.
export const BEAN_STAGES = 6;

function seedGermination() {
  const rng = seededRandom(7701);
  const IX = 4.72; const YB = 0.55; const YS = 3.15; const YT = 5.7;
  const BAY = (IX * 2) / BEAN_STAGES;
  const CX = (i) => -IX + (i + 0.5) * BAY;
  const mound = (x) => 0.1 * Math.exp(-(((x - CX(3) - 0.13) / 0.3) ** 2));
  const ground = (x) => YS + 0.045 * Math.sin(x * 1.7 + 0.3) + 0.028 * Math.sin(x * 4.1 + 1.2) + 0.012 * Math.sin(x * 11.3) + mound(x);
  const SEED_Y = YS - 0.74;

  // --- The soil's cut face ------------------------------------------------------------------------
  const V0 = YB - 0.04; const V1 = YS + 0.3;
  const X0 = -IX - 0.05; const X1 = IX + 0.05;
  const W = 1536; const PX = W / (X1 - X0); const H = Math.round((V1 - V0) * PX);
  const toPx = (x, y) => [(x - X0) * PX, H - (y - V0) * PX];
  const soil = canvasTexture(W, H, (ctx) => {
    const nA = tileNoise(7702); const nB = tileNoise(7703);
    const img = ctx.createImageData(W, H);
    const d = img.data;
    let seedV = 12345;
    const TOP = [52, 34, 22]; const MID = [92, 63, 39]; const LOW = [128, 92, 58];
    for (let j = 0; j < H; j++) {
      const y = V1 - (j + 0.5) / PX;
      const depth = clamp01((YS - y) / (YS - YB));
      for (let i = 0; i < W; i++) {
        const x = X0 + (i + 0.5) / PX;
        const k = (i + j * W) * 4;
        // The horizons wander, so a band is never a ruled line, and clods break up every scale.
        const wander = (nA(x * 0.7, y * 0.7 + 40) - 0.5) * 0.3;
        const t = clamp01(depth + wander);
        const c0 = t < 0.42 ? TOP : MID; const c1 = t < 0.42 ? MID : LOW;
        const f = t < 0.42 ? sstep(t, 0.1, 0.42) : sstep(t, 0.42, 1);
        const clod = nA(x * 7, y * 7) * 0.55 + nB(x * 19, y * 19) * 0.3 + nB(x * 47 + 9, y * 47) * 0.15;
        seedV = (seedV * 1664525 + 1013904223) | 0;
        const speck = ((seedV >>> 8) & 255) / 255;
        const v = (0.58 + clod * 0.82) * (speck > 0.965 ? 0.55 : speck < 0.03 ? 1.32 : 1) * (0.94 + speck * 0.12);
        d[k] = (c0[0] + (c1[0] - c0[0]) * f) * v; d[k + 1] = (c0[1] + (c1[1] - c0[1]) * f) * v; d[k + 2] = (c0[2] + (c1[2] - c0[2]) * f) * v;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Water darkens the soil round each seed that has taken it up.
    for (let i = 1; i < BEAN_STAGES; i++) {
      const [a, b] = toPx(CX(i), SEED_Y - 0.1);
      const g = ctx.createRadialGradient(a, b, 6, a, b, 0.72 * PX);
      g.addColorStop(0, 'rgba(26,16,10,0.34)'); g.addColorStop(1, 'rgba(26,16,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(a, b, 0.72 * PX, 0, Math.PI * 2); ctx.fill();
    }
    // Stones: irregular, lit from the upper left, sitting in a little contact shadow.
    const stone = (x, y, r, tone) => {
      const [a, b] = toPx(x, y); const R = r * PX;
      const sides = 7 + Math.floor(rng() * 4);
      const pts = [];
      for (let i = 0; i < sides; i++) { const q = (i / sides) * Math.PI * 2; const l = R * (0.72 + rng() * 0.45); pts.push([a + Math.cos(q) * l, b + Math.sin(q) * l * (0.68 + rng() * 0.2)]); }
      const path = (ox, oy) => { ctx.beginPath(); pts.forEach(([p, q], i) => (i ? ctx.lineTo(p + ox, q + oy) : ctx.moveTo(p + ox, q + oy))); ctx.closePath(); };
      path(1.6, 2.2); ctx.fillStyle = 'rgba(18,10,6,0.55)'; ctx.fill();
      const g = ctx.createLinearGradient(a - R, b - R, a + R, b + R);
      g.addColorStop(0, `rgb(${tone[0] * 1.2},${tone[1] * 1.2},${tone[2] * 1.2})`); g.addColorStop(1, `rgb(${tone[0] * 0.62},${tone[1] * 0.62},${tone[2] * 0.62})`);
      path(0, 0); ctx.fillStyle = g; ctx.fill();
    };
    const TONES = [[150, 146, 136], [178, 160, 128], [122, 112, 104], [170, 128, 92], [196, 186, 164], [108, 92, 80]];
    for (let i = 0; i < 230; i++) {
      const y = mix(YB + 0.02, YS - 0.05, rng() ** 0.8);
      const deep = 1 - (y - YB) / (YS - YB);
      const r = (0.012 + rng() ** 2.2 * 0.055) * (0.7 + deep * 0.9);
      stone(mix(X0, X1, rng()), y, r, TONES[Math.floor(rng() * TONES.length)]);
    }
    // Fine pale grit, and a few dark threads of old root.
    for (let i = 0; i < 1300; i++) {
      const [a, b] = toPx(mix(X0, X1, rng()), mix(YB, YS, rng()));
      ctx.fillStyle = rng() > 0.45 ? 'rgba(205,186,150,0.5)' : 'rgba(30,18,10,0.5)';
      ctx.fillRect(a, b, 1 + rng() * 1.4, 1 + rng() * 1.4);
    }
    ctx.strokeStyle = 'rgba(28,16,10,0.55)'; ctx.lineWidth = 1.1;
    for (let i = 0; i < 46; i++) {
      const [a, b] = toPx(mix(X0, X1, rng()), mix(YS - 0.9, YS, rng()));
      ctx.beginPath(); ctx.moveTo(a, b); ctx.quadraticCurveTo(a + (rng() - 0.5) * 34, b + 16 * rng(), a + (rng() - 0.5) * 50, b + 10 + rng() * 26); ctx.stroke();
    }
  });
  const soilUV = (x, y) => [(x - X0) / (X1 - X0), (y - V0) / (V1 - V0)];
  const faceG = strip(170, 1, (u, v) => { const x = mix(X0, X1, u); return [x, mix(YB - 0.03, ground(x), v), 0]; }, () => [0, 0, 1], (u, v) => { const x = mix(X0, X1, u); return soilUV(x, mix(YB - 0.03, ground(x), v)); });
  // The top of the soil runs back from the cut, crumbled, its colour taken off the top of the same painting.
  const topG = strip(170, 7, (u, v) => {
    const x = mix(X0, X1, u); const z = -v * 0.78;
    return [x, ground(x) + (v > 0 ? (smoothNoise3(x * 5, z * 5, 1.2) - 0.5) * 0.05 * sstep(v, 0, 0.2) : 0), z];
  }, () => [0, 1, 0], (u, v) => soilUV(mix(X0, X1, u) + v * 0.3, YS - 0.1 - v * 0.2));

  // --- The plants ------------------------------------------------------------------------------
  const greens = []; const leaves = []; const white = [];
  const ROOT = lin(0xf6efdc); const ROOT_TIP = lin(0xfffbf0); const HYPO = lin(0xc9d87c); const STEM = lin(0x6fa62e);
  const Z = 0.006;
  // Root colour along a tube; the tube's own rows are in order, so `sides` recovers the position along it.
  const rootTube = (pts, radii, sides = 8, steps = null) => {
    const g = tube(pts.map((p) => [p[0], p[1], p[2] ?? Z]), radii, { sides, steps: steps ?? Math.max(5, pts.length * 4), round: 1 });
    white.push({ geometry: g, color: 0xf4edd8 });
    return g;
  };
  const hair = (p, dx, dy, len) => {
    const q = [p[0] + dx * len, p[1] + dy * len, Z + 0.012];
    const g = tube([[p[0], p[1], Z + 0.004], q], [0.0075, 0.0005], { sides: 3, steps: 1, round: 0, straight: true });
    white.push({ geometry: g, color: 0xfbf7ea });
  };
  // A main root with its side roots. `depth` is how far it goes; `branches` how many; `hairs` how many root
  // hairs on it. Every side root starts on the centre line of its parent, so it cannot be unjoined.
  const rootSystem = (start, cx, depth, { branches = 0, hairs = 0, sub = 0, r0 = 0.05, spread = 0.5, hook = 0 }) => {
    const pts = [start];
    const n = 7;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push([cx + hook * (1 - t) + (rng() - 0.5) * 0.14 + Math.sin(t * 5 + cx) * 0.05, start[1] - depth * t]);
    }
    rootTube(pts, [r0, r0 * 0.86, r0 * 0.66, r0 * 0.44, 0.012], 8, 34);
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'catmullrom', 0.5);
    // Side roots come off at irregular intervals on whichever side they like, run out nearly level and only
    // then turn down, each wandering in its own way. Evenly spaced and mirrored, they are a fish's backbone.
    const clampX = (x) => Math.max(cx - spread, Math.min(cx + spread, x));
    const lateral = (t, side, L, r) => {
      const p = curve.getPoint(t);
      const dip = 0.12 + rng() * 0.4;
      const path = [[p.x, p.y]];
      const steps = 4;
      for (let k = 1; k <= steps; k++) {
        const q = k / steps;
        path.push([clampX(p.x + side * L * q + (rng() - 0.5) * 0.07), p.y - L * dip * q * q - (rng() - 0.3) * 0.05 * q]);
      }
      rootTube(path, [r, r * 0.76, r * 0.5, r * 0.28, 0.004], 6, 12);
      return path;
    };
    let side = rng() > 0.5 ? 1 : -1;
    let t = 0.1 + rng() * 0.05;
    for (let i = 0; i < branches && t < 0.92; i++) {
      if (rng() > 0.3) side = -side;
      const L = mix(0.74, 0.24, t) * (0.55 + rng() * 0.6);
      const path = lateral(t, side, L, r0 * (0.3 + rng() * 0.18));
      for (let k = 0; k < sub; k++) {
        const u = new THREE.CatmullRomCurve3(path.map(([x, y]) => new THREE.Vector3(x, y, 0))).getPoint(0.25 + rng() * 0.6);
        const s2 = rng() > 0.5 ? 1 : -1;
        rootTube([[u.x, u.y], [clampX(u.x + s2 * 0.05), u.y - 0.08 - rng() * 0.04], [clampX(u.x + s2 * (0.06 + rng() * 0.08)), u.y - 0.15 - rng() * 0.12]], [r0 * 0.17, r0 * 0.12, 0.003], 5, 6);
      }
      t += (0.82 / branches) * (0.45 + rng() * 1.1);
    }
    for (let i = 0; i < hairs; i++) {
      const t = mix(0.36, 0.95, rng());
      const p = curve.getPoint(t); const q = curve.getTangent(t);
      const s2 = rng() > 0.5 ? 1 : -1;
      const a = (0.6 + rng() * 0.5) * s2;
      hair([p.x, p.y], q.y * s2 * -1 * Math.cos(a) + q.x * Math.sin(a) * 0.3, q.x * s2 * Math.cos(a) - 0.3 * Math.abs(Math.sin(a)), 0.07 + rng() * 0.08);
    }
    return curve;
  };
  const stemTube = (pts, radii, sides = 10, fromY = YS - 0.4, toY = YS + 0.5) => {
    const g = tube(pts, radii, { sides, steps: pts.length * 6, round: 2 });
    tintVertices(g, (x, y, z, out) => {
      const t = sstep(y, fromY, toY);
      const a = y < fromY ? ROOT : HYPO;
      const b = y < fromY ? HYPO : STEM;
      const q = y < fromY ? sstep(y, fromY - 0.3, fromY) : t;
      out[0] = mix(a[0], b[0], q); out[1] = mix(a[1], b[1], q); out[2] = mix(a[2], b[2], q);
    });
    greens.push({ geometry: g, keepColor: true });
  };
  // Bake a bean in place and keep only what stands in front of the soil.
  const place = (g, x, y, z, rz, keepBack = false) => {
    const m = new THREE.Matrix4().makeRotationZ(rz);
    m.setPosition(x, y, z);
    g.applyMatrix4(m);
    if (!keepBack) {
      const P = g.attributes.position; const idx = g.index; const kept = [];
      for (let t = 0; t < idx.count; t += 3) {
        const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
        if (P.getZ(a) < -0.04 && P.getZ(b) < -0.04 && P.getZ(c) < -0.04) continue;
        kept.push(a, b, c);
      }
      g.setIndex(kept);
    }
    greens.push({ geometry: g, keepColor: true });
  };

  // 1: a dry bean: small, wrinkled, nothing else.
  place(beanGeo({ L: 0.46, fat: 0.94, seed: 11, wrinkle: 0.016 }), CX(0), SEED_Y, 0.03, 0.14);

  // 2: swollen with water to half as long again, its coat split along the hollow side, the first root out.
  {
    const L = 0.66;
    const exposed = tear(0.03 * L, -0.2 * L, 0.34 * L, 0.2 * L, 1.7);
    place(beanGeo({ L, fat: 1.08, seed: 12, exposed }), CX(1), SEED_Y, 0.04, -0.1);
    rootTube([[CX(1) + 0.03, SEED_Y - 0.08, 0.06], [CX(1) + 0.05, SEED_Y - 0.26], [CX(1) + 0.03, SEED_Y - 0.44], [CX(1) + 0.06, SEED_Y - 0.6]], [0.058, 0.055, 0.04, 0.012], 9, 18);
  }

  // 3: the root has turned hard downward (it bends with gravity wherever it started) and begun to branch.
  {
    const L = 0.7; const cx = CX(2);
    const exposed = tear(0.02 * L, -0.14 * L, 0.46 * L, 0.3 * L, 2.9);
    place(beanGeo({ L, fat: 1.1, seed: 13, exposed }), cx - 0.12, SEED_Y + 0.04, 0.05, 0.24);
    const start = [cx - 0.12, SEED_Y - 0.05, 0.05];
    const curve = new THREE.CatmullRomCurve3([start, [cx + 0.1, SEED_Y - 0.2, 0.02], [cx + 0.2, SEED_Y - 0.46, Z], [cx + 0.14, SEED_Y - 0.8, Z], [cx + 0.17, SEED_Y - 1.15, Z], [cx + 0.12, SEED_Y - 1.42, Z]].map(V3));
    const pts = curve.getPoints(10).map((v) => [v.x, v.y, v.z]);
    rootTube(pts, [0.066, 0.06, 0.05, 0.04, 0.012], 9, 36);
    for (const [t, side, len] of [[0.46, -1, 0.26], [0.58, 1, 0.34], [0.65, 1, 0.16], [0.76, -1, 0.3]]) {
      const p = curve.getPoint(t);
      rootTube([[p.x, p.y], [p.x + side * len * 0.45, p.y - len * 0.06], [p.x + side * len * 0.8, p.y - len * 0.2], [p.x + side * len, p.y - len * 0.48]], [0.024, 0.018, 0.012, 0.003], 6, 10);
    }
  }

  // 4: the hook. The stem has doubled over and is shouldering up through the soil with its seed still behind it.
  {
    const cx = CX(3);
    const J = [cx - 0.2, SEED_Y - 0.22, Z];
    const arch = [J, [cx - 0.26, SEED_Y + 0.14, Z], [cx - 0.2, SEED_Y + 0.5, Z], [cx - 0.06, YS - 0.02, 0.01], [cx + 0.13, YS + 0.1, 0.01], [cx + 0.31, YS - 0.03, 0.01], [cx + 0.38, YS - 0.26, Z], [cx + 0.38, YS - 0.42, Z]];
    stemTube(arch, [0.058, 0.06, 0.064, 0.066, 0.064, 0.058, 0.05, 0.046], 10, SEED_Y - 0.1, YS - 0.1);
    const exposed = tear(0.03, -0.09, 0.42, 0.27, 4.3);
    place(beanGeo({ L: 0.72, fat: 1.08, seed: 14, exposed }), cx + 0.4, YS - 0.62, 0.05, Math.PI / 2 + 0.2);
    rootSystem(J, cx - 0.16, 1.4, { branches: 7, hairs: 80, r0: 0.056, spread: 0.68 });
  }

  // 5: the hook has straightened and lifted the two seed halves into the light, its coat dropped on the soil.
  {
    const cx = CX(4);
    const J = [cx, YS - 0.72, Z];
    const top = [cx + 0.03, YS + 1.02, 0.02];
    stemTube([J, [cx - 0.03, YS - 0.3, Z], [cx + 0.01, YS + 0.2, 0.01], [cx - 0.01, YS + 0.65, 0.015], top], [0.06, 0.062, 0.062, 0.058, 0.05], 10);
    for (const s of [-1, 1]) {
      const g = cotyledonGeo(0.6, 0.4, 0.2, { seed: 20 + s });
      // Turned about their own length so the broad fleshy faces look up and toward the viewer.
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(s > 0 ? 0.95 : -0.95));
      const m = new THREE.Matrix4().makeRotationZ(s * 0.42 + (s < 0 ? Math.PI : 0));
      m.setPosition(top[0] - s * 0.01, top[1] - 0.01, top[2]);
      g.applyMatrix4(m);
      greens.push({ geometry: g, keepColor: true });
    }
    // The first leaves, still folded together, showing between the two seed halves.
    for (const s of [-1, 1]) {
      const g = trueLeafGeo([top[0], top[1] + 0.02, top[2]], [s * 0.3, 1, 0.14], [0, 0, 1], 0.24, 0.07);
      leaves.push({ geometry: g, color: 0x8fc63c });
    }
    rootSystem(J, cx, 1.7, { branches: 10, hairs: 90, r0: 0.058, spread: 0.72 });
    // The empty coat, lying on the soil where it fell.
    const coat = beanGeo({ L: 0.42, fat: 0.82, seed: 15, wrinkle: 0.022 });
    coat.scale(1, 0.5, 1);
    const m = new THREE.Matrix4().makeRotationZ(0.1);
    m.setPosition(cx + 0.42, ground(cx + 0.42) + 0.035, 0.1);
    coat.applyMatrix4(m);
    greens.push({ geometry: coat, keepColor: true });
  }

  // 6: the seedling. The seed halves have shrunk and withered as the leaves took over making its food.
  {
    const cx = CX(5);
    const J = [cx, YS - 0.72, Z];
    const node = [cx - 0.01, YS + 0.82, 0.02];
    const apex = [cx + 0.02, YS + 1.72, 0.03];
    stemTube([J, [cx - 0.03, YS - 0.3, Z], [cx + 0.01, YS + 0.26, 0.012], node, [cx + 0.03, YS + 1.26, 0.03], apex], [0.066, 0.07, 0.07, 0.062, 0.05, 0.036], 10);
    for (const s of [-1, 1]) {
      const g = cotyledonGeo(0.27, 0.17, 0.06, { tone: 0xb3a646, tip: 0x9a7f34, wrinkle: 0.012, seed: 30 + s });
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(s > 0 ? 0.8 : -0.8));
      const m = new THREE.Matrix4().makeRotationZ(s * -0.55 + (s < 0 ? Math.PI : 0));
      m.setPosition(node[0], node[1], node[2]);
      g.applyMatrix4(m);
      greens.push({ geometry: g, keepColor: true });
    }
    // A pair of opposite leaves on their stalks, turned to face the light and the viewer.
    for (const s of [-1, 1]) {
      const end = [apex[0] + s * 0.2, apex[1] + 0.15, apex[2] + 0.05];
      const g = tube([[apex[0], apex[1] - 0.04, apex[2]], [apex[0] + s * 0.1, apex[1] + 0.08, apex[2] + 0.03], end], [0.026, 0.021, 0.018], { sides: 7, steps: 8, round: 1 });
      greens.push({ geometry: g, color: 0x7fb335 });
      leaves.push({ geometry: trueLeafGeo(end, [s * 0.84, 0.42, 0.1], [0, 0.42, 1], 0.66, 0.3), color: 0x8fc63c });
    }
    // The bud between them, the next leaves already coming.
    leaves.push({ geometry: trueLeafGeo([apex[0], apex[1] - 0.02, apex[2]], [0.06, 1, 0.08], [0, 0, 1], 0.2, 0.05), color: 0x9ed24c });
    rootSystem(J, cx, 1.76, { branches: 14, hairs: 120, sub: 1, r0: 0.064, spread: 0.74 });
  }

  // --- The frame ----------------------------------------------------------------------------------
  const wood = [];
  const OAK = lin(0xa87745); const OAK_D = lin(0x8a5f34); const BOARD = lin(0xc6e0ec);
  const ZF = 0.3; const ZB = -1.0;
  slab(wood, -5.0, -IX, 0, 6.0, ZB, ZF, OAK, 'y');
  slab(wood, IX, 5.0, 0, 6.0, ZB, ZF, OAK, 'y');
  slab(wood, -IX, IX, YT, 6.0, ZB, ZF, OAK);
  slab(wood, -IX, IX, 0.06, YB, ZB, ZF, OAK);
  // A little ledge at the soil's foot, and feet so it stands.
  slab(wood, -IX, IX, YB - 0.04, YB + 0.05, 0.0, ZF, OAK_D);
  for (const x of [-4.86, 4.86]) slab(wood, x - 0.2, x + 0.2, 0, 0.24, -1.7, 1.0, OAK_D, 'z');
  // The back board, the colour of the sky, behind the soil and the air alike.
  slab(wood, -IX, IX, YB, YT, ZB, ZB + 0.2, BOARD);
  { const U = wood[wood.length - 1].geometry.attributes.uv; for (let i = 0; i < U.count; i++) U.setXY(i, 0.5, 0.5 + i * 0.001); }

  // --- The number plaques --------------------------------------------------------------------------
  const CELL = 128;
  const numbers = canvasTexture(CELL * BEAN_STAGES, CELL, (ctx) => {
    for (let i = 0; i < BEAN_STAGES; i++) {
      const cx = (i + 0.5) * CELL;
      ctx.fillStyle = '#f5efdc';
      ctx.fillRect(i * CELL, 0, CELL, CELL);
      ctx.fillStyle = '#2b1c10';
      ctx.font = 'bold 92px Georgia, serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), cx, CELL * 0.54);
    }
  });
  const plaques = []; const brass = [];
  for (let i = 0; i < BEAN_STAGES; i++) {
    const g = new THREE.CircleGeometry(0.2, 32);
    const U = g.attributes.uv;
    for (let k = 0; k < U.count; k++) U.setX(k, (U.getX(k) + i) / BEAN_STAGES);
    g.translate(CX(i), 0.3, ZF + 0.022);
    plaques.push({ geometry: g, color: 0xffffff });
    const ring = lathe([[0, -0.03], [0.235, -0.03], [0.235, 0.0], [0.22, 0.02], [0, 0.02]], 36).rotateX(Math.PI / 2).translate(CX(i), 0.3, ZF);
    brass.push({ geometry: ring, color: 0xb08d4e });
  }

  const root = new THREE.Group();
  root.name = 'seed-germination';
  const grain = streakMap(7704, { size: 256, lines: 170, dark: 196, alpha: 0.5, base: '#f6f6f6', bow: 12 });
  root.add(mesh(mergeParts([{ geometry: faceG, color: 0xffffff }, { geometry: topG, color: 0xffffff }]), standard({ map: soil, bumpMap: soil, bumpScale: 1.6, roughness: 0.94, metalness: 0 })));
  root.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grain, bumpMap: grain, bumpScale: 0.35, roughness: 0.7, metalness: 0 })));
  root.add(mesh(mergeParts([...greens, ...white, ...brass]), standard({ vertexColors: true, roughness: 0.48, metalness: 0 })));
  const veins = leafVeinMap(7705);
  root.add(mesh(mergeParts(leaves), standard({ vertexColors: true, map: veins, bumpMap: veins, bumpScale: 0.6, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(plaques), standard({ map: numbers, roughness: 0.42, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// African elephant
// ---------------------------------------------------------------------------------------------

// The hide, painted once across the whole animal on a seamless skew projection (`skewUV`): v follows the
// height and u the length, each with a little of the distance from the midline mixed in, so a surface facing
// forward does not smear and a fold drawn at a known height and length lands there on the model. Both flanks
// read the same painting. It is near white, so the vertex colours keep the hue, and the same canvas is the
// bump map, which is what gives every crack an edge.
const HIDE = { U0: -7.6, US: 20.8, V0: -0.3, VS: 13.2, W: 2048, H: 1300 };
const hideU = (z, ax) => (z + 0.6 * ax - HIDE.U0) / HIDE.US;
const hideV = (y, ax) => (y + 0.35 * ax - HIDE.V0) / HIDE.VS;
function skewUV(geometry) {
  const P = geometry.attributes.position;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const ax = Math.abs(P.getX(i));
    uv[i * 2] = hideU(P.getZ(i), ax); uv[i * 2 + 1] = hideV(P.getY(i), ax);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

// The network of cracks: Worley F2 - F1 on a jittered wrapped grid, which is near zero on a cell boundary.
// A hide cracks into polygons for the same reason mud does, so the boundaries of a random point set are
// what those polygons are.
function crackTile(seed, size, cells, depth = 0.17) {
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = seededRandom(seed);
  const jx = new Float32Array(cells * cells); const jy = new Float32Array(cells * cells);
  for (let i = 0; i < jx.length; i++) { jx[i] = rng(); jy[i] = rng(); }
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const noise = tileNoise(seed + 1);
  for (let j = 0; j < size; j++) {
    const gy = (j / size) * cells; const cy = Math.floor(gy);
    for (let i = 0; i < size; i++) {
      const gx = (i / size) * cells; const cx = Math.floor(gx);
      let f1 = 9; let f2 = 9;
      for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
          const k = ((cx + a + cells) % cells) + ((cy + b + cells) % cells) * cells;
          const dx = cx + a + jx[k] - gx; const dy = (cy + b + jy[k] - gy) * 1.25;
          const q = dx * dx + dy * dy;
          if (q < f1) { f2 = f1; f1 = q; } else if (q < f2) f2 = q;
        }
      }
      const e = Math.sqrt(f2) - Math.sqrt(f1);
      const crack = 1 - sstep(e, 0.02, 0.16);
      // Each plate of skin is a little domed, brightest at its middle.
      const dome = sstep(e, 0.08, 0.55);
      const blotch = noise((gx / cells) * 16, (gy / cells) * 16);
      const v = (226 + dome * 22 + blotch * 7) * (1 - crack * depth);
      const k = (i + j * size) * 4;
      d[k] = v; d[k + 1] = v; d[k + 2] = v; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function hideAtlas() {
  const { W, H } = HIDE;
  const rng = seededRandom(8801);
  const tile = crackTile(8802, 512, 60);
  return canvasTexture(W, H, (ctx) => {
    for (let y = 0; y < H; y += 512) for (let x = 0; x < W; x += 512) ctx.drawImage(tile, x, y);
    // A fold is a dark cut with a lit lip beside it. Given in the animal's own feet.
    const fold = (pts, width, dark = 0.74) => {
      const P = pts.map(([z, y, ax]) => [hideU(z, ax) * W, H - hideV(y, ax) * H]);
      const trace = (ox, oy) => {
        ctx.beginPath();
        P.forEach(([a, b], i) => {
          if (i === 0) { ctx.moveTo(a + ox, b + oy); return; }
          const [p, q] = P[i - 1];
          ctx.quadraticCurveTo(p + ox, q + oy, (p + a) / 2 + ox, (q + b) / 2 + oy);
        });
        ctx.lineTo(P[P.length - 1][0] + ox, P[P.length - 1][1] + oy);
      };
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(255,255,255,${dark * 0.55})`; ctx.lineWidth = width * 1.1;
      trace(width * 0.55, width * 0.8); ctx.stroke();
      ctx.strokeStyle = `rgba(70,66,62,${dark * 0.8})`; ctx.lineWidth = width;
      trace(0, 0); ctx.stroke();
    };
    const j = (a) => (rng() - 0.5) * a;
    // Rings round each leg at the joints, where the skin has to bunch.
    const LEGS = [[2.92, 2.05, 1.0], [-3.95, 2.0, 1.05]];
    const ring = (zc, ax, half, y, width, dark) => {
      const pts = [];
      for (let q = -1; q <= 1.001; q += 0.34) pts.push([zc + q * half, y + j(0.08) + Math.cos(q * 1.6) * 0.08, ax]);
      fold(pts, width, dark);
    };
    for (const [zc, ax, half] of LEGS) {
      for (let y = 2.1; y < 3.75; y += 0.17 + rng() * 0.09) ring(zc, ax, half * 1.25, y, 2.4 + rng() * 2.6, 0.7);
      for (let y = 0.72; y < 1.5; y += 0.17 + rng() * 0.08) ring(zc, ax, half * 1.2, y, 2 + rng() * 2, 0.62);
      for (let y = 4.5; y < 5.3; y += 0.28 + rng() * 0.14) ring(zc, ax, half * 0.95, y, 2 + rng() * 2.4, 0.5);
    }
    // Long loose folds: behind the shoulder, in front of the hip, and the slack skin of the flank between.
    const flank = (z0, y0, y1, width, lean = 0, ax = 2.8) => {
      const pts = [];
      const n = 7;
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push([z0 + lean * t + j(0.2) + Math.sin(t * 5) * 0.08, mix(y0, y1, t), ax]); }
      fold(pts, width, 0.42);
    };
    for (const [z0, n, lean, y0, y1] of [[1.0, 5, 0.5, 9.4, 5.6], [-1.9, 5, -0.55, 9.4, 5.4], [-0.5, 5, 0.1, 9.0, 5.6]]) {
      for (let i = 0; i < n; i++) flank(z0 + i * 0.3 + j(0.14), y0 - rng() * 2.2, y1 + rng() * 1.8, 2 + rng() * 2.6, lean);
    }
    // Slack over the belly and in the armpit.
    for (let i = 0; i < 26; i++) {
      const z = mix(-3, 1.8, rng()); const y = 5 + rng() * 1.5;
      fold([[z, y, 2.6], [z + 0.6 + j(0.2), y + 0.14 + j(0.1), 2.6], [z + 1.3, y + j(0.2), 2.6]], 2 + rng() * 2, 0.5);
    }
    // Across the forehead and round the base of the trunk, level lines that bend with the face.
    for (let i = 0; i < 12; i++) {
      const y = 7.7 + i * 0.27 + j(0.08);
      const z = 7.45 - (y - 7.6) * 0.42;
      fold([[z - 0.1, y + 0.1, 1.2], [z + 0.15, y, 0.7], [z + 0.3, y - 0.03, 0.2], [z + 0.3, y - 0.03, 0.0]], 2.2 + rng() * 2.2, 0.56);
    }
    // Crow's feet, running back from the eye.
    for (let i = 0; i < 8; i++) {
      const a = 2.4 + (i / 7) * 1.5;
      const len = 0.5 + rng() * 0.5;
      fold([[7.0 + Math.cos(a) * 0.3, 9.2 + Math.sin(a) * 0.3, 1.42], [7.0 + Math.cos(a) * len, 9.2 + Math.sin(a) * len, 1.42]], 2.2, 0.6);
    }
  });
}

function earPainting() {
  // Colour and bump are separate here, because a vein stands proud and a dark line in a bump map cuts in.
  const W = 768; const H = 1024;
  const SW = 5.0; const SH = 7.0; // the ear's own feet, u = s / SW, v = (h + 4.8) / SH
  const toPx = (s, h) => [(s / SW) * W, H - ((h + 4.8) / SH) * H];
  const veins = [];
  const rng = seededRandom(8803);
  // Veins divide and carry on outward and never turn back, so they fan rather than tangle: a child leaves
  // its parent at a shallow angle, and the whole tree stays inside the wedge its main trunk started in.
  const grow = (s, h, angle, width, depth, lo, hi) => {
    let a = angle; let x = s; let y = h;
    const steps = 3 + Math.floor(rng() * 2);
    const line = [[x, y]];
    for (let i = 0; i < steps; i++) {
      a = Math.max(lo, Math.min(hi, a + (rng() - 0.5) * 0.24));
      const L = 0.26 + rng() * 0.2;
      x += Math.cos(a) * L; y += Math.sin(a) * L;
      line.push([x, y]);
    }
    veins.push({ line, width });
    if (depth > 0 && width > 1.8) {
      const mid = (lo + hi) / 2; const span = (hi - lo) / 2;
      grow(x, y, mid - span * 0.5, width * 0.7, depth - 1, lo, mid);
      grow(x, y, mid + span * 0.5, width * 0.7, depth - 1, mid, hi);
    }
  };
  // The big veins fan out from the root of the ear, where the blood comes in.
  const FAN = [1.2, 0.72, 0.28, -0.14, -0.56, -0.98, -1.42, -1.8];
  for (let i = 0; i < FAN.length - 1; i++) grow(0.16, 0.08, (FAN[i] + FAN[i + 1]) / 2, 10 - i * 0.4, 3, FAN[i + 1] + 0.03, FAN[i] - 0.03);
  const drawVeins = (ctx, style, k = 1) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = style;
    for (const { line, width } of veins) {
      ctx.lineWidth = width * k;
      ctx.beginPath();
      line.forEach(([s, h], i) => { const [x, y] = toPx(s, h); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
  };
  const tile = crackTile(8804, 256, 30, 0.14);
  const color = canvasTexture(W, H, (ctx) => {
    for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(tile, x, y);
    drawVeins(ctx, 'rgba(70,62,76,0.42)');
    drawVeins(ctx, 'rgba(250,240,240,0.14)', 0.4);
  });
  const bump = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#6c6c6c';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.6;
    for (let y = 0; y < H; y += 256) for (let x = 0; x < W; x += 256) ctx.drawImage(tile, x, y);
    ctx.globalAlpha = 1;
    drawVeins(ctx, '#e8e8e8', 1.05);
  });
  bump.colorSpace = THREE.NoColorSpace;
  return { color, bump };
}

// One ear in its own frame (s out from the head, h up from the root), a real slab: every point has a front
// and a back and a closing rim, because a thing that spreads out in the sun has to have thickness. It is an
// ear like the map of Africa: a broad top, a great rounded outer edge and a long narrow lobe at the bottom.
function earGeometry() {
  const rows = [
    [2.2, 0.95, 1.9], [1.98, 0.42, 3.05], [1.45, 0.14, 3.88], [0.82, 0, 4.42], [0, 0, 4.72], [-0.8, 0.05, 4.56],
    [-1.6, 0.25, 4.06], [-2.4, 0.5, 3.36], [-3.2, 0.82, 2.58], [-4.0, 1.08, 2.0], [-4.5, 1.3, 1.72], [-4.72, 1.5, 1.56],
  ];
  const vs = rows.map((_, i) => i / (rows.length - 1));
  const hT = hermiteTable(vs, rows.map((r) => r[0]));
  const inT = hermiteTable(vs, rows.map((r) => r[1]));
  const outT = hermiteTable(vs, rows.map((r) => r[2]));
  // A few old tears in the edge, which a wild elephant's ears always have.
  const NICKS = [[0.3, 0.16], [0.47, 0.1], [0.62, 0.2], [0.71, 0.09]];
  const nick = (v) => NICKS.reduce((acc, [c, d]) => acc - d * Math.exp(-(((v - c) / 0.012) ** 2)), 0);
  const sOf = (u, v) => mix(inT(v), outT(v) + nick(v) + 0.05 * Math.sin(v * 37), u);
  const nu = 26; const nv = 36;
  const g = solidSurface({
    nu, nv,
    point: (u, v) => {
      const s = sOf(u, v); const h = hT(v);
      // Cupped gently, the top rolled over toward the back, and rippled across the big veins.
      const cup = 0.42 * Math.sin(Math.PI * u) * Math.sin(Math.PI * clamp01(v * 1.1));
      const roll = -0.3 * (1 - sstep(v, 0, 0.12)) ** 2;
      const edge = -0.26 * sstep(u, 0.72, 1) ** 2;
      const ripple = 0.05 * Math.sin(u * 15 + v * 8) * sstep(u, 0.15, 0.5);
      return [s, h, cup + roll + edge + ripple];
    },
    thick: (u, v) => (0.05 + 0.06 * (1 - u) * sstep(v, 0, 0.1)) * (1 - 0.75 * sstep(v, 0.82, 1)),
    closedU: false,
  });
  // The UVs in feet, so the veins sit where they were drawn.
  const UV = g.attributes.uv;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const k = side * (nu + 1) * (nv + 1) + i * (nv + 1) + j;
        UV.setXY(k, sOf(i / nu, j / nv) / 5.0, (hT(j / nv) + 4.8) / 7.0);
      }
    }
  }
  return g;
}

// True size, with the catalogue's 0.6 applied by the record. What makes this the African animal, in the order
// the eye takes it: the enormous fan ears; the concave back, high at the shoulder and again at the hip; the
// forehead sloping back in one plane rather than the Asian elephant's two domes; long legs under a body carried
// high; and the two fingers at the end of the trunk. It has four toenails on each front foot and three on each
// hind, the usual count for this species (individuals vary).
function africanElephant() {
  const rng = seededRandom(8805);
  const GREY = lin(0x8b8883);
  // --- The body, with the legs growing out of it -------------------------------------------------
  const body = new Sculpt(0.26);
  const torso = axisLoft([
    [-6.7, 7.9, 0.25, 0.3, 0.3],
    [-6.2, 7.85, 1.75, 1.9, 2.1],
    [-5.0, 7.75, 2.55, 2.5, 2.75],
    [-3.4, 7.75, 2.9, 2.5, 2.85],
    [-1.1, 7.75, 3.1, 2.2, 2.85],
    [1.0, 7.95, 3.05, 2.5, 2.9],
    [2.7, 8.1, 2.65, 2.85, 2.95],
    [4.2, 8.2, 2.1, 2.62, 2.5],
    [5.3, 8.7, 1.45, 1.75, 1.75],
  ]);
  body.add(torso, GREY);
  // The ridge of the spine along the concave back.
  const backY = (z) => torso.centre(z) + torso.above(z) - 0.2;
  body.add(curveP([-5.4, -3.6, -1.4, 0.8, 2.6, 4.0].map((z) => [0, backY(z), z]), [0.28, 0.3, 0.24, 0.26, 0.34, 0.3], 18), GREY, { k: 0.55 });
  const FEET = [];
  for (const s of [1, -1]) {
    const fz = s > 0 ? 3.2 : 2.65; // a slight stride, so it stands rather than being stood
    const hz = s > 0 ? -4.35 : -3.95;
    // Shoulder blade and hip bone, which show through the hide on a big animal.
    body.add(ellipsoidP([s * 2.45, 9.05, 2.85], [0.55, 1.5, 1.05], [0, 0, s * 0.14]), GREY, { k: 0.7 });
    body.add(ellipsoidP([s * 1.8, 9.25, -4.05], [0.75, 1.0, 1.2]), GREY, { k: 0.8 });
    // The front leg: a straight pillar, the elbow against the chest and the wrist a soft bulge.
    body.add(curveP([[s * 2.1, 8.4, 2.85], [s * 2.2, 6.2, fz - 0.05], [s * 2.15, 4.6, fz], [s * 2.1, 2.9, fz + 0.06], [s * 2.1, 1.4, fz + 0.05], [s * 2.1, 0.5, fz + 0.1]], [1.6, 1.18, 0.95, 0.9, 0.8, 0.86], 26), GREY, { k: 1.0 });
    body.add(ellipsoidP([s * 2.12, 2.9, fz + 0.14], [0.86, 0.72, 0.9]), GREY, { k: 0.4 });
    // The hind leg: a great thigh, the knee low on the leg and pointing forward, a straight shin.
    body.add(curveP([[s * 2.0, 8.1, -4.45], [s * 2.15, 6.0, hz + 0.25], [s * 2.1, 4.3, hz + 0.5], [s * 2.05, 2.5, hz + 0.02], [s * 2.05, 1.2, hz + 0.08], [s * 2.05, 0.5, hz + 0.15]], [1.9, 1.48, 1.08, 0.82, 0.76, 0.82], 26), GREY, { k: 1.1 });
    body.add(ellipsoidP([s * 2.08, 4.25, hz + 0.72], [0.82, 0.74, 0.72]), GREY, { k: 0.5 });
    // Round feet, broad at the ground: an elephant walks on a cushion of fat behind its toes.
    const FH = [s * 2.1, 0.52, fz + 0.18]; const HF = [s * 2.05, 0.5, hz + 0.2];
    body.add(ellipsoidP(FH, [1.0, 0.6, 1.06]), GREY, { k: 0.3 });
    body.add(ellipsoidP(HF, [0.92, 0.58, 1.1]), GREY, { k: 0.3 });
    FEET.push({ c: FH, n: 4, spread: 0.46 }, { c: HF, n: 3, spread: 0.54 });
  }
  body.sub({ box: [-9, -2, -12, 9, 0, 12], f: (x, y) => y });
  // Grooves the big folds lie in, walked onto the surface, so they catch the sun as well as being painted.
  const bodyField = body.snapshot();
  const grooves = [];
  for (const s of [1, -1]) {
    for (const pts of [
      [[s * 3.4, 10, 1.15], [s * 3.4, 8.2, 1.0], [s * 3.4, 6.3, 1.4], [s * 2.8, 5.0, 1.7]],
      [[s * 3.4, 9.9, -2.15], [s * 3.4, 8.0, -2.6], [s * 3.3, 6.2, -2.6], [s * 2.8, 5.2, -2.3]],
      [[s * 3.4, 9.6, 0.3], [s * 3.4, 7.7, 0.45], [s * 3.1, 5.6, 0.6]],
      [[s * 3.4, 6.0, 3.9], [s * 3.2, 5.0, 4.0], [s * 2.9, 5.1, 2.0]],
    ]) grooves.push(pathOn(bodyField, pts, 12, 0));
  }
  for (const path of grooves) body.sub(segsP(path, path.map(() => 0.08)), null, { k: 0.26 });

  const bodyOps = body.ops;
  const footDust = lin(0x8d7a68); const bellyDark = lin(0x6e665e); const backLight = lin(0xa39887);
  const skinTint = (ops, reach) => (x, y, z, nx, ny, nz, rgb) => {
    const open = clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
    const ao = mix(0.52, 1, open);
    const n = smoothNoise3(x * 0.75, y * 0.75, z * 0.75);
    const n2 = smoothNoise3(x * 2.3 + 5, y * 2.3, z * 2.3);
    let r = GREY[0] * (0.9 + 0.22 * n); let g = GREY[1] * (0.9 + 0.22 * n); let b = GREY[2] * (0.9 + 0.22 * n);
    // Darker in the belly's shade, dusty along the back and red with earth up the legs.
    const under = sstep(-ny, 0.2, 0.8) * sstep(y, 3.8, 5.2);
    r = mix(r, bellyDark[0], under); g = mix(g, bellyDark[1], under); b = mix(b, bellyDark[2], under);
    const up = sstep(ny, 0.5, 0.95) * 0.55;
    r = mix(r, backLight[0], up); g = mix(g, backLight[1], up); b = mix(b, backLight[2], up);
    const dust = (1 - sstep(y, 0.4, 3.6 + n2 * 1.6)) * 0.62;
    r = mix(r, footDust[0], dust); g = mix(g, footDust[1], dust); b = mix(b, footDust[2], dust);
    rgb[0] = r * ao; rgb[1] = g * ao; rgb[2] = b * ao;
  };
  const bodyGeo = polygonize(body, { uvScale: 1, tint: skinTint(bodyOps, 0.6), extraReach: 0.1 });

  // --- The head ----------------------------------------------------------------------------------
  const head = new Sculpt(0.125);
  head.add(ellipsoidP([0, 9.15, 4.6], [1.72, 1.9, 1.5]), GREY); // the neck, sunk into the shoulders
  head.add(ellipsoidP([0, 10.05, 5.95], [1.55, 1.72, 1.5], [0.2, 0, 0]), GREY, { k: 0.7 }); // the skull
  head.add(ellipsoidP([0, 8.85, 7.0], [1.3, 2.15, 0.95], [-0.46, 0, 0]), GREY, { k: 0.6 }); // the sloped forehead
  head.add(ellipsoidP([0, 6.65, 6.55], [0.98, 0.9, 1.05]), GREY, { k: 0.55 }); // the lower jaw
  head.add(ellipsoidP([0, 6.05, 7.25], [0.42, 0.52, 0.55], [0.6, 0, 0]), GREY, { k: 0.3 }); // the pointed lower lip
  head.add(curveP([[0, 8.7, 7.5], [0, 7.5, 8.2], [0, 6.35, 8.55]], [1.04, 0.92, 0.74], 12), GREY, { k: 0.6 }); // the trunk's root
  for (const s of [1, -1]) {
    head.add(ellipsoidP([s * 0.98, 7.55, 6.3], [0.66, 1.05, 1.05]), GREY, { k: 0.5 }); // the cheek
    head.add(curveP([[s * 0.72, 8.25, 7.25], [s * 0.94, 7.0, 8.0], [s * 1.06, 6.3, 8.5]], [0.64, 0.58, 0.47], 10), GREY, { k: 0.34 }); // the tusk's sleeve
    head.add(torusP3([s * 1.08, 6.27, 8.53], [s * 0.2, -0.7, 0.68], 0.44, 0.1), GREY, { k: 0.12 }); // the lip of the sleeve
    head.add(ellipsoidP([s * 1.42, 10.35, 5.0], [0.42, 1.15, 0.55]), GREY, { k: 0.5 }); // the root of the ear
    head.sub(ellipsoidP([s * 1.72, 9.75, 5.95], [0.5, 0.7, 0.62]), null, { k: 0.5 }); // the sunken temple
    // The corner of the mouth, running back from under the tusk.
    head.sub(curveP([[s * 0.72, 6.7, 7.3], [s * 1.0, 6.85, 6.75], [s * 1.26, 7.2, 6.1]], [0.05, 0.05, 0.03], 8), null, { k: 0.12 });
  }
  const headField = head.snapshot();
  // The eyes are small and set low on the side of the face, under a heavy brow.
  const EYES = [1, -1].map((s) => {
    const p = onSurface(headField, [s * 1.7, 9.15, 7.0]);
    const n = fieldNormal(headField, p);
    head.add(torusP3(p, n, 0.235, 0.085), GREY, { k: 0.08 });
    head.add(ellipsoidP([p[0] + n[0] * 0.05, p[1] + 0.22, p[2] + n[2] * 0.05], [0.26, 0.09, 0.34]), GREY, { k: 0.1 }); // brow
    head.sub(sphereP(p, 0.17), lin(0x241a14), { k: 0.03 });
    return { p, n, s };
  });
  const headTint = skinTint(head.ops, 0.3);
  const headGeo = polygonize(head, {
    uvScale: 1,
    extraReach: 0.05,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      headTint(x, y, z, nx, ny, nz, rgb);
      // The dark wet streak below the temporal gland, between eye and ear.
      const st = 1 - sstep(Math.hypot((Math.abs(x) - 1.72) * 1.2, (z - 6.2) / 0.28, (y - 8.75) / 0.8), 0.6, 1.1);
      rgb[0] *= 1 - st * 0.42; rgb[1] *= 1 - st * 0.42; rgb[2] *= 1 - st * 0.42;
    },
  });

  // --- The trunk: real rings, cut in along an analytic tube ----------------------------------------
  const trunkCurve = new THREE.CatmullRomCurve3([
    [0, 7.75, 8.15], [0, 6.45, 8.72], [0, 5.0, 8.96], [0, 3.6, 8.98], [0, 2.35, 9.15], [0, 1.42, 9.62], [0, 1.02, 10.34], [0, 1.3, 11.02],
  ].map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const TL = trunkCurve.getLength();
  const RING = 0.27; const STEPS = 240; const SIDES = 12;
  const TR = [0.78, 0.76, 0.66, 0.54, 0.43, 0.34, 0.28, 0.25];
  const baseR = (t) => { const f = t * (TR.length - 1); const i = Math.min(TR.length - 2, Math.floor(f)); return mix(TR[i], TR[i + 1], f - i); };
  const trunkPts = [];
  for (let i = 0; i <= 56; i++) { const p = trunkCurve.getPointAt(i / 56); trunkPts.push([p.x, p.y, p.z]); }
  const ringG = (t) => (Math.abs(Math.cos((t * TL * Math.PI) / (RING * (0.8 + t * 0.5)))) ** 5) * sstep(t, 0.05, 0.24);
  const radii = [];
  for (let i = 0; i <= STEPS * 2; i++) { const t = i / (STEPS * 2); radii.push(baseR(t) * (1 - 0.075 * ringG(t))); }
  const trunkGeo = tube(trunkPts, radii, { sides: SIDES, steps: STEPS, round: 2 });
  {
    const T = lin(0x8b8883); const FRONT = lin(0x989289); const G = lin(0x3a3632);
    tintVertices(trunkGeo, (x, y, z, out, i) => {
      const row = Math.max(0, Math.floor(i / SIDES) - 2);
      const t = clamp01(row / STEPS);
      const groove = ringG(t);
      const f = clamp01(z - 8.6) * 0.5;
      const k = 0.92 + 0.14 * smoothNoise3(x * 2, y * 2, z * 2);
      out[0] = mix(mix(T[0], FRONT[0], f) * k, G[0], groove * 0.55);
      out[1] = mix(mix(T[1], FRONT[1], f) * k, G[1], groove * 0.55);
      out[2] = mix(mix(T[2], FRONT[2], f) * k, G[2], groove * 0.55);
    });
  }
  // The tip: two fingers, the African elephant's, one above and one below, with the nostrils between them.
  const tipAt = trunkCurve.getPointAt(1); const tipD = trunkCurve.getTangentAt(1);
  const tipN = new THREE.Vector3(0, tipD.z, -tipD.y).normalize(); // up and back, in the trunk's own plane
  const pt = (a, b) => [0, tipAt.y + tipD.y * a + tipN.y * b, tipAt.z + tipD.z * a + tipN.z * b];
  // The trunk reads the part of the painting with no folds on it (behind the rump, where nothing else
  // looks), laid along its own length and round its own girth, mirrored so there is no seam.
  {
    const P = trunkGeo.attributes.position;
    const uv = new Float32Array(P.count * 2);
    const rows = Math.floor(P.count / SIDES);
    for (let i = 0; i < P.count; i++) {
      const j = i % SIDES; const row = Math.floor(i / SIDES);
      const a = Math.abs(j / SIDES - 0.5) * 2;
      uv[i * 2] = hideU(-7.5 + a * 2.6, 0);
      uv[i * 2 + 1] = hideV(1.0 + (row / rows) * 10.5, 0);
    }
    trunkGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const skinParts = [
    { geometry: skewUV(bodyGeo), keepColor: true },
    { geometry: skewUV(headGeo), keepColor: true },
    { geometry: trunkGeo, keepColor: true },
  ];
  const FING = lin(0x8d7f74);
  for (const [b, L, r] of [[-0.15, 0.42, 0.13], [0.15, 0.38, 0.13]]) {
    const g = tube([pt(-0.12, b * 0.6), pt(0.14, b), pt(L * 0.8, b * 1.1), pt(L, b * 1.0)], [r * 1.25, r * 1.1, r * 0.82, r * 0.5], { sides: 10, steps: 10, round: 2 });
    tintVertices(g, (x, y, z, out) => { out[0] = FING[0]; out[1] = FING[1]; out[2] = FING[2]; });
    const Pg = g.attributes.position; const uvg = new Float32Array(Pg.count * 2);
    for (let i = 0; i < Pg.count; i++) {
      uvg[i * 2] = hideU(-6.2 + Pg.getX(i) * 1.1 + (Pg.getY(i) - tipAt.y) * 0.7, 0);
      uvg[i * 2 + 1] = hideV(8 + (Pg.getZ(i) - tipAt.z) * 1.1 + (Pg.getY(i) - tipAt.y) * 0.7, 0);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uvg, 2));
    skinParts.push({ geometry: g, keepColor: true });
  }
  const hard = [];
  // Nostrils, two dark pits on the tip's face between the fingers.
  for (const dx of [-0.075, 0.075]) {
    const c = pt(0.16, 0);
    hard.push({ geometry: new THREE.SphereGeometry(0.07, 10, 8).scale(1, 0.78, 0.6).translate(dx, c[1], c[2]), color: 0x1a1210 });
  }

  // --- The tusks ----------------------------------------------------------------------------------
  const tuskPts = [[0.78, 7.9, 7.5], [1.0, 6.6, 8.32], [1.18, 5.62, 9.4], [1.3, 5.14, 10.55], [1.34, 5.28, 11.62], [1.26, 5.9, 12.46]];
  const tuskRad = [0.37, 0.37, 0.33, 0.27, 0.18, 0.025];
  const TS = 16; const TSTEP = 44;
  const tuskGeo = tube(tuskPts, tuskRad, { sides: TS, steps: TSTEP, round: 0 });
  {
    const IV = lin(0xf0e2bc); const STAIN = lin(0x9a7442); const TIP = lin(0xdfcb9c);
    tintVertices(tuskGeo, (x, y, z, out, i) => {
      const t = clamp01(Math.floor(i / TS) / TSTEP);
      const stain = (1 - sstep(t, 0.2, 0.42)) * 0.72;
      const growth = 0.97 + 0.05 * Math.sin(t * 120) + 0.08 * (smoothNoise3(x * 1.6, y * 1.6, z * 1.6) - 0.5);
      out[0] = mix(mix(IV[0], TIP[0], sstep(t, 0.75, 1)), STAIN[0], stain) * growth;
      out[1] = mix(mix(IV[1], TIP[1], sstep(t, 0.75, 1)), STAIN[1], stain) * growth;
      out[2] = mix(mix(IV[2], TIP[2], sstep(t, 0.75, 1)), STAIN[2], stain) * growth;
    });
  }
  hard.push({ geometry: tuskGeo, keepColor: true }, { geometry: mirrorX(tuskGeo), keepColor: true });

  // --- The toenails, asked where the foot is and sunk into it ---------------------------------------
  const bodyNow = body.snapshot();
  for (const { c, n, spread } of FEET) {
    for (let i = 0; i < n; i++) {
      const a = (i - (n - 1) / 2) * spread;
      const p = onSurface(bodyNow, [c[0] + Math.sin(a) * 1.4, 0.3, c[2] + Math.cos(a) * 1.4]);
      const out = fieldNormal(bodyNow, p);
      const g = new THREE.SphereGeometry(1, 12, 8).scale(0.24, 0.2, 0.09);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), V3(out));
      g.applyMatrix4(new THREE.Matrix4().compose(V3([p[0] - out[0] * 0.03, p[1], p[2] - out[2] * 0.03]), q, new THREE.Vector3(1, 1, 1)));
      tintVertices(g, (x, y, z, o) => { const k = 0.9 + 0.2 * sstep(y, 0.05, 0.5); o[0] = 0.33 * k; o[1] = 0.29 * k; o[2] = 0.22 * k; });
      hard.push({ geometry: g, keepColor: true });
    }
  }

  // --- The eyes and their lashes ----------------------------------------------------------------------
  for (const { p, n, s } of EYES) {
    const c = [p[0] - n[0] * 0.05, p[1] - n[1] * 0.05, p[2] - n[2] * 0.05];
    hard.push({ geometry: new THREE.SphereGeometry(0.17, 16, 12).translate(c[0], c[1], c[2]), color: 0x3a2412 });
    hard.push({ geometry: new THREE.SphereGeometry(0.1, 12, 10).translate(c[0] + n[0] * 0.09, c[1] + n[1] * 0.09, c[2] + n[2] * 0.09), color: 0x0e0806 });
    hard.push({ geometry: new THREE.SphereGeometry(0.028, 8, 6).translate(c[0] + n[0] * 0.17, c[1] + n[1] * 0.17 + 0.05, c[2] + n[2] * 0.17 + 0.04), color: 0xf0e8da });
    for (let i = 0; i < 9; i++) {
      const a = ((i - 4) / 4) * 0.95;
      const root = [p[0] + n[0] * 0.09 - s * 0.0, p[1] + 0.2 * Math.cos(a), p[2] + 0.26 * Math.sin(a)];
      const end = [root[0] + n[0] * 0.2, root[1] - 0.02 + 0.07, root[2] + 0.14 * Math.sin(a)];
      hard.push({ geometry: tube([root, end], [0.012, 0.002], { sides: 4, steps: 2, round: 0, straight: true }), color: 0x161210 });
    }
  }

  // --- The tail --------------------------------------------------------------------------------------
  const tailPts = [[0, 9.0, -6.05], [0, 8.4, -6.55], [0, 7.2, -6.82], [0, 5.9, -6.86], [0, 4.95, -6.72]];
  const tail = tube(tailPts, [0.3, 0.2, 0.12, 0.08, 0.07], { sides: 9, steps: 22, round: 2 });
  tintVertices(tail, (x, y, z, o) => { o[0] = GREY[0] * 0.86; o[1] = GREY[1] * 0.86; o[2] = GREY[2] * 0.86; });
  skinParts.push({ geometry: skewUV(tail), keepColor: true });
  // A flat tuft of wiry black bristles: they grow in two rows along the tail's end, not in a ball.
  for (let i = 0; i < 34; i++) {
    const t = rng();
    const y = mix(5.5, 4.95, t);
    const side = i % 2 ? 1 : -1;
    const root = [side * 0.03, y, -6.78 + (rng() - 0.5) * 0.08];
    const L = 0.65 + rng() * 0.7;
    const out = side * (0.08 + rng() * 0.2);
    hard.push({ geometry: tube([root, [root[0] + out * 0.5, y - L * 0.5, root[2] - 0.05], [root[0] + out, y - L, root[2] + (rng() - 0.5) * 0.12]], [0.016, 0.012, 0.002], { sides: 4, steps: 4, round: 0 }), color: 0x14100c });
  }

  // --- The ears ----------------------------------------------------------------------------------------
  // Spread out from the head and swung back, the way an animal holds them to lose heat.
  const earL = earGeometry();
  {
    const e1 = new THREE.Vector3(0.72, 0.0, -0.69).normalize();
    const e2Raw = new THREE.Vector3(-0.32, 1, 0.1).normalize();
    const e3 = new THREE.Vector3().crossVectors(e1, e2Raw).normalize();
    const e2 = new THREE.Vector3().crossVectors(e3, e1).normalize();
    const m = new THREE.Matrix4().makeBasis(e1, e2, e3);
    m.setPosition(1.32, 9.95, 5.15);
    earL.applyMatrix4(m);
    earL.computeVertexNormals();
    // Which half of the vertices faces forward depends on the winding, so it is measured.
    const P = earL.attributes.position; const N = earL.attributes.normal;
    const half = P.count / 2;
    let sum = 0;
    for (let i = 0; i < half; i++) sum += N.getZ(i);
    const firstIsFront = sum > 0;
    const col = new Float32Array(P.count * 3);
    const OUTSIDE = lin(0x858480); const INSIDE = lin(0x8f8b86); const PINK = lin(0xa5908a);
    for (let i = 0; i < P.count; i++) {
      const front = i < half ? firstIsFront : !firstIsFront;
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      const d = Math.hypot(x - 1.32, y - 9.95, z - 5.15);
      const n = 0.92 + 0.18 * smoothNoise3(x * 0.9, y * 0.9, z * 0.9);
      const base = front ? INSIDE : OUTSIDE;
      const t = front ? 1 - sstep(d, 0.3, 2.2) : 0;
      col[i * 3] = mix(base[0], PINK[0], t) * n; col[i * 3 + 1] = mix(base[1], PINK[1], t) * n; col[i * 3 + 2] = mix(base[2], PINK[2], t) * n;
    }
    earL.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const earR = mirrorX(earL);

  const DZ = -2.65;
  const root = new THREE.Group();
  root.name = 'african-elephant';
  const add = (g, params) => { g.translate(0, 0, DZ); root.add(mesh(g, standard(params))); };
  const hide = hideAtlas();
  add(mergeParts(skinParts), { vertexColors: true, map: hide, bumpMap: hide, bumpScale: 1.1, roughness: 0.86, metalness: 0 });
  const ear = earPainting();
  add(mergeParts([{ geometry: earL, keepColor: true }, { geometry: earR, keepColor: true }]), { vertexColors: true, map: ear.color, bumpMap: ear.bump, bumpScale: 1.6, roughness: 0.8, metalness: 0 });
  add(mergeParts(hard), { vertexColors: true, roughness: 0.38, metalness: 0 });
  return root;
}

// A ring standing on a surface, as a field: an eye's lid.
function torusP3(c, axis, R, r) {
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

export const BUILDERS = {
  'bone-section': boneSection,
  'blood-vessel': bloodVessel,
  'beehive-cutaway': beehiveCutaway,
  'seed-germination': seedGermination,
  'african-elephant': africanElephant,
};
