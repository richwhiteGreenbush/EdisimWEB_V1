import * as THREE from 'three';
import { standard, mesh, group, canvasTexture, seededRandom } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { tube, lin, mix, clamp01, sstep, tintVertices, outward, grainBump } from '../ModelKit.js';

// The Model Database's chemistry bench: electron orbitals, the states of matter, a pH rack, a voltaic
// pile and a distillation apparatus. A science teacher points at these and asks somebody to COUNT or
// READ, so whatever can be computed is computed from the real rule and exported in CHEM_LAYOUTS at the
// bottom, where a script can hold it to account without looking. Every count throws if it is wrong.
//
// Everything is in feet, origin at the base centre, front toward +Z, root scale 1. Glass is the one
// transparent mesh, and the back-face trick from Lab2.js carries what a see-through liquid would: a
// surface drawn with only its BACK faces shows only the half of itself on the far side, so whatever is
// inside the liquid can be seen in front of it, from any bearing, and all of it is opaque.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const SANS = '"Helvetica Neue", Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

// ---------------------------------------------------------------------------
// Private solids
// ---------------------------------------------------------------------------

// A surface of revolution about +Y from a BOTTOM-UP `[radius, y, flags]` profile. Flag 'c' doubles the
// row, which gives a crisp crease. `warp(angle, radius, y)` may move a row's radius by bearing, and
// bearing 0 is +Z and bearing 90 degrees is +X.
function lathe(profile, { segments = 32, warp = null } = {}) {
  const rows = [];
  for (const [r, y, flags = ''] of profile) {
    rows.push({ r, y });
    if (flags.includes('c')) rows.push({ r, y });
  }
  const positions = [];
  const uvs = [];
  const indices = [];
  let run = 0;
  rows.forEach((row, i) => {
    if (i) run += Math.hypot(row.r - rows[i - 1].r, row.y - rows[i - 1].y);
    for (let c = 0; c < segments; c++) {
      const a = (c / segments) * Math.PI * 2;
      const r = warp ? warp(a, row.r, row.y) : row.r;
      positions.push(Math.sin(a) * r, row.y, Math.cos(a) * r);
      uvs.push(c / segments, run);
    }
  });
  for (let i = 0; i < rows.length - 1; i++) {
    for (let c = 0; c < segments; c++) {
      const c2 = (c + 1) % segments;
      const p = i * segments + c;
      const t = i * segments + c2;
      const s = (i + 1) * segments + c2;
      const q = (i + 1) * segments + c;
      indices.push(p, t, s, p, s, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// The closed section of a ring, as a lathe profile.
function ringProfile(rc, yc, s, n = 8, squash = 1) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * Math.PI * 2;
    out.push([rc + Math.cos(t) * s, yc + Math.sin(t) * s * squash]);
  }
  return out;
}

// A geometry authored along +Y, carried to `at` with its +Y pointing along `dir`.
function aimed(geometry, at, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  geometry.applyMatrix4(new THREE.Matrix4().compose(V(at[0] ?? at.x, at[1] ?? at.y, at[2] ?? at.z), q, V(1, 1, 1)));
  return geometry;
}

function rod(a, b, radius, { sides = 10, radiusB = null, open = false } = {}) {
  const from = a.isVector3 ? a : V(...a);
  const to = b.isVector3 ? b : V(...b);
  const axis = to.clone().sub(from);
  const g = new THREE.CylinderGeometry(radiusB ?? radius, radius, axis.length(), sides, 1, open);
  g.translate(0, axis.length() / 2, 0);
  return aimed(g, from, axis);
}

function ball(radius, at, { detail = 14, squash = [1, 1, 1] } = {}) {
  const g = new THREE.SphereGeometry(radius, detail, Math.max(6, Math.round(detail * 0.66)));
  g.scale(squash[0], squash[1], squash[2]);
  g.translate(at[0], at[1], at[2]);
  return g;
}

// A squared block with its edges and corners cut, every face flat. UVs are in feet with the grain
// running along `grain`, because the near-white tile below streaks along its V.
function cbox(x0, y0, z0, x1, y1, z1, { c = 0.025, grain = 'x', tile = 2.2 } = {}) {
  const hx = (x1 - x0) / 2; const hy = (y1 - y0) / 2; const hz = (z1 - z0) / 2;
  const cx = (x0 + x1) / 2; const cy = (y0 + y1) / 2; const cz = (z0 + z1) / 2;
  const cc = Math.min(c, hx * 0.8, hy * 0.8, hz * 0.8);
  const pos = [];
  const uvs = [];
  const A = (sx, sy, sz) => [sx * hx, sy * (hy - cc), sz * (hz - cc)];
  const B = (sx, sy, sz) => [sx * (hx - cc), sy * hy, sz * (hz - cc)];
  const C = (sx, sy, sz) => [sx * (hx - cc), sy * (hy - cc), sz * hz];
  const pushUv = (p, n) => {
    const ax = Math.abs(n[0]); const ay = Math.abs(n[1]); const az = Math.abs(n[2]);
    const X = p[0] + cx; const Y = p[1] + cy; const Z = p[2] + cz;
    let along; let across;
    if (grain === 'x') { along = X; across = az > ax && az > ay ? Y : ay > ax ? Z : Y; }
    else if (grain === 'y') { along = Y; across = az > ax ? X : Z; }
    else { along = Z; across = ay > ax ? X : Y; }
    uvs.push(across / tile, along / (tile * 2));
  };
  const tri = (a, b, d) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [ab[1] * ad[2] - ab[2] * ad[1], ab[2] * ad[0] - ab[0] * ad[2], ab[0] * ad[1] - ab[1] * ad[0]];
    const m = [a[0] + b[0] + d[0], a[1] + b[1] + d[1], a[2] + b[2] + d[2]];
    const flip = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0;
    const list = flip ? [a, d, b] : [a, b, d];
    for (const p of list) { pos.push(p[0] + cx, p[1] + cy, p[2] + cz); pushUv(p, n); }
  };
  const quad = (a, b, d, e) => { tri(a, b, d); tri(a, d, e); };
  const S = [-1, 1];
  for (const s of S) {
    quad(A(s, -1, -1), A(s, 1, -1), A(s, 1, 1), A(s, -1, 1));
    quad(B(-1, s, -1), B(1, s, -1), B(1, s, 1), B(-1, s, 1));
    quad(C(-1, -1, s), C(1, -1, s), C(1, 1, s), C(-1, 1, s));
  }
  for (const a of S) {
    for (const b of S) {
      quad(A(a, b, -1), A(a, b, 1), B(a, b, 1), B(a, b, -1));
      quad(A(a, -1, b), A(a, 1, b), C(a, 1, b), C(a, -1, b));
      quad(B(-1, a, b), B(1, a, b), C(1, a, b), C(-1, a, b));
      for (const e of S) tri(A(a, b, e), B(a, b, e), C(a, b, e));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

// A thin disc with cut edges: one disc of a pile, a washer, a foot. Caps and bands own their vertices,
// so a cap is flat and the rim is crisp, in 8 triangles per side rather than a lathe's 18.
function disc(r, y0, y1, { c = 0.012, sides = 40, warp = null, x = 0, z = 0 } = {}) {
  const pos = [];
  const nor = [];
  const idx = [];
  const R = (a) => (warp ? warp(a) : 1) * r;
  const ring = (radius, y, normal) => {
    const start = pos.length / 3;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const s = Math.sin(a); const k = Math.cos(a);
      const rr = radius(a);
      pos.push(s * rr + x, y, k * rr + z);
      nor.push(s * normal[0], normal[1], k * normal[0]);
    }
    return start;
  };
  const band = (a, b) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      idx.push(a + i, a + j, b + j, a + i, b + j, b + i);
    }
  };
  const fan = (start, y, up) => {
    const centre = pos.length / 3;
    pos.push(x, y, z);
    nor.push(0, up ? 1 : -1, 0);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (up) idx.push(centre, start + i, start + j);
      else idx.push(centre, start + j, start + i);
    }
  };
  const k2 = Math.SQRT1_2;
  fan(ring((a) => R(a) - c, y0, [0, -1]), y0, false);
  band(ring((a) => R(a) - c, y0, [k2, -k2]), ring((a) => R(a), y0 + c, [k2, -k2]));
  band(ring((a) => R(a), y0 + c, [1, 0]), ring((a) => R(a), y1 - c, [1, 0]));
  band(ring((a) => R(a), y1 - c, [k2, k2]), ring((a) => R(a) - c, y1, [k2, k2]));
  fan(ring((a) => R(a) - c, y1, [0, 1]), y1, true);
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

// ---------------------------------------------------------------------------
// Printed plates: one atlas per model, every line of type measured to fit
// ---------------------------------------------------------------------------

function fitFont(ctx, text, maxWidth, startPx, build) {
  let px = startPx;
  ctx.font = build(px);
  while (px > 8 && ctx.measureText(text).width > maxWidth) {
    px -= 1;
    ctx.font = build(px);
  }
  return px;
}

// Shelf-packs cells of [w, h] pixels into a canvas, and paints each with its own draw function.
// Returns the texture and, for each key, a rectangle in pixels and in UVs.
function buildAtlas(W, H, cells, { background = '#efe8d6' } = {}) {
  const rects = {};
  let x = 0; let y = 0; let rowH = 0;
  for (const [key, w, h, draw] of cells) {
    if (x + w > W) { x = 0; y += rowH + 2; rowH = 0; }
    if (y + h > H) throw new Error(`atlas overflow at ${key}`);
    rects[key] = { x, y, w, h, u0: x / W, u1: (x + w) / W, v0: 1 - (y + h) / H, v1: 1 - y / H, draw };
    x += w + 2;
    rowH = Math.max(rowH, h);
  }
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);
    for (const key of Object.keys(rects)) {
      const r = rects[key];
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      r.draw(ctx, r.x, r.y, r.w, r.h);
      ctx.restore();
    }
  });
  return { texture, rects };
}

// The usual plate: a ground, a keyline, and lines of centred type.
function plateFace(ctx, x, y, w, h, lines, { ground = '#efe8d6', ink = '#1f1c17', edge = '#8a7a58', font = SANS, weight = '700', px = null } = {}) {
  ctx.fillStyle = ground;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1.5, h * 0.03);
  const inset = Math.max(2, h * 0.05);
  ctx.strokeRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rowH = (h * 0.84) / lines.length;
  lines.forEach((line, i) => {
    fitFont(ctx, line, w * 0.88, px ?? rowH * 0.8, (size) => `${weight} ${size}px ${font}`);
    ctx.fillText(line, x + w / 2, y + h * 0.08 + rowH * (i + 0.5));
  });
}

// A flat plate with its face on +Z: the face carries a rectangle of the atlas, and the edges and back
// sample one pixel of its ground, so they read as the plate's own thickness.
function plateBox(w, h, d, rect) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    if (i >= 16 && i < 20) uv.setXY(i, mix(rect.u0, rect.u1, uv.getX(i)), mix(rect.v0, rect.v1, uv.getY(i)));
    else uv.setXY(i, rect.u0 + 0.0015, rect.v1 - 0.003);
  }
  return g;
}

// Carries a plate to `at`, tipped back by `rake` radians about X and turned by `yaw` about Y.
function placed(g, at, rake = 0, yaw = 0) {
  const m = new THREE.Matrix4().makeTranslation(at[0], at[1], at[2]);
  m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.multiply(new THREE.Matrix4().makeRotationX(-rake));
  return g.applyMatrix4(m);
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

// A near-white tile of long streaks, used as BOTH map and bump. A map multiplies the vertex colour, so
// one canvas serves every wood in a model. A texel of 150 is 30% of the colour in linear, not 59%.
function grainMaps({ seed = 3, strength = 0.35, width = 256, height = 512, streaks = 150 } = {}) {
  const rng = seededRandom(seed);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f3ee';
  ctx.fillRect(0, 0, width, height);
  const wrapX = (draw) => { for (const dx of [-width, 0, width]) draw(dx); };
  for (let i = 0; i < 26; i++) {
    const x = rng() * width;
    const w = 6 + rng() * 34;
    const tone = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgba(${tone},${tone - 8},${tone - 18},0.42)`;
    wrapX((dx) => ctx.fillRect(x + dx, 0, w, height));
  }
  for (let i = 0; i < streaks; i++) {
    const x = rng() * width;
    const amp = 1 + rng() * 5;
    const cycles = 1 + Math.floor(rng() * 3);
    const phase = rng() * Math.PI * 2;
    const dark = 150 + Math.round(rng() * 70);
    ctx.strokeStyle = `rgba(${dark},${dark - 14},${dark - 30},${0.25 + rng() * 0.5})`;
    ctx.lineWidth = 0.6 + rng() * 1.5;
    wrapX((dx) => {
      ctx.beginPath();
      for (let y = 0; y <= height; y += 16) {
        const px = x + dx + Math.sin((y / height) * Math.PI * 2 * cycles + phase) * amp;
        if (y === 0) ctx.moveTo(px, y);
        else ctx.lineTo(px, y);
      }
      ctx.stroke();
    });
  }
  const make = (space) => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = space;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  return { map: make(THREE.SRGBColorSpace), bumpMap: make(THREE.NoColorSpace), bumpScale: strength };
}

const solidMesh = (parts, params = {}) => mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.5, metalness: 0.08, ...params }));
const printedMesh = (parts, atlas, params = {}) => mesh(mergeParts(parts), standard({ map: atlas, roughness: 0.62, metalness: 0, ...params }));

function glassMesh(parts, params = {}) {
  const m = mesh(mergeParts(parts), standard({
    vertexColors: true, transparent: true, opacity: 0.2, roughness: 0.06, metalness: 0, depthWrite: false, ...params,
  }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function unlitMesh(parts, params = {}) {
  const m = mesh(mergeParts(parts), new THREE.MeshBasicMaterial({ vertexColors: true, ...params }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

const woodMesh = (parts, grain) => mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.62, metalness: 0, ...grain }));

// ---------------------------------------------------------------------------
// 1. Electron orbitals
// ---------------------------------------------------------------------------
//
// EVERY SURFACE IS A POLAR PLOT OF |Y|^2, the square of the real spherical harmonic: the distance from
// the nucleus along a direction is proportional to Y(direction)^2. Colour is the sign of Y itself. Two
// things follow, and neither is drawn by eye. The lobes meet at a point at the nucleus, because Y is 0
// on a nodal surface and so the radius is 0 there; and the colour never has to change on a visible
// surface, because the sign only changes where the radius has already reached zero.
//
// The chemist's z is up, so chem (x, y, z) is the model's (X, -Z, Y). That is a proper rotation (its
// determinant is +1), which is what keeps xy's four lobes the right way round: the +x+y lobe is the
// positive one, seen from above, with the chemist's y running away from the student.

const SQ = Math.sqrt;
const PI = Math.PI;
const N_S = 1 / (2 * SQ(PI));
const N_P = SQ(3 / (4 * PI));
const N_D = SQ(15 / (4 * PI));
const N_DZ = SQ(5 / (16 * PI));
const N_DX = SQ(15 / (16 * PI));

// Each Y takes a UNIT direction in the chemist's axes.
const ORBITAL_DEFS = [
  { key: 's', family: 's', Y: () => N_S, lobes: [] },
  { key: 'px', family: 'p', Y: (x) => N_P * x, lobes: [[1, 0, 0], [-1, 0, 0]], upright: false },
  { key: 'py', family: 'p', Y: (x, y) => N_P * y, lobes: [[0, 1, 0], [0, -1, 0]], upright: false },
  { key: 'pz', family: 'p', Y: (x, y, z) => N_P * z, lobes: [[0, 0, 1], [0, 0, -1]], upright: true },
  { key: 'dxy', family: 'd', Y: (x, y) => N_D * x * y, lobes: [[1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0]], pole: [0, 0, 1], upright: false },
  { key: 'dxz', family: 'd', Y: (x, y, z) => N_D * x * z, lobes: [[1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1]], pole: [0, 1, 0], upright: false },
  { key: 'dyz', family: 'd', Y: (x, y, z) => N_D * y * z, lobes: [[0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]], pole: [1, 0, 0], upright: false },
  { key: 'dx2y2', family: 'd', Y: (x, y) => N_DX * (x * x - y * y), lobes: [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]], pole: [0, 0, 1], upright: false },
  { key: 'dz2', family: 'd', Y: (x, y, z) => N_DZ * (3 * z * z - 1), lobes: [[0, 0, 1], [0, 0, -1]], ring: true, upright: true },
];

// One scale per family, set so that a family's clover-shaped lobes reach this many feet. Within a family
// the plot is honest, so dz2's axial lobes really do come out a third longer than the other four shapes'
// lobes (5/4pi against 15/16pi) and its ring really is a quarter of its own lobe. Between families it is
// not, and a printed plate says so: an angular function carries no size at all.
const FAMILY_REACH = { s: 0.78, p: 1.12, d: 1.26 };
const FAMILY_PEAK = { s: N_S * N_S, p: N_P * N_P, d: (N_D * 0.5) ** 2 };
// The rows are a choir: nothing in a front row stands in front of anything in the row behind it, so the
// count in each row can be read from straight ahead. The p and s columns sit in the gaps of the d row.
const ROW = {
  s: { z: 1.33, top: 0.5, centre: 2.02, xs: [4.65] },
  p: { z: 0, top: 1.0, centre: 3.3, xs: [-4.65, -1.55, 1.55] },
  d: { z: -1.33, top: 1.5, centre: 5.05, xs: [-6.2, -3.1, 0, 3.1, 6.2] },
};

const chemToModel = (x, y, z) => [x, z, -y];
const modelToChem = (x, y, z) => [x, -z, y];

function orbitalLayout() {
  const shapes = [];
  for (const family of ['s', 'p', 'd']) {
    const row = ROW[family];
    const defs = ORBITAL_DEFS.filter((d) => d.family === family);
    if (defs.length !== row.xs.length) throw new Error(`orbitals: ${family} row has ${defs.length} shapes`);
    defs.forEach((def, i) => {
      const scale = FAMILY_REACH[family] / FAMILY_PEAK[family];
      // Longest reach of this one shape, from the same function the surface is drawn with.
      const peak = def.lobes.length
        ? Math.max(...def.lobes.map((l) => { const n = Math.hypot(...l); return def.Y(l[0] / n, l[1] / n, l[2] / n) ** 2; }))
        : def.Y(0, 0, 1) ** 2;
      shapes.push({ ...def, centre: [row.xs[i], row.centre, row.z], scale, top: row.top, reach: scale * peak });
    });
  }
  if (shapes.length !== 9) throw new Error(`orbitals: ${shapes.length} shapes, not 9`);
  return shapes;
}

// One lobe: a polar grid centred on the lobe's own axis, in model axes, centred on the origin.
// For each bearing round the axis, march out until Y changes sign; that is where this lobe ends and the
// radius has reached zero. Rows are then spaced evenly along the SURFACE rather than along the angle,
// which puts the triangles on the visible lobe rather than on its neck.
function orbitalLobe(def, scale, axisChem, nBearing = 30, nRows = 22) {
  const axisLen = Math.hypot(...axisChem);
  const axis = V(...chemToModel(axisChem[0] / axisLen, axisChem[1] / axisLen, axisChem[2] / axisLen));
  const ref = Math.abs(axis.y) > 0.9 ? V(1, 0, 0) : UP;
  const e1 = new THREE.Vector3().crossVectors(ref, axis).normalize();
  const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
  const evalY = (d) => { const c = modelToChem(d.x, d.y, d.z); return def.Y(c[0], c[1], c[2]); };
  const signAxis = Math.sign(evalY(axis));
  const dirAt = (alpha, beta) => axis.clone().multiplyScalar(Math.cos(alpha))
    .addScaledVector(e1, Math.sin(alpha) * Math.cos(beta))
    .addScaledVector(e2, Math.sin(alpha) * Math.sin(beta));
  const positions = [];
  const SAMPLES = 160;
  for (let j = 0; j < nBearing; j++) {
    const beta = (j / nBearing) * Math.PI * 2;
    let lo = 0;
    let hi = Math.PI;
    for (let a = Math.PI / 240; a <= Math.PI; a += Math.PI / 240) {
      if (Math.sign(evalY(dirAt(a, beta))) !== signAxis) { hi = a; break; }
      lo = a;
    }
    for (let it = 0; it < 28; it++) {
      const m = (lo + hi) / 2;
      if (Math.sign(evalY(dirAt(m, beta))) === signAxis) lo = m; else hi = m;
    }
    const aMax = lo;
    // The meridian's own arc length, resampled.
    const pts = [];
    let run = 0;
    const runs = [0];
    for (let k = 0; k <= SAMPLES; k++) {
      const d = dirAt((k / SAMPLES) * aMax, beta);
      const r = scale * evalY(d) ** 2;
      const p = [d.x * r, d.y * r, d.z * r];
      if (k) {
        const q = pts[k - 1];
        run += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        runs.push(run);
      }
      pts.push(p);
    }
    let cursor = 0;
    for (let i = 0; i <= nRows; i++) {
      const target = (i / nRows) * run;
      while (cursor < SAMPLES - 1 && runs[cursor + 1] < target) cursor += 1;
      const span = runs[cursor + 1] - runs[cursor] || 1;
      const t = clamp01((target - runs[cursor]) / span);
      const a = (cursor + t) / SAMPLES * aMax;
      const d = dirAt(a, beta);
      const r = i === nRows ? 0 : scale * evalY(d) ** 2;
      positions.push(d.x * r, d.y * r, d.z * r);
    }
  }
  const idx = [];
  const row = nRows + 1;
  for (let j = 0; j < nBearing; j++) {
    const j2 = (j + 1) % nBearing;
    for (let i = 0; i < nRows; i++) {
      idx.push(j * row + i, j2 * row + i, j2 * row + i + 1, j * row + i, j2 * row + i + 1, j * row + i + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  const out = outward(g);
  // The tip row is one point many times over, so its normal is simply the axis.
  const nrm = out.attributes.normal;
  for (let j = 0; j < nBearing; j++) nrm.setXYZ(j * row, axis.x, axis.y, axis.z);
  return { geometry: out, sign: signAxis };
}

// One lobe of a four-lobed d orbital. Its directions fill a lune between two nodal planes, whose two
// corners are the poles the shape has no reach along, so the natural grid is latitude from that pole
// and longitude across the lune, with every edge of the grid at the nucleus. A polar grid about the
// lobe's own axis hits those corners at a kink and folds into creases. `pole` is the chemist's axis the
// shape is nodal along (z for xy and x2-y2, y for xz, x for yz); `axis` is the lobe's peak direction.
function cloverLobe(def, scale, axisChem, pole, nAcross = 30, nAlong = 38) {
  const n = Math.hypot(...axisChem);
  const A = V(...chemToModel(axisChem[0] / n, axisChem[1] / n, axisChem[2] / n));
  const P = V(...chemToModel(pole[0], pole[1], pole[2]));
  const B = new THREE.Vector3().crossVectors(P, A).normalize();
  const dirAt = (theta, psi) => P.clone().multiplyScalar(Math.cos(theta))
    .addScaledVector(A, Math.sin(theta) * Math.cos(psi))
    .addScaledVector(B, Math.sin(theta) * Math.sin(psi));
  const rOf = (d) => { const c = modelToChem(d.x, d.y, d.z); return scale * def.Y(c[0], c[1], c[2]) ** 2; };
  const sign = Math.sign((() => { const c = modelToChem(A.x, A.y, A.z); return def.Y(c[0], c[1], c[2]); })());
  const HALF = Math.PI / 4;
  // Rows spaced evenly along the surface: each axis of the grid resampled by arc length through the
  // lobe's own centre line, which keeps the triangles on the lobe rather than crowding its neck.
  const spaced = (fn, lo, hi, count) => {
    const SAMPLES = 200;
    const runs = [0];
    let prev = fn(lo);
    for (let k = 1; k <= SAMPLES; k++) {
      const p = fn(mix(lo, hi, k / SAMPLES));
      runs.push(runs[k - 1] + Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z));
      prev = p;
    }
    const total = runs[SAMPLES];
    const out = [];
    let cursor = 0;
    for (let i = 0; i <= count; i++) {
      const target = (i / count) * total;
      while (cursor < SAMPLES - 1 && runs[cursor + 1] < target) cursor += 1;
      const t = clamp01((target - runs[cursor]) / (runs[cursor + 1] - runs[cursor] || 1));
      out.push(mix(lo, hi, (cursor + t) / SAMPLES));
    }
    return out;
  };
  const at = (theta, psi) => { const d = dirAt(theta, psi); return d.multiplyScalar(rOf(d)); };
  const psis = spaced((psi) => at(Math.PI / 2, psi), -HALF, HALF, nAcross);
  const thetas = spaced((theta) => at(theta, 0), 0, Math.PI, nAlong);
  const positions = [];
  for (let j = 0; j <= nAlong; j++) {
    for (let i = 0; i <= nAcross; i++) {
      const edge = j === 0 || j === nAlong || i === 0 || i === nAcross;
      const p = edge ? V(0, 0, 0) : at(thetas[j], psis[i]);
      positions.push(p.x, p.y, p.z);
    }
  }
  const idx = [];
  const row = nAcross + 1;
  for (let j = 0; j < nAlong; j++) {
    for (let i = 0; i < nAcross; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  g.computeVertexNormals();
  return { geometry: outward(g), sign };
}

// dz2's doughnut: the belt of directions between the two nodal cones, as a closed solid of revolution.
// It starts and ends at the nucleus, because that is where the node puts its radius.
function dz2Ring(def, scale, segments = 48, nRows = 30) {
  const nodal = Math.acos(1 / Math.sqrt(3));
  const SAMPLES = 200;
  const pts = [];
  const runs = [0];
  let run = 0;
  for (let k = 0; k <= SAMPLES; k++) {
    // From the lower cone up to the upper cone, so the profile runs bottom-up.
    const theta = mix(Math.PI - nodal, nodal, k / SAMPLES);
    const r = scale * def.Y(0, Math.sin(theta), Math.cos(theta)) ** 2;
    const p = [r * Math.sin(theta), r * Math.cos(theta)];
    if (k) { run += Math.hypot(p[0] - pts[k - 1][0], p[1] - pts[k - 1][1]); runs.push(run); }
    pts.push(p);
  }
  const profile = [[0, 0]];
  let cursor = 0;
  for (let i = 1; i < nRows; i++) {
    const target = (i / nRows) * run;
    while (cursor < SAMPLES - 1 && runs[cursor + 1] < target) cursor += 1;
    const t = clamp01((target - runs[cursor]) / (runs[cursor + 1] - runs[cursor] || 1));
    profile.push([mix(pts[cursor][0], pts[cursor + 1][0], t), mix(pts[cursor][1], pts[cursor + 1][1], t)]);
  }
  profile.push([0, 0]);
  return outward(lathe(profile, { segments }));
}

// The s orbital: a true sphere with one octant taken out, facing up and toward the student, so that the
// nucleus at its centre can be seen. It is built as seven octant patches and three quarter discs.
function sphereWithOctantOut(r, n = 12) {
  const pos = [];
  const nor = [];
  const col = [];
  const OUT = lin(0xff7a18);
  const CUT = lin(0xc2500c);
  const tri = (a, b, c, na, nb, nc, tone) => {
    pos.push(...a, ...b, ...c);
    nor.push(...na, ...nb, ...nc);
    for (let i = 0; i < 3; i++) col.push(...tone);
  };
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        if (sx > 0 && sy > 0 && sz > 0) continue; // the octant left out
        // A subdivided octahedron face, pushed to the sphere.
        const at = (i, j) => {
          const a = (n - i - j) / n; const b = i / n; const c = j / n;
          const v = V(sx * a, sy * b, sz * c).normalize();
          return [v.x, v.y, v.z];
        };
        const flip = sx * sy * sz < 0;
        const emit = (A, B, C) => {
          const [p, q, s] = flip ? [A, C, B] : [A, B, C];
          tri(p.map((v) => v * r), q.map((v) => v * r), s.map((v) => v * r), p, q, s, OUT);
        };
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n - i; j++) {
            emit(at(i, j), at(i + 1, j), at(i, j + 1));
            if (i + j < n - 1) emit(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
          }
        }
      }
    }
  }
  // The three cut faces. Each faces INTO the removed octant.
  const faces = [
    { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
    { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  ];
  for (const f of faces) {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * (Math.PI / 2); const a1 = ((i + 1) / n) * (Math.PI / 2);
      const P = (a) => [0, 1, 2].map((k) => (f.u[k] * Math.cos(a) + f.v[k] * Math.sin(a)) * r);
      tri([0, 0, 0], P(a0), P(a1), f.n, f.n, f.n, CUT);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

// Draws a name with a proper subscript: 'p', 'x' gives p with a small x under its right.
function orbitalName(ctx, x, y, w, h, spans) {
  ctx.fillStyle = '#efe8d6';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#8a7a58';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  const big = h * 0.62;
  const measure = (k) => {
    let total = 0;
    for (const s of spans) {
      ctx.font = `italic 700 ${big * s.size * k}px ${SERIF}`;
      total += ctx.measureText(s.text).width + (s.gap ?? 0) * big * k;
    }
    return total;
  };
  let k = 1;
  const total0 = measure(1);
  if (total0 > w * 0.86) k = (w * 0.86) / total0;
  let cursor = x + (w - measure(k)) / 2;
  ctx.fillStyle = '#1f1c17';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const base = y + h * 0.66;
  for (const s of spans) {
    ctx.font = `italic 700 ${big * s.size * k}px ${SERIF}`;
    ctx.fillText(s.text, cursor, base + s.drop * big * k);
    cursor += ctx.measureText(s.text).width + (s.gap ?? 0) * big * k;
  }
}

const ORBITAL_NAMES = {
  s: [{ text: 's', size: 1, drop: 0 }],
  px: [{ text: 'p', size: 1, drop: 0 }, { text: 'x', size: 0.66, drop: 0.3 }],
  py: [{ text: 'p', size: 1, drop: 0 }, { text: 'y', size: 0.66, drop: 0.3 }],
  pz: [{ text: 'p', size: 1, drop: 0 }, { text: 'z', size: 0.66, drop: 0.3 }],
  dxy: [{ text: 'd', size: 1, drop: 0 }, { text: 'xy', size: 0.66, drop: 0.3 }],
  dxz: [{ text: 'd', size: 1, drop: 0 }, { text: 'xz', size: 0.66, drop: 0.3 }],
  dyz: [{ text: 'd', size: 1, drop: 0 }, { text: 'yz', size: 0.66, drop: 0.3 }],
  dx2y2: [{ text: 'd', size: 1, drop: 0 }, { text: 'x', size: 0.66, drop: 0.3 }, { text: '2', size: 0.42, drop: 0.02 }, { text: '−y', size: 0.66, drop: 0.3 }, { text: '2', size: 0.42, drop: 0.02 }],
  dz2: [{ text: 'd', size: 1, drop: 0 }, { text: 'z', size: 0.66, drop: 0.3 }, { text: '2', size: 0.42, drop: 0.02 }],
};

const SIGN_PLUS = 0xff7a18;
const SIGN_MINUS = 0x1766e0;

function electronOrbitals() {
  const shapes = orbitalLayout();
  const COUNTS = { s: [1, 2], p: [3, 6], d: [5, 10] };
  for (const family of Object.keys(COUNTS)) {
    const n = shapes.filter((s) => s.family === family).length;
    if (n !== COUNTS[family][0] || n * 2 !== COUNTS[family][1]) throw new Error(`orbitals: ${family} has ${n}`);
  }

  const { texture: atlas, rects } = buildAtlas(1024, 512, [
    ...shapes.map((s) => [s.key, 150, 72, (ctx, x, y, w, h) => orbitalName(ctx, x, y, w, h, ORBITAL_NAMES[s.key])]),
    ...['s', 'p', 'd'].map((fam) => [`group-${fam}`, 500, 66, (ctx, x, y, w, h) => {
      const [n, e] = COUNTS[fam];
      ctx.fillStyle = '#efe8d6';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#8a7a58';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = '#1f1c17';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = `italic 700 ${h * 0.68}px ${SERIF}`;
      ctx.fillText(`${fam}:`, x + 14, y + h * 0.48);
      const text = `${n} ${n === 1 ? 'shape' : 'shapes'}, ${e} electrons`;
      fitFont(ctx, text, w - 90, h * 0.54, (px) => `700 ${px}px ${SANS}`);
      ctx.fillText(text, x + 72, y + h * 0.52);
    }]),
    ['title', 500, 100, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['ELECTRON ORBITALS', 'each shape holds at most 2 electrons'])],
    ['key', 500, 100, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#efe8d6';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#8a7a58';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      const swatch = (sx, hex, sign) => {
        ctx.fillStyle = hex;
        ctx.beginPath();
        ctx.arc(sx, y + h * 0.3, h * 0.17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 ${h * 0.3}px ${SANS}`;
        ctx.fillText(sign, sx, y + h * 0.3);
      };
      swatch(x + 30, '#f06a0e', '+');
      swatch(x + 72, '#1560d6', '−');
      ctx.fillStyle = '#1f1c17';
      ctx.textAlign = 'left';
      fitFont(ctx, 'colour = sign of the wave function', w - 110, h * 0.3, (px) => `700 ${px}px ${SANS}`);
      ctx.fillText('colour = sign of the wave function', x + 100, y + h * 0.3);
      ctx.textAlign = 'center';
      const fine = 'shape only: sizes between rows are not to scale';
      fitFont(ctx, fine, w * 0.9, h * 0.24, (px) => `600 ${px}px ${SANS}`);
      ctx.fillText(fine, x + w / 2, y + h * 0.74);
    }],
    ...['x', 'y', 'z'].map((a) => [`axis-${a}`, 56, 56, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#efe8d6';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#1f1c17';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 700 ${h * 0.78}px ${SERIF}`;
      ctx.fillText(a, x + w / 2, y + h * 0.42);
    }]),
  ]);

  const solid = [];
  const lobes = [];
  const printed = [];
  const SHELF = 0x2c3440;
  const SHELF_EDGE = 0x47525f;
  const POST = 0x8d939b;

  // The stepped shelf: three blocks, one for each row, stood one behind the next.
  const STEP = [[0.67, 2.0, 0.5], [-0.67, 0.67, 1.0], [-2.0, -0.67, 1.5]];
  for (const [z0, z1, top] of STEP) {
    solid.push({ geometry: cbox(-8, 0, z0, 8, top, z1, { c: 0.035 }), color: SHELF });
    // A paler line along the lip of each step, which is what makes the rows read as rows.
    solid.push({ geometry: cbox(-7.97, top - 0.045, z1 - 0.012, 7.97, top - 0.012, z1 + 0.008, { c: 0.006 }), color: SHELF_EDGE });
  }

  for (const s of shapes) {
    const [cx, cy, cz] = s.centre;
    const foot = 0.2;
    solid.push({ geometry: lathe([[0, 0], [foot, 0, 'c'], [foot, 0.035, 'c'], [foot * 0.55, 0.07], [0.05, 0.11], [0, 0.12]], { segments: 22 }).translate(cx, s.top, cz), color: 0x59626d });
    let postTop;
    if (s.key === 's') postTop = cy - s.reach * 0.9;
    else if (s.upright) postTop = cy - s.reach + 0.05;
    else postTop = cy - 0.04;
    solid.push({ geometry: rod([cx, s.top + 0.08, cz], [cx, postTop, cz], 0.034, { sides: 10 }), color: POST });
    // A small cup where a post meets the tip of an upright lobe, so a point does not balance on a rod.
    if (s.upright) {
      solid.push({ geometry: lathe([[0, -0.05], [0.038, -0.05], [0.075, 0.02], [0.078, 0.05], [0.05, 0.058], [0, 0.05]], { segments: 14 }).translate(cx, postTop - 0.05, cz), color: POST });
    }
    // The nucleus. Not to scale, and neither is anything a person can see.
    solid.push({ geometry: ball(s.key === 's' ? 0.07 : 0.055, [cx, cy, cz], { detail: 16 }), color: 0xfbfbf6 });

    if (s.key === 's') {
      const g = sphereWithOctantOut(s.reach, 12);
      g.translate(cx, cy, cz);
      lobes.push({ geometry: g, keepColor: true });
    } else {
      for (const axis of s.lobes) {
        const { geometry, sign } = s.pole ? cloverLobe(s, s.scale, axis, s.pole) : orbitalLobe(s, s.scale, axis);
        geometry.translate(cx, cy, cz);
        lobes.push({ geometry, color: sign > 0 ? SIGN_PLUS : SIGN_MINUS });
      }
      if (s.ring) {
        const g = dz2Ring(s, s.scale);
        g.translate(cx, cy, cz);
        lobes.push({ geometry: g, color: s.Y(1, 0, 0) > 0 ? SIGN_PLUS : SIGN_MINUS });
      }
    }

    // The name plate, raked back on the step in front of the post.
    const rect = rects[s.key];
    const pw = 0.8; const ph = 0.385;
    const rake = 0.55;
    printed.push({ geometry: placed(plateBox(pw, ph, 0.03, rect), [cx, s.top + ph * 0.5 * Math.cos(rake) + 0.008, cz + 0.45], rake), color: 0xffffff });
  }

  // The group plates: a column on the three risers, clear of every post in front of them.
  const groupW = 2.9; const groupH = 0.41;
  printed.push({ geometry: plateBox(groupW, groupH, 0.03, rects['group-s']).translate(4.65, 0.25, 2.012), color: 0xffffff });
  printed.push({ geometry: plateBox(groupW, groupH, 0.03, rects['group-p']).translate(-3.1, 0.75, 0.682), color: 0xffffff });
  printed.push({ geometry: plateBox(groupW, groupH, 0.03, rects['group-d']).translate(-3.1, 1.25, -0.658), color: 0xffffff });

  // Title and key on the front riser, with the axes standing on the step above the key.
  printed.push({ geometry: plateBox(2.8, 0.42, 0.03, rects.title).translate(-5.7, 0.25, 2.012), color: 0xffffff });
  printed.push({ geometry: plateBox(3.4, 0.42, 0.03, rects.key).translate(-1.7, 0.25, 2.012), color: 0xffffff });

  // The axes the three p orbitals are named after: z up, x to the right, y away from the student.
  const O = [0.9, 1.32, 1.4];
  const AX = 0xd5d8dc;
  solid.push({ geometry: lathe([[0, 0], [0.2, 0, 'c'], [0.2, 0.035, 'c'], [0.11, 0.07], [0.05, 0.11], [0, 0.12]], { segments: 22 }).translate(O[0], 0.5, O[2]), color: 0x59626d });
  solid.push({ geometry: rod([O[0], 0.58, O[2]], O, 0.032), color: POST });
  solid.push({ geometry: ball(0.07, O, { detail: 16 }), color: 0xfbfbf6 });
  const arrow = (dir, len, key) => {
    const D = V(...dir);
    const tip = V(...O).addScaledVector(D, len);
    solid.push({ geometry: rod(O, tip, 0.024), color: AX });
    const cone = lathe([[0, 0], [0.07, 0, 'c'], [0, 0.2]], { segments: 14 });
    solid.push({ geometry: aimed(cone, tip, D), color: AX });
    const lift = tip.clone().addScaledVector(D, 0.32);
    printed.push({ geometry: plateBox(0.2, 0.2, 0.02, rects[`axis-${key}`]).translate(lift.x, lift.y, lift.z), color: 0xffffff });
  };
  arrow([1, 0, 0], 0.9, 'x');
  arrow([0, 0, -1], 0.42, 'y');
  arrow([0, 1, 0], 0.9, 'z');

  return group(
    solidMesh(solid, { roughness: 0.55, metalness: 0.1 }),
    mesh(mergeParts(lobes), standard({ vertexColors: true, roughness: 0.2, metalness: 0.02 })),
    printedMesh(printed, atlas),
  );
}

// ---------------------------------------------------------------------------
// 2. States of matter
// ---------------------------------------------------------------------------
//
// THREE TANKS, THE SAME 60 PARTICLES OF THE SAME SIZE, and the three arrangements are each computed.
// The solid is a lattice 5 x 3 x 4. The liquid is a real jammed packing: particles pushed apart from
// random starting points inside a box whose lid is the liquid's level, so the top of the pile is flat
// because it is pressed flat, nothing overlaps because the push does not stop until nothing does, and
// the box is sized so that it only just fits. The gas is seeded rejection through the whole tank.
//
// The liquid's particles sit closer than the solid's. That is the price of showing bonds, and a real
// solid is usually packed at least as tightly as its liquid: the report and the card's own answer
// treat spacing as a picture of arrangement rather than a measured density.

const SM = {
  N: 60,
  r: 0.22,
  lattice: [5, 3, 4], // x, z, y
  spacing: 0.54,
  W: 3.1, // inner width, depth, height
  D: 1.8,
  H: 4.6,
  level: 1.02, // the liquid's level above the floor: the lowest lid this packing settles under
  gasGap: 1.5, // no two gas particles closer than this many diameters
};

function solidLattice() {
  const [nx, nz, ny] = SM.lattice;
  const out = [];
  for (let j = 0; j < ny; j++) {
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        out.push([(i - (nx - 1) / 2) * SM.spacing, SM.r + j * SM.spacing, (k - (nz - 1) / 2) * SM.spacing]);
      }
    }
  }
  return out;
}

function minSeparation(points) {
  let best = 1e9;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1], points[i][2] - points[j][2]);
      if (d < best) best = d;
    }
  }
  return best;
}

// Pushes overlapping particles apart in a box until none overlap. Particles are grown from a smaller
// radius so they arrive at a jammed arrangement rather than a frozen random one.
function packLiquid(level = SM.level, seed = 8) {
  const rng = seededRandom(seed);
  const { N, r, W, D } = SM;
  const gap = 2 * r * 1.0015;
  const hx = W / 2 - r; const hz = D / 2 - r; const y0 = r; const y1 = level - r;
  const P = [];
  for (let i = 0; i < N; i++) P.push([(rng() * 2 - 1) * hx, y0 + rng() * (y1 - y0), (rng() * 2 - 1) * hz]);
  const clampBox = (p) => {
    p[0] = Math.max(-hx, Math.min(hx, p[0]));
    p[1] = Math.max(y0, Math.min(y1, p[1]));
    p[2] = Math.max(-hz, Math.min(hz, p[2]));
  };
  const GROW = 500;
  const ITER = 5000;
  let settled = false;
  for (let it = 0; it < ITER; it++) {
    const want = gap * Math.min(1, 0.7 + (0.3 * it) / GROW);
    let worst = 0;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = P[j][0] - P[i][0]; const dy = P[j][1] - P[i][1]; const dz = P[j][2] - P[i][2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= (want - 1e-5) ** 2) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const push = ((want - d) / d) * 0.5;
        if (want - d > worst) worst = want - d;
        P[i][0] -= dx * push; P[i][1] -= dy * push; P[i][2] -= dz * push;
        P[j][0] += dx * push; P[j][1] += dy * push; P[j][2] += dz * push;
      }
    }
    for (const p of P) clampBox(p);
    if (it >= GROW && worst === 0) { settled = true; break; }
  }
  // Then it settles. Particles fall a little at a time and push each other aside, so that every one ends
  // up resting on others rather than rattling in a gap, and a last pass with no gravity clears whatever
  // overlap the fall left, to a hair above touching.
  const resolve = () => {
    let worst = 0;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = P[j][0] - P[i][0]; const dy = P[j][1] - P[i][1]; const dz = P[j][2] - P[i][2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= (gap - 1e-5) ** 2) continue;
        const d = Math.sqrt(d2) || 1e-6;
        const push = ((gap - d) / d) * 0.5;
        if (gap - d > worst) worst = gap - d;
        P[i][0] -= dx * push; P[i][1] -= dy * push; P[i][2] -= dz * push;
        P[j][0] += dx * push; P[j][1] += dy * push; P[j][2] += dz * push;
      }
    }
    for (const p of P) clampBox(p);
    return worst;
  };
  if (settled) {
    for (let it = 0; it < 500; it++) {
      for (const p of P) p[1] -= 0.002;
      for (const p of P) clampBox(p);
      for (let k = 0; k < 3; k++) resolve();
    }
    settled = false;
    for (let it = 0; it < 4000 && !settled; it++) settled = resolve() === 0;
  }
  return { points: P, settled };
}

// The gas: seeded rejection through the whole tank, each particle with a direction of travel and a short
// trail behind it. A trail must stay in the tank and must not pass through a neighbour, or it would read
// as a bond, so a direction is only kept once both are true.
function fillGas(seed = 9011) {
  const rng = seededRandom(seed);
  const { N, r, W, D, H } = SM;
  const margin = r + 0.03;
  const hx = W / 2 - margin; const hz = D / 2 - margin; const y0 = margin; const y1 = H - margin;
  const minD = 2 * r * SM.gasGap;
  const points = [];
  let tries = 0;
  while (points.length < N) {
    tries += 1;
    if (tries > 400000) throw new Error(`gas: only ${points.length} particles fit at ${SM.gasGap} diameters`);
    const p = [(rng() * 2 - 1) * hx, y0 + rng() * (y1 - y0), (rng() * 2 - 1) * hz];
    let ok = true;
    for (const q of points) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < minD) { ok = false; break; }
    }
    if (ok) points.push(p);
  }
  const TRAIL = 0.34;
  const trails = points.map((p, i) => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const z = rng() * 2 - 1;
      const a = rng() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const dir = [s * Math.cos(a), z, s * Math.sin(a)];
      const end = [p[0] - dir[0] * (r + TRAIL), p[1] - dir[1] * (r + TRAIL), p[2] - dir[2] * (r + TRAIL)];
      if (Math.abs(end[0]) > W / 2 - 0.05 || Math.abs(end[2]) > D / 2 - 0.05 || end[1] < 0.05 || end[1] > H - 0.05) continue;
      let clear = true;
      for (let j = 0; j < points.length && clear; j++) {
        if (j === i) continue;
        for (let t = 0; t <= 1; t += 0.2) {
          const m = [mix(p[0], end[0], t), mix(p[1], end[1], t), mix(p[2], end[2], t)];
          if (Math.hypot(m[0] - points[j][0], m[1] - points[j][1], m[2] - points[j][2]) < r + 0.05) { clear = false; break; }
        }
      }
      if (clear) return { dir, end };
    }
    throw new Error('gas: no clear direction for a trail');
  });
  return { points, trails };
}

function statesLayout() {
  const solid = solidLattice();
  const { points: liquid, settled } = packLiquid();
  const gas = fillGas();
  const { N, r } = SM;
  for (const [name, list] of [['solid', solid], ['liquid', liquid], ['gas', gas.points]]) {
    if (list.length !== N) throw new Error(`states: ${name} has ${list.length}, not ${N}`);
  }
  if (!settled) throw new Error('states: the liquid did not settle');
  if (minSeparation(liquid) < 2 * r) throw new Error('states: liquid particles overlap');
  if (minSeparation(gas.points) < 2 * r * SM.gasGap) throw new Error('states: gas particles touch');
  // The flat top: the liquid's level is the top of its highest particle.
  const level = Math.max(...liquid.map((p) => p[1])) + r;
  return { ...SM, solid, liquid, gas: gas.points, trails: gas.trails, level };
}

function statesOfMatter() {
  const L = statesLayout();
  const { W, D, H, r } = L;
  const BENCH_TOP = 1.55;
  const PITCH = 4.75;
  const XS = [-PITCH, 0, PITCH];
  const NAMES = ['SOLID', 'LIQUID', 'GAS'];
  const WALL = 0.045;
  const FRAME = 0.075;

  const { texture: atlas, rects } = buildAtlas(1024, 256, NAMES.map((n) => [n, 340, 110, (ctx, x, y, w, h) => {
    plateFace(ctx, x, y, w, h, [n], { ground: '#1f4f8f', ink: '#ffffff', edge: '#9dc1ee' });
  }]));

  const wood = [];
  const solid = [];
  const balls = [];
  const glass = [];
  const printed = [];
  const OAK = 0xb07a45;
  const OAK_DARK = 0x7c512b;

  // The bench.
  wood.push({ geometry: cbox(-7.1, BENCH_TOP - 0.2, -1.55, 7.1, BENCH_TOP, 1.55, { c: 0.035 }), color: OAK });
  wood.push({ geometry: cbox(-6.75, BENCH_TOP - 0.48, -1.28, 6.75, BENCH_TOP - 0.19, 1.28, { c: 0.02 }), color: OAK_DARK });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wood.push({ geometry: cbox(sx * 6.6 - 0.14, 0, sz * 1.15 - 0.14, sx * 6.6 + 0.14, BENCH_TOP - 0.3, sz * 1.15 + 0.14, { c: 0.025, grain: 'y' }), color: OAK_DARK });
    }
    wood.push({ geometry: cbox(sx * 6.6 - 0.08, 0.32, -1.1, sx * 6.6 + 0.08, 0.48, 1.1, { c: 0.015, grain: 'z' }), color: OAK_DARK });
  }
  wood.push({ geometry: cbox(-6.6, 0.32, -0.08, 6.6, 0.48, 0.08, { c: 0.015 }), color: OAK_DARK });

  const unitBall = () => new THREE.SphereGeometry(r, 14, 10);
  const BLUE = 0x1f6fe0;

  XS.forEach((x0, t) => {
    const floorY = BENCH_TOP + FRAME;
    const inner = { x0: x0 - W / 2, x1: x0 + W / 2, z0: -D / 2, z1: D / 2, y0: floorY, y1: floorY + H };

    // The glass: five walls and a lid, each a real slab, since a gas needs a lid to be a gas.
    const pane = (a, b, c, d, e, f) => glass.push({ geometry: new THREE.BoxGeometry(d - a, e - b, f - c).translate((a + d) / 2, (b + e) / 2, (c + f) / 2), color: 0xd8f2f4 });
    pane(inner.x0 - WALL, inner.y0, inner.z1, inner.x1 + WALL, inner.y1, inner.z1 + WALL); // front
    pane(inner.x0 - WALL, inner.y0, inner.z0 - WALL, inner.x1 + WALL, inner.y1, inner.z0); // back
    pane(inner.x0 - WALL, inner.y0, inner.z0, inner.x0, inner.y1, inner.z1); // left
    pane(inner.x1, inner.y0, inner.z0, inner.x1 + WALL, inner.y1, inner.z1); // right
    pane(inner.x0, inner.y1, inner.z0, inner.x1, inner.y1 + WALL, inner.z1); // lid

    // The frame: dark rims top and bottom, sea-green glass edges up the corners.
    const RIM = 0x24404f;
    const X0 = inner.x0 - WALL; const X1 = inner.x1 + WALL; const Z0 = inner.z0 - WALL; const Z1 = inner.z1 + WALL;
    solid.push({ geometry: cbox(X0 - 0.04, BENCH_TOP, Z0 - 0.04, X1 + 0.04, floorY, Z1 + 0.04, { c: 0.015 }), color: RIM });
    const rimTop = inner.y1 + WALL;
    for (const [a, b, c, d] of [[X0 - 0.03, Z1 - 0.02, X1 + 0.03, Z1 + 0.03], [X0 - 0.03, Z0 - 0.03, X1 + 0.03, Z0 + 0.02], [X0 - 0.03, Z0, X0 + 0.02, Z1], [X1 - 0.02, Z0, X1 + 0.03, Z1]]) {
      solid.push({ geometry: cbox(a, rimTop - 0.075, b, c, rimTop + 0.015, d, { c: 0.01 }), color: RIM });
    }
    for (const sx of [X0, X1]) {
      for (const sz of [Z0, Z1]) {
        solid.push({ geometry: cbox(sx - 0.018, floorY - 0.01, sz - 0.018, sx + 0.018, rimTop - 0.06, sz + 0.018, { c: 0.006 }), color: 0x7fc4b4 });
      }
    }

    // The label hangs on the bench's front edge, where it cannot hide a single particle.
    printed.push({ geometry: plateBox(1.7, 0.5, 0.03, rects[NAMES[t]]).translate(x0, BENCH_TOP - 0.24, 1.566), color: 0xffffff });

    const list = t === 0 ? L.solid : t === 1 ? L.liquid : L.gas;
    for (const p of list) {
      balls.push({ geometry: unitBall().translate(x0 + p[0], floorY + p[1], p[2]), color: BLUE });
    }
    if (t === 0) {
      // Bonds between lattice neighbours only: no bond runs anywhere but one spacing along an axis.
      const a = L.spacing;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const d = Math.hypot(list[i][0] - list[j][0], list[i][1] - list[j][1], list[i][2] - list[j][2]);
          if (Math.abs(d - a) > 1e-6) continue;
          solid.push({ geometry: rod([x0 + list[i][0], floorY + list[i][1], list[i][2]], [x0 + list[j][0], floorY + list[j][1], list[j][2]], 0.042, { sides: 8, open: true }), color: 0xcfd8e2 });
        }
      }
    }
    if (t === 1) {
      // The flat top: a level sheet, faint, in the glass mesh, and a printed-looking line round the walls.
      const y = floorY + L.level;
      glass.push({ geometry: new THREE.BoxGeometry(W - 0.01, 0.012, D - 0.01).translate(x0, y, 0), color: 0x7ec4ff });
      for (const [a, b, c, d] of [[inner.x0 + 0.001, inner.z1 - 0.012, inner.x1 - 0.001, inner.z1 - 0.001], [inner.x0 + 0.001, inner.z0 + 0.001, inner.x1 - 0.001, inner.z0 + 0.012]]) {
        solid.push({ geometry: cbox(a, y - 0.012, b, c, y + 0.012, d, { c: 0.002 }), color: 0x4f9de8 });
      }
    }
    if (t === 2) {
      L.trails.forEach(({ end }, i) => {
        const p = list[i];
        const g = tube([[x0 + p[0], floorY + p[1], p[2]], [x0 + end[0], floorY + end[1], end[2]]], [r * 0.3, 0.001], { straight: true, steps: 4, sides: 8, round: 0 });
        tintVertices(g, (vx, vy, vz, out) => {
          const dist = Math.hypot(vx - (x0 + p[0]), vy - (floorY + p[1]), vz - p[2]);
          const k = clamp01((dist - r) / (Math.hypot(end[0] - p[0], end[1] - p[1], end[2] - p[2]) - r));
          const c0 = lin(0x4f93ee); const c1 = lin(0xbcd8f8);
          out[0] = mix(c0[0], c1[0], k); out[1] = mix(c0[1], c1[1], k); out[2] = mix(c0[2], c1[2], k);
        });
        solid.push({ geometry: g, keepColor: true });
      });
    }
  });

  return group(
    woodMesh(wood, grainMaps({ seed: 61 })),
    solidMesh(solid, { roughness: 0.42, metalness: 0.08 }),
    mesh(mergeParts(balls), standard({ vertexColors: true, roughness: 0.28, metalness: 0.02 })),
    printedMesh(printed, atlas),
    glassMesh(glass, { opacity: 0.15, roughness: 0.04 }),
  );
}

// ---------------------------------------------------------------------------
// Shared small things for the benches below
// ---------------------------------------------------------------------------

// A closed convex prism along X from a list of [z, y] points.
function smoothProfile(points, n = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map(([r, y]) => V(r, y, 0)), false, 'centripetal');
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    out.push([Math.max(0, p.x), p.y]);
  }
  out[0][0] = 0;
  out[n][0] = 0;
  return out;
}

// A lathe carried to `at` with its +Y along `dir`.
function aimedLathe(profile, at, dir, segments = 24) {
  return aimed(lathe(profile, { segments }), at, dir);
}

// ---------------------------------------------------------------------------
// 3. The pH scale
// ---------------------------------------------------------------------------
//
// Fifteen tubes, 0 to 14, one foot of rack apart less a little, in universal-indicator colours. A
// household thing stands on the shelf at its own pH, measured along the same axis as the tubes, so the
// position of the lemon IS the claim. The tube's x is one function of pH, used by the tubes, the number
// plates, the coloured bar, the objects and the check.

const PH = {
  count: 15,
  pitch: 0.96,
  colors: ['#bb0f1a', '#cf1519', '#e0211a', '#ec3d16', '#f26c12', '#f79e12', '#f4cf0c', '#1fa43a', '#0a9c7c', '#0b8cb2', '#1466d2', '#2a3cb8', '#3f28a8', '#551f9e', '#6c1a9a'],
  shelfY: 0.62,
  railLow: 1.24,
  railTop: 1.74,
  tubeZ: -1.1,
  tubeR: 0.2,
  tubeH: 2.5,
  fill: 1.82,
  things: [
    { key: 'lemon', label: 'lemon juice', ph: 2, plateDx: 0 },
    { key: 'tomato', label: 'tomato', ph: 4, plateDx: 0 },
    { key: 'milk', label: 'milk', ph: 6.5, plateDx: -0.24 },
    { key: 'water', label: 'pure water', ph: 7, plateDx: 0.24 },
    { key: 'soda', label: 'baking soda', ph: 8.5, plateDx: 0.14 },
    { key: 'bleach', label: 'bleach', ph: 12.5, plateDx: 0 },
  ],
};
const phX = (ph) => (ph - 7) * PH.pitch;

function phLayout() {
  if (PH.colors.length !== PH.count) throw new Error('ph: colour table is not 15 long');
  const tubes = [];
  for (let n = 0; n < PH.count; n++) tubes.push({ ph: n, x: phX(n), color: PH.colors[n] });
  if (tubes.length !== 15 || tubes[0].ph !== 0 || tubes[14].ph !== 14) throw new Error('ph: the tubes must run 0 to 14');
  return { ...PH, tubes, things: PH.things.map((t) => ({ ...t, x: phX(t.ph) })) };
}

function drawPhBar(ctx, x, y, w, h) {
  const cell = w / PH.count;
  const top = h * 0.5;
  ctx.fillStyle = '#efe8d6';
  ctx.fillRect(x, y, w, h);
  // The words, centred over the part of the scale each one names.
  ctx.fillStyle = '#1f1c17';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const word = (text, centre) => {
    fitFont(ctx, text, cell * 2.6, top * 0.86, (px) => `800 ${px}px ${SANS}`);
    ctx.fillText(text, x + centre * cell, y + top * 0.53);
  };
  word('ACID', 3.5);
  word('NEUTRAL', 7.5);
  word('BASE', 11.5);
  // Arrows running outward from neutral: both ends of the scale get stronger as they go.
  ctx.strokeStyle = '#1f1c17';
  ctx.lineWidth = Math.max(2, h * 0.035);
  const arrow = (from, to) => {
    const fy = y + top * 0.53;
    const d = Math.sign(to - from);
    ctx.beginPath();
    ctx.moveTo(x + from * cell, fy);
    ctx.lineTo(x + to * cell, fy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + to * cell, fy);
    ctx.lineTo(x + (to - d * 0.16) * cell, fy - top * 0.2);
    ctx.lineTo(x + (to - d * 0.16) * cell, fy + top * 0.2);
    ctx.closePath();
    ctx.fillStyle = '#1f1c17';
    ctx.fill();
  };
  arrow(2.7, 0.25);
  arrow(6.3, 4.4);
  arrow(8.7, 10.6);
  arrow(12.4, 14.75);
  // One cell per step, in the tube's own colour, with its number. Every one is the same width because
  // every step is the same factor of ten.
  for (let k = 0; k < PH.count; k++) {
    ctx.fillStyle = PH.colors[k];
    ctx.fillRect(x + k * cell, y + top, cell, h - top);
    ctx.fillStyle = k === 6 ? '#1f1c17' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `800 ${(h - top) * 0.74}px ${SANS}`;
    ctx.fillText(String(k), x + (k + 0.5) * cell, y + top + (h - top) * 0.53);
  }
}

function tubeGlass(R, H) {
  const rows = [[0, 0]];
  for (let i = 1; i <= 7; i++) {
    const a = (i / 7) * (Math.PI / 2);
    rows.push([Math.sin(a) * R, R - Math.cos(a) * R]);
  }
  rows.push([R, H * 0.5], [R, H - 0.06], [R + 0.018, H - 0.012], [R + 0.012, H], [R - 0.012, H], [R - 0.014, H - 0.05], [R - 0.014, H * 0.5]);
  const r2 = R - 0.014;
  for (let i = 7; i >= 1; i--) {
    const a = (i / 7) * (Math.PI / 2);
    rows.push([Math.sin(a) * r2, R - Math.cos(a) * r2]);
  }
  rows.push([0, R - r2]);
  return lathe(rows, { segments: 26 });
}

function tubeLiquid(R, fill, hex) {
  const r = R - 0.022;
  const rows = [[0, 0.022]];
  for (let i = 1; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    rows.push([Math.sin(a) * r, R - Math.cos(a) * r]);
  }
  // The meniscus: a liquid climbs a glass wall a little at its edge.
  rows.push([r, fill * 0.5], [r, fill + 0.02, 'c'], [r * 0.82, fill - 0.004], [r * 0.4, fill - 0.016], [0, fill - 0.02]);
  const g = lathe(rows, { segments: 30 });
  const c = lin(hex);
  const SHINE = lin(0xffffff);
  tintVertices(g, (x, y, z, out) => {
    const a = Math.atan2(x, z);
    const band = Math.max(0, 1 - Math.abs(a + 0.62) / 0.24);
    const top = y > fill - 0.03 && Math.hypot(x, z) < r * 0.95 ? 0.16 : 0;
    const k = band * 0.32 * (y < fill - 0.04 ? 1 : 0) + top;
    out[0] = mix(c[0], SHINE[0], k); out[1] = mix(c[1], SHINE[1], k); out[2] = mix(c[2], SHINE[2], k);
  });
  return g;
}

function phScale() {
  const L = phLayout();
  const { shelfY, railLow, railTop, tubeZ, tubeR: R, tubeH: H, fill } = L;
  const { texture: atlas, rects } = buildAtlas(2048, 512, [
    ['bar', 2048, 96, drawPhBar],
    ...L.tubes.map((t) => [`n${t.ph}`, 132, 92, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, [String(t.ph)], { font: SANS, weight: '800' })]),
    ...L.things.map((t) => [t.key, 270, 96, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, [t.label], { px: 40 })]),
    ['box', 220, 220, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#1b6fb5';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#f4f1e6';
      ctx.fillRect(x, y + h * 0.28, w, h * 0.44);
      ctx.fillStyle = '#123f6b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, 'BAKING', w * 0.84, h * 0.2, (px) => `800 ${px}px ${SANS}`);
      ctx.fillText('BAKING', x + w / 2, y + h * 0.4);
      fitFont(ctx, 'SODA', w * 0.84, h * 0.2, (px) => `800 ${px}px ${SANS}`);
      ctx.fillText('SODA', x + w / 2, y + h * 0.6);
    }],
    ['jug', 190, 126, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#d7e8f4';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#17467a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, 'BLEACH', w * 0.84, h * 0.42, (px) => `800 ${px}px ${SANS}`);
      ctx.fillText('BLEACH', x + w / 2, y + h * 0.5);
    }],
  ], { background: '#efe8d6' });

  const wood = [];
  const solid = [];
  const fruit = [];
  const glass = [];
  const printed = [];
  const OAK = 0xb9824a;
  const OAK_DARK = 0x8a5a30;
  const GLASS = 0xe6f6f8;

  // The base, whose front face carries the bar and whose top is the shelf.
  wood.push({ geometry: cbox(-7.65, 0, -1.55, 7.65, shelfY, 1.55, { c: 0.04 }), color: OAK_DARK });
  wood.push({ geometry: cbox(-7.55, shelfY - 0.03, -1.45, 7.55, shelfY + 0.012, 1.47, { c: 0.012 }), color: OAK });
  printed.push({ geometry: plateBox(14.4, 0.56, 0.03, rects.bar).translate(0, shelfY / 2, 1.562), color: 0xffffff });

  // The rail the tubes stand on, and the plate each number is printed on.
  wood.push({ geometry: cbox(-7.5, railLow, tubeZ - 0.3, 7.5, railTop, tubeZ + 0.3, { c: 0.03 }), color: OAK });
  // The drilled plank that holds them upright: a real board with real holes.
  const plankY0 = 3.16; const plankY1 = 3.3;
  const outline = new THREE.Shape();
  outline.moveTo(-7.5, -0.3); outline.lineTo(7.5, -0.3); outline.lineTo(7.5, 0.3); outline.lineTo(-7.5, 0.3); outline.closePath();
  for (const t of L.tubes) {
    const hole = new THREE.Path();
    hole.absarc(t.x, 0, R + 0.022, 0, Math.PI * 2, true);
    outline.holes.push(hole);
  }
  const plank = new THREE.ExtrudeGeometry(outline, { depth: plankY1 - plankY0, bevelEnabled: false, curveSegments: 12 });
  plank.rotateX(-Math.PI / 2);
  plank.translate(0, plankY0, tubeZ);
  const puv = plank.attributes.uv;
  for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getY(i) / 2.2, puv.getX(i) / 4.4);
  wood.push({ geometry: plank, color: OAK });
  // Uprights stand behind the tubes, in the gaps, so none of them crosses a colour.
  for (const x of [-7.3, -3.36, 3.36, 7.3]) {
    wood.push({ geometry: cbox(x - 0.1, shelfY, tubeZ - 0.42, x + 0.1, plankY1 + 0.1, tubeZ - 0.28, { c: 0.02, grain: 'y' }), color: OAK_DARK });
  }

  const bottomY = railTop - 0.02;
  for (const t of L.tubes) {
    glass.push({ geometry: tubeGlass(R, H).translate(t.x, bottomY, tubeZ), color: GLASS });
    solid.push({ geometry: tubeLiquid(R, fill, t.color).translate(t.x, bottomY, tubeZ), keepColor: true });
    // A dark cup in the rail for the tube's foot and a pale grommet round the hole in the plank.
    solid.push({ geometry: lathe([[0, railTop], [R * 0.9, railTop, 'c'], [R * 0.92, railTop + 0.01, 'c'], [R * 0.66, railTop + 0.022], [0, railTop + 0.022]], { segments: 24 }).translate(t.x, 0, tubeZ), color: 0x3a2412 });
    solid.push({ geometry: lathe(ringProfile(R + 0.022, plankY1 + 0.001, 0.016, 6), { segments: 26 }).translate(t.x, 0, tubeZ), color: 0x6a4525 });
    printed.push({ geometry: plateBox(0.66, 0.42, 0.03, rects[`n${t.ph}`]).translate(t.x, (railLow + railTop) / 2, tubeZ + 0.312), color: 0xffffff });
  }

  // --- The things, each on the shelf at the x of its own pH.
  const thingZ = 0.3;
  const X = Object.fromEntries(L.things.map((t) => [t.key, t.x]));

  // A lemon, lying down: nipple at one end, stalk scar at the other, and a skin of pores.
  const lemon = lathe(smoothProfile([[0, -0.48], [0.028, -0.472], [0.055, -0.44], [0.095, -0.405], [0.18, -0.345], [0.27, -0.23], [0.325, -0.08], [0.33, 0.06], [0.295, 0.2], [0.21, 0.32], [0.11, 0.395], [0.05, 0.425], [0, 0.435]], 32), { segments: 32 });
  lemon.rotateZ(Math.PI / 2 - 0.05);
  const lemonY = shelfY + 0.318;
  fruit.push({ geometry: lemon.translate(X.lemon, lemonY, thingZ), color: 0xf2cf12 });
  solid.push({ geometry: ball(0.03, [X.lemon - 0.43, lemonY + 0.02, thingZ], { detail: 8 }), color: 0x5f6b24 });

  // A tomato: flattened, ribbed at the shoulder, with a green star and a stalk.
  const tomatoProfile = smoothProfile([[0, 0.0], [0.12, 0.002], [0.26, 0.035], [0.36, 0.13], [0.405, 0.27], [0.375, 0.41], [0.27, 0.5], [0.14, 0.525], [0.05, 0.5], [0, 0.48]], 26);
  const tomato = lathe(tomatoProfile, {
    segments: 36,
    warp: (a, r, y) => r * (1 + 0.05 * Math.cos(a * 5) * sstep(y, 0.2, 0.46)),
  });
  solid.push({ geometry: tomato.translate(X.tomato, shelfY, thingZ), color: 0xd62a1a });
  const tomatoTop = shelfY + 0.49;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const sx = Math.sin(a); const sz = Math.cos(a);
    const P = (r, y) => [X.tomato + sx * r, tomatoTop + y, thingZ + sz * r];
    solid.push({
      geometry: tube([P(0, 0.01), P(0.09, 0.036), P(0.18, 0.02), P(0.27, -0.03)], [0.04, 0.05, 0.034, 0.002], { sides: 8, steps: 10, round: 1, section: () => [0.35, 1], frame: () => [0, 1, 0] }),
      color: 0x3f7a2a,
    });
  }
  solid.push({ geometry: tube([[X.tomato, tomatoTop - 0.02, thingZ], [X.tomato + 0.01, tomatoTop + 0.08, thingZ], [X.tomato + 0.04, tomatoTop + 0.15, thingZ + 0.01]], 0.022, { sides: 8, steps: 8, round: 1 }), color: 0x3f7a2a });

  // Two tumblers, side by side, half a step apart, because that is what 6.5 and 7 are.
  const tumbler = (x, z, level, hex) => {
    const GH = 0.74; const r0 = 0.165; const r1 = 0.205;
    const rAt = (y) => mix(r0, r1, y / GH);
    glass.push({
      geometry: lathe([[0, shelfY - shelfY], [r0, 0], [r0 + 0.004, 0.012], [rAt(GH * 0.5), GH * 0.5], [r1, GH - 0.008], [r1 - 0.004, GH], [r1 - 0.012, GH], [rAt(GH * 0.5) - 0.012, GH * 0.5], [r0 - 0.012, 0.05], [0, 0.04]], { segments: 30 }).translate(x, shelfY, z),
      color: GLASS,
    });
    const rin = (y) => rAt(y) - 0.016;
    solid.push({
      geometry: lathe([[0, 0.044], [rin(0.05), 0.05, 'c'], [rin(level * 0.5), level * 0.5], [rin(level), level, 'c'], [rin(level) * 0.5, level - 0.004], [0, level - 0.006]], { segments: 30 }).translate(x, shelfY, z),
      color: hex,
    });
    // The rim catches the light, which is most of what says "glass" at this size.
    solid.push({ geometry: lathe(ringProfile(r1 - 0.005, GH, 0.006, 5), { segments: 30 }).translate(x, shelfY, z), color: 0xdff2f5 });
  };
  tumbler(X.milk, thingZ + 0.08, 0.6, 0xf6f1e2);
  tumbler(X.water, thingZ - 0.08, 0.56, 0xa6dcf0);

  // A plain carton of baking soda with no maker's name on it.
  const boxW = 0.46; const boxH = 0.68; const boxD = 0.27;
  solid.push({ geometry: cbox(X.soda - boxW / 2, shelfY, thingZ - boxD / 2, X.soda + boxW / 2, shelfY + boxH, thingZ + boxD / 2, { c: 0.008 }), color: 0xf0ecdd });
  printed.push({ geometry: plateBox(boxW - 0.02, boxH - 0.04, 0.006, rects.box).translate(X.soda, shelfY + boxH / 2, thingZ + boxD / 2 + 0.002), color: 0xffffff });
  solid.push({ geometry: cbox(X.soda - boxW / 2 + 0.004, shelfY + boxH - 0.006, thingZ - 0.012, X.soda + boxW / 2 - 0.004, shelfY + boxH + 0.006, thingZ + 0.012, { c: 0.003 }), color: 0xd9d4c4 });

  // A plain jug of bleach: a rounded square in plan, a handle, a blue cap, no maker's name.
  const jugH = 0.8;
  const jugProfile = [[0, 0], [0.27, 0, 'c'], [0.315, 0.04], [0.325, 0.16], [0.325, jugH * 0.66], [0.3, jugH * 0.78], [0.22, jugH * 0.9], [0.13, jugH * 0.97], [0.105, jugH], [0.105, jugH + 0.1], [0, jugH + 0.1]];
  const squareWarp = (a, r, y) => {
    const k = sstep(y, jugH * 0.9, jugH * 0.76) * sstep(y, 0.0, 0.06);
    const sq = 1 / Math.max(Math.abs(Math.sin(a)) ** 3.2 + Math.abs(Math.cos(a)) ** 3.2, 1e-3) ** (1 / 3.2);
    return r * mix(1, sq * 0.9, k);
  };
  solid.push({ geometry: lathe(jugProfile, { segments: 44, warp: squareWarp }).translate(X.bleach, shelfY, thingZ), color: 0xe9e6da });
  solid.push({ geometry: lathe([[0, 0], [0.122, 0, 'c'], [0.128, 0.02], [0.128, 0.13], [0.11, 0.155], [0, 0.16]], { segments: 22 }).translate(X.bleach, shelfY + jugH + 0.06, thingZ), color: 0x1b5fb0 });
  solid.push({
    geometry: tube([[X.bleach + 0.2, shelfY + jugH * 0.86, thingZ], [X.bleach + 0.34, shelfY + jugH * 0.86, thingZ], [X.bleach + 0.47, shelfY + jugH * 0.7, thingZ], [X.bleach + 0.42, shelfY + jugH * 0.5, thingZ], [X.bleach + 0.29, shelfY + jugH * 0.42, thingZ]], [0.05, 0.048, 0.044, 0.048, 0.05], { sides: 12, steps: 22, round: 1 }),
    color: 0xe9e6da,
  });
  printed.push({ geometry: plateBox(0.42, 0.28, 0.006, rects.jug).translate(X.bleach, shelfY + jugH * 0.38, thingZ + 0.296), color: 0xffffff });

  // A name plate raked on the shelf in front of each thing, at its own pH unless two would collide.
  for (const t of L.things) {
    const rake = 0.62;
    printed.push({ geometry: placed(plateBox(0.84, 0.3, 0.03, rects[t.key]), [t.x + t.plateDx, shelfY + 0.15 * Math.cos(rake) + 0.01, 1.08], rake), color: 0xffffff });
  }

  const skin = grainBump(2207, { size: 256, dots: 1500, min: 1.2, max: 2.8, contrast: 0.6 });
  skin.repeat.set(5, 3);
  return group(
    woodMesh(wood, grainMaps({ seed: 113 })),
    solidMesh(solid, { roughness: 0.3, metalness: 0.02 }),
    mesh(mergeParts(fruit), standard({ vertexColors: true, roughness: 0.48, metalness: 0, bumpMap: skin, bumpScale: 0.6 })),
    printedMesh(printed, atlas),
    glassMesh(glass, { opacity: 0.11, roughness: 0.04 }),
  );
}

// ---------------------------------------------------------------------------
// 4. The voltaic pile
// ---------------------------------------------------------------------------
//
// ORDER AND POLARITY, because a teacher will ask, and they are decided together. From the bottom up the
// stack repeats copper, zinc, cloth. A working CELL is the three that share the cloth: zinc below it,
// salt water, copper above it. The zinc is what corrodes, so it is the cell's negative plate and the
// copper above the cloth is its positive plate. Cells are joined by metal contact, copper on zinc, so
// the voltage climbs going UP the stack, and therefore:
//
//   - THE TOP IS POSITIVE. The last cloth has nothing above it in the repeating order, so a brass
//     pressure plate (a copper alloy) closes the twentieth cell and carries the + terminal.
//   - THE BOTTOM IS NEGATIVE. The bottom-most copper touches only the first zinc, so it adds nothing and
//     sits at that zinc's potential. The zinc is the bottom's working plate: the "zinc end".
//
// That is 20 discs of copper, 20 of zinc, 20 of cloth and 20 cells, so the count the card asks for is
// the voltage's own count.

const PILE = {
  pairs: 20,
  order: ['copper', 'zinc', 'cloth'],
  thick: { copper: 0.08, zinc: 0.08, cloth: 0.1 },
  R: 0.75,
  S: -1.0, // the stack's centre on x
  baseTop: 0.46,
  rods: [Math.PI / 3, Math.PI, (5 * Math.PI) / 3],
};

function pileLayout() {
  const discs = [];
  let y = PILE.baseTop + 0.08;
  const bottom = y;
  for (let p = 0; p < PILE.pairs; p++) {
    for (const kind of PILE.order) {
      const t = PILE.thick[kind];
      discs.push({ kind, pair: p, y0: y, y1: y + t });
      y += t;
    }
  }
  for (const [i, d] of discs.entries()) {
    if (d.kind !== PILE.order[i % 3]) throw new Error('pile: the order must repeat copper, zinc, cloth');
  }
  if (discs.length !== 60 || discs.filter((d) => d.kind === 'copper').length !== 20 || discs.filter((d) => d.kind === 'zinc').length !== 20) {
    throw new Error('pile: 20 pairs needed');
  }
  const top = y;
  const tabX = PILE.S + 1.22;
  return {
    discs,
    bottom,
    top,
    // A cell is zinc, then cloth, then whatever is next: the next copper, or for the last one the plate.
    cells: discs.filter((d) => d.kind === 'cloth').length,
    terminals: {
      minus: { x: tabX, y: bottom, z: 0, sign: '-', via: 'bottom plate, under the first copper and zinc' },
      plus: { x: tabX, y: top + 0.08, z: 0, sign: '+', via: 'brass plate on the last cloth' },
    },
    tabX,
    ...PILE,
  };
}

// A brass binding post, standing on a surface at y. Returns the point on its axis a wire goes through.
function bindingPost(list, x, y, z, color = 0xc39a45) {
  list.push({
    geometry: lathe([
      [0, 0], [0.09, 0, 'c'], [0.09, 0.03, 'c'], [0.05, 0.05], [0.046, 0.09], [0.075, 0.1, 'c'], [0.075, 0.115, 'c'], [0.046, 0.12], [0.046, 0.19],
      [0.08, 0.2, 'c'], [0.088, 0.21], [0.088, 0.3], [0.078, 0.32], [0.03, 0.335], [0, 0.34],
    ], { segments: 18 }).translate(x, y, z),
    color,
  });
  return [x, y + 0.155, z];
}

function wireWithBareEnds(points, radius, color, steps) {
  const g = tube(points, radius, { sides: 9, steps, round: 1 });
  const c = lin(color);
  const bare = lin(0xc8743a);
  const A = points[0]; const B = points[points.length - 1];
  tintVertices(g, (x, y, z, out) => {
    const d = Math.min(Math.hypot(x - A[0], y - A[1], z - A[2]), Math.hypot(x - B[0], y - B[1], z - B[2]));
    const k = sstep(d, 0.09, 0.12);
    out[0] = mix(bare[0], c[0], k); out[1] = mix(bare[1], c[1], k); out[2] = mix(bare[2], c[2], k);
  });
  return g;
}

function voltaicPile() {
  const L = pileLayout();
  const { S, R, baseTop: B, discs, bottom, top } = L;
  const { texture: atlas, rects } = buildAtlas(1024, 256, [
    ['title', 500, 90, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['VOLTAIC PILE', 'Alessandro Volta, 1800'])],
    ['legend', 500, 90, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#efe8d6';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#8a7a58';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      ctx.fillStyle = '#1f1c17';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, 'from the bottom up, 20 times:', w * 0.9, h * 0.32, (px) => `700 ${px}px ${SANS}`);
      ctx.fillText('from the bottom up, 20 times:', x + w / 2, y + h * 0.28);
      const names = [['copper', '#c56a2e'], ['zinc', '#7f93a8'], ['salt-soaked cloth', '#b5a68a']];
      let cx = x + 18;
      for (const [name, hex] of names) {
        ctx.fillStyle = hex;
        ctx.fillRect(cx, y + h * 0.56, 24, h * 0.28);
        ctx.fillStyle = '#1f1c17';
        ctx.textAlign = 'left';
        ctx.font = `700 ${h * 0.28}px ${SANS}`;
        ctx.fillText(name, cx + 30, y + h * 0.71);
        cx += 30 + ctx.measureText(name).width + 22;
      }
    }],
    ['plus', 64, 64, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#f4d44e';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#16181c';
      ctx.fillRect(x + w * 0.16, y + h * 0.41, w * 0.68, h * 0.18);
      ctx.fillRect(x + w * 0.41, y + h * 0.16, w * 0.18, h * 0.68);
    }],
    ['minus', 64, 64, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#f4d44e';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#16181c';
      ctx.fillRect(x + w * 0.16, y + h * 0.41, w * 0.68, h * 0.18);
    }],
  ]);

  const wood = [];
  const metal = [];
  const printed = [];
  const glass = [];
  const lit = [];
  const glow = [];
  const WALNUT = 0x7a4a26;
  const WALNUT_DARK = 0x593419;
  const BRASS = 0xc39a45;
  const rng = seededRandom(1800);

  // The base: a moulded plinth.
  wood.push({ geometry: cbox(-2.75, 0, -1.55, 2.75, 0.36, 1.55, { c: 0.04 }), color: WALNUT_DARK });
  wood.push({ geometry: cbox(-2.62, 0.355, -1.42, 2.62, B, 1.42, { c: 0.03 }), color: WALNUT });
  printed.push({ geometry: plateBox(2.3, 0.3, 0.025, rects.title).translate(-1.45, 0.18, 1.56), color: 0xffffff });
  printed.push({ geometry: plateBox(2.5, 0.3, 0.025, rects.legend).translate(1.2, 0.18, 1.56), color: 0xffffff });

  // The bottom plate, with its tab and its terminal.
  metal.push({ geometry: disc(R + 0.01, B, B + 0.08, { c: 0.012, sides: 44, x: S }), color: BRASS });
  metal.push({ geometry: cbox(S + 0.6, B, -0.17, S + 1.4, B + 0.07, 0.17, { c: 0.012 }), color: BRASS });
  const minusPost = bindingPost(metal, L.tabX, B + 0.07, 0);

  // The stack. The cloth is smaller than the metal and ragged, so it sits back as a shadow line, which
  // is what makes each pair countable from across a room.
  const COLORS = { copper: lin(0xc8682c), zinc: lin(0x7c90a6), cloth: lin(0xb0a184) };
  for (const d of discs) {
    const j = 0.94 + rng() * 0.12;
    const offx = (rng() - 0.5) * 0.01; const offz = (rng() - 0.5) * 0.01;
    const base = COLORS[d.kind];
    if (d.kind === 'cloth') {
      const p1 = rng() * 6.28; const p2 = rng() * 6.28; const p3 = rng() * 6.28;
      const g = disc(R - 0.018, d.y0, d.y1, {
        c: 0.02, sides: 40, x: S + offx, z: offz,
        warp: (a) => 1 + 0.008 * Math.sin(a * 7 + p1) + 0.005 * Math.sin(a * 13 + p2),
      });
      // Damp in patches, as a soaked cloth is, and always a little darker low down where it drains.
      tintVertices(g, (x, y, z, out) => {
        const a = Math.atan2(x - S, z);
        const k = j * (0.86 + 0.14 * Math.sin(a * 3 + p3));
        out[0] = base[0] * k; out[1] = base[1] * k; out[2] = base[2] * k;
      });
      metal.push({ geometry: g, keepColor: true });
    } else {
      const g = disc(R, d.y0, d.y1, { c: 0.012, sides: 40, x: S + offx, z: offz });
      tintVertices(g, (x, y, z, out) => { out[0] = base[0] * j; out[1] = base[1] * j; out[2] = base[2] * j; });
      metal.push({ geometry: g, keepColor: true });
    }
  }

  // The brass plate that closes the last cell, its tab and its terminal.
  metal.push({ geometry: disc(R + 0.01, top, top + 0.08, { c: 0.012, sides: 44, x: S }), color: BRASS });
  metal.push({ geometry: cbox(S + 0.6, top + 0.005, -0.17, S + 1.4, top + 0.075, 0.17, { c: 0.012 }), color: BRASS });
  const plusPost = bindingPost(metal, L.tabX, top + 0.075, 0);

  // Three turned guide rods, and the yoke they carry. No rod stands square in front of the stack.
  const rodR = 0.06;
  const rodAt = R + rodR + 0.022;
  const yokeY0 = top + 0.3; const yokeY1 = yokeY0 + 0.16;
  const rodTop = yokeY1 + 0.46;
  for (const a of L.rods) {
    const x = S + Math.sin(a) * rodAt; const z = Math.cos(a) * rodAt;
    wood.push({ geometry: lathe([[0, B - 0.02], [rodR + 0.05, B - 0.02, 'c'], [rodR + 0.05, B + 0.05], [rodR + 0.01, B + 0.1], [rodR, B + 0.14], [rodR, rodTop - 0.08], [rodR + 0.018, rodTop - 0.05], [rodR, rodTop], [0.055, rodTop + 0.02], [0, rodTop + 0.02]], { segments: 14 }).translate(x, 0, z), color: WALNUT });
    wood.push({ geometry: ball(0.095, [x, rodTop + 0.08, z], { detail: 14 }), color: WALNUT });
    metal.push({ geometry: lathe(ringProfile(rodR + 0.012, yokeY1 + 0.012, 0.018, 6), { segments: 16 }).translate(x, 0, z), color: BRASS });
  }
  wood.push({ geometry: lathe([[0, yokeY0], [0.98, yokeY0, 'c'], [1.01, yokeY0 + 0.03], [1.01, yokeY1 - 0.04], [0.97, yokeY1, 'c'], [0, yokeY1]], { segments: 44 }).translate(S, 0, 0), color: WALNUT });
  // The press screw: from the top plate up through the yoke, with a cross handle above it.
  metal.push({ geometry: rod([S, top + 0.07, 0], [S, yokeY1 + 0.34, 0], 0.05, { sides: 14 }), color: BRASS });
  metal.push({ geometry: lathe([[0, 0], [0.14, 0, 'c'], [0.14, 0.04, 'c'], [0.07, 0.07], [0.05, 0.08], [0, 0.08]], { segments: 18 }).translate(S, top + 0.07, 0), color: BRASS });
  metal.push({ geometry: tube([[S - 0.24, yokeY1 + 0.34, 0], [S + 0.24, yokeY1 + 0.34, 0]], 0.03, { straight: true, steps: 2, sides: 10, round: 2 }), color: BRASS });
  metal.push({ geometry: ball(0.07, [S, yokeY1 + 0.34, 0], { detail: 14 }), color: BRASS });

  // + and - on small plates, each fixed to its own terminal's tab.
  const plateZ = 0.185;
  printed.push({ geometry: plateBox(0.26, 0.26, 0.02, rects.plus).translate(L.tabX, top - 0.06, plateZ), color: 0xffffff });
  metal.push({ geometry: cbox(L.tabX - 0.06, top - 0.06, plateZ - 0.03, L.tabX + 0.06, top + 0.02, plateZ - 0.008, { c: 0.004 }), color: BRASS });
  printed.push({ geometry: plateBox(0.26, 0.26, 0.02, rects.minus).translate(L.tabX, B + 0.14, 0.27), color: 0xffffff });
  metal.push({ geometry: cbox(L.tabX - 0.05, B, 0.17, L.tabX + 0.05, B + 0.02, 0.28, { c: 0.004 }), color: BRASS });

  // --- The lamp stand: a block, two posts, brass strips to a socket, a bulb and a filament.
  const lx = 1.42; const lz = 0.1;
  const blockTop = B + 0.2;
  wood.push({ geometry: cbox(0.55, B, -0.42, 2.32, blockTop, 0.62, { c: 0.03 }), color: WALNUT });
  const leftPost = bindingPost(metal, 0.82, blockTop, 0.32);
  const rightPost = bindingPost(metal, 2.04, blockTop, 0.32);
  for (const [px, sx] of [[0.82, -1], [2.04, 1]]) {
    const inner = lx + sx * 0.2;
    metal.push({ geometry: cbox(Math.min(px, inner), blockTop, 0.09, Math.max(px, inner), blockTop + 0.016, 0.21, { c: 0.004 }), color: BRASS });
    metal.push({ geometry: cbox(px - 0.06, blockTop, 0.2, px + 0.06, blockTop + 0.014, 0.36, { c: 0.004 }), color: BRASS });
  }
  const K = 0.92;
  const socketY = blockTop;
  metal.push({ geometry: lathe([[0, 0], [0.31, 0, 'c'], [0.31, 0.05, 'c'], [0.22, 0.09], [0.2, 0.13, 'c'], [0.2, 0.38, 'c'], [0.18, 0.4, 'c'], [0, 0.4]], { segments: 32 }).translate(lx, socketY, lz), color: BRASS });
  const capRows = [[0, 0.36]];
  for (let i = 0; i < 5; i++) {
    const y = 0.38 + i * 0.028;
    capRows.push([0.158, y], [0.172, y + 0.014]);
  }
  capRows.push([0.16, 0.53], [0.145, 0.55], [0, 0.55]);
  metal.push({ geometry: lathe(capRows, { segments: 26 }).translate(lx, socketY, lz), color: 0xd9dbdf });
  const bulbY0 = socketY + 0.51;
  const bulbShape = new THREE.CatmullRomCurve3([
    [0.17, 0], [0.19, 0.08], [0.25, 0.2], [0.36, 0.38], [0.43, 0.58], [0.45, 0.76], [0.42, 0.94], [0.33, 1.1], [0.2, 1.2], [0.08, 1.245], [0.0, 1.25],
  ].map(([r, y]) => V(r * K, y * K, 0)), false, 'centripetal');
  const envelope = [];
  for (let i = 0; i <= 30; i++) { const p = bulbShape.getPoint(i / 30); envelope.push([Math.max(0, p.x), p.y]); }
  envelope[envelope.length - 1][0] = 0;
  glass.push({ geometry: lathe([[0, 0], ...envelope], { segments: 44 }).translate(lx, bulbY0, lz), color: 0xfff0c4 });
  // The glow is the far half of a shell just inside the glass, so there is always warm light behind the
  // filament and none in front of it.
  const glowShell = lathe([[0, 0.02], ...envelope.slice(1).map(([r, y]) => [Math.max(0, r - 0.02), y - 0.012])], { segments: 36 });
  const GLOW_HOT = lin(0xfff0a0);
  const GLOW_EDGE = lin(0xff9a30);
  tintVertices(glowShell, (x, y, z, out) => {
    const t = clamp01(Math.hypot(x, (y - 0.62) * 0.85, z) / 0.55);
    const k = t * t;
    out[0] = mix(GLOW_HOT[0], GLOW_EDGE[0], k); out[1] = mix(GLOW_HOT[1], GLOW_EDGE[1], k); out[2] = mix(GLOW_HOT[2], GLOW_EDGE[2], k);
  });
  glow.push({ geometry: glowShell.translate(lx, bulbY0, lz), keepColor: true });
  const filY = bulbY0 + 0.62;
  const filHalf = 0.16;
  for (const sx of [-1, 1]) {
    metal.push({ geometry: tube([[lx + sx * 0.04, bulbY0 + 0.02, lz], [lx + sx * 0.05, bulbY0 + 0.3, lz], [lx + sx * filHalf, filY, lz]], 0.011, { sides: 6, steps: 10, round: 1 }), color: 0x6b6e73 });
  }
  const coil = [];
  const coilSteps = 104;
  for (let i = 0; i <= coilSteps; i++) {
    const t = i / coilSteps;
    const a = t * 7 * Math.PI * 2;
    coil.push([lx + mix(-filHalf, filHalf, t), filY + Math.sin(a) * 0.034, lz + Math.cos(a) * 0.034]);
  }
  lit.push({ geometry: tube(coil, 0.014, { sides: 6, steps: coilSteps }), color: 0xfffbe0 });
  // A glass stem between the leads.
  glass.push({ geometry: lathe([[0, 0], [0.12, 0], [0.09, 0.09], [0.055, 0.18], [0.045, 0.3], [0, 0.31]], { segments: 16 }).translate(lx, bulbY0, lz), color: 0xfff0c4 });

  // --- The two wires. Each starts on a terminal of the pile and ends on a post of the lamp, and the
  // lamp's own strips, socket, leads and filament close the circle between those two posts.
  const WIRE_R = 0.028;
  const plusPath = [plusPost, [plusPost[0] + 0.5, plusPost[1] + 0.08, -0.12], [1.5, plusPost[1] - 0.55, -0.62], [2.42, 3.6, -0.78], [2.56, 1.9, -0.5], [2.42, 1.15, 0.05], [rightPost[0] + 0.16, rightPost[1] + 0.04, 0.3], rightPost];
  const minusPath = [minusPost, [minusPost[0] + 0.1, minusPost[1] + 0.13, 0.18], [0.48, minusPost[1] + 0.24, 0.62], [0.68, leftPost[1] + 0.1, 0.56], leftPost];
  metal.push({ geometry: wireWithBareEnds(plusPath, WIRE_R, 0xb81d1d, 90), keepColor: true });
  metal.push({ geometry: wireWithBareEnds(minusPath, WIRE_R, 0x1f2736, 40), keepColor: true });

  const lamp = glassMesh(glass, { emissive: 0xffb84d, emissiveIntensity: 0.45, opacity: 0.2 });
  return group(
    woodMesh(wood, grainMaps({ seed: 1745, strength: 0.3 })),
    solidMesh(metal, { roughness: 0.42, metalness: 0.3 }),
    printedMesh(printed, atlas),
    lamp,
    unlitMesh(lit),
    unlitMesh(glow, { side: THREE.BackSide }),
  );
}

// ---------------------------------------------------------------------------
// 5. The distillation apparatus
// ---------------------------------------------------------------------------
//
// ONE CONTINUOUS PATH, and the layout below is a single function of distance along the condenser, so
// the flask, the side arm, the tube, the jacket's two stubs, the clamps and the drip all agree. Vapour
// runs DOWN the slope. Cooling water enters the jacket at the LOW end and leaves at the HIGH end, against
// it (counterflow), which is the arrangement that keeps the jacket full and has the coldest water meet
// the condensate last. The chevrons on the hoses and in the jacket are placed along the flow direction
// from the same paths the hoses are swept along, so they cannot point the wrong way by accident.
//
// The liquid in the boiling flask is opaque but drawn from its back faces, so the salt on the flask's
// floor and the bubbles rising through the liquid show in front of it.

const STILL = {
  T: 1.1, // bench top
  flask: { x: -3.0, z: 0.2, y: 2.89, R: 0.72, neckR: 0.17, neckTop: 4.95 },
  level: 0.08, // liquid level above the flask's centre
  armY: 4.6,
  slope: (16 * Math.PI) / 180,
  sEnd: 5.045,
  jacket: { s0: 1.25, s1: 4.6, R: 0.24 },
  inR: 0.072,
  stubs: { inlet: 4.25, outlet: 1.6, len: 0.62 },
  receiver: { x: 2.35, level: 0.4 },
  tip: [2.35, 2.75, 0.2],
  thermo: { y0: 5.16, y1: 6.06, tMax: 120, reads: 100, bulbY: 4.42 },
  salt: 44,
  bubbles: 26,
};

const stillP = (s) => [STILL.flask.x + s * Math.cos(STILL.slope), STILL.armY - s * Math.sin(STILL.slope), STILL.flask.z];
const STILL_D = () => V(Math.cos(STILL.slope), -Math.sin(STILL.slope), 0);

function stillLayout() {
  const { stubs, jacket, flask, T, receiver, tip, thermo } = STILL;
  const inlet = stillP(stubs.inlet);
  const outlet = stillP(stubs.outlet);
  // Lower along the slope means a smaller y, and that is the whole of the counterflow check.
  if (!(inlet[1] < outlet[1])) throw new Error('still: the cooling water must enter at the LOW end');
  if (!(stubs.inlet > jacket.s0 && stubs.inlet < jacket.s1 && stubs.outlet > jacket.s0 && stubs.outlet < jacket.s1)) throw new Error('still: stubs must be on the jacket');
  const thermoY = (t) => mix(thermo.y0, thermo.y1, t / thermo.tMax);
  return {
    ...STILL,
    inlet,
    outlet,
    pathEnd: stillP(STILL.sEnd),
    thermoY,
    columnTop: thermoY(thermo.reads),
    mouthY: T + 1.02,
    waterY: T + receiver.level,
    tipAboveMouth: tip[1] - (T + 1.02),
    flaskBottom: flask.y - flask.R,
    armStart: stillP(0),
  };
}

// Chevrons along a swept path, each centred on it and pointing the way the path runs.
function chevronsAlong(list, points, at, color, { r = 0.108, inner = 0.076, len = 0.17 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  for (const t of at) {
    const p = curve.getPoint(t);
    const tangent = curve.getPoint(Math.min(1, t + 0.01)).sub(curve.getPoint(Math.max(0, t - 0.01))).normalize();
    list.push({ geometry: aimedLathe([[0, 0], [r, 0, 'c'], [inner, len * 0.92], [0.0, len]], p, tangent, 20), color });
  }
}

function distillationStill() {
  const L = stillLayout();
  const { T, flask, level, inR, jacket, stubs, tip, thermo, receiver } = L;
  const F = flask;
  const D = STILL_D();
  const rng = seededRandom(7711);

  const { texture: atlas, rects } = buildAtlas(1024, 512, [
    ['salt', 330, 84, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['salt water with dye'], { px: 34 })],
    ['cond', 330, 84, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['condenser'], { px: 34 })],
    ['pure', 330, 84, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['pure water'], { px: 34 })],
    ['in', 310, 84, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['cold water in'], { ground: '#d7e8f8', ink: '#123f78', edge: '#3f78c8', px: 34 })],
    ['out', 310, 84, (ctx, x, y, w, h) => plateFace(ctx, x, y, w, h, ['warm water out'], { ground: '#f8e0cc', ink: '#7a3410', edge: '#c8703a', px: 34 })],
    ['scale', 120, 400, (ctx, x, y, w, h) => {
      ctx.fillStyle = '#f4f1e6';
      ctx.fillRect(x, y, w, h);
      const pad = 8;
      const yOf = (t) => y + h - pad - (t / thermo.tMax) * (h - pad * 2);
      ctx.fillStyle = '#1f1c17';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let t = 0; t <= thermo.tMax; t += 5) {
        const major = t % 20 === 0;
        ctx.fillRect(x + w * 0.56, yOf(t) - (major ? 1.5 : 0.7), major ? w * 0.34 : (t % 10 === 0 ? w * 0.24 : w * 0.14), major ? 3 : 1.4);
        if (major) {
          ctx.font = `700 ${w * 0.25}px ${SANS}`;
          ctx.textAlign = 'right';
          ctx.fillText(String(t), x + w * 0.5, yOf(t));
        }
      }
    }],
  ]);

  const wood = [];
  const solid = [];
  const printed = [];
  const glass = [];
  const back = [];
  const front = [];
  const GLASS = 0xe2f4f6;
  const GLASS_EDGE = 0xbfe2e4;
  const IRON = 0x3c4046;
  const IRON_DARK = 0x2a2d31;
  const CHROME = 0xc4cad0;
  const OAK = 0x9a6a3a;
  const OAK_DARK = 0x6e4726;
  const ROSE = 0xc8325a;
  const COOL = 0x7cc6f2;
  const CLEAR = 0xbfe6f4;

  // --- The bench: a dark stone top on an oak frame.
  const BX = 4.7; const BZ = 1.62;
  solid.push({ geometry: cbox(-BX, T - 0.16, -BZ, BX, T, BZ, { c: 0.03 }), color: 0x343a42 });
  wood.push({ geometry: cbox(-BX + 0.14, T - 0.42, -BZ + 0.14, BX - 0.14, T - 0.15, BZ - 0.14, { c: 0.02 }), color: OAK });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wood.push({ geometry: cbox(sx * (BX - 0.3) - 0.13, 0, sz * (BZ - 0.3) - 0.13, sx * (BX - 0.3) + 0.13, T - 0.4, sz * (BZ - 0.3) + 0.13, { c: 0.02, grain: 'y' }), color: OAK_DARK });
    }
    wood.push({ geometry: cbox(sx * (BX - 0.3) - 0.07, 0.2, -BZ + 0.3, sx * (BX - 0.3) + 0.07, 0.32, BZ - 0.3, { c: 0.012, grain: 'z' }), color: OAK_DARK });
  }
  wood.push({ geometry: cbox(-BX + 0.3, 0.2, -0.07, BX - 0.3, 0.32, 0.07, { c: 0.012 }), color: OAK_DARK });

  // --- A retort stand: a heavy foot and a rod, and a boss wherever an arm leaves the rod.
  const stand = (x, z, height) => {
    solid.push({ geometry: cbox(x - 0.62, T, z - 0.34, x + 0.62, T + 0.09, z + 0.34, { c: 0.02 }), color: IRON_DARK });
    solid.push({ geometry: lathe([[0, 0], [0.09, 0, 'c'], [0.09, 0.03], [0.05, 0.07], [0, 0.08]], { segments: 14 }).translate(x, T + 0.09, z), color: IRON });
    solid.push({ geometry: tube([[x, T + 0.09, z], [x, T + height, z]], 0.038, { straight: true, steps: 2, sides: 12, round: 2 }), color: CHROME });
  };
  const boss = (x, y, z, toZ) => {
    solid.push({ geometry: cbox(x - 0.075, y - 0.075, z - 0.075, x + 0.075, y + 0.075, z + 0.075, { c: 0.012 }), color: IRON });
    solid.push({ geometry: tube([[x - 0.075, y, z], [x - 0.2, y, z]], 0.018, { straight: true, steps: 1, sides: 8, round: 1 }), color: CHROME });
    solid.push({ geometry: ball(0.04, [x - 0.2, y, z], { detail: 10 }), color: CHROME });
    solid.push({ geometry: tube([[x, y, z], [x, y, toZ]], 0.026, { straight: true, steps: 2, sides: 10, round: 1 }), color: CHROME });
  };

  const SZ = -0.95;
  stand(F.x, SZ, 3.85);
  stand(0.02, SZ, 3.1);

  // --- The boiling flask: one lathe for the bulb and the neck.
  const bulb = [[0, F.y - F.R]];
  const neckJoin = Math.asin(F.neckR / F.R);
  for (let i = 1; i <= 28; i++) {
    const a = Math.PI - (i / 28) * (Math.PI - neckJoin);
    bulb.push([Math.sin(a) * F.R, F.y + Math.cos(a) * F.R]);
  }
  bulb.push([F.neckR, F.neckTop - 0.03], [F.neckR + 0.02, F.neckTop - 0.005], [F.neckR + 0.012, F.neckTop], [0, F.neckTop]);
  glass.push({ geometry: lathe(bulb, { segments: 48 }).translate(F.x, 0, F.z), color: GLASS });
  solid.push({ geometry: lathe(ringProfile(F.neckR + 0.012, F.neckTop - 0.006, 0.012, 5), { segments: 28 }).translate(F.x, 0, F.z), color: GLASS_EDGE });

  // The liquid. A shell inside the glass drawn from its back faces, with a lit flat surface on top.
  const rIn = F.R - 0.02;
  const liquidTop = F.y + level;
  const shell = [[0, F.y - rIn]];
  const stopAngle = Math.acos(level / rIn);
  for (let i = 1; i <= 24; i++) {
    const a = Math.PI - (i / 24) * (Math.PI - stopAngle);
    shell.push([Math.sin(a) * rIn, F.y + Math.cos(a) * rIn]);
  }
  shell.push([0, liquidTop]);
  const liquidGeo = lathe(shell, { segments: 40 }).translate(F.x, 0, F.z);
  const LIQ_LOW = lin(0x8d1b3f); const LIQ_HIGH = lin(0xdb4570);
  tintVertices(liquidGeo, (x, y, z, out) => {
    const t = clamp01((y - (F.y - rIn)) / (rIn + level));
    out[0] = mix(LIQ_LOW[0], LIQ_HIGH[0], t); out[1] = mix(LIQ_LOW[1], LIQ_HIGH[1], t); out[2] = mix(LIQ_LOW[2], LIQ_HIGH[2], t);
  });
  back.push({ geometry: liquidGeo, keepColor: true });
  const surfaceR = Math.sqrt(rIn * rIn - level * level);
  // Unlit, and in a mesh that casts no shadow: a lit surface here would shade everything under it.
  front.push({ geometry: lathe([[0, liquidTop - 0.008], [surfaceR, liquidTop - 0.008, 'c'], [surfaceR, liquidTop + 0.004, 'c'], [surfaceR * 0.5, liquidTop], [0, liquidTop - 0.002]], { segments: 40 }).translate(F.x, 0, F.z), color: ROSE });

  // The salt the boiling leaves behind: little cubes on the flask's floor, heaped toward the middle.
  const saltPts = [];
  for (let i = 0; i < L.salt; i++) {
    const a = rng() * Math.PI * 2;
    const rho = Math.sqrt(rng()) * 0.4;
    const size = 0.026 + rng() * 0.034;
    const px = F.x + Math.sin(a) * rho; const pz = F.z + Math.cos(a) * rho;
    const floor = F.y - Math.sqrt(rIn * rIn - rho * rho);
    const py = floor + size * 0.42;
    saltPts.push([px, py, pz]);
    const g = new THREE.BoxGeometry(size, size, size);
    g.applyMatrix4(new THREE.Matrix4().compose(V(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.5)), V(1, 1, 1)));
    solid.push({ geometry: g, color: 0xf4f1e8 });
  }
  if (saltPts.length !== L.salt) throw new Error('still: salt count');

  // Bubbles rise from the hot middle of the floor, growing as they go.
  for (let i = 0; i < L.bubbles; i++) {
    const t = (i + 0.5) / L.bubbles;
    const y = mix(F.y - rIn + 0.14, liquidTop - 0.04, t);
    const a = rng() * Math.PI * 2;
    const spread = 0.04 + rng() * (0.2 + t * 0.28);
    const bx = F.x + Math.sin(a) * spread; const bz = F.z + Math.cos(a) * spread;
    const size = 0.022 + t * 0.03 + rng() * 0.012;
    solid.push({ geometry: ball(size, [bx, y, bz], { detail: 9 }), color: 0xfde6ec });
  }
  // A few breaking at the surface.
  for (let i = 0; i < 6; i++) {
    const a = rng() * Math.PI * 2;
    const rho = 0.08 + rng() * 0.28;
    solid.push({ geometry: ball(0.03 + rng() * 0.02, [F.x + Math.sin(a) * rho, liquidTop, F.z + Math.cos(a) * rho], { detail: 9, squash: [1, 0.55, 1] }), color: 0xfde6ec });
  }

  // --- Stopper and thermometer. The bulb sits level with the side arm's mouth, where the vapour leaves.
  solid.push({ geometry: lathe([[0, F.neckTop - 0.12], [F.neckR - 0.014, F.neckTop - 0.12, 'c'], [F.neckR + 0.03, F.neckTop + 0.1, 'c'], [F.neckR + 0.02, F.neckTop + 0.125], [0, F.neckTop + 0.125]], { segments: 24 }).translate(F.x, 0, F.z), color: 0x8a3524 });
  const thX = F.x; const thZ = F.z;
  glass.push({ geometry: lathe([[0, thermo.bulbY - 0.05], [0.04, thermo.bulbY - 0.03], [0.04, thermo.y1 + 0.08], [0.025, thermo.y1 + 0.12], [0, thermo.y1 + 0.13]], { segments: 14 }).translate(thX, 0, thZ), color: GLASS });
  solid.push({ geometry: ball(0.034, [thX, thermo.bulbY, thZ], { detail: 12, squash: [1, 1.5, 1] }), color: 0xcf2030 });
  solid.push({ geometry: rod([thX, thermo.bulbY, thZ], [thX, L.columnTop, thZ], 0.0135, { sides: 8 }), color: 0xcf2030 });
  printed.push({ geometry: plateBox(0.24, thermo.y1 - thermo.y0 + 0.04, 0.012, rects.scale).translate(thX, (thermo.y0 + thermo.y1) / 2, thZ - 0.052), color: 0xffffff });
  // Two little clips hold the scale to the stem.
  for (const y of [thermo.y0 + 0.03, thermo.y1 - 0.03]) {
    solid.push({ geometry: lathe(ringProfile(0.044, y, 0.009, 5), { segments: 14 }).translate(thX, 0, thZ), color: 0x8f959c });
    solid.push({ geometry: cbox(thX - 0.012, y - 0.008, thZ - 0.052, thX + 0.012, y + 0.008, thZ - 0.03, { c: 0.002 }), color: 0x8f959c });
  }

  // --- The vapour path: side arm, condenser tube and delivery bend, all one sweep of glass.
  const P = (s) => stillP(s);
  // The delivery bend is one quadratic from the straight run's own direction round to vertical.
  const bendCorner = [tip[0], L.pathEnd[1] - (tip[0] - L.pathEnd[0]) * Math.tan(L.slope), F.z];
  const bendAt = (t) => [0, 1, 2].map((k) => (1 - t) * (1 - t) * L.pathEnd[k] + 2 * t * (1 - t) * bendCorner[k] + t * t * tip[k]);
  const vaporPath = [P(F.neckR * 0.8), P(0.9), P(2), P(3.2), P(4.4), P(L.sEnd), bendAt(0.25), bendAt(0.5), bendAt(0.75), tip];
  glass.push({ geometry: tube(vaporPath, inR, { sides: 16, steps: 72, round: 1 }), color: GLASS });
  // The far half of the tube, drawn opaque and pale. It is what makes a clear tube legible against the
  // water in the jacket, and it is one unbroken line from the neck to the tip, which is the point.
  back.push({ geometry: tube(vaporPath, inR - 0.006, { sides: 14, steps: 72, round: 1 }), color: 0xcfe2e8 });
  // A pale ring at the tip, which is where the eye looks for the drop.
  solid.push({ geometry: lathe(ringProfile(inR + 0.002, tip[1] + 0.006, 0.01, 5), { segments: 18 }).translate(tip[0], 0, tip[2]), color: GLASS_EDGE });

  // Condensate: a thread running along the bottom of the tube, beginning partway down the jacket and
  // thickening, and beads above it where the vapour first turns to liquid.
  const nDown = V(-Math.sin(L.slope), -Math.cos(L.slope), 0);
  const low = (s, k) => { const p = P(s); return [p[0] + nDown.x * k, p[1] + nDown.y * k, p[2]]; };
  const thread = [low(2.9, 0.05), low(3.6, 0.046), low(4.4, 0.042), low(L.sEnd, 0.04), (() => { const q = bendAt(0.4); return [q[0] - 0.012, q[1] - 0.034, q[2]]; })(), (() => { const q = bendAt(0.75); return [q[0] - 0.032, q[1] - 0.012, q[2]]; })(), [tip[0] - 0.03, tip[1] + 0.02, F.z]];
  solid.push({ geometry: tube(thread, [0.008, 0.013, 0.018, 0.021, 0.024, 0.024, 0.026], { sides: 8, steps: 44, round: 1 }), color: CLEAR });
  for (let i = 0; i < 12; i++) {
    const s = 1.6 + (i / 12) * 1.5 + rng() * 0.06;
    const k = 0.048 * (rng() > 0.5 ? 1 : 0.2 + rng() * 0.6);
    const q = low(s, k);
    const zo = (rng() - 0.5) * 0.06;
    solid.push({ geometry: ball(0.009 + (i / 12) * 0.012, [q[0], q[1], q[2] + zo], { detail: 8 }), color: CLEAR });
  }

  // Which way the vapour runs: small white chevrons on the tube's own axis.
  const axis = [P(0.2), P(1.2), P(2.2), P(3.2), P(4.2)];
  chevronsAlong(solid, axis, [0.08, 0.2, 0.42, 0.62], 0x6d7f8c, { r: 0.04, inner: 0.012, len: 0.11 });

  // --- The water jacket, a wider tube sealed onto the inner one at both ends. A lathe along +Y, carried
  // onto the slope. The water inside is opaque, drawn from its back faces, so the inner tube and the
  // chevrons stand out in front of it.
  const J = jacket;
  const jLen = J.s1 - J.s0;
  const jProfile = (R, inset) => {
    const neck = inR + 0.018;
    const shoulder = (t) => neck + (R - neck) * Math.sin(t * Math.PI * 0.5);
    const rows = [[0, inset], [neck, inset, 'c']];
    for (let i = 1; i <= 5; i++) rows.push([shoulder(i / 5), inset + 0.2 * (1 - Math.cos((i / 5) * Math.PI * 0.5))]);
    rows.push([R, jLen * 0.5]);
    for (let i = 5; i >= 1; i--) rows.push([shoulder(i / 5), jLen - inset - 0.2 * (1 - Math.cos((i / 5) * Math.PI * 0.5))]);
    rows.push([neck, jLen - inset, 'c'], [0, jLen - inset]);
    return rows;
  };
  const jStart = P(J.s0);
  glass.push({ geometry: aimed(lathe(jProfile(J.R, 0), { segments: 36 }), jStart, D), color: GLASS });
  back.push({ geometry: aimed(lathe(jProfile(J.R - 0.018, 0.008), { segments: 30 }), jStart, D), color: COOL });
  // Collars where the jacket seals on to the tube.
  for (const s of [J.s0, J.s1]) {
    const q = P(s);
    solid.push({ geometry: aimed(lathe([[0, -0.05], [inR + 0.02, -0.05, 'c'], [inR + 0.032, -0.03], [inR + 0.036, 0.02], [inR + 0.03, 0.05, 'c'], [0, 0.05]], { segments: 20 }), q, D), color: 0x6b2f22 });
  }
  // The flow inside the jacket: blue chevrons, pointing UP the slope, against the vapour.
  const jacketFlow = [];
  for (const s of [3.9, 3.1, 2.3]) {
    const q = P(s);
    jacketFlow.push({ geometry: aimedLathe([[0, 0], [0.056, 0, 'c'], [0.03, 0.12], [0, 0.135]], [q[0], q[1], q[2] + 0.15], D.clone().negate(), 14), color: 0x1461cc });
  }
  solid.push(...jacketFlow);

  // The two stubs, and the nozzle on each that a hose grips.
  const stubDir = { inlet: V(0, -0.5, -Math.sqrt(0.75)), outlet: V(0, 0.5, -Math.sqrt(0.75)) };
  const stubEnd = {};
  for (const key of ['inlet', 'outlet']) {
    const root = V(...P(stubs[key]));
    const dir = stubDir[key];
    const end = root.clone().addScaledVector(dir, stubs.len);
    stubEnd[key] = [end.x, end.y, end.z];
    glass.push({ geometry: rod(root.clone().addScaledVector(dir, 0.1), end, 0.058, { sides: 14 }), color: GLASS });
    // Water in the stub: a back-drawn core so the water visibly runs into it.
    back.push({ geometry: rod(root.clone().addScaledVector(dir, 0.12), end.clone().addScaledVector(dir, -0.01), 0.044, { sides: 12 }), color: COOL });
  }

  // --- Clamps. A ring round the neck and a ring round the jacket, each carried by an arm from a boss.
  const neckClampY = 4.2;
  boss(F.x, neckClampY, SZ, F.z - F.neckR - 0.04);
  solid.push({ geometry: lathe(ringProfile(F.neckR + 0.018, neckClampY, 0.018, 8, 1.8), { segments: 28 }).translate(F.x, 0, F.z), color: IRON });
  const jClampS = (0.02 - F.x) / Math.cos(L.slope);
  const jq = P(jClampS);
  boss(jq[0], jq[1], SZ, F.z - J.R - 0.04);
  solid.push({ geometry: aimed(lathe(ringProfile(J.R + 0.02, 0, 0.02, 8, 2.4), { segments: 40 }), jq, D), color: IRON });

  // --- The burner, the ring, the gauze.
  const gauzeY = F.y - F.R - 0.018;
  const ringY = gauzeY - 0.03;
  boss(F.x, ringY, SZ, F.z - 0.52);
  solid.push({ geometry: lathe(ringProfile(0.52, ringY, 0.028, 8), { segments: 44 }).translate(F.x, 0, F.z), color: IRON });
  const G = 0.6; const step = 0.06;
  for (let v = -G + step; v < G - 0.001; v += step) {
    solid.push({ geometry: rod([F.x - G, gauzeY, F.z + v], [F.x + G, gauzeY, F.z + v], 0.0065, { sides: 4, open: true }), color: 0x868b91 });
    solid.push({ geometry: rod([F.x + v, gauzeY + 0.005, F.z - G], [F.x + v, gauzeY + 0.005, F.z + G], 0.0065, { sides: 4, open: true }), color: 0x868b91 });
  }
  for (const [p, q] of [[[-G, -G], [G, -G]], [[G, -G], [G, G]], [[G, G], [-G, G]], [[-G, G], [-G, -G]]]) {
    solid.push({ geometry: tube([[F.x + p[0], gauzeY, F.z + p[1]], [F.x + q[0], gauzeY, F.z + q[1]]], 0.014, { straight: true, steps: 1, sides: 6, round: 1 }), color: 0x60656b });
  }
  solid.push({ geometry: lathe([[0, gauzeY - 0.006], [0.32, gauzeY - 0.006, 'c'], [0.34, gauzeY + 0.004], [0.32, gauzeY + 0.014, 'c'], [0, gauzeY + 0.014]], { segments: 34 }), color: 0xd9d4c6, position: [F.x, 0, F.z] });

  const barrelTop = T + 0.64;
  solid.push({
    geometry: lathe([[0, 0], [0.3, 0, 'c'], [0.3, 0.04], [0.22, 0.08], [0.09, 0.12], [0.075, 0.16], [0.075, 0.26], [0.09, 0.27, 'c'], [0.09, 0.36, 'c'], [0.07, 0.37], [0.066, 0.62], [0.056, 0.64, 'c'], [0, 0.64]], { segments: 26 }).translate(F.x, T, F.z),
    color: 0x8a8f96,
  });
  const hosePath = [[F.x - 0.2, T + 0.05, F.z], [F.x - 0.62, T + 0.045, F.z - 0.05], [F.x - 1.02, T + 0.045, F.z - 0.5], [F.x - 1.06, T + 0.07, F.z - 1.08], [F.x - 1.06, T + 0.24, F.z - 1.3]];
  solid.push({ geometry: tube(hosePath, 0.038, { sides: 10, steps: 30, round: 1 }), color: 0xcf5a1c });
  solid.push({ geometry: lathe([[0, 0], [0.09, 0, 'c'], [0.09, 0.03], [0.05, 0.06], [0.04, 0.3], [0.05, 0.31], [0.03, 0.34], [0, 0.34]], { segments: 14 }).translate(F.x - 1.06, T, F.z - 1.3), color: CHROME });

  // The flame: a clean inner cone, and a mantle drawn only from its back faces.
  const flameH = gauzeY - barrelTop - 0.005;
  const mantle = lathe([[0, 0], [0.05, 0], [0.074, 0.05], [0.09, 0.14], [0.086, flameH * 0.62], [0.06, flameH * 0.84], [0.032, flameH * 0.96], [0, flameH]], { segments: 26 }).translate(F.x, barrelTop, F.z);
  const FL_LOW = lin(0x1438ff); const FL_HIGH = lin(0x54a4ff);
  tintVertices(mantle, (x, y, z, out) => {
    const t = clamp01((y - barrelTop) / flameH);
    out[0] = mix(FL_LOW[0], FL_HIGH[0], t); out[1] = mix(FL_LOW[1], FL_HIGH[1], t); out[2] = mix(FL_LOW[2], FL_HIGH[2], t);
  });
  back.push({ geometry: mantle, keepColor: true });
  const core = lathe([[0, 0], [0.046, 0], [0.05, 0.03], [0.036, flameH * 0.32], [0.016, flameH * 0.54], [0, flameH * 0.62]], { segments: 20 }).translate(F.x, barrelTop, F.z);
  const CORE_LOW = lin(0x4fe0ff); const CORE_HIGH = lin(0xd8fbff);
  tintVertices(core, (x, y, z, out) => {
    const t = clamp01((y - barrelTop) / (flameH * 0.62));
    out[0] = mix(CORE_LOW[0], CORE_HIGH[0], t); out[1] = mix(CORE_LOW[1], CORE_HIGH[1], t); out[2] = mix(CORE_LOW[2], CORE_HIGH[2], t);
  });
  front.push({ geometry: core, keepColor: true });

  // --- The receiving flask, with a level of clear water, a ripple under the drip, and the drops.
  const RX = receiver.x;
  const RZ = F.z;
  const RH = 1.02;
  const R0 = 0.52; const NECK = 0.14;
  const rAt = (y) => (y < 0.8 ? mix(R0, NECK, y / 0.8) : NECK);
  glass.push({
    geometry: lathe([[0, 0], [R0 - 0.02, 0], [R0, 0.02], [mix(R0, NECK, 0.5), 0.4], [NECK + 0.01, 0.78], [NECK, 0.84], [NECK, RH - 0.03], [NECK + 0.02, RH - 0.006], [NECK + 0.012, RH], [NECK - 0.012, RH], [NECK - 0.014, 0.84], [NECK - 0.006, 0.8], [mix(R0, NECK, 0.5) - 0.016, 0.4], [R0 - 0.022, 0.03], [0, 0.024]], { segments: 44 }).translate(RX, T, RZ),
    color: GLASS,
  });
  solid.push({ geometry: lathe(ringProfile(NECK + 0.008, RH - 0.004, 0.012, 5), { segments: 24 }).translate(RX, T, RZ), color: GLASS_EDGE });
  const wl = receiver.level;
  const rw = rAt(wl) - 0.022;
  // Drawn as the boiling flask is: the far half of the body, and a flat surface the eye can land on.
  const waterGeo = lathe([[0, 0.03], [R0 - 0.03, 0.03, 'c'], [rw, wl, 'c'], [0, wl]], { segments: 44 }).translate(RX, T, RZ);
  const W0 = lin(0x8fcfec); const W1 = lin(CLEAR);
  tintVertices(waterGeo, (x, y, z, out) => {
    const k = clamp01((y - T) / wl);
    out[0] = mix(W0[0], W1[0], k); out[1] = mix(W0[1], W1[1], k); out[2] = mix(W0[2], W1[2], k);
  });
  back.push({ geometry: waterGeo, keepColor: true });
  front.push({ geometry: lathe([[0, wl - 0.008], [rw, wl - 0.008, 'c'], [rw, wl, 'c'], [0, wl - 0.002]], { segments: 44 }).translate(RX, T, RZ), color: 0xd4f0fa });
  solid.push({ geometry: lathe(ringProfile(0.09, wl + 0.002, 0.006, 5), { segments: 22 }).translate(RX, T, RZ), color: 0xe6f6fb });
  solid.push({ geometry: lathe(ringProfile(0.17, wl + 0.002, 0.005, 5), { segments: 26 }).translate(RX, T, RZ), color: 0xdcf1f8 });

  // A falling drop covers a distance that grows as the square of its time, so drops released at a steady
  // rate are spaced 1 : 3 : 5 apart, not evenly. The first is still swelling on the tip.
  const dropAt = (k) => tip[1] - 0.06 - 0.1 * k * k;
  const drops = [0, 1, 2, 3].map(dropAt);
  if (drops[3] <= T + wl) throw new Error('still: a drop is below the water');
  for (const y of drops) {
    const g = lathe(smoothProfile([[0, -0.045], [0.022, -0.038], [0.03, -0.018], [0.022, 0.012], [0.008, 0.04], [0, 0.056]], 12), { segments: 14 });
    solid.push({ geometry: g.translate(tip[0], y, tip[2]), color: 0x9fdcf5 });
  }

  // --- The tap, on a pipe at the back of the bench, and the sink beside it.
  const TX = 1.55; const TZ = -1.1;
  solid.push({ geometry: lathe([[0, 0], [0.15, 0, 'c'], [0.15, 0.03], [0.07, 0.06], [0.06, 0.1], [0, 0.1]], { segments: 20 }).translate(TX, T, TZ), color: CHROME });
  const spoutPath = [[TX, T + 0.06, TZ], [TX, T + 1.5, TZ], [TX, T + 1.82, TZ + 0.02], [TX, T + 1.86, TZ + 0.24], [TX, T + 1.62, TZ + 0.38]];
  solid.push({ geometry: tube(spoutPath, 0.052, { sides: 14, steps: 36, round: 1 }), color: CHROME });
  // A serrated nozzle the hose pushes on to.
  const nozzleTop = spoutPath[4];
  const nozzleDir = V(0, -1, 0);
  solid.push({ geometry: aimedLathe([[0, 0], [0.05, 0, 'c'], [0.05, 0.04], [0.036, 0.05], [0.042, 0.09], [0.034, 0.1], [0.04, 0.14], [0.032, 0.16], [0, 0.16]], nozzleTop, nozzleDir, 14), color: CHROME });
  // The valve and its cross handle, on the pipe.
  const hY = T + 1.3;
  solid.push({ geometry: lathe([[0, -0.1], [0.075, -0.1], [0.085, -0.04], [0.085, 0.04], [0.075, 0.1], [0, 0.1]], { segments: 16 }).translate(TX, hY, TZ), color: CHROME });
  solid.push({ geometry: rod([TX, hY, TZ], [TX, hY, TZ + 0.2], 0.022, { sides: 10 }), color: CHROME });
  solid.push({ geometry: tube([[TX - 0.13, hY, TZ + 0.2], [TX + 0.13, hY, TZ + 0.2]], 0.022, { straight: true, steps: 1, sides: 10, round: 2 }), color: 0x1461cc });
  solid.push({ geometry: tube([[TX, hY - 0.13, TZ + 0.2], [TX, hY + 0.13, TZ + 0.2]], 0.022, { straight: true, steps: 1, sides: 10, round: 2 }), color: 0x1461cc });

  const HOSE = 0xd9a86a;
  const inletEnd = stubEnd.inlet;
  const iOut = V(...inletEnd).addScaledVector(stubDir.inlet, 0.24);
  // Each hose runs up over its stub by a quarter of a foot, the way a hose grips a nozzle.
  const iGrip = V(...inletEnd).addScaledVector(stubDir.inlet, -0.24);
  const inletHose = [[nozzleTop[0], nozzleTop[1] - 0.05, nozzleTop[2]], [TX, T + 1.22, TZ + 0.4], [TX - 0.1, T + 1.02, TZ + 0.42], [TX - 0.32, T + 1.16, TZ + 0.46], [iOut.x, iOut.y, iOut.z], [inletEnd[0], inletEnd[1], inletEnd[2]], [iGrip.x, iGrip.y, iGrip.z]];
  solid.push({ geometry: tube(inletHose, 0.07, { sides: 14, steps: 48, round: 0 }), color: HOSE });
  chevronsAlong(solid, inletHose, [0.16, 0.34, 0.62], 0x1461cc);
  const SX = -1.38; const SZ2 = -1.0;
  const oEnd = stubEnd.outlet;
  const oOut = V(...oEnd).addScaledVector(stubDir.outlet, 0.24);
  const sinkMouthY = T + 0.84;
  const oGrip = V(...oEnd).addScaledVector(stubDir.outlet, -0.24);
  const outletHose = [[oGrip.x, oGrip.y, oGrip.z], [oEnd[0], oEnd[1], oEnd[2]], [oOut.x, oOut.y, oOut.z], [oOut.x, oOut.y - 0.1, oOut.z - 0.28], [SX + 0.03, T + 2.3, SZ2], [SX, T + 1.4, SZ2], [SX, sinkMouthY, SZ2]];
  solid.push({ geometry: tube(outletHose, 0.07, { sides: 14, steps: 48, round: 0 }), color: HOSE });
  chevronsAlong(solid, outletHose, [0.5, 0.68, 0.86], 0xd2541a);

  // The sink: a bowl standing on the bench. The water leaves the hose and falls into it.
  solid.push({
    geometry: lathe([[0, 0], [0.44, 0, 'c'], [0.5, 0.05], [0.57, 0.46], [0.6, 0.5, 'c'], [0.58, 0.53], [0.53, 0.52, 'c'], [0.46, 0.2], [0.36, 0.1], [0.12, 0.07], [0.1, 0.05, 'c'], [0, 0.05]], { segments: 40 }).translate(SX, T, SZ2),
    color: 0xb8bec5,
  });
  solid.push({ geometry: lathe([[0, 0], [0.3, 0, 'c'], [0.3, 0.012], [0, 0.014]], { segments: 26 }).translate(SX, T + 0.1, SZ2), color: 0x9fd5ef });
  solid.push({ geometry: tube([[SX, sinkMouthY + 0.02, SZ2], [SX, T + 0.1, SZ2]], [0.024, 0.016], { straight: true, steps: 2, sides: 8, round: 1 }), color: 0x9fd5ef });

  // --- Name plates, raked on the bench.
  const benchPlate = (key, x, z, w = 1.1) => {
    const rake = 0.6;
    const h = w * (84 / 310);
    printed.push({ geometry: placed(plateBox(w, h, 0.03, rects[key]), [x, T + (h / 2) * Math.cos(rake) + 0.008, z], rake), color: 0xffffff });
  };
  benchPlate('in', 1.02, -0.32);
  benchPlate('out', SX + 0.1, -0.2);
  // The three names hang on the bench's front edge, where they cannot hide anything.
  const edgePlate = (key, x) => printed.push({ geometry: plateBox(1.5, 0.38, 0.03, rects[key]).translate(x, T - 0.2, BZ + 0.018), color: 0xffffff });
  edgePlate('salt', F.x);
  edgePlate('cond', 0);
  edgePlate('pure', RX);

  return group(
    woodMesh(wood, grainMaps({ seed: 919 })),
    solidMesh(solid, { roughness: 0.34, metalness: 0.08 }),
    printedMesh(printed, atlas),
    glassMesh(glass, { opacity: 0.2, roughness: 0.05 }),
    unlitMesh(front),
    unlitMesh(back, { side: THREE.BackSide }),
  );
}

export const BUILDERS = {
  'electron-orbitals': electronOrbitals,
  'states-of-matter': statesOfMatter,
  'ph-scale': phScale,
  'voltaic-pile': voltaicPile,
  'distillation-still': distillationStill,
};

export const CHEM_LAYOUTS = {
  orbitals: { shapes: orbitalLayout, lobe: orbitalLobe, clover: cloverLobe, ring: dz2Ring, modelToChem, chemToModel },
  states: { layout: statesLayout, packLiquid, minSeparation, constants: SM },
  ph: { layout: phLayout, phX },
  pile: { layout: pileLayout },
  still: { layout: stillLayout, stillP },
};
