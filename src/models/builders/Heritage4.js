import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom } from '../../PropKit.js';
import {
  extrudeOutline, revolve, mergeParts, outlineArea, smoothNoise3, solidSurface,
} from '../../props/LoftKit.js';
import {
  tube, lin, clamp01, mix, sstep, outward, tintVertices,
} from '../ModelKit.js';

// The Model Database's fourth batch of heritage objects.
//
//   candlestick-telephone   a 1920s desk telephone, four times life, facing +Z.
//   turtle-submarine        Bushnell's Turtle as the reconstructions show it, life size, cut open.
//   clipper-ship            a three-masted clipper, 47ft on deck at scale 1, bow at +Z.
//   sod-house               a Great Plains soddy, life size, on its patch of prairie.
//   empire-state-building   1/35, computed from a table of setbacks.
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

// A surface of revolution about +Y from `[r, y]` or `[r, y, 'h']` points (h doubles the point, which
// keeps a hard edge), either a closed loop or a run from axis to axis. Its direction is measured,
// because `revolve` takes its winding from it.
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

// A box from a to b with `up` fixing which way its `h` runs, so a timber can lie at any angle.
function bar(list, color, a, b, w, h, { up = null } = {}) {
  const A = vec(a);
  const B = vec(b);
  const len = A.distanceTo(B);
  if (len < 1e-4) return;
  const z = B.clone().sub(A).normalize();
  let ref = up ? vec(up).normalize() : Y_AXIS.clone();
  if (Math.abs(ref.dot(z)) > 0.985) ref = Math.abs(z.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(ref, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(A.add(B).multiplyScalar(0.5));
  list.push({ geometry: new THREE.BoxGeometry(w, h, len).applyMatrix4(m), color });
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

function meshFrom(geometry, params, { shadow = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, ...params }));
  m.castShadow = shadow;
  m.receiveShadow = receive;
  return m;
}

function groupOf(...meshes) {
  const g = new THREE.Group();
  for (const m of meshes) if (m) g.add(m);
  return g;
}

// A collector of hard-edged flat quads with their own normals, colours and UVs. Non-indexed on
// purpose: a crisp corner is two normals at one position.
class Soup {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; }

  // a, b, c, d run counter-clockwise seen from outside.
  quad(a, b, c, d, uv, col) {
    // Across the two diagonals, so a quad folded to a triangle (d = a) still has a normal.
    const ab = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ad = [a[0] - b[0] + d[0] - a[0], a[1] - b[1] + d[1] - a[1], a[2] - b[2] + d[2] - a[2]];
    let nx = ab[1] * ad[2] - ab[2] * ad[1];
    let ny = ab[2] * ad[0] - ab[0] * ad[2];
    let nz = ab[0] * ad[1] - ab[1] * ad[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const cols = Array.isArray(col[0]) ? col : [col, col, col, col];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = [a, b, c, d][i];
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      this.u.push(uv[i][0], uv[i][1]);
      this.c.push(cols[i][0], cols[i][1], cols[i][2]);
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// ---------------------------------------------------------------------------
// The Empire State Building, from a table of setbacks
// ---------------------------------------------------------------------------

// True feet. Published: 424 x 187ft on the lot, five storeys of base, setbacks at the 21st, 25th, 30th,
// 72nd, 81st and 85th floors, 86th floor at 1,050ft, roof 1,250ft, antenna tip 1,454ft. The plan
// dimensions of the tiers above the base are this model's reading of the elevations, NOT published
// figures. Steps cut the corners: [in from the x face, in from the z face], outermost first.
const ESB_SCALE = 1 / 35;
const ESB_PLINTH = 0.12; // the plaza's top, which every height below stands on
const ESB_FLOOR = 12 * ESB_SCALE;
const esbY = (trueFeet) => ESB_PLINTH + trueFeet * ESB_SCALE;
const esbFloorY = (n) => esbY(80 + (n - 6) * 12); // floor n's sill; floor 6 starts at 80ft, 86 at 1,040ft
const ESB_TIERS = [
  { from: 6, to: 21, w: 141, d: 310, steps: [[18, 30]] },
  { from: 21, to: 25, w: 134, d: 272, steps: [[18, 24]] },
  { from: 25, to: 30, w: 128, d: 228, steps: [[16, 20]] },
  { from: 30, to: 72, w: 120, d: 186, steps: [[15, 32], [31, 15]] },
  { from: 72, to: 81, w: 100, d: 146, steps: [[12, 22], [24, 10]] },
  { from: 81, to: 85, w: 80, d: 108, steps: [[10, 14]] },
  { from: 85, to: 87, w: 64, d: 76, steps: [[7, 8]] },
];

// The stepped plan's corners, walked +X face -> +Z face -> -X face -> -Z face.
function esbOutline(hx, hz, steps, grow = 0) {
  const q = [];
  let dxPrev = 0;
  for (const [dx, dz] of steps) {
    q.push([hx + grow - dxPrev, hz + grow - dz]);
    q.push([hx + grow - dx, hz + grow - dz]);
    dxPrev = dx;
  }
  q.push([hx + grow - dxPrev, hz + grow]);
  const out = [];
  for (const [x, z] of q) out.push([x, z]);
  for (let i = q.length - 1; i >= 0; i--) out.push([-q[i][0], q[i][1]]);
  for (let i = 0; i < q.length; i++) out.push([-q[i][0], -q[i][1]]);
  for (let i = q.length - 1; i >= 0; i--) out.push([q[i][0], -q[i][1]]);
  return out;
}

const ESB_STRIPS = 16;
const ESB_ROWS = 32;
const ESB_PIER = 0.27; // half a pier as a share of one strip

function esbFacadeMaps() {
  const W = 1024; const H = 2048;
  const sw = W / ESB_STRIPS; const fh = H / ESB_ROWS;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(1931);
  ctx.fillStyle = '#f4f0e8';
  ctx.fillRect(0, 0, W, H);
  // Limestone: broad patches of tone, then a joint at every floor and part way between.
  for (let i = 0; i < 900; i++) {
    const v = 226 + Math.round(rng() * 28);
    ctx.fillStyle = `rgba(${v},${v - 3},${v - 9},0.5)`;
    ctx.fillRect(rng() * W, rng() * H, 8 + rng() * 40, 6 + rng() * 26);
  }
  const lit = makeCanvas(512, 1024);
  lit.ctx.fillStyle = '#000000';
  lit.ctx.fillRect(0, 0, 512, 1024);
  const pier = sw * ESB_PIER; // half a pier either side of a strip
  for (let s = 0; s < ESB_STRIPS; s++) {
    const x0 = s * sw + pier;
    const ww = sw - pier * 2;
    // The nickel-chrome mullions run the full height of the strip without a break.
    ctx.fillStyle = '#c6c5c0';
    ctx.fillRect(x0 - 2, 0, ww + 4, H);
    for (let r = 0; r < ESB_ROWS; r++) {
      const y0 = r * fh;
      // Aluminium spandrel, then the window above it.
      const spandrel = fh * 0.36;
      const yWin = y0 + 2;
      const hWin = fh - spandrel - 4;
      ctx.fillStyle = '#b1afa7';
      ctx.fillRect(x0 + 1, y0 + fh - spandrel, ww - 2, spandrel);
      ctx.fillStyle = 'rgba(58,58,56,0.8)';
      ctx.fillRect(x0 + ww * 0.14, y0 + fh - spandrel * 0.72, ww * 0.72, 2);
      ctx.fillRect(x0 + ww * 0.14, y0 + fh - spandrel * 0.3, ww * 0.72, 2);
      const tone = rng();
      const g = 52 + Math.round(tone * 40);
      ctx.fillStyle = `rgb(${g - 8},${g},${g + 12})`;
      ctx.fillRect(x0 + 1, yWin, ww - 2, hWin);
      // The double-hung sash's meeting rail, and a blind pulled part way in some windows.
      if (tone > 0.62) {
        ctx.fillStyle = 'rgba(206,202,188,0.68)';
        ctx.fillRect(x0 + 1, yWin, ww - 2, hWin * (0.2 + rng() * 0.5));
      }
      ctx.fillStyle = '#b8b6ae';
      ctx.fillRect(x0 + 1, yWin + hWin * 0.48, ww - 2, 2.4);
      if (rng() < 0.03) {
        const warm = rng();
        lit.ctx.fillStyle = warm > 0.3 ? '#ffc877' : '#fff0c8';
        lit.ctx.fillRect((x0 + 1) / 2, yWin / 2, (ww - 2) / 2, hWin / 2);
      }
    }
    // Soot weeping down from the sill of every twentieth or so bay.
    if (rng() < 0.5) {
      ctx.fillStyle = 'rgba(120,112,100,0.1)';
      ctx.fillRect(s * sw, rng() * H, pier, 200 + rng() * 400);
    }
  }
  ctx.fillStyle = 'rgba(120,112,98,0.4)';
  for (let r = 0; r < ESB_ROWS * 2; r++) {
    const y = r * fh * 0.5;
    for (let s = 0; s <= ESB_STRIPS; s++) ctx.fillRect(s * sw - pier, y, pier * 2, 1.2);
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), emissiveMap: texOf(lit.canvas, THREE.SRGBColorSpace) };
}

// A rectangular tile of the five-storey base: 8 bays, one tile tall.
function esbBaseMap() {
  const W = 1024; const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(34);
  ctx.fillStyle = '#efe9dd';
  ctx.fillRect(0, 0, W, H);
  for (let r = 0; r < 26; r++) {
    const y = (r / 26) * H;
    ctx.fillStyle = 'rgba(110,100,86,0.42)';
    ctx.fillRect(0, y, W, 1.4);
    const off = r % 2 ? 0 : 32;
    for (let c = 0; c < 16; c++) ctx.fillRect(off + c * 64, y, 1.4, H / 26);
    for (let c = 0; c < 16; c++) {
      const v = 214 + Math.round(rng() * 34);
      ctx.fillStyle = `rgba(${v},${v - 4},${v - 12},0.45)`;
      ctx.fillRect(off + c * 64, y, 64, H / 26);
    }
  }
  const bay = W / 8;
  for (let b = 0; b < 8; b++) {
    const x = b * bay + bay * 0.14;
    const w = bay * 0.72;
    // Upper storeys, a tall recessed window group with an aluminium spandrel between each floor.
    ctx.fillStyle = '#b8b6ad';
    ctx.fillRect(x - 3, H * 0.09, w + 6, H * 0.585);
    // Four floors above the shops, which with the shop level makes the five storeys the card counts.
    for (let f = 0; f < 4; f++) {
      const y = H * (0.095 + f * 0.142);
      for (let k = 0; k < 3; k++) {
        const wx = x + 2 + k * (w / 3);
        ctx.fillStyle = '#37414b';
        ctx.fillRect(wx, y, w / 3 - 4, H * 0.1);
        ctx.fillStyle = '#b5b3ab';
        ctx.fillRect(wx, y + H * 0.05, w / 3 - 4, 2);
      }
      ctx.fillStyle = '#8c8a83';
      ctx.fillRect(x, y + H * 0.103, w, H * 0.036);
    }
    // The shop level: bronze frames round dark display glass.
    ctx.fillStyle = '#54402a';
    ctx.fillRect(x - 3, H * 0.72, w + 6, H * 0.28);
    ctx.fillStyle = '#242c33';
    ctx.fillRect(x + 3, H * 0.75, w - 6, H * 0.235);
    ctx.fillStyle = 'rgba(255,214,150,0.5)';
    ctx.fillRect(x + 3, H * 0.75, w - 6, H * 0.03);
    ctx.fillStyle = '#54402a';
    ctx.fillRect(x + w * 0.5 - 2, H * 0.75, 4, H * 0.235);
  }
  // The Deco cornice line at the top, a row of stepped chevrons.
  ctx.fillStyle = '#d8d0bf';
  ctx.fillRect(0, 0, W, H * 0.06);
  ctx.fillStyle = 'rgba(90,82,70,0.65)';
  for (let c = 0; c < 32; c++) {
    const x = c * (W / 32);
    ctx.beginPath();
    ctx.moveTo(x, H * 0.052);
    ctx.lineTo(x + W / 64, H * 0.012);
    ctx.lineTo(x + W / 32, H * 0.052);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(90,82,70,0.65)';
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(90,82,70,0.5)';
  ctx.fillRect(0, H * 0.06, W, 2);
  return texOf(canvas, THREE.SRGBColorSpace);
}

function esbPaverMap() {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rng = seededRandom(5);
  ctx.fillStyle = '#e8e5de';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const v = 214 + Math.round(rng() * 34);
      ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      ctx.fillRect(i * 16, j * 16, 16, 16);
    }
  }
  ctx.fillStyle = 'rgba(70,66,60,0.75)';
  for (let i = 0; i < 16; i++) {
    ctx.fillRect(i * 16, 0, 1.2, 256);
    ctx.fillRect(0, i * 16, 256, 1.2);
  }
  return texOf(canvas, THREE.SRGBColorSpace);
}

function esbTaxi(list, x, z, yaw, color) {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const at = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  block(list, color, 0.19, 0.09, 0.5, at(0, 0.145, 0), [0, yaw, 0]);
  block(list, color, 0.17, 0.08, 0.26, at(0, 0.225, -0.02), [0, yaw, 0]);
  block(list, 0x202830, 0.175, 0.05, 0.23, at(0, 0.225, -0.02), [0, yaw, 0]);
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    list.push({ geometry: new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10).rotateZ(Math.PI / 2), color: 0x15151a, position: at(a * 0.1, 0.12, b * 0.15), rotation: [0, yaw, 0] });
  }
}

function empireStateBuilding() {
  const rng = seededRandom(1250);
  const limestone = lin(0xe2d9c6);
  const facade = new Soup();
  const basePart = new Soup();
  const plain = [];

  const P = 0.21; // one window strip, 7.35ft at this scale
  const rowsPerTile = ESB_ROWS;
  const pierU = (ESB_PIER / ESB_STRIPS);
  const shade = (y, top) => {
    // Grime settles low on the building and every setback's own parapet shades the wall beneath it.
    const k = mix(0.8, 1.04, clamp01(y / 34));
    return [limestone[0] * k * (top ? 1.05 : 1), limestone[1] * k * (top ? 1.05 : 1), limestone[2] * k * (top ? 1.02 : 1)];
  };

  // One wall of a tier, from a to b at the plan level: integer window strips, integer floors.
  const wall = (ax, az, bx, bz, y0, y1) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.round(len / P);
    const floors = Math.round((y1 - y0) / ESB_FLOOR);
    const v0 = Math.floor(rng() * rowsPerTile) / rowsPerTile;
    const v1 = v0 + floors / rowsPerTile;
    const c0 = shade(y0); const c1 = shade(y1);
    const nx = (bz - az) / len; const nz = -(bx - ax) / len;
    const A = [ax, y0, az]; const B = [bx, y0, bz]; const C = [bx, y1, bz]; const D = [ax, y1, az];
    if (n < 2) {
      // A return too short to hold a window: stone only.
      const u = pierU * 0.4;
      facade.quad(A, D, C, B, [[u, v0], [u, v1], [u + pierU * 0.4, v1], [u + pierU * 0.4, v0]], [c0, c1, c1, c0]);
      return;
    }
    const u0 = Math.floor(rng() * ESB_STRIPS) / ESB_STRIPS;
    const u1 = u0 + n / ESB_STRIPS;
    facade.quad(A, D, C, B, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]], [c0, c1, c1, c0]);
    // The real piers: stone fins standing proud between the strips. A wall of glass does not throw a
    // shadow, and it is the shadow line that says "vertical" from across the plaza.
    const half = P * ESB_PIER * 0.8;
    const proud = 0.026;
    const dx = (bx - ax) / len; const dz = (bz - az) / len;
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len;
      const lo = Math.max(0, t - half) ; const hi = Math.min(len, t + half);
      const q0x = ax + dx * lo; const q0z = az + dz * lo;
      const q1x = ax + dx * hi; const q1z = az + dz * hi;
      const f0 = [q0x + nx * proud, y0, q0z + nz * proud];
      const f1 = [q1x + nx * proud, y0, q1z + nz * proud];
      const f2 = [q1x + nx * proud, y1, q1z + nz * proud];
      const f3 = [q0x + nx * proud, y1, q0z + nz * proud];
      const uA = pierU * 0.15; const uB = uA + pierU * 0.5;
      const uvF = [[uA, v0], [uA, v1], [uB, v1], [uB, v0]];
      facade.quad(f0, f3, f2, f1, uvF, [c0, c1, c1, c0]);
      // The two reveals are darker, which is the whole point of them.
      const dk0 = c0.map((v) => v * 0.8); const dk1 = c1.map((v) => v * 0.8);
      facade.quad([q0x, y0, q0z], [q0x, y1, q0z], f3, f0, uvF, [dk0, dk1, dk1, dk0]);
      facade.quad(f1, f2, [q1x, y1, q1z], [q1x, y0, q1z], uvF, [dk0, dk1, dk1, dk0]);
    }
  };

  // A flat cap over a stepped outline, fanned from its centre. The plan is star-shaped about the centre.
  const capOf = (soup, out, y, uvAt, col) => {
    for (let i = 0; i < out.length; i++) {
      const a = out[i]; const b = out[(i + 1) % out.length];
      soup.quad([0, y, 0], [b[0], y, b[1]], [a[0], y, a[1]], [0, y, 0], [uvAt(0, 0), uvAt(b[0], b[1]), uvAt(a[0], a[1]), uvAt(0, 0)], col);
    }
  };
  // The stone parapet: walls and a cap. It sits on the tier and everything above stands on it.
  const parapet = (out, y0, y1) => {
    const u = pierU * 0.5;
    const col = [limestone[0] * 1.05, limestone[1] * 1.05, limestone[2] * 1.02];
    const uvs = [[u, 0.1], [u, 0.101], [u + 0.001, 0.101], [u + 0.001, 0.1]];
    for (let i = 0; i < out.length; i++) {
      const a = out[i]; const b = out[(i + 1) % out.length];
      facade.quad([a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], uvs, col);
    }
    const roof = col.map((v) => v * 0.72);
    capOf(facade, out, y1, () => [u, 0.1], roof);
  };

  // --- the tiers -------------------------------------------------------------------------------
  const heights = [];
  for (const tier of ESB_TIERS) {
    const hx = tier.w * ESB_SCALE * 0.5;
    const hz = tier.d * ESB_SCALE * 0.5;
    const steps = tier.steps.map(([a, b]) => [a * ESB_SCALE, b * ESB_SCALE]);
    const out = esbOutline(hx, hz, steps);
    const y0 = esbFloorY(tier.from) + 0.05; // stands on the parapet below
    const y1 = esbFloorY(tier.to);
    for (let i = 0; i < out.length; i++) {
      const a = out[i]; const b = out[(i + 1) % out.length];
      wall(a[0], a[1], b[0], b[1], y0, y1);
    }
    parapet(esbOutline(hx, hz, steps, 0.03), y1, y1 + 0.05);
    heights.push({ floor: tier.to, y: y1 });
  }

  // --- the five-storey base --------------------------------------------------------------------
  const baseW = 187 * ESB_SCALE; const baseD = 424 * ESB_SCALE;
  const baseTop = esbFloorY(6);
  const bayW = 0.74;
  const wallBase = (ax, az, bx, bz, skip = null) => {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / bayW));
    const c0 = [0.62, 0.58, 0.5]; const c1 = [0.74, 0.7, 0.62];
    const emit = (t0, t1) => {
      const A = [mix(ax, bx, t0), ESB_PLINTH, mix(az, bz, t0)];
      const B = [mix(ax, bx, t1), ESB_PLINTH, mix(az, bz, t1)];
      const u0 = t0 * n / 8; const u1 = t1 * n / 8;
      basePart.quad(A, [A[0], baseTop, A[2]], [B[0], baseTop, B[2]], B, [[u0, 0], [u0, 1], [u1, 1], [u1, 0]], [c0, c1, c1, c0]);
    };
    if (skip) { emit(0, skip[0]); emit(skip[1], 1); } else emit(0, 1);
  };
  const portalHalf = 0.86;
  const hxB = baseW / 2; const hzB = baseD / 2;
  wallBase(hxB, -hzB, hxB, hzB);
  // The Fifth Avenue front, with the great entrance standing in its middle.
  wallBase(hxB, hzB, -hxB, hzB, [0.5 - portalHalf / baseW, 0.5 + portalHalf / baseW]);
  wallBase(-hxB, hzB, -hxB, -hzB);
  wallBase(-hxB, -hzB, hxB, -hzB);
  // The piece of wall above the portal and behind it, which the frame hides.
  const stoneC = [0.68, 0.64, 0.56];
  basePart.quad([portalHalf, ESB_PLINTH, hzB - 0.02], [portalHalf, baseTop, hzB - 0.02], [-portalHalf, baseTop, hzB - 0.02], [-portalHalf, ESB_PLINTH, hzB - 0.02], [[0.02, 0.97], [0.02, 0.98], [0.03, 0.98], [0.03, 0.97]], stoneC);
  // Base roof, a coping and the terrace behind it.
  capOf(basePart, esbOutline(hxB + 0.03, hzB + 0.03, []), baseTop + 0.05, () => [0.02, 0.97], [0.34, 0.32, 0.28]);
  for (const [a, b] of [[[hxB + 0.03, -hzB - 0.03], [hxB + 0.03, hzB + 0.03]], [[hxB + 0.03, hzB + 0.03], [-hxB - 0.03, hzB + 0.03]], [[-hxB - 0.03, hzB + 0.03], [-hxB - 0.03, -hzB - 0.03]], [[-hxB - 0.03, -hzB - 0.03], [hxB + 0.03, -hzB - 0.03]]]) {
    basePart.quad([a[0], baseTop, a[1]], [a[0], baseTop + 0.05, a[1]], [b[0], baseTop + 0.05, b[1]], [b[0], baseTop, b[1]], [[0.02, 0.985], [0.02, 0.99], [0.03, 0.99], [0.03, 0.985]], [0.72, 0.68, 0.6]);
  }

  // The Fifth Avenue entrance: built forward of the wall, since a recess cannot be cut. A dark glazed
  // panel, stone jambs projecting either side of it, a stepped Deco head above.
  const zF = hzB;
  const pH = baseTop - ESB_PLINTH - 0.36;
  const stone = 0xcdc4b0;
  block(plain, 0x1f262c, portalHalf * 2 - 0.2, pH - 0.1, 0.02, [0, ESB_PLINTH + (pH - 0.1) / 2, zF + 0.02]);
  for (let i = 0; i < 7; i++) {
    const x = -0.56 + i * (1.12 / 6);
    block(plain, 0xc2bdae, 0.022, pH - 0.56, 0.05, [x, ESB_PLINTH + 0.5 + (pH - 0.56) / 2, zF + 0.04]);
  }
  for (let r = 0; r < 5; r++) {
    block(plain, 0xc2bdae, 1.14, 0.016, 0.05, [0, ESB_PLINTH + 0.52 + r * ((pH - 0.6) / 4), zF + 0.04]);
  }
  block(plain, 0x7a6038, 1.28, 0.05, 0.3, [0, ESB_PLINTH + 0.46, zF + 0.15]); // the bronze canopy
  for (let i = 0; i < 4; i++) {
    const x = -0.45 + i * 0.3;
    block(plain, 0x2a2118, 0.24, 0.42, 0.02, [x, ESB_PLINTH + 0.22, zF + 0.04]);
    block(plain, 0x7a6038, 0.27, 0.03, 0.03, [x, ESB_PLINTH + 0.43, zF + 0.05]);
  }
  for (const s of [-1, 1]) {
    block(plain, stone, 0.2, pH + 0.1, 0.16, [s * (portalHalf - 0.03), ESB_PLINTH + (pH + 0.1) / 2, zF + 0.07]);
    block(plain, 0xbfb6a2, 0.1, pH + 0.3, 0.1, [s * (portalHalf + 0.11), ESB_PLINTH + (pH + 0.3) / 2, zF + 0.04]);
  }
  for (let i = 0; i < 3; i++) {
    const w = portalHalf * 2 + 0.2 - i * 0.34;
    block(plain, stone, w, 0.14, 0.16 - i * 0.02, [0, ESB_PLINTH + pH + 0.1 + i * 0.14, zF + 0.07]);
  }

  // --- the mooring mast, as a table of its own --------------------------------------------------
  // True heights: the 86th floor roof is 1,050ft and the mast's top is 1,250ft. The shoulder is carried
  // on the same wall generator, so the window rhythm climbs the crown too.
  const shoulder = [
    { y0: esbY(1064), y1: esbY(1088), w: 46, steps: [[6, 6]] },
    { y0: esbY(1088), y1: esbY(1112), w: 36, steps: [[5, 5]] },
  ];
  const baseOfShoulder = heights[heights.length - 1].y + 0.05;
  for (const s of shoulder) {
    const h = s.w * ESB_SCALE * 0.5;
    const steps = s.steps.map(([a, b]) => [a * ESB_SCALE, b * ESB_SCALE]);
    const out = esbOutline(h, h, steps);
    const y0 = s === shoulder[0] ? baseOfShoulder : s.y0;
    for (let i = 0; i < out.length; i++) {
      const a = out[i]; const b = out[(i + 1) % out.length];
      wall(a[0], a[1], b[0], b[1], y0, s.y1);
    }
    parapet(esbOutline(h, h, steps, 0.018), s.y1, s.y1 + 0.03);
  }

  // Four aluminium Deco wings stand against the shoulder, one on each face, stepping in as they rise.
  const metal = 0xd6d8d6;
  const wing = (dir) => {
    const R0 = 23 * ESB_SCALE + 0.01;
    const y0 = baseOfShoulder;
    const yTop = esbY(1168);
    const outline = [
      [0, y0], [R0 + 0.34, y0], [R0 + 0.34, y0 + 0.28], [R0 + 0.22, y0 + 0.28], [R0 + 0.22, y0 + 0.62],
      [R0 + 0.1, y0 + 0.62], [R0 + 0.1, y0 + 1.06], [R0 * 0.72, y0 + 1.06], [R0 * 0.72, y0 + 1.38], [R0 * 0.46, y0 + 1.38], [R0 * 0.46, yTop], [0, yTop],
    ];
    const g = toCreasedNormals(extrudeOutline(outline, 0.2, {}), 0.5);
    g.rotateY(dir);
    plain.push({ geometry: g, color: metal });
  };
  // A wing's outline is drawn in the x-y plane with its thickness along z, so a yaw carries it round.
  for (let i = 0; i < 4; i++) wing((i * Math.PI) / 2);

  // The mast's fluted shaft: a 24-pointed plan so the sun picks out its ribs, tapered as it rises.
  const mastBase = esbY(1112);
  const mastRibbed = (y0, y1, r0, r1, teeth, col) => {
    const pos = []; const nor = []; const colr = [];
    const n = teeth * 2;
    const C = new THREE.Color(col);
    const pt = (i, y, r) => {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (i % 2 ? 0.86 : 1);
      return [Math.sin(a) * rr, y, Math.cos(a) * rr];
    };
    for (let i = 0; i < n; i++) {
      const a0 = pt(i, y0, r0); const b0 = pt(i + 1, y0, r0); const a1 = pt(i, y1, r1); const b1 = pt(i + 1, y1, r1);
      const e1 = vec(b0).sub(vec(a0)); const e2 = vec(a1).sub(vec(a0));
      const N = e1.cross(e2).normalize();
      const dark = i % 2 ? 0.74 : 1;
      for (const v of [a0, b0, b1, a0, b1, a1]) { pos.push(...v); nor.push(N.x, N.y, N.z); colr.push(C.r * dark, C.g * dark, C.b * dark); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    plain.push({ geometry: g, keepColor: true });
    // The cap the next stage stands on, so no hole can be seen looking down the shaft.
  };
  const rf = 14 * ESB_SCALE;
  mastRibbed(mastBase - 0.3, esbY(1190), rf, rf * 0.84, 16, 0xcfd2d0);
  plain.push({ geometry: spin([[0, esbY(1188)], [rf * 0.9, esbY(1188)], [rf * 0.9, esbY(1192)], [0, esbY(1192)]], { segments: 32 }), color: 0xbfc2c0 });
  // The rotunda: the 102nd-floor glazing under a metal dome.
  plain.push({ geometry: spin([[0, esbY(1190)], [rf * 0.78, esbY(1190)], [rf * 0.78, esbY(1224)], [0, esbY(1224)]], { segments: 32 }), color: 0x2a3640 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    bar(plain, 0xd8dad8, [Math.sin(a) * rf * 0.78, esbY(1190), Math.cos(a) * rf * 0.78], [Math.sin(a) * rf * 0.78, esbY(1224), Math.cos(a) * rf * 0.78], 0.04, 0.04);
  }
  plain.push({
    geometry: spin([
      [0, esbY(1222)], [rf * 0.86, esbY(1222)], [rf * 0.86, esbY(1226)], [rf * 0.62, esbY(1234)], [rf * 0.36, esbY(1243)], [rf * 0.2, esbY(1250)], [0, esbY(1250)],
    ], { segments: 40 }),
    color: 0xc6c9c7,
  });
  // The antenna, which a true-scale radius would make invisible; these are drawn fatter than life.
  plain.push({
    geometry: spin([
      [0, esbY(1248)], [0.1, esbY(1248)], [0.1, esbY(1290)], [0.17, esbY(1292)], [0.17, esbY(1296)], [0.075, esbY(1298)],
      [0.07, esbY(1340)], [0.12, esbY(1342)], [0.12, esbY(1345)], [0.055, esbY(1347)], [0.045, esbY(1400)], [0.075, esbY(1402)], [0.075, esbY(1404)], [0.03, esbY(1406)], [0.016, esbY(1454)], [0, esbY(1454)],
    ], { segments: 12 }),
    color: 0xb4b6b4,
  });
  // --- the plaza ---------------------------------------------------------------------------------
  const plaza = new Soup();
  const uvFeet = (x, z) => [x / 2.2, z / 2.2];
  const slabBlock = (hw, hd, y0, y1, col) => {
    const out = esbOutline(hw, hd, []);
    capOf(plaza, out, y1, uvFeet, col);
    for (let i = 0; i < out.length; i++) {
      const a = out[i]; const b = out[(i + 1) % out.length];
      plaza.quad([a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], [b[0], y0, b[1]], [[0, 0], [0, 0.03], [0.1, 0.03], [0.1, 0]], col);
    }
  };
  slabBlock(4.9, 8.6, 0, 0.08, [0.05, 0.05, 0.055]); // the avenue and the cross streets
  slabBlock(3.72, 7.12, 0.08, ESB_PLINTH, [0.62, 0.6, 0.56]); // the sidewalk

  // Street furniture: lamps, trees in their pits, and a few taxis to judge the building by.
  const lamp = (x, z) => {
    rod(plain, 0x35392f, [x, ESB_PLINTH, z], [x, ESB_PLINTH + 0.5, z], 0.012, { sides: 6, r2: 0.008 });
    dot(plain, 0xf0e8cf, 0.03, [x, ESB_PLINTH + 0.52, z], { sides: 8 });
  };
  for (const s of [-1, 1]) for (const t of [-1, -0.5, 0, 0.5, 1]) lamp(s * 3.6, t * 6.95);
  const crown = (x, z, r, h) => {
    rod(plain, 0x4a3a28, [x, ESB_PLINTH, z], [x, ESB_PLINTH + h, z], 0.018, { sides: 6, r2: 0.012 });
    const g = new THREE.IcosahedronGeometry(r, 3);
    g.scale(1, 1.15, 1);
    plain.push({ geometry: g, color: 0x4f7a3a, position: [x, ESB_PLINTH + h + r * 0.7, z] });
  };
  for (const [x, z] of [[-3.2, 6.72], [3.2, 6.72], [-3.2, -6.72], [3.2, -6.72], [-3.2, 1.7], [3.2, 1.7], [-3.2, -1.7], [3.2, -1.7]]) crown(x, z, 0.26 + rng() * 0.07, 0.34);
  esbTaxi(plain, -2.05, 7.65, Math.PI / 2, 0xdba51c);
  esbTaxi(plain, 1.4, 8.1, -Math.PI / 2, 0xdba51c);
  esbTaxi(plain, 4.3, -3.2, 0, 0x28324a);
  esbTaxi(plain, -4.3, 2.4, Math.PI, 0xdba51c);

  // --- materials ---------------------------------------------------------------------------------
  const maps = esbFacadeMaps();
  const facadeMesh = meshFrom(facade.geometry(), {
    map: maps.map, bumpMap: maps.bumpMap, bumpScale: 0.3,
    emissive: 0xffffff, emissiveMap: maps.emissiveMap, emissiveIntensity: 0.85, roughness: 0.82, metalness: 0,
  });
  const baseMesh = meshFrom(basePart.geometry(), { map: esbBaseMap(), roughness: 0.84, metalness: 0 });
  const plainMesh = meshFrom(mergeParts(plain), { roughness: 0.55, metalness: 0.18 });
  const plazaMesh = meshFrom(plaza.geometry(), { map: esbPaverMap(), roughness: 0.95, metalness: 0 });
  return groupOf(facadeMesh, baseMesh, plainMesh, plazaMesh);
}


// ---------------------------------------------------------------------------
// The candlestick telephone, four times life
// ---------------------------------------------------------------------------

// A closed tube with UVs along its length, for a cord whose weave has to run with it.
function corded(points, radius, { sides = 8, steps = 60, pitch = 0.42 } = {}) {
  const g = tube(points, radius, { sides, steps, round: 2 });
  const P = g.attributes.position;
  const rows = Math.floor((P.count - 2) / sides);
  const uvs = new Float32Array(P.count * 2);
  let run = 0;
  let prev = null;
  for (let r = 0; r < rows; r++) {
    const c = new THREE.Vector3();
    for (let j = 0; j < sides; j++) c.add(new THREE.Vector3().fromBufferAttribute(P, r * sides + j));
    c.multiplyScalar(1 / sides);
    if (prev) run += c.distanceTo(prev);
    prev = c;
    for (let j = 0; j < sides; j++) {
      // Up one side and back down the other: no seam to wrap backward across.
      uvs[(r * sides + j) * 2] = 1 - Math.abs((j / sides) * 2 - 1);
      uvs[(r * sides + j) * 2 + 1] = run / pitch;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

function clothCordMaps() {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = '#d9d1c0';
  ctx.fillRect(0, 0, 128, 128);
  // A braid: short diagonal threads crossing in both directions, in the two yarns of a cloth cord.
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = i * 16; const y = j * 16;
      const flip = (i + j) % 2 === 0;
      ctx.fillStyle = flip ? '#f4eedf' : '#7d705c';
      ctx.fillRect(x + 1, y + 1, 14, 14);
      ctx.strokeStyle = flip ? '#b7ad98' : '#544a3b';
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        if (flip) { ctx.moveTo(x + 2 + k * 5, y + 2); ctx.lineTo(x + 2 + k * 5, y + 14); } else { ctx.moveTo(x + 2, y + 2 + k * 5); ctx.lineTo(x + 14, y + 2 + k * 5); }
        ctx.stroke();
      }
    }
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 0.6 };
}

// The numeral plate, painted once. A hole's digit is drawn where that hole really is, from the same
// angles the finger wheel is cut at, so what shows through each hole cannot disagree with the table.
const DIAL_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const DIAL_HOLE_R = 0.35;
const dialAngle = (i) => ((30 + i * 30) * Math.PI) / 180; // 1 at two o'clock, then anticlockwise to 0

function dialPlate(R) {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#f5efdf';
  ctx.fillRect(0, 0, S, S);
  const k = S / (2 * R);
  const c = S / 2;
  ctx.strokeStyle = '#2a2622';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(c, c, (R - 0.02) * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#16120e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 104px Georgia, "Times New Roman", serif';
  DIAL_DIGITS.forEach((d, i) => {
    const a = dialAngle(i);
    ctx.fillText(d, c + Math.cos(a) * DIAL_HOLE_R * k, c - Math.sin(a) * DIAL_HOLE_R * k + 4);
  });
  // The centre card, with ruled lines where a subscriber wrote their own number.
  ctx.fillStyle = '#fbf7ea';
  ctx.beginPath();
  ctx.arc(c, c, 0.17 * k, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,50,40,0.75)';
  ctx.lineWidth = 3;
  for (const dy of [-0.06, 0.06]) {
    ctx.beginPath();
    ctx.moveTo(c - 0.12 * k, c + dy * k);
    ctx.lineTo(c + 0.12 * k, c + dy * k);
    ctx.stroke();
  }
  return texOf(canvas, THREE.SRGBColorSpace, false);
}

function flatDisc(R, segments = 64) {
  const pos = [0, 0, 0]; const nor = [0, 0, 1]; const uv = [0.5, 0.5]; const idx = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * R; const y = Math.sin(a) * R;
    pos.push(x, y, 0); nor.push(0, 0, 1); uv.push(x / (2 * R) + 0.5, y / (2 * R) + 0.5);
    if (i < segments) idx.push(0, i + 1, i + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function candlestickTelephone() {
  const enamel = [];
  const metal = [];
  const cords = [];
  const BLACK = 0x0b0b0d;
  const BRASS = 0xcfa34a;
  const NICKEL = 0xc9ccc8;

  // --- the base ------------------------------------------------------------------------------
  enamel.push({
    geometry: spin([
      [0, 0.03], [0.99, 0.03], [1.0, 0.08, 'h'], [1.03, 0.11], [1.0, 0.17], [0.95, 0.23], [0.84, 0.31], [0.66, 0.42], [0.5, 0.53],
      [0.37, 0.65], [0.28, 0.78], [0.23, 0.92], [0.2, 1.0], [0, 1.0],
    ], { segments: 72 }),
    color: BLACK,
  });
  metal.push({ geometry: ringGeo(0.97, 0.04, { y: 0.04, segments: 72, sides: 8, flat: 1 }), color: BRASS });
  metal.push({ geometry: ringGeo(0.22, 0.04, { y: 0.98, segments: 36, sides: 8 }), color: BRASS });

  // --- the stem ------------------------------------------------------------------------------
  enamel.push({
    geometry: spin([
      [0, 0.96], [0.175, 0.96], [0.15, 1.2], [0.135, 1.8], [0.125, 2.6], [0.12, 3.3], [0.13, 3.55], [0.16, 3.7], [0.16, 3.78], [0, 3.78],
    ], { segments: 36 }),
    color: BLACK,
  });
  metal.push({ geometry: ringGeo(0.135, 0.03, { y: 3.12, segments: 32, sides: 8 }), color: NICKEL });
  metal.push({ geometry: ringGeo(0.162, 0.028, { y: 3.72, segments: 32, sides: 8 }), color: BRASS });

  // --- the switch hook, on the +X side -------------------------------------------------------
  const hookY = 3.3;
  const earX = 0.86;
  metal.push({ geometry: spin([[0, 3.18], [0.19, 3.18], [0.2, 3.22], [0.2, 3.32], [0.17, 3.38], [0, 3.38]], { segments: 32 }), color: NICKEL });
  pipe(metal, NICKEL, [[0.14, hookY, 0], [0.34, hookY + 0.02, 0], [0.52, hookY + 0.04, 0]], 0.05, { sides: 10 });
  pipe(metal, NICKEL, [[0.52, hookY + 0.04, -0.2], [0.52, hookY + 0.04, 0.2]], 0.042, { sides: 10, steps: 4 });
  for (const s of [-1, 1]) {
    pipe(metal, NICKEL, [
      [0.5, hookY + 0.04, s * 0.2], [0.8, hookY + 0.05, s * 0.2], [1.08, hookY + 0.05, s * 0.2], [1.24, hookY + 0.1, s * 0.2], [1.3, hookY + 0.22, s * 0.2],
    ], [0.04, 0.038, 0.036, 0.034, 0.03], { sides: 10, steps: 18 });
    dot(metal, NICKEL, 0.05, [1.3, hookY + 0.23, s * 0.2], { sides: 10 });
  }

  // --- the earpiece, hanging in the hook -----------------------------------------------------
  const ear = (points, color, part = enamel) => {
    part.push({ geometry: spin(points, { segments: 48 }), color, position: [earX, 0, 0] });
  };
  ear([
    [0, 1.74], [0.09, 1.74], [0.11, 1.84], [0.135, 1.96], [0.16, 2.3], [0.185, 2.7], [0.205, 3.05], [0.17, 3.2], [0.135, 3.28], [0.135, 3.42], [0, 3.42],
  ], BLACK);
  ear([[0, 3.385], [0.205, 3.385], [0.215, 3.41], [0.215, 3.45], [0.2, 3.475], [0, 3.475]], NICKEL, metal);
  ear([
    [0, 3.46], [0.2, 3.46], [0.235, 3.51], [0.29, 3.555], [0.36, 3.6], [0.415, 3.65], [0.45, 3.7], [0.46, 3.745], [0.452, 3.782], [0.425, 3.806], [0.385, 3.815],
    [0.33, 3.808], [0.26, 3.79], [0.18, 3.77], [0.09, 3.75], [0, 3.75],
  ], BLACK);
  metal.push({ geometry: ringGeo(0.205, 0.022, { y: 3.08, segments: 40, sides: 8 }), color: NICKEL, position: [earX, 0, 0] });
  // The sound holes in the middle of the cup, each a dark pit in a shallow boss.
  ear([[0, 3.745], [0.085, 3.745], [0.085, 3.76], [0, 3.76]], 0x020203);

  // --- the transmitter on its yoke, tipped up a little toward the speaker --------------------
  const tilt = (12 * Math.PI) / 180;
  const axis = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
  const T = new THREE.Vector3(0, 4.03, 0.24);
  const toT = new THREE.Matrix4().compose(T, new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis), new THREE.Vector3(1, 1, 1));
  const onT = (g) => g.applyMatrix4(toT);
  enamel.push({
    geometry: onT(spin([
      [0, -0.25], [0.12, -0.245], [0.22, -0.225], [0.3, -0.18], [0.355, -0.12], [0.385, -0.05], [0.392, 0.02], [0.38, 0.075], [0.33, 0.11],
      [0.25, 0.125], [0.19, 0.14], [0.163, 0.19], [0.165, 0.25], [0.18, 0.31], [0.225, 0.4], [0.28, 0.465], [0.34, 0.52], [0.39, 0.56], [0.415, 0.585], [0.418, 0.602], [0.4, 0.61],
      [0.37, 0.595], [0.31, 0.545], [0.24, 0.49], [0.18, 0.43], [0.135, 0.36], [0.105, 0.26], [0, 0.26],
    ], { segments: 56 })),
    color: BLACK,
  });
  metal.push({ geometry: onT(ringGeo(0.388, 0.024, { y: 0.005, segments: 56, sides: 8 })), color: BRASS });
  metal.push({ geometry: onT(ringGeo(0.178, 0.022, { y: 0.19, segments: 36, sides: 8 })), color: BRASS });
  // The perforated disc at the throat, a brass grid of holes a voice goes through.
  metal.push({ geometry: onT(spin([[0, 0.255], [0.105, 0.255], [0.105, 0.272], [0, 0.272]], { segments: 28 })), color: 0x9f8034 });
  for (let i = 0; i < 12; i++) {
    const ring = i < 4 ? 0.035 : 0.075;
    const a = (i < 4 ? i / 4 : (i - 4) / 8) * Math.PI * 2;
    const g = new THREE.SphereGeometry(0.012, 6, 3).translate(Math.cos(a) * ring, 0.272, Math.sin(a) * ring);
    enamel.push({ geometry: onT(g), color: 0x020203 });
  }
  // The knuckle the transmitter tips on, with its two cheeks.
  metal.push({ geometry: new THREE.CylinderGeometry(0.085, 0.085, 0.36, 18).rotateZ(Math.PI / 2), color: BRASS, position: [0, 3.86, 0] });
  for (const s of [-1, 1]) {
    bar(metal, BRASS, [s * 0.12, 3.82, -0.02], [s * 0.12, 4.0, 0.13], 0.05, 0.14);
    dot(metal, BRASS, 0.05, [s * 0.2, 3.86, 0], { sides: 10, flat: 0.8, up: [1, 0, 0] });
  }

  // --- the dial, on its own tilted pedestal at the front of the base -------------------------
  const lean = (55 * Math.PI) / 180;
  const n = new THREE.Vector3(0, Math.sin(lean), Math.cos(lean));
  const u = new THREE.Vector3(0, Math.cos(lean), -Math.sin(lean));
  const c = new THREE.Vector3(0, 0.6, 0.74);
  const toDial = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), u, n);
  toDial.setPosition(c);
  const onDial = (g) => g.applyMatrix4(toDial);
  const alongN = (g) => g.rotateX(Math.PI / 2); // a lathe's +Y becomes the dial's +Z
  enamel.push({
    geometry: onDial(alongN(spin([
      [0, -0.24], [0.56, -0.24], [0.63, -0.18], [0.64, -0.05], [0.62, -0.005], [0, -0.005],
    ], { segments: 72 }))),
    color: BLACK,
  });
  metal.push({ geometry: onDial(alongN(ringGeo(0.595, 0.03, { y: 0.0, segments: 72, sides: 8 }))), color: BRASS });

  const plateR = 0.58;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.51, 0, Math.PI * 2, false);
  DIAL_DIGITS.forEach((_, i) => {
    const a = dialAngle(i);
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * DIAL_HOLE_R, Math.sin(a) * DIAL_HOLE_R, 0.074, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  });
  const centre = new THREE.Path();
  centre.absarc(0, 0, 0.17, 0, Math.PI * 2, true);
  shape.holes.push(centre);
  let wheel = new THREE.ExtrudeGeometry(shape, {
    depth: 0.05, curveSegments: 18, steps: 1, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelOffset: -0.012, bevelSegments: 1,
  });
  wheel.translate(0, 0, 0.012);
  // Low, so the flat face keeps its own normal. Welding it to the bevel fans the shading into a starburst.
  wheel = toCreasedNormals(wheel, (22 * Math.PI) / 180);
  metal.push({ geometry: onDial(wheel), color: BRASS });
  // The hub ring and centre screw over the card.
  metal.push({ geometry: onDial(alongN(ringGeo(0.17, 0.018, { y: 0.05, segments: 40, sides: 8 }))), color: 0xe0bb62 });
  metal.push({ geometry: onDial(alongN(spin([[0, 0.012], [0.035, 0.012], [0.035, 0.03], [0.02, 0.04], [0, 0.04]], { segments: 16 }))), color: 0xe0bb62 });
  // The finger stop, sprung from the rim at about four o'clock and reaching in over the wheel.
  {
    const a = (330 * Math.PI) / 180;
    const R = (r, z) => [Math.cos(a) * r, Math.sin(a) * r, z];
    const g = tube([R(0.585, 0.0), R(0.575, 0.075), R(0.52, 0.112), R(0.4, 0.118)], [0.032, 0.03, 0.026, 0.024], { sides: 10, steps: 14, round: 2 });
    metal.push({ geometry: onDial(g), color: NICKEL });
  }

  // --- the cords, both real curves that come out of something and go into something ----------
  const cordLine = (points, r = 0.042) => cords.push({ geometry: corded(points, r, { sides: 8, steps: points.length * 12 }), color: 0x6a4e34 });
  cordLine([
    [earX, 1.78, 0], [earX + 0.03, 1.5, 0.02], [earX + 0.16, 1.1, 0.1], [earX + 0.34, 0.66, 0.12], [earX + 0.5, 0.28, -0.02],
    [earX + 0.52, 0.07, -0.34], [earX + 0.24, 0.055, -0.72], [earX - 0.26, 0.09, -0.86], [earX - 0.44, 0.27, -0.66], [0.38, 0.4, -0.56],
  ]);
  metal.push({ geometry: spin([[0, -0.05], [0.07, -0.05], [0.075, 0.03], [0.06, 0.05], [0, 0.05]], { segments: 16 }), color: BRASS, position: [earX, 1.72, 0] });
  // A rubber grommet where each cord goes into the base.
  const grommet = (p, nrm) => {
    const g = new THREE.CylinderGeometry(0.06, 0.08, 0.1, 14);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, vec(nrm).normalize()));
    enamel.push({ geometry: g, color: 0x1a1a1c, position: p });
  };
  grommet([0.4, 0.41, -0.6], [0.5, 0.45, -0.7]);
  cordLine([
    [-0.26, 0.2, -0.9], [-0.34, 0.1, -1.12], [-0.7, 0.05, -1.34], [-1.16, 0.05, -1.14], [-1.44, 0.05, -1.34], [-1.4, 0.05, -1.72], [-1.3, 0.07, -1.88],
  ]);
  grommet([-0.25, 0.2, -0.89], [-0.2, 0.25, -0.9]);
  // The wall block the line cord ends in: walnut, with two brass screws.
  block(enamel, 0x3e2412, 0.5, 0.17, 0.36, [-1.24, 0.085, -2.02]);
  block(enamel, 0x2c180b, 0.42, 0.03, 0.28, [-1.24, 0.175, -2.02]);
  for (const s of [-1, 1]) dot(metal, BRASS, 0.04, [-1.24 + s * 0.13, 0.19, -2.02], { sides: 10, flat: 0.6 });

  // --- materials -----------------------------------------------------------------------------
  const enamelGeo = mergeParts(enamel);
  // Polish faked in the vertex colours: the sky in every upward face, and a long pale reflection down
  // the stem, since an enamel with no environment to mirror otherwise reads as flat black paint.
  sheen(enamelGeo, { add: 0.075, tint: [0.84, 0.9, 1], band: 0.018, bandY: 2.4, bandW: 1.3 });
  const metalGeo = mergeParts(metal);
  sheen(metalGeo, { gain: 0.42, add: 0.05, tint: [1, 0.94, 0.8] });
  const plate = dialPlate(plateR);
  const cloth = clothCordMaps();
  const card = meshFrom(flatDisc(plateR).applyMatrix4(toDial).translate(n.x * 0.002, n.y * 0.002, n.z * 0.002), { vertexColors: false, map: plate, roughness: 0.55, metalness: 0 }, { shadow: false });
  return groupOf(
    meshFrom(enamelGeo, { roughness: 0.3, metalness: 0 }),
    meshFrom(metalGeo, { roughness: 0.36, metalness: 0.45 }),
    meshFrom(mergeParts(cords), { ...cloth, roughness: 0.95, metalness: 0 }),
    card,
  );
}


// ---------------------------------------------------------------------------
// The sod house
// ---------------------------------------------------------------------------

// Folded blades of grass, gathered into one double-sided mesh. Their normals lean upward whatever way
// they face: a blade is lit by the sky through it, and truthful normals would stripe a clump black.
class Blades {
  constructor() { this.p = []; this.n = []; this.c = []; this.count = 0; }

  add(x, y, z, h, w, bendX, bendZ, c0, c1, rows = 2) {
    this.count += 1;
    const bl = Math.hypot(bendX, bendZ) || 1;
    const sx = -bendZ / bl; const sz = bendX / bl;
    const fold = 0.35 * w;
    const pt = (t, side) => {
      const f = t * t;
      const hw = w * 0.5 * (1 - t) ** 0.8;
      const rise = h * (t - 0.18 * f * Math.min(1, bl / h));
      const cx = x + bendX * f; const cz = z + bendZ * f;
      return [cx + sx * hw * side, y + rise + (side === 0 ? -fold * (1 - t) * 0.6 : 0), cz + sz * hw * side];
    };
    const col = (t) => [mix(c0[0], c1[0], t), mix(c0[1], c1[1], t), mix(c0[2], c1[2], t)];
    const nor = [bendX * 0.12 / (bl || 1), 0.95, bendZ * 0.12 / (bl || 1)];
    const tri = (a, b, cc, ca, cb, ccc) => {
      this.p.push(...a, ...b, ...cc);
      for (let i = 0; i < 3; i++) this.n.push(nor[0], nor[1], nor[2]);
      this.c.push(...ca, ...cb, ...ccc);
    };
    for (let r = 0; r < rows; r++) {
      const t0 = r / rows; const t1 = (r + 1) / rows;
      const c0a = col(t0); const c1a = col(t1);
      for (const side of [-1, 1]) {
        const a = pt(t0, side); const b = pt(t0, 0); const d = pt(t1, side); const e = pt(t1, 0);
        tri(a, b, e, c0a, c0a, c1a);
        if (r < rows - 1) tri(a, e, d, c0a, c1a, c1a);
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

const SOD = {
  halfW: 8, halfD: 6, wall: 1.8, course: 0.48, courses: 15,
  ridge: 8.1, slope: 1.1 / 7, roofHalfThick: 0.18,
  door: { x0: -2.9, x1: 0.1, top: 13 },
  window: { x0: 3.0, x1: 5.6, sill: 7, top: 12 },
};
const sodRoofMid = (z) => SOD.ridge - SOD.slope * Math.sqrt(z * z + 0.16);

function sodGroundY(x, z) {
  const r = Math.hypot(x, z);
  const lump = (smoothNoise3(x * 0.18 + 3, 0.5, z * 0.18) - 0.5) * 0.09 + (smoothNoise3(x * 0.7, 2.5, z * 0.7) - 0.5) * 0.03;
  return (0.09 + lump) * (1 - sstep(r, 16.5, 19.5));
}

// A sod's cut face, in near-white: a mat of pale roots along the top, dark loam with clods below. One
// tile tall per block, so every sod has its mat at the top of its own face.
function sodMaps() {
  const W = 1024; const H = 256;
  const { canvas, ctx } = makeCanvas(W, H);
  const rng = seededRandom(1862);
  ctx.fillStyle = '#6a6358';
  ctx.fillRect(0, 0, W, H);
  const wrapX = (draw) => { for (const dx of [-W, 0, W]) draw(dx); };
  // Crumbling loam: a great many small irregular clods, dark and pale, and no direction to any of it.
  // Anything with a direction reads as grain, and grain reads as a log.
  for (let i = 0; i < 4200; i++) {
    const x = rng() * W; const y = rng() * H; const r = 1 + rng() ** 2.2 * 11;
    const pale = rng() < 0.32;
    const v = pale ? 118 + rng() * 44 : 30 + rng() * 52;
    ctx.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},${0.45 + rng() * 0.45})`;
    const rot = rng() * 3; const sq = 0.55 + rng() * 0.6;
    wrapX((dx) => { ctx.beginPath(); ctx.ellipse(x + dx, y, r, r * sq, rot, 0, Math.PI * 2); ctx.fill(); });
  }
  for (let i = 0; i < 500; i++) {
    const v = 180 + rng() * 60;
    ctx.fillStyle = `rgba(${v},${v * 0.97},${v * 0.86},0.8)`;
    ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
  }
  // The dark seam under each sod.
  const seam = ctx.createLinearGradient(0, H * 0.8, 0, H);
  seam.addColorStop(0, 'rgba(18,14,10,0)');
  seam.addColorStop(1, 'rgba(18,14,10,0.92)');
  ctx.fillStyle = seam;
  ctx.fillRect(0, H * 0.8, W, H * 0.2);
  // The grass mat at the top: a tangle of dead stems going every way, thinning out downward.
  for (let i = 0; i < 3400; i++) {
    const x = rng() * W;
    const y = rng() ** 1.5 * H * 0.3;
    const len = 6 + rng() * 22;
    const a = rng() * Math.PI * 2;
    const bow = (rng() - 0.5) * 12;
    const v = 186 + rng() * 66;
    ctx.strokeStyle = `rgba(${v},${v * 0.92},${v * 0.68},${0.35 + rng() * 0.55})`;
    ctx.lineWidth = 0.7 + rng() * 1.1;
    wrapX((dx) => {
      ctx.beginPath();
      ctx.moveTo(x + dx, y);
      ctx.quadraticCurveTo(x + dx + Math.cos(a) * len * 0.5 + bow, y + Math.sin(a) * len * 0.5, x + dx + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    });
  }
  // A few fine roots wandering down from the mat through the soil.
  for (let i = 0; i < 170; i++) {
    const x = rng() * W;
    let px = x; let py = H * 0.14 + rng() * H * 0.1;
    const v = 170 + rng() * 60;
    ctx.strokeStyle = `rgba(${v},${v * 0.9},${v * 0.7},${0.25 + rng() * 0.4})`;
    ctx.lineWidth = 0.6 + rng() * 0.6;
    ctx.beginPath();
    ctx.moveTo(px, py);
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      px += (rng() - 0.5) * 34;
      py += 8 + rng() * 22;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 1.6 };
}

function grassTile() {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rng = seededRandom(71);
  ctx.fillStyle = '#c7c4b6';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5200; i++) {
    const x = rng() * 512; const y = rng() * 512;
    const v = 110 + rng() * 145;
    ctx.strokeStyle = `rgba(${v},${v},${v * 0.86},0.65)`;
    ctx.lineWidth = 0.7 + rng() * 1.2;
    const a = rng() * Math.PI * 2; const l = 4 + rng() * 11;
    for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
      if (x + dx < -20 || x + dx > 532 || y + dy < -20 || y + dy > 532) continue;
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 0.7 };
}

function woodTile(seed = 9) {
  const { canvas, ctx } = makeCanvas(256, 512);
  const rng = seededRandom(seed);
  ctx.fillStyle = '#efe9dd';
  ctx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 160; i++) {
    const x = rng() * 256; const amp = 1 + rng() * 5; const cyc = 1 + Math.floor(rng() * 3); const ph = rng() * 6.28;
    const d = 118 + rng() * 96;
    ctx.strokeStyle = `rgba(${d},${d - 14},${d - 30},${0.25 + rng() * 0.5})`;
    ctx.lineWidth = 0.6 + rng() * 1.6;
    for (const dx of [-256, 0, 256]) {
      ctx.beginPath();
      for (let y = 0; y <= 512; y += 16) {
        const px = x + dx + Math.sin((y / 512) * 6.283 * cyc + ph) * amp;
        if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 0.45 };
}

function sodHouse() {
  const rng = seededRandom(1862);
  const { halfW: HW, halfD: HD, wall: T, course: CH, courses: N } = SOD;
  const sods = [];
  const earth = [];
  const wood = [];
  const metal = [];
  const blades = new Blades();

  // --- sods: real blocks in running bond, every third course laid crosswise to bind the wall --------
  const STR_C = [[0.34, 0.25, 0.17], [0.29, 0.22, 0.155], [0.38, 0.28, 0.185], [0.26, 0.2, 0.15], [0.36, 0.25, 0.16]];
  const addSod = (axis, side, a0, a1, c, cross) => {
    const L = a1 - a0;
    const h = CH * (0.94 + rng() * 0.09);
    const d = (cross ? T : T * 0.56) * (0.95 + rng() * 0.05);
    const segL = L > 1.25 ? 3 : 1;
    const box = new THREE.BoxGeometry(L - 0.05, h, d, segL, 2, 1); // a real joint between one sod and the next
    const P = box.attributes.position;
    const UV = box.attributes.uv;
    const u0 = rng();
    const tone = STR_C[Math.floor(rng() * STR_C.length)];
    const k = 0.85 + rng() * 0.32;
    const lean = (rng() - 0.5) * 0.09;
    const dy = (rng() - 0.5) * 0.05;
    const pushOut = 0.01 + rng() * 0.13;
    const centreA = (a0 + a1) / 2;
    const yc = (c + 0.5) * CH + dy;
    const colors = new Float32Array(P.count * 3);
    const offset = rng() * 100;
    for (let i = 0; i < P.count; i++) {
      let la = P.getX(i); let ly = P.getY(i); let lo = P.getZ(i);
      const fa = la / ((L - 0.05) / 2); const fy = ly / (h / 2);
      // The corners crumble back and each block's edges wander. Nothing here is a clean rectangle.
      const corner = Math.abs(fa) > 0.95 && Math.abs(fy) > 0.95 ? 1 : 0;
      if (lo > 0) lo -= corner * (0.05 + rng() * 0.09);
      la += (smoothNoise3(offset + fy * 2.2, c * 0.7, fa) - 0.5) * 0.2 * Math.abs(fa);
      ly += (smoothNoise3(offset + fa * 3.1, c * 0.3 + 4, fy) - 0.5) * 0.15 * Math.abs(fy);
      ly += lean * la;
      const world = axis === 'x'
        ? [centreA + la, yc + ly, side * (HD - d / 2 + lo)]
        : [side * (HW - d / 2 + lo), yc + ly, centreA + la];
      const nA = smoothNoise3(world[0] * 1.9, world[1] * 2.6, world[2] * 1.9) - 0.5;
      const nB = smoothNoise3(world[0] * 5.1 + 5, world[1] * 6.3, world[2] * 5.1) - 0.5;
      const rough = nA * 0.2 + nB * 0.1 + pushOut;
      if (lo > 0) {
        if (axis === 'x') world[2] += side * rough; else world[0] += side * rough;
      }
      P.setXYZ(i, world[0], world[1], world[2]);
      // Every block carries its mat at the top of its own face; the tile is about 2.4ft wide.
      UV.setXY(i, u0 + UV.getX(i) * (L / 2.4), UV.getY(i));
      const face = fy > 0.98 ? 1.3 : 1;
      colors[i * 3] = tone[0] * k * face * (1 + nA * 0.5);
      colors[i * 3 + 1] = tone[1] * k * face * (1 + nA * 0.5);
      colors[i * 3 + 2] = tone[2] * k * face * (1 + nA * 0.4);
    }
    // Faces hidden against the core or the course below are left out: 40% of the wall's triangles.
    const idx = [];
    const reversed = (axis === 'z') !== (side < 0);
    for (const group of box.groups) {
      if (group.materialIndex === 3 || group.materialIndex === 5) continue;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const a = box.index.getX(i); const b = box.index.getX(i + 1); const cc = box.index.getX(i + 2);
        if (reversed) idx.push(a, cc, b); else idx.push(a, b, cc);
      }
    }
    box.clearGroups();
    box.setIndex(idx);
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    sods.push({ geometry: box, keepColor: true });
  };

  // Cut one run of a course into blocks, working round any openings.
  const runCourse = (axis, side, start, end, c, holes = []) => {
    const cross = c % 3 === 2;
    const spans = [];
    let from = start;
    for (const [h0, h1] of holes) {
      if (h1 <= start || h0 >= end) continue;
      if (h0 > from) spans.push([from, h0]);
      from = Math.max(from, h1);
    }
    if (from < end) spans.push([from, end]);
    for (const [s0, s1] of spans) {
      let a = s0;
      let first = true;
      while (a < s1 - 1e-3) {
        const nominal = cross ? 0.96 + rng() * 0.24 : 1.5 + rng() * 0.8;
        let len = first && !cross ? nominal * (c % 2 ? 0.55 : 1) : nominal;
        first = false;
        let b = Math.min(s1, a + len);
        if (s1 - b < (cross ? 0.5 : 0.9)) b = s1;
        addSod(axis, side, a, b, c, cross);
        a = b;
      }
    }
  };
  const doorHole = (c) => (c < SOD.door.top ? [[SOD.door.x0, SOD.door.x1]] : []);
  const windowHole = (c) => (c >= SOD.window.sill && c < SOD.window.top ? [[SOD.window.x0, SOD.window.x1]] : []);
  for (let c = 0; c < N; c++) {
    // Corners lap: on even courses the long walls run through, on odd courses the end walls do.
    const longFull = c % 2 === 0;
    const lap = c % 3 === 2 ? T : T * 0.56;
    const xs = longFull ? [-HW, HW] : [-HW + lap, HW - lap];
    const zs = longFull ? [-HD + lap, HD - lap] : [-HD, HD];
    runCourse('x', 1, xs[0], xs[1], c, [...doorHole(c), ...windowHole(c)].sort((a, b) => a[0] - b[0]));
    runCourse('x', -1, xs[0], xs[1], c);
    runCourse('z', 1, zs[0], zs[1], c);
    runCourse('z', -1, zs[0], zs[1], c);
  }
  // The gable ends climb in courses to the ridge; the roof's overhang hides their stepped edge.
  for (let c = N; c < N + 4; c++) {
    const y = (c + 1) * CH;
    const reach = (SOD.ridge - SOD.roofHalfThick + 0.05 - y) / SOD.slope;
    if (reach < 0.6) break;
    for (const side of [-1, 1]) runCourse('z', side, -Math.min(reach, HD), Math.min(reach, HD), c);
  }

  // --- the earth core the blocks are bedded on, with a real door and window void left through it ----
  const CORE = 0.42;
  const coreH = N * CH + 0.05;
  const coreC = 0x241a11;
  const core = (x0, x1, y0, y1, z0, z1) => block(earth, coreC, x1 - x0, y1 - y0, z1 - z0, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
  const fz1 = HD - CORE; const fz0 = HD - T;
  const doorTopY = SOD.door.top * CH; const sillY = SOD.window.sill * CH; const headY = SOD.window.top * CH;
  core(-HW + CORE, SOD.door.x0, 0, coreH, fz0, fz1);
  core(SOD.door.x1, SOD.window.x0, 0, coreH, fz0, fz1);
  core(SOD.window.x1, HW - CORE, 0, coreH, fz0, fz1);
  core(SOD.door.x0, SOD.door.x1, doorTopY, coreH, fz0, fz1);
  core(SOD.window.x0, SOD.window.x1, 0, sillY, fz0, fz1);
  core(SOD.window.x0, SOD.window.x1, headY, coreH, fz0, fz1);
  core(-HW + CORE, HW - CORE, 0, coreH, -HD + CORE, -HD + T);
  core(-HW + CORE, -HW + T, 0, coreH, -HD + T, HD - T);
  core(HW - T, HW - CORE, 0, coreH, -HD + T, HD - T);

  // --- the roof: sod over brush on poles, low-pitched and thick, growing --------------------------
  const roofHalfX = HW + 0.95; const roofHalfZ = HD + 1.0;
  const roofTop = (x, z) => sodRoofMid(z)
    + (smoothNoise3(x * 0.42, 1.5, z * 0.42) - 0.5) * 0.26
    + (smoothNoise3(x * 1.6, 3.5, z * 1.6) - 0.5) * 0.09;
  const roofGeo = solidSurface({
    nu: 40, nv: 26, axis: [0, 1, 0],
    point: (u, v) => {
      // The eave is torn, not sawn: the sods have slumped at their own different lengths.
      const a = (u - 0.5) * 2; const b = (v - 0.5) * 2;
      const edgeZ = 1 + (smoothNoise3(a * 7, 1, Math.sign(b) * 3) - 0.5) * 0.09;
      const edgeX = 1 + (smoothNoise3(1, b * 7, Math.sign(a) * 3) - 0.5) * 0.08;
      const x = a * roofHalfX * mix(1, edgeX, a * a);
      const z = b * roofHalfZ * mix(1, edgeZ, b * b);
      return [x, roofTop(x, z), z];
    },
    thick: (u, v) => {
      const a = Math.abs((u - 0.5) * 2); const b = Math.abs((v - 0.5) * 2);
      return SOD.roofHalfThick * (1 - 0.65 * sstep(Math.max(a, b), 0.86, 1)) + 0.03;
    },
  });
  {
    const P = roofGeo.attributes.position;
    const UV = roofGeo.attributes.uv;
    const cols = new Float32Array(P.count * 3);
    const green = lin(0x4d6a2b); const tawny = lin(0x75703d); const dirt = lin(0x33271b);
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      UV.setXY(i, x / 3.2, z / 3.2);
      const n = smoothNoise3(x * 0.34, 7, z * 0.34);
      const m = smoothNoise3(x * 1.1, 9, z * 1.1);
      const c = [...green];
      const t = sstep(n, 0.42, 0.62);
      c[0] = mix(c[0], tawny[0], t); c[1] = mix(c[1], tawny[1], t); c[2] = mix(c[2], tawny[2], t);
      // Bare where the rain runs off the eave and where it has been patched.
      const bare = Math.max(sstep(Math.abs(z), HD + 0.1, HD + 0.95), sstep(m, 0.68, 0.8));
      c[0] = mix(c[0], dirt[0], bare); c[1] = mix(c[1], dirt[1], bare); c[2] = mix(c[2], dirt[2], bare);
      const under = y < sodRoofMid(z) - 0.02 ? 0.45 : 1;
      cols[i * 3] = c[0] * under; cols[i * 3 + 1] = c[1] * under; cols[i * 3 + 2] = c[2] * under;
    }
    roofGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    earth.push({ geometry: roofGeo, keepColor: true });
  }
  // The ridgepole and rafters, peeled cottonwood poles poking out under the eave and the gable.
  const POLE = 0x8d6d48;
  pipe(wood, POLE, [[-HW - 1.35, SOD.ridge - 0.33, 0], [0, SOD.ridge - 0.3, 0], [HW + 1.35, SOD.ridge - 0.34, 0]], 0.2, { sides: 10, steps: 24 });
  for (let i = 0; i < 11; i++) {
    const x = -HW + 0.8 + i * ((2 * HW - 1.6) / 10) + (rng() - 0.5) * 0.25;
    for (const s of [-1, 1]) {
      const y0 = sodRoofMid(0) - 0.2;
      const yEnd = sodRoofMid(HD + 0.75) - SOD.roofHalfThick - 0.03;
      pipe(wood, POLE, [[x, y0, 0], [x + (rng() - 0.5) * 0.08, mix(y0, yEnd, 0.5), s * (HD + 0.75) * 0.5], [x + (rng() - 0.5) * 0.08, yEnd, s * (HD + 0.75)]], [0.085, 0.075, 0.07], { sides: 7, steps: 6 });
    }
  }

  // --- the door, in a real opening ------------------------------------------------------------------
  const dx0 = SOD.door.x0; const dx1 = SOD.door.x1;
  const jamb = 0x7e5f3e;
  const lining = (w, h, d, pos) => block(wood, jamb, w, h, d, pos);
  const doorFrontZ = HD - 0.95; // the door hangs well back in the thickness of the wall
  for (const x of [dx0 + 0.09, dx1 - 0.09]) lining(0.18, doorTopY, T - 0.08, [x, doorTopY / 2, HD - T / 2 - 0.02]);
  lining(dx1 - dx0 + 0.5, 0.3, T + 0.14, [(dx0 + dx1) / 2, doorTopY + 0.08, HD - T / 2 + 0.05]); // the lintel, a heavy squared timber
  lining(dx1 - dx0, 0.1, T - 0.06, [(dx0 + dx1) / 2, 0.14, HD - T / 2 - 0.01]);
  const doorW = dx1 - dx0 - 0.36;
  const doorH = doorTopY - 0.2 - 0.02;
  const boards = 5;
  for (let i = 0; i < boards; i++) {
    const bw = doorW / boards;
    block(wood, [0x8a6b45, 0x7b5d3a, 0x93734c, 0x74563a, 0x866a42][i], bw - 0.018, doorH, 0.09, [dx0 + 0.18 + bw * (i + 0.5), 0.2 + doorH / 2, doorFrontZ]);
  }
  // Behind the gaps between the boards, the dark room.
  block(earth, 0x0c0906, dx1 - dx0, doorTopY, 0.05, [(dx0 + dx1) / 2, doorTopY / 2, doorFrontZ - 0.09]);
  const bl = dx0 + 0.3; const br = dx1 - 0.3;
  for (const y of [0.9, 3.15, 5.4]) block(wood, 0x6d5233, br - bl + 0.12, 0.3, 0.07, [(bl + br) / 2, y, doorFrontZ + 0.07]);
  bar(wood, 0x6d5233, [bl, 1.03, doorFrontZ + 0.07], [br, 3.02, doorFrontZ + 0.07], 0.26, 0.07, { up: [0, 0, 1] });
  bar(wood, 0x6d5233, [bl, 3.28, doorFrontZ + 0.07], [br, 5.27, doorFrontZ + 0.07], 0.26, 0.07, { up: [0, 0, 1] });
  // Leather strap hinges and a wooden latch with a string to lift it from outside.
  for (const y of [0.9, 5.4]) {
    block(wood, 0x2e1c10, 0.95, 0.2, 0.03, [br - 0.36 + 0.42, y, doorFrontZ + 0.115]);
    for (const k of [0, 1, 2]) dot(metal, 0x4a4a48, 0.028, [br - 0.05 + k * 0.28 - 0.25, y, doorFrontZ + 0.13], { sides: 6, flat: 0.6, up: [0, 0, 1] });
  }
  block(wood, 0xa5875c, 0.85, 0.15, 0.07, [bl + 0.48, 3.5, doorFrontZ + 0.09]);
  block(wood, 0x5b4228, 0.17, 0.3, 0.12, [bl + 0.18, 3.5, doorFrontZ + 0.1]);
  pipe(wood, 0xc2ae84, [[bl + 0.7, 3.5, doorFrontZ + 0.13], [bl + 0.74, 3.32, doorFrontZ + 0.15], [bl + 0.72, 3.06, doorFrontZ + 0.14]], 0.012, { sides: 5, steps: 6 });

  // --- the window, framed and set deep ----------------------------------------------------------------
  const wx0 = SOD.window.x0; const wx1 = SOD.window.x1;
  const liningC = 0x8e7048;
  const splay = T - 0.06;
  block(wood, liningC, 0.14, headY - sillY, splay, [wx0 + 0.07, (sillY + headY) / 2, HD - T / 2 - 0.02]);
  block(wood, liningC, 0.14, headY - sillY, splay, [wx1 - 0.07, (sillY + headY) / 2, HD - T / 2 - 0.02]);
  block(wood, jamb, wx1 - wx0 + 0.4, 0.26, T + 0.08, [(wx0 + wx1) / 2, headY + 0.07, HD - T / 2 + 0.03]);
  block(wood, 0x957751, wx1 - wx0 + 0.2, 0.13, T + 0.14, [(wx0 + wx1) / 2, sillY + 0.02, HD - T / 2 + 0.05]); // a deep sill to set things on
  const frameZ = HD - 0.82;
  const fx0 = wx0 + 0.14; const fx1 = wx1 - 0.14;
  const fy0 = sillY + 0.08; const fy1 = headY - 0.07;
  const FRAME = 0xd8ccaf; // whitewashed: the only pale thing on the wall, and that is why it reads
  block(wood, FRAME, fx1 - fx0, 0.14, 0.2, [(fx0 + fx1) / 2, fy0 + 0.07, frameZ]);
  block(wood, FRAME, fx1 - fx0, 0.14, 0.2, [(fx0 + fx1) / 2, fy1 - 0.07, frameZ]);
  block(wood, FRAME, 0.14, fy1 - fy0, 0.2, [fx0 + 0.07, (fy0 + fy1) / 2, frameZ]);
  block(wood, FRAME, 0.14, fy1 - fy0, 0.2, [fx1 - 0.07, (fy0 + fy1) / 2, frameZ]);
  block(wood, FRAME, 0.075, fy1 - fy0 - 0.2, 0.12, [(fx0 + fx1) / 2, (fy0 + fy1) / 2, frameZ + 0.015]);
  for (const f of [1 / 3, 2 / 3]) block(wood, FRAME, fx1 - fx0 - 0.2, 0.075, 0.12, [(fx0 + fx1) / 2, mix(fy0, fy1, f), frameZ + 0.015]);
  // Six lights of old glass. Each pane is tinted by where the sky would catch it, top lighter than foot.
  const glassCols = 2; const glassRows = 3;
  for (let i = 0; i < glassCols; i++) {
    for (let j = 0; j < glassRows; j++) {
      const gx0 = fx0 + 0.14 + i * ((fx1 - fx0 - 0.28) / glassCols);
      const gx1 = gx0 + (fx1 - fx0 - 0.28) / glassCols;
      const gy0 = fy0 + 0.14 + j * ((fy1 - fy0 - 0.28) / glassRows);
      const gy1 = gy0 + (fy1 - fy0 - 0.28) / glassRows;
      const g = new THREE.BoxGeometry(gx1 - gx0, gy1 - gy0, 0.02);
      const tone0 = lin(0x2d3c44); const tone1 = lin(0x7e98a3);
      tintVertices(g, (x, y, z, out) => {
        const t = clamp01((y + (gy1 - gy0) / 2) / (gy1 - gy0)) * (0.55 + j * 0.2) + (i === 0 ? 0.12 : -0.05);
        out[0] = mix(tone0[0], tone1[0], t); out[1] = mix(tone0[1], tone1[1], t); out[2] = mix(tone0[2], tone1[2], t);
      });
      metal.push({ geometry: g, keepColor: true, position: [(gx0 + gx1) / 2, (gy0 + gy1) / 2, frameZ - 0.02] });
    }
  }
  block(earth, 0x0a0806, wx1 - wx0, headY - sillY, 0.05, [(wx0 + wx1) / 2, (sillY + headY) / 2, frameZ - 0.14]);

  // --- the stovepipe, tin, through a flashing, with its china hat ------------------------------------
  const px = -4.2; const pz = -1.7;
  const py = roofTop(px, pz) + SOD.roofHalfThick;
  metal.push({ geometry: spin([[0, py - 0.3], [0.62, py - 0.3], [0.62, py - 0.08], [0.3, py + 0.22], [0.26, py + 0.3], [0, py + 0.3]], { segments: 28 }), color: 0x5f6463, position: [px, 0, pz] });
  {
    const g = spin([
      [0, py - 0.2], [0.24, py - 0.2], [0.24, py + 0.48], [0.26, py + 0.5], [0.26, py + 0.54], [0.235, py + 0.56], [0.23, py + 1.05], [0.25, py + 1.07], [0.25, py + 1.11], [0.225, py + 1.13],
      [0.22, py + 1.42], [0, py + 1.42],
    ], { segments: 28 });
    tintVertices(g, (x, y, z, out) => {
      // Rust running down the seam side, and soot toward the top.
      const k = 1 - 0.34 * sstep(y, py + 0.6, py + 1.4);
      const r = sstep(Math.sin(Math.atan2(x, z) * 3 + y * 0.8), 0.3, 0.9) * 0.4;
      out[0] = mix(0.21, 0.28, r) * k; out[1] = mix(0.22, 0.13, r) * k; out[2] = mix(0.225, 0.07, r) * k;
    });
    metal.push({ geometry: g, keepColor: true, position: [px, 0, pz] });
  }
  metal.push({ geometry: spin([[0, py + 1.62], [0.44, py + 1.66], [0.46, py + 1.69], [0.12, py + 1.94], [0, py + 1.96]], { segments: 28 }), color: 0x6c7172, position: [px, 0, pz] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    rod(metal, 0x4f5454, [px + Math.cos(a) * 0.2, py + 1.38, pz + Math.sin(a) * 0.2], [px + Math.cos(a) * 0.34, py + 1.68, pz + Math.sin(a) * 0.34], 0.017, { sides: 5 });
  }

  // --- the water barrel, beside the door -------------------------------------------------------------
  const bX = 1.08; const bZ = HD + 1.05; const bY = sodGroundY(bX, bZ) - 0.03;
  {
    const prof = [[0, 0], [0.86, 0], [0.92, 0.02], [0.98, 0.5], [1.03, 1.05], [1.05, 1.4], [1.03, 1.85], [0.97, 2.35], [0.91, 2.74], [0.85, 2.76], [0.8, 2.72], [0.86, 2.3], [0, 2.3]];
    const g = spin(prof, { segments: 64 });
    const staves = 18;
    tintVertices(g, (x, y, z, out) => {
      const a = (Math.atan2(z, x) / (Math.PI * 2) + 1) * staves;
      const seam = Math.abs(a - Math.round(a));
      const n = Math.floor(a) % 4;
      const base = [[0.17, 0.095, 0.05], [0.2, 0.115, 0.06], [0.145, 0.085, 0.045], [0.185, 0.105, 0.055]][n];
      const dark = sstep(seam, 0, 0.08);
      const wet = sstep(y, 0.7, 0.05);
      const k = (0.45 + 0.55 * dark) * mix(1, 0.62, wet);
      out[0] = base[0] * k; out[1] = base[1] * k; out[2] = base[2] * k;
    });
    wood.push({ geometry: g, keepColor: true, position: [bX, bY, bZ] });
    for (const y of [0.32, 0.86, 1.94, 2.46]) {
      const r = y < 1.4 ? mix(0.96, 1.05, y / 1.4) : mix(1.05, 0.9, (y - 1.4) / 1.4);
      metal.push({ geometry: ringGeo(r + 0.012, 0.03, { y, segments: 52, sides: 7, flat: 1.4 }), color: 0x2f2d2a, position: [bX, bY, bZ] });
    }
    metal.push({ geometry: spin([[0, 2.4], [0.86, 2.4], [0.86, 2.42], [0, 2.42]], { segments: 36 }), color: 0x18333a, position: [bX, bY, bZ] });
    // A dipper hanging over the rim.
    pipe(wood, 0x8c7350, [[bX + 0.3, bY + 2.85, bZ + 0.6], [bX + 0.5, bY + 2.82, bZ + 0.74], [bX + 0.98, bY + 2.62, bZ + 0.34]], 0.024, { sides: 6, steps: 6 });
    metal.push({ geometry: spin([[0, -0.1], [0.14, -0.08], [0.17, 0.04], [0.15, 0.06], [0.11, -0.04], [0, -0.06]], { segments: 18 }), color: 0x7e7b75, position: [bX + 0.26, bY + 2.76, bZ + 0.54] });
  }

  // --- the walking plough, leaned against the wall --------------------------------------------------
  {
    const pl = [];
    const ply = [];
    // The mouldboard: a real curved plate that lifts and turns, swept from the share's point.
    const mb = solidSurface({
      nu: 16, nv: 10,
      point: (u, v) => {
        const z = mix(1.5, -0.25, u);
        const lift = v * mix(0.3, 0.85, u);
        const twist = u * u * 0.9 + v * 0.26 * u;
        return [0.06 + twist * (0.35 + v * 0.55), lift, z - v * u * 0.35];
      },
      thick: () => 0.022,
    });
    pl.push({ geometry: mb, color: 0x6b6d6c });
    // The share and its landside, the part that cuts.
    bar(pl, 0x5a5c5c, [0.04, 0.05, 1.5], [0.04, 0.05, -0.55], 0.09, 0.1);
    bar(pl, 0x77797a, [0.03, 0.03, 1.72], [0.55, 0.03, 0.42], 0.06, 0.06);
    pipe(pl, 0x77797a, [[0.04, 0.05, 1.5], [0.08, 0.03, 1.66], [0.09, 0.02, 1.78]], [0.06, 0.04, 0.012], { sides: 7, steps: 6, round: 0 });
    // The beam, the standard between it and the frog, the clevis at the nose.
    bar(ply, 0x8d6f4a, [0.02, 0.85, 0.1], [0.02, 1.42, 2.6], 0.16, 0.2);
    bar(pl, 0x4e5050, [0.02, 0.05, 0.5], [0.02, 0.98, 0.65], 0.09, 0.2);
    pl.push({ geometry: new THREE.TorusGeometry(0.1, 0.022, 7, 14).rotateY(Math.PI / 2), color: 0x3a3b3b, position: [0.02, 1.42, 2.72] });
    for (const s of [-1, 1]) {
      pipe(ply, 0x8d6f4a, [
        [s * 0.14, 0.18, -0.35], [s * 0.26, 0.9, -1.25], [s * 0.42, 1.65, -2.15], [s * 0.46, 1.86, -2.6],
      ], [0.09, 0.08, 0.07, 0.065], { sides: 8, steps: 14 });
      dot(ply, 0x6c5235, 0.08, [s * 0.46, 1.88, -2.66], { sides: 8 });
    }
    bar(ply, 0x7e6240, [-0.32, 1.25, -1.72], [0.32, 1.25, -1.72], 0.06, 0.06);
    bar(pl, 0x4e5050, [-0.22, 0.65, -1.0], [0.22, 0.65, -1.0], 0.04, 0.04);
    const phi = (46 * Math.PI) / 180;
    const yaw = -0.5;
    const R = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(phi));
    const place = (p) => { const g = p.geometry.clone(); if (p.position) g.translate(p.position[0], p.position[1], p.position[2]); return g.applyMatrix4(R); };
    const allParts = [...pl, ...ply].map(place);
    const box = new THREE.Box3();
    for (const g of allParts) { g.computeBoundingBox(); box.union(g.boundingBox); }
    const pX = -5.5; const pY = sodGroundY(-5.5, HD + 1) + 0.04 - box.min.y;
    const pZ = HD + 0.1 - box.min.z;
    const T1 = new THREE.Matrix4().makeTranslation(pX, pY, pZ);
    pl.forEach((p, i) => metal.push({ geometry: allParts[i].applyMatrix4(T1), color: p.color }));
    ply.forEach((p, i) => wood.push({ geometry: allParts[i + pl.length].applyMatrix4(T1), color: p.color }));
  }

  // --- the vegetable patch and its stick fence ------------------------------------------------------
  const gx0 = 9.2; const gx1 = 15; const gz0 = 0.8; const gz1 = 11;
  const soilC = 0x2e2214;
  for (let i = 0; i < 4; i++) {
    const x = mix(gx0 + 0.75, gx1 - 0.75, i / 3);
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const z = mix(gz0 + 0.4, gz1 - 0.4, k / 8);
      pts.push([x + Math.sin(k * 1.7 + i) * 0.06, sodGroundY(x, z) + 0.02, z]);
    }
    earth.push({ geometry: tube(pts, 0.3, { sides: 8, steps: 16, section: () => [1.25, 0.6] }), color: soilC });
  }
  // Corn on the two rows nearest the house, cabbages and squash on the other two.
  const leaf = lin(0x4d8a30); const leafTip = lin(0x7aa83c); const stalkC = 0x597f2c;
  for (let i = 0; i < 2; i++) {
    const x = mix(gx0 + 0.75, gx1 - 0.75, i / 3);
    for (let k = 0; k < 8; k++) {
      const z = mix(gz0 + 0.8, gz1 - 0.8, k / 7) + (rng() - 0.5) * 0.25;
      const y = sodGroundY(x, z);
      const h = 3.4 + rng() * 1.4;
      pipe(earth, stalkC, [[x, y, z], [x + (rng() - 0.5) * 0.1, y + h * 0.5, z], [x + (rng() - 0.5) * 0.2, y + h, z + (rng() - 0.5) * 0.2]], [0.055, 0.045, 0.022], { sides: 6, steps: 5, round: 1 });
      for (let l = 0; l < 7; l++) {
        const a = l * 2.4 + rng();
        const ly = y + 0.5 + (l / 7) * (h - 0.7);
        const reach = 1 + rng() * 0.8;
        blades.add(x, ly, z, reach * 0.8, 0.2, Math.cos(a) * reach, Math.sin(a) * reach, leaf, leafTip);
      }
      for (let t = 0; t < 4; t++) {
        const a = rng() * 6.28;
        blades.add(x, y + h - 0.05, z, 0.5, 0.05, Math.cos(a) * 0.2, Math.sin(a) * 0.2, lin(0xb8a955), lin(0xd6c378));
      }
    }
  }
  for (let i = 2; i < 4; i++) {
    const x = mix(gx0 + 0.75, gx1 - 0.75, i / 3);
    for (let k = 0; k < 7; k++) {
      const z = mix(gz0 + 0.9, gz1 - 0.9, k / 6) + (rng() - 0.5) * 0.2;
      const y = sodGroundY(x, z) + 0.12;
      const r = 0.34 + rng() * 0.12;
      const cab = new THREE.SphereGeometry(r, 10, 7);
      cab.scale(1, 0.84, 1);
      const seed = rng() * 40;
      const P = cab.attributes.position;
      for (let v = 0; v < P.count; v++) {
        const d = 1 + (smoothNoise3(P.getX(v) * 5 + seed, P.getY(v) * 5, P.getZ(v) * 5) - 0.5) * 0.22;
        P.setXYZ(v, P.getX(v) * d, P.getY(v) * d, P.getZ(v) * d);
      }
      cab.computeVertexNormals();
      const cabTone = i === 2 ? 0x74a646 : 0x608f3c;
      earth.push({ geometry: cab, color: cabTone, position: [x, y + r * 0.6, z] });
      for (let l = 0; l < 6; l++) {
        const a = l * 1.05 + rng();
        const reach = 0.5 + rng() * 0.3;
        blades.add(x + Math.cos(a) * r * 0.3, y + 0.04, z + Math.sin(a) * r * 0.3, 0.3, 0.42, Math.cos(a) * reach, Math.sin(a) * reach, lin(0x497d2e), lin(0x6c9f41));
      }
    }
  }
  // Rough poles, not sawn pickets: a homesteader's fence is whatever could be hauled in.
  const FENCE = 0x7f6a4c;
  const fenceRun = (ax, az, bx, bz, posts) => {
    const pts = [];
    for (let i = 0; i <= posts; i++) {
      const t = i / posts;
      const x = mix(ax, bx, t) + (rng() - 0.5) * 0.12; const z = mix(az, bz, t) + (rng() - 0.5) * 0.12;
      const y = sodGroundY(x, z);
      const top = y + 3.2 + rng() * 0.4;
      rod(wood, FENCE, [x, y - 0.04, z], [x + (rng() - 0.5) * 0.08, top, z + (rng() - 0.5) * 0.08], 0.075, { sides: 7, r2: 0.058 });
      pts.push([x, y, z, top]);
    }
    for (const railH of [1.1, 2.15, 3.0]) {
      pipe(wood, FENCE, pts.map(([x, y, z]) => [x, y + railH + (rng() - 0.5) * 0.08, z]), 0.042, { sides: 6, steps: posts * 3, round: 1 });
    }
  };
  fenceRun(gx0, gz1, gx1, gz1, 4);
  fenceRun(gx1, gz1, gx1, gz0, 7);
  fenceRun(gx1, gz0, gx0, gz0, 4);
  fenceRun(gx0, gz0, gx0, gz1 - 3, 5);

  // --- the patch of prairie -----------------------------------------------------------------------
  const onPath = (x, z) => {
    if (z < HD) return false;
    const c = -1.4 + (z - HD) * 0.1 + Math.sin(z * 0.5) * 0.5;
    return Math.abs(x - c) < 1.2 + (z - HD) * 0.04;
  };
  const blocked = (x, z) => {
    if (Math.abs(x) < HW + 0.9 && Math.abs(z) < HD + 1.2) return true;
    if (x > gx0 - 0.6 && x < gx1 + 0.6 && z > gz0 - 0.6 && z < gz1 + 0.6) return true;
    if (onPath(x, z)) return true;
    if (Math.hypot(x - bX, z - bZ) < 1.6) return true;
    if (x > -8 && x < -3 && z > HD && z < HD + 3.4) return true;
    return false;
  };
  {
    const rows = 24; const cols = 72;
    const pos = []; const idx = []; const col = []; const uvs = [];
    const green = lin(0x53642c); const straw = lin(0x6c6a3a); const dirt = lin(0x3a2e21); const trod = lin(0x5f4e38);
    const R0 = (a) => 18.4 + Math.sin(a * 3 + 1) * 0.9 + Math.sin(a * 7) * 0.45;
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        const a = (j / cols) * Math.PI * 2;
        const r = (i / rows) * R0(a);
        const x = Math.cos(a) * r; const z = Math.sin(a) * r;
        pos.push(x, sodGroundY(x, z), z);
        uvs.push(x / 3.4, z / 3.4);
        const c = [...green];
        const t = sstep(smoothNoise3(x * 0.3, 2, z * 0.3), 0.36, 0.62);
        mixC(c, straw, t);
        // Bare earth where the walls were dug from and where feet go.
        const nearHouse = 1 - sstep(Math.max(Math.abs(x) - HW, Math.abs(z) - HD), 0.2, 2.1);
        mixC(c, dirt, nearHouse * 0.9);
        if (onPath(x, z)) mixC(c, trod, 0.9);
        col.push(c[0], c[1], c[2]);
      }
    }
    const stride = cols + 1;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * stride + j; const b = a + 1; const c = a + stride; const d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    earth.push({ geometry: g, keepColor: true });
  }

  // Tall bluestem, in clumps, thick and tall at the edge of the patch and low near the door.
  const greenB = lin(0x3e5522); const tawnyB = lin(0xb0a25e); const rustB = lin(0x8f6d3e);
  let placed = 0;
  for (let tries = 0; tries < 1600 && placed < 132; tries++) {
    const a = rng() * Math.PI * 2;
    const r = 7.5 + Math.sqrt(rng()) * 10.8;
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    placed += 1;
    const y = sodGroundY(x, z);
    const tall = mix(1.6, 4.3, sstep(r, 9, 16)) * (0.8 + rng() * 0.4);
    const n = 8;
    const tone = rng();
    for (let k = 0; k < n; k++) {
      const ox = (rng() - 0.5) * 0.85; const oz = (rng() - 0.5) * 0.85;
      const b = rng() * 6.28; const lean = tall * (0.1 + rng() * 0.42);
      const top = tone > 0.72 ? rustB : tawnyB;
      blades.add(x + ox, y - 0.03, z + oz, tall * (0.55 + rng() * 0.55), 0.09 + rng() * 0.06, Math.cos(b) * lean, Math.sin(b) * lean, greenB, top, 3);
    }
  }
  // Short grass filling in between, right up to the path.
  placed = 0;
  for (let tries = 0; tries < 1000 && placed < 160; tries++) {
    const a = rng() * Math.PI * 2;
    const r = 3 + Math.sqrt(rng()) * 14;
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    if (blocked(x, z)) continue;
    placed += 1;
    const y = sodGroundY(x, z);
    for (let k = 0; k < 3; k++) {
      const b = rng() * 6.28; const h = 0.5 + rng() * 0.6;
      blades.add(x + (rng() - 0.5) * 0.4, y - 0.02, z + (rng() - 0.5) * 0.4, h, 0.14, Math.cos(b) * h * 0.4, Math.sin(b) * h * 0.4, greenB, rng() > 0.5 ? tawnyB : leafTip);
    }
  }
  // Grass and weeds growing out of the roof.
  const rGreen = lin(0x597a2d); const rTip = lin(0x8ea549); const rStraw = lin(0xb29a54);
  for (let c = 0; c < 100; c++) {
    const x = (rng() * 2 - 1) * (roofHalfX - 0.5); const z = (rng() * 2 - 1) * (roofHalfZ - 0.5);
    if (Math.hypot(x - px, z - pz) < 0.75) continue;
    const y = roofTop(x, z) + SOD.roofHalfThick - 0.03;
    const n = 4 + Math.floor(rng() * 4);
    const h0 = 0.45 + rng() * 0.75;
    for (let k = 0; k < n; k++) {
      const b = rng() * 6.28; const h = h0 * (0.75 + rng() * 0.5);
      blades.add(x + (rng() - 0.5) * 0.45, y, z + (rng() - 0.5) * 0.45, h, 0.15, Math.cos(b) * h * 0.4, Math.sin(b) * h * 0.4, rGreen, rng() > 0.6 ? rStraw : rTip);
    }
  }
  // Roots and small weeds in the courses, which a stone wall would never have.
  for (let c = 0; c < 110; c++) {
    const wallPick = rng();
    const course = 1 + Math.floor(rng() * (N - 1));
    const yJ = course * CH;
    let x; let z; let ox; let oz;
    if (wallPick < 0.55) {
      x = (rng() * 2 - 1) * (HW - 0.3); z = HD + 0.1; ox = 0; oz = 1;
      if (x > SOD.door.x0 - 0.1 && x < SOD.door.x1 + 0.1 && course <= SOD.door.top) continue;
      if (x > wx0 - 0.1 && x < wx1 + 0.1 && course >= SOD.window.sill && course <= SOD.window.top) continue;
    } else if (wallPick < 0.8) {
      x = -HW - 0.1; z = (rng() * 2 - 1) * (HD - 0.3); ox = -1; oz = 0;
    } else if (wallPick < 0.92) {
      x = HW + 0.1; z = (rng() * 2 - 1) * (HD - 0.3); ox = 1; oz = 0;
    } else {
      x = (rng() * 2 - 1) * (HW - 0.3); z = -HD - 0.1; ox = 0; oz = -1;
    }
    const weed = rng() > 0.62;
    const n = weed ? 4 : 3 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const h = weed ? 0.3 + rng() * 0.28 : 0.14 + rng() * 0.2;
      const side = (rng() - 0.5) * (weed ? 0.5 : 0.35);
      const c0 = weed ? lin(0x4e7429) : lin(0x96794a);
      const c1 = weed ? lin(0x86a53f) : lin(0xc9b078);
      const droop = weed ? h * 0.65 : h * 1.1;
      blades.add(x + (oz ? (rng() - 0.5) * 0.3 : 0), yJ - 0.04, z + (ox ? (rng() - 0.5) * 0.3 : 0), h * (weed ? 1 : 0.5), weed ? 0.07 : 0.03, ox * droop + oz * side, oz * droop + ox * side, c0, c1);
    }
  }

  // --- materials -----------------------------------------------------------------------------------
  const sodGeo = toCreasedNormals(mergeParts(sods), (58 * Math.PI) / 180);
  const sodM = sodMaps();
  const earthM = grassTile();
  const woodM = woodTile(1862);
  return groupOf(
    meshFrom(sodGeo, { ...sodM, roughness: 1, metalness: 0 }),
    meshFrom(mergeParts(earth), { ...earthM, roughness: 1, metalness: 0 }),
    meshFrom(mergeParts(wood), { ...woodM, roughness: 0.86, metalness: 0 }),
    meshFrom(mergeParts(metal), { roughness: 0.48, metalness: 0.35 }),
    meshFrom(blades.geometry(), { roughness: 0.95, metalness: 0, side: THREE.DoubleSide }, { shadow: true }),
  );
}

function mixC(c, target, t) {
  c[0] += (target[0] - c[0]) * t; c[1] += (target[1] - c[1]) * t; c[2] += (target[2] - c[2]) * t;
}


// ---------------------------------------------------------------------------
// The Turtle
// ---------------------------------------------------------------------------

// The two shells, as one function of bearing and height. Everything on the hull asks this where it is.
// Bearing 0 is +Z and pi/2 is +X, so the seam between the two shells lies in the plane z = 0.
const TU = {
  Y0: 0.42, Y1: 6.0, R: 1.95, kx: 0.92, kz: 1.06, wall: 0.2,
  cutA0: -0.05, cutA1: 1.36, cutY0: 1.02, cutY1: 5.0,
};
const tuR = (y) => {
  const t = clamp01((y - TU.Y0) / (TU.Y1 - TU.Y0));
  return TU.R * Math.sin(Math.PI * t ** 0.85) ** 0.62;
};
const tuPoint = (a, y, off = 0) => {
  const r = tuR(y);
  const n = tuNormal(a, y);
  return [r * TU.kx * Math.sin(a) + n[0] * off, y + n[1] * off, r * TU.kz * Math.cos(a) + n[2] * off];
};
function tuNormal(a, y) {
  const h = 0.012;
  const r0 = tuR(y - h); const r1 = tuR(y + h);
  const dr = (r1 - r0) / (2 * h);
  const r = tuR(y);
  // Outward: the cross of d/da and d/dy, which at bearing 0 points along +Z.
  const da = [r * TU.kx * Math.cos(a), 0, -r * TU.kz * Math.sin(a)];
  const dy = [dr * TU.kx * Math.sin(a), 1, dr * TU.kz * Math.cos(a)];
  const nx = da[1] * dy[2] - da[2] * dy[1];
  const ny = da[2] * dy[0] - da[0] * dy[2];
  const nz = da[0] * dy[1] - da[1] * dy[0];
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-5) return [0, y < 3 ? -1 : 1, 0];
  return [nx / l, ny / l, nz / l];
}
// The height of the hull's lower surface over a plan point, for a cradle cut to fit.
function tuLowerY(x, z) {
  const want = Math.hypot(x / TU.kx, z / TU.kz);
  let lo = TU.Y0; let hi = 2.9;
  if (tuR(hi) < want) return null;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (tuR(m) < want) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
function tuUpperY(x, z) {
  const want = Math.hypot(x / TU.kx, z / TU.kz);
  let lo = 2.9; let hi = TU.Y1;
  if (tuR(lo) < want) return null;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (tuR(m) > want) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

function tuStaveMaps() {
  const S = 1024;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(1775);
  ctx.fillStyle = '#d9d4c8';
  ctx.fillRect(0, 0, S, S);
  const staves = 14;
  const sw = S / staves;
  for (let i = 0; i < staves; i++) {
    const v = 200 + rng() * 50;
    ctx.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
    ctx.fillRect(i * sw, 0, sw, S);
    for (let g = 0; g < 26; g++) {
      const x = i * sw + rng() * sw;
      const d = 110 + rng() * 80;
      ctx.strokeStyle = `rgba(${d},${d - 8},${d - 22},${0.2 + rng() * 0.45})`;
      ctx.lineWidth = 0.6 + rng() * 1.4;
      const amp = 1 + rng() * 3; const ph = rng() * 6.28; const f = 1 + rng() * 2;
      ctx.beginPath();
      for (let y = 0; y <= S; y += 24) {
        const px = x + Math.sin((y / S) * 6.28 * f + ph) * amp;
        if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    // A butt joint in some staves, since no oak tree is seven feet of clear plank.
    if (rng() > 0.45) {
      ctx.fillStyle = 'rgba(30,24,18,0.75)';
      ctx.fillRect(i * sw, rng() * S, sw, 3);
    }
  }
  // Caulked seams: a pitch line with a paler rope of oakum pressed in beside it.
  for (let i = 0; i <= staves; i++) {
    const x = i * sw;
    ctx.fillStyle = 'rgba(14,11,8,0.92)';
    ctx.fillRect(x - 3, 0, 6, S);
    ctx.fillStyle = 'rgba(180,160,120,0.35)';
    ctx.fillRect(x - 1, 0, 1.6, S);
  }
  return { map: texOf(canvas, THREE.SRGBColorSpace), bumpMap: texOf(canvas, THREE.NoColorSpace), bumpScale: 0.9 };
}

// The grid of the hull with the window left out of it. Its row and column lists contain the cut's
// edges exactly, so the opening's boundary runs straight along grid lines and the rim can close it.
function tuGrid() {
  const cols = [];
  const NC = 72;
  for (let i = 0; i <= NC; i++) cols.push(-Math.PI + (i / NC) * 2 * Math.PI);
  for (const a of [TU.cutA0, TU.cutA1]) {
    let best = 0;
    for (let i = 1; i < NC; i++) if (Math.abs(cols[i] - a) < Math.abs(cols[best] - a)) best = i;
    cols[best] = a;
  }
  const rows = [];
  const NR = 54;
  for (let i = 0; i <= NR; i++) rows.push(TU.Y0 + (TU.Y1 - TU.Y0) * (0.5 - 0.5 * Math.cos((i / NR) * Math.PI)));
  for (const y of [TU.cutY0, TU.cutY1]) {
    let best = 1;
    for (let i = 1; i < NR; i++) if (Math.abs(rows[i] - y) < Math.abs(rows[best] - y)) best = i;
    rows[best] = y;
  }
  return { cols, rows };
}

function tuShell({ cols, rows }, off, inward, paint) {
  const pos = []; const nor = []; const uv = []; const col = []; const idx = [];
  const nc = cols.length; const nr = rows.length;
  const out = [1, 1, 1];
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const a = cols[i]; const y = rows[j];
      const p = tuPoint(a, y, off);
      const n = tuNormal(a, y);
      pos.push(p[0], p[1], p[2]);
      if (inward) nor.push(-n[0], -n[1], -n[2]); else nor.push(n[0], n[1], n[2]);
      uv.push(((a + Math.PI) / (2 * Math.PI)) * 2, (y - TU.Y0) / (TU.Y1 - TU.Y0));
      paint(a, y, p, out);
      col.push(out[0], out[1], out[2]);
    }
  }
  const inCut = (i, j) => cols[i] >= TU.cutA0 - 1e-6 && cols[i + 1] <= TU.cutA1 + 1e-6 && rows[j] >= TU.cutY0 - 1e-6 && rows[j + 1] <= TU.cutY1 + 1e-6;
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      if (inCut(i, j)) continue;
      const a = j * nc + i; const b = a + 1; const c = a + nc + 1; const d = a + nc;
      if (inward) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// A strap lying on the hull, a real closed strip with its underside sunk in the oak.
function tuStrap(list, color, a0, a1, y0, y1, width, { lift = 0.018, half = 0.024, nu = 24, nv = 2 } = {}) {
  const alongA = Math.abs(a1 - a0) > 1e-3;
  list.push({
    geometry: solidSurface({
      nu, nv, closedU: false,
      point: (u, v) => {
        if (alongA) {
          const a = mix(a0, a1, u);
          return tuPoint(a, y0 + (v - 0.5) * width, lift);
        }
        const y = mix(y0, y1, u);
        const r = Math.max(tuR(y), 0.35);
        return tuPoint(a0 + ((v - 0.5) * width) / r, y, lift);
      },
      thick: () => half,
    }),
    color,
  });
}

// A two-bladed screw, a true helicoid: the "oar formed upon the principle of a screw".
function tuScrew(list, color, origin, axis, len, R, { turns = 0.9, hub = 0.075 } = {}) {
  const A = vec(axis).normalize();
  const E1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(E1.dot(A)) > 0.9) E1.set(0, 1, 0);
  E1.addScaledVector(A, -E1.dot(A)).normalize();
  const E2 = new THREE.Vector3().crossVectors(A, E1).normalize();
  const O = vec(origin);
  for (const start of [0, Math.PI]) {
    list.push({
      geometry: solidSurface({
        nu: 22, nv: 4,
        point: (u, v) => {
          const a = start + u * turns * 2 * Math.PI;
          const rr = hub * 0.6 + v * (R * Math.sin(Math.PI * (0.06 + u * 0.88)) ** 0.5 - hub * 0.6);
          const p = O.clone().addScaledVector(A, u * len).addScaledVector(E1, Math.cos(a) * rr).addScaledVector(E2, Math.sin(a) * rr);
          return [p.x, p.y, p.z];
        },
        thick: () => 0.016,
      }),
      color,
    });
  }
  const a = O.clone().addScaledVector(A, -0.05);
  const b = O.clone().addScaledVector(A, len + 0.06);
  list.push({ geometry: tube([[a.x, a.y, a.z], [b.x, b.y, b.z]], hub, { sides: 12, steps: 2, round: 3 }), color });
}

function turtleSubmarine() {
  const grid = tuGrid();
  const shell = [];
  const inside = [];
  const ironOut = [];
  const ironIn = [];
  const IRON = 0x423c34; const RUST = 0x5a3c26; const BRASS = 0xc59b45; const GLASS = 0x1d2a30;
  const OAKFRESH = 0xb28a55; const OAKDARK = 0x8e6a40;

  // --- the two shells, tarred outside and bare oak inside ----------------------------------------
  const tar = lin(0x4a3522);
  const wet = lin(0x2b2219);
  shell.push({
    keepColor: true,
    geometry: tuShell(grid, 0, false, (a, y, p, out) => {
      const n = smoothNoise3(p[0] * 0.9, p[1] * 1.6, p[2] * 0.9);
      const s = smoothNoise3(p[0] * 3.2, p[1] * 0.5, p[2] * 3.2);
      const low = 1 - sstep(y, 0.8, 2.6);
      const k = 0.72 + n * 0.62;
      const t = sstep(s, 0.42, 0.66) * 0.75 + low * 0.5;
      out[0] = mix(tar[0], wet[0], t) * k; out[1] = mix(tar[1], wet[1], t) * k; out[2] = mix(tar[2], wet[2], t) * k;
    }),
  });
  const bare = lin(0xa98a5e);
  inside.push({
    keepColor: true,
    geometry: tuShell(grid, -TU.wall, true, (a, y, p, out) => {
      const k = 0.78 + smoothNoise3(p[0] * 1.2, p[1] * 1.2, p[2] * 1.2) * 0.4;
      const ceiling = sstep(y, 4.4, 5.6) * 0.3;
      out[0] = bare[0] * k * (1 - ceiling); out[1] = bare[1] * k * (1 - ceiling); out[2] = bare[2] * k * (1 - ceiling);
    }),
  });

  // The cut face: fresh pale oak, its tarred skin a dark line at the outer edge. The rim is what shows
  // how thick the shells are, so it must not be the colour of either surface.
  const rim = new Soup();
  const rimOak = lin(0xc6a36e); const rimTar = lin(0x241a10);
  const rimStrip = (A0, Y0, A1, Y1) => {
    const n = 14;
    const skin = 0.03;
    for (let i = 0; i < n; i++) {
      const a0 = mix(A0, A1, i / n); const y0 = mix(Y0, Y1, i / n);
      const a1 = mix(A0, A1, (i + 1) / n); const y1 = mix(Y0, Y1, (i + 1) / n);
      const o0 = tuPoint(a0, y0, 0); const o1 = tuPoint(a1, y1, 0);
      const m0 = tuPoint(a0, y0, -skin); const m1 = tuPoint(a1, y1, -skin);
      const i0 = tuPoint(a0, y0, -TU.wall); const i1 = tuPoint(a1, y1, -TU.wall);
      // Inside one stave of the tile, with the grain running along the cut.
      const uv = [[0.03, i * 0.02], [0.05, i * 0.02], [0.05, (i + 1) * 0.02], [0.03, (i + 1) * 0.02]];
      rim.quad(o0, m0, m1, o1, uv, rimTar);
      rim.quad(m0, i0, i1, m1, uv, rimOak);
    }
  };
  // Walked so each strip's outward face looks into the opening.
  rimStrip(TU.cutA1, TU.cutY0, TU.cutA0, TU.cutY0);
  rimStrip(TU.cutA0, TU.cutY1, TU.cutA1, TU.cutY1);
  rimStrip(TU.cutA0, TU.cutY0, TU.cutA0, TU.cutY1);
  rimStrip(TU.cutA1, TU.cutY1, TU.cutA1, TU.cutY0);
  inside.push({ geometry: rim.geometry(), keepColor: true });

  // --- iron: hoops round both shells, the flange where they meet, and their rivets ----------------
  const bands = [1.5, 2.55, 3.65, 4.6];
  for (const y of bands) {
    const inside_ = y > TU.cutY0 && y < TU.cutY1;
    const a0 = inside_ ? TU.cutA1 + 0.015 : -Math.PI;
    const a1 = inside_ ? TU.cutA0 + 2 * Math.PI - 0.015 : Math.PI;
    tuStrap(ironOut, IRON, a0, a1, y, y, 0.17, { nu: 64 });
    const count = 22;
    for (let i = 0; i <= count; i++) {
      const a = mix(a0, a1, i / count);
      const p = tuPoint(a, y, 0.05);
      const n = tuNormal(a, y);
      dot(ironOut, 0x2c2822, 0.028, p, { sides: 6, flat: 0.5, up: n });
    }
  }
  // The flange down each side: the two shells bolted edge to edge, and it is what makes them two.
  for (const a of [Math.PI / 2, -Math.PI / 2]) {
    tuStrap(ironOut, 0x37312a, a, a, 0.78, 5.5, 0.17, { nu: 34, nv: 2, lift: 0.03, half: 0.034 });
    for (let i = 0; i <= 13; i++) {
      const y = mix(0.92, 5.36, i / 13);
      const r = tuR(y);
      for (const off of [-1, 1]) {
        const a2 = a + (off * 0.05) / r;
        dot(ironOut, 0x241f19, 0.026, tuPoint(a2, y, 0.066), { sides: 6, flat: 0.55, up: tuNormal(a2, y) });
      }
    }
  }
  // Frames inside, timber ribs the shell is built on.
  for (const y of [1.9, 3.1, 4.3]) {
    inside.push({
      geometry: solidSurface({
        nu: 44, nv: 2,
        point: (u, v) => {
          const a = mix(TU.cutA1 + 0.01, TU.cutA0 + 2 * Math.PI - 0.01, u);
          return tuPoint(a, y + (v - 0.5) * 0.22, -TU.wall - 0.03);
        },
        thick: () => 0.05,
      }),
      color: OAKDARK,
    });
  }

  // --- the conning tower: a brass hatch with small glass windows ----------------------------------
  const hatch = (points, color, part = ironOut) => part.push({ geometry: spin(points, { segments: 52 }), color });
  hatch([
    [0, 5.3], [0.74, 5.3], [0.74, 5.66], [0.7, 5.69], [0.68, 5.72], [0.68, 5.92], [0.72, 5.95], [0.73, 6.0], [0.7, 6.03], [0, 6.03],
  ], BRASS);
  hatch([
    [0, 6.0], [0.67, 6.02], [0.67, 6.07], [0.6, 6.12], [0.42, 6.22], [0.14, 6.28], [0.12, 6.32], [0.16, 6.35], [0.15, 6.4], [0, 6.42],
  ], 0xb68c3a);
  // Eight deadlights round the collar: a frame, a domed pane sunk into it.
  const LIGHTS = 6;
  for (let i = 0; i < LIGHTS; i++) {
    const a = (i / LIGHTS) * Math.PI * 2 + Math.PI / LIGHTS;
    const nrm = [Math.sin(a), 0, Math.cos(a)];
    const c = [nrm[0] * 0.68, 5.82, nrm[2] * 0.68];
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(nrm));
    const ringG = new THREE.TorusGeometry(0.075, 0.016, 7, 18).applyQuaternion(q);
    ironOut.push({ geometry: ringG, color: 0xdcb35a, position: c });
    const pane = new THREE.SphereGeometry(0.068, 12, 8);
    pane.scale(1, 1, 0.1);
    pane.applyQuaternion(q);
    ironOut.push({ geometry: pane, color: GLASS, position: c });
  }
  // The lid's hinge, at the back, and a turn-handle on the crown.
  bar(ironOut, 0x9b7a33, [-0.2, 6.02, -0.76], [0.2, 6.02, -0.76], 0.1, 0.1);
  bar(ironOut, 0xc59b45, [-0.1, 6.03, -0.72], [-0.1, 6.1, -0.45], 0.08, 0.03);
  bar(ironOut, 0xc59b45, [0.1, 6.03, -0.72], [0.1, 6.1, -0.45], 0.08, 0.03);
  rod(ironOut, 0xdcb35a, [-0.17, 6.45, 0], [0.17, 6.45, 0], 0.024, { sides: 8 });
  // The two air pipes, each with a valve meant to close as the water reached it.
  for (const s of [-1, 1]) {
    const x = s * 0.5; const z = -0.34;
    const y0 = 5.6;
    pipe(ironOut, BRASS, [[x, y0, z], [x + s * 0.03, 6.2, z], [x + s * 0.03, 6.62, z]], 0.038, { sides: 10, steps: 8 });
    ironOut.push({ geometry: spin([[0, -0.05], [0.07, -0.04], [0.075, 0.03], [0.05, 0.06], [0, 0.07]], { segments: 14 }), color: 0xdcb35a, position: [x + s * 0.03, 6.66, z] });
  }

  // --- the vertical screw and its crank --------------------------------------------------------------
  const vX = 0.28; const vZ = 0.92;
  const vExit = tuUpperY(vX, vZ);
  rod(ironOut, IRON, [vX, vExit - 0.1, vZ], [vX, 6.4, vZ], 0.045, { sides: 10 });
  ironOut.push({ geometry: spin([[0, vExit - 0.1], [0.15, vExit - 0.1], [0.15, vExit + 0.04], [0.09, vExit + 0.1], [0, vExit + 0.1]], { segments: 18 }), color: 0x2d2822, position: [vX, 0, vZ] });
  tuScrew(ironOut, 0x7b7265, [vX, 6.32, vZ], [0, 1, 0], 0.68, 0.46);
  rod(ironIn, 0x37322b, [vX, 4.2, vZ], [vX, vExit, vZ], 0.05, { sides: 10 });
  bar(ironIn, 0x37322b, [vX, 4.38, vZ], [vX + 0.44, 4.38, vZ - 0.08], 0.05, 0.07);
  dot(ironIn, 0x37322b, 0.07, [vX, 4.38, vZ], { sides: 10 });
  pipe(inside, OAKFRESH, [[vX + 0.44, 4.34, vZ - 0.08], [vX + 0.44, 4.0, vZ - 0.08]], 0.05, { sides: 9, steps: 2 });

  // --- the forward screw and its crank, the shaft through the bow ------------------------------------
  const fX = -0.36; const fY = 3.5;
  const fA = Math.asin(fX / (tuR(fY) * TU.kx));
  const fZ = tuR(fY) * TU.kz * Math.cos(fA);
  rod(ironOut, IRON, [fX, fY, fZ - 0.05], [fX, fY, fZ + 0.52], 0.05, { sides: 10 });
  {
    const g = spin([[0, -0.08], [0.17, -0.08], [0.17, 0.05], [0.1, 0.11], [0, 0.11]], { segments: 18 });
    g.rotateX(Math.PI / 2);
    ironOut.push({ geometry: g, color: 0x2d2822, position: [fX, fY, fZ] });
  }
  tuScrew(ironOut, 0x7b7265, [fX, fY, fZ + 0.4], [0, 0, 1], 0.72, 0.5);
  rod(ironIn, 0x37322b, [fX, fY, 0.36], [fX, fY, fZ - 0.1], 0.05, { sides: 10 });
  // A bearing post standing off the floor holds the shaft half way.
  bar(inside, OAKDARK, [fX, 1.24, 0.92], [fX, fY - 0.03, 0.92], 0.18, 0.18);
  ironIn.push({ geometry: new THREE.TorusGeometry(0.075, 0.025, 8, 16), color: 0x37322b, position: [fX, fY, 0.92] });
  bar(ironIn, 0x37322b, [fX, fY, 0.36], [fX - 0.1, fY + 0.42, 0.36], 0.06, 0.05, { up: [0, 0, 1] });
  dot(ironIn, 0x37322b, 0.075, [fX, fY, 0.36], { sides: 10 });
  pipe(inside, OAKFRESH, [[fX - 0.1, fY + 0.42, 0.36], [fX - 0.1, fY + 0.42, -0.02]], 0.05, { sides: 9, steps: 2 });

  // --- inside: floor, tank, seat, pedal, pump, gauge -------------------------------------------------
  const floorY = 1.22;
  const floorR = tuR(floorY) - TU.wall - 0.04;
  {
    const g = spin([[0, floorY - 0.08], [floorR, floorY - 0.08], [floorR, floorY], [0, floorY]], { segments: 44 });
    g.scale(TU.kx, 1, TU.kz);
    inside.push({ geometry: g, color: 0x8d6f47 });
  }
  // Lead ballast: the great weight that kept her upright, in pigs along the deck at her feet.
  for (let i = 0; i < 3; i++) block(inside, 0x585f66, 0.44, 0.2, 0.28, [-0.62 + i * 0.5, floorY + 0.1, 0.62 + (i % 2) * 0.02]);
  // The water tank: filled by the foot valve to sink her, emptied by the pumps to rise.
  const tZ = -0.52;
  inside.push({
    geometry: spin([[0, floorY], [0.66, floorY], [0.74, floorY + 0.14], [0.78, floorY + 0.42], [0.74, floorY + 0.74], [0.68, floorY + 0.9], [0, floorY + 0.9]], { segments: 40 }),
    color: 0x9a744a,
    position: [0.05, 0, tZ],
  });
  for (const y of [floorY + 0.18, floorY + 0.62]) ironIn.push({ geometry: ringGeo(0.77, 0.022, { y, segments: 40, sides: 7, flat: 1.4 }), color: 0x37322b, position: [0.05, 0, tZ] });
  // The seat, a plank across the top of the tank on two posts, with a backrest behind it.
  const seatY = floorY + 1.2;
  block(inside, 0xb48d57, 1.75, 0.11, 0.86, [0.02, seatY, tZ - 0.04]);
  for (const x of [-0.68, 0.72]) block(inside, OAKDARK, 0.14, seatY - floorY - 0.06, 0.14, [x, (seatY + floorY) / 2, tZ + 0.3]);
  block(inside, 0xb48d57, 1.36, 0.82, 0.09, [0.02, seatY + 0.68, -1.3]);
  for (const x of [-0.5, 0.54]) bar(inside, OAKDARK, [x, seatY + 0.68, -1.3], [x, seatY + 0.68, -1.74], 0.1, 0.1);
  // The ballast valve: brass on the tank's face, opened with the foot. The pedal is the biggest thing
  // on the floor because a student has to be able to find it: it is one of the cut's three teaching points.
  const vC = [0.72, floorY + 0.36, 0.08];
  ironIn.push({ geometry: new THREE.SphereGeometry(0.1, 14, 10), color: BRASS, position: vC });
  pipe(ironIn, BRASS, [[0.36, floorY + 0.36, tZ + 0.46], [0.6, floorY + 0.36, 0.0], vC], 0.042, { sides: 9, steps: 8 });
  pipe(ironIn, BRASS, [vC, [0.96, floorY + 0.28, 0.3], [1.22, floorY + 0.12, 0.72]], 0.042, { sides: 9, steps: 8 }); // out through the hull to the sea
  const pedalPivot = [0.72, floorY + 0.09, 0.62];
  rod(ironIn, 0x37322b, [vC[0], vC[1] + 0.02, vC[2]], [0.72, floorY + 0.28, 0.82], 0.022, { sides: 7 });
  bar(ironIn, 0x7a7266, [pedalPivot[0], pedalPivot[1], pedalPivot[2]], [pedalPivot[0], floorY + 0.3, 1.1], 0.3, 0.035);
  rod(ironIn, 0x37322b, [pedalPivot[0] - 0.2, pedalPivot[1], pedalPivot[2]], [pedalPivot[0] + 0.2, pedalPivot[1], pedalPivot[2]], 0.03, { sides: 8 });
  for (const s of [-1, 1]) block(ironIn, 0x37322b, 0.04, 0.12, 0.14, [pedalPivot[0] + s * 0.17, floorY + 0.05, pedalPivot[2]]);
  // The brass force pump, standing beside the tank with its handle up: this is how she rose.
  const pX = -0.98; const pZ = -0.12;
  ironIn.push({
    geometry: spin([[0, floorY], [0.13, floorY], [0.12, floorY + 0.1], [0.095, floorY + 0.16], [0.095, floorY + 1.4], [0.12, floorY + 1.44], [0.12, floorY + 1.5], [0, floorY + 1.5]], { segments: 22 }),
    color: BRASS,
    position: [pX, 0, pZ],
  });
  pipe(ironIn, BRASS, [[pX + 0.08, floorY + 0.24, pZ], [-0.62, floorY + 0.24, pZ - 0.22]], 0.034, { sides: 8, steps: 3 });
  bar(ironIn, 0x37322b, [pX, floorY + 1.56, pZ], [pX + 0.08, floorY + 1.56 + 0.04, pZ + 0.54], 0.045, 0.05);
  pipe(inside, OAKFRESH, [[pX + 0.08, floorY + 1.6, pZ + 0.54], [pX + 0.12, floorY + 1.62, pZ + 0.84]], 0.046, { sides: 8, steps: 2 });
  rod(ironIn, 0x37322b, [pX, floorY + 1.45, pZ], [pX, floorY + 1.6, pZ], 0.03, { sides: 8 });
  // The compass and the water gauge on the forward wall, both marked with foxfire to read in the dark.
  const cmp = tuPoint(0.55, 3.25, -TU.wall - 0.35);
  bar(inside, OAKDARK, tuPoint(0.55, 3.2, -TU.wall), [cmp[0], 3.2, cmp[2]], 0.18, 0.07);
  ironIn.push({ geometry: spin([[0, 0], [0.13, 0], [0.17, 0.05], [0.17, 0.09], [0, 0.09]], { segments: 20 }), color: BRASS, position: [cmp[0], 3.24, cmp[2]] });
  ironIn.push({ geometry: spin([[0, 0], [0.145, 0], [0.145, 0.01], [0, 0.01]], { segments: 20 }), color: 0xbfe0a8, position: [cmp[0], 3.33, cmp[2]] });
  const gg0 = tuPoint(0.98, 3.35, -TU.wall - 0.08); const gg1 = tuPoint(0.98, 4.5, -TU.wall - 0.08);
  rod(ironIn, 0xcfe0d8, gg0, gg1, 0.035, { sides: 8 });
  dot(ironIn, 0xbfe0a8, 0.045, [mix(gg0[0], gg1[0], 0.4), mix(gg0[1], gg1[1], 0.4), mix(gg0[2], gg1[2], 0.4)], { sides: 8 });
  for (const t of [0, 1]) dot(ironIn, BRASS, 0.05, [mix(gg0[0], gg1[0], t), mix(gg0[1], gg1[1], t), mix(gg0[2], gg1[2], t)], { sides: 8 });

  // --- the rudder, with its tiller through the back ----------------------------------------------------
  const rudderY0 = 1.5; const rudderY1 = 3.5;
  {
    const hullZ = (y) => tuR(y) * TU.kz;
    const out = [];
    for (let i = 0; i <= 8; i++) {
      const y = mix(rudderY0, rudderY1, i / 8);
      out.push([hullZ(y) + 0.04, y]);
    }
    out.push([hullZ(rudderY1) + 0.42, rudderY1 + 0.02], [hullZ(rudderY1) + 0.8, rudderY1 - 0.1], [hullZ(rudderY1) + 0.98, rudderY1 - 0.42], [hullZ(rudderY0) + 1.0, rudderY0 + 0.62], [hullZ(rudderY0) + 0.86, rudderY0 + 0.18], [hullZ(rudderY0) + 0.52, rudderY0 - 0.03]);
    const g = toCreasedNormals(extrudeOutline(out, 0.13, { uvFeet: true }), 0.6);
    g.rotateY(Math.PI / 2); // the outline's +x becomes -z, its depth becomes x
    shell.push({ geometry: g, color: 0x5d4730 });
    for (const y of [1.75, 2.5, 3.25]) {
      const z = -hullZ(y);
      bar(ironOut, 0x2f2a24, [0, y, z + 0.03], [0, y, z - 0.42], 0.165, 0.09);
    }
  }
  const tillerStart = tuPoint(Math.PI, 3.2, -TU.wall + 0.05);
  pipe(inside, 0xa17c4d, [tillerStart, [0.2, 3.16, -1.3], [0.72, 3.02, -0.72]], [0.055, 0.05, 0.042], { sides: 9, steps: 12 });
  ironIn.push({ geometry: spin([[0, -0.08], [0.1, -0.08], [0.1, 0.08], [0, 0.08]], { segments: 14 }).rotateX(Math.PI / 2), color: 0x37322b, position: tillerStart });

  // --- the mine, strapped to her back, and the auger above it ----------------------------------------
  const mY = 4.34;
  const mZ = -(tuR(mY) * TU.kz + 0.43);
  {
    const g = spin([
      [0, -0.86], [0.1, -0.855], [0.2, -0.83], [0.29, -0.77], [0.38, -0.69], [0.45, -0.58], [0.5, -0.46], [0.535, -0.32], [0.56, -0.17], [0.57, 0],
      [0.56, 0.17], [0.535, 0.32], [0.5, 0.46], [0.45, 0.58], [0.38, 0.69], [0.29, 0.77], [0.2, 0.83], [0.1, 0.855], [0, 0.86],
    ], { segments: 40 });
    g.scale(1.08, 1, 0.92);
    shell.push({ geometry: g, color: 0x7b5a35, position: [0, mY, mZ] });
    // Its two halves are held by iron hoops; it is the shape of a barrel-staved lens.
    for (const dy of [-0.44, 0, 0.44]) {
      const r = 0.57 * Math.cos((dy / 0.86) * Math.PI * 0.5) ** 0.72;
      const ring = ringGeo(r + 0.012, 0.022, { y: dy, segments: 38, sides: 7 });
      ring.scale(1.08, 1, 0.92);
      ironOut.push({ geometry: ring, color: 0x2f2a24, position: [0, mY, mZ] });
    }
    // Two straps tying it to the hull, and the pin that lets it go.
    for (const dy of [-0.34, 0.34]) {
      const y = mY + dy;
      const p0 = tuPoint(Math.PI, y, 0.0);
      bar(ironOut, 0x2f2a24, [p0[0], p0[1], p0[2] + 0.04], [0, y, mZ + 0.05], 0.12, 0.05);
    }
    rod(ironOut, 0xc59b45, [-0.13, mY + 0.34, mZ + 0.5], [0.13, mY + 0.34, mZ + 0.5], 0.022, { sides: 7 });
  }
  // The auger: a coarse iron wood screw meant to bite the warship's hull and hold the mine against it.
  const augerY0 = tuUpperY(0, -0.98);
  const augerZ = -0.98;
  ironOut.push({ geometry: spin([[0, augerY0 - 0.08], [0.16, augerY0 - 0.08], [0.16, augerY0 + 0.06], [0.09, augerY0 + 0.14], [0, augerY0 + 0.14]], { segments: 18 }), color: 0x2d2822, position: [0, 0, augerZ] });
  const aTop = 6.42;
  ironOut.push({
    geometry: spin([[0, augerY0], [0.05, augerY0], [0.05, aTop - 0.24], [0.012, aTop], [0, aTop]], { segments: 12 }),
    color: 0x4b463e,
    position: [0, 0, augerZ],
  });
  {
    const pts = [];
    const n = 44;
    const h0 = augerY0 + 0.26; const h1 = aTop - 0.04;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = t * 5.2 * Math.PI * 2;
      const r = mix(0.11, 0.024, sstep(t, 0.55, 1));
      pts.push([Math.cos(a) * r, mix(h0, h1, t), augerZ + Math.sin(a) * r]);
    }
    ironOut.push({ geometry: tube(pts, [0.028, 0.012], { sides: 6, steps: 110, round: 1 }), color: 0x5a544a });
  }
  // A line from the auger's head to the mine, so the one pulls the other off when the auger bites.
  pipe(ironOut, 0x9c8a63, [[0, aTop - 0.48, augerZ - 0.08], [0, aTop - 0.68, augerZ - 0.5], [0, mY + 0.9, mZ + 0.34], [0, mY + 0.8, mZ + 0.08]], 0.018, { sides: 6, steps: 18 });
  ironOut.push({ geometry: new THREE.TorusGeometry(0.05, 0.014, 6, 12).rotateY(Math.PI / 2), color: 0x2f2a24, position: [0, mY + 0.86, mZ + 0.04] });

  // --- the low cradle she stands in -----------------------------------------------------------------
  for (const s of [-1, 1]) {
    block(shell, OAKFRESH, 0.36, 0.34, 4.5, [s * 1.0, 0.17, 0]);
    block(shell, OAKDARK, 0.36, 0.06, 4.5, [s * 1.0, 0.36, 0]);
  }
  for (const z of [-1.2, 1.2]) block(shell, OAKDARK, 3.1, 0.3, 0.3, [0, 0.15, z]);
  const saddle = (z) => {
    const out = [[-1.62, 0.32], [1.62, 0.32], [1.62, 1.0]];
    for (let i = 0; i <= 20; i++) {
      const x = mix(1.62, -1.62, i / 20);
      const y = tuLowerY(x, z);
      const top = y === null ? 1.2 : Math.min(1.2, y + 0.04);
      out.push([x, top]);
    }
    const g = toCreasedNormals(extrudeOutline(out, 0.34, {}), 0.7);
    g.translate(0, 0, z);
    shell.push({ geometry: g, color: OAKFRESH });
    for (const s of [-1, 1]) for (const k of [0.5, 0.74]) dot(ironOut, 0x2d2822, 0.04, [s * 1.0, k, z + 0.18], { sides: 8, flat: 0.5, up: [0, 0, 1] });
  };
  saddle(-0.78);
  saddle(0.78);
  block(shell, OAKDARK, 0.6, 0.18, 0.9, [0, 0.41, 0]);

  // --- materials -------------------------------------------------------------------------------------
  // A timber is one piece of oak: its UVs are drawn into a single stave of the tile, or the seams meant
  // for the hull are printed across it and it reads as a stack of bricks.
  const oneStave = (part, seed) => {
    if (part.keepColor) return;
    const uv = part.geometry.attributes.uv;
    if (!uv) return;
    let u0 = 1e9; let u1 = -1e9; let v0 = 1e9; let v1 = -1e9;
    for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
    const cell = ((seed * 5) % 14);
    for (let i = 0; i < uv.count; i++) {
      const a = (uv.getX(i) - u0) / ((u1 - u0) || 1); const b = (uv.getY(i) - v0) / ((v1 - v0) || 1);
      uv.setXY(i, (cell + 0.14 + a * 0.72) / 14, ((seed * 0.13) % 0.6) + b * 0.3);
    }
  };
  shell.forEach((part, i) => oneStave(part, i));
  inside.forEach((part, i) => { if (part.color !== 0xb48d57 && part.color !== 0x9a744a) oneStave(part, i); });
  const shellGeo = mergeParts(shell);
  sheen(shellGeo, { add: 0.04, tint: [0.76, 0.84, 0.92], gain: 0.12 });
  const ironGeo = mergeParts(ironOut);
  sheen(ironGeo, { gain: 0.2, add: 0.015 });
  const ironInGeo = mergeParts(ironIn);
  sheen(ironInGeo, { gain: 0.2, add: 0.03 });
  const maps = tuStaveMaps();
  const lift = { emissive: 0x2a1c0f, emissiveIntensity: 0.55 };
  return groupOf(
    meshFrom(shellGeo, { ...maps, roughness: 0.42, metalness: 0.02 }),
    // Seen from within: this mesh is mostly a wall that faces inward, on purpose.
    meshFrom(mergeParts(inside), { map: maps.map, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, ...lift }, { receive: false }),
    meshFrom(ironGeo, { roughness: 0.46, metalness: 0.42 }),
    meshFrom(ironInGeo, { roughness: 0.42, metalness: 0.35, ...lift }, { receive: false }),
  );
}


// ---------------------------------------------------------------------------
// The clipper ship
// ---------------------------------------------------------------------------

// A thin closed triangular prism, by the hundred. Rigging is a real line with real ends, cheap enough
// that a whole ship's standing rigging costs less than one of its sails.
class Rig {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; }

  line(a, b, r, color) {
    const A = vec(a); const B = vec(b);
    const d = B.clone().sub(A);
    if (d.lengthSq() < 1e-6) return;
    d.normalize();
    const e1 = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    e1.addScaledVector(d, -e1.dot(d)).normalize();
    const e2 = new THREE.Vector3().crossVectors(d, e1).normalize();
    const base = this.p.length / 3;
    const C = new THREE.Color(color);
    for (const P of [A, B]) {
      for (let k = 0; k < 3; k++) {
        const t = (k / 3) * Math.PI * 2;
        const nx = e1.x * Math.cos(t) + e2.x * Math.sin(t);
        const ny = e1.y * Math.cos(t) + e2.y * Math.sin(t);
        const nz = e1.z * Math.cos(t) + e2.z * Math.sin(t);
        this.p.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
        this.n.push(nx, ny, nz);
        this.c.push(C.r, C.g, C.b);
      }
    }
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      this.i.push(base + k, base + k2, base + 3 + k2, base + k, base + 3 + k2, base + 3 + k);
    }
    this.i.push(base, base + 2, base + 1, base + 3, base + 4, base + 5);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return g;
  }
}

// The hull is one function of how far along it is (s, stern to stem) and how high (y). Everything else
// on the ship, from the planks of the deck to the feet of the shrouds, asks it where the side is.
const CL = {
  L: 47, beam: 8.35, waterline: 2.15, rail: 4.85, bulwark: 0.85, sMax: 0.46,
};
const clSheer = (s) => {
  const f = s - 0.46;
  return CL.rail + (f > 0 ? 1.15 * (f / 0.54) ** 2.2 : 0.75 * (-f / 0.46) ** 2.2);
};
const clZ = (s, y) => {
  const e = clamp01(y / clSheer(s));
  const stem = 19.6 + 3.9 * e ** 1.7;
  const stern = -19.3 - 4.2 * e ** 1.5;
  return mix(stern, stem, s);
};
function clHalf(s, y) {
  const h = clSheer(s);
  const e = clamp01(y / h);
  let B; let p;
  if (s >= CL.sMax) {
    const f = (s - CL.sMax) / (1 - CL.sMax);
    B = (CL.beam / 2) * Math.max(0, 1 - f ** 1.75) ** 1.35; // exponent over one is what makes the bow hollow
    p = mix(0.42, 1.25, f * f);
  } else {
    const f = (CL.sMax - s) / CL.sMax;
    // A round counter stern: full at the rail, drawing in hard only below it.
    B = (CL.beam / 2) * Math.max(0, 1 - f ** 3.4) ** 0.46;
    p = mix(0.42, 2.1, f ** 3);
  }
  const tumble = 1 - 0.035 * sstep(e, 0.72, 1);
  return 0.085 + Math.max(0, B - 0.085) * e ** p * tumble;
}
function clSide(s, y, side, inset = 0) {
  return [side * Math.max(0, clHalf(s, y) - inset), y, clZ(s, y)];
}
// The s at which a given z is reached at a given height (monotonic, so a bisection is enough).
function clSofZ(z, y) {
  let lo = 0; let hi = 1;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (clZ(m, Math.min(y, clSheer(m))) < z) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
const clDeckY = (s) => clSheer(s) - CL.bulwark;
const clDeckAt = (z) => clDeckY(clSofZ(z, CL.rail - CL.bulwark));
const clDeckHalf = (z) => {
  const s = clSofZ(z, CL.rail - CL.bulwark);
  return Math.max(0, clHalf(s, clDeckY(s)) - 0.16);
};
const clRail = (z, side) => {
  const s = clSofZ(z, CL.rail);
  const y = clSheer(s);
  return [side * clHalf(s, y), y, clZ(s, y)];
};

function clipperHull() {
  const N = 96;
  const sAt = (i) => {
    // Closer together at the two ends, where the hull curves fastest.
    return clamp01(0.5 - 0.5 * Math.cos(Math.PI * (i / N)));
  };
  const COPPER = lin(0xd67a3c); const COPPER2 = lin(0xb9602c);
  const BLACK = [0.016, 0.016, 0.02]; const GOLD = lin(0xe0ae3a); const WHITE = lin(0xe3dfd2); const RAILC = lin(0x6b3e20);
  const pos = []; const nor = []; const uv = []; const col = []; const idx = [];
  const normalAt = (s, y, side) => {
    const h = 0.004; const hy = 0.03;
    const a = clSide(Math.min(1, s + h), y, side); const b = clSide(Math.max(0, s - h), y, side);
    const c = clSide(s, Math.min(y + hy, clSheer(s)), side); const d = clSide(s, Math.max(0, y - hy), side);
    const dz = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dy = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    let nx = dy[1] * dz[2] - dy[2] * dz[1]; let ny = dy[2] * dz[0] - dy[0] * dz[2]; let nz = dy[0] * dz[1] - dy[1] * dz[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    return side > 0 ? [nx, ny, nz] : [-nx, -ny, -nz];
  };
  // A band of rows between two height functions, in one flat colour run, on both sides. Each band has
  // vertices of its own, so a paint line falls exactly on a grid line and is sharp at any distance.
  const bandRows = (fn0, fn1, rows, colorFn) => {
    for (const side of [-1, 1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const s = sAt(i);
        for (let r = 0; r <= rows; r++) {
          const y = mix(fn0(s), fn1(s), r / rows);
          const p = clSide(s, y, side);
          const n = normalAt(s, y, side);
          pos.push(p[0], p[1], p[2]);
          nor.push(n[0], n[1], n[2]);
          uv.push(p[2] / 3.2, y / 1.6);
          const c = colorFn(s, y, r / rows);
          col.push(c[0], c[1], c[2]);
        }
      }
      const stride = rows + 1;
      for (let i = 0; i < N; i++) {
        for (let r = 0; r < rows; r++) {
          const a = base + i * stride + r; const b = a + 1; const c = a + stride + 1; const d = a + stride;
          if (side > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
        }
      }
    }
  };
  const wl = () => CL.waterline;
  const copperC = (s, y) => {
    const n = smoothNoise3(s * 40, y * 2, 1.5);
    const c = [mix(COPPER[0], COPPER2[0], n), mix(COPPER[1], COPPER2[1], n), mix(COPPER[2], COPPER2[2], n)];
    return c;
  };
  const stripeLow = (s) => clSheer(s) - 0.6;
  const stripeHigh = (s) => clSheer(s) - 0.44;
  bandRows(() => 0, wl, 8, copperC);
  bandRows(wl, stripeLow, 5, () => BLACK);
  bandRows(stripeLow, stripeHigh, 1, () => GOLD);
  bandRows(stripeHigh, clSheer, 2, () => BLACK);

  // The rail's cap and the white inner face of the bulwark, each a strip of its own.
  const soup = new Soup();
  const uvNone = [[0.02, 0.02], [0.02, 0.03], [0.03, 0.03], [0.03, 0.02]];
  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const s0 = sAt(i); const s1 = sAt(i + 1);
      const y0 = clSheer(s0); const y1 = clSheer(s1);
      const out0 = clSide(s0, y0, side); const out1 = clSide(s1, y1, side);
      const ri0 = clSide(s0, y0, side, 0.16); const ri1 = clSide(s1, y1, side, 0.16);
      const ly0 = clDeckY(s0); const ly1 = clDeckY(s1);
      const li0 = clSide(s0, ly0, side, 0.16); const li1 = clSide(s1, ly1, side, 0.16);
      // Top of the rail, faces up.
      if (side > 0) soup.quad(out0, out1, ri1, ri0, uvNone, RAILC);
      else soup.quad(out0, ri0, ri1, out1, uvNone, RAILC);
      // Inner face of the bulwark, faces the deck.
      // Its foot comes in with the hull: it must stay inside the planking, which narrows below the rail.
      li0[0] = side * Math.min(Math.abs(ri0[0]), clHalf(s0, ly0) - 0.1);
      li1[0] = side * Math.min(Math.abs(ri1[0]), clHalf(s1, ly1) - 0.1);
      if (side > 0) soup.quad(ri0, ri1, li1, li0, uvNone, WHITE);
      else soup.quad(ri0, li0, li1, ri1, uvNone, WHITE);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return [g, soup.geometry()];
}

// The deck itself: a grid clipped to the hull's own half-width at every station, so it cannot overhang.
function clipperDeck() {
  const N = 60; const across = 8;
  const pos = []; const nor = []; const uv = []; const idx = [];
  for (let i = 0; i <= N; i++) {
    const s = 0.5 - 0.5 * Math.cos(Math.PI * mix(0.03, 0.97, i / N));
    const y = clDeckY(s);
    const half = Math.max(0, clHalf(s, y) - 0.14);
    const z = clZ(s, y);
    for (let j = 0; j <= across; j++) {
      const t = (j / across) * 2 - 1;
      const x = t * half;
      const crown = (1 - t * t) * half * 0.022;
      pos.push(x, y + crown, z);
      nor.push(0, 1, 0);
      uv.push(x / 2.2, z / 6);
    }
  }
  const st = across + 1;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * st + j; const b = a + 1; const c = a + st; const d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function clipperPlateMap() {
  const { canvas, ctx } = makeCanvas(512, 512);
  const rng = seededRandom(1851);
  ctx.fillStyle = '#efece6';
  ctx.fillRect(0, 0, 512, 512);
  // Sheathing plates, staggered: copper was nailed on in overlapping sheets about 4ft by 14in.
  const rows = 8; const cols = 8;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? 32 : 0;
    for (let c = -1; c < cols; c++) {
      const v = 222 + Math.round(rng() * 32);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
      ctx.fillRect(c * 64 + off, r * 64, 64, 64);
      ctx.fillStyle = 'rgba(70,40,20,0.38)';
      ctx.fillRect(c * 64 + off, r * 64, 1.5, 64);
    }
    ctx.fillStyle = 'rgba(70,40,20,0.42)';
    ctx.fillRect(0, r * 64, 512, 1.5);
  }
  return texOf(canvas, THREE.SRGBColorSpace);
}

function clipperPlankMap() {
  const { canvas, ctx } = makeCanvas(256, 512);
  const rng = seededRandom(229);
  ctx.fillStyle = '#ece4d3';
  ctx.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 8; i++) {
    const v = 214 + Math.round(rng() * 34);
    ctx.fillStyle = `rgb(${v},${v - 6},${v - 18})`;
    ctx.fillRect(i * 32, 0, 32, 512);
    ctx.fillStyle = 'rgba(50,38,24,0.8)';
    ctx.fillRect(i * 32, 0, 2, 512);
    ctx.fillRect(i * 32, rng() * 512, 32, 2);
  }
  return texOf(canvas, THREE.SRGBColorSpace);
}

// One sail's cloth, normalised to the sail: cloths running head to foot, reef bands near the head.
// v = 0 is the head, so the bands are painted at the canvas's foot.
function clipperSailMap() {
  const S = 1024; const H = 512;
  const { canvas, ctx } = makeCanvas(S, H);
  const rng = seededRandom(89);
  ctx.fillStyle = '#f6f1e4';
  ctx.fillRect(0, 0, S, H);
  // The left half is a square sail, the right half a jib: a jib has no reef bands to reach out to.
  const half = S / 2;
  const cloths = 22;
  for (let k = 0; k < 2; k++) {
    for (let i = 0; i < cloths; i++) {
      const v = 232 + Math.round(rng() * 22);
      ctx.fillStyle = `rgb(${v},${v - 3},${v - 12})`;
      ctx.fillRect(k * half + (i / cloths) * half, 0, half / cloths, H);
      ctx.fillStyle = 'rgba(120,108,84,0.55)';
      ctx.fillRect(k * half + (i / cloths) * half, 0, 1.3, H);
    }
  }
  for (const f of [0.1, 0.2, 0.3]) {
    const y = H * (1 - f);
    ctx.fillStyle = 'rgba(150,136,106,0.8)';
    ctx.fillRect(0, y, half, 3);
    ctx.fillStyle = 'rgba(70,60,44,0.8)';
    for (let k = 0; k < 32; k++) ctx.fillRect((k + 0.5) * (half / 32), y - 4, 1.6, 11);
  }
  const tex = texOf(canvas, THREE.SRGBColorSpace);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function clipperWaterMap() {
  const S = 512;
  const { canvas, ctx } = makeCanvas(S, S);
  const rng = seededRandom(1854);
  ctx.fillStyle = '#10262f';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 800; i++) {
    const x = rng() * S; const y = rng() * S; const w = 20 + rng() * 60;
    const light = rng() > 0.7;
    ctx.strokeStyle = light ? `rgba(70,112,122,${0.12 + rng() * 0.22})` : `rgba(4,18,28,${0.3 + rng() * 0.3})`;
    ctx.lineWidth = 0.8 + rng() * 1.8;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy);
      ctx.quadraticCurveTo(x + dx + w * 0.5, y + dy - 3 - rng() * 2, x + dx + w, y + dy);
      ctx.stroke();
    }
  }
  return texOf(canvas, THREE.SRGBColorSpace);
}

function clipperShip() {
  const spars = [];
  const deck = [];
  const sails = [];
  const rig = new Rig();
  const TAR = 0x14120f; const HEMP = 0x8a7350; const SPARC = 0x2a2119; const LOWER = 0xcabf9f; const WOOD = 0x8a6236;
  const SAIL = 0xe6dfcb;

  // --- masts, from a table --------------------------------------------------------------------------
  // Heights are above the deck at that mast. Yards are [height, width]: course, lower topsail, upper
  // topsail, topgallant, royal, skysail. Six to a mast, so eighteen square sails, every one on a yard.
  const main = {
    heights: { top: 14.2, topHead: 25.2, poleHead: 37 },
    yards: [[12.4, 16.8], [16.8, 14.8], [21.2, 12.4], [25.8, 9.8], [29.6, 7.7], [32.9, 5.8]],
  };
  const scaleMast = (m, k, w) => ({
    heights: { top: m.heights.top * k, topHead: m.heights.topHead * k, poleHead: m.heights.poleHead * k },
    yards: m.yards.map(([h, wd]) => [h * k, wd * w]),
  });
  const MASTS = [
    { name: 'fore', z: 12.6, rake: 0.025, brace: 0.3, ...scaleMast(main, 0.95, 0.94) },
    { name: 'main', z: 0.2, rake: 0.038, brace: 0.3, ...scaleMast(main, 1, 1) },
    { name: 'mizzen', z: -11.2, rake: 0.05, brace: 0.36, ...scaleMast(main, 0.82, 0.76) },
  ];
  for (const m of MASTS) m.deck = clDeckAt(m.z);
  const mastAt = (m, h) => [0, m.deck + h, m.z - m.rake * h];
  const mastR = (m, h) => {
    if (h < m.heights.top) return mix(0.42, 0.33, h / m.heights.top);
    if (h < m.heights.topHead) return mix(0.25, 0.17, (h - m.heights.top) / (m.heights.topHead - m.heights.top));
    return mix(0.135, 0.05, (h - m.heights.topHead) / (m.heights.poleHead - m.heights.topHead));
  };

  const mastSeg = (m, h0, h1, r0, r1, color, zOff = 0) => {
    const a = mastAt(m, h0); const b = mastAt(m, h1);
    a[2] += zOff; b[2] += zOff;
    spars.push({ geometry: alongY(new THREE.CylinderGeometry(r1, r0, vec(a).distanceTo(vec(b)), 16), a, b), color });
  };
  for (const m of MASTS) {
    const H = m.heights;
    mastSeg(m, -0.4, H.top + 1.1, mastR(m, 0), mastR(m, H.top), LOWER);
    // The doublings: each mast above overlaps the one below, stepped forward of it, in a cap and trestle.
    mastSeg(m, H.top - 0.9, H.topHead + 1.0, mastR(m, H.top + 0.1), mastR(m, H.topHead), SPARC, 0.5);
    mastSeg(m, H.topHead - 0.8, H.poleHead, mastR(m, H.topHead + 0.1), 0.05, SPARC, 0.82);
    const tp = mastAt(m, H.poleHead);
    tp[2] += 0.82;
    dot(spars, 0xd6b45a, 0.09, [tp[0], tp[1] + 0.03, tp[2]], { sides: 10 });
    // The top: a platform wide enough for the topmast shrouds, the crosstrees higher up a spreader.
    const tc = mastAt(m, H.top - 0.82);
    spars.push({ geometry: new THREE.CylinderGeometry(1.55, 1.4, 0.13, 22), color: 0x4a3620, position: [0, tc[1], tc[2] + 0.2], scale: [1, 1, 0.74] });
    block(spars, 0x1c1610, 0.5, 0.2, 0.94, [0, mastAt(m, H.top + 0.95)[1], mastAt(m, H.top + 0.95)[2] + 0.24]);
    const cc = mastAt(m, H.topHead - 0.7);
    bar(spars, 0x2c241a, [-1.0, cc[1], cc[2] + 0.56], [1.0, cc[1], cc[2] + 0.56], 0.09, 0.09);
    bar(spars, 0x2c241a, [-1.0, cc[1], cc[2] + 1.0], [1.0, cc[1], cc[2] + 1.0], 0.09, 0.09);
    block(spars, 0x1c1610, 0.36, 0.16, 0.72, [0, mastAt(m, H.topHead + 0.92)[1], mastAt(m, H.topHead + 0.92)[2] + 0.52]);
  }

  const off = (m, h) => {
    if (h < m.heights.top) return 0;
    if (h < m.heights.topHead) return 0.5;
    return 0.82;
  };
  const mastPoint = (m, h) => { const p = mastAt(m, h); p[2] += off(m, h); return p; };

  // --- yards and square sails ------------------------------------------------------------------------
  const frameOf = (m) => {
    const c = Math.cos(m.brace); const si = Math.sin(m.brace);
    return { right: [c, 0, -si], fwd: [si, 0, c] };
  };
  const yardPoint = (m, level, u) => {
    // u in -1..1 along the yard, from the yard's own centre, which stands before the mast.
    const [h, w] = m.yards[level];
    const { right, fwd } = frameOf(m);
    const M = mastPoint(m, h);
    const stand = mastR(m, h) + 0.13;
    const k = (u * w) / 2;
    return [M[0] + fwd[0] * stand + right[0] * k, M[1], M[2] + fwd[2] * stand + right[2] * k];
  };
  // A sail's own 0-1 UVs carried into its half of the canvas (0 for a square sail, 1 for a jib).
  const sailUV = (g, half) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (half + 0.005 + uv.getX(i) * 0.99) * 0.5);
    return g;
  };
  // The rope sewn round a sail: both leeches and the foot, in the thin lines the rigging is made of.
  const boltRope = (point, segsV, segsU) => {
    for (const u of [0, 1]) {
      for (let i = 0; i < segsV; i++) rig.line(point(u, i / segsV), point(u, (i + 1) / segsV), 0.02, 0x9c8a66);
    }
    for (let i = 0; i < segsU; i++) rig.line(point(i / segsU, 1), point((i + 1) / segsU, 1), 0.02, 0x9c8a66);
  };
  for (const m of MASTS) {
    const { fwd } = frameOf(m);
    m.yards.forEach(([h, w], level) => {
      const a = yardPoint(m, level, -1); const b = yardPoint(m, level, 1); const c = yardPoint(m, level, 0);
      const r = mix(0.16, 0.07, level / 5);
      spars.push({ geometry: tube([a, c, b], [r * 0.48, r, r * 0.48], { sides: 10, steps: 10, round: 1 }), color: SPARC });
      // The truss holding yard to mast.
      const M = mastPoint(m, h);
      bar(spars, 0x1c1610, M, c, 0.12, 0.12);
      // Footropes hang under every yard, and a lift runs up from each yardarm.
      for (const s of [-1, 1]) {
        const arm = yardPoint(m, level, s);
        const mid = yardPoint(m, level, s * 0.5);
        const tip = yardPoint(m, level, s * 0.98);
        rig.line([tip[0], tip[1] - 0.16, tip[2]], [mid[0], mid[1] - 0.26, mid[2]], 0.012, HEMP);
        rig.line([mid[0], mid[1] - 0.26, mid[2]], [c[0], c[1] - 0.16, c[2]], 0.012, HEMP);
        const up = level < 5 ? yardPoint(m, level + 1, 0) : mastPoint(m, m.heights.poleHead * 0.98);
        rig.line(arm, up, 0.014, TAR);
      }
    });
    // The sails, each from its own yard down to the yardarms of the next one below.
    m.yards.forEach(([h, w], level) => {
      const courseFoot = level === 0;
      const headL = yardPoint(m, level, -0.93); const headR = yardPoint(m, level, 0.93);
      let footL; let footR;
      if (courseFoot) {
        const footH = m.heights.top * 0.4;
        const M = mastPoint(m, footH);
        const { right } = frameOf(m);
        const wF = w * 1.04;
        footL = [M[0] - (right[0] * wF) / 2 + fwd[0] * 0.5, M[1], M[2] - (right[2] * wF) / 2 + fwd[2] * 0.5];
        footR = [M[0] + (right[0] * wF) / 2 + fwd[0] * 0.5, M[1], M[2] + (right[2] * wF) / 2 + fwd[2] * 0.5];
      } else {
        footL = yardPoint(m, level - 1, -0.93);
        footR = yardPoint(m, level - 1, 0.93);
      }
      const drop = headL[1] - footL[1];
      const belly = drop * (courseFoot ? 0.17 : 0.2);
      const roach = drop * (courseFoot ? 0.14 : 0.18);
      const nu = courseFoot ? 22 : 18;
      const nv = courseFoot ? 12 : 10;
      const point = (u, v) => {
        const a = [mix(headL[0], headR[0], u), mix(headL[1], headR[1], u) - 0.08, mix(headL[2], headR[2], u)];
        const b = [mix(footL[0], footR[0], u), mix(footL[1], footR[1], u) + roach * Math.sin(Math.PI * u) ** 0.8, mix(footL[2], footR[2], u)];
        const bulge = belly * Math.sin(Math.PI * u) ** 0.75 * Math.sin(Math.PI * (0.06 + v * 0.8)) ** 0.9;
        // The head is seized to the yard, so it runs in the yard's own centre rather than off its face.
        return [mix(a[0], b[0], v) + fwd[0] * bulge, mix(a[1], b[1], v), mix(a[2], b[2], v) + fwd[2] * bulge];
      };
      sails.push({ geometry: sailUV(solidSurface({ nu, nv, point, thick: () => 0.03 }), 0), color: SAIL });
      boltRope(point, 10, 12);
      // Course sheets and tacks: down to the rail from each clew.
      if (courseFoot) {
        for (const [p, s] of [[footL, -1], [footR, 1]]) {
          rig.line(p, clRail(m.z - 7, s), 0.012, HEMP);
          rig.line(p, clRail(m.z + 5.5, s), 0.012, HEMP);
        }
      }
    });
  }

  // --- the bowsprit, jibboom and flying jibboom: no figurehead, a clean spar off a clean stem -------------
  const stemS = 0.985;
  const stemY = clSheer(stemS);
  const stemZ = clZ(stemS, stemY);
  const up = Math.tan((13.5 * Math.PI) / 180);
  const bow = (d) => [0, stemY + 0.15 + d * up, stemZ + d];
  const boomEnd = [3.6, 9.2, 13.8];
  spars.push({ geometry: tube([bow(-3.6), bow(0), bow(boomEnd[0] + 0.5)], [0.38, 0.33, 0.2], { sides: 16, steps: 8, round: 2 }), color: 0xc8bea0 });
  // The cap, the iron bands of the gammoning, and the two spars above it.
  block(spars, 0x1a1510, 0.5, 0.6, 0.22, [0, bow(boomEnd[0])[1] + 0.16, bow(boomEnd[0])[2]], [-(13.5 * Math.PI) / 180, 0, 0]);
  {
    const a = bow(boomEnd[0] - 1.8); const b = bow(boomEnd[1]);
    const lift = 0.3;
    spars.push({ geometry: tube([[0, a[1] + lift, a[2]], [0, b[1] + lift, b[2]]], [0.16, 0.085], { sides: 12, steps: 4, round: 2, straight: true }), color: SPARC });
    const c = bow(boomEnd[1] - 1.2); const d = bow(boomEnd[2]);
    spars.push({ geometry: tube([[0, c[1] + lift + 0.14, c[2]], [0, d[1] + lift + 0.14, d[2]]], [0.08, 0.04], { sides: 10, steps: 4, round: 2, straight: true }), color: SPARC });
  }
  const jib = (d, y = 0.32) => { const p = bow(d); return [0, p[1] + y, p[2]]; };
  // The dolphin striker under the cap, spreading the martingale stays that hold the jibboom down.
  const striker = [0, bow(boomEnd[0])[1] - 2.2, bow(boomEnd[0])[2] - 0.3];
  spars.push({ geometry: tube([bow(boomEnd[0]), striker], [0.07, 0.05], { sides: 8, steps: 2, round: 1, straight: true }), color: 0x1a1510 });
  rig.line(jib(boomEnd[1], 0.3), striker, 0.02, TAR);
  rig.line(jib(boomEnd[2], 0.44), striker, 0.018, TAR);
  const cutwater = (e) => { const s = stemS; const y = clSheer(s) * e; return [0, y, clZ(s, y)]; };
  rig.line(striker, cutwater(0.72), 0.022, TAR);
  rig.line(bow(boomEnd[0]), cutwater(0.5), 0.022, TAR);
  rig.line(bow(boomEnd[0] * 0.6), cutwater(0.72), 0.022, TAR);
  for (const s of [-1, 1]) {
    rig.line(bow(boomEnd[0]), clRail(18.5, s), 0.018, TAR);
    rig.line(jib(boomEnd[1], 0.3), clRail(19.5, s), 0.014, TAR);
  }

  // --- standing rigging ----------------------------------------------------------------------------------
  const shroudC = TAR;
  const addShrouds = (m) => {
    const H = m.heights;
    for (const s of [-1, 1]) {
      // Lower shrouds: six to a side, from the channel at the rail to the masthead under the top.
      const top = mastAt(m, H.top - 1.0);
      const feet = [];
      for (let i = 0; i < 6; i++) {
        const z = m.z + 0.4 - i * 0.62;
        const foot = clRail(z, s);
        foot[0] += s * 0.1;
        feet.push(foot);
        const head = [s * (mastR(m, H.top - 1) * 0.7), top[1] - i * 0.05, top[2] - 0.06 * i];
        rig.line(foot, head, 0.03, shroudC);
      }
      // Ratlines across them, one line tied to all six at each step, climbing the rig.
      const rows = 11;
      for (let r = 1; r <= rows; r++) {
        const t = r / (rows + 1);
        const a = vec(feet[0]).lerp(new THREE.Vector3(s * 0.2, top[1], top[2]), t);
        const b = vec(feet[5]).lerp(new THREE.Vector3(s * 0.2, top[1], top[2] - 0.3), t);
        rig.line([a.x, a.y, a.z], [b.x, b.y, b.z], 0.011, HEMP);
      }
      // Topmast shrouds, from the rim of the top to the topmast head; futtocks down to the lower mast.
      const rim = [];
      const headT = mastPoint(m, H.topHead - 0.8);
      for (let i = 0; i < 4; i++) {
        const tz = top[2] - 0.2 - i * 0.28;
        const R = [s * 1.38, top[1] + 0.14, tz];
        rim.push(R);
        rig.line(R, [s * 0.14, headT[1] - i * 0.04, headT[2] - 0.04], 0.022, shroudC);
        const futt = mastAt(m, H.top - 3.1);
        rig.line(R, [s * 0.3, futt[1], futt[2]], 0.014, shroudC);
      }
      for (let r = 1; r <= 7; r++) {
        const t = r / 8;
        const a = vec(rim[0]).lerp(new THREE.Vector3(s * 0.1, headT[1], headT[2]), t);
        const b = vec(rim[3]).lerp(new THREE.Vector3(s * 0.1, headT[1], headT[2]), t);
        rig.line([a.x, a.y, a.z], [b.x, b.y, b.z], 0.009, HEMP);
      }
      // Topgallant shrouds from the crosstrees to the pole.
      const cc = mastAt(m, H.topHead - 0.7);
      const headG = mastPoint(m, m.yards[4][0] + 0.2);
      for (const k of [0, 1]) rig.line([s * 0.98, cc[1], cc[2] + 0.56 + k * 0.42], [s * 0.05, headG[1], headG[2]], 0.012, shroudC);
      // Backstays: long lines from aft of the mast at the rail up to each head.
      const stays = [[H.topHead - 0.6, 3.6], [m.yards[3][0] + 0.8, 4.6], [m.yards[4][0] + 0.2, 5.6], [m.yards[5][0] + 0.2, 6.6]];
      for (const [h, back] of stays) {
        const head = mastPoint(m, h);
        const foot = clRail(m.z - back, s);
        foot[0] += s * 0.08;
        rig.line(foot, [s * 0.04, head[1], head[2]], 0.02, shroudC);
      }
    }
  };
  for (const m of MASTS) addShrouds(m);

  const [FORE, MAIN, MIZ] = MASTS;
  // Fore-and-aft stays, each from a masthead forward to something that holds it. Kept by name, because
  // the jibs and staysails hang on them.
  const head = (m, h) => { const p = mastPoint(m, h); return [p[0], p[1], p[2] + 0.05]; };
  const stay = (a, b, r = 0.024) => { rig.line(a, b, r + 0.008, TAR); return { a, b }; };
  const STAYS = {
    foreStay: stay(head(FORE, FORE.heights.top - 1.2), bow(boomEnd[0] - 0.4), 0.03),
    foreTop: stay(head(FORE, FORE.heights.topHead - 0.7), jib(boomEnd[0] + 2.1), 0.022),
    foreGallant: stay(head(FORE, FORE.yards[3][0] + 1), jib(boomEnd[1] - 0.2), 0.018),
    foreRoyal: stay(head(FORE, FORE.yards[4][0] + 0.8), jib(boomEnd[2] - 0.3, 0.44), 0.016),
    mainStay: stay(head(MAIN, MAIN.heights.top - 1.2), [0, FORE.deck + 0.9, FORE.z - 0.45], 0.028),
    mainTop: stay(head(MAIN, MAIN.heights.topHead - 0.7), head(FORE, FORE.heights.top - 1.2), 0.022),
    mainGallant: stay(head(MAIN, MAIN.yards[3][0] + 1), head(FORE, FORE.heights.topHead - 2.2), 0.018),
    mainRoyal: stay(head(MAIN, MAIN.yards[4][0] + 0.8), head(FORE, FORE.yards[3][0] - 0.1), 0.016),
    mizStay: stay(head(MIZ, MIZ.heights.top - 1.2), [0, MAIN.deck + 0.9, MAIN.z - 0.5], 0.024),
    mizTop: stay(head(MIZ, MIZ.heights.topHead - 0.7), head(MAIN, MAIN.heights.top - 3.4), 0.02),
    mizGallant: stay(head(MIZ, MIZ.yards[3][0] + 1), head(MAIN, MAIN.heights.top + 3.2), 0.016),
    mizRoyal: stay(head(MIZ, MIZ.yards[4][0] + 0.8), head(MAIN, MAIN.heights.topHead - 2.6), 0.014),
  };
  // Skysail stays, and the braces that lead aft from every yardarm to the next mast.
  stay(head(FORE, FORE.yards[5][0] + 0.8), jib(boomEnd[2] - 0.1, 0.44), 0.012);
  stay(head(MAIN, MAIN.yards[5][0] + 0.8), head(FORE, FORE.yards[4][0] - 0.1), 0.012);
  stay(head(MIZ, MIZ.yards[5][0] + 0.8), head(MAIN, MAIN.yards[4][0] - 0.1), 0.012);
  const bracesFrom = (m, next) => {
    m.yards.forEach(([h], level) => {
      for (const s of [-1, 1]) {
        const arm = yardPoint(m, level, s);
        if (next) {
          const ny = mastPoint(next, Math.min(next.heights.poleHead - 0.8, next.yards[Math.max(0, level - 1)][0] + 0.2));
          rig.line(arm, [s * 0.1, ny[1], ny[2]], 0.009, HEMP);
        } else {
          const foot = clRail(m.z - 9.5 - level * 0.4, s);
          rig.line(arm, foot, 0.009, HEMP);
        }
      }
    });
  };
  bracesFrom(FORE, MAIN);
  bracesFrom(MAIN, MIZ);
  bracesFrom(MIZ, null);

  // --- triangular sails: jibs on the bowsprit's stays, staysails between the masts --------------------
  const triSail = (A, B, C, bellyAmt = 0.5, lee = [1, 0, 0]) => {
    // A is the tack, B the clew and C the head. The cloth's own normal is the thickness axis.
    const e1 = vec(B).sub(vec(A)); const e2 = vec(C).sub(vec(A));
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
    if (n.x * lee[0] + n.y * lee[1] + n.z * lee[2] < 0) n.negate();
    const point = (u, v) => {
      const base = [mix(A[0], B[0], u), mix(A[1], B[1], u), mix(A[2], B[2], u)];
      const bulge = bellyAmt * Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * Math.min(1, v * 1.02 + 0.03)) ** 0.8;
      return [mix(base[0], C[0], v) + n.x * bulge, mix(base[1], C[1], v) + n.y * bulge, mix(base[2], C[2], v) + n.z * bulge];
    };
    sails.push({ geometry: sailUV(solidSurface({ nu: 16, nv: 9, axis: [n.x, n.y, n.z], point, thick: () => 0.028 }), 1), color: SAIL });
    // The leech and the foot; the luff is already on its stay.
    for (let i = 0; i < 9; i++) rig.line(point(1, i / 9), point(1, (i + 1) / 9), 0.018, 0x9c8a66);
    for (let i = 0; i < 9; i++) rig.line(point(i / 9, 0), point((i + 1) / 9, 0), 0.018, 0x9c8a66);
    rig.line(B, clRail(B[2] - 3.5, 1), 0.01, HEMP);
  };
  const onStay = (st, t) => [mix(st.a[0], st.b[0], t), mix(st.a[1], st.b[1], t), mix(st.a[2], st.b[2], t)];
  const LEE = 1.1;
  const jibClew = (y, z) => [LEE, y, z];
  // Four headsails: t runs from the masthead (0) to the boom (1).
  const headsail = (st, t0, t1, clewY, clewZ, belly = 0.42) => triSail(onStay(st, t1), jibClew(clewY, clewZ), onStay(st, t0), belly);
  headsail(STAYS.foreStay, 0.2, 0.96, FORE.deck + 2.4, FORE.z + 2.9);
  headsail(STAYS.foreTop, 0.34, 0.97, FORE.deck + 3.3, FORE.z + 5.6);
  headsail(STAYS.foreGallant, 0.5, 0.97, FORE.deck + 4.8, FORE.z + 8.3);
  headsail(STAYS.foreRoyal, 0.58, 0.97, FORE.deck + 6.6, FORE.z + 11, 0.36);
  // Six staysails, three between each pair of masts. Each is set along its stay and sheeted aft.
  const staysail = (st, t0, t1, drop, aft, belly = 0.4) => {
    const headP = onStay(st, t0); const tackP = onStay(st, t1);
    const clew = [LEE * 0.8, Math.max(tackP[1] - 0.6, headP[1] - drop), headP[2] + 0.35 + aft];
    triSail(tackP, clew, headP, belly);
  };
  staysail(STAYS.mainTop, 0.12, 0.84, 7.1, 1.6);
  staysail(STAYS.mainGallant, 0.1, 0.8, 5.2, 1.3);
  staysail(STAYS.mainRoyal, 0.1, 0.76, 4.1, 1.1);
  staysail(STAYS.mizTop, 0.12, 0.86, 6.0, 1.4);
  staysail(STAYS.mizGallant, 0.1, 0.8, 4.4, 1.1);
  staysail(STAYS.mizRoyal, 0.1, 0.76, 3.4, 0.95);

  // The spanker, on boom and gaff at the mizzen, carried out to leeward.
  {
    const m = MIZ;
    const sw = 0.2; // how far off the centreline it is sheeted, in radians
    const d = [Math.sin(sw), 0, -Math.cos(sw)];
    const boomH = 3.3; const gaffH = m.heights.top - 2.1;
    const B0 = mastAt(m, boomH); const G0 = mastAt(m, gaffH);
    const boomLen = 13.6; const gaffLen = 8.8;
    const B1 = [B0[0] + d[0] * boomLen, B0[1] + 0.85, B0[2] + d[2] * boomLen];
    const G1 = [G0[0] + d[0] * gaffLen, G0[1] + 4.0, G0[2] + d[2] * gaffLen];
    spars.push({ geometry: tube([B0, B1], [0.15, 0.09], { sides: 10, steps: 4, round: 1, straight: true }), color: SPARC });
    spars.push({ geometry: tube([G0, G1], [0.12, 0.06], { sides: 10, steps: 4, round: 1, straight: true }), color: SPARC });
    const n = new THREE.Vector3(Math.cos(sw), 0, Math.sin(sw));
    sails.push({
      geometry: solidSurface({
        nu: 12, nv: 10, axis: [n.x, n.y, n.z],
        point: (u, v) => {
          const a = [mix(B0[0], B1[0], u * 0.97 + 0.015), mix(B0[1] + 0.1, B1[1] + 0.1, u * 0.97 + 0.015), mix(B0[2], B1[2], u * 0.97 + 0.015)];
          const b = [mix(G0[0], G1[0], u * 0.97 + 0.015), mix(G0[1] - 0.1, G1[1] - 0.1, u * 0.97 + 0.015), mix(G0[2], G1[2], u * 0.97 + 0.015)];
          const bulge = 0.5 * Math.sin(Math.PI * u) ** 0.8 * Math.sin(Math.PI * v) ** 0.8;
          return [mix(a[0], b[0], v) + n.x * bulge, mix(a[1], b[1], v), mix(a[2], b[2], v) + n.z * bulge];
        },
        thick: () => 0.028,
      }),
      color: SAIL,
    });
    rig.line(G1, mastPoint(m, m.heights.topHead - 0.8), 0.014, TAR);
    rig.line(B1, G1, 0.009, HEMP);
    rig.line(B1, mastPoint(m, m.heights.top - 1.6), 0.014, TAR);
    rig.line(B1, clRail(-20, 1), 0.012, HEMP);
    rig.line(B1, clRail(-22, 1), 0.012, HEMP);
  }

  // --- the deck: everything clipped to the hull at its own station ---------------------------------------
  const onDeck = (z) => clDeckAt(z);
  const house = (z0, z1, wantHalf, h, color, roofC = 0x9c7a50) => {
    const zc = (z0 + z1) / 2;
    const half = Math.min(wantHalf, Math.min(clDeckHalf(z0), clDeckHalf(z1)) * 0.82);
    const y = Math.max(onDeck(z0), onDeck(z1));
    block(deck, color, half * 2, h, z1 - z0, [0, y + h / 2 - 0.05, zc]);
    block(deck, roofC, half * 2 + 0.22, 0.08, z1 - z0 + 0.22, [0, y + h, zc]);
    return { half, y, top: y + h };
  };
  // The forward house (galley and crew), and the long after cabin.
  const fh = house(4.2, 9.4, 2.4, 1.45, 0xdad5c5);
  const ah = house(-20.3, -13.4, 2.8, 1.5, 0xdad5c5);
  for (const [zz, hs] of [[fh, [4.2, 9.4]], [ah, [-20.3, -13.4]]]) {
    const n = 6;
    for (let i = 0; i < n; i++) {
      const z = mix(hs[0] + 0.7, hs[1] - 0.7, i / (n - 1));
      for (const s of [-1, 1]) {
        block(deck, 0x273038, 0.03, 0.5, 0.44, [s * (zz.half + 0.012), zz.y + 0.82, z]);
        block(deck, 0x6d4f30, 0.02, 0.62, 0.56, [s * (zz.half + 0.006), zz.y + 0.82, z]);
      }
    }
  }
  // A skylight on the after cabin, a galley stack and the ship's boats on their skids.
  block(deck, 0x7a5a36, 1.5, 0.32, 2.3, [0, ah.top + 0.2, -16.8]);
  for (const s of [-1, 1]) {
    block(deck, 0x34424a, 0.02, 0.26, 2.0, [s * 0.76, ah.top + 0.22, -16.8]);
  }
  deck.push({ geometry: spin([[0, 0], [0.15, 0], [0.13, 0.62], [0.17, 0.66], [0.17, 0.74], [0, 0.74]], { segments: 14 }), color: 0x23221f, position: [0.6, fh.top, 8.6] });
  const boat = (x, z) => {
    const g = solidSurface({
      nu: 16, nv: 6,
      point: (u, v) => {
        const a = (u - 0.5) * 2;
        const w = 0.72 * (1 - a * a) ** 0.6;
        const t = (v - 0.5) * 2;
        return [x + t * w, fh.top + 0.34 - (1 - t * t) * 0.34 * (1 - a * a * 0.4) + 0.14 * a * a, z + a * 2.4];
      },
      thick: () => 0.05,
    });
    deck.push({ geometry: g, color: 0xeee9d9 });
    for (const dz of [-1.5, 1.5]) block(deck, 0x4e3820, 1.6, 0.08, 0.14, [x, fh.top + 0.05, z + dz]);
    for (let t = 0; t < 3; t++) block(deck, 0x8c6a42, 1.1, 0.04, 0.2, [x, fh.top + 0.3, z - 1.2 + t * 1.2]);
  };
  boat(-1.0, 6.8);
  boat(1.0, 6.8);
  // Hatches, bitts round every mast, the capstan, the pumps, and the wheel at the stern.
  const hatchAt = (z, w, l) => {
    const half = Math.min(w, clDeckHalf(z) * 0.6);
    const y = onDeck(z);
    block(deck, 0x4e3820, half * 2 + 0.2, 0.2, l + 0.2, [0, y + 0.09, z]);
    block(deck, 0x7d6038, half * 2, 0.08, l, [0, y + 0.22, z]);
    for (let i = 1; i < 4; i++) block(deck, 0x4c3722, half * 2, 0.03, 0.04, [0, y + 0.26, z - l / 2 + (i * l) / 4]);
  };
  hatchAt(-4.5, 1.4, 3.6);
  hatchAt(1.9, 1.4, 2.2);
  hatchAt(10.8, 1.1, 1.6);
  hatchAt(16.2, 0.8, 1.5);
  for (const m of MASTS) {
    const y = onDeck(m.z);
    block(deck, 0x6a4e2e, 2.1, 0.22, 0.16, [0, y + 1.0, m.z + 0.72]);
    for (const s of [-1, 1]) {
      block(deck, 0x6a4e2e, 0.2, 1.2, 0.2, [s * 0.95, y + 0.55, m.z + 0.72]);
      block(deck, 0x2a2218, 0.06, 0.05, 0.42, [s * 0.95, y + 0.82, m.z + 0.72]);
    }
    deck.push({ geometry: spin([[0, 0], [0.62, 0], [0.56, 0.1], [0.44, 0.2], [0, 0.2]], { segments: 22 }), color: 0x6a4e2e, position: [0, y, m.z] });
  }
  {
    const z = 18.1; const y = onDeck(z);
    deck.push({ geometry: spin([[0, 0], [0.34, 0], [0.26, 0.2], [0.22, 0.5], [0.34, 0.58], [0.34, 0.68], [0, 0.72]], { segments: 18 }), color: 0x5b4228, position: [0, y, z] });
  }
  {
    const z = -21.6; const y = onDeck(z);
    const half = Math.min(1.0, clDeckHalf(z) * 0.6);
    deck.push({ geometry: new THREE.TorusGeometry(0.46, 0.042, 8, 26), color: 0x6f4e2c, position: [0, y + 1.0, z] });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      bar(deck, 0x7c5832, [0, y + 1.0, z], [Math.cos(a) * 0.46, y + 1.0 + Math.sin(a) * 0.46, z], 0.03, 0.03);
    }
    block(deck, 0x54391f, half * 0.5, 0.92, 0.2, [0, y + 0.46, z - 0.32]);
    bar(deck, 0x2c2015, [0, y + 1, z], [0, y + 1, z - 0.32], 0.08, 0.08);
    // The binnacle before it.
    deck.push({ geometry: spin([[0, 0], [0.22, 0], [0.18, 0.78], [0.26, 0.8], [0.26, 1.0], [0.1, 1.08], [0, 1.08]], { segments: 14 }), color: 0xa78034, position: [0, y, z + 1.1] });
  }
  // A cathead and an anchor on each bow.
  for (const s of [-1, 1]) {
    const z = 17.8;
    const rail = clRail(z, s);
    spars.push({ geometry: tube([[s * (rail[0] * s - 0.45), rail[1] - 0.15, z - 0.2], [s * (rail[0] * s + 0.55), rail[1] + 0.05, z + 0.25]], [0.13, 0.11], { sides: 9, steps: 2, round: 1, straight: true }), color: 0x1a1612 });
    const ax = s * (rail[0] * s + 0.32);
    const ay = rail[1] - 0.1;
    const az = z + 0.15;
    spars.push({ geometry: tube([[ax, ay, az], [ax, ay - 2.1, az - 0.1]], 0.05, { sides: 8, steps: 2, round: 1, straight: true }), color: 0x2a2826 });
    spars.push({ geometry: tube([[ax - s * 0.0, ay - 2.1, az - 0.1 - 0.52], [ax, ay - 2.25, az - 0.1], [ax, ay - 2.1, az - 0.1 + 0.52]], [0.05, 0.07, 0.05], { sides: 8, steps: 8, round: 1 }), color: 0x2a2826 });
    spars.push({ geometry: tube([[ax, ay - 0.15, az - 0.5], [ax, ay - 0.15, az + 0.4]], 0.04, { sides: 7, steps: 2, round: 1, straight: true }), color: 0x6b5233 });
  }
  // A pinrail along each bulwark and the taffrail's mould.
  for (const s of [-1, 1]) {
    for (const [a, b] of [[-11, -5], [-2.6, 4], [10, 15]]) {
      const z = (a + b) / 2;
      const hw = clDeckHalf(z);
      const y = onDeck(z) + 0.62;
      block(deck, 0x78562f, 0.12, 0.05, b - a, [s * (hw - 0.05), y, z]);
      const n = 7;
      for (let i = 0; i < n; i++) rod(deck, 0x4a3119, [s * (hw - 0.05), y - 0.1, mix(a + 0.3, b - 0.3, i / (n - 1))], [s * (hw - 0.05), y + 0.18, mix(a + 0.3, b - 0.3, i / (n - 1))], 0.02, { sides: 5 });
    }
  }

  // A rudder behind the sternpost, in the same copper below and black above.
  {
    const zb = -19.3 - 0.05;
    const outline = [[0, 0.06], [0.82, 0.14], [0.92, 2.1], [0.66, 3.7], [0, 4.2]];
    const g = extrudeOutline(outline, 0.14, {});
    g.rotateY(Math.PI / 2);
    const copper = lin(0xc56d33);
    tintVertices(g, (x, y, z, out) => {
      if (y < CL.waterline) { out[0] = copper[0]; out[1] = copper[1]; out[2] = copper[2]; } else { out[0] = 0.016; out[1] = 0.016; out[2] = 0.02; }
    });
    spars.push({ geometry: g, keepColor: true, position: [0, 0, zb] });
  }

  // --- the stand: low dark water, with the keel let down into it -------------------------------------------
  const standW = 7.2; const standL = 32.5;
  const standOutline = [];
  {
    const r = 3;
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= 6; i++) {
        const a = a0 + (i / 6) * (Math.PI / 2);
        standOutline.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    corner(standW - r, standL - r, 0);
    corner(-standW + r, standL - r, Math.PI / 2);
    corner(-standW + r, -standL + r, Math.PI);
    corner(standW - r, -standL + r, Math.PI * 1.5);
  }
  const STAND_TOP = 0.32;
  const standG = extrudeOutline(standOutline, STAND_TOP, { uvFeet: true });
  standG.rotateX(Math.PI / 2); // local z becomes y... and local y becomes -z
  standG.translate(0, STAND_TOP / 2, 5.6);
  // The UVs were laid in feet, so the ripples are a real size. The edge is dark and plain.
  const uvS = standG.attributes.uv;
  for (let i = 0; i < uvS.count; i++) uvS.setXY(i, uvS.getX(i) / 9, uvS.getY(i) / 9);

  // --- assemble -----------------------------------------------------------------------------------------
  const [hullG, railG] = clipperHull();
  const hullGeo = mergeParts([{ geometry: hullG, keepColor: true }, { geometry: railG, keepColor: true }]);
  sheen(hullGeo, { add: 0.022, tint: [0.84, 0.9, 1] });
  const sparGeo = mergeParts([...spars, { geometry: rig.geometry(), keepColor: true }]);
  const deckGeo = mergeParts([{ geometry: clipperDeck(), color: 0xb79a6a }, ...deck]);
  const sailGeo = mergeParts(sails);
  // The whole ship is moved aft so its overall length, spars included, is centred on the origin.
  const SHIFT = -5.6;
  for (const g of [hullGeo, sparGeo, deckGeo, sailGeo]) g.translate(0, 0, SHIFT);
  standG.translate(0, 0, SHIFT);
  const plates = clipperPlateMap();
  const planks = clipperPlankMap();
  const sailMap = clipperSailMap();
  const waterMap = clipperWaterMap();
  return groupOf(
    meshFrom(hullGeo, { map: plates, roughness: 0.42, metalness: 0.08 }),
    meshFrom(deckGeo, { map: planks, roughness: 0.82, metalness: 0 }),
    meshFrom(sparGeo, { roughness: 0.62, metalness: 0.05 }),
    meshFrom(sailGeo, { map: sailMap, roughness: 0.92, metalness: 0 }),
    meshFrom(standG, { vertexColors: false, map: waterMap, roughness: 0.38, metalness: 0.1 }),
  );
}

// ---------------------------------------------------------------------------
export const BUILDERS = {
  'clipper-ship': clipperShip,
  'turtle-submarine': turtleSubmarine,
  'sod-house': sodHouse,
  'candlestick-telephone': candlestickTelephone,
  'empire-state-building': empireStateBuilding,
};
