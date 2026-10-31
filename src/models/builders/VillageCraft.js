import * as THREE from 'three';
import { mesh, standard, seededRandom, canvasTexture } from '../../PropKit.js';
import { tube, alongMatrix, sstep, clamp01, mix } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The village kit's trades: five working buildings a child walks into, at real size, on the grass of
// whatever world they are placed in.
//
//   schoolhouse       30 x 20ft, white clapboard, bell cupola to 26ft, twelve desks.
//   blacksmith-forge  20 x 16ft, stone, open front, glowing hearth, bellows, anvil.
//   village-bakery    20 x 16ft, half timbered, a domed oven filling the back wall.
//   grain-windmill    a tower mill whose sails really turn.
//   market-stall      10 x 6ft, a timber frame under a striped awning.
//
// Everything is built from THE SOUP, because a child will place dozens and every mesh is drawn twice.
// A soup is one vertex-coloured mesh whose ONE near-white canvas holds several surfaces as horizontal
// bands: clapboard, shingle, stone, brick, plank, plaster. A band wraps in u by the sampler, and it
// wraps in v because every face is cut into rows at the band's own tile height, so each row stays
// inside its band. UVs are in feet from world position, which is what lands a 0.5ft clapboard course
// at 0.5ft on every wall and keeps the courses level across a window. A building therefore costs two
// meshes (the soup, and the small emissive one for panes, coals and a blackboard) where a material
// per surface would cost six.

// ---------------------------------------------------------------------------------------------
// The village's palette
// ---------------------------------------------------------------------------------------------
const TIMBER = 0x8a6a48;
const DARK = 0x5b432e;
const WASH = 0xdcd3bd;
const TRIM = 0xe6dfcc;
const STONE = 0x8f8a7e;
const RED = 0xa23b2a;
const WHEAT = 0xd9b24a;
const LEAF = 0x5c8f3a;
const IRON = 0x3a3a3e;
const BRICK = 0xa8583c;
const CRUST = 0xb8783a;

const colourCache = new Map();
function linear(hex) {
  let c = colourCache.get(hex);
  if (!c) { const k = new THREE.Color(hex); c = [k.r, k.g, k.b]; colourCache.set(hex, c); }
  return c;
}
const tone = (hex, k) => { const c = linear(hex); return [c[0] * k, c[1] * k, c[2] * k]; };

const v3cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const v3norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const shoelace = (pts) => {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]; const q = pts[(i + 1) % pts.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area / 2;
};
// A stable pseudo-random from a position, so two beams do not show the same stretch of grain.
const hash3 = (a, b, c) => { const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return v - Math.floor(v); };

// ---------------------------------------------------------------------------------------------
// The atlas: near-white surfaces in horizontal bands
// ---------------------------------------------------------------------------------------------
const grey = (v) => { const k = Math.max(0, Math.min(255, Math.round(v))); return `rgb(${k},${k},${k})`; };

// All of these are multiplied by a vertex colour, and a map is sRGB-decoded first, so a texel of 150
// is 30% of the colour rather than 59%. Only the joints go properly dark.
const PAINTERS = {
  clapboard(ctx, b, rng) {
    const n = Math.round(b.tv / 0.5);
    const rowH = b.h / n;
    for (let i = 0; i < n; i++) {
      const y = b.y + i * rowH;
      ctx.fillStyle = grey(240 + rng() * 14);
      ctx.fillRect(0, y, b.w, rowH + 1);
      ctx.fillStyle = grey(226);
      for (let k = 0; k < 10; k++) ctx.fillRect(rng() * b.w, y + rowH * (0.3 + rng() * 0.6), 30 + rng() * 150, 1);
      // Canvas y runs down the wall, so the top of a board is its shadow, cast by the butt above it.
      ctx.fillStyle = grey(112);
      ctx.fillRect(0, y, b.w, Math.max(1.5, rowH * 0.1));
      ctx.fillStyle = grey(204);
      ctx.fillRect(0, y + rowH * 0.1, b.w, rowH * 0.1);
    }
  },
  shingle(ctx, b, rng) {
    const n = Math.round(b.tv / 0.5);
    const rowH = b.h / n;
    for (let i = 0; i < n; i++) {
      const y = b.y + i * rowH;
      let x = -rng() * 40;
      while (x < b.w) {
        const w = 30 + rng() * 42;
        ctx.fillStyle = grey(198 + rng() * 54);
        ctx.fillRect(x, y, w, rowH + 1);
        ctx.fillStyle = grey(150);
        ctx.fillRect(x + w - 2, y, 2, rowH + 1);
        x += w;
      }
      ctx.fillStyle = grey(84);
      ctx.fillRect(0, y, b.w, Math.max(2, rowH * 0.16));
      ctx.fillStyle = grey(176);
      ctx.fillRect(0, y + rowH * 0.16, b.w, rowH * 0.1);
    }
  },
  // Clay tiles: round-butted, half lapped, so the eave reads as a row of scallops.
  tile(ctx, b, rng) {
    const n = Math.round(b.tv / 0.5);
    const rowH = b.h / n;
    const across = Math.round(b.tu / 0.5);
    const tileW = b.w / across;
    ctx.fillStyle = grey(96);
    ctx.fillRect(0, b.y, b.w, b.h);
    for (let i = 0; i < n; i++) {
      const y = b.y + i * rowH;
      const off = i % 2 ? tileW / 2 : 0;
      for (let k = -1; k <= across; k++) {
        const x = k * tileW + off;
        ctx.fillStyle = grey(205 + rng() * 50);
        ctx.fillRect(x + 1, y + rowH * 0.14, tileW - 2, rowH * 0.62);
        ctx.beginPath();
        ctx.ellipse(x + tileW / 2, y + rowH * 0.76, tileW / 2 - 1, rowH * 0.24, 0, 0, Math.PI);
        ctx.fill();
      }
    }
  },
  stone(ctx, b, rng) {
    ctx.fillStyle = grey(128);
    ctx.fillRect(0, b.y, b.w, b.h);
    let t = 0;
    const heights = [];
    while (t < b.tv - 0.5) { const h = 0.62 + rng() * 0.5; heights.push(h); t += h; }
    const scale = b.tv / t;
    let row = 0;
    for (const h0 of heights) {
      const h = h0 * scale;
      const yTop = b.y + (row / b.tv) * b.h;
      const yH = (h / b.tv) * b.h;
      let s = -rng() * 1.2;
      const start = s;
      while (s < start + b.tu - 0.5) {
        let w = 0.75 + rng() * 1.45;
        if (s + w > start + b.tu - 0.5) w = start + b.tu - s;
        const k = 196 + rng() * 58;
        const warm = rng() * 10 - 5;
        const c = `rgb(${Math.min(255, Math.round(k + warm))},${Math.round(k)},${Math.max(0, Math.round(k - warm * 1.4))})`;
        for (const ox of [-b.w, 0, b.w]) {
          const x = (s / b.tu) * b.w + ox;
          const px = (w / b.tu) * b.w;
          const inset = 1.6 + rng() * 1.1;
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.roundRect(x + inset, yTop + inset, px - inset * 2, yH - inset * 2, 7);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.fillRect(x + inset + 4, yTop + inset + 1, px - inset * 2 - 8, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(x + inset + 4, yTop + yH - inset - 3, px - inset * 2 - 8, 2);
        }
        s += w;
      }
      row += h;
    }
  },
  brick(ctx, b, rng) {
    ctx.fillStyle = grey(150);
    ctx.fillRect(0, b.y, b.w, b.h);
    const rows = Math.round(b.tv / 0.25);
    const across = Math.round(b.tu / 0.75);
    const rowH = b.h / rows; const brickW = b.w / across;
    for (let i = 0; i < rows; i++) {
      const y = b.y + i * rowH;
      const off = i % 2 ? brickW / 2 : 0;
      for (let k = -1; k <= across; k++) {
        ctx.fillStyle = grey(198 + rng() * 57);
        ctx.fillRect(k * brickW + off + 1.2, y + 1.2, brickW - 2.4, rowH - 2.4);
      }
    }
  },
  plaster(ctx, b, rng) {
    ctx.fillStyle = grey(244);
    ctx.fillRect(0, b.y, b.w, b.h);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = grey(245 + rng() * 7);
      const r = 1.5 + rng() * 5;
      ctx.beginPath();
      ctx.ellipse(rng() * b.w, b.y + r + rng() * (b.h - r * 2), r * (1 + rng()), r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  grain(ctx, b, rng) {
    ctx.fillStyle = grey(238);
    ctx.fillRect(0, b.y, b.w, b.h);
    for (let i = 0; i < 150; i++) {
      ctx.fillStyle = grey(196 + rng() * 58);
      ctx.fillRect(rng() * b.w - 60, b.y + rng() * b.h, 70 + rng() * 300, 1 + rng() * 1.6);
    }
  },
  plank(ctx, b, rng) {
    const n = Math.round(b.tv / 0.5);
    const rowH = b.h / n;
    for (let i = 0; i < n; i++) {
      const y = b.y + i * rowH;
      ctx.fillStyle = grey(216 + rng() * 38);
      ctx.fillRect(0, y, b.w, rowH + 1);
      ctx.fillStyle = grey(202);
      for (let k = 0; k < 8; k++) ctx.fillRect(rng() * b.w, y + rng() * rowH, 40 + rng() * 120, 1);
      ctx.fillStyle = grey(96);
      ctx.fillRect(0, y, b.w, 1.6);
      ctx.fillRect(rng() * b.w, y, 1.6, rowH);
    }
  },
  dirt(ctx, b, rng) {
    ctx.fillStyle = grey(226);
    ctx.fillRect(0, b.y, b.w, b.h);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = grey(176 + rng() * 79);
      const r = 0.8 + rng() * 2.6;
      ctx.fillRect(rng() * b.w, b.y + rng() * (b.h - r), r, r);
    }
  },
};

// `bands` is a list of { name, tu, tv, px, paint?, grain? }; `rects` of { name, x, y, w, h, draw } in
// pixels, below the bands. The whole sheet is near white, so a flat part (a timber painted one colour)
// takes a single texel of the reserved strip at the bottom and is simply its vertex colour.
function makeAtlas(seed, bands, { w = 512, h = 1024, rects = [] } = {}) {
  const rng = seededRandom(seed);
  const info = { bands: {}, flat: [0.5, 2 / h], tex: null };
  const texture = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = grey(250);
    ctx.fillRect(0, 0, w, h);
    let y = 0;
    for (const band of bands) {
      const px = band.px;
      const b = { y, h: px, w, tu: band.tu, tv: band.tv };
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, w, px);
      ctx.clip();
      PAINTERS[band.paint ?? band.name](ctx, b, rng);
      ctx.restore();
      const inset = 1.5 / h;
      info.bands[band.name] = { tileU: band.tu, tileV: band.tv, v0: 1 - (y + px) / h + inset, v1: 1 - y / h - inset, grain: !!band.grain };
      y += px;
    }
    for (const r of rects) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.beginPath();
      ctx.rect(0, 0, r.w, r.h);
      ctx.clip();
      r.draw(ctx, r.w, r.h, rng);
      ctx.restore();
      info.bands[r.name] = { rect: [r.x / w, 1 - (r.y + r.h) / h, (r.x + r.w) / w, 1 - r.y / h] };
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  info.tex = texture;
  return info;
}

// ---------------------------------------------------------------------------------------------
// The soup
// ---------------------------------------------------------------------------------------------
const asStyle = (st) => (typeof st === 'number' || Array.isArray(st) || typeof st === 'function' ? { c: st } : st);

class Soup {
  constructor(atlas = null) {
    this.atlas = atlas;
    this.P = []; this.N = []; this.U = []; this.C = []; this.I = [];
    this.m = null; this.nm = null;
    this.flat = atlas ? atlas.flat : [0, 0];
  }

  get triangles() { return this.I.length / 3; }

  // Runs `fn` with a matrix applied to everything it emits. Winding is measured after the matrix, so
  // a mirror is safe.
  at(matrix, fn) {
    const pm = this.m; const pn = this.nm;
    this.m = pm ? pm.clone().multiply(matrix) : matrix;
    this.nm = new THREE.Matrix3().getNormalMatrix(this.m);
    fn(this);
    this.m = pm; this.nm = pn;
  }

  _pos(p) {
    if (!this.m) return p;
    const e = this.m.elements;
    return [
      e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12],
      e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13],
      e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14],
    ];
  }

  _nrm(n) {
    if (!this.nm) return n;
    const e = this.nm.elements;
    return v3norm([e[0] * n[0] + e[3] * n[1] + e[6] * n[2], e[1] * n[0] + e[4] * n[1] + e[7] * n[2], e[2] * n[0] + e[5] * n[1] + e[8] * n[2]]);
  }

  _colour(st, p) {
    const c = st.c;
    if (typeof c === 'function') return c(p[0], p[1], p[2]);
    if (Array.isArray(c)) return c;
    return linear(c ?? 0xffffff);
  }

  _surf(st) {
    const s = st.s;
    if (!s) return null;
    if (typeof s === 'object') return s;
    return this.atlas?.bands?.[s] ?? null;
  }

  // One planar or curved polygon of three or four corners, wound by measurement: its normals say
  // which way is out, and the triangle is flipped if it disagrees. A hand-built grid should never
  // assume its own handedness.
  _poly(pts, norms, uvs, st) {
    const W = pts.map((p) => this._pos(p));
    const nW = norms.map((n) => this._nrm(n));
    const g = v3cross(v3sub(W[1], W[0]), v3sub(W[2], W[0]));
    let area = Math.hypot(g[0], g[1], g[2]);
    if (W.length === 4 && area < 1e-9) {
      const g2 = v3cross(v3sub(W[2], W[0]), v3sub(W[3], W[0]));
      area = Math.hypot(g2[0], g2[1], g2[2]);
      if (area < 1e-9) return;
      g[0] = g2[0]; g[1] = g2[1]; g[2] = g2[2];
    } else if (area < 1e-9) return;
    const avg = [0, 0, 0];
    for (const n of nW) { avg[0] += n[0]; avg[1] += n[1]; avg[2] += n[2]; }
    const flip = v3dot(g, avg) < 0;
    const base = this.P.length / 3;
    for (let i = 0; i < W.length; i++) {
      const p = W[i];
      this.P.push(p[0], p[1], p[2]);
      this.N.push(nW[i][0], nW[i][1], nW[i][2]);
      this.U.push(uvs[i][0], uvs[i][1]);
      const c = this._colour(st, p);
      this.C.push(c[0], c[1], c[2]);
    }
    if (W.length === 3) {
      if (flip) this.I.push(base, base + 2, base + 1); else this.I.push(base, base + 1, base + 2);
    } else if (flip) {
      this.I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    } else {
      this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // A flat rectangle. `s` and `t` are feet along ds and dt, which is what the band is laid out in.
  face(o, ds, dt, Ls, Lt, n, st, s0 = 0, t0 = 0) {
    const surf = this._surf(st);
    if (surf?.grain && Lt > Ls) {
      [ds, dt] = [dt, ds]; [Ls, Lt] = [Lt, Ls]; [s0, t0] = [t0, s0];
    }
    const norms = [n, n, n, n];
    const corner = (a, b) => [o[0] + ds[0] * a + dt[0] * b, o[1] + ds[1] * a + dt[1] * b, o[2] + ds[2] * a + dt[2] * b];
    if (!surf) {
      const f = st.uv ?? this.flat;
      this._poly([corner(0, 0), corner(Ls, 0), corner(Ls, Lt), corner(0, Lt)], norms, [f, f, f, f], st);
      return;
    }
    if (surf.rect) {
      // A picture must read the right way round from outside, whichever side of a board this is.
      const right = v3cross(dt, n);
      const flipU = v3dot(ds, right) < 0;
      const [u0, v0, u1, v1] = surf.rect;
      const a = flipU ? u1 : u0; const b = flipU ? u0 : u1;
      this._poly([corner(0, 0), corner(Ls, 0), corner(Ls, Lt), corner(0, Lt)], norms, [[a, v0], [b, v0], [b, v1], [a, v1]], st);
      return;
    }
    const { tileU, tileV, v0, v1 } = surf;
    let t = t0;
    const end = t0 + Lt;
    while (t < end - 1e-5) {
      const k = Math.floor(t / tileV + 1e-6);
      const next = Math.min(end, (k + 1) * tileV);
      const f0 = t / tileV - k; const f1 = next / tileV - k;
      const a = mix(v0, v1, f0); const b = mix(v0, v1, f1);
      const ua = s0 / tileU; const ub = (s0 + Ls) / tileU;
      this._poly(
        [corner(0, t - t0), corner(Ls, t - t0), corner(Ls, next - t0), corner(0, next - t0)],
        norms, [[ua, a], [ub, a], [ub, b], [ua, b]], st,
      );
      t = next;
    }
  }

  // An axis-aligned box, in the current matrix. Any of px nx py ny pz nz in the style overrides that
  // face, and `skip` is a string of face names to leave out where nothing can ever see them.
  box(x0, x1, y0, y1, z0, z1, style) {
    const S = asStyle(style);
    const fs = (name) => (S[name] ? { ...S, ...asStyle(S[name]) } : S);
    const skip = S.skip ?? '';
    const off = this._surf(S)?.grain ? hash3(x0, y0, z0) * 8 : 0;
    const off2 = this._surf(S)?.grain ? hash3(z1, x1, y1) * 2 : 0;
    const X = x1 - x0; const Y = y1 - y0; const Z = z1 - z0;
    if (!skip.includes('px')) this.face([x1, y0, z0], [0, 0, 1], [0, 1, 0], Z, Y, [1, 0, 0], fs('px'), z0 + off, y0 + off2);
    if (!skip.includes('nx')) this.face([x0, y0, z0], [0, 0, 1], [0, 1, 0], Z, Y, [-1, 0, 0], fs('nx'), z0 + off, y0 + off2);
    if (!skip.includes('py')) this.face([x0, y1, z0], [1, 0, 0], [0, 0, 1], X, Z, [0, 1, 0], fs('py'), x0 + off, z0 + off2);
    if (!skip.includes('ny')) this.face([x0, y0, z0], [1, 0, 0], [0, 0, 1], X, Z, [0, -1, 0], fs('ny'), x0 + off, z0 + off2);
    if (!skip.includes('pz')) this.face([x0, y0, z1], [1, 0, 0], [0, 1, 0], X, Y, [0, 0, 1], fs('pz'), x0 + off, y0 + off2);
    if (!skip.includes('nz')) this.face([x0, y0, z0], [1, 0, 0], [0, 1, 0], X, Y, [0, 0, -1], fs('nz'), x0 + off, y0 + off2);
  }

  // A squared timber from a to b.
  beam(a, b, w, h, style, up = [0, 1, 0]) {
    const { m, len } = alongMatrix(a, b, up);
    this.at(m, () => this.box(-w / 2, w / 2, -h / 2, h / 2, 0, len, style));
  }

  // A quad whose bottom edge is a-b and top edge d-c, cut into rows up its slope: a roof pitch, a
  // hood, a pyramid (c = d).
  slope(a, b, c, d, style) {
    const st = asStyle(style);
    const surf = this._surf(st);
    const g1 = v3cross(v3sub(b, a), v3sub(d, a));
    const g2 = v3cross(v3sub(c, b), v3sub(a, b));
    const n = v3norm(v3dot(g1, g1) > 1e-9 ? g1 : g2);
    const nf = st.outward ? (v3dot(n, st.outward) < 0 ? [-n[0], -n[1], -n[2]] : n) : n;
    const norms = [nf, nf, nf, nf];
    if (!surf || surf.rect) {
      const f = this.flat;
      this._poly([a, b, c, d], norms, [f, f, f, f], st);
      return;
    }
    const midB = v3lerp(a, b, 0.5); const midT = v3lerp(d, c, 0.5);
    const Lt = Math.hypot(...v3sub(midT, midB));
    const { tileU, tileV, v0, v1 } = surf;
    let t = st.t0 ?? 0;
    const start = t;
    const end = t + Lt;
    const su = st.s0 ?? 0;
    while (t < end - 1e-5) {
      const k = Math.floor(t / tileV + 1e-6);
      const next = Math.min(end, (k + 1) * tileV);
      const ta = (t - start) / Lt; const tb = (next - start) / Lt;
      const La = v3lerp(a, d, ta); const Ra = v3lerp(b, c, ta);
      const Lb = v3lerp(a, d, tb); const Rb = v3lerp(b, c, tb);
      const wa = Math.hypot(...v3sub(Ra, La)) / 2; const wb = Math.hypot(...v3sub(Rb, Lb)) / 2;
      const va = mix(v0, v1, t / tileV - k); const vb = mix(v0, v1, next / tileV - k);
      this._poly(
        [La, Ra, Rb, Lb], norms,
        [[(su - wa) / tileU, va], [(su + wa) / tileU, va], [(su + wb) / tileU, vb], [(su - wb) / tileU, vb]], st,
      );
      t = next;
    }
  }

  // A ridged roof as ONE closed chevron, so there is no seam to open at the ridge. `axis` is the way
  // the ridge runs; `half` the plan half-span; yE and yR the top surface at eave and ridge.
  roof({ axis, l0, l1, half, yE, yR, t, top, under, end, fascia }) {
    const map = axis === 'z' ? (c, y, l) => [c, y, l] : (c, y, l) => [l, y, c];
    const L = (c, y, l) => map(c, y, l);
    const topSt = asStyle(top);
    for (const side of [-1, 1]) {
      const outward = map(side * (yR - yE), half, 0);
      this.slope(L(side * half, yE, l0), L(side * half, yE, l1), L(0, yR, l1), L(0, yR, l0), { ...topSt, outward });
      this.slope(L(side * half, yE - t, l0), L(side * half, yE - t, l1), L(0, yR - t, l1), L(0, yR - t, l0), { ...asStyle(under), outward: map(-side * (yR - yE), -half, 0) });
      this.slope(L(side * half, yE - t, l0), L(side * half, yE - t, l1), L(side * half, yE, l1), L(side * half, yE, l0), { ...asStyle(fascia ?? end), outward: map(side, 0, 0) });
      for (const [l, sgn] of [[l0, -1], [l1, 1]]) {
        this.slope(L(side * half, yE - t, l), L(0, yR - t, l), L(0, yR, l), L(side * half, yE, l), { ...asStyle(end), outward: map(0, 0, sgn) });
      }
    }
  }

  // An outline (u, v) extruded from w0 to w1. `map(u, v, w)` places it; it must be rigid but may be
  // mirrored. A convex outline may carry a band: its caps are cut into rows of v like everything else.
  prism(outline, map, w0, w1, style, { cap = null, convex = true } = {}) {
    const st = asStyle(style);
    const capSt = cap ? { ...st, ...asStyle(cap) } : st;
    const pts = shoelace(outline) < 0 ? [...outline].reverse() : outline;
    const n = pts.length;
    const out3 = (u, v, du, dv, w) => v3norm(v3sub(map(u + du, v + dv, w), map(u, v, w)));
    let run = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i]; const q = pts[(i + 1) % n];
      const e = [q[0] - p[0], q[1] - p[1]];
      const len = Math.hypot(e[0], e[1]);
      if (len < 1e-6) continue;
      const nrm = out3(p[0], p[1], e[1] / len, -e[0] / len, w0);
      const banded = this._surf(st);
      if (banded && !banded.grain && !banded.rect && Math.abs(e[1]) > Math.abs(e[0]) * 4) {
        // An upright edge: courses must stay level, so the rows run up it rather than through the wall.
        const lo = e[1] > 0 ? p : q; const hi = e[1] > 0 ? q : p;
        this.face(map(lo[0], lo[1], w0), v3norm(v3sub(map(lo[0], lo[1], w1), map(lo[0], lo[1], w0))), v3norm(v3sub(map(hi[0], hi[1], w0), map(lo[0], lo[1], w0))), Math.abs(w1 - w0), len, nrm, st, w0, lo[1]);
      } else {
        this.face(map(p[0], p[1], w0), v3norm(v3sub(map(q[0], q[1], w0), map(p[0], p[1], w0))), v3norm(v3sub(map(p[0], p[1], w1), map(p[0], p[1], w0))), len, Math.abs(w1 - w0), nrm, st, run, 0);
      }
      run += len;
    }
    const axisN = v3norm(v3sub(map(0, 0, w1), map(0, 0, w0)));
    const surf = this._surf(capSt);
    for (const [w, sign] of [[w0, -1], [w1, 1]]) {
      const nrm = [axisN[0] * sign, axisN[1] * sign, axisN[2] * sign];
      if (surf && !surf.rect && convex) {
        const lo = Math.min(...pts.map((p) => p[1])); const hi = Math.max(...pts.map((p) => p[1]));
        const { tileU, tileV, v0, v1 } = surf;
        let t = lo;
        while (t < hi - 1e-5) {
          const k = Math.floor(t / tileV + 1e-6);
          const next = Math.min(hi, (k + 1) * tileV);
          const row = clipRow(pts, t, next);
          if (row.length >= 3) {
            const uv = (p) => [p[0] / tileU, mix(v0, v1, clamp01(p[1] / tileV - k))];
            for (let i = 1; i < row.length - 1; i++) {
              const tri = [row[0], row[i], row[i + 1]];
              this._poly(tri.map((p) => map(p[0], p[1], w)), [nrm, nrm, nrm], tri.map(uv), capSt);
            }
          }
          t = next;
        }
      } else {
        const f = capSt.uv ?? this.flat;
        if (convex) {
          for (let i = 1; i < n - 1; i++) {
            const tri = [pts[0], pts[i], pts[i + 1]];
            this._poly(tri.map((p) => map(p[0], p[1], w)), [nrm, nrm, nrm], [f, f, f], capSt);
          }
        } else {
          const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
          for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, [])) {
            const tri = [pts[a], pts[b], pts[c]];
            this._poly(tri.map((p) => map(p[0], p[1], w)), [nrm, nrm, nrm], [f, f, f], capSt);
          }
        }
      }
    }
  }

  // A surface of revolution about +Y from a profile written bottom-up as [r, y], with analytic smooth
  // normals. `hard` is a list of profile indices the shading breaks at. `from` and `sweep` are bearings
  // from +Z toward +X. `cut(a)` is a height below which a column is missing, which is how a door gets
  // into a round wall. `angles` overrides the even columns. `inward` is for the inside of a wall.
  spin(profile, style, {
    sides = 24, from = 0, sweep = Math.PI * 2, cut = null, angles = null, inward = false, hard = [], uTiles = null, centre = [0, 0, 0],
  } = {}) {
    const st = asStyle(style);
    const surf = this._surf(st);
    const segs = [];
    for (let i = 0; i < profile.length - 1; i++) {
      const dr = profile[i + 1][0] - profile[i][0]; const dy = profile[i + 1][1] - profile[i][1];
      const l = Math.hypot(dr, dy) || 1;
      segs.push([dy / l, -dr / l, l]);
    }
    const pointNormal = (i, seg) => {
      // Smooth across an interior point unless it is marked hard.
      const a = i > 0 ? segs[i - 1] : null; const b = i < segs.length ? segs[i] : null;
      if (hard.includes(i) || !a || !b) { const s = segs[seg]; return [s[0], s[1]]; }
      const n = [a[0] + b[0], a[1] + b[1]];
      const l = Math.hypot(n[0], n[1]) || 1;
      return [n[0] / l, n[1] / l];
    };
    const cols = angles ?? Array.from({ length: sides + 1 }, (_, i) => from + (i / sides) * sweep);
    const mean = profile.reduce((acc, p) => acc + p[0], 0) / profile.length;
    const tiles = surf && !surf.rect ? (uTiles ?? Math.max(1, Math.round((Math.PI * 2 * mean) / surf.tileU))) : 1;
    const ang = (a) => [Math.sin(a), Math.cos(a)];
    let arc = 0;
    const flat = st.uv ?? this.flat;
    for (let k = 0; k < segs.length; k++) {
      const [r0, y0] = profile[k]; const [r1, y1] = profile[k + 1];
      const L = segs[k][2];
      const n0 = pointNormal(k, k); const n1 = pointNormal(k + 1, k);
      const rows = [];
      if (surf && !surf.rect) {
        let t = arc; const end = arc + L;
        while (t < end - 1e-5) {
          const q = Math.floor(t / surf.tileV + 1e-6);
          const next = Math.min(end, (q + 1) * surf.tileV);
          rows.push([(t - arc) / L, (next - arc) / L, mix(surf.v0, surf.v1, t / surf.tileV - q), mix(surf.v0, surf.v1, next / surf.tileV - q)]);
          t = next;
        }
      } else rows.push([0, 1, flat[1], flat[1]]);
      for (const [ta, tb, va, vb] of rows) {
        const ra = mix(r0, r1, ta); const rb = mix(r0, r1, tb);
        const ya = mix(y0, y1, ta); const yb = mix(y0, y1, tb);
        const na = [mix(n0[0], n1[0], ta), mix(n0[1], n1[1], ta)];
        const nb = [mix(n0[0], n1[0], tb), mix(n0[1], n1[1], tb)];
        for (let j = 0; j < cols.length - 1; j++) {
          const a0 = cols[j]; const a1 = cols[j + 1];
          const [s0, c0] = ang(a0); const [s1, c1] = ang(a1);
          let yA0 = ya; let yB0 = yb; let yA1 = ya; let yB1 = yb;
          let rA0 = ra; let rB0 = rb; let rA1 = ra; let rB1 = rb;
          if (cut) {
            const h0 = cut(a0); const h1 = cut(a1);
            const clampTo = (y, h) => Math.max(y, h);
            yA0 = clampTo(ya, h0); yB0 = clampTo(yb, h0); yA1 = clampTo(ya, h1); yB1 = clampTo(yb, h1);
            const rAt = (y) => (Math.abs(y1 - y0) > 1e-6 ? mix(r0, r1, (y - y0) / (y1 - y0)) : r0);
            rA0 = rAt(yA0); rB0 = rAt(yB0); rA1 = rAt(yA1); rB1 = rAt(yB1);
            if (yB0 - yA0 < 1e-5 && yB1 - yA1 < 1e-5) continue;
          }
          const sign = inward ? -1 : 1;
          const c = centre;
          const P = (r, y, s, co) => [c[0] + r * s, c[1] + y, c[2] + r * co];
          const N = (nn, s, co) => [sign * nn[0] * s, sign * nn[1], sign * nn[0] * co];
          const uv = (a, v) => (surf && !surf.rect ? [(a / (Math.PI * 2)) * tiles, v] : flat);
          // The v of a clipped corner follows its clipped height.
          const vOf = (y) => (yb - ya > 1e-6 ? mix(va, vb, (y - ya) / (yb - ya)) : va);
          this._poly(
            [P(rA0, yA0, s0, c0), P(rA1, yA1, s1, c1), P(rB1, yB1, s1, c1), P(rB0, yB0, s0, c0)],
            [N(na, s0, c0), N(na, s1, c1), N(nb, s1, c1), N(nb, s0, c0)],
            [uv(a0, vOf(yA0)), uv(a1, vOf(yA1)), uv(a1, vOf(yB1)), uv(a0, vOf(yB0))], st,
          );
        }
      }
      arc += L;
    }
  }

  // Any ready geometry, for what a box cannot be: an apple, a horseshoe, a tong.
  add(geometry, style, matrix = null) {
    const st = asStyle(style);
    const emit = () => {
      const p = geometry.attributes.position; const nr = geometry.attributes.normal;
      const idx = geometry.index;
      const count = idx ? idx.count : p.count;
      const f = st.uv ?? this.flat;
      const own = geometry.attributes.color ?? null;
      const base = this.P.length / 3;
      for (let i = 0; i < p.count; i++) {
        const w = this._pos([p.getX(i), p.getY(i), p.getZ(i)]);
        const n = this._nrm([nr.getX(i), nr.getY(i), nr.getZ(i)]);
        this.P.push(w[0], w[1], w[2]); this.N.push(n[0], n[1], n[2]); this.U.push(f[0], f[1]);
        const c = this._colour(st, w);
        if (own) this.C.push(c[0] * own.getX(i), c[1] * own.getY(i), c[2] * own.getZ(i));
        else this.C.push(c[0], c[1], c[2]);
      }
      for (let i = 0; i < count; i++) this.I.push(base + (idx ? idx.getX(i) : i));
    };
    if (matrix) this.at(matrix, emit); else emit();
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.I);
    return g;
  }
}

// Clips a convex outline to the band lo <= v <= hi.
function clipRow(pts, lo, hi) {
  const clip = (list, keep, cross) => {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i]; const q = list[(i + 1) % list.length];
      const kp = keep(p); const kq = keep(q);
      if (kp) out.push(p);
      if (kp !== kq) out.push(cross(p, q));
    }
    return out;
  };
  const at = (y) => (p, q) => [p[0] + (q[0] - p[0]) * ((y - p[1]) / (q[1] - p[1])), y];
  return clip(clip(pts, (p) => p[1] >= lo, at(lo)), (p) => p[1] <= hi, at(hi));
}

// Places a thing in a wall's own frame: `c` along the wall, `y` up, `d` out through the wall from its
// mid-plane. `axis` is the way the wall runs, `mid` where its mid-plane is, `out` which way is outside.
function wallFrame(soup, axis, mid, out) {
  const faces = axis === 'x'
    ? { outF: out > 0 ? 'pz' : 'nz', inF: out > 0 ? 'nz' : 'pz', a: 'nx', b: 'px' }
    : { outF: out > 0 ? 'px' : 'nx', inF: out > 0 ? 'nx' : 'px', a: 'nz', b: 'pz' };
  const translate = (style) => {
    const S = { ...asStyle(style) };
    if (S.out) { S[faces.outF] = S.out; delete S.out; }
    if (S.in) { S[faces.inF] = S.in; delete S.in; }
    if (S.jamb) { S[faces.a] = S.jamb; S[faces.b] = S.jamb; delete S.jamb; }
    return S;
  };
  return {
    axis, mid, out,
    box(c0, c1, y0, y1, d0, d1, style) {
      const a = mid + out * d0; const b = mid + out * d1;
      const lo = Math.min(a, b); const hi = Math.max(a, b);
      if (axis === 'x') soup.box(c0, c1, y0, y1, lo, hi, translate(style));
      else soup.box(lo, hi, y0, y1, c0, c1, translate(style));
    },
    // World position of a point in the wall's frame.
    at(c, y, d) { return axis === 'x' ? [c, y, mid + out * d] : [mid + out * d, y, c]; },
  };
}

// A wall from c0 to c1 with its openings left out, built the way a real one is: piers, sills, headers.
function wallWithOpenings(frame, c0, c1, y0, y1, half, openings, style) {
  const sorted = [...openings].sort((p, q) => p.c - q.c);
  let at = c0;
  for (const o of sorted) {
    const a = o.c - o.w / 2; const b = o.c + o.w / 2;
    if (a > at) frame.box(at, a, y0, y1, -half, half, style);
    if ((o.sill ?? y0) > y0) frame.box(a, b, y0, o.sill, -half, half, style);
    if (o.head < y1) frame.box(a, b, o.head, y1, -half, half, style);
    at = b;
  }
  if (at < c1) frame.box(at, c1, y0, y1, -half, half, style);
}

// A glazed window through a wall. The frame lines the reveal and stands proud on both sides, so its
// shadow says recess; the pane is a thin closed box, dark glass outside and daylight inside.
function glazedWindow(frame, glow, {
  c, w, sill, head, half, col = TRIM, across = 1, up = 1, shutter = null, sillCol = null,
}) {
  const fw = 0.2; const proud = 0.09;
  const a = c - w / 2; const b = c + w / 2;
  frame.box(a - fw, a + 0.06, sill - fw, head + fw, -half - proud, half + proud, col);
  frame.box(b - 0.06, b + fw, sill - fw, head + fw, -half - proud, half + proud, col);
  frame.box(a, b, head - 0.06, head + fw, -half - proud, half + proud, col);
  frame.box(a, b, sill - 0.06, sill + 0.06, -half - proud, half + proud, col);
  // Proud of the room's wall too: flush with it, the two surfaces fight along the whole sill.
  frame.box(a - fw - 0.12, b + fw + 0.12, sill - fw - 0.14, sill - fw + 0.02, -half - 0.05, half + 0.3, sillCol ?? col);
  const paneFrame = wallFrame(glow, frame.axis, frame.mid, frame.out);
  paneFrame.box(a + 0.02, b - 0.02, sill + 0.02, head - 0.02, -0.03, 0.03, { c: 0xffffff, out: { s: 'glass' }, in: { s: 'daylight' }, s: 'glass' });
  for (let i = 1; i < across; i++) {
    const x = mix(a, b, i / across);
    frame.box(x - 0.045, x + 0.045, sill, head, -0.08, 0.08, col);
  }
  for (let i = 1; i < up; i++) {
    const y = mix(sill, head, i / up);
    frame.box(a, b, y - 0.045, y + 0.045, -0.08, 0.08, col);
  }
  if (shutter !== null) {
    for (const [s0, s1] of [[a - fw - w * 0.46, a - fw], [b + fw, b + fw + w * 0.46]]) {
      frame.box(s0, s1, sill - 0.1, head + 0.1, half, half + 0.11, shutter);
      const k = (head - sill) / 4;
      for (let i = 1; i < 4; i++) frame.box(s0, s1, sill + k * i - 0.04, sill + k * i + 0.04, half + 0.11, half + 0.16, shutter);
    }
  }
}

// The building's second mesh: everything that gives its own light.
function glowMesh(soup, tex, intensity = 0.9, side = THREE.FrontSide) {
  return mesh(soup.geometry(), standard({
    vertexColors: true, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: intensity, roughness: 0.6, metalness: 0, side,
  }));
}

function soupMesh(soup, bump = 1.3) {
  return mesh(soup.geometry(), standard({
    vertexColors: true, map: soup.atlas.tex, bumpMap: soup.atlas.tex, bumpScale: bump, roughness: 0.88, metalness: 0,
  }));
}

// Plain flat swatches and glows for the emissive sheet. Rects are in pixels of a small canvas.
function glowAtlas(seed, rects, { w = 256, h = 256 } = {}) {
  return makeAtlas(seed, [], { w, h, rects });
}

const glassRect = (x, y) => ({
  name: 'glass', x, y, w: 64, h: 64,
  draw(ctx, w, h) {
    // Outside, a window is dark, and only a soft reflection of the sky says glass. It gets emissive too,
    // so it has to be properly dim.
    ctx.fillStyle = '#10181f';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26394a';
    ctx.beginPath(); ctx.moveTo(0, h * 0.2); ctx.lineTo(w * 0.7, 0); ctx.lineTo(w, 0); ctx.lineTo(0, h * 0.7); ctx.fill();
  },
});
const dayRect = (x, y) => ({
  name: 'daylight', x, y, w: 64, h: 64,
  draw(ctx, w, h) {
    ctx.fillStyle = '#cfe6f2';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eef7fb';
    ctx.fillRect(0, 0, w, h * 0.5);
  },
});

// ---------------------------------------------------------------------------------------------
// Bits many buildings use
// ---------------------------------------------------------------------------------------------

// A plank door hung open on its hinge at (hx, hz), leaf running along +x before it is swung by `open`.
function plankDoor(soup, hx, hz, width, height, open, col, darkCol, dir = 1) {
  const m = new THREE.Matrix4().makeRotationY(open).setPosition(hx, 0.06, hz);
  soup.at(m, () => {
    const boards = 5;
    for (let i = 0; i < boards; i++) {
      const k = 0.9 + hash3(i, hx, 3) * 0.2;
      const x0 = dir > 0 ? (i / boards) * width : -((i + 1) / boards) * width;
      soup.box(x0 + 0.012, x0 + width / boards - 0.012, 0, height, -0.07, 0.07, { c: tone(col, k), s: 'grain' });
    }
    const sx = dir > 0 ? [0.04, width - 0.04] : [-width + 0.04, -0.04];
    for (const y of [0.9, height - 0.9]) {
      soup.box(sx[0], sx[1], y - 0.18, y + 0.18, 0.07, 0.13, { c: tone(col, 0.72), s: 'grain' });
      soup.box(sx[0], sx[1], y - 0.18, y + 0.18, -0.13, -0.07, { c: tone(col, 0.72), s: 'grain' });
    }
    // The strap hinges and the latch: the iron a village smith would have made.
    for (const y of [0.9, height - 0.9]) soup.box(dir > 0 ? 0 : -1.5, dir > 0 ? 1.5 : 0, y - 0.05, y + 0.05, 0.13, 0.15, IRON);
    const hx2 = dir > 0 ? width - 0.3 : -width + 0.3;
    soup.box(hx2 - 0.06, hx2 + 0.06, height * 0.47, height * 0.55, -0.2, 0.2, darkCol);
  });
}

// ---------------------------------------------------------------------------------------------
// Food. One template merged many times; each carries its own shading in a colour attribute that the
// style's colour is multiplied by.
// ---------------------------------------------------------------------------------------------
function shadeTemplate(g, fn) {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = fn(p.getX(i), p.getY(i), p.getZ(i));
    arr[i * 3] = Array.isArray(k) ? k[0] : k;
    arr[i * 3 + 1] = Array.isArray(k) ? k[1] : k;
    arr[i * 3 + 2] = Array.isArray(k) ? k[2] : k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// A unit loaf, one foot long by default: domed on top, flat underneath, crust dark on the crown and
// pale where it sat on the oven floor.
function loafTemplate(segments = 10, rings = 6) {
  const g = new THREE.SphereGeometry(1, segments, rings);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, y < 0 ? y * 0.28 : y);
  }
  g.computeVertexNormals();
  return shadeTemplate(g, (x, y) => {
    const t = clamp01(y * 1.25);
    return [mix(1.75, 0.72, t), mix(1.8, 0.62, t), mix(1.8, 0.5, t)];
  });
}

function placeLoaf(soup, template, x, y, z, length, width, height, yaw, { col = CRUST, slashes = 0 } = {}) {
  const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
  soup.at(m, () => {
    soup.add(template, col, new THREE.Matrix4().makeScale(length / 2, height, width / 2));
    for (let i = 0; i < slashes; i++) {
      const u = (i + 0.5) / slashes * 2 - 1;
      const sx = u * length * 0.3;
      const h = height * Math.sqrt(Math.max(0, 1 - (sx / (length / 2)) ** 2)) * 0.955;
      soup.at(new THREE.Matrix4().makeRotationY(0.5).setPosition(sx, h, 0), () => {
        soup.box(-0.035, 0.035, -0.02, 0.008, -width * 0.17, width * 0.17, 0xd2a968);
      });
    }
  });
}

function appleTemplate() {
  const g = new THREE.SphereGeometry(1, 7, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const rho = Math.hypot(x, z);
    p.setY(i, y * 0.9 - Math.sign(y) * 0.12 * Math.exp(-(rho * rho) / 0.09));
  }
  g.computeVertexNormals();
  return shadeTemplate(g, (x, y, z) => mix(0.75, 1.08, clamp01(0.5 + y * 0.35 + x * 0.25 + z * 0.15)));
}

function carrotTemplate() {
  // Root runs along +Y from the tip at 0 to the shoulder at 1, leaves past that.
  const root = new THREE.ConeGeometry(1, 1, 7, 1, false);
  root.rotateX(Math.PI);
  root.translate(0, 0.5, 0);
  return root;
}

function cabbageTemplate() {
  const g = new THREE.SphereGeometry(1, 13, 9);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i); const y = p.getY(i); const z = p.getZ(i);
    const a = Math.atan2(x, z);
    const lat = Math.asin(clamp01(Math.abs(y))) * Math.sign(y);
    // Overlapping leaves wrapped over the head: a ridge whose bearing drifts with height.
    const w = Math.sin(a * 3 + lat * 3.4);
    const k = 1 + 0.07 * w * Math.cos(lat);
    p.setXYZ(i, x * k, y * 0.92 * k, z * k);
  }
  g.computeVertexNormals();
  return shadeTemplate(g, (x, y, z) => {
    const a = Math.atan2(x, z);
    const lat = Math.atan2(y, Math.hypot(x, z));
    const w = Math.sin(a * 3 + lat * 3.4);
    const k = mix(0.72, 1.15, 0.5 + w * 0.5) * mix(0.82, 1.08, clamp01(0.5 + y * 0.6));
    return [k * 1.02, k, k * 0.92];
  });
}

// A crate in its own frame, base centre at the origin, front at +z: slats you can see the fruit
// through, corner posts, and the top left open.
function crate(soup, w, d, h, col = TIMBER, rng) {
  const hw = w / 2; const hd = d / 2;
  const slat = (k) => ({ c: tone(col, k), s: 'grain' });
  soup.box(-hw, hw, 0, 0.05, -hd, hd, slat(0.72));
  const rows = 3;
  const sh = h / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * sh + 0.02; const y1 = (r + 1) * sh - 0.025;
    const k = 0.85 + rng() * 0.25;
    soup.box(-hw, hw, y0, y1, hd - 0.04, hd, slat(k));
    soup.box(-hw, hw, y0, y1, -hd, -hd + 0.04, slat(k * 0.95));
    soup.box(-hw, -hw + 0.04, y0, y1, -hd, hd, slat(k * 0.9));
    soup.box(hw - 0.04, hw, y0, y1, -hd, hd, slat(k));
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (hw - 0.06); const z = sz * (hd - 0.06);
      soup.box(x - 0.05, x + 0.05, 0, h, z - 0.05, z + 0.05, slat(0.7));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Market stall: 10ft wide, 6ft deep, about 9ft tall, open behind so a child can stand where the
// stallholder stands.
// ---------------------------------------------------------------------------------------------
function chalkboardArt(ctx, w, h) {
  ctx.fillStyle = '#26332c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 14; i++) ctx.fillRect(0, (i / 14) * h, w, 3);
  const fit = (text, size, maxW, weight = '') => {
    let px = size;
    ctx.font = `${weight} ${px}px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive`;
    const measured = ctx.measureText(text).width;
    if (measured > maxW) { px = Math.floor((px * maxW) / measured); ctx.font = `${weight} ${px}px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive`; }
    return px;
  };
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fit('Fresh Today', h * 0.26, w * 0.86, 'bold');
  ctx.fillStyle = '#f4efdc';
  ctx.fillText('Fresh Today', w / 2, h * 0.2);
  ctx.strokeStyle = '#f0d27a';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(w * 0.2, h * 0.36); ctx.lineTo(w * 0.8, h * 0.36); ctx.stroke();
  const items = [['Apples', '#f08f7c', 0.26, 0.54], ['Carrots', '#f5b265', 0.74, 0.54], ['Cabbages', '#b6dc8e', 0.26, 0.8], ['Bread', '#ecd29a', 0.74, 0.8]];
  for (const [text, colour, x, y] of items) {
    fit(text, h * 0.19, w * 0.44);
    ctx.fillStyle = colour;
    ctx.fillText(text, w * x, h * y);
  }
}

function marketStall() {
  const rng = seededRandom(5101);
  const atlas = makeAtlas(5101, [
    { name: 'grain', tu: 8, tv: 2, px: 192, grain: true },
  ], { w: 512, h: 512, rects: [{ name: 'board', x: 0, y: 240, w: 512, h: 240, draw: chalkboardArt }] });
  const soup = new Soup(atlas);
  const wood = (k = 1, hex = TIMBER) => ({ c: tone(hex, k), s: 'grain' });

  // THE FRAME. Rear posts stand taller than the front, which is what pitches the awning toward the
  // shopper so that rain runs off in front of the counter.
  const FX = 4.75; const FZ = 2.55; const RZ = -2.65;
  const FT = 7.3; const RT = 8.75;
  const slopeY = (z) => mix(RT, FT, (z - RZ) / (FZ - RZ));
  for (const sx of [-1, 1]) {
    soup.box(sx * FX - 0.17, sx * FX + 0.17, -0.3, FT, FZ - 0.17, FZ + 0.17, wood(1.25, DARK));
    soup.box(sx * FX - 0.17, sx * FX + 0.17, -0.3, RT, RZ - 0.17, RZ + 0.17, wood(1.25, DARK));
    // A side rail along the pitch, and a low rail that ties front to rear behind the counter.
    soup.beam([sx * FX, slopeY(RZ - 0.45) - 0.17, RZ - 0.45], [sx * FX, slopeY(FZ + 0.45) - 0.17, FZ + 0.45], 0.24, 0.3, wood(0.9, DARK));
    soup.box(sx * FX - 0.08, sx * FX + 0.08, 1.15, 1.45, RZ, FZ, wood(0.85, DARK));
    // Knee braces where the rail meets the post.
    soup.beam([sx * FX, FT - 1.5, FZ - 0.05], [sx * FX, slopeY(FZ - 1.4) - 0.08, FZ - 1.4], 0.14, 0.18, wood(0.8, DARK));
    soup.beam([sx * FX, RT - 1.5, RZ + 0.05], [sx * FX, slopeY(RZ + 1.4) - 0.08, RZ + 1.4], 0.14, 0.18, wood(0.8, DARK));
  }
  soup.box(-FX - 0.3, FX + 0.3, FT - 0.34, FT, FZ - 0.14, FZ + 0.14, wood(1, DARK));
  soup.box(-FX - 0.3, FX + 0.3, RT - 0.34, RT, RZ - 0.14, RZ + 0.14, wood(1, DARK));
  for (const x of [-2.4, 0, 2.4]) soup.beam([x, slopeY(RZ - 0.3) - 0.14, RZ - 0.3], [x, slopeY(FZ + 0.3) - 0.14, FZ + 0.3], 0.14, 0.2, wood(0.9, DARK));

  // THE AWNING. Ten cloth strips with real thickness, sagging a little between the rails, each ending
  // in its own scallop. One stripe per strip keeps every colour edge dead straight.
  const AZ0 = RZ - 0.5; const AZ1 = FZ + 0.62;
  const SP = 1.04; const strips = 10;
  const clothRows = 6; const clothAcross = 3;
  const y0Cloth = (x, z) => {
    const u = clamp01((x + FX) / (2 * FX));
    const v = clamp01((z - AZ0) / (AZ1 - AZ0));
    // Pulled tight on the frame at the rails and the ridge pole, and loose in each bay between them.
    const bay = Math.abs(Math.sin(u * Math.PI * 4));
    return slopeY(z) + 0.14 - 0.09 * bay * Math.sin(v * Math.PI);
  };
  const thick = 0.07;
  const zStep = (AZ1 - AZ0) / clothRows;
  const nAt = (x, z) => {
    const e = 0.04;
    const dx = (y0Cloth(x + e, z) - y0Cloth(x - e, z)) / (2 * e);
    const dz = (y0Cloth(x, z + e) - y0Cloth(x, z - e)) / (2 * e);
    return v3norm([-dx, 1, -dz]);
  };
  const stripeX0 = -(strips * SP) / 2;
  for (let i = 0; i < strips; i++) {
    const col = i % 2 === 0 ? tone(0xb5382a, 1) : tone(0xe6d9b8, 1);
    const st = { c: col };
    const under = { c: i % 2 === 0 ? tone(0xb5382a, 0.8) : tone(0xe6d9b8, 0.82) };
    const xa = stripeX0 + i * SP; const xb = xa + SP;
    for (let r = 0; r < clothRows; r++) {
      const za = AZ0 + r * zStep; const zb = za + zStep;
      for (let c = 0; c < clothAcross; c++) {
        const x0 = mix(xa, xb, c / clothAcross); const x1 = mix(xa, xb, (c + 1) / clothAcross);
        const f = soup.flat;
        const A = [x0, y0Cloth(x0, za), za]; const B = [x1, y0Cloth(x1, za), za]; const C = [x1, y0Cloth(x1, zb), zb]; const D = [x0, y0Cloth(x0, zb), zb];
        soup._poly([A, B, C, D], [nAt(x0, za), nAt(x1, za), nAt(x1, zb), nAt(x0, zb)], [f, f, f, f], st);
        const dn = (p) => [p[0], p[1] - thick, p[2]];
        const flip = (n) => [-n[0], -n[1], -n[2]];
        soup._poly([dn(A), dn(B), dn(C), dn(D)], [flip(nAt(x0, za)), flip(nAt(x1, za)), flip(nAt(x1, zb)), flip(nAt(x0, zb))], [f, f, f, f], under);
        if (r === 0) soup._poly([A, B, dn(B), dn(A)], [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]], [f, f, f, f], under);
        if ((i === 0 && c === 0) || (i === strips - 1 && c === clothAcross - 1)) {
          const side = i === 0 ? -1 : 1;
          const X = side < 0 ? x0 : x1;
          const a = [X, y0Cloth(X, za), za]; const b = [X, y0Cloth(X, zb), zb];
          soup._poly([a, b, dn(b), dn(a)], [[side, 0, 0], [side, 0, 0], [side, 0, 0], [side, 0, 0]], [f, f, f, f], under);
        }
      }
    }
    // The scallop hangs from the front edge: a straight drop then a half round, closed all the way
    // round, so it has an edge seen from the side and a back seen from behind the counter.
    const midX = (xa + xb) / 2;
    const yTop = y0Cloth(midX, AZ1) - thick * 0.2;
    const drop = 0.42; const R = SP / 2;
    const outline = [[-R, 0], [R, 0], [R, -drop]];
    const segs = 8;
    for (let k = 1; k < segs; k++) {
      const a = (k / segs) * Math.PI;
      outline.push([R * Math.cos(a), -drop - R * 0.78 * Math.sin(a)]);
    }
    outline.push([-R, -drop]);
    soup.prism(outline, (u, v, w) => [midX + u, yTop + v, w], AZ1 - thick, AZ1, st);
  }

  // THE COUNTER: a wide top on trestle legs, boarded across the front, open behind. The student goes
  // round either end of it, since a post stands at each corner and there is nothing else in the way.
  const CT = 2.95; const C0 = 0.5; const C1 = 3.0;
  for (let i = 0; i < 5; i++) {
    const z0 = mix(C0, C1, i / 5); const z1 = mix(C0, C1, (i + 1) / 5);
    soup.box(-4.5, 4.5, CT - 0.14, CT, z0 + 0.012, z1 - 0.012, wood(0.95 + rng() * 0.22));
  }
  for (const x of [-4.2, -1.4, 1.4, 4.2]) {
    soup.box(x - 0.12, x + 0.12, -0.3, CT - 0.14, C1 - 0.42, C1 - 0.2, wood(0.82, DARK));
    soup.box(x - 0.12, x + 0.12, -0.3, CT - 0.14, C0 + 0.1, C0 + 0.32, wood(0.82, DARK));
    soup.box(x - 0.08, x + 0.08, 0.9, 1.1, C0 + 0.1, C1 - 0.2, wood(0.74, DARK));
  }
  soup.box(-4.2, 4.2, 1.1, 1.2, C0 + 0.1, C1 - 0.3, wood(0.9));
  const panels = 18;
  for (let i = 0; i < panels; i++) {
    const x0 = mix(-4.5, 4.5, i / panels); const x1 = mix(-4.5, 4.5, (i + 1) / panels);
    soup.box(x0 + 0.014, x1 - 0.014, 0.12, CT - 0.14, C1 - 0.2, C1 - 0.13, wood(0.86 + rng() * 0.24));
  }
  soup.box(-4.55, 4.55, 2.45, 2.62, C1 - 0.13, C1 - 0.07, wood(0.76, DARK));
  soup.box(-4.55, 4.55, 0.3, 0.47, C1 - 0.13, C1 - 0.07, wood(0.76, DARK));

  // The chalkboard hangs on the counter's front at a child's eye line, where no crate can get in
  // front of it.
  soup.box(-1.55, 1.55, 0.62, 2.28, C1 - 0.07, C1 - 0.03, wood(0.7, DARK));
  soup.box(-1.42, 1.42, 0.74, 2.16, C1 - 0.03, C1 - 0.015, { c: 0xffffff, pz: { s: 'board' } });

  // THE GOODS. Crates tipped toward the shopper on a wedge, the way a stall really shows fruit.
  const appleT = appleTemplate();
  const carrotT = carrotTemplate();
  const cabbageT = cabbageTemplate();
  const loafT = loafTemplate(9, 5);
  const crates = [
    { kind: 'apple', x: -3.3, z: 1.72, yaw: 0.05 },
    { kind: 'carrot', x: -1.15, z: 1.72, yaw: -0.05 },
    { kind: 'cabbage', x: 1.05, z: 1.72, yaw: 0.04 },
  ];
  const CW = 2.0; const CD = 1.62; const CH = 0.62;
  for (const c of crates) {
    const tilt = 0.42;
    const base = new THREE.Matrix4().makeRotationY(c.yaw).setPosition(c.x, CT, c.z);
    soup.at(base, () => {
      // The wedge: a low block under the back edge, so nothing floats.
      soup.box(-CW / 2 + 0.1, CW / 2 - 0.1, 0, 0.56, -CD / 2 - 0.1, -CD / 2 + 0.34, wood(0.7, DARK));
      soup.box(-CW / 2 + 0.1, CW / 2 - 0.1, 0, 0.12, -CD / 2 + 0.3, CD / 2 - 0.5, wood(0.68, DARK));
      soup.at(new THREE.Matrix4().makeRotationX(tilt).setPosition(0, 0.08 + (CD / 2) * Math.sin(tilt) - 0.08, 0.04), () => {
        crate(soup, CW, CD, CH, TIMBER, rng);
        const hx = CW / 2 - 0.2; const hz = CD / 2 - 0.2;
        if (c.kind === 'apple') {
          const r = 0.155;
          // Mostly red, with a few green ones, since a stall sells what the orchard gave it.
          const reds = [0xc02a24, 0xa81f24, 0xc6402a, 0xb32f22, 0xc02a24, 0xa5b53f];
          for (let layer = 0; layer < 3; layer++) {
            const step = r * 1.86;
            const y = 0.13 + r * 0.9 + layer * r * 1.5;
            const inset = layer * r * 0.9;
            for (let ix = -hx + inset; ix <= hx - inset + 1e-3; ix += step) {
              const row = Math.round((ix + hx) / step);
              for (let iz = -hz + inset + (row % 2 ? step / 2 : 0); iz <= hz - inset + 1e-3; iz += step) {
                const m = new THREE.Matrix4().compose(
                  new THREE.Vector3(ix + (rng() - 0.5) * 0.03, y + (rng() - 0.5) * 0.03, iz),
                  new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.9, rng() * 6, (rng() - 0.5) * 0.9)),
                  new THREE.Vector3(r, r, r),
                );
                soup.add(appleT, reds[Math.floor(rng() * reds.length)], m);
                if (layer === 2) soup.at(m, () => soup.box(-0.05, 0.05, 0.62, 1.22, -0.05, 0.05, DARK));
              }
            }
          }
        } else if (c.kind === 'carrot') {
          // Laid in rows with the leaves toward the back, so the orange faces the shopper.
          const rows = 4; const per = 8;
          for (let row = 0; row < rows; row++) {
            for (let k = 0; k < per; k++) {
              const x = mix(-hx, hx, k / (per - 1)) + (rng() - 0.5) * 0.05;
              const y = 0.22 + row * 0.1 + (rng() - 0.5) * 0.02;
              // The tip is what is placed, inside the front slats, since it is what would poke through.
              const tip = mix(hz + 0.04, -hz * 0.15, row / (rows - 1));
              const len = 0.66 + rng() * 0.12; const rad = 0.075 + rng() * 0.02;
              const rot = new THREE.Euler(-Math.PI / 2 + 0.25 + rng() * 0.15, 0, (rng() - 0.5) * 0.3, 'YXZ');
              const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, tip), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(rad, len, rad));
              soup.add(carrotT, tone(0xe07a1f, 0.92 + rng() * 0.2), m);
              // A tuft of leaves off the shoulder.
              soup.at(m, () => {
                for (const t of [-0.5, 0.5]) soup.beam([0, 0.98, 0], [t, 1.42, t * 0.5], 0.5, 0.5, tone(LEAF, 0.9 + rng() * 0.2));
              });
            }
          }
        } else if (c.kind === 'cabbage') {
          const r = 0.4;
          const spots = [[-0.56, -0.32], [0, -0.38], [0.56, -0.32], [-0.3, 0.34], [0.3, 0.34]];
          for (const [ax, az] of spots) {
            const m = new THREE.Matrix4().compose(
              new THREE.Vector3(ax, 0.42, az),
              new THREE.Quaternion().setFromEuler(new THREE.Euler((rng() - 0.5) * 0.8, rng() * 6, (rng() - 0.5) * 0.8)),
              new THREE.Vector3(r, r, r),
            );
            soup.add(cabbageT, tone(0x7fb24a, 0.92 + rng() * 0.2), m);
          }
        }
      });
    });
  }

  // Two round baskets of bread on the counter's ends, in front of nothing and tall enough to read.
  const basket = (x, y, z, r, h) => {
    const rows = 6;
    const profile = [[0, 0], [r * 0.72, 0]];
    for (let i = 0; i <= rows; i++) profile.push([mix(r * 0.74, r, i / rows), (i / rows) * h]);
    profile.push([r * 1.03, h + 0.03], [r * 0.9, h + 0.05], [r * 0.82, h * 0.6], [0, h * 0.6]);
    soup.spin(profile, {
      c: (px, py, pz) => {
        const row = Math.floor(((py - y) / h) * rows);
        const a = Math.atan2(px - x, pz - z);
        const check = (row + Math.floor((a + Math.PI) * 5)) % 2 === 0 ? 1.08 : 0.82;
        return tone(0xa8824c, check);
      },
    }, { sides: 16, centre: [x, y, z], hard: [1, 8, 9] });
  };
  soup.box(2.5, 4.4, CT, CT + 0.5, 0.9, 1.55, wood(0.72, DARK));
  for (const [x, y, z, seed] of [[3.0, CT, 2.3, 1], [3.8, CT + 0.5, 1.22, 2]]) {
    basket(x, y, z, 0.72, 0.48);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + seed;
      placeLoaf(soup, loafT, x + Math.sin(a) * 0.3, y + 0.4, z + Math.cos(a) * 0.3, 0.62, 0.44, 0.24, a + 1.4, { col: CRUST });
    }
    placeLoaf(soup, loafT, x, y + 0.56, z, 0.72, 0.48, 0.26, seed, { col: tone(CRUST, 1.08), slashes: 2 });
  }

  // Things hung from the front rail break up the skyline, and a stall's top third would otherwise be
  // empty air against the striped cloth.
  const ballT = new THREE.SphereGeometry(1, 6, 4);
  for (const [hx, kind] of [[-3.6, 'onions'], [-2.9, 'herbs'], [3.0, 'onions'], [3.7, 'herbs']]) {
    soup.beam([hx, FT - 0.34, FZ], [hx, FT - 1.05, FZ], 0.03, 0.03, 0x8c7a55);
    if (kind === 'onions') {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4;
        const y = FT - 0.72 - i * 0.14;
        const r = 0.11 + rng() * 0.03;
        soup.add(ballT, tone(0xb9772e, 0.92 + rng() * 0.25), new THREE.Matrix4().compose(new THREE.Vector3(hx + Math.sin(a) * 0.12, y, FZ + Math.cos(a) * 0.12), new THREE.Quaternion(), new THREE.Vector3(r, r * 1.1, r)));
      }
    } else {
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        soup.beam([hx, FT - 1.0, FZ], [hx + Math.sin(a) * 0.22, FT - 1.9 - rng() * 0.3, FZ + Math.cos(a) * 0.22], 0.05, 0.05, tone(LEAF, 0.7 + rng() * 0.3));
      }
      soup.box(hx - 0.07, hx + 0.07, FT - 1.08, FT - 0.96, FZ - 0.07, FZ + 0.07, 0xc9a25a);
    }
  }

  // Behind the counter, what a stallholder keeps to hand. Pushed to one end, so the walk stays clear.
  soup.at(new THREE.Matrix4().makeRotationY(0.3).setPosition(-3.1, 0, -1.2), () => {
    crate(soup, 1.8, 1.4, 1.1, DARK, rng);
    soup.box(-0.8, 0.8, 0.8, 0.86, -0.6, 0.6, tone(TIMBER, 0.6));
  });
  soup.spin([[0, 0], [0.5, 0], [0.74, 0.5], [0.72, 1.1], [0.44, 1.5], [0.2, 1.72], [0.26, 1.82], [0, 1.86]], tone(0xc9b78e, 1), { sides: 12, centre: [-3.0, 0, -0.1] });
  soup.spin([[0, 1.55], [0.46, 1.55], [0.5, 1.68], [0, 1.72]], tone(0x8a6a48, 1), { sides: 10, centre: [3.4, 0, -1.0] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    soup.beam([3.4 + Math.sin(a) * 0.14, 1.58, -1.0 + Math.cos(a) * 0.14], [3.4 + Math.sin(a) * 0.4, 0, -1.0 + Math.cos(a) * 0.4], 0.1, 0.1, wood(0.8, DARK));
  }

  const group = new THREE.Group();
  group.add(soupMesh(soup, 1.0));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Schoolhouse: 30ft along Z including its porch, 20ft along X, eaves at 12, ridge at 18, the bell's
// finial at 26. The twelve desks are counted and asserted, because the card asks a child to count them.
// ---------------------------------------------------------------------------------------------
const CHALK_FONT = '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive';

function blackboardArt(ctx, w, h, rng) {
  ctx.fillStyle = '#1b2a25';
  ctx.fillRect(0, 0, w, h);
  // A board that has been wiped and written on for years.
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(210,225,215,${0.015 + rng() * 0.035})`;
    ctx.beginPath();
    ctx.ellipse(rng() * w, rng() * h, 60 + rng() * 170, 14 + rng() * 44, (rng() - 0.5) * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const text = 'Welcome to Our Village';
  let px = Math.floor(h * 0.3);
  ctx.font = `bold ${px}px ${CHALK_FONT}`;
  const measured = ctx.measureText(text).width;
  if (measured > w * 0.9) { px = Math.floor((px * w * 0.9) / measured); ctx.font = `bold ${px}px ${CHALK_FONT}`; }
  ctx.fillStyle = '#f2efe2';
  ctx.fillText(text, w / 2, h * 0.42);
  ctx.strokeStyle = 'rgba(242,239,226,0.8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(w * 0.14, h * 0.62);
  for (let i = 1; i <= 24; i++) ctx.lineTo(w * (0.14 + (0.72 * i) / 24), h * 0.62 + Math.sin(i * 1.3) * 2.2);
  ctx.stroke();
}

function schoolhouse() {
  const rng = seededRandom(5201);
  const atlas = makeAtlas(5201, [
    { name: 'clapboard', tu: 8, tv: 4, px: 160 },
    { name: 'shingle', tu: 8, tv: 4, px: 224 },
    { name: 'plank', tu: 16, tv: 4, px: 128 },
    { name: 'plaster', tu: 8, tv: 8, px: 96 },
    { name: 'stone', tu: 8, tv: 8, px: 224 },
    { name: 'grain', tu: 8, tv: 2, px: 160, grain: true },
  ]);
  const glowSheet = glowAtlas(5202, [
    { name: 'board', x: 0, y: 0, w: 1024, h: 340, draw: blackboardArt },
    glassRect(0, 350),
    dayRect(70, 350),
    {
      name: 'ember', x: 140, y: 350, w: 64, h: 64,
      draw(ctx, w, h) { ctx.fillStyle = '#d9561a'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#ffb347'; ctx.fillRect(w * 0.15, h * 0.4, w * 0.7, h * 0.6); },
    },
  ], { w: 1024, h: 512 });
  const soup = new Soup(atlas);
  const glow = new Soup(glowSheet);

  const wood = (k = 1, hex = TIMBER) => ({ c: tone(hex, k), s: 'grain' });
  const WALL_IN = 0xcfc7ad;
  const SHUTTER = 0x3d6240;
  const ROOF = 0x6b5a4a;
  const wallStyle = { c: WASH, s: 'clapboard', in: { c: WALL_IN, s: 'plaster' }, jamb: { c: TRIM }, py: { c: TRIM }, ny: { c: TRIM } };

  const X = 10; const T = 0.25; // half width, half wall thickness
  const Z0 = -15; const Z1 = 11.5; // the body; the porch runs from Z1 to 15
  const E = 11.95; const R = 18;
  const east = wallFrame(soup, 'z', X - T, 1);
  const west = wallFrame(soup, 'z', -X + T, -1);
  const front = wallFrame(soup, 'x', Z1 - T, 1);
  const back = wallFrame(soup, 'x', Z0 + T, -1);

  // WALLS, with their openings left out rather than painted on.
  const SIDE_WINDOWS = [-9.5, -1, 7.5].map((c) => ({ c, w: 3.2, sill: 3.0, head: 9.7 }));
  wallWithOpenings(east, Z0, Z1, -0.4, E, T, SIDE_WINDOWS, wallStyle);
  wallWithOpenings(west, Z0, Z1, -0.4, E, T, SIDE_WINDOWS, wallStyle);
  back.box(-X + 2 * T, X - 2 * T, -0.4, E, -T, T, wallStyle);
  const DOOR_W = 3.8; const DOOR_H = 7.3;
  const FRONT_WINDOWS = [-6.9, 6.9].map((c) => ({ c, w: 2.4, sill: 3.4, head: 8.6 }));
  wallWithOpenings(front, -X + 2 * T, X - 2 * T, -0.4, E, T, [
    ...FRONT_WINDOWS,
    { c: 0, w: DOOR_W, head: DOOR_H },
  ], wallStyle);

  // The gables, above the ceiling. Their courses carry on level from the wall below.
  for (const [z0, z1] of [[Z1 - 2 * T, Z1], [Z0, Z0 + 2 * T]]) {
    soup.prism([[-X, E], [X, E], [0, R - 0.22]], (u, v, w) => [u, v, w], z0, z1, { c: WASH, s: 'clapboard' });
  }

  // Trim: the corner boards wrap the corner, so there is no seam for a wall course to end at.
  for (const sx of [-1, 1]) {
    for (const z of [Z0, Z1]) {
      const zs = z === Z0 ? [Z0 - 0.12, Z0 + 0.62] : [Z1 - 0.62, Z1 + 0.12];
      const xs = sx > 0 ? [X - 0.62, X + 0.12] : [-X - 0.12, -X + 0.62];
      soup.box(xs[0], xs[1], 0.5, E, zs[0], zs[1], TRIM);
    }
    const side = sx > 0 ? east : west;
    side.box(Z0, Z1, 11.05, E, T, T + 0.07, TRIM);
    side.box(Z0 + 0.5, Z1 - 0.5, 0.5, 0.86, T, T + 0.12, TRIM);
  }
  back.box(-X + 0.5, X - 0.5, 0.5, 0.86, T, T + 0.12, TRIM);
  front.box(-X + 0.5, -4.4, 0.5, 0.86, T, T + 0.12, TRIM);
  front.box(4.4, X - 0.5, 0.5, 0.86, T, T + 0.12, TRIM);

  // The fieldstone foundation runs below the ground so the join holds on a hillside.
  const stoneSt = { c: STONE, s: 'stone' };
  soup.box(X - 0.4, X + 0.14, -0.4, 0.55, Z0 - 0.14, Z1 + 0.14, stoneSt);
  soup.box(-X - 0.14, -X + 0.4, -0.4, 0.55, Z0 - 0.14, Z1 + 0.14, stoneSt);
  soup.box(-X, X, -0.4, 0.55, Z0 - 0.14, Z0 + 0.4, stoneSt);
  soup.box(-X, -4.4, -0.4, 0.55, Z1 - 0.4, Z1 + 0.14, stoneSt);
  soup.box(4.4, X, -0.4, 0.55, Z1 - 0.4, Z1 + 0.14, stoneSt);

  // WINDOWS: tall, because a one-room school was lit by daylight and little else.
  for (const c of [-9.5, -1, 7.5]) {
    glazedWindow(east, glow, { c, w: 3.2, sill: 3.0, head: 9.7, half: T, col: TRIM, across: 2, up: 3, shutter: SHUTTER });
    glazedWindow(west, glow, { c, w: 3.2, sill: 3.0, head: 9.7, half: T, col: TRIM, across: 2, up: 3, shutter: SHUTTER });
  }
  for (const c of [-6.9, 6.9]) glazedWindow(front, glow, { c, w: 2.4, sill: 3.4, head: 8.6, half: T, col: TRIM, across: 2, up: 3 });

  // THE DOOR, a real opening. The frame lines it, the leaf stands open against the room, and the
  // threshold closes the gap in the floor.
  front.box(-DOOR_W / 2 - 0.2, -DOOR_W / 2 + 0.06, 0, DOOR_H + 0.2, -T - 0.08, T + 0.08, TRIM);
  front.box(DOOR_W / 2 - 0.06, DOOR_W / 2 + 0.2, 0, DOOR_H + 0.2, -T - 0.08, T + 0.08, TRIM);
  front.box(-DOOR_W / 2, DOOR_W / 2, DOOR_H - 0.06, DOOR_H + 0.2, -T - 0.08, T + 0.08, TRIM);
  soup.box(-DOOR_W / 2, DOOR_W / 2, -0.4, 0.075, Z1 - 2 * T, Z1, { c: tone(DARK, 1.2), s: 'grain' });
  plankDoor(soup, -DOOR_W / 2 + 0.05, Z1 - 2 * T - 0.05, DOOR_W - 0.1, DOOR_H - 0.12, 1.42, RED, IRON);

  // FLOOR AND CEILING. Together with the wall linings these close the room, so from inside there is
  // no direction in which anything can be seen through.
  soup.box(-X + 0.45, X - 0.45, -0.4, 0.05, Z0 + 0.45, Z1 - 0.45, { c: tone(TIMBER, 1.05), py: { s: 'plank' }, skip: 'ny' });
  soup.box(-X + 0.45, X - 0.45, 11.62, 11.85, Z0 + 0.45, Z1 - 0.45, { c: 0xc4b89a, ny: { s: 'plank' } });

  // Inside the walls: a wainscot to desk height, a chair rail and a cornice.
  const wains = { c: tone(TIMBER, 1.1), s: 'grain' };
  const rail = tone(DARK, 1.2);
  const inner = (f, c0, c1) => {
    f.box(c0, c1, 0.05, 2.72, -T - 0.05, -T, wains);
    f.box(c0, c1, 2.72, 2.86, -T - 0.09, -T, rail);
    f.box(c0, c1, 0.05, 0.42, -T - 0.08, -T, rail);
  };
  inner(east, Z0 + 0.5, Z1 - 0.5);
  inner(west, Z0 + 0.5, Z1 - 0.5);
  inner(back, -X + 0.5, X - 0.5);
  inner(front, -X + 0.5, -DOOR_W / 2 - 0.2);
  inner(front, DOOR_W / 2 + 0.2, X - 0.5);
  for (const f of [east, west]) f.box(Z0 + 0.5, Z1 - 0.5, 11.2, 11.62, -T - 0.16, -T, TRIM);
  back.box(-X + 0.5, X - 0.5, 11.2, 11.62, -T - 0.16, -T, TRIM);
  front.box(-X + 0.5, X - 0.5, 11.2, 11.62, -T - 0.16, -T, TRIM);

  // THE ROOF: one closed chevron with its overhang, then the ridge board that covers the crown.
  const pitch = (R - 12) / 10;
  const OVER = 0.9;
  soup.roof({
    axis: 'z', l0: Z0 - OVER, l1: Z1 + OVER, half: X + OVER, yE: R - (X + OVER) * pitch, yR: R, t: 0.34,
    top: { c: ROOF, s: 'shingle' }, under: { c: tone(TRIM, 0.88) }, end: TRIM, fascia: TRIM,
  });
  soup.beam([0, R - 0.02, Z0 - OVER - 0.05], [0, R - 0.02, Z1 + OVER + 0.05], 0.42, 0.42, tone(ROOF, 0.72), [1, 1, 0]);

  // A round louvred vent in the front gable: the one thing up there to break the white.
  const vent = new THREE.CylinderGeometry(1, 1, 1, 18);
  const ventAt = (r, d, z) => new THREE.Matrix4().compose(new THREE.Vector3(0, 14.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(r, d, r));
  soup.add(vent, TRIM, ventAt(1.05, 0.2, Z1 + 0.05));
  soup.add(vent, tone(DARK, 0.7), ventAt(0.82, 0.2, Z1 + 0.08));
  for (let i = -2; i <= 2; i++) {
    const hw = Math.sqrt(0.82 ** 2 - (i * 0.27) ** 2);
    soup.box(-hw, hw, 14.3 + i * 0.27 - 0.05, 14.3 + i * 0.27 + 0.05, Z1 + 0.14, Z1 + 0.22, TRIM);
  }

  // THE PORCH: posts, a beam, its own gable, side rails, and a deck that runs under the door.
  const PZ = 14.65;
  soup.box(-4.4, 4.4, -0.4, 0.14, Z1, 15, { c: STONE, s: 'stone', py: { c: tone(TIMBER, 1.1), s: 'plank' } });
  for (const sx of [-1, 1]) {
    soup.box(sx * 3.9 - 0.24, sx * 3.9 + 0.24, 0.14, 8.6, PZ - 0.24, PZ + 0.24, TRIM);
    soup.box(sx * 3.9 - 0.34, sx * 3.9 + 0.34, 0.14, 0.72, PZ - 0.34, PZ + 0.34, TRIM);
    soup.box(sx * 3.9 - 0.08, sx * 3.9 + 0.08, 2.6, 2.8, Z1, PZ, TRIM);
    soup.box(sx * 3.9 - 0.06, sx * 3.9 + 0.06, 0.6, 0.76, Z1, PZ, TRIM);
    for (let i = 1; i <= 5; i++) {
      const z = mix(Z1, PZ, i / 6);
      soup.box(sx * 3.9 - 0.045, sx * 3.9 + 0.045, 0.76, 2.6, z - 0.045, z + 0.045, TRIM);
    }
  }
  soup.box(-4.3, 4.3, 8.4, 9.0, PZ - 0.22, PZ + 0.22, TRIM);
  soup.box(-4.3, 4.3, 8.4, 9.0, Z1, Z1 + 0.2, TRIM);
  soup.prism([[-4.2, 9.0], [4.2, 9.0], [0, 11.2]], (u, v, w) => [u, v, w], PZ - 0.16, PZ + 0.1, { c: WASH, s: 'clapboard' });
  soup.roof({
    axis: 'z', l0: Z1 - 0.2, l1: 15.25, half: 4.85, yE: 8.92, yR: 11.62, t: 0.28,
    top: { c: ROOF, s: 'shingle' }, under: { c: tone(TRIM, 0.88) }, end: TRIM, fascia: TRIM,
  });
  soup.beam([0, 11.6, Z1 + 0.2], [0, 11.6, 15.3], 0.32, 0.32, tone(ROOF, 0.72), [1, 1, 0]);

  // THE CUPOLA, on the +Z end. Open on all four sides, so the bell is against the sky from any bearing.
  const CZ = 7.6;
  const cb = (x0, x1, y0, y1, z0, z1, st) => soup.box(x0, x1, y0, y1, CZ + z0, CZ + z1, st);
  cb(-2.25, 2.25, 15, 19.2, -2.25, 2.25, { c: WASH, s: 'clapboard', py: { c: tone(DARK, 0.9) } });
  cb(-2.5, 2.5, 19.2, 19.48, -2.5, 2.5, TRIM);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * 1.92; const pz = sz * 1.92;
      cb(px - 0.24, px + 0.24, 19.48, 23.3, pz - 0.24, pz + 0.24, TRIM);
    }
    // Braces under the top rail, which turn four posts into a belfry.
    for (const a of [-1, 1]) {
      soup.beam([sx * 1.92, 22.3, CZ + a * 1.75], [sx * 1.92, 23.2, CZ + a * 0.8], 0.14, 0.16, TRIM);
      soup.beam([a * 1.75, 22.3, CZ + sx * 1.92], [a * 0.8, 23.2, CZ + sx * 1.92], 0.14, 0.16, TRIM);
    }
    cb(sx * 1.92 - 0.2, sx * 1.92 + 0.2, 23.0, 23.3, -2.1, 2.1, TRIM);
    cb(-2.1, 2.1, 23.0, 23.3, sx * 1.92 - 0.2, sx * 1.92 + 0.2, TRIM);
  }
  cb(-2.55, 2.55, 23.3, 23.56, -2.55, 2.55, TRIM);
  const AP = [0, 25.55, CZ];
  const pyr = 2.75;
  const roofSt = { c: ROOF, s: 'shingle' };
  const corners = [[-pyr, CZ + pyr], [pyr, CZ + pyr], [pyr, CZ - pyr], [-pyr, CZ - pyr]];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]; const b = corners[(i + 1) % 4];
    const out = [(a[0] + b[0]) / 2, 0.6, (a[1] + b[1]) / 2 - CZ];
    soup.slope([a[0], 23.46, a[1]], [b[0], 23.46, b[1]], AP, AP, { ...roofSt, outward: out });
  }
  soup.box(-pyr, pyr, 23.3, 23.46, CZ - pyr, CZ + pyr, { c: TRIM, py: { c: tone(ROOF, 0.6) } });
  soup.spin([[0, 25.2], [0.14, 25.2], [0.14, 25.55], [0.26, 25.62], [0.2, 25.74], [0.05, 25.8], [0.03, 26.02], [0, 26.05]], tone(0xb0893f, 1.1), { sides: 10, centre: [0, 0, CZ] });

  // THE BELL: a real bell profile, flared at the lip, open underneath, on a yoke between two posts.
  const BY = 20.1;
  const bronze = (x, y, z) => {
    const a = Math.atan2(x, z - CZ);
    const k = clamp01(0.55 + 0.45 * Math.cos(a - 0.7));
    return [0.52 * (0.75 + k * 0.5), 0.33 * (0.75 + k * 0.5), 0.1 * (0.75 + k * 0.5)];
  };
  soup.spin([
    [0, BY + 0.9], [0.62, BY + 0.5], [0.9, BY + 0.03], [1.0, BY], [1.03, BY + 0.06], [0.98, BY + 0.2], [0.84, BY + 0.42], [0.68, BY + 0.72],
    [0.6, BY + 1.05], [0.56, BY + 1.3], [0.46, BY + 1.55], [0.26, BY + 1.68], [0, BY + 1.72],
  ], { c: bronze }, { sides: 22, centre: [0, 0, CZ], hard: [3] });
  soup.spin([[0, BY + 1.7], [0.18, BY + 1.7], [0.18, BY + 2.0], [0, BY + 2.0]], tone(IRON, 1.2), { sides: 8, centre: [0, 0, CZ] });
  cb(-1.92, 1.92, BY + 2.0, BY + 2.32, -0.17, 0.17, wood(1.05, DARK));
  soup.beam([0, BY + 0.9, CZ], [0, BY + 0.28, CZ], 0.07, 0.07, IRON);
  soup.spin([[0, BY + 0.12], [0.12, BY + 0.14], [0.14, BY + 0.26], [0.08, BY + 0.38], [0, BY + 0.4]], IRON, { sides: 8, centre: [0, 0, CZ] });
  // The rope comes down through the ceiling where the teacher could reach it from the door.
  soup.beam([-1.5, 11.7, CZ], [-1.5, 3.8, CZ], 0.05, 0.05, 0xb9a26c);
  soup.spin([[0, 3.5], [0.09, 3.56], [0.09, 3.74], [0, 3.84]], 0xa58d58, { sides: 8, centre: [-1.5, 0, CZ] });

  // TWELVE DESKS, in three rows of four either side of an aisle. Counted, because a child will be.
  const DESKS = [];
  for (const z of [-5.6, -1.2, 3.2]) for (const x of [-7.05, -3.25, 3.25, 7.05]) DESKS.push([x, z]);
  if (DESKS.length !== 12) throw new Error(`The schoolhouse must have twelve desks, not ${DESKS.length}`);
  for (const [x, z] of DESKS) {
    const k = 0.9 + rng() * 0.25;
    const castIron = tone(IRON, 1.1);
    for (const sx of [-1, 1]) {
      const px = x + sx * 1.02;
      soup.box(px - 0.05, px + 0.05, 0.05, 0.16, z - 0.8, z + 1.1, castIron);
      soup.box(px - 0.05, px + 0.05, 0.16, 2.2, z - 0.72, z - 0.56, castIron);
      soup.box(px - 0.05, px + 0.05, 0.16, 1.32, z + 0.84, z + 1.0, castIron);
      soup.beam([px, 1.9, z - 0.62], [px, 0.2, z + 0.1], 0.08, 0.1, castIron);
    }
    soup.box(x - 1.05, x + 1.05, 1.72, 1.8, z - 0.82, z - 0.1, wood(k * 0.85));
    soup.box(x - 1.1, x + 1.1, 1.32, 1.42, z + 0.6, z + 1.25, wood(k));
    soup.box(x - 1.05, x + 1.05, 1.75, 2.2, z + 1.22, z + 1.3, wood(k * 0.92));
    soup.box(x - 0.98, x - 0.9, 1.4, 1.8, z + 1.2, z + 1.3, castIron);
    soup.box(x + 0.9, x + 0.98, 1.4, 1.8, z + 1.2, z + 1.3, castIron);
    soup.at(new THREE.Matrix4().makeRotationX(0.13).setPosition(x, 2.3, z - 0.34), () => {
      soup.box(-1.15, 1.15, -0.09, 0, -0.68, 0.68, wood(k * 1.12));
      soup.box(-0.05, 0.5, 0, 0.03, -0.35, 0.08, 0x2f3b3a);
      soup.box(-0.1, 0.55, 0.0, 0.015, -0.4, 0.13, tone(TIMBER, 0.9));
      soup.box(-0.05, 0.5, 0.015, 0.03, -0.35, 0.08, 0x2f3b3a);
      soup.box(-0.92, -0.76, 0, 0.09, -0.56, -0.4, 0x28303a);
    });
  }

  // THE FAR WALL: the blackboard, which is the one thing in the room that has to read from the door.
  const BZ = Z0 + 2 * T;
  soup.box(-6.3, 6.3, 3.0, 7.3, BZ, BZ + 0.08, wood(1, DARK));
  glow.box(-6.05, 6.05, 3.25, 7.05, BZ + 0.08, BZ + 0.11, { c: 0xffffff, s: 'board', ny: { s: 'glass' }, py: { s: 'glass' }, nx: { s: 'glass' }, px: { s: 'glass' }, nz: { s: 'glass' } });
  soup.box(-6.3, 6.3, 2.92, 3.02, BZ, BZ + 0.3, wood(1.1, DARK));
  for (let i = 0; i < 3; i++) soup.box(-3 + i * 2.4, -2.72 + i * 2.4, 3.02, 3.08, BZ + 0.12, BZ + 0.2, 0xe8e4d8);
  soup.box(4.0, 4.5, 3.02, 3.14, BZ + 0.12, BZ + 0.26, tone(DARK, 0.8));

  // The teacher's desk, chair and the things on it.
  const TZ = -10.6;
  soup.box(-2.9, 2.9, 2.62, 2.78, TZ - 1.25, TZ + 1.25, wood(1.08, DARK));
  for (const sx of [-1, 1]) {
    soup.box(sx * 2.05 - 0.72, sx * 2.05 + 0.72, 0.05, 2.62, TZ - 1.1, TZ + 1.1, wood(0.98, DARK));
    for (const y of [0.9, 1.75]) soup.box(sx * 2.05 - 0.62, sx * 2.05 + 0.62, y, y + 0.62, TZ - 1.12, TZ - 1.1, wood(0.82, DARK));
  }
  soup.box(-1.33, 1.33, 0.7, 2.62, TZ + 1.0, TZ + 1.08, wood(0.9, DARK));
  const bookCol = [0x7c2f28, 0x2d4c6e, 0x3f6a43, 0xa8772e, 0x5a3a6a];
  [[0.9, 0.5], [1.05, 0.42], [0.86, 0.36]].reduce((y, [w, h], i) => {
    soup.box(-2.2 - w / 2, -2.2 + w / 2, y, y + h * 0.42, TZ - 0.4 - 0.34, TZ - 0.4 + 0.34, bookCol[i]);
    return y + h * 0.42;
  }, 2.78);
  const apple = appleTemplate();
  soup.add(apple, 0xbf2a25, new THREE.Matrix4().compose(new THREE.Vector3(1.9, 2.92, TZ + 0.3), new THREE.Quaternion(), new THREE.Vector3(0.15, 0.15, 0.15)));
  soup.box(1.885, 1.915, 3.03, 3.14, TZ + 0.285, TZ + 0.315, DARK);
  soup.spin([[0, 2.78], [0.18, 2.78], [0.13, 2.86], [0.09, 3.02], [0.04, 3.08], [0.035, 3.42], [0, 3.46]], { c: bronze }, { sides: 10, centre: [0.5, 0, TZ - 0.3] });
  soup.box(-0.4, 0.2, 2.78, 2.8, TZ + 0.1, TZ + 0.9, 0xece4cf);
  // Her chair.
  const CHZ = TZ - 2.1;
  soup.box(-0.8, 0.8, 1.55, 1.68, CHZ - 0.7, CHZ + 0.7, wood(1, DARK));
  for (const sx of [-1, 1]) {
    soup.box(sx * 0.68 - 0.07, sx * 0.68 + 0.07, 0.05, 1.55, CHZ + 0.5, CHZ + 0.64, wood(0.9, DARK));
    soup.box(sx * 0.68 - 0.07, sx * 0.68 + 0.07, 0.05, 3.3, CHZ - 0.64, CHZ - 0.5, wood(0.9, DARK));
  }
  soup.box(-0.72, 0.72, 2.75, 3.25, CHZ - 0.62, CHZ - 0.52, wood(1, DARK));

  // A bookcase on the back wall beside the board, the one strip of bright colour in the room.
  const BKX = 8.05;
  soup.box(BKX - 0.08, BKX + 1.3, 0.05, 6.4, BZ + 0.02, BZ + 0.12, { c: tone(DARK, 0.7), s: 'grain' });
  for (const [i, y] of [0.5, 2.3, 4.1].entries()) {
    soup.box(BKX, BKX + 1.22, y, y + 0.1, BZ + 0.1, BZ + 1.05, wood(1.05, DARK));
    let x = BKX + 0.04;
    while (x < BKX + 1.16) {
      const w = 0.1 + rng() * 0.1;
      const hgt = 1.0 + rng() * 0.45;
      soup.box(x, Math.min(BKX + 1.2, x + w), y + 0.1, y + 0.1 + hgt, BZ + 0.3, BZ + 1.0, bookCol[Math.floor(rng() * bookCol.length)]);
      x += w + 0.01;
    }
    if (i === 2) soup.box(BKX - 0.08, BKX + 1.3, 6.3, 6.42, BZ, BZ + 1.15, wood(1.1, DARK));
  }
  soup.box(BKX - 0.08, BKX + 0.02, 0.05, 6.4, BZ + 0.05, BZ + 1.1, wood(1.2, DARK));
  soup.box(BKX + 1.2, BKX + 1.3, 0.05, 6.4, BZ + 0.05, BZ + 1.1, wood(1.2, DARK));

  // THE STOVE: an iron pot-belly on a tin plate, with its pipe up through the ceiling and the roof.
  const SX = 6.7; const SZ = 8.1;
  soup.box(SX - 1.55, SX + 1.55, 0.05, 0.08, SZ - 1.55, SZ + 1.55, tone(0x8b8e8f, 1));
  const stoveIron = tone(IRON, 0.95);
  soup.spin([
    [0, 0.65], [0.72, 0.65], [0.86, 0.85], [1.05, 1.4], [1.08, 1.9], [0.98, 2.45], [0.72, 2.85], [0.74, 3.0], [0.9, 3.05], [0.9, 3.25], [0.5, 3.45], [0.28, 3.6], [0, 3.6],
  ], stoveIron, { sides: 18, centre: [SX, 0, SZ], hard: [6, 8] });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    soup.beam([SX + Math.sin(a) * 0.5, 0.8, SZ + Math.cos(a) * 0.5], [SX + Math.sin(a) * 0.92, 0.08, SZ + Math.cos(a) * 0.92], 0.13, 0.13, stoveIron);
  }
  // Its door and the glow behind the mica, facing the room.
  const DZ = 0.82;
  const toRoom = new THREE.Matrix4().makeRotationY(-2.25).setPosition(SX, 0, SZ);
  soup.at(toRoom, () => {
    soup.box(-0.42, 0.42, 1.15, 2.1, DZ, DZ + 0.3, tone(IRON, 1.25));
    soup.box(0.46, 0.5, 1.5, 1.7, DZ + 0.1, DZ + 0.42, 0xc8a24a);
  });
  glow.at(toRoom, () => {
    glow.box(-0.3, 0.3, 1.5, 1.98, DZ + 0.28, DZ + 0.32, { c: 0xffffff, s: 'ember' });
  });
  const pipeR = 0.27;
  soup.spin([[pipeR, 3.5], [pipeR, 15.3], [0.42, 15.45], [0.42, 15.7], [0.2, 15.95], [0, 15.95]], tone(IRON, 0.9), { sides: 10, centre: [SX, 0, SZ] });
  soup.box(SX - 0.55, SX + 0.55, 11.5, 11.62, SZ - 0.55, SZ + 0.55, tone(0x8b8e8f, 0.8));
  // A woodbox beside it, with logs.
  const log = new THREE.CylinderGeometry(1, 1, 1, 7);
  const LX = 3.2; const LZ = 9.3;
  soup.at(new THREE.Matrix4().setPosition(LX, 0.05, LZ), () => {
    soup.box(-1, 1, 0, 0.08, -0.6, 0.6, wood(0.75));
    for (const sx of [-1, 1]) soup.box(sx - 0.05, sx + 0.05, 0, 1.0, -0.6, 0.6, wood(0.85));
    for (const sz of [-1, 1]) soup.box(-1, 1, 0, 1.0, sz * 0.6 - 0.04, sz * 0.6 + 0.04, wood(0.9));
    for (let i = 0; i < 7; i++) {
      const x = (i % 4) * 0.45 - 0.68 + (i > 3 ? 0.23 : 0);
      const y = i > 3 ? 0.9 : 0.62;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(0.2, 1.1, 0.2));
      soup.add(log, tone(TIMBER, 0.8 + rng() * 0.3), m);
    }
  });

  // Coat pegs by the door, and what the children hung on them.
  const pegZ = Z1 - 2 * T;
  soup.box(-8.9, -3, 5.3, 5.6, pegZ - 0.06, pegZ, wood(1.05, DARK));
  for (let i = 0; i < 8; i++) {
    const x = mix(-8.6, -3.3, i / 7);
    soup.beam([x, 5.46, pegZ - 0.06], [x, 5.5, pegZ - 0.32], 0.07, 0.07, wood(0.9, DARK));
    if (i % 3 === 0) {
      const col = [0x8c3a2a, 0x3c5a7a, 0x6a7a3a][i / 3];
      soup.box(x - 0.34, x + 0.34, 4.3, 5.35, pegZ - 0.26, pegZ - 0.06, col);
      soup.box(x - 0.36, x + 0.36, 4.86, 5.3, pegZ - 0.32, pegZ - 0.2, tone(col, 0.82));
    }
  }

  const group = new THREE.Group();
  group.add(soupMesh(soup, 1.1), glowMesh(glow, glowSheet.tex, 0.62));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Blacksmith's forge: 20 x 16ft, ridge at 13. Stone on three sides, and the whole +Z front open under
// one great timber lintel, which is what a forge is: shelter, with air and light on the work.
// ---------------------------------------------------------------------------------------------
function forgeFireArt(ctx, w, h) {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#ff9a2e');
  g.addColorStop(0.28, '#b8401a');
  g.addColorStop(0.62, '#3c1b10');
  g.addColorStop(1, '#0e0a08');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function hotArt(ctx, w, h) {
  // Left to right, coal-dull to yellow-hot. A lump picks its own heat by where its uv lands.
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#6a1608');
  g.addColorStop(0.35, '#c2360c');
  g.addColorStop(0.7, '#f97a14');
  g.addColorStop(1, '#ffd659');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function pearOutline(len) {
  // In (x, z), nose at -x: the teardrop every smith's bellows has.
  const pts = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a); const s = Math.sin(a);
    const t = (c + 1) / 2; // 0 at the nose, 1 at the tail
    const width = 0.22 + 1.34 * Math.sin(Math.PI * Math.min(1, t ** 0.62 * 0.92 + 0.08)) ** 0.8;
    pts.push([-len / 2 + t * len, s * width]);
  }
  return pts;
}

function blacksmithForge() {
  const rng = seededRandom(5301);
  const atlas = makeAtlas(5301, [
    { name: 'stone', tu: 8, tv: 8, px: 288 },
    { name: 'brick', tu: 4, tv: 2, px: 160 },
    { name: 'shingle', tu: 8, tv: 4, px: 224 },
    { name: 'dirt', tu: 8, tv: 8, px: 96 },
    { name: 'grain', tu: 8, tv: 2, px: 192, grain: true },
  ]);
  const sheet = glowAtlas(5302, [
    { name: 'fireback', x: 0, y: 0, w: 128, h: 128, draw: forgeFireArt },
    { name: 'hot', x: 128, y: 0, w: 128, h: 128, draw: hotArt },
  ], { w: 256, h: 128 });
  const soup = new Soup(atlas);
  const glow = new Soup(sheet);
  const hotUv = (k) => { const [u0, v0, u1, v1] = sheet.bands.hot.rect; return [mix(u0, u1, 0.02 + k * 0.96), (v0 + v1) / 2]; };
  const wood = (k = 1, hex = TIMBER) => ({ c: tone(hex, k), s: 'grain' });
  const stoneSt = { c: STONE, s: 'stone' };
  const iron = tone(IRON, 1);
  // Brick darkens with soot on the way up, from the fire's own edge.
  const brick = { c: (x, y) => tone(BRICK, y < 6 ? 1 : mix(1, 0.42, clamp01((y - 6) / 3.4))), s: 'brick' };
  const ROOF = 0x66594a;

  const X = 10; const ZB = -8; const ZF = 8;
  const WT = 1.1; const EAVE = 8.6; const R = 13; const pitch = (R - EAVE) / ZF;
  const roofY = (z) => R - Math.abs(z) * pitch;

  // THE WALLS. Side walls run full depth and carry the roof's pitch; the back closes between them.
  for (const [x0, x1] of [[-X, -X + WT], [X - WT, X]]) {
    const side = [[ZB, -0.4], [ZF, -0.4], [ZF, roofY(ZF) - 0.12], [0, R - 0.14], [ZB, roofY(ZB) - 0.12]];
    soup.prism(side, (u, v, w) => [w, v, u], x0, x1, stoneSt);
  }
  soup.box(-X + WT, X - WT, -0.4, roofY(ZB) - 0.12, ZB, ZB + WT, { ...stoneSt, py: { c: STONE } });
  // A course of bigger stones along the foot, proud and set below the ground.
  soup.box(-X - 0.14, -X + 0.5, -0.4, 0.8, ZB - 0.14, ZF + 0.06, { c: tone(STONE, 0.86), s: 'stone' });
  soup.box(X - 0.5, X + 0.14, -0.4, 0.8, ZB - 0.14, ZF + 0.06, { c: tone(STONE, 0.86), s: 'stone' });
  soup.box(-X + 0.5, X - 0.5, -0.4, 0.8, ZB - 0.14, ZB + 0.4, { c: tone(STONE, 0.86), s: 'stone' });

  // THE FLOOR: packed earth, a little past the open front's line, and only as big as the building.
  soup.box(-X + WT - 0.05, X - WT + 0.05, -0.4, 0.05, ZB + WT - 0.05, ZF, { c: tone(0x7a5c3e, 1), py: { s: 'dirt' }, skip: 'ny' });

  // THE ROOF, and the great lintel it stands on across the whole open front.
  soup.roof({
    axis: 'x', l0: -X - 0.7, l1: X + 0.7, half: ZF + 0.9, yE: R - (ZF + 0.9) * pitch, yR: R, t: 0.36,
    top: { c: ROOF, s: 'shingle' }, under: { c: tone(TIMBER, 0.9), s: 'grain' }, end: tone(DARK, 1.1), fascia: tone(DARK, 1.1),
  });
  soup.beam([-X - 0.75, R + 0.0, 0], [X + 0.75, R + 0.0, 0], 0.46, 0.46, tone(ROOF, 0.68), [0, 1, 1]);
  const LY0 = 7.25;
  soup.box(-X + WT - 0.2, X - WT + 0.2, LY0, roofY(8.05) - 0.1, 7.05, 8.05, wood(1.08, DARK));
  for (const sx of [-1, 1]) {
    soup.beam([sx * (X - WT - 0.02), 5.3, 7.55], [sx * (X - WT - 2.7), LY0 + 0.05, 7.55], 0.36, 0.4, wood(0.98, DARK), [0, 0, 1]);
  }

  // Rafters, tie beams and a ridge pole: the roof seen from inside is a timber frame.
  const rafterX = [-8.0, -6.2, -2.6, -0.8, 1.0, 2.8, 4.6, 6.4, 8.0];
  for (const x of rafterX) {
    const k = 0.92 + rng() * 0.2;
    for (const sz of [-1, 1]) {
      soup.beam([x, roofY(7.9) - 0.5, sz * 7.9], [x, R - 0.5, sz * 0.05], 0.24, 0.28, wood(k, DARK), [0, 1, 0]);
    }
  }
  soup.beam([-4.4, roofY(7.9) - 0.5, 7.9], [-4.4, R - 0.5, 0], 0.24, 0.28, wood(1, DARK));
  soup.box(-X + WT, X - WT, R - 0.82, R - 0.38, -0.2, 0.2, wood(1.05, DARK));
  for (const x of [-6.6, -1.2, 4.4]) soup.box(x - 0.24, x + 0.24, 8.0, 8.5, ZB + WT, 7.06, wood(0.98, DARK));

  // THE HEARTH. A brick table against the back wall, a rim round the bed, cheeks and a hood above.
  const HX0 = -7.6; const HX1 = -1.4; const HZ0 = ZB + WT; const HZ1 = -3.2;
  const HT = 2.6;
  soup.box(HX0, HX1, 0.05, HT, HZ0, HZ1, { ...brick, py: { c: 0x2a1f1a } });
  const rim = (x0, x1, z0, z1) => soup.box(x0, x1, HT, HT + 0.36, z0, z1, { ...brick, c: tone(BRICK, 0.84) });
  rim(HX0, HX1, HZ1 - 0.5, HZ1);
  rim(HX0, HX0 + 0.72, HZ0, HZ1 - 0.5);
  rim(HX1 - 0.72, HX1, HZ0, HZ1 - 0.5);
  // The cheeks stand on the rim and hold up the hood; the fire shows between them.
  const HOOD = 6.2;
  soup.box(HX0, HX0 + 0.72, HT + 0.36, HOOD, HZ0, HZ1 - 0.5, brick);
  soup.box(HX1 - 0.72, HX1, HT + 0.36, HOOD, HZ0, HZ1 - 0.5, brick);
  // A heavy iron bar spans the fire's mouth, and the hood sits on it.
  soup.box(HX0 - 0.02, HX1 + 0.02, HOOD - 0.2, HOOD, HZ1 - 0.54, HZ1 - 0.26, iron);
  const TX0 = -5.6; const TX1 = -3.4; const TZ1 = -4.8; const TOP = 9.2;
  const HB = [HX0 + 0.02, HX1 - 0.02, HZ1 - 0.28];
  soup.slope([HB[0], HOOD, HB[2]], [HB[1], HOOD, HB[2]], [TX1, TOP, TZ1], [TX0, TOP, TZ1], { ...brick, outward: [0, 0.4, 1] });
  soup.slope([HB[0], HOOD, HZ0], [HB[0], HOOD, HB[2]], [TX0, TOP, TZ1], [TX0, TOP, HZ0], { ...brick, outward: [-1, 0.3, 0] });
  soup.slope([HB[1], HOOD, HZ0], [HB[1], HOOD, HB[2]], [TX1, TOP, TZ1], [TX1, TOP, HZ0], { ...brick, outward: [1, 0.3, 0] });
  soup.box(HB[0], HB[1], HOOD - 0.02, HOOD + 0.02, HZ0, HB[2], { c: 0x17110e, skip: 'py' });
  // The stack, through the roof and clear of the ridge.
  soup.box(TX0, TX1, TOP, 16.2, HZ0, TZ1, { ...brick, py: { c: 0x120e0c } });
  soup.box(TX0 - 0.18, TX1 + 0.18, 15.5, 15.85, HZ0 - 0.18, TZ1 + 0.18, { ...brick, c: tone(BRICK, 0.62) });
  soup.box(TX0 - 0.18, TX1 + 0.18, 16.2, 16.42, HZ0 - 0.18, TZ1 + 0.18, { ...brick, c: tone(BRICK, 0.5), py: { c: 0x120e0c } });
  soup.box(-4.9, -4.1, 16.42, 16.44, -6.1, -5.5, 0x050404);

  // THE FIRE. The bed is emissive and so is the soot-black back of the hearth, whose gradient is what
  // says the coals are throwing light. No light object anywhere: a forge is one of many in a village.
  const bedX0 = HX0 + 0.72; const bedX1 = HX1 - 0.72; const bedZ0 = HZ0; const bedZ1 = HZ1 - 0.5;
  const fireFace = { c: 0xffffff, s: 'fireback' };
  glow.box(bedX0, bedX1, HT, HOOD - 0.2, bedZ0 - 0.02, bedZ0 + 0.05, fireFace);
  const rock = new THREE.IcosahedronGeometry(1, 0);
  rock.computeVertexNormals();
  const lumps = 72;
  for (let i = 0; i < lumps; i++) {
    const u = (i * 0.618034) % 1; const w = (i * 0.754877) % 1;
    const x = mix(bedX0 + 0.14, bedX1 - 0.14, u);
    const z = mix(bedZ0 + 0.14, bedZ1 - 0.1, w);
    // Heaped at the middle, where the bellows' air comes in, and dull toward the edges.
    const mound = Math.exp(-(((u - 0.62) / 0.34) ** 2) - ((w - 0.5) / 0.46) ** 2);
    const r = 0.17 + rng() * 0.14;
    const y = HT + 0.04 + mound * 0.34 + rng() * 0.05;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)),
      new THREE.Vector3(r, r * 0.8, r),
    );
    if (mound + rng() * 0.3 > 0.42) glow.add(rock, { c: 0xffffff, uv: hotUv(clamp01(mound * 0.9 + (rng() - 0.5) * 0.4)) }, m);
    else soup.add(rock, tone(0x24201d, 0.8 + rng() * 0.5), m);
  }
  soup.box(bedX0, bedX1, HT, HT + 0.02, bedZ0, bedZ1, 0x1c1411);

  // THE BELLOWS, on a timber trestle: boards top and bottom, leather folded between them, an iron
  // nozzle into the side of the hearth, and the lever a smith really pulled.
  const BX = 1.15; const BZ = -4.75; const BLEN = 4.5;
  const pear = pearOutline(BLEN);
  const BY0 = 2.7;
  const boardMap = (u, v, w) => [BX + u, w, BZ - v];
  soup.prism(pear, boardMap, BY0 - 0.14, BY0, { c: tone(TIMBER, 0.95) }, {});
  // A bellows is a WEDGE: the boards hinge together at the nose and open toward the tail. Seen side on,
  // that is the whole of its silhouette, and two parallel boards with leather between them is a drum.
  const OPEN = 1.85;
  const tilt = Math.atan2(OPEN, BLEN);
  const nose = [BX - BLEN / 2, BY0 + 0.14, BZ];
  const topM = new THREE.Matrix4().makeRotationZ(tilt).setPosition(nose[0], nose[1], nose[2]);
  const topAt = (x, z) => new THREE.Vector3(x - nose[0], 0, z - BZ).applyMatrix4(topM);
  soup.at(topM, () => {
    soup.prism(pear, (u, v, w) => [u + BLEN / 2, w, -v], 0, 0.14, { c: tone(TIMBER, 1.08) });
    // The weight that closes it again, sitting on the board's high end.
    soup.box(2.9, 3.7, 0.14, 0.56, -0.42, 0.42, tone(STONE, 0.84));
  });
  const folds = 7;
  for (let f = 0; f < folds; f++) {
    const ta = f / folds; const tb = (f + 1) / folds;
    const bulge = (t, i) => 1 + (0.13 * Math.sin(Math.PI * t) + (Math.round(t * folds) % 2 ? 0.05 : -0.015)) * clamp01(0.15 + (pear[i][0] + BLEN / 2) / BLEN);
    const col = tone(0x7c4e2c, f % 2 ? 0.8 : 1.14);
    for (let i = 0; i < pear.length; i++) {
      const j = (i + 1) % pear.length;
      const p = pear[i]; const q = pear[j];
      const e = [q[0] - p[0], q[1] - p[1]];
      const len = Math.hypot(e[0], e[1]) || 1;
      const nr = [e[1] / len, 0.12 * (f - folds / 2), e[0] / len];
      const at = (pt, idx, t) => {
        const bottom = new THREE.Vector3(BX + pt[0], BY0, BZ - pt[1]);
        const top = topAt(BX + pt[0], BZ - pt[1]);
        const k = bulge(t, idx);
        const mid = bottom.clone().lerp(top, t);
        return [BX + pt[0] * k, mid.y, BZ - pt[1] * k];
      };
      const fl = soup.flat;
      soup._poly([at(p, i, ta), at(q, j, ta), at(q, j, tb), at(p, i, tb)], [nr, nr, nr, nr], [fl, fl, fl, fl], { c: col });
    }
  }
  // A row of brass-headed nails round each board's rim is what makes leather read as nailed on.
  for (let i = 0; i < pear.length; i += 1) {
    const p = pear[i];
    const top = topAt(BX + p[0] * 0.98, BZ - p[1] * 0.98);
    soup.box(BX + p[0] * 0.98 - 0.035, BX + p[0] * 0.98 + 0.035, BY0 + 0.02, BY0 + 0.08, BZ - p[1] * 0.98 - 0.035, BZ - p[1] * 0.98 + 0.035, 0xc69a3c);
    soup.box(top.x - 0.035, top.x + 0.035, top.y - 0.08, top.y - 0.01, top.z - 0.035, top.z + 0.035, 0xc69a3c);
  }
  // The nozzle and the trestle.
  soup.add(tube([[BX - BLEN / 2 + 0.3, BY0 + 0.5, BZ], [BX - BLEN / 2 - 0.2, BY0 + 0.32, BZ], [HX1 - 0.1, BY0 + 0.24, BZ]], [0.3, 0.2, 0.13], { sides: 8, steps: 6, round: 1 }), iron);
  for (const dx of [-1.1, 1.3]) {
    for (const sz of [-1, 1]) {
      soup.beam([BX + dx, BY0 - 0.14, BZ + sz * 0.6], [BX + dx, 0.05, BZ + sz * 1.3], 0.24, 0.28, wood(0.96, DARK));
    }
    soup.box(BX + dx - 0.14, BX + dx + 0.14, BY0 - 0.4, BY0 - 0.14, BZ - 1.2, BZ + 1.2, wood(1.05, DARK));
    soup.box(BX + dx - 0.08, BX + dx + 0.08, 0.9, 1.1, BZ - 1.0, BZ + 1.0, wood(0.9, DARK));
  }

  // THE LEVER: a long pole rocking on its own post. Pull the far end down and the near end lifts the
  // bellows' board by the iron rod, which is the whole of how the air gets to the fire.
  const lift = topAt(BX + 0.7, BZ);
  const pivot = [4.05, 6.5, -3.0];
  const rear = [lift.x, 5.72, BZ];
  const dir = [pivot[0] - rear[0], pivot[1] - rear[1], pivot[2] - rear[2]];
  const handle = [pivot[0] + dir[0] * 1.35, pivot[1] + dir[1] * 1.35, pivot[2] + dir[2] * 1.35];
  soup.box(pivot[0] - 0.28, pivot[0] + 0.28, 0.05, pivot[1] - 0.2, pivot[2] - 0.28, pivot[2] + 0.28, wood(1.08, DARK));
  soup.box(pivot[0] - 0.46, pivot[0] - 0.3, pivot[1] - 1.2, pivot[1] + 0.36, pivot[2] - 0.2, pivot[2] + 0.2, wood(1, DARK));
  soup.box(pivot[0] + 0.3, pivot[0] + 0.46, pivot[1] - 1.2, pivot[1] + 0.36, pivot[2] - 0.2, pivot[2] + 0.2, wood(1, DARK));
  soup.beam(rear, handle, 0.22, 0.3, wood(1.2, TIMBER));
  soup.add(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8), iron, new THREE.Matrix4().compose(new THREE.Vector3(...pivot), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1)));
  soup.beam(rear, [lift.x, lift.y + 0.14, lift.z], 0.09, 0.09, iron);
  soup.box(lift.x - 0.2, lift.x + 0.2, lift.y + 0.12, lift.y + 0.26, lift.z - 0.2, lift.z + 0.2, iron);
  // A wooden hand grip, hung on a short chain from the long end, in reach of the smith at the fire.
  const gripY = 5.7;
  soup.beam(handle, [handle[0], gripY, handle[2]], 0.06, 0.06, iron);
  soup.beam([handle[0] - 0.45, gripY, handle[2]], [handle[0] + 0.45, gripY, handle[2]], 0.16, 0.16, wood(1.25, TIMBER));

  // THE ANVIL on its tree-stump block, between the fire and the open air.
  const AX = -2.6; const AZ = 1.0;
  const stumpTop = 1.92;
  soup.spin([[0, 0.05], [1.12, 0.05], [1.2, 0.3], [1.03, 0.75], [1.0, stumpTop - 0.02], [0.98, stumpTop], [0.72, stumpTop], [0.4, stumpTop], [0, stumpTop]], {
    c: (x, y, z) => {
      const r = Math.hypot(x - AX, z - AZ);
      if (y >= stumpTop - 0.01) return tone(0xb79262, r > 0.9 ? 0.72 : (Math.floor(r * 7) % 2 ? 0.92 : 1.08));
      const a = Math.atan2(x - AX, z - AZ);
      return tone(0x6a4f36, 0.86 + 0.22 * Math.sin(a * 9));
    },
  }, { sides: 16, centre: [AX, 0, AZ], hard: [4, 5] });
  const anvilMap = (u, v, w) => [AX + u, stumpTop + v, AZ + w];
  const anvilSt = tone(0x4c4e56, 1);
  soup.prism([[-0.74, 0], [0.74, 0], [0.68, 0.11], [0.36, 0.26], [0.3, 0.6], [-0.3, 0.6], [-0.36, 0.26], [-0.68, 0.11]], anvilMap, -0.44, 0.44, anvilSt);
  soup.prism([[-0.3, 0.58], [0.3, 0.58], [0.3, 0.72], [-0.3, 0.72]], anvilMap, -0.25, 0.25, anvilSt);
  // The body, with the heel out one way and the horn the other.
  soup.prism([[-0.58, 0.68], [0.5, 0.68], [0.68, 0.8], [1.02, 0.84], [1.02, 1.04], [-0.6, 1.04], [-0.66, 0.84]], anvilMap, -0.3, 0.3, { c: anvilSt, cap: null });
  soup.box(AX - 0.6, AX + 1.02, stumpTop + 1.04, stumpTop + 1.06, AZ - 0.3, AZ + 0.3, 0x8d9199);
  soup.add(tube([[-0.5, 0.86, 0], [-0.92, 0.9, 0], [-1.28, 0.95, 0], [-1.56, 0.99, 0]], [0.2, 0.15, 0.08, 0.008], { sides: 10, steps: 8, round: 1 }), anvilSt, new THREE.Matrix4().setPosition(AX, stumpTop, AZ));
  soup.box(AX + 0.7, AX + 0.84, stumpTop + 1.06, stumpTop + 1.065, AZ - 0.07, AZ + 0.07, 0x121212);
  // A bar just out of the fire, on the anvil's face, with the far end still glowing.
  soup.box(AX + 0.42, AX + 1.5, stumpTop + 1.06, stumpTop + 1.15, AZ - 0.05, AZ + 0.05, iron);
  glow.add(new THREE.BoxGeometry(0.86, 0.09, 0.1), { c: 0xffffff, uv: hotUv(0.6) }, new THREE.Matrix4().setPosition(AX, stumpTop + 1.105, AZ));
  // The hammer, set down on the stump's rim.
  soup.at(new THREE.Matrix4().makeRotationY(0.5).setPosition(AX + 0.72, stumpTop, AZ + 0.2), () => {
    soup.box(-0.24, 0.24, 0, 0.2, -0.1, 0.1, tone(IRON, 1.4));
    soup.box(-0.05, 0.05, 0.05, 0.14, 0.1, 1.1, wood(1.2));
  });

  // THE SLACK TUB, a coopered half barrel of black water for quenching.
  const TUX = -6.3; const TUZ = -1.1;
  soup.spin([[0, 0.05], [1.02, 0.05], [1.18, 0.9], [1.08, 1.82], [0.94, 1.82], [0.94, 1.52], [0.92, 1.52], [0, 1.52]], {
    c: (x, y, z) => {
      const r = Math.hypot(x - TUX, z - TUZ);
      if (r < 0.93 && y < 1.6) return [0.015, 0.05, 0.065];
      const a = Math.atan2(x - TUX, z - TUZ);
      return tone(TIMBER, Math.floor((a + Math.PI) * 4.1) % 2 ? 0.86 : 1.05);
    },
  }, { sides: 26, centre: [TUX, 0, TUZ], hard: [1, 3, 4, 5, 6] });
  for (const y of [0.42, 1.42]) {
    const r = y < 1 ? 1.11 : 1.135;
    soup.spin([[0, y - 0.09], [r, y - 0.09], [r + 0.025, y], [r, y + 0.09], [0, y + 0.09]], iron, { sides: 22, centre: [TUX, 0, TUZ] });
  }

  // TOOLS IN A ROW on the back wall, above the bench, where they have always hung.
  const WZ = ZB + WT;
  soup.box(3.9, 8.6, 6.0, 6.28, WZ, WZ + 0.14, wood(1.1, DARK));
  const hungAt = [4.3, 5.05, 5.8, 6.55, 7.3, 8.05];
  for (const [i, x] of hungAt.entries()) {
    soup.beam([x, 6.16, WZ + 0.14], [x, 6.2, WZ + 0.46], 0.07, 0.07, wood(1, DARK));
    const zT = WZ + 0.28;
    if (i % 2 === 0) {
      // Tongs: two reins crossing at a rivet and opening into a jaw.
      const jaw = 0.13 + i * 0.012;
      for (const s of [-1, 1]) {
        soup.add(tube([[x + s * 0.05, 6.14, zT], [x + s * 0.09, 5.4, zT], [x - s * 0.02, 4.62, zT], [x - s * jaw, 4.4, zT], [x - s * (jaw * 0.3), 4.14, zT]], [0.05, 0.05, 0.06, 0.065, 0.05], { sides: 4, steps: 10, round: 0 }), tone(IRON, 1.4));
      }
      soup.spin([[0, 4.6], [0.055, 4.6], [0.055, 4.67], [0, 4.67]], 0x6b6b70, { sides: 6, centre: [x, 0, zT + 0.02] });
    } else {
      // Hammers hang by the head from the peg with the handle down.
      const hw = 0.28 + (i % 4 === 1 ? 0 : 0.09);
      soup.box(x - hw, x + hw * 0.8, 6.28, 6.5, zT - 0.09, zT + 0.09, tone(IRON, 1.4));
      soup.box(x - 0.06, x + 0.06, 4.4, 6.28, zT - 0.04, zT + 0.04, wood(1.2));
      soup.box(x + hw * 0.55, x + hw * 0.8, 6.3, 6.48, zT - 0.05, zT + 0.05, tone(IRON, 1.5));
    }
  }
  // The horseshoes, on a lower rail, each with its seven nail holes left to the imagination.
  soup.box(4.0, 8.5, 3.82, 4.0, WZ, WZ + 0.1, wood(1.05, DARK));
  for (let i = 0; i < 5; i++) {
    const x = mix(4.45, 8.1, i / 4);
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const a = -Math.PI + 0.72 + (k / 12) * (Math.PI * 2 - 1.44);
      pts.push([x + Math.sin(a) * 0.27, 3.72 + Math.cos(a) * 0.3 - 0.28, WZ + 0.14]);
    }
    soup.add(tube(pts, 0.055, { sides: 4, steps: 16, round: 0, section: () => [1.5, 0.6] }), tone(IRON, 1.15));
    soup.box(x - 0.03, x + 0.03, 3.72, 3.8, WZ + 0.1, WZ + 0.2, wood(0.8, DARK));
  }
  // The bench under them, with bar stock and a leg vice.
  soup.box(3.9, 8.75, 2.75, 2.98, WZ, WZ + 1.9, wood(1.15));
  for (const x of [4.1, 6.3, 8.5]) {
    soup.box(x - 0.14, x + 0.14, 0.05, 2.75, WZ + 1.45, WZ + 1.75, wood(0.95, DARK));
    soup.box(x - 0.14, x + 0.14, 0.05, 2.75, WZ + 0.1, WZ + 0.3, wood(0.95, DARK));
    soup.box(x - 0.1, x + 0.1, 0.8, 1.0, WZ + 0.1, WZ + 1.7, wood(0.85, DARK));
  }
  soup.box(4.1, 8.5, 1.0, 1.08, WZ + 0.1, WZ + 1.7, wood(0.9));
  for (let i = 0; i < 6; i++) soup.box(4.3, 7.7, 1.08 + (i % 2) * 0.07, 1.14 + (i % 2) * 0.07, WZ + 0.4 + i * 0.16, WZ + 0.47 + i * 0.16, iron);
  soup.box(7.8, 8.1, 2.98, 3.5, WZ + 1.5, WZ + 1.9, iron);
  soup.box(7.8, 8.1, 3.0, 3.5, WZ + 1.92, WZ + 2.02, iron);
  soup.box(7.92, 7.98, 0.05, 3.3, WZ + 1.92, WZ + 2.0, iron);
  soup.beam([7.6, 3.2, WZ + 1.95], [8.3, 3.2, WZ + 1.95], 0.05, 0.05, tone(IRON, 1.4));
  // Finished work on the bench: a hinge, a nail bundle, two more shoes.
  soup.box(5.0, 5.6, 2.98, 3.0, WZ + 1.0, WZ + 1.16, iron);
  soup.box(5.0, 5.14, 2.98, 3.03, WZ + 0.9, WZ + 1.26, iron);
  for (let i = 0; i < 2; i++) {
    const x = 6.4 + i * 0.5; const z = WZ + 1.0 + i * 0.15;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI + 0.72 + (k / 10) * (Math.PI * 2 - 1.44);
      pts.push([x + Math.sin(a) * 0.27, 3.01, z + Math.cos(a) * 0.3]);
    }
    soup.add(tube(pts, 0.05, { sides: 4, steps: 12, round: 0, section: () => [0.6, 1.5] }), tone(IRON, 1.1));
  }

  // The fuel: a bin of coal against the wall, on the side away from the bellows.
  soup.box(-8.9, -7.65, 0.05, 2.2, -2.9, -0.4, { ...wood(0.8, DARK), py: { c: 0x1a1613 } });
  for (let i = 0; i < 14; i++) {
    const r = 0.14 + rng() * 0.12;
    soup.add(rock, tone(0x24201d, 0.8 + rng() * 0.5), new THREE.Matrix4().compose(new THREE.Vector3(-8.7 + rng() * 0.85, 2.22, -2.7 + rng() * 2.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, 0)), new THREE.Vector3(r, r * 0.8, r)));
  }
  // A horseshoe over the opening, on the lintel's face.
  {
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const a = -Math.PI + 0.72 + (k / 12) * (Math.PI * 2 - 1.44);
      pts.push([Math.sin(a) * 0.34, 7.72 - Math.cos(a) * 0.38, 8.1]);
    }
    soup.add(tube(pts, 0.065, { sides: 4, steps: 16, round: 0, section: () => [1.5, 0.6] }), tone(IRON, 1.3));
  }

  const group = new THREE.Group();
  group.add(soupMesh(soup, 1.2), glowMesh(glow, sheet.tex, 1.25));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Village bakery: 20 x 16ft, ridge at 15. Half timbered, tiled, with a sign to read from the street,
// and the whole back of the room taken by a domed brick oven whose mouth is lit from inside.
// ---------------------------------------------------------------------------------------------
function bakerySignArt(ctx, w, h) {
  ctx.fillStyle = '#5a2a1a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e0b35a';
  ctx.lineWidth = 7;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  // The loaf, big enough to say "bread" to somebody who cannot read yet.
  const lx = w / 2; const ly = h * 0.33;
  ctx.fillStyle = '#d99a44';
  ctx.beginPath();
  ctx.ellipse(lx, ly, w * 0.2, h * 0.17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b5702b';
  ctx.beginPath();
  ctx.ellipse(lx, ly + h * 0.05, w * 0.2, h * 0.12, 0, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = '#f7dfa4';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (const dx of [-0.09, 0, 0.09]) {
    ctx.beginPath();
    ctx.moveTo(lx + w * (dx - 0.022), ly + h * 0.06);
    ctx.lineTo(lx + w * (dx + 0.03), ly - h * 0.08);
    ctx.stroke();
  }
  const text = 'BAKERY';
  let px = Math.floor(h * 0.4);
  ctx.font = `bold ${px}px Georgia, "Times New Roman", serif`;
  const measured = ctx.measureText(text).width;
  if (measured > w * 0.84) { px = Math.floor((px * w * 0.84) / measured); ctx.font = `bold ${px}px Georgia, "Times New Roman", serif`; }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2d120a';
  ctx.fillText(text, w / 2 + 3, h * 0.74 + 3);
  ctx.fillStyle = '#f4dc9c';
  ctx.fillText(text, w / 2, h * 0.74);
}

function ovenBackArt(ctx, w, h) {
  ctx.fillStyle = '#25090a';
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.86, h * 0.04, w / 2, h * 0.8, h * 0.8);
  g.addColorStop(0, '#ffe08a');
  g.addColorStop(0.25, '#ff9c2c');
  g.addColorStop(0.55, '#c23f12');
  g.addColorStop(1, '#3a0f08');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // The bed of embers along the oven floor.
  for (let i = 0; i < 90; i++) {
    const x = (i * 0.618034 % 1) * w; const y = h * (0.88 + ((i * 0.754877) % 1) * 0.12);
    ctx.fillStyle = i % 3 === 0 ? '#5c2412' : (i % 3 === 1 ? '#ffd75e' : '#f07a1c');
    ctx.beginPath();
    ctx.ellipse(x, y, 1.6 + (i % 4) * 0.8, 1 + (i % 3) * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function ovenTunnelArt(ctx, w, h) {
  // Across the height of this sheet: at the bottom, the mouth's cool lip; at the top, the heat within.
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, '#1a0a07');
  g.addColorStop(0.45, '#6b2510');
  g.addColorStop(1, '#ee7a22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function villageBakery() {
  const rng = seededRandom(5401);
  const atlas = makeAtlas(5401, [
    { name: 'plaster', tu: 8, tv: 8, px: 96 },
    { name: 'tile', tu: 8, tv: 4, px: 256 },
    { name: 'brick', tu: 4, tv: 2, px: 160 },
    { name: 'plank', tu: 16, tv: 4, px: 96 },
    { name: 'stone', tu: 8, tv: 8, px: 128 },
    { name: 'grain', tu: 8, tv: 2, px: 128, grain: true },
  ], { rects: [{ name: 'sign', x: 0, y: 870, w: 280, h: 150, draw: bakerySignArt }] });
  const sheet = glowAtlas(5402, [
    { name: 'ovenBack', x: 0, y: 0, w: 128, h: 128, draw: ovenBackArt },
    { name: 'tunnel', x: 128, y: 0, w: 64, h: 128, draw: ovenTunnelArt },
    glassRect(192, 0),
    dayRect(192, 64),
  ], { w: 256, h: 128 });
  const soup = new Soup(atlas);
  const glow = new Soup(sheet);
  const wood = (k = 1, hex = DARK) => ({ c: tone(hex, k), s: 'grain' });
  const CREAM = 0xdccfaa; const INNER = 0xcdbf9c;
  const ROOF = 0xb2603a;
  const wallSt = { c: CREAM, s: 'plaster', in: { c: INNER, s: 'plaster' }, jamb: wood(1.1), py: wood(1), ny: wood(1) };
  const X = 10; const Z = 8; const T = 0.25;
  const E = 9.15; const R = 15;
  const pitch = (R - 9.2) / Z;
  const roofY = (z) => R - Math.abs(z) * pitch;
  const east = wallFrame(soup, 'z', X - T, 1);
  const west = wallFrame(soup, 'z', -X + T, -1);
  const front = wallFrame(soup, 'x', Z - T, 1);
  const back = wallFrame(soup, 'x', -Z + T, -1);

  const DC = -6.15; const DW = 3.4; const DH = 6.9;
  const WC = 2.65; const WW = 9.3; const WS = 2.95; const WH = 6.9;
  wallWithOpenings(front, -X + 2 * T, X - 2 * T, -0.4, E, T, [{ c: DC, w: DW, head: DH }, { c: WC, w: WW, sill: WS, head: WH }], wallSt);
  back.box(-X + 2 * T, X - 2 * T, -0.4, E, -T, T, wallSt);
  const sideWin = { c: 3.6, w: 2.8, sill: 6.15, head: 8.2 };
  wallWithOpenings(east, -Z, Z, -0.4, E, T, [sideWin], wallSt);
  wallWithOpenings(west, -Z, Z, -0.4, E, T, [sideWin], wallSt);
  glazedWindow(east, glow, { ...sideWin, half: T, col: wood(1.05), across: 2, up: 2 });
  glazedWindow(west, glow, { ...sideWin, half: T, col: wood(1.05), across: 2, up: 2 });
  // The gables stand on the walls, and the frame carries up into them.
  for (const [x0, x1] of [[-X, -X + 2 * T], [X - 2 * T, X]]) {
    soup.prism([[-Z, E], [Z, E], [0, R - 0.2]], (u, v, w) => [w, v, u], x0, x1, { c: CREAM, s: 'plaster' });
  }

  // THE FOUNDATION, and the floor.
  const stoneSt = { c: STONE, s: 'stone' };
  soup.box(X - 0.4, X + 0.12, -0.4, 0.6, -Z - 0.12, Z + 0.12, stoneSt);
  soup.box(-X - 0.12, -X + 0.4, -0.4, 0.6, -Z - 0.12, Z + 0.12, stoneSt);
  soup.box(-X, X, -0.4, 0.6, -Z - 0.12, -Z + 0.4, stoneSt);
  soup.box(-X, DC - DW / 2, -0.4, 0.6, Z - 0.4, Z + 0.12, stoneSt);
  soup.box(DC + DW / 2, X, -0.4, 0.6, Z - 0.4, Z + 0.12, stoneSt);
  soup.box(-X + 0.45, X - 0.45, -0.4, 0.05, -Z + 0.45, Z - 0.45, { c: tone(TIMBER, 1.0), py: { s: 'plank' }, skip: 'ny' });
  soup.box(DC - DW / 2, DC + DW / 2, -0.4, 0.075, Z - 0.5, Z + 0.3, { c: tone(STONE, 1.1), s: 'stone' });

  // THE CEILING: pale boards between dark joists, which is what such a room has overhead.
  soup.box(-X + 0.45, X - 0.45, 8.82, 9.05, -Z + 0.45, Z - 0.45, { c: 0xcbbd9a, ny: { s: 'plank' } });
  for (let x = -8.4; x <= 8.5; x += 2.8) soup.box(x - 0.2, x + 0.2, 8.42, 8.82, -Z + 0.45, Z - 0.45, wood(1 + rng() * 0.2));

  // THE ROOF: terracotta, on one closed chevron, with a row of round ridge tiles.
  soup.roof({
    axis: 'x', l0: -X - 0.75, l1: X + 0.75, half: Z + 0.9, yE: R - (Z + 0.9) * pitch, yR: R, t: 0.34,
    top: { c: ROOF, s: 'tile' }, under: { c: tone(TIMBER, 0.8), s: 'grain' }, end: wood(1), fascia: wood(1),
  });
  const ridge = new THREE.CylinderGeometry(1, 1, 1, 8);
  const ridgeRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  for (let i = 0; i < 16; i++) {
    const x = mix(-X - 0.65, X + 0.65, (i + 0.5) / 16);
    soup.add(ridge, tone(ROOF, i % 2 ? 0.86 : 0.74), new THREE.Matrix4().compose(new THREE.Vector3(x, R + 0.03, 0), ridgeRot, new THREE.Vector3(0.26, 1.42, 0.26)));
  }

  // THE TIMBER FRAME, proud of the plaster. It is the look of the building, so it is real geometry, and
  // every member is hidden at its ends inside the next.
  const P0 = T - 0.02; const P1 = T + 0.09;
  const beam = (k = 1) => wood(k + rng() * 0.14);
  const frameOn = (f, c0, c1, posts, { head = null, sill = null } = {}) => {
    f.box(c0, c1, 0.6, 1.0, P0, P1, beam(1));
    f.box(c0, c1, 8.55, E, P0, P1, beam(1));
    for (const c of posts) f.box(c - 0.24, c + 0.24, 0.6, 8.6, P0, P1, beam(1.05));
    if (head !== null) f.box(c0, c1, head, head + 0.4, P0, P1, beam(1));
    if (sill !== null) f.box(c0, c1, sill, sill + 0.34, P0, P1, beam(1));
  };
  const brace = (f, c0, y0, c1, y1) => {
    const a = f.at(c0, y0, (P0 + P1) / 2 - 0.005); const b = f.at(c1, y1, (P0 + P1) / 2 - 0.005);
    soup.beam(a, b, 0.32, P1 - P0 - 0.01, beam(1), f.axis === 'x' ? [0, 0, 1] : [1, 0, 0]);
  };

  // Front: door posts, window posts, a rail across the head of both.
  const fp = [-X + 0.3, DC - DW / 2 - 0.2, DC + DW / 2 + 0.2, WC - WW / 2 - 0.2, WC + WW / 2 + 0.2, X - 0.3];
  front.box(-X, X, 0.6, 1.0, P0, P1, { ...beam(1) });
  front.box(-X, X, 8.55, E, P0, P1, beam(1));
  for (const c of fp) front.box(c - 0.24, c + 0.24, 1.0, 8.55, P0, P1, beam(1.05));
  front.box(-X, X, WH + 0.0, WH + 0.42, P0, P1, beam(1));
  front.box(WC - WW / 2 - 0.2, WC + WW / 2 + 0.2, WS - 0.42, WS - 0.04, P0, P1, beam(1));
  // Braces: the crossed panels under the shop window are what say "half timbered" from a long way off.
  const wl = WC - WW / 2 - 0.2; const wr = WC + WW / 2 + 0.2; const wm = WC;
  brace(front, wl, 1.0, wm, WS - 0.42); brace(front, wr, 1.0, wm, WS - 0.42);
  brace(front, -X + 0.4, 1.0, DC - DW / 2 - 0.3, WH); 
  brace(front, wr + 0.1, 1.0, X - 0.4, WH);
  for (const [a, b] of [[-X + 0.3, fp[1]], [fp[2], fp[3]], [fp[3], (fp[3] + fp[4]) / 2], [(fp[3] + fp[4]) / 2, fp[4]], [fp[4], fp[5]]]) {
    brace(front, a, WH + 0.42, b, 8.55);
  }
  front.box((fp[3] + fp[4]) / 2 - 0.2, (fp[3] + fp[4]) / 2 + 0.2, WH + 0.42, 8.55, P0, P1, beam(1));
  // Lining the door and the shop window.
  for (const [c0, c1, y1] of [[DC - DW / 2 - 0.02, DC - DW / 2 + 0.1, DH], [DC + DW / 2 - 0.1, DC + DW / 2 + 0.02, DH]]) front.box(c0, c1, 0.05, y1, -T - 0.06, T + 0.06, beam(1.1));
  front.box(DC - DW / 2, DC + DW / 2, DH - 0.1, DH + 0.02, -T - 0.06, T + 0.06, beam(1.1));
  plankDoor(soup, DC - DW / 2 + 0.06, Z - 2 * T - 0.06, DW - 0.12, DH - 0.1, 1.5, 0x4d6e4a, IRON);

  // Sides and back.
  for (const f of [east, west]) {
    frameOn(f, -Z, Z, [-Z + 0.3, -3.2, 1.6, 5.6, Z - 0.3], {});
    f.box(-Z, Z, 5.65, 6.0, P0, P1, beam(1));
    brace(f, -Z + 0.4, 1.0, -3.3, 5.65); brace(f, 1.5, 5.65, -3.1, 1.0); brace(f, Z - 0.4, 1.0, 5.7, 5.65);
    // The gable: a king post and two struts carrying the frame to the ridge.
    const zAt = (y) => Z * (1 - (y - E) / (R - 0.2 - E));
    f.box(-0.22, 0.22, E, R - 0.45, P0, P1, beam(1.1));
    brace(f, -zAt(E + 0.2) + 0.5, E + 0.05, 0, E + 3.6);
    brace(f, zAt(E + 0.2) - 0.5, E + 0.05, 0, E + 3.6);
    f.box(-3.9, 3.9, E + 2.1, E + 2.42, P0, P1, beam(1));
  }
  frameOn(back, -X, X, [-X + 0.3, -3.5, 3.5, X - 0.3], {});
  back.box(-X, X, 4.6, 4.95, P0, P1, beam(1));
  for (const [a, b] of [[-X + 0.4, -3.6], [X - 0.4, 3.6]]) { brace(back, a, 1.0, b, 4.6); brace(back, a, 8.55, b, 4.95); }
  brace(back, -3.4, 1.0, 3.4, 4.6); brace(back, 3.4, 1.0, -3.4, 4.6);

  // THE SHOP WINDOW. By night two boards close it; by day the lower one is let down on its brackets to
  // make the counter, and the upper one is propped up to shade it.
  const a = WC - WW / 2; const b = WC + WW / 2;
  for (const y of [WS - 0.08, WH - 0.04]) front.box(a, b, y, y + 0.12, -T - 0.08, T + 0.08, beam(1.1));
  for (const c of [a, b]) front.box(c - 0.06, c + 0.06, WS, WH, -T - 0.08, T + 0.08, beam(1.1));
  const COUNTER_Y = WS - 0.08;
  const boards = 7;
  for (let i = 0; i < boards; i++) {
    const z0 = mix(Z - 0.02, Z + 1.95, i / boards); const z1 = mix(Z - 0.02, Z + 1.95, (i + 1) / boards);
    soup.box(a - 0.02, b + 0.02, COUNTER_Y - 0.14, COUNTER_Y, z0 + 0.008, z1 - 0.008, wood(1.0 + rng() * 0.2, TIMBER));
  }
  for (const c of [a + 0.4, WC, b - 0.4]) {
    soup.beam([c, COUNTER_Y - 1.65, Z + 0.1], [c, COUNTER_Y - 0.14, Z + 1.5], 0.2, 0.2, beam(1));
    soup.box(c - 0.12, c + 0.12, COUNTER_Y - 2.1, COUNTER_Y - 1.2, Z + 0.09, Z + 0.17, IRON);
  }
  // The inside of the sill, so the opening has a real thickness.
  soup.box(a, b, WS - 0.2, WS - 0.08, Z - 2 * T - 0.5, Z, wood(1.05, TIMBER));
  const lift = 0.36;
  soup.at(new THREE.Matrix4().makeRotationX(-lift).setPosition(WC, WH + 0.08, Z + 0.1), () => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const x0 = mix(-WW / 2 - 0.05, WW / 2 + 0.05, i / n); const x1 = mix(-WW / 2 - 0.05, WW / 2 + 0.05, (i + 1) / n);
      soup.box(x0 + 0.01, x1 - 0.01, 0, 0.1, 0, 2.1, wood(1.0 + rng() * 0.25, 0x4d6e4a));
    }
    for (const z of [0.3, 1.8]) soup.box(-WW / 2 - 0.05, WW / 2 + 0.05, -0.08, 0, z - 0.14, z + 0.14, wood(0.9, 0x4d6e4a));
  });
  const shutterAt = (d) => [WH + 0.08 + Math.sin(lift) * d, Z + 0.1 + Math.cos(lift) * d];
  for (const c of [a + 0.4, b - 0.4]) {
    const [yS, zS] = shutterAt(1.75);
    soup.beam([c, COUNTER_Y, zS - 0.2], [c, yS - 0.06, zS], 0.11, 0.11, wood(1.2, TIMBER));
  }

  // THE SIGN, hung square to the wall on an iron bracket, so that it reads to both ends of the street.
  // The board is one solid and each of its faces gets the picture the right way round.
  const SX = -8.85;
  const BY = 8.2;
  const SY0 = 5.95; const SH = 1.72; const SW = 3.2; const SZ0 = Z + 0.62;
  soup.beam([SX, BY, Z + 0.1], [SX, BY, SZ0 + SW + 0.32], 0.09, 0.12, IRON);
  soup.beam([SX, BY - 1.5, Z + 0.1], [SX, BY - 0.02, SZ0 + 2.2], 0.08, 0.08, IRON);
  soup.add(tube([[SX, BY - 0.62, Z + 0.1], [SX, BY - 0.15, Z + 0.55], [SX, BY - 0.48, Z + 1.05], [SX, BY - 0.72, Z + 0.72]], 0.04, { sides: 4, steps: 12, round: 0 }), IRON);
  soup.box(SX - 0.14, SX + 0.14, BY - 1.75, BY + 0.2, Z, Z + 0.14, IRON);
  for (const c of [SZ0 + 0.35, SZ0 + SW - 0.35]) {
    soup.beam([SX, BY, c], [SX, SY0 + SH + 0.14, c], 0.05, 0.05, IRON);
    soup.box(SX - 0.04, SX + 0.04, SY0 + SH + 0.1, SY0 + SH + 0.2, c - 0.04, c + 0.04, IRON);
  }
  soup.box(SX - 0.06, SX + 0.06, SY0 - 0.12, SY0 + SH + 0.12, SZ0 - 0.12, SZ0 + SW + 0.12, wood(1, TIMBER));
  soup.box(SX - 0.075, SX + 0.075, SY0, SY0 + SH, SZ0, SZ0 + SW, { c: 0xffffff, px: { s: 'sign' }, nx: { s: 'sign' }, py: { c: tone(TIMBER, 1) }, ny: { c: tone(TIMBER, 1) }, pz: { c: tone(TIMBER, 1) }, nz: { c: tone(TIMBER, 1) } });

  // THE OVEN. A brick base across the back wall, a dome rising off it as a half revolution against the
  // wall, and an arched mouth that stands proud, because there is no cutting a hole in a closed solid.
  // The mouth is built void first: a ring of voussoirs, then a lit tunnel, then the fire at the end.
  const OZ = -Z + 2 * T;
  const OTOP = 2.45;
  const OR = 6.0; const DH_ = 5.1;
  const ovenBrick = { c: (x, y) => tone(BRICK, mix(1.1, 0.72, sstep(y, 4.6, 7.4))), s: 'brick' };
  soup.box(-7.3, 7.3, 0.05, OTOP, OZ, 0.05, { ...ovenBrick, py: { c: tone(BRICK, 0.95), s: 'brick' } });
  soup.box(-7.5, 7.5, OTOP, OTOP + 0.16, -1.3, 0.2, tone(0xa49c8c, 1));
  const dome = [];
  for (let i = 0; i <= 7; i++) { const t = (i / 7) * Math.PI / 2; dome.push([OR * Math.cos(t), OTOP + DH_ * Math.sin(t)]); }
  soup.spin(dome, ovenBrick, { sides: 22, from: -Math.PI / 2, sweep: Math.PI, centre: [0, 0, OZ] });
  // Where the dome meets the wall, two small quarter cheeks stop the eye falling in behind it.
  const MZ1 = 0.06; const MZ0 = -1.4;
  const SPR = OTOP + 1.28; const RI = 1.72; const RO = 2.74;
  const IBASE = OTOP + 0.16;
  soup.box(-RO, -RI, IBASE, SPR, MZ0, MZ1, ovenBrick);
  soup.box(RI, RO, IBASE, SPR, MZ0, MZ1, ovenBrick);
  const V = 13;
  for (let i = 0; i < V; i++) {
    const a0 = (i / V) * Math.PI; const a1 = ((i + 1) / V) * Math.PI;
    const quad = [
      [Math.cos(a0) * RI, SPR + Math.sin(a0) * RI], [Math.cos(a0) * RO, SPR + Math.sin(a0) * RO],
      [Math.cos(a1) * RO, SPR + Math.sin(a1) * RO], [Math.cos(a1) * RI, SPR + Math.sin(a1) * RI],
    ];
    const k = i % 2 ? 1.2 : 0.88;
    soup.prism(quad, (u, v, w) => [u, v, w], MZ0, MZ1 + (i % 2 ? 0 : 0.05), tone(BRICK, k));
  }
  // The tunnel's walls, glowing from the fire end. Their v runs from the lip inward, so the colour does
  // the work of the depth a student cannot walk into.
  const [tu0, tv0, tu1, tv1] = sheet.bands.tunnel.rect;
  const tuMid = (tu0 + tu1) / 2;
  // A hair inside the bricks, or the two surfaces fight over every other voussoir.
  const RT = RI - 0.02;
  const tunnelRing = [[RT, IBASE], [RT, SPR]];
  for (let i = 1; i <= 12; i++) { const an = (i / 12) * Math.PI; tunnelRing.push([Math.cos(an) * RT, SPR + Math.sin(an) * RT]); }
  tunnelRing.push([-RT, IBASE]);
  const ZB = MZ0 + 0.04; const ZL = MZ1 + 0.02;
  for (let i = 0; i < tunnelRing.length - 1; i++) {
    const p = tunnelRing[i]; const q = tunnelRing[i + 1];
    const e = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(e[0], e[1]) || 1;
    const n = [e[1] / l, -e[0] / l, 0];
    // Inward: toward the axis of the arch.
    const inward = (n[0] * ((p[0] + q[0]) / 2) + n[1] * ((p[1] + q[1]) / 2 - SPR)) > 0 ? [-n[0], -n[1], 0] : n;
    glow._poly(
      [[p[0], p[1], ZL], [q[0], q[1], ZL], [q[0], q[1], ZB], [p[0], p[1], ZB]],
      [inward, inward, inward, inward],
      [[tuMid, tv0 + 0.01], [tuMid, tv0 + 0.01], [tuMid, tv1 - 0.01], [tuMid, tv1 - 0.01]], { c: 0xffffff },
    );
  }
  glow.box(-RI - 0.02, RI + 0.02, IBASE, SPR + RI + 0.02, ZB - 0.06, ZB, { c: 0xffffff, s: 'ovenBack' });
  const n0 = [0, 1, 0];
  glow._poly([[-RI, IBASE + 0.01, ZL], [RI, IBASE + 0.01, ZL], [RI, IBASE + 0.01, ZB], [-RI, IBASE + 0.01, ZB]], [n0, n0, n0, n0], [[tuMid, tv0 + 0.01], [tuMid, tv0 + 0.01], [tuMid, tv1 - 0.01], [tuMid, tv1 - 0.01]], { c: 0xffffff });
  // The flue, from the crown of the dome up through the ceiling and out over the roof.
  soup.box(-1.3, 1.3, OTOP + DH_ - 0.5, 8.9, OZ, OZ + 2.2, { c: tone(BRICK, 0.72), s: 'brick' });
  soup.box(-1.3, 1.3, 9.0, 17.2, OZ - 0.45, OZ + 1.75, { c: tone(BRICK, 0.92), s: 'brick', py: { c: 0x120e0c } });
  soup.box(-1.52, 1.52, 16.4, 16.72, OZ - 0.67, OZ + 1.97, { c: tone(BRICK, 0.7), s: 'brick' });
  soup.box(-1.52, 1.52, 17.2, 17.4, OZ - 0.67, OZ + 1.97, { c: tone(BRICK, 0.55), s: 'brick', py: { c: 0x120e0c } });

  // THE PEEL, leaning on the oven's flank: a long ash pole with a blade on the end.
  const pa = [5.1, 0.05, 0.75]; const pb = [4.5, 8.1, -2.3];
  const { m: peelM, len: peelLen } = alongMatrix(pa, pb, [0, 0, 1]);
  soup.at(peelM, () => {
    soup.box(-0.055, 0.055, -0.055, 0.055, 0, peelLen - 1.25, wood(1.25, 0xb99868));
    const blade = [[-0.24, 0], [0.24, 0], [0.56, 0.4], [0.56, 1.2], [-0.56, 1.2], [-0.56, 0.4]];
    soup.prism(blade, (u, v, w) => [u, w, peelLen - 1.3 + v], -0.03, 0.03, tone(0xb99868, 1.12));
  });
  // A second peel, resting in the oven's mouth on a little trestle, with a loaf on it going in.
  const loafT = loafTemplate(8, 5);
  const inA = [0.25, 3.25, 2.9]; const inB = [0, IBASE + 0.42, -0.5];
  const { m: peel2 } = alongMatrix(inA, inB, [0, 1, 0]);
  const peel2Len = Math.hypot(inA[0] - inB[0], inA[1] - inB[1], inA[2] - inB[2]);
  soup.at(peel2, () => {
    soup.box(-0.055, 0.055, -0.055, 0.055, 0, peel2Len, wood(1.25, 0xb99868));
    const blade = [[-0.24, 0], [0.24, 0], [0.56, 0.4], [0.56, 1.1], [-0.56, 1.1], [-0.56, 0.4]];
    soup.prism(blade, (u, v, w) => [u, w, peel2Len + v - 0.15], -0.03, 0.03, tone(0xb99868, 1.12));
    placeLoaf(soup, loafT, 0, 0.03, peel2Len + 0.45, 0.86, 0.6, 0.3, 0.2, { col: tone(0xc9ac78, 1) });
  });
  soup.beam([inA[0] - 0.5, 0.05, inA[2] - 0.5], [inA[0], inA[1] - 0.06, inA[2] - 0.5], 0.14, 0.14, wood(1.05, TIMBER));
  soup.beam([inA[0] + 0.5, 0.05, inA[2] - 0.5], [inA[0], inA[1] - 0.06, inA[2] - 0.5], 0.14, 0.14, wood(1.05, TIMBER));

  // THE KNEADING TABLE, and what is on it: a heavy top, dough at three stages, flour on the boards.
  const KX = 3.6; const KZ = 3.9;
  soup.box(KX - 3, KX + 3, 2.86, 3.1, KZ - 1.35, KZ + 1.35, wood(1.35, TIMBER));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) soup.box(KX + sx * 2.65 - 0.17, KX + sx * 2.65 + 0.17, 0.05, 2.86, KZ + sz * 1.05 - 0.17, KZ + sz * 1.05 + 0.17, wood(1.05, TIMBER));
    soup.box(KX + sx * 2.65 - 0.09, KX + sx * 2.65 + 0.09, 0.8, 1.05, KZ - 1, KZ + 1, wood(0.95, TIMBER));
  }
  soup.box(KX - 2.6, KX + 2.6, 0.9, 0.98, KZ - 0.5, KZ + 0.5, wood(0.95, TIMBER));
  soup.box(KX - 1.3, KX + 2.5, 3.1, 3.11, KZ - 1.0, KZ + 1.1, 0xe8e1cf);
  const dough = new THREE.SphereGeometry(1, 12, 7);
  for (const [dx, dz, r, sq] of [[-0.5, 0.2, 0.52, 0.56], [0.75, -0.4, 0.4, 0.68], [1.65, 0.45, 0.32, 0.62]]) {
    soup.add(dough, 0xe6d6ae, new THREE.Matrix4().compose(new THREE.Vector3(KX + dx, 3.11 + r * sq * 0.82, KZ + dz), new THREE.Quaternion(), new THREE.Vector3(r, r * sq, r)));
  }
  soup.add(tube([[KX - 2.3, 3.2, KZ + 0.6], [KX - 1.1, 3.2, KZ - 0.2]], 0.09, { sides: 8, steps: 1, round: 1, straight: true }), wood(1.3, 0xb99868).c);
  soup.add(tube([[KX - 2.6, 3.2, KZ + 0.82], [KX - 2.3, 3.2, KZ + 0.6]], 0.045, { sides: 6, steps: 1, round: 1, straight: true }), wood(1.1, 0xb99868).c);
  soup.add(tube([[KX - 1.1, 3.2, KZ - 0.2], [KX - 0.8, 3.2, KZ - 0.42]], 0.045, { sides: 6, steps: 1, round: 1, straight: true }), wood(1.1, 0xb99868).c);
  soup.spin([[0, 3.1], [0.42, 3.1], [0.62, 3.42], [0.66, 3.5], [0.58, 3.5], [0.4, 3.26], [0, 3.26]], tone(0xb46a3a, 1), { sides: 14, centre: [KX - 2.15, 0, KZ - 0.72], hard: [3, 4] });

  // THE SHELVES OF LOAVES, down both side walls: a full day's baking is the whole point of the room.
  for (const side of [-1, 1]) {
    const wallX = side * (X - 2 * T);
    const inner = side * -1;
    for (const [i, y] of [2.2, 3.55, 4.9].entries()) {
      const z0 = 0.6; const z1 = Z - 1.1;
      soup.box(Math.min(wallX, wallX + inner * 1.5), Math.max(wallX, wallX + inner * 1.5), y - 0.1, y, z0, z1, wood(1.15 + rng() * 0.1, TIMBER));
      let z = z0 + 0.5;
      let k = 0;
      while (z < z1 - 0.3) {
        const round = (k + i) % 3 === 0;
        const len = round ? 0.8 : 1.25; const wid = round ? 0.8 : 0.58; const hgt = round ? 0.36 : 0.3;
        const x = wallX + inner * (0.75 + (rng() - 0.5) * 0.14);
        const col = tone(CRUST, 0.92 + rng() * 0.24);
        placeLoaf(soup, loafT, x, y + 0.01, z, len, wid, hgt, Math.PI / 2 + (rng() - 0.5) * 0.3, { col, slashes: round ? 0 : 2 });
        z += (round ? 0.92 : 0.72) + rng() * 0.08;
        k += 1;
      }
    }
    for (const z of [0.9, 3.7, 6.5]) {
      soup.box(Math.min(wallX, wallX + inner * 1.55), Math.max(wallX, wallX + inner * 1.55), 0.05, 5.0, z - 0.09, z + 0.09, wood(1.0, TIMBER));
    }
  }
  // On the counter, for the street: the ones to sell first.
  const CY = COUNTER_Y;
  for (let i = 0; i < 9; i++) {
    const x = mix(a + 0.8, b - 0.8, i / 8);
    const round = i % 2 === 0;
    placeLoaf(soup, loafT, x + (rng() - 0.5) * 0.1, CY + 0.005, Z + 0.95 + (rng() - 0.5) * 0.35, round ? 0.8 : 1.3, round ? 0.8 : 0.58, round ? 0.36 : 0.3, 0.3 + rng() * 0.6, { col: tone(CRUST, 0.95 + rng() * 0.2), slashes: round ? 0 : 2 });
  }

  // Sacks of flour by the door, a barrel of water, the things bread comes from.
  const sack = [[0, 0.05], [0.55, 0.05], [0.84, 0.5], [0.84, 1.2], [0.56, 1.8], [0.22, 2.05], [0.24, 2.2], [0.3, 2.34], [0, 2.38]];
  for (const [x, z, k] of [[-8.3, 3.0, 1], [-7.0, 2.2, 0.94], [-8.2, 1.4, 1.03]]) {
    soup.spin(sack, tone(0xd9cba4, k), { sides: 11, centre: [x, 0, z], hard: [5, 6] });
  }
  soup.spin([[0, 0.05], [1.0, 0.05], [1.14, 1.0], [1.14, 1.5], [1.0, 2.5], [0.88, 2.5], [0.88, 2.34], [0.86, 2.34], [0, 2.34]], {
    c: (x, y, z) => {
      const r = Math.hypot(x + 3, z - 6.2);
      if (r < 0.87 && y > 2.2) return [0.05, 0.11, 0.15];
      const band = (y > 0.55 && y < 0.72) || (y > 1.9 && y < 2.08);
      return band ? tone(IRON, 1) : tone(TIMBER, Math.floor((Math.atan2(x + 3, z - 6.2) + Math.PI) * 3.8) % 2 ? 0.9 : 1.1);
    },
  }, { sides: 22, centre: [-3, 0, 6.2], hard: [1, 4, 5, 6, 7] });

  const group = new THREE.Group();
  // The oven's tunnel is an inside surface with nothing behind it, hence DoubleSide on this one sheet.
  group.add(soupMesh(soup, 1.1), glowMesh(glow, sheet.tex, 1.15, THREE.DoubleSide));
  return group;
}

// ---------------------------------------------------------------------------------------------
// Grain windmill: a tower mill. The tower is 16ft across at the foot and 11 at the top, and its cap
// tops out at 32ft. The windshaft has to come out of the CAP, so the sails' centre cannot be lower than
// the cap's skirt; that is what fixes the hub at 23.5ft. With 18ft sails their tips clear the ground by
// 5.5ft, which is what lets a 5ft child walk under one, and the highest tip is at 41.5ft.
// ---------------------------------------------------------------------------------------------
const HUB_Y = 23.5;
const SAIL_LEN = 18;

function grainWindmill() {
  const rng = seededRandom(5501);
  const atlas = makeAtlas(5501, [
    { name: 'stone', tu: 8, tv: 8, px: 320 },
    { name: 'shingle', tu: 8, tv: 4, px: 256 },
    { name: 'dirt', tu: 8, tv: 8, px: 96 },
    { name: 'grain', tu: 8, tv: 2, px: 192, grain: true },
  ]);
  const sheet = glowAtlas(5502, [glassRect(0, 0), dayRect(64, 0)], { w: 128, h: 64 });
  const soup = new Soup(atlas);
  const glow = new Soup(sheet);
  const wood = (k = 1, hex = TIMBER) => ({ c: tone(hex, k), s: 'grain' });

  const TOWER_TOP = 22;
  const R0 = 8; const R1 = 5.5;
  const rAt = (y) => mix(R0, R1, y / TOWER_TOP);
  const WALL = 1.15;
  const DOOR_A = Math.PI / 2; // the door looks along +X, on the side, clear of the sails
  const DOOR_HALF = 1.75;
  const DA = Math.asin(DOOR_HALF / rAt(3));
  const SPRING = 5.15; const ARCH = 1.55;
  const cut = (a) => {
    const d = Math.abs(a - DOOR_A);
    if (d >= DA) return -1e6;
    return SPRING + ARCH * Math.sqrt(Math.max(0, 1 - (d / DA) ** 2));
  };
  // Columns: an even ring, with the door's edges and a fan of samples round its arch cut in exactly.
  const angles = [];
  const cols = 44;
  for (let i = 0; i <= cols; i++) {
    const a = (i / cols) * Math.PI * 2;
    if (Math.abs(a - DOOR_A) > DA + 0.01) angles.push(a);
  }
  angles.push(DOOR_A - DA, DOOR_A + DA);
  for (let i = 0; i <= 10; i++) angles.push(DOOR_A - DA * 0.9999 + (i / 10) * (2 * DA * 0.9999));
  angles.sort((p, q) => p - q);
  const stoneTint = (x, y) => tone(STONE, mix(0.86, 1.08, sstep(y, 0, 7)));
  const towerSt = { c: stoneTint, s: 'stone' };

  // THE TOWER. The outside and the inside are separate surfaces with the same gap in them, so a door
  // is just a place where neither has any wall.
  soup.spin([[R0, 0], [R1, TOWER_TOP]], towerSt, { cut, angles, uTiles: 6 });
  const INNER_TOP = 9.3;
  const rIn = (y) => rAt(y) - WALL;
  soup.spin([[rIn(0), 0], [rIn(INNER_TOP), INNER_TOP]], { c: tone(STONE, 0.98), s: 'stone' }, { cut, angles, uTiles: 5, inward: true });
  // The reveal: both jambs, and the soffit of the arch.
  const reveal = tone(0xa39c8d, 1);
  const f = soup.flat;
  for (const [a, sign] of [[DOOR_A - DA, 1], [DOOR_A + DA, -1]]) {
    const s = Math.sin(a); const c = Math.cos(a);
    const tangent = [c * sign, 0, -s * sign];
    const P = (r, y) => [r * s, y, r * c];
    const h = SPRING;
    soup._poly([P(rIn(0), 0), P(rAt(0), 0), P(rAt(h), h), P(rIn(h), h)], [tangent, tangent, tangent, tangent], [f, f, f, f], { c: reveal });
  }
  for (let i = 0; i < 10; i++) {
    const a0 = DOOR_A - DA * 0.9999 + (i / 10) * (2 * DA * 0.9999);
    const a1 = DOOR_A - DA * 0.9999 + ((i + 1) / 10) * (2 * DA * 0.9999);
    const h0 = cut(a0); const h1 = cut(a1);
    const P = (r, y, a) => [r * Math.sin(a), y, r * Math.cos(a)];
    const down = [0, -1, 0];
    soup._poly([P(rIn(h0), h0, a0), P(rAt(h0), h0, a0), P(rAt(h1), h1, a1), P(rIn(h1), h1, a1)], [down, down, down, down], [f, f, f, f], { c: reveal });
  }

  // A foundation ring that runs below the ground, broken at the door.
  const ringFrom = DOOR_A + DA; const ringSweep = Math.PI * 2 - 2 * DA;
  soup.spin([[0, -0.4], [R0 + 0.22, -0.4], [R0 + 0.22, 0.5], [R0 - 0.02, 0.72], [R0 - 0.4, 0.72]], { c: tone(STONE, 0.78), s: 'stone' }, { sides: 40, from: ringFrom, sweep: ringSweep, uTiles: 7, hard: [1, 2, 3] });
  soup.box(rIn(0) - 0.4, R0 + 0.3, -0.4, 0.08, -DOOR_HALF - 0.05, DOOR_HALF + 0.05, { c: tone(STONE, 1.05), s: 'stone' });

  // Dressed stones round the door. They stand a little proud, and their shadow is the door's frame.
  const doorStone = (k) => tone(0xa9a292, k);
  const stoneOn = (tau, y, w, h, roll, k) => {
    const a = DOOR_A + tau / rAt(y);
    const r = rAt(y);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)),
      new THREE.Vector3(1, 1, 1),
    );
    soup.at(m, () => soup.box(-w / 2, w / 2, -h / 2, h / 2, -0.55, 0.14, doorStone(k)));
  };
  for (let i = 0; i < 4; i++) {
    const h = 1.22;
    const y = 0.72 + i * 1.28;
    const wide = i % 2 ? 0.86 : 0.6;
    for (const sz of [-1, 1]) stoneOn(sz * (DOOR_HALF + wide / 2 - 0.05), y, wide, h, 0, i % 2 ? 1.08 : 0.94);
  }
  const archStones = 9;
  for (let i = 0; i < archStones; i++) {
    const th = ((i + 0.5) / archStones) * Math.PI;
    const tau = Math.cos(th) * (DOOR_HALF + 0.26);
    const y = SPRING + Math.sin(th) * (ARCH + 0.3);
    stoneOn(tau, y, 0.66, i === 4 ? 0.82 : 0.62, th - Math.PI / 2, i % 2 ? 0.95 : 1.08);
  }
  // The door itself, stood open against the wall inside.
  plankDoor(soup, rIn(3) + 0.2, -DOOR_HALF + 0.2, 3.1, 6.4, Math.PI - 0.32, 0x8a4a2a, IRON, 1);

  // Small windows up the tower, tangent to it and sunk into it. Their pane has a frame proud of it, so
  // it reads as a recess. A ground floor window is carried through to the room.
  const smallWindow = (a, y, w, h, through = false) => {
    const r = rAt(y);
    const m = new THREE.Matrix4().makeRotationY(a).setPosition(Math.sin(a) * r, 0, Math.cos(a) * r);
    soup.at(m, () => {
      const sink = -0.25;
      const c = wood(0.95, DARK);
      soup.box(-w / 2 - 0.2, -w / 2, y - h / 2 - 0.2, y + h / 2 + 0.2, sink, 0.18, c);
      soup.box(w / 2, w / 2 + 0.2, y - h / 2 - 0.2, y + h / 2 + 0.2, sink, 0.18, c);
      soup.box(-w / 2, w / 2, y + h / 2, y + h / 2 + 0.2, sink, 0.18, c);
      soup.box(-w / 2 - 0.3, w / 2 + 0.3, y - h / 2 - 0.3, y - h / 2 - 0.02, sink, 0.34, { c: tone(0xb7b0a0, 1) });
      soup.box(-0.04, 0.04, y - h / 2, y + h / 2, 0.02, 0.1, c);
      soup.box(-w / 2, w / 2, y - 0.04, y + 0.04, 0.02, 0.1, c);
    });
    glow.at(m, () => {
      glow.box(-w / 2, w / 2, y - h / 2, y + h / 2, -0.1, 0.05, { c: 0xffffff, s: 'glass' });
    });
    if (through) {
      const ri = rIn(y);
      const mi = new THREE.Matrix4().makeRotationY(a).setPosition(Math.sin(a) * (ri - 0.02), 0, Math.cos(a) * (ri - 0.02));
      glow.at(mi, () => glow.box(-w / 2, w / 2, y - h / 2, y + h / 2, -0.06, 0.2, { c: 0xffffff, s: 'daylight' }));
      soup.at(mi, () => {
        const c = wood(0.95, DARK);
        soup.box(-w / 2 - 0.16, -w / 2, y - h / 2 - 0.16, y + h / 2 + 0.16, -0.12, 0.3, c);
        soup.box(w / 2, w / 2 + 0.16, y - h / 2 - 0.16, y + h / 2 + 0.16, -0.12, 0.3, c);
        soup.box(-w / 2, w / 2, y + h / 2, y + h / 2 + 0.16, -0.12, 0.3, c);
        soup.box(-w / 2 - 0.2, w / 2 + 0.2, y - h / 2 - 0.2, y - h / 2, -0.32, 0.3, c);
        soup.box(-0.035, 0.035, y - h / 2, y + h / 2, -0.12, -0.05, c);
        soup.box(-w / 2, w / 2, y - 0.035, y + 0.035, -0.12, -0.05, c);
      });
    }
  };
  smallWindow(-Math.PI / 2, 4.6, 1.7, 2.3, true);
  smallWindow(Math.PI * 0.82, 4.8, 1.7, 2.3, true);
  smallWindow(Math.PI / 2, 12.2, 1.5, 2.1);
  smallWindow(-Math.PI * 0.72, 11.2, 1.5, 2.1);
  smallWindow(Math.PI * 0.28, 17.2, 1.35, 1.9);
  smallWindow(-Math.PI * 0.3, 15.2, 1.35, 1.9);

  // THE ROOM. Plank floor and plank ceiling, each board clipped to the circle, so it is a real floor
  // and needs no band. Everything is under the wall, so nothing shows outside.
  const boardsIn = (y0, y1, R, step, k0) => {
    // A square-ended board's far corner reaches past the circle its near edge fits, and it must never
    // reach through the wall, so each is limited by both.
    const outer = R + WALL - 0.55;
    for (let z = -R; z < R; z += step) {
      const zm = Math.min(Math.abs(z), Math.abs(z + step));
      const zf = Math.max(Math.abs(z), Math.abs(z + step));
      const half = Math.min(Math.sqrt(Math.max(0, R * R - zm * zm)), Math.sqrt(Math.max(0, outer * outer - zf * zf)));
      if (half < 0.2) continue;
      soup.box(-half, half, y0, y1, z + 0.012, z + step - 0.012, wood(k0 + rng() * 0.22));
    }
  };
  boardsIn(-0.38, 0.05, rIn(0) + 0.25, 0.92, 0.9);
  // Under the boards, the same plan again, so a gap between boards is dark rather than a slot of grass.
  soup.spin([[0, 0.01], [rIn(0) + 0.2, 0.01]], { c: 0x18120d }, { sides: 24 });
  const CEIL = INNER_TOP;
  const ceilR = rIn(CEIL) + 0.3;
  boardsIn(CEIL - 0.12, CEIL + 0.12, ceilR, 0.92, 0.85);
  soup.spin([[0, CEIL + 0.14], [ceilR, CEIL + 0.14]], { c: 0x18120d }, { sides: 24 });
  for (const x of [-3.6, 0, 3.6]) {
    const half = Math.sqrt(Math.max(0, ceilR * ceilR - x * x));
    soup.box(x - 0.24, x + 0.24, CEIL - 0.62, CEIL - 0.12, -half, half, wood(0.92, DARK));
  }

  // THE STONES, on a hurst frame: four stout posts and a deck that puts them at chest height, with the
  // sacks catching the flour underneath. All centred, so a child can walk right round them.
  const SY = 3.2;
  const SR = 2.05;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) soup.box(sx * 2.4 - 0.26, sx * 2.4 + 0.26, 0.05, SY - 0.2, sz * 2.4 - 0.26, sz * 2.4 + 0.26, wood(1.0, DARK));
    soup.box(sx * 2.4 - 0.22, sx * 2.4 + 0.22, SY - 0.6, SY - 0.2, -2.7, 2.7, wood(1.05, DARK));
    soup.box(-2.7, 2.7, SY - 0.6, SY - 0.2, sx * 2.4 - 0.22, sx * 2.4 + 0.22, wood(1.05, DARK));
  }
  const deck = 7;
  for (let i = 0; i < deck; i++) {
    const x0 = mix(-2.75, 2.75, i / deck); const x1 = mix(-2.75, 2.75, (i + 1) / deck);
    soup.box(x0 + 0.01, x1 - 0.01, SY - 0.2, SY, -2.75, 2.75, wood(1.05 + rng() * 0.2));
  }
  const millstone = 0xa89f8f;
  const MS = (x, y, z) => {
    const r = Math.hypot(x, z);
    const fleck = Math.sin(x * 7.1 + z * 3.3) * Math.cos(z * 6.1 - x * 2.2);
    return tone(millstone, 0.98 + fleck * 0.13 - (r < 0.5 ? 0.3 : 0));
  };
  soup.spin([[0, SY], [SR, SY], [SR + 0.02, SY + 0.5], [SR - 0.04, SY + 0.54], [0, SY + 0.54]], { c: MS }, { sides: 30, hard: [1, 2, 3] });
  // The runner stone stands proud of the bed by a finger, its iron bands the giveaway that it turns.
  const RUN = SY + 0.58;
  soup.spin([[0, RUN], [SR, RUN], [SR + 0.02, RUN + 0.68], [SR - 0.08, RUN + 0.74], [0.55, RUN + 0.74], [0.5, RUN + 0.62], [0, RUN + 0.62]], { c: MS }, { sides: 30, hard: [1, 2, 3, 4, 5] });
  for (const y of [RUN + 0.16, RUN + 0.52]) soup.spin([[SR + 0.005, y - 0.05], [SR + 0.05, y - 0.05], [SR + 0.05, y + 0.05], [SR + 0.005, y + 0.05]], tone(IRON, 1.1), { sides: 30, hard: [0, 1, 2, 3] });
  // The hopper, in its horse: four legs off the deck and a funnel full of wheat over the stone's eye.
  const HY0 = RUN + 1.6; const HY1 = RUN + 3.2;
  const HT = 1.45; const HB = 0.3;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      soup.beam([sx * 1.95, SY, sz * 1.95], [sx * 1.38, HY1 - 0.1, sz * 1.38], 0.2, 0.2, wood(1.05));
    }
    soup.box(sx * 1.4 - 0.1, sx * 1.4 + 0.1, HY0 + 0.75, HY0 + 0.95, -1.6, 1.6, wood(1));
    soup.box(-1.6, 1.6, HY0 + 0.75, HY0 + 0.95, sx * 1.4 - 0.1, sx * 1.4 + 0.1, wood(1));
  }
  const hopper = { c: tone(TIMBER, 1.1), s: 'grain' };
  const hc = [[-HT, HT], [HT, HT], [HT, -HT], [-HT, -HT]];
  const hb = [[-HB, HB], [HB, HB], [HB, -HB], [-HB, -HB]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mx = (hc[i][0] + hc[j][0]) / 2; const mz = (hc[i][1] + hc[j][1]) / 2;
    soup.slope([hb[i][0], HY0, hb[i][1]], [hb[j][0], HY0, hb[j][1]], [hc[j][0], HY1, hc[j][1]], [hc[i][0], HY1, hc[i][1]], { ...hopper, outward: [mx, -0.5, mz] });
    soup.slope([hb[i][0] * 0.9, HY0 + 0.1, hb[i][1] * 0.9], [hb[j][0] * 0.9, HY0 + 0.1, hb[j][1] * 0.9], [hc[j][0] * 0.94, HY1, hc[j][1] * 0.94], [hc[i][0] * 0.94, HY1, hc[i][1] * 0.94], { c: tone(TIMBER, 0.7), outward: [-mx, 0.5, -mz] });
    soup.slope([hc[i][0], HY1, hc[i][1]], [hc[j][0], HY1, hc[j][1]], [hc[j][0] * 0.94, HY1, hc[j][1] * 0.94], [hc[i][0] * 0.94, HY1, hc[i][1] * 0.94], { c: tone(TIMBER, 0.9), outward: [0, 1, 0] });
  }
  soup.box(-HT * 0.86, HT * 0.86, HY1 - 0.22, HY1 - 0.2, -HT * 0.86, HT * 0.86, { c: WHEAT, skip: 'ny' });
  // Heap the wheat so that it is visibly grain from below too: a shoe chute from the funnel to the eye.
  soup.beam([0, HY0 + 0.02, 0], [0.04, RUN + 0.8, 0.04], 0.34, 0.34, wood(0.92));
  // The spindle up to the great spur wheel at the ceiling, which is how the sails get down to the stone.
  soup.spin([[0.32, HY1], [0.32, CEIL - 0.1]], tone(DARK, 1.2), { sides: 10 });
  const GY = CEIL - 1.25;
  soup.spin([[0, GY], [1.95, GY], [1.95, GY + 0.34], [0, GY + 0.34]], tone(TIMBER, 0.98), { sides: 28, hard: [1, 2] });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    soup.at(new THREE.Matrix4().makeRotationY(a).setPosition(Math.sin(a) * 1.93, GY + 0.34, Math.cos(a) * 1.93), () => soup.box(-0.09, 0.09, 0, 0.26, -0.08, 0.08, wood(1.2)));
  }
  // The flour spout, to the sack below, tipped to run downhill.
  soup.beam([1.9, SY + 0.28, 0.2], [3.5, 1.9, 0.5], 0.34, 0.26, wood(1.08));
  const sack = [[0, 0.05], [0.58, 0.05], [0.86, 0.52], [0.86, 1.28], [0.58, 1.86], [0.2, 2.08], [0.24, 2.24], [0.3, 2.34], [0, 2.38]];
  for (const [x, z, k, s] of [[3.8, 0.6, 1.0, 1], [-4.5, 1.1, 0.96, 1], [-4.15, -0.75, 1.03, 0.92], [-3.0, -3.8, 0.93, 1.02], [-1.1, -4.8, 1, 0.96], [1.2, 4.75, 0.97, 1]]) {
    soup.spin(sack.map(([r, y]) => [r * s, y * s]), tone(0xd9cba4, k), { sides: 11, centre: [x, 0, z], hard: [5, 6] });
  }

  // THE CAP: a timber curb on the tower's top and a boarded dome on the curb. Only this turns to face
  // the wind, and the tail pole is the lever that turns it.
  const CAP_Y = TOWER_TOP + 0.3;
  soup.spin([[0, TOWER_TOP - 0.1], [R1 + 0.46, TOWER_TOP - 0.1], [R1 + 0.46, CAP_Y + 0.05], [R1 + 0.1, CAP_Y + 0.05]], wood(0.9, DARK).c, { sides: 40, hard: [1, 2] });
  const capProfile = [[R1 + 0.72, CAP_Y], [R1 + 0.72, CAP_Y + 0.52], [R1 + 0.5, CAP_Y + 2.5], [R1 - 0.2, CAP_Y + 4.6], [3.55, CAP_Y + 6.6], [1.9, CAP_Y + 8.0], [0.5, CAP_Y + 8.65], [0, CAP_Y + 8.75]];
  soup.spin(capProfile, { c: (x, y, z) => tone(0x9a7c58, mix(1.05, 0.86, sstep(y, CAP_Y, CAP_Y + 8))), s: 'shingle' }, { sides: 40, uTiles: 5, hard: [1] });
  soup.spin([[0, CAP_Y - 0.1], [R1 + 0.72, CAP_Y - 0.1], [R1 + 0.72, CAP_Y]], wood(0.8, DARK).c, { sides: 40 });
  const capRib = (a, k) => {
    const s = Math.sin(a); const c = Math.cos(a);
    for (let i = 1; i < capProfile.length - 2; i++) {
      const [r0, y0] = capProfile[i]; const [r1, y1] = capProfile[i + 1];
      soup.beam([s * (r0 + 0.02), y0, c * (r0 + 0.02)], [s * (r1 + 0.02), y1, c * (r1 + 0.02)], 0.2, 0.14, wood(k, DARK), [s, 0.3, c]);
    }
  };
  for (let i = 0; i < 8; i++) capRib((i / 8) * Math.PI * 2 + Math.PI / 8, 1.05);
  soup.spin([[R1 + 0.76, CAP_Y - 0.02], [R1 + 0.8, CAP_Y + 0.26], [R1 + 0.76, CAP_Y + 0.54]], wood(1, DARK).c, { sides: 40 });
  // A turned finial, which is the highest point of the fixed building.
  const FIN = CAP_Y + 8.7;
  soup.spin([[0, FIN - 0.1], [0.28, FIN - 0.1], [0.34, FIN + 0.1], [0.1, FIN + 0.26], [0.2, FIN + 0.46], [0.24, FIN + 0.62], [0.12, FIN + 0.82], [0.02, FIN + 1.0], [0, FIN + 1.0]], tone(0xa86a33, 1.05), { sides: 12 });

  // The hood that houses the shaft where it leaves the cap: a little gabled box on the front.
  const HZ = R1 + 0.2; const HLEN = 2.3;
  const hoodSt = { c: tone(0x75664f, 1.05), s: 'grain' };
  soup.box(-1.65, 1.65, CAP_Y + 0.06, HUB_Y + 1.2, HZ - 1.5, HZ + HLEN - 1.5, { ...hoodSt, py: tone(0x75664f, 0.9) });
  soup.roof({
    axis: 'z', l0: HZ - 2, l1: HZ + HLEN - 1.3, half: 2.0, yE: HUB_Y + 1.08, yR: HUB_Y + 2.45, t: 0.16,
    top: { c: tone(0x75664f, 0.9), s: 'shingle' }, under: tone(DARK, 0.8), end: tone(DARK, 1), fascia: tone(DARK, 1),
  });
  soup.prism([[-1.6, HUB_Y + 1.2], [1.6, HUB_Y + 1.2], [0, HUB_Y + 2.34]], (u, v, w) => [u, v, w], HZ - 1.6, HZ + HLEN - 1.42, { c: tone(0x8a7a60, 1) });
  const bearing = new THREE.CylinderGeometry(0.92, 0.92, 0.26, 16);
  bearing.rotateX(Math.PI / 2);
  soup.add(bearing, IRON, new THREE.Matrix4().setPosition(0, HUB_Y, HZ + HLEN - 1.4));

  // THE TAIL POLE, to a small cart wheel on the ground. Two struts carry it off the cap; pushing on it
  // is what brings the sails round into the wind.
  const tail0 = [0, CAP_Y + 0.5, -R1 - 0.3]; const tail1 = [0, 3.0, -15.2];
  soup.beam(tail0, tail1, 0.46, 0.5, wood(1.05));
  for (const sx of [-1, 1]) soup.beam([sx * 3.6, CAP_Y + 0.25, -R1 + 0.9], [sx * 0.12, 12.8, -10.2], 0.3, 0.32, wood(0.95));
  soup.beam([-2.7, 19.0, -8.0], [2.7, 19.0, -8.0], 0.2, 0.24, wood(0.9));
  // Cart wheel.
  const WC = [0, 1.55, -16.0];
  const rim = new THREE.TorusGeometry(1.45, 0.11, 6, 22);
  rim.rotateY(Math.PI / 2);
  soup.add(rim, wood(0.9).c, new THREE.Matrix4().setPosition(...WC));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    soup.beam(WC, [0, WC[1] + Math.cos(a) * 1.42, WC[2] + Math.sin(a) * 1.42], 0.08, 0.08, wood(1));
  }
  const nave = new THREE.CylinderGeometry(0.26, 0.26, 0.42, 10);
  nave.rotateZ(Math.PI / 2);
  soup.add(nave, IRON, new THREE.Matrix4().setPosition(...WC));
  soup.beam([0, 3.1, -15.2], [0.3, WC[1], WC[2]], 0.12, 0.12, IRON);
  soup.beam([0, 3.1, -15.2], [-0.3, WC[1], WC[2]], 0.12, 0.12, IRON);

  const group = new THREE.Group();
  group.add(soupMesh(soup, 1.15), glowMesh(glow, sheet.tex, 0.55));

  // THE SAILS, in their own mesh under a group pivoted on the shaft. Each is a real lattice of bars with
  // thickness: a tapered stock, two long rails and sixteen cross bars. The wide side trails, since a sail
  // turning anticlockwise from the front leads with its narrow side.
  const sails = new THREE.Group();
  sails.position.set(0, HUB_Y, 9.0);
  const sailSoup = new Soup(null);
  const pale = (k) => tone(0xb9a07a, k);
  const LEAD = -1.55; const TRAIL = 3.5; const START = 2.6;
  for (let n = 0; n < 4; n++) {
    // A quarter turn from upright, baked in, because a mill in an X is the picture everybody knows, and
    // because a bounding box taken through a rotated root would swell by half again.
    sailSoup.at(new THREE.Matrix4().makeRotationZ(Math.PI / 4 + (n * Math.PI) / 2), () => {
      sailSoup.prism([[-0.26, 0.2], [0.26, 0.2], [0.13, SAIL_LEN], [-0.13, SAIL_LEN]], (u, v, w) => [u, v, w], -0.2, 0.2, tone(TIMBER, 1.15));
      for (const x of [LEAD, TRAIL]) sailSoup.box(x - 0.08, x + 0.08, START, SAIL_LEN - 0.1, 0.02, 0.16, pale(0.98));
      sailSoup.box(1.2, 1.3, START, SAIL_LEN - 0.1, 0.02, 0.16, pale(0.9));
      const bars = 16;
      for (let i = 0; i < bars; i++) {
        const y = mix(START, SAIL_LEN - 0.12, i / (bars - 1));
        sailSoup.box(LEAD - 0.12, TRAIL + 0.12, y - 0.075, y + 0.075, 0.16, 0.28, pale(1 + (i % 2) * 0.08));
      }
    });
  }
  // The cast iron poll end, the shaft and its boss, turning with the sails.
  sailSoup.at(new THREE.Matrix4().makeRotationX(Math.PI / 2), () => {
    sailSoup.spin([[0, -0.3], [0.78, -0.3], [0.86, 0.02], [0.8, 0.26], [0.44, 0.38], [0, 0.42]], tone(IRON, 1.7), { sides: 14 });
    sailSoup.spin([[0.56, -3.6], [0.56, -0.3], [0, -0.3]], tone(DARK, 1.1), { sides: 12 });
  });
  const sailMesh = mesh(sailSoup.geometry(), standard({ vertexColors: true, roughness: 0.82, metalness: 0 }));
  sails.add(sailMesh);
  group.add(sails);
  group.userData.tick = {
    update(dt) {
      if (!reducedMotion()) sails.rotation.z += dt * 0.5;
    },
    dispose() {},
  };
  return group;
}

export const BUILDERS = {
  schoolhouse,
  'blacksmith-forge': blacksmithForge,
  'village-bakery': villageBakery,
  'grain-windmill': grainWindmill,
  'market-stall': marketStall,
};
