// The Model Database's shared solid-modelling kit. It began as the private toolkit of
// builders/Life.js, whose heart, brain and frog came out better than anything built from tubes.
//
// THE ONE IDEA: AN ORGANIC THING IS ONE SURFACE, SO SCULPT IT AS A FIELD. Build a `Sculpt` from
// solids (sphereP, ellipsoidP, curveP, segsP, boxP, torusP) with smooth unions and subtractions,
// then `polygonize` it by surface nets. Nothing can float, nothing can be open, the winding comes
// from which side of the surface is negative, and colour changes where solids meet.
//
// It costs triangles per square foot whatever the shape, so anything thin and many (ribs, fingers,
// ropes, hairs) should be an analytic closed `tube`, and `lathe` is for anything turned. `tube` and
// `lathe` here are correct from the bottom up: LoftKit.tube() and LoftKit.sweepProfile() are wound
// inward, and `outward()` below corrects anything else that may be. See src/models/builders/Life.js
// for all of this in use.

import * as THREE from 'three';
import { mergeParts, smoothNoise3, splineAt, revolve, solidSurface } from '../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../PropKit.js';

// ---------------------------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------------------------
export const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (x, a, b) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const mixInto = (out, c, t) => { out[0] += (c[0] - out[0]) * t; out[1] += (c[1] - out[1]) * t; out[2] += (c[2] - out[2]) * t; };

export function eulerInverse(rot) {
  if (!rot) return null;
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
  const e = m.elements;
  // The transpose of the rotation, read as world to local.
  return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
}

// ---------------------------------------------------------------------------------------------
// Solids for the field. Each is { f(x,y,z) -> distance, box: [x0,y0,z0,x1,y1,z1] }.
// ---------------------------------------------------------------------------------------------
export function sphereP(c, r) {
  const [cx, cy, cz] = c;
  return { f: (x, y, z) => Math.hypot(x - cx, y - cy, z - cz) - r, box: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r] };
}

// Inigo Quilez's bound for an ellipsoid: not exact, but first-order right near the surface, which
// is the only place it is asked.
export function ellipsoidP(c, radii, rot = null) {
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
export function segsP(points, radii) {
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
export function sampleCurve(points, radii, n) {
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
export function curveP(points, radii, n = null) {
  const { P, R } = sampleCurve(points, radii, n ?? Math.max(6, (points.length - 1) * 5));
  return segsP(P, R);
}

export function boxP(c, half, rot = null, round = 0) {
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
export function torusP(c, axis, R, r) {
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
export class Sculpt {
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

export function fieldOf(x, y, z) { return fieldD(this.ops, x, y, z); }

export function fieldD(ops, x, y, z) {
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
export function fieldColor(ops, x, y, z, out) {
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
export function onSurface(field, p, lift = 0, iterations = 12) {
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

export function fieldNormal(field, p) {
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
export function pathOn(field, points, n = 24, lift = 0) {
  const projected = points.map((p) => onSurface(field, p, lift));
  const { P } = sampleCurve(projected, 1, n);
  return P.map((p) => onSurface(field, p, lift, 6));
}

// Surface nets over a sparse grid. Blocks of eight cells that are far from the surface are never
// evaluated, so the cost goes with the area of the surface rather than the volume of its box.
export function polygonize(sculpt, { tint = null, uvScale = 1, bounds = null, normalH = 0.6, extraReach = 0, snap = null } = {}) {
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
export function tube(points, radii, {
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
export function lathe(profile, segments = 40) {
  return revolve([...profile].reverse(), { segments });
}

// Reflects a geometry across x = 0 and repairs what a reflection breaks: the winding and the x of
// every normal. Two limbs from one sculpt, and two halves that cannot disagree.
export function mirrorX(geometry) {
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

export const mouthDepth = (r) => r * 1.5;

// The cut end of a vessel. Thin walls alias on a grid, and a cut end is exactly what a student
// looks down, so the mouth is a small lathed sleeve fitted over the vessel's sawn-off end. It is a
// closed solid: wall, rim, then a blind pocket that goes dark toward its floor.
export function vesselMouth(parts, p, dir, r, color, lumen, { depth = null, wall = null, length = null, segments = 22 } = {}) {
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

export function tintVertices(geometry, fn) {
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
export function polylineDist(path, x, y, z) {
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
export function relaxMesh(geometry, iterations = 1, weight = 0.4) {
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

export function organMesh(parts, params) {
  return mesh(mergeParts(parts), standard({ vertexColors: true, ...params }));
}

// Fine pore-scale grain that a vertex colour cannot carry: a greyscale tile used as a bump map on
// the skew UVs a sculpt lays down. Painted with seeded dots on a canvas; nothing is read back.
export function grainBump(seed, { size = 256, dots = 2600, min = 0.8, max = 2.4, contrast = 0.5 } = {}) {
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
export function standBase(parts, radius, { top = 0.34, color = 0x5b3a24, collar = 0xb08d4e, collarR = 0.2 } = {}) {
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
// Which way round did it come out?
// ---------------------------------------------------------------------------------------------
export function signedVolume(geometry) {
  const p = geometry.attributes.position;
  const idx = geometry.index;
  const n = idx ? idx.count : p.count;
  let volume = 0;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const ax = p.getX(a); const ay = p.getY(a); const az = p.getZ(a);
    const bx = p.getX(b); const by = p.getY(b); const bz = p.getZ(b);
    const cx = p.getX(c); const cy = p.getY(c); const cz = p.getZ(c);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

// Reverses every triangle and every normal, on a copy.
export function flipped(geometry) {
  const g = geometry.index ? geometry.clone() : geometry.clone().toNonIndexed();
  if (g.index) {
    const idx = g.index;
    for (let i = 0; i < idx.count; i += 3) {
      const b = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, b);
    }
  } else {
    for (const attr of Object.values(g.attributes)) {
      const size = attr.itemSize;
      for (let t = 0; t < attr.count; t += 3) {
        for (let k = 0; k < size; k++) {
          const v = attr.array[(t + 1) * size + k];
          attr.array[(t + 1) * size + k] = attr.array[(t + 2) * size + k];
          attr.array[(t + 2) * size + k] = v;
        }
      }
    }
  }
  const nrm = g.attributes.normal;
  if (nrm) for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
  return g;
}

// Hand any closed solid through this when a shared helper's winding is in doubt. Under FrontSide an
// inside-out solid does not vanish, it renders as the far inner wall and reads as torn or dark.
export function outward(geometry) {
  return signedVolume(geometry) < 0 ? flipped(geometry) : geometry;
}

// A matrix whose +Z runs from a to b, for any timber, spoke or rod that is not on an axis:
// mergeParts' Euler cannot compose the rotations these need. Returns { m, len, dir, side, up }.
export function alongMatrix(a, b, upHint = [0, 1, 0]) {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const dir = new THREE.Vector3(b[0], b[1], b[2]).sub(A);
  const len = dir.length();
  dir.normalize();
  let up = new THREE.Vector3(upHint[0], upHint[1], upHint[2]);
  if (Math.abs(up.dot(dir)) > 0.98) up = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(up, dir).normalize();
  const up2 = new THREE.Vector3().crossVectors(dir, side).normalize();
  const m = new THREE.Matrix4().makeBasis(side, up2, dir);
  m.setPosition(A);
  return { m, len, dir, side, up: up2 };
}
