// Trees.
//
// The main app's trees are a trunk and a handful of merged blobs, because on a Chromebook a
// canopy is a triangle budget. Here a tree is what it is in every current game engine: a
// real branching skeleton swept in bark, carrying several hundred alpha-tested LEAF CARDS
// whose normals are bent outward from the crown's centre. That last part is what makes it
// read as a volume of foliage rather than as a heap of flat cards -- each card is shaded as
// if it were a patch of one big soft sphere, so the crown has a lit side and a shaded side
// and the individual cards disappear into it.
//
// Foliage is translucent (light glows through a backlit leaf, which is most of why a real
// tree looks alive at four in the afternoon), casts alpha-tested shadows, and sways in a
// vertex shader. The sway is weighted by height above the tree's own base so the trunk end
// of every branch stays put.

import { Mesh, VertexData, DynamicTexture, Vector3, Color3, TransformNode, PBRMaterial } from '@babylonjs/core';
import { PBRCustomMaterial } from '@babylonjs/materials';
import { seededRandom, linear } from './Kit.js';

let windTime = 0;
export function tickWind(dt) { windTime += dt; }
export const windUniforms = { strength: 1 };

// ---- leaf textures ----------------------------------------------------------------------
function leafPath(ctx, len, wid, kind) {
  ctx.beginPath();
  if (kind === 'maple') {
    // five-lobed palmate outline
    const lobes = [[0, -1], [0.62, -0.62], [0.95, 0.05], [0.4, 0.3], [0, 0.18], [-0.4, 0.3], [-0.95, 0.05], [-0.62, -0.62]];
    ctx.moveTo(0, 0.35 * len);
    lobes.forEach(([x, y], i) => {
      const px = x * wid; const py = y * len * 0.8;
      const notch = 0.42;
      const nx = (lobes[(i + lobes.length - 1) % lobes.length][0] * wid + px) * 0.5 * notch;
      const ny = (lobes[(i + lobes.length - 1) % lobes.length][1] * len * 0.8 + py) * 0.5 * notch;
      if (i > 0) ctx.lineTo(nx, ny);
      ctx.lineTo(px, py);
    });
    ctx.closePath();
  } else if (kind === 'fan') {
    // Ginkgo: a fan on a stalk, notched at the top. No other living tree has this leaf, and
    // it is unchanged since the Jurassic -- which is why it is in the dinosaur world at all.
    ctx.moveTo(0, 0);
    ctx.lineTo(-wid * 0.12, -len * 0.3);
    ctx.bezierCurveTo(-wid * 1.5, -len * 0.55, -wid * 1.3, -len * 1.0, -wid * 0.12, -len * 0.98);
    ctx.lineTo(0, -len * 0.74);
    ctx.lineTo(wid * 0.12, -len * 0.98);
    ctx.bezierCurveTo(wid * 1.3, -len * 1.0, wid * 1.5, -len * 0.55, wid * 0.12, -len * 0.3);
    ctx.closePath();
  } else {
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.8, 0, -len);
    ctx.bezierCurveTo(-wid * 0.8, -len * 0.8, -wid, -len * 0.25, 0, 0);
  }
}

function drawLeaf(ctx, x, y, angle, len, wid, hue, sat, light, kind) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(-wid, 0, wid, -len);
  g.addColorStop(0, `hsl(${hue},${sat}%,${light - 9}%)`);
  g.addColorStop(0.55, `hsl(${hue + 6},${sat}%,${light}%)`);
  g.addColorStop(1, `hsl(${hue + 12},${sat + 6}%,${light + 9}%)`);
  leafPath(ctx, len, wid, kind);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `hsla(${hue + 10},${sat}%,${light + 16}%,0.55)`;
  ctx.lineWidth = Math.max(1, len * 0.03);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len * 0.92); ctx.stroke();
  ctx.restore();
}

// Textures that are ONE frond or spray running up the canvas, for ribbon geometry rather
// than for scattered cards.
function blank(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

const FROND_PAINTERS = {
  // A pinnate fern frond: a rachis with paired pinnae, each pinna itself toothed, the whole
  // thing tapering to the tip and the pinnae raked forward.
  fern(p) {
    const c = blank(256, 1024); const ctx = c.getContext('2d'); const rand = seededRandom(91);
    ctx.strokeStyle = `hsl(${p.hue - 30},35%,22%)`; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(128, 1020); ctx.lineTo(128, 10); ctx.stroke();
    const pairs = 34;
    for (let i = 0; i < pairs; i++) {
      const t = i / (pairs - 1); const y = 990 - t * 960;
      const reach = 118 * Math.pow(Math.sin(Math.PI * (0.08 + t * 0.92)), 0.7) * (1 - t * 0.35);
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(128, y); ctx.rotate(side * (Math.PI / 2 - 0.32) - (side < 0 ? 0 : 0));
        ctx.scale(side, 1);
        const g = ctx.createLinearGradient(0, 0, 0, -reach);
        g.addColorStop(0, `hsl(${p.hue + rand() * 10},${p.sat}%,${p.light - 4}%)`);
        g.addColorStop(1, `hsl(${p.hue + 14},${p.sat + 8}%,${p.light + 12}%)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, 0);
        const teeth = 9;
        for (let k = 1; k <= teeth; k++) { const f = k / teeth; const w = 15 * Math.sin(Math.PI * Math.min(1, f * 1.05)) + 2; ctx.lineTo(-w, -reach * (f - 0.04)); ctx.lineTo(-w * 0.55, -reach * f); }
        ctx.lineTo(0, -reach);
        for (let k = teeth; k >= 1; k--) { const f = k / teeth; const w = 15 * Math.sin(Math.PI * Math.min(1, f * 1.05)) + 2; ctx.lineTo(w * 0.55, -reach * f); ctx.lineTo(w, -reach * (f - 0.04)); }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    return c;
  },
  // A cycad leaf: stiff, straight, the leaflets narrow, parallel-sided and close-set like the
  // teeth of a comb. It is the stiffness that separates it from a fern at a glance.
  cycad(p) {
    const c = blank(256, 1024); const ctx = c.getContext('2d'); const rand = seededRandom(93);
    ctx.strokeStyle = `hsl(${p.hue - 40},30%,24%)`; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(128, 1020); ctx.lineTo(128, 8); ctx.stroke();
    const pairs = 58;
    for (let i = 0; i < pairs; i++) {
      const t = i / (pairs - 1); const y = 960 - t * 945;
      const reach = 122 * Math.pow(Math.sin(Math.PI * (0.12 + t * 0.86)), 0.55);
      for (const side of [-1, 1]) {
        ctx.strokeStyle = `hsl(${p.hue + rand() * 12 - 4},${p.sat}%,${p.light + rand() * 10 - 2}%)`;
        ctx.lineWidth = 8.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(128, y); ctx.lineTo(128 + side * reach, y - reach * 0.42); ctx.stroke();
      }
    }
    return c;
  },
  // Araucaria: thick rope-like shoots completely clothed in overlapping, sharp scale leaves.
  araucaria(p) {
    const c = blank(512, 1024); const ctx = c.getContext('2d'); const rand = seededRandom(95);
    const rope = (x0, y0, x1, y1, width) => {
      const n = Math.floor(Math.hypot(x1 - x0, y1 - y0) / 7);
      const ang = Math.atan2(y1 - y0, x1 - x0);
      for (let i = 0; i < n; i++) {
        const t = i / n; const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t; const w = width * (1 - t * 0.35);
        for (const side of [-1, 0, 1]) {
          ctx.fillStyle = `hsl(${p.hue + rand() * 16 - 6},${p.sat + rand() * 10}%,${p.light + rand() * 14 - 3 + (side === 0 ? 6 : 0)}%)`;
          ctx.save(); ctx.translate(x, y); ctx.rotate(ang + side * 0.95);
          ctx.beginPath(); ctx.moveTo(-w * 0.4, -w * 0.32); ctx.lineTo(w * 1.15, 0); ctx.lineTo(-w * 0.4, w * 0.32); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
      }
    };
    rope(256, 1015, 256, 40, 26);
    for (let i = 0; i < 9; i++) {
      const t = 0.12 + i * 0.095; const y = 1015 - t * 975;
      for (const side of [-1, 1]) rope(256, y, 256 + side * (200 - t * 90), y - 150 + t * 40, 17);
    }
    return c;
  },
  // Horsetail: a jointed stem with a whorl of thin green branchlets at every node.
  horsetail(p) {
    const c = blank(256, 1024); const ctx = c.getContext('2d'); const rand = seededRandom(97);
    const nodes = 15;
    for (let i = 0; i < nodes; i++) {
      const t = i / (nodes - 1); const y = 1010 - t * 990; const seg = 990 / (nodes - 1);
      ctx.fillStyle = `hsl(${p.hue},${p.sat}%,${p.light + 4}%)`;
      ctx.fillRect(128 - 7 * (1 - t * 0.6), y - seg, 14 * (1 - t * 0.6), seg);
      ctx.fillStyle = '#2a2a1c'; ctx.fillRect(128 - 9 * (1 - t * 0.6), y - 5, 18 * (1 - t * 0.6), 6);
      const reach = 118 * Math.sin(Math.PI * (0.18 + t * 0.78)) * 0.95;
      ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        for (const side of [-1, 1]) {
          ctx.strokeStyle = `hsl(${p.hue + rand() * 14},${p.sat + 6}%,${p.light + rand() * 12}%)`;
          const lift = 0.35 + k * 0.11;
          ctx.beginPath(); ctx.moveTo(128, y); ctx.quadraticCurveTo(128 + side * reach * 0.5, y - reach * lift * 0.4, 128 + side * reach * (1 - k * 0.09), y - reach * lift); ctx.stroke();
        }
      }
    }
    return c;
  },
};

function foliageCanvas(kind, palette) {
  if (FROND_PAINTERS[palette.tex]) return FROND_PAINTERS[palette.tex](palette);
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.scale(size / 512, size / 512);
  const S = 512; // drawing units
  const rand = seededRandom(kind.length * 977 + 5);
  const { hue, sat, light } = palette;

  if (palette.tex === 'conifer') {
    // A flat needle spray: a central shoot with side shoots, each bristling with needles.
    const shoot = (x0, y0, ang, len, depth) => {
      const x1 = x0 + Math.cos(ang) * len; const y1 = y0 + Math.sin(ang) * len;
      ctx.strokeStyle = '#4a3a26'; ctx.lineWidth = 2 + depth * 2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const n = Math.floor(len / 3.2);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const px = x0 + (x1 - x0) * t; const py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) {
          const na = ang + side * (0.9 + rand() * 0.35);
          const nl = (16 + rand() * 12) * (1 - t * 0.45) * (depth ? 1 : 0.8);
          ctx.strokeStyle = `hsl(${hue + rand() * 22 - 8},${sat + rand() * 10}%,${light + rand() * 16 - 6}%)`;
          ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); ctx.stroke();
        }
      }
      if (depth > 0) {
        const kids = 7;
        for (let i = 1; i <= kids; i++) {
          const t = i / (kids + 1);
          const px = x0 + (x1 - x0) * t; const py = y0 + (y1 - y0) * t;
          for (const side of [-1, 1]) shoot(px, py, ang + side * (0.75 + rand() * 0.2), len * (0.46 - t * 0.22), depth - 1);
        }
      }
    };
    shoot(S / 2, S - 6, -Math.PI / 2, S - 30, 1);
    return c;
  }

  // Broadleaf: a fan of twigs from the bottom centre, leaves packed along each so the card
  // is mostly OPAQUE. A sparse card alpha-tests away to nothing in the mip chain, and the
  // whole crown thins out with distance.
  const twigs = 9;
  for (let t = 0; t < twigs; t++) {
    const ang = -Math.PI / 2 + ((t / (twigs - 1)) - 0.5) * 2.5;
    const len = S * (0.5 + rand() * 0.42);
    const x0 = S / 2; const y0 = S * 0.92;
    ctx.strokeStyle = '#3d2c1c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5 + (rand() - 0.5) * 40, y0 + Math.sin(ang) * len * 0.5, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
    ctx.stroke();
    const leaves = palette.leaves ?? 13;
    for (let i = 0; i < leaves; i++) {
      const f = 0.12 + (i / leaves) * 0.9;
      const px = x0 + Math.cos(ang) * len * f + (rand() - 0.5) * 26;
      const py = y0 + Math.sin(ang) * len * f + (rand() - 0.5) * 26;
      const bloom = palette.bloom;
      const blossom = bloom && rand() < bloom.ratio;
      if (blossom) {
        const r = (15 + rand() * 12) * (bloom.size ?? 1);
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * Math.PI * 2 + rand();
          ctx.fillStyle = `hsl(${bloom.hue + rand() * 14 - 7},${bloom.sat + rand() * 20}%,${bloom.light + rand() * 10}%)`;
          ctx.beginPath(); ctx.ellipse(px + Math.cos(pa) * r * 0.55, py + Math.sin(pa) * r * 0.55, r * 0.62, r * 0.42, pa, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#f6d65a'; ctx.beginPath(); ctx.arc(px, py, r * 0.22, 0, Math.PI * 2); ctx.fill();
      } else {
        const shape = palette.shape ?? 'ovate';
        const l = ((shape === 'maple' ? 54 : shape === 'fan' ? 50 : 46) + rand() * 26) * (palette.leafScale ?? 1);
        const aspect = shape === 'maple' ? 0.62 : shape === 'fan' ? 0.5 : (palette.leafAspect ?? 0.4);
        drawLeaf(ctx, px, py, ang + Math.PI / 2 + (rand() - 0.5) * 2.2, l, l * aspect,
          hue + rand() * (palette.hueSpread ?? 26) - 10, sat + rand() * 14 - 4, light + rand() * 18 - 8, shape);
      }
    }
  }
  return c;
}

// One entry per SPECIES: how its leaves are painted, and how the tree is shaped. A species is
// a list of field marks -- the main app's own rule -- so each one states the two or three
// things that carry the identification rather than being a recoloured copy of its neighbour.
const SPECIES = {
  shade: { hue: 96, sat: 52, light: 33 },
  maple: { hue: 84, sat: 58, light: 36, shape: 'maple' },
  // The Neighborhood's street trees in their three seasons' worth of colour.
  mapleAutumn: { hue: 18, sat: 78, light: 44, shape: 'maple', hueSpread: 34, tint: 0xffb060 },
  mapleGold: { hue: 44, sat: 82, light: 50, shape: 'maple', hueSpread: 20, tint: 0xffe070 },
  flowering: { hue: 102, sat: 45, light: 36, bloom: { hue: 338, sat: 70, light: 80, ratio: 0.62 }, tint: 0xffd0dc },
  // Hawthorn in May: a low, dense, rounded crown foaming with small white blossom.
  hawthorn: { hue: 104, sat: 46, light: 30, leafScale: 0.62, leaves: 20, bloom: { hue: 60, sat: 12, light: 90, ratio: 0.42, size: 0.55 },
    crown: [0.46, 0.3, 0.46], centre: 0.62, base: 0.3, trunk: 0.04, wander: 0.14, bark: 0x8a8078 },
  // Ginkgo: upright and narrow, fan leaves, a brighter yellow-green than anything around it.
  ginkgo: { hue: 74, sat: 62, light: 42, shape: 'fan', crown: [0.26, 0.4, 0.26], centre: 0.62, base: 0.26, trunk: 0.03, bark: 0xa8a090 },
  // An early magnolia: a big-leaved multi-stemmed shrub carrying cream cup flowers.
  magnolia: { hue: 110, sat: 48, light: 27, leafScale: 1.5, leafAspect: 0.46, leaves: 9, bloom: { hue: 48, sat: 40, light: 88, ratio: 0.2, size: 1.7 },
    crown: [0.52, 0.36, 0.52], centre: 0.56, base: 0.2, trunk: 0.03, tint: 0xa8d060 },
  // Polylepis, the queñua: gnarled and twisted, shaggy red bark, tiny dark leaves -- the
  // highest-growing tree in the world, and it looks like it has had to work for it.
  polylepis: { hue: 96, sat: 34, light: 25, leafScale: 0.5, leaves: 22, crown: [0.56, 0.3, 0.56], centre: 0.64, base: 0.34, trunk: 0.055,
    wander: 0.32, bark: 0xc8744e, barkGain: 1.5 },
  bramble: { hue: 108, sat: 44, light: 27, leafScale: 0.7, leaves: 16, bloom: { hue: 330, sat: 30, light: 88, ratio: 0.08, size: 0.5 } },
  hedge: { hue: 112, sat: 46, light: 25, leafScale: 0.5, leaves: 24 },
  // TURKLE STREET -- the trees of an eastern Kansas town in the first week of October, when
  // the hackberries have gone olive, the elms are still green and the maples have started.
  // A town on the plains is a grove seen from the air, and what a student sees down any
  // street here is a tunnel of these four, so they carry the world as much as the houses do.
  //
  // A hackberry is the one that matters: a short trunk, a crown twice as wide as it is deep,
  // and enough of it to shade a whole front lawn. Its bark is the pale grey-brown that gives
  // it away, and it is warty rather than furrowed, which is why `barkGain` lifts it.
  hackberry: { hue: 88, sat: 40, light: 33, crown: [0.52, 0.34, 0.5], centre: 0.62, base: 0.34, trunk: 0.042,
    wander: 0.1, bark: 0x9c9084, barkGain: 1.12, leafScale: 0.8, leaves: 18, tint: 0xc8d878 },
  // American elm: the vase. Narrow at the fork, arching hard outward, a crown like a
  // fountain. Its whole identity is that every limb leaves the trunk at the same height.
  americanElm: { hue: 94, sat: 44, light: 31, crown: [0.5, 0.3, 0.48], centre: 0.7, base: 0.42, trunk: 0.04,
    wander: 0.05, bark: 0x8a8076, leafScale: 0.85, leaves: 18 },
  // Pin oak: a straight central leader all the way up with short branches off it, wider at
  // the bottom than the top -- the opposite of everything else on the street.
  pinOak: { hue: 102, sat: 40, light: 27, crown: [0.34, 0.42, 0.33], centre: 0.55, base: 0.2, trunk: 0.05,
    wander: 0.03, bark: 0x7d7468, leafScale: 0.9 },
  silverMaple: { hue: 70, sat: 54, light: 39, shape: 'maple', crown: [0.46, 0.36, 0.44], centre: 0.6, base: 0.3,
    trunk: 0.044, wander: 0.09, hueSpread: 24, bark: 0x8e857a, tint: 0xe8e070 },
  kansasGold: { hue: 40, sat: 70, light: 45, shape: 'maple', crown: [0.46, 0.34, 0.44], centre: 0.6, base: 0.32,
    trunk: 0.042, wander: 0.09, hueSpread: 30, bark: 0x8e857a, tint: 0xffc070 },
  conifer: { hue: 128, sat: 38, light: 24, tex: 'conifer' },
  araucaria: { hue: 118, sat: 40, light: 22, tex: 'araucaria' },
  fern: { hue: 104, sat: 56, light: 30, tex: 'fern' },
  // Last year's fronds, dead and hanging. A species of its own rather than a recoloured clone:
  // cloning a PBRCustomMaterial drops its shader hooks, the clone never compiles, and one
  // material that is never ready holds the WHOLE scene's isReady() false for good.
  fernDead: { hue: 30, sat: 42, light: 30, tex: 'fern', tint: 0xc89a5a },
  cycad: { hue: 122, sat: 46, light: 24, tex: 'cycad' },
  horsetail: { hue: 96, sat: 46, light: 32, tex: 'horsetail' },
};
const PALETTES = SPECIES;

const foliageMaterials = new Map();
function foliageMaterial(kit, kind) {
  if (foliageMaterials.has(kind)) return foliageMaterials.get(kind);
  const scene = kit.scene;
  const tex = new DynamicTexture(`foliage-${kind}`, foliageCanvas(kind, PALETTES[kind]), scene, true);
  tex.hasAlpha = true;
  tex.anisotropicFilteringLevel = 8;
  tex.update(true);
  const mat = new PBRCustomMaterial(`foliage-${kind}`, scene);
  mat.albedoTexture = tex;
  mat.useAlphaFromAlbedoTexture = true;
  mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.38;
  // A crown is thousands of overlapping alpha-tested cards, and without this every one of
  // them runs the full PBR + translucency + cascaded-shadow fragment shader before losing the
  // depth test. A depth pre-pass lays the crown's depth down first with a trivial shader, so
  // the expensive pass shades each pixel exactly once. Measured, it is the difference between
  // a forest at 28fps and one at 60.
  mat.needDepthPrePass = true;
  mat.backFaceCulling = false;
  mat.twoSidedLighting = false; // normals are already bent outward; flipping them undoes that
  mat.metallic = 0;
  mat.roughness = 0.62;
  mat.albedoColor = new Color3(1.15, 1.15, 1.05);
  mat.environmentIntensity = 0.85;
  mat.subSurface.isTranslucencyEnabled = true;
  mat.subSurface.translucencyIntensity = 0.75;
  mat.subSurface.tintColor = linear(PALETTES[kind].tint ?? 0xb8e05a);
  mat.AddUniform('windTime', 'float', 0);
  mat.AddUniform('windStrength', 'float', 1);
  mat.Vertex_After_WorldPosComputed(`
    float wH = clamp((worldPos.y - finalWorld[3].y) / 22.0, 0.0, 1.0);
    float wPh = worldPos.x * 0.11 + worldPos.z * 0.13;
    float wGust = 0.6 + 0.4 * sin(windTime * 0.31 + wPh * 0.2);
    float wA = windStrength * wH * wH * wGust;
    worldPos.x += (sin(windTime * 1.1 + wPh) * 0.42 + sin(windTime * 4.3 + wPh * 3.1 + worldPos.y * 0.9) * 0.07) * wA;
    worldPos.z += (cos(windTime * 0.9 + wPh * 1.3) * 0.34 + cos(windTime * 3.9 + wPh * 2.7 + worldPos.y * 1.1) * 0.07) * wA;
    worldPos.y += sin(windTime * 3.1 + wPh * 4.0 + worldPos.x) * 0.05 * wA;
  `);
  mat.onBindObservable.add(() => {
    const e = mat.getEffect();
    if (e) { e.setFloat('windTime', windTime); e.setFloat('windStrength', windUniforms.strength); }
  });
  mat.metadata = { keepUV: true };
  foliageMaterials.set(kind, mat);
  return mat;
}

// ---- card accumulation ------------------------------------------------------------------
class Cards {
  constructor() { this.p = []; this.n = []; this.uv = []; this.idx = []; }

  // A quad centred at `c`, spanned by half-vectors `u` (width) and `v` (height), shaded with
  // normal `nrm`. UVs run the full texture, v=0 at the -v edge (the twig end).
  quad(c, u, v, nrm, uvBox = [0, 0, 1, 1]) {
    const b = this.p.length / 3;
    const pts = [c.subtract(u).subtract(v), c.add(u).subtract(v), c.add(u).add(v), c.subtract(u).add(v)];
    for (const q of pts) { this.p.push(q.x, q.y, q.z); this.n.push(nrm.x, nrm.y, nrm.z); }
    const [u0, v0, u1, v1] = uvBox;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }

  // A RIBBON: a strip through `rows`, each { centre, side (half-width vector), normal, v }.
  // Texture u runs across the strip and v along it, so a frond painted up a tall canvas lies
  // along the ribbon. `keel` lifts both edges to fold the strip into a shallow V, which is what
  // stops a frond reading as a flat paper cut-out from every angle but one.
  ribbon(rows, keel = 0.22) {
    const b = this.p.length / 3;
    for (const r of rows) {
      const lift = r.normal.scale(r.side.length() * keel);
      const l = r.centre.subtract(r.side).add(lift); const c = r.centre; const rr = r.centre.add(r.side).add(lift);
      for (const [q, u] of [[l, 0], [c, 0.5], [rr, 1]]) { this.p.push(q.x, q.y, q.z); this.n.push(r.normal.x, r.normal.y, r.normal.z); this.uv.push(u, r.v); }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = b + i * 3; const d = a + 3;
      this.idx.push(a, a + 1, d + 1, a, d + 1, d, a + 1, a + 2, d + 2, a + 1, d + 2, d + 1);
    }
  }

  toMesh(name, scene) {
    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.p; vd.normals = this.n; vd.uvs = this.uv; vd.indices = this.idx;
    vd.applyToMesh(mesh);
    return mesh;
  }
}

function randomUnit(rand) {
  const y = rand() * 2 - 1; const a = rand() * Math.PI * 2; const r = Math.sqrt(1 - y * y);
  return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
}

function cluster(cards, rand, centre, radius, crownCentre, count, cardSize) {
  for (let i = 0; i < count; i++) {
    const off = randomUnit(rand).scale(radius * Math.cbrt(rand()));
    off.y *= 0.75;
    const c = centre.add(off);
    // The card's "up" (twig -> leaf tips) points roughly away from the crown centre, so
    // leaves hang outward; its plane is then spun at random about that axis.
    const out = c.subtract(crownCentre).normalize();
    const up = out.add(randomUnit(rand).scale(0.8)).add(new Vector3(0, 0.25, 0)).normalize();
    let side = Vector3.Cross(up, randomUnit(rand)).normalize();
    if (!Number.isFinite(side.x) || side.lengthSquared() < 0.5) side = Vector3.Cross(up, new Vector3(1, 0, 0)).normalize();
    const s = cardSize * (0.75 + rand() * 0.5);
    const nrm = out.scale(0.8).add(new Vector3(0, 0.35, 0)).add(Vector3.Cross(side, up).scale(0.15)).normalize();
    cards.quad(c, side.scale(s * 0.5), up.scale(s * 0.5), nrm);
  }
}

// ---- species ------------------------------------------------------------------------------
function broadleaf(kit, { height, seed, kind }, lod = false) {
  const rand = seededRandom(seed * 31 + 7);
  // The far LOD is the SAME tree from the same seed -- same skeleton, same crown -- with a
  // quarter of the cards, each drawn larger, and no twigs. The swap is invisible at the
  // distance it happens because the silhouette does not change.
  const D = lod ? 0.3 : (kit.detail ?? 1);
  const H = height;
  const sp = SPECIES[kind];
  const bark = kit.mat('Bark012', { tint: sp.bark ?? (kind === 'flowering' ? 0x9a8f86 : 0xb09a84), gain: sp.barkGain ?? 1, tile: 2.6, bump: 1.4 });
  const b = kit.builder(`tree-${kind}`);
  const cards = new Cards();
  const r0 = H * (sp.trunk ?? (kind === 'flowering' ? 0.03 : 0.036));
  const crownBase = H * (sp.base ?? (kind === 'flowering' ? 0.3 : 0.36));
  const crownCentre = new Vector3(0, H * (sp.centre ?? 0.66), 0);
  const cr = sp.crown ?? [0.38, 0.31, 0.38];
  const crownR = [H * cr[0], H * cr[1], H * cr[2]];
  const wander = sp.wander ?? 0.06;

  // Trunk and leader, with a root flare and a little wander.
  const lean = [(rand() - 0.5) * H * wander, (rand() - 0.5) * H * wander];
  const trunkPts = kit.curve([
    [0, -0.4, 0], [lean[0] * 0.2, H * 0.2, lean[1] * 0.2], [lean[0] * 0.7, H * 0.45, lean[1] * 0.7], [lean[0], H * 0.68, lean[1]],
    [lean[0] * 1.1 + (rand() - 0.5), H * 0.86, lean[1] * 1.1],
  ], 14);
  const trunkR = trunkPts.map((_, i) => {
    const t = i / (trunkPts.length - 1);
    return r0 * (1 - t * 0.88) * (1 + Math.exp(-t * 14) * 0.9);
  });
  b.add(kit.tube(trunkPts, trunkR, { sides: lod ? 6 : 16, tile: 2.6 }), bark);

  const tips = [];
  const limbs = 8 + Math.floor(rand() * 4);
  for (let i = 0; i < limbs; i++) {
    const t = 0.34 + (i / limbs) * 0.46 + rand() * 0.04;
    const at = trunkPts[Math.floor(t * (trunkPts.length - 1))];
    const az = (i / limbs) * Math.PI * 2 * 1.618 + rand() * 0.7;
    const len = H * (0.34 - (t - 0.34) * 0.32) * (0.85 + rand() * 0.3) * (cr[0] / 0.38);
    const rise = 0.35 + rand() * 0.35 + (t - 0.34) * 0.9;
    const dir = new Vector3(Math.cos(az), rise, Math.sin(az)).normalize();
    const mid = at.add(dir.scale(len * 0.55)).add(new Vector3(0, -len * 0.05, 0));
    const end = at.add(dir.scale(len)).add(new Vector3(0, len * 0.18, 0));
    const pts = kit.curve([at, at.add(dir.scale(len * 0.25)), mid, end], lod ? 4 : 7);
    const lr = r0 * (0.42 - (t - 0.34) * 0.3);
    b.add(kit.tube(pts, pts.map((_, k) => lr * (1 - (k / (pts.length - 1)) * 0.82)), { sides: lod ? 4 : 8, tile: 2.6 }), bark);
    tips.push(end, mid);
    // secondary branches
    const kids = 3 + Math.floor(rand() * 2);
    for (let k = 0; k < kids; k++) {
      const from = pts[Math.min(pts.length - 1, 2 + Math.floor(rand() * (pts.length - 3)))];
      const a2 = az + (rand() - 0.5) * 2.2;
      const d2 = new Vector3(Math.cos(a2), 0.45 + rand() * 0.5, Math.sin(a2)).normalize();
      const l2 = len * (0.4 + rand() * 0.25);
      const e2 = from.add(d2.scale(l2));
      const p2 = kit.curve([from, from.add(d2.scale(l2 * 0.5)).add(new Vector3(0, -l2 * 0.04, 0)), e2], 5);
      if (!lod) b.add(kit.tube(p2, p2.map((_, q) => lr * 0.45 * (1 - (q / (p2.length - 1)) * 0.85)), { sides: 6, tile: 2.6 }), bark);
      tips.push(e2);
      // twigs: the third order of branching, which is what a winter tree is mostly made of
      for (let w = 0; w < 2; w++) {
        const tf = p2[2 + Math.floor(rand() * 3)];
        const a3 = a2 + (rand() - 0.5) * 2.6;
        const d3 = new Vector3(Math.cos(a3), 0.3 + rand() * 0.7, Math.sin(a3)).normalize();
        const e3 = tf.add(d3.scale(l2 * (0.35 + rand() * 0.3)));
        if (!lod) b.add(kit.tube([tf, tf.add(e3).scale(0.5).add(new Vector3(0, -0.1, 0)), e3], [lr * 0.16, lr * 0.1, lr * 0.03], { sides: 4, tile: 2.6 }), bark);
        tips.push(e3);
      }
    }
  }
  tips.push(trunkPts[trunkPts.length - 1]);

  const cardSize = H * (kind === 'flowering' ? 0.15 : 0.135) * (sp.cardScale ?? 1) * (lod ? 1.7 : 1);
  for (const tip of tips) cluster(cards, rand, tip, H * 0.1, crownCentre, Math.max(2, Math.round(16 * D)), cardSize);
  // A shell of clusters over the crown's ellipsoid guarantees a closed silhouette; the
  // branch-tip clusters above give it structure inside.
  const shell = 90;
  for (let i = 0; i < shell; i++) {
    const d = randomUnit(rand);
    if (d.y < -0.45) d.y = -d.y * 0.4;
    const c = crownCentre.add(new Vector3(d.x * crownR[0], d.y * crownR[1], d.z * crownR[2]).scale(0.82 + rand() * 0.2));
    if (c.y < crownBase) c.y = crownBase + rand() * H * 0.05;
    cluster(cards, rand, c, H * 0.09, crownCentre, Math.max(2, Math.round(11 * D)), cardSize);
  }

  const root = b.finish();
  const foliage = cards.toMesh(`tree-${kind}:foliage`, kit.scene);
  foliage.material = foliageMaterial(kit, kind);
  foliage.parent = root;
  foliage.receiveShadows = true;
  root.metadata.casters.push(foliage);
  if (!lod) root.metadata.lod = broadleaf(kit, { height, seed, kind }, true);
  return root;
}

function conifer(kit, { height, seed }, lod = false) {
  const rand = seededRandom(seed * 17 + 3);
  const H = height;
  const bark = kit.mat('Bark012', { tint: 0x8a6f5a, tile: 2.4, bump: 1.4 });
  const b = kit.builder('tree-conifer');
  const r0 = H * 0.028;
  const trunkPts = kit.curve([[0, -0.4, 0], [0, H * 0.3, 0], [(rand() - 0.5) * 0.5, H * 0.7, (rand() - 0.5) * 0.5], [0, H * 0.99, 0]], 12);
  b.add(kit.tube(trunkPts, trunkPts.map((_, i) => { const t = i / (trunkPts.length - 1); return r0 * (1 - t * 0.94) * (1 + Math.exp(-t * 16) * 0.8); }), { sides: lod ? 6 : 16, tile: 2.4 }), bark);

  const cards = new Cards();
  const whorls = Math.round(H * (lod ? 0.4 : 1.15));
  const base = H * 0.16;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = base + (H - base) * Math.pow(t, 0.92) * 0.97;
    const reach = H * 0.27 * Math.pow(1 - t, 0.85) + H * 0.025;
    const count = lod ? 5 : t > 0.85 ? 6 : 11;
    for (let k = 0; k < count; k++) {
      const az = (k / count) * Math.PI * 2 + w * 0.61 + rand() * 0.3;
      const droop = 0.2 + (1 - t) * 0.32 + rand() * 0.1;
      const dir = new Vector3(Math.cos(az), -droop, Math.sin(az)).normalize();
      const len = reach * (0.85 + rand() * 0.3);
      const centre = new Vector3(0, y, 0).add(dir.scale(len * 0.5));
      const side = Vector3.Cross(dir, Vector3.Up()).normalize();
      const upn = Vector3.Cross(side, dir).normalize();
      const out = new Vector3(Math.cos(az), 0.55, Math.sin(az)).normalize();
      // texture v runs along the branch: v=0 at the trunk
      cards.quad(centre, side.scale(len * 0.36), dir.scale(len * 0.5), out.add(upn.scale(0.5)).normalize());
      cards.quad(centre.add(upn.scale(-len * 0.05)), upn.scale(len * 0.2), dir.scale(len * 0.5), out);
    }
  }
  const root = b.finish();
  const foliage = cards.toMesh('tree-conifer:foliage', kit.scene);
  foliage.material = foliageMaterial(kit, 'conifer');
  foliage.parent = root;
  foliage.receiveShadows = true;
  root.metadata.casters.push(foliage);
  if (!lod) root.metadata.lod = conifer(kit, { height, seed }, true);
  return root;
}

export function shadeTree(kit, { height = 22, seed = 4 } = {}) { return broadleaf(kit, { height, seed, kind: 'shade' }); }
export function mapleTree(kit, { height = 22, seed = 4 } = {}) { return broadleaf(kit, { height, seed, kind: 'maple' }); }
export function floweringTree(kit, { height = 16, seed = 5 } = {}) { return broadleaf(kit, { height, seed, kind: 'flowering' }); }
export function autumnMapleTree(kit, { height = 22, seed = 4 } = {}) { return broadleaf(kit, { height, seed, kind: 'mapleAutumn' }); }
export function goldMapleTree(kit, { height = 22, seed = 4 } = {}) { return broadleaf(kit, { height, seed, kind: 'mapleGold' }); }
export function hawthornTree(kit, { height = 22, seed = 61 } = {}) { return broadleaf(kit, { height, seed, kind: 'hawthorn' }); }
export function ginkgoTree(kit, { height = 26, seed = 7 } = {}) { return broadleaf(kit, { height, seed, kind: 'ginkgo' }); }
export function magnoliaShrub(kit, { height = 9, seed = 17 } = {}) { return broadleaf(kit, { height, seed, kind: 'magnolia' }); }
export function polylepisTree(kit, { height = 13, seed = 53 } = {}) { return broadleaf(kit, { height, seed, kind: 'polylepis' }); }
export function coniferTree(kit, { height = 24, seed = 2 } = {}) { return conifer(kit, { height, seed }); }
// Turkle Street's four species behind one entry point, because the record carries the kind.
export function turkleTree(kit, { height = 38, seed = 51, kind = 'hackberry' } = {}) {
  return broadleaf(kit, { height, seed, kind: SPECIES[kind] ? kind : 'hackberry' });
}

// A shrub: foliage clusters with no visible skeleton, for planters and hedging.
export function shrub(kit, { radius = 1.6, seed = 3, kind = 'shade' } = {}) {
  const rand = seededRandom(seed * 13 + 1);
  const cards = new Cards();
  const centre = new Vector3(0, radius * 0.75, 0);
  for (let i = 0; i < 16; i++) {
    const d = randomUnit(rand); d.y = Math.abs(d.y) * 0.8;
    cluster(cards, rand, centre.add(d.scale(radius * 0.7)), radius * 0.35, centre, 6, radius * 0.75);
  }
  const root = new TransformNode('shrub', kit.scene);
  const foliage = cards.toMesh('shrub:foliage', kit.scene);
  foliage.material = foliageMaterial(kit, kind);
  foliage.parent = root;
  foliage.receiveShadows = true;
  root.metadata = { casters: [foliage] };
  return root;
}

export { Cards, cluster, randomUnit, foliageMaterial, SPECIES };
