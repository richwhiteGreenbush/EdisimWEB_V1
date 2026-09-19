// Native HiFi models for The Moon: the Apollo hardware. Keys are the main app's PROP_BUILDERS
// keys; every builder takes the same options, stands on the same origin and faces the same way
// as the MoonProps.js builder it replaces. See native.js.
//
// What carries "Apollo" is mostly SURFACE, and three surfaces in particular:
//
//   * KAPTON FOIL. The descent stage, the rover's electronics and the ALSEP are wrapped in
//     hand-taped blankets of gold, amber and black film, and what the eye reads is the
//     CRINKLE: hundreds of small flat facets each throwing the sun a different way. A smooth
//     gold box is a gift-wrapped parcel. `foil()` paints a Voronoi field of randomly tilted
//     facets straight into a NORMAL map, so a plain box under it glitters the way the real
//     blankets do in every surface photograph.
//   * PANELLED ALUMINIUM. The ascent stage is thin chem-milled skin over ribs, visibly
//     quilted, with seams and fasteners. `panels()` draws those seams into albedo and normal.
//   * WIRE MESH. The rover's tyres are woven piano wire you can see through, with titanium
//     chevrons riveted on as tread. An alpha-tested weave on a lathed tyre is that, for the
//     cost of a texture.
//
// The Moon theme runs a very low environment intensity (there is no sky to reflect), so a
// highly metallic surface has almost nothing to mirror and goes dark. Metals here are held
// around 0.55-0.75 with a bright base colour: the diffuse half is what is actually seen, and
// the sun's specular off the crinkle does the rest.

import { PBRMaterial, StandardMaterial, DynamicTexture, Texture, Color3, Vector3, Quaternion, Mesh, MeshBuilder, VertexData, Constants } from '@babylonjs/core';
import { linear } from './Kit.js';
import { earthTexture } from '../../../src/props/Earth.js';
import { seededRandom as appRandom, randomIn } from '../../../src/PropKit.js';

const UP = new Vector3(0, 1, 0);

// ---- shared surface helpers ---------------------------------------------------------------
const cache = new WeakMap(); // scene -> Map(key -> material/texture)
function memo(kit, key, make) {
  let m = cache.get(kit.scene);
  if (!m) { m = new Map(); cache.set(kit.scene, m); }
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

function lcg(seed) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function dataTexture(kit, name, canvas, srgb) {
  const t = new DynamicTexture(name, canvas, kit.scene, true);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 16;
  t.gammaSpace = srgb;
  t.update(true);
  return t;
}

// A tileable normal map of crinkled film: jittered Voronoi sites, each cell a flat facet with
// its own random tilt, a crease where two cells meet. Indices wrap, so the tile has no seam.
function crinkleNormal(kit) {
  return memo(kit, 'tex:crinkle', () => {
    const size = 512; const cells = 11; const cs = size / cells;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d'); const img = ctx.createImageData(size, size);
    const rand = lcg(4242);
    const sites = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) sites.push({ x: (i + 0.15 + rand() * 0.7) * cs, y: (j + 0.15 + rand() * 0.7) * cs, nx: (rand() - 0.5) * 0.62, ny: (rand() - 0.5) * 0.62 });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const ci = Math.floor(x / cs); const cj = Math.floor(y / cs);
        let d1 = 1e9; let d2 = 1e9; let best = null;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = (ci + di + cells) % cells; const jj = (cj + dj + cells) % cells;
          const s = sites[jj * cells + ii];
          let dx = s.x - x; let dy = s.y - y;
          if (dx > size / 2) dx -= size; else if (dx < -size / 2) dx += size;
          if (dy > size / 2) dy -= size; else if (dy < -size / 2) dy += size;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = s; } else if (d < d2) d2 = d;
        }
        // the facet's own tilt, flattened a little right on the crease
        const edge = Math.min(1, (Math.sqrt(d2) - Math.sqrt(d1)) / 7);
        const nx = best.nx * (0.35 + 0.65 * edge); const ny = best.ny * (0.35 + 0.65 * edge);
        const l = Math.hypot(nx, ny, 1);
        const o = (y * size + x) * 4;
        img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return dataTexture(kit, 'crinkle-normal', c, false);
  });
}

// Multi-layer insulation film. `tile` is feet per repeat of the crinkle field.
function foil(kit, color, { tile = 3.4, metal = 0.55, rough = 0.38, bump = 1.0 } = {}) {
  return memo(kit, `foil:${color}:${tile}:${metal}:${rough}`, () => {
    const m = new PBRMaterial(`foil-${color.toString(16)}`, kit.scene);
    m.albedoColor = linear(color);
    m.metallic = metal; m.roughness = rough;
    m.bumpTexture = crinkleNormal(kit);
    m.bumpTexture.level = bump;
    m.environmentIntensity = 2.5; // the theme's is ~0.14; lift the little there is
    m.metadata = { tile };
    return m;
  });
}

// Chem-milled aluminium skin: a grid of panels with seams and fasteners, in albedo and normal.
function panels(kit, color, { tile = 6.5, rough = 0.5, metal = 0.3 } = {}) {
  return memo(kit, `panels:${color}:${tile}`, () => {
    const size = 512; const n = 4; const ps = size / n;
    const a = document.createElement('canvas'); a.width = a.height = size; const actx = a.getContext('2d');
    const h = document.createElement('canvas'); h.width = h.height = size; const hctx = h.getContext('2d');
    const rand = lcg(color);
    actx.fillStyle = '#fff'; actx.fillRect(0, 0, size, size);
    hctx.fillStyle = '#808080'; hctx.fillRect(0, 0, size, size);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = 236 + Math.floor(rand() * 19);
      actx.fillStyle = `rgb(${v},${v},${v})`; actx.fillRect(i * ps + 2, j * ps + 2, ps - 4, ps - 4);
      // a very slight pillow to each panel: thin skin between ribs
      const g = hctx.createRadialGradient((i + 0.5) * ps, (j + 0.5) * ps, ps * 0.1, (i + 0.5) * ps, (j + 0.5) * ps, ps * 0.75);
      g.addColorStop(0, '#8e8e8e'); g.addColorStop(1, '#787878');
      hctx.fillStyle = g; hctx.fillRect(i * ps, j * ps, ps, ps);
    }
    actx.strokeStyle = 'rgba(60,60,66,0.42)'; actx.lineWidth = 2; hctx.strokeStyle = '#4a4a4a'; hctx.lineWidth = 4;
    for (let k = 0; k <= n; k++) for (const ctx of [actx, hctx]) { ctx.beginPath(); ctx.moveTo(k * ps, 0); ctx.lineTo(k * ps, size); ctx.moveTo(0, k * ps); ctx.lineTo(size, k * ps); ctx.stroke(); }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) for (let k = 0; k < 6; k++) for (const [fx, fy] of [[k / 5, 0.06], [k / 5, 0.94], [0.06, k / 5], [0.94, k / 5]]) {
      const x = (i + 0.08 + fx * 0.84) * ps; const y = (j + 0.08 + fy * 0.84) * ps;
      actx.fillStyle = 'rgba(60,60,64,0.35)'; actx.beginPath(); actx.arc(x, y, 1.6, 0, 6.283); actx.fill();
      hctx.fillStyle = '#c0c0c0'; hctx.beginPath(); hctx.arc(x, y, 3, 0, 6.283); hctx.fill();
    }
    heightToNormal(hctx, size, 2.2);
    const m = new PBRMaterial(`panels-${color.toString(16)}`, kit.scene);
    m.albedoColor = linear(color);
    m.albedoTexture = dataTexture(kit, 'panels-albedo', a, true);
    m.bumpTexture = dataTexture(kit, 'panels-normal', h, false);
    m.metallic = metal; m.roughness = rough; m.environmentIntensity = 2.5;
    m.metadata = { tile };
    return m;
  });
}

function heightToNormal(ctx, size, strength) {
  const src = ctx.getImageData(0, 0, size, size); const d = src.data;
  const H = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) H[i] = d[i * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = (x + size - 1) % size; const x1 = (x + 1) % size; const y0 = (y + size - 1) % size; const y1 = (y + 1) % size;
    const dx = (H[y * size + x1] - H[y * size + x0]) * strength * 4; const dy = (H[y1 * size + x] - H[y0 * size + x]) * strength * 4;
    const l = Math.hypot(dx, dy, 1); const o = (y * size + x) * 4;
    d[o] = (-dx / l * 0.5 + 0.5) * 255; d[o + 1] = (dy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  ctx.putImageData(src, 0, 0);
}

// Woven wire, see-through: the LRV's tyres and its umbrella antenna.
function wireMesh(kit, color, name) {
  return memo(kit, `mesh:${name}`, () => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = color; ctx.lineWidth = 5;
    for (let k = -128; k <= 256; k += 32) { ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + 128, 128); ctx.moveTo(k + 128, 0); ctx.lineTo(k, 128); ctx.stroke(); }
    const m = kit.canvasMat(`wire-${name}`, c, { emissive: 0, rough: 0.4, alpha: true });
    m.albedoTexture.wrapU = m.albedoTexture.wrapV = Texture.WRAP_ADDRESSMODE;
    m.metallic = 0.5; m.backFaceCulling = false; m.twoSidedLighting = true; m.alphaCutOff = 0.4;
    return m;
  });
}

// kit.flat() caches by its arguments, and these exact tuples are used nowhere else, so lifting
// the environment term on them touches only lunar hardware.
function lifted(m) { m.environmentIntensity = 3; return m; }
const white = (kit) => kit.flat(0xe9e7df, { rough: 0.55, metal: 0.05 });
const darkMetal = (kit) => lifted(kit.flat(0x34363b, { rough: 0.5, metal: 0.32 }));
const aluminium = (kit) => lifted(kit.flat(0xc9ccd0, { rough: 0.4, metal: 0.42 }));

// A straight round member between two points.
function strut(kit, b, mat, a, c, r, sides = 10) { b.add(kit.tube([a, c], r, { sides }), mat); }

function quatFromY(dir) {
  const d = dir.clone().normalize();
  const axis = Vector3.Cross(UP, d);
  const len = axis.length();
  if (len < 1e-6) return d.y > 0 ? Quaternion.Identity() : Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI);
  return Quaternion.RotationAxis(axis.scale(1 / len), Math.acos(Math.max(-1, Math.min(1, d.y))));
}

function ngonOutline(n, r, phase = Math.PI / n) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = phase + (i / n) * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}

function paint(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }

function flagCanvas() {
  return paint(1140, 600, (ctx, w, h) => {
    const sh = h / 13;
    for (let i = 0; i < 13; i++) { ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff'; ctx.fillRect(0, i * sh, w, sh + 1); }
    ctx.fillStyle = '#3c3b6e'; ctx.fillRect(0, 0, w * 0.4, sh * 7);
    ctx.fillStyle = '#ffffff';
    const star = (x, y, r) => { ctx.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI * 2; const rr = k % 2 ? r * 0.4 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); };
    for (let row = 0; row < 9; row++) {
      const count = row % 2 === 0 ? 6 : 5;
      for (let col = 0; col < count; col++) star((w * 0.4 * (col + (row % 2 === 0 ? 0.5 : 1))) / 6, (sh * 7 * (row + 0.5)) / 9, 13);
    }
    // nylon: a faint weave and the fold creases it still carried from its stowage tube
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1, h);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (const fx of [0.25, 0.5, 0.75]) ctx.fillRect(w * fx - 2, 0, 4, h);
    for (const fy of [0.33, 0.66]) ctx.fillRect(0, h * fy - 2, w, 4);
  });
}

// ---- LUNAR MODULE -----------------------------------------------------------------------------
// Front is +Z: the square forward hatch, the porch and the ladder are all on that side, exactly
// where the main app puts them. The four legs stand on the AXES rather than on the diagonals the
// main-app model uses, because the ladder is ON a leg -- the forward landing gear's primary
// strut -- and a ladder standing free in front of a diagonal-legged lander is the one thing about
// the original that is not an LM. The pads are at the same radius (legSpan / 2), so the footprint
// circle is unchanged; it is turned 45 degrees.
function lunarModule(kit, { height = 20, legSpan = 26 } = {}) {
  const b = kit.builder('lunar-module');
  const gold = foil(kit, 0xd7a13a);
  const amber = foil(kit, 0xb5651f, { rough: 0.4 });
  const black = foil(kit, 0x17181b, { metal: 0.35, rough: 0.5, bump: 1.2 });
  const silver = foil(kit, 0xd9dadc, { metal: 0.7, rough: 0.3 });
  const skin = panels(kit, 0xb9bbb8);
  const skinDark = panels(kit, 0x6d7073, { tile: 4 });
  const dark = darkMetal(kit); const alu = aluminium(kit); const wh = white(kit);
  const glass = kit.flat(0x0b1620, { rough: 0.06, metal: 0.55 });

  const dY = 4.0; const dH = 5.6; const dR = 6.6; const top = dY + dH; // descent stage, canonical 20ft
  const pad = 13; // canonical legSpan / 2

  // DESCENT STAGE: an octagon with its flats to the four legs, wrapped in film.
  b.add(kit.prism(ngonOutline(8, dR / Math.cos(Math.PI / 8)), dH), gold, { pos: [0, dY + dH / 2, 0], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.prism(ngonOutline(8, (dR + 0.15) / Math.cos(Math.PI / 8)), 0.28), black, { pos: [0, top + 0.05, 0], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.prism(ngonOutline(8, (dR - 0.5) / Math.cos(Math.PI / 8)), 0.3), black, { pos: [0, dY - 0.1, 0], rot: [Math.PI / 2, 0, 0] });
  // the blanket is PATCHWORK: black and amber panels taped over the gold on alternate faces
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2; const yaw = Math.PI / 2 - a;
    const at = (r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    const diagonal = i % 2 === 1;
    if (diagonal) {
      b.add(kit.box(4.3, dH - 0.5, 0.1, { bevel: 0.03 }), black, { pos: at(dR + 0.04, dY + dH / 2, 0), rot: [0, yaw, 0] });
      b.add(kit.box(1.5, 1.7, 0.1, { bevel: 0.03 }), silver, { pos: at(dR + 0.1, dY + dH * 0.62, 0), rot: [0, yaw, 0.04] });
    } else {
      b.add(kit.box(2.3, 2.1, 0.09, { bevel: 0.03 }), amber, { pos: at(dR + 0.05, dY + dH * 0.3, 0), rot: [0, yaw, -0.03] });
      b.add(kit.box(4.6, 0.5, 0.08, { bevel: 0.02 }), amber, { pos: at(dR + 0.05, top - 0.55, 0), rot: [0, yaw, 0.015] });
    }
  }
  // descent engine: a bell, open at the bottom, tucked up inside the stage
  b.add(kit.lathe([[2.15, 1.25], [2.05, 1.6], [1.75, 2.35], [1.35, 3.1], [1.0, 3.75], [0.85, 4.3]], { sides: 48, tile: 3 }), dark);
  b.add(kit.torus(2.15, 0.12, { sides: 48 }), alu, { pos: [0, 1.27, 0] });
  b.add(kit.cyl(1.2, 1.6, 0.5, { sides: 32 }), black, { pos: [0, dY - 0.3, 0] });

  // LANDING GEAR, one leg down each axis; leg 0 (+Z) carries the ladder
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 2 - (i * Math.PI) / 2; // +Z, +X, -Z, -X
    const dx = Math.cos(a); const dz = Math.sin(a); const tx = -dz; const tz = dx;
    const P = (r, y, t = 0) => new Vector3(dx * r + tx * t, y, dz * r + tz * t);
    const head = P(8.3, top - 0.35); const foot = P(pad, 0.5); const knee = Vector3.Lerp(head, foot, 0.56);
    // outrigger truss carrying the strut head off the stage
    for (const t of [-1.9, 1.9]) { strut(kit, b, alu, P(dR - 0.1, top - 0.2, t), head, 0.13); strut(kit, b, alu, P(dR - 0.1, dY + 0.5, t), head, 0.12); }
    strut(kit, b, alu, P(dR - 0.1, top - 0.2, -1.9), P(dR - 0.1, top - 0.2, 1.9), 0.1);
    // primary strut: outer cylinder, then the thinner crushable piston, all film-wrapped
    strut(kit, b, gold, head, knee, 0.3, 14); strut(kit, b, alu, knee, foot, 0.2, 12);
    b.add(kit.sphere(0.34, { segments: 12 }), alu, { pos: [knee.x, knee.y, knee.z] });
    // secondary struts: an A-frame from the stage's lower corners up to the knee
    for (const t of [-2.6, 2.6]) { const low = P(dR - 0.3, dY + 0.45, t); strut(kit, b, gold, low, knee, 0.15); b.add(kit.sphere(0.2, { segments: 10 }), alu, { pos: [low.x, low.y, low.z] }); }
    // dished footpad on a ball joint
    b.add(kit.lathe([[0, 0.06], [1.15, 0.06], [1.5, 0.3], [1.55, 0.4], [1.42, 0.42], [1.1, 0.2], [0, 0.2]], { sides: 40, tile: 2 }), gold, { pos: [foot.x, 0, foot.z] });
    b.add(kit.sphere(0.3, { segments: 12 }), alu, { pos: [foot.x, 0.45, foot.z] });
    if (i !== 0) {
      // surface-sensing probe: it hung 5ft below the pad and folded flat on contact
      const p0 = P(pad + 0.9, 0.3); const p1 = P(pad + 3.6, 0.09, 1.4); const p2 = P(pad + 5.2, 0.07, 2.6);
      b.add(kit.tube(kit.curve([p0, p1, p2], 8), 0.035, { sides: 6 }), alu);
    } else {
      // THE LADDER, on the forward primary strut, stopping a long step short of the pad
      const rise = head.subtract(foot).normalize();
      const out = Vector3.Cross(new Vector3(tx, 0, tz), rise).normalize().scale(-0.42);
      const r0 = Vector3.Lerp(foot, head, 0.2).add(out); const r1 = Vector3.Lerp(foot, head, 1.02).add(out);
      for (const t of [-0.62, 0.62]) strut(kit, b, alu, r0.add(new Vector3(tx * t, 0, tz * t)), r1.add(new Vector3(tx * t, 0, tz * t)), 0.07, 8);
      for (let k = 0; k < 9; k++) { const p = Vector3.Lerp(r0, r1, (k + 0.3) / 9); strut(kit, b, alu, p.add(new Vector3(tx * -0.62, 0, tz * -0.62)), p.add(new Vector3(tx * 0.62, 0, tz * 0.62)), 0.055, 8); }
    }
  }

  // THE PORCH (egress platform) and its handrails, out over the forward leg
  b.add(kit.box(3.3, 0.18, 2.9, { bevel: 0.04 }), alu, { pos: [0, top + 0.05, dR + 1.2] });
  for (const sx of [-1, 1]) {
    b.add(kit.tube(kit.curve([[sx * 1.55, top + 0.1, dR - 0.2], [sx * 1.55, top + 1.9, dR + 0.3], [sx * 1.55, top + 2.0, dR + 1.9], [sx * 1.35, top + 0.5, dR + 2.7], [sx * 0.95, top - 1.4, dR + 3.4]], 14), 0.06, { sides: 8 }), alu);
  }

  // ASCENT STAGE. Not a cylinder: a drum-shaped crew cabin facing forward, a slab-sided
  // midsection behind it, an equipment bay behind that, and a propellant tank bulging each side.
  const aY = top + 0.2;
  b.add(kit.prism([[-4.3, 0], [4.3, 0], [4.7, 1.3], [4.7, 3.9], [3.3, 5.7], [-3.3, 5.7], [-4.7, 3.9], [-4.7, 1.3]], 4.6), skin, { pos: [0, aY, -0.7] });
  b.add(kit.cyl(3.45, 3.45, 3.4, { sides: 28, tile: 6.5 }), skin, { pos: [0, aY + 3.15, 2.9], rot: [Math.PI / 2, 0, 0] });
  // the cabin's front: two canted faces meeting at the centreline, windows in them
  b.add(kit.prism([[-3.2, 0], [3.2, 0], [3.4, 2.6], [2.1, 5.6], [-2.1, 5.6], [-3.4, 2.6]], 0.5), skin, { pos: [0, aY + 0.3, 4.75] });
  for (const sx of [-1, 1]) {
    // the famous inward-canted triangular windows
    b.add(kit.prism([[-1.05, 0.75], [1.05, 0.75], [0.75, -0.85], [-0.2, -0.85]].map(([x, y]) => [x * sx, y]), 0.12), glass, { pos: [sx * 1.6, aY + 4.2, 5.02], rot: [0.32, sx * 0.34, 0], scale: 0.86 });
    b.add(kit.prism([[-1.25, 0.95], [1.25, 0.95], [0.9, -1.05], [-0.35, -1.05]].map(([x, y]) => [x * sx, y]), 0.08), dark, { pos: [sx * 1.6, aY + 4.2, 4.97], rot: [0.32, sx * 0.34, 0], scale: 0.86 });
  }
  // forward hatch, square, low on the front face, with its frame and handle
  b.add(kit.box(2.7, 2.7, 0.14, { bevel: 0.05 }), dark, { pos: [0, aY + 1.75, 5.0] });
  b.add(kit.box(2.35, 2.35, 0.16, { bevel: 0.06 }), skinDark, { pos: [0, aY + 1.75, 5.05] });
  b.add(kit.tube(kit.curve([[-0.5, aY + 1.5, 5.14], [-0.5, aY + 1.5, 5.34], [0.5, aY + 1.5, 5.34], [0.5, aY + 1.5, 5.14]], 8), 0.045, { sides: 6 }), alu);
  // aft equipment bay, blanketed
  b.add(kit.box(5.8, 4.2, 2.3, { bevel: 0.12 }), black, { pos: [0, aY + 2.9, -4.1] });
  b.add(kit.box(5.2, 1.5, 0.1), silver, { pos: [0, aY + 3.9, -5.28] });
  b.add(kit.box(2.2, 1.6, 0.1), amber, { pos: [-1.3, aY + 1.9, -5.28], rot: [0, 0, 0.03] });
  // propellant tanks: the left one sits further out than the right, and it shows
  b.add(kit.sphere(2.15, { segments: 28, sy: 1.05 }), skin, { pos: [-5.35, aY + 2.7, -0.7] });
  b.add(kit.sphere(1.85, { segments: 28, sy: 1.05 }), skin, { pos: [4.95, aY + 2.7, -0.7] });
  b.add(kit.box(1.3, 3.2, 3.6, { bevel: 0.1 }), skinDark, { pos: [-4.4, aY + 2.6, -0.7] });
  // ascent engine cover under the cabin floor
  b.add(kit.cyl(1.7, 2.0, 0.5, { sides: 28 }), black, { pos: [0, aY - 0.05, -0.7] });
  // docking tunnel, ring and drogue on the roof
  b.add(kit.cyl(1.6, 1.75, 1.3, { sides: 32, tile: 3 }), skin, { pos: [0, aY + 6.3, -0.7] });
  b.add(kit.torus(1.62, 0.22, { sides: 40 }), alu, { pos: [0, aY + 7.0, -0.7] });
  b.add(kit.lathe([[1.45, 7.0], [0.4, 6.45], [0, 6.4]], { sides: 32 }), dark, { pos: [0, aY, -0.7] });
  // docking target and the overhead rendezvous window
  b.add(kit.box(0.9, 0.06, 0.9), glass, { pos: [-1.5, aY + 5.74, 2.4] });
  // rendezvous radar, on the cabin's brow, looking forward
  b.add(kit.cyl(0.22, 0.26, 1.0, { sides: 12 }), alu, { pos: [0, aY + 6.2, 3.4] });
  b.add(kit.lathe([[0, 0], [0.5, 0.06], [0.9, 0.24], [1.15, 0.5], [1.18, 0.56], [0.9, 0.34], [0.5, 0.16], [0, 0.1]], { sides: 32, tile: 2 }), wh, { pos: [0, aY + 6.85, 3.65], rot: [Math.PI / 2 - 0.25, 0, 0] });
  b.add(kit.box(0.5, 0.5, 0.6, { bevel: 0.05 }), gold, { pos: [0, aY + 6.8, 3.3] });
  // S-band steerable dish, high on the right shoulder
  strut(kit, b, alu, new Vector3(3.2, aY + 5.6, 0.6), new Vector3(4.3, aY + 8.2, 0.9), 0.09);
  b.add(kit.lathe([[0, 0], [0.5, 0.05], [0.95, 0.2], [1.3, 0.46], [1.33, 0.52], [0.95, 0.3], [0.5, 0.14], [0, 0.09]], { sides: 32, tile: 2 }), wh, { pos: [4.3, aY + 8.25, 0.9], quat: quatFromY(new Vector3(0.55, 0.62, 0.56)) });
  strut(kit, b, alu, new Vector3(4.3, aY + 8.3, 0.9), new Vector3(4.78, aY + 8.85, 1.4), 0.04, 6);
  // VHF and EVA antennas
  for (const [x, z, lx, lz] of [[-2.6, -2.4, -0.5, -0.6], [2.4, -2.6, 0.4, -0.7]]) strut(kit, b, alu, new Vector3(x, aY + 5.7, z), new Vector3(x + lx, aY + 8.6, z + lz), 0.035, 6);
  // RCS quads: four thruster clusters on outriggers at the corners
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2; const cx = Math.cos(a); const cz = Math.sin(a);
    const c = new Vector3(cx * 6.35, aY + 3.9, cz * 6.35 - 0.5);
    strut(kit, b, alu, new Vector3(cx * 4.4, aY + 4.4, cz * 4.0 - 0.6), c, 0.11);
    strut(kit, b, alu, new Vector3(cx * 4.4, aY + 2.6, cz * 4.0 - 0.6), c, 0.09);
    b.add(kit.box(0.75, 0.75, 0.75, { bevel: 0.08 }), gold, { pos: [c.x, c.y, c.z], rot: [0, -a, 0] });
    const nozzle = (dir) => b.add(kit.lathe([[0.3, 0], [0.24, 0.2], [0.13, 0.5], [0.11, 0.62]], { sides: 16 }), dark, { pos: [c.x + dir.x * 0.98, c.y + dir.y * 0.98, c.z + dir.z * 0.98], quat: quatFromY(dir.scale(-1)) });
    nozzle(UP); nozzle(UP.scale(-1)); nozzle(new Vector3(-cz, 0, cx)); nozzle(new Vector3(cx, 0, cz));
    // plume deflector: a scoop below each quad, keeping the down-firing jet off the descent stage
    b.add(kit.box(1.5, 0.06, 1.2), alu, { pos: [cx * 6.2, top + 0.75, cz * 6.2 - 0.4], rot: [0, -a, 0.5] });
  }

  // markings, on the forward descent face either side of the ladder
  const usa = paint(512, 128, (ctx, w, h) => { ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#16181c'; ctx.font = '700 76px Helvetica, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('UNITED STATES', w / 2, h / 2 + 4, w - 20); });
  b.add(kit.plane(2.1, 0.52), kit.canvasMat('lm-usa', usa, { emissive: 0.02, alpha: true }), { pos: [1.55, dY + dH * 0.62, dR + 0.12] });
  b.add(kit.plane(1.3, 0.68), kit.canvasMat('lm-flag', flagCanvas(), { emissive: 0.03 }), { pos: [-1.7, dY + dH * 0.62, dR + 0.12] });

  const root = b.finish();
  root.scaling.set(legSpan / 26, height / 20, legSpan / 26);
  root.metadata.instanceable = false;
  return root;
}

// ---- LUNAR ROVING VEHICLE ------------------------------------------------------------------------
// Nose is +X, as in the main app: the control console, the antennas and the camera are forward,
// the tool pallet is aft, and the two seats face +X.
function roverWheel(kit, b, mats, x, z, R, W) {
  const side = Math.sign(z);
  const at = (p) => ({ pos: [x, R, z], rot: [Math.PI / 2, 0, 0], ...p });
  // the tyre: woven wire you can see straight through
  b.add(kit.lathe([[R * 0.62, -W / 2], [R * 0.88, -W / 2], [R * 0.985, -W * 0.27], [R, 0], [R * 0.985, W * 0.27], [R * 0.88, W / 2], [R * 0.62, W / 2]], { sides: 56, tile: 0.34 }), mats.wire, at());
  // bump stop: the inner hoop the tyre bottoms out on
  b.add(kit.lathe([[R * 0.6, -W * 0.36], [R * 0.72, -W * 0.36], [R * 0.72, W * 0.36], [R * 0.6, W * 0.36]], { sides: 40 }), mats.alu, at());
  // titanium chevrons riveted round the tread, covering half of it
  const n = 30;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const q = Quaternion.RotationAxis(new Vector3(0, 0, 1), a - Math.PI / 2).multiply(Quaternion.RotationAxis(UP, s * 0.5));
      b.add(kit.box(0.2, 0.04, W * 0.5, { bevel: 0.01 }), mats.dark, { pos: [x + Math.cos(a) * (R + 0.015), R + Math.sin(a) * (R + 0.015), z + s * W * 0.22], quat: q });
    }
  }
  // hub: spun aluminium disc, drive unit, and the spokes out to the rim
  b.add(kit.lathe([[0, 0], [R * 0.6, 0], [R * 0.6, 0.05], [R * 0.2, 0.2], [0, 0.24]], { sides: 32 }), mats.alu, { pos: [x, R, z + side * W * 0.18], rot: [side * Math.PI / 2, 0, 0] });
  b.add(kit.cyl(0.26, 0.3, 0.6, { sides: 16 }), mats.dark, { pos: [x, R, z - side * 0.2], rot: [Math.PI / 2, 0, 0] });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; strut(kit, b, mats.alu, new Vector3(x, R, z), new Vector3(x + Math.cos(a) * R * 0.66, R + Math.sin(a) * R * 0.66, z), 0.03, 6); }
}

function lunarRover(kit, { length = 10.2, width = 6 } = {}) {
  const b = kit.builder('lunar-rover');
  const alu = aluminium(kit); const dark = darkMetal(kit); const wh = white(kit);
  const gold = foil(kit, 0xd7a13a, { tile: 1.6 }); const silver = foil(kit, 0xdcdde0, { tile: 1.6, metal: 0.7, rough: 0.28 });
  const fender = kit.flat(0xc96f26, { rough: 0.65 });
  const webbing = kit.flat(0xd9d2bd, { rough: 0.9 });
  const mats = { alu, dark, wire: wireMesh(kit, '#c9ccd0', 'tyre') };
  const L = length; const W = width;
  const R = 32 / 12 / 2; const deckY = R + 0.55; const wheelW = 0.75;

  // chassis: welded aluminium tube, three hinged sections, a thin floor over it
  for (const z of [-W * 0.3, W * 0.3]) strut(kit, b, alu, new Vector3(-L * 0.45, deckY - 0.16, z), new Vector3(L * 0.45, deckY - 0.16, z), 0.085, 12);
  for (const z of [-W * 0.12, W * 0.12]) strut(kit, b, alu, new Vector3(-L * 0.45, deckY - 0.22, z), new Vector3(L * 0.45, deckY - 0.22, z), 0.06, 10);
  for (let k = 0; k <= 6; k++) { const x = -L * 0.45 + (k / 6) * L * 0.9; strut(kit, b, alu, new Vector3(x, deckY - 0.16, -W * 0.3), new Vector3(x, deckY - 0.16, W * 0.3), 0.07, 10); }
  b.add(kit.box(L * 0.86, 0.05, W * 0.6, { bevel: 0.01 }), alu, { pos: [0, deckY - 0.05, 0] });
  for (const x of [-L * 0.17, L * 0.2]) b.add(kit.box(0.08, 0.09, W * 0.62), dark, { pos: [x, deckY - 0.04, 0] });

  // wheels, suspension wishbones and fenders
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * L * 0.38; const z = sz * (W / 2 - wheelW / 2 - 0.1);
    roverWheel(kit, b, mats, x, z, R, wheelW);
    for (const dx of [-0.55, 0.55]) { strut(kit, b, alu, new Vector3(x + dx, deckY - 0.2, sz * W * 0.3), new Vector3(x, R + 0.18, z - sz * 0.42), 0.045, 8); strut(kit, b, alu, new Vector3(x + dx, deckY - 0.55, sz * W * 0.26), new Vector3(x, R - 0.22, z - sz * 0.42), 0.045, 8); }
    strut(kit, b, dark, new Vector3(x, deckY - 0.1, sz * W * 0.3), new Vector3(x, R + 0.3, z - sz * 0.42), 0.07, 8); // damper
    // fender: a rolled arc over the top of the wheel, with the orange extension the crews kept knocking off
    const FR = R + 0.3; const steps = 11;
    for (let k = 0; k < steps; k++) {
      const a = Math.PI * (0.2 + (k / (steps - 1)) * 0.6);
      b.add(kit.box((Math.PI * 0.6 * FR) / (steps - 1) + 0.03, 0.03, wheelW + 0.2, { bevel: 0.008 }), fender, { pos: [x + Math.cos(a) * FR, R + Math.sin(a) * FR, z], rot: [0, 0, a - Math.PI / 2] });
    }
  }

  // seats: tube frames strung with nylon webbing, a folding footrest and an inboard armrest
  for (const sz of [-1, 1]) {
    const z = sz * W * 0.19;
    const hoop = (pts) => b.add(kit.tube(kit.curve(pts, 16), 0.045, { sides: 8 }), alu);
    hoop([[-1.1, deckY + 0.4, z - 0.8], [0.7, deckY + 0.42, z - 0.8], [0.78, deckY + 0.42, z], [0.7, deckY + 0.42, z + 0.8], [-1.1, deckY + 0.4, z + 0.8]]);
    hoop([[-1.0, deckY + 0.4, z - 0.8], [-1.33, deckY + 2.25, z - 0.78], [-1.36, deckY + 2.32, z], [-1.33, deckY + 2.25, z + 0.78], [-1.0, deckY + 0.4, z + 0.8]]);
    for (let k = 0; k < 5; k++) b.add(kit.box(1.7, 0.025, 0.2), webbing, { pos: [-0.2, deckY + 0.42, z - 0.6 + k * 0.3] });
    for (let k = 0; k < 5; k++) b.add(kit.box(0.2, 0.025, 1.55), webbing, { pos: [-0.95 + k * 0.38, deckY + 0.44, z] });
    for (let k = 0; k < 5; k++) b.add(kit.box(0.025, 0.22, 1.5), webbing, { pos: [-1.08 - k * 0.06, deckY + 0.75 + k * 0.34, z], rot: [0, 0, 0.17] });
    for (const t of [-0.45, 0, 0.45]) b.add(kit.box(0.025, 1.75, 0.18), webbing, { pos: [-1.21, deckY + 1.42, z + t], rot: [0, 0, 0.17] });
    for (const t of [-0.8, 0.8]) strut(kit, b, alu, new Vector3(-0.2, deckY - 0.05, z + t), new Vector3(-0.2, deckY + 0.4, z + t), 0.04, 8);
    b.add(kit.box(0.7, 0.04, 1.3, { bevel: 0.01 }), alu, { pos: [1.5, deckY + 0.12, z], rot: [0, 0, 0.35] }); // footrest
  }
  b.add(kit.box(1.4, 0.12, 0.3, { bevel: 0.04 }), dark, { pos: [-0.3, deckY + 1.05, 0] });
  strut(kit, b, alu, new Vector3(-0.3, deckY, 0), new Vector3(-0.3, deckY + 1.0, 0), 0.05, 8);

  // control and display console on its post, and the T-handle between the seats
  const faceCanvas = paint(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#2a2c30'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#9a9ca0'; ctx.lineWidth = 3; ctx.strokeRect(8, 8, w - 16, h - 16);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = '#0d0e10'; ctx.beginPath(); ctx.arc(80 + i * 118, 100, 44, 0, 6.283); ctx.fill(); ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = 3; ctx.stroke(); ctx.beginPath(); ctx.moveTo(80 + i * 118, 100); ctx.lineTo(80 + i * 118 + Math.cos(i * 1.3 - 2) * 34, 100 + Math.sin(i * 1.3 - 2) * 34); ctx.stroke(); }
    for (let j = 0; j < 2; j++) for (let i = 0; i < 9; i++) { ctx.fillStyle = (i + j) % 4 === 0 ? '#c9a23a' : '#bfc2c6'; ctx.fillRect(40 + i * 50, 200 + j * 70, 20, 40); }
    ctx.fillStyle = '#e8e8e8'; ctx.font = '600 20px Helvetica, Arial'; ctx.fillText('NAV          POWER          DRIVE', 50, 180);
  });
  b.add(kit.box(1.0, 1.0, 1.3, { bevel: 0.06 }), dark, { pos: [1.6, deckY + 0.95, 0], rot: [0, 0, -0.25] });
  b.add(kit.plane(1.2, 0.9), kit.canvasMat('lrv-console', faceCanvas, { emissive: 0.12 }), { pos: [1.6 - 0.51 * Math.cos(0.25), deckY + 0.95 + 0.51 * Math.sin(0.25), 0],
    quat: Quaternion.RotationAxis(new Vector3(0, 0, 1), -0.25).multiply(Quaternion.RotationAxis(UP, -Math.PI / 2)) });
  strut(kit, b, alu, new Vector3(1.6, deckY, 0), new Vector3(1.6, deckY + 0.5, 0), 0.07, 10);
  strut(kit, b, alu, new Vector3(1.05, deckY + 0.3, 0), new Vector3(1.05, deckY + 1.4, 0), 0.055, 10);
  strut(kit, b, dark, new Vector3(1.05, deckY + 1.4, -0.36), new Vector3(1.05, deckY + 1.4, 0.36), 0.06, 10);

  // high-gain antenna: a gold mesh umbrella on the forward mast, tipped back toward Earth
  strut(kit, b, alu, new Vector3(2.2, deckY, 0), new Vector3(2.2, deckY + 3.5, 0), 0.075, 12);
  const aim = new Vector3(0.32, 0.72, -0.62).normalize(); const q = quatFromY(aim);
  const hub = new Vector3(2.2, deckY + 3.55, 0);
  const dishMesh = wireMesh(kit, '#d8b04a', 'umbrella');
  b.add(kit.lathe([[0, 0], [0.4, 0.04], [0.8, 0.16], [1.2, 0.37], [1.55, 0.62]], { sides: 36, tile: 0.4 }), dishMesh, { pos: [hub.x, hub.y, hub.z], quat: q });
  const ribBasis = (() => { const m = new Vector3(); const x = Vector3.Cross(aim, new Vector3(0, 0, 1)).normalize(); const z = Vector3.Cross(x, aim).normalize(); return { x, z, m }; })();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2; const r = ribBasis.x.scale(Math.cos(a)).add(ribBasis.z.scale(Math.sin(a)));
    b.add(kit.tube(kit.curve([hub, hub.add(r.scale(0.8)).add(aim.scale(0.16)), hub.add(r.scale(1.55)).add(aim.scale(0.62))], 6), 0.02, { sides: 5 }), alu);
  }
  strut(kit, b, alu, hub, hub.add(aim.scale(1.15)), 0.035, 6);
  b.add(kit.cyl(0.1, 0.14, 0.3, { sides: 12 }), gold, { pos: [hub.x + aim.x * 1.2, hub.y + aim.y * 1.2, hub.z + aim.z * 1.2], quat: q });
  // low-gain antenna on the inboard handhold, a slim helix housing at its tip
  strut(kit, b, alu, new Vector3(1.9, deckY, -1.1), new Vector3(1.9, deckY + 2.8, -1.1), 0.03, 6);
  b.add(kit.cyl(0.07, 0.07, 0.75, { sides: 10 }), wh, { pos: [1.9, deckY + 3.15, -1.1] });
  // colour TV camera on its own staff, wrapped in film, looking down the nose
  strut(kit, b, alu, new Vector3(2.5, deckY, 1.0), new Vector3(2.5, deckY + 1.35, 1.0), 0.04, 8);
  b.add(kit.box(0.62, 0.48, 0.46, { bevel: 0.05 }), gold, { pos: [2.5, deckY + 1.6, 1.0] });
  b.add(kit.cyl(0.15, 0.17, 0.4, { sides: 16 }), dark, { pos: [2.98, deckY + 1.6, 1.0], rot: [0, 0, Math.PI / 2] });
  b.add(kit.cyl(0.13, 0.13, 0.03, { sides: 16 }), kit.flat(0x10202c, { rough: 0.05, metal: 0.6 }), { pos: [3.19, deckY + 1.6, 1.0], rot: [0, 0, Math.PI / 2] });
  // communications relay unit on the nose, mirrored radiator on top
  b.add(kit.box(1.5, 0.95, 1.9, { bevel: 0.06 }), gold, { pos: [L * 0.4, deckY + 0.5, -0.4] });
  b.add(kit.box(1.4, 0.04, 1.8), silver, { pos: [L * 0.4, deckY + 1.0, -0.4] });
  b.add(kit.box(1.0, 0.7, 0.9, { bevel: 0.05 }), gold, { pos: [L * 0.4, deckY + 0.38, 1.4] });
  // batteries and drive electronics under their blankets, amidships
  b.add(kit.box(L * 0.3, 0.3, W * 0.56, { bevel: 0.05 }), silver, { pos: [L * 0.24, deckY + 0.18, 0] });
  // aft pallet: tool carrier gate, sample bags, the rake and the tongs
  b.add(kit.box(1.5, 0.7, W * 0.55, { bevel: 0.06 }), gold, { pos: [-L * 0.42, deckY + 0.4, 0] });
  b.add(kit.box(0.9, 0.95, 0.9, { bevel: 0.08 }), wh, { pos: [-L * 0.42, deckY + 1.25, -0.9] });
  for (const z of [-1.5, 1.5]) strut(kit, b, alu, new Vector3(-L * 0.47, deckY, z), new Vector3(-L * 0.47, deckY + 2.6, z), 0.045, 8);
  strut(kit, b, alu, new Vector3(-L * 0.47, deckY + 2.6, -1.5), new Vector3(-L * 0.47, deckY + 2.6, 1.5), 0.045, 8);
  strut(kit, b, alu, new Vector3(-L * 0.47, deckY + 1.6, -1.5), new Vector3(-L * 0.47, deckY + 1.6, 1.5), 0.035, 8);
  for (const [z, top] of [[0.5, 3.4], [0.95, 3.1], [1.3, 3.6]]) strut(kit, b, alu, new Vector3(-L * 0.47 - 0.1, deckY + 0.6, z), new Vector3(-L * 0.47 - 0.35, deckY + top, z + 0.1), 0.028, 6);
  b.add(kit.box(0.5, 0.75, 0.62, { bevel: 0.1 }), kit.flat(0xe6e0cf, { rough: 0.95 }), { pos: [-L * 0.44, deckY + 1.1, 0.3] });

  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- FLAG ---------------------------------------------------------------------------------------
// Held out by a horizontal rod through its top hem, because there is no air to fly it; the
// ripple is the crease it kept from being rolled in its tube, frozen. It stands out along +X.
function lunarFlag(kit, { poleHeight = 8 } = {}) {
  const b = kit.builder('lunar-flag');
  const pole = kit.flat(0xd9dadc, { rough: 0.32, metal: 0.72 });
  const gold = kit.flat(0xc9a040, { rough: 0.35, metal: 0.7 });
  const H = poleHeight; const fw = 5; const fh = 3;
  b.add(kit.cyl(0.055, 0.075, H * 0.55, { sides: 16 }), pole, { pos: [0, H * 0.275, 0] });
  b.add(kit.cyl(0.045, 0.055, H * 0.45, { sides: 16 }), gold, { pos: [0, H * 0.775, 0] });
  b.add(kit.cyl(0.085, 0.085, 0.16, { sides: 16 }), pole, { pos: [0, H * 0.55, 0] });
  b.add(kit.lathe([[0, 0], [0.2, 0], [0.17, 0.12], [0.1, 0.3], [0, 0.32]], { sides: 20 }), pole);
  b.add(kit.cyl(0.04, 0.04, fw + 0.1, { sides: 12 }), gold, { pos: [fw / 2, H - 0.15, 0], rot: [0, 0, Math.PI / 2] });
  b.add(kit.sphere(0.07, { segments: 10 }), gold, { pos: [fw + 0.06, H - 0.15, 0] });
  b.add(kit.sphere(0.075, { segments: 10 }), gold, { pos: [0, H + 0.02, 0] });

  // the cloth: a grid, rippled along its length, sagging toward the free lower corner
  const NX = 40; const NY = 12;
  const p = []; const n = []; const uv = []; const idx = [];
  const zAt = (u, v) => Math.sin(u * Math.PI * 3) * 0.16 * (0.55 + 0.45 * (1 - v)) + Math.sin(u * Math.PI * 7 + 1.3) * 0.035 * (1 - v);
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const u = i / NX; const v = j / NY; // v = 1 at the top hem
    const sag = (1 - v) * u * u * 0.22;
    const x = u * fw - (1 - v) * u * 0.12; const y = (H - 0.15 - fh) + v * fh - sag; const z = zAt(u, v);
    const e = 0.002; const dzdx = (zAt(u + e, v) - zAt(u - e, v)) / (2 * e * fw);
    const l = Math.hypot(dzdx, 1);
    p.push(x, y, z); n.push(-dzdx / l, 0, 1 / l); uv.push(u, v);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i; const bb = a + 1; const c = bb + NX + 1; const d = a + NX + 1; idx.push(a, c, bb, a, d, c); }
  const cloth = new Mesh('flag-cloth', kit.scene);
  const vd = new VertexData(); vd.positions = p; vd.normals = n; vd.uvs = uv; vd.indices = idx; vd.applyToMesh(cloth);
  cloth.metadata = { uvDone: true };
  const clothMat = kit.canvasMat('lunar-flag-cloth', flagCanvas(), { emissive: 0.05, rough: 0.85 });
  clothMat.backFaceCulling = false; clothMat.twoSidedLighting = true;
  clothMat.subSurface.isTranslucencyEnabled = true; clothMat.subSurface.translucencyIntensity = 0.35;
  b.add(cloth, clothMat);
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- EARTH ------------------------------------------------------------------------------------------
// Lit by the same sun as everything else, so it has a real terminator -- on the Moon that IS the
// lesson. Three shells: the surface, a separate cloud deck just above it, and an atmosphere that
// only shows at the limb.
function cloudCanvas() {
  return paint(1024, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const rand = lcg(2718);
    const puff = (x, y, rx, ry, a, rot) => { for (const dx of [-w, 0, w]) { ctx.save(); ctx.translate(x + dx, y); ctx.rotate(rot); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.scale(1, ry / rx); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 6.283); ctx.fill(); ctx.restore(); } };
    // storm tracks in the mid-latitudes, a broken band on the equator, streamers between
    for (const [lat, n, tilt] of [[0.26, 70, 0.35], [0.74, 70, -0.35], [0.5, 40, 0], [0.12, 30, 0], [0.88, 30, 0]]) {
      for (let i = 0; i < n; i++) puff(rand() * w, h * (lat + (rand() - 0.5) * 0.13), 22 + rand() * 60, 8 + rand() * 18, 0.25 + rand() * 0.4, tilt + (rand() - 0.5) * 0.6);
    }
    for (let i = 0; i < 9; i++) { const cx = rand() * w; const cy = h * (rand() < 0.5 ? 0.3 : 0.7) + (rand() - 0.5) * 40; for (let k = 0; k < 26; k++) { const a = k * 0.5; const r = 6 + k * 3.2; puff(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.6, 16, 8, 0.4, a); } }
  });
}

function earthInSky(kit, { radius = 20 } = {}) {
  const b = kit.builder('earth-in-sky');
  const R = radius;
  const surface = memo(kit, 'earth-surface', () => {
    const map = earthTexture(2048);
    const m = kit.canvasMat('earth-surface', map.image, { emissive: 0.035, rough: 0.8 });
    m.fogEnabled = false; m.environmentIntensity = 0; m.specularIntensity = 0.5; m.directIntensity = 0.24;
    return m;
  });
  const clouds = memo(kit, 'earth-clouds', () => {
    const m = kit.canvasMat('earth-clouds', cloudCanvas(), { emissive: 0.02, rough: 1 });
    m.albedoTexture.hasAlpha = true; m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.fogEnabled = false; m.environmentIntensity = 0; m.specularIntensity = 0; m.disableDepthWrite = true; m.directIntensity = 0.26;
    return m;
  });
  b.add(kit.sphere(R, { segments: 64 }), surface, { rot: [0, 2.2, 0] });
  b.add(kit.sphere(R * 1.012, { segments: 48 }), clouds, { rot: [0, 0.7, 0] });
  const root = b.finish({ castShadows: false, receiveShadows: false });
  // The atmosphere: BACK-FACING additive shells a little larger than the planet. The near
  // half of each is culled and the far half is hidden behind the globe, so all that survives
  // is the sliver outside the limb -- which is exactly where an atmosphere shows from space.
  // (A Fresnel-opacity shell was tried first and lit the whole disc pale blue.)
  for (const [k, alpha] of [[1.022, 0.5], [1.05, 0.22], [1.09, 0.1]]) {
    const air = memo(kit, `earth-air-${k}`, () => {
      const m = new StandardMaterial(`earth-air-${k}`, kit.scene);
      m.disableLighting = true; m.emissiveColor = new Color3(0.3, 0.56, 1.0); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
      m.alpha = alpha; m.alphaMode = Constants.ALPHA_ADD; m.disableDepthWrite = true; m.fogEnabled = false;
      return m;
    });
    const shell = MeshBuilder.CreateSphere('earth-air', { diameter: R * 2 * k, segments: 40, sideOrientation: Mesh.BACKSIDE }, kit.scene);
    shell.material = air; shell.parent = root; shell.isPickable = false; shell.applyFog = false;
  }
  root.metadata.instanceable = false;
  return root;
}

// ---- ALSEP ----------------------------------------------------------------------------------------------
// The science station the crews left running: a central station under its film and sunshield,
// an RTG to power it a little way off, and experiments out on the end of flat ribbon cables.
function alsepStation(kit) {
  const b = kit.builder('alsep-station');
  const gold = foil(kit, 0xd7a13a, { tile: 1.4 }); const silver = foil(kit, 0xdcdde0, { tile: 1.4, metal: 0.72, rough: 0.26 });
  const alu = aluminium(kit); const dark = darkMetal(kit); const wh = white(kit);
  const ribbon = kit.flat(0xe3dcc6, { rough: 0.8 });
  // central station: pallet, blanketed electronics box, raised sunshield with side curtains
  b.add(kit.box(3.0, 0.2, 2.4, { bevel: 0.04 }), dark, { pos: [0, 0.18, 0] });
  b.add(kit.box(2.6, 1.3, 2.0, { bevel: 0.08 }), gold, { pos: [0, 0.93, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(kit, b, alu, new Vector3(sx * 1.25, 1.55, sz * 0.95), new Vector3(sx * 1.35, 2.3, sz * 1.05), 0.035, 6);
  b.add(kit.box(2.9, 0.06, 2.3, { bevel: 0.015 }), silver, { pos: [0, 2.32, 0] });
  for (const sx of [-1, 1]) b.add(kit.box(2.4, 0.06, 2.0, { bevel: 0.015 }), silver, { pos: [sx * 2.6, 1.7, 0], rot: [0, 0, sx * 0.35] });
  // helical S-band antenna on its aiming mechanism, pointed at Earth
  strut(kit, b, wh, new Vector3(0, 2.35, 0), new Vector3(0, 4.2, 0), 0.05, 8);
  b.add(kit.box(0.4, 0.3, 0.4, { bevel: 0.04 }), gold, { pos: [0, 4.25, 0] });
  const aim = new Vector3(-0.35, 0.8, -0.45).normalize(); const helix = [];
  const hx = Vector3.Cross(aim, UP).normalize(); const hz = Vector3.Cross(hx, aim).normalize();
  for (let k = 0; k <= 60; k++) { const t = k / 60; const a = t * Math.PI * 2 * 7; helix.push(new Vector3(0, 4.4, 0).add(aim.scale(t * 1.5)).add(hx.scale(Math.cos(a) * 0.17)).add(hz.scale(Math.sin(a) * 0.17))); }
  b.add(kit.tube(helix, 0.018, { sides: 5 }), alu);
  b.add(kit.cyl(0.9, 0.9, 0.04, { sides: 28 }), wh, { pos: [0, 4.72, 0], quat: quatFromY(aim) });
  // RTG: a finned cask on its own pallet, and the fuel-cask dome beside it
  b.add(kit.box(2.2, 0.1, 2.2, { bevel: 0.03 }), kit.flat(0xe8e4d8, { rough: 0.7 }), { pos: [4.5, 0.08, 1.8] });
  b.add(kit.cyl(0.42, 0.46, 1.5, { sides: 24 }), dark, { pos: [4.5, 0.9, 1.8] });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; b.add(kit.box(0.62, 1.25, 0.035), dark, { pos: [4.5 + Math.cos(a) * 0.72, 0.9, 1.8 + Math.sin(a) * 0.72], rot: [0, -a, 0] }); }
  b.add(kit.lathe([[0, 0], [0.5, 0], [0.46, 0.14], [0.2, 0.28], [0, 0.3]], { sides: 24 }), alu, { pos: [4.5, 1.65, 1.8] });
  // laser ranging retroreflector: a tilted tray of a hundred corner cubes, aimed at Earth
  const lr = paint(512, 384, (ctx, w, h) => { ctx.fillStyle = '#2a2c30'; ctx.fillRect(0, 0, w, h); for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) { const x = 38 + c * 40; const y = 40 + r * 44; const g = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, 17); g.addColorStop(0, '#eaffff'); g.addColorStop(0.5, '#6fc3e6'); g.addColorStop(1, '#123040'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, 6.283); ctx.fill(); } });
  b.add(kit.box(2.0, 0.35, 1.4, { bevel: 0.04 }), alu, { pos: [-4.6, 0.9, 1.6], rot: [-0.4, 0, 0] });
  b.add(kit.plane(1.9, 1.3), kit.canvasMat('alsep-lrrr', lr, { emissive: 0, rough: 0.2 }), { pos: [-4.6, 0.9 + 0.185 * Math.cos(0.4), 1.6 + 0.185 * Math.sin(0.4) * -1], rot: [-Math.PI / 2 - 0.4, 0, 0] });
  for (const [x, z] of [[-5.4, 1.1], [-3.8, 1.1], [-5.4, 2.2], [-3.8, 2.2]]) strut(kit, b, alu, new Vector3(x, 0, z + 0.1), new Vector3(x, 0.9 - (z - 1.6) * 0.42, z), 0.03, 6);
  // passive seismometer: a drum levelled under a wide silver thermal skirt lying on the regolith
  b.add(kit.cyl(1.9, 2.0, 0.03, { sides: 40 }), silver, { pos: [0.4, 0.04, 4.2] });
  b.add(kit.cyl(0.42, 0.46, 0.75, { sides: 24 }), gold, { pos: [0.4, 0.42, 4.2] });
  b.add(kit.lathe([[0, 0], [0.46, 0], [0.4, 0.1], [0, 0.16]], { sides: 24 }), silver, { pos: [0.4, 0.8, 4.2] });
  // magnetometer: three booms on a tripod
  const mc = new Vector3(-2.4, 1.6, -3.6);
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.4; strut(kit, b, alu, mc, new Vector3(mc.x + Math.cos(a) * 0.9, 0, mc.z + Math.sin(a) * 0.9), 0.03, 6); const tip = new Vector3(mc.x + Math.cos(a + 1) * 1.6, mc.y + 0.9, mc.z + Math.sin(a + 1) * 1.6); strut(kit, b, alu, mc, tip, 0.03, 6); b.add(kit.box(0.25, 0.25, 0.25, { bevel: 0.03 }), gold, { pos: [tip.x, tip.y, tip.z] }); }
  b.add(kit.box(0.4, 0.4, 0.4, { bevel: 0.04 }), gold, { pos: [mc.x, mc.y, mc.z] });
  // ribbon cables, flat on the ground, wandering as unreeled cable does
  const cable = (pts) => { const c = kit.curve(pts.map(([x, z]) => [x, 0.03, z]), 14); for (let k = 0; k < c.length - 1; k++) { const m = c[k].add(c[k + 1]).scale(0.5); const d = c[k + 1].subtract(c[k]); b.add(kit.box(d.length() + 0.04, 0.02, 0.22), ribbon, { pos: [m.x, 0.03, m.z], rot: [0, -Math.atan2(d.z, d.x), 0] }); } };
  cable([[1.5, 0.6], [2.6, 1.5], [3.4, 1.2], [4.0, 1.7]]);
  cable([[-1.5, 0.5], [-2.6, 0.9], [-3.4, 1.7], [-3.9, 1.6]]);
  cable([[0.3, 1.2], [0.9, 2.2], [0.2, 3.0], [0.4, 3.7]]);
  cable([[-0.8, -1.2], [-1.2, -2.2], [-2.0, -2.8], [-2.3, -3.4]]);
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- HABITAT ----------------------------------------------------------------------------------------------
// A pressurised dome under a gored skin, banked with regolith for radiation cover, with its
// airlock tunnel and hatch on +Z and a row of lit viewports round the front.
function moonHabitat(kit, { radius = 10, height = 14 } = {}) {
  const b = kit.builder('moon-habitat');
  const R = radius; const H = height;
  const skin = panels(kit, 0xe6e4dc, { tile: 4, rough: 0.6, metal: 0.1 });
  const dark = darkMetal(kit); const alu = aluminium(kit);
  // grey: true, not a grey TINT -- Ground054 is a tan sand photo, and tan times any grey is
  // still tan, which banked the habitat in garden soil. The berm is the Moon's own regolith.
  const regolith = kit.mat('Ground054', { grey: true, gain: 1.15, tile: 6, bump: 1.4 });
  const lit = kit.flat(0x9fd6f2, { rough: 0.12, emissive: 0x6fb8e6, emissiveIntensity: 1.6 });
  const prof = [];
  for (let k = 0; k <= 22; k++) { const a = (k / 22) * Math.PI / 2; prof.push([Math.cos(a) * R, 0.6 + Math.sin(a) * H]); }
  b.add(kit.lathe(prof, { sides: 64, tile: 4 }), skin);
  b.add(kit.lathe([[R * 1.02, 0], [R * 1.07, 0], [R * 1.07, 1.1], [R * 1.02, 1.25], [R * 0.99, 1.25]], { sides: 64, tile: 4 }), dark);
  // regolith berm, banked against the base except across the airlock
  b.add(kit.lathe([[R * 1.05, 0], [R * 1.36, 0], [R * 1.22, 1.5], [R * 1.08, 2.7], [R * 1.0, 2.9]], { sides: 56, tile: 6 }), regolith);
  // meridian ribs and two hoops, standing proud of the skin
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2; const pts = [];
    for (let k = 0; k <= 16; k++) { const e = (k / 16) * Math.PI / 2; pts.push([Math.cos(a) * Math.cos(e) * (R + 0.04), 0.6 + Math.sin(e) * (H + 0.04), Math.sin(a) * Math.cos(e) * (R + 0.04)]); }
    b.add(kit.tube(pts, 0.11, { sides: 8 }), dark);
  }
  for (const e of [0.42, 0.95]) b.add(kit.torus(Math.cos(e) * R + 0.04, 0.2, { sides: 64 }), dark, { pos: [0, 0.6 + Math.sin(e) * H, 0] });
  b.add(kit.cyl(1.3, 1.6, 0.5, { sides: 28 }), dark, { pos: [0, 0.6 + H + 0.1, 0] });
  strut(kit, b, alu, new Vector3(0, H + 0.8, 0), new Vector3(0, H + 5.2, 0), 0.06, 8);
  b.add(kit.sphere(0.16, { segments: 10 }), kit.flat(0xff4030, { rough: 0.3, emissive: 0xff3020, emissiveIntensity: 3 }), { pos: [0, H + 5.3, 0] });
  // airlock tunnel on +Z with stiffening rings, the hatch, its hand wheel and a viewport
  const z0 = R * 0.7 + 3.4;
  b.add(kit.cyl(2.2, 2.2, 8, { sides: 40, tile: 4 }), skin, { pos: [0, 3.2, z0], rot: [Math.PI / 2, 0, 0] });
  for (const dz of [-2.4, 0, 2.4, 3.8]) b.add(kit.torus(2.22, 0.2, { sides: 40 }), dark, { pos: [0, 3.2, z0 + dz], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.cyl(2.5, 2.5, 0.5, { sides: 40 }), dark, { pos: [0, 3.2, z0 + 3.9], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.cyl(1.75, 1.75, 0.2, { sides: 40 }), skin, { pos: [0, 3.2, z0 + 4.2], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.torus(0.55, 0.07, { sides: 28 }), alu, { pos: [0, 3.2, z0 + 4.42], rot: [Math.PI / 2, 0, 0] });
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI; strut(kit, b, alu, new Vector3(Math.cos(a) * 0.55, 3.2 + Math.sin(a) * 0.55, z0 + 4.42), new Vector3(-Math.cos(a) * 0.55, 3.2 - Math.sin(a) * 0.55, z0 + 4.42), 0.035, 6); }
  b.add(kit.cyl(0.38, 0.38, 0.06, { sides: 24 }), lit, { pos: [0, 4.35, z0 + 4.32], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.box(3.6, 0.3, 2.2, { bevel: 0.05 }), dark, { pos: [0, 0.75, z0 + 5.2] });
  b.add(kit.box(3.6, 0.3, 1.6, { bevel: 0.05 }), dark, { pos: [0, 0.3, z0 + 6.6] });
  // viewports: framed, and lit from inside
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45; const e = Math.asin((6.5 - 0.6) / H);
    const nrm = new Vector3(Math.sin(a) * Math.cos(e) / R, Math.sin(e) / H, Math.cos(a) * Math.cos(e) / R).normalize();
    const at = new Vector3(Math.sin(a) * Math.cos(e) * R, 6.5, Math.cos(a) * Math.cos(e) * R);
    const q = quatFromY(nrm);
    b.add(kit.cyl(1.25, 1.35, 0.5, { sides: 28 }), dark, { pos: [at.x, at.y, at.z], quat: q });
    b.add(kit.cyl(1.0, 1.0, 0.56, { sides: 28 }), lit, { pos: [at.x, at.y, at.z], quat: q });
    b.add(kit.box(2.0, 0.1, 0.12), dark, { pos: [at.x + nrm.x * 0.26, at.y + nrm.y * 0.26, at.z + nrm.z * 0.26], quat: q });
  }
  // consumables: two spherical tanks and their lines, tucked against the berm at the back
  for (const sx of [-1, 1]) { b.add(kit.sphere(1.7, { segments: 24 }), skin, { pos: [sx * 3.2, 2.2, -R * 1.22] }); strut(kit, b, alu, new Vector3(sx * 3.2, 3.6, -R * 1.2), new Vector3(sx * 2.2, 5.2, -R * 0.84), 0.08, 8); }
  const root = b.finish();
  root.metadata.lights = [{ pos: [0, 5, R * 0.7 + 9.5], color: 0xbfe4ff, intensity: 45, range: 30, always: 1 }];
  root.metadata.instanceable = false;
  return root;
}

// ---- PLAQUE ---------------------------------------------------------------------------------------------------
function lunarPlaque(kit, { width = 3.4 } = {}) {
  const b = kit.builder('lunar-plaque');
  const steel = kit.flat(0xc3c5c8, { rough: 0.3, metal: 0.75 });
  const W = width; const H = W * 0.62;
  b.add(kit.lathe([[0, 0], [0.55, 0], [0.5, 0.14], [0.16, 0.2], [0, 0.2]], { sides: 28 }), steel);
  b.add(kit.cyl(0.1, 0.12, 3.4, { sides: 20 }), steel, { pos: [0, 1.7, 0] });
  const face = paint(1216, 752, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#d2d4d6'); g.addColorStop(0.5, '#b4b6b9'); g.addColorStop(1, '#c8cacc');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.12; ctx.strokeStyle = '#fff'; for (let y = 0; y < h; y += 3) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (y % 7) - 3); ctx.stroke(); } ctx.globalAlpha = 1;
    ctx.strokeStyle = '#4a4c50'; ctx.lineWidth = 8; ctx.strokeRect(24, 24, w - 48, h - 48);
    // the two hemispheres
    for (const [cx, label] of [[w * 0.3, 'WESTERN'], [w * 0.7, 'EASTERN']]) { ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, 150, 92, 0, 6.283); ctx.stroke(); ctx.lineWidth = 1.5; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.ellipse(cx, 150, Math.abs(k) * 30 + 8, 92, 0, 0, 6.283); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - Math.sqrt(92 * 92 - (k * 34) ** 2), 150 + k * 34); ctx.lineTo(cx + Math.sqrt(92 * 92 - (k * 34) ** 2), 150 + k * 34); ctx.stroke(); } ctx.fillStyle = '#34363a'; ctx.font = '600 18px Helvetica, Arial'; ctx.textAlign = 'center'; ctx.fillText(`${label} HEMISPHERE`, cx, 270); }
    ctx.fillStyle = '#2c2e32'; ctx.textAlign = 'center';
    ctx.font = '700 58px Georgia, serif'; ctx.fillText('HERE HUMANS FROM THE PLANET EARTH', w / 2, 372, w - 120);
    ctx.fillText('FIRST SET FOOT UPON THE MOON', w / 2, 442, w - 120);
    ctx.font = '700 46px Georgia, serif'; ctx.fillText('JULY 1969, A.D.', w / 2, 508);
    ctx.font = 'italic 46px Georgia, serif'; ctx.fillText('WE CAME IN PEACE FOR ALL MANKIND', w / 2, 590, w - 120);
    ctx.lineWidth = 2; ctx.strokeStyle = '#34363a'; for (const x of [0.2, 0.5, 0.8]) { ctx.beginPath(); ctx.moveTo(w * x - 120, 680); ctx.bezierCurveTo(w * x - 60, 640, w * x, 700, w * x + 120, 664); ctx.stroke(); }
  });
  const tilt = -Math.PI / 7; const cy = 3.4 + H * 0.2;
  b.add(kit.box(W + 0.12, H + 0.12, 0.08, { bevel: 0.025 }), steel, { pos: [0, cy, 0], rot: [tilt, 0, 0] });
  const m = kit.canvasMat('lunar-plaque-face', face, { emissive: 0.04, rough: 0.35 }); m.metallic = 0.55;
  b.add(kit.plane(W, H), m, { pos: [0, cy + 0.046 * Math.sin(-tilt), 0.046 * Math.cos(tilt)], rot: [tilt, 0, 0] });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- BOOTPRINTS -------------------------------------------------------------------------------------------------
// Pressed INTO the dust: a dark compacted sole with the Apollo overshoe's nine crossbars, drawn
// as a relief so the low sun rakes across it. Positions use the main app's own random stream, so
// each print is exactly where the three.js trail (and the placard describing it) says it is.
function bootprintTrail(kit, { count = 8, seed = 5 } = {}) {
  const mat = memo(kit, 'bootprint', () => {
    const W = 128; const Hh = 224;
    const albedo = paint(W, Hh, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const sole = () => { ctx.beginPath(); ctx.moveTo(w * 0.5, 8); ctx.bezierCurveTo(w * 0.98, 10, w * 0.95, h * 0.5, w * 0.8, h * 0.62); ctx.bezierCurveTo(w * 0.72, h * 0.72, w * 0.84, h * 0.96, w * 0.5, h - 8); ctx.bezierCurveTo(w * 0.16, h * 0.96, w * 0.28, h * 0.72, w * 0.2, h * 0.62); ctx.bezierCurveTo(w * 0.05, h * 0.5, w * 0.02, 10, w * 0.5, 8); ctx.closePath(); };
      ctx.shadowColor = 'rgba(30,29,27,0.7)'; ctx.shadowBlur = 8; sole(); ctx.fillStyle = 'rgba(58,56,52,0.78)'; ctx.fill(); ctx.shadowBlur = 0;
      ctx.save(); sole(); ctx.clip();
      for (let r = 0; r < 10; r++) { const y = 18 + r * 20; ctx.fillStyle = 'rgba(132,129,121,0.85)'; ctx.fillRect(0, y, w, 8); ctx.fillStyle = 'rgba(24,23,21,0.55)'; ctx.fillRect(0, y + 8, w, 5); }
      ctx.restore();
    });
    const m = kit.canvasMat('bootprint', albedo, { emissive: 0, rough: 1 });
    m.albedoTexture.hasAlpha = true; m.useAlphaFromAlbedoTexture = true; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    m.disableDepthWrite = true; m.zOffset = -3; m.environmentIntensity = 0.3; m.specularIntensity = 0.1; m.backFaceCulling = false;
    return m;
  });
  const b = kit.builder('bootprint-trail');
  const rng = appRandom(seed);
  for (let i = 0; i < count; i++) {
    const rz = randomIn(rng, -0.25, 0.25);
    const x = (i % 2 === 0 ? -0.42 : 0.42) + randomIn(rng, -0.1, 0.1);
    // left and right boots are mirror images: flip the plane's width for alternate prints
    b.add(kit.plane(0.55, 0.95), mat, { pos: [x, 0.04, -i * 1.5], rot: [-Math.PI / 2, 0, rz], scale: [i % 2 === 0 ? 1 : -1, 1, 1] });
  }
  return b.finish({ castShadows: false, receiveShadows: false });
}

export const LUNAR_NATIVE = {
  'lunar-module': lunarModule,
  'lunar-rover': lunarRover,
  'lunar-flag': lunarFlag,
  'earth-in-sky': earthInSky,
  'alsep-station': alsepStation,
  'moon-habitat': moonHabitat,
  'lunar-plaque': lunarPlaque,
  'bootprint-trail': bootprintTrail,
};
