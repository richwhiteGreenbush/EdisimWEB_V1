// The private kit behind builders/FutureCivic.js: the five civic buildings of Build a Future City.
//
// A building is at most SIX MESHES, one per material, whatever is in it:
//   body   the shell: a near-white panel-seam tile times vertex colour, UVs in feet from world
//          position, so one tile serves a red classroom wing and a white tower.
//   paint  smooth glossy colour with no map: machines, coils, pods, rails, plants.
//   glass  opaque tinted glass, glossy, with a sky gradient up each pane.
//   glow   every lit thing: one canvas atlas of glow swatches and of every screen and sign. It is
//          emissive from the same atlas, since `emissive` is not multiplied by vertex colour.
//   clear  the one see-through mesh a model may have (a dome, a canopy, a glass wall).
// A part that moves by itself is a seventh bag only in the sense that it is a separate Kit finished
// into its own inner group.
//
// ANGLES: a polar part at angle a stands at (r sin a, y, r cos a), so a = 0 is the front (+Z) and a
// grows toward +X, which is to the RIGHT of somebody standing in front looking in.

import * as THREE from 'three';
import { mergeParts } from '../../props/LoftKit.js';
import { seededRandom } from '../../PropKit.js';
import { lin, outward, lathe as mkLathe, tube as mkTube } from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// Tiles. Cached as canvases (an image may be shared), wrapped in a fresh Texture every build.
// ---------------------------------------------------------------------------------------------
const CANVASES = new Map();
function cachedCanvas(key, w, h, paint) {
  let canvas = CANVASES.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    paint(canvas.getContext('2d'), w, h);
    CANVASES.set(key, canvas);
  }
  return canvas;
}
const grey = (v, a = 1) => `rgba(${Math.round(v)},${Math.round(v)},${Math.round(v + 2)},${a})`;

// Smooth composite panels with a soft rounded seam every 4ft each way and a faint grain.
function panelCanvas() {
  return cachedCanvas('fc-panel', 256, 256, (ctx, W, H) => {
    const rng = seededRandom(311);
    ctx.fillStyle = grey(248);
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = grey(rng() < 0.5 ? 238 : 255, 0.3);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
    }
    for (const at of [0, W / 2]) {
      ctx.fillStyle = grey(206); ctx.fillRect(at, 0, 2, H); ctx.fillRect(0, at, W, 2);
      ctx.fillStyle = grey(232); ctx.fillRect(at + 2, 0, 2, H); ctx.fillRect(0, at + 2, W, 2);
    }
  });
}
const PANEL_FEET = 8;

// ---------------------------------------------------------------------------------------------
// Glow swatches: the top row of the atlas, 16px each. A glow part's UV sits in the middle of one.
// ---------------------------------------------------------------------------------------------
export const GLOWS = {
  cyan: '#5cf2ff', pink: '#ff5ccf', lime: '#b6ff5c', gold: '#ffd166', violet: '#b98cff', white: '#f4f8ff',
  warm: '#ffe3a6', red: '#ff5a50', orange: '#ffa04a', blue: '#5aa8ff', green: '#4ff08a', plasma: '#e46bff',
  aqua: '#5cf0dc', magenta: '#ff4fc4', yellow: '#fff06a', screen: '#16204a', dark: '#0d1430', amber: '#ffb13a',
};
const GLOW_NAMES = Object.keys(GLOWS);

export const colorOf = (c) => (Array.isArray(c) ? c : lin(c));
export const times = (c, k) => { const v = colorOf(c); return [v[0] * k, v[1] * k, v[2] * k]; };

// ---------------------------------------------------------------------------------------------
// Geometry. Every function returns a fresh closed solid, wound outward.
// ---------------------------------------------------------------------------------------------
export function boxG(x0, x1, y0, y1, z0, z1, segs = [1, 1, 1]) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), segs[0], segs[1], segs[2]);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.clearGroups();
  return g;
}

// A box bent round the Y axis: r0..r1 out, y0..y1 up, a0..a1 round. Built from a subdivided box
// whose x becomes the angle and z the radius, so its faces stay separate and its edges crisp.
export function polarG(r0, r1, y0, y1, a0, a1, { segs = null, ysegs = 1 } = {}) {
  const n = segs ?? Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 45)));
  const g = new THREE.BoxGeometry(1, y1 - y0, 1, n, ysegs, 1);
  g.translate(0, (y0 + y1) / 2, 0);
  g.clearGroups();
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const a = a0 + (P.getX(i) + 0.5) * (a1 - a0);
    const r = r0 + (P.getZ(i) + 0.5) * (r1 - r0);
    P.setXYZ(i, r * Math.sin(a), P.getY(i), r * Math.cos(a));
  }
  g.computeVertexNormals();
  return outward(g);
}

// A solid of revolution from the bottom up, axis to axis.
export function latheG(profile, segs = 40) {
  return outward(mkLathe(profile, segs));
}

// A closed loop in (r, y), swept round Y from a0 to a1, capped at both ends when it is partial.
// The loop must be convex enough to fan from its centroid (a D, a circle, a rectangle).
export function sweepLoopG(loop, a0 = 0, a1 = Math.PI * 2, segs = 64) {
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
  const n = loop.length;
  const cols = full ? segs : segs + 1;
  const pos = [];
  const idx = [];
  for (let c = 0; c < cols; c++) {
    const a = a0 + (c / segs) * (a1 - a0);
    for (const [r, y] of loop) pos.push(r * Math.sin(a), y, r * Math.cos(a));
  }
  const lim = full ? cols : cols - 1;
  for (let c = 0; c < lim; c++) {
    const c2 = (c + 1) % cols;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      idx.push(c * n + i, c2 * n + i, c2 * n + i2, c * n + i, c2 * n + i2, c * n + i2);
    }
  }
  const g = new THREE.BufferGeometry();
  if (!full) {
    // caps with vertices of their own, so their normals stay flat
    let cr = 0; let cy = 0;
    for (const [r, y] of loop) { cr += r / n; cy += y / n; }
    for (const [c, flip] of [[0, false], [cols - 1, true]]) {
      const a = a0 + (c / segs) * (a1 - a0);
      const base = pos.length / 3;
      for (const [r, y] of loop) pos.push(r * Math.sin(a), y, r * Math.cos(a));
      const centre = pos.length / 3;
      pos.push(cr * Math.sin(a), cy, cr * Math.cos(a));
      for (let i = 0; i < n; i++) {
        const i2 = (i + 1) % n;
        if (flip) idx.push(centre, base + i, base + i2); else idx.push(centre, base + i2, base + i);
      }
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

export function rodG(a, b, r, { r2 = null, sides = 12 } = {}) {
  const A = new THREE.Vector3(...a); const B = new THREE.Vector3(...b);
  const len = Math.max(1e-4, A.distanceTo(B));
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, sides);
  g.clearGroups();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

export function ballG(x, y, z, r, { sx = 1, sy = 1, sz = 1, w = 16, h = 10 } = {}) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

// A torus lying flat (in XZ), centred at y.
export function ringG(R, r, y, { radial = 12, tubular = 64, x = 0, z = 0 } = {}) {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export function tubeG(points, radii, opts = {}) {
  return outward(mkTube(points, radii, opts));
}

// A rounded slab: an outline in XY (rounded rectangle w x h, corner radius rc) extruded d along Z,
// with a small bevel so no edge is a knife.
export function pillG(w, h, d, rc = 0.4, bevel = 0.08) {
  const s = new THREE.Shape();
  const x0 = -w / 2 + bevel; const x1 = w / 2 - bevel; const y0 = -h / 2 + bevel; const y1 = h / 2 - bevel;
  const r = Math.max(0.01, Math.min(rc, (x1 - x0) / 2 - 0.01, (y1 - y0) / 2 - 0.01));
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, d - bevel * 2), bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -(d - bevel * 2) / 2);
  g.clearGroups();
  return outward(g);
}

// A closed outline in XY, extruded z0..z1.
export function extrudeG(pts, z0, z1, { curve = 12 } = {}) {
  const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: curve });
  g.translate(0, 0, z0);
  g.clearGroups();
  return outward(g);
}

// ---------------------------------------------------------------------------------------------
// Colour and UVs
// ---------------------------------------------------------------------------------------------
function paintColor(g, color, tint) {
  const P = g.attributes.position; const N = g.attributes.normal;
  const arr = new Float32Array(P.count * 3);
  const c = colorOf(color);
  const out = [0, 0, 0];
  for (let i = 0; i < P.count; i++) {
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    if (tint) tint(P.getX(i), P.getY(i), P.getZ(i), out, N.getX(i), N.getY(i), N.getZ(i));
    arr[i * 3] = out[0]; arr[i * 3 + 1] = out[1]; arr[i * 3 + 2] = out[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

// Box projection from world position, in tiles. On a vertical face u runs along it and v up it;
// on a round wall u follows the circumference.
function projectUV(g, feet) {
  const P = g.attributes.position; const N = g.attributes.normal;
  let UV = g.attributes.uv;
  if (!UV) { UV = new THREE.BufferAttribute(new Float32Array(P.count * 2), 2); g.setAttribute('uv', UV); }
  for (let i = 0; i < P.count; i++) {
    const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i)); const nz = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    UV.setXY(i, u / feet, v / feet);
  }
}

// ---------------------------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------------------------
export class FKit {
  constructor({ seed = 1, atlasW = 1024, atlasH = 512 } = {}) {
    this.rng = seededRandom(seed);
    this.parts = { body: [], paint: [], glass: [], glow: [], clear: [] };
    this.atlas = { W: atlasW, H: atlasH, items: [], shelves: [{ y: 18, h: 0, x: 0 }] };
    this.M = null;
  }

  within(matrix, fn) {
    const prev = this.M;
    this.M = prev ? prev.clone().multiply(matrix) : matrix;
    fn(this);
    this.M = prev;
  }

  // The tint sees each vertex in WORLD position (after the current frame).
  add(bag, g, color = 0xffffff, { tint = null } = {}) {
    if (!g.attributes.normal) g.computeVertexNormals();
    if (this.M) g.applyMatrix4(this.M);
    paintColor(g, color, tint);
    if (bag === 'body') projectUV(g, PANEL_FEET);
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.parts[bag].push({ geometry: g, keepColor: true });
    return g;
  }

  box(bag, color, x0, x1, y0, y1, z0, z1, opts = {}) { return this.add(bag, boxG(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1), opts.segs), color, opts); }
  polar(bag, color, r0, r1, y0, y1, a0, a1, opts = {}) { return this.add(bag, polarG(r0, r1, y0, y1, a0, a1, opts), color, opts); }
  rod(bag, color, a, b, r, opts = {}) { return this.add(bag, rodG(a, b, r, opts), color, opts); }
  ball(bag, color, x, y, z, r, opts = {}) { return this.add(bag, ballG(x, y, z, r, opts), color, opts); }

  // ---- glow ----------------------------------------------------------------------------------
  swatchUV(name) {
    const i = GLOW_NAMES.indexOf(name);
    if (i < 0) throw new Error(`no glow swatch ${name}`);
    return [(i * 16 + 8) / this.atlas.W, 1 - 8 / this.atlas.H];
  }

  glow(name, g) {
    const [u, v] = this.swatchUV(name);
    const cnt = g.attributes.position.count;
    const uv = new Float32Array(cnt * 2);
    for (let i = 0; i < cnt; i++) { uv[i * 2] = u; uv[i * 2 + 1] = v; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return this.add('glow', g, 0xffffff);
  }
  glowBox(name, x0, x1, y0, y1, z0, z1) { return this.glow(name, boxG(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1))); }
  glowPolar(name, r0, r1, y0, y1, a0, a1, opts = {}) { return this.glow(name, polarG(r0, r1, y0, y1, a0, a1, opts)); }

  // ---- the atlas -----------------------------------------------------------------------------
  rect(pw, ph, draw) {
    const A = this.atlas;
    pw = Math.ceil(pw); ph = Math.ceil(ph);
    let shelf = A.shelves.find((sh) => sh.h >= ph && sh.h <= ph * 1.6 + 8 && sh.x + pw <= A.W);
    if (!shelf) {
      const y = A.shelves.reduce((m, sh) => Math.max(m, sh.y + sh.h + 2), 0);
      shelf = { y, h: ph, x: 0 };
      A.shelves.push(shelf);
    }
    const r = { px: shelf.x, py: shelf.y, pw, ph, draw };
    shelf.x += pw + 2;
    if (r.py + ph > A.H) throw new Error(`atlas overflow (${r.py + ph} > ${A.H})`);
    A.items.push(r);
    r.u0 = (r.px + 0.5) / A.W; r.u1 = (r.px + pw - 0.5) / A.W;
    r.v0 = 1 - (r.py + ph - 0.5) / A.H; r.v1 = 1 - (r.py + 0.5) / A.H;
    return r;
  }

  // Maps the face of `g` whose normal is nearest `face` (a world direction) onto rect r, using the
  // box's own 0..1 uvs for that face; every other vertex takes the `edge` swatch.
  decal(g, r, { edge = 'dark', faceTest = null } = {}) {
    const UV = g.attributes.uv; const N = g.attributes.normal;
    const [eu, ev] = this.swatchUV(edge);
    for (let i = 0; i < UV.count; i++) {
      const on = faceTest ? faceTest(N.getX(i), N.getY(i), N.getZ(i)) : N.getZ(i) > 0.9;
      if (on) UV.setXY(i, r.u0 + UV.getX(i) * (r.u1 - r.u0), r.v0 + UV.getY(i) * (r.v1 - r.v0));
      else UV.setXY(i, eu, ev);
    }
    return this.add('glow', g, 0xffffff);
  }

  // A flat screen facing +Z (before the current frame) of w x h, centred at (x, y), z0..z1 thick.
  screen(r, x, y, w, h, z0, z1, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, z1 - z0);
    g.translate(x, y, (z0 + z1) / 2);
    g.clearGroups();
    return this.decal(g, r, opts);
  }

  // A curved screen on the outside of a cylinder r0..r1, centred on angle ac, spanning da.
  polarScreen(r, r0, r1, y0, y1, ac, da, { inward = false, segs = 24 } = {}) {
    const g = new THREE.BoxGeometry(1, y1 - y0, 1, segs, 1, 1);
    g.translate(0, (y0 + y1) / 2, 0);
    g.clearGroups();
    const N0 = g.attributes.normal; const UV = g.attributes.uv; const P = g.attributes.position;
    const outer = new Uint8Array(P.count);
    for (let i = 0; i < P.count; i++) outer[i] = inward ? (N0.getZ(i) < -0.9 ? 1 : 0) : (N0.getZ(i) > 0.9 ? 1 : 0);
    // A box's own uvs already read left to right from outside each face, which for the -z face is
    // from the axis looking out: no flip is needed either way.
    const a0 = ac - da / 2; const a1 = ac + da / 2;
    for (let i = 0; i < P.count; i++) {
      const a = a0 + (P.getX(i) + 0.5) * (a1 - a0);
      const rr = r0 + (P.getZ(i) + 0.5) * (r1 - r0);
      P.setXYZ(i, rr * Math.sin(a), P.getY(i), rr * Math.cos(a));
    }
    g.computeVertexNormals();
    const [eu, ev] = this.swatchUV('dark');
    for (let i = 0; i < P.count; i++) {
      if (outer[i]) UV.setXY(i, r.u0 + UV.getX(i) * (r.u1 - r.u0), r.v0 + UV.getY(i) * (r.v1 - r.v0));
      else UV.setXY(i, eu, ev);
    }
    return this.add('glow', outward(g), 0xffffff);
  }

  // A text rect fitted to its own measured width.
  textRect(text, wFt, hFt, { bg = '#14204a', fg = '#ffffff', font = 'bold', family = '"Trebuchet MS", "Arial Rounded MT Bold", Arial, sans-serif', size = 0.66, pxPerFt = 40, rainbow = null, border = null, glowText = null } = {}) {
    let ph = Math.max(36, Math.min(160, hFt * pxPerFt));
    let pw = (ph * wFt) / hFt;
    if (pw > this.atlas.W) { ph = (ph * this.atlas.W) / pw; pw = this.atlas.W; }
    return this.rect(pw, ph, (ctx, x, y, w, h) => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, h);
      if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = Math.max(2, h * 0.07);
        ctx.strokeRect(x + h * 0.08, y + h * 0.08, w - h * 0.16, h - h * 0.16);
      }
      let px = Math.floor(h * size);
      const setFont = () => { ctx.font = `${font} ${px}px ${family}`; };
      setFont();
      const room = w - h * 0.45;
      const m = ctx.measureText(text).width;
      if (m > room) { px = Math.floor((px * room) / m); setFont(); }
      ctx.textBaseline = 'middle';
      if (glowText) { ctx.shadowColor = glowText; ctx.shadowBlur = h * 0.12; }
      if (rainbow) {
        // each letter its own colour, laid out by measuring
        const total = ctx.measureText(text).width;
        let cx = x + (w - total) / 2;
        ctx.textAlign = 'left';
        let k = 0;
        for (const ch of text) {
          ctx.fillStyle = ch === ' ' ? fg : rainbow[k++ % rainbow.length];
          ctx.fillText(ch, cx, y + h * 0.54);
          cx += ctx.measureText(ch).width;
        }
      } else {
        ctx.textAlign = 'center';
        ctx.fillStyle = fg;
        ctx.fillText(text, x + w / 2, y + h * 0.54);
      }
      ctx.shadowBlur = 0;
    });
  }

  // ---- finishing -----------------------------------------------------------------------------
  atlasTexture() {
    const A = this.atlas;
    const canvas = document.createElement('canvas');
    canvas.width = A.W; canvas.height = A.H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, A.W, A.H);
    GLOW_NAMES.forEach((name, i) => { ctx.fillStyle = GLOWS[name]; ctx.fillRect(i * 16, 0, 16, 16); });
    for (const it of A.items) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(it.px, it.py, it.pw, it.ph);
      ctx.clip();
      it.draw(ctx, it.px, it.py, it.pw, it.ph);
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }

  // Returns { group, meshes: { body, paint, glass, glow, clear } }.
  finish({ body = {}, paint = {}, glass = {}, glow = {}, clear = {}, shadows = {} } = {}) {
    const group = new THREE.Group();
    const meshes = {};
    const make = (bag, material) => {
      const list = this.parts[bag];
      if (!list.length) return null;
      const geometry = mergeParts(list);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = shadows[bag] ?? (bag !== 'glow' && bag !== 'clear');
      m.receiveShadow = bag !== 'glow';
      group.add(m);
      meshes[bag] = m;
      return m;
    };
    if (this.parts.body.length) {
      const tex = new THREE.CanvasTexture(panelCanvas());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      make('body', new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, bumpMap: tex, bumpScale: 0.6, roughness: 0.55, metalness: 0.05, ...body }));
    }
    make('paint', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.12, ...paint }));
    make('glass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.35, ...glass }));
    if (this.parts.glow.length) {
      const t = this.atlasTexture();
      make('glow', new THREE.MeshStandardMaterial({ color: 0xffffff, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.45, metalness: 0, ...glow }));
    }
    make('clear', new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide, ...clear }));
    return { group, meshes };
  }
}

// A sky gradient up a pane of opaque glass: darker below, a lighter band of reflected sky above.
export function glassTint(y0, y1, base = 0x2b5876, sky = 0x6aa3c8) {
  const a = colorOf(base); const b = colorOf(sky);
  return (x, y, z, out) => {
    const t = Math.min(1, Math.max(0, (y - y0) / Math.max(0.01, y1 - y0)));
    const k = t * t * 0.75;
    out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = a[2] + (b[2] - a[2]) * k;
  };
}

// ---------------------------------------------------------------------------------------------
// A mesh whose parts move by rewriting positions each frame, so any number of moving parts cost one
// draw call. Each part is a list of geometries (already in the rest pose, colours set) and a pivot;
// `pose(i)` is filled by the caller with a Matrix4 per part.
// ---------------------------------------------------------------------------------------------
export class Mover {
  constructor() { this.parts = []; }

  part() { const p = { geoms: [] }; this.parts.push(p); return this.parts.length - 1; }

  add(partIndex, g, color, tint = null) {
    if (!g.attributes.normal) g.computeVertexNormals();
    paintColor(g, color, tint);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    this.parts[partIndex].geoms.push(g);
  }

  finish(material, sphere) {
    const list = [];
    const owner = [];
    for (let p = 0; p < this.parts.length; p++) {
      for (const g of this.parts[p].geoms) {
        const ng = g.index ? g.toNonIndexed() : g;
        for (const key of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(key)) ng.deleteAttribute(key);
        list.push(ng);
        for (let i = 0; i < ng.attributes.position.count; i++) owner.push(p);
      }
    }
    const merged = mergeParts(list.map((geometry) => ({ geometry, keepColor: true })));
    const P = merged.attributes.position; const N = merged.attributes.normal;
    this.base = new Float32Array(P.array);
    this.baseN = new Float32Array(N.array);
    this.owner = Uint16Array.from(owner);
    const pos = new THREE.BufferAttribute(new Float32Array(P.array), 3).setUsage(THREE.DynamicDrawUsage);
    const nrm = new THREE.BufferAttribute(new Float32Array(N.array), 3).setUsage(THREE.DynamicDrawUsage);
    merged.setAttribute('position', pos);
    merged.setAttribute('normal', nrm);
    merged.computeBoundingBox();
    merged.boundingSphere = sphere;
    this.geometry = merged;
    this.mesh = new THREE.Mesh(merged, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mats = this.parts.map(() => new THREE.Matrix4());
    return this.mesh;
  }

  // Writes every vertex from its part's matrix in this.mats.
  write() {
    const P = this.geometry.attributes.position.array; const N = this.geometry.attributes.normal.array;
    const B = this.base; const BN = this.baseN; const O = this.owner;
    const els = this.mats.map((m) => m.elements);
    for (let i = 0, j = 0; i < O.length; i++, j += 3) {
      const e = els[O[i]];
      const x = B[j]; const y = B[j + 1]; const z = B[j + 2];
      P[j] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = BN[j]; const ny = BN[j + 1]; const nz = BN[j + 2];
      N[j] = e[0] * nx + e[4] * ny + e[8] * nz;
      N[j + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
      N[j + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
  }
}

// The recycling emblem: three chasing arrows round a triangle, drawn as paths (never a character).
export function drawRecycle(ctx, cx, cy, R, color = '#b6ff5c', width = null) {
  const lw = width ?? R * 0.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = lw; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.save();
    ctx.rotate((k * Math.PI * 2) / 3);
    // one arrow: a bent bar along one side of a triangle, its head at the next corner
    const a = [0, -R * 0.92];
    const b = [R * 0.8, R * 0.46];
    const t0 = 0.14; const t1 = 0.68;
    const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
    const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const L = Math.hypot(dx, dy);
    const ux = dx / L; const uy = dy / L; const nx = -uy; const ny = ux;
    const hl = lw * 1.9; const hw = lw * 1.35;
    ctx.beginPath();
    ctx.moveTo(p1[0] + ux * hl, p1[1] + uy * hl);
    ctx.lineTo(p1[0] + nx * hw, p1[1] + ny * hw);
    ctx.lineTo(p1[0] - nx * hw, p1[1] - ny * hw);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function drawStar(ctx, cx, cy, r, color, points = 5, inner = 0.45) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
