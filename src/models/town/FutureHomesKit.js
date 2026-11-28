// The private toolkit of builders/FutureHomes.js: six imagined homes and towers for Build a Future
// City (vertical farm, forest tower, printed dome home, floating home, sun-tracking skyscraper,
// biodome garden).
//
// THREE IDEAS CARRY IT.
//
//  * BAGS, ONE PER MATERIAL. Every part goes into a named bag with a LINEAR vertex colour; a bag
//    becomes one merged mesh. A model is at most six meshes, and a part that moves by itself is a
//    bag of its own under an inner group, so the root never moves.
//  * NEAR-WHITE TILES MULTIPLIED BY VERTEX COLOUR, UVs IN FEET. A panel seam, a printed concrete
//    layer, a leaf or a paving joint is drawn once on a small canvas and serves every colour.
//  * GLOW IS UNLIT. The glow bag is a MeshBasicMaterial whose vertex colour IS the light colour,
//    over an atlas that is white everywhere except its signs, so one mesh holds every grow light,
//    LED strip and lit sign in a model, each in its own colour, with no point light anywhere.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeParts } from '../../props/LoftKit.js';
import { seededRandom } from '../../PropKit.js';
import { lin, outward, lathe, alongMatrix, tube } from '../ModelKit.js';

export const col = (c) => (Array.isArray(c) ? c : lin(c));
export const shade = (c, k) => { const a = col(c); return [a[0] * k, a[1] * k, a[2] * k]; };
export const blend = (a, b, t) => { const p = col(a); const q = col(b); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; };

// ---------------------------------------------------------------------------------------------
// Canvases. Near-white, so the vertex colour supplies the hue.
// ---------------------------------------------------------------------------------------------
const grey = (v, a = 1) => { const k = Math.max(0, Math.min(255, Math.round(v))); return `rgba(${k},${k},${k},${a})`; };
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Smooth cladding panels: a faint seam every 4ft each way, and a little grain. 4 x 4ft.
function panelCanvas(seed) {
  const rng = seededRandom(seed);
  const S = 256; const cv = canvas(S, S); const ctx = cv.getContext('2d');
  ctx.fillStyle = grey(246); ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) { ctx.fillStyle = grey(rng() < 0.5 ? 228 : 255, 0.3); ctx.fillRect(rng() * S, rng() * S, 1.5, 1.5); }
  ctx.fillStyle = grey(196); ctx.fillRect(0, 0, S, 3); ctx.fillRect(0, 0, 3, S);
  ctx.fillStyle = grey(255, 0.8); ctx.fillRect(0, 3, S, 2); ctx.fillRect(3, 0, 2, S);
  return cv;
}

// Printed concrete: one layer an inch tall, each a rounded bead. The tile is 2ft tall, 24 beads.
// Drawn as a vertical gradient per bead so the bump map has a real profile to light, not a line.
function layerCanvas(seed) {
  const rng = seededRandom(seed);
  const W = 128; const H = 384; const cv = canvas(W, H); const ctx = cv.getContext('2d');
  const beads = 24; const bh = H / beads;
  for (let i = 0; i < beads; i++) {
    const y = i * bh;
    const g = ctx.createLinearGradient(0, y, 0, y + bh);
    const top = 200 + rng() * 8;
    g.addColorStop(0, grey(top - 40)); g.addColorStop(0.22, grey(top + 30)); g.addColorStop(0.55, grey(top + 46));
    g.addColorStop(0.85, grey(top + 14)); g.addColorStop(1, grey(top - 52));
    ctx.fillStyle = g; ctx.fillRect(0, y, W, bh);
  }
  for (let i = 0; i < 2600; i++) { ctx.fillStyle = grey(rng() < 0.5 ? 170 : 255, 0.22); ctx.fillRect(rng() * W, rng() * H, 1, 1); }
  return cv;
}

// Leaves: overlapping pale ellipses with darker gaps, so a crown reads as foliage up close.
function leafCanvas(seed) {
  const rng = seededRandom(seed);
  const S = 256; const cv = canvas(S, S); const ctx = cv.getContext('2d');
  ctx.fillStyle = grey(150); ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 520; i++) {
    const x = rng() * S; const y = rng() * S; const r = 5 + rng() * 9; const a = rng() * Math.PI;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(a);
      ctx.fillStyle = grey(190 + rng() * 65); ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  return cv;
}

// Pavers and coping stone: 2 x 1ft blocks, staggered.
function paverCanvas(seed) {
  const rng = seededRandom(seed);
  const S = 256; const cv = canvas(S, S); const ctx = cv.getContext('2d');
  ctx.fillStyle = grey(176); ctx.fillRect(0, 0, S, S);
  const rows = 4; const rh = S / rows; const bw = S / 2;
  for (let r = 0; r < rows; r++) {
    for (let j = -1; j < 3; j++) {
      const x = j * bw + (r % 2) * bw / 2;
      ctx.fillStyle = grey(222 + rng() * 30); ctx.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
    }
  }
  for (let i = 0; i < 3000; i++) { ctx.fillStyle = grey(rng() < 0.5 ? 180 : 255, 0.25); ctx.fillRect(rng() * S, rng() * S, 1, 1); }
  return cv;
}

// Water: soft ripples, tiling.
function rippleCanvas(seed) {
  const rng = seededRandom(seed);
  const S = 256; const cv = canvas(S, S); const ctx = cv.getContext('2d');
  ctx.fillStyle = grey(222); ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = rng() * S; const y = rng() * S; const r = 8 + rng() * 26;
    for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      ctx.strokeStyle = grey(rng() < 0.5 ? 255 : 196, 0.55); ctx.lineWidth = 2 + rng() * 2;
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, r, r * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  return cv;
}

const TILES = { panel: [panelCanvas, 4, 4], layer: [layerCanvas, 0.6667, 2], leaf: [leafCanvas, 3, 3], paver: [paverCanvas, 2, 2], ripple: [rippleCanvas, 7, 7] };

function tileTexture(cv, data = false) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// The sign atlas: white everywhere but its signs.
// ---------------------------------------------------------------------------------------------
export const SANS = '"Arial Rounded MT Bold", "Trebuchet MS", "Helvetica Neue", Arial, sans-serif';
class Atlas {
  constructor(W = 512, H = 512) {
    this.W = W; this.H = H;
    this.cv = canvas(W, H); this.ctx = this.cv.getContext('2d');
    this.ctx.fillStyle = '#ffffff'; this.ctx.fillRect(0, 0, W, H);
    // the plain texel every flat part samples: bottom right, which the signs (filled from the top)
    // never reach, and which on every tile canvas is inside a panel rather than on a joint
    this.flat = [1 - 10 / W, 10 / H];
    this.x = 8; this.y = 8; this.row = 0;
  }
  alloc(pw, ph) {
    pw = Math.min(this.W - 10, Math.round(pw)); ph = Math.round(ph);
    if (this.x + pw > this.W - 2) { this.x = 8; this.y += this.row + 3; this.row = 0; }
    const at = { x: this.x, y: this.y, w: pw, h: ph };
    this.x += pw + 3; this.row = Math.max(this.row, ph);
    return at;
  }
  uv(r) { const e = 1; return [(r.x + e) / this.W, 1 - (r.y + r.h - e) / this.H, (r.x + r.w - e) / this.W, 1 - (r.y + e) / this.H]; }
  paint(pw, ph, draw) {
    const r = this.alloc(pw, ph); const ctx = this.ctx;
    ctx.save(); ctx.translate(r.x, r.y); ctx.beginPath(); ctx.rect(0, 0, r.w, r.h); ctx.clip();
    draw(ctx, r.w, r.h); ctx.restore();
    return this.uv(r);
  }
  // Text shrunk to fit its measured width, on a background (or none).
  sign(text, aspect, { px = 80, bg = '#10243a', fg = '#ffffff', fill = 0.64, family = SANS, weight = 'bold', stroke = null } = {}) {
    let ph = px; let pw = ph * aspect;
    if (pw > this.W - 12) { pw = this.W - 12; ph = pw / aspect; }
    return this.paint(pw, ph, (ctx, w, h) => {
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
      let size = Math.floor(h * fill);
      ctx.font = `${weight} ${size}px ${family}`;
      const m = ctx.measureText(text).width; const maxW = w - h * 0.35;
      if (m > maxW) { size = Math.floor((size * maxW) / m); ctx.font = `${weight} ${size}px ${family}`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (stroke) { ctx.lineWidth = size * 0.12; ctx.strokeStyle = stroke; ctx.strokeText(text, w / 2, h * 0.54); }
      ctx.fillStyle = fg; ctx.fillText(text, w / 2, h * 0.54);
    });
  }
  texture() {
    const t = new THREE.CanvasTexture(this.cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
    return t;
  }
}

// ---------------------------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------------------------
export class Kit {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = seededRandom(seed);
    this.atlas = new Atlas();
    this.bags = {};
    this.flatUV = {}; // a bag whose map is not the atlas names the texel that is plain white in it
  }

  bag(name) { if (!this.bags[name]) this.bags[name] = []; return this.bags[name]; }

  // Adds a geometry already in place. Options: tint (x, y, z, out, nx, ny, nz), feet ([fu, fv] tile
  // size: UVs projected in feet along the dominant axis), sign (atlas rect on the +Z face, or on the
  // face whose normal is `signAxis`), keepUV.
  add(bag, geometry, color, { tint = null, feet = null, sign = null, signAxis = [0, 0, 1], keepUV = false, matrix = null, flip = true } = {}) {
    let g = geometry;
    if (sign && g.index) g = g.toNonIndexed();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (flip) g = outward(g);
    if (sign) this._signUV(g, sign, signAxis);
    else if (feet) this._projectUV(g, feet);
    else if (!keepUV) this._flatUV(g, bag);
    this._color(g, color, tint);
    this.bag(bag).push({ geometry: g, keepColor: true });
    return g;
  }

  _flatUV(g, bag) {
    const f = this.flatUV[bag] ?? this.atlas.flat;
    const n = g.attributes.position.count; const arr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { arr[i * 2] = f[0]; arr[i * 2 + 1] = f[1]; }
    g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  }

  _projectUV(g, feet) {
    const P = g.attributes.position; const N = g.attributes.normal;
    const arr = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i)); const nz = Math.abs(N.getZ(i));
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      let u; let v;
      if (ny > nx && ny > nz) { u = x; v = z; } else if (nx > nz) { u = z; v = y; } else { u = x; v = y; }
      arr[i * 2] = u / feet[0]; arr[i * 2 + 1] = v / feet[1];
    }
    g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  }

  // A cylindrical projection about the vertical axis through (cx, cz): u round, v up, in feet.
  cylUV(g, feet, cx = 0, cz = 0, R = 10) {
    const P = g.attributes.position; const arr = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      const a = Math.atan2(P.getX(i) - cx, P.getZ(i) - cz);
      arr[i * 2] = (a * R) / feet[0]; arr[i * 2 + 1] = P.getY(i) / feet[1];
    }
    g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
    return g;
  }

  _signUV(g, rect, axis) {
    const P = g.attributes.position; const N = g.attributes.normal;
    const A = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
    // the sign's right and up in the plane facing A
    const up = Math.abs(A.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, A).normalize();
    const up2 = new THREE.Vector3().crossVectors(A, right).normalize();
    let r0 = Infinity; let r1 = -Infinity; let u0 = Infinity; let u1 = -Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      p.fromBufferAttribute(P, i);
      const r = p.dot(right); const u = p.dot(up2);
      r0 = Math.min(r0, r); r1 = Math.max(r1, r); u0 = Math.min(u0, u); u1 = Math.max(u1, u);
    }
    const arr = new Float32Array(P.count * 2); const n = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) {
      n.fromBufferAttribute(N, i); p.fromBufferAttribute(P, i);
      if (n.dot(A) > 0.7) {
        const s = (p.dot(right) - r0) / Math.max(1e-6, r1 - r0); const t = (p.dot(up2) - u0) / Math.max(1e-6, u1 - u0);
        arr[i * 2] = rect[0] + (rect[2] - rect[0]) * s; arr[i * 2 + 1] = rect[1] + (rect[3] - rect[1]) * t;
      } else { arr[i * 2] = this.atlas.flat[0]; arr[i * 2 + 1] = this.atlas.flat[1]; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  }

  _color(g, color, tint) {
    const P = g.attributes.position; const N = g.attributes.normal;
    const arr = new Float32Array(P.count * 3);
    const c = col(color); const out = [0, 0, 0];
    for (let i = 0; i < P.count; i++) {
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
      if (tint) tint(P.getX(i), P.getY(i), P.getZ(i), out, N.getX(i), N.getY(i), N.getZ(i), i);
      arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  // ---- primitives, in world (or group-local) feet -----------------------------------------
  box(bag, color, x0, x1, y0, y1, z0, z1, opts = {}) {
    const dx = Math.abs(x1 - x0); const dy = Math.abs(y1 - y0); const dz = Math.abs(z1 - z0);
    if (dx < 1e-4 || dy < 1e-4 || dz < 1e-4) return null;
    const g = new THREE.BoxGeometry(dx, dy, dz);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return this.add(bag, g, color, opts);
  }

  // A box w x h in section whose length runs from a to b.
  bar(bag, color, a, b, w, h, opts = {}) {
    const { m, len } = alongMatrix(a, b, opts.up ?? [0, 1, 0]);
    if (len < 1e-4) return null;
    const g = new THREE.BoxGeometry(w, h, len); g.translate(0, 0, len / 2); g.applyMatrix4(m);
    return this.add(bag, g, color, opts);
  }

  rod(bag, color, a, b, r, opts = {}) {
    const { m, len } = alongMatrix(a, b, [0, 1, 0]);
    if (len < 1e-4) return null;
    const g = new THREE.CylinderGeometry(opts.r2 ?? r, r, len, opts.sides ?? 8, 1);
    g.rotateX(Math.PI / 2); g.translate(0, 0, len / 2); g.applyMatrix4(m);
    return this.add(bag, g, color, opts);
  }

  cyl(bag, color, x, z, y0, y1, r, opts = {}) {
    const g = new THREE.CylinderGeometry(opts.r2 ?? r, r, y1 - y0, opts.sides ?? 16, opts.rows ?? 1);
    g.translate(x, (y0 + y1) / 2, z);
    return this.add(bag, g, color, opts);
  }

  ball(bag, color, x, y, z, r, opts = {}) {
    let g;
    if (opts.detail != null) {
      g = new THREE.IcosahedronGeometry(r, opts.detail);
      g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g); g.computeVertexNormals();
    } else g = new THREE.SphereGeometry(r, opts.w ?? 10, opts.h ?? 7);
    if (opts.scale) g.scale(opts.scale[0], opts.scale[1], opts.scale[2]);
    g.translate(x, y, z);
    return this.add(bag, g, color, opts);
  }

  // A closed lathe from a bottom-up profile [[r, y], ...] that starts and ends on the axis.
  turned(bag, color, profile, x, y, z, opts = {}) {
    const g = lathe(profile, opts.sides ?? 24);
    if (opts.scale) g.scale(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (opts.rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(opts.rot[0], opts.rot[1], opts.rot[2])));
    g.translate(x, y, z);
    return this.add(bag, g, color, opts);
  }

  // A plan outline [[x, z], ...] (any winding) extruded straight up from y0 to y1, with holes.
  slab(bag, color, poly, y0, y1, opts = {}) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1])));
    for (const h of opts.holes ?? []) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], -p[1]))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
    return this.add(bag, g, color, opts);
  }

  // An outline in the (x, y) plane extruded along z from z0 to z1, then placed by `matrix`.
  prism(bag, color, pts, z0, z1, opts = {}) {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    for (const h of opts.holes ?? []) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, z0);
    return this.add(bag, g, color, opts);
  }

  tube(bag, color, points, radii, opts = {}) {
    const g = tube(points, radii, { sides: opts.sides ?? 8, steps: opts.steps ?? null, round: opts.round ?? 1, section: opts.section ?? null, frame: opts.frame ?? null });
    return this.add(bag, g, color, opts);
  }

  has(name) { return (this.bags[name] ?? []).length > 0; }

  // One merged mesh from a bag. kind: 'std' (vertex colours), with optional tile; 'glow' (unlit,
  // over the atlas); 'clear' (the one transparent mesh).
  mesh(name, { tile = null, rough = 0.7, metal = 0, bump = 0.6, glow = false, clear = false, opacity = 0.3, cast = true, receive = true, side = THREE.FrontSide, flatShading = false, bumpTile = null } = {}) {
    const parts = this.bags[name];
    if (!parts || !parts.length) return null;
    const geometry = mergeParts(parts);
    let material;
    if (glow) {
      material = new THREE.MeshBasicMaterial({ vertexColors: true, map: this.atlas.texture(), toneMapped: false });
    } else {
      const params = { vertexColors: true, roughness: rough, metalness: metal, side, flatShading };
      if (tile) {
        const [fn] = TILES[tile];
        const cv = fn(this.seed * 7 + tile.length);
        params.map = tileTexture(cv);
        if (bump) { params.bumpMap = tileTexture(cv, true); params.bumpScale = bump; }
      } else if (name !== 'water' && !clear) {
        params.map = this.atlas.texture();
      }
      if (bumpTile && !tile) { const cv = TILES[bumpTile][0](this.seed * 3 + 1); params.bumpMap = tileTexture(cv, true); params.bumpScale = bump; }
      if (clear) Object.assign(params, { transparent: true, opacity, depthWrite: false, map: null });
      material = new THREE.MeshStandardMaterial(params);
    }
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = cast && !glow && !clear;
    m.receiveShadow = receive && !glow;
    m.name = name;
    return m;
  }
}

// ---------------------------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------------------------

// A rounded rectangle plan, centred, as [[x, z], ...] counter-clockwise seen from above.
export function roundRect(hx, hz, r, steps = 5) {
  const pts = [];
  const corners = [[hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2], [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

// A closed plan outline by polar function r(a), n points.
export function polar(n, rf, cx = 0, cz = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const r = rf(a); pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}

// A rounded-square ring as polar radii, for a plan that is "a square with soft corners".
export function squircle(a, h, p = 4) {
  const c = Math.abs(Math.cos(a)); const s = Math.abs(Math.sin(a));
  return h / Math.pow(Math.pow(c, p) + Math.pow(s, p), 1 / p);
}

// A low, round-crowned tree: a trunk tube and two or three lumpy blobs. Returns nothing.
export function lumpy(d, ph) {
  return Math.sin(d.x * 3.1 + ph) * Math.cos(d.z * 2.7 - ph * 0.6) * 0.5
    + Math.sin(d.y * 4.3 + d.x * 2.2 + ph * 1.7) * 0.35
    + Math.cos(d.z * 5.2 - d.y * 1.9 + ph * 0.4) * 0.22;
}

export function blob(c, R, { squash = 0.8, detail = 1, ph = 0, base = 0x3fa34d, rough = 0.18, under = 0.62 } = {}) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const P = g.attributes.position; const d = new THREE.Vector3();
  const colArr = new Float32Array(P.count * 3); const bc = col(base);
  for (let i = 0; i < P.count; i++) {
    d.set(P.getX(i), P.getY(i), P.getZ(i)).normalize();
    const k = 1 + lumpy(d, ph) * rough;
    P.setXYZ(i, c[0] + d.x * R * k, c[1] + d.y * R * k * squash, c[2] + d.z * R * k);
    const s = under + (1 - under) * Math.max(0, Math.min(1, d.y * 0.5 + 0.55));
    colArr[i * 3] = bc[0] * s; colArr[i * 3 + 1] = bc[1] * s; colArr[i * 3 + 2] = bc[2] * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
  g.computeVertexNormals();
  return g;
}

// Pushes a pre-coloured geometry into a bag with UVs projected in feet.
export function addColored(K, bag, g, feet = [3, 3]) {
  K._projectUV(g, feet);
  K.bag(bag).push({ geometry: outward(g), keepColor: true });
}
