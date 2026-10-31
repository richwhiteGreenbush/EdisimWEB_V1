// Builders for the Model Database's second Arts batch: acoustic guitar, concert harp, trumpet,
// sitar, theatre masks, Shakespeare's Globe, illuminated manuscript.
//
// A music teacher will use these, so every count a card or a student can check is COMPUTED and
// exported, never drawn by eye:
//   guitar   fret positions from 12-TET (L x (1 - 2^(-n/12))), six strings, six pins, six tuners
//   harp     47 strings walked diatonically from C1 to G7; every C red and every F dark; seven pedals
//   trumpet  one path from receiver to bell; each valve slide's length comes from the semitones it adds
//   sitar    20 frets, 7 playing strings over them, 13 sympathetic strings under them
//   globe    a true twenty-sided polygon, with one description of a bay used all the way round
//
// plateSolid, latheUp, polyTube, bar and beam are the private solids from Arts.js, copied rather than
// imported, because a sibling builder file is not a dependency.

import * as THREE from 'three';
import {
  mergeParts, solidLoft, weldSeam, smoothNoise3, outlineArea, roundedOutline,
} from '../../props/LoftKit.js';
import { seededRandom, canvasTexture, mesh, standard } from '../../PropKit.js';
import {
  Sculpt, polygonize, ellipsoidP, sphereP, curveP, segsP, boxP, flipped, pathOn, sampleCurve, relaxMesh,
} from '../ModelKit.js';

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const v3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// ---------------------------------------------------------------------------
// Curves and plates in the plane (from Arts.js)
// ---------------------------------------------------------------------------

function spline2(knots, per = 6) {
  const curve = new THREE.CatmullRomCurve3(knots.map(([a, b]) => new THREE.Vector3(a, b, 0)), false, 'centripetal');
  const n = (knots.length - 1) * per;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    out.push([p.x, p.y]);
  }
  return out;
}

function loopMitres(pts) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[(i - 1 + n) % n];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[(i + 1) % n];
    let ax = cx - px; let ay = cy - py;
    let bx = nx - cx; let by = ny - cy;
    const al = Math.hypot(ax, ay) || 1; const bl = Math.hypot(bx, by) || 1;
    ax /= al; ay /= al; bx /= bl; by /= bl;
    let mx = -(ay + by); let my = ax + bx;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-5) { mx = -ay; my = ax; } else { mx /= ml; my /= ml; }
    const cos = Math.max(0.4, mx * -ay + my * ax);
    out.push([mx / cos, my / cos]);
  }
  return out;
}

// Positive d moves a counter-clockwise loop inward.
function offsetLoop(pts, d) {
  const m = loopMitres(pts);
  return pts.map(([x, y], i) => [x + m[i][0] * d, y + m[i][1] * d]);
}

const circlePts = (cx, cy, r, n = 24) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
};

// A closed plate with real holes, extruded along +Z. `stack` is [inset, z] rows from back to front.
function plateSolid(outerIn, holesIn = [], stack = [[0, 0], [0, 1]], { crease = 34 } = {}) {
  const outer = outlineArea(outerIn) < 0 ? [...outerIn].reverse() : outerIn;
  const holes = holesIn.map((h) => (outlineArea(h) > 0 ? [...h].reverse() : h));
  const positions = [];
  const uvs = [];
  const indices = [];
  const creaseCos = Math.cos(THREE.MathUtils.degToRad(crease));

  const band = (loop) => {
    const n = loop.length;
    const mitres = loopMitres(loop);
    const cols = [];
    let run = 0;
    for (let i = 0; i < n; i++) {
      const p = loop[(i - 1 + n) % n];
      const c = loop[i];
      const q = loop[(i + 1) % n];
      const ax = c[0] - p[0]; const ay = c[1] - p[1];
      const bx = q[0] - c[0]; const by = q[1] - c[1];
      const cos = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
      if (i > 0) run += Math.hypot(ax, ay);
      cols.push({ i, run });
      if (cos < creaseCos) cols.push({ i, run, split: true });
    }
    const base = positions.length / 3;
    const rows = stack.length;
    const m = cols.length;
    for (let r = 0; r < rows; r++) {
      const [inset, z] = stack[r];
      for (let j = 0; j < m; j++) {
        const { i, run: u } = cols[j];
        positions.push(loop[i][0] + mitres[i][0] * inset, loop[i][1] + mitres[i][1] * inset, z);
        uvs.push(u, z);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let j = 0; j < m; j++) {
        const k = (j + 1) % m;
        if (cols[k].split && cols[k].i === cols[j].i) continue;
        const a = base + r * m + j;
        const b = base + r * m + k;
        const c = base + (r + 1) * m + k;
        const d = base + (r + 1) * m + j;
        indices.push(a, b, c, a, c, d);
      }
    }
  };
  band(outer);
  for (const h of holes) band(h);

  const cap = (row, up) => {
    const [inset, z] = stack[row];
    const contour = offsetLoop(outer, inset).map(([x, y]) => new THREE.Vector2(x, y));
    const holeLoops = holes.map((h) => offsetLoop(h, inset).map(([x, y]) => new THREE.Vector2(x, y)));
    const faces = THREE.ShapeUtils.triangulateShape(contour, holeLoops);
    const all = [...contour, ...holeLoops.flat()];
    const base = positions.length / 3;
    for (const p of all) { positions.push(p.x, p.y, z); uvs.push(p.x, p.y); }
    for (const [a, b, c] of faces) {
      const area = (all[b].x - all[a].x) * (all[c].y - all[a].y) - (all[b].y - all[a].y) * (all[c].x - all[a].x);
      if ((area > 0) === up) indices.push(base + a, base + b, base + c);
      else indices.push(base + a, base + c, base + b);
    }
  };
  cap(0, false);
  cap(stack.length - 1, true);

  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A plate lying flat, written in plan: points are [x, z] and the stack's second column is height y.
function planSolid(ptsXZ, holesXZ, stack, options) {
  const flip = (loop) => loop.map(([x, z]) => [x, -z]);
  const g = plateSolid(flip(ptsXZ), holesXZ.map(flip), stack, options);
  g.rotateX(-Math.PI / 2);
  return g;
}

const edgeStack = (y0, y1, b = 0.012) => [[b, y0], [0, y0 + b], [0, y1 - b], [b, y1]];

// Bottom-up [r, y] profile with the solid on your left walking along it. Repeat a point for a hard edge.
function latheUp(profile, { segments = 32, start = 0, sweep = Math.PI * 2, arcV = true } = {}) {
  const rows = profile.length;
  const ring = segments + 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  let total = 0;
  const arc = [0];
  for (let i = 1; i < rows; i++) {
    total += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]);
    arc.push(total);
  }
  for (let i = 0; i < rows; i++) {
    const [r, y] = profile[i];
    for (let j = 0; j <= segments; j++) {
      const a = start + (j / segments) * sweep;
      positions.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uvs.push(j / segments, arcV ? arc[i] / (total || 1) : i / Math.max(1, rows - 1));
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const d = (i + 1) * ring + j;
      const c = d + 1;
      indices.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  if (sweep >= Math.PI * 2 - 1e-6) weldSeam(g, ring, rows);
  const n = g.attributes.normal;
  for (const [row, sign] of [[0, -1], [rows - 1, 1]]) {
    if (profile[row][0] > 1e-5) continue;
    for (let j = 0; j <= segments; j++) n.setXYZ(row * ring + j, 0, sign, 0);
  }
  return g;
}

// A capped cylinder from a to b.
function bar(a, b, r1, r2 = r1, sides = 10) {
  const A = v3(a);
  const B = v3(b);
  const dir = B.clone().sub(A);
  const g = new THREE.CylinderGeometry(r2, r1, dir.length(), sides, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

// A rounded rectangular bar from a to b. `side` says which way its width w runs.
function beam(a, b, w, d, { side = [1, 0, 0], r = 0.02, steps = 2, bevel = 0.004 } = {}) {
  const A = v3(a);
  const B = v3(b);
  const axis = B.clone().sub(A);
  const length = axis.length();
  axis.normalize();
  const x = v3(side).addScaledVector(axis, -v3(side).dot(axis)).normalize();
  const y = new THREE.Vector3().crossVectors(axis, x).normalize();
  const outline = roundedOutline(w / 2, d / 2, Math.min(r, w * 0.45, d * 0.45), steps);
  const g = plateSolid(outline, [], [[bevel, 0], [0, bevel], [0, length - bevel], [bevel, length]], { crease: 60 });
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, axis).setPosition(A));
  return g;
}

// One closed tube through a list of points, on parallel-transported frames.
function polyTube(points, r, sides = 5, flat = 1) {
  const pts = points.map(v3);
  const radius = (i) => (Array.isArray(r) ? r[i] : r);
  const positions = [];
  const indices = [];
  let ref = new THREE.Vector3(0, 1, 0);
  const rows = pts.length;
  for (let i = 0; i < rows; i++) {
    const t = new THREE.Vector3();
    if (i < rows - 1) t.add(pts[i + 1].clone().sub(pts[i]).normalize());
    if (i > 0) t.add(pts[i].clone().sub(pts[i - 1]).normalize());
    t.normalize();
    if (Math.abs(t.dot(ref)) > 0.995) ref = new THREE.Vector3(1, 0, 0);
    const b = new THREE.Vector3().crossVectors(t, ref).normalize();
    const n = new THREE.Vector3().crossVectors(b, t).normalize();
    ref = n;
    const rr = radius(i);
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a) * rr * flat;
      const s = Math.sin(a) * rr;
      positions.push(pts[i].x + b.x * c + n.x * s, pts[i].y + b.y * c + n.y * s, pts[i].z + b.z * c + n.z * s);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const p = i * sides + j;
      const q = i * sides + k;
      const u = (i + 1) * sides + k;
      const v = (i + 1) * sides + j;
      indices.push(p, u, q, p, v, u);
    }
  }
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j, j + 1);
    const base = (rows - 1) * sides;
    indices.push(base, base + j + 1, base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  return orientOut(g);
}

const painted = (geometry, fn, extra = {}) => ({ geometry, keepColor: true, tint: fn, ...extra });
const flat = (geometry, color, extra = {}) => ({ geometry, color, ...extra });

function group(meshes, name) {
  const g = new THREE.Group();
  g.name = name;
  for (const m of meshes) if (m) g.add(m);
  return g;
}

function uvPlanar(g, fn) {
  const uv = g.attributes.uv;
  const p = g.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const [a, b] = fn(p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i));
    uv.setXY(i, a, b);
  }
  return g;
}

// Measures which way a solid or an open bowl faces, and turns it outward. A signed volume cannot
// judge an open bowl, so this asks whether its faces point away from its own centroid.
function orientOut(g) {
  const p = g.attributes.position;
  const idx = g.index;
  let cx = 0; let cy = 0; let cz = 0;
  for (let i = 0; i < p.count; i++) { cx += p.getX(i); cy += p.getY(i); cz += p.getZ(i); }
  cx /= p.count; cy /= p.count; cz /= p.count;
  let sum = 0;
  const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3();
  const ab = new THREE.Vector3(); const ac = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    A.fromBufferAttribute(p, idx.getX(i)); B.fromBufferAttribute(p, idx.getX(i + 1)); C.fromBufferAttribute(p, idx.getX(i + 2));
    ab.subVectors(B, A); ac.subVectors(C, A);
    const n = ab.cross(ac);
    sum += n.x * ((A.x + B.x + C.x) / 3 - cx) + n.y * ((A.y + B.y + C.y) / 3 - cy) + n.z * ((A.z + B.z + C.z) / 3 - cz);
  }
  if (sum < 0) {
    const arr = idx.array;
    for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
    idx.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

// Stacked closed rings, each a list of [x, y, z] of one length. Closes either end with a fan from the
// ring's centroid, on its own duplicated rim so the sides are not shaded into the cap, and measures
// which way the whole came out.
function loftRings(rings, { capStart = true, capEnd = true, uv = null } = {}) {
  const n = rings[0].length;
  const positions = [];
  const uvs = [];
  const indices = [];
  rings.forEach((ring, i) => {
    ring.forEach((p, j) => {
      positions.push(p[0], p[1], p[2]);
      const w = uv ? uv(i, j, p) : [j / n, i / Math.max(1, rings.length - 1)];
      uvs.push(w[0], w[1]);
    });
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      const a = i * n + j; const b = i * n + k; const c = (i + 1) * n + k; const d = (i + 1) * n + j;
      indices.push(a, b, c, a, c, d);
    }
  }
  const cap = (ring, atStart) => {
    const base = positions.length / 3;
    const c = [0, 0, 0];
    ring.forEach((p) => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
    ring.forEach((p) => { positions.push(p[0], p[1], p[2]); uvs.push(p[0], p[1]); });
    positions.push(c[0] / n, c[1] / n, c[2] / n); uvs.push(c[0] / n, c[1] / n);
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      if (atStart) indices.push(base + n, base + k, base + j);
      else indices.push(base + n, base + j, base + k);
    }
  };
  if (capStart) cap(rings[0], true);
  if (capEnd) cap(rings[rings.length - 1], false);
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return orientOut(g);
}

// A fake polish: with no environment map a metal has nothing to reflect, so the reflection is painted
// by which way each vertex faces, the way a chrome-gradient is drawn: a bright band just above the
// horizon, a dark band just below it, and a pale sky. Bakes into the colour attribute, in world frame.
function polishGeometry(g, hex, { gain = 1, floor = 0, pale = 0.55, ripple = 0 } = {}) {
  const base = Array.isArray(hex) ? hex : lin(hex);
  const nrm = g.attributes.normal;
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const keys = [[-1, 0.5], [-0.5, 0.42], [-0.12, 0.62], [0.1, 1.08], [0.26, 1.6], [0.5, 0.95], [0.82, 1.1], [1, 1.3]];
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);
    let k = 1;
    for (let s = 0; s < keys.length - 1; s++) {
      if (ny >= keys[s][0] && ny <= keys[s + 1][0]) {
        k = lerp(keys[s][1], keys[s + 1][1], (ny - keys[s][0]) / (keys[s + 1][0] - keys[s][0]));
        break;
      }
    }
    // Vertical windows, on both long sides, so that an upright casing is not one colour all round.
    const nx = nrm.getX(i); const nz = nrm.getZ(i);
    const w1 = Math.max(0, 0.46 * nx + 0.12 * ny + 0.88 * nz);
    const w2 = Math.max(0, -0.3 * nx + 0.12 * ny - 0.95 * nz);
    const w3 = Math.max(0, -0.62 * nx + 0.78 * nz);
    k += 0.75 * w1 ** 22 + 0.6 * w2 ** 22 - 0.22 * w3 ** 8;
    k = Math.max(floor, k * gain);
    // Broad soft patches, the room reflected in a burnished surface. A flat face has only one normal
    // and would otherwise be one colour from end to end.
    if (ripple) k *= 1 + ripple * Math.sin(pos.getX(i) * 5.3 + pos.getY(i) * 3.1 + pos.getZ(i) * 2.2) * Math.sin(pos.getX(i) * 1.7 - pos.getY(i) * 2.3 + 0.7);
    const up = Math.max(0, k - 1) * pale;
    arr[i * 3] = base[0] * k + up;
    arr[i * 3 + 1] = base[1] * k + up;
    arr[i * 3 + 2] = base[2] * k + up;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const polished = (g, hex, opts) => ({ geometry: polishGeometry(g, hex, opts), keepColor: true });

// A near-white wood-figure tile, the Arts.js one with its repeat left to the caller's UVs.
function grainTile({ size = 256, lines = 17, fine = 61, depth = 22 } = {}) {
  const S = size;
  const tex = canvasTexture(S, S, (ctx) => {
    const image = ctx.createImageData(S, S);
    const d = image.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S;
        const v = y / S;
        const wob = 0.006 * Math.sin(Math.PI * 2 * (v + u)) + 0.003 * Math.sin(Math.PI * 2 * (v * 3 + u * 2));
        const a = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob) * lines);
        const b = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u + wob * 1.6) * fine);
        const c = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (u * 3 + v));
        const k = 250 - depth * a ** 6 - depth * 0.55 * b ** 3 - 6 * c;
        const i = (y * S + x) * 4;
        d[i] = k; d[i + 1] = k; d[i + 2] = k; d[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// The turned walnut base every instrument in the family stands on, the violin's, sized by radius.
const WALNUT = lin(0x5a3620);
const WALNUT_FLAT = 0x53321d;
const PAD_RED = 0x5e1420;
function walnutBase(parts, R, { oval = 1, inlay = 0x9c7c3e } = {}) {
  const r = R / 2.34;
  const base = latheUp([
    [0, 0], [2.28 * r, 0], [2.28 * r, 0], [2.34 * r, 0.015], [2.34 * r, 0.07], [2.34 * r, 0.07], [2.28 * r, 0.1], [2.2 * r, 0.115], [2.2 * r, 0.115],
    [2.18 * r, 0.145], [2.12 * r, 0.19], [2.04 * r, 0.215], [2.04 * r, 0.215], [2.0 * r, 0.235], [2.0 * r, 0.235], [1.71 * r, 0.235], [1.71 * r, 0.235],
    [1.7 * r, 0.243], [1.7 * r, 0.243], [1.64 * r, 0.243], [1.64 * r, 0.243], [1.63 * r, 0.235], [1.63 * r, 0.235], [0.5 * r, 0.235], [0, 0.235],
  ], { segments: 64 });
  if (oval !== 1) base.scale(oval, 1, 1);
  const ring = lin(inlay);
  parts.push(painted(base, (p) => {
    const q = Math.hypot(p.x / oval, p.z);
    if (q > 1.62 * r && q < 1.71 * r && p.y > 0.24) return ring;
    const n = smoothNoise3(p.x * 0.8, 0.3, p.z * 3.6) * 0.6 + smoothNoise3(p.x * 2.4, 2.3, p.z * 11) * 0.4;
    const k = 0.74 + 0.56 * n;
    return [WALNUT[0] * k, WALNUT[1] * k, WALNUT[2] * k];
  }));
  return 0.235;
}

// ---------------------------------------------------------------------------
// ACOUSTIC GUITAR
// ---------------------------------------------------------------------------

// Twice life size, on a 000-style body: 24.9in scale, 14 frets clear of the body, 20 in all.
// Authored in inches in the instrument's own frame (x across, y from the tail up the neck, z out of
// the top), then raked back on to its stand.
const GTR_IN = 2 / 12;
export const GUITAR_SCALE_IN = 24.9;
export const GUITAR_FRETS = 20;
// 12-TET: the distance from the nut to fret n.
export const fretDistance = (n, scale = GUITAR_SCALE_IN) => scale * (1 - 2 ** (-n / 12));
const GUITAR_DOTS = [3, 5, 7, 9, 12, 15, 17];
// Low E first, as seen from the front with the neck up: viewer's left is the bass side.
export const GUITAR_STRINGS = [
  { name: 'E2', gauge: 0.053, wound: true, r: 0.0125, side: -1, peg: 0 },
  { name: 'A2', gauge: 0.042, wound: true, r: 0.0108, side: -1, peg: 1 },
  { name: 'D3', gauge: 0.032, wound: true, r: 0.0092, side: -1, peg: 2 },
  { name: 'G3', gauge: 0.024, wound: true, r: 0.0078, side: 1, peg: 2 },
  { name: 'B3', gauge: 0.016, wound: false, r: 0.0065, side: 1, peg: 1 },
  { name: 'E4', gauge: 0.012, wound: false, r: 0.0055, side: 1, peg: 0 },
];

function guitarOutlineIn() {
  const half = spline2([
    [0, 0], [2.8, 0.32], [5.2, 1.55], [6.85, 3.55], [7.5, 6.0], [7.05, 8.5], [5.7, 10.6], [4.85, 12.15],
    [5.05, 13.6], [5.55, 15.2], [5.6, 16.6], [5.05, 18.0], [3.5, 19.0], [1.3, 19.4], [0, 19.45],
  ], 5);
  const left = half.slice(1, -1).reverse().map(([x, y]) => [-x, y]);
  return [...half, ...left];
}

const GTR_ATLAS_W = 16.4; // inches of top the atlas spans
const GTR_ATLAS_H = 20.4;
const gtrU = (xIn) => (xIn + GTR_ATLAS_W / 2) / GTR_ATLAS_W;
const gtrV = (yIn) => (yIn + 0.5) / GTR_ATLAS_H;

function guitarPickguardIn() {
  const hole = { x: 0, y: GTR_HOLE_Y };
  // A teardrop that hugs the rosette on the treble side and points toward the bridge.
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const a = THREE.MathUtils.degToRad(lerp(102, -62, i / 12));
    pts.push([hole.x + Math.cos(a) * 2.98, hole.y + Math.sin(a) * 2.98]);
  }
  const rest = spline2([[1.4, GTR_HOLE_Y - 2.63], [1.8, GTR_HOLE_Y - 3.5], [3.0, GTR_HOLE_Y - 3.25], [4.2, GTR_HOLE_Y - 1.5], [4.45, GTR_HOLE_Y + 0.9], [3.45, GTR_HOLE_Y + 2.65], [1.7, GTR_HOLE_Y + 3.05], [-0.62, GTR_HOLE_Y + 2.92]], 4);
  return [...pts, ...rest.slice(1, -1)].reverse();
}
const GTR_HOLE_Y = 13.2;
const GTR_HOLE_R = 1.95;

function guitarTopTexture(outline) {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const X = (x) => gtrU(x) * w;
    const Y = (y) => (1 - gtrV(y)) * h;
    const rng = seededRandom(1951);
    ctx.fillStyle = '#d7ad6c';
    ctx.fillRect(0, 0, w, h);
    // Quarter-sawn spruce: straight grain up the length, tight at the middle joint and wider
    // towards the edge, bookmatched about the centre.
    for (let i = 0; i < 300; i++) {
      const d = (i / 300) ** 1.25 * w * 0.5;
      const off = rng() * 1.4;
      const a = 0.05 + rng() * 0.14;
      for (const s of [-1, 1]) {
        ctx.strokeStyle = rng() > 0.8 ? `rgba(244,214,160,${a})` : `rgba(140,88,38,${a})`;
        ctx.lineWidth = 0.6 + rng() * 1.2;
        ctx.beginPath();
        ctx.moveTo(w / 2 + s * (d + off), 0);
        ctx.bezierCurveTo(w / 2 + s * (d + off + 1.2), h * 0.33, w / 2 + s * (d + off - 1.2), h * 0.66, w / 2 + s * (d + off), h);
        ctx.stroke();
      }
    }
    // Medullary silk: faint cross-flecks that spruce shows when it is quartered.
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(250,226,180,${0.03 + rng() * 0.05})`;
      ctx.fillRect(rng() * w, rng() * h, 8 + rng() * 26, 1);
    }
    // A varnish darkening towards the rim.
    const rim = (d, colour, width) => {
      ctx.strokeStyle = colour; ctx.lineWidth = width; ctx.lineJoin = 'round';
      ctx.beginPath();
      offsetLoop(outline, d).forEach(([x, y], i) => { if (i) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); });
      ctx.closePath(); ctx.stroke();
    };
    // Many faint strokes, narrowing as they reach the edge: two wide ones draw two visible contours.
    for (let k = 0; k < 14; k++) rim(0.1 + k * 0.1, 'rgba(120,64,20,0.05)', 10 + k * 6);
    // Purfling: black, cream, black, just inside the binding.
    rim(0.12, '#1c1410', 4.4);
    rim(0.12, '#eadcb8', 2.2);

    // The rosette: concentric purfling either side of a band of mosaic, cut as a whole number of
    // repeats so it closes.
    const cx = X(0); const cy = Y(GTR_HOLE_Y);
    const px = w / GTR_ATLAS_W;
    const ring = (rIn, colour, widthIn) => {
      ctx.strokeStyle = colour; ctx.lineWidth = widthIn * px;
      ctx.beginPath(); ctx.arc(cx, cy, rIn * px, 0, Math.PI * 2); ctx.stroke();
    };
    ring(2.12, '#17100c', 0.08);
    ring(2.2, '#efe4c8', 0.05);
    ring(2.27, '#17100c', 0.05);
    const inner = 2.31 * px; const outer = 2.68 * px;
    ctx.fillStyle = '#3a1d10';
    ctx.beginPath(); ctx.arc(cx, cy, outer, 0, Math.PI * 2); ctx.arc(cx, cy, inner, 0, Math.PI * 2, true); ctx.fill();
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 0.5) / N) * Math.PI * 2;
      const a2 = ((i + 1) / N) * Math.PI * 2;
      ctx.fillStyle = i % 2 ? '#d9b36a' : '#efe4c8';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
      ctx.lineTo(cx + Math.cos(a1) * outer, cy + Math.sin(a1) * outer);
      ctx.lineTo(cx + Math.cos(a2) * inner, cy + Math.sin(a2) * inner);
      ctx.closePath(); ctx.fill();
    }
    ring(2.72, '#17100c', 0.05);
    ring(2.79, '#efe4c8', 0.05);
    ring(2.86, '#17100c', 0.08);

    // The guard is painted here as well: its plate takes these same UVs.
    const guard = guitarPickguardIn();
    ctx.save();
    ctx.beginPath();
    guard.forEach(([x, y], i) => { if (i) ctx.lineTo(X(x), Y(y)); else ctx.moveTo(X(x), Y(y)); });
    ctx.closePath();
    ctx.fillStyle = '#23120b';
    ctx.fill();
    ctx.clip();
    for (let i = 0; i < 260; i++) {
      const x = X(rng() * 5.2 - 0.8); const y = Y(GTR_HOLE_Y - 4 + rng() * 8);
      const r = 5 + rng() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${90 + Math.floor(rng() * 50)},${34 + Math.floor(rng() * 18)},10,0.5)`);
      g.addColorStop(1, 'rgba(60,20,8,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  });
}

export function acousticGuitar() {
  const IN = GTR_IN;
  const toFt = (loop) => loop.map(([x, y]) => [x * IN, y * IN]);
  const outlineIn = guitarOutlineIn();
  const outline = toFt(outlineIn);
  const depth = (yFt) => lerp(4.1 * IN, 3.35 * IN, clamp(yFt / (19.4 * IN), 0, 1));
  const ARCH = 0.28 * IN;
  const WAIST_Y = 12.15 * IN;

  const top = [];
  const body = [];
  const neckWood = [];
  const ebony = [];
  const metal = [];
  const bone = [];
  const stand = [];

  const atlasUv = (g) => uvPlanar(g, (x, y) => [gtrU(x / IN), gtrV(y / IN)]);

  // --- the top: a real hole through a real plate ------------------------------------------
  const TOP_BACK = -0.035;
  const hole = circlePts(0, GTR_HOLE_Y * IN, GTR_HOLE_R * IN, 56);
  const plate = plateSolid(outline, [hole], [[0, TOP_BACK], [0, -0.003], [0.002, 0]], { crease: 50 });
  top.push({ geometry: atlasUv(plate), color: 0xffffff });
  const guard = plateSolid(toFt(guitarPickguardIn()), [], [[0, -0.001], [0, 0.005], [0.003, 0.0075]], { crease: 60 });
  top.push({ geometry: atlasUv(guard), color: 0xffffff });

  // --- back and ribs: one bowl, drawn in from the outline to a pole on the back's centre ---
  const ROSEWOOD = lin(0x5b2c17);
  const CREAM = lin(0xd9c79a);
  const DARK_LINE = lin(0x17100b);
  const bowlRings = [];
  const bowlColours = [];
  const ribRow = (f, colour) => {
    bowlRings.push(outline.map(([x, y]) => [x, y, TOP_BACK - f * (depth(y) + TOP_BACK)]));
    bowlColours.push(colour);
  };
  ribRow(0, ROSEWOOD);
  ribRow(0.33, ROSEWOOD);
  ribRow(0.66, ROSEWOOD);
  ribRow(0.955, ROSEWOOD);
  ribRow(0.957, DARK_LINE);
  ribRow(0.965, DARK_LINE);
  ribRow(0.967, CREAM);
  ribRow(1, CREAM);
  const backRow = (s, colour) => {
    bowlRings.push(outline.map(([x, y]) => {
      const yy = WAIST_Y + (y - WAIST_Y) * s;
      return [x * s, yy, -(depth(y) + ARCH * (1 - s * s))];
    }));
    bowlColours.push(colour);
  };
  backRow(0.994, CREAM);
  backRow(0.975, CREAM);
  backRow(0.974, DARK_LINE);
  backRow(0.96, DARK_LINE);
  backRow(0.959, ROSEWOOD);
  for (const s of [0.88, 0.76, 0.62, 0.46, 0.3, 0.16, 0.05]) backRow(s, ROSEWOOD);
  const n = outline.length;
  const bowl = loftRings(bowlRings, {
    capStart: false,
    capEnd: true,
    uv: (i, j, p) => {
      // Grain runs round the ribs and up the back, in a tile whose lines run along v.
      if (i < 8) return [(p[2] * 0.9), (j / n) * 3.2];
      return [p[0] * 0.8, p[1] * 0.5];
    },
  });
  const colours = new Float32Array(bowl.attributes.position.count * 3);
  for (let i = 0; i < bowlRings.length * n; i++) {
    const c = bowlColours[Math.floor(i / n)];
    colours.set(c, i * 3);
  }
  for (let i = bowlRings.length * n; i < bowl.attributes.position.count; i++) colours.set(ROSEWOOD, i * 3);
  bowl.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  body.push({ geometry: bowl, keepColor: true });

  // The cavity, for what is seen through the hole: an inward-facing lining the same shape as the bowl.
  const inset = offsetLoop(outline, 0.05);
  const linerRings = [];
  for (const f of [0, 0.5, 1]) linerRings.push(inset.map(([x, y]) => [x, y, TOP_BACK - 0.002 - f * (depth(y) - 0.05 + TOP_BACK)]));
  for (const s of [0.82, 0.55, 0.28]) linerRings.push(inset.map(([x, y]) => [x * s, WAIST_Y + (y - WAIST_Y) * s, -(depth(y) - 0.05 + ARCH * (1 - s * s))]));
  const liner = flipped(loftRings(linerRings, { capStart: false, capEnd: true }));
  body.push(painted(liner, (p) => {
    const d = Math.hypot(p.x, p.y - GTR_HOLE_Y * IN);
    const k = 0.09 * smooth(1.4, 0.2, d) + 0.018;
    return [k * 1.0, k * 0.62, k * 0.34];
  }));
  // The maker's label, on the inside of the back where the hole looks at it.
  const label = new THREE.BoxGeometry(2.5 * IN, 1.1 * IN, 0.004).translate(0.35 * IN, (GTR_HOLE_Y - 0.15) * IN, -depth(GTR_HOLE_Y * IN) + 0.03);
  body.push(flat(label, 0x7a6743));

  // Binding at the top edge, a closed ring round the plate.
  const binding = plateSolid(offsetLoop(outline, -0.017), [outline], [[0, -0.052], [0, -0.004], [0.004, 0.001]], { crease: 60 });
  bone.push(flat(binding, 0xd9c79a));

  // --- neck: a D section that grows into the heel -----------------------------------------
  const Y_JOIN = 19.4;
  const Y_NUT = Y_JOIN + fretDistance(14);
  const Y_SADDLE = Y_NUT - GUITAR_SCALE_IN;
  const FB_TOP = 0.24;
  const neckIn = [
    { y: 18.95, w: 1.28, dn: 3.3 }, { y: 19.4, w: 1.28, dn: 3.3 }, { y: 19.9, w: 1.24, dn: 3.05 }, { y: 20.6, w: 1.18, dn: 2.2 },
    { y: 21.5, w: 1.12, dn: 1.3 }, { y: 22.6, w: 1.09, dn: 1.02 }, { y: 27, w: 0.98, dn: 0.92 }, { y: Y_NUT, w: 0.87, dn: 0.84 }, { y: Y_NUT + 0.5, w: 0.88, dn: 0.84 },
  ];
  const neck = solidLoft(neckIn.map(({ y, w, dn }) => ({
    d: y * IN, w: w * IN, up: 0.06 * IN, dn: dn * IN, b: -0.06 * IN, roundUp: 0.25, roundDn: 0.92,
  })), { axis: 'y', sides: 26, samples: 44 });
  uvPlanar(neck, (x, y, z) => [(x + z) * 1.1, y * 0.5]);
  neckWood.push(flat(neck, 0x8d4f27));

  // Fretboard, its true taper. Ends just clear of the rosette, past the 20th fret.
  const FB_END = Y_NUT - fretDistance(20) - 0.42;
  const hw = (y) => lerp(0.845, 1.12, (Y_NUT - y) / (Y_NUT - FB_END));
  const fbOutline = [
    [hw(FB_END), FB_END], [hw(Y_NUT), Y_NUT], [-hw(Y_NUT), Y_NUT], [-hw(FB_END), FB_END],
  ].map(([x, y]) => [x * IN, y * IN]);
  const board = plateSolid(fbOutline, [], [[0, 0.0], [0, (FB_TOP - 0.02) * IN], [0.003, FB_TOP * IN]], { crease: 30 });
  ebony.push(flat(board, 0x241a16));

  // Frets, at the exact logarithmic positions, half sunk in the board.
  const fretY = [];
  for (let k = 1; k <= GUITAR_FRETS; k++) {
    const y = Y_NUT - fretDistance(k);
    fretY.push(y);
    const half = hw(y) * IN + 0.002;
    metal.push(flat(bar([-half, y * IN, FB_TOP * IN], [half, y * IN, FB_TOP * IN], 0.0125, 0.0125, 7), 0xddd7c8));
  }
  // Position dots between frets, a double at the octave.
  const dot = (x, y) => bone.push(flat(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 14).rotateX(Math.PI / 2).translate(x * IN, y * IN, FB_TOP * IN + 0.0005), 0xefe8d8));
  for (const f of GUITAR_DOTS) {
    const y = (fretY[f - 1] + (f > 1 ? fretY[f - 2] : Y_NUT)) / 2;
    if (f === 12) { dot(-0.5, y); dot(0.5, y); } else dot(0, y);
  }

  // Nut.
  const NUT_TOP = FB_TOP + 0.075;
  bone.push(flat(beam([-0.87 * IN, (Y_NUT + 0.07) * IN, (FB_TOP + NUT_TOP) * 0.25 * IN], [0.87 * IN, (Y_NUT + 0.07) * IN, (FB_TOP + NUT_TOP) * 0.25 * IN], 0.18 * IN, NUT_TOP * IN, { side: [0, 1, 0], r: 0.006 }), 0xe7dfc9));

  // --- bridge and saddle -------------------------------------------------------------------
  // Slanted by the compensation a real saddle carries, a little more length for the bass.
  const saddleY = (i) => Y_SADDLE - 0.04 - 0.024 * (5 - i);
  const BRIDGE_Y = Y_SADDLE - 0.28;
  const bridgeHalf = spline2([[3.05, 0], [2.95, 0.4], [2.4, 0.5], [1.8, 0.68], [1.2, 0.72]], 3);
  const bridgeLine = [
    ...spline2([[-1.2, -0.72], [0, -0.74], [1.2, -0.72]], 3).slice(0, -1),
    [1.8, -0.68], [2.4, -0.5], [2.95, -0.4], ...bridgeHalf,
    [0, 0.74], ...[...bridgeHalf].reverse().map(([x, y]) => [-x, y]), [-2.95, -0.4], [-2.4, -0.5], [-1.8, -0.68],
  ].map(([x, y]) => [x * IN, (BRIDGE_Y + y) * IN]);
  const bridge = plateSolid(bridgeLine, [], [[0, -0.002], [0, 0.17 * IN], [0.02 * IN, 0.25 * IN]], { crease: 60 });
  ebony.push(flat(bridge, 0x3a2015));
  const SADDLE_TOP = 0.48;
  bone.push(flat(beam([-1.36 * IN, (saddleY(0) - 0.012) * IN, 0.16 * IN], [1.36 * IN, (saddleY(5) + 0.012) * IN, 0.16 * IN], 0.1 * IN, (SADDLE_TOP - 0.16) * 2 * IN, { side: [0, 1, 0], r: 0.004 }), 0xeae2cc));

  // --- headstock and tuners, in their own frame, swung back 15 degrees about the nut ------
  const head = new THREE.Matrix4().makeTranslation(0, (Y_NUT + 0.12) * IN, 0.12 * IN).multiply(new THREE.Matrix4().makeRotationX(-THREE.MathUtils.degToRad(15)));
  const headAt = (x, h, z) => new THREE.Vector3(x * IN, h * IN, z * IN).applyMatrix4(head).toArray();
  const headParts = [];
  const headHalf = spline2([[0.86, -0.3], [0.98, 0.4], [1.28, 1.6], [1.52, 3.2], [1.6, 4.8], [1.5, 5.75], [1.05, 6.25], [0.5, 6.42], [0, 6.46]], 3);
  const headOutline = [...headHalf, ...[...headHalf].slice(0, -1).reverse().map(([x, y]) => [-x, y])].map(([x, y]) => [x * IN, y * IN]);
  const headPlate = plateSolid(headOutline, [], [[0.004, -0.5 * IN], [0, -0.48 * IN], [0, -0.05 * IN]], { crease: 40 });
  uvPlanar(headPlate, (x, y, z) => [(x + z) * 1.1, y * 0.5]);
  headParts.push({ into: neckWood, part: flat(headPlate, 0x8d4f27) });
  const veneer = plateSolid(headOutline, [], [[0, -0.05 * IN], [0, 0.02 * IN], [0.004, 0.035 * IN]], { crease: 40 });
  headParts.push({ into: ebony, part: flat(veneer, 0x2a1810) });
  // A pearl diamond on the face, the one decoration, drawn by nobody's trademark.
  const pearl = plateSolid([[0, 5.65], [0.3, 5.3], [0, 4.95], [-0.3, 5.3]].map(([x, y]) => [x * IN, y * IN]), [], [[0, 0.03 * IN], [0, 0.042 * IN]]);
  headParts.push({ into: bone, part: flat(pearl, 0xe8e2d2) });

  const POST_X = 0.98;
  const POST_H = [1.5, 2.95, 4.4];
  const NICKEL = 0xc9c9c4;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const h = POST_H[k];
      // Post, standing out of the face along the head's own +z.
      const post = latheUp([[0, 0], [0.21, 0], [0.21, 0.05], [0.13, 0.08], [0.1, 0.1], [0.1, 0.56], [0.13, 0.6], [0.13, 0.66], [0, 0.68]].map(([r, y]) => [r * IN, y * IN]), { segments: 14 });
      post.rotateX(Math.PI / 2);
      post.translate(s * POST_X * IN, h * IN, 0.03 * IN);
      headParts.push({ into: metal, part: flat(post, NICKEL) });
      // The worm housing on the back, and its shaft and button out past the edge.
      const housing = new THREE.BoxGeometry(0.56 * IN, 0.62 * IN, 0.3 * IN).translate(s * POST_X * IN, h * IN, -0.62 * IN);
      headParts.push({ into: metal, part: flat(housing, NICKEL) });
      headParts.push({ into: metal, part: flat(bar([s * (POST_X + 0.4) * IN, h * IN, -0.62 * IN], [s * 2.35 * IN, h * IN, -0.62 * IN], 0.055 * IN, 0.055 * IN, 8), NICKEL) });
      const button = latheUp([[0, 0], [0.13, 0.0], [0.16, 0.08], [0.33, 0.28], [0.36, 0.48], [0.28, 0.62], [0, 0.68]].map(([r, y]) => [r * IN, y * IN]), { segments: 14 });
      button.scale(0.42, 1, 1);
      button.rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2);
      button.translate(s * 2.3 * IN, h * IN, -0.62 * IN);
      headParts.push({ into: metal, part: flat(button, 0xd5d5d0) });
      // Plates screws, reading as a tuner rather than a knob.
      headParts.push({ into: metal, part: flat(new THREE.SphereGeometry(0.05 * IN, 6, 4).translate(s * (POST_X + 0.12) * IN, (h + 0.42) * IN, -0.5 * IN), 0xb7b7b2) });
    }
  }
  for (const { into, part } of headParts) {
    const g = part.geometry.clone().applyMatrix4(head);
    into.push({ ...part, geometry: g });
  }

  // --- exactly six strings ----------------------------------------------------------------
  // Each is one tube from its bridge pin, over the saddle and the nut, to its post, and coils there.
  GUITAR_STRINGS.forEach((string, i) => {
    const xB = (-1.0625 + i * 0.425) * IN;
    const xN = (-0.72 + i * 0.288) * IN;
    const pinY = (saddleY(i) - 0.5 - (Math.abs(i - 2.5) < 1 ? 0.03 : 0)) * IN;
    const hPost = POST_H[string.peg];
    const onPost = headAt(string.side * (POST_X - 0.1), hPost - 0.04, 0.32);
    const pinTop = [xB, pinY, 0.3 * IN];
    const atSaddle = [xB, saddleY(i) * IN, SADDLE_TOP * IN + string.r * 0.6];
    const atNut = [xN, (Y_NUT + 0.07) * IN, (NUT_TOP + 0.02) * IN];
    const colour = string.wound ? 0xb98b4d : 0xdfe2e6;
    metal.push(flat(polyTube([pinTop, atSaddle, atNut, onPost], string.r, string.wound ? 8 : 7), colour));
    // Bridge pin, ivory with a black dot.
    const pin = latheUp([[0, 0], [0.06, 0], [0.09, 0.2], [0.11, 0.3], [0.125, 0.33], [0.115, 0.37], [0.06, 0.4], [0, 0.405]].map(([r, y]) => [r * IN, y * IN]), { segments: 12 });
    pin.rotateX(Math.PI / 2);
    pin.translate(xB, pinY, 0.02 * IN);
    bone.push(painted(pin, (p) => {
      const q = Math.hypot(p.x - xB, p.y - pinY);
      return q < 0.05 * IN && p.z > 0.38 * IN ? [0.02, 0.02, 0.02] : lin(0xe8dfc6);
    }));
    // Coils.
    for (let c = 0; c < 2; c++) {
      const coil = new THREE.TorusGeometry(0.11 * IN, string.r * 0.9, 6, 12);
      coil.translate(string.side * POST_X * IN, hPost * IN, (0.27 + c * 0.075) * IN);
      coil.applyMatrix4(head);
      metal.push(flat(coil, colour));
    }
  });

  // --- on to its stand --------------------------------------------------------------------
  const RAKE = 0.15;
  const BASE_R = 1.95;
  const LIFT = 0.82;
  const rake = new THREE.Matrix4().makeTranslation(0, LIFT, 0.5).multiply(new THREE.Matrix4().makeRotationX(-RAKE));
  const onStand = (p) => v3(p).applyMatrix4(rake).toArray();
  const BASE_TOP = walnutBase(stand, BASE_R);

  const mastBack = -0.72;
  const mastLow = onStand([0, -0.4, mastBack]);
  const mastTop = onStand([0, 29.4 * IN, mastBack]);
  mastLow[1] = 0.2;
  stand.push(flat(bar(mastLow, mastTop, 0.1, 0.07, 18), WALNUT_FLAT));
  stand.push(flat(latheUp([[0, 0.2], [0.26, 0.2], [0.26, 0.27], [0.2, 0.31], [0.13, 0.4], [0.11, 0.52], [0.135, 0.58], [0.11, 0.64], [0, 0.65]], { segments: 22 }), WALNUT_FLAT, { position: [mastLow[0], 0, mastLow[2]] }));
  stand.push(flat(new THREE.SphereGeometry(0.078, 16, 10).translate(...mastTop), WALNUT_FLAT));

  // The yoke: the neck rests in a padded fork at the 5th fret or so, held by nothing else.
  const yokeY = 28.8 * IN;
  const neckBack = -0.98 * IN;
  const yokeRoot = onStand([0, yokeY, mastBack]);
  const yokeMid = onStand([0, yokeY, neckBack - 0.13]);
  stand.push(flat(bar(yokeRoot, yokeMid, 0.05, 0.05, 12), WALNUT_FLAT));
  stand.push(flat(new THREE.SphereGeometry(0.07, 12, 8).translate(...yokeMid), WALNUT_FLAT));
  for (const s of [-1, 1]) {
    const tip = onStand([s * 0.3, yokeY, neckBack + 0.11]);
    stand.push(flat(polyTube([yokeMid, onStand([s * 0.26, yokeY, neckBack - 0.1]), tip], 0.04, 10), WALNUT_FLAT));
    stand.push(flat(new THREE.SphereGeometry(0.055, 12, 8).translate(...tip), PAD_RED));
  }
  stand.push(flat(bar(onStand([-0.27, yokeY, neckBack - 0.055]), onStand([0.27, yokeY, neckBack - 0.055]), 0.062, 0.062, 12), PAD_RED));

  // Two turned posts with padded rests take the lower bout.
  for (const sg of [-1, 1]) {
    const xr = 0.66;
    const yEdge = 0.12;
    const rest = onStand([sg * xr, yEdge - 0.07, -0.34]);
    const post = latheUp([
      [0, BASE_TOP - 0.02], [0.15, BASE_TOP - 0.02], [0.15, BASE_TOP + 0.03], [0.11, BASE_TOP + 0.05], [0.065, BASE_TOP + 0.12],
      [0.055, rest[1] - 0.2], [0.08, rest[1] - 0.15], [0.055, rest[1] - 0.1], [0.055, rest[1] - 0.03], [0, rest[1]],
    ], { segments: 16 });
    stand.push(flat(post, WALNUT_FLAT, { position: [rest[0], 0, rest[2]] }));
    stand.push(flat(new THREE.SphereGeometry(0.16, 16, 10).scale(1.3, 0.48, 2.3).translate(rest[0], rest[1], rest[2]), PAD_RED));
  }

  const grain = grainTile({ depth: 34 });
  const neckGrain = grainTile({ depth: 26, lines: 23 });
  return group([
    mesh(mergeParts(top).applyMatrix4(rake), standard({ map: guitarTopTexture(outlineIn), roughness: 0.34, metalness: 0 })),
    mesh(mergeParts(body).applyMatrix4(rake), standard({ vertexColors: true, map: grain, roughness: 0.3, metalness: 0 })),
    mesh(mergeParts(neckWood).applyMatrix4(rake), standard({ vertexColors: true, map: neckGrain, roughness: 0.4, metalness: 0 })),
    mesh(mergeParts([...ebony, ...bone]).applyMatrix4(rake), standard({ vertexColors: true, roughness: 0.32, metalness: 0 })),
    mesh(mergeParts(metal).applyMatrix4(rake), standard({ vertexColors: true, roughness: 0.32, metalness: 0.5 })),
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })),
  ], 'acoustic-guitar');
}

// ---------------------------------------------------------------------------
// CONCERT HARP
// ---------------------------------------------------------------------------

// Life size, the triangle lying in the XY plane so that a student square on sees all of it: column at
// -X, shoulder at +X, the player's side at +X.

// The strings, walked diatonically. A pedal harp is tuned to C-flat major with all pedals up, so its
// lowest string is C-flat 1 and its highest, sharpened, G-sharp 7. Its strings are named by letter:
// C1 D1 E1 F1 G1 A1 B1 C2 ... up to G7, which is forty-seven of them.
export function harpStringLayout() {
  const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const out = [];
  for (let octave = 1; octave <= 7; octave++) {
    for (const letter of letters) {
      out.push({ letter, octave, name: `${letter}${octave}` });
      if (octave === 7 && letter === 'G') return out;
    }
  }
  return out;
}
export const HARP_PEDALS = ['D', 'C', 'B', 'E', 'F', 'G', 'A'];

// The neck's centre line, the S the whole instrument is recognised by: high at the column, falling
// through a long hollow, up over the knee in the treble, then down to the shoulder.
const HARP_NECK_KNOTS = [
  [-1.02, 5.56], [-0.72, 5.56], [-0.34, 5.36], [0.08, 5.1], [0.5, 4.95], [0.92, 4.98], [1.32, 5.1], [1.66, 5.06], [1.93, 4.84], [2.1, 4.56],
];
const HARP_SB_LOW = [-0.62, 0.62];
const HARP_SB_HIGH = [2.02, 4.5];
const HARP_X0 = -0.47;
const HARP_X1 = 1.74;
const HARP_NECK_H = (x) => lerp(0.2, 0.105, smooth(-0.95, 1.7, x));


function harpNeckY(x, line) {
  for (let i = 0; i < line.length - 1; i++) {
    if (x >= line[i][0] && x <= line[i + 1][0]) {
      return lerp(line[i][1], line[i + 1][1], (x - line[i][0]) / (line[i + 1][0] - line[i][0]));
    }
  }
  return line[line.length - 1][1];
}

// A band swept along a plane curve in XY with a rounded-rectangle section: `halfH` in the plane and
// `halfD` across it. A sweep gives the rows a tint needs, which an extruded plate's cap never has.
function planeSweep(line, halfH, halfD, { sides = 20, power = 0.45, zc = 0, capStart = true, capEnd = true } = {}) {
  const rings = [];
  const N = line.length;
  for (let i = 0; i < N; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(N - 1, i + 1)];
    let tx = b[0] - a[0]; let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const nx = -ty; const ny = tx;
    const t = i / (N - 1);
    const h = typeof halfH === 'function' ? halfH(t, line[i]) : halfH;
    const d = typeof halfD === 'function' ? halfD(t, line[i]) : halfD;
    const z0 = typeof zc === 'function' ? zc(t, line[i]) : zc;
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const q = (j / sides) * Math.PI * 2;
      const c = Math.cos(q); const s = Math.sin(q);
      const u = Math.sign(c) * Math.abs(c) ** power;
      const w = Math.sign(s) * Math.abs(s) ** power;
      ring.push([line[i][0] + nx * h * w, line[i][1] + ny * h * w, z0 + d * u]);
    }
    rings.push(ring);
  }
  return loftRings(rings, { capStart, capEnd });
}

// A fluted column with its capital carved by displacing one surface: flutes and acanthus leaves are
// a function of bearing and height, so nothing lies on it and nothing can come away from it.
function harpColumn(x, z, GOLD) {
  const sides = 108;
  const FLUTES = 12;
  const LEAVES = 8;
  const profile = [
    [0, 0.42], [0.2, 0.42], [0.215, 0.5], [0.2, 0.56], [0.165, 0.6], [0.155, 0.68], [0.165, 0.74], [0.15, 0.82], [0.135, 0.92],
    [0.13, 1.4], [0.128, 2.4], [0.126, 3.4], [0.124, 4.2], [0.124, 4.52], [0.135, 4.57], [0.142, 4.62],
    [0.138, 4.7], [0.152, 4.84], [0.178, 4.98], [0.208, 5.12], [0.235, 5.26], [0.255, 5.38], [0.265, 5.46], [0.3, 5.5], [0.3, 5.56], [0.25, 5.6],
    [0.2, 5.66], [0.185, 5.72], [0.2, 5.77], [0.185, 5.82], [0.13, 5.88], [0.09, 5.93], [0.07, 5.98], [0.085, 6.03], [0.055, 6.08], [0, 6.1],
  ];
  // Resample so that the carving has rows to land on.
  const rows = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i]; const [r1, y1] = profile[i + 1];
    const inFlutes = y0 >= 0.9 && y1 <= 4.6;
    const step = inFlutes ? 0.5 : 0.05;
    const k = Math.max(1, Math.ceil(Math.hypot(r1 - r0, y1 - y0) / step));
    for (let j = 0; j < k; j++) rows.push([lerp(r0, r1, j / k), lerp(y0, y1, j / k)]);
  }
  rows.push(profile[profile.length - 1]);
  const rings = rows.map(([r, y]) => {
    const ring = [];
    for (let j = 0; j < sides; j++) {
      const q = (j / sides) * Math.PI * 2;
      let d = 0;
      // Flutes die out at both ends of the shaft.
      const fade = smooth(0.9, 1.08, y) * (1 - smooth(4.34, 4.5, y));
      if (fade > 0) d -= fade * 0.016 * (0.5 + 0.5 * Math.cos(q * FLUTES)) ** 1.4;
      // Two tiers of leaves round the capital, the second staggered behind the first.
      const leaf = (c, a, lo, hi, n) => {
        const v = clamp((y - lo) / (hi - lo), 0, 1);
        if (v <= 0 || v >= 1) return 0;
        const w = Math.cos(((q * n + a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
        const width = 0.5 + 0.5 * w;
        const blade = smooth(1 - (0.92 - 0.72 * v), 1, width);
        const curl = Math.sin(v * Math.PI) ** 0.7;
        return c * blade * curl;
      };
      d += leaf(0.05, 0, 4.66, 5.26, LEAVES);
      d += leaf(0.045, Math.PI, 4.95, 5.5, LEAVES);
      ring.push([x + Math.sin(q) * (r + (r > 1e-4 ? d : 0)), y, z + Math.cos(q) * (r + (r > 1e-4 ? d : 0))]);
    }
    return ring;
  });
  const g = loftRings(rings, { capStart: true, capEnd: true });
  const base = lin(GOLD);
  polishGeometry(g, base, { gain: 1.04, ripple: 0.12 });
  // Darkens the bottom of every carved recess, which is what burnished gilding does.
  const pos = g.attributes.position;
  const col = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i) - x, pos.getZ(i) - z);
    const y = pos.getY(i);
    // The nominal radius at this height.
    let nominal = r;
    for (let k = 0; k < rows.length - 1; k++) {
      if (y >= rows[k][1] && y <= rows[k + 1][1]) { nominal = lerp(rows[k][0], rows[k + 1][0], (y - rows[k][1]) / Math.max(1e-5, rows[k + 1][1] - rows[k][1])); break; }
    }
    const dep = clamp((r - nominal) / 0.05, -1, 1);
    const k = dep < 0 ? 1 + dep * 0.55 : 1 + dep * 0.28;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

function harpSoundboardTexture() {
  return canvasTexture(512, 1024, (ctx, w, h) => {
    const rng = seededRandom(47);
    ctx.fillStyle = '#d6ad6e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = rng() * w;
      ctx.strokeStyle = rng() > 0.75 ? `rgba(248,220,168,${0.05 + rng() * 0.1})` : `rgba(130,82,34,${0.05 + rng() * 0.14})`;
      ctx.lineWidth = 0.5 + rng() * 1.3;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rng() - 0.5) * 3, h); ctx.stroke();
    }
    // Painted gilt scrolling either side of the string rib, the decoration concert soundboards carry.
    const gold = '#a97f27';
    const goldHi = '#e4c167';
    const scroll = (cx, cy, s, flip) => {
      for (const [col, lw] of [[gold, 5 * s], [goldHi, 1.7 * s]]) {
        ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineCap = 'round';
        ctx.beginPath();
        for (let a = 0; a <= 1; a += 0.02) {
          const th = a * Math.PI * 3.1;
          const r = (1 - a) * 34 * s;
          const x = cx + flip * Math.cos(th) * r;
          const y = cy + Math.sin(th) * r;
          if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Leaves along the arm.
      for (let i = 0; i < 5; i++) {
        const a = -0.5 + i * 0.36;
        const lx = cx + flip * Math.cos(a) * 40 * s; const ly = cy + Math.sin(a) * 40 * s;
        ctx.fillStyle = gold;
        ctx.beginPath(); ctx.ellipse(lx, ly, 11 * s, 4.5 * s, a + (flip > 0 ? 0.7 : -0.7), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = goldHi;
        ctx.beginPath(); ctx.ellipse(lx, ly, 7 * s, 1.4 * s, a + (flip > 0 ? 0.7 : -0.7), 0, Math.PI * 2); ctx.fill();
      }
    };
    // v = 0 is the wide bass end, at the bottom of the canvas. Ornament scales with the board's width.
    for (let i = 0; i < 9; i++) {
      const v = (i + 0.5) / 9;
      const y = h * (1 - v);
      const s = lerp(1.5, 0.62, v);
      for (const f of [-1, 1]) {
        scroll(w / 2 + f * 120 * lerp(1.16, 0.74, v), y + (i % 2 ? 26 : -26) * s, s, i % 2 ? f : -f);
      }
    }
    // Gold lining round the edge.
    ctx.strokeStyle = gold; ctx.lineWidth = 7; ctx.strokeRect(10, 3, w - 20, h - 6);
    ctx.strokeStyle = goldHi; ctx.lineWidth = 2; ctx.strokeRect(10, 3, w - 20, h - 6);
  });
}

export function concertHarp() {
  const GOLD = 0xe6b040;
  const gold = [];
  const wood = [];
  const strings = [];
  const brass = [];
  const dark = [];
  const board = [];

  const neckLine = spline2(HARP_NECK_KNOTS, 8);
  const COL_X = -1.02;

  // --- the soundbox: flat board, staved round back, a narrow top and a wide base -------------
  const a = v3([...HARP_SB_LOW, 0]);
  const b = v3([...HARP_SB_HIGH, 0]);
  const axis = b.clone().sub(a);
  const LEN = axis.length();
  axis.normalize();
  // In-plane normal, the way the board faces: up and toward the column.
  const nrm = new THREE.Vector3(-axis.y, axis.x, 0);
  const boardWidth = (t) => lerp(0.68, 0.14, t ** 0.92);
  const boxDepth = (t) => lerp(0.82, 0.13, t ** 0.85);
  const STAVES = 9;
  const backRings = [];
  const ROWS = 34;
  const BACK_SIDES = 72;
  const sbPoint = (t, u, n) => a.clone().addScaledVector(axis, t * LEN).add(new THREE.Vector3(0, 0, u)).addScaledVector(nrm, n);
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const hw = boardWidth(t);
    const dp = boxDepth(t);
    const ring = [];
    for (let j = 0; j <= BACK_SIDES; j++) {
      const q = (j / BACK_SIDES) * Math.PI;
      // A round back, with the slight ridges between its staves.
      const ridge = 1 + 0.018 * Math.abs(Math.sin(q * STAVES));
      ring.push(sbPoint(t, Math.cos(q) * hw * ridge, -Math.sin(q) * dp * ridge).toArray());
    }
    // Across the flat top, hidden under the board, so the ring is closed.
    for (let j = 1; j < 6; j++) ring.push(sbPoint(t, lerp(-hw, hw, j / 6), -0.012).toArray());
    backRings.push(ring);
  }
  const back = loftRings(backRings, { capStart: true, capEnd: true, uv: (i, j, p) => [p[2] * 0.9, (i / ROWS) * 2.4] });
  const MAPLE = lin(0xa86a2f);
  wood.push(painted(back, (p) => {
    const q = p.clone().sub(a);
    const n = q.dot(nrm);
    const t = q.dot(axis) / LEN;
    const u = Math.atan2(-n, p.z) / Math.PI;
    const stave = Math.abs(Math.sin(u * Math.PI * STAVES));
    const k = (0.5 + 0.56 * stave ** 0.35) * (0.9 + 0.2 * smoothNoise3(t * 9, u * 7, 3.1));
    return [MAPLE[0] * k, MAPLE[1] * k, MAPLE[2] * k];
  }));

  // The soundboard: one plate on the top of the box.
  const SB = 0.012;
  const sbRows = 28;
  const sbSides = [];
  for (let i = 0; i <= sbRows; i++) sbSides.push([i / sbRows, boardWidth(i / sbRows)]);
  const sbOutline = [...sbSides.map(([t, w]) => [w, t * LEN]), ...[...sbSides].reverse().map(([t, w]) => [-w, t * LEN])];
  const plate = plateSolid(sbOutline, [], [[0, -0.012], [0, SB - 0.004], [0.004, SB]], { crease: 50 });
  uvPlanar(plate, (x, y) => [(x + 0.72) / 1.44, y / LEN]);
  // Plate frame (x, along, n) into the world: its +X is world z so that handedness holds.
  // Right-handed by measurement: whichever sign of z makes (z x axis) point along the board's normal.
  const zSign = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), axis).dot(nrm) > 0 ? 1 : -1;
  const sbFrame = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, zSign), axis, nrm).setPosition(a);
  plate.applyMatrix4(sbFrame);
  board.push({ geometry: plate, color: 0xffffff });

  // Gilt edging each side of the board: a sweep following the box's own taper.
  const edgeLine = (side) => {
    const out = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      out.push(sbPoint(t, side * (boardWidth(t) + 0.005), -0.005).toArray());
    }
    return out;
  };
  for (const side of [-1, 1]) {
    gold.push(polished(polyTube(edgeLine(side), 0.022, 8), GOLD));
  }

  // The string rib up the middle of the board, which takes the pull.
  const ribLine = [];
  for (let i = 0; i <= 24; i++) ribLine.push(sbPoint(lerp(0.05, 0.965, i / 24), 0, SB + 0.004).toArray());
  gold.push(polished(polyTube(ribLine, [...ribLine.map((_, i) => lerp(0.032, 0.018, i / 24))], 10, 1), GOLD));

  // --- the neck ---------------------------------------------------------------------------
  const neckGold = planeSweep(neckLine, (t, p) => HARP_NECK_H(p[0]) * (0.92 + 0.14 * smooth(0.82, 1, 1 - t)), (t) => lerp(0.1, 0.075, t), { sides: 28, power: 0.5 });
  gold.push(polished(neckGold, GOLD, { ripple: 0.22 }));
  // The brass action plates, one on each face: flat, and a shade paler than the gilt round them.
  for (const s of [-1, 1]) {
    const sub = neckLine.slice(3, -2);
    const actionPlate = planeSweep(sub, (t, p) => HARP_NECK_H(p[0]) * 0.72, 0.012, { sides: 16, power: 0.3, zc: () => s * (lerp(0.1, 0.075, 0.5) + 0.002) });
    brass.push(polished(actionPlate, 0xe4c068, { gain: 0.95, ripple: 0.26 }));
  }

  // --- strings, computed from the note table -------------------------------------------------
  const layout = harpStringLayout();
  if (layout.length !== 47) throw new Error(`harp strings: ${layout.length}`);
  const N = layout.length;
  const underNeck = neckLine.map(([x, y], i) => {
    const q = neckLine[Math.max(0, i - 1)]; const w = neckLine[Math.min(neckLine.length - 1, i + 1)];
    const tx = w[0] - q[0]; const ty = w[1] - q[1]; const l = Math.hypot(tx, ty) || 1;
    // The lower edge of the sweep, along the line's own normal.
    const h = HARP_NECK_H(x) * 0.9;
    return [x - (-ty / l) * h, y - (tx / l) * h];
  });
  const toBoard = (x) => HARP_SB_LOW[1] + ((x - HARP_SB_LOW[0]) / (HARP_SB_HIGH[0] - HARP_SB_LOW[0])) * (HARP_SB_HIGH[1] - HARP_SB_LOW[1]);
  const C_RED = 0xc4231c;
  const F_DARK = 0x14161f;
  const gut = 0xe8dcc0;
  const wound = 0xb98e62;
  layout.forEach((note, i) => {
    const x = lerp(HARP_X0, HARP_X1, i / (N - 1));
    const yBoard = toBoard(x);
    const yNeck = harpNeckY(x, underNeck);
    const bass = i < 12;
    const colour = note.letter === 'C' ? C_RED : note.letter === 'F' ? F_DARK : bass ? wound : gut;
    const r = lerp(0.0125, 0.0058, (i / (N - 1)) ** 0.7);
    // The top of the string rib at this point, so a string starts in it rather than beside it.
    const low = [x, yBoard + 0.012, 0];
    const high = [x, yNeck + 0.02, 0];
    strings.push(flat(bar(low, high, r, r, 6), colour));
    // A pin in the neck's underside and a bead where it enters the board.
    brass.push(flat(new THREE.SphereGeometry(0.02, 7, 4).translate(x, yNeck + 0.004, 0), 0xdab864));
    dark.push(flat(new THREE.SphereGeometry(0.024, 7, 4).scale(1, 0.7, 1).translate(x, yBoard + 0.03, 0), 0xe2c98c));
    // The action: a tuning pin high on the plate and a turning disc lower down.
    const yMid = harpNeckY(x, neckLine);
    const FACE = lerp(0.1, 0.075, clamp((x + 1.02) / 3.1, 0, 1)) + 0.012;
    const h = HARP_NECK_H(x);
    brass.push(flat(new THREE.CylinderGeometry(0.018, 0.022, 0.03, 8).rotateX(Math.PI / 2).translate(x, yMid + h * 0.35, FACE + 0.012), 0xeed690));
    brass.push(flat(new THREE.CylinderGeometry(0.021, 0.021, 0.014, 10).rotateX(Math.PI / 2).translate(x, yMid - h * 0.38, FACE + 0.006), 0xd2b467));
  });

  // --- column and crown --------------------------------------------------------------------
  gold.push({ geometry: harpColumn(COL_X, 0, GOLD), keepColor: true });

  // The join of the neck into the crown: a socket collar, so the join is never a bare intersection.
  gold.push(polished(new THREE.SphereGeometry(0.2, 22, 14).scale(1, 0.9, 0.72).translate(COL_X + 0.22, 5.56, 0), GOLD));

  // The join of the neck into the shoulder of the soundbox: a gilt knee cap over both ends.
  const sh = v3([...HARP_SB_HIGH, 0]);
  gold.push(polished(new THREE.SphereGeometry(0.13, 22, 14).scale(1.0, 1.28, 0.86).translate(sh.x + 0.04, sh.y + 0.06, 0), GOLD));
  // A gilt shoe where the soundbox stands in the pedestal. The box leans, so a section square to its
  // axis would dip through the pedestal at the back and stand clear of it at the front: each ring is
  // solved for the height it has to lie at, which makes the sleeve level all the way round.
  const shoeRings = [];
  const solveT = (y, side) => {
    let t = 0;
    for (let it = 0; it < 8; it++) t = (y - a.y - nrm.y * side(Math.max(0, t))) / (axis.y * LEN);
    return t;
  };
  for (const [y, bulge] of [[0.6, 0.012], [0.7, 0.024], [0.745, 0.042], [0.79, 0.032], [0.825, 0.026]]) {
    const ring = [];
    const at = (qFn, uFn) => {
      const t = solveT(y, qFn);
      const ta = Math.max(0, t);
      return sbPoint(t, uFn(ta), qFn(ta)).toArray();
    };
    for (let j = 0; j <= 40; j++) {
      const q = (j / 40) * Math.PI;
      ring.push(at((ta) => -Math.sin(q) * (boxDepth(ta) + bulge), (ta) => Math.cos(q) * (boardWidth(ta) + bulge)));
    }
    for (let j = 1; j < 8; j++) {
      const f = j / 8;
      ring.push(at(() => SB + 0.008 + bulge, (ta) => lerp(-1, 1, f) * (boardWidth(ta) + bulge)));
    }
    shoeRings.push(ring);
  }
  gold.push(polished(loftRings(shoeRings), GOLD));

  // --- the base -----------------------------------------------------------------------------
  // A wide pedestal of curved plan, with the column's foot in one end, the soundbox on top, and the
  // pedals round the player's side, each in its own notched slot.
  const BX = -0.32;
  const R_BASE = 0.78;
  const BASE_LOW = 0.14;
  const BASE_TOP = 0.56;
  const baseProfile = [
    [0, BASE_LOW], [R_BASE - 0.02, BASE_LOW], [R_BASE, BASE_LOW + 0.015], [R_BASE, BASE_LOW + 0.07], [R_BASE - 0.03, BASE_LOW + 0.085],
    [R_BASE - 0.03, BASE_TOP - 0.11], [R_BASE + 0.01, BASE_TOP - 0.09], [R_BASE + 0.02, BASE_TOP - 0.05], [R_BASE - 0.02, BASE_TOP - 0.01],
    [R_BASE - 0.15, BASE_TOP + 0.05], [R_BASE - 0.32, BASE_TOP + 0.09], [0, BASE_TOP + 0.1],
  ];
  const baseG = latheUp(baseProfile, { segments: 84 });
  baseG.scale(1.16, 1, 0.9);
  baseG.translate(BX, 0, 0);
  wood.push(painted(baseG, (p) => {
    const r = Math.hypot((p.x - BX) / 1.16, p.z / 0.9);
    const k = p.y > BASE_TOP + 0.02 || p.y < BASE_LOW + 0.09 ? 0.9 : 1.0;
    return lin(0x94622d).map((c) => c * k * (0.88 + 0.22 * smoothNoise3(r * 3, p.y * 4, 1.1)));
  }));
  // Gilt rims round the pedestal.
  for (const [y, tr] of [[BASE_LOW + 0.05, 0.024], [BASE_TOP - 0.065, 0.028]]) {
    const ring = new THREE.TorusGeometry(R_BASE + 0.002, tr, 8, 84).rotateX(Math.PI / 2);
    ring.scale(1.16, 1, 0.9);
    ring.translate(BX, y, 0);
    gold.push(polished(ring, GOLD));
  }
  // Feet.
  for (const q of [0.6, 2.54, 3.74, 5.68]) {
    const fx = BX + Math.cos(q) * R_BASE * 1.16 * 0.83;
    const fz = Math.sin(q) * R_BASE * 0.9 * 0.83;
    const foot = latheUp([[0, 0], [0.1, 0], [0.13, 0.04], [0.11, 0.09], [0.06, 0.12], [0.09, 0.17], [0, 0.18]], { segments: 18 });
    foot.translate(fx, 0, fz);
    gold.push(polished(foot, GOLD));
  }

  // Exactly seven pedals, set in the middle notch, where the strings sound the letters they are named by.
  const PED_ARC = [-0.98, -0.72, -0.46, 0, 0.26, 0.52, 0.78].map((v) => v + 0.1);
  HARP_PEDALS.forEach((letter, i) => {
    const q = PED_ARC[i];
    const dx = Math.cos(q) * 1.16 * R_BASE; const dz = Math.sin(q) * 0.9 * R_BASE;
    const ox = BX + dx; const oz = dz;
    const dir = new THREE.Vector3(Math.cos(q), 0, Math.sin(q)).normalize();
    // The slot: a dark panel, standing a hair proud inside a projecting gilt frame.
    const outward = dir.clone();
    const tang = new THREE.Vector3(dir.z, 0, -dir.x);
    const m = new THREE.Matrix4().makeBasis(tang, new THREE.Vector3(0, 1, 0), outward).setPosition(ox, 0, oz);
    const panel = new THREE.BoxGeometry(0.1, 0.24, 0.05).translate(0, BASE_LOW + 0.2, 0);
    panel.applyMatrix4(m);
    dark.push(flat(panel, 0x0e0c0a));
    const frame = plateSolid(roundedOutline(0.075, 0.145, 0.02, 2), [roundedOutline(0.045, 0.115, 0.01, 2)], [[0, -0.02], [0, 0.03], [0.006, 0.04]]);
    frame.translate(0, BASE_LOW + 0.2, 0);
    frame.applyMatrix4(m);
    gold.push(polished(frame, GOLD));
    // Three notches: flat, natural, sharp. The pedal rests in the middle one.
    for (const ny of [0.285, 0.2, 0.115]) {
      const nb = new THREE.BoxGeometry(0.03, 0.022, 0.03).translate(0.058, BASE_LOW + ny, 0.03);
      nb.applyMatrix4(m);
      brass.push(flat(nb, 0xb99a50));
    }
    const pivot = v3([ox, BASE_LOW + 0.2, oz]).addScaledVector(outward, 0.02);
    const toe = pivot.clone().addScaledVector(outward, 0.3).add(new THREE.Vector3(0, -0.015, 0));
    const lever = beam(pivot.toArray(), toe.toArray(), 0.062, 0.03, { side: tang.toArray(), r: 0.012 });
    gold.push(polished(lever, 0xd3a64b));
    // The foot pad, a rounded spoon at the end of the lever.
    const pad = new THREE.SphereGeometry(0.07, 16, 10).scale(0.9, 0.38, 1.25);
    const mPad = new THREE.Matrix4().makeBasis(tang, new THREE.Vector3(0, 1, 0), outward).setPosition(toe.x, toe.y, toe.z);
    pad.applyMatrix4(mPad);
    gold.push(polished(pad, 0xd3a64b));
  });

  const grain = grainTile({ depth: 14 });
  return group([
    mesh(mergeParts(board).translate(-HARP_XC, 0, 0), standard({ map: harpSoundboardTexture(), roughness: 0.42, metalness: 0 })),
    mesh(mergeParts(wood).translate(-HARP_XC, 0, 0), standard({ vertexColors: true, map: grain, roughness: 0.34, metalness: 0 })),
    mesh(mergeParts(gold).translate(-HARP_XC, 0, 0), standard({ vertexColors: true, roughness: 0.3, metalness: 0.32 })),
    mesh(mergeParts(brass).translate(-HARP_XC, 0, 0), standard({ vertexColors: true, roughness: 0.3, metalness: 0.32 })),
    mesh(mergeParts(strings).translate(-HARP_XC, 0, 0), standard({ vertexColors: true, roughness: 0.5, metalness: 0 })),
    mesh(mergeParts(dark).translate(-HARP_XC, 0, 0), standard({ vertexColors: true, roughness: 0.6, metalness: 0 })),
  ], 'concert-harp');
}
const HARP_XC = 0.3;

// ---------------------------------------------------------------------------
// TRUMPET
// ---------------------------------------------------------------------------

// Four times life, in the player's own terms: x runs from the mouthpiece to the bell, y is up, and +z
// is the player's right hand, which is the side with the leadpipe and the little-finger hook.
// Written in real inches and converted once, so that a length here can be held to a length in life.
const TPT_IN = 4 / 12;
// The extra tubing each valve opens, from what it has to do: a whole tone, a semitone, a minor third.
// A valve lowers the note by making the air column longer by the factor 2^(semitones/12).
export const TRUMPET_BORE_IN = 54; // a B-flat trumpet's 4.5ft
export const trumpetSlideLength = (semitones) => TRUMPET_BORE_IN * (2 ** (semitones / 12) - 1);
export const TRUMPET_VALVES = [
  { name: 1, semitones: 2, x: 6.7 }, { name: 2, semitones: 1, x: 7.85 }, { name: 3, semitones: 3, x: 9.0 },
];

const TPT_UP = 1.25; // the height of the upper line above the valve block's centre, inches
const TPT_LO = -1.25;
const TPT_LEAD_Z = 0.62;
const TPT_BELL_Z = -0.62;
const TPT_BELL_RIM_X = 19;
const TPT_TUBE_R = 0.255;

// A line, then a run of arcs, sampled at about `step` inches. Every piece starts where the last ended,
// so the path cannot have a gap in it.
function trumpetPath() {
  const pts = [];
  const push = (p) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > 1e-5) pts.push(p);
  };
  const line = (to, step = 0.9) => {
    const from = pts[pts.length - 1];
    const L = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let i = 1; i <= n; i++) push([lerp(from[0], to[0], i / n), lerp(from[1], to[1], i / n), lerp(from[2], to[2], i / n)]);
  };
  // A half circle in x and y from the upper line to the lower one, or back, with z easing from z0 to z1.
  const crook = (cx, yFrom, yTo, sign, z0, z1, steps = 24) => {
    const R = Math.abs(yTo - yFrom) / 2;
    const yc = (yFrom + yTo) / 2;
    const dir = yTo > yFrom ? 1 : -1;
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI;
      push([cx + sign * Math.sin(a) * R, yc - dir * Math.cos(a) * R, lerp(z0, z1, smooth(0, 1, i / steps))]);
    }
  };
  // Mouthpiece receiver, then the leadpipe forward along the upper line on the player's right.
  const LEAD_START = 2.6;
  push([LEAD_START, TPT_UP, TPT_LEAD_Z]);
  line([15.0, TPT_UP, TPT_LEAD_Z]);
  // The main tuning slide's crook, down at the front.
  crook(15.0, TPT_UP, TPT_LO, 1, TPT_LEAD_Z, TPT_LEAD_Z);
  // Back along the lower line to the third valve, easing in to the plane of the casings.
  line([12.4, TPT_LO, TPT_LEAD_Z]);
  for (let i = 1; i <= 12; i++) {
    const f = i / 12;
    push([lerp(12.4, 10.0, f), TPT_LO, lerp(TPT_LEAD_Z, 0, smooth(0, 1, f))]);
  }
  // Through the three casings, hidden inside them and showing only as the knuckles between them.
  line([5.2, TPT_LO, 0], 0.6);
  // The bell crook at the back, up to the upper line on the player's left.
  crook(5.2, TPT_LO, TPT_UP, -1, 0, TPT_BELL_Z);
  // Forward along the upper line to where the bell's lathe takes over.
  line([BELL_LATHE_FROM + 0.4, TPT_UP, TPT_BELL_Z]);
  return pts;
}
const BELL_LATHE_FROM = 11.5;

// The bell as a Bessel horn, r = B (d + d0)^-g, d being the distance back from the rim. Fitted through
// the 2.4in rim radius and the tube's own radius where the flare begins.
function bellRadius(x) {
  const d = Math.max(0, TPT_BELL_RIM_X - x);
  const g = 0.72;
  const span = TPT_BELL_RIM_X - BELL_LATHE_FROM;
  const ratio = (2.42 / TPT_TUBE_R) ** (1 / g);
  const d0 = span / (ratio - 1);
  const B = 2.42 * d0 ** g;
  return B * (d + d0) ** -g;
}

function trumpetPathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
  return L;
}

export function trumpetFacts() {
  const path = trumpetPath();
  return { pathInches: trumpetPathLength(path) + (TPT_BELL_RIM_X - BELL_LATHE_FROM - 0.4) + 2.6, slides: TRUMPET_VALVES.map((v) => trumpetSlideLength(v.semitones)) };
}

export function trumpet() {
  const IN = TPT_IN;
  const BRASS = 0xe8b442;
  const BRASS_HI = 0xf0c762;
  const NICKEL = 0xcfd0cb;
  const brass = [];
  const dark = [];
  const pearl = [];
  const stand = [];

  const OX = -9.5; // inches: the instrument's middle sits over the origin
  const AXIS_Y = 1.42; // feet: the height of the valve block's centre
  const P = (x, y, z) => [(x + OX) * IN, y * IN + AXIS_Y, z * IN];
  const place = (g) => g.applyMatrix4(new THREE.Matrix4().makeScale(IN, IN, IN)).translate(OX * IN, AXIS_Y, 0);
  const shine = (g, hex = BRASS, opts = {}) => brass.push(polished(g, hex, { ripple: 0.1, ...opts }));

  // --- the one tube ------------------------------------------------------------------------
  const path = trumpetPath();
  const main = polyTube(path.map((p) => P(...p)), TPT_TUBE_R * IN, 18);
  shine(main);

  // --- the bell: one closed solid, outer wall, rolled rim, inner wall going dark down its throat ---
  const profile = [];
  const STEPS = 34;
  for (let i = 0; i <= STEPS; i++) {
    const f = i / STEPS;
    // Samples crowd toward the rim, where the flare is quick.
    const x = lerp(BELL_LATHE_FROM, TPT_BELL_RIM_X, 1 - (1 - f) ** 1.9);
    profile.push([bellRadius(x), x]);
  }
  const WALL = 0.05;
  const rim = bellRadius(TPT_BELL_RIM_X);
  // The rolled bead at the lip, and then back down inside.
  const bead = 0.06;
  const beadPts = [
    [rim + bead * 0.75, TPT_BELL_RIM_X - bead], [rim + bead, TPT_BELL_RIM_X], [rim + bead * 0.5, TPT_BELL_RIM_X + bead * 0.85], [rim - bead * 0.35, TPT_BELL_RIM_X + bead * 0.55],
  ];
  const inner = [];
  for (let i = STEPS; i >= 3; i--) {
    const f = i / STEPS;
    const x = lerp(BELL_LATHE_FROM, TPT_BELL_RIM_X, 1 - (1 - f) ** 1.9);
    inner.push([Math.max(0.02, bellRadius(x) - WALL * (1 + (1 - f))), x]);
  }
  const bellProfile = [[0, BELL_LATHE_FROM], ...profile, ...beadPts, ...inner, [0, inner[inner.length - 1][1]]];
  const bell = latheUp(bellProfile, { segments: 64 });
  // Lathe about +Y, then +Y to +X: a real rotation, so it stays right way out.
  bell.rotateZ(-Math.PI / 2);
  bell.translate(0, TPT_UP, TPT_BELL_Z);
  place(bell);
  polishGeometry(bell, BRASS, { ripple: 0.08 });
  {
    // The inside of the bell: a warm brass at the lip and near black down the throat, which is what
    // tells the eye that it is a hollow mouth rather than a dish.
    const pos = bell.attributes.position;
    const nrm = bell.attributes.normal;
    const col = bell.attributes.color;
    const base = lin(BRASS);
    const axisY = TPT_UP * IN + AXIS_Y;
    const axisZ = TPT_BELL_Z * IN;
    for (let i = 0; i < pos.count; i++) {
      const dy = pos.getY(i) - axisY; const dz = pos.getZ(i) - axisZ;
      const r = Math.hypot(dy, dz) || 1;
      const out = (nrm.getY(i) * dy + nrm.getZ(i) * dz) / r;
      const xi = pos.getX(i) / IN - OX;
      if (out < -0.02 && xi < TPT_BELL_RIM_X + 0.02) {
        const t = smooth(BELL_LATHE_FROM + 1.5, TPT_BELL_RIM_X - 0.1, xi);
        const k = 0.012 + 0.5 * t ** 2.4;
        col.setXYZ(i, base[0] * k, base[1] * k, base[2] * k);
      }
    }
  }
  brass.push({ geometry: bell, keepColor: true });
  // A garland ring round the bell's tail, which real bells carry and which hides the join to the tube.
  {
    const sleeve = latheUp([[0, -0.2], [TPT_TUBE_R + 0.035, -0.2], [TPT_TUBE_R + 0.05, -0.15], [TPT_TUBE_R + 0.05, 0.28], [TPT_TUBE_R + 0.035, 0.34], [0, 0.34]], { segments: 18 });
    sleeve.rotateZ(-Math.PI / 2);
    sleeve.translate(BELL_LATHE_FROM + 0.3, TPT_UP, TPT_BELL_Z);
    shine(place(sleeve), BRASS_HI);
  }

  // --- the mouthpiece and receiver: a hollow cup, dark inside ----------------------------------
  const mouthpiece = latheUp([
    [0, 3.25], [0.2, 3.25], [0.2, 2.5], [0.24, 2.3], [0.19, 1.95], [0.2, 1.5], [0.3, 1.0], [0.46, 0.55], [0.58, 0.25], [0.62, 0.1], [0.56, 0.0],
    [0.44, 0.0], [0.33, 0.1], [0.29, 0.3], [0.21, 0.55], [0.12, 0.72], [0, 0.74],
  ].reverse(), { segments: 28 });
  // The list above is written from shank to lip. Reversed it starts on the axis at the bottom of the
  // cup and walks out to the lip and along the outside, with the solid on the left all the way.
  mouthpiece.rotateZ(-Math.PI / 2);
  mouthpiece.translate(0, TPT_UP, TPT_LEAD_Z);
  place(mouthpiece);
  polishGeometry(mouthpiece, 0xaeafa9, { ripple: 0.08 });
  {
    const pos = mouthpiece.attributes.position;
    const nrm = mouthpiece.attributes.normal;
    const col = mouthpiece.attributes.color;
    const ay = TPT_UP * IN + AXIS_Y; const az = TPT_LEAD_Z * IN;
    for (let i = 0; i < pos.count; i++) {
      const dy = pos.getY(i) - ay; const dz = pos.getZ(i) - az;
      const r = Math.hypot(dy, dz);
      const xi = pos.getX(i) / IN - OX;
      if (xi > 0.02 && r < 0.42 * IN && xi < 0.8 && nrm.getX(i) < 0.5 && (nrm.getY(i) * dy + nrm.getZ(i) * dz) <= 0) {
        const k = 0.04 + 0.2 * smooth(0.72, 0.1, xi);
        col.setXYZ(i, k * 0.85, k * 0.8, k * 0.68);
      }
    }
  }
  brass.push({ geometry: mouthpiece, keepColor: true });
  // The receiver the shank goes into, the start of the leadpipe.
  const receiver = latheUp([[0, 2.25], [0.3, 2.25], [0.34, 2.3], [0.34, 2.72], [0.3, 2.76], [0.285, 3.3], [0.31, 3.36], [0.31, 3.55], [0.27, 3.6], [0, 3.6]], { segments: 22 });
  receiver.rotateZ(-Math.PI / 2);
  receiver.translate(0, TPT_UP, TPT_LEAD_Z);
  shine(place(receiver), BRASS_HI);

  // --- three valves --------------------------------------------------------------------------
  const CASE_R = 0.44;
  const CASE_LOW = -2.5;
  const CASE_TOP = 2.2;
  TRUMPET_VALVES.forEach((valve) => {
    const body = latheUp([
      [0, CASE_LOW - 0.3], [0.2, CASE_LOW - 0.3], [0.42, CASE_LOW - 0.26], [0.5, CASE_LOW - 0.16], [0.5, CASE_LOW - 0.14], [0.5, CASE_LOW - 0.02], [0.44, CASE_LOW],
      [CASE_R, CASE_LOW + 0.04], [CASE_R, -1.9], [CASE_R, 0], [CASE_R, 1.9], [CASE_R, CASE_TOP - 0.04], [0.49, CASE_TOP], [0.5, CASE_TOP + 0.03], [0.5, CASE_TOP + 0.2], [0.46, CASE_TOP + 0.24],
      [0.28, CASE_TOP + 0.3], [0.14, CASE_TOP + 0.36], [0, CASE_TOP + 0.37],
    ], { segments: 36 });
    body.translate(valve.x, 0, 0);
    shine(place(body), BRASS);
    // Knurled caps: reeded by short ribs round each one, which is what makes them read as turned caps.
    for (const yc of [CASE_LOW - 0.08, CASE_TOP + 0.1]) {
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        const rib = new THREE.BoxGeometry(0.03, 0.11, 0.03).translate(valve.x + Math.sin(a) * 0.5, yc, Math.cos(a) * 0.5);
        shine(place(rib), BRASS_HI, { ripple: 0 });
      }
    }
    // The stem and finger button, at the top of its travel, with a pearl inlay on the dish.
    const STEM_TOP = 3.72;
    const stem = latheUp([[0, CASE_TOP + 0.3], [0.09, CASE_TOP + 0.3], [0.09, STEM_TOP - 0.02], [0, STEM_TOP]], { segments: 12 });
    stem.translate(valve.x, 0, 0);
    brass.push(polished(place(stem), NICKEL));
    const button = latheUp([[0, STEM_TOP - 0.18], [0.2, STEM_TOP - 0.18], [0.36, STEM_TOP - 0.1], [0.42, STEM_TOP - 0.02], [0.42, STEM_TOP + 0.05], [0.38, STEM_TOP + 0.08], [0.3, STEM_TOP + 0.09], [0, STEM_TOP + 0.09]], { segments: 26 });
    button.translate(valve.x, 0, 0);
    shine(place(button), BRASS_HI);
    const inlay = latheUp([[0, STEM_TOP + 0.08], [0.29, STEM_TOP + 0.08], [0.29, STEM_TOP + 0.095], [0.2, STEM_TOP + 0.102], [0, STEM_TOP + 0.105]], { segments: 22 });
    inlay.translate(valve.x, 0, 0);
    pearl.push(flat(place(inlay), 0xe9e3d3));
  });

  // Upper knuckles between the casings, the other half of the path through them.
  for (const [a, b] of [[TRUMPET_VALVES[0], TRUMPET_VALVES[1]], [TRUMPET_VALVES[1], TRUMPET_VALVES[2]]]) {
    shine(polyTube([P(a.x, 0.72, 0), P((a.x + b.x) / 2, 0.86, 0), P(b.x, 0.72, 0)], 0.17 * IN, 12));
  }

  // --- the three valve slides, from their computed lengths ---------------------------------
  // A U of two legs and a crook: length = 2 x leg + pi x width / 2, solved for the leg.
  const slide = (valve, { y0, y1, z, stub = 0.72 }) => {
    const L = trumpetSlideLength(valve.semitones);
    const W = Math.abs(y1 - y0);
    const stubs = 2 * (Math.abs(z) - CASE_R);
    const leg = Math.max(0.3, (L - stubs - (Math.PI * W) / 2) / 2);
    const pts = [];
    const xs = valve.x;
    // Out of the casing's side, then forward along the leg, round, and back.
    const zStart = Math.sign(z) * (CASE_R - 0.1);
    pts.push([xs, y0, zStart]);
    pts.push([xs, y0, z * 0.72]);
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      pts.push([xs + stub * 0.25 * (1 - Math.cos(a)), y0, z * 0.72 + (z * 0.28) * Math.sin(a)]);
    }
    const xLeg = xs + stub * 0.25 + leg;
    const steps = 18;
    pts.push([lerp(xs + stub * 0.25, xLeg, 0.5), y0, z]);
    pts.push([xLeg, y0, z]);
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * Math.PI;
      pts.push([xLeg + Math.sin(a) * (W / 2), (y0 + y1) / 2 + Math.cos(a) * ((y0 - y1) / 2), z]);
    }
    pts.push([lerp(xs + stub * 0.25, xLeg, 0.5), y1, z]);
    for (let i = 4; i >= 0; i--) {
      const a = (i / 4) * (Math.PI / 2);
      pts.push([xs + stub * 0.25 * (1 - Math.cos(a)), y1, z * 0.72 + (z * 0.28) * Math.sin(a)]);
    }
    pts.push([xs, y1, zStart]);
    shine(polyTube(pts.map((p) => P(...p)), 0.2 * IN, 14));
    // Ferrules where the slide's legs enter its tubes, a sleeve on each leg.
    for (const y of [y0, y1]) {
      const x0 = xs + stub * 0.25 + leg * 0.32;
      shine(polyTube([P(x0, y, z), P(x0 + 0.5, y, z)], [0.25 * IN, 0.25 * IN], 14), BRASS_HI);
    }
    return { xLeg, W, y0, y1, z, end: xLeg + W / 2 };
  };
  const s1 = slide(TRUMPET_VALVES[0], { y0: 0.5, y1: -0.42, z: -0.74 });
  slide(TRUMPET_VALVES[1], { y0: 0.42, y1: -0.46, z: 0.68, stub: 0.6 });
  const s3 = slide(TRUMPET_VALVES[2], { y0: -0.92, y1: -1.94, z: -0.74 });

  // The left hand's fittings: a thumb saddle on the first slide, a finger ring on the third.
  {
    const x = s1.xLeg - 0.2;
    const saddle = new THREE.TorusGeometry(0.27, 0.05, 8, 20, Math.PI * 1.15).rotateZ(-0.2).rotateY(Math.PI / 2);
    saddle.translate(x, s1.y0 + 0.28, s1.z - 0.02);
    shine(place(saddle), BRASS_HI);
    shine(polyTube([P(x, s1.y0, s1.z), P(x, s1.y0 + 0.2, s1.z - 0.02)], 0.045 * IN, 8), BRASS_HI);
    const xr = s3.xLeg - 0.4;
    const ring = new THREE.TorusGeometry(0.42, 0.05, 8, 26).rotateY(0);
    ring.translate(xr, s3.y1 - 0.52, s3.z - 0.02);
    shine(place(ring), BRASS_HI);
  }

  // --- the bracing, so it holds together as one instrument ----------------------------------
  // Between the leadpipe and the bell tube, and across the crooks.
  const stay = (a, b, r = 0.055) => {
    shine(polyTube([P(...a), P(...b)], r * IN, 8), BRASS_HI);
    for (const q of [a, b]) shine(new THREE.SphereGeometry(r * 1.9 * IN, 8, 6).translate(...P(...q)), BRASS_HI);
  };
  stay([4.0, TPT_UP, TPT_LEAD_Z - 0.2], [5.4, TPT_UP, TPT_BELL_Z + 0.2]);
  stay([11.4, TPT_UP, TPT_LEAD_Z - 0.2], [11.4, TPT_UP, TPT_BELL_Z + 0.2]);
  stay([14.2, TPT_UP - 0.18, TPT_LEAD_Z], [14.2, TPT_LO + 0.18, TPT_LEAD_Z], 0.085);
  // Each casing to the upper line, on both sides: the leadpipe and the bell tube run past their walls.
  for (const v of TRUMPET_VALVES) {
    stay([v.x, TPT_UP - 0.12, TPT_LEAD_Z - 0.16], [v.x, TPT_UP - 0.25, CASE_R - 0.04], 0.07);
    stay([v.x, TPT_UP - 0.12, TPT_BELL_Z + 0.16], [v.x, TPT_UP - 0.25, -CASE_R + 0.04], 0.07);
  }

  // --- the little-finger hook, on top of the leadpipe ------------------------------------------
  {
    const x = 10.15;
    const hook = [];
    for (let i = 0; i <= 12; i++) {
      const a = lerp(-0.25, Math.PI * 1.05, i / 12);
      hook.push([x + Math.cos(a) * 0.3, TPT_UP + TPT_TUBE_R + 0.32 + Math.sin(a) * 0.3, TPT_LEAD_Z]);
    }
    const foot = [[x + 0.28, TPT_UP + TPT_TUBE_R - 0.04, TPT_LEAD_Z], [x + 0.3, TPT_UP + TPT_TUBE_R + 0.22, TPT_LEAD_Z]];
    shine(polyTube([...foot, ...hook].map((p) => P(...p)), 0.05 * IN, 8), BRASS_HI);
    shine(new THREE.SphereGeometry(0.07 * IN, 8, 6).translate(...P(hook[12][0], hook[12][1], hook[12][2])), BRASS_HI);
  }

  // --- the water key, on the low point of the tuning slide's crook --------------------------------
  {
    const x = 14.75; const y = TPT_LO; const z = TPT_LEAD_Z;
    // The saddle on the tube, a lever on a pin, a spring and a cork pad.
    const under = y - TPT_TUBE_R;
    shine(new THREE.BoxGeometry(0.08, 0.1, 0.2).translate(x - 0.9, under - 0.02, z).applyMatrix4(new THREE.Matrix4().makeScale(IN, IN, IN)).translate(OX * IN, AXIS_Y, 0), BRASS_HI);
    shine(polyTube([P(x - 1.1, under - 0.05, z), P(x - 0.3, under - 0.09, z), P(x + 0.15, under - 0.06, z)], [0.05 * IN, 0.05 * IN, 0.07 * IN], 8), NICKEL);
    shine(polyTube([P(x - 1.2, under - 0.02, z), P(x - 1.36, under - 0.14, z)], 0.075 * IN, 8), BRASS_HI);
    dark.push(flat(new THREE.CylinderGeometry(0.11 * IN, 0.11 * IN, 0.06 * IN, 12).translate(...P(x + 0.15, under + 0.01, z)), 0x3a2615));
    shine(new THREE.CylinderGeometry(0.1 * IN, 0.1 * IN, 0.08 * IN, 12).translate(...P(x + 0.15, under + 0.04, z)), BRASS_HI);
  }

  // --- the low stand ---------------------------------------------------------------------------
  const BASE_TOP = walnutBase(stand, 1.5, { oval: 2.05 });
  // Two turned posts with padded forks: behind the valves under the bell tail, and under the tuning slide.
  const lowY = TPT_LO * IN + AXIS_Y - TPT_TUBE_R * IN;
  for (const [xi, zi] of [[5.4, 0], [13.2, TPT_LEAD_Z]]) {
    const [px, , pz] = P(xi, 0, zi);
    const top = lowY - 0.045;
    const post = latheUp([
      [0, BASE_TOP - 0.02], [0.2, BASE_TOP - 0.02], [0.2, BASE_TOP + 0.03], [0.14, BASE_TOP + 0.06], [0.07, BASE_TOP + 0.13],
      [0.055, top - 0.12], [0.085, top - 0.08], [0.06, top - 0.05], [0.06, top - 0.02], [0, top],
    ], { segments: 18 });
    stand.push(flat(post, WALNUT_FLAT, { position: [px, 0, pz] }));
    // A padded cradle, wider than the tube and sunk round it.
    stand.push(flat(new THREE.SphereGeometry(0.135, 16, 10).scale(1.25, 0.5, 1.15).translate(px, top + 0.01, pz), PAD_RED));
  }

  return group([
    mesh(mergeParts(brass), standard({ vertexColors: true, roughness: 0.24, metalness: 0.32 })),
    mesh(mergeParts([...dark, ...pearl]), standard({ vertexColors: true, roughness: 0.4, metalness: 0 })),
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })),
  ], 'trumpet');
}

// ---------------------------------------------------------------------------
// SITAR
// ---------------------------------------------------------------------------

// Twice life size. In the instrument's own frame x is across, y runs from the bottom of the gourd up
// the neck, z is out of the face; the whole is then laid diagonally, the way it is held, on a stand.
export const SITAR_PLAYING_STRINGS = 7;
export const SITAR_SYMPATHETIC_STRINGS = 13;
export const SITAR_FRET_COUNT = 20;
// A sitar's frets are tied on and moved to suit the raga, so no table is THE layout. This is one
// plausible arrangement: semitones above the open string, a mostly chromatic run with five gaps low down.
export const SITAR_FRET_SEMITONES = [2, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25];
const SITAR_NUT_Y = 6.85;
const SITAR_BRIDGE_Y = 0.95;
const SITAR_SCALE = SITAR_NUT_Y - SITAR_BRIDGE_Y;
const SITAR_NECK_TOP = 0.045;
const SITAR_FACE_TOP = 0.03;
const SITAR_ARCH_H = 0.115;
const SITAR_ARCH_A = 0.245;
const SITAR_STRING_Z = SITAR_NECK_TOP + SITAR_ARCH_H + 0.02;

function tableFn(knots, per = 8) {
  // Knots are [value, y], rising in y.
  const line = spline2(knots, per);
  return (y) => {
    if (y <= line[0][1]) return line[0][0];
    for (let i = 0; i < line.length - 1; i++) {
      if (y <= line[i + 1][1]) return lerp(line[i][0], line[i + 1][0], (y - line[i][1]) / ((line[i + 1][1] - line[i][1]) || 1));
    }
    return line[line.length - 1][0];
  };
}
const SITAR_PEAR = [[0.0, 0], [0.5, 0.045], [0.86, 0.24], [1.06, 0.6], [1.12, 1.0], [1.03, 1.42], [0.78, 1.82], [0.5, 2.12], [0.335, 2.34], [0.285, 2.5]];

function sitarAtlas(pearW) {
  // Left 0..0.72 is the face, x -1.16..1.16 and y -0.02..2.52. Right 0.74..1 is the neck, y 2.3..7.8.
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const rng = seededRandom(1720);
    const fw = 0.72 * w;
    const X = (x) => ((x + 1.16) / 2.32) * fw;
    const Y = (y) => (1 - (y + 0.02) / 2.54) * h;
    const SX = fw / 2.32; const SY = h / 2.54;

    // Lacquered teak, deep and warm.
    ctx.fillStyle = '#46240f';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = rng() * w;
      ctx.strokeStyle = rng() > 0.7 ? `rgba(150,88,38,${0.05 + rng() * 0.08})` : `rgba(18,8,2,${0.06 + rng() * 0.12})`;
      ctx.lineWidth = 0.6 + rng() * 1.6;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (rng() - 0.5) * 6, h); ctx.stroke();
    }

    const BONE = '#ecdfc0';
    const BONE_DK = '#b8a176';
    const petal = (x, y, len, wid, ang, fill = BONE) => {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.3, -wid, len * 0.75, -wid * 0.8, len, 0);
      ctx.bezierCurveTo(len * 0.75, wid * 0.8, len * 0.3, wid, 0, 0);
      ctx.fill();
      ctx.restore();
    };
    const flower = (x, y, r, n, fill = BONE) => {
      for (let i = 0; i < n; i++) petal(x, y, r, r * 0.3, (i / n) * Math.PI * 2, fill);
      ctx.fillStyle = '#7d2b16';
      ctx.beginPath(); ctx.arc(x, y, r * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = BONE_DK;
      ctx.beginPath(); ctx.arc(x, y, r * 0.09, 0, Math.PI * 2); ctx.fill();
    };

    // Clip to the pear, so that the border is cut from the face's own outline.
    const outline = [];
    for (let i = 0; i <= 60; i++) { const y = (i / 60) * 2.5; outline.push([pearW(y), y]); }
    const pear = [...outline, ...[...outline].reverse().map(([x, y]) => [-x, y])];
    const trace = (scale) => {
      ctx.beginPath();
      pear.forEach(([x, y], i) => {
        const px = X(x * scale); const py = Y(1.0 + (y - 1.0) * scale);
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.closePath();
    };
    // Bone lines, an outer band of leaves between them, then a second.
    ctx.strokeStyle = BONE; ctx.lineWidth = 5; trace(0.975); ctx.stroke();
    ctx.lineWidth = 2.4; trace(0.885); ctx.stroke();
    for (let i = 0; i < pear.length; i++) {
      if (i % 2) continue;
      const [x, y] = pear[i];
      const [x2, y2] = pear[(i + 1) % pear.length];
      const px = X(x * 0.93); const py = Y(1.0 + (y - 1.0) * 0.93);
      const ang = Math.atan2(Y(y2) - Y(y), X(x2) - X(x));
      petal(px, py, 13, 4, ang + 0.6, i % 4 ? BONE : '#c9a34e');
      petal(px, py, 13, 4, ang - 0.6 + Math.PI, BONE);
    }

    // The rosette, centred under the bridges, and scrolling vines reaching out from it.
    const cx = X(0); const cy = Y(0.95);
    // Open work, thin against the dark: a solid white sunburst here would swallow the bridge on it.
    for (const [r0, r1, n, col] of [[0.38, 0.52, 28, BONE], [0.24, 0.36, 20, '#c9a34e'], [0.12, 0.22, 12, BONE]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        petal(cx + Math.cos(a) * r0 * SX, cy + Math.sin(a) * r0 * SX, (r1 - r0) * SX, (r1 - r0) * SX * 0.2, a, col);
      }
    }
    ctx.strokeStyle = BONE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, 0.56 * SX, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, 0.6 * SX, 0, Math.PI * 2); ctx.stroke();
    flower(cx, cy, 0.09 * SX, 10);

    // Vines, mirrored about the centre line: a teacher looking at this should see one hand's design.
    const vine = (s, pts) => {
      ctx.strokeStyle = BONE; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const px = X(s * x); const py = Y(y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
      pts.forEach(([x, y], i) => {
        if (i % 3 === 1) {
          const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
          const ang = Math.atan2(Y(ny) - Y(y), X(s * nx) - X(s * x));
          petal(X(s * x), Y(y), 22, 7, ang + 0.85, BONE);
          petal(X(s * x), Y(y), 22, 7, ang - 0.85, '#c9a34e');
        }
      });
    };
    for (const s of [-1, 1]) {
      vine(s, spline2([[0.56, 0.95], [0.72, 1.12], [0.72, 1.32], [0.56, 1.46], [0.42, 1.6], [0.34, 1.82], [0.22, 2.02]], 3));
      vine(s, spline2([[0.56, 0.86], [0.72, 0.72], [0.72, 0.5], [0.56, 0.34], [0.3, 0.26], [0.12, 0.2]], 3));
      flower(X(s * 0.8), Y(0.95), 0.1 * SX, 8);
      flower(X(s * 0.52), Y(1.56), 0.075 * SX, 8);
      flower(X(s * 0.56), Y(0.34), 0.075 * SX, 8);
    }
    // A lacquer sheen, darker to the edges of the face.
    const shade = ctx.createRadialGradient(cx, cy, 0.3 * SX, cx, cy, 1.25 * SX);
    shade.addColorStop(0, 'rgba(90,40,10,0)');
    shade.addColorStop(1, 'rgba(10,4,0,0.34)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, fw, h);

    // The neck strip: a bone rail each side and a run of flowers between them.
    const nx0 = 0.74 * w; const nw = 0.26 * w;
    ctx.save();
    ctx.beginPath(); ctx.rect(nx0, 0, nw, h); ctx.clip();
    ctx.fillStyle = '#3f200e';
    ctx.fillRect(nx0, 0, nw, h);
    for (let i = 0; i < 140; i++) {
      const x = nx0 + rng() * nw;
      ctx.strokeStyle = `rgba(16,7,2,${0.08 + rng() * 0.14})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    const cxN = nx0 + nw / 2;
    ctx.fillStyle = BONE;
    ctx.fillRect(nx0 + 8, 0, 6, h); ctx.fillRect(nx0 + nw - 14, 0, 6, h);
    ctx.fillStyle = '#c9a34e';
    ctx.fillRect(nx0 + 18, 0, 2.5, h); ctx.fillRect(nx0 + nw - 20.5, 0, 2.5, h);
    const N = 16;
    for (let i = 0; i < N; i++) {
      const y = ((i + 0.5) / N) * h;
      flower(cxN, y, nw * 0.2, i % 2 ? 8 : 6);
      for (const s of [-1, 1]) {
        petal(cxN + s * nw * 0.05, y + (h / N) * 0.5, nw * 0.2, 5, s > 0 ? -0.6 : Math.PI + 0.6, '#c9a34e');
        petal(cxN + s * nw * 0.05, y + (h / N) * 0.5, nw * 0.2, 5, s > 0 ? 0.6 : Math.PI - 0.6, BONE);
      }
    }
    ctx.restore();
  });
}

export function sitar() {
  const pearW = tableFn(SITAR_PEAR);
  const pearD = (y) => pearW(y) * lerp(0.86, 0.72, smooth(1.2, 2.4, y));
  const plates = [];
  const wood = [];
  const bone = [];
  const metal = [];
  const silk = [];
  const stand = [];

  // --- the big gourd: a closed bowl with its face cut flat ------------------------------------
  const ringsG = [];
  const BACK = 50;
  const FLATS = 7;
  const STN = [];
  for (let i = 0; i <= 44; i++) STN.push(0.012 + (2.46 - 0.012) * (1 - Math.cos((i / 44) * Math.PI * 0.72)) / (1 - Math.cos(Math.PI * 0.72)));
  for (const y of STN) {
    const hw = Math.max(0.012, pearW(y));
    const dp = Math.max(0.012, pearD(y));
    const ring = [];
    for (let j = 0; j <= BACK; j++) {
      const q = (j / BACK) * Math.PI;
      ring.push([Math.cos(q) * hw, y, -Math.sin(q) * dp]);
    }
    for (let j = 1; j < FLATS; j++) ring.push([lerp(-hw, hw, j / FLATS), y, 0]);
    ringsG.push(ring);
  }
  const gourd = loftRings(ringsG, { uv: (i, j, p) => [p[0] * 0.8, p[1] * 0.45] });
  const AMBER = lin(0x8a4818);
  wood.push(painted(gourd, (p) => {
    // A lacquered gourd, deepening to the bottom, with a soft mottling and painted ribs.
    const a = Math.atan2(-p.z, p.x);
    const rib = 0.88 + 0.12 * Math.abs(Math.cos(a * 8)) ** 0.5;
    const n = smoothNoise3(p.x * 2.2, p.y * 2.2, p.z * 2.2);
    const k = lerp(0.55, 1.06, smooth(0, 1.4, p.y)) * (0.84 + 0.3 * n) * rib;
    return [AMBER[0] * k, AMBER[1] * k, AMBER[2] * k];
  }));

  // The face: a plate with its painted inlay, and a bone binding round it.
  const hWay = [];
  for (let i = 0; i <= 60; i++) { const y = (i / 60) * 2.5; hWay.push([Math.max(0.002, pearW(y)), y]); }
  const pearOutline = [...hWay, ...[...hWay].reverse().map(([x, y]) => [-x, y])].filter((p, i, all) => i === 0 || Math.hypot(p[0] - all[i - 1][0], p[1] - all[i - 1][1]) > 1e-4);
  const atlasFace = (g) => uvPlanar(g, (x, y) => [(((x + 1.16) / 2.32) * 0.72), (y + 0.02) / 2.54]);
  plates.push({ geometry: atlasFace(plateSolid(pearOutline, [], [[0, -0.03], [0, SITAR_FACE_TOP - 0.003], [0.003, SITAR_FACE_TOP]], { crease: 50 })), color: 0xffffff });
  bone.push(flat(plateSolid(offsetLoop(pearOutline, -0.016), [pearOutline], [[0, -0.05], [0, SITAR_FACE_TOP], [0.004, SITAR_FACE_TOP + 0.004]], { crease: 60 }), 0xe6d8b4));

  // --- neck: a wide D-section, hollow in life; the face plate of it carries the inlay -----------
  const NECK_LOW = 2.0;
  const NECK_HIGH = 7.72;
  const neckHW = (y) => lerp(0.272, 0.25, clamp((y - 2.4) / 5.3, 0, 1));
  const neckDP = (y) => lerp(0.24, 0.17, clamp((y - 2.4) / 5.3, 0, 1));
  const neckRings = [];
  for (let i = 0; i <= 24; i++) {
    const y = lerp(NECK_LOW, NECK_HIGH, i / 24);
    const hw = neckHW(y); const dp = neckDP(y);
    const ring = [];
    for (let j = 0; j <= 22; j++) {
      const q = (j / 22) * Math.PI;
      ring.push([Math.cos(q) * hw, y, -(Math.sin(q) ** 0.8) * dp]);
    }
    for (let j = 1; j < 3; j++) ring.push([lerp(-hw, hw, j / 3), y, 0.01]);
    neckRings.push(ring);
  }
  const NECK_COL = lin(0x6e3a16);
  wood.push(painted(loftRings(neckRings, { uv: (i, j, p) => [p[0] * 1.2 + p[2] * 1.2, p[1] * 0.3] }), () => NECK_COL));
  const neckPlate = plateSolid([[0.268, 2.38], [0.247, NECK_HIGH], [-0.247, NECK_HIGH], [-0.268, 2.38]], [], [[0, 0.0], [0, SITAR_NECK_TOP - 0.003], [0.003, SITAR_NECK_TOP]], { crease: 30 });
  uvPlanar(neckPlate, (x, y) => [0.74 + ((x + 0.27) / 0.54) * 0.26, (y - 2.3) / 5.5]);
  plates.push({ geometry: neckPlate, color: 0xffffff });
  // Bone rails along the neck's long edges.
  for (const s of [-1, 1]) {
    bone.push(flat(beam([s * neckHW(2.38), 2.38, SITAR_NECK_TOP - 0.012], [s * neckHW(NECK_HIGH), NECK_HIGH, SITAR_NECK_TOP - 0.012], 0.026, 0.04, { side: [1, 0, 0], r: 0.008 }), 0xe6d8b4));
  }

  // The carved collar where the neck runs into the gourd, covering the junction on every side.
  const collarRings = [];
  for (const [y, grow] of [[2.31, 0.008], [2.335, 0.03], [2.37, 0.03], [2.385, 0.014], [2.42, 0.014], [2.435, 0.034], [2.47, 0.034], [2.5, 0.006]]) {
    const hw = Math.max(neckHW(y), pearW(Math.min(y, 2.5))) + grow;
    const dp = Math.max(neckDP(y), pearD(Math.min(y, 2.5))) + grow;
    const ring = [];
    for (let j = 0; j <= 30; j++) {
      const q = (j / 30) * Math.PI;
      ring.push([Math.cos(q) * hw, y, -Math.sin(q) * dp]);
    }
    for (let j = 1; j < 4; j++) ring.push([lerp(-hw, hw, j / 4), y, SITAR_NECK_TOP + 0.006]);
    collarRings.push(ring);
  }
  bone.push(flat(loftRings(collarRings), 0xdfcfa6));

  // --- the second gourd, on the back near the top, and the turned finial ----------------------
  const G2Y = 6.28;
  const G2R = 0.54;
  const g2 = latheUp([
    [0, -G2R * 0.96], [G2R * 0.34, -G2R * 0.93], [G2R * 0.66, -G2R * 0.74], [G2R * 0.9, -G2R * 0.42], [G2R, 0], [G2R * 0.9, G2R * 0.42], [G2R * 0.66, G2R * 0.74], [G2R * 0.34, G2R * 0.93], [0, G2R * 0.96],
  ].flatMap((p, i, all) => {
    if (i === all.length - 1) return [p];
    const q = all[i + 1];
    return [p, [lerp(p[0], q[0], 0.5), lerp(p[1], q[1], 0.5)]];
  }), { segments: 44 });
  g2.rotateX(Math.PI / 2);
  g2.scale(1, 1, 0.82);
  const G2Z = -neckDP(G2Y) - G2R * 0.82 + 0.1;
  g2.translate(0, G2Y, G2Z);
  uvPlanar(g2, (x, y, z) => [x * 0.8 + z * 0.3, y * 0.45]);
  wood.push(painted(g2, (p) => {
    const a = Math.atan2(p.y - G2Y, p.x);
    const r = Math.hypot(p.x, p.y - G2Y);
    const rib = 0.82 + 0.18 * Math.abs(Math.cos(a * 6)) ** 0.5;
    const k = (0.92 + 0.26 * smoothNoise3(p.x * 3, p.y * 3, p.z * 3)) * rib;
    const band = r > G2R * 0.56 && r < G2R * 0.6 ? [0.5, 0.36, 0.14] : null;
    return band ?? [AMBER[0] * k, AMBER[1] * k, AMBER[2] * k];
  }));
  // A turned collar joining it to the neck's back.
  const g2Collar = latheUp([[0, 0], [0.21, 0], [0.24, 0.03], [0.2, 0.09], [0.16, 0.14], [0.2, 0.18], [0.13, 0.22], [0, 0.23]], { segments: 22 });
  g2Collar.rotateX(-Math.PI / 2);
  g2Collar.scale(1, 1, 1);
  g2Collar.translate(0, G2Y, G2Z + G2R * 0.82 + 0.13 - 0.23);
  bone.push(flat(orientOut(g2Collar), 0xdfcfa6));
  // The finial on the top of the neck.
  const finial = latheUp([[0, 0], [0.25, 0], [0.26, 0.02], [0.2, 0.05], [0.14, 0.08], [0.17, 0.12], [0.1, 0.15], [0.07, 0.19], [0.1, 0.22], [0.05, 0.26], [0, 0.28]], { segments: 22 });
  finial.scale(1, 1, 0.72);
  finial.translate(0, NECK_HIGH - 0.015, -0.03);
  bone.push(flat(finial, 0xdfcfa6));

  // --- exactly twenty arched frets, each a metal hoop standing on the neck, tied at both feet ----
  const fretYs = SITAR_FRET_SEMITONES.map((s) => SITAR_NUT_Y - SITAR_SCALE * (1 - 2 ** (-s / 12)));
  if (fretYs.length !== SITAR_FRET_COUNT) throw new Error('sitar frets');
  fretYs.forEach((y) => {
    const a = Math.min(SITAR_ARCH_A, neckHW(y) - 0.022);
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const q = (i / 14) * Math.PI;
      pts.push([Math.cos(q) * a, y, SITAR_NECK_TOP - 0.012 + (SITAR_ARCH_H + 0.012) * Math.sin(q) ** 0.72]);
    }
    metal.push(flat(polyTube(pts, 0.012, 6), 0xd9d1b5));
    for (const s of [-1, 1]) silk.push(flat(new THREE.SphereGeometry(0.024, 8, 5).scale(1, 1.25, 0.9).translate(s * a, y, SITAR_NECK_TOP + 0.012), 0x9a2520));
  });

  // Nut.
  bone.push(flat(beam([-0.25, SITAR_NUT_Y, SITAR_NECK_TOP + 0.06], [0.25, SITAR_NUT_Y, SITAR_NECK_TOP + 0.06], 0.05, SITAR_STRING_Z - SITAR_NECK_TOP + 0.02, { side: [0, 1, 0], r: 0.012 }), 0xece0c4));
  // Feet of the nut, reaching the neck.
  bone.push(flat(new THREE.BoxGeometry(0.46, 0.05, 0.06).translate(0, SITAR_NUT_Y, SITAR_NECK_TOP + 0.02), 0xe0d3b2));

  // --- main bridge and the small bridge for the sympathetic strings --------------------------
  const archTop = (x) => SITAR_STRING_Z - 0.008 - (x * x) * 0.1;
  const BW = 0.42;
  const archOpen = 0.27;
  const bridgeLine = [
    [BW, SITAR_FACE_TOP - 0.004], [BW, SITAR_FACE_TOP + 0.05], [BW - 0.03, archTop(BW - 0.03) - 0.016],
    ...[BW - 0.06, 0.25, 0.1, -0.1, -0.25, -(BW - 0.06)].map((x) => [x, archTop(x)]),
    [-(BW - 0.03), archTop(BW - 0.03) - 0.016], [-BW, SITAR_FACE_TOP + 0.05], [-BW, SITAR_FACE_TOP - 0.004],
    ...Array.from({ length: 13 }, (_, i) => {
      const q = (i / 12) * Math.PI;
      return [-Math.cos(q) * archOpen, SITAR_FACE_TOP - 0.004 + Math.sin(q) * 0.09];
    }),
  ];
  const mainBridge = plateSolid(bridgeLine, [], [[0.004, -0.1], [0, -0.092], [0, 0.092], [0.004, 0.1]], { crease: 50 });
  mainBridge.rotateX(Math.PI / 2);
  mainBridge.translate(0, SITAR_BRIDGE_Y, 0);
  bone.push(flat(mainBridge, 0xece0c4));
  const TARAB_Y = 1.24;
  const TARAB_Z = SITAR_FACE_TOP + 0.05;
  bone.push(flat(beam([-0.26, TARAB_Y, SITAR_FACE_TOP + 0.022], [0.26, TARAB_Y, SITAR_FACE_TOP + 0.022], 0.05, 0.056, { side: [0, 1, 0], r: 0.012 }), 0xece0c4));
  // The tail piece the strings all start from.
  const TAIL_Y = 0.1;
  bone.push(flat(beam([-0.3, TAIL_Y, SITAR_FACE_TOP + 0.014], [0.3, TAIL_Y, SITAR_FACE_TOP + 0.014], 0.09, 0.05, { side: [0, 1, 0], r: 0.02 }), 0xe3d5b0));

  // --- seven playing strings over the frets ---------------------------------------------------
  // Three drone strings on the -x side reach side pegs, four main strings reach pegs on the face.
  const PEG_FRONT = [[0.17, 7.02], [0.1, 7.2], [0.03, 7.38], [-0.04, 7.56]];
  const PEG_SIDE_Y = [7.0, 7.24, 7.48];
  const strings = [];
  for (let i = 0; i < SITAR_PLAYING_STRINGS; i++) {
    const chikari = i < 3;
    const atBridge = lerp(-0.3, 0.3, i / 6);
    const atNut = lerp(-0.19, 0.2, i / 6);
    const atTail = lerp(-0.22, 0.22, i / 6);
    const r = chikari ? 0.0058 : lerp(0.0105, 0.0066, (i - 3) / 3);
    const pts = [[atTail, TAIL_Y, SITAR_FACE_TOP + 0.04], [atBridge, SITAR_BRIDGE_Y, archTop(atBridge) + r * 0.6], [atNut, SITAR_NUT_Y, SITAR_STRING_Z + 0.008]];
    if (chikari) {
      const yE = PEG_SIDE_Y[i];
      const xE = -0.205;
      pts.push([xE, yE, SITAR_NECK_TOP + 0.016]);
      bone.push(flat(new THREE.SphereGeometry(0.018, 8, 5).scale(1, 1, 0.6).translate(xE, yE, SITAR_NECK_TOP + 0.002), 0xf0e6cc));
    } else {
      const [px, py] = PEG_FRONT[6 - i];
      pts.push([px, py, SITAR_NECK_TOP + 0.09]);
    }
    strings.push({ pts, r, colour: i === 3 ? 0xc29a55 : 0xd8dade });
    metal.push(flat(polyTube(pts, r, 7), i === 3 ? 0xc29a55 : 0xd8dade));
  }

  // --- thirteen sympathetic strings, under the frets, each to its own little side peg ----------
  const SYM_Y0 = 3.86;
  const SYM_Y1 = 6.7;
  const symYs = [];
  for (let k = 0; k < SITAR_SYMPATHETIC_STRINGS; k++) {
    const yEnd = lerp(SYM_Y0, SYM_Y1, k / (SITAR_SYMPATHETIC_STRINGS - 1));
    symYs.push(yEnd);
    // The string ending lowest takes the lane nearest its pegs, so that no two ever cross.
    const lane = lerp(0.215, -0.2, k / (SITAR_SYMPATHETIC_STRINGS - 1));
    const xE = 0.218;
    const zLow = SITAR_NECK_TOP + 0.024;
    const atTarab = [lerp(0.24, -0.24, k / 12), TARAB_Y, TARAB_Z + 0.006];
    const atTail = [lerp(0.18, -0.18, k / 12), TAIL_Y, SITAR_FACE_TOP + 0.02];
    // Passes under the main bridge's arch on its way, and well under every fret's hoop.
    const atOpen = [lerp(0.2, -0.2, k / 12), SITAR_BRIDGE_Y, SITAR_FACE_TOP + 0.03];
    const entering = [lane, 2.5, zLow];
    const pts = [atTail, atOpen, atTarab, entering, [xE, yEnd, zLow - 0.008]];
    metal.push(flat(polyTube(pts, 0.0044, 5), 0xc9ccd0));
    // A little bone eye it disappears through.
    bone.push(flat(new THREE.SphereGeometry(0.0155, 8, 5).scale(1, 1, 0.55).translate(xE, yEnd, SITAR_NECK_TOP + 0.004), 0xf0e6cc));
    // Its small peg on the neck's +x side.
    const peg = latheUp([
      [0, 0], [0.018, 0], [0.018, 0.2], [0.03, 0.215], [0.03, 0.235], [0.024, 0.25], [0.056, 0.285], [0.068, 0.335], [0.05, 0.375], [0.018, 0.395], [0, 0.4],
    ], { segments: 10 });
    peg.scale(1, 1, 0.6);
    peg.rotateZ(-Math.PI / 2);
    peg.translate(neckHW(yEnd) - 0.05, yEnd, -0.03);
    bone.push(painted(peg, (p) => (p.x > neckHW(yEnd) + 0.19 ? lin(0x4c2912) : lin(0xdfcfa6))));
  }

  // --- the seven main pegs -----------------------------------------------------------------
  const mainPeg = () => latheUp([
    [0, 0], [0.03, 0], [0.03, 0.34], [0.05, 0.36], [0.05, 0.39], [0.042, 0.41], [0.085, 0.46], [0.115, 0.56], [0.1, 0.64], [0.05, 0.69], [0.05, 0.71], [0.024, 0.73], [0, 0.735],
  ], { segments: 14 });
  const pegColour = (axis, from) => (p) => {
    const d = (axis === 'z' ? p.z : -p.x) - from;
    if (d > 0.68 || (d > 0.33 && d < 0.42)) return lin(0xe6d8b4);
    return lin(0x5a2f12);
  };
  for (const [px, py] of PEG_FRONT) {
    const g = mainPeg();
    g.scale(0.58, 1, 1);
    g.rotateX(Math.PI / 2);
    g.translate(px, py, -0.04);
    bone.push(painted(g, pegColour('z', -0.04)));
  }
  for (const y of PEG_SIDE_Y) {
    const g = mainPeg();
    g.scale(1, 1, 0.58);
    g.rotateZ(Math.PI / 2);
    g.translate(-neckHW(y) + 0.06, y, -0.03);
    bone.push(painted(g, pegColour('x', neckHW(y) - 0.06)));
  }

  // --- laid diagonally on its stand -----------------------------------------------------------
  const ROLL = THREE.MathUtils.degToRad(35);
  const TILT = 0.13;
  const CX = 2.1;
  const LIFT = 0.86;
  const pose = new THREE.Matrix4().makeTranslation(CX, LIFT, 0.38)
    .multiply(new THREE.Matrix4().makeRotationZ(ROLL))
    .multiply(new THREE.Matrix4().makeRotationX(-TILT));
  const onStand = (p) => v3(p).applyMatrix4(pose).toArray();

  const BASE_TOP = walnutBase(stand, 1.55, { oval: 2.1 });
  // Two turned posts with padded rests take the gourd's weight, on points asked of its own surface.
  for (const [q, y] of [[Math.PI * 0.78, 0.2], [Math.PI * 0.3, 0.16]]) {
    const hw = pearW(y); const dp = pearD(y);
    const rest = onStand([Math.cos(q) * hw, y - 0.05, -Math.sin(q) * dp]);
    const top = rest[1] - 0.03;
    const post = latheUp([
      [0, BASE_TOP - 0.02], [0.18, BASE_TOP - 0.02], [0.18, BASE_TOP + 0.03], [0.13, BASE_TOP + 0.06], [0.075, BASE_TOP + 0.14],
      [0.06, top - 0.16], [0.09, top - 0.11], [0.06, top - 0.07], [0.06, top - 0.02], [0, top],
    ], { segments: 16 });
    stand.push(flat(post, WALNUT_FLAT, { position: [rest[0], 0, rest[2]] }));
    stand.push(flat(new THREE.SphereGeometry(0.19, 16, 10).scale(1.25, 0.46, 1.25).translate(rest[0], rest[1] - 0.03, rest[2]), PAD_RED));
  }
  // The mast and its padded fork under the neck.
  const FORK_Y = 4.75;
  const forkAt = onStand([0, FORK_Y, -neckDP(FORK_Y) - 0.09]);
  const mastFoot = [forkAt[0] + 0.1, 0.2, forkAt[2] - 0.2];
  stand.push(flat(bar(mastFoot, [forkAt[0], forkAt[1] - 0.2, forkAt[2]], 0.11, 0.07, 18), WALNUT_FLAT));
  stand.push(flat(latheUp([[0, 0.2], [0.27, 0.2], [0.27, 0.27], [0.2, 0.31], [0.13, 0.4], [0.115, 0.52], [0.14, 0.58], [0.115, 0.64], [0, 0.65]], { segments: 22 }), WALNUT_FLAT, { position: [mastFoot[0], 0, mastFoot[2]] }));
  stand.push(flat(new THREE.SphereGeometry(0.1, 14, 9).translate(forkAt[0], forkAt[1] - 0.2, forkAt[2]), WALNUT_FLAT));
  const forkLow = [forkAt[0], forkAt[1] - 0.2, forkAt[2]];
  for (const s of [-1, 1]) {
    const tip = onStand([s * (neckHW(FORK_Y) + 0.05), FORK_Y - 0.02, SITAR_NECK_TOP * 0.2]);
    const mid = onStand([s * (neckHW(FORK_Y) + 0.07), FORK_Y - 0.03, -neckDP(FORK_Y) * 0.8]);
    stand.push(flat(polyTube([forkLow, mid, tip], 0.04, 10), WALNUT_FLAT));
    stand.push(flat(new THREE.SphereGeometry(0.055, 12, 8).translate(...tip), PAD_RED));
  }
  stand.push(flat(new THREE.SphereGeometry(0.2, 18, 10).scale(1.55, 0.6, 0.62).applyMatrix4(pose.clone().multiply(new THREE.Matrix4().makeTranslation(0, FORK_Y, -neckDP(FORK_Y) - 0.03))), PAD_RED));

  const grain = grainTile({ depth: 22 });
  return group([
    mesh(mergeParts(plates).applyMatrix4(pose), standard({ map: sitarAtlas(pearW), roughness: 0.34, metalness: 0 })),
    mesh(mergeParts(wood).applyMatrix4(pose), standard({ vertexColors: true, map: grain, roughness: 0.3, metalness: 0 })),
    mesh(mergeParts([...bone, ...silk]).applyMatrix4(pose), standard({ vertexColors: true, roughness: 0.4, metalness: 0 })),
    mesh(mergeParts(metal).applyMatrix4(pose), standard({ vertexColors: true, roughness: 0.32, metalness: 0.5 })),
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })),
  ], 'sitar');
}

// ---------------------------------------------------------------------------
// THEATRE MASKS
// ---------------------------------------------------------------------------

// A hole straight through along Z: a distance in XY to a chain of round cones, extruded. A sphere-swept
// tool would only reach as deep as its own radius, and an opening in a shell has to go right through.
function prismP(points, radii, z0, z1) {
  const n = points.length - 1;
  let x0 = 1e9; let y0 = 1e9; let x1 = -1e9; let y1 = -1e9;
  points.forEach((p, i) => {
    x0 = Math.min(x0, p[0] - radii[i]); y0 = Math.min(y0, p[1] - radii[i]);
    x1 = Math.max(x1, p[0] + radii[i]); y1 = Math.max(y1, p[1] + radii[i]);
  });
  const mid = (z0 + z1) / 2; const hz = (z1 - z0) / 2;
  return {
    box: [x0, y0, z0, x1, y1, z1],
    f: (x, y, z) => {
      let best = 1e9;
      for (let i = 0; i < n; i++) {
        const a = points[i]; const b = points[i + 1];
        const bx = b[0] - a[0]; const by = b[1] - a[1];
        const ax = x - a[0]; const ay = y - a[1];
        const bb = bx * bx + by * by;
        const t = clamp(bb > 0 ? (ax * bx + ay * by) / bb : 0, 0, 1);
        const d = Math.hypot(ax - bx * t, ay - by * t) - lerp(radii[i], radii[i + 1], t);
        if (d < best) best = d;
      }
      return Math.max(best, Math.abs(z - mid) - hz);
    },
  };
}

function tintVerts(g, fn) {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) arr.set(fn(p.getX(i), p.getY(i), p.getZ(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// One mask, facing +z about its own centre. Everything that differs between comedy and tragedy is in
// `spec`: the shared skull is why the pair reads as one maker's two faces.
//
// The face is polygonised twice from one description. Above MASK_SEAM_Z, where every feature is, the
// grid is fine and carries only the front surface and the walls of the openings. Below it the shell's
// rim and hollow are coarse, because nothing there is ever read closely. Surface nets walks both on to
// the same true surface, so they meet; together they cost less than one grid fine enough for the face.
const MASK_SEAM_Z = 0.2;
function maskGeometry(spec, CELL, front) {
  const s = new Sculpt(CELL);
  const FACE = lin(spec.face);
  const TRIM = lin(spec.trim);
  const VOID = [0.012, 0.01, 0.012];
  const INSIDE = lin(spec.inside);

  // The mass: a broad cranium, a narrower jaw, the cheeks.
  s.add(ellipsoidP([0, 0.26, 0], [0.97, 1.06, 0.62]), FACE);
  s.add(ellipsoidP([0, -0.46, 0.05], [0.76, 0.86, 0.52]), FACE, { k: 0.26 });
  for (const m of [-1, 1]) {
    s.add(ellipsoidP([m * spec.cheek[0], spec.cheek[1], 0.42], [0.28, spec.cheek[2], 0.2]), FACE, { k: 0.2 });
  }
  const field = s.snapshot();

  // The nose: a ridge from between the brows to a rounded tip, with the wings of the nostrils.
  const noseTop = spec.noseTop;
  s.add(curveP([[0, noseTop, 0.6], [0, (noseTop - 0.14) / 2, 0.72], [0, -0.14, 0.81]], [0.075, 0.088, 0.112], 10), FACE, { k: 0.12 });
  for (const m of [-1, 1]) s.add(sphereP([m * 0.1, -0.19, 0.7], 0.07), FACE, { k: 0.09 });

  // The brows, standing off the forehead, in each mask's own expression.
  for (const m of [-1, 1]) {
    const pts = spec.brow.map(([x, y]) => [m * x, y, 0.7]);
    const path = pathOn(field, pts, 16, -0.015);
    s.add(segsP(path, path.map((_, i) => lerp(spec.browR[0], spec.browR[1], Math.sin((i / (path.length - 1)) * Math.PI)))), TRIM, { k: 0.08, ck: 0.05 });
  }
  // The rolled edge round each opening, on the face's own surface, so the hole has a lip to it.
  const lipRadii = (radii, grow) => radii.map((r) => r + grow);
  for (const m of [-1, 1]) {
    const pts = spec.eye.map(([x, y]) => [m * x, y, 0.7]);
    const path = pathOn(field, pts, 14, -0.07);
    const R = sampleCurve(spec.eye.map(([x, y]) => [m * x, y, 0]), spec.eyeR, 14).R;
    s.add(segsP(path, lipRadii(R, 0.1)), FACE, { k: 0.14 });
  }
  {
    const pts = spec.mouth.map(([x, y]) => [x, y, 0.7]);
    const path = pathOn(field, pts, 32, -0.08);
    const R = sampleCurve(spec.mouth.map(([x, y]) => [x, y, 0]), spec.mouthR, 32).R;
    s.add(segsP(path, lipRadii(R, 0.115)), TRIM, { k: 0.1, ck: 0.06 });
  }

  // Furrows and folds, cut from the face: the lines that make an expression read from the back row.
  for (const fold of spec.folds) {
    const path = pathOn(field, fold.pts.map(([x, y]) => [x, y, 0.7]), 12, 0.022);
    s.sub(segsP(path, path.map((_, i) => lerp(0.02, fold.r, Math.sin((i / (path.length - 1)) * Math.PI)))), lin(spec.fold), { k: 0.08, ck: 0.05 });
  }

  // Hollow it from behind, and open the back, leaving a shell with a rim all the way round.
  if (!front) {
    s.sub(ellipsoidP([0, -0.06, -0.2], [0.86, 1.2, 0.68]), INSIDE, { k: 0.03 });
    s.sub(boxP([0, 0, -1.2], [2, 2.2, 1.1]), INSIDE, { k: 0.05 });
  }

  // The openings, right through the shell, their walls painted out to black.
  for (const m of [-1, 1]) {
    const eyeCurve = sampleCurve(spec.eye.map(([x, y]) => [m * x, y, 0]), spec.eyeR, 14);
    s.sub(prismP(eyeCurve.P.map((p) => [p[0], p[1]]), eyeCurve.R, -0.6, 1.4), VOID, { k: 0.08, ck: 0.07 });
  }
  const mouthCurve = sampleCurve(spec.mouth.map(([x, y]) => [x, y, 0]), spec.mouthR, 32);
  s.sub(prismP(mouthCurve.P.map((p) => [p[0], p[1]]), mouthCurve.R, -0.6, 1.4), VOID, { k: 0.08, ck: 0.07 });

  const tintFn = (x, y, z, nx, ny, nz, rgb) => {
    // Colour already black, or inside the shell, keeps what it has.
    const lum = rgb[0] + rgb[1] + rgb[2];
    if (lum < 0.1) return;
    if (nz < -0.15 && z < 0.2) return;
    // A painted polish, as on the brass: a band of sky, a dark horizon, a highlight on the forms that
    // face up and to the side. It is what turns a matte toy into cast metal without any metalness.
    const up = ny * 0.8 + nz * 0.42;
    let k = 0.72;
    k += 0.62 * smooth(0.28, 0.72, up);
    k -= 0.36 * smooth(-0.1, -0.62, up);
    const w = Math.max(0, 0.42 * nx + 0.55 * ny + 0.72 * nz) ** 18;
    k += 0.9 * w;
    const pale = Math.max(0, k - 1) * spec.pale;
    rgb[0] = rgb[0] * k + pale; rgb[1] = rgb[1] * k + pale; rgb[2] = rgb[2] * k + pale;
  };
  const bounds = front ? [-1.3, -1.6, MASK_SEAM_Z, 1.3, 1.6, 1.3] : [-1.3, -1.6, -1, 1.3, 1.6, MASK_SEAM_Z + CELL * 0.5];
  // Two passes of smoothing take the teeth off where a cut crosses a grid line.
  const g = polygonize(s, { tint: tintFn, normalH: 0.6, bounds });
  if (front) return relaxMesh(g, 2, 0.45);
  // polygonize rounds its grid up to whole blocks, so at this coarse a cell the shell's grid runs well
  // past the seam. Left in, it lies across the fine face and the two z-fight in torn patches.
  const P = g.attributes.position;
  const keep = [];
  const idx = g.index;
  const limit = MASK_SEAM_Z + CELL * 0.5;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t); const b = idx.getX(t + 1); const c = idx.getX(t + 2);
    if (Math.min(P.getZ(a), P.getZ(b), P.getZ(c)) < limit) keep.push(a, b, c);
  }
  g.setIndex(keep);
  return g;
}

export const MASK_SPECS = {
  comedy: {
    face: 0xdfa534, trim: 0xcc8a28, inside: 0x3a2410, fold: 0x9c6a1c, pale: 0.42,
    cheek: [0.47, -0.06, 0.25],
    noseTop: 0.3,
    // Lifted brows, and the eyes squeezed up into arches by the smile under them.
    brow: [[0.15, 0.56], [0.42, 0.78], [0.74, 0.58]], browR: [0.03, 0.08],
    eye: [[0.19, 0.16], [0.43, 0.34], [0.68, 0.16]], eyeR: [0.028, 0.09, 0.028],
    // A wide upturned mouth, thin at its corners and open at its middle.
    mouth: [[-0.67, -0.34], [-0.46, -0.62], [0, -0.76], [0.46, -0.62], [0.67, -0.34]], mouthR: [0.03, 0.1, 0.17, 0.1, 0.03],
    // Laughter lines from the nose down to the corners of the mouth, and crow's feet at the eyes.
    folds: [
      { pts: [[-0.2, -0.16], [-0.46, -0.28], [-0.62, -0.26]], r: 0.042 }, { pts: [[0.2, -0.16], [0.46, -0.28], [0.62, -0.26]], r: 0.042 },
    ],
  },
  tragedy: {
    face: 0x2b57ad, trim: 0x8d9fbb, inside: 0x101828, fold: 0x142a60, pale: 0.26,
    cheek: [0.47, -0.3, 0.3],
    noseTop: 0.36,
    // Furrowed: the inner ends of the brows pulled up and together, the outer ends fallen.
    brow: [[0.1, 0.72], [0.38, 0.54], [0.76, 0.22]], browR: [0.035, 0.078],
    eye: [[0.2, 0.26], [0.44, 0.13], [0.68, -0.06]], eyeR: [0.028, 0.09, 0.028],
    // A down-turned open mouth, the corners dragged toward the chin.
    mouth: [[-0.52, -0.84], [-0.38, -0.6], [0, -0.48], [0.38, -0.6], [0.52, -0.84]], mouthR: [0.03, 0.1, 0.16, 0.1, 0.03],
    // Furrows over the nose, and the long creases that drag from the nose to the mouth.
    folds: [
      { pts: [[-0.2, -0.14], [-0.46, -0.3], [-0.6, -0.56]], r: 0.042 }, { pts: [[0.2, -0.14], [0.46, -0.3], [0.6, -0.56]], r: 0.042 },
    ],
  },
};

export function theatreMasks() {
  const metal = [];
  const dark = [];
  const ribbon = [];
  const stand = [];
  const MASK_Y = 3.42;
  const MASK_X = 1.03;
  const ROLL = THREE.MathUtils.degToRad(11);
  const YAW = 0.2;
  const place = (side) => new THREE.Matrix4().makeTranslation(side * MASK_X, MASK_Y, 0)
    .multiply(new THREE.Matrix4().makeRotationY(-side * YAW))
    .multiply(new THREE.Matrix4().makeRotationZ(-side * ROLL));

  // Comedy is on the viewer's left.
  for (const [spec, side] of [[MASK_SPECS.comedy, -1], [MASK_SPECS.tragedy, 1]]) {
    metal.push({ geometry: maskGeometry(spec, 0.037, true).applyMatrix4(place(side)), keepColor: true });
    metal.push({ geometry: maskGeometry(spec, 0.075, false).applyMatrix4(place(side)), keepColor: true });
  }

  // The dark inside of each mask, which is what an opening looks into. It sits in the hollow and the
  // stand's arm is fixed to its back.
  for (const side of [-1, 1]) {
    const plug = new THREE.SphereGeometry(1, 36, 24);
    plug.scale(0.82, 1.15, 0.38);
    plug.translate(0, -0.06, -0.02);
    // Black where an opening looks at it; a dark padded cloth where the back of the mount is seen.
    const cloth = side < 0 ? lin(0x3a2412) : lin(0x18233f);
    tintVerts(plug, (x, y, z) => (z > -0.02 ? [0.006, 0.005, 0.006] : cloth));
    plug.applyMatrix4(place(side));
    dark.push({ geometry: plug, keepColor: true });
  }

  // The stand: a turned base, a post, and a yoke with an arm to each mask.
  const BASE_TOP = walnutBase(stand, 1.5);
  const POST_TOP = 2.72;
  const post = latheUp([
    [0, BASE_TOP - 0.02], [0.32, BASE_TOP - 0.02], [0.32, BASE_TOP + 0.05], [0.22, BASE_TOP + 0.1], [0.13, BASE_TOP + 0.24], [0.11, BASE_TOP + 0.42],
    [0.16, BASE_TOP + 0.5], [0.11, BASE_TOP + 0.58], [0.085, 1.2], [0.08, 2.1], [0.085, POST_TOP - 0.22], [0.14, POST_TOP - 0.14], [0.085, POST_TOP - 0.06], [0.1, POST_TOP], [0, POST_TOP + 0.02],
  ], { segments: 24 });
  stand.push(flat(post, WALNUT_FLAT, { position: [0, 0, -0.5] }));
  const yoke = [0, POST_TOP - 0.02, -0.5];
  stand.push(flat(new THREE.SphereGeometry(0.13, 16, 10).translate(...yoke), WALNUT_FLAT));
  for (const side of [-1, 1]) {
    const back = v3([0, -0.1, -0.4]).applyMatrix4(place(side)).toArray();
    const under = [side * 0.6, POST_TOP + 0.3, -0.62];
    stand.push(flat(polyTube([yoke, under, back], 0.05, 12), WALNUT_FLAT));
    // A brass collar where the arm meets the mask's back.
    const collar = new THREE.SphereGeometry(0.11, 14, 9).translate(...back);
    metal.push(polished(collar, 0xc9963a));
  }

  // The ribbon, a real strip with thickness, swagged from one mask to the other and tied at each.
  const tie = (side) => v3([side * 0.72, -0.72, 0.28]).applyMatrix4(place(side)).toArray();
  const L = tie(-1);
  const R = tie(1);
  const ribbonStrip = (knots, halfW, halfT, { twist = 0, phase = 0 } = {}) => {
    const { P } = sampleCurve(knots, 1, (knots.length - 1) * 14);
    const rings = [];
    P.forEach((p, i) => {
      const a = P[Math.max(0, i - 1)]; const b = P[Math.min(P.length - 1, i + 1)];
      const T = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const f = i / (P.length - 1);
      const roll = twist * Math.sin(f * Math.PI * 2 + phase);
      // The ribbon's flat faces the viewer, then rolls a little as it falls.
      const out = new THREE.Vector3(Math.sin(roll), 0, Math.cos(roll));
      const across = new THREE.Vector3().crossVectors(out, T).normalize();
      const nrm = new THREE.Vector3().crossVectors(T, across).normalize();
      const w = halfW * (1 - 0.1 * Math.sin(f * Math.PI));
      const ring = [];
      for (let j = 0; j < 12; j++) {
        const q = (j / 12) * Math.PI * 2;
        const c = Math.sign(Math.cos(q)) * Math.abs(Math.cos(q)) ** 0.35;
        const s = Math.sign(Math.sin(q)) * Math.abs(Math.sin(q)) ** 0.5;
        ring.push([p[0] + across.x * w * c + nrm.x * halfT * s, p[1] + across.y * w * c + nrm.y * halfT * s, p[2] + across.z * w * c + nrm.z * halfT * s]);
      }
      rings.push(ring);
    });
    return loftRings(rings);
  };
  const RED = lin(0x9d1c2c);
  const redShade = (p) => {
    const k = 0.84 + 0.3 * smoothNoise3(p.x * 1.6, p.y * 1.6, 2.2);
    return [RED[0] * k, RED[1] * k, RED[2] * k];
  };
  ribbon.push(painted(ribbonStrip([L, [-0.62, 1.86, 0.5], [0, 1.66, 0.56], [0.62, 1.86, 0.5], R], 0.085, 0.012, { twist: 0.22 }), redShade));
  for (const side of [-1, 1]) {
    const o = side < 0 ? L : R;
    // Two tails falling from each knot, one long and one short.
    ribbon.push(painted(ribbonStrip([o, [o[0] + side * 0.2, o[1] - 0.5, o[2] + 0.08], [o[0] + side * 0.1, o[1] - 1.1, o[2] + 0.02], [o[0] + side * 0.3, o[1] - 1.72, o[2] + 0.08]], 0.075, 0.011, { twist: 0.5, phase: 0.4 }), redShade));
    ribbon.push(painted(ribbonStrip([o, [o[0] + side * 0.42, o[1] - 0.24, o[2] + 0.04], [o[0] + side * 0.56, o[1] - 0.7, o[2] + 0.02], [o[0] + side * 0.46, o[1] - 1.05, o[2] + 0.08]], 0.07, 0.011, { twist: 0.5, phase: 1.4 }), redShade));
    // The knot itself.
    ribbon.push(painted(new THREE.SphereGeometry(0.085, 16, 10).scale(1.1, 0.86, 0.72).translate(o[0], o[1], o[2] + 0.02), redShade));
    // Bow loops.
    for (const m of [-1, 1]) {
      const loop = new THREE.TorusGeometry(0.1, 0.03, 8, 18);
      loop.scale(1.35, 0.72, 0.6);
      loop.translate(o[0] + m * 0.16, o[1] + 0.02, o[2] + 0.02);
      ribbon.push(painted(loop, redShade));
    }
  }

  return group([
    mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.36, metalness: 0.22 })),
    mesh(mergeParts(dark), standard({ vertexColors: true, roughness: 0.9, metalness: 0 })),
    mesh(mergeParts(ribbon), standard({ vertexColors: true, roughness: 0.55, metalness: 0 })),
    mesh(mergeParts(stand), standard({ vertexColors: true, roughness: 0.46, metalness: 0 })),
  ], 'theatre-masks');
}

// ---------------------------------------------------------------------------
// SHAKESPEARE'S GLOBE
// ---------------------------------------------------------------------------

// About 1/5 of life. A true twenty-sided polygon: every bay is the same description turned through
// 18 degrees, the gate is the middle of the +Z bay, and the stage backs on to the -Z side.
export const GLOBE_SIDES = 20;
const GLOBE_R_OUT = 10; // to a vertex, feet
const GLOBE_R_IN = 7.55;
const GLOBE_PLINTH = 0.32;
const GLOBE_FLOORS = [0.32, 2.85, 4.85, 6.55]; // ground, first gallery, second gallery, wall plate
const GLOBE_JETTY = [0, 0.14, 0.26];
const STAGE_BACK_Z = -5.5;
const STAGE_FRONT_Z = -0.75;
const STAGE_HALF = 4.3;
const STAGE_TOP = 1.02;

const gAngle = (i) => ((i - 0.5) / GLOBE_SIDES) * Math.PI * 2; // measured from +Z, bay 0 straddling +Z
const gPoint = (r, i, y) => [Math.sin(gAngle(i)) * r, y, Math.cos(gAngle(i)) * r];
const gLerp = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// A bay is behind the tiring house if its middle lies behind the plane of the stage's back wall.
const bayBehindStage = (i) => Math.cos(gAngle(i) + Math.PI / GLOBE_SIDES) * GLOBE_R_IN < STAGE_BACK_Z + 0.9;

// A flat-faced polygonal lathe: each bay has its own vertices, so the twenty facets stay crisp.
// `profile` is [r, y], closed or open, with the solid on the left; written round the +Y axis.
function polyRing(profile, { closed = false, uv = null, from = 0, to = GLOBE_SIDES } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const rows = closed ? [...profile, profile[0]] : profile;
  for (let i = from; i < to; i++) {
    const base = positions.length / 3;
    for (let r = 0; r < rows.length; r++) {
      const [rad, y] = rows[r];
      const a = gPoint(rad, i, y); const b = gPoint(rad, i + 1, y);
      positions.push(...a, ...b);
      const u = uv ? uv(r, 0, rad, y, i) : [0, r];
      const w = uv ? uv(r, 1, rad, y, i) : [1, r];
      uvs.push(...u, ...w);
    }
    for (let r = 0; r < rows.length - 1; r++) {
      const p = base + r * 2;
      indices.push(p, p + 1, p + 3, p, p + 3, p + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return orientOut(g);
}

// A plain squared timber: twelve triangles and crisp edges. There are about two thousand of them here.
function plank(a, b, w, d, side) {
  const A = v3(a);
  const axis = v3(b).sub(A);
  const len = axis.length();
  axis.normalize();
  const x = v3(side).addScaledVector(axis, -v3(side).dot(axis)).normalize();
  const y = new THREE.Vector3().crossVectors(axis, x).normalize();
  const g = new THREE.BoxGeometry(w, d, len).translate(0, 0, len / 2);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, axis).setPosition(A));
  return g;
}

function globeThatchTexture() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(1599);
    ctx.fillStyle = '#e9dcb8';
    ctx.fillRect(0, 0, w, h);
    // Reed thatch: thousands of short strokes running down the slope, laid in overlapping courses,
    // each darker at its bottom edge where the next course shades it. Wrapped so that it tiles.
    for (let c = 0; c < 9; c++) {
      const y0 = (c / 9) * h;
      const bandH = h / 9;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + bandH);
      g.addColorStop(0, 'rgba(90,66,30,0.3)');
      g.addColorStop(0.3, 'rgba(70,50,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, w, bandH);
    }
    for (let i = 0; i < 9000; i++) {
      const x = rng() * w; const y = rng() * h;
      const len = 16 + rng() * 34;
      const t = rng();
      ctx.strokeStyle = t > 0.55 ? `rgba(250,238,204,${0.18 + rng() * 0.3})` : t > 0.2 ? `rgba(168,140,92,${0.16 + rng() * 0.24})` : `rgba(96,74,44,${0.12 + rng() * 0.22})`;
      ctx.lineWidth = 0.7 + rng() * 1.1;
      for (const oy of [0, -h]) {
        ctx.beginPath();
        ctx.moveTo(x, y + oy);
        ctx.lineTo(x + (rng() - 0.5) * 6, y + oy + len);
        ctx.stroke();
      }
    }
  });
}

// The stage's painted surfaces, on one canvas: the heavens on the left half, the tiring-house front on
// the right. Painted wood and faux marble are what the real ones were, and they are the one place in
// this building with strong colour.
function globePaintedTexture() {
  return canvasTexture(1024, 1024, (ctx, w, h) => {
    const rng = seededRandom(1613);
    // --- the heavens: x 0..512, a night-blue ceiling, gilt sun, moon and stars, framed in coffers ---
    const sky = ctx.createRadialGradient(256, h / 2, 40, 256, h / 2, 420);
    sky.addColorStop(0, '#2b5aa8');
    sky.addColorStop(1, '#0f2358');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 512, h);
    const GILT = '#e6bd55';
    const star = (x, y, r, n = 8) => {
      ctx.fillStyle = GILT;
      ctx.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const q = i % 2 ? r * 0.38 : r;
        if (i) ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
        else ctx.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
      }
      ctx.closePath(); ctx.fill();
    };
    for (let i = 0; i < 240; i++) star(14 + rng() * 484, 14 + rng() * (h - 28), 2.5 + rng() * 7, rng() > 0.5 ? 4 : 6);
    // The sun.
    star(256, 330, 92, 16);
    ctx.fillStyle = '#f2d06c';
    ctx.beginPath(); ctx.arc(256, 330, 50, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#a97f27'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(256, 330, 50, 0, Math.PI * 2); ctx.stroke();
    // The moon.
    ctx.fillStyle = '#e9e7da';
    ctx.beginPath(); ctx.arc(256, 700, 54, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#16306f';
    ctx.beginPath(); ctx.arc(278, 688, 46, 0, Math.PI * 2); ctx.fill();
    // Zodiac ring, drawn as twelve plain gilt roundels: a canvas draws zodiac glyphs as colour emoji.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = 256 + Math.cos(a) * 200; const y = h / 2 + Math.sin(a) * 420;
      ctx.strokeStyle = GILT; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.stroke();
      star(x, y, 9, 6);
    }
    ctx.strokeStyle = GILT; ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 496, h - 16);
    ctx.lineWidth = 2;
    ctx.strokeRect(22, 22, 468, h - 44);

    // --- the tiring-house front: x 512..1024, painted panels in faux marble ---------------------
    const X0 = 512;
    ctx.fillStyle = '#7c2f26';
    ctx.fillRect(X0, 0, 512, h);
    // Marbled veining, the painted-stone effect the real playhouses were admired for.
    for (let i = 0; i < 260; i++) {
      ctx.strokeStyle = rng() > 0.5 ? `rgba(226,186,150,${0.08 + rng() * 0.16})` : `rgba(40,12,10,${0.1 + rng() * 0.2})`;
      ctx.lineWidth = 0.8 + rng() * 2.4;
      let x = X0 + rng() * 512; let y = rng() * h;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (rng() - 0.3) * 44; y += (rng() - 0.5) * 44; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // Sunken panels, each bordered in gilt.
    const COLS = 8;
    const ROWS = 12;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const pw = 512 / COLS; const ph = h / ROWS;
        const x = X0 + c * pw + 6; const y = r * ph + 6;
        ctx.strokeStyle = 'rgba(232,194,96,0.9)'; ctx.lineWidth = 2.4;
        ctx.strokeRect(x, y, pw - 12, ph - 12);
        ctx.strokeStyle = 'rgba(20,6,4,0.55)'; ctx.lineWidth = 3;
        ctx.strokeRect(x + 3, y + 3, pw - 18, ph - 18);
      }
    }
    // The name board over the gate, in the top strip of this half.
    ctx.fillStyle = '#5a1f16';
    ctx.fillRect(X0, 0, 512, 60);
    ctx.strokeStyle = '#e6bd55'; ctx.lineWidth = 3;
    ctx.strokeRect(X0 + 5, 4, 502, 51);
    let size = 44;
    ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
    const text = 'THE GLOBE';
    const width = ctx.measureText(text).width;
    if (width > 460) { size = Math.floor((size * 460) / width); ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`; }
    ctx.fillStyle = '#efd27a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, X0 + 256, 31);
  });
}

export function globeTheatre() {
  const plaster = [];
  const oak = [];
  const thatch = [];
  const painted2 = [];
  const stuff = [];
  const cloth = [];

  const OAK = 0x3a2616;
  const OAK2 = 0x4a3220;
  const PLASTER = 0xe0d4b6;

  // A square-section timber between two points, with a bevel small enough to cost almost nothing.
  const timber = (a, b, w, d, colour = OAK, up = null) => {
    const dir = v3(b).sub(v3(a));
    const side = up ?? (Math.abs(dir.y) > 0.9 * dir.length() ? [Math.cos(0), 0, 0] : [0, 1, 0]);
    oak.push(flat(plank(a, b, w, d, side), colour));
  };
  // The timber's width runs along a bay when it is upright: that way a post sits flat on its wall.
  const alongBay = (i) => {
    const a = gPoint(1, i, 0); const b = gPoint(1, i + 1, 0);
    return [b[0] - a[0], 0, b[2] - a[2]];
  };
  const inward = (i) => {
    const q = gAngle(i) + Math.PI / GLOBE_SIDES;
    return [-Math.sin(q), 0, -Math.cos(q)];
  };
  const proud = (p, i, by) => { const n = inward(i); return [p[0] - n[0] * by, p[1], p[2] - n[2] * by]; };

  // --- plinth, outer wall, inner wall lining ------------------------------------------------
  // The wall is one ring of 20 flat plates, all but the gate bay. The gate bay is two piers and a header.
  const R = GLOBE_R_OUT;
  const WALL = 0.28;
  const wallProfile = [[R - WALL, GLOBE_PLINTH], [R, GLOBE_PLINTH], [R, GLOBE_FLOORS[3]], [R - WALL, GLOBE_FLOORS[3]]];
  const plasterTint = (p) => {
    const n = smoothNoise3(p.x * 0.9, p.y * 1.3, p.z * 0.9);
    const k = 0.92 + 0.16 * n - 0.1 * smooth(1.4, 0.3, p.y);
    const c = lin(PLASTER);
    return [c[0] * k, c[1] * k, c[2] * k * 0.98];
  };
  plaster.push(painted(polyRing(wallProfile, { closed: true, from: 1, to: GLOBE_SIDES }), plasterTint));
  // Stone sill the whole way round, gate included.
  const STONE = 0x8f8778;
  stuff.push(flat(polyRing([[R + 0.05, 0], [R + 0.06, GLOBE_PLINTH - 0.04], [R + 0.02, GLOBE_PLINTH], [R - WALL, GLOBE_PLINTH], [R - WALL, 0]], { closed: true, from: 1, to: GLOBE_SIDES }), STONE));

  // The gate bay, at +Z. Its opening is built, not cut.
  const gateA = gPoint(R, 0, 0); const gateB = gPoint(R, 1, 0);
  const gateMid = gLerp(gateA, gateB, 0.5);
  const GATE_HALF = 0.62;
  const GATE_H = 1.95;
  const gateL = (Math.hypot(gateB[0] - gateA[0], gateB[2] - gateA[2])) / 2;
  const gateFrame = (y0, y1, h0, h1) => {
    const g = new THREE.BoxGeometry(Math.abs(h1 - h0), y1 - y0, WALL);
    g.translate((h0 + h1) / 2, (y0 + y1) / 2, gateMid[2] - WALL / 2);
    return g;
  };
  // The bay's chord is parallel to x, so this is simply three boxes.
  plaster.push(painted(gateFrame(GLOBE_PLINTH, GLOBE_FLOORS[3], -gateL, -GATE_HALF), plasterTint));
  plaster.push(painted(gateFrame(GLOBE_PLINTH, GLOBE_FLOORS[3], GATE_HALF, gateL), plasterTint));
  plaster.push(painted(gateFrame(GATE_H, GLOBE_FLOORS[3], -GATE_HALF, GATE_HALF), plasterTint));
  // Oak door case, doors standing open, and a pent roof over them.
  const gz = gateMid[2];
  for (const s of [-1, 1]) {
    timber([s * (GATE_HALF + 0.06), 0, gz + 0.03], [s * (GATE_HALF + 0.06), GATE_H, gz + 0.03], 0.14, 0.14, OAK);
    // A leaf folded back against the passage wall, with ledges and studs.
    const leaf = new THREE.BoxGeometry(0.05, GATE_H - 0.34, GATE_HALF * 0.96);
    leaf.translate(s * (GATE_HALF + 0.05), (GATE_H + 0.24) / 2 - 0.02, gz - WALL - GATE_HALF * 0.48);
    oak.push(flat(leaf, OAK2));
    for (const y of [0.5, 1.15, 1.7]) timber([s * (GATE_HALF + 0.02), y, gz - WALL], [s * (GATE_HALF + 0.02), y, gz - WALL - GATE_HALF * 0.96], 0.04, 0.09, OAK, [1, 0, 0]);
  }
  timber([-(GATE_HALF + 0.14), GATE_H, gz + 0.03], [GATE_HALF + 0.14, GATE_H, gz + 0.03], 0.16, 0.14, OAK);
  // The gate bay's own studs, either side of the door case, so that its lowest storey is framed too.
  for (const s of [-1, 1]) {
    for (const x of [GATE_HALF + 0.42, GATE_HALF + 0.78]) timber([s * x, GLOBE_PLINTH, gz + 0.02], [s * x, GLOBE_FLOORS[1], gz + 0.02], 0.08, 0.055, OAK2, [1, 0, 0]);
  }
  timber([-GATE_HALF - 0.14, GATE_H + 0.32, gz + 0.02], [-gateL, GATE_H + 0.32, gz + 0.02], 0.085, 0.06, OAK2, [0, 1, 0]);
  timber([GATE_HALF + 0.14, GATE_H + 0.32, gz + 0.02], [gateL, GATE_H + 0.32, gz + 0.02], 0.085, 0.06, OAK2, [0, 1, 0]);
  // Stone threshold.
  stuff.push(flat(new THREE.BoxGeometry(GATE_HALF * 2 + 0.3, GLOBE_PLINTH * 0.55, WALL + 0.14).translate(0, GLOBE_PLINTH * 0.275, gz - WALL / 2 + 0.04), STONE));
  // A pent over the gate, its slope falling outward like everything else here.
  const pentY0 = GATE_H + 0.36; const pentY1 = GATE_H + 0.8; const pentOut = 0.72;
  {
    const hw = GATE_HALF + 0.38;
    const verts = [
      [-hw, pentY0, gz + pentOut], [hw, pentY0, gz + pentOut], [hw, pentY1, gz], [-hw, pentY1, gz],
    ];
    const thick = 0.07;
    const rings = [
      [verts[0], verts[1], verts[2], verts[3]],
      verts.map((p) => [p[0], p[1] - thick, p[2]]),
    ];
    const g = loftRings(rings);
    uvPlanar(g, (x, y, z) => [x * 0.42, (pentY1 - y) * 1.1 + z * 0.3]);
    thatch.push({ geometry: g, color: 0xb9a26c });
    for (const s of [-1, 1]) {
      timber([s * hw * 0.92, pentY0 - 0.02, gz + pentOut * 0.92], [s * hw * 0.92, GATE_H + 0.05, gz + 0.04], 0.06, 0.06, OAK, [1, 0, 0]);
    }
  }
  // A painted sign over the gate.
  {
    const sign = plateSolid(roundedOutline(0.72, 0.13, 0.02, 2), [], [[0, -0.02], [0, 0.03]], { crease: 40 });
    sign.translate(0, GATE_H + 0.17, gz + 0.09);
    uvPlanar(sign, (x, y) => [lerp(0.5, 1, (x + 0.72) / 1.44), lerp(0.942, 1, (y - GATE_H - 0.04) / 0.26)]);
    painted2.push({ geometry: sign, color: 0xffffff });
  }

  // --- half-timbering on the outer face, one description of a bay, 20 times -------------------
  const STUD = 0.1;
  for (let i = 0; i < GLOBE_SIDES; i++) {
    const side = alongBay(i);
    const out = (t, y, by = 0.02) => proud(gLerp(gPoint(R, i, y), gPoint(R, i + 1, y), t), i, by);
    // Corner post, floor to plate. The first of each bay is the shared one.
    timber(proud(gPoint(R, i, GLOBE_PLINTH), i, 0.01), proud(gPoint(R, i, GLOBE_FLOORS[3]), i, 0.01), 0.17, 0.08, OAK, side);
    // Three storeys of rails.
    for (const y of GLOBE_FLOORS) {
      timber(out(0, y), out(1, y), 0.14, 0.08, OAK, [0, 1, 0]);
    }
    const isGate = i === 0;
    for (let f = 0; f < 3; f++) {
      const y0 = GLOBE_FLOORS[f]; const y1 = GLOBE_FLOORS[f + 1];
      const yMid = lerp(y0, y1, 0.55);
      if (isGate && f === 0) continue;
      // Mid rail.
      timber(out(0, yMid), out(1, yMid), 0.085, 0.06, OAK2, [0, 1, 0]);
      // Close studding below it, wider above: the English pattern.
      const nLow = 5;
      for (let k = 1; k < nLow; k++) {
        const t = k / nLow;
        timber(out(t, y0), out(t, yMid), STUD * 0.8, 0.055, OAK2, side);
      }
      // A window in the middle panel of the upper half, if this storey has one; braces otherwise.
      const hasWindow = i % 4 === 2 && f > 0;
      if (hasWindow) {
        const w0 = 0.34; const w1 = 0.66;
        const yA = yMid + 0.1; const yB = y1 - 0.14;
        // A dark panel a hair proud of the wall, a frame proud of that: the rule for a window on a solid wall.
        const ww = (w1 - w0) * Math.hypot(side[0], side[2]) * R;
        const glass = plank(proud(gLerp(gPoint(R, i, yA), gPoint(R, i + 1, yA), 0.5), i, 0.012), proud(gLerp(gPoint(R, i, yB), gPoint(R, i + 1, yB), 0.5), i, 0.012), ww, 0.02, side);
        stuff.push(flat(glass, 0x1d2730));
        for (const t of [w0, 0.5, w1]) timber(out(t, yA, 0.03), out(t, yB, 0.03), t === 0.5 ? 0.035 : 0.06, 0.05, OAK, side);
        timber(out(w0, yA, 0.03), out(w1, yA, 0.03), 0.06, 0.05, OAK, [0, 1, 0]);
        timber(out(w0, yB, 0.03), out(w1, yB, 0.03), 0.06, 0.05, OAK, [0, 1, 0]);
      } else {
        for (const [a, b] of [[0, 0.5], [1, 0.5]]) timber(out(a, yMid), out(b, y1), 0.085, 0.055, OAK2, side);
        timber(out(0.5, yMid), out(0.5, y1), 0.09, 0.055, OAK2, side);
      }
    }
  }

  // --- gallery floors, ceilings and posts on the inside ---------------------------------------
  const ringAt = (y, jet) => GLOBE_R_IN - jet;
  // The floors and the undersides between them, as rings of plank.
  const FLOOR_T = 0.12;
  for (let f = 0; f < 3; f++) {
    const rIn = ringAt(0, GLOBE_JETTY[f]);
    const y = GLOBE_FLOORS[f];
    const g = polyRing([[R - WALL + 0.01, y - FLOOR_T], [R - WALL + 0.01, y], [rIn, y], [rIn, y - FLOOR_T]], { closed: true });
    oak.push(painted(g, (p) => {
      const n = smoothNoise3(p.x * 3, 1.2, p.z * 3);
      const k = 0.85 + 0.3 * n;
      const c = lin(p.y > y - 0.02 ? 0x7c5a36 : 0x4a3220);
      return [c[0] * k, c[1] * k, c[2] * k];
    }));
  }
  // The ceiling under the top of the wall, and the rails, posts and benches of each bay.
  const BENCH = 0x6f4e2c;
  for (let i = 0; i < GLOBE_SIDES; i++) {
    const behind = bayBehindStage(i);
    const side = alongBay(i);
    const inP = (t, y, r) => gLerp(gPoint(r, i, y), gPoint(r, i + 1, y), t);
    for (let f = 0; f < 3; f++) {
      const rPost = ringAt(0, GLOBE_JETTY[f]) + 0.05;
      const y0 = GLOBE_FLOORS[f]; const y1 = GLOBE_FLOORS[f + 1] - FLOOR_T;
      if (!behind) {
        // A post at each vertex.
        timber(gPoint(rPost, i, y0), gPoint(rPost, i, y1), 0.15, 0.15, OAK, side);
        // A rail at the top of the post, one at the balustrade, and turned balusters between them.
        timber(inP(0, y1 - 0.04, rPost), inP(1, y1 - 0.04, rPost), 0.1, 0.08, OAK, [0, 1, 0]);
        const skipRail = i === 0 && f === 0;
        const railH = f === 0 ? 0.52 : 0.62;
        if (!skipRail) {
          timber(inP(0, y0 + railH, rPost), inP(1, y0 + railH, rPost), 0.06, 0.06, OAK2, [0, 1, 0]);
          for (let k = 1; k < 7; k++) {
            const t = k / 7;
            const a = inP(t, y0, rPost); const b = inP(t, y0 + railH, rPost);
            oak.push(flat(plank(a, b, 0.04, 0.04, side), OAK2));
          }
        }
        // Benches rise in three rows toward the wall, which is what degree seating is.
        if (!skipRail) {
          for (let b = 0; b < 3; b++) {
            const r = lerp(rPost + 0.5, R - WALL - 0.4, b / 2);
            const h = 0.16 + b * 0.2;
            const a0 = inP(0.06, y0 + h, r); const a1 = inP(0.94, y0 + h, r);
            const n = inward(i);
            oak.push(flat(plank(a0, a1, 0.26, 0.05, n), BENCH));
            // Risers to the floor.
            for (const t of [0.12, 0.88]) {
              const top = inP(t, y0 + h - 0.02, r);
              const low = inP(t, y0, r);
              oak.push(flat(plank(low, top, 0.24, 0.05, n), OAK2));
            }
          }
        }
      }
    }
  }
  // The yard: open to the sky, covered in hazelnut shell and trodden earth.
  {
    const outline = [];
    for (let i = 0; i < GLOBE_SIDES; i++) { const p = gPoint(R - 0.1, i, 0); outline.push([p[0], p[2]]); }
    const floor = planSolid(outline, [], [[0, 0.0], [0, 0.1]], { crease: 10 });
    stuff.push(painted(floor, (p) => {
      const n = smoothNoise3(p.x * 0.8, 3.3, p.z * 0.8);
      const k = 0.86 + 0.28 * n;
      const c = lin(0x8f7a59);
      return [c[0] * k, c[1] * k, c[2] * k];
    }));
  }

  // --- thatch: a ring ridge, and both slopes falling away from it -------------------------------
  // The ridge sits over the gallery's middle. Outside it the slope falls out past the wall, inside it
  // falls to the yard's edge. The opening above the yard is what makes it an open-air playhouse.
  const RIDGE_R = 8.75;
  const RIDGE_Y = 8.5;
  const EAVE_OUT_R = R + 0.5;
  const EAVE_OUT_Y = GLOBE_FLOORS[3] - 0.08;
  const EAVE_IN_R = GLOBE_R_IN - 0.75;
  const EAVE_IN_Y = GLOBE_FLOORS[3] + 0.1;
  const TH = 0.2;
  const roofProfile = [
    [EAVE_IN_R, EAVE_IN_Y - TH * 0.8], [EAVE_IN_R - 0.06, EAVE_IN_Y], [RIDGE_R - 0.25, RIDGE_Y - 0.05], [RIDGE_R, RIDGE_Y + 0.03], [RIDGE_R + 0.25, RIDGE_Y - 0.05],
    [EAVE_OUT_R + 0.06, EAVE_OUT_Y], [EAVE_OUT_R, EAVE_OUT_Y - TH * 0.8], [RIDGE_R, RIDGE_Y - TH * 1.2],
  ];
  // Subdivided so that weathering has rows to land on.
  const roofRows = [];
  for (let k = 0; k < roofProfile.length; k++) {
    const a = roofProfile[k]; const b = roofProfile[(k + 1) % roofProfile.length];
    const n = (k === 1 || k === 4) ? 8 : 1;
    for (let j = 0; j < n; j++) roofRows.push([lerp(a[0], b[0], j / n), lerp(a[1], b[1], j / n)]);
  }
  const roof = polyRing(roofRows, {
    closed: true,
    uv: (row, col, rad, y, bay) => {
      // v runs down the slope in feet, u along the bay, whole numbers of tiles per bay so it tiles.
      const slope = rad > RIDGE_R ? (RIDGE_Y - y) * 0.55 + (rad - RIDGE_R) * 0.55 : (RIDGE_Y - y) * 0.55 + (RIDGE_R - rad) * 0.55;
      return [bay + col, slope];
    },
  });
  const THATCH = lin(0xd6b671);
  thatch.push(painted(roof, (p) => {
    const n = smoothNoise3(p.x * 0.5, p.y * 0.6, p.z * 0.5);
    // Grey and mossy at the eaves and in the weather, palest at the top.
    const eave = smooth(RIDGE_Y - 0.4, EAVE_OUT_Y, p.y);
    const k = 0.98 + 0.3 * n - 0.28 * eave;
    return [THATCH[0] * k, THATCH[1] * k, THATCH[2] * k * 0.96];
  }));
  // A wattled ridge roll, the thatcher's finish along the top.
  oak.push(painted(polyRing([[RIDGE_R - 0.13, RIDGE_Y - 0.02], [RIDGE_R - 0.08, RIDGE_Y + 0.09], [RIDGE_R + 0.08, RIDGE_Y + 0.09], [RIDGE_R + 0.13, RIDGE_Y - 0.02]], { closed: true }), () => lin(0x8c7648)));
  // Rafters under the inner eave, visible from the yard: the one view a groundling has of the roof.
  for (let i = 0; i < GLOBE_SIDES; i++) {
    const a = gPoint(ringAt(0, GLOBE_JETTY[2]) + 0.05, i, GLOBE_FLOORS[3] - 0.12);
    const b = gPoint(EAVE_IN_R + 0.04, i, EAVE_IN_Y - TH * 0.8);
    if (!bayBehindStage(i)) timber(a, [b[0], b[1], b[2]], 0.06, 0.07, OAK, [0, 1, 0]);
    timber(gPoint(GLOBE_R_IN + 0.18, i, GLOBE_FLOORS[3] - 0.02), gPoint(GLOBE_R_IN + 0.18, i + 1, GLOBE_FLOORS[3] - 0.02), 0.13, 0.13, OAK, [0, 1, 0]);
  }
  // The ceiling of the top gallery.
  oak.push(painted(polyRing([[R - WALL + 0.01, GLOBE_FLOORS[3] - 0.02], [R - WALL + 0.01, GLOBE_FLOORS[3] + 0.04], [GLOBE_R_IN + 0.1, GLOBE_FLOORS[3] + 0.04], [GLOBE_R_IN + 0.1, GLOBE_FLOORS[3] - 0.02]], { closed: true }), () => lin(0x3f2b1a)));

  // --- the stage -----------------------------------------------------------------------------
  // A rectangular platform thrust into the yard, on oak trestles, its front and sides hung with cloth.
  const ST_W = STAGE_HALF;
  const stageTop = new THREE.BoxGeometry(ST_W * 2, 0.08, STAGE_BACK_Z * -1 + STAGE_FRONT_Z * 1);
  stageTop.translate(0, STAGE_TOP - 0.04, (STAGE_BACK_Z + STAGE_FRONT_Z) / 2);
  oak.push(painted(stageTop, (p) => {
    // Planks running across the stage, by colour.
    const k = 0.84 + 0.2 * smoothNoise3(p.x * 0.5, 0.2, p.z * 2.2);
    const c = lin(0x8e693e);
    return [c[0] * k, c[1] * k, c[2] * k];
  }));
  // Plank lines on the stage: a run of thin dark bars just proud of it.
  for (let k = 1; k < 16; k++) {
    const z = lerp(STAGE_BACK_Z, STAGE_FRONT_Z, k / 16);
    oak.push(flat(new THREE.BoxGeometry(ST_W * 2 - 0.02, 0.003, 0.012).translate(0, STAGE_TOP + 0.0005, z), 0x3a2616));
  }
  // The stage's skirt of dark painted boards.
  const SKIRT = 0x3f1f1a;
  const panelsAt = (x0, z0, x1, z1, count) => {
    const a = [x0, 0.1, z0]; const b = [x1, 0.1, z1];
    const dx = x1 - x0; const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const g = new THREE.BoxGeometry(len, STAGE_TOP - 0.1 - 0.08, 0.05);
    const rot = new THREE.Matrix4().makeRotationY(Math.atan2(-dz, dx));
    g.applyMatrix4(rot);
    g.translate((x0 + x1) / 2, (STAGE_TOP - 0.08 + 0.1) / 2, (z0 + z1) / 2);
    oak.push(flat(g, SKIRT));
    for (let k = 0; k <= count; k++) {
      const t = k / count;
      const p = [lerp(a[0], b[0], t), 0.1, lerp(a[2], b[2], t)];
      const nx = -dz / len; const nz = dx / len;
      timber([p[0] + nx * 0.03, 0.1, p[2] + nz * 0.03], [p[0] + nx * 0.03, STAGE_TOP - 0.08, p[2] + nz * 0.03], 0.06, 0.04, 0xb99a54, [dx, 0, dz]);
    }
  };
  panelsAt(-ST_W, STAGE_FRONT_Z, ST_W, STAGE_FRONT_Z, 12);
  panelsAt(ST_W, STAGE_BACK_Z, ST_W, STAGE_FRONT_Z, 7);
  panelsAt(-ST_W, STAGE_FRONT_Z, -ST_W, STAGE_BACK_Z, 7);
  // The trap, a square of darker boards with a ring, centre stage.
  oak.push(flat(new THREE.BoxGeometry(1.2, 0.006, 1.2).translate(0, STAGE_TOP + 0.002, -2.8), 0x3f2a18));
  stuff.push(flat(new THREE.TorusGeometry(0.06, 0.012, 6, 14).rotateX(Math.PI / 2).translate(0, STAGE_TOP + 0.01, -2.3), 0x6a6a68));

  // --- the tiring house: three storeys of painted front, doors, balcony ----------------------
  const TH_W = Math.sqrt(GLOBE_R_IN ** 2 - STAGE_BACK_Z ** 2) + 0.35;
  const TH_TOP = GLOBE_FLOORS[3] + 0.5;
  const paintedUv = (g, u0, u1, v0, v1, getU, getV) => uvPlanar(g, (x, y, z) => [lerp(u0, u1, getU(x, y, z)), lerp(v0, v1, getV(x, y, z))]);
  // The tiring-house front is an ordinary plate with its three doorways really open in it.
  const DOOR = [[-2.6, 0.66, 1.75], [0, 1.0, 2.0], [2.6, 0.66, 1.75]]; // x, half width, height above stage
  const frontOutline = [[-TH_W, 0], [TH_W, 0], [TH_W, TH_TOP], [-TH_W, TH_TOP]];
  const doorHoles = DOOR.map(([x, hw, h]) => {
    const top = STAGE_TOP + h;
    const pts = [[x + hw, STAGE_TOP], [x + hw, top - hw * 0.6]];
    for (let k = 1; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      pts.push([x + Math.cos(a) * hw, top - hw * 0.6 + Math.sin(a) * hw * 0.6]);
    }
    pts.push([x - hw, top - hw * 0.6], [x - hw, STAGE_TOP]);
    return pts;
  });
  const front = plateSolid(frontOutline, doorHoles, [[0, -0.12], [0, 0]], { crease: 30 });
  front.translate(0, 0, STAGE_BACK_Z);
  paintedUv(front, 0.5, 1, 0, 0.93, (x) => (x + TH_W) / (TH_W * 2), (x, y) => y / TH_TOP);
  painted2.push({ geometry: front, color: 0xffffff });
  // Inside each doorway, a dark passage with a real far wall.
  for (const [x, hw, h] of DOOR) {
    const depth = 0.7;
    const back = new THREE.BoxGeometry(hw * 2 + 0.3, h + 0.2, 0.05).translate(x, STAGE_TOP + h / 2, STAGE_BACK_Z - depth);
    stuff.push(flat(back, 0x0f0b08));
    for (const s of [-1, 1]) stuff.push(flat(new THREE.BoxGeometry(0.05, h + 0.2, depth).translate(x + s * (hw + 0.14), STAGE_TOP + h / 2, STAGE_BACK_Z - depth / 2), 0x16100b));
    stuff.push(flat(new THREE.BoxGeometry(hw * 2 + 0.3, 0.05, depth).translate(x, STAGE_TOP + h + 0.1, STAGE_BACK_Z - depth / 2), 0x16100b));
    // A gilt door case round each.
    const hole = doorHoles[DOOR.findIndex((d) => d[0] === x)];
    const caseG = plateSolid(offsetLoop(hole, -0.09), [hole], [[0, -0.02], [0, 0.04], [0.008, 0.05]], { crease: 40 });
    caseG.translate(0, 0, STAGE_BACK_Z);
    stuff.push(flat(caseG, 0xc79a3e));
  }
  // The central opening hung with an arras.
  {
    const [x, hw, h] = DOOR[1];
    const arras = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      arras.push([lerp(x - hw, x + hw, t), 0, STAGE_BACK_Z - 0.22 + 0.04 * Math.sin(t * Math.PI * 9)]);
    }
    const rings = [0, 0.5, 1].map((f) => arras.map((p) => [p[0], STAGE_TOP + f * (h - hw * 0.25), p[2]]));
    const back = [0, 0.5, 1].map((f) => [...arras].reverse().map((p) => [p[0], STAGE_TOP + f * (h - hw * 0.25), p[2] - 0.03]));
    const closed = rings.map((r, i) => [...r, ...back[i]]);
    const g = loftRings(closed);
    cloth.push(painted(g, (p) => {
      const c = lin(0x7b1e24);
      const fold = 0.72 + 0.34 * Math.sin((p.x - x) * 30);
      return [c[0] * fold, c[1] * fold, c[2] * fold];
    }));
  }
  // The balcony at the first gallery, running the width of the front, with its balusters, and the two
  // pilasters and a frieze that make the front read as an architecture rather than a wall.
  const BAL_Y = GLOBE_FLOORS[1] + 0.32;
  const BAL_OUT = 0.5;
  oak.push(flat(new THREE.BoxGeometry(TH_W * 2 - 0.3, 0.1, BAL_OUT).translate(0, BAL_Y - 0.05, STAGE_BACK_Z + BAL_OUT / 2), OAK2));
  timber([-(TH_W - 0.2), BAL_Y + 0.5, STAGE_BACK_Z + BAL_OUT - 0.04], [TH_W - 0.2, BAL_Y + 0.5, STAGE_BACK_Z + BAL_OUT - 0.04], 0.07, 0.07, 0xb7923f, [0, 1, 0]);
  for (let k = 0; k <= 34; k++) {
    const x = lerp(-(TH_W - 0.2), TH_W - 0.2, k / 34);
    stuff.push(flat(latheUp([[0, 0], [0.03, 0], [0.018, 0.1], [0.036, 0.24], [0.018, 0.42], [0.03, 0.5], [0, 0.5]], { segments: 6 }), 0xb7923f, { position: [x, BAL_Y, STAGE_BACK_Z + BAL_OUT - 0.04] }));
  }
  // Friezes across the front at each floor.
  for (const y of [GLOBE_FLOORS[1] + 0.3, GLOBE_FLOORS[2], GLOBE_FLOORS[3]]) {
    stuff.push(flat(beam([-TH_W, y, STAGE_BACK_Z + 0.04], [TH_W, y, STAGE_BACK_Z + 0.04], 0.12, 0.08, { side: [0, 1, 0], r: 0.01 }), 0xb99a54));
  }
  // Upper windows, two storeys of them, dark panels in gilt frames.
  for (const [y0, y1] of [[BAL_Y + 0.72, GLOBE_FLOORS[2] - 0.2], [GLOBE_FLOORS[2] + 0.28, GLOBE_FLOORS[3] - 0.28]]) {
    for (let k = 0; k < 5; k++) {
      const x = lerp(-3.6, 3.6, k / 4);
      const hw = 0.42;
      stuff.push(flat(new THREE.BoxGeometry(hw * 2, y1 - y0, 0.02).translate(x, (y0 + y1) / 2, STAGE_BACK_Z + 0.012), 0x120d09));
      const frame = plateSolid(roundedOutline(hw + 0.05, (y1 - y0) / 2 + 0.05, 0.005, 1), [roundedOutline(hw, (y1 - y0) / 2, 0.005, 1)], [[0, 0], [0, 0.05]], { crease: 30 });
      frame.translate(x, (y0 + y1) / 2, STAGE_BACK_Z);
      stuff.push(flat(frame, 0xb99a54));
      timber([x, y0, STAGE_BACK_Z + 0.03], [x, y1, STAGE_BACK_Z + 0.03], 0.03, 0.03, 0xb99a54);
    }
  }

  // --- the columns and the heavens -----------------------------------------------------------
  const COL_X = 2.85;
  const COL_Z = -2.35;
  const HEAV_Y = GLOBE_FLOORS[2] + 0.5;
  const colProfile = [
    [0, STAGE_TOP], [0.24, STAGE_TOP], [0.24, STAGE_TOP + 0.14], [0.2, STAGE_TOP + 0.18], [0.18, STAGE_TOP + 0.26], [0.145, STAGE_TOP + 0.5],
    [0.125, HEAV_Y - 0.72], [0.125, HEAV_Y - 0.52], [0.16, HEAV_Y - 0.46], [0.13, HEAV_Y - 0.42], [0.17, HEAV_Y - 0.28], [0.25, HEAV_Y - 0.12], [0.27, HEAV_Y - 0.06], [0.27, HEAV_Y], [0, HEAV_Y],
  ];
  for (const s of [-1, 1]) {
    const col = latheUp(colProfile, { segments: 20 });
    col.translate(s * COL_X, 0, COL_Z);
    // Painted marble: red-brown with pale veins, and a gilded capital and base.
    stuff.push(painted(col, (p) => {
      if (p.y > HEAV_Y - 0.5 || p.y < STAGE_TOP + 0.3) return lin(0xc99e42);
      const n = smoothNoise3(p.x * 8, p.y * 3, p.z * 8);
      const c = lin(0x7c3024);
      const v = smooth(0.48, 0.66, n);
      return [lerp(c[0], 0.5, v), lerp(c[1], 0.34, v), lerp(c[2], 0.26, v)];
    }));
  }
  // The canopy, a thick boxed ceiling with its painted heavens on the underside.
  const CAN_FRONT = COL_Z + 0.7;
  const CAN_W = COL_X + 0.75;
  const canopy = new THREE.BoxGeometry(CAN_W * 2, 0.26, CAN_FRONT - STAGE_BACK_Z);
  canopy.translate(0, HEAV_Y + 0.13, (CAN_FRONT + STAGE_BACK_Z) / 2);
  oak.push(painted(canopy, () => lin(0x3f2c1a)));
  const under = plateSolid([[-CAN_W + 0.04, STAGE_BACK_Z + 0.04], [CAN_W - 0.04, STAGE_BACK_Z + 0.04], [CAN_W - 0.04, CAN_FRONT - 0.04], [-CAN_W + 0.04, CAN_FRONT - 0.04]], [], [[0, 0], [0, 0.015]]);
  // Plate in (x, y=world z), extruded along +z. Turned to face down: its +z becomes -y.
  under.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)).setPosition(0, HEAV_Y, 0));
  paintedUv(under, 0, 0.5, 0, 1, (x) => (x + CAN_W) / (CAN_W * 2), (x, y, z) => (z - STAGE_BACK_Z) / (CAN_FRONT - STAGE_BACK_Z));
  painted2.push({ geometry: under, color: 0xffffff });
  // The gilded frieze round the canopy's edge.
  for (const [a, b] of [[[-CAN_W, HEAV_Y + 0.13, CAN_FRONT + 0.01], [CAN_W, HEAV_Y + 0.13, CAN_FRONT + 0.01]], [[CAN_W + 0.01, HEAV_Y + 0.13, CAN_FRONT], [CAN_W + 0.01, HEAV_Y + 0.13, STAGE_BACK_Z]], [[-CAN_W - 0.01, HEAV_Y + 0.13, STAGE_BACK_Z], [-CAN_W - 0.01, HEAV_Y + 0.13, CAN_FRONT]]]) {
    stuff.push(flat(plank(a, b, 0.28, 0.03, [0, 1, 0]), 0xc79a3e));
  }
  // The stage roof over it, a gable whose ridge runs from the tiring house toward the yard. It sits
  // proud of the galleries so that from the yard it is the highest thing in view.
  const SR_Y0 = HEAV_Y + 0.26;
  const SR_RIDGE = SR_Y0 + 1.15;
  const SR_W = CAN_W + 0.3;
  const srBack = STAGE_BACK_Z - 1.2;
  const srFront = CAN_FRONT + 0.3;
  const stageRoofSlope = (s) => {
    const rings = [
      [[s * 0.02, SR_RIDGE, srBack], [s * 0.02, SR_RIDGE, srFront], [s * SR_W, SR_Y0, srFront], [s * SR_W, SR_Y0, srBack]],
      [[s * 0.02, SR_RIDGE - 0.14, srBack], [s * 0.02, SR_RIDGE - 0.14, srFront], [s * SR_W, SR_Y0 - 0.14, srFront], [s * SR_W, SR_Y0 - 0.14, srBack]],
    ];
    const g = loftRings(rings);
    uvPlanar(g, (x, y, z) => [z * 0.34, (SR_RIDGE - y) * 0.5]);
    return g;
  };
  for (const s of [-1, 1]) thatch.push(painted(stageRoofSlope(s), () => lin(0xc7ad78)));
  // The gable on its yard end, painted plaster with a timber frame.
  {
    const gable = plateSolid([[-SR_W + 0.05, SR_Y0 - 0.14], [SR_W - 0.05, SR_Y0 - 0.14], [0, SR_RIDGE - 0.1]], [], [[0, -0.06], [0, 0]]);
    gable.translate(0, 0, srFront - 0.1);
    plaster.push(painted(gable, plasterTint));
    timber([0, SR_Y0 - 0.14, srFront - 0.08], [0, SR_RIDGE - 0.12, srFront - 0.08], 0.07, 0.04, OAK, [1, 0, 0]);
    for (const s of [-1, 1]) {
      timber([s * (SR_W - 0.08), SR_Y0 - 0.1, srFront - 0.08], [0, SR_RIDGE - 0.08, srFront - 0.08], 0.1, 0.04, OAK, [-s, 1, 0]);
      timber([s * SR_W * 0.5, SR_Y0 - 0.14, srFront - 0.08], [s * SR_W * 0.5, (SR_RIDGE + SR_Y0) / 2 - 0.1, srFront - 0.08], 0.05, 0.04, OAK, [1, 0, 0]);
      timber([s * SR_W * 0.5, SR_Y0 - 0.1, srFront - 0.08], [0, (SR_RIDGE + SR_Y0) * 0.5 + 0.1, srFront - 0.08], 0.05, 0.04, OAK, [-s, 1, 0]);
    }
    timber([-SR_W + 0.05, SR_Y0 - 0.12, srFront - 0.08], [SR_W - 0.05, SR_Y0 - 0.12, srFront - 0.08], 0.09, 0.05, OAK, [0, 1, 0]);
  }
  // Walls under the stage roof at the sides, from canopy up to the eave, closing it.
  for (const s of [-1, 1]) {
    const w = new THREE.BoxGeometry(0.06, 0.32, srFront - srBack).translate(s * (SR_W - 0.2), SR_Y0 - 0.2, (srFront + srBack) / 2);
    plaster.push(painted(w, plasterTint));
  }

  // --- the hut and turret, with the flag ---------------------------------------------------------
  // The hut over the tiring house, plastered, and the turret on it the flag flew from on a playing day.
  const HUT_W = 2.0;
  const HUT_D = 1.8;
  const HUT_Z = STAGE_BACK_Z - 1.95;
  const HUT_Y0 = SR_RIDGE - 0.75;
  const HUT_Y1 = HUT_Y0 + 1.25;
  const hut = new THREE.BoxGeometry(HUT_W * 2, HUT_Y1 - HUT_Y0, HUT_D).translate(0, (HUT_Y0 + HUT_Y1) / 2, HUT_Z);
  plaster.push(painted(hut, plasterTint));
  for (const x of [-HUT_W, -HUT_W * 0.5, 0, HUT_W * 0.5, HUT_W]) {
    timber([x, HUT_Y0, HUT_Z + HUT_D / 2 + 0.01], [x, HUT_Y1, HUT_Z + HUT_D / 2 + 0.01], 0.1, 0.05, OAK, [1, 0, 0]);
  }
  for (const y of [HUT_Y0 + 0.04, HUT_Y1 - 0.04]) timber([-HUT_W, y, HUT_Z + HUT_D / 2 + 0.01], [HUT_W, y, HUT_Z + HUT_D / 2 + 0.01], 0.09, 0.05, OAK, [0, 1, 0]);
  // The hut's own gable roof, ridge across the building.
  const hutRidge = HUT_Y1 + 0.75;
  const hutFaces = [-1, 1].map((f) => {
    const rings = [
      [[-HUT_W - 0.14, hutRidge, HUT_Z], [HUT_W + 0.14, hutRidge, HUT_Z], [HUT_W + 0.14, HUT_Y1 - 0.08, HUT_Z + f * (HUT_D / 2 + 0.2)], [-HUT_W - 0.14, HUT_Y1 - 0.08, HUT_Z + f * (HUT_D / 2 + 0.2)]],
      [[-HUT_W - 0.14, hutRidge - 0.12, HUT_Z], [HUT_W + 0.14, hutRidge - 0.12, HUT_Z], [HUT_W + 0.14, HUT_Y1 - 0.2, HUT_Z + f * (HUT_D / 2 + 0.2)], [-HUT_W - 0.14, HUT_Y1 - 0.2, HUT_Z + f * (HUT_D / 2 + 0.2)]],
    ];
    const g = loftRings(rings);
    uvPlanar(g, (x, y, z) => [x * 0.34, (hutRidge - y) * 0.5]);
    return g;
  });
  for (const g of hutFaces) thatch.push(painted(g, () => lin(0xc7ad78)));
  for (const s of [-1, 1]) {
    const gable = plateSolid([[-HUT_D / 2, HUT_Y1 - 0.1], [HUT_D / 2, HUT_Y1 - 0.1], [0, hutRidge - 0.1]], [], [[0, -0.05], [0, 0.05]]);
    gable.rotateY(Math.PI / 2);
    gable.translate(s * HUT_W, 0, HUT_Z);
    plaster.push(painted(gable, plasterTint));
  }
  // Turret on the ridge: a small lantern and a shingled cap.
  const TUR_Y0 = hutRidge - 0.28;
  const TUR_Y1 = TUR_Y0 + 0.72;
  const turret = latheUp([
    [0, TUR_Y0], [0.34, TUR_Y0], [0.34, TUR_Y1], [0.34, TUR_Y1], [0.48, TUR_Y1 - 0.03], [0.48, TUR_Y1 + 0.01], [0.42, TUR_Y1 + 0.06], [0.04, TUR_Y1 + 0.5], [0, TUR_Y1 + 0.52],
  ], { segments: 8 });
  turret.translate(0, 0, HUT_Z);
  stuff.push(painted(turret, (p) => (p.y > TUR_Y1 ? lin(0x4c4238) : lin(PLASTER))));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    timber([Math.sin(a) * 0.35, TUR_Y0 + 0.02, HUT_Z + Math.cos(a) * 0.35], [Math.sin(a) * 0.35, TUR_Y1, HUT_Z + Math.cos(a) * 0.35], 0.05, 0.04, OAK);
  }
  // The flagstaff and a real, thick, rippling flag.
  const FLAG_Y = TUR_Y1 + 2.0;
  stuff.push(flat(latheUp([[0, TUR_Y1 + 0.4], [0.05, TUR_Y1 + 0.4], [0.035, FLAG_Y], [0, FLAG_Y + 0.02]], { segments: 10 }), 0x5a4128, { position: [0, 0, HUT_Z] }));
  stuff.push(flat(new THREE.SphereGeometry(0.06, 10, 7).translate(0, FLAG_Y + 0.02, HUT_Z), 0xc79a3e));
  {
    const nu = 24; const nv = 4;
    const FW = 1.45; const FH = 0.82;
    const surf = (u, v) => [0.03 + u * FW, FLAG_Y - 0.05 - (1 - v) * FH * (1 - 0.1 * u), HUT_Z + Math.sin(u * 6.5) * 0.09 * u];
    const rows = [];
    for (let j = 0; j <= nv; j++) {
      const r = [];
      for (let i = 0; i <= nu; i++) { const p = surf(i / nu, j / nv); r.push([p[0], p[1], p[2] + 0.012]); }
      for (let i = nu; i >= 0; i--) { const p = surf(i / nu, j / nv); r.push([p[0], p[1], p[2] - 0.012]); }
      rows.push(r);
    }
    const g = loftRings(rows);
    cloth.push(painted(g, (p) => {
      // A red banner with a gold band at the hoist: raising a flag told London a play was on that day.
      const u = (p.x - 0.03) / FW;
      const c = lin(0xb0232c);
      const k = 0.86 + 0.28 * Math.sin(u * 6.5 + 1.2);
      if (u < 0.08) return lin(0xdcb64e);
      return [c[0] * k, c[1] * k, c[2] * k];
    }));
  }

  const thatchMap = globeThatchTexture();
  thatchMap.wrapS = THREE.RepeatWrapping;
  thatchMap.wrapT = THREE.RepeatWrapping;
  const plasterBump = grainTile({ depth: 8, lines: 7, fine: 19 });
  plasterBump.colorSpace = THREE.NoColorSpace;
  return group([
    mesh(mergeParts(plaster), standard({ vertexColors: true, roughness: 0.92, metalness: 0 })),
    mesh(mergeParts(oak), standard({ vertexColors: true, roughness: 0.78, metalness: 0 })),
    mesh(mergeParts(thatch), standard({ vertexColors: true, map: thatchMap, roughness: 0.96, metalness: 0 })),
    mesh(mergeParts(painted2), standard({ map: globePaintedTexture(), roughness: 0.62, metalness: 0 })),
    mesh(mergeParts(stuff), standard({ vertexColors: true, roughness: 0.68, metalness: 0 })),
    mesh(mergeParts(cloth), standard({ vertexColors: true, roughness: 0.8, metalness: 0 })),
  ], 'globe-theatre');
}

// ---------------------------------------------------------------------------
// ILLUMINATED MANUSCRIPT
// ---------------------------------------------------------------------------

// A book four times life on a scribe's desk. The painting carries this model, so the two pages share
// one 2048 x 1536 canvas: every letter of it drawn with a broad nib rather than set in a font, which
// is what makes it a manuscript. The text is the opening of Virgil's Aeneid, a secular text medieval
// scribes really did copy. It is representative of a page, not a copy of any one surviving book.

const AENEID_LEFT = [
  'rma virumque cano troiae qui primus ab oris',
  'Italiam fato profugus laviniaque venit',
  'Litora multum ille et terris iactatus et alto',
  'Vi superum saevae memorem iunonis ob iram',
  'Multa quoque et bello passus dum conderet urbem',
  'Inferretque deos latio genus unde latinum',
  'Albanique patres atque altae moenia romae',
  'Musa mihi causas memora quo numine laeso',
  'Quidve dolens regina deum tot volvere casus',
  'Insignem pietate virum tot adire labores',
  'Impulerit tantaene animis caelestibus irae',
  'Urbs antiqua fuit tyrii tenuere coloni',
];
const AENEID_RIGHT = [
  'Karthago italiam contra tiberinaque longe',
  'Ostia dives opum studiisque asperrima belli',
  'Quam iuno fertur terris magis omnibus unam',
  'Posthabita coluisse samo hic illius arma',
  'Hic currus fuit hoc regnum dea gentibus esse',
  'Si qua fata sinant iam tum tenditque fovetque',
  'Progeniem sed enim troiano a sanguine duci',
  'Audierat tyrias olim quae verteret arces',
  'Hinc populum late regem belloque superbum',
  'Venturum excidio libyae sic volvere parcas',
  'Id metuens veterisque memor saturnia belli',
  'Prima quod ad troiam pro caris gesserat argis',
  'Necdum etiam causae irarum saevique dolores',
  'Exciderant animo manet alta mente repostum',
  'Iudicium paridis spretaeque iniuria formae',
  'Et genus invisum et rapti ganymedis honores',
  'His accensa super iactatos aequore toto',
  'Troas reliquias danaum atque immitis achilli',
  'Arcebat longe latio multosque per annos',
  'Errabant acti fatis maria omnia circum',
  'Tantae molis erat romanam condere gentem',
];

// A textura hand. Each letter is a list of strokes on a grid where x-height is 1, written with a nib
// held at 40 degrees, which is what turns a plain upright into the lozenge-footed minim of the script.
// Written once here, so that no font on the student's machine can change what the page looks like.
const TX = {
  a: [[[0.5, 0.85], [0.5, 0.05], [0.62, -0.02]], [[0.05, 0.92], [0.28, 1.0], [0.5, 0.85]], [[0.5, 0.56], [0.14, 0.5], [0.04, 0.32], [0.04, 0.1], [0.2, -0.02], [0.5, 0.14]]],
  b: [[[0.06, 1.5], [0.06, 0.04], [0.22, -0.02], [0.5, 0.08], [0.5, 0.82], [0.28, 1.0], [0.06, 0.82]]],
  c: [[[0.44, 0.84], [0.22, 1.0], [0.06, 0.84], [0.06, 0.12], [0.22, -0.02], [0.44, 0.14]]],
  d: [[[0.46, 1.5], [0.46, 0.05], [0.58, -0.02]], [[0.46, 0.82], [0.24, 1.0], [0.06, 0.84], [0.06, 0.12], [0.24, -0.02], [0.46, 0.14]]],
  e: [[[0.44, 0.52], [0.06, 0.42]], [[0.44, 0.52], [0.44, 0.84], [0.24, 1.0], [0.06, 0.84], [0.06, 0.12], [0.24, -0.02], [0.46, 0.14]]],
  f: [[[0.1, 0.04], [0.1, 1.28], [0.26, 1.48], [0.42, 1.4]], [[-0.06, 0.92], [0.3, 0.98]]],
  g: [[[0.46, 0.96], [0.46, -0.3], [0.24, -0.48], [0.04, -0.36]], [[0.46, 0.82], [0.24, 1.0], [0.06, 0.84], [0.06, 0.14], [0.24, 0.0], [0.46, 0.14]]],
  h: [[[0.06, 1.5], [0.06, 0.0]], [[0.06, 0.82], [0.28, 1.0], [0.48, 0.84], [0.48, 0.05], [0.6, -0.02]]],
  i: [[[0.06, 0.96], [0.06, 0.04], [0.18, -0.02]], [[0.0, 1.2], [0.12, 1.27]]],
  j: [[[0.06, 0.96], [0.06, -0.28], [-0.1, -0.44]], [[0.0, 1.2], [0.12, 1.27]]],
  k: [[[0.06, 1.5], [0.06, 0.0]], [[0.06, 0.42], [0.42, 0.92]], [[0.2, 0.52], [0.44, 0.04]]],
  l: [[[0.06, 1.5], [0.06, 0.04], [0.2, -0.02]]],
  m: [[[0.06, 0.96], [0.06, 0.0]], [[0.06, 0.82], [0.26, 1.0], [0.44, 0.84], [0.44, 0.0]], [[0.44, 0.82], [0.64, 1.0], [0.82, 0.84], [0.82, 0.05], [0.94, -0.02]]],
  n: [[[0.06, 0.96], [0.06, 0.0]], [[0.06, 0.82], [0.28, 1.0], [0.48, 0.84], [0.48, 0.05], [0.6, -0.02]]],
  o: [[[0.06, 0.84], [0.26, 1.0], [0.48, 0.84], [0.48, 0.14], [0.26, -0.02], [0.06, 0.14], [0.06, 0.84]]],
  p: [[[0.06, 0.96], [0.06, -0.48]], [[0.06, 0.82], [0.28, 1.0], [0.48, 0.84], [0.48, 0.14], [0.28, -0.02], [0.06, 0.14]]],
  q: [[[0.46, 0.96], [0.46, -0.48]], [[0.46, 0.82], [0.24, 1.0], [0.06, 0.84], [0.06, 0.14], [0.24, -0.02], [0.46, 0.14]]],
  r: [[[0.06, 0.96], [0.06, 0.0]], [[0.06, 0.8], [0.22, 1.0], [0.38, 0.86]]],
  s: [[[0.42, 0.86], [0.22, 1.0], [0.06, 0.84], [0.06, 0.62], [0.42, 0.34], [0.42, 0.14], [0.24, -0.02], [0.04, 0.12]]],
  t: [[[0.1, 1.22], [0.1, 0.06], [0.24, -0.02], [0.38, 0.08]], [[-0.06, 0.92], [0.34, 0.98]]],
  u: [[[0.06, 0.96], [0.06, 0.14], [0.26, -0.02], [0.48, 0.14]], [[0.48, 0.96], [0.48, 0.05], [0.6, -0.02]]],
  v: [[[0.06, 0.96], [0.06, 0.42], [0.26, -0.02]], [[0.46, 0.96], [0.46, 0.42], [0.26, -0.02]]],
  x: [[[0.04, 0.96], [0.46, 0.0]], [[0.46, 0.96], [0.04, 0.0]]],
  y: [[[0.06, 0.96], [0.06, 0.14], [0.26, -0.02], [0.46, 0.14]], [[0.46, 0.96], [0.46, -0.28], [0.26, -0.46], [0.06, -0.36]]],
  z: [[[0.04, 0.96], [0.46, 0.96], [0.04, 0.0], [0.46, 0.0]]],
};
const TX_ADVANCE = (c) => {
  const pts = TX[c];
  if (!pts) return 0.34;
  let x1 = 0;
  for (const stroke of pts) for (const p of stroke) x1 = Math.max(x1, p[0]);
  return x1 + 0.2;
};
const lineWidthTx = (text) => [...text].reduce((w, c) => w + TX_ADVANCE(c), 0);

// One broad-nib stroke: a nib of width w at a fixed angle is swept along the path by filling the
// quadrilateral each step covers, so thick and thin follow from direction alone.
function nibStroke(ctx, pts, S, x0, y0, w) {
  const NIB = (40 * Math.PI) / 180;
  const nx = (Math.cos(NIB) * w) / 2; const ny = (Math.sin(NIB) * w) / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = x0 + pts[i][0] * S; const ay = y0 - pts[i][1] * S;
    const bx = x0 + pts[i + 1][0] * S; const by = y0 - pts[i + 1][1] * S;
    ctx.beginPath();
    ctx.moveTo(ax - nx, ay + ny); ctx.lineTo(ax + nx, ay - ny);
    ctx.lineTo(bx + nx, by - ny); ctx.lineTo(bx - nx, by + ny);
    ctx.closePath(); ctx.fill();
  }
}

function writeTextura(ctx, text, x, y, S, { colour = '#201512', spacing = 1, rng = null } = {}) {
  ctx.fillStyle = colour;
  let pen = x;
  for (const c of text) {
    const strokes = TX[c];
    if (strokes) {
      const wobble = rng ? (rng() - 0.5) * S * 0.035 : 0;
      for (const stroke of strokes) nibStroke(ctx, stroke, S, pen, y + wobble, S * 0.2);
    }
    pen += TX_ADVANCE(c) * S * spacing;
  }
  return pen;
}

const BOOK_INK = '#1f1410';
const BOOK_RED = '#a81f1a';
const BOOK_BLUE = '#1f3f9a';

function goldLeaf(ctx, x0, y0, x1, y1) {
  // Burnished leaf: a bright slant across a warm ground. A flat yellow would read as paint.
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, '#b98a1e');
  g.addColorStop(0.3, '#f4d873');
  g.addColorStop(0.46, '#fff0ae');
  g.addColorStop(0.62, '#d7ab35');
  g.addColorStop(1, '#a87a18');
  return g;
}

function ivyLeaf(ctx, x, y, r, ang, fill, rim = BOOK_INK) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(ang);
  ctx.fillStyle = fill;
  ctx.strokeStyle = rim; ctx.lineWidth = Math.max(0.8, r * 0.1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(r * 0.55, -r * 0.2, r * 0.95, -r * 0.62, r * 1.05, -r * 0.1);
  ctx.bezierCurveTo(r * 1.42, 0, r * 1.42, 0, r * 1.5, 0);
  ctx.bezierCurveTo(r * 1.42, 0, r * 1.42, 0, r * 1.05, r * 0.1);
  ctx.bezierCurveTo(r * 0.95, r * 0.62, r * 0.55, r * 0.2, 0, 0);
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

// Painted vine along a run, with ivy leaves and burnished bezants off alternate sides.
function borderVine(ctx, x0, y0, x1, y1, count, rng) {
  const dx = x1 - x0; const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; const ny = dx / len;
  ctx.strokeStyle = '#2d5e36'; ctx.lineWidth = 3.2;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const t = i / 80;
    const w = Math.sin(t * Math.PI * count) * 16;
    const x = x0 + dx * t + nx * w; const y = y0 + dy * t + ny * w;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const s = i % 2 ? 1 : -1;
    const w = Math.sin(t * Math.PI * count) * 16;
    const x = x0 + dx * t + nx * w; const y = y0 + dy * t + ny * w;
    const base = Math.atan2(ny * s, nx * s);
    const col = [BOOK_BLUE, BOOK_RED, '#2f7a42'][i % 3];
    ivyLeaf(ctx, x, y, 13 + rng() * 3, base, col);
    // A short tendril and a gold bezant at its tip.
    const bx = x + nx * s * -22 + dx / len * 6; const by = y + ny * s * -22 + dy / len * 6;
    ctx.strokeStyle = '#2d5e36'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = goldLeaf(ctx, bx - 6, by - 6, bx + 6, by + 6);
    ctx.beginPath(); ctx.arc(bx, by, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = BOOK_INK; ctx.lineWidth = 1; ctx.stroke();
  }
}

// The great initial A: gold letter on a quartered blue and rose ground, its counter filled with vine.
function paintInitial(ctx, x, y, size, rng) {
  // The burnished square ground, with its stepped frame.
  ctx.fillStyle = goldLeaf(ctx, x, y, x + size, y + size);
  ctx.fillRect(x - 12, y - 12, size + 24, size + 24);
  ctx.strokeStyle = BOOK_INK; ctx.lineWidth = 2.5;
  ctx.strokeRect(x - 12, y - 12, size + 24, size + 24);
  ctx.fillStyle = BOOK_BLUE;
  ctx.fillRect(x, y, size / 2, size / 2);
  ctx.fillRect(x + size / 2, y + size / 2, size / 2, size / 2);
  ctx.fillStyle = '#a4314c';
  ctx.fillRect(x + size / 2, y, size / 2, size / 2);
  ctx.fillRect(x, y + size / 2, size / 2, size / 2);
  // White tracery on the ground, the fine penwork that goes round every painted initial.
  ctx.strokeStyle = 'rgba(244,238,224,0.75)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 26; i++) {
    const a = x + 10 + rng() * (size - 20); const b = y + 10 + rng() * (size - 20);
    ctx.beginPath(); ctx.arc(a, b, 6 + rng() * 10, rng() * 6, rng() * 6 + 2.4); ctx.stroke();
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = 'rgba(244,238,224,0.85)';
    ctx.beginPath(); ctx.arc(x + 5 + rng() * (size - 10), y + 5 + rng() * (size - 10), 1.2, 0, Math.PI * 2); ctx.fill();
  }

  // The letter itself: a two-storey uncial A in gold, outlined in black.
  const S = size;
  const glyph = () => {
    ctx.beginPath();
    ctx.moveTo(x + S * 0.13, y + S * 0.9);
    ctx.lineTo(x + S * 0.2, y + S * 0.86);
    ctx.bezierCurveTo(x + S * 0.3, y + S * 0.7, x + S * 0.38, y + S * 0.35, x + S * 0.44, y + S * 0.12);
    ctx.lineTo(x + S * 0.6, y + S * 0.08);
    ctx.lineTo(x + S * 0.8, y + S * 0.82);
    ctx.lineTo(x + S * 0.9, y + S * 0.86);
    ctx.lineTo(x + S * 0.9, y + S * 0.92);
    ctx.lineTo(x + S * 0.56, y + S * 0.92);
    ctx.lineTo(x + S * 0.56, y + S * 0.86);
    ctx.lineTo(x + S * 0.63, y + S * 0.82);
    ctx.lineTo(x + S * 0.58, y + S * 0.62);
    ctx.lineTo(x + S * 0.34, y + S * 0.62);
    ctx.lineTo(x + S * 0.28, y + S * 0.84);
    ctx.lineTo(x + S * 0.34, y + S * 0.86);
    ctx.lineTo(x + S * 0.34, y + S * 0.92);
    ctx.lineTo(x + S * 0.13, y + S * 0.92);
    ctx.closePath();
    ctx.moveTo(x + S * 0.37, y + S * 0.54);
    ctx.lineTo(x + S * 0.56, y + S * 0.54);
    ctx.lineTo(x + S * 0.49, y + S * 0.22);
    ctx.closePath();
  };
  // A soft ink shadow, then the leaf, then the line that makes it read at a distance.
  ctx.save();
  ctx.translate(S * 0.012, S * 0.014);
  ctx.fillStyle = 'rgba(12,8,6,0.65)';
  glyph(); ctx.fill('evenodd');
  ctx.restore();
  ctx.fillStyle = goldLeaf(ctx, x, y, x + S, y + S);
  glyph(); ctx.fill('evenodd');
  ctx.strokeStyle = BOOK_INK; ctx.lineWidth = 3;
  glyph(); ctx.stroke();
  // Vine and leaves climbing through the counter, on top of the ground and behind nothing.
  ctx.strokeStyle = '#e8e4d0'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + S * 0.08, y + S * 0.12); ctx.bezierCurveTo(x + S * 0.2, y + S * 0.3, x + S * 0.1, y + S * 0.5, x + S * 0.2, y + S * 0.7); ctx.stroke();
  for (const [lx, ly, a] of [[0.14, 0.24, -0.4], [0.16, 0.44, 0.6], [0.16, 0.6, -0.6], [0.84, 0.2, 2.6], [0.72, 0.28, 0.6]]) {
    ivyLeaf(ctx, x + S * lx, y + S * ly, S * 0.04, a, '#e8c95f');
  }
}

// The opening, 1024 x 1536 a page.
function manuscriptTexture() {
  return canvasTexture(2048, 1536, (ctx, W, H) => {
    const PW = W / 2;
    const rng = seededRandom(1465);
    // Vellum: warm, uneven, with hair-follicle speckle and the odd pale flay mark.
    const vellum = (x0, flip) => {
      ctx.fillStyle = '#ece0c3';
      ctx.fillRect(x0, 0, PW, H);
      for (let i = 0; i < 900; i++) {
        const x = x0 + rng() * PW; const y = rng() * H;
        const r = 40 + rng() * 170;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const warm = rng() > 0.5;
        g.addColorStop(0, warm ? 'rgba(198,162,108,0.05)' : 'rgba(250,244,226,0.06)');
        g.addColorStop(1, 'rgba(198,162,108,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.fillStyle = 'rgba(112,84,50,0.4)';
      for (let i = 0; i < 4000; i++) ctx.fillRect(x0 + rng() * PW, rng() * H, 1.1, 1.1);
      // Handling grime along the fore-edge and bottom corner, where a thumb turns the page.
      const edge = ctx.createLinearGradient(flip > 0 ? x0 : x0 + PW, 0, flip > 0 ? x0 + 170 : x0 + PW - 170, 0);
      edge.addColorStop(0, 'rgba(128,92,50,0.26)');
      edge.addColorStop(1, 'rgba(128,92,50,0)');
      ctx.fillStyle = edge;
      ctx.fillRect(x0, 0, PW, H);
      const foot = ctx.createLinearGradient(0, H, 0, H - 140);
      foot.addColorStop(0, 'rgba(128,92,50,0.2)');
      foot.addColorStop(1, 'rgba(128,92,50,0)');
      ctx.fillStyle = foot;
      ctx.fillRect(x0, H - 140, PW, 140);
      // Going into the gutter the page falls away from the light.
      const gut = ctx.createLinearGradient(flip > 0 ? x0 + PW : x0, 0, flip > 0 ? x0 + PW - 130 : x0 + 130, 0);
      gut.addColorStop(0, 'rgba(56,36,18,0.62)');
      gut.addColorStop(0.45, 'rgba(90,62,32,0.18)');
      gut.addColorStop(1, 'rgba(90,62,32,0)');
      ctx.fillStyle = gut;
      ctx.fillRect(x0, 0, PW, H);
    };
    vellum(0, 1);
    vellum(PW, -1);

    const TOP = 170;
    const LINE = 54;
    const XH = 20;
    const rule = (x0, x1, y0, n) => {
      // Ruled in pale brown crayon, every line, and the two verticals that bound the capitals.
      ctx.strokeStyle = 'rgba(138,96,58,0.42)'; ctx.lineWidth = 1.1;
      for (let i = 0; i < n; i++) {
        const y = y0 + i * LINE;
        ctx.beginPath(); ctx.moveTo(x0 - 40, y); ctx.lineTo(x1 + 22, y); ctx.stroke();
      }
      for (const x of [x0 - 34, x0 - 6, x1]) {
        ctx.beginPath(); ctx.moveTo(x, y0 - LINE); ctx.lineTo(x, y0 + (n - 1) * LINE + 30); ctx.stroke();
      }
      // Prick marks up the outer margin, where the ruling was set out.
      ctx.fillStyle = 'rgba(70,46,26,0.6)';
      for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(x0 - 76, y0 + i * LINE, 1.4, 0, Math.PI * 2); ctx.fill(); }
    };
    const verse = (line, x0, y, width, red = false) => {
      // The capital set out in its own column, touched with red, as scribes did.
      const cap = line[0].toUpperCase();
      const body = line.slice(1);
      ctx.font = `bold ${XH * 1.55}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = BOOK_INK;
      ctx.fillText(cap, x0 - 20, y);
      ctx.fillStyle = 'rgba(176,34,26,0.75)';
      ctx.fillRect(x0 - 23, y - XH * 1.05, 5, XH * 1.08);
      const natural = lineWidthTx(body) * XH;
      // Fitted to the line: a scribe closes up as the margin nears, so nothing ever runs over.
      const spacing = Math.min(1.12, width / natural);
      writeTextura(ctx, body, x0 + 2, y, XH, { spacing, rng, colour: red ? BOOK_RED : BOOK_INK });
    };

    // --- the left page: the rich one -------------------------------------------------------
    const LX0 = 240; const LX1 = 860;
    // The border: a burnished bar with blue and rose lengths, on three sides, plus vine in the margins.
    const barPieces = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(3, Math.round(len / 92));
      const horiz = Math.abs(y1 - y0) < 1;
      for (let i = 0; i < n; i++) {
        const a = i / n; const b = (i + 1) / n;
        const ax = lerp(x0, x1, a); const ay = lerp(y0, y1, a); const bx = lerp(x0, x1, b); const by = lerp(y0, y1, b);
        const rect = horiz ? [ax, ay - 12, bx - ax, 24] : [ax - 12, ay, 24, by - ay];
        ctx.fillStyle = i % 2 ? BOOK_BLUE : '#a4314c';
        ctx.fillRect(...rect);
        ctx.strokeStyle = 'rgba(244,238,224,0.85)'; ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (horiz) { ctx.moveTo(ax + 6, ay); ctx.lineTo(bx - 6, by); } else { ctx.moveTo(ax, ay + 6); ctx.lineTo(bx, by - 6); }
        ctx.stroke();
        // White dots along it.
        ctx.fillStyle = 'rgba(244,238,224,0.92)';
        for (let k = 0; k < 4; k++) {
          const t = (k + 0.5) / 4;
          ctx.beginPath(); ctx.arc(lerp(ax, bx, t) + (horiz ? 0 : -7), lerp(ay, by, t) + (horiz ? -7 : 0), 1.7, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Gold rails either side of the bar.
      ctx.fillStyle = goldLeaf(ctx, x0, y0, x0 + 30, y0 + 30);
      if (horiz) { ctx.fillRect(x0 - 16, y0 - 17, x1 - x0 + 32, 5); ctx.fillRect(x0 - 16, y0 + 12, x1 - x0 + 32, 5); } else { ctx.fillRect(x0 - 17, y0 - 16, 5, y1 - y0 + 32); ctx.fillRect(x0 + 12, y0 - 16, 5, y1 - y0 + 32); }
    };
    const BL = 124; const BT = 76; const BR = 930; const BB = 1436;
    barPieces(BL, BT, BR, BT);
    barPieces(BL, BT, BL, BB);
    barPieces(BL, BB, BR, BB);
    barPieces(BR, BT, BR, BB);
    // Gold roundels at the corners and the mid-points, each with a painted flower.
    for (const [x, y] of [[BL, BT], [BR, BT], [BL, BB], [BR, BB], [BL, (BT + BB) / 2], [BR, (BT + BB) / 2], [(BL + BR) / 2, BT], [(BL + BR) / 2, BB]]) {
      ctx.fillStyle = goldLeaf(ctx, x - 22, y - 22, x + 22, y + 22);
      ctx.beginPath(); ctx.arc(x, y, 25, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = BOOK_INK; ctx.lineWidth = 2; ctx.stroke();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.fillStyle = k % 2 ? BOOK_BLUE : '#a4314c';
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 11, y + Math.sin(a) * 11, 7, 4, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f5ecc8';
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    // Vine out in the margins.
    borderVine(ctx, 52, 150, 52, 1360, 16, rng);
    borderVine(ctx, 200, 1490, 880, 1490, 9, rng);
    borderVine(ctx, 200, 34, 880, 34, 9, rng);

    // The heading, in red, ruled for like a line.
    const RUB_Y = 166;
    rule(LX0, LX1, RUB_Y, 22);
    writeTextura(ctx, 'incipit liber primus aeneidos', LX0 + 240, RUB_Y, 21, { colour: BOOK_RED, rng });
    // The great initial, six lines deep.
    const INIT = 300;
    const INIT_LINES = 6;
    const INIT_X = LX0 - 30;
    const INIT_Y = RUB_Y + 30;
    paintInitial(ctx, INIT_X, INIT_Y, INIT, rng);
    // The text flows round the initial and then returns to the margin, each line justified by closing up
    // the letters. It is written as a single measure, which is how a scribe worked to a ruled block.
    const words = AENEID_LEFT.join(' ').toLowerCase().split(' ');
    let w = 0;
    let row = 1;
    while (w < words.length && row <= 13) {
      const inset = row <= INIT_LINES ? INIT + 44 : 0;
      const x = LX0 + inset - (inset ? 26 : 0);
      const room = LX1 - x;
      const line = [];
      let width = 0;
      while (w < words.length) {
        const add = (lineWidthTx(words[w]) + (line.length ? TX_ADVANCE(' ') : 0)) * XH;
        if (line.length && width + add > room * 1.04) break;
        line.push(words[w]);
        width += add;
        w += 1;
      }
      const spacing = clamp(room / width, 0.9, 1.2);
      const y = RUB_Y + LINE * row;
      const end = writeTextura(ctx, line.join(' '), x, y, XH, { spacing: w >= words.length ? 1 : spacing, rng });
      void end;
      row += 1;
    }
    // A small painted panel at the foot of the page: a sailing ship, since the poem is about a voyage.
    const PY = RUB_Y + LINE * 14 - 8;
    const PH = BB - 36 - PY;
    const PX0 = LX0 - 30; const PX1 = LX1 + 10;
    if (PH > 90) {
      const sky = ctx.createLinearGradient(0, PY, 0, PY + PH);
      sky.addColorStop(0, '#2f5cb5');
      sky.addColorStop(0.62, '#b8cfe6');
      sky.addColorStop(0.64, '#1d4f7c');
      sky.addColorStop(1, '#0f2a4e');
      ctx.fillStyle = sky;
      ctx.fillRect(PX0, PY, PX1 - PX0, PH);
      // Waves, drawn the way an illuminator drew them: rows of little curls.
      ctx.strokeStyle = 'rgba(236,240,244,0.75)'; ctx.lineWidth = 2;
      for (let r = 0; r < 3; r++) {
        const wy = PY + PH * (0.7 + r * 0.1);
        for (let x = PX0 + 8 + r * 12; x < PX1 - 18; x += 34) {
          ctx.beginPath(); ctx.arc(x, wy, 9, Math.PI, Math.PI * 1.9); ctx.stroke();
        }
      }
      // The ship.
      const cx = (PX0 + PX1) / 2; const hy = PY + PH * 0.62;
      ctx.fillStyle = '#6d3a1a';
      ctx.beginPath();
      ctx.moveTo(cx - 118, hy - 22); ctx.quadraticCurveTo(cx - 88, hy + 26, cx - 40, hy + 28);
      ctx.lineTo(cx + 54, hy + 28); ctx.quadraticCurveTo(cx + 104, hy + 24, cx + 128, hy - 28);
      ctx.lineTo(cx + 92, hy - 8); ctx.lineTo(cx - 78, hy - 8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = BOOK_INK; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = '#3a1e10';
      ctx.fillRect(cx - 3, hy - PH * 0.5, 6, PH * 0.5);
      ctx.fillStyle = '#efe7cf';
      ctx.beginPath();
      ctx.moveTo(cx - 62, hy - PH * 0.44); ctx.quadraticCurveTo(cx + 4, hy - PH * 0.3, cx + 66, hy - PH * 0.44);
      ctx.quadraticCurveTo(cx + 74, hy - PH * 0.24, cx + 58, hy - 18);
      ctx.quadraticCurveTo(cx, hy - 34, cx - 54, hy - 18);
      ctx.quadraticCurveTo(cx - 70, hy - PH * 0.24, cx - 62, hy - PH * 0.44);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = BOOK_RED;
      for (const s of [-30, 0, 30]) ctx.fillRect(cx + s - 5, hy - PH * 0.4, 10, PH * 0.26);
      // A gilt frame round the panel.
      ctx.lineWidth = 7;
      ctx.strokeStyle = goldLeaf(ctx, PX0, PY, PX1, PY + PH);
      ctx.strokeRect(PX0, PY, PX1 - PX0, PH);
      ctx.lineWidth = 1.8; ctx.strokeStyle = BOOK_INK;
      ctx.strokeRect(PX0 - 4.5, PY - 4.5, PX1 - PX0 + 9, PH + 9);
    }

    // --- the right page: text, red and blue versals, a catchword --------------------------------
    const RX0 = PW + 170; const RX1 = W - 200;
    const R_Y0 = TOP;
    rule(RX0, RX1, R_Y0, 24);
    AENEID_RIGHT.forEach((line, i) => {
      const y = R_Y0 + i * LINE;
      verse(line, RX0, y, RX1 - RX0 - 4);
      if (i === 11) {
        // A blue Lombard versal two lines deep, flourished in red, where the sense turns.
        ctx.fillStyle = '#ecdfc0';
        ctx.fillRect(RX0 - 58, y - LINE * 0.86, 48, LINE * 1.84);
        ctx.font = `bold ${XH * 4.2}px Georgia, 'Times New Roman', serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = BOOK_BLUE;
        ctx.fillText('P', RX0 - 34, y + LINE * 0.74);
        ctx.strokeStyle = BOOK_RED; ctx.lineWidth = 1.6;
        for (let k = 0; k < 7; k++) {
          ctx.beginPath(); ctx.moveTo(RX0 - 54, y - LINE * 0.9 + k * 13); ctx.bezierCurveTo(RX0 - 76, y - LINE * 0.9 + k * 13, RX0 - 70, y - LINE * 0.9 + k * 13 + 12, RX0 - 90, y - LINE * 0.9 + k * 13 + 4); ctx.stroke();
        }
      }
    });
    // A red rubric closes the page, then the catchword for the next gathering.
    const RUB2 = R_Y0 + LINE * AENEID_RIGHT.length;
    writeTextura(ctx, 'hic desinit prooemium', RX0 + 150, RUB2, XH, { colour: BOOK_RED, rng });
    writeTextura(ctx, 'vix e conspectu', RX1 - 150, RUB2 + LINE * 1.5, XH * 0.82, { rng });
    ctx.strokeStyle = BOOK_RED; ctx.lineWidth = 1.5;
    ctx.strokeRect(RX1 - 164, RUB2 + LINE * 1.5 - XH * 1.3, 176, XH * 2);
    // Light bar and vine down the outer margin of the second page, a lesser decoration than the first.
    borderVine(ctx, W - 92, 150, W - 92, 1380, 15, rng);
    barPieces(RX0 - 92, R_Y0 - 40, RX0 - 92, R_Y0 + LINE * 7);
  });
}

function pageEdgeTile() {
  // Near-white with hundreds of fine leaf lines. Its v runs across the stack.
  const tex = canvasTexture(16, 256, (ctx, w, h) => {
    const rng = seededRandom(9);
    ctx.fillStyle = '#efe6cf';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const a = 0.14 + rng() * 0.3;
      ctx.fillStyle = rng() > 0.86 ? `rgba(90,62,30,${a + 0.3})` : `rgba(120,90,50,${a})`;
      ctx.fillRect(0, y, w, 1);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function illuminatedManuscript() {
  const pages = [];
  const edges = [];
  const wood = [];
  const leather = [];
  const coverParts = [];
  const metal = [];
  const feather = [];

  // Slanted on the desk. In the book's frame x is across, y up the slope, z out of the page.
  const SLANT = THREE.MathUtils.degToRad(52);
  const LEDGE_Y = 2.2;
  const LEDGE_Z = 0.72;
  const toDesk = new THREE.Matrix4().makeTranslation(0, LEDGE_Y, LEDGE_Z).multiply(new THREE.Matrix4().makeRotationX(-(Math.PI / 2 - SLANT)));
  const onDesk = (p) => v3(p).applyMatrix4(toDesk).toArray();

  // --- the book, in its own frame -----------------------------------------------------------
  const PAGE_W = 3.0;
  const PAGE_H = 4.0;
  const FOOT = 0.09; // above the board's lip
  const COVER_T = 0.075;
  const STACK = 0.27;
  // A page's height above the cover at distance s from the spine. It dives at the gutter, swells where
  // the gathering rounds over, and thins out toward the fore-edge. This curve is the book.
  const pageZ = (s) => {
    const k = s / PAGE_W;
    const rise = 1 - Math.exp(-k / 0.055);
    const fall = 1 - 0.22 * k - 0.06 * k * k;
    return COVER_T + STACK * rise * fall + 0.012;
  };
  const NU = 72;
  const NV = 6;
  const STOPS = [];
  for (let i = 0; i <= NU; i++) STOPS.push((i / NU) ** 1.65 * PAGE_W);
  // The arc length along the curve, so that the painted page lies flat on it without stretching.
  const arc = [0];
  for (let i = 1; i <= NU; i++) arc.push(arc[i - 1] + Math.hypot(STOPS[i] - STOPS[i - 1], pageZ(STOPS[i]) - pageZ(STOPS[i - 1])));
  const ARC = arc[NU];
  for (const side of [-1, 1]) {
    // Right page: u = 0.5 at the gutter to 1 at the fore-edge. Left page: u = 0.5 to 0.
    const top = [];
    for (let i = 0; i <= NU; i++) {
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const yy = FOOT + COVER_T * 0.3 + v * PAGE_H;
        top.push([side * STOPS[i], yy, pageZ(STOPS[i])]);
      }
    }
    const positions = top.flat();
    const uv = [];
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) uv.push(0.5 + side * 0.5 * (arc[i] / ARC), j / NV);
    const indices = [];
    for (let i = 0; i < NU; i++) {
      for (let j = 0; j < NV; j++) {
        const a = i * (NV + 1) + j; const b = a + 1; const c = (i + 1) * (NV + 1) + j + 1; const d = (i + 1) * (NV + 1) + j;
        if (side > 0) indices.push(a, d, c, a, c, b);
        else indices.push(a, c, d, a, b, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(indices);
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    pages.push({ geometry: g, color: 0xffffff });

    // The block of leaves under it: head and tail faces plus the fore-edge, carrying the leaf-line tile.
    // Each column of the head and tail runs from the cover up to the page, so nothing can gap.
    const y0 = FOOT + COVER_T * 0.3; const y1 = y0 + PAGE_H;
    const rings = [];
    const LAYERS = 4;
    for (let l = 0; l <= LAYERS; l++) {
      const f = l / LAYERS;
      const ring = [];
      // Head, fore-edge, tail, walked as one loop in the (x, y) plane at this fraction of the stack.
      const fan = (s) => side * Math.min(PAGE_W + 0.03, s + 0.03 * (1 - f) * (s / PAGE_W));
      for (let i = 0; i <= NU; i += 3) ring.push([fan(STOPS[i]), y1, lerp(COVER_T - 0.002, pageZ(STOPS[i]), f)]);
      ring.push([fan(PAGE_W), lerp(y1, y0, 0.33), lerp(COVER_T - 0.002, pageZ(PAGE_W), f)]);
      ring.push([fan(PAGE_W), lerp(y1, y0, 0.67), lerp(COVER_T - 0.002, pageZ(PAGE_W), f)]);
      for (let i = NU; i >= 0; i -= 3) ring.push([fan(STOPS[i]), y0, lerp(COVER_T - 0.002, pageZ(STOPS[i]), f)]);
      rings.push(ring);
    }
    const edge = loftRings(rings, { capStart: false, capEnd: false, uv: (l, j, p) => [p[0] * 0.2 + p[1] * 0.2, l / LAYERS] });
    edges.push({ geometry: edge, color: 0xf2e9d2 });
    // Below the top sheet, so a seam in the page's own mesh has nothing to show but more paper.
    const under = new THREE.BoxGeometry(PAGE_W, PAGE_H, 0.02).translate(side * PAGE_W / 2, y0 + PAGE_H / 2, COVER_T + 0.005);
    coverParts.push(flat(under, 0x3a2412));
  }

  // The gutter, closing the two pages' inner edges: a thin dark line where they dive together.
  const gutterLine = bar([0, FOOT + COVER_T * 0.3, COVER_T + 0.012], [0, FOOT + COVER_T * 0.3 + PAGE_H, COVER_T + 0.012], 0.014, 0.014, 6);
  coverParts.push(flat(gutterLine, 0x1a120a));

  // The boards: leather over oak, bevelled, with brass corners and bosses.
  const COVER = 0x5b2412;
  const boardH = PAGE_H + 0.2;
  for (const side of [-1, 1]) {
    const outline = roundedOutline(PAGE_W / 2 + 0.09, boardH / 2, 0.05, 3);
    const board = plateSolid(outline, [], [[0.016, 0], [0, 0.016], [0, COVER_T - 0.016], [0.016, COVER_T]], { crease: 50 });
    board.translate(side * (PAGE_W / 2 + 0.07), FOOT + COVER_T * 0.3 + PAGE_H / 2, 0);
    coverParts.push(flat(board, COVER));
    for (const yb of [-1, 1]) {
      const cx = side * (PAGE_W + 0.08);
      const cy = FOOT + COVER_T * 0.3 + PAGE_H / 2 + yb * (boardH / 2 - 0.14);
      const corner = plateSolid(roundedOutline(0.16, 0.16, 0.05, 2), [], [[0, COVER_T - 0.005], [0, COVER_T + 0.01], [0.01, COVER_T + 0.016]], { crease: 50 });
      corner.translate(cx, cy, 0);
      metal.push(polished(corner.applyMatrix4(toDesk), 0xb98f3f));
    }
  }
  // The spine, a rounded back with raised bands, spanning the two boards underneath.
  const spineRings = [];
  const SPINE_R = 0.32;
  for (let i = 0; i <= 16; i++) {
    const y = FOOT - 0.06 + (i / 16) * (boardH - 0.02);
    const band = Math.abs(Math.sin((i / 16) * Math.PI * 4)) > 0.92 ? 0.018 : 0;
    const ring = [];
    for (let j = 0; j <= 16; j++) {
      const q = (j / 16) * Math.PI;
      ring.push([Math.cos(q) * (SPINE_R + band), y, 0.05 - Math.sin(q) * (0.11 + band)]);
    }
    for (let j = 1; j < 4; j++) ring.push([lerp(-SPINE_R, SPINE_R, j / 4), y, 0.06]);
    spineRings.push(ring);
  }
  coverParts.push(flat(loftRings(spineRings), COVER));

  // A red silk marker from the head of the gutter, over the foot of the page, down past the ledge.
  {
    const P = [];
    const y0 = FOOT + COVER_T * 0.3;
    P.push([0.08, y0 + 1.8, pageZ(0.2) - 0.02]);
    P.push([0.1, y0 + 0.9, pageZ(0.14) + 0.012]);
    P.push([0.11, y0 + 0.02, pageZ(0.2) + 0.012]);
    P.push([0.12, y0 - 0.2, 0.02]);
    P.push([0.15, y0 - 0.55, -0.1]);
    P.push([0.12, y0 - 0.86, -0.04]);
    const { P: run } = sampleCurve(P, 1, 30);
    coverParts.push(flat(polyTube(run, 0.02, 6, 2.2), 0xa82320));
  }

  // --- the desk ------------------------------------------------------------------------------
  const OAK = lin(0x7b5230);
  const oakTint = (p) => {
    const n = smoothNoise3(p.x * 0.7, p.y * 2.2, p.z * 2.2) * 0.6 + smoothNoise3(p.x * 2.1, p.y * 7, p.z * 7) * 0.4;
    const k = 0.72 + 0.6 * n;
    return [OAK[0] * k, OAK[1] * k, OAK[2] * k];
  };
  const DESK_W = PAGE_W + 0.55;
  const BOARD_H = PAGE_H + 0.56;
  // The sloped board, with a lip at the bottom that the book really rests on.
  {
    const slab = plateSolid(roundedOutline(DESK_W, BOARD_H / 2, 0.06, 3), [], [[0.02, -0.14], [0, -0.12], [0, -0.03], [0.02, -0.01]], { crease: 50 });
    slab.translate(0, BOARD_H / 2 - 0.1, -0.17 + 0.03);
    slab.applyMatrix4(toDesk);
    wood.push(painted(slab, oakTint));
    const lip = beam(onDesk([-DESK_W, -0.02, -0.16]), onDesk([DESK_W, -0.02, -0.16]), 0.14, 0.34, { side: [0, 1, 0], r: 0.03, steps: 2 });
    wood.push(painted(lip, oakTint));
    // Raised rails up the sides of the board.
    for (const s of [-1, 1]) {
      const r = beam(onDesk([s * (DESK_W - 0.05), 0, -0.14]), onDesk([s * (DESK_W - 0.05), BOARD_H - 0.14, -0.14]), 0.1, 0.16, { side: [1, 0, 0], r: 0.025, steps: 2 });
      wood.push(painted(r, oakTint));
    }
  }
  const backTop = onDesk([0, BOARD_H - 0.14, -0.12]);
  const low = onDesk([0, 0, -0.12]);
  // Two trestle ends: stout boards, each with a pierced trefoil, standing square to the desk's front.
  const END_X = DESK_W - 0.28;
  const END_T = 0.14;
  for (const s of [-1, 1]) {
    // A side elevation in (z, y): a foot, a shaped upright, the raked top that takes the board.
    const zF = low[2] + 0.24; const zB = backTop[2] - 0.08;
    const outlineZY = [
      [zF + 0.5, 0], [zB - 0.5, 0], [zB - 0.5, 0.24], [zB - 0.05, 0.3], [zB + 0.1, 0.56], [zB + 0.1, backTop[1] - 0.26], [low[2] + 0.03, low[1] - 0.2],
      [zF + 0.08, low[1] - 0.26], [zF + 0.04, 1.42], [zF + 0.2, 1.05], [zF + 0.2, 0.56], [zF + 0.1, 0.3], [zF + 0.5, 0.24],
    ];
    // Pierced quatrefoil, a real hole.
    const cz = (zF + zB) / 2 + 0.02; const cy = 1.25;
    const foil = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const r = 0.19 * (1 + 0.28 * Math.cos(a * 4));
      foil.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    const end = plateSolid(outlineZY.map(([z, y]) => [-z, y]), [foil.map(([z, y]) => [-z, y])], [[0.012, -END_T / 2], [0, -END_T / 2 + 0.012], [0, END_T / 2 - 0.012], [0.012, END_T / 2]], { crease: 40 });
    end.rotateY(Math.PI / 2);
    end.translate(s * END_X, 0, 0);
    wood.push(painted(end, oakTint));
  }
  // A stretcher between them, wedged through the uprights, and one back rail.
  const stretchZ = (low[2] + backTop[2]) / 2 + 0.05;
  wood.push(painted(beam([-END_X - 0.12, 0.72, stretchZ], [END_X + 0.12, 0.72, stretchZ], 0.2, 0.34, { side: [0, 0, 1], r: 0.03, steps: 2 }), oakTint));
  wood.push(painted(beam([-END_X, 2.9, backTop[2] - 0.12], [END_X, 2.9, backTop[2] - 0.12], 0.14, 0.2, { side: [0, 0, 1], r: 0.03, steps: 2 }), oakTint));
  for (const s of [-1, 1]) {
    wood.push(painted(beam([s * (END_X + 0.1), 0.6, stretchZ], [s * (END_X + 0.1), 0.86, stretchZ], 0.08, 0.1, { side: [1, 0, 0], r: 0.01, steps: 1 }), oakTint));
  }

  // An apron under the lip, pierced with a row of lancets: the one piece of carving a joiner would add.
  {
    const hw = END_X - 0.04;
    const H0 = low[1] - 0.72; const H1 = low[1] - 0.08;
    const lancets = [];
    const N = 11;
    for (let i = 0; i < N; i++) {
      const x = lerp(-hw + 0.26, hw - 0.26, i / (N - 1));
      const w = 0.075;
      const y0 = H0 + 0.1; const y1 = H1 - 0.2;
      const pts = [[x + w, y0], [x + w, y1]];
      // A pointed head, the Gothic arch: two arcs meeting.
      for (let k = 1; k <= 4; k++) { const t = k / 4; pts.push([x + w * Math.cos((t * Math.PI) / 2), y1 + 0.13 * Math.sin((t * Math.PI) / 2)]); }
      for (let k = 3; k >= 0; k--) { const t = k / 4; pts.push([x - w * Math.cos((t * Math.PI) / 2), y1 + 0.13 * Math.sin((t * Math.PI) / 2)]); }
      pts.push([x - w, y0]);
      lancets.push(pts);
    }
    const apron = plateSolid([[hw, H0], [hw, H1], [-hw, H1], [-hw, H0]], lancets, [[0.006, -0.045], [0, -0.04], [0, 0.04], [0.006, 0.045]], { crease: 35 });
    apron.translate(0, 0, low[2] - 0.02);
    wood.push(painted(apron, oakTint));
  }

  // --- the tool shelf at the desk's right hand, with pot, horn and knife ---------------------------
  const SHELF_Y = low[1] + 0.02;
  const SX0 = DESK_W + 0.0;
  const SX1 = DESK_W + 1.15;
  const SZ0 = low[2] - 0.3;
  const SZ1 = low[2] + 0.75;
  const HORN_X = SX0 + 0.86;
  const HORN_Z = (SZ0 + SZ1) / 2 + 0.1;
  const shelf = planSolid(roundedOutline((SX1 - SX0) / 2 + 0.2, (SZ1 - SZ0) / 2, 0.08, 3).map(([x, z]) => [x + (SX0 + SX1) / 2 - 0.2, z + (SZ0 + SZ1) / 2]), [circlePts(HORN_X, HORN_Z, 0.135, 24)], [[0.015, SHELF_Y - 0.1], [0, SHELF_Y - 0.085], [0, SHELF_Y - 0.015], [0.015, SHELF_Y]], { crease: 40 });
  wood.push(painted(shelf, oakTint));
  // Its bracket and a turned leg to the ground.
  const shelfCx = (SX0 + SX1) / 2 + 0.1;
  const shelfCz = (SZ0 + SZ1) / 2;
  const leg = latheUp([
    [0, 0], [0.26, 0], [0.26, 0.09], [0.18, 0.15], [0.08, 0.26], [0.07, SHELF_Y - 0.8], [0.12, SHELF_Y - 0.72], [0.07, SHELF_Y - 0.62], [0.06, SHELF_Y - 0.34], [0.11, SHELF_Y - 0.24], [0.09, SHELF_Y - 0.1], [0, SHELF_Y - 0.08],
  ], { segments: 18 });
  leg.translate(shelfCx, 0, shelfCz);
  wood.push(painted(leg, oakTint));

  // The ink pot: a stoneware pot, its mouth a real hollow, ink dark in it.
  const POT_X = SX0 + 0.42;
  const POT_Z = shelfCz - 0.14;
  const POT_R = 0.26;
  const pot = latheUp([
    [0, 0], [POT_R * 0.74, 0], [POT_R * 0.84, 0.02], [POT_R * 0.98, 0.12], [POT_R, 0.22], [POT_R * 0.92, 0.34], [POT_R * 0.7, 0.42], [POT_R * 0.62, 0.45], [POT_R * 0.66, 0.5], [POT_R * 0.7, 0.52],
    [POT_R * 0.6, 0.53], [POT_R * 0.52, 0.48], [POT_R * 0.5, 0.4], [POT_R * 0.42, 0.36], [0, 0.36],
  ], { segments: 28 });
  pot.translate(POT_X, SHELF_Y, POT_Z);
  leather.push(painted(pot, (p) => {
    const y = p.y - SHELF_Y;
    const r = Math.hypot(p.x - POT_X, p.z - POT_Z);
    if (y < 0.46 && r < POT_R * 0.58) return y < 0.41 ? [0.008, 0.007, 0.012] : [0.03, 0.03, 0.03];
    const n = smoothNoise3(p.x * 6, y * 6, p.z * 6);
    const c = lin(0x62707a);
    const k = 0.74 + 0.46 * n;
    return [c[0] * k, c[1] * k, c[2] * k];
  }));

  // The ink horn: a real cow's horn standing in the shelf's hole, the way scribes carried red ink.
  {
    const hx = HORN_X; const hz = HORN_Z;
    // The curve of a horn, zeroed where it passes through the shelf so that it stands in its own hole.
    const AT_SHELF = 0.42 / 1.04;
    const bendZ = (t) => -0.18 * Math.sin(t * Math.PI * 0.8) - 0.1 * t;
    const line = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      line.push([hx + 0.2 * (t ** 2 - AT_SHELF ** 2), SHELF_Y + lerp(-0.42, 0.62, t), hz + bendZ(t) - bendZ(AT_SHELF)]);
    }
    const rr = line.map((_, i) => lerp(0.025, 0.112, (i / 18) ** 0.8));
    const horn = polyTube(line, rr, 14);
    leather.push(painted(horn, (p) => {
      const t = (p.y - SHELF_Y + 0.42) / 1.04;
      const a = lin(0x2c2118); const b = lin(0x9a8a68);
      const k = smooth(0.1, 0.72, t);
      const band = 0.92 + 0.12 * Math.sin(t * 64);
      return [lerp(a[0], b[0], k) * band, lerp(a[1], b[1], k) * band, lerp(a[2], b[2], k) * band];
    }));
    // Its open mouth: a dark disc a hair inside the rim and red ink at its surface.
    const end = line[18];
    const prev = line[17];
    const nrm = v3(end).sub(v3(prev)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
    const rim = latheUp([[0.09, -0.04], [0.12, -0.04], [0.12, 0.005], [0.09, 0.005], [0.08, -0.02], [0, -0.03]], { segments: 18 });
    rim.applyQuaternion(q);
    rim.translate(end[0], end[1], end[2]);
    leather.push(painted(rim, (p) => (Math.hypot(p.x - end[0], p.z - end[2]) < 0.075 ? [0.2, 0.012, 0.012] : lin(0xa39471))));
    // A brass collar at the hole.
    const collar = new THREE.TorusGeometry(0.14, 0.018, 8, 22).rotateX(Math.PI / 2).translate(hx, SHELF_Y + 0.012, hz);
    metal.push(polished(collar, 0xb98f3f));
  }

  // The penknife, lying across the shelf's front edge: a horn handle, a short blade with a real point.
  {
    const kz = SZ1 - 0.12;
    const kx0 = SX0 - 0.02;
    const handle = polyTube([[kx0, SHELF_Y + 0.035, kz], [kx0 + 0.22, SHELF_Y + 0.04, kz + 0.01], [kx0 + 0.5, SHELF_Y + 0.04, kz + 0.015]], [0.036, 0.04, 0.03], 10, 0.62);
    leather.push(flat(handle, 0x2f2118));
    const blade = plateSolid([[0, 0.028], [0.5, 0.022], [0.58, -0.02], [0.3, -0.028], [0, -0.028]].map(([x, y]) => [x, y]), [], [[0, -0.006], [0, 0.006]], { crease: 30 });
    blade.rotateX(Math.PI / 2);
    blade.translate(kx0 + 0.48, SHELF_Y + 0.036, kz + 0.018);
    metal.push(polished(blade, 0xb9bcbd, { gain: 0.95 }));
    metal.push(polished(new THREE.TorusGeometry(0.03, 0.009, 6, 12).rotateY(Math.PI / 2).translate(kx0 + 0.5, SHELF_Y + 0.04, kz + 0.016), 0xb98f3f));
  }

  // --- the goose quill, in the pot, every barb a real thing ---------------------------------------
  {
    const bottom = v3([POT_X - 0.02, SHELF_Y + 0.3, POT_Z]);
    const QL = 3.4;
    const tip = v3([POT_X - 0.72, SHELF_Y + 0.3 + QL * 0.88, POT_Z - 1.1]);
    const midA = bottom.clone().lerp(tip, 0.5).add(new THREE.Vector3(0.28, 0.02, 0.18));
    const shaftCurve = new THREE.QuadraticBezierCurve3(bottom, midA, tip);
    const shaftPts = [];
    const shaftR = [];
    for (let i = 0; i <= 44; i++) {
      const t = i / 44;
      const p = shaftCurve.getPoint(t);
      shaftPts.push(p.toArray());
      shaftR.push(lerp(0.036, 0.004, t ** 0.85));
    }
    const shaft = polyTube(shaftPts, shaftR, 8);
    feather.push(painted(shaft, () => lin(0xd4c8a4)));
    // The vanes run from 28% of the way up the quill to its tip, with a plane fixed by how the feather
    // is turned: broader on one side than the other, as a flight feather is.
    const planeHint = new THREE.Vector3(0.74, 0.18, 0.64).normalize();
    const BARBS = 110;
    const rng = seededRandom(1199);
    for (const side of [-1, 1]) {
      const reach = side > 0 ? 0.42 : 0.26;
      for (let b = 0; b < BARBS; b++) {
        const t = lerp(0.24, 0.995, b / (BARBS - 1));
        const p = shaftCurve.getPoint(t);
        const T = shaftCurve.getTangent(t);
        const across = new THREE.Vector3().crossVectors(planeHint, T).cross(T).normalize().multiplyScalar(-side);
        const f = (t - 0.24) / 0.76;
        // A leaf shape, and now and then the split a real feather has between its barbs.
        const len = reach * Math.sin(Math.min(1, f * 5.2) * Math.PI * 0.5) * (1 - f ** 3.4) ** 0.6 + 0.015;
        const split = rng() < 0.05 ? 0.012 : 0;
        const sweep = T.clone().multiplyScalar(0.62);
        const dir = across.clone().add(sweep).normalize();
        const droop = T.clone().multiplyScalar(0.1 + rng() * 0.05);
        const a = p.clone().addScaledVector(T, split);
        const c = p.clone().addScaledVector(dir, len * 0.55).addScaledVector(droop, 0.1);
        const e = p.clone().addScaledVector(dir, len).addScaledVector(droop, 0.4);
        const width = (BARBS > 1 ? shaftCurve.getLength() * 0.76 / BARBS : 0.02) * 0.78;
        const g = polyTube([a.toArray(), c.toArray(), e.toArray()], [width, width * 0.78, width * 0.16], 4, 0.28);
        const v = rng();
        // A goose's flight feather: off-white over most of it, greying to the tip. Linear values, written
        // straight into the colour attribute.
        const base = f > 0.72 ? lerp(0.62, 0.3, (f - 0.72) / 0.28) : 0.66;
        const shade = base * (0.84 + 0.22 * v);
        feather.push(painted(g, () => [shade, shade * 0.96, shade * 0.88]));
      }
    }
    // The cut nib would be under the ink; a little dark ink has climbed the barrel above the pot's mouth.
    feather.push(flat(polyTube(shaftPts.slice(0, 5), shaftR.slice(0, 5).map((r) => r + 0.001), 8), 0x1b1412));
  }

  const edgeTile = pageEdgeTile();
  const grain = grainTile({ depth: 24 });
  return group([
    mesh(mergeParts(pages).applyMatrix4(toDesk), standard({ map: manuscriptTexture(), roughness: 0.84, metalness: 0 })),
    mesh(mergeParts(edges).applyMatrix4(toDesk), standard({ map: edgeTile, roughness: 0.9, metalness: 0 })),
    mesh(mergeParts(wood), standard({ vertexColors: true, map: grain, roughness: 0.6, metalness: 0 })),
    mesh(mergeParts([...leather, { geometry: mergeParts(coverParts).applyMatrix4(toDesk), keepColor: true }]), standard({ vertexColors: true, roughness: 0.52, metalness: 0 })),
    mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.34, metalness: 0.45 })),
    mesh(mergeParts(feather), standard({ vertexColors: true, roughness: 0.72, metalness: 0 })),
  ], 'illuminated-manuscript');
}

export const BUILDERS = {
  'acoustic-guitar': acousticGuitar,
  'concert-harp': concertHarp,
  trumpet,
  sitar,
  'theatre-masks': theatreMasks,
  'globe-theatre': globeTheatre,
  'illuminated-manuscript': illuminatedManuscript,
};
