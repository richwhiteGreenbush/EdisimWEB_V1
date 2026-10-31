// Builders for the Model Database's Life entries: the heart, lungs, brain, skeleton, honey bee
// and leopard frog. A student walks right up to these, so every join shows.
//
// THE ONE IDEA IN THIS FILE: AN ORGAN IS ONE SURFACE, SO IT IS SCULPTED AS A FIELD.
//
// Everything organic here starts as a signed distance field: a list of solids combined with a
// smooth union, then polygonised by surface nets. Three things that were each a fight when these
// were tubes laid against balls become true by construction:
//
//  * NOTHING CAN FLOAT AND NOTHING CAN BE OPEN. A vessel unioned into the field grows out of the
//    wall it joins with a real fillet, and the isosurface of a field is closed wherever the field
//    is defined. Fantastic Voyage's heart is tubes stuck on balls and partly inside out; this
//    cannot be either, since the winding comes from which side of the surface is negative.
//  * COLOUR CHANGES WHERE THE SOLIDS MEET. Each solid carries a colour and the union blends it, so
//    the red and the blue of the two ventricles meet in the groove between them.
//  * A GROOVE IS A SUBTRACTION FROM THE SAME SURFACE (a fissure, a sulcus, a mouth, a cut lumen),
//    not a separate solid laid on top.
//
// What it costs is triangles per square foot, whatever the shape: a 1in tube costs far more than
// an analytic one. So anything thin and many (rib shafts, finger bones, the bronchial tree, hairs)
// is an analytic closed tube, and the field is kept for what is read as a surface.
//
// `tube` here is this file's own, since LoftKit.tube() is wound inward and has open ends. It is
// closed at both ends by construction, with rounded rows in place of a cap ball.

import * as THREE from 'three';
import { mergeParts, smoothNoise3, splineAt, revolve, solidSurface } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';

// ---------------------------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------------------------
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixInto = (out, c, t) => { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; };

function eulerInverse(rot) {
  if (!rot) return null;
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  const e = m.elements;
  // The transpose of the rotation, read as world to local.
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
}

// ---------------------------------------------------------------------------------------------
// Solids for the field. Each is { f(x,y,z) -> distance, box: [x0,y0,z0,x1,y1,z1] }.
// ---------------------------------------------------------------------------------------------
function sphereP(c, r) {
  const [cx, cy, cz] = c;
  return { f: (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r, box: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r] };
}

// Inigo Quilez's bound for an ellipsoid: not exact, but first-order right near the surface, which
// is the only place it is asked.
function ellipsoidP(c, radii, rot = null) {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = radii;
  const R = eulerInverse(rot);
  const big = Math.max(rx, ry, rz);
  const box = rot
    ? [cx - big, cy - big, cz - big, cx + big, cy + big, cz + big]
    : [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz];
  const small = Math.min(rx, ry, rz);
  return {
    box,
    f: (x, y, z) => {
      let px = x - cx; let py = y - cy; let pz = z - cz;
      if (R) {
        const qx = R[0] * px + R[1] * py + R[2] * pz;
        const qy = R[3] * px + R[4] * py + R[5] * pz;
        const qz = R[6] * px + R[7] * py + R[8] * pz;
        px = qx; py = qy; pz = qz;
      }
      const ax = px / rx; const ay = py / ry; const az = pz / rz;
      const k0 = Math.hypot(ax, ay, az);
      if (k0 < 1e-6) return -small;
      const k1 = Math.hypot(ax / rx, ay / ry, az / rz);
      return (k0 * (k0 - 1)) / k1;
    },
  };
}

// A chain of round cones through sampled points. The workhorse: every vessel, limb and ridge.
function segsP(points, radii) {
  const n = points.length - 1;
  const data = new Float64Array(n * 8);
  let x0 = 1e9; let y0 = 1e9; let z0 = 1e9; let x1 = -1e9; let y1 = -1e9; let z1 = -1e9;
  for (let i = 0; i <= n; i++) {
    const p = points[i]; const r = radii[i];
    x0 = Math.min(x0, p[0] - r); y0 = Math.min(y0, p[1] - r); z0 = Math.min(z0, p[2] - r);
    x1 = Math.max(x1, p[0] + r); y1 = Math.max(y1, p[1] + r); z1 = Math.max(z1, p[2] + r);
    if (i < n) {
      const q = points[i + 1];
      data[i * 8] = p[0]; data[i * 8 + 1] = p[1]; data[i * 8 + 2] = p[2];
      data[i * 8 + 3] = q[0] - p[0]; data[i * 8 + 4] = q[1] - p[1]; data[i * 8 + 5] = q[2] - p[2];
      data[i * 8 + 6] = r; data[i * 8 + 7] = radii[i + 1];
    }
  }
  return {
    box: [x0, y0, z0, x1, y1, z1],
    f: (x, y, z) => {
      let best = 1e9;
      for (let i = 0, o = 0; i < n; i++, o += 8) {
        const ax = x - data[o]; const ay = y - data[o + 1]; const az = z - data[o + 2];
        const bx = data[o + 3]; const by = data[o + 4]; const bz = data[o + 5];
        const bb = bx * bx + by * by + bz * bz;
        let t = bb > 0 ? (ax * bx + ay * by + az * bz) / bb : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = ax - bx * t; const dy = ay - by * t; const dz = az - bz * t;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - (data[o + 6] + (data[o + 7] - data[o + 6]) * t);
        if (d < best) best = d;
      }
      return best;
    },
  };
}

// Samples a Catmull-Rom through points, with the radii splined on the same knots.
function sampleCurve(points, radii, n) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const P = []; const R = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const v = curve.getPoint(t);
    P.push([v.x, v.y, v.z]);
    R.push(Array.isArray(radii) ? Math.max(0.002, splineAt(radii, t)) : radii);
  }
  return { P, R };
}
function curveP(points, radii, n = null) {
  const { P, R } = sampleCurve(points, radii, n ?? Math.max(6, (points.length - 1) * 5));
  return segsP(P, R);
}

function boxP(c, half, rot = null, round = 0) {
  const [cx, cy, cz] = c;
  const [hx, hy, hz] = half;
  const R = eulerInverse(rot);
  const reach = Math.hypot(hx, hy, hz) + round;
  return {
    box: [cx - reach, cy - reach, cz - reach, cx + reach, cy + reach, cz + reach],
    f: (x, y, z) => {
      let px = x - cx; let py = y - cy; let pz = z - cz;
      if (R) {
        const qx = R[0] * px + R[1] * py + R[2] * pz;
        const qy = R[3] * px + R[4] * py + R[5] * pz;
        const qz = R[6] * px + R[7] * py + R[8] * pz;
        px = qx; py = qy; pz = qz;
      }
      const dx = Math.abs(px) - hx; const dy = Math.abs(py) - hy; const dz = Math.abs(pz) - hz;
      const ox = Math.max(dx, 0); const oy = Math.max(dy, 0); const oz = Math.max(dz, 0);
      return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(dx, dy, dz), 0) - round;
    },
  };
}

// A ring round `axis`.
function torusP(c, axis, R, r) {
  const a = new THREE.Vector3(...axis).normalize();
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

// ---------------------------------------------------------------------------------------------
// The sculpt: an ordered list of smooth unions and subtractions, polygonised by surface nets
// ---------------------------------------------------------------------------------------------
class Sculpt {
  constructor(cell) {
    this.cell = cell;
    this.ops = [];
  }

  _box(box, k) {
    const m = k + this.cell * 3;
    return [box[0] - m, box[1] - m, box[2] - m, box[3] + m, box[4] + m, box[5] + m];
  }

  // `k` is the fillet between this solid and what is already there. `ck` is how quickly the colour
  // changes across that fillet, which is usually sharper than the shape.
  add(prim, color, { k = 0, ck = null, paint = null } = {}) {
    this.ops.push({ kind: 0, f: prim.f, box: this._box(prim.box, k), raw: prim.box, k, ck: ck ?? Math.max(k, this.cell * 0.7), color: Array.isArray(color) ? color : lin(color), paint });
    return this;
  }

  sub(prim, color = null, { k = 0, ck = null } = {}) {
    this.ops.push({ kind: 1, f: prim.f, box: this._box(prim.box, k), raw: null, k, ck: ck ?? Math.max(k, this.cell * 0.7), color: color === null ? null : (Array.isArray(color) ? color : lin(color)) });
    return this;
  }

  // Rewrites the distance so far: a fissure limited to a depth, a sulcus field, a surface warp.
  // Lipschitz is the caller's problem, and a warp's amplitude has to stay small against the radius.
  map(fn, box = [-1e6, -1e6, -1e6, 1e6, 1e6, 1e6]) {
    this.ops.push({ kind: 2, map: fn, box, raw: null });
    return this;
  }

  // The field made of only the solids added so far, for asking "where is the surface" before the
  // things that lie on it exist.
  snapshot() {
    const everywhere = [-1e6, -1e6, -1e6, 1e6, 1e6, 1e6];
    return { ops: this.ops.map((op) => (op.kind === 2 ? op : { ...op, box: everywhere })), cell: this.cell, d: fieldOf };
  }

}

function fieldOf(x, y, z) { return fieldD(this.ops, x, y, z); }

function fieldD(ops, x, y, z) {
  let d = 1e9;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const b = op.box;
    if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue;
    if (op.kind === 2) { if (d < 1e8) d = op.map(d, x, y, z); continue; }
    const v = op.f(x, y, z);
    const k = op.k;
    if (op.kind === 0) {
      if (k > 0) {
        const h = Math.max(k - Math.abs(d - v), 0) / k;
        d = (d < v ? d : v) - h * h * k * 0.25;
      } else if (v < d) d = v;
    } else {
      const c = -v;
      if (k > 0) {
        const h = Math.max(k - Math.abs(d - c), 0) / k;
        d = (d > c ? d : c) + h * h * k * 0.25;
      } else if (c > d) d = c;
    }
  }
  return d;
}

// The same walk, carrying colour.
function fieldColor(ops, x, y, z, out) {
  let d = 1e9;
  out[0] = 0.5; out[1] = 0.5; out[2] = 0.5;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const b = op.box;
    if (x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]) continue;
    if (op.kind === 2) { if (d < 1e8) d = op.map(d, x, y, z); continue; }
    const v = op.f(x, y, z);
    const k = op.k;
    if (op.kind === 0) {
      const col = op.paint ? op.paint(x, y, z) : op.color;
      if (d >= 1e8) { out[0] = col[0]; out[1] = col[1]; out[2] = col[2]; } else {
        mixInto(out, col, clamp01(0.5 + (0.5 * (d - v)) / op.ck));
      }
      if (k > 0) {
        const h = Math.max(k - Math.abs(d - v), 0) / k;
        d = (d < v ? d : v) - h * h * k * 0.25;
      } else if (v < d) d = v;
    } else {
      const c = -v;
      if (op.color) mixInto(out, op.color, clamp01(0.5 + (0.5 * (c - d)) / op.ck));
      if (k > 0) {
        const h = Math.max(k - Math.abs(d - c), 0) / k;
        d = (d > c ? d : c) + h * h * k * 0.25;
      } else if (c > d) d = c;
    }
  }
  return d;
}

// Walks a point onto a field's surface and lifts it, the "ask the surface where it is" rule.
function onSurface(field, p, lift = 0, iterations = 12) {
  let [x, y, z] = p;
  const h = 0.01;
  for (let i = 0; i < iterations; i++) {
    const d = field.d(x, y, z) - lift;
    const gx = field.d(x + h, y, z) - field.d(x - h, y, z);
    const gy = field.d(x, y + h, z) - field.d(x, y - h, z);
    const gz = field.d(x, y, z + h) - field.d(x, y, z - h);
    const len = Math.hypot(gx, gy, gz) || 1;
    const nx = gx / len; const ny = gy / len; const nz = gz / len;
    x -= nx * d; y -= ny * d; z -= nz * d;
    if (Math.abs(d) < 1e-4) break;
  }
  return [x, y, z];
}

function fieldNormal(field, p) {
  const h = 0.01;
  const [x, y, z] = p;
  const gx = field.d(x + h, y, z) - field.d(x - h, y, z);
  const gy = field.d(x, y + h, z) - field.d(x, y - h, z);
  const gz = field.d(x, y, z + h) - field.d(x, y, z - h);
  const len = Math.hypot(gx, gy, gz) || 1;
  return [gx / len, gy / len, gz / len];
}

// A smooth path lying on a surface: the control points are projected, then the sampled curve is
// projected again, since a spline between two points on a curved surface cuts through it.
function pathOn(field, points, n = 24, lift = 0) {
  const projected = points.map((p) => onSurface(field, p, lift));
  const { P } = sampleCurve(projected, 1, n);
  return P.map((p) => onSurface(field, p, lift, 6));
}

// Surface nets over a sparse grid. Blocks of eight cells that are far from the surface are never
// evaluated, so the cost goes with the area of the surface rather than the volume of its box.
function polygonize(sculpt, { tint = null, uvScale = 1, bounds = null, normalH = 0.6, extraReach = 0, snap = null } = {}) {
  const { cell, ops } = sculpt;
  let x0 = 1e9; let y0 = 1e9; let z0 = 1e9; let x1 = -1e9; let y1 = -1e9; let z1 = -1e9;
  for (const op of ops) {
    if (!op.raw) continue;
    x0 = Math.min(x0, op.raw[0]); y0 = Math.min(y0, op.raw[1]); z0 = Math.min(z0, op.raw[2]);
    x1 = Math.max(x1, op.raw[3]); y1 = Math.max(y1, op.raw[4]); z1 = Math.max(z1, op.raw[5]);
  }
  if (bounds) { [x0, y0, z0, x1, y1, z1] = bounds; }
  const pad = cell * 2.5;
  x0 -= pad; y0 -= pad; z0 -= pad;
  const BLOCK = 8;
  const nx = Math.ceil((x1 + pad - x0) / cell / BLOCK) * BLOCK;
  const ny = Math.ceil((y1 + pad - y0) / cell / BLOCK) * BLOCK;
  const nz = Math.ceil((z1 + pad - z0) / cell / BLOCK) * BLOCK;
  const vx = nx + 1; const vy = ny + 1; const vz = nz + 1;
  const stride = vx * vy;
  const vals = new Float32Array(vx * vy * vz).fill(NaN);
  const cellVert = new Int32Array(vx * vy * vz).fill(-1);
  const bx = nx / BLOCK; const by = ny / BLOCK; const bz = nz / BLOCK;
  const state = new Uint8Array(bx * by * bz); // 0 untouched, 1 evaluated
  const positions = [];
  const cells = [];

  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const corner = new Float64Array(8);

  const stack = [];
  const process = (ib, jb, kb) => {
    const bi = ib + jb * bx + kb * bx * by;
    if (state[bi]) return;
    state[bi] = 1;
    const ax = x0 + ib * BLOCK * cell; const ay = y0 + jb * BLOCK * cell; const az = z0 + kb * BLOCK * cell;
    const wide = BLOCK * cell;
    const active = [];
    for (const op of ops) {
      const b = op.box;
      if (ax > b[3] || ax + wide < b[0] || ay > b[4] || ay + wide < b[1] || az > b[5] || az + wide < b[2]) continue;
      active.push(op);
    }
    if (!active.length) return;
    for (let k = 0; k <= BLOCK; k++) {
      const gz = kb * BLOCK + k;
      for (let j = 0; j <= BLOCK; j++) {
        const gy = jb * BLOCK + j;
        for (let i = 0; i <= BLOCK; i++) {
          const gx = ib * BLOCK + i;
          const at = gx + gy * vx + gz * stride;
          if (Number.isNaN(vals[at])) vals[at] = fieldD(active, x0 + gx * cell, y0 + gy * cell, z0 + gz * cell);
        }
      }
    }
    for (let k = 0; k < BLOCK; k++) {
      const gz = kb * BLOCK + k;
      for (let j = 0; j < BLOCK; j++) {
        const gy = jb * BLOCK + j;
        for (let i = 0; i < BLOCK; i++) {
          const gx = ib * BLOCK + i;
          const at = gx + gy * vx + gz * stride;
          let mask = 0;
          for (let c = 0; c < 8; c++) {
            const v = vals[at + (c & 1) + ((c >> 1) & 1) * vx + ((c >> 2) & 1) * stride];
            corner[c] = v;
            if (v < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 255) continue;
          let sx = 0; let sy = 0; let sz = 0; let count = 0;
          for (const [a, b] of edges) {
            const va = corner[a]; const vb = corner[b];
            if ((va < 0) === (vb < 0)) continue;
            const t = va / (va - vb);
            sx += (a & 1) + (((b & 1) - (a & 1)) * t);
            sy += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
            sz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
            count += 1;
          }
          cellVert[at] = positions.length / 3;
          cells.push(at);
          positions.push(x0 + (gx + sx / count) * cell, y0 + (gy + sy / count) * cell, z0 + (gz + sz / count) * cell);
          // A surface reaching the block's edge means the neighbour has to be evaluated too,
          // even if its centre looked far from everything.
          if (i === 0 || j === 0 || k === 0 || i === BLOCK - 1 || j === BLOCK - 1 || k === BLOCK - 1) {
            for (let dk = k === 0 ? -1 : 0; dk <= (k === BLOCK - 1 ? 1 : 0); dk++) {
              for (let dj = j === 0 ? -1 : 0; dj <= (j === BLOCK - 1 ? 1 : 0); dj++) {
                for (let di = i === 0 ? -1 : 0; di <= (i === BLOCK - 1 ? 1 : 0); di++) {
                  if (!di && !dj && !dk) continue;
                  const ni = ib + di; const nj = jb + dj; const nk = kb + dk;
                  if (ni < 0 || nj < 0 || nk < 0 || ni >= bx || nj >= by || nk >= bz) continue;
                  if (!state[ni + nj * bx + nk * bx * by]) stack.push(ni, nj, nk);
                }
              }
            }
          }
        }
      }
    }
  };

  const half = (BLOCK * cell) / 2;
  const reach = Math.sqrt(3) * half * 1.35 + extraReach;
  for (let kb = 0; kb < bz; kb++) {
    for (let jb = 0; jb < by; jb++) {
      for (let ib = 0; ib < bx; ib++) {
        const cx = x0 + (ib + 0.5) * BLOCK * cell; const cy = y0 + (jb + 0.5) * BLOCK * cell; const cz = z0 + (kb + 0.5) * BLOCK * cell;
        const d = fieldD(ops, cx, cy, cz);
        if (Math.abs(d) > reach) continue;
        process(ib, jb, kb);
        while (stack.length) { const c = stack.pop(); const b = stack.pop(); const a = stack.pop(); process(a, b, c); }
      }
    }
  }

  // Quads, wound from which side of each crossing edge is inside.
  const quads = [];
  const pushQuad = (a, b, c, e, flip) => {
    if (a < 0 || b < 0 || c < 0 || e < 0) return;
    if (flip) quads.push(e, c, b, a); else quads.push(a, b, c, e);
  };
  for (const at of cells) {
    const inside = vals[at] < 0;
    const gx = at % vx; const gy = Math.floor(at / vx) % vy; const gz = Math.floor(at / stride);
    if (gy > 0 && gz > 0 && (vals[at + 1] < 0) !== inside) {
      pushQuad(cellVert[at - vx - stride], cellVert[at - stride], cellVert[at], cellVert[at - vx], !inside);
    }
    if (gz > 0 && gx > 0 && (vals[at + vx] < 0) !== inside) {
      pushQuad(cellVert[at - stride - 1], cellVert[at - 1], cellVert[at], cellVert[at - stride], !inside);
    }
    if (gx > 0 && gy > 0 && (vals[at + stride] < 0) !== inside) {
      pushQuad(cellVert[at - 1 - vx], cellVert[at - vx], cellVert[at], cellVert[at - 1], !inside);
    }
  }

  // Each vertex is walked onto the true surface, so the grid does not show in the silhouette,
  // and takes its normal from the field, so it does not show in the shading either.
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const h = cell * 0.35;
  const hn = cell * normalH;
  const limit = cell * 0.6;
  const rgb = [0, 0, 0];
  const f = (x, y, z) => fieldD(ops, x, y, z);
  for (let i = 0; i < count; i++) {
    let x = positions[i * 3]; let y = positions[i * 3 + 1]; let z = positions[i * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = f(x, y, z);
      const k1 = f(x + h, y - h, z - h); const k2 = f(x - h, y - h, z + h);
      const k3 = f(x - h, y + h, z - h); const k4 = f(x + h, y + h, z + h);
      const gx = k1 - k2 - k3 + k4; const gy = -k1 - k2 + k3 + k4; const gz = -k1 + k2 - k3 + k4;
      const len = Math.hypot(gx, gy, gz) || 1;
      // Divided by the true slope, since a sharp warp leaves the field steeper than a distance.
      let step = d / Math.max(0.5, len / (4 * h));
      if (step > limit) step = limit; else if (step < -limit) step = -limit;
      x -= (gx / len) * step; y -= (gy / len) * step; z -= (gz / len) * step;
    }
    // A painted edge is only as crisp as the mesh under it, so a vertex close to one is slid along
    // the surface onto it. The paint's outline then runs along a line of mesh edges and comes out
    // a clean curve, at the same triangle count that drew it as a staircase.
    if (snap) {
      const s0 = snap(x, y, z);
      if (Math.abs(s0) < cell * 0.62) {
        const e = 0.008;
        const sx = (snap(x + e, y, z) - s0) / e; const sy = (snap(x, y + e, z) - s0) / e; const sz = (snap(x, y, z + e) - s0) / e;
        const s2 = sx * sx + sy * sy + sz * sz;
        if (s2 > 1e-3) {
          x -= (sx * s0) / s2; y -= (sy * s0) / s2; z -= (sz * s0) / s2;
          for (let it = 0; it < 2; it++) {
            const d = f(x, y, z);
            const a1 = f(x + h, y - h, z - h); const a2 = f(x - h, y - h, z + h);
            const a3 = f(x - h, y + h, z - h); const a4 = f(x + h, y + h, z + h);
            const gx = a1 - a2 - a3 + a4; const gy = -a1 - a2 + a3 + a4; const gz = -a1 + a2 - a3 + a4;
            const len = Math.hypot(gx, gy, gz) || 1;
            let step = d / Math.max(0.5, len / (4 * h));
            if (step > limit) step = limit; else if (step < -limit) step = -limit;
            x -= (gx / len) * step; y -= (gy / len) * step; z -= (gz / len) * step;
          }
        }
      }
    }
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    const k1 = f(x + hn, y - hn, z - hn); const k2 = f(x - hn, y - hn, z + hn);
    const k3 = f(x - hn, y + hn, z - hn); const k4 = f(x + hn, y + hn, z + hn);
    const gx = k1 - k2 - k3 + k4; const gy = -k1 - k2 + k3 + k4; const gz = -k1 + k2 - k3 + k4;
    const len = Math.hypot(gx, gy, gz) || 1;
    const nnx = gx / len; const nny = gy / len; const nnz = gz / len;
    normals[i * 3] = nnx; normals[i * 3 + 1] = nny; normals[i * 3 + 2] = nnz;
    fieldColor(ops, x, y, z, rgb);
    if (tint) tint(x, y, z, nnx, nny, nnz, rgb);
    colors[i * 3] = rgb[0]; colors[i * 3 + 1] = rgb[1]; colors[i * 3 + 2] = rgb[2];
    // A skew projection has no seams at all, which is what a fine bump map on a field needs.
    uvs[i * 2] = (x + z * 0.62) * uvScale;
    uvs[i * 2 + 1] = (y + z * 0.37) * uvScale;
  }

  // Each quad is split along its shorter diagonal, which keeps a crease from sawing.
  const index = [];
  const P = positions;
  const dist2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q]; const b = quads[q + 1]; const c = quads[q + 2]; const e = quads[q + 3];
    if (dist2(a, c) <= dist2(b, e)) index.push(a, b, c, a, c, e);
    else index.push(a, b, e, b, c, e);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

// ---------------------------------------------------------------------------------------------
// Analytic closed solids, for what is thin and many
// ---------------------------------------------------------------------------------------------

// A swept tube closed at both ends by construction. Wound outward, parallel transported. `round`
// says how many rows a hemispherical end gets (0 closes it flat); a radius of 0 closes to a point.
// `section(t)` returns [along-normal, along-binormal] multipliers, and `frame(t, p)` the direction
// the normal should hold, which a flat bone needs.
function tube(points, radii, {
  sides = 8, steps = null, round = 2, section = null, frame = null, straight = false,
} = {}) {
  const n = steps ?? Math.max(4, (points.length - 1) * 4);
  let sample;
  if (straight && points.length === 2) {
    sample = (t) => new THREE.Vector3(mix(points[0][0], points[1][0], t), mix(points[0][1], points[1][1], t), mix(points[0][2], points[1][2], t));
  } else {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
    sample = (t) => curve.getPoint(t);
  }
  const radius = (t) => (Array.isArray(radii) ? Math.max(0, splineAt(radii, t)) : radii);
  const ringsData = [];
  const C = [];
  for (let i = 0; i <= n; i++) C.push(sample(i / n));
  const tangents = C.map((p, i) => C[Math.min(n, i + 1)].clone().sub(C[Math.max(0, i - 1)]).normalize());
  let N = Math.abs(tangents[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const B = new THREE.Vector3();
  const frames = [];
  for (let i = 0; i <= n; i++) {
    const T = tangents[i];
    let ref = N;
    if (frame) { const w = frame(i / n, C[i]); ref = new THREE.Vector3(w[0], w[1], w[2]); }
    N = ref.clone().addScaledVector(T, -ref.dot(T));
    if (N.lengthSq() < 1e-8) N = new THREE.Vector3(T.y, T.z, T.x);
    N.normalize();
    B.crossVectors(T, N).normalize();
    frames.push({ c: C[i], T, N: N.clone(), B: B.clone(), r: radius(i / n), s: section ? section(i / n) : [1, 1] });
  }
  // Rows of the rounded ends, in order along the tube.
  const first = frames[0];
  if (first.r > 1e-3) {
    for (let a = 1; a <= round; a++) {
      const phi = ((round + 1 - a) / (round + 1)) * (Math.PI / 2);
      ringsData.push({ ...first, c: first.c.clone().addScaledVector(first.T, -Math.sin(phi) * first.r * first.s[0]), r: first.r * Math.cos(phi) });
    }
  }
  ringsData.push(...frames);
  const last = frames[n];
  if (last.r > 1e-3) {
    for (let a = 1; a <= round; a++) {
      const phi = (a / (round + 1)) * (Math.PI / 2);
      ringsData.push({ ...last, c: last.c.clone().addScaledVector(last.T, Math.sin(phi) * last.r * last.s[0]), r: last.r * Math.cos(phi) });
    }
  }
  const positions = [];
  const index = [];
  for (const ring of ringsData) {
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ca = Math.cos(a) * ring.r * ring.s[0];
      const sa = Math.sin(a) * ring.r * ring.s[1];
      positions.push(
        ring.c.x + ring.N.x * ca + ring.B.x * sa,
        ring.c.y + ring.N.y * ca + ring.B.y * sa,
        ring.c.z + ring.N.z * ca + ring.B.z * sa,
      );
    }
  }
  const rows = ringsData.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides;
      const a = i * sides + j; const b = i * sides + j2; const c = (i + 1) * sides + j2; const d = (i + 1) * sides + j;
      index.push(a, b, c, a, c, d);
    }
  }
  // The two poles.
  const startRing = ringsData[0];
  const endRing = ringsData[rows - 1];
  const pole0 = positions.length / 3;
  const s0 = startRing.c.clone().addScaledVector(startRing.T, -(startRing.r > 1e-3 ? startRing.r * 0.3 : 0));
  positions.push(s0.x, s0.y, s0.z);
  const pole1 = positions.length / 3;
  const s1 = endRing.c.clone().addScaledVector(endRing.T, endRing.r > 1e-3 ? endRing.r * 0.3 : 0);
  positions.push(s1.x, s1.y, s1.z);
  for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides;
    index.push(pole0, j2, j);
    index.push(pole1, (rows - 1) * sides + j, (rows - 1) * sides + j2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

// A solid of revolution written the way anybody writes one, from the bottom up, axis to axis.
// `revolve` takes its winding from the profile's direction and a bottom-up one comes out inside
// out, so it is reversed here and nowhere else.
function lathe(profile, segments = 40) {
  return revolve([...profile].reverse(), { segments });
}

// Reflects a geometry across x = 0 and repairs what a reflection breaks: the winding and the x of
// every normal. Two limbs from one sculpt, and two halves that cannot disagree.
function mirrorX(geometry) {
  const g = geometry.clone();
  const p = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    if (nrm) nrm.setX(i, -nrm.getX(i));
  }
  const idx = g.index;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
  return g;
}

const mouthDepth = (r) => r * 1.5;

// The cut end of a vessel. Thin walls alias on a grid, and a cut end is exactly what a student
// looks down, so the mouth is a small lathed sleeve fitted over the vessel's sawn-off end. It is a
// closed solid: wall, rim, then a blind pocket that goes dark toward its floor.
function vesselMouth(parts, p, dir, r, color, lumen, { depth = null, wall = null, length = null, segments = 22 } = {}) {
  const w = wall ?? Math.max(0.05, r * 0.17);
  const D = depth ?? mouthDepth(r);
  // The cup is as long as its pocket, which is why whatever it is fitted to has to stop short of
  // the pocket's floor. mouthDepth says where.
  const L = length ?? D * 1.06;
  const ri = r - w;
  const chamfer = Math.min(0.022, w * 0.3);
  const geometry = lathe([
    [0, -L], [r * 0.995, -L], [r * 1.0, -L * 0.7], [r * 1.012, -L * 0.3], [r * 1.012, -L * 0.14], [r * 1.012, -chamfer * 1.6], [r * 1.012, -chamfer], [r * 1.012 - chamfer, 0],
    [ri + chamfer, 0], [ri, -chamfer], [ri * 0.99, -D * 0.25], [ri * 0.96, -D * 0.6], [ri * 0.88, -D], [0, -D],
  ], segments);
  const wallColor = Array.isArray(color) ? color : lin(color);
  const dark = Array.isArray(lumen) ? lumen : lin(lumen);
  tintVertices(geometry, (x, y, z, out) => {
    const rad = Math.hypot(x, z);
    const inner = rad < ri * 1.005 && y < -chamfer * 0.5 ? 1 : 0;
    const t = inner ? clamp01(0.45 + (-y / D) * 1.2) : 0;
    out[0] = mix(wallColor[0], dark[0], t); out[1] = mix(wallColor[1], dark[1], t); out[2] = mix(wallColor[2], dark[2], t);
  });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
  geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1)));
  parts.push({ geometry, keepColor: true });
}

function tintVertices(geometry, fn) {
  const pos = geometry.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const out = [1, 1, 1];
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), out, i);
    arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

// The distance to a polyline, for paint that follows a vessel.
function polylineDist(path, x, y, z) {
  let best = 1e18;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]; const b = path[i + 1];
    const bx = b[0] - a[0]; const by = b[1] - a[1]; const bz = b[2] - a[2];
    const ax = x - a[0]; const ay = y - a[1]; const az = z - a[2];
    const bb = bx * bx + by * by + bz * bz;
    const t = bb > 0 ? clamp01((ax * bx + ay * by + az * bz) / bb) : 0;
    const dx = ax - bx * t; const dy = ay - by * t; const dz = az - bz * t;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Laplacian smoothing of an indexed mesh. A displaced grid's shoulders come out sawn wherever a
// fold runs nearly along a grid line, and a pass or two of this takes the teeth off for nothing.
function relaxMesh(geometry, iterations = 1, weight = 0.4) {
  const P = geometry.attributes.position;
  const idx = geometry.index;
  const n = P.count;
  const sums = new Float32Array(n * 3);
  const counts = new Uint16Array(n);
  for (let it = 0; it < iterations; it++) {
    sums.fill(0); counts.fill(0);
    for (let t = 0; t < idx.count; t += 3) {
      const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        sums[u * 3] += P.getX(v); sums[u * 3 + 1] += P.getY(v); sums[u * 3 + 2] += P.getZ(v);
        sums[v * 3] += P.getX(u); sums[v * 3 + 1] += P.getY(u); sums[v * 3 + 2] += P.getZ(u);
        counts[u] += 1; counts[v] += 1;
      }
    }
    for (let i = 0; i < n; i++) {
      const c = counts[i] || 1;
      P.setXYZ(i, mix(P.getX(i), sums[i * 3] / c, weight), mix(P.getY(i), sums[i * 3 + 1] / c, weight), mix(P.getZ(i), sums[i * 3 + 2] / c, weight));
    }
  }
  return geometry;
}

function organMesh(parts, params) {
  return mesh(mergeParts(parts), standard({ vertexColors: true, ...params }));
}

// Fine pore-scale grain that a vertex colour cannot carry: a greyscale tile used as a bump map on
// the skew UVs a sculpt lays down. Painted with seeded dots on a canvas; nothing is read back.
function grainBump(seed, { size = 256, dots = 2600, min = 0.8, max = 2.4, contrast = 0.5 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < dots; i++) {
      const x = rng() * w; const y = rng() * h; const r = min + rng() * (max - min);
      const light = rng() > 0.5;
      const v = Math.round(128 + (light ? 1 : -1) * contrast * 127 * (0.4 + rng() * 0.6));
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      for (const ox of [-w, 0, w]) {
        for (const oy of [-h, 0, h]) {
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// The little museum stand every organ here shares: a turned walnut base with a brass collar.
function standBase(parts, radius, { top = 0.34, color = 0x5b3a24, collar = 0xb08d4e, collarR = 0.2 } = {}) {
  const r = radius;
  parts.push({
    geometry: lathe([
      [0, 0], [r, 0], [r, top * 0.34], [r * 0.985, top * 0.42], [r * 0.93, top * 0.46],
      [r * 0.9, top * 0.62], [r * 0.82, top * 0.72], [r * 0.56, top * 0.82], [r * 0.36, top * 0.92], [0, top],
    ], 64),
    color,
  });
  parts.push({
    geometry: lathe([[0, top * 0.8], [collarR * 1.5, top * 0.8], [collarR * 1.5, top * 1.05], [collarR * 1.12, top * 1.22], [collarR, top * 1.5], [0, top * 1.5]], 28),
    color: collar,
  });
}

// ---------------------------------------------------------------------------------------------
// Human heart
// ---------------------------------------------------------------------------------------------

// Patient's left is +X, since the patient faces +Z. So the apex points down and toward +X, the
// aorta arches back and toward +X, the superior vena cava stands at -X, and the left ventricle
// forms the +X border with the right ventricle across most of the front. All of the great
// vessels are cut flat with a real lumen, which is what a specimen has.
function humanHeart() {
  const c = 0.068;
  const edge = c * 0.5;
  const RED = lin(0xc4242a);
  const RED_LV = lin(0xba2228);
  const AORTA = lin(0xd6302c);
  const BLUE_RV = lin(0x3457b8);
  const BLUE_RA = lin(0x2f50ae);
  const BLUE_PT = lin(0x3d6acb);
  const BLUE_VC = lin(0x2a4aa6);
  const PV = lin(0xd63c38);
  const FAT = lin(0xe6c97e);
  const CORONARY = 0xf0402c;
  const VEIN = 0x1c3690;

  const s = new Sculpt(c);
  // The two ventricles are tilted, plump cones. The crossing of their surfaces is the
  // interventricular groove, and the left one alone reaches the apex.
  const LV = curveP([[0.35, 3.95, -0.5], [0.8, 2.95, -0.06], [1.12, 1.92, 0.36]], [1.3, 0.98, 0.34], 14);
  const RV = curveP([[-0.82, 3.92, 0.22], [-0.2, 3.25, 0.58], [0.32, 2.72, 0.78]], [1.02, 0.8, 0.34], 12);
  s.add(LV, RED_LV);
  s.add(RV, BLUE_RV, { k: 0.14, ck: edge });
  // The conus, the funnel of the right ventricle rising to the pulmonary valve.
  const CONUS = curveP([[-0.25, 3.95, 0.62], [0.1, 4.55, 0.68], [0.32, 4.98, 0.56]], [0.74, 0.58, 0.46]);
  s.add(CONUS, BLUE_RV, { k: 0.2, ck: edge });
  // Right atrium, and the left atrium at the back of the heart.
  s.add(ellipsoidP([-1.28, 4.82, -0.1], [0.74, 0.92, 0.82]), BLUE_RA, { k: 0.1, ck: edge });
  const LA = ellipsoidP([0.22, 5.02, -1.0], [1.1, 0.62, 0.62]);
  s.add(LA, RED, { k: 0.12, ck: edge });
  // The two auricles have crimped edges, which is how they read: a run of folds along the lobe.
  s.add(ellipsoidP([-0.83, 5.15, 0.56], [0.52, 0.38, 0.36], [0, 0.4, -0.25]), BLUE_RA, { k: 0.16, ck: edge });
  s.map((d, x, y, z) => d + Math.sin((x * 0.9 + z * 0.4) * 16) * 0.05, [-1.5, 4.7, 0.2, -0.3, 5.6, 1.05]);
  const LAA = ellipsoidP([1.26, 5.02, 0.12], [0.34, 0.3, 0.66], [0.15, -0.3, 0]);
  s.add(LAA, RED, { k: 0.14, ck: edge });
  s.map((d, x, y, z) => d + Math.sin((z * 0.95 + x * 0.3) * 16) * 0.05, [0.85, 4.65, -0.65, 1.7, 5.4, 0.85]);

  const core = s.snapshot();

  // --- The grooves ------------------------------------------------------------------------
  // The anterior interventricular groove is found, not guessed: where the two cones' surfaces
  // cross on the front of the heart.
  const crease = [];
  {
    let x = 0.62; let z = 1.05;
    for (let i = 0; i <= 12; i++) {
      const y = mix(4.1, 2.5, i / 12);
      for (let it = 0; it < 18; it++) {
        const a = LV.f(x, y, z); const b = RV.f(x, y, z);
        const h = 0.004;
        const ax = (LV.f(x + h, y, z) - a) / h; const az = (LV.f(x, y, z + h) - a) / h;
        const bx = (RV.f(x + h, y, z) - b) / h; const bz = (RV.f(x, y, z + h) - b) / h;
        const det = ax * bz - az * bx;
        if (Math.abs(det) < 1e-5) break;
        x -= THREE.MathUtils.clamp((a * bz - az * b) / det, -0.15, 0.15);
        z -= THREE.MathUtils.clamp((ax * b - a * bx) / det, -0.15, 0.15);
      }
      crease.push([x, y, z]);
    }
  }
  const avRight = [[-0.42, 4.42, 0.92], [-1.0, 4.18, 0.78], [-1.5, 3.98, 0.42], [-1.78, 3.86, -0.15], [-1.4, 3.86, -0.82], [-0.6, 3.9, -1.32]];
  const avLeft = [[0.92, 4.5, 0.48], [1.42, 4.28, 0.05], [1.56, 4.1, -0.55], [1.12, 3.98, -1.3], [0.42, 3.96, -1.72]];
  const backGroove = [[-0.6, 3.9, -1.32], [-0.2, 3.2, -1.2], [0.42, 2.5, -0.72], [0.86, 2.0, -0.2]];
  const ladPath = [[0.72, 4.42, 0.62], ...crease.slice(1), [1.12, 1.82, 0.72]];

  // Sink the grooves first, so the vessels that lie in them can ask where the floor is.
  const preGroove = [pathOn(core, ladPath, 22), pathOn(core, avRight, 20), pathOn(core, avLeft, 16), pathOn(core, backGroove, 12)];
  for (const path of preGroove) {
    const every = path.filter((_, i) => i % 2 === 0);
    s.sub(segsP(every, every.map(() => 0.075)), null, { k: 0.12 });
  }

  // --- The great vessels ------------------------------------------------------------------
  const vessels = [];
  const vessel = (points, radii, color, k, lumen) => {
    const prim = curveP(points, radii, Math.max(10, (points.length - 1) * 6));
    s.add(prim, color, { k, ck: edge });
    const a = points[points.length - 2]; const b = points[points.length - 1];
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    vessels.push({ p: b, dir: [dir.x, dir.y, dir.z], r: radii[radii.length - 1], lumen, color });
  };

  // The pulmonary trunk runs up, back and to the left, then divides in the hollow under the arch.
  // It goes in BEFORE the aorta, so it can fillet into the conus below it and still meet the aorta
  // in a crisp crease: two vessels crossing, not one blob.
  const PT = curveP([[0.32, 4.9, 0.56], [0.5, 5.32, 0.34], [0.5, 5.62, -0.2]], [0.5, 0.47, 0.42], 14);
  s.add(PT, BLUE_PT, { k: 0.14, ck: edge });
  vessel([[0.5, 5.62, -0.2], [1.02, 5.76, -0.42], [1.82, 5.8, -0.52]], [0.38, 0.32, 0.29], BLUE_PT, 0.08, 0x0e1a44);

  // The venae cavae enter the right atrium from above and below.
  vessel([[-1.24, 5.3, -0.1], [-1.26, 5.95, -0.08], [-1.28, 6.68, -0.04]], [0.44, 0.4, 0.38], BLUE_VC, 0.14, 0x0e1a44);
  vessel([[-1.34, 4.25, -0.5], [-1.4, 3.75, -0.72], [-1.42, 3.28, -0.8]], [0.5, 0.46, 0.44], BLUE_VC, 0.14, 0x0e1a44);

  // The right pulmonary artery passes behind the aorta and the vena cava.
  vessel([[0.5, 5.62, -0.2], [-0.25, 5.46, -0.62], [-1.0, 5.46, -0.86], [-2.02, 5.56, -0.86]], [0.38, 0.33, 0.31, 0.29], BLUE_PT, 0.05, 0x0e1a44);

  // Four pulmonary veins enter the left atrium, two from each side.
  vessel([[-0.5, 5.2, -1.3], [-1.2, 5.2, -1.42], [-2.02, 5.0, -1.48]], [0.22, 0.2, 0.19], PV, 0.08, 0x430a0e);
  vessel([[-0.5, 4.8, -1.3], [-1.2, 4.66, -1.42], [-1.96, 4.32, -1.48]], [0.22, 0.2, 0.19], PV, 0.08, 0x430a0e);
  vessel([[1.0, 5.3, -1.1], [1.62, 5.34, -1.14], [2.3, 5.2, -1.14]], [0.22, 0.2, 0.19], PV, 0.08, 0x430a0e);
  vessel([[1.02, 4.86, -1.14], [1.62, 4.74, -1.18], [2.26, 4.42, -1.2]], [0.22, 0.2, 0.19], PV, 0.08, 0x430a0e);

  // The aorta rises from the middle of the heart, arches back over the pulmonary arteries toward
  // the patient's left, and descends behind everything.
  const ARCH = [[-0.12, 4.35, 0.02], [-0.28, 5.0, 0.28], [-0.4, 5.62, 0.26], [-0.22, 6.08, -0.18], [0.2, 6.14, -0.92], [0.5, 5.82, -1.62], [0.58, 5.1, -2.02], [0.6, 4.3, -2.08]];
  vessel(ARCH, [0.56, 0.5, 0.47, 0.46, 0.44, 0.42, 0.4, 0.38], AORTA, 0.07, 0x430a0e);
  const AORTA_SOLID = s.ops[s.ops.length - 1];
  AORTA_SOLID.ck = 0.012;
  // Its three branches rise from the top of the arch, right to left.
  vessel([[-0.22, 6.2, -0.36], [-0.34, 6.62, -0.36], [-0.48, 6.98, -0.3]], [0.28, 0.24, 0.235], AORTA, 0.12, 0x430a0e);
  vessel([[0.05, 6.22, -0.72], [0.02, 6.62, -0.76], [-0.02, 6.98, -0.76]], [0.2, 0.17, 0.165], AORTA, 0.11, 0x430a0e);
  vessel([[0.36, 6.14, -1.14], [0.5, 6.55, -1.2], [0.64, 6.92, -1.24]], [0.22, 0.19, 0.18], AORTA, 0.11, 0x430a0e);
  // The ligamentum arteriosum, the fetal shunt's remnant, between the trunk's fork and the arch.
  s.add(curveP([[0.58, 5.72, -0.42], [0.54, 5.82, -0.82], [0.46, 5.96, -1.18]], [0.07, 0.055, 0.07], 8), FAT, { k: 0.06, ck: edge });

  // Every vessel is sawn off flat just short of its end, and a mouth with a real lumen is fitted
  // over the cut. See vesselMouth.
  for (const { p, dir, r } of vessels) {
    // A cylinder along the vessel, not a ball, or it takes a bite out of whatever stands beside it.
    const back = mouthDepth(r) + 0.02;
    const q = [p[0] - dir[0] * back, p[1] - dir[1] * back, p[2] - dir[2] * back];
    const long = back + r * 1.4; const wide = r * 1.3; const reach = long + wide;
    s.sub({
      box: [q[0] - reach, q[1] - reach, q[2] - reach, q[0] + reach, q[1] + reach, q[2] + reach],
      f: (x, y, z) => {
        const qx = x - q[0]; const qy = y - q[1]; const qz = z - q[2];
        const along = qx * dir[0] + qy * dir[1] + qz * dir[2];
        const radial = Math.sqrt(Math.max(0, qx * qx + qy * qy + qz * qz - along * along));
        return Math.max(-along, along - long, radial - wide);
      },
    });
  }

  // --- The vessels on the surface ---------------------------------------------------------
  // These are the one thing a sculpt at this cell size draws badly, and they are thin and few, so
  // they are analytic tubes on paths that ask the finished surface where it is. Half sunk, so a
  // tube can neither float nor show a crescent, and they keep a clean line a grid would saw.
  const finished = s.snapshot();
  const lad = pathOn(finished, ladPath, 26);
  const rca = pathOn(finished, avRight, 28);
  const circ = pathOn(finished, avLeft, 20);
  const posteriorIV = pathOn(finished, backGroove, 16);
  const marginal = pathOn(finished, [rca[11], [-1.05, 3.5, 0.72], [-0.55, 3.0, 0.98], [0.02, 2.72, 1.05]], 14);
  const rightAnterior = pathOn(finished, [rca[6], [-0.5, 3.62, 1.08], [-0.2, 3.25, 1.2]], 8);
  const conal = pathOn(finished, [lad[3], [0.2, 4.15, 1.18], [-0.1, 3.85, 1.3]], 8);
  const diagonal = pathOn(finished, [lad[6], [1.32, 3.5, 0.92], [1.62, 2.85, 0.72]], 10);
  const leftMarginal = pathOn(finished, [circ[6], [1.98, 3.45, -0.12], [1.92, 2.82, 0.08], [1.55, 2.32, 0.28]], 14);
  const offset = (path, ox, oy, oz) => path.map((p) => [p[0] + ox, p[1] + oy, p[2] + oz]);
  // The great cardiac vein climbs beside the LAD, then follows the circumflex round to the back.
  const gcv = pathOn(finished, [
    ...offset(lad.slice(4, 24).filter((_, i) => i % 4 === 0), 0.17, 0, 0).reverse(),
    ...offset(circ.slice(2, 19).filter((_, i) => i % 4 === 0), 0.03, 0.13, 0),
  ], 34);
  const middleVein = pathOn(finished, offset(posteriorIV, -0.2, 0, 0).filter((_, i) => i % 3 === 0), 12);
  const sinus = pathOn(finished, [[1.15, 4.08, -1.32], [0.5, 4.12, -1.68], [-0.1, 4.12, -1.5], [-0.75, 4.2, -1.2]], 14);

  const parts = [];
  for (const { p, dir, r, color, lumen } of vessels) vesselMouth(parts, p, dir, r, color, lumen);
  const lay = (path, r0, r1, color) => {
    const radii = path.map((_, i) => mix(r0, r1, i / (path.length - 1)));
    parts.push({ geometry: tube(path, radii, { sides: 9, steps: path.length - 1, round: 2 }), color });
  };
  lay(lad, 0.082, 0.04, CORONARY);
  lay(rca, 0.085, 0.05, CORONARY);
  lay(circ, 0.08, 0.05, CORONARY);
  lay(posteriorIV, 0.055, 0.03, CORONARY);
  lay(marginal, 0.056, 0.028, CORONARY);
  lay(rightAnterior, 0.046, 0.026, CORONARY);
  lay(conal, 0.046, 0.026, CORONARY);
  lay(diagonal, 0.058, 0.028, CORONARY);
  lay(leftMarginal, 0.058, 0.028, CORONARY);
  lay(gcv, 0.032, 0.07, VEIN);
  lay(middleVein, 0.042, 0.056, VEIN);
  lay(sinus, 0.08, 0.12, VEIN);

  // Where a blue vessel meets a red one, the mesh's edges run along the join, so the line between
  // them is a clean curve rather than a saw of purple.
  const colourEdge = (x, y, z) => {
    const blue = Math.min(PT.f(x, y, z), CONUS.f(x, y, z));
    const red = Math.min(AORTA_SOLID.f(x, y, z), LAA.f(x, y, z), LA.f(x, y, z));
    if (blue > 0.2 || red > 0.2 || y < 4.1) return 1e9;
    return (red - blue) * 0.5;
  };
  // --- Paint ------------------------------------------------------------------------------
  const warm = [0, 0, 0];
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    // A vertex on the blue-red join takes one colour or the other, never the purple between them.
    const edgeValue = colourEdge(x, y, z);
    if (Math.abs(edgeValue) < 0.09) {
      const pure = edgeValue < 0 ? AORTA : BLUE_PT;
      rgb[0] = pure[0]; rgb[1] = pure[1]; rgb[2] = pure[2];
    }
    const nearest = Math.min(LV.f(x, y, z), RV.f(x, y, z));
    const muscle = 1 - sstep(nearest, 0.08, 0.2);
    if (muscle > 0) {
      // Fat follows the coronary grooves: a narrow band that thins down toward the apex.
      const g = Math.min(polylineDist(rca, x, y, z), polylineDist(circ, x, y, z));
      const g2 = Math.min(polylineDist(lad, x, y, z), polylineDist(posteriorIV, x, y, z));
      const wob = (smoothNoise3(x * 1.4 + 3, y * 1.4, z * 1.4) - 0.5) * 0.12;
      const fat = Math.max(1 - sstep(g, 0.09 + wob, 0.21 + wob), 0.8 * (1 - sstep(g2, 0.05 + wob * 0.4, 0.15 + wob * 0.4)) * sstep(y, 2.2, 3.4)) * muscle;
      if (fat > 0) {
        const n = 0.9 + smoothNoise3(x * 4, y * 4, z * 4) * 0.2;
        warm[0] = FAT[0] * n; warm[1] = FAT[1] * n; warm[2] = FAT[2] * n;
        mixInto(rgb, warm, fat * 0.8);
      }
      // Muscle fibres spiral round the ventricles, which a broad streak can suggest.
      const fibre = 1 + muscle * (-0.1 + 0.22 * smoothNoise3((x * 0.8 + y * 0.6 - z * 0.3) * 1.1 + 4, (x * 0.6 - y * 0.8) * 5.5, z * 1.2));
      rgb[0] *= fibre; rgb[1] *= fibre; rgb[2] *= fibre;
    } else {
      const m = 0.97 + 0.08 * smoothNoise3(x * 2.4 + 9, y * 2.4, z * 2.4);
      rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
    }
  };

  parts.unshift({ geometry: polygonize(s, { tint, uvScale: 1.6, snap: colourEdge }), keepColor: true });

  const root = new THREE.Group();
  root.name = 'human-heart';
  root.add(organMesh(parts, { roughness: 0.42, metalness: 0, bumpMap: grainBump(11, { dots: 1800 }), bumpScale: 0.35 }));

  // A rod straight up from the middle of the base into the underside of the heart, with the apex
  // in clear air beside it.
  const stand = [];
  standBase(stand, 1.5, { top: 0.36 });
  stand.push({ geometry: lathe([[0, 0.3], [0.1, 0.3], [0.09, 2.6], [0.09, 3.2], [0, 3.2]], 20), color: 0xb08d4e });
  root.add(organMesh(stand, { roughness: 0.42, metalness: 0.25 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Human brain
// ---------------------------------------------------------------------------------------------

// A plain sculpt was wrong for this one organ: a folded surface has about twice the area of what
// it folds, and a grid pays for every wall of every fold. So a hemisphere is polygonised SMOOTH,
// which spends the triangles on the base surface alone, and then every vertex is displaced along
// its normal. That is the rule Fantastic Voyage arrived at: one displaced surface, in which a
// sulcus is a NARROW GAUSSIAN CUT at the zero crossing of a wave field, never the trough of a wave.
//
// Two things keep the cuts crisp at this density. Every vertex close to a zero crossing is first
// SLID ALONG THE SURFACE ONTO IT, so the floor of a sulcus runs along a line of mesh edges rather
// than being sawn across them. And the plane waves' directions are held near the plane across the
// head: isotropic waves make closed islands, while these make long winding ridges that branch and
// run front to back over the side of the brain, as frontal and temporal gyri do.
function humanBrain() {
  const rng = seededRandom(4217);
  const LAMBDA = 0.68; // feet per cycle: one gyrus and one sulcus. About twelve samples a cycle.
  const K = (Math.PI * 2) / LAMBDA;
  const waves = [];
  for (let i = 0; i < 14; i++) {
    const zz = rng() * 2 - 1; const a = rng() * Math.PI * 2; const r = Math.sqrt(1 - zz * zz);
    waves.push([Math.cos(a) * r * K, Math.sin(a) * r * K, zz * K, rng() * Math.PI * 2]);
  }
  const amp = 1 / Math.sqrt(waves.length / 2);
  const poly2 = (path, y, z) => {
    let best = 1e18;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]; const b = path[i + 1];
      const by = b[0] - a[0]; const bz = b[1] - a[1];
      const ay = y - a[0]; const az = z - a[1];
      const t = clamp01((ay * by + az * bz) / (by * by + bz * bz));
      const dy = ay - by * t; const dz = az - bz * t;
      const d = dy * dy + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const smooth2 = (points, n) => new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(0, q[0], q[1]))).getPoints(n).map((v) => [v.y, v.z]);
  // The named folds, drawn on the side of the head in (y, z). The lateral fissure runs up and back
  // from the temporal pole, the central sulcus comes down and forward from the top of the head,
  // and the parieto-occipital marks the back.
  const LATERAL = smooth2([[3.32, 1.6], [3.5, 0.9], [3.68, 0.3], [3.92, -0.42], [4.34, -1.05]], 16);
  const CENTRAL = smooth2([[6.1, -0.52], [5.35, -0.16], [4.72, 0.08], [4.12, 0.32], [3.72, 0.4]], 14);
  const POSTOCC = smooth2([[5.7, -1.42], [5.05, -1.85], [4.5, -2.3]], 8);
  const lookup = (path, keyAt, valAt, key) => {
    for (let i = 0; i < path.length - 1; i++) {
      const a = keyAt(path[i]); const b = keyAt(path[i + 1]);
      if ((key - a) * (key - b) <= 0) return mix(valAt(path[i]), valAt(path[i + 1]), (key - a) / ((b - a) || 1));
    }
    return key > Math.max(keyAt(path[0]), keyAt(path[path.length - 1]))
      ? valAt(keyAt(path[0]) > keyAt(path[path.length - 1]) ? path[0] : path[path.length - 1])
      : valAt(keyAt(path[0]) < keyAt(path[path.length - 1]) ? path[0] : path[path.length - 1]);
  };
  const yLateral = (z) => lookup(LATERAL, (q) => q[1], (q) => q[0], z);
  const zCentral = (y) => lookup(CENTRAL, (q) => q[0], (q) => q[1], y);
  const zPostOcc = (y) => lookup(POSTOCC, (q) => q[0], (q) => q[1], y);
  const inTemporal = (y, z) => z < 1.7 && z > -1.7 && y < yLateral(z) + (z < -1.05 ? (-1.05 - z) * -0.5 : 0);

  // Long gyri: the phase of a stripe that runs front to back round each hemisphere, or along the
  // temporal lobe's own length below the lateral fissure. Unlike a sum of waves it cannot leave a
  // dead patch with no crossing in it, which is what an empty parietal lobe was. Random waves are
  // mixed in to break the stripes into branches, and take over at the two poles, where meridians
  // would otherwise crowd together.
  const waveDist = (x, y, z) => {
    const side = x >= 0 ? 1 : -1;
    const ax = Math.abs(x);
    const low = Math.sin(y * 2.3 + z * 1.5 + side * 0.7) + Math.sin(z * 2.9 - x * 1.9 + 1.0) + Math.sin(x * 2.9 + y * 1.9 + 2.0) * 0.8 + Math.sin(z * 4.4 + y * 1.1 + side) * 0.5;
    let phase;
    if (inTemporal(y, z)) phase = 9 * Math.atan2(y - 3.1, ax - 1.0) + low * 1.7;
    else phase = 15 * Math.atan2(y - 4.1, ax - 0.5) + low * 2.1;
    const wx = x + 0.2 * Math.sin(y * 1.7 + z * 0.9 + 1.0);
    const wy = y + 0.2 * Math.sin(z * 1.5 + x * 1.2);
    const wz = z + 0.2 * Math.sin(x * 1.6 + y * 1.1);
    let f = 0;
    for (let i = 0; i < waves.length; i++) {
      const w = waves[i];
      f += Math.sin(wx * w[0] + wy * w[1] + wz * w[2] + w[3]);
    }
    f *= amp;
    const pole = sstep(Math.abs(z + 0.1), 1.25, 1.95);
    return (mix(Math.sin(phase) * 0.8 + f * 0.9, f, pole)) / K; // near a crossing, a rough distance in feet
  };

  // The whole cerebrum is ONE closed surface. The longitudinal fissure is the deepest cut in it
  // rather than two walls that never touch, which also stops those walls costing a third of the
  // triangles for a surface nobody can see.
  const CELL = 0.064;
  const base = new Sculpt(CELL);
  const WHITE = [1, 1, 1];
  for (const side of [1, -1]) {
    base.add(ellipsoidP([side * 0.62, 4.4, -0.1], [1.3, 1.58, 2.28]), WHITE, { k: 0.1 });
    base.add(ellipsoidP([side * 0.42, 3.82, 1.12], [1.22, 0.7, 1.08]), WHITE, { k: 0.34 });
    base.add(ellipsoidP([side * 0.36, 3.92, -1.55], [1.2, 0.86, 0.92]), WHITE, { k: 0.34 });
    base.add(ellipsoidP([side * 0.98, 3.12, -0.2], [0.92, 0.64, 1.66], [0.16, side * 0.12, 0]), WHITE, { k: 0.14 });
  }
  const g = polygonize(base, {});
  const baseField = base.snapshot();

  const FISSURE = (x, z) => x + 0.04 * Math.sin(z * 2.1 + 0.6) + 0.018 * Math.sin(z * 4.7);
  const fold = (x, y, z, out) => {
    const mid = FISSURE(x, z);
    if (Math.abs(mid) < 0.2) { out[0] = mid; out[1] = 0.92; out[2] = 0.055; return mid; }
    let best = waveDist(x, y, z); let depth = 0.16; let sigma = 0.055;
    if (Math.abs(x) > 0.3) {
      const l = poly2(LATERAL, y, z);
      if (l < 0.24 && l < Math.abs(best) + 0.03) { best = l; depth = 0.5; sigma = 0.075; }
      const cen = poly2(CENTRAL, y, z);
      if (cen < 0.2 && cen < Math.abs(best) + 0.03) { best = cen; depth = 0.3; sigma = 0.06; }
    }
    const po = poly2(POSTOCC, y, z);
    if (po < 0.18 && po < Math.abs(best) + 0.02) { best = po; depth = 0.26; sigma = 0.055; }
    out[0] = best; out[1] = depth; out[2] = sigma;
    return best;
  };

  const GREY = lin(0xd8a9a3);
  const LOBE = { frontal: lin(0xe9ae88), parietal: lin(0xd8a2bd), temporal: lin(0xb1bd84), occipital: lin(0xa3b8d6) };
  {
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const col = g.attributes.color;
    const f3 = [0, 0, 0];
    const h = 0.012;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i); let y = P.getY(i); let z = P.getZ(i);
      let nx = N.getX(i); let ny = N.getY(i); let nz = N.getZ(i);
      // Slide a vertex near a fold's floor along the surface and onto it.
      const f0 = fold(x, y, z, f3);
      if (Math.abs(f0) < CELL * 0.72) {
        const gx = (fold(x + h, y, z, f3) - f0) / h;
        const gy = (fold(x, y + h, z, f3) - f0) / h;
        const gz = (fold(x, y, z + h, f3) - f0) / h;
        const g2 = gx * gx + gy * gy + gz * gz;
        if (g2 > 1e-3) {
          const q = onSurface(baseField, [x - (gx * f0) / g2, y - (gy * f0) / g2, z - (gz * f0) / g2], 0, 3);
          x = q[0]; y = q[1]; z = q[2];
          [nx, ny, nz] = fieldNormal(baseField, q);
        }
      }
      const dist = fold(x, y, z, f3);
      // The midline cut is shallower at the two poles, where it runs along the surface's normal,
      // and goes straight in along the midline rather than along a normal that leans away from
      // it. Otherwise it gapes open like a split log.
      const depth = f3[1] > 0.6 ? f3[1] * mix(1, 0.34, sstep(Math.abs(nz), 0.3, 0.8)) : f3[1];
      if (f3[1] > 0.6) { const l = Math.hypot(ny, nz) || 1; nx = 0; ny /= l; nz /= l; }
      const sigma = f3[2];
      const narrow = Math.exp(-(dist * dist) / (2 * sigma * sigma));
      const shoulder = Math.exp(-(dist * dist) / (2 * 0.12 * 0.12));
      // Well inside a third of the local radius, as the rule says, except on the midline, which is
      // where the two halves really do part.
      const cut = depth * narrow + Math.min(depth, 0.3) * 0.34 * shoulder;
      P.setXYZ(i, x - nx * cut, y - ny * cut, z - nz * cut);

      // The left half (x > 0) carries its lobes in a faint wash, and the right stays plain, so a
      // student can compare a labelled side with a bare one. Each boundary is a real fold.
      const rgb = [GREY[0], GREY[1], GREY[2]];
      if (x > 0) {
        const t = inTemporal(y, z) ? 1 : 0;
        const fr = sstep(z - zCentral(y), -0.03, 0.03);
        const oc = 1 - sstep(z - zPostOcc(y), -0.05, 0.05);
        const c = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          c[k] = mix(mix(LOBE.parietal[k], LOBE.frontal[k], fr), LOBE.occipital[k], oc);
          c[k] = mix(c[k], LOBE.temporal[k], t);
        }
        mixInto(rgb, c, 0.42);
      }
      const n = 0.94 + 0.12 * smoothNoise3(x * 2 + 2, y * 2, z * 2);
      // The walls of the midline fissure fall away into the dark, or it reads as a shallow trench.
      const midDark = 1 - 0.8 * (1 - sstep(Math.abs(FISSURE(x, z)), 0.03, 0.17));
      const shade = (1 - 0.8 * narrow) * (1 - 0.2 * shoulder) * n * midDark;
      col.setXYZ(i, rgb[0] * shade, rgb[1] * shade * 0.94, rgb[2] * shade * 0.94);
    }
    const uv = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      uv.setXY(i, (P.getX(i) + P.getZ(i) * 0.62) * 2.4, (P.getY(i) + P.getZ(i) * 0.37) * 2.4);
    }
    relaxMesh(g, 3, 0.42);
    g.computeVertexNormals();
  }
  const parts = [{ geometry: g, keepColor: true }];

  // The brainstem: smooth, sculpted, and rooted deep inside the cerebrum above it.
  const s = new Sculpt(0.07);
  const STEM = lin(0xdcb79f);
  s.add(curveP([[0, 3.6, -0.22], [0, 2.82, -0.42], [0, 2.3, -0.5], [0, 1.9, -0.48], [0, 1.5, -0.42]], [0.5, 0.5, 0.36, 0.28, 0.2], 16), STEM, { k: 0.16, ck: 0.1 });
  s.add(ellipsoidP([0, 2.72, -0.2], [0.56, 0.42, 0.42]), STEM, { k: 0.14, ck: 0.1 });
  const nerve = lin(0xe9d8b8);
  s.add(curveP([[0, 2.98, 0.42], [0.24, 2.96, 0.2], [0.42, 2.96, -0.05]], 0.075, 8), nerve, { k: 0.05, ck: 0.03 });
  s.add(curveP([[0, 2.98, 0.42], [-0.24, 2.96, 0.2], [-0.42, 2.96, -0.05]], 0.075, 8), nerve, { k: 0.05, ck: 0.03 });
  s.add(curveP([[0.36, 3.2, 1.0], [0.16, 3.04, 0.62], [0, 2.98, 0.42], [-0.16, 3.04, 0.62], [-0.36, 3.2, 1.0]], 0.08, 12), nerve, { k: 0.05, ck: 0.03 });
  parts.push({ geometry: polygonize(s, {}), keepColor: true });

  // The cerebellum: a grid whose rows are stacked up a tilted axis, so they run exactly along the
  // folia. A ridge costs five rows and cannot be sawn by the mesh. Seen from behind and from the
  // side the folia are near-horizontal lines, which is what they are.
  const CB = [0, 2.92, -1.42];
  const cbField = [
    ellipsoidP([0.62, 2.86, -1.38], [0.8, 0.62, 0.86], [0, 0, 0.1]),
    ellipsoidP([-0.62, 2.86, -1.38], [0.8, 0.62, 0.86], [0, 0, -0.1]),
    ellipsoidP([0, 2.88, -1.5], [0.36, 0.6, 0.84]),
  ];
  const cbd = (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < 3; i++) {
      const v = cbField[i].f(x, y, z);
      const h = Math.max(0.1 - Math.abs(d - v), 0) / 0.1;
      d = (d < v ? d : v) - h * h * 0.1 * 0.25;
    }
    return d;
  };
  const FOLIA = 24; const ROWS = 5; const NT = FOLIA * ROWS; const NP = 36;
  const PROFILE = [0.082, 0.024, 0, 0, 0.024];
  const tilt = new THREE.Matrix4().makeRotationX(0.42);
  const cbPos = []; const cbCol = []; const cbIdx = [];
  const CBC = lin(0xd19c90);
  const VERMIS = lin(0xc48d82);
  const dir = new THREE.Vector3();
  const ray = (x, y, z) => { dir.set(x, y, z).applyMatrix4(tilt); return [dir.x, dir.y, dir.z]; };
  for (let i = 1; i < NT; i++) {
    const phi = (i / NT) * Math.PI;
    const big = Math.floor(i / ROWS) % 5 === 0;
    const profile = PROFILE[i % ROWS] * (big ? 1.5 : 1);
    for (let j = 0; j < NP; j++) {
      const a = (j / NP) * Math.PI * 2;
      const d = ray(Math.sin(phi) * Math.sin(a), Math.cos(phi), Math.sin(phi) * Math.cos(a));
      const t = rayIn(cbd, CB, d, 2);
      const x0 = CB[0] + d[0] * t; const y0 = CB[1] + d[1] * t; const z0 = CB[2] + d[2] * t;
      const cut = profile * Math.min(1, Math.sin(phi) * 2.2);
      cbPos.push(x0 - d[0] * cut, y0 - d[1] * cut, z0 - d[2] * cut);
      const c = Math.abs(x0) < 0.3 ? VERMIS : CBC;
      const shade = (1 - (profile / 0.082) * 0.62) * (0.95 + 0.1 * smoothNoise3(x0 * 3, y0 * 3, z0 * 3));
      cbCol.push(c[0] * shade, c[1] * shade * 0.9, c[2] * shade * 0.9);
    }
  }
  const poleA = cbPos.length / 3;
  for (const sgn of [1, -1]) {
    const d = ray(0, sgn, 0);
    const t = rayIn(cbd, CB, d, 2);
    cbPos.push(CB[0] + d[0] * t, CB[1] + d[1] * t, CB[2] + d[2] * t);
    cbCol.push(CBC[0] * 0.9, CBC[1] * 0.82, CBC[2] * 0.82);
  }
  const at = (i, j) => (i * NP) + ((j + NP) % NP);
  for (let i = 0; i < NT - 2; i++) {
    for (let j = 0; j < NP; j++) {
      const a = at(i, j); const b = at(i, j + 1); const c = at(i + 1, j + 1); const e = at(i + 1, j);
      cbIdx.push(a, e, c, a, c, b);
    }
  }
  for (let j = 0; j < NP; j++) {
    cbIdx.push(poleA, at(0, j), at(0, j + 1));
    cbIdx.push(poleA + 1, at(NT - 2, j + 1), at(NT - 2, j));
  }
  const cerebellum = new THREE.BufferGeometry();
  cerebellum.setAttribute('position', new THREE.Float32BufferAttribute(cbPos, 3));
  cerebellum.setAttribute('color', new THREE.Float32BufferAttribute(cbCol, 3));
  cerebellum.setIndex(cbIdx);
  cerebellum.computeVertexNormals();
  parts.push({ geometry: cerebellum, keepColor: true });

  const root = new THREE.Group();
  root.name = 'human-brain';
  root.add(organMesh(parts, { roughness: 0.55, metalness: 0, bumpMap: grainBump(23, { dots: 2200 }), bumpScale: 0.25 }));

  // The stem runs down into a turned socket on the base: supported from below, no pole in sight.
  const stand = [];
  standBase(stand, 1.45, { top: 0.36, collarR: 0.01 });
  stand.push({
    geometry: lathe([[0, 0.3], [0.7, 0.3], [0.64, 0.42], [0.42, 0.55], [0.26, 0.8], [0.2, 1.1], [0.22, 1.4], [0.3, 1.56], [0.34, 1.68], [0.3, 1.74], [0, 1.74]], 32),
    color: 0xb08d4e,
    position: [0, 0, -0.42],
  });
  root.add(organMesh(stand, { roughness: 0.42, metalness: 0.25 }));
  return root;
}

// Marches in from outside to where a ray from `c` first meets a field's surface.
function rayIn(field, c, d, far) {
  let t = far;
  for (let i = 0; i < 48; i++) {
    const v = field(c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t);
    if (v < 0.002) break;
    t -= Math.max(v * 0.9, 0.004);
    if (t < 0.02) { t = 0.02; break; }
  }
  return t;
}

// ---------------------------------------------------------------------------------------------
// Human lungs
// ---------------------------------------------------------------------------------------------

// Patient's right is -X, so the three-lobed lung stands on the student's left. It is the one that
// is opened, with a window on its front, because it has more to show inside and because the left
// lung's cardiac notch needs its front intact. The window leaves the lateral flank whole so that
// all three lobes can still be counted from the side, which is what the card asks a student to do.
function humanLungs() {
  const CELL = 0.095;
  const rng = seededRandom(9017);

  const RIGHT_DOME = ellipsoidP([-1.72, 0.62, -0.05], [1.74, 1.55, 1.84]);
  const LEFT_DOME = ellipsoidP([1.72, 0.42, -0.05], [1.68, 1.55, 1.8]);
  const WINDOW = ellipsoidP([-1.82, 3.82, 1.06], [1.12, 1.62, 1.12]);
  const TISSUE_SECTION = lin(0xb4404c);

  const lung = new Sculpt(CELL);
  // Each lung is a blunt cone: narrow rounded apex, wide base, domed flank.
  const body = (side, wide) => curveP([
    [side * 1.5, 6.12, 0.05], [side * 1.72, 5.05, -0.02], [side * 1.86, 3.5, -0.12], [side * 1.9, 2.75, -0.12],
  ], [0.46, 1.02, 1.42 * wide, 1.46 * wide], 14);
  lung.add(body(-1, 1), [1, 1, 1]);
  lung.sub(RIGHT_DOME, null, { k: 0.1 });
  // The medial face is hollowed for the heart and the great vessels, more on the left.
  lung.sub(ellipsoidP([0.05, 3.4, 0.4], [1.0, 2.5, 1.6]), null, { k: 0.3 });
  const rightOnly = lung.ops.slice();
  lung.ops = [];
  lung.add(body(1, 0.94), [1, 1, 1]);
  lung.sub(LEFT_DOME, null, { k: 0.1 });
  lung.sub(ellipsoidP([0.25, 3.3, 0.4], [1.08, 2.5, 1.6]), null, { k: 0.3 });
  // The cardiac notch: a bite out of the front lower edge of the left lung, over the heart, with
  // the tongue of the lingula left below it.
  lung.sub(ellipsoidP([0.86, 3.5, 1.2], [0.82, 0.72, 0.92]), null, { k: 0.22 });
  const leftOnly = lung.ops.slice();

  // The window goes into the right lung, and everything about the two lungs' surface comes after.
  const rightSculpt = new Sculpt(CELL);
  rightSculpt.ops = rightOnly;
  rightSculpt.sub(WINDOW, TISSUE_SECTION, { k: 0.14, ck: 0.05 });
  const leftSculpt = new Sculpt(CELL);
  leftSculpt.ops = leftOnly;

  // Fissures, in the plane of each lobe's boundary. `oblique` falls from high at the back to low at
  // the front; `horizontal` runs forward from it, in the right lung only.
  const obl = (x, y, z, side) => {
    const lat = Math.abs(x) - 1.7;
    const yAt = 3.72 - z * 1.0 + 0.07 * Math.sin(z * 2.2 + lat * 1.5) + (side < 0 ? 0.12 : 0);
    return (y - yAt) * 0.7071;
  };
  const hor = (x, y, z) => y - (4.34 + 0.05 * Math.sin(z * 2.6) + 0.04 * Math.sin(x * 3.0));
  const fissure = (x, y, z, side) => {
    const o = obl(x, y, z, side);
    if (side < 0 && o > 0) {
      const h = hor(x, y, z);
      if (Math.abs(h) < Math.abs(o)) return h;
    }
    return o;
  };

  const LOBES = {
    upper: lin(0xee9aa6),
    middle: lin(0xf2ae8e),
    lower: lin(0xdf7f98),
  };
  const dressed = (sculpt, side) => {
    const g = polygonize(sculpt, {});
    const field = sculpt.snapshot();
    const P = g.attributes.position;
    const N = g.attributes.normal;
    const col = g.attributes.color;
    const uv = g.attributes.uv;
    const h = 0.012;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i); let y = P.getY(i); let z = P.getZ(i);
      let nx = N.getX(i); let ny = N.getY(i); let nz = N.getZ(i);
      const f0 = fissure(x, y, z, side);
      if (Math.abs(f0) < CELL * 0.72) {
        const gx = (fissure(x + h, y, z, side) - f0) / h;
        const gy = (fissure(x, y + h, z, side) - f0) / h;
        const gz = (fissure(x, y, z + h, side) - f0) / h;
        const g2 = gx * gx + gy * gy + gz * gz;
        if (g2 > 1e-3) {
          const q = onSurface(field, [x - (gx * f0) / g2, y - (gy * f0) / g2, z - (gz * f0) / g2], 0, 3);
          x = q[0]; y = q[1]; z = q[2];
          [nx, ny, nz] = fieldNormal(field, q);
        }
      }
      const dist = fissure(x, y, z, side);
      const narrow = Math.exp(-(dist * dist) / (2 * 0.06 * 0.06));
      const wall = side < 0 ? WINDOW.f(x, y, z) < 0.05 : false;
      // A soft undulation over the lobules, on top of the cut.
      const bump = 0.022 * (smoothNoise3(x * 2.1 + 5, y * 2.1, z * 2.1) - 0.5);
      // On the window's cut face a fissure is only a line: a groove there tears the rim.
      const cut = wall ? bump : 0.2 * narrow + 0.03 * Math.exp(-(dist * dist) / (2 * 0.16 * 0.16)) + bump;
      P.setXYZ(i, x - nx * cut, y - ny * cut, z - nz * cut);

      let tone;
      const o = obl(x, y, z, side);
      if (o < 0) tone = LOBES.lower;
      else if (side < 0 && hor(x, y, z) < 0) tone = LOBES.middle;
      else tone = LOBES.upper;
      const rgb = [tone[0], tone[1], tone[2]];
      const big = smoothNoise3(x * 1.3 + 2, y * 1.3, z * 1.3 + side);
      const small = smoothNoise3(x * 3.8 + 7, y * 3.8, z * 3.8);
      if (wall) {
        // The cut face of a lung is spongy: dark, and full of small openings.
        mixInto(rgb, TISSUE_SECTION, 0.82);
        const pores = 0.72 + 0.5 * smoothNoise3(x * 5.2, y * 5.2 + 3, z * 5.2);
        rgb[0] *= pores; rgb[1] *= pores; rgb[2] *= pores;
      } else {
        const mott = 0.82 + 0.26 * big + 0.12 * small;
        rgb[0] *= mott; rgb[1] *= mott * (0.96 + 0.05 * big); rgb[2] *= mott;
      }
      const shade = 1 - 0.8 * narrow;
      col.setXYZ(i, rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
      uv.setXY(i, (x + z * 0.62) * 2.2, (y + z * 0.37) * 2.2);
    }
    relaxMesh(g, 1, 0.4);
    g.computeVertexNormals();
    return g;
  };

  const parts = [
    { geometry: dressed(rightSculpt, -1), keepColor: true },
    { geometry: dressed(leftSculpt, 1), keepColor: true },
  ];

  // --- The windpipe -----------------------------------------------------------------------
  const AIRWAY = 0xe7bfae;
  const CARTILAGE = 0xeef0e6;
  const TOP = 8.0;
  const CARINA = [0, 6.32, 0.02];
  const RIGHT_HILUM = [-1.28, 5.08, 0.12];
  const LEFT_HILUM = [1.5, 5.28, 0.05];
  parts.push({ geometry: tube([[0, TOP - 1.0, 0.02], [0, 6.75, 0.02], CARINA], [0.3, 0.3, 0.32], { sides: 24, steps: 10, round: 2 }), color: AIRWAY });
  // The right main bronchus is the wider, shorter and steeper of the two, which is why swallowed
  // things usually end up on that side.
  const rightMain = [CARINA, [-0.6, 5.72, 0.06], RIGHT_HILUM];
  const leftMain = [CARINA, [0.72, 5.86, 0.04], LEFT_HILUM];
  parts.push({ geometry: tube(rightMain, [0.28, 0.25, 0.22], { sides: 18, steps: 12, round: 2 }), color: AIRWAY });
  parts.push({ geometry: tube(leftMain, [0.26, 0.2, 0.18], { sides: 18, steps: 12, round: 2 }), color: AIRWAY });

  // C-shaped cartilage rings. The gap is at the back, where the windpipe lies against the gullet,
  // and each ring is sunk a little into the tube so it stands proud without any daylight under it.
  const ring = (centre, axis, R, r, gap) => {
    const a = new THREE.Vector3(...axis).normalize();
    // The ring's zero bearing points to the front.
    const back = new THREE.Vector3(0, 0, -1);
    back.addScaledVector(a, -back.dot(a)).normalize();
    const side = new THREE.Vector3().crossVectors(a, back);
    const pts = [];
    const segs = 18;
    for (let i = 0; i <= segs; i++) {
      const t = gap + (i / segs) * (Math.PI * 2 - gap * 2);
      pts.push([
        centre[0] + (back.x * Math.cos(t) + side.x * Math.sin(t)) * R,
        centre[1] + (back.y * Math.cos(t) + side.y * Math.sin(t)) * R,
        centre[2] + (back.z * Math.cos(t) + side.z * Math.sin(t)) * R,
      ]);
    }
    parts.push({ geometry: tube(pts, r, { sides: 7, steps: segs, round: 1, section: () => [0.72, 1.12], frame: (t, p) => [p.x - centre[0], p.y - centre[1], p.z - centre[2]] }), color: CARTILAGE });
  };
  for (let y = TOP - 0.16; y > 6.6; y -= 0.22) ring([0, y, 0.02], [0, 1, 0], 0.305, 0.062, 0.48);
  const ringsOn = (path, r0, r1, spacing) => {
    const curve = new THREE.CatmullRomCurve3(path.map((q) => new THREE.Vector3(...q)));
    const len = curve.getLength();
    const count = Math.floor((len - 0.1) / spacing);
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const q = curve.getPointAt(t);
      const a = curve.getTangentAt(t);
      ring([q.x, q.y, q.z], [a.x, a.y, a.z], mix(r0, r1, t), 0.05, 0.48);
    }
  };
  ringsOn(rightMain, 0.28, 0.22, 0.2);
  ringsOn(leftMain, 0.26, 0.18, 0.2);
  vesselMouth(parts, [0, TOP, 0.02], [0, 1, 0], 0.3, AIRWAY, 0x3a1518, { depth: 0.58, wall: 0.06, segments: 26 });

  // --- The tree inside the window ---------------------------------------------------------
  const rightBody = body(-1, 1);
  // Inside the window, and behind where the front of the lung was, so nothing stands proud of it.
  const inside = (q) => WINDOW.f(q[0], q[1], q[2]) < -0.05 && rightBody.f(q[0], q[1], q[2]) < -0.16;
  const BRONCHUS = 0xf3e6c8;
  const ARTERY = 0x3a62d0;
  const PVEIN = 0xd8333a;
  const SAC = 0xf7b7bc;
  const SIDES = [12, 10, 8, 7, 6, 5];
  const RADII = [0.125, 0.09, 0.066, 0.048, 0.034, 0.024];
  const LENGTH = [0.62, 0.56, 0.46, 0.36, 0.28, 0.22];
  const LEVELS = 6;
  const dirTo = (a, b) => new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
  const addScaled = (a, d, k) => [a[0] + d.x * k, a[1] + d.y * k, a[2] + d.z * k];
  const toCentre = [-1.86, 3.84, 0.86];
  const grow = (start, dir, level, artery) => {
    const dirNow = dir.clone();
    // Each branch is steered back toward the middle if it is about to leave the window.
    const len = LENGTH[level] * (0.82 + rng() * 0.36);
    let end = addScaled(start, dirNow, len);
    for (let tries = 0; tries < 6 && !inside(end); tries++) {
      dirNow.lerp(dirTo(start, toCentre), 0.45).normalize();
      end = addScaled(start, dirNow, len * (1 - tries * 0.08));
    }
    const r0 = RADII[level]; const r1 = RADII[Math.min(LEVELS - 1, level + 1)] * 1.05;
    const bow = len * 0.14;
    const mid = [(start[0] + end[0]) / 2 + (rng() - 0.5) * bow, (start[1] + end[1]) / 2 + (rng() - 0.5) * bow, (start[2] + end[2]) / 2 + (rng() - 0.5) * bow];
    parts.push({ geometry: tube([start, mid, end], [r0, (r0 + r1) / 2, r1], { sides: SIDES[level], steps: level < 3 ? 5 : 3, round: 1 }), color: BRONCHUS });
    // The artery runs right beside its airway at every level, the arrangement the eye can check.
    let arteryEnd = artery;
    if (artery && level < 4) {
      const off = new THREE.Vector3(0.4 * (level % 2 ? 1 : -1), 0.3, 0.8);
      off.addScaledVector(dirNow, -off.dot(dirNow)).normalize();
      arteryEnd = addScaled(end, off, r1 * 1.55);
      const ar0 = r0 * 0.66; const ar1 = r1 * 0.66;
      parts.push({ geometry: tube([artery, [mid[0] + off.x * r0 * 1.5, mid[1] + off.y * r0 * 1.5, mid[2] + off.z * r0 * 1.5], arteryEnd], [ar0, (ar0 + ar1) / 2, ar1], { sides: Math.max(5, SIDES[level] - 2), steps: 3, round: 1 }), color: ARTERY });
    }
    if (level >= LEVELS - 1) {
      // A branch ends in a cluster of air sacs: far bigger than life, and the card says so.
      parts.push({ geometry: new THREE.SphereGeometry(0.046, 7, 5), color: SAC, position: end });
      return;
    }
    const spread = 0.44 + rng() * 0.2;
    const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    axis.addScaledVector(dirNow, -axis.dot(dirNow)).normalize();
    const a = dirNow.clone().applyAxisAngle(axis, spread);
    const b = dirNow.clone().applyAxisAngle(axis, -spread * (0.8 + rng() * 0.4));
    grow(end, a, level + 1, arteryEnd);
    grow(end, b, level + 1, arteryEnd);
  };
  const H = [-1.5, 4.82, 0.52];
  parts.push({ geometry: tube([RIGHT_HILUM, [-1.42, 4.98, 0.32], H], [0.2, 0.17, 0.15], { sides: 14, steps: 6, round: 1 }), color: BRONCHUS });
  const artH = [-1.28, 4.72, 0.62];
  // The pulmonary artery's stump comes in from the midline, beside the bronchus.
  const PA_RIGHT = [-0.82, 4.86, 0.42];
  parts.push({ geometry: tube([PA_RIGHT, [-1.08, 4.82, 0.52], artH], [0.16, 0.15, 0.12], { sides: 12, steps: 6, round: 1 }), color: ARTERY });
  grow(H, new THREE.Vector3(-0.3, 0.85, 0.42).normalize(), 1, artH); // upper lobe
  const inter = [-1.72, 4.1, 0.78];
  parts.push({ geometry: tube([H, [-1.62, 4.48, 0.66], inter], [0.14, 0.12, 0.105], { sides: 12, steps: 5, round: 1 }), color: BRONCHUS });
  const artInter = [-1.48, 4.05, 0.92];
  parts.push({ geometry: tube([artH, [-1.38, 4.4, 0.76], artInter], [0.11, 0.1, 0.09], { sides: 10, steps: 5, round: 1 }), color: ARTERY });
  grow(inter, new THREE.Vector3(-0.6, -0.05, 0.6).normalize(), 1, artInter); // middle lobe
  grow(inter, new THREE.Vector3(-0.1, -0.95, 0.15).normalize(), 1, artInter); // lower lobe

  // The pulmonary veins return separately, in the gaps between the branches.
  const veinGrow = (start, dir, level) => {
    const dirNow = dir.clone();
    const len = LENGTH[level + 1] * (0.9 + rng() * 0.4);
    let end = addScaled(start, dirNow, len);
    for (let tries = 0; tries < 6 && !inside(end); tries++) {
      dirNow.lerp(dirTo(start, toCentre), 0.45).normalize();
      end = addScaled(start, dirNow, len * (1 - tries * 0.08));
    }
    const r0 = RADII[level + 1] * 0.62; const r1 = RADII[level + 2] * 0.62;
    const bow = len * 0.22;
    const midV = [(start[0] + end[0]) / 2 + (rng() - 0.5) * bow, (start[1] + end[1]) / 2 + (rng() - 0.5) * bow, (start[2] + end[2]) / 2 + (rng() - 0.5) * bow];
    parts.push({ geometry: tube([start, midV, end], [r0, (r0 + r1) / 2, r1], { sides: Math.max(5, SIDES[level + 1] - 2), steps: 4, round: 1 }), color: PVEIN });
    if (level >= 3) return;
    const axis = new THREE.Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5);
    axis.addScaledVector(dirNow, -axis.dot(dirNow)).normalize();
    veinGrow(end, dirNow.clone().applyAxisAngle(axis, 0.5), level + 1);
    veinGrow(end, dirNow.clone().applyAxisAngle(axis, -0.5), level + 1);
  };
  const PV_ROOT = [-1.2, 4.32, 0.82];
  veinGrow(PV_ROOT, new THREE.Vector3(-0.72, 0.42, 0.38).normalize(), 0);
  veinGrow(PV_ROOT, new THREE.Vector3(-0.5, -0.78, 0.25).normalize(), 0);

  // --- The stumps between the lungs -------------------------------------------------------
  // The great vessels stop where the heart would be, with their mouths showing.
  const stump = (points, r0, r1, color, lumen) => {
    const a = points[points.length - 2]; const b = points[points.length - 1];
    const d = dirTo(a, b);
    const short = [...points.slice(0, -1), addScaled(b, d, -(mouthDepth(r1) + r1 * 0.45))];
    parts.push({ geometry: tube(short, [r0, r1], { sides: 20, steps: 8, round: 1 }), color });
    vesselMouth(parts, b, [d.x, d.y, d.z], r1, color, lumen, { segments: 20, wall: 0.045 });
  };
  // One pulmonary trunk dividing into a right and a left artery, each running into its own lung.
  parts.push({ geometry: tube([[-1.0, 4.86, 0.42], [-0.34, 4.96, 0.5], [0.04, 5.0, 0.52], [0.9, 5.02, 0.38], [1.75, 4.9, 0.18]], [0.17, 0.2, 0.24, 0.19, 0.17], { sides: 16, steps: 22, round: 1 }), color: ARTERY });
  stump([[0.02, 5.02, 0.46], [0.08, 4.72, 0.82], [0.12, 4.28, 1.12]], 0.28, 0.27, ARTERY, 0x0e1a44);
  stump([[-1.2, 4.32, 0.82], [-0.82, 4.28, 0.9], [-0.36, 4.18, 0.98]], 0.14, 0.14, PVEIN, 0x430a0e);
  stump([[-1.5, 3.92, 0.5], [-0.92, 3.86, 0.62], [-0.36, 3.74, 0.72]], 0.14, 0.14, PVEIN, 0x430a0e);
  stump([[1.75, 4.42, 0.2], [1.2, 4.4, 0.36], [0.62, 4.3, 0.58]], 0.14, 0.14, PVEIN, 0x430a0e);
  stump([[1.75, 3.98, 0.1], [1.2, 3.92, 0.26], [0.62, 3.8, 0.46]], 0.14, 0.14, PVEIN, 0x430a0e);

  // --- The diaphragm and the stand --------------------------------------------------------
  // The lungs rest on the dome they sit on in life, slightly sunk into it, and that is what holds
  // them up.
  const d = new Sculpt(0.15);
  const MUSCLE = lin(0xa8483e);
  d.add(ellipsoidP([-1.72, 0.66, -0.05], [1.92, 1.6, 2.02]), MUSCLE);
  d.add(ellipsoidP([1.72, 0.46, -0.05], [1.88, 1.6, 2.0]), MUSCLE, { k: 0.5 });
  d.sub({ box: [-5, -1.5, -4, 5, 1.1, 4], f: (x, y) => y - 1.1 }, null, { k: 0.34 });
  const dTint = (x, y, z, nx, ny, nz, rgb) => {
    // The central tendon is the pale middle of the sheet, and the muscle runs out from it in rays.
    const r = Math.hypot(x, z * 0.9);
    const a = Math.atan2(z, x);
    const ray = 0.86 + 0.24 * Math.abs(Math.sin(a * 24));
    rgb[0] *= ray; rgb[1] *= ray; rgb[2] *= ray;
    mixInto(rgb, lin(0xe4d7c4), (1 - sstep(r, 0.5, 0.95)) * 0.9);
  };
  parts.push({ geometry: polygonize(d, { tint: dTint }), keepColor: true });

  const root = new THREE.Group();
  root.name = 'human-lungs';
  root.add(organMesh(parts, { roughness: 0.5, metalness: 0, bumpMap: grainBump(31, { dots: 2600, max: 2 }), bumpScale: 0.3 }));
  const stand = [];
  standBase(stand, 2.1, { top: 0.36, collarR: 0.26 });
  stand.push({ geometry: lathe([[0, 0.3], [0.2, 0.3], [0.17, 1.0], [0.17, 1.4], [0, 1.4]], 22), color: 0xb08d4e });
  root.add(organMesh(stand, { roughness: 0.42, metalness: 0.25 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Leopard frog
// ---------------------------------------------------------------------------------------------

// Crouched and sitting, facing +Z. The legs are unioned into the body as one field, which is what
// makes the thigh flow out of the haunch rather than stand against it.
//
// THE SPOTS ARE VERTEX COLOUR AND NOT A MAP, which goes against this project's usual advice for a
// good reason: at this cell size the mesh is a third of an inch on a four-foot frog, a vertex every
// few pixels from six feet, and a spot's soft edge is what frog skin has. The rule that a tint can
// only be as detailed as its mesh still binds, and it is why each pale halo is at least three cells
// wide, and why the ramp at each spot's edge is wider than one.
function leopardFrog() {
  const c = 0.034;
  const BACK = lin(0x6f9440);
  const BELLY = lin(0xeee7cb);
  const SKIN = BACK;
  const s = new Sculpt(c);
  const HEAD_Y = -0.18;

  // The body is broad, and rises from the rump to the shoulders with the head tipped up a little.
  s.add(ellipsoidP([0, 0.72, -0.92], [0.56, 0.42, 0.72], [-0.26, 0, 0]), SKIN);
  s.add(ellipsoidP([0, 0.9, -0.18], [0.58, 0.5, 0.74], [-0.28, 0, 0]), SKIN, { k: 0.3 });
  s.add(ellipsoidP([0, 1.06, 0.42], [0.56, 0.42, 0.56], [-0.16, 0, 0]), SKIN, { k: 0.26 });
  // The head: a broad flat wedge running to a pointed snout. Its width is what makes it a frog.
  s.add(ellipsoidP([0, 1.38 + HEAD_Y, 0.98], [0.54, 0.26, 0.62], [0.02, 0, 0]), SKIN, { k: 0.18 });
  s.add(ellipsoidP([0, 1.3 + HEAD_Y, 1.5], [0.26, 0.15, 0.42], [0.06, 0, 0]), SKIN, { k: 0.2 });
  // The lower jaw and the throat, pale, slung just inside the line of the head.
  s.add(ellipsoidP([0, 1.16 + HEAD_Y, 1.04], [0.43, 0.13, 0.6], [0.12, 0, 0]), BELLY, { k: 0.1, ck: 0.06 });
  // Eye turrets with a heavy upper lid, which the eyeball then sits under.
  const EYE = (side) => [side * 0.415, 1.56 + HEAD_Y, 1.0];
  for (const side of [1, -1]) {
    s.add(ellipsoidP([side * 0.33, 1.5 + HEAD_Y, 1.0], [0.16, 0.14, 0.2]), SKIN, { k: 0.1 });
    s.add(ellipsoidP([side * 0.39, 1.635 + HEAD_Y, 0.99], [0.12, 0.04, 0.19], [0, 0, side * -0.42]), SKIN, { k: 0.05 });
  }
  const headField = s.snapshot();

  // A hind leg folded along the flank: thigh forward and out from the hip, knee forward beside the
  // shoulder, shank back to the ankle at the rump, foot forward along the ground.
  const hindLeg = (side) => {
    const hip = [side * 0.38, 0.66, -1.12];
    const knee = [side * 1.02, 0.52, 0.16];
    const ankle = [side * 0.92, 0.2, -1.32];
    const midfoot = [side * 1.02, 0.11, -0.52];
    const toeRoot = [side * 1.12, 0.08, -0.02];
    s.add(curveP([hip, [side * 0.74, 0.7, -0.52], knee], [0.34, 0.31, 0.18], 12), SKIN, { k: 0.2 });
    s.add(curveP([knee, [side * 1.14, 0.44, -0.56], ankle], [0.18, 0.2, 0.1], 12), SKIN, { k: 0.05 });
    s.add(curveP([ankle, [side * 0.98, 0.14, -0.9], midfoot, toeRoot], [0.1, 0.095, 0.09, 0.1], 12), SKIN, { k: 0.04 });
  };
  hindLeg(1);
  hindLeg(-1);

  // The arm: down from the shoulder, with a bent elbow, and in to a splayed, turned-in hand.
  const armLeg = (side) => {
    const shoulder = [side * 0.48, 0.92, 0.58];
    const elbow = [side * 0.76, 0.5, 0.62];
    const wrist = [side * 0.6, 0.1, 0.96];
    s.add(curveP([shoulder, [side * 0.68, 0.72, 0.56], elbow], [0.15, 0.13, 0.095], 8), SKIN, { k: 0.14 });
    s.add(curveP([elbow, [side * 0.7, 0.28, 0.8], wrist], [0.095, 0.085, 0.07], 8), SKIN, { k: 0.04 });
  };
  armLeg(1);
  armLeg(-1);

  // --- Surface features: ridges on the back, the drum, the mouth ---------------------------
  const bodyField = s.snapshot();
  // The dorsolateral folds are the leopard frog's own mark: a raised pale line from behind the eye
  // to the groin, on each side. Their path asks the body where its surface is.
  for (const side of [1, -1]) {
    const path = pathOn(bodyField, [
      [side * 0.32, 1.34, 0.76], [side * 0.38, 1.32, 0.3], [side * 0.42, 1.1, -0.2], [side * 0.4, 0.96, -0.62], [side * 0.32, 0.9, -1.02], [side * 0.26, 0.82, -1.36],
    ], 20);
    s.add(segsP(path, path.map((_, i) => mix(0.036, 0.026, i / 20))), lin(0xb9a96a), { k: 0.05, ck: 0.022 });
  }

  // The mouth is a long groove that follows the jaw back to under the drum.
  const mouthPath = [];
  for (let i = 0; i <= 24; i++) {
    const a = -1 + 2 * (i / 24);
    const z = mix(1.9, 0.56, Math.abs(a) ** 1.2);
    const x = a * mix(0.0, 0.54, Math.min(1, Math.abs(a) ** 0.72));
    mouthPath.push(onSurface(headField, [x, 1.25 + HEAD_Y, z], 0, 8));
  }
  s.sub(segsP(mouthPath, mouthPath.map(() => 0.024)), lin(0x2a2418), { k: 0.03, ck: 0.03 });

  // Nostrils.
  for (const side of [1, -1]) {
    s.sub(sphereP(onSurface(headField, [side * 0.1, 1.44 + HEAD_Y, 1.74]), 0.03), lin(0x201a10), { k: 0.012, ck: 0.015 });
  }

  // The tympanum: a shallow round drum behind the eye, in a low rim.
  const drums = [1, -1].map((side) => onSurface(headField, [side * 0.53, 1.42 + HEAD_Y, 0.68]));
  const DRUM_R = 0.14;
  drums.forEach((d) => {
    const n = fieldNormal(headField, d);
    s.add(torusP(d, n, DRUM_R, 0.018), lin(0x75663a), { k: 0.03, ck: 0.02 });
    s.sub(sphereP([d[0] + n[0] * 0.42, d[1] + n[1] * 0.42, d[2] + n[2] * 0.42], 0.43), null, { k: 0.02 });
  });

  // The skin: a broad low undulation of warts and folds, applied to the whole of it.
  s.map((d, x, y, z) => {
    if (d > 0.1 || d < -0.1) return d;
    return d + 0.01 * Math.sin(x * 11 + y * 4) * Math.sin(z * 10 + y * 6);
  }, [-2.5, 0.3, -2.5, 2.5, 3, 2.5]);

  // --- The spots ---------------------------------------------------------------------------
  // Scattered round the back from a seeded list, on the surface, with no two overlapping. Sizes
  // vary by a factor of two and no two are the same shape, because real ones are neither.
  const spotRng = seededRandom(2281);
  const spots = [];
  const HALO_W = 0.056;
  const tryAdd = (p, r) => {
    for (const q of spots) if (Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]) < q.r + r + HALO_W * 2) return false;
    spots.push({ x: p[0], y: p[1], z: p[2], r, ex: 0.9 + spotRng() * 0.3, ez: 0.82 + spotRng() * 0.5, wob: spotRng() * 6 });
    return true;
  };
  // Big ones between the folds, in two loose rows, then a scatter of smaller ones on the flanks.
  for (let i = 0; i < 160; i++) {
    const z = mix(-1.35, 0.62, spotRng());
    const x = (spotRng() * 2 - 1) * mix(0.34, 0.26, clamp01((z + 1.3) / 2));
    const p = onSurface(bodyField, [x, 2, z], 0, 8);
    if (p[1] > 0.55) tryAdd(p, 0.09 + spotRng() * spotRng() * 0.13);
  }
  for (let i = 0; i < 260; i++) {
    const side = spotRng() > 0.5 ? 1 : -1;
    const z = mix(-1.0, 0.55, spotRng());
    const y = mix(0.72, 1.12, spotRng());
    const p = onSurface(bodyField, [side * 0.58, y, z], 0, 8);
    const ny = fieldNormal(bodyField, p)[1];
    if (Math.abs(p[0]) > 0.42 && Math.abs(p[0]) < 0.8 && ny > -0.25) tryAdd(p, 0.07 + spotRng() * 0.07);
  }
  // Head: one on the snout, one between the eyes.
  tryAdd(onSurface(bodyField, [0, 2, 1.44], 0, 8), 0.06);
  tryAdd(onSurface(bodyField, [0, 2, 0.95], 0, 8), 0.075);

  // Dark bars across the hind legs and forearms, each on the limb's own surface.
  const barLine = (a, b, n, r, up) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = [mix(a[0], b[0], t), mix(a[1], b[1], t) + up[1], mix(a[2], b[2], t) + up[2]];
      const q = onSurface(bodyField, [p[0] + up[0], p[1], p[2]], 0, 10);
      spots.push({ x: q[0], y: q[1], z: q[2], r, ex: 1.5, ez: 0.5, wob: spotRng() * 6, bar: 1 });
    }
  };
  for (const side of [1, -1]) {
    barLine([side * 0.56, 0.72, -0.82], [side * 1.0, 0.58, 0.08], 4, 0.14, [side * 0.05, 0.6, 0]);
    barLine([side * 1.06, 0.48, -0.1], [side * 1.0, 0.3, -1.1], 5, 0.11, [side * 0.4, 0.5, 0]);
    barLine([side * 0.72, 0.42, 0.68], [side * 0.62, 0.16, 0.92], 2, 0.07, [side * 0.5, 0.05, 0.2]);
  }

  const DARK = lin(0x2a2f18);
  const HALO = lin(0xc4cb90);
  const FLANK = lin(0x8a9c5a);
  const BACK2 = lin(0x5d8038);
  const BRONZE = lin(0x8a7d3e);
  const TYMPANUM = lin(0x86703f);
  // A small grid over the spots, so a vertex only asks the few near it.
  const GRID = 0.5;
  const buckets = new Map();
  spots.forEach((q) => {
    const reach = q.r * 1.6 + 0.12;
    for (let i = Math.floor((q.x - reach) / GRID); i <= Math.floor((q.x + reach) / GRID); i++) {
      for (let j = Math.floor((q.y - reach) / GRID); j <= Math.floor((q.y + reach) / GRID); j++) {
        for (let k = Math.floor((q.z - reach) / GRID); k <= Math.floor((q.z + reach) / GRID); k++) {
          const key = `${i},${j},${k}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(q);
        }
      }
    }
  });
  const spotD = (q, x, y, z) => {
    const dx = (x - q.x) / q.ex; const dy = y - q.y; const dz = (z - q.z) / q.ez;
    const edge = q.r * (1 + 0.07 * Math.sin(Math.atan2(dz, dx) * 3 + q.wob));
    return Math.hypot(dx, dy, dz) - edge;
  };
  const nearestSpot = (x, y, z) => {
    const list = buckets.get(`${Math.floor(x / GRID)},${Math.floor(y / GRID)},${Math.floor(z / GRID)}`);
    if (!list) return null;
    let best = null; let bestD = 1e9;
    for (const q of list) {
      const d = spotD(q, x, y, z);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best ? { q: best, d: bestD } : null;
  };
  // What a vertex near a painted edge should slide onto: the spot's edge or its halo's.
  const snap = (x, y, z) => {
    let best = 1e9;
    const n = nearestSpot(x, y, z);
    if (n) {
      const a = n.d; const b = n.d - HALO_W;
      best = n.q.bar || Math.abs(a) < Math.abs(b) ? a : b;
    }
    for (const dr of drums) {
      const dd = Math.hypot(x - dr[0], y - dr[1], z - dr[2]) - DRUM_R * 0.96;
      if (Math.abs(dd) < Math.abs(best)) best = dd;
    }
    return best;
  };
  const tint = (x, y, z, nx, ny, nz, rgb) => {
    // Ridges and the mouth keep what they were painted; everything green is repainted here.
    const isSkin = Math.abs(rgb[0] - BACK[0]) < 0.08 && Math.abs(rgb[1] - BACK[1]) < 0.08 && Math.abs(rgb[2] - BACK[2]) < 0.08;
    if (!isSkin) return;
    const big = smoothNoise3(x * 2 + 3, y * 2, z * 2);
    const fine = smoothNoise3(x * 4.4, y * 4.4 + 2, z * 4.4);
    // The back is green with bronze patches, paling down the flank.
    const bronze = sstep(big, 0.5, 0.76) * 0.62;
    rgb[0] = mix(BACK2[0], BRONZE[0], bronze);
    rgb[1] = mix(BACK2[1], BRONZE[1], bronze);
    rgb[2] = mix(BACK2[2], BRONZE[2], bronze);
    mixInto(rgb, FLANK, sstep(1 - ny, 0.5, 1.15) * 0.65);
    const m = 0.9 + 0.2 * fine;
    rgb[0] *= m; rgb[1] *= m; rgb[2] *= m;
    const n = nearestSpot(x, y, z);
    if (n) {
      if (!n.q.bar) mixInto(rgb, HALO, (1 - sstep(n.d, HALO_W - 0.012, HALO_W + 0.012)) * 0.8);
      mixInto(rgb, DARK, 1 - sstep(n.d, -0.012, 0.012));
    }
    for (const dr of drums) {
      const dd = Math.hypot(x - dr[0], y - dr[1], z - dr[2]) - DRUM_R * 0.96;
      mixInto(rgb, TYMPANUM, 1 - sstep(dd, -0.012, 0.012));
    }
    // A pale underside, with a soft freckled edge, and only where the surface really faces down.
    mixInto(rgb, BELLY, (1 - sstep(ny, -0.62, -0.14)) * (0.82 + 0.18 * sstep(fine, 0.35, 0.6)) * (1 - sstep(y, 1.12, 1.2)));
  };

  const parts = [{ geometry: polygonize(s, { tint, snap, uvScale: 3.2, extraReach: 0.05 }), keepColor: true }];

  // --- Toes ---------------------------------------------------------------------------------
  // Far too thin for the field, so they are analytic: closed tubes rooted inside the foot, with a
  // slim closed web between each pair of hind toes.
  const TOE = 0x7c8a50;
  const WEB = 0x9ea570;
  const toeTube = (from, points, r0, r1) => {
    parts.push({ geometry: tube([from, ...points], [r0, ...points.map((_, i) => mix(r0, r1, (i + 1) / points.length))], { sides: 7, steps: 8, round: 2 }), color: TOE });
  };
  for (const side of [1, -1]) {
    const root = [side * 1.12, 0.07, -0.02];
    // Five toes, the fourth the longest: the arrangement every frog has.
    const lengths = [0.34, 0.5, 0.74, 1.06, 0.64];
    const spreads = [-0.62, -0.32, -0.02, 0.26, 0.58];
    const tips = [];
    for (let i = 0; i < 5; i++) {
      const yaw = (spreads[i] + 0.05) * side;
      const dx = Math.sin(yaw); const dz = Math.cos(yaw);
      const L = lengths[i];
      toeTube(root, [[root[0] + dx * L * 0.55, 0.062, root[2] + dz * L * 0.55], [root[0] + dx * L, 0.052, root[2] + dz * L]], 0.042, 0.03);
      parts.push({ geometry: new THREE.SphereGeometry(0.033, 8, 6), color: TOE, position: [root[0] + dx * L, 0.052, root[2] + dz * L] });
      tips.push({ dx, dz, L });
    }
    // The web is a real solid, lifted to the toes' own height, reaching about two thirds along.
    for (let i = 0; i < 4; i++) {
      const a = tips[i]; const b = tips[i + 1];
      parts.push({
        geometry: solidSurface({
          nu: 8, nv: 5,
          point: (u, v) => {
            const ra = a.L * 0.97; const rb = b.L * 0.97;
            const edge = mix(ra, rb, u) * mix(1, 0.62, Math.sin(u * Math.PI));
            const dx = mix(a.dx, b.dx, u); const dz = mix(a.dz, b.dz, u);
            const r = edge * v;
            return [root[0] + dx * r, 0.058, root[2] + dz * r];
          },
          // Thinning to nothing at the free edge, which is what a web does, and which leaves no rim.
          thick: (u, v) => 0.012 * (1 - v ** 5),
          axis: [0, 1, 0],
        }),
        color: WEB,
      });
    }
    // The hand: four slim fingers, no web, turned in.
    const wrist = [side * 0.6, 0.075, 0.96];
    const fingers = [[-0.42, 0.34], [-0.05, 0.44], [0.32, 0.4], [0.72, 0.26]];
    for (const [a, L] of fingers) {
      const yaw = (a - 0.18) * side;
      const tip = [wrist[0] + Math.sin(yaw) * L, 0.04, wrist[2] + Math.cos(yaw) * L];
      toeTube(wrist, [[wrist[0] + Math.sin(yaw) * L * 0.5, 0.055, wrist[2] + Math.cos(yaw) * L * 0.5], tip], 0.042, 0.03);
      parts.push({ geometry: new THREE.SphereGeometry(0.034, 8, 6), color: TOE, position: tip });
    }
  }

  const root = new THREE.Group();
  root.name = 'leopard-frog';
  const body = mergeParts(parts);

  // The eyes are their own mesh, gold with a horizontal black pupil, since that is a painting and
  // the rest of the frog is not. Each sphere is sunk into its turret under the lid.
  const EYE_R = 0.158;
  const eyeGeo = (side) => {
    const g = new THREE.SphereGeometry(EYE_R, 24, 16);
    const gaze = new THREE.Vector3(side * 0.86, 0.34, 0.36).normalize();
    const flatUp = new THREE.Vector3(0, 1, 0).addScaledVector(gaze, -gaze.y).normalize();
    const right = new THREE.Vector3().crossVectors(flatUp, gaze);
    const P = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      uv.setXY(i, 0.5 + P.getX(i) / (2 * EYE_R), 0.5 + P.getY(i) / (2 * EYE_R));
    }
    // A basis rather than a rotation between two vectors, so the pupil's slot lies level in the
    // world: it is horizontal on a leopard frog, and that is half of what the eye is.
    g.applyMatrix4(new THREE.Matrix4().makeBasis(right, flatUp, gaze));
    const e = EYE(side);
    g.translate(e[0], e[1], e[2]);
    return g;
  };
  const eyes = mergeParts([{ geometry: eyeGeo(1), color: 0xffffff }, { geometry: eyeGeo(-1), color: 0xffffff }]);
  const eyeMap = canvasTexture(256, 256, (ctx, w, h) => {
    // Gold, flecked, with a dark limbal ring and a wide horizontal pupil.
    const iris = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
    iris.addColorStop(0, '#f6d15a');
    iris.addColorStop(0.55, '#dca72e');
    iris.addColorStop(0.86, '#b27c20');
    iris.addColorStop(1, '#3c2410');
    ctx.fillStyle = iris;
    ctx.fillRect(0, 0, w, h);
    const flecks = seededRandom(551);
    for (let i = 0; i < 420; i++) {
      const a = flecks() * Math.PI * 2; const r = 20 + flecks() * 96;
      ctx.fillStyle = flecks() > 0.5 ? 'rgba(255,233,150,0.55)' : 'rgba(92,52,12,0.5)';
      ctx.beginPath();
      ctx.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 1 + flecks() * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#080604';
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, 58, 19, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Authored about 3.5ft long, and brought up to the four feet the card shows by scaling its
  // coordinates, never the Group, since a saved record replaces that.
  const SIZE = 4 / 3.54;
  body.scale(SIZE, SIZE, SIZE);
  eyes.scale(SIZE, SIZE, SIZE);
  root.add(mesh(body, standard({ vertexColors: true, roughness: 0.34, metalness: 0, bumpMap: grainBump(47, { dots: 1600, min: 1.2, max: 3.2 }), bumpScale: 0.28 })));
  root.add(mesh(eyes, standard({ map: eyeMap, roughness: 0.12, metalness: 0, vertexColors: true })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Human skeleton
// ---------------------------------------------------------------------------------------------

// Anatomical position, palms forward, on a classroom stand. Long bones and anything many are
// analytic closed tubes; whatever has a shape a tube cannot reach (skull, jaw, pelvis, shoulder
// blade, the ends of the long bones) is sculpted, at a cell sized to the bone.
//
// EVERY BONE TOUCHES ITS NEIGHBOUR, which is why the joints are written as shared named points
// rather than as separate placements that have to agree. Patient's left is +X. Bones built once
// on +X are reflected with mirrorX for the other side.
function humanSkeleton() {
  const parts = [];
  const rng = seededRandom(3301);
  const bone = (hex = 0xe9dfc4) => {
    // A little variation from bone to bone, the way a real articulated set differs.
    const c = new THREE.Color(hex);
    const k = 0.95 + rng() * 0.08;
    c.r *= k; c.g *= k; c.b *= k * (0.98 + rng() * 0.03);
    return c.getHex();
  };
  // Shade pits and hollows of a sculpted bone from how far they sit below its plain envelope.
  const grain = (x, y, z, nx, ny, nz, rgb) => {
    const n = 0.93 + 0.14 * smoothNoise3(x * 9 + 3, y * 9, z * 9);
    rgb[0] *= n; rgb[1] *= n * 0.995; rgb[2] *= n * 0.97;
  };
  const place = (geometry, side = 1) => {
    parts.push({ geometry: side < 0 ? mirrorX(geometry) : geometry, keepColor: true });
  };
  const paintAll = (geometry, hex) => {
    const c = lin(hex);
    return tintVertices(geometry, (x, y, z, out) => {
      const n = 0.95 + 0.1 * smoothNoise3(x * 8, y * 8, z * 8);
      out[0] = c[0] * n; out[1] = c[1] * n; out[2] = c[2] * n;
    });
  };
  const tubeBone = (points, radii, opts, side = 1, hex = 0xe9dfc4) => {
    const g = tube(points, radii, opts);
    paintAll(g, bone(hex));
    place(g, side);
    return g;
  };

  // --- The landmarks ------------------------------------------------------------------------
  const HIP = [0.33, 2.98, -0.02];
  const KNEE = [0.3, 1.62, 0.02];
  const ANKLE = [0.33, 0.42, -0.02];
  const SHOULDER = [0.62, 4.36, -0.1];
  const ELBOW = [0.74, 3.38, -0.12];
  const WRIST = [0.84, 2.62, 0.02];

  // --- The skull ----------------------------------------------------------------------------
  const skull = new Sculpt(0.027);
  const SK = lin(0xeae0c6);
  const DARK = lin(0x2e2216);
  const CY = 5.19; // the cranium's middle
  const CZ = -0.02;
  skull.add(ellipsoidP([0, CY + 0.015, CZ], [0.255, 0.255, 0.325]), SK);
  // The base of the skull, which the jaw hinge, the mastoids and the spine all attach to.
  skull.add(ellipsoidP([0, CY - 0.16, CZ - 0.075], [0.222, 0.125, 0.225]), SK, { k: 0.06 });
  // The face: brow, cheekbones, upper jaw, and the temples drawn in behind them.
  skull.add(ellipsoidP([0, CY - 0.11, CZ + 0.19], [0.215, 0.15, 0.155]), SK, { k: 0.08 });
  skull.add(ellipsoidP([0, CY - 0.28, CZ + 0.225], [0.128, 0.125, 0.11]), SK, { k: 0.05 }); // maxilla
  // The brow ridge over the two orbits.
  skull.add(curveP([[-0.19, CY - 0.095, CZ + 0.26], [0, CY - 0.08, CZ + 0.335], [0.19, CY - 0.095, CZ + 0.26]], 0.032, 10), SK, { k: 0.05 });
  for (const side of [1, -1]) {
    // The zygomatic: cheekbone, then the arch running back to the ear.
    skull.add(ellipsoidP([side * 0.16, CY - 0.235, CZ + 0.195], [0.058, 0.05, 0.058]), SK, { k: 0.05 });
    skull.add(curveP([[side * 0.185, CY - 0.235, CZ + 0.16], [side * 0.226, CY - 0.225, CZ + 0.02], [side * 0.226, CY - 0.2, CZ - 0.1]], [0.026, 0.018, 0.024], 8), SK, { k: 0.02 });
    // The mastoid, behind the ear, and the ear hole itself.
    skull.add(ellipsoidP([side * 0.218, CY - 0.24, CZ - 0.14], [0.036, 0.065, 0.04]), SK, { k: 0.05 });
  }
  // The teeth's bone: the alveolar ridge of the upper jaw, a horseshoe under the maxilla.
  const ARCH = (t, r, h) => {
    // t runs -1..1 round the arch, front at 0. Parabolic, as a dental arch is.
    const x = t * r;
    return [x, h, CZ + 0.308 - t * t * 0.19];
  };
  const alv = []; const alvR = [];
  for (let i = 0; i <= 12; i++) { alv.push(ARCH(-1 + (i / 12) * 2, 0.118, CY - 0.365)); alvR.push(0.024); }
  skull.add(segsP(alv, alvR), SK, { k: 0.04 });
  // The eye sockets: big, squared and tilted down at the outer corner, with a dark back.
  for (const side of [1, -1]) {
    skull.sub(boxP([side * 0.098, CY - 0.158, CZ + 0.34], [0.024, 0.018, 0.1], [0, side * 0.12, side * -0.2], 0.047), DARK, { k: 0.012, ck: 0.014 });
    // The ear canal.
    skull.sub(sphereP([side * 0.222, CY - 0.19, CZ - 0.07], 0.022), DARK, { k: 0.008, ck: 0.015 });
    // The temporal hollow, which is what gives a skull its waist.
    skull.sub(ellipsoidP([side * 0.31, CY - 0.1, CZ + 0.07], [0.08, 0.13, 0.13]), null, { k: 0.05 });
    // The small notch under the arch, between cheek and jaw hinge.
    skull.sub(ellipsoidP([side * 0.198, CY - 0.265, CZ + 0.04], [0.034, 0.036, 0.08]), lin(0x7a664e), { k: 0.012, ck: 0.02 });
  }
  // The nasal opening: an upside-down heart, with the bridge of the nose above it.
  skull.add(curveP([[0, CY - 0.12, CZ + 0.31], [0, CY - 0.185, CZ + 0.335]], [0.032, 0.024], 6), SK, { k: 0.03 });
  for (const side of [1, -1]) {
    skull.sub(ellipsoidP([side * 0.024, CY - 0.25, CZ + 0.325], [0.028, 0.05, 0.08], [0, 0, side * 0.2]), DARK, { k: 0.008, ck: 0.015 });
  }
  // The septum between them stays, because they are two cuts.
  // A flat underside to the skull, and the foramen magnum where the spine comes in.
  skull.sub(ellipsoidP([0, CY - 0.25, CZ - 0.13], [0.065, 0.03, 0.08]), DARK, { k: 0.01, ck: 0.02 });
  const sutures = (x, y, z, nx, ny, nz, rgb) => {
    grain(x, y, z, nx, ny, nz, rgb);
    // The coronal and sagittal sutures, the fine wandering joins between the plates of the skull.
    const coronal = Math.abs(z - (CZ + 0.08 - 0.1 * (y - CY)) + 0.008 * Math.sin(x * 60) + 0.005 * Math.sin(x * 130));
    const sagittal = Math.abs(x + 0.007 * Math.sin(z * 60)) + (z > CZ + 0.08 ? 1 : 0);
    const up = sstep(y, CY - 0.02, CY + 0.06);
    const line = Math.min(coronal, sagittal);
    const k = 1 - 0.38 * up * (1 - sstep(line, 0.004, 0.012));
    rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
  };
  place(polygonize(skull, { tint: sutures, normalH: 0.5 }));

  // The teeth: thirty-two in life, sixteen to each jaw, set along the same arch as the ridge.
  const TOOTH = 0xf4efdc;
  const teeth = (y, sign, scale) => {
    for (let i = 0; i < 16; i++) {
      const t = (i + 0.5) / 8 - 1;
      const [x, , z] = ARCH(t, 0.118 * scale, y);
      const a = Math.abs(t);
      // Incisors are chisels, canines points, molars broad and low.
      const w = a < 0.24 ? 0.0165 : a < 0.38 ? 0.016 : a < 0.62 ? 0.0165 : 0.021;
      const h = a < 0.24 ? 0.038 : a < 0.38 ? 0.044 : a < 0.62 ? 0.034 : 0.03;
      const g = new THREE.SphereGeometry(w, 6, 4);
      g.scale(1, h / w, a < 0.3 ? 0.6 : 1.1);
      g.rotateY(Math.atan2(t * 0.118 * scale, 0.2) * 0.9);
      parts.push({ geometry: g, color: TOOTH, position: [x, y + sign * h * 0.75, z] });
    }
  };
  const UPPER = CY - 0.37;
  teeth(UPPER, -1, 1);

  // The mandible: a separate bone, its two rami rising to the hinge just in front of each ear.
  const jaw = new Sculpt(0.023);
  const LOWER = UPPER - 0.088;
  const bodyPts = []; const bodyR = [];
  for (let i = 0; i <= 14; i++) {
    const t = -1 + (i / 14) * 2;
    const q = ARCH(t, 0.114, LOWER - 0.04);
    q[2] += 0.0;
    bodyPts.push(q); bodyR.push(mix(0.034, 0.029, Math.abs(t)));
  }
  jaw.add(segsP(bodyPts, bodyR), SK);
  // The chin.
  jaw.add(ellipsoidP([0, LOWER - 0.07, CZ + 0.308], [0.045, 0.032, 0.022]), SK, { k: 0.03 });
  for (const side of [1, -1]) {
    const angle = ARCH(side * 1.08, 0.114, LOWER - 0.06);
    jaw.add(curveP([angle, [side * 0.155, CY - 0.34, CZ + 0.03], [side * 0.19, CY - 0.235, CZ - 0.05]], [0.036, 0.029, 0.021], 8), SK, { k: 0.03 });
    jaw.add(curveP([[side * 0.135, LOWER - 0.03, CZ + 0.125], [side * 0.172, CY - 0.33, CZ + 0.06], [side * 0.188, CY - 0.275, CZ + 0.085]], [0.024, 0.018, 0.012], 6), SK, { k: 0.02 });
    // The hinge's knob, which sits right up against the skull.
    jaw.add(ellipsoidP([side * 0.195, CY - 0.226, CZ - 0.05], [0.028, 0.018, 0.018]), SK, { k: 0.02 });
  }
  place(polygonize(jaw, { tint: grain }));
  teeth(LOWER, 1, 0.96);

  // --- The spine ----------------------------------------------------------------------------
  // Twenty-four separate vertebrae on a real S curve, each with its body, its spine and its two
  // side wings, with a blue cartilage disc between each pair, so every one touches the next.
  const SPINE_TOP = 4.84; const SPINE_BOTTOM = 3.22;
  const spineZ = (y) => {
    // The neck curves forward, the chest back, the small of the back forward.
    const t = (y - SPINE_BOTTOM) / (SPINE_TOP - SPINE_BOTTOM);
    return -0.2 + 0.09 * Math.sin((t - 0.02) * Math.PI * 2.05 - 0.2) + 0.1 * t;
  };
  const VERTS = [];
  const COUNTS = [['L', 5], ['T', 12], ['C', 7]];
  const total = 24;
  // Heights: lumbar bigger than thoracic bigger than cervical, in proportion to real bodies.
  const heights = [];
  for (const [kind, n] of COUNTS) for (let i = 0; i < n; i++) heights.push({ kind, h: kind === 'L' ? 0.1 : kind === 'T' ? 0.068 : 0.046, r: kind === 'L' ? 0.088 : kind === 'T' ? 0.058 : 0.043 });
  const sum = heights.reduce((a, b) => a + b.h, 0);
  const SCALE = (SPINE_TOP - SPINE_BOTTOM) / sum;
  let cursor = SPINE_BOTTOM;
  for (let i = 0; i < total; i++) {
    const v = heights[i];
    const hh = v.h * SCALE;
    VERTS.push({ ...v, index: i, y: cursor + hh * 0.5, h: hh });
    cursor += hh;
  }
  // Each vertebra is analytic. The body is a waisted drum with crisp rims; the arch round the hole
  // for the spinal cord, the spinous process and the two side wings are flattened tubes, rooted in
  // one another. A sculpt at any affordable cell saws these into torn paper: they are too thin.
  const DISC = 0xa9c9d6;
  VERTS.forEach((v, i) => {
    const z = spineZ(v.y);
    const y = v.y;
    const bh = v.h * 0.36;
    const r = v.r;
    const body = lathe([[0, -bh], [r * 0.9, -bh], [r * 0.985, -bh + 0.006], [r, -bh + 0.014], [r * 0.9, 0], [r, bh - 0.014], [r * 0.985, bh - 0.006], [r * 0.9, bh], [0, bh]], 12);
    body.scale(1, 1, 0.92);
    paintAll(body, bone());
    parts.push({ geometry: body, keepColor: true, position: [0, y, z] });
    const hole = r * 0.46;
    const zc = z - r * 0.92 - hole * 0.72;
    const color = bone();
    const arch = [];
    for (let k = 0; k <= 8; k++) {
      const a = -0.4 + (k / 8) * (Math.PI + 0.8);
      arch.push([Math.cos(a) * hole * 1.08, y, zc - Math.sin(a) * hole * 1.08]);
    }
    parts.push({ geometry: tube(arch, r * 0.2, { sides: 5, steps: 6, round: 1, section: () => [1.3, 0.85] }), color });
    const sLen = v.kind === 'L' ? r * 1.1 : v.kind === 'T' ? r * 1.8 : r * 1.3;
    const sDrop = v.kind === 'T' ? v.h * 1.1 : v.kind === 'L' ? v.h * 0.12 : v.h * 0.45;
    parts.push({
      geometry: tube([[0, y, zc - hole * 0.95], [0, y - sDrop * 0.5, zc - hole - sLen * 0.55], [0, y - sDrop, zc - hole - sLen]], [r * 0.22, r * 0.18, v.kind === 'L' ? r * 0.2 : r * 0.12], {
        sides: 6, steps: 3, round: 1, section: () => [0.55, 1.25], frame: () => [1, 0, 0],
      }),
      color,
    });
    const tw = v.kind === 'L' ? r * 1.3 : v.kind === 'T' ? r * 1.5 : r * 1.3;
    for (const side of [1, -1]) {
      parts.push({
        geometry: tube([[side * hole * 0.85, y, zc + hole * 0.25], [side * (hole + tw * 0.6), y + (v.kind === 'T' ? v.h * 0.06 : 0), zc - hole * 0.1], [side * (hole + tw), y + (v.kind === 'T' ? v.h * 0.1 : 0), zc - (v.kind === 'T' ? hole * 0.5 : hole * 0.1)]], [r * 0.2, r * 0.15, r * 0.13], { sides: 5, steps: 2, round: 1 }),
        color,
      });
    }
    if (i < total - 1) {
      const n = VERTS[i + 1];
      const a = [0, v.y + bh * 0.9, spineZ(v.y + bh * 0.9)];
      const b = [0, n.y - n.h * 0.36 * 0.9, spineZ(n.y - n.h * 0.36 * 0.9)];
      parts.push({ geometry: tube([a, b], [v.r * 0.9, n.r * 0.9], { sides: 14, steps: 1, round: 0, straight: true, section: () => [1, 0.92] }), color: DISC });
    }
  });
  // The atlas: carries the skull. The skull's base sits right down on it.
  parts.push({ geometry: tube([[0, SPINE_TOP - 0.02, spineZ(SPINE_TOP) + 0.0], [0, CY - 0.24, CZ - 0.13]], [0.05, 0.05], { sides: 12, steps: 2, round: 1, straight: true }), color: bone() });

  // --- The rib cage -------------------------------------------------------------------------
  // Twelve pairs. Each rib leaves its own thoracic vertebra, sweeps back, out and round, and falls
  // as it comes forward. The first seven reach the sternum through their own cartilage, the next
  // three join the cartilage above them, and the last two float, as they do.
  const tVert = (i) => VERTS[5 + 11 - i]; // rib 0 is the top: the highest thoracic vertebra
  const RIB_W = [0.22, 0.31, 0.37, 0.415, 0.45, 0.475, 0.49, 0.495, 0.485, 0.465, 0.43, 0.39];
  const RIB_D = [0.15, 0.21, 0.25, 0.275, 0.295, 0.31, 0.315, 0.315, 0.305, 0.29, 0.265, 0.235];
  const STERN_TOP = 4.46; const STERN_LOW = 3.9;
  const sternZ = (y) => 0.17 + (STERN_TOP - y) * 0.2;
  const sternAt = (i) => {
    // The seven true ribs' cartilages meet the sternum at evenly falling points.
    const y = mix(STERN_TOP - 0.06, STERN_LOW + 0.03, i / 6);
    return [0.05, y, sternZ(y) - 0.012];
  };
  const CART = 0xcfe0d8;
  const ribEnds = [];
  const ribGeo = (i) => {
    const v = tVert(i);
    const y0 = v.y + v.h * 0.25;
    const z0 = spineZ(y0) - 0.03;
    const w = RIB_W[i]; const dp = RIB_D[i];
    const zCentre = z0 + dp * 1.04;
    const fall = 0.2 + i * 0.016;
    const pts = [];
    const n = 14;
    const reach = i < 7 ? 0.74 : i < 10 ? 0.77 : i === 10 ? 0.5 : 0.36;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const th = t * Math.PI * reach * 1.05 + 0.05;
      const drop = fall * (t * t * 0.55 + t * 0.45) * (i === 0 ? 0.55 : 1) * reach * 1.3;
      pts.push([Math.sin(th) * w, y0 - drop, zCentre - Math.cos(th) * dp]);
    }
    // Starting at the vertebra's side wing.
    pts[0] = [0.04, y0, z0 + 0.02];
    ribEnds[i] = pts[n];
    return tube(pts, pts.map((_, k) => mix(0.024, 0.026, k / n)), {
      sides: 6, steps: 13, round: 1,
      section: () => [0.42, 1.08],
      frame: (t, q) => [q.x, 0, q.z - zCentre],
    });
  };
  for (let i = 0; i < 12; i++) {
    const g = ribGeo(i);
    paintAll(g, bone());
    parts.push({ geometry: g, keepColor: true });
    parts.push({ geometry: mirrorX(g), keepColor: true });
  }
  // The costal cartilage: from each rib's end to the sternum, or to the cartilage above.
  let aboveJoin = null;
  for (let i = 0; i < 10; i++) {
    const e = ribEnds[i];
    let target;
    if (i < 7) target = sternAt(i);
    else target = aboveJoin;
    const midX = (e[0] + target[0]) / 2;
    const mid = [midX, Math.min(e[1], target[1]) - (i < 7 ? 0.018 + i * 0.008 : 0.01), (e[2] + target[2]) / 2 + 0.018];
    const g = tube([e, mid, target], [0.024, 0.024, 0.019], { sides: 6, steps: 6, round: 1, section: () => [0.5, 1.1], frame: () => [0, 0, 1] });
    parts.push({ geometry: g, color: CART });
    parts.push({ geometry: mirrorX(g), color: CART });
    aboveJoin = i >= 6 ? [mix(e[0], mid[0], 0.65), mix(e[1], mid[1], 0.65) - 0.003, mix(e[2], mid[2], 0.65)] : [mix(e[0], mid[0], 0.65), mix(e[1], mid[1], 0.65), mix(e[2], mid[2], 0.65)];
  }

  // The sternum: the handle, the blade and the small tip.
  const st = new Sculpt(0.02);
  const stPt = (y) => [0, y, sternZ(y)];
  st.add(ellipsoidP(stPt(STERN_TOP - 0.05), [0.075, 0.075, 0.018], [-0.11, 0, 0]), SK);
  st.add(curveP([stPt(STERN_TOP - 0.1), stPt(4.18), stPt(STERN_LOW + 0.02)], [0.035, 0.044, 0.038], 10), SK, { k: 0.03 });
  st.add(ellipsoidP(stPt(4.17), [0.052, 0.24, 0.022], [-0.2, 0, 0]), SK, { k: 0.02 });
  st.add(curveP([stPt(STERN_LOW + 0.02), stPt(STERN_LOW - 0.09)], [0.024, 0.008], 4), SK, { k: 0.01 });
  // The notch at the top, between the collarbones.
  st.sub(sphereP([0, STERN_TOP + 0.022, sternZ(STERN_TOP)], 0.03), null, { k: 0.01 });
  place(polygonize(st, { tint: grain }));

  // --- The shoulder girdle ------------------------------------------------------------------
  // The clavicle runs from the top of the sternum out to the point of the shoulder, in its long
  // S curve.
  const claStart = [0.05, STERN_TOP - 0.01, sternZ(STERN_TOP) - 0.005];
  const ACROMION = [SHOULDER[0] - 0.02, SHOULDER[1] + 0.09, SHOULDER[2] + 0.04];
  tubeBone([claStart, [0.22, STERN_TOP + 0.02, 0.18], [0.42, STERN_TOP + 0.05, 0.04], ACROMION], [0.03, 0.022, 0.022, 0.028], { sides: 10, steps: 16, round: 2 });
  tubeBone([[-claStart[0], claStart[1], claStart[2]], [-0.22, STERN_TOP + 0.02, 0.18], [-0.42, STERN_TOP + 0.05, 0.04], [-ACROMION[0], ACROMION[1], ACROMION[2]]], [0.03, 0.022, 0.022, 0.028], { sides: 10, steps: 16, round: 2 });

  // The shoulder blade: a thin triangular plate lying on the back of the ribs, curved to follow
  // them, with the ridge of its spine, the point of the acromion, and the rim of the socket.
  const SCAP = { top: [0.2, 4.36, -0.36], low: [0.27, 3.86, -0.38], out: [SHOULDER[0] - 0.09, SHOULDER[1] - 0.05, SHOULDER[2] - 0.03] };
  const scapBone = (side) => {
    const bits = [];
    const color = bone();
    bits.push({
      geometry: solidSurface({
        nu: 10, nv: 8,
        point: (u, v) => {
          const mx = mix(SCAP.top[0], SCAP.low[0], u); const my = mix(SCAP.top[1], SCAP.low[1], u); const mz = mix(SCAP.top[2], SCAP.low[2], u);
          const w = v ** 0.9;
          const x = mix(mx, SCAP.out[0], w); const y = mix(my, SCAP.out[1], w); const z = mix(mz, SCAP.out[2], w);
          return [x, y, z - 0.03 * Math.sin(v * Math.PI) * Math.sin(u * Math.PI)];
        },
        thick: (u, v) => 0.01 + 0.012 * (1 - Math.min(u, 1 - u, v, 1 - v) * 3 > 0 ? (1 - Math.min(u, 1 - u, v, 1 - v) * 3) : 0),
      }),
      color,
    });
    bits.push({ geometry: tube([[0.21, 4.26, -0.4], [0.32, 4.3, -0.38], [0.44, 4.37, -0.3], ACROMION], [0.012, 0.022, 0.026, 0.03], { sides: 8, steps: 10, round: 1, section: () => [1.3, 0.7] }), color });
    bits.push({ geometry: tube([[SCAP.out[0] - 0.02, SCAP.out[1] + 0.05, SCAP.out[2] - 0.02], [SHOULDER[0] - 0.12, SHOULDER[1] + 0.06, SHOULDER[2] + 0.1], [SHOULDER[0] - 0.05, SHOULDER[1] + 0.02, SHOULDER[2] + 0.13]], [0.024, 0.02, 0.018], { sides: 8, steps: 6, round: 1 }), color }); // the coracoid
    const rim = new THREE.SphereGeometry(1, 10, 7);
    rim.scale(0.032, 0.07, 0.056);
    bits.push({ geometry: rim, color, position: [SHOULDER[0] - 0.078, SHOULDER[1] - 0.03, SHOULDER[2]] });
    const merged = mergeParts(bits);
    return side < 0 ? mirrorX(merged) : merged;
  };
  parts.push({ geometry: scapBone(1), keepColor: true });
  parts.push({ geometry: scapBone(-1), keepColor: true });

  // --- The arm ------------------------------------------------------------------------------
  // The humerus: a ball at the top, turned into the socket, and the pulley at the elbow.
  const hu = new Sculpt(0.03);
  hu.add(sphereP([SHOULDER[0], SHOULDER[1], SHOULDER[2]], 0.082), SK);
  hu.add(curveP([[SHOULDER[0] + 0.03, SHOULDER[1] - 0.02, SHOULDER[2]], [mix(SHOULDER[0], ELBOW[0], 0.5), mix(SHOULDER[1], ELBOW[1], 0.5), mix(SHOULDER[2], ELBOW[2], 0.5)], [ELBOW[0], ELBOW[1] + 0.08, ELBOW[2]]], [0.06, 0.038, 0.046], 10), SK, { k: 0.05 });
  hu.add(ellipsoidP([SHOULDER[0] + 0.07, SHOULDER[1] - 0.03, SHOULDER[2] + 0.03], [0.04, 0.05, 0.04]), SK, { k: 0.04 });
  hu.add(ellipsoidP([ELBOW[0], ELBOW[1] + 0.012, ELBOW[2]], [0.092, 0.036, 0.042]), SK, { k: 0.03 });
  const hum = polygonize(hu, { tint: grain });
  place(hum); place(hum, -1);

  // Radius and ulna, side by side, with their ends touching at the elbow and the wrist. In this
  // position, palms forward, they do not cross: the radius is on the thumb's side, outermost.
  const RAD_TOP = [ELBOW[0] + 0.052, ELBOW[1] - 0.036, ELBOW[2] + 0.006];
  const ULN_TOP = [ELBOW[0] - 0.032, ELBOW[1] - 0.012, ELBOW[2] - 0.022];
  const RAD_LOW = [WRIST[0] + 0.052, WRIST[1] + 0.016, WRIST[2]];
  const ULN_LOW = [WRIST[0] - 0.05, WRIST[1] + 0.024, WRIST[2] - 0.006];
  for (const side of [1, -1]) {
    tubeBone([RAD_TOP, [mix(RAD_TOP[0], RAD_LOW[0], 0.15) + 0.006, mix(RAD_TOP[1], RAD_LOW[1], 0.15), mix(RAD_TOP[2], RAD_LOW[2], 0.15)], [mix(RAD_TOP[0], RAD_LOW[0], 0.55) + 0.022, mix(RAD_TOP[1], RAD_LOW[1], 0.55), mix(RAD_TOP[2], RAD_LOW[2], 0.55)], [RAD_LOW[0], RAD_LOW[1] + 0.09, RAD_LOW[2]], RAD_LOW], [0.032, 0.022, 0.024, 0.032, 0.05], { sides: 9, steps: 14, round: 2 }, side);
    tubeBone([ULN_TOP, [mix(ULN_TOP[0], ULN_LOW[0], 0.1), mix(ULN_TOP[1], ULN_LOW[1], 0.1), mix(ULN_TOP[2], ULN_LOW[2], 0.1) - 0.01], [mix(ULN_TOP[0], ULN_LOW[0], 0.55), mix(ULN_TOP[1], ULN_LOW[1], 0.55), mix(ULN_TOP[2], ULN_LOW[2], 0.55)], ULN_LOW], [0.044, 0.03, 0.021, 0.028], { sides: 9, steps: 12, round: 2 }, side);
  }

  // --- The hand -----------------------------------------------------------------------------
  // Eight wrist bones in two rows, five metacarpals, and fourteen finger bones: two for the thumb,
  // three for each finger. The palm faces forward, thumb out.
  const carpal = (x, y, z, r) => {
    const g = new THREE.SphereGeometry(r, 10, 7);
    g.scale(1, 0.82, 0.72);
    parts.push({ geometry: g, color: bone(), position: [WRIST[0] + x, WRIST[1] + y, WRIST[2] + z] });
    const g2 = new THREE.SphereGeometry(r, 10, 7);
    g2.scale(1, 0.82, 0.72);
    parts.push({ geometry: g2, color: bone(), position: [-(WRIST[0] + x), WRIST[1] + y, WRIST[2] + z] });
  };
  for (const [x, y, z, r] of [[-0.058, -0.004, 0, 0.03], [-0.008, -0.002, 0, 0.033], [0.05, -0.002, 0.002, 0.034], [0.09, -0.024, 0.006, 0.026], [-0.05, -0.052, 0, 0.033], [-0.002, -0.056, 0.002, 0.034], [0.044, -0.058, 0.004, 0.03], [0.085, -0.07, 0.012, 0.03]]) carpal(x, y, z, r);
  const FINGER_ROOT = [[-0.068, 0.42], [-0.024, 0.48], [0.024, 0.47], [0.064, 0.4]]; // little to index (+x is thumb side)
  const handSeg = (a, b, r0, r1, hex) => {
    for (const side of [1, -1]) {
      const A = [a[0] * side, a[1], a[2]]; const B = [b[0] * side, b[1], b[2]];
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      const g = tube([A, mid, B], [r0 * 1.2, r0 * 0.72, r1 * 1.18], { sides: 6, steps: 4, round: 1 });
      paintAll(g, hex);
      parts.push({ geometry: g, keepColor: true });
    }
  };
  const FINGER_LEN = [[0.138, 0.078, 0.052, 0.04], [0.158, 0.098, 0.064, 0.044], [0.172, 0.112, 0.07, 0.046], [0.166, 0.105, 0.066, 0.044]];
  FINGER_ROOT.forEach(([fx], f) => {
    const [L0, L1, L2, L3] = FINGER_LEN[f];
    const spreadX = fx * 0.4;
    let y = WRIST[1] - 0.09;
    let x = WRIST[0] + fx;
    let z = WRIST[2] + 0.01;
    const flex = 0.13;
    const lens = [L0, L1, L2, L3];
    const rad = [0.02, 0.016, 0.0135, 0.0115];
    for (let k = 0; k < 4; k++) {
      const dx = spreadX * lens[k] / 0.1 * 0.28;
      const nx = x + dx; const ny = y - lens[k] * Math.cos(flex * k); const nz = z + lens[k] * Math.sin(flex * k);
      handSeg([x, y, z], [nx, ny, nz], rad[k], rad[Math.min(3, k + 1)] * 0.92, bone());
      x = nx; y = ny; z = nz;
    }
  });
  // The thumb: out to the side and forward, one bone shorter.
  {
    let [x, y, z] = [WRIST[0] + 0.1, WRIST[1] - 0.075, WRIST[2] + 0.018];
    const steps = [[0.055, -0.098, 0.044, 0.021, 0.016], [0.034, -0.078, 0.028, 0.016, 0.014], [0.016, -0.06, 0.012, 0.0135, 0.0115]];
    for (const [dx, dy, dz, r0, r1] of steps) {
      handSeg([x, y, z], [x + dx, y + dy, z + dz], r0, r1, bone());
      x += dx; y += dy; z += dz;
    }
  }

  // --- The pelvis ---------------------------------------------------------------------------
  const pv = new Sculpt(0.032);
  const SAC_TOP = SPINE_BOTTOM - 0.02;
  const SZ = spineZ(SPINE_BOTTOM);
  // The sacrum: a curved wedge at the back, five fused bones, with the tail bone under it.
  const sacPts = [[0, SAC_TOP - 0.02, SZ], [0, SAC_TOP - 0.13, SZ - 0.045], [0, SAC_TOP - 0.25, SZ - 0.075], [0, SAC_TOP - 0.36, SZ - 0.04]];
  pv.add(curveP(sacPts, [0.1, 0.082, 0.056, 0.034], 10), SK);
  for (const y of [0.1, 0.17, 0.24]) {
    for (const side of [1, -1]) {
      pv.sub(sphereP([side * 0.045, SAC_TOP - y, SZ + 0.05 - y * 0.06], 0.014), lin(0x4c3f2c), { k: 0.006, ck: 0.012 });
    }
  }
  for (const side of [1, -1]) {
    // The hip bone is three fused into one: ilium, ischium and pubis.
    // The wing of the ilium, a broad curved plate flaring up and out.
    const ILIUM = [side * 0.29, HIP[1] + 0.27, HIP[2] - 0.07];
    pv.add(ellipsoidP(ILIUM, [0.24, 0.24, 0.044], [0.25, side * -0.95, side * -0.2]), SK, { k: 0.05 });
    // The iliac crest, the thickened rim you can feel with your hand on your hip.
    const crest = [];
    const wingTurn = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.25, side * -0.95, side * -0.2, 'XYZ'));
    for (let k = 0; k <= 12; k++) {
      // The rim of the plate itself, so the crest cannot stand off it.
      const a = 0.1 + (k / 12) * (Math.PI - 0.2);
      const q = new THREE.Vector3(Math.cos(a) * 0.236, Math.sin(a) * 0.236, 0).applyMatrix4(wingTurn);
      crest.push([ILIUM[0] + q.x, ILIUM[1] + q.y, ILIUM[2] + q.z]);
    }
    pv.add(segsP(crest, crest.map(() => 0.022)), SK, { k: 0.02 });
    // The joint between the ilium and the sacrum, at the back: it joins the two solidly.
    pv.add(curveP([[side * 0.16, HIP[1] + 0.24, SZ + 0.005], [side * 0.07, SAC_TOP - 0.08, SZ - 0.01]], [0.06, 0.05], 5), SK, { k: 0.04 });
    // The neck between the ilium and the socket.
    pv.add(curveP([[side * 0.3, HIP[1] + 0.15, HIP[2] - 0.01], [HIP[0] * side, HIP[1] + 0.02, HIP[2]]], [0.062, 0.078], 5), SK, { k: 0.05 });
    // Socket's bowl, which the head of the femur sits in.
    pv.add(sphereP([HIP[0] * side - side * 0.015, HIP[1], HIP[2]], 0.09), SK, { k: 0.04 });
    // The ring of pubis and ischium round the big obturator hole.
    const pub = [0.03 * side, HIP[1] - 0.06, HIP[2] + 0.17];
    const isch = [side * 0.21, HIP[1] - 0.2, HIP[2] - 0.08];
    pv.add(curveP([[HIP[0] * side - side * 0.03, HIP[1] - 0.02, HIP[2] + 0.06], [side * 0.15, HIP[1] - 0.0, HIP[2] + 0.13], pub], [0.04, 0.03, 0.034], 7), SK, { k: 0.03 });
    pv.add(curveP([pub, [side * 0.1, HIP[1] - 0.17, HIP[2] + 0.07], isch], [0.032, 0.026, 0.044], 7), SK, { k: 0.03 });
    pv.add(curveP([[HIP[0] * side, HIP[1] - 0.05, HIP[2] - 0.04], isch], [0.045, 0.04], 5), SK, { k: 0.04 });
    // The pubic symphysis: the two meet at the front on a pad of cartilage.
    pv.add(ellipsoidP([side * 0.014, HIP[1] - 0.06, HIP[2] + 0.17], [0.02, 0.05, 0.03]), SK, { k: 0.02 });
    // The socket itself.
    pv.sub(sphereP([HIP[0] * side + side * 0.05, HIP[1], HIP[2]], 0.08), null, { k: 0.012 });
  }
  place(polygonize(pv, { tint: grain }));
  // The tail bone: four little segments curling under the sacrum.
  {
    const a = [0, SAC_TOP - 0.36, SZ - 0.04];
    tubeBone([a, [0, a[1] - 0.05, a[2] + 0.02], [0, a[1] - 0.09, a[2] + 0.06]], [0.024, 0.016, 0.008], { sides: 8, steps: 6, round: 1 });
  }

  // --- The leg ------------------------------------------------------------------------------
  // The femur: the longest bone. Its ball goes into the hip, a neck angles it out, the big knob of
  // the trochanter stands on the outside, and it narrows on its way in toward the knee.
  const fe = new Sculpt(0.032);
  const GT = [HIP[0] + 0.17, HIP[1] - 0.05, HIP[2] - 0.01];
  fe.add(sphereP(HIP, 0.09), SK);
  fe.add(curveP([HIP, [HIP[0] + 0.1, HIP[1] - 0.05, HIP[2]], [HIP[0] + 0.14, HIP[1] - 0.1, HIP[2]]], [0.052, 0.046, 0.056], 6), SK, { k: 0.03 });
  fe.add(ellipsoidP(GT, [0.05, 0.075, 0.056]), SK, { k: 0.05 });
  fe.add(curveP([[GT[0] - 0.02, GT[1] - 0.04, GT[2]], [mix(GT[0], KNEE[0], 0.5) + 0.01, mix(GT[1], KNEE[1], 0.5), mix(GT[2], KNEE[2], 0.5) + 0.03], [KNEE[0], KNEE[1] + 0.14, KNEE[2]]], [0.06, 0.05, 0.058], 10), SK, { k: 0.05 });
  // Two rounded condyles at the knee, side by side, which sit on the shin.
  fe.add(ellipsoidP([KNEE[0] + 0.056, KNEE[1] + 0.05, KNEE[2] - 0.01], [0.05, 0.056, 0.08]), SK, { k: 0.05 });
  fe.add(ellipsoidP([KNEE[0] - 0.056, KNEE[1] + 0.05, KNEE[2] - 0.01], [0.05, 0.056, 0.08]), SK, { k: 0.05 });
  const fem = polygonize(fe, { tint: grain });
  place(fem); place(fem, -1);
  // The kneecap, floating in front of the joint and touching it.
  const pat = new THREE.SphereGeometry(0.05, 10, 7);
  pat.scale(1, 1.08, 0.5);
  for (const side of [1, -1]) parts.push({ geometry: pat, color: bone(), position: [side * KNEE[0], KNEE[1] + 0.05, KNEE[2] + 0.068] });

  // The tibia: a broad plateau at the knee, a three-sided shaft with a sharp shin, and the bump of
  // the inner ankle. The fibula is the slim one outside it.
  const tb = new Sculpt(0.032);
  const TIB_TOP = [KNEE[0], KNEE[1] - 0.005, KNEE[2]];
  tb.add(ellipsoidP([TIB_TOP[0], TIB_TOP[1] - 0.012, TIB_TOP[2] - 0.01], [0.125, 0.035, 0.1]), SK);
  tb.add(curveP([[TIB_TOP[0], TIB_TOP[1] - 0.03, TIB_TOP[2]], [mix(TIB_TOP[0], ANKLE[0], 0.32), mix(TIB_TOP[1], ANKLE[1], 0.32), TIB_TOP[2] + 0.016], [mix(TIB_TOP[0], ANKLE[0], 0.7), mix(TIB_TOP[1], ANKLE[1], 0.7), ANKLE[2] + 0.015], [ANKLE[0], ANKLE[1] + 0.03, ANKLE[2]]], [0.085, 0.046, 0.038, 0.052], 12), SK, { k: 0.05 });
  // The ridge of the shin, the part you bark.
  tb.add(curveP([[TIB_TOP[0] + 0.002, TIB_TOP[1] - 0.08, TIB_TOP[2] + 0.078], [mix(TIB_TOP[0], ANKLE[0], 0.4), mix(TIB_TOP[1], ANKLE[1], 0.4), TIB_TOP[2] + 0.052], [mix(TIB_TOP[0], ANKLE[0], 0.74), mix(TIB_TOP[1], ANKLE[1], 0.74), ANKLE[2] + 0.04]], [0.022, 0.015, 0.014], 8), SK, { k: 0.04 });
  tb.add(ellipsoidP([ANKLE[0] - 0.055, ANKLE[1] + 0.008, ANKLE[2]], [0.026, 0.056, 0.042]), SK, { k: 0.03 });
  const tib = polygonize(tb, { tint: grain });
  place(tib); place(tib, -1);
  const FIB_TOP = [KNEE[0] + 0.098, KNEE[1] - 0.06, KNEE[2] - 0.05];
  const FIB_LOW = [ANKLE[0] + 0.075, ANKLE[1] - 0.012, ANKLE[2] - 0.02];
  for (const side of [1, -1]) {
    tubeBone([FIB_TOP, [mix(FIB_TOP[0], FIB_LOW[0], 0.14), mix(FIB_TOP[1], FIB_LOW[1], 0.14), mix(FIB_TOP[2], FIB_LOW[2], 0.14)], [mix(FIB_TOP[0], FIB_LOW[0], 0.5), mix(FIB_TOP[1], FIB_LOW[1], 0.5), mix(FIB_TOP[2], FIB_LOW[2], 0.5)], [mix(FIB_TOP[0], FIB_LOW[0], 0.9), mix(FIB_TOP[1], FIB_LOW[1], 0.9), mix(FIB_TOP[2], FIB_LOW[2], 0.9)], FIB_LOW], [0.034, 0.019, 0.017, 0.022, 0.032], { sides: 8, steps: 12, round: 2 }, side);
  }

  // --- The foot -----------------------------------------------------------------------------
  // Seven ankle bones, five metatarsals and fourteen toe bones, turned a little outward.
  const FLOOR = 0.14;
  const out = 0.14;
  const footSpace = (x, y, z) => {
    // In foot coordinates z runs heel to toe, x out to the side, about the ankle.
    const cx = ANKLE[0] + x * Math.cos(out) + z * Math.sin(out);
    const cz = ANKLE[2] - x * Math.sin(out) + z * Math.cos(out);
    return [cx, y, cz];
  };
  const footSolid = (a, b, r0, r1, hex, sides = 6) => {
    for (const side of [1, -1]) {
      const A = [a[0] * side, a[1], a[2]]; const B = [b[0] * side, b[1], b[2]];
      const g = tube([A, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], B], [r0 * 1.15, r0 * 0.74, r1 * 1.12], { sides, steps: 3, round: 1 });
      paintAll(g, hex);
      parts.push({ geometry: g, keepColor: true });
    }
  };
  const tarsal = (x, y, z, rx, ry, rz) => {
    for (const side of [1, -1]) {
      const g = new THREE.SphereGeometry(1, 12, 8);
      g.scale(rx, ry, rz);
      const q = footSpace(x, y, z);
      parts.push({ geometry: g, color: bone(), position: [side * q[0], q[1], q[2]] });
    }
  };
  // Talus under the shin, heel bone behind and below it, then the bones of the arch.
  tarsal(0, ANKLE[1] - 0.07, 0.03, 0.068, 0.062, 0.09);
  tarsal(0.012, FLOOR + 0.08, -0.05, 0.054, 0.082, 0.115);
  tarsal(-0.026, ANKLE[1] - 0.1, 0.12, 0.05, 0.044, 0.05); // navicular
  tarsal(0.05, FLOOR + 0.07, 0.11, 0.042, 0.042, 0.06); // cuboid
  tarsal(-0.056, ANKLE[1] - 0.138, 0.178, 0.03, 0.036, 0.036);
  tarsal(-0.012, ANKLE[1] - 0.124, 0.175, 0.025, 0.034, 0.034);
  tarsal(0.018, ANKLE[1] - 0.134, 0.175, 0.022, 0.034, 0.032);
  const TOE_X = [-0.075, -0.035, 0.0, 0.035, 0.07]; // big toe first, inner
  const META = [0.2, 0.23, 0.23, 0.22, 0.2];
  const TOE_L = [[0.11, 0.08], [0.09, 0.05, 0.03], [0.08, 0.045, 0.03], [0.07, 0.04, 0.028], [0.06, 0.034, 0.026]];
  TOE_X.forEach((tx, t) => {
    const big = t === 0;
    let at = footSpace(tx * 0.8, FLOOR + 0.1 - Math.abs(tx) * 0.05, 0.17);
    const metaEnd = footSpace(tx * 1.25, FLOOR + 0.03, 0.17 + META[t]);
    footSolid(at, metaEnd, big ? 0.03 : 0.018, big ? 0.028 : 0.019, bone());
    at = metaEnd;
    let run = 0.17 + META[t];
    let spreadX = tx * 1.25;
    const rad = big ? [0.024, 0.02, 0.018] : [0.0148, 0.0125, 0.0105];
    TOE_L[t].forEach((L, k) => {
      run += L; spreadX += tx * 0.12;
      const y = FLOOR + 0.024 - k * 0.002;
      const next = footSpace(spreadX, y, run);
      footSolid(at, next, rad[k], rad[Math.min(2, k + 1)] * 0.88, bone(), 6);
      at = next;
    });
  });

  // --- Assembly -----------------------------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'human-skeleton';
  root.add(organMesh(parts, { roughness: 0.62, metalness: 0, bumpMap: grainBump(61, { dots: 1800, min: 0.8, max: 2 }), bumpScale: 0.1 }));

  // A classroom stand: five-armed foot on casters, a steel pole behind the spine, two brackets.
  const stand = [];
  const STEEL = 0x8c939c;
  const DARKS = 0x2c3036;
  const POLE_Z = -0.62;
  stand.push({ geometry: lathe([[0, 0], [0.09, 0.0], [0.11, 0.1], [0.075, 0.13], [0, 0.13]], 18), color: DARKS, position: [0, 0, POLE_Z] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.31;
    const ex = Math.sin(a) * 0.92; const ez = POLE_Z + Math.cos(a) * 0.92;
    stand.push({ geometry: tube([[0, 0.1, POLE_Z], [ex * 0.6, 0.095, POLE_Z + (ez - POLE_Z) * 0.6], [ex, 0.08, ez]], [0.05, 0.036, 0.03], { sides: 10, steps: 4, round: 1 }), color: 0x3a3f46 });
    stand.push({ geometry: new THREE.SphereGeometry(0.052, 12, 8), color: DARKS, position: [ex, 0.052, ez] });
  }
  // The foot plate the skeleton's soles stand on, reaching forward from the pole's base.
  stand.push({ geometry: lathe([[0, 0.09], [0.7, 0.09], [0.71, 0.12], [0.69, 0.14], [0, 0.14]], 40), color: 0x4a4f56, position: [0, 0, 0.06] });
  stand.push({ geometry: lathe([[0, 0.1], [0.032, 0.1], [0.032, 4.56], [0.05, 4.6], [0.032, 4.64], [0, 4.64]], 14), color: STEEL, position: [0, 0, POLE_Z] });
  // Two brackets: one to the lumbar spine, and a higher one that carries the thoracic spine.
  const bracket = (y, zEnd) => {
    stand.push({ geometry: tube([[0, y, POLE_Z], [0, y, (POLE_Z + zEnd) / 2], [0, y, zEnd]], 0.02, { sides: 10, steps: 3, round: 1 }), color: STEEL });
    stand.push({ geometry: lathe([[0, y - 0.04], [0.044, y - 0.04], [0.044, y + 0.04], [0, y + 0.04]], 14), color: DARKS, position: [0, 0, POLE_Z] });
  };
  // Between two spines, not through one, ending in the back of the arch.
  const between = (v) => v.y + v.h * 0.5;
  bracket(between(VERTS[2]), spineZ(between(VERTS[2])) - VERTS[2].r * 1.5);
  bracket(between(VERTS[13]), spineZ(between(VERTS[13])) - VERTS[13].r * 1.6);
  root.add(organMesh(stand, { roughness: 0.44, metalness: 0.3 }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Honey bee
// ---------------------------------------------------------------------------------------------

// A worker, modelled level and facing +Z with her origin on the ground under her, for the
// catalogue's hover to lift. Body solids are sculpted; what makes her furry is several thousand
// tiny closed spikes grown from the sculpt's own vertices, so a hair cannot stand off the skin.
function honeyBee() {
  const rng = seededRandom(1187);
  const BODY_Y = 1.32;
  // Head, thorax and abdomen in order along Z, with the abdomen hanging a little.
  const T = [0, BODY_Y + 0.02, 0.62]; // thorax centre
  const H = [0, BODY_Y - 0.1, 1.82]; // head centre
  const AB = [[0, BODY_Y - 0.02, -0.1], [0, BODY_Y - 0.1, -0.8], [0, BODY_Y - 0.26, -1.55], [0, BODY_Y - 0.44, -2.42]];
  const AMBER = lin(0xd2861e);
  const DARKBAND = lin(0x2a1a0e);
  const CHITIN = lin(0x2e2115);
  const FACE = lin(0x34261a);

  // --- The thorax and the waist -------------------------------------------------------------
  // Its surface is under fur, so it is the coarsest sculpt in the file.
  const t = new Sculpt(0.06);
  t.add(ellipsoidP(T, [0.68, 0.64, 0.72]), lin(0x7a5526));
  // The neck, narrow, into the head; and the petiole, the wasp waist, into the abdomen.
  t.add(curveP([[0, T[1] - 0.05, T[2] + 0.6], [0, H[1] + 0.02, H[2] - 0.34]], [0.2, 0.16], 5), CHITIN, { k: 0.08, ck: 0.1 });
  t.add(curveP([[0, T[1] - 0.14, T[2] - 0.56], [0, AB[0][1] - 0.06, AB[0][2] + 0.04]], [0.2, 0.14], 5), CHITIN, { k: 0.08, ck: 0.1 });
  const thorax = polygonize(t, { uvScale: 1.5, tint: (x, y, z, nx, ny, nz, rgb) => { const n = 0.92 + 0.16 * smoothNoise3(x * 4, y * 4, z * 4); rgb[0] *= n; rgb[1] *= n; rgb[2] *= n; } });

  // --- The abdomen --------------------------------------------------------------------------
  // Six overlapping plates, built ring by ring so that every ring lies exactly on a band's edge:
  // the stripes are as crisp as the mesh and cost a tenth of a sculpt. Each plate's rim stands out
  // over the one behind it, a step in one closed surface, and each is amber at its front, dark at
  // its back.
  const TERGITES = 6;
  const abdL = AB[0][2]; const abdR = AB[3][2];
  const abdRadius = [0.5, 0.76, 0.64, 0.04];
  const abdT = (z) => clamp01((abdL - z) / (abdL - abdR));
  const phaseZ = (z) => abdT(z) * TERGITES;
  const abdomen = (() => {
    const SIDES = 40;
    const rows = [];
    for (let i = 0; i < TERGITES; i++) {
      for (const f of [0.002, 0.05, 0.16, 0.32, 0.5, 0.56, 0.72, 0.88, 0.998]) rows.push((i + f) / TERGITES);
    }
    const positions = []; const colors = []; const index = [];
    const yAt = (t) => splineAt(AB.map((q) => q[1]), t);
    for (const t of rows) {
      const p = t * TERGITES; const f = p - Math.floor(p);
      const z = mix(abdL, abdR, t);
      const r = Math.max(0.03, splineAt(abdRadius, t)) * (1.03 - 0.075 * f * f);
      const band = sstep(f, 0.5, 0.56);
      const tip = sstep(p, 4.5, 5.2);
      const col = [0, 0, 0];
      for (let k = 0; k < 3; k++) col[k] = mix(mix(AMBER[k], DARKBAND[k], band), DARKBAND[k], tip);
      for (let j = 0; j < SIDES; j++) {
        const a2 = (j / SIDES) * Math.PI * 2;
        const x = Math.cos(a2) * r; const y = yAt(t) + Math.sin(a2) * r * 0.96;
        positions.push(x, y, z);
        const n = 0.93 + 0.14 * smoothNoise3(x * 5, y * 5, z * 2);
        const under = Math.sin(a2) < -0.4 ? mix(1, 0.66, sstep(-Math.sin(a2), 0.4, 0.85)) : 1;
        colors.push(col[0] * n * under, col[1] * n * under, col[2] * n * under);
      }
    }
    const n = rows.length;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < SIDES; j++) {
        const j2 = (j + 1) % SIDES;
        const A = i * SIDES + j; const B = i * SIDES + j2; const C = (i + 1) * SIDES + j2; const D = (i + 1) * SIDES + j;
        // z falls along the rings, so this order is what faces outward.
        index.push(A, C, B, A, D, C);
      }
    }
    const front = positions.length / 3;
    positions.push(0, yAt(0), abdL + 0.06); colors.push(AMBER[0], AMBER[1], AMBER[2]);
    const back = positions.length / 3;
    positions.push(0, yAt(1), abdR - 0.04); colors.push(DARKBAND[0], DARKBAND[1], DARKBAND[2]);
    for (let j = 0; j < SIDES; j++) {
      const j2 = (j + 1) % SIDES;
      index.push(front, j, j2);
      index.push(back, (n - 1) * SIDES + j2, (n - 1) * SIDES + j);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  })();

  // --- The head -----------------------------------------------------------------------------
  // A rounded triangle seen from in front, flattened front to back, narrowing to the jaws.
  const h = new Sculpt(0.038);
  h.add(ellipsoidP(H, [0.52, 0.5, 0.34], [0.4, 0, 0]), FACE);
  h.add(ellipsoidP([0, H[1] - 0.34, H[2] + 0.12], [0.24, 0.26, 0.17], [0.4, 0, 0]), FACE, { k: 0.12 });
  // Three simple eyes on the crown, each with a socket.
  const headField = h.snapshot();
  const ocelli = [[-0.13, 0.04], [0.13, 0.04], [0, 0.17]].map(([ox, oz]) => onSurface(headField, [ox, H[1] + 0.8, H[2] + oz]));
  ocelli.forEach((q) => h.sub(sphereP(q, 0.055), null, { k: 0.02 }));
  // Hollows for the compound eyes, so they are set in the head rather than stuck on.
  const EYE_C = (side) => [side * 0.4, H[1] + 0.02, H[2] + 0.02];
  for (const side of [1, -1]) h.sub(ellipsoidP(EYE_C(side), [0.17, 0.42, 0.22], [0.36, 0, side * -0.2]), null, { k: 0.03 });
  // The clypeus, the shield above the jaws, in a warmer brown.
  h.add(ellipsoidP([0, H[1] - 0.2, H[2] + 0.27], [0.2, 0.15, 0.08], [0.4, 0, 0]), lin(0x6e4a22), { k: 0.05, ck: 0.05 });
  const head = polygonize(h, { uvScale: 1.5, tint: (x, y, z, nx, ny, nz, rgb) => { const n = 0.9 + 0.2 * smoothNoise3(x * 6, y * 6, z * 6); rgb[0] *= n; rgb[1] *= n; rgb[2] *= n; } });

  const parts = [
    { geometry: thorax, keepColor: true },
    { geometry: abdomen, keepColor: true },
    { geometry: head, keepColor: true },
  ];
  const headFinal = h.snapshot();

  // --- Mouthparts and antennae ---------------------------------------------------------------
  const JOINT = 0x3a2a1a; const LEG = 0x2c2013; const LEG2 = 0x4d3216;
  const chain = (nodes, color, sides = 8, steps = 3) => {
    // A run of tubes, sockets included: each span is closed and overlaps the next at the node.
    for (let i = 0; i < nodes.length - 1; i++) {
      const A = nodes[i]; const B = nodes[i + 1];
      const mid = [(A.p[0] + B.p[0]) / 2, (A.p[1] + B.p[1]) / 2, (A.p[2] + B.p[2]) / 2];
      parts.push({ geometry: tube([A.p, mid, B.p], [A.r, (A.r + B.r) / 2, B.r], { sides, steps, round: 1 }), color });
    }
  };
  for (const side of [1, -1]) {
    // A mandible on each side of the mouth, closing across the front.
    chain([{ p: [side * 0.13, H[1] - 0.46, H[2] + 0.17], r: 0.055 }, { p: [side * 0.085, H[1] - 0.6, H[2] + 0.24], r: 0.04 }, { p: [side * 0.02, H[1] - 0.66, H[2] + 0.28], r: 0.012 }], 0x7a4f22, 8, 3);
    // The antenna: a long scape up out of the face, a sharp elbow, then the bead-chain flagellum.
    const socket = onSurface(headFinal, [side * 0.1, H[1] + 0.02, H[2] + 0.5]);
    const elbow = [side * 0.22, H[1] + 0.5, H[2] + 0.62];
    chain([{ p: [socket[0], socket[1], socket[2] - 0.03], r: 0.034 }, { p: [mix(socket[0], elbow[0], 0.5), mix(socket[1], elbow[1], 0.5), mix(socket[2], elbow[2], 0.5)], r: 0.028 }, { p: elbow, r: 0.03 }], JOINT, 9, 3);
    parts.push({ geometry: new THREE.SphereGeometry(0.036, 10, 7), color: JOINT, position: elbow });
    let q = elbow;
    let dx = side * 0.34; let dy = 0.08; let dz = 0.28;
    for (let i = 0; i < 11; i++) {
      // Eleven beads on the flagellum, curving out and down at the tip.
      const L = Math.hypot(dx, dy, dz);
      const seg = 0.098 + (i === 10 ? 0.035 : 0);
      const n = [q[0] + (dx / L) * seg, q[1] + (dy / L) * seg, q[2] + (dz / L) * seg];
      parts.push({ geometry: tube([q, n], [0.026, 0.023], { sides: 7, steps: 1, round: 1, straight: true }), color: LEG });
      q = n;
      dy -= 0.05; dx *= 1.0; dz += 0.01;
    }
  }
  // The folded tongue, pale, tucked back beneath the head.
  chain([{ p: [0, H[1] - 0.48, H[2] + 0.1], r: 0.05 }, { p: [0, H[1] - 0.64, H[2] - 0.05], r: 0.038 }, { p: [0, H[1] - 0.62, H[2] - 0.3], r: 0.028 }, { p: [0, H[1] - 0.54, H[2] - 0.5], r: 0.012 }], 0x8a5a2a, 8, 3);

  // --- Legs: six, all from the thorax, each coxa, femur, tibia and five-part foot ------------
  const leg = (side, root, knee, ankle, footDir, opts = {}) => {
    const R = (q) => [q[0] * side, q[1], q[2]];
    const coxaEnd = [mix(root[0], knee[0], 0.22), mix(root[1], knee[1], 0.22), mix(root[2], knee[2], 0.22)];
    chain([{ p: R(root), r: 0.13 }, { p: R(coxaEnd), r: 0.1 }], JOINT, 10, 2);
    chain([{ p: R(coxaEnd), r: 0.09 }, { p: R([mix(coxaEnd[0], knee[0], 0.5), mix(coxaEnd[1], knee[1], 0.5), mix(coxaEnd[2], knee[2], 0.5)]), r: opts.femurR ?? 0.08 }, { p: R(knee), r: 0.05 }], LEG, 10, 3);
    // The tibia, which on the hind leg widens into the flat blade of the pollen basket.
    const tR0 = 0.046; const tR1 = opts.basket ? 0.12 : 0.052;
    parts.push({
      geometry: tube([R(knee), R([mix(knee[0], ankle[0], 0.5), mix(knee[1], ankle[1], 0.5), mix(knee[2], ankle[2], 0.5)]), R(ankle)], [tR0, (tR0 + tR1) / 2, tR1], {
        sides: 10, steps: 6, round: 1,
        section: opts.basket ? () => [0.34, 1] : null,
        frame: opts.basket ? () => [side * 1, 0.1, 0] : null,
      }),
      color: LEG2,
    });
    // Five tarsal segments: the first long, then four short, ending in claws.
    let q = ankle;
    const L = [opts.basket ? 0.34 : 0.22, 0.09, 0.075, 0.065, 0.08];
    let dir = new THREE.Vector3(...footDir).normalize();
    for (let i = 0; i < 5; i++) {
      const n = [q[0] + dir.x * L[i], q[1] + dir.y * L[i], q[2] + dir.z * L[i]];
      const r0 = i === 0 ? (opts.basket ? 0.07 : 0.042) : 0.03; const r1 = i === 0 ? (opts.basket ? 0.045 : 0.03) : 0.024;
      parts.push({ geometry: tube([R(q), R(n)], [r0, r1], { sides: 7, steps: 2, round: 1, straight: true, section: opts.basket && i === 0 ? () => [0.5, 1] : null }), color: LEG2 });
      q = n;
      dir.y -= 0.14; dir.normalize();
    }
    for (const sgn of [1, -1]) {
      const claw = [q[0] + sgn * 0.035 + dir.x * 0.07, q[1] - 0.03, q[2] + dir.z * 0.07];
      parts.push({ geometry: tube([R(q), R([mix(q[0], claw[0], 0.6), q[1] - 0.005, mix(q[2], claw[2], 0.6)]), R(claw)], [0.02, 0.015, 0], { sides: 5, steps: 3, round: 0 }), color: 0x17100a });
    }
  };
  const hindAnkle = [0.86, 0.44, -0.72];
  const hindKnee = [1.08, 0.86, 0.04];
  for (const side of [1, -1]) {
    leg(side, [0.3, T[1] - 0.44, T[2] + 0.42], [0.88, 0.86, 1.3], [0.72, 0.34, 1.62], [0.25, -0.5, 0.75]);
    leg(side, [0.4, T[1] - 0.48, T[2] + 0.04], [1.08, 0.82, 0.72], [1.06, 0.3, 0.44], [0.3, -0.5, -0.45]);
    leg(side, [0.36, T[1] - 0.48, T[2] - 0.32], hindKnee, hindAnkle, [0.1, -0.55, -0.7], { basket: true, femurR: 0.1 });
    // The pollen load: a packed orange ball held on the blade of the tibia by its fringe of hairs.
    const shank = new THREE.Vector3(hindAnkle[0] - hindKnee[0], hindAnkle[1] - hindKnee[1], hindAnkle[2] - hindKnee[2]);
    shank.normalize();
    const ball = new THREE.SphereGeometry(1, 18, 12);
    const pos = ball.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // A packed pellet, not a marble: lumpy, longer than it is wide, and sunk into the blade.
      const lump = 1 + 0.2 * (smoothNoise3(pos.getX(i) * 3 + side, pos.getY(i) * 3, pos.getZ(i) * 3) - 0.5);
      pos.setXYZ(i, pos.getX(i) * 0.135 * lump, pos.getY(i) * 0.25 * lump, pos.getZ(i) * 0.145 * lump);
    }
    ball.computeVertexNormals();
    tintVertices(ball, (x, y, z, o) => {
      const n = 0.8 + 0.4 * smoothNoise3(x * 26 + 3, y * 26, z * 26);
      o[0] = 0.86 * n; o[1] = 0.27 * n; o[2] = 0.02 * n;
    });
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(shank.x * side, shank.y, shank.z));
    const load = new THREE.Vector3(mix(hindKnee[0], hindAnkle[0], 0.62) * side + side * 0.075, mix(hindKnee[1], hindAnkle[1], 0.62), mix(hindKnee[2], hindAnkle[2], 0.62));
    ball.applyMatrix4(new THREE.Matrix4().compose(load, q, new THREE.Vector3(1, 1, 1)));
    parts.push({ geometry: ball, keepColor: true });
    // The basket itself: a fringe of long stiff hairs curving out from both edges of the blade.
    for (let k = 0; k < 26; k++) {
      const t3 = 0.28 + (k / 25) * 0.66;
      const edge = k % 2 ? 1 : -1;
      const w3 = 0.04 + t3 * 0.08;
      // Square across the blade, whichever way the leg happens to run.
      const perp = new THREE.Vector3().crossVectors(new THREE.Vector3(shank.x, shank.y, shank.z), new THREE.Vector3(1, 0, 0)).normalize();
      const root3 = [mix(hindKnee[0], hindAnkle[0], t3) * side, mix(hindKnee[1], hindAnkle[1], t3) + perp.y * edge * w3, mix(hindKnee[2], hindAnkle[2], t3) + perp.z * edge * w3];
      const tip3 = [root3[0] + side * 0.11, root3[1] + perp.y * edge * 0.13 + shank.y * 0.03, root3[2] + perp.z * edge * 0.13 + shank.z * 0.03];
      parts.push({ geometry: tube([root3, [(root3[0] + tip3[0]) / 2 - side * 0.01, (root3[1] + tip3[1]) / 2, (root3[2] + tip3[2]) / 2], tip3], [0.014, 0.009, 0], { sides: 4, steps: 2, round: 0 }), color: 0xb98a48 });
    }

  }

  // --- Fur ------------------------------------------------------------------------------------
  // Grown from the sculpts' own vertices along their own normals. Each hair is a closed spike with
  // the skin's normal on its vertices, so the coat shades as a mass rather than as noise.
  const hairs = (geometry, keep, count, lenFn, colorFn, lean) => {
    const P = geometry.attributes.position; const N = geometry.attributes.normal;
    const positions = new Float32Array(count * 4 * 3);
    const normals = new Float32Array(count * 4 * 3);
    const colors = new Float32Array(count * 4 * 3);
    const index = [];
    let made = 0;
    const b1 = new THREE.Vector3(); const b2 = new THREE.Vector3(); const nv = new THREE.Vector3(); const dirH = new THREE.Vector3();
    const put = (v, x, y, z, nx, ny, nz, c) => {
      positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
      normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;
      colors[v * 3] = c[0]; colors[v * 3 + 1] = c[1]; colors[v * 3 + 2] = c[2];
    };
    for (let tries = 0; made < count && tries < count * 40; tries++) {
      const i = Math.floor(rng() * P.count);
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      if (!keep(x, y, z, N.getY(i))) continue;
      nv.set(N.getX(i), N.getY(i), N.getZ(i));
      const L = lenFn(x, y, z) * (0.7 + rng() * 0.6);
      // Hairs sweep backward over the body, with a scatter so the coat is not combed.
      dirH.copy(nv).multiplyScalar(0.72).add(new THREE.Vector3((rng() - 0.5) * 0.6, (rng() - 0.5) * 0.4 + lean[1], lean[2] + (rng() - 0.5) * 0.4)).normalize();
      b1.crossVectors(nv, Math.abs(nv.y) > 0.8 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
      b2.crossVectors(nv, b1);
      const w = 0.0075 + rng() * 0.0045;
      const v0 = made * 4;
      const c0 = colorFn(x, y, z, 0); const c1 = colorFn(x, y, z, 1);
      const bx = x - nv.x * 0.01; const by = y - nv.y * 0.01; const bz = z - nv.z * 0.01;
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2;
        const ox = b1.x * Math.cos(ang) + b2.x * Math.sin(ang);
        const oy = b1.y * Math.cos(ang) + b2.y * Math.sin(ang);
        const oz = b1.z * Math.cos(ang) + b2.z * Math.sin(ang);
        put(v0 + k, bx + ox * w, by + oy * w, bz + oz * w, nv.x, nv.y, nv.z, c0);
      }
      put(v0 + 3, x + dirH.x * L, y + dirH.y * L, z + dirH.z * L, nv.x, nv.y, nv.z, c1);
      index.push(v0, v0 + 1, v0 + 3, v0 + 1, v0 + 2, v0 + 3, v0 + 2, v0, v0 + 3, v0, v0 + 2, v0 + 1);
      made += 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, made * 12), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals.slice(0, made * 12), 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, made * 12), 3));
    g.setIndex(index);
    return g;
  };
  const TAWNY = [lin(0x9b6d30), lin(0xe2b667)];
  const thoraxColor = (x, y, z, end) => {
    const n = 0.8 + 0.4 * smoothNoise3(x * 3.2 + 1, y * 3.2, z * 3.2);
    const c = TAWNY[end];
    return [c[0] * n, c[1] * n, c[2] * n];
  };
  parts.push({
    geometry: hairs(thorax, (x, y, z, ny) => z > T[2] - 0.76 && z < T[2] + 0.72, 4700, () => 0.125, thoraxColor, [0, 0.08, -0.75]),
    keepColor: true,
  });
  // Pale fuzz along each band's front edge, which is the banding a bee shows at arm's length.
  parts.push({
    geometry: hairs(abdomen, (x, y, z) => { const p = phaseZ(z); const f = p - Math.floor(p); return p < 5.6 && (f < 0.1); }, 1100, () => 0.055, (x, y, z, end) => { const c = end ? lin(0xf0d9a0) : lin(0xa97b3c); return c; }, [0, 0, -0.7]),
    keepColor: true,
  });
  // The face and the crown are hairy too, between the eyes and over the top of the head.
  parts.push({
    geometry: hairs(head, (x, y, z, ny) => Math.abs(x) < 0.3 || y > H[1] + 0.3, 800, () => 0.06, (x, y, z, end) => { const c = end ? lin(0xb48a4a) : lin(0x4c3519); return c; }, [0, -0.1, -0.2]),
    keepColor: true,
  });

  const root = new THREE.Group();
  root.name = 'honey-bee';
  root.add(organMesh(parts, { roughness: 0.52, metalness: 0, bumpMap: grainBump(71, { dots: 1400, min: 0.9, max: 2 }), bumpScale: 0.1 }));

  // --- The compound eyes: their own mesh, since the facets are a painted bump ------------------
  const eyes = [];
  for (const side of [1, -1]) {
    const g = new THREE.SphereGeometry(1, 30, 20);
    const P = g.attributes.position;
    const uv = g.attributes.uv;
    // Facet UVs by a projection along X, so the honeycomb is not pinched at a sphere's poles.
    for (let i = 0; i < P.count; i++) uv.setXY(i, (P.getZ(i) + P.getX(i) * 0.3) * 1.4, P.getY(i) * 1.8);
    g.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...EYE_C(side)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.36, 0, side * -0.2, 'XYZ')),
      new THREE.Vector3(0.16, 0.41, 0.215),
    ));
    g.computeVertexNormals();
    eyes.push({ geometry: g, color: 0x47281a });
  }
  // The three small eyes, shiny beads sunk into their sockets.
  ocelli.forEach((q) => {
    eyes.push({ geometry: new THREE.SphereGeometry(0.052, 14, 10), color: 0x1a0d04, position: q });
  });
  const facets = canvasTexture(256, 256, (ctx, w, hgt) => {
    ctx.fillStyle = '#d0d0d0';
    ctx.fillRect(0, 0, w, hgt);
    ctx.strokeStyle = '#6e6e6e';
    ctx.lineWidth = 2;
    const R = 12;
    const dy = R * 1.5;
    const dx = R * Math.sqrt(3);
    for (let row = -1; row < hgt / dy + 1; row++) {
      for (let col = -1; col < w / dx + 1; col++) {
        const cx = col * dx + (row % 2 ? dx / 2 : 0);
        const cy = row * dy;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = cx + Math.cos(ang) * R; const py = cy + Math.sin(ang) * R;
          if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  });
  facets.colorSpace = THREE.NoColorSpace;
  facets.wrapS = THREE.RepeatWrapping; facets.wrapT = THREE.RepeatWrapping;
  facets.repeat.set(1.5, 1.5);
  root.add(mesh(mergeParts(eyes), standard({ vertexColors: true, map: facets, roughness: 0.26, metalness: 0, bumpMap: facets, bumpScale: 0.5 })));

  // --- The wings ------------------------------------------------------------------------------
  // Two pairs of closed lens solids, the one transparent mesh here, with their veins painted into
  // a single atlas: forewing on the left half, hind wing on the right. Real worker venation: the
  // long marginal cell along the front edge and three submarginal cells behind it.
  const BOUND = (u, table) => {
    const span = (table.length - 1) * clamp01(u);
    const i = Math.min(Math.floor(span), table.length - 2);
    return mix(table[i], table[i + 1], span - i);
  };
  const FORE = { len: 3.1, lead: [0.02, 0.1, 0.16, 0.18, 0.17, 0.12, 0.0], trail: [-0.08, -0.46, -0.76, -0.9, -0.88, -0.66, 0.0] };
  const HIND = { len: 2.15, lead: [0.04, 0.14, 0.18, 0.18, 0.16, 0.1, 0.0], trail: [-0.06, -0.32, -0.52, -0.66, -0.66, -0.5, 0.0] };
  const wingGeo = (W, side, root, sweep, lift, atlasU) => {
    const g = solidSurface({
      nu: 24, nv: 8,
      point: (u, v) => {
        const lead = BOUND(u, W.lead); const trail = BOUND(u, W.trail);
        const x = u * W.len; const z = mix(trail, lead, v);
        return [x, 0.05 * Math.sin(v * Math.PI) * (1 - u), z];
      },
      thick: () => 0.008,
      axis: [0, 1, 0],
    });
    const P = g.attributes.position;
    const uv = g.attributes.uv;
    // The painting is laid straight over the wing's plan: left half or right half of the atlas.
    for (let i = 0; i < P.count; i++) {
      uv.setXY(i, atlasU + (P.getX(i) / W.len) * 0.48, 0.5 + (P.getZ(i) / 2.0));
    }
    const m = new THREE.Matrix4().makeRotationY(-sweep);
    m.multiply(new THREE.Matrix4().makeRotationZ(lift));
    g.applyMatrix4(m);
    if (side < 0) {
      const flip = mirrorX(g);
      g.copy(flip);
    }
    g.translate(root[0] * side, root[1], root[2]);
    return g;
  };
  const wings = [];
  for (const side of [1, -1]) {
    // Spread a little back and a little up, the way a hovering insect's are mid-stroke.
    wings.push({ geometry: wingGeo(FORE, side, [0.42, T[1] + 0.48, T[2] + 0.28], 0.36, 0.16, 0.01), color: 0xffffff });
    wings.push({ geometry: wingGeo(HIND, side, [0.44, T[1] + 0.42, T[2] - 0.02], 0.72, 0.1, 0.51), color: 0xffffff });
  }
  const venation = canvasTexture(1024, 512, (ctx, w, hgt) => {
    ctx.clearRect(0, 0, w, hgt);
    const paint = (W, x0) => {
      const X = (u) => (x0 + u * 0.48) * w;
      const Y = (z) => (1 - (0.5 + z / 2.0)) * hgt;
      // The membrane: pale, faintly tinted, with a touch of oil-film colour.
      const grad = ctx.createLinearGradient(X(0), 0, X(1), 0);
      grad.addColorStop(0, 'rgba(232,214,170,0.46)');
      grad.addColorStop(0.5, 'rgba(214,226,214,0.3)');
      grad.addColorStop(1, 'rgba(226,216,236,0.3)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) { const u = i / 40; ctx[i ? 'lineTo' : 'moveTo'](X(u), Y(BOUND(u, W.lead))); }
      for (let i = 40; i >= 0; i--) { const u = i / 40; ctx.lineTo(X(u), Y(BOUND(u, W.trail))); }
      ctx.closePath();
      ctx.fill();
      // Veins, dark amber. Every one is drawn in the wing's own plan coordinates.
      ctx.strokeStyle = 'rgba(70,42,14,0.98)';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const line = (pts, width) => {
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach(([u, f], i) => {
          const lead = BOUND(u, W.lead); const trail = BOUND(u, W.trail);
          ctx[i ? 'lineTo' : 'moveTo'](X(u), Y(mix(trail, lead, f)));
        });
        ctx.stroke();
      };
      line([...Array(21).keys()].map((i) => [i / 20, 1]), 6); // the leading edge
      line([...Array(21).keys()].map((i) => [i / 20, 0]), 2.5); // the trailing edge
      return line;
    };
    const f = paint(FORE, 0.01);
    f([[0, 0.92], [0.3, 0.86], [0.62, 0.82], [0.72, 0.92]], 4.5); // the subcosta, running into the stigma
    f([[0, 0.56], [0.22, 0.56], [0.42, 0.62], [0.62, 0.62], [0.84, 0.72], [0.93, 0.86]], 3.5); // the marginal cell's back
    f([[0, 0.28], [0.18, 0.34], [0.36, 0.42], [0.42, 0.62]], 3.5); // the median
    f([[0.36, 0.42], [0.5, 0.38], [0.62, 0.38], [0.74, 0.42]], 3); // submarginal row
    f([[0.5, 0.38], [0.52, 0.62]], 3); f([[0.62, 0.38], [0.64, 0.62]], 3); f([[0.74, 0.42], [0.78, 0.66]], 3);
    f([[0.18, 0.34], [0.34, 0.16], [0.52, 0.12], [0.66, 0.14]], 3);
    f([[0.36, 0.42], [0.42, 0.2], [0.34, 0.16]], 3);
    f([[0.66, 0.14], [0.68, 0.38]], 2.6);
    f([[0.52, 0.12], [0.6, 0.0]], 2.2);
    f([[0.66, 0.14], [0.8, 0.0]], 2.2);
    f([[0.34, 0.16], [0.38, 0.0]], 2.2);
    const b = paint(HIND, 0.51);
    b([[0, 0.8], [0.34, 0.74], [0.6, 0.74], [0.82, 0.86]], 3.5);
    b([[0, 0.42], [0.3, 0.42], [0.46, 0.4], [0.6, 0.74]], 3);
    b([[0.3, 0.42], [0.52, 0.22], [0.76, 0.12]], 2.6);
    b([[0.46, 0.4], [0.72, 0.4], [0.9, 0.34]], 2.6);
    b([[0, 0.14], [0.22, 0.1], [0.38, 0.0]], 2.4);
  });
  const wingMesh = mesh(mergeParts(wings), standard({
    map: venation, transparent: true, depthWrite: false, roughness: 0.2, metalness: 0, vertexColors: true,
    emissive: 0x2a2a2a,
  }));
  wingMesh.castShadow = false;
  root.add(wingMesh);

  return root;
}

export const BUILDERS = {
  'human-heart': humanHeart,
  'human-brain': humanBrain,
  'human-lungs': humanLungs,
  'leopard-frog': leopardFrog,
  'human-skeleton': humanSkeleton,
  'honey-bee': honeyBee,
};
