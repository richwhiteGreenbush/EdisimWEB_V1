import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '../../PropKit.js';
import {
  extrudeOutline, revolve, gearOutline, mergeParts, outlineArea, smoothNoise3,
} from '../../props/LoftKit.js';
import {
  tube, lathe, lin, clamp01, mix, sstep, outward, alongMatrix, tintVertices,
} from '../ModelKit.js';

// The Model Database's third batch of heritage objects, all read from six feet.
//
//   typewriter     a c.1900s upright desk machine, four times life, keys toward +Z.
//   wind-turbine   a utility turbine at TRUE size; the catalogue shows it at 0.1.
//   water-mill     a stone mill with its front wall open and its gear train computed and meshed.
//   roman-chariot  a racing chariot of wood and leather, life size, pole along +Z.
//   ming-vase      a blue and white meiping, four times life, painted per texel.
//
// Feet at scale 1, origin at the base centre, fresh materials per build, seededRandom only.

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const vec = (p) => new THREE.Vector3(p[0], p[1], p[2]);

function dropDegenerate(g) {
  const pos = g.attributes.position;
  const old = g.index.array;
  const keep = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < old.length; i += 3) {
    a.fromBufferAttribute(pos, old[i]);
    b.fromBufferAttribute(pos, old[i + 1]);
    c.fromBufferAttribute(pos, old[i + 2]);
    if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-16) keep.push(old[i], old[i + 1], old[i + 2]);
  }
  g.setIndex(keep);
  return g;
}

// A surface of revolution about +Y from `[r, y]` or `[r, y, 'h']` points, either a closed loop or a
// run from axis to axis. Its direction is measured, because `revolve` takes its winding from it.
function spin(points, { segments = 24, closed = false } = {}) {
  const flat = points.map((p) => [p[0], p[1]]);
  const pts = outlineArea(flat) > 0 ? [...points].reverse() : points;
  const list = closed ? [...pts, pts[0]] : pts;
  const out = [];
  for (const p of list) {
    out.push([p[0], p[1]]);
    if (p[2]) out.push([p[0], p[1]]);
  }
  return outward(dropDegenerate(revolve(out, { segments })));
}

const onZ = (g) => g.rotateX(Math.PI / 2); // a lathe's +Y becomes +Z
const onX = (g, s = 1) => g.rotateZ(-s * Math.PI / 2); // a lathe's +Y becomes s * +X

// A closed ring of round section about +Y.
function ringGeo(R, r, { segments = 48, sides = 10, y = 0, flat = 1 } = {}) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push([R + Math.cos(a) * r, y + Math.sin(a) * r * flat]);
  }
  return spin(pts, { segments, closed: true });
}

// Geometry authored along +Y, centred on the origin, carried to lie from a to b.
function alongY(geometry, a, b) {
  const A = vec(a);
  const B = vec(b);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  return geometry.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

function rod(list, color, a, b, r, { sides = 10, r2 = null } = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  list.push({ geometry: alongY(new THREE.CylinderGeometry(r2 ?? r, r, len, sides), a, b), color });
}

function pipe(list, color, points, r, { sides = 8, steps = null, round = 2, section = null, frame = null } = {}) {
  list.push({ geometry: tube(points, r, { sides, steps: steps ?? (points.length - 1) * 5, round, section, frame }), color });
}

function block(list, color, w, h, d, pos, rot = null) {
  list.push({ geometry: new THREE.BoxGeometry(w, h, d), color, position: pos, rotation: rot });
}

function dot(list, color, r, pos, { sides = 8, flat = null, up = null } = {}) {
  const g = new THREE.SphereGeometry(r, sides, Math.max(3, sides >> 1));
  if (flat) g.scale(1, flat, 1);
  if (up) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, vec(up).normalize()));
  list.push({ geometry: g, color, position: pos });
}

// A squared bar from a to b, `w` across and `h` along `up`. Its UVs run in tile units with the
// grain along the length, so one tall canvas serves every timber in a model.
function beamGeo(len, w, h, { chamfer = 0, tile = [1, 2], rng = null } = {}) {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.min(chamfer, hw * 0.9, hh * 0.9);
  const outline = c > 0
    ? [[hw, -hh + c], [hw, hh - c], [hw - c, hh], [-hw + c, hh], [-hw, hh - c], [-hw, -hh + c], [-hw + c, -hh], [hw - c, -hh]]
    : [[hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]];
  const u0 = rng ? rng() : 0;
  const v0 = rng ? rng() : 0;
  const pos = [];
  const nor = [];
  const uvs = [];
  const tri = (a, b, cc, n, uvA, uvB, uvC) => {
    pos.push(...a, ...b, ...cc);
    nor.push(...n, ...n, ...n);
    uvs.push(...uvA, ...uvB, ...uvC);
  };
  const z0 = -len / 2;
  const z1 = len / 2;
  let run = u0 * tile[0];
  for (let i = 0; i < outline.length; i++) {
    const [ax, ay] = outline[i];
    const [bx, by] = outline[(i + 1) % outline.length];
    const seg = Math.hypot(bx - ax, by - ay);
    const n = [(by - ay) / seg, -(bx - ax) / seg, 0];
    const ua = run / tile[0];
    const ub = (run + seg) / tile[0];
    const va = v0 + z0 / tile[1];
    const vb = v0 + z1 / tile[1];
    tri([ax, ay, z0], [bx, by, z0], [bx, by, z1], n, [ua, va], [ub, va], [ub, vb]);
    tri([ax, ay, z0], [bx, by, z1], [ax, ay, z1], n, [ua, va], [ub, vb], [ua, vb]);
    run += seg;
  }
  for (let i = 1; i < outline.length - 1; i++) {
    const [ax, ay] = outline[0];
    const [bx, by] = outline[i];
    const [cx, cy] = outline[i + 1];
    const uv = (x, y) => [u0 + x / tile[0], v0 + y / (tile[0] * 3)];
    tri([ax, ay, z1], [bx, by, z1], [cx, cy, z1], [0, 0, 1], uv(ax, ay), uv(bx, by), uv(cx, cy));
    tri([ax, ay, z0], [cx, cy, z0], [bx, by, z0], [0, 0, -1], uv(ax, ay), uv(cx, cy), uv(bx, by));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

function fromTo(geometry, a, b, up = null) {
  const A = vec(a);
  const B = vec(b);
  const z = B.clone().sub(A).normalize();
  let ref = up ? vec(up).normalize() : Y_AXIS.clone();
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  return geometry.applyMatrix4(m);
}

function bar(list, color, a, b, w, h, opts = {}) {
  const len = vec(a).distanceTo(vec(b));
  if (len < 1e-4) return;
  list.push({ geometry: fromTo(beamGeo(len, w, h, opts), a, b, opts.up), color });
}

// Soft enamel-like edges from a THREE.Shape, with holes. Extruded along +Z from -depth/2.
function shapeSolid(shape, depth, { bevel = 0, curve = 16, crease = 38 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, curveSegments: curve, steps: 1,
    bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 2,
  });
  g.translate(0, 0, -depth / 2 + bevel);
  return toCreasedNormals(g, (crease * Math.PI) / 180);
}

// A near-white tile of long streaks, used as BOTH map and bump. A map multiplies the vertex colour,
// so one canvas serves every wood in a model.
function grainMaps({ seed = 3, knots = 3, strength = 0.5, width = 256, height = 512, streaks = 150 } = {}) {
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
    const shade = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgba(${shade},${shade - 8},${shade - 18},0.42)`;
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
  for (let i = 0; i < knots; i++) {
    const x = 40 + rng() * (width - 80);
    const y = 50 + rng() * (height - 100);
    for (let r = 10; r > 2; r -= 2.4) {
      const dark = 165 + (13 - r) * -2;
      ctx.strokeStyle = `rgba(${dark},${dark - 22},${dark - 44},0.32)`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.62, r * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: strength };
}

function texOf(canvas, space, wrap = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = space;
  if (wrap) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// Polish without an environment map: what the sky would have reflected goes into the vertex colours.
// `add` is the sky seen in a glossy black surface, `band` a soft horizon highlight on upright faces.
function sheen(geometry, { add = 0, tint = [0.86, 0.93, 1], gain = 0, band = 0, bandY = 3, bandW = 0.4 } = {}) {
  const P = geometry.attributes.position;
  const N = geometry.attributes.normal;
  const C = geometry.attributes.color;
  for (let i = 0; i < P.count; i++) {
    const ny = N.getY(i);
    const sky = 0.5 + 0.5 * ny;
    const s = sky * sky * sky;
    let lift = s * add;
    if (band) {
      const d = (P.getY(i) - bandY) / bandW;
      lift += Math.exp(-d * d) * (1 - Math.abs(ny)) * band;
    }
    const k = 1 + gain * (s - 0.3);
    C.setXYZ(i, C.getX(i) * k + lift * tint[0], C.getY(i) * k + lift * tint[1], C.getZ(i) * k + lift * tint[2]);
  }
  return geometry;
}

function meshFrom(geometry, params, { shadow = true } = {}) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, ...params }));
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function groupOf(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) if (m) g.add(m);
  return g;
}

// A fine line through a polygon's corners: rounded by corner cutting, then swept through dense points
// so a spline has nothing to overshoot with. Painted lining must not loop out past its corners.
function fineLine(list, color, points, r, { closed = false, passes = 3, sides = 5 } = {}) {
  let pts = points.map((p) => [...p]);
  if (closed) pts.push([...points[0]]);
  // Each long run is first cut into short ones, or corner cutting moves the straight parts as well.
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]; const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(vec(a).distanceTo(vec(b)) / 0.14));
    for (let k = 0; k < n; k++) dense.push([mix(a[0], b[0], k / n), mix(a[1], b[1], k / n), mix(a[2], b[2], k / n)]);
  }
  dense.push(pts[pts.length - 1]);
  pts = dense;
  for (let p = 0; p < passes; p++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]; const b = pts[i + 1];
      out.push([mix(a[0], b[0], 0.25), mix(a[1], b[1], 0.25), mix(a[2], b[2], 0.25)]);
      out.push([mix(a[0], b[0], 0.75), mix(a[1], b[1], 0.75), mix(a[2], b[2], 0.75)]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  // Thin the list back out: a line this fine does not need the triangles.
  const thin = pts.filter((_, i) => i % 4 === 0 || i === pts.length - 1);
  list.push({ geometry: tube(thin, r, { sides, steps: Math.min(160, thin.length - 1), round: 1 }), color });
}

function fitFont(ctx, text, maxWidth, start, family) {
  let size = start;
  ctx.font = `${family.replace('$', size)}`;
  while (ctx.measureText(text).width > maxWidth && size > 6) {
    size -= 1;
    ctx.font = `${family.replace('$', size)}`;
  }
  return size;
}

// A lathe with a real seam: the first column is repeated at u = 1, so a painting wraps once round
// with no backward strip, which `revolve` has. Rows run bottom-up. `start` is where u = 0 faces.
// `uvOf(i, r, y)` gives v for a row.
function latheUV(profile, segments, { start = Math.PI, vOf = null } = {}) {
  const rows = profile.length;
  const cols = segments + 1;
  const pos = [];
  const uv = [];
  const index = [];
  for (let c = 0; c < cols; c++) {
    const a = start + (c / segments) * Math.PI * 2;
    for (let i = 0; i < rows; i++) {
      const [r, y] = profile[i];
      pos.push(Math.sin(a) * r, y, Math.cos(a) * r);
      uv.push(c / segments, vOf ? vOf(i, r, y) : i / (rows - 1));
    }
  }
  for (let c = 0; c < segments; c++) {
    for (let i = 0; i < rows - 1; i++) {
      const p = c * rows + i; const q = c * rows + i + 1;
      const s = (c + 1) * rows + i + 1; const t = (c + 1) * rows + i;
      if (profile[i][0] > 1e-5) index.push(p, t, s);
      if (profile[i + 1][0] > 1e-5) index.push(p, s, q);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  // The two copies of the seam column were computed apart: weld their normals.
  const N = g.attributes.normal;
  for (let i = 0; i < rows; i++) {
    const a = i; const b = segments * rows + i;
    const n = new THREE.Vector3(N.getX(a) + N.getX(b), N.getY(a) + N.getY(b), N.getZ(a) + N.getZ(b)).normalize();
    N.setXYZ(a, n.x, n.y, n.z);
    N.setXYZ(b, n.x, n.y, n.z);
  }
  return g;
}

// Smooth points through a list of [r, y], by arc length.
function smoothPoly(points, n) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'centripetal');
  return curve.getSpacedPoints(n).map((p) => [Math.max(0, p.x), p.y]);
}

// ---------------------------------------------------------------------------
// Ming vase: a meiping, painted per texel in a floating-point ink buffer
// ---------------------------------------------------------------------------
//
// Every mark is laid into `ink`, one float per texel with u wrapping, so a dab that runs off the
// right edge comes back on the left and there can be no seam. Only when the whole jar is drawn is
// ink turned into colour, and that last step is where cobalt's character lives: the tone pools and
// speckles dark where the brush lay heavy, the Yongle "heaped and piled" look.

class InkSheet {
  constructor(W, H, seed) {
    this.W = W;
    this.H = H;
    this.ink = new Float32Array(W * H);
    this.rng = seededRandom(seed);
  }

  wrapX(x) { return ((x % this.W) + this.W) % this.W; }

  // A soft round dab. mode 'ink' keeps the darker; 'erase' lifts toward white, for reserved highlights.
  dab(x, y, r, value = 1, erase = false) {
    const { W, H, ink } = this;
    const R = r + 1;
    const y0 = Math.max(0, Math.floor(y - R));
    const y1 = Math.min(H - 1, Math.ceil(y + R));
    const x0 = Math.floor(x - R);
    const x1 = Math.ceil(x + R);
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const ddx = px - x; const ddy = py - y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy);
        const a = clamp01(r + 0.7 - d);
        if (a <= 0) continue;
        const i = py * W + this.wrapX(px);
        if (erase) ink[i] = Math.min(ink[i], value + (1 - a) * (ink[i] - value));
        else { const v = value * a; if (v > ink[i]) ink[i] = v; }
      }
    }
  }

  // A brush stroke through points: pressure swells and tails off, and the tone wanders.
  stroke(points, r0, r1 = r0, { value = 0.95, swell = 0.25, wobble = 0, erase = false, closed = false } = {}) {
    const pts = points.map((p) => new THREE.Vector3(p[0], p[1], 0));
    const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
    const len = curve.getLength();
    const n = Math.max(4, Math.ceil(len / Math.max(0.8, Math.min(r0, r1) * 0.5 + 0.5)));
    const ph = this.rng() * 6.28;
    const tone = this.rng() * 6.28;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPoint(t);
      const w = mix(r0, r1, t) * (1 + swell * Math.sin(t * 7 + ph) * 0.5);
      const off = wobble ? Math.sin(t * 23 + ph) * wobble : 0;
      this.dab(p.x, p.y + off, Math.max(0.5, w), erase ? value : value * (0.9 + 0.1 * Math.sin(t * 11 + tone)), erase);
    }
  }

  // A filled polygon, scanned row by row and wrapped.
  fill(points, value = 0.55, erase = false) {
    const { W, H, ink } = this;
    let top = 1e9;
    let bot = -1e9;
    for (const p of points) { top = Math.min(top, p[1]); bot = Math.max(bot, p[1]); }
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(H - 1, Math.ceil(bot));
    const n = points.length;
    for (let py = y0; py <= y1; py++) {
      const xs = [];
      for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        if ((a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py)) {
          xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let px = Math.ceil(xs[k]); px <= Math.floor(xs[k + 1]); px++) {
          const i = py * W + this.wrapX(px);
          if (erase) ink[i] = Math.min(ink[i], value);
          else if (value > ink[i]) ink[i] = value;
        }
      }
    }
  }

  // A horizontal line right round the jar, a little uneven as a hand on a wheel is.
  ring(y, r, value = 0.95) {
    const ph = this.rng() * 6.28;
    for (let x = 0; x < this.W; x += 1.2) {
      const t = (x / this.W) * Math.PI * 2;
      this.dab(x, y + Math.sin(t * 3 + ph) * 0.5, r * (1 + 0.14 * Math.sin(t * 5 + ph)), value * (0.92 + 0.08 * Math.sin(t * 9 + ph)));
    }
  }
}

// A smooth tile: white noise blurred with wrap in both axes. Nothing is read back from a canvas.
function noiseTile(size, passes, radius, seed) {
  const rng = seededRandom(seed);
  let a = new Float32Array(size * size);
  for (let i = 0; i < a.length; i++) a[i] = rng();
  const b = new Float32Array(size * size);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < size; y++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += a[y * size + ((k + size) % size)];
      for (let x = 0; x < size; x++) {
        b[y * size + x] = sum / (radius * 2 + 1);
        sum += a[y * size + (x + radius + 1) % size] - a[y * size + (x - radius + size) % size];
      }
    }
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += b[((k + size) % size) * size + x];
      for (let y = 0; y < size; y++) {
        a[y * size + x] = sum / (radius * 2 + 1);
        sum += b[((y + radius + 1) % size) * size + x] - b[((y - radius + size) % size) * size + x];
      }
    }
  }
  let lo = 1e9;
  let hi = -1e9;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const out = new Float32Array(size * size);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - lo) / (hi - lo);
  a = null;
  return out;
}

const COBALT = [
  [0.00, [240, 244, 241]],
  [0.22, [176, 200, 226]],
  [0.48, [70, 112, 186]],
  [0.72, [30, 62, 150]],
  [0.90, [18, 36, 108]],
  [1.15, [10, 20, 66]],
];

// The dragon's body: every texel near the spine learns how far along and how far across it lies,
// so scales are a pattern in the body's own coordinates and follow every coil.
function drawDragon(sheet, spine, hwAt, { bodyWash = 0.5, scaleS = 15, faceRight = true } = {}) {
  const { W, H } = sheet;
  const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.ceil(len / 1.2);
  const samples = curve.getSpacedPoints(n);
  // Tail to head: s runs from 0 at the tail.
  const tangents = samples.map((p, i) => samples[Math.min(n, i + 1)].clone().sub(samples[Math.max(0, i - 1)]).normalize());
  const dist = new Map();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const hw = hwAt(t);
    const c = samples[i];
    const T = tangents[i];
    const R = hw + 2;
    for (let py = Math.max(0, Math.floor(c.y - R)); py <= Math.min(H - 1, Math.ceil(c.y + R)); py++) {
      for (let px = Math.floor(c.x - R); px <= Math.ceil(c.x + R); px++) {
        const dx = px - c.x; const dy = py - c.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > R) continue;
        const key = py * W + sheet.wrapX(px);
        const old = dist.get(key);
        const q = d / hw;
        if (!old || q < old.q) {
          // The signed side: + is the dorsal side, which is to the left of travel in canvas space.
          const side = T.x * dy - T.y * dx;
          dist.set(key, { q, s: (t * len), tau: (side >= 0 ? 1 : -1) * q, hw, t });
        }
      }
    }
  }
  const { ink } = sheet;
  for (const [key, v] of dist) {
    if (v.q > 1.12) continue;
    let tone;
    if (v.q > 0.9) tone = 1.05; // the drawn outline
    else if (v.tau < -0.5) {
      // Belly: paler, ruled across in plates.
      const b = Math.abs(((v.s / (scaleS * 0.75)) % 1 + 1) % 1 - 0.5);
      tone = b < 0.09 ? 0.9 : 0.14;
    } else {
      // Scales: one crescent in a staggered brick of cells across and along the body.
      const across = (v.tau + 0.5) / 1.4 * Math.max(3, Math.round((v.hw * 1.4) / (scaleS * 0.72)));
      const row = Math.floor(across);
      const aF = across - row;
      const along = v.s / scaleS + (row % 2 ? 0.5 : 0);
      const aS = along - Math.floor(along);
      const dx = aS - 0.15;
      const dy = (aF - 0.5) * 1.05;
      const r = Math.hypot(dx, dy);
      tone = r > 0.5 && r < 0.68 ? 1.0 : bodyWash + 0.28 * clamp01(1 - r);
    }
    if (tone > ink[key] || v.q < 0.9) ink[key] = tone;
  }
  return { curve, samples, tangents, n, len, faceRight };
}

// Spines of flame along the dorsal edge, leaning back toward the tail.
function dorsalFins(sheet, d, hwAt, { every = 26, tall = 1.0 } = {}) {
  const { samples, tangents, n, len } = d;
  const step = Math.max(2, Math.round((every / len) * n));
  for (let i = Math.round(n * 0.06); i < n * 0.86; i += step) {
    const t = i / n;
    const hw = hwAt(t);
    const c = samples[i];
    const T = tangents[i];
    const N = [-T.y, T.x];
    const nx = N[0]; const ny = N[1];
    const h = hw * 0.75 * tall + 6;
    const a = [c.x + nx * hw * 0.95 + T.x * 9, c.y + ny * hw * 0.95 + T.y * 9];
    const b = [c.x + nx * hw * 0.95 - T.x * 9, c.y + ny * hw * 0.95 - T.y * 9];
    const tip = [c.x + nx * (hw + h) - T.x * 13, c.y + ny * (hw + h) - T.y * 13];
    sheet.fill([a, tip, b], 0.62);
    sheet.stroke([a, [mix(a[0], tip[0], 0.6) + T.x * 1.5, mix(a[1], tip[1], 0.6)], tip], 1.3, 0.7);
    sheet.stroke([b, tip], 1.1, 0.6);
  }
}

// A leg: a tapered limb from the body, a tuft of flame at the elbow and three curved claws.
function dragonLeg(sheet, hip, knee, foot, r, flip) {
  sheet.fill(ribbonPoly([hip, knee, foot], r * 1.05, r * 0.55), 0.52);
  sheet.stroke([hip, knee, foot].map(([x, y], i) => [x + (i === 1 ? r * 0.2 : 0), y]), 1.5, 1.2);
  const ribbon = ribbonPoly([hip, knee, foot], r * 1.05, r * 0.55);
  sheet.stroke(ribbon.slice(0, ribbon.length >> 1), 1.7, 1.2);
  sheet.stroke(ribbon.slice(ribbon.length >> 1), 1.2, 1.7);
  // Flame tufts trailing from the elbow.
  const back = [knee[0] - (foot[0] - hip[0]) * 0.12, knee[1] - (foot[1] - hip[1]) * 0.12];
  for (let k = -1; k <= 1; k++) {
    sheet.stroke([knee, [back[0] + k * r * 0.5, back[1] + k * r * 0.45], [back[0] + k * r * 1.6 - flip * r * 0.8, back[1] + k * r * 1.1]], r * 0.3, 0.6, { value: 0.9 });
  }
  // Three claws, spread and hooked. Deliberately three: the five-clawed dragon was reserved to the emperor.
  const dirA = Math.atan2(foot[1] - knee[1], foot[0] - knee[0]);
  for (let c = -1; c <= 1; c++) {
    const a = dirA + c * 0.72;
    const p1 = [foot[0] + Math.cos(a) * r * 1.1, foot[1] + Math.sin(a) * r * 1.1];
    const p2 = [p1[0] + Math.cos(a + flip * 0.9) * r * 1.0, p1[1] + Math.sin(a + flip * 0.9) * r * 1.0];
    sheet.stroke([foot, p1, p2], r * 0.42, 0.7, { value: 1.05 });
  }
  sheet.dab(foot[0], foot[1], r * 0.55, 0.9);
}

function ribbonPoly(pts, r0, r1) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'centripetal');
  const n = 14;
  const left = [];
  const right = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = curve.getPoint(t);
    const T = curve.getTangent(t);
    const r = mix(r0, r1, t);
    left.push([c.x - T.y * r, c.y + T.x * r]);
    right.unshift([c.x + T.y * r, c.y - T.x * r]);
  }
  return [...left, ...right];
}

// The head, drawn looking along +x (dir = 1) or -x (dir = -1) and rotated by `rot`. The unit is `s`
// canvas pixels, about the length of the snout.
function dragonHead(sheet, cx, cy, s, dir, rot) {
  const P = (x, y) => {
    const X = x * dir * s;
    const Y = y * s;
    const c = Math.cos(rot); const n = Math.sin(rot);
    return [cx + X * c - Y * n, cy + X * n + Y * c];
  };
  const poly = (list, v = 0.5) => sheet.fill(list.map(([x, y]) => P(x, y)), v);
  const line = (list, r0, r1 = r0, opts = {}) => sheet.stroke(list.map(([x, y]) => P(x, y)), r0, r1, opts);
  // Canvas y grows downward, so "up" on the jar is negative y here.
  // Mane: long locks streaming back from the crown, behind everything else.
  for (let k = 0; k < 8; k++) {
    const q = k / 7;
    const y0 = mix(-0.5, 0.45, q);
    const sway = (k % 2 ? 1 : -1) * 0.14;
    line([[-0.35, y0], [-1.0, y0 - 0.25 + sway], [-1.75, y0 - 0.12 - sway + q * 0.25], [-2.5 - (k % 3) * 0.26, y0 - 0.46 + sway + q * 0.6]], s * 0.078, 0.8, { value: 0.92, swell: 0.4 });
  }
  // The skull and upper jaw, ending in the upturned nose scroll.
  const upper = [
    [-0.55, -0.45], [-0.2, -0.62], [0.2, -0.5], [0.52, -0.3], [0.86, -0.32], [1.2, -0.52], [1.42, -0.42], [1.36, -0.16],
    [1.06, -0.02], [0.62, 0.03], [0.2, 0.08], [-0.2, 0.25], [-0.55, 0.2],
  ];
  poly(upper, 0.42);
  line([...upper, upper[0]], s * 0.032, s * 0.032, { value: 1.05 });
  // Lower jaw, dropped open.
  const lower = [[-0.25, 0.26], [0.2, 0.32], [0.7, 0.38], [1.02, 0.5], [0.92, 0.66], [0.45, 0.68], [0.0, 0.6], [-0.42, 0.42]];
  poly(lower, 0.42);
  line([...lower, lower[0]], s * 0.03, s * 0.03, { value: 1.05 });
  // The mouth's inside, then the teeth reserved in white against it.
  poly([[-0.12, 0.2], [0.62, 0.06], [1.02, 0.03], [1.0, 0.46], [0.7, 0.36], [0.2, 0.3]], 0.95);
  for (let k = 0; k < 5; k++) {
    const x = 0.22 + k * 0.17;
    const y = mix(0.11, 0.04, k / 4);
    sheet.fill([P(x - 0.06, y - 0.01), P(x + 0.06, y - 0.01), P(x, y + 0.14)], 0.02, true);
  }
  for (const [x, y] of [[0.42, 0.36], [0.72, 0.4]]) sheet.fill([P(x - 0.06, y + 0.04), P(x + 0.06, y + 0.04), P(x, y - 0.12)], 0.02, true);
  // Eye: a reserved white ball under a heavy brow, with a dark pupil and a white glint.
  const e = P(0.06, -0.25);
  sheet.dab(e[0], e[1], s * 0.2, 0.0, true);
  line([[-0.17, -0.2], [0.08, -0.5], [0.3, -0.2]], s * 0.05, s * 0.04, { value: 1.05 });
  sheet.dab(e[0], e[1], s * 0.2 + 2, 0.0, false);
  const pupil = P(0.1, -0.24);
  sheet.dab(pupil[0], pupil[1], s * 0.105, 1.1);
  const glint = P(0.14, -0.28);
  sheet.dab(glint[0], glint[1], s * 0.03, 0.0, true);
  // A ring round the eye.
  const ringPts = [];
  for (let a = 0; a <= 12; a++) ringPts.push([0.06 + Math.cos((a / 12) * 6.283) * 0.2, -0.25 + Math.sin((a / 12) * 6.283) * 0.2]);
  line(ringPts, s * 0.024, s * 0.024, { value: 1.05 });
  // The nose: a spiral on the snout's end, and a nostril.
  line([[1.28, -0.34], [1.18, -0.42], [1.05, -0.32], [1.13, -0.2], [1.24, -0.26]], s * 0.022, s * 0.018, { value: 1.05 });
  // Horns: two branched antlers swept back.
  for (const [x0, y0, sc] of [[-0.25, -0.58, 1], [-0.02, -0.6, 0.86]]) {
    line([[x0, y0], [x0 - 0.42 * sc, y0 - 0.46 * sc], [x0 - 1.05 * sc, y0 - 0.86 * sc]], s * 0.075, s * 0.024, { value: 0.95, swell: 0.1 });
    line([[x0 - 0.5 * sc, y0 - 0.52 * sc], [x0 - 0.6 * sc, y0 - 0.95 * sc]], s * 0.045, s * 0.02, { value: 0.95 });
    line([[x0 - 0.8 * sc, y0 - 0.7 * sc], [x0 - 1.08 * sc, y0 - 0.62 * sc]], s * 0.038, s * 0.018, { value: 0.95 });
  }
  // Whiskers, long and restless.
  line([[1.16, -0.05], [1.65, -0.28], [1.95, 0.02], [2.3, -0.32]], s * 0.032, 0.7, { value: 0.95 });
  line([[0.9, 0.56], [1.42, 0.82], [1.72, 0.58], [2.06, 0.9]], s * 0.03, 0.7, { value: 0.95 });
  // A beard of flame under the jaw.
  for (let k = 0; k < 5; k++) {
    const x = -0.15 + k * 0.17;
    line([[x, 0.6], [x - 0.12, 0.9], [x - 0.3 + (k % 2) * 0.08, 1.2]], s * 0.05, 0.7, { value: 0.9 });
  }
  // A ruff of little plumes behind the jaw hides the join to the neck.
  for (let k = 0; k < 7; k++) {
    const a = 1.2 + (k / 6) * 1.6;
    const r0 = 0.3;
    const x0 = -0.5 + Math.cos(a) * r0 * 0.3;
    const y0 = -0.05 + Math.sin(a) * r0;
    line([[x0, y0], [x0 - 0.45, y0 + Math.sin(a) * 0.25], [x0 - 0.78, y0 + Math.sin(a) * 0.5 - 0.1]], s * 0.058, 0.8, { value: 0.92 });
  }
}

// A ruyi cloud: a head of curled lobes, trailing a tapering wisp. Fill first, then a dark contour.
function cloud(sheet, x, y, R, dir, rng) {
  const lobes = 3 + Math.floor(rng() * 2);
  const lean = (rng() - 0.5) * 0.3;
  for (let k = 0; k < lobes; k++) {
    const a = -Math.PI * 0.95 + ((k + 0.5) / lobes) * Math.PI * 1.1 + lean;
    const lx = x + Math.cos(a) * R * 0.58 * dir;
    const ly = y + Math.sin(a) * R * 0.5;
    const r = R * (0.42 + rng() * 0.1);
    sheet.dab(lx, ly, r, 0.34);
    // Each lobe's contour curls in on itself, the ruyi fungus head.
    const pts = [];
    for (let i = 0; i <= 15; i++) {
      const t = i / 15;
      const ang = a - 1.5 + t * 5.8;
      const rr = r * (1 - t * 0.68);
      pts.push([lx + Math.cos(ang) * rr * dir, ly + Math.sin(ang) * rr]);
    }
    sheet.stroke(pts, 2.4, 1.2, { value: 1.0 });
  }
  sheet.dab(x, y + R * 0.1, R * 0.5, 0.34);
  // A second contour: a flat underside.
  sheet.stroke([[x - dir * R * 0.9, y + R * 0.2], [x, y + R * 0.46], [x + dir * R * 0.86, y + R * 0.2]], 2.0, 1.4, { value: 0.95 });
  // The wisp.
  const wisp = [[x + dir * R * 0.5, y + R * 0.34], [x + dir * R * 1.2, y + R * 0.42], [x + dir * R * 1.8, y + R * 0.14], [x + dir * R * 2.4, y + R * 0.26]];
  sheet.fill(ribbonPoly(wisp, R * 0.14, 0.5), 0.5);
  sheet.stroke(wisp, R * 0.05 + 1.2, 0.7, { value: 0.95 });
}

function flamingPearl(sheet, x, y, R) {
  sheet.stroke(Array.from({ length: 16 }, (_, i) => {
    const a = (i / 15) * 6.283;
    return [x + Math.cos(a) * R, y + Math.sin(a) * R];
  }), 2.2, 2.2, { value: 1.05, swell: 0 });
  // A spiral inside, as a pearl is drawn.
  sheet.stroke(Array.from({ length: 20 }, (_, i) => {
    const t = i / 19;
    const a = t * 9;
    return [x + Math.cos(a) * R * (0.82 - t * 0.7), y + Math.sin(a) * R * (0.82 - t * 0.7)];
  }), 1.5, 1.0, { value: 0.95 });
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI * 0.2 + (k / 5) * Math.PI * 1.1 - Math.PI / 2;
    const bx = x + Math.cos(a) * R; const by = y + Math.sin(a) * R;
    const tip = [bx + Math.cos(a) * R * 1.1 + 6, by + Math.sin(a) * R * 1.1 - 10];
    sheet.fill(ribbonPoly([[bx, by], [mix(bx, tip[0], 0.5) + 4, mix(by, tip[1], 0.5)], tip], R * 0.2, 0.5), 0.55);
    sheet.stroke([[bx, by], [mix(bx, tip[0], 0.5) + 4, mix(by, tip[1], 0.5)], tip], 1.2, 0.6);
  }
}

function lotusBlossom(sheet, x, y, R, sx = 1) {
  // Nine pointed petals in two rings, each with a wash, a contour and a centre vein.
  for (const [count, rr, off, wash] of [[9, 1, 0, 0.42], [7, 0.66, 0.35, 0.6]]) {
    for (let k = 0; k < count; k++) {
      const a = off + (k / count) * Math.PI * 2;
      const c = Math.cos(a); const n = Math.sin(a);
      const L = R * rr;
      const pt = (al, ac) => [x + (c * al - n * ac) * L * sx, y + (n * al + c * ac) * L * 0.86];
      const outline = [pt(0.2, -0.05), pt(0.55, -0.3), pt(0.82, -0.17), pt(1.04, 0), pt(0.82, 0.17), pt(0.55, 0.3), pt(0.2, 0.05)];
      sheet.fill(outline, wash);
      sheet.stroke([...outline, outline[0]], 1.5, 1.5, { value: 1.0, swell: 0.15 });
      sheet.stroke([pt(0.3, 0), pt(0.82, 0)], 1.0, 0.7, { value: 0.9 });
    }
  }
  sheet.dab(x, y, R * 0.3 * Math.max(0.7, sx), 0.02, true);
  sheet.stroke(Array.from({ length: 16 }, (_, i) => {
    const a = (i / 15) * 6.283;
    return [x + Math.cos(a) * R * 0.3 * sx, y + Math.sin(a) * R * 0.27];
  }), 1.5, 1.5, { value: 1.0, swell: 0 });
  for (const [dx, dy] of [[0, 0], [0.13, 0.05], [-0.13, 0.05], [0.06, -0.13], [-0.06, -0.13]]) sheet.dab(x + dx * R * sx, y + dy * R, R * 0.042 + 0.8, 1.0);
}

function pointedLeaf(sheet, x, y, a, L, wash = 0.72) {
  const c = Math.cos(a); const n = Math.sin(a);
  const pt = (al, ac) => [x + (c * al - n * ac) * L, y + (n * al + c * ac) * L];
  const outline = [pt(0, 0), pt(0.35, -0.2), pt(0.7, -0.15), pt(1, 0), pt(0.65, 0.13), pt(0.3, 0.15)];
  sheet.fill(outline, wash);
  sheet.stroke([...outline, outline[0]], 0.9, 0.9, { value: 1.0, swell: 0 });
}

function paintMeiping(rowOfY, H, W) {
  const sheet = new InkSheet(W, H, 1402);
  const rng = seededRandom(9931);
  const Y = (y) => rowOfY(y);

  // ------------------------------------------------------------- the lip and neck
  sheet.ring(Y(5.33), 4, 0.9);
  sheet.ring(Y(5.28), 1.6, 0.95);
  sheet.ring(Y(5.06), 2.4, 0.95);
  // Upright plantain leaves round the neck, each with a midrib.
  {
    const y0 = Y(5.08); const y1 = Y(5.27);
    const n = 13;
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) / n) * W;
      const half = (W / n) * 0.34;
      const leaf = [[x - half, y0], [x - half * 0.7, mix(y0, y1, 0.5)], [x, y1 + 2], [x + half * 0.7, mix(y0, y1, 0.5)], [x + half, y0]];
      sheet.fill(leaf, 0.42);
      sheet.stroke(leaf, 1.7, 1.7, { value: 1.02 });
      sheet.stroke([[x, y0], [x, y1 + 6]], 1.7, 0.9, { value: 1.0 });
    }
  }

  // ------------------------------------------------------------- the shoulder collar: ruyi lappets
  {
    const top = Y(5.02); const bot = Y(4.7);
    sheet.ring(top, 2.2);
    const n = 16;
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) / n) * W;
      const half = (W / n) * 0.47;
      const h = bot - top;
      const out = [
        [x - half, top], [x + half, top], [x + half * 0.98, top + h * 0.34], [x + half * 0.66, top + h * 0.58],
        [x + half * 0.32, top + h * 0.72], [x, top + h * 0.97], [x - half * 0.32, top + h * 0.72], [x - half * 0.66, top + h * 0.58], [x - half * 0.98, top + h * 0.34],
      ];
      sheet.fill(out, 0.68);
      sheet.stroke([...out.slice(1), out[0]], 1.8, 1.8, { value: 1.02 });
      // A white ruyi head reserved in each.
      const c = [x, top + h * 0.42];
      const rr = half * 0.42;
      sheet.dab(c[0], c[1], rr, 0.02, true);
      sheet.dab(c[0] - rr * 0.75, c[1] - rr * 0.35, rr * 0.55, 0.02, true);
      sheet.dab(c[0] + rr * 0.75, c[1] - rr * 0.35, rr * 0.55, 0.02, true);
      sheet.dab(c[0], c[1] + rr * 0.75, rr * 0.45, 0.02, true);
      sheet.stroke(Array.from({ length: 14 }, (_, i) => {
        const t = i / 13;
        const a = t * 8;
        const r = rr * (0.72 - 0.6 * t);
        return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
      }), 1.5, 1, { value: 1.0 });
    }
    sheet.ring(bot + 1, 2.4);
  }

  // ------------------------------------------------------------- the lotus scroll band
  {
    const top = Y(4.62); const bot = Y(3.96);
    sheet.ring(top - 7, 2.2);
    sheet.ring(top, 3.2);
    sheet.ring(bot, 3.2);
    sheet.ring(bot + 7, 2.2);
    const mid = (top + bot) / 2;
    const amp = (bot - top) * 0.27;
    const m = 6;
    const yAt = (x) => mid + amp * Math.sin((x / W) * Math.PI * 2 * m);
    const stem = [];
    for (let x = 0; x <= W; x += 14) stem.push([x, yAt(x)]);
    sheet.stroke(stem, 2.8, 2.8, { value: 1.0, swell: 0.3 });
    const R = (bot - top) * 0.36;
    for (let k = 0; k < m * 2; k++) {
      const x = ((k + 0.25) / (m * 2)) * W;
      const crest = k % 2 === 0;
      const by = yAt(x) - (crest ? -1 : 1) * amp * 0.1;
      // A curling tendril from the stem to behind the blossom.
      const leafA = crest ? -0.5 : 0.5;
      const span = W / (m * 2);
      const from = [x - span * 0.44, yAt(x - span * 0.44)];
      const dirY = crest ? -1 : 1;
      sheet.stroke([from, [x - span * 0.33, from[1] + dirY * amp * 0.75], [x - span * 0.16, from[1] + dirY * amp * 1.0], [x - span * 0.1, from[1] + dirY * amp * 0.5]], 1.8, 1.2, { value: 0.98 });
      pointedLeaf(sheet, x - span * 0.32, from[1] + dirY * amp * 0.62, (crest ? -2.5 : 2.5), R * 0.6);
      pointedLeaf(sheet, x - span * 0.22, from[1] + dirY * amp * 1.02, (crest ? -0.9 : 0.9), R * 0.55);
      pointedLeaf(sheet, x + span * 0.42, yAt(x + span * 0.42), leafA * 2.4, R * 0.66);
      pointedLeaf(sheet, x + span * 0.5, yAt(x + span * 0.5) + dirY * -4, -leafA * 1.2, R * 0.58);
      lotusBlossom(sheet, x, by, R, 0.92);
    }
  }

  // ------------------------------------------------------------- the waves at the foot
  {
    const top = Y(0.96); const bot = Y(0.14);
    sheet.ring(top - 7, 2.2);
    sheet.ring(top, 3.2);
    sheet.ring(bot, 3.2);
    sheet.ring(bot + 7, 2.2);
    const h = bot - top;
    const units = 10;
    const unit = W / units;
    const base = bot - 2;
    // The sea is a row of overlapping breakers, each laid over the one before as fish scales are: a
    // hook of line that rises from the trough, over the crest and curls forward into its own centre,
    // with the same hook repeated smaller inside it. Pale wash below, white foam in the curl.
    const hook = (cx, topY, k) => {
      const cy = topY + h * 0.2;
      const q = (x, y) => [cx + (x - 0.0) * unit * k, cy + y * h * k];
      return [q(-0.86, 0.72), q(-0.62, 0.48), q(-0.34, 0.08), q(-0.08, -0.2), q(0.14, -0.2), q(0.27, -0.04), q(0.2, 0.1), q(0.07, 0.1), q(0.05, 0.0)];
    };
    const drawn = units + 1;
    for (let k = 0; k < drawn; k++) {
      const cx = (k + 0.6) * unit;
      const crestY = top + h * (0.09 + (k % 2) * 0.05);
      const outer = hook(cx, crestY, 1);
      // Everything under the breaker's back, down to the band's lower line.
      const backCurve = outer.slice(0, 6);
      const body = [
        [backCurve[0][0] - unit * 0.1, base], ...backCurve, [cx + unit * 0.34, crestY + h * 0.3], [cx + unit * 0.36, crestY + h * 0.62], [cx + unit * 0.5, base],
      ];
      sheet.fill(body, 0.02, true);
      sheet.fill(body, 0.2);
      // Long parallel swell lines running under the crest and on along the back.
      for (let j = 0; j < 5; j++) {
        const f = (j + 1) / 6;
        const line = [
          [cx - unit * 0.92, mix(crestY + h * 0.56, base, f)],
          [cx - unit * 0.5, mix(crestY + h * 0.4, base, f)],
          [cx - unit * 0.14, mix(crestY + h * 0.24, base, f)],
          [cx + unit * 0.14, mix(crestY + h * 0.3, base, f)],
          [cx + unit * 0.44, mix(crestY + h * 0.62, base, f)],
        ];
        sheet.stroke(line, 1.6 + (j % 2), 1.6 + (j % 2), { value: j % 2 ? 0.98 : 0.8, swell: 0.4 });
      }
      // The curl, a reserved white tongue with hooks inside it.
      const tongue = [...outer.slice(2, 9), [cx - unit * 0.1, crestY + h * 0.31], [cx - unit * 0.32, crestY + h * 0.33]];
      sheet.fill(tongue, 0.02, true);
      sheet.stroke(outer, 3, 1.5, { value: 1.05, swell: 0.3 });
      sheet.stroke(hook(cx - unit * 0.01, crestY + h * 0.035, 0.66).slice(2), 1.9, 1.1, { value: 0.95 });
      sheet.stroke(hook(cx - unit * 0.015, crestY + h * 0.07, 0.38).slice(3), 1.5, 1.0, { value: 0.95 });
      // Foam fingers thrown forward off the crest.
      for (let f = 0; f < 4; f++) {
        const a = -0.9 + f * 0.55;
        const fx = cx + unit * 0.22; const fy = crestY + h * 0.2 + f * h * 0.015;
        const tip = [fx + Math.cos(a) * unit * 0.2, fy + Math.sin(a) * h * 0.2];
        sheet.stroke([[fx, fy], [mix(fx, tip[0], 0.5), mix(fy, tip[1], 0.5) - 3], tip], 2.1, 0.8, { value: 1.0 });
      }
      for (let d = 0; d < 6; d++) {
        const a = -1.4 + rng() * 2;
        const dd = (0.26 + rng() * 0.16) * unit;
        sheet.dab(cx + unit * 0.2 + Math.cos(a) * dd, crestY + h * 0.2 + Math.sin(a) * dd * 0.45, 1.5 + rng() * 1.2, 0.95);
      }
    }
    // The band's own rules go last, over the top of whatever broke through them.
    sheet.ring(top, 3.2);
    sheet.ring(bot, 3.2);
  }

  // ------------------------------------------------------------- the foot
  sheet.ring(Y(0.1), 2.2);
  sheet.ring(Y(0.055), 1.6);

  // ------------------------------------------------------------- the two dragons among clouds
  const yTop = Y(3.82);
  const yBot = Y(1.14);
  const bandH = yBot - yTop;
  const spines = [];
  const place = (uShift, flip) => {
    const P = (u, v) => [(uShift + u * flip) * W, yBot - v * bandH];
    // The head leads, and the body snakes back behind it, tail last. Listed tail to head.
    const spine = [
      P(-0.21, 0.72), P(-0.185, 0.56), P(-0.15, 0.40), P(-0.115, 0.22), P(-0.07, 0.12), P(-0.03, 0.20), P(-0.005, 0.40), P(0.0, 0.62),
      P(0.03, 0.82), P(0.075, 0.86), P(0.115, 0.68), P(0.095, 0.48), P(0.105, 0.28), P(0.15, 0.2), P(0.19, 0.32), P(0.2, 0.5),
    ];
    const hwAt = (t) => {
      const tail = sstep(t, 0, 0.32);
      const neck = 1 - 0.3 * sstep(t, 0.78, 1);
      return mix(1.8, 33, tail) * neck;
    };
    const d = drawDragon(sheet, spine, hwAt, { scaleS: 15 });
    dorsalFins(sheet, d, hwAt, { every: 25 });
    spines.push({ d, hwAt, flip });
    // Tail fin: a fan of flame at the very end.
    const tail = d.samples[0];
    const tT = d.tangents[0];
    for (let k = -2; k <= 2; k++) {
      const a = Math.atan2(-tT.y, -tT.x) + k * 0.36;
      const L = 56 - Math.abs(k) * 7;
      const m1 = [tail.x + Math.cos(a) * L * 0.55 + 4, tail.y + Math.sin(a) * L * 0.55];
      const m2 = [tail.x + Math.cos(a) * L, tail.y + Math.sin(a) * L];
      sheet.fill(ribbonPoly([[tail.x, tail.y], m1, m2], 7, 0.6), 0.6);
      sheet.stroke([[tail.x, tail.y], m1, m2], 1.5, 0.7, { value: 1.0 });
    }
    // Four legs, at fixed fractions along the body, reaching out from the body's outer side.
    const legAt = [0.36, 0.5, 0.7, 0.84];
    for (let k = 0; k < legAt.length; k++) {
      const i = Math.round(legAt[k] * d.n);
      const c = d.samples[i];
      const T = d.tangents[i];
      const side = (k % 2 ? 1 : -1);
      const nx = -T.y * side; const ny = T.x * side;
      const hw = hwAt(legAt[k]);
      const hip = [c.x + nx * hw * 0.6, c.y + ny * hw * 0.6];
      const kx = c.x + nx * (hw + 34) - T.x * 26;
      const ky = c.y + ny * (hw + 34) - T.y * 26;
      const fx = kx + nx * 24 + T.x * 42;
      const fy = ky + ny * 24 + T.y * 42;
      dragonLeg(sheet, hip, [kx, ky], [fx, fy], 15, side * flip);
    }
    // The head, at the far end of the neck, looking on toward the pearl.
    const end = d.samples[d.n];
    const endT = d.tangents[d.n];
    const headX = end.x + endT.x * 18;
    const headY = end.y + endT.y * 18;
    const dir = flip;
    dragonHead(sheet, headX + dir * 16, headY - 22, 84, dir, dir * 0.08);
    const pearl = P(0.325, 0.72);
    flamingPearl(sheet, pearl[0], pearl[1], 32);
    return { spine, pearl };
  };
  place(0.31, 1);
  place(0.81, 1);

  // Where is there room for a cloud? Rejected against every body sample and head, with wrap.
  const near = (x, y, r) => {
    for (const { d, hwAt } of spines) {
      for (let i = 0; i <= d.n; i += 6) {
        const c = d.samples[i];
        let dx = Math.abs(x - c.x) % W;
        if (dx > W / 2) dx = W - dx;
        if (Math.hypot(dx, y - c.y) < r + hwAt(i / d.n) + 26) return true;
      }
      const e = d.samples[d.n];
      let dx = Math.abs(x - (e.x + 40 * d.tangents[d.n].x)) % W;
      if (dx > W / 2) dx = W - dx;
      if (Math.hypot(dx, y - e.y) < r + 170) return true;
    }
    return false;
  };
  const clouds = [];
  for (let tries = 0; tries < 900 && clouds.length < 34; tries++) {
    const x = rng() * W;
    const y = mix(yTop + 22, yBot - 22, rng());
    const R = 30 + rng() * 22;
    if (near(x, y, R)) continue;
    let ok = true;
    for (const c of clouds) {
      let dx = Math.abs(x - c.x);
      if (dx > W / 2) dx = W - dx;
      if (Math.hypot(dx, y - c.y) < R + c.R + 34) ok = false;
    }
    if (!ok) continue;
    clouds.push({ x, y, R });
  }
  for (const c of clouds) cloud(sheet, c.x, c.y, c.R, rng() > 0.5 ? 1 : -1, rng);
  return sheet;
}

function inkToCanvas(sheet) {
  const { W, H, ink } = sheet;
  const { canvas, ctx } = makeCanvas(W, H);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const fine = noiseTile(256, 1, 1, 77);
  const broad = noiseTile(256, 2, 18, 78);
  const mottle = noiseTile(256, 2, 5, 79);
  const lut = new Uint8ClampedArray(3 * 512);
  for (let i = 0; i < 512; i++) {
    const t = (i / 511) * 1.15;
    let k = 0;
    while (k < COBALT.length - 2 && t > COBALT[k + 1][0]) k++;
    const [t0, c0] = COBALT[k];
    const [t1, c1] = COBALT[k + 1];
    const f = clamp01((t - t0) / (t1 - t0));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = mix(c0[c], c1[c], f);
  }
  for (let y = 0; y < H; y++) {
    const fy = (y & 255) << 8;
    const my = ((y * 3) & 255) << 8;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = ink[i];
      const n1 = broad[fy | (x & 255)];
      const n2 = fine[fy | (x & 255)];
      const n3 = mottle[my | ((x * 3) & 255)];
      let tone = a;
      if (a > 0.04) {
        // A brush wash is never even: it wanders broadly and mottles finely.
        tone = a * (0.78 + 0.34 * n1 + 0.22 * (n3 - 0.5));
        // "Heaped and piled": iron in the cobalt gathers into dark specks where the brush lay heavy.
        if (a > 0.4 && n2 > 0.74) tone += (n2 - 0.74) * 2.4 * a;
      }
      const li = Math.min(511, Math.round((tone / 1.15) * 511));
      const j = i * 4;
      // The glaze itself is faintly blue-green and very slightly clouded.
      const glaze = 1 - 0.018 * n1;
      d[j] = lut[li * 3] * glaze;
      d[j + 1] = lut[li * 3 + 1] * glaze;
      d[j + 2] = lut[li * 3 + 2] * glaze;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// The outer profile of the jar, height 5.4, standing on its own foot at y = 0. A meiping is a narrow
// foot, a high broad shoulder, then almost no neck and a small rolled lip.
const MEIPING = [
  [1.02, 0.0], [1.035, 0.03], [1.03, 0.08], [1.0, 0.2], [0.985, 0.42], [1.02, 0.78], [1.15, 1.25], [1.33, 1.8], [1.53, 2.4],
  [1.69, 3.0], [1.76, 3.48], [1.72, 3.9], [1.56, 4.28], [1.26, 4.6], [0.9, 4.83], [0.62, 4.98], [0.53, 5.06], [0.5, 5.14], [0.51, 5.24], [0.58, 5.3], [0.67, 5.34], [0.69, 5.37],
];

function mingVase() {
  const baseY = 0.58; // the jar's foot, sunk a touch into the stand
  const outer = smoothPoly(MEIPING, 110);
  const S = [0];
  for (let i = 1; i < outer.length; i++) S.push(S[i - 1] + Math.hypot(outer[i][0] - outer[i - 1][0], outer[i][1] - outer[i - 1][1]));
  const total = S[S.length - 1];
  // The lip and the blind interior of the neck, on the top of the sheet.
  const rim = [[0.68, 5.395], [0.64, 5.40], [0.58, 5.385], [0.5, 5.33], [0.45, 5.2], [0.42, 5.0], [0.38, 4.75], [0.2, 4.45], [0, 4.4]];
  const under = [[0, 0.03], [0.82, 0.03], [0.9, 0], [1.02, 0]];
  const rows = [...under, ...outer.slice(1), ...rim];
  const nOuterStart = under.length - 1;
  const nOuterEnd = nOuterStart + outer.length - 1;
  const vOf = (i) => {
    if (i <= nOuterStart) return 0.001;
    if (i >= nOuterEnd) return 0.9995;
    return S[i - nOuterStart] / total;
  };
  const jar = latheUV(rows, 144, { start: Math.PI, vOf });
  jar.translate(0, baseY, 0);
  // Colour only for what the painting does not reach: the bare foot ring and the dark throat.
  tintVertices(jar, (x, y, z, out) => {
    const r = Math.hypot(x, z);
    const yy = y - baseY;
    let k = 0.93;
    if (yy < 0.035) { out[0] = 0.62; out[1] = 0.45; out[2] = 0.3; return; }
    if (yy > 5.2 && r < 0.56) k = mix(0.8, 0.2, clamp01((5.34 - yy) / 0.3));
    if (yy < 5.2 && r < 0.46) k = 0.06;
    out[0] = k * 0.985; out[1] = k * 1.0; out[2] = k * 0.99;
  });

  // The canvas row of a height on the jar: one painting, placed in the jar's own heights.
  const W = 2048;
  const H = 1216;
  const rowOfY = (y) => {
    let lo = 0;
    for (let i = 1; i < outer.length; i++) {
      if (outer[i][1] >= y) { lo = i; break; }
      lo = i;
    }
    const a = outer[Math.max(0, lo - 1)];
    const b = outer[lo];
    const f = b[1] === a[1] ? 0 : clamp01((y - a[1]) / (b[1] - a[1]));
    const s = mix(S[Math.max(0, lo - 1)], S[lo], f);
    return (1 - s / total) * H;
  };
  const sheet = paintMeiping(rowOfY, H, W);
  const canvas = inkToCanvas(sheet);
  const map = texOf(canvas, THREE.SRGBColorSpace);
  map.wrapT = THREE.ClampToEdgeWrapping;
  map.anisotropy = 12;

  const porcelain = new THREE.Mesh(jar, new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.17, metalness: 0 }));
  porcelain.castShadow = true;
  porcelain.receiveShadow = true;

  // ------------------------------------------------------------- the rosewood stand
  const wood = lin(0x3b1e12);
  const dark = lin(0x26120a);
  const P = [];
  const grain = grainMaps({ seed: 61, knots: 0, strength: 0.25, width: 128, height: 256, streaks: 60 });
  const curved = (g, color, ku = 2, kv = 1) => {
    const uv = g.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ku, uv.getY(i) * kv);
    P.push({ geometry: g, color: new THREE.Color().setRGB(color[0], color[1], color[2]) });
  };
  // The top: a moulded disc with a raised lip, and a shallow seat the foot sits in.
  curved(spin([
    [0, 0.44], [1.1, 0.44], [1.32, 0.44], [1.44, 0.47], [1.48, 0.5], [1.46, 0.53], [1.44, 0.56], [1.44, 0.595], [1.4, 0.62], [1.33, 0.62], [1.28, 0.6], [1.12, 0.595], [1.08, 0.585], [0, 0.585],
  ], { segments: 72 }), wood, 5, 1);
  // The waist under it, then the scalloped apron: the 5-fold wave is what a carver cuts it to.
  const apron = spin([[0, 0.3], [1.28, 0.3], [1.36, 0.34], [1.38, 0.4], [1.34, 0.45], [0, 0.45]], { segments: 90 });
  {
    const p = apron.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0.35 && Math.hypot(p.getX(i), p.getZ(i)) > 0.5) {
        const a = Math.atan2(p.getX(i), p.getZ(i));
        p.setY(i, p.getY(i) + 0.07 * (0.5 - 0.5 * Math.cos(5 * a + Math.PI)));
      }
    }
    apron.computeVertexNormals();
  }
  curved(apron, dark, 5, 1);
  // The floor ring the legs stand on.
  curved(spin([[0.94, 0.0], [1.42, 0.0], [1.46, 0.035], [1.44, 0.08], [1.4, 0.1], [0.98, 0.1], [0.94, 0.06]], { segments: 72, closed: true }), wood, 5, 1);
  // Five cabriole legs, ending in a cloud-curl toe: socketed into the apron and into the ring.
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const dir = (r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
    const leg = tube([dir(1.2, 0.46), dir(1.3, 0.38), dir(1.38, 0.24), dir(1.32, 0.13), dir(1.32, 0.06)], [0.1, 0.105, 0.075, 0.06, 0.075], {
      sides: 12, steps: 24, round: 3, section: () => [1, 0.8],
    });
    curved(leg, wood, 1, 2);
    const curl = tube([dir(1.34, 0.12), dir(1.46, 0.135), dir(1.51, 0.095), dir(1.47, 0.06), dir(1.415, 0.075)], [0.05, 0.05, 0.042, 0.03, 0.024], { sides: 8, steps: 16, round: 2 });
    curved(curl, dark, 1, 1);
  }
  const stand = meshFrom(mergeParts(P), { ...grain, roughness: 0.36, metalness: 0 });

  return groupOf(porcelain, stand);
}

// ---------------------------------------------------------------------------
// Typewriter: a c.1900s front-strike upright, four times life
// ---------------------------------------------------------------------------
//
// Everything the card asks a student to compare is computed: the four rows are tables, each key
// sits at its row's stagger, and each lever, link and type bar is found by sorting the keys left to
// right, so the fan cannot cross itself. One bar is caught mid-strike: E, hitting the sheet at the
// exact column where the last typed line stops short of its next letter.

// The c.1900 layout: the letter rows are the ones still on every keyboard. Many machines of the time
// had no 1 key, since a lower-case L printed it. Row stagger is in key pitches, measured from the
// top row, the arrangement every later keyboard inherited.
const TW_ROWS = [
  { keys: ['2', '3', '4', '5', '6', '7', '8', '9', '0', '-'], off: 0 },
  { keys: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], off: -0.5 },
  { keys: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';'], off: -0.25 },
  { keys: ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'], off: 0.25 },
];
const TW_EXTRA = [
  { label: 'SHIFT', row: 3, slot: -1.1 },
  { label: 'SHIFT', row: 3, slot: 10.1 },
  { label: 'LOCK', row: 2, slot: -1.1 },
  { label: 'BACK', row: 0, slot: 10.1 },
];
const TW_LINES = [
  'The quick brown fox jumps over',
  'the lazy dog.',
  '',
  'Each key swings a metal letter',
  'against an inked ribbon,',
  'which prints it on the pap',
];

function typewriterLayout() {
  const pitch = 0.29;
  const rowZ = [1.72, 2.01, 2.3, 2.59];
  const rowY = [1.22, 1.05, 0.88, 0.71];
  const mean = TW_ROWS.reduce((s, r) => s + r.off, 0) / TW_ROWS.length;
  const keys = [];
  TW_ROWS.forEach((row, r) => {
    row.keys.forEach((label, i) => {
      keys.push({ label, r, i, x: (i - 4.5 + row.off - mean) * pitch, y: rowY[r], z: rowZ[r], typing: true });
    });
  });
  const extras = TW_EXTRA.map((e) => {
    const row = TW_ROWS[e.row];
    return { label: e.label, r: e.row, x: (e.slot - 4.5 + row.off - mean) * pitch, y: rowY[e.row], z: rowZ[e.row], typing: false };
  });
  return { keys, extras, pitch, rowZ, rowY };
}

function keyAtlas(layout) {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const cell = 85;
  const cells = new Map();
  const all = [...layout.keys, ...layout.extras];
  all.forEach((k, n) => {
    const key = k.label + (k.typing ? '' : `#${n}`);
    if (cells.has(key)) { k.cell = cells.get(key); return; }
    const c = cells.size;
    const col = c % 12;
    const row = Math.floor(c / 12);
    const x = col * cell;
    const y = row * cell;
    k.cell = { x, y };
    cells.set(key, k.cell);
    // A black face under glass with a thin paper-white ring, as these keys had.
    ctx.fillStyle = '#0b0c10';
    ctx.fillRect(x, y, cell, cell);
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    ctx.strokeStyle = '#d9d4c4';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.465, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f5f1e4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (k.typing) {
      ctx.font = 'bold 62px Georgia, "Times New Roman", serif';
      ctx.fillText(k.label, cx, cy + 3);
    } else {
      fitFont(ctx, k.label, cell * 0.76, 24, 'bold $px Arial, sans-serif');
      ctx.fillText(k.label, cx, cy + 1);
    }
  });
  // The front rail's decal: fine gold lines, scrolls at the ends and the name of the thing, no maker.
  const gold = '#d9b25f';
  const y0 = 360;
  ctx.strokeStyle = gold;
  ctx.fillStyle = gold;
  ctx.lineWidth = 3;
  ctx.strokeRect(12, y0 + 8, S - 24, 84);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(20, y0 + 15, S - 40, 70);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'THE WRITING MACHINE', S * 0.5, 50, 'bold $px Georgia, "Times New Roman", serif');
  ctx.fillText('THE WRITING MACHINE', S / 2, y0 + 52);
  const flourish = (cx, cy, s, dir) => {
    ctx.lineWidth = 2.5;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      const sc = s * (1 - k * 0.26);
      const flip = k % 2 ? -1 : 1;
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const a = t * 7.5;
        const r = sc * 0.36 * (1 - t * 0.85);
        const px = cx + dir * (k * s * 0.62 + Math.cos(a) * r * 1.3);
        const py = cy + flip * Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + dir * s * 1.3, cy - s * 0.4, cx + dir * s * 2.1, cy);
    ctx.quadraticCurveTo(cx + dir * s * 2.8, cy + s * 0.3, cx + dir * s * 3.2, cy);
    ctx.stroke();
  };
  flourish(70, y0 + 50, 56, 1);
  flourish(S - 70, y0 + 50, 56, -1);
  // The wing decal: a long scroll running front to back on each side of the top deck.
  const wy = 480;
  const wh = 540;
  ctx.lineWidth = 2.4;
  ctx.strokeRect(8, wy + 8, 240, wh - 16);
  ctx.lineWidth = 1;
  ctx.strokeRect(16, wy + 16, 224, wh - 32);
  ctx.save();
  ctx.translate(128, wy + 270);
  ctx.rotate(Math.PI / 2);
  ctx.translate(-128, -(wy + 270));
  flourish(-70, wy + 270, 58, 1);
  flourish(326, wy + 270, 58, -1);
  ctx.restore();
  const atlasRect = (x, y, w, h) => [x / S, 1 - (y + h) / S, w / S, h / S]; // u0, v0, du, dv in GL space
  const map = texOf(canvas, THREE.SRGBColorSpace, false);
  map.anisotropy = 8;
  return { map, cell: cell / S, S, atlasRect, rail: atlasRect(0, y0, S, 100), wing: atlasRect(0, wy, 256, wh) };
}

function paperMap(pxPerFoot, widthFt, heightFt, printS, marginFt, pitchFt, lineFt) {
  const W = Math.round(pxPerFoot * widthFt);
  const H = Math.round(pxPerFoot * heightFt);
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#f4efdf';
  ctx.fillRect(0, 0, W, H);
  // The faintest laid lines, so it reads as paper and not as a white card.
  const rng = seededRandom(1907);
  for (let y = 0; y < H; y += 5) {
    ctx.fillStyle = `rgba(150,135,100,${0.03 + rng() * 0.035})`;
    ctx.fillRect(0, y, W, 1);
  }
  ctx.textBaseline = 'alphabetic';
  const pitch = pitchFt * pxPerFoot;
  const baseY = H - printS * pxPerFoot; // the canvas row of the print line
  const n = TW_LINES.length;
  TW_LINES.forEach((line, row) => {
    const y = baseY - (n - 1 - row) * lineFt * pxPerFoot;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === ' ') continue;
      // Every slug strikes a little differently: a touch of height and of ink.
      const dark = 22 + Math.round(rng() * 34);
      ctx.fillStyle = `rgba(${dark},${dark},${dark + 12},${0.82 + rng() * 0.16})`;
      ctx.font = `bold ${Math.round(pitch * 1.62)}px "Courier New", Courier, monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(ch, (marginFt * pxPerFoot) + (i + 0.5) * pitch, y + (rng() - 0.5) * 1.8);
    }
  });
  const t = texOf(canvas, THREE.SRGBColorSpace, false);
  t.anisotropy = 12;
  return t;
}

function typewriter() {
  const NICKEL = 0xb9bec4;
  const STEEL = 0x8b9096;
  const DARKSTEEL = 0x54585e;
  const GOLD = 0xc9a14a;
  const BLACK = 0x101116;
  const BLACK2 = 0x0b0c10;
  const RUBBER = 0x17171a;
  const INK = 0x101014;
  const RED = 0xa11d1d;
  const layout = typewriterLayout();
  const atlas = keyAtlas(layout);
  const E = []; // enamel
  const M = []; // nickel, steel, gold
  const R = []; // rubber, ribbon
  const A = []; // key tops and decals, the atlas
  const hx = 1.76; // inner face of the side plates is hx - 0.05

  // ------------------------------------------------------------- the platen and the print point
  const PLATEN = { y: 2.36, z: -0.5, r: 0.235, half: 1.6 };
  const printA = (20 * Math.PI) / 180;
  const PRINT = [0, PLATEN.y + PLATEN.r * Math.sin(printA), PLATEN.z + PLATEN.r * Math.cos(printA)];

  // ------------------------------------------------------------- the side plates, cast with windows
  const sideShape = () => {
    const s = new THREE.Shape();
    s.moveTo(3.1, 0.12);
    s.lineTo(3.14, 0.34);
    s.bezierCurveTo(3.14, 0.5, 3.05, 0.56, 2.9, 0.58);
    s.bezierCurveTo(2.3, 0.72, 1.7, 1.1, 1.3, 1.58);
    s.bezierCurveTo(1.12, 1.82, 1.02, 2.02, 0.76, 2.04);
    s.lineTo(-0.94, 2.04);
    s.bezierCurveTo(-1.06, 2.04, -1.1, 1.98, -1.1, 1.86);
    s.lineTo(-1.1, 0.12);
    s.lineTo(3.1, 0.12);
    const front = new THREE.Path();
    front.moveTo(2.62, 0.3);
    front.bezierCurveTo(2.2, 0.5, 1.9, 0.68, 1.5, 1.0);
    front.lineTo(1.28, 1.05);
    front.lineTo(1.28, 0.3);
    front.lineTo(2.62, 0.3);
    s.holes.push(front);
    const rear = new THREE.Path();
    rear.moveTo(0.98, 0.3);
    rear.lineTo(0.98, 1.28);
    rear.bezierCurveTo(0.98, 1.6, 0.8, 1.76, 0.5, 1.76);
    rear.lineTo(-0.62, 1.76);
    rear.bezierCurveTo(-0.84, 1.76, -0.88, 1.6, -0.88, 1.5);
    rear.lineTo(-0.88, 0.3);
    rear.lineTo(0.98, 0.3);
    s.holes.push(rear);
    return s;
  };
  // The lining follows the casting's own curves, measured in from them.
  const bez = (p0, c1, c2, p3, t) => {
    const m = 1 - t;
    return [
      m * m * m * p0[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * p3[0],
      m * m * m * p0[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * p3[1],
    ];
  };
  const inset = (p0, c1, c2, p3, off, n = 10) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const a = bez(p0, c1, c2, p3, Math.max(0, t - 0.01));
    const b = bez(p0, c1, c2, p3, Math.min(1, t + 0.01));
    const c = bez(p0, c1, c2, p3, t);
    const dz = b[0] - a[0]; const dy = b[1] - a[1];
    const l = Math.hypot(dz, dy);
    return [c[0] - (dy / l) * off, c[1] + (dz / l) * off]; // walking toward -z, inward is to the left
  });
  const sideGold = [
    [3.03, 0.22], [3.05, 0.42], [2.9, 0.495],
    ...inset([2.9, 0.58], [2.3, 0.72], [1.7, 1.1], [1.3, 1.58], 0.075),
    ...inset([1.3, 1.58], [1.12, 1.82], [1.02, 2.02], [0.76, 2.04], 0.075, 6),
    [-0.92, 1.965], [-1.025, 1.87], [-1.025, 0.205], [3.03, 0.205],
  ];
  for (const sx of [-1, 1]) {
    const g = shapeSolid(sideShape(), 0.1, { bevel: 0.016, curve: 14 });
    g.rotateY(-Math.PI / 2);
    g.translate(sx * hx, 0, 0);
    E.push({ geometry: g, color: BLACK });
    // A fine gold line round each plate, sunk half into the paint on its outer face.
    const x = sx * (hx + 0.05);
    fineLine(M, GOLD, sideGold.map(([z, y]) => [x, y, z]), 0.008);
    const win = [[1.04, 0.24], [1.04, 1.28], [0.56, 1.83], [-0.66, 1.83], [-0.94, 1.54], [-0.94, 0.24]];
    fineLine(M, GOLD, win.map(([z, y]) => [x, y, z]), 0.006, { closed: true });
    // Rubber feet, seated up into the plate.
    for (const z of [-0.92, 2.86]) {
      R.push({ geometry: spin([[0, 0], [0.13, 0], [0.15, 0.03], [0.15, 0.11], [0.1, 0.16], [0, 0.16]], { segments: 18 }), color: RUBBER, position: [sx * hx, 0, z] });
    }
  }
  // The back wall carries two lined panels, so the back of the machine is paintwork rather than a void.
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.1; const x1 = sx * 1.62;
    const z = -1.094;
    fineLine(M, GOLD, [[x0, 0.34, z], [x1, 0.34, z], [x1, 1.86, z], [x0, 1.86, z]], 0.008, { closed: true });
    fineLine(M, GOLD, [[x0 + sx * 0.08, 0.42, z], [x1 - sx * 0.08, 0.42, z], [x1 - sx * 0.08, 1.78, z], [x0 + sx * 0.08, 1.78, z]], 0.005, { closed: true });
  }
  // Cross members: the front rail, a thin floor, the back wall.
  E.push({ geometry: new THREE.BoxGeometry(hx * 2, 0.34, 0.14), color: BLACK, position: [0, 0.33, 3.02] });
  E.push({ geometry: new THREE.BoxGeometry(hx * 2, 0.05, 0.42), color: BLACK, position: [0, 0.15, 2.92] });
  E.push({ geometry: new THREE.BoxGeometry(hx * 2, 1.86, 0.08), color: BLACK, position: [0, 1.08, -1.05] });
  E.push({ geometry: new THREE.BoxGeometry(hx * 2, 0.05, 0.9), color: BLACK, position: [0, 0.15, -0.62] });
  // The front rail's decal: a hair proud, carrying its own gold lines.
  {
    const w = hx * 1.92;
    const g = new THREE.PlaneGeometry(w, 0.3);
    const [u0, v0, du, dv] = atlas.rail;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
    g.translate(0, 0.33, 3.0925);
    A.push({ geometry: g, color: 0xffffff });
  }

  // ------------------------------------------------------------- the top deck, a U round the basket
  const Y_DECK = 1.97;
  const deckShape = (x0, z0, x1, z1) => {
    const s = new THREE.Shape();
    s.moveTo(x0, -z0); s.lineTo(x1, -z0); s.lineTo(x1, -z1); s.lineTo(x0, -z1); s.lineTo(x0, -z0);
    return s;
  };
  for (const sx of [-1, 1]) {
    const g = shapeSolid(sx > 0 ? deckShape(1.04, 0.84, hx - 0.01, -1.06) : deckShape(-hx + 0.01, 0.84, -1.04, -1.06), 0.09, { bevel: 0.012, curve: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, Y_DECK, 0);
    E.push({ geometry: g, color: BLACK });
    // Decal on the wing.
    const w = 0.62;
    const L = 1.6;
    const d = new THREE.PlaneGeometry(w, L);
    d.rotateX(-Math.PI / 2);
    const [u0, v0, du, dv] = atlas.wing;
    const uv = d.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
    d.translate(sx * 1.4, Y_DECK + 0.046, -0.11);
    A.push({ geometry: d, color: 0xffffff });
  }
  E.push({ geometry: new THREE.BoxGeometry(2.1, 0.09, 0.5), color: BLACK, position: [0, Y_DECK, -0.84] });

  // ------------------------------------------------------------- the type-bar segment
  const SEG = { y: 1.52, Rp: 0.62, fan: (80 * Math.PI) / 180, tilt: (16 * Math.PI) / 180 };
  const centre = [0, SEG.y, PRINT[2]];
  const h = PRINT[1] - SEG.y;
  const L = Math.hypot(SEG.Rp, h);
  {
    // A crescent casting in plan, with two arms running back to the wall behind it.
    const s = new THREE.Shape();
    const Ro = SEG.Rp + 0.1;
    const Ri = SEG.Rp - 0.1;
    const steps = 30;
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (i / steps) * Math.PI;
      const x = Math.sin(a) * Ro; const z = centre[2] + Math.cos(a) * Ro;
      if (i === 0) s.moveTo(x, -z); else s.lineTo(x, -z);
    }
    s.lineTo(Ro, 1.0);
    s.lineTo(Ri, 1.0);
    for (let i = steps; i >= 0; i--) {
      const a = -Math.PI / 2 + (i / steps) * Math.PI;
      s.lineTo(Math.sin(a) * Ri, -(centre[2] + Math.cos(a) * Ri));
    }
    s.lineTo(-Ri, 1.0);
    s.lineTo(-Ro, 1.0);
    const g = shapeSolid(s, 0.11, { bevel: 0.012, curve: 4 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, SEG.y - 0.05, 0);
    E.push({ geometry: g, color: BLACK });
    // The fulcrum wire every bar turns on, and the padded rest at their tips.
    const arc = (R, y, from, to, n = 40) => Array.from({ length: n + 1 }, (_, i) => {
      const a = mix(from, to, i / n);
      return [Math.sin(a) * R, y, centre[2] + Math.cos(a) * R];
    });
    pipe(M, STEEL, arc(SEG.Rp, SEG.y, -1.5, 1.5), 0.014, { sides: 6, steps: 60 });
    const Rrest = SEG.Rp + L * Math.cos(SEG.tilt) + 0.0;
    const yRest = SEG.y + L * Math.sin(SEG.tilt) - 0.055;
    pipe(R, 0x3a2a1c, arc(Rrest - 0.04, yRest, -SEG.fan - 0.06, SEG.fan + 0.06, 40), 0.042, { sides: 8, steps: 60, section: () => [1, 0.7] });
    // Posts carrying the rest down to the plates and the floor.
    for (const a of [-1.3, -0.8, 0, 0.8, 1.3]) {
      const x = Math.sin(a) * (Rrest - 0.04);
      const z = centre[2] + Math.cos(a) * (Rrest - 0.04);
      rod(M, DARKSTEEL, [x, yRest, z], [x * 0.96, 0.62, z], 0.02, { sides: 7 });
    }
    pipe(E, BLACK, [[-1.72, 0.62, 1.32], [0, 0.62, 1.34], [1.72, 0.62, 1.32]], 0.05, { sides: 8, steps: 12 });
  }

  // ------------------------------------------------------------- key, lever, link and type bar
  const sorted = [...layout.keys].sort((a, b) => a.x - b.x || a.z - b.z);
  const N = sorted.length;
  const struck = sorted.find((k) => k.label === 'E');
  const dotTop = (k, depressed) => {
    const r = k.typing ? 0.108 : 0.095;
    const y = k.y - (depressed ? 0.075 : 0);
    // The nickel rim: a turned ring whose bore holds the glass.
    const rim = spin([[0, -0.03], [r, -0.03], [r + 0.004, -0.01], [r + 0.002, 0.024], [r - 0.006, 0.032], [r - 0.012, 0.02], [0, 0.015]], { segments: 22 });
    rim.rotateX(0.14);
    rim.translate(k.x, y, k.z);
    M.push({ geometry: rim, color: NICKEL });
    // The glass: a shallow dome with the letter under it, mapped straight down so it stays square.
    const R0 = r - 0.009;
    const dome = spin([[0, 0.0], [R0, 0.0], [R0, 0.016], [R0 * 0.94, 0.026], [R0 * 0.72, 0.038], [R0 * 0.38, 0.044], [0, 0.046]], { segments: 22 });
    const pos = dome.attributes.position;
    const uv = dome.attributes.uv;
    const c = atlas.cell;
    const u0 = k.cell.x / atlas.S;
    const v0 = 1 - (k.cell.y + atlas.cell * atlas.S) / atlas.S;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, u0 + (pos.getX(i) / (2 * R0) + 0.5) * c, v0 + (-pos.getZ(i) / (2 * R0) + 0.5) * c);
    }
    dome.rotateX(0.14);
    dome.translate(k.x, y, k.z);
    A.push({ geometry: dome, color: 0xffffff });
    return y;
  };
  sorted.forEach((k, idx) => {
    const down = k === struck;
    const yk = dotTop(k, down);
    const xf = mix(-1.42, 1.42, idx / (N - 1));
    const yTip = 0.47 + (3 - k.r) * 0.03 - (down ? 0.075 : 0);
    const fulcrum = [xf, 0.34, -0.42];
    const tip = [k.x, yTip, k.z + 0.02];
    rod(M, NICKEL, [k.x, yk - 0.01, k.z], [k.x, yTip + 0.02, k.z + 0.02], 0.014, { sides: 6 });
    bar(M, STEEL, tip, fulcrum, 0.018, 0.06);
    // The type bar.
    const a = -SEG.fan + (idx / (N - 1)) * SEG.fan * 2;
    const rad = [Math.sin(a), 0, Math.cos(a)];
    const pivot = [rad[0] * SEG.Rp, SEG.y, centre[2] + rad[2] * SEG.Rp];
    let dir;
    let tipPoint;
    if (down) {
      const to = vec(PRINT).add(new THREE.Vector3(0, 0, 0.03)).sub(vec(pivot));
      const len = to.length();
      dir = to.normalize();
      tipPoint = vec(pivot).addScaledVector(dir, len);
    } else {
      dir = new THREE.Vector3(rad[0] * Math.cos(SEG.tilt), Math.sin(SEG.tilt), rad[2] * Math.cos(SEG.tilt));
      tipPoint = vec(pivot).addScaledVector(dir, L);
    }
    const tangent = new THREE.Vector3(rad[2], 0, -rad[0]);
    const up = new THREE.Vector3().crossVectors(dir, tangent).normalize();
    if (up.y < 0 && !down) up.negate();
    const heel = vec(pivot).addScaledVector(dir, -0.14).addScaledVector(up, -0.07);
    const A0 = [heel.x, heel.y, heel.z];
    bar(M, down ? NICKEL : STEEL, A0, [pivot[0], pivot[1], pivot[2]], 0.02, 0.05, { up: [up.x, up.y, up.z] });
    bar(M, down ? NICKEL : STEEL, pivot, [tipPoint.x, tipPoint.y, tipPoint.z], 0.02, 0.05, { up: [up.x, up.y, up.z] });
    // The slug: a little block with a letter on its face, brazed to the bar's end.
    const slugA = tipPoint.clone().addScaledVector(dir, -0.06);
    bar(M, down ? GOLD : NICKEL, [slugA.x, slugA.y, slugA.z], [tipPoint.x, tipPoint.y, tipPoint.z], 0.036, 0.066, { up: [up.x, up.y, up.z], chamfer: 0.006 });
    // The link: from the key lever up to the heel of the bar.
    const t = clamp01((k.z - 0.62) / (k.z - fulcrum[2]));
    const lever = [mix(k.x, fulcrum[0], t), mix(yTip, fulcrum[1], t) + 0.02, mix(k.z, fulcrum[2], t)];
    rod(M, DARKSTEEL, lever, A0, 0.009, { sides: 5 });
    dot(M, DARKSTEEL, 0.016, A0, { sides: 6 });
    dot(M, DARKSTEEL, 0.018, lever, { sides: 6 });
  });
  for (const k of layout.extras) {
    const yk = dotTop(k, false);
    rod(M, NICKEL, [k.x, yk - 0.01, k.z], [k.x, 0.46, k.z + 0.02], 0.014, { sides: 6 });
    bar(M, STEEL, [k.x, 0.46, k.z + 0.02], [k.x * 0.95, 0.34, -0.42], 0.018, 0.06);
  }
  // The fulcrum rail behind, and a comb keeping the levers in their rows.
  rod(M, STEEL, [-hx, 0.34, -0.42], [hx, 0.34, -0.42], 0.03, { sides: 10 });
  bar(E, BLACK, [-hx + 0.05, 0.3, 1.26], [hx - 0.05, 0.3, 1.26], 0.09, 0.14, { chamfer: 0.012 });

  // The space bar on its two arms.
  {
    const z = 2.86; const y = 0.56;
    bar(M, NICKEL, [-1.08, y, z], [1.08, y, z], 0.1, 0.05, { chamfer: 0.012 });
    bar(E, BLACK, [-1.1, y + 0.03, z], [1.1, y + 0.03, z], 0.085, 0.03, { chamfer: 0.012, up: [0, 1, 0] });
    for (const sx of [-1, 1]) {
      bar(M, STEEL, [sx * 0.95, y - 0.02, z], [sx * 1.5, 0.34, -0.42], 0.03, 0.05);
    }
  }

  // ------------------------------------------------------------- the rails and the carriage
  const charPitch = 0.05;
  const sheetW = 2.83;
  const margin = 0.3;
  const typed = TW_LINES[TW_LINES.length - 1].length;
  // The carriage has travelled left, so the very next column sits at x = 0.
  const cx = sheetW / 2 - margin - typed * charPitch - charPitch / 2;
  for (const z of [-0.92, -0.2]) {
    rod(M, NICKEL, [-hx, 2.1, z], [hx, 2.1, z], 0.032, { sides: 12 });
    for (const sx of [-1, 1]) {
      E.push({ geometry: new THREE.BoxGeometry(0.1, 0.13, 0.12), color: BLACK, position: [sx * (hx - 0.03), 2.07, z] });
    }
  }
  for (const sx of [-1, 1]) {
    // Each end plate, a rounded casting carrying the platen's shaft.
    const s = new THREE.Shape();
    s.moveTo(-1.0, 2.04);
    s.lineTo(-0.14, 2.04);
    s.bezierCurveTo(-0.08, 2.3, -0.1, 2.5, -0.26, 2.62);
    s.bezierCurveTo(-0.38, 2.72, -0.68, 2.72, -0.78, 2.6);
    s.bezierCurveTo(-0.9, 2.46, -1.0, 2.26, -1.0, 2.04);
    const g = shapeSolid(s, 0.08, { bevel: 0.012, curve: 10 });
    g.rotateY(-Math.PI / 2);
    g.translate(cx + sx * 1.72, 0, 0);
    E.push({ geometry: g, color: BLACK2 });
    fineLine(M, GOLD, [[-0.22, 2.1], [-0.17, 2.34], [-0.34, 2.58], [-0.72, 2.56], [-0.88, 2.32], [-0.92, 2.1]].map(([z, y]) => [cx + sx * 1.762, y, z]), 0.006, { closed: true });
    // The knob, knurled: a ring of real teeth, not a stripe.
    const knob = extrudeOutline(gearOutline(0.17, 26, { toothDepth: 0.014, tipRatio: 0.5 }), 0.17);
    knob.rotateY(Math.PI / 2);
    knob.translate(cx + sx * 1.92, PLATEN.y, PLATEN.z);
    R.push({ geometry: knob, color: RUBBER });
    R.push({ geometry: onX(spin([[0, -0.02], [0.13, -0.02], [0.15, 0.0], [0.15, 0.02], [0.13, 0.04], [0, 0.04]], { segments: 22 }), sx), color: 0x1d1d22, position: [cx + sx * 2.0, PLATEN.y, PLATEN.z] });
    rod(M, NICKEL, [cx + sx * 1.6, PLATEN.y, PLATEN.z], [cx + sx * 1.84, PLATEN.y, PLATEN.z], 0.05, { sides: 12 });
  }
  // The carriage's two long bars tie the plates together.
  bar(E, BLACK2, [cx - 1.72, 2.13, -0.9], [cx + 1.72, 2.13, -0.9], 0.13, 0.13, { chamfer: 0.016 });
  bar(E, BLACK2, [cx - 1.72, 2.12, -0.19], [cx + 1.72, 2.12, -0.19], 0.08, 0.08, { chamfer: 0.012 });
  // The platen, hard rubber, with a faint sheen, on its shaft.
  {
    const g = onX(spin([[0, -PLATEN.half], [PLATEN.r * 0.97, -PLATEN.half], [PLATEN.r, -PLATEN.half + 0.012], [PLATEN.r, PLATEN.half - 0.012], [PLATEN.r * 0.97, PLATEN.half], [0, PLATEN.half]], { segments: 56 }));
    g.translate(cx, PLATEN.y, PLATEN.z);
    R.push({ geometry: g, color: 0x1a1a1c });
  }
  // The escapement rack and its wheel under the carriage's rear bar, showing how it steps.
  {
    const rack = [];
    const n = 62;
    const span = 3.2;
    for (let i = 0; i < n; i++) {
      const x = cx - span / 2 + (i / (n - 1)) * span;
      const tri = new THREE.BoxGeometry(0.018, 0.05, 0.03);
      rack.push({ geometry: tri, color: NICKEL, position: [x, 2.04, -0.72] });
    }
    M.push(...rack);
    bar(M, STEEL, [cx - 1.65, 2.09, -0.72], [cx + 1.65, 2.09, -0.72], 0.04, 0.05);
    const wheel = extrudeOutline(gearOutline(0.13, 20, { toothDepth: 0.03 }), 0.03);
    wheel.rotateY(Math.PI / 2);
    wheel.translate(0.14, 1.9, -0.72);
    M.push({ geometry: wheel, color: GOLD });
    rod(M, DARKSTEEL, [0.14 - 0.1, 1.9, -0.72], [0.14 + 0.1, 1.9, -0.72], 0.02, { sides: 8 });
    block(E, BLACK, 0.06, 0.34, 0.08, [0.14 + 0.09, 1.76, -0.72]);
    block(E, BLACK, 0.06, 0.34, 0.08, [0.14 - 0.09, 1.76, -0.72]);
    // The mainspring drum at the rear, with its strap to the carriage.
    const drum = spin([[0, -0.1], [0.3, -0.1], [0.32, -0.08], [0.32, 0.08], [0.3, 0.1], [0, 0.1]], { segments: 30 });
    drum.translate(1.22, 1.18, -0.74);
    M.push({ geometry: drum, color: 0x6e7278 });
    rod(M, DARKSTEEL, [1.22, 0.2, -0.74], [1.22, 1.3, -0.74], 0.03, { sides: 8 });
    bar(M, DARKSTEEL, [1.54, 1.18, -0.74], [1.7, 2.1, -0.74], 0.012, 0.09);
  }
  // A paper table behind, to carry the sheet: a plate curving back, with a gold line.
  const TZ = PLATEN.z + PLATEN.r * Math.cos((28 * Math.PI) / 180);
  const TY = PLATEN.y + PLATEN.r * Math.sin((28 * Math.PI) / 180);
  const leave = (28 * Math.PI) / 180;
  const tdir = [-Math.sin(leave), Math.cos(leave)]; // (z, y) of the sheet leaving the platen
  {
    const table = closedSheet({
      nu: 10, nv: 18,
      point: (u, v) => {
        const s = v * 1.62;
        return [cx + (u - 0.5) * 3.16, TY + 0.02 + tdir[1] * s, TZ - 0.062 + tdir[0] * s - 0.12 * v * v];
      },
      half: () => 0.012,
    });
    E.push({ geometry: table, color: BLACK2 });
    // Two arms from the carriage up to it.
    for (const sx of [-1, 1]) {
      pipe(E, BLACK2, [[cx + sx * 1.6, 2.5, -0.74], [cx + sx * 1.6, 2.68, -0.72], [cx + sx * 1.56, TY + 0.5, TZ - 0.062 + tdir[0] * 0.54 - 0.02]], 0.03, { sides: 7, steps: 14 });
    }
    // Lining on the table's back, which is what the rear of the machine shows.
    const onTable = (x, q) => [cx + x, TY + 0.02 + tdir[1] * q * 1.62, TZ - 0.062 + tdir[0] * q * 1.62 - 0.12 * q * q - 0.012];
    fineLine(M, GOLD, [onTable(-1.48, 0.06), onTable(1.48, 0.06), onTable(1.48, 0.25), onTable(1.48, 0.5), onTable(1.48, 0.75), onTable(1.48, 0.94), onTable(-1.48, 0.94), onTable(-1.48, 0.75), onTable(-1.48, 0.5), onTable(-1.48, 0.25)], 0.006, { closed: true });
  }

  // ------------------------------------------------------------- the sheet of paper
  const r1 = PLATEN.r + 0.012;
  const a0 = (-70 * Math.PI) / 180;
  const arcLen = r1 * (leave - a0);
  const leaf = 1.52;
  const sheetH = arcLen + leaf;
  const printS = r1 * (printA - a0); // the print line's distance along the sheet from its low edge
  const paperPoint = (u, v) => {
    const s = v * sheetH;
    const x = cx + (u - 0.5) * sheetW;
    if (s < arcLen) {
      const a = a0 + s / r1;
      return [x, PLATEN.y + r1 * Math.sin(a), PLATEN.z + r1 * Math.cos(a)];
    }
    const t = s - arcLen;
    const k = t / leaf;
    return [x, TY + 0.012 * Math.sin(leave) + tdir[1] * t, TZ + 0.012 * Math.cos(leave) + tdir[0] * t - 0.12 * k * k];
  };
  const paperGeo = closedSheet({ nu: 10, nv: 34, point: paperPoint, half: () => 0.006 });
  {
    // Only the face toward the student carries the typing: a sheet's back is blank.
    const nrm = paperGeo.attributes.normal;
    const uv = paperGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      if (nrm.getZ(i) < 0.05 && nrm.getY(i) > -0.2) uv.setXY(i, 0.98, 0.98);
    }
  }
  const paperTex = paperMap(360, sheetW, sheetH, printS, margin, charPitch, 0.17);
  const paper = meshFrom(paperGeo, { map: paperTex, vertexColors: false, roughness: 0.92, metalness: 0 });

  // The bail: a nickel rod across the sheet with two rubber rollers pressing it to the table.
  {
    const s = 0.476; // the blank row, so the bail does not sit across a typed line
    const by = TY + tdir[1] * s + 0.01;
    const bz = TZ + tdir[0] * s + 0.045;
    rod(M, NICKEL, [cx - 1.62, by, bz], [cx + 1.62, by, bz], 0.014, { sides: 8 });
    for (const sx of [-1, 1]) {
      R.push({ geometry: onX(spin([[0, -0.06], [0.03, -0.06], [0.035, -0.05], [0.035, 0.05], [0.03, 0.06], [0, 0.06]], { segments: 14 })), color: 0x1f1f22, position: [cx + sx * 0.82, by, bz] });
      pipe(M, NICKEL, [[cx + sx * 1.62, by, bz], [cx + sx * 1.66, by - 0.14, bz - 0.04], [cx + sx * 1.68, 2.56, -0.5]], 0.018, { sides: 6, steps: 14 });
    }
  }

  // The carriage-return lever on the left: a nickel arm with a black ball, bent toward the typist.
  {
    const x = cx - 1.76;
    pipe(M, NICKEL, [[x, 2.56, -0.48], [x - 0.09, 2.7, -0.36], [x - 0.13, 2.88, -0.06], [x - 0.04, 3.0, 0.26], [x + 0.12, 3.04, 0.44]], [0.04, 0.034, 0.03, 0.026, 0.024], { sides: 10, steps: 36 });
    dot(R, 0x141418, 0.08, [x + 0.14, 3.045, 0.47], { sides: 14 });
    dot(M, NICKEL, 0.06, [x, 2.56, -0.48], { sides: 10 });
    rod(M, NICKEL, [x, 2.56, -0.48], [x + 0.08, 2.56, -0.48], 0.03, { sides: 10 });
  }

  // ------------------------------------------------------------- the ribbon, on two spools
  {
    const spoolZ = 0.26;
    const spoolY = Y_DECK + 0.045;
    const spools = [[-1.42, 0.3], [1.42, 0.16]];
    for (const [x, wound] of spools) {
      const flange = 0.34;
      const h2 = 0.17;
      // Lower flange, wound ribbon, upper flange and the thumb-nut, one above another on a spindle.
      M.push({ geometry: spin([[0, 0], [flange, 0], [flange, 0.012], [0.02, 0.016], [0, 0.016]], { segments: 30 }), color: NICKEL, position: [x, spoolY, spoolZ] });
      R.push({ geometry: spin([[0, 0.012], [wound, 0.012], [wound, 0.012 + h2], [0, 0.012 + h2]], { segments: 30 }), color: INK, position: [x, spoolY, spoolZ] });
      M.push({ geometry: spin([[0, 0.012 + h2], [flange, 0.012 + h2], [flange, 0.024 + h2], [0.02, 0.028 + h2], [0, 0.028 + h2]], { segments: 30 }), color: NICKEL, position: [x, spoolY, spoolZ] });
      M.push({ geometry: spin([[0, 0], [0.05, 0], [0.05, 0.06], [0.03, 0.09], [0, 0.09]], { segments: 12 }), color: GOLD, position: [x, spoolY + 0.028 + h2, spoolZ] });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        dot(M, GOLD, 0.012, [x + Math.cos(a) * 0.24, spoolY + 0.03 + h2, spoolZ + Math.sin(a) * 0.24], { sides: 5 });
      }
    }
    const yb = spoolY + 0.1;
    // Off the near edge of each spool, round a guide post, up into the vibrator at the print point.
    const pathL = [
      [-1.42 + 0.26, yb, spoolZ - 0.2], [-1.0, yb + 0.03, -0.04], [-0.55, PRINT[1] - 0.2, -0.2], [-0.2, PRINT[1] - 0.18, PRINT[2] + 0.05], [-0.08, PRINT[1] - 0.05, PRINT[2] + 0.03], [0, PRINT[1] - 0.005, PRINT[2] + 0.024],
    ];
    const pathR = pathL.map(([x, y, z]) => [-x, y, z]).reverse();
    const curve = new THREE.CatmullRomCurve3([...pathL, ...pathR.slice(1)].map((p) => vec(p)), false, 'centripetal');
    const band = (lo, hi, color) => {
      const g = closedSheet({
        nu: 48, nv: 1,
        point: (u, v) => {
          const c = curve.getPoint(u);
          return [c.x, c.y + mix(lo, hi, v), c.z];
        },
        half: () => 0.0045,
      });
      R.push({ geometry: g, color });
    };
    band(-0.066, 0, RED);
    band(0, 0.066, INK);
    // The vibrator: a little nickel fork that lifts the ribbon at the moment of a strike.
    pipe(M, NICKEL, [[0.11, PRINT[1] - 0.09, PRINT[2] + 0.024], [0.09, PRINT[1] - 0.24, PRINT[2] + 0.05], [0, PRINT[1] - 0.42, PRINT[2] + 0.12]], 0.012, { sides: 6, steps: 12 });
    pipe(M, NICKEL, [[-0.11, PRINT[1] - 0.09, PRINT[2] + 0.024], [-0.09, PRINT[1] - 0.24, PRINT[2] + 0.05], [0, PRINT[1] - 0.42, PRINT[2] + 0.12]], 0.012, { sides: 6, steps: 12 });
    rod(M, DARKSTEEL, [0, PRINT[1] - 0.42, PRINT[2] + 0.12], [0, 1.76, -0.62], 0.012, { sides: 6 });
    for (const sx of [-1, 1]) {
      rod(M, NICKEL, [sx * 0.55, Y_DECK - 0.2, -0.235], [sx * 0.55, PRINT[1] - 0.1, -0.235], 0.018, { sides: 8 });
      bar(M, DARKSTEEL, [sx * 0.55, Y_DECK - 0.15, -0.24], [sx * 1.1, Y_DECK, -0.5], 0.05, 0.03);
    }
  }

  // The bell, on the rear wall where the margin stop trips it.
  {
    M.push({ geometry: spin([[0, 0.14], [0.03, 0.14], [0.13, 0.06], [0.17, 0.0], [0.15, 0], [0.11, 0.05], [0.0, 0.11]], { segments: 22 }), color: GOLD, position: [-1.22, 1.72, -0.86] });
    rod(M, DARKSTEEL, [-1.22, 1.3, -0.86], [-1.22, 1.86, -0.86], 0.02, { sides: 7 });
  }

  const zs = -1.0;
  const finish = (list, params, extra = (g) => g) => {
    if (!list.length) return null;
    const g = extra(mergeParts(list));
    g.translate(0, 0, zs);
    return meshFrom(g, params);
  };
  paperGeo.translate(0, 0, zs);
    return groupOf(
    finish(E, { roughness: 0.24, metalness: 0 }, (g) => {
      sheen(g, { add: 0.11, tint: [0.72, 0.8, 0.95], band: 0.05, bandY: 1.2, bandW: 0.5 });
      // Upright paint reflects the room, and gets paler toward the top of a panel: without this any face
      // turned from the sun is pure black, and reads as a hole in the machine rather than as enamel.
      const P = g.attributes.position; const C = g.attributes.color;
      for (let i = 0; i < P.count; i++) {
        const k = 0.016 + 0.018 * clamp01(P.getY(i) / 3.5);
        C.setXYZ(i, C.getX(i) + k * 0.86, C.getY(i) + k * 0.92, C.getZ(i) + k * 1.05);
      }
      return g;
    }),
    finish(M, { roughness: 0.34, metalness: 0.42 }),
    finish(R, { roughness: 0.62, metalness: 0 }),
    finish(A, { map: atlas.map, alphaTest: 0.5, roughness: 0.16, metalness: 0 }),
    paper,
  );
}

// ---------------------------------------------------------------------------
// Wind turbine: a modern land turbine at TRUE size, shown by the catalogue at 0.1
// ---------------------------------------------------------------------------
//
// A 330ft tower and 170ft blades, built true. THE NACELLE IS ENLARGED ABOUT 1.5 TIMES, on purpose: the
// card promises a cutaway, and at 1/10 a true nacelle is a four-foot box thirty feet overhead. It is
// also yawed about 50 degrees on its tower, as any turbine may be, so that its open side faces +Z and
// the rotor swings out to the left: the one pose that shows the cutaway and the rotor together.

function airfoilRing(t, ring, out) {
  // NACA-style thickness on a cosine spacing, blended to a circle at the root, where a blade bolts on.
  const rootness = 1 - sstep(t, 0.015, 0.14);
  const tau = mix(0.42, 0.155, sstep(t, 0.16, 0.8));
  const camber = 0.045 * sstep(t, 0.06, 0.24);
  for (let j = 0; j < ring; j++) {
    const th = (j / ring) * Math.PI * 2;
    const x = 0.5 * (1 + Math.cos(th)); // 1 at the trailing edge, 0 at the leading edge
    const up = th < Math.PI ? 1 : -1;
    const yt = 5 * tau * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    const yc = camber * 4 * x * (1 - x);
    const yFoil = yc + up * yt;
    const yCircle = 0.5 * Math.sin(th);
    out[j * 2] = x;
    out[j * 2 + 1] = mix(yFoil, yCircle, rootness);
  }
  return rootness;
}

function bladeGeometry(hubR, len) {
  const spans = 56;
  const ring = 34;
  const pos = [];
  const index = [];
  const sec = new Float32Array(ring * 2);
  const stations = [];
  for (let i = 0; i <= spans; i++) {
    // Rows bunched where the blade is changing shape fastest, at the root.
    const q = i / spans;
    stations.push(q < 0.5 ? 0.5 * Math.pow(q * 2, 1.7) : q);
  }
  for (const t of stations) {
    const rootness = airfoilRing(t, ring, sec);
    const chordOut = mix(14.5, 1.5, Math.pow(clamp01((t - 0.2) / 0.8), 0.78));
    const chord = mix(chordOut, 8.2, rootness);
    const twist = (mix(15, -1, Math.pow(clamp01((t - 0.12) / 0.88), 0.55)) * Math.PI) / 180;
    const xp = mix(0.3, 0.5, rootness);
    const cb = Math.cos(twist); const sb = Math.sin(twist);
    const R = hubR + t * len;
    const tipEase = t > 0.992 ? 0.55 : 1;
    for (let j = 0; j < ring; j++) {
      const x = sec[j * 2];
      const y = sec[j * 2 + 1];
      const a = (xp - x) * chord * tipEase; // toward the leading edge
      const b = y * chord * tipEase; // toward the suction face
      // Rotor frame: span +Y, travel +X (clockwise seen from upwind), wind from +Z.
      // Leading edge = cos(b) T + sin(b) W. Suction face looks downwind.
      pos.push(a * cb + b * sb, R, a * sb - b * cb);
    }
  }
  const rows = stations.length;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < ring; j++) {
      const j2 = (j + 1) % ring;
      index.push(i * ring + j, i * ring + j2, (i + 1) * ring + j2, i * ring + j, (i + 1) * ring + j2, (i + 1) * ring + j);
    }
  }
  const p0 = pos.length / 3;
  pos.push(0, hubR, 0);
  const p1 = pos.length / 3;
  pos.push(0, hubR + len + 0.3, 0);
  for (let j = 0; j < ring; j++) {
    const j2 = (j + 1) % ring;
    index.push(p0, j2, j);
    index.push(p1, (rows - 1) * ring + j, (rows - 1) * ring + j2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

// A round thing on an axis, along local z: `points` are [r, z] from the back to the front.
function zSpin(points, segments, x = 0, y = 0, z = 0) {
  const g = onZ(spin(points, { segments }));
  // rotateX(+90) sends +y to +z, as this file's convention says.
  g.translate(x, y, z);
  return g;
}

// One sheet for every label. The roof's underside is what a student on the ground looks at, so the
// four big parts are named there; the yaw drive, underneath everything, on the bedplate's own edge.
function nacelleLabels(roof, side) {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#e4e8e6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120,135,145,0.25)';
  for (let x = 0; x < W; x += 72) ctx.fillRect(x, 0, 3, 300);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const chip = (text, X, Y, color, maxW, start) => {
    const size = fitFont(ctx, text, maxW, start, 'bold $px Arial, sans-serif');
    const tw = ctx.measureText(text).width + 28;
    ctx.fillStyle = color;
    ctx.fillRect(X - tw / 2, Y - size * 0.78, tw, size * 1.56);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, X, Y + 2);
  };
  for (const { text, at, color } of roof) chip(text, at * W, 150, color, W * 0.27, 62);
  ctx.fillStyle = '#565c63';
  ctx.fillRect(0, 310, W, 100);
  chip(side.text, 350, 360, side.color, 560, 60);
  const t = texOf(canvas, THREE.SRGBColorSpace, false);
  t.anisotropy = 8;
  return { map: t, roofRect: [0, 1 - 300 / H, 1, 300 / H], sideRect: [0, 1 - 410 / H, 700 / W, 100 / H] };
}

// A thin closed slab whose every face shows one rectangle of a sheet. Its +Z face is the one to read.
function labelSlab(w, h, rect, basis) {
  const g = new THREE.BoxGeometry(w, h, 0.05);
  const [u0, v0, du, dv] = rect;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * du, v0 + uv.getY(i) * dv);
  g.applyMatrix4(basis);
  return g;
}

const ROTOR_SPIN = (11 * Math.PI) / 180;

function windTurbine() {
  const WHITE = 0xe2e5e4;
  const W = []; // tower, blades, the shell
  const K = []; // machinery in its clear colours
  const C = []; // concrete, gravel, ground things
  const towerH = 330;
  const nacelleYaw = (-46 * Math.PI) / 180;
  const rotorSpin = ROTOR_SPIN;

  // ------------------------------------------------------------- the pad
  C.push({ geometry: spin([[0, 0], [52, 0], [51.4, 0.5], [40, 0.9], [0, 0.9]], { segments: 64 }), color: 0x8d8778 });
  C.push({ geometry: spin([[0, 0.6], [17.5, 0.6], [17.5, 2.6], [16.7, 3.0], [0, 3.0]], { segments: 48 }), color: 0xb5b2aa });
  tintVertices(C[0].geometry, (x, y, z, out) => {
    const n = smoothNoise3(x * 0.18, 0, z * 0.18);
    const k = 0.32 + 0.1 * n;
    out[0] = k; out[1] = k * 0.96; out[2] = k * 0.88;
  });
  C[0].keepColor = true;
  // Pad-mounted transformer, in its usual green, where the buried cables come up.
  block(C, 0x47634c, 8, 7, 6.5, [20, 4.2, 26]);
  block(C, 0x3a5240, 8.4, 0.5, 6.9, [20, 7.8, 26]);
  block(C, 0xa4a198, 10, 1.2, 8.5, [20, 1.3, 26]);

  // ------------------------------------------------------------- the tower
  const baseY = 2.8;
  const tr = (y) => mix(7.4, 4.5, Math.pow(clamp01((y - baseY) / towerH), 0.85));
  const rows = [[0, baseY]];
  const flanges = [baseY + 4, 108, 212, towerH - 1.2];
  const ys = [];
  for (let y = baseY; y <= towerH; y += 13) ys.push(y);
  ys.push(towerH);
  for (const y of ys) rows.push([tr(y), y]);
  rows.push([0, towerH]);
  W.push({ geometry: spin(rows, { segments: 44 }), color: WHITE });
  for (const f of flanges) {
    W.push({ geometry: spin([[tr(f) - 0.3, f - 0.5], [tr(f) + 0.34, f - 0.5], [tr(f) + 0.34, f + 0.5], [tr(f) - 0.3, f + 0.5]], { segments: 44, closed: true }), color: 0xc9cdcd });
  }
  // The door, on the side toward +Z, with its steel stair: the one thing here at a person's size.
  {
    const doorAz = 0.34;
    const dz = Math.cos(doorAz);
    const dx = Math.sin(doorAz);
    const R = tr(9) + 0.05;
    const place = (g, y) => {
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(doorAz));
      g.translate(dx * R, y, dz * R);
      return g;
    };
    const frame = shapeSolid(roundedShape(3.5, 7.6, 1.5), 0.6, { bevel: 0.08, curve: 8 });
    K.push({ geometry: place(frame, 10.1), color: 0xbfc4c5 });
    const door = shapeSolid(roundedShape(2.8, 6.8, 1.3), 0.3, { bevel: 0.04, curve: 8 });
    K.push({ geometry: place(door.translate(0, 0, 0.32), 10.1), color: 0x54626a });
    // A landing and a flight of steps, down to the footing.
    const out = (d, y, side = 0) => [dx * (R + d) + dz * side, y, dz * (R + d) - dx * side];
    bar(K, 0x8b9096, out(1.6, 6.2, 0), out(5.2, 6.2, 0), 5, 0.3, { up: [0, 1, 0] });
    for (let i = 0; i < 6; i++) {
      const q = i / 5;
      bar(K, 0x8b9096, out(5.8 + q * 6, mix(5.3, 3.3, q), -1.7), out(5.8 + q * 6, mix(5.3, 3.3, q), 1.7), 0.8, 0.14);
    }
    for (const s of [-2.1, 2.1]) {
      rod(K, 0xcdb54a, out(1.0, 6.2, s), out(1.0, 9.8, s), 0.1, { sides: 6 });
      rod(K, 0xcdb54a, out(5.3, 6.2, s), out(5.3, 9.8, s), 0.1, { sides: 6 });
      rod(K, 0xcdb54a, out(1.0, 9.8, s), out(5.3, 9.8, s), 0.1, { sides: 6 });
      rod(K, 0xcdb54a, out(5.3, 9.8, s), out(12.3, 6.1, s), 0.1, { sides: 6 });
      rod(K, 0x8b9096, out(5.3, 6.2, s), out(12.3, 2.9, s), 0.14, { sides: 6 });
      rod(K, 0xcdb54a, out(12.3, 6.1, s), out(12.3, 2.9, s), 0.1, { sides: 6 });
      rod(K, 0x8b9096, out(5.2, 6.1, s), out(5.2, 2.9, s), 0.16, { sides: 6 });
    }
  }

  // ------------------------------------------------------------- the nacelle, in its own frame
  // Local +Z is the rotor end, local +X the side left open. Everything below is yawed as one.
  const N0 = towerH + 4; // the underside of the bedplate's floor
  const NW = []; // white shell
  const NK = []; // machinery
  const halfW = 11;
  const shellH = 21;
  const zBack = -44;
  const zFront = 22;
  {
    // A C-section: the far wall, the whole roof and half the floor. No near wall at all.
    const cut = 3.0; // how far past the centre line the roof and the floor are kept
    const t = 0.7;
    const r = 3.2;
    const s = new THREE.Shape();
    s.moveTo(cut, 0);
    s.lineTo(-halfW + r, 0);
    s.quadraticCurveTo(-halfW, 0, -halfW, r);
    s.lineTo(-halfW, shellH - r);
    s.quadraticCurveTo(-halfW, shellH, -halfW + r, shellH);
    s.lineTo(cut + 5, shellH);
    s.lineTo(cut + 5, shellH - t);
    s.lineTo(-halfW + r, shellH - t);
    s.quadraticCurveTo(-halfW + t, shellH - t, -halfW + t, shellH - r);
    s.lineTo(-halfW + t, r);
    s.quadraticCurveTo(-halfW + t, t, -halfW + r, t);
    s.lineTo(cut, t);
    s.lineTo(cut, 0);
    const g = shapeSolid(s, zFront - zBack, { bevel: 0.1, curve: 6 });
    g.translate(0, N0, (zFront + zBack) / 2);
    NW.push({ geometry: g, color: WHITE });
    // The rear end wall, and a nose that hides the main bearing's casting from the weather.
    const rear = new THREE.Shape();
    rear.moveTo(-halfW + r, 0);
    rear.lineTo(cut, 0);
    rear.lineTo(cut + 5, shellH);
    rear.lineTo(-halfW + r, shellH);
    rear.quadraticCurveTo(-halfW, shellH, -halfW, shellH - r);
    rear.lineTo(-halfW, r);
    rear.quadraticCurveTo(-halfW, 0, -halfW + r, 0);
    const rg = shapeSolid(rear, 0.9, { bevel: 0.1, curve: 6 });
    rg.translate(0, N0, zBack + 0.45);
    NW.push({ geometry: rg, color: WHITE });
    // The cut itself is painted, the way a drawing paints a section: nobody can take it for a panel missing.
    const red = 0xd8382a;
    const zA = zBack; const zB = zFront;
    for (const [y, x] of [[N0 + t / 2, cut], [N0 + shellH - t / 2, cut + 5]]) {
      bar(NK, red, [x + 0.06, y, zA], [x + 0.06, y, zB], 0.2, t + 0.18);
    }
    bar(NK, red, [cut + 0.06, N0, zBack + 0.45], [cut + 5.06, N0 + shellH, zBack + 0.45], 0.18, 1.1, { up: [0, 0, 1] });
    bar(NK, red, [cut + 0.06, N0, zFront], [cut + 5.06, N0 + shellH, zFront], 0.2, 0.3, { up: [0, 0, 1] });
    // Roof vents and the weather mast at the back.
    const rearZ = zBack + 7;
    rod(NK, 0x8b9096, [-3, N0 + shellH, rearZ], [-3, N0 + shellH + 8, rearZ], 0.18, { sides: 7 });
    bar(NK, 0x8b9096, [-3, N0 + shellH + 8, rearZ - 3], [-3, N0 + shellH + 8, rearZ + 3], 0.25, 0.25);
    // A wind vane at one end, cups at the other: the two instruments that tell it where to face.
    bar(NK, 0x30343a, [-3, N0 + shellH + 9, rearZ - 4], [-3, N0 + shellH + 9, rearZ - 1], 0.14, 1.1);
    rod(NK, 0x30343a, [-3, N0 + shellH + 8, rearZ - 3], [-3, N0 + shellH + 9.4, rearZ - 3], 0.1, { sides: 6 });
    rod(NK, 0x30343a, [-3, N0 + shellH + 8, rearZ + 3], [-3, N0 + shellH + 9, rearZ + 3], 0.1, { sides: 6 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const c = [-3 + Math.cos(a) * 1.1, N0 + shellH + 9, rearZ + 3 + Math.sin(a) * 1.1];
      rod(NK, 0x30343a, [-3, N0 + shellH + 9, rearZ + 3], c, 0.06, { sides: 5 });
      dot(NK, 0x30343a, 0.42, c, { sides: 8 });
    }
    dot(NK, 0xe0202a, 0.7, [-7.5, N0 + shellH + 0.9, rearZ + 2], { sides: 10 }); // aviation light
  }
  // Bedplate: the steel floor everything is bolted to, wider near the tower.
  const yBed = N0 + 3.6;
  {
    const s = new THREE.Shape();
    s.moveTo(-7.4, -20);
    s.lineTo(7.4, -20);
    s.lineTo(7.4, 10);
    s.lineTo(5.6, 34);
    s.lineTo(-5.6, 34);
    s.lineTo(-7.4, 10);
    s.lineTo(-7.4, -20);
    const g = shapeSolid(s, 2.1, { bevel: 0.1, curve: 4 });
    g.rotateX(-Math.PI / 2); // shape y becomes world -z
    g.translate(0, yBed - 1.05, 0);
    NK.push({ geometry: g, color: 0x565c63 });
    // Under the bedplate, down to the yaw ring on the tower's head.
    NK.push({ geometry: spin([[0, 0], [6.1, 0], [6.1, yBed - N0 - 1], [0, yBed - N0 - 1]], { segments: 36 }), color: 0x3f454c, position: [0, N0, 0] });
  }
  // The main shaft: from the hub flange, through its bearing, into the gearbox.
  const axisY = yBed + 7.5;
  const ORANGE = 0xef7d1a;
  const BLUE = 0x1f6fd0;
  const GREEN = 0x1fa45a;
  const YELLOW = 0xf4c419;
  const RED = 0xd8302a;
  const PURPLE = 0x8b4ec9;
  NK.push({ geometry: zSpin([[0, 6], [2.8, 6], [2.8, 22], [3.8, 23], [3.8, 25], [0, 25]], 28, 0, axisY), color: ORANGE });
  // Main bearing and its pedestal.
  NK.push({ geometry: zSpin([[0, 13.4], [4.3, 13.4], [5.0, 14.2], [5.0, 18], [4.3, 18.8], [0, 18.8]], 28, 0, axisY), color: 0x59626c });
  block(NK, 0x4e565f, 7.4, 6.4, 4.6, [0, yBed + 2.9, 16.1]);
  // The gearbox: a planet stage in its big round housing, then a smaller parallel stage behind.
  {
    NK.push({
      geometry: zSpin([[0, -7], [5.0, -7], [6.0, -6], [6.0, -1.2], [6.8, -0.6], [6.8, 0.2], [6.0, 0.8], [6.0, 8], [5.0, 9], [0, 9]], 36, 0, axisY),
      color: BLUE,
    });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const r = 6.25;
      bar(NK, 0x185aa8, [Math.cos(a) * r, axisY + Math.sin(a) * r, 1.6], [Math.cos(a) * r, axisY + Math.sin(a) * r, 7.6], 0.5, 0.42, { up: [Math.cos(a), Math.sin(a), 0], chamfer: 0.08 });
    }
    // The torque arms carrying it on the bedplate.
    for (const sx of [-1, 1]) {
      bar(NK, 0x185aa8, [sx * 4.2, axisY - 2, 2], [sx * 7.2, yBed + 0.6, 2], 2.4, 1.3, { up: [0, 0, 1] });
    }
    block(NK, 0x2d80e0, 8.4, 8.6, 5.6, [0, axisY - 2.8, -9.3]);
    NK.push({ geometry: zSpin([[0, -12.4], [2.2, -12.4], [2.2, -6], [0, -6]], 20, 0, axisY - 4.6), color: 0x185aa8 });
  }
  // The brake and the fast shaft, between gearbox and generator. Thin and quick, and yellow.
  {
    const y = axisY - 4.6;
    NK.push({ geometry: zSpin([[0, -24], [0.9, -24], [0.9, -11], [0, -11]], 16, 0, y), color: YELLOW });
    NK.push({ geometry: zSpin([[0, -15.2], [4.2, -15.2], [4.2, -14.4], [0, -14.4]], 34, 0, y), color: RED });
    // The caliper gripping the disc's top.
    block(NK, 0x8b1f1a, 1.9, 2.2, 2.4, [0, y + 3.5, -14.8]);
    block(NK, 0x4e565f, 1.5, y - yBed + 3.5, 1.4, [3.2, (y + 3.5 + yBed) / 2, -14.8]);
    bar(NK, 0x8b1f1a, [3.2, y + 3.5, -14.8], [0.8, y + 3.5, -14.8], 1.3, 1.3);
  }
  // The generator: a long finned casing, on four feet.
  {
    const y = axisY - 4.6;
    const pts = [[0, -38], [3.6, -38], [4.6, -37], [4.6, -24.6], [3.6, -23.8], [0, -23.8]];
    NK.push({ geometry: zSpin(pts, 40, 0, y), color: GREEN });
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      bar(NK, 0x168246, [Math.cos(a) * 4.7, y + Math.sin(a) * 4.7, -36.6], [Math.cos(a) * 4.7, y + Math.sin(a) * 4.7, -25], 0.28, 0.56, { up: [Math.cos(a), Math.sin(a), 0] });
    }
    NK.push({ geometry: zSpin([[0, -24], [4.9, -24], [4.9, -23.4], [0, -23.4]], 40, 0, y), color: 0x0f6a39 });
    NK.push({ geometry: zSpin([[0, -38.5], [3.0, -38.5], [3.0, -37.8], [0, -37.8]], 28, 0, y), color: 0x0f6a39 });
    for (const sx of [-1, 1]) {
      for (const z of [-27, -35]) {
        block(NK, 0x0f6a39, 1.4, y - yBed - 2.2, 1.4, [sx * 3.0, (y - 3.4 + yBed) / 2, z]);
      }
    }
    // The bedplate's rear rails carry it where the plate itself stops.
    for (const sx of [-1, 1]) {
      bar(NK, 0x565c63, [sx * 5, yBed - 0.2, -20], [sx * 5, yBed - 0.2, -42], 2, 1.5);
    }
    // Its fat power cable, which runs to the bottom of the tower.
    pipe(NK, 0x22252a, [[3, y - 3, -38], [4.4, yBed + 1, -30], [3.4, yBed + 0.5, -10], [1.4, yBed - 0.5, -2], [0.7, N0 + 0.5, -0.5]], 0.45, { sides: 7, steps: 24 });
  }
  // The control cabinet and the cooler on the far wall.
  block(NK, 0xc5cbd0, 1.7, 8, 7, [-9.3, yBed + 4, -10]);
  block(NK, 0x8e969e, 1.6, 7, 6, [-9.3, yBed + 3.5, -33]);
  // The yaw drive. A big toothed ring on the tower's head, and four motors on the bedplate driving small
  // pinions round it, which is what turns the whole nacelle to face the wind.
  {
    const ringY = N0 - 1.6;
    const ring = extrudeOutline(gearOutline(7.4, 60, { toothDepth: 0.75 }), 1.5);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, ringY, 0);
    NK.push({ geometry: ring, color: PURPLE });
    for (const [x, z] of [[6.5, 7.2], [6.5, -7.2], [-6.5, 7.2], [-6.5, -7.2]]) {
      const pt = Math.hypot(x, z);
      const k = (7.4 + 1.1) / pt;
      const px = x * k; const pz = z * k;
      // Motor above the bedplate, gear case through it, pinion in mesh with the ring.
      NK.push({ geometry: spin([[0, 0], [1.25, 0], [1.25, 2.4], [1.45, 2.6], [1.45, 3.4], [1.25, 3.6], [1.25, 6.2], [0.9, 6.7], [0, 6.7]], { segments: 22 }), color: PURPLE, position: [px, yBed, pz] });
      rod(NK, 0x5f3a92, [px, ringY - 0.7, pz], [px, yBed + 0.2, pz], 0.95, { sides: 16 });
      const pinion = extrudeOutline(gearOutline(1.3, 10, { toothDepth: 0.65 }), 1.45);
      pinion.rotateX(Math.PI / 2);
      pinion.translate(px, ringY, pz);
      NK.push({ geometry: pinion, color: 0xb078e8 });
    }
  }
  // The neck between the tower's head and the yaw ring.
  NK.push({ geometry: spin([[0, towerH - 0.5], [5.6, towerH - 0.5], [5.6, N0 + 0.2], [0, N0 + 0.2]], { segments: 36 }), color: 0x3f454c });
  const roofW = 58;
  const roofD = 15.5;
  const labelSheet = nacelleLabels([
    { text: 'MAIN SHAFT', at: (18 - 11) / 58, color: '#c7620e' },
    { text: 'GEARBOX', at: (18 + 0.5) / 58, color: '#1b5fb4' },
    { text: 'BRAKE', at: (18 + 14.5) / 58, color: '#b5281f' },
    { text: 'GENERATOR', at: (18 + 30) / 58, color: '#158247' },
  ], { text: 'YAW DRIVE', color: '#6d3aa6' });
  // On the roof the sheet's right runs toward -Z and its top toward the open side: read from below,
  // the near edge of a ceiling is at the top of the view.
  const roofBasis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0));
  roofBasis.setPosition(0, N0 + shellH - 0.72, -11);
  const sideBasis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  sideBasis.setPosition(7.46, yBed, 0);
  const NL = [labelSlab(roofW, roofD, labelSheet.roofRect, roofBasis), labelSlab(13.6, 1.94, labelSheet.sideRect, sideBasis)];

  // ------------------------------------------------------------- the rotor
  const rotorZ = 34;
  const hubR = 6.8;
  const RW = [];
  {
    // Hub casting, then the spinner over it.
    RW.push({ geometry: zSpin([[0, -9], [6.4, -9], [8.0, -7], [8.3, -1], [7.7, 3], [6.2, 7], [4.0, 10.6], [1.6, 12.8], [0, 13.2]], 40), color: WHITE });
    pitchBearings(RW, hubR);
    const blade = bladeGeometry(hubR - 0.5, 170 - hubR + 0.5);
    for (let k = 0; k < 3; k++) {
      const a = rotorSpin + (k / 3) * Math.PI * 2;
      const g = blade.clone().applyMatrix4(new THREE.Matrix4().makeRotationZ(-a));
      RW.push({ geometry: g, color: 0xeef0ef });
    }
    // The rear of the spinner and a hub nose ring: grey so the joint to the nacelle reads.
    RW.push({ geometry: zSpin([[0, -11], [4.4, -11], [4.4, -9], [0, -9]], 28), color: 0x7c848c });
  }
  const yawM = new THREE.Matrix4().makeRotationY(nacelleYaw);
  const toWorld = (list, target) => {
    for (const part of list) {
      const g = mergeParts([part]);
      g.applyMatrix4(yawM);
      target.push({ geometry: g, keepColor: true });
    }
  };
  toWorld(NW, W);
  toWorld(NK, K);
  for (const part of RW) {
    const g = mergeParts([part]);
    g.translate(0, axisY, rotorZ);
    g.applyMatrix4(yawM);
    W.push({ geometry: g, keepColor: true });
  }
  const labelGeo = mergeParts(NL.map((geometry) => ({ geometry, color: 0xffffff })));
  labelGeo.applyMatrix4(yawM);
  const labels = meshFrom(labelGeo, { map: labelSheet.map, roughness: 0.7, metalness: 0 }, { shadow: false });
  return groupOf(
    meshFrom(mergeParts(W), { roughness: 0.42, metalness: 0 }),
    meshFrom(mergeParts(K), { roughness: 0.44, metalness: 0.12 }),
    meshFrom(mergeParts(C), { roughness: 0.92, metalness: 0 }),
    labels,
  );
}

// The three pitch bearings where the blades bolt on: dark rings at the root.
function pitchBearings(list, hubR) {
  for (let k = 0; k < 3; k++) {
    const a = ROTOR_SPIN + (k / 3) * Math.PI * 2;
    const g = spin([[0, hubR - 2.3], [5.0, hubR - 2.3], [5.0, hubR - 0.7], [4.55, hubR - 0.5], [0, hubR - 0.5]], { segments: 30 });
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(-a));
    list.push({ geometry: g, color: 0x7c848c });
  }
}

// A door's outline: a rounded rectangle centred on the origin in x, y.
function roundedShape(w, h, r) {
  const s = new THREE.Shape();
  const hw = w / 2; const hh = h / 2;
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + r);
  s.lineTo(hw, hh - r);
  s.quadraticCurveTo(hw, hh, hw - r, hh);
  s.lineTo(-hw + r, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - r);
  s.lineTo(-hw, -hh + r);
  s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return s;
}

// ---------------------------------------------------------------------------
// Roman racing chariot: wood and leather, life size, pole along +Z
// ---------------------------------------------------------------------------
//
// What survives of the real thing points to a very light frame with a fabric or leather shell, wheels
// perhaps rimmed in iron, and metal kept to the smallest fittings. So the breastwork is painted hide
// laced over bent ash, and the only metal here is the tyres, the hub bands, the linchpins and the
// rein rings. The team is the Greens. With no horses it would tip forward, so a forked prop carries
// the pole, as one would in a stable.

// A closed plate with a real rim, measured outward. A two-sided rim like solidSurface's nets to nothing
// in a signed volume, and then neither `outward` nor a check can trust the answer.
function closedSheet({ nu, nv, point, half }) {
  const rows = nv + 1;
  const cols = nu + 1;
  const mid = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) mid.push(vec(point(i / nu, j / nv)));
  const at = (i, j) => mid[Math.max(0, Math.min(cols - 1, i)) * rows + Math.max(0, Math.min(rows - 1, j))];
  const pos = [];
  const uv = [];
  const index = [];
  const du = new THREE.Vector3();
  const dv = new THREE.Vector3();
  for (const sign of [1, -1]) {
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        du.copy(at(i + 1, j)).sub(at(i - 1, j));
        dv.copy(at(i, j + 1)).sub(at(i, j - 1));
        const n = new THREE.Vector3().crossVectors(du, dv).normalize();
        const p = at(i, j);
        const h = half(i / nu, j / nv) * sign;
        pos.push(p.x + n.x * h, p.y + n.y * h, p.z + n.z * h);
        uv.push(i / nu, j / nv);
      }
    }
  }
  const top = (i, j) => i * rows + j;
  const bot = (i, j) => cols * rows + i * rows + j;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      index.push(top(i, j), top(i + 1, j), top(i + 1, j + 1), top(i, j), top(i + 1, j + 1), top(i, j + 1));
      index.push(bot(i, j), bot(i + 1, j + 1), bot(i + 1, j), bot(i, j), bot(i, j + 1), bot(i + 1, j + 1));
    }
  }
  for (let i = 0; i < nu; i++) {
    index.push(top(i, 0), bot(i, 0), bot(i + 1, 0), top(i, 0), bot(i + 1, 0), top(i + 1, 0));
    index.push(top(i, nv), top(i + 1, nv), bot(i + 1, nv), top(i, nv), bot(i + 1, nv), bot(i, nv));
  }
  for (let j = 0; j < nv; j++) {
    index.push(top(0, j), top(0, j + 1), bot(0, j + 1), top(0, j), bot(0, j + 1), bot(0, j));
    index.push(top(nu, j), bot(nu, j), bot(nu, j + 1), top(nu, j), bot(nu, j + 1), top(nu, j + 1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

// UVs laid along a direction, for a swept part with none of its own: the grain's streaks run in v.
function grainUV(g, dir, across, ku = 1.2, kv = 0.35) {
  const P = g.attributes.position;
  const uv = new Float32Array(P.count * 2);
  const d = vec(dir).normalize();
  const a = vec(across).normalize();
  const p = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i);
    uv[i * 2] = p.dot(a) * ku;
    uv[i * 2 + 1] = p.dot(d) * kv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const CH = {
  yFloor: 1.66,
  zc: -3.4,
  halfW: 1.56,
  depth: 1.86,
  H: 2.52,
};
// Breastwork in plan: a from -1 to 1 runs left rear, front, right rear.
function chariotPlan(a, grow = 0) {
  const ang = a * Math.PI * 0.5;
  const rr = 1 + grow;
  // A D: a slightly squared-off front, and straight sides running back.
  const x = Math.sin(ang) * CH.halfW * rr;
  const c = Math.cos(ang);
  const z = CH.zc + (c * CH.depth) * rr;
  return [x, z];
}
// Height of the top rail above the floor: tall at the front, sweeping down to the rear.
function chariotTop(a) {
  const q = Math.abs(a);
  return CH.H * (0.2 + 0.8 * (1 - sstep(q, 0.3, 1.0))) + 0.05 * (1 - q);
}

function chariotCanvas() {
  const W = 2048;
  const H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(146);
  const pxU = W; // one u
  const ftToV = 512 / (CH.H + 0.1); // canvas pixels per foot of height
  // Outer face is the canvas's lower half; inner the upper.
  ctx.fillStyle = '#a06d3d';
  ctx.fillRect(0, 512, W, 512);
  ctx.fillStyle = '#8b5c31';
  ctx.fillRect(0, 0, W, 512);
  // Hide is never one colour: broad blotches, then pores.
  for (let i = 0; i < 700; i++) {
    const x = rng() * W; const y = rng() * H; const r = 10 + rng() * 60;
    ctx.fillStyle = `rgba(${rng() > 0.5 ? '70,40,18' : '200,160,110'},${0.015 + rng() * 0.03})`;
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.5, r, rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  const Yf = (ft) => H - ft * ftToV;
  const uOfA = (a) => (a + 1) / 2;
  // The green field: everything from a low band to just under the rail, on the part tall enough to carry it.
  const GREEN = '#1a8048';
  const GREEN_DK = '#116037';
  const OCHRE = '#e0ac3e';
  const CREAM = '#efe2bf';
  const RED = '#94281c';
  const lim = 0.86;
  const fieldTop = (a) => Math.max(0.42, chariotTop(a) - 0.14);
  const poly = [];
  for (let i = 0; i <= 80; i++) { const a = -lim + (i / 80) * 2 * lim; poly.push([uOfA(a) * pxU, Yf(fieldTop(a))]); }
  ctx.beginPath();
  ctx.moveTo(uOfA(-lim) * pxU, Yf(0.3));
  for (const [x, y] of poly) ctx.lineTo(x, y);
  ctx.lineTo(uOfA(lim) * pxU, Yf(0.3));
  ctx.closePath();
  ctx.fillStyle = GREEN;
  ctx.fill();
  // Brush-laid paint: streaks of a darker and a lighter green inside the field, clipped to it.
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 500; i++) {
    const x = rng() * W; const y = 512 + rng() * 512;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(12,70,40,0.11)' : 'rgba(70,170,110,0.08)';
    ctx.lineWidth = 2 + rng() * 7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 60 + rng() * 140, y + (rng() - 0.5) * 16); ctx.stroke();
  }
  ctx.restore();
  // A double border of ochre and red, and lacing stitches, following the field's edge.
  const edge = (off, width, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const a = -lim + 0.012 + (i / 80) * 2 * (lim - 0.012);
      const y = Yf(fieldTop(a) - off);
      if (i === 0) ctx.moveTo(uOfA(a) * pxU, y); else ctx.lineTo(uOfA(a) * pxU, y);
    }
    ctx.stroke();
  };
  edge(0.035, 12, OCHRE);
  edge(0.09, 4, RED);
  // The lower band: a running wave of red on ochre, a colour pair any Roman painter had.
  {
    const y0 = Yf(0.3); const y1 = Yf(0.46);
    ctx.fillStyle = OCHRE;
    const x0 = uOfA(-lim) * pxU; const x1 = uOfA(lim) * pxU;
    ctx.fillRect(x0, y1, x1 - x0, y0 - y1);
    ctx.strokeStyle = RED;
    ctx.lineWidth = 7;
    const n = 34;
    const step = (x1 - x0) / n;
    const midY = (y0 + y1) / 2;
    const rad = (y0 - y1) * 0.35;
    for (let k = 0; k < n; k++) {
      const cx = x0 + (k + 0.5) * step;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const a = t * 8;
        const r = rad * (1 - t * 0.8);
        const px = cx + Math.cos(a) * r * 1.4;
        const py = midY + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = RED;
    ctx.fillRect(x0, y1 - 4, x1 - x0, 5);
    ctx.fillRect(x0, y0 - 1, x1 - x0, 5);
  }
  const CX = W / 2;
  const fy = Yf(1.46);
  const ftToU = W / 6.9; // one foot along the perimeter, in canvas pixels
  const sx = ftToU / ftToV; // a foot is wider in u than it is tall in v
  // The victor's wreath, laurel in two arcs, tied at the foot with a red ribbon.
  const leaf = (x, y, a, L, wd, fill) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, 1);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(L * 0.5, -wd, L, 0);
    ctx.quadraticCurveTo(L * 0.5, wd, 0, 0);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,35,10,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(L * 0.08, 0);
    ctx.lineTo(L * 0.88, 0);
    ctx.stroke();
    ctx.restore();
  };
  const wr = 148;
  for (const side of [-1, 1]) {
    for (let k = 0; k < 17; k++) {
      const q = k / 16;
      const a = Math.PI / 2 + side * (0.1 + q * 2.72);
      const px = CX + Math.cos(a) * wr * sx;
      const py = fy + Math.sin(a) * wr;
      const tang = a + side * Math.PI / 2;
      leaf(px, py, tang + side * 0.5, 46, 11, OCHRE);
      leaf(px, py, tang - side * 0.45 + (side > 0 ? 0 : 0), 42, 10, CREAM);
    }
  }
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.ellipse(CX, fy + wr + 2, 26 * sx, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + s * 8 * sx, fy + wr + 10);
    ctx.quadraticCurveTo(CX + s * 30 * sx, fy + wr + 42, CX + s * 16 * sx, fy + wr + 66);
    ctx.lineTo(CX + s * 36 * sx, fy + wr + 60);
    ctx.quadraticCurveTo(CX + s * 44 * sx, fy + wr + 30, CX + s * 18 * sx, fy + wr + 6);
    ctx.closePath();
    ctx.fill();
  }
  // Palm of victory, the second prize every winner carried, standing in the wreath.
  ctx.strokeStyle = CREAM;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(CX, fy + wr - 12);
  ctx.quadraticCurveTo(CX + 8 * sx, fy, CX - 4 * sx, fy - wr + 32);
  ctx.stroke();
  for (let k = 0; k < 13; k++) {
    const q = k / 12;
    const y = mix(fy + wr * 0.54, fy - wr * 0.72, q);
    const x = CX + 8 * sx * Math.sin(q * 3.1) - 2 * sx;
    const L = mix(56, 18, q * q);
    leaf(x, y, -0.62, L, 6, CREAM);
    leaf(x, y, -Math.PI + 0.62, L, 6, CREAM);
  }
  // A running horse each side, drawn in the flat manner of a painted wall.
  const horse = (cx, cy, s, dir) => {
    const pts = [
      [-0.50, 0.18], [-0.30, 0.24], [-0.05, 0.23], [0.09, 0.33], [0.21, 0.52], [0.27, 0.61], [0.285, 0.69], [0.32, 0.615], [0.42, 0.53], [0.56, 0.36], [0.615, 0.285], [0.57, 0.235], [0.47, 0.285], [0.35, 0.37], [0.25, 0.27], [0.2, 0.11],
      [0.32, 0.03], [0.47, -0.05], [0.53, -0.1], [0.45, -0.125], [0.27, -0.055], [0.12, -0.03], [0.21, -0.16], [0.3, -0.26], [0.25, -0.295], [0.11, -0.16], [0.02, -0.07], [-0.18, -0.07],
      [-0.24, -0.15], [-0.16, -0.27], [-0.2, -0.31], [-0.34, -0.18], [-0.38, -0.1], [-0.53, -0.21], [-0.67, -0.29], [-0.71, -0.245], [-0.56, -0.1], [-0.5, 0.02], [-0.54, 0.12],
    ];
    const X = (p) => cx + dir * p[0] * s * sx;
    const Y = (p) => cy - p[1] * s;
    ctx.beginPath();
    ctx.moveTo(X(pts[0]), Y(pts[0]));
    for (let i = 1; i <= pts.length; i++) {
      const p = pts[i % pts.length];
      const q = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(X(p), Y(p), (X(p) + X(q)) / 2, (Y(p) + Y(q)) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = CREAM;
    ctx.fill();
    ctx.strokeStyle = '#2a1608';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    // Mane, tail, eye, and a red breast-band: the marks that make a silhouette a horse in harness.
    ctx.strokeStyle = '#2a1608';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(X([-0.52, 0.16]), Y([-0.52, 0.16]));
    ctx.quadraticCurveTo(X([-0.76, 0.2]), Y([-0.76, 0.2]), X([-0.9, 0.02]), Y([-0.9, 0.02]));
    ctx.stroke();
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(X([0.26, 0.6]), Y([0.26, 0.6]));
    ctx.quadraticCurveTo(X([0.13, 0.46]), Y([0.13, 0.46]), X([0.02, 0.27]), Y([0.02, 0.27]));
    ctx.stroke();
    ctx.fillStyle = '#2a1608';
    ctx.beginPath();
    ctx.arc(X([0.38, 0.5]), Y([0.38, 0.5]), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = RED;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(X([0.13, 0.36]), Y([0.13, 0.36]));
    ctx.quadraticCurveTo(X([0.27, 0.22]), Y([0.27, 0.22]), X([0.18, 0.05]), Y([0.18, 0.05]));
    ctx.stroke();
  };
  const offU = 372;
  horse(CX + offU, Yf(1.08), 205, 1);
  horse(CX - offU, Yf(1.08), 205, -1);
  // Stitches along the panel seams, down each side.
  const stitches = (a) => {
    const x = uOfA(a) * pxU;
    ctx.fillStyle = '#3a2412';
    const top = chariotTop(a);
    for (let f = 0.08; f < top; f += 0.11) ctx.fillRect(x - 4, Yf(f) - 5, 8, 10);
    ctx.fillStyle = 'rgba(40,22,8,0.6)';
    ctx.fillRect(x - 1, Yf(top), 2, top * ftToV);
  };
  for (const a of [-0.95, -0.88, 0.88, 0.95]) stitches(a);
  // The inner face: plain hide with its seams, in the canvas's upper half.
  ctx.save();
  ctx.translate(0, -512);
  for (const a of [-0.88, -0.56, -0.2, 0.2, 0.56, 0.88]) stitches(a);
  ctx.restore();
  const map = texOf(canvas, THREE.SRGBColorSpace, false);
  map.anisotropy = 12;
  return map;
}

function romanChariot() {
  const ASH = 0xb99668;
  const OAK = 0x8a6238;
  const DARKWOOD = 0x5f3f22;
  const IRON = 0x4c4f53;
  const BRONZE = 0xae8a42;
  const STRAP = 0x6a4023;
  const STRAP2 = 0x52301a;
  const GREEN = 0x1b8a4b;
  const OCHRE = 0xd7a43a;
  const T = []; // timber
  const M = []; // the few metal fittings
  const L = []; // leather strap and cord
  const R0 = 1.46;
  const axleY = R0;
  const axleZ = -3.42;
  const xw = 2.28;

  const timberBar = (a, b, r, color = ASH, opts = {}) => {
    const g = tube([a, b], r, { sides: opts.sides ?? 10, steps: 2, straight: true, round: opts.round ?? 1 });
    const d = vec(b).sub(vec(a));
    const across = Math.abs(d.y) > 0.7 * d.length() ? [1, 0, 0] : [0, 1, 0];
    grainUV(g, d.toArray(), across);
    T.push({ geometry: g, color });
  };

  // ------------------------------------------------------------- the wheels
  for (const side of [-1, 1]) {
    const x = side * xw;
    // Iron tyre: a band only a little proud of the felloe, with its running surface on y = 0.
    {
      const pts = [[R0 - 0.07, -0.085], [R0 - 0.012, -0.085], [R0, -0.07], [R0, 0.07], [R0 - 0.012, 0.085], [R0 - 0.07, 0.085]];
      M.push({ geometry: onX(spin(pts, { segments: 80, closed: true })), color: IRON, position: [x, axleY, axleZ] });
    }
    // Felloe: bent ash, in the Greens' paint on its outer face, with a joint between each pair of spokes.
    {
      const rO = R0 - 0.05;
      const rI = R0 - 0.215;
      const pts = [
        [rI + 0.02, -0.075], [rI + 0.03, -0.075], [rI + 0.034, -0.075], [rI + 0.126, -0.075], [rI + 0.13, -0.075], [rO, -0.075],
        [rO, 0.075], [rI + 0.13, 0.075], [rI + 0.126, 0.075], [rI + 0.034, 0.075], [rI + 0.03, 0.075], [rI + 0.02, 0.075], [rI, 0.055], [rI, -0.055],
      ];
      const g = onX(spin(pts, { segments: 80, closed: true }));
      const cG = lin(GREEN);
      const cW = lin(ASH);
      const cO = lin(OCHRE);
      tintVertices(g, (px, py, pz, out) => {
        const a = Math.atan2(py, pz);
        const seg = (((a + Math.PI / 8) / (Math.PI * 2)) * 8 + 8) % 1;
        const joint = Math.abs(seg - 0.5) < 0.012;
        const r = Math.hypot(py, pz);
        const paint = Math.abs(px) > 0.07 && r < rO - 0.005 && r > rI + 0.01;
        const c = paint ? (r > rI + 0.128 || r < rI + 0.032 ? cO : cG) : cW;
        const k = joint ? 0.3 : 1;
        out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
      });
      grainUV(g, [0, 1, 1], [1, 0, 0], 1.2, 0.5);
      T.push({ geometry: g, keepColor: true, position: [x, axleY, axleZ] });
    }
    // The nave: turned elm, with iron hoops at its ends and a socket for each spoke.
    {
      const naveL = 0.42;
      const g = onX(spin([
        [0, -naveL], [0.1, -naveL], [0.15, -naveL + 0.04], [0.15, -naveL + 0.12], [0.2, -naveL + 0.2], [0.24, -0.1], [0.26, -0.06], [0.26, 0.06], [0.24, 0.1], [0.2, naveL - 0.2], [0.15, naveL - 0.12], [0.15, naveL - 0.04], [0.1, naveL], [0, naveL],
      ], { segments: 28 }));
      grainUV(g, [1, 0, 0], [0, 1, 0], 1.2, 0.8);
      T.push({ geometry: g, color: DARKWOOD, position: [x, axleY, axleZ] });
      for (const off of [-0.32, 0.32]) {
        M.push({ geometry: onX(ringGeo(0.158, 0.016, { segments: 28, sides: 6 })), color: IRON, position: [x + off, axleY, axleZ] });
      }
      // Linchpin on the outer end: small and iron, through the axle.
      const pinX = x + side * 0.53;
      rod(M, IRON, [pinX, axleY - 0.14, axleZ], [pinX, axleY + 0.14, axleZ], 0.02, { sides: 8 });
      dot(M, IRON, 0.035, [pinX, axleY + 0.14, axleZ], { sides: 8 });
    }
    // Eight spokes, tapered and oval, sunk into the nave and through into the felloe.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const c = Math.cos(a); const n = Math.sin(a);
      const p0 = [x, axleY + n * 0.2, axleZ + c * 0.2];
      const p1 = [x, axleY + n * 0.55, axleZ + c * 0.55];
      const p2 = [x, axleY + n * (R0 - 0.17), axleZ + c * (R0 - 0.17)];
      const g = tube([p0, p1, p2], [0.062, 0.05, 0.04], { sides: 10, steps: 8, round: 0, section: () => [1, 0.72], frame: () => [0, -c, n] });
      grainUV(g, [0, n, c], [1, 0, 0], 2, 0.5);
      T.push({ geometry: g, color: ASH });
    }
  }
  // The axle, ash, run right through both naves, and rounded off beyond them.
  timberBar([-(xw + 0.55), axleY, axleZ], [xw + 0.55, axleY, axleZ], 0.085, OAK);

  // ------------------------------------------------------------- the floor frame and its woven straps
  const yF = CH.yFloor;
  // A D-shaped bent ash frame. A racing chariot's floor was flexible for the same reason as a modern
  // running shoe: it took the shocks out of the track.
  const framePts = [];
  for (let i = 0; i <= 26; i++) {
    const a = -1 + (i / 26) * 2;
    const [x, z] = chariotPlan(a, 0);
    framePts.push([x, yF, z]);
  }
  const closedFrame = [...framePts, [CH.halfW * 0.35, yF, CH.zc - 0.0], [-CH.halfW * 0.35, yF, CH.zc - 0.0], framePts[0]];
  {
    const g = tube(closedFrame, 0.07, { sides: 10, steps: 70, round: 1, section: () => [0.86, 1] });
    grainUV(g, [1, 0, 1], [0, 1, 0]);
    T.push({ geometry: g, color: ASH });
    // Cross-bearers under the straps, tying the frame to the axle.
    for (const sx of [-0.92, 0.92]) timberBar([sx, yF - 0.04, CH.zc + 1.2], [sx * 1.0, yF - 0.04, CH.zc - 0.05], 0.05, OAK);
    timberBar([-CH.halfW, yF - 0.05, axleZ], [CH.halfW, yF - 0.05, axleZ], 0.06, OAK);
    for (const sx of [-1.12, 1.12]) {
      timberBar([sx, axleY + 0.08, axleZ], [sx, yF - 0.05, axleZ], 0.065, OAK);
      // Rawhide lashing over each saddle on the axle.
      for (let k = -2; k <= 2; k++) L.push({ geometry: onX(ringGeo(0.1, 0.014, { segments: 14, sides: 5 })).rotateY(0).translate(sx + k * 0.03, axleY, axleZ), color: STRAP2 });
    }
  }
  // Interleaved straps. Each runs edge to edge inside the D, and goes over and under on alternate crossings.
  {
    const insideZ = (x) => {
      // Largest z on the D at this x.
      const q = clamp01(Math.abs(x) / CH.halfW);
      return CH.zc + CH.depth * Math.sqrt(Math.max(0, 1 - q * q));
    };
    const width = 0.16;
    const pitch = 0.2;
    const zMin = CH.zc - 0.0;
    const xs = [];
    for (let x = -CH.halfW + 0.12; x <= CH.halfW - 0.1; x += pitch) xs.push(x);
    const zs = [];
    for (let z = zMin + 0.08; z <= CH.zc + CH.depth - 0.08; z += pitch) zs.push(z);
    const lift = 0.017;
    // Fore and aft.
    xs.forEach((x, i) => {
      const z1 = insideZ(x);
      const list = zs.filter((z) => z < z1 + 0.02);
      if (list.length < 2) return;
      const pts = [[x, yF, zMin - 0.0]];
      list.forEach((z, j) => pts.push([x, yF + ((i + j) % 2 ? lift : -lift), z]));
      pts.push([x, yF, z1 + 0.02]);
      const g = tube(pts, width / 2, { sides: 4, steps: pts.length * 3, round: 0, section: () => [0.22, 1], frame: () => [0, 1, 0] });
      L.push({ geometry: g, color: i % 2 ? STRAP : 0x7a4a28 });
    });
    // Across.
    zs.forEach((z, j) => {
      const q = clamp01((z - CH.zc) / CH.depth);
      const halfX = CH.halfW * Math.sqrt(Math.max(0, 1 - q * q));
      const list = xs.filter((x) => Math.abs(x) < halfX);
      if (list.length < 2) return;
      const pts = [[-halfX, yF, z]];
      list.forEach((x) => {
        const i = xs.indexOf(x);
        pts.push([x, yF + ((i + j) % 2 ? -lift : lift), z]);
      });
      pts.push([halfX, yF, z]);
      const g = tube(pts, width / 2, { sides: 4, steps: pts.length * 3, round: 0, section: () => [0.22, 1], frame: () => [0, 1, 0] });
      L.push({ geometry: g, color: j % 2 ? 0x7a4a28 : STRAP });
    });
  }

  // ------------------------------------------------------------- the breastwork: hide on bent ash
  const lean = 0.07; // the top stands a little further out than the foot
  const panelPoint = (u, v) => {
    const a = -1 + 2 * u;
    const top = chariotTop(a) * v;
    const [x, z] = chariotPlan(a, lean * v * (top / CH.H) * 1.8 - 0.01);
    return [x, yF + top + 0.02, z];
  };
  const hide = closedSheet({ nu: 110, nv: 22, point: panelPoint, half: () => 0.014 });
  {
    // Outer face on the canvas's lower half, inner on the upper; v is real height, so the painting
    // does not get squeezed where the panel gets low.
    const P = hide.attributes.position;
    const uv = hide.attributes.uv;
    const half = P.count / 2; // closedSheet lays the +n sheet first, and du x dv points outward here
    for (let i = 0; i < P.count; i++) {
      const h = clamp01((P.getY(i) - yF) / (CH.H + 0.1));
      uv.setY(i, i < half ? h * 0.5 : 0.5 + h * 0.5);
    }
  }
  // Top rail: bent ash, wrapped in leather where a driver grips it.
  const railPts = [];
  for (let i = 0; i <= 60; i++) railPts.push(panelPoint(i / 60, 1));
  {
    const g = tube(railPts, 0.058, { sides: 12, steps: 120, round: 2 });
    const cW = lin(ASH);
    const cG = lin(GREEN);
    tintVertices(g, (px, py, pz, out) => {
      // A strip of the team's paint round the rail near the front.
      const c = Math.abs(px) < 0.7 ? cG : cW;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    grainUV(g, [1, 0, 0.5], [0, 1, 0], 1, 0.6);
    T.push({ geometry: g, keepColor: true });
    // Lacing that holds the hide on the rail: a run of little wraps.
    for (let i = 3; i < 118; i += 1) {
      if (i % 2) continue;
      const u = i / 120;
      const p = panelPoint(u, 1);
      const q = panelPoint(Math.min(1, u + 0.004), 1);
      const dir = vec(q).sub(vec(p)).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
      const lace = ringGeo(0.06, 0.008, { segments: 10, sides: 4 });
      lace.applyQuaternion(quat);
      lace.translate(p[0], p[1], p[2]);
      L.push({ geometry: lace, color: STRAP2 });
    }
  }
  // Light ash uprights inside the hide, one bent stake to each panel seam, rooted in floor and rail.
  for (const a of [-0.88, -0.72, -0.56, -0.38, -0.2, 0, 0.2, 0.38, 0.56, 0.72, 0.88]) {
    const u = (a + 1) / 2;
    const pts = [];
    for (let j = 0; j <= 4; j++) {
      const p = panelPoint(u, j / 4);
      const d = Math.hypot(p[0], p[2] - CH.zc) || 1;
      const inset = 0.05;
      pts.push([p[0] - (p[0] / d) * inset, p[1], p[2] - ((p[2] - CH.zc) / d) * inset]);
    }
    const g = tube(pts, 0.03, { sides: 8, steps: 8, round: 1 });
    grainUV(g, [0, 1, 0], [1, 0, 0]);
    T.push({ geometry: g, color: ASH });
  }

  // ------------------------------------------------------------- the draught pole
  const polePts = [[0, axleY + 0.1, axleZ - 0.24], [0, yF - 0.09, axleZ + 0.6], [0, yF - 0.08, CH.zc + CH.depth - 0.05], [0, 2.1, 0.0], [0, 2.75, 1.95], [0, 3.32, 3.72], [0, 3.58, 5.1], [0, 3.62, 5.72]];
  {
    const g = tube(polePts, [0.1, 0.1, 0.1, 0.094, 0.082, 0.072, 0.064, 0.06], { sides: 12, steps: 150, round: 2 });
    const cW = lin(OAK);
    const cG = lin(GREEN);
    const cO = lin(OCHRE);
    tintVertices(g, (px, py, pz, out) => {
      // The team's colour in broad rings on the free length of the pole.
      let c = cW;
      if (pz > 0.6 && pz < 3.1) {
        // One long strip of the team's green, edged with ochre.
        c = pz < 0.72 || pz > 2.98 ? cO : cG;
      }
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    });
    grainUV(g, [0, 0.3, 1], [1, 0, 0], 1.2, 0.5);
    T.push({ geometry: g, keepColor: true });
    // A small iron cap, and the leather stay that takes the strain from the rail to the pole.
    M.push({ geometry: alongZ(spin([[0, -0.1], [0.07, -0.1], [0.075, -0.06], [0.078, 0.02], [0.05, 0.1], [0, 0.13]], { segments: 14 })), color: IRON, position: [0, 3.62, 5.72] });
  }
  const railFront = panelPoint(0.5, 1);
  for (const dx of [-0.02, 0.02]) {
    L.push({ geometry: tube([[railFront[0] + dx, railFront[1] - 0.01, railFront[2] + 0.02], [dx * 2, 3.32, 0.2], [dx * 2, 2.74, 1.9]], 0.022, { sides: 6, steps: 16, round: 1, section: () => [0.7, 1.2] }), color: STRAP });
  }
  // The stay's lashing round the pole.
  for (let k = 0; k < 7; k++) {
    const z = 1.88 + k * 0.024;
    const y = 2.72 + k * 0.007;
    L.push({ geometry: ringGeo(0.09, 0.012, { segments: 14, sides: 5 }).rotateX(Math.PI / 2).translate(0, y, z), color: STRAP2 });
  }
  // Rawhide binding where the pole goes under the floor and across the axle.
  for (let k = -3; k <= 3; k++) {
    L.push({ geometry: ringGeo(0.13, 0.016, { segments: 16, sides: 5 }).rotateX(Math.PI / 2).translate(0, axleY + 0.14 + k * 0.004, axleZ + k * 0.03), color: STRAP2 });
  }

  // ------------------------------------------------------------- the yoke
  const yokeZ = 5.08;
  const yokeY = 3.56;
  const yokePath = [];
  for (let i = 0; i <= 40; i++) {
    const x = -2.2 + (i / 40) * 4.4;
    const q = Math.abs(x);
    // Two arches, each over a horse's neck, dipping at the pole and upturned at the tips.
    const arch = Math.exp(-Math.pow((q - 1.1) / 0.72, 2)) * 0.2;
    const curl = sstep(q, 1.9, 2.2) * 0.12;
    yokePath.push([x, yokeY + 0.14 + arch + curl, yokeZ]);
  }
  {
    const g = tube(yokePath, 0.082, { sides: 12, steps: 80, round: 2, section: () => [1, 0.8] });
    grainUV(g, [1, 0, 0], [0, 1, 0], 1.2, 0.5);
    T.push({ geometry: g, color: OAK });
    // The yoke lashed to the pole with rawhide, the way these always were.
    for (let k = -4; k <= 4; k++) {
      L.push({ geometry: ringGeo(0.14, 0.017, { segments: 16, sides: 5 }).rotateZ(Math.PI / 2 + k * 0.05).translate(k * 0.012, yokeY + 0.06, yokeZ + k * 0.024), color: STRAP2 });
    }
    // A yoke-saddle under each arch: a forked piece that rests either side of the neck.
    for (const sx of [-1, 1]) {
      const top = [sx * 1.1, yokeY + 0.3, yokeZ];
      const forkA = [sx * 1.1 - 0.44, yokeY - 0.55, yokeZ];
      const forkB = [sx * 1.1 + 0.44, yokeY - 0.55, yokeZ];
      for (const f of [forkA, forkB]) {
        const mid = [mix(top[0], f[0], 0.55) * 1 + (f[0] - top[0]) * 0.1, mix(top[1], f[1], 0.55), yokeZ];
        const g2 = tube([top, mid, f], [0.056, 0.044, 0.04], { sides: 9, steps: 10, round: 2, section: () => [0.72, 1] });
        grainUV(g2, [0, 1, 0], [1, 0, 0], 2, 0.5);
        T.push({ geometry: g2, color: DARKWOOD });
      }
      L.push({ geometry: tube([forkA, [sx * 1.1, yokeY - 0.74, yokeZ], forkB], 0.038, { sides: 7, steps: 12, round: 1, section: () => [0.55, 1.3], frame: () => [0, 0, 1] }), color: STRAP });
      // A small ring on top of each arch, for the reins.
      for (const off of [-0.2, 0.2]) {
        const ring = ringGeo(0.05, 0.012, { segments: 14, sides: 6 }).rotateX(Math.PI / 2);
        const x = sx * 1.1 + off;
        const q2 = Math.abs(x);
        const arch = Math.exp(-Math.pow((q2 - 1.1) / 0.72, 2)) * 0.2;
        M.push({ geometry: ring, color: BRONZE, position: [x, yokeY + 0.14 + arch + 0.115, yokeZ] });
      }
    }
  }
  // The reins: two from each arch's rings, back along the pole, and looped over the rail.
  {
    const attach = [];
    for (const sx of [-1, 1]) {
      for (const off of [-0.2, 0.2]) {
        const x = sx * 1.1 + off;
        const q2 = Math.abs(x);
        const arch = Math.exp(-Math.pow((q2 - 1.1) / 0.72, 2)) * 0.2;
        attach.push([x, yokeY + 0.14 + arch + 0.115, yokeZ]);
      }
    }
    attach.forEach((p, i) => {
      const f = (i - 1.5) * 0.14;
      const rail = panelPoint(0.5 + f / 3, 1);
      const pts = [
        p,
        [mix(p[0], rail[0], 0.3), mix(p[1], rail[1], 0.3) - 0.2, mix(p[2], rail[2], 0.3)],
        [mix(p[0], rail[0], 0.65), mix(p[1], rail[1], 0.65) - 0.23, mix(p[2], rail[2], 0.65)],
        [rail[0], rail[1] + 0.09, rail[2] + 0.1],
        [rail[0], rail[1] + 0.09, rail[2] - 0.1],
        [rail[0] + f * 0.3, rail[1] - 0.5, rail[2] - 0.17],
        [rail[0] + f * 0.5, rail[1] - 0.78, rail[2] - 0.12],
      ];
      L.push({ geometry: tube(pts, 0.022, { sides: 6, steps: 40, round: 1, section: () => [0.42, 1], frame: () => [0, 1, 0] }), color: STRAP });
    });
  }

  // ------------------------------------------------------------- the prop that stands in for the horses
  {
    const pz = 3.42;
    for (const sx of [-1, 1]) {
      timberBar([sx * 0.11, 3.32, pz + 0.03], [sx * 0.05, 2.9, pz], 0.036, DARKWOOD, { sides: 8 });
    }
    timberBar([0, 2.95, pz], [0, 0.12, pz], 0.06, DARKWOOD);
    // Feet: a cross on the ground, half-lapped.
    bar(T, DARKWOOD, [-0.95, 0.07, pz], [0.95, 0.07, pz], 0.16, 0.14, { chamfer: 0.016, tile: [1, 2] });
    bar(T, DARKWOOD, [0, 0.075, pz - 0.75], [0, 0.075, pz + 0.75], 0.16, 0.15, { chamfer: 0.016, tile: [1, 2] });
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      timberBar([dx * 0.72, 0.1, pz + dz * 0.6], [0, 1.0, pz], 0.03, DARKWOOD, { sides: 7 });
    }
  }

  const wood = grainMaps({ seed: 146, knots: 2, strength: 0.35, width: 128, height: 256, streaks: 70 });
  const hideMap = chariotCanvas();
  const hideMesh = new THREE.Mesh(hide, new THREE.MeshStandardMaterial({ map: hideMap, roughness: 0.62, metalness: 0 }));
  hideMesh.castShadow = true;
  hideMesh.receiveShadow = true;
  const zs = -0.7;
  const groups = [
    meshFrom(mergeParts(T), { ...wood, roughness: 0.62, metalness: 0 }),
    meshFrom(mergeParts(M), { roughness: 0.46, metalness: 0.32 }),
    meshFrom(mergeParts(L), { roughness: 0.72, metalness: 0 }),
    hideMesh,
  ];
  for (const m of groups) m.geometry.translate(0, 0, zs);
  return groupOf(...groups);
}

const alongZ = (g) => g.rotateX(Math.PI / 2);

// ---------------------------------------------------------------------------
// Water mill: an overshot wheel, a stone mill with its front wall open, a real gear train
// ---------------------------------------------------------------------------
//
// The train is the classic one and every tooth is placed by a shared pitch, so a pair meshes by
// construction: the water wheel's shaft carries the PIT WHEEL (44 cogs on its face) driving the WALLOWER
// (a lantern of 16 staves), which turns the UPRIGHT SHAFT and the GREAT SPUR WHEEL (52 cogs) above it,
// driving the STONE NUT (13 teeth) on the spindle of the runner stone. 44/16 x 52/13 = 11 turns of the
// stone for one of the wheel, which turns a wheel's slow ten turns a minute into a stone's hundred.
const MILL_GEARS = {
  shaftY: 6.4, shaftZ: -0.6,
  pit: { x: 0.3, R: 2.4, N: 44, cogR: 0.18, cogT: 0.066, cogFace: 0.15, cogLen: 0.34 },
  wallower: { N: 16, stave: 0.062 },
  spur: { y: 10.0, R: 3.1, N: 52, toothHalf: 0.058, reach: 0.15 },
  nut: { N: 13, toothHalf: 0.058, reach: 0.15 },
  spurBearing: (35 * Math.PI) / 180, // from +Z toward -X, the way the stones lie from the upright shaft
};

function millGeometry() {
  const G = MILL_GEARS;
  const pitchPit = (2 * Math.PI * G.pit.R) / G.pit.N;
  const rw = (pitchPit * G.wallower.N) / (2 * Math.PI); // the wallower's radius follows from the shared pitch
  const cogMid = G.pit.x - G.pit.cogFace - G.pit.cogLen / 2;
  const xu = cogMid - rw; // upright shaft's x: its stave sits exactly in the plane of the pit cogs
  const pitchSpur = (2 * Math.PI * G.spur.R) / G.spur.N;
  const rn = (pitchSpur * G.nut.N) / (2 * Math.PI);
  const dist = G.spur.R + rn;
  const sx = xu - Math.sin(G.spurBearing) * dist;
  const sz = G.shaftZ + Math.cos(G.spurBearing) * dist;
  return { rw, xu, rn, dist, sx, sz };
}

function stoneMaps() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(1086);
  ctx.fillStyle = '#8f8778';
  ctx.fillRect(0, 0, S, S);
  const courses = [58, 76, 52, 84, 62, 70, 54, 56];
  let y = 0;
  courses.forEach((h, row) => {
    let x = (row * 37) % 90;
    const start = x;
    while (x < S + start) {
      const w = 62 + rng() * 96;
      const shade = 202 + Math.round(rng() * 50);
      const r2 = shade + Math.round(rng() * 6);
      const b2 = shade - 8 - Math.round(rng() * 16);
      for (const dx of [-S, 0, S]) {
        ctx.fillStyle = `rgb(${r2},${shade},${b2})`;
        const cut = 3;
        ctx.beginPath();
        const X = x + dx + 2; const Y = y + 2; const W = w - 4; const H = h - 4;
        ctx.moveTo(X + cut, Y); ctx.lineTo(X + W - cut, Y + rng() * 2); ctx.lineTo(X + W, Y + cut);
        ctx.lineTo(X + W - rng() * 2, Y + H - cut); ctx.lineTo(X + W - cut, Y + H); ctx.lineTo(X + cut, Y + H - rng() * 2);
        ctx.lineTo(X, Y + H - cut); ctx.lineTo(X + rng() * 2, Y + cut); ctx.closePath();
        ctx.fill();
        // A hint of tooling and of weather on each block.
        ctx.fillStyle = 'rgba(90,80,60,0.13)';
        ctx.fillRect(X + 3, Y + H - 7, W - 6, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.13)';
        ctx.fillRect(X + 3, Y + 2, W - 6, 4);
      }
      x += w;
    }
    y += h;
  });
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 0.9 };
}

function slateMaps() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(1212);
  ctx.fillStyle = '#6c6c6c';
  ctx.fillRect(0, 0, S, S);
  const rows = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const y = r * rh;
    const off = r % 2 ? 32 : 0;
    const count = 8;
    for (let c = -1; c <= count; c++) {
      const w = S / count;
      const shade = 194 + Math.round(rng() * 56);
      ctx.fillStyle = `rgb(${shade},${shade},${shade - 2})`;
      const x = c * w + off + (rng() - 0.5) * 3;
      ctx.fillRect(x + 1.5, y, w - 3, rh - 7 - rng() * 3);
    }
    ctx.fillStyle = 'rgba(25,25,28,0.8)';
    ctx.fillRect(0, y + rh - 7, S, 7);
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 1.1 };
}

function streamMap() {
  const W = 512;
  const H = 1024;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(1500);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#1b6fa8'); g.addColorStop(0.5, '#2a93d1'); g.addColorStop(1, '#1b6fa8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 620; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const L = 20 + rng() * 90;
    ctx.strokeStyle = rng() > 0.45 ? `rgba(160,220,245,${0.08 + rng() * 0.25})` : `rgba(10,60,110,${0.08 + rng() * 0.22})`;
    ctx.lineWidth = 1 + rng() * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 7, y + L * 0.3, x - 7, y + L * 0.6, x + (rng() - 0.5) * 6, y + L);
    ctx.stroke();
  }
  // White water where the wheel drops it, thinning downstream. A box's top maps v = 1 to its far -Z end
  // and the canvas's row 0 to v = 1, so a row is simply the distance from z = -8.5.
  const rowOf = (z) => ((z + 8.5) / 17) * H;
  const colOf = (x) => ((x - 5.1) / 4.2) * W;
  const blot = (zA, zB, n, spread) => {
    for (let i = 0; i < n; i++) {
      const z = mix(zA, zB, Math.pow(rng(), 1.4));
      const f = (z - zA) / (zB - zA);
      const x = 6.8 + (rng() - 0.5) * spread;
      const r = (3 + rng() * 15) * (1 - f * 0.55);
      ctx.fillStyle = `rgba(240,250,253,${(0.25 + rng() * 0.55) * (1 - f * 0.7)})`;
      ctx.beginPath();
      ctx.ellipse(colOf(x), rowOf(z), r * 1.1, r * 1.9, rng(), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  blot(1.4, 8.5, 620, 3.8);
  blot(1.4, 4.4, 260, 3.0);
  return texOf(canvas, THREE.SRGBColorSpace);
}

function waterMill() {
  const G = MILL_GEARS;
  const { rw, xu, rn, sx, sz } = millGeometry();
  const OAK = 0x9d6f3e;
  const ELM = 0x7f5730;
  const DARK = 0x5a3c21;
  const PALE = 0xbf9862;
  const IRON = 0x45484d;
  const STONEWARM = 0xc9bd9f;
  const T = []; // timber
  const S = []; // masonry
  const Rf = []; // slate
  const X = []; // iron, millstones, sacks, ground
  const Wa = []; // the stream and the flume's water
  const P = []; // falling water, the one translucent mesh

  const BT = 0.8; // top of the ground
  const yWater = 0.42;
  const xW0 = -8; const xE0 = 5; // the outer faces of the two gable walls
  const zB0 = -5.5; const zF0 = 5.5;
  const EY = 14.6;
  const RY = 19.8;
  const FY = 10.9;
  const y0 = G.shaftY;
  const z0 = G.shaftZ;
  const TILE = 5.5;

  const wallUV = (g, k = TILE) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / k, uv.getY(i) / k);
    return g;
  };
  // A box whose texture lands in feet whatever its size. Each face reads off its own two axes.
  const stoneBox = (x0, x1, y1, y2, z1, z2, color = STONEWARM, k = TILE) => {
    const g = new THREE.BoxGeometry(x1 - x0, y2 - y1, z2 - z1, 2, 3, 2);
    g.translate((x0 + x1) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    const Pos = g.attributes.position; const N = g.attributes.normal; const uv = g.attributes.uv;
    for (let i = 0; i < Pos.count; i++) {
      const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i));
      if (ny > 0.5) uv.setXY(i, Pos.getX(i) / k, Pos.getZ(i) / k);
      else if (nx > 0.5) uv.setXY(i, Pos.getZ(i) / k, Pos.getY(i) / k);
      else uv.setXY(i, Pos.getX(i) / k, Pos.getY(i) / k);
    }
    S.push({ geometry: g, color });
  };

  // ------------------------------------------------------------- the ground and the stream
  {
    const xA = -11.5; const xB = 11; const zA = -8.5; const zD = 8.5;
    const chA = 5.1; const chB = 9.3;
    const ground = (x0, x1, seg) => {
      const g = new THREE.BoxGeometry(x1 - x0, BT, zD - zA, seg, 1, 40);
      g.translate((x0 + x1) / 2, BT / 2, (zA + zD) / 2);
      const cG1 = lin(0x4f8a31); const cG2 = lin(0x7cae3e); const cE = lin(0x5c4630);
      tintVertices(g, (x, y, z, out) => {
        if (y < BT - 0.01) { out[0] = cE[0]; out[1] = cE[1]; out[2] = cE[2]; return; }
        const n = smoothNoise3(x * 0.45 + 3, 1.2, z * 0.45);
        const m = smoothNoise3(x * 1.5, 5, z * 1.5);
        const t = clamp01(n * 0.8 + m * 0.4);
        out[0] = mix(cG1[0], cG2[0], t); out[1] = mix(cG1[1], cG2[1], t); out[2] = mix(cG1[2], cG2[2], t);
      });
      X.push({ geometry: g, keepColor: true });
    };
    ground(xA, chA, 44);
    ground(chB, xB, 6);
    X.push({ geometry: new THREE.BoxGeometry(chB - chA, 0.1, zD - zA), color: 0x5f5546, position: [(chA + chB) / 2, 0.05, 0] });
    // Stone facing on both banks of the channel.
    stoneBox(chA - 0.28, chA, 0, BT + 0.1, zA, zD, 0xa89d86, 5);
    stoneBox(chB, chB + 0.28, 0, BT + 0.1, zA, zD, 0xa89d86, 5);
    // The stream: a solid of water, so its cut ends read blue and not as a hole.
    const box = new THREE.BoxGeometry(chB - chA, yWater - 0.1, zD - zA, 1, 1, 1);
    box.translate((chA + chB) / 2, (yWater + 0.1) / 2, (zA + zD) / 2);
    Wa.push({ geometry: box, color: 0xffffff });
    // A worn path across the grass to the door.
    for (let i = 0; i < 22; i++) {
      const rng = seededRandom(300 + i);
      const q = i / 21;
      const x = mix(-11.2, -8.3, q);
      const z = mix(5.5, 1.0, q * q) + (rng() - 0.5) * 0.4;
      const g = new THREE.IcosahedronGeometry(0.3 + rng() * 0.2, 1);
      g.scale(1.4, 0.1, 1.1);
      X.push({ geometry: g, color: 0x8c7f68, position: [x, BT + 0.01, z] });
    }
    // Boulders on the banks, and reeds where the bank meets the water.
    const rng = seededRandom(77);
    for (const [x, z, r] of [[10.2, 6.8, 0.55], [10.0, -6.4, 0.42], [10.4, 2.6, 0.38], [-10.4, -7.2, 0.5], [-9.6, 7.3, 0.36], [4.4, 7.4, 0.4]]) {
      const g = new THREE.IcosahedronGeometry(r, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        const k = 1 + 0.32 * (smoothNoise3(v.x * 2.4 + x, v.y * 2.4, v.z * 2.4 + z) - 0.5);
        p.setXYZ(i, v.x * k, v.y * k * 0.72, v.z * k);
      }
      g.computeVertexNormals();
      X.push({ geometry: g, color: 0x8f8a7c, position: [x, BT + r * 0.3, z] });
    }
    for (let i = 0; i < 30; i++) {
      const bank = rng() > 0.5;
      const x = bank ? chB + 0.3 + rng() * 0.5 : chA - 0.6 - rng() * 0.15;
      const z = bank ? mix(zA + 0.5, zD - 0.5, rng()) : mix(6.0, zD - 0.3, rng());
      const h = 1.3 + rng() * 1.5;
      const lean = (rng() - 0.5) * 0.35;
      X.push({ geometry: tube([[x, BT - 0.05, z], [x + lean * 0.3, BT + h * 0.55, z + lean * 0.2], [x + lean, BT + h, z + lean * 0.5]], [0.03, 0.022, 0], { sides: 5, steps: 5, round: 0 }), color: rng() > 0.5 ? 0x6b8f3a : 0x8fa648 });
    }
    // Tufts, so the grass has something standing up on it.
    for (let i = 0; i < 46; i++) {
      const x = mix(-11.2, 3.6, rng());
      const z = rng() > 0.5 ? mix(6.0, 8.3, rng()) : mix(-8.3, -6.0, rng());
      for (let b = 0; b < 3; b++) {
        const lx = x + (rng() - 0.5) * 0.3;
        const lz = z + (rng() - 0.5) * 0.3;
        const h = 0.3 + rng() * 0.4;
        X.push({ geometry: tube([[lx, BT - 0.02, lz], [lx + (rng() - 0.5) * 0.18, BT + h, lz + (rng() - 0.5) * 0.18]], [0.035, 0], { sides: 3, steps: 2, round: 0, straight: true }), color: 0x5d9a35 });
      }
    }
  }

  // ------------------------------------------------------------- the walls
  {
    const gable = (x) => {
      const outline = [[zB0, BT], [zF0, BT], [zF0, EY], [0, RY], [zB0, EY]];
      const g = wallUV(extrudeOutline(outline, 1.0));
      g.rotateY(-Math.PI / 2);
      g.translate(x, 0, 0);
      S.push({ geometry: g, color: STONEWARM });
    };
    gable(xW0 + 0.5);
    gable(xE0 - 0.5);
    stoneBox(xW0 + 1, xE0 - 1, BT, EY, zB0, zB0 + 1);
    // A plinth, a course or two standing proud, tying the walls to the ground.
    stoneBox(xW0 - 0.12, xW0 + 1, BT - 0.05, BT + 0.75, zB0 - 0.12, zF0 + 0.05, 0xa89d86);
    stoneBox(xE0 - 1, xE0 + 0.12, BT - 0.05, BT + 0.75, zB0 - 0.12, zF0 + 0.05, 0xa89d86);
    stoneBox(xW0 + 1, xE0 - 1, BT - 0.05, BT + 0.75, zB0 - 0.12, zB0 + 1, 0xa89d86);
    // The pit floor, flagged.
    stoneBox(xW0 + 1, xE0 - 1, BT - 0.1, BT + 0.05, zB0 + 1, zF0, 0x8f8778, 5);
    // Dressed quoins on the open wall's cut ends, so it reads as a wall that stops, not as a wall broken.
    for (const xc of [xW0 + 0.5, xE0 - 0.5]) {
      for (let k = 0; k < 13; k++) {
        const big = k % 2 === 0;
        stoneBox(xc - 0.53 - (big ? 0.0 : 0), xc + 0.53, BT + 0.75 + k * 1.03, BT + 0.75 + (k + 1) * 1.03 - 0.03, zF0 - (big ? 1.5 : 0.9), zF0 + 0.03, 0xdcd3b8, 3);
      }
    }
  }

  // A window built forward of the solid wall, on either face: dark panel, glazing bars, frame, sill.
  const windowOn = (axis, plane, a, y, w, h, sign) => {
    const put = (W, H, D, off, color, dy = 0, list = T) => {
      const g = new THREE.BoxGeometry(axis === 'z' ? W : D, H, axis === 'z' ? D : W);
      const p = axis === 'z' ? [a, y + dy, plane + sign * off] : [plane + sign * off, y + dy, a];
      list.push({ geometry: g, color, position: p });
    };
    put(w, h, 0.06, 0.03, 0x20262c, 0, X);
    for (const dx of [-1, 1]) {
      const offA = (w / 2 + 0.09) * dx;
      const g = new THREE.BoxGeometry(axis === 'z' ? 0.18 : 0.2, h + 0.36, axis === 'z' ? 0.2 : 0.18);
      T.push({ geometry: g, color: ELM, position: axis === 'z' ? [a + offA, y, plane + sign * 0.1] : [plane + sign * 0.1, y, a + offA] });
    }
    put(w, 0.18, 0.2, 0.1, ELM, h / 2 + 0.09);
    put(w + 0.5, 0.2, 0.4, 0.2, 0xd3cab1, -h / 2 - 0.1, S);
    put(w, 0.06, 0.1, 0.08, ELM, 0);
    {
      const g = new THREE.BoxGeometry(axis === 'z' ? 0.06 : 0.1, h, axis === 'z' ? 0.1 : 0.06);
      T.push({ geometry: g, color: ELM, position: axis === 'z' ? [a, y, plane + sign * 0.08] : [plane + sign * 0.08, y, a] });
    }
  };
  windowOn('z', zB0 + 1, -4.8, 5.2, 1.6, 2.4, 1);
  windowOn('z', zB0, -4.8, 5.2, 1.6, 2.4, -1);
  windowOn('z', zB0 + 1, -2.2, 12.6, 1.6, 2.0, 1);
  windowOn('z', zB0, -2.2, 12.6, 1.6, 2.0, -1);
  windowOn('z', zB0 + 1, 2.0, 12.6, 1.6, 2.0, 1);
  windowOn('z', zB0, 2.0, 12.6, 1.6, 2.0, -1);
  windowOn('x', xW0, 3.0, 12.6, 1.6, 2.0, -1);
  windowOn('x', xW0 + 1, 3.0, 12.6, 1.6, 2.0, 1);
  windowOn('x', xE0, -2.4, 15.2, 1.2, 1.5, 1);
  // The west door, planked and ledged, in a stone surround, at the end of the path.
  {
    const dz = 1.1; const w = 2.7; const h = 6.0;
    const xo = xW0;
    X.push({ geometry: new THREE.BoxGeometry(0.06, h, w), color: 0x1d1f24, position: [xo - 0.02, BT + 0.05 + h / 2, dz] });
    for (let k = 0; k < 6; k++) {
      const z = dz - w / 2 + (k + 0.5) * (w / 6);
      bar(T, k % 2 ? OAK : ELM, [xo - 0.09, BT + 0.1, z], [xo - 0.09, BT + h, z], 0.1, w / 6 - 0.025, { up: [0, 0, 1], chamfer: 0.012, tile: [1, 2] });
    }
    for (const y of [BT + 0.9, BT + 3, BT + h - 0.9]) bar(T, DARK, [xo - 0.17, y, dz - w / 2 + 0.05], [xo - 0.17, y, dz + w / 2 - 0.05], 0.09, 0.42, { up: [0, 1, 0] });
    for (const y of [BT + 0.9, BT + h - 0.9]) bar(X, IRON, [xo - 0.235, y, dz + w / 2 - 0.05], [xo - 0.235, y, dz - w * 0.2], 0.04, 0.14, { up: [0, 1, 0] });
    dot(X, IRON, 0.1, [xo - 0.3, BT + 3.0, dz + w / 2 - 0.5], { sides: 8 });
    for (const zz of [dz - w / 2 - 0.26, dz + w / 2 + 0.26]) stoneBox(xo - 0.15, xo + 0.02, BT + 0.05, BT + h + 0.25, zz - 0.26, zz + 0.26, 0xdcd3b8, 3);
    stoneBox(xo - 0.15, xo + 0.02, BT + h + 0.05, BT + h + 0.75, dz - w / 2 - 0.52, dz + w / 2 + 0.52, 0xdcd3b8, 3);
  }

  // ------------------------------------------------------------- the roof
  {
    const run = zF0 + 0.95;
    const fall = RY - (EY - 0.5);
    const len = Math.hypot(run, fall);
    const pitch = Math.atan2(fall, run);
    const xA = xW0 - 0.55; const xB = xE0 + 0.55;
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(xB - xA, 0.32, len, 2, 1, 4);
      const pos = g.attributes.position;
      const uv = g.attributes.uv;
      const nrm = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(nrm.getY(i)) > 0.5) uv.setXY(i, pos.getX(i) / 4, (pos.getZ(i) * side) / 4);
        else uv.setXY(i, 0.5, 0.02);
      }
      // Tip each slope about X, then seat its ridge edge on the centre line.
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(side * pitch));
      g.translate((xA + xB) / 2, RY + 0.12 - Math.sin(pitch) * len / 2, side * (Math.cos(pitch) * len / 2));
      Rf.push({ geometry: g, color: 0x6c7682 });
    }
    // Lead ridge roll, and bargeboards along each gable.
    X.push({ geometry: onX(spin([[0, xA - 0.05], [0.2, xA - 0.05], [0.22, xA], [0.22, xB], [0.2, xB + 0.05], [0, xB + 0.05]], { segments: 12 })), color: 0x4a4e54, position: [0, RY + 0.25, 0] });
    for (const x of [xA + 0.04, xB - 0.04]) {
      for (const side of [-1, 1]) {
        bar(T, DARK, [x, RY + 0.06, 0], [x, RY + 0.06 - fall, side * run], 0.14, 0.42, { up: [0, 1, 0], chamfer: 0.015 });
      }
    }
    // Rafters and purlins under the slates, which is what looking up at the open side shows.
    for (let k = 0; k <= 8; k++) {
      const x = mix(xW0 + 1.2, xE0 - 1.2, k / 8);
      for (const side of [-1, 1]) {
        bar(T, ELM, [x, RY - 0.25, 0], [x, EY - 0.32, side * (zF0 - 0.3)], 0.26, 0.36, { up: [0, 1, 0], chamfer: 0.02 });
      }
    }
    for (const q of [0.4, 0.75]) {
      for (const side of [-1, 1]) {
        const y = mix(RY - 0.75, EY - 0.3, q);
        const z = side * mix(0, zF0, q);
        bar(T, DARK, [xW0 + 1, y, z], [xE0 - 1, y, z], 0.36, 0.38, { up: [0, 1, 0], chamfer: 0.02 });
      }
    }
    bar(T, DARK, [xW0 + 0.9, RY - 0.42, 0], [xE0 - 0.9, RY - 0.42, 0], 0.3, 0.42, { chamfer: 0.02 });
    // Wall plates: the open side's is what carries the rafters across the gap.
    bar(T, DARK, [xW0 + 0.5, EY - 0.3, zF0 - 0.3], [xE0 - 0.5, EY - 0.3, zF0 - 0.3], 0.62, 0.62, { chamfer: 0.03 });
    bar(T, DARK, [xW0 + 0.9, EY - 0.3, zB0 + 1.2], [xE0 - 0.9, EY - 0.3, zB0 + 1.2], 0.5, 0.5, { chamfer: 0.03 });
    // Two tie beams, one of which holds the upright shaft's top bearing.
    bar(T, ELM, [xu, EY - 0.45, zB0 + 0.9], [xu, EY - 0.45, zF0 - 0.3], 0.56, 0.6, { chamfer: 0.03 });
    bar(T, ELM, [-4.4, EY - 0.45, zB0 + 0.9], [-4.4, EY - 0.45, zF0 - 0.3], 0.56, 0.6, { chamfer: 0.03 });
  }

  // ------------------------------------------------------------- the stone floor
  {
    const beamY = FY - 0.25 - 0.3;
    // Two main beams and a front beam, on posts.
    for (const x of [-4.75, 3.45]) bar(T, DARK, [x, beamY - 0.2, zB0 + 0.9], [x, beamY - 0.2, zF0 - 0.2], 0.72, 0.9, { chamfer: 0.04 });
    bar(T, DARK, [xW0 + 1, beamY - 0.2, zF0 - 0.5], [xE0 - 1, beamY - 0.2, zF0 - 0.5], 0.7, 0.9, { chamfer: 0.04 });
    bar(T, ELM, [-4.75, BT + 0.05, zF0 - 0.5], [-4.75, beamY - 0.6, zF0 - 0.5], 0.6, 0.6, { chamfer: 0.05 });
    for (const dz of [-1, 1]) {
      bar(T, ELM, [-4.75, beamY - 2.1, zF0 - 0.5], [-4.75 + dz * 1.5, beamY - 0.65, zF0 - 0.5], 0.28, 0.32, { chamfer: 0.02 });
    }
    // Joists across, then planks. Planks are boards, cut wherever something has to come through.
    for (let k = 0; k <= 11; k++) {
      const z = mix(zB0 + 1.2, zF0 - 0.3, k / 11);
      bar(T, ELM, [xW0 + 1, FY - 0.42, z], [xE0 - 1, FY - 0.42, z], 0.3, 0.34, { chamfer: 0.02 });
    }
    const holes = [
      [xu - 0.5, xu + 0.5, z0 - 0.5, z0 + 0.5],
      [sx - 0.3, sx + 0.3, sz - 0.3, sz + 0.3],
      [xW0 + 1, -6.0, -0.7, 4.75], // the stairwell
      [sx - 1.55, sx - 0.9, sz + 0.95, sz + 1.5], // the meal spout
    ];
    const boards = 20;
    const bw = (zF0 - zB0 - 1) / boards;
    for (let b = 0; b < boards; b++) {
      const za = zB0 + 1 + b * bw;
      const zc = za + bw / 2;
      const spans = [[xW0 + 1, xE0 - 1]];
      for (const [ha, hb, zha, zhb] of holes) {
        if (zc + bw * 0.45 < zha || zc - bw * 0.45 > zhb) continue;
        for (let i = spans.length - 1; i >= 0; i--) {
          const [a, c] = spans[i];
          if (hb <= a || ha >= c) continue;
          spans.splice(i, 1);
          if (ha > a) spans.push([a, ha]);
          if (hb < c) spans.push([hb, c]);
        }
      }
      for (const [a, c] of spans) {
        if (c - a < 0.1) continue;
        const color = [PALE, 0xb08a58, 0xa8814f, 0xc4a06c][b % 4];
        bar(T, color, [a, FY - 0.125, zc], [c, FY - 0.125, zc], bw - 0.018, 0.25, { up: [0, 1, 0], chamfer: 0.01, tile: [1, 3], rng: seededRandom(900 + b) });
      }
    }
    // The stair from the pit floor up to the stone floor.
    const x1 = xW0 + 1.1; const x2 = -6.15;
    const zBottom = 5.1; const zTop = -0.6;
    for (const x of [x1, x2]) {
      bar(T, DARK, [x, BT, zBottom], [x, FY + 0.2, zTop], 0.15, 0.62, { chamfer: 0.02, up: [0, 1, 0] });
    }
    const steps = 15;
    for (let k = 1; k <= steps; k++) {
      const q = k / (steps + 0.5);
      const y = mix(BT, FY, q);
      const z = mix(zBottom, zTop, q);
      bar(T, k % 2 ? OAK : PALE, [x1 + 0.05, y, z], [x2 - 0.05, y, z], 0.42, 0.11, { up: [0, 1, 0], chamfer: 0.01, rng: seededRandom(70 + k) });
    }
    // A handrail, because the eye knows what a stair is by it, and because this is the scale marker.
    for (const q of [0.05, 0.5, 0.95]) {
      const y = mix(BT, FY, q); const z = mix(zBottom, zTop, q);
      bar(T, ELM, [x2 + 0.08, y + 0.2, z], [x2 + 0.08, y + 3.0, z], 0.12, 0.12);
    }
    pipe(T, ELM, [[x2 + 0.08, mix(BT, FY, 0.05) + 3.0, mix(zBottom, zTop, 0.05)], [x2 + 0.08, mix(BT, FY, 0.95) + 3.0, mix(zBottom, zTop, 0.95)]], 0.07, { sides: 7, steps: 2 });
  }

  // ------------------------------------------------------------- the water wheel
  const xc = 6.8;
  const Router = 5.6;
  const Rsole = 4.5;
  const halfWheel = 1.35;
  const nBuckets = 30;
  const wheelPoint = (r, th, x = xc) => [x, y0 + r * Math.cos(th), z0 + r * Math.sin(th)];
  const dth = (Math.PI * 2) / nBuckets;
  {
    // The two shrouds, with a joint at every sixth bucket; then the closed sole between them.
    for (const dx of [-halfWheel, halfWheel]) {
      const pts = [];
      const prof = [[Rsole - 0.12, -0.08], [Router, -0.08], [Router, 0.08], [Rsole - 0.12, 0.08]];
      for (const p of prof) pts.push(p);
      const g = onX(spin(pts, { segments: 90, closed: true }));
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.5, uv.getX(i) * 6);
      const c = lin(0x8d6538);
      tintVertices(g, (px, py, pz, out) => {
        const a = Math.atan2(pz, py);
        const j = ((a / (Math.PI * 2)) * 10 + 10) % 1;
        const k = Math.min(j, 1 - j) < 0.012 ? 0.42 : 1;
        out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
      });
      T.push({ geometry: g, keepColor: true, position: [xc + dx, y0, z0] });
      // An iron hoop on each shroud's rim, the band a wheelwright shrinks on.
      X.push({ geometry: onX(ringGeo(Router + 0.012, 0.03, { segments: 72, sides: 4, flat: 1 })), color: IRON, position: [xc + dx, y0, z0] });
      X.push({ geometry: onX(ringGeo(Rsole + 0.2, 0.024, { segments: 60, sides: 4 })), color: IRON, position: [xc + dx + (dx > 0 ? 0.08 : -0.08), y0, z0] });
    }
    // Sole boards, one between each pair of buckets.
    const soleBoards = nBuckets;
    for (let k = 0; k < soleBoards; k++) {
      const a = (k + 0.5) * dth;
      const p = wheelPoint(Rsole - 0.05, a);
      const up = [0, Math.cos(a), Math.sin(a)];
      bar(T, k % 2 ? 0x855e33 : 0x75512b, [xc - halfWheel, p[1], p[2]], [xc + halfWheel, p[1], p[2]], 2 * Rsole * Math.sin(dth / 2) + 0.01, 0.1, { up, rng: seededRandom(500 + k) });
    }
    // The buckets: each an elbowed pair of boards. The lip trails the root, against the rotation, so
    // that on the falling side (+Z, since the top of the wheel moves the way the flume runs) a bucket
    // opens upward and carries its water down.
    for (let k = 0; k < nBuckets; k++) {
      const th = k * dth + 0.04;
      const root = wheelPoint(Rsole - 0.02, th);
      const knee = wheelPoint(Rsole + 0.5, th - 0.02);
      const lip = wheelPoint(Router - 0.01, th - dth * 0.7);
      const rg = seededRandom(700 + k);
      const opts = (r) => ({ up: [1, 0, 0], rng: r });
      bar(T, 0xa97c47, root, knee, 0.075, halfWheel * 2 - 0.02, opts(rg));
      bar(T, 0xb48650, knee, lip, 0.075, halfWheel * 2 - 0.02, opts(rg));
      // Water in the buckets on the falling side: a level surface inside the elbow.
      if (th > 0.25 && th < 2.35) {
        const fill = sstep(th, 0.25, 0.55) * (1 - sstep(th, 1.8, 2.35));
        const lipPt = wheelPoint(Router - 0.1, th - dth * 0.62);
        const yL = lipPt[1] - 0.06 - (1 - fill) * 0.5;
        // From this bucket's own board out to the back of the one above it, on one level.
        const midTh = th - dth * 0.5;
        const a = [xc - halfWheel + 0.1, yL, z0 + (Rsole + 0.08) * Math.sin(midTh)];
        const b = [xc + halfWheel - 0.1, yL, z0 + (Router - 0.12) * Math.sin(midTh + 0.12)];
        const g = new THREE.BoxGeometry(halfWheel * 2 - 0.2, 0.34, Math.abs(b[2] - a[2]) * 0.92);
        P.push({ geometry: g, color: 0x6ec2ee, position: [xc, yL - 0.2, (a[2] + b[2]) / 2] });
      }
    }
    // The arms: eight to a side, into an iron-bound block on the shaft, each tenoned through the sole.
    for (const dx of [-1, 1]) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        const from = wheelPoint(0.45, a, xc + dx * 1.02);
        const to = wheelPoint(Rsole - 0.07, a, xc + dx * 1.02);
        bar(T, OAK, from, to, 0.26, 0.34, { up: [1, 0, 0], chamfer: 0.025, rng: seededRandom(40 + k) });
        // A diagonal brace from each arm to the next, which is what stops a big wheel racking.
        const next = wheelPoint(Rsole - 0.1, a + Math.PI / 4 - 0.02, xc + dx * 1.02);
        const mid = wheelPoint(Rsole * 0.55, a, xc + dx * 1.02);
        bar(T, 0x7f5730, mid, next, 0.13, 0.17, { up: [1, 0, 0] });
      }
      X.push({ geometry: onX(spin([[0, -0.2], [0.72, -0.2], [0.82, -0.1], [0.82, 0.1], [0.72, 0.2], [0, 0.2]], { segments: 24 })), color: IRON, position: [xc + dx * 1.02, y0, z0] });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2 + Math.PI / 8;
        dot(X, 0x2d3034, 0.06, wheelPoint(0.62, a, xc + dx * 1.26), { sides: 6 });
      }
    }
    // The shaft: one great octagonal baulk, banded in iron, from the wheel's outer bearing right through
    // the wall to the bearing beyond the pit wheel.
    const xEnd = 9.0;
    const xIn = G.pit.x - 0.62;
    {
      const g = new THREE.CylinderGeometry(0.42, 0.42, xEnd - xIn, 8, 1);
      g.rotateZ(Math.PI / 2);
      g.rotateX(Math.PI / 8);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3);
      T.push({ geometry: g, color: 0x8b6236, position: [(xEnd + xIn) / 2, y0, z0] });
      for (const x of [xc - 2.05, xc + 2.05, G.pit.x + 0.32, 3.2, xEnd - 0.2]) {
        X.push({ geometry: onX(ringGeo(0.43, 0.035, { segments: 20, sides: 6 })), color: IRON, position: [x, y0, z0] });
      }
      // Gudgeons: iron pins running in their bearings at each end.
      X.push({ geometry: onX(spin([[0, xEnd - 0.2], [0.2, xEnd - 0.2], [0.2, xEnd + 0.3], [0.14, xEnd + 0.36], [0, xEnd + 0.36]], { segments: 14 })), color: 0x5d6066, position: [0, y0, z0] });
      X.push({ geometry: onX(spin([[0, xIn - 0.2], [0.14, xIn - 0.2], [0.2, xIn - 0.15], [0.2, xIn + 0.2], [0, xIn + 0.2]], { segments: 14 })), color: 0x5d6066, position: [0, y0, z0] });
      // A stone pier in the channel for the outer bearing, with its oak block on top.
      stoneBox(8.55, 9.28, 0, y0 - 0.58, z0 - 0.95, z0 + 0.95, 0xa89d86, 5);
      block(T, DARK, 0.75, 0.42, 1.2, [8.92, y0 - 0.38, z0]);
      block(X, IRON, 0.48, 0.2, 0.6, [8.92, y0 - 0.16, z0]);
      X.push({ geometry: onX(ringGeo(0.22, 0.05, { segments: 16, sides: 6 })), color: IRON, position: [8.92, y0, z0] });
      // The wall bearing where the shaft comes through the masonry: an iron plate on an oak pad.
      block(T, DARK, 0.14, 1.9, 1.9, [xE0 + 0.08, y0, z0]);
      block(X, IRON, 0.1, 1.15, 1.15, [xE0 + 0.17, y0, z0]);
      // The inner bearing post on the pit floor.
      const xPost = G.pit.x - 0.7; // narrow, because the upright shaft stands just beyond it
      bar(T, DARK, [xPost, BT + 0.05, z0], [xPost, y0 - 0.34, z0], 0.76, 0.34, { chamfer: 0.03, up: [1, 0, 0] });
      block(X, IRON, 0.34, 0.2, 0.58, [xPost, y0 - 0.25, z0]);
      X.push({ geometry: onX(ringGeo(0.22, 0.05, { segments: 16, sides: 6 })), color: IRON, position: [xPost, y0, z0] });
    }
  }

  // ------------------------------------------------------------- the pit wheel, cogs on its face
  {
    const { x: xp, R, N } = G.pit;
    const rimO = R + 0.28; const rimI = R - 0.3;
    const rim = onX(spin([[rimI, -0.15], [rimO, -0.15], [rimO, 0.15], [rimI, 0.15]], { segments: 72, closed: true }));
    const uv = rim.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.5, uv.getX(i) * 4);
    T.push({ geometry: rim, color: 0x8c6236, position: [xp, y0, z0] });
    // Clasp arms: four timbers meeting in a square round the shaft, the way this was really framed.
    const hold = 0.5;
    for (const s of [-1, 1]) {
      bar(T, OAK, [xp, y0 + s * hold, z0 - rimI - 0.1], [xp, y0 + s * hold, z0 + rimI + 0.1], 0.28, 0.32, { up: [1, 0, 0], chamfer: 0.02 });
      bar(T, OAK, [xp, y0 - rimI - 0.1, z0 + s * hold], [xp, y0 + rimI + 0.1, z0 + s * hold], 0.28, 0.32, { up: [1, 0, 0], chamfer: 0.02 });
    }
    for (let k = 0; k < N; k++) {
      const th = (k + 0.5) * ((Math.PI * 2) / N); // half a step, so a gap sits at the top, where the wallower meshes
      const up = [0, Math.cos(th), Math.sin(th)];
      const p = [0, y0 + R * Math.cos(th), z0 + R * Math.sin(th)];
      const a = [xp - G.pit.cogFace + 0.05, p[1], p[2]];
      const b = [xp - G.pit.cogFace - G.pit.cogLen, p[1], p[2]];
      bar(T, 0xd7ae6c, a, b, G.pit.cogT * 2, G.pit.cogR * 2, { up, chamfer: 0.018, rng: seededRandom(100 + k) });
    }
    for (const r of [rimO - 0.03]) X.push({ geometry: onX(ringGeo(r, 0.03, { segments: 60, sides: 6 })), color: IRON, position: [xp + 0.15, y0, z0] });
  }

  // ------------------------------------------------------------- the upright shaft, wallower and spur
  const yMesh = y0 + G.pit.R; // where the pit cogs reach, and so the height of the wallower's staves
  {
    const yBot = BT + 0.05;
    const yTop = EY - 0.75;
    const g = new THREE.CylinderGeometry(0.3, 0.3, yTop - yBot, 8, 1);
    g.rotateY(Math.PI / 8);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3);
    T.push({ geometry: g, color: 0x8f6738, position: [xu, (yBot + yTop) / 2, z0] });
    for (const y of [1.7, 4.6, 7.8, 9.5, 10.5, 12.0, 13.4]) {
      X.push({ geometry: ringGeo(0.315, 0.028, { segments: 18, sides: 5 }), color: IRON, position: [xu, y, z0] });
    }
    // Foot block and top bearing.
    block(S, 0xa89d86, 1.3, 0.5, 1.3, [xu, BT + 0.3, z0]);
    block(X, IRON, 0.62, 0.2, 0.62, [xu, EY - 0.68, z0]);
    // Wallower: a lantern of two discs and sixteen round staves.
    const { N, stave } = G.wallower;
    const half = 0.36;
    const disc = (y) => {
      const d = spin([[0, y - 0.09], [rw + 0.13, y - 0.09], [rw + 0.15, y - 0.06], [rw + 0.15, y + 0.06], [rw + 0.13, y + 0.09], [0, y + 0.09]], { segments: 36 });
      const uvD = d.attributes.uv;
      for (let i = 0; i < uvD.count; i++) uvD.setXY(i, uvD.getX(i) * 3, uvD.getY(i));
      T.push({ geometry: d, color: 0x7f5730, position: [xu, 0, z0] });
    };
    disc(yMesh - half - 0.09);
    disc(yMesh + half + 0.09);
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2; // stave 0 lies toward +X, exactly at the pit wheel's gap
      rod(T, 0xdab274, [xu + rw * Math.cos(a), yMesh - half - 0.1, z0 + rw * Math.sin(a)], [xu + rw * Math.cos(a), yMesh + half + 0.1, z0 + rw * Math.sin(a)], stave, { sides: 8 });
    }
    // Great spur wheel: a rim, compass arms mortised through the shaft, and radial cogs.
    const { y: ySp, R, N: NS, toothHalf, reach } = G.spur;
    const rimO = R - reach - 0.02;
    const rimI = rimO - 0.46;
    {
      const rim = spin([[rimI, ySp - 0.17], [rimO, ySp - 0.17], [rimO, ySp + 0.17], [rimI, ySp + 0.17]], { segments: 80, closed: true });
      const uvR = rim.attributes.uv;
      for (let i = 0; i < uvR.count; i++) uvR.setXY(i, uvR.getY(i) * 0.5, uvR.getX(i) * 6);
      T.push({ geometry: rim, color: 0x8c6236, position: [xu, 0, z0] });
      X.push({ geometry: ringGeo(rimI - 0.03, 0.03, { segments: 60, sides: 6, y: ySp + 0.17 }), color: IRON, position: [xu, 0, z0] });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.26;
        bar(T, OAK, [xu + Math.cos(a) * 0.15, ySp, z0 + Math.sin(a) * 0.15], [xu + Math.cos(a) * (rimI + 0.1), ySp, z0 + Math.sin(a) * (rimI + 0.1)], 0.3, 0.3, { up: [0, 1, 0], chamfer: 0.025, rng: seededRandom(11 + k) });
      }
      X.push({ geometry: spin([[0, ySp - 0.22], [0.62, ySp - 0.22], [0.68, ySp - 0.16], [0.68, ySp + 0.16], [0.62, ySp + 0.22], [0, ySp + 0.22]], { segments: 20 }), color: 0x6c5235, position: [xu, 0, z0] });
      // The bearing toward the nut is measured from +Z toward -X, so at angle a a radial points (-sin a, cos a).
      for (let k = 0; k < NS; k++) {
        const a = G.spurBearing + (k + 0.5) * ((Math.PI * 2) / NS); // half a step: a gap faces the nut
        const dx = -Math.sin(a); const dz = Math.cos(a);
        bar(T, 0xd7ae6c, [xu + dx * (R - reach - 0.06), ySp, z0 + dz * (R - reach - 0.06)], [xu + dx * (R + reach), ySp, z0 + dz * (R + reach)], toothHalf * 2, 0.3, { up: [0, 1, 0], chamfer: 0.016, rng: seededRandom(200 + k) });
      }
      // The stone nut: one tooth pointing straight back at the spur wheel's gap.
      const Tn = G.nut;
      const hub = rn - Tn.reach - 0.02;
      const nd = spin([[0, ySp - 0.2], [hub, ySp - 0.2], [hub, ySp + 0.2], [0, ySp + 0.2]], { segments: 26 });
      T.push({ geometry: nd, color: 0x8c6236, position: [sx, 0, sz] });
      for (let k = 0; k < Tn.N; k++) {
        const a = G.spurBearing + Math.PI + k * ((Math.PI * 2) / Tn.N);
        const dx = -Math.sin(a); const dz = Math.cos(a);
        bar(T, 0xe3c083, [sx + dx * (hub - 0.05), ySp, sz + dz * (hub - 0.05)], [sx + dx * (rn + Tn.reach), ySp, sz + dz * (rn + Tn.reach)], Tn.toothHalf * 2, 0.3, { up: [0, 1, 0], chamfer: 0.016, rng: seededRandom(240 + k) });
      }
      // The iron spindle, stepped in a bridge beam below the nut, and up through the floor to the runner.
      rod(X, 0x5d6066, [sx, ySp - 0.75, sz], [sx, FY + 1.1, sz], 0.095, { sides: 10 });
      bar(T, DARK, [-4.45, ySp - 0.78, sz], [sx + 1.15, ySp - 0.78, sz], 0.4, 0.36, { up: [0, 1, 0], chamfer: 0.02 });
      block(X, IRON, 0.36, 0.1, 0.36, [sx, ySp - 0.56, sz]);
      bar(T, DARK, [sx + 1.05, ySp - 0.78, sz], [sx + 1.05, FY - 0.5, sz], 0.3, 0.3, { chamfer: 0.02 });
    }
  }

  // ------------------------------------------------------------- the millstones, the tun, the hopper
  {
    const R = 2.0;
    const stone = (y0s, y1s, color) => {
      const g = spin([
        [0, y0s], [R - 0.05, y0s], [R, y0s + 0.03], [R, y1s - 0.04], [R - 0.05, y1s], [0.42, y1s - 0.0], [0.36, y1s - 0.08], [0, y1s - 0.08],
      ], { segments: 56 });
      const c = lin(color);
      tintVertices(g, (px, py, pz, out) => {
        const n = smoothNoise3(px * 1.5 + 9, py * 2, pz * 1.5);
        const speck = smoothNoise3(px * 6, py * 6, pz * 6);
        const k = 0.78 + 0.34 * n + 0.2 * (speck - 0.5);
        out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
      });
      X.push({ geometry: g, keepColor: true, position: [sx, 0, sz] });
    };
    const yBed0 = FY;
    const yBed1 = FY + 0.46;
    const yRun0 = yBed1 + 0.02;
    const yRun1 = yRun0 + 0.56;
    stone(yBed0, yBed1, 0x8f8b84);
    stone(yRun0, yRun1, 0xa8a297);
    // Iron bands shrunk round the runner, as a stone built up of pieces has.
    for (const y of [yRun0 + 0.12, yRun1 - 0.12]) X.push({ geometry: ringGeo(R + 0.006, 0.03, { segments: 56, sides: 6 }), color: IRON, position: [sx, y, sz] });
    // The dark eye, and the rynd bridging it, the iron the stone hangs from.
    X.push({ geometry: spin([[0, yRun1 - 0.08], [0.36, yRun1 - 0.08], [0.36, yRun1 - 0.075], [0, yRun1 - 0.075]], { segments: 16 }), color: 0x17181a, position: [sx, 0, sz] });
    bar(X, IRON, [sx - 0.38, yRun1 - 0.03, sz], [sx + 0.38, yRun1 - 0.03, sz], 0.14, 0.08, { up: [0, 1, 0] });
    rod(X, 0x5d6066, [sx, yRun1 - 0.1, sz], [sx, yRun1 + 1.5, sz], 0.04, { sides: 8 });
    // The tun: staves round both stones, cut away on the side toward the student.
    const Rt = R + 0.3;
    const yT0 = FY;
    const yT1 = yRun1 + 0.34;
    const openA = 1.05; // half the opening's angle, centred on +Z
    const nStaves = 44;
    const stavePitch = (Math.PI * 2) / nStaves;
    for (let k = 0; k < nStaves; k++) {
      const a = (k + 0.5) * stavePitch - Math.PI;
      if (Math.abs(a) < openA) continue;
      const x = sx + Math.sin(a) * Rt; const z = sz + Math.cos(a) * Rt;
      bar(T, k % 2 ? 0xad8450 : 0x9b7443, [x, yT0, z], [x, yT1, z], 2 * Rt * Math.sin(stavePitch / 2) + 0.01, 0.1, { up: [Math.sin(a), 0, Math.cos(a)], chamfer: 0.005, tile: [1, 3], rng: seededRandom(800 + k) });
    }
    // Two iron hoops round the tun, stopping where its staves stop.
    const arcPts = (r, y) => Array.from({ length: 40 }, (_, i) => {
      const a = openA + ((i / 39) * (Math.PI * 2 - openA * 2));
      return [sx + Math.sin(a) * r, y, sz + Math.cos(a) * r];
    });
    for (const y of [FY + 0.3, yT1 - 0.2]) X.push({ geometry: tube(arcPts(Rt + 0.06, y), 0.03, { sides: 5, steps: 80, round: 1 }), color: IRON });
    // Cut staves end on a post each side.
    for (const s of [-1, 1]) {
      const x = sx + Math.sin(openA * s) * Rt; const z = sz + Math.cos(openA * s) * Rt;
      bar(T, DARK, [x, FY, z], [x, yT1 + 0.04, z], 0.22, 0.22, { chamfer: 0.02 });
    }
    // The horse: four legs on the tun's rim that carry the hopper.
    const yH = yT1 + 1.0; // the hopper's mouth at the bottom
    const yH2 = yH + 1.35; // and its top
    const legR = Rt * 0.78;
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const fx = sx + dx * legR * 0.707 * 1.28; const fz = sz + dz * legR * 0.707 * 1.28;
      bar(T, DARK, [fx, FY + 0.02, fz + 0], [sx + dx * 0.95, yH + 0.05, sz + dz * 0.95], 0.2, 0.2, { chamfer: 0.015 });
    }
    for (const s of [-1, 1]) {
      bar(T, DARK, [sx - 1.05, yH + 0.05, sz + s * 0.95], [sx + 1.05, yH + 0.05, sz + s * 0.95], 0.18, 0.2);
      bar(T, DARK, [sx + s * 0.95, yH + 0.05, sz - 1.05], [sx + s * 0.95, yH + 0.05, sz + 1.05], 0.18, 0.2);
    }
    // The hopper: a frustum of four boards, wide open at the top and filled with grain.
    const rB = 0.26;
    const rT = 1.3;
    const hopper = (a, b, c, d, color) => {
      const g = new THREE.BufferGeometry();
      const pts = [a, b, c, d];
      const thick = 0.07;
      const n = new THREE.Vector3().crossVectors(vec(b).sub(vec(a)), vec(d).sub(vec(a))).normalize();
      const pts2 = pts.map((p) => [p[0] - n.x * thick, p[1] - n.y * thick, p[2] - n.z * thick]);
      const all = [...pts, ...pts2];
      const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
      const pos = [];
      const uv = [];
      for (const f of faces) {
        const [p, q, r, s] = f.map((i) => all[i]);
        pos.push(...p, ...q, ...r, ...p, ...r, ...s);
        const w = vec(p).distanceTo(vec(q)) * 0.6;
        uv.push(0, 0, w, 0, w, 0.5, 0, 0, w, 0.5, 0, 0.5);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      T.push({ geometry: outward(g), color });
    };
    const B = (sxx, szz, r, y) => [sx + sxx * r, y, sz + szz * r];
    hopper(B(-1, 1, rB, yH), B(1, 1, rB, yH), B(1, 1, rT, yH2), B(-1, 1, rT, yH2), 0xb99463);
    hopper(B(1, 1, rB, yH), B(1, -1, rB, yH), B(1, -1, rT, yH2), B(1, 1, rT, yH2), 0xa98354);
    hopper(B(1, -1, rB, yH), B(-1, -1, rB, yH), B(-1, -1, rT, yH2), B(1, -1, rT, yH2), 0xb99463);
    hopper(B(-1, -1, rB, yH), B(-1, 1, rB, yH), B(-1, 1, rT, yH2), B(-1, -1, rT, yH2), 0xa98354);
    {
      // Grain: a low heap filling the mouth, dappled because grain is a thousand things and not a colour.
      const g = new THREE.SphereGeometry(rT * 1.14, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 0.32, 1);
      const c1 = lin(0xd8a944); const c2 = lin(0x9d7226);
      tintVertices(g, (px, py, pz, out) => {
        const n = smoothNoise3(px * 22, py * 22, pz * 22);
        out[0] = mix(c1[0], c2[0], n); out[1] = mix(c1[1], c2[1], n); out[2] = mix(c1[2], c2[2], n);
      });
      // A dome's open base is hidden under the hopper's top edge.
      X.push({ geometry: g, keepColor: true, position: [sx, yH2 - 0.2, sz] });
      const floor = spin([[0, -0.01], [rT * 1.1, -0.01], [rT * 1.1, 0], [0, 0.0]], { segments: 26 });
      X.push({ geometry: floor, color: 0x9d7226, position: [sx, yH2 - 0.2, sz] });
    }
    // The shoe under the hopper, which the damsel shakes to feed grain into the eye.
    bar(T, 0xb99463, [sx + 0.28, yH - 0.06, sz], [sx - 0.02, yH - 0.72, sz], 0.42, 0.06, { up: [0.4, 1, 0] });
    bar(T, DARK, [sx + 0.27, yH - 0.06, sz + 0.2], [sx - 0.02, yH - 0.72, sz + 0.2], 0.04, 0.16, { up: [0.4, 1, 0] });
    bar(T, DARK, [sx + 0.27, yH - 0.06, sz - 0.2], [sx - 0.02, yH - 0.72, sz - 0.2], 0.04, 0.16, { up: [0.4, 1, 0] });
    // The spout carrying flour down through the floor to the sack.
    const spoutTop = [sx - 1.25, FY + 0.24, sz + 1.2];
    const spoutBot = [sx - 1.25, 3.6, sz + 1.2];
    bar(T, 0x8a6236, spoutTop, spoutBot, 0.3, 0.3, { chamfer: 0.015 });
    X.push({ geometry: spin([[0, 0], [0.28, 0], [0.32, 0.03], [0.32, 0.4], [0.25, 0.46], [0, 0.46]], { segments: 14 }), color: 0xbfb399, position: [spoutBot[0], spoutBot[1] - 0.42, spoutBot[2]] });
  }

  // ------------------------------------------------------------- the sacks of flour
  {
    const sack = (x, z, sc, seed, lean = 0) => {
      const prof = [
        [0, 0], [0.5, 0], [0.74, 0.08], [0.86, 0.32], [0.9, 0.72], [0.84, 1.1], [0.66, 1.42], [0.38, 1.66], [0.17, 1.76], [0.15, 1.82], [0.21, 1.9], [0.3, 2.04], [0.25, 2.1], [0.12, 2.0], [0, 1.96],
      ];
      const fine = smoothPoly(prof, 28);
      fine[0] = [0, 0];
      fine[fine.length - 1] = [0, fine[fine.length - 1][1]];
      const g = spin(fine, { segments: 26 });
      const pos = g.attributes.position;
      const rng = seededRandom(seed);
      const ph = rng() * 10;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i); const py = pos.getY(i); const pz = pos.getZ(i);
        const a = Math.atan2(px, pz);
        const belly = sstep(py, 0.02, 0.5) * (1 - sstep(py, 1.5, 1.72));
        const fold = py > 1.6 ? 0.11 * Math.sin(a * 9 + ph) : 0;
        const k = 1 + belly * 0.14 * (smoothNoise3(px * 1.1 + ph, py * 1.1, pz * 1.1) - 0.5) * 2 + fold;
        // A filled sack squats: it slumps out at the bottom and leans toward nothing in particular.
        const sq = 1 + (1 - sstep(py, 0.05, 0.9)) * 0.08;
        pos.setXYZ(i, px * k * sq * 1.08, py, pz * k * sq * 0.92);
      }
      g.computeVertexNormals();
      const c1 = lin(0xd9caa4);
      const c2 = lin(0xb6a57e);
      tintVertices(g, (px, py, pz, out) => {
        // Sacking is a weave: hessian's fine cross-hatch cannot be carried by the mesh, so a mottle stands for it,
        // and a pale dust of flour settles on what faces upward.
        const n = smoothNoise3(px * 7 + 3, py * 7, pz * 7);
        const t = n * 0.75 + (py > 1.5 ? 0.25 : 0);
        out[0] = mix(c1[0], c2[0], t); out[1] = mix(c1[1], c2[1], t); out[2] = mix(c1[2], c2[2], t);
      });
      g.scale(sc, sc, sc);
      if (lean) g.rotateZ(lean);
      g.translate(x, BT + 0.05, z);
      X.push({ geometry: g, keepColor: true });
      // The twine tie.
      const tieY = BT + 0.05 + 1.79 * sc;
      X.push({ geometry: ringGeo(0.17 * sc, 0.03, { segments: 16, sides: 5 }), color: 0x6d5934, position: [x - Math.sin(lean) * 1.79 * sc, tieY, z] });
    };
    const xS = sx - 1.25; const zS = sz + 1.2;
    sack(xS, zS, 1.0, 31);
    sack(xS + 2.0, zS + 0.55, 0.95, 32);
    sack(xS + 3.65, zS + 0.05, 1.02, 33);
    sack(xS + 2.9, zS - 1.5, 0.9, 34);
    // Flour spilled on the flags round the first sack.
    const dust = spin([[0, 0], [1.1, 0], [0.95, 0.01], [0, 0.015]], { segments: 22 });
    X.push({ geometry: dust, color: 0xd8d0ba, position: [xS, BT + 0.055, zS] });
  }

  // ------------------------------------------------------------- the flume on its trestle
  const fX = xc;
  const fHalf = 1.0;
  const fEnd = z0 - 0.75;
  const fStart = -9.4;
  const fY = (z) => y0 + Router + 0.3 + (fEnd - z) * 0.02;
  const fH = 0.95;
  {
    const yA = fY(fStart); const yB = fY(fEnd);
    bar(T, 0x8b6337, [fX, yA, fStart], [fX, yB, fEnd], fHalf * 2, 0.12, { up: [0, 1, 0], tile: [1, 3] });
    // Side boards, two to a side, and a cross-frame every few feet.
    for (const s of [-1, 1]) {
      for (const [lift, color] of [[0.28, 0x9b7443], [0.71, 0xa77e49]]) {
        bar(T, color, [fX + s * (fHalf - 0.05), yA + lift, fStart], [fX + s * (fHalf - 0.05), yB + lift, fEnd], 0.1, 0.42, { up: [0, 1, 0], tile: [1, 3], chamfer: 0.012, rng: seededRandom(900 + lift * 10) });
      }
    }
    for (let z = fStart + 0.4; z < fEnd - 0.2; z += 1.55) {
      const y = fY(z);
      for (const s of [-1, 1]) bar(T, DARK, [fX + s * (fHalf + 0.05), y - 0.2, z], [fX + s * (fHalf + 0.05), y + fH + 0.04, z], 0.14, 0.2, { chamfer: 0.015 });
      bar(T, DARK, [fX - fHalf - 0.1, y - 0.14, z], [fX + fHalf + 0.1, y - 0.14, z], 0.2, 0.18, { chamfer: 0.015 });
      bar(T, DARK, [fX - fHalf - 0.1, y + fH + 0.04, z], [fX + fHalf + 0.1, y + fH + 0.04, z], 0.14, 0.1);
    }
    // Water in it: a solid, level just under the boards.
    {
      const len = Math.hypot(fEnd - fStart, yB - yA);
      const g = new THREE.BoxGeometry(fHalf * 2 - 0.16, 0.52, len, 1, 1, 1);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.62 + uv.getY(i) * 0.36);
      const tilt = Math.atan2(yA - yB, fEnd - fStart);
      g.rotateX(tilt);
      g.translate(fX, (yA + yB) / 2 + 0.33, (fStart + fEnd) / 2);
      Wa.push({ geometry: g, color: 0xffffff });
    }
    // The sluice board that lets the water on: a sliding gate with its rack and lever.
    const zG = -5.6;
    const yG = fY(zG);
    bar(T, 0xa77e49, [fX - fHalf, yG + 0.08, zG], [fX + fHalf, yG + 0.08, zG], 0.1, 0.34, { up: [0, 1, 0] });
    for (const s of [-1, 1]) {
      bar(T, DARK, [fX + s * (fHalf + 0.1), yG - 0.1, zG], [fX + s * (fHalf + 0.1), yG + 1.8, zG], 0.18, 0.18, { chamfer: 0.015 });
    }
    bar(T, DARK, [fX - fHalf - 0.25, yG + 1.8, zG], [fX + fHalf + 0.25, yG + 1.8, zG], 0.18, 0.2, { chamfer: 0.015 });
    bar(T, 0xa77e49, [fX, yG + 0.1, zG], [fX, yG + 1.45, zG], 0.08, 0.26, { up: [0, 0, 1] });
    bar(T, DARK, [fX - 0.9, yG + 1.42, zG], [fX + 1.0, yG + 1.55, zG], 0.08, 0.1);
    // Trestle: two bents standing on the banks, both clear behind the wheel, with cross braces.
    for (const z of [-8.1, -6.55]) {
      const y = fY(z);
      const xA = 4.95;
      const xB = 9.42;
      const yFoot = BT + 0.1;
      bar(T, DARK, [xA, y - 0.2, z], [xB, y - 0.2, z], 0.34, 0.34, { chamfer: 0.025 });
      for (const x of [xA + 0.05, xB - 0.05]) {
        bar(T, ELM, [x, yFoot, z], [x, y - 0.25, z], 0.36, 0.36, { chamfer: 0.03 });
        S.push({ geometry: new THREE.BoxGeometry(0.75, 0.3, 0.75), color: 0xa89d86, position: [x, BT + 0.13, z] });
      }
      bar(T, ELM, [xA + 0.05, yFoot + 0.3, z], [xB - 0.05, y - 1.0, z], 0.18, 0.2);
      bar(T, ELM, [xB - 0.05, yFoot + 0.3, z], [xA + 0.05, y - 1.0, z], 0.18, 0.2);
    }
    for (const x of [4.95, 9.37]) bar(T, ELM, [x, BT + 2.0, -8.1], [x, fY(-6.55) - 0.6, -6.55], 0.16, 0.18);
    // The flume's free end hangs from an oak beam run out of the gable, on iron rods, so that nothing
    // stands in front of the wheel.
    {
      const zH = fEnd - 0.7;
      const yBeam = fY(zH) + 2.05;
      bar(T, DARK, [xE0 - 0.2, yBeam, zH], [fX + fHalf + 0.5, yBeam, zH], 0.4, 0.42, { chamfer: 0.03 });
      for (const s2 of [-1, 1]) {
        rod(X, IRON, [fX + s2 * (fHalf + 0.13), yBeam, zH], [fX + s2 * (fHalf + 0.13), fY(zH) - 0.22, zH], 0.038, { sides: 6 });
      }
      bar(T, DARK, [fX - fHalf - 0.25, fY(zH) - 0.2, zH], [fX + fHalf + 0.25, fY(zH) - 0.2, zH], 0.22, 0.2, { chamfer: 0.015 });
      bar(T, ELM, [xE0 + 0.02, yBeam - 2.5, zH], [xE0 + 1.55, yBeam - 0.2, zH], 0.2, 0.22);
    }
  }

  // ------------------------------------------------------------- falling water
  {
    const yw = fY(fEnd) + 0.5; // the flume's water surface at its lip
    const sheetAt = (u, v) => {
      // A thrown jet: level at the lip, falling as a parabola onto the crown of the wheel.
      const z = mix(fEnd - 0.1, z0 + 1.15, v);
      const t = v;
      const y = yw - t * t * (yw - (y0 + Router * 0.965));
      const x = fX + (u - 0.5) * (fHalf * 2 - 0.2) * (1 - 0.1 * v);
      return [x, y, z];
    };
    {
      const jet = closedSheet({ nu: 20, nv: 14, point: sheetAt, half: (u, v) => 0.1 * (1 - 0.3 * v) });
      // Streaks running with the flow, or a sheet of water with nothing on it reads as glass.
      const c1 = lin(0x56b8ea);
      const c2 = lin(0xd8f2fc);
      const uv = jet.attributes.uv;
      tintVertices(jet, (px, py, pz, out, i) => {
        const t = 0.5 + 0.5 * Math.sin(uv.getX(i) * 40 + uv.getY(i) * 2);
        const k = t * t;
        out[0] = mix(c1[0], c2[0], k); out[1] = mix(c1[1], c2[1], k); out[2] = mix(c1[2], c2[2], k);
      });
      P.push({ geometry: jet, keepColor: true });
    }
    // Streams spilling out of the buckets as they near the bottom, and running down to the race.
    const rng = seededRandom(84);
    for (let k = 0; k < 9; k++) {
      const x = xc + (k / 8 - 0.5) * 2.3;
      const th0 = 2.2 + (rng() - 0.5) * 0.5;
      const start = wheelPoint(Router - 0.1, th0, x);
      const dz = 0.25 + rng() * 0.25;
      const len = start[1] - yWater;
      const g = tube([start, [x, start[1] - len * 0.35, start[2] + dz * 0.8], [x, start[1] - len * 0.75, start[2] + dz * 1.15], [x, yWater, start[2] + dz * 1.25]], [0.055, 0.075, 0.075, 0.1], { sides: 7, steps: 12, round: 1 });
      P.push({ geometry: g, color: 0xa8e0f8 });
    }
    // Drops, thrown off the lower rim.
    for (let k = 0; k < 42; k++) {
      const th = 1.5 + rng() * 1.5;
      const r = Router + 0.12 + rng() * 0.75;
      const p = wheelPoint(r, th, xc + (rng() - 0.5) * 2.7);
      const g = new THREE.IcosahedronGeometry(0.035 + rng() * 0.05, 0);
      P.push({ geometry: g, color: 0xd0f0fc, position: p });
    }
  }

  const wood = grainMaps({ seed: 1086, knots: 4, strength: 0.55, width: 256, height: 512, streaks: 150 });
  const stone = stoneMaps();
  const slate = slateMaps();
  const water = streamMap();
  // All the wood's mesh takes its colour from the vertices; the pale grain map only modulates it.
  const stoneGeo = mergeParts(S);
  // Weather the masonry: a slow blotch, and grime climbing from the ground.
  {
    const pos = stoneGeo.attributes.position;
    const col = stoneGeo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const n = smoothNoise3(x * 0.28, y * 0.28, z * 0.28);
      const grime = 1 - 0.3 * (1 - sstep(y, BT, 3.2));
      const k = (0.84 + 0.26 * n) * grime;
      col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k * 0.98);
    }
  }
  const pourGeo = mergeParts(P);
  const pour = new THREE.Mesh(pourGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.74, depthWrite: false }));
  pour.castShadow = false;
  const waterMesh = meshFrom(mergeParts(Wa), { map: water, vertexColors: false, roughness: 0.14, metalness: 0 }, { shadow: false });
  return groupOf(
    meshFrom(mergeParts(T), { ...wood, roughness: 0.74, metalness: 0 }),
    meshFrom(stoneGeo, { ...stone, roughness: 0.88, metalness: 0 }),
    meshFrom(mergeParts(Rf), { ...slate, roughness: 0.62, metalness: 0 }),
    meshFrom(mergeParts(X), { roughness: 0.72, metalness: 0.06 }),
    waterMesh,
    pour,
  );
}

export const BUILDERS = {
  typewriter,
  'wind-turbine': windTurbine,
  'water-mill': waterMill,
  'roman-chariot': romanChariot,
  'ming-vase': mingVase,
};
