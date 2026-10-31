// Builders for the Model Database's third organic set: the neuron, the kidney, the arm, the flytrap,
// the panda and the blue whale. Six very different surfaces, so this file carries three methods:
//
//  * A SCULPT WHERE THINGS JOIN. Anything that has to flow into its neighbour (a soma into its
//    dendrites, a bone's condyles, a panda) is one signed-distance surface from ModelKit.
//  * A GRID LOFT WHERE A SURFACE HAS A DIRECTION. `loftGrid` is rows along a curve and columns round
//    it, with real UVs. A muscle's fibres and a whale's throat pleats both run ALONG the length, so a
//    mesh whose lines run the same way can carry them at a fraction of the cost of a sculpt: seventy
//    pleats need only three or four columns each and hardly any rows.
//  * A PAINTED PLATE WHERE A THING IS CUT. The kidney's cut face is the Body2 method: the same fields
//    that make the solids trace the plate's outline and fill its colours, so they cannot disagree.

import * as THREE from 'three';
import { mergeParts, smoothNoise3, solidSurface, splineAt } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  lin, clamp01, mix, sstep, fieldD, sphereP, ellipsoidP, segsP, curveP, boxP, Sculpt, onSurface, fieldNormal, polygonize, tube, lathe, mirrorX, tintVertices, vesselMouth, mouthDepth, grainBump, standBase, outward, flipped, sampleCurve,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const arr = (v) => [v.x, v.y, v.z];

// Parallel-transported frames along a sampled polyline. `hint` holds the normal near one direction
// where a section has to keep its orientation (a muscle's flat side, a whale's belly).
function framesAlong(P, hint = null) {
  const n = P.length - 1;
  const C = P.map(V3);
  const out = [];
  let N = null;
  for (let i = 0; i <= n; i++) {
    const T = C[Math.min(n, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize();
    let ref = hint ? V3(hint) : (N ?? (Math.abs(T.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)));
    ref = ref.clone().addScaledVector(T, -ref.dot(T));
    if (ref.lengthSq() < 1e-8) ref.set(T.y, T.z, T.x);
    N = ref.normalize();
    const B = new THREE.Vector3().crossVectors(T, N).normalize();
    out.push({ c: C[i], T, N: N.clone(), B });
  }
  return out;
}

// A closed parametric solid: `rows` along it, `cols` round it, with UVs, a welded seam and collapsed
// poles. point(v, u) gives a position; the last column repeats the first so the map can wrap. It is
// handed through `outward`, so whichever way the caller's frames run it faces out.
function loftGrid(rows, cols, point, { uv = null, colSpacing = null } = {}) {
  const positions = []; const uvs = []; const index = [];
  const w = cols + 1;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    for (let j = 0; j <= cols; j++) {
      const u = colSpacing ? colSpacing(j / cols) : j / cols;
      const p = point(v, j === cols ? (colSpacing ? colSpacing(0) + 1 : 1) : u);
      positions.push(p[0], p[1], p[2]);
      const t = uv ? uv(v, u) : [u, v];
      uvs.push(t[0], t[1]);
    }
  }
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
  g.computeVertexNormals();
  const out = outward(g);
  const N = out.attributes.normal;
  for (let i = 0; i <= rows; i++) {
    const a = i * w; const b = a + cols;
    const x = N.getX(a) + N.getX(b); const y = N.getY(a) + N.getY(b); const z = N.getZ(a) + N.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    N.setXYZ(a, x / l, y / l, z / l); N.setXYZ(b, x / l, y / l, z / l);
  }
  // Each pole is a ring of coincident vertices: give them all one normal, or the tip creases.
  for (const row of [0, rows]) {
    let x = 0; let y = 0; let z = 0;
    const near = row === 0 ? 1 : rows - 1;
    for (let j = 0; j < cols; j++) { const k = near * w + j; x += N.getX(k); y += N.getY(k); z += N.getZ(k); }
    const l = Math.hypot(x, y, z) || 1;
    for (let j = 0; j <= cols; j++) N.setXYZ(row * w + j, x / l, y / l, z / l);
  }
  return out;
}

// Long parallel streaks, near white, for anything with a grain. Wraps in both directions.
function streakMap(seed, { size = 256, lines = 300, dark = 150, alpha = 0.5, base = '#f0f0f0', bow = 8, across = false } = {}) {
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
        if (across) { ctx.moveTo(0, x + off); ctx.quadraticCurveTo(w / 2, x + off + b, w, x + off); } else { ctx.moveTo(x + off, 0); ctx.quadraticCurveTo(x + off + b, h / 2, x + off, h); }
        ctx.stroke();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Marching squares over f(a, b), negative inside. Returns closed loops of [a, b] with the inside on
// the left, so an outer boundary is counter-clockwise and a hole clockwise.
function contour(f, [a0, b0, a1, b1], cell) {
  const na = Math.ceil((a1 - a0) / cell) + 1;
  const nb = Math.ceil((b1 - b0) / cell) + 1;
  const v = new Float32Array(na * nb);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) v[i + j * na] = f(a0 + i * cell, b0 + j * cell);
  const H = (i, j) => (i + j * na) * 2;
  const V = (i, j) => (i + j * na) * 2 + 1;
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
      const e0 = H(i, j); const e1 = V(i + 1, j); const e2 = H(i, j + 1); const e3 = V(i, j);
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

// A sculpt ended at the plane z = plane. Polygonised past the plane so the walls are true walls where
// they cross it, then the far cap is thrown away and whatever crossed is pressed onto the plane, so
// the mesh's rim lies on the plate's contour with no chamfer between them.
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

// A slow field read once onto a grid and bilinearly after that, since one section asks the same field
// for a dozen contours and each distance is a walk over a few hundred segments.
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

// Fills loops on a canvas through a mapping from model feet to pixels. Even-odd, so a loop inside a
// loop is a hole, exactly as the plate sees it.
function fillLoops(ctx, loops, map, style) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  if (style) ctx.fillStyle = style;
  ctx.fill('evenodd');
}

function traceLoops(ctx, loops, map, style, width) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
}

function clipLoops(ctx, loops, map) {
  ctx.beginPath();
  for (const loop of loops) {
    loop.forEach(([a, b], i) => {
      const [x, y] = map(a, b);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
  ctx.clip('evenodd');
}

// A cubic Hermite through unevenly spaced stations, baked to a table so a field can read it cheaply.
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

// One smooth body whose section is splined along an axis. Stations are written from the tail end
// up as [along, centre, halfWidth, above, below]: `along` runs on z (or y, with axis 'y'), `centre`
// is y (or z) and `above`/`below` are the section's two half-depths, so a belly can hang deeper than
// a back without a second solid. It is a bound rather than a true distance, but it is first-order
// right near the surface and polygonize divides by the slope.
function axisLoft(stations, axis = 'z') {
  const along = stations.map((s) => s[0]);
  const c = hermiteTable(along, stations.map((s) => s[1]));
  const w = hermiteTable(along, stations.map((s) => s[2]));
  const up = hermiteTable(along, stations.map((s) => s[3]));
  const dn = hermiteTable(along, stations.map((s) => s[4]));
  const a0 = along[0]; const a1 = along[along.length - 1];
  const wide = Math.max(...stations.map((s) => s[2]));
  const lo = Math.min(...stations.map((s) => s[1] - s[4]));
  const hi = Math.max(...stations.map((s) => s[1] + s[3]));
  const dist = (a, b, x) => {
    const t = a < a0 ? a0 : a > a1 ? a1 : a;
    const db = b - c(t);
    const rw = Math.max(1e-3, w(t));
    const rb = Math.max(1e-3, db > 0 ? up(t) : dn(t));
    const q = Math.hypot(x / rw, db / rb);
    const d = (q - 1) * Math.min(rw, rb);
    const over = a < a0 ? a0 - a : a > a1 ? a - a1 : 0;
    return over > 0 ? Math.hypot(Math.max(d, 0), over) : d;
  };
  if (axis === 'y') {
    return {
      box: [-wide, a0, lo, wide, a1, hi],
      f: (x, y, z) => dist(y, z, x),
      centre: c, width: w, above: up, below: dn,
    };
  }
  return {
    box: [-wide, lo, a0, wide, hi, a1],
    f: (x, y, z) => dist(z, y, x),
    centre: c, width: w, above: up, below: dn,
  };
}

// The surface nets' skew UVs stretch to streaks along one band of normals, which a directional bump
// shows at once. This re-lays them per triangle along its dominant axis, splitting a vertex only
// where two faces disagree. Sideways-facing skin keeps v running up the animal, so a feather or a
// scale stays the right way up, and a seam in an isotropic pattern cannot be found.
function boxUV(geometry, scale) {
  const P = geometry.attributes.position;
  const N = geometry.attributes.normal;
  const C = geometry.attributes.color;
  const idx = geometry.index;
  const pos = []; const nor = []; const col = []; const uv = []; const out = [];
  const seen = new Map();
  const put = (v, axis) => {
    const key = v * 3 + axis;
    let at = seen.get(key);
    if (at !== undefined) return at;
    at = pos.length / 3;
    seen.set(key, at);
    const x = P.getX(v); const y = P.getY(v); const z = P.getZ(v);
    pos.push(x, y, z);
    nor.push(N.getX(v), N.getY(v), N.getZ(v));
    if (C) col.push(C.getX(v), C.getY(v), C.getZ(v));
    if (axis === 0) uv.push(z * scale, y * scale);
    else if (axis === 2) uv.push(x * scale, y * scale);
    else uv.push(x * scale, z * scale);
    return at;
  };
  const ab = new THREE.Vector3(); const ac = new THREE.Vector3(); const a = new THREE.Vector3();
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t); const i1 = idx.getX(t + 1); const i2 = idx.getX(t + 2);
    a.fromBufferAttribute(P, i0);
    ab.fromBufferAttribute(P, i1).sub(a);
    ac.fromBufferAttribute(P, i2).sub(a);
    ab.cross(ac);
    const ax = Math.abs(ab.x); const ay = Math.abs(ab.y); const az = Math.abs(ab.z);
    const axis = ax >= ay && ax >= az ? 0 : az >= ay ? 2 : 1;
    out.push(put(i0, axis), put(i1, axis), put(i2, axis));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (C) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(out);
  return g;
}

// Walks a polygonised surface's own vertices in a seeded random order and hands back one per cell of a
// grid. Surface nets space their vertices evenly, so this covers a body evenly whatever its shape.
function scatterOn(geometry, spacing, rng, fn) {
  const P = geometry.attributes.position; const N = geometry.attributes.normal;
  const seen = new Set();
  const order = [];
  for (let i = 0; i < P.count; i++) order.push(i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  for (const i of order) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const key = `${Math.floor(x / spacing)},${Math.floor(y / spacing)},${Math.floor(z / spacing)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fn(x, y, z, N.getX(i), N.getY(i), N.getZ(i));
  }
}

// One overlapping lock of hair: a closed, arched, pointed solid. The thickness goes to nothing all
// round its edge, so it needs no rim, and its u and v run across and along it for the strand map.
function lockGeo(root, dir, normal, L, W, { nv = 4, lift = 0.22, droop = 0.14, th = 0.03, wave = 0 } = {}) {
  const side = new THREE.Vector3().crossVectors(normal, dir).normalize();
  return solidSurface({
    nu: 2, nv,
    point: (u, v) => {
      const U = u * 2 - 1;
      const w = (W / 2) * Math.max(0.03, (0.62 + 0.38 * sstep(v, 0, 0.36)) * (1 - v ** 2.3));
      const arch = (1 - U * U) * w * 0.34;
      const a = L * v;
      const n = L * (lift * v - lift * 0.72 * v * v) + arch;
      const s = U * w + wave * L * Math.sin(v * 3.1) * v;
      return [
        root[0] + dir.x * a + normal.x * n + side.x * s,
        root[1] + dir.y * a + normal.y * n + side.y * s - droop * L * v * v,
        root[2] + dir.z * a + normal.z * n + side.z * s,
      ];
    },
    thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * clamp01(v)),
  });
}

// A small ball sunk into something, for spines, studs and eyes.
const bead = (p, r, wide = 8, high = 6) => new THREE.SphereGeometry(r, wide, high).translate(p[0], p[1], p[2]);

// ---------------------------------------------------------------------------------------------
// Neuron
// ---------------------------------------------------------------------------------------------

// A multipolar neuron running along X, soma to the left. The soma, its primary dendrites and the
// hillock are one sculpt, so they flow into each other; everything finer is a closed tube rooted
// INSIDE the rounded end of its parent, which is what makes an open fork impossible. Every tip keeps
// a real radius and a rounded end. An octant is cut from the soma to show the nucleus, and a short
// stub of the NEXT cell's dendrite rises beside the terminals, stopping short of a bouton, because the
// card's third fact is that gap.
const NEURON = {
  soma: [-2.55, 4.3, 0],
  myelinCount: 6,
  sheath: 0.78,
  node: 0.16,
};

function neuron() {
  const rng = seededRandom(7301);
  const SOMA = NEURON.soma;
  const MAGENTA = lin(0xd9207f); const VIOLET = lin(0x6a35e6); const CORAL = lin(0xff5a3c);
  const AXON = lin(0xe01b5e);
  const body = [];
  const tubeCol = (geometry, c0, c1, t0 = 0, t1 = 1) => {
    const P = geometry.attributes.position;
    const rows = P.count;
    tintVertices(geometry, (x, y, z, out, i) => {
      const t = mix(t0, t1, i / rows);
      const n = 0.92 + 0.16 * smoothNoise3(x * 2.3, y * 2.3, z * 2.3);
      out[0] = mix(c0[0], c1[0], t) * n; out[1] = mix(c0[1], c1[1], t) * n; out[2] = mix(c0[2], c1[2], t) * n;
    });
    body.push({ geometry, keepColor: true });
  };

  // --- The soma: a pyramid-and-star of cones that all flow out of one ball --------------------
  const S = new Sculpt(0.048);
  S.add(ellipsoidP(SOMA, [0.66, 0.6, 0.56]), MAGENTA);
  const primaries = [
    { dir: [-0.14, 1, 0.1], L: 1.05, r: 0.2 }, // the big apical dendrite
    { dir: [-0.86, 0.62, 0.32], L: 1.0, r: 0.17 },
    { dir: [-1, 0.06, -0.42], L: 1.05, r: 0.18 },
    { dir: [-0.86, -0.5, 0.42], L: 1.0, r: 0.17 },
    { dir: [-0.42, -0.86, -0.42], L: 0.95, r: 0.16 },
    { dir: [0.52, -0.78, -0.42], L: 0.9, r: 0.14 },
    { dir: [0.42, 0.74, -0.62], L: 0.9, r: 0.14 },
    { dir: [-0.28, 0.2, -1], L: 0.9, r: 0.14 },
  ];
  const tips = [];
  for (const pr of primaries) {
    const d = V3(pr.dir).normalize();
    const side = new THREE.Vector3(d.z, 0.4, -d.x).normalize();
    const a = V3(SOMA);
    const m = a.clone().addScaledVector(d, pr.L * 0.6).addScaledVector(side, 0.05);
    const b = a.clone().addScaledVector(d, pr.L * 1.05).addScaledVector(side, -0.03);
    S.add(curveP([arr(a), arr(m), arr(b)], [0.36, pr.r * 1.05, pr.r * 0.72], 10), MAGENTA, { k: 0.22 });
    tips.push({ p: arr(b), dir: b.clone().sub(m).normalize(), r: pr.r * 0.72 });
  }
  // The axon hillock, the cone the axon grows from. It points along +X and a little down.
  const HILLOCK_TIP = [SOMA[0] + 1.14, SOMA[1] - 0.1, 0.03];
  S.add(curveP([SOMA, [SOMA[0] + 0.62, SOMA[1] - 0.05, 0.02], HILLOCK_TIP], [0.42, 0.17, 0.075], 12), MAGENTA, { k: 0.25 });

  // The notch: three square faces meeting inside the cell, opening toward the walk-up.
  const open = new THREE.Vector3(0.22, 0.46, 0.86).normalize();
  const e1 = new THREE.Vector3(1, 0, 0).addScaledVector(open, -open.x).normalize();
  const e2 = new THREE.Vector3().crossVectors(open, e1).normalize();
  const faces = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2;
    return open.clone().multiplyScalar(0.577).addScaledVector(e1, Math.cos(a) * 0.816).addScaledVector(e2, Math.sin(a) * 0.816);
  });
  const NOTCH_C = [SOMA[0] + open.x * 0.02, SOMA[1] + open.y * 0.02, SOMA[2] + open.z * 0.02];
  const notchF = (x, y, z) => {
    let m = -1e9;
    for (const f of faces) m = Math.max(m, -(f.x * (x - NOTCH_C[0]) + f.y * (y - NOTCH_C[1]) + f.z * (z - NOTCH_C[2])));
    return m;
  };
  const whole = S.snapshot();
  S.sub({ box: [SOMA[0] - 1.2, SOMA[1] - 1.2, SOMA[2] - 1.2, SOMA[0] + 1.2, SOMA[1] + 1.2, SOMA[2] + 1.2], f: notchF });
  const TINT_TIP = mix3(MAGENTA, VIOLET, 0.2);
  const somaGeo = polygonize(S, {
    uvScale: 1.6,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const nd = Math.hypot(x - SOMA[0], y - SOMA[1], z - SOMA[2]);
      const t = sstep(nd, 0.7, 1.2);
      const k = 0.92 + 0.16 * smoothNoise3(x * 3, y * 3, z * 3);
      rgb[0] = mix(MAGENTA[0], TINT_TIP[0], t) * k; rgb[1] = mix(MAGENTA[1], TINT_TIP[1], t) * k; rgb[2] = mix(MAGENTA[2], TINT_TIP[2], t) * k;
    },
  });
  // The three cut faces are plates, traced off the soma's own field, so their edges are razor sharp
  // where a colour change in a sculpt can only be as sharp as its grid. One painted sheet of cytoplasm
  // serves all three, and the nucleus stands in the corner as a real ball.
  const cutParts = [];
  const CUT = 1.5;
  const LIFT = 0.02;
  faces.forEach((f, i) => {
    const g = faces[(i + 1) % 3]; const h = faces[(i + 2) % 3];
    const origin = V3(NOTCH_C).addScaledVector(f, LIFT);
    const point = (a, b) => [origin.x + g.x * a + h.x * b, origin.y + g.y * a + h.y * b, origin.z + g.z * a + h.z * b];
    const field = (a, b) => {
      const [x, y, z] = point(a, b);
      return Math.max(whole.d(x, y, z) - 0.006, -a + LIFT, -b + LIFT);
    };
    const loops = contour(field, [-0.1, -0.1, CUT, CUT], 0.018);
    const uvAt = (a, b) => [(a / CUT) * 0.5 + (i % 2) * 0.5, (b / CUT) * 0.5 + (i > 1 ? 0.5 : 0)];
    cutParts.push({ geometry: plate(loops, point, uvAt, arr(f)), color: 0xffffff });
  });
  const cutRng = seededRandom(7304);
  const cutMap = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#fbd2b8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      const x = cutRng() * w; const y = cutRng() * h; const r = 6 + cutRng() * 22;
      ctx.fillStyle = cutRng() > 0.5 ? 'rgba(255,170,150,0.2)' : 'rgba(255,236,214,0.3)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, cutRng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    // Nissl bodies: stacks of rough reticulum, soft violet flecks in clusters.
    for (let c = 0; c < 70; c++) {
      const cx = cutRng() * w; const cy = cutRng() * h; const a = cutRng() * 3.14;
      for (let i = 0; i < 9; i++) {
        const o = (i - 4) * 5.5;
        ctx.strokeStyle = 'rgba(112,44,158,0.8)';
        ctx.lineWidth = 2.6;
        const dx = Math.cos(a); const dy = Math.sin(a);
        const L = 9 + cutRng() * 12;
        ctx.beginPath();
        ctx.moveTo(cx - dy * o - dx * L, cy + dx * o - dy * L);
        ctx.quadraticCurveTo(cx - dy * o + dy * 3, cy + dx * o - dx * 3, cx - dy * o + dx * L, cy + dx * o + dy * L);
        ctx.stroke();
      }
    }
    // Mitochondria: small orange capsules with a pale inner line, because a cell body is a power plant.
    for (let i = 0; i < 70; i++) {
      const x = cutRng() * w; const y = cutRng() * h; const a = cutRng() * 3.14; const L = 13 + cutRng() * 9;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = '#e8632b';
      ctx.beginPath(); ctx.ellipse(0, 0, L, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ffc48f'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-L * 0.65, 0); ctx.lineTo(-L * 0.3, -3); ctx.lineTo(0, 3); ctx.lineTo(L * 0.3, -3); ctx.lineTo(L * 0.65, 0); ctx.stroke();
      ctx.restore();
    }
  });
  // Nucleus, chromatin mottling and a bright nucleolus half sunk in it.
  const NUC_C = [SOMA[0] + open.x * 0.13, SOMA[1] + open.y * 0.13, SOMA[2] + open.z * 0.13];
  const NUC_R = 0.335;
  const nucG = new THREE.SphereGeometry(NUC_R, 36, 24).translate(NUC_C[0], NUC_C[1], NUC_C[2]);
  const NUC_A = lin(0x1a2aa8); const NUC_B = lin(0x4a6cf0);
  tintVertices(nucG, (x, y, z, out) => {
    const s = sstep(smoothNoise3(x * 8, y * 8, z * 8), 0.42, 0.66);
    out[0] = mix(NUC_A[0], NUC_B[0], s); out[1] = mix(NUC_A[1], NUC_B[1], s); out[2] = mix(NUC_A[2], NUC_B[2], s);
  });
  body.push({ geometry: nucG, keepColor: true });
  const nucDir = open.clone().add(new THREE.Vector3(0.34, 0.2, -0.1)).normalize();
  body.push({ geometry: new THREE.SphereGeometry(0.115, 22, 16).translate(NUC_C[0] + nucDir.x * (NUC_R - 0.03), NUC_C[1] + nucDir.y * (NUC_R - 0.03), NUC_C[2] + nucDir.z * (NUC_R - 0.03)), color: 0xffb01f });
  body.push({ geometry: somaGeo, keepColor: true });

  // --- The dendritic tree ----------------------------------------------------------------------
  // The tree fills a soft egg round the soma rather than a box: a branch nearing the edge simply gets
  // shorter and stops, because one that turns back at a wall draws the wall.
  const REACH = (p) => {
    const dx = p[0] - SOMA[0]; const dy = p[1] - SOMA[1]; const dz = p[2] - SOMA[2];
    return Math.hypot(dx / (dx < 0 ? 3.3 : 1.9), dy / (dy > 0 ? 2.72 : 3.0), dz / 1.9);
  };
  const steer = (p, d, L) => {
    // Bias outward, away from the soma, so the forks spread instead of tangling.
    const out = V3(p).sub(V3(SOMA)).normalize();
    d.addScaledVector(out, 0.2).normalize();
    // Keep off the stand's post under the soma.
    const q = V3(p).addScaledVector(d, L);
    if (q.y < SOMA[1] - 0.6 && Math.hypot(q.x - SOMA[0], q.z) < 0.42) { d.x -= 0.5; d.normalize(); }
    if (q.x > -1.15) { d.x -= 0.5; d.normalize(); }
  };
  const spines = [];
  const LEN = [0, 0.82, 0.74, 0.58, 0.42];
  const grow = (start, dir0, level, r0) => {
    let L = LEN[level] * (0.82 + rng() * 0.36);
    const d = dir0.clone();
    steer(start, d, L);
    const room = 1 - REACH(arr(V3(start).addScaledVector(d, L)));
    const edge = room < 0;
    if (edge) L = Math.max(0.3, L * 0.5);
    const pts = [start];
    let p = V3(start);
    const seg = level <= 2 ? 3 : 2;
    for (let i = 0; i < seg; i++) {
      d.x += (rng() - 0.5) * 0.2; d.y += (rng() - 0.5) * 0.2; d.z += (rng() - 0.5) * 0.2;
      d.normalize();
      p = p.clone().addScaledVector(d, L / seg);
      pts.push(arr(p));
    }
    const leaf = edge || level >= 4 || (level === 3 && rng() < 0.7);
    const rEnd = leaf ? 0.03 : Math.max(0.042, r0 * 0.72);
    const sides = level <= 1 ? 8 : level === 2 ? 7 : 6;
    const g = tube(pts, [r0, mix(r0, rEnd, 0.62), rEnd], { sides, steps: level <= 2 ? seg * 3 : 4, round: 2 });
    tubeCol(g, mix3(MAGENTA, VIOLET, 0.2 + (level - 1) / 3.6), mix3(MAGENTA, VIOLET, 0.2 + level / 3.6));
    // Spines: little studs on the outer branches, the sites where other neurons actually connect.
    if (level >= 2) {
      const smp = sampleCurve(pts, [r0, rEnd], 12);
      const fr = framesAlong(smp.P);
      for (let i = 1; i < fr.length; i++) {
        if (rng() > 0.13) continue;
        const a = rng() * Math.PI * 2;
        const dirS = fr[i].N.clone().multiplyScalar(Math.cos(a)).addScaledVector(fr[i].B, Math.sin(a));
        const rr = smp.R[i] * 0.9;
        const c = fr[i].c.clone().addScaledVector(dirS, rr + 0.012);
        const sr = 0.024 + rng() * 0.012;
        spines.push({ geometry: bead(arr(c), sr, 6, 4), color: 0xc98bf5 });
      }
    }
    if (leaf) return;
    const count = level === 1 && rng() < 0.2 ? 3 : 2;
    const perp = new THREE.Vector3(d.y, -d.x, d.z * 0.3).cross(d).normalize();
    for (let c = 0; c < count; c++) {
      const a = (c / count) * Math.PI * 2 + rng() * 2;
      const q = new THREE.Quaternion().setFromAxisAngle(d, a);
      const off = perp.clone().applyQuaternion(q);
      const spread = 0.38 + rng() * 0.34;
      const nd = d.clone().multiplyScalar(Math.cos(spread)).addScaledVector(off, Math.sin(spread)).normalize();
      grow(arr(p), nd, level + 1, rEnd);
    }
  };
  for (const tip of tips) {
    // Each primary forks at once, so the tree starts from the end of the sculpted cone.
    const d = tip.dir;
    const perp = new THREE.Vector3(d.y, -d.x, 0.2).cross(d).normalize();
    for (const sign of [1, -1]) {
      const nd = d.clone().multiplyScalar(0.88).addScaledVector(perp, sign * 0.48).normalize();
      grow(tip.p, nd, 1, tip.r);
    }
  }

  // --- The axon --------------------------------------------------------------------------------
  const AXON_R = 0.07;
  const axonCtrl = [[HILLOCK_TIP[0] - 0.2, HILLOCK_TIP[1] + 0.02, HILLOCK_TIP[2]], HILLOCK_TIP, [-0.55, 4.05, 0.16], [1.0, 3.92, -0.14], [2.6, 4.1, 0.1], [3.85, 3.86, -0.06], [4.42, 3.8, -0.02]];
  const axonCurve = new THREE.CatmullRomCurve3(axonCtrl.map(V3), false, 'catmullrom', 0.5);
  const AL = axonCurve.getLength();
  const atD = (d) => axonCurve.getPointAt(clamp01(d / AL));
  const axonPts = [];
  for (let i = 0; i <= 90; i++) axonPts.push(arr(axonCurve.getPointAt(i / 90)));
  const axonG = tube(axonPts, AXON_R, { sides: 10, steps: 90, round: 2 });
  tubeCol(axonG, AXON, AXON);

  // The sheaths start just past the hillock's bare initial segment, a fixed count and a fixed gap.
  const myelin = [];
  const INIT = 0.34;
  const sheathEnds = [];
  const MR = 0.205;
  for (let m = 0; m < NEURON.myelinCount; m++) {
    const d0 = INIT + m * (NEURON.sheath + NEURON.node);
    const d1 = d0 + NEURON.sheath;
    sheathEnds.push([d0, d1]);
    const samples = [];
    for (let i = 0; i <= 18; i++) { const c = atD(mix(d0, d1, i / 18)); samples.push(arr(c)); }
    const fr = framesAlong(samples);
    const g = loftGrid(18, 18, (v, u) => {
      const F = fr[Math.round(v * 18)];
      // A sausage: quickly closing on the axon at each end, the paranode, full between.
      const e = Math.min(v, 1 - v) * NEURON.sheath;
      const r = AXON_R * 0.5 + (MR - AXON_R * 0.5) * Math.sqrt(clamp01(1 - (1 - clamp01(e / 0.3)) ** 2));
      const rr = v === 0 || v === 1 ? 0.0 : r;
      const a = u * Math.PI * 2;
      return [F.c.x + (F.N.x * Math.cos(a) + F.B.x * Math.sin(a)) * rr, F.c.y + (F.N.y * Math.cos(a) + F.B.y * Math.sin(a)) * rr, F.c.z + (F.N.z * Math.cos(a) + F.B.z * Math.sin(a)) * rr];
    }, { uv: (v, u) => [u * 2, v * 1.5 + m * 0.37] });
    myelin.push({ geometry: g, color: 0xf7c52c });
    // Each sheath is one Schwann cell, and its nucleus makes a soft lump on the outside.
    const c = atD(mix(d0, d1, m % 2 ? 0.62 : 0.34));
    const out = new THREE.Vector3(0, m % 2 ? 0.6 : 0.8, m % 2 ? 0.8 : 0.6).normalize();
    body.push({
      geometry: new THREE.SphereGeometry(0.1, 14, 10).scale(1.5, 0.72, 0.9).translate(c.x + out.x * (MR - 0.03), c.y + out.y * (MR - 0.03), c.z + out.z * (MR - 0.03)),
      color: 0x8f5be8,
    });
  }

  // --- The axon terminals ----------------------------------------------------------------------
  const END = axonCurve.getPointAt(1);
  const boutons = [];
  const NEXT = lin(0x12b8a0);
  const addBouton = (e, d) => {
    // A bouton: a stalk swelling into a bulb, swollen with vesicles, turned smoothly in 24 sides.
    const prof = [[0, -0.1]];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const r = 0.05 + 0.155 * Math.sin(Math.PI * sstep(t, 0, 0.9) * 0.5) * (t > 0.6 ? Math.sqrt(clamp01(1 - ((t - 0.6) / 0.4) ** 2)) : 1);
      prof.push([t > 0.995 ? 0.012 : r, -0.08 + t * 0.46]);
    }
    prof.push([0, 0.38]);
    const b = lathe(prof, 22);
    tintVertices(b, (x, y, z, out) => {
      const s = sstep(smoothNoise3(x * 7 + e.x, y * 7 + e.y, z * 7 + e.z), 0.42, 0.72) * sstep(y, 0.0, 0.14);
      const c0 = lin(0xff6a14); const c1 = lin(0xffb43a);
      out[0] = mix(c0[0], c1[0], s); out[1] = mix(c0[1], c1[1], s); out[2] = mix(c0[2], c1[2], s);
    });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    b.applyMatrix4(new THREE.Matrix4().compose(e, q, new THREE.Vector3(1, 1, 1)));
    body.push({ geometry: b, keepColor: true });
    boutons.push({ p: e.clone().addScaledVector(d, 0.38), d: d.clone() });
  };
  const bent = (p0, dir, L, curl, up = [0, 0, 1]) => {
    // A short branch with its own gentle curve, so a fan never looks like a diagram of a fan.
    const side = new THREE.Vector3().crossVectors(V3(up), dir).normalize();
    const m = V3(p0).addScaledVector(dir, L * 0.52).addScaledVector(side, curl * L * 0.5);
    const e = V3(p0).addScaledVector(dir, L).addScaledVector(side, curl * L);
    return { pts: [p0, arr(m), arr(e)], end: e, dirEnd: e.clone().sub(m).normalize() };
  };
  const axis = axonCurve.getTangentAt(1);
  const rot = (d, deg, yaw = 0) => d.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), (deg * Math.PI) / 180).applyAxisAngle(new THREE.Vector3(0, 1, 0), (yaw * Math.PI) / 180).normalize();
  [[42, 12, 0.72], [-4, -16, 0.66], [-46, 14, 0.7]].forEach(([deg, yaw, L], i) => {
    const b0 = bent(arr(END), rot(axis, deg, yaw), L, i === 1 ? 0.1 : (deg > 0 ? -0.16 : 0.16));
    const r0 = AXON_R * 0.95; const r1 = r0 * 0.76;
    const g0 = tube(b0.pts, [r0, mix(r0, r1, 0.6), r1], { sides: 9, steps: 8, round: 2 });
    tubeCol(g0, AXON, mix3(AXON, CORAL, 0.5));
    const forks = i === 0 ? [[24, 22, 0.56], [-22, -22, 0.5]] : i === 1 ? [[25, 20, 0.6], [-24, -18, 0.56], [2, -44, 0.5]] : [[20, -30, 0.56], [-24, 24, 0.5]];
    forks.forEach(([fd, fy, fl]) => {
      const b1 = bent(arr(b0.end), rot(b0.dirEnd, fd, fy), fl, fd > 0 ? -0.14 : 0.14);
      const g1 = tube(b1.pts, [r1, r1 * 0.8, r1 * 0.72], { sides: 8, steps: 6, round: 2 });
      tubeCol(g1, mix3(AXON, CORAL, 0.5), CORAL);
      addBouton(b1.end, b1.dirEnd);
    });
  });

  // --- The next cell's dendrite, stopping short of the lowest bouton: that gap is the synapse ------
  const low = boutons.reduce((a, b) => (b.p.y < a.p.y ? b : a));
  const GAP = 0.09;
  const nextTip = low.p.clone().addScaledVector(low.d, GAP + 0.1);
  const nextBase = [Math.min(nextTip.x + 0.3, 5.55), 0.2, nextTip.z * 0.4];
  const nextCtrl = [nextBase, [nextBase[0] - 0.08, 1.0, nextBase[2] + 0.05], [mix(nextBase[0], nextTip.x, 0.6), mix(1.0, nextTip.y, 0.62), nextTip.z - 0.02], arr(nextTip)];
  const nextG = tube(nextCtrl, [0.15, 0.105, 0.085, 0.12], { sides: 12, steps: 26, round: 3 });
  tintVertices(nextG, (x, y, z, out) => {
    const k = 0.9 + 0.2 * smoothNoise3(x * 3, y * 3, z * 3);
    out[0] = NEXT[0] * k; out[1] = NEXT[1] * k; out[2] = NEXT[2] * k;
  });
  body.push({ geometry: nextG, keepColor: true });

  // --- The stand -------------------------------------------------------------------------------
  const stand = [];
  const WOOD = 0x5b3a24; const BRASS = 0xb08d4e;
  const footA = [SOMA[0], 0, 0]; const footB = [3.5, 0, 0];
  const foot = (x, r) => lathe([[0, 0], [r, 0], [r, 0.05], [r * 0.98, 0.09], [r * 0.9, 0.13], [r * 0.82, 0.2], [r * 0.46, 0.25], [r * 0.2, 0.3], [0, 0.31]], 44).translate(x, 0, 0);
  stand.push({ geometry: foot(footA[0], 0.95), color: WOOD });
  stand.push({ geometry: foot(footB[0], 0.85), color: WOOD });
  // A long low rail ties the two feet, and carries on under the terminals to hold the next dendrite.
  stand.push({ geometry: new THREE.BoxGeometry(9.6, 0.13, 0.42).translate(1.02, 0.065, 0), color: WOOD });
  stand.push({ geometry: lathe([[0, 0], [0.42, 0], [0.42, 0.06], [0.34, 0.12], [0.2, 0.2], [0, 0.22]], 28).translate(nextBase[0], 0, nextBase[2] * 0 + nextBase[2]), color: WOOD });
  stand.push({ geometry: lathe([[0, 0.18], [0.19, 0.18], [0.19, 0.42], [0.155, 0.46], [0, 0.46]], 18).translate(nextBase[0], 0, nextBase[2]), color: BRASS });
  // Post one goes up into the soma, post two to a saddle under the last sheath.
  const clipD = mix(sheathEnds[4][0], sheathEnds[4][1], 0.72);
  const clip = atD(clipD);
  const clipT = axonCurve.getTangentAt(clamp01(clipD / AL));
  const postB = [clip.x, clip.y, clip.z];
  stand.push({ geometry: tube([[footA[0], 0.2, 0], [footA[0], SOMA[1] - 0.25, 0]], 0.05, { sides: 12, steps: 2, straight: true, round: 1 }), color: BRASS });
  stand.push({ geometry: lathe([[0, 0.2], [0.12, 0.2], [0.12, 0.36], [0.07, 0.42], [0.05, 0.42], [0, 0.42]], 16).translate(footA[0], 0, 0), color: BRASS });
  stand.push({ geometry: tube([[postB[0], 0.2, 0], [postB[0], postB[1] - MR - 0.02, postB[2]]], 0.05, { sides: 12, steps: 2, straight: true, round: 1 }), color: BRASS });
  stand.push({ geometry: lathe([[0, 0.2], [0.12, 0.2], [0.12, 0.36], [0.07, 0.42], [0.05, 0.42], [0, 0.42]], 16).translate(postB[0], 0, 0), color: BRASS });
  // The saddle: a short ring round the sheath, in the sheath's own axis, so the cell is really held.
  const ringQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), clipT);
  stand.push({
    geometry: lathe([[0, -0.05], [MR + 0.012, -0.05], [MR + 0.045, -0.03], [MR + 0.045, 0.03], [MR + 0.012, 0.05], [0, 0.05]], 28).applyMatrix4(new THREE.Matrix4().compose(clip, ringQ, new THREE.Vector3(1, 1, 1))),
    color: BRASS,
  });

  const fibre = streakMap(7302, { size: 128, lines: 90, dark: 186, alpha: 0.75, across: true, bow: 26 });
  const grain = grainBump(7303, { size: 128, dots: 650, contrast: 0.4 });
  grain.repeat.set(1, 1);
  const root = new THREE.Group();
  root.name = 'neuron';
  root.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.4, metalness: 0, bumpMap: grain, bumpScale: 0.5 })));
  root.add(mesh(mergeParts(myelin), standard({ vertexColors: true, roughness: 0.46, metalness: 0, map: fibre, bumpMap: fibre, bumpScale: 0.9 })));
  root.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.55, metalness: 0.15 })));
  root.add(mesh(mergeParts(spines), standard({ vertexColors: true, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(cutParts), standard({ map: cutMap, roughness: 0.62, metalness: 0 })));
  return root;
}

// A solid squashed about a point, with the distance corrected by the tightest axis so it stays a bound.
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

// ---------------------------------------------------------------------------------------------
// Human kidney
// ---------------------------------------------------------------------------------------------

// Cut lengthwise in the coronal plane z = ZC, hilum toward +X. Behind the plane it is a whole kidney.
// The collecting system is the one real hollow: every minor calyx is a cup with a papilla pushed into
// it, stems running to three major calyces and those to the pelvis. It is sculpted as a void and
// turned inside out, and the plate's hole comes off the same field, so there is depth to look into.
// Everything else on the face is a painting traced from those same fields, with the vessels real and
// half sunk in the plate.
function humanKidney() {
  const ZC = 0.34; const YC = 3.1;
  const OX = -0.34; // the whole organ is slid over its stand once it is built
  const rng = seededRandom(7410);

  // --- The bean -------------------------------------------------------------------------------
  const BEAN = lin(0xb4503d); const PELVIS_W = lin(0xf0d7bf); const ADRENAL = lin(0xe4a12f);
  const K = new Sculpt(0.058);
  const beanPts = [[0.32, YC + 1.32, ZC], [-0.2, YC + 0.74, ZC], [-0.38, YC, ZC], [-0.2, YC - 0.74, ZC], [0.32, YC - 1.32, ZC]];
  const bean = squash(curveP(beanPts, [0.68, 0.98, 1.06, 0.98, 0.68], 30), [1, 1, 0.74], [0, 0, ZC]);
  K.add(bean, BEAN);
  // A real kidney is a little fuller at the upper pole's outer shoulder and flatter below it.
  K.sub(ellipsoidP([1.24, YC - 0.05, ZC], [0.66, 0.8, 1.05]), null, { k: 0.3 });

  // The collecting system's own centre lines.
  const CS = [0.36, YC];
  const PELVIS_C = [0.62, YC - 0.1, ZC];
  const UPJ = [1.12, YC - 1.02, ZC];
  const PELVIS_R = [0.42, 0.56, 0.44];
  const FUNNEL = [[0.66, YC - 0.34, ZC], [0.88, YC - 0.66, ZC], UPJ];
  const FUNNEL_R = [0.36, 0.2, 0.082];
  K.add(squash(ellipsoidP(PELVIS_C, PELVIS_R.map((r) => r + 0.05)), [1, 1, 0.9], [0, 0, ZC]), PELVIS_W, { k: 0.06, ck: 0.09 });
  K.add(curveP(FUNNEL, FUNNEL_R.map((r) => r + 0.052), 14), PELVIS_W, { k: 0.06, ck: 0.09 });
  // The adrenal gland, a flattened three-cornered cap on the upper pole.
  const ADRENAL_A = ellipsoidP([0.16, YC + 1.98, ZC - 0.02], [0.56, 0.2, 0.34], [0, 0, -0.22]);
  const ADRENAL_B = ellipsoidP([0.0, YC + 2.08, ZC - 0.02], [0.24, 0.24, 0.26]);
  K.add(ADRENAL_A, ADRENAL, { k: 0.06, ck: 0.08 });
  K.add(ADRENAL_B, ADRENAL, { k: 0.12, ck: 0.08 });
    const kSliceRaw = sliceOf(K.ops, ZC);

  const AREA = [-1.7, 0.95, 2.1, 5.75];
  const kSlice = gridded(kSliceRaw, AREA, 0.02);
  const beanOnly = gridded((x, y) => bean.f(x, y, ZC), AREA, 0.024);
  const adrenalSlice = gridded((x, y) => Math.min(ADRENAL_A.f(x, y, ZC), ADRENAL_B.f(x, y, ZC)), AREA, 0.024);

  // --- The pyramids, laid out by asking the bean where its own edge is ------------------------
  const CORTEX = 0.34;
  const edgeAt = (a, depth = CORTEX) => {
    // Walk in from outside the organ to where the bean's field first reaches `depth` under its surface.
    const ux = Math.cos(a); const uy = Math.sin(a);
    for (let m = 2.8; m > 0.2; m -= 0.012) {
      if (beanOnly(CS[0] + ux * m, CS[1] + uy * m) < -depth) return m;
    }
    return 0.2;
  };
  const PYR = 8;
  const A0 = (86 * Math.PI) / 180; const A1 = (274 * Math.PI) / 180;
  const STEP = (A1 - A0) / (PYR - 1);
  const pyramids = [];
  for (let i = 0; i < PYR; i++) {
    const a = A0 + STEP * i;
    const u = [Math.cos(a), Math.sin(a)];
    const base = edgeAt(a);
    const h = Math.min(0.86, base * 0.5);
    const apex = base - h;
    pyramids.push({ a, u, base, apex, A: [CS[0] + u[0] * apex, CS[1] + u[1] * apex] });
  }

  // --- The void: pelvis, major calyces, minor calyces with papillae pressing into them -----------
  const LINING = lin(0xf0b6a0);
  const V = new Sculpt(0.03);
  V.add(squash(ellipsoidP(PELVIS_C, PELVIS_R), [1, 1, 0.9], [0, 0, ZC]), LINING);
  V.add(curveP(FUNNEL, FUNNEL_R, 14), LINING, { k: 0.08 });
  const MAJORS = [
    { to: [0.2, YC + 0.86, ZC], from: [0.56, YC + 0.28, ZC], members: [0, 1, 2], r: [0.2, 0.15, 0.12] },
    { to: [-0.1, YC + 0.0, ZC], from: [0.46, YC - 0.04, ZC], members: [3, 4], r: [0.22, 0.15, 0.12] },
    { to: [0.2, YC - 0.88, ZC], from: [0.52, YC - 0.34, ZC], members: [5, 6, 7], r: [0.2, 0.15, 0.12] },
  ];
  for (const M of MAJORS) {
    const mid = [mix(M.from[0], M.to[0], 0.55) - 0.05, mix(M.from[1], M.to[1], 0.55), ZC];
    V.add(curveP([M.from, mid, M.to], M.r, 12), LINING, { k: 0.1 });
    for (const j of M.members) {
      const P = pyramids[j];
      const cup = [P.A[0] - P.u[0] * 0.09, P.A[1] - P.u[1] * 0.09, ZC];
      const stem = [mix(M.to[0], cup[0], 0.55) + (cup[1] - M.to[1]) * 0.05, mix(M.to[1], cup[1], 0.55) - (cup[0] - M.to[0]) * 0.05, ZC];
      V.add(curveP([M.to, stem, cup], [0.115, 0.09, 0.13], 8), LINING, { k: 0.06 });
      V.add(sphereP(cup, 0.205), LINING, { k: 0.06 });
    }
  }
  // The webbing between the majors, so no little island of plate is left standing in the funnel.
  V.add(sphereP([0.22, YC + 0.4, ZC], 0.2), LINING, { k: 0.1 });
  V.add(sphereP([0.22, YC - 0.42, ZC], 0.2), LINING, { k: 0.1 });
  const VOID_BOX = [-1.7, 0.9, -1, 2.1, 5.8, 3];
  // Each papilla is taken back out of its cup, in the pyramid's colour.
  const PAPILLA = lin(0xa23a3f);
  for (const P of pyramids) {
    const tip = [P.A[0] - P.u[0] * 0.06, P.A[1] - P.u[1] * 0.06, ZC];
    const back = [P.A[0] + P.u[0] * 0.34, P.A[1] + P.u[1] * 0.34, ZC];
    V.sub(segsP([tip, back], [0.085, 0.24]), PAPILLA, { k: 0.02, ck: 0.03 });
  }
  const vSliceRaw = sliceOf(V.ops, ZC);
  const vSlice = gridded(vSliceRaw, AREA, 0.016);
  const voidGeo = hollowAt(V, ZC, {
    bounds: VOID_BOX,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const d = sstep(ZC - z, 0, 0.5);
      const k = (0.94 + smoothNoise3(x * 6, y * 6, z * 6) * 0.12) * mix(1.06, 0.26, d);
      rgb[0] *= k; rgb[1] *= k * mix(1, 0.8, d); rgb[2] *= k * mix(1, 0.8, d);
    },
  });

  // --- The cut face ----------------------------------------------------------------------------
  const plateLoops = contour((x, y) => Math.max(kSlice(x, y), -vSlice(x, y)), AREA, 0.016);
  const [X0, Y0, X1, Y1] = AREA;
  const W = 1228; const H = Math.round((W * (Y1 - Y0)) / (X1 - X0));
  const PX = W / (X1 - X0);
  const map = (x, y) => [(x - X0) * PX, H - (y - Y0) * PX];
  const plateG = plate(plateLoops, (x, y) => [x, y, ZC], (x, y) => [(x - X0) / (X1 - X0), (y - Y0) / (Y1 - Y0)], [0, 0, 1]);
  const polar = (a, r) => [CS[0] + Math.cos(a) * r, CS[1] + Math.sin(a) * r];
  const region = (f, c = 0.02) => contour(f, AREA, c);
  const faceMap = canvasTexture(W, H, (ctx) => {
    // The cortex: pale, with fine radial medullary rays and the tiny dark knots of the glomeruli.
    ctx.fillStyle = '#ecbd96';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {
      const a = rng() * Math.PI * 2;
      const r0 = edgeAt(a, 0.02);
      const r1 = r0 - 0.04 - rng() * 0.5;
      const [p, q] = map(...polar(a, r0)); const [m, n] = map(...polar(a + (rng() - 0.5) * 0.02, r1));
      ctx.strokeStyle = rng() > 0.5 ? 'rgba(206,126,96,0.5)' : 'rgba(250,216,178,0.6)';
      ctx.lineWidth = 1 + rng() * 2;
      ctx.beginPath(); ctx.moveTo(p, q); ctx.lineTo(m, n); ctx.stroke();
    }
    for (let i = 0; i < 2600; i++) {
      const a = rng() * Math.PI * 2;
      const r = edgeAt(a, 0.03) - rng() * 0.62;
      const [p, q] = map(...polar(a, r));
      ctx.fillStyle = rng() > 0.3 ? 'rgba(176,58,52,0.75)' : 'rgba(128,36,40,0.7)';
      ctx.beginPath(); ctx.arc(p, q, 1.3 + rng() * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    // Interlobular twigs running out through the cortex from the arcuates.
    for (let i = 0; i < 110; i++) {
      const a = A0 + rng() * (A1 - A0);
      const e0 = edgeAt(a); const e1 = edgeAt(a, 0.05);
      const [p, q] = map(...polar(a, e0)); const [m, n] = map(...polar(a + (rng() - 0.5) * 0.03, mix(e0, e1, 0.6 + rng() * 0.35)));
      ctx.strokeStyle = i % 2 ? 'rgba(206,44,50,0.8)' : 'rgba(60,84,190,0.75)';
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(p, q); ctx.lineTo(m, n); ctx.stroke();
    }
    // Sinus fat, lobulated, round the collecting system and open at the hilum.
    const sinus = (x, y) => Math.hypot((x - 0.66) / 0.9, (y - YC) / 1.5) - 1;
    const fatLoops = region(sinus);
    fillLoops(ctx, fatLoops, map, '#f4d572');
    ctx.save();
    clipLoops(ctx, fatLoops, map);
    for (let i = 0; i < 520; i++) {
      const [p, q] = map(mix(-0.3, 1.7, rng()), mix(YC - 1.6, YC + 1.6, rng()));
      const r = 7 + rng() * 15;
      ctx.fillStyle = rng() > 0.5 ? 'rgba(255,236,150,0.65)' : 'rgba(226,172,70,0.45)';
      ctx.beginPath(); ctx.arc(p, q, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(190,130,50,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
    // The pyramids: dark, broad-based, striped from base to tip.
    for (const P of pyramids) {
      const half = STEP * 0.41;
      const tip = polar(P.a, P.apex - 0.06);
      const outline = [];
      const N = 26;
      for (let i = 0; i <= N; i++) { const a = P.a - half + (2 * half * i) / N; outline.push(polar(a, edgeAt(a))); }
      ctx.beginPath();
      const [tx, ty] = map(...tip);
      ctx.moveTo(tx, ty);
      const side = (from, to, bow) => {
        const [fx, fy] = map(...from); const [gx, gy] = map(...to);
        const mx = (fx + gx) / 2 + (gy - fy) * bow; const my = (fy + gy) / 2 - (gx - fx) * bow;
        ctx.quadraticCurveTo(mx, my, gx, gy);
      };
      side(tip, outline[0], -0.1);
      outline.forEach((pt) => { const [x, y] = map(...pt); ctx.lineTo(x, y); });
      side(outline[N], tip, -0.1);
      ctx.closePath();
      ctx.fillStyle = '#8f2e38';
      ctx.fill();
      ctx.save();
      ctx.clip();
      for (let i = 0; i < 90; i++) {
        const a = P.a - half + 2 * half * rng();
        const [bx, by] = map(...polar(a, edgeAt(a)));
        const toward = 0.15 + rng() * 0.8;
        const [ex, ey] = [mix(bx, tx, toward), mix(by, ty, toward)];
        ctx.strokeStyle = rng() > 0.5 ? 'rgba(84,20,34,0.6)' : 'rgba(186,84,84,0.55)';
        ctx.lineWidth = 1 + rng() * 2.4;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
      }
      ctx.restore();
      // The papilla's rounded tip, drawn over the sharp point the outline made.
      ctx.fillStyle = '#a23a3f';
      ctx.beginPath(); ctx.arc(tx, ty, 0.085 * PX, 0, Math.PI * 2); ctx.fill();
    }
    // The wall of the calyces and pelvis, pale, standing out against everything round it.
    const wall = region((x, y) => vSlice(x, y) - 0.05, 0.016);
    fillLoops(ctx, wall, map, '#f7e6d3');
    traceLoops(ctx, wall, map, 'rgba(176,110,90,0.8)', 1.6);
    traceLoops(ctx, region(vSlice, 0.016), map, 'rgba(120,60,50,0.75)', 2.4);
    // Adrenal: yellow cortex round a darker medulla.
    const adL = region(adrenalSlice);
    fillLoops(ctx, adL, map, '#efb53b');
    fillLoops(ctx, region((x, y) => adrenalSlice(x, y) + 0.12), map, '#a0512c');
    // The fibrous capsule, a thin dark line all round the kidney itself.
    const beanL = region((x, y) => Math.max(beanOnly(x, y), -adrenalSlice(x, y)));
    traceLoops(ctx, beanL, map, '#6d221e', 5);
    traceLoops(ctx, adL, map, '#a56a1c', 3);
  });

  // --- The outside ---------------------------------------------------------------------------
  const kGeo = trimmedAt(K, ZC, {
    uvScale: 1.1,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      if (rgb[0] > 0.5 && rgb[1] > 0.3 && rgb[2] < 0.2) {
        // The adrenal's lumpy yellow surface.
        const k = 0.86 + 0.32 * smoothNoise3(x * 7, y * 7, z * 7);
        rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      } else if (rgb[0] < 0.45) {
        const k = 0.86 + 0.26 * smoothNoise3(x * 1.6, y * 1.6, z * 1.6) + 0.1 * smoothNoise3(x * 6, y * 6, z * 6);
        rgb[0] *= k * 1.05; rgb[1] *= k * 0.96; rgb[2] *= k * 0.92;
      }
    },
  });

  // --- The vessels, real, half sunk in the face where they lie on it --------------------------
  const organ = [{ geometry: kGeo, keepColor: true }, { geometry: voidGeo, keepColor: true }];
  const ART = 0xd9252b; const VEIN = 0x2b50c6;
  const Zv = ZC + 0.014;
  const lay = (points, radii, color, sides = 8) => {
    organ.push({ geometry: tube(points.map((p) => (p.length === 2 ? [p[0], p[1], Zv] : p)), radii, { sides, steps: (points.length - 1) * 4, round: 2 }), color });
  };
  // The two trunks leave through the hilum toward the aorta and the vena cava, ending in cut mouths.
  const TRUNK_END_A = [2.36, YC + 1.02, ZC + 0.02];
  const TRUNK_END_V = [2.36, YC + 0.42, ZC + 0.05];
  const HUB_A = [0.72, YC + 0.76, ZC + 0.05];
  const HUB_V = [0.7, YC + 0.36, ZC + 0.08];
  const dirA = V3(TRUNK_END_A).sub(V3([1.6, YC + 0.96, ZC + 0.03])).normalize();
  const dirV = V3(TRUNK_END_V).sub(V3([1.6, YC + 0.4, ZC + 0.08])).normalize();
  const RA = 0.14; const RV = 0.21;
  const backA = V3(TRUNK_END_A).addScaledVector(dirA, -(mouthDepth(RA) + 0.02));
  const backV = V3(TRUNK_END_V).addScaledVector(dirV, -(mouthDepth(RV) + 0.02));
  organ.push({ geometry: tube([HUB_A, [1.25, YC + 0.9, ZC + 0.04], [1.65, YC + 0.96, ZC + 0.03], arr(backA)], [0.1, RA, RA, RA], { sides: 16, steps: 22, round: 2 }), color: ART });
  organ.push({ geometry: tube([HUB_V, [1.25, YC + 0.38, ZC + 0.08], [1.65, YC + 0.4, ZC + 0.08], arr(backV)], [0.15, RV, RV, RV], { sides: 20, steps: 22, round: 2 }), color: VEIN });
  vesselMouth(organ, TRUNK_END_A, arr(dirA), RA, 0xe0382e, 0x4f0d12);
  vesselMouth(organ, TRUNK_END_V, arr(dirV), RV, 0x3a62d8, 0x0d153f);
  // Just inside the hilum each trunk forks and dives under the cut, into the sinus fat, which is where
  // these branches really run. Leaving them on the face would hide the calyces, the point of the model.
  const dive = (hub, r, color, targets) => {
    for (const [tx, ty] of targets) {
      const midP = [mix(hub[0], tx, 0.55), mix(hub[1], ty, 0.55) + 0.03, ZC + 0.05];
      organ.push({ geometry: tube([[hub[0], hub[1], hub[2] - 0.02], midP, [tx, ty, ZC - 0.12]], [r, r * 0.74, r * 0.5], { sides: 10, steps: 10, round: 1 }), color });
    }
  };
  dive(HUB_A, 0.082, ART, [[0.62, YC + 1.25], [0.54, YC + 0.9]]);
  dive(HUB_V, 0.11, VEIN, [[0.56, YC + 0.66], [0.78, YC + 1.02]]);
  // Each renal column then has its pair coming up from under the cut, and the arcuate vessels arch
  // along the pyramid's base on either side. Their finer twigs into the cortex are painted.
  for (let i = 0; i < PYR - 1; i++) {
    const a = (pyramids[i].a + pyramids[i + 1].a) / 2;
    const edge = edgeAt(a);
    let inner = Math.min(pyramids[i].apex, pyramids[i + 1].apex) + 0.08;
    const lane = 0.022;
    // Come up clear of the collecting system, never through its hole.
    while (inner < edge - 0.3 && Math.min(vSlice(...polar(a - lane, inner)), vSlice(...polar(a + lane, inner))) < 0.11) inner += 0.03;
    const entryA = polar(a - lane, inner); const midA = polar(a - lane, mix(inner, edge, 0.3)); const topA = polar(a - lane * 1.2, edge - 0.01);
    const entryV = polar(a + lane, inner); const midV = polar(a + lane, mix(inner, edge, 0.3)); const topV = polar(a + lane * 1.2, edge - 0.01);
    lay([[entryA[0], entryA[1], ZC - 0.08], midA, topA], [0.036, 0.034, 0.028], ART, 7);
    lay([[entryV[0], entryV[1], ZC - 0.08], midV, topV], [0.042, 0.04, 0.032], VEIN, 7);
    const sweep = STEP * 0.42;
    const arcPts = (start, dirSign, shift) => {
      const pts = [];
      for (let k = 0; k <= 4; k++) { const b = start + dirSign * (k / 4) * sweep; pts.push(polar(b, edgeAt(b) + shift)); }
      return pts;
    };
    lay(arcPts(a - lane * 1.2, -1, -0.015), [0.028, 0.025, 0.021, 0.018, 0.015], ART, 6);
    lay(arcPts(a + lane * 1.2, 1, -0.015), [0.032, 0.028, 0.024, 0.02, 0.016], VEIN, 6);
  }

  // --- The ureter, whole, hanging from the funnel's tip --------------------------------------
  const UR = 0.105;
  const urEnd = [0.98, 0.62, ZC + 0.24];
  const urDir = V3(urEnd).sub(V3([1.2, 1.25, ZC + 0.2])).normalize();
  const urBack = V3(urEnd).addScaledVector(urDir, -(mouthDepth(UR) + 0.02));
  const urG = tube([[UPJ[0] - 0.09, UPJ[1] + 0.14, ZC - 0.04], [UPJ[0] + 0.03, UPJ[1] - 0.06, ZC + 0.01], [1.28, YC - 1.5, ZC + 0.08], [1.3, 1.25, ZC + 0.2], arr(urBack)], [0.05, 0.09, UR, UR, UR], { sides: 14, steps: 36, round: 2 });
  const UC = lin(0xf1d3b0);
  tintVertices(urG, (x, y, z, out) => {
    const k = 0.92 + 0.16 * smoothNoise3(x * 2, y * 5, z * 2);
    out[0] = UC[0] * k; out[1] = UC[1] * k; out[2] = UC[2] * k;
  });
  organ.push({ geometry: urG, keepColor: true });
  vesselMouth(organ, urEnd, arr(urDir), UR, 0xefcfaa, 0x6a3a2a);

  // --- The stand -----------------------------------------------------------------------------
  const stand = [];
  standBase(stand, 1.32, { top: 0.36, collarR: 0.16 });
  stand.push({ geometry: tube([[0, 0.34, 0], [0, 0.8, 0], [0, 1.5, ZC - 0.3]], 0.075, { sides: 14, steps: 10, round: 1 }), color: 0xb08d4e });

  const grain = grainBump(7411, { size: 256, dots: 1400, contrast: 0.35 });
  const root = new THREE.Group();
  root.name = 'human-kidney';
  const plateMesh = mesh(mergeParts([{ geometry: plateG, color: 0xffffff }]), standard({ map: faceMap, roughness: 0.58, metalness: 0 }));
  const organMeshM = mesh(mergeParts(organ), standard({ vertexColors: true, roughness: 0.34, metalness: 0, bumpMap: grain, bumpScale: 0.25 }));
  for (const m of [plateMesh, organMeshM]) { m.geometry.translate(OX, 0, 0); root.add(m); }
  root.add(mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.5, metalness: 0.12 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Arm bones and muscles
// ---------------------------------------------------------------------------------------------

// A right arm seen from its outer side, with the elbow bent to 90 degrees and the forearm in the
// thumb-up position. That pose is chosen for the teaching: thumb up stacks the radius ABOVE the ulna
// with a clear gap between them, and the hand lies flat to the viewer with all its bones showing. The
// shoulder carries a stub of shoulder blade, because both muscles really start there.
//
// Bones are one sculpt, so condyles and shafts flow; the trochlea sits in a notch taken out of the ulna,
// so the joint really fits. Each muscle head is a `loftGrid` running tendon to belly to tendon, because
// a muscle's grain runs along its length and a mesh with lines the same way can carry it in a texture.
function muscleLoft(ctrl, rz, rx, { rows = 44, cols = 44, a = 0.2, b = 0.8, seed = 0, flutes = 8, uvScale = [2, 1.2] }) {
  const { P } = sampleCurve(ctrl, 1, rows);
  const F = framesAlong(P, [0, 0, 1]);
  const g = loftGrid(rows, cols, (v, u) => {
    const fr = F[Math.round(v * rows)];
    const pole = v <= 1e-6 || v >= 1 - 1e-6;
    const belly = sstep(v, a, a + 0.1) * (1 - sstep(v, b - 0.1, b));
    const flute = 1 + 0.035 * belly * Math.cos(u * Math.PI * 2 * flutes + Math.sin(v * 3 + seed) * 0.8);
    const ang = u * Math.PI * 2;
    const R1 = pole ? 0 : splineAt(rz, v) * flute;
    const R2 = pole ? 0 : splineAt(rx, v) * flute;
    return [
      fr.c.x + fr.N.x * Math.cos(ang) * R1 + fr.B.x * Math.sin(ang) * R2,
      fr.c.y + fr.N.y * Math.cos(ang) * R1 + fr.B.y * Math.sin(ang) * R2,
      fr.c.z + fr.N.z * Math.cos(ang) * R1 + fr.B.z * Math.sin(ang) * R2,
    ];
  }, { uv: (v, u) => [u * uvScale[0] + seed * 0.13, v * uvScale[1]] });
  const RED = lin(0xc4231d); const DEEP = lin(0x7c0f12); const PEARL = lin(0xe6dfca);
  const w = cols + 1;
  tintVertices(g, (x, y, z, out, i) => {
    const v = Math.floor(i / w) / rows; const u = (i % w) / cols;
    // Tendon runs into the belly as long fingers, not as a straight line round the muscle.
    const jag = 0.035 * Math.sin(u * Math.PI * 2 * 5 + seed) + 0.018 * Math.sin(u * Math.PI * 2 * 11 + seed * 2);
    const flesh = sstep(v, a + jag, a + jag + 0.035) * (1 - sstep(v, b + jag - 0.035, b + jag));
    const ridge = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * flutes + Math.sin(v * 3 + seed) * 0.8);
    const n = 0.86 + 0.26 * smoothNoise3(x * 2.6, y * 1.1, z * 2.6);
    const r = mix(DEEP[0], RED[0], ridge * 0.75 + 0.25) * n;
    const gg = mix(DEEP[1], RED[1], ridge * 0.75 + 0.25) * n;
    const bb = mix(DEEP[2], RED[2], ridge * 0.75 + 0.25) * n;
    out[0] = mix(PEARL[0], r, flesh); out[1] = mix(PEARL[1], gg, flesh); out[2] = mix(PEARL[2], bb, flesh);
  });
  return g;
}

function armMuscles() {
  const OFFSET_X = -1.42;
  const IVORY = lin(0xdfd2ab); const CARTILAGE = lin(0xc8e4ea);

  // --- The bones: one sculpt ---------------------------------------------------------------------
  const B = new Sculpt(0.033);
  const HH = [-0.1, 5.5, -0.1]; const H_R = 0.27;
  const CAP = [0, 2.85, 0.17]; const CAP_R = 0.125;
  const TRO = [0, 2.85, -0.13];
  // Humerus: head, tubercles, shaft, and the flared lower end with its spool.
  B.add(sphereP(HH, H_R), IVORY);
  B.add(ellipsoidP([0.03, 5.52, 0.12], [0.16, 0.19, 0.14]), IVORY, { k: 0.05 });
  B.add(ellipsoidP([0.16, 5.42, -0.06], [0.09, 0.13, 0.085]), IVORY, { k: 0.04 });
  B.sub(curveP([[0.2, 5.72, 0.05], [0.2, 5.38, 0.05], [0.16, 5.02, 0.05]], 0.042, 8), null, { k: 0.05 });
  B.add(ellipsoidP([-0.05, 5.25, 0], [0.21, 0.27, 0.21]), IVORY, { k: 0.12 });
  B.add(curveP([[-0.06, 5.28, 0], [-0.05, 4.4, 0.02], [-0.03, 3.62, 0], [-0.02, 3.22, 0]], [0.17, 0.115, 0.12, 0.15], 20), IVORY, { k: 0.14 });
  B.add(ellipsoidP([0.02, 4.45, 0.115], [0.055, 0.3, 0.045]), IVORY, { k: 0.08 }); // the deltoid tuberosity
  B.add(ellipsoidP([-0.03, 3.1, -0.02], [0.115, 0.26, 0.34]), IVORY, { k: 0.12 });
  B.add(sphereP([-0.03, 2.98, -0.41], 0.092), IVORY, { k: 0.08 }); // medial epicondyle
  B.add(sphereP([-0.03, 3.02, 0.32], 0.072), IVORY, { k: 0.08 }); // lateral epicondyle
  B.add(sphereP(CAP, CAP_R), IVORY, { k: 0.03 });
  B.add(sphereP([0, 2.85, -0.04], 0.135), IVORY, { k: 0.015 });
  B.add(sphereP([0, 2.85, -0.235], 0.16), IVORY, { k: 0.015 });
  B.add(sphereP(TRO, 0.122), IVORY, { k: 0.015 });
  B.sub(ellipsoidP([-0.145, 3.14, -0.12], [0.07, 0.13, 0.13]), null, { k: 0.05 }); // olecranon fossa
  B.sub(ellipsoidP([0.13, 3.1, -0.12], [0.05, 0.09, 0.11]), null, { k: 0.04 }); // coronoid fossa

  // The shoulder blade's stub: the socket the head sits against, the acromion over it, the coracoid in
  // front of it, sawn off behind.
  const GLENOID = [-0.14, 5.5, -0.42];
  const SC = new Sculpt(0.038);
  SC.add(ellipsoidP(GLENOID, [0.2, 0.27, 0.085]), IVORY);
  SC.add(curveP([[-0.16, 5.5, -0.48], [-0.2, 5.5, -0.62], [-0.28, 5.46, -0.84]], [0.13, 0.11, 0.1], 8), IVORY, { k: 0.08 });
  SC.add(ellipsoidP([-0.5, 5.02, -0.86], [0.42, 0.68, 0.05], [0, 0.34, 0.24]), IVORY, { k: 0.12 });
  SC.add(ellipsoidP([-0.5, 4.86, -0.86], [0.4, 0.22, 0.075], [0, 0.34, 0.24]), IVORY, { k: 0.08 });
  // The spine of the scapula and the acromion arching out over the head.
  SC.add(curveP([[-0.62, 5.45, -0.98], [-0.42, 5.74, -0.72], [-0.22, 5.92, -0.42], [-0.06, 5.92, -0.14], [0.04, 5.86, 0.02]], [0.06, 0.075, 0.08, 0.1, 0.075], 16), IVORY, { k: 0.06 });
  // The coracoid, the bent finger in front of the joint that the biceps' short head pulls on.
  SC.add(curveP([[-0.1, 5.68, -0.5], [0.08, 5.74, -0.42], [0.25, 5.62, -0.32], [0.3, 5.5, -0.28]], [0.085, 0.078, 0.066, 0.06], 12), IVORY, { k: 0.05 });
  SC.sub(sphereP(HH, H_R + 0.02), null, { k: 0.03 }); // the socket's own hollow
  SC.sub({ box: [-2, 4, -2.2, 2, 7, -1.05], f: (x, y, z) => z + 1.05 }, lin(0xc9a877), { k: 0.0, ck: 0.02 });

  // Ulna: the crescent the trochlea sits in, the olecranon point behind, a shaft tapering to the wrist.
  const U = new Sculpt(0.033);
  U.add(ellipsoidP([-0.05, 2.72, -0.13], [0.36, 0.205, 0.135]), IVORY);
  U.add(curveP([[-0.18, 2.6, -0.13], [0.18, 2.6, -0.13], [0.6, 2.63, -0.11], [1.3, 2.7, -0.05], [2.08, 2.8, 0.0], [2.2, 2.81, 0.0]], [0.11, 0.115, 0.092, 0.07, 0.06, 0.07], 26), IVORY, { k: 0.1 });
  U.add(sphereP([2.2, 2.81, 0], 0.092), IVORY, { k: 0.05 });
  U.add(segsP([[2.2, 2.78, -0.03], [2.32, 2.73, -0.05]], [0.05, 0.03]), IVORY, { k: 0.04 });
  U.sub(sphereP([0, 2.85, -0.04], 0.155), null, { k: 0.015 });
  U.sub(sphereP([0, 2.85, -0.235], 0.18), null, { k: 0.015 });
  U.sub(sphereP(TRO, 0.142), null, { k: 0.015 });

  // Radius: the disc against the capitulum, a neck, the tuberosity the biceps pulls on, and a shaft
  // widening to the wrist, where it carries the hand.
  const RAD_TUB = [0.47, 2.95, 0.09];
  const R = new Sculpt(0.033);
  R.add(segsP([[0.2, 2.85, 0.17], [0.27, 2.85, 0.17]], [0.125, 0.125]), IVORY);
  R.add(curveP([[0.24, 2.85, 0.17], [0.42, 2.87, 0.17], [0.72, 2.93, 0.16], [1.3, 3.03, 0.12], [1.9, 3.06, 0.07], [2.18, 3.03, 0.03]], [0.07, 0.07, 0.074, 0.07, 0.085, 0.125], 26), IVORY, { k: 0.05 });
  R.add(ellipsoidP(RAD_TUB, [0.11, 0.052, 0.07]), IVORY, { k: 0.05 });
  R.add(ellipsoidP([2.18, 3.03, 0.03], [0.1, 0.17, 0.125]), IVORY, { k: 0.08 });
  R.add(segsP([[2.2, 3.12, 0.04], [2.3, 3.23, 0.05]], [0.06, 0.032]), IVORY, { k: 0.04 });
  R.sub(sphereP(CAP, CAP_R + 0.012), null, { k: 0.01 });

  const near = (p, r, x, y, z, t = 0.022) => Math.abs(Math.hypot(x - p[0], y - p[1], z - p[2]) - r) < t;
  // Bone in shadowless daylight reads as one flat cream, so its form is painted in: each vertex asks
  // its own field how open the space off its surface is, which darkens every crease and hollow.
  const boneOpts = (sc) => ({
    uvScale: 2.1,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const open = clamp01(fieldD(sc.ops, x + nx * 0.12, y + ny * 0.12, z + nz * 0.12) / 0.12);
      const ao = mix(0.5, 1, open * open);
      const k = (0.8 + 0.3 * smoothNoise3(x * 1.8, y * 1.8, z * 1.8) + 0.1 * smoothNoise3(x * 15, y * 2.5, z * 15)) * ao;
      rgb[0] *= k; rgb[1] *= k * 0.97; rgb[2] *= k * 0.88;
      // Articular cartilage: the smooth blue-white on the surfaces that actually bear on each other.
      const onHead = near(HH, H_R, x, y, z, 0.03) && nz < -0.1;
      const onCap = near(CAP, CAP_R, x, y, z);
      const onTro = Math.hypot(x, y - 2.85) < 0.172 && z < 0.06 && z > -0.42 && x > -0.2 && y < 3.0;
      if (onHead || onCap || onTro) { rgb[0] = CARTILAGE[0] * ao; rgb[1] = CARTILAGE[1] * ao; rgb[2] = CARTILAGE[2] * ao; }
    },
  });
  const bones = [B, SC, U, R].map((sc) => ({ geometry: polygonize(sc, boneOpts(sc)), keepColor: true }));

  // --- The skeletal hand: 8 carpals, 5 metacarpals, 14 phalanges --------------------------------
  const CAR = new Sculpt(0.021);
  const carpals = [
    [2.37, 3.12, 0.06, 0.1, 0.11, 0.085, 0.4], [2.375, 2.96, 0.05, 0.095, 0.085, 0.08, 0], [2.365, 2.82, 0.02, 0.09, 0.085, 0.08, -0.3], [2.44, 2.73, -0.05, 0.055, 0.055, 0.055, 0],
    [2.53, 3.2, 0.05, 0.095, 0.085, 0.08, 0.3], [2.54, 3.07, 0.03, 0.085, 0.07, 0.075, 0], [2.53, 2.94, 0.03, 0.105, 0.09, 0.09, 0], [2.52, 2.79, 0.0, 0.1, 0.09, 0.085, -0.2],
  ];
  carpals.forEach(([x, y, z, a0, b0, c0, tilt], i) => CAR.add(ellipsoidP([x, y, z], [a0, b0, c0], [0, 0, tilt]), IVORY, { k: i ? 0.012 : 0 }));
  bones.push({ geometry: polygonize(CAR, boneOpts(CAR)), keepColor: true });
  const finger = (start, heading, lens, radii, curl) => {
    // Bones laid end to end, each a slim shaft flaring at both ends, curling toward the palm (-Z).
    let p = V3(start);
    let d = V3(heading).normalize();
    const side = new THREE.Vector3(0, 0, 1);
    const axis = new THREE.Vector3().crossVectors(d, side).normalize();
    lens.forEach((L, i) => {
      const dir = d.clone().applyAxisAngle(axis, -(curl[i] ?? 0));
      const e = p.clone().addScaledVector(dir, L);
      const r = radii[i];
      const m1 = p.clone().addScaledVector(dir, L * 0.22); const m2 = p.clone().addScaledVector(dir, L * 0.74);
      const last = i === lens.length - 1;
      const g = tube([arr(p), arr(m1), arr(m2), arr(e)], [r * 1.26, r * 0.84, r * 0.82, last ? r * 0.9 : r * 1.14], { sides: 10, steps: 9, round: 2 });
      bones.push({ geometry: g, color: 0xdccfa9 });
      p = e.clone().addScaledVector(dir, 0.012);
      d = dir;
    });
  };
  const fingers = [
    { at: [2.62, 3.13, 0.04], dir: [1, 0.22, 0], lens: [0.62, 0.36, 0.21, 0.15], r: [0.052, 0.044, 0.036, 0.03], curl: [0.02, 0.2, 0.42, 0.62] },
    { at: [2.63, 3.0, 0.03], dir: [1, 0.07, 0], lens: [0.6, 0.39, 0.24, 0.16], r: [0.054, 0.045, 0.037, 0.03], curl: [0.02, 0.22, 0.46, 0.68] },
    { at: [2.62, 2.87, 0.02], dir: [1, -0.08, 0], lens: [0.54, 0.36, 0.23, 0.155], r: [0.05, 0.042, 0.035, 0.028], curl: [0.03, 0.24, 0.5, 0.72] },
    { at: [2.6, 2.75, 0.0], dir: [1, -0.25, 0], lens: [0.5, 0.29, 0.17, 0.14], r: [0.05, 0.037, 0.031, 0.026], curl: [0.05, 0.28, 0.55, 0.78] },
    { at: [2.58, 3.24, 0.05], dir: [0.62, 0.78, 0.12], lens: [0.4, 0.29, 0.21], r: [0.058, 0.046, 0.04], curl: [0, 0.05, 0.14] },
  ];
  for (const f of fingers) finger(f.at, f.dir, f.lens, f.r, f.curl);

  // --- The muscles --------------------------------------------------------------------------------
  const muscles = [];
  // Biceps: two heads from the shoulder blade, one belly, one tendon, to the tuberosity of the radius.
  // Long head: from the top of the socket, over the humerus' head, down the groove.
  muscles.push({
    geometry: muscleLoft(
      [[-0.1, 5.76, -0.3], [0.08, 5.8, -0.06], [0.22, 5.5, 0.05], [0.22, 5.05, 0.06], [0.33, 4.65, 0.09], [0.47, 4.2, 0.13], [0.5, 3.78, 0.14], [0.42, 3.4, 0.11], [0.42, 3.15, 0.09], RAD_TUB],
      [0.03, 0.036, 0.036, 0.05, 0.17, 0.235, 0.215, 0.1, 0.05, 0.035],
      [0.03, 0.036, 0.036, 0.05, 0.2, 0.31, 0.28, 0.1, 0.04, 0.03],
      { rows: 52, cols: 40, a: 0.32, b: 0.74, seed: 1 },
    ),
    keepColor: true,
  });
  // Short head: from the coracoid.
  muscles.push({
    geometry: muscleLoft(
      [[0.3, 5.5, -0.28], [0.32, 5.25, -0.24], [0.34, 4.9, -0.2], [0.42, 4.5, -0.15], [0.5, 4.1, -0.11], [0.52, 3.72, -0.07], [0.44, 3.38, 0.0], [0.43, 3.15, 0.06], RAD_TUB],
      [0.03, 0.04, 0.07, 0.17, 0.225, 0.2, 0.09, 0.05, 0.035],
      [0.03, 0.04, 0.07, 0.2, 0.28, 0.25, 0.09, 0.04, 0.03],
      { rows: 46, cols: 40, a: 0.2, b: 0.72, seed: 2.6 },
    ),
    keepColor: true,
  });
  // Triceps, stretched here, so long and slim. Long head from under the socket.
  const OLEC = [-0.36, 2.66, -0.13];
  muscles.push({
    geometry: muscleLoft(
      [[-0.2, 5.26, -0.42], [-0.3, 5.0, -0.34], [-0.46, 4.6, -0.28], [-0.56, 4.15, -0.2], [-0.55, 3.72, -0.14], [-0.44, 3.34, -0.12], [-0.38, 3.0, -0.13], OLEC],
      [0.04, 0.09, 0.19, 0.22, 0.18, 0.1, 0.075, 0.07],
      [0.04, 0.08, 0.19, 0.25, 0.2, 0.08, 0.03, 0.03],
      { rows: 44, cols: 40, a: 0.1, b: 0.66, seed: 4.1 },
    ),
    keepColor: true,
  });
  // Lateral head from the back of the humerus, the one nearest the viewer.
  muscles.push({
    geometry: muscleLoft(
      [[-0.17, 5.12, 0.03], [-0.28, 4.8, 0.09], [-0.42, 4.35, 0.14], [-0.45, 3.9, 0.15], [-0.41, 3.5, 0.08], [-0.38, 3.15, -0.04], [-0.36, 2.95, -0.1], [-0.36, 2.72, -0.13]],
      [0.05, 0.1, 0.17, 0.17, 0.12, 0.09, 0.07, 0.06],
      [0.05, 0.09, 0.19, 0.2, 0.12, 0.05, 0.03, 0.03],
      { rows: 40, cols: 36, a: 0.1, b: 0.6, seed: 5.3 },
    ),
    keepColor: true,
  });
  // Medial head, deep under the others low on the bone.
  muscles.push({
    geometry: muscleLoft(
      [[-0.12, 4.3, -0.1], [-0.25, 3.95, -0.14], [-0.31, 3.55, -0.2], [-0.33, 3.2, -0.2], [-0.36, 2.9, -0.15], [-0.36, 2.72, -0.13]],
      [0.05, 0.12, 0.15, 0.1, 0.06, 0.05],
      [0.05, 0.1, 0.13, 0.08, 0.03, 0.03],
      { rows: 28, cols: 28, a: 0.08, b: 0.72, seed: 6.2 },
    ),
    keepColor: true,
  });

  // --- The stand ---------------------------------------------------------------------------------
  const stand = [];
  const WOOD = 0x5b3a24; const BRASS = 0xb08d4e;
  const CX = 1.42;
  const slab = lathe([[0, 0], [1, 0], [1, 0.11], [0.985, 0.16], [0.95, 0.2], [0.9, 0.25], [0, 0.25]], 64).scale(2.5, 1, 1.15).translate(CX, 0, -0.1);
  stand.push({ geometry: slab, color: WOOD });
  // The main post stands behind the arm and reaches round to the humerus.
  const POST = [-0.36, -0.62];
  stand.push({ geometry: tube([[POST[0], 0.22, POST[1]], [POST[0], 4.05, POST[1]]], 0.075, { sides: 16, steps: 2, straight: true, round: 1 }), color: BRASS });
  stand.push({ geometry: tube([[POST[0], 4.05, POST[1]], [POST[0] + 0.1, 4.2, POST[1] + 0.12], [-0.3, 4.22, -0.52], [-0.05, 4.2, -0.02]], 0.055, { sides: 12, steps: 14, round: 1 }), color: BRASS });
  stand.push({ geometry: lathe([[0, 0.2], [0.17, 0.2], [0.17, 0.33], [0.1, 0.42], [0.075, 0.5], [0, 0.5]], 22).translate(POST[0], 0, POST[1]), color: BRASS });
  // A slim post under the ulna, with a small cup taking its weight.
  const UP = [1.15, 2.67, -0.06];
  stand.push({ geometry: tube([[UP[0], 0.22, UP[2]], [UP[0], UP[1] - 0.06, UP[2]]], 0.045, { sides: 12, steps: 2, straight: true, round: 1 }), color: BRASS });
  stand.push({ geometry: lathe([[0, 0.2], [0.12, 0.2], [0.12, 0.3], [0.07, 0.38], [0.045, 0.44], [0, 0.44]], 18).translate(UP[0], 0, UP[2]), color: BRASS });

  const fibre = streakMap(7501, { size: 256, lines: 420, dark: 118, alpha: 0.62, bow: 5 });
  const grain = grainBump(7502, { size: 256, dots: 1800, contrast: 0.32 });
  grain.repeat.set(1, 1);
  const root = new THREE.Group();
  root.name = 'arm-muscles';
  const add = (g, params) => { g.translate(OFFSET_X, 0, 0); root.add(mesh(g, standard(params))); };
  add(mergeParts(bones), { vertexColors: true, roughness: 0.56, metalness: 0, bumpMap: grain, bumpScale: 0.6 });
  add(mergeParts(muscles), { vertexColors: true, roughness: 0.48, metalness: 0, map: fibre, bumpMap: fibre, bumpScale: 1.1 });
  add(mergeParts(stand), { vertexColors: true, roughness: 0.5, metalness: 0.12 });
  return root;
}

// ---------------------------------------------------------------------------------------------
// Venus flytrap
// ---------------------------------------------------------------------------------------------

// ONE LOBE of a trap in its own frame: X along the midrib from the stalk end (x = -L/2) to the tip
// (+L/2), +Y out of the mouth, with the lobe swinging away from the plane x-y by `open` radians. It is
// a closed lens, so a lobe has a real edge, and the red inner face and green outer face are told apart
// by which sheet of `solidSurface` a vertex came from, not by guessing from its normal.
const TRAP = { L: 1.28, W: 0.74 };

function trapLobe(side, open, { nu = 18, nv = 10 } = {}) {
  const L = TRAP.L; const W = TRAP.W;
  const reach = (u) => {
    // The lobe's outline: half an ellipse with the flat on the midrib.
    const s = u * 2 - 1;
    return W * Math.sqrt(Math.max(0, 1 - Math.abs(s) ** 2.5));
  };
  const point = (u, v) => {
    const x = (u * 2 - 1) * (L / 2);
    const out = reach(u) * v;
    // Bowed outward like half a clam: back on the midplane at the hinge and at the rim, so that when a
    // trap shuts there is a real chamber inside it.
    const bulge = Math.sin(v * Math.PI) * W * 0.23 * (1 - (u * 2 - 1) ** 2);
    const y = Math.cos(open) * out - Math.sin(open) * bulge;
    const z = Math.sin(open) * out + Math.cos(open) * bulge;
    return [x, y + 0.015, side * (z + 0.012)];
  };
  const g = solidSurface({
    nu, nv,
    point,
    thick: (u, v) => {
      const edge = Math.min(1, u * 8, (1 - u) * 8, (1 - v) * 14 + 0.02);
      return 0.026 * clamp01(edge) + 0.002;
    },
  });
  g.computeVertexNormals();
  return { g, point, reach };
}

function venusFlytrap() {
  const rng = seededRandom(7601);
  const GREEN = lin(0x6bb026); const DEEP = lin(0x2f7a1c); const YELLOW = lin(0xb9cf3e);
  const RED = lin(0xc4101e); const CRIMSON = lin(0x7c0a18); const RIM = lin(0x9ccf3a);
  const leaf = []; // stalks and lobes
  const hair = []; // cilia and trigger hairs

  const placeM = (pos, axis, mouth) => {
    // Builds the matrix for a trap: +X along `axis`, +Y toward `mouth`.
    const X = V3(axis).normalize();
    const Y = V3(mouth).addScaledVector(X, -V3(mouth).dot(X)).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const m = new THREE.Matrix4().makeBasis(X, Y, Z);
    m.setPosition(V3(pos));
    return m;
  };

  // A whole trap, in world space. `open` is the angle each lobe stands off the closed position.
  const buildTrap = (pos, axis, mouth, open, { closing = false } = {}) => {
    const m = placeM(pos, axis, mouth);
    const L = TRAP.L;
    for (const side of [1, -1]) {
      const { g, point, reach } = trapLobe(side, open);
      const nv = 10; const nu = 18;
      const rows = nv + 1; const cols = nu + 1;
      // Which sheet is inner: the one offset toward the midplane (toward z = 0 for this side).
      const P = g.attributes.position;
      const mid = Math.floor(cols / 2) * rows + Math.floor(rows / 2);
      const firstIsInner = Math.abs(P.getZ(mid)) < Math.abs(P.getZ(rows * cols + mid));
      const col = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) {
        const sheet = i < rows * cols ? 0 : 1;
        const inner = (sheet === 0) === firstIsInner;
        const k = sheet === 0 ? i : i - rows * cols;
        const iu = Math.floor(k / rows); const jv = k % rows;
        const u = iu / nu; const v = jv / nv;
        let c;
        if (inner) {
          // The red that lures flies, deepest near the hinge, fading to a green rim band.
          const t = sstep(v, 0.02, 0.7);
          c = [mix(CRIMSON[0], RED[0], t), mix(CRIMSON[1], RED[1], t), mix(CRIMSON[2], RED[2], t)];
          const rim = sstep(v, 0.8, 0.94);
          c = [mix(c[0], RIM[0], rim), mix(c[1], RIM[1], rim), mix(c[2], RIM[2], rim)];
          // Digestive glands: a fine dark freckle over the red.
          const d = sstep(smoothNoise3(u * 22 + side, v * 16, 3.1), 0.56, 0.7) * (1 - rim);
          c = [c[0] * (1 - 0.35 * d), c[1] * (1 - 0.35 * d), c[2] * (1 - 0.35 * d)];
        } else {
          const t = 0.5 + 0.5 * smoothNoise3(u * 5, v * 5, side * 2.3);
          c = [mix(DEEP[0], GREEN[0], t), mix(DEEP[1], GREEN[1], t), mix(DEEP[2], GREEN[2], t)];
          // A touch of the red bleeding round the outside of a lobe in full sun.
          const blush = sstep(v, 0.6, 1) * 0.3;
          c = [mix(c[0], RED[0], blush), mix(c[1], RED[1], blush), mix(c[2], RED[2], blush)];
        }
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.applyMatrix4(m);
      leaf.push({ geometry: g, keepColor: true });

      // The cilia: long tapered teeth round the rim. Counted the way a real lobe has them, with the two
      // lobes offset half a pitch, so that as a trap closes they mesh like fingers.
      const COUNT = 15;
      for (let c = 0; c < COUNT; c++) {
        const u = 0.09 + (0.82 * (c + (side > 0 ? 0.25 : 0.75))) / COUNT;
        const base = V3(point(u, 0.97));
        const b1 = V3(point(u, 0.82));
        const dir = base.clone().sub(b1).normalize();
        const along = (u - 0.5) * 0.5; // the fan: tips lean outward toward the ends of the trap
        const len = 0.36 + 0.06 * Math.sin(u * Math.PI);
        // Each tooth curves in toward the opposite lobe, more so as the trap closes.
        const inward = new THREE.Vector3(0, 0, -side);
        const flare = closing ? 0.18 : -0.1;
        const p1 = base.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(along * len * 0.5, 0, 0)).addScaledVector(inward, len * flare * 0.4);
        const p2 = base.clone().addScaledVector(dir, len).add(new THREE.Vector3(along * len, 0, 0)).addScaledVector(inward, len * flare);
        const ci = tube([[b1.x, b1.y, b1.z], arr(base), arr(p1), arr(p2)], [0.019, 0.017, 0.011, 0.005], { sides: 4, steps: 3, round: 1 });
        ci.applyMatrix4(m);
        hair.push({ geometry: ci, color: 0x9bcc3f });
      }

      // Trigger hairs: three on each lobe's inner face, in a triangle, standing up off the red.
      const spots = [[0.33, 0.42], [0.67, 0.42], [0.5, 0.66]];
      // Which way is off the inner face: toward the midplane, and out of the mouth.
      for (const [u, v] of spots) {
        const q = V3(point(u, v));
        const qn = new THREE.Vector3(0, Math.sin(open), -side * Math.cos(open)).normalize();
        const tipT = q.clone().addScaledVector(qn, 0.16);
        const midT = q.clone().addScaledVector(qn, 0.07);
        const h = tube([[q.x - qn.x * 0.02, q.y - qn.y * 0.02, q.z - qn.z * 0.02], arr(midT), arr(tipT)], [0.018, 0.011, 0.006], { sides: 5, steps: 3, round: 1 });
        h.applyMatrix4(m);
        hair.push({ geometry: h, color: 0xf7e36a });
      }
    }
    // The midrib: the hinge the two lobes meet along, a slim green spine under the mouth.
    const rib = tube([[-L / 2 - 0.02, -0.01, 0], [-L / 4, -0.022, 0], [L / 4, -0.022, 0], [L / 2 + 0.01, -0.005, 0]], [0.046, 0.04, 0.032, 0.012], { sides: 8, steps: 10, round: 1 });
    // Green from behind, dark red along the inside of the hinge, which is the side with the mouth.
    const RIB = lin(0x4f9423);
    tintVertices(rib, (x, y, z, out) => {
      const t = sstep(y, -0.024, 0.0);
      out[0] = mix(RIB[0], CRIMSON[0], t); out[1] = mix(RIB[1], CRIMSON[1], t); out[2] = mix(RIB[2], CRIMSON[2], t);
    });
    rib.applyMatrix4(m);
    leaf.push({ geometry: rib, keepColor: true });
    return m;
  };

  // --- Stalks: flat winged leaf stalks that rise from the crown, narrow to a neck, and carry a trap --
  const CROWN = [0, 1.5, 0];
  const stalk = (tip, axis, width) => {
    // It leaves the crown low and flat, sweeps up, and arrives running along the trap's own axis, so
    // leaf and midrib are one line. A flat blade with a real lens section, and a midvein.
    const T = V3(tip);
    const X = V3(axis).normalize();
    const end = T.clone().addScaledVector(X, -TRAP.L / 2);
    const flat = new THREE.Vector3(end.x, 0, end.z);
    const r = flat.length();
    flat.normalize();
    const start = V3(CROWN).addScaledVector(flat, 0.06);
    // Straight below the trap's stem rather than back along its axis, or a low trap whose midrib leans
    // inward gets a stalk that overshoots and hooks back.
    const bend = end.clone().add(new THREE.Vector3(0, -Math.min(0.9, (end.y - CROWN[1]) * 0.42), 0));
    const low = V3(CROWN).addScaledVector(flat, r * 0.45);
    low.y += (end.y - CROWN[1]) * 0.18;
    const curve = new THREE.CatmullRomCurve3([start, low, bend, end], false, 'catmullrom', 0.5);
    const up = new THREE.Vector3(0, 1, 0);
    const blade = solidSurface({
      nu: 4, nv: 16,
      point: (u, v) => {
        const c = curve.getPoint(v);
        const t = curve.getTangent(v);
        const side = new THREE.Vector3().crossVectors(up, t);
        if (side.lengthSq() < 1e-4) side.set(flat.z, 0, -flat.x);
        side.set(flat.z, 0, -flat.x);
        side.normalize();
        // Narrow at the crown, broad spoon two thirds along, a neck where it meets the trap.
        const w = Math.max(0.012, width * (0.28 + 0.72 * sstep(v, 0.04, 0.44)) * (1 - sstep(v, 0.56, 0.86)));
        const s = u * 2 - 1;
        return [c.x + side.x * s * w, c.y + side.y * s * w, c.z + side.z * s * w];
      },
      thick: (u, v) => (0.024 * (1 - (u * 2 - 1) ** 2) + 0.006) * (1 - 0.75 * sstep(v, 0.56, 0.86)),
    });
    const g = blade;
    g.computeVertexNormals();
    tintVertices(g, (x, y, z, out) => {
      const v = smoothNoise3(x * 1.6, y * 1.6, z * 1.6);
      const k = clamp01((y - 1.5) / 2.4);
      out[0] = mix(mix(DEEP[0], GREEN[0], v), YELLOW[0], k * 0.3);
      out[1] = mix(mix(DEEP[1], GREEN[1], v), YELLOW[1], k * 0.3);
      out[2] = mix(mix(DEEP[2], GREEN[2], v), YELLOW[2], k * 0.3);
    });
    leaf.push({ geometry: g, keepColor: true });
    // The midvein, so a blade has a keel, and so the neck is a round stem and not a sliver.
    const veinPts = [];
    for (let i = 0; i <= 10; i++) { const c = curve.getPoint(i / 10); veinPts.push([c.x, c.y, c.z]); }
    const vein = tube(veinPts, [0.05, 0.046, 0.042, 0.04, 0.04, 0.04, 0.042, 0.044], { sides: 7, steps: 16, round: 1 });
    leaf.push({ geometry: vein, color: 0x5a9c25 });
  };

  // Traps as a table, since this composition is the model: bearing, how far out, how high, how open.
  const ring = [
    { a: 0.04, r: 0.85, y: 4.28, tilt: 1.62, open: 0.74, w: 0.15 }, // the tall one, dead ahead
    { a: -0.92, r: 1.42, y: 3.42, tilt: 1.66, open: 0.8, w: 0.17 },
    { a: 0.98, r: 1.5, y: 3.5, tilt: 1.62, open: 0.74, w: 0.17 },
    { a: -0.24, r: 1.68, y: 2.62, tilt: 1.84, open: 0.82, w: 0.16 },
    { a: 2.5, r: 1.24, y: 3.86, tilt: 1.6, open: 0.76, w: 0.16 },
    { a: -2.45, r: 1.3, y: 3.3, tilt: 1.66, open: 0.8, w: 0.16 },
    { a: -1.78, r: 1.72, y: 2.66, tilt: 1.8, open: 0.78, w: 0.16 },
    { a: 0.52, r: 1.3, y: 2.74, tilt: 1.76, open: 0.32, w: 0.16, closing: true }, // the one with the fly
  ];
  // A few young leaves low in the rosette, spoon-bladed, with a trap still small and shut.
  for (const [a, r] of [[-0.62, 1.2], [1.5, 1.16], [2.0, 1.06], [-1.25, 1.02], [2.95, 1.1], [0.22, 0.86]]) {
    const out = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const tilt = 0.5;
    const axis = out.clone().multiplyScalar(Math.cos(tilt)).add(new THREE.Vector3(0, Math.sin(tilt), 0)).normalize();
    const budAt = [out.x * r, 2.02 + rng() * 0.2, out.z * r];
    stalk(budAt, arr(axis), 0.17);
    // The stalk ends where a trap would start, half the trap's length short of `budAt`.
    const bud = new THREE.SphereGeometry(1, 14, 10).scale(0.21, 0.09, 0.12);
    const mBud = placeM(arr(V3(budAt).addScaledVector(axis, -TRAP.L / 2 + 0.17)), arr(axis), [0, 1, 0]);
    bud.applyMatrix4(mBud);
    leaf.push({ geometry: bud, color: 0x7fb52f });
  }
  let flyM = null;
  for (const t of ring) {
    const out = new THREE.Vector3(Math.sin(t.a), 0, Math.cos(t.a));
    const pos = [out.x * t.r, t.y, out.z * t.r];
    // Midrib near vertical, leaning a little back over the leaf at the top, which turns the mouth
    // outward and slightly up: the view a student has of the red.
    const axis = out.clone().multiplyScalar(Math.cos(t.tilt)).add(new THREE.Vector3(0, Math.sin(t.tilt), 0)).normalize();
    const m = buildTrap(pos, arr(axis), arr(out.clone().add(new THREE.Vector3(0, 0.2, 0))), t.open, { closing: !!t.closing });
    if (t.closing) flyM = m;
    stalk(pos, arr(axis), t.w);
  }

  // --- The fly, inside the half-closed trap ------------------------------------------------------
  const flyParts = [];
  const addFly = (g, color) => { g.translate(0.02, 0.24, 0); g.applyMatrix4(flyM); flyParts.push({ geometry: g, color }); };
  addFly(new THREE.SphereGeometry(0.075, 16, 12).scale(1.5, 0.95, 1), 0x2f3236); // thorax
  addFly(new THREE.SphereGeometry(0.066, 14, 10).scale(1.7, 0.85, 1).translate(-0.15, -0.012, 0), 0x3a4a52); // abdomen
  addFly(new THREE.SphereGeometry(0.056, 14, 10).translate(0.14, 0.012, 0), 0x2a2c30); // head
  for (const s2 of [1, -1]) {
    addFly(new THREE.SphereGeometry(0.038, 12, 9).translate(0.165, 0.02, s2 * 0.038), 0x9c1c14); // the big red eyes
    // Legs, six, thin and bent.
    for (const [lx, sp] of [[0.06, 0.5], [0, 0], [-0.06, -0.5]]) {
      addFly(tube([[lx, -0.02, s2 * 0.05], [lx + sp * 0.06, 0.03, s2 * 0.15], [lx + sp * 0.14, -0.07, s2 * 0.21]], [0.011, 0.008, 0.005], { sides: 5, steps: 5, round: 1 }), 0x1c1e22);
    }
    // A wing: a thin solid leaf lying back along the body.
    const wing = solidSurface({
      nu: 4, nv: 5,
      point: (u, v) => {
        const s = u * 2 - 1;
        const w = 0.055 * Math.sin(Math.PI * clamp01(v * 0.95 + 0.05));
        return [0.03 - v * 0.3, 0.07 + v * 0.03, s2 * (0.05 + v * 0.1 + s * w)];
      },
      thick: () => 0.003,
    });
    wing.computeVertexNormals();
    addFly(wing, 0xb6c3c8);
  }

  // --- The pot, the peat and the moss ---------------------------------------------------------------
  const pot = [];
  const POT_R = 1.42; const PEAT_Y = 1.5;
  const potG = lathe([
    [0, 0], [0.98, 0], [1.0, 0.05], [1.02, 0.12], [1.2, 0.6], [1.34, 1.12], [1.38, 1.3], [1.5, 1.32], [1.52, 1.4], [1.52, 1.62], [1.46, 1.66], [POT_R, 1.66], [POT_R - 0.02, 1.52], [POT_R - 0.04, 1.38], [0, 1.38],
  ], 72);
  const GLAZE = lin(0x8f4e2c); const GLAZE2 = lin(0xb46c3a);
  tintVertices(potG, (x, y, z, out) => {
    const n = smoothNoise3(x * 2.2, y * 3.4, z * 2.2);
    const band = sstep(y, 1.28, 1.34);
    out[0] = mix(GLAZE[0], GLAZE2[0], n * 0.7 + band * 0.3);
    out[1] = mix(GLAZE[1], GLAZE2[1], n * 0.7 + band * 0.3);
    out[2] = mix(GLAZE[2], GLAZE2[2], n * 0.7 + band * 0.3);
  });
  pot.push({ geometry: potG, keepColor: true });
  // A shallow saucer of standing water under it: a flytrap sits wet.
  const saucer = lathe([[0, 0], [1.42, 0], [1.46, 0.02], [1.56, 0.14], [1.53, 0.16], [1.46, 0.08], [0, 0.08]], 64);
  pot.push({ geometry: saucer, color: 0x76412a });

  // The peat, a lumpy dark surface with a tight rim, and moss patching over it.
  const PEAT_D = lin(0x2c1c12); const PEAT_L = lin(0x4d3421);
  const MOSS_A = lin(0x4a8a24); const MOSS_B = lin(0x93b53c);
  const peatH = (x, z) => 0.05 * (smoothNoise3(x * 1.6, 2.2, z * 1.6) - 0.5) * 2 + 0.03 * (smoothNoise3(x * 5, 7.1, z * 5) - 0.5) * 2;
  const mossF = (x, z) => sstep(smoothNoise3(x * 0.95 + 4, 1.3, z * 0.95 + 8), 0.42, 0.6);
  const peat = loftGrid(30, 72, (v, u) => {
    // v from the centre out to the wall, then a skirt down inside the pot and back under, so it closes.
    const a = u * Math.PI * 2;
    if (v > 0.96) {
      const y = PEAT_Y - ((v - 0.96) / 0.04) * 0.3;
      return [Math.cos(a) * (POT_R - 0.015) * (1 - ((v - 0.96) / 0.04) * (v >= 1 ? 1 : 0)), y, Math.sin(a) * (POT_R - 0.015) * (1 - ((v - 0.96) / 0.04) * (v >= 1 ? 1 : 0))];
    }
    const r = (v / 0.96) * (POT_R - 0.015);
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    return [x, PEAT_Y + peatH(x, z) * sstep(POT_R - r, 0, 0.14) + (1 - sstep(r, 0, 0.3)) * 0.07, z];
  }, { uv: (v, u) => [Math.cos(u * Math.PI * 2) * v * 3 + 0.5, Math.sin(u * Math.PI * 2) * v * 3 + 0.5] });
  tintVertices(peat, (x, y, z, out) => {
    const fine = 0.5 + 0.5 * smoothNoise3(x * 9, y * 9, z * 9);
    const b = mossF(x, z);
    const mo = smoothNoise3(x * 5, 3, z * 5);
    out[0] = mix(mix(PEAT_D[0], PEAT_L[0], fine), mix(MOSS_A[0], MOSS_B[0], mo), b);
    out[1] = mix(mix(PEAT_D[1], PEAT_L[1], fine), mix(MOSS_A[1], MOSS_B[1], mo), b);
    out[2] = mix(mix(PEAT_D[2], PEAT_L[2], fine), mix(MOSS_A[2], MOSS_B[2], mo), b);
  });
  // Sphagnum heads: a little star-topped dome, many of them, thickest where the moss patch is.
  const mossHeads = [{ geometry: peat, keepColor: true }];
  for (let i = 0; i < 230; i++) {
    const a = rng() * Math.PI * 2; const r = Math.sqrt(rng()) * (POT_R - 0.1);
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    if (mossF(x, z) < 0.4 && rng() > 0.1) continue;
    if (r < 0.2) continue;
    const size = 0.03 + rng() * 0.032;
    const head = new THREE.SphereGeometry(size, 7, 4).scale(1, 0.66, 1);
    head.translate(x, PEAT_Y + peatH(x, z) + size * 0.3, z);
    const toneT = rng();
    const c = new THREE.Color().setRGB(mix(MOSS_A[0], MOSS_B[0], toneT), mix(MOSS_A[1], MOSS_B[1], toneT), mix(MOSS_A[2], MOSS_B[2], toneT));
    mossHeads.push({ geometry: head, color: c.getHex() });
  }
  // The rhizome's pale crown at the middle of the rosette, where all the stalks come from.
  pot.push({ geometry: new THREE.SphereGeometry(0.2, 18, 12).scale(1, 0.62, 1).translate(CROWN[0], CROWN[1] + 0.03, CROWN[2]), color: 0xd8d6a0 });

  // Sphagnum is a mat of tiny stars, far finer than any mesh here, so it is a near-white painting.
  const mossRng = seededRandom(7603);
  const mossMap = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const x = mossRng() * w; const y = mossRng() * h; const r = 3 + mossRng() * 6;
      const v = 150 + Math.floor(mossRng() * 105);
      ctx.strokeStyle = `rgb(${v},${v},${v})`;
      ctx.lineWidth = 1 + mossRng();
      const n = 5 + Math.floor(mossRng() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + mossRng();
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.stroke();
      }
    }
  });
  mossMap.wrapS = THREE.RepeatWrapping; mossMap.wrapT = THREE.RepeatWrapping;
  const root = new THREE.Group();
  root.name = 'venus-flytrap';
  root.add(mesh(mergeParts(leaf), standard({ vertexColors: true, roughness: 0.42, metalness: 0, side: THREE.FrontSide })));
  root.add(mesh(mergeParts(hair), standard({ vertexColors: true, roughness: 0.5, metalness: 0 })));
  root.add(mesh(mergeParts(flyParts), standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  root.add(mesh(mergeParts(pot), standard({ vertexColors: true, roughness: 0.74, metalness: 0 })));
  root.add(mesh(mergeParts(mossHeads), standard({ vertexColors: true, roughness: 0.8, metalness: 0, map: mossMap, bumpMap: mossMap, bumpScale: 1.2 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Giant panda
// ---------------------------------------------------------------------------------------------

// Sitting upright on a mossy rock, legs out in front, chewing a bamboo stem held in its left paw. The
// black and white is THE one field `blackD`, negative where a panda is black, so skin, tufts and the
// snapped colour edge can never disagree about where the shoulder band stops. What makes it a panda
// rather than a bear painted black and white, in order: the very broad round head with wide cheeks,
// small eyes in drooping patches, and the band running over the shoulders and joining the forelegs.
// The fur is a strand map carried on re-laid UVs, plus about six hundred real tufts for the silhouette.
function giantPanda() {
  const DZ = -0.42; // the whole animal is set back over its rock
  const rng = seededRandom(7701);
  const WHITE = lin(0xdcd6c6); const BLACK = lin(0x1a1a1f); const PAD = lin(0x77727a);

  // --- The limbs' centre lines, which both the sculpt and the paint read ---------------------------
  const armL = [[0.74, 2.2, 0.14], [1.12, 1.72, 0.74], [0.9, 2.3, 1.1], [0.8, 2.56, 1.2]];
  const armLr = [0.4, 0.33, 0.26, 0.21];
  const armR = [[-0.74, 2.2, 0.14], [-1.1, 1.56, 0.52], [-0.84, 1.28, 0.98], [-0.62, 1.26, 1.2]];
  const armRr = [0.4, 0.33, 0.26, 0.21];
  const leg = (s) => [[s * 0.6, 0.84, 0.22], [s * 0.98, 1.0, 1.0], [s * 0.86, 0.8, 1.52], [s * 0.84, 0.9, 1.72]];
  const legR = [0.56, 0.42, 0.3, 0.28];
  const sArmL = sampleCurve(armL, armLr, 20); const sArmR = sampleCurve(armR, armRr, 20);
  const sLegL = sampleCurve(leg(1), legR, 20); const sLegR = sampleCurve(leg(-1), legR, 20);
  const armLf = segsP(sArmL.P, sArmL.R); const armRf = segsP(sArmR.P, sArmR.R);
  const legLf = segsP(sLegL.P, sLegL.R); const legRf = segsP(sLegR.P, sLegR.R);

  const bodyBlack = (x, y, z) => {
    const wob = (smoothNoise3(x * 2.6, y * 2.6, z * 2.6) - 0.5) * 0.08;
    // The band: over the shoulders and round the chest, higher behind than in front.
    const top = 2.5 + (z < 0 ? 0.0 : -0.12);
    const bot = 1.86 - (z < 0 ? 0.06 : -0.02);
    const band = Math.max(y - top, bot - y) + wob;
    const limb = Math.min(armLf.f(x, y, z), armRf.f(x, y, z)) - 0.1;
    const hind = Math.min(legLf.f(x, y, z), legRf.f(x, y, z)) - 0.05 + wob * 0.5;
    return Math.min(band, limb, hind);
  };

  // --- The body ------------------------------------------------------------------------------------
  const body = new Sculpt(0.1);
  const torso = axisLoft([
    [0.52, -0.02, 0.62, 0.55, 0.66],
    [0.82, -0.02, 1.02, 0.86, 0.94],
    [1.24, 0.02, 1.08, 0.96, 0.96],
    [1.72, 0.02, 0.96, 0.8, 0.86],
    [2.14, 0.04, 0.82, 0.6, 0.76],
    [2.48, 0.1, 0.62, 0.46, 0.58],
    [2.8, 0.18, 0.42, 0.34, 0.42],
  ], 'y');
  body.add(torso, WHITE);
  body.add(armLf, BLACK, { k: 0.2, ck: 0.1 });
  body.add(armRf, BLACK, { k: 0.2, ck: 0.1 });
  body.add(legLf, BLACK, { k: 0.24, ck: 0.1 });
  body.add(legRf, BLACK, { k: 0.24, ck: 0.1 });
  body.add(ellipsoidP([0, 0.86, -1.02], [0.19, 0.2, 0.15]), WHITE, { k: 0.12 }); // the short white tail
  const aoTint = (ops, reach, blackF, wash = null) => (x, y, z, nx, ny, nz, rgb) => {
    const open = clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);
    const ao = mix(0.5, 1, open);
    const b = sstep(-blackF(x, y, z), -0.02, 0.02);
    const k = (0.92 + 0.14 * smoothNoise3(x * 3.2, y * 3.2, z * 3.2)) * ao;
    let r = mix(WHITE[0], BLACK[0], b); let g = mix(WHITE[1], BLACK[1], b); let bl = mix(WHITE[2], BLACK[2], b);
    if (wash) { const t = wash(x, y, z) * (1 - b); r = mix(r, 0.6, t); g = mix(g, 0.55, t); bl = mix(bl, 0.46, t); }
    rgb[0] = r * k; rgb[1] = g * k; rgb[2] = bl * k;
  };
  const bodyGeo = polygonize(body, { uvScale: 1, tint: aoTint(body.ops, 0.28, bodyBlack), snap: bodyBlack });

  // --- The head -----------------------------------------------------------------------------------
  const head = new Sculpt(0.058);
  const HC = [0, 2.98, 0.26];
  const earAt = (s) => [s * 0.47, 3.42, 0.08];
  const patchAt = (s) => ellipsoidP([s * 0.265, 2.95, 0.71], [0.145, 0.215, 0.17], [0, 0, s * 0.6]);
  const earF = (s) => ellipsoidP(earAt(s), [0.2, 0.2, 0.1], [0.1, s * -0.35, s * -0.3]);
  const headBlack = (x, y, z) => Math.min(
    patchAt(1).f(x, y, z), patchAt(-1).f(x, y, z),
    earF(1).f(x, y, z) - 0.02, earF(-1).f(x, y, z) - 0.02,
  );
  head.add(ellipsoidP(HC, [0.62, 0.53, 0.56]), WHITE);
  // The cheeks, which are huge: a panda's jaw muscles are what make its face so broad.
  for (const s of [1, -1]) {
    head.add(ellipsoidP([s * 0.38, 2.77, 0.38], [0.36, 0.33, 0.36]), WHITE, { k: 0.18 });
    head.add(earF(s), BLACK, { k: 0.04, ck: 0.05 });
    // The brow, a soft ledge over each eye.
    head.add(ellipsoidP([s * 0.22, 3.11, 0.68], [0.17, 0.08, 0.1], [0, 0, s * -0.3]), WHITE, { k: 0.1 });
  }
  head.add(ellipsoidP([0, 2.78, 0.82], [0.27, 0.2, 0.22]), WHITE, { k: 0.12 }); // the muzzle
  head.add(ellipsoidP([0, 2.63, 0.72], [0.2, 0.12, 0.2]), WHITE, { k: 0.08 }); // the chin
  head.add(ellipsoidP([0, 2.6, 0.12], [0.4, 0.34, 0.36]), WHITE, { k: 0.2 }); // the neck stub
  const headField = head.snapshot();
  // The eyes are small and set well forward, each sitting in its own socket in the patch.
  const eyes = [1, -1].map((s) => {
    const p = onSurface(headField, [s * 0.215, 3.0, 0.82]);
    const n = fieldNormal(headField, p);
    head.sub(sphereP(p, 0.05), BLACK, { k: 0.02, ck: 0.03 });
    return { p, n, s };
  });
  const headGeo = polygonize(head, {
    uvScale: 1,
    tint: aoTint(head.ops, 0.16, headBlack, (x, y, z) => 0.3 * sstep(z, 0.82, 1.0) * (1 - sstep(y, 2.8, 3.0))),
    snap: headBlack,
  });

  // Turn the head a little toward the stem, as an animal does when it chews on one side.
  const headM = new THREE.Matrix4().makeTranslation(0, 2.5, 0.1)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.05, 0.2, -0.04, 'YXZ')))
    .multiply(new THREE.Matrix4().makeTranslation(0, -2.5, -0.1));
  const inHead = (p) => { const v = V3(p).applyMatrix4(headM); return [v.x, v.y, v.z]; };

  const skin = [];
  const eyesP = [];
  const hard = [];
  headGeo.applyMatrix4(headM);
  skin.push({ geometry: boxUV(headGeo, 2.7), keepColor: true });
  skin.push({ geometry: boxUV(bodyGeo, 2.7), keepColor: true });
  for (const e of eyes) {
    const c = [e.p[0] - e.n[0] * 0.018, e.p[1] - e.n[1] * 0.018, e.p[2] - e.n[2] * 0.018];
    const eye = new THREE.SphereGeometry(0.058, 18, 14).translate(c[0], c[1], c[2]);
    eye.applyMatrix4(headM);
    eyesP.push({ geometry: eye, color: 0x241510 });
    const hl = new THREE.SphereGeometry(0.014, 8, 6).translate(c[0] + e.n[0] * 0.052 + 0.016, c[1] + e.n[1] * 0.052 + 0.022, c[2] + e.n[2] * 0.052);
    hl.applyMatrix4(headM);
    eyesP.push({ geometry: hl, color: 0xeee8dc });
  }
  // The mouth: a thin dark line lying on the sculpted muzzle, with the philtrum running down to it.
  const headNow = head.snapshot();
  const line = (points, r) => {
    const P = points.map((q) => onSurface(headNow, q, 0.002));
    const { P: S } = sampleCurve(P, 1, 14);
    const Q = S.map((q) => onSurface(headNow, q, 0.002, 6));
    const g = tube(Q, r, { sides: 6, steps: 18, round: 1 });
    g.applyMatrix4(headM);
    eyesP.push({ geometry: g, color: 0x1d1a1c });
  };
  // The nose: broad, wet and truly black, with its own smooth surface.
  const nose = new THREE.SphereGeometry(1, 22, 16).scale(0.125, 0.082, 0.078).translate(0, 2.835, 0.985);
  nose.applyMatrix4(headM);
  eyesP.push({ geometry: nose, color: 0x101012 });
  line([[0, 2.76, 1.04], [0, 2.71, 1.02]], 0.012);
  line([[-0.17, 2.68, 0.96], [-0.09, 2.665, 1.01], [0, 2.71, 1.03], [0.09, 2.665, 1.01], [0.19, 2.68, 0.95]], 0.012);

  // --- Paws and feet, fine enough to show the grip ----------------------------------------------
  const paws = new Sculpt(0.044);
  const CLAW = 0x2a2520;
  const addClaw = (from, dir, L = 0.1, r = 0.024) => {
    const d = V3(dir).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const g = lathe([[0, -0.03], [r, -0.03], [r * 0.95, L * 0.2], [r * 0.6, L * 0.6], [0, L]], 8);
    g.applyMatrix4(new THREE.Matrix4().compose(V3(from), q, new THREE.Vector3(1, 1, 1)));
    hard.push({ geometry: g, color: CLAW });
  };

  // The stem, which everything else about this paw is arranged round.
  const MOUTH = inHead([0.19, 2.66, 0.92]);
  const GRIP = [0.84, 2.66, 1.28];
  const STEM = [MOUTH, [0.5, 2.67, 1.13], GRIP, [1.32, 2.84, 1.52], [1.84, 3.14, 1.74]];
  const stemCurve = new THREE.CatmullRomCurve3(STEM.map(V3), false, 'catmullrom', 0.5);
  const tGrip = 0.5;
  const G = stemCurve.getPoint(tGrip);
  const D = stemCurve.getTangent(tGrip);
  // Palm below and behind the stem, fingers coming up over it and round to the front.
  const toWrist = V3(armL[2]).sub(G);
  const n = toWrist.clone().addScaledVector(D, -toWrist.dot(D)).normalize();
  const b = new THREE.Vector3().crossVectors(D, n).normalize();
  // Make sure the fingers wrap over the top and toward the viewer, where a student can see them.
  if (b.y < 0) b.negate();
  const ST_R = 0.058;
  const around = (theta, R, s) => G.clone().addScaledVector(n, Math.cos(theta) * R).addScaledVector(b, Math.sin(theta) * R).addScaledVector(D, s);
  const palmC = around(0, ST_R + 0.15, 0);
  paws.add(ellipsoidP(arr(palmC), [0.21, 0.21, 0.21]), BLACK);
  paws.add(curveP([armL[1], armL[2], arr(palmC)], [0.33, 0.26, 0.18], 12), BLACK, { k: 0.12 });
  const DIGITS = 5;
  for (let i = 0; i < DIGITS; i++) {
    const sAlong = (i - (DIGITS - 1) / 2) * 0.1;
    const pts = [arr(around(0.3, ST_R + 0.14, sAlong)), arr(around(1.05, ST_R + 0.066, sAlong)), arr(around(1.9, ST_R + 0.058, sAlong)), arr(around(2.7, ST_R + 0.056, sAlong * 1.05))];
    paws.add(curveP(pts, [0.068, 0.058, 0.052, 0.044], 10), BLACK, { k: 0.04 });
    const tipP = around(2.7, ST_R + 0.056, sAlong * 1.05);
    const tipD = around(3.15, ST_R + 0.05, sAlong * 1.05).sub(tipP);
    addClaw(arr(tipP), arr(tipD), 0.1, 0.021);
  }
  // THE FALSE THUMB: the pad on the enlarged wrist bone, pressing the stem from the other side.
  const THUMB_C = around(-1.25, ST_R + 0.07, -0.24);
  paws.add(curveP([arr(palmC.clone().addScaledVector(D, -0.18)), arr(around(-0.7, ST_R + 0.12, -0.26)), arr(THUMB_C)], [0.11, 0.09, 0.07], 8), PAD, { k: 0.05, ck: 0.05 });

  // The resting paw on the right thigh.
  const RP = armR[3];
  paws.add(ellipsoidP(RP, [0.22, 0.17, 0.24]), BLACK);
  paws.add(curveP([armR[1], armR[2], RP], [0.33, 0.26, 0.18], 12), BLACK, { k: 0.12 });
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.3;
    const at = [RP[0] + Math.sin(a + 0.25) * 0.2, RP[1] - 0.04 + Math.cos(a * 1.2) * 0.02, RP[2] + Math.cos(a + 0.25) * 0.2];
    paws.add(ellipsoidP(at, [0.062, 0.055, 0.075]), BLACK, { k: 0.03 });
    addClaw([at[0] + Math.sin(a + 0.25) * 0.05, at[1] - 0.01, at[2] + Math.cos(a + 0.25) * 0.05], [Math.sin(a + 0.25), -0.5, Math.cos(a + 0.25)], 0.09, 0.02);
  }

  const pads = [];
  // Feet, sole forward. A panda walks flat on its feet and shows the whole sole when it sits like this.
  for (const s of [1, -1]) {
    const F = [s * 0.86, 0.92, 1.78];
    paws.add(ellipsoidP(F, [0.31, 0.38, 0.2], [-0.25, 0, s * -0.1]), BLACK, { k: 0.08 });
    paws.add(curveP([leg(s)[2], F], [0.3, 0.24], 6), BLACK, { k: 0.1 });
    // Pads are asked where the sole actually is, then sunk into it: the big pad across the middle, and
    // five toe pads in an arc above it, each with a claw. The sole is bare skin, unlike the fur round it.
    const sole = paws.snapshot();
    const onSole = (x, y) => {
      // Straight back from the front until the field says skin: the nearest-point walk would slide
      // every pad toward the middle of the sole and fuse them.
      let z = F[2] + 0.5;
      for (let i = 0; i < 60; i++) { const d = sole.d(x, y, z); if (d < 0.004) break; z -= Math.max(0.004, d * 0.7); }
      return [x, y, z];
    };
    const mid = onSole(F[0], F[1] - 0.08);
    pads.push([mid, [0.19, 0.125, 0.05]]);
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.46;
      const x = F[0] + Math.sin(a) * 0.25;
      const y = F[1] + 0.06 + Math.cos(a) * 0.2;
      const q = onSole(x, y);
      pads.push([q, [0.05, 0.056, 0.04]]);
      addClaw([q[0] + Math.sin(a) * 0.05, q[1] + Math.cos(a) * 0.05, q[2] - 0.05], [Math.sin(a) * 0.8, Math.cos(a), 0.42], 0.11, 0.024);
    }
  }
  for (const [q, r] of pads) paws.add(ellipsoidP(q, r), PAD, { k: 0.012, ck: 0.014 });
  const pawOps = paws.ops;
  skin.push({
    geometry: boxUV(polygonize(paws, {
      uvScale: 1,
      tint: (x, y, z, nx, ny, nz, rgb) => {
        const open = clamp01(fieldD(pawOps, x + nx * 0.1, y + ny * 0.1, z + nz * 0.1) / 0.1);
        const k = mix(0.6, 1, open);
        rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      },
    }), 2.7),
    keepColor: true,
  });

  // --- The fur's silhouette: tufts laid on the sculpt, coloured by the same field ---------------------
  const fur = [];
  const flow = new THREE.Vector3(); const nrm = new THREE.Vector3();
  const lockAt = (root, dir, normal, L, W, tone, opts, matrix = null) => {
    const g = lockGeo(root, dir, normal, L, W, opts);
    const rk = root;
    tintVertices(g, (x, y, z, out) => {
      const d = Math.hypot(x - rk[0], y - rk[1], z - rk[2]) / L;
      const k = mix(0.86, 1.04, sstep(d, 0.05, 0.9));
      out[0] = tone[0] * k; out[1] = tone[1] * k; out[2] = tone[2] * k;
    });
    if (matrix) g.applyMatrix4(matrix);
    fur.push({ geometry: g, keepColor: true });
  };
  const toneFor = (isBlack) => {
    const j = 0.92 + rng() * 0.16;
    const c = isBlack ? BLACK : WHITE;
    return [c[0] * j * (isBlack ? 1.3 : 1), c[1] * j * (isBlack ? 1.3 : 1), c[2] * j * (isBlack ? 1.3 : 1)];
  };
  scatterOn(bodyGeo, 0.25, rng, (x, y, z, nx, ny, nz) => {
    // Under the seat, inside the arms and behind the feet nobody sees and nothing shows in outline.
    if (y < 0.58 || (Math.abs(x) < 0.5 && y > 2.5)) return;
    if (z > 1.5 && y < 1.5) return; // the soles stay bare
    nrm.set(nx, ny, nz);
    flow.set(Math.sign(x || 1) * 0.28, -1, -0.34);
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.02) flow.set(0, -1, -0.2);
    flow.normalize();
    const black = bodyBlack(x, y, z) < 0;
    let L = (black ? 0.26 : 0.28) + rng() * 0.14;
    // A tuft stops about where the colour does, or the band's edge grows a row of black teeth.
    if ((bodyBlack(x + flow.x * L, y + flow.y * L, z + flow.z * L) < 0) !== black) L *= 0.4;
    lockAt([x - nx * 0.02, y - ny * 0.02, z - nz * 0.02], flow.clone(), nrm.clone(), L, 0.12 + rng() * 0.05, toneFor(black), { nv: 3, lift: 0.2, droop: 0.05, th: 0.014 });
  });
  scatterOn(polygonizedPlain(head), 0.14, rng, (x, y, z, nx, ny, nz) => {
    // Face bare enough to read: nothing on the patches, the nose or the front of the muzzle.
    if (z > 0.78 && y < 3.15 && Math.abs(x) < 0.42) return;
    for (const s of [1, -1]) if (patchAt(s).f(x, y, z) < 0.03 || earF(s).f(x, y, z) < 0.05) return;
    if (ny < -0.6 || y < 2.62) return;
    nrm.set(nx, ny, nz);
    flow.set(x, y - 2.86, z - 1.05).normalize();
    flow.y -= 0.2;
    flow.addScaledVector(nrm, -flow.dot(nrm));
    if (flow.lengthSq() < 0.02) flow.set(0, -1, -0.2);
    flow.normalize();
    const black = headBlack(x, y, z) < 0.02;
    const cheek = Math.abs(x) > 0.5 && y < 3.0;
    const L = (cheek ? 0.22 : 0.13) + rng() * 0.06;
    lockAt([x - nx * 0.012, y - ny * 0.012, z - nz * 0.012], flow.clone(), nrm.clone(), L, 0.075 + rng() * 0.04, toneFor(black), { nv: 3, lift: 0.2, droop: 0.03, th: 0.01 }, headM);
  });

  // --- Bamboo ---------------------------------------------------------------------------------------
  const CULM = lin(0x6f9a2c); const CULM_D = lin(0x4d7420); const NODE = lin(0xc4c47a);
  const plant = [];
  const stemL = stemCurve.getLength();
  const stemPts = [];
  for (let i = 0; i <= 24; i++) { const v = stemCurve.getPoint(i / 24); stemPts.push([v.x, v.y, v.z]); }
  const NODES = [0.3, 0.72, 1.14, 1.56, 1.98];
  const stemG = tube(stemPts, ST_R, { sides: 12, steps: 72, round: 2 });
  const stemC = lin(0x7ea730);
  tintVertices(stemG, (x, y, z, out) => {
    let d = 1e9;
    for (const nd of NODES) {
      const pn = stemCurve.getPointAt(clamp01(nd / stemL));
      d = Math.min(d, Math.hypot(x - pn.x, y - pn.y, z - pn.z));
    }
    const node = 1 - sstep(d, 0.05, 0.075);
    const k = 0.9 + 0.2 * smoothNoise3(x * 3, y * 9, z * 3);
    out[0] = mix(stemC[0] * k, NODE[0], node); out[1] = mix(stemC[1] * k, NODE[1], node); out[2] = mix(stemC[2] * k, NODE[2], node);
  });
  plant.push({ geometry: stemG, keepColor: true });
  // Swollen node rings, real geometry.
  for (const nd of NODES) {
    const pn = stemCurve.getPointAt(clamp01(nd / stemL));
    const tn = stemCurve.getTangentAt(clamp01(nd / stemL));
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tn);
    const ring = lathe([[0, -0.03], [ST_R * 1.03, -0.03], [ST_R * 1.22, 0], [ST_R * 1.03, 0.03], [0, 0.03]], 14);
    ring.applyMatrix4(new THREE.Matrix4().compose(pn, q, new THREE.Vector3(1, 1, 1)));
    plant.push({ geometry: ring, color: 0xa9ac5c });
  }
  // A leaf is a slim solid lance, its midrib a fold, drooping from a little stalk.
  const leafAt = (root, dir, out, L, W, tone) => {
    const d = V3(dir).normalize();
    const o = V3(out).addScaledVector(d, -V3(out).dot(d)).normalize();
    const side = new THREE.Vector3().crossVectors(d, o).normalize();
    const g = solidSurface({
      nu: 4, nv: 7,
      point: (u, v) => {
        const s = u * 2 - 1;
        const w = W * Math.sin(Math.PI * clamp01(v ** 0.72)) ** 0.85;
        const a = L * v;
        const droop = -0.32 * L * v * v;
        const fold = Math.abs(s) * w * 0.26;
        return [
          root[0] + d.x * a + side.x * s * w + o.x * fold,
          root[1] + d.y * a + side.y * s * w + o.y * fold + droop,
          root[2] + d.z * a + side.z * s * w + o.z * fold,
        ];
      },
      thick: (u, v) => 0.011 * (1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * clamp01(v)) + 0.002,
    });
    g.computeVertexNormals();
    const rc = root;
    tintVertices(g, (x, y, z, out2) => {
      const t = clamp01(Math.hypot(x - rc[0], y - rc[1], z - rc[2]) / L);
      const k = 0.88 + 0.3 * t;
      out2[0] = tone[0] * k; out2[1] = tone[1] * k; out2[2] = tone[2] * k;
    });
    plant.push({ geometry: g, keepColor: true });
  };
  const LEAF_A = lin(0x3f8f22); const LEAF_B = lin(0x75b32f);
  const sprig = (t, count, bias) => {
    const c = stemCurve.getPointAt(t);
    const T = stemCurve.getTangentAt(t);
    const out0 = new THREE.Vector3(bias[0], bias[1], bias[2]);
    const twigEnd = c.clone().addScaledVector(T, 0.28).addScaledVector(out0, 0.3);
    plant.push({ geometry: tube([arr(c), arr(c.clone().addScaledVector(T, 0.12).addScaledVector(out0, 0.16)), arr(twigEnd)], [0.018, 0.015, 0.012], { sides: 6, steps: 6, round: 1 }), color: 0x7ea730 });
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 1.7 - 0.85 + (rng() - 0.5) * 0.3;
      const root = twigEnd.clone().addScaledVector(T, -0.03 * i);
      const dir = T.clone().multiplyScalar(0.72).addScaledVector(out0, Math.cos(a) * 0.72).add(new THREE.Vector3(0, Math.sin(a) * 0.5, 0)).normalize();
      const tone = mix3(LEAF_A, LEAF_B, rng());
      leafAt(arr(root), arr(dir), [0, 1, 0.1], 0.62 + rng() * 0.26, 0.078 + rng() * 0.022, tone);
    }
  };
  sprig(0.62, 4, [0.1, -0.5, 0.8]);
  sprig(0.74, 4, [0.0, 0.8, -0.5]);
  sprig(0.84, 5, [0.2, -0.4, 0.8]);
  sprig(0.93, 5, [0.1, 0.7, -0.4]);
  sprig(1.0, 6, [0.5, 0.2, 0.2]);

  // --- The rock ------------------------------------------------------------------------------------
  const rock = new Sculpt(0.11);
  const STONE = lin(0x7b7a72);
  rock.add(ellipsoidP([0, 0.1, 0.42], [2.1, 0.55, 2.0]), STONE);
  rock.add(ellipsoidP([-1.15, 0.2, 1.0], [0.9, 0.46, 0.8]), STONE, { k: 0.2 });
  rock.add(ellipsoidP([1.2, 0.24, 0.3], [0.9, 0.42, 1.0]), STONE, { k: 0.2 });
  rock.add(ellipsoidP([0.1, 0.22, -0.6], [1.1, 0.4, 0.8]), STONE, { k: 0.3 });
  rock.map((d, x, y, z) => d + (smoothNoise3(x * 1.5, y * 1.5, z * 1.5) - 0.5) * 0.34 + (smoothNoise3(x * 4.3, y * 4.3, z * 4.3) - 0.5) * 0.1);
  rock.sub({ box: [-4, -2, -4, 4, 0, 5], f: (x, y) => y });
  const MOSS_D = lin(0x2c521b); const MOSS_L = lin(0x577d27); const STONE_D = lin(0x4d4b46);
  const rockGeo = polygonize(rock, {
    uvScale: 1.5,
    bounds: [-3, -0.1, -2.2, 3, 1.1, 3],
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const m = smoothNoise3(x * 1.3 + 3, y * 1.3, z * 1.3 + 7);
      const moss = sstep(ny + (m - 0.5) * 1.5, 0.54, 0.66);
      const s = smoothNoise3(x * 3.2, y * 3.2, z * 3.2);
      const f = smoothNoise3(x * 8, y * 8, z * 8);
      const r0 = mix(STONE_D[0], STONE[0], s); const g0 = mix(STONE_D[1], STONE[1], s); const b0 = mix(STONE_D[2], STONE[2], s);
      rgb[0] = mix(r0, mix(MOSS_D[0], MOSS_L[0], f), moss);
      rgb[1] = mix(g0, mix(MOSS_D[1], MOSS_L[1], f), moss);
      rgb[2] = mix(b0, mix(MOSS_D[2], MOSS_L[2], f), moss);
    },
  });
  const strands = streakMap(7702, { size: 256, lines: 520, dark: 205, alpha: 0.6, base: '#f4f4f4', bow: 14 });
  const mossBump = grainBump(7703, { size: 128, dots: 900, contrast: 0.6 });
  const speckRng = seededRandom(7704);
  const speck = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const v = speckRng() > 0.5 ? 255 : 140 + Math.floor(speckRng() * 60);
      ctx.fillStyle = `rgba(${v},${v},${v},0.8)`;
      ctx.beginPath(); ctx.arc(speckRng() * w, speckRng() * h, 0.8 + speckRng() * 2, 0, Math.PI * 2); ctx.fill();
    }
  });
  speck.wrapS = THREE.RepeatWrapping; speck.wrapT = THREE.RepeatWrapping;
  const root = new THREE.Group();
  root.name = 'giant-panda';
  const add = (g, params) => { g.translate(0, 0, DZ); root.add(mesh(g, standard(params))); };
  add(mergeParts(skin), { vertexColors: true, roughness: 0.82, metalness: 0, map: strands, bumpMap: strands, bumpScale: 0.7 });
  add(mergeParts(fur), { vertexColors: true, roughness: 0.82, metalness: 0, map: strands, bumpMap: strands, bumpScale: 0.8 });
  add(mergeParts([...eyesP, ...hard]), { vertexColors: true, roughness: 0.22, metalness: 0 });
  add(mergeParts(plant), { vertexColors: true, roughness: 0.46, metalness: 0 });
  add(mergeParts([{ geometry: rockGeo, keepColor: true }]), { vertexColors: true, roughness: 0.86, metalness: 0, map: speck, bumpMap: mossBump, bumpScale: 0.9 });
  return root;
}

// The positions and normals of a sculpt, for scattering on, before anything has been done to it.
function polygonizedPlain(sculpt) {
  return polygonize(sculpt, {});
}

// ---------------------------------------------------------------------------------------------
// Blue whale
// ---------------------------------------------------------------------------------------------

// True size, 98ft along Z with the head at +Z; the catalogue's scale of 0.25 brings it down. The whole
// hull is ONE grid, snout to tail stock, and that is the design. A sculpt fine enough for its pleats
// would cost hundreds of thousands of triangles, but pleats run along the body, so columns laid along
// them buy each groove with three columns and a modest number of rows.
//
// There is no separate jaw. Each cross-section is a single closed outline that runs from the top of the
// head to the upper lip, in along the palate almost to the middle, back out along the floor of the
// mouth to the lower lip, then round the throat to the belly. Behind the mouth's corner those same
// columns simply lie on the flank, so the head has no seam on it anywhere.
const WHALE = { PLEATS_PER_SIDE: 36, LEN: 98 };

function blueWhale() {
  const CY = 8.4;
  const rng = seededRandom(7801);
  const zT = [-47.5, -46, -40, -30, -20, -10, 0, 10, 20, 26, 30, 36, 42, 46, 48, 48.75, 49];
  const T = (ys) => hermiteTable(zT, ys, 400);
  const width = T([0.3, 1.25, 1.12, 2.25, 3.9, 5.45, 6.5, 7.1, 7.2, 7.0, 6.82, 6.32, 5.4, 4.15, 2.7, 1.5, 0.03]);
  const topY = T([-0.02, 0.14, 0.44, 1.0, 1.5, 1.9, 2.2, 2.45, 2.6, 2.42, 2.14, 1.74, 1.38, 0.9, 0.44, 0.2, 0.02]);
  const above = (z) => topY(z) * 2.45;
  const botY = T([-0.05, -0.36, -1.3, -3.3, -5.0, -6.3, -7.3, -7.9, -8.15, -8.2, -8.0, -7.2, -5.9, -4.2, -2.8, -1.7, -0.25]);
  const spine = T([7.7, 7.75, 7.8, 7.96, 8.12, 8.28, 8.4, 8.42, 8.4, 8.38, 8.34, 8.3, 8.28, 8.3, 8.33, 8.34, 8.34]);
  const J = (z) => sstep(z, 24, 31);
  const gap = (z) => J(z) * (0.2 + 1.45 * sstep(z, 27, 37) * (1 - 0.56 * sstep(z, 41, 48.6))) * (1 - sstep(z, 48.3, 49));
  const mouthRise = (z) => 0.62 * sstep(z, 25, 38) - 0.62 * sstep(z, 42, 49);

  // The outline's parts, per side: A top to upper lip, B the mouth, C lower lip to the belly.
  const NA = 20; const NB = 10; const NF = 6; const NP = WHALE.PLEATS_PER_SIDE * 3;
  const KB = NA; const KC = NA + NB; const KP = KC + NF; const KMAX = KP + NP;
  const COLS = KMAX * 2;

  const pleatOf = (k) => (k < KP ? -1 : Math.floor((k - KP) / 3));
  const zEnd = (p) => {
    const t = p / (WHALE.PLEATS_PER_SIDE - 1);
    return mix(16, -7, sstep(t, 0, 0.42)) + Math.sin(p * 2.4) * 1.8;
  };
  const zStart = (p) => mix(38, 48.3, sstep(p / (WHALE.PLEATS_PER_SIDE - 1), 0, 0.5));
  const pleatFade = (z, p) => sstep(z, zEnd(p), zEnd(p) + 3.5) * (1 - sstep(z, zStart(p) - 1.2, zStart(p)));

  // One point of the section at station z, column k along the right side, x positive.
  const section = (z, k) => {
    const cy = spine(z);
    const w = width(z);
    const jaw = J(z);
    const g = gap(z);
    const mouth = cy + mouthRise(z);
    const uly = mix(cy + 0.25, mouth + g, jaw);
    const lly = mix(cy - 0.25, mouth, jaw);
    const ulx = w * (1 - 0.09 * jaw);
    const llx = w;
    const top = cy + above(z);
    const bot = cy + botY(z);
    if (k <= KB) {
      const s = k / KB;
      const a = (s * Math.PI) / 2;
      // Flat across the head, rounder behind it.
      const px = mix(1, 0.72, jaw); const py = mix(1, 0.5, jaw);
      let x = ulx * Math.sin(a) ** px;
      let y = uly + Math.max(0.05, top - uly) * Math.cos(a) ** py;
      // The median ridge running up the head, and the splashguard rising in front of the blowholes.
      const ridge = 0.32 * sstep(z, 28, 33) * (1 - sstep(z, 44, 48.5)) + 1.0 * Math.exp(-(((z - 29) / 1.9) ** 2));
      y += ridge * Math.exp(-((x / 1.05) ** 2));
      if (k === 0) x = 0;
      return [x, y];
    }
    if (k < KC) {
      const t = (k - KB) / NB;
      // Behind the corner of the mouth these columns lie on the flank; ahead of it they dive inward.
      const flank = [w * Math.cos(((1 - 2 * t) * 0.04)), mix(uly, lly, t)];
      const inX = Math.max(0.3, ulx * 0.2);
      const inY = mix(uly, lly, 0.45);
      let inner;
      if (t < 0.5) {
        const q = t * 2;
        inner = [mix(ulx - 0.12, inX, q ** 0.8), mix(uly, inY, q ** 1.6) + 0.32 * Math.sin(Math.PI * q) * sstep(g, 0.2, 1.4)];
      } else {
        const q = (t - 0.5) * 2;
        inner = [mix(inX, llx - 0.45, q ** 1.4), mix(inY, lly - 0.18, q ** 0.7) - 0.35 * Math.sin(Math.PI * q) * sstep(g, 0.2, 1.4)];
      }
      const m = sstep(z, 25.2, 26.6);
      return [mix(flank[0], inner[0], m), mix(flank[1], inner[1], m)];
    }
    const s = (k - KC) / (KMAX - KC);
    const a = (s * Math.PI) / 2;
    let x = llx * Math.cos(a) ** mix(0.95, 0.85, jaw);
    let y = lly - (lly - bot) * Math.sin(a);
    if (k === KMAX) x = 0;
    const p = pleatOf(k);
    if (p >= 0 && p < WHALE.PLEATS_PER_SIDE) {
      const ph = (k - KP) % 3;
      const f = pleatFade(z, p);
      const d = (ph === 1 ? -0.24 : 0.03) * f;
      const nx = x; const ny = y - (cy - 0.4);
      const l = Math.hypot(nx, ny) || 1;
      x += (nx / l) * d; y += (ny / l) * d;
    }
    return [x, y];
  };

  const ROWS = 72;
  const zAt = (v) => {
    // Rows bunch toward the head, where the outline is doing something, and close on a round snout.
    if (v < 0.3) return mix(-47.5, -8, v / 0.3);
    if (v < 0.52) return mix(-8, 25, (v - 0.3) / 0.22);
    const t = (v - 0.52) / 0.48;
    return mix(25, 49, 1 - (1 - t) ** 1.7);
  };
  const hull = loftGrid(ROWS, COLS, (v, u) => {
    const z = zAt(v);
    const j = Math.round(u * COLS) % COLS;
    const right = j <= KMAX;
    const k = right ? j : COLS - j;
    const [x, y] = section(z, k);
    const pole = v <= 1e-6 || v >= 1 - 1e-6;
    return pole ? [0, spine(z), z] : [right ? x : -x, y, z];
  }, {
    uv: (v, u) => {
      const j = Math.round(u * COLS) % COLS;
      const k = j <= KMAX ? j : COLS - j;
      return [k <= KB ? (k / KB) * 0.5 : k < KC ? 0.5 : 0.5 + ((k - KC) / (KMAX - KC)) * 0.5, v * 3.9];
    },
  });

  // The colour: dark blue-grey above, paling below, grooves dark, mouth darker still.
  const BACK = lin(0x5a82a8); const SIDE = lin(0x7f9fbd); const BELLY = lin(0xb4c6cf); const SULPHUR = lin(0xc4c6a4);
  const MOUTH_D = lin(0x2c1a1c); const MOUTH_F = lin(0x74454c); const LIP = lin(0x2c4058);
  const w1 = COLS + 1;
  tintVertices(hull, (x, y, z, out, i) => {
    const j = i % w1;
    const jm = j % COLS;
    const k = jm <= KMAX ? jm : COLS - jm;
    const cy = spine(z);
    const h = (y - cy) / Math.max(1, above(z) - botY(z));
    const t = sstep(-h, -0.12, 0.4);
    let r = mix(mix(BACK[0], SIDE[0], sstep(-h, -0.4, -0.05)), BELLY[0], t);
    let g = mix(mix(BACK[1], SIDE[1], sstep(-h, -0.4, -0.05)), BELLY[1], t);
    let b = mix(mix(BACK[2], SIDE[2], sstep(-h, -0.4, -0.05)), BELLY[2], t);
    // A sulphur tint on the throat, from the film of diatoms that gave the species its old name.
    const su = 0.45 * sstep(-h, 0.32, 0.5) * sstep(smoothNoise3(x * 0.2, y * 0.2, z * 0.2), 0.35, 0.65);
    r = mix(r, SULPHUR[0], su); g = mix(g, SULPHUR[1], su); b = mix(b, SULPHUR[2], su);
    const p = pleatOf(k);
    if (p >= 0 && p < WHALE.PLEATS_PER_SIDE && (k - KP) % 3 === 1) {
      const f = 1 - 0.36 * pleatFade(z, p);
      r *= f; g *= f; b *= f;
    }
    if (k > KB - 1 && k < KC + 1) {
      const jaw = J(z);
      if (k > KB && k < KC) {
        const tt = (k - KB) / NB;
        const c = tt < 0.5 ? MOUTH_D : MOUTH_F;
        r = mix(r, c[0], jaw); g = mix(g, c[1], jaw); b = mix(b, c[2], jaw);
      } else {
        r = mix(r, LIP[0], jaw * 0.8); g = mix(g, LIP[1], jaw * 0.8); b = mix(b, LIP[2], jaw * 0.8);
      }
    }
    out[0] = r; out[1] = g; out[2] = b;
  });

  // --- The dappling, which is near white and multiplies the colour above -------------------------------
  const dapRng = seededRandom(7802);
  const dapple = canvasTexture(1024, 1024, (ctx, W, H) => {
    ctx.fillStyle = '#f1f1f1';
    ctx.fillRect(0, 0, W, H);
    // Soft-edged blotches: a hard-edged ellipse reads as camouflage paint, and a real whale's mottling
    // has no edge at all. Every blot is a radial fade, drawn at all its wrapped positions so the tile
    // can repeat along the body with no seam.
    const blot = (x, y, rx, ry, rgb, a) => {
      for (const ox of [-W, 0, W]) {
        for (const oy of [-H, 0, H]) {
          if (x + ox + rx < 0 || x + ox - rx > W || y + oy + ry < 0 || y + oy - ry > H) continue;
          ctx.save();
          ctx.translate(x + ox, y + oy);
          ctx.scale(rx, ry);
          const g = ctx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
          g.addColorStop(0, `rgba(${rgb},${a})`);
          g.addColorStop(0.55, `rgba(${rgb},${a * 0.7})`);
          g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    };
    for (let i = 0; i < 650; i++) {
      const r = 18 + dapRng() * 70;
      const dark = dapRng() > 0.45;
      blot(dapRng() * W, dapRng() * H, r * (0.9 + dapRng() * 0.8), r * (0.8 + dapRng() * 0.9), dark ? '104,122,146' : '255,255,255', 0.1 + dapRng() * 0.26);
    }
    for (let i = 0; i < 1700; i++) {
      const r = 3 + dapRng() * 10;
      blot(dapRng() * W, dapRng() * H, r, r * (0.9 + dapRng() * 0.7), dapRng() > 0.5 ? '255,255,255' : '86,106,132', 0.25 + dapRng() * 0.3);
    }
    // A handful of long pale scratches, because an old whale has lived.
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1 + dapRng() * 1.6;
      const x = dapRng() * W; const y = dapRng() * H;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + (dapRng() - 0.5) * 30, y + 30 + dapRng() * 40, x + (dapRng() - 0.5) * 40, y + 70 + dapRng() * 70); ctx.stroke();
    }
  });
  dapple.wrapS = THREE.RepeatWrapping;
  dapple.wrapT = THREE.RepeatWrapping;

  // --- Baleen: a representative row each side, hanging from the palate into the gap ----------------------
  const baleen = [];
  const PLATE_DARK = lin(0x151318); const FRINGE = lin(0x4a443e);
  for (const side of [1, -1]) {
    for (let z = 27.2; z < 47.6; z += 0.31) {
      const g = gap(z);
      if (g < 0.3) continue;
      const cy = spine(z);
      const mouth = cy + mouthRise(z);
      const uly = mouth + g;
      const ulx = width(z) * 0.91;
      const topAt = uly + 0.16;
      const low = mouth + 0.02;
      const plate = new THREE.BoxGeometry(1, 1, 1, 1, 2, 1);
      const P = plate.attributes.position;
      const tilt = (rng() - 0.5) * 0.06;
      for (let i = 0; i < P.count; i++) {
        const py = P.getY(i) + 0.5; // 0 at the bottom of the plate, 1 at the top
        const depth = mix(0.62, 1.15, py);
        const px = ulx - 0.3 - (P.getX(i) + 0.5) * depth;
        const py2 = mix(low, topAt, py) + (P.getX(i) + 0.5) * 0.3 * py;
        P.setXYZ(i, side * px, py2, z + P.getZ(i) * 0.26 + tilt * (1 - py));
      }
      plate.computeVertexNormals();
      const fix = outward(plate);
      tintVertices(fix, (x, y, zz, out) => {
        const t = 1 - sstep(y, low, low + g * 0.2);
        out[0] = mix(PLATE_DARK[0], FRINGE[0], t); out[1] = mix(PLATE_DARK[1], FRINGE[1], t); out[2] = mix(PLATE_DARK[2], FRINGE[2], t);
      });
      baleen.push({ geometry: fix, keepColor: true });
    }
  }

  // --- Fins, closed lens-section solids sunk into the hull ------------------------------------------------
  const fins = [];
  // The flipper: long and slim, about an eighth of the body, held out and a little down.
  const FZ = 18.4;
  const flankY = spine(FZ) - 3.9;
  const flankX = (() => { let k = KC; for (; k < KMAX; k++) { if (section(FZ, k)[1] < flankY) break; } return section(FZ, k)[0]; })();
  const flipL = 12.6;
  const flipper = solidSurface({
    nu: 10, nv: 18,
    point: (u, v) => {
      const s = u * 2 - 1; // across the chord
      const reach = v * flipL;
      const chord = 1.42 * (0.62 + 0.38 * sstep(v, 0, 0.18)) * (1 - v ** 3.4) ** 0.7 + 0.04;
      const dx = reach * 0.66;
      const dy = -reach * 0.42;
      const dz = -reach * 0.58 - 0.9 * v * v;
      return [flankX - 1.3 + dx, flankY + dy, FZ + dz + s * chord];
    },
    thick: (u, v) => 0.32 * (1 - (u * 2 - 1) ** 2) ** 0.7 * (1 - v * 0.82),
  });
  flipper.computeVertexNormals();
  const FL_TOP = lin(0x5f81a4); const FL_BOT = lin(0xc4d0d2);
  const nrmF = flipper.attributes.normal;
  tintVertices(flipper, (x, y, z, out, i) => {
    const up = sstep(nrmF.getY(i), -0.2, 0.3);
    out[0] = mix(FL_BOT[0], FL_TOP[0], up); out[1] = mix(FL_BOT[1], FL_TOP[1], up); out[2] = mix(FL_BOT[2], FL_TOP[2], up);
  });
  fins.push({ geometry: flipper, keepColor: true });
  fins.push({ geometry: mirrorX(flipper), keepColor: true });

  // The dorsal fin: famously tiny for the animal, and very far back.
  const DZ_ = -24;
  const dorsalY = (z) => spine(z) + above(z);
  const dorsal = solidSurface({
    nu: 12, nv: 7,
    point: (u, v) => {
      const z = mix(DZ_ + 2.6, DZ_ - 1.6, u);
      const lean = v * v * 1.3;
      const rise = v * (0.5 + 1.25 * Math.sin(Math.PI * Math.min(1, u * 0.98 + 0.02)) ** 0.8) * (1 - 0.1 * u);
      return [0, dorsalY(z) - 0.5 + rise, z - lean];
    },
    thick: (u, v) => 0.24 * Math.sin(Math.PI * clamp01(u)) ** 0.6 * (1 - 0.74 * v) + 0.005,
    axis: [1, 0, 0],
  });
  dorsal.computeVertexNormals();
  fins.push({ geometry: outward(dorsal), color: 0x5f81a4 });

  // The flukes: broad, swept, thin, with a notch at the middle of the trailing edge.
  const SPAN = 12.3; const TAIL_Z = -43.4;
  const flukeHalf = (side) => {
    const g = solidSurface({
      nu: 16, nv: 8,
      point: (u0, v) => {
        // u out along the span, v from the leading edge back to the trailing edge. The chord goes to
        // a small rounded tip, so there is no blunt end, and the notch sits at the middle.
        const u = u0 ** 0.85;
        const x = u * SPAN;
        const chord = 7.0 * (1 - u ** 2.1) ** 0.62 + 0.06;
        const centre = TAIL_Z - 1.2 - 3.6 * u ** 1.6;
        const notch = 1.25 * Math.exp(-((u / 0.07) ** 2));
        const le = centre + chord * 0.5;
        const te = centre - chord * 0.5 + notch;
        return [side * x, spine(TAIL_Z) - 0.08 + 0.55 * u ** 1.4, mix(le, te, v)];
      },
      thick: (u, v) => (0.6 * (1 - u) ** 1.5 + 0.04) * Math.sin(Math.PI * clamp01(v * 0.97 + 0.015)) ** 0.62,
      axis: [0, 1, 0],
    });
    g.computeVertexNormals();
    return outward(g);
  };
  const FLUKE = lin(0x5b7ea2); const FLUKE_U = lin(0x8fa6b6);
  for (const side of [1, -1]) {
    const f = flukeHalf(side);
    const nf = f.attributes.normal;
    tintVertices(f, (x, y, z, out, i) => {
      const up = sstep(nf.getY(i), -0.3, 0.3);
      out[0] = mix(FLUKE_U[0], FLUKE[0], up); out[1] = mix(FLUKE_U[1], FLUKE[1], up); out[2] = mix(FLUKE_U[2], FLUKE[2], up);
    });
    fins.push({ geometry: f, keepColor: true });
  }

  // --- The small things: blowholes, eyes, the navel ------------------------------------------------------
  const detail = [];
  const topAt = (z, x) => {
    // Find the head's surface at (z, x) by reading the same section the hull was built from.
    let best = 0; let bd = 1e9;
    for (let k = 0; k <= KB; k++) { const q = section(z, k); const d = Math.abs(q[0] - x); if (d < bd) { bd = d; best = k; } }
    return section(z, best)[1];
  };
  // Two long slits side by side behind the splashguard, each inside a raised lip.
  for (const side of [1, -1]) {
    const bx = side * 0.52; const bz = 26.6;
    const by = topAt(bz, Math.abs(bx));
    const lipG = new THREE.SphereGeometry(1, 18, 10).scale(0.34, 0.16, 1.05).rotateY(side * -0.2).translate(bx, by + 0.04, bz);
    detail.push({ geometry: lipG, color: 0x3f6087 });
    const slit = new THREE.SphereGeometry(1, 14, 8).scale(0.13, 0.08, 0.86).rotateY(side * -0.2).translate(bx, by + 0.17, bz);
    detail.push({ geometry: slit, color: 0x0c0f14 });
  }
  // The eye: very small for such a head, just above the corner of the mouth, under a heavy lid.
  const EZ = 25.2;
  const eyeY = spine(EZ) + 0.95;
  const eyeX = (() => { for (let k = KB; k >= 0; k--) { const q = section(EZ, k); if (q[1] >= eyeY) return q[0]; } return width(EZ); })();
  const eyeC = [eyeX - 0.08, eyeY, EZ];
  // A low mound round it, skin-coloured, and a small dark eye half sunk in the mound with one glint.
  const mound = new THREE.SphereGeometry(1, 20, 14).scale(0.36, 0.72, 1.0).translate(eyeC[0] - 0.12, eyeC[1], eyeC[2]);
  const EYE_G = new THREE.SphereGeometry(0.32, 18, 14).translate(eyeC[0] - 0.06, eyeC[1], eyeC[2]);
  const GLINT = new THREE.SphereGeometry(0.05, 8, 6).translate(eyeC[0] + 0.23, eyeC[1] + 0.09, eyeC[2] + 0.06);
  for (const [g, c] of [[mound, 0x5e7f9f], [EYE_G, 0x120d0c], [GLINT, 0xd8dcdc]]) {
    detail.push({ geometry: g, color: c });
    detail.push({ geometry: mirrorX(g), color: c });
  }
  // The navel, where the pleats end, because a mammal has one.
  const NAVZ = -8.5;
  detail.push({ geometry: new THREE.SphereGeometry(0.34, 12, 8).scale(1, 0.4, 1.3).translate(0, spine(NAVZ) + botY(NAVZ) + 0.05, NAVZ), color: 0x76909f });

  const root = new THREE.Group();
  root.name = 'blue-whale';
  const meshes = [
    mesh(mergeParts([{ geometry: hull, keepColor: true }, ...fins]), standard({ vertexColors: true, roughness: 0.52, metalness: 0, map: dapple })),
    mesh(mergeParts(baleen), standard({ vertexColors: true, roughness: 0.62, metalness: 0 })),
    mesh(mergeParts(detail), standard({ vertexColors: true, roughness: 0.3, metalness: 0 })),
  ];
  // Rest the lowest point on the ground; the catalogue's hover then lifts the whole animal.
  let lowest = 1e9;
  for (const m of meshes) { m.geometry.computeBoundingBox(); lowest = Math.min(lowest, m.geometry.boundingBox.min.y); }
  for (const m of meshes) { m.geometry.translate(0, -lowest, 0); root.add(m); }
  return root;
}

const mix3 = (a, b, t) => [mix(a[0], b[0], clamp01(t)), mix(a[1], b[1], clamp01(t)), mix(a[2], b[2], clamp01(t))];

export const BUILDERS = {
  neuron,
  'human-kidney': humanKidney,
  'arm-muscles': armMuscles,
  'venus-flytrap': venusFlytrap,
  'giant-panda': giantPanda,
  'blue-whale': blueWhale,
};
