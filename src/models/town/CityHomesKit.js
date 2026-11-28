// The private toolkit of builders/CityHomes.js: six city buildings (row house, apartment building,
// office tower, corner grocery, diner, post office) built from one set of parts.
//
// THREE IDEAS CARRY IT.
//
//  * A FACE IS A FRAME. Every wall element is authored in a wall's own frame -- u along the wall,
//    y up, n straight out of it -- and `face()` turns that into world space. So one `window()`
//    serves the front, the back, both sides and a canted bay, and a window is built FORWARD of a
//    solid wall the same way on every one of them (dark pane a hair proud, frame proud of that,
//    sill furthest out). The frames are pure rotations, so nothing is ever mirrored inside out.
//  * ONE MESH PER MATERIAL, at most six: brick, stone, paint, metal, glass and one spare (clear
//    glass for a shop window or a glow for a neon sign). Brick and stone are near-white tiles
//    multiplied by vertex colour with their UVs projected in FEET after the part is placed, so
//    courses line up round every corner of every building. Paint uses an atlas that is white
//    everywhere except its signs, so a painted part is simply its vertex colour.
//  * EVERY PART IS A CLOSED SOLID. Boxes, closed lathes, extruded outlines. Nothing is a plane.

import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeParts } from '../../props/LoftKit.js';
import { seededRandom } from '../../PropKit.js';
import { lin, outward, lathe, alongMatrix } from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Colour, in LINEAR (a vertex colour is linear; an sRGB number written straight in is a stop pale)
// ---------------------------------------------------------------------------------------------
export const col = (c) => (Array.isArray(c) ? c : lin(c));
export const shade = (c, k) => { const a = col(c); return [a[0] * k, a[1] * k, a[2] * k]; };
export const blend = (a, b, t) => { const p = col(a); const q = col(b); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]; };

// ---------------------------------------------------------------------------------------------
// Faces: u along the wall, y up, n out of it. u x y = n, so the basis is a rotation.
// ---------------------------------------------------------------------------------------------
export function face(origin, u) {
  const U = new THREE.Vector3(u[0], 0, u[2]).normalize();
  const Y = new THREE.Vector3(0, 1, 0);
  const N = new THREE.Vector3().crossVectors(U, Y);
  const m = new THREE.Matrix4().makeBasis(U, Y, N);
  m.setPosition(origin[0], origin[1], origin[2]);
  return { m, U, N, o: origin };
}
export const WORLD = face([0, 0, 0], [1, 0, 0]);
// The four walls of a footprint x in [-hx, hx], z in [-hz, hz], each with u running left to right
// as seen from outside.
export function walls(hx, hz) {
  return {
    front: face([0, 0, hz], [1, 0, 0]),
    back: face([0, 0, -hz], [-1, 0, 0]),
    right: face([hx, 0, 0], [0, 0, -1]),
    left: face([-hx, 0, 0], [0, 0, 1]),
  };
}

// ---------------------------------------------------------------------------------------------
// Tiles. Near-white, so the vertex colour supplies the hue.
// ---------------------------------------------------------------------------------------------
const grey = (v, a = 1) => { const k = Math.max(0, Math.min(255, Math.round(v))); return `rgba(${k},${k},${k},${a})`; };
const warm = (v, w, a = 1) => `rgba(${Math.round(Math.min(255, v + w))},${Math.round(v)},${Math.round(Math.max(0, v - w))},${a})`;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tileTexture(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Common bond: 8in x 2 2/3in modular brick, a header course every sixth. 4ft square, 18 courses.
function brickCanvas(seed) {
  const rng = seededRandom(seed);
  const W = 384; const H = 384;
  const cv = canvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = grey(168);
  ctx.fillRect(0, 0, W, H);
  const rows = 18; const rowPx = H / rows; const bw = W / 6;
  for (let i = 0; i < rows; i++) {
    const header = i % 6 === 0;
    const w = header ? bw / 2 : bw;
    const off = header ? 0 : (i % 2) * bw * 0.5;
    const n = Math.ceil(W / w) + 1;
    for (let j = -1; j < n; j++) {
      const v = 206 + rng() * 44;
      ctx.fillStyle = warm(v, (rng() - 0.4) * 9);
      const x = off + j * w;
      ctx.fillRect(x + 1.4, i * rowPx + 1.3, w - 2.6, rowPx - 2.4);
      // a darker fired end now and then, which is what stops a brick wall reading as wallpaper
      if (rng() < 0.12) { ctx.fillStyle = grey(150, 0.35); ctx.fillRect(x + 1.4, i * rowPx + 1.3, w * 0.3, rowPx - 2.4); }
    }
  }
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = grey(rng() < 0.5 ? 140 : 255, 0.18);
    ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 1.5, 1);
  }
  return cv;
}

// Ashlar: 2ft courses of 4ft blocks over an 8 x 4 tile, faint joints and fine grain.
function stoneCanvas(seed) {
  const rng = seededRandom(seed);
  const W = 256; const H = 128;
  const cv = canvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = grey(212);
  ctx.fillRect(0, 0, W, H);
  for (let r = 0; r < 2; r++) {
    for (let j = -1; j < 3; j++) {
      const x = j * 128 + (r % 2) * 64;
      ctx.fillStyle = warm(236 + rng() * 14, 2);
      ctx.fillRect(x + 1.2, r * 64 + 1.2, 128 - 2.4, 64 - 2.4);
    }
  }
  for (let i = 0; i < 3200; i++) {
    ctx.fillStyle = grey(rng() < 0.5 ? 190 : 255, 0.25);
    ctx.fillRect(rng() * W, rng() * H, 1, 1);
  }
  return cv;
}

// ---------------------------------------------------------------------------------------------
// The atlas: white everywhere but its signs. A flat part takes the patch in its corner.
// ---------------------------------------------------------------------------------------------
class Atlas {
  constructor(W = 1024, H = 1024) {
    this.W = W; this.H = H;
    this.cv = canvas(W, H);
    this.ctx = this.cv.getContext('2d');
    this.ctx.fillStyle = grey(248);
    this.ctx.fillRect(0, 0, W, H);
    this.flat = [4 / W, 1 - 4 / H];
    this.x = 12; this.y = 0; this.row = 12;
  }

  alloc(pw, ph) {
    pw = Math.min(this.W - 2, Math.round(pw)); ph = Math.round(ph);
    if (this.x + pw > this.W) { this.x = 0; this.y += this.row + 3; this.row = 0; }
    const at = { x: this.x, y: this.y, w: pw, h: ph };
    this.x += pw + 3;
    this.row = Math.max(this.row, ph);
    return at;
  }

  uv(r) {
    const e = 1.5;
    return [(r.x + e) / this.W, 1 - (r.y + r.h - e) / this.H, (r.x + r.w - e) / this.W, 1 - (r.y + e) / this.H];
  }

  // Draws into a fresh rect and returns its UVs.
  paint(pw, ph, draw) {
    const r = this.alloc(pw, ph);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.beginPath();
    ctx.rect(0, 0, r.w, r.h);
    ctx.clip();
    draw(ctx, r.w, r.h);
    ctx.restore();
    return this.uv(r);
  }

  // A sign `aspect` wide per unit tall, the text shrunk to fit its measured width.
  sign(text, aspect, { px = 96, bg = '#1d3c5e', fg = '#f3ead2', border = null, font = 'bold', family = 'Georgia, "Times New Roman", serif', fill = 0.6, shadow = null, sub = null } = {}) {
    let ph = px; let pw = ph * aspect;
    if (pw > this.W - 4) { pw = this.W - 4; ph = pw / aspect; }
    return this.paint(pw, ph, (ctx, w, h) => {
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
      if (border) { ctx.strokeStyle = border; ctx.lineWidth = Math.max(2, h * 0.06); ctx.strokeRect(h * 0.07, h * 0.07, w - h * 0.14, h - h * 0.14); }
      const lines = sub ? [text, sub] : [text];
      const room = sub ? [0.56, 0.3] : [fill];
      let y = sub ? h * 0.37 : h * 0.53;
      lines.forEach((line, k) => {
        let size = Math.floor(h * room[k]);
        ctx.font = `${font} ${size}px ${family}`;
        const m = ctx.measureText(line).width;
        const maxW = w - h * 0.4;
        if (m > maxW) { size = Math.floor((size * maxW) / m); ctx.font = `${font} ${size}px ${family}`; }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (shadow) { ctx.fillStyle = shadow; ctx.fillText(line, w / 2 + size * 0.05, y + size * 0.05); }
        ctx.fillStyle = fg;
        ctx.fillText(line, w / 2, y);
        y += h * (sub ? 0.36 : 0);
      });
    });
  }

  texture() {
    const t = new THREE.CanvasTexture(this.cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }
}

// ---------------------------------------------------------------------------------------------
// The build: bags of parts, one per material
// ---------------------------------------------------------------------------------------------
const KINDS = {
  brick: { tile: 'brick', feet: [4, 4], mat: { roughness: 0.93, bumpScale: 1.4 } },
  stone: { tile: 'stone', feet: [8, 4], mat: { roughness: 0.86, bumpScale: 0.8 } },
  paint: { atlas: true, mat: { roughness: 0.72 } },
  metal: { mat: { roughness: 0.4, metalness: 0.45 } },
  glass: { mat: { roughness: 0.16, metalness: 0.3 } },
  clear: { mat: { roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false }, noShadow: true },
  glow: { atlas: true, glow: true, mat: { roughness: 0.5 } },
};

export class Build {
  constructor(seed = 1) {
    this.seed = seed;
    this.rng = seededRandom(seed);
    this.atlas = new Atlas();
    this.bags = {};
    for (const k of Object.keys(KINDS)) this.bags[k] = [];
    this.tiles = {};
  }

  // Adds a local geometry. Options: f (face), matrix (local placement before the face), tint
  // (x, y, z, out, nx, ny, nz) in world space, sign (an atlas rect on the local +Z face), uv.
  add(bag, geometry, color, { f = WORLD, matrix = null, tint = null, sign = null, signBack = false, uv = 'auto', crease = null, flip = false, warp = null } = {}) {
    let g = geometry;
    if (g.index && (sign || crease)) g = g.toNonIndexed();
    const kind = KINDS[bag];
    if (sign) this._signUV(g, sign, signBack);
    if (warp) {
      const P = g.attributes.position;
      for (let i = 0; i < P.count; i++) { const p = warp(P.getX(i), P.getY(i), P.getZ(i)); P.setXYZ(i, p[0], p[1], p[2]); }
      g.computeVertexNormals();
    }
    if (matrix) g.applyMatrix4(matrix);
    g.applyMatrix4(f.m);
    if (crease) g = toCreasedNormals(g, crease);
    if (flip) g = outward(g);
    if (!sign && uv === 'auto') {
      if (kind.tile) this._projectUV(g, kind.feet);
      else if (kind.atlas) this._flatUV(g);
    }
    this._color(g, color, tint);
    this.bags[bag].push({ geometry: g, keepColor: true });
    return g;
  }

  _signUV(g, rect, back = false) {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const P = g.attributes.position; const N = g.attributes.normal;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(P.count * 2), 2));
    const UV = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      if (N.getZ(i) > 0.5 || (back && N.getZ(i) < -0.5)) {
        const s = (P.getX(i) - bb.min.x) / Math.max(1e-6, bb.max.x - bb.min.x);
        const t = (P.getY(i) - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
        UV.setXY(i, rect[0] + (rect[2] - rect[0]) * s, rect[1] + (rect[3] - rect[1]) * t);
      } else UV.setXY(i, this.atlas.flat[0], this.atlas.flat[1]);
    }
  }

  _flatUV(g) {
    const P = g.attributes.position;
    const arr = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) { arr[i * 2] = this.atlas.flat[0]; arr[i * 2 + 1] = this.atlas.flat[1]; }
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

  _color(g, color, tint) {
    const P = g.attributes.position; const N = g.attributes.normal;
    const arr = new Float32Array(P.count * 3);
    const c = col(color);
    const out = [0, 0, 0];
    for (let i = 0; i < P.count; i++) {
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
      if (tint) tint(P.getX(i), P.getY(i), P.getZ(i), out, N.getX(i), N.getY(i), N.getZ(i), i);
      arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }

  // ---- primitives, all in the face's frame --------------------------------------------------
  box(bag, color, u, y, n, opts = {}) {
    const du = Math.abs(u[1] - u[0]); const dy = Math.abs(y[1] - y[0]); const dn = Math.abs(n[1] - n[0]);
    if (du < 1e-4 || dy < 1e-4 || dn < 1e-4) return null;
    const s = opts.segs ?? [1, 1, 1];
    const g = new THREE.BoxGeometry(du, dy, dn, s[0], s[1], s[2]);
    g.translate((u[0] + u[1]) / 2, (y[0] + y[1]) / 2, (n[0] + n[1]) / 2);
    return this.add(bag, g, color, opts);
  }

  // A box whose long axis (its local z) runs from a to b. w across, h up.
  bar(bag, color, a, b, w, h, opts = {}) {
    const { m, len } = alongMatrix(a, b, opts.up ?? [0, 1, 0]);
    if (len < 1e-4) return null;
    const g = new THREE.BoxGeometry(w, h, len);
    g.translate(0, 0, len / 2);
    return this.add(bag, g, color, { ...opts, matrix: opts.matrix ? opts.matrix.clone().multiply(m) : m });
  }

  rod(bag, color, a, b, r, opts = {}) {
    const { m, len } = alongMatrix(a, b, [0, 1, 0]);
    if (len < 1e-4) return null;
    const g = new THREE.CylinderGeometry(opts.r2 ?? r, r, len, opts.sides ?? 8, 1);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, len / 2);
    return this.add(bag, g, color, { ...opts, matrix: opts.matrix ? opts.matrix.clone().multiply(m) : m });
  }

  // Vertical cylinder standing at (u, n) in the face's frame.
  post(bag, color, u, n, y0, y1, r, opts = {}) {
    const g = new THREE.CylinderGeometry(opts.r2 ?? r, r, y1 - y0, opts.sides ?? 10, 1);
    g.translate(u, (y0 + y1) / 2, n);
    return this.add(bag, g, color, opts);
  }

  // Closed lathe from a bottom-up profile [[r, y], ...] that starts and ends on the axis.
  turned(bag, color, profile, u, y, n, opts = {}) {
    const g = lathe(profile, opts.sides ?? 16);
    if (opts.scale) g.scale(opts.scale[0], opts.scale[1], opts.scale[2]);
    if (opts.rotate) g.rotateX(opts.rotate);
    g.translate(u, y, n);
    return this.add(bag, g, color, opts);
  }

  ball(bag, color, u, y, n, r, opts = {}) {
    const g = new THREE.SphereGeometry(r, opts.w ?? 8, opts.h ?? 6);
    if (opts.scale) g.scale(opts.scale[0], opts.scale[1], opts.scale[2]);
    g.translate(u, y, n);
    return this.add(bag, g, color, opts);
  }

  // An outline in the face's (u, y) plane extruded along n from n0 to n1.
  prism(bag, color, pts, n0, n1, opts = {}) {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: n1 - n0, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, n0);
    return this.add(bag, g, color, { crease: opts.smooth ? Math.PI / 5 : null, ...opts, flip: true });
  }

  // A plan outline [[x, z], ...] extruded straight up from y0 to y1, in world space.
  slab(bag, color, poly, y0, y1, opts = {}) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p[0], -p[1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return this.add(bag, g, color, { ...opts, flip: true });
  }

  // A floor slab whose top is a checker of tiles: one closed box, coloured per triangle.
  checker(bag, x0, x1, z0, z1, y0, y1, tile, a, b, opts = {}) {
    const nx = Math.max(1, Math.round((x1 - x0) / tile)); const nz = Math.max(1, Math.round((z1 - z0) / tile));
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, nx, 1, nz).toNonIndexed();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const ca = col(a); const cb = col(b);
    const P = g.attributes.position;
    const tri = [];
    for (let i = 0; i < P.count; i += 3) {
      const cx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3;
      const cz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
      tri.push((Math.floor((cx - x0) / tile + 1e-3) + Math.floor((cz - z0) / tile + 1e-3)) % 2 === 0);
    }
    return this.add(bag, g, a, { ...opts, tint: (x, y, z, out, nx, ny, nz, i) => {
      const c = tri[Math.floor(i / 3)] ? ca : cb;
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    } });
  }

  // ---- assembly ----------------------------------------------------------------------------
  assemble() {
    const group = new THREE.Group();
    const order = ['brick', 'stone', 'paint', 'metal', 'glass', 'clear', 'glow'];
    for (const name of order) {
      const parts = this.bags[name];
      if (!parts.length) continue;
      const kind = KINDS[name];
      const geometry = outward(mergeParts(parts));
      const params = { vertexColors: true, ...kind.mat };
      if (kind.tile) {
        const cv = kind.tile === 'brick' ? brickCanvas(this.seed + 3) : stoneCanvas(this.seed + 7);
        const t = tileTexture(cv);
        params.map = t;
        params.bumpMap = t;
      } else if (kind.atlas) {
        params.map = this.atlas.texture();
        if (kind.glow) {
          params.emissiveMap = this.atlas.texture();
          params.emissive = new THREE.Color(this.glowColor ?? 0xffffff);
          params.emissiveIntensity = 1.1;
        }
      }
      const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(params));
      m.castShadow = !kind.noShadow;
      m.receiveShadow = true;
      m.name = name;
      group.add(m);
    }
    return group;
  }
}

// ---------------------------------------------------------------------------------------------
// Architecture
// ---------------------------------------------------------------------------------------------

// A wall from u0..u1, y0..y1, n0..n1 with rectangular holes, tiled into boxes so nothing overlaps.
export function holedWall(B, bag, color, f, u0, u1, y0, y1, n0, n1, holes = [], opts = {}) {
  const us = new Set([u0, u1]);
  for (const h of holes) { us.add(Math.max(u0, Math.min(u1, h.u0))); us.add(Math.max(u0, Math.min(u1, h.u1))); }
  const cuts = [...us].sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i]; const b = cuts[i + 1];
    if (b - a < 1e-4) continue;
    const mid = (a + b) / 2;
    const spans = holes.filter((h) => h.u0 < mid && h.u1 > mid).map((h) => [Math.max(y0, h.y0), Math.min(y1, h.y1)]).sort((p, q) => p[0] - q[0]);
    let y = y0;
    for (const [s, e] of spans) {
      if (s > y) B.box(bag, color, [a, b], [y, s], [n0, n1], { ...opts, f });
      y = Math.max(y, e);
    }
    if (y < y1) B.box(bag, color, [a, b], [y, y1], [n0, n1], { ...opts, f });
  }
}

// A window built forward of a solid wall at n = 0. Returns nothing; everything goes in the bags.
export function windowAt(B, f, uc, y0, w, h, {
  frame = 0xece7dc, cols = 1, rows = 2, sash = true, sill = 'stone', sillColor = 0xd8cdb4, lintel = 'stone', lintelColor = 0xd8cdb4,
  keystone = false, glass = 0x26394a, frameW = 0.24, lintelH = 0.7, out = 0, glassBag = 'glass', glassTint = null, hood = false,
} = {}) {
  const u0 = uc - w / 2; const u1 = uc + w / 2;
  const o = out;
  // the sky in the glass: lighter at the head, which is what makes an opaque pane read as glass
  const gy0 = y0; const gh = h;
  const sky = glassTint ?? ((x, y, z, c) => { const k = 0.8 + 0.55 * Math.max(0, Math.min(1, (y - gy0) / gh)); c[0] *= k; c[1] *= k; c[2] *= k * 1.04; });
  B.box(glassBag, glass, [u0 + 0.05, u1 - 0.05], [y0 + 0.05, y0 + h - 0.05], [o - 0.12, o + 0.03], { f, tint: sky });
  // frame: jambs, head and bottom rail
  B.box('paint', frame, [u0, u0 + frameW], [y0, y0 + h], [o - 0.1, o + 0.13], { f });
  B.box('paint', frame, [u1 - frameW, u1], [y0, y0 + h], [o - 0.1, o + 0.13], { f });
  B.box('paint', frame, [u0 + frameW, u1 - frameW], [y0 + h - frameW, y0 + h], [o - 0.1, o + 0.13], { f });
  B.box('paint', frame, [u0 + frameW, u1 - frameW], [y0, y0 + frameW * 0.8], [o - 0.1, o + 0.13], { f });
  // sash: a meeting rail and glazing bars
  const ym = y0 + h * 0.5;
  if (sash) B.box('paint', frame, [u0 + frameW, u1 - frameW], [ym - 0.09, ym + 0.09], [o - 0.05, o + 0.11], { f });
  const iw = w - frameW * 2;
  for (let c = 1; c < cols; c++) {
    const x = u0 + frameW + (iw * c) / cols;
    B.box('paint', frame, [x - 0.045, x + 0.045], [y0 + frameW, y0 + h - frameW], [o - 0.05, o + 0.08], { f });
  }
  if (rows > 2 || (!sash && rows > 1)) {
    const half = sash ? [[y0 + frameW, ym], [ym, y0 + h - frameW]] : [[y0 + frameW, y0 + h - frameW]];
    const per = sash ? rows / 2 : rows;
    for (const [a, b] of half) {
      for (let r = 1; r < per; r++) {
        const y = a + ((b - a) * r) / per;
        B.box('paint', frame, [u0 + frameW, u1 - frameW], [y - 0.045, y + 0.045], [o - 0.05, o + 0.08], { f });
      }
    }
  }
  if (sill) B.box(sill, sillColor, [u0 - 0.3, u1 + 0.3], [y0 - 0.32, y0 + 0.02], [o - 0.12, o + 0.42], { f });
  if (lintel) {
    B.box(lintel, lintelColor, [u0 - 0.35, u1 + 0.35], [y0 + h, y0 + h + lintelH], [o - 0.12, o + 0.16], { f });
    if (keystone) B.box(lintel, shade(lintelColor, 0.97), [uc - 0.42, uc + 0.42], [y0 + h - 0.1, y0 + h + lintelH + 0.25], [o - 0.12, o + 0.3], { f });
    if (hood) {
      B.box(lintel, lintelColor, [u0 - 0.6, u1 + 0.6], [y0 + h + lintelH, y0 + h + lintelH + 0.28], [o - 0.12, o + 0.42], { f });
    }
  }
}

// A panelled door leaf standing in an opening (or against a wall) from u0..u1, y0..y1, at n.
export function doorLeaf(B, f, u0, u1, y0, y1, n, color, { glazed = false, panels = 2, knob = 0xc9a24a, kick = null } = {}) {
  const t = 0.16;
  B.box('paint', color, [u0, u1], [y0, y1], [n - t / 2, n + t / 2], { f });
  const w = u1 - u0; const h = y1 - y0;
  const mx = Math.min(0.35, w * 0.16);
  // raised panels (or a glazed upper half)
  const rowsY = [];
  if (glazed) {
    B.box('glass', 0x26394a, [u0 + mx, u1 - mx], [y0 + h * 0.48, y1 - mx], [n - t / 2 - 0.02, n + t / 2 + 0.02], { f });
    rowsY.push([y0 + mx * 1.4, y0 + h * 0.42]);
  } else {
    const ph = (h - mx * (panels + 1)) / panels;
    for (let k = 0; k < panels; k++) rowsY.push([y0 + mx + k * (ph + mx), y0 + mx + k * (ph + mx) + ph]);
  }
  for (const [a, b] of rowsY) {
    B.box('paint', shade(color, 1.08), [u0 + mx, u1 - mx], [a, b], [n + t / 2 - 0.01, n + t / 2 + 0.05], { f });
    B.box('paint', shade(color, 0.85), [u0 + mx - 0.05, u1 - mx + 0.05], [a - 0.05, b + 0.05], [n + t / 2 - 0.01, n + t / 2 + 0.02], { f });
  }
  B.ball('metal', knob, u1 - 0.32, y0 + 3.1, n + t / 2 + 0.08, 0.09, { f, w: 8, h: 6 });
  if (kick) B.box('metal', kick, [u0 + 0.1, u1 - 0.1], [y0 + 0.1, y0 + 0.75], [n + t / 2, n + t / 2 + 0.02], { f });
}

// A casing round an opening, built forward of the wall.
export function casing(B, bag, color, f, u0, u1, y0, y1, { w = 0.4, out = 0.18, head = 0.55 } = {}) {
  B.box(bag, color, [u0 - w, u0], [y0, y1], [-0.1, out], { f });
  B.box(bag, color, [u1, u1 + w], [y0, y1], [-0.1, out], { f });
  B.box(bag, color, [u0 - w - 0.1, u1 + w + 0.1], [y1, y1 + head], [-0.1, out + 0.05], { f });
}

// A band round a rectangular footprint, projecting `out` from every wall. The front and back run the
// full width and the sides stop between them, so no two boxes share a top face at a corner.
export function band(B, bag, color, hx, hz, y0, y1, out, { inset = 0.3, sides = 'all', tint = null } = {}) {
  const X = hx + out; const Z = hz + out;
  const has = (s) => sides === 'all' || sides.includes(s);
  if (has('front')) B.box(bag, color, [-X, X], [y0, y1], [hz - inset, Z], { tint });
  if (has('back')) B.box(bag, color, [-X, X], [y0, y1], [-Z, -hz + inset], { tint });
  const za = has('back') ? -hz + inset : -Z; const zb = has('front') ? hz - inset : Z;
  if (has('right')) B.box(bag, color, [hx - inset, X], [y0, y1], [za, zb], { tint });
  if (has('left')) B.box(bag, color, [-X, -hx + inset], [y0, y1], [za, zb], { tint });
}

// A railing from a to b (world or face points), posts every `step`, with a cap rail and a bottom rail.
export function railing(B, bag, color, a, b, h, { step = 0.42, post = 0.06, rail = 0.12, f = WORLD, newel = false } = {}) {
  const dx = b[0] - a[0]; const dz = b[2] - a[2]; const dy = b[1] - a[1];
  const run = Math.hypot(dx, dz);
  const n = Math.max(1, Math.round(run / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + dx * t; const y = a[1] + dy * t; const z = a[2] + dz * t;
    const end = newel && (i === 0 || i === n);
    const r = end ? post * 1.9 : post;
    B.box(bag, color, [x - r, x + r], [y - 0.05, y + h + (end ? 0.25 : 0)], [z - r, z + r], { f });
    if (end) B.ball(bag, color, x, y + h + 0.32, z, r * 1.25, { f, w: 8, h: 6 });
  }
  B.bar(bag, color, [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], rail * 1.3, rail, { f });
  B.bar(bag, color, [a[0], a[1] + 0.28, a[2]], [b[0], b[1] + 0.28, b[2]], rail * 0.7, rail * 0.6, { f });
}

// A striped canvas awning on a wall: sloping from (yTop, n = 0) to (yTop - drop, n = proj), a
// valance hanging off the front, closed ends, iron arms. Stripes are geometry, so they are sharp.
export function awning(B, f, u0, u1, yTop, proj, drop, colors, { stripe = 1.0, valance = 0.9, arm = 0x2b2c2e, scallop = true } = {}) {
  const n = Math.max(1, Math.round((u1 - u0) / stripe));
  const sw = (u1 - u0) / n;
  const yB = yTop - drop;
  const len = Math.hypot(proj, drop);
  const slope = Math.atan2(drop, proj);
  for (let i = 0; i < n; i++) {
    const a = u0 + i * sw; const c = colors[i % colors.length];
    const m = new THREE.Matrix4().makeRotationX(slope);
    const g = new THREE.BoxGeometry(sw, 0.07, len);
    g.applyMatrix4(m);
    g.translate(a + sw / 2, (yTop + yB) / 2, proj / 2);
    B.add('paint', g, c, { f });
    // the valance, with a shallow scallop for every stripe
    const pts = [[a, yB + 0.02], [a + sw, yB + 0.02], [a + sw, yB - valance + (scallop ? 0.18 : 0)]];
    if (scallop) for (let k = 1; k < 6; k++) { const t = k / 6; pts.push([a + sw * (1 - t), yB - valance + 0.18 - Math.sin(t * Math.PI) * 0.2]); }
    pts.push([a, yB - valance + (scallop ? 0.18 : 0)]);
    B.prism('paint', c, pts, proj - 0.03, proj + 0.03, { f });
  }
  // ends: a triangle in the (n, y) plane, extruded 0.05 along -u (a rotation, never a mirror)
  for (const [u, s] of [[u0, -1], [u1, 1]]) {
    const pts = [[0, yTop], [proj, yB], [proj, yB - valance * 0.7]];
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    g.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)));
    g.translate(u + (s < 0 ? 0.05 : 0), 0, 0);
    B.add('paint', g, colors[0], { f, flip: true });
    // the arm
    B.bar('metal', arm, [u, yTop - 0.1, 0], [u, yB - 0.05, proj - 0.05], 0.07, 0.07, { f });
  }
  // the roller box at the top
  B.box('metal', arm, [u0, u1], [yTop - 0.05, yTop + 0.3], [-0.05, 0.25], { f });
}

// Stairs rising from n = n0 (bottom, out front) back to n = n1 at height top, between u0..u1.
export function steps(B, bag, color, f, u0, u1, n0, n1, y0, top, count, { nosing = 0.08 } = {}) {
  const rise = (top - y0) / count; const run = (n0 - n1) / count;
  for (let k = 0; k < count; k++) {
    const yb = k === 0 ? y0 - 0.4 : y0 + rise * k;
    const yt = y0 + rise * (k + 1);
    const nf = n0 - run * k;
    B.box(bag, color, [u0, u1], [yb, yt], [n1 - 0.1, nf + nosing], { f });
  }
  return { rise, run };
}
