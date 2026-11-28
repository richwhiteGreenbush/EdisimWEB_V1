import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, mesh, standard } from '../../PropKit.js';
import { mergeParts, loftSampler } from '../../props/LoftKit.js';
import { lathe, lin, outward } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';
import { PALETTE } from './TownKit.js';

// Private helpers for builders/FutureVehicles.js: the five Build a Future City vehicles.
//
// Three ideas carry all five, and each is here so the builders do not each reinvent it.
//
//  * EVERYTHING LAID ON A BODY IS A CLOSED SLAB THAT ASKS THE BODY WHERE ITS SURFACE IS. A window,
//    a light strip, a livery panel or a glowing name is `slab()`: a grid of points ON the host's
//    analytic surface, lifted a hair along its true normal and given a real thickness and a rim. A
//    flat plate cannot lie on a curved hull, and a zero-thickness sheet is invisible edge-on.
//  * ONE GLOW MESH PER MODEL, unlit, coloured by vertex colour and carrying a small atlas: a white
//    column every plain light points its uvs at, and rows of text or symbols for the few lit signs.
//    So a cyan strip, a pink tail lamp and a "LOOP 1" display are one draw call.
//  * A ROTOR SPINS BY REWRITING ITS OWN FEW VERTICES. Six rotors on six different axes cannot be six
//    meshes inside a six-mesh budget, so every rotor of a model shares one small mesh and the tick
//    turns each rotor's slice of the position and normal buffers about its own hub. The root never
//    moves, so a program can still carry the whole vehicle about.

export const TAU = Math.PI * 2;
export const mixN = (a, b, t) => a + (b - a) * t;

// Closed parts are run through outward() as they are added, so a helper whose winding is in doubt
// cannot put an inside-out solid into a merge. Pass { open: true } for a surface that is not closed.
export function part(list, geometry, color, position = null, rotation = null, extra = {}) {
  const { open, ...rest } = extra;
  const p = { geometry: open ? geometry : outward(geometry), color, ...rest };
  if (position) p.position = position;
  if (rotation) p.rotation = rotation;
  list.push(p);
  return p;
}

// Writes a colour attribute from fn(p, n) -> hex or linear [r, g, b].
export function paintGeo(g, fn) {
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

// A brighter or darker copy of a colour, in linear space.
export function shade(hex, k) {
  const c = lin(hex);
  return [c[0] * k, c[1] * k, c[2] * k];
}

// ---------------------------------------------------------------------------------------------
// A triangle list whose winding is MEASURED: each triangle is told which way it should face.
// ---------------------------------------------------------------------------------------------
export class Tris {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  v(p, uv = [0, 0]) { this.pos.push(p[0], p[1], p[2]); this.uv.push(uv[0], uv[1]); return this.pos.length / 3 - 1; }
  tri(a, b, c, want) {
    const P = this.pos;
    const ax = P[a * 3]; const ay = P[a * 3 + 1]; const az = P[a * 3 + 2];
    const ux = P[b * 3] - ax; const uy = P[b * 3 + 1] - ay; const uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax; const vy = P[c * 3 + 1] - ay; const vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }
  quad(a, b, c, d, want) { this.tri(a, b, c, want); this.tri(a, c, d, want); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// A CLOSED SLAB lying on a surface. fn(a, b) for a, b in [0, 1] returns { p, n }: a point ON the
// host and its unit outward normal. The slab's inner face is `lift` proud of the host and its outer
// face `lift + thick`. `uv` = [u0, v0, u1, v1] maps the outer face (a across, b up), for a sign.
export function slab(na, nb, fn, { lift = 0.02, thick = 0.05, uv = null } = {}) {
  const T = new Tris();
  const S = [];
  for (let i = 0; i <= na; i++) {
    const row = [];
    for (let j = 0; j <= nb; j++) row.push(fn(i / na, j / nb));
    S.push(row);
  }
  const at = (s, k) => [s.p[0] + s.n[0] * k, s.p[1] + s.n[1] * k, s.p[2] + s.n[2] * k];
  const uvAt = (i, j) => (uv ? [mixN(uv[0], uv[2], i / na), mixN(uv[1], uv[3], j / nb)] : [0, 0]);
  const rim = uv ? [uv[0], uv[1]] : [0, 0];
  const outer = []; const inner = [];
  for (let i = 0; i <= na; i++) {
    outer.push([]); inner.push([]);
    for (let j = 0; j <= nb; j++) {
      outer[i].push(T.v(at(S[i][j], lift + thick), uvAt(i, j)));
      inner[i].push(T.v(at(S[i][j], lift), rim));
    }
  }
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const n = S[i][j].n;
      T.quad(outer[i][j], outer[i + 1][j], outer[i + 1][j + 1], outer[i][j + 1], n);
      T.quad(inner[i][j], inner[i + 1][j], inner[i + 1][j + 1], inner[i][j + 1], [-n[0], -n[1], -n[2]]);
    }
  }
  // The rim, on its own vertices so the faces stay flat-shaded at the edge.
  const edge = (list, wantFn) => {
    for (let k = 0; k < list.length - 1; k++) {
      const [i0, j0] = list[k]; const [i1, j1] = list[k + 1];
      const a = T.v(at(S[i0][j0], lift + thick), rim); const b = T.v(at(S[i1][j1], lift + thick), rim);
      const c = T.v(at(S[i1][j1], lift), rim); const d = T.v(at(S[i0][j0], lift), rim);
      T.quad(a, b, c, d, wantFn(i0, j0, i1, j1));
    }
  };
  const away = (i, j, i2, j2) => {
    const p = S[i][j].p; const q = S[i2][j2].p;
    return [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  };
  const bottom = []; const top = []; const left = []; const right = [];
  for (let i = 0; i <= na; i++) { bottom.push([i, 0]); top.push([i, nb]); }
  for (let j = 0; j <= nb; j++) { left.push([0, j]); right.push([na, j]); }
  edge(bottom, (i0) => away(i0, 0, i0, Math.min(1, nb)));
  edge(top, (i0) => away(i0, nb, i0, Math.max(0, nb - 1)));
  edge(left, (i0, j0) => away(0, j0, Math.min(1, na), j0));
  edge(right, (i0, j0) => away(na, j0, Math.max(0, na - 1), j0));
  return T.geometry();
}

// Sets every uv of a glow part to the atlas's white column.
export function plainGlow(g, white) {
  const n = g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = white[0]; uv[i * 2 + 1] = white[1]; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// A rounded box, a SUPERELLIPSOID made from a sphere: every vertex pushed out toward the box's
// corners by raising the sphere's direction cosines to `e`. Centred on its origin.
export function rbox(w, h, d, e = 0.3, seg = 14) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  const P = g.attributes.position;
  const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < P.count; i++) {
    P.setXYZ(i, f(P.getX(i)) * (w / 2), f(P.getY(i)) * (h / 2), f(P.getZ(i)) * (d / 2));
  }
  g.computeVertexNormals();
  return g;
}

// An ellipsoid, centred on its origin.
export function ellipsoid(rx, ry, rz, seg = 20) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.6)));
  g.scale(rx, ry, rz);
  return g;
}

// ---------------------------------------------------------------------------------------------
// A horizontal loft (along Z) and the questions anything laid on it asks
// ---------------------------------------------------------------------------------------------
export function loftSurface(stations) {
  const S = loftSampler(stations);
  const P = (t, u) => S(t, u);
  const e = 0.0015;
  const N = (t, u) => {
    const tt = Math.min(1 - e, Math.max(e, t));
    const a = S(tt + e, u); const b = S(tt - e, u);
    const c = S(tt, u + e); const d = S(tt, u - e);
    const pt = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const pu = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
    let n = [pt[1] * pu[2] - pt[2] * pu[1], pt[2] * pu[0] - pt[0] * pu[2], pt[0] * pu[1] - pt[1] * pu[0]];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const p = S(tt, u); const ctr = S.centre(tt);
    if (n[0] * (p[0] - ctr[0]) + n[1] * (p[1] - ctr[1]) + n[2] * (p[2] - ctr[2]) < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  };
  const sec = (t) => S.at(t);
  // A point on the flank at a world z and y; side +1 is +X.
  const flankTU = (z, y, side = 1) => {
    const t = S.tAtD(z);
    const s = sec(t);
    const yy = Math.min(s.b + s.up * 0.999, Math.max(s.b - s.dn * 0.999, y));
    let u = S.uAtB(t, yy);
    if (side < 0) u = 0.5 - u;
    return [t, u];
  };
  const flank = (z, y, side = 1) => { const [t, u] = flankTU(z, y, side); return { p: P(t, u), n: N(t, u) }; };
  // A point across the top at a world z and x.
  const crown = (z, x) => {
    const t = S.tAtD(z);
    let lo = 0.0005; let hi = 0.4995;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (S(t, mid)[0] > x) lo = mid; else hi = mid;
    }
    const u = (lo + hi) / 2;
    return { p: P(t, u), n: N(t, u) };
  };
  // A point under the bottom at a world z and x.
  const belly = (z, x) => {
    const t = S.tAtD(z);
    let lo = 0.5005; let hi = 0.9995;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (S(t, mid)[0] < x) lo = mid; else hi = mid;
    }
    const u = (lo + hi) / 2;
    return { p: P(t, u), n: N(t, u) };
  };
  return { S, P, N, sec, flank, flankTU, crown, belly, tAtD: (z) => S.tAtD(z) };
}

// A slab on a loft's flank between z0..z1 and y0..y1 (either may be a function of z). For text,
// pass z0 and z1 in reading order: on the +X flank that is +Z to -Z, on the -X flank -Z to +Z.
export function flankSlab(L, side, z0, z1, y0, y1, { nz = 8, ny = 2, lift = 0.02, thick = 0.05, uv = null } = {}) {
  const Y0 = typeof y0 === 'function' ? y0 : () => y0;
  const Y1 = typeof y1 === 'function' ? y1 : () => y1;
  return slab(nz, ny, (a, b) => {
    const z = mixN(z0, z1, a);
    return L.flank(z, mixN(Y0(z), Y1(z), b), side);
  }, { lift, thick, uv });
}

// A slab across a loft's top between z0..z1 and x0..x1.
export function crownSlab(L, z0, z1, x0, x1, { nz = 8, nx = 6, lift = 0.02, thick = 0.05, uv = null } = {}) {
  return slab(nz, nx, (a, b) => L.crown(mixN(z0, z1, a), mixN(x0, x1, b)), { lift, thick, uv });
}

// A slab over a range of the loft's own (t, u) parameters: a band all the way round, say.
export function tuSlab(L, t0, t1, u0, u1, { nt = 8, nu = 8, lift = 0.02, thick = 0.05 } = {}) {
  return slab(nt, nu, (a, b) => {
    const t = mixN(t0, t1, a); const u = mixN(u0, u1, b);
    return { p: L.P(t, u), n: L.N(t, u) };
  }, { lift, thick });
}

// ---------------------------------------------------------------------------------------------
// The glow atlas
// ---------------------------------------------------------------------------------------------
// labels: [{ text, fg, bg, aspect, draw? }]. Returns { texture, white, rects }. Every plain light
// points its uvs at `white`; each label's rect is [u0, v0, u1, v1] for slab().
export function glowAtlas(labels = []) {
  const W = 512; const rowH = 128; const rows = Math.max(1, labels.length);
  const H = rowH * rows;
  const x0 = 48; const pad = 6;
  const rects = labels.map((L, i) => {
    const h = rowH - pad * 2;
    const w = Math.min(W - x0 - pad, h * (L.aspect ?? 4));
    const top = i * rowH + pad;
    return { px: [x0, top, w, h], uv: [x0 / W, 1 - (top + h) / H, (x0 + w) / W, 1 - top / H] };
  });
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 36, H);
    labels.forEach((L, i) => {
      const [x, y, w, h] = rects[i].px;
      ctx.fillStyle = L.bg ?? '#10142a'; ctx.fillRect(x, y, w, h);
      if (L.draw) { L.draw(ctx, x, y, w, h); return; }
      let size = h * 0.7;
      const font = (s) => `bold ${Math.round(s)}px "Trebuchet MS", "Arial Rounded MT Bold", Arial, sans-serif`;
      ctx.font = font(size);
      while (size > 8 && ctx.measureText(L.text).width > w * 0.88) { size -= 2; ctx.font = font(size); }
      ctx.fillStyle = L.fg ?? '#5cf2ff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(L.text, x + w / 2, y + h / 2 + size * 0.04);
    });
  });
  return { texture, white: [18 / W, 0.5], rects: rects.map((r) => r.uv) };
}

// ---------------------------------------------------------------------------------------------
// Rotors that spin by themselves
// ---------------------------------------------------------------------------------------------
// rotors: [{ parts, centre: [x, y, z], speed (rad/s, the sign is the direction), phase }]. Each
// rotor's parts are authored about its own hub with the spin axis +Y. Returns { mesh, update(dt) }.
export function rotorMesh(rotors, material) {
  const geos = []; const ranges = [];
  let offset = 0;
  let indexed = true;
  const built = rotors.map((r) => mergeParts(r.parts));
  if (built.some((g) => !g.index)) indexed = false;
  for (let k = 0; k < rotors.length; k++) {
    const g = indexed ? built[k] : built[k].toNonIndexed();
    geos.push(g);
    ranges.push({ start: offset, count: g.attributes.position.count });
    offset += g.attributes.position.count;
  }
  const geo = mergeGeometries(geos, false);
  const pos = geo.attributes.position; const nrm = geo.attributes.normal;
  const base = pos.array.slice(); const baseN = nrm.array.slice();
  pos.setUsage(THREE.DynamicDrawUsage); nrm.setUsage(THREE.DynamicDrawUsage);
  const angles = rotors.map((r) => r.phase ?? 0);
  let reach = 0;
  for (let i = 0; i < base.length; i += 3) reach = Math.max(reach, Math.hypot(base[i], base[i + 2]) + Math.abs(base[i + 1]));
  const write = () => {
    const P = pos.array; const Nn = nrm.array;
    for (let k = 0; k < rotors.length; k++) {
      const { start, count } = ranges[k];
      const [cx, cy, cz] = rotors[k].centre;
      const c = Math.cos(angles[k]); const s = Math.sin(angles[k]);
      for (let i = start; i < start + count; i++) {
        const x = base[i * 3]; const z = base[i * 3 + 2];
        P[i * 3] = cx + c * x + s * z; P[i * 3 + 1] = cy + base[i * 3 + 1]; P[i * 3 + 2] = cz - s * x + c * z;
        const nx = baseN[i * 3]; const nz = baseN[i * 3 + 2];
        Nn[i * 3] = c * nx + s * nz; Nn[i * 3 + 1] = baseN[i * 3 + 1]; Nn[i * 3 + 2] = -s * nx + c * nz;
      }
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
  };
  write();
  // Every rotor's whole disc, whatever angle it is at: the bound is set by hand, once.
  const box = new THREE.Box3();
  for (const r of rotors) {
    box.expandByPoint(new THREE.Vector3(r.centre[0] - reach, r.centre[1] - reach, r.centre[2] - reach));
    box.expandByPoint(new THREE.Vector3(r.centre[0] + reach, r.centre[1] + reach, r.centre[2] + reach));
  }
  geo.boundingBox = box.clone();
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const m = mesh(geo, material);
  m.castShadow = true;
  return {
    mesh: m,
    update(dt) {
      for (let k = 0; k < rotors.length; k++) angles[k] = (angles[k] + dt * rotors[k].speed) % TAU;
      write();
    },
  };
}

// The tick every moving vehicle carries, on the ROOT. dt is clamped; under reduced motion the
// decorative spinning holds still and `fn` is told so.
export function addTick(group, fn) {
  group.userData.tick = {
    update(dt) {
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      fn(step, reducedMotion());
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------------------------
// Wheels (from CityCars, so a future car's tyre is the same tyre as a city car's)
// ---------------------------------------------------------------------------------------------
export function wheel(paint, trim, { x, z, size, side, rimColor = PALETTE.hubSilver, hubColor = 0xd4d8dc, spokes = 5, face = true }) {
  const { r, w } = size;
  const cy = r - 0.02;
  const turn = new THREE.Matrix4().makeRotationZ(side > 0 ? -Math.PI / 2 : Math.PI / 2);
  const at = new THREE.Matrix4().makeTranslation(x, cy, z);
  const place = (g) => g.applyMatrix4(turn).applyMatrix4(at);
  const tyre = lathe([
    [0, -w * 0.3], [r * 0.6, -w * 0.3], [r * 0.66, -w * 0.5], [r * 0.9, -w * 0.5], [r * 0.975, -w * 0.43],
    [r, -w * 0.26], [r, w * 0.26], [r * 0.975, w * 0.43], [r * 0.9, w * 0.5], [r * 0.69, w * 0.5],
    [r * 0.64, w * 0.38], [r * 0.62, w * 0.12], [0, w * 0.12],
  ], 20);
  paintGeo(tyre, (p) => {
    const rad = Math.hypot(p.x, p.z);
    return rad < r * 0.6 ? 0x2c2e31 : (Math.abs(p.y) > w * 0.46 && rad < r * 0.85 ? 0x262729 : PALETTE.tyre);
  });
  trim.push({ geometry: place(tyre), color: 0xffffff, keepColor: true });
  if (!face) return;
  const rim = lathe([
    [0, w * 0.1], [r * 0.625, w * 0.1], [r * 0.67, w * 0.4], [r * 0.645, w * 0.47],
    [r * 0.56, w * 0.36], [r * 0.54, w * 0.3], [0, w * 0.3],
  ], 20);
  paintGeo(rim, (p) => (Math.hypot(p.x, p.z) < r * 0.55 && p.y < w * 0.32 ? 0x3c3f44 : rimColor));
  paint.push({ geometry: place(rim), color: 0xffffff, keepColor: true });
  const spokeLen = r * 0.4;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * TAU + 0.3;
    const g = new THREE.BoxGeometry(r * 0.15, w * 0.1, spokeLen);
    g.translate(0, w * 0.33, r * 0.15 + spokeLen / 2);
    g.rotateY(a);
    paint.push({ geometry: place(g), color: rimColor });
  }
  const hub = new THREE.CylinderGeometry(r * 0.17, r * 0.19, w * 0.12, 14);
  hub.translate(0, w * 0.37, 0);
  paint.push({ geometry: place(hub), color: hubColor });
}

// ---------------------------------------------------------------------------------------------
// Materials and the final group
// ---------------------------------------------------------------------------------------------
export function assemble(lists, atlas, { clear = null, extra = [] } = {}) {
  const group = new THREE.Group();
  const add = (parts, mat, shadow = true) => {
    if (!parts || !parts.length) return null;
    const m = mesh(mergeParts(parts), mat);
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  add(lists.paint, standard({ vertexColors: true, roughness: 0.36, metalness: 0.22 }));
  add(lists.trim, standard({ vertexColors: true, roughness: 0.72, metalness: 0.06 }));
  add(lists.glass, standard({ vertexColors: true, roughness: 0.12, metalness: 0.35 }));
  if (lists.glow?.length) {
    for (const p of lists.glow) if (!p.keepUV) plainGlow(p.geometry, atlas.white);
    const m = mesh(mergeParts(lists.glow), new THREE.MeshBasicMaterial({ vertexColors: true, map: atlas.texture }));
    m.castShadow = false;
    group.add(m);
  }
  if (lists.clear?.length) {
    const m = mesh(mergeParts(lists.clear), standard({
      vertexColors: true, roughness: 0.06, metalness: 0.1, transparent: true, opacity: clear?.opacity ?? 0.3, depthWrite: false,
    }));
    m.castShadow = false;
    m.receiveShadow = false;
    m.renderOrder = 2;
    group.add(m);
  }
  for (const m of extra) group.add(m);
  return group;
}

// ---------------------------------------------------------------------------------------------
// Asking a finished solid where its surface is, by casting a ray at it
// ---------------------------------------------------------------------------------------------
// For a part laid on a face the loft's own parameters do not describe easily (the front of a nose,
// say). Returns hit(origin, dir) -> { p, n } with the smooth interpolated normal, or null.
export function rayHost(geometry) {
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  m.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  const N = geometry.attributes.normal;
  const na = new THREE.Vector3(); const nb = new THREE.Vector3(); const nc = new THREE.Vector3();
  const pa = new THREE.Vector3(); const pb = new THREE.Vector3(); const pc = new THREE.Vector3();
  const P = geometry.attributes.position;
  return (origin, dir) => {
    rc.set(new THREE.Vector3(origin[0], origin[1], origin[2]), new THREE.Vector3(dir[0], dir[1], dir[2]).normalize());
    const hit = rc.intersectObject(m, false)[0];
    if (!hit) return null;
    const { a, b, c } = hit.face;
    pa.fromBufferAttribute(P, a); pb.fromBufferAttribute(P, b); pc.fromBufferAttribute(P, c);
    na.fromBufferAttribute(N, a); nb.fromBufferAttribute(N, b); nc.fromBufferAttribute(N, c);
    const n = new THREE.Vector3();
    THREE.Triangle.getInterpolation(hit.point, pa, pb, pc, na, nb, nc, n);
    n.normalize();
    return { p: [hit.point.x, hit.point.y, hit.point.z], n: [n.x, n.y, n.z] };
  };
}

// A matrix that stands a part authored facing +Z on a surface point, its +Z along the normal and
// its +Y as close to world up as the surface allows.
export function onSurface(hit, sink = 0, upHint = [0, 1, 0]) {
  const z = new THREE.Vector3(hit.n[0], hit.n[1], hit.n[2]).normalize();
  let up = new THREE.Vector3(upHint[0], upHint[1], upHint[2]);
  if (Math.abs(up.dot(z)) > 0.98) up = new THREE.Vector3(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(up, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  m.setPosition(hit.p[0] - z.x * sink, hit.p[1] - z.y * sink, hit.p[2] - z.z * sink);
  return m;
}
