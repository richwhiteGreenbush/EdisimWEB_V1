import * as THREE from 'three';
import { standard, mesh, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts, roundedOutline, smoothNoise3 } from '../../props/LoftKit.js';
import {
  lin, mix, clamp01, sstep, alongMatrix, outward, tube, lathe, tintVertices, Sculpt, polygonize,
  sphereP, ellipsoidP, curveP, segsP, grainBump,
} from '../ModelKit.js';

// The Model Database's fifth maths-and-mechanism family: diamond and graphite, a Klein bottle, a
// tangram, a longcase pendulum clock and Zhang Heng's seismoscope.
//
// THE RULE OF THIS FILE, inherited from MathModels.js, Math3.js and Math4.js: NOTHING A STUDENT COUNTS,
// READS OR MEASURES IS DRAWN BY HAND. Each model starts from a small pure function that computes it, the
// builder draws what that function returned, and MATH5_LAYOUTS exports them so that the arithmetic can
// be checked without looking.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Private solids and printing
// ---------------------------------------------------------------------------

// Flips any triangle that disagrees with its own vertex normals. A hand-built grid should MEASURE its
// winding rather than assume it, the Turkle Street lesson.
function windToNormals(g) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const idx = g.index.array;
  const a = V(0, 0, 0); const b = V(0, 0, 0); const c = V(0, 0, 0); const e = V(0, 0, 0); const f = V(0, 0, 0);
  for (let t = 0; t < idx.length; t += 3) {
    const i = idx[t]; const j = idx[t + 1]; const k = idx[t + 2];
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); c.fromBufferAttribute(p, k);
    e.subVectors(b, a); f.subVectors(c, a);
    e.cross(f);
    const dot = e.x * (n.getX(i) + n.getX(j) + n.getX(k)) + e.y * (n.getY(i) + n.getY(j) + n.getY(k)) + e.z * (n.getZ(i) + n.getZ(j) + n.getZ(k));
    if (dot < 0) { idx[t + 1] = k; idx[t + 2] = j; }
  }
  return g;
}

function indexed(positions, normals, uvs, index, colors = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(index);
  return g;
}

// A closed flat-capped prism from an outline in XY, from z0 to z1. Caps and sides own their vertices,
// so a flat face shades flat. `holes` are outlines in the same plane.
function prism(outline, z0, z1, holes = []) {
  const positions = [];
  const uvs = [];
  const indices = [];
  let area = 0;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) area += outline[j][0] * outline[i][1] - outline[i][0] * outline[j][1];
  const pts = area < 0 ? [...outline].reverse() : outline;
  const faces = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y))));
  const flat = [...pts, ...holes.flat()];
  for (const [z, front] of [[z1, true], [z0, false]]) {
    const start = positions.length / 3;
    for (const [x, y] of flat) { positions.push(x, y, z); uvs.push(x, y); }
    for (const [a, b, c] of faces) {
      const ax = flat[a][0]; const ay = flat[a][1]; const bx = flat[b][0]; const by = flat[b][1]; const cx = flat[c][0]; const cy = flat[c][1];
      const ccw = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) >= 0;
      if (front === ccw) indices.push(start + a, start + b, start + c);
      else indices.push(start + a, start + c, start + b);
    }
  }
  const wall = (loop, outward2) => {
    let run = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const p = loop[i];
      const q = loop[(i + 1) % n];
      const step = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const at = positions.length / 3;
      positions.push(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z1);
      uvs.push(run, 0, run + step, 0, run + step, z1 - z0, run, z1 - z0);
      if (outward2) indices.push(at, at + 1, at + 2, at, at + 2, at + 3);
      else indices.push(at, at + 2, at + 1, at, at + 3, at + 2);
      run += step;
    }
  };
  wall(pts, true);
  for (const h of holes) {
    let ha = 0;
    for (let i = 0, j = h.length - 1; i < h.length; j = i++) ha += h[j][0] * h[i][1] - h[i][0] * h[j][1];
    wall(h, ha < 0);
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

const slab = (x0, y0, x1, y1, z0, z1) => prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);

// A plan outline (x, depth) stood as a prism from y0 to y1. The depth coordinate is world z.
function plate(outline, y0, y1, holes = []) {
  const g = prism(outline.map(([x, z]) => [x, -z]), y0, y1, holes.map((h) => h.map(([x, z]) => [x, -z])));
  g.rotateX(-Math.PI / 2);
  return g;
}

// A slab with rounded corners, built up a BOTTOM-UP [inset, y] profile. Each band and cap owns its
// vertices, so a flat top stays flat. UVs are in feet.
function roundedSlab(halfW, halfD, corner, profile, { steps = 5 } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const ringAt = (inset) => roundedOutline(halfW - inset, halfD - inset, Math.max(0.005, corner - inset), steps).map(([x, y]) => [x, -y]);
  const pushRing = (ring, y) => {
    const start = positions.length / 3;
    let run = 0;
    ring.forEach(([x, z], i) => {
      if (i) run += Math.hypot(x - ring[i - 1][0], z - ring[i - 1][1]);
      positions.push(x, y, z);
      uvs.push(run, y);
    });
    return start;
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const lo = ringAt(profile[i][0]);
    const hi = ringAt(profile[i + 1][0]);
    const n = lo.length;
    const a = pushRing(lo, profile[i][1]);
    const b = pushRing(hi, profile[i + 1][1]);
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      indices.push(a + j, a + j2, b + j2, a + j, b + j2, b + j);
    }
  }
  for (const [index, top] of [[0, false], [profile.length - 1, true]]) {
    const ring = ringAt(profile[index][0]);
    const y = profile[index][1];
    const start = positions.length / 3;
    for (const [x, z] of ring) {
      positions.push(x, y, z);
      uvs.push(x, z);
    }
    const centre = positions.length / 3;
    positions.push(0, y, 0);
    uvs.push(0, 0);
    for (let j = 0; j < ring.length; j++) {
      const j2 = (j + 1) % ring.length;
      if (top) indices.push(centre, start + j, start + j2);
      else indices.push(centre, start + j2, start + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return outward(g);
}

// Grain that runs through the solid: a skew projection, so the lines carry on across a cut.
function woodUV(g, su = 0.26, sv = 0.95, tilt = 0.7) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * su;
    uv[i * 2 + 1] = (p.getZ(i) + p.getY(i) * tilt) * sv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// The same idea with the grain running up the solid, for a tall case.
function uprightUV(g, su = 0.32, sv = 0.9) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getY(i) * su;
    uv[i * 2 + 1] = (p.getX(i) + p.getZ(i) * 0.6) * sv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Near-white timber grain, multiplied by the vertex colour, so one tile serves every wood in a model.
function grainMap(seed, { lines = 150, strength = 0.26, wander = 6 } = {}) {
  const rng = seededRandom(seed);
  const texture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#f6f1ea';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < lines; i++) {
      const y = rng() * h;
      const a = 0.05 + rng() * strength;
      ctx.strokeStyle = rng() < 0.72 ? `rgba(70,42,22,${a})` : `rgba(255,240,214,${a})`;
      ctx.lineWidth = 0.6 + rng() * 2.2;
      const wobble = 1 + rng() * wander;
      const phase = rng() * TAU;
      const waves = 1 + Math.floor(rng() * 2);
      for (const shift of [-h, 0, h]) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const yy = y + shift + Math.sin((x / w) * TAU * waves + phase) * wobble;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Writes `text` at the largest size up to `size` that fits `maxWidth`.
function fitText(ctx, text, x, y, maxWidth, size, family = 'Arial, Helvetica, sans-serif', weight = 'bold') {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  const wide = ctx.measureText(text).width;
  if (wide > maxWidth) {
    px = Math.floor((size * maxWidth) / wide);
    ctx.font = `${weight} ${px}px ${family}`;
  }
  ctx.fillText(text, x, y);
  return px;
}

// A flat printed rectangle anywhere, facing `normal`, with `up` the way its text reads. `rect` is one
// rectangle of an atlas in canvas pixels.
function printedQuad(centre, normal, up, w, h, rect, atlasW, atlasH) {
  const n = V(...normal).normalize();
  const side = V(...up).cross(n).normalize();
  const u = n.clone().cross(side).normalize();
  const c = V(...centre);
  const at = (sx, sy) => c.clone().addScaledVector(side, sx * w * 0.5).addScaledVector(u, sy * h * 0.5);
  const [px, py, pw, ph] = rect;
  const u0 = px / atlasW; const u1 = (px + pw) / atlasW;
  const v0 = 1 - (py + ph) / atlasH; const v1 = 1 - py / atlasH;
  const P = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
  const positions = [];
  const normals = [];
  for (const q of P) { positions.push(q.x, q.y, q.z); normals.push(n.x, n.y, n.z); }
  return indexed(positions, normals, [u0, v0, u1, v0, u1, v1, u0, v1], [0, 1, 2, 0, 2, 3]);
}

// Polished metal with no environment map: the colour a bright turned surface would pick up from a sky
// and a floor, written in by which way each vertex faces. Call it on geometry in its final place.
function polish(g, hex, { sky = 1.05, horizon = 1.34, dark = 0.34, ground = 0.74, streak = 0.34, band = 0.14 } = {}) {
  const c = lin(hex);
  const n = g.attributes.normal;
  const arr = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const x = n.getX(i); const y = n.getY(i); const z = n.getZ(i);
    const up = mix(horizon, sky, Math.pow(Math.max(0, y), 0.8));
    const down = mix(dark, ground, sstep(-y, 0.16, 0.9));
    const k0 = mix(down, up, sstep(y, -0.16, -0.04));
    const side = Math.pow(1 - Math.min(1, Math.abs(y)), 2);
    const yaw = Math.atan2(x, z);
    const wrap = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    const glint = 0.62 * Math.exp(-((wrap(yaw + 0.55) / 0.2) ** 2)) - 0.3 * Math.exp(-((wrap(yaw - 0.8) / 0.34) ** 2));
    const k = k0 * (1 + side * (streak * Math.cos(2 * yaw + 0.7) + band * Math.cos(5 * yaw + 2.1) + glint));
    arr[i * 3] = c[0] * k; arr[i * 3 + 1] = c[1] * k; arr[i * 3 + 2] = c[2] * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// A straight closed rod. `round` rows of hemisphere close each end; 0 leaves a low cone, for an end
// that is buried in something anyway.
const rod = (a, b, r, { sides = 8, round = 0 } = {}) => tube([a, b], r, { straight: true, steps: 1, sides, round });

function ball(r, at, w = 16, h = 10) {
  return new THREE.SphereGeometry(r, w, h).translate(at[0], at[1], at[2]);
}

// Stands a lathe made about +Y on any axis, about any point.
function aimed(g, at, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), V(dir[0], dir[1], dir[2]).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(V(at[0], at[1], at[2]), q, V(1, 1, 1)));
  return g;
}

// A convex plate with real thickness and a chamfered top edge. `pts` are plan points (x, z) in any
// order round the outline. Every facet owns its vertices, so the chamfer catches the light.
function bevelPlate(pts, y0, y1, bevel, gap = 0, uvOffset = [0, 0]) {
  // Counter-clockwise when seen from above, with x to the right and -z up the page.
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j][0] * -pts[i][1] - pts[i][0] * -pts[j][1];
  const ccw = area > 0 ? pts : [...pts].reverse();
  const inset = (d) => {
    const n = ccw.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = ccw[(i + n - 1) % n]; const b = ccw[i]; const c = ccw[(i + 1) % n];
      // Inward normals of the two edges meeting at b, in (x, -z).
      const e1 = [b[0] - a[0], -(b[1] - a[1])]; const e2 = [c[0] - b[0], -(c[1] - b[1])];
      const l1 = Math.hypot(e1[0], e1[1]); const l2 = Math.hypot(e2[0], e2[1]);
      const n1 = [-e1[1] / l1, e1[0] / l1]; const n2 = [-e2[1] / l2, e2[0] / l2];
      const nx = n1[0] + n2[0]; const ny = n1[1] + n2[1];
      const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      out.push([b[0] + nx * k, b[1] - ny * k]);
    }
    return out;
  };
  const lower = inset(gap);
  const upper = inset(gap + bevel);
  const n = ccw.length;
  const positions = [];
  const uvs = [];
  const index = [];
  const push = (x, y, z) => { positions.push(x, y, z); uvs.push(x * 0.25 + uvOffset[0], z * 0.25 + uvOffset[1]); return positions.length / 3 - 1; };
  const quad = (a, b, c, d) => {
    const i = push(...a); const j = push(...b); const k = push(...c); const l = push(...d);
    index.push(i, j, k, i, k, l);
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad([lower[i][0], y0, lower[i][1]], [lower[j][0], y0, lower[j][1]], [lower[j][0], y1 - bevel, lower[j][1]], [lower[i][0], y1 - bevel, lower[i][1]]);
    quad([lower[i][0], y1 - bevel, lower[i][1]], [lower[j][0], y1 - bevel, lower[j][1]], [upper[j][0], y1, upper[j][1]], [upper[i][0], y1, upper[i][1]]);
  }
  const fan = (ring, y, up) => {
    const start = positions.length / 3;
    for (const p of ring) push(p[0], y, p[1]);
    for (let i = 1; i < n - 1; i++) {
      if (up) index.push(start, start + i, start + i + 1);
      else index.push(start, start + i + 1, start + i);
    }
  };
  fan(upper, y1, true);
  fan(lower, y0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Diamond and graphite
// ---------------------------------------------------------------------------

// The true bond lengths are 1.54 and 1.42 angstroms. The two models keep that ratio, since they are
// shown side by side at one enlargement. Graphite's true layer gap is 3.35 angstroms, which at this
// scale would be 2.05ft: it is drawn closer, and the plate and the card both say so.
const DG = {
  diamondBond: 0.94,
  graphiteBond: 0.94 * (1.42 / 1.54),
  trueLayerGap: 0.94 * (3.35 / 1.54),
  layerGap: 1.28,
  atom: 0.195,
  stick: 0.05,
  stub: 0.4,
  baseW: 13,
  baseD: 7,
  baseTop: 0.46,
  diamondAt: [-3.3, -0.3],
  graphiteAt: [3.3, -0.3],
  firstAtomY: 1.42,
};

// Diamond cubic in units of a/4: one face-centred lattice is all-even with x+y+z = 0 mod 4, and the
// other is that lattice shifted by (1,1,1), so all-odd with x+y+z = 3 mod 4. An atom-centred cut out to
// radius a holds 1 + 4 + 12 + 12 + 6 = 35 atoms. Turned so a bond stands upright, the puckered hexagon
// sheets lie level, which is the comparison with graphite's flat ones.
export function diamondLayout() {
  const { diamondBond: bond } = DG;
  const unit = bond / Math.sqrt(3);
  const mod4 = (v) => ((v % 4) + 4) % 4;
  const ex = V(1, -1, 0).normalize();
  const ey = V(1, 1, 1).normalize();
  const ez = ex.clone().cross(ey).normalize();
  const place = (x, y, z) => {
    const w = V(x, y, z);
    return [w.dot(ex) * unit, w.dot(ey) * unit, w.dot(ez) * unit];
  };
  const atoms = [];
  const index = new Map();
  const isAtom = (x, y, z) => {
    const even = x % 2 === 0 && y % 2 === 0 && z % 2 === 0;
    const odd = Math.abs(x % 2) === 1 && Math.abs(y % 2) === 1 && Math.abs(z % 2) === 1;
    return (even && mod4(x + y + z) === 0) || (odd && mod4(x + y + z) === 3);
  };
  for (let x = -5; x <= 5; x++) {
    for (let y = -5; y <= 5; y++) {
      for (let z = -5; z <= 5; z++) {
        if (x * x + y * y + z * z > 16 || !isAtom(x, y, z)) continue;
        index.set(`${x},${y},${z}`, atoms.length);
        atoms.push({ lattice: [x, y, z], position: place(x, y, z), even: x % 2 === 0 });
      }
    }
  }
  const evenOffsets = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
  const bonds = [];
  const stubs = [];
  atoms.forEach((atom, i) => {
    atom.neighbours = [];
    atom.missing = [];
    for (const off of evenOffsets) {
      const s = atom.even ? 1 : -1;
      const key = `${atom.lattice[0] + s * off[0]},${atom.lattice[1] + s * off[1]},${atom.lattice[2] + s * off[2]}`;
      const dir = place(s * off[0], s * off[1], s * off[2]).map((v) => v / bond);
      if (index.has(key)) {
        const j = index.get(key);
        atom.neighbours.push(j);
        if (i < j) bonds.push([i, j]);
      } else {
        atom.missing.push(dir);
        stubs.push({ atom: i, dir });
      }
    }
  });
  return { atoms, bonds, stubs, bond };
}

// Three flat sheets of a honeycomb in ABA stacking. Each sheet is the seven-hexagon patch (24 atoms),
// and the middle one is shifted by one bond, so half its atoms sit directly over atoms of the sheet
// below and the other half over the centres of its hexagons. That shift is what ABA stacking is.
export function graphiteLayout() {
  const { graphiteBond: b, layerGap } = DG;
  const sheet = (shift) => {
    const centres = [[0, 0]];
    for (let k = 0; k < 6; k++) {
      const a = (k * TAU) / 6;
      centres.push([Math.cos(a) * b * Math.sqrt(3), Math.sin(a) * b * Math.sqrt(3)]);
    }
    const atoms = [];
    const find = (x, z) => atoms.findIndex((p) => Math.hypot(p[0] - x, p[1] - z) < 1e-6);
    for (const [cx, cz] of centres) {
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 2 + (k * TAU) / 6;
        const x = cx + Math.cos(a) * b; const z = cz + Math.sin(a) * b;
        if (find(x, z) < 0) atoms.push([x, z]);
      }
    }
    const out = atoms.map(([x, z]) => ({ plan: [x, z + shift], neighbours: [], missing: [] }));
    for (let i = 0; i < out.length; i++) {
      for (let j = 0; j < out.length; j++) {
        if (i !== j && Math.abs(Math.hypot(out[i].plan[0] - out[j].plan[0], out[i].plan[1] - out[j].plan[1]) - b) < 1e-6) out[i].neighbours.push(j);
      }
    }
    for (const atom of out) {
      // A true honeycomb atom has three bonds 120 degrees apart: anything less was cut, so the cut bond
      // is the one direction that is at 120 degrees to those it does have.
      const dirs = atom.neighbours.map((j) => [(out[j].plan[0] - atom.plan[0]) / b, (out[j].plan[1] - atom.plan[1]) / b]);
      if (dirs.length === 2) {
        const sx = dirs[0][0] + dirs[1][0]; const sz = dirs[0][1] + dirs[1][1];
        const l = Math.hypot(sx, sz);
        atom.missing.push([-sx / l, -sz / l]);
      }
    }
    return out;
  };
  const shiftA = -b / 2;
  const shiftB = b / 2;
  const layers = [
    { name: 'A', y: 0, atoms: sheet(shiftA) },
    { name: 'B', y: layerGap, atoms: sheet(shiftB) },
    { name: 'A', y: layerGap * 2, atoms: sheet(shiftA) },
  ];
  // Links between sheets go only where one atom stands directly over another.
  const links = [];
  for (let l = 0; l < 2; l++) {
    layers[l].atoms.forEach((p, i) => {
      layers[l + 1].atoms.forEach((q, j) => {
        if (Math.hypot(p.plan[0] - q.plan[0], p.plan[1] - q.plan[1]) < 1e-6) links.push({ lower: l, i, j });
      });
    });
  }
  return { layers, links, bond: b, gap: layerGap, trueGap: DG.trueLayerGap };
}

// A round brilliant, facet by facet, with each facet its own tone. A real gem's sparkle is a different
// colour in every facet and that cannot be rendered here, so it is written in.
function brilliantGem(R, at, seed) {
  const rng = seededRandom(seed);
  const crown = R * 0.42;
  const pavilion = R * 0.84;
  const ring = (r, y, a0, count) => Array.from({ length: count }, (_, k) => {
    const a = a0 + (k * TAU) / count;
    return [Math.sin(a) * r, y, Math.cos(a) * r];
  });
  const T = ring(R * 0.56, crown, 0, 8);
  const S = ring(R * 0.8, crown * 0.56, TAU / 16, 8);
  const G = ring(R, 0, 0, 16);
  const Q = ring(R * 0.34, -pavilion * 0.62, TAU / 16, 8);
  const apex = [0, -pavilion, 0];
  const top = [0, crown, 0];
  const tris = [];
  const add = (tone, ...rest) => { for (let i = 0; i < rest.length; i += 3) tris.push({ tone, p: [rest[i], rest[i + 1], rest[i + 2]] }); };
  const tableTone = 1.05;
  for (let k = 0; k < 8; k++) {
    const n = (k + 1) % 8; const p = (k + 7) % 8;
    add(tableTone, top, T[k], T[n]);
    add(0.5 + rng() * 0.9, T[k], S[k], T[n]);
    add(0.45 + rng() * 0.8, T[k], G[2 * k], S[k], T[k], S[p], G[2 * k]);
    add(0.35 + rng() * 1.0, S[k], G[2 * k], G[(2 * k + 1) % 16]);
    add(0.35 + rng() * 1.0, S[k], G[(2 * k + 1) % 16], G[(2 * k + 2) % 16]);
    add(0.3 + rng() * 0.6, G[2 * k], Q[k], G[(2 * k + 1) % 16], G[(2 * k + 1) % 16], Q[k], G[(2 * k + 2) % 16]);
    add(0.25 + rng() * 0.5, G[2 * k], apex, Q[k], G[2 * k], Q[p], apex);
  }
  const base = lin(0xb9e4f6);
  const positions = []; const normals = []; const uvs = []; const colors = []; const index = [];
  const a = V(0, 0, 0); const b = V(0, 0, 0); const c = V(0, 0, 0);
  for (const { tone, p } of tris) {
    a.set(...p[0]); b.set(...p[1]); c.set(...p[2]);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const mid = a.clone().add(b).add(c).divideScalar(3);
    // The mid-point is on the outer side of a convex solid's facet, so this measures the winding.
    const flip = n.dot(mid) < 0;
    if (flip) n.negate();
    const order = flip ? [p[0], p[2], p[1]] : p;
    const start = positions.length / 3;
    for (const q of order) {
      positions.push(q[0] + at[0], q[1] + at[1], q[2] + at[2]);
      normals.push(n.x, n.y, n.z);
      uvs.push(0, 0);
      colors.push(base[0] * tone, base[1] * tone, base[2] * tone);
    }
    index.push(start, start + 1, start + 2);
  }
  return indexed(positions, normals, uvs, index, colors);
}

function pencilParts(parts, x0, y, z, length) {
  // A hexagonal barrel lying along +X, flat side down, with its point at the +X end.
  const a = 0.078; // across the flats, halved
  const r = a / Math.cos(Math.PI / 6);
  const hex = Array.from({ length: 6 }, (_, k) => {
    const t = Math.PI / 6 + (k * TAU) / 6;
    return [Math.cos(t) * r, Math.sin(t) * r];
  });
  const barrel = length * 0.72;
  const toX = (g) => {
    // Prism is along +Z with its outline in XY: this sends its z to +x, and leaves y up.
    g.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)));
    g.translate(x0, y + a, z);
    return g;
  };
  parts.push({ geometry: toX(prism(hex, 0, barrel)), color: 0xe7ab1c });
  const axis = [1, 0, 0];
  const c = [x0 + barrel, y + a, z];
  parts.push({ geometry: aimed(lathe([[0, 0], [a * 0.98, 0], [a * 0.72, length * 0.05], [0.03, length * 0.135], [0, length * 0.135]], 18), c, axis), color: 0xd8b184 });
  parts.push({ geometry: aimed(lathe([[0, length * 0.134], [0.03, length * 0.134], [0.014, length * 0.178], [0, length * 0.186]], 12), c, axis), color: 0x2a2c30 });
  const back = [x0, y + a, z];
  parts.push({ geometry: aimed(lathe([[0, -length * 0.06], [a * 0.95, -length * 0.06], [a * 0.98, -length * 0.05], [a * 0.98, 0.012], [0, 0.012]], 18), back, axis), color: 0xc5a255 });
  parts.push({ geometry: aimed(lathe([[0, -length * 0.1], [a * 0.72, -length * 0.1], [a * 0.92, -length * 0.085], [a * 0.92, -length * 0.058], [0, -length * 0.058]], 18), back, axis), color: 0xe28a8a });
}

function diamondPlateTexture() {
  return canvasTexture(1024, 512, (ctx, w) => {
    const plateBlock = (y, title, line1, line2) => {
      ctx.fillStyle = '#efe6c8';
      ctx.fillRect(0, y, w, 128);
      ctx.strokeStyle = '#6f5a26';
      ctx.lineWidth = 5;
      ctx.strokeRect(5, y + 5, w - 10, 118);
      ctx.fillStyle = '#26221a';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      fitText(ctx, title, 34, y + 64, 400, 66, 'Georgia, "Times New Roman", serif');
      ctx.fillStyle = '#463d2b';
      fitText(ctx, line1, 450, y + 44, 545, 31, 'Arial, Helvetica, sans-serif', 'normal');
      fitText(ctx, line2, 450, y + 86, 545, 31, 'Arial, Helvetica, sans-serif', 'normal');
    };
    plateBlock(0, 'DIAMOND', 'Pure carbon, joined in a rigid', 'network running in all directions.');
    plateBlock(128, 'GRAPHITE', 'The same carbon, in flat sheets.', 'Sheets drawn closer than they really are.');
    // The sheet of paper the pencil has been writing on.
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(0, 256, 512, 256);
    const rng = seededRandom(77);
    ctx.lineCap = 'round';
    for (let row = 0; row < 5; row++) {
      ctx.strokeStyle = `rgba(52,54,60,${0.62 + rng() * 0.3})`;
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      let x = 44;
      const y = 300 + row * 40;
      ctx.moveTo(x, y);
      const end = row === 4 ? 300 : 468;
      while (x < end) {
        x += 7 + rng() * 11;
        ctx.lineTo(x, y + (rng() - 0.5) * 16);
      }
      ctx.stroke();
    }
  });
}

function buildDiamondGraphite() {
  const { atom, stick, baseTop, baseW, baseD, firstAtomY, stub, diamondAt, graphiteAt } = DG;
  const atoms = [];
  const sticks = [];
  const metal = [];
  const dark = 0x2e3138;
  const pale = 0xe8e2cd;
  const brass = 0xb79246;
  const D = diamondLayout();
  // Stand the cut on its three lowest atoms, whose fourth bond points straight down.
  const lowest = Math.min(...D.atoms.map((a) => a.position[1]));
  const yaw = 0.26;
  const cy = Math.cos(yaw); const sy = Math.sin(yaw);
  const placeD = (p) => [diamondAt[0] + p[0] * cy + p[2] * sy, p[1] - lowest + firstAtomY, diamondAt[1] - p[0] * sy + p[2] * cy];
  const turn = (d) => [d[0] * cy + d[2] * sy, d[1], -d[0] * sy + d[2] * cy];
  D.atoms.forEach((a) => atoms.push({ geometry: ball(atom, placeD(a.position)), color: dark }));
  for (const [i, j] of D.bonds) {
    sticks.push({ geometry: rod(placeD(D.atoms[i].position), placeD(D.atoms[j].position), stick), color: pale });
  }
  for (const s of D.stubs) {
    const from = placeD(D.atoms[s.atom].position);
    const d = turn(s.dir);
    const to = [from[0] + d[0] * stub, from[1] + d[1] * stub, from[2] + d[2] * stub];
    sticks.push({ geometry: rod(from, to, stick, { round: 2 }), color: pale });
    if (s.dir[1] < -0.99) {
      metal.push({ geometry: rod(to, [to[0], baseTop - 0.03, to[2]], 0.042), color: brass });
      metal.push({ geometry: lathe([[0, baseTop - 0.01], [0.13, baseTop - 0.01], [0.13, baseTop + 0.025], [0.06, baseTop + 0.06], [0.044, baseTop + 0.09], [0, baseTop + 0.09]], 16).translate(to[0], 0, to[2]), color: brass });
    }
  }

  const G = graphiteLayout();
  const placeG = (layer, plan) => [graphiteAt[0] + plan[0], firstAtomY + layer.y, graphiteAt[1] + plan[1]];
  G.layers.forEach((layer) => {
    layer.atoms.forEach((a, i) => {
      const p = placeG(layer, a.plan);
      atoms.push({ geometry: ball(atom, p), color: dark });
      for (const j of a.neighbours) {
        if (i < j) sticks.push({ geometry: rod(p, placeG(layer, layer.atoms[j].plan), stick), color: pale });
      }
      for (const m of a.missing) {
        sticks.push({ geometry: rod(p, [p[0] + m[0] * stub, p[1], p[2] + m[1] * stub], stick, { round: 2 }), color: pale });
      }
    });
  });
  // The links between sheets are a hair-thin wire with dashes on it, plainly not the sticks. The wire is
  // what is really holding the upper sheets up.
  const faint = 0x86a0b6;
  for (const link of G.links) {
    const lower = G.layers[link.lower];
    const upper = G.layers[link.lower + 1];
    const a = placeG(lower, lower.atoms[link.i].plan);
    const b = placeG(upper, upper.atoms[link.j].plan);
    metal.push({ geometry: rod(a, b, 0.011, { sides: 6 }), color: faint });
    const clear = atom + 0.05;
    const span = b[1] - a[1] - clear * 2;
    const dashes = 4;
    for (let k = 0; k < dashes; k++) {
      const y0 = a[1] + clear + (span * (k + 0.2)) / dashes;
      const y1 = a[1] + clear + (span * (k + 0.8)) / dashes;
      metal.push({ geometry: rod([a[0], y0, a[2]], [a[0], y1, a[2]], 0.028, { sides: 8, round: 1 }), color: faint });
    }
  }
  // Three posts up to the bottom sheet, under the atoms nearest three even bearings.
  const bottom = G.layers[0];
  const outer = bottom.atoms.filter((a) => Math.hypot(a.plan[0], a.plan[1] + G.bond / 2) > G.bond * 1.5);
  for (const bearing of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
    let best = outer[0];
    let bestScore = -1e9;
    for (const a of outer) {
      const score = Math.cos(Math.atan2(a.plan[1] + G.bond / 2, a.plan[0]) - bearing);
      if (score > bestScore + 1e-9) { best = a; bestScore = score; }
    }
    const p = placeG(bottom, best.plan);
    metal.push({ geometry: rod(p, [p[0], baseTop - 0.03, p[2]], 0.042), color: brass });
    metal.push({ geometry: lathe([[0, baseTop - 0.01], [0.13, baseTop - 0.01], [0.13, baseTop + 0.025], [0.06, baseTop + 0.06], [0.044, baseTop + 0.09], [0, baseTop + 0.09]], 16).translate(p[0], 0, p[2]), color: brass });
  }

  // The connection: a gem on a turned stand beside the one, a pencil and its scribble beside the other.
  const props = [];
  const gemX = diamondAt[0] + 0.05;
  const frontZ = baseD / 2 - 1.12;
  const standTop = baseTop + 0.34;
  props.push({
    geometry: lathe([[0, baseTop - 0.01], [0.26, baseTop - 0.01], [0.26, baseTop + 0.03], [0.14, baseTop + 0.08], [0.07, baseTop + 0.16], [0.07, baseTop + 0.2], [0.26, standTop - 0.03], [0.285, standTop], [0.2, standTop + 0.012], [0, standTop + 0.012]], 28).translate(gemX, 0, frontZ),
    color: brass,
  });
  const gemR = 0.34;
  props.push({ geometry: brilliantGem(gemR, [gemX, standTop + gemR * 0.44, frontZ], 19), keepColor: true });
  const pencilLen = 2.3;
  pencilParts(props, graphiteAt[0] - 1.42, baseTop + 0.004, frontZ + 0.02, pencilLen);
  const sheetCentre = [graphiteAt[0] + 1.4, baseTop + 0.012, frontZ + 0.02];
  props.push({ geometry: bevelPlate([[sheetCentre[0] - 0.56, sheetCentre[2] - 0.34], [sheetCentre[0] + 0.56, sheetCentre[2] - 0.34], [sheetCentre[0] + 0.56, sheetCentre[2] + 0.34], [sheetCentre[0] - 0.56, sheetCentre[2] + 0.34]], baseTop - 0.01, baseTop + 0.012, 0.004), color: 0xf0ebdd });

  // A long low base, its front edge sloped to carry the two plates.
  const slopeRun = 0.56;
  const base = roundedSlab(baseW / 2, baseD / 2, 0.42, [[0, 0], [0, 0.14], [slopeRun, baseTop - 0.03], [slopeRun + 0.04, baseTop]]);
  woodUV(base, 0.24, 0.9);
  const tilt = Math.atan2(baseTop - 0.03 - 0.14, slopeRun);
  const normal = [0, Math.cos(tilt), Math.sin(tilt)];
  const slopeMid = [0.14 + (baseTop - 0.03 - 0.14) / 2, baseD / 2 - slopeRun / 2];
  const plates = [];
  const plateW = 3.5; const plateH = 0.44;
  plates.push(printedQuad([diamondAt[0], slopeMid[0] + normal[1] * 0.007, slopeMid[1] + normal[2] * 0.007], normal, [0, 1, 0], plateW, plateH, [0, 0, 1024, 128], 1024, 512));
  plates.push(printedQuad([graphiteAt[0], slopeMid[0] + normal[1] * 0.007, slopeMid[1] + normal[2] * 0.007], normal, [0, 1, 0], plateW, plateH, [0, 128, 1024, 128], 1024, 512));
  plates.push(printedQuad([sheetCentre[0], baseTop + 0.015, sheetCentre[2]], [0, 1, 0], [0, 0, -1], 1.08, 0.64, [0, 256, 512, 256], 1024, 512));

  const group = new THREE.Group();
  group.add(mesh(mergeParts(atoms), standard({ vertexColors: true, roughness: 0.3, metalness: 0.08 })));
  group.add(mesh(mergeParts(sticks), standard({ vertexColors: true, roughness: 0.42, metalness: 0 })));
  group.add(mesh(mergeParts(metal), standard({ vertexColors: true, roughness: 0.46, metalness: 0.32 })));
  group.add(mesh(mergeParts(props), standard({ vertexColors: true, roughness: 0.38, metalness: 0.12 })));
  group.add(mesh(base, standard({ color: 0x70472a, map: grainMap(61), roughness: 0.55, metalness: 0 })));
  const plateMesh = mesh(mergeParts(plates.map((geometry) => ({ geometry, color: 0xffffff }))), standard({ map: diamondPlateTexture(), roughness: 0.62, metalness: 0 }));
  plateMesh.castShadow = false;
  group.add(plateMesh);
  return group;
}

// ---------------------------------------------------------------------------
// Tangram
// ---------------------------------------------------------------------------

// Seven pieces cut from one square of side 4. Each is written on one integer lattice, which is why the
// fractions come out exact rather than nearly right: the big triangles have legs of 2 root 2, and so on.
// In plan x runs right and y runs up the page, away from a student at the front of the table.
const TANGRAM_PIECES = [
  { key: 'bigA', name: 'Big triangle', fraction: [1, 4], color: 0xd9302a },
  { key: 'bigB', name: 'Big triangle', fraction: [1, 4], color: 0x2467cf },
  { key: 'medium', name: 'Medium triangle', fraction: [1, 8], color: 0xf2b41b },
  { key: 'smallA', name: 'Small triangle', fraction: [1, 16], color: 0x1f9e55 },
  { key: 'smallB', name: 'Small triangle', fraction: [1, 16], color: 0xe9701a },
  { key: 'square', name: 'Square', fraction: [1, 8], color: 0x7c3fc4 },
  { key: 'para', name: 'Parallelogram', fraction: [1, 8], color: 0x12a3b4 },
];

const TANGRAM_SQUARE = {
  bigA: [[0, 0], [4, 0], [2, 2]],
  bigB: [[0, 0], [2, 2], [0, 4]],
  medium: [[4, 4], [2, 4], [4, 2]],
  smallA: [[4, 0], [4, 2], [3, 1]],
  square: [[3, 1], [4, 2], [3, 3], [2, 2]],
  smallB: [[2, 2], [3, 3], [1, 3]],
  para: [[0, 4], [1, 3], [3, 3], [2, 4]],
};

// A sitting cat, facing right: chest and back from the two big triangles, the medium as its shoulder,
// the square its head, two small triangles its ears, and the parallelogram its tail held up.
const TANGRAM_CAT = {
  bigA: [[4, 4], [4, 0], [2, 2]],
  bigB: [[4, 0], [2, 2], [0, 0]],
  medium: [[4, 4], [2, 2], [2, 4]],
  square: [[3, 4], [4, 5], [3, 6], [2, 5]],
  smallA: [[2, 5], [3, 6], [2, 7]],
  smallB: [[4, 5], [3, 6], [4, 7]],
  para: [[0, 0], [1, 1], [1, 3], [0, 2]],
};

// A sailboat, 4ft wide and 7ft tall. A big triangle is the hull, the other big one the mainsail with the
// two small triangles filling in under it, the medium and the parallelogram the sail ahead of the mast,
// and the square a flag at the masthead. The mast is the straight line where the sails meet.
const TANGRAM_BOAT = {
  bigA: [[0, 2], [4, 2], [2, 0]],
  bigB: [[2, 2], [2, 6], [4, 4]],
  smallA: [[2, 2], [4, 2], [3, 3]],
  smallB: [[3, 3], [4, 2], [4, 4]],
  medium: [[0, 2], [2, 2], [2, 4]],
  para: [[2, 4], [1, 3], [1, 5], [2, 6]],
  square: [[2, 6], [3, 5], [4, 6], [3, 7]],
};

const polyArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
};

const TG = {
  tableW: 12,
  tableD: 8.2,
  top: 1.75,
  recess: 0.2,
  pieceH: 0.18,
  bevel: 0.035,
  gap: 0.011,
};

// Where each set lies on the table, all three at the same 4ft size. The tray sits at the back left; the
// cat's head stands just clear of it, with the cat's body and raised tail running under the tray's front
// edge; the boat fills the right. It is that interlock which lets three 4ft sets share a 12ft table.
export function tangramLayout() {
  const trayInner = 4.06;
  const tray = { x0: -5.28, z0: -3.75, size: trayInner };
  tray.frame = 0.17;
  const trayRight = tray.x0 + trayInner + tray.frame;
  const trayFront = tray.z0 + trayInner + tray.frame;
  const catFloor = 3.72;
  const cat = { x: trayRight + 0.24 - 2, z: catFloor };
  const boat = { x: cat.x + 4 + 0.36, z: catFloor };
  const toWorld = (place, [px, py]) => [place.x + px, place.z - py];
  const trayPlace = { x: tray.x0 + 0.03, z: tray.z0 + trayInner - 0.03 };
  const sets = {
    square: { place: trayPlace, plan: TANGRAM_SQUARE },
    cat: { place: cat, plan: TANGRAM_CAT },
    boat: { place: boat, plan: TANGRAM_BOAT },
  };
  const out = { tray, trayRight, trayFront, sets: {}, plaque: { x0: tray.x0 - tray.frame, x1: cat.x - 0.26, z0: trayFront + 0.26, z1: catFloor + 0.04 } };
  for (const [name, set] of Object.entries(sets)) {
    out.sets[name] = TANGRAM_PIECES.map((piece) => ({
      ...piece,
      plan: set.plan[piece.key],
      world: set.plan[piece.key].map((p) => toWorld(set.place, p)),
      area: polyArea(set.plan[piece.key]),
    }));
  }
  return out;
}

function tangramPlaqueTexture() {
  return canvasTexture(768, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#f2ead4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6d5a2c';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#2b2416';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'ONE SQUARE, SEVEN PIECES', w / 2, 74, w - 96, 50, 'Georgia, "Times New Roman", serif');
    const rowH = 104;
    const top = 136;
    const shapes = {
      bigA: TANGRAM_SQUARE.bigA, bigB: TANGRAM_SQUARE.bigB, medium: TANGRAM_SQUARE.medium, smallA: TANGRAM_SQUARE.smallA, smallB: TANGRAM_SQUARE.smallB, square: TANGRAM_SQUARE.square, para: TANGRAM_SQUARE.para,
    };
    TANGRAM_PIECES.forEach((piece, i) => {
      const y = top + i * rowH;
      const pts = shapes[piece.key];
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      // True relative sizes: every swatch is drawn at one scale.
      const k = 27;
      ctx.fillStyle = `#${piece.color.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      pts.forEach((p, j) => {
        const px = 112 + (p[0] - cx) * k;
        const py = y + 46 - (p[1] - cy) * k;
        if (j === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2b2416';
      ctx.textAlign = 'left';
      fitText(ctx, piece.name, 214, y + 46, 330, 42, 'Arial, Helvetica, sans-serif', 'normal');
      ctx.textAlign = 'right';
      fitText(ctx, `${piece.fraction[0]}/${piece.fraction[1]}`, w - 62, y + 46, 130, 56, 'Georgia, "Times New Roman", serif');
    });
    ctx.fillStyle = '#6d5a2c';
    ctx.fillRect(56, top + 7 * rowH + 2, w - 112, 4);
    ctx.fillStyle = '#2b2416';
    ctx.textAlign = 'center';
    fitText(ctx, '1/4 + 1/4 + 1/8 + 1/16 + 1/16 + 1/8 + 1/8 = 1', w / 2, top + 7 * rowH + 56, w - 96, 38, 'Arial, Helvetica, sans-serif');
    fitText(ctx, 'Rearrange them all: the area stays the same.', w / 2, top + 7 * rowH + 108, w - 96, 32, 'Arial, Helvetica, sans-serif', 'normal');
  });
}

function buildTangram() {
  const L = tangramLayout();
  const { tableW, tableD, top, recess, pieceH, bevel, gap } = TG;
  const pieces = [];
  const rng = seededRandom(23);
  const floorY = top - recess + 0.012;
  for (const [name, set] of Object.entries(L.sets)) {
    const y0 = name === 'square' ? floorY : top;
    const y1 = y0 + pieceH;
    for (const piece of set) {
      pieces.push({ geometry: bevelPlate(piece.world, y0, y1, bevel, gap, [rng(), rng()]), color: piece.color });
    }
  }

  // The table. Its upper layer is a real plate with a real square hole, so the tray is a recess.
  const wood = [];
  const hw = tableW / 2; const hd = tableD / 2;
  const { tray } = L;
  const hole = [[tray.x0, tray.z0], [tray.x0, tray.z0 + tray.size], [tray.x0 + tray.size, tray.z0 + tray.size], [tray.x0 + tray.size, tray.z0]];
  const outline = roundedOutline(hw - 0.05, hd - 0.05, 0.3, 5).map(([x, y]) => [x, -y]);
  wood.push({ geometry: woodUV(plate(outline, top - recess, top - 0.04, [hole]), 0.14, 0.72), color: 0x6b4427 });
  // A chamfered edge round the top, in a band of its own so the plate can be pierced.
  wood.push({ geometry: woodUV(plate(outline, top - 0.04, top, [hole]), 0.14, 0.72), color: 0x6b4427 });
  wood.push({ geometry: woodUV(roundedSlab(hw, hd, 0.34, [[0.22, top - recess - 0.2], [0.04, top - recess - 0.12], [0, top - recess - 0.05], [0, top - recess]]), 0.14, 0.72), color: 0x5a371f });
  const apronY0 = top - recess - 0.56;
  const apronY1 = top - recess - 0.16;
  const inset = 0.5;
  wood.push({ geometry: woodUV(slab(-hw + inset, apronY0, hw - inset, apronY1, hd - inset - 0.14, hd - inset)), color: 0x5a371f });
  wood.push({ geometry: woodUV(slab(-hw + inset, apronY0, hw - inset, apronY1, -hd + inset, -hd + inset + 0.14)), color: 0x5a371f });
  for (const s of [-1, 1]) {
    const g = prism([[-hd + inset, apronY0], [hd - inset, apronY0], [hd - inset, apronY1], [-hd + inset, apronY1]], s * (hw - inset) - 0.07, s * (hw - inset) + 0.07);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)));
    wood.push({ geometry: woodUV(outward(g)), color: 0x5a371f });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = lathe([
        [0, 0], [0.17, 0], [0.2, 0.05], [0.17, 0.14], [0.11, 0.3], [0.13, 0.42], [0.11, 0.48], [0.16, 0.56], [0.19, 0.62],
        [0.19, top - recess - 0.56], [0.19, top - recess - 0.12], [0, top - recess - 0.12],
      ], 20);
      leg.translate(sx * (hw - inset - 0.07), 0, sz * (hd - inset - 0.07));
      wood.push({ geometry: uprightUV(leg), color: 0x54331c });
    }
  }
  const woodMesh = mesh(mergeParts(wood), standard({ vertexColors: true, map: grainMap(37), roughness: 0.5, metalness: 0 }));

  const trim = [];
  const fx0 = tray.x0 - tray.frame; const fz0 = tray.z0 - tray.frame; const fs = tray.size + tray.frame * 2;
  trim.push({ geometry: plate([[fx0, fz0], [fx0 + fs, fz0], [fx0 + fs, fz0 + fs], [fx0, fz0 + fs]], top - 0.01, top + 0.026, [hole]), color: 0xbd9747 });
  trim.push({ geometry: plate(hole, top - recess, top - recess + 0.012), color: 0x1d3a35 });
  // A thin line of stringing inlaid round the top, the kind of detail a good table carries.
  {
    const e = 0.11;
    const ring = roundedOutline(hw - e, hd - e, 0.22, 4).map(([x, y]) => [x, -y]);
    const inner = roundedOutline(hw - e - 0.035, hd - e - 0.035, 0.2, 4).map(([x, y]) => [x, -y]);
    trim.push({ geometry: plate(ring, top - 0.01, top + 0.002, [inner]), color: 0xd9bf7c });
  }

  const { plaque } = L;
  const pW = plaque.x1 - plaque.x0;
  const pD = plaque.z1 - plaque.z0;
  const cx = (plaque.x0 + plaque.x1) / 2;
  const cz = (plaque.z0 + plaque.z1) / 2;
  const body = bevelPlate([[plaque.x0, plaque.z0], [plaque.x1, plaque.z0], [plaque.x1, plaque.z1], [plaque.x0, plaque.z1]], top, top + 0.05, 0.012);
  trim.push({ geometry: body, color: 0x8e6f2f });
  const printed = mesh(printedQuad([cx, top + 0.054, cz], [0, 1, 0], [0, 0, -1], pW - 0.05, pD - 0.05, [0, 0, 768, 1024], 768, 1024), standard({ map: tangramPlaqueTexture(), roughness: 0.65, metalness: 0 }));
  printed.castShadow = false;

  const group = new THREE.Group();
  group.add(mesh(mergeParts(pieces), standard({ vertexColors: true, map: grainMap(53, { lines: 70, strength: 0.045, wander: 2 }), roughness: 0.42, metalness: 0 })));
  group.add(woodMesh);
  group.add(mesh(mergeParts(trim), standard({ vertexColors: true, roughness: 0.62, metalness: 0.14 })));
  group.add(printed);
  return group;
}

// ---------------------------------------------------------------------------
// Klein bottle
// ---------------------------------------------------------------------------

// A circle swept along a closed path, with its radius changing along the way. Every station is
// (x, y, radius), and that closed curve is the whole surface. The path starts at the rim on the base,
// climbs the bulb, narrows into the neck, arcs over, comes down outside, passes in through the bulb's
// wall, runs down the axis and flares back out to that same rim.
//
// WHAT MAKES IT A KLEIN BOTTLE AND NOT A TORUS IS THE LAST STEP. The path arrives at the rim travelling
// DOWN and left it travelling UP, so the circle comes back to itself reflected: theta at the end is pi
// minus theta at the start. A surface that closes with a reflection has no inside or outside.
const KB = {
  x0: -0.72,
  rows: 300,
  sides: 64,
  chevrons: 46,
  stations: [
    [0, 0.42, 0.8], [0, 0.46, 1.02], [0, 0.64, 1.32], [0, 1.02, 1.64], [0, 1.62, 1.84], [0, 2.3, 1.86],
    [0, 2.98, 1.68], [0, 3.58, 1.28], [0, 4.1, 0.84], [0, 4.6, 0.55], [0, 5.08, 0.43], [0, 5.5, 0.39],
    [0.08, 5.92, 0.37], [0.48, 6.3, 0.36], [1.12, 6.47, 0.36], [1.84, 6.3, 0.36], [2.48, 5.78, 0.36],
    [2.84, 5.02, 0.36], [2.92, 4.2, 0.36], [2.76, 3.42, 0.36], [2.32, 2.84, 0.36], [1.72, 2.44, 0.36],
    [1.08, 2.08, 0.36], [0.46, 1.72, 0.36], [0.07, 1.34, 0.37], [0, 1.0, 0.4], [0, 0.74, 0.47], [0, 0.56, 0.58], [0, 0.46, 0.68],
  ],
};

export function kleinLayout() {
  const { x0, rows: n, sides: ns, stations } = KB;
  const curve = new THREE.CatmullRomCurve3(stations.map(([x, y, r]) => V(x0 + x, y, r)), true, 'centripetal');
  curve.arcLengthDivisions = 3000;
  const pts = curve.getSpacedPoints(n);
  // The apex of the arc divides "going up" from "coming down" in the straight runs on the axis.
  const half = pts.reduce((best, p, i) => (p.y > pts[best].y ? i : best), 0);
  const frame = [];
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    const onAxis = Math.abs(pts[i].x - x0) < 1e-4;
    let nx; let ny;
    if (onAxis || l < 1e-6) { nx = i < half ? 1 : -1; ny = 0; } else { nx = dy / l; ny = -dx / l; }
    frame.push({ c: [pts[i].x, pts[i].y], r: pts[i].z, nx, ny });
  }
  const totalLength = curve.getLength();
  // The surface as a function, wrapped with the reflection that makes it what it is.
  const at = (rowF, theta) => {
    let row = rowF;
    let th = theta;
    while (row < 0) { row += n; th = Math.PI - th; }
    while (row >= n) { row -= n; th = Math.PI - th; }
    const i = Math.floor(row);
    const f = row - i;
    const A = frame[i];
    let B = frame[(i + 1) % n];
    let thB = th;
    if (i + 1 === n) thB = Math.PI - th;
    B = { ...B };
    const cA = Math.cos(th); const sA = Math.sin(th);
    const cB = Math.cos(thB); const sB = Math.sin(thB);
    const ax = A.c[0] + A.r * cA * A.nx; const ay = A.c[1] + A.r * cA * A.ny; const az = A.r * sA;
    const bx = B.c[0] + B.r * cB * B.nx; const by = B.c[1] + B.r * cB * B.ny; const bz = B.r * sB;
    return [ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f];
  };
  // The bulb as a radius at a height, from the rows that climb it, for finding where the neck goes in.
  const climb = [];
  for (let i = 0; i < half; i++) {
    if (frame[i].nx === 1 && (climb.length === 0 || frame[i].c[1] > climb[climb.length - 1][0])) climb.push([frame[i].c[1], frame[i].r]);
  }
  const bulbR = (y) => {
    if (y <= climb[0][0]) return 0;
    for (let i = 1; i < climb.length; i++) {
      if (y <= climb[i][0]) {
        const t = (y - climb[i - 1][0]) / (climb[i][0] - climb[i - 1][0]);
        return climb[i - 1][1] + (climb[i][1] - climb[i - 1][1]) * t;
      }
    }
    return 0;
  };
  const inside = (p) => Math.hypot(p[0] - x0, p[2]) - bulbR(p[1]);
  // The neck crosses the wall once, for every theta, and the crossings make one closed curve.
  const lo = half + Math.round((n - half) * 0.2);
  const hi = n - Math.round(n * 0.03);
  const crossing = [];
  for (let j = 0; j < ns; j++) {
    const th = (j / ns) * TAU;
    const hits = [];
    for (let i = lo; i < hi; i++) {
      const f0 = inside(at(i, th));
      const f1 = inside(at(i + 1, th));
      if (f0 > 0 && f1 <= 0) {
        let a = i; let b = i + 1;
        for (let it = 0; it < 30; it++) {
          const m = (a + b) / 2;
          if (inside(at(m, th)) > 0) a = m; else b = m;
        }
        hits.push((a + b) / 2);
      }
    }
    crossing.push({ theta: th, hits });
  }
  return { frame, rows: n, sides: ns, half, totalLength, at, crossing, bulbR, x0 };
}

function kleinSurface(L) {
  const { rows: n, sides: ns, frame } = L;
  const positions = new Float32Array((n + 1) * ns * 3);
  const put = (i, j, p) => { const o = (i * ns + j) * 3; positions[o] = p[0]; positions[o + 1] = p[1]; positions[o + 2] = p[2]; };
  for (let i = 0; i < n; i++) {
    const { c, r, nx, ny } = frame[i];
    for (let j = 0; j < ns; j++) {
      const th = (j / ns) * TAU;
      put(i, j, [c[0] + r * Math.cos(th) * nx, c[1] + r * Math.cos(th) * ny, r * Math.sin(th)]);
    }
  }
  // The last row is the first row again, read with the reflection, so the surface closes on exact
  // positions. It keeps its own vertices because the two sides of that join carry opposite normals.
  const mapJ = (j) => (((ns / 2 - j) % ns) + ns) % ns;
  for (let j = 0; j < ns; j++) {
    const o = mapJ(j) * 3;
    put(n, j, [positions[o], positions[o + 1], positions[o + 2]]);
  }
  const P = (i, j) => {
    let row = i; let col = ((j % ns) + ns) % ns;
    if (row < 0) { row += n; col = mapJ(col); }
    if (row > n) { row -= n; col = mapJ(col); }
    const o = (row * ns + col) * 3;
    return V(positions[o], positions[o + 1], positions[o + 2]);
  };
  const normals = new Float32Array((n + 1) * ns * 3);
  const uvs = new Float32Array((n + 1) * ns * 2);
  const colors = new Float32Array((n + 1) * ns * 3);
  const glass = lin(0xa9e6dc);
  const deep = lin(0x5fbcb6);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j < ns; j++) {
      const dt = P(i + 1, j).sub(P(i - 1, j));
      const dth = P(i, j + 1).sub(P(i, j - 1));
      const nrm = dt.cross(dth);
      if (nrm.lengthSq() < 1e-14) nrm.set(1, 0, 0);
      nrm.normalize();
      const o = (i * ns + j);
      normals[o * 3] = nrm.x; normals[o * 3 + 1] = nrm.y; normals[o * 3 + 2] = nrm.z;
      uvs[o * 2] = j / ns; uvs[o * 2 + 1] = i / n;
      const y = positions[o * 3 + 1];
      const t = 0.25 + 0.5 * sstep(y, 0.4, 2.2) * (1 - sstep(y, 4.4, 6)) ;
      colors[o * 3] = mix(deep[0], glass[0], t); colors[o * 3 + 1] = mix(deep[1], glass[1], t); colors[o * 3 + 2] = mix(deep[2], glass[2], t);
    }
  }
  const index = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < ns; j++) {
      const j2 = (j + 1) % ns;
      const a = i * ns + j; const b = (i + 1) * ns + j; const c = (i + 1) * ns + j2; const d = i * ns + j2;
      index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(index);
  return windToNormals(g);
}

// One chevron standing in the surface, pointing along the path. It is a thin closed solid that passes
// through the glass, so it shows on both faces, which is the point of a surface with one side.
function kleinChevron(L, row, theta, { half = 0.17, sweep = 0.19, band = 0.075, lift = 0.014 } = {}) {
  const ds = L.totalLength / L.rows;
  const na = 10;
  const nb = 2;
  const normalAt = (r, th) => {
    const e = 0.5; const et = 0.03;
    const a = V(...L.at(r + e, th)).sub(V(...L.at(r - e, th)));
    const b = V(...L.at(r, th + et)).sub(V(...L.at(r, th - et)));
    return a.cross(b).normalize();
  };
  const positions = [];
  const point = (ia, ib, side) => {
    const a = (ia / na) * 2 - 1;
    const b = ib / nb;
    const rHere = Math.max(0.2, Math.hypot(L.at(row, theta)[2], 0));
    const along = row - (Math.abs(a) * sweep) / ds - (b * band * 2 - band) / ds;
    // Wrap round the local circle by arc length, however wide the section is here.
    const radius = (() => {
      const p = L.at(along, Math.PI / 2);
      const q = L.at(along, -Math.PI / 2);
      return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) / 2 || rHere;
    })();
    const th = theta + (a * half) / radius;
    const p = L.at(along, th);
    const nrm = normalAt(along, th);
    return [p[0] + nrm.x * lift * side, p[1] + nrm.y * lift * side, p[2] + nrm.z * lift * side];
  };
  const rowsN = (na + 1) * (nb + 1);
  for (const side of [1, -1]) {
    for (let ib = 0; ib <= nb; ib++) {
      for (let ia = 0; ia <= na; ia++) positions.push(...point(ia, ib, side));
    }
  }
  const id = (side, ia, ib) => (side === 1 ? 0 : rowsN) + ib * (na + 1) + ia;
  const index = [];
  for (let ib = 0; ib < nb; ib++) {
    for (let ia = 0; ia < na; ia++) {
      index.push(id(1, ia, ib), id(1, ia + 1, ib), id(1, ia + 1, ib + 1), id(1, ia, ib), id(1, ia + 1, ib + 1), id(1, ia, ib + 1));
      index.push(id(-1, ia, ib), id(-1, ia + 1, ib + 1), id(-1, ia + 1, ib), id(-1, ia, ib), id(-1, ia, ib + 1), id(-1, ia + 1, ib + 1));
    }
  }
  const rim = [];
  for (let ia = 0; ia < na; ia++) rim.push([ia, 0, ia + 1, 0]);
  for (let ib = 0; ib < nb; ib++) rim.push([na, ib, na, ib + 1]);
  for (let ia = na; ia > 0; ia--) rim.push([ia, nb, ia - 1, nb]);
  for (let ib = nb; ib > 0; ib--) rim.push([0, ib, 0, ib - 1]);
  for (const [a0, b0, a1, b1] of rim) {
    index.push(id(1, a0, b0), id(-1, a0, b0), id(-1, a1, b1), id(1, a0, b0), id(-1, a1, b1), id(1, a1, b1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

function kleinPlateTexture() {
  return canvasTexture(1024, 192, (ctx, w, h) => {
    ctx.fillStyle = '#ece3c6';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#6e5a29';
    ctx.lineWidth = 7;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.fillStyle = '#2a2417';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fitText(ctx, 'KLEIN BOTTLE', w / 2, 62, w - 90, 64, 'Georgia, "Times New Roman", serif');
    fitText(ctx, 'Follow the arrows from the blue one. There is no inside and no outside.', w / 2, 136, w - 90, 34, 'Arial, Helvetica, sans-serif', 'normal');
  });
}

function buildKlein() {
  const L = kleinLayout();
  const { rows: n, chevrons, x0 } = { ...L, ...KB };
  const glass = mesh(kleinSurface(L), standard({
    vertexColors: true, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.46, side: THREE.DoubleSide, depthWrite: false,
  }));
  glass.castShadow = false;
  glass.receiveShadow = false;

  const opaque = [];
  // The path is theta = pi/2, the front of every section: the reflection sends pi/2 to itself, so this
  // one line closes up after a single lap, travelling the way the path travels.
  const startK = 7;
  for (let k = 0; k < chevrons; k++) {
    const row = ((k + 0.5) / chevrons) * n;
    opaque.push({ geometry: kleinChevron(L, row, Math.PI / 2), color: k === startK ? 0x1f49d8 : 0xee5d17 });
  }
  // The joint where the neck passes through the wall, drawn as the thin fused line it would be in glass.
  const ring = [];
  for (const { theta, hits } of L.crossing) {
    if (hits.length) ring.push(L.at(hits[0], theta));
  }
  ring.push(ring[0]);
  opaque.push({ geometry: tube(ring, 0.024, { sides: 8, steps: ring.length * 2, round: 1 }), color: 0xd8f5ee });

  // The stand, and the brass collar the rim sits in.
  const stand = [];
  const standH = 0.34;
  const base = roundedSlab(2.95, 2.3, 1.9, [[0, 0], [0, 0.1], [0.24, standH - 0.03], [0.28, standH]], { steps: 10 });
  woodUV(base, 0.24, 0.9);
  stand.push({ geometry: base, color: 0x5c3a22 });
  const collar = [];
  collar.push({
    geometry: lathe([[0, standH - 0.01], [1.12, standH - 0.01], [1.14, standH + 0.03], [1.08, standH + 0.06], [0.98, standH + 0.1], [0.84, standH + 0.1], [0.74, standH + 0.08], [0.6, standH + 0.03], [0, standH + 0.02]], 56).translate(x0, 0, 0),
    color: 0xc19c4e,
  });

  const slope = Math.atan2(standH - 0.03 - 0.1, 0.24);
  const normal = [0, Math.cos(slope), Math.sin(slope)];
  const plaque = mesh(
    printedQuad([0, (0.1 + standH - 0.03) / 2 + normal[1] * 0.006, 2.3 - 0.12 + normal[2] * 0.006], normal, [0, 1, 0], 2.4, 0.23, [0, 0, 1024, 192], 1024, 192),
    standard({ map: kleinPlateTexture(), roughness: 0.6, metalness: 0 }),
  );
  plaque.castShadow = false;

  const group = new THREE.Group();
  group.add(mesh(mergeParts(stand), standard({ vertexColors: true, map: grainMap(29), roughness: 0.5, metalness: 0 })));
  group.add(mesh(mergeParts(collar), standard({ vertexColors: true, roughness: 0.42, metalness: 0.35 })));
  const marks = mesh(mergeParts(opaque), standard({ vertexColors: true, roughness: 0.42, metalness: 0 }));
  // Glass throws no shadow here, so arrows that did would hang their shadow on nothing.
  marks.castShadow = false;
  group.add(marks);
  group.add(plaque);
  group.add(glass);
  return group;
}

// ---------------------------------------------------------------------------
// Longcase pendulum clock
// ---------------------------------------------------------------------------

// The going train is a true one. A seconds pendulum beats once a second, and a 30-tooth escape wheel
// gives one tooth every two beats, so the escape wheel turns once a minute. 48/6 x 45/6 = 60 takes that
// to one turn an hour at the centre arbor, and 48/6 again gives the great wheel one turn in eight hours.
// The teeth are coarser than a real clock's (which would be under a pixel from where a student stands)
// and the counts are lower for the same reason; the ratios are what the clock needs.
//
// The movement stands in the top of the waist rather than behind the dial, so that a student can see it,
// and a rod up the back of the case drives the hands, which is how a tower clock does it. The card and
// the report both say so.
const CK = {
  module: 0.014,
  secondsPendulumInches: 39.1,
  plateZ: [-0.03, 0],
  layer: { barrel: 0.07, z1: 0.155, z2: 0.205, z3: 0.255, z4: 0.305, fly: 0.365, spine: 0.4 },
  escapeTeeth: 30,
  escapeR: 0.27,
  escapeRoot: 0.84,
  pendulumZ: -0.22,
  pivotY: 5.16,
  dialY: 5.98,
  time: { great: 48, centrePinion: 6, centre: 48, thirdPinion: 6, third: 45, escapePinion: 6 },
  strike: { great: 48, secondPinion: 6, second: 36, flyPinion: 6 },
};

function clockGearOutline(N, m, pinion = false) {
  const rp = (N * m) / 2;
  const add = (pinion ? 0.62 : 1.0) * m;
  const ded = (pinion ? 1.42 : 1.16) * m;
  const half = (pinion ? 0.17 : 0.23) * Math.PI * m;
  const rr = rp - ded;
  const ra = rp + add;
  const flank = [[rr, half * 1.14], [rp - ded * 0.5, half * 1.06], [rp, half], [rp + add * 0.5, half * 0.8], [rp + add * 0.82, half * 0.48]];
  const step = TAU / N;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const c = k * step;
    pts.push([Math.cos(c - step / 2) * rr, Math.sin(c - step / 2) * rr]);
    for (const [r, h] of flank) { const a = c - h / r; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    pts.push([Math.cos(c) * ra, Math.sin(c) * ra]);
    for (let i = flank.length - 1; i >= 0; i--) { const [r, h] = flank[i]; const a = c + h / r; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  }
  return { pts, rp, rr, ra };
}

// Four windows between crossed spokes, the way a clock wheel is cut.
function spokeWindows(rimR, hubR, spokeW, spokes = 4, turn = 0.4) {
  const out = [];
  const dO = spokeW / rimR;
  const dI = (spokeW * 1.1) / hubR;
  for (let s = 0; s < spokes; s++) {
    const a0 = turn + (s * TAU) / spokes;
    const a1 = turn + ((s + 1) * TAU) / spokes;
    const loop = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) { const a = mix(a0 + dO, a1 - dO, i / steps); loop.push([Math.cos(a) * rimR, Math.sin(a) * rimR]); }
    for (let i = 4; i >= 0; i--) { const a = mix(a0 + dI, a1 - dI, i / 4); loop.push([Math.cos(a) * hubR, Math.sin(a) * hubR]); }
    out.push(loop);
  }
  return out;
}

// A tip at each tooth, a long curved back behind it, and a steep leading face. The wheel turns clockwise
// seen from the front, so "ahead" is toward smaller polar angles.
function escapeOutline(N, R, rootR, tip0) {
  const step = TAU / N;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const t = tip0 + k * step;
    pts.push([Math.cos(t) * R, Math.sin(t) * R]);
    for (const [f, h] of [[0.28, 0.42], [0.56, 0.72], [0.82, 0.94]]) {
      const a = t + f * step;
      const r = R - (R - rootR) * h;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const a = t + 1.04 * step; // past the next tip: the leading face is undercut
    pts.push([Math.cos(a) * rootR, Math.sin(a) * rootR]);
  }
  return pts;
}

export function clockLayout() {
  const { module: m, time, strike, escapeR: R, escapeTeeth: NE } = CK;
  const dist = (a, b) => (m * (a + b)) / 2;
  const toward = (from, bearing, d) => [from[0] + Math.cos(bearing) * d, from[1] + Math.sin(bearing) * d];
  const GC = dist(time.great, time.centrePinion);
  const CT = dist(time.centre, time.thirdPinion);
  const TE = dist(time.third, time.escapePinion);
  const great = [-0.36, 3.86];
  const centre = [0, great[1] + Math.sqrt(GC * GC - 0.36 * 0.36)];
  const tx = 0.2;
  const third = [tx, centre[1] + Math.sqrt(CT * CT - tx * tx)];
  const escape = [0, third[1] + Math.sqrt(TE * TE - tx * tx)];
  // The anchor spans seven and a half teeth, 90 degrees of the wheel, so each pallet meets the wheel 45
  // degrees from the top, and the pivot stands where the tangents from those two points cross.
  const beta = Math.PI / 4;
  const anchor = [0, escape[1] + R / Math.cos(beta)];

  const strikeGreat = [0.36, great[1] - 0.04];
  const SS = dist(strike.great, strike.secondPinion);
  const second = toward(strikeGreat, THREE.MathUtils.degToRad(82), SS);
  const SF = dist(strike.second, strike.flyPinion);
  const fly = toward(second, THREE.MathUtils.degToRad(70), SF);

  // Phase: if a wheel's nearest tooth is a teeth away from the line of centres, the mate must look back
  // along that line with its gap there. Turning one by delta turns the other by -delta N1/N2, so this
  // holds at every moment, not only at the one drawn.
  const pairPhase = (phaseA, NA, NB, bearing) => {
    const stepA = TAU / NA; const stepB = TAU / NB;
    const a = (bearing - phaseA) / stepA;
    return bearing + Math.PI - (0.5 - a) * stepB;
  };
  const bear = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
  const gears = [];
  const greatPhase = 0.11;
  gears.push({ id: 'great', at: great, N: time.great, phase: greatPhase, z: 'z1' });
  const centrePinionPhase = pairPhase(greatPhase, time.great, time.centrePinion, bear(great, centre));
  gears.push({ id: 'centrePinion', at: centre, N: time.centrePinion, phase: centrePinionPhase, z: 'z1', pinion: true, mateOf: 'great' });
  const centrePhase = 0.07;
  gears.push({ id: 'centre', at: centre, N: time.centre, phase: centrePhase, z: 'z2' });
  const thirdPinionPhase = pairPhase(centrePhase, time.centre, time.thirdPinion, bear(centre, third));
  gears.push({ id: 'thirdPinion', at: third, N: time.thirdPinion, phase: thirdPinionPhase, z: 'z2', pinion: true, mateOf: 'centre' });
  const thirdPhase = 0.03;
  gears.push({ id: 'third', at: third, N: time.third, phase: thirdPhase, z: 'z3' });
  const escapePinionPhase = pairPhase(thirdPhase, time.third, time.escapePinion, bear(third, escape));
  gears.push({ id: 'escapePinion', at: escape, N: time.escapePinion, phase: escapePinionPhase, z: 'z3', pinion: true, mateOf: 'third' });

  const strikePhase = 0.02;
  gears.push({ id: 'strikeGreat', at: strikeGreat, N: strike.great, phase: strikePhase, z: 'z1' });
  const secondPinionPhase = pairPhase(strikePhase, strike.great, strike.secondPinion, bear(strikeGreat, second));
  gears.push({ id: 'secondPinion', at: second, N: strike.secondPinion, phase: secondPinionPhase, z: 'z1', pinion: true, mateOf: 'strikeGreat' });
  const secondPhase = 0.05;
  gears.push({ id: 'second', at: second, N: strike.second, phase: secondPhase, z: 'z4' });
  const flyPinionPhase = pairPhase(secondPhase, strike.second, strike.flyPinion, bear(second, fly));
  gears.push({ id: 'flyPinion', at: fly, N: strike.flyPinion, phase: flyPinionPhase, z: 'z4', pinion: true, mateOf: 'second' });

  // The escapement. One tip rests on the entry pallet at 135 degrees. Seven and a half teeth round from
  // it is the exit pallet at 45 degrees, in the middle of a gap.
  const tip0 = Math.PI / 2 + beta;
  const contactL = [escape[0] + Math.cos(tip0) * R, escape[1] + Math.sin(tip0) * R];
  const exitAngle = Math.PI / 2 - beta;
  const contactR = [escape[0] + Math.cos(exitAngle) * R, escape[1] + Math.sin(exitAngle) * R];
  const pendulumLength = (CK.secondsPendulumInches / 12);
  const bobY = CK.pivotY - pendulumLength;
  const ratios = {
    centreToEscape: (time.centre / time.thirdPinion) * (time.third / time.escapePinion),
    greatToCentre: time.great / time.centrePinion,
  };
  return {
    gears, great, centre, third, escape, anchor, strikeGreat, second, fly, tip0, contactL, contactR, beta, exitAngle,
    pendulumLength, bobY, ratios,
    period: 2 * Math.PI * Math.sqrt(pendulumLength / 32.174),
    secondsPerEscapeTurn: CK.escapeTeeth * 2 * 1,
    NE,
  };
}

// The anchor's two pallets as outlines in the wheel's plane, returned so that a check can hold them
// against the teeth. Each arm runs along the tangent from the pivot to its contact point, so it clears
// the wheel by construction, and only the pallet tip dips below the tips of the teeth.
export function anchorShapes(L) {
  const O = L.escape;
  const R = CK.escapeR;
  const unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  const add = (p, u, k, v = [0, 0], j = 0) => [p[0] + u[0] * k + v[0] * j, p[1] + u[1] * k + v[1] * j];
  const P = L.anchor;
  const armW = 0.05;
  const dip = 0.02;
  // Entry pallet: its face is square to the arm, and a tooth moving up and to the right presses on it.
  const rL = unit(O, L.contactL);
  const tL = unit(L.contactL, P);
  const entry = [
    add(L.contactL, rL, -dip),
    add(L.contactL, tL, 0.034, rL, 0.005),
    add(L.contactL, tL, 0.2, rL, 0.004),
    add(P, rL, 0.004),
    add(P, rL, armW),
    add(L.contactL, rL, armW),
  ];
  // Exit pallet: the arm passes outside the wheel and hooks back in, its face looking back up the wheel.
  const rR = unit(O, L.contactR);
  const tR = unit(P, L.contactR);
  // It sits in the middle of a gap, so its tip has to be narrower than what is left of the gap there: the
  // back of the next tooth is already rising toward its point.
  const hookW = 0.012;
  const exit = [
    add(L.contactR, rR, -0.014),
    add(L.contactR, tR, hookW, rR, -0.014),
    add(L.contactR, tR, hookW + 0.03, rR, 0.012),
    add(L.contactR, tR, hookW + 0.03, rR, armW),
    add(P, rR, armW),
    add(P, rR, 0.004),
    add(L.contactR, tR, -0.012, rR, 0.004),
  ];
  return { entry, exit, P };
}

const arcPts = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => {
  const a = mix(a0, a1, i / n);
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
});

// An upright rectangle with a round head, counter-clockwise from the bottom right.
const archOutline = (halfW, y0, spring, r = halfW, n = 22) => {
  const pts = [[-halfW, y0], [halfW, y0], [halfW, spring]];
  const head = arcPts(0, spring, r, 0, Math.PI, n);
  if (r < halfW - 1e-6) pts.push(...head);
  else pts.push(...head.slice(1, -1));
  pts.push([-halfW, spring]);
  return pts;
};

function clockDialTexture(D) {
  const W = 752; const H = 1024;
  return canvasTexture(W, H, (ctx) => {
    const k = W / (D.halfW * 2);
    const px = (x) => W / 2 + x * k;
    const py = (y) => H - (y - D.y0) * k;
    ctx.fillStyle = '#f3ecd8';
    ctx.fillRect(0, 0, W, H);
    // Painted corners and arch: simple sprays of flowers, with no moon dial.
    const spray = (cx, cy, s, turn, seed) => {
      const rng = seededRandom(seed);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(turn);
      ctx.strokeStyle = '#5f7a3f';
      ctx.lineWidth = 4 * s;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(dir * 40 * s, -20 * s, dir * 86 * s, -6 * s);
        ctx.stroke();
        for (let l = 0; l < 3; l++) {
          const lx = dir * (30 + l * 22) * s; const ly = (-14 + l * 2 + rng() * 6) * s;
          ctx.fillStyle = '#6d8a48';
          ctx.beginPath();
          ctx.ellipse(lx, ly - 7 * s, 11 * s, 5 * s, dir * 0.7, 0, TAU);
          ctx.fill();
        }
      }
      const flower = (fx, fy, r, col) => {
        ctx.fillStyle = col;
        for (let a = 0; a < 5; a++) {
          const t = (a * TAU) / 5;
          ctx.beginPath();
          ctx.arc(fx + Math.cos(t) * r * 0.62, fy + Math.sin(t) * r * 0.62, r * 0.55, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = '#e4bf52';
        ctx.beginPath();
        ctx.arc(fx, fy, r * 0.36, 0, TAU);
        ctx.fill();
      };
      flower(0, -6 * s, 25 * s, '#b83a3f');
      flower(-58 * s, -12 * s, 16 * s, '#3e68a8');
      flower(58 * s, -12 * s, 16 * s, '#c56d32');
      ctx.restore();
    };
    const cornerR = 0.5 * k;
    for (const [sx, sy, turn] of [[-1, -1, Math.PI * 0.75], [1, -1, -Math.PI * 0.75], [-1, 1, Math.PI * 0.25], [1, 1, -Math.PI * 0.25]]) {
      spray(px(sx * (D.halfW - 0.1)), py(D.centre + sy * (D.halfW - 0.1)), 0.68, turn, 11 + sx + 2 * sy);
    }
    spray(W / 2, py(D.spring + 0.17), 1.12, 0, 43);
    ctx.strokeStyle = '#7d6a39';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px(-D.halfW), py(D.spring));
    ctx.lineTo(px(D.halfW), py(D.spring));
    ctx.stroke();
    // The chapter ring.
    const cx = W / 2; const cy = py(D.centre);
    const rOut = D.ring * k;
    ctx.fillStyle = '#f8f3e4';
    ctx.beginPath();
    ctx.arc(cx, cy, cornerR * 1.02, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#1f1b16';
    for (const [r, w] of [[rOut, 4], [rOut * 0.93, 2], [rOut * 0.62, 3]]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    for (let i = 0; i < 60; i++) {
      const a = (i * TAU) / 60;
      const r0 = i % 5 === 0 ? rOut * 0.885 : rOut * 0.93;
      ctx.lineWidth = i % 5 === 0 ? 5 : 2.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
      ctx.lineTo(cx + Math.sin(a) * rOut, cy - Math.cos(a) * rOut);
      ctx.stroke();
    }
    // Roman numerals standing on the ring, with IIII at four, as clock dials have nearly always had it.
    const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ctx.fillStyle = '#17140f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    numerals.forEach((n, i) => {
      const a = (i * TAU) / 12;
      ctx.save();
      ctx.translate(cx + Math.sin(a) * rOut * 0.75, cy - Math.cos(a) * rOut * 0.75);
      ctx.rotate(a);
      fitText(ctx, n, 0, 0, rOut * 0.4, Math.round(rOut * 0.235), 'Georgia, "Times New Roman", serif');
      ctx.restore();
    });
  });
}

function buildClock() {
  const L = clockLayout();
  const { layer, module: m, escapeR: R, escapeRoot, pendulumZ, pivotY, dialY } = CK;
  if (Math.abs(pivotY - L.bobY - 39.1 / 12) > 1e-9) throw new Error('the pendulum must be 39.1 inches, pivot to bob centre');
  const parts = []; // brass, steel, cord: one vertex-coloured mesh
  const glassParts = [];
  const wood = [];
  const BRASS = 0xe2b64a;
  const BRASS_DIM = 0xbd9238;
  const PLATE = 0x7e5f2a;
  const STEEL = 0xaeb6c0;
  const ANCHOR = 0x8fa0b4;
  const DARK = 0x1f2a3c;
  const woodC = 0x6f3519; const woodDark = 0x47210e; const woodIn = 0x4c2813;

  const brassPrism = (outline, z0, z1, color = BRASS, holes = []) => { parts.push({ geometry: prism(outline, z0, z1, holes), color }); };
  const arbor = (x, y, z0, z1, r = 0.014, color = STEEL) => { parts.push({ geometry: rod([x, y, z0], [x, y, z1], r, { sides: 10, round: 1 }), color }); };

  // ---- the back plate, on four pillars from the back of the case
  const plateL = 3.44; const plateT = 5.1; const plateHalf = 0.66;
  const plateOut = roundedOutline(plateHalf, (plateT - plateL) / 2, 0.06, 3).map(([x, y]) => [x, y + (plateT + plateL) / 2]);
  brassPrism(plateOut, CK.plateZ[0], CK.plateZ[1], PLATE);
  const corners = [[-0.6, plateL + 0.07], [0.6, plateL + 0.07], [-0.6, plateT - 0.07], [0.6, plateT - 0.07]];
  for (const [x, y] of corners) {
    parts.push({ geometry: rod([x, y, -0.44], [x, y, -0.02], 0.024, { sides: 10 }), color: BRASS_DIM });
    // The stub of a pillar: the front plate that these would carry has been taken off to show the wheels.
    parts.push({ geometry: lathe([[0, -0.01], [0.03, -0.01], [0.026, 0.1], [0.018, 0.11], [0, 0.11]], 12).translate(0, 0, 0), color: BRASS_DIM });
    aimed(parts[parts.length - 1].geometry, [x, y, 0], [0, 0, 1]);
  }

  // ---- wheels and pinions, drawn from the layout
  const place = (pts, at, phase) => pts.map(([x, y]) => {
    const c = Math.cos(phase); const s = Math.sin(phase);
    return [at[0] + x * c - y * s, at[1] + x * s + y * c];
  });
  const shade = { great: 0xc99f3f, strikeGreat: 0xc99f3f, centre: 0xd9ae46, third: 0xe6bd52, second: 0xe0b64c };
  for (const gear of L.gears) {
    const z = layer[gear.z];
    if (gear.pinion) {
      const { pts } = clockGearOutline(gear.N, m, true);
      brassPrism(place(pts, gear.at, gear.phase), z - 0.024, z + 0.024, STEEL);
    } else {
      const { pts, rr } = clockGearOutline(gear.N, m, false);
      const windows = spokeWindows(rr - 0.024, 0.05, 0.016, 4, 0.5 + gear.phase).map((w) => w.map(([x, y]) => [gear.at[0] + x, gear.at[1] + y]));
      brassPrism(place(pts, gear.at, gear.phase), z - 0.014, z + 0.014, shade[gear.id] ?? BRASS, windows);
      parts.push({ geometry: aimed(lathe([[0, -0.03], [0.056, -0.03], [0.056, 0.03], [0, 0.03]], 18), [gear.at[0], gear.at[1], z], [0, 0, 1]), color: shade[gear.id] ?? BRASS });
    }
  }
  // ---- arbors, from the back plate to a rounded front pivot, each just past its foremost wheel. A real
  // movement has a second plate over all of this. It is left off here, so the wheels can be seen.
  const arbors = [[L.great, layer.z1], [L.centre, layer.z2], [L.third, layer.z3], [L.escape, layer.z4], [L.strikeGreat, layer.z1], [L.second, layer.z4], [L.fly, layer.fly]];
  for (const [a, z] of arbors) arbor(a[0], a[1], -0.01, z + 0.045, 0.0135);

  // ---- the escape wheel: pointed teeth, a true 30, bright so that it is the first thing the eye finds
  const escapeOut = escapeOutline(CK.escapeTeeth, R, R * escapeRoot, L.tip0);
  const escapeWin = spokeWindows(R * escapeRoot - 0.022, 0.048, 0.014, 4, 0.2).map((w) => w.map(([x, y]) => [L.escape[0] + x, L.escape[1] + y]));
  brassPrism(escapeOut.map(([x, y]) => [L.escape[0] + x, L.escape[1] + y]), layer.z4 - 0.013, layer.z4 + 0.013, 0xf0c95c, escapeWin);
  parts.push({ geometry: aimed(lathe([[0, -0.03], [0.05, -0.03], [0.05, 0.03], [0, 0.03]], 18), [L.escape[0], L.escape[1], layer.z4], [0, 0, 1]), color: 0xf0c95c });

  // ---- the anchor
  const A = anchorShapes(L);
  parts.push({ geometry: prism(A.entry, layer.z4 - 0.024, layer.z4 + 0.024), color: ANCHOR });
  parts.push({ geometry: prism(A.exit, layer.z4 - 0.0235, layer.z4 + 0.0235), color: ANCHOR });
  parts.push({ geometry: aimed(lathe([[0, -0.042], [0.062, -0.042], [0.062, 0.042], [0, 0.042]], 22), [L.anchor[0], L.anchor[1], layer.z4], [0, 0, 1]), color: ANCHOR });
  arbor(L.anchor[0], L.anchor[1], -0.135, layer.z4 + 0.06, 0.015);
  // The two pallet tips, polished, because they are the whole point of the anchor.
  const tipPoly = (points) => parts.push({ geometry: prism(points, layer.z4 - 0.0255, layer.z4 + 0.0255), color: 0xe6edf4 });
  tipPoly([A.entry[0], A.entry[1], A.entry[5]]);
  tipPoly([A.exit[0], A.exit[1], A.exit[2], A.exit[3], A.exit[6]]);

  // ---- the strike side's fly, a brass vane on its arbor
  const flyZ = layer.fly;
  parts.push({ geometry: slab(L.fly[0] - 0.1, L.fly[1] - 0.034, L.fly[0] + 0.1, L.fly[1] + 0.034, flyZ - 0.005, flyZ + 0.005), color: BRASS });

  // ---- two weights on cords. Each cord leaves its barrel, drops to the pulley on the weight, passes
  // under it and climbs back to a hook on the plate, so each weight hangs in the bight of its cord.
  const barrelR = 0.12;
  const hangers = [
    { barrel: L.great, side: -1, pulleyY: 2.86 },
    { barrel: L.strikeGreat, side: 1, pulleyY: 3.06 },
  ];
  const weights = [];
  for (const h of hangers) {
    const z = layer.barrel;
    const barrel = lathe([[0, -0.062], [barrelR + 0.016, -0.062], [barrelR + 0.016, -0.05], [barrelR, -0.05], [barrelR, 0.05], [barrelR + 0.016, 0.05], [barrelR + 0.016, 0.062], [0, 0.062]], 26);
    tintVertices(barrel, (x, y, zz, out) => { const c = lin(0xa98737); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; });
    aimed(barrel, [h.barrel[0], h.barrel[1], z], [0, 0, 1]);
    parts.push({ geometry: barrel, keepColor: true });
    // Coils of cord lying on the barrel.
    for (let c = -2; c <= 2; c++) {
      const ring = new THREE.TorusGeometry(barrelR + 0.008, 0.0095, 6, 24).translate(h.barrel[0], h.barrel[1], z + c * 0.019);
      parts.push({ geometry: ring, color: 0xcdb98c });
    }
    const pr = 0.085;
    const fall = h.barrel[0] + h.side * barrelR;
    const px = fall - h.side * pr;
    const backX = px - h.side * pr;
    const pts = [];
    pts.push([fall, h.barrel[1] + 0.01, z]);
    pts.push([fall, h.pulleyY + 0.3, z]);
    pts.push([fall, h.pulleyY + 0.02, z]);
    for (let i = 1; i < 10; i++) {
      const a = (i / 10) * Math.PI;
      pts.push([px + h.side * pr * Math.cos(a), h.pulleyY - pr * Math.sin(a), z]);
    }
    pts.push([backX, h.pulleyY + 0.02, z]);
    pts.push([backX, h.pulleyY + 0.3, z]);
    const hookY = plateL - 0.015;
    pts.push([backX, hookY, z]);
    parts.push({ geometry: tube(pts, 0.0095, { sides: 7, steps: pts.length * 3, round: 1 }), color: 0xd7c49b });
    // The hook the fixed end ties to: a lug standing out from the bottom edge of the plate.
    parts.push({ geometry: rod([backX, plateL + 0.02, -0.01], [backX, plateL + 0.02, z + 0.01], 0.014, { sides: 8, round: 1 }), color: BRASS_DIM });
    parts.push({ geometry: rod([backX, plateL + 0.03, z], [backX, hookY - 0.01, z], 0.012, { sides: 8, round: 1 }), color: BRASS_DIM });
    // Pulley, stirrup and the weight itself.
    const pulley = lathe([[0, -0.02], [pr + 0.012, -0.02], [pr - 0.008, 0], [pr + 0.012, 0.02], [0, 0.02]], 22);
    aimed(pulley, [px, h.pulleyY, z], [0, 0, 1]);
    parts.push({ geometry: pulley, color: BRASS_DIM });
    const wTop = h.pulleyY - pr - 0.1;
    parts.push({ geometry: rod([px, h.pulleyY, z], [px, wTop + 0.02, z], 0.014, { sides: 8 }), color: BRASS_DIM });
    const wLen = 0.66;
    const weight = lathe([[0, wTop - wLen], [0.09, wTop - wLen], [0.122, wTop - wLen + 0.03], [0.126, wTop - wLen + 0.06], [0.126, wTop - 0.06], [0.122, wTop - 0.03], [0.09, wTop], [0.03, wTop + 0.012], [0, wTop + 0.012]], 26).translate(px, 0, z);
    polish(weight, 0xd7ac44, { sky: 0.95, horizon: 1.15, dark: 0.45, ground: 0.7, streak: 0.22, band: 0.08 });
    weights.push(weight);
    parts.push({ geometry: weight, keepColor: true });
  }

  // ---- the pendulum: spring, long rod, round bob, rating nut
  const pz = pendulumZ;
  // The back cock, a bracket from the back of the case.
  parts.push({ geometry: slab(-0.1, pivotY + 0.04, 0.1, pivotY + 0.1, -0.44, pz + 0.05), color: BRASS_DIM });
  parts.push({ geometry: slab(-0.042, pivotY - 0.05, 0.042, pivotY + 0.05, pz - 0.018, pz + 0.018), color: STEEL });
  parts.push({ geometry: slab(-0.022, pivotY - 0.09, 0.022, pivotY - 0.04, pz - 0.006, pz + 0.006), color: STEEL });
  parts.push({ geometry: rod([0, pivotY - 0.08, pz], [0, L.bobY, pz], 0.017, { sides: 10 }), color: 0xc4cad2 });
  const bobR = 0.33;
  const bobT = 0.058;
  const bob = lathe([[0, -bobT], [bobR * 0.5, -bobT * 0.86], [bobR * 0.82, -bobT * 0.46], [bobR * 0.98, -0.009], [bobR, 0], [bobR * 0.98, 0.009], [bobR * 0.82, bobT * 0.46], [bobR * 0.5, bobT * 0.86], [0, bobT]], 48);
  aimed(bob, [0, L.bobY, pz], [0, 0, 1]);
  parts.push({ geometry: bob, color: 0xdcae45 });
  parts.push({ geometry: rod([0, L.bobY - bobR + 0.02, pz], [0, L.bobY - bobR - 0.12, pz], 0.012, { sides: 8, round: 1 }), color: 0xc4cad2 });
  parts.push({ geometry: lathe([[0, -0.03], [0.034, -0.03], [0.04, -0.015], [0.04, 0.015], [0.034, 0.03], [0, 0.03]], 10).translate(0, L.bobY - bobR - 0.075, pz), color: BRASS });

  // ---- the crutch: from the anchor's arbor, down behind the plate, with a fork round the rod
  const crutchZ = -0.13;
  const crutchEnd = L.anchor[1] - 0.72;
  parts.push({ geometry: rod([0, L.anchor[1] + 0.012, crutchZ], [0, crutchEnd, crutchZ], 0.012, { sides: 8, round: 1 }), color: STEEL });
  parts.push({ geometry: rod([0, crutchEnd, crutchZ], [0, crutchEnd, pz + 0.028], 0.012, { sides: 8, round: 1 }), color: STEEL });
  parts.push({ geometry: slab(-0.034, crutchEnd - 0.014, 0.034, crutchEnd + 0.014, pz + 0.018, pz + 0.032), color: STEEL });
  for (const s of [-1, 1]) parts.push({ geometry: rod([s * 0.027, crutchEnd, pz + 0.025], [s * 0.027, crutchEnd, pz - 0.03], 0.008, { sides: 6, round: 1 }), color: STEEL });

  // ---- the leading-off rod: a contrate wheel on the centre arbor drives a rod up the back of the
  // movement, and a second one turns the arbor of the hands. Both contrate wheels are the same size, so
  // the hands turn at the centre arbor's one turn an hour.
  const rodX = 0.14; const rodZ = -0.1;
  const contrate = (cx, cy) => {
    const wheelR = rodX + 0.012;
    const disc = lathe([[0, -0.01], [wheelR, -0.01], [wheelR, 0.008], [0, 0.008]], 28);
    aimed(disc, [cx, cy, -0.068], [0, 0, 1]);
    parts.push({ geometry: disc, color: BRASS });
    for (let t = 0; t < 24; t++) {
      const a = (t * TAU) / 24;
      const x = cx + Math.cos(a) * (wheelR - 0.006); const y = cy + Math.sin(a) * (wheelR - 0.006);
      parts.push({ geometry: new THREE.BoxGeometry(0.018, 0.018, 0.02).rotateZ(a).translate(x, y, -0.086), color: BRASS });
    }
    parts.push({ geometry: lathe([[0, -0.024], [0.024, -0.024], [0.024, 0.024], [0, 0.024]], 8).translate(rodX, cy, rodZ), color: STEEL });
  };
  contrate(L.centre[0], L.centre[1]);
  contrate(0, dialY);
  arbor(L.centre[0], L.centre[1], -0.075, 0, 0.0135);
  parts.push({ geometry: rod([rodX, L.centre[1] - 0.03, rodZ], [rodX, dialY + 0.03, rodZ], 0.0125, { sides: 8, round: 1 }), color: STEEL });
  // Two brass guides holding the rod to the plate's back and to the hood's rail.
  for (const y of [4.3, 5.02]) parts.push({ geometry: rod([rodX, y, rodZ], [rodX, y, -0.02], 0.009, { sides: 6 }), color: BRASS_DIM });

  // ---- the case
  const hw = 0.82; const inW = 0.74; const zF = 0.46; const zB = -0.48;
  const box = (x0, x1, y0, y1, z0, z1, color = woodC, upright = true) => {
    const g = slab(x0, y0, x1, y1, z0, z1);
    wood.push({ geometry: upright ? uprightUV(g) : woodUV(g, 0.26, 0.9), color });
  };
  const y0Waist = 1.2; const y1Waist = 5.28;
  // Back and -X wall are solid; the +X wall has been left out, keeping only its stiles and rails.
  box(-hw, hw, y0Waist, y1Waist, zB, zB + 0.05, woodIn);
  box(-hw, -inW, y0Waist, y1Waist, zB, zF);
  box(inW, hw, y0Waist, y1Waist, zB, zB + 0.13);
  box(inW, hw, y0Waist, y1Waist, zF - 0.13, zF);
  box(inW, hw, y0Waist, y0Waist + 0.14, zB, zF, woodC, false);
  box(inW, hw, y1Waist - 0.14, y1Waist, zB, zF, woodC, false);
  // The front frame round the door's opening.
  const openHalf = 0.68;
  box(-hw, -openHalf, y0Waist, y1Waist, zF - 0.05, zF);
  box(openHalf, hw, y0Waist, y1Waist, zF - 0.05, zF);
  box(-openHalf, openHalf, y0Waist, y0Waist + 0.16, zF - 0.05, zF, woodC, false);
  box(-openHalf, openHalf, y1Waist - 0.14, y1Waist, zF - 0.05, zF, woodC, false);
  // A dark floor to the trunk.
  box(-inW, inW, y0Waist, y0Waist + 0.02, zB + 0.05, zF - 0.05, woodDark, false);

  // The door, swung right open. Authored flat from its hinge and turned as one piece.
  const doorW = openHalf * 2 - 0.02;
  const doorY0 = y0Waist + 0.17; const doorY1 = y1Waist - 0.15;
  const doorOpen = THREE.MathUtils.degToRad(150);
  const hinge = new THREE.Matrix4().makeRotationY(-doorOpen).setPosition(-openHalf + 0.01, 0, zF + 0.012);
  const midX = doorW / 2;
  const glazing = archOutline(doorW / 2 - 0.13, doorY0 + 0.16, doorY1 - doorW / 2 - 0.04).map(([x, y]) => [x + midX, y]);
  const doorG = prism([[0, doorY0], [doorW, doorY0], [doorW, doorY1], [0, doorY1]], 0, 0.056, [glazing]);
  doorG.applyMatrix4(hinge);
  wood.push({ geometry: uprightUV(doorG), color: woodC });
  const moulding = prism(archOutline(doorW / 2 - 0.09, doorY0 + 0.12, doorY1 - doorW / 2 - 0.04, doorW / 2 - 0.09).map(([x, y]) => [x + midX, y]), 0.056, 0.074, [glazing]);
  moulding.applyMatrix4(hinge);
  wood.push({ geometry: uprightUV(moulding), color: woodDark });
  const doorPane = prism(glazing, 0.022, 0.03);
  doorPane.applyMatrix4(hinge);
  glassParts.push({ geometry: doorPane, color: 0xdceef0 });
  for (const hy of [doorY0 + 0.4, doorY1 - 0.4]) {
    parts.push({ geometry: lathe([[0, -0.09], [0.022, -0.09], [0.022, 0.09], [0, 0.09]], 10).translate(-openHalf + 0.01, hy, zF + 0.015), color: BRASS });
  }
  const knob = new THREE.Vector3(doorW - 0.07, (doorY0 + doorY1) / 2, 0.056).applyMatrix4(hinge);
  parts.push({ geometry: ball(0.03, [knob.x, knob.y, knob.z], 12, 8), color: BRASS });

  // ---- the plinth, on bracket feet
  const footH = 0.2;
  const zC = 0.04;
  const pw = 0.98; const pd = 0.58;
  const plinth = roundedSlab(pw, pd, 0.012, [[0.04, footH], [0.04, 1.04], [0, 1.06], [0, 1.09], [0.07, 1.13], [0.13, 1.16], [0.15, 1.2]], { steps: 1 }).translate(0, 0, zC);
  wood.push({ geometry: uprightUV(plinth), color: woodC });
  const skirt = roundedSlab(pw, pd, 0.012, [[0, footH], [0, footH + 0.07], [0.03, footH + 0.1], [0.04, footH + 0.13]], { steps: 1 }).translate(0, 0, zC);
  wood.push({ geometry: woodUV(skirt), color: woodDark });
  // A raised panel on the plinth's front.
  const panelZ = zC + pd - 0.04;
  wood.push({ geometry: uprightUV(prism([[-0.66, footH + 0.2], [0.66, footH + 0.2], [0.66, 0.97], [-0.66, 0.97]], panelZ - 0.01, panelZ + 0.012)), color: woodDark });
  wood.push({ geometry: uprightUV(prism([[-0.58, footH + 0.27], [0.58, footH + 0.27], [0.58, 0.9], [-0.58, 0.9]], panelZ + 0.012, panelZ + 0.034)), color: woodC });
  // Bracket feet: an ogee cut from a block, on both faces of each corner.
  const bracket = (long) => [[0, 0], [0.09, 0], [0.13, 0.05], [0.22, 0.08], [long, 0.1], [long, footH + 0.01], [0, footH + 0.01]];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const fx = sx * pw; const fz = zC + sz * pd;
      const front = prism(bracket(0.4).map(([x, y]) => [fx - sx * x, y]), fz - 0.05, fz + 0.05 * 0);
      if (sz < 0) front.translate(0, 0, 0.05);
      wood.push({ geometry: woodUV(outward(front)), color: woodDark });
      const side = prism(bracket(0.4).map(([x, y]) => [fz - sz * x, y]), -0.05, 0);
      side.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)).setPosition(fx - (sx > 0 ? 0.0 : -0.05), 0, 0));
      wood.push({ geometry: woodUV(outward(side)), color: woodDark });
    }
  }

  // ---- the hood
  const hoodY0 = 5.34;
  const hoodHalf = 0.99;
  const shoulder = 6.56;
  const archR = 0.5; const archY = 6.5;
  const hoodZF = 0.62; const hoodZB = -0.52;
  // A flat-shouldered round head. Counter-clockwise from the bottom right.
  const hoodOutline = (grow = 0) => {
    const r = archR + grow;
    const sy = shoulder + grow;
    const dx = Math.sqrt(Math.max(0, r * r - (sy - archY) ** 2));
    const start = Math.atan2(sy - archY, dx);
    return [
      [-hoodHalf - grow, hoodY0], [hoodHalf + grow, hoodY0], [hoodHalf + grow, sy],
      ...arcPts(0, archY, r, start, Math.PI - start, 26),
      [-hoodHalf - grow, sy],
    ];
  };
  const D = { halfW: 0.56, y0: 5.42, spring: 6.54, centre: dialY, ring: 0.515, archR: 0.38 };
  const dialOpen = archOutline(D.halfW - 0.015, D.y0 + 0.02, D.spring - 0.02, D.archR - 0.02);
  const fw = (g) => { uprightUV(g); wood.push({ geometry: g, color: woodC }); };
  fw(prism(hoodOutline(), hoodZF - 0.06, hoodZF, [dialOpen]));
  fw(prism(hoodOutline(), hoodZB, hoodZB + 0.05));
  // The sides: a solid one, and on +X a light left open, so the rod and contrate can be seen.
  const sideG = (x0, x1, hole) => {
    const outline = [[hoodZB, hoodY0], [hoodZF, hoodY0], [hoodZF, shoulder], [hoodZB, shoulder]];
    const g = prism(outline, 0, x1 - x0, hole ? [hole] : []);
    g.applyMatrix4(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)).setPosition(x0, 0, 0));
    return outward(g);
  };
  wood.push({ geometry: uprightUV(sideG(-hoodHalf, -hoodHalf + 0.05)), color: woodC });
  wood.push({ geometry: uprightUV(sideG(hoodHalf - 0.05, hoodHalf, [[hoodZB + 0.14, hoodY0 + 0.16], [hoodZF - 0.16, hoodY0 + 0.16], [hoodZF - 0.16, shoulder - 0.16], [hoodZB + 0.14, shoulder - 0.16]])), color: woodC });
  wood.push({ geometry: woodUV(slab(-hoodHalf, hoodY0 - 0.03, hoodHalf, hoodY0 + 0.03, hoodZB, hoodZF)), color: woodDark });
  // The moulding the hood stands on, flaring out of the waist.
  const flare = roundedSlab(hoodHalf, 0.59, 0.012, [[0.17, 5.16], [0.15, 5.22], [0.06, 5.28], [0.02, 5.31], [0, hoodY0 - 0.02], [0, hoodY0]], { steps: 1 }).translate(0, 0, 0.05);
  wood.push({ geometry: uprightUV(flare), color: woodDark });
  // The roof: flat shoulders and a shell over the arch, each a solid closing the top.
  const dxArch = Math.sqrt(archR * archR - (shoulder - archY) ** 2);
  const roofStart = Math.atan2(shoulder - archY, dxArch);
  fw(prism([...arcPts(0, archY, archR, roofStart, Math.PI - roofStart, 26), ...arcPts(0, archY, archR - 0.05, Math.PI - roofStart, roofStart, 26)], hoodZB, hoodZF));
  for (const s of [-1, 1]) wood.push({ geometry: woodUV(slab(Math.min(s * dxArch, s * hoodHalf), shoulder - 0.05, Math.max(s * dxArch, s * hoodHalf), shoulder, hoodZB, hoodZF)), color: woodC });
  // The cornice: a band following the top of the hood, proud of its face.
  const corniceBand = (growOut, growIn, z0, z1, color) => {
    const outer = hoodOutline(growOut).slice(2);
    const inner = hoodOutline(growIn).slice(2).reverse();
    const close = (pts) => pts.map(([x, y]) => [x, y]);
    const g = prism([...close(outer), ...close(inner)], z0, z1);
    wood.push({ geometry: uprightUV(g), color });
  };
  corniceBand(0.05, -0.05, hoodZF - 0.02, hoodZF + 0.03, woodDark);
  corniceBand(0.02, -0.11, hoodZF - 0.02, hoodZF + 0.012, woodC);
  // Turned columns with brass capitals, at the corners of the hood's front.
  for (const s of [-1, 1]) {
    const col = lathe([[0, hoodY0 + 0.03], [0.062, hoodY0 + 0.03], [0.05, hoodY0 + 0.07], [0.042, hoodY0 + 0.1], [0.036, hoodY0 + 0.3], [0.034, 6.1], [0.03, shoulder - 0.2], [0, shoulder - 0.2]], 16).translate(s * (hoodHalf - 0.075), 0, hoodZF + 0.036);
    wood.push({ geometry: uprightUV(col), color: woodC });
    for (const [y0, y1] of [[hoodY0 + 0.03, hoodY0 + 0.07], [shoulder - 0.23, shoulder - 0.15]]) {
      parts.push({ geometry: lathe([[0, y0], [0.05, y0], [0.062, (y0 + y1) / 2], [0.05, y1], [0, y1]], 14).translate(s * (hoodHalf - 0.075), 0, hoodZF + 0.036), color: BRASS });
    }
  }
  // Three brass ball finials.
  const finial = (x, y, s = 1) => {
    parts.push({ geometry: lathe([[0, y], [0.05 * s, y], [0.022 * s, y + 0.035 * s], [0.03 * s, y + 0.05 * s], [0.058 * s, y + 0.09 * s], [0.062 * s, y + 0.115 * s], [0.04 * s, y + 0.155 * s], [0.012 * s, y + 0.18 * s], [0.006 * s, y + 0.25 * s], [0, y + 0.26 * s]], 16).translate(x, 0, 0.1), color: BRASS });
  };
  finial(0, archY + archR - 0.01, 1.05);
  finial(-hoodHalf + 0.16, shoulder - 0.005, 0.85);
  finial(hoodHalf - 0.16, shoulder - 0.005, 0.85);

  // ---- the dial and hands
  const dialOutline = archOutline(D.halfW, D.y0, D.spring, D.archR);
  const dialPlate = prism(dialOutline, 0.5, 0.53);
  const pos = dialPlate.attributes.position;
  const uv = dialPlate.attributes.uv;
  const dialH = D.spring + D.archR - D.y0;
  const dialScaleH = (D.halfW * 2 * 1024) / 752;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + D.halfW) / (D.halfW * 2), (pos.getY(i) - D.y0) / dialScaleH);
  }
  // Assert the dial fits its canvas: the canvas is cut to the dial's own proportion.
  if (dialH > dialScaleH + 1e-6) throw new Error('dial is taller than its canvas');
  const dialMesh = mesh(dialPlate, standard({ map: clockDialTexture(D), roughness: 0.6, metalness: 0 }));
  // The hands read 10:08, and the hour hand is where 8 minutes past ten puts it.
  const minutes = 8;
  const hours = 10 + minutes / 60;
  const minuteA = (minutes / 60) * TAU;
  const hourA = (hours / 12) * TAU;
  const handZ0 = 0.54;
  const hand = (len, w, tail, turn, z0, spade) => {
    const pts = spade
      ? [[0, -tail], [w * 0.35, -tail * 0.4], [w * 0.28, len * 0.52], [w, len * 0.66], [w * 0.5, len * 0.82], [0, len], [-w * 0.5, len * 0.82], [-w, len * 0.66], [-w * 0.28, len * 0.52], [-w * 0.35, -tail * 0.4]]
      : [[0, -tail], [w * 0.5, -tail * 0.4], [w * 0.42, len * 0.62], [w * 0.75, len * 0.72], [w * 0.2, len * 0.84], [0, len], [-w * 0.2, len * 0.84], [-w * 0.75, len * 0.72], [-w * 0.42, len * 0.62], [-w * 0.5, -tail * 0.4]];
    const c = Math.cos(turn); const s = Math.sin(turn);
    parts.push({ geometry: prism(pts.map(([x, y]) => [x * c + y * s, dialY - x * s + y * c]), z0, z0 + 0.008), color: DARK });
  };
  hand(0.3, 0.05, 0.05, hourA, handZ0, true);
  hand(0.47, 0.034, 0.08, minuteA, handZ0 + 0.012, false);
  parts.push({ geometry: lathe([[0, -0.035], [0.022, -0.035], [0.022, 0.03], [0.012, 0.038], [0, 0.038]], 12).translate(0, 0, 0), color: BRASS });
  const capIdx = parts.length - 1;
  aimed(parts[capIdx].geometry, [0, dialY, handZ0 + 0.018], [0, 0, 1]);
  arbor(0, dialY, -0.075, handZ0, 0.0135);
  // The hood's glass, over the dial.
  glassParts.push({ geometry: prism(dialOpen, 0.588, 0.596), color: 0xdceef0 });

  const group = new THREE.Group();
  const woodMesh = mesh(mergeParts(wood), standard({ vertexColors: true, map: grainMap(83, { lines: 170, strength: 0.17, wander: 7 }), roughness: 0.44, metalness: 0 }));
  group.add(woodMesh);
  group.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.42, metalness: 0.34 })));
  group.add(dialMesh);
  const glass = mesh(mergeParts(glassParts), standard({ vertexColors: true, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }));
  glass.castShadow = false;
  glass.receiveShadow = false;
  group.add(glass);
  return group;
}

// ---------------------------------------------------------------------------
// Zhang Heng's seismoscope
// ---------------------------------------------------------------------------

// No such instrument survives. The Hou Han Shu describes a domed bronze vessel like a wine jar, eight feet
// (Han) across, with eight dragons and eight toads, and nothing about this model goes beyond that outline:
// the dragons are this model's own stylised ones, there is nothing inside it, and the card says so.
const ZH = {
  dragons: 8,
  toads: 8,
  fallen: 0, // the dragon whose ball has dropped: bearing 0, straight toward the student
  baseTop: 0.34,
  ballR: 0.15,
  mouthR: 2.42,
  mouthY: 2.9,
  toadScale: 0.8,
  profile: [
    [1.26, 0.34], [1.28, 0.46], [1.17, 0.54], [1.22, 0.64], [1.48, 1.1], [1.74, 1.7], [1.91, 2.4], [1.95, 2.85], [1.9, 3.32], [1.76, 3.76], [1.52, 4.15],
    [1.27, 4.42], [1.13, 4.6], [1.13, 4.72], [1.25, 4.82], [1.31, 4.89], [1.29, 4.96], [1.17, 5.01], [1.02, 5.25], [0.74, 5.52], [0.38, 5.7],
    [0.19, 5.76], [0.145, 5.8], [0.23, 5.87], [0.25, 5.94], [0.14, 6.0],
  ],
};

export function seismoscopeLayout() {
  const { dragons, toads, fallen, profile } = ZH;
  const curve = new THREE.CatmullRomCurve3(profile.map(([r, y]) => V(r, y, 0)), false, 'centripetal');
  curve.arcLengthDivisions = 1200;
  const rows = 42;
  const sampled = curve.getSpacedPoints(rows).map((p) => [p.x, p.y]);
  const urnR = (y) => {
    for (let i = 1; i < sampled.length; i++) {
      if (sampled[i][1] >= y && sampled[i - 1][1] <= y) {
        const t = (y - sampled[i - 1][1]) / Math.max(1e-6, sampled[i][1] - sampled[i - 1][1]);
        return mix(sampled[i - 1][0], sampled[i][0], t);
      }
    }
    return sampled[sampled.length - 1][0];
  };
  const bearings = Array.from({ length: dragons }, (_, k) => (k * TAU) / dragons);
  // The head's frame: the snout points down and a little out, the top of the skull faces outward.
  const f = V(0, -0.94, 0.34).normalize();
  const t = V(0, 0.34, 0.94).normalize();
  const side = t.clone().cross(f);
  const ballLocal = V(0, -0.225, 0.585);
  const M = V(0, ZH.mouthY, ZH.mouthR);
  const H = M.clone().sub(side.clone().multiplyScalar(ballLocal.x)).sub(t.clone().multiplyScalar(ballLocal.y)).sub(f.clone().multiplyScalar(ballLocal.z));
  const items = bearings.map((a, k) => ({
    index: k,
    bearing: a,
    mouth: [Math.sin(a) * ZH.mouthR, ZH.mouthY, Math.cos(a) * ZH.mouthR],
    toadMouth: [Math.sin(a) * ZH.mouthR, ZH.baseTop + 0.82 * ZH.toadScale, Math.cos(a) * ZH.mouthR],
    ballIn: k === fallen ? 'toad' : 'dragon',
  }));
  return { dragons, toads, bearings, items, sampled, urnR, frame: { f, t, side, H, M, ballLocal } };
}

// A lathe with a duplicated seam column, so that a tiling texture runs true all the way round. (revolve
// wraps u backwards across its last strip.) The two copies of the seam take one welded normal.
function latheSeamed(profile, segments) {
  const rows = profile.length;
  const cols = segments + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const index = [];
  for (let c = 0; c < cols; c++) {
    const a = (c / segments) * TAU;
    for (let i = 0; i < rows; i++) {
      const o = c * rows + i;
      const [r, y, v] = profile[i];
      positions[o * 3] = Math.sin(a) * r; positions[o * 3 + 1] = y; positions[o * 3 + 2] = Math.cos(a) * r;
      uvs[o * 2] = c / segments; uvs[o * 2 + 1] = v;
    }
  }
  for (let c = 0; c < segments; c++) {
    for (let i = 0; i < rows - 1; i++) {
      const p = c * rows + i; const q = c * rows + i + 1; const s = (c + 1) * rows + i + 1; const t = (c + 1) * rows + i;
      // Bottom-up rows: q is above p, and the next column is further round toward +x from +z.
      index.push(p, s, q, p, t, s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < rows; i++) {
    const a = i; const b = segments * rows + i;
    const v = V(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
  }
  return outward(g);
}

const zhCopy = (g, a) => g.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(a));

// Weathered bronze written per vertex: gold where hands and wear have kept it bright, green elsewhere.
function bronzeTint(x, y, z, out, { bright = 1 } = {}) {
  const gold = lin(0x93803f);
  const green = lin(0x5d8468);
  const n = smoothNoise3(x * 1.7 + 3.1, y * 1.7 - 1.3, z * 1.7 + 0.7);
  const m = smoothNoise3(x * 6.3 - 5, y * 6.3 + 2, z * 6.3 + 9);
  const t = 0.12 + 0.66 * clamp01(sstep(n + (m - 0.5) * 0.45, 0.3, 0.72));
  out[0] = mix(gold[0], green[0], t) * bright; out[1] = mix(gold[1], green[1], t) * bright; out[2] = mix(gold[2], green[2], t) * bright;
}

function dragonHead(frame) {
  const { H, f, t, side } = frame;
  const sc = new Sculpt(0.059);
  const bronze = lin(0x9c8236);
  const eyeGold = lin(0xe6c04e);
  const mouthDark = lin(0x2f1712);
  sc.add(ellipsoidP([0, 0.04, -0.02], [0.25, 0.2, 0.3]), bronze);
  sc.add(curveP([[0, 0.07, 0.1], [0, 0.05, 0.36], [0, 0.03, 0.6]], [0.155, 0.125, 0.105], 10), bronze, { k: 0.09 });
  sc.add(ellipsoidP([0, 0.1, 0.6], [0.125, 0.07, 0.09]), bronze, { k: 0.05 });
  const gape = THREE.MathUtils.degToRad(42);
  const hinge = [0, -0.07, -0.02];
  const jawDir = [0, -Math.sin(gape), Math.cos(gape)];
  const jawAt = (d) => [hinge[0], hinge[1] + jawDir[1] * d, hinge[2] + jawDir[2] * d];
  sc.add(curveP([jawAt(0), jawAt(0.3), jawAt(0.66)], [0.13, 0.1, 0.08], 10), bronze, { k: 0.07 });
  for (const s of [-1, 1]) {
    sc.add(curveP([[s * 0.06, 0.2, 0.15], [s * 0.16, 0.225, 0.04], [s * 0.23, 0.2, -0.1]], [0.05, 0.058, 0.04], 8), bronze, { k: 0.05 });
    sc.add(sphereP([s * 0.205, 0.125, 0.13], 0.07), eyeGold, { k: 0.012 });
  }
  // The mouth, carved after everything that surrounds it.
  sc.sub(ellipsoidP([0, -0.16, 0.36], [0.098, 0.1, 0.36]), mouthDark, { k: 0.03 });
  for (const s of [-1, 1]) sc.sub(sphereP([s * 0.055, 0.13, 0.665], 0.032), mouthDark, { k: 0.012 });
  const geometry = polygonize(sc, {
    uvScale: 3,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      // Green and gold on the casting, blending into the eyes and the inside of the mouth by how far the
      // field's own colour has gone toward them, so a coarse mesh does not fray the edge.
      const toMouth = clamp01((bronze[0] - rgb[0]) / (bronze[0] - mouthDark[0]));
      const toEye = clamp01((rgb[0] - bronze[0]) / (eyeGold[0] - bronze[0]));
      const o = [0, 0, 0];
      bronzeTint(x + 11, y + 3, z, o);
      for (let i = 0; i < 3; i++) {
        let v = mix(o[i], mouthDark[i], toMouth * toMouth);
        v = mix(v, eyeGold[i], toEye);
        rgb[i] = v;
      }
    },
  });
  const parts = [{ geometry, keepColor: true }];
  const pupils = [];
  const teeth = [];
  const tooth = (root, dir, len, r) => {
    const g = new THREE.ConeGeometry(r, len, 4, 1);
    g.translate(0, len / 2, 0);
    aimed(g, root, dir);
    teeth.push({ geometry: g, color: 0xd9ca8f });
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = 0.2 + i * 0.09;
      tooth([s * 0.092, -0.065 - (i === 4 ? 0.01 : 0), z], [s * 0.1, -1, 0.1], 0.078, 0.024);
      const d = 0.2 + i * 0.08;
      const p = jawAt(d);
      tooth([s * 0.075, p[1] + 0.05, p[2]], [s * 0.1, 0.9, 0.4], 0.066, 0.021);
    }
    // Horns and whiskers are thin things, so they are analytic rather than sculpted.
    const horn = (g) => parts.push({ geometry: tintVertices(g, (x, y, z, o) => bronzeTint(x + 2, y, z, o, { bright: 1.12 })), keepColor: true });
    horn(tube([[s * 0.1, 0.18, -0.12], [s * 0.15, 0.3, -0.34], [s * 0.24, 0.5, -0.56], [s * 0.3, 0.72, -0.68]], [0.05, 0.04, 0.026, 0.006], { sides: 6, steps: 7, round: 1 }));
    horn(tube([[s * 0.2, 0.38, -0.42], [s * 0.3, 0.46, -0.44], [s * 0.38, 0.54, -0.42]], [0.024, 0.014, 0.004], { sides: 4, steps: 3, round: 0 }));
    horn(tube([[s * 0.1, 0.03, 0.54], [s * 0.26, 0.01, 0.5], [s * 0.42, 0.06, 0.36], [s * 0.5, 0.2, 0.2]], [0.019, 0.015, 0.01, 0.003], { sides: 4, steps: 7, round: 0 }));
    // Cheek fins: thin, sharp and analytic, rooted in the skull. Sculpted at this cell size they came out
    // round-ended and read as fingers on the dragon's head.
    horn(tube([[s * 0.16, -0.04, -0.06], [s * 0.34, -0.03, -0.24], [s * 0.5, 0.06, -0.42]], [0.085, 0.05, 0.002], { sides: 5, steps: 4, round: 0 }));
    horn(tube([[s * 0.15, 0.08, -0.12], [s * 0.29, 0.17, -0.28], [s * 0.4, 0.3, -0.42]], [0.08, 0.046, 0.002], { sides: 5, steps: 4, round: 0 }));
    horn(tube([[s * 0.1, -0.13, -0.06], [s * 0.24, -0.21, -0.2], [s * 0.36, -0.24, -0.38]], [0.08, 0.046, 0.002], { sides: 5, steps: 4, round: 0 }));
    // A dark bead of a pupil set into each eye, looking out and forward.
    const eye = V(s * 0.205, 0.125, 0.13);
    const look = V(s * 0.8, 0.12, 0.58).normalize();
    pupils.push({ geometry: ball(0.03, [eye.x + look.x * 0.052, eye.y + look.y * 0.052, eye.z + look.z * 0.052], 8, 5), color: 0x14120c });
  }
  const m = new THREE.Matrix4().makeBasis(side, t, f).setPosition(H);
  const merged = mergeParts([...parts, ...teeth, ...pupils]);
  merged.applyMatrix4(m);
  return merged;
}

function dragonBody(L) {
  const { urnR, frame } = L;
  const { H, f } = frame;
  const surf = (y, az, lift) => {
    const r = urnR(y) + lift;
    return [Math.sin(az) * r, y, Math.cos(az) * r];
  };
  const back = (k) => [H.x - f.x * k, H.y - f.y * k, H.z - f.z * k];
  const spine = [
    back(0.05), back(0.32), back(0.6),
    surf(4.03, 0.08, 0.3), surf(4.14, 0.24, 0.17), surf(4.28, 0.29, 0.14), surf(4.42, 0.12, 0.12), surf(4.5, -0.1, 0.09),
    surf(4.56, -0.26, 0.05), surf(4.62, -0.34, 0.03),
  ];
  const radii = [0.13, 0.15, 0.155, 0.16, 0.16, 0.15, 0.125, 0.09, 0.055, 0.008];
  const parts = [];
  const paint = (g) => tintVertices(g, (x, y, z, o) => bronzeTint(x + 7, y, z, o));
  parts.push({ geometry: paint(tube(spine, radii, { sides: 10, steps: 26, round: 1 })), keepColor: true });
  // A row of dorsal spines, each rooted in the body.
  const curve = new THREE.CatmullRomCurve3(spine.map((p) => V(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const rAt = (u) => {
    const x = u * (radii.length - 1);
    const i = Math.min(radii.length - 2, Math.floor(x));
    return mix(radii[i], radii[i + 1], x - i);
  };
  const spines = 10;
  for (let i = 0; i < spines; i++) {
    const u = 0.26 + (i / spines) * 0.68;
    const p = curve.getPoint(u);
    const outwardDir = V(p.x, 0.25, p.z).normalize();
    const T = curve.getTangent(u);
    const nrm = outwardDir.clone().addScaledVector(T, -outwardDir.dot(T)).normalize();
    const r = rAt(u);
    const len = 0.1 + r * 0.7;
    const lean = nrm.clone().multiplyScalar(0.85).addScaledVector(T, 0.5).normalize();
    const g = new THREE.ConeGeometry(0.028 + r * 0.2, len + r * 0.5, 5, 1);
    g.translate(0, (len + r * 0.5) / 2, 0);
    // Rooted well under the skin, so the cone's base can never show.
    aimed(g, [p.x + nrm.x * r * 0.42, p.y + nrm.y * r * 0.42, p.z + nrm.z * r * 0.42], [lean.x, lean.y, lean.z]);
    parts.push({ geometry: paint(g), keepColor: true });
  }
  // Four short legs, each bent at the knee and gripping the urn with three claws. They stay inside the
  // dragon's own eighth of the way round.
  const leg = (rootU, side) => {
    const root = curve.getPoint(rootU);
    const az = Math.atan2(root.x, root.z);
    const footAz = THREE.MathUtils.clamp(az + side * 0.2, -0.36, 0.36);
    const footY = root.y - 0.2;
    const foot = surf(footY, footAz, 0.012);
    const kneeAz = (az + footAz) / 2 + side * 0.07;
    const knee = surf((root.y + footY) / 2 + 0.03, kneeAz, 0.2);
    parts.push({ geometry: paint(tube([[root.x, root.y, root.z], knee, foot], [0.09, 0.07, 0.048], { sides: 7, steps: 5, round: 1 })), keepColor: true });
    for (const off of [-0.08, 0, 0.08]) {
      const tip = surf(footY - 0.13, footAz + off * 0.9, 0.003);
      const mid = surf(footY - 0.05, footAz + off * 0.55, 0.045);
      parts.push({ geometry: paint(tube([foot, mid, tip], [0.032, 0.024, 0.002], { sides: 4, steps: 3, round: 0 })), keepColor: true });
    }
  };
  leg(0.3, -1);
  leg(0.34, 1);
  leg(0.62, 1);
  leg(0.68, -1);
  return mergeParts(parts);
}

// The mouth is a tilted ellipse, its back rim high where the upper jaw has thrown back, its front low: a
// toad with its head tipped up, which is what these describe.
const TOAD_MOUTH = { c: [0, 0.8, 0.2], a: 0.37, b: [0, 0.15, -0.26], up: [0, 0.86, 0.5] };

function toadSculpt() {
  const s = ZH.toadScale;
  const sc = new Sculpt(0.092);
  const bronze = lin(0x8d8440);
  const eyeGold = lin(0xe0bb4c);
  const mouthDark = lin(0x2c1611);
  const P = (x, y, z) => [x * s, y * s, z * s];
  const toes = [];
  const { c, a, b } = TOAD_MOUTH;
  sc.add(ellipsoidP(P(0, 0.36, -0.2), [0.58 * s, 0.38 * s, 0.56 * s]), bronze);
  sc.add(ellipsoidP(P(0, 0.58, 0.14), [0.46 * s, 0.3 * s, 0.4 * s]), bronze, { k: 0.12 });
  // The thrown-back upper jaw behind the rim, carrying the eyes.
  sc.add(ellipsoidP(P(0, 0.84, -0.08), [0.4 * s, 0.17 * s, 0.22 * s]), bronze, { k: 0.1 });
  const lip = [];
  const lipR = [];
  for (let i = 0; i <= 22; i++) {
    const t = (i / 22) * TAU;
    lip.push(P(c[0] + Math.cos(t) * a, c[1] + Math.sin(t) * b[1], c[2] + Math.sin(t) * b[2]));
    lipR.push(0.062 * s);
  }
  sc.add(segsPLoop(lip, lipR), bronze, { k: 0.05 });
  for (const m of [-1, 1]) {
    sc.add(ellipsoidP(P(m * 0.56, 0.27, -0.42), [0.25 * s, 0.27 * s, 0.37 * s]), bronze, { k: 0.09 });
    sc.add(curveP([P(m * 0.62, 0.08, -0.36), P(m * 0.76, 0.06, -0.08), P(m * 0.76, 0.05, 0.1)], [0.11 * s, 0.08 * s, 0.06 * s], 8), bronze, { k: 0.04 });
    for (const t of [-0.3, 0, 0.3]) toes.push([P(m * 0.76, 0.05, 0.08), P(m * (0.76 + t * 0.34), 0.04, 0.27)]);
    sc.add(curveP([P(m * 0.44, 0.46, 0.1), P(m * 0.58, 0.24, 0.3), P(m * 0.5, 0.07, 0.44)], [0.16 * s, 0.1 * s, 0.08 * s], 8), bronze, { k: 0.06 });
    for (const t of [-0.34, 0, 0.34]) toes.push([P(m * 0.5, 0.06, 0.44), P(m * (0.5 + t * 0.36), 0.04, 0.64)]);
    sc.add(ellipsoidP(P(m * 0.27, 0.99, -0.12), [0.115 * s, 0.11 * s, 0.11 * s]), eyeGold, { k: 0.05 });
  }
  // The void of the mouth, a bowl under the lip.
  sc.sub(ellipsoidP(P(0, 0.8, 0.2), [0.34 * s, 0.34 * s, 0.31 * s]), mouthDark, { k: 0.03 });
  const geometry = polygonize(sc, {
    uvScale: 3,
    tint: (x, y, z, nx, ny, nz, rgb) => {
      // The field's colour says how far along bronze-to-mouth or bronze-to-eye this vertex is. Blending
      // by that, rather than cutting at a threshold, is what keeps the lip from fraying on a coarse mesh.
      const toMouth = clamp01((bronze[0] - rgb[0]) / (bronze[0] - mouthDark[0]));
      const toEye = clamp01((rgb[0] - bronze[0]) / (eyeGold[0] - bronze[0]));
      const o = [0, 0, 0];
      bronzeTint(x + 4, y + 1, z + 2, o);
      const w = smoothNoise3(x * 14, y * 14, z * 14);
      if (w > 0.64 && y > 0.16) { o[0] *= 0.72; o[1] *= 0.72; o[2] *= 0.72; }
      const lipLight = 1 + 0.25 * (1 - toMouth) * toMouth * 4;
      for (let i = 0; i < 3; i++) {
        let v = mix(o[i] * lipLight, mouthDark[i], toMouth * toMouth);
        v = mix(v, eyeGold[i], toEye);
        rgb[i] = v;
      }
    },
  });
  const pupils = [];
  for (const m of [-1, 1]) {
    const look = V(m * 0.55, 0.62, 0.56).normalize();
    pupils.push({ geometry: ball(0.04 * s, [m * 0.27 * s + look.x * 0.088 * s, 0.99 * s + look.y * 0.088 * s, -0.12 * s + look.z * 0.088 * s], 8, 5), color: 0x14120c });
  }
  for (const [p, q] of toes) {
    pupils.push({ geometry: tintVertices(tube([p, q], [0.055 * s, 0.036 * s], { straight: true, steps: 2, sides: 5, round: 1 }), (x, y, z, o) => bronzeTint(x + 4, y + 1, z + 2, o)), keepColor: true });
  }
  return mergeParts([{ geometry, keepColor: true }, ...pupils]);
}

// A closed run of round cones, for a lip.
function segsPLoop(points, radii) {
  return segsP(points, radii);
}

// The cast decoration for one eighth of the way round, repeated eight times. Raised work is the pale
// gold, the ground between is green, and the same canvas is the bump map, so the raised work stands up.
function urnTexture(L) {
  const W = 768; const H = 1536;
  const { sampled } = L;
  let total = 0;
  const arc = [0];
  for (let i = 1; i < sampled.length; i++) { total += Math.hypot(sampled[i][0] - sampled[i - 1][0], sampled[i][1] - sampled[i - 1][1]); arc.push(total); }
  const arcAtY = (y) => {
    for (let i = 1; i < sampled.length; i++) {
      if (sampled[i][1] >= y) return mix(arc[i - 1], arc[i], (y - sampled[i - 1][1]) / Math.max(1e-6, sampled[i][1] - sampled[i - 1][1]));
    }
    return total;
  };
  const yPx = (y) => H - (arcAtY(y) / total) * H;
  const raised = '#b49b57';
  const ground = '#6d8268';
  const deep = '#4a604d';
  return canvasTexture(W, H, (ctx) => {
    const rng = seededRandom(47);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, W, H);
    // A cast ground is never flat: fine stippling all over.
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = rng() > 0.5 ? 'rgba(40,70,55,0.24)' : 'rgba(150,170,120,0.17)';
      ctx.fillRect(rng() * W, rng() * H, 2 + rng() * 2.5, 2 + rng() * 2.5);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (y, w = 7) => {
      ctx.fillStyle = raised;
      ctx.fillRect(0, yPx(y) - w / 2, W, w);
    };
    // Mountains, the lower band: rows of overlapping peaks with ridge lines, tiling across the sector.
    const peak = (cx, baseY, w, h, tone) => {
      for (const ox of [-W, 0, W]) {
        ctx.beginPath();
        ctx.moveTo(cx + ox - w / 2, baseY);
        ctx.bezierCurveTo(cx + ox - w * 0.34, baseY - h * 0.42, cx + ox - w * 0.25, baseY - h * 1.02, cx + ox, baseY - h);
        ctx.bezierCurveTo(cx + ox + w * 0.25, baseY - h * 1.02, cx + ox + w * 0.34, baseY - h * 0.42, cx + ox + w / 2, baseY);
        ctx.closePath();
        ctx.fillStyle = tone;
        ctx.fill();
        ctx.strokeStyle = deep;
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.strokeStyle = 'rgba(60,80,50,0.75)';
        ctx.lineWidth = 2.6;
        for (let r = -1; r <= 1; r++) {
          ctx.beginPath();
          ctx.moveTo(cx + ox + r * w * 0.05, baseY - h * 0.78);
          ctx.quadraticCurveTo(cx + ox + r * w * 0.12, baseY - h * 0.42, cx + ox + r * w * 0.22, baseY - h * 0.1);
          ctx.stroke();
        }
      }
    };
    const ridges = (top, bottom, layers) => {
      layers.forEach(({ frac, tone, peaks, phase, height }) => {
        const baseY = top + (bottom - top) * frac;
        const H0 = (bottom - top) * height;
        const ridge = (x) => {
          // Peaks that tile across the sector: sharp at the summit, spreading toward the foot.
          const u = (x / W) * peaks + phase;
          const f = u - Math.floor(u);
          const v = 1 - Math.abs(f * 2 - 1);
          const big = Math.pow(v, 1.2);
          const small = 0.2 * (1 - Math.abs(((u * 2.5) % 1) * 2 - 1)) * (0.4 + 0.6 * v);
          const vary = 0.82 + 0.18 * Math.sin((Math.floor(u) * TAU) / peaks + 1.2);
          return (big * 0.86 + small) * vary;
        };
        ctx.beginPath();
        ctx.moveTo(0, bottom);
        for (let x = 0; x <= W; x += 4) ctx.lineTo(x, baseY - ridge(x) * H0);
        ctx.lineTo(W, bottom);
        ctx.closePath();
        ctx.fillStyle = tone;
        ctx.fill();
        ctx.strokeStyle = deep;
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) { if (x === 0) ctx.moveTo(x, baseY - ridge(x) * H0); else ctx.lineTo(x, baseY - ridge(x) * H0); }
        ctx.stroke();
        // Hatching falling down the slopes, the way a Han caster drew a hillside.
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = 'rgba(60,78,52,0.7)';
        for (let x = 6; x < W; x += 15) {
          const y = baseY - ridge(x) * H0;
          ctx.beginPath();
          ctx.moveTo(x, y + 8);
          const dir = ((x / W) * peaks + phase) % 1 < 0.5 ? -1 : 1;
          ctx.lineTo(x + dir * 9, y + 8 + H0 * 0.2);
          ctx.stroke();
        }
      });
    };
    ridges(yPx(2.0), yPx(0.78), [
      { frac: 0.5, tone: '#858a58', peaks: 3, phase: 0.2, height: 0.5 },
      { frac: 0.76, tone: '#a39654', peaks: 2, phase: 0.55, height: 0.56 },
      { frac: 1.02, tone: raised, peaks: 3, phase: 0.05, height: 0.48 },
    ]);
    // Cloud scrolls, the belly band: curling strokes that hook back on themselves, the Han cloud pattern.
    const scroll = (cx, cy, r, dir, wid) => {
      for (const ox of [-W, 0, W]) {
        ctx.strokeStyle = raised;
        ctx.lineWidth = wid;
        ctx.beginPath();
        const turns = 1.6;
        for (let i = 0; i <= 44; i++) {
          const f = i / 44;
          const a = dir * f * turns * TAU;
          const rr = r * (1 - f * 0.86);
          const x = cx + ox + Math.cos(a) * rr * 1;
          const y = cy + Math.sin(a) * rr * 0.42;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    const tailStroke = (x0, y0, x1, y1, wid) => {
      for (const ox of [-W, 0, W]) {
        ctx.strokeStyle = raised;
        ctx.lineWidth = wid;
        ctx.beginPath();
        ctx.moveTo(x0 + ox, y0);
        ctx.quadraticCurveTo((x0 + x1) / 2 + ox, y0 - (y1 - y0) * 0.5 - 16, x1 + ox, y1);
        ctx.stroke();
      }
    };
    const c0 = yPx(2.14); const c1 = yPx(3.28);
    const cH = c0 - c1;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 3; i++) {
        const cx = ((i + (row % 2) * 0.5 + 0.25) / 3) * W;
        const cy = c1 + cH * (0.2 + row * 0.3);
        const r = 104;
        const dir = (i + row) % 2 ? 1 : -1;
        scroll(cx, cy, r, dir, 11);
        tailStroke(cx + dir * r, cy, cx + dir * (W / 3 - r * 0.4), cy + cH * 0.14, 8);
      }
    }
    // The shoulder: smaller clouds under the dragons.
    const s0 = yPx(3.36); const s1 = yPx(4.32);
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        const cx = ((i + (row % 2) * 0.5 + 0.2) / 5) * W;
        const cy = s1 + (s0 - s1) * (0.18 + row * 0.32);
        scroll(cx, cy, 58, i % 2 ? 1 : -1, 7);
      }
    }
    // Lozenges round the neck and at the foot.
    const lozenges = (y0, y1, n) => {
      const a = yPx(y0); const b = yPx(y1);
      const cy = (a + b) / 2;
      const hh = Math.abs(a - b) / 2 - 3;
      for (let i = 0; i < n; i++) {
        const cx = ((i + 0.5) / n) * W;
        const hw = (W / n) * 0.46;
        ctx.fillStyle = raised;
        ctx.beginPath();
        ctx.moveTo(cx - hw, cy); ctx.lineTo(cx, cy - hh); ctx.lineTo(cx + hw, cy); ctx.lineTo(cx, cy + hh);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = deep;
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.45, cy); ctx.lineTo(cx, cy - hh * 0.45); ctx.lineTo(cx + hw * 0.45, cy); ctx.lineTo(cx, cy + hh * 0.45);
        ctx.closePath();
        ctx.fill();
      }
    };
    lozenges(4.44, 4.72, 6);
    lozenges(0.62, 0.74, 8);
    // The lid: more mountains, the Han incense-burner idea, climbing to the knob.
    ridges(yPx(5.66), yPx(5.06), [
      { frac: 0.6, tone: '#8b8a55', peaks: 2, phase: 0.3, height: 0.5 },
      { frac: 1.02, tone: raised, peaks: 3, phase: 0.05, height: 0.6 },
    ]);
    for (const y of [0.76, 2.06, 3.32, 4.36, 4.74, 5.02, 5.7]) line(y, 9);
  });
}

function buildSeismoscope() {
  const L = seismoscopeLayout();
  const { items, sampled, urnR, frame } = L;
  const { baseTop, ballR, dragons, toads, fallen } = ZH;
  if (items.length !== 8 || dragons !== 8 || toads !== 8) throw new Error('eight dragons and eight toads');

  // The urn and its lid, one lathed casting.
  const urnRows = sampled.length - 1;
  const urn = latheSeamed([
    [0, baseTop - 0.02, 0],
    ...sampled.map(([r, y], i) => [r, y, i / urnRows]),
    [0, sampled[urnRows][1] + 0.02, 1],
  ], 56);
  tintVertices(urn, (x, y, z, out) => {
    const a = smoothNoise3(x * 0.9 + 4, y * 0.9, z * 0.9 + 8);
    const b = smoothNoise3(x * 3.1, y * 3.1 + 7, z * 3.1);
    const k = 0.84 + 0.3 * a + 0.16 * (b - 0.5);
    const g = clamp01(sstep(b + a * 0.4, 0.62, 0.92));
    out[0] = k * mix(1, 0.8, g); out[1] = k; out[2] = k * mix(0.94, 0.84, g);
  });
  const map = urnTexture(L);
  map.wrapS = THREE.RepeatWrapping;
  map.repeat.set(8, 1);
  const urnMesh = mesh(urn, standard({ vertexColors: true, map, bumpMap: map, bumpScale: 1.4, roughness: 0.56, metalness: 0.28 }));

  // Eight dragons and eight toads from one casting each, stood round by the layout's own bearings.
  const head = dragonHead(frame);
  const body = dragonBody(L);
  const toad = toadSculpt();
  const toadM = new THREE.Matrix4().makeTranslation(0, baseTop, ZH.mouthR - 0.2 * ZH.toadScale);
  toad.applyMatrix4(toadM);
  const parts = [];
  const balls = [];
  for (const item of items) {
    parts.push({ geometry: zhCopy(head, item.bearing), keepColor: true });
    parts.push({ geometry: zhCopy(body, item.bearing), keepColor: true });
    parts.push({ geometry: zhCopy(toad, item.bearing), keepColor: true });
    const at = item.ballIn === 'dragon' ? item.mouth : [item.toadMouth[0], item.toadMouth[1] - 0.075, item.toadMouth[2]];
    balls.push({ geometry: ball(ballR, at, 14, 10), color: 0xd2ad4f });
  }
  if (balls.length !== 8 || items.filter((i) => i.ballIn === 'toad').length !== 1 || items[fallen].ballIn !== 'toad') throw new Error('one ball has fallen');

  // The round base, with eight small marks cut in its rim, one to each bearing, the four main directions
  // longer than the four between. Letters would be wrong for the year 132.
  const base = lathe([[0, 0], [3, 0], [3, 0.05], [2.97, 0.1], [2.93, 0.13], [2.93, 0.21], [2.89, 0.25], [2.86, 0.3], [2.84, baseTop], [0, baseTop]], 64);
  tintVertices(base, (x, y, z, out) => bronzeTint(x + 1, y, z + 5, out));
  parts.push({ geometry: base, keepColor: true });
  for (const item of items) {
    const a = item.bearing;
    const long = item.index % 2 === 0;
    const r0 = long ? 2.56 : 2.66; const r1 = 2.8;
    const w = 0.022;
    const cx = Math.sin(a); const cz = Math.cos(a);
    const ox = cz * w; const oz = -cx * w;
    parts.push({
      geometry: plate([[cx * r0 + ox, cz * r0 + oz], [cx * r1 + ox, cz * r1 + oz], [cx * r1 - ox, cz * r1 - oz], [cx * r0 - ox, cz * r0 - oz]], baseTop - 0.01, baseTop + 0.004),
      color: 0x24241c,
    });
    const dot = lathe([[0, baseTop - 0.01], [0.042, baseTop - 0.01], [0.042, baseTop + 0.004], [0, baseTop + 0.004]], 12).translate(cx * (r1 + 0.03), 0, cz * (r1 + 0.03));
    parts.push({ geometry: dot, color: 0x24241c });
  }

  const group = new THREE.Group();
  group.add(urnMesh);
  group.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.56, metalness: 0.28, bumpMap: grainBump(71, { size: 192, dots: 1500, contrast: 0.42 }), bumpScale: 0.5 })));
  group.add(mesh(mergeParts(balls), standard({ vertexColors: true, roughness: 0.3, metalness: 0.42 })));
  return group;
}

// ---------------------------------------------------------------------------
// The builders the file exports. Each of the others is added below as it is written.
// ---------------------------------------------------------------------------

export const MATH5_LAYOUTS = { diamondLayout, graphiteLayout, tangramLayout, kleinLayout, polyArea, clockLayout, clockGearOutline, escapeOutline, anchorShapes, CK, seismoscopeLayout, ZH, dragonHead, dragonBody, toadSculpt };

export const BUILDERS = {
  'diamond-graphite': () => buildDiamondGraphite(),
  'tangram': () => buildTangram(),
  'klein-bottle': () => buildKlein(),
  'pendulum-clock': () => buildClock(),
  'zhang-heng-seismoscope': () => buildSeismoscope(),
};
