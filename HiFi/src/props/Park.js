// The Park's own props, rebuilt at HiFi fidelity: real timber, stone and iron instead of
// vertex-coloured solids, chamfered edges, glazed windows that light up at dusk, and water
// that reflects the sky.

import { Mesh, VertexData, Vector3, PBRMaterial, Color3 } from '@babylonjs/core';
import { seededRandom, linear } from './Kit.js';
import { cardCanvas } from './Common.js';

// ---- shared building helpers -----------------------------------------------------------------
// A gabled roof over a w x d footprint, ridge along X. Returns nothing; adds to the builder.
function gableRoof(kit, b, mat, { w, d, eaveY, rise, overhang = 1.4, thickness = 0.35, pos = [0, 0, 0] }) {
  const run = d / 2 + overhang;
  const pitch = Math.atan2(rise, d / 2);
  const slope = run / Math.cos(pitch);
  for (const side of [-1, 1]) {
    const cz = side * (run / 2);
    const cy = eaveY + rise - (run / 2) * Math.tan(pitch) + thickness * 0.5;
    b.add(kit.box(w + overhang * 2, thickness, slope, { bevel: 0.04 }), mat, {
      pos: [pos[0], pos[1] + cy, pos[2] + cz], rot: [side * pitch, 0, 0],
    });
  }
  // ridge cap
  b.add(kit.box(w + overhang * 2 + 0.2, 0.3, 0.7, { bevel: 0.08 }), mat, { pos: [pos[0], pos[1] + eaveY + rise + thickness * 0.75, pos[2]] });
}

function windowUnit(kit, b, { x, y, z, w = 3, h = 4, ry = 0, frame, glass }) {
  const c = Math.cos(ry); const s = Math.sin(ry);
  const at = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  b.add(kit.box(w, h, 0.08), glass, { pos: at(0, 0, 0.1), rot: [0, ry, 0] });
  b.add(kit.box(w + 0.5, 0.28, 0.3, { bevel: 0.03 }), frame, { pos: at(0, h / 2 + 0.12, 0.18), rot: [0, ry, 0] });
  b.add(kit.box(w + 0.7, 0.22, 0.42, { bevel: 0.03 }), frame, { pos: at(0, -h / 2 - 0.1, 0.22), rot: [0, ry, 0] });
  for (const sx of [-1, 1]) b.add(kit.box(0.26, h, 0.3, { bevel: 0.03 }), frame, { pos: at(sx * (w / 2 + 0.12), 0, 0.18), rot: [0, ry, 0] });
  b.add(kit.box(0.12, h, 0.16, { bevel: 0.02 }), frame, { pos: at(0, 0, 0.16), rot: [0, ry, 0] });
  b.add(kit.box(w, 0.12, 0.16, { bevel: 0.02 }), frame, { pos: at(0, h * 0.18, 0.16), rot: [0, ry, 0] });
}

// Window glass that glows warm after dark. One shared material per building kind.
function litGlass(kit, key) {
  const m = kit.flat(0x24313a, { rough: 0.08, metal: 0.0, emissive: 0xffc878, emissiveIntensity: 0.0001 });
  const glow = linear(0xffc878);
  return { m, night: (dusk) => { m.emissiveColor = glow.scale(0.002 + dusk * 2.4); }, key };
}

// ---- nature centre ------------------------------------------------------------------------------
export function natureCentre(kit, { width = 30, depth = 18, wallHeight = 9 } = {}) {
  const b = kit.builder('nature-centre');
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 7 });
  const planks = kit.mat('Planks012', { tint: 0xf0d2ac, tile: 5 });
  const timber = kit.mat('Wood049', { tint: 0xd9b38c, tile: 3 });
  const roof = kit.mat('RoofingTiles013A', { tint: 0x9fb5aa, gain: 2.6, tile: 4.5 });
  const deck = kit.mat('Planks012', { tint: 0xe8d6bc, tile: 4 });
  const glass = litGlass(kit, 'nc');
  const W = width; const D = depth; const H = wallHeight;

  // stone base course, then plank walls
  b.add(kit.box(W + 0.6, 2.4, D + 0.6, { bevel: 0.1 }), stone, { pos: [0, 1.2, 0] });
  b.add(kit.box(W, H - 2.4, D, { bevel: 0.04 }), planks, { pos: [0, 2.4 + (H - 2.4) / 2, 0] });
  // corner posts and top plate
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(kit.box(0.7, H, 0.7, { bevel: 0.05 }), timber, { pos: [sx * W / 2, H / 2, sz * D / 2] });
  b.add(kit.box(W + 0.8, 0.5, D + 0.8, { bevel: 0.05 }), timber, { pos: [0, H + 0.1, 0] });
  // gable ends
  const rise = 5.2;
  for (const sx of [-1, 1]) {
    b.add(kit.prism([[-D / 2, 0], [D / 2, 0], [0, rise]], 0.5), planks, { pos: [sx * (W / 2 - 0.25), H + 0.3, 0], rot: [0, Math.PI / 2, 0] });
  }
  gableRoof(kit, b, roof, { w: W, d: D, eaveY: H + 0.2, rise, overhang: 2.6 });
  // rafters showing under the eave
  for (let i = 0; i <= 10; i++) {
    const x = -W / 2 + (i / 10) * W;
    b.add(kit.box(0.3, 0.4, 3.0, { bevel: 0.03 }), timber, { pos: [x, H + 0.05, D / 2 + 1.2], rot: [-0.52, 0, 0] });
    b.add(kit.box(0.3, 0.4, 3.0, { bevel: 0.03 }), timber, { pos: [x, H + 0.05, -D / 2 - 1.2], rot: [0.52, 0, 0] });
  }
  // porch across the front (+Z): deck, posts, lean-to roof
  const PD = 7;
  b.add(kit.box(W * 0.62, 0.5, PD, { bevel: 0.05 }), deck, { pos: [0, 0.25, D / 2 + PD / 2] });
  b.add(kit.box(W * 0.3, 0.25, 1.4, { bevel: 0.04 }), deck, { pos: [0, 0.12, D / 2 + PD + 0.6] });
  for (let i = 0; i < 5; i++) {
    const x = -W * 0.29 + (i / 4) * W * 0.58;
    b.add(kit.box(0.55, H - 1.2, 0.55, { bevel: 0.05 }), timber, { pos: [x, (H - 1.2) / 2 + 0.5, D / 2 + PD - 0.5] });
    b.add(kit.box(0.9, 0.35, 0.9, { bevel: 0.05 }), stone, { pos: [x, 0.62, D / 2 + PD - 0.5] });
  }
  b.add(kit.box(W * 0.64, 0.45, 0.5, { bevel: 0.04 }), timber, { pos: [0, H - 0.5, D / 2 + PD - 0.5] });
  b.add(kit.box(W * 0.7, 0.32, PD + 2.2, { bevel: 0.04 }), roof, { pos: [0, H + 0.35, D / 2 + PD / 2 + 0.3], rot: [0.2, 0, 0] });
  // entrance: a dark reveal, double doors with glazing, transom
  const door = kit.mat('Wood049', { tint: 0x9a7356, tile: 3 });
  b.add(kit.box(7.4, 8, 0.3), kit.flat(0x120e0a, { rough: 0.9 }), { pos: [0, 4.2, D / 2 + 0.02] });
  for (const sx of [-1, 1]) {
    b.add(kit.box(3.3, 6.6, 0.22, { bevel: 0.04 }), door, { pos: [sx * 1.72, 3.55, D / 2 + 0.2] });
    b.add(kit.box(2.2, 3.0, 0.1), glass.m, { pos: [sx * 1.72, 4.7, D / 2 + 0.32] });
    b.add(kit.cyl(0.05, 0.05, 1.1, { sides: 8 }), kit.flat(0xc9a15a, { rough: 0.25, metal: 1 }), { pos: [sx * 0.35, 3.4, D / 2 + 0.42] });
  }
  b.add(kit.box(7.0, 1.0, 0.1), glass.m, { pos: [0, 7.55, D / 2 + 0.3] });
  b.add(kit.box(7.8, 0.4, 0.5, { bevel: 0.04 }), timber, { pos: [0, 8.3, D / 2 + 0.3] });
  for (const sx of [-1, 1]) b.add(kit.box(0.4, 8.2, 0.5, { bevel: 0.04 }), timber, { pos: [sx * 3.9, 4.1, D / 2 + 0.3] });
  // windows: front flanks, sides, rear -- on the OUTER face of each wall
  for (const x of [-10.5, -6.5, 6.5, 10.5]) windowUnit(kit, b, { x, y: 5.6, z: D / 2, frame: timber, glass: glass.m });
  for (const x of [-10, -5, 0, 5, 10]) windowUnit(kit, b, { x, y: 5.6, z: -D / 2, ry: Math.PI, frame: timber, glass: glass.m });
  for (const z of [-4.5, 4.5]) {
    windowUnit(kit, b, { x: W / 2, y: 5.6, z, ry: Math.PI / 2, frame: timber, glass: glass.m });
    windowUnit(kit, b, { x: -W / 2, y: 5.6, z, ry: -Math.PI / 2, frame: timber, glass: glass.m });
  }
  // fieldstone chimney
  b.add(kit.box(3.2, H + rise + 3, 3.2, { bevel: 0.15 }), stone, { pos: [W / 2 - 5, (H + rise + 3) / 2, -2] });
  b.add(kit.box(3.8, 0.5, 3.8, { bevel: 0.1 }), stone, { pos: [W / 2 - 5, H + rise + 3.1, -2] });
  // sign board over the porch
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#23402c'; ctx.fillRect(0, 0, 1024, 160);
  ctx.strokeStyle = '#e8d8a8'; ctx.lineWidth = 6; ctx.strokeRect(10, 10, 1004, 140);
  ctx.fillStyle = '#f7ecd0'; ctx.font = '700 84px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('NATURE  CENTRE', 512, 84);
  b.add(kit.box(12.4, 2.0, 0.2, { bevel: 0.04 }), timber, { pos: [0, H + 1.9, D / 2 + PD + 0.5] });
  b.add(kit.plane(12, 1.7), kit.canvasMat('nc-sign', c, { emissive: 0.25 }), { pos: [0, H + 1.9, D / 2 + PD + 0.62] });
  const root = b.finish();
  root.metadata.nightLights = [glass.night];
  root.metadata.lights = [{ pos: [0, H - 1.5, D / 2 + PD / 2], color: 0xffcf8a, intensity: 80, range: 34 }];
  root.metadata.footprint = { w: W + 7, d: D + PD + 7, cz: PD / 2 };
  return root;
}

// ---- park gate -------------------------------------------------------------------------------
export function parkGate(kit, { name = 'FRANKLIN PARK', opening = 16, pierHeight = 11 } = {}) {
  const b = kit.builder('park-gate');
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 6 });
  const cap = kit.mat('Concrete034', { tint: 0xe6dfd0, tile: 5 });
  const iron = kit.flat(0x121518, { rough: 0.4, metal: 0.92 });
  const H = pierHeight;
  for (const sx of [-1, 1]) {
    const x = sx * (opening / 2 + 1.7);
    b.add(kit.box(4.0, 1.2, 4.0, { bevel: 0.12 }), stone, { pos: [x, 0.6, 0] });
    b.add(kit.box(3.4, H - 1.2, 3.4, { bevel: 0.1 }), stone, { pos: [x, 1.2 + (H - 1.2) / 2, 0] });
    b.add(kit.box(4.2, 0.6, 4.2, { bevel: 0.12 }), cap, { pos: [x, H + 0.3, 0] });
    b.add(kit.lathe([[0, 0], [1.5, 0], [1.2, 0.5], [0.5, 1.0], [0.75, 1.6], [0.85, 2.1], [0.5, 2.7], [0, 2.9]], { sides: 28 }), cap, { pos: [x, H + 0.6, 0] });
    // low wing walls curving away
    for (let i = 1; i <= 4; i++) {
      const wx = x + sx * (1.6 + i * 3.2);
      b.add(kit.box(3.3, 4.2 - i * 0.35, 1.6, { bevel: 0.1 }), stone, { pos: [wx, (4.2 - i * 0.35) / 2, i * i * 0.35], rot: [0, -sx * i * 0.16, 0] });
      b.add(kit.box(3.5, 0.35, 1.9, { bevel: 0.08 }), cap, { pos: [wx, 4.2 - i * 0.35 + 0.17, i * i * 0.35], rot: [0, -sx * i * 0.16, 0] });
    }
  }
  // wrought-iron overthrow arch carrying the name
  const archPts = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI - (i / 24) * Math.PI;
    archPts.push([Math.cos(a) * (opening / 2 + 0.2), H - 1.2 + Math.sin(a) * 4.2, 0]);
  }
  b.add(kit.tube(archPts, 0.13, { sides: 10 }), iron);
  b.add(kit.tube(archPts.map(([x, y, z]) => [x * 0.9, (y - (H - 1.2)) * 0.74 + H - 1.2, z]), 0.09, { sides: 8 }), iron);
  for (let i = 1; i < 24; i++) {
    const a = Math.PI - (i / 24) * Math.PI;
    const o = [Math.cos(a) * (opening / 2 + 0.2), H - 1.2 + Math.sin(a) * 4.2, 0];
    const n = [o[0] * 0.9, (o[1] - (H - 1.2)) * 0.74 + H - 1.2, 0];
    b.add(kit.tube([o, n], 0.05, { sides: 6 }), iron);
  }
  const c = document.createElement('canvas'); c.width = 1024; c.height = 150;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 150);
  ctx.fillStyle = '#d9b45a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let fs = 110; do { ctx.font = `700 ${fs}px Georgia, serif`; fs -= 4; } while (ctx.measureText(name).width > 980);
  ctx.fillText(name, 512, 78);
  const letters = kit.canvasMat(`gate-${name}`, c, { emissive: 0.3, alpha: true });
  letters.backFaceCulling = false;
  b.add(kit.plane(opening * 0.78, opening * 0.78 * (150 / 1024)), letters, { pos: [0, H + 0.4, 0] });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- paving --------------------------------------------------------------------------------------
export function pathStones(kit, { length = 14, width = 5, seed = 17 } = {}) {
  const b = kit.builder('path-stones');
  const flag = kit.mat('PavingStones070', { tint: 0xd8d2c6, tile: 4.5 });
  const rand = seededRandom(seed);
  // Irregular flags laid in rough courses, each one slightly tilted and proud of the gravel.
  let z = -length / 2;
  while (z < length / 2 - 0.4) {
    const rowD = 1.5 + rand() * 1.0;
    let x = -width / 2;
    while (x < width / 2 - 0.3) {
      const w = Math.min(width / 2 - x, 1.3 + rand() * 1.6);
      b.add(kit.box(w - 0.12, 0.22, rowD - 0.12, { bevel: 0.05 }), flag, {
        pos: [x + w / 2, 0.05 + rand() * 0.03, z + rowD / 2], rot: [(rand() - 0.5) * 0.03, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.03],
      });
      x += w;
    }
    z += rowD;
  }
  return b.finish({ castShadows: false });
}

export function stoneSteps(kit, { steps = 9, width = 8, rise = 0.6, tread = 1.3 } = {}) {
  const b = kit.builder('stone-steps');
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 6 });
  for (let i = 0; i < steps; i++) {
    b.add(kit.box(width, rise * (i + 1), tread + 0.1, { bevel: 0.06 }), stone, { pos: [0, (rise * (i + 1)) / 2, -i * tread] });
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < steps; i += 2) {
      b.add(kit.box(1.2, rise * (i + 2) + 1.0, tread * 2 + 0.1, { bevel: 0.08 }), stone, { pos: [sx * (width / 2 + 0.6), (rise * (i + 2) + 1.0) / 2, -(i + 0.5) * tread] });
    }
  }
  return b.finish();
}

// ---- stone arch bridge ------------------------------------------------------------------------------
export function stoneArchBridge(kit, { span = 14, width = 7 } = {}) {
  const b = kit.builder('stone-arch-bridge');
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 6 });
  const cap = kit.mat('Concrete034', { tint: 0xddd5c6, tile: 5 });
  const R = span / 2;
  const deckY = R + 1.6;
  // voussoir ring (a true circle, so every block lies flush) on both faces
  const N = 17;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI;
      b.add(kit.box(1.25, (Math.PI * (R + 0.6)) / N + 0.04, 0.9, { bevel: 0.06 }), stone, {
        pos: [Math.cos(a) * (R + 0.62), Math.sin(a) * (R + 0.62), sz * (width / 2 - 0.3)], rot: [0, 0, a],
      });
    }
  }
  // barrel: soffit strips spanning the width
  for (let i = 0; i < N; i++) {
    const a = (i + 0.5) / N * Math.PI;
    b.add(kit.box(0.5, (Math.PI * R) / N + 0.06, width - 1.2), stone, { pos: [Math.cos(a) * (R + 0.25), Math.sin(a) * (R + 0.25), 0], rot: [0, 0, a] });
  }
  // spandrels + abutments, stepped to follow the arch
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const x0 = R * (0.25 + k * 0.16);
      const yArch = Math.sqrt(Math.max(0, (R + 1.2) * (R + 1.2) - x0 * x0));
      const h = deckY - yArch;
      if (h <= 0.05) continue;
      b.add(kit.box(R * 0.17, h, width, { bevel: 0.03 }), stone, { pos: [sx * (x0 + R * 0.08), yArch + h / 2, 0] });
    }
    b.add(kit.box(5, deckY, width + 1, { bevel: 0.1 }), stone, { pos: [sx * (R + 3.4), deckY / 2, 0] });
    // approach ramp
    b.add(kit.prism([[0, 0], [9, 0], [0, deckY]], width + 1), stone, { pos: [sx * (R + 5.9), 0, 0], rot: [0, sx > 0 ? 0 : Math.PI, 0] });
  }
  b.add(kit.box(span + 12, 0.5, width + 0.4, { bevel: 0.05 }), cap, { pos: [0, deckY + 0.05, 0] });
  // parapets
  for (const sz of [-1, 1]) {
    b.add(kit.box(span + 12, 2.6, 0.9, { bevel: 0.06 }), stone, { pos: [0, deckY + 1.5, sz * (width / 2 + 0.1)] });
    b.add(kit.box(span + 12.4, 0.35, 1.3, { bevel: 0.08 }), cap, { pos: [0, deckY + 2.95, sz * (width / 2 + 0.1)] });
  }
  return b.finish();
}

// ---- fountain -----------------------------------------------------------------------------------------
export function stoneFountain(kit, { radius = 7 } = {}, world) {
  const b = kit.builder('stone-fountain');
  const stone = kit.mat('Concrete034', { tint: 0xe2dccf, tile: 5 });
  const R = radius;
  b.add(kit.lathe([[0, 0], [R + 0.5, 0], [R + 0.5, 0.35], [R + 0.2, 0.5], [R + 0.2, 1.9], [R + 0.55, 2.1], [R + 0.55, 2.45], [R - 0.35, 2.45], [R - 0.5, 0.7], [0, 0.7]], { sides: 56 }), stone);
  b.add(kit.lathe([[0, 0.7], [1.5, 0.7], [1.2, 1.3], [0.65, 1.8], [0.55, 4.2], [0.9, 4.6], [2.9, 5.2], [3.1, 5.55], [2.7, 5.5], [0.6, 5.0], [0.5, 6.8], [0.8, 7.1], [1.45, 7.45], [1.5, 7.7], [0.4, 7.5], [0.3, 8.4], [0, 8.6]], { sides: 40 }), stone);
  const root = b.finish();
  for (const [r, y] of [[R - 0.4, 2.0], [2.85, 5.42], [1.35, 7.62]]) {
    const w = kit.disc(r, { sides: 48 });
    w.position.y = y; w.material = world.water.material; w.parent = root; w.receiveShadows = true;
  }
  // falling water: translucent sheets from each tier's lip
  const fall = kit.flat(0xdff2ff, { rough: 0.1, alpha: 0.32, emissive: 0xbfe4ff, emissiveIntensity: 0.12, doubleSided: true });
  const sheets = kit.builder('fountain-falls');
  sheets.add(kit.cyl(3.05, 3.2, 3.3, { sides: 40, cap: false }), fall, { pos: [0, 3.8, 0] });
  sheets.add(kit.cyl(1.45, 1.6, 2.0, { sides: 32, cap: false }), fall, { pos: [0, 6.5, 0] });
  sheets.add(kit.cyl(0.08, 0.2, 1.6, { sides: 10, cap: false }), fall, { pos: [0, 9.2, 0] });
  const falls = sheets.finish({ castShadows: false });
  falls.parent = root;
  root.metadata.instanceable = false;
  return root;
}

// ---- pond ---------------------------------------------------------------------------------------------
// The basin itself is carved into the TERRAIN by the layout (see park.js `carves`); this prop
// supplies the water surface, the stone margin, reeds and lily pads.
export function parkPond(kit, { radius = 15, seed = 23 } = {}, world) {
  const rand = seededRandom(seed);
  const b = kit.builder('park-pond');
  const rockMat = kit.mat('Rock030', { tint: 0xf0e8da, gain: 2.0, tile: 6 });
  const reed = kit.flat(0x5d7a2e, { rough: 0.7 });
  const head = kit.flat(0x4a2f1a, { rough: 0.9 });
  const pad = kit.flat(0x3f7a34, { rough: 0.45, doubleSided: true });
  const bloom = kit.flat(0xfdf3f6, { rough: 0.5, emissive: 0xffd9e6, emissiveIntensity: 0.15 });
  const R = radius;
  const waterY = -0.55;
  // margin stones, half sunk, all the way round
  const stones = Math.round(R * (R > 40 ? 2.0 : 3.4));
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + rand() * 0.1;
    const rr = R * (0.97 + rand() * 0.1);
    const s = (0.7 + rand() * 1.1) * (R > 40 ? 1.7 : 1);
    b.add(kit.rock(s, seed + i, { segments: 14, squash: 0.55 }), rockMat, { pos: [Math.cos(a) * rr, waterY + 0.25 + rand() * 0.2, Math.sin(a) * rr], rot: [0, rand() * 6.28, 0] });
  }
  // reed beds in three clumps
  const clumps = R > 40 ? [0.3, 0.9, 1.7, 2.4, 3.3, 3.9, 4.6, 5.4, 5.9] : [0.6, 2.7, 4.4];
  for (const ca of clumps) {
    for (let i = 0; i < (R > 40 ? 40 : 26); i++) {
      const a = ca + (rand() - 0.5) * (R > 40 ? 0.3 : 0.9);
      const rr = R * (R > 40 ? 0.93 + rand() * 0.06 : 0.78 + rand() * 0.17);
      const x = Math.cos(a) * rr; const z = Math.sin(a) * rr;
      const h = 3.2 + rand() * 2.6; const lx = (rand() - 0.5) * 0.9; const lz = (rand() - 0.5) * 0.9;
      b.add(kit.tube(kit.curve([[x, waterY - 0.5, z], [x + lx * 0.3, waterY + h * 0.5, z + lz * 0.3], [x + lx, waterY + h, z + lz]], 6), [0.05, 0.04, 0.03, 0.025, 0.02, 0.015, 0.01], { sides: 5 }), reed);
      if (rand() < 0.45) b.add(kit.sphere(0.11, { segments: 8, sy: 3.4 }), head, { pos: [x + lx * 0.9, waterY + h * 0.92, z + lz * 0.9] });
    }
  }
  // lily pads with the occasional flower
  for (let i = 0; i < (R > 40 ? 160 : 34); i++) {
    const a = rand() * 6.28; const rr = R > 40 ? R * (0.72 + rand() * 0.24) : R * Math.sqrt(rand()) * 0.72;
    const x = Math.cos(a) * rr; const z = Math.sin(a) * rr;
    const s = 0.5 + rand() * 0.55;
    b.add(kit.disc(s, { sides: 16, arc: 0.92 }), pad, { pos: [x, waterY + 0.035, z], rot: [0, rand() * 6.28, 0] });
    if (rand() < 0.3) b.add(kit.sphere(0.2, { segments: 8, sy: 0.7 }), bloom, { pos: [x, waterY + 0.18, z] });
  }
  const root = b.finish();
  const surface = kit.disc(R * 1.06, { sides: 96 });
  surface.position.y = waterY; surface.material = world.water.material; surface.parent = root; surface.receiveShadows = true; surface.isPickable = false;
  root.metadata.instanceable = false;
  return root;
}

// ---- Canada geese -----------------------------------------------------------------------------------------
function goose(kit, b, mats, { x = 0, z = 0, yaw = 0, swim = true, headTurn = 0 }) {
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const at = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
  const y0 = swim ? -0.3 : 1.05;
  const P = (pts) => kit.curve(pts.map(([lx, ly, lz]) => at(lx, ly + y0, lz)), 14);
  // body: a fat tapered sweep, tail up
  b.add(kit.tube(P([[0, 0.85, -1.35], [0, 0.72, -0.9], [0, 0.62, -0.2], [0, 0.72, 0.55], [0, 0.95, 0.95]]), [0.05, 0.3, 0.52, 0.56, 0.5, 0.42, 0.3, 0.2, 0.14, 0.1, 0.08, 0.06, 0.05, 0.04, 0.03], { sides: 16 }), mats.body);
  // pale breast and white under-tail
  b.add(kit.sphere(0.46, { segments: 14, sy: 0.85, sz: 1.1 }), mats.breast, { pos: at(0, 0.62 + y0, 0.55) });
  b.add(kit.sphere(0.3, { segments: 12, sy: 0.7, sz: 1.2 }), mats.white, { pos: at(0, 0.66 + y0, -1.0) });
  // wings folded along the flanks
  for (const sx of [-1, 1]) b.add(kit.sphere(0.5, { segments: 14, sx: 0.34, sy: 0.62, sz: 1.75 }), mats.wing, { pos: at(sx * 0.36, 0.84 + y0, -0.25), rot: [0.1, yaw, sx * 0.2] });
  // long black neck in an S, head, white chinstrap, bill
  const neck = P([[0, 0.9, 0.75], [0, 1.35, 1.0], [0, 1.85, 0.92], [headTurn * 0.2, 2.2, 1.05]]);
  b.add(kit.tube(neck, [0.2, 0.17, 0.15, 0.13, 0.12, 0.115, 0.11, 0.11, 0.11, 0.11, 0.11, 0.115, 0.12, 0.125, 0.13], { sides: 12 }), mats.black);
  const hp = at(headTurn * 0.25, 2.26 + y0, 1.14);
  b.add(kit.sphere(0.17, { segments: 12, sz: 1.35 }), mats.black, { pos: hp, rot: [0, yaw + headTurn, 0] });
  for (const sx of [-1, 1]) b.add(kit.sphere(0.1, { segments: 8, sx: 0.35, sy: 1.0, sz: 0.85 }), mats.white, { pos: at(headTurn * 0.25 + sx * 0.135, 2.2 + y0, 1.1), rot: [0, yaw, 0] });
  b.add(kit.sphere(0.075, { segments: 8, sy: 0.6, sz: 2.4 }), mats.bill, { pos: at(headTurn * 0.3, 2.23 + y0, 1.42), rot: [0, yaw + headTurn, 0] });
  if (!swim) {
    for (const sx of [-1, 1]) {
      b.add(kit.tube([at(sx * 0.2, 0.55 + y0, 0), at(sx * 0.22, 0.02, 0.05)], 0.045, { sides: 6 }), mats.bill);
      b.add(kit.box(0.3, 0.04, 0.42, { bevel: 0.01 }), mats.bill, { pos: at(sx * 0.22, 0.02, 0.2), rot: [0, yaw, 0] });
    }
  }
}

function gooseMats(kit) {
  return {
    body: kit.mat('Ground068', { tint: 0x7a6650, tile: 1.2, bump: 0.6 }),
    wing: kit.mat('Bark012', { tint: 0x6b5842, tile: 1.4, bump: 0.8 }),
    breast: kit.flat(0xcbbfa8, { rough: 0.85 }),
    white: kit.flat(0xf3f0e8, { rough: 0.8 }),
    black: kit.flat(0x0c0c0d, { rough: 0.55 }),
    bill: kit.flat(0x16140f, { rough: 0.5 }),
  };
}

export function pondGeese(kit, { spread = 4.5 } = {}) {
  const b = kit.builder('pond-geese');
  const mats = gooseMats(kit);
  goose(kit, b, mats, { x: -spread / 2, z: 0.4, yaw: 0.25, headTurn: 0.3 });
  goose(kit, b, mats, { x: spread / 2, z: -0.6, yaw: -0.15, headTurn: -0.2 });
  const root = b.finish();
  // They paddle a slow figure on the water: alive without needing a program.
  let t = 0;
  const inner = root.getChildMeshes();
  root.metadata.tick = (dt) => {
    t += dt;
    for (const m of inner) { m.position.x = Math.sin(t * 0.16) * 3.2; m.position.z = Math.sin(t * 0.32) * 1.6; m.position.y = -0.55 + Math.sin(t * 1.3) * 0.015; }
  };
  root.metadata.instanceable = false;
  return root;
}

export function canadaGoose(kit, { pose = 'stand', headTurn = 0 } = {}) {
  const b = kit.builder('canada-goose');
  goose(kit, b, gooseMats(kit), { swim: pose === 'swim', headTurn });
  return b.finish();
}

// ---- bandstand ------------------------------------------------------------------------------------------------
export function bandstand(kit, { radius = 9, postHeight = 9 } = {}) {
  const b = kit.builder('bandstand');
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 6 });
  const deck = kit.mat('Planks012', { tint: 0xeccfa8, tile: 4 });
  const paint = kit.flat(0xf1ece0, { rough: 0.5 });
  // Verdigris copper. NOT metallic: patina is a mineral crust, and as a metal it simply
  // mirrors the sky and the roof comes out blue.
  const roof = kit.mat('Concrete034', { tint: 0x5fae94, gain: 1.15, rough: 0.8, tile: 5 });
  const gold = kit.flat(0xd8ae52, { rough: 0.28, metal: 1 });
  const R = radius; const H = postHeight; const N = 8; const base = 3;
  b.add(kit.cyl(R + 0.4, R + 0.9, base, { sides: N, tile: 6 }), stone, { pos: [0, base / 2, 0], rot: [0, Math.PI / N, 0] });
  b.add(kit.cyl(R + 0.7, R + 0.7, 0.3, { sides: N, tile: 4 }), deck, { pos: [0, base + 0.15, 0], rot: [0, Math.PI / N, 0] });
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const x = Math.cos(a) * R; const z = Math.sin(a) * R;
    b.add(kit.lathe([[0, 0], [0.5, 0], [0.5, 0.5], [0.3, 0.7], [0.24, H - 0.8], [0.4, H - 0.5], [0.45, H], [0, H]], { sides: 16 }), paint, { pos: [x, base + 0.3, z] });
    // balustrade between posts (leave the +Z bay open for the steps)
    const a2 = ((i + 1) / N) * Math.PI * 2;
    const mx = (x + Math.cos(a2) * R) / 2; const mz = (z + Math.sin(a2) * R) / 2;
    const len = Math.hypot(Math.cos(a2) * R - x, Math.sin(a2) * R - z);
    const yaw = -Math.atan2(Math.sin(a2) * R - z, Math.cos(a2) * R - x);
    const open = Math.abs(Math.atan2(mz, mx) - Math.PI / 2) < 0.2;
    if (!open) {
      b.add(kit.box(len - 0.5, 0.2, 0.3, { bevel: 0.03 }), paint, { pos: [mx, base + 3.4, mz], rot: [0, yaw, 0] });
      b.add(kit.box(len - 0.5, 0.16, 0.24, { bevel: 0.03 }), paint, { pos: [mx, base + 0.7, mz], rot: [0, yaw, 0] });
      for (let k = 1; k < 9; k++) {
        const f = k / 9;
        b.add(kit.cyl(0.06, 0.06, 2.6, { sides: 6 }), paint, { pos: [x + (Math.cos(a2) * R - x) * f, base + 2.05, z + (Math.sin(a2) * R - z) * f] });
      }
    }
    // fretwork bracket arcs at the post heads
    b.add(kit.box(len - 0.6, 0.9, 0.12, { bevel: 0.02 }), paint, { pos: [mx, base + H - 0.3, mz], rot: [0, yaw, 0] });
  }
  // ogee dome roof with a finial
  b.add(kit.lathe([[R + 1.8, 0], [R + 1.6, 0.3], [R * 0.78, 1.5], [R * 0.5, 3.0], [R * 0.3, 5.0], [R * 0.16, 6.2], [0.5, 6.9], [0.3, 7.6], [0.6, 8.0], [0.35, 8.5], [0, 9.4]], { sides: N * 6 }), roof, { pos: [0, base + H + 0.3, 0] });
  b.add(kit.cyl(R + 1.6, R + 1.6, 0.35, { sides: N * 6 }), paint, { pos: [0, base + H + 0.2, 0] });
  b.add(kit.sphere(0.42, { segments: 14 }), gold, { pos: [0, base + H + 9.6, 0] });
  // steps on +Z
  for (let i = 0; i < 5; i++) b.add(kit.box(6, 0.6, 1.3, { bevel: 0.05 }), stone, { pos: [0, 0.3 + i * 0.6, R + 3.6 - i * 1.0 + 2.2] });
  const root = b.finish();
  root.metadata.footprint = { r: R + 2.5 };
  root.metadata.lights = [{ pos: [0, base + H - 1, 0], color: 0xffd9a0, intensity: 90, range: 40 }];
  return root;
}

// ---- pavilion, picnic set ----------------------------------------------------------------------------------------
export function parkPavilion(kit, { width = 22, depth = 14, postHeight = 9 } = {}) {
  const b = kit.builder('park-pavilion');
  const timber = kit.mat('Wood049', { tint: 0xdcb892, tile: 3 });
  const roof = kit.mat('RoofingTiles013A', { tint: 0xc8785a, gain: 2.8, tile: 4.5 });
  const slab = kit.mat('Concrete034', { tint: 0xd6d0c4, tile: 7 });
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 5 });
  const W = width; const D = depth; const H = postHeight;
  b.add(kit.box(W + 2, 0.4, D + 2, { bevel: 0.06 }), slab, { pos: [0, 0.2, 0] });
  for (const sx of [-1, -0.33, 0.33, 1]) for (const sz of [-1, 1]) {
    b.add(kit.box(1.5, 2.6, 1.5, { bevel: 0.1 }), stone, { pos: [sx * W / 2, 1.7, sz * D / 2] });
    b.add(kit.box(0.7, H - 2.6, 0.7, { bevel: 0.05 }), timber, { pos: [sx * W / 2, 3.0 + (H - 2.6) / 2, sz * D / 2] });
    b.add(kit.box(0.4, 0.4, 3.2, { bevel: 0.03 }), timber, { pos: [sx * W / 2, H - 0.6, sz * (D / 2 - 1.1)], rot: [sz * 0.78, 0, 0] });
  }
  for (const sz of [-1, 1]) b.add(kit.box(W + 1.5, 0.7, 0.6, { bevel: 0.05 }), timber, { pos: [0, H + 0.6, sz * D / 2] });
  for (const sx of [-1, -0.33, 0.33, 1]) b.add(kit.box(0.5, 0.6, D + 1, { bevel: 0.05 }), timber, { pos: [sx * W / 2, H + 0.1, 0] });
  gableRoof(kit, b, roof, { w: W, d: D, eaveY: H + 0.9, rise: 4.4, overhang: 2.0 });
  for (const sx of [-1, 1]) b.add(kit.prism([[-D / 2, 0], [D / 2, 0], [0, 4.4]], 0.3), timber, { pos: [sx * W / 2, H + 0.95, 0], rot: [0, Math.PI / 2, 0] });
  picnicInto(kit, b, -5, 0.4, 0, 0); picnicInto(kit, b, 5, 0.4, 0, 0);
  const root = b.finish();
  root.metadata.footprint = { w: W + 4, d: D + 4 };
  root.metadata.lights = [{ pos: [0, H - 0.5, 0], color: 0xffd9a0, intensity: 70, range: 34 }];
  return root;
}

function picnicInto(kit, b, x, y, z, yaw, length = 7) {
  const wood = kit.mat('Planks012', { tint: 0xeed0aa, tile: 3.4 });
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const at = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  for (let i = 0; i < 5; i++) b.add(kit.box(length, 0.14, 0.52, { bevel: 0.03 }), wood, { pos: at(0, 2.5, -1.2 + i * 0.6), rot: [0, yaw, 0] });
  for (const sz of [-1, 1]) for (let i = 0; i < 2; i++) b.add(kit.box(length, 0.14, 0.5, { bevel: 0.03 }), wood, { pos: at(0, 1.45, sz * (2.35 + i * 0.56)), rot: [0, yaw, 0] });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.add(kit.box(0.16, 3.0, 0.42, { bevel: 0.03 }), wood, { pos: at(sx * (length / 2 - 0.9), 1.25, sz * 1.0), rot: [sz * -0.42, yaw, 0] });
    b.add(kit.box(0.16, 0.36, 6.0, { bevel: 0.03 }), wood, { pos: at(sx * (length / 2 - 0.9), 1.3, 0), rot: [0, yaw, 0] });
    b.add(kit.box(0.16, 0.3, 2.9, { bevel: 0.03 }), wood, { pos: at(sx * (length / 2 - 0.9), 2.33, 0), rot: [0, yaw, 0] });
  }
}

export function picnicSet(kit, { length = 7 } = {}) {
  const b = kit.builder('picnic-set');
  picnicInto(kit, b, 0, 0, 0, 0, length);
  return b.finish();
}

// ---- puddingstone, bear dens -----------------------------------------------------------------------------------------
export function puddingstoneOutcrop(kit, { size = 9, seed = 13 } = {}) {
  const rand = seededRandom(seed);
  const b = kit.builder('puddingstone');
  const rock = kit.mat('Gravel022', { tint: 0xb9a596, tile: 6, bump: 1.6 });
  const moss = kit.mat('Ground037', { tint: 0xa9c07a, tile: 6 });
  b.add(kit.rock(size * 0.62, seed, { segments: 28, squash: 0.62, rough: 0.34 }), rock, { pos: [0, size * 0.18, 0] });
  for (let i = 0; i < 7; i++) {
    const a = rand() * 6.28; const d = size * (0.45 + rand() * 0.4);
    const s = size * (0.16 + rand() * 0.24);
    b.add(kit.rock(s, seed + 3 + i, { segments: 18, squash: 0.6 + rand() * 0.3, rough: 0.36 }), i % 3 === 0 ? moss : rock, { pos: [Math.cos(a) * d, s * 0.25, Math.sin(a) * d], rot: [0, rand() * 6.28, 0] });
  }
  return b.finish();
}

export function bearDens(kit, { dens = 3, denWidth = 9, height = 14 } = {}) {
  const b = kit.builder('bear-dens');
  const stone = kit.mat('PavingStones070', { tint: 0xe6dccb, tile: 6 });
  const cap = kit.mat('Concrete034', { tint: 0xddd5c6, tile: 5 });
  const iron = kit.flat(0x1a1c1e, { rough: 0.5, metal: 0.9 });
  const dark = kit.flat(0x0b0a09, { rough: 1 });
  const W = dens * denWidth + 4; const H = height;
  b.add(kit.box(W, H, 6, { bevel: 0.15 }), stone, { pos: [0, H / 2, -3] });
  b.add(kit.box(W + 1, 0.8, 7, { bevel: 0.12 }), cap, { pos: [0, H + 0.4, -3] });
  const R = denWidth / 2 - 1.1;
  for (let d = 0; d < dens; d++) {
    const cx = (d - (dens - 1) / 2) * denWidth;
    // the den mouth: dark recess built FORWARD of the wall, framed by a true-circle arch ring
    b.add(kit.box(R * 2, 6.2, 0.1), dark, { pos: [cx, 3.1, 0.06] });
    const arcDisc = kit.disc(R, { sides: 32, arc: 0.5 });
    b.add(arcDisc, dark, { pos: [cx, 6.2, 0.07], rot: [Math.PI / 2, 0, 0] });
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N) * Math.PI;
      b.add(kit.box(1.0, (Math.PI * (R + 0.5)) / N + 0.04, 0.8, { bevel: 0.06 }), cap, { pos: [cx + Math.cos(a) * (R + 0.5), 6.2 + Math.sin(a) * (R + 0.5), 0.35], rot: [0, 0, a] });
    }
    for (const sx of [-1, 1]) b.add(kit.box(1.0, 6.2, 0.8, { bevel: 0.06 }), cap, { pos: [cx + sx * (R + 0.5), 3.1, 0.35] });
    // bars
    for (let k = 0; k <= 10; k++) {
      const x = cx - R + (k / 10) * R * 2;
      const top = 6.2 + Math.sqrt(Math.max(0, R * R - (x - cx) * (x - cx)));
      b.add(kit.cyl(0.07, 0.07, top, { sides: 8 }), iron, { pos: [x, top / 2, 0.55] });
    }
    for (const y of [2.2, 5.2]) b.add(kit.box(R * 2, 0.16, 0.12), iron, { pos: [cx, y, 0.55] });
  }
  return b.finish();
}

// ---- playground, ball field ----------------------------------------------------------------------------------------------
export function playground(kit) {
  const b = kit.builder('playground');
  const red = kit.flat(0xd8402f, { rough: 0.35, clearcoat: 0.6 });
  const blue = kit.flat(0x2f6fd8, { rough: 0.35, clearcoat: 0.6 });
  const yellow = kit.flat(0xf2b826, { rough: 0.35, clearcoat: 0.6 });
  const steel = kit.flat(0xc8ccd0, { rough: 0.3, metal: 1 });
  const rubber = kit.flat(0x1a1a1a, { rough: 0.9 });
  const wood = kit.mat('Planks012', { tint: 0xf0d4ae, tile: 3.4 });
  // swing set: A-frames, top bar, three swings on chains
  const SW = 16; const SH = 10;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(kit.tube([[sx * SW / 2, SH, 0], [sx * (SW / 2 + 0.6), 0, sz * 4]], 0.16, { sides: 10 }), blue);
  b.add(kit.tube([[-SW / 2 - 0.3, SH, 0], [SW / 2 + 0.3, SH, 0]], 0.17, { sides: 10 }), blue);
  [-5, 0, 5].forEach((x, i) => {
    const sw = (i - 1) * 0.35;
    for (const sx of [-0.8, 0.8]) b.add(kit.tube([[x + sx, SH, 0], [x + sx, 2.0, Math.sin(sw) * 8]], 0.03, { sides: 5 }), steel);
    b.add(kit.box(2.0, 0.14, 0.75, { bevel: 0.05 }), rubber, { pos: [x, 1.95, Math.sin(sw) * 8], rot: [sw, 0, 0] });
  });
  // play tower with a slide and a climbing ladder
  const tx = 18; const tz = 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(kit.box(0.5, 11, 0.5, { bevel: 0.05 }), wood, { pos: [tx + sx * 2.6, 5.5, tz + sz * 2.6] });
  b.add(kit.box(6, 0.3, 6, { bevel: 0.05 }), wood, { pos: [tx, 5.2, tz] });
  for (const [dx, dz, ry] of [[0, -2.8, 0], [-2.8, 0, Math.PI / 2], [2.8, 0, Math.PI / 2]]) b.add(kit.box(5.4, 2.4, 0.16, { bevel: 0.03 }), yellow, { pos: [tx + dx, 6.9, tz + dz], rot: [0, ry, 0] });
  b.add(kit.prism([[-3.6, 0], [3.6, 0], [0, 3.2]], 7), red, { pos: [tx, 11, tz], rot: [0, 0, 0] });
  // slide: a channel down +Z
  b.add(kit.box(2.4, 0.16, 11.5, { bevel: 0.04 }), steel, { pos: [tx, 2.95, tz + 7.9], rot: [0.455, 0, 0] });
  for (const sx of [-1, 1]) b.add(kit.box(0.2, 0.9, 11.5, { bevel: 0.05 }), red, { pos: [tx + sx * 1.25, 3.3, tz + 7.9], rot: [0.455, 0, 0] });
  for (let i = 0; i < 6; i++) b.add(kit.cyl(0.09, 0.09, 2.2, { sides: 8 }), steel, { pos: [tx - 3.3, 0.9 + i * 0.85, tz], rot: [Math.PI / 2, 0, 0] });
  // see-saw and spring rider
  b.add(kit.box(12, 0.3, 0.9, { bevel: 0.06 }), red, { pos: [-2, 2.3, 12], rot: [0, 0, 0.16] });
  b.add(kit.prism([[-1.2, 0], [1.2, 0], [0, 2.2]], 1.0), steel, { pos: [-2, 0, 12], rot: [0, 0, 0] });
  for (const sx of [-1, 1]) b.add(kit.tube(kit.curve([[-2 + sx * 4.6, 2.4 + sx * 0.75, 11.8], [-2 + sx * 4.6, 3.3 + sx * 0.75, 12], [-2 + sx * 4.6, 2.4 + sx * 0.75, 12.2]], 8), 0.05, { sides: 6 }), steel);
  // safety surface border
  for (const [x, z, w, d] of [[8, -7, 44, 0.6], [8, 19, 44, 0.6], [-14, 6, 0.6, 26], [30, 6, 0.6, 26]]) b.add(kit.box(w, 0.7, d, { bevel: 0.08 }), wood, { pos: [x, 0.3, z] });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

export function ballField(kit, { baseline = 30 } = {}) {
  const b = kit.builder('ball-field');
  const white = kit.flat(0xf4f4f0, { rough: 0.7 });
  const steel = kit.flat(0xb9bec4, { rough: 0.35, metal: 1 });
  const wood = kit.mat('Planks012', { tint: 0xeccfa8, tile: 3.4 });
  const B = baseline;
  // bases as a diamond with home at the origin, second base toward -Z
  const bases = [[0, 0], [B * 0.707, -B * 0.707], [0, -B * 1.414], [-B * 0.707, -B * 0.707]];
  for (const [x, z] of bases) b.add(kit.box(1.4, 0.18, 1.4, { bevel: 0.05 }), white, { pos: [x, 0.09, z], rot: [0, Math.PI / 4, 0] });
  b.add(kit.cyl(0.9, 1.4, 0.5, { sides: 20 }), kit.mat('Ground068', { tint: 0xb98a5e, tile: 4 }), { pos: [0, 0.2, -B * 0.707] });
  // backstop: posts and a mesh of thin bars
  for (let i = -3; i <= 3; i++) {
    const a = (i / 3) * 0.9; const x = Math.sin(a) * 12; const z = 9 + (1 - Math.cos(a)) * -6;
    b.add(kit.cyl(0.12, 0.12, 12, { sides: 8 }), steel, { pos: [x, 6, z] });
  }
  for (let y = 1; y <= 12; y += 1) {
    const pts = []; for (let i = -12; i <= 12; i++) { const a = (i / 12) * 0.9; pts.push([Math.sin(a) * 12, y, 9 + (1 - Math.cos(a)) * -6]); }
    b.add(kit.tube(pts, 0.02, { sides: 4 }), steel);
  }
  // two team benches
  for (const sx of [-1, 1]) {
    b.add(kit.box(10, 0.16, 1.0, { bevel: 0.04 }), wood, { pos: [sx * 17, 1.5, 3], rot: [0, sx * 0.78, 0] });
    for (const k of [-4, 4]) b.add(kit.box(0.3, 1.5, 0.9, { bevel: 0.04 }), steel, { pos: [sx * 17 + Math.cos(sx * 0.78) * k, 0.75, 3 - Math.sin(sx * 0.78) * k], rot: [0, sx * 0.78, 0] });
  }
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- flowers ----------------------------------------------------------------------------------------------------------
// Raw-built with VERTEX COLOURS: one mesh for a whole bed, every bloom its own hue.
const BLOOMS = [0xf2c94c, 0xeb5757, 0xbb6bd9, 0xf2f2f2, 0xf2994a, 0x56a0f2, 0xf278b0, 0xfff07a];
let flowerMaterial = null;
function flowersMesh(kit, spots, seed) {
  const rand = seededRandom(seed);
  const p = []; const n = []; const col = []; const idx = [];
  const tri = (a, b, c, color, nrm = [0, 1, 0]) => {
    const base = p.length / 3;
    for (const v of [a, b, c]) { p.push(v[0], v[1], v[2]); n.push(nrm[0], nrm[1], nrm[2]); col.push(color.r, color.g, color.b, 1); }
    idx.push(base, base + 2, base + 1);
  };
  const stemC = linear(0x3f7a2c); const leafC = linear(0x4f9436);
  for (const [x, z, h] of spots) {
    const lean = [(rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3];
    const top = [x + lean[0], h, z + lean[1]];
    const a0 = rand() * 6.28;
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k / 3) * Math.PI * 2; const a2 = a0 + ((k + 1) / 3) * Math.PI * 2;
      const r = 0.022;
      tri([x + Math.cos(a) * r, 0, z + Math.sin(a) * r], [x + Math.cos(a2) * r, 0, z + Math.sin(a2) * r], top, stemC, [Math.cos(a), 0.3, Math.sin(a)]);
    }
    for (let k = 0; k < 2; k++) {
      const a = a0 + k * 2.4; const ly = h * (0.25 + k * 0.2);
      const tip = [x + Math.cos(a) * 0.42, ly + 0.2, z + Math.sin(a) * 0.42];
      tri([x, ly, z], [x + Math.cos(a + 0.5) * 0.2, ly + 0.12, z + Math.sin(a + 0.5) * 0.2], tip, leafC);
      tri([x, ly, z], tip, [x + Math.cos(a - 0.5) * 0.2, ly + 0.12, z + Math.sin(a - 0.5) * 0.2], leafC);
    }
    const base = linear(BLOOMS[Math.floor(rand() * BLOOMS.length)]);
    const c = new Color3(base.r * (0.85 + rand() * 0.3), base.g * (0.85 + rand() * 0.3), base.b * (0.85 + rand() * 0.3));
    const dark = c.scale(0.62);
    const R = 0.16 + h * 0.07; const petals = 6;
    const tilt = [(rand() - 0.5) * 0.5, (rand() - 0.5) * 0.5];
    for (let k = 0; k < petals; k++) {
      const a = a0 + (k / petals) * 6.283; const a2 = a0 + ((k + 0.5) / petals) * 6.283; const a3 = a0 + ((k + 1) / petals) * 6.283;
      const P = (ang, rr, up) => [top[0] + Math.cos(ang) * rr, top[1] + up + Math.cos(ang) * rr * tilt[0] + Math.sin(ang) * rr * tilt[1], top[2] + Math.sin(ang) * rr];
      tri(top, P(a, R * 0.55, 0.03), P(a2, R, 0.07), dark);
      tri(top, P(a2, R, 0.07), P(a3, R * 0.55, 0.03), c);
    }
    const yc = linear(0xf6d23a);
    tri([top[0] - 0.04, top[1] + 0.06, top[2] - 0.03], [top[0] + 0.04, top[1] + 0.06, top[2] - 0.03], [top[0], top[1] + 0.06, top[2] + 0.05], yc);
  }
  const mesh = new Mesh('flowers', kit.scene);
  const vd = new VertexData();
  vd.positions = p; vd.normals = n; vd.colors = col; vd.indices = idx;
  vd.applyToMesh(mesh);
  if (!flowerMaterial) {
    flowerMaterial = new PBRMaterial('flowerPetals', kit.scene);
    flowerMaterial.metallic = 0; flowerMaterial.roughness = 0.55; flowerMaterial.backFaceCulling = false;
    flowerMaterial.twoSidedLighting = true;
    flowerMaterial.subSurface.isTranslucencyEnabled = true; flowerMaterial.subSurface.translucencyIntensity = 0.5;
  }
  mesh.material = flowerMaterial;
  mesh.receiveShadows = true;
  return mesh;
}

export function flowerBed(kit, { width = 10, depth = 6, seed = 7 } = {}) {
  const rand = seededRandom(seed);
  const b = kit.builder('flower-bed');
  const stone = kit.mat('Rock030', { tint: 0xf0e8da, gain: 2.0, tile: 5 });
  const soil = kit.mat('Ground068', { tint: 0x5a4a3c, tile: 4 });
  b.add(kit.box(width, 0.3, depth, { bevel: 0.03 }), soil, { pos: [0, 0.25, 0] });
  const edge = (x, z, w, d) => { for (let i = 0; i < Math.max(w, d) / 0.9; i++) { const f = (i + 0.5) / (Math.max(w, d) / 0.9); b.add(kit.rock(0.46, seed + i * 7 + x * 3 + z, { segments: 8, squash: 0.7 }), stone, { pos: [x + (w > d ? (f - 0.5) * w : 0), 0.25, z + (d > w ? (f - 0.5) * d : 0)] }); } };
  edge(0, depth / 2, width, 0); edge(0, -depth / 2, width, 0); edge(width / 2, 0, 0, depth); edge(-width / 2, 0, 0, depth);
  const root = b.finish();
  const spots = [];
  for (let i = 0; i < width * depth * 3.2; i++) spots.push([(rand() - 0.5) * (width - 1), (rand() - 0.5) * (depth - 1), 0.9 + rand() * 1.1]);
  const flowers = flowersMesh(kit, spots, seed + 1);
  flowers.position.y = 0.38; flowers.parent = root;
  root.metadata.instanceable = false;
  return root;
}

export function wildflowers(kit, { radius = 7, count = 150, seed = 11 } = {}) {
  const rand = seededRandom(seed);
  const spots = [];
  for (let i = 0; i < count * 2; i++) { const a = rand() * 6.283; const r = radius * Math.sqrt(rand()); spots.push([Math.cos(a) * r, Math.sin(a) * r, 1.1 + rand() * 1.3]); }
  const root = kit.builder('wildflowers').finish();
  const flowers = flowersMesh(kit, spots, seed + 1);
  flowers.parent = root;
  root.metadata.instanceable = false;
  return root;
}

// ---- map kiosk, billboard ------------------------------------------------------------------------------------------------------
export function mapKiosk(kit, { width = 8, height = 5.4 } = {}) {
  const b = kit.builder('map-kiosk');
  const timber = kit.mat('Wood049', { tint: 0xdcb892, tile: 3 });
  const roof = kit.mat('RoofingTiles013A', { tint: 0x9fb5aa, gain: 2.6, tile: 4 });
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * height / width);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e9e2c8'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#9ccf7d'; ctx.beginPath(); ctx.ellipse(512, c.height * 0.55, 440, c.height * 0.36, 0, 0, 6.283); ctx.fill();
  ctx.fillStyle = '#6fb4d6'; ctx.beginPath(); ctx.ellipse(300, c.height * 0.62, 70, 52, 0.3, 0, 6.283); ctx.fill();
  ctx.strokeStyle = '#c9b68a'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(512, c.height - 40); ctx.lineTo(512, c.height * 0.3); ctx.moveTo(512, c.height * 0.55); ctx.lineTo(330, c.height * 0.55); ctx.moveTo(512, c.height * 0.45); ctx.lineTo(760, c.height * 0.45); ctx.stroke();
  ctx.fillStyle = '#23402c'; ctx.font = '700 58px Georgia, serif'; ctx.textAlign = 'center'; ctx.fillText('FRANKLIN PARK  ·  YOU ARE HERE', 512, 74);
  ctx.font = '600 30px Helvetica, Arial'; ctx.fillStyle = '#3d3226';
  for (const [t, x, y] of [['Bandstand', 512, 0.27], ['Pond', 300, 0.62], ['Playstead', 800, 0.42], ['Nature Centre', 170, 0.4], ['Bear Dens', 790, 0.72]]) ctx.fillText(t, x, c.height * y);
  ctx.fillStyle = '#d8402f'; ctx.beginPath(); ctx.arc(512, c.height - 60, 16, 0, 6.283); ctx.fill();
  const face = kit.canvasMat('park-map', c, { emissive: 0.2 });
  const cy = 2.2 + height / 2;
  for (const sx of [-1, 1]) b.add(kit.box(0.6, cy + height / 2 + 1.4, 0.6, { bevel: 0.05 }), timber, { pos: [sx * (width / 2 + 0.4), (cy + height / 2 + 1.4) / 2, 0] });
  b.add(kit.box(width + 0.3, height + 0.3, 0.3, { bevel: 0.04 }), timber, { pos: [0, cy, 0] });
  b.add(kit.plane(width, height), face, { pos: [0, cy, 0.16] });
  gableRoof(kit, b, roof, { w: width + 1, d: 3, eaveY: cy + height / 2 + 0.9, rise: 1.2, overhang: 0.6, thickness: 0.22 });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

export function billboard(kit, { height = 6, image = 'NewEdusim.png', aspect = 1.6 } = {}) {
  const b = kit.builder('billboard');
  const timber = kit.mat('Wood049', { tint: 0xdcb892, tile: 3 });
  const w = height * aspect;
  const m = new PBRMaterial('billboard-face', kit.scene);
  m.albedoTexture = kit.texture(image, true);
  m.emissiveTexture = m.albedoTexture; m.emissiveColor = new Color3(0.22, 0.22, 0.22);
  m.metallic = 0; m.roughness = 0.5; m.metadata = { keepUV: true };
  for (const sx of [-1, 1]) b.add(kit.box(0.5, height + 3.2, 0.5, { bevel: 0.05 }), timber, { pos: [sx * (w / 2 - 1), (height + 3.2) / 2, -0.3] });
  b.add(kit.box(w + 0.4, height + 0.4, 0.25, { bevel: 0.05 }), timber, { pos: [0, 3 + height / 2, 0] });
  b.add(kit.plane(w, height), m, { pos: [0, 3 + height / 2, 0.135] });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

export { cardCanvas };
