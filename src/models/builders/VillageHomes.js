// Build a Village: the five homes. Thatched cottage, log cabin, adobe house, stilt house, red barn.
//
// Children place these together, walk straight into them and program them, so each is a real
// life-size building with a real doorway, walls with thickness, a floor and a closed roof over a
// furnished room, at no more than 25k triangles and 4 meshes. All of them are kit pieces: no stand,
// no plate of lawn, a skirt that runs down to y = -0.4, and their measured outline (roof overhang
// included) is what the plots and fences tile against.
//
// THREE THINGS CARRY EVERY BUILDING HERE, and none of them spends triangles where they do not show.
//
//  * SURFACE COURSES ARE A NEAR-WHITE TILE MULTIPLIED BY VERTEX COLOUR, with UVs in FEET (The
//    Neighborhood's rule). One board tile serves barn red outside and raw timber inside. The same
//    Texture rides as map and bumpMap, so a house costs a quarter of the texture memory it would.
//  * `ribbonWall` makes a whole earth or plaster wall ONE closed surface: an outer face, an inner
//    face, reveals and a cap, from a tensor grid with the openings as missing cells. A fillet is a
//    displacement of that grid near an edge, so an opening's arris is rounded by hand and cannot
//    open a gap. There is no CSG anywhere in this file and no opening is a painted panel.
//  * `thatchRoof` is one closed stack of rings from the ridge, round the eave roll and back up the
//    underside, so a roof is deep and rounded from outside and a closed ceiling from inside.

import * as THREE from 'three';
import { mergeParts, smoothNoise3 } from '../../props/LoftKit.js';
import { seededRandom } from '../../PropKit.js';
import { lin, mix, sstep, clamp01, outward, tube, lathe, Sculpt, ellipsoidP, boxP, sphereP, curveP, polygonize } from '../ModelKit.js';

// ---------------------------------------------------------------------------------------------
// The village's palette
// ---------------------------------------------------------------------------------------------
const PAL = {
  timber: 0x8a6a48, dark: 0x5b432e, thatch: 0xc9a25a, white: 0xe4dcc8, stone: 0x8f8a7e,
  red: 0xa23b2a, adobe: 0xc48a5c, soil: 0x6b4a2e, wheat: 0xd9b24a, leaf: 0x5c8f3a,
  glass: 0x3f5f78, iron: 0x2b2a2a, blue: 0x2f6fae,
};
const colorOf = (c) => (Array.isArray(c) ? c : lin(c));
const times = (hex, k) => { const c = colorOf(hex); return [c[0] * k, c[1] * k, c[2] * k]; };
const jitter = (rng, hex, amt = 0.14) => {
  const c = colorOf(hex);
  const k = 1 + (rng() - 0.5) * 2 * amt;
  return [c[0] * k, c[1] * k, c[2] * k];
};

// ---------------------------------------------------------------------------------------------
// Tiles. Near-white, so vertex colour supplies the hue. Each carries a flat white patch in its
// bottom left corner, and `flat` parts point at it: an iron hinge should not wear wood grain.
// ---------------------------------------------------------------------------------------------
function tile(w, h, feet, paint, bumpScale = 1, patch = '#f4f2ec', patchX = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  paint(ctx, w, h);
  if (patch) {
    ctx.fillStyle = patch;
    ctx.fillRect(patchX, h - 12, 12, 12);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 6;
  texture.needsUpdate = true;
  return { texture, feet, bumpScale, flat: [(patchX + 6) / w, 6 / h] };
}
const grey = (v, a = 1, warm = 0) => `rgba(${Math.round(v)},${Math.round(v - warm)},${Math.round(v - warm * 2.2)},${a})`;

function woodTile(seed = 11) {
  const rng = seededRandom(seed);
  return tile(256, 512, [2, 4], (ctx, W, H) => {
    ctx.fillStyle = '#eee8dc';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 150; i++) {
      const x = rng() * W; const amp = 1 + rng() * 5; const cyc = 1 + Math.floor(rng() * 3); const ph = rng() * 6.28;
      ctx.strokeStyle = grey(125 + rng() * 95, 0.25 + rng() * 0.45, 8);
      ctx.lineWidth = 0.6 + rng() * 1.6;
      for (const dx of [-W, 0, W]) {
        ctx.beginPath();
        for (let y = 0; y <= H; y += 16) {
          const px = x + dx + Math.sin((y / H) * 6.283 * cyc + ph) * amp;
          if (y === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();
      }
    }
  }, 0.5, '#eee8dc');
}

function thatchTile(seed = 21) {
  const rng = seededRandom(seed);
  return tile(256, 512, [3, 3], (ctx, W, H) => {
    ctx.fillStyle = '#c9c1aa';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 5200; i++) {
      const x = rng() * W; const y = rng() * H; const len = 18 + rng() * 60;
      const lean = (rng() - 0.5) * 7;
      ctx.strokeStyle = grey(120 + rng() * 135, 0.35 + rng() * 0.55, 10);
      ctx.lineWidth = 0.7 + rng() * 1.1;
      for (const dx of [-W, 0, W]) {
        for (const dy of [-H, 0, H]) {
          if (y + dy + len < 0 || y + dy > H) continue;
          ctx.beginPath();
          ctx.moveTo(x + dx, y + dy);
          ctx.lineTo(x + dx + lean, y + dy + len);
          ctx.stroke();
        }
      }
    }
    // Courses: a soft shadow under each lapped layer, wandering rather than ruled.
    for (let c = 0; c < 3; c++) {
      const y0 = (c + 0.5) * (H / 3);
      for (let x = 0; x < W; x += 3) {
        const y = y0 + Math.sin((x / W) * 6.283 * 3 + c) * 5;
        ctx.fillStyle = 'rgba(40,30,16,0.13)';
        ctx.fillRect(x, y, 3, 12);
      }
    }
  }, 1.1, '#c9c1aa');
}

function rubbleTile(seed = 31) {
  const rng = seededRandom(seed);
  return tile(256, 256, [3.6, 3.6], (ctx, W, H) => {
    ctx.fillStyle = '#efeeea';
    ctx.fillRect(0, 0, W, H);
    // Whitewash over rubble: coat after coat has filled the joints, so the stones are felt as a shallow
    // unevenness and never as a colour change. Anything stronger is a wall of cobbles.
    let y = -8;
    while (y < H) {
      const rowH = 22 + rng() * 26;
      let x = -rng() * 40;
      while (x < W) {
        const w = 28 + rng() * 52;
        const lift = (rng() - 0.5) * 8;
        const tone = 240 + rng() * 10;
        ctx.strokeStyle = 'rgba(170,166,156,0.1)';
        ctx.lineWidth = 2 + rng() * 2.5;
        ctx.fillStyle = grey(tone, 0.9);
        for (const dx of [-W, 0, W]) {
          for (const dy of [-H, 0, H]) {
            ctx.beginPath();
            ctx.ellipse(x + w / 2 + dx, y + rowH / 2 + lift + dy, w / 2 + 3, rowH / 2 + 3, (rng() - 0.5) * 0.14, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        x += w;
      }
      y += rowH;
    }
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = grey(205 + rng() * 45, 0.35);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
    }
  }, 0.9, '#efeeea');
}

// Fieldstone: irregular polygons in rough courses over a mid-grey joint. `ragged` pulls the corners
// about, which is what stops a wall of them reading as cobbles or as polka dots.
function stoneTile(seed = 41, { feet = 4, joint = '#837d71', ragged = 0.22 } = {}) {
  const rng = seededRandom(seed);
  return tile(256, 256, [feet, feet], (ctx, W, H) => {
    ctx.fillStyle = joint;
    ctx.fillRect(0, 0, W, H);
    let y = -6;
    while (y < H) {
      const rowH = 24 + rng() * 26;
      let x = -rng() * 40;
      while (x < W) {
        const w = 30 + rng() * 50;
        const v = 190 + rng() * 62;
        const sides = 6 + Math.floor(rng() * 3);
        const pts = [];
        for (let k = 0; k < sides; k++) {
          const a = (k / sides) * Math.PI * 2 + 0.4;
          const r = 1 + (rng() - 0.5) * ragged;
          // A squared-off superellipse: flat beds top and bottom, the way a stone is laid.
          const c = Math.cos(a); const s2 = Math.sin(a);
          pts.push([(Math.sign(c) * Math.abs(c) ** 0.55 * (w / 2 - 1.6)) * r, (Math.sign(s2) * Math.abs(s2) ** 0.45 * (rowH / 2 - 1.4)) * r]);
        }
        ctx.fillStyle = grey(v, 1, 3);
        for (const dx of [-W, 0, W]) {
          for (const dy of [-H, 0, H]) {
            ctx.beginPath();
            pts.forEach((pt, k) => { const px = x + w / 2 + pt[0] + dx; const py = y + rowH / 2 + pt[1] + dy; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
            ctx.closePath();
            ctx.fill();
          }
        }
        x += w;
      }
      y += rowH;
    }
    for (let i = 0; i < 1100; i++) {
      ctx.fillStyle = grey(rng() < 0.5 ? 165 : 250, 0.22);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 3, 1 + rng() * 2);
    }
  }, 1.5, '#d8d4cb');
}

function assemble(bags) {
  const g = new THREE.Group();
  for (const [bag, params] of bags) {
    if (!bag.parts.length) continue;
    const geometry = outward(mergeParts(bag.parts));
    const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, map: bag.t.texture, bumpMap: bag.t.texture, bumpScale: bag.t.bumpScale, roughness: 0.92, metalness: 0, ...params,
    }));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

const bag = (t) => ({ t, parts: [] });

// ---------------------------------------------------------------------------------------------
// Solids with their UVs in feet
// ---------------------------------------------------------------------------------------------
function paintColor(g, color, tint) {
  const P = g.attributes.position;
  const N = g.attributes.normal;
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

// Box-projected UVs. `grain` names the world axis the tile's v (its long grain) runs along.
function projectUV(g, t, grain, flat) {
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const UV = g.attributes.uv;
  for (let i = 0; i < P.count; i++) {
    if (flat) { UV.setXY(i, t.flat[0], t.flat[1]); continue; }
    const nx = Math.abs(N.getX(i)); const ny = Math.abs(N.getY(i)); const nz = Math.abs(N.getZ(i));
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    let u; let v;
    if (nx >= ny && nx >= nz) {
      if (grain === 'z') { u = y; v = z; } else { u = z; v = y; }
    } else if (ny >= nz) {
      if (grain === 'z') { u = x; v = z; } else { u = z; v = x; }
    } else if (grain === 'x') { u = y; v = x; } else { u = x; v = y; }
    UV.setXY(i, u / t.feet[0], v / t.feet[1]);
  }
}

function box(b, color, x0, x1, y0, y1, z0, z1, { grain = 'y', segs = null, tint = null, flat = false } = {}) {
  const [sx, sy, sz] = segs ?? [1, 1, 1];
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), sx, sy, sz);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.clearGroups();
  projectUV(g, b.t, grain, flat);
  paintColor(g, color, tint);
  b.parts.push({ geometry: g, keepColor: true });
}

const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);

// A small smooth ball with no grain on it: a flower head, a chilli, a knob.
function bead(b, color, x, y, z, r, { sx = 1, sy = 1, sz = 1, w = 6, h = 4 } = {}) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  g.clearGroups();
  projectUV(g, b.t, 'y', true);
  paintColor(g, color);
  b.parts.push({ geometry: g, keepColor: true });
}

// A sawn timber from a to b, its grain along its length, `h` held toward `up`.
function bar(b, color, a, c, w, h, { up = [0, 1, 0], flat = false, tint = null } = {}) {
  const A = V(a); const C = V(c);
  const len = A.distanceTo(C);
  if (len < 1e-3) return;
  const g = new THREE.BoxGeometry(w, h, len);
  g.clearGroups();
  const seed = (a[0] * 0.37 + a[1] * 0.71 + a[2] * 0.53) % 1;
  projectUV(g, b.t, 'z', flat);
  if (!flat) { const UV = g.attributes.uv; for (let i = 0; i < UV.count; i++) UV.setX(i, UV.getX(i) + seed); }
  const zAxis = C.clone().sub(A).normalize();
  let ref = V(up).normalize();
  if (Math.abs(ref.dot(zAxis)) > 0.985) ref = Math.abs(zAxis.z) > 0.7 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const xAxis = new THREE.Vector3().crossVectors(ref, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  m.setPosition(A.add(C).multiplyScalar(0.5));
  g.applyMatrix4(m);
  paintColor(g, color, tint);
  b.parts.push({ geometry: g, keepColor: true });
}

// A round pole from a to b, closed at both ends, grain along its length.
function pole(b, color, a, c, r, { r2 = null, sides = 8, rows = 1, flat = false, wander = 0, seed = 1, tint = null } = {}) {
  const A = V(a); const C = V(c);
  const len = A.distanceTo(C);
  if (len < 1e-3) return;
  const g = new THREE.CylinderGeometry(r2 ?? r, r, len, sides, rows);
  g.clearGroups();
  const UV = g.attributes.uv;
  const P = g.attributes.position;
  const off = (a[0] * 0.37 + a[1] * 0.71 + a[2] * 0.53) % 1;
  for (let i = 0; i < UV.count; i++) {
    if (flat) UV.setXY(i, b.t.flat[0], b.t.flat[1]);
    else UV.setXY(i, UV.getX(i) * ((2 * Math.PI * r) / b.t.feet[0]) + off, UV.getY(i) * (len / b.t.feet[1]) + off);
    if (wander) {
      const t = (P.getY(i) / len) * 2;
      const sag = (1 - t * t) * wander;
      const nx = smoothNoise3(seed * 3.1, t * 1.2, 0.5) - 0.5;
      const nz = smoothNoise3(seed * 3.1, t * 1.2, 4.5) - 0.5;
      P.setX(i, P.getX(i) + (nx * 2 + 0.3) * sag);
      P.setZ(i, P.getZ(i) + (nz * 2) * sag);
    }
  }
  const dir = C.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(C).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  paintColor(g, color, tint);
  b.parts.push({ geometry: g, keepColor: true });
}

// A soft block: chamfered corners with smooth normals, which reads as rounded at no cost. Mattresses,
// quilts, benches, loaves.
function softBox(b, color, cx, cy, cz, hx, hy, hz, r, { segs = [4, 4, 4], tint = null, flat = true, grain = 'y', perFace = null } = {}) {
  let g = new THREE.BoxGeometry(2, 2, 2, segs[0], segs[1], segs[2]);
  g.clearGroups();
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const remap = (v, h, n) => {
    const i = Math.round(((v + 1) / 2) * n);
    if (i === 0) return -h;
    if (i === n) return h;
    if (i === 1) return -h + r;
    if (i === n - 1) return h - r;
    return mix(-h + r, h - r, (i - 1) / (n - 2));
  };
  for (let i = 0; i < P.count; i++) {
    const x = remap(P.getX(i), hx, segs[0]); const y = remap(P.getY(i), hy, segs[1]); const z = remap(P.getZ(i), hz, segs[2]);
    const cxx = THREE.MathUtils.clamp(x, -hx + r, hx - r);
    const cyy = THREE.MathUtils.clamp(y, -hy + r, hy - r);
    const czz = THREE.MathUtils.clamp(z, -hz + r, hz - r);
    const d = new THREE.Vector3(x - cxx, y - cyy, z - czz);
    if (d.lengthSq() < 1e-8) d.set(N.getX(i), N.getY(i), N.getZ(i));
    d.normalize();
    P.setXYZ(i, cxx + d.x * r + cx, cyy + d.y * r + cy, czz + d.z * r + cz);
    N.setXYZ(i, d.x, d.y, d.z);
  }
  projectUV(g, b.t, grain, flat);
  paintColor(g, color, tint);
  // A colour per cell, for a patchwork: a shared vertex would smear one patch into the next.
  if (perFace) {
    g = g.toNonIndexed();
    const P2 = g.attributes.position; const C = g.attributes.color;
    const out = [0, 0, 0];
    for (let i = 0; i < P2.count; i += 6) {
      perFace((P2.getX(i) + P2.getX(i + 1) + P2.getX(i + 2)) / 3, (P2.getY(i) + P2.getY(i + 1) + P2.getY(i + 2)) / 3, (P2.getZ(i) + P2.getZ(i + 1) + P2.getZ(i + 2)) / 3, out);
      for (let k = 0; k < 6; k++) C.setXYZ(i + k, out[0], out[1], out[2]);
    }
  }
  b.parts.push({ geometry: g, keepColor: true });
}

function turned(b, color, profile, x, y, z, { segments = 16, tint = null, scale = 1 } = {}) {
  const g = lathe(profile.map(([r, h]) => [r * scale, h * scale]), segments);
  g.translate(x, y, z);
  const UV = g.attributes.uv ?? new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2);
  g.setAttribute('uv', UV);
  for (let i = 0; i < UV.count; i++) UV.setXY(i, b.t.flat[0], b.t.flat[1]);
  paintColor(g, color, tint);
  b.parts.push({ geometry: g, keepColor: true });
}

// A box written in wall coordinates: a along the wall, y up, n out through it. The grain 'h' runs
// along the wall, 'v' up it.
function sideBox(b, color, side, a0, a1, y0, y1, n0, n1, { grain = 'v', flat = false, tint = null, segs = null } = {}) {
  const alongX = side === '+z' || side === '-z';
  const s = side[0] === '+' ? 1 : -1;
  const g2 = grain === 'v' ? 'y' : (alongX ? 'x' : 'z');
  const opts = { grain: g2, flat, tint, segs };
  if (alongX) box(b, color, a0, a1, y0, y1, Math.min(n0 * s, n1 * s), Math.max(n0 * s, n1 * s), opts);
  else box(b, color, Math.min(n0 * s, n1 * s), Math.max(n0 * s, n1 * s), y0, y1, a0, a1, opts);
}

// ---------------------------------------------------------------------------------------------
// A prism: a closed polygon in (p, y) swept along X (p is z) or along Z (p is x). Roof slabs and
// gable infill. The sides are subdivided so a tint or a warp has something to land on; the caps
// are triangulated, so the polygon need not be convex.
// ---------------------------------------------------------------------------------------------
function prism(b, color, poly, axis, a0, a1, { along = 1, runStep = 100, warp = null, tint = null, grainAlongRun = true, flat = false } = {}) {
  const area = THREE.ShapeUtils.area(poly.map(([p, y]) => new THREE.Vector2(p, y)));
  const pts = area < 0 ? poly : [...poly].reverse(); // always clockwise from here on
  const pos = []; const uv = []; const index = [];
  const place = (a, p, y) => (axis === 'x' ? [a, y, p] : [p, y, a]);
  const n = pts.length;
  let run = 0;
  const t = b.t;
  const flipSide = axis === 'x'; // measured: a clockwise outline swept along +X has the sides the other way round
  for (let e = 0; e < n; e++) {
    const A = pts[e]; const B = pts[(e + 1) % n];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const m = Math.max(1, Math.round(len / runStep));
    const base = pos.length / 3;
    for (let j = 0; j <= m; j++) {
      const f = j / m;
      const p = mix(A[0], B[0], f); const y = mix(A[1], B[1], f);
      for (let i = 0; i <= along; i++) {
        const a = mix(a0, a1, i / along);
        const w = place(a, p, y);
        pos.push(w[0], w[1], w[2]);
        if (flat) uv.push(t.flat[0], t.flat[1]);
        else if (grainAlongRun) uv.push(a / t.feet[0], (run + len * f) / t.feet[1]);
        else uv.push((run + len * f) / t.feet[0], a / t.feet[1]);
      }
    }
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < along; i++) {
        const q0 = base + j * (along + 1) + i; const q1 = q0 + 1; const q2 = q1 + along + 1; const q3 = q0 + along + 1;
        if (flipSide) index.push(q0, q3, q2, q0, q2, q1); else index.push(q0, q1, q2, q0, q2, q3);
      }
    }
    run += len;
  }
  const contour = pts.map(([p, y]) => new THREE.Vector2(p, y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, want] of [[a1, axis === 'z' ? 1 : -1], [a0, axis === 'z' ? -1 : 1]]) {
    const base = pos.length / 3;
    for (const [p, y] of pts) {
      const w = place(a, p, y);
      pos.push(w[0], w[1], w[2]);
      if (flat) uv.push(t.flat[0], t.flat[1]);
      else uv.push(p / t.feet[0], y / t.feet[1]);
    }
    for (const [i0, i1, i2] of faces) {
      const s = (pts[i1][0] - pts[i0][0]) * (pts[i2][1] - pts[i0][1]) - (pts[i2][0] - pts[i0][0]) * (pts[i1][1] - pts[i0][1]);
      if ((s > 0) === (want > 0)) index.push(base + i0, base + i1, base + i2);
      else index.push(base + i0, base + i2, base + i1);
    }
  }
  if (warp) {
    const out = [0, 0, 0];
    for (let i = 0; i < pos.length; i += 3) {
      out[0] = pos[i]; out[1] = pos[i + 1]; out[2] = pos[i + 2];
      warp(out);
      pos[i] = out[0]; pos[i + 1] = out[1]; pos[i + 2] = out[2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  paintColor(g, color, tint);
  b.parts.push({ geometry: g, keepColor: true });
}

// ---------------------------------------------------------------------------------------------
// ribbonWall: a whole wall ring as one closed surface
// ---------------------------------------------------------------------------------------------
// Plan: a rounded rectangle, outer half-extents hx and hz, corner radius rc, wall thickness t. Inner
// corners have radius ri. Openings are { side, a0, a1, y0, y1 }; their cells are simply absent and
// the reveals join the two faces. `top(x, z)` is the height of the wall's head on either face.
function ribbonWall(b, {
  hx, hz, t, rc, ri = 0.2, yBot = -0.4, top, openings = [], step = 1.15, rowStep = 1.1, fillet = 0.16, topFillet = 0,
  batter = 0, wobble = null, tint = null, extraRows = [], crown = 0,
}) {
  const sides = [
    { key: '+z', n: [0, 1], at: (a) => [a, hz], end: hx - rc, dir: 1, inner: (a) => [a, hz - t], lim: hx - t - ri },
    { key: '+x', n: [1, 0], at: (a) => [hx, a], end: hz - rc, dir: -1, inner: (a) => [hx - t, a], lim: hz - t - ri },
    { key: '-z', n: [0, -1], at: (a) => [a, -hz], end: hx - rc, dir: -1, inner: (a) => [a, -hz + t], lim: hx - t - ri },
    { key: '-x', n: [-1, 0], at: (a) => [-hx, a], end: hz - rc, dir: 1, inner: (a) => [-hx + t, a], lim: hz - t - ri },
  ];
  // Stations round the ring: each is { x, z, nx, nz, ix, iz, side, a, s }.
  const cols = [];
  let s = 0;
  let last = null;
  const push = (x, z, nx, nz, ix, iz, side, a) => {
    if (last) s += Math.hypot(x - last[0], z - last[1]);
    last = [x, z];
    cols.push({ x, z, nx, nz, ix, iz, side, a, s });
  };
  sides.forEach((side, si) => {
    const marks = new Set();
    const E = side.end;
    const m = Math.max(1, Math.round((2 * E) / step));
    for (let i = 0; i <= m; i++) marks.add(+(-E + (2 * E * i) / m).toFixed(3));
    for (const o of openings) {
      if (o.side !== side.key) continue;
      const f = o.fillet ?? fillet;
      for (const v of [o.a0, o.a1]) marks.add(+v.toFixed(3));
      for (const v of [o.a0 - f, o.a0 - f * 0.34, o.a1 + f, o.a1 + f * 0.34]) if (f > 0) marks.add(+v.toFixed(3));
    }
    let list = [...marks].filter((v) => v >= -E - 1e-6 && v <= E + 1e-6).sort((u, v) => u - v);
    // Keep only one of any pair that lie almost on top of each other, unless it is an opening's edge.
    const edges = new Set(openings.filter((o) => o.side === side.key).flatMap((o) => [+o.a0.toFixed(3), +o.a1.toFixed(3)]));
    const clean = [];
    for (const v of list) {
      if (clean.length && v - clean[clean.length - 1] < 0.04) {
        if (edges.has(v)) clean[clean.length - 1] = v;
        continue;
      }
      clean.push(v);
    }
    list = side.dir > 0 ? clean : clean.reverse();
    for (const a of list) {
      const [x, z] = side.at(a);
      const ca = THREE.MathUtils.clamp(a, -side.lim, side.lim);
      const [ix, iz] = side.inner(ca);
      push(x, z, side.n[0], side.n[1], ix, iz, side.key, a);
    }
    // The corner to the next side, as an arc on each face.
    const next = sides[(si + 1) % 4];
    const lastA = side.dir > 0 ? E : -E;
    const firstB = next.dir > 0 ? -next.end : next.end;
    const [cx0, cz0] = side.at(lastA);
    const [cx1, cz1] = next.at(firstB);
    const c2 = [Math.sign(cx0 + cx1) * (hx - rc), Math.sign(cz0 + cz1) * (hz - rc)];
    const ic = [Math.sign(cx0 + cx1) * (hx - t - ri), Math.sign(cz0 + cz1) * (hz - t - ri)];
    const K = 4;
    for (let k = 1; k < K; k++) {
      const f = (k / K) * (Math.PI / 2);
      const nx = side.n[0] * Math.cos(f) + next.n[0] * Math.sin(f);
      const nz = side.n[1] * Math.cos(f) + next.n[1] * Math.sin(f);
      push(c2[0] + nx * rc, c2[1] + nz * rc, nx, nz, ic[0] + nx * ri, ic[1] + nz * ri, null, 0);
    }
  });
  // Close the ring with a seam column.
  const seam = { ...cols[0] };
  seam.s = s + Math.hypot(cols[0].x - last[0], cols[0].z - last[1]);
  cols.push(seam);

  // Rows.
  const rowSet = new Set([yBot, 0]);
  const minTop = Math.min(...cols.flatMap((c) => [top(c.x, c.z), top(c.ix, c.iz)]));
  for (let y = 0; y < minTop - 0.2; y += rowStep) rowSet.add(+y.toFixed(3));
  for (const v of extraRows) rowSet.add(+v.toFixed(3));
  for (const o of openings) {
    const f = o.fillet ?? fillet;
    for (const v of [o.y0, o.y1]) rowSet.add(+v.toFixed(3));
    if (f > 0) for (const v of [o.y0 - f, o.y0 - f * 0.34, o.y1 + f, o.y1 + f * 0.34]) rowSet.add(+v.toFixed(3));
  }
  const yEdges = new Set(openings.flatMap((o) => [+o.y0.toFixed(3), +o.y1.toFixed(3)]));
  const rows = [];
  for (const v of [...rowSet].filter((y) => y >= yBot && y < minTop - 0.05).sort((u, v2) => u - v2)) {
    if (rows.length && v - rows[rows.length - 1] < 0.03) {
      if (yEdges.has(v)) rows[rows.length - 1] = v;
      continue;
    }
    rows.push(v);
  }
  const R = rows.length + (topFillet > 0 ? 3 : 1); // the head row(s) are per-column
  const C = cols.length;

  const pos = []; const uv = []; const col = [];
  const out = [0, 0, 0];
  const rectDist = (a, y, o) => {
    const dx = Math.max(o.a0 - a, 0, a - o.a1);
    const dy = Math.max(o.y0 - y, 0, y - o.y1);
    return Math.hypot(dx, dy);
  };
  const pullOf = (d, f) => (d >= f ? 0 : f - Math.sqrt(Math.max(0, f * f - (f - d) * (f - d))));
  const vertex = (c, y, face) => {
    let px; let pz;
    if (face === 'o') { px = c.x; pz = c.z; } else { px = c.ix; pz = c.iz; }
    let off = 0;
    if (face === 'o') off -= batter * Math.max(0, y);
    if (wobble) off += wobble(px, y, pz, face) * (face === 'o' ? 1 : -1);
    let pull = 0;
    if (c.side) {
      for (const o of openings) {
        if (o.side !== c.side) continue;
        const f = o.fillet ?? fillet;
        if (f <= 0) continue;
        const d = rectDist(c.a, y, o);
        if (d <= 0) { pull = Math.max(pull, f); continue; }
        pull = Math.max(pull, pullOf(d, f));
      }
    }
    const headY = top(px, pz);
    if (topFillet > 0) pull = Math.max(pull, pullOf(Math.max(0, headY - y), topFillet));
    off -= pull * (face === 'o' ? 1 : -1) * 1;
    const X = px + c.nx * off;
    const Z = pz + c.nz * off;
    pos.push(X, y, Z);
    uv.push(c.s / b.t.feet[0], y / b.t.feet[1]);
    out[0] = 1; out[1] = 1; out[2] = 1;
    if (tint) tint(X, y, Z, out, face);
    col.push(out[0], out[1], out[2]);
  };
  const rowY = (j, c, face) => {
    if (j < rows.length) return rows[j];
    const h = top(face === 'o' ? c.x : c.ix, face === 'o' ? c.z : c.iz);
    if (topFillet <= 0) return h;
    const k = j - rows.length; // 0, 1, 2: rising to the head on a quarter circle
    return h - topFillet * (1 - [0.45, 0.82, 1][k]);
  };
  for (const face of ['o', 'i']) {
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < C; i++) vertex(cols[i], rowY(j, cols[i], face), face);
    }
  }
  const io = (i, j) => j * C + i;
  const ii = (i, j) => (R + j) * C + i;
  const index = [];
  const inOpening = (i, j) => {
    // Cell (i, j) spans cols i..i+1 and rows j..j+1.
    const c0 = cols[i]; const c1 = cols[i + 1];
    if (!c0.side || c0.side !== c1.side || j >= rows.length - 1) return null;
    const am = (c0.a + c1.a) / 2; const ym = (rows[j] + rows[j + 1]) / 2;
    for (const o of openings) {
      if (o.side === c0.side && am > o.a0 && am < o.a1 && ym > o.y0 && ym < o.y1) return o;
    }
    return null;
  };
  const P3 = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
  const reveal = (a, b2, c, d, o, side) => {
    // a-b on the outer face, d-c on the inner. Measured: its normal has to face the void.
    const pa = P3(a);
    const n = P3(b2).sub(pa).cross(P3(c).sub(pa));
    const cAlong = (o.a0 + o.a1) / 2; const cY = (o.y0 + o.y1) / 2;
    const m = P3(a).add(P3(b2)).multiplyScalar(0.5);
    const ma = side === '+z' || side === '-z' ? m.x : m.z;
    const toVoid = side === '+z' || side === '-z' ? new THREE.Vector3(cAlong - ma, cY - m.y, 0) : new THREE.Vector3(0, cY - m.y, cAlong - ma);
    if (n.dot(toVoid) >= 0) index.push(a, b2, c, a, c, d); else index.push(a, c, b2, a, d, c);
  };
  for (let j = 0; j < R - 1; j++) {
    for (let i = 0; i < C - 1; i++) {
      if (inOpening(i, j)) continue;
      index.push(io(i, j), io(i + 1, j), io(i + 1, j + 1), io(i, j), io(i + 1, j + 1), io(i, j + 1));
      index.push(ii(i, j), ii(i + 1, j + 1), ii(i + 1, j), ii(i, j), ii(i, j + 1), ii(i + 1, j + 1));
      // Any open neighbour needs a reveal along the shared edge.
      const here = cols[i].side;
      const up = inOpening(i, j + 1); const down = j > 0 ? inOpening(i, j - 1) : null;
      if (up) reveal(io(i, j + 1), io(i + 1, j + 1), ii(i + 1, j + 1), ii(i, j + 1), up, here);
      if (down) reveal(io(i, j), io(i + 1, j), ii(i + 1, j), ii(i, j), down, here);
      const right = i < C - 2 ? inOpening(i + 1, j) : null; const left = i > 0 ? inOpening(i - 1, j) : null;
      if (right) reveal(io(i + 1, j), io(i + 1, j + 1), ii(i + 1, j + 1), ii(i + 1, j), right, cols[i + 1].side);
      if (left) reveal(io(i, j), io(i, j + 1), ii(i, j + 1), ii(i, j), left, cols[i].side);
    }
  }
  // The head and the foot.
  const midBase = pos.length / 3;
  for (let i = 0; i < C; i++) {
    const a = io(i, R - 1); const c = ii(i, R - 1);
    pos.push((pos[a * 3] + pos[c * 3]) / 2, (pos[a * 3 + 1] + pos[c * 3 + 1]) / 2 + crown, (pos[a * 3 + 2] + pos[c * 3 + 2]) / 2);
    uv.push((uv[a * 2] + 0.15), uv[a * 2 + 1] + 0.1);
    col.push((col[a * 3] + col[c * 3]) / 2, (col[a * 3 + 1] + col[c * 3 + 1]) / 2, (col[a * 3 + 2] + col[c * 3 + 2]) / 2);
  }
  for (let i = 0; i < C - 1; i++) {
    const o0 = io(i, R - 1); const o1 = io(i + 1, R - 1); const m0 = midBase + i; const m1 = midBase + i + 1; const n0 = ii(i, R - 1); const n1 = ii(i + 1, R - 1);
    index.push(o0, o1, m1, o0, m1, m0, m0, m1, n1, m0, n1, n0);
    const f0 = io(i, 0); const f1 = io(i + 1, 0); const g0 = ii(i, 0); const g1 = ii(i + 1, 0);
    index.push(f0, g1, f1, f0, g0, g1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // The seam column's two copies share one normal.
  const N = g.attributes.normal;
  for (const base of [0, R]) {
    for (let j = 0; j < R; j++) {
      const a = (base + j) * C; const z = a + C - 1;
      const nx = N.getX(a) + N.getX(z); const ny = N.getY(a) + N.getY(z); const nz = N.getZ(a) + N.getZ(z);
      const l = Math.hypot(nx, ny, nz) || 1;
      N.setXYZ(a, nx / l, ny / l, nz / l);
      N.setXYZ(z, nx / l, ny / l, nz / l);
    }
  }
  b.parts.push({ geometry: g, keepColor: true });
}

// ---------------------------------------------------------------------------------------------
// thatchRoof: one closed stack of rings
// ---------------------------------------------------------------------------------------------
// In plan the eave is a superellipse stretched by a ridge of half-length lr, with half-extents ex and
// ez. tp is 0 on the ridge and 1 at the eave. Returns the outer and inner height functions, which is
// how everything laid on it (ridge, spars, rafters, wall heads) asks where the roof is.
function thatchShape({ ex, ez, lr, p = 3.6, yEave, yRidge, q = 1.12, thick = 1.1, warp = null }) {
  const a = ex - lr; const b = ez;
  const outerY = (tp) => yRidge - (yRidge - yEave) * tp ** q;
  const tpAt = (x, z) => {
    const dx = Math.max(0, Math.abs(x) - lr);
    return ((dx / a) ** p + (Math.abs(z) / b) ** p) ** (1 / p);
  };
  const W = (x, y, z, tp) => (warp ? warp(x, y, z, tp) : 0);
  return {
    ex, ez, lr, p, a, b, yEave, yRidge, q, thick, outerY, tpAt,
    outer: (x, z) => { const tp = tpAt(x, z); return outerY(tp) + W(x, 0, z, tp); },
    inner: (x, z) => { const tp = tpAt(x, z); return outerY(tp) - thick + W(x, 0, z, tp); },
    warp: W,
  };
}

function thatchRoof(bg, shape, { colSide = 14, colHip = 16, rows = 18, tint = null } = {}) {
  const { lr, a, b, p, yEave, thick, outerY, warp } = shape;
  const e = 2 / p;
  const planAt = [];
  for (let i = 0; i < colSide; i++) { const x = mix(-lr, lr, i / colSide); planAt.push((tp) => [x, b * tp]); }
  for (let i = 0; i < colHip; i++) {
    const f = Math.PI / 2 - (i / colHip) * Math.PI;
    const c = Math.cos(f); const s = Math.sin(f);
    const px = Math.abs(c) ** e; const pz = Math.sign(s) * Math.abs(s) ** e;
    planAt.push((tp) => [lr + a * tp * px, b * tp * pz]);
  }
  for (let i = 0; i < colSide; i++) { const x = mix(lr, -lr, i / colSide); planAt.push((tp) => [x, -b * tp]); }
  for (let i = 0; i < colHip; i++) {
    const f = -Math.PI / 2 - (i / colHip) * Math.PI;
    const c = Math.cos(f); const s = Math.sin(f);
    const px = Math.abs(c) ** e; const pz = Math.sign(s) * Math.abs(s) ** e;
    planAt.push((tp) => [-lr - a * tp * px, b * tp * pz]);
  }
  const C = planAt.length + 1;
  const us = [0];
  for (let i = 1; i < C; i++) {
    const A = planAt[i - 1](1); const B = planAt[i % planAt.length](1);
    us.push(us[i - 1] + Math.hypot(B[0] - A[0], B[1] - A[1]));
  }
  // The profile, from the ridge down the outside, round the eave roll and back up the underside.
  const prof = [];
  for (let j = 0; j <= rows; j++) prof.push({ tp: 0.965 * (j / rows) ** 0.9, y: null, under: 0 });
  prof.push({ tp: 0.99, y: yEave + 0.1, under: 0.15 });
  prof.push({ tp: 1.0, y: yEave - 0.12, under: 0.5 });
  prof.push({ tp: 0.985, y: yEave - 0.38, under: 0.8 });
  prof.push({ tp: 0.95, y: yEave - 0.46, under: 1 });
  for (let j = 7; j >= 0; j--) {
    const tp = 0.9 * (j / 7);
    prof.push({ tp, y: outerY(tp) - thick, under: 1 });
  }
  for (const r of prof) if (r.y === null) r.y = outerY(r.tp);
  const R = prof.length;
  const pos = []; const uv = []; const col = [];
  let run = 0;
  const out = [0, 0, 0];
  for (let j = 0; j < R; j++) {
    if (j > 0) run += Math.hypot((prof[j].tp - prof[j - 1].tp) * b, prof[j].y - prof[j - 1].y);
    for (let i = 0; i < C; i++) {
      const [x, z] = planAt[i % planAt.length](prof[j].tp);
      const y = prof[j].y + warp(x, prof[j].y, z, prof[j].tp);
      pos.push(x, y, z);
      uv.push(us[i] / bg.t.feet[0], run / bg.t.feet[1]);
      out[0] = 1; out[1] = 1; out[2] = 1;
      if (tint) tint(x, y, z, out, prof[j].tp, prof[j].under);
      col.push(out[0], out[1], out[2]);
    }
  }
  const index = [];
  for (let j = 0; j < R - 1; j++) {
    for (let i = 0; i < C - 1; i++) {
      const A = j * C + i; const B = A + 1; const D = (j + 1) * C + i; const E = D + 1;
      index.push(A, D, E, A, E, B);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const N = g.attributes.normal;
  for (let j = 0; j < R; j++) {
    const a0 = j * C; const z0 = a0 + C - 1;
    const nx = N.getX(a0) + N.getX(z0); const ny = N.getY(a0) + N.getY(z0); const nz = N.getZ(a0) + N.getZ(z0);
    const l = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(a0, nx / l, ny / l, nz / l);
    N.setXYZ(z0, nx / l, ny / l, nz / l);
  }
  bg.parts.push({ geometry: g, keepColor: true });
}

// The block ridge: a sheet that rises out of the thatch and sinks back in along every edge, with a
// zigzag lower border, which is the pattern a thatcher signs a roof with. `half` is how far it runs
// along the ridge either side of the middle.
function thatchRidge(bg, shape, { half, width = 1.25, zig = 1.5, lift = 0.26, color, zigDepth = 0.5, cols = null } = {}) {
  const n = cols ?? Math.round((2 * half) / (zig / 8));
  const m = 10;
  const pos = []; const uv = []; const col = [];
  const base = colorOf(color);
  for (let i = 0; i <= n; i++) {
    const x = -half + (2 * half * i) / n;
    const ph = ((x / zig) % 1 + 1) % 1;
    const tri = Math.abs(ph - 0.5) * 2; // 0..1
    const endFade = 1 - sstep(Math.abs(x), half - 1.4, half);
    const W = width + tri * zigDepth;
    for (let j = 0; j <= m; j++) {
      const w = (j / m) * 2 - 1;
      const z = w * W;
      const edge = 1 - Math.abs(w) ** 5;
      const y = shape.outer(x, z) + (lift * edge - 0.08 * (1 - edge)) * (0.25 + 0.75 * endFade) - (1 - endFade) * 0.1 + edge * 0.05 * Math.cos(x * 2.5);
      pos.push(x, y, z);
      uv.push(z / bg.t.feet[0] + 0.3, x / bg.t.feet[1]);
      const k = 0.92 + 0.14 * (smoothNoise3(x * 0.8, 1.5, z * 0.8) - 0.5);
      col.push(base[0] * k, base[1] * k, base[2] * k);
    }
  }
  const index = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const A = i * (m + 1) + j; const B = A + 1; const D = A + m + 1; const E = D + 1;
      index.push(A, B, E, A, E, D);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Wound upward whichever way the grid came out: a sheet is seen from above only.
  if (g.attributes.normal.getY(Math.floor(m / 2)) < 0) {
    const fl = [];
    for (let t = 0; t < index.length; t += 3) fl.push(index[t], index[t + 2], index[t + 1]);
    g.setIndex(fl);
    g.computeVertexNormals();
  }
  bg.parts.push({ geometry: g, keepColor: true });
}

// Hazel spars pinning a ridge: straight rods laid on the surface in a run of diamonds.
function ridgeSpars(bg, shape, { half, z0, z1 = null, pitch = 1.5, color, lift = 0.34 }) {
  for (let x = -half; x < half - 1e-3; x += pitch) {
    for (const s of [-1, 1]) {
      const a = [x, 0, s * z0]; const c = [x + pitch, 0, s * (z1 ?? z0)];
      a[1] = shape.outer(a[0], a[2]) + lift;
      c[1] = shape.outer(c[0], c[2]) + lift;
      bar(bg, color, a, c, 0.09, 0.07, { flat: true });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Small furnishings every house can share
// ---------------------------------------------------------------------------------------------
function stool(w, x, z, h = 1.5, r = 0.55, color = PAL.timber) {
  turned(w, color, [[0, 0], [r, 0], [r, 0.12], [0, 0.12]], x, h - 0.12, z, { segments: 12 });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    pole(w, times(color, 0.8), [x + Math.cos(a) * r * 0.85, 0.05, z + Math.sin(a) * r * 0.85], [x + Math.cos(a) * r * 0.5, h - 0.1, z + Math.sin(a) * r * 0.5], 0.07, { sides: 5, flat: true });
  }
}

// A table with a real top and four legs. dx, dz are half-extents.
function table(w, x, z, dx, dz, h = 2.5, color = PAL.timber, y0 = 0.05) {
  box(w, color, x - dx, x + dx, h - 0.16, h, z - dz, z + dz, { grain: dx > dz ? 'x' : 'z' });
  const lx = dx - 0.25; const lz = dz - 0.25;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      box(w, times(color, 0.78), x + sx * lx - 0.11, x + sx * lx + 0.11, y0, h - 0.14, z + sz * lz - 0.11, z + sz * lz + 0.11);
    }
  }
  if (h - y0 > 1.8) {
    if (dx > dz) box(w, times(color, 0.7), x - lx, x + lx, y0 + 0.65, y0 + 0.81, z - 0.07, z + 0.07, { grain: 'x' });
    else box(w, times(color, 0.7), x - 0.07, x + 0.07, y0 + 0.65, y0 + 0.81, z - lz, z + lz, { grain: 'z' });
  }
}

function bowl(w, x, y, z, r, color) {
  turned(w, color, [[0, 0], [r * 0.45, 0], [r * 0.78, r * 0.2], [r, r * 0.55], [r * 0.9, r * 0.6], [r * 0.7, r * 0.3], [r * 0.4, r * 0.15], [0, r * 0.13]], x, y, z, { segments: 18 });
}

// A hanging or standing pot, rounded and closed.
function pot(w, x, y, z, r, color, { tint = null } = {}) {
  turned(w, color, [[0, 0], [r * 0.5, 0], [r * 0.78, r * 0.22], [r * 0.95, r * 0.52], [r, r * 0.8], [r * 0.92, r * 1.08], [r * 0.72, r * 1.3], [r * 0.58, r * 1.44], [r * 0.66, r * 1.6], [r * 0.5, r * 1.6], [r * 0.42, r * 1.32], [0, r * 1.25]], x, y, z, { segments: 18, tint });
}

// A plank door leaf: authored from its hinge, swung by `swing` about the vertical. Boards are the
// tile; two ledges and a pair of strap hinges are real. `outSign` says which way its ledges face.
function doorLeaf(w, color, hinge, width, y0, y1, swing, { thick = 0.14, iron = PAL.iron, ledges = 3 } = {}) {
  const dirX = Math.cos(swing); const dirZ = Math.sin(swing);
  const at = (d, y, n) => [hinge[0] + dirX * d - dirZ * n, y, hinge[1] + dirZ * d + dirX * n];
  const boards = Math.max(3, Math.round(width / 0.62));
  const rng = seededRandom(Math.round(hinge[0] * 100 + hinge[1] * 7 + 5));
  for (let i = 0; i < boards; i++) {
    const d0 = (i / boards) * width; const d1 = ((i + 1) / boards) * width;
    const c = jitter(rng, color, 0.1);
    bar(w, c, at((d0 + d1) / 2, y0, 0), at((d0 + d1) / 2, y1, 0), (d1 - d0) - 0.025, thick, { up: [-dirZ, 0, dirX] });
  }
  // A backing so there is no daylight between the boards.
  bar(w, times(color, 0.5), at(width / 2, y0 + 0.02, 0), at(width / 2, y1 - 0.02, 0), width - 0.06, thick * 0.6, { up: [-dirZ, 0, dirX], flat: true });
  const ys = ledges === 3 ? [0.14, 0.5, 0.86] : [0.2, 0.8];
  for (const f of ys) {
    const y = mix(y0, y1, f);
    bar(w, times(color, 0.82), at(0.04, y, thick * 0.6), at(width - 0.04, y, thick * 0.6), 0.09, 0.42, { up: [0, 1, 0] });
  }
  for (const f of [ys[0], ys[ys.length - 1]]) {
    const y = mix(y0, y1, f);
    for (const n of [-1, 1]) bar(w, iron, at(-0.05, y, n * thick * 0.72), at(width * 0.55, y, n * thick * 0.72), 0.03, 0.13, { flat: true });
  }
  pole(w, iron, at(width - 0.2, (y0 + y1) * 0.49, -0.2), at(width - 0.2, (y0 + y1) * 0.49, 0.2), 0.05, { sides: 5, flat: true });
}

// A casement in an opening, in wall coordinates: the pane stands at n, closing the hole, with a frame
// and muntins proud of it on both sides.
function casement(w, side, a0, a1, y0, y1, n, { frame = PAL.dark, glass = PAL.glass, cols = 2, rows = 2, f = 0.14, muntin = 0.05 } = {}) {
  const fT = 0.16;
  sideBox(w, glass, side, a0, a1, y0, y1, n - 0.025, n + 0.025, { flat: true, tint: (x, y, z, out) => { const k = 1.0 + 1.1 * clamp01((y - y0) / (y1 - y0)); out[0] *= k; out[1] *= k * 1.05; out[2] *= k * 1.12; } });
  sideBox(w, frame, side, a0, a1, y0, y0 + f, n - fT, n + fT, { grain: 'h' });
  sideBox(w, frame, side, a0, a1, y1 - f, y1, n - fT, n + fT, { grain: 'h' });
  sideBox(w, frame, side, a0, a0 + f, y0 + f, y1 - f, n - fT, n + fT);
  sideBox(w, frame, side, a1 - f, a1, y0 + f, y1 - f, n - fT, n + fT);
  for (let i = 1; i < cols; i++) {
    const a = mix(a0, a1, i / cols);
    sideBox(w, frame, side, a - muntin, a + muntin, y0 + f, y1 - f, n - 0.07, n + 0.07);
  }
  for (let j = 1; j < rows; j++) {
    const y = mix(y0, y1, j / rows);
    sideBox(w, frame, side, a0 + f, a1 - f, y - muntin, y + muntin, n - 0.07, n + 0.07, { grain: 'h' });
  }
}

// ---------------------------------------------------------------------------------------------
// The thatched cottage
// ---------------------------------------------------------------------------------------------
function thatchedCottage() {
  const rng = seededRandom(1711);
  const walls = bag(rubbleTile());
  const thatch = bag(thatchTile());
  const wood = bag(woodTile());
  const stone = bag(stoneTile(41, { feet: 3.6 }));

  const HX = 10.5; const HZ = 6.5; const T = 1.5;
  const IX = HX - T; const IZ = HZ - T;

  // A dip of a few inches along the ridge and slow lumps: an old roof is never a machined surface.
  const warp = (x, y, z, tp) => {
    const lumps = (smoothNoise3(x * 0.16 + 3, 0.5, z * 0.2) - 0.5) * 0.42 * (0.4 + tp);
    const sag = -0.16 * (1 - (x / 6) ** 2) * (1 - tp);
    return lumps + sag;
  };
  const roof = thatchShape({ ex: 12, ez: 8, lr: 5.4, p: 3.5, yEave: 6.15, yRidge: 15.75, q: 1.14, thick: 1.15, warp });

  const door = { side: '+z', a0: -3.2, a1: -0.2, y0: 0.05, y1: 6.0, fillet: 0.14 };
  const openings = [
    door,
    { side: '+z', a0: 2.9, a1: 5.3, y0: 2.9, y1: 5.0, fillet: 0.16 },
    { side: '+z', a0: -8.0, a1: -5.9, y0: 2.9, y1: 5.0, fillet: 0.16 },
    { side: '-z', a0: 1.4, a1: 3.6, y0: 2.9, y1: 5.0, fillet: 0.16 },
    { side: '+x', a0: -1.1, a1: 1.1, y0: 2.9, y1: 5.0, fillet: 0.16 },
  ];
  const whitewash = times(PAL.white, 1.04);
  const tar = times(0x34302c, 1);
  ribbonWall(walls, {
    hx: HX, hz: HZ, t: T, rc: 1.0, ri: 0.3, top: (x, z) => roof.inner(x, z) + 0.3, openings,
    step: 1.2, rowStep: 1.25, extraRows: [0.75, 0.86],
    wobble: (x, y, z) => (smoothNoise3(x * 0.3, y * 0.4, z * 0.3) - 0.5) * 0.14,
    tint: (x, y, z, out, face) => {
      const n = smoothNoise3(x * 0.35 + 7, y * 0.5, z * 0.35);
      if (face === 'o') {
        // A tarred plinth, which hides the splash from the rain.
        if (y < 0.8) { out[0] = tar[0]; out[1] = tar[1]; out[2] = tar[2]; return; }
        const k = 0.9 + n * 0.16;
        out[0] = whitewash[0] * k; out[1] = whitewash[1] * k; out[2] = whitewash[2] * k;
        // Weather running down from under the eave.
        const stain = sstep(y, 5.0, 7.5) * 0.25;
        out[0] *= 1 - stain * 0.8; out[1] *= 1 - stain; out[2] *= 1 - stain * 1.2;
      } else {
        const k = 0.72 + n * 0.14 + clamp01(1 - y / 7) * 0.08;
        out[0] = whitewash[0] * k; out[1] = whitewash[1] * k * 0.98; out[2] = whitewash[2] * k * 0.93;
      }
    },
  });

  // --- the roof --------------------------------------------------------------------------------
  const straw = times(PAL.thatch, 1.32);
  const under = times(0xa98a58, 1.25);
  thatchRoof(thatch, roof, {
    colSide: 18, colHip: 20, rows: 22,
    tint: (x, y, z, out, tp, u) => {
      const n = smoothNoise3(x * 0.42, y * 0.55, z * 0.42);
      const streak = smoothNoise3(x * 1.1, 2.5, z * 1.1);
      const k = 0.8 + n * 0.28 + (streak - 0.5) * 0.16;
      const age = sstep(tp, 0.55, 1) * 0.3;
      out[0] = mix(straw[0] * k * (1 - age * 0.72), under[0], u);
      out[1] = mix(straw[1] * k * (1 - age), under[1], u);
      out[2] = mix(straw[2] * k * (1 - age * 1.1), under[2], u);
    },
  });
  const ridgeC = times(PAL.wheat, 1.22);
  thatchRidge(thatch, roof, { half: 7.2, width: 1.3, zig: 1.6, zigDepth: 0.55, lift: 0.3, color: ridgeC });
  const hazel = times(0x9a7a4a, 1);
  ridgeSpars(thatch, roof, { half: 6.4, z0: 1.05, z1: 1.05, pitch: 1.6, color: hazel, lift: 0.27 });
  ridgeSpars(thatch, roof, { half: 6.4, z0: 0.5, z1: 0.5, pitch: 1.6, color: hazel, lift: 0.32 });
  for (let x = -6.4; x < 6.3; x += 0.8) {
    const up = Math.round((x + 6.4) / 0.8) % 2 === 0;
    for (const s of [-1, 1]) {
      const z0 = up ? 0.5 : 1.05; const z1 = up ? 1.05 : 0.5;
      bar(thatch, hazel, [x, roof.outer(x, z0) + 0.3, s * z0], [x + 0.8, roof.outer(x + 0.8, z1) + 0.3, s * z1], 0.07, 0.06, { flat: true });
    }
  }

  // --- inside: floor, tie beams and rafters ------------------------------------------------------
  box(stone, times(0x9a9184, 0.95), -IX - 0.1, IX + 0.1, -0.4, 0.05, -IZ - 0.1, IZ + 0.1, { grain: 'z' });
  box(stone, times(0x8f8a7e, 1.02), door.a0 - 0.3, door.a1 + 0.3, -0.4, 0.09, IZ, HZ + 1.25, { grain: 'z' });
  const beam = times(PAL.timber, 1.05);
  for (const x of [-4, 0.2, 4.6]) {
    box(wood, jitter(rng, beam, 0.08), x - 0.28, x + 0.28, 7.05, 7.6, -IZ - 0.4, IZ + 0.4, { grain: 'z' });
    // A king post from the tie up to the ridge pole.
    box(wood, jitter(rng, beam, 0.08), x - 0.16, x + 0.16, 7.5, roof.inner(x, 0) - 0.2, -0.16, 0.16);
  }
  const ridgeY = roof.inner(0, 0);
  box(wood, times(beam, 0.95), -7, 7, ridgeY - 0.5, ridgeY + 0.02, -0.18, 0.18, { grain: 'x' });
  for (const z of [-3.1, 3.1]) box(wood, times(beam, 1.05), -7.2, 7.2, roof.inner(0, z) - 0.32, roof.inner(0, z) + 0.05, z - 0.14, z + 0.14, { grain: 'x' });
  for (let x = -6.6; x <= 6.61; x += 2.2) {
    for (const s of [-1, 1]) {
      const pts = [0.1, 2.4, IZ + 0.3].map((z) => [x, roof.inner(x, z) - 0.06, s * z]);
      bar(wood, jitter(rng, times(PAL.timber, 1.2), 0.1), pts[0], pts[1], 0.2, 0.2, { up: [0, 1, 0] });
      bar(wood, jitter(rng, times(PAL.timber, 1.2), 0.1), pts[1], pts[2], 0.2, 0.2, { up: [0, 1, 0] });
    }
  }

  // --- the door, its frame and the windows --------------------------------------------------------
  const dC = times(0x9a6e42, 1.15);
  const n0 = IZ - 0.04; const n1 = HZ + 0.04;
  const fT = 0.34;
  sideBox(wood, PAL.dark, '+z', door.a0 - 0.08, door.a0 + 0.2, 0.05, door.y1 + 0.04, n1 - fT - 0.08, n1, {});
  sideBox(wood, PAL.dark, '+z', door.a1 - 0.2, door.a1 + 0.08, 0.05, door.y1 + 0.04, n1 - fT - 0.08, n1, {});
  sideBox(wood, PAL.dark, '+z', door.a0 - 0.5, door.a1 + 0.5, door.y1 - 0.08, door.y1 + 0.42, n1 - 1.5, n1 + 0.06, { grain: 'h' });
  // Hung on the inner face and swung well open into the room, so the way in reads as a way in.
  doorLeaf(wood, dC, [door.a0 + 0.14, n0 + 0.1], 2.75, 0.08, door.y1 - 0.12, -1.25);
  for (const o of openings.slice(1)) {
    const mid = o.side === '+z' || o.side === '-z' ? HZ - T * 0.5 : HX - T * 0.42;
    const face = o.side === '+z' || o.side === '-z' ? HZ : HX;
    casement(wood, o.side, o.a0 + 0.02, o.a1 - 0.02, o.y0 + 0.02, o.y1 - 0.02, mid, { frame: 0xcfc6ae, f: 0.13, cols: 2, rows: 3, muntin: 0.035 });
    sideBox(wood, PAL.dark, o.side, o.a0 - 0.35, o.a1 + 0.35, o.y1 - 0.05, o.y1 + 0.32, face - 0.5, face + 0.14, { grain: 'h' });
    sideBox(stone, times(0xa8a294, 1.05), o.side, o.a0 - 0.22, o.a1 + 0.22, o.y0 - 0.2, o.y0 + 0.02, face - T * 0.52, face + 0.24, { flat: true });
    // Inside sill.
    sideBox(wood, times(PAL.timber, 0.9), o.side, o.a0 - 0.1, o.a1 + 0.1, o.y0 - 0.1, o.y0 + 0.01, face - T - 0.14, face - T * 0.5, { grain: 'h' });
  }
  // A window box under each front window: the one saturated thing on the elevation.
  for (const o of [openings[1], openings[2]]) {
    const a0 = o.a0 - 0.1; const a1 = o.a1 + 0.1;
    sideBox(wood, times(0x4f6d3c, 0.85), '+z', a0, a1, o.y0 - 0.86, o.y0 - 0.3, HZ + 0.1, HZ + 0.75, { grain: 'h' });
    const cnt = Math.round((a1 - a0) / 0.26);
    for (let i = 0; i < cnt; i++) {
      const a = mix(a0 + 0.1, a1 - 0.1, (i + 0.5) / cnt);
      const leaf = rng() < 0.5;
      const y = o.y0 - 0.26 + rng() * 0.14; const n = HZ + 0.26 + rng() * 0.36;
      const c = leaf ? jitter(rng, PAL.leaf, 0.2) : (rng() < 0.6 ? jitter(rng, 0xc8402f, 0.12) : jitter(rng, 0xe0b23a, 0.1));
      bead(wood, c, a, y, n, leaf ? 0.2 : 0.13);
    }
  }

  // --- the chimney and hearth at the -X end ---------------------------------------------------------
  const cx0 = -IX - 0.02; // the breast is built against the inner face and carried through the roof
  const rough = (x, y, z, out) => { const k = 0.82 + smoothNoise3(x * 0.9, y * 0.8, z * 0.9) * 0.42; out[0] *= k; out[1] *= k; out[2] *= k; };
  const sC = times(PAL.stone, 1.25);
  const soot = times(0x5e5248, 1);
  const open = { z: 1.55, top: 3.9, deep: 1.7 };
  // The two jambs, the back and the mass above the fire. The fire is a real void.
  box(stone, sC, cx0, cx0 + 2.7, 0.05, open.top, -open.z - 1.0, -open.z, { tint: rough });
  box(stone, sC, cx0, cx0 + 2.7, 0.05, open.top, open.z, open.z + 1.0, { tint: rough });
  box(stone, soot, cx0, cx0 + 0.8, 0.05, open.top + 0.2, -open.z - 0.02, open.z + 0.02, { flat: true });
  box(stone, sC, cx0, cx0 + 2.7, open.top + 0.5, 6.3, -open.z - 1.0, open.z + 1.0, { tint: rough, segs: [1, 2, 3] });
  box(stone, soot, cx0 + 0.8, cx0 + 2.6, open.top + 0.1, open.top + 0.52, -open.z - 0.02, open.z + 0.02, { flat: true });
  box(wood, times(0x4a3522, 1), cx0 + 2.3, cx0 + 2.86, open.top - 0.05, open.top + 0.55, -open.z - 1.15, open.z + 1.15, { grain: 'z' });
  // The hood tapers into the stack, which rises through the thatch.
  const stack = { x0: cx0 + 0.15, x1: cx0 + 2.15, z: 1.1, top: 17.1 };
  prism(stone, sC, [[-open.z - 1.0, 6.3], [open.z + 1.0, 6.3], [stack.z, 8.3], [-stack.z, 8.3]], 'x', cx0, cx0 + 2.55, { tint: rough, flat: false });
  box(stone, times(PAL.stone, 1.18), stack.x0, stack.x1, 8.2, stack.top, -stack.z, stack.z, { tint: rough, segs: [2, 8, 2] });
  box(stone, times(PAL.stone, 1.05), stack.x0 - 0.16, stack.x1 + 0.16, stack.top, stack.top + 0.24, -stack.z - 0.16, stack.z + 0.16, {});
  box(stone, times(PAL.stone, 1.05), stack.x0 - 0.16, stack.x1 + 0.16, 13.0, 13.22, -stack.z - 0.16, stack.z + 0.16, {});
  for (const dz of [-0.48, 0.48]) {
    turned(wood, 0xa8583a, [[0, 0], [0.36, 0], [0.3, 0.55], [0.25, 0.86], [0.33, 0.95], [0.33, 1.05], [0.18, 1.05], [0.17, 0.5], [0, 0.45]], (stack.x0 + stack.x1) / 2, stack.top + 0.24, dz, { segments: 10 });
  }
  // The hearth stone, three logs, the embers under them, a crane and a pot.
  box(stone, times(0x77726a, 1.05), cx0 + 0.4, cx0 + 3.8, 0.05, 0.14, -open.z - 1.0, open.z + 1.0, { grain: 'z' });
  softBox(wood, times(0xb8481a, 1), cx0 + 1.5, 0.19, 0, 0.42, 0.08, 0.7, 0.07, { segs: [3, 2, 4] });
  for (const [a, dy] of [[-0.3, 0.3], [0.3, 0.3], [0.05, 0.56]]) {
    pole(wood, times(0x7a5c3e, 1), [cx0 + 1.5 + a * 0.5, 0.05 + dy, -0.95 + a], [cx0 + 1.5 - a * 0.3, 0.05 + dy, 0.95 + a * 0.4], 0.17, { sides: 7 });
  }
  pole(wood, PAL.iron, [cx0 + 0.9, 0.2, open.z - 0.2], [cx0 + 0.9, 3.4, open.z - 0.2], 0.05, { sides: 5, flat: true });
  pole(wood, PAL.iron, [cx0 + 0.9, 3.05, open.z - 0.2], [cx0 + 1.5, 3.05, -0.05], 0.04, { sides: 5, flat: true });
  pole(wood, PAL.iron, [cx0 + 1.5, 3.05, -0.05], [cx0 + 1.5, 2.25, -0.05], 0.025, { sides: 4, flat: true });
  pot(wood, cx0 + 1.5, 1.45, -0.05, 0.52, 0x2a2826);

  // --- the room -------------------------------------------------------------------------------
  // The table by the window, with its benches.
  table(wood, 3.1, 1.6, 2.7, 1.25, 2.55, times(PAL.timber, 1.08));
  box(wood, times(PAL.timber, 0.95), 0.9, 5.3, 1.45, 1.6, -0.45, 0.25, { grain: 'x' });
  for (const x of [1.3, 4.9]) box(wood, times(PAL.timber, 0.75), x - 0.1, x + 0.1, 0.05, 1.45, -0.32, 0.12);
  stool(wood, 0.0, 1.5, 1.5, 0.55, times(PAL.timber, 0.95));
  bowl(wood, 2.3, 2.55, 1.5, 0.48, 0xb9894f);
  softBox(wood, 0xb5803f, 3.9, 2.72, 1.75, 0.5, 0.17, 0.3, 0.14, { segs: [4, 3, 4] });
  pot(wood, 4.8, 2.55, 1.3, 0.24, 0x8f5535);
  // The bed in the far corner: a boxed frame, a straw tick, a quilt, a bolster.
  const bx0 = 5.7; const bx1 = IX - 0.05; const bz0 = -IZ + 0.05; const bz1 = bz0 + 6.3;
  box(wood, times(PAL.dark, 1.15), bx0, bx0 + 0.2, 0.05, 2.0, bz1 - 0.2, bz1);
  box(wood, times(PAL.dark, 1.15), bx1 - 0.2, bx1, 0.05, 2.9, bz1 - 0.2, bz1);
  box(wood, times(PAL.dark, 1.15), bx0, bx0 + 0.2, 0.05, 2.0, bz0, bz0 + 0.2);
  box(wood, times(PAL.dark, 1.15), bx0, bx1, 0.7, 1.1, bz1 - 0.2, bz1, { grain: 'x' });
  box(wood, times(PAL.dark, 1.15), bx0, bx0 + 0.2, 0.7, 1.1, bz0, bz1, { grain: 'z' });
  softBox(wood, times(0xd8cca8, 0.9), (bx0 + bx1) / 2 + 0.08, 1.35, (bz0 + bz1) / 2, (bx1 - bx0) / 2 - 0.2, 0.34, (bz1 - bz0) / 2 - 0.2, 0.2, { segs: [4, 3, 6] });
  softBox(wood, 0xd8cca8, (bx0 + bx1) / 2 + 0.08, 1.63, (bz0 + bz1) / 2 + 0.75, (bx1 - bx0) / 2 - 0.12, 0.17, (bz1 - bz0) / 2 - 0.92, 0.1, {
    segs: [7, 3, 9],
    perFace: (x, y, z, out) => {
      const i = Math.floor((x + 40) / 0.5); const j = Math.floor((z + 40) / 0.56);
      const c = [lin(0xa23b2a), lin(0xd8cca8), lin(0x2f6fae), lin(0xd9b24a), lin(0xd8cca8)][(i * 7 + j * 3) % 5];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    },
  });
  softBox(wood, times(0xe4dcc8, 0.92), (bx0 + bx1) / 2 + 0.05, 1.82, bz0 + 0.72, (bx1 - bx0) / 2 - 0.4, 0.2, 0.42, 0.16, { segs: [4, 3, 3] });
  // A chest at the bed's foot and a shelf of pots on the back wall.
  softBox(wood, times(PAL.timber, 0.85), 7.35, 0.85, 2.05, 1.25, 0.8, 0.8, 0.05, { segs: [3, 3, 3], flat: false, grain: 'x' });
  box(wood, PAL.iron, 6.5, 6.65, 0.05, 1.62, 1.22, 2.88, { flat: true });
  box(wood, PAL.iron, 8.05, 8.2, 0.05, 1.62, 1.22, 2.88, { flat: true });
  box(wood, times(PAL.timber, 0.9), -3.8, -0.8, 4.7, 4.82, -IZ - 0.1, -IZ + 0.72, { grain: 'x' });
  pot(wood, -3.3, 4.82, -IZ + 0.4, 0.26, 0xa8583a);
  pot(wood, -2.4, 4.82, -IZ + 0.38, 0.2, 0x88705a);
  bowl(wood, -1.5, 4.82, -IZ + 0.38, 0.32, 0xb9894f);

  return assemble([[walls, {}], [thatch, {}], [wood, {}], [stone, {}]]);
}

// ---------------------------------------------------------------------------------------------
// More tiles
// ---------------------------------------------------------------------------------------------
function boardTile(seed = 51) {
  const rng = seededRandom(seed);
  return tile(256, 512, [3.2, 6.4], (ctx, W, H) => {
    const n = 4;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = grey(218 + rng() * 34, 1, 2);
      ctx.fillRect(i * bw, 0, bw, H);
      for (let k = 0; k < 26; k++) {
        const x = i * bw + 4 + rng() * (bw - 8); const amp = 0.5 + rng() * 2; const ph = rng() * 6.28;
        ctx.strokeStyle = grey(150 + rng() * 80, 0.25 + rng() * 0.35, 4);
        ctx.lineWidth = 0.6 + rng();
        ctx.beginPath();
        for (let y = 0; y <= H; y += 32) { const px = x + Math.sin((y / H) * 6.283 * 2 + ph) * amp; if (y) ctx.lineTo(px, y); else ctx.moveTo(px, y); }
        ctx.stroke();
      }
      // The shadow line of the batten gap, the thing that says "boards" from across the yard.
      ctx.fillStyle = 'rgba(30,20,14,0.85)';
      ctx.fillRect(i * bw, 0, 3.2, H);
      ctx.fillStyle = 'rgba(30,20,14,0.28)';
      ctx.fillRect(i * bw + 3.2, 0, 3, H);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(i * bw + bw - 2, 0, 2, H);
    }
  }, 1.2, null);
}

function shingleTile(seed = 61) {
  const rng = seededRandom(seed);
  return tile(256, 256, [3, 3], (ctx, W, H) => {
    ctx.fillStyle = '#857e70';
    ctx.fillRect(0, 0, W, H);
    const rows = 4;
    const rh = H / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rng() * 30;
      while (x < W) {
        const w = 20 + rng() * 22;
        const v = 202 + rng() * 44;
        const drop = (rng() - 0.3) * 4;
        for (const dx of [-W, 0, W]) {
          ctx.fillStyle = grey(v, 1, 3);
          ctx.fillRect(x + dx + 1, r * rh - 2, w - 2, rh + 2 + drop);
          // Grain down each shingle.
          ctx.strokeStyle = grey(v - 40, 0.5);
          ctx.lineWidth = 0.7;
          for (let k = 0; k < 3; k++) {
            const px = x + dx + 4 + ((k + 0.3) / 3) * (w - 8);
            ctx.beginPath(); ctx.moveTo(px, r * rh); ctx.lineTo(px + 1, r * rh + rh * 0.8); ctx.stroke();
          }
          // The butt of the row above throws a shadow on this one's head.
          ctx.fillStyle = 'rgba(22,16,12,0.3)';
          ctx.fillRect(x + dx + 1, r * rh + rh * 0.8 + drop * 0.5, w - 2, rh * 0.2);
        }
        x += w;
      }
    }
  }, 1.5, null);
}

// Grain along u (the log's length), v 0 to 0.78 round it. The top left fifth is a sawn end, so a log's
// butt shows its rings. u wraps, v never leaves its band.
function logAtlas(seed = 71) {
  const rng = seededRandom(seed);
  const t = tile(512, 512, [8, 1], (ctx, W, H) => {
    ctx.fillStyle = '#e6dece';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      const y = H * 0.22 + rng() * H * 0.78; const x = rng() * W; const len = 40 + rng() * 170;
      ctx.strokeStyle = grey(120 + rng() * 120, 0.2 + rng() * 0.4, 8);
      ctx.lineWidth = 0.7 + rng() * 1.5;
      const bow = (rng() - 0.5) * 7;
      for (const dx of [-W, 0, W]) {
        ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.quadraticCurveTo(x + dx + len / 2, y + bow, x + dx + len, y); ctx.stroke();
      }
    }
    // Drying checks: a few long dark splits.
    for (let i = 0; i < 26; i++) {
      const y = H * 0.24 + rng() * H * 0.74; const x = rng() * W; const len = 80 + rng() * 240;
      ctx.strokeStyle = 'rgba(40,28,18,0.7)';
      ctx.lineWidth = 1 + rng() * 1.6;
      for (const dx of [-W, 0, W]) { ctx.beginPath(); ctx.moveTo(x + dx, y); ctx.lineTo(x + dx + len, y + (rng() - 0.5) * 4); ctx.stroke(); }
    }
    // The sawn end.
    const D = W * 0.2; const cx = D / 2; const cy = D / 2;
    ctx.fillStyle = '#efe0c0';
    ctx.fillRect(0, 0, D, D);
    for (let r = 4; r < D / 2; r += 4 + rng() * 3) {
      ctx.strokeStyle = `rgba(120,84,48,${0.3 + rng() * 0.35})`;
      ctx.lineWidth = 1 + rng();
      ctx.beginPath(); ctx.ellipse(cx + (rng() - 0.5) * 2, cy + (rng() - 0.5) * 2, r, r * (0.94 + rng() * 0.06), 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(50,34,20,0.75)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      const a = rng() * 6.28;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 4, cy + Math.sin(a) * 4); ctx.lineTo(cx + Math.cos(a) * (D * 0.42), cy + Math.sin(a) * (D * 0.42)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70,50,30,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, D / 2 - 2, 0, Math.PI * 2); ctx.stroke();
  }, 0.9, null);
  return t;
}

function plasterTile(seed = 81) {
  const rng = seededRandom(seed);
  return tile(256, 256, [5, 5], (ctx, W, H) => {
    ctx.fillStyle = '#efe9df';
    ctx.fillRect(0, 0, W, H);
    // A hand's sweep: broad, soft, overlapping, every way, and far too faint to read as a pattern.
    // Drawn any stronger this reads as snakeskin, and the whole wall stops being mud.
    for (let i = 0; i < 90; i++) {
      const x = rng() * W; const y = rng() * H; const r = 26 + rng() * 60; const a = rng() * 6.28;
      ctx.strokeStyle = rng() < 0.5 ? `rgba(255,252,244,${0.04 + rng() * 0.06})` : `rgba(150,128,102,${0.02 + rng() * 0.05})`;
      ctx.lineWidth = 10 + rng() * 22;
      for (const dx of [-W, 0, W]) {
        for (const dy of [-H, 0, H]) {
          ctx.beginPath(); ctx.arc(x + dx, y + dy, r, a, a + 0.8 + rng() * 1.2); ctx.stroke();
        }
      }
    }
    // Chopped straw in the mud.
    for (let i = 0; i < 170; i++) {
      const x = rng() * W; const y = rng() * H; const a = rng() * 6.28; const l = 3 + rng() * 7;
      ctx.strokeStyle = rng() < 0.6 ? 'rgba(255,240,190,0.55)' : 'rgba(90,66,40,0.3)';
      ctx.lineWidth = 0.8 + rng() * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = grey(rng() < 0.5 ? 175 : 252, 0.3, 6);
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 2, 1 + rng() * 2);
    }
  }, 0.8, '#efe9df');
}

function weaveTile() {
  return tile(256, 256, [1.6, 1.6], (ctx, W, H) => {
    ctx.fillStyle = '#5a5140';
    ctx.fillRect(0, 0, W, H);
    const n = 8;
    const s = W / n;
    const rng = seededRandom(91);
    // A 2/2 twill, the diagonal that makes split bamboo matting read as woven from a distance.
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const over = (i + j) % 4 < 2;
        const v = 214 + rng() * 40;
        ctx.fillStyle = grey(v, 1, 5);
        if (over) ctx.fillRect(i * s - s * 0.1, j * s + 1.5, s * 1.2, s - 3);
        else ctx.fillRect(i * s + 1.5, j * s - s * 0.1, s - 3, s * 1.2);
        ctx.fillStyle = 'rgba(70,50,28,0.2)';
        if (over) ctx.fillRect(i * s, j * s + s - 7, s, 5);
        else ctx.fillRect(i * s + s - 7, j * s, 5, s);
      }
    }
  }, 1.2, null);
}

function strawTile(seed = 95) {
  const rng = seededRandom(seed);
  return tile(256, 256, [3, 3], (ctx, W, H) => {
    ctx.fillStyle = '#a89e84';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 3000; i++) {
      const x = rng() * W; const y = rng() * H; const a = rng() * 6.28; const l = 8 + rng() * 26;
      ctx.strokeStyle = grey(165 + rng() * 90, 0.5 + rng() * 0.5, 6);
      ctx.lineWidth = 0.8 + rng() * 1.2;
      for (const dx of [-W, 0, W]) {
        for (const dy of [-H, 0, H]) {
          if (x + dx < -40 || x + dx > W + 40 || y + dy < -40 || y + dy > H + 40) continue;
          ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(x + dx + Math.cos(a) * l, y + dy + Math.sin(a) * l); ctx.stroke();
        }
      }
    }
  }, 1.5, null);
}

// ---------------------------------------------------------------------------------------------
// More solids
// ---------------------------------------------------------------------------------------------
// The rectangles left of a span once holes have been taken out of it. Every wall with a door in it.
function rectsAround(a0, a1, y0, y1, holes) {
  const cuts = [a0, a1];
  for (const h of holes) { if (h.a0 > a0 && h.a0 < a1) cuts.push(h.a0); if (h.a1 > a0 && h.a1 < a1) cuts.push(h.a1); }
  cuts.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const p = cuts[i]; const q = cuts[i + 1];
    if (q - p < 1e-4) continue;
    const m = (p + q) / 2;
    const here = holes.filter((h) => m > h.a0 && m < h.a1).sort((u, v) => u.y0 - v.y0);
    let y = y0;
    for (const h of here) {
      if (h.y0 > y) out.push([p, q, y, Math.min(h.y0, y1)]);
      y = Math.max(y, h.y1);
    }
    if (y < y1) out.push([p, q, y, y1]);
  }
  return out;
}

// A round log, closed, with sawn ends showing their rings from the atlas. Along X or Z, at (y, c).
function log(b, color, axis, a0, a1, y, c, r, rng, { step = 4, sides = 10, capA = true, capB = true, bulge = 0.05 } = {}) {
  const len = a1 - a0;
  const n = Math.max(2, Math.round(len / step));
  const seed = rng() * 90;
  const uOff = rng();
  const base = colorOf(color);
  const tone = 0.86 + rng() * 0.28;
  const pos = []; const uv = []; const col = []; const index = [];
  const ptAt = (a, th, rad, dy, dc) => (axis === 'x' ? [a, y + dy + Math.cos(th) * rad, c + dc + Math.sin(th) * rad] : [c + dc + Math.sin(th) * rad, y + dy + Math.cos(th) * rad, a]);
  const taper = (f) => 1 + (0.5 - f) * 0.08;
  const centre = (f) => [(smoothNoise3(seed, f * 2.2, 0.5) - 0.5) * 0.09, (smoothNoise3(seed, f * 2.2, 4.5) - 0.5) * 0.09];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const a = a0 + len * f;
    const [dy, dc] = centre(f);
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const rad = r * taper(f) * (1 + (smoothNoise3(seed + 3, f * 2.5, j * 0.45) - 0.5) * bulge * 2);
      const p = ptAt(a, th, rad, dy, dc);
      pos.push(p[0], p[1], p[2]);
      uv.push(a / b.t.feet[0] + uOff, 0.02 + (j / sides) * 0.74);
      const shade = tone * (0.9 + 0.2 * smoothNoise3(a * 0.4 + seed, j * 0.3, 2.5));
      col.push(base[0] * shade, base[1] * shade, base[2] * shade);
    }
  }
  const flip = axis === 'z';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < sides; j++) {
      const A = i * (sides + 1) + j; const B = A + 1; const C = A + sides + 1; const D = C + 1;
      if (flip) index.push(A, C, D, A, D, B); else index.push(A, B, D, A, D, C);
    }
  }
  const g0 = new THREE.BufferGeometry();
  g0.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g0.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g0.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g0.setIndex(index);
  g0.computeVertexNormals();
  // The seam column.
  const N = g0.attributes.normal;
  for (let i = 0; i <= n; i++) {
    const a = i * (sides + 1); const z = a + sides;
    const nx = N.getX(a) + N.getX(z); const ny = N.getY(a) + N.getY(z); const nz = N.getZ(a) + N.getZ(z);
    const l = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(a, nx / l, ny / l, nz / l); N.setXYZ(z, nx / l, ny / l, nz / l);
  }
  b.parts.push({ geometry: g0, keepColor: true });
  // Sawn ends as their own fans, flat-shaded, mapped to the rings.
  const cap = (at, ok, f, sign) => {
    if (!ok) return;
    const [dy, dc] = centre(f);
    const P = []; const UV = []; const C = []; const NN = []; const I = [];
    const m = axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
    const end = 0.62 + rng() * 0.5;
    const cc = ptAt(at, 0, 0, dy, dc);
    P.push(cc[0], cc[1], cc[2]); UV.push(0.1, 0.9); NN.push(...m); C.push(base[0] * 1.5 * end, base[1] * 1.45 * end, base[2] * 1.35 * end);
    for (let j = 0; j < sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const rr = r * taper(f) * (1 + (smoothNoise3(seed + 3, f * 2.5, j * 0.45) - 0.5) * bulge * 2);
      const p = ptAt(at, th, rr, dy, dc);
      P.push(p[0], p[1], p[2]);
      UV.push(0.1 + Math.sin(th) * 0.095, 0.9 + Math.cos(th) * 0.095);
      NN.push(...m);
      C.push(base[0] * 1.5 * end, base[1] * 1.45 * end, base[2] * 1.35 * end);
    }
        for (let j = 0; j < sides; j++) {
      const q = 1 + j; const w = 1 + (j + 1) % sides;
      const wantForward = (axis === 'x') === (sign > 0);
      if (wantForward) I.push(0, q, w); else I.push(0, w, q);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(NN, 3));
    g.setIndex(I);
    b.parts.push({ geometry: g, keepColor: true });
  };
  cap(a1, capB, 1, 1);
  cap(a0, capA, 0, -1);
}

// A round beam with rounded tips, from ModelKit's closed tube, its UVs mirrored round the section so
// there is no seam for the grain to jump across.
function roundedPole(b, color, a, c, r, { r2 = null, sides = 9, steps = 3, round = 1, tint = null, flat = false } = {}) {
  const g = tube([a, c], [r, r2 ?? r], { sides, steps, round, straight: true });
  const P = g.attributes.position;
  const uv = new Float32Array(P.count * 2);
  const A = V(a); const dir = V(c).sub(A).normalize();
  const side = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3().crossVectors(dir, side).normalize();
  const u2 = new THREE.Vector3().crossVectors(dir, s).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i).sub(A);
    const along = v.dot(dir);
    const th = Math.abs(Math.atan2(v.dot(s), v.dot(u2)));
    if (flat) { uv[i * 2] = b.t.flat[0]; uv[i * 2 + 1] = b.t.flat[1]; } else { uv[i * 2] = (th * r) / b.t.feet[0]; uv[i * 2 + 1] = along / b.t.feet[1]; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  paintColor(g, color, tint);
  b.parts.push({ geometry: g, keepColor: true });
}

// A hand-built stone stack: subdivided so the edges wander instead of ruling a line.
function rubbleBox(b, color, x0, x1, y0, y1, z0, z1, { rough = 0.07, step = 1, tint = null } = {}) {
  const sx = Math.max(1, Math.round((x1 - x0) / step)); const sy = Math.max(1, Math.round((y1 - y0) / step)); const sz = Math.max(1, Math.round((z1 - z0) / step));
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, sx, sy, sz);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.clearGroups();
  projectUV(g, b.t, 'y', false);
  const P = g.attributes.position;
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i); const y = P.getY(i); const z = P.getZ(i);
    const nx = smoothNoise3(y * 0.8 + 3, z * 0.8, x * 0.8) - 0.5;
    const nz = smoothNoise3(x * 0.8, y * 0.8 + 8, z * 0.8) - 0.5;
    P.setXYZ(i, x + nx * rough * 2, y, z + nz * rough * 2);
  }
  g.computeVertexNormals();
  paintColor(g, color, tint ?? ((x, y, z, out) => { const k = 0.82 + smoothNoise3(x * 0.8, y * 0.8, z * 0.8) * 0.4; out[0] *= k; out[1] *= k; out[2] *= k; }));
  b.parts.push({ geometry: g, keepColor: true });
}

function ladder(w, color, a, c, width, rungs, { r = 0.11, rr = 0.07, axis = 'x', flat = false, round = false } = {}) {
  // a and c are the rail mid-line's foot and head. Rails offset along `axis`.
  const off = axis === 'x' ? [width / 2, 0, 0] : [0, 0, width / 2];
  for (const s of [-1, 1]) {
    const p = [a[0] + off[0] * s, a[1] + off[1] * s, a[2] + off[2] * s];
    const q = [c[0] + off[0] * s, c[1] + off[1] * s, c[2] + off[2] * s];
    if (round) roundedPole(w, jitter(seededRandom(7 + s), color, 0.06), p, q, r, { sides: 7, steps: 2, flat });
    else pole(w, color, p, q, r, { sides: 7, flat });
  }
  const yMax = Math.max(a[1], c[1]);
  for (let i = 0; i < rungs; i++) {
    const y = 0.9 + i * ((yMax - 1.5) / (rungs - 1 || 1));
    const f = (y - a[1]) / (c[1] - a[1]);
    const m = [mix(a[0], c[0], f), y, mix(a[2], c[2], f)];
    pole(w, times(color, 0.9), [m[0] - off[0] * 1.08, m[1], m[2] - off[2] * 1.08], [m[0] + off[0] * 1.08, m[1], m[2] + off[2] * 1.08], rr, { sides: 6, flat });
  }
}

// Boards laid horizontally with a real gap between them, a stall wall in other words. Along X or Z,
// centred on `c`, `n` boards from y0 up to y1.
function plankWall(w, color, axis, a0, a1, y0, y1, c, rng, { n = 6, thick = 0.16 } = {}) {
  const h = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const col = jitter(rng, color, 0.13);
    const yA = y0 + i * h + 0.025; const yB = y0 + (i + 1) * h - 0.025;
    if (axis === 'x') box(w, col, a0, a1, yA, yB, c - thick / 2, c + thick / 2, { grain: 'x' });
    else box(w, col, c - thick / 2, c + thick / 2, yA, yB, a0, a1, { grain: 'z' });
  }
}

// ---------------------------------------------------------------------------------------------
// The log cabin
// ---------------------------------------------------------------------------------------------
function logCabin() {
  const rng = seededRandom(1643);
  const logs = bag(logAtlas());
  const wood = bag(woodTile(13));
  const roofB = bag(shingleTile());
  const stone = bag(stoneTile(43, { feet: 3.4, joint: '#6f6a5e' }));

  // The wall centre lines. The stack is off to -X and the porch to +Z, so the whole building is
  // what is centred on the origin and measures 20 by 16, not the room.
  const xW = -7.3; const xE = 9.05; const zB = -6.85; const zF = 3.15;
  const zc = (zB + zF) / 2;
  const R = 0.39; const D = 0.84; const Y0 = 0.46; const N = 10; const EXT = 0.84;
  const logC = times(PAL.timber, 1.32);
  const chink = times(0xe4dcc8, 0.86);
  const door = { side: 'F', a0: -0.65, a1: 2.3, y0: 0, y1: 6.74 };
  const win1 = { side: 'F', a0: 4.5, a1: 6.9, y0: 3.4, y1: 5.9 };
  const win2 = { side: 'B', a0: -2.6, a1: -0.4, y0: 3.4, y1: 5.9 };
  const win3 = { side: 'E', a0: -3.0, a1: -0.7, y0: 2.99, y1: 5.49 };
  const hearth = { side: 'W', a0: zc - 1.45, a1: zc + 1.45, y0: 0, y1: 3.81 };
  const holes = { F: [door, win1], B: [win2], E: [win3], W: [hearth] };
  const spans = (side, a0, a1, y) => {
    const hs = holes[side].filter((h) => y + R > h.y0 + 0.02 && y - R < h.y1 - 0.02).sort((p, q) => p.a0 - q.a0);
    const out = [];
    let a = a0;
    for (const h of hs) { out.push([a, h.a0]); a = h.a1; }
    out.push([a, a1]);
    return out;
  };
  for (let i = 0; i < N; i++) {
    const y = Y0 + i * D;
    const x0 = xW - EXT; const x1 = xE + EXT;
    for (const [side, z] of [['F', zF], ['B', zB]]) {
      for (const [p, q] of spans(side, x0, x1, y)) {
        log(logs, logC, 'x', p, q, y, z, R, rng, { capA: p === x0, capB: q === x1 });
      }
    }
    const yz = Y0 + (i + 0.5) * D;
    // The top end-wall logs would run straight out through the roof slope, so they stop under it.
    const w = (13 - 0.36 - (yz + R)) / 0.84 - 0.06;
    const z0 = Math.max(zB - EXT, zc - w); const z1 = Math.min(zF + EXT, zc + w);
    for (const [side, x] of [['W', xW], ['E', xE]]) {
      for (const [p, q] of spans(side, z0, z1, yz)) {
        log(logs, logC, 'z', p, q, yz, x, R, rng, { capA: p === z0, capB: q === z1 });
      }
    }
  }
  // The half-logs the end walls sit on.
  for (const x of [xW, xE]) log(logs, logC, 'z', zB - EXT, zF + EXT, Y0 - 0.5 * D, x, R, rng);

  // The chinking: a pale wall on the centre plane, showing as a band between each round log and the
  // next. Wall to the head of the top log, with the same openings, so no room can be seen through.
  const ctop = Y0 + (N - 1) * D + 0.2;
  const ct = 0.16;
  const chinkTint = (x, y, z, out) => { const k = 0.9 + 0.2 * smoothNoise3(x * 0.7, y * 1.4, z * 0.7); out[0] *= k; out[1] *= k; out[2] *= k; };
  for (const [side, c] of [['F', zF], ['B', zB]]) {
    for (const [p, q, y0, y1] of rectsAround(xW, xE, 0.2, ctop, holes[side])) box(wood, chink, p, q, y0, y1, c - ct, c + ct, { flat: true, tint: chinkTint });
  }
  const ctopZ = Y0 + (N - 0.5) * D + 0.2;
  for (const [side, c] of [['W', xW], ['E', xE]]) {
    for (const [p, q, y0, y1] of rectsAround(zB, zF, 0.2, ctopZ, holes[side])) box(wood, chink, c - ct, c + ct, y0, y1, p, q, { flat: true, tint: chinkTint });
  }

  // --- gables: shorter logs climbing the roof, on a pale triangle --------------------------------
  const RIDGE = 13; const PITCH = 0.84; const SLAB = 0.36;
  const under = (z) => RIDGE - SLAB - Math.abs(z - zc) * PITCH;
  for (const x of [xW, xE]) {
    prism(wood, chink, [[zc - 5.1, ctopZ - 0.1], [zc + 5.1, ctopZ - 0.1], [zc, under(zc) + 0.05]], 'x', x - ct, x + ct, { flat: true });
    for (let k = 1; k < 7; k++) {
      const y = Y0 + (N - 0.5 + k) * D;
      const w = (RIDGE - SLAB - (y + R)) / PITCH - 0.08;
      if (w < 0.5) break;
      log(logs, logC, 'z', zc - w, zc + w, y, x, R, rng, { step: 3 });
    }
  }
  // The ridge pole and the purlins run out past both gables, which is half of a cabin's face.
  const xRoof0 = -8.0; const xRoof1 = 10;
  log(logs, logC, 'x', xRoof0 - 0.0, xRoof1 - 0.05, under(zc) - 0.36, zc, 0.33, rng, { step: 5 });
  for (const s of [-1, 1]) {
    const z = zc + s * 2.75;
    log(logs, logC, 'x', xRoof0, xRoof1 - 0.05, under(z) - 0.33, z, 0.3, rng, { step: 5 });
  }

  // --- the roof ------------------------------------------------------------------------------------
  const yBack = RIDGE - (zc + 8) * PITCH;
  const zBreak = 4.3; const yBreak = RIDGE - (zBreak - zc) * PITCH;
  const yPorch = 6.93; const zPorch = 8;
  const top = [[-8, yBack], [zc, RIDGE], [zBreak, yBreak], [zPorch, yPorch]];
  const poly = [...top, [zPorch, yPorch - SLAB], [zBreak, yBreak - SLAB], [zc, RIDGE - SLAB], [-8, yBack - SLAB]];
  const shingle = times(0x7d6a54, 1.35);
  const sag = (o) => {
    const fx = (o[0] - (xRoof0 + xRoof1) / 2) / ((xRoof1 - xRoof0) / 2);
    o[1] += -0.14 * (1 - fx * fx) + (smoothNoise3(o[0] * 0.28, 1.5, o[2] * 0.28) - 0.5) * 0.14;
  };
  prism(roofB, shingle, poly, 'x', xRoof0, xRoof1, {
    along: 14, runStep: 1.6, warp: sag,
    tint: (x, y, z, out, nx, ny) => {
      const n = smoothNoise3(x * 0.4, y * 0.4, z * 0.4);
      const k = 0.78 + n * 0.42;
      // Moss creeping down the shadier run.
      const moss = sstep(smoothNoise3(x * 0.3 + 9, 0.5, z * 0.5), 0.55, 0.8) * 0.3;
      out[0] *= k * (1 - moss * 0.5); out[1] *= k; out[2] *= k * (1 - moss * 0.6);
      if (ny < -0.2) { out[0] *= 0.7; out[1] *= 0.7; out[2] *= 0.7; }
    },
  });
  // A plank lining under the shingles, and the barge boards that finish the gable edge.
  const lining = times(PAL.timber, 1.25);
  const lin2 = [[-7.9, yBack - SLAB - 0.02], [zc, RIDGE - SLAB - 0.02], [zBreak, yBreak - SLAB - 0.02], [zPorch - 0.1, yPorch - SLAB - 0.02], [zPorch - 0.1, yPorch - SLAB - 0.09], [zBreak, yBreak - SLAB - 0.09], [zc, RIDGE - SLAB - 0.09], [-7.9, yBack - SLAB - 0.09]];
  prism(wood, lining, lin2, 'x', xRoof0 + 0.05, xRoof1 - 0.05, { along: 1, grainAlongRun: false, warp: sag });
  const fascia = times(PAL.timber, 1.05);
  for (const x of [xRoof0 - 0.05, xRoof1 + 0.0]) {
    for (let k = 0; k < 3; k++) {
      const A = top[k]; const B = top[k + 1];
      const up = -0.06;
      bar(wood, fascia, [x, A[1] + up, A[0]], [x, B[1] + up, B[0]], 0.12, 0.54, { up: [0, 1, 0] });
    }
  }
  for (const s of [-1, 1]) bar(wood, times(fascia, 0.92), [xRoof0, RIDGE + 0.03, zc + s * 0.3], [xRoof1, RIDGE + 0.03, zc + s * 0.3], 0.62, 0.08, { up: [0, 1, 0] });
  // Rafters between the purlins, seen from inside.
  for (let x = xW + 1.4; x < xE - 0.5; x += 2.75) {
    for (const s of [-1, 1]) {
      const z1 = s > 0 ? zF : zB;
      pole(wood, jitter(rng, PAL.timber, 0.1), [x, under(zc) - 0.14, zc], [x, under(z1) - 0.16, z1], 0.14, { sides: 6 });
    }
  }

  // --- the porch ---------------------------------------------------------------------------------
  const deckY = 0.22;
  const dz0 = zF + 0.3; const dz1 = 7.45;
  box(wood, times(PAL.dark, 0.9), xW - 0.75, xE + 0.75, -0.4, deckY - 0.1, dz0, dz1, { flat: true });
  let z = dz0;
  while (z < dz1 - 0.01) {
    const zz = Math.min(dz1, z + 0.56);
    box(wood, jitter(rng, times(PAL.timber, 1.2), 0.1), xW - 0.8, xE + 0.8, deckY - 0.12, deckY, z + 0.015, zz - 0.015, { grain: 'x' });
    z = zz;
  }
  box(wood, times(PAL.timber, 1.05), door.a0 - 1, door.a1 + 1, -0.4, 0.09, dz1, 7.98, { grain: 'x' });
  const beamY = 6.42;
  const posts = [xW, door.a0 - 1.7, door.a1 + 1.7, xE];
  for (const x of posts) {
    roundedPole(wood, times(PAL.timber, 1.15), [x, deckY - 0.1, 7.0], [x, beamY + 0.1, 7.0], 0.27, { r2: 0.23, sides: 10, steps: 3 });
    for (const s of x === xW ? [1] : x === xE ? [-1] : [-1, 1]) {
      bar(wood, times(PAL.timber, 1), [x + s * 0.1, 4.95, 7.0], [x + s * 1.35, beamY - 0.14, 7.0], 0.18, 0.2, {});
    }
  }
  log(logs, logC, 'x', xW - 0.75, xE + 0.75, beamY, 7.0, 0.27, rng, { step: 5, sides: 9 });
  // From the beam back to the wall, under the porch roof, one light rail per bay.
  for (const x of posts) pole(wood, times(PAL.timber, 1.0), [x, beamY + 0.12, 7.0], [x, 7.62, zF + 0.4], 0.11, { sides: 6 });
  // A bench and the woodpile on the porch. A stack of butts is the one thing that says what the logs are.
  box(wood, times(PAL.timber, 1.1), -6.4, -3.2, 1.55, 1.7, 4.0, 4.75, { grain: 'x' });
  for (const x of [-6.1, -3.5]) box(wood, times(PAL.timber, 0.85), x - 0.09, x + 0.09, deckY, 1.55, 4.1, 4.65);
  const pileX0 = 5.9; const rWood = 0.33;
  for (let r = 0; r < 5; r++) {
    const cnt = 5 - (r > 2 ? r - 2 : 0);
    for (let i = 0; i < cnt; i++) {
      const x = pileX0 + (i + (r % 2) * 0.5) * (rWood * 2.05);
      log(logs, jitter(rng, times(PAL.timber, 1.1), 0.1), 'z', 4.0, 6.0 + rng() * 0.3, deckY + rWood + r * rWood * 1.78, x, rWood * (0.88 + rng() * 0.12), rng, { step: 4, sides: 7 });
    }
  }

  // --- the fieldstone chimney, on the -X gable ---------------------------------------------------
  const sC = times(PAL.stone, 1.2);
  const cO = -10; const wallIn = xW + R + 0.04;
  const cz0 = zc - 2.1; const cz1 = zc + 2.1;
  const voidZ = 1.42; const voidTop = 3.81;
  rubbleBox(stone, sC, cO, wallIn, -0.4, voidTop + 0.3, cz0, zc - voidZ, { rough: 0.05 });
  rubbleBox(stone, sC, cO, wallIn, -0.4, voidTop + 0.3, zc + voidZ, cz1, { rough: 0.05 });
  rubbleBox(stone, sC, cO, -9.2, -0.4, voidTop + 0.3, zc - voidZ - 0.05, zc + voidZ + 0.05, { rough: 0.04 });
  const soot = times(0x4a4038, 1.1);
  box(stone, soot, -9.22, -9.15, 0.05, voidTop, zc - voidZ, zc + voidZ, { flat: true });
  for (const s of [-1, 1]) box(stone, soot, -9.2, wallIn, 0.05, voidTop, zc + s * voidZ - 0.03, zc + s * voidZ + 0.03, { flat: true });
  rubbleBox(stone, sC, cO, wallIn, voidTop, 6.2, cz0, cz1, { rough: 0.05 });
  // Stone lintel over the fire, facing the room.
  box(stone, times(0x9a9486, 1.2), wallIn - 0.05, wallIn + 0.3, voidTop - 0.14, voidTop + 0.5, zc - voidZ - 0.8, zc + voidZ + 0.8, { grain: 'z' });
  for (const s of [-1, 1]) box(stone, sC, wallIn - 0.05, wallIn + 0.3, 0.05, voidTop - 0.14, zc + s * (voidZ + 0.4) - 0.4, zc + s * (voidZ + 0.4) + 0.4, {});
  // Shoulders, then the stack. The stack stands clear of the gable's roof edge.
  const stX0 = -9.75; const stX1 = -8.1; const stZ = 1.05; const stTop = 14.3;
  prism(stone, sC, [[cz0, 6.2], [cz1, 6.2], [zc + stZ, 8.3], [zc - stZ, 8.3]], 'x', cO, -8.0, {});
  rubbleBox(stone, sC, stX0, stX1, 8.3, stTop, zc - stZ, zc + stZ, { rough: 0.06 });
  box(stone, times(PAL.stone, 1.05), stX0 - 0.14, stX1 + 0.14, stTop, stTop + 0.2, zc - stZ - 0.14, zc + stZ + 0.14, {});
  box(stone, times(0x3a342e, 1), stX0 + 0.4, stX1 - 0.4, stTop + 0.2, stTop + 0.24, zc - stZ + 0.4, zc + stZ - 0.4, { flat: true });
  // --- the foundation and the floor ----------------------------------------------------------------
  const sill = times(PAL.stone, 1.15);
  box(stone, sill, xW - 0.5, xE + 0.5, -0.4, 0.28, zF - 0.42, zF + 0.42, { grain: 'x' });
  box(stone, sill, xW - 0.5, xE + 0.5, -0.4, 0.28, zB - 0.42, zB + 0.42, { grain: 'x' });
  box(stone, sill, xW - 0.42, xW + 0.42, -0.4, 0.28, zB - 0.42, zF + 0.42, { grain: 'z' });
  box(stone, sill, xE - 0.42, xE + 0.42, -0.4, 0.28, zB - 0.42, zF + 0.42, { grain: 'z' });
  box(wood, times(PAL.dark, 0.8), xW + 0.1, xE - 0.1, -0.35, -0.02, zB + 0.1, zF - 0.1, { flat: true });
  let fx = zB + 0.1;
  while (fx < zF - 0.11) {
    const fz = Math.min(zF - 0.1, fx + 0.72);
    box(wood, jitter(rng, times(PAL.timber, 1.1), 0.1), xW + 0.1, xE - 0.1, -0.04, 0.05, fx + 0.012, fz - 0.012, { grain: 'x' });
    fx = fz;
  }
  // Hearth stone and fire.
  box(stone, times(0x7f7a70, 1.1), wallIn, wallIn + 1.9, 0.05, 0.13, zc - voidZ - 0.5, zc + voidZ + 0.5, { grain: 'z' });
  box(stone, times(0x6f6a60, 1), -9.2, wallIn, 0.05, 0.1, zc - voidZ, zc + voidZ, { flat: true });
  softBox(wood, times(0xb8481a, 1), -8.2, 0.17, zc, 0.42, 0.07, 0.65, 0.06, { segs: [3, 2, 4] });
  for (const [a, dy] of [[-0.28, 0.3], [0.28, 0.3], [0.04, 0.55]]) {
    pole(wood, times(0x7a5c3e, 1), [-8.2 + a * 0.4, 0.05 + dy, zc - 0.85 + a], [-8.2 - a * 0.3, 0.05 + dy, zc + 0.85 + a * 0.4], 0.16, { sides: 7 });
  }
  pole(wood, PAL.iron, [-8.2, 3.81, zc], [-8.2, 2.2, zc], 0.025, { sides: 4, flat: true });
  pot(wood, -8.2, 1.42, zc, 0.5, 0x2a2826);

  // --- the door and the windows ------------------------------------------------------------------
  const frameC = times(PAL.timber, 1.05);
  const fN = zF;
  sideBox(wood, frameC, '+z', door.a0 - 0.14, door.a0 + 0.14, 0.05, door.y1 + 0.2, fN - 0.5, fN + 0.5);
  sideBox(wood, frameC, '+z', door.a1 - 0.14, door.a1 + 0.14, 0.05, door.y1 + 0.2, fN - 0.5, fN + 0.5);
  sideBox(wood, frameC, '+z', door.a0 - 0.14, door.a1 + 0.14, door.y1 - 0.2, door.y1 + 0.04, fN - 0.5, fN + 0.5, { grain: 'h' });
  doorLeaf(wood, times(0x9a6e42, 1.15), [door.a0 + 0.14, fN - 0.45], door.a1 - door.a0 - 0.28, 0.08, door.y1 - 0.22, -1.2);
  const winFrame = (o, side, n) => {
    casement(wood, side, o.a0 + 0.02, o.a1 - 0.02, o.y0 + 0.02, o.y1 - 0.02, n, { frame: times(0xcfc6ae, 0.95), f: 0.15, cols: 2, rows: 2 });
    sideBox(wood, frameC, side, o.a0 - 0.12, o.a0 + 0.12, o.y0 - 0.08, o.y1 + 0.08, n - 0.5, n + 0.5);
    sideBox(wood, frameC, side, o.a1 - 0.12, o.a1 + 0.12, o.y0 - 0.08, o.y1 + 0.08, n - 0.5, n + 0.5);
    sideBox(wood, frameC, side, o.a0 - 0.12, o.a1 + 0.12, o.y1 - 0.02, o.y1 + 0.12, n - 0.5, n + 0.5, { grain: 'h' });
    sideBox(wood, frameC, side, o.a0 - 0.2, o.a1 + 0.2, o.y0 - 0.12, o.y0 + 0.02, n - 0.5, n + 0.6, { grain: 'h' });
  };
  winFrame(win1, '+z', zF);
  winFrame(win2, '-z', -zB);
  winFrame(win3, '+x', xE);

  // --- the room ------------------------------------------------------------------------------------
  // A two-tier bunk against the east wall, a table and stools, a shelf of pots, a hanging lantern.
  const bk = { x0: 5.5, x1: xE - 0.42, z0: zB + 0.44, z1: zB + 6.5 };
  for (const x of [bk.x0, bk.x1 - 0.12]) {
    for (const zz of [bk.z0, bk.z1 - 0.12]) box(wood, times(PAL.timber, 0.95), x, x + 0.26, 0.05, 6.1, zz, zz + 0.26);
  }
  for (const y of [1.15, 3.9]) {
    box(wood, times(PAL.timber, 0.9), bk.x0, bk.x1 + 0.1, y - 0.2, y + 0.1, bk.z0, bk.z0 + 0.2, { grain: 'x' });
    box(wood, times(PAL.timber, 0.9), bk.x0, bk.x1 + 0.1, y - 0.2, y + 0.1, bk.z1 - 0.1, bk.z1 + 0.1, { grain: 'x' });
    box(wood, times(PAL.timber, 0.9), bk.x0, bk.x0 + 0.22, y - 0.2, y + 0.1, bk.z0, bk.z1, { grain: 'z' });
    softBox(wood, times(0xd8cca8, 0.92), (bk.x0 + bk.x1) / 2 + 0.05, y + 0.2, (bk.z0 + bk.z1) / 2, (bk.x1 - bk.x0) / 2 - 0.22, 0.26, (bk.z1 - bk.z0) / 2 - 0.2, 0.15, { segs: [4, 3, 5] });
    softBox(wood, y < 2 ? 0xa23b2a : 0x2f6fae, (bk.x0 + bk.x1) / 2 + 0.05, y + 0.42, (bk.z0 + bk.z1) / 2 + 0.7, (bk.x1 - bk.x0) / 2 - 0.16, 0.13, (bk.z1 - bk.z0) / 2 - 0.9, 0.09, { segs: [4, 3, 5] });
  }
  ladder(wood, times(PAL.timber, 0.9), [bk.x0 - 0.5, 0.05, bk.z1 - 1.4], [bk.x0 - 0.1, 4.2, bk.z1 - 1.4], 1.1, 4, { axis: 'z', r: 0.07, rr: 0.05 });
  table(wood, 1.4, -3.3, 2.5, 1.25, 2.5, times(PAL.timber, 1.15));
  stool(wood, -0.1, -1.4, 1.5, 0.52, times(PAL.timber, 1.0));
  stool(wood, 2.7, -1.5, 1.5, 0.52, times(PAL.timber, 0.92));
  bowl(wood, 0.8, 2.5, -3.2, 0.48, 0xb9894f);
  pot(wood, 2.3, 2.5, -3.5, 0.22, 0x8f5535);
  box(wood, times(PAL.timber, 0.95), 1.2, 4.4, 4.9, 5.02, zB + 0.2, zB + 1.1, { grain: 'x' });
  pot(wood, 1.8, 5.02, zB + 0.7, 0.24, 0xa8583a);
  pot(wood, 2.8, 5.02, zB + 0.7, 0.2, 0x88705a);
  bowl(wood, 3.8, 5.02, zB + 0.68, 0.3, 0xb9894f);

  return assemble([[logs, {}], [wood, {}], [roofB, {}], [stone, {}]]);
}

// ---------------------------------------------------------------------------------------------
// The adobe house
// ---------------------------------------------------------------------------------------------
function adobeHouse() {
  const rng = seededRandom(1050);
  const plaster = bag(plasterTile());
  const wood = bag(woodTile(17));

  const H = 10; const T = 1.6; const I = H - T;
  const BAT = 0.022;
  const faceAt = (y) => H - BAT * y;
  const adobe = times(PAL.adobe, 1.14);
  const splash = times(0x8a5c3a, 1.08);
  const paleIn = times(0xd9b98e, 1.0);
  const topY = (x, z) => 10.75 + (smoothNoise3(x * 0.13, 1.5, z * 0.13) - 0.5) * 0.7;
  const door = { side: '+z', a0: -5.0, a1: -2.1, y0: 0.05, y1: 6.3, fillet: 0.26 };
  const openings = [
    door,
    { side: '+z', a0: 2.3, a1: 4.9, y0: 3.0, y1: 5.2, fillet: 0.26 },
    { side: '-z', a0: -2.0, a1: 0.4, y0: 3.0, y1: 5.2, fillet: 0.26 },
    { side: '-x', a0: -0.2, a1: 2.2, y0: 3.0, y1: 5.2, fillet: 0.26 },
    { side: '+x', a0: -4.2, a1: -1.8, y0: 3.0, y1: 5.2, fillet: 0.26 },
  ];
  const scupper = [[-10, -3.6], [-10, 4.2], [-3.8, -10], [4.6, -10]]; // where the roof drains through the parapet
  ribbonWall(plaster, {
    hx: H, hz: H, t: T, rc: 1.3, ri: 0.8, top: topY, openings, fillet: 0.26, topFillet: 0.5, crown: 0.12,
    batter: BAT, step: 1.35, rowStep: 1.35, extraRows: [0.5, 1.2, 8.6],
    wobble: (x, y, z) => (smoothNoise3(x * 0.14 + 2, y * 0.17, z * 0.14) - 0.5) * 0.5 + (smoothNoise3(x * 0.3, y * 0.3 + 7, z * 0.3) - 0.5) * 0.14,
    tint: (x, y, z, out, face) => {
      const n = smoothNoise3(x * 0.16 + 5, y * 0.2, z * 0.16);
      const m = smoothNoise3(x * 0.42, y * 0.42 + 3, z * 0.42);
      if (face === 'o') {
        const k = 0.8 + n * 0.3 + (m - 0.5) * 0.22;
        out[0] = adobe[0] * k; out[1] = adobe[1] * k * (0.95 + n * 0.1); out[2] = adobe[2] * k * (0.88 + n * 0.2);
        // Rain splash and rising damp, a dark earth band with no straight edge to it.
        const d = 1 - sstep(y, 0.25 + m * 0.6, 1.5 + m * 1.2);
        out[0] = mix(out[0], splash[0], d); out[1] = mix(out[1], splash[1], d); out[2] = mix(out[2], splash[2], d);
        // Water stains under each roof drain.
        for (const [sx, sz] of scupper) {
          const off = sx === -10 ? z - sz : x - sx;
          const onFace = sx === -10 ? x < -8 : z < -8;
          if (!onFace) continue;
          const st = Math.exp(-(off * off) / 0.7) * sstep(y, 3.5, 9.5);
          out[0] *= 1 - st * 0.34; out[1] *= 1 - st * 0.38; out[2] *= 1 - st * 0.42;
        }
      } else if (y > 9.6) {
        const k = 0.86 + n * 0.25;
        out[0] = adobe[0] * k; out[1] = adobe[1] * k; out[2] = adobe[2] * k;
      } else {
        const k = 0.84 + n * 0.2;
        out[0] = paleIn[0] * k; out[1] = paleIn[1] * k; out[2] = paleIn[2] * k;
      }
    },
  });

  // --- floor, roof deck, ceiling ---------------------------------------------------------------------
  const earthFloor = times(0x9a7350, 1.15);
  box(plaster, earthFloor, -I - 0.1, I + 0.1, -0.4, 0.05, -I - 0.1, I + 0.1, { segs: [8, 1, 8], tint: (x, y, z, out) => { const k = 0.82 + smoothNoise3(x * 0.3, 2.5, z * 0.3) * 0.36; out[0] *= k; out[1] *= k; out[2] *= k; } });
  const deckTop = 9.75;
  box(plaster, times(0xb78457, 1.2), -I - 0.15, I + 0.15, 9.2, deckTop, -I - 0.15, I + 0.15, { segs: [6, 1, 6], tint: (x, y, z, out) => { const k = 0.85 + smoothNoise3(x * 0.25, 3.5, z * 0.25) * 0.3; out[0] *= k; out[1] *= k; out[2] *= k; } });
  // The vigas, right through the room and out through both walls.
  const vigaY = 8.72;
  const vigaC = times(0x8a6a48, 1.15);
  const count = 8;
  const vigaXs = [];
  for (let i = 0; i < count; i++) {
    const x = -8.4 + (16.8 * i) / (count - 1);
    vigaXs.push(x);
    const out = 11.25 + (rng() - 0.5) * 0.5;
    const out2 = 11.25 + (rng() - 0.5) * 0.5;
    const col = jitter(rng, vigaC, 0.12);
    roundedPole(wood, col, [x, vigaY, -out2], [x, vigaY + (rng() - 0.5) * 0.06, out], 0.34, { r2: 0.3 + rng() * 0.05, sides: 10, steps: 3, round: 1 });
  }
  // Latillas, side by side on the vigas: the ceiling a student actually looks at.
  for (let z = -I + 0.15; z < I; z += 0.46) {
    const c = jitter(rng, times(0xb59568, 1.2), 0.14);
    pole(wood, c, [-I - 0.1, 9.13, z + (rng() - 0.5) * 0.04], [I + 0.1, 9.13, z + (rng() - 0.5) * 0.04], 0.12, { sides: 4 });
  }
  // A hatch on the roof, where the ladder is going, and drains out through the parapet.
  box(wood, times(PAL.timber, 1.05), 5.4, 8.0, deckTop, deckTop + 0.18, 5.0, 7.6, { grain: 'z' });
  for (const [sx, sz] of scupper) {
    const alongX = sx === -10; // a drain through the -X wall runs along X
    const y = deckTop + 0.1;
    const p0 = alongX ? [-8, y, sz] : [sx, y, -8];
    const p1 = alongX ? [-11.05, y + -0.14, sz] : [sx, y - 0.14, -11.05];
    const up = [0, 1, 0];
    const wd = 0.72;
    bar(wood, vigaC, p0, p1, wd, 0.1, { up });
    for (const s of [-1, 1]) {
      const o = alongX ? [0, 0.12, s * wd * 0.5] : [s * wd * 0.5, 0.12, 0];
      bar(wood, vigaC, [p0[0] + o[0], p0[1] + o[1], p0[2] + o[2]], [p1[0] + o[0], p1[1] + o[1], p1[2] + o[2]], 0.09, 0.3, { up });
    }
  }

  // --- the door and the windows, in their deep reveals -----------------------------------------------
  const blue = times(PAL.blue, 1.15);
  const lintel = times(PAL.timber, 1.05);
  const fO = faceAt(5);
  sideBox(wood, blue, '+z', door.a0 + 0.06, door.a0 + 0.28, 0.05, door.y1 - 0.02, I + 0.1, fO - 0.2);
  sideBox(wood, blue, '+z', door.a1 - 0.28, door.a1 - 0.06, 0.05, door.y1 - 0.02, I + 0.1, fO - 0.2);
  sideBox(wood, blue, '+z', door.a0 + 0.06, door.a1 - 0.06, door.y1 - 0.24, door.y1 - 0.02, I + 0.1, fO - 0.2, { grain: 'h' });
  // Swung open into the room, but only so far: the colour has to be seen from the yard.
  doorLeaf(wood, blue, [door.a0 + 0.28, I + 0.24], door.a1 - door.a0 - 0.56, 0.08, door.y1 - 0.26, -0.95, { iron: 0x1b1b1c });
  sideBox(wood, lintel, '+z', door.a0 - 0.7, door.a1 + 0.7, door.y1 + 0.08, door.y1 + 0.62, I - 0.04, faceAt(door.y1) + 0.06, { grain: 'h' });
  for (const o of openings.slice(1)) {
    const mid = H - T * 0.46;
    casement(wood, o.side, o.a0 + 0.04, o.a1 - 0.04, o.y0 + 0.02, o.y1 - 0.02, mid, { frame: blue, f: 0.14, cols: 2, rows: 2, muntin: 0.04 });
    sideBox(wood, lintel, o.side, o.a0 - 0.5, o.a1 + 0.5, o.y1 + 0.06, o.y1 + 0.5, I - 0.04, faceAt(o.y1) + 0.06, { grain: 'h' });
  }

  // --- where the plaster has worn through: the bricks themselves ----------------------------------
  const brick = times(0x9c6a44, 1.2);
  const patch = (side, a0, y0, rows, cols) => {
    for (let r = 0; r < rows; r++) {
      const offA = r % 2 ? 0.55 : 0;
      for (let c = 0; c < cols - (r % 2 ? 1 : 0); c++) {
        if ((r === 0 || r === rows - 1) && (c === 0 || c === cols - 1) && rng() < 0.6) continue;
        const a = a0 + offA + c * 1.1;
        const y = y0 + r * 0.42;
        sideBox(plaster, jitter(rng, brick, 0.14), side, a, a + 1.04, y, y + 0.37, faceAt(y) - 0.6, faceAt(y) + 0.05 + rng() * 0.03, { grain: 'h', segs: null });
      }
    }
  };
  patch('+z', -8.6, 1.6, 4, 3);
  patch('+z', 5.5, 1.5, 3, 2);
  patch('-x', -6.5, 1.3, 4, 3);
  patch('-z', 3.5, 2.0, 3, 4);

  // --- the ladder, between two vigas, resting on the parapet's lip ---------------------------------
  const ladderC = times(PAL.timber, 1.15);
  const lx = 7.2;
  const lz = (y) => 12.6 - 0.25 * y;
  ladder(wood, ladderC, [lx, -0.25, lz(-0.25)], [lx, 12.7, lz(12.7)], 1.02, 12, { axis: 'x', r: 0.12, rr: 0.075, round: true });

  // --- a ristra of chillies off the viga by the door: the one saturated thing on the front ---------
  const rx = vigaXs.reduce((best, x) => (Math.abs(x - -6.2) < Math.abs(best - -6.2) ? x : best), vigaXs[0]);
  const rz = 10.65;
  pole(wood, times(0x7a5c3e, 1), [rx, vigaY - 0.3, rz], [rx, 5.3, rz], 0.03, { sides: 4, flat: true });
  for (let i = 0; i < 32; i++) {
    const f = i / 31;
    const y = mix(vigaY - 0.6, 5.3, f);
    const a = i * 2.4;
    const R = 0.17 * (0.7 + Math.sin(f * Math.PI) * 0.8);
    const c = jitter(rng, 0xb0261a, 0.16);
    const px = rx + Math.cos(a) * R; const pz = rz + Math.sin(a) * R;
    pole(wood, c, [px, y + 0.14, pz], [px + Math.cos(a) * 0.1, y - 0.2, pz + Math.sin(a) * 0.1], 0.07, { r2: 0.015, sides: 5, flat: true });
  }

  // --- the horno, a real beehive with a real mouth --------------------------------------------------
  const hx = 13.3; const hz = 2.6;
  const sculpt = new Sculpt(0.3);
  const hornoC = times(PAL.adobe, 1.18);
  sculpt.add(ellipsoidP([hx, 0.2, hz], [2.7, 0.55, 2.7]), hornoC);
  sculpt.add(ellipsoidP([hx, 1.3, hz], [2.15, 3.0, 2.15]), hornoC, { k: 0.45 });
  sculpt.sub(ellipsoidP([hx, 2.0, hz - 0.05], [1.5, 1.7, 1.5]), times(0x2e2620, 1), { ck: 0.2 });
  sculpt.sub(ellipsoidP([hx, 1.72, hz + 2.05], [0.85, 0.98, 1.0]), times(0x4e3a2a, 1), { ck: 0.3, k: 0.12 });
  sculpt.sub(sphereP([hx, 4.05, hz - 0.8], 0.2), times(0x2e2620, 1), { ck: 0.12 });
  sculpt.sub(boxP([hx, -2.35, hz], [4, 2, 4]));
  const hornoG = polygonize(sculpt, {
    uvScale: 1 / plaster.t.feet[0], bounds: [hx - 3, -0.38, hz - 3, hx + 3, 4.6, hz + 3],
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const n = smoothNoise3(x * 0.6, y * 0.6, z * 0.6);
      const k = 0.82 + n * 0.32;
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      // Smoke up the front above the mouth.
      const dx = x - hx; const up = y - 2.4;
      if (z > hz + 0.6) {
        const st = Math.exp(-(dx * dx) / 1.0) * Math.exp(-(up * up) / 1.1) * 0.58;
        rgb[0] *= 1 - st; rgb[1] *= 1 - st; rgb[2] *= 1 - st;
      }
      const dm = 1 - sstep(y, 0.0, 0.7);
      rgb[0] *= 1 - dm * 0.25; rgb[1] *= 1 - dm * 0.28; rgb[2] *= 1 - dm * 0.3;
    },
  });
  plaster.parts.push({ geometry: hornoG, keepColor: true });
  // The wooden door that closes the mouth, leaning beside it, and a stack of split wood.
  // The long wooden peel the bread goes in on, leaning against the dome.
  const peelA = [hx + 2.55, 0.02, hz + 1.05]; const peelB = [hx + 1.35, 4.75, hz + 0.75];
  roundedPole(wood, times(PAL.timber, 1.2), peelA, peelB, 0.06, { sides: 6, steps: 1 });
  bar(wood, times(PAL.timber, 1.25), [peelB[0] - 0.02, peelB[1] - 0.1, peelB[2]], [peelB[0] - 0.28, peelB[1] + 1.0, peelB[2] - 0.06], 0.95, 0.05, { up: [0.9, 0.2, 0.3] });

  // --- the corner fireplace, sculpted into the -X, -Z corner ---------------------------------------
  const fp = new Sculpt(0.3);
  const fpC = times(0xd9b98e, 1.05);
  const c0 = -I + 0.55;
  const bx = c0; const bz = c0;
  const dd = Math.SQRT1_2;
  fp.add(ellipsoidP([bx, 1.4, bz], [2.45, 2.3, 2.45]), fpC);
  // The hood: one long taper into the corner, right up to the ceiling, not a stack of balls.
  fp.add(curveP([[bx, 2.4, bz], [bx - 0.22, 4.4, bz - 0.22], [bx - 0.42, 6.6, bz - 0.42], [bx - 0.55, 9.3, bz - 0.55]], [2.25, 1.75, 1.3, 1.08], 12), fpC, { k: 0.7 });
  // A raised sill the fire sits behind, and the deep arched mouth, opening on the room's diagonal.
  fp.sub(ellipsoidP([bx + dd * 0.55, 1.25, bz + dd * 0.55], [1.2, 1.55, 1.2]), times(0x3a3028, 1), { ck: 0.35 });
  fp.sub(ellipsoidP([bx + dd * 1.95, 1.4, bz + dd * 1.95], [1.02, 1.42, 1.02]), times(0x8a7055, 1), { ck: 0.7, k: 0.16 });
  fp.sub(boxP([bx, -2.35, bz], [4, 2, 4]));
  const fpG = polygonize(fp, {
    uvScale: 1 / plaster.t.feet[0], bounds: [-I - 0.5, 0, -I - 0.5, bx + 3, 9.3, bz + 3],
    tint: (x, y, z, nx, ny, nz, rgb) => {
      const k = 0.85 + smoothNoise3(x * 0.6, y * 0.6, z * 0.6) * 0.25;
      rgb[0] *= k; rgb[1] *= k; rgb[2] *= k;
      // Soot above the arch.
      const across = (x - z) * dd; const out = (x + z) * dd - (bx + bz) * dd;
      if (out > 1) {
        const st = Math.exp(-(across * across) / 0.7) * Math.exp(-((y - 3.3) * (y - 3.3)) / 1.0) * 0.5;
        rgb[0] *= 1 - st; rgb[1] *= 1 - st; rgb[2] *= 1 - st;
      }
    },
  });
  plaster.parts.push({ geometry: fpG, keepColor: true });
  // Split wood stood on end, the way a corner fireplace burns it.
  const fx = bx + dd * 0.85; const fz = bz + dd * 0.85;
  softBox(wood, times(0xb8481a, 1), fx, 0.17, fz, 0.42, 0.07, 0.42, 0.06, { segs: [3, 2, 3] });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * 6.28 + 0.5;
    pole(wood, times(0x7a5c3e, 1), [fx + Math.cos(a) * 0.55, 0.12, fz + Math.sin(a) * 0.55], [fx + Math.cos(a) * 0.1, 1.5, fz + Math.sin(a) * 0.1], 0.1, { sides: 6 });
  }

  // --- a built-in bench along the east wall, with a striped blanket, and a couple of pots ----------
  const bench = times(0xc99a6b, 1.15);
  softBox(plaster, bench, I - 0.72, 0.8, 0.9, 0.82, 0.78, 3.7, 0.22, { segs: [4, 3, 8] });
  softBox(wood, 0xd9b24a, I - 0.72, 1.63, 0.9, 0.72, 0.09, 2.3, 0.05, {
    segs: [3, 2, 21],
    perFace: (x, y, z, out) => {
      const i = Math.floor((z + 40) / 0.22);
      const c = [lin(0xa23b2a), lin(0xd9b24a), lin(0xe4dcc8), lin(0x2f6fae), lin(0xa23b2a), lin(0x2c2a28), lin(0xd9b24a)][i % 7];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    },
  });
  const potTint = (bottom) => (x, y, z, out) => {
    const f = y - bottom;
    if (f > 0.55 && f < 0.72) { const c = lin(0x2c2a28); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
    if (f > 0.34 && f < 0.42) { const c = lin(0xa23b2a); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; }
  };
  pot(wood, 3.2, 0.05, 7.0, 0.72, 0xd8b48c, { tint: potTint(0.05) });
  pot(wood, 4.6, 0.05, 7.5, 0.5, 0xc99a6b, { tint: potTint(0.05) });
  pot(wood, -7.3, 0.05, 11.3, 0.66, 0xd8b48c, { tint: potTint(0.05) });
  // A woven floor rug, in stripes.
  softBox(wood, 0xa23b2a, -0.6, 0.09, 0.5, 3.0, 0.035, 2.0, 0.015, {
    segs: [24, 1, 3],
    perFace: (x, y, z, out) => {
      const i = Math.floor((x + 40) / 0.25);
      const c = [lin(0xa23b2a), lin(0xe4dcc8), lin(0x2c2a28), lin(0xd9b24a), lin(0x2f6fae), lin(0xe4dcc8)][i % 6];
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    },
  });

  return assemble([[plaster, { roughness: 0.96 }], [wood, {}]]);
}

// ---------------------------------------------------------------------------------------------
// The stilt house
// ---------------------------------------------------------------------------------------------
function stiltHouse() {
  const rng = seededRandom(1402);
  const weave = bag(weaveTile());
  const thatch = bag(thatchTile(23));
  const wood = bag(woodTile(19));

  const F = 7.5; // the top of the deck
  const RX = 7.5; const RZ0 = -6.0; const RZ1 = 2.5; // the room
  const VZ = 6.5; // the veranda's outer edge
  const warp = (x, y, z, tp) => (smoothNoise3(x * 0.17 + 1, 0.5, z * 0.2) - 0.5) * 0.32 * (0.4 + tp) + 0.3 * (x / 6) * (x / 6) * (1 - tp) * (1 - tp);
  const roof = thatchShape({ ex: 10, ez: 8, lr: 4.6, p: 3.2, yEave: 12.55, yRidge: 19.65, q: 1.08, thick: 0.85, warp });

  // --- the walls of the room, woven bamboo on real thickness ---------------------------------------
  const weaveC = times(0xd9c088, 1.32);
  const t = 0.11;
  const door = { a0: -1.5, a1: 1.5, y0: F, y1: F + 6.3 };
  const inner = (x, z) => roof.inner(x, z);
  const wTint = (x, y, z, out) => { const k = 0.82 + smoothNoise3(x * 0.3, y * 0.3, z * 0.3) * 0.34; out[0] *= k; out[1] *= k; out[2] *= k; };
  const upperOf = (z) => [[-RX, F + 6.3], [RX, F + 6.3], [RX, inner(RX, z) + 0.25], [roof.lr, inner(roof.lr, z) + 0.25], [-roof.lr, inner(roof.lr, z) + 0.25], [-RX, inner(RX, z) + 0.25]];
  for (const [p, q, y0, y1] of rectsAround(-RX, RX, F, F + 6.3, [door])) box(weave, weaveC, p, q, y0, y1, RZ1 - t, RZ1 + t, { tint: wTint });
  prism(weave, weaveC, upperOf(RZ1), 'z', RZ1 - t, RZ1 + t, { tint: wTint });
  box(weave, weaveC, -RX, RX, F, F + 4.4, RZ0 - t, RZ0 + t, { tint: wTint });
  // At the back the roof comes low, so the wall's head is taken from the roof itself.
  const backTop = (x) => inner(x, RZ0) + 0.25;
  prism(weave, weaveC, [[-RX, F + 4.3], [RX, F + 4.3], [RX, backTop(RX)], [roof.lr, backTop(roof.lr)], [-roof.lr, backTop(roof.lr)], [-RX, backTop(RX)]], 'z', RZ0 - t, RZ0 + t, { tint: wTint });
  for (const x of [-RX, RX]) {
    const prof = [[RZ0 - t, F], [RZ1 + t, F], [RZ1 + t, inner(RX, RZ1) + 0.3], [RZ1 - 2.5, inner(RX, RZ1 - 2.5) + 0.3], [0, inner(RX, 0) + 0.3], [-2.5, inner(RX, -2.5) + 0.3], [RZ0 - t, inner(RX, RZ0) + 0.3]];
    prism(weave, weaveC, prof, 'x', x - t, x + t, { tint: wTint });
  }
  // Mat floor, in its own colour, on the deck.
  const mat = times(0xcfae6e, 1.2);
  box(weave, mat, -RX + t, RX - t, F, F + 0.06, RZ0 + t, RZ1 - t, { tint: wTint, grain: 'z' });

  // --- the frame: corner posts of the room, rails and framing bamboo -------------------------------
  const pale = times(0xc9a968, 1.25);
  const postC = times(PAL.timber, 1.1);
  const postX = [-7.6, -2.55, 2.55, 7.6];
  const postZ = [-6.2, 0.0, 6.2];
  for (const z of postZ) {
    for (const x of postX) {
      const headY = (x === -7.6 || x === 7.6 || z === 6.2) ? Math.max(F + 1, roof.inner(x, z) + 0.1) : F - 1.0;
      const lean = (rng() - 0.5) * 0.05;
      roundedPole(wood, jitter(rng, postC, 0.1), [x + lean, 0.08, z], [x, headY, z], 0.43, { r2: 0.36, sides: 10, steps: 3, round: 1 });
      turned(wood, times(PAL.stone, 0.95), [[0, -0.4], [0.72, -0.4], [0.76, 0.0], [0.62, 0.1], [0.3, 0.14], [0, 0.14]], x, 0, z, { segments: 10 });
    }
  }
  // Girders across the posts, joists along, boards over: all of it seen from below.
  const under = times(PAL.timber, 0.95);
  for (const z of postZ) box(wood, under, -8.35, 8.35, F - 1.05, F - 0.42, z - 0.27, z + 0.27, { grain: 'x' });
  for (const x of [-8, ...[-6, -4, -2, 0, 2, 4, 6], 8]) box(wood, times(under, 1.1), x - 0.13, x + 0.13, F - 0.46, F - 0.12, -6.5, VZ + 0.1, { grain: 'z' });
  // Bracing, which is what keeps a tall stilt frame from racking.
  const braceC = times(PAL.timber, 0.98);
  for (const z of [-6.2, 6.2]) {
    for (let i = 0; i < 3; i += 2) {
      const a = postX[i]; const c = postX[i + 1];
      bar(wood, braceC, [a, 1.1, z], [c, F - 1.1, z], 0.26, 0.26, {});
      bar(wood, braceC, [c, 1.1, z + 0.12], [a, F - 1.1, z + 0.12], 0.26, 0.26, {});
    }
  }
  for (const x of [-7.6, 7.6]) {
    for (let i = 0; i < 2; i++) {
      const a = postZ[i]; const c = postZ[i + 1];
      bar(wood, braceC, [x, 1.1, a], [x, F - 1.1, c], 0.26, 0.26, {});
      bar(wood, braceC, [x + 0.12, 1.1, c], [x + 0.12, F - 1.1, a], 0.26, 0.26, {});
    }
  }
  // Deck boards: a closed slab and real boards on the veranda.
  box(wood, times(PAL.dark, 1), -8.3, 8.3, F - 0.13, F - 0.02, -6.55, VZ, { flat: true });
  let bx = -8.3;
  while (bx < 8.29) {
    const nx = Math.min(8.3, bx + 0.78);
    box(wood, jitter(rng, times(PAL.timber, 1.25), 0.1), bx + 0.015, nx - 0.015, F - 0.08, F, -6.55, VZ, { grain: 'z' });
    bx = nx;
  }
  // Bamboo framing on the wall: nodes are a tint, and they are most of what says bamboo.
  const nodes = (x, y, z, out) => {
    const f = ((y + x * 0.7 + z * 0.7) / 1.3) % 1;
    const ph = f < 0 ? f + 1 : f;
    if (ph < 0.08) { out[0] *= 0.6; out[1] *= 0.56; out[2] *= 0.46; }
  };
  const bam = (a, c, r = 0.13, rows = 8) => pole(wood, jitter(rng, pale, 0.08), a, c, r, { sides: 7, rows, tint: nodes });
  for (const x of [-RX, -2.55, 2.55, RX]) {
    if (Math.abs(x) < RX) { bam([x, F, RZ1 + 0.14], [x, inner(x, RZ1), RZ1 + 0.14], 0.14); bam([x, F, RZ0 - 0.14], [x, inner(x, RZ0), RZ0 - 0.14], 0.14); }
  }
  for (const y of [F + 0.15, F + 3.0, F + 6.45]) {
    pole(wood, jitter(rng, pale, 0.08), [-RX - 0.1, y, RZ1 + 0.14], [door.a0 - 0.05, y, RZ1 + 0.14], 0.11, { sides: 7, rows: 3, tint: y > F + 6 ? nodes : null });
    pole(wood, jitter(rng, pale, 0.08), [door.a1 + 0.05, y, RZ1 + 0.14], [RX + 0.1, y, RZ1 + 0.14], 0.11, { sides: 7, rows: 3 });
    pole(wood, jitter(rng, pale, 0.08), [-RX - 0.1, y, RZ0 - 0.14], [RX + 0.1, y, RZ0 - 0.14], 0.11, { sides: 7, rows: 3 });
    for (const x of [-RX, RX]) pole(wood, jitter(rng, pale, 0.08), [x + Math.sign(x) * 0.14, y, RZ0 - 0.1], [x + Math.sign(x) * 0.14, y, RZ1 + 0.1], 0.11, { sides: 7, rows: 3 });
  }
  // The real doorway, framed and lintelled, with its leaf hung open against the inside wall.
  const dF = times(PAL.timber, 1.15);
  sideBox(wood, dF, '+z', door.a0 - 0.1, door.a0 + 0.08, F, door.y1 + 0.1, RZ1 - 0.18, RZ1 + 0.2);
  sideBox(wood, dF, '+z', door.a1 - 0.08, door.a1 + 0.1, F, door.y1 + 0.1, RZ1 - 0.18, RZ1 + 0.2);
  sideBox(wood, dF, '+z', door.a0 - 0.1, door.a1 + 0.1, door.y1 - 0.08, door.y1 + 0.1, RZ1 - 0.18, RZ1 + 0.2, { grain: 'h' });
  box(wood, dF, door.a0 - 0.1, door.a1 + 0.1, F, F + 0.1, RZ1 - 0.18, RZ1 + 0.2, { grain: 'x' });
  doorLeaf(wood, times(0xa67c4c, 1.1), [door.a0 + 0.1, RZ1 - 0.14], 2.8, F + 0.08, door.y1 - 0.1, -Math.PI * 0.5 - 0.15, { ledges: 2 });
  // Shuttered windows either side of it and on the ends, framed in timber, closed against the sun.
  const shutter = (side, a0, a1, n) => {
    const y0 = F + 2.5; const y1 = F + 4.8;
    sideBox(wood, times(0xa67c4c, 1.05), side, a0, (a0 + a1) / 2 - 0.02, y0, y1, n - 0.2, n + 0.12);
    sideBox(wood, times(0x9a7145, 1.05), side, (a0 + a1) / 2 + 0.02, a1, y0, y1, n - 0.2, n + 0.12);
    sideBox(wood, dF, side, a0 - 0.14, a1 + 0.14, y1, y1 + 0.16, n - 0.2, n + 0.2, { grain: 'h' });
    sideBox(wood, dF, side, a0 - 0.14, a1 + 0.14, y0 - 0.16, y0, n - 0.2, n + 0.2, { grain: 'h' });
    sideBox(wood, dF, side, a0 - 0.14, a0, y0, y1, n - 0.2, n + 0.2);
    sideBox(wood, dF, side, a1, a1 + 0.14, y0, y1, n - 0.2, n + 0.2);
  };
  shutter('+z', -5.4, -3.2, RZ1);
  shutter('+z', 3.2, 5.4, RZ1);
  shutter('-z', -1.1, 1.1, -RZ0);
  shutter('+x', -3.0, -0.8, RX);
  shutter('-x', -3.0, -0.8, RX);

  // --- the veranda rail ---------------------------------------------------------------------------
  const railZ = VZ - 0.14;
  const gap = 1.05;
  for (const y of [F + 3.0, F + 1.55]) {
    bam([-RX - 0.1, y, railZ], [-gap, y, railZ], 0.1, 3);
    bam([gap, y, railZ], [RX + 0.1, y, railZ], 0.1, 3);
    for (const x of [-RX - 0.05, RX + 0.05]) bam([x, y, RZ1], [x, y, railZ], 0.1, 2);
  }
  for (let x = -7.2; x <= 7.21; x += 1.2) {
    if (Math.abs(x) < gap) continue;
    bam([x, F, railZ], [x, F + 3.0, railZ], 0.075, 2);
  }
  for (const s of [-1, 1]) bam([s * gap, F - 0.1, railZ], [s * gap, F + 3.35, railZ], 0.12, 3);

  // --- the ladder, a bamboo one, up to the gap in the rail ------------------------------------------
  const lk = 0.195; const lz = (y) => 8.08 - lk * y;
  ladder(wood, pale, [0, -0.2, lz(-0.2)], [0, F + 1.9, lz(F + 1.9)], 1.5, 9, { axis: 'x', r: 0.13, rr: 0.075 });
  for (const s of [-1, 1]) bead(wood, times(PAL.dark, 1.2), s * 0.75, F + 0.15, lz(F + 0.15), 0.19, { sx: 1, sy: 1.2, sz: 1, w: 7, h: 5 });

  // --- the roof --------------------------------------------------------------------------------------
  const straw = times(PAL.thatch, 1.22);
  const uC = times(0xa98a58, 1.25);
  thatchRoof(thatch, roof, {
    colSide: 14, colHip: 18, rows: 18,
    tint: (x, y, z, out, tp, u) => {
      const n = smoothNoise3(x * 0.42, y * 0.55, z * 0.42);
      const k = 0.78 + n * 0.3 + (smoothNoise3(x * 1.1, 2.5, z * 1.1) - 0.5) * 0.16;
      const age = sstep(tp, 0.5, 1) * 0.34;
      out[0] = mix(straw[0] * k * (1 - age * 0.74), uC[0], u);
      out[1] = mix(straw[1] * k * (1 - age), uC[1], u);
      out[2] = mix(straw[2] * k * (1 - age * 1.15), uC[2], u);
    },
  });
  thatchRidge(thatch, roof, { half: 5.5, width: 1.0, zig: 1.4, zigDepth: 0.3, lift: 0.28, color: times(PAL.thatch, 1.14) });
  // Bamboo sways holding the ridge down, the way a palm or grass roof is pinned.
  for (let x = -4.72; x <= 4.73; x += 1.18) {
    const pts = [-1.4, 0, 1.4].map((z) => [x, roof.outer(x, z) + 0.34, z]);
    bar(thatch, times(0xb09060, 1.25), pts[0], pts[1], 0.08, 0.06, { flat: true });
    bar(thatch, times(0xb09060, 1.25), pts[1], pts[2], 0.08, 0.06, { flat: true });
  }
  // Rafters inside, bamboo.
  for (let x = -6.6; x <= 6.61; x += 2.2) {
    for (const s of [-1, 1]) {
      const z1 = s > 0 ? 6.2 : -6.3;
      const pts = [0, s * 3, z1].map((z) => [x, roof.inner(x, z) - 0.1, z]);
      pole(wood, jitter(rng, pale, 0.1), pts[0], pts[1], 0.1, { sides: 6, rows: 2 });
      pole(wood, jitter(rng, pale, 0.1), pts[1], pts[2], 0.1, { sides: 6, rows: 2 });
    }
  }
  bam([-5.2, roof.inner(0, 0) - 0.15, 0], [5.2, roof.inner(0, 0) - 0.15, 0], 0.17, 6);
  // Tie beams at wall head and veranda head.
  for (const x of [-6.6, -2.2, 2.2, 6.6]) box(wood, times(PAL.timber, 1.15), x - 0.2, x + 0.2, F + 5.35, F + 5.8, RZ0 - 0.1, RZ1 + 0.1, { grain: 'z' });

  // --- inside: a low table, cushions, a chest; a broom and a water jar on the veranda ----------------
  table(wood, 1.2, -2.0, 2.0, 1.3, F + 1.1, times(0x9a6e42, 1.2), F + 0.05);
  softBox(wood, 0xa23b2a, -1.7, F + 0.22, -2.0, 0.85, 0.16, 0.85, 0.1, { segs: [3, 2, 3] });
  softBox(wood, 0x2f6fae, 4.0, F + 0.22, -2.0, 0.85, 0.16, 0.85, 0.1, { segs: [3, 2, 3] });
  bowl(wood, 1.2, F + 1.1, -2.0, 0.42, 0xb9894f);
  softBox(wood, times(PAL.timber, 0.95), -5.4, F + 0.7, -4.6, 1.3, 0.65, 0.8, 0.05, { segs: [3, 3, 3], flat: false, grain: 'x' });
  pot(wood, -5.2, F, 4.6, 0.62, 0x8f5535);
  pot(wood, -6.4, F, 5.3, 0.42, 0x6b3f2a);

  // --- on the ground, in the shade: storage baskets, a bench, cut bamboo -----------------------------
  const basket = (x, z, r, h) => {
    const prof = [[0, 0.02], [r * 0.72, 0.02], [r * 0.86, h * 0.18], [r, h * 0.55], [r * 0.92, h * 0.86], [r * 0.82, h * 0.98], [r * 0.86, h], [r * 0.78, h + 0.05], [r * 0.7, h * 0.97], [r * 0.66, h * 0.9], [0, h * 0.86]];
    const g = lathe(prof, 16);
    g.translate(x, 0, z);
    const P = g.attributes.position;
    const uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      uv[i * 2] = (Math.abs(Math.atan2(P.getX(i) - x, P.getZ(i) - z)) * r) / weave.t.feet[0] * 2.8;
      uv[i * 2 + 1] = P.getY(i) / weave.t.feet[1] * 2.8;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    paintColor(g, jitter(rng, times(0xc49a56, 1.2), 0.08), (px, y, pz, out) => { const f = y / h; if (f > 0.42 && f < 0.56) { out[0] *= 0.42; out[1] *= 0.35; out[2] *= 0.3; } });
    weave.parts.push({ geometry: g, keepColor: true });
  };
  basket(-3.8, -2.2, 1.25, 1.9);
  basket(-1.4, -3.1, 0.95, 1.5);
  basket(-5.1, -3.7, 0.85, 1.25);
  basket(3.6, 2.0, 1.1, 1.65);
  // A work bench, and a bundle of cut bamboo in the shade.
  box(wood, times(0xa67c4c, 1.1), 1.2, 5.6, 1.55, 1.75, -3.8, -2.6, { grain: 'x' });
  for (const x of [1.5, 5.3]) for (const z of [-3.6, -2.8]) box(wood, times(0x9a7145, 1), x - 0.1, x + 0.1, 0.02, 1.55, z - 0.1, z + 0.1);
  for (let i = 0; i < 8; i++) {
    const y = 0.14 + (i > 4 ? 0.24 : 0);
    const x = -1.2 + (i % 5) * 0.27 + (i > 4 ? 0.14 : 0);
    pole(wood, jitter(rng, pale, 0.1), [x, y, 0.6 + rng() * 0.2], [x + 0.1, y, 5.4 + rng() * 0.3], 0.13, { sides: 7, rows: 6 });
  }

  return assemble([[weave, {}], [thatch, {}], [wood, {}]]);
}

// ---------------------------------------------------------------------------------------------
// The red barn
// ---------------------------------------------------------------------------------------------
function redBarn() {
  const rng = seededRandom(1880);
  const boards = bag(boardTile());
  const wood = bag(woodTile(29));
  const roofB = bag(shingleTile(63));
  const hay = bag(strawTile());

  const HX = 14.5; const Z0 = -19.4; const Z1 = 18.95; const WT = 0.35;
  const EAVE = 13.9;
  const red = times(PAL.red, 1.3);
  const rawIn = times(PAL.timber, 1.6);
  const white = times(PAL.white, 0.94);
  const redTint = (x, y, z, out, nx, ny, nz, outward2) => {
    const n = smoothNoise3(x * 0.2 + z * 0.2, y * 0.25, 1.5);
    const k = 0.84 + n * 0.3;
    const facing = outward2(x, z, nx, nz);
    const c = facing ? red : rawIn;
    out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
    if (facing) {
      // Splash at the foot, weathered paler under the eave.
      const d = 1 - sstep(y, 0.3, 2.4);
      out[0] *= 1 - d * 0.25; out[1] *= 1 - d * 0.22; out[2] *= 1 - d * 0.18;
    }
  };
  const zOut = (x, z, nx, nz) => nz * z > 0;
  const xOut = (x, z, nx) => nx * x > 0;
  // Side walls.
  for (const s of [-1, 1]) {
    box(boards, red, s > 0 ? HX - WT : -HX, s > 0 ? HX : -HX + WT, 0.0, EAVE, Z0, Z1, {
      segs: [1, 6, 16], tint: (x, y, z, out, nx, ny, nz) => redTint(x, y, z, out, nx, ny, nz, xOut),
    });
  }
  // Gable profile, inside faces of the roof: the walls run up under it.
  const gamb = (o = 0) => [[-HX, EAVE - 0.05], [HX, EAVE - 0.05], [9.65 - o, 23.4], [0, 29.55 - o], [-9.65 + o, 23.4]];
  // The +Z gable: lower wall round the big opening, then the gambrel over it.
  const bigDoor = { a0: -6, a1: 6, y0: 0, y1: 11.6 };
  const hayDoor = { a0: -2.5, a1: 2.5, y0: 15.7, y1: 21.2 };
  for (const [p, q, y0, y1] of rectsAround(-HX + WT, HX - WT, 0, EAVE, [bigDoor])) {
    box(boards, red, p, q, y0, y1, Z1 - WT, Z1, { segs: [Math.max(1, Math.round((q - p) / 3)), 4, 1], tint: (x, y, z, out, nx, ny, nz) => redTint(x, y, z, out, nx, ny, nz, zOut) });
  }
  const gableTint = (x, y, z, out, nx, ny, nz) => {
    const facing = nz * z > 0;
    const c = facing ? red : rawIn;
    const k = 0.86 + smoothNoise3(x * 0.2, y * 0.25, 3.5) * 0.28;
    out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k;
  };
  prism(boards, red, gamb(), 'z', Z1 - WT, Z1, { tint: gableTint, grainAlongRun: true });
  // The -Z gable, whole.
  box(boards, red, -HX + WT, HX - WT, 0.0, EAVE, Z0, Z0 + WT, { segs: [10, 5, 1], tint: (x, y, z, out, nx, ny, nz) => redTint(x, y, z, out, nx, ny, nz, zOut) });
  prism(boards, red, gamb(), 'z', Z0, Z0 + WT, { tint: gableTint });
  // A low stone-grey skirt round the foot, down to where uneven ground will meet it.
  const skirt = times(PAL.stone, 1.05);
  const sk = (x0, x1, z0, z1) => box(wood, skirt, x0, x1, -0.4, 0.62, z0, z1, { flat: true, tint: (x, y, z, out) => { const k = 0.8 + smoothNoise3(x * 0.6, y, z * 0.6) * 0.35; out[0] *= k; out[1] *= k; out[2] *= k; }, segs: [Math.max(1, Math.round((x1 - x0) / 2)), 1, Math.max(1, Math.round((z1 - z0) / 2))] });
  sk(-HX - 0.1, -HX + 0.2, Z0 - 0.1, Z1 + 0.1);
  sk(HX - 0.2, HX + 0.1, Z0 - 0.1, Z1 + 0.1);
  sk(-HX, HX, Z0 - 0.1, Z0 + 0.2);
  sk(-HX, bigDoor.a0, Z1 - 0.2, Z1 + 0.1);
  sk(bigDoor.a1, HX, Z1 - 0.2, Z1 + 0.1);

  // --- the roof --------------------------------------------------------------------------------------
  const RX = 15; const RZ0 = -19.95; const RZ1 = 19.5; const SL = 0.32;
  const kneeX = 9.9; const kneeY = 23.55; const PEAK = 30;
  const outerLine = [[-RX, 12.95], [-kneeX, kneeY], [0, PEAK], [kneeX, kneeY], [RX, 12.95]];
  const inset = (dx, dy) => [[RX - dx, 12.95 - dy], [kneeX - dx * 0.35, kneeY - dy], [0, PEAK - dy], [-kneeX + dx * 0.35, kneeY - dy], [-RX + dx, 12.95 - dy]];
  const poly = [...outerLine, ...inset(0.03, SL + 0.02)];
  const shingleC = times(0x4c4d52, 1.45);
  const ridgeSag = (o) => {
    const f = o[2] / 20;
    o[1] += -0.16 * (1 - f * f) * sstep(o[1], 20, 30) + (smoothNoise3(o[0] * 0.2, 1.5, o[2] * 0.2) - 0.5) * 0.12;
  };
  prism(roofB, shingleC, poly, 'z', RZ0, RZ1, {
    along: 16, runStep: 2.4, warp: ridgeSag,
    tint: (x, y, z, out, nx, ny) => {
      const k = 0.88 + smoothNoise3(x * 0.25, y * 0.25, z * 0.25) * 0.24;
      out[0] *= k; out[1] *= k; out[2] *= k;
      if (ny < -0.1) { out[0] *= 0.7; out[1] *= 0.7; out[2] *= 0.7; }
    },
  });
  // Boards under the shingles, the view from the aisle.
  const a1 = inset(0.05, SL + 0.03);
  const a2 = inset(0.12, SL + 0.14);
  prism(wood, times(PAL.timber, 1.6), [...a1, ...[...a2].reverse()], 'z', RZ0 + 0.08, RZ1 - 0.08, { grainAlongRun: false, warp: ridgeSag });
  // White fascia up both gable edges, and the corner boards.
  for (const z of [RZ0 - 0.02, RZ1 + 0.02]) {
    for (let k = 0; k < 4; k++) {
      const A = outerLine[k]; const B = outerLine[k + 1];
      const f0 = k === 0 ? 0.04 : 0; const f1 = k === 3 ? 0.96 : 1;
      bar(wood, white, [mix(A[0], B[0], f0), mix(A[1], B[1], f0) - 0.2, z], [mix(A[0], B[0], f1), mix(A[1], B[1], f1) - 0.2, z], 0.1, 0.5, { up: [0, 1, 0], flat: true });
    }
  }
  for (const s of [-1, 1]) {
    bar(wood, white, [s * (RX - 0.03), 12.7, RZ0], [s * (RX - 0.03), 12.7, RZ1], 0.12, 0.42, { up: [0, 1, 0], flat: true });
    for (const z of [Z0, Z1]) {
      box(wood, white, s * HX - 0.45, s * HX + 0.09, 0.62, EAVE, z - 0.08 + (z > 0 ? 0 : 0), z + 0.08, { flat: true });
      const nz = Math.sign(z);
      box(wood, white, s * HX - 0.08, s * HX + 0.09, 0.62, EAVE, z - nz * 0.55, z + nz * 0.08, { flat: true });
    }
  }
  box(wood, times(shingleC, 0.8), -0.38, 0.38, PEAK - 0.05, PEAK + 0.04, RZ0, RZ1, { grain: 'z' });

  // --- the sliding doors, standing open on their track --------------------------------------------------
  const trackY = 12.1; const zD = Z1 + 0.16;
  box(wood, times(PAL.iron, 1.4), -13.2, 13.2, trackY - 0.08, trackY + 0.08, Z1 + 0.05, Z1 + 0.22, { flat: true });
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 6.15 : -12.75; const x1 = s > 0 ? 12.75 : -6.15;
    const cx = (x0 + x1) / 2;
    box(boards, times(PAL.red, 1.25), x0, x1, 0.25, 11.7, zD, zD + 0.14, { segs: [2, 2, 1], tint: (x, y, z, out) => { const k = 0.85 + smoothNoise3(x * 0.3, y * 0.3, 7.5) * 0.3; out[0] *= k; out[1] *= k; out[2] *= k; } });
    const zT = zD + 0.14; const zTT = zT + 0.09;
    for (const [a0, a1b, y0, y1] of [[x0, x1, 0.25, 0.75], [x0, x1, 11.2, 11.7], [x0, x1, 5.72, 6.2], [x0, x0 + 0.46, 0.25, 11.7], [x1 - 0.46, x1, 0.25, 11.7]]) {
      box(wood, white, a0, a1b, y0, y1, zT, zTT, { flat: true });
    }
    const zB2 = zT + 0.04;
    for (const [y0, y1] of [[0.75, 5.72], [6.2, 11.2]]) {
      bar(wood, white, [x0 + 0.46, y0, zB2], [x1 - 0.46, y1, zB2], 0.38, 0.07, { up: [0, 0, 1], flat: true });
      bar(wood, white, [x1 - 0.46, y0, zB2], [x0 + 0.46, y1, zB2], 0.38, 0.07, { up: [0, 0, 1], flat: true });
    }
    for (const x of [x0 + 1, x1 - 1]) {
      box(wood, PAL.iron, x - 0.06, x + 0.06, 11.4, trackY - 0.02, zD + 0.14, zD + 0.2, { flat: true });
      pole(wood, PAL.iron, [x, trackY + 0.02, Z1 + 0.05], [x, trackY + 0.02, Z1 + 0.32], 0.16, { sides: 10, flat: true });
    }
  }
  // White trim round the opening itself, with a lintel.
  for (const x of [bigDoor.a0, bigDoor.a1]) box(wood, white, x - 0.18, x + 0.18, 0.05, bigDoor.y1 + 0.2, Z1 - WT - 0.06, Z1 + 0.05, { flat: true });
  box(wood, white, bigDoor.a0 - 0.18, bigDoor.a1 + 0.18, bigDoor.y1 - 0.05, bigDoor.y1 + 0.32, Z1 - WT - 0.06, Z1 + 0.05, { flat: true });

  // --- the hay door, hoist beam and pulley over it ----------------------------------------------------
  const zH = Z1 + 0.02;
  box(boards, times(PAL.red, 1.2), hayDoor.a0, hayDoor.a1, hayDoor.y0, hayDoor.y1, Z1 - 0.1, zH + 0.05, { tint: (x, y, z, out) => { const k = 0.88 + smoothNoise3(x * 0.3, y * 0.3, 5.5) * 0.24; out[0] *= k; out[1] *= k; out[2] *= k; } });
  const hzT = zH + 0.05;
  for (const [a, c, y0, y1] of [[hayDoor.a0 - 0.1, hayDoor.a1 + 0.1, hayDoor.y0 - 0.1, hayDoor.y0 + 0.3], [hayDoor.a0 - 0.1, hayDoor.a1 + 0.1, hayDoor.y1 - 0.3, hayDoor.y1 + 0.1], [hayDoor.a0 - 0.1, hayDoor.a0 + 0.3, hayDoor.y0, hayDoor.y1], [hayDoor.a1 - 0.3, hayDoor.a1 + 0.1, hayDoor.y0, hayDoor.y1], [-0.14, 0.14, hayDoor.y0, hayDoor.y1]]) {
    box(wood, white, a, c, y0, y1, hzT - 0.04, hzT + 0.07, { flat: true });
  }
  for (const s of [-1, 1]) {
    const xa = s < 0 ? hayDoor.a0 + 0.3 : 0.14; const xb = s < 0 ? -0.14 : hayDoor.a1 - 0.3;
    bar(wood, white, [xa, hayDoor.y0 + 0.3, hzT + 0.02], [xb, hayDoor.y1 - 0.3, hzT + 0.02], 0.26, 0.06, { up: [0, 0, 1], flat: true });
    bar(wood, white, [xb, hayDoor.y0 + 0.3, hzT + 0.02], [xa, hayDoor.y1 - 0.3, hzT + 0.02], 0.26, 0.06, { up: [0, 0, 1], flat: true });
  }
  const hoistY = 25.2;
  box(wood, times(PAL.dark, 1.2), -0.3, 0.3, hoistY - 0.4, hoistY + 0.4, 12.0, 20.15, { grain: 'z' });
  bar(wood, times(PAL.dark, 1.2), [0, hoistY - 0.4, Z1 + 0.04], [0, 22.9, Z1 + 0.04], 0.3, 0.3, {});
  bar(wood, times(PAL.dark, 1.2), [0, hoistY - 0.3, 19.7], [0, 23.0, Z1 + 0.06], 0.26, 0.26, {});
  pole(wood, PAL.iron, [-0.09, hoistY - 0.72, 19.8], [0.09, hoistY - 0.72, 19.8], 0.3, { sides: 12, flat: true });
  box(wood, PAL.iron, -0.05, 0.05, hoistY - 0.72, hoistY - 0.38, 19.74, 19.86, { flat: true });
  const rope = times(0xc8ad78, 1);
  pole(wood, rope, [0, hoistY - 0.9, 20.08], [0, 20.3, 20.08], 0.035, { sides: 5, flat: true });
  pole(wood, rope, [0, hoistY - 0.9, 19.52], [0, hayDoor.y1 + 0.2, 19.32], 0.035, { sides: 5, flat: true });
  pole(wood, PAL.iron, [0, 20.32, 20.08], [0, 19.85, 20.08], 0.05, { sides: 5, flat: true });

  // --- windows down the sides: frames with panes, proud on both faces ------------------------------
  const bays = [-18.6, -9.4, -0.2, 9.0, 18.2];
  for (let i = 0; i < 4; i++) {
    const zm = (bays[i] + bays[i + 1]) / 2;
    for (const side of ['+x', '-x']) {
      const a0 = zm - 1.1; const a1 = zm + 1.1; const y0 = 5.9; const y1 = 8.5;
      sideBox(wood, times(PAL.glass, 1.15), side, a0, a1, y0, y1, HX - WT - 0.03, HX + 0.03, { flat: true, tint: (x, y, z, out) => { const k = 1.0 + 1.1 * clamp01((y - y0) / (y1 - y0)); out[0] *= k; out[1] *= k * 1.05; out[2] *= k * 1.12; } });
      for (const [n0, n1] of [[HX - 0.02, HX + 0.1], [HX - WT - 0.1, HX - WT + 0.02]]) {
        sideBox(wood, white, side, a0 - 0.18, a1 + 0.18, y1, y1 + 0.2, n0, n1, { flat: true });
        sideBox(wood, white, side, a0 - 0.18, a1 + 0.18, y0 - 0.2, y0, n0, n1, { flat: true });
        sideBox(wood, white, side, a0 - 0.18, a0, y0, y1, n0, n1, { flat: true });
        sideBox(wood, white, side, a1, a1 + 0.18, y0, y1, n0, n1, { flat: true });
        sideBox(wood, white, side, zm - 0.05, zm + 0.05, y0, y1, n0, n1, { flat: true });
        sideBox(wood, white, side, a0, a1, (y0 + y1) / 2 - 0.05, (y0 + y1) / 2 + 0.05, n0, n1, { flat: true });
      }
    }
  }
  // Two high windows and a man door in the back wall, for the view down the aisle.
  for (const x of [-9.5, 9.5]) {
    const a0 = x - 1.1; const a1 = x + 1.1; const y0 = 5.9; const y1 = 8.5; const n = -Z0;
    sideBox(wood, times(PAL.glass, 1.15), '-z', a0, a1, y0, y1, n - WT - 0.03, n + 0.03, { flat: true, tint: (px, y, z, out) => { const k = 1.0 + 1.1 * clamp01((y - y0) / (y1 - y0)); out[0] *= k; out[1] *= k * 1.05; out[2] *= k * 1.12; } });
    for (const [n0, n1] of [[n - 0.02, n + 0.1], [n - WT - 0.1, n - WT + 0.02]]) {
      sideBox(wood, white, '-z', a0 - 0.18, a1 + 0.18, y1, y1 + 0.2, n0, n1, { flat: true });
      sideBox(wood, white, '-z', a0 - 0.18, a1 + 0.18, y0 - 0.2, y0, n0, n1, { flat: true });
      sideBox(wood, white, '-z', a0 - 0.18, a0, y0, y1, n0, n1, { flat: true });
      sideBox(wood, white, '-z', a1, a1 + 0.18, y0, y1, n0, n1, { flat: true });
      sideBox(wood, white, '-z', x - 0.05, x + 0.05, y0, y1, n0, n1, { flat: true });
    }
  }
  const nb = -Z0;
  sideBox(boards, times(PAL.red, 1.12), '-z', -1.6, 1.6, 0.25, 7, nb - 0.02, nb + 0.09, {});
  for (const [a, c, y0, y1] of [[-1.8, 1.8, 7, 7.3], [-1.8, -1.5, 0.25, 7], [1.5, 1.8, 0.25, 7], [-1.5, 1.5, 3.5, 3.8]]) sideBox(wood, white, '-z', a, c, y0, y1, nb + 0.09, nb + 0.16, { flat: true });
  sideBox(boards, times(PAL.timber, 1.35), '-z', -1.6, 1.6, 0.05, 7, nb - WT - 0.09, nb - WT + 0.02, {});
  for (const [a, c, y0, y1] of [[-1.8, 1.8, 7, 7.3], [-1.8, -1.6, 0.05, 7], [1.6, 1.8, 0.05, 7], [-1.6, 1.6, 3.5, 3.8]]) sideBox(wood, times(PAL.timber, 1.1), '-z', a, c, y0, y1, nb - WT - 0.16, nb - WT - 0.05, {});

  // --- the floor: packed earth down the aisle, straw in the stalls --------------------------------------
  const IX = HX - WT; const AISLE = 5.5;
  const earth = times(0x9a7a56, 1.35);
  box(hay, earth, -IX, IX, -0.4, 0.05, Z0 + WT, Z1 - WT + 0.3, { segs: [8, 1, 10], tint: (x, y, z, out) => { const k = 0.75 + smoothNoise3(x * 0.3, 1.5, z * 0.3) * 0.4; out[0] *= k; out[1] *= k * 0.96; out[2] *= k * 0.88; } });
  // A worn threshold.
  box(wood, times(PAL.stone, 1.1), bigDoor.a0, bigDoor.a1, -0.4, 0.09, Z1 - WT - 0.2, Z1 + 0.5, { flat: true, tint: (x, y, z, out) => { const k = 0.8 + smoothNoise3(x * 0.6, 2.5, z * 0.6) * 0.4; out[0] *= k; out[1] *= k; out[2] *= k; } });

  // --- the frame: posts up the aisle, loft floor over the stalls, trusses overhead -----------------------
  const postC = times(PAL.timber, 1.4);
  const LOFT = 10.2;
  const postH = 21.5;
  for (const z of bays) {
    for (const s of [-1, 1]) {
      box(wood, jitter(rng, postC, 0.08), s * AISLE - 0.3, s * AISLE + 0.3, 0.05, postH, z - 0.3, z + 0.3);
      // A knee brace up to the plate.
      for (const d of [-1, 1]) {
        if ((z === bays[0] && d < 0) || (z === bays[4] && d > 0)) continue;
        bar(wood, jitter(rng, postC, 0.08), [s * AISLE, postH - 3, z + d * 0.2], [s * AISLE, postH - 0.5, z + d * 2.7], 0.3, 0.3, {});
      }
    }
    // Loft beam, wall to post, either side.
    for (const s of [-1, 1]) {
      box(wood, jitter(rng, postC, 0.08), Math.min(s * AISLE, s * IX), Math.max(s * AISLE, s * IX), LOFT - 0.95, LOFT - 0.3, z - 0.26, z + 0.26, { grain: 'x' });
    }
    // The tie across the top of the aisle.
    box(wood, jitter(rng, postC, 0.08), -AISLE - 0.1, AISLE + 0.1, postH - 0.2, postH + 0.5, z - 0.26, z + 0.26, { grain: 'x' });
    // A king post to the ridge, and principal rafters along the roof's own line.
    box(wood, jitter(rng, postC, 0.08), -0.24, 0.24, postH + 0.5, PEAK - SL - 0.5, z - 0.2, z + 0.2);
    for (const s of [-1, 1]) {
      const p = [[s * (RX - 1), 14.2, z], [s * (kneeX - 0.2), kneeY - SL - 0.42, z], [0, PEAK - SL - 0.4, z]];
      bar(wood, jitter(rng, postC, 0.08), p[0], p[1], 0.34, 0.36, { up: [-s, 1, 0] });
      bar(wood, jitter(rng, postC, 0.08), p[1], p[2], 0.34, 0.36, { up: [s, 2, 0] });
      // Struts from post head to the knee.
      bar(wood, jitter(rng, postC, 0.08), [s * AISLE, postH, z], [s * (kneeX - 0.3), kneeY - SL - 0.5, z], 0.26, 0.26, {});
    }
  }
  // Common rafters between the trusses.
  for (let z = -16.4; z < 17; z += 4.6) {
    if (bays.some((b) => Math.abs(b - z) < 1)) continue;
    for (const s of [-1, 1]) {
      const p = [[s * (RX - 1), 14.25, z], [s * (kneeX - 0.2), kneeY - SL - 0.38, z], [0, PEAK - SL - 0.36, z]];
      bar(wood, postC, p[0], p[1], 0.18, 0.28, { up: [-s, 1, 0] });
      bar(wood, postC, p[1], p[2], 0.18, 0.28, { up: [s, 2, 0] });
    }
  }
  for (const s of [-1, 1]) {
    // The plates that carry it all down the length of the barn.
    box(wood, postC, s * AISLE - 0.28, s * AISLE + 0.28, postH - 0.1, postH + 0.5, bays[0], bays[4], { grain: 'z' });
    box(wood, postC, s * AISLE - 0.28, s * AISLE + 0.28, LOFT - 0.75, LOFT - 0.3, bays[0], bays[4], { grain: 'z' });
    // Joists, then the loft floor over the stalls.
    for (let z = bays[0] + 1.5; z < bays[4]; z += 1.8) {
      if (bays.some((b) => Math.abs(b - z) < 0.6)) continue;
      box(wood, times(postC, 0.95), Math.min(s * AISLE, s * IX), Math.max(s * AISLE, s * IX), LOFT - 0.62, LOFT - 0.2, z - 0.1, z + 0.1, { grain: 'x' });
    }
    box(wood, times(PAL.timber, 1.5), Math.min(s * (AISLE - 0.25), s * IX), Math.max(s * (AISLE - 0.25), s * IX), LOFT - 0.22, LOFT, Z0 + WT, Z1 - WT, { grain: 'x' });
  }

  // --- the stalls: half-height plank walls, a gate each ------------------------------------------------
  const stallH = 4.4;
  const planks = times(PAL.timber, 1.5);
  for (const s of [-1, 1]) {
    const xPost = s * AISLE; const xWall = s * IX;
    for (let i = 0; i < 4; i++) {
      const z0 = bays[i] + 0.3; const z1 = bays[i + 1] - 0.3;
      // The partition behind each post, wall to aisle.
      plankWall(wood, planks, 'x', Math.min(xPost, xWall), Math.max(xPost, xWall), 0.05, stallH, bays[i], rng, { n: 6 });
      // The front: a run of planks and a gate, swung open into the stall.
      const zGate = z0 + 4.2;
      plankWall(wood, planks, 'z', z0, zGate, 0.05, stallH, xPost, rng, { n: 6 });
      box(wood, postC, xPost - 0.14, xPost + 0.14, 0.05, stallH + 0.8, zGate, zGate + 0.25);
      const hinge = [xPost, z1];
      const swing = 0.85;
      const gLen = 3.7;
      const gx = s * Math.sin(swing) * gLen;
      const gz = -Math.cos(swing) * gLen;
      for (let k = 0; k < 4; k++) {
        const y = 0.6 + k * 1.1;
        bar(wood, jitter(rng, planks, 0.1), [hinge[0], y, hinge[1]], [hinge[0] + gx, y, hinge[1] + gz], 0.1, 0.5, {});
      }
      bar(wood, times(planks, 0.85), [hinge[0], 0.5, hinge[1]], [hinge[0] + gx, 4.3, hinge[1] + gz], 0.1, 0.34, {});
      // Fresh straw on the stall floor, a sheet rising off the ground with its edge sunk.
      const nx = 7; const nz = 8;
      const posS = []; const uvS = []; const colS = []; const idx = [];
      const xa = xPost + s * 0.3; const xb = xWall - s * 0.15;
      const base = times(PAL.wheat, 1.2);
      for (let a = 0; a <= nx; a++) {
        for (let c = 0; c <= nz; c++) {
          const px = mix(xa, xb, a / nx); const pz = mix(z0, z1, c / nz);
          const edge = Math.min(a, nx - a, c, nz - c);
          const hgt = edge === 0 ? -0.02 : 0.14 + smoothNoise3(px * 0.7, 1.5, pz * 0.7) * 0.55 * Math.min(1, edge / 2);
          posS.push(px, 0.05 + hgt, pz);
          uvS.push(px / hay.t.feet[0], pz / hay.t.feet[1]);
          const k2 = 0.85 + smoothNoise3(px * 0.9, 3.5, pz * 0.9) * 0.35;
          colS.push(base[0] * k2, base[1] * k2, base[2] * k2);
        }
      }
      for (let a = 0; a < nx; a++) {
        for (let c = 0; c < nz; c++) {
          const A = a * (nz + 1) + c; const B = A + 1; const D = A + nz + 1; const E = D + 1;
          idx.push(A, B, E, A, E, D);
        }
      }
      const gS = new THREE.BufferGeometry();
      gS.setAttribute('position', new THREE.Float32BufferAttribute(posS, 3));
      gS.setAttribute('uv', new THREE.Float32BufferAttribute(uvS, 2));
      gS.setAttribute('color', new THREE.Float32BufferAttribute(colS, 3));
      gS.setIndex(idx);
      gS.computeVertexNormals();
      if (gS.attributes.normal.getY(Math.floor(posS.length / 6)) < 0) { const fl = []; for (let t = 0; t < idx.length; t += 3) fl.push(idx[t], idx[t + 2], idx[t + 1]); gS.setIndex(fl); gS.computeVertexNormals(); }
      hay.parts.push({ geometry: gS, keepColor: true });
      // A feed trough on the outer wall.
      const zT = (z0 + z1) / 2;
      const tIn = xWall - s * 0.05; const tOut = xWall - s * 1.2;
      box(wood, times(PAL.timber, 0.95), Math.min(tIn, tOut), Math.max(tIn, tOut), 1.6, 1.72, zT - 1.6, zT + 1.6, { grain: 'z' });
      box(wood, times(PAL.timber, 0.85), Math.min(tOut - s * 0.08, tOut), Math.max(tOut - s * 0.08, tOut), 1.6, 2.5, zT - 1.6, zT + 1.6, { grain: 'z' });
      for (const dz of [-1.6, 1.6]) box(wood, times(PAL.timber, 0.85), Math.min(tIn, tOut), Math.max(tIn, tOut), 1.6, 2.5, zT + dz - 0.05, zT + dz + 0.05);
      for (const dz of [-1.4, 1.4]) box(wood, times(PAL.timber, 0.8), Math.min(tOut, tOut + s * 0.14), Math.max(tOut, tOut + s * 0.14), 0.05, 1.6, zT + dz - 0.07, zT + dz + 0.07);
      softBox(hay, times(PAL.wheat, 1.15), (tIn + tOut) / 2, 2.15, zT, 0.5, 0.42, 1.45, 0.2, { segs: [3, 2, 5], flat: false, grain: 'z' });
    }
    // The end partition of the last stall.
    plankWall(wood, planks, 'x', Math.min(xPost, xWall), Math.max(xPost, xWall), 0.05, stallH, bays[4], rng, { n: 6 });
  }

  // --- the hay on the loft floors: a mound that climbs the wall, with bales along the edge ----------------
  const hayC = times(PAL.wheat, 1.26);
  for (const s of [-1, 1]) {
    const nx = 12; const nz = 34;
    const xa = s * (AISLE + 0.7); const xb = s * (IX - 0.05);
    const pos = []; const uv = []; const col = []; const idx = [];
    for (let a = 0; a <= nx; a++) {
      for (let c = 0; c <= nz; c++) {
        const f = a / nx;
        const px = mix(xa, xb, f); const pz = mix(Z0 + WT + 0.1, Z1 - WT - 0.1, c / nz);
        // It climbs the wall, but only as far as the roof lets it.
        const ax = Math.abs(px);
        const roofIn = ax > kneeX ? mix(kneeY, 12.95, (ax - kneeX) / (RX - kneeX)) : mix(PEAK, kneeY, ax / kneeX);
        const ceiling = roofIn - 1.0 - LOFT;
        const h = (f === 0 ? -0.03 : Math.min(ceiling, 0.5 + f * (2.0 + smoothNoise3(px * 0.2, 3.5, pz * 0.2) * 5.2) + (smoothNoise3(px * 0.6, 1.5, pz * 0.6) - 0.5) * 0.9));
        pos.push(px, LOFT + h, pz);
        uv.push(px / hay.t.feet[0], pz / hay.t.feet[1]);
        const k = 0.82 + smoothNoise3(px * 0.5, 8.5, pz * 0.5) * 0.4;
        col.push(hayC[0] * k, hayC[1] * k, hayC[2] * k);
      }
    }
    for (let a = 0; a < nx; a++) {
      for (let c = 0; c < nz; c++) {
        const A = a * (nz + 1) + c; const B = A + 1; const D = A + nz + 1; const E = D + 1;
        idx.push(A, B, E, A, E, D);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(Math.floor(pos.length / 6)) < 0) { const fl = []; for (let t = 0; t < idx.length; t += 3) fl.push(idx[t], idx[t + 2], idx[t + 1]); g.setIndex(fl); g.computeVertexNormals(); }
    hay.parts.push({ geometry: g, keepColor: true });
    // Bales, stacked two and three high along the edge, seen from the aisle below.
    for (let z = -17.5; z < 17; z += 3.2) {
      const tiers = 1 + Math.floor(rng() * 3);
      for (let t = 0; t < tiers; t++) {
        const x = s * (AISLE + 1.3 + (t % 2) * 0.1 + rng() * 0.2);
        const y = LOFT + 0.72 + t * 1.42;
        const zz = z + (t % 2) * 0.5 + rng() * 0.2;
        softBox(hay, jitter(rng, hayC, 0.12), x, y, zz, 0.88, 0.7, 1.48, 0.12, { segs: [3, 3, 3], flat: false, grain: 'z' });
        for (const d of [-0.62, 0.62]) {
          box(wood, times(0x7a6240, 1), x - 0.91, x + 0.91, y - 0.73, y + 0.73, zz + d - 0.03, zz + d + 0.03, { flat: true });
        }
      }
    }
    // Loose stalks hanging over the loft's edge, which is what tells you what the floor is holding.
    for (let z = Z0 + 1; z < Z1 - 1; z += 0.34) {
      if (rng() < 0.25) continue;
      const len = 0.35 + rng() ** 2 * 1.1;
      const x = s * (AISLE - 0.28 + rng() * 0.2);
      const zz = z + (rng() - 0.5) * 0.3;
      const tip = [x + (rng() - 0.5) * 0.3, LOFT - len, zz + (rng() - 0.5) * 0.3];
      pole(hay, jitter(rng, hayC, 0.16), [x, LOFT + 0.03, zz], tip, 0.05, { r2: 0.008, sides: 3 });
    }
  }
  // --- the loft ladder, a pitchfork, a bucket, a lantern ----------------------------------------------
  const ladC = times(PAL.timber, 1.45);
  ladder(wood, ladC, [-3.8, 0.0, 2.9], [-5.3, 11.6, 2.9], 1.5, 11, { axis: 'z', r: 0.11, rr: 0.07 });
  pole(wood, times(PAL.timber, 1), [5.1, 0.05, -5.2], [4.85, 5.4, -4.9], 0.06, { sides: 6 });
  for (const d of [-0.2, 0, 0.2]) pole(wood, PAL.iron, [5.13 + d * 0.1, 0.05, -5.3 + d], [5.08 + d * 0.1, 1.15, -5.2 + d], 0.03, { sides: 4, flat: true });
  box(wood, PAL.iron, 5.0, 5.2, 1.1, 1.22, -5.55, -4.85, { flat: true });
  turned(wood, times(0x8a6a48, 1.1), [[0, 0], [0.42, 0], [0.56, 0.95], [0.48, 0.97], [0.36, 0.15], [0, 0.13]], 4.3, 0.05, 11.8, { segments: 12 });
  pole(wood, PAL.iron, [0, postH - 0.2, -9.4], [0, 15.4, -9.4], 0.03, { sides: 4, flat: true });
  turned(wood, 0x2e2a26, [[0, 0], [0.26, 0], [0.26, 0.08], [0.12, 0.14], [0.14, 0.7], [0.24, 0.8], [0.04, 1.04], [0, 1.05]], 0, 14.35, -9.4, { segments: 8 });
  bead(wood, times(0xffc865, 1.3), 0, 14.75, -9.4, 0.12);

  return assemble([[boards, {}], [wood, {}], [roofB, {}], [hay, {}]]);
}

export const BUILDERS = {
  'thatched-cottage': thatchedCottage,
  'log-cabin': logCabin,
  'adobe-house': adobeHouse,
  'stilt-house': stiltHouse,
  'red-barn': redBarn,
};
