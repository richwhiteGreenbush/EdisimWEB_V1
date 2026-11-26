import * as THREE from 'three';
import { mesh, standard, group, relief, canvasTexture, seededRandom } from '../PropKit.js';
import { reducedMotion } from '../Settings.js';
import { mergeParts, smoothNoise3 } from './LoftKit.js';

// A Cabin Christmas: a log cabin in a snowy spruce forest at twilight, built from a photograph
// of a decorated tree beside a fieldstone fireplace. The arrival IS that photograph -- the tree
// against the big windows on the left, the fire on the right -- and everything outside is the
// view through those windows, which is the half of the picture that makes it Christmas.
//
// FOUR DECISIONS CARRY THE LOOK, and every builder in this file leans on one of them:
//
//  1. THE LIGHT IS WARM INSIDE AND BLUE OUTSIDE. The theme is a deep blue twilight, and the
//     only warm light in the world is what the props carry: the fire, the tree and the
//     chandelier, three point lights, which is the integrated-GPU discipline (see CLAUDE.md).
//     The contrast is the whole picture -- a warm room seen against blue snow.
//  2. A SPRUCE IS A STACK OF DROOPING BRANCH SKIRTS, NOT A CONE. `spruceTier` builds each whorl
//     as one CLOSED solid whose rim is lobed into separate branch tips that droop, with a
//     needle map along the branch. Snow is a per-vertex colour from the surface's own normal,
//     so it lies exactly on the upward faces of every branch and nowhere else.
//  3. LIGHTS ARE TWO THINGS: a bulb (unlit, so it is always bright) and a glow (an additive
//     point sprite). A bulb alone is a coloured bead; the glow is what reads as light.
//  4. EVERY SOLID IS CLOSED. Stones, cushions and gifts are rounded boxes with ANALYTIC
//     normals, so a rounded edge never creases where two of the box's faces meet.

const TAU = Math.PI * 2;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// The cabin's numbers, shared with the layout and with the falling snow (which must not fall
// through the roof). Everything in this world hangs off them.
export const CABIN = {
  halfW: 18, // walls at x = +-18 (log centre lines)
  halfD: 14, // walls at z = +-14
  eave: 11,
  ridge: 19,
  overhang: 2,
  logR: 0.5,
  course: 0.92,
};
// The toy train's circle. `forever { move forward 0.3, rotate 3 }` traces a circle whose radius
// is the chord formula, f / (2 sin(d/2)) -- 5.73ft -- and the track is laid on exactly that
// circle. Double BOTH numbers and the radius does not change, which is the activity board.
export const TRAIN_STEP = 0.3;
export const TRAIN_TURN = 3;
export const TRAIN_R = TRAIN_STEP / (2 * Math.sin((TRAIN_TURN / 2) * Math.PI / 180));
// The program walks a POLYGON: step, then turn. Its vertices lie on a circle of radius TRAIN_R
// whose centre is NOT a radius to the train's left but on the perpendicular bisector of its
// first step -- half a step ahead of that, and a hair nearer. Placed against the naive centre
// the train ran 0.15ft off its own rails (measured by tools/check-christmas.mjs).
export const TRAIN_CENTRE = [TRAIN_R * Math.cos((TRAIN_TURN / 2) * Math.PI / 180), TRAIN_STEP / 2];
export const TREE_HEIGHT = 13;
const TREE_BOTTOM = 0.22;
// Where the tree's leader ends, which is where the star prop stands: the top whorl's attachment
// height, from the same arithmetic spruceTiers uses.
export const TREE_TOP = TREE_HEIGHT * 0.94 + (TREE_HEIGHT * (0.94 - TREE_BOTTOM)) / 16 / 2;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// Scale, then roll, then pitch, then yaw, then move. Euler 'YXZ' is R = Ry * Rx * Rz, which is
// the order a part is actually authored in: shaped about its own axis, tipped, then turned to
// face where it goes. mergeParts' own `rotation` composes the other way (see CLAUDE.md).
function orient(geometry, { pos = [0, 0, 0], yaw = 0, pitch = 0, roll = 0, scale = null } = {}) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  const s = Array.isArray(scale) ? scale : [scale ?? 1, scale ?? 1, scale ?? 1];
  m.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...s));
  const g = geometry.clone();
  g.applyMatrix4(m);
  return g;
}

// Paints a geometry one flat colour (linear, from an sRGB hex), so a part can be merged with
// keepColor alongside parts tinted per vertex.
function paint(geometry, hex) {
  const c = new THREE.Color(hex);
  const n = geometry.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

// Per-vertex colour from a function of (position, normal) returning a THREE.Color.
function paintBy(geometry, fn) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const arr = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    if (nor) n.fromBufferAttribute(nor, i); else n.set(0, 1, 0);
    const c = fn(p, n, i);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

// Remaps a geometry's uv into a sub-rectangle of an atlas.
function atlasUV(geometry, u0, v0, du, dv, scaleU = 1, scaleV = 1) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    // No modulo at scale 1: a face's far edge has u = 1, and 1 % 1 is 0, which would fold the
    // last row of the face back across the whole tile.
    const u = scaleU === 1 ? uv.getX(i) : (uv.getX(i) * scaleU) % 1;
    const v = scaleV === 1 ? uv.getY(i) : (uv.getY(i) * scaleV) % 1;
    uv.setXY(i, u0 + (0.03 + u * 0.94) * du, v0 + (0.03 + v * 0.94) * dv);
  }
  uv.needsUpdate = true;
  return geometry;
}

function scaleUV(geometry, su, sv) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geometry;
}

// A box with rounded edges and ANALYTIC normals. Each vertex of a subdivided box is clamped to
// the inner box and pushed out to radius `r` along the clamp direction, and that direction IS
// the normal -- so the two copies a BoxGeometry keeps of every edge vertex (one per face) land
// on the same point with the same normal, and the rounded edge cannot crease.
// `e` segments go round each edge, `m` across each flat.
function roundedBox(w, h, d, r, e = 3, m = 2) {
  const n = 2 * e + m;
  const g = new THREE.BoxGeometry(2, 2, 2, n, n, n);
  const half = [w / 2, h / 2, d / 2];
  const rr = Math.min(r, ...half.map((v) => v * 0.98));
  const inner = half.map((v) => Math.max(1e-4, v - rr));
  const map = (s, k) => {
    const i = Math.round((s + 1) * n / 2);
    if (i <= e) return -inner[k] - rr * (1 - i / e);
    if (i >= n - e) return inner[k] + rr * (1 - (n - i) / e);
    return -inner[k] + (2 * inner[k] * (i - e)) / m;
  };
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const a = [map(pos.getX(i), 0), map(pos.getY(i), 1), map(pos.getZ(i), 2)];
    const c = a.map((v, k) => Math.max(-inner[k], Math.min(inner[k], v)));
    const dv = a.map((v, k) => v - c[k]);
    const L = Math.hypot(dv[0], dv[1], dv[2]);
    if (L > 1e-7) {
      pos.setXYZ(i, c[0] + (dv[0] / L) * rr, c[1] + (dv[1] / L) * rr, c[2] + (dv[2] / L) * rr);
      nor.setXYZ(i, dv[0] / L, dv[1] / L, dv[2] / L);
    } else {
      pos.setXYZ(i, a[0], a[1], a[2]);
    }
  }
  pos.needsUpdate = true;
  return g;
}

// Pushes every vertex along its own normal by a smooth function of POSITION. A function of
// position, never of vertex index: a BoxGeometry keeps separate copies of each edge vertex,
// and only a position-based field moves every copy identically (the puddingstone lesson).
function lumpy(geometry, amount, freq, seed = 0) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const k = (smoothNoise3(x * freq + seed, y * freq, z * freq - seed) - 0.5) * 2 * amount;
    pos.setXYZ(i, x + nor.getX(i) * k, y + nor.getY(i) * k, z + nor.getZ(i) * k);
  }
  pos.needsUpdate = true;
  return geometry;
}

// A parametric grid surface whose triangles are wound by MEASUREMENT, not by assumption: each
// triangle is tested against `outward(cx, cy, cz, u, v)` and flipped if it faces the other way.
// That is the Turkle Street rule -- a hand-built grid's winding depends on the handedness of
// its (row, column) order, and two patches of one object can silently disagree.
// `closedU` welds the normals of the duplicated seam column so a wrapped surface does not
// crease where u = 0 meets u = 1.
function paramSurface(nu, nv, fn, { closedU = false, outward = null } = {}) {
  const cols = nu + 1;
  const rows = nv + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / nu;
      const v = j / nv;
      const q = fn(closedU && i === nu ? 0 : u, v);
      const k = j * cols + i;
      pos[k * 3] = q[0]; pos[k * 3 + 1] = q[1]; pos[k * 3 + 2] = q[2];
      uvs[k * 2] = q[3] ?? u; uvs[k * 2 + 1] = q[4] ?? v;
      if (closedU && i === nu && q[5] != null) uvs[k * 2] = q[3] + q[5];
    }
  }
  const idx = [];
  const A = new THREE.Vector3(); const B = new THREE.Vector3(); const C = new THREE.Vector3();
  const e1 = new THREE.Vector3(); const e2 = new THREE.Vector3();
  const tri = (a, b, c) => {
    if (outward) {
      A.fromArray(pos, a * 3); B.fromArray(pos, b * 3); C.fromArray(pos, c * 3);
      e1.subVectors(B, A); e2.subVectors(C, A); e1.cross(e2);
      if (e1.lengthSq() > 1e-14) {
        const cx = (A.x + B.x + C.x) / 3; const cy = (A.y + B.y + C.y) / 3; const cz = (A.z + B.z + C.z) / 3;
        const ua = ((a % cols) + (b % cols) + (c % cols)) / (3 * nu);
        const va = (Math.floor(a / cols) + Math.floor(b / cols) + Math.floor(c / cols)) / (3 * nv);
        const o = outward(cx, cy, cz, ua, va);
        if (e1.x * o[0] + e1.y * o[1] + e1.z * o[2] < 0) { idx.push(a, c, b); return; }
      }
    }
    idx.push(a, b, c);
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * cols + i; const b = a + 1; const c = a + cols; const d = c + 1;
      tri(a, c, b); tri(b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setIndex(idx);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  if (closedU) {
    const nor = g.attributes.normal;
    for (let j = 0; j < rows; j++) {
      const a = j * cols; const b = a + nu;
      const x = nor.getX(a) + nor.getX(b); const y = nor.getY(a) + nor.getY(b); const z = nor.getZ(a) + nor.getZ(b);
      const L = Math.hypot(x, y, z) || 1;
      nor.setXYZ(a, x / L, y / L, z / L); nor.setXYZ(b, x / L, y / L, z / L);
    }
  }
  return g;
}

// A closed lathe from a profile listed BOTTOM-UP that starts and ends on the axis. three's own
// LatheGeometry is wound outward for a bottom-up profile -- the opposite of LoftKit.revolve,
// whose winding trap is recorded in CLAUDE.md -- so everything here goes through three's.
function lathe(profile, segments = 16) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments);
}

// An unlit sphere for a bulb. MeshBasic so it is bright whatever lights it.
function bead(r, detail = 6) {
  return new THREE.SphereGeometry(r, detail, Math.max(3, detail >> 1));
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function repeatTex(t, rx = 1, ry = 1) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

// Draws `fn(x, y)` at a point and at its wrapped copies, so a tile has no seam.
function wrapped(w, h, x, y, pad, fn) {
  for (const dx of [-w, 0, w]) {
    for (const dy of [-h, 0, h]) {
      if (x + dx < -pad || x + dx > w + pad || y + dy < -pad || y + dy > h + pad) continue;
      fn(x + dx, y + dy);
    }
  }
}

// Needles: fine strokes running along the branch (v) with a little splay, light and dark, on a
// mid grey. Near-white enough that the vertex green survives the multiply, contrasted enough to
// read as needles at ten feet.
function needleTexture(seed) {
  const rng = seededRandom(seed);
  return repeatTex(canvasTexture(256, 256, (ctx, w, h) => {
    // LIGHT, because the snow on a branch is this same texture under a white vertex colour, and
    // a dark needle map multiplies snow down to grey. The darkness of the needles is carried by
    // the vertex colour instead.
    ctx.fillStyle = '#e2e2e2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w; const y = rng() * h;
      const len = 7 + rng() * 13;
      const ang = Math.PI / 2 + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.45);
      const dark = rng() < 0.55;
      ctx.strokeStyle = dark ? `rgba(70,74,70,${0.25 + rng() * 0.25})` : `rgba(255,255,250,${0.55 + rng() * 0.4})`;
      ctx.lineWidth = 0.9 + rng() * 1.3;
      wrapped(w, h, x, y, 24, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
        ctx.stroke();
      });
    }
  }));
}

// Wood grain running along v, with knots. Near-white: the vertex colour carries the tone.
function grainTexture(seed, { w = 256, h = 512, seams = 0, base = 226 } = {}) {
  const rng = seededRandom(seed);
  return repeatTex(canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = `rgb(${base},${base - 4},${base - 10})`;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 140; i++) {
      const x = rng() * w;
      const tone = 150 + rng() * 90;
      ctx.strokeStyle = `rgba(${tone * 0.8},${tone * 0.62},${tone * 0.42},${0.18 + rng() * 0.3})`;
      ctx.lineWidth = 0.7 + rng() * 2.6;
      ctx.beginPath();
      let px = x;
      ctx.moveTo(px, 0);
      for (let y = 0; y <= h; y += 16) {
        px += (rng() - 0.5) * 2.4;
        ctx.lineTo(px, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 5; i++) {
      const x = rng() * w; const y = rng() * h; const r = 4 + rng() * 9;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      g.addColorStop(0, 'rgba(70,40,20,0.75)');
      g.addColorStop(0.35, 'rgba(120,75,40,0.45)');
      g.addColorStop(1, 'rgba(160,110,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r * 3.2, 0, 0, TAU); ctx.fill();
    }
    if (seams) {
      ctx.strokeStyle = 'rgba(60,35,18,0.85)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= seams; i++) {
        const x = (i / seams) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }
  }));
}

function glowTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// An additive glow sprite at every point, one draw call for the lot. `fog: false` because
// three fogs a fragment BEFORE blending, so a fogged additive glow adds the fog colour onto a
// background that is already the fog colour (the light-shaft lesson from Under the Sea).
function glowCloud(positions, colors, size) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeBoundingSphere();
  const m = new THREE.PointsMaterial({
    size, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
  });
  const p = new THREE.Points(g, m);
  p.castShadow = false;
  p.receiveShadow = false;
  return p;
}

// An unlit mesh for bulbs, flames and anything else that is a light rather than lit.
function unlit(geometry, params = {}) {
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, ...params }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------------------
// The spruce
// ---------------------------------------------------------------------------

// ONE WHORL OF BRANCHES as a closed solid. u runs round the trunk; v runs out along the top
// surface to the rim (v 0 -> 0.5) and back underneath to the trunk (0.5 -> 1), so the rim is
// shared and the whole whorl is watertight. The rim is lobed into `n` branch tips, each a
// little longer or shorter than its neighbours, and the tips droop further than the gaps.
// Branch length is BLENDED toward the neighbour at the gap, or the radius would jump where two
// branches of different length meet.
function spruceTier({ yTop, R, drop, thick, n, seed, nuPer = 7, nv = 12, upturn = 0.12 }) {
  const rng = seededRandom(seed);
  const len = Array.from({ length: n }, () => 0.8 + rng() * 0.32);
  const phase = rng();
  const at = (u, v) => {
    const a = u * TAU;
    const top = v <= 0.5;
    const s = top ? v / 0.5 : (1 - v) / 0.5;
    const bpos = u * n + phase;
    const k = Math.floor(bpos);
    const f = bpos - k;
    const lobe = Math.pow(Math.sin(Math.PI * f), 1.6);
    const kk = ((k % n) + n) % n;
    const nb = f < 0.5 ? (kk + n - 1) % n : (kk + 1) % n;
    const L = len[kk] * lobe + ((len[kk] + len[nb]) / 2) * (1 - lobe);
    // The sub-branches: a fine ripple on the rim, three or four per branch, which is what
    // breaks a whorl's outline from a starfish into something ragged.
    const wob = 1 + (0.05 * Math.sin(a * 7 + seed) + 0.07 * Math.sin(bpos * TAU * 3.5 + k) * lobe) * Math.pow(s, 1.5);
    let r = R * s * L * wob * (1 - 0.42 * Math.pow(s, 1.3) * (1 - lobe));
    let y = yTop - drop * Math.pow(s, 1.5) * (0.72 + 0.4 * lobe) + upturn * drop * Math.pow(s, 6) * lobe;
    if (!top) {
      y -= thick * Math.pow(1 - s, 0.8) * (0.55 + 0.45 * lobe);
      r *= 0.985;
    }
    return [Math.cos(a) * r, y, Math.sin(a) * r, u * n, s * 1.6, n, s, lobe, top ? 1 : 0];
  };
  const g = paramSurface(n * nuPer, nv, (u, v) => at(u, v), {
    closedU: true,
    outward: (cx, cy, cz, u, v) => (v <= 0.5 ? [cx * 0.5, 1, cz * 0.5] : [cx * 0.2, -1, cz * 0.2]),
  });
  // Keep (s, lobe, top) for the colour pass.
  const cols = n * nuPer + 1;
  const aux = new Float32Array(g.attributes.position.count * 3);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i < cols; i++) {
      const q = at(i === cols - 1 ? 0 : i / (cols - 1), j / nv);
      const k = j * cols + i;
      aux[k * 3] = q[6]; aux[k * 3 + 1] = q[7]; aux[k * 3 + 2] = q[8];
    }
  }
  g.userData.aux = aux;
  g.userData.at = at;
  g.userData.n = n;
  g.userData.phase = phase;
  return g;
}

// The shape of a whole spruce: whorl sizes, heights and droops. Shared by the decorated tree
// indoors and every snowy one outside.
function spruceTiers({ height, radius, tiers, seed, nuPer, nv, bottom = 0.12, droop = 0.55, lobes = 1.5 }) {
  const rng = seededRandom(seed);
  const spacing = (height * (0.94 - bottom)) / (tiers - 1);
  const list = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const yTop = height * bottom + spacing * i + spacing * 0.5;
    const R = Math.max(0.28, radius * Math.pow(1 - t, 0.92) * (0.92 + rng() * 0.14));
    const drop = Math.max(R * droop, spacing * 1.5);
    const n = Math.max(6, Math.round(6 + R * lobes));
    list.push({ yTop, R, drop, thick: drop * 0.55 + 0.1, n, seed: seed * 31 + i * 7, nuPer, nv });
  }
  return list;
}

const SNOW = new THREE.Color(0xeef3fb);

// Colours a whorl by where each vertex is on its branch. With `snow`, the upward-facing top
// surface takes a patchy cap of snow -- by NORMAL, so it lies on the branches' own upper faces.
function colourTier(g, { needles, tips, under, snow = 0, seed = 0 }) {
  const aux = g.userData.aux;
  const nor = g.attributes.normal;
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const s = aux[i * 3]; const lobe = aux[i * 3 + 1]; const top = aux[i * 3 + 2];
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const nz = smoothNoise3(x * 1.7 + seed, y * 1.7, z * 1.7);
    if (top) {
      c.copy(needles).lerp(tips, clamp01(Math.pow(s, 2.5) * lobe * 0.9 + (nz - 0.5) * 0.3));
      c.multiplyScalar(0.55 + 0.45 * Math.min(1, s * 1.6));
    } else {
      c.copy(under).multiplyScalar(0.75 + 0.25 * s);
    }
    if (snow && top) {
      const ny = nor.getY(i);
      const patch = smoothNoise3(x * 0.9 - seed, y * 0.9, z * 0.9 + seed);
      const k = smooth(0.15, 0.55, ny) * smooth(0.08, 0.35, s) * smooth(0.22, 0.5, patch + snow * 0.3);
      c.lerp(SNOW, clamp01(k * (0.8 + snow * 0.25)));
    }
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// SNOW WITH THICKNESS. A white vertex colour on the needles reads as frost; what makes a spruce
// read as snow-laden is the snow standing proud of the branch with an edge you can see. So the
// whorl's own top surface is copied and pushed out along its normal wherever snow lies, and
// pushed IN -- under the needles, out of sight -- wherever it does not. Where the two meet the
// copy dives through the branch, which is exactly the ragged edge of a snow patch. It reuses
// the whorl's own index, so it is wound the same way and cannot come out inside out.
function snowCap(tierGeom, { seed, snow, depth }) {
  const pos = tierGeom.attributes.position;
  const nor = tierGeom.attributes.normal;
  const aux = tierGeom.userData.aux;
  const index = tierGeom.index.array;
  const out = new Float32Array(pos.count * 3);
  const keep = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const top = aux[i * 3 + 2];
    if (!top) continue;
    keep[i] = 1;
    const s = aux[i * 3];
    const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
    const ny = nor.getY(i);
    const patch = smoothNoise3(x * 0.9 - seed, y * 0.9, z * 0.9 + seed);
    const k = smooth(0.25, 0.6, ny) * smooth(0.12, 0.4, s) * smooth(0.3, 0.55, patch + snow * 0.25);
    const off = k > 0.15 ? depth * (0.35 + 0.65 * k) * (1 - 0.6 * Math.pow(s, 3)) : -depth * 1.5;
    out[i * 3] = x + nor.getX(i) * off;
    out[i * 3 + 1] = y + Math.max(0, ny) * off + (off < 0 ? off : 0);
    out[i * 3 + 2] = z + nor.getZ(i) * off;
  }
  const idx = [];
  for (let t = 0; t < index.length; t += 3) {
    if (keep[index[t]] && keep[index[t + 1]] && keep[index[t + 2]]) idx.push(index[t], index[t + 1], index[t + 2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.setAttribute('uv', tierGeom.attributes.uv.clone());
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function trunkGeometry(height, r0) {
  const g = lathe([[0, -0.2], [r0 * 1.25, -0.2], [r0 * 1.1, 0.3], [r0, height * 0.3], [r0 * 0.55, height * 0.75], [r0 * 0.18, height * 0.97], [0, height * 0.98]], 12);
  return g;
}

// A spruce as two meshes (needles + trunk), with the tier list handed back so a decorator can
// ask the tree where its own branch tips are.
function buildSpruce({ height, radius, tiers, seed, nuPer, nv, snow, needles, tips, under, bottom, droop, lobes }) {
  const specs = spruceTiers({ height, radius, tiers, seed, nuPer, nv, bottom, droop, lobes });
  const parts = [];
  const tierGeoms = [];
  for (const spec of specs) {
    const g = colourTier(spruceTier(spec), { needles, tips, under, snow, seed: spec.seed });
    tierGeoms.push(g);
    parts.push({ geometry: g, keepColor: true });
  }
  const geometry = mergeParts(parts);
  return { geometry, specs, tierGeoms };
}

// A snow-laden spruce for the forest. `detail` is the araucaria trap answered up front: a tree
// planted fifty times costs fifty times its triangles, so the far ones are a third of the near.
export function snowSpruce({ height = 34, radius = 9, seed = 1, detail = 'near', snow = 1, lights = false } = {}) {
  const far = detail === 'far';
  const tiers = far ? 7 : Math.round(10 + height / 9);
  const { geometry, specs, tierGeoms } = buildSpruce({
    height, radius, tiers, seed,
    nuPer: far ? 3 : 4, nv: far ? 6 : 9,
    snow, lobes: 2.0,
    needles: new THREE.Color(0x17301d), tips: new THREE.Color(0x2c4f30), under: new THREE.Color(0x0c1a10),
    bottom: 0.07,
  });
  const g = group();
  const needleMat = standard({
    vertexColors: true, roughness: 0.92, map: needleTexture(seed * 3 + 5),
  });
  const crown = mesh(geometry, needleMat);
  // Far trees cast no shadow: the shadow map is a second full render of every caster, and a
  // tree 120ft out in the fog throws its shadow where nobody is standing.
  if (far) crown.castShadow = false;
  g.add(crown);
  const trunk = mesh(paint(trunkGeometry(height, Math.max(0.35, radius * 0.05)), 0x4a3324), standard({
    vertexColors: true, roughness: 0.95, ...relief('bark', { seed: seed + 3, repeat: 3 }),
  }));
  g.add(trunk);
  if (snow > 0) {
    const caps = tierGeoms.map((tg, t) => ({ geometry: snowCap(tg, { seed: seed + t, snow, depth: 0.16 + specs[t].R * 0.025 }), color: 0xffffff }));
    const capMesh = mesh(mergeParts(caps), standard({ vertexColors: true, color: 0xf1f5fc, roughness: 0.78, ...relief('stone', { seed: seed + 9, repeat: 6, strength: 0.3 }) }));
    g.add(capMesh);
  }
  if (lights) addTreeLights(g, specs, tierGeoms, { seed, count: Math.round(height * 9), palette: 'multi', size: 1.3, bulb: 0.11, inner: 0.1, detail: 10 });
  return g;
}

// Where a branch tip is: the top surface of whorl `t` at angle fraction u and reach s.
function tipPoint(spec, tierGeom, u, s) {
  const q = tierGeom.userData.at(u, s * 0.5);
  return new THREE.Vector3(q[0], q[1], q[2]);
}

// The angle fraction of branch k's centre line on a whorl.
function branchU(tierGeom, k) {
  const n = tierGeom.userData.n;
  return ((k + 0.5 - tierGeom.userData.phase) / n + 1) % 1;
}

const LIGHT_PALETTES = {
  warm: [[1.0, 0.72, 0.38]],
  multi: [[1.0, 0.16, 0.12], [0.12, 0.85, 0.25], [0.2, 0.42, 1.0], [1.0, 0.62, 0.08], [0.95, 0.2, 0.75], [1.0, 0.86, 0.3]],
};

// String lights laid on a tree's own branch surfaces: an unlit bead per bulb plus a glow, and a
// twinkle that reads the clock. `inner` is the share of bulbs set deep in the tree, which is
// what gives a lit tree DEPTH -- photographs of one are mostly the light inside it.
function addTreeLights(g, specs, tierGeoms, { seed, count, palette = 'warm', size = 0.7, bulb = 0.05, inner = 0.3, twinkle = true, detail = 6 }) {
  const rng = seededRandom(seed * 13 + 7);
  const pal = LIGHT_PALETTES[palette];
  const beads = [];
  const glowPos = [];
  const glowCol = [];
  const base = [];
  const phase = [];
  const total = specs.reduce((a, s) => a + s.R * s.R, 0);
  for (let i = 0; i < count; i++) {
    // Pick a whorl in proportion to its area, so the lights are even over the tree.
    let pick = rng() * total; let t = 0;
    while (t < specs.length - 1 && pick > specs[t].R * specs[t].R) { pick -= specs[t].R * specs[t].R; t++; }
    const deep = rng() < inner;
    const s = deep ? 0.25 + rng() * 0.3 : 0.55 + rng() * 0.43;
    const u = rng();
    const p = tipPoint(specs[t], tierGeoms[t], u, s);
    p.y += deep ? -0.2 : bulb * 0.9;
    const c = pal[Math.floor(rng() * pal.length)];
    beads.push({ geometry: paint(bead(bulb, detail), 0xffffff).translate(p.x, p.y, p.z), keepColor: true, c });
    glowPos.push(p.x, p.y, p.z);
    const k = deep ? 0.55 : 0.8;
    glowCol.push(c[0] * k, c[1] * k, c[2] * k);
    base.push(c[0] * k, c[1] * k, c[2] * k);
    phase.push(rng() * TAU, 0.6 + rng() * 1.6);
  }
  // Bulbs are colour-coded per bead: white core tinted towards the bulb colour.
  for (const b of beads) {
    const col = b.geometry.attributes.color;
    for (let i = 0; i < col.count; i++) col.setXYZ(i, 0.55 + b.c[0] * 0.45, 0.55 + b.c[1] * 0.45, 0.55 + b.c[2] * 0.45);
    delete b.c;
  }
  if (beads.length) g.add(unlit(mergeParts(beads), { toneMapped: false }));
  const glow = glowCloud(glowPos, glowCol, size);
  g.add(glow);
  if (twinkle) {
    const colAttr = glow.geometry.attributes.color;
    let t = 0;
    let acc = 0;
    chainTick(g, (dt) => {
      if (reducedMotion()) return;
      t += dt; acc += dt;
      if (acc < 1 / 20) return; // twenty updates a second is plenty for a twinkle
      acc = 0;
      for (let i = 0; i < phase.length / 2; i++) {
        const f = 0.72 + 0.28 * Math.sin(t * phase[i * 2 + 1] + phase[i * 2]);
        colAttr.setXYZ(i, base[i * 3] * f, base[i * 3 + 1] * f, base[i * 3 + 2] * f);
      }
      colAttr.needsUpdate = true;
    });
  }
  return glow;
}

// Interior props cast no shadow. The cabin's roof already puts the whole room in the Moon's
// shadow, so a tree or a fireplace drawn into the shadow map is a second render of a few hundred
// thousand triangles that changes nothing on screen -- every mesh is drawn twice otherwise.
function indoors(g) {
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  return g;
}

// Several animations can live on one prop; this composes them into the single
// `userData.tick = { update(dt, camera), dispose() }` WorldStore forwards.
function chainTick(g, fn) {
  const prev = g.userData.tick;
  g.userData.tick = {
    update(dt, camera, vars) { prev?.update?.(dt, camera, vars); fn(dt, camera); },
    dispose() { prev?.dispose?.(); },
  };
}

// ---------------------------------------------------------------------------
// The Christmas tree (the hero)
// ---------------------------------------------------------------------------

// A 13ft Fraser-style fir dressed the way the photograph is: warm white lights through and
// through, glossy red and gold baubles, copper and champagne ones among them, pinecones, and a
// red velvet skirt with a gold Nordic border. The star is a SEPARATE prop so it can be clicked
// and programmed (the observatory's dome-and-telescope rule).
export function christmasTree({ height = TREE_HEIGHT, radius = 5, seed = 11, lights = 520 } = {}) {
  const g = group();
  const { geometry, specs, tierGeoms } = buildSpruce({
    height, radius, tiers: 17, seed, nuPer: 8, nv: 14, snow: 0,
    needles: new THREE.Color(0x1f4a2a), tips: new THREE.Color(0x4f8a46), under: new THREE.Color(0x122a18),
    bottom: TREE_BOTTOM, droop: 0.32,
  });
  g.add(mesh(geometry, standard({ vertexColors: true, roughness: 0.85, map: needleTexture(seed + 2) })));
  g.add(mesh(paint(trunkGeometry(height, 0.28), 0x5a3d26), standard({ vertexColors: true, roughness: 0.9, ...relief('bark', { seed: 5, repeat: 2 }) })));

  // Stand: a red cast-iron bowl, mostly hidden by the skirt.
  const stand = lathe([[0, 0], [1.1, 0], [1.15, 0.1], [0.95, 0.55], [0.35, 0.62], [0, 0.62]], 24);
  g.add(mesh(stand, standard({ color: 0x7a1616, roughness: 0.5, metalness: 0.3 })));

  // --- ornaments, hung from branch TIPS so they are seen from outside the tree ---
  const rng = seededRandom(seed * 7 + 1);
  const baubles = [];
  const caps = [];
  const cones = [];
  const BAUBLE = [0xb3111b, 0xc8161f, 0x8c0c12, 0xd2a33a, 0xc08a2a, 0xb4643a, 0xe3c98e, 0xa31420, 0xd9b45a];
  for (let t = 0; t < specs.length - 2; t++) {
    const spec = specs[t];
    for (let k = 0; k < spec.n; k++) {
      const roll = rng();
      const u = branchU(tierGeoms[t], k) + (rng() - 0.5) * 0.25 / spec.n;
      if (roll < 0.62) {
        const r = 0.16 + rng() * 0.14 + spec.R * 0.012;
        const tip = tipPoint(spec, tierGeoms[t], u, 0.86 + rng() * 0.1);
        const cy = tip.y - r - 0.12;
        const color = BAUBLE[Math.floor(rng() * BAUBLE.length)];
        baubles.push({ geometry: paint(new THREE.SphereGeometry(r, 16, 12), color).translate(tip.x, cy, tip.z), keepColor: true });
        caps.push({ geometry: paint(new THREE.CylinderGeometry(r * 0.22, r * 0.25, r * 0.28, 10), 0xc9a75a).translate(tip.x, cy + r * 0.98, tip.z), keepColor: true });
        caps.push({ geometry: paint(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4), 0xd9c27a).translate(tip.x, cy + r + 0.08, tip.z), keepColor: true });
      } else if (roll < 0.86) {
        const tip = tipPoint(spec, tierGeoms[t], u, 0.8 + rng() * 0.12);
        cones.push(...pinecone(tip.x, tip.y - 0.42, tip.z, 0.38 + rng() * 0.12, rng));
      }
    }
  }
  const glossy = standard({ vertexColors: true, roughness: 0.16, metalness: 0.35, envMapIntensity: 1 });
  g.add(mesh(mergeParts(baubles), glossy));
  g.add(mesh(mergeParts([...caps, ...cones]), standard({ vertexColors: true, roughness: 0.6, metalness: 0.15, ...relief('bark', { seed: 9, repeat: 1, strength: 0.6 }) })));

  // --- needle tufts along every branch, so the outline is bristly rather than paddle-smooth ---
  const tufts = [];
  const tuft = new THREE.IcosahedronGeometry(0.5, 0).scale(0.95, 0.09, 0.22);
  const TUFT_G = [0x1c4527, 0x24532e, 0x2f6436, 0x3c7840, 0x4d8a48];
  for (let t = 0; t < specs.length; t++) {
    const spec = specs[t];
    const count = Math.round(spec.R * spec.R * 12 + 18);
    for (let i = 0; i < count; i++) {
      const u = rng();
      const sR = 0.45 + Math.pow(rng(), 0.6) * 0.62;
      const p = tipPoint(spec, tierGeoms[t], u, Math.min(1, sR));
      const a = u * TAU;
      const reach = 0.55 + rng() * 0.55;
      const out = sR > 1 ? (sR - 1) * spec.R : 0;
      tufts.push({ geometry: orient(paint(tuft.clone(), TUFT_G[Math.floor(rng() * TUFT_G.length)]), {
        pos: [p.x + Math.cos(a) * out, p.y + 0.03, p.z + Math.sin(a) * out],
        scale: [reach, 1, 0.8 + rng() * 0.5], roll: -(0.15 + rng() * 0.45), pitch: (rng() - 0.5) * 0.5, yaw: -a + (rng() - 0.5) * 0.7,
      }), keepColor: true });
    }
  }
  g.add(mesh(mergeParts(tufts), standard({ vertexColors: true, roughness: 0.85, map: needleTexture(seed + 4) })));

  // --- lights, warm white, and a real light at the heart of the tree ---
  addTreeLights(g, specs, tierGeoms, { seed, count: lights, palette: 'warm', size: 0.75, bulb: 0.045, inner: 0.34 });
  const light = new THREE.PointLight(0xffb468, 60, 26, 2);
  light.position.set(0, height * 0.45, 0);
  g.add(light);

  // --- the skirt: red velvet with a gold-and-cream Nordic border, rippled at the hem ---
  g.add(treeSkirt({ radius: 4.6, seed }));
  return indoors(g);
}

// A pinecone: a lathe whose radius ripples round its length, which reads as scales at a few
// feet, hanging tip down.
function pinecone(x, y, z, len, rng) {
  const prof = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const env = Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.42 * len;
    const scale = 1 + 0.18 * Math.sin(t * 18);
    prof.push([i === 0 || i === steps ? 0 : env * scale, t * len]);
  }
  const g = lathe(prof, 10);
  // Tip down: the stalk end is at the top.
  g.rotateX(Math.PI);
  g.translate(x, y + len, z);
  const tone = 0x6b4426 + Math.floor(rng() * 3) * 0x050302;
  return [{ geometry: paint(g, tone), keepColor: true }];
}

function treeSkirt({ radius, seed }) {
  const tex = canvasTexture(1024, 1024, (ctx, w, h) => {
    const cx = w / 2; const cy = h / 2; const R = w / 2;
    const bg = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    bg.addColorStop(0, '#7c0d14');
    bg.addColorStop(0.75, '#9a1119');
    bg.addColorStop(1, '#6b0a10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    // velvet nap
    const rng = seededRandom(seed + 77);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${rng() < 0.5 ? '0,0,0' : '255,120,120'},${0.04 + rng() * 0.05})`;
      ctx.fillRect(rng() * w, rng() * h, 2, 2);
    }
    // border bands
    const band = (r0, r1, color) => { ctx.strokeStyle = color; ctx.lineWidth = (r1 - r0) * R; ctx.beginPath(); ctx.arc(cx, cy, ((r0 + r1) / 2) * R, 0, TAU); ctx.stroke(); };
    band(0.74, 0.92, '#efe3c6');
    band(0.73, 0.745, '#c9a24a');
    band(0.915, 0.93, '#c9a24a');
    // Nordic motif round the band: little stepped stars and diamonds, in red and green
    const motifs = 30;
    for (let i = 0; i < motifs; i++) {
      const a = (i / motifs) * TAU;
      const rr = 0.83 * R;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = i % 2 ? '#a3141d' : '#1f5a33';
      const px = 7;
      const star = ['..x..', '.xxx.', 'xx.xx', '.xxx.', '..x..'];
      star.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === 'x') ctx.fillRect((rx - 2.5) * px, (ry - 2.5) * px, px - 1, px - 1); }));
      ctx.restore();
    }
    // snowflake ring on the velvet
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.13;
      const x = cx + Math.cos(a) * R * 0.52; const y = cy + Math.sin(a) * R * 0.52;
      ctx.strokeStyle = 'rgba(240,220,180,0.75)'; ctx.lineWidth = 3;
      for (let k = 0; k < 6; k++) {
        const b = (k / 6) * TAU;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * 22, y + Math.sin(b) * 22); ctx.stroke();
      }
    }
    // fringe of white fur trim at the hem
    for (let i = 0; i < 900; i++) {
      const a = rng() * TAU; const r = R * (0.945 + rng() * 0.05);
      ctx.fillStyle = `rgba(250,246,238,${0.5 + rng() * 0.5})`;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 + rng() * 4, 0, TAU); ctx.fill();
    }
  });
  // A draped disc: radial rows from the stand out to a hem that ripples in soft folds and lies
  // on the floor. Planar UVs so the round pattern lands round.
  const folds = 11;
  const geom = paramSurface(144, 14, (u, v) => {
    const a = u * TAU;
    const r = 0.9 + v * (radius - 0.9) * (1 + 0.04 * Math.sin(a * folds));
    const y = 0.03 + 0.12 * Math.pow(1 - v, 2) + 0.07 * Math.max(0, Math.sin(a * folds)) * v * (1 - v) * 3;
    return [Math.cos(a) * r, y, Math.sin(a) * r, 0.5 + (Math.cos(a) * r) / (2 * radius * 1.04), 0.5 - (Math.sin(a) * r) / (2 * radius * 1.04)];
  }, { closedU: true, outward: () => [0, 1, 0] });
  const m = mesh(geom, standard({ map: tex, roughness: 0.92, ...relief('weave', { seed: 3, repeat: 10, strength: 0.4 }) }));
  m.castShadow = false;
  return m;
}

// The star on top. Its own prop so a student can click it and give it a program; its origin is
// the bottom point, which sits on the leader.
export function treeStar({ size = 0.8 } = {}) {
  const g = group();
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? size * 0.42 : size;
    const a = Math.PI / 2 + (i / 10) * TAU;
    const x = Math.cos(a) * r; const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: size * 0.12, bevelEnabled: true, bevelThickness: size * 0.09, bevelSize: size * 0.07, bevelSegments: 3 });
  geom.center();
  geom.translate(0, size * 0.95, 0);
  const star = new THREE.Mesh(geom, standard({ color: 0xf0c04a, emissive: 0xffb43a, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.4 }));
  star.userData.isGlowMesh = true;
  g.add(star);
  g.add(glowCloud([0, size * 0.95, 0.15], [1.0, 0.78, 0.4], size * 4.2));
  star.castShadow = false;
  // a short brass collar down onto the leader
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.35, 10).translate(0, 0.08, 0), standard({ color: 0xc9a24a, metalness: 0.4, roughness: 0.4 })));
  return g;
}

// ---------------------------------------------------------------------------
// Presents
// ---------------------------------------------------------------------------

// A 3 x 2 atlas of wrapping papers, drawn in full colour (vertex colour white for those faces):
// candy stripe, green with gold dots, navy with snowflakes, kraft paper, gold foil, and a plain
// white tile that the ribbons tint.
function giftAtlas() {
  return canvasTexture(768, 512, (ctx) => {
    const T = 256;
    const tile = (i, j, draw) => { ctx.save(); ctx.beginPath(); ctx.rect(i * T, j * T, T, T); ctx.clip(); ctx.translate(i * T, j * T); draw(); ctx.restore(); };
    tile(0, 0, () => {
      ctx.fillStyle = '#c2161f'; ctx.fillRect(0, 0, T, T);
      ctx.strokeStyle = '#f6efe6'; ctx.lineWidth = 18;
      for (let k = -T; k < 2 * T; k += 44) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + T, T); ctx.stroke(); }
    });
    tile(1, 0, () => {
      ctx.fillStyle = '#1d6b3a'; ctx.fillRect(0, 0, T, T);
      ctx.fillStyle = '#e8c35a';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { ctx.beginPath(); ctx.arc(x * 32 + (y % 2) * 16 + 8, y * 32 + 16, 6, 0, TAU); ctx.fill(); }
    });
    tile(2, 0, () => {
      ctx.fillStyle = '#1c2f6b'; ctx.fillRect(0, 0, T, T);
      ctx.strokeStyle = '#f2f4fa'; ctx.lineWidth = 3;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const cx = x * 64 + 32 + (y % 2) * 16; const cy = y * 64 + 32;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * TAU;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9); ctx.lineTo(cx + Math.cos(a + 0.5) * 13, cy + Math.sin(a + 0.5) * 13); ctx.stroke();
        }
      }
    });
    tile(0, 1, () => {
      ctx.fillStyle = '#b88a5a'; ctx.fillRect(0, 0, T, T);
      const rng = seededRandom(12);
      for (let k = 0; k < 400; k++) { ctx.fillStyle = `rgba(${rng() < 0.5 ? '90,60,30' : '230,200,160'},0.12)`; ctx.fillRect(rng() * T, rng() * T, 3 + rng() * 20, 1.5); }
      ctx.fillStyle = '#9c1b1f';
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
        const cx = x * 44 + 20; const cy = y * 44 + 20;
        ctx.beginPath(); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx + 3, cy - 3); ctx.lineTo(cx + 9, cy - 3); ctx.lineTo(cx + 4, cy + 2); ctx.lineTo(cx + 6, cy + 9); ctx.lineTo(cx, cy + 5); ctx.lineTo(cx - 6, cy + 9); ctx.lineTo(cx - 4, cy + 2); ctx.lineTo(cx - 9, cy - 3); ctx.lineTo(cx - 3, cy - 3); ctx.closePath(); ctx.fill();
      }
    });
    tile(1, 1, () => {
      const gr = ctx.createLinearGradient(0, 0, T, T);
      gr.addColorStop(0, '#e0b852'); gr.addColorStop(0.5, '#f4d987'); gr.addColorStop(1, '#c79a35');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, T, T);
      ctx.strokeStyle = 'rgba(140,100,30,0.35)'; ctx.lineWidth = 2;
      for (let k = -T; k < 2 * T; k += 28) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + T, T); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k + T, 0); ctx.lineTo(k, T); ctx.stroke(); }
    });
    tile(2, 1, () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, T, T); });
  });
}

const RIBBON = [0xd4a93c, 0xb3141e, 0xf2ece0, 0x1f6b3c, 0xc0c4cc];

// One wrapped present, into `paper` (atlas tiles) and `ribbon` part lists.
function present(paper, ribbon, { w, h, d, x, y = 0, z, yaw = 0, tile, ribbonColor, rng }) {
  const tu = (tile % 3) / 3; const tv = tile < 3 ? 0.5 : 0;
  const box = atlasUV(roundedBox(w, h, d, 0.035, 2, 2), tu, tv, 1 / 3, 0.5);
  paper.push({ geometry: orient(paint(box, 0xffffff), { pos: [x, y + h / 2, z], yaw }), keepColor: true });
  const bw = Math.min(w, d) * 0.14;
  // Two bands round the box, a hair proud of the paper so they cannot z-fight it.
  for (const [gw, gd] of [[w + 0.02, bw], [bw, d + 0.02]]) {
    ribbon.push({ geometry: orient(paint(atlasUV(roundedBox(gw, h + 0.02, gd, 0.008, 1, 1), 2 / 3, 0, 1 / 3, 0.5), ribbonColor), { pos: [x, y + h / 2, z], yaw }), keepColor: true });
  }
  // The bow: two loops, a knot and two tails.
  const s = Math.min(w, d) * 0.5;
  const loop = (side) => {
    const t = new THREE.TorusGeometry(s * 0.32, s * 0.07, 6, 16);
    t.scale(1, 0.75, 0.55);
    return orient(paint(atlasUV(t, 2 / 3, 0, 1 / 3, 0.5), ribbonColor), { pos: [side * s * 0.3, s * 0.2, 0], roll: side * 0.5 });
  };
  for (const side of [-1, 1]) {
    ribbon.push({ geometry: orient(loop(side), { pos: [x, y + h + 0.01, z], yaw: yaw + 0.4 }), keepColor: true });
  }
  ribbon.push({ geometry: orient(paint(atlasUV(new THREE.SphereGeometry(s * 0.12, 8, 6), 2 / 3, 0, 1 / 3, 0.5), ribbonColor), { pos: [x, y + h + s * 0.08, z] }), keepColor: true });
}

function giftMaterial() {
  return standard({ vertexColors: true, map: giftAtlas(), roughness: 0.48, metalness: 0.05 });
}

// A heap of presents round a tree's trunk, inside the train's track.
export function giftPile({ seed = 21, inner = 1.25, outer = 4.3, count = 15 } = {}) {
  const rng = seededRandom(seed);
  const paper = [];
  const ribbon = [];
  const placed = [];
  let tries = 0;
  while (placed.length < count && tries < 600) {
    tries++;
    const a = rng() * TAU;
    const r = inner + Math.sqrt(rng()) * (outer - inner);
    const w = 0.7 + rng() * 1.0; const d = 0.6 + rng() * 0.9; const h = 0.45 + rng() * 0.8;
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    const rad = Math.hypot(w, d) / 2;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < (p.rad + rad) * 0.82)) continue;
    if (r + rad > outer + 0.3) continue;
    placed.push({ x, z, rad, w, d, h });
    // Papers in turn rather than at random, so no one paper crowds the front of the heap.
    present(paper, ribbon, { w, h, d, x, z, yaw: rng() * TAU, tile: placed.length % 5, ribbonColor: RIBBON[(placed.length * 2) % RIBBON.length], rng });
  }
  // A few small ones stacked on the bigger ones.
  for (const p of placed.slice(0, 4)) {
    const s = Math.min(p.w, p.d) * 0.6;
    present(paper, ribbon, { w: s, h: s * 0.7, d: s * 0.85, x: p.x, y: p.h + 0.02, z: p.z, yaw: rng() * TAU, tile: Math.floor(rng() * 5), ribbonColor: RIBBON[Math.floor(rng() * RIBBON.length)], rng });
  }
  const g = group();
  g.add(mesh(mergeParts([...paper, ...ribbon]), giftMaterial()));
  return indoors(g);
}

// ---------------------------------------------------------------------------
// The toy train
// ---------------------------------------------------------------------------

// A track laid on a circle of radius `radius` whose centre is the prop's origin.
export function trainTrack({ radius = TRAIN_R } = {}) {
  const gauge = 0.42;
  const parts = [];
  for (const r of [radius - gauge / 2, radius + gauge / 2]) {
    parts.push({ geometry: paint(new THREE.TorusGeometry(r, 0.03, 6, 220).rotateX(Math.PI / 2).translate(0, 0.13, 0), 0xb8bcc4), keepColor: true });
  }
  const ties = Math.round((TAU * radius) / 0.32);
  for (let i = 0; i < ties; i++) {
    const a = (i / ties) * TAU;
    parts.push({ geometry: orient(paint(new THREE.BoxGeometry(0.72, 0.07, 0.12), i % 2 ? 0x5a3a22 : 0x4c311d), { pos: [Math.cos(a) * radius, 0.06, Math.sin(a) * radius], yaw: -a }), keepColor: true });
  }
  return indoors(group(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.55, metalness: 0.4 }))));
}

// A toy steam train: engine, tender and two cars, laid along the ARC it will run on. The program
// turns it as one rigid object about the engine, and a rigid shape only stays on a circle if it
// is itself an arc of that circle -- so the cars are placed on the circle behind the engine,
// each yawed to the tangent there. The circle's centre is on the engine's LEFT (+x), because a
// positive `rotate` turns left (measured, see CLAUDE.md).
export function toyTrain({ radius = TRAIN_R, seed = 31 } = {}) {
  const rng = seededRandom(seed);
  const body = [];
  const shine = [];
  const lamps = [];
  const onArc = (s) => {
    const phi = s / radius;
    return { pos: [radius * (1 - Math.cos(phi)), 0, -radius * Math.sin(phi)], yaw: -phi };
  };
  const add = (list, geometry, color, local, s, extra = {}) => {
    const { pos, yaw } = onArc(s);
    const g = orient(paint(geometry, color), { pos: local, pitch: extra.pitch ?? 0, roll: extra.roll ?? 0, yaw: extra.yaw ?? 0 });
    list.push({ geometry: orient(g, { pos, yaw }), keepColor: true });
  };
  const RED = 0xb3121c; const BLACK = 0x1b1b1f; const GOLD = 0xd8ad45; const GREEN = 0x1d6b3a;
  // wheels on a car centred at arc s, length L
  const wheels = (s, L, n, r = 0.13) => {
    for (let i = 0; i < n; i++) {
      const dz = ((i + 0.5) / n - 0.5) * L * 0.8;
      for (const side of [-1, 1]) {
        add(shine, new THREE.CylinderGeometry(r, r, 0.06, 14), BLACK, [side * 0.24, 0.2, dz], s, { roll: Math.PI / 2 });
        add(shine, new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.065, 10), GOLD, [side * 0.245, 0.2, dz], s, { roll: Math.PI / 2 });
      }
    }
  };
  // Engine, centred a little ahead of the origin so the origin stays on the track.
  const e = 0;
  add(body, new THREE.BoxGeometry(0.5, 0.12, 1.7), BLACK, [0, 0.28, 0], e);
  add(body, new THREE.CylinderGeometry(0.27, 0.27, 1.05, 20), RED, [0, 0.62, 0.32], e, { pitch: Math.PI / 2 });
  add(body, new THREE.CylinderGeometry(0.28, 0.28, 0.16, 20), BLACK, [0, 0.62, 0.86], e, { pitch: Math.PI / 2 });
  for (const zb of [0.0, 0.32, 0.64]) add(shine, new THREE.TorusGeometry(0.275, 0.018, 6, 24), GOLD, [0, 0.62, zb], e);
  add(body, lathe([[0, 0], [0.09, 0], [0.08, 0.2], [0.16, 0.34], [0.15, 0.38], [0, 0.38]], 14), BLACK, [0, 0.84, 0.66], e);
  add(shine, new THREE.SphereGeometry(0.11, 12, 8, 0, TAU, 0, Math.PI / 2), GOLD, [0, 0.87, 0.3], e);
  add(body, new THREE.BoxGeometry(0.56, 0.62, 0.55), RED, [0, 0.66, -0.38], e);
  add(body, new THREE.BoxGeometry(0.66, 0.06, 0.66), BLACK, [0, 1.0, -0.38], e);
  for (const side of [-1, 1]) add(lamps, new THREE.BoxGeometry(0.02, 0.2, 0.22), 0xffd28a, [side * 0.285, 0.78, -0.38], e);
  add(lamps, new THREE.SphereGeometry(0.07, 10, 8), 0xfff0c0, [0, 0.66, 0.95], e);
  // cowcatcher
  add(body, new THREE.ConeGeometry(0.26, 0.3, 4, 1), GOLD, [0, 0.26, 0.98], e, { pitch: Math.PI / 2, roll: Math.PI / 4 });
  wheels(e, 1.4, 3, 0.15);
  // Tender
  const t = 1.35;
  add(body, new THREE.BoxGeometry(0.52, 0.42, 0.85), BLACK, [0, 0.48, 0], t);
  add(body, new THREE.BoxGeometry(0.46, 0.08, 0.78), 0x2a2622, [0, 0.72, 0], t);
  for (let i = 0; i < 10; i++) add(body, new THREE.IcosahedronGeometry(0.07 + rng() * 0.04, 0), 0x141414, [(rng() - 0.5) * 0.35, 0.78, (rng() - 0.5) * 0.65], t);
  add(shine, new THREE.BoxGeometry(0.54, 0.05, 0.87), GOLD, [0, 0.66, 0], t);
  wheels(t, 0.85, 2);
  // Gondola full of presents
  const c1 = 2.45;
  add(body, new THREE.BoxGeometry(0.56, 0.36, 1.05), GREEN, [0, 0.45, 0], c1);
  add(shine, new THREE.BoxGeometry(0.58, 0.05, 1.07), GOLD, [0, 0.62, 0], c1);
  const pal = [0xc2161f, 0xe8c35a, 0x2a54c4, 0xf2ece0, 0x9b2cc4];
  for (let i = 0; i < 5; i++) {
    const s = 0.16 + rng() * 0.1;
    add(body, new THREE.BoxGeometry(s, s, s), pal[i], [(rng() - 0.5) * 0.25, 0.68 + s / 2, -0.4 + i * 0.2], c1, { yaw: rng() });
  }
  wheels(c1, 1.05, 2);
  // Caboose
  const c2 = 3.65;
  add(body, new THREE.BoxGeometry(0.56, 0.5, 1.05), RED, [0, 0.52, 0], c2);
  add(body, new THREE.BoxGeometry(0.66, 0.06, 1.15), BLACK, [0, 0.8, 0], c2);
  add(body, new THREE.BoxGeometry(0.34, 0.24, 0.4), RED, [0, 0.95, 0], c2);
  add(body, new THREE.BoxGeometry(0.42, 0.05, 0.48), BLACK, [0, 1.09, 0], c2);
  for (const zz of [-0.25, 0.25]) for (const side of [-1, 1]) add(lamps, new THREE.BoxGeometry(0.02, 0.16, 0.2), 0xffd28a, [side * 0.285, 0.58, zz], c2);
  wheels(c2, 1.05, 2);
  const g = group();
  g.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.35, metalness: 0.2 })));
  g.add(mesh(mergeParts(shine), standard({ vertexColors: true, roughness: 0.3, metalness: 0.55 })));
  g.add(unlit(mergeParts(lamps), { toneMapped: false }));
  return indoors(g);
}

// ---------------------------------------------------------------------------
// The fireplace
// ---------------------------------------------------------------------------

// Warm grey and buff fieldstone, the photograph's: none of it blue-grey, which reads as concrete.
const STONES = [0xa8987f, 0xb5a68c, 0x9a8b76, 0xc0b199, 0x8d8172, 0xa69d8e, 0xb8a183, 0x928676, 0xa1907a];

// Lays fieldstones in courses over a rectangle of one face. `toWorld(a, y, out)` maps face
// coordinates (a along the face, y up, out = distance proud of it) into the prop's frame, and
// `gap(yLo, yHi)` returns the intervals of `a` a course must leave open (an opening, an arch).
function stoneFace(list, rng, { a0, a1, y0, y1, toWorld, yaw, gaps = () => [], rowH = [0.75, 1.3], wid = [1.0, 2.3], depth = 0.75, seg = 2 }) {
  let y = y0;
  while (y < y1 - 0.2) {
    const h = Math.min(y1 - y, rowH[0] + rng() * (rowH[1] - rowH[0]));
    const open = gaps(y, y + h);
    // the runs of this course between openings
    let runs = [[a0, a1]];
    for (const [g0, g1] of open) {
      const next = [];
      for (const [r0, r1] of runs) {
        if (g1 <= r0 || g0 >= r1) { next.push([r0, r1]); continue; }
        if (g0 > r0) next.push([r0, g0]);
        if (g1 < r1) next.push([g1, r1]);
      }
      runs = next;
    }
    for (const [r0, r1] of runs) {
      let a = r0;
      while (a < r1 - 0.15) {
        // Widths skewed small with the odd long stone, which is what a hand-laid face has.
        let w = wid[0] + Math.pow(rng(), 1.6) * (wid[1] - wid[0]);
        if (r1 - (a + w) < wid[0] * 0.6) w = r1 - a;
        // Each stone fills its slot unevenly -- shorter than the course, nudged up or down --
        // so the courses stop reading as a ruled grid of pillows.
        const sh = (h - 0.09) * (0.84 + rng() * 0.16);
        const sw = (w - 0.09) * (0.9 + rng() * 0.1);
        const dy = (h - 0.09 - sh) * (rng() - 0.5);
        if (sw > 0.2 && sh > 0.2) {
          // Fieldstone is ROUND-shouldered and irregular; a crisp-edged block is a brick.
          const geo = lumpy(roundedBox(sw, sh, depth, Math.min(0.3, sh * 0.4, sw * 0.32), seg, 1), 0.1, 1.05, rng() * 50);
          // a skew, so no two stones are the same rectangle
          const skew = (rng() - 0.5) * 0.16;
          const pa = geo.attributes.position;
          for (let i = 0; i < pa.count; i++) pa.setX(i, pa.getX(i) + pa.getY(i) * skew);
          const tone = STONES[Math.floor(rng() * STONES.length)];
          const c = new THREE.Color(tone).multiplyScalar(0.82 + rng() * 0.32);
          const proud = 0.02 + rng() * 0.16;
          const centre = toWorld(a + w / 2, y + h / 2 + dy, proud - depth / 2);
          list.push({ geometry: orient(paintBy(geo, (p) => c.clone().multiplyScalar(0.86 + 0.28 * smoothNoise3(p.x * 2.5, p.y * 2.5, p.z * 2.5))), { pos: centre, yaw, roll: (rng() - 0.5) * 0.16 }), keepColor: true });
        }
        a += w;
      }
    }
    y += h;
  }
}

function brickTexture(seed) {
  const rng = seededRandom(seed);
  return repeatTex(canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#4a3328'; ctx.fillRect(0, 0, w, h);
    const bh = 32; const bw = 96;
    for (let r = 0; r < h / bh; r++) {
      const off = (r % 2) * bw / 2;
      for (let c = -1; c < w / bw + 1; c++) {
        const x = c * bw + off; const y = r * bh;
        const t = rng();
        const col = [180 + t * 50, 104 + t * 40, 64 + t * 30];
        ctx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
        ctx.fillRect(x + 3, y + 3, bw - 6, bh - 6);
        for (let k = 0; k < 20; k++) { ctx.fillStyle = `rgba(60,30,20,${rng() * 0.2})`; ctx.fillRect(x + 3 + rng() * (bw - 10), y + 3 + rng() * (bh - 10), 4, 3); }
      }
    }
  }));
}

// A quad from four corners, wound to face the point `inside`.
function quad(p0, p1, p2, p3, inside, su = 1, sv = 1) {
  const g = new THREE.BufferGeometry();
  const pos = [...p0, ...p1, ...p2, ...p3];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, su, 0, su, sv, 0, sv], 2));
  const a = new THREE.Vector3(...p0); const b = new THREE.Vector3(...p1); const c = new THREE.Vector3(...p2);
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  const centre = new THREE.Vector3(...p0).add(b).add(c).add(new THREE.Vector3(...p3)).multiplyScalar(0.25);
  const toIn = new THREE.Vector3(...inside).sub(centre);
  g.setIndex(n.dot(toIn) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  return g;
}

function flameTexture() {
  return canvasTexture(384, 256, (ctx, w, h) => {
    for (let k = 0; k < 3; k++) {
      const cx = k * 128 + 64;
      const top = [18, 40, 8][k];
      const half = [34, 42, 28][k];
      ctx.save();
      ctx.filter = 'blur(7px)';
      const shape = () => {
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.bezierCurveTo(cx + half * 0.5, h * 0.35, cx + half * 1.1, h * 0.7, cx + half * 0.6, h * 0.92);
        ctx.quadraticCurveTo(cx, h * 1.02, cx - half * 0.6, h * 0.92);
        ctx.bezierCurveTo(cx - half * 1.1, h * 0.7, cx - half * 0.4, h * 0.38, cx, top);
        ctx.closePath();
      };
      const g1 = ctx.createLinearGradient(0, top, 0, h);
      g1.addColorStop(0, 'rgba(180,40,0,0)');
      g1.addColorStop(0.25, 'rgba(230,80,10,0.75)');
      g1.addColorStop(0.65, 'rgba(255,150,40,1)');
      g1.addColorStop(1, 'rgba(255,120,30,0.6)');
      ctx.fillStyle = g1; shape(); ctx.fill();
      ctx.filter = 'blur(9px)';
      const g2 = ctx.createRadialGradient(cx, h * 0.78, 2, cx, h * 0.72, half * 1.1);
      g2.addColorStop(0, 'rgba(255,250,220,1)');
      g2.addColorStop(0.5, 'rgba(255,215,110,0.75)');
      g2.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = g2; ctx.beginPath(); ctx.ellipse(cx, h * 0.74, half * 0.6, h * 0.3, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });
}

// The fire: crossed flame cards with an additive texture, rewritten every frame so each tongue
// stretches and leans on its own clock, plus embers and a flickering warm light. All of it is
// one mesh, so the flicker costs a buffer upload of a few hundred floats.
function fire(g, { x = 0, y, z, width = 2.6 }) {
  const rng = seededRandom(404);
  const tex = flameTexture();
  const flames = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    const fx = x + (i / (N - 1) - 0.5) * width * 0.85 + (rng() - 0.5) * 0.15;
    const fz = z + (rng() - 0.5) * 0.5;
    const h = 1.1 + rng() * 1.2 * (1 - Math.abs(i / (N - 1) - 0.5) * 1.1);
    const wdt = 0.55 + rng() * 0.35;
    const variant = Math.floor(rng() * 3);
    for (const yaw of [0, Math.PI / 2 + (rng() - 0.5) * 0.6]) flames.push({ fx, fz, h, wdt, variant, yaw, ph: rng() * TAU, sp: 5 + rng() * 5 });
  }
  const pos = new Float32Array(flames.length * 4 * 3);
  const uv = new Float32Array(flames.length * 4 * 2);
  const col = new Float32Array(flames.length * 4 * 3);
  const idx = [];
  flames.forEach((f, i) => {
    const u0 = f.variant / 3; const u1 = u0 + 1 / 3;
    uv.set([u0, 0, u1, 0, u1, 1, u0, 1], i * 8);
    const k = 0.75 + rng() * 0.25;
    for (let v = 0; v < 4; v++) col.set([k, k, k], (i * 4 + v) * 3);
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geom.setIndex(idx);
  const place = (time) => {
    flames.forEach((f, i) => {
      const flick = 0.82 + 0.18 * Math.sin(time * f.sp + f.ph) + 0.08 * Math.sin(time * f.sp * 2.3 + f.ph * 2);
      const h = f.h * flick;
      const lean = 0.12 * Math.sin(time * 1.7 + f.ph) + 0.06 * Math.sin(time * 4.1 + f.ph);
      const cx = Math.cos(f.yaw) * f.wdt / 2; const cz = -Math.sin(f.yaw) * f.wdt / 2;
      const b = y - 0.15;
      pos.set([
        f.fx - cx, b, f.fz - cz,
        f.fx + cx, b, f.fz + cz,
        f.fx + cx * 0.6 + lean, b + h, f.fz + cz * 0.6,
        f.fx - cx * 0.6 + lean, b + h, f.fz - cz * 0.6,
      ], i * 12);
    });
    geom.attributes.position.needsUpdate = true;
  };
  place(0);
  geom.computeBoundingSphere();
  geom.boundingSphere.radius += 1;
  const flameMesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  }));
  flameMesh.castShadow = false;
  flameMesh.receiveShadow = false;
  flameMesh.renderOrder = 2;
  g.add(flameMesh);

  // The light stands IN FRONT of the opening, not in the firebox: from inside it lit the brick
  // and nothing else, and the stone face round the fire -- the whole picture -- sat in the
  // cool fill as grey pebbles in grout.
  const light = new THREE.PointLight(0xff8a3a, 90, 40, 2);
  light.position.set(x, y + 0.9, z + 2.3);
  g.add(light);
  let t = 0;
  chainTick(g, (dt) => {
    if (reducedMotion()) return;
    t += dt;
    place(t);
    light.intensity = 90 * (0.86 + 0.09 * Math.sin(t * 9.3) + 0.06 * Math.sin(t * 23.1 + 1) + 0.04 * Math.sin(t * 3.1));
  });
}

// The fieldstone fireplace and its chimney, authored against a log wall: the wall's centre line
// is z = 0 and the room is +z. The breast stands in the room, the stack stands outside, and the
// wall runs between them as a real one does.
export function stoneFireplace({ seed = 41, breastTop = 13, stackTop = 23.5 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const BW = 5;              // half width of the breast
  const FRONT = 3.6;         // breast front face, z
  const HEARTH = 1.35;       // hearth top
  const OW = 2.45;           // firebox opening half width
  const SPRING = HEARTH + 2.55;
  const RISE = 0.7;
  const AR = (OW * OW + RISE * RISE) / (2 * RISE);
  const ACY = SPRING + RISE - AR;
  const RING = 0.95;
  const archTop = (x) => ACY + Math.sqrt(Math.max(0, AR * AR - x * x));
  // The voussoir ring is a SEGMENT of a big circle, so above the springing its outer edge runs
  // up the radial line through the springing point before it meets the outer circle. Using the
  // whole circle there would clear stone four feet either side of a five-foot opening.
  const SA = Math.atan2(SPRING - ACY, OW);
  const X_END = Math.cos(SA) * (AR + RING);
  const Y_END = ACY + Math.sin(SA) * (AR + RING);
  const TOP = ACY + AR + RING;
  const outerHalf = (y) => {
    if (y < SPRING) return OW + 0.02;
    if (y < Y_END) return OW + ((y - SPRING) / (Y_END - SPRING)) * (X_END - OW) + 0.02;
    const dy = y - ACY;
    const R2 = (AR + RING) * (AR + RING);
    return dy * dy < R2 ? Math.sqrt(R2 - dy * dy) + 0.02 : 0;
  };
  const stones = [];
  // Breast front
  stoneFace(stones, rng, {
    a0: -BW, a1: BW, y0: HEARTH, y1: breastTop, yaw: 0,
    toWorld: (a, y, out) => [a, y, FRONT + out],
    gaps: (y0, y1) => {
      if (y0 >= TOP) return [];
      const ys = [y0, Math.min(y1, TOP)];
      if (Y_END > y0 && Y_END < y1) ys.push(Y_END);
      const h = Math.max(...ys.map(outerHalf));
      return h > 0 ? [[-h, h]] : [];
    },
  });
  // Voussoirs round the arch, and a keystone.
  const a0 = Math.atan2(SPRING - ACY, -OW); const a1 = Math.atan2(SPRING - ACY, OW);
  const VN = 9;
  for (let i = 0; i < VN; i++) {
    const t0 = a0 + ((a1 - a0) * i) / VN; const t1 = a0 + ((a1 - a0) * (i + 1)) / VN;
    const tm = (t0 + t1) / 2;
    const key = i === Math.floor(VN / 2);
    const len = (AR + RING / 2) * Math.abs(t1 - t0) - 0.07;
    const dep = RING - 0.06 + (key ? 0.2 : 0);
    const geo = lumpy(roundedBox(len, dep, 0.9, 0.12, 2, 1), 0.035, 1.8, i * 3.1);
    const c = new THREE.Color(STONES[Math.floor(rng() * STONES.length)]).multiplyScalar(0.9 + rng() * 0.2);
    stones.push({ geometry: orient(paint(geo, c.getHex()), { pos: [ACY * 0 + Math.cos(tm) * (AR + RING / 2 + (key ? 0.1 : 0)), ACY + Math.sin(tm) * (AR + RING / 2 + (key ? 0.1 : 0)), FRONT + 0.08 - 0.45], roll: tm - Math.PI / 2 }), keepColor: true });
  }
  // Breast sides
  for (const side of [-1, 1]) {
    stoneFace(stones, rng, {
      a0: 0.55, a1: FRONT, y0: HEARTH, y1: breastTop, yaw: side * Math.PI / 2, wid: [0.9, 1.7], depth: 0.7,
      toWorld: (a, y, out) => [side * (BW + out), y, a],
    });
  }
  // Hearth: a raised stone platform, wider than the breast and running further to the right,
  // as it does in the photograph. Faces in smaller stones, top in big flags.
  const HX0 = -6.2; const HX1 = 7.6; const HZ = 6.7;
  stoneFace(stones, rng, { a0: HX0, a1: HX1, y0: 0, y1: HEARTH - 0.12, yaw: 0, rowH: [0.38, 0.62], wid: [0.8, 1.7], depth: 0.6, toWorld: (a, y, out) => [a, y, HZ + out] });
  stoneFace(stones, rng, { a0: 0.55, a1: HZ, y0: 0, y1: HEARTH - 0.12, yaw: -Math.PI / 2, rowH: [0.38, 0.62], wid: [0.8, 1.6], depth: 0.6, toWorld: (a, y, out) => [HX0 - out, y, a] });
  stoneFace(stones, rng, { a0: 0.55, a1: HZ, y0: 0, y1: HEARTH - 0.12, yaw: Math.PI / 2, rowH: [0.38, 0.62], wid: [0.8, 1.6], depth: 0.6, toWorld: (a, y, out) => [HX1 + out, y, a] });
  // flagstones on top, in front of the breast and along the extension
  const flags = [];
  const flagRow = (x0, x1, z0, z1) => {
    let x = x0;
    while (x < x1 - 0.2) {
      let w = 1.6 + rng() * 1.4; if (x1 - (x + w) < 0.9) w = x1 - x;
      const geo = lumpy(roundedBox(w - 0.08, 0.22, z1 - z0 - 0.08, 0.06, 2, 1), 0.02, 1.5, x);
      const c = new THREE.Color(STONES[Math.floor(rng() * STONES.length)]).multiplyScalar(1.0 + rng() * 0.15);
      flags.push({ geometry: orient(paint(geo, c.getHex()), { pos: [x + w / 2, HEARTH - 0.1, (z0 + z1) / 2] }), keepColor: true });
      x += w;
    }
  };
  flagRow(HX0, HX1, FRONT, HZ + 0.15);
  flagRow(-BW - 1.2, -BW, 0.55, FRONT);
  flagRow(BW, HX1, 0.55, FRONT);
  // Exterior stack: three exposed faces, bigger stones, and a stepped shoulder.
  const SW = 3.3; const SB = -0.6; const SD = -4.0;
  stoneFace(stones, rng, { a0: -SW, a1: SW, y0: 0, y1: stackTop, yaw: Math.PI, wid: [1.3, 2.7], rowH: [0.9, 1.5], seg: 1, toWorld: (a, y, out) => [-a, y, SD - out] });
  for (const side of [-1, 1]) stoneFace(stones, rng, { a0: SD, a1: SB, y0: 0, y1: stackTop, yaw: side * Math.PI / 2, wid: [1.0, 1.9], rowH: [0.9, 1.5], seg: 1, toWorld: (a, y, out) => [side * (SW + out), y, a] });
  // the front of the stack above the roof, which can be seen from the ridge side
  stoneFace(stones, rng, { a0: -SW, a1: SW, y0: 16, y1: stackTop, yaw: 0, wid: [1.3, 2.4], rowH: [0.9, 1.4], seg: 1, toWorld: (a, y, out) => [a, y, SB + out] });

  const stoneMat = standard({ vertexColors: true, roughness: 0.93, ...relief('stone', { seed: 7, repeat: 2, strength: 1.2 }) });
  g.add(mesh(mergeParts([...stones, ...flags]), stoneMat));

  // Mortar cores behind the stones, so a joint is a dark line and never a hole.
  const mortar = [];
  // Mortar is a pale lime, not a black void: dark joints round every stone are what made the
  // first pass read as a grid of pillows.
  const core = (x0, x1, y0, y1, z0, z1) => mortar.push({ geometry: new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color: 0x9c9283 });
  const crown = SPRING + RISE;
  core(-BW + 0.05, -OW, HEARTH, crown, 0.5, FRONT - 0.02);
  core(OW, BW - 0.05, HEARTH, crown, 0.5, FRONT - 0.02);
  core(-BW + 0.05, BW - 0.05, crown, breastTop, 0.5, FRONT - 0.02);
  core(HX0 + 0.05, HX1 - 0.05, 0, HEARTH - 0.2, 0.5, HZ - 0.02);
  core(-SW + 0.05, SW - 0.05, 0, stackTop, SD + 0.02, SB);
  mortar.push({ geometry: new THREE.BoxGeometry(SW * 2 + 0.6, 0.35, -SD + SB + 0.6).translate(0, stackTop + 0.1, (SD + SB) / 2), color: 0x6b6660 });
  g.add(mesh(mergeParts(mortar), standard({ vertexColors: true, roughness: 1, ...relief('stone', { seed: 2, repeat: 6, strength: 0.6 }) })));
  // flue opening on top of the stack
  g.add(mesh(new THREE.BoxGeometry(1.6, 0.05, 1.2).translate(0, stackTop + 0.29, (SD + SB) / 2), standard({ color: 0x111111, roughness: 1 })));
  // snow on the stack's crown
  g.add(mesh(paint(lumpy(roundedBox(SW * 2 + 0.7, 0.32, -SD + SB + 0.7, 0.14, 3, 2), 0.04, 1.3, 2), 0xeef3fb).translate(0, stackTop + 0.42, (SD + SB) / 2), standard({ vertexColors: true, roughness: 0.75 })));

  // --- the firebox: brick lining, splayed sides, soot toward the top ---
  const BACKZ = 1.0; const BACKH = 1.85;
  const IN = [0, HEARTH + 1.4, 2.4];
  const fx = [];
  const bt = brickTexture(seed);
  fx.push(quad([-BACKH, HEARTH, BACKZ], [BACKH, HEARTH, BACKZ], [BACKH, crown + 0.1, BACKZ], [-BACKH, crown + 0.1, BACKZ], IN, 1.8, 1.6));
  for (const side of [-1, 1]) {
    fx.push(quad([side * BACKH, HEARTH, BACKZ], [side * OW, HEARTH, FRONT - 0.5], [side * OW, crown + 0.1, FRONT - 0.5], [side * BACKH, crown + 0.1, BACKZ], IN, 1.4, 1.6));
  }
  fx.push(quad([-OW, crown + 0.1, FRONT - 0.5], [OW, crown + 0.1, FRONT - 0.5], [BACKH, crown + 0.1, BACKZ], [-BACKH, crown + 0.1, BACKZ], IN, 2, 1));
  fx.push(quad([-OW, HEARTH + 0.005, FRONT - 0.1], [OW, HEARTH + 0.005, FRONT - 0.1], [BACKH, HEARTH + 0.005, BACKZ], [-BACKH, HEARTH + 0.005, BACKZ], IN, 2, 1));
  // soot: vertex colours darkening toward the top
  const firebox = mergeParts(fx.map((geometry) => ({ geometry: paintBy(geometry, (p) => new THREE.Color(1, 1, 1).multiplyScalar(lerp(1.0, 0.25, smooth(HEARTH + 1.2, crown + 0.1, p.y)))), keepColor: true })));
  const fbm = mesh(firebox, standard({ vertexColors: true, map: bt, roughness: 0.95 }));
  fbm.castShadow = false;
  g.add(fbm);

  // --- the fire: a grate, three logs, an ember bed, and the flames ---
  const iron = [];
  for (const side of [-1, 1]) {
    iron.push({ geometry: new THREE.CylinderGeometry(0.05, 0.05, 1.6, 8).rotateX(Math.PI / 2).translate(side * 0.9, HEARTH + 0.35, 2.0), color: 0x1d1c1b });
    iron.push({ geometry: new THREE.CylinderGeometry(0.04, 0.06, 0.4, 8).translate(side * 0.9, HEARTH + 0.17, 2.75), color: 0x1d1c1b });
    iron.push({ geometry: new THREE.SphereGeometry(0.09, 10, 8).translate(side * 0.9, HEARTH + 0.62, 2.82), color: 0x8a6a2a });
    iron.push({ geometry: new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8).translate(side * 0.9, HEARTH + 0.62 - 0.32, 2.82), color: 0x1d1c1b });
  }
  for (const zz of [1.5, 2.0, 2.5]) iron.push({ geometry: new THREE.CylinderGeometry(0.035, 0.035, 2.0, 8).rotateZ(Math.PI / 2).translate(0, HEARTH + 0.36, zz), color: 0x1d1c1b });
  g.add(mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.5, metalness: 0.6 })));
  const logs = [];
  const logAt = (x0, y0, z0, x1, y1, z1, r) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const geo = new THREE.CylinderGeometry(r, r * 1.05, len, 14, 1);
    const mid = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    geo.applyQuaternion(q);
    geo.translate(...mid);
    // charred underside glows: ember colour where the log faces down toward the coals
    logs.push({ geometry: paintBy(geo, (p, n) => new THREE.Color(0x3b2a1f).lerp(new THREE.Color(0x150c08), clamp01(-n.y))), keepColor: true });
  };
  logAt(-1.3, HEARTH + 0.55, 2.1, 1.2, HEARTH + 0.6, 1.9, 0.26);
  logAt(-1.1, HEARTH + 0.75, 2.55, 0.9, HEARTH + 1.0, 1.5, 0.22);
  logAt(1.2, HEARTH + 0.8, 2.6, -0.5, HEARTH + 1.05, 1.55, 0.2);
  g.add(mesh(mergeParts(logs), standard({ vertexColors: true, roughness: 0.95, ...relief('bark', { seed: 33, repeat: 2 }) })));
  // ember bed: a low mound with glowing cracks
  const emberTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1a0a04'; ctx.fillRect(0, 0, w, h);
    const r2 = seededRandom(9);
    for (let i = 0; i < 260; i++) {
      const x = r2() * w; const y = r2() * h; const r = 3 + r2() * 12;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,${150 + r2() * 90 | 0},60,${0.6 + r2() * 0.4})`);
      gr.addColorStop(1, 'rgba(200,40,0,0)');
      ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const bed = new THREE.SphereGeometry(1, 24, 10, 0, TAU, 0, Math.PI / 2);
  bed.scale(1.7, 0.28, 0.75).translate(0, HEARTH, 2.05);
  const bedMesh = new THREE.Mesh(bed, standard({ color: 0x2a1408, emissive: 0xffffff, emissiveMap: emberTex, emissiveIntensity: 1.6, roughness: 1 }));
  bedMesh.userData.isGlowMesh = true;
  g.add(bedMesh);
  fire(g, { x: 0, y: HEARTH + 0.35, z: 2.05, width: 2.6 });
  g.add(glowCloud([0, HEARTH + 0.8, 2.2, -0.8, HEARTH + 0.5, 2.1, 0.8, HEARTH + 0.6, 2.0], [0.55, 0.2, 0.04, 0.4, 0.13, 0.02, 0.4, 0.13, 0.02], 3.2));

  // --- the mantel: one rough-hewn beam, with the garland on it and stockings hung from it ---
  const MY = 7.2; const MZ = FRONT + 0.5; const MW = 6.3;
  const beam = lumpy(roundedBox(MW * 2, 0.8, 1.25, 0.1, 2, 4), 0.025, 2.2, 3);
  g.add(mesh(paint(scaleUV(beam, 1, 1), 0x7a4a26).translate(0, MY, MZ), standard({ vertexColors: true, map: grainTexture(seed + 9, { base: 210 }), roughness: 0.75, ...relief('wood', { seed: 4, repeat: 3 }) })));
  garland(g, { x0: -MW - 0.5, x1: MW + 0.5, y: MY + 0.45, z: MZ + 0.1, seed: seed + 5, drape: 1.6 });
  stockings(g, { y: MY - 0.4, z: MZ + 0.66, xs: [-3.9, -1.3, 1.3, 3.9], seed });

  // --- the wall lantern on the logs to the left of the breast, and the log basket on the hearth ---
  lantern(g, { x: -BW - 2.0, y: 7.2, z: 0.52 });
  logBasket(g, { x: 6.0, y: HEARTH, z: 4.9, seed });
  // The exterior stack is merged with the breast and so casts no shadow either: from outside it
  // stands against the dark back wall, where a moon shadow off it would not read.
  return indoors(g);
}

// A fir garland: hundreds of short needle sprigs strung along the mantel and spilling off both
// ends, with red berry clusters, pinecones and warm micro-lights through it.
function garland(g, { x0, x1, y, z, seed, drape = 1.5 }) {
  const rng = seededRandom(seed);
  const sprigs = [];
  const extras = [];
  const glows = [];
  const glowCol = [];
  const beads = [];
  const path = (t) => {
    // along the mantel, then down past each end
    const span = x1 - x0;
    const x = x0 + t * span;
    let yy = y + 0.12 * Math.sin(t * 9);
    let zz = z + 0.15 * Math.sin(t * 13 + 1);
    const end = Math.min(t, 1 - t) * span; // distance from the nearer end
    if (end < 0.8) yy -= (0.8 - end) * drape;
    if (end < 0.8) zz += 0.1;
    return [x, yy, zz];
  };
  const N = 560;
  const sprigGeo = new THREE.IcosahedronGeometry(0.5, 1);
  sprigGeo.scale(0.8, 0.2, 0.26);
  for (let i = 0; i < N; i++) {
    const t = rng();
    const [px, py, pz] = path(t);
    const ox = (rng() - 0.5) * 0.6; const oy = (rng() - 0.3) * 0.45; const oz = (rng() - 0.35) * 0.7;
    const c = new THREE.Color(0x1f4a2a).lerp(new THREE.Color(0x3f7a3c), rng()).multiplyScalar(0.75 + rng() * 0.4);
    sprigs.push({ geometry: orient(paint(sprigGeo.clone(), c.getHex()), { pos: [px + ox, py + oy, pz + oz], yaw: rng() * TAU, pitch: (rng() - 0.5) * 1.2, roll: (rng() - 0.5) * 0.8, scale: 0.9 + rng() * 0.8 }), keepColor: true });
  }
  for (let i = 0; i < 26; i++) {
    const [px, py, pz] = path(rng());
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      extras.push({ geometry: paint(new THREE.SphereGeometry(0.075, 10, 8), rng() < 0.85 ? 0xb5121b : 0xd9a8a0).translate(px + (rng() - 0.5) * 0.25, py + 0.12 + (rng() - 0.5) * 0.2, pz + 0.3 + rng() * 0.15), keepColor: true });
    }
  }
  for (let i = 0; i < 9; i++) {
    const [px, py, pz] = path(0.06 + (i / 8) * 0.88);
    extras.push(...pinecone(px, py - 0.35, pz + 0.35, 0.42, rng));
  }
  for (let i = 0; i < 70; i++) {
    const [px, py, pz] = path(rng());
    const p = [px + (rng() - 0.5) * 0.5, py + 0.05 + (rng() - 0.2) * 0.3, pz + 0.2 + rng() * 0.25];
    beads.push({ geometry: paint(bead(0.04, 6), 0xfff0d0).translate(...p), keepColor: true });
    glows.push(...p);
    glowCol.push(0.7, 0.45, 0.2);
  }
  g.add(mesh(mergeParts(sprigs), standard({ vertexColors: true, roughness: 0.85, map: needleTexture(seed + 9) })));
  g.add(mesh(mergeParts(extras), standard({ vertexColors: true, roughness: 0.35, metalness: 0.05 })));
  g.add(unlit(mergeParts(beads), { toneMapped: false }));
  g.add(glowCloud(glows, glowCol, 0.55));
}

// Four stockings in four colours. A stocking is an extruded boot outline with a fur cuff.
function stockings(g, { y, z, xs, seed }) {
  const rng = seededRandom(seed + 3);
  const shape = new THREE.Shape();
  shape.moveTo(-0.35, 0);
  shape.lineTo(0.35, 0);
  shape.lineTo(0.35, -1.25);
  shape.bezierCurveTo(0.35, -1.45, 0.55, -1.5, 0.75, -1.52);
  shape.bezierCurveTo(1.0, -1.55, 1.05, -1.95, 0.75, -2.0);
  shape.lineTo(-0.05, -2.0);
  shape.bezierCurveTo(-0.4, -2.0, -0.38, -1.7, -0.35, -1.45);
  shape.closePath();
  const SOCK = [[0xb3121c, 0xf4efe6], [0x1d6b3a, 0xf4efe6], [0xf2ece0, 0xb3121c], [0x2348a8, 0xf4efe6]];
  const parts = [];
  const cuffs = [];
  xs.forEach((x, i) => {
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 3, curveSegments: 10 });
    geo.translate(0, 0, -0.11);
    const [body, cuff] = SOCK[i % SOCK.length];
    const striped = i === 2;
    const sock = paintBy(geo, (p) => {
      if (striped) return new THREE.Color(Math.floor((p.y + 3) / 0.22) % 2 ? 0xb3121c : 0xf2ece0);
      return new THREE.Color(body);
    });
    const flip = i % 2 ? -1 : 1;
    parts.push({ geometry: orient(sock, { pos: [x, y - 0.45, z], yaw: flip < 0 ? Math.PI : 0, roll: (rng() - 0.5) * 0.05 }), keepColor: true });
    cuffs.push({ geometry: paint(lumpy(roundedBox(0.95, 0.5, 0.48, 0.18, 3, 2), 0.03, 6, i), cuff).translate(x, y - 0.25, z), keepColor: true });
    cuffs.push({ geometry: paint(new THREE.TorusGeometry(0.08, 0.02, 6, 12), 0xc9a24a).translate(x, y + 0.08, z - 0.2), keepColor: true });
  });
  g.add(mesh(mergeParts(parts), standard({ vertexColors: true, roughness: 0.9, ...relief('weave', { seed: 8, repeat: 4, strength: 0.7 }) })));
  g.add(mesh(mergeParts(cuffs), standard({ vertexColors: true, roughness: 1, ...relief('weave', { seed: 2, repeat: 6, strength: 1.2 }) })));
}

// A wall lantern: an iron frame round warm glass, on a bracket. Glowing, not lighting -- the
// three real lights are spent on the fire, the tree and the chandelier.
function lantern(g, { x, y, z }) {
  const iron = [];
  iron.push({ geometry: new THREE.BoxGeometry(0.12, 0.6, 0.12).translate(x, y + 0.2, z + 0.04), color: 0x1a1918 });
  iron.push({ geometry: new THREE.BoxGeometry(0.08, 0.08, 0.7).translate(x, y + 0.45, z + 0.38), color: 0x1a1918 });
  const cx = x; const cy = y - 0.05; const cz = z + 0.72;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) iron.push({ geometry: new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(cx + sx * 0.24, cy, cz + sz * 0.24), color: 0x1a1918 });
  iron.push({ geometry: new THREE.ConeGeometry(0.42, 0.32, 4, 1).rotateY(Math.PI / 4).translate(cx, cy + 0.53, cz), color: 0x1a1918 });
  iron.push({ geometry: new THREE.BoxGeometry(0.56, 0.06, 0.56).translate(cx, cy - 0.4, cz), color: 0x1a1918 });
  g.add(mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.55, metalness: 0.6 })));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.7, 0.44).translate(cx, cy, cz), standard({ color: 0xffd59a, emissive: 0xffa040, emissiveIntensity: 1.6, roughness: 0.2 }));
  glass.userData.isGlowMesh = true;
  g.add(glass);
  g.add(glowCloud([cx, cy, cz], [0.9, 0.55, 0.22], 2.6));
}

function wickerTexture() {
  return repeatTex(canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#7a5a36'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const over = (x + y) % 2;
      const gr = ctx.createLinearGradient(x * 16, y * 16, x * 16, y * 16 + 16);
      gr.addColorStop(0, over ? '#c9a46e' : '#a07a48'); gr.addColorStop(0.5, over ? '#e8c890' : '#b48c58'); gr.addColorStop(1, over ? '#b08a56' : '#8a6438');
      ctx.fillStyle = gr; ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
    }
  }));
}

function logBasket(g, { x, y, z, seed }) {
  const rng = seededRandom(seed + 11);
  const basket = lathe([[0, 0], [0.85, 0], [0.95, 0.15], [1.1, 1.0], [1.18, 1.05], [1.12, 1.12], [1.02, 1.05], [0.9, 0.2], [0, 0.2]], 28);
  basket.scale(1.25, 1, 0.85);
  g.add(mesh(scaleUV(basket, 4, 2).translate(x, y, z), standard({ map: wickerTexture(), roughness: 0.9, ...relief('weave', { seed: 4, repeat: 8 }) })));
  const logs = [];
  for (let i = 0; i < 7; i++) {
    const r = 0.16 + rng() * 0.08;
    const geo = new THREE.CylinderGeometry(r, r, 2.1, 10).rotateZ(Math.PI / 2).rotateY((rng() - 0.5) * 0.4);
    const end = new THREE.Color(0xc9a070);
    logs.push({ geometry: paintBy(geo.translate(x + (rng() - 0.5) * 0.3, y + 1.0 + (i % 3) * 0.24 + (rng() - 0.5) * 0.1, z + ((i % 4) - 1.5) * 0.3), (p, n) => (Math.abs(n.x) > 0.9 ? end : new THREE.Color(0x5a4030))), keepColor: true });
  }
  g.add(mesh(mergeParts(logs), standard({ vertexColors: true, roughness: 0.95, ...relief('bark', { seed: 2, repeat: 2 }) })));
}

// ---------------------------------------------------------------------------
// The log cabin
// ---------------------------------------------------------------------------

// Openings per wall, along the wall's own axis (x for the front and back walls, z for the
// gables), with their sill and head heights. Kept as data so the logs, the chinking, the frames
// and the glass all read the same list and cannot disagree.
const OPENINGS = {
  front: [{ a0: 3, a1: 7, y0: 0, y1: 7.7, door: 'front' }, { a0: -14.5, a1: -8.5, y0: 3, y1: 8.6 }, { a0: 10, a1: 15, y0: 3, y1: 8.6 }],
  back: [{ a0: -16.6, a1: -11.4, y0: 1.9, y1: 9.4 }, { a0: -10.4, a1: -5.6, y0: 1.9, y1: 9.4 }, { a0: -4.6, a1: 0, y0: 0, y1: 8.4, door: 'french' }],
  left: [{ a0: -5, a1: 1.5, y0: 3, y1: 8.6 }],
  right: [{ a0: -3, a1: 3, y0: 3, y1: 8.6 }],
};

export function logCabin({ seed = 51 } = {}) {
  const { halfW: W, halfD: D, eave, ridge, overhang, logR: R, course } = CABIN;
  const rng = seededRandom(seed);
  const g = group();
  const logs = [];
  const chink = [];
  const sills = [];
  const trim = [];
  const glass = [];
  const windowGlow = [];
  const iron = [];
  const EXT = 1.3; // how far log ends run past the corners
  const HONEY = [0xc98a4c, 0xbf7f43, 0xd19657, 0xc08048, 0xb87a40];
  const WEATHER = new THREE.Color(0x7d6450);
  // A wall: `axis` x or z, at `at` on the other axis, running a0..a1, with courses starting at
  // `yOff`. `out` is the outward normal's sign. Gable walls carry on up to the ridge.
  const walls = [
    { name: 'front', axis: 'x', at: D, out: 1, yOff: 0 },
    { name: 'back', axis: 'x', at: -D, out: -1, yOff: 0 },
    { name: 'left', axis: 'z', at: -W, out: -1, yOff: course / 2, gable: true },
    { name: 'right', axis: 'z', at: W, out: 1, yOff: course / 2, gable: true },
  ];
  const segmentsFor = (opens, lo, hi, y0, y1) => {
    let runs = [[lo, hi]];
    for (const o of opens) {
      if (o.y1 <= y0 || o.y0 >= y1) continue;
      const next = [];
      for (const [r0, r1] of runs) {
        if (o.a1 <= r0 || o.a0 >= r1) { next.push([r0, r1]); continue; }
        if (o.a0 > r0) next.push([r0, o.a0]);
        if (o.a1 < r1) next.push([o.a1, r1]);
      }
      runs = next;
    }
    return runs.filter(([a, b]) => b - a > 0.3);
  };
  const toXYZ = (wall, a, y, off = 0) => (wall.axis === 'x' ? [a, y, wall.at + off * wall.out] : [wall.at + off * wall.out, y, a]);
  for (const wall of walls) {
    const span = wall.axis === 'x' ? W : D;
    const opens = OPENINGS[wall.name];
    for (let i = 0; ; i++) {
      const yc = R + wall.yOff + i * course;
      if (yc > (wall.gable ? ridge - 0.6 : eave - R + 0.2)) break;
      // On a gable, the course shortens to the roof line above the eave.
      let lo = -span - EXT; let hi = span + EXT;
      if (wall.gable && yc + R > eave) {
        const half = (D * (ridge - (yc + R * 0.6))) / (ridge - eave);
        if (half < 0.5) break;
        lo = -half; hi = half;
      }
      const runs = segmentsFor(opens, lo, hi, yc - R, yc + R);
      const tone = new THREE.Color(HONEY[Math.floor(rng() * HONEY.length)]).multiplyScalar(0.92 + rng() * 0.16);
      for (const [a0, a1] of runs) {
        const len = a1 - a0;
        const geo = new THREE.CylinderGeometry(R * (0.97 + rng() * 0.06), R, len, 22, 1);
        scaleUV(geo, 1, len / 4);
        if (wall.axis === 'x') geo.rotateZ(Math.PI / 2); else geo.rotateX(Math.PI / 2);
        const c = toXYZ(wall, (a0 + a1) / 2, yc);
        geo.translate(...c);
        const outward = wall.axis === 'x' ? new THREE.Vector3(0, 0, wall.out) : new THREE.Vector3(wall.out, 0, 0);
        const along = wall.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        logs.push({ geometry: paintBy(geo, (p, n) => {
          if (Math.abs(n.dot(along)) > 0.9) return new THREE.Color(0xd9b07a); // end grain
          const ext = smooth(-0.2, 0.5, n.dot(outward));
          return tone.clone().lerp(WEATHER, ext * 0.75);
        }), keepColor: true });
        // chinking under this log (not under the bottom course)
        if (i > 0) {
          const cg = new THREE.BoxGeometry(wall.axis === 'x' ? len : 0.56, 0.12, wall.axis === 'x' ? 0.56 : len);
          cg.translate(...toXYZ(wall, (a0 + a1) / 2, yc - course / 2));
          chink.push({ geometry: cg, color: 0xa3967f });
        }
      }
    }
    // A squared sill beam under the bottom course, running the whole wall except the doorways.
    // A round log only touches the floor along one line, and the gable walls start half a
    // course up, so without it there is a slot of blue snow showing under every wall.
    const sillTop = wall.yOff ? course / 2 + R * 0.6 : R * 0.65;
    for (const [a0, a1] of segmentsFor(opens.filter((o) => o.door), -span - EXT + 0.3, span + EXT - 0.3, 0, 0.2)) {
      const sg = new THREE.BoxGeometry(wall.axis === 'x' ? a1 - a0 : 0.92, sillTop + 0.3, wall.axis === 'x' ? 0.92 : a1 - a0);
      sg.translate(...toXYZ(wall, (a0 + a1) / 2, (sillTop - 0.3) / 2));
      sills.push({ geometry: sg, color: 0x5e3c22 });
    }
    // frames, sills, muntins and glass for every opening in this wall
    for (const o of opens) {
      const mid = (o.a0 + o.a1) / 2; const wid = o.a1 - o.a0; const ht = o.y1 - o.y0;
      const depth = 1.15;
      const frame = (a, y, w, h, d = depth, color = 0xb27a45) => {
        const geo = roundedBox(wall.axis === 'x' ? w : d, h, wall.axis === 'x' ? d : w, 0.03, 1, 1);
        trim.push({ geometry: paint(geo, color).translate(...toXYZ(wall, a, y)), keepColor: true });
      };
      frame(o.a0 + 0.17, o.y0 + ht / 2, 0.34, ht);
      frame(o.a1 - 0.17, o.y0 + ht / 2, 0.34, ht);
      frame(mid, o.y1 + 0.2, wid + 0.3, 0.4);
      if (!o.door) {
        frame(mid, o.y0 - 0.1, wid + 0.6, 0.22, depth + 0.6, 0xa56d3c);
        // muntins and glass in the wall's centre plane
        const cols = Math.max(2, Math.round(wid / 1.8));
        const rows = Math.max(2, Math.round(ht / 2.6));
        for (let k = 1; k < cols; k++) frame(o.a0 + 0.34 + ((wid - 0.68) * k) / cols, o.y0 + ht / 2, 0.1, ht, 0.18, 0xa06a3a);
        for (let k = 1; k < rows; k++) frame(mid, o.y0 + (ht * k) / rows, wid - 0.68, 0.1, 0.18, 0xa06a3a);
        const pane = new THREE.PlaneGeometry(wid - 0.6, ht);
        if (wall.axis === 'z') pane.rotateY(Math.PI / 2);
        glass.push({ geometry: pane.translate(...toXYZ(wall, mid, o.y0 + ht / 2)), color: 0xffffff });
        // The warm glow a lit window throws to somebody outside at dusk: a pane facing OUTWARD
        // only, so from inside it is culled and the view out stays clear.
        const glowPane = new THREE.PlaneGeometry(wid - 0.6, ht);
        if (wall.axis === 'x') { if (wall.out < 0) glowPane.rotateY(Math.PI); } else glowPane.rotateY(wall.out * Math.PI / 2);
        windowGlow.push({ geometry: glowPane.translate(...toXYZ(wall, mid, o.y0 + ht / 2, 0.06)), color: 0xffffff });
      }
    }
  }
  // The doors. The front door stands open INTO the room against nothing (its hinge is on the
  // right as you come in); the French doors stand open OUT onto the deck. An open door has to
  // look open -- the Greenbush lesson -- or nobody walks through it.
  const doorLeaf = (w, h, glazed, color) => {
    const parts = [];
    if (glazed) {
      const f = (x, y, ww, hh) => parts.push({ geometry: paint(roundedBox(ww, hh, 0.18, 0.02, 1, 1), color).translate(x, y, 0), keepColor: true });
      f(0.12, h / 2, 0.24, h); f(w - 0.12, h / 2, 0.24, h); f(w / 2, h - 0.12, w, 0.24); f(w / 2, 0.45, w, 0.9); f(w / 2, h * 0.55, w - 0.3, 0.08); f(w / 2, h * 0.78, w - 0.3, 0.08); f(w / 2, (0.9 + h) / 2, 0.08, h - 1.1);
      const pane = new THREE.PlaneGeometry(w - 0.4, h - 1.2).translate(w / 2, (0.9 + h - 0.24) / 2, 0);
      return { parts, pane };
    }
    const planks = 5;
    for (let k = 0; k < planks; k++) {
      const pw = w / planks;
      parts.push({ geometry: paint(roundedBox(pw - 0.02, h, 0.18, 0.03, 1, 1), new THREE.Color(color).multiplyScalar(0.92 + (k % 2) * 0.1).getHex()).translate(pw * (k + 0.5), h / 2, 0), keepColor: true });
    }
    for (const yy of [0.9, h - 0.9]) parts.push({ geometry: paint(new THREE.BoxGeometry(w - 0.2, 0.4, 0.1), color).translate(w / 2, yy, -0.13), keepColor: true });
    const brace = new THREE.BoxGeometry(0.35, Math.hypot(w - 0.4, h - 2.2), 0.1);
    brace.rotateZ(-Math.atan2(w - 0.4, h - 2.2));
    parts.push({ geometry: paint(brace, color).translate(w / 2, h / 2, -0.13), keepColor: true });
    return { parts, pane: null };
  };
  // Front door: authored spanning +x from its hinge at x = 7, and a yaw of +90 degrees takes +x
  // to -z, so it stands open into the room. (Rotation about y sends (1,0,0) to (cos, 0, -sin).)
  {
    const { parts } = doorLeaf(3.9, 7.6, false, 0x8e1b1b);
    for (const p of parts) trim.push({ geometry: orient(p.geometry, { pos: [7, 0, D - 0.42], yaw: Math.PI / 2 + 0.06 }), keepColor: true });
    iron.push({ geometry: orient(new THREE.TorusGeometry(0.16, 0.03, 6, 16), { pos: [7.15, 3.6, D - 0.42 - 3.4], yaw: Math.PI / 2 }), color: 0x1d1c1b });
  }
  // French doors at the back, swung OUT onto the deck. Never mirrored -- a negative scale flips
  // every triangle inside out -- so the right-hand leaf is authored spanning -x from its hinge.
  for (const [hx, yaw, shift] of [[-4.6, Math.PI / 2 - 0.1, 0], [0, -Math.PI / 2 + 0.1, -2.3]]) {
    const { parts, pane } = doorLeaf(2.3, 8.3, true, 0xa06a3a);
    const m = (geo) => orient(geo.clone().translate(shift, 0, 0), { pos: [hx, 0, -D - 0.45], yaw });
    for (const p of parts) trim.push({ geometry: m(p.geometry), keepColor: true });
    glass.push({ geometry: m(pane), color: 0xffffff });
  }
  // a stone step at each door
  const stepMat = [];
  stepMat.push({ geometry: lumpy(roundedBox(5.4, 0.45, 2.6, 0.12, 2, 2), 0.03, 1.5, 1).translate(5, 0.1, D + 1.9), color: 0x8d877c });
  // a wreath above the front door, outside
  wreath(g, { x: 5, y: 9.15, z: D + 0.62, r: 0.95, seed: seed + 2 });

  // --- floor: wide pine boards ---
  // Wide pine boards drawn on a canvas. The shipped wood-floor.jpg is narrow strip flooring,
  // which is a gymnasium rather than a cabin.
  const floorTex = repeatTex(canvasTexture(1024, 1024, (ctx) => floorPlanks(ctx, seed)), 3.4, 2.7);
  const floorMat = standard({ color: 0xe9ad70, roughness: 0.4, map: floorTex, ...relief('wood', { seed: 8, repeat: 9, strength: 0.5 }) });
  const floor = mesh(new THREE.BoxGeometry(W * 2 - 0.9, 0.2, D * 2 - 0.9).translate(0, -0.08, 0), floorMat);
  floor.castShadow = false;
  g.add(floor);

  // --- roof: two plank slopes with beams under them, snow on top, lights and icicles at the eaves ---
  const pitch = Math.atan2(ridge - eave, D);
  const slopeLen = (D + overhang) / Math.cos(pitch);
  const T = 0.75; // roof thickness
  const ceilingTex = grainTexture(seed + 3, { w: 512, h: 512, seams: 12, base: 232 });
  ceilingTex.repeat.set(3, 3);
  const roof = [];
  const snowParts = [];
  for (const side of [1, -1]) {
    // ceiling plane through (z = side*D, eave) and (z = 0, ridge); slab sits above it
    const zc = side * (D + overhang) / 2;
    const yc = ridge - Math.abs(zc) * Math.tan(pitch);
    const n = new THREE.Vector3(0, Math.cos(pitch), side * Math.sin(pitch));
    const slab = new THREE.BoxGeometry(W * 2 + overhang * 2 + 1.2, T, slopeLen + 0.4);
    scaleUV(slab, 1, 1);
    roof.push({ geometry: orient(paint(slab, 0xb8834e), { pos: [0, yc + n.y * T / 2, zc + n.z * T / 2], pitch: side * pitch }), keepColor: true });
    const snow = lumpy(roundedBox(W * 2 + overhang * 2 + 1.5, 0.7, slopeLen + 0.7, 0.32, 3, 4), 0.09, 0.35, side * 3);
    snowParts.push({ geometry: orient(paint(snow, 0xeef3fb), { pos: [0, yc + n.y * (T + 0.3), zc + n.z * (T + 0.3)], pitch: side * pitch }), keepColor: true });
  }
  // ridge cap of snow
  snowParts.push({ geometry: paint(lumpy(new THREE.CylinderGeometry(0.75, 0.75, W * 2 + overhang * 2 + 1.4, 16, 6).rotateZ(Math.PI / 2).scale(1, 0.55, 1), 0.06, 0.5, 4), 0xeef3fb).translate(0, ridge + T + 0.25, 0), keepColor: true });
  const roofMesh = mesh(mergeParts(roof), standard({ vertexColors: true, map: ceilingTex, roughness: 0.7 }));
  g.add(roofMesh);
  g.add(mesh(mergeParts(snowParts), standard({ vertexColors: true, roughness: 0.82, ...relief('stone', { seed: 12, repeat: 6, strength: 0.25 }) })));

  // beams: ridge, purlins, rafters in pairs, collar ties and tie beams
  const beams = [];
  const beamAlong = (x0, y0, z0, x1, y1, z1, w, h) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const geo = roundedBox(w, h, len, 0.05, 1, 2);
    scaleUV(geo, 1, len / 6);
    const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    geo.applyQuaternion(q);
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    beams.push({ geometry: paint(geo, new THREE.Color(0x8e5a30).multiplyScalar(0.9 + rng() * 0.2).getHex()), keepColor: true });
  };
  beamAlong(-W - overhang, ridge - 0.55, 0, W + overhang, ridge - 0.55, 0, 1.0, 1.1);
  for (const side of [1, -1]) {
    const zp = side * D * 0.5;
    beamAlong(-W, ridge - (D * 0.5) * Math.tan(pitch) - 0.5, zp, W, ridge - (D * 0.5) * Math.tan(pitch) - 0.5, zp, 0.8, 0.8);
  }
  for (const x of [-12, -4, 4, 12]) {
    for (const side of [1, -1]) beamAlong(x, ridge - 0.6, 0, x, eave - 0.2, side * (D - 0.2), 0.75, 0.9);
    beamAlong(x, 15.0, -(D * (ridge - 15.0)) / (ridge - eave) + 0.3, x, 15.0, (D * (ridge - 15.0)) / (ridge - eave) - 0.3, 0.6, 0.75);
    beamAlong(x, eave - 0.35, -D + 0.4, x, eave - 0.35, D - 0.4, 0.8, 0.85);
  }
  g.add(mesh(mergeParts(beams), standard({ vertexColors: true, map: grainTexture(seed + 6, { base: 215 }), roughness: 0.7, ...relief('wood', { seed: 6, repeat: 3 }) })));

  g.add(mesh(mergeParts(logs), standard({ vertexColors: true, map: grainTexture(seed, { base: 230 }), roughness: 0.62, ...relief('wood', { seed: 2, repeat: 4, strength: 0.9 }) })));
  g.add(mesh(mergeParts(chink), standard({ vertexColors: true, roughness: 1 })));
  g.add(mesh(mergeParts(sills), standard({ vertexColors: true, map: grainTexture(seed + 8, { base: 210 }), roughness: 0.8 })));
  g.add(mesh(mergeParts(trim), standard({ vertexColors: true, map: grainTexture(seed + 1, { base: 225 }), roughness: 0.6 })));
  g.add(mesh(mergeParts(stepMat), standard({ vertexColors: true, roughness: 0.9, ...relief('stone', { seed: 3, repeat: 2 }) })));
  if (iron.length) g.add(mesh(mergeParts(iron), standard({ vertexColors: true, roughness: 0.5, metalness: 0.6 })));
  const glassMesh = new THREE.Mesh(mergeParts(glass), new THREE.MeshStandardMaterial({
    color: 0xa9c0d4, transparent: true, opacity: 0.14, roughness: 0.04, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
  }));
  glassMesh.castShadow = false;
  glassMesh.receiveShadow = false;
  g.add(glassMesh);
  const glowMesh = new THREE.Mesh(mergeParts(windowGlow), new THREE.MeshBasicMaterial({
    color: 0xff9c45, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  }));
  glowMesh.castShadow = false;
  glowMesh.receiveShadow = false;
  g.add(glowMesh);

  // --- eave lights (big old C9 bulbs in five colours) and icicles ---
  const bulbs = [];
  const glowPos = [];
  const glowCol = [];
  const ice = [];
  const wire = [];
  const eaveY = eave - overhang * Math.tan(pitch) - 0.15;
  const C9 = LIGHT_PALETTES.multi;
  const string = (pts, spacing) => {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay, az] = pts[k]; const [bx, by, bz] = pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay, bz - az);
      const n = Math.max(1, Math.round(len / spacing));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const sag = 0.18 * Math.sin(Math.PI * ((t * n) % 1));
        const p = [lerp(ax, bx, t), lerp(ay, by, t) - sag - 0.12, lerp(az, bz, t)];
        const c = C9[(bulbs.length) % C9.length];
        const bulb = new THREE.ConeGeometry(0.09, 0.26, 8).rotateX(Math.PI).translate(p[0], p[1] - 0.1, p[2]);
        bulbs.push({ geometry: paint(bulb, new THREE.Color(c[0] * 0.6 + 0.4, c[1] * 0.6 + 0.4, c[2] * 0.6 + 0.4).getHex()), keepColor: true });
        glowPos.push(p[0], p[1] - 0.12, p[2]);
        glowCol.push(c[0] * 0.95, c[1] * 0.95, c[2] * 0.95);
      }
      const wg = new THREE.CylinderGeometry(0.02, 0.02, len, 4);
      const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
      wg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
      wire.push({ geometry: wg.translate((ax + bx) / 2, (ay + by) / 2 - 0.08, (az + bz) / 2), color: 0x1e3a22 });
    }
  };
  const EZ = D + overhang - 0.1;
  const EX = W + overhang + 0.55;
  for (const side of [1, -1]) string([[-EX, eaveY, side * EZ], [EX, eaveY, side * EZ]], 1.15);
  for (const sx of [-1, 1]) {
    for (const side of [1, -1]) string([[sx * EX, eaveY, side * EZ], [sx * EX, ridge + T + 0.1, 0]], 1.15);
  }
  // icicles along both eaves, longest where the eave is shaded
  for (const side of [1, -1]) {
    for (let x = -EX + 0.2; x < EX; x += 0.35 + rng() * 0.5) {
      const len = 0.25 + Math.pow(rng(), 2) * 1.7;
      const geo = lathe([[0, 0], [0.012, 0.03], [0.05 + len * 0.03, len * 0.75], [0.07 + len * 0.025, len * 0.98], [0, len]], 7);
      // tip at the bottom, fat end up against the eave
      ice.push({ geometry: geo.translate(x, eaveY + 0.22 - len, side * (EZ + 0.25)), color: 0xdfeaf5 });
    }
  }
  g.add(unlit(mergeParts(bulbs), { toneMapped: false }));
  g.add(glowCloud(glowPos, glowCol, 2.2));
  g.add(mesh(mergeParts(wire), standard({ vertexColors: true, roughness: 0.7 })));
  const iceMesh = mesh(mergeParts(ice), standard({ vertexColors: true, roughness: 0.08, metalness: 0.05, emissive: 0x2a3c55, emissiveIntensity: 0.6 }));
  iceMesh.castShadow = false;
  g.add(iceMesh);
  return g;
}

// Wide pine floorboards: boards of a few widths running along z, staggered end joints, each board
// its own shade. A canvas, used as the overlay on the photographic wood grain.
function floorPlanks(ctx, seed) {
  const rng = seededRandom(seed + 70);
  let x = 0;
  while (x < 1024) {
    const w = 72 + Math.floor(rng() * 3) * 22;
    let y = -Math.floor(rng() * 400);
    while (y < 1024) {
      const len = 380 + rng() * 520;
      const t = 205 + rng() * 45;
      ctx.fillStyle = `rgb(${t | 0},${(t * 0.93) | 0},${(t * 0.86) | 0})`;
      ctx.fillRect(x, y, Math.min(w, 1024 - x), len);
      // grain along the board
      for (let k = 0; k < 14; k++) {
        const gx = x + rng() * w;
        ctx.strokeStyle = `rgba(120,70,35,${0.12 + rng() * 0.22})`;
        ctx.lineWidth = 0.8 + rng() * 2.2;
        ctx.beginPath(); ctx.moveTo(gx, y);
        let px = gx;
        for (let yy = y; yy < y + len; yy += 24) { px += (rng() - 0.5) * 3; ctx.lineTo(Math.min(x + w - 2, Math.max(x + 2, px)), yy); }
        ctx.stroke();
      }
      if (rng() < 0.35) {
        const kx = x + w * (0.3 + rng() * 0.4); const ky = y + rng() * len;
        const gr = ctx.createRadialGradient(kx, ky, 0, kx, ky, 12);
        gr.addColorStop(0, 'rgba(80,40,15,0.8)'); gr.addColorStop(1, 'rgba(120,70,35,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(kx, ky, 8, 16, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = 'rgba(60,35,20,0.75)';
      ctx.fillRect(x, y, Math.min(w, 1024 - x), 3);
      // two nail heads at each end
      ctx.fillStyle = 'rgba(40,30,25,0.6)';
      for (const ny of [y + 12, y + len - 12]) for (const nx of [x + w * 0.25, x + w * 0.75]) { ctx.beginPath(); ctx.arc(nx, ny, 2.5, 0, TAU); ctx.fill(); }
      y += len;
    }
    ctx.fillStyle = 'rgba(55,32,18,0.85)';
    ctx.fillRect(x, 0, 3, 1024);
    x += w;
  }
}

// A fir wreath with a red velvet bow, berries and pinecones.
function wreath(g, { x, y, z, r = 1.1, seed }) {
  const rng = seededRandom(seed);
  const sprigs = [];
  const extras = [];
  const sprigGeo = new THREE.IcosahedronGeometry(0.5, 1).scale(0.7, 0.18, 0.22);
  for (let i = 0; i < 180; i++) {
    const a = rng() * TAU; const rr = r + (rng() - 0.5) * 0.45;
    const c = new THREE.Color(0x1f4a2a).lerp(new THREE.Color(0x3f7a3c), rng()).multiplyScalar(0.75 + rng() * 0.4);
    sprigs.push({ geometry: orient(paint(sprigGeo.clone(), c.getHex()), { pos: [x + Math.cos(a) * rr, y + Math.sin(a) * rr, z + (rng() - 0.3) * 0.3], roll: a + Math.PI / 2 + (rng() - 0.5), yaw: (rng() - 0.5) * 0.8, pitch: Math.PI / 2 + (rng() - 0.5) * 0.6 }), keepColor: true });
  }
  for (let i = 0; i < 14; i++) {
    const a = rng() * TAU;
    for (let k = 0; k < 3; k++) extras.push({ geometry: paint(new THREE.SphereGeometry(0.08, 8, 6), 0xb5121b).translate(x + Math.cos(a) * r + (rng() - 0.5) * 0.2, y + Math.sin(a) * r + (rng() - 0.5) * 0.2, z + 0.25), keepColor: true });
  }
  // bow at the bottom
  for (const side of [-1, 1]) {
    const loop = new THREE.TorusGeometry(0.3, 0.09, 8, 16).scale(1, 0.7, 0.5);
    extras.push({ geometry: orient(paint(loop, 0xa4111a), { pos: [x + side * 0.3, y - r + 0.05, z + 0.3], roll: side * 0.4 }), keepColor: true });
    const tail = roundedBox(0.2, 0.9, 0.05, 0.02, 1, 1);
    extras.push({ geometry: orient(paint(tail, 0xa4111a), { pos: [x + side * 0.2, y - r - 0.5, z + 0.28], roll: side * 0.25 }), keepColor: true });
  }
  extras.push({ geometry: paint(new THREE.SphereGeometry(0.13, 10, 8), 0x8e0e16).translate(x, y - r + 0.05, z + 0.35), keepColor: true });
  g.add(mesh(mergeParts(sprigs), standard({ vertexColors: true, roughness: 0.85, map: needleTexture(seed) })));
  g.add(mesh(mergeParts(extras), standard({ vertexColors: true, roughness: 0.45 })));
}

// The back deck the French doors open onto, with the turned balusters the photograph shows
// through its windows, every rail capped with snow.
export function cabinDeck({ seed = 61, x0 = -18.6, x1 = 3.4, z0 = -CABIN.halfD - 0.5, z1 = -CABIN.halfD - 11 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const boards = [];
  const n = Math.round((x1 - x0) / 0.5);
  for (let i = 0; i < n; i++) {
    const x = x0 + (i + 0.5) * ((x1 - x0) / n);
    const geo = roundedBox((x1 - x0) / n - 0.04, 0.16, z0 - z1, 0.02, 1, 2);
    scaleUV(geo, 1, (z0 - z1) / 6);
    boards.push({ geometry: paint(geo, new THREE.Color(0x7c5536).multiplyScalar(0.85 + rng() * 0.25).getHex()).translate(x, 0.12, (z0 + z1) / 2), keepColor: true });
  }
  const rails = [];
  const balusters = [];
  const snow = [];
  const prof = [[0, 0], [0.13, 0], [0.13, 0.25], [0.09, 0.32], [0.07, 0.6], [0.11, 0.95], [0.12, 1.15], [0.07, 1.45], [0.06, 2.1], [0.1, 2.3], [0.1, 2.55], [0, 2.55]];
  const bal = lathe(prof, 10);
  const runs = [
    [[x0 + 0.2, z1 + 0.2], [x1 - 0.2, z1 + 0.2]],
    [[x0 + 0.2, z0], [x0 + 0.2, z1 + 0.2]],
    [[x1 - 0.2, z0], [x1 - 0.2, z1 + 4.5]],
  ];
  for (const [[ax, az], [bx, bz]] of runs) {
    const len = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bx - ax, bz - az);
    const cx = (ax + bx) / 2; const cz = (az + bz) / 2;
    for (const [yy, hh] of [[0.45, 0.2], [3.0, 0.3]]) {
      rails.push({ geometry: orient(paint(roundedBox(0.36, hh, len + 0.3, 0.05, 1, 2), 0x4a3426), { pos: [cx, yy, cz], yaw }), keepColor: true });
    }
    snow.push({ geometry: orient(paint(lumpy(roundedBox(0.5, 0.28, len + 0.3, 0.13, 2, 3), 0.04, 1.2, ax), 0xeef3fb), { pos: [cx, 3.27, cz], yaw }), keepColor: true });
    const count = Math.round(len / 0.55);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      balusters.push({ geometry: paint(bal.clone(), 0x2e2420).translate(lerp(ax, bx, t), 0.5, lerp(az, bz, t)), keepColor: true });
    }
    // posts at each end
    for (const [px, pz] of [[ax, az], [bx, bz]]) {
      rails.push({ geometry: paint(roundedBox(0.55, 3.6, 0.55, 0.05, 1, 2), 0x4a3426).translate(px, 1.8, pz), keepColor: true });
      snow.push({ geometry: paint(lumpy(roundedBox(0.7, 0.35, 0.7, 0.16, 2, 2), 0.04, 2, px), 0xeef3fb).translate(px, 3.75, pz), keepColor: true });
    }
  }
  // snow drifted in along the deck's outer edge and in the corners, cleared in front of the doors
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = lerp(x0 + 0.8, x1 - 0.8, t);
    snow.push({ geometry: paint(lumpy(new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2).scale(1.3 + rng() * 0.6, 0.35 + rng() * 0.25, 0.9), 0.06, 0.8, i), 0xeef3fb).translate(x, 0.18, z1 + 1.0), keepColor: true });
  }
  g.add(mesh(mergeParts(boards), standard({ vertexColors: true, map: grainTexture(seed, { base: 220 }), roughness: 0.75 })));
  g.add(mesh(mergeParts([...rails, ...balusters]), standard({ vertexColors: true, roughness: 0.6, ...relief('wood', { seed: 5, repeat: 2 }) })));
  g.add(mesh(mergeParts(snow), standard({ vertexColors: true, roughness: 0.8 })));
  return g;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

function plaidTexture(a = '#a3141d', b = '#1d4a2c', c = '#e9d8b0') {
  return repeatTex(canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = a; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = b;
    for (const o of [0, 128]) { ctx.fillRect(o + 20, 0, 48, h); ctx.fillRect(0, o + 20, w, 48); }
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = c;
    for (const o of [0, 128]) { ctx.fillRect(o + 90, 0, 6, h); ctx.fillRect(0, o + 90, w, 6); }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    for (const o of [0, 128]) { ctx.fillRect(o + 36, 0, 14, h); ctx.fillRect(0, o + 36, w, 14); }
    ctx.globalAlpha = 1;
  }));
}

// A deep three-seat sofa in caramel leather, with plaid and knit cushions and a throw over one
// arm. Faces +z.
export function cabinSofa({ seed = 71 } = {}) {
  const g = group();
  const leather = [];
  const W = 7.6; const D = 3.3;
  const add = (w, h, d, x, y, z, r = 0.18, tone = 0xa8693c) => leather.push({ geometry: paint(lumpy(roundedBox(w, h, d, r, 3, 2), 0.012, 3, x + y), tone).translate(x, y, z), keepColor: true });
  add(W, 1.0, D, 0, 0.75, 0, 0.12, 0x8c5532);
  for (const s of [-1, 1]) add(0.75, 2.2, D, s * (W / 2 - 0.37), 1.25, 0, 0.3);
  add(W - 1.4, 1.9, 0.75, 0, 2.05, -D / 2 + 0.38, 0.25);
  for (let k = 0; k < 3; k++) {
    const x = -W / 2 + 0.75 + (W - 1.5) * (k + 0.5) / 3;
    add((W - 1.5) / 3 - 0.06, 0.55, D - 0.85, x, 1.5, 0.35, 0.2, 0xb3743f);
    leather.push({ geometry: orient(paint(lumpy(roundedBox((W - 1.5) / 3 - 0.08, 1.5, 0.6, 0.25, 3, 2), 0.015, 3, k), 0xb3743f), { pos: [x, 2.45, -D / 2 + 0.95], pitch: -0.18 }), keepColor: true });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) leather.push({ geometry: paint(new THREE.CylinderGeometry(0.1, 0.07, 0.3, 10), 0x2b1b12).translate(sx * (W / 2 - 0.3), 0.15, sz * (D / 2 - 0.3)), keepColor: true });
  g.add(mesh(mergeParts(leather), standard({ vertexColors: true, roughness: 0.48, ...relief('hide', { seed, repeat: 6, strength: 0.25 }) })));
  // cushions: plaid, knit cream, plaid
  const pl = [];
  pl.push({ geometry: orient(lumpy(roundedBox(1.5, 1.4, 0.45, 0.22, 3, 2), 0.03, 2, 1), { pos: [-W / 2 + 1.3, 2.35, -0.55], yaw: 0.3, pitch: -0.2 }) });
  pl.push({ geometry: orient(lumpy(roundedBox(1.4, 1.35, 0.45, 0.22, 3, 2), 0.03, 2, 2), { pos: [W / 2 - 1.3, 2.35, -0.55], yaw: -0.25, pitch: -0.2 }) });
  g.add(mesh(mergeParts(pl.map((p) => ({ ...p, color: 0xffffff }))), standard({ vertexColors: true, map: plaidTexture(), roughness: 0.95, ...relief('weave', { seed: 3, repeat: 6, strength: 0.6 }) })));
  const knit = [];
  knit.push({ geometry: orient(lumpy(roundedBox(1.3, 1.25, 0.5, 0.24, 3, 2), 0.04, 3, 3), { pos: [-W / 2 + 2.4, 2.25, -0.45], yaw: 0.1, pitch: -0.25 }), color: 0xece2cc });
  // the throw over the right arm: a draped slab, folded down the outside
  const throwG = paramSurface(24, 16, (u, v) => {
    const x = W / 2 - 0.37 + (v - 0.5) * 0;
    const a = v * Math.PI;
    const r = 0.5;
    const px = x + Math.cos(Math.PI - a) * r * 1.1 + (v > 0.8 ? (v - 0.8) * 1.5 : 0);
    const py = 2.36 + Math.sin(a) * 0.15 - Math.pow(Math.max(0, v - 0.55), 1.3) * 2.6 + Math.pow(Math.max(0, 0.45 - v), 1.3) * -1.6;
    const pz = -1.0 + u * 2.3 + 0.06 * Math.sin(u * 14 + v * 3);
    return [px, py, pz];
  }, { outward: (cx, cy, cz) => [cx - (W / 2 - 0.37), cy - 1.6, 0] });
  knit.push({ geometry: throwG, color: 0xd8cbb0 });
  const knitMat = standard({ vertexColors: true, roughness: 1, side: THREE.DoubleSide, ...relief('weave', { seed: 9, repeat: 14, strength: 1.4 }) });
  g.add(mesh(mergeParts(knit), knitMat));
  return indoors(g);
}

// A wing armchair upholstered in red tartan, on turned legs. Faces +z.
export function plaidArmchair({ seed = 72 } = {}) {
  const g = group();
  const parts = [];
  const add = (w, h, d, x, y, z, r = 0.2, extra = {}) => parts.push({ geometry: orient(lumpy(roundedBox(w, h, d, r, 3, 2), 0.015, 3, x + y + z), { pos: [x, y, z], ...extra }), color: 0xffffff });
  add(3.0, 0.9, 2.9, 0, 0.95, 0, 0.15);
  add(2.4, 0.5, 2.2, 0, 1.6, 0.25, 0.2);
  add(2.9, 2.7, 0.6, 0, 2.9, -1.2, 0.25, { pitch: -0.1 });
  for (const s of [-1, 1]) {
    add(0.5, 1.2, 2.6, s * 1.3, 1.9, 0, 0.22);
    add(0.45, 1.6, 1.1, s * 1.3, 3.0, -0.85, 0.2, { yaw: -s * 0.2 });
  }
  g.add(mesh(mergeParts(parts), standard({ vertexColors: true, map: plaidTexture('#9b1219', '#14321f', '#e2c27a'), roughness: 0.95, ...relief('weave', { seed, repeat: 8, strength: 0.6 }) })));
  const legs = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) legs.push({ geometry: paint(lathe([[0, 0], [0.09, 0], [0.12, 0.2], [0.08, 0.35], [0.11, 0.5], [0, 0.52]], 10), 0x4b2e1a).translate(sx * 1.3, 0, sz * 1.25), keepColor: true });
  g.add(mesh(mergeParts(legs), standard({ vertexColors: true, roughness: 0.5 })));
  return indoors(g);
}

// A slab coffee table on log legs, set for Christmas Eve: two mugs of cocoa with marshmallows,
// a plate of iced cookies and a candle in a jar.
export function cocoaTable({ seed = 73 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const wood = [];
  const top = lumpy(roundedBox(4.6, 0.32, 2.5, 0.12, 2, 4), 0.03, 0.9, 2);
  scaleUV(top, 1, 1);
  wood.push({ geometry: paint(top, 0x8a562e).translate(0, 1.45, 0), keepColor: true });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) wood.push({ geometry: paint(new THREE.CylinderGeometry(0.22, 0.25, 1.3, 12), 0x6b4428).translate(sx * 1.8, 0.65, sz * 0.85), keepColor: true });
  g.add(mesh(mergeParts(wood), standard({ vertexColors: true, map: grainTexture(seed, { base: 220 }), roughness: 0.55 })));
  const china = [];
  const Y = 1.61;
  for (const [mx, mz, col] of [[-1.3, 0.3, 0xb3121c], [-0.6, -0.45, 0xf0ece4]]) {
    const mug = lathe([[0, 0], [0.22, 0], [0.24, 0.05], [0.25, 0.5], [0.22, 0.5], [0.21, 0.08], [0, 0.08]], 20);
    china.push({ geometry: paint(mug, col).translate(mx, Y, mz), keepColor: true });
    china.push({ geometry: paint(new THREE.TorusGeometry(0.12, 0.035, 8, 14, Math.PI * 1.2).rotateZ(-Math.PI * 0.6), col).translate(mx + 0.26, Y + 0.27, mz), keepColor: true });
    china.push({ geometry: paint(new THREE.CylinderGeometry(0.215, 0.215, 0.02, 18), 0x4a2614).translate(mx, Y + 0.43, mz), keepColor: true });
    for (let k = 0; k < 4; k++) china.push({ geometry: paint(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), 0xfaf6ee).translate(mx + (rng() - 0.5) * 0.22, Y + 0.47, mz + (rng() - 0.5) * 0.22), keepColor: true });
  }
  // plate of cookies
  china.push({ geometry: paint(lathe([[0, 0], [0.55, 0], [0.62, 0.06], [0.6, 0.07], [0.5, 0.03], [0, 0.03]], 28), 0xf2efe8).translate(0.7, Y, 0.1), keepColor: true });
  const ICING = [0xf6f1e6, 0xd2232e, 0x2d8a4a, 0xf2c94c];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU; const r = k === 0 ? 0 : 0.32;
    const x = 0.7 + Math.cos(a) * r; const z = 0.1 + Math.sin(a) * r;
    china.push({ geometry: paint(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14), 0xb9783e).translate(x, Y + 0.06 + (k === 0 ? 0.05 : 0), z), keepColor: true });
    china.push({ geometry: paint(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 14), ICING[k % ICING.length]).translate(x, Y + 0.095 + (k === 0 ? 0.05 : 0), z), keepColor: true });
  }
  g.add(mesh(mergeParts(china), standard({ vertexColors: true, roughness: 0.3 })));
  // the candle
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.42, 16).translate(1.65, Y + 0.21, -0.55), standard({ color: 0xf3ead6, roughness: 0.6 })));
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 2.2, 1).translate(1.65, Y + 0.55, -0.55), new THREE.MeshBasicMaterial({ color: 0xffd27a, toneMapped: false }));
  g.add(flame);
  g.add(glowCloud([1.65, Y + 0.55, -0.55], [0.8, 0.5, 0.2], 1.1));
  return indoors(g);
}

// A sheepskin-and-fur rug: an irregular outline whose top is a deep nap, drawn as fur strokes.
export function furRug({ seed = 74, width = 9, depth = 5.5 } = {}) {
  const rng = seededRandom(seed);
  const lobes = Array.from({ length: 9 }, () => 0.85 + rng() * 0.25);
  const rAt = (a) => {
    const k = (a / TAU) * lobes.length;
    const i = Math.floor(k); const f = k - i;
    const r0 = lobes[i % lobes.length]; const r1 = lobes[(i + 1) % lobes.length];
    return lerp(r0, r1, f * f * (3 - 2 * f)) * (1 + 0.05 * Math.sin(a * 13));
  };
  const geom = paramSurface(120, 18, (u, v) => {
    const a = u * TAU;
    const rr = rAt(a) * v;
    const x = Math.cos(a) * rr * width / 2; const z = Math.sin(a) * rr * depth / 2;
    const y = 0.14 + 0.2 * (1 - Math.pow(v, 6)) + 0.05 * smoothNoise3(x * 1.3, 0, z * 1.3);
    return [x, y, z, x / 2, z / 2];
  }, { closedU: true, outward: () => [0, 1, 0] });
  const tex = repeatTex(canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e3dacb'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4200; i++) {
      const x = rng() * w; const y = rng() * h; const a = rng() * TAU; const len = 6 + rng() * 14;
      ctx.strokeStyle = rng() < 0.6 ? `rgba(255,252,246,${0.4 + rng() * 0.5})` : `rgba(150,130,110,${0.2 + rng() * 0.25})`;
      ctx.lineWidth = 1 + rng() * 2;
      wrapped(w, h, x, y, 20, (px, py) => { ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + Math.cos(a) * len * 0.6 + 3, py + Math.sin(a) * len * 0.6, px + Math.cos(a) * len, py + Math.sin(a) * len); ctx.stroke(); });
    }
  }));
  const m = mesh(geom, standard({ color: 0xf2ebe0, map: tex, bumpMap: tex, bumpScale: 0.8, roughness: 1 }));
  m.castShadow = false;
  return group(m);
}

// An iron ring chandelier with eight candles, hung on chains. Origin at the ring; `drop` is the
// chain length up to the beam.
export function candleChandelier({ drop = 5, radius = 2.2 } = {}) {
  const g = group();
  const iron = [];
  iron.push({ geometry: new THREE.TorusGeometry(radius, 0.08, 8, 48).rotateX(Math.PI / 2) });
  iron.push({ geometry: new THREE.TorusGeometry(radius * 0.55, 0.05, 8, 32).rotateX(Math.PI / 2).translate(0, -0.35, 0) });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const top = new THREE.Vector3(0, drop, 0); const bot = new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius);
    const len = top.distanceTo(bot);
    const c = new THREE.CylinderGeometry(0.025, 0.025, len, 5);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize()));
    iron.push({ geometry: c.translate((top.x + bot.x) / 2, (top.y + bot.y) / 2, (top.z + bot.z) / 2) });
  }
  const flames = [];
  const glowPos = [];
  const glowCol = [];
  const wax = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const x = Math.cos(a) * radius; const z = Math.sin(a) * radius;
    iron.push({ geometry: new THREE.CylinderGeometry(0.16, 0.1, 0.12, 12).translate(x, 0.1, z) });
    wax.push({ geometry: new THREE.CylinderGeometry(0.09, 0.09, 0.7, 12).translate(x, 0.5, z), color: 0xf2e8d2 });
    flames.push({ geometry: paint(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 2.4, 1).translate(x, 0.98, z), 0xffd690), keepColor: true });
    glowPos.push(x, 0.98, z); glowCol.push(0.9, 0.55, 0.22);
  }
  g.add(mesh(mergeParts(iron.map((p) => ({ ...p, color: 0x1b1a19 }))), standard({ vertexColors: true, roughness: 0.5, metalness: 0.6 })));
  g.add(mesh(mergeParts(wax), standard({ vertexColors: true, roughness: 0.6, emissive: 0x3a2410, emissiveIntensity: 0.4 })));
  g.add(unlit(mergeParts(flames), { toneMapped: false }));
  g.add(glowCloud(glowPos, glowCol, 1.2));
  const light = new THREE.PointLight(0xffc27a, 55, 30, 2);
  light.position.set(0, 0.4, 0);
  g.add(light);
  return indoors(g);
}

// ---------------------------------------------------------------------------
// Outside
// ---------------------------------------------------------------------------

// A snowman with a top hat, a knitted scarf in two colours, coal eyes and buttons, a carrot nose
// and stick arms waving. Faces +z. About 6.5ft to the top of the hat.
export function snowman({ seed = 81 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const snowBody = [];
  const balls = [[1.55, 1.3], [1.12, 3.45], [0.8, 5.05]];
  for (const [r, y] of balls) {
    const s = lumpy(new THREE.SphereGeometry(r, 40, 28), r * 0.035, 1.6, r * 5);
    snowBody.push({ geometry: paint(s, 0xf2f5fb).translate(0, y, 0), keepColor: true });
  }
  // the snow it was rolled from, heaped round the base
  snowBody.push({ geometry: paint(lumpy(new THREE.SphereGeometry(1, 24, 10, 0, TAU, 0, Math.PI / 2).scale(2.1, 0.45, 2.1), 0.08, 0.8, 1), 0xeef3fb), keepColor: true });
  g.add(mesh(mergeParts(snowBody), standard({ vertexColors: true, roughness: 0.78, ...relief('stone', { seed: 4, repeat: 5, strength: 0.4 }) })));
  const bits = [];
  const onBall = (bi, yaw, pitch, out = 0) => {
    const [r, y] = balls[bi];
    return [Math.sin(yaw) * Math.cos(pitch) * (r + out), y + Math.sin(pitch) * (r + out), Math.cos(yaw) * Math.cos(pitch) * (r + out)];
  };
  for (const yaw of [-0.33, 0.33]) bits.push({ geometry: paint(new THREE.IcosahedronGeometry(0.1, 1), 0x141414).translate(...onBall(2, yaw, 0.28, -0.03)), keepColor: true });
  for (let k = 0; k < 7; k++) {
    const a = -0.5 + (k / 6) * 1.0;
    bits.push({ geometry: paint(new THREE.IcosahedronGeometry(0.055, 1), 0x141414).translate(...onBall(2, a, -0.32 - 0.12 * Math.cos(a * 3), -0.02)), keepColor: true });
  }
  for (const pitch of [0.45, 0.05, -0.35]) bits.push({ geometry: paint(new THREE.IcosahedronGeometry(0.12, 1), 0x141414).translate(...onBall(1, 0, pitch, -0.03)), keepColor: true });
  // carrot
  const carrot = new THREE.ConeGeometry(0.12, 0.95, 12).rotateX(Math.PI / 2);
  bits.push({ geometry: paint(carrot, 0xe8701a).translate(0, balls[2][1] + 0.02, balls[2][0] + 0.42), keepColor: true });
  // stick arms, one raised in a wave, each with twigs
  const arm = (side, up) => {
    const p0 = [side * 0.9, 3.7, 0]; const p1 = [side * 2.1, 3.7 + up * 1.2, 0.15]; const p2 = [side * 2.9, 3.7 + up * 2.0, 0.1];
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p0, p1, p2].map((p) => new THREE.Vector3(...p))), 12, 0.06, 6);
    bits.push({ geometry: paint(tube, 0x4a3324), keepColor: true });
    for (const [t, ang] of [[0.75, 0.7], [0.9, -0.6]]) {
      const q = [lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t), lerp(p1[2], p2[2], t)];
      const tw = new THREE.CylinderGeometry(0.02, 0.035, 0.6, 5);
      bits.push({ geometry: orient(paint(tw, 0x4a3324), { pos: [q[0] + side * 0.15, q[1] + 0.25, q[2]], roll: -side * ang }), keepColor: true });
    }
  };
  arm(-1, 0.1);
  arm(1, 1);
  // top hat with a red band and a sprig of holly
  const hatY = balls[2][1] + balls[2][0] * 0.8;
  bits.push({ geometry: paint(new THREE.CylinderGeometry(0.85, 0.85, 0.07, 28), 0x161616).translate(0, hatY, 0), keepColor: true });
  bits.push({ geometry: paint(new THREE.CylinderGeometry(0.52, 0.5, 1.0, 28), 0x161616).translate(0, hatY + 0.52, 0), keepColor: true });
  bits.push({ geometry: paint(new THREE.CylinderGeometry(0.515, 0.515, 0.18, 28), 0xb3121c).translate(0, hatY + 0.15, 0), keepColor: true });
  for (const a of [-0.4, 0.2]) bits.push({ geometry: orient(paint(new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.25, 0.5), 0x1d5a2c), { pos: [0.42, hatY + 0.2, 0.25], yaw: a, roll: 0.6 }), keepColor: true });
  for (let k = 0; k < 3; k++) bits.push({ geometry: paint(new THREE.SphereGeometry(0.055, 8, 6), 0xc8101a).translate(0.47 + k * 0.05, hatY + 0.25 + (k % 2) * 0.05, 0.3), keepColor: true });
  // scarf: a fat ring round the neck, striped by angle, and a tail hanging down the front
  const neckY = balls[1][1] + balls[1][0] * 0.82;
  const ring = new THREE.TorusGeometry(0.88, 0.2, 10, 40).rotateX(Math.PI / 2).scale(1, 1.4, 1);
  bits.push({ geometry: paintBy(ring.translate(0, neckY, 0), (p) => new THREE.Color(Math.floor((Math.atan2(p.z, p.x) + Math.PI) / 0.35) % 2 ? 0xc81d25 : 0x1f7a45)), keepColor: true });
  const tail = roundedBox(0.42, 1.6, 0.12, 0.05, 2, 6);
  bits.push({ geometry: orient(paintBy(tail, (p) => new THREE.Color(Math.floor((p.y + 2) / 0.3) % 2 ? 0xc81d25 : 0x1f7a45)), { pos: [0.45, neckY - 0.8, 0.95], roll: 0.15, pitch: -0.25 }), keepColor: true });
  for (let k = 0; k < 6; k++) bits.push({ geometry: paint(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 4), 0xc81d25).translate(0.33 + k * 0.05 + 0.11, neckY - 1.72, 1.1), keepColor: true });
  // mittens on the waving hand
  bits.push({ geometry: paint(lumpy(new THREE.SphereGeometry(0.2, 12, 10).scale(1, 1.3, 0.8), 0.02, 4, 2), 0xc81d25).translate(2.95, 5.75, 0.1), keepColor: true });
  void rng;
  g.add(mesh(mergeParts(bits), standard({ vertexColors: true, roughness: 0.6 })));
  return g;
}

// A Christmas sleigh: a red body with gold scrollwork runners, a velvet seat, and presents piled
// in the back. Faces +z, about 11ft long.
export function sleigh({ seed = 91 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const body = [];
  const gold = [];
  // body sides: an extruded profile, one per side
  const side = new THREE.Shape();
  side.moveTo(-4.5, 1.2);
  side.bezierCurveTo(-4.9, 2.2, -4.4, 3.6, -3.4, 3.8);
  side.lineTo(-1.2, 3.2);
  side.bezierCurveTo(-0.4, 2.7, 0.8, 2.6, 1.6, 2.9);
  side.bezierCurveTo(2.8, 3.3, 3.8, 3.6, 4.4, 4.4);
  side.bezierCurveTo(4.9, 5.0, 4.5, 5.5, 4.0, 5.1);
  side.bezierCurveTo(3.5, 4.4, 3.4, 2.6, 3.3, 1.2);
  side.closePath();
  for (const sx of [-1, 1]) {
    const geo = new THREE.ExtrudeGeometry(side, { depth: 0.22, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 16 });
    geo.translate(0, 0, -0.11);
    body.push({ geometry: orient(paint(geo, 0xd0161f), { pos: [sx * 1.6, 0, 0], yaw: -Math.PI / 2 }), keepColor: true });
  }
  body.push({ geometry: paint(roundedBox(3.2, 0.3, 7.6, 0.08, 2, 2), 0x8e0f16).translate(0, 1.3, -0.4), keepColor: true });
  body.push({ geometry: paint(roundedBox(3.2, 2.2, 0.3, 0.08, 2, 2), 0xb0121b).translate(0, 2.3, -4.2), keepColor: true });
  // seat
  body.push({ geometry: paint(lumpy(roundedBox(3.0, 0.5, 1.8, 0.2, 3, 2), 0.02, 3, 1), 0x3a1b4a).translate(0, 2.2, 0.6), keepColor: true });
  body.push({ geometry: orient(paint(lumpy(roundedBox(3.0, 1.6, 0.45, 0.2, 3, 2), 0.02, 3, 2), 0x3a1b4a), { pos: [0, 3.1, -0.3], pitch: -0.2 }), keepColor: true });
  // runners: gold tubes that curl up at the front
  for (const sx of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([[-5, 0.6, 0], [-4.3, 0.12, 0], [0, 0.1, 0], [4.2, 0.12, 0], [5.3, 0.9, 0], [5.6, 2.2, 0], [5.0, 2.8, 0], [4.6, 2.3, 0]].map(([z, y]) => new THREE.Vector3(sx * 1.7, y, z)));
    gold.push({ geometry: new THREE.TubeGeometry(curve, 80, 0.12, 8), color: 0xd8ad45 });
    for (const z of [-3, 0, 3]) gold.push({ geometry: new THREE.CylinderGeometry(0.07, 0.07, 1.2, 8).translate(sx * 1.7, 0.7, z), color: 0xd8ad45 });
  }
  // gold scroll on each side
  for (const sx of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; const a = t * TAU * 1.6; const r = 0.9 * (1 - t * 0.75); pts.push(new THREE.Vector3(sx * 1.73 + sx * 0.02, 2.4 + Math.sin(a) * r, 1.6 + Math.cos(a) * r)); }
    gold.push({ geometry: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.06, 6), color: 0xe2bb55 });
  }
  g.add(mesh(mergeParts(body), standard({ vertexColors: true, roughness: 0.32, metalness: 0.1 })));
  g.add(mesh(mergeParts(gold.map((p) => ({ ...p }))), standard({ vertexColors: true, roughness: 0.3, metalness: 0.55 })));
  // presents in the back
  const paper = []; const ribbon = [];
  for (let k = 0; k < 9; k++) {
    const w = 0.8 + rng() * 0.8; const d = 0.7 + rng() * 0.8; const h = 0.6 + rng() * 0.8;
    present(paper, ribbon, { w, h, d, x: (rng() - 0.5) * 1.6, y: 1.45 + (k > 5 ? 1.0 : 0), z: -3.3 + rng() * 2.4, yaw: rng() * TAU, tile: k % 5, ribbonColor: RIBBON[k % RIBBON.length], rng });
  }
  g.add(mesh(mergeParts([...paper, ...ribbon]), giftMaterial()));
  // a snow cap on the seat back
  g.add(mesh(paint(lumpy(roundedBox(3.1, 0.25, 0.55, 0.12, 2, 2), 0.03, 2, 4), 0xeef3fb).translate(0, 4.0, -0.45), standard({ vertexColors: true, roughness: 0.8 })));
  return g;
}

// A row of lanterns on short posts down both sides of a path, glowing but not lighting.
export function lanternRow({ count = 6, spacing = 9, width = 7 } = {}) {
  const g = group();
  const iron = [];
  const glassParts = [];
  const glowPos = [];
  const glowCol = [];
  const snow = [];
  for (let i = 0; i < count; i++) {
    for (const side of [-1, 1]) {
      const x = side * width / 2; const z = -(count - 1) * spacing / 2 + i * spacing;
      iron.push({ geometry: new THREE.CylinderGeometry(0.07, 0.09, 3.2, 8).translate(x, 1.6, z) });
      iron.push({ geometry: new THREE.ConeGeometry(0.42, 0.3, 4).rotateY(Math.PI / 4).translate(x, 4.15, z) });
      iron.push({ geometry: new THREE.BoxGeometry(0.5, 0.06, 0.5).translate(x, 3.25, z) });
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) iron.push({ geometry: new THREE.BoxGeometry(0.04, 0.7, 0.04).translate(x + sx * 0.22, 3.62, z + sz * 0.22) });
      glassParts.push({ geometry: new THREE.BoxGeometry(0.4, 0.62, 0.4).translate(x, 3.62, z), color: 0xffffff });
      glowPos.push(x, 3.62, z); glowCol.push(0.95, 0.6, 0.25);
      snow.push({ geometry: paint(lumpy(new THREE.SphereGeometry(0.33, 10, 6, 0, TAU, 0, Math.PI / 2).scale(1, 0.5, 1), 0.02, 3, i), 0xeef3fb).translate(x, 4.28, z), keepColor: true });
    }
  }
  g.add(mesh(mergeParts(iron.map((p) => ({ ...p, color: 0x1b1a19 }))), standard({ vertexColors: true, roughness: 0.5, metalness: 0.55 })));
  const glassMesh = new THREE.Mesh(mergeParts(glassParts), standard({ color: 0xffe0a8, emissive: 0xffa848, emissiveIntensity: 1.8, roughness: 0.3 }));
  glassMesh.userData.isGlowMesh = true;
  g.add(glassMesh);
  g.add(mesh(mergeParts(snow), standard({ vertexColors: true, roughness: 0.8 })));
  g.add(glowCloud(glowPos, glowCol, 3.4));
  return g;
}

// A shovelled path: packed snow between two banks. Runs along z, centred on the origin.
export function snowPath({ length = 50, width = 5, seed = 92 } = {}) {
  const rng = seededRandom(seed);
  const g = group();
  const bed = paramSurface(8, 60, (u, v) => {
    const x = (u - 0.5) * width; const z = (v - 0.5) * length;
    return [x, 0.07 + 0.03 * smoothNoise3(x * 2, 0, z * 2), z, x / 3, z / 3];
  }, { outward: () => [0, 1, 0] });
  const pathMesh = mesh(paintBy(bed, (p) => new THREE.Color(0xb8c3d3).multiplyScalar(0.92 + 0.12 * smoothNoise3(p.x * 1.5, 1, p.z * 1.5))), standard({ vertexColors: true, roughness: 0.9, ...relief('stone', { seed, repeat: 8, strength: 0.35 }) }));
  pathMesh.castShadow = false;
  g.add(pathMesh);
  const banks = [];
  for (const side of [-1, 1]) {
    // Shovelled snow is a long low ridge, not a row of pillows: many overlapping heaps, each
    // much longer than it is tall, with their tops at different heights.
    for (let z = -length / 2; z < length / 2; z += 1.1 + rng() * 0.8) {
      const s = 0.8 + rng() * 0.6;
      banks.push({ geometry: paint(lumpy(new THREE.SphereGeometry(1, 14, 8, 0, TAU, 0, Math.PI / 2).scale(s * 1.2, 0.32 + rng() * 0.22, s * 2.0), 0.06, 0.9, z), 0xeef3fb).translate(side * (width / 2 + 0.55 + rng() * 0.3), 0, z), keepColor: true });
    }
  }
  g.add(mesh(mergeParts(banks), standard({ vertexColors: true, roughness: 0.8, ...relief('stone', { seed: seed + 1, repeat: 4, strength: 0.25 }) })));
  return g;
}

// A soft heap of drifted snow.
export function snowMound({ width = 8, depth = 5, height = 1.6, seed = 93 } = {}) {
  const geo = lumpy(new THREE.SphereGeometry(1, 28, 12, 0, TAU, 0, Math.PI / 2).scale(width / 2, height, depth / 2), 0.12, 0.6, seed);
  return group(mesh(paint(geo, 0xeef3fb), standard({ vertexColors: true, roughness: 0.82, ...relief('stone', { seed, repeat: 5, strength: 0.3 }) })));
}

// Falling snow over the whole clearing: one Points cloud, each flake drifting down on its own
// sway and wrapping back to the top. Flakes are hidden while inside `hole` (the cabin), or it
// would snow in the living room. Authored in WORLD coordinates -- place the prop at the origin.
export function fallingSnow({ radius = 120, height = 55, count = 9000, seed = 94, hole = null } = {}) {
  const rng = seededRandom(seed);
  const h = hole ?? [-CABIN.halfW - CABIN.overhang - 1, CABIN.halfW + CABIN.overhang + 1, -CABIN.halfD - CABIN.overhang - 1, CABIN.halfD + CABIN.overhang + 1];
  const pos = new Float32Array(count * 3);
  const ys = new Float32Array(count);       // each flake's true height, even while hidden
  const home = new Float32Array(count * 4); // x, z, fall speed, phase
  for (let i = 0; i < count; i++) {
    const a = rng() * TAU; const r = Math.sqrt(rng()) * radius;
    home[i * 4] = Math.cos(a) * r; home[i * 4 + 1] = Math.sin(a) * r;
    home[i * 4 + 2] = 1.6 + rng() * 1.6; home[i * 4 + 3] = rng() * TAU;
    ys[i] = rng() * height;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height / 2, 0), radius + height);
  const tex = canvasTexture(32, 32, (ctx, w) => {
    const gr = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, w);
  });
  const mat = new THREE.PointsMaterial({ size: 0.16, map: tex, color: 0xf4f8ff, transparent: true, depthWrite: false, sizeAttenuation: true, opacity: 0.95 });
  const pts = new THREE.Points(geom, mat);
  pts.castShadow = false;
  pts.receiveShadow = false;
  const g = group(pts);
  let t = 0;
  const step = (dt) => {
    t += dt;
    for (let i = 0; i < count; i++) {
      let y = ys[i] - home[i * 4 + 2] * dt;
      if (y < 0) y += height;
      ys[i] = y;
      const ph = home[i * 4 + 3];
      const x = home[i * 4] + Math.sin(t * 0.7 + ph) * 0.8 + Math.sin(y * 0.15 + ph) * 1.2;
      const z = home[i * 4 + 1] + Math.cos(t * 0.5 + ph * 1.3) * 0.8;
      const inside = x > h[0] && x < h[1] && z > h[2] && z < h[3] && y < CABIN.ridge + 2;
      pos[i * 3] = x; pos[i * 3 + 1] = inside ? -100 : y; pos[i * 3 + 2] = z;
    }
    geom.attributes.position.needsUpdate = true;
  };
  step(0);
  chainTick(g, (dt) => { if (!reducedMotion()) step(Math.min(dt, 0.1)); });
  return g;
}
