// The private kit behind builders/CityCivic.js: the six civic buildings of the Build a City kit.
//
// A building is FIVE MESHES, one per material, whatever is in it:
//   wall   the masonry: a near-white brick, ashlar or precast-panel tile times vertex colour, UVs in
//          feet from world position, so one tile serves red brick outside and cream paint inside and
//          the courses stay level across every window.
//   trim   a near-white smooth stone tile with a flat patch: cornices, sills, steps, floors, roofs,
//          furniture, and every flat painted thing (a door, a rail) points at the patch.
//   glass  opaque dark glass, slightly glossy, with a sky-light gradient up each pane.
//   sign   one canvas atlas of every word, clock face, flag, helipad and row of book spines.
//   glow   a strip of emissive swatches: lamps, the EMERGENCY letters, a reading lamp.
//
// EVERYTHING IS BUILT IN WALL COORDINATES where it sits on a wall: (u along the wall as seen from
// outside, y up, n out of it), mapped onto one of four faces by `wallM(side, plane)`. That is what
// lets a window be written once and land correctly on every side.
//
// Windows and doors are BUILT FORWARD of a solid wall (no CSG): pane a hair proud, frame proud of
// that, sill furthest. A doorway a student walks through is a real gap between piers.

import * as THREE from 'three';
import { mergeParts } from '../../props/LoftKit.js';
import { seededRandom } from '../../PropKit.js';
import { lin, mix, outward } from '../ModelKit.js';

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
const grey = (v, a = 1, warm = 0) => `rgba(${Math.round(v)},${Math.round(v - warm)},${Math.round(v - warm * 2)},${a})`;

function tileFrom(canvas, feet, bumpScale) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  const w = canvas.width; const h = canvas.height;
  return { texture, feet, bumpScale, flat: [6 / w, 6 / h] };
}

function patch(ctx, h, v = 246) { ctx.fillStyle = grey(v); ctx.fillRect(0, h - 12, 12, 12); }

// Running-bond brick, 8in x 2.67in modules, so a 4 x 2ft tile holds six bricks and nine courses.
function brickTile() {
  const canvas = cachedCanvas('brick', 512, 256, (ctx, W, H) => {
    const rng = seededRandom(71);
    ctx.fillStyle = grey(250);
    ctx.fillRect(0, 0, W, H);
    const rows = 9; const cols = 6;
    const bh = H / rows; const bw = W / cols;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = c * bw + off + 2; const y = r * bh + 2;
        const flashed = rng() < 0.12;
        const v = flashed ? 178 + rng() * 18 : 204 + rng() * 34;
        ctx.fillStyle = grey(v, 1, 2);
        ctx.fillRect(x, y, bw - 4.5, bh - 4.5);
        for (let k = 0; k < 10; k++) {
          ctx.fillStyle = grey(v - 25 + rng() * 40, 0.5);
          ctx.fillRect(x + rng() * (bw - 6), y + rng() * (bh - 6), 1.5 + rng() * 2, 1.5);
        }
      }
    }
    patch(ctx, H, 236);
  });
  return tileFrom(canvas, [4, 2], 0.9);
}

// Coursed ashlar, 1.25ft courses, blocks of varied length, joints only a little darker than stone.
function stoneTile() {
  const canvas = cachedCanvas('ashlar', 512, 320, (ctx, W, H) => {
    const rng = seededRandom(83);
    ctx.fillStyle = grey(206);
    ctx.fillRect(0, 0, W, H);
    const rows = 2; const rh = H / rows;
    for (let r = 0; r < rows; r++) {
      let x = r === 0 ? 0 : -64;
      while (x < W) {
        const len = [192, 256, 320][Math.floor(rng() * 3)];
        const v = 232 + rng() * 16;
        ctx.fillStyle = grey(v, 1, 2);
        const x0 = x + 2; const x1 = Math.min(x + len, W + 400) - 2;
        ctx.fillRect(x0, r * rh + 2, x1 - x0, rh - 4);
        if (x + len > W) { ctx.fillRect(x0 - W, r * rh + 2, x1 - x0, rh - 4); }
        x += len;
      }
    }
    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = grey(rng() < 0.5 ? 214 : 252, 0.25);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 2);
    }
    patch(ctx, H, 240);
  });
  return tileFrom(canvas, [4, 2.5], 0.7);
}

// Precast panels: a fine seam every 5ft across and every 6.5ft up (half a 13ft hospital floor).
function panelTile() {
  const canvas = cachedCanvas('panel', 256, 332, (ctx, W, H) => {
    const rng = seededRandom(97);
    ctx.fillStyle = grey(247);
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = grey(rng() < 0.5 ? 236 : 252, 0.35);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
    }
    ctx.fillStyle = grey(196);
    ctx.fillRect(0, 0, 3, H);
    ctx.fillRect(0, 0, W, 3);
    ctx.fillStyle = grey(228);
    ctx.fillRect(0, 3, W, 3);
    patch(ctx, H, 247);
  });
  return tileFrom(canvas, [5, 6.5], 0.5);
}

function trimTile() {
  const canvas = cachedCanvas('trim', 256, 256, (ctx, W, H) => {
    const rng = seededRandom(57);
    ctx.fillStyle = grey(246);
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = grey(rng() < 0.5 ? 228 : 254, 0.3);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 3);
    }
    patch(ctx, H, 246);
  });
  return tileFrom(canvas, [2.5, 2.5], 0.35);
}

const WALL_TILES = { brick: brickTile, stone: stoneTile, panel: panelTile };

// Emissive swatches, each 16px wide. A glow part's UV sits in the middle of one.
export const GLOW = { blue: 0, red: 1, warm: 2, white: 3, amber: 4, green: 5, cool: 6, window: 7, shade: 8, ceiling: 9 };
const GLOW_COLORS = ['#3d7dff', '#ff3426', '#ffd99a', '#f7f8ff', '#ffb13a', '#43d873', '#e6eeff', '#ffe3a6', '#1f6b3e', '#8f8b82'];
function glowTexture() {
  const canvas = cachedCanvas('glow', 16 * GLOW_COLORS.length, 16, (ctx) => {
    GLOW_COLORS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 16, 0, 16, 16); });
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = false;
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// Colour and UVs
// ---------------------------------------------------------------------------------------------
export const colorOf = (c) => (Array.isArray(c) ? c : lin(c));
export const times = (c, k) => { const v = colorOf(c); return [v[0] * k, v[1] * k, v[2] * k]; };

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

// Box projection from world position. On a vertical face u runs along it and v up it.
function projectUV(g, t, flat) {
  const P = g.attributes.position; const N = g.attributes.normal;
  let UV = g.attributes.uv;
  if (!UV) { UV = new THREE.BufferAttribute(new Float32Array(P.count * 2), 2); g.setAttribute('uv', UV); }
  for (let i = 0; i < P.count; i++) {
    if (flat) { UV.setXY(i, t.flat[0], t.flat[1]); continue; }
    const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i)); const nz = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (ny >= nx && ny >= nz) { u = x; v = z; } else if (nx >= nz) { u = z; v = y; } else { u = x; v = y; }
    UV.setXY(i, u / t.feet[0], v / t.feet[1]);
  }
}

// ---------------------------------------------------------------------------------------------
// Wall frames
// ---------------------------------------------------------------------------------------------
// A matrix taking (u, y, n) on a wall to world. `plane` is how far the wall's outer face stands from
// the origin along its outward normal; u runs left to right for somebody facing that face.
export function wallM(side, plane) {
  const m = new THREE.Matrix4();
  if (side === '+z') m.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
  else if (side === '-z') m.makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  else if (side === '+x') m.makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  else m.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
  const n = new THREE.Vector3().setFromMatrixColumn(m, 2).multiplyScalar(plane);
  m.setPosition(n);
  return m;
}

const tmpBox = (x0, x1, y0, y1, z0, z1, segs = [1, 1, 1]) => {
  const g = new THREE.BoxGeometry(Math.max(Math.abs(x1 - x0), 1e-3), Math.max(Math.abs(y1 - y0), 1e-3), Math.max(Math.abs(z1 - z0), 1e-3), ...segs);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.clearGroups();
  return g;
};

// ---------------------------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------------------------
export class Kit {
  constructor({ seed = 1, wall = 'brick', atlasH = 1024 } = {}) {
    this.rng = seededRandom(seed);
    this.tiles = { wall: WALL_TILES[wall](), trim: trimTile() };
    this.parts = { wall: [], trim: [], glass: [], sign: [], glow: [] };
    this.atlas = { W: 1024, H: atlasH, x: 8, y: 0, row: 8, items: [] };
    this.M = null;
  }

  // Runs fn with a wall frame applied to everything it emits.
  on(side, plane, fn) { this.within(wallM(side, plane), fn); }
  within(matrix, fn) {
    const prev = this.M;
    this.M = prev ? prev.clone().multiply(matrix) : matrix;
    fn(this);
    this.M = prev;
  }

  // A tint sees the part in its own local frame, before the wall frame moves it; the UVs are
  // projected after, from world position, so courses line up across every part.
  add(bag, g, color, { flat = false, tint = null, uvDone = false } = {}) {
    paintColor(g, color, tint);
    if (this.M) g.applyMatrix4(this.M);
    if (!uvDone && (bag === 'wall' || bag === 'trim')) projectUV(g, this.tiles[bag], flat);
    if (!uvDone && !(bag === 'wall' || bag === 'trim') && !g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    this.parts[bag].push({ geometry: g, keepColor: true });
    return g;
  }

  box(bag, color, x0, x1, y0, y1, z0, z1, opts = {}) {
    return this.add(bag, tmpBox(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1), opts.segs), color, opts);
  }

  // A box of size (w, h, d) centred at the origin, placed by a matrix (after the current frame).
  boxAt(bag, color, w, h, d, matrix, opts = {}) {
    const g = tmpBox(-w / 2, w / 2, -h / 2, h / 2, -d / 2, d / 2, opts.segs);
    g.applyMatrix4(matrix);
    return this.add(bag, g, color, opts);
  }

  // A round rod from a to b (in the current frame).
  rod(bag, color, a, b, r, { r2 = null, sides = 10, flat = true, tint = null } = {}) {
    const A = new THREE.Vector3(...a); const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    if (len < 1e-4) return null;
    const g = new THREE.CylinderGeometry(r2 ?? r, r, len, sides);
    g.clearGroups();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    return this.add(bag, g, color, { flat, tint });
  }

  ball(bag, color, x, y, z, r, { sx = 1, sy = 1, sz = 1, w = 12, h = 8, glow = null, flat = true } = {}) {
    const g = new THREE.SphereGeometry(r, w, h);
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    if (bag === 'glow') return this.glowGeom(g, glow ?? GLOW.warm, color);
    return this.add(bag, g, color, { flat });
  }

  // A closed outline in (u, y), extruded through n0..n1.
  extrude(bag, color, pts, n0, n1, opts = {}) {
    const shape = new THREE.Shape(pts.map(([u, y]) => new THREE.Vector2(u, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: n1 - n0, bevelEnabled: false, curveSegments: 12 });
    g.translate(0, 0, n0);
    return this.add(bag, outward(g), color, opts);
  }

  glowGeom(g, swatch, color = 0xffffff) {
    const cnt = g.attributes.position.count;
    const uv = new Float32Array(cnt * 2);
    const u = (swatch * 16 + 8) / (16 * GLOW_COLORS.length);
    for (let i = 0; i < cnt; i++) { uv[i * 2] = u; uv[i * 2 + 1] = 0.5; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return this.add('glow', g, color, { uvDone: true });
  }

  glowBox(swatch, x0, x1, y0, y1, z0, z1) {
    return this.glowGeom(tmpBox(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1)), swatch);
  }

  // ---- the sign atlas ------------------------------------------------------------------------
  // Reserves a rect of the atlas and remembers how to paint it.
  rect(pw, ph, draw) {
    const A = this.atlas;
    pw = Math.ceil(pw); ph = Math.ceil(ph);
    A.shelves ??= [{ y: 0, h: 8, x: 8 }];
    let shelf = A.shelves.find((sh) => sh.h >= ph && sh.h <= ph * 1.7 + 8 && sh.x + pw <= A.W);
    if (!shelf) {
      const y = A.shelves.reduce((m, sh) => Math.max(m, sh.y + sh.h + 2), 0);
      shelf = { y, h: ph, x: 0 };
      A.shelves.push(shelf);
    }
    const r = { px: shelf.x, py: shelf.y, pw, ph, draw };
    shelf.x += pw + 2;
    if (r.py + ph > A.H) throw new Error(`sign atlas overflow (${r.py + ph} > ${A.H})`);
    A.items.push(r);
    r.u0 = (r.px + 0.5) / A.W; r.u1 = (r.px + pw - 0.5) / A.W;
    r.v0 = 1 - (r.py + ph - 0.5) / A.H; r.v1 = 1 - (r.py + 0.5) / A.H;
    return r;
  }

  // A text rect fitted to its own measured width.
  textRect(text, wFt, hFt, { bg = '#1e3552', fg = '#f3efe2', font = 'bold', family = 'Georgia, "Times New Roman", serif', border = null, size = 0.62, pxPerFt = 52, letter = 0 } = {}) {
    let ph = Math.max(40, Math.min(128, hFt * pxPerFt));
    let pw = (ph * wFt) / hFt;
    if (pw > 1000) { ph = (ph * 1000) / pw; pw = 1000; }
    return this.rect(pw, ph, (ctx, x, y, w, h) => {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, h);
      if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = Math.max(2, h * 0.06);
        ctx.strokeRect(x + h * 0.09, y + h * 0.09, w - h * 0.18, h - h * 0.18);
      }
      let px = Math.floor(h * size);
      const setFont = () => { ctx.font = `${font} ${px}px ${family}`; };
      setFont();
      const spaced = letter ? text.split('').join(String.fromCharCode(8202)) : text;
      const m = ctx.measureText(spaced).width;
      const room = w - h * 0.5;
      if (m > room) { px = Math.floor((px * room) / m); setFont(); }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = fg;
      ctx.fillText(spaced, x + w / 2, y + h * 0.53);
    });
  }

  // A thin box whose face (local +n, or +y for a decal lying on the ground) shows the rect; its
  // edges take `edge`, painted onto the atlas's white corner.
  decalBox(r, x0, x1, y0, y1, z0, z1, { face = '+z', edge = 0x6b6b6b, segs = null, warp = null } = {}) {
    const g = tmpBox(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1), segs ?? [1, 1, 1]);
    const P = g.attributes.position; const N = g.attributes.normal; const UV = g.attributes.uv;
    const cols = new Float32Array(P.count * 3);
    const ec = colorOf(edge);
    const xs = [Math.min(x0, x1), Math.max(x0, x1)]; const ys = [Math.min(y0, y1), Math.max(y0, y1)]; const zs = [Math.min(z0, z1), Math.max(z0, z1)];
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
      const onFace = face === '+z' ? N.getZ(i) > 0.5 : face === 'both' ? Math.abs(N.getZ(i)) > 0.5 : N.getY(i) > 0.5;
      if (onFace) {
        const fu = (x - xs[0]) / (xs[1] - xs[0]);
        const fv = face === '+y' ? (zs[1] - z) / (zs[1] - zs[0]) : (y - ys[0]) / (ys[1] - ys[0]);
        UV.setXY(i, mix(r.u0, r.u1, fu), mix(r.v0, r.v1, fv));
        cols.set([1, 1, 1], i * 3);
      } else {
        UV.setXY(i, 3 / this.atlas.W, 1 - 3 / this.atlas.H);
        cols.set(ec, i * 3);
      }
    }
    if (warp) {
      for (let i = 0; i < P.count; i++) {
        const [dx, dy, dz] = warp(P.getX(i), P.getY(i), P.getZ(i));
        P.setXYZ(i, P.getX(i) + dx, P.getY(i) + dy, P.getZ(i) + dz);
      }
      g.computeVertexNormals();
    }
    if (this.M) g.applyMatrix4(this.M);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.parts.sign.push({ geometry: g, keepColor: true });
    return g;
  }

  // A disc facing +n, showing the rect as a circle (a clock face, a seal).
  disc(r, cx, cy, n0, n1, radius, { sides = 32, edge = 0x444444 } = {}) {
    const g = new THREE.CylinderGeometry(radius, radius, n1 - n0, sides);
    g.clearGroups();
    g.rotateX(Math.PI / 2);
    g.translate(cx, cy, (n0 + n1) / 2);
    const P = g.attributes.position; const N = g.attributes.normal; const UV = g.attributes.uv;
    const cols = new Float32Array(P.count * 3);
    const ec = colorOf(edge);
    for (let i = 0; i < P.count; i++) {
      if (N.getZ(i) > 0.5) {
        const fu = (P.getX(i) - cx) / radius * 0.5 + 0.5;
        const fv = (P.getY(i) - cy) / radius * 0.5 + 0.5;
        UV.setXY(i, mix(r.u0, r.u1, fu), mix(r.v0, r.v1, fv));
        cols.set([1, 1, 1], i * 3);
      } else {
        UV.setXY(i, 3 / this.atlas.W, 1 - 3 / this.atlas.H);
        cols.set(ec, i * 3);
      }
    }
    if (this.M) g.applyMatrix4(this.M);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.parts.sign.push({ geometry: g, keepColor: true });
    return g;
  }

  // A sign plate on a wall, in wall coordinates (call inside `on`).
  sign(text, uc, yc, w, h, { depth = 0.22, n0 = 0, edge = 0x2a2a2a, ...style } = {}) {
    const r = this.textRect(text, w, h, style);
    return this.decalBox(r, uc - w / 2, uc + w / 2, yc - h / 2, yc + h / 2, n0, n0 + depth, { edge });
  }

  // ---- facade elements, in wall coordinates --------------------------------------------------
  // A glass pane from (u0, y0) to (u1, y1) standing n0..n1, lighter toward its top like sky in it.
  pane(u0, u1, y0, y1, n0 = 0, n1 = 0.05, base = 0x26394a) {
    const c = colorOf(base);
    const sky = [0.32, 0.4, 0.5];
    const lo = Math.min(y0, y1); const hi = Math.max(y0, y1);
    return this.box('glass', c, u0, u1, y0, y1, n0, n1, {
      tint: (x, y, z, out) => {
        const t = (y - lo) / Math.max(hi - lo, 1e-3);
        out[0] = mix(c[0], sky[0], t * 0.55); out[1] = mix(c[1], sky[1], t * 0.55); out[2] = mix(c[2], sky[2], t * 0.55);
      },
    });
  }

  window(uc, y0, w, h, {
    cols = 2, rows = 2, frame = 0xece7dc, fw = 0.22, sill = 0xd8cdb4, lintel = 0xd8cdb4, lintelH = 0.55,
    sillOut = 0.42, glass = 0x26394a, bars = 0.1, keystone = false, arch = false, surround = 0, surroundColor = null,
    transom = null,
  } = {}) {
    const u0 = uc - w / 2; const u1 = uc + w / 2;
    const top = y0 + h;
    if (!arch) {
      this.pane(u0, u1, y0, top);
      this.box('trim', frame, u0, u0 + fw, y0, top, 0, 0.16, { flat: true });
      this.box('trim', frame, u1 - fw, u1, y0, top, 0, 0.16, { flat: true });
      this.box('trim', frame, u0 + fw, u1 - fw, top - fw, top, 0, 0.16, { flat: true });
      this.box('trim', frame, u0 + fw, u1 - fw, y0, y0 + fw, 0, 0.16, { flat: true });
      for (let c = 1; c < cols; c++) {
        const u = mix(u0 + fw, u1 - fw, c / cols);
        this.box('trim', frame, u - bars / 2, u + bars / 2, y0 + fw, top - fw, 0, 0.11, { flat: true });
      }
      const ty = transom ?? null;
      for (let r = 1; r < rows; r++) {
        const y = ty !== null && r === 1 ? y0 + ty : mix(y0 + fw, top - fw, r / rows);
        const thick = ty !== null && r === 1 ? fw : bars;
        this.box('trim', frame, u0 + fw, u1 - fw, y - thick / 2, y + thick / 2, 0, ty !== null && r === 1 ? 0.14 : 0.11, { flat: true });
      }
      if (lintel !== null) {
        this.box('trim', lintel, u0 - 0.4, u1 + 0.4, top, top + lintelH, 0, 0.2);
        if (keystone) this.box('trim', lintel, uc - 0.35, uc + 0.35, top - 0.1, top + lintelH + 0.15, 0, 0.3);
      }
    } else {
      const R = w / 2; const ys = top - R; // spring line
      const archPts = (rad, n = 18) => { const pts = []; for (let i = 0; i <= n; i++) { const a = Math.PI - (Math.PI * i) / n; pts.push([uc + rad * Math.cos(a), ys + rad * Math.sin(a)]); } return pts; };
      // the pane: a rectangle with a half disc on it, tinted toward the top
      const c = colorOf(glass); const sky = [0.32, 0.4, 0.5];
      this.extrude('glass', c, [[u0, y0], [u1, y0], ...archPts(R).reverse()], 0, 0.05, {
        tint: (x, y, z, out) => { const t = (y - y0) / h; out[0] = mix(c[0], sky[0], t * 0.55); out[1] = mix(c[1], sky[1], t * 0.55); out[2] = mix(c[2], sky[2], t * 0.55); },
      });
      this.box('trim', frame, u0, u0 + fw, y0, ys, 0, 0.16, { flat: true });
      this.box('trim', frame, u1 - fw, u1, y0, ys, 0, 0.16, { flat: true });
      this.box('trim', frame, u0 + fw, u1 - fw, y0, y0 + fw, 0, 0.16, { flat: true });
      const outer = archPts(R); const inner = archPts(R - fw).reverse();
      this.extrude('trim', frame, [...outer, ...inner], 0, 0.16, { flat: true });
      // glazing bars: the centre bar up into the arch, a transom at the spring line, bars below
      for (let k = 1; k < cols; k++) {
        const u = mix(u0 + fw, u1 - fw, k / cols);
        const dy = Math.sqrt(Math.max(0, (R - fw) ** 2 - (u - uc) ** 2));
        this.box('trim', frame, u - bars / 2, u + bars / 2, y0 + fw, ys + dy, 0, 0.11, { flat: true });
      }
      this.box('trim', frame, u0 + fw, u1 - fw, ys - fw / 2, ys + fw / 2, 0, 0.13, { flat: true });
      for (let r = 1; r < rows; r++) {
        const y = mix(y0 + fw, ys, r / rows);
        this.box('trim', frame, u0 + fw, u1 - fw, y - bars / 2, y + bars / 2, 0, 0.11, { flat: true });
      }
      if (lintel !== null) {
        // a stone archivolt round the head, and a keystone
        const o2 = archPts(R + 0.55); const i2 = archPts(R).reverse();
        this.extrude('trim', lintel, [...o2, ...i2], 0, 0.2);
        this.box('trim', lintel, uc - 0.38, uc + 0.38, top - 0.15, top + 0.85, 0, 0.32);
      }
    }
    if (sill !== null) this.box('trim', sill, u0 - 0.35, u1 + 0.35, y0 - 0.3, y0, 0, sillOut);
    if (surround) {
      const sc = surroundColor ?? lintel ?? frame;
      this.box('trim', sc, u0 - surround, u0, y0, top, 0, 0.12);
      this.box('trim', sc, u1, u1 + surround, y0, top, 0, 0.12);
    }
  }

  // A panelled door leaf, closed, built forward: frame, leaf, panels, knob. In wall coordinates.
  door(uc, y0, w, h, { color = 0x2d4f3a, frame = 0xece7dc, glassTop = 0.42, leaves = 1, handle = 0xc9a447, fw = 0.25 } = {}) {
    const u0 = uc - w / 2; const u1 = uc + w / 2; const top = y0 + h;
    this.box('trim', frame, u0 - fw, u0, y0, top + fw, 0, 0.2, { flat: true });
    this.box('trim', frame, u1, u1 + fw, y0, top + fw, 0, 0.2, { flat: true });
    this.box('trim', frame, u0, u1, top, top + fw, 0, 0.2, { flat: true });
    const lw = w / leaves;
    for (let l = 0; l < leaves; l++) {
      const a = u0 + l * lw; const b = a + lw;
      this.box('trim', color, a + 0.02, b - 0.02, y0, top, 0, 0.12, { flat: true });
      const gy = y0 + h * (1 - glassTop);
      if (glassTop > 0) {
        this.pane(a + 0.35, b - 0.35, gy, top - 0.35, 0.12, 0.15);
        this.box('trim', color, a + 0.35, b - 0.35, gy - 0.04, gy + 0.0, 0.12, 0.17, { flat: true });
      }
      // two raised panels below
      const pTop = glassTop > 0 ? gy - 0.35 : top - 0.4;
      const ph = (pTop - (y0 + 0.4)) / 2 - 0.15;
      for (let p = 0; p < 2; p++) {
        const py0 = y0 + 0.4 + p * (ph + 0.3);
        this.box('trim', times(color, 1.18), a + 0.35, b - 0.35, py0, py0 + ph, 0.12, 0.17, { flat: true });
      }
      const hu = leaves === 1 ? b - 0.35 : (l === 0 ? b - 0.3 : a + 0.3);
      this.ball('trim', handle, hu, y0 + 3.4, 0.24, 0.12);
    }
  }

  // ---- whole-building pieces, in world coordinates -------------------------------------------
  // A ring of four boxes round a rectangle (half sizes hw, hd), out by `out`, in by `inn`, that do
  // not overlap at the corners, so nothing is coplanar.
  ring(bag, color, hw, hd, y0, y1, out, inn = 0.4, opts = {}) {
    const { frontGap = null, ...rest } = opts;
    const c = { flat: false, ...rest };
    if (frontGap) {
      this.box(bag, color, -hw - out, frontGap[0], y0, y1, hd - inn, hd + out, c);
      this.box(bag, color, frontGap[1], hw + out, y0, y1, hd - inn, hd + out, c);
    } else this.box(bag, color, -hw - out, hw + out, y0, y1, hd - inn, hd + out, c);
    this.box(bag, color, -hw - out, hw + out, y0, y1, -hd - out, -hd + inn, c);
    this.box(bag, color, -hw - out, -hw + inn, y0, y1, -hd + inn, hd - inn, c);
    this.box(bag, color, hw - inn, hw + out, y0, y1, -hd + inn, hd - inn, c);
  }

  // A cornice: stepped mouldings out from the wall top, then a crown.
  cornice(color, hw, hd, y, { steps = [[0.35, 0.12], [0.3, 0.3], [0.5, 0.55], [0.28, 0.75]], cx = 0, cz = 0 } = {}) {
    let yy = y;
    for (const [hgt, out] of steps) {
      this.within(new THREE.Matrix4().makeTranslation(cx, 0, cz), () => this.ring('trim', color, hw, hd, yy, yy + hgt, out));
      yy += hgt;
    }
    return yy;
  }

  // A wall along a face, with rectangular openings cut by leaving them out. In wall coordinates:
  // u0..u1 along it, y0..y1, n0..n1 through it. `holes` are { u0, u1, y0, y1 }.
  wallWithHoles(bag, color, u0, u1, y0, y1, n0, n1, holes, opts = {}) {
    const hs = [...holes].sort((a, b) => a.u0 - b.u0);
    let u = u0;
    for (const hl of hs) {
      if (hl.u0 > u + 1e-4) this.box(bag, color, u, hl.u0, y0, y1, n0, n1, opts);
      if (hl.y0 > y0 + 1e-4) this.box(bag, color, hl.u0, hl.u1, y0, hl.y0, n0, n1, opts);
      if (hl.y1 < y1 - 1e-4) this.box(bag, color, hl.u0, hl.u1, hl.y1, y1, n0, n1, opts);
      u = hl.u1;
    }
    if (u1 > u + 1e-4) this.box(bag, color, u, u1, y0, y1, n0, n1, opts);
  }

  // A classical column standing at (x, y0, z), shaft radius r at the foot, height h overall.
  column(x, y0, z, h, r, color, { sides = 18, capital = 'doric' } = {}) {
    const plinthH = r * 0.55; const baseH = r * 0.45; const capH = r * 1.1;
    this.box('trim', color, x - r * 1.35, x + r * 1.35, y0, y0 + plinthH, z - r * 1.35, z + r * 1.35);
    const base = new THREE.CylinderGeometry(r * 1.12, r * 1.25, baseH, sides);
    base.translate(x, y0 + plinthH + baseH / 2, z);
    this.add('trim', base, color);
    const shaftH = h - plinthH - baseH - capH;
    // entasis: a gentle taper, with the shaft slightly fuller a third of the way up
    const prof = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push(new THREE.Vector2(r * (1 - 0.14 * t * t + 0.02 * Math.sin(t * Math.PI)), t * shaftH)); }
    const shaft = new THREE.LatheGeometry([new THREE.Vector2(0, 0), ...prof, new THREE.Vector2(0, shaftH)], sides);
    shaft.translate(x, y0 + plinthH + baseH, z);
    this.add('trim', outward(shaft), color);
    const cy = y0 + h - capH;
    const echinus = new THREE.CylinderGeometry(r * 1.2, r * 0.88, capH * 0.45, sides);
    echinus.translate(x, cy + capH * 0.225, z);
    this.add('trim', echinus, color);
    if (capital === 'ionic') {
      for (const s of [-1, 1]) {
        const v = new THREE.CylinderGeometry(r * 0.36, r * 0.36, r * 2.5, 12);
        v.rotateX(Math.PI / 2);
        v.translate(x + s * r * 1.05, cy + capH * 0.5, z);
        this.add('trim', v, color);
      }
    }
    this.box('trim', color, x - r * 1.4, x + r * 1.4, cy + capH * 0.45, y0 + h, z - r * 1.4, z + r * 1.4);
  }

  // A flagpole at (x, z) from the ground: concrete base, pole, gold ball, and a waving flag drawn
  // by `draw` into an atlas rect. The flag flies toward +x.
  flagpole(x, z, height, draw, { flagW = 6, flagH = 3.6, pole = 0xdedfe0, yaw = 0, base = 0xb9b4aa, flagPx = 256 } = {}) {
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, 0, z);
    this.within(m, () => {
      this.box('trim', base, -0.9, 0.9, -0.4, 0.5, -0.9, 0.9);
      this.box('trim', base, -0.6, 0.6, 0.5, 0.8, -0.6, 0.6);
      this.rod('trim', pole, [0, 0.6, 0], [0, height, 0], 0.2, { r2: 0.1, sides: 12 });
      this.ball('trim', 0xc9a447, 0, height + 0.25, 0, 0.3);
      const r = this.rect(flagPx, (flagPx * flagH) / flagW, draw);
      const top = height - 0.6;
      // Both faces carry the picture; seen from behind it is mirrored, which is what a real flag does.
      this.decalBox(r, 0.12, 0.12 + flagW, top - flagH, top, -0.025, 0.025, {
        face: 'both', segs: [12, 1, 1], edge: 0xdddddd,
        warp: (fx) => { const t = (fx - 0.12) / flagW; return [0, -t * t * 0.25, Math.sin(t * 5.2 + 0.4) * 0.32 * t]; },
      });
      this.rod('trim', 0x888888, [0.1, top, 0], [0.1, top - flagH, 0], 0.03, { sides: 4 });
    });
  }

  finish({ glass = {}, wall = {}, trim = {}, sign = {}, glow = {} } = {}) {
    const group = new THREE.Group();
    const A = this.atlas;
    const make = (bag, material) => {
      const list = this.parts[bag];
      if (!list.length) return;
      const geometry = mergeParts(list);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    const wt = this.tiles.wall; const tt = this.tiles.trim;
    make('wall', new THREE.MeshStandardMaterial({ vertexColors: true, map: wt.texture, bumpMap: wt.texture, bumpScale: wt.bumpScale, roughness: 0.9, metalness: 0, ...wall }));
    make('trim', new THREE.MeshStandardMaterial({ vertexColors: true, map: tt.texture, bumpMap: tt.texture, bumpScale: tt.bumpScale, roughness: 0.78, metalness: 0, ...trim }));
    make('glass', new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.3, ...glass }));
    if (this.parts.sign.length) {
      const canvas = document.createElement('canvas');
      canvas.width = A.W; canvas.height = A.H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, A.W, A.H);
      for (const it of A.items) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(it.px, it.py, it.pw, it.ph);
        ctx.clip();
        it.draw(ctx, it.px, it.py, it.pw, it.ph);
        ctx.restore();
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 6, 6);
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.needsUpdate = true;
      make('sign', new THREE.MeshStandardMaterial({ vertexColors: true, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12, roughness: 0.6, metalness: 0, ...sign }));
    }
    if (this.parts.glow.length) {
      const t = glowTexture();
      const m = make('glow', new THREE.MeshStandardMaterial({ vertexColors: true, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.95, roughness: 0.4, metalness: 0, ...glow }));
      if (m) m.castShadow = false;
    }
    return group;
  }
}

// ---------------------------------------------------------------------------------------------
// Pictures for the atlas
// ---------------------------------------------------------------------------------------------
function star(ctx, cx, cy, r, ri = 0.38) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * ri : r;
    const px = cx + rr * Math.cos(a); const py = cy + rr * Math.sin(a);
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// The flag of the United States: 13 stripes, 50 stars in rows of six and five.
export function drawUSFlag(ctx, x, y, w, h) {
  for (let i = 0; i < 13; i++) {
    ctx.fillStyle = i % 2 ? '#f4f2ee' : '#b22234';
    ctx.fillRect(x, y + (i * h) / 13, w, h / 13 + 1);
  }
  const cw = w * 0.4; const ch = (h * 7) / 13;
  ctx.fillStyle = '#3c3b6e';
  ctx.fillRect(x, y, cw, ch);
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++) {
    const n = r % 2 ? 5 : 6;
    for (let c = 0; c < n; c++) {
      const sx = x + cw * ((c * 2 + (r % 2 ? 2 : 1)) / 12);
      const sy = y + ch * ((r + 1) / 10);
      star(ctx, sx, sy, ch * 0.045);
    }
  }
}

// A made-up city flag: a field of green over white with a gold sun.
export function drawCityFlag(ctx, x, y, w, h) {
  ctx.fillStyle = '#1f6d4a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f2efe4';
  ctx.fillRect(x, y + h * 0.62, w, h * 0.14);
  ctx.fillStyle = '#e2b23a';
  ctx.beginPath();
  ctx.arc(x + w * 0.5, y + h * 0.4, h * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e2b23a';
  ctx.lineWidth = h * 0.03;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5 + Math.cos(a) * h * 0.21, y + h * 0.4 + Math.sin(a) * h * 0.21);
    ctx.lineTo(x + w * 0.5 + Math.cos(a) * h * 0.29, y + h * 0.4 + Math.sin(a) * h * 0.29);
    ctx.stroke();
  }
}

// A clock face reading ten past ten, with Roman-free stick numerals so it reads at any size.
export function drawClock(ctx, x, y, w, h, { face = '#f4efe0', ink = '#1d1d22', rim = '#2b2b30', hour = 10, minute = 9 } = {}) {
  const cx = x + w / 2; const cy = y + h / 2; const R = Math.min(w, h) / 2;
  ctx.fillStyle = rim;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = face;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.93, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = R * 0.025;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    ctx.lineWidth = big ? R * 0.06 : R * 0.018;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * R * (big ? 0.66 : 0.78), cy - Math.cos(a) * R * (big ? 0.66 : 0.78));
    ctx.lineTo(cx + Math.sin(a) * R * 0.84, cy - Math.cos(a) * R * 0.84);
    ctx.stroke();
  }
  const ha = ((hour % 12) + minute / 60) / 12 * Math.PI * 2;
  const ma = (minute / 60) * Math.PI * 2;
  ctx.lineCap = 'round';
  ctx.lineWidth = R * 0.08;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(ha) * R * 0.45, cy - Math.cos(ha) * R * 0.45); ctx.stroke();
  ctx.lineWidth = R * 0.05;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(ma) * R * 0.7, cy - Math.cos(ma) * R * 0.7); ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, Math.PI * 2); ctx.fill();
}

// Rows of book spines, different heights, colours and widths, on a dark shelf back.
export function drawBooks(seed) {
  return (ctx, x, y, w, h) => {
    const rng = seededRandom(seed);
    ctx.fillStyle = '#3a2a1d';
    ctx.fillRect(x, y, w, h);
    const cols = ['#7a2b25', '#24456b', '#2f5a37', '#8a6a2a', '#5a2f5e', '#a0522d', '#2e3f4f', '#6b6b2e', '#b08d4e', '#3d6f7a', '#8b3a3a', '#d8cba8'];
    let px = x;
    while (px < x + w) {
      const bw = h * (0.09 + rng() * 0.09);
      const bh = h * (0.72 + rng() * 0.26);
      if (rng() < 0.05) { px += bw * 0.6; continue; }
      const c = cols[Math.floor(rng() * cols.length)];
      ctx.fillStyle = c;
      ctx.fillRect(px, y + h - bh, bw - 1, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(px + bw * 0.15, y + h - bh * 0.82, bw * 0.55, h * 0.03);
      ctx.fillRect(px + bw * 0.15, y + h - bh * 0.3, bw * 0.55, h * 0.03);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(px + bw - 2, y + h - bh, 1.5, bh);
      px += bw;
    }
  };
}
