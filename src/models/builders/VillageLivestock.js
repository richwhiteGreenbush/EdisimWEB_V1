// The village kit's animals: dairy cow, sheep, farm pig, hen and chicks, draft horse and goat. A child places
// a herd of these, so each is under 20k triangles and builds in well under half a second, and that second
// number decides the whole file. Signed-distance sculpting is the slowest thing in the app, so:
//
//   - every skin is one field evaluated at three densities (`zoned`): a fine face, medium feet, a coarse barrel;
//   - a coat's patches are not a tint, they are a CUT (`crispSplit`), razor sharp at any density;
//   - everything thin (ears, tail hair, straps, horns, hooves, eyes) is analytic, not in the field at all;
//   - the solids here use sqrt rather than the Math.hypot in ModelKit's, which is several times slower.
//
// Every head is authored flat in its own frame (`headFrame`) and then pitched, so an ear, an eye and a nostril
// stay where they belong when the head is carried higher or lower.

import * as THREE from 'three';
import { mergeParts, solidSurface } from '../../props/LoftKit.js';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  lin, clamp01, mix, sstep, eulerInverse, fieldD, segsP, sampleCurve, Sculpt, onSurface, fieldNormal, pathOn, polygonize, tube, tintVertices, outward,
} from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Fast solids
// ---------------------------------------------------------------------------------------------

const S = (c, r) => {
  const [cx, cy, cz] = c;
  return {
    box: [cx - r, cy - r, cz - r, cx + r, cy + r, cz + r],
    f: (x, y, z) => { const a = x - cx; const b = y - cy; const e = z - cz; return Math.sqrt(a * a + b * b + e * e) - r; },
  };
};

// The Quilez bound for an ellipsoid, as in ModelKit, written with sqrt.
function E(c, radii, rot = null) {
  const [cx, cy, cz] = c;
  const [rx, ry, rz] = radii;
  const R = rot ? eulerInverse(rot) : null;
  const big = Math.max(rx, ry, rz);
  const small = Math.min(rx, ry, rz);
  const box = rot ? [cx - big, cy - big, cz - big, cx + big, cy + big, cz + big] : [cx - rx, cy - ry, cz - rz, cx + rx, cy + ry, cz + rz];
  const irx = 1 / rx; const iry = 1 / ry; const irz = 1 / rz;
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
      const ax = px * irx; const ay = py * iry; const az = pz * irz;
      const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
      if (k0 < 1e-6) return -small;
      const bx = ax * irx; const by = ay * iry; const bz = az * irz;
      return (k0 * (k0 - 1)) / Math.sqrt(bx * bx + by * by + bz * bz);
    },
  };
}

// A curve through control points, as round cones. `n` is deliberately small: every segment is an evaluation.
const C = (points, radii, n = null) => {
  const { P, R } = sampleCurve(points, radii, n ?? Math.max(3, (points.length - 1) * 3));
  return segsP(P, R);
};

// One solid mirrored across x = 0 for the price of one evaluation.
const both = (prim) => {
  const b = prim.box;
  const w = Math.max(Math.abs(b[0]), Math.abs(b[3]));
  return { box: [-w, b[1], b[2], w, b[4], b[5]], f: (x, y, z) => prim.f(x < 0 ? -x : x, y, z) };
};

// Spline tables, so a body's section costs four lookups.
function table(xs, ys, size = 96) {
  const n = xs.length;
  const m = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1); const b = Math.min(n - 1, i + 1);
    m[i] = (ys[b] - ys[a]) / (xs[b] - xs[a]);
  }
  const x0 = xs[0]; const x1 = xs[n - 1];
  const out = new Float64Array(size + 1);
  let k = 0;
  for (let i = 0; i <= size; i++) {
    const x = mix(x0, x1, i / size);
    while (k < n - 2 && x > xs[k + 1]) k += 1;
    const h = xs[k + 1] - xs[k];
    const t = clamp01((x - xs[k]) / h);
    const t2 = t * t; const t3 = t2 * t;
    out[i] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  }
  const scale = size / (x1 - x0);
  return (x) => {
    const f = (x - x0) * scale;
    const i = f < 0 ? 0 : f >= size ? size - 1 : f | 0;
    return out[i] + (out[i + 1] - out[i]) * (f - i);
  };
}

// One body whose section is splined along z: [z, centreY, halfWidth, above, below].
function bodyLoft(stations) {
  const along = stations.map((q) => q[0]);
  const c = table(along, stations.map((q) => q[1]));
  const w = table(along, stations.map((q) => q[2]));
  const up = table(along, stations.map((q) => q[3]));
  const dn = table(along, stations.map((q) => q[4]));
  const a0 = along[0]; const a1 = along[along.length - 1];
  const wide = Math.max(...stations.map((q) => q[2]));
  const lo = Math.min(...stations.map((q) => q[1] - q[4]));
  const hi = Math.max(...stations.map((q) => q[1] + q[3]));
  return {
    box: [-wide, lo, a0, wide, hi, a1],
    f: (x, y, z) => {
      const t = z < a0 ? a0 : z > a1 ? a1 : z;
      const db = y - c(t);
      const rw = w(t);
      const rb = db > 0 ? up(t) : dn(t);
      const ax = x / rw; const ay = db / rb;
      const d = (Math.sqrt(ax * ax + ay * ay) - 1) * (rw < rb ? rw : rb);
      const over = z < a0 ? a0 - z : z > a1 ? z - a1 : 0;
      if (over <= 0) return d;
      const e = d > 0 ? d : 0;
      return Math.sqrt(e * e + over * over);
    },
  };
}

// A head's frame: `w` runs from the poll to the nose, `v` is up out of the forehead, and the whole lot is pitched
// down by `pitch` radians about the poll.
function headFrame(origin, pitch, scale = 1) {
  const sn = Math.sin(pitch); const cs = Math.cos(pitch);
  const H = (x, v, w) => [origin[0] + x * scale, origin[1] + (v * cs - w * sn) * scale, origin[2] + (v * sn + w * cs) * scale];
  const rot = [pitch, 0, 0];
  return {
    H,
    rot,
    s: scale,
    E: (x, v, w, radii) => E(H(x, v, w), [radii[0] * scale, radii[1] * scale, radii[2] * scale], rot),
    // A chain of round cones in the head's own coordinates.
    C: (points, radii) => segsP(points.map((p) => H(p[0], p[1], p[2])), radii.map((r) => r * scale)),
    // Back into the head's own coordinates, for paint.
    local: (x, y, z) => {
      const dy = (y - origin[1]) / scale; const dz = (z - origin[2]) / scale;
      return [x / scale, dy * cs + dz * sn, -dy * sn + dz * cs];
    },
  };
}

// ---------------------------------------------------------------------------------------------
// One field at several densities, and the cut a coat is painted with
// ---------------------------------------------------------------------------------------------

// Drops every triangle wholly inside a predicate's region: the unseen part of something buried in something else.
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

// Every pass takes its normals over the same small step, or the boundary between two densities shows as a change of
// shading wherever it crosses a crease.
function zoned(build, coarseCell, zones, options) {
  const out = [];
  const hn = Math.min(...zones.map((zone) => zone.cell)) * 0.7;
  for (const zone of zones) {
    const s = build(zone.cell);
    const b = zone.box;
    // A fine pass only needs to reach its own box: the coarse pass keeps anything that crosses the edge.
    out.push(dropWhere(polygonize(s, { ...options(s), bounds: b, normalH: hn / zone.cell }), (x, y, z) => x < b[0] || x > b[3] || y < b[1] || y > b[4] || z < b[2] || z > b[5]));
  }
  const s = build(coarseCell);
  const g = polygonize(s, { ...options(s), normalH: hn / coarseCell });
  const P = g.attributes.position;
  const idx = g.index;
  const inBox = (i, b) => {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    return x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5];
  };
  const kept = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    let drop = false;
    for (const zone of zones) if (inBox(a, zone.box) && inBox(b, zone.box) && inBox(c, zone.box)) { drop = true; break; }
    if (!drop) kept.push(a, b, c);
  }
  g.setIndex(kept);
  out.push(g);
  return out;
}

// Cuts a mesh along the zero line of a field and colours either side differently, so a painted edge is as sharp
// as a triangle's edge however coarse the mesh is. `side` is positive on the side that keeps the mesh's colour;
// `dark(c0, c1, c2, out)` recolours the negative side from the mesh's colour there.
function crispSplit(geometry, side, recolour) {
  const P = geometry.attributes.position; const N = geometry.attributes.normal; const U = geometry.attributes.uv; const K = geometry.attributes.color;
  const idx = geometry.index;
  const pos = []; const nor = []; const uv = []; const col = [];
  const rgb = [0, 0, 0];
  const emit = (v, positive) => {
    let nx = v[3]; let ny = v[4]; let nz = v[5];
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
    if (positive) { rgb[0] = v[8]; rgb[1] = v[9]; rgb[2] = v[10]; } else recolour(v[8], v[9], v[10], v[0], v[1], v[2], rgb);
    pos.push(v[0], v[1], v[2]); nor.push(nx, ny, nz); uv.push(v[6], v[7]); col.push(rgb[0], rgb[1], rgb[2]);
  };
  const score = (v) => { v[11] = side(v[0], v[1], v[2]); return v; };
  const lerpV = (a, b, t) => {
    const o = new Array(12);
    for (let i = 0; i < 11; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    return o;
  };
  const cut = (a, b) => {
    let lo = a; let hi = b; let v = null;
    for (let i = 0; i < 3; i++) {
      v = score(lerpV(lo, hi, clamp01(lo[11] / (lo[11] - hi[11]))));
      if ((v[11] >= 0) === (lo[11] >= 0)) lo = v; else hi = v;
    }
    return v;
  };
  const V = [];
  for (let i = 0; i < P.count; i++) V.push(score([P.getX(i), P.getY(i), P.getZ(i), N.getX(i), N.getY(i), N.getZ(i), U.getX(i), U.getY(i), K.getX(i), K.getY(i), K.getZ(i), 0]));
  for (let t = 0; t < idx.count; t += 3) {
    const a = V[idx.getX(t)]; const b = V[idx.getX(t + 1)]; const c = V[idx.getX(t + 2)];
    const sa = a[11] >= 0; const sb = b[11] >= 0; const sc = c[11] >= 0;
    if (sa === sb && sb === sc) { emit(a, sa); emit(b, sa); emit(c, sa); continue; }
    let p = a; let q = b; let r = c;
    if (sa === sb) { p = c; q = a; r = b; } else if (sa === sc) { p = b; q = c; r = a; }
    const pq = cut(p, q); const pr = cut(p, r);
    const on = p[11] >= 0;
    emit(p, on); emit(pq, on); emit(pr, on);
    emit(q, !on); emit(r, !on); emit(pr, !on);
    emit(q, !on); emit(pr, !on); emit(pq, !on);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// A coat's markings, laid by hand: each blob is [centre, radii], and the field is how far inside the nearest one a
// point is. The sines make the edge wander the way a map's coastline does, and they are cheap.
function markings(blobs, wander = 1) {
  const n = blobs.length;
  return (x, y, z) => {
    let best = -1e9;
    for (let i = 0; i < n; i++) {
      const [c, r] = blobs[i];
      const a = (x - c[0]) / r[0]; const b = (y - c[1]) / r[1]; const e = (z - c[2]) / r[2];
      const v = (1 - Math.sqrt(a * a + b * b + e * e)) * r[3];
      if (v > best) best = v;
    }
    return best + wander * (
      0.16 * Math.sin(1.9 * y + 2.3 * z + 1.1 * x)
      + 0.09 * Math.sin(4.3 * z - 3.1 * y + 0.7 + 1.6 * x)
      + 0.045 * Math.sin(9.1 * y + 7.3 * z + 3.1 * x)
    );
  };
}

// Dark in the creases: a sum of one extra evaluation per vertex that buys most of what reads as form.
const occlusion = (ops, x, y, z, nx, ny, nz, reach) => clamp01(fieldD(ops, x + nx * reach, y + ny * reach, z + nz * reach) / reach);

// ---------------------------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------------------------

// Short hair: fine streaks with no colour of their own, so a coat has a nap wherever the light rakes it.
function napMap(seed, { size = 256, lines = 620 } = {}) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (let i = 0; i < lines; i++) {
      const x = rng() * w; const y = rng() * h; const L = 5 + rng() * 9;
      const a = Math.PI * 0.5 + (rng() - 0.5) * 0.7;
      const v = rng() > 0.5 ? 255 : 196;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + rng() * 0.35})`;
      ctx.lineWidth = 0.7 + rng();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Long hair, for tails and manes: near white, so a lock's own colour carries the hue.
function strandMap(seed, size = 128, lines = 90) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#ececec';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i++) {
      const x = rng() * w;
      ctx.strokeStyle = rng() > 0.55 ? `rgba(255,255,255,${0.35 + rng() * 0.5})` : `rgba(150,150,150,${0.35 + rng() * 0.55})`;
      ctx.lineWidth = 0.8 + rng() * 1.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Fleece: short curled arcs, near white, for a fine crimp the lumps of the silhouette cannot carry.
function woolMap(seed, size = 256, curls = 1100) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#f3f0e9';
    ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (let i = 0; i < curls; i++) {
      const x = rng() * w; const y = rng() * h; const r = 2.5 + rng() * 4.5;
      const a = rng() * Math.PI * 2;
      const v = rng() > 0.5 ? 255 : 196;
      ctx.strokeStyle = `rgba(${v},${v},${v * 0.97},${0.25 + rng() * 0.4})`;
      ctx.lineWidth = 1.2 + rng() * 1.6;
      ctx.beginPath();
      ctx.arc(x, y, r, a, a + 2.2 + rng() * 2);
      ctx.stroke();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// A speckled hen's feathers, painted as staggered rows: each a dark-barred brown scallop with a cream fleck at its
// tip. This map IS the colour, since vertex colours only carry the shading.
function plumageMap(seed, size = 256) {
  const texture = canvasTexture(size, size, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#6a3f1e';
    ctx.fillRect(0, 0, w, h);
    const rows = 6; const cols = 6;
    const fw = w / cols; const fh = h / rows;
    const browns = ['#7c4a22', '#70431f', '#86552a', '#643a1b', '#8e5e30'];
    const wrapped = (cx, cy, draw) => {
      for (const ox of [0, cx < w * 0.25 ? w : 0, cx > w * 0.75 ? -w : 0]) {
        for (const oy of [0, cy < h * 0.25 ? h : 0, cy > h * 0.75 ? -h : 0]) {
          if ((ox === 0 && oy === 0) || ox !== 0 || oy !== 0) draw(cx + ox, cy + oy);
        }
      }
    };
    // Soft feather shapes first, low in contrast: they say "feathers" at six feet and nothing at twenty.
    for (let r = rows; r >= 0; r--) {
      for (let c = 0; c < cols; c++) {
        const cx = (c + (r % 2 ? 0.5 : 0)) * fw + (rng() - 0.5) * fw * 0.3;
        const cy = (r + 0.5) * fh + (rng() - 0.5) * fh * 0.3;
        const fill = browns[Math.floor(rng() * browns.length)];
        wrapped(cx, cy, (x, y) => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.ellipse(x, y, fw * 0.64, fh * 0.78, 0, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
    // Then the speckle, scattered rather than one per feather: a black fleck with a cream one beside it, every size.
    for (let i = 0; i < 120; i++) {
      const cx = rng() * w; const cy = rng() * h;
      const big = 0.42 + rng() * 0.62;
      const a = (rng() - 0.5) * 0.9;
      const hasCream = rng() > 0.25; const hasDark = rng() > 0.2;
      wrapped(cx, cy, (x, y) => {
        if (hasDark) {
          ctx.fillStyle = 'rgba(34,22,12,0.82)';
          ctx.beginPath();
          ctx.ellipse(x, y + 3 * big, 5.5 * big, 2.8 * big, a, 0, Math.PI * 2);
          ctx.fill();
        }
        if (hasCream) {
          ctx.fillStyle = 'rgba(232,216,180,0.95)';
          ctx.beginPath();
          ctx.ellipse(x + 1, y - 1.5 * big, 5 * big, 3.2 * big, a, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// An eye, painted once and mapped straight on along its own axis. `pupil` is what a child looks for: a farm
// animal's is a horizontal bar, and on the goat that is on its card.
function eyeTile({ iris, rim, pupil = 'bar', pupilW = 0.42, pupilH = 0.13, irisR = 0.74, sclera = '#d9cdb8' }) {
  return canvasTexture(128, 128, (ctx, w) => {
    const c = w / 2;
    ctx.fillStyle = sclera;
    ctx.fillRect(0, 0, w, w);
    const g = ctx.createRadialGradient(c, c, w * 0.08, c, c, c * irisR);
    g.addColorStop(0, rim);
    g.addColorStop(0.3, iris);
    g.addColorStop(0.82, iris);
    g.addColorStop(1, rim);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c, c, c * irisR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#060504';
    if (pupil === 'round') {
      ctx.beginPath();
      ctx.arc(c, c, c * pupilW, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // A rounded bar.
      const pw = c * pupilW; const ph = c * pupilH;
      ctx.beginPath();
      ctx.moveTo(c - pw + ph, c - ph);
      ctx.lineTo(c + pw - ph, c - ph);
      ctx.arc(c + pw - ph, c, ph, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(c - pw + ph, c + ph);
      ctx.arc(c - pw + ph, c, ph, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      ctx.fill();
    }
    // The highlight, up and forward, in the same place on both eyes.
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.arc(c + c * 0.08, c - c * 0.5, c * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(c - c * 0.3, c + c * 0.46, c * 0.055, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ---------------------------------------------------------------------------------------------
// Small solids that do not belong in a field
// ---------------------------------------------------------------------------------------------

// A horn-shelled foot, as a closed ring stack. `plan(a)` gives the outline at the ground; `shrink` and `slope` take
// it in and back on the way up. One toe of a cloven hoof or the whole of a horse's.
function footSolid({ x, z, w, l, h, q = 1, cloven = true, shrink = 0.8, slope = 0.3, flare = 1, rows = 2, points = 10, y0 = 0 }) {
  const pos = [];
  const index = [];
  const at = (a, f) => {
    let px = Math.cos(a) * w;
    let pz = Math.sin(a) * l;
    if (cloven) {
      if (px < 0) px *= 0.3;
      if (pz > 0) { pz *= 1.08; px *= 1 - 0.35 * Math.max(0, Math.sin(a)) ** 3; }
    }
    return [px * f, pz * f];
  };
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const f = mix(1, shrink, t) * (r === 0 ? flare : 1);
    const zo = -slope * l * t;
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2;
      const [px, pz] = at(a, f);
      pos.push(x + q * px, y0 + h * t, z + pz + zo);
    }
  }
  const low = pos.length / 3; pos.push(x, y0, z);
  const top = pos.length / 3; pos.push(x, y0 + h, z - slope * l);
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < points; i++) {
      const j = (i + 1) % points;
      const a = r * points + i; const b = r * points + j; const c = (r + 1) * points + j; const d = (r + 1) * points + i;
      index.push(a, c, b, a, d, c);
    }
  }
  for (let i = 0; i < points; i++) {
    const j = (i + 1) % points;
    index.push(low, i, j);
    index.push(top, rows * points + j, rows * points + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  const o = outward(g);
  o.computeVertexNormals();
  return o;
}

// Two toes with a cleft between them, on one foot.
function clovenFoot(parts, cx, cz, q, { w, l, h, color, gap = 0.02 }) {
  for (const t of [1, -1]) {
    parts.push({ geometry: footSolid({ x: cx + t * (gap + w * 0.28), z: cz, w, l, h, q: t }), color });
  }
}

// A sphere of an eye, sunk into the head, wearing its tile straight on. Upper and lower lids are arcs lying on the
// ball, so nothing can be seen between lid and eye. The eye goes in `eyes`, the lids in `hard`.
function addEye(eyes, hard, field, q, guess, r, { lid = 0x171210, sink = 0.5, lidW = 0.86, lidH = 0.72, lash = 0, tiltF = 0, lidT = 1 } = {}) {
  const p = onSurface(field, guess);
  const n = fieldNormal(field, p);
  const axis = new THREE.Vector3(n[0], n[1], n[2]);
  axis.z += tiltF; axis.normalize();
  const c = [p[0] - axis.x * r * sink, p[1] - axis.y * r * sink, p[2] - axis.z * r * sink];
  // The bar of the pupil stays level however the head is carried.
  const across = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();
  const up = new THREE.Vector3().crossVectors(axis, across).normalize();
  const g = new THREE.SphereGeometry(r, 14, 10);
  const P = g.attributes.position; const U = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    const v = new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
    U.setXY(i, 0.5 + v.dot(across) / (2 * r), 0.5 + v.dot(up) / (2 * r));
  }
  g.translate(c[0], c[1], c[2]);
  eyes.push({ geometry: g, keepColor: true });
  // The lids.
  const on = (a, wide, high) => {
    const px = Math.cos(a) * wide * r; const py = Math.sin(a) * high * r;
    const d = Math.sqrt(Math.max(r * r * 0.02, r * r - px * px - py * py)) * 1.01;
    return [c[0] + across.x * px + up.x * py + axis.x * d, c[1] + across.y * px + up.y * py + axis.y * d, c[2] + across.z * px + up.z * py + axis.z * d];
  };
  const arc = (a0, a1, n2) => { const o = []; for (let i = 0; i <= n2; i++) o.push(on(mix(a0, a1, i / n2), lidW, lidH)); return o; };
  const T = r * lidT;
  hard.push({ geometry: tube(arc(0, Math.PI, 8), [T * 0.07, T * 0.12, T * 0.15, T * 0.12, T * 0.07], { sides: 4, steps: 10, round: 1 }), color: lid });
  hard.push({ geometry: tube(arc(Math.PI, Math.PI * 2, 8), [T * 0.06, T * 0.08, T * 0.09, T * 0.08, T * 0.06], { sides: 4, steps: 10, round: 1 }), color: lid });
  for (let i = 0; i < lash; i++) {
    const a = mix(0.35, Math.PI - 0.35, (i + 0.5) / lash);
    const root = on(a, lidW, lidH);
    const out = [axis.x * 0.6 + up.x * 0.8, axis.y * 0.6 + up.y * 0.8, axis.z * 0.6 + up.z * 0.8];
    const len = r * 0.42;
    hard.push({ geometry: tube([root, [root[0] + out[0] * len, root[1] + out[1] * len, root[2] + out[2] * len]], [r * 0.035, r * 0.008], { sides: 3, steps: 1, round: 0, straight: true }), color: 0x0c0a08 });
  }
}

// An ear: a closed leaf with a cup in it. `out` is the way it points, `broad` the way its width lies, and the
// sheet facing `face` is the inside. `droop` bends the tip toward -y, and an ear's colours are outside and inside.
function earSolid({ root, out, broad, L, W, cup = 0.1, droop = 0, thick = 0.03, outside, inside, nu = 6, nv = 8, face = [0, 0, 1], tipColor = null }) {
  const e1 = new THREE.Vector3(...out).normalize();
  const eb = new THREE.Vector3(...broad);
  const e3 = new THREE.Vector3().crossVectors(e1, eb).normalize();
  const e2 = new THREE.Vector3().crossVectors(e3, e1).normalize();
  const R = new THREE.Vector3(...root);
  const pt = (u, v) => {
    const a = L * v;
    const shape = Math.sin(Math.PI * clamp01(v ** 0.75)) ** 0.72;
    const wid = W * 0.5 * shape + 0.01;
    const U = u * 2 - 1;
    const c = cup * (1 - U * U) * Math.sin(Math.PI * v) * W;
    return [
      R.x + e1.x * a + e2.x * U * wid + e3.x * c,
      R.y + e1.y * a + e2.y * U * wid + e3.y * c - droop * L * v * v,
      R.z + e1.z * a + e2.z * U * wid + e3.z * c,
    ];
  };
  const g = solidSurface({ nu, nv, point: pt, thick: (u, v) => thick * (1 - 0.6 * v) * Math.max(0.05, 1 - (u * 2 - 1) ** 4) });
  const half = g.attributes.position.count / 2;
  let sum = 0;
  for (let i = 0; i < half; i++) sum += g.attributes.normal.getX(i) * face[0] + g.attributes.normal.getY(i) * face[1] + g.attributes.normal.getZ(i) * face[2];
  const firstFace = sum > 0;
  const off = lin(outside); const inn = lin(inside); const tip = tipColor ? lin(tipColor) : off;
  const cols = nu + 1; const rows = nv + 1;
  tintVertices(g, (x, y, z, o, i) => {
    const k = i < half ? i : i - half;
    const iu = Math.floor(k / rows); const jv = k % rows;
    const edge = Math.abs((iu / (cols - 1)) * 2 - 1);
    const isIn = (i < half) === firstFace;
    const c = isIn ? [mix(inn[0], off[0], sstep(edge, 0.55, 0.95)), mix(inn[1], off[1], sstep(edge, 0.55, 0.95)), mix(inn[2], off[2], sstep(edge, 0.55, 0.95))] : off;
    const t = sstep(jv / nv, 0.78, 1) * 0.85;
    o[0] = mix(c[0], tip[0], t); o[1] = mix(c[1], tip[1], t); o[2] = mix(c[2], tip[2], t);
  });
  return g;
}

// A tapering tail or hair rope with its own colour along its length.
function rope(points, radii, c0, c1, { sides = 6, steps = null, round = 1 } = {}) {
  const g = tube(points, radii, { sides, steps: steps ?? (points.length - 1) * 3, round });
  const a = lin(c0); const b = lin(c1);
  let y0 = 1e9; let y1 = -1e9;
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) { y0 = Math.min(y0, P.getY(i)); y1 = Math.max(y1, P.getY(i)); }
  tintVertices(g, (x, y, z, o) => {
    const t = (y1 - y) / Math.max(1e-3, y1 - y0);
    o[0] = mix(a[0], b[0], t); o[1] = mix(a[1], b[1], t); o[2] = mix(a[2], b[2], t);
  });
  return g;
}

// A hanging lock of hair: wide, flat, pointed, with a slight wave. The cheap way to a tail or a mane.
function lock(root, dir, side, L, W, { nv = 4, th = 0.02, droop = 0, wave = 0 } = {}) {
  const d = new THREE.Vector3(...dir).normalize();
  const s = new THREE.Vector3(...side).normalize();
  return solidSurface({
    nu: 2,
    nv,
    point: (u, v) => {
      const U = u * 2 - 1;
      const wid = (W / 2) * Math.max(0.03, (0.7 + 0.3 * sstep(v, 0, 0.3)) * (1 - v ** 2.4));
      const a = L * v;
      const sway = wave * Math.sin(v * 5.5) * v;
      return [
        root[0] + d.x * a + s.x * (U * wid + sway),
        root[1] + d.y * a + s.y * (U * wid + sway) - droop * L * v * v,
        root[2] + d.z * a + s.z * (U * wid + sway),
      ];
    },
    thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * v),
  });
}

// Assembles the skin: every zone is cut along the markings, if there are any, and merged.
function skinMesh(geometries, split, recolour, params) {
  const parts = geometries.map((g) => ({ geometry: split ? crispSplit(g, split, recolour) : g, keepColor: true }));
  return mesh(mergeParts(parts), standard({ vertexColors: true, metalness: 0, ...params }));
}

// A hoofed leg, front and back, so the joints bend the right way on every animal: the knee (a wrist, really) forward
// and straight above the foot, the hock standing out BEHIND, and the cannon then coming forward to the fetlock. Each
// returns where its foot is.
function foreLeg(s, W, q, { x, z, topY, topZ, elbowY, kneeY, fetY, rTop, rFore, rKnee, rCan, rFet, k = 0.3 }) {
  s.add(C([[q * x, topY, topZ], [q * (x + rFore * 0.08), elbowY, z - rFore * 0.2], [q * x, kneeY + rKnee, z]], [rTop, rFore, rKnee * 0.92], 6), W, { k });
  s.add(E([q * x, kneeY, z + rKnee * 0.22], [rKnee, rKnee * 1.12, rKnee]), W, { k: rKnee * 0.55 });
  s.add(C([[q * x, kneeY - rKnee * 0.5, z], [q * x, fetY + rFet * 0.5, z]], [rCan * 1.1, rCan], 2), W, { k: rCan * 0.6 });
  s.add(E([q * x, fetY, z + rFet * 0.14], [rFet, rFet * 0.92, rFet * 1.06]), W, { k: rCan * 0.5 });
  const fz = z + rFet * 0.14 + fetY * 0.22;
  s.add(C([[q * x, fetY, z + rFet * 0.14], [q * x, fetY * 0.4, fz]], [rCan * 0.92, rCan * 1.0], 2), W, { k: rCan * 0.4 });
  return { x: q * x, z: fz };
}

function hindLeg(s, W, q, { x, z, topY, topZ, stifleY, stifleZ, hockY, hockBack, fetY, rTop, rStifle, rGaskin, rHock, rCan, rFet, k = 0.3 }) {
  const hz = z - hockBack;
  s.add(C([[q * x, topY, topZ], [q * (x + rStifle * 0.3), stifleY, stifleZ], [q * x, hockY + (stifleY - hockY) * 0.42, mix(stifleZ, hz, 0.72)], [q * x, hockY + rHock, hz]], [rTop, rStifle, rGaskin, rHock * 0.86], 8), W, { k });
  s.add(E([q * x, hockY, hz], [rHock * 0.85, rHock * 1.3, rHock * 1.05]), W, { k: rHock * 0.5 });
  s.add(S([q * x, hockY + rHock * 1.15, hz - rHock * 0.86], rHock * 0.44), W, { k: rHock * 0.5 }); // the point of the hock
  s.add(C([[q * x, hockY - rHock * 0.5, hz + rHock * 0.1], [q * x, fetY + rFet * 0.5, z - rFet * 0.1]], [rCan * 1.1, rCan], 2), W, { k: rCan * 0.6 });
  s.add(E([q * x, fetY, z], [rFet, rFet * 0.92, rFet * 1.06]), W, { k: rCan * 0.5 });
  const fz = z + fetY * 0.2;
  s.add(C([[q * x, fetY, z], [q * x, fetY * 0.4, fz]], [rCan * 0.92, rCan * 1.0], 2), W, { k: rCan * 0.4 });
  return { x: q * x, z: fz };
}

// A short solid cylinder with a softened edge: a pig's snout disc.
function discP(c, axis, r, h, round = 0.02) {
  const a = new THREE.Vector3(...axis).normalize();
  const reach = r + h + round;
  return {
    box: [c[0] - reach, c[1] - reach, c[2] - reach, c[0] + reach, c[1] + reach, c[2] + reach],
    f: (x, y, z) => {
      const px = x - c[0]; const py = y - c[1]; const pz = z - c[2];
      const along = px * a.x + py * a.y + pz * a.z;
      const rx = px - a.x * along; const ry = py - a.y * along; const rz = pz - a.z * along;
      const d1 = Math.sqrt(rx * rx + ry * ry + rz * rz) - r;
      const d2 = (along < 0 ? -along : along) - h;
      const ox = d1 > 0 ? d1 : 0; const oy = d2 > 0 ? d2 : 0;
      return Math.sqrt(ox * ox + oy * oy) + Math.min(d1 > d2 ? d1 : d2, 0) - round;
    },
  };
}

// Every triangle takes the flat projection it faces most nearly, so nothing streaks. The seams this leaves are
// invisible on a pattern with no direction across them: fleece, speckle.
function boxUV(geometry, scaleAt = () => 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const P = g.attributes.position; const N = g.attributes.normal;
  const U = new Float32Array(P.count * 2);
  for (let t = 0; t < P.count; t += 3) {
    const nx = Math.abs(N.getX(t) + N.getX(t + 1) + N.getX(t + 2));
    const ny = Math.abs(N.getY(t) + N.getY(t + 1) + N.getY(t + 2));
    const nz = Math.abs(N.getZ(t) + N.getZ(t + 1) + N.getZ(t + 2));
    const sc = scaleAt(P.getX(t), P.getY(t), P.getZ(t));
    for (let i = t; i < t + 3; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      if (nx >= ny && nx >= nz) { U[i * 2] = z * sc; U[i * 2 + 1] = y * sc; } else if (ny >= nz) { U[i * 2] = z * sc; U[i * 2 + 1] = x * sc; } else { U[i * 2] = x * sc; U[i * 2 + 1] = y * sc; }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return g;
}

// A flat strap lying on a surface: the path is asked of the surface, and the strap's thin side is held to its normal.
function strap(field, points, width, thick, color, { n = 12, lift = 0.015, sides = 6 } = {}) {
  const path = pathOn(field, points, n, lift + thick * 0.4);
  return {
    geometry: tube(path, width / 2, {
      sides,
      steps: path.length - 1,
      round: 0,
      section: () => [(thick / width) * 1.0, 1],
      frame: (t, c) => fieldNormal(field, [c.x, c.y, c.z]),
    }),
    color,
  };
}

// Puts a surface-hugging ring together: a neck collar, a belly band. `at(a)` guesses a point; the surface says where it is.
function ringOn(field, at, n, lift) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(onSurface(field, at((i / n) * Math.PI * 2), lift, 8));
  return out;
}

const squash = (prim, sx, about = 0) => ({
  box: [about + (prim.box[0] - about) * sx, prim.box[1], prim.box[2], about + (prim.box[3] - about) * sx, prim.box[4], prim.box[5]],
  f: (x, y, z) => prim.f(about + (x - about) / sx, y, z) * Math.min(sx, 1),
});

// Dark bare skin and a coat with no patches: the shared options for anything sculpted, with occlusion in the creases.
const shadedOptions = (reach, floor, uvScale) => (s) => ({
  uvScale,
  extraReach: 0.04,
  tint: (x, y, z, nx, ny, nz, rgb) => {
    const open = occlusion(s.ops, x, y, z, nx, ny, nz, reach);
    const k = mix(floor, 1, open) * (0.88 + 0.12 * sstep(ny, -0.7, 0.2));
    rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
  },
});

// ---------------------------------------------------------------------------------------------
// Dairy cow
// ---------------------------------------------------------------------------------------------

// A Holstein, 8ft from nose to tail and 5ft at the withers. What makes her a dairy cow rather than a beef one is
// the frame: a straight flat topline with the hips standing up through the skin, a deep wedge of a barrel that gets
// bigger toward the back, a long lean neck, and all the weight in the udder.
const COW_HEAD = headFrame([0, 5.2, 2.98], 0.92, 1.14);

function cowField(cell) {
  const s = new Sculpt(cell);
  const W = lin(0xcfccc2);
  const PINK = lin(0xd98f8a);
  const H = COW_HEAD;
  s.add(bodyLoft([
    [-3.42, 4.5, 0.3, 0.14, 0.4],
    [-3.1, 4.2, 0.66, 0.6, 0.86],
    [-2.3, 3.84, 0.94, 1.08, 1.34],
    [-1.1, 3.56, 1.2, 1.24, 1.52],
    [0.2, 3.5, 1.2, 1.3, 1.44],
    [1.15, 3.55, 0.94, 1.34, 1.26],
    [1.95, 3.6, 0.7, 1.28, 1.14],
    [2.62, 3.72, 0.4, 0.78, 0.92],
  ]), W);
  // The frame, showing through: withers, a spine you can follow, hook bones, pin bones, and the flat rump between.
  s.add(E([0, 4.76, 1.5], [0.2, 0.26, 0.8]), W, { k: 0.26 });
  s.add(C([[0, 4.82, 0.9], [0, 4.82, -0.6], [0, 4.9, -2.1], [0, 4.84, -3.3]], [0.1, 0.13, 0.15, 0.1], 6), W, { k: 0.24 });
  s.add(both(C([[0.1, 4.82, -2.26], [0.94, 4.7, -2.16]], [0.2, 0.15], 1)), W, { k: 0.34 }); // the hook bones, wide and square
  s.add(both(C([[0.86, 4.68, -2.2], [0.42, 4.6, -3.28]], [0.13, 0.12], 1)), W, { k: 0.26 }); // down the rump to the pins
  s.add(both(E([0.4, 4.52, -3.38], [0.15, 0.15, 0.14])), W, { k: 0.14 });
  // The hollow in front of the hip, and the shoulder blade with its point.
  s.sub(both(E([1.26, 4.3, -1.42], [0.24, 0.46, 0.46])), null, { k: 0.46 });
  s.add(both(E([0.68, 4.0, 1.7], [0.2, 0.86, 0.44], [0.22, 0, 0])), W, { k: 0.3 });
  // The neck: long, lean, deep at the shoulder, with a little dewlap under it.
  s.add(C([[0, 3.86, 1.9], [0, 4.3, 2.36], [0, 4.76, 2.76], [0, 5.08, 3.0]], [0.9, 0.68, 0.48, 0.42], 8), W, { k: 0.3 });
  s.add(C([[0, 2.72, 2.56], [0, 3.14, 2.86], [0, 3.86, 3.12]], [0.22, 0.17, 0.1], 4), W, { k: 0.28 });

  // --- The legs -------------------------------------------------------------------------------------------
  for (const q of [1, -1]) {
    const fz = 1.72 + q * 0.08;
    s.add(C([[q * 0.72, 3.5, 1.82], [q * 0.76, 2.56, fz - 0.08], [q * 0.72, 1.66, fz + 0.03]], [0.54, 0.4, 0.22], 6), W, { k: 0.3 });
    s.add(E([q * 0.72, 1.48, fz + 0.06], [0.215, 0.235, 0.22]), W, { k: 0.12 }); // the knee
    s.add(C([[q * 0.72, 1.36, fz + 0.03], [q * 0.72, 0.56, fz + 0.04]], [0.165, 0.15], 2), W, { k: 0.1 });
    s.add(E([q * 0.72, 0.47, fz + 0.05], [0.18, 0.165, 0.19]), W, { k: 0.08 }); // the fetlock
    s.add(C([[q * 0.72, 0.45, fz + 0.05], [q * 0.72, 0.2, fz + 0.12]], [0.14, 0.15], 2), W, { k: 0.06 });
    // The hind leg: a broad flat thigh, the hock standing out BEHIND, and then the cannon coming forward to the foot.
    const hz = -2.62 - q * 0.1;
    s.add(C([[q * 0.7, 4.0, -2.5], [q * 0.92, 3.0, -2.06], [q * 0.78, 2.34, -2.6], [q * 0.74, 1.84, hz - 0.46]], [0.66, 0.6, 0.32, 0.19], 8), W, { k: 0.3 });
    s.add(E([q * 0.74, 1.72, hz - 0.46], [0.17, 0.26, 0.21]), W, { k: 0.1 }); // the hock
    s.add(S([q * 0.74, 1.96, hz - 0.64], 0.085), W, { k: 0.1 }); // its point
    s.add(C([[q * 0.74, 1.6, hz - 0.42], [q * 0.74, 0.56, hz - 0.08]], [0.165, 0.15], 2), W, { k: 0.1 });
    s.add(E([q * 0.74, 0.47, hz - 0.06], [0.18, 0.165, 0.19]), W, { k: 0.08 });
    s.add(C([[q * 0.74, 0.45, hz - 0.06], [q * 0.74, 0.2, hz + 0.02]], [0.14, 0.15], 2), W, { k: 0.06 });
  }

  // --- The udder: four quarters, four teats ------------------------------------------------------------------
  s.add(both(E([0.33, 2.2, -2.42], [0.44, 0.56, 0.54])), PINK, { k: 0.2, ck: 0.3 });
  s.add(both(E([0.34, 2.14, -1.56], [0.42, 0.5, 0.62])), PINK, { k: 0.2, ck: 0.3 });
  s.sub(E([0, 1.45, -2], [0.035, 0.34, 1.0]), null, { k: 0.08 }); // the groove between left and right
  const TEAT = lin(0xe29c94);
  s.add(both(C([[0.36, 1.82, -2.56], [0.38, 1.36, -2.6]], [0.095, 0.058], 2)), TEAT, { k: 0.07 });
  s.add(both(C([[0.36, 1.78, -1.48], [0.38, 1.32, -1.44]], [0.095, 0.058], 2)), TEAT, { k: 0.07 });

  // --- The head ---------------------------------------------------------------------------------------------
  s.add(H.E(0, 0.0, 0.44, [0.47, 0.4, 0.56]), W, { k: 0.2 }); // the broad forehead
  s.add(H.C([[0, -0.03, 0.5], [0, -0.13, 1.0], [0, -0.2, 1.46]], [0.36, 0.28, 0.27]), W, { k: 0.18 });
  s.add(H.E(0, -0.28, 1.6, [0.34, 0.27, 0.32]), W, { k: 0.14 }); // the broad muzzle
  s.add(H.C([[0, -0.4, 0.36], [0, -0.52, 0.96], [0, -0.5, 1.56]], [0.3, 0.19, 0.17]), W, { k: 0.16 }); // the lower jaw
  s.add(both(H.E(0.26, -0.28, 0.4, [0.2, 0.3, 0.38])), W, { k: 0.14 }); // the cheek
  s.add(both(H.E(0.36, 0.14, 0.62, [0.16, 0.13, 0.2])), W, { k: 0.12 }); // the brow
  s.add(H.E(0, 0.28, 0.04, [0.3, 0.14, 0.2]), W, { k: 0.14 }); // the poll
  s.add(both(H.E(0.4, 0.1, 0.03, [0.15, 0.12, 0.14])), W, { k: 0.1 }); // the root of the ear
  s.sub(both(H.C([[0.31, -0.46, 1.38], [0.27, -0.5, 1.66], [0.1, -0.52, 1.88], [-0.01, -0.53, 1.92]], [0.03, 0.03, 0.03, 0.03])), lin(0x2a1a1a), { k: 0.02, ck: 0.04 });
  return s;
}

function dairyCow() {
  const rng = seededRandom(7711);
  const H = COW_HEAD;
  const optionsFor = (s) => ({
    uvScale: 1.5,
    extraReach: 0.05,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const open = occlusion(s.ops, x, y, z, nx, ny, nz, 0.28);
      const k = mix(0.62, 1, open) * (0.88 + 0.12 * sstep(ny, -0.7, 0.2));
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });
  const skin = zoned(cowField, 0.2, [
    { cell: 0.07, box: [-0.82, 3.6, 3.0, 0.82, 5.8, 4.8] },
    { cell: 0.1, box: [-1.15, 0.05, -3.4, 1.15, 1.42, 2.3] },
    { cell: 0.1, box: [-1.0, 1.42, -3.5, 1.0, 2.2, -0.9] },
  ], optionsFor);

  // The patches, laid by hand on each side rather than scattered: a Holstein is a few very large shapes, a black
  // neck and shoulder, a saddle, a rump, with white legs, belly and tail, and each animal's are its own.
  const headBlob = (x, v, w, r, sz) => [H.H(x, v, w), [r[0] * H.s, r[1] * H.s, r[2] * H.s, sz]];
  const black = markings([
    [[0, 4.5, 2.2], [1.6, 1.15, 1.18, 0.9]],
    [[1.05, 3.9, 0.9], [0.7, 0.95, 0.95, 0.7]],
    [[-0.9, 4.1, -0.35], [0.8, 1.05, 1.5, 0.8]],
    [[1.1, 4.45, -1.2], [0.6, 0.68, 0.9, 0.5]],
    [[-1.0, 3.2, -2.25], [0.5, 0.6, 0.62, 0.4]],
    [[0.9, 3.75, -2.75], [0.9, 0.9, 0.75, 0.6]],
    [[-0.9, 4.5, -2.9], [0.6, 0.62, 0.72, 0.5]],
    // Cheeks, eyes and poll: two patches that leave a white blaze down the middle of the face.
    headBlob(0.44, -0.02, 0.5, [0.34, 0.52, 0.66], 0.42),
    headBlob(-0.44, -0.02, 0.5, [0.34, 0.52, 0.66], 0.42),
  ], 0.9);
  const side = (x, y, z) => {
    // Nothing below the knee and hock, and nothing on the udder, however a blob wanders.
    let b = black(x, y, z);
    b = Math.min(b, y - 2.42);
    return -b;
  };
  const BK = [0.028, 0.027, 0.03];
  const recolour = (c0, c1, c2, x, y, z, o) => { const k = c0 / 0.62; o[0] = BK[0] * k; o[1] = BK[1] * k; o[2] = BK[2] * k; };

  const field = cowField(0.06).snapshot();
  const hard = []; const eyes = []; const hair = [];

  // Hooves, cloven.
  const HOOF = 0x2a2420;
  for (const q of [1, -1]) {
    clovenFoot(hard, q * 0.72, 1.72 + q * 0.08 + 0.17, q, { w: 0.135, l: 0.25, h: 0.27, color: HOOF });
    clovenFoot(hard, q * 0.74, -2.62 - q * 0.1 + 0.07, q, { w: 0.135, l: 0.25, h: 0.27, color: HOOF });
  }
  // Short pale horns, darker at the tip, curving out and forward.
  for (const q of [1, -1]) {
    const a = H.H(q * 0.3, 0.26, 0.0); const b = H.H(q * 0.5, 0.42, -0.02); const c = H.H(q * 0.62, 0.62, 0.08);
    const g = tube([a, b, c], [0.1, 0.07, 0.012], { sides: 8, steps: 7, round: 0 });
    const top = c[1];
    tintVertices(g, (x, y, z, o) => { const t = sstep(y, top - 0.22, top); o[0] = mix(0.72, 0.16, t); o[1] = mix(0.66, 0.12, t); o[2] = mix(0.5, 0.1, t); });
    hard.push({ geometry: g, keepColor: true });
  }
  // The wet nose: a dark pad, its own solid, with two nostrils in it.
  const pad = H.H(0, -0.21, 1.78);
  hard.push({ geometry: new THREE.SphereGeometry(1, 14, 10).scale(0.26 * H.s, 0.17 * H.s, 0.2 * H.s).rotateX(H.rot[0]).translate(pad[0], pad[1], pad[2]), color: 0x2c2125 });
  for (const q of [1, -1]) {
    const nn = H.H(q * 0.135, -0.105, 1.885);
    hard.push({ geometry: new THREE.SphereGeometry(1, 8, 6).scale(0.06 * H.s, 0.024 * H.s, 0.04 * H.s).rotateX(H.rot[0] - 0.5).translate(nn[0], nn[1], nn[2]), color: 0x050404 });
  }
  // Eyes, large and dark and set on the corners of the head, turned a little forward so they read from the front.
  for (const q of [1, -1]) addEye(eyes, hard, field, q, H.H(q * 0.47, 0.06, 0.68), 0.15, { lash: 5, lid: 0x121011, sink: 0.42, tiltF: 0.55 });

  // Ears, black outside and pink inside, held out sideways below the horns.
  const ears = [];
  for (const q of [1, -1]) {
    ears.push({ geometry: earSolid({
      root: H.H(q * 0.42, 0.06, 0.04), out: [q * 0.8, -0.12, -0.55], broad: [0, 1, 0.1], L: 0.86, W: 0.46, cup: 0.14, droop: 0.06, thick: 0.03,
      outside: 0x17161a, inside: 0xc98a86, face: [q * 0.5, -0.1, 1],
    }), keepColor: true });
  }

  // The tail: long and thin from a high tailhead, ending in a dark switch.
  const tailPts = [[0, 4.86, -3.24], [0, 4.72, -3.5], [0, 3.9, -3.62], [0, 2.9, -3.6], [0, 1.95, -3.56]];
  hair.push({ geometry: rope(tailPts, [0.14, 0.1, 0.06, 0.05, 0.05], 0xcfccc2, 0xb8b4a8, { sides: 7, steps: 12 }), keepColor: true });
  const SWITCH = lin(0x17161a); const SWITCH2 = lin(0x3a3634);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 * 3.3;
    const rr = 0.03 + rng() * 0.07;
    const dx = Math.cos(a) * rr; const dz = Math.sin(a) * rr;
    const c = rng() > 0.6 ? SWITCH2 : SWITCH;
    const g = lock([dx, 2.3 - rng() * 0.45, -3.56 + dz], [dx * 1.6, -1, dz * 1.6], [Math.cos(a + 1.57), 0, Math.sin(a + 1.57)], 0.75 + rng() * 0.75, 0.15, { nv: 3, th: 0.025, wave: 0.03 });
    tintVertices(g, (x, y, z, o) => { o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; });
    hair.push({ geometry: g, keepColor: true });
  }

  const root = new THREE.Group();
  root.name = 'dairy-cow';
  const nap = napMap(7712);
  const DZ = -0.32;
  const add = (m) => { m.geometry.translate(0, 0, DZ); root.add(m); };
  add(skinMesh(skin, side, recolour, { map: nap, bumpMap: nap, bumpScale: 0.2, roughness: 0.82 }));
  add(mesh(mergeParts([...hair, ...ears]), standard({ vertexColors: true, roughness: 0.8, metalness: 0 })));
  add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.32, metalness: 0 })));
  const tile = eyeTile({ iris: '#5e3a1a', rim: '#1e1006', pupil: 'bar', pupilW: 0.5, pupilH: 0.2, irisR: 0.86, sclera: '#2c1e14' });
  add(mesh(mergeParts(eyes), standard({ map: tile, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.14, roughness: 0.14, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Sheep
// ---------------------------------------------------------------------------------------------

// A Suffolk: a deep fleece with a bare black face and legs, and long ears that hang out sideways. The fleece is its
// own solid laid over the body, so its edge round the neck and legs is a real edge rather than a colour change.
// What makes it fleece is the silhouette: the surface is creased into cauliflower lumps, and creases shade dark.
const SHEEP_HEAD = headFrame([0, 2.56, 1.28], 0.92, 1.06);

const woolLump = (x, y, z) => {
  const wx = x + 0.2 * Math.sin(3.3 * z + 1.3 * y) + 0.06 * Math.sin(9.1 * y);
  const wy = y + 0.24 * Math.sin(2.9 * x + 2.7 * z) + 0.06 * Math.sin(8.3 * z);
  const wz = z + 0.2 * Math.sin(3.7 * y + 1.9 * x) + 0.06 * Math.sin(8.7 * x);
  const a = Math.sin(10.5 * wx); const b = Math.sin(10.5 * wy); const c = Math.sin(10.5 * wz);
  return Math.sqrt(Math.abs(a * b * c));
};

function fleeceField(cell) {
  const s = new Sculpt(cell);
  const W = lin(0xdcd3bc);
  s.add(bodyLoft([
    [-1.9, 1.76, 0.3, 0.3, 0.32],
    [-1.6, 1.78, 0.7, 0.58, 0.66],
    [-0.9, 1.74, 0.96, 0.72, 0.76],
    [0.05, 1.7, 1.0, 0.78, 0.8],
    [0.8, 1.76, 0.86, 0.72, 0.7],
    [1.2, 1.9, 0.6, 0.54, 0.56],
  ]), W);
  s.add(both(E([0.54, 1.5, -1.38], [0.4, 0.58, 0.5])), W, { k: 0.24 }); // the thigh, in its breeches
  s.add(both(E([0.56, 1.52, 0.86], [0.34, 0.52, 0.4])), W, { k: 0.24 }); // the shoulder
  s.add(C([[0, 1.96, 1.0], [0, 2.2, 1.08], [0, 2.38, 1.08]], [0.5, 0.4, 0.28], 4), W, { k: 0.2 }); // the neck ruff
  s.add(C([[0, 2.14, -1.72], [0, 1.74, -2.02]], [0.18, 0.13], 2), W, { k: 0.12 }); // the docked tail
  s.add(SHEEP_HEAD.E(0, 0.1, 0.08, [0.17, 0.1, 0.17]), W, { k: 0.14 }); // the woolly cap between the ears
  s.map((d, x, y, z) => (d > 0.3 ? d : d - 0.1 * woolLump(x, y, z)));
  return s;
}

function sheepSkinField(cell) {
  const s = new Sculpt(cell);
  const D = lin(0x3a302b);
  const H = SHEEP_HEAD;
  // The neck comes out of the fleece, and the head is long and Roman-nosed.
  s.add(C([[0, 2.14, 0.98], [0, 2.32, 1.14], [0, 2.46, 1.3]], [0.25, 0.24, 0.22], 3), D);
  s.add(H.E(0, 0, 0.26, [0.235, 0.235, 0.32]), D, { k: 0.1 }); // the skull
  s.add(H.C([[0, 0.05, 0.34], [0, 0.04, 0.62], [0, -0.02, 0.86]], [0.17, 0.13, 0.105]), D, { k: 0.08 }); // the long Roman nose
  s.add(H.E(0, -0.09, 0.93, [0.135, 0.12, 0.115]), lin(0x54463f), { k: 0.06, ck: 0.1 }); // the muzzle
  s.add(H.C([[0, -0.17, 0.28], [0, -0.2, 0.6], [0, -0.19, 0.9]], [0.15, 0.095, 0.075]), D, { k: 0.07 }); // the jaw
  s.add(both(H.E(0.17, 0.1, 0.42, [0.08, 0.06, 0.12])), D, { k: 0.05 }); // the brow
  s.add(both(H.E(0.2, 0.02, 0.05, [0.07, 0.06, 0.08])), D, { k: 0.06 }); // the root of the ear
  const NOSE = lin(0x0b0908);
  s.sub(both(H.C([[0.06, -0.03, 1.02], [0.1, 0.0, 0.95]], [0.03, 0.022])), NOSE, { k: 0.015, ck: 0.035 });
  s.sub(H.C([[-0.12, -0.19, 0.94], [0, -0.21, 1.03], [0.12, -0.19, 0.94]], [0.02, 0.02, 0.02]), NOSE, { k: 0.01, ck: 0.035 });
  // The bare legs, rooted well inside the fleece.
  for (const q of [1, -1]) {
    foreLeg(s, D, q, { x: 0.46, z: 0.86 + q * 0.04, topY: 1.5, topZ: 0.86, elbowY: 1.12, kneeY: 0.66, fetY: 0.2, rTop: 0.2, rFore: 0.14, rKnee: 0.09, rCan: 0.058, rFet: 0.072, k: 0.1 });
    hindLeg(s, D, q, { x: 0.47, z: -1.28 - q * 0.05, topY: 1.5, topZ: -1.3, stifleY: 1.14, stifleZ: -1.18, hockY: 0.82, hockBack: 0.24, fetY: 0.2, rTop: 0.24, rStifle: 0.2, rGaskin: 0.11, rHock: 0.09, rCan: 0.058, rFet: 0.072, k: 0.1 });
  }
  return s;
}

function sheep() {
  const fleeceS = fleeceField(0.074);
  const fleece = boxUV(polygonize(fleeceS, {
    extraReach: 0.16,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const open = occlusion(fleeceS.ops, x, y, z, nx, ny, nz, 0.22);
      const crease = woolLump(x, y, z);
      const k = mix(0.6, 1, open) * mix(0.78, 1, sstep(crease, 0.1, 0.6)) * (0.86 + 0.14 * sstep(ny, -0.7, 0.3));
      const warm = 0.96 + 0.08 * Math.sin(1.7 * z + 2.3 * x);
      rgb[0] *= k * warm; rgb[1] *= k; rgb[2] *= k * (2 - warm);
    },
  }), () => 2.2);
  const skinOpts = shadedOptions(0.1, 0.55, 3);
  // The part of the neck and legs inside the fleece can never be seen, so it is not kept.
  const skin = zoned(sheepSkinField, 0.066, [{ cell: 0.046, box: [-0.5, 1.45, 1.3, 0.5, 3.0, 2.2] }], skinOpts);
  const inFleece = fleeceField(0.08).snapshot();
  for (const g of skin) dropWhere(g, (x, y, z) => inFleece.d(x, y, z) < -0.05);
  const field = sheepSkinField(0.04).snapshot();
  const H = SHEEP_HEAD;
  const hard = []; const eyes = []; const ears = [];
  for (const q of [1, -1]) {
    clovenFoot(hard, q * 0.46, 0.86 + q * 0.04 + 0.08, q, { w: 0.056, l: 0.095, h: 0.1, color: 0x1e1712, gap: 0.009 });
    clovenFoot(hard, q * 0.47, -1.28 - q * 0.05 + 0.07, q, { w: 0.056, l: 0.095, h: 0.1, color: 0x1e1712, gap: 0.009 });
    addEye(eyes, hard, field, q, H.H(q * 0.2, 0.05, 0.46), 0.098, { lid: 0x14100e, sink: 0.4, tiltF: 0.75, lidH: 0.84, lidW: 0.92, lidT: 0.8 });
    // Long ears that hang out and down.
    ears.push({ geometry: earSolid({
      root: H.H(q * 0.2, 0.03, 0.04), out: [q * 0.82, -0.4, 0.0], broad: [q * 0.42, 0.82, -0.4], L: 0.6, W: 0.26, cup: 0.12, droop: 0.26, thick: 0.022,
      outside: 0x342b27, inside: 0x5a3c36, face: [q * 0.5, -0.3, 0.8],
    }), keepColor: true });
  }
  const root = new THREE.Group();
  root.name = 'sheep';
  const DZ = 0.02;
  const add = (m) => { m.geometry.translate(0, 0, DZ); root.add(m); };
  const woolTex = woolMap(8121);
  add(mesh(fleece, standard({ vertexColors: true, map: woolTex, bumpMap: woolTex, bumpScale: 0.8, roughness: 0.95, metalness: 0 })));
  const nap = napMap(8122, { lines: 420 });
  add(mesh(mergeParts([...skin.map((geometry) => ({ geometry, keepColor: true })), ...ears]), standard({ vertexColors: true, map: nap, bumpMap: nap, bumpScale: 0.15, roughness: 0.72, metalness: 0 })));
  add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.34, metalness: 0 })));
  const tile = eyeTile({ iris: '#c79a3c', rim: '#5a3c12', pupil: 'bar', pupilW: 0.56, pupilH: 0.17, irisR: 0.9, sclera: '#3a2a18' });
  add(mesh(mergeParts(eyes), standard({ map: tile, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.12, roughness: 0.14, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Farm pig
// ---------------------------------------------------------------------------------------------

// A long barrel on short legs, a Gloucestershire Old Spots sort of pig: pink with a few dark spots. The head is a third of
// the character, and the snout is a real disc standing forward of the face with two holes in it.
const PIG_HEAD = headFrame([0, 2.44, 1.02], 0.42, 1.12);

function pigField(cell) {
  const s = new Sculpt(cell);
  const P = lin(0xe9a68f);
  const H = PIG_HEAD;
  s.add(bodyLoft([
    [-2.02, 1.66, 0.3, 0.3, 0.3],
    [-1.76, 1.62, 0.68, 0.7, 0.7],
    [-1.16, 1.6, 0.92, 0.86, 0.84],
    [-0.3, 1.58, 0.98, 0.92, 0.88],
    [0.5, 1.58, 0.94, 0.88, 0.84],
    [1.0, 1.66, 0.76, 0.72, 0.74],
    [1.3, 1.76, 0.54, 0.56, 0.6],
  ]), P);
  s.add(both(E([0.5, 1.54, -1.38], [0.44, 0.7, 0.62])), P, { k: 0.26 }); // the ham
  s.add(both(E([0.58, 1.56, 0.72], [0.36, 0.68, 0.5])), P, { k: 0.26 }); // the shoulder
  s.add(C([[0, 1.95, 1.06], [0, 2.16, 1.3]], [0.66, 0.58], 2), P, { k: 0.24 }); // the thick short neck
  // The head.
  s.add(H.E(0, -0.04, 0.2, [0.42, 0.38, 0.42]), P, { k: 0.2 });
  s.add(H.C([[0, -0.06, 0.34], [0, -0.15, 0.76], [0, -0.21, 1.08]], [0.34, 0.225, 0.2]), P, { k: 0.14 });
  s.add(both(H.E(0.25, -0.3, 0.22, [0.2, 0.22, 0.3])), P, { k: 0.14 }); // the jowl
  s.add(H.C([[0, -0.36, 0.3], [0, -0.42, 0.74], [0, -0.38, 1.02]], [0.2, 0.13, 0.08]), P, { k: 0.1 }); // the jaw
  s.add(both(H.E(0.26, 0.17, 0.42, [0.12, 0.08, 0.12])), P, { k: 0.08 }); // the brow
  s.add(both(H.E(0.24, 0.27, 0.06, [0.14, 0.1, 0.14])), P, { k: 0.08 }); // the root of the ear
  // The snout disc: flat, round, and paler at its rim.
  const axis = (() => { const a = H.H(0, -0.2, 0); const b = H.H(0, -0.2, 1); return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; })();
  s.add(discP(H.H(0, -0.21, 1.16), axis, 0.235 * H.s, 0.06 * H.s, 0.035 * H.s), lin(0xf0b4a0), { k: 0.05, ck: 0.05 });
  s.sub(both(H.E(0.09, -0.21, 1.27, [0.045, 0.06, 0.09])), lin(0x2a0f0d), { k: 0.012, ck: 0.03 });
  // The mouth: a long line back to under the eye, turned up at the end.
  s.sub(both(H.C([[0.28, -0.3, 0.46], [0.22, -0.37, 0.68], [0.14, -0.385, 1.0], [0, -0.39, 1.14]], [0.02, 0.022, 0.022, 0.022])), lin(0x6e3530), { k: 0.014, ck: 0.035 });
  // The legs, short and stout.
  for (const q of [1, -1]) {
    foreLeg(s, P, q, { x: 0.55, z: 0.74 + q * 0.04, topY: 1.3, topZ: 0.74, elbowY: 0.95, kneeY: 0.6, fetY: 0.26, rTop: 0.34, rFore: 0.21, rKnee: 0.135, rCan: 0.105, rFet: 0.115, k: 0.14 });
    hindLeg(s, P, q, { x: 0.56, z: -1.42 - q * 0.05, topY: 1.3, topZ: -1.46, stifleY: 1.0, stifleZ: -1.3, hockY: 0.68, hockBack: 0.14, fetY: 0.26, rTop: 0.4, rStifle: 0.28, rGaskin: 0.16, rHock: 0.125, rCan: 0.105, rFet: 0.115, k: 0.14 });
  }
  return s;
}

function farmPig() {
  const H = PIG_HEAD;
  const skin = zoned(pigField, 0.1, [
    { cell: 0.05, box: [-0.72, 1.0, 1.3, 0.72, 3.1, 2.75] },
    { cell: 0.07, box: [-0.95, 0.05, -2.0, 0.95, 0.72, 1.3] },
  ], shadedOptions(0.2, 0.6, 2));
  // A few big dark spots, placed so that one lands on the rump, one behind the shoulder and one by the ear.
  const spots = markings([
    [[0.82, 1.92, -0.42], [0.34, 0.34, 0.44, 0.3]],
    [[-0.86, 1.72, 0.2], [0.3, 0.32, 0.36, 0.26]],
    [[-0.4, 2.3, -1.2], [0.36, 0.28, 0.36, 0.24]],
    [[0.64, 1.72, -1.52], [0.26, 0.28, 0.26, 0.2]],
    [H.H(0.3, 0.17, 0.12), [0.18, 0.18, 0.2, 0.13]],
    [[0.3, 2.34, 0.62], [0.2, 0.18, 0.22, 0.13]],
  ], 0.62);
  const side = (x, y, z) => -spots(x, y, z);
  const DARK = lin(0x3a2520); const BASE = lin(0xe9a68f);
  const recolour = (c0, c1, c2, x, y, z, o) => { const k = Math.min(1.15, c0 / BASE[0]); o[0] = DARK[0] * k; o[1] = DARK[1] * k; o[2] = DARK[2] * k; };
  const field = pigField(0.05).snapshot();
  const hard = []; const eyes = []; const soft = [];
  for (const q of [1, -1]) {
    clovenFoot(hard, q * 0.55, 0.74 + q * 0.04 + 0.1, q, { w: 0.082, l: 0.135, h: 0.14, color: 0x6e5444, gap: 0.012 });
    clovenFoot(hard, q * 0.56, -1.42 - q * 0.05 + 0.09, q, { w: 0.082, l: 0.135, h: 0.14, color: 0x6e5444, gap: 0.012 });
    addEye(eyes, hard, field, q, H.H(q * 0.3, 0.06, 0.46), 0.095, { lid: 0x9a5a4c, sink: 0.45, tiltF: 0.9, lidH: 0.8, lidW: 0.9 });
    // Big floppy ears, up from the top of the head and then folding forward and down.
    soft.push({ geometry: earSolid({
      root: H.H(q * 0.26, 0.26, 0.05), out: [q * 0.7, 0.35, 0.55], broad: [q * -0.2, 0.9, 0.1], L: 0.82, W: 0.62, cup: 0.3, droop: 0.72, thick: 0.03,
      outside: 0xe39c86, inside: 0xd98c7c, face: [q * -0.46, -0.18, 0.7], nu: 6, nv: 8,
    }), keepColor: true });
  }
  // The tail, a tight corkscrew.
  const curl = [];
  for (let i = 0; i <= 26; i++) {
    const t = i / 26;
    const a = t * Math.PI * 2 * 2.4 + 0.8;
    const rr = 0.1 * (1 - 0.4 * t);
    curl.push([Math.cos(a) * rr * 1.1, 2.0 + Math.sin(a) * rr + 0.1 * t, -1.96 - 0.3 * t - (t < 0.1 ? 0 : 0.03)]);
  }
  curl[0] = [0.04, 1.96, -1.86];
  const tailG = tube(curl, [0.075, 0.062, 0.05, 0.042, 0.03], { sides: 6, steps: 34, round: 1 });
  const pk = lin(0xe39c86);
  tintVertices(tailG, (x, y, z, o) => { o[0] = pk[0]; o[1] = pk[1]; o[2] = pk[2]; });
  soft.push({ geometry: tailG, keepColor: true });

  const root = new THREE.Group();
  root.name = 'farm-pig';
  const DZ = -0.05;
  const add = (m) => { m.geometry.translate(0, 0, DZ); root.add(m); };
  const nap = napMap(8222, { lines: 200 });
  add(skinMesh(skin, side, recolour, { map: nap, bumpMap: nap, bumpScale: 0.08, roughness: 0.66 }));
  add(mesh(mergeParts(soft), standard({ vertexColors: true, roughness: 0.66, metalness: 0 })));
  add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.42, metalness: 0 })));
  const tile = eyeTile({ iris: '#4c3620', rim: '#20140a', pupil: 'round', pupilW: 0.34, irisR: 0.86, sclera: '#3a2a20' });
  add(mesh(mergeParts(eyes), standard({ map: tile, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.12, roughness: 0.14, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Goat
// ---------------------------------------------------------------------------------------------

// Lean and bright-eyed: every bone shows, the legs are long and thin, the tail stands up. The eye is built to be looked
// at, a wide golden iris with a level black bar for a pupil, since that is on its card.
const GOAT_HEAD = headFrame([0, 3.06, 1.0], 0.8, 1.16);

function goatField(cell) {
  const s = new Sculpt(cell);
  const W = lin(0xd8d0bc);
  const H = GOAT_HEAD;
  s.add(bodyLoft([
    [-1.56, 2.14, 0.22, 0.14, 0.22],
    [-1.3, 2.02, 0.44, 0.42, 0.5],
    [-0.7, 1.86, 0.52, 0.58, 0.6],
    [0.05, 1.82, 0.58, 0.66, 0.66],
    [0.55, 1.84, 0.5, 0.66, 0.6],
    [0.95, 1.9, 0.34, 0.56, 0.5],
  ]), W);
  s.add(C([[0, 2.44, 0.5], [0, 2.44, -0.4], [0, 2.46, -1.0], [0, 2.3, -1.5]], [0.07, 0.08, 0.09, 0.06], 5), W, { k: 0.14 }); // the spine
  s.add(both(E([0.32, 2.34, -0.98], [0.12, 0.08, 0.13])), W, { k: 0.3 }); // the hook bones
  s.add(E([0, 2.46, 0.62], [0.1, 0.1, 0.3]), W, { k: 0.14 }); // the withers
  s.add(both(E([0.34, 2.08, 0.72], [0.13, 0.4, 0.26], [0.2, 0, 0])), W, { k: 0.16 }); // the shoulder blade
  s.add(C([[0, 2.1, 0.84], [0, 2.44, 0.96], [0, 2.82, 1.0], [0, 3.04, 1.04]], [0.4, 0.28, 0.205, 0.2], 6), W, { k: 0.16 }); // the neck
  // The head: long, straight, narrow, with a bony forehead.
  s.add(H.E(0, 0.0, 0.26, [0.25, 0.23, 0.32]), W, { k: 0.1 });
  s.add(H.C([[0, 0.02, 0.3], [0, -0.03, 0.62], [0, -0.07, 0.84]], [0.19, 0.145, 0.125]), W, { k: 0.08 });
  s.add(H.E(0, -0.09, 0.9, [0.135, 0.12, 0.13]), W, { k: 0.07 }); // the muzzle
  s.add(H.C([[0, -0.2, 0.26], [0, -0.21, 0.6], [0, -0.19, 0.92]], [0.14, 0.09, 0.075]), W, { k: 0.07 }); // the jaw
  s.add(both(H.E(0.16, 0.1, 0.42, [0.08, 0.055, 0.12])), W, { k: 0.06 }); // the brow
  s.add(both(H.E(0.16, 0.18, 0.08, [0.07, 0.06, 0.08])), W, { k: 0.08 }); // the horn boss
  const NOSE = lin(0x1a1412);
  s.sub(both(H.C([[0.06, -0.04, 0.99], [0.09, -0.01, 0.93]], [0.022, 0.014])), NOSE, { k: 0.012, ck: 0.03 });
  s.sub(H.C([[-0.11, -0.2, 0.92], [0, -0.2, 1.0], [0.11, -0.2, 0.92]], [0.013, 0.013, 0.013]), NOSE, { k: 0.008, ck: 0.03 });
  for (const q of [1, -1]) {
    foreLeg(s, W, q, { x: 0.3, z: 0.72 + q * 0.03, topY: 1.86, topZ: 0.74, elbowY: 1.3, kneeY: 0.82, fetY: 0.24, rTop: 0.26, rFore: 0.13, rKnee: 0.085, rCan: 0.052, rFet: 0.066, k: 0.1 });
    hindLeg(s, W, q, { x: 0.3, z: -1.02 - q * 0.04, topY: 1.86, topZ: -1.1, stifleY: 1.46, stifleZ: -0.82, hockY: 0.98, hockBack: 0.3, fetY: 0.24, rTop: 0.3, rStifle: 0.22, rGaskin: 0.1, rHock: 0.082, rCan: 0.052, rFet: 0.066, k: 0.1 });
  }
  return s;
}

function goat() {
  const rng = seededRandom(8320);
  const H = GOAT_HEAD;
  const skin = zoned(goatField, 0.085, [
    { cell: 0.04, box: [-0.45, 2.05, 0.95, 0.45, 3.5, 2.0] },
    { cell: 0.055, box: [-0.56, 0.05, -1.5, 0.56, 1.2, 1.1] },
  ], shadedOptions(0.14, 0.58, 2.6));
  const hb = (x, v, w, r, sz) => [H.H(x, v, w), [r[0] * H.s, r[1] * H.s, r[2] * H.s, sz]];
  const brown = markings([
    [[0, 2.5, 0.72], [0.9, 0.62, 0.6, 0.42]],
    [[0.5, 1.96, 0.1], [0.3, 0.48, 0.52, 0.3]],
    [[-0.5, 2.1, -0.1], [0.34, 0.44, 0.58, 0.3]],
    [[0, 2.2, -1.2], [0.7, 0.42, 0.42, 0.3]],
    hb(0.24, 0.0, 0.36, [0.2, 0.34, 0.46], 0.2),
    hb(-0.24, 0.0, 0.36, [0.2, 0.34, 0.46], 0.2),
  ], 0.32);
  const COAT = lin(0xd8d0bc); const BR = lin(0x7a431c);
  const side = (x, y, z) => -Math.min(brown(x, y, z), y - 0.85);
  const recolour = (c0, c1, c2, x, y, z, o) => { const k = Math.min(1.1, c0 / COAT[0]); o[0] = BR[0] * k; o[1] = BR[1] * k; o[2] = BR[2] * k; };
  const field = goatField(0.04).snapshot();
  const hard = []; const eyes = []; const soft = [];
  for (const q of [1, -1]) {
    clovenFoot(hard, q * 0.3, 0.72 + q * 0.03 + 0.07, q, { w: 0.05, l: 0.088, h: 0.1, color: 0x2e2218, gap: 0.008 });
    clovenFoot(hard, q * 0.32, -1.02 - q * 0.04 + 0.06, q, { w: 0.05, l: 0.088, h: 0.1, color: 0x2e2218, gap: 0.008 });
    addEye(eyes, hard, field, q, H.H(q * 0.215, 0.04, 0.42), 0.092, { lid: 0x2a1a10, sink: 0.42, tiltF: 0.3, lidH: 0.84, lidW: 0.94, lidT: 0.75 });
    // Short horns, sweeping up and back from the top of the head.
    const a = H.H(q * 0.16, 0.2, 0.08);
    const pts = [a, [a[0] + q * 0.04, a[1] + 0.2, a[2] - 0.03], [a[0] + q * 0.08, a[1] + 0.36, a[2] - 0.2], [a[0] + q * 0.11, a[1] + 0.4, a[2] - 0.44]];
    const g = tube(pts, [0.078, 0.062, 0.042, 0.008], { sides: 7, steps: 10, round: 0 });
    tintVertices(g, (x, y, z, o, i) => { const band = Math.floor(i / 7) % 2 ? 1 : 0.84; const t = sstep(z, a[2], a[2] - 0.4); o[0] = mix(0.3, 0.14, t) * band; o[1] = mix(0.25, 0.1, t) * band; o[2] = mix(0.18, 0.07, t) * band; });
    hard.push({ geometry: g, keepColor: true });
    // Upright ears, a little outward: the tips carry the character.
    soft.push({ geometry: earSolid({
      root: H.H(q * 0.2, 0.1, 0.02), out: [q * 0.66, 0.66, -0.12], broad: [0, 0.1, 1], L: 0.5, W: 0.22, cup: 0.14, thick: 0.02,
      outside: 0x7a431c, inside: 0xd8a896, face: [q * 0.3, 0, 1],
    }), keepColor: true });
  }
  // The chin beard, a tapering bunch of locks.
  const BEARD = lin(0x2c1e14);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 * 2.7;
    const dx = Math.cos(a) * 0.045; const dz = Math.sin(a) * 0.05;
    const r0 = H.H(dx, -0.24, 0.8 + dz);
    const g = lock(r0, [dx * 1.2, -1, -0.12 + dz * 1.4], [Math.cos(a + 1.57), 0, Math.sin(a + 1.57)], 0.36 + rng() * 0.18, 0.12, { nv: 3, th: 0.016 });
    tintVertices(g, (x, y, z, o) => { o[0] = BEARD[0]; o[1] = BEARD[1]; o[2] = BEARD[2]; });
    soft.push({ geometry: g, keepColor: true });
  }
  // The short perky tail, up and back, with a tuft of its own.
  soft.push({ geometry: rope([[0, 2.32, -1.42], [0, 2.46, -1.56], [0, 2.68, -1.62]], [0.07, 0.055, 0.025], 0x7a431c, 0x4a2a12, { sides: 6, steps: 6 }), keepColor: true });

  const root = new THREE.Group();
  root.name = 'goat';
  const DZ = -0.2;
  const add = (m) => { m.geometry.translate(0, 0, DZ); root.add(m); };
  const nap = napMap(8322, { lines: 420 });
  add(skinMesh(skin, side, recolour, { map: nap, bumpMap: nap, bumpScale: 0.18, roughness: 0.82 }));
  add(mesh(mergeParts(soft), standard({ vertexColors: true, roughness: 0.8, metalness: 0 })));
  add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.4, metalness: 0 })));
  const tile = eyeTile({ iris: '#e0aa34', rim: '#8a5614', pupil: 'bar', pupilW: 0.64, pupilH: 0.17, irisR: 0.97, sclera: '#6a4a18' });
  add(mesh(mergeParts(eyes), standard({ map: tile, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.16, roughness: 0.12, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Draft horse
// ---------------------------------------------------------------------------------------------

// A Belgian, 9ft long and 6ft at the withers: the arched neck, the great chest and rump, the short thick legs ending in
// white feather over dinner-plate hooves, and the working harness that is the point of it. The collar is a real ring
// round the neck, asked of the neck where its surface is, so it can be pushed against and not float.
const HORSE_HEAD = headFrame([0, 7.62, 3.72], 1.0, 1.0);
const COAT_HORSE = 0x8f4f22;

function horseField(cell) {
  const s = new Sculpt(cell);
  const W = lin(COAT_HORSE);
  const H = HORSE_HEAD;
  s.add(bodyLoft([
    [-3.98, 5.1, 0.74, 0.52, 0.66],
    [-3.45, 5.0, 1.26, 0.98, 1.14],
    [-2.45, 4.78, 1.5, 1.24, 1.48],
    [-1.2, 4.6, 1.52, 1.22, 1.58],
    [0.2, 4.56, 1.48, 1.26, 1.54],
    [1.2, 4.68, 1.36, 1.26, 1.5],
    [2.1, 4.74, 1.2, 1.2, 1.44],
    [2.9, 4.8, 0.88, 0.85, 1.08],
  ]), W);
  s.add(E([0, 5.72, 1.5], [0.32, 0.26, 0.86]), W, { k: 0.4 }); // the withers
  s.add(both(E([0.55, 5.72, -2.7], [0.6, 0.32, 0.86])), W, { k: 0.3 }); // the two halves of the great split croup
  s.add(both(E([1.08, 5.02, 1.9], [0.32, 1.1, 0.72], [0.26, 0, 0])), W, { k: 0.5 }); // the shoulder
  s.add(both(E([0.6, 3.98, 2.72], [0.56, 0.84, 0.5])), W, { k: 0.4 }); // the chest, two muscles with a groove between
  s.add(both(E([1.0, 4.5, -3.06], [0.52, 1.2, 0.9])), W, { k: 0.5 }); // the quarters
  // The neck, thick and arched, with a heavy crest along the top.
  s.add(squash(C([[0, 4.9, 2.1], [0, 5.72, 2.68], [0, 6.5, 3.2], [0, 7.14, 3.7]], [1.28, 1.02, 0.76, 0.56], 8), 0.86), W, { k: 0.5 });
  s.add(C([[0, 6.1, 1.62], [0, 7.02, 2.26], [0, 7.62, 2.98], [0, 7.76, 3.58]], [0.26, 0.34, 0.3, 0.18], 8), W, { k: 0.5 });
  // The head.
  const G = lin(0x4a3a34);
  s.add(H.E(0, 0.0, 0.76, [0.56, 0.42, 0.86]), W, { k: 0.26 });
  s.add(H.C([[0, -0.05, 0.9], [0, -0.17, 1.86], [0, -0.28, 2.42]], [0.48, 0.34, 0.33]), W, { k: 0.22 });
  s.add(H.E(0, -0.4, 2.6, [0.44, 0.36, 0.38]), G, { k: 0.18, ck: 0.22 }); // the soft muzzle
  s.add(both(H.E(0.3, -0.5, 0.72, [0.22, 0.54, 0.66])), W, { k: 0.2 }); // the round flat cheek
  s.add(H.C([[0, -0.76, 1.0], [0, -0.74, 1.86], [0, -0.68, 2.46]], [0.3, 0.18, 0.2]), W, { k: 0.18 }); // the jaw
  s.add(both(H.E(0.46, 0.17, 0.82, [0.14, 0.1, 0.22])), W, { k: 0.12 }); // the brow
  s.add(both(H.E(0.3, 0.26, 0.06, [0.16, 0.14, 0.16])), W, { k: 0.1 }); // the root of the ear
  s.sub(both(H.E(0.24, -0.26, 2.86, [0.1, 0.14, 0.1])), lin(0x120c0a), { k: 0.03, ck: 0.05 }); // the wide nostrils
  s.sub(both(H.C([[0.34, -0.72, 2.32], [0.26, -0.74, 2.66], [0.1, -0.74, 2.9], [0, -0.74, 2.94]], [0.028, 0.03, 0.03, 0.03])), lin(0x120c0a), { k: 0.02, ck: 0.05 });
  // The legs, massive at every joint.
  for (const q of [1, -1]) {
    foreLeg(s, W, q, { x: 0.94, z: 2.26 + q * 0.14, topY: 4.6, topZ: 2.0, elbowY: 3.42, kneeY: 2.14, fetY: 0.86, rTop: 0.9, rFore: 0.6, rKnee: 0.38, rCan: 0.27, rFet: 0.34, k: 0.45 });
    hindLeg(s, W, q, { x: 0.92, z: -3.12 - q * 0.16, topY: 5.0, topZ: -3.1, stifleY: 3.82, stifleZ: -2.1, hockY: 2.66, hockBack: 0.58, fetY: 0.86, rTop: 1.0, rStifle: 0.84, rGaskin: 0.48, rHock: 0.38, rCan: 0.27, rFet: 0.34, k: 0.45 });
    // The bulk of the feather, under the hair itself.
    const fz = 2.26 + q * 0.14 + 0.1; const hz = -3.12 - q * 0.16 + 0.05;
    s.add(C([[q * 0.94, 1.5, fz - 0.06], [q * 0.94, 0.5, fz + 0.02]], [0.27, 0.44], 2), W, { k: 0.14 });
    s.add(C([[q * 0.92, 1.5, hz - 0.06], [q * 0.92, 0.5, hz + 0.02]], [0.27, 0.44], 2), W, { k: 0.14 });
  }
  return s;
}

function draftHorse() {
  const rng = seededRandom(8420);
  const H = HORSE_HEAD;
  const skin = zoned(horseField, 0.27, [
    { cell: 0.11, box: [-0.95, 5.0, 3.5, 0.95, 8.3, 5.5] },
    { cell: 0.16, box: [-1.55, 0.05, -4.2, 1.55, 1.9, 3.2] },
  ], shadedOptions(0.45, 0.62, 1));
  const inBlaze = (x, y, z) => {
    const [lx, lv, lw] = H.local(x, y, z);
    const half = mix(0.13, 0.26, sstep(lw, 0.8, 2.3)) + 0.015 * Math.sin(lw * 9);
    const a = half - Math.abs(lx);
    const b = Math.min(lv + 0.42, lw - 0.42 - 0.03 * Math.sin(lx * 20), 2.5 - lw);
    return Math.min(a, b);
  };
  // White socks up to the knee and hock, with an edge that wanders.
  const sock = (x, y, z) => 1.5 + 0.09 * Math.sin(x * 11 + z * 7) + 0.04 * Math.sin(z * 23 + x * 17) - y;
  const side = (x, y, z) => -Math.max(inBlaze(x, y, z), sock(x, y, z));
  const BASE = lin(COAT_HORSE); const WHITE = lin(0xd8d2c4);
  const recolour = (c0, c1, c2, x, y, z, o) => { const k = Math.min(1.1, c0 / BASE[0]); o[0] = WHITE[0] * k; o[1] = WHITE[1] * k; o[2] = WHITE[2] * k; };

  const field = horseField(0.1).snapshot();
  const hard = []; const eyes = []; const hair = [];
  const LEATHER = 0x2e1b10; const LEATHER2 = 0x4a2c18; const BRASS = 0xcf9f35;

  // --- Hooves, huge, each on an iron shoe --------------------------------------------------------------------------
  const FEET = [];
  for (const q of [1, -1]) {
    FEET.push({ x: q * 0.94, z: 2.26 + q * 0.14 + 0.34 * 0.14 + 0.86 * 0.22, q });
    FEET.push({ x: q * 0.92, z: -3.12 - q * 0.16 + 0.86 * 0.2, q });
  }
  for (const f of FEET) {
    hard.push({ geometry: footSolid({ x: f.x, z: f.z + 0.02, w: 0.5, l: 0.56, h: 0.42, cloven: false, shrink: 0.84, slope: 0.14, y0: 0.08, rows: 2, points: 14 }), color: 0x3e3026 });
    hard.push({ geometry: footSolid({ x: f.x, z: f.z + 0.02, w: 0.535, l: 0.595, h: 0.09, cloven: false, shrink: 0.97, slope: 0, y0: 0, rows: 1, points: 14 }), color: 0x6a7078 });
    // The nail heads along the side of the shoe.
    for (const t of [1, -1]) {
      for (const a of [-0.5, 0.35]) {
        hard.push({ geometry: new THREE.SphereGeometry(0.02, 4, 2).translate(f.x + t * Math.cos(a) * 0.532, 0.05, f.z + 0.02 + Math.sin(a) * 0.59), color: 0xb4b8bc });
      }
    }
    // The feather: long white hair falling over the top of the hoof, heaviest behind.
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + rng() * 0.2;
      const rr = 0.26;
      const back = 0.5 - 0.5 * Math.sin(a); // 1 at the back
      const root = [f.x + Math.cos(a) * rr, 1.5 - rng() * 0.75, f.z - 0.06 + Math.sin(a) * rr];
      const L = (root[1] - (0.3 - back * 0.12)) * (0.78 + rng() * 0.3);
      const g = lock(root, [Math.cos(a) * 0.42, -1, Math.sin(a) * 0.42], [-Math.sin(a), 0, Math.cos(a)], L, 0.2, { nv: 2, th: 0.03 });
      const col = lin(0xe0d8c8);
      tintVertices(g, (x, y, z, o) => { const k = mix(0.8, 1, sstep(y, 0.2, 0.9)); o[0] = col[0] * k; o[1] = col[1] * k; o[2] = col[2] * k; });
      hair.push({ geometry: g, keepColor: true });
    }
  }

  // --- The face ------------------------------------------------------------------------------------------------------
  const ears = [];
  for (const q of [1, -1]) {
    addEye(eyes, hard, field, q, H.H(q * 0.56, 0.08, 0.86), 0.165, { lid: 0x1a120c, sink: 0.5, tiltF: 0.3, lash: 4, lidT: 0.8, lidH: 0.76, lidW: 0.92 });
    ears.push({ geometry: earSolid({
      root: H.H(q * 0.3, 0.26, 0.04), out: [q * 0.22, 1, 0.1], broad: [q * 0.9, 0, 0.42], L: 0.74, W: 0.42, cup: 0.16, thick: 0.03,
      outside: COAT_HORSE, inside: 0x5a3a24, face: [0, 0, 1], tipColor: 0x3a2412,
    }), keepColor: true });
  }

  // --- The mane: flaxen, falling to the near side from a crest that runs poll to withers --------------------------------
  const FLAX = lin(0xdcc48c); const FLAX2 = lin(0xc6a868);
  const crest = new THREE.CatmullRomCurve3([[0, 7.72, 3.56], [0, 7.5, 3.08], [0, 7.02, 2.46], [0, 6.42, 1.92], [0, 6.02, 1.5]].map((p) => new THREE.Vector3(...p)));
  // Each lock is asked of the neck where it can lie, then hangs on, so a mane cannot sink into the neck it grows from.
  const laid = (guesses, W, th, widthDir, c, nv = 4) => {
    const lane = guesses.map((p, r) => onSurface(field, p, 0.06 + 0.012 * r, 6));
    const curveL = new THREE.CatmullRomCurve3(lane.map((p) => new THREE.Vector3(...p)));
    const g = solidSurface({
      nu: 2,
      nv,
      point: (u, v) => {
        const p = curveL.getPoint(v);
        const wid = (W / 2) * Math.max(0.03, (0.7 + 0.3 * sstep(v, 0, 0.3)) * (1 - v ** 2.4)) * (u * 2 - 1);
        return [p.x + widthDir[0] * wid, p.y + widthDir[1] * wid, p.z + widthDir[2] * wid];
      },
      thick: (u, v) => th * Math.max(0, 1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * v),
    });
    const top = lane[0][1];
    tintVertices(g, (x, y, z, o) => { const k = mix(0.82, 1.05, sstep(y, top - 0.7, top)); o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; });
    hair.push({ geometry: g, keepColor: true });
  };
  // A roll of hair along the crest itself, which the locks grow out of.
  const crestP = [];
  for (let i = 0; i <= 8; i++) { const c = crest.getPointAt(i / 8); crestP.push(onSurface(field, [0, c.y + 0.5, c.z], 0.02, 8)); }
  const crestG = tube(crestP, [0.06, 0.09, 0.1, 0.1, 0.09, 0.06], { sides: 6, steps: 14, round: 1, section: () => [0.7, 1] });
  tintVertices(crestG, (x, y, z, o) => { o[0] = FLAX2[0]; o[1] = FLAX2[1]; o[2] = FLAX2[2]; });
  hair.push({ geometry: crestG, keepColor: true });
  const MANE = 36;
  for (let i = 0; i < MANE; i++) {
    const t = (i + 0.5) / MANE;
    const c0 = crest.getPointAt(t);
    const q = i % 2 ? 1 : -1;
    // Shorter where the collar sits, so nothing comes back out on the far side of it.
    const L = (1.1 + 0.55 * Math.sin(t * 2.8)) * (0.85 + rng() * 0.3) * (1 - 0.5 * sstep(t, 0.55, 0.85));
    const guesses = [];
    for (let r = 0; r <= 4; r++) { const f = r / 4; guesses.push([q * (0.03 + f * 1.1), c0.y + 0.5 * (1 - f) - L * f, c0.z - 0.2 * L * f]); }
    laid(guesses, 0.5, 0.05, [0, 0.24, 0.97], rng() > 0.45 ? FLAX : FLAX2);
  }
  // The forelock, between the ears and down the forehead.
  for (let i = 0; i < 9; i++) {
    const x = (i - 4) * 0.055;
    const L = 0.72 + rng() * 0.28;
    laid([H.H(x, 0.42, 0.02), H.H(x * 1.05, 0.46, L * 0.33), H.H(x * 1.15, 0.46, L * 0.66), H.H(x * 1.3, 0.42, L)], 0.15, 0.03, [1, 0, 0], i % 2 ? FLAX : FLAX2, 3);
  }
  // The tail: thick, flaxen, to the hocks.
  hair.push({ geometry: rope([[0, 5.86, -3.84], [0, 5.5, -4.14], [0, 4.7, -4.28], [0, 3.8, -4.3]], [0.2, 0.2, 0.17, 0.13], 0xb89a5a, 0xd0b476, { sides: 8, steps: 10 }), keepColor: true });
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 * 3.3;
    const rr = 0.09 + 0.1 * rng();
    const dx = Math.cos(a) * rr; const dz = Math.sin(a) * rr;
    const y0 = 5.2 - rng() * 1.2;
    const L = y0 - 1.75 - rng() * 0.6;
    const g = lock([dx, y0, -4.27 + dz], [dx * 0.24, -1, dz * 0.24], [Math.cos(a + 1.57), 0, Math.sin(a + 1.57)], L, 0.34, { nv: 5, th: 0.05, wave: 0.05 });
    const c = rng() > 0.45 ? FLAX : FLAX2;
    tintVertices(g, (x, y, z, o) => { const k = mix(0.9, 1.05, sstep(y, 2, 4)); o[0] = c[0] * k; o[1] = c[1] * k; o[2] = c[2] * k; });
    hair.push({ geometry: g, keepColor: true });
  }

  // --- The harness ----------------------------------------------------------------------------------------------------
  // The collar: a padded ring round the base of the neck, lying in a plane that leans back, wider at the bottom.
  const cTop = [0, 6.5, 2.06]; const cBot = [0, 4.46, 3.34];
  const cMid = [0, (cTop[1] + cBot[1]) / 2, (cTop[2] + cBot[2]) / 2];
  const halfA = Math.hypot(cTop[1] - cBot[1], cTop[2] - cBot[2]) / 2;
  const ua = [0, (cTop[1] - cBot[1]) / (2 * halfA), (cTop[2] - cBot[2]) / (2 * halfA)];
  const collarAt = (a) => {
    const c = Math.cos(a); const sn = Math.sin(a);
    // Egg-shaped: a real collar is narrow at the top and wide at the breast.
    const wide = 1.9 * (1 - 0.3 * c);
    const reach = halfA + 0.7;
    return [sn * wide, cMid[1] + ua[1] * c * reach, cMid[2] + ua[2] * c * reach];
  };
  const ring = ringOn(field, collarAt, 26, 0.13);
  const collarG = tube(ring, 0.27, { sides: 8, steps: 34, round: 0, section: () => [0.9, 0.86] });
  const CUSHION = lin(0x5c3a20); const RIM = lin(0x24150c);
  tintVertices(collarG, (x, y, z, o, i) => {
    // Rolled leather, darker toward its forward face where it is stitched.
    const j = i % 8;
    const t = 0.5 + 0.5 * Math.cos((j / 8) * Math.PI * 2 + 0.9);
    const k = i % 16 < 8 ? 1 : 0.92;
    o[0] = mix(RIM[0], CUSHION[0], t) * k; o[1] = mix(RIM[1], CUSHION[1], t) * k; o[2] = mix(RIM[2], CUSHION[2], t) * k;
  });
  hard.push({ geometry: outward(collarG), keepColor: true });
  // The brass hames, two curved bars standing proud of the forward face of the collar, each with a knob and a ring.
  const fwd = new THREE.Vector3(0, ua[2], -ua[1]).normalize();
  if (fwd.z < 0) fwd.multiplyScalar(-1);
  for (const q of [1, -1]) {
    const bar = [];
    // Hames are rigid, so they run on a smooth curve through every other point of the collar rather than following it.
    for (let i = 0; i <= 8; i += 2) {
      const idx = q > 0 ? 1 + i : 25 - i; // from near the top, down the side
      const r = ring[idx];
      const outX = Math.sign(r[0] || q) * 0.12;
      bar.push([r[0] + outX, r[1] + fwd.y * 0.2, r[2] + fwd.z * 0.2]);
    }
    hard.push({ geometry: tube(bar, [0.05, 0.062, 0.062, 0.055, 0.05], { sides: 5, steps: 12, round: 1 }), color: BRASS });
    const tip = bar[0];
    const up = [tip[0] + q * 0.04, tip[1] + 0.34, tip[2] - 0.14];
    hard.push({ geometry: tube([tip, up], [0.05, 0.035], { sides: 6, steps: 2, round: 0, straight: true }), color: BRASS });
    hard.push({ geometry: new THREE.SphereGeometry(0.085, 8, 6).translate(up[0], up[1], up[2]), color: BRASS });
    // A terret ring on the hame for the rein, and the hook the trace pulls from.
    const hookAt = bar[3];
    const hookG = new THREE.TorusGeometry(0.09, 0.022, 4, 10).rotateY(Math.PI / 2).translate(hookAt[0] + q * 0.06, hookAt[1], hookAt[2]);
    hard.push({ geometry: hookG, color: BRASS });
    // The trace: a broad leather strap from the hame back along the flank, hooked up over the back pad's strap.
    hard.push(strap(field, [[hookAt[0] + q * 0.1, hookAt[1], hookAt[2] - 0.1], [q * 1.5, 4.5, 1.1], [q * 1.56, 4.3, -0.4], [q * 1.54, 4.36, -1.6]], 0.2, 0.03, LEATHER2, { n: 12, lift: 0.015, sides: 4 }));
    // The hip strap, which holds the trace's end up from the back strap.
    hard.push(strap(field, [[0, 5.9, -1.5], [q * 0.9, 5.6, -1.55], [q * 1.4, 5.0, -1.6], [q * 1.54, 4.34, -1.62]], 0.14, 0.03, LEATHER, { n: 8, lift: 0.02, sides: 4 }));
  }
  // The back pad and belly band, a saddle's place, with the back strap running on from it to the tail.
  const beltZ = 0.72;
  const bandPts = ringOn(field, (a) => [Math.sin(a) * 2.2, 4.5 + Math.cos(a) * 2.2, beltZ], 22, 0.02);
  hard.push({ geometry: tube(bandPts, 0.11, { sides: 4, steps: 24, round: 0, section: () => [0.2, 1], frame: (t, c) => fieldNormal(field, [c.x, c.y, c.z]) }), color: LEATHER });
  hard.push(strap(field, [[-0.98, 5.34, 0.72], [-0.56, 5.72, 0.72], [0, 5.92, 0.72], [0.56, 5.72, 0.72], [0.98, 5.34, 0.72]], 0.66, 0.07, LEATHER2, { n: 10, lift: 0.02, sides: 6 }));
  hard.push(strap(field, [[0, 6.0, 1.96], [0, 5.9, 1.2], [0, 5.9, 0.2], [0, 5.92, -1.2], [0, 6.0, -2.6], [0, 5.62, -3.72]], 0.24, 0.035, LEATHER, { n: 16, lift: 0.02, sides: 4 }));
  // The crupper, round the root of the tail, and the breeching strap across the quarters.
  for (const q of [1, -1]) {
    hard.push(strap(field, [[0, 5.98, -2.5], [q * 0.9, 5.7, -3.0], [q * 1.3, 5.1, -3.1], [q * 1.42, 4.5, -3.0]], 0.14, 0.03, LEATHER, { n: 8, lift: 0.02, sides: 4 }));
    // The breeching, the strap round the quarters a horse leans back against to hold a load on a hill.
    hard.push(strap(field, [[q * 1.56, 4.36, -1.66], [q * 1.46, 4.5, -2.9], [q * 0.9, 4.6, -3.9], [0, 4.62, -4.16]], 0.22, 0.035, LEATHER2, { n: 10, lift: 0.02, sides: 4 }));
    hard.push({ geometry: new THREE.SphereGeometry(0.075, 6, 4).translate(q * 0.66, 5.68, 0.72 + 0.27), color: BRASS });
    hard.push({ geometry: new THREE.SphereGeometry(0.075, 6, 4).translate(q * 0.66, 5.68, 0.72 - 0.27), color: BRASS });
  }

  // --- The bridle ------------------------------------------------------------------------------------------------------
  const crown = [H.H(0.46, -0.3, 0.16), H.H(0.42, 0.06, -0.04), H.H(0, 0.4, 0.1), H.H(-0.42, 0.06, -0.04), H.H(-0.46, -0.3, 0.16)];
  hard.push(strap(field, crown, 0.12, 0.025, LEATHER, { n: 12, lift: 0.015, sides: 4 }));
  hard.push(strap(field, [H.H(0.5, 0.06, 0.26), H.H(0.34, 0.34, 0.44), H.H(0, 0.46, 0.5), H.H(-0.34, 0.34, 0.44), H.H(-0.5, 0.06, 0.26)], 0.1, 0.022, LEATHER, { n: 10, lift: 0.015, sides: 4 })); // the browband
  const brow = field && onSurface(field, H.H(0, 0.5, 0.5), 0.03);
  hard.push({ geometry: new THREE.SphereGeometry(0.075, 10, 7).translate(brow[0], brow[1], brow[2]), color: BRASS });
  // The noseband, all the way round the face.
  const nose = ringOn(field, (a) => H.H(Math.sin(a) * 1.0, -0.32 + Math.cos(a) * 1.0, 1.95 - 0.12 * Math.cos(a)), 16, 0.015);
  hard.push({ geometry: tube(nose, 0.075, { sides: 4, steps: 20, round: 0, section: () => [0.22, 1], frame: (t, c) => fieldNormal(field, [c.x, c.y, c.z]) }), color: LEATHER });
  for (const q of [1, -1]) {
    hard.push(strap(field, [H.H(q * 0.46, -0.3, 0.16), H.H(q * 0.5, -0.32, 0.9), H.H(q * 0.46, -0.3, 1.5), H.H(q * 0.42, -0.42, 2.24)], 0.11, 0.024, LEATHER, { n: 10, lift: 0.015, sides: 4 }));
    // The throatlatch, under the jaw behind the cheek.
    hard.push(strap(field, [H.H(q * 0.46, -0.3, 0.16), H.H(q * 0.44, -0.74, 0.32), H.H(q * 0.1, -1.08, 0.46)], 0.08, 0.02, LEATHER, { n: 6, lift: 0.015, sides: 4 }));
    // The bit ring at the corner of the mouth.
    const bit = onSurface(field, H.H(q * 0.42, -0.56, 2.34), 0.05);
    hard.push({ geometry: new THREE.TorusGeometry(0.11, 0.024, 4, 12).rotateY(Math.PI / 2).rotateX(H.rot[0]).translate(bit[0], bit[1], bit[2]), color: 0x8a8d90 });
    // The rein, from the bit, sagging a little, up to the terret on the hame.
    const hame = [ring[q > 0 ? 3 : 23][0] + q * 0.1, ring[3][1] + fwd.y * 0.2, ring[3][2] + fwd.z * 0.2];
    const midR = [(bit[0] + hame[0]) / 2 + q * 0.3, (bit[1] + hame[1]) / 2 - 0.1, (bit[2] + hame[2]) / 2];
    hard.push(strap(field, [bit, midR, hame], 0.07, 0.018, LEATHER, { n: 10, lift: 0.05, sides: 4 }));
  }

  const root = new THREE.Group();
  root.name = 'draft-horse';
  const DZ = -0.42;
  const add = (m) => { m.geometry.translate(0, 0, DZ); root.add(m); };
  const nap = napMap(8422, { lines: 500 });
  add(skinMesh(skin, side, recolour, { map: nap, bumpMap: nap, bumpScale: 0.22, roughness: 0.62 }));
  const strands = strandMap(8423);
  strands.repeat.set(2, 1);
  add(mesh(mergeParts([...hair, ...ears]), standard({ vertexColors: true, map: strands, bumpMap: strands, bumpScale: 0.5, roughness: 0.72, metalness: 0 })));
  add(mesh(mergeParts(hard), standard({ vertexColors: true, roughness: 0.38, metalness: 0 })));
  const tile = eyeTile({ iris: '#5e3518', rim: '#1e1006', pupil: 'bar', pupilW: 0.56, pupilH: 0.22, irisR: 0.9, sclera: '#2a1c12' });
  add(mesh(mergeParts(eyes), standard({ map: tile, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.14, roughness: 0.14, metalness: 0 })));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Hen and chicks
// ---------------------------------------------------------------------------------------------

// A speckled hen with exactly three chicks at her feet: one object, inside a 2.5ft circle. Her plumage is a painting
// (`plumageMap`), each triangle box-mapped so that the feathers do not streak, and her comb, wattle, beak and scaly legs
// are analytic. Chicks are one field built twice, standing and pecking, and placed three times.
const CHICK_R = 2.5 / 2;

function henField(cell) {
  const s = new Sculpt(cell);
  const W = [1, 1, 1];
  s.add(bodyLoft([
    [-0.48, 1.0, 0.08, 0.08, 0.1],
    [-0.36, 0.88, 0.23, 0.25, 0.27],
    [-0.1, 0.77, 0.3, 0.34, 0.34],
    [0.14, 0.78, 0.3, 0.34, 0.33],
    [0.3, 0.84, 0.21, 0.28, 0.27],
  ]), W);
  s.add(C([[0, 0.98, 0.2], [0, 1.14, 0.26], [0, 1.27, 0.3]], [0.17, 0.112, 0.092], 4), W, { k: 0.06 }); // the neck
  s.add(E([0, 1.33, 0.33], [0.082, 0.086, 0.105]), W, { k: 0.04 }); // the head
  s.add(both(E([0.135, 0.44, -0.03], [0.105, 0.17, 0.145])), W, { k: 0.08 }); // the fluffy thigh
  // The folded wing, a raised shield on the flank.
  s.add(both(E([0.28, 0.82, -0.1], [0.065, 0.2, 0.32], [0.18, 0, -0.08])), W, { k: 0.03 });
  s.add(both(E([0.27, 0.78, -0.34], [0.055, 0.13, 0.2], [0.34, 0, -0.1])), W, { k: 0.03 });
  s.add(C([[0, 0.92, -0.32], [0, 1.08, -0.47]], [0.13, 0.07], 2), W, { k: 0.06 }); // the rise into the tail
  return s;
}

function chickParts(peck, seed) {
  const rng = seededRandom(seed);
  const Y = lin(0xeec23a); const Y2 = lin(0xf6d868);
  const headZ = peck ? 0.14 : 0.1; const headY = peck ? 0.13 : 0.31;
  const s = new Sculpt(0.024);
  s.add(E([0, 0.19, -0.02], [0.098, 0.1, 0.13]), Y);
  s.add(S([0, headY, headZ], 0.078), Y, { k: 0.05 });
  s.add(both(E([0.09, 0.2, -0.04], [0.02, 0.05, 0.075], [0.1, 0, -0.1])), Y2, { k: 0.02 });
  s.add(C([[0, 0.22, -0.13], [0, 0.26, -0.17]], [0.03, 0.012], 1), Y, { k: 0.03 });
  const fuzz = (x, y, z) => Math.sin(44 * x + 3 * y) * Math.sin(44 * y + 3 * z) * Math.sin(44 * z + 3 * x);
  s.map((d, x, y, z) => (d > 0.05 ? d : d - 0.006 * fuzz(x, y, z)));
  const field = s.snapshot();
  const fluff = polygonize(s, {
    uvScale: 5,
    extraReach: 0.02,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const open = occlusion(s.ops, x, y, z, nx, ny, nz, 0.05);
      const k = mix(0.65, 1, open) * (0.84 + 0.16 * sstep(ny, -0.7, 0.2));
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
    },
  });
  const hard = [];
  // Tufts of down on the head.
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const base = [Math.cos(a) * 0.03, headY + 0.07, headZ + Math.sin(a) * 0.03];
    const tip = [base[0] * 1.8, base[1] + 0.035 + rng() * 0.012, base[2] + (base[2] - headZ) * 0.8];
    hard.push({ geometry: tube([base, tip], [0.012, 0.0015], { sides: 4, steps: 1, round: 0, straight: true }), color: 0xf2cf52 });
  }
  // A beak: small, orange and pointed.
  const dirZ = peck ? 0.7 : 1; const dirY = peck ? -0.7 : -0.12;
  const b0 = [0, headY - 0.005, headZ + 0.068];
  hard.push({ geometry: tube([b0, [0, b0[1] + dirY * 0.06, b0[2] + dirZ * 0.06]], [0.026, 0.003], { sides: 6, steps: 1, round: 0, straight: true }), color: 0xd9761c });
  // Two bright black eyes, each with its highlight.
  for (const q of [1, -1]) {
    const p = onSurface(field, [q * 0.075, headY + 0.018, headZ + 0.03]);
    hard.push({ geometry: new THREE.SphereGeometry(0.021, 8, 6).translate(p[0], p[1], p[2]), color: 0x060505 });
    hard.push({ geometry: new THREE.SphereGeometry(0.0075, 5, 4).translate(p[0] + q * 0.013, p[1] + 0.012, p[2] + 0.009), color: 0xffffff });
    // Thin orange legs and three little toes.
    const lx = q * 0.05;
    hard.push({ geometry: tube([[lx, 0.14, -0.02], [lx, 0.02, 0]], [0.012, 0.01], { sides: 5, steps: 1, round: 0, straight: true }), color: 0xe08a22 });
    for (const t of [-0.6, 0, 0.6]) {
      hard.push({ geometry: tube([[lx, 0.012, 0], [lx + Math.sin(t) * 0.05, 0.008, Math.cos(t) * 0.05]], [0.009, 0.003], { sides: 4, steps: 1, round: 0, straight: true }), color: 0xe08a22 });
    }
  }
  return { fluff, hard };
}

function henAndChicks() {
  const opts = shadedOptions(0.08, 0.55, 1);
  const body = zoned(henField, 0.034, [{ cell: 0.016, box: [-0.13, 1.18, 0.2, 0.13, 1.5, 0.52] }], opts);
  const uvScaleAt = () => 2.5;
  const skinParts = body.map((g) => ({ geometry: boxUV(g, uvScaleAt), keepColor: true }));
  const field = henField(0.02).snapshot();

  const hard = []; const eyes = []; const feathers = [];
  const RED = 0xb8261c;
  // The comb: a row of rounded points standing on the crown, flattened side to side.
  const combAt = (z, h, w) => ({ geometry: tube([[0, 1.385, z], [0, 1.385 + h * 0.6, z + 0.004], [0, 1.385 + h, z + 0.008]], [w, w * 0.8, w * 0.4], { sides: 7, steps: 4, round: 2, section: () => [0.48, 1] }), color: RED });
  hard.push({ geometry: tube([[0, 1.385, 0.24], [0, 1.41, 0.33], [0, 1.39, 0.42]], [0.03, 0.036, 0.026], { sides: 7, steps: 6, round: 1, section: () => [1, 0.5], frame: () => [0, 0, 0] }), color: RED });
  [[0.255, 0.05, 0.02], [0.295, 0.075, 0.024], [0.335, 0.09, 0.026], [0.375, 0.07, 0.024], [0.412, 0.042, 0.02]].forEach(([z, h, w]) => hard.push(combAt(z, h, w)));
  // Wattles and earlobes, hanging under the beak.
  for (const q of [1, -1]) {
    hard.push({ geometry: new THREE.SphereGeometry(1, 10, 8).scale(0.017, 0.04, 0.024).translate(q * 0.026, 1.238, 0.405), color: RED });
    hard.push({ geometry: new THREE.SphereGeometry(1, 8, 6).scale(0.012, 0.025, 0.02).translate(q * 0.083, 1.29, 0.31), color: 0xd64a38 });
    addEye(eyes, hard, field, q, [q * 0.078, 1.345, 0.36], 0.032, { lid: 0x5a2a14, sink: 0.55, lidH: 0.8, lidW: 0.84, lidT: 0.6 });
  }
  // The beak: a curved yellow upper over a shorter lower, with a nostril.
  hard.push({ geometry: tube([[0, 1.335, 0.415], [0, 1.325, 0.475], [0, 1.295, 0.515]], [0.038, 0.026, 0.002], { sides: 8, steps: 5, round: 0, section: () => [0.8, 1] }), color: 0xd9a32e });
  hard.push({ geometry: tube([[0, 1.3, 0.415], [0, 1.293, 0.455], [0, 1.29, 0.48]], [0.028, 0.018, 0.002], { sides: 6, steps: 3, round: 0 }), color: 0xb98a22 });

  // Scaly yellow legs and four toes each, with a checker of scales on the mesh itself.
  const scaly = (points, radii, sides, steps) => {
    const g = tube(points, radii, { sides, steps, round: 1 });
    const A = lin(0xd9a832); const B = lin(0xa87a1e);
    tintVertices(g, (x, y, z, o, i) => { const c = Math.floor(i / sides) % 2 ? A : B; o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; });
    return { geometry: g, keepColor: true };
  };
  for (const q of [1, -1]) {
    const lx = q * 0.125;
    hard.push(scaly([[lx, 0.4, -0.03], [lx, 0.22, -0.01], [lx, 0.045, 0.01]], [0.042, 0.03, 0.034], 8, 16));
    for (const t of [-0.55, 0, 0.55]) {
      const dx = Math.sin(t); const dz = Math.cos(t);
      const L = t === 0 ? 0.2 : 0.16;
      const tip = [lx + dx * L, 0.018, 0.01 + dz * L];
      hard.push(scaly([[lx, 0.045, 0.01], [lx + dx * L * 0.5, 0.034, 0.01 + dz * L * 0.5], tip], [0.03, 0.022, 0.016], 6, 7));
      hard.push({ geometry: tube([tip, [tip[0] + dx * 0.05, 0.006, tip[2] + dz * 0.05]], [0.014, 0.002], { sides: 5, steps: 1, round: 0, straight: true }), color: 0x3a2c1a });
    }
    hard.push(scaly([[lx, 0.05, 0.0], [lx, 0.024, -0.1]], [0.024, 0.014], 6, 4));
  }

  // The fanned tail and the wing's flight feathers: real plates, each with a thickness, and a shaft on the map.
  const feather = (rootP, dirV, sideV, L, W, base, tip, curlUp = 0) => {
    const d = new THREE.Vector3(...dirV).normalize();
    const sd = new THREE.Vector3(...sideV).normalize();
    const g = solidSurface({
      nu: 2,
      nv: 5,
      point: (u, v) => {
        const U = u * 2 - 1;
        const w = (W / 2) * (0.55 + 0.45 * Math.sin(Math.PI * clamp01(v * 0.92 + 0.08)) ** 0.6) * (v > 0.9 ? Math.sqrt(Math.max(0, (1 - v) / 0.1)) * 0.9 + 0.05 : 1);
        const a = L * v;
        return [
          rootP[0] + d.x * a + sd.x * U * w,
          rootP[1] + d.y * a + sd.y * U * w + curlUp * L * v * v,
          rootP[2] + d.z * a + sd.z * U * w,
        ];
      },
      thick: (u, v) => 0.012 * Math.max(0, 1 - (u * 2 - 1) ** 2) * Math.sin(Math.PI * v) ** 0.5,
    });
    const b = lin(base); const t = lin(tip);
    tintVertices(g, (x, y, z, o, i) => {
      const half = g.attributes.position.count / 2;
      const k = i < half ? i : i - half;
      const jv = k % 6;
      const tt = sstep(jv / 5, 0.5, 1);
      o[0] = mix(b[0], t[0], tt); o[1] = mix(b[1], t[1], tt); o[2] = mix(b[2], t[2], tt);
    });
    return { geometry: g, keepColor: true };
  };
  // The tail: a real hen's is two folded fans in an inverted V, so it is seen broad from the side. Seven a side, each
  // laid over the next, from nearly upright to nearly level.
  const TAILN = 7;
  for (const q of [1, -1]) {
    for (let i = 0; i < TAILN; i++) {
      const t = i / (TAILN - 1);
      const up = mix(1.22, 0.42, t);
      const dir = [q * mix(0.1, 0.2, t), Math.sin(up), -Math.cos(up)];
      const sideV = [q * 0.3, Math.cos(up), Math.sin(up)];
      feathers.push(feather([q * 0.05, mix(1.0, 0.94, t), -0.36], dir, sideV, mix(0.5, 0.56, Math.sin(t * 3.14)), 0.15, 0x5e3618, 0x1a120c, 0));
    }
  }
  // The wing's flight feathers, tucked along the lower edge of the folded wing, tips crossing over the rump.
  for (const q of [1, -1]) {
    for (let i = 0; i < 5; i++) {
      const y = 0.74 - i * 0.03;
      const z = -0.1 - i * 0.03;
      feathers.push(feather([q * (0.305 - i * 0.006), y, z], [q * -0.05, 0.12 - i * 0.015, -1], [q * 0.05, 1, 0.1], 0.3 - i * 0.012, 0.1, 0x6e421e, 0x1e140c, 0));
    }
  }

  // --- The three chicks -----------------------------------------------------------------------------------------------
  const fluffParts = [];
  const CHICKS = [
    { x: -0.62, z: 0.62, yaw: 0.5, peck: false },
    { x: 0.72, z: 0.4, yaw: -0.5, peck: true },
    { x: 0.42, z: -0.82, yaw: -2.6, peck: false },
  ];
  if (CHICKS.length !== 3) throw new Error('hen-and-chicks: exactly three chicks');
  const stand = chickParts(false, 8531);
  const pecking = chickParts(true, 8532);
  for (const c of CHICKS) {
    const src = c.peck ? pecking : stand;
    const m = new THREE.Matrix4().makeRotationY(c.yaw).setPosition(c.x, 0, c.z);
    fluffParts.push({ geometry: src.fluff.clone().applyMatrix4(m), keepColor: true });
    for (const h of src.hard) hard.push({ geometry: h.geometry.clone().applyMatrix4(m), color: h.color });
  }

  const root = new THREE.Group();
  root.name = 'hen-and-chicks';
  const plumage = plumageMap(8521);
  root.add(mesh(mergeParts(skinParts), standard({ vertexColors: true, map: plumage, bumpMap: plumage, bumpScale: 0.45, roughness: 0.82, metalness: 0 })));
  const down = napMap(8523, { lines: 260 });
  root.add(mesh(mergeParts([...fluffParts]), standard({ vertexColors: true, map: down, bumpMap: down, bumpScale: 0.6, roughness: 0.92, metalness: 0 })));
  root.add(mesh(mergeParts([...hard, ...feathers]), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })));
  const tile = eyeTile({ iris: '#d17a22', rim: '#a85a14', pupil: 'round', pupilW: 0.42, irisR: 0.96, sclera: '#6a2c08' });
  root.add(mesh(mergeParts(eyes), standard({ map: tile, emissive: 0xffffff, emissiveMap: tile, emissiveIntensity: 0.14, roughness: 0.14, metalness: 0 })));

  // All one group inside a tight circle: asserted, since plots and fences tile.
  const v = new THREE.Vector3();
  let far = 0;
  root.traverse((n) => {
    if (!n.isMesh) return;
    const P = n.geometry.attributes.position;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); far = Math.max(far, Math.sqrt(v.x * v.x + v.z * v.z)); }
  });
  if (far > CHICK_R) throw new Error(`hen-and-chicks: reaches ${far.toFixed(2)}ft from the centre, past the 2.5ft circle`);
  return root;
}

export const BUILDERS = {
  'dairy-cow': dairyCow,
  sheep,
  'farm-pig': farmPig,
  'hen-and-chicks': henAndChicks,
  'draft-horse': draftHorse,
  goat,
};
