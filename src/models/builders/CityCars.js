import * as THREE from 'three';
import { seededRandom, canvasTexture, mesh, standard } from '../../PropKit.js';
import { mergeParts } from '../../props/LoftKit.js';
import { tube, lathe, lin, outward, alongMatrix } from '../ModelKit.js';
import { PALETTE, TYRE } from '../town/TownKit.js';

// The Build a City kit's four everyday vehicles: police-car, city-ambulance, city-taxi and
// delivery-truck. Real life size in feet, origin at the base centre, front toward +Z, tyres on
// y = 0 (sunk 0.02), every one narrower than a 12ft lane.
//
// HOW A BODY IS MADE. Each body is a LOFT of superellipse sections along Z (`carLoft`), sampled by
// arc length round each ring rather than evenly in angle. A near-square superellipse sampled evenly
// in angle puts almost every vertex on its four corners and leaves the flank, where the wheel arch,
// the door seams and the two-tone line all live, with a couple of rows. Weighted arc length puts the
// rows where the detail is. Two more things make the tint as sharp as the mesh needs:
//   * `cuts` add a pair of rings either side of a Z (a door edge), and `breaksY` a pair of points
//     either side of a height on both flanks (a rocker line), so a colour change falls BETWEEN two
//     coincident rows and has no width at all. A tint can only be as detailed as the mesh under it,
//     so the mesh is made to have an edge exactly where the colour does.
//   * The wheel arches are a WARP, a recess pushed into the flank round each wheel, so a tyre sits
//     in a well under a lip instead of being glued onto a flat side.
//
// EVERYTHING ON A BODY IS PLACED BY ASKING THE LOFT WHERE ITS SURFACE IS. `flank(z, y, side)` and
// `top(z, x)` invert the superellipse analytically, so a window, a decal or a door seam is a patch
// lying on the real surface a hair proud of it. Hand-picked coordinates near a curved body are either
// floating or buried.
//
// SIX MESHES AT MOST: paint (body, chrome, hub silver), trim (tyres, rubber, plastics, interior),
// glass (opaque dark, glossy), glow (every lens, one emissive mesh coloured by an atlas swatch, so a
// red and a blue lens share one material), decals (text and symbols on an alpha-tested atlas) and,
// for the taxi only, one transparent windscreen so the meter on the dashboard can be seen.

const PI = Math.PI;
const TAU = PI * 2;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function part(list, geometry, color, position = null, rotation = null, extra = {}) {
  list.push({ geometry, color, position: position ?? undefined, rotation: rotation ?? undefined, ...extra });
}

// A monotone cubic through (xs, ys): no overshoot, so a body never bulges past its stations.
function pchip(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h = []; const d = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]); }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1]; const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t; const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
      + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// Writes a colour attribute from fn(p, n) -> hex or [r, g, b] (linear).
function paintGeo(g, fn) {
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position; const N = g.attributes.normal;
  const out = new Float32Array(P.count * 3);
  const p = new THREE.Vector3(); const n = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i);
    let c = fn(p, n);
    if (typeof c === 'number') c = lin(c);
    out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

// Reorients every triangle so its face normal agrees with ref(centroid). A hand-built grid's
// winding depends on which way its two parameters run, so it is MEASURED, never assumed.
function orient(g, ref) {
  const P = g.attributes.position; const idx = g.index;
  const a = new THREE.Vector3(); const b = new THREE.Vector3(); const c = new THREE.Vector3();
  const e1 = new THREE.Vector3(); const e2 = new THREE.Vector3(); const nn = new THREE.Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(P, idx.getX(i)); b.fromBufferAttribute(P, idx.getX(i + 1)); c.fromBufferAttribute(P, idx.getX(i + 2));
    nn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const cx = (a.x + b.x + c.x) / 3; const cy = (a.y + b.y + c.y) / 3; const cz = (a.z + b.z + c.z) / 3;
    const r = typeof ref === 'function' ? ref(cx, cy, cz) : ref;
    if (nn.x * r[0] + nn.y * r[1] + nn.z * r[2] < 0) {
      const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Drops every triangle whose centroid drop(x, y, z) says to: a real opening in a loft.
function cutTris(g, drop) {
  const P = g.attributes.position; const idx = g.index;
  const keep = [];
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i); const b = idx.getX(i + 1); const c = idx.getX(i + 2);
    const cx = (P.getX(a) + P.getX(b) + P.getX(c)) / 3;
    const cy = (P.getY(a) + P.getY(b) + P.getY(c)) / 3;
    const cz = (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3;
    if (!drop(cx, cy, cz)) keep.push(a, b, c);
  }
  g.setIndex(keep);
  return g;
}

// A grid patch. point(u, v) gives a position; the patch is oriented toward ref; its uvs run over
// the atlas rectangle `uv` = [u0, v0, u1, v1].
function gridPatch(nu, nv, point, ref, uv = [0, 0, 1, 1]) {
  const pos = []; const uvs = []; const index = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu; const v = j / nv;
      const p = point(u, v);
      pos.push(p[0], p[1], p[2]);
      uvs.push(uv[0] + (uv[2] - uv[0]) * u, uv[1] + (uv[3] - uv[1]) * v);
    }
  }
  const row = nv + 1;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * row + j; const b = (i + 1) * row + j; const c = (i + 1) * row + j + 1; const d = i * row + j + 1;
      index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return orient(g, ref);
}

// A flat plate in the XY plane facing +Z, with its uvs on an atlas rectangle.
function plate(w, h, uv = [0, 0, 1, 1]) {
  const g = new THREE.PlaneGeometry(w, h);
  const U = g.attributes.uv;
  for (let i = 0; i < U.count; i++) {
    U.setXY(i, uv[0] + (uv[2] - uv[0]) * U.getX(i), uv[1] + (uv[3] - uv[1]) * U.getY(i));
  }
  return g;
}

// A box from a to b, `w` wide and `h` high across it.
function bar(list, a, b, w, h, color, up = [0, 1, 0]) {
  const { m, len } = alongMatrix(a, b, up);
  const g = boxG(w, h, len); g.translate(0, 0, len / 2); g.applyMatrix4(m);
  list.push({ geometry: g, color });
}

// A slab spanning x0..x1 whose bottom follows bottom(z) and top follows top(z), closed on every
// side. The skirt round a wheel arch: an exact curve, never a staircase of boxes.
function curvedPanel(z0, z1, x0, x1, bottom, top, nz = 40) {
  const pos = []; const index = [];
  const zs = [];
  for (let i = 0; i <= nz; i++) zs.push(z0 + (z1 - z0) * (i / nz));
  // four corner rows per z: (x0,bot) (x1,bot) (x1,top) (x0,top)
  for (const z of zs) {
    const b = Math.min(bottom(z), top(z) - 0.002); const t = top(z);
    pos.push(x0, b, z, x1, b, z, x1, t, z, x0, t, z);
  }
  for (let i = 0; i < nz; i++) {
    for (let k = 0; k < 4; k++) {
      const a = i * 4 + k; const b = i * 4 + ((k + 1) % 4);
      const c = (i + 1) * 4 + ((k + 1) % 4); const d = (i + 1) * 4 + k;
      index.push(a, b, c, a, c, d);
    }
  }
  // end caps
  const e0 = 0; const e1 = nz * 4;
  index.push(e0, e0 + 2, e0 + 1, e0, e0 + 3, e0 + 2);
  index.push(e1, e1 + 1, e1 + 2, e1, e1 + 2, e1 + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return outward(g);
}

// ---------------------------------------------------------------------------
// The body loft
// ---------------------------------------------------------------------------

// A point of a superellipse section at angle th: { a, b, up, dn, pu, pd }.
function seXY(s, th) {
  const c = Math.cos(th); const sn = Math.sin(th);
  const p = sn >= 0 ? s.pu : s.pd;
  return [
    Math.sign(c) * Math.pow(Math.abs(c), p) * s.a,
    s.b + Math.sign(sn) * Math.pow(Math.abs(sn), p) * (sn >= 0 ? s.up : s.dn),
  ];
}
function thetaFlank(s, y, side) {
  const dy = y - s.b;
  let th;
  if (dy >= 0) th = Math.asin(Math.pow(Math.min(1, dy / s.up), 1 / s.pu));
  else th = -Math.asin(Math.pow(Math.min(1, -dy / s.dn), 1 / s.pd));
  return side > 0 ? th : PI - th;
}
function thetaTop(s, x) {
  const k = Math.min(1, Math.abs(x) / s.a);
  return Math.acos(Math.sign(x) * Math.pow(k, 1 / s.pu));
}

// stations: [z, a, top, bottom] in increasing z. Options:
//   b      the section centre height, shared by every station
//   pu/pd  roundness above and below the centre (1 = ellipse, 0.2 = nearly square)
//   step   ring spacing in feet; dense: [[z0, z1, step]] finer spacing over a range
//   around ring vertex count; cuts: Z values that get a ring pair; breaksY: heights on both
//   flanks that get a point pair; breaksX(z): x values on the top half that get a point pair
//   warp(x, y, z, sec) -> [x, y, z]
function carLoft(stations, {
  b = 2, pu = 0.45, pd = 0.55, step = 0.25, dense = [], around = 48, cuts = [], breaksY = [],
  breaksX = null, warp = null, weight = null,
} = {}) {
  const zs = stations.map((s) => s[0]);
  const fa = pchip(zs, stations.map((s) => s[1]));
  const ft = pchip(zs, stations.map((s) => s[2]));
  const fb = pchip(zs, stations.map((s) => s[3]));
  const sec = (z) => ({ a: fa(z), b, up: Math.max(0.01, ft(z) - b), dn: Math.max(0.01, b - fb(z)), pu, pd });
  const z0 = zs[0]; const z1 = zs[zs.length - 1];

  // Ring Z list.
  let list = [z0];
  let z = z0;
  while (z < z1 - 1e-6) {
    let st = step;
    for (const [a0, a1, s2] of dense) if (z >= a0 && z < a1) st = Math.min(st, s2);
    z = Math.min(z1, z + st);
    list.push(z);
  }
  for (const c of cuts) { if (c > z0 + 0.01 && c < z1 - 0.01) list.push(c - 0.004, c + 0.004); }
  list.sort((p, q) => p - q);
  list = list.filter((v, i) => i === 0 || v - list[i - 1] > 1e-4);

  const wfn = weight ?? ((th) => {
    const s = Math.sin(th); const c = Math.cos(th);
    return s < 0 ? 0.35 + 1.4 * c * c : 0.75 + 1.1 * c * c;
  });
  const M = 300;
  const ring = (s, zz) => {
    const fine = []; const cum = [0];
    for (let k = 0; k <= M; k++) fine.push(seXY(s, (k / M) * TAU));
    for (let k = 1; k <= M; k++) {
      const len = Math.hypot(fine[k][0] - fine[k - 1][0], fine[k][1] - fine[k - 1][1]);
      cum.push(cum[k - 1] + len * wfn(((k - 0.5) / M) * TAU));
    }
    const total = cum[M];
    const ths = [];
    let k = 0;
    for (let j = 0; j < around; j++) {
      const target = (j / around) * total;
      while (k < M - 1 && cum[k + 1] < target) k++;
      const f = (target - cum[k]) / Math.max(1e-9, cum[k + 1] - cum[k]);
      ths.push(((k + f) / M) * TAU);
    }
    const forced = [];
    for (const y of breaksY) for (const side of [1, -1]) forced.push(thetaFlank(s, y, side));
    if (breaksX) for (const x of breaksX(zz)) forced.push(thetaTop(s, x));
    for (const th of forced) {
      const t = ((th % TAU) + TAU) % TAU;
      ths.push(t - 0.0006, t + 0.0006);
    }
    ths.sort((p, q) => p - q);
    return ths;
  };

  const pos = []; const index = [];
  let N = 0;
  for (const zz of list) {
    const s = sec(zz);
    const ths = ring(s, zz);
    N = ths.length;
    for (const th of ths) {
      const [x, y] = seXY(s, th);
      const p = warp ? warp(x, y, zz, s) : [x, y, zz];
      pos.push(p[0], p[1], p[2]);
    }
  }
  const R = list.length;
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      const a = i * N + j; const b2 = i * N + j2; const c = (i + 1) * N + j; const d = (i + 1) * N + j2;
      index.push(a, b2, c, b2, d, c);
    }
  }
  // Flat caps on their own vertices, so an end face does not shade like a pillow.
  for (const [ri, front] of [[0, false], [R - 1, true]]) {
    const base = pos.length / 3;
    for (let j = 0; j < N; j++) {
      const q = ri * N + j;
      pos.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]);
    }
    const s = sec(list[ri]);
    const ctr = pos.length / 3;
    pos.push(0, s.b, list[ri]);
    for (let j = 0; j < N; j++) {
      const j2 = (j + 1) % N;
      if (front) index.push(ctr, base + j, base + j2);
      else index.push(ctr, base + j2, base + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();

  const at = (zz, th) => { const s = sec(zz); const [x, y] = seXY(s, th); return [x, y, zz]; };
  const flankP = (zz, y, side) => at(zz, thetaFlank(sec(zz), y, side));
  const topP = (zz, x) => at(zz, thetaTop(sec(zz), x));
  const e = 0.02;
  const lifted = (p, n, lift) => {
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    return [p[0] + (n[0] / L) * lift, p[1] + (n[1] / L) * lift, p[2] + (n[2] / L) * lift];
  };
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const flankN = (zz, y, side) => {
    const dY = sub(flankP(zz, y + e, side), flankP(zz, y - e, side));
    const dZ = sub(flankP(zz + e, y, side), flankP(zz - e, y, side));
    return side > 0 ? cross(dY, dZ) : cross(dZ, dY);
  };
  const topN = (zz, x) => cross(sub(topP(zz + e, x), topP(zz - e, x)), sub(topP(zz, x + e), topP(zz, x - e)));
  return {
    geometry: g,
    sec,
    z0,
    z1,
    top: (zz) => { const s = sec(zz); return s.b + s.up; },
    flank: (zz, y, side, lift = 0) => lifted(flankP(zz, y, side), flankN(zz, y, side), lift),
    flankNormal: (zz, y, side) => { const n = flankN(zz, y, side); const L = Math.hypot(...n); return [n[0] / L, n[1] / L, n[2] / L]; },
    roof: (zz, x, lift = 0) => lifted(topP(zz, x), topN(zz, x), lift),
    roofNormal: (zz, x) => { const n = topN(zz, x); const L = Math.hypot(...n); return [n[0] / L, n[1] / L, n[2] / L]; },
  };
}

// Solves fn(z) = target by bisection over [za, zb].
function solveZ(fn, target, za, zb) {
  let lo = za; let hi = zb;
  const rising = fn(zb) > fn(za);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if ((fn(mid) < target) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// A patch lying on a loft's flank: z from z0 to z1, y from yLo(z) to yHi(z).
function flankPatch(L, side, z0, z1, yLo, yHi, { nu = 10, nv = 3, lift = 0.025, uv = [0, 0, 1, 1] } = {}) {
  const lo = typeof yLo === 'function' ? yLo : () => yLo;
  const hi = typeof yHi === 'function' ? yHi : () => yHi;
  // Reading direction: on the +X flank a viewer's right is -Z, on the -X flank it is +Z.
  return gridPatch(nu, nv, (u, v) => {
    const z = side > 0 ? z1 + (z0 - z1) * u : z0 + (z1 - z0) * u;
    const y0 = lo(z); const y1 = Math.max(y0 + 1e-4, hi(z));
    return L.flank(z, y0 + (y1 - y0) * v, side, lift);
  }, [side, 0, 0], uv);
}

// A patch lying on a loft's top: z from z0 to z1 (any order), x within +/-xHalf(z).
function roofPatch(L, z0, z1, xHalf, { nu = 8, nv = 8, lift = 0.025, uv = [0, 0, 1, 1], ref = [0, 1, 0] } = {}) {
  const xh = typeof xHalf === 'function' ? xHalf : () => xHalf;
  return gridPatch(nu, nv, (u, v) => {
    const z = z0 + (z1 - z0) * v;
    const x = (-1 + 2 * u) * xh(z);
    return L.roof(z, x, lift);
  }, ref, uv);
}

// ---------------------------------------------------------------------------
// The atlas: a row of glow swatches across the top, decals beneath
// ---------------------------------------------------------------------------
const SW = {
  head: 0, red: 1, blue: 2, amber: 3, tail: 4, white: 5, meter: 6, green: 7, signYellow: 8, reverse: 9,
};
const SW_COLORS = ['#fff6de', '#ff2418', '#2468ff', '#ffa418', '#c41414', '#ffffff', '#ff4a24', '#3cff6c', '#ffe27a', '#f4f4f4'];
const AT = 512;

function fitFont(ctx, text, maxW, maxPx, tpl) {
  let px = maxPx;
  for (; px > 6; px -= 1) {
    ctx.font = tpl.replace('{px}', px);
    if (ctx.measureText(text).width <= maxW) break;
  }
  ctx.font = tpl.replace('{px}', px);
  return px;
}

// Draws text fitted to a box, centred. mirror reverses it left to right.
function boxText(ctx, text, x, y, w, h, { color = '#000', weight = 800, family = '"Arial Black", "Helvetica Neue", Arial, sans-serif', mirror = false, maxPx = null } = {}) {
  ctx.save();
  fitFont(ctx, text, w * 0.94, maxPx ?? Math.floor(h * 0.82), `${weight} {px}px ${family}`);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (mirror) { ctx.translate(x + w / 2, 0); ctx.scale(-1, 1); ctx.translate(-(x + w / 2), 0); }
  ctx.fillText(text, x + w / 2, y + h / 2 + h * 0.04);
  ctx.restore();
}

function makeAtlas(draw) {
  const rects = {};
  const texture = canvasTexture(AT, AT, (ctx, w) => {
    ctx.clearRect(0, 0, w, w);
    SW_COLORS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * 32, 0, 32, 32); });
    draw(ctx, (name, x, y, rw, rh) => { rects[name] = [x / AT, 1 - (y + rh) / AT, (x + rw) / AT, 1 - y / AT]; return [x, y, rw, rh]; });
  });
  texture.anisotropy = 8;
  return { texture, rect: (n) => rects[n], sw: (i) => [(i * 32 + 16) / AT, 1 - 16 / AT] };
}

// Every vertex of a glow part takes one swatch's uv.
function glowPart(list, geometry, atlas, swatch, position = null, rotation = null) {
  const g = geometry.index ? geometry.clone() : geometry.clone();
  const [u, v] = atlas.sw(swatch);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { arr[i * 2] = u; arr[i * 2 + 1] = v; }
  g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  part(list, g, 0xffffff, position, rotation);
}

// The Star of Life: three bars crossing at 60 degrees, blue with a white edge, and the rod of
// Asclepius in white. Drawn as paths: a symbol character would come out as a colour emoji.
function starOfLife(ctx, cx, cy, size) {
  const arm = size * 0.5; const half = size * 0.135;
  const barPath = () => {
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k * PI) / 3 + PI / 2;
      const ux = Math.cos(a); const uy = Math.sin(a); const vx = -uy; const vy = ux;
      ctx.moveTo(cx + ux * arm + vx * half, cy + uy * arm + vy * half);
      ctx.lineTo(cx + ux * arm - vx * half, cy + uy * arm - vy * half);
      ctx.lineTo(cx - ux * arm - vx * half, cy - uy * arm - vy * half);
      ctx.lineTo(cx - ux * arm + vx * half, cy - uy * arm + vy * half);
      ctx.closePath();
    }
  };
  ctx.save();
  ctx.lineJoin = 'miter';
  barPath(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 0.07; ctx.stroke();
  barPath(); ctx.fillStyle = '#1f5fc8'; ctx.fill();
  // the rod
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - size * 0.022, cy - arm * 0.78, size * 0.044, arm * 1.56);
  ctx.beginPath(); ctx.arc(cx, cy - arm * 0.8, size * 0.035, 0, TAU); ctx.fill();
  // the serpent round it
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size * 0.03; ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const yy = cy + arm * 0.62 - t * arm * 1.22;
    const xx = cx + Math.sin(t * PI * 3.2) * size * 0.075 * (1 - t * 0.35);
    if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
  }
  ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx + size * 0.05, cy - arm * 0.62, size * 0.04, size * 0.028, -0.4, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Materials and the final group
// ---------------------------------------------------------------------------
function assemble(lists, atlas, { glassShadow = true, extra = [], trimDouble = false } = {}) {
  const group = new THREE.Group();
  const add = (parts, mat, { shadow = true } = {}) => {
    if (!parts.length) return null;
    const m = mesh(mergeParts(parts), mat);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  add(lists.paint, standard({ vertexColors: true, roughness: 0.36, metalness: 0.28 }));
  add(lists.trim, standard({ vertexColors: true, roughness: 0.78, metalness: 0.05, side: trimDouble ? THREE.DoubleSide : THREE.FrontSide }));
  add(lists.glass, standard({ vertexColors: true, roughness: 0.14, metalness: 0.35 }), { shadow: glassShadow });
  add(lists.glow, standard({
    color: 0xffffff, map: atlas.texture, emissive: 0xffffff, emissiveMap: atlas.texture, emissiveIntensity: 0.95, roughness: 0.3, metalness: 0,
  }), { shadow: false });
  add(lists.decal, standard({
    map: atlas.texture, alphaTest: 0.5, roughness: 0.42, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }), { shadow: false });
  for (const m of extra) group.add(m);
  return group;
}

// ---------------------------------------------------------------------------
// Wheels
// ---------------------------------------------------------------------------
// A road wheel: tyre in trim, alloy rim, spokes and hub in paint. Built about +Y and turned so its
// face points outboard. `face` false is the hidden inner tyre of a dual pair.
function wheel(paint, trim, { x, z, size, side, face = true, spokes = 5, rimColor = PALETTE.hubSilver, dish = 0 }) {
  const { r, w } = size;
  const cy = r - 0.02;
  const turn = new THREE.Matrix4().makeRotationZ(side > 0 ? -PI / 2 : PI / 2);
  const at = new THREE.Matrix4().makeTranslation(x, cy, z);
  const place = (g) => g.applyMatrix4(turn).applyMatrix4(at);
  const tyre = lathe([
    [0, -w * 0.3], [r * 0.6, -w * 0.3], [r * 0.66, -w * 0.5], [r * 0.9, -w * 0.5], [r * 0.975, -w * 0.43],
    [r, -w * 0.26], [r, w * 0.26], [r * 0.975, w * 0.43], [r * 0.9, w * 0.5], [r * 0.69, w * 0.5],
    [r * 0.64, w * 0.38], [r * 0.62, w * 0.12 - dish], [0, w * 0.12 - dish],
  ], 20);
  paintGeo(tyre, (p) => {
    const rad = Math.hypot(p.x, p.z);
    return rad < r * 0.6 ? 0x2c2e31 : (Math.abs(p.y) > w * 0.46 && rad < r * 0.85 ? 0x262729 : PALETTE.tyre);
  });
  trim.push({ geometry: place(tyre), color: 0xffffff, keepColor: true });
  if (!face) return;
  const rim = lathe([
    [0, w * 0.1 - dish], [r * 0.625, w * 0.1 - dish], [r * 0.67, w * 0.4], [r * 0.645, w * 0.47],
    [r * 0.56, w * 0.36 - dish * 0.5], [r * 0.54, w * 0.3 - dish], [0, w * 0.3 - dish],
  ], 20);
  paintGeo(rim, (p) => (Math.hypot(p.x, p.z) < r * 0.55 && p.y < w * 0.32 ? 0x3c3f44 : rimColor));
  paint.push({ geometry: place(rim), color: 0xffffff, keepColor: true });
  const spokeLen = r * 0.4;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * TAU + 0.3;
    const g = boxG(r * 0.15, w * 0.1, spokeLen);
    g.translate(0, w * 0.33 - dish * 0.5, r * 0.15 + spokeLen / 2);
    g.rotateY(a);
    paint.push({ geometry: place(g), color: rimColor });
  }
  const hub = new THREE.CylinderGeometry(r * 0.17, r * 0.19, w * 0.12, 14);
  hub.translate(0, w * 0.37 - dish * 0.5, 0);
  paint.push({ geometry: place(hub), color: 0xd4d8dc });
}

// The wheel well: a dark disc lying on the flank, cut by an exact circle however coarse the body
// mesh is, with a thin lip of shadow round its edge. The tyre stands a little proud of it.
function archWells(L, wheelZ, cy, R, trim, lipColor, { bottom = 0.98, lift = 0.02 } = {}) {
  const arc = (wz, rr) => (z) => cy + Math.sqrt(Math.max(0, rr * rr - (z - wz) * (z - wz)));
  for (const wz of wheelZ) {
    for (const side of [1, -1]) {
      trim.push({ geometry: flankPatch(L, side, wz - R, wz + R, bottom, arc(wz, R), { nu: 24, nv: 4, lift }), color: 0x111213 });
      // the lip, a narrow band just outside the opening
      trim.push({
        geometry: gridPatch(24, 1, (u, v) => {
          const a = PI * (side > 0 ? 1 - u : u);
          const rr = R + v * 0.1;
          const z = wz + Math.cos(a) * rr; const y = Math.max(bottom, cy + Math.sin(a) * rr);
          return L.flank(z, y, side, lift * 0.75);
        }, [side, 0, 0]),
        color: lipColor,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The sedan: police car and taxi
// ---------------------------------------------------------------------------
function sedan({ L = 17, halfW = 3.2, scheme = 'police', seeThrough = false }) {
  const k = L / 17; const q = halfW / 3.2;
  const paint = []; const trim = []; const glass = []; const glow = []; const decal = []; const clear = [];
  const police = scheme === 'police';
  const BLACK = 0x1c1d20; const WHITE = 0xe9eaea;
  const BODY = police ? BLACK : PALETTE.taxiYellow;
  const tyre = TYRE.car;
  const cy = tyre.r - 0.02;
  const wheelZ = [5.3 * k, -4.3 * k];
  const archR = tyre.r + 0.3;
  const doorFront = 2.55 * k; const doorSplit = -0.5 * k; const doorRear = -2.75 * k;
  const rocker = 1.25;

  // --- atlas -----------------------------------------------------------------
  const atlas = makeAtlas((ctx, R) => {
    if (police) {
      const [x, y, w, h] = R('police', 0, 40, 512, 78);
      boxText(ctx, 'POLICE', x, y, w, h, { color: '#16243a' });
      const r2 = R('911', 0, 124, 512, 46);
      boxText(ctx, 'EMERGENCY  CALL  911', r2[0], r2[1], r2[2], r2[3], { color: '#16243a', weight: 700, family: 'Arial, Helvetica, sans-serif' });
      const r3 = R('unit', 0, 176, 256, 120);
      boxText(ctx, '23', r3[0], r3[1], r3[2], r3[3], { color: '#16243a' });
    } else {
      // The roof sign's lit faces.
      const [x, y, w, h] = R('sign', 0, 40, 512, 120);
      ctx.fillStyle = '#fff2b0'; ctx.fillRect(x, y, w, h);
      boxText(ctx, 'TAXI', x, y, w, h, { color: '#1a1a1a' });
      // The checker band: two rows of squares.
      const [cx0, cy0, cw, ch] = R('checker', 0, 170, 512, 32);
      const sq = 16;
      for (let i = 0; i < cw / sq; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#f4f4f0' : '#141414';
          ctx.fillRect(cx0 + i * sq, cy0 + j * sq, sq, sq);
        }
      }
      const [tx, ty, tw, th] = R('door', 0, 212, 512, 70);
      boxText(ctx, 'TAXI', tx, ty, tw, th, { color: '#141414' });
      const [mx, my, mw, mh] = R('meter', 0, 292, 256, 64);
      ctx.fillStyle = '#2a0805'; ctx.fillRect(mx, my, mw, mh);
      boxText(ctx, '13.00', mx, my, mw, mh, { color: '#ff5a2a', weight: 700, family: '"Courier New", monospace' });
      const [nx, ny, nw, nh] = R('number', 256, 292, 256, 64);
      boxText(ctx, '4T27', nx, ny, nw, nh, { color: '#141414' });
    }
    const [px, py, pw, ph] = R('plate', 0, 380, 200, 100);
    ctx.fillStyle = '#f2f2ec'; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2a3a6a'; ctx.lineWidth = 6; ctx.strokeRect(px + 4, py + 4, pw - 8, ph - 8);
    boxText(ctx, police ? 'CITY 23' : 'T 4127', px + 8, py + 26, pw - 16, ph - 40, { color: '#2a3a6a', weight: 700, family: 'Arial, sans-serif' });
  });

  // --- lower hull ------------------------------------------------------------
  const st = (z, a, top, bot) => [z * k, a * q, top, bot];
  const hullSt = [
    st(-8.5, 2.78, 3.32, 1.28), st(-8.34, 3.02, 3.52, 1.04), st(-7.6, 3.15, 3.6, 0.86), st(-4.5, 3.2, 3.58, 0.78),
    st(0.0, 3.22, 3.5, 0.76), st(4.0, 3.2, 3.42, 0.78), st(6.9, 3.12, 3.32, 0.84), st(8.1, 3.0, 3.16, 0.95),
    st(8.36, 2.82, 2.98, 1.08), st(8.5, 2.55, 2.74, 1.22),
  ];
  const hull = carLoft(hullSt, {
    b: 2.05, pu: 0.34, pd: 0.4, step: 0.36, around: 48,
    cuts: police ? [doorFront, doorRear] : [],
    breaksY: police ? [rocker] : [],
  });
  paintGeo(hull.geometry, (p) => {
    if (p.y < 1.02) return 0x1a1b1d; // underbody
    if (police) {
      if (p.y > rocker && p.z > doorRear && p.z < doorFront) return WHITE;
      return BLACK;
    }
    return BODY;
  });
  paint.push({ geometry: hull.geometry, color: 0xffffff, keepColor: true });
  archWells(hull, wheelZ, cy, archR, trim, police ? 0x0b0b0c : 0x9a7a12);

  // --- greenhouse --------------------------------------------------------------
  const cabSt = [
    st(-5.8, 2.45, 3.18, 2.8), st(-5.25, 2.66, 3.74, 2.76), st(-3.4, 2.75, 4.72, 2.76), st(-1.6, 2.78, 4.88, 2.76),
    st(0.6, 2.76, 4.84, 2.76), st(2.5, 2.66, 3.96, 2.76), st(3.4, 2.4, 3.16, 2.8),
  ];
  const cabTop = (z) => cab.top(z);
  // Windscreen limits, found on the cabin itself.
  let cab = carLoft(cabSt, { b: 3.15, pu: 0.8, pd: 0.6, step: 0.2, around: 44 });
  const zCowl = solveZ(cabTop, 3.62, 0.6 * k, 3.4 * k);
  const zScreenTop = solveZ(cabTop, 4.68, 0.6 * k, 3.4 * k);
  const screenX = (z) => cab.sec(z).a * 0.8;
  if (seeThrough) {
    // Rebuilt with rows and columns exactly on the windscreen's edge, so the opening is clean.
    cab = carLoft(cabSt, {
      b: 3.15, pu: 0.8, pd: 0.6, step: 0.22, around: 36, cuts: [zCowl, zScreenTop],
      breaksX: (z) => { const xw = screenX(Math.min(zCowl, Math.max(zScreenTop, z))); return [xw, -xw]; },
    });
  }
  const inScreen = (x, y, z) => z > zScreenTop && z < zCowl && Math.abs(x) < screenX(z) && y > 3.4;
  paintGeo(cab.geometry, () => (police ? WHITE : BODY));
  if (seeThrough) {
    cutTris(cab.geometry, inScreen);
    // The interior lining: the same shell a little smaller, turned inside out, so the inside of the
    // roof and the pillars can be seen through the opening.
    const lining = cab.geometry.clone();
    const P = lining.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      P.setXYZ(i, P.getX(i) * 0.95, 3.15 + (y - 3.15) * 0.955, P.getZ(i));
    }
    lining.deleteAttribute('color');
    lining.computeVertexNormals();
    const lin2 = lining;
    trim.push({ geometry: lin2, color: 0x3a3936 });
  }
  paint.push({ geometry: cab.geometry, color: 0xffffff, keepColor: true });

  // --- glass ---------------------------------------------------------------------
  const GL = PALETTE.glass;
  const screen = roofPatch(cab, zCowl - 0.03, zScreenTop, screenX, { nu: 10, nv: 6, lift: seeThrough ? 0.02 : 0.025, ref: [0, 0.5, 1] });
  if (seeThrough) clear.push({ geometry: screen, color: 0xffffff });
  else glass.push({ geometry: screen, color: GL });
  // the black frit round the windscreen, which also hides where the glass meets the paint
  const fritW = 0.11;
  for (const sgn of [1, -1]) {
    trim.push({
      geometry: gridPatch(2, 8, (u, v) => {
        const z = zCowl + (zScreenTop - zCowl) * v;
        const x = sgn * (screenX(z) - 0.02 + u * fritW);
        return cab.roof(z, x, 0.02);
      }, [0, 0.5, 1]),
      color: 0x141516,
    });
  }
  const zRearLow = solveZ(cabTop, 3.78, -5.8 * k, -3.4 * k);
  const zRearTop = solveZ(cabTop, 4.62, -5.8 * k, -3.4 * k);
  glass.push({ geometry: roofPatch(cab, zRearLow, zRearTop, (z) => cab.sec(z).a * 0.76, { nu: 10, nv: 6, ref: [0, 0.5, -1] }), color: GL });
  // side windows
  const yLo = 3.62;
  const sideHi = (z, off) => Math.min(4.5, cabTop(z) - off);
  for (const side of [1, -1]) {
    const zFrontEnd = solveZ((z) => sideHi(z, 0.32), yLo + 0.03, 0.6 * k, 3.4 * k);
    const zRearEnd = solveZ((z) => sideHi(z, 0.5), yLo + 0.03, -5.8 * k, -3.4 * k);
    glass.push({ geometry: flankPatch(cab, side, -0.32 * k, zFrontEnd, yLo, (z) => sideHi(z, 0.32), { nu: 12, nv: 3 }), color: GL });
    glass.push({ geometry: flankPatch(cab, side, zRearEnd, -0.72 * k, yLo, (z) => sideHi(z, 0.5), { nu: 12, nv: 3 }), color: GL });
    // B pillar trim, black
    trim.push({ geometry: flankPatch(cab, side, -0.72 * k, -0.32 * k, yLo - 0.05, 4.52, { nu: 2, nv: 3, lift: 0.02 }), color: 0x18191b });
  }

  // --- door seams, handles, decals -----------------------------------------------
  for (const side of [1, -1]) {
    for (const zs of [doorFront, doorSplit, doorRear]) {
      trim.push({ geometry: flankPatch(hull, side, zs - 0.018, zs + 0.018, 1.08, 3.3, { nu: 1, nv: 10, lift: 0.012 }), color: 0x0e0e10 });
    }
    trim.push({ geometry: flankPatch(hull, side, doorRear, doorFront, 1.06, 1.1, { nu: 16, nv: 1, lift: 0.012 }), color: 0x0e0e10 });
    for (const hz of [doorSplit + 1.85 * k, doorRear + 1.6 * k]) {
      const p = hull.flank(hz, 3.02, side, 0.02);
      const n = hull.flankNormal(hz, 3.02, side);
      part(trim, boxG(0.55, 0.12, 0.08), 0x1a1b1e, p, [0, Math.atan2(n[0], n[2]), 0]);
    }
    if (police) {
      decal.push({ geometry: flankPatch(hull, side, doorRear + 0.3, doorFront - 0.25, 2.02, 2.82, { nu: 16, nv: 2, lift: 0.03, uv: atlas.rect('police') }) });
      decal.push({ geometry: flankPatch(hull, side, doorRear + 1.2, doorFront - 1.15, 1.62, 1.9, { nu: 10, nv: 1, lift: 0.03, uv: atlas.rect('911') }) });
    } else {
      // the checker band along the full side, above the arches
      decal.push({ geometry: flankPatch(hull, side, -7.3 * k, 7.0 * k, 2.68, 3.0, { nu: 40, nv: 2, lift: 0.03, uv: atlas.rect('checker') }) });
      decal.push({ geometry: flankPatch(hull, side, doorSplit + 0.25, doorFront - 0.35, 1.75, 2.45, { nu: 10, nv: 2, lift: 0.03, uv: atlas.rect('door') }) });
      decal.push({ geometry: flankPatch(hull, side, doorRear + 0.35, doorSplit - 0.3, 1.85, 2.4, { nu: 10, nv: 2, lift: 0.03, uv: atlas.rect('number') }) });
    }
    // mirror on a stalk, at the foot of the A pillar
    const mz = 2.2 * k;
    const base = cab.flank(mz, 3.55, side, 0);
    const mx = side * (halfW + 0.32);
    bar(trim, [base[0], 3.58, mz], [mx, 3.68, mz - 0.15], 0.12, 0.1, 0x18191b);
    part(paint, boxG(0.28, 0.34, 0.52), police ? BLACK : BODY, [mx, 3.72, mz - 0.18]);
    part(glass, boxG(0.22, 0.28, 0.04), 0x5a6a78, [mx, 3.72, mz - 0.46]);
  }

  // --- wipers ---------------------------------------------------------------------
  for (const xs of [-0.35, 1.05]) {
    const a = cab.roof(zCowl - 0.12, xs * q - 0.95, 0.06);
    const b = cab.roof(zCowl - 0.28, xs * q + 0.95, 0.06);
    bar(trim, a, b, 0.06, 0.05, 0x101112);
  }

  // --- front --------------------------------------------------------------------------
  const zf = 8.5 * k;
  const zr = -8.5 * k;
  part(trim, boxG(2.0 * q, 0.42, 0.4), 0x141516, [0, 2.38, zf - 0.12]); // grille
  for (let i = 0; i < 3; i++) part(paint, boxG(1.9 * q, 0.04, 0.42), police ? 0x2a2c30 : 0x9aa0a6, [0, 2.24 + i * 0.13, zf - 0.11]);
  part(trim, boxG(3.6 * q, 0.32, 0.4), 0x141516, [0, 1.52, zf - 0.08]); // lower intake
  for (const sx of [-1, 1]) {
    part(trim, boxG(1.12 * q, 0.42, 0.55), 0x16171a, [sx * 2.08 * q, 2.42, zf - 0.27]); // headlight housing
    glowPart(glow, boxG(0.95 * q, 0.3, 0.5), atlas, SW.head, [sx * 2.08 * q, 2.43, zf - 0.22]);
    glowPart(glow, boxG(0.3, 0.12, 0.5), atlas, SW.amber, [sx * 2.55 * q, 2.24, zf - 0.32]);
    // tail lights wrap the rear corners
    part(trim, boxG(1.05 * q, 0.5, 0.45), 0x16171a, [sx * 2.3 * q, 3.0, zr + 0.24]);
    glowPart(glow, boxG(0.92 * q, 0.38, 0.45), atlas, SW.tail, [sx * 2.3 * q, 3.0, zr + 0.2]);
    glowPart(glow, boxG(0.26, 0.14, 0.45), atlas, SW.reverse, [sx * 1.6 * q, 3.0, zr + 0.19]);
  }
  // bumper covers, matte, a little proud of the ends
  part(trim, boxG(5.3 * q, 0.48, 0.3), 0x202124, [0, 1.62, zr + 0.11]);
  part(trim, boxG(5.0 * q, 0.42, 0.3), police ? 0x202124 : 0x26272a, [0, 1.42, zf - 0.1]);
  // number plates
  decal.push({ geometry: plate(1.0, 0.5, atlas.rect('plate')), position: [0, 2.0, zr - 0.03], rotation: [0, PI, 0] });
  part(trim, boxG(1.1, 0.58, 0.06), 0x16171a, [0, 2.0, zr]);
  if (!police) {
    decal.push({ geometry: plate(1.0, 0.5, atlas.rect('plate')), position: [0, 1.95, zf + 0.04] });
    part(trim, boxG(1.1, 0.58, 0.06), 0x16171a, [0, 1.95, zf + 0.01]);
  }
  // exhaust
  part(paint, new THREE.CylinderGeometry(0.11, 0.11, 0.6, 12), 0x8a8e94, [-1.6 * q, 1.0, zr + 0.26], [PI / 2, 0, 0]);

  // --- scheme extras -------------------------------------------------------------------
  const roofY = cabTop(-0.6 * k);
  if (police) {
    // Light bar: a black housing on two feet, red lenses on the driver's side (+X), blue on the
    // passenger's, a white takedown lamp in the middle.
    const lz = -0.7 * k; const ly = roofY + 0.12;
    const barW = 4.4 * q;
    part(trim, boxG(barW, 0.1, 0.9), 0x1a1b1e, [0, ly, lz]);
    for (const sx of [-1, 1]) part(trim, boxG(0.3, 0.16, 0.7), 0x1a1b1e, [sx * 1.7 * q, roofY + 0.02, lz]);
    // eight lens segments and a white middle, divided by thin black ribs, filling the bar
    const segW = (barW / 2 - 0.25) / 4;
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = sx * (0.25 + segW * (i + 0.5));
        glowPart(glow, boxG(segW - 0.05, 0.26, 0.84), atlas, sx > 0 ? SW.red : SW.blue, [x, ly + 0.18, lz]);
      }
      part(trim, boxG(0.05, 0.28, 0.86), 0x1a1b1e, [sx * barW / 2, ly + 0.18, lz]);
    }
    glowPart(glow, boxG(0.46, 0.24, 0.82), atlas, SW.white, [0, ly + 0.17, lz]);
    part(trim, boxG(barW, 0.05, 0.86), 0x1a1b1e, [0, ly + 0.33, lz]);
    // roof number for the helicopter
    decal.push({ geometry: plate(1.2, 0.6, atlas.rect('unit')), position: [0, cab.roof(-3.0 * k, 0)[1] + 0.03, -3.0 * k], rotation: [-PI / 2 + 0.15, 0, 0] });
    // Push bar.
    const pz = zf + 0.32;
    for (const sx of [-1, 1]) {
      trim.push({ geometry: tube([[sx * 0.95, 1.05, pz], [sx * 0.95, 2.98, pz]], 0.1, { sides: 10, round: 2 }), color: 0x141517 });
      trim.push({ geometry: tube([[sx * 0.95, 1.6, pz], [sx * 0.95, 1.6, zf - 0.3]], 0.07, { sides: 8, round: 1 }), color: 0x141517 });
      part(trim, boxG(0.32, 1.2, 0.12), 0x262628, [sx * 0.95, 2.1, pz + 0.12]); // rubber pad
    }
    for (const y of [1.45, 2.55]) trim.push({ geometry: tube([[-0.95, y, pz], [0.95, y, pz]], 0.075, { sides: 8, round: 1 }), color: 0x141517 });
    // the spotlight by the driver's A pillar
    const sz = zCowl - 0.25;
    const sb = cab.flank(sz, 3.6, 1, 0);
    bar(trim, [sb[0] - 0.05, 3.55, sz], [sb[0] + 0.26, 4.05, sz], 0.08, 0.08, 0x1a1b1e);
    trim.push({ geometry: lathe([[0, -0.24], [0.2, -0.24], [0.22, 0.12], [0.18, 0.2], [0, 0.2]], 16), color: 0x1a1b1e, position: [sb[0] + 0.3, 4.12, sz + 0.05], rotation: [PI / 2, 0, 0] });
    glowPart(glow, new THREE.CylinderGeometry(0.15, 0.15, 0.06, 16), atlas, SW.head, [sb[0] + 0.3, 4.12, sz + 0.27], [PI / 2, 0, 0]);
    // antennas
    for (const az of [-2.0 * k, -7.2 * k]) {
      const ay = az < -6 ? 3.5 : cab.roof(az, 0)[1];
      part(trim, new THREE.CylinderGeometry(0.02, 0.03, 1.1, 6), 0x111111, [0, ay + 0.55, az]);
      part(trim, new THREE.CylinderGeometry(0.07, 0.09, 0.08, 10), 0x111111, [0, ay + 0.02, az]);
    }
    // side marker lights in the push bar
    for (const sx of [-1, 1]) glowPart(glow, boxG(0.12, 0.2, 0.08), atlas, sx > 0 ? SW.red : SW.blue, [sx * 0.95, 2.1, pz + 0.19]);
  } else {
    // Roof sign: a lit box across the roof with TAXI on its front and back.
    const sy = roofY + 0.06;
    part(trim, boxG(0.9, 0.12, 0.35), 0x1a1b1e, [0, sy, -0.6 * k]);
    const sw = 2.9 * q; const sh = 0.66; const sd = 0.5;
    part(paint, boxG(sw + 0.1, 0.1, sd + 0.08), 0xd7d2bf, [0, sy + 0.1, -0.6 * k]);
    part(paint, boxG(sw + 0.1, 0.08, sd + 0.08), 0xd7d2bf, [0, sy + sh + 0.12, -0.6 * k]);
    glowPart(glow, boxG(sw, sh, sd), atlas, SW.signYellow, [0, sy + 0.15 + sh / 2, -0.6 * k]);
    for (const dir of [1, -1]) {
      const g = plate(sw - 0.12, sh - 0.1, atlas.rect('sign'));
      if (dir < 0) g.rotateY(PI);
      g.translate(0, sy + 0.15 + sh / 2, -0.6 * k + dir * (sd / 2 + 0.006));
      glow.push({ geometry: g, color: 0xffffff });
    }
  }

  // --- the taxi's interior ----------------------------------------------------------------
  if (seeThrough) {
    const dashZ = zCowl - 0.55;
    const dashTopY = 3.62;
    part(trim, boxG(4.9 * q, 0.5, 0.95), 0x2a2a2c, [0, dashTopY - 0.25, dashZ]);
    part(trim, boxG(4.7 * q, 0.1, 0.55), 0x232325, [0, dashTopY + 0.02, dashZ + 0.22]);
    // steering wheel on the driver's side (+X)
    const swg = new THREE.TorusGeometry(0.62, 0.06, 8, 24);
    part(trim, swg, 0x18181a, [1.35 * q, 3.75, dashZ - 0.62], [-0.45, 0, 0]);
    part(trim, new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), 0x18181a, [1.35 * q, 3.6, dashZ - 0.35], [-0.45 - PI / 2, 0, 0]);
    // the meter: a black case on the dash with a lit red readout facing the back seat, and lit
    // HIRED and FOR HIRE lamps along its top that can be read through the windscreen
    const mz = dashZ + 0.05; const my = dashTopY + 0.34;
    part(trim, boxG(1.0, 0.42, 0.5), 0x101012, [-0.25, my, mz]);
    for (const dir of [1, -1]) {
      const g = plate(0.84, 0.3, atlas.rect('meter'));
      if (dir < 0) g.rotateY(PI);
      g.rotateX(dir > 0 ? -0.25 : 0.25);
      g.translate(-0.25, my - 0.02, mz + dir * 0.256);
      glow.push({ geometry: g, color: 0xffffff });
    }
    glowPart(glow, boxG(0.34, 0.1, 0.2), atlas, SW.red, [-0.47, my + 0.24, mz - 0.1]);
    glowPart(glow, boxG(0.34, 0.1, 0.2), atlas, SW.green, [-0.03, my + 0.24, mz - 0.1]);
    // seats: only their backs show above the belt, so that is what is built
    const seatZ = dashZ - 2.6;
    for (const sx of [-1, 1]) {
      part(trim, boxG(1.6 * q, 1.25, 0.38), 0x3b3530, [sx * 1.25 * q, 3.85, seatZ], [-0.16, 0, 0]);
      part(trim, boxG(0.8, 0.38, 0.28), 0x3b3530, [sx * 1.25 * q, 4.55, seatZ - 0.12], [-0.16, 0, 0]);
    }
    part(trim, boxG(4.6 * q, 0.9, 0.36), 0x3b3530, [0, 3.75, -3.15 * k], [-0.3, 0, 0]); // rear bench back
      }

  // --- wheels ------------------------------------------------------------------------------
  for (const wz of wheelZ) {
    for (const side of [1, -1]) {
      const x = side * (hull.sec(wz).a + 0.05 - tyre.w / 2);
      wheel(paint, trim, { x, z: wz, size: tyre, side, spokes: police ? 6 : 5, rimColor: police ? 0x9ea3a9 : PALETTE.hubSilver });
    }
  }

  const extra = [];
  if (clear.length) {
    const m = mesh(mergeParts(clear), standard({
      color: 0x9fb8c8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false,
    }));
    m.castShadow = false;
    extra.push(m);
  }
  return assemble({ paint, trim, glass, glow, decal }, atlas, { extra, trimDouble: seeThrough });
}

function policeCar() { return sedan({ L: 17, halfW: 3.2, scheme: 'police' }); }
function cityTaxi() { return sedan({ L: 16, halfW: 3.1, scheme: 'taxi', seeThrough: true }); }

// ---------------------------------------------------------------------------
// Shared van parts: a cutaway cab (hood, doors, greenhouse) for the ambulance
// ---------------------------------------------------------------------------

// Lights, seams and handles on a box body use the box's own flank so they sit on it.
function onFlank(L, z, y, side, lift) {
  const p = L.flank(z, y, side, lift);
  const n = L.flankNormal(z, y, side);
  return { p, yaw: Math.atan2(n[0], n[2]) };
}

// A vertical or horizontal seam on a flank, as a thin dark patch.
function seamV(trim, L, side, z, y0, y1, color = 0x30333a, w = 0.025) {
  trim.push({ geometry: flankPatch(L, side, z - w, z + w, y0, y1, { nu: 1, nv: 6, lift: 0.012 }), color });
}
function seamH(trim, L, side, z0, z1, y, color = 0x30333a, w = 0.025) {
  trim.push({ geometry: flankPatch(L, side, z0, z1, y - w, y + w, { nu: 6, nv: 1, lift: 0.012 }), color });
}

// ---------------------------------------------------------------------------
// The ambulance: a Type III, a van cab with a box body behind it
// ---------------------------------------------------------------------------
function cityAmbulance() {
  const paint = []; const trim = []; const glass = []; const glow = []; const decal = [];
  const WHITE = 0xeeeeea; const RED = 0xc4161c;
  const tyre = TYRE.van;
  const cy = tyre.r - 0.02;
  const wF = 7.9; const wR = -4.6;
  const archR = tyre.r + 0.3;
  const boxFront = 4.2; const boxBack = -10.6;
  const boxHalf = 3.85; const boxBot = 3.0; const boxTop = 9.0;

  const atlas = makeAtlas((ctx, R) => {
    const [ax, ay, aw, ah] = R('amb', 0, 40, 512, 78);
    boxText(ctx, 'AMBULANCE', ax, ay, aw, ah, { color: RED === 0xc4161c ? '#c4161c' : '#c00' });
    const [mx, my, mw, mh] = R('mirror', 0, 124, 512, 78);
    boxText(ctx, 'AMBULANCE', mx, my, mw, mh, { color: '#c4161c', mirror: true });
    const [sx, sy, sw] = R('star', 0, 210, 200, 200);
    starOfLife(ctx, sx + sw / 2, sy + sw / 2, sw * 0.9);
    const [ex, ey, ew, eh] = R('ems', 210, 210, 302, 44);
    boxText(ctx, 'EMERGENCY', ex, ey, ew, eh, { color: '#1f5fc8', weight: 800 });
    const [ux, uy, uw, uh] = R('medic', 210, 262, 302, 70);
    boxText(ctx, 'MEDIC 7', ux, uy, uw, uh, { color: '#c4161c' });
    const [px, py, pw, ph] = R('plate', 210, 340, 200, 100);
    ctx.fillStyle = '#f2f2ec'; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2a3a6a'; ctx.lineWidth = 6; ctx.strokeRect(px + 4, py + 4, pw - 8, ph - 8);
    boxText(ctx, 'EMS 07', px + 8, py + 26, pw - 16, ph - 40, { color: '#2a3a6a', weight: 700, family: 'Arial, sans-serif' });
  });

  // --- cab -----------------------------------------------------------------------
  const cab = carLoft([
    [3.4, 3.26, 4.42, 1.22], [5.2, 3.32, 4.44, 1.16], [7.4, 3.3, 4.36, 1.18], [9.6, 3.2, 4.16, 1.28],
    [10.55, 3.08, 3.98, 1.38], [10.82, 2.92, 3.8, 1.5], [10.95, 2.62, 3.55, 1.68],
  ], {
    b: 2.7, pu: 0.34, pd: 0.4, step: 0.4, around: 48, breaksY: [3.45, 3.95], cuts: [10.2],
  });
  const inStripe = (y) => y > 3.45 && y < 3.95;
  paintGeo(cab.geometry, (p, n) => (p.y < 1.4 ? 0x1c1d20 : inStripe(p.y) && p.z < 10.2 && Math.abs(n.z) < 0.9 ? RED : WHITE));
  paint.push({ geometry: cab.geometry, color: 0xffffff, keepColor: true });
  archWells(cab, [wF], cy, archR, trim, 0x8a8a88, { bottom: 1.25 });

  const gh = carLoft([
    [3.4, 3.06, 6.72, 3.7], [5.6, 3.12, 6.84, 3.7], [6.55, 3.1, 6.66, 3.7], [7.9, 2.98, 4.78, 3.72], [8.6, 2.7, 4.12, 3.78],
  ], { b: 4.3, pu: 0.55, pd: 0.6, step: 0.25, around: 40 });
  paintGeo(gh.geometry, () => WHITE);
  paint.push({ geometry: gh.geometry, color: 0xffffff, keepColor: true });
  const ghTop = (z) => gh.top(z);
  const zCowl = solveZ(ghTop, 4.72, 6.6, 8.6);
  const zScreenTop = solveZ(ghTop, 6.5, 6.6, 8.6);
  glass.push({ geometry: roofPatch(gh, zCowl, zScreenTop, (z) => gh.sec(z).a * 0.84, { nu: 10, nv: 6, ref: [0, 0.4, 1] }), color: PALETTE.glass });
  for (const sgn of [1, -1]) {
    trim.push({
      geometry: gridPatch(2, 8, (u, v) => {
        const z = zCowl + (zScreenTop - zCowl) * v;
        return gh.roof(z, sgn * (gh.sec(z).a * 0.84 - 0.02 + u * 0.12), 0.02);
      }, [0, 0.4, 1]),
      color: 0x141516,
    });
  }
  for (const xs of [-0.5, 1.1]) bar(trim, gh.roof(zCowl - 0.1, xs - 1.05, 0.06), gh.roof(zCowl - 0.3, xs + 1.05, 0.06), 0.07, 0.05, 0x101112);
  for (const side of [1, -1]) {
    const zEnd = solveZ((z) => Math.min(6.15, ghTop(z) - 0.45), 4.75, 6.55, 8.6);
    glass.push({ geometry: flankPatch(gh, side, 4.6, zEnd, 4.72, (z) => Math.min(6.15, ghTop(z) - 0.45), { nu: 14, nv: 6, lift: 0.035 }), color: PALETTE.glass });
    // cab door seams and handle
    seamV(trim, cab, side, 4.45, 1.3, 4.4); seamV(trim, cab, side, 7.0 - 0.75, 1.3, 2.75, 0x30333a);
    seamH(trim, cab, side, 4.45, 6.25, 1.32);
    const h = onFlank(cab, 5.0, 4.2, side, 0.03);
    part(trim, boxG(0.6, 0.14, 0.1), 0x2a2c30, h.p, [0, h.yaw, 0]);
    // big west-coast mirror on two arms
    const m0 = gh.flank(6.5, 4.9, side, 0); const mx = side * 3.92;
    bar(trim, [m0[0], 4.9, 6.5], [mx, 5.1, 6.3], 0.06, 0.06, 0x1a1b1e);
    bar(trim, [m0[0], 6.0, 6.2], [mx, 6.25, 6.3], 0.06, 0.06, 0x1a1b1e);
    part(trim, boxG(0.18, 1.35, 0.62), 0x1a1b1e, [mx, 5.68, 6.3]);
    part(glass, boxG(0.12, 1.2, 0.04), 0x7d8c98, [mx, 5.68, 5.98]);
    glowPart(glow, boxG(0.08, 0.16, 0.34), atlas, SW.amber, [side * 3.25, 3.7, 10.2]);
    // the stripe on the cab, carried as a patch so it lines up with the box's
  }
  // grille, headlights, bumper
  const zf = 10.95;
  part(paint, boxG(3.2, 1.4, 0.3), 0xb7bcc2, [0, 2.85, zf - 0.1]);
  part(trim, boxG(2.9, 1.15, 0.32), 0x17181b, [0, 2.85, zf - 0.08]);
  for (let i = 0; i < 4; i++) part(paint, boxG(2.8, 0.06, 0.34), 0xa9aeb4, [0, 2.45 + i * 0.27, zf - 0.07]);
  for (const sx of [-1, 1]) {
    part(trim, boxG(0.95, 0.85, 0.34), 0x17181b, [sx * 2.2, 2.95, zf - 0.14]);
    glowPart(glow, boxG(0.8, 0.5, 0.32), atlas, SW.head, [sx * 2.2, 3.05, zf - 0.1]);
    glowPart(glow, boxG(0.8, 0.18, 0.32), atlas, SW.amber, [sx * 2.2, 2.66, zf - 0.11]);
    glowPart(glow, boxG(0.32, 0.18, 0.14), atlas, SW.red, [sx * 0.75, 2.85, zf + 0.01]); // grille flashers
  }
  part(paint, boxG(7.0, 0.62, 0.42), 0xb7bcc2, [0, 1.75, zf + 0.05]);
  part(trim, boxG(6.4, 0.2, 0.36), 0x17181b, [0, 1.42, zf + 0.0]);
  decal.push({ geometry: plate(1.0, 0.5, atlas.rect('plate')), position: [0, 1.78, zf + 0.27] });

  // --- the box -----------------------------------------------------------------------
  const box = carLoft([
    [boxBack, boxHalf - 0.1, boxTop - 0.1, boxBot + 0.1], [boxBack + 0.1, boxHalf, boxTop, boxBot],
    [boxFront - 0.1, boxHalf, boxTop, boxBot], [boxFront, boxHalf - 0.1, boxTop - 0.1, boxBot + 0.1],
  ], { b: 6, pu: 0.14, pd: 0.14, step: 3, around: 56, breaksY: [3.45, 3.95, 7.98, 8.14] });
  // The end caps fan from the middle to the rim, so the stripe is kept off them and laid across
  // the ends as its own band; tinted, the fan would smear the red into diagonal streaks.
  paintGeo(box.geometry, (p, n) => (Math.abs(n.z) < 0.9 && (inStripe(p.y) || (p.y > 7.98 && p.y < 8.14)) ? RED : WHITE));
  for (const [z, d] of [[boxBack - 0.005, -1], [boxFront + 0.005, 1]]) {
    part(paint, boxG(2 * boxHalf - 0.25, 0.5, 0.03), RED, [0, 3.7, z]);
    if (d < 0) part(paint, boxG(2 * boxHalf - 0.3, 0.16, 0.03), RED, [0, 8.06, z]);
  }
  paint.push({ geometry: box.geometry, color: 0xffffff, keepColor: true });

  // skirts down to the chassis, with the rear arch cut as an exact curve
  const skirtBottom = (z) => {
    const d = Math.abs(z - wR);
    return d < archR ? Math.max(2.05, cy + Math.sqrt(archR * archR - d * d)) : 2.05;
  };
  for (const side of [1, -1]) {
    const x0 = side * (boxHalf - 0.2); const x1 = side * (boxHalf - 0.01);
    paint.push({ geometry: curvedPanel(boxBack + 0.15, boxFront - 0.15, Math.min(x0, x1), Math.max(x0, x1), skirtBottom, () => 3.15, 90), color: WHITE });
    // black rubber trim round the arch
    const arc = [];
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * PI;
      arc.push([side * (boxHalf + 0.02), cy + Math.sin(a) * (archR + 0.02), wR + Math.cos(a) * (archR + 0.02)]);
    }
    arc[0][1] = 2.1; arc[16][1] = 2.1;
    trim.push({ geometry: tube(arc, 0.07, { sides: 6, round: 1 }), color: 0x161719 });
    part(trim, boxG(0.06, 0.8, 1.2), 0x18191b, [side * (boxHalf - 0.6), 1.25, wR - 1.9]); // mud flap
  }
  // under the box: chassis rails, fuel tank, exhaust
  for (const sx of [-1, 1]) part(trim, boxG(0.3, 0.6, 14.4), 0x202124, [sx * 1.55, 2.55, -3.2]);
  part(trim, boxG(1.6, 1.0, 2.6), 0x2a2b2e, [2.6, 2.3, -0.9]);
  part(paint, new THREE.CylinderGeometry(0.15, 0.15, 1.4, 12), 0x8a8e94, [-2.2, 1.9, -9.4], [PI / 2, 0, 0]);

  // --- box sides: stripes, star, lettering, doors, lights -----------------------------------
  for (const side of [1, -1]) {
    decal.push({ geometry: flankPatch(box, side, -2.0 - 1.35, -2.0 + 1.35, 6.35 - 1.35, 6.35 + 1.35, { nu: 2, nv: 2, lift: 0.03, uv: atlas.rect('star') }) });
    decal.push({ geometry: flankPatch(box, side, -9.4, -1.0, 4.18, 5.0, { nu: 8, nv: 1, lift: 0.03, uv: atlas.rect('amb') }) });
    // a cab-side stripe matches the box
    if (side < 0) {
      // the curb-side entry door with its window, at the front of the box
      const z0 = 0.4; const z1 = 3.4;
      seamV(trim, box, side, z0, 3.15, 8.2); seamV(trim, box, side, z1, 3.15, 8.2); seamH(trim, box, side, z0, z1, 8.2);
      glass.push({ geometry: flankPatch(box, side, z0 + 0.45, z1 - 0.45, 6.2, 7.6, { nu: 2, nv: 2, lift: 0.03 }), color: PALETTE.glass });
      const h = onFlank(box, z0 + 0.4, 5.4, side, 0.04);
      part(paint, boxG(0.55, 0.16, 0.12), 0xc9ccd0, h.p, [0, h.yaw, 0]);
      decal.push({ geometry: flankPatch(box, side, z0 + 0.3, z1 - 0.3, 4.4, 5.0, { nu: 2, nv: 1, lift: 0.03, uv: atlas.rect('ems') }) });
    } else {
      // street-side equipment compartments
      for (const [z0, z1] of [[0.4, 3.4], [-9.9, -7.4]]) {
        seamV(trim, box, side, z0, 3.15, 7.6); seamV(trim, box, side, z1, 3.15, 7.6); seamH(trim, box, side, z0, z1, 7.6);
        const h = onFlank(box, (z0 + z1) / 2, 5.6, side, 0.04);
        part(paint, boxG(0.55, 0.16, 0.12), 0xc9ccd0, h.p, [0, h.yaw, 0]);
      }
    }
    // box-corner lights, red, on the sides near the top front and back, and one amber midway
    for (const [z, sw] of [[3.55, SW.red], [-9.95, SW.red], [-3.4, SW.amber]]) {
      const l = onFlank(box, z, 8.55, side, 0.0);
      part(trim, boxG(0.95, 0.6, 0.12), 0x1a1b1e, l.p, [0, l.yaw, 0]);
      const l2 = onFlank(box, z, 8.55, side, 0.05);
      glowPart(glow, boxG(0.8, 0.45, 0.08), atlas, sw, l2.p, [0, l2.yaw, 0]);
    }
    // a white scene light low on each side, and the side markers
    for (const z of [-6.8]) {
      const l = onFlank(box, z, 7.55, side, 0.04);
      glowPart(glow, boxG(0.7, 0.28, 0.08), atlas, SW.white, l.p, [0, l.yaw, 0]);
    }
  }

  // --- box front: light bar header, AMBULANCE written backwards, corner lights -----------------
  const fz = boxFront + 0.01;
  part(trim, boxG(7.3, 0.62, 0.36), 0x1a1b1e, [0, 8.6, fz + 0.12]);
  const segs = 9; const segW = 6.9 / segs;
  for (let i = 0; i < segs; i++) {
    const x = -3.45 + segW * (i + 0.5);
    const sw = i === 4 ? SW.white : (i % 2 ? SW.white : SW.red);
    glowPart(glow, boxG(segW - 0.08, 0.44, 0.3), atlas, sw, [x, 8.6, fz + 0.18]);
  }
  decal.push({ geometry: plate(5.6, 0.86, atlas.rect('mirror')), position: [0, 7.62, fz + 0.012] });
  for (const sx of [-1, 1]) {
    glowPart(glow, boxG(0.55, 0.42, 0.1), atlas, SW.red, [sx * 3.2, 7.65, fz + 0.03]);
    part(trim, boxG(0.66, 0.52, 0.08), 0x1a1b1e, [sx * 3.2, 7.65, fz + 0.01]);
  }

  // --- rear: two doors with windows, stars, tail lights, step bumper ---------------------------
  const rz = boxBack - 0.012;
  const back = (g, color, x, y, w, h, d = 0.04, list = trim) => part(list, boxG(w, h, d), color, [x, y, rz - d / 2 + 0.01]);
  back(null, 0x30333a, 0, 5.9, 0.06, 5.3);
  for (const sx of [-1, 1]) {
    back(null, 0x30333a, sx * 3.0, 5.9, 0.06, 5.3);
    glass.push({ geometry: boxG(1.7, 1.25, 0.04), color: PALETTE.glass, position: [sx * 1.5, 7.25, rz - 0.01] });
    decal.push({ geometry: plate(1.35, 1.35, atlas.rect('star')), position: [sx * 1.5, 5.15, rz - 0.03], rotation: [0, PI, 0] });
    part(paint, boxG(0.18, 0.7, 0.12), 0xc9ccd0, [sx * 0.28, 5.4, rz - 0.06]); // handles
    for (const hy of [4.0, 7.9]) part(trim, boxG(0.3, 0.42, 0.1), 0x2a2c30, [sx * 3.05, hy, rz - 0.05]); // hinges
    // tail light column: red, amber, white
    const cx = sx * 3.45;
    part(trim, boxG(0.52, 1.95, 0.1), 0x1a1b1e, [cx, 4.55, rz - 0.04]);
    glowPart(glow, boxG(0.4, 0.55, 0.1), atlas, SW.tail, [cx, 5.2, rz - 0.07]);
    glowPart(glow, boxG(0.4, 0.55, 0.1), atlas, SW.amber, [cx, 4.58, rz - 0.07]);
    glowPart(glow, boxG(0.4, 0.5, 0.1), atlas, SW.reverse, [cx, 3.95, rz - 0.07]);
    // upper rear corner lights
    part(trim, boxG(0.66, 0.52, 0.1), 0x1a1b1e, [sx * 3.2, 8.6, rz - 0.04]);
    glowPart(glow, boxG(0.55, 0.42, 0.1), atlas, SW.red, [sx * 3.2, 8.6, rz - 0.07]);
  }
  glowPart(glow, boxG(1.6, 0.42, 0.1), atlas, SW.amber, [0, 8.6, rz - 0.07]);
  part(trim, boxG(1.7, 0.52, 0.08), 0x1a1b1e, [0, 8.6, rz - 0.04]);
  decal.push({ geometry: plate(2.2, 0.5, atlas.rect('medic')), position: [0, 8.05, rz - 0.03], rotation: [0, PI, 0] });
  // step bumper, a diamond-plate tread on a dark beam
  part(trim, boxG(6.6, 0.42, 0.5), 0x2a2b2e, [0, 2.4, boxBack - 0.2]);
  part(paint, boxG(6.4, 0.06, 0.46), 0xa9aeb4, [0, 2.64, boxBack - 0.2]);
  decal.push({ geometry: plate(1.0, 0.5, atlas.rect('plate')), position: [0, 2.4, boxBack - 0.46], rotation: [0, PI, 0] });

  // --- wheels: single at the front, dual at the back ---------------------------------------------
  for (const side of [1, -1]) {
    wheel(paint, trim, { x: side * (cab.sec(wF).a + 0.05 - tyre.w / 2), z: wF, size: tyre, side, spokes: 8, rimColor: 0xc9ccd0 });
    const xo = side * (3.34 - tyre.w / 2);
    wheel(paint, trim, { x: xo, z: wR, size: tyre, side, spokes: 8, rimColor: 0xc9ccd0, dish: 0.12 });
    wheel(paint, trim, { x: xo - side * (tyre.w + 0.06), z: wR, size: tyre, side, face: false });
  }

  return assemble({ paint, trim, glass, glow, decal }, atlas);
}
const H_TRUCK = 3.72;

// ---------------------------------------------------------------------------
// The delivery truck: a step van with its curb-side (-X) door slid open
// ---------------------------------------------------------------------------
// The walls are built as real panels with an inside and an outside, because the open door shows
// the inside: shelves of packages, the driver's seat and the low step. The roof is a single rounded
// panel that casts no shadow, the translucent roof a real step van has, so the sun reaches the
// shelves instead of leaving them in a black box.
function deliveryTruck() {
  const paint = []; const trim = []; const glass = []; const glow = []; const decal = [];
  const rng = seededRandom(4127);
  const WHITE = 0xebe9e3; const BROWN = 0x7a5a3c; const INNER = 0xd6d3cb; const FLOOR = 0x5a5c5f;
  const tyre = TYRE.van;
  const cy = tyre.r - 0.02;
  const H = H_TRUCK; const T = 0.12; // half width, wall thickness
  const zBack = -9.6; const zFront = 8.0;
  const yBase = 1.85; const yFloor = 2.3; const yBand = 3.1; const yWall = 9.05;
  const wF = 6.0; const wR = -5.2; const archR = tyre.r + 0.3;
  const dz0 = 1.6; const dz1 = 4.2; const yDoor = 8.5; // the door opening
  // The open door is on the CURB side, -X: facing +Z with +Y up, the driver's left is +X.
  const DS = -1;

  const atlas = makeAtlas((ctx, R) => {
    const [x, y, w, h] = R('parcels', 0, 40, 512, 120);
    // a parcel pictogram: a box in three-quarter view with tape across it, and an arrow
    const bx = x + 20; const by = y + 18; const s = 84;
    ctx.fillStyle = '#7a5a3c';
    ctx.beginPath(); ctx.moveTo(bx, by + s * 0.3); ctx.lineTo(bx + s * 0.55, by + s * 0.05); ctx.lineTo(bx + s, by + s * 0.3);
    ctx.lineTo(bx + s, by + s * 0.95); ctx.lineTo(bx + s * 0.45, by + s * 1.2); ctx.lineTo(bx, by + s * 0.95); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ebe9e3'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(bx, by + s * 0.3); ctx.lineTo(bx + s * 0.45, by + s * 0.55); ctx.lineTo(bx + s, by + s * 0.3);
    ctx.moveTo(bx + s * 0.45, by + s * 0.55); ctx.lineTo(bx + s * 0.45, by + s * 1.2); ctx.stroke();
    ctx.strokeStyle = '#d9b26a'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(bx + s * 0.25, by + s * 0.18); ctx.lineTo(bx + s * 0.75, by + s * 0.43); ctx.stroke();
    boxText(ctx, 'PARCELS', x + 120, y + 8, w - 130, 70, { color: '#5a3f26' });
    boxText(ctx, 'LOCAL  DELIVERY', x + 120, y + 78, w - 130, 34, { color: '#5a3f26', weight: 700, family: 'Arial, Helvetica, sans-serif' });
    const [cx, cy2, cw, ch] = R('stops', 0, 170, 512, 64);
    ctx.fillStyle = '#f2c230'; ctx.fillRect(cx, cy2, cw, ch);
    boxText(ctx, 'CAUTION  FREQUENT STOPS', cx + 8, cy2 + 4, cw - 16, ch - 8, { color: '#1a1a1a' });
    const [lx, ly, lw, lh] = R('label', 0, 244, 64, 40);
    ctx.fillStyle = '#f4f2ec'; ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#222'; for (let i = 0; i < 8; i++) ctx.fillRect(lx + 6 + i * 4 + (i % 3), ly + 6, 2, 16);
    ctx.fillRect(lx + 40, ly + 8, 18, 3); ctx.fillRect(lx + 40, ly + 14, 14, 3); ctx.fillRect(lx + 6, ly + 28, 50, 3);
    const [px, py, pw, ph] = R('plate', 80, 244, 200, 100);
    ctx.fillStyle = '#f2f2ec'; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2a3a6a'; ctx.lineWidth = 6; ctx.strokeRect(px + 4, py + 4, pw - 8, ph - 8);
    boxText(ctx, 'DLV 220', px + 8, py + 26, pw - 16, ph - 40, { color: '#2a3a6a', weight: 700, family: 'Arial, sans-serif' });
  });

  const arch = (wz) => (z) => {
    const d = Math.abs(z - wz);
    return d < archR ? cy + Math.sqrt(archR * archR - d * d) : -1;
  };
  const archF = arch(wF); const archB = arch(wR);
  const bottomAt = (z) => Math.max(yBase, archF(z), archB(z));
  const sideWall = (side, z0, z1, y0, y1, outer, nz = 30) => {
    const xo = side * H; const xi = side * (H - T);
    const g = curvedPanel(z0, z1, Math.min(xo, xi), Math.max(xo, xi), (z) => Math.max(y0 === yBase ? bottomAt(z) : y0, y0), () => y1, nz);
    paintGeo(g, (p, n) => (n.x * side < -0.5 ? INNER : outer));
    paint.push({ geometry: g, color: 0xffffff, keepColor: true });
  };
  const frontBox = (w, h, x, y, outer, zc = zFront - T / 2, depth = T, front = 1) => {
    const g = boxG(w, h, depth);
    g.translate(x, y, zc);
    paintGeo(g, (p, n) => (n.z * front < -0.5 ? INNER : outer));
    paint.push({ geometry: g, color: 0xffffff, keepColor: true });
  };

  // --- side walls: a brown band below, white above, arches cut as exact curves --------------
  for (const side of [1, -1]) {
    const spans = side === DS ? [[zBack, dz0], [dz1, zFront]] : [[zBack, zFront]];
    for (const [z0, z1] of spans) {
      const n = Math.max(8, Math.round((z1 - z0) * 6));
      sideWall(side, z0, z1, yBase, yBand, BROWN, n);
      sideWall(side, z0, z1, yBand, yWall, WHITE, 4);
    }
    // black rubber round each arch
    for (const wz of [wF, wR]) {
      const arc = [];
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16) * PI;
        arc.push([side * (H + 0.02), Math.max(yBase + 0.05, cy + Math.sin(a) * (archR + 0.02)), wz + Math.cos(a) * (archR + 0.02)]);
      }
      trim.push({ geometry: tube(arc, 0.07, { sides: 6, round: 1 }), color: 0x161719 });
      // the wheel house inside, under the floor line, so the tyre is not seen from within
      part(trim, boxG(1.3, 1.1, 2 * archR), 0x2e3033, [side * (H - T - 0.65), yFloor + 0.45, wz]);
    }
  }
  // over the door, the header; under it the floor edge is the step's riser
  sideWall(DS, dz0, dz1, yDoor, yWall, WHITE, 4);
  // door jambs, a slightly darker trim so the opening reads as a doorway
  for (const z of [dz0, dz1]) part(trim, boxG(0.16, yDoor - yFloor, 0.1), 0x9c9a94, [DS * (H + 0.02), (yDoor + yFloor) / 2, z + (z === dz0 ? 0.05 : -0.05)]);
  part(trim, boxG(0.16, 0.1, dz1 - dz0), 0x9c9a94, [DS * (H + 0.02), yDoor - 0.05, (dz0 + dz1) / 2]);

  // --- floor, front wall, rear wall --------------------------------------------------------------
  part(trim, boxG(2 * H - 0.02, yFloor - yBase, zFront - zBack - 0.02), FLOOR, [0, (yFloor + yBase) / 2, (zFront + zBack) / 2]);
  for (let z = zBack + 0.8; z < zFront - 0.5; z += 0.9) part(trim, boxG(2 * H - 0.4, 0.03, 0.12), 0x6c6e72, [0, yFloor + 0.015, z]); // floor ribs
  // the step: a tread under the doorway, between the floor and the street
  part(paint, boxG(1.0, 0.1, dz1 - dz0 - 0.2), 0xa9adb2, [DS * (H - 0.38), 1.3, (dz0 + dz1) / 2]);
  part(trim, boxG(0.9, 0.5, dz1 - dz0 - 0.2), 0x2a2b2e, [DS * (H - 0.45), 1.0, (dz0 + dz1) / 2]);
  for (let i = 0; i < 6; i++) part(trim, boxG(0.9, 0.02, 0.06), 0x55585c, [DS * (H - 0.38), 1.36, dz0 + 0.3 + i * 0.4]);

  const winX0 = 0.08; const winX1 = H - 0.45; const yWin0 = 4.75; const yWin1 = 8.15;
  frontBox(2 * H, yWin0 - yBase, 0, (yWin0 + yBase) / 2, WHITE);
  frontBox(2 * H, yWall - yWin1, 0, (yWall + yWin1) / 2, WHITE);
  for (const sx of [-1, 1]) {
    frontBox(H - winX1, yWin1 - yWin0, sx * (H + winX1) / 2, (yWin0 + yWin1) / 2, WHITE);
    glass.push({ geometry: boxG(winX1 - winX0, yWin1 - yWin0, 0.05), color: PALETTE.glass, position: [sx * (winX0 + winX1) / 2, (yWin0 + yWin1) / 2, zFront - 0.05] });
    // clearance lights over the windscreen, amber
    glowPart(glow, boxG(0.35, 0.2, 0.1), atlas, SW.amber, [sx * 2.9, 8.6, zFront + 0.04]);
  }
  frontBox(2 * winX0, yWin1 - yWin0, 0, (yWin0 + yWin1) / 2, WHITE);
  part(paint, boxG(2 * H, yBand - yBase, 0.03), BROWN, [0, (yBand + yBase) / 2, zFront + 0.006]);
  glowPart(glow, boxG(0.3, 0.2, 0.1), atlas, SW.amber, [0, 8.6, zFront + 0.04]);
  // rear wall: two posts and a header round the roll-up door
  const rzc = zBack + T / 2;
  for (const sx of [-1, 1]) frontBox(0.55, yWall - yBase, sx * (H - 0.275), (yWall + yBase) / 2, WHITE, rzc, T, -1);
  frontBox(2 * H - 1.1, yWall - 8.45, 0, (yWall + 8.45) / 2, WHITE, rzc, T, -1);
  // the roll-up door, closed, its slats drawn as shadow lines
  const dw = 2 * H - 1.1;
  part(paint, boxG(dw, 8.45 - yFloor, 0.06), 0xdedcd5, [0, (8.45 + yFloor) / 2, zBack + 0.02]);
  for (let y = yFloor + 0.5; y < 8.4; y += 0.5) part(trim, boxG(dw, 0.04, 0.03), 0x8c8a84, [0, y, zBack - 0.012]);
  part(paint, boxG(1.0, 0.16, 0.12), 0xa9adb2, [0, yFloor + 0.45, zBack - 0.05]);
  decal.push({ geometry: plate(4.6, 0.58, atlas.rect('stops')), position: [0, 6.0, zBack - 0.03], rotation: [0, PI, 0] });
  part(paint, boxG(2 * H, yFloor - yBase, 0.03), BROWN, [0, (yFloor + yBase) / 2, zBack - 0.004]);
  for (const sx of [-1, 1]) part(paint, boxG(0.55, yBand - yBase, 0.03), BROWN, [sx * (H - 0.275), (yBand + yBase) / 2, zBack - 0.004]);
  for (const sx of [-1, 1]) {
    part(trim, boxG(0.42, 1.55, 0.08), 0x1a1b1e, [sx * (H - 0.28), 4.1, zBack - 0.04]);
    glowPart(glow, boxG(0.32, 0.6, 0.08), atlas, SW.tail, [sx * (H - 0.28), 4.55, zBack - 0.06]);
    glowPart(glow, boxG(0.32, 0.38, 0.08), atlas, SW.amber, [sx * (H - 0.28), 4.0, zBack - 0.06]);
    glowPart(glow, boxG(0.32, 0.32, 0.08), atlas, SW.reverse, [sx * (H - 0.28), 3.58, zBack - 0.06]);
    glowPart(glow, boxG(0.3, 0.2, 0.08), atlas, SW.tail, [sx * (H - 0.28), 8.75, zBack - 0.05]);
  }
  // rear bumper, with a step
  part(trim, boxG(2 * H - 0.2, 0.5, 0.4), 0x2a2b2e, [0, 1.6, zBack - 0.2]);
  part(paint, boxG(2.4, 0.08, 0.36), 0xa9adb2, [0, 1.88, zBack - 0.2]);
  decal.push({ geometry: plate(1.0, 0.5, atlas.rect('plate')), position: [0, 1.58, zBack - 0.41], rotation: [0, PI, 0] });

  // --- roof: one rounded panel, translucent in life, casting no shadow here -------------------------
  const roof = carLoft([
    [zBack, H - 0.06, 9.72, 8.98], [zBack + 0.06, H, 9.8, 8.95], [zFront - 0.06, H, 9.8, 8.95], [zFront, H - 0.06, 9.72, 8.98],
  ], { b: 9.2, pu: 0.3, pd: 0.12, step: 4, around: 40 });
  paintGeo(roof.geometry, (p, n) => (n.y < -0.5 ? 0xf3f0e6 : WHITE));
  glass.push({ geometry: roof.geometry, color: 0xffffff, keepColor: true });
  part(paint, boxG(1.6, 0.35, 1.6), 0xd5d3cc, [0, 9.9, -2.0]); // roof vent
  part(paint, boxG(2.4, 0.12, 2.4), 0xc9c6be, [0, 9.75, -2.0]);

  // --- hood and front end -------------------------------------------------------------------------
  const hood = carLoft([
    [7.85, 3.5, 4.7, 1.4], [8.4, 3.55, 4.6, 1.34], [9.2, 3.5, 4.25, 1.36], [9.55, 3.38, 3.95, 1.44], [9.72, 3.16, 3.66, 1.6],
  ], { b: 3.0, pu: 0.32, pd: 0.4, step: 0.2, around: 40 });
  paintGeo(hood.geometry, () => BROWN);
  paint.push({ geometry: hood.geometry, color: 0xffffff, keepColor: true });
  const zf = 9.72;
  part(trim, boxG(3.2, 1.35, 0.2), 0x17181b, [0, 2.95, zf - 0.02]);
  for (let i = 0; i < 6; i++) part(paint, boxG(3.1, 0.06, 0.22), 0xb2b6bb, [0, 2.4 + i * 0.22, zf]);
  for (const sx of [-1, 1]) {
    part(paint, new THREE.CylinderGeometry(0.4, 0.42, 0.22, 20), 0xb2b6bb, [sx * 2.55, 3.05, zf - 0.04], [PI / 2, 0, 0]);
    glowPart(glow, new THREE.CylinderGeometry(0.32, 0.32, 0.24, 20), atlas, SW.head, [sx * 2.55, 3.05, zf - 0.02], [PI / 2, 0, 0]);
    glowPart(glow, boxG(0.42, 0.22, 0.14), atlas, SW.amber, [sx * 2.55, 2.4, zf - 0.03]);
  }
  part(trim, boxG(7.4, 0.55, 0.32), 0x2a2b2e, [0, 1.55, zf + 0.14]);
  part(paint, boxG(7.2, 0.08, 0.3), 0x8c9096, [0, 1.84, zf + 0.12]);
  decal.push({ geometry: plate(1.0, 0.5, atlas.rect('plate')), position: [0, 1.55, zf + 0.31] });

  // --- the open sliding door, run back along its track outside the wall -----------------------------
  const sd0 = dz0 - 2.55; const sd1 = dz0 + 0.05; const dx = DS * (H + 0.09);
  part(paint, boxG(0.08, yBand - yFloor - 0.05, sd1 - sd0), BROWN, [dx, (yBand + yFloor + 0.05) / 2, (sd0 + sd1) / 2]);
  part(paint, boxG(0.08, yDoor - yBand, sd1 - sd0), WHITE, [dx, (yDoor + yBand) / 2, (sd0 + sd1) / 2]);
  glass.push({ geometry: boxG(0.04, 1.6, 1.7), color: PALETTE.glass, position: [dx + DS * 0.04, 6.6, (sd0 + sd1) / 2 + 0.15] });
  part(paint, boxG(0.1, 0.55, 0.14), 0xa9adb2, [dx + DS * 0.05, 5.0, sd1 - 0.25]); // handle
  part(trim, boxG(0.1, 0.1, dz1 - sd0 + 0.6), 0x55585c, [DS * (H + 0.04), yDoor + 0.18, (sd0 + dz1) / 2 + 0.1]); // track
  part(trim, boxG(0.1, 0.08, dz1 - sd0 + 0.4), 0x55585c, [DS * (H + 0.04), yFloor - 0.06, (sd0 + dz1) / 2]);
  // the closed door on the other side, the same size, with its window
  {
    const g = flankPatchFlat(-DS, dz0, dz1, yFloor + 0.05, yDoor);
    trim.push({ geometry: g.seams, color: 0x8c8a84 });
    glass.push({ geometry: boxG(0.04, 1.6, 1.7), color: PALETTE.glass, position: [-DS * (H + 0.01), 6.6, (dz0 + dz1) / 2] });
    part(paint, boxG(0.08, 0.55, 0.14), 0xa9adb2, [-DS * (H + 0.03), 5.0, dz1 - 0.25]);
  }
  // cab side windows ahead of the doors
  for (const side of [1, -1]) {
    glass.push({ geometry: boxG(0.04, 2.3, 2.6), color: PALETTE.glass, position: [side * (H + 0.005), 6.55, 6.15] });
    // a mirror on an arm off each front corner
    bar(trim, [side * (H - 0.05), 6.4, zFront - 0.3], [side * (H + 0.18), 6.5, zFront + 0.3], 0.07, 0.07, 0x1a1b1e);
    part(trim, boxG(0.14, 1.2, 0.55), 0x1a1b1e, [side * (H + 0.2), 6.4, zFront + 0.3]);
    part(glass, boxG(0.1, 1.05, 0.04), 0x7d8c98, [side * (H + 0.2), 6.4, zFront + 0.01]);
    decal.push({
      geometry: plate(side === DS ? 6.6 : 8.4, side === DS ? 1.55 : 1.97, atlas.rect('parcels')),
      position: [side * (H + 0.012), 6.6, side === DS ? -5.1 : -3.6],
      rotation: [0, side * PI / 2, 0],
    });
    glowPart(glow, boxG(0.08, 0.22, 0.36), atlas, SW.amber, [side * (H + 0.02), 8.7, 7.2]);
    glowPart(glow, boxG(0.08, 0.22, 0.36), atlas, SW.tail, [side * (H + 0.02), 8.7, zBack + 0.5]);
  }
  for (const sx of [-1, 1]) bar(trim, [sx * 0.6, 4.85, zFront + 0.02], [sx * 2.4, 6.4, zFront + 0.04], 0.07, 0.05, 0x101112); // wipers

  // --- inside: dash, the driver's seat, shelves of packages ------------------------------------------
  part(trim, boxG(2 * H - 0.3, 2.3, 0.85), 0x2c2d30, [0, yFloor + 1.15, zFront - T - 0.42]);
  part(trim, boxG(2 * H - 0.3, 0.12, 1.1), 0x232427, [0, yFloor + 2.32, zFront - T - 0.5]);
  part(trim, new THREE.TorusGeometry(0.75, 0.07, 8, 24), 0x18181a, [2.0, 5.15, zFront - 1.15], [-0.75, 0, 0]);
  part(trim, new THREE.CylinderGeometry(0.07, 0.07, 1.0, 8), 0x18181a, [2.0, 4.85, zFront - 0.8], [-0.75 - PI / 2, 0, 0]);
  part(trim, boxG(1.5, 0.4, 1.4), 0x5c5650, [2.0, yFloor + 1.6, 5.2]); // seat
  part(trim, boxG(1.5, 1.6, 0.3), 0x5c5650, [2.0, yFloor + 2.55, 4.55], [0.12, 0, 0]);
  part(trim, new THREE.CylinderGeometry(0.12, 0.16, 1.4, 10), 0x2a2b2e, [2.0, yFloor + 0.7, 5.2]);
  const shelfLevels = [yFloor + 0.02, 3.95, 5.55, 7.15];
  const shelfDepth = 1.55;
  const CARD = [0xb08a54, 0xa27c48, 0xc49c64, 0x9a7446, 0xbf9a6a, 0xd3b380];
  const shelves = (side, z0, z1) => {
    const xIn = side * (H - T - shelfDepth); const xOut = side * (H - T);
    const xc = (xIn + xOut) / 2;
    const bays = Math.max(1, Math.round((z1 - z0) / 3.2));
    const bay = (z1 - z0) / bays;
    for (let b = 0; b <= bays; b++) {
      const z = z0 + b * bay;
      for (const x of [xIn, xOut - side * 0.06]) part(trim, boxG(0.1, 8.6 - yFloor, 0.1), 0x8c8f94, [x, (8.6 + yFloor) / 2, z]);
    }
    for (const y of shelfLevels.slice(1).concat([8.6])) part(trim, boxG(shelfDepth, 0.08, z1 - z0), 0x9ea2a7, [xc, y, (z0 + z1) / 2]);
    for (const y of shelfLevels.slice(1)) part(trim, boxG(0.06, 0.18, z1 - z0), 0x8c8f94, [xIn, y + 0.1, (z0 + z1) / 2]); // lip
    for (let b = 0; b < bays; b++) {
      for (let l = 0; l < shelfLevels.length; l++) {
        if (l === 0 && z0 + b * bay < -3) continue; // the rear wheel house takes the floor there
        const yb = shelfLevels[l] + (l === 0 ? 0 : 0.04);
        const room = (l === 0 ? 3.95 : shelfLevels[l + 1] ?? 8.6) - yb - 0.12;
        let z = z0 + b * bay + 0.12;
        const zEnd = z0 + (b + 1) * bay - 0.12;
        while (z < zEnd - 0.5) {
          const len = Math.min(zEnd - z, 0.6 + rng() * 0.9);
          const dep = Math.min(shelfDepth - 0.1, 0.8 + rng() * 0.65);
          const hgt = Math.min(room, 0.45 + rng() * 0.85);
          const x = side * (H - T - 0.05 - dep / 2);
          const yc = yb + hgt / 2;
          const zc = z + len / 2;
          const white = rng() < 0.14;
          part(trim, boxG(dep, hgt, len - 0.04), white ? 0xe6e2d8 : CARD[Math.floor(rng() * CARD.length)], [x, yc, zc]);
          if (!white) part(trim, boxG(dep + 0.01, hgt * 0.2 < 0.12 ? 0.012 : 0.012, 0.16), 0xd8c48e, [x, yb + hgt + 0.003, zc]);
          if (!white && rng() < 0.7) {
            const lab = plate(0.32, 0.2, atlas.rect('label'));
            lab.rotateY(side > 0 ? -PI / 2 : PI / 2);
            lab.translate(x - side * (dep / 2 + 0.006), yc + hgt * 0.15, zc);
            decal.push({ geometry: lab });
          }
          // a second, smaller parcel on top where there is room
          const spare = room - hgt;
          if (spare > 0.5 && rng() < 0.55) {
            const h2 = Math.min(spare - 0.05, 0.3 + rng() * 0.4);
            const l2 = len * (0.5 + rng() * 0.35);
            part(trim, boxG(dep * 0.8, h2, l2), CARD[Math.floor(rng() * CARD.length)], [x + side * 0.05, yb + hgt + h2 / 2 + 0.01, zc + (rng() - 0.5) * (len - l2)]);
          }
          z += len + 0.04 + rng() * 0.12;
        }
      }
    }
  };
  shelves(-DS, zBack + 0.35, 3.9);
  // a hand truck just inside the door with a stack waiting to go out
  {
    const hx = 1.2; const hz = 2.9; const X = (v) => -DS * v; // laid out for a +X door, mirrored
    for (const sx of [-0.45, 0.45]) bar(trim, [X(hx + 0.25), yFloor + 0.05, hz + sx], [X(hx - 0.35), yFloor + 4.0, hz + sx], 0.07, 0.07, 0x9a2a22);
    for (const yy of [1.3, 2.6, 3.9]) bar(trim, [X(hx + 0.25 - 0.6 * (yy / 4)), yFloor + yy, hz - 0.45], [X(hx + 0.25 - 0.6 * (yy / 4)), yFloor + yy, hz + 0.45], 0.06, 0.06, 0x9a2a22);
    part(trim, boxG(0.8, 0.05, 1.0), 0x55585c, [X(hx + 0.6), yFloor + 0.05, hz]);
    let y = yFloor + 0.08;
    for (const [w, h, d, c] of [[1.1, 0.9, 0.95, 0xb08a54], [0.95, 0.7, 0.85, 0xc49c64], [0.8, 0.6, 0.7, 0xa27c48]]) {
      part(trim, boxG(w, h, d), c, [X(hx + 0.75), y + h / 2, hz + (rng() - 0.5) * 0.1]);
      part(trim, boxG(w + 0.01, 0.012, 0.16), 0xd8c48e, [X(hx + 0.75), y + h + 0.003, hz]);
      y += h + 0.01;
    }
  }
  shelves(DS, zBack + 0.35, dz0 - 0.15);

  // --- wheels: single at the front, dual at the back -------------------------------------------------
  for (const side of [1, -1]) {
    const xo = side * (H - 0.3 - tyre.w / 2);
    wheel(paint, trim, { x: xo, z: wF, size: tyre, side, spokes: 8, rimColor: 0xd0d2d4 });
    wheel(paint, trim, { x: xo, z: wR, size: tyre, side, spokes: 8, rimColor: 0xd0d2d4, dish: 0.12 });
    wheel(paint, trim, { x: xo - side * (tyre.w + 0.06), z: wR, size: tyre, side, face: false });
  }
  // underneath: chassis rails, fuel tank, exhaust
  for (const sx of [-1, 1]) part(trim, boxG(0.3, 0.5, 16.4), 0x202124, [sx * 1.5, 1.6, -0.8]);
  part(trim, boxG(1.4, 0.9, 2.4), 0x2a2b2e, [-2.4, 1.3, -1.6]);
  part(paint, new THREE.CylinderGeometry(0.14, 0.14, 1.2, 12), 0x8a8e94, [-2.6, 1.15, zBack + 0.45], [PI / 2, 0, 0]);

  return assemble({ paint, trim, glass, glow, decal }, atlas, { glassShadow: false });
}

// The outline of a closed sliding door on a flat side wall: four thin seams.
function flankPatchFlat(side, z0, z1, y0, y1) {
  const parts = [];
  const x = side * (H_TRUCK + 0.008);
  const w = 0.05;
  const add = (zc, yc, dz, dy) => { const g = boxG(0.02, dy, dz); g.translate(x, yc, zc); parts.push({ geometry: g, color: 0xffffff }); };
  add(z0, (y0 + y1) / 2, w, y1 - y0); add(z1, (y0 + y1) / 2, w, y1 - y0);
  add((z0 + z1) / 2, y1, z1 - z0, w); add((z0 + z1) / 2, y0, z1 - z0, w);
  return { seams: mergeParts(parts) };
}

export const BUILDERS = {
  'police-car': policeCar,
  'city-ambulance': cityAmbulance,
  'city-taxi': cityTaxi,
  'delivery-truck': deliveryTruck,
};
