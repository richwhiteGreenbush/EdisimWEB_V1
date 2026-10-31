import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { standard, mesh, relief, seededRandom, canvasTexture } from '../../PropKit.js';
import {
  mergeParts, solidLoft, sweepProfile, solidSurface, tube, ball, weldSeam, smoothNoise3,
} from '../../props/LoftKit.js';

// The Model Database's Artifacts: Rosetta Stone, Viking longship, Greek amphora, Chinese abacus
// and covered wagon. All five are read at SIX FEET at their catalogue size, so what each one
// spends its triangles on is what a teacher would point at: the broken outline and the three
// scripts, the lapped strakes, the painted scene, the place-value beads, the running gear.
//
// House rules are PropKit's: feet at scale 1, origin at the base centre, front toward +Z, fresh
// materials and textures per call, seededRandom only. Canvases are painted forward and never
// read back, because node only has a stub.

// ---------------------------------------------------------------------------
// Winding, measured rather than assumed
// ---------------------------------------------------------------------------

function signedVolume(g) {
  const p = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : p.count;
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    const ax = p.getX(a); const ay = p.getY(a); const az = p.getZ(a);
    const bx = p.getX(b); const by = p.getY(b); const bz = p.getZ(b);
    const cx = p.getX(c); const cy = p.getY(c); const cz = p.getZ(c);
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

function flipped(g) {
  if (g.index) {
    const arr = g.index.array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    for (const attr of Object.values(g.attributes)) {
      const s = attr.itemSize;
      const arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) {
          const t = arr[(i + 1) * s + k];
          arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
          arr[(i + 2) * s + k] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  const nor = g.attributes.normal;
  if (nor) {
    for (let i = 0; i < nor.count; i++) nor.setXYZ(i, -nor.getX(i), -nor.getY(i), -nor.getZ(i));
  }
  return g;
}

// LoftKit's sweepProfile and tube are both wound inward (measured: -6.3 and -12.1 on a unit
// test). They are shared and shipped, so this file corrects them here rather than there, and a
// closed solid is always asked which way round it came out.
function outward(g) {
  return signedVolume(g) < 0 ? flipped(g) : g;
}

const swept = (points, profile, opts) => outward(sweepProfile(points, profile, opts));
const tubeOut = (points, radii, opts) => outward(tube(points, radii, opts));

// ---------------------------------------------------------------------------
// Solids
// ---------------------------------------------------------------------------

const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// A matrix whose +Z runs from a to b. Used for every timber, spoke and rope that is not on an
// axis: mergeParts' Euler cannot compose the rotations these need.
function alongMatrix(a, b, upHint = [0, 1, 0]) {
  const A = vec(a);
  const dir = vec(b).sub(A);
  const len = dir.length();
  dir.normalize();
  let up = vec(upHint);
  if (Math.abs(up.dot(dir)) > 0.98) up = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(up, dir).normalize();
  const up2 = new THREE.Vector3().crossVectors(dir, side).normalize();
  const m = new THREE.Matrix4().makeBasis(side, up2, dir);
  m.setPosition(A);
  return { m, len, dir, side, up: up2 };
}

// A prism with a FLAT-SHADED side per outline edge, lying along +Z from 0 to len. Worked timber
// is sawn, so its faces must not blend round the corner into a pillow; extrudeOutline shares one
// vertex per outline point and cannot do that. UVs are in feet with the grain along u.
function flatPrism(outline, len) {
  let area = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    area += x1 * y2 - x2 * y1;
  }
  const pts = area < 0 ? [...outline].reverse() : outline;
  const pos = []; const nor = []; const uv = []; const idx = [];
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const elen = Math.hypot(x2 - x1, y2 - y1) || 1e-6;
    const nx = (y2 - y1) / elen;
    const ny = -(x2 - x1) / elen;
    const b = pos.length / 3;
    pos.push(x1, y1, 0, x2, y2, 0, x2, y2, len, x1, y1, len);
    for (let k = 0; k < 4; k++) nor.push(nx, ny, 0);
    uv.push(0, run, 0, run + elen, len, run + elen, len, run);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    run += elen;
  }
  const tris = THREE.ShapeUtils.triangulateShape(pts.map(([x, y]) => new THREE.Vector2(x, y)), []);
  for (const [z, nz] of [[0, -1], [len, 1]]) {
    const b = pos.length / 3;
    for (const [x, y] of pts) { pos.push(x, y, z); nor.push(0, 0, nz); uv.push(x, y); }
    for (const [a, c, d] of tris) {
      if (nz > 0) idx.push(b + a, b + c, b + d);
      else idx.push(b + a, b + d, b + c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

const chamferRect = (w, h, c) => {
  const a = w / 2; const b = h / 2;
  return [[a - c, -b], [a, -b + c], [a, b - c], [a - c, b], [-a + c, b], [-a, b - c], [-a, -b + c], [-a + c, -b]];
};

// A sawn timber between two points, with a small chamfer so its arrises catch the light.
function bar(a, b, w, h, { chamfer = null, up = [0, 1, 0] } = {}) {
  const { m, len } = alongMatrix(a, b, up);
  const c = chamfer ?? Math.min(w, h) * 0.13;
  const g = flatPrism(chamferRect(w, h, c), len);
  g.applyMatrix4(m);
  return g;
}

// A round taper between two points with its grain along the length.
function rod(a, b, ra, rb = ra, seg = 12) {
  const { m, len } = alongMatrix(a, b);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  g.applyMatrix4(m);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * len, uv.getX(i) * ra * 6);
  return g;
}

// A closed flattened ball whose short axis lies along `normal`, for anything that has to be sunk
// into a surface rather than placed on it: a rivet, a boss, a port, a lens.
function stud(at, normal, radius, thickness, detail = 12) {
  const g = ball(radius, detail);
  g.scale(1, thickness / radius, 1);
  const n = vec(normal).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  const m = new THREE.Matrix4().compose(vec(at), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function coneAlong(base, tip, radius, { seg = 8, squash = 1, up = [0, 1, 0] } = {}) {
  const { m, len } = alongMatrix(base, tip, up);
  const g = new THREE.ConeGeometry(radius, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, len / 2);
  g.scale(squash, 1, 1);
  g.applyMatrix4(m);
  return g;
}

// A surface of revolution with a real seam column, so a texture can run once round it, and with
// its winding measured. Repeating a profile point makes a hard edge there, because the zero-area
// quad between the two copies contributes no normal. LoftKit's revolve shares its seam column and
// cannot carry a map that wraps. `rows` entries are [r, y] or [r, y, v].
function lathe(rows, { segments = 32, start = 0 } = {}) {
  const ring = segments + 1;
  const pos = []; const uv = []; const idx = [];
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const [r, y, v] = rows[i];
    for (let c = 0; c <= segments; c++) {
      const a = start + (c / segments) * Math.PI * 2;
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(c / segments, v ?? i / Math.max(1, n - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let c = 0; c < segments; c++) {
      const a = i * ring + c;
      const b = i * ring + c + 1;
      const d = (i + 1) * ring + c;
      const e = (i + 1) * ring + c + 1;
      idx.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  weldSeam(g, ring, n);
  return outward(g);
}

function smoothProfile(points, count) {
  const curve = new THREE.CatmullRomCurve3(points.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  return curve.getPoints(count).map((p) => [Math.max(0, p.x), p.y]);
}

function linearColor(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

function colored(g, hexOrFn) {
  // A per-vertex colour written straight onto the geometry, so a sub-assembly can go through
  // mergeParts with keepColor. fn(point, index) returns linear [r, g, b].
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const fixed = typeof hexOrFn === 'function' ? null : linearColor(hexOrFn);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let c = fixed;
    if (!c) {
      p.fromBufferAttribute(pos, i);
      c = hexOrFn(p, i);
    }
    arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// The Rosetta Stone
// ---------------------------------------------------------------------------

// Real stone 114.4 x 72.3 x 27.9 cm, here at exactly twice that: 7.5 x 4.75 x 1.83ft. The card
// says about 44in, which is the commonly quoted round figure, and 7.3 is what it asks for.
const RS_W = 4.75;
const RS_H = 7.3;
const RS_T = 1.83;
const RS_BASE = 0.58; // height of the plinth's top, where the stone goes in

// The real outline, read off the object, in fractions of width (-1..1) and height (0..1): the left
// edge nearly whole, the upper left chipped, the top a broken diagonal with its high point right of
// centre, the upper right gone and the lower right sliced away across the end of the Greek.
const RS_OUTLINE = [
  [-0.975, -0.03], [-0.55, -0.03], [-0.1, -0.03], [0.26, -0.03], [0.44, 0.012], [0.57, 0.075], [0.69, 0.098],
  [0.8, 0.165], [0.92, 0.215], [0.965, 0.3], [1.0, 0.365], [0.985, 0.47], [1.0, 0.58], [0.975, 0.68],
  [0.945, 0.755], [0.84, 0.808], [0.77, 0.862], [0.61, 0.89], [0.5, 0.945], [0.32, 0.975], [0.14, 1.0], [-0.06, 0.98],
  [-0.22, 0.948], [-0.42, 0.935], [-0.58, 0.895], [-0.76, 0.875], [-0.885, 0.825], [-0.97, 0.76],
  [-0.995, 0.65], [-0.985, 0.42], [-1.0, 0.2],
];

function rsField(seed, perim) {
  // Piecewise-planar fracture: the minimum of a set of tilted planes is a surface of genuinely flat
  // facets meeting at sharp arrises. Each plane climbs away outside its own window so it leaves
  // the minimum continuously rather than dropping out as a step.
  const rng = seededRandom(seed);
  const planes = [];
  const count = Math.round(perim / 0.16);
  for (let i = 0; i < count; i++) {
    planes.push({
      s: rng() * perim,
      z: (rng() - 0.5) * RS_T * 1.1,
      h: -0.015 - rng() * 0.11,
      gs: (rng() - 0.5) * 0.7,
      gz: (rng() - 0.5) * 0.7,
      ws: 0.24 + rng() * 0.3,
      wz: 0.2 + rng() * 0.32,
    });
  }
  // Each facet is a PATCH, bounded across the thickness as well as along the edge. Bounded along the
  // edge alone every facet runs the full thickness of the slab, and the broken top comes out as a
  // pleated curtain.
  return (s, z) => {
    let best = 1e9;
    for (const pl of planes) {
      let ds = s - pl.s;
      if (ds > perim / 2) ds -= perim;
      if (ds < -perim / 2) ds += perim;
      const a = Math.abs(ds);
      if (a > 1.1) continue;
      const dz = z - pl.z;
      const v = pl.h + pl.gs * ds + pl.gz * dz + 1.3 * Math.max(0, a - pl.ws) + 1.3 * Math.max(0, Math.abs(dz) - pl.wz);
      if (v < best) best = v;
    }
    return best === 1e9 ? 0 : best;
  };
}

function rosettaShape() {
  const ctrl = RS_OUTLINE.map(([x, y]) => [x * (RS_W / 2), y * RS_H]);
  const lens = [0];
  for (let i = 0; i < ctrl.length; i++) {
    const [ax, ay] = ctrl[i];
    const [bx, by] = ctrl[(i + 1) % ctrl.length];
    lens.push(lens[i] + Math.hypot(bx - ax, by - ay));
  }
  const perim = lens[ctrl.length];
  const N = 340;
  const base = [];
  for (let j = 0; j < N; j++) {
    const s = (j / N) * perim;
    let i = 0;
    while (lens[i + 1] < s) i++;
    const t = (s - lens[i]) / (lens[i + 1] - lens[i]);
    const [ax, ay] = ctrl[i];
    const [bx, by] = ctrl[(i + 1) % ctrl.length];
    base.push({ x: lerp(ax, bx, t), y: lerp(ay, by, t), s });
  }
  // Normals smoothed over a window, so the offsets at a sharp corner of the outline do not cross.
  for (let j = 0; j < N; j++) {
    let nx = 0; let ny = 0;
    for (let k = -6; k <= 6; k++) {
      const a = base[(j + k + N) % N];
      const b = base[(j + k + 1 + N) % N];
      nx += b.y - a.y;
      ny += -(b.x - a.x);
    }
    const l = Math.hypot(nx, ny) || 1;
    base[j].nx = nx / l;
    base[j].ny = ny / l;
    // How badly broken this stretch is: the top and the lower right are fractures, the left and
    // the right are the worn dressed sides of the original slab.
    const nh = base[j].y / RS_H;
    const nw = base[j].x / (RS_W / 2);
    const broken = Math.max(smooth(0.74, 0.82, nh), smooth(0.2, 0.42, nw) * (1 - smooth(0.26, 0.4, nh)));
    base[j].damage = lerp(0.42, 1.25, broken);
  }
  const big = rsField(196, perim);
  const small = rsField(1799, perim);
  const chipNoise = (s) => smoothNoise3(s * 1.7, 3.1, 7.7);
  const offset = (b, z) => {
    const zn = Math.abs(z) / (RS_T / 2);
    const bevel = (0.02 + 0.12 * chipNoise(b.s) * b.damage) * Math.pow(zn, 6);
    return big(b.s, z) * b.damage * 0.9 + small((b.s * 2.1) % perim, z) * 0.22 * b.damage - bevel;
  };
  const frontZ = RS_T / 2;
  const front = base.map((b) => {
    const o = offset(b, frontZ);
    return [b.x + b.nx * o, b.y + b.ny * o];
  });
  return { N, base, offset, front, perim };
}

function rosettaBody(shape) {
  const { N, base, offset } = shape;
  const K = 16;
  const pos = []; const uv = []; const idx = [];
  // Rim rows from the front arris to the back arris.
  for (let k = 0; k <= K; k++) {
    const z = lerp(RS_T / 2, -RS_T / 2, k / K);
    for (let j = 0; j < N; j++) {
      const b = base[j];
      const o = offset(b, z);
      pos.push(b.x + b.nx * o, b.y + b.ny * o, z);
      uv.push(b.s, z);
    }
  }
  const at = (k, j) => k * N + ((j + N) % N);
  for (let k = 0; k < K; k++) {
    for (let j = 0; j < N; j++) {
      idx.push(at(k, j), at(k + 1, j), at(k + 1, j + 1), at(k, j), at(k + 1, j + 1), at(k, j + 1));
    }
  }
  // The back is roughly hewn, never finished. It is a SMOOTH field, deliberately: the rings of this
  // grid converge on the centre, so a faceted field creased along them and the back rendered as the
  // end of a sawn log. The chisel texture is left to the relief map, which has no such grid.
  const hewAt = (x, y) => 0.09 * smoothNoise3(x * 0.9 + 3, y * 0.9, 1.7) + 0.035 * smoothNoise3(x * 2.3, y * 2.3, 5.1);
  const R = 9;
  const cx = 0; const cy = RS_H * 0.5;
  const backRow = K;
  for (let r = 1; r < R; r++) {
    const f = 1 - r / R;
    const edge = smooth(0, 0.26, 1 - f);
    for (let j = 0; j < N; j++) {
      const i0 = at(backRow, j) * 3;
      const x = cx + (pos[i0] - cx) * f;
      const y = cy + (pos[i0 + 1] - cy) * f;
      pos.push(x, y, -RS_T / 2 - hewAt(x, y) * edge);
      uv.push(x, y);
    }
  }
  const rowOf = (r, j) => (r === 0 ? at(backRow, j) : (K + r) * N + ((j + N) % N));
  for (let r = 0; r < R - 1; r++) {
    for (let j = 0; j < N; j++) {
      idx.push(rowOf(r, j), rowOf(r + 1, j), rowOf(r + 1, j + 1), rowOf(r, j), rowOf(r + 1, j + 1), rowOf(r, j + 1));
    }
  }
  const centre = pos.length / 3;
  pos.push(cx, cy, -RS_T / 2 - hewAt(cx, cy));
  uv.push(0, 0);
  for (let j = 0; j < N; j++) idx.push(rowOf(R - 1, j), centre, rowOf(R - 1, j + 1));

  let g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g = outward(g);
  g.computeVertexNormals();
  // Creased, not smooth and not flat: fracture facets stay flat and the arrises between them stay
  // sharp, and a flat-shaded grid would show its own tessellation instead.
  g = toCreasedNormals(g, THREE.MathUtils.degToRad(24));
  // Far paler than the polished face. Facing away from the sun the back gets the hemisphere's fill
  // alone, and at the face's own tone it rendered as a black silhouette with no surface at all.
  const stone = linearColor(0x5b5a5c);
  const fresh = linearColor(0x69645f);
  return colored(g, (p) => {
    const m = smoothNoise3(p.x * 0.9, p.y * 0.9, p.z * 0.9 + 4);
    const fine = smoothNoise3(p.x * 4.3, p.y * 4.3, p.z * 4.3);
    const broke = smooth(0.74, 0.9, p.y / RS_H) * 0.75 + smooth(0.5, 1.1, p.x) * (1 - smooth(1.9, 2.9, p.y)) * 0.7;
    const k = 0.72 + m * 0.42 + (fine - 0.5) * 0.2;
    return [lerp(stone[0], fresh[0], broke) * k, lerp(stone[1], fresh[1], broke) * k, lerp(stone[2], fresh[2], broke) * k];
  });
}

// ---- the three scripts, drawn as paths -------------------------------------------------------
// These are REPRESENTATIVE signs of the right character, as the card says: they read as hieroglyphs,
// Demotic and Greek, and they are not the text. Everything is unit-box canvas paths, so nothing
// depends on a font having an Egyptian block and nothing can arrive as an emoji.

const HIERO_SIGNS = {
  reed(c) {
    c.beginPath(); c.moveTo(0.34, 1); c.quadraticCurveTo(0.12, 0.45, 0.55, 0.02); c.quadraticCurveTo(0.86, 0.5, 0.62, 1); c.closePath(); c.fill();
  },
  bird(c) {
    c.beginPath(); c.moveTo(0.04, 0.72); c.quadraticCurveTo(0.28, 0.32, 0.62, 0.36); c.quadraticCurveTo(0.6, 0.14, 0.76, 0.12);
    c.quadraticCurveTo(0.9, 0.12, 0.92, 0.24); c.lineTo(1, 0.3); c.lineTo(0.88, 0.34); c.quadraticCurveTo(0.86, 0.62, 0.56, 0.72); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(0.38, 0.7); c.lineTo(0.34, 1); c.moveTo(0.54, 0.7); c.lineTo(0.56, 1); c.moveTo(0.26, 1); c.lineTo(0.42, 1); c.moveTo(0.48, 1); c.lineTo(0.66, 1); c.stroke();
  },
  owl(c) {
    c.beginPath(); c.ellipse(0.5, 0.22, 0.24, 0.2, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(0.28, 0.3); c.quadraticCurveTo(0.2, 0.75, 0.36, 0.86); c.lineTo(0.72, 0.86); c.quadraticCurveTo(0.84, 0.5, 0.72, 0.3); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(0.42, 0.86); c.lineTo(0.42, 1); c.moveTo(0.62, 0.86); c.lineTo(0.62, 1); c.stroke();
  },
  water(c) {
    c.beginPath(); c.moveTo(0, 0.55);
    for (let i = 0; i < 6; i++) { c.lineTo((i + 0.5) / 6, i % 2 ? 0.72 : 0.3); c.lineTo((i + 1) / 6, 0.55); }
    c.stroke();
  },
  mouth(c) {
    c.beginPath(); c.moveTo(0, 0.5); c.quadraticCurveTo(0.5, 0.02, 1, 0.5); c.quadraticCurveTo(0.5, 0.98, 0, 0.5); c.closePath(); c.fill();
  },
  loaf(c) {
    c.beginPath(); c.moveTo(0.02, 0.92); c.quadraticCurveTo(0.5, -0.3, 0.98, 0.92); c.closePath(); c.fill();
  },
  basket(c) {
    c.beginPath(); c.moveTo(0.02, 0.1); c.lineTo(0.98, 0.1); c.quadraticCurveTo(0.9, 0.95, 0.5, 0.95); c.quadraticCurveTo(0.1, 0.95, 0.02, 0.1); c.closePath(); c.fill();
  },
  loop(c) {
    c.beginPath(); c.ellipse(0.5, 0.42, 0.34, 0.36, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(0.14, 0.92); c.lineTo(0.86, 0.92); c.stroke();
  },
  oval(c) {
    c.beginPath(); c.ellipse(0.5, 0.5, 0.46, 0.3, 0, 0, Math.PI * 2); c.fill();
  },
  sun(c) {
    c.beginPath(); c.ellipse(0.5, 0.5, 0.4, 0.4, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.ellipse(0.5, 0.5, 0.08, 0.08, 0, 0, Math.PI * 2); c.fill();
  },
  ankh(c) {
    c.beginPath(); c.ellipse(0.5, 0.2, 0.2, 0.18, 0, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(0.5, 0.38); c.lineTo(0.5, 1); c.moveTo(0.12, 0.5); c.lineTo(0.88, 0.5); c.stroke();
  },
  arm(c) {
    c.beginPath(); c.moveTo(0, 0.28); c.quadraticCurveTo(0.5, 0.12, 0.8, 0.34); c.lineTo(1, 0.3); c.lineTo(1, 0.52); c.lineTo(0.7, 0.68); c.quadraticCurveTo(0.34, 0.7, 0, 0.76); c.closePath(); c.fill();
  },
  viper(c) {
    c.beginPath(); c.moveTo(0, 0.82); c.bezierCurveTo(0.2, 0.3, 0.42, 1.0, 0.62, 0.55); c.bezierCurveTo(0.72, 0.3, 0.82, 0.3, 0.94, 0.42); c.stroke();
    c.beginPath(); c.moveTo(0.8, 0.34); c.lineTo(0.76, 0.12); c.moveTo(0.9, 0.36); c.lineTo(0.92, 0.14); c.stroke();
  },
  foot(c) {
    c.beginPath(); c.moveTo(0.1, 0.04); c.lineTo(0.42, 0.04); c.lineTo(0.5, 0.62); c.quadraticCurveTo(0.9, 0.66, 0.98, 0.96); c.lineTo(0.08, 0.96); c.closePath(); c.fill();
  },
  stool(c) {
    c.fillRect(0.1, 0.12, 0.8, 0.76);
  },
  bar(c) {
    c.fillRect(0.36, 0.02, 0.28, 0.96);
  },
  man(c) {
    c.beginPath(); c.ellipse(0.5, 0.14, 0.15, 0.13, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(0.3, 0.3); c.lineTo(0.66, 0.3); c.lineTo(0.72, 0.62); c.lineTo(0.92, 0.72); c.lineTo(0.92, 1); c.lineTo(0.2, 1); c.quadraticCurveTo(0.18, 0.6, 0.3, 0.3); c.closePath(); c.fill();
  },
  pillar(c) {
    c.fillRect(0.34, 0.2, 0.32, 0.8);
    for (const y of [0.02, 0.09, 0.16]) c.fillRect(0.2, y, 0.6, 0.045);
  },
  flag(c) {
    c.beginPath(); c.moveTo(0.3, 1); c.lineTo(0.3, 0.04); c.lineTo(0.78, 0.2); c.lineTo(0.42, 0.34); c.lineTo(0.42, 1); c.closePath(); c.fill();
  },
};
const TALL_SIGNS = ['reed', 'reed', 'ankh', 'pillar', 'flag', 'bird', 'owl', 'man', 'bird', 'bar'];
const SQUARE_SIGNS = ['bird', 'bird', 'owl', 'sun', 'loop', 'stool', 'foot', 'man'];
const WIDE_SIGNS = ['water', 'water', 'mouth', 'loaf', 'basket', 'oval', 'arm', 'viper'];

function drawSign(ctx, kind, x, y, w, h, weight) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w, h);
  ctx.lineWidth = weight / Math.min(w, h);
  HIERO_SIGNS[kind](ctx);
  ctx.restore();
}

// Everything incised is drawn twice: a dark offset for the cut's shadowed wall, then the pale fill.
function incised(ctx, dark, pale, draw) {
  ctx.save();
  ctx.translate(-1.1, -1.1);
  ctx.fillStyle = dark; ctx.strokeStyle = dark;
  draw();
  ctx.restore();
  ctx.fillStyle = pale; ctx.strokeStyle = pale;
  draw();
}

function paintHieroglyphs(ctx, px, top, bottom, rng) {
  const rows = 9;
  const rowH = (bottom - top) / rows;
  const margin = 0.1 * px;
  const W = ctx.canvas.width;
  const size = rowH * 0.8;
  const cartoucheEvery = [2, 4, 7];
  for (let r = 0; r < rows; r++) {
    // Rows are slightly out of level on the real stone, cut by eye.
    const y = top + r * rowH + rowH * 0.1 + (rng() - 0.5) * 2.4;
    let x = margin + rng() * 6;
    const putCartouche = cartoucheEvery.includes(r) ? Math.floor(rng() * 6) + 4 : -1;
    let group = 0;
    while (x < W - margin) {
      const roll = rng();
      const px0 = x;
      const y0 = y;
      if (group === putCartouche) {
        // The royal ring: Ptolemy's name stood in one of these, which is how the first signs were
        // read. It is the feature that made decipherment possible, so it stays visible.
        const len = size * 2.9;
        const sg = [];
        for (let i = 0; i < 4; i++) sg.push(SQUARE_SIGNS[Math.floor(rng() * SQUARE_SIGNS.length)]);
        incised(ctx, 'rgba(10,10,12,0.8)', 'rgba(196,190,174,0.86)', () => {
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          ctx.ellipse(px0 + len / 2, y0 + size / 2, len / 2 - 3, size / 2 + 1, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillRect(px0 + len - 4, y0 - 2, 3.4, size + 4);
          sg.forEach((k, i) => drawSign(ctx, k, px0 + size * 0.28 + i * size * 0.6, y0 + size * 0.2, size * 0.5, size * 0.6, 2.4));
        });
        x += len + size * 0.2;
        group += 1;
        continue;
      }
      let adv;
      if (roll < 0.34) {
        const k = TALL_SIGNS[Math.floor(rng() * TALL_SIGNS.length)];
        const w = size * (k === 'bird' || k === 'owl' || k === 'man' ? 0.8 : 0.46);
        incised(ctx, 'rgba(10,10,12,0.8)', 'rgba(196,190,174,0.86)', () => drawSign(ctx, k, px0, y0, w, size, 3.4));
        adv = w;
      } else if (roll < 0.58) {
        const a = TALL_SIGNS[Math.floor(rng() * 5)];
        const b = TALL_SIGNS[Math.floor(rng() * 5)];
        const w = size * 0.36;
        incised(ctx, 'rgba(10,10,12,0.8)', 'rgba(196,190,174,0.86)', () => {
          drawSign(ctx, a, px0, y0, w, size, 3);
          drawSign(ctx, b, px0 + w + 1.5, y0, w, size, 3);
        });
        adv = w * 2 + 1.5;
      } else if (roll < 0.86) {
        const a = WIDE_SIGNS[Math.floor(rng() * WIDE_SIGNS.length)];
        const b = WIDE_SIGNS[Math.floor(rng() * WIDE_SIGNS.length)];
        const w = size * 0.86;
        incised(ctx, 'rgba(10,10,12,0.8)', 'rgba(196,190,174,0.86)', () => {
          drawSign(ctx, a, px0, y0, w, size * 0.44, 3.4);
          drawSign(ctx, b, px0, y0 + size * 0.54, w, size * 0.44, 3.4);
        });
        adv = w;
      } else {
        const k = SQUARE_SIGNS[Math.floor(rng() * SQUARE_SIGNS.length)];
        const w = size * 0.82;
        incised(ctx, 'rgba(10,10,12,0.8)', 'rgba(196,190,174,0.86)', () => drawSign(ctx, k, px0, y0, w, size, 3.4));
        adv = w;
      }
      x += adv + size * 0.13;
      group += 1;
    }
  }
}

function paintDemotic(ctx, top, bottom, rng) {
  const rows = 21;
  const rowH = (bottom - top) / rows;
  const W = ctx.canvas.width;
  const margin = 0.07 * W;
  const dark = 'rgba(8,8,10,0.6)';
  const pale = 'rgba(190,184,168,0.8)';
  ctx.lineCap = 'round';
  for (let r = 0; r < rows; r++) {
    const base = top + (r + 0.74) * rowH;
    const h = rowH * 0.62;
    const strokes = [];
    let x = margin - 40 + rng() * 40;
    while (x < W - margin + 40) {
      // A "word": a run of ligatured strokes with a long horizontal tying it together, which is what
      // makes Demotic read as handwriting rather than as a row of separate signs.
      const glyphs = 2 + Math.floor(rng() * 5);
      const start = x;
      for (let g = 0; g < glyphs; g++) {
        const kind = rng();
        const a = x; const b = base;
        const lean = h * (0.15 + rng() * 0.3);
        if (kind < 0.3) strokes.push(['q', a, b, a + lean * 0.4, b - h * 0.6, a + lean, b - h]);
        else if (kind < 0.55) strokes.push(['q', a, b - h * 0.8, a + h * 0.6, b - h * 0.9, a + h * 0.3, b - h * 0.1]);
        else if (kind < 0.75) strokes.push(['c', a, b - h * 0.1, a + h * 0.2, b - h * 1.1, a + h * 0.8, b - h * 0.8, a + h * 0.5, b]);
        else if (kind < 0.88) strokes.push(['l', a, b - h * 0.5, a + h * 0.3, b - h * 0.7]);
        else strokes.push(['d', a + h * 0.2, b - h * 0.3]);
        x += h * (0.34 + rng() * 0.34);
      }
      strokes.push(['q', start, base - h * 0.1, (start + x) / 2, base + h * 0.2, x, base - h * 0.15]);
      x += h * (0.32 + rng() * 0.3);
    }
    const draw = () => {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const st of strokes) {
        if (st[0] === 'q') { ctx.moveTo(st[1], st[2]); ctx.quadraticCurveTo(st[3], st[4], st[5], st[6]); }
        if (st[0] === 'c') { ctx.moveTo(st[1], st[2]); ctx.bezierCurveTo(st[3], st[4], st[5], st[6], st[7], st[8]); }
        if (st[0] === 'l') { ctx.moveTo(st[1], st[2]); ctx.lineTo(st[3], st[4]); }
      }
      ctx.stroke();
      for (const st of strokes) if (st[0] === 'd') ctx.fillRect(st[1], st[2], 3.4, 3.4);
    };
    incised(ctx, dark, pale, draw);
  }
}

const GREEK_LETTERS = 'ΑΑΑΑΒΓΔΕΕΕΕΗΗΘΙΙΙΙΚΛΜΝΝΝΝΞΟΟΟΟΟΠΡΡΣΣΣΣΤΤΤΥΥΦΧΩΩ';

function paintGreek(ctx, top, bottom, rng) {
  const rows = 31;
  const rowH = (bottom - top) / rows;
  const W = ctx.canvas.width;
  const margin = 0.055 * W;
  const size = Math.round(rowH * 0.74);
  ctx.font = `600 ${size}px Arial, Helvetica, "Liberation Sans", sans-serif`;
  ctx.textBaseline = 'alphabetic';
  for (let r = 0; r < rows; r++) {
    const y = top + (r + 0.86) * rowH;
    let x = margin + rng() * 4;
    const line = [];
    while (x < W - margin) {
      const ch = GREEK_LETTERS[Math.floor(rng() * GREEK_LETTERS.length)];
      line.push([ch, x, y + (rng() - 0.5) * 0.9]);
      x += ctx.measureText(ch).width + size * 0.2;
    }
    for (const [fill, dx] of [['rgba(8,8,10,0.6)', -1], ['rgba(190,184,168,0.82)', 0]]) {
      ctx.fillStyle = fill;
      for (const [ch, lx, ly] of line) ctx.fillText(ch, lx + dx, ly + dx);
    }
  }
}

function rosettaFaceTexture(shape) {
  const CW = 1536;
  const CH = Math.round(CW * (RS_H / RS_W));
  const px = CW / RS_W;
  const toPx = ([x, y]) => [(x + RS_W / 2) * px, CH - y * px];
  return canvasTexture(CW, CH, (ctx, w, h) => {
    const rng = seededRandom(19600);
    // Granodiorite: dark ground, fine pale and black crystal fleck, a broad mottle.
    ctx.fillStyle = '#3e3e41';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = rng() * w; const y = rng() * h; const r = 40 + rng() * 150;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(68,66,68,0.16)' : 'rgba(26,26,30,0.18)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 52000; i++) {
      const v = rng();
      ctx.fillStyle = v < 0.34 ? 'rgba(112,106,102,0.5)' : v < 0.68 ? 'rgba(16,16,18,0.55)' : 'rgba(146,126,118,0.3)';
      const s = 1 + rng() * 1.8;
      ctx.fillRect(rng() * w, rng() * h, s, s);
    }
    // The pink vein that runs across the real stone's upper left.
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(158,112,108,0.28)';
    ctx.lineWidth = 34;
    ctx.beginPath(); ctx.moveTo(-30, h * 0.29); ctx.bezierCurveTo(w * 0.2, h * 0.24, w * 0.32, h * 0.12, w * 0.5, -20); ctx.stroke();
    ctx.strokeStyle = 'rgba(176,132,122,0.24)';
    ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(-30, h * 0.262); ctx.bezierCurveTo(w * 0.22, h * 0.22, w * 0.3, h * 0.1, w * 0.42, -20); ctx.stroke();

    // Everything cut is clipped to the same fracture line the mesh is built from, so a line of text
    // ends at the break exactly, the way the real inscription does. One description, used twice.
    ctx.save();
    ctx.beginPath();
    shape.front.forEach((p, i) => {
      const [x, y] = toPx(p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();

    paintHieroglyphs(ctx, px, h * 0.03, h * 0.285, rng);
    paintDemotic(ctx, h * 0.293, h * 0.60, rng);
    paintGreek(ctx, h * 0.608, h * 0.985, rng);

    // Two thousand years of wear: soft patches that take the cut back toward the stone.
    // Many faint overlapping smears rather than a few strong ones, which come out as polka dots.
    for (let i = 0; i < 260; i++) {
      const x = rng() * w; const y = rng() * h; const r = 18 + rng() * 90;
      ctx.fillStyle = `rgba(60,60,63,${0.03 + rng() * 0.08})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.2 + rng() * 0.4), rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    // Scratches and small flake scars.
    for (let i = 0; i < 90; i++) {
      const x = rng() * w; const y = rng() * h; const a = rng() * 6.3; const l = 14 + rng() * 80;
      ctx.strokeStyle = rng() < 0.5 ? 'rgba(160,152,142,0.22)' : 'rgba(10,10,12,0.3)';
      ctx.lineWidth = 0.8 + rng() * 1.3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    for (let i = 0; i < 40; i++) {
      const x = rng() * w; const y = rng() * h; const r = 3 + rng() * 11;
      ctx.fillStyle = 'rgba(110,104,100,0.42)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // A worn band inside the broken edge, where the polished face has spalled.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(92,86,84,0.5)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    shape.front.forEach((p, i) => {
      const [x, y] = toPx(p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  });
}

function stoneGrainTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const rng = seededRandom(77);
    ctx.fillStyle = '#e9e7e4';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) {
      const v = rng();
      ctx.fillStyle = v < 0.5 ? 'rgba(60,58,58,0.42)' : 'rgba(255,250,244,0.6)';
      const s = 1 + rng() * 1.6;
      ctx.fillRect(rng() * (w - 2), rng() * (h - 2), s, s);
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.3, 1.3);
  return tex;
}

function rosettaStone() {
  const root = new THREE.Group();
  const shape = rosettaShape();

  // The inscribed face. It is flat and it carries the writing, so it is one ear-clipped polygon whose
  // edge IS the first row of the rim: there is no seam to open between the two.
  const tris = THREE.ShapeUtils.triangulateShape(shape.front.map(([x, y]) => new THREE.Vector2(x, y)), []);
  const facePos = []; const faceUv = []; const faceNor = []; const faceIdx = [];
  for (const [x, y] of shape.front) {
    facePos.push(x, y, RS_T / 2);
    faceNor.push(0, 0, 1);
    faceUv.push((x + RS_W / 2) / RS_W, y / RS_H);
  }
  for (const [a, b, c] of tris) faceIdx.push(a, b, c);
  const faceGeo = new THREE.BufferGeometry();
  faceGeo.setIndex(faceIdx);
  faceGeo.setAttribute('position', new THREE.Float32BufferAttribute(facePos, 3));
  faceGeo.setAttribute('normal', new THREE.Float32BufferAttribute(faceNor, 3));
  faceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(faceUv, 2));
  const faceMap = rosettaFaceTexture(shape);
  // A negative bump, because a pale mark on this canvas is a cut and must read lower than the stone.
  const face = mesh(faceGeo, standard({ map: faceMap, bumpMap: faceMap, bumpScale: -1.4, roughness: 0.6, metalness: 0 }));
  face.position.y = RS_BASE;
  root.add(face);

  const bodyGeo = rosettaBody(shape);
  // A dark stone's shaded side gets the hemisphere's fill alone, which is a third of what its lit side
  // gets. No single albedo serves both, so the small flat emissive is what keeps the back a surface.
  const body = mesh(bodyGeo, standard({
    vertexColors: true, map: stoneGrainTexture(), roughness: 0.92, metalness: 0, emissive: 0x232325, ...relief('stone', { seed: 196, repeat: 1.1, strength: 1.2 }),
  }));
  body.position.y = RS_BASE;
  root.add(body);

  // The plinth, in three stepped courses with crisp arrises. The stone goes down INTO the top course,
  // so its foot has no daylight under it.
  const stoneTone = 0x77736a;
  const plinthParts = [];
  const course = (w, d, y0, y1, color) => {
    const g = bar([0, y0 + (y1 - y0) / 2, -d / 2], [0, y0 + (y1 - y0) / 2, d / 2], w, y1 - y0, { chamfer: 0.025 });
    plinthParts.push({ geometry: g, color });
  };
  course(6.5, 3.5, 0, 0.14, 0x625e56);
  course(6.2, 3.2, 0.14, 0.46, stoneTone);
  course(5.9, 2.9, 0.46, RS_BASE, 0x858178);
  const plinth = mesh(mergeParts(plinthParts), standard({ vertexColors: true, roughness: 0.82, metalness: 0, ...relief('stone', { seed: 12, repeat: 0.5, strength: 0.32 }) }));
  root.add(plinth);

  // A museum label set into the plinth's front course. A closed thin box, its other faces mapped to
  // the plate's own edge colour.
  const labelTex = canvasTexture(512, 92, (ctx, w, h) => {
    ctx.fillStyle = '#2d2a26';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#bda877';
    ctx.lineWidth = 3;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    ctx.fillStyle = '#e6dcc0';
    let size = 42;
    const text = 'ROSETTA STONE  ·  196 BCE';
    for (; size > 14; size -= 1) {
      ctx.font = `bold ${size}px Georgia, "Times New Roman", serif`;
      if (ctx.measureText(text).width < w - 56) break;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
  const labelGeo = new THREE.BoxGeometry(1.75, 0.3, 0.05);
  const uvA = labelGeo.attributes.uv;
  for (let i = 0; i < uvA.count; i++) {
    if (i < 16 || i >= 20) uvA.setXY(i, 0.004, 0.5);
  }
  const label = mesh(labelGeo, standard({ map: labelTex, roughness: 0.5, metalness: 0 }));
  label.position.set(0, 0.3, 1.6 + 0.012);
  root.add(label);
  return root;
}

// ---------------------------------------------------------------------------
// The Greek amphora
// ---------------------------------------------------------------------------

const AM_W = 2048;
const AM_H = 1408;

const AM_OUTER = [
  [0.98, 0.17], [1.05, 0.22], [1.06, 0.3], [0.97, 0.39], [0.78, 0.45], [0.71, 0.54], [0.8, 0.72], [1.06, 1.02],
  [1.36, 1.44], [1.66, 1.98], [1.93, 2.62], [2.09, 3.2], [2.12, 3.48], [2.06, 3.78], [1.86, 4.06], [1.53, 4.32],
  [1.17, 4.52], [0.9, 4.66], [0.75, 4.82], [0.69, 5.02], [0.69, 5.24], [0.73, 5.42], [0.85, 5.6], [1.03, 5.74],
  [1.14, 5.82], [1.16, 5.88], [1.1, 5.93], [0.98, 5.94], [0.84, 5.88],
];

function amphoraProfile() {
  const pts = smoothProfile(AM_OUTER, 150);
  const arcs = [0];
  for (let i = 1; i < pts.length; i++) arcs.push(arcs[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = arcs[arcs.length - 1];
  // Where on the canvas a given HEIGHT lands. The texture runs along the profile's arc, not its
  // height, so the shoulder (which is nearly level) still gets its full share of pixels.
  const arcAtY = (y) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] >= y) {
        const t = (y - pts[i - 1][1]) / Math.max(1e-6, pts[i][1] - pts[i - 1][1]);
        return lerp(arcs[i - 1], arcs[i], t);
      }
    }
    return total;
  };
  const rAtY = (y) => {
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][1] >= y) {
        const t = (y - pts[i - 1][1]) / Math.max(1e-6, pts[i][1] - pts[i - 1][1]);
        return lerp(pts[i - 1][0], pts[i][0], t);
      }
    }
    return pts[pts.length - 1][0];
  };
  return { pts, arcs, total, arcAtY, rAtY };
}

// One smooth outline through a list of points, by midpoint quadratics. Repeat a point for a corner.
function smoothPath(c, pts, closed = true) {
  const n = pts.length;
  if (closed) {
    const [ax, ay] = pts[n - 1];
    const [bx, by] = pts[0];
    c.moveTo((ax + bx) / 2, (ay + by) / 2);
    for (let i = 0; i < n; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[(i + 1) % n];
      c.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    }
    c.closePath();
  } else {
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const [px, py] = pts[i];
      const [qx, qy] = pts[i + 1];
      c.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    }
    c.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}

function capsule(c, a, b, ra, rb) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const ang = Math.atan2(dy, dx);
  const px = Math.cos(ang + Math.PI / 2); const py = Math.sin(ang + Math.PI / 2);
  c.beginPath();
  c.moveTo(a[0] + px * ra, a[1] + py * ra);
  c.lineTo(b[0] + px * rb, b[1] + py * rb);
  c.arc(b[0], b[1], rb, ang + Math.PI / 2, ang - Math.PI / 2, true);
  c.lineTo(a[0] - px * ra, a[1] - py * ra);
  c.arc(a[0], a[1], ra, ang - Math.PI / 2, ang + Math.PI / 2, true);
  c.closePath();
  c.fill();
}

// A horse in the Attic manner: a strict profile with a long neck and thin legs, the whole animal a
// flat black silhouette and everything inside it scratched through to the clay with a point. That
// scratched line is what black-figure IS, and the card says so.
function drawHorse(c, pal) {
  c.fillStyle = pal.slip;
  // The far legs first, one step out of phase with the near ones.
  capsule(c, [0.72, -0.82], [0.62, -0.46], 0.075, 0.042);
  capsule(c, [0.62, -0.46], [0.66, -0.08], 0.042, 0.03);
  c.beginPath(); smoothPath(c, [[0.6, -0.1], [0.74, -0.1], [0.8, 0], [0.8, 0], [0.58, 0], [0.58, 0]]); c.fill();
  capsule(c, [-0.62, -0.88], [-0.72, -0.5], 0.12, 0.05);
  capsule(c, [-0.72, -0.5], [-0.6, -0.08], 0.046, 0.03);
  c.beginPath(); smoothPath(c, [[-0.67, -0.1], [-0.53, -0.1], [-0.47, 0], [-0.47, 0], [-0.69, 0], [-0.69, 0]]); c.fill();

  c.beginPath();
  smoothPath(c, [
    [1.6, -1.62], [1.6, -1.53], [1.46, -1.5], [1.3, -1.56], [1.14, -1.58], [1.05, -1.36], [1.0, -1.1], [0.88, -0.84],
    [0.92, -0.72], [1.06, -0.48], [1.03, -0.45], [1.0, -0.2], [1.02, -0.1], [1.1, 0], [1.1, 0], [0.87, 0], [0.87, 0], [0.88, -0.12], [0.86, -0.44], [0.82, -0.5],
    [0.72, -0.74], [0.4, -0.72], [0, -0.7], [-0.4, -0.76], [-0.55, -0.72], [-0.68, -0.56], [-0.92, -0.42],
    [-0.86, -0.2], [-0.84, -0.1], [-0.74, 0], [-0.74, 0], [-0.97, 0], [-0.97, 0], [-0.97, -0.12], [-1.07, -0.42], [-1.06, -0.5], [-0.98, -0.74], [-1.12, -1.0],
    [-1.13, -1.22], [-0.9, -1.38], [-0.5, -1.32], [-0.1, -1.24], [0.34, -1.34], [0.66, -1.62], [0.96, -1.98], [1.1, -2.1],
    [1.1, -2.28], [1.1, -2.28], [1.2, -2.1], [1.34, -2.0], [1.48, -1.84],
  ]);
  c.fill();
  // The tail, flowing, in one long sweep.
  c.beginPath();
  smoothPath(c, [[-1.08, -1.28], [-1.3, -1.24], [-1.44, -0.92], [-1.42, -0.5], [-1.34, -0.28], [-1.3, -0.5], [-1.26, -0.86], [-1.12, -1.08]]);
  c.fill();
  // A mane in added red, the second colour these painters had.
  c.fillStyle = pal.red;
  c.beginPath();
  smoothPath(c, [[0.38, -1.36], [0.66, -1.68], [0.98, -2.06], [1.1, -2.1], [1.02, -1.86], [0.76, -1.48], [0.5, -1.26]]);
  c.fill();
  // Incised: eye, cheek, nostril, mouth, shoulder, belly line, haunch, hocks.
  c.strokeStyle = pal.clay;
  c.lineWidth = 0.022;
  c.lineCap = 'round';
  const line = (pts) => { c.beginPath(); smoothPath(c, pts, false); c.stroke(); };
  c.beginPath(); c.ellipse(1.27, -1.86, 0.05, 0.035, -0.4, 0, Math.PI * 2); c.stroke();
  c.fillStyle = pal.clay;
  c.beginPath(); c.arc(1.28, -1.86, 0.012, 0, Math.PI * 2); c.fill();
  line([[1.08, -1.94], [1.18, -1.66], [1.33, -1.6], [1.46, -1.62]]);
  line([[1.5, -1.54], [1.58, -1.58]]);
  c.beginPath(); c.arc(1.53, -1.7, 0.02, 0, Math.PI * 2); c.stroke();
  line([[1.04, -1.32], [0.8, -1.2], [0.72, -0.95], [0.82, -0.8]]);
  line([[0.64, -0.8], [0.56, -1.0], [0.68, -1.2]]);
  line([[-0.58, -0.78], [-0.82, -0.86], [-0.84, -1.1], [-0.56, -1.26]]);
  line([[-0.1, -0.76], [-0.3, -0.82], [-0.46, -0.8]]);
  line([[-0.95, -0.46], [-1.0, -0.42], [-1.04, -0.46]]);
  line([[0.93, -0.47], [0.98, -0.5], [1.02, -0.46]]);
  for (let i = 0; i < 7; i++) {
    const t = i / 7;
    line([[lerp(0.46, 1.0, t), lerp(-1.3, -1.98, t)], [lerp(0.56, 1.05, t), lerp(-1.25, -1.86, t)]]);
  }
  // Bridle and rein.
  line([[1.17, -1.72], [1.42, -1.66], [1.54, -1.55]]);
}

function drawRider(c, pal) {
  // Seated with the near leg hanging, one arm out to the rein. A generic horseman, not anybody.
  c.fillStyle = pal.slip;
  capsule(c, [-0.02, -1.46], [0.26, -1.14], 0.1, 0.06);
  capsule(c, [0.26, -1.14], [0.1, -0.78], 0.06, 0.035);
  c.beginPath(); smoothPath(c, [[0.05, -0.78], [0.14, -0.8], [0.26, -0.7], [0.26, -0.7], [0.08, -0.7], [0.08, -0.7]]); c.fill();
  c.beginPath();
  smoothPath(c, [[-0.22, -1.42], [-0.16, -1.86], [-0.06, -2.06], [0.1, -2.08], [0.2, -1.9], [0.12, -1.42], [-0.02, -1.36]]);
  c.fill();
  capsule(c, [0.1, -2.0], [0.42, -1.76], 0.06, 0.04);
  capsule(c, [0.42, -1.76], [0.84, -1.8], 0.04, 0.028);
  // The head in profile.
  c.beginPath();
  smoothPath(c, [[-0.02, -2.08], [-0.08, -2.22], [-0.05, -2.36], [0.06, -2.42], [0.16, -2.36], [0.18, -2.28], [0.24, -2.24], [0.24, -2.24], [0.18, -2.18], [0.17, -2.1], [0.1, -2.06], [0.08, -2.0]]);
  c.fill();
  c.strokeStyle = pal.clay;
  c.lineWidth = 0.02;
  c.lineCap = 'round';
  // A chlamys over the shoulders in added red, and the incised eye and arm line.
  c.fillStyle = pal.red;
  c.beginPath();
  smoothPath(c, [[-0.2, -2.0], [-0.02, -2.06], [0.12, -1.96], [0.1, -1.76], [-0.06, -1.72], [-0.18, -1.8]]);
  c.fill();
  c.beginPath(); c.ellipse(0.11, -2.3, 0.036, 0.022, 0, 0, Math.PI * 2); c.stroke();
  c.beginPath(); smoothPath(c, [[-0.03, -2.34], [0.02, -2.2], [-0.02, -2.12]], false); c.stroke();
  c.beginPath(); smoothPath(c, [[0.0, -1.46], [-0.1, -1.56], [-0.12, -1.72]], false); c.stroke();
  // A line of incised curls where the hair meets the neck.
  c.beginPath(); smoothPath(c, [[-0.06, -2.2], [-0.02, -2.14], [0.02, -2.12]], false); c.stroke();
}

function drawRunner(c, pal, stride = 0) {
  // The Attic footrace: head in profile, chest turned to the viewer, arms pumping, one leg far
  // forward and one far back. Thick to thin: thighs and calves are what these painters enjoyed, and
  // limbs of even width read as a stick figure.
  c.fillStyle = pal.slip;
  const hip = [0, -0.92];
  const chest = [0.1, -1.46];
  const s = stride ? 0.06 : 0;
  // Far arm and far leg first.
  capsule(c, [chest[0] - 0.02, chest[1] + 0.04], [-0.32, -1.2], 0.09, 0.062);
  capsule(c, [-0.32, -1.2], [-0.5, -1.5], 0.062, 0.042);
  capsule(c, [hip[0], hip[1]], [-0.46, -0.58 + s], 0.18, 0.095);
  capsule(c, [-0.46, -0.58 + s], [-0.74, -0.5 + s], 0.095, 0.09);
  capsule(c, [-0.74, -0.5 + s], [-0.96, -0.4 + s], 0.09, 0.04);
  c.beginPath(); smoothPath(c, [[-0.92, -0.46 + s], [-1.07, -0.24 + s], [-1.07, -0.24 + s], [-1.15, -0.34 + s], [-1.02, -0.47 + s]]); c.fill();
  // Torso: a wide chest over a narrow waist, a little forward of the hips.
  c.beginPath();
  smoothPath(c, [[0.36, -1.74], [0.42, -1.5], [0.24, -1.2], [0.16, -0.96], [-0.16, -0.8], [-0.24, -1.0], [-0.14, -1.28], [-0.2, -1.56], [-0.1, -1.76], [0.12, -1.82]]);
  c.fill();
  // Near leg, driving forward: a heavy thigh, then a calf that swells below the knee.
  capsule(c, [hip[0] + 0.02, hip[1]], [0.5, -0.62], 0.2, 0.1);
  capsule(c, [0.5, -0.62], [0.44, -0.36], 0.098, 0.09);
  capsule(c, [0.44, -0.36], [0.37, -0.12], 0.09, 0.042);
  c.beginPath(); smoothPath(c, [[0.31, -0.15], [0.43, -0.16], [0.62, -0.02], [0.62, 0], [0.62, 0], [0.3, 0], [0.3, 0]]); c.fill();
  // Near arm.
  capsule(c, [0.3, -1.62], [0.54, -1.26], 0.095, 0.064);
  capsule(c, [0.54, -1.26], [0.8, -1.56], 0.064, 0.042);
  // Neck and head in profile.
  capsule(c, [0.12, -1.76], [0.14, -1.92], 0.075, 0.07);
  c.beginPath();
  smoothPath(c, [[0.04, -1.9], [0.0, -2.06], [0.05, -2.2], [0.2, -2.26], [0.32, -2.2], [0.34, -2.1], [0.42, -2.05], [0.42, -2.05], [0.35, -1.98], [0.35, -1.92], [0.25, -1.86], [0.12, -1.86]]);
  c.fill();
  c.strokeStyle = pal.clay;
  c.fillStyle = pal.clay;
  c.lineWidth = 0.021;
  c.lineCap = 'round';
  const line = (pts) => { c.beginPath(); smoothPath(c, pts, false); c.stroke(); };
  c.beginPath(); c.ellipse(0.26, -2.11, 0.042, 0.024, 0, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(0.27, -2.11, 0.01, 0, Math.PI * 2); c.fill();
  // Hairline, ear and beard edge.
  line([[0.14, -2.2], [0.1, -2.06], [0.14, -1.96]]);
  line([[0.2, -2.06], [0.18, -1.98], [0.24, -1.96]]);
  // Pectorals, the midline, the ribcage arch and the knee: the anatomy these painters incised.
  line([[-0.08, -1.6], [0.1, -1.48], [0.28, -1.6]]);
  line([[0.1, -1.48], [0.05, -1.14], [0.0, -0.96]]);
  line([[-0.1, -1.3], [0.05, -1.2], [0.2, -1.3]]);
  line([[0.18, -0.84], [0.34, -0.78], [0.46, -0.7]]);
  line([[0.44, -0.72], [0.58, -0.62], [0.47, -0.52]]);
  line([[0.4, -0.5], [0.44, -0.34], [0.38, -0.2]]);
  line([[-0.5, -0.66], [-0.42, -0.56], [-0.5, -0.5]]);
  line([[0.3, -1.46], [0.42, -1.34], [0.5, -1.28]]);
}

function drawPalmette(c, pal) {
  // Palmette and volutes under each handle: drawn in feet about its own base, seen from below up.
  c.fillStyle = pal.slip;
  for (let i = -4; i <= 4; i++) {
    const a = (i / 4) * 1.05;
    const len = 0.56 - Math.abs(i) * 0.03;
    c.save();
    c.rotate(a);
    c.beginPath();
    smoothPath(c, [[-0.012, 0], [-0.05, -len * 0.7], [0, -len], [0.05, -len * 0.7], [0.012, 0]]);
    c.fill();
    c.restore();
  }
  c.beginPath(); c.ellipse(0, 0.015, 0.075, 0.05, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = pal.slip;
  c.lineWidth = 0.032;
  c.lineCap = 'round';
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(0, 0.05);
    c.bezierCurveTo(s * 0.34, 0.1, s * 0.6, 0.26, s * 0.56, 0.05);
    c.bezierCurveTo(s * 0.54, -0.07, s * 0.36, -0.03, s * 0.4, 0.06);
    c.stroke();
    c.beginPath();
    c.moveTo(0, 0.05);
    c.bezierCurveTo(s * 0.18, 0.32, s * 0.5, 0.56, s * 0.72, 0.52);
    c.bezierCurveTo(s * 0.9, 0.46, s * 0.82, 0.3, s * 0.72, 0.36);
    c.stroke();
  }
}

// The whole vase, painted in terms of HEIGHT and the bands' true widths. `pal` is either the real
// colours or a roughness pass: glossy slip and matte clay are the same shapes in two channels.
function paintAmphora(ctx, W, H, prof, pal, { grain }) {
  const rng = seededRandom(530);
  const Y = (y) => H * (1 - prof.arcAtY(y) / prof.total);
  const pxPerFoot = H / prof.total;
  const band = (y0, y1, fill) => {
    ctx.fillStyle = fill;
    const a = Y(y1); const b = Y(y0);
    ctx.fillRect(0, a, W, b - a);
  };
  ctx.fillStyle = pal.clay;
  ctx.fillRect(0, 0, W, H);
  if (grain) {
    // Clay is not one colour: a broad kiln drift, then a fine stipple. Nothing crosses the seam
    // visibly, because these marks are smaller than a handle and the seam lies under the handles.
    for (let i = 0; i < 180; i++) {
      const x = rng() * W; const y = rng() * H; const r = 26 + rng() * 120;
      ctx.fillStyle = rng() < 0.5 ? 'rgba(150,66,28,0.07)' : 'rgba(230,140,80,0.07)';
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 26000; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(112,50,20,0.14)' : 'rgba(240,172,120,0.12)';
      ctx.fillRect(rng() * W, rng() * H, 1.4, 1.4);
    }
  }

  // Foot: black, with its resting edge left in clay.
  band(0, 0.5, pal.slip);
  band(0.2, 0.245, pal.clay);

  // Rays rising from the foot, a whole number round so the wrap closes.
  const rays = 32;
  const r0 = Y(0.62); const r1 = Y(1.42);
  ctx.fillStyle = pal.slip;
  for (let i = 0; i < rays; i++) {
    const x0 = (i / rays) * W;
    const cw = W / rays;
    ctx.beginPath();
    ctx.moveTo(x0 + cw * 0.08, r0);
    ctx.quadraticCurveTo(x0 + cw * 0.36, (r0 + r1) / 2 + 12, x0 + cw * 0.5, r1);
    ctx.quadraticCurveTo(x0 + cw * 0.64, (r0 + r1) / 2 + 12, x0 + cw * 0.92, r0);
    ctx.closePath();
    ctx.fill();
  }
  band(0.56, 0.6, pal.slip);

  // The black zone under the figures, with two lines of added red round it.
  band(1.46, 2.0, pal.slip);
  band(1.6, 1.625, pal.red);
  band(1.82, 1.845, pal.red);
  band(2.03, 2.05, pal.slip);

  // Tongues on the shoulder: alternate black and added red, hanging from the neck.
  const tongues = 44;
  const t0 = Y(4.72); const t1 = Y(4.0);
  for (let i = 0; i < tongues; i++) {
    const cw = W / tongues;
    const x0 = (i / tongues) * W;
    ctx.fillStyle = i % 2 ? pal.red : pal.slip;
    ctx.beginPath();
    ctx.moveTo(x0 + cw * 0.14, t0);
    ctx.lineTo(x0 + cw * 0.86, t0);
    ctx.quadraticCurveTo(x0 + cw * 0.92, (t0 + t1) * 0.5, x0 + cw * 0.5, t1);
    ctx.quadraticCurveTo(x0 + cw * 0.08, (t0 + t1) * 0.5, x0 + cw * 0.14, t0);
    ctx.closePath();
    ctx.fill();
  }
  band(3.93, 3.965, pal.slip);
  band(4.74, 4.8, pal.slip);

  // The meander on the neck, drawn on a grid so its stroke stays even in a band whose pixels are far
  // from square here: the neck is a third of the belly's circumference over the same canvas width.
  const keys = 13;
  const kW = W / keys;
  const kTop = Y(5.34); const kBot = Y(4.84);
  const unitX = kW / 7;
  const unitY = (kBot - kTop) / 5;
  ctx.fillStyle = pal.slip;
  for (let i = 0; i < keys; i++) {
    const x0 = (i / keys) * W;
    const r = (gx, gy, gw, gh) => ctx.fillRect(x0 + gx * unitX, kTop + gy * unitY, gw * unitX, gh * unitY);
    r(0, 0, 1, 5); // upright
    r(0, 0, 5, 1); // over
    r(4, 0, 1, 3.5); // down
    r(2, 2.5, 3, 1); // back
    r(2, 1.6, 1, 1.9); // hook
    r(0, 4, 7, 1); // the running line along the bottom that makes it one continuous key
  }
  band(5.36, 5.4, pal.slip);
  // Lip and the inside of the mouth.
  band(5.42, 6.1, pal.slip);

  // ---- the figure panels --------------------------------------------------------------------
  const panelTop = Y(3.93);
  const panelBot = Y(2.05);
  const belly = 2.04;
  const pxX = W / (2 * Math.PI * belly);
  const halfU = 2.3 * pxX;
  for (const [cx, side] of [[W * 0.25, 'horse'], [W * 0.75, 'run']]) {
    const left = cx - halfU;
    const right = cx + halfU;
    ctx.fillStyle = pal.slip;
    ctx.fillRect(left - 22, panelTop, 9, panelBot - panelTop);
    ctx.fillRect(right + 13, panelTop, 9, panelBot - panelTop);
    // A row of dots down each side of the frame.
    for (let y = panelTop + 14; y < panelBot - 6; y += 22) {
      ctx.beginPath(); ctx.ellipse(left - 6, y, 3.6, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(right + 6, y, 3.6, 3.6, 0, 0, Math.PI * 2); ctx.fill();
    }
    // Lotus-bud chain across the head of the panel.
    const buds = 22;
    const budH = 0.17 * pxPerFoot;
    const cw = (right - left) / buds;
    ctx.strokeStyle = pal.slip;
    ctx.lineWidth = 3;
    for (let i = 0; i < buds; i++) {
      const x = left + (i + 0.5) * cw;
      ctx.fillStyle = i % 2 ? pal.red : pal.slip;
      ctx.beginPath();
      smoothPath(ctx, [[x - cw * 0.34, panelTop + budH * 0.08], [x, panelTop + budH * 1.05], [x + cw * 0.34, panelTop + budH * 0.08]]);
      ctx.fill();
      // The arcs linking one bud to the next, which make it a chain.
      if (i < buds - 1) {
        ctx.beginPath();
        ctx.moveTo(x, panelTop + budH * 1.05);
        ctx.quadraticCurveTo(x + cw * 0.5, panelTop + budH * 0.5, x + cw, panelTop + budH * 1.05);
        ctx.stroke();
      }
    }
    ctx.fillStyle = pal.slip;
    ctx.fillRect(left, panelTop + budH * 1.2, right - left, 4);

    ctx.save();
    ctx.translate(cx, panelBot - 6);
    ctx.scale(pxX, pxPerFoot);
    if (side === 'horse') {
      const k = 0.68;
      for (const dx of [-1.14, 1.08]) {
        ctx.save();
        ctx.translate(dx, 0);
        ctx.scale(k, k);
        drawHorse(ctx, pal);
        drawRider(ctx, pal);
        ctx.restore();
      }
    } else {
      const k = 0.78;
      for (const [dx, stride] of [[-1.55, 0], [0.02, 1], [1.55, 0]]) {
        ctx.save();
        ctx.translate(dx, 0);
        ctx.scale(k, k);
        drawRunner(ctx, pal, stride);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // Palmettes under the handles, drawn twice across the seam at u = 0 / 1 so it closes.
  const palY = Y(3.12);
  for (const x of [0, W * 0.5, W]) {
    ctx.save();
    ctx.translate(x, palY);
    ctx.scale(pxX, pxPerFoot);
    drawPalmette(ctx, pal);
    ctx.restore();
  }
}

function amphoraBody(prof) {
  const rows = [];
  // Close the underside first, so the foot's bottom is not an open mouth from below.
  rows.push([0, 0.17, 0.002], [AM_OUTER[0][0] * 0.98, 0.17, 0.002], [AM_OUTER[0][0] * 0.98, 0.17, 0.004]);
  for (let i = 0; i < prof.pts.length; i++) rows.push([prof.pts[i][0], prof.pts[i][1], prof.arcs[i] / prof.total]);
  // Down the throat: all of it held on the lip's solid black band, so the neck's key does not repeat
  // inside the mouth. It is dark, deep and closed, which is what looking into a jar shows.
  const lipV = prof.arcAtY(5.7) / prof.total;
  const inner = smoothProfile([[0.84, 5.88], [0.7, 5.72], [0.6, 5.45], [0.56, 5.1], [0.6, 4.75], [0.3, 4.45], [0, 4.36]], 18);
  for (let i = 1; i < inner.length; i++) rows.push([inner[i][0], inner[i][1], lipV]);
  return lathe(rows, { segments: 112, start: -Math.PI / 2 });
}

function amphoraHandles(prof) {
  const parts = [];
  const strap = [];
  const w = 0.26; const t = 0.075;
  // A strap with a shallow central ridge and rounded edges: that outline is what separates a pulled
  // clay handle from a length of tube.
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    strap.push([Math.cos(a) * w, Math.sin(a) * t * (1 + 0.25 * Math.cos(a * 2))]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (i / 8) * Math.PI;
    strap.push([Math.cos(a) * w, Math.sin(a) * t * 0.9]);
  }
  strap.pop();
  strap.shift();
  const slip = 0x14110f;
  for (const s of [-1, 1]) {
    const top = [0.58, 5.34];
    const pts = [
      [top[0], top[1]], [0.86, 5.44], [1.3, 5.56], [1.76, 5.46], [2.06, 5.08], [2.1, 4.66], [1.86, 4.3], [1.42, 4.06], [1.14, 3.94],
    ].map(([x, y]) => [s * x, y, 0]);
    const up = new THREE.Vector3(0, 1, 0);
    const g = swept(pts, strap, {
      samples: 72, up,
      scale: (u) => {
        // The potter's thumb flares a handle where it is pressed onto the jar.
        const flare = Math.max(1 - smooth(0, 0.13, u), smooth(0.86, 1.0, u));
        return 1 + flare * 0.22;
      },
    });
    parts.push({ geometry: colored(g, slip), keepColor: true });
    // A closed blister at each root, so the join is a press-on and not a line.
    parts.push({ geometry: stud([s * prof.rAtY(5.3) * 1.02, 5.33, 0], [s, 0.05, 0], 0.24, 0.03, 12), color: slip });
    const shoulderY = 4.12;
    const shoulderR = prof.rAtY(shoulderY);
    // Lying on the shoulder's TRUE normal, read off the profile. At a guessed one its rim digs in on one
    // side and stands clear on the other, and the root of the handle comes out with a notch in it.
    const dr = prof.rAtY(shoulderY + 0.04) - prof.rAtY(shoulderY - 0.04);
    parts.push({ geometry: stud([s * shoulderR, shoulderY, 0], [s * 0.08, -dr, 0], 0.3, 0.022, 18), color: slip });
  }
  return mergeParts(parts);
}

function greekAmphora() {
  const root = new THREE.Group();
  const prof = amphoraProfile();
  const colors = { clay: '#c8682f', slip: '#14110f', red: '#7c2a1e' };
  const rough = { clay: '#cfcfcf', slip: '#3e3e3e', red: '#8a8a8a' };
  const map = canvasTexture(AM_W, AM_H, (ctx, w, h) => paintAmphora(ctx, w, h, prof, colors, { grain: true }));
  map.wrapS = THREE.RepeatWrapping;
  const roughMap = canvasTexture(AM_W / 2, AM_H / 2, (ctx, w, h) => {
    ctx.save();
    ctx.scale(0.5, 0.5);
    paintAmphora(ctx, AM_W, AM_H, prof, rough, { grain: false });
    ctx.restore();
  });
  roughMap.colorSpace = THREE.NoColorSpace;
  roughMap.wrapS = THREE.RepeatWrapping;
  // Roughness map is also the bump: slip stands a hair proud of the clay, so the negative scale.
  const body = mesh(amphoraBody(prof), standard({
    map, roughnessMap: roughMap, roughness: 1, metalness: 0, bumpMap: roughMap, bumpScale: -0.35,
  }));
  root.add(body);
  root.add(mesh(amphoraHandles(prof), standard({ vertexColors: true, roughness: 0.26, metalness: 0 })));

  // A small turned stand of dark wood, with a shallow seat the foot goes down into.
  const standRows = [
    [0, 0], [1.42, 0], [1.42, 0], [1.42, 0.03], [1.42, 0.03], [1.38, 0.09], [1.28, 0.12], [1.16, 0.15], [1.14, 0.2], [1.14, 0.2], [0, 0.2],
  ];
  const stand = mesh(colored(lathe(standRows, { segments: 72 }), 0x2d2119), standard({
    vertexColors: true, roughness: 0.55, metalness: 0, ...relief('wood', { seed: 41, repeat: 2, strength: 0.25 }),
  }));
  root.add(stand);
  return root;
}

// ---------------------------------------------------------------------------
// The Chinese abacus
// ---------------------------------------------------------------------------

// The rightmost rod is the ones. The card asks a student to read this, so it is a real number:
// 7 on the thousands rod (a five bead and two ones), 2, 9 (a five and four ones), and 5 (a five alone).
const ABACUS_NUMBER = 7295;

function abacus() {
  const root = new THREE.Group();
  const frameW = 6.0;
  const rail = 0.3; // frame rail, in the plane of the rods
  const beam = 0.17;
  const beadR = 0.185;
  const beadH = 0.2; // along the rod
  const rods = 13;
  const innerW = frameW - rail * 2;
  const pitch = innerW / rods;
  const upperDeck = beadH * 3.1;
  const lowerDeck = beadH * 6.3;
  const frameH = rail * 2 + beam + upperDeck + lowerDeck;
  const depth = 0.3;

  // Authored flat with the frame's bottom outer edge at y = 0, then tipped back and stood on the
  // easel's ledge as one piece.
  const wood = [];
  const beadParts = [];
  const metal = [];
  const pale = [];
  const ebony = 0x2e1a12;
  const hRail = (y, h, color = ebony, d = depth) => wood.push({ geometry: bar([-frameW / 2, y, 0], [frameW / 2, y, 0], d, h, { chamfer: 0.035, up: [0, 1, 0] }), color });
  hRail(rail / 2, rail);
  hRail(frameH - rail / 2, rail);
  const beamY = rail + lowerDeck + beam / 2;
  hRail(beamY, beam, 0x3a2115, depth * 0.76);
  for (const s of [-1, 1]) {
    wood.push({ geometry: bar([s * (frameW / 2 - rail / 2), rail * 0.4, 0], [s * (frameW / 2 - rail / 2), frameH - rail * 0.4, 0], rail, depth, { chamfer: 0.035, up: [0, 0, 1] }), color: ebony });
    // Brass corner straps on each corner, a suanpan's only ornament, and the thing holding the mitre.
    for (const y of [0.13, frameH - 0.13]) {
      metal.push({ geometry: bar([s * (frameW / 2 + 0.012), y + (y < 1 ? -0.15 : -0.3), 0], [s * (frameW / 2 + 0.012), y + (y < 1 ? 0.3 : 0.15), 0], 0.022, depth + 0.02, { chamfer: 0.006, up: [0, 0, 1] }), color: 0x86703a });
      metal.push({ geometry: bar([s * (frameW / 2 - 0.42), y + (y < 1 ? -0.137 : 0.137), 0], [s * (frameW / 2 + 0.018), y + (y < 1 ? -0.137 : 0.137), 0], depth + 0.02, 0.022, { chamfer: 0.006 }), color: 0x86703a });
    }
  }

  const beadProfile = [
    [0, -beadH / 2], [0.042, -beadH / 2], [0.046, -beadH * 0.46], [beadR * 0.42, -beadH * 0.36], [beadR * 0.82, -beadH * 0.13],
    [beadR * 0.98, -beadH * 0.03], [beadR, 0], [beadR * 0.98, beadH * 0.03], [beadR * 0.82, beadH * 0.13], [beadR * 0.42, beadH * 0.36],
    [0.046, beadH * 0.46], [0.042, beadH / 2], [0, beadH / 2],
  ];
  const beadShape = lathe(beadProfile, { segments: 16 });
  const digits = [];
  for (let n = ABACUS_NUMBER; n > 0; n = Math.floor(n / 10)) digits.push(n % 10);

  const rng = seededRandom(1593);
  const tones = [0x5c2a17, 0x552512, 0x63301b, 0x4e2211];
  const yTop = rail + lowerDeck + beam; // upper deck starts here (bottom of upper deck)
  const yUpperTop = yTop + upperDeck;
  const yLowerBot = rail;
  const yLowerTop = rail + lowerDeck;
  const gap = 0.006;

  for (let r = 0; r < rods; r++) {
    const x = innerW / 2 - pitch * (r + 0.5);
    // Bamboo rods, one piece from rail to rail and running through the beam, their ends sunk in the wood.
    pale.push({ geometry: rod([x, rail - 0.11, 0], [x, frameH - rail + 0.11, 0], 0.028, 0.028, 10), color: 0xb79a63 });
    const digit = digits[r] ?? 0;
    const fives = digit >= 5 ? 1 : 0;
    const ones = digit % 5;
    // Upper deck, two beads: the one counted is pushed DOWN to the beam.
    const upperYs = [];
    if (fives) upperYs.push(yTop + beadH * 0.5 + gap); else upperYs.push(yUpperTop - beadH * 1.5 - gap);
    upperYs.push(yUpperTop - beadH * 0.5 - gap);
    // Lower deck, five beads: those counted are pushed UP to the beam, the rest lie at the bottom rail.
    const lowerYs = [];
    for (let i = 0; i < ones; i++) lowerYs.push(yLowerTop - beadH * (i + 0.5) - gap * (i + 1));
    for (let i = 0; i < 5 - ones; i++) lowerYs.push(yLowerBot + beadH * (i + 0.5) + gap * (i + 1));
    for (const y of [...upperYs, ...lowerYs]) {
      const tone = tones[Math.floor(rng() * tones.length)];
      beadParts.push({ geometry: beadShape, color: tone, position: [x, y, 0] });
    }
  }

  // The stand: an easel's two A-frames, one standing OUTSIDE each end of the abacus, tied by the ledge
  // under it and a rail over it. Nothing stands behind the rods and nothing crosses in front of them:
  // an easel's usual leg up the middle of the picture would run straight through the digit a student
  // is trying to read.
  const tilt = 0.17; // about 10 degrees back
  const ledgeY = 2.14;
  const frontZ = 0.24;
  const frameMatrix = new THREE.Matrix4()
    .makeTranslation(0, ledgeY + 0.05, frontZ)
    .multiply(new THREE.Matrix4().makeRotationX(-tilt));

  const stand = [];
  const walnut = 0x4a2d1a;
  const dark = 0x3a2314;
  const atFrame = (y) => [frontZ - Math.sin(tilt) * y, ledgeY + 0.05 + Math.cos(tilt) * y];
  const postX = frameW / 2 + 0.2;
  const [crownZ, crownY] = atFrame(frameH + 0.5);
  for (const s of [-1, 1]) {
    const x = s * postX;
    // Front leg follows the frame's own lean, so the frame sits square against it.
    const [footZ] = [frontZ + Math.sin(tilt) * (ledgeY + 0.05)];
    stand.push({ geometry: bar([x, 0.1, footZ + 0.18], [x, crownY, crownZ + 0.18], 0.2, 0.15, { up: [0, 0, 1] }), color: walnut });
    stand.push({ geometry: bar([x, 0.1, -1.08], [x, crownY - 0.06, crownZ + 0.08], 0.17, 0.14, { up: [0, 0, 1] }), color: walnut });
    // A shoe under each A-frame, so a stand this tall does not read as balanced on two points.
    stand.push({ geometry: bar([x, 0.07, 1.04], [x, 0.07, -1.28], 0.26, 0.14), color: dark });
    // A small peg through the post and into the frame's end, which is what holds it upright.
    const [pegZ, pegY] = atFrame(frameH * 0.62);
    stand.push({ geometry: rod([s * (frameW / 2 - 0.12), pegY, pegZ], [s * (postX + 0.16), pegY, pegZ], 0.045, 0.05, 10), color: dark });
    stand.push({ geometry: stud([s * (postX + 0.16), pegY, pegZ], [s, 0, 0], 0.075, 0.03, 10), color: 0x7a6330 });
  }
  // Rail over the frame, ledge under it with a lip, and a low stretcher well behind it.
  stand.push({ geometry: bar([-postX - 0.1, crownY - 0.03, crownZ + 0.13], [postX + 0.1, crownY - 0.03, crownZ + 0.13], 0.2, 0.18), color: walnut });
  const ledgeZ = frontZ - 0.02;
  stand.push({ geometry: bar([-postX - 0.1, ledgeY - 0.03, ledgeZ + 0.03], [postX + 0.1, ledgeY - 0.03, ledgeZ + 0.03], 0.54, 0.14), color: walnut });
  stand.push({ geometry: bar([-postX - 0.1, ledgeY + 0.07, ledgeZ + 0.27], [postX + 0.1, ledgeY + 0.07, ledgeZ + 0.27], 0.07, 0.15), color: walnut });
  stand.push({ geometry: bar([-postX, 0.62, -1.02], [postX, 0.62, -1.02], 0.11, 0.17), color: dark });

  const frameParts = mergeParts(wood).applyMatrix4(frameMatrix);
  const woodGeo = mergeParts([
    { geometry: frameParts, keepColor: true },
    ...stand,
  ]);
  const woodMesh = mesh(woodGeo, standard({ vertexColors: true, roughness: 0.42, metalness: 0, ...relief('wood', { seed: 13, repeat: 0.55, strength: 0.28 }) }));
  root.add(woodMesh);
  const beads = mergeParts(beadParts).applyMatrix4(frameMatrix);
  root.add(mesh(beads, standard({ vertexColors: true, roughness: 0.3, metalness: 0, ...relief('wood', { seed: 77, repeat: 1.2, strength: 0.06 }) })));
  const fittings = mergeParts([...pale, ...metal]).applyMatrix4(frameMatrix);
  root.add(mesh(fittings, standard({ vertexColors: true, roughness: 0.46, metalness: 0.25 })));
  return root;
}

// ---------------------------------------------------------------------------
// A wood-grain multiply, shared in kind by the longship and the wagon
// ---------------------------------------------------------------------------

// Near-white streaks along u, with UVs in feet: it multiplies a part's vertex colour, so one tile
// works on a blue board, a red spoke and a tarred plank alike. A tint could not do this, since a
// board has only its eight corners to carry one.
function grainTexture(seed, repeat = 0.3, strength = 1) {
  const tex = canvasTexture(512, 512, (ctx, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#f2f0ec';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 620; i++) {
      const y = rng() * h;
      const v = rng();
      ctx.strokeStyle = v < 0.7 ? `rgba(70,52,36,${(0.05 + rng() * 0.16) * strength})` : `rgba(255,250,240,${0.1 + rng() * 0.2})`;
      ctx.lineWidth = 0.6 + rng() * 2.4;
      const wob = (rng() - 0.5) * 12;
      const start = rng() * w;
      const len = w * (0.3 + rng() * 0.7);
      ctx.beginPath();
      ctx.moveTo(start, y);
      ctx.bezierCurveTo(start + len * 0.3, y + wob, start + len * 0.7, y - wob, start + len, y);
      ctx.stroke();
      if (start + len > w) {
        ctx.beginPath();
        ctx.moveTo(start - w, y);
        ctx.bezierCurveTo(start - w + len * 0.3, y + wob, start - w + len * 0.7, y - wob, start - w + len, y);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(60,44,30,${0.04 + rng() * 0.07})`;
      const x = rng() * w; const y = rng() * h; const r = 20 + rng() * 70;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

// A rectangular grid of vertices whose winding is decided by MEASURING it against the direction it
// must face, because the two sides of a hull and the two axes of a road cannot be trusted to agree.
function gridSurface(rows, cols, fn, expected) {
  const pos = []; const uv = []; const idx = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [p, t] = fn(r, c);
      pos.push(p[0], p[1], p[2]);
      uv.push(t[0], t[1]);
    }
  }
  const ring = cols + 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * ring + c;
      idx.push(a, a + 1, a + ring + 1, a, a + ring + 1, a + ring);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const mid = Math.floor(rows / 2) * ring + Math.floor(cols / 2);
  if (expected && n.getX(mid) * expected[0] + n.getY(mid) * expected[1] + n.getZ(mid) * expected[2] < 0) flipped(g);
  return g;
}

function mirroredX(g) {
  const out = g.clone();
  const p = out.attributes.position;
  const n = out.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, -p.getX(i));
    if (n) n.setX(i, -n.getX(i));
  }
  if (out.index) {
    const a = out.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
  } else {
    for (const attr of Object.values(out.attributes)) {
      const s = attr.itemSize; const arr = attr.array;
      for (let i = 0; i < attr.count; i += 3) {
        for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
      }
    }
  }
  return out;
}

// An outline in plan (x, z) as a board of the given thickness, top face at yTop.
function planBoard(outlineXZ, yTop, thick) {
  const g = flatPrism(outlineXZ.map(([x, z]) => [x, -z]), thick);
  g.rotateX(-Math.PI / 2);
  g.translate(0, yTop - thick, 0);
  // Grain the long way: the board runs along z, so swap its top face's axes.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i));
  return g;
}

// ---------------------------------------------------------------------------
// The Viking longship
// ---------------------------------------------------------------------------

// Authored at about 50ft, two thirds of the 76ft Gokstad ship, so that the catalogue's 0.5 lands
// where the card says: one third of life size. Bow at +Z.
//
// THE HULL IS NOT A LOFT. A loft's stations are planes of constant z, and a longship's strakes run
// the other way: every plank sweeps up from the keel and lands on the stem at its OWN height, which
// is what gives the ends their shape. So the surface is parameterised by plank instead: t along the
// ship, q from the keel to the sheer, with the half-length L(q) growing with height so that the ends
// overhang. The stem's own curve then falls out as the line t = 1.
const VL_STRAKES = 15;
const VL_LAP = 0.11;
const VL_INNER = 0.17;
const VL_DECK_Y = 2.45;

const vlLen = (q) => 17.5 + 4.2 * (1 - Math.pow(1 - q, 2.2));
const vlKeelY = (s) => (s < 0.72 ? 0.42 : 0.42 + 0.83 * Math.pow((s - 0.72) / 0.28, 2));
const vlSheerY = (s) => 4.45 + 4.15 * Math.pow(s, 3.1);
const vlHalfBeam = (s) => 0.09 + 5.41 * Math.pow(Math.max(0, 1 - Math.pow(s, 2.3)), 0.8);

function vlBase(t, q) {
  const s = Math.min(1, Math.abs(t));
  const f = Math.pow(Math.sin(q * Math.PI / 2), 0.72 + 0.55 * s);
  return [0.09 + (vlHalfBeam(s) - 0.09) * f, vlKeelY(s) + (vlSheerY(s) - vlKeelY(s)) * q, t * vlLen(q)];
}

function vlNormal(t, q) {
  const a = vlBase(t, Math.max(0.004, q - 0.01));
  const b = vlBase(t, Math.min(1, q + 0.01));
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

function vlOuter(t, q, off = 0) {
  const p = vlBase(t, q);
  const [nx, ny] = vlNormal(t, q);
  return [p[0] + nx * off, p[1] + ny * off, p[2]];
}

function vlInner(t, q) {
  const p = vlBase(t, q);
  const [nx, ny] = vlNormal(t, q);
  return [Math.max(0, p[0] - nx * VL_INNER), p[1] - ny * VL_INNER, p[2]];
}

// A cross-section at constant z: the t each height must use to land on that z.
const vlAtZ = (z, q, off = 0) => vlOuter(THREE.MathUtils.clamp(z / vlLen(q), -1, 1), q, off);
const vlInnerAtZ = (z, q) => vlInner(THREE.MathUtils.clamp(z / vlLen(q), -1, 1), q);

function vlHull() {
  const parts = [];
  const nT = 58;
  const tAt = (c) => (c / nT) * 2 - 1;
  const tones = [0x6d5235, 0x75593a, 0x664c30, 0x7c5f3f, 0x6f5436];
  const rng = seededRandom(793);
  const fracs = [0, 0.5, 1];
  const addBothSides = (g) => { parts.push({ geometry: g, keepColor: true }); parts.push({ geometry: mirroredX(g), keepColor: true }); };

  for (let i = 0; i < VL_STRAKES; i++) {
    const c0 = new THREE.Color(tones[Math.floor(rng() * tones.length)]);
    const shade = 0.82 + (i / VL_STRAKES) * 0.3;
    const qa = i / VL_STRAKES;
    const qb = (i + 1) / VL_STRAKES;
    const plank = gridSurface(2, nT, (r, c) => {
      const frac = fracs[r];
      const q = lerp(qa, qb, frac);
      const t = tAt(c);
      // Each plank's lower edge stands proud of the top of the one below, and it runs out to nothing
      // in the stem's rabbet, so the laps close into the post rather than ending in mid-air.
      const end = 1 - smooth(0.93, 1, Math.abs(t));
      return [vlOuter(t, q, VL_LAP * (1 - frac) * end), [t * vlLen(q) / 2.4, frac]];
    }, [1, 0, 0]);
    colored(plank, (p, k) => {
      const blotch = smoothNoise3(p.z * 0.33 + i * 3.1, i * 1.3, 2.2);
      const m = shade * (0.82 + blotch * 0.42);
      return [c0.r * m, c0.g * m, c0.b * m];
    });
    addBothSides(plank);
    // The underside of the lap: the shadow line that says "clinker" from across a field.
    if (i > 0) {
      const lap = gridSurface(1, nT, (r, c) => {
        const t = tAt(c);
        const end = 1 - smooth(0.93, 1, Math.abs(t));
        return [vlOuter(t, qa, r === 0 ? 0 : VL_LAP * end), [t * vlLen(qa) / 2.4, 0.02]];
      }, [0.3, -1, 0]);
      colored(lap, 0x2b1d11);
      addBothSides(lap);
    }
  }
  // The inside of the planking, and the top edge joining it to the outside.
  const inner = gridSurface(5, nT, (r, c) => {
    const q = r / 5;
    const t = tAt(c);
    return [vlInner(t, q), [t * vlLen(q) / 2.4, q * 7]];
  }, [-1, 0, 0]);
  colored(inner, (p) => {
    const m = 0.7 + smoothNoise3(p.z * 0.4, p.y * 1.3, 4) * 0.5;
    const c = linearColor(0x5a432b);
    return [c[0] * m, c[1] * m, c[2] * m];
  });
  addBothSides(inner);
  const cap = gridSurface(1, nT, (r, c) => {
    const t = tAt(c);
    return [r === 0 ? vlOuter(t, 1, 0) : vlInner(t, 1), [t * vlLen(1) / 2.4, 0.5]];
  }, [0, 1, 0]);
  colored(cap, 0x4a3522);
  addBothSides(cap);
  return mergeParts(parts);
}

function vlHullTexture() {
  // One plank's face: grain the long way, and the row of iron clench-nails along its lower edge, where
  // it was riveted through the plank below. As geometry those would be thousands of studs.
  const tex = canvasTexture(1024, 96, (ctx, w, h) => {
    const rng = seededRandom(1880);
    ctx.fillStyle = '#efeae2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const y = rng() * h;
      ctx.strokeStyle = rng() < 0.8 ? `rgba(60,42,28,${0.06 + rng() * 0.2})` : 'rgba(255,250,240,0.2)';
      ctx.lineWidth = 0.6 + rng() * 2;
      const x = rng() * w;
      const len = 60 + rng() * 500;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y + (rng() - 0.5) * 3); ctx.stroke();
      if (x + len > w) { ctx.beginPath(); ctx.moveTo(x - w, y); ctx.lineTo(x + len - w, y); ctx.stroke(); }
    }
    // Rivets at 0.6ft: four per 2.4ft tile. v = 0 is the plank's lower edge, the canvas's bottom.
    for (let i = 0; i < 4; i++) {
      const x = ((i + 0.5) / 4) * w;
      const y = h * 0.8;
      ctx.fillStyle = 'rgba(18,15,14,0.85)';
      ctx.beginPath(); ctx.ellipse(x, y, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(140,130,118,0.8)';
      ctx.beginPath(); ctx.ellipse(x - 1.6, y - 1.6, 3.4, 3, 0, 0, Math.PI * 2); ctx.fill();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Upward normal for a plane curve in YZ, so transportFrames never starts parallel to its tangent.
function planeUp(points) {
  const a = points[0]; const b = points[1];
  const dy = b[1] - a[1]; const dz = b[2] - a[2];
  const l = Math.hypot(dy, dz) || 1;
  return new THREE.Vector3(0, -dz / l, dy / l);
}

function vlNeckTint(g, ringSize, colA, colB, period = 7) {
  const a = linearColor(colA); const b = linearColor(colB);
  const count = g.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / ringSize);
    const col = i % ringSize;
    // Low-contrast carved lobes. A strong colour change here smears: a tint can only be as sharp as
    // the rows under it, so the bright collars are real rings of their own, added below.
    const k = row % period < period / 2;
    const c = k ? b : a;
    arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function vlDragonHead() {
  // Authored looking along +Z with its origin at the back of the skull, about 3ft long.
  const parts = [];
  const hide = 0x7f2c1b;
  const gold = 0xbf973c;
  parts.push({
    geometry: solidLoft([
      { d: -0.5, w: 0.05, up: 0.05, dn: 0.05, b: 0.02 },
      { d: -0.32, w: 0.34, up: 0.36, dn: 0.32, b: 0.02 },
      { d: 0.2, w: 0.46, up: 0.48, dn: 0.32, b: 0.06 },
      { d: 0.72, w: 0.47, up: 0.56, dn: 0.22, b: 0.12 },
      { d: 1.2, w: 0.41, up: 0.42, dn: 0.17, b: 0.12, round: 0.8 },
      { d: 1.8, w: 0.33, up: 0.31, dn: 0.14, b: 0.1, round: 0.75 },
      { d: 2.3, w: 0.33, up: 0.34, dn: 0.14, b: 0.12, round: 0.8 },
      { d: 2.68, w: 0.25, up: 0.24, dn: 0.11, b: 0.12 },
      { d: 2.82, w: 0.06, up: 0.05, dn: 0.04, b: 0.12 },
    ], { sides: 24, samples: 34 }),
    color: hide,
  });
  // The dark of the throat, so the open mouth is a mouth and not a slot with the sky through it.
  parts.push({
    geometry: solidLoft([
      { d: 0, w: 0.2, h: 0.2, b: -0.2 }, { d: 0.6, w: 0.3, h: 0.28, b: -0.22 }, { d: 1.2, w: 0.2, up: 0.2, dn: 0.2, b: -0.22 }, { d: 1.5, w: 0.04, h: 0.04, b: -0.26 },
    ], { sides: 12, samples: 8 }),
    color: 0x2a0d08,
  });
  // The lower jaw, swung open about its hinge as one piece with its teeth.
  const gape = 0.3;
  const hinge = [0, -0.17, 0.2];
  const jawParts = [];
  jawParts.push({
    geometry: solidLoft([
      { d: -0.18, w: 0.1, up: 0.06, dn: 0.06, b: -0.05 },
      { d: 0.1, w: 0.37, up: 0.11, dn: 0.2, b: -0.08 },
      { d: 0.9, w: 0.33, up: 0.09, dn: 0.2, b: -0.12 },
      { d: 1.65, w: 0.26, up: 0.08, dn: 0.16, b: -0.13 },
      { d: 2.1, w: 0.2, up: 0.07, dn: 0.11, b: -0.11 },
      { d: 2.26, w: 0.05, up: 0.03, dn: 0.03, b: -0.1 },
    ], { sides: 16, samples: 18 }),
    color: hide,
  });
  const ivory = 0xdfd5b8;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z = 0.72 + i * 0.26;
      const big = i === 4;
      const w = lerp(0.27, 0.15, i / 5) * s;
      jawParts.push({ geometry: coneAlong([w, -0.08, z], [w, big ? 0.3 : 0.12, z + 0.02], big ? 0.058 : 0.042, { seg: 6 }), color: ivory });
    }
  }
  jawParts.push({ geometry: tubeOut([[0, -0.1, 0.4], [0, -0.07, 1.2], [0, -0.04, 1.9], [0, 0.1, 2.45], [0, 0.34, 2.62], [0, 0.5, 2.5]], [0.12, 0.1, 0.08, 0.06, 0.035, 0.003], { sides: 8, tubular: 20 }), color: 0xa82a1b });
  const jaw = mergeParts(jawParts);
  jaw.applyMatrix4(new THREE.Matrix4().makeTranslation(hinge[0], hinge[1], hinge[2]).multiply(new THREE.Matrix4().makeRotationX(gape)));
  parts.push({ geometry: jaw, keepColor: true });

  for (const s of [-1, 1]) {
    // A cheek boss over the hinge, closing the corner of the mouth.
    const cheek = ball(0.3, 12);
    cheek.scale(0.5, 1, 1.1);
    parts.push({ geometry: cheek, color: hide, position: [s * 0.37, -0.1, 0.24] });
    for (let i = 0; i < 7; i++) {
      const z = 1.1 + i * 0.235;
      const big = i === 5;
      const x = s * lerp(0.33, 0.2, i / 6);
      parts.push({ geometry: coneAlong([x, 0.06, z], [x, big ? -0.3 : -0.11, z + 0.02], big ? 0.06 : 0.042, { seg: 6 }), color: ivory });
    }
    const eye = [s * 0.4, 0.44, 0.88];
    parts.push({ geometry: ball(0.15, 14), color: 0xdfae2d, position: eye });
    parts.push({ geometry: stud([eye[0] + s * 0.108, eye[1] + 0.02, eye[2] + 0.078], [s * 0.72, 0.1, 0.65], 0.074, 0.03, 10), color: 0x0c0a08 });
    parts.push({ geometry: tubeOut([[s * 0.2, 0.78, 0.4], [s * 0.46, 0.72, 0.68], [s * 0.5, 0.62, 1.04], [s * 0.38, 0.44, 1.28]], [0.05, 0.09, 0.075, 0.018], { sides: 9, tubular: 12 }), color: gold });
    parts.push({ geometry: ball(0.11, 10), color: hide, position: [s * 0.24, 0.36, 2.34] });
    parts.push({ geometry: stud([s * 0.3, 0.39, 2.42], [s * 0.6, 0.45, 0.65], 0.058, 0.024, 8), color: 0x0c0a08 });
    // Swept-back horn, rooted in the skull and tapering to a point.
    parts.push({ geometry: tubeOut([[s * 0.22, 0.5, 0.06], [s * 0.42, 0.76, -0.36], [s * 0.5, 0.9, -0.94], [s * 0.42, 1.24, -1.46]], [0.1, 0.085, 0.05, 0.002], { sides: 9, tubular: 14 }), color: gold });
    // Mane tendrils from behind the cheek, each an S rooted in the head and tapering away.
    for (const [dy, dz, far] of [[-0.05, -0.1, 1], [0.2, -0.26, 0.86], [-0.28, 0.02, 0.76]]) {
      const a = [s * 0.32, dy, dz];
      parts.push({
        geometry: tubeOut([a, [s * 0.5, dy - 0.2 * far, dz - 0.46 * far], [s * 0.52, dy - 0.1 * far, dz - 0.98 * far], [s * 0.46, dy - 0.34 * far, dz - 1.34 * far]], [0.07, 0.055, 0.035, 0.002], { sides: 7, tubular: 12 }),
        color: gold,
      });
    }
  }
  // The crest down the skull: a row of flat fins, narrow across and rooted in the crown.
  for (let i = 0; i < 5; i++) {
    const z = 0.7 - i * 0.28;
    const y = lerp(0.62, 0.36, i / 4);
    parts.push({ geometry: coneAlong([0, y - 0.1, z], [0, y + 0.3, z - 0.26], 0.13, { seg: 8, squash: 0.28, up: [0, 0, 1] }), color: gold });
  }
  return mergeParts(parts);
}

function vlShield(pattern, colorA, colorB) {
  const R = 1;
  const rings = [0.16, 0.55, 0.92];
  const n = 18;
  const dome = (r) => 0.075 * (1 - (r / R) * (r / R));
  const pos = []; const nor = []; const col = []; const idx = [];
  const A = linearColor(colorA); const B = linearColor(colorB); const rim = linearColor(0x2b2118);
  const face = (sector) => {
    if (pattern === 0) return Math.floor(sector / (n / 2)) % 2 ? B : A; // halved
    if (pattern === 1) return Math.floor(sector / (n / 6)) % 2 ? B : A; // six sectors
    return A; // plain
  };
  const put = (r, a, c) => {
    pos.push(Math.cos(a) * r, Math.sin(a) * r, dome(r));
    const l = Math.hypot(0.15 * r, 1);
    nor.push(Math.cos(a) * 0.15 * r / l, Math.sin(a) * 0.15 * r / l, 1 / l);
    col.push(c[0], c[1], c[2]);
  };
  for (let s = 0; s < n; s++) {
    const a0 = (s / n) * Math.PI * 2 + 0.26;
    const a1 = ((s + 1) / n) * Math.PI * 2 + 0.26;
    const c = face(s);
    for (let r = 0; r < rings.length; r++) {
      const ra = rings[r];
      const rb = rings[r + 1] ?? R;
      const cc = r === rings.length - 1 ? rim : c;
      const b = pos.length / 3;
      put(ra, a0, cc); put(rb, a0, cc); put(rb, a1, cc); put(ra, a1, cc);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const front = new THREE.BufferGeometry();
  front.setIndex(idx);
  front.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  front.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  front.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const parts = [{ geometry: front, keepColor: true }];
  // Back and edge, with the centre plugged under the boss so nothing can be seen through it.
  const back = new THREE.CylinderGeometry(R, R, 0.045, n, 1);
  back.rotateX(Math.PI / 2);
  back.translate(0, 0, -0.018);
  parts.push({ geometry: back, color: 0x2b2118 });
  // The iron boss: a spun dome on a flat flange, proud of the boards.
  const boss = lathe([[0.19, 0.0], [0.19, 0.03], [0.14, 0.05], [0.1, 0.14], [0.05, 0.18], [0, 0.19]], { segments: 10 });
  boss.rotateX(Math.PI / 2);
  boss.translate(0, 0, 0.06);
  parts.push({ geometry: boss, color: 0x45433f });
  return mergeParts(parts);
}

function vlSailPoint(u, v) {
  const W = lerp(21.2, 23, v);
  const footArc = 0.7 * Math.sin(Math.PI * u) * Math.pow(v, 4);
  const x = (u - 0.5) * W;
  const y = 27 - 16.9 * v + footArc;
  const across = Math.pow(Math.sin(Math.PI * u), 0.72);
  const down = Math.sin(Math.PI * Math.min(1, v * 0.74 + 0.02));
  // Full of wind: the belly is forward, toward the bow, as a square sail set before the mast is.
  const belly = 4.1 * across * down;
  const fold = 0.09 * Math.sin(u * Math.PI * 7 + 0.6) * smooth(0.04, 0.5, v);
  return [x, y, 1.28 + belly + fold];
}

function vlSail() {
  const geometry = solidSurface({
    nu: 44, nv: 24, point: vlSailPoint, thick: () => 0.035,
  });
  const tex = canvasTexture(1024, 768, (ctx, w, h) => {
    const rng = seededRandom(1066);
    const stripes = 9;
    const sw = w / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#9a2a1f' : '#d8cbb0';
      ctx.fillRect(i * sw, 0, sw + 1, h);
    }
    // Wool cloth: a fine irregular weave, the seams between the woven widths, and stitching.
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = rng() < 0.5 ? 'rgba(40,20,14,0.1)' : 'rgba(255,244,226,0.09)';
      ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 8, 1);
    }
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = 'rgba(40,20,14,0.07)';
      ctx.fillRect(rng() * w, rng() * h, 1, 3 + rng() * 10);
    }
    ctx.fillStyle = 'rgba(30,18,12,0.3)';
    for (let i = 1; i < stripes; i++) ctx.fillRect(i * sw - 1.2, 0, 2.4, h);
    for (let i = 1; i < 6; i++) ctx.fillRect(0, (i / 6) * h - 1, w, 2);
    // Salt and sun at the head and along the foot.
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(60,40,26,${0.006 + rng() * 0.02})`;
      const x = rng() * w; const y = rng() * h; const r = 16 + rng() * 60;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, rng() * 3, 0, Math.PI * 2); ctx.fill();
    }
  });
  return mesh(geometry, standard({ map: tex, roughness: 0.95, metalness: 0, ...relief('weave', { seed: 8, repeat: 6, strength: 0.16 }) }));
}

function vlWoodParts() {
  const parts = [];
  const oak = 0x4a3522;
  const rope = 0x6a5636;
  // ---- the backbone: keel, forefoot and both posts as ONE swept timber ---------------------------
  const path = [];
  const qTop = 0.84; // the post stops inside the neck that carries on from it, so its end is never seen
  for (let i = 8; i >= 0; i--) {
    const q = (i / 8) * qTop;
    path.push([0, lerp(1.25, 8.6, q) - 0.12 * (1 - q), -vlLen(q)]);
  }
  const keelSteps = 22;
  for (let i = 1; i < keelSteps; i++) {
    const z = lerp(-17.5, 17.5, i / keelSteps);
    path.push([0, vlKeelY(Math.abs(z) / 17.5) - 0.12, z]);
  }
  for (let i = 0; i <= 8; i++) {
    const q = (i / 8) * qTop;
    path.push([0, lerp(1.25, 8.6, q) - 0.12 * (1 - q), vlLen(q)]);
  }
  const keelRect = [[-0.17, -0.3], [0.17, -0.3], [0.2, -0.1], [0.2, 0.2], [0.14, 0.32], [-0.14, 0.32], [-0.2, 0.2], [-0.2, -0.1]];
  parts.push({ geometry: swept(path, keelRect, { samples: 84, up: planeUp(path) }), color: 0x3a2a1a });

  // ---- the stem's neck, carrying the dragon ---------------------------------------------------
  const zEnd = vlLen(1);
  // The neck starts on the post's own curve, at the post's own size, so there is no step between them.
  const postAt = (q, sign) => [0, lerp(1.25, 8.6, q) - 0.12 * (1 - q), sign * vlLen(q)];
  const neckPath = [
    postAt(0.72, 1), postAt(0.88, 1), postAt(1, 1), [0, 10.1, zEnd + 0.56], [0, 11.2, zEnd + 1.02], [0, 12.2, zEnd + 1.02], [0, 13.05, zEnd + 0.72], [0, 13.75, zEnd + 0.78], [0, 14.25, zEnd + 1.2],
  ];
  const oval = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    oval.push([Math.cos(a) * 0.28, Math.sin(a) * 0.36]);
  }
  const neckGeo = swept(neckPath, oval, {
    samples: 48, up: planeUp(neckPath), scale: (u) => lerp(0.86, 1.06, u),
  });
  // The chevron tint indexes rows and columns, so it needs sweepProfile's own vertex order.
  vlNeckTint(neckGeo, 14, 0x63281a, 0x6f2e1e, 6);
  const collar = (curve, u, r) => {
    const p = curve.getPointAt(u);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), curve.getTangentAt(u));
    const ring = new THREE.TorusGeometry(1, 0.1, 5, 16);
    ring.scale(r * 0.3 / 0.36 * 1.02, r * 1.02, r);
    ring.applyQuaternion(q);
    ring.translate(p.x, p.y, p.z);
    parts.push({ geometry: ring, color: 0xbf973c });
  };
  parts.push({ geometry: neckGeo, keepColor: true });
  const neckCurve = new THREE.CatmullRomCurve3(neckPath.map((p) => vec(p)), false, 'catmullrom', 0.5);
  // The crest of fins running down the back of the neck, each rooted in it.
  for (let i = 1; i < 19; i++) {
    const u = i / 19;
    const p = neckCurve.getPointAt(u);
    const tan = neckCurve.getTangentAt(u);
    // Forward is the +z side of a neck rising up, so the crest (its back) lies toward -z.
    const back = new THREE.Vector3(0, tan.z, -tan.y).normalize();
    const r = 0.36 * lerp(0.86, 1.06, u);
    const base = p.clone().addScaledVector(back, r * 0.7);
    const tip = base.clone().addScaledVector(back, 0.46 + 0.12 * Math.sin(i * 1.7)).addScaledVector(tan, -0.26);
    parts.push({ geometry: coneAlong(base.toArray(), tip.toArray(), 0.18, { seg: 8, squash: 0.26, up: [1, 0, 0] }), color: 0xc0983c });
  }
  for (const u of [0.3, 0.44, 0.58, 0.72, 0.86]) collar(neckCurve, u, 0.36 * lerp(0.86, 1.06, u));
  // The head at the top of the neck.
  const headAt = neckPath[neckPath.length - 1];
  const head = vlDragonHead();
  head.applyMatrix4(new THREE.Matrix4().makeTranslation(0, headAt[1] + 0.02, headAt[2] - 0.12).multiply(new THREE.Matrix4().makeRotationX(0.14)));
  parts.push({ geometry: head, keepColor: true });

  // ---- the stern's tail, curling back into a scroll ------------------------------------------
  const tailPath = [
    postAt(0.72, -1), postAt(0.88, -1), postAt(1, -1), [0, 10.1, -zEnd - 0.66], [0, 11.4, -zEnd - 1.12], [0, 12.7, -zEnd - 1.12], [0, 13.62, -zEnd - 0.5],
    [0, 13.82, -zEnd + 0.34], [0, 13.32, -zEnd + 0.96], [0, 12.62, -zEnd + 0.98], [0, 12.2, -zEnd + 0.44], [0, 12.42, -zEnd - 0.08], [0, 12.92, -zEnd - 0.1], [0, 13.08, -zEnd + 0.28],
  ];
  const tailGeo = swept(tailPath, oval, {
    samples: 60, up: planeUp(tailPath), scale: (u) => lerp(0.86, 0.28, Math.pow(u, 1.4)),
  });
  vlNeckTint(tailGeo, 14, 0x63281a, 0x6f2e1e, 6);
  const tailCurve = new THREE.CatmullRomCurve3(tailPath.map((p) => vec(p)), false, 'catmullrom', 0.5);
  for (const u of [0.2, 0.32, 0.44, 0.56, 0.68, 0.8]) collar(tailCurve, u, 0.36 * lerp(0.86, 0.28, Math.pow(u, 1.4)));
  parts.push({ geometry: tailGeo, keepColor: true });
  // A boss closing the scroll's eye, where the taper ends at a real thickness.
  parts.push({ geometry: ball(0.17, 14), color: 0xc0983c, position: tailPath[tailPath.length - 1] });

  // ---- gunwale rails --------------------------------------------------------------------------
  const railProfile = [[-0.15, -0.13], [0.15, -0.13], [0.17, 0.0], [0.11, 0.12], [-0.11, 0.12], [-0.17, 0.0]];
  for (const s of [-1, 1]) {
    const railPts = [];
    for (let i = 0; i <= 46; i++) {
      const t = lerp(-0.965, 0.965, i / 46);
      const p = vlOuter(t, 1, -VL_INNER * 0.4);
      railPts.push([s * p[0], p[1] + 0.02, p[2]]);
    }
    parts.push({
      geometry: swept(railPts, railProfile, { samples: 70, up: new THREE.Vector3(0, 1, 0), scale: (u) => lerp(0.72, 1, Math.min(1, Math.min(u, 1 - u) * 6)) }),
      color: 0x5e452c,
    });
  }

  // ---- the deck, every plank clipped to the hull at its own station ---------------------------------
  const edge = [];
  for (let i = 0; i <= 200; i++) {
    const t = lerp(-1, 1, i / 200);
    let lo = 0.002; let hi = 1;
    for (let k = 0; k < 26; k++) {
      const mid = (lo + hi) / 2;
      if (vlInner(t, mid)[1] < VL_DECK_Y) lo = mid; else hi = mid;
    }
    const p = vlInner(t, (lo + hi) / 2);
    edge.push([p[2], p[0]]);
  }
  edge.sort((a, b) => a[0] - b[0]);
  const deckHalf = (z) => {
    if (z <= edge[0][0] || z >= edge[edge.length - 1][0]) return 0;
    for (let i = 1; i < edge.length; i++) {
      if (edge[i][0] >= z) {
        const f = (z - edge[i - 1][0]) / Math.max(1e-5, edge[i][0] - edge[i - 1][0]);
        return lerp(edge[i - 1][1], edge[i][1], f);
      }
    }
    return 0;
  };
  const pw = 0.74;
  const gap = 0.035;
  const planks = [];
  const rng = seededRandom(1000);
  const zMin = edge[0][0]; const zMax = edge[edge.length - 1][0];
  for (let i = -8; i < 8; i++) {
    const xa = i * pw + gap / 2;
    const xb = (i + 1) * pw - gap / 2;
    const near = Math.min(Math.abs(xa), Math.abs(xb));
    const left = []; const right = [];
    for (let k = 0; k <= 60; k++) {
      const z = lerp(zMin, zMax, k / 60);
      const h = deckHalf(z) + 0.05;
      if (h <= near + 0.02) continue;
      left.push([Math.max(xa, -h), z]);
      right.push([Math.min(xb, h), z]);
    }
    if (left.length < 3) continue;
    const outline = [...right, ...left.reverse()];
    const tone = [0x8b6d48, 0x7e6240, 0x93744e, 0x856845][Math.floor(rng() * 4)];
    planks.push({ geometry: planBoard(outline, VL_DECK_Y, 0.12), color: tone });
  }
  parts.push(...planks);

  // ---- frames, seen above the deck ---------------------------------------------------------------
  const ribProfile = [[-0.075, -0.13], [0.075, -0.13], [0.075, 0.13], [-0.075, 0.13]];
  for (let k = 0; k < 13; k++) {
    const z = lerp(-14.5, 14.5, k / 12);
    for (const s of [-1, 1]) {
      const pts = [];
      let started = false;
      for (let i = 0; i <= 16; i++) {
        const q = i / 16;
        const p = vlInnerAtZ(z, q);
        if (p[1] < VL_DECK_Y - 0.15) continue;
        if (!started && pts.length === 0) started = true;
        pts.push([s * (p[0] - 0.05), p[1], z]);
      }
      if (pts.length < 3) continue;
      parts.push({ geometry: swept(pts, ribProfile, { samples: 6, up: new THREE.Vector3(0, 0, 1) }), color: 0x4e3a25 });
    }
  }

  // ---- mast, its partner, the yard -----------------------------------------------------------------
  const mastZ = 0.72;
  parts.push({
    geometry: solidLoft([
      { d: -5, w: 0.1, h: 0.05, b: VL_DECK_Y + 0.14 },
      { d: -3.5, w: 0.36, h: 0.2, b: VL_DECK_Y + 0.2 },
      { d: -0.3, w: 0.74, h: 0.36, b: VL_DECK_Y + 0.3, round: 0.55 },
      { d: 1.8, w: 0.74, h: 0.36, b: VL_DECK_Y + 0.3, round: 0.55 },
      { d: 5.2, w: 0.3, h: 0.17, b: VL_DECK_Y + 0.18 },
      { d: 6.6, w: 0.08, h: 0.05, b: VL_DECK_Y + 0.13 },
    ], { sides: 18, samples: 22 }),
    color: oak,
  });
  parts.push({ geometry: rod([0, VL_DECK_Y, mastZ], [0, 29.6, mastZ], 0.42, 0.2, 18), color: 0x6a4e30 });
  parts.push({ geometry: stud([0, 29.62, mastZ], [0, 1, 0], 0.26, 0.12, 12), color: 0x6a4e30 });
  const yardY = 27.28;
  const yardZ = mastZ + 0.48;
  for (const s of [-1, 1]) {
    parts.push({ geometry: rod([0, yardY, yardZ], [s * 12.1, yardY, yardZ], 0.22, 0.09, 12), color: 0x6a4e30 });
  }
  parts.push({ geometry: ball(0.225, 12), color: 0x6a4e30, position: [0, yardY, yardZ] });
  // The parrel holding yard to mast, and a block at each yardarm.
  parts.push({ geometry: new THREE.TorusGeometry(0.42, 0.055, 8, 22).rotateX(Math.PI / 2).translate(0, yardY, mastZ + 0.18), color: rope });

  // Bolt rope round the sail's edges, its centre on the cloth so it is half buried.
  const edgeLine = (fn, n = 18) => {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(fn(i / n));
    return pts;
  };
  parts.push({ geometry: tubeOut(edgeLine((a) => vlSailPoint(0, a)), [0.06, 0.06], { sides: 6, tubular: 28 }), color: rope });
  parts.push({ geometry: tubeOut(edgeLine((a) => vlSailPoint(1, a)), [0.06, 0.06], { sides: 6, tubular: 28 }), color: rope });
  parts.push({ geometry: tubeOut(edgeLine((a) => vlSailPoint(a, 1)), [0.06, 0.06], { sides: 6, tubular: 36 }), color: rope });
  // The head is laced to the yard, one lashing to each woven width and a few between.
  for (let i = 0; i <= 18; i++) {
    const x = lerp(-10.4, 10.4, i / 18);
    parts.push({ geometry: new THREE.TorusGeometry(0.235, 0.03, 5, 8).rotateY(Math.PI / 2).translate(x, yardY - 0.02, yardZ + 0.02), color: rope });
  }

  // ---- rigging. Every end is sunk in what it is made fast to. ---------------------------------------
  const line = (a, b, sag = 0.1, r = 0.05) => {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag, (a[2] + b[2]) / 2];
    parts.push({ geometry: tubeOut([a, m, b], [r, r, r], { sides: 6, tubular: 8 }), color: rope });
  };
  const top = [0, 29.2, mastZ];
  line([0, 29.0, mastZ + 0.1], [0, 8.1, zEnd - 0.12], 0.3);
  line([0, 29.0, mastZ - 0.1], [0, 8.1, -zEnd + 0.12], 0.3);
  for (const s of [-1, 1]) {
    for (const z of [-1.4, -3.5, -5.6]) {
      const p = vlAtZ(z, 1);
      line([s * 0.18, top[1], mastZ - 0.1], [s * (p[0] - 0.08), p[1] + 0.05, z], 0.08, 0.055);
    }
    // Braces from the yardarm, led aft to the rail.
    const b = vlAtZ(-13.5, 1);
    line([s * 11.8, yardY, yardZ], [s * (b[0] - 0.08), b[1] + 0.05, -13.5], 0.5, 0.04);
    // Sheets from the clews.
    const c = vlSailPoint(s > 0 ? 1 : 0, 1);
    const d = vlAtZ(-7.2, 1);
    line(c, [s * (d[0] - 0.08), d[1] + 0.05, -7.2], 0.35, 0.045);
    // A tack line from each clew forward to the rail, so the sail's foot is held at both ends.
    const f = vlAtZ(10, 1);
    line(c, [s * (f[0] - 0.08), f[1] + 0.05, 10], 0.25, 0.04);
  }
  line([0.26, yardY + 0.1, yardZ - 0.34], [0.28, VL_DECK_Y + 0.5, mastZ - 2.2], 0.02, 0.05);

  // ---- oars ------------------------------------------------------------------------------------------
  const oarQ = 1 - 4.5 / VL_STRAKES;
  const ports = [];
  for (let i = 0; i < 13; i++) ports.push(lerp(-13.6, 13.6, i / 12));
  const oarStations = [
    { d: 0, w: 0.04, h: 0.04 }, { d: 0.1, w: 0.065, h: 0.065 }, { d: 0.9, w: 0.07, h: 0.07 }, { d: 3.2, w: 0.08, h: 0.08 }, { d: 8.9, w: 0.058, h: 0.06 },
    { d: 9.5, w: 0.03, h: 0.13 }, { d: 10.4, w: 0.026, h: 0.3 }, { d: 11.7, w: 0.022, h: 0.32 }, { d: 11.92, w: 0.012, h: 0.18 },
  ];
  for (const s of [-1, 1]) {
    for (const i of [3, 6, 9]) {
      const z = ports[i];
      const p = vlAtZ(z, oarQ, VL_LAP * 0.5);
      const [nx, ny] = vlNormal(z / vlLen(oarQ), oarQ);
      const l = Math.hypot(nx, ny) || 1;
      const out = new THREE.Vector3(s * nx / l, -0.2, 0.04 * (z > 0 ? -1 : 1)).normalize();
      const P = new THREE.Vector3(s * p[0], p[1], p[2]);
      const A = P.clone().addScaledVector(out, -3.2);
      const B = P.clone().addScaledVector(out, 8.72);
      const { m } = alongMatrix(A.toArray(), B.toArray(), [0, 1, 0]);
      const g = solidLoft(oarStations, { sides: 8, samples: 16 });
      g.applyMatrix4(m);
      parts.push({ geometry: g, color: 0x9a7d52 });
    }
  }
  // Oar-port rings and their dark holes.
  for (const s of [-1, 1]) {
    for (const z of ports) {
      const p = vlAtZ(z, oarQ, VL_LAP * 0.5);
      const [nx, ny] = vlNormal(z / vlLen(oarQ), oarQ);
      const at = [s * p[0], p[1], p[2]];
      parts.push({ geometry: stud(at, [s * nx, ny, 0], 0.255, 0.07, 8), color: 0x7a5d3c });
      parts.push({ geometry: stud([at[0] + s * nx * 0.02, at[1] + ny * 0.02, at[2]], [s * nx, ny, 0], 0.165, 0.075, 8), color: 0x0d0a07 });
    }
  }

  // ---- the steering oar, on the STARBOARD side (which is -X, facing +Z), where the word comes from ---
  const rudderZ = -15.2;
  const pivot = vlAtZ(rudderZ, 0.55, VL_LAP);
  const rx = -(pivot[0] + 0.62);
  const blade = solidLoft([
    { d: 0.66, w: 0.03, up: 0.5, dn: 0.2, b: -0.24 },
    { d: 1.0, w: 0.09, up: 0.92, dn: 0.34, b: -0.36 },
    { d: 2.9, w: 0.13, up: 0.98, dn: 0.3, b: -0.38 },
    { d: 4.4, w: 0.17, up: 0.46, dn: 0.22, b: -0.14, round: 0.8 },
    { d: 5.7, w: 0.17, up: 0.17, dn: 0.17 },
    { d: 7.9, w: 0.15, up: 0.15, dn: 0.15 },
    { d: 8.1, w: 0.06, up: 0.06, dn: 0.06 },
  ], { axis: 'y', sides: 14, samples: 26 });
  blade.translate(rx, 0, rudderZ);
  parts.push({ geometry: blade, color: 0x4f3b26 });
  // The boss on the hull it turns against, with a withy tying the two together.
  const bossAt = [-pivot[0], pivot[1], pivot[2]];
  parts.push({ geometry: stud(bossAt, [-1, -0.1, 0], 0.5, 0.22, 16), color: 0x3a2a1a });
  parts.push({ geometry: rod([rx, pivot[1], rudderZ], [bossAt[0] + 0.05, bossAt[1], bossAt[2]], 0.07, 0.07, 8), color: rope });
  // An upper strap at the rail, where the shaft is held upright.
  const railAt = vlAtZ(rudderZ, 1, 0);
  parts.push({ geometry: rod([rx, railAt[1] - 0.25, rudderZ], [-railAt[0] + 0.06, railAt[1] - 0.05, rudderZ], 0.05, 0.05, 8), color: rope });
  // The tiller goes inboard.
  parts.push({ geometry: rod([rx, 7.6, rudderZ], [-0.9, 7.0, rudderZ + 2.4], 0.075, 0.05, 10), color: 0x6a4e30 });
  parts.push({ geometry: ball(0.17, 12), color: 0x4f3b26, position: [rx, 7.6, rudderZ] });

  // ---- sea chests: there are no thwarts on a longship, and each rower sat on his own ------------------
  for (const s of [-1, 1]) {
    for (const i of [3, 6, 9]) {
      const z = ports[i];
      const h = deckHalf(z);
      const x = s * (h - 1.05);
      parts.push({ geometry: bar([x, VL_DECK_Y + 0.5, z - 0.64], [x, VL_DECK_Y + 0.5, z + 0.64], 0.82, 1.0, { chamfer: 0.03 }), color: 0x6a4a2a });
      parts.push({ geometry: bar([x, VL_DECK_Y + 1.02, z - 0.68], [x, VL_DECK_Y + 1.02, z + 0.68], 0.9, 0.08, { chamfer: 0.02 }), color: 0x7a5834 });
    }
  }

  // ---- a simple timber cradle, each saddle cut to the hull's own section at its own station ---------
  for (const z of [-13, -4.6, 4.6, 13]) {
    for (const s of [-1, 1]) {
      const pts = [];
      const q1 = 0.36;
      for (let i = 0; i <= 10; i++) {
        const q = lerp(0.015, q1, i / 10);
        const p = vlAtZ(z, q, 0);
        pts.push([p[0] * s, p[1] - 0.05]);
      }
      const outer = pts[pts.length - 1][0] + s * 0.28;
      pts.push([outer, pts[pts.length - 1][1]], [outer + s * 0.5, 0], [pts[0][0], 0]);
      const g = flatPrism(pts, 0.5);
      g.translate(0, 0, z - 0.25);
      parts.push({ geometry: g, color: 0x5f4a30 });
    }
    const half = vlAtZ(z, 0.36)[0] + 0.95;
    parts.push({ geometry: bar([-half, 0.14, z], [half, 0.14, z], 0.7, 0.28, { chamfer: 0.03 }), color: 0x4c3a25 });
  }
  for (const s of [-1, 1]) {
    parts.push({ geometry: bar([s * 3.6, 0.13, -14.4], [s * 3.6, 0.13, 14.4], 0.5, 0.26, { chamfer: 0.03 }), color: 0x4c3a25 });
  }
  return mergeParts(parts);
}

function vikingLongship() {
  const root = new THREE.Group();
  const hullTex = vlHullTexture();
  root.add(mesh(vlHull(), standard({
    vertexColors: true, map: hullTex, bumpMap: hullTex, bumpScale: -0.8, roughness: 0.72, metalness: 0,
  })));
  const woodTex = grainTexture(3, 0.4);
  root.add(mesh(vlWoodParts(), standard({
    vertexColors: true, map: woodTex, bumpMap: woodTex, bumpScale: -0.5, roughness: 0.68, metalness: 0,
  })));
  root.add(vlSail());

  // Shields hung on the rail, each overlapping the one abaft it. Black and yellow alternated on the
  // Gokstad ship, the last survivors of a set of sixty-four; red and white here echo the sail.
  const shields = [];
  const sets = [[0xcf9f2b, 0x1f1a15], [0x1f1a15, 0xcf9f2b], [0x9a2a1f, 0xd2c6ac]];
  const n = 21;
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z = lerp(-15.8, 15.8, i / (n - 1));
      const t = z / vlLen(1);
      const here = new THREE.Vector3(...vlOuter(t, 1, 0));
      here.x *= s;
      const nxt = new THREE.Vector3(...vlOuter(Math.min(0.99, t + 0.01), 1, 0));
      nxt.x *= s;
      const tan = nxt.sub(here).normalize();
      // +Z of the disc faces outboard, with a slight fan so each lies over the next.
      const outward3 = new THREE.Vector3(s, 0, 0);
      const up = new THREE.Vector3().crossVectors(outward3, tan).normalize();
      if (up.y < 0) up.negate();
      const normal = new THREE.Vector3().crossVectors(tan, up).normalize();
      if (normal.x * s < 0) normal.negate();
      normal.applyAxisAngle(new THREE.Vector3(0, 1, 0), s * 0.07);
      normal.y -= 0.05;
      normal.normalize();
      const right = new THREE.Vector3().crossVectors(up, normal).normalize();
      const up2 = new THREE.Vector3().crossVectors(normal, right).normalize();
      const m = new THREE.Matrix4().makeBasis(right, up2, normal);
      const centre = here.clone().add(new THREE.Vector3(s * 0.2, -0.02, 0));
      m.setPosition(centre);
      const [colorA, colorB] = sets[i % sets.length];
      const g = vlShield(i % 3, colorA, colorB);
      g.applyMatrix4(m);
      shields.push({ geometry: g, keepColor: true });
    }
  }
  root.add(mesh(mergeParts(shields), standard({ vertexColors: true, roughness: 0.62, metalness: 0.05 })));
  return root;
}

// ---------------------------------------------------------------------------
// The covered wagon
// ---------------------------------------------------------------------------

// A prairie schooner at life size: a 10ft box on 4ft rear and 3.2ft front wheels, tongue forward.
// Authored with the box centred on z = 0, then moved back along z as a whole so the origin sits under
// the middle of the wagon-and-tongue rather than under the box alone.
const WG = {
  railY: 4.74, floorY: 2.56, halfW: 1.86, shift: -2.3,
  rearZ: -3.05, frontZ: 3.25, rearR: 2.0, frontR: 1.6, trackX: 2.56,
};
const WG_RED = 0x8e2f20;
const WG_BLUE = 0x336793;
const WG_IRON = 0x2b2a28;
const WG_HICKORY = 0xad9266;
const WG_OAK = 0x7a5e3c;

// Everything round the wheels comes from the same arc function, so tyre, felloe and bows all close.
function wgRing(rIn, rOut, halfW, segments) {
  const rows = [
    [rIn, -halfW], [rOut, -halfW], [rOut, -halfW], [rOut, halfW], [rOut, halfW], [rIn, halfW], [rIn, halfW], [rIn, -halfW],
  ];
  const g = lathe(rows, { segments });
  g.rotateZ(-Math.PI / 2);
  // Grain round the rim, not across it.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rOut * 6.28, uv.getY(i) * 0.6);
  return g;
}

function wgWheel(wood, iron, R, spokes, cx, cy, cz, side) {
  // Authored about the X axis with +X outboard, then mirrored for the -X side.
  const put = (list, g, color) => {
    const out = side < 0 ? mirroredX(g) : g;
    out.translate(cx, cy, cz);
    list.push({ geometry: out, color });
  };
  const dish = 0.1; // a real wheel is dished: the rim stands outboard of the hub
  const segs = Math.round(52 * (R / 2));
  put(iron, wgRing(R - 0.075, R, 0.115, segs).translate(dish, 0, 0), WG_IRON);
  put(wood, wgRing(R - 0.33, R - 0.07, 0.1, segs).translate(dish, 0, 0), WG_RED);
  const hubR = R * 0.205;
  const hub = lathe([
    [0, -0.5], [hubR * 0.52, -0.5], [hubR * 0.52, -0.5], [hubR * 0.78, -0.44], [hubR * 0.92, -0.26], [hubR, -0.12], [hubR, 0.12], [hubR * 0.9, 0.26], [hubR * 0.72, 0.42], [hubR * 0.58, 0.52], [hubR * 0.58, 0.52], [0, 0.52],
  ], { segments: 22 });
  hub.rotateZ(-Math.PI / 2);
  put(wood, hub, WG_RED);
  // Iron hub bands, each a hair proud of the wood it binds, and the axle nut.
  for (const [x, r] of [[-0.3, hubR * 0.93], [0.25, hubR * 0.94], [0.44, hubR * 0.74]]) {
    const band = wgRing(r - 0.04, r + 0.012, 0.038, 22);
    band.translate(x, 0, 0);
    put(iron, band, WG_IRON);
  }
  const nut = new THREE.CylinderGeometry(hubR * 0.28, hubR * 0.3, 0.14, 6);
  nut.rotateZ(-Math.PI / 2);
  nut.translate(0.58, 0, 0);
  put(iron, nut, WG_IRON);
  // Spokes are lofts rooted in the hub and tenoned into the felloe, oval, wider than they are thick.
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + 0.12;
    const inner = [0.02, Math.cos(a) * hubR * 0.7, Math.sin(a) * hubR * 0.7];
    const outer = [dish, Math.cos(a) * (R - 0.2), Math.sin(a) * (R - 0.2)];
    const { m: sm, len } = alongMatrix(inner, outer, [1, 0, 0]);
    const w = R * 0.04;
    const spoke = solidLoft([
      { d: 0, w: w * 0.8, h: w * 1.6 }, { d: len * 0.22, w: w * 1.0, h: w * 1.75 }, { d: len * 0.7, w: w * 0.72, h: w * 1.35 }, { d: len, w: w * 0.62, h: w * 1.1 },
    ], { sides: 8, samples: 6 });
    spoke.applyMatrix4(sm);
    put(wood, spoke, WG_RED);
  }
  // Tyre bolts through the felloe, on the outboard face only.
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    const r = R - 0.2;
    put(iron, stud([dish + 0.1, Math.cos(a) * r, Math.sin(a) * r], [1, 0, 0], 0.035, 0.018, 6), WG_IRON);
  }
}

// One bow's shape, used for the bow itself, the cover over it and everything tied to them. theta runs
// from 0 at +X over the top to PI at -X.
function wgArch(z, theta, height, outset = 0) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const A = 2.06 + outset;
  const x = Math.sign(c) * Math.pow(Math.abs(c), 0.86) * A;
  const y = WG.railY + Math.pow(Math.abs(s), 0.86) * (height + outset);
  // The end bows lean out, so the top of the cover runs longer than the box.
  const lean = (z / 4.4) * 0.5 * Math.pow(Math.abs(s), 1.4);
  return [x, y, z + lean];
}

const WG_BOWS = [-4.32, -2.84, -1.36, 0.12, 1.6, 3.08];
const WG_HEIGHT = (z) => 4.72 + 0.34 * Math.pow(Math.abs(z) / 4.4, 2);

function wgCoverPoint(u, v) {
  // u across, v along. The first and last slices of u are the skirt, hanging outside the rail.
  const skirt = 0.04;
  const s = v * (WG_BOWS.length - 1);
  const i = Math.min(WG_BOWS.length - 2, Math.floor(s));
  const f = s - i;
  const z = lerp(WG_BOWS[i], WG_BOWS[i + 1], f);
  const h = WG_HEIGHT(z);
  const sag = 0.1 * Math.pow(Math.sin(Math.PI * f), 2);
  if (u < skirt || u > 1 - skirt) {
    const sign = u < skirt ? 1 : -1;
    const hem = u < skirt ? u / skirt : (1 - u) / skirt;
    return [sign * (2.13 - sag * 0.2), WG.railY - 0.34 * (1 - hem), z];
  }
  const theta = Math.PI * ((u - skirt) / (1 - 2 * skirt));
  const outset = 0.07 - sag;
  const p = wgArch(z, theta, h, outset);
  // A few long soft creases across the cloth, stronger low down where it is slack.
  const crease = 0.018 * Math.sin(z * 4.2 + theta * 3) * (1 - Math.sin(theta) * 0.7);
  return [p[0] * (1 + crease * 0.4), p[1] + crease, p[2]];
}

function wgPucker(u, v, end) {
  // From the last bow in to the drawstring. u matches the cover's u along the bow, v from bow to string.
  const zBow = end > 0 ? WG_BOWS[WG_BOWS.length - 1] : WG_BOWS[0];
  const zEnd = end > 0 ? 4.28 : -5.44;
  const P0 = wgCoverPoint(u, end > 0 ? 1 : 0);
  // On the drawstring: a round mouth whose bottom sits on the end-board's top edge.
  const phi = -Math.PI / 2 + u * Math.PI * 2;
  const rx = 1.02; const ry = 0.98;
  const cy = WG.railY + ry + 0.1;
  const P1 = [Math.cos(phi) * rx, cy + Math.sin(phi) * ry, zEnd];
  const e = Math.pow(v, 1.15);
  const x = lerp(P0[0], P1[0], e);
  const y = lerp(P0[1], P1[1], e);
  const bulge = Math.sin(Math.PI * v) * 0.34 * Math.sin(u * Math.PI);
  const z = lerp(P0[2], P1[2], Math.pow(v, 0.8)) + (end > 0 ? bulge : -bulge);
  // The gathers: radial pleats that grow toward the string, a whole number round so u = 0 meets u = 1.
  const pleat = Math.sin(u * Math.PI * 2 * 15) * 0.055 * Math.pow(v, 1.1) * (1 - v * 0.18);
  const dx = x; const dy = y - cy;
  const l = Math.hypot(dx, dy) || 1;
  return [x + (dx / l) * pleat, y + (dy / l) * pleat, z + pleat * 0.5 * (end > 0 ? 1 : -1)];
}

function wgCanvasColors(g) {
  // The outer sheet is off-white with dust toward its hem; the inner sheet is dim, because nothing in
  // this app lets light soak through cloth and an interior as bright as the exterior reads as a hole.
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const half = pos.count / 2;
  let dot = 0;
  for (let i = 0; i < half; i += 3) {
    dot += nor.getX(i) * pos.getX(i) + nor.getY(i) * (pos.getY(i) - WG.railY - 1);
  }
  const outerFirst = dot > 0;
  const outerC = linearColor(0xd8d1bd);
  const dust = linearColor(0xb4a488);
  const innerC = linearColor(0x6b6556);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const isOuter = (i < half) === outerFirst;
    const k = 1 - smooth(WG.railY - 0.2, WG.railY + 1.1, pos.getY(i));
    const n = smoothNoise3(pos.getX(i) * 0.5, pos.getY(i) * 0.5, pos.getZ(i) * 0.5);
    const c = isOuter ? [lerp(outerC[0], dust[0], k), lerp(outerC[1], dust[1], k), lerp(outerC[2], dust[2], k)] : innerC;
    const m = 0.92 + n * 0.14;
    arr[i * 3] = c[0] * m; arr[i * 3 + 1] = c[1] * m; arr[i * 3 + 2] = c[2] * m;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function wgCanvas() {
  const parts = [];
  const cover = solidSurface({ nu: 44, nv: 50, point: wgCoverPoint, thick: () => 0.03 });
  parts.push({ geometry: wgCanvasColors(cover), keepColor: true });
  for (const end of [-1, 1]) {
    const pucker = solidSurface({ nu: 135, nv: 9, point: (u, v) => wgPucker(u, v, end), thick: () => 0.03 });
    // The cloth's seams run toward the drawstring here, which is along v, so its UVs are turned a
    // quarter: left as they come, the seams draw concentric rings round the mouth like a target.
    const puv = pucker.attributes.uv;
    for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getY(i) * 0.14, puv.getX(i) * 1.5);
    parts.push({ geometry: wgCanvasColors(pucker), keepColor: true });
    // A bound hem over the bow, where the cover and the gathered end are sewn together. It also closes
    // the seam: the cover has 44 columns and the end 135, so their edges cannot share vertices.
    const hemLine = [];
    for (let i = 0; i <= 44; i++) hemLine.push(wgCoverPoint(i / 44, end > 0 ? 1 : 0));
    parts.push({ geometry: colored(tubeOut(hemLine, [0.05, 0.05], { sides: 7, tubular: 66 }), 0xbcb49d), keepColor: true });
  }
  const g = mergeParts(parts);
  const tex = canvasTexture(1024, 1024, (ctx, w, h) => {
    const rng = seededRandom(1848);
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(0, 0, w, h);
    // The widths of duck the bonnet was sewn from, running over the top from rail to rail, with their
    // double-stitched seams. Stains are from weather, and they run down the cloth.
    for (let i = 1; i < 9; i++) {
      const y = (i / 9) * h;
      ctx.fillStyle = 'rgba(120,108,88,0.35)';
      ctx.fillRect(0, y - 1, w, 2.4);
      ctx.fillStyle = 'rgba(120,108,88,0.14)';
      ctx.fillRect(0, y + 5, w, 1.4);
    }
    for (let i = 0; i < 200; i++) {
      const x = rng() * w; const y = rng() * h; const l = 14 + rng() * 70;
      ctx.fillStyle = `rgba(116,96,70,${0.008 + rng() * 0.026})`;
      ctx.beginPath(); ctx.ellipse(x, y, l, l * (0.7 + rng() * 0.6), 0, 0, Math.PI * 2); ctx.fill();
    }
    for (const [x, y] of [[300, 700], [770, 290]]) {
      // A patch or two: nobody crossed the plains without mending. The sheet spans 15ft one way and
      // 7.5ft the other, so a square patch is drawn twice as long across the canvas as along it.
      ctx.fillStyle = 'rgba(218,208,184,0.55)';
      ctx.fillRect(x, y, 56, 100);
      ctx.strokeStyle = 'rgba(96,84,64,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x, y, 56, 100);
      ctx.setLineDash([]);
    }
  });
  const m = mesh(g, standard({
    vertexColors: true, map: tex, roughness: 0.96, metalness: 0, ...relief('weave', { seed: 21, repeat: 7, strength: 0.14 }),
  }));
  return m;
}

function coveredWagon() {
  const root = new THREE.Group();
  const wood = [];
  const iron = [];
  const { railY, floorY, halfW, rearZ, frontZ, rearR, frontR, trackX } = WG;
  const add = (list, g, color) => list.push({ geometry: g, color });

  // ---- the wheels and axles --------------------------------------------------------------------------
  for (const s of [-1, 1]) {
    wgWheel(wood, iron, rearR, 14, s * trackX, rearR, rearZ, s);
    wgWheel(wood, iron, frontR, 12, s * trackX, frontR, frontZ, s);
  }
  const axle = (z, y) => {
    add(wood, bar([-trackX + 0.34, y, z], [trackX - 0.34, y, z], 0.34, 0.36, { chamfer: 0.04 }), WG_RED);
    for (const s of [-1, 1]) {
      add(iron, rod([s * (trackX - 0.6), y, z], [s * (trackX + 0.4), y, z], 0.11, 0.08, 10), WG_IRON);
      // An iron clip round each end of the axletree.
      add(iron, bar([s * (trackX - 0.8), y, z], [s * (trackX - 0.72), y, z], 0.37, 0.39, { chamfer: 0.04 }), WG_IRON);
    }
  };
  axle(rearZ, rearR);
  axle(frontZ, frontR);
  // Bolsters carry the box, with iron-capped standards either side so it cannot walk off.
  const bolster = (z, y0, y1) => {
    const y = (y0 + y1) / 2;
    add(wood, bar([-halfW - 0.26, y, z], [halfW + 0.26, y, z], 0.36, y1 - y0, { chamfer: 0.035 }), WG_RED);
    for (const s of [-1, 1]) {
      add(wood, bar([s * (halfW + 0.15), y0 + 0.05, z], [s * (halfW + 0.15), floorY + 0.82, z], 0.14, 0.22, { up: [0, 0, 1] }), WG_RED);
      add(iron, bar([s * (halfW + 0.15), floorY + 0.74, z], [s * (halfW + 0.15), floorY + 0.84, z], 0.17, 0.25, { chamfer: 0.015, up: [0, 0, 1] }), WG_IRON);
    }
  };
  bolster(rearZ, rearR + 0.17, floorY);
  bolster(frontZ, frontR + 0.17 + 0.28, floorY);
  // A sand board under the front bolster, for the height a front axle has to make up.
  add(wood, bar([-1.75, frontR + 0.31, frontZ], [1.75, frontR + 0.31, frontZ], 0.33, 0.28, { chamfer: 0.03 }), WG_RED);
  // The kingpin through all of it.
  add(iron, rod([0, frontR - 0.26, frontZ], [0, floorY + 0.02, frontZ], 0.055, 0.055, 8), WG_IRON);

  // The reach couples the axles, and the rear hounds brace it to the rear axle.
  add(wood, bar([0, frontR + 0.18, frontZ + 0.2], [0, rearR + 0.05, rearZ - 1.3], 0.24, 0.18, { chamfer: 0.03 }), WG_RED);
  for (const s of [-1, 1]) {
    add(wood, bar([s * 1.45, rearR - 0.03, rearZ + 0.05], [s * 0.12, rearR + 0.02, rearZ + 2.5], 0.17, 0.14, { chamfer: 0.025 }), WG_RED);
  }
  // Front hounds run forward from the axle and close on the tongue, and a sway bar behind ties them.
  for (const s of [-1, 1]) {
    add(wood, bar([s * 1.32, frontR - 0.03, frontZ - 0.05], [s * 0.2, frontR + 0.01, frontZ + 2.0], 0.17, 0.14, { chamfer: 0.025 }), WG_RED);
    add(wood, bar([s * 1.32, frontR - 0.03, frontZ + 0.05], [s * 0.62, frontR + 0.07, frontZ - 1.15], 0.14, 0.12, { chamfer: 0.025 }), WG_RED);
  }
  add(wood, bar([-0.86, frontR + 0.08, frontZ - 1.0], [0.86, frontR + 0.08, frontZ - 1.0], 0.15, 0.1, { chamfer: 0.02 }), WG_RED);

  // ---- the tongue, resting its tip on the ox yoke -------------------------------------------------------
  const tongueA = [0, frontR, frontZ + 0.8];
  const tongueB = [0, 0.56, 9.94];
  const tm = alongMatrix(tongueA, tongueB, [0, 1, 0]);
  const tongue = solidLoft([
    { d: 0, w: 0.13, h: 0.13, round: 0.55 }, { d: tm.len * 0.2, w: 0.14, h: 0.14, round: 0.55 }, { d: tm.len * 0.6, w: 0.115, h: 0.115, round: 0.7 },
    { d: tm.len, w: 0.075, h: 0.075, round: 0.85 },
  ], { sides: 12, samples: 16 });
  tongue.applyMatrix4(tm.m);
  add(wood, tongue, WG_RED);
  add(iron, rod([-0.2, frontR - 0.0, frontZ + 1.7], [0.2, frontR - 0.0, frontZ + 1.7], 0.035, 0.035, 8), WG_IRON);
  // The iron ring and draw chain at the tongue's tip.
  add(iron, new THREE.TorusGeometry(0.12, 0.024, 6, 14).rotateY(Math.PI / 2).translate(0, 0.48, 10.04), WG_IRON);
  // The doubletree across the tongue. Oxen pull from a yoke, but a wagon carries one for mules too.
  add(wood, bar([-1.25, frontR - 0.06, frontZ + 1.3], [1.25, frontR - 0.06, frontZ + 1.3], 0.17, 0.13, { chamfer: 0.025 }), WG_RED);
  for (const s of [-1, 1]) add(iron, stud([s * 1.2, frontR - 0.06, frontZ + 1.39], [0, 0, 1], 0.05, 0.03, 6), WG_IRON);

  // An ox yoke lying where the team was unhitched. There are no animals on this model, and a yoke is the
  // one thing that says what pulled it. It is lifted a little on its own bows, tip of the tongue on top.
  const yokeZ = 10.02;
  const yokeY = 0.4;
  const yoke = solidLoft([
    { d: -2.45, w: 0.1, h: 0.1 }, { d: -2.3, w: 0.2, h: 0.17 }, { d: -1.5, w: 0.2, up: 0.15, dn: 0.2, b: 0.02 }, { d: -0.5, w: 0.2, up: 0.2, dn: 0.15, b: 0.02 }, { d: 0, w: 0.22, h: 0.22 },
    { d: 0.5, w: 0.2, up: 0.2, dn: 0.15, b: 0.02 }, { d: 1.5, w: 0.2, up: 0.15, dn: 0.2, b: 0.02 }, { d: 2.3, w: 0.2, h: 0.17 }, { d: 2.45, w: 0.1, h: 0.1 },
  ], { axis: 'x', sides: 14, samples: 30 });
  yoke.translate(0, yokeY, yokeZ);
  add(wood, yoke, WG_HICKORY);
  for (const s of [-1, 1]) {
    // Each oxbow, a U of steamed hickory hanging down through the beam, here laid back under it.
    const bow = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI;
      bow.push([s * 1.4 + Math.cos(a) * 0.48, yokeY + 0.1 - Math.sin(a) * 0.16, yokeZ - 0.02 + Math.sin(a) * 1.0]);
    }
    add(wood, tubeOut(bow, [0.055, 0.055], { sides: 8, tubular: 20 }), WG_HICKORY);
    add(iron, stud([s * 1.4 + 0.48, yokeY + 0.22, yokeZ], [0, 1, 0], 0.07, 0.02, 6), WG_IRON);
    add(iron, stud([s * 1.4 - 0.48, yokeY + 0.22, yokeZ], [0, 1, 0], 0.07, 0.02, 6), WG_IRON);
  }

  // ---- the box -----------------------------------------------------------------------------------------
  const flare = 0.1; // the sides lean out a touch toward the rail
  const floorHalf = 4.86;
  const topHalf = 5.34;
  add(wood, bar([0, floorY + 0.03, -floorHalf], [0, floorY + 0.03, floorHalf], halfW * 2 - 0.04, 0.14, { chamfer: 0.02 }), 0x4e3a25);
  const boards = 4;
  const bh = (railY - floorY - 0.14) / boards;
  const y0 = floorY + 0.1;
  const rngB = seededRandom(1849);
  const blue = new THREE.Color(WG_BLUE);
  const boardTone = () => {
    const k = 0.9 + rngB() * 0.2;
    return new THREE.Color(blue.r * k, blue.g * k, blue.b * k).getHex();
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < boards; i++) {
      const a = y0 + i * bh + 0.006;
      const b = y0 + (i + 1) * bh - 0.006;
      const za = lerp(floorHalf, topHalf, (a - y0) / (railY - y0));
      const zb = lerp(floorHalf, topHalf, (b - y0) / (railY - y0));
      const xa = s * (halfW + flare * ((a - y0) / (railY - y0)));
      const xb = s * (halfW + flare * ((b - y0) / (railY - y0)));
      const xm = (xa + xb) / 2;
      // Board outline in (z, y), extruded across its own thickness along X.
      const outline = [[-za, a], [za, a], [zb, b], [-zb, b]];
      const g = flatPrism(outline.map(([z, y]) => [-z, y]), 0.09);
      g.rotateY(Math.PI / 2);
      g.translate(xm - 0.045, 0, 0);
      add(wood, g, boardTone());
    }
    // A backing board behind the seams, in shadow, so a gap between planks is a gap and not daylight.
    add(wood, bar([s * (halfW - 0.05), floorY + 0.1, 0], [s * (halfW - 0.05), railY - 0.03, 0], 0.06, 9.6, { chamfer: 0.01, up: [0, 0, 1] }), 0x2a2018);
    // Top rail, in a darker blue, with iron staples where the bows stand.
    add(wood, bar([s * (halfW + flare), railY + 0.015, -topHalf - 0.03], [s * (halfW + flare), railY + 0.015, topHalf + 0.03], 0.2, 0.11, { chamfer: 0.025 }), 0x24496b);
    // Battens down the side, one at each bow and at each corner.
    for (const z of [...WG_BOWS, 4.6]) {
      add(wood, bar([s * (halfW + 0.14), floorY + 0.06, z], [s * (halfW + 0.2), railY - 0.02, z], 0.07, 0.17, { chamfer: 0.015, up: [0, 0, 1] }), 0x254f73);
    }
  }
  // Sloped end boards, leaning out at the same angle as the side boards' own ends.
  const lean = Math.atan2(topHalf - floorHalf, railY - y0);
  for (const e of [-1, 1]) {
    for (let i = 0; i < boards; i++) {
      const y = y0 + (i + 0.5) * bh;
      const z = e * lerp(floorHalf, topHalf, (y - y0) / (railY - y0));
      const w = halfW + flare * ((y - y0) / (railY - y0)) + 0.04;
      add(wood, bar([-w, y, z], [w, y, z], 0.09, bh - 0.012, { chamfer: 0.012, up: [0, Math.cos(lean), e * Math.sin(lean)] }), boardTone());
    }
    add(wood, bar([0, y0, e * (floorHalf - 0.05)], [0, railY - 0.02, e * (topHalf - 0.05)], halfW * 2 - 0.1, 0.05, { chamfer: 0.01, up: [0, 0, 1] }), 0x2a2018);
    // Two iron rods running across the end, which is what keeps a wagon's end from spreading.
    add(iron, rod([-halfW - 0.18, floorY + 1.3, e * 5.17], [halfW + 0.18, floorY + 1.3, e * 5.17], 0.022, 0.022, 6), WG_IRON);
    add(iron, rod([-halfW - 0.18, floorY + 0.5, e * 5.0], [halfW + 0.18, floorY + 0.5, e * 5.0], 0.022, 0.022, 6), WG_IRON);
    add(wood, bar([-halfW - flare - 0.1, railY + 0.015, e * topHalf], [halfW + flare + 0.1, railY + 0.015, e * topHalf], 0.17, 0.11, { chamfer: 0.025 }), 0x24496b);
  }

  // ---- bows ---------------------------------------------------------------------------------------------
  const bowProfile = [[-0.03, -0.075], [0.03, -0.075], [0.03, 0.075], [-0.03, 0.075]];
  for (const z of WG_BOWS) {
    const pts = [];
    pts.push([2.12, railY - 0.62, z]);
    pts.push([2.1, railY - 0.25, z]);
    const h = WG_HEIGHT(z);
    for (let i = 1; i <= 15; i++) pts.push(wgArch(z, (i / 16) * Math.PI, h));
    pts.push([-2.1, railY - 0.25, z]);
    pts.push([-2.12, railY - 0.62, z]);
    add(wood, swept(pts, bowProfile, { samples: 44, up: new THREE.Vector3(0, 0, 1) }), WG_HICKORY);
    for (const s of [-1, 1]) {
      // The iron staple at the rail, wrapped round bow and batten.
      add(iron, bar([s * 2.05, railY - 0.45, z], [s * 2.05, railY - 0.34, z], 0.24, 0.27, { chamfer: 0.012, up: [0, 0, 1] }), WG_IRON);
    }
  }

  // ---- ropes tying the cover down, and the two drawstrings -----------------------------------------------
  const ROPE = 0x7f7253;
  for (const s of [-1, 1]) {
    const hemY = railY - 0.3;
    add(wood, tubeOut([[s * 2.15, hemY, WG_BOWS[0] - 0.8], [s * 2.15, hemY, 0], [s * 2.15, hemY, WG_BOWS[5] + 0.6]], [0.024, 0.024], { sides: 6, tubular: 16 }), ROPE);
    for (let i = 0; i < 15; i++) {
      const z = lerp(WG_BOWS[0] - 0.3, WG_BOWS[5] + 0.3, i / 14);
      add(wood, rod([s * 2.15, hemY + 0.02, z], [s * 2.0, railY + 0.05, z + 0.04], 0.018, 0.018, 5), ROPE);
    }
  }
  for (const end of [-1, 1]) {
    const string = [];
    for (let i = 0; i < 40; i++) string.push(wgPucker(i / 40, 1, end));
    string.push(string[0]);
    add(wood, tubeOut(string, [0.045, 0.045], { sides: 8, tubular: 80 }), ROPE);
    // The loose end, knotted and hanging.
    const knot = string[0];
    add(wood, ball(0.07, 8), ROPE);
    wood[wood.length - 1].position = knot;
    add(wood, tubeOut([knot, [knot[0] + 0.03, knot[1] - 0.25, knot[2] + end * 0.03], [knot[0] + 0.02, knot[1] - 0.55, knot[2] + end * 0.04]], [0.022, 0.02, 0.01], { sides: 5, tubular: 8 }), ROPE);
  }

  // ---- the seat ----------------------------------------------------------------------------------------
  const seatZ = 4.72;
  const seatY = railY + 0.62;
  add(wood, bar([-1.82, seatY, seatZ], [1.82, seatY, seatZ], 0.82, 0.1, { chamfer: 0.025 }), WG_OAK);
  for (const s of [-1, 1]) {
    // Iron spring risers from rail to seat: a seat bolted straight down shakes the driver's teeth out.
    const pts = [[s * (halfW + flare - 0.04), railY + 0.06, seatZ - 0.26], [s * 1.86, railY + 0.3, seatZ - 0.16], [s * 1.62, seatY - 0.04, seatZ]];
    add(iron, tubeOut(pts, [0.03, 0.03, 0.03], { sides: 6, tubular: 10 }), WG_IRON);
    const pts2 = [[s * (halfW + flare - 0.04), railY + 0.06, seatZ + 0.26], [s * 1.86, railY + 0.3, seatZ + 0.16], [s * 1.62, seatY - 0.04, seatZ]];
    add(iron, tubeOut(pts2, [0.03, 0.03, 0.03], { sides: 6, tubular: 10 }), WG_IRON);
  }
  add(wood, bar([-1.7, seatY + 0.74, seatZ - 0.42], [1.7, seatY + 0.74, seatZ - 0.42], 0.08, 0.2, { chamfer: 0.02 }), WG_OAK);
  for (const x of [-1.6, -0.8, 0, 0.8, 1.6]) {
    add(wood, rod([x, seatY, seatZ - 0.34], [x, seatY + 0.68, seatZ - 0.42], 0.028, 0.024, 8), WG_OAK);
  }
  // A footboard across the front of the box.
  add(wood, bar([-1.72, railY - 0.42, seatZ + 0.1], [1.72, railY - 0.42, seatZ + 0.1], 0.8, 0.07, { chamfer: 0.015 }), 0x5a4630);

  // ---- the water barrel, on the +X side -------------------------------------------------------------------
  const barrelZ = 0.72;
  const barrelX = halfW + flare + 0.56;
  const barrelBase = floorY + 0.18;
  const staves = 16;
  const barrelRows = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    barrelRows.push([0.44 + 0.1 * Math.sin(t * Math.PI), t * 1.56]);
  }
  const barrel = lathe([[0, 0.04], [0.42, 0.04], [0.42, 0.04], [0.44, 0], [0.44, 0], ...barrelRows, [0.44, 1.56], [0.42, 1.52], [0.42, 1.52], [0, 1.52]], { segments: 48 });
  colored(barrel, (p) => {
    // Staves, seen as a tone that changes from one to the next round the barrel.
    const a = Math.atan2(p.x, p.z) / (Math.PI * 2) + 0.5;
    const k = Math.floor(a * staves);
    const edge = Math.abs((a * staves) % 1 - 0.5) > 0.44 ? 0.55 : 1;
    const c = linearColor([0x7b5f3e, 0x6f5436, 0x846643, 0x745a3a][k % 4]);
    return [c[0] * edge, c[1] * edge, c[2] * edge];
  });
  barrel.translate(barrelX, barrelBase, barrelZ);
  wood.push({ geometry: barrel, keepColor: true });
  for (const t of [0.12, 0.34, 0.66, 0.88]) {
    const r = 0.44 + 0.1 * Math.sin(t * Math.PI);
    const hoop = lathe([[r - 0.02, -0.035], [r + 0.012, -0.035], [r + 0.012, -0.035], [r + 0.012, 0.035], [r + 0.012, 0.035], [r - 0.02, 0.035], [r - 0.02, 0.035], [r - 0.02, -0.035]], { segments: 36 });
    hoop.translate(barrelX, barrelBase + t * 1.56, barrelZ);
    add(iron, hoop, WG_IRON);
  }
  // Lid with a turned handle, a shelf under it and a strap to the box.
  add(wood, stud([barrelX, barrelBase + 1.54, barrelZ], [0, 1, 0], 0.4, 0.03, 16), 0x7b5f3e);
  add(wood, ball(0.05, 8), 0x4e3a25);
  wood[wood.length - 1].position = [barrelX, barrelBase + 1.6, barrelZ];
  for (const dz of [-0.28, 0.28]) {
    add(wood, bar([halfW + 0.04, barrelBase - 0.07, barrelZ + dz], [barrelX + 0.55, barrelBase - 0.07, barrelZ + dz], 0.12, 0.14, { chamfer: 0.02 }), 0x4e3a25);
    add(iron, bar([barrelX + 0.5, barrelBase - 0.14, barrelZ + dz], [halfW + flare - 0.02, barrelBase - 0.62, barrelZ + dz], 0.06, 0.03, { chamfer: 0.008 }), WG_IRON);
  }
  add(wood, bar([halfW + 0.04, barrelBase - 0.02, barrelZ], [barrelX + 0.55, barrelBase - 0.02, barrelZ], 0.95, 0.05, { chamfer: 0.01 }), 0x5a4630);
  const strap = lathe([[0.56, -0.03], [0.59, -0.03], [0.59, -0.03], [0.59, 0.03], [0.59, 0.03], [0.56, 0.03], [0.56, 0.03], [0.56, -0.03]], { segments: 36 });
  strap.translate(barrelX, barrelBase + 0.82, barrelZ);
  add(iron, strap, WG_IRON);
  // A tin dipper hooked over the barrel's edge.
  const dipperCup = lathe([[0, 0], [0.13, 0], [0.13, 0], [0.14, 0.14], [0.14, 0.14], [0.115, 0.14], [0.115, 0.14], [0.11, 0.03], [0, 0.03]], { segments: 14 });
  dipperCup.translate(barrelX + 0.5, barrelBase + 1.05, barrelZ + 0.26);
  add(iron, dipperCup, 0x7a7a74);
  add(iron, rod([barrelX + 0.5, barrelBase + 1.2, barrelZ + 0.26], [barrelX + 0.28, barrelBase + 1.58, barrelZ + 0.26], 0.015, 0.015, 5), 0x7a7a74);

  // ---- the tool box, on the -X side -----------------------------------------------------------------------
  const toolZ = 0.72;
  const toolX = -(halfW + flare + 0.34);
  const tbY = floorY + 0.68;
  add(wood, bar([toolX, tbY, toolZ - 1.2], [toolX, tbY, toolZ + 1.2], 0.66, 0.72, { chamfer: 0.025 }), WG_OAK);
  // Lid, overhung and sloped away from the rain, hinged at the box.
  add(wood, bar([toolX, tbY + 0.42, toolZ - 1.25], [toolX, tbY + 0.42, toolZ + 1.25], 0.76, 0.08, { chamfer: 0.02, up: [Math.sin(0.1), Math.cos(0.1), 0] }), 0x8a6c47);
  for (const dz of [-0.8, 0.8]) {
    add(iron, bar([toolX - 0.34, tbY - 0.34, toolZ + dz], [toolX - 0.34, tbY + 0.46, toolZ + dz], 0.022, 0.13, { chamfer: 0.006, up: [0, 0, 1] }), WG_IRON);
    add(iron, bar([toolX - 0.38, tbY + 0.45, toolZ + dz], [toolX + 0.36, tbY + 0.45, toolZ + dz], 0.02, 0.13, { chamfer: 0.006 }), WG_IRON);
  }
  add(iron, stud([toolX - 0.34, tbY + 0.2, toolZ], [-1, 0, 0], 0.075, 0.03, 8), WG_IRON);
  for (const dz of [-0.9, 0.9]) {
    add(iron, bar([-(halfW + 0.04), tbY - 0.44, toolZ + dz], [toolX - 0.3, tbY - 0.4, toolZ + dz], 0.06, 0.05, { chamfer: 0.01 }), WG_IRON);
  }

  // ---- the brake: a lever on the -X side, a beam across, a wooden shoe at each rear tyre -----------------
  const brakeZ = rearZ + rearR + 0.08;
  add(wood, bar([-trackX - 0.08, rearR + 0.28, brakeZ], [trackX + 0.08, rearR + 0.28, brakeZ], 0.13, 0.17, { chamfer: 0.025 }), WG_RED);
  for (const s of [-1, 1]) {
    add(wood, bar([s * (trackX + 0.1), rearR + 0.03, brakeZ - 0.14], [s * (trackX + 0.1), rearR + 0.53, brakeZ - 0.14], 0.26, 0.2, { chamfer: 0.025 }), 0x56402a);
    add(iron, rod([s * (halfW + 0.2), rearR + 0.28, brakeZ], [s * (halfW + 0.03), floorY + 0.3, brakeZ - 0.18], 0.025, 0.025, 6), WG_IRON);
  }
  const leverX = -trackX - 0.25;
  add(wood, bar([leverX, rearR + 0.08, brakeZ + 0.04], [leverX, railY + 0.86, brakeZ - 0.42], 0.1, 0.07, { chamfer: 0.015, up: [0, 0, 1] }), WG_RED);
  add(iron, bar([leverX + 0.18, rearR + 0.28, brakeZ], [leverX - 0.04, rearR + 0.28, brakeZ], 0.16, 0.1, { chamfer: 0.015 }), WG_IRON);
  add(iron, rod([leverX + 0.02, railY + 0.86, brakeZ - 0.42], [leverX - 0.04, railY + 0.86, brakeZ - 0.42], 0.05, 0.05, 6), WG_IRON);

  // ---- tar bucket hung from the rear axle, the one greasy thing nobody forgot --------------------------
  const bucketX = 1.0;
  const bucketY = rearR - 0.98;
  const bucket = lathe([[0, 0], [0.2, 0], [0.2, 0], [0.27, 0.46], [0.27, 0.46], [0.235, 0.46], [0.235, 0.46], [0.18, 0.05], [0, 0.05]], { segments: 18 });
  bucket.translate(bucketX, bucketY, rearZ);
  add(wood, bucket, 0x3a2b1d);
  const bail = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    bail.push([bucketX + Math.cos(a) * 0.26, bucketY + 0.46 + Math.sin(a) * 0.32, rearZ]);
  }
  add(iron, tubeOut(bail, [0.014, 0.014], { sides: 5, tubular: 14 }), WG_IRON);
  add(iron, rod([bucketX, bucketY + 0.78, rearZ], [bucketX, rearR - 0.13, rearZ], 0.016, 0.016, 5), WG_IRON);

  // ---- what is inside, seen through the puckered ends ------------------------------------------------------
  add(wood, bar([0, floorY + 0.5, -4.4], [0, floorY + 0.5, -3.2], 1.5, 0.8, { chamfer: 0.03 }), 0x6a5136);
  add(wood, bar([0.1, floorY + 0.98, -4.2], [0.1, floorY + 0.98, -3.5], 1.0, 0.16, { chamfer: 0.02 }), 0x7c5f3f);
  for (const [x, y, z, r] of [[-1.05, 0.46, -3.95, 0.46], [1.05, 0.46, -3.95, 0.46], [-1.0, 1.0, -3.6, 0.42], [-0.8, 0.5, 3.1, 0.54], [0.9, 0.48, 3.5, 0.5], [0.25, 1.0, 3.2, 0.46]]) {
    const sack = ball(r, 12);
    sack.scale(1, 0.72, 1.3);
    wood.push({ geometry: sack, color: 0xb6a786, position: [x, floorY + y, z] });
  }
  const pack = lathe([[0, 0], [0.44, 0], [0.44, 0], [0.5, 0.5], [0.44, 1.05], [0.44, 1.05], [0, 1.05]], { segments: 16 });
  pack.translate(1.15, floorY + 0.1, 3.0);
  add(wood, pack, 0x6a5136);

  const shift = (g) => { g.translate(0, 0, WG.shift); return g; };

  const woodTex = grainTexture(1847, 0.32, 1);
  root.add(mesh(shift(mergeParts(wood)), standard({
    vertexColors: true, map: woodTex, bumpMap: woodTex, bumpScale: -0.6, roughness: 0.66, metalness: 0,
  })));
  root.add(mesh(shift(mergeParts(iron)), standard({ vertexColors: true, roughness: 0.56, metalness: 0.3 })));
  const canvas = wgCanvas();
  shift(canvas.geometry);
  root.add(canvas);
  return root;
}

export const BUILDERS = {
  'covered-wagon': () => coveredWagon(),
  'viking-longship': () => vikingLongship(),
  'rosetta-stone': () => rosettaStone(),
  'greek-amphora': () => greekAmphora(),
  abacus: () => abacus(),
};
