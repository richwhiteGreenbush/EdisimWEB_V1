// Native HiFi models for On Mars: the outpost and its vehicles. Keys are the main app's
// PROP_BUILDERS keys; every builder takes the same options, stands on the same origin and faces
// the same way as the MarsProps.js builder it replaces. See native.js.
//
// The main app's Mars hardware is boxes and cylinders in three flat colours, because on a
// Chromebook that is what a rover can afford to be. Here the same machines are rebuilt as
// machines: wheels that are machined aluminium shells on titanium flexure spokes, a suspension
// that is actually a rocker and a bogie, foil that crinkles, panels with seams and rivets, solar
// cells with busbars -- and a fine coat of the planet on all of it.
//
// TWO THINGS HOLD EVERY BUILDER HERE:
//   * THE FOOTPRINT IS THE ORIGINAL'S. The three.js object is still what gets clicked, measured
//     and programmed, and the layout stands other things beside (and, in the dome, INSIDE) these,
//     so every overall dimension, every origin and every facing is read off MarsProps.js.
//   * DUST IS A TINT. Everything on Mars is the colour of Mars within a season. It is carried
//     in the paint and the metal colours themselves -- warm, never neutral -- not as a layer.

import {
  PBRMaterial, DynamicTexture, Texture, Vector3, VertexBuffer, VertexData, MeshBuilder, Mesh, TransformNode,
} from '@babylonjs/core';
import { seededRandom, linear } from './Kit.js';
import { Cards, cluster, foliageMaterial } from './Trees.js';

// ---- procedural surfaces --------------------------------------------------------------------
function canvasOf(size) { const c = document.createElement('canvas'); c.width = c.height = size; return c; }

function tiled(kit, name, canvas, srgb) {
  const t = new DynamicTexture(name, canvas, kit.scene, true);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 16;
  t.gammaSpace = srgb;
  t.update(true);
  return t;
}

// A greyscale height canvas -> a tangent-space normal canvas. Wraps, because these tile.
function normalsFrom(height, strength) {
  const n = height.width; const src = height.getContext('2d').getImageData(0, 0, n, n).data;
  const out = canvasOf(n); const ctx = out.getContext('2d'); const img = ctx.createImageData(n, n);
  const H = (x, y) => src[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength; const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1); const o = (y * n + x) * 4;
    img.data[o] = (-dx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function cached(kit, key, make) {
  const k = `martian|${key}`;
  if (!kit.materials.has(k)) kit.materials.set(k, make(k));
  return kit.materials.get(k);
}

// CRINKLED FOIL. Kapton blanket is not bumpy, it is FACETED: flat panes meeting at sharp
// creases, each pane throwing the sun somewhere different. So the normal map is built directly
// as one constant normal per Worley cell -- no height field, no Sobel -- on a wrapped lattice.
function foil(kit, hex = 0xd9a83c) {
  return cached(kit, `foil:${hex}`, (name) => {
    const n = 256; const cells = 6; const rand = seededRandom(71);
    const pts = [];
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push({ x: (i + rand()) / cells, y: (j + rand()) / cells, tx: (rand() - 0.5) * 0.85, ty: (rand() - 0.5) * 0.85 });
    const c = canvasOf(n); const ctx = c.getContext('2d'); const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / n; const v = y / n; let best = 9; let cell = pts[0];
      for (const p of pts) {
        let dx = Math.abs(u - p.x); let dy = Math.abs(v - p.y); dx = Math.min(dx, 1 - dx); dy = Math.min(dy, 1 - dy);
        const d = dx * dx + dy * dy; if (d < best) { best = d; cell = p; }
      }
      const l = Math.hypot(cell.tx, cell.ty, 1); const o = (y * n + x) * 4;
      img.data[o] = (cell.tx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (cell.ty / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const m = new PBRMaterial(name, kit.scene);
    m.albedoColor = linear(hex); m.metallic = 1; m.roughness = 0.26;
    m.bumpTexture = tiled(kit, `${name}:n`, c, false); m.bumpTexture.level = 1.0;
    m.metadata = { tile: 2.2 };
    return m;
  });
}

// PAINTED PANELWORK: white thermal paint over aluminium, in riveted panels, with the grime a
// machine picks up standing outside on Mars. Seams and rivets are in the normal map; the dust
// is in the colour.
function panels(kit, hex = 0xe2dccf, { dust = 0.5, metal = 0.12, rough = 0.52, tile = 4 } = {}) {
  return cached(kit, `panel:${hex}:${dust}:${metal}:${rough}:${tile}`, (name) => {
    const n = 512; const rand = seededRandom(hex & 0xffff);
    const col = canvasOf(n); const cc = col.getContext('2d'); const hgt = canvasOf(n); const hc = hgt.getContext('2d');
    cc.fillStyle = '#ffffff'; cc.fillRect(0, 0, n, n); hc.fillStyle = '#808080'; hc.fillRect(0, 0, n, n);
    // staggered panels: three courses, joints offset course to course
    const rows = 3; const rh = n / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh; const cols = 2; const off = (r % 2) * (n / cols / 2);
      hc.fillStyle = '#383838'; hc.fillRect(0, y, n, 3); cc.fillStyle = 'rgba(40,30,24,0.35)'; cc.fillRect(0, y, n, 2);
      for (let k = 0; k < cols; k++) {
        const x = (off + k * (n / cols)) % n;
        hc.fillStyle = '#383838'; hc.fillRect(x, y, 3, rh); cc.fillStyle = 'rgba(40,30,24,0.35)'; cc.fillRect(x, y, 2, rh);
        // slight shade difference panel to panel, so the skin reads as separate sheets
        cc.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rand() * 0.05})`; cc.fillRect(x + 3, y + 3, n / cols - 3, rh - 3);
        for (let i = 0; i < 9; i++) for (const [rx, ry] of [[x + 12 + i * ((n / cols - 24) / 8), y + 11], [x + 12 + i * ((n / cols - 24) / 8), y + rh - 9]]) {
          hc.fillStyle = '#c8c8c8'; hc.beginPath(); hc.arc(rx % n, ry, 3.2, 0, 6.283); hc.fill();
          cc.fillStyle = 'rgba(60,50,40,0.22)'; cc.beginPath(); cc.arc(rx % n, ry + 1, 3.4, 0, 6.283); cc.fill();
        }
      }
    }
    // dust: soft rust blotches, heavier low on each panel where it settles
    for (let i = 0; i < 70; i++) {
      const x = rand() * n; const y = rand() * n; const r = 20 + rand() * 70;
      const g = cc.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(176,98,62,${0.10 * dust + rand() * 0.10 * dust})`); g.addColorStop(1, 'rgba(176,98,62,0)');
      cc.fillStyle = g; cc.fillRect(x - r, y - r, r * 2, r * 2);
    }
    cc.fillStyle = `rgba(190,120,84,${0.16 * dust})`; cc.fillRect(0, 0, n, n);
    const m = new PBRMaterial(name, kit.scene);
    m.albedoColor = linear(hex); m.albedoTexture = tiled(kit, `${name}:c`, col, true);
    m.bumpTexture = tiled(kit, `${name}:n`, normalsFrom(hgt, 5), false); m.bumpTexture.level = 0.9;
    m.metallic = metal; m.roughness = rough;
    m.metadata = { tile };
    return m;
  });
}

// SOLAR CELLS: a grid of dark blue cells with silver busbars and the glint of cover glass.
function cells(kit) {
  return cached(kit, 'cells', (name) => {
    const n = 512; const c = canvasOf(n); const ctx = c.getContext('2d'); const h = canvasOf(n); const hc = h.getContext('2d');
    ctx.fillStyle = '#b9bcc2'; ctx.fillRect(0, 0, n, n); hc.fillStyle = '#404040'; hc.fillRect(0, 0, n, n);
    const N = 4; const s = n / N; const rand = seededRandom(5);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const g = ctx.createLinearGradient(i * s, j * s, i * s + s, j * s + s);
      const b = 40 + rand() * 18;
      g.addColorStop(0, `rgb(18,${b},${b * 2.3})`); g.addColorStop(1, `rgb(10,${b * 0.7},${b * 1.7})`);
      ctx.fillStyle = g; ctx.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      hc.fillStyle = '#909090'; hc.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
      ctx.fillStyle = 'rgba(200,205,215,0.55)';
      for (let k = 1; k < 3; k++) ctx.fillRect(i * s + 3, j * s + (k * s) / 3 - 1, s - 6, 2);
      ctx.fillStyle = 'rgba(200,205,215,0.18)';
      for (let k = 1; k < 16; k++) ctx.fillRect(i * s + (k * s) / 16, j * s + 3, 1, s - 6);
    }
    const m = new PBRMaterial(name, kit.scene);
    m.albedoTexture = tiled(kit, `${name}:c`, c, true);
    m.bumpTexture = tiled(kit, `${name}:n`, normalsFrom(h, 3), false);
    m.metallic = 0.55; m.roughness = 0.16; m.clearCoat.isEnabled = true; m.clearCoat.intensity = 0.7; m.clearCoat.roughness = 0.05;
    m.metadata = { tile: 2.4 };
    return m;
  });
}

// The shared palette. Every colour is WARM: nothing on this planet stays neutral for long.
function palette(kit) {
  return {
    hull: panels(kit, 0xe4ddd0),
    alu: kit.flat(0xc6bdb0, { metal: 1, rough: 0.36 }),
    aluDull: kit.flat(0xa9a196, { metal: 0.9, rough: 0.55 }),
    dark: kit.flat(0x2f3035, { metal: 0.75, rough: 0.42 }),
    black: kit.flat(0x121214, { rough: 0.6, metal: 0.2 }),
    trim: panels(kit, 0xb5502c, { dust: 0.35, tile: 3 }),
    foil: foil(kit),
    cell: cells(kit),
    lens: kit.flat(0x07111a, { rough: 0.04, metal: 0.7, clearcoat: 1 }),
    carbon: kit.flat(0x17181b, { rough: 0.32, metal: 0.35, clearcoat: 0.5 }),
    cable: kit.flat(0x1b1a18, { rough: 0.7 }),
    copper: kit.flat(0xb87333, { metal: 1, rough: 0.35 }),
    dustyRock: kit.mat('Ground054', { tint: 0xb0623c, tile: 5, bump: 1.3 }),
  };
}

// A readout screen: the main app's techPanelTexture, redrawn at twice the resolution.
function techPanel(kit, b, title, readouts, { w, h, pos, rot, accent = '#ff8a4c', face = '#1b2430', glow = 0.55 }) {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 800;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 800); g.addColorStop(0, face); g.addColorStop(1, '#0d1219');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 800);
  ctx.strokeStyle = accent; ctx.lineWidth = 12; ctx.strokeRect(28, 28, 1224, 744);
  ctx.fillStyle = accent; ctx.font = 'bold 68px "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(String(title).toUpperCase(), 84, 152);
  ctx.font = '52px "Helvetica Neue", Arial, sans-serif';
  readouts.forEach((line, i) => {
    const y = 272 + i * 96;
    ctx.fillStyle = '#e8eef5'; ctx.fillText(line, 84, y);
    ctx.strokeStyle = 'rgba(232,238,245,0.22)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(84, y + 28); ctx.lineTo(1196, y + 28); ctx.stroke();
  });
  const mat = kit.canvasMat(`tech:${title}`, c, { emissive: glow, rough: 0.25 });
  b.add(kit.plane(w, h), mat, { pos, rot });
}

const V = (x, y, z) => new Vector3(x, y, z);
// A straight strut between two points. kit.tube needs no orientation arithmetic, which is the
// whole reason every strut, leg and brace in this file is one.
const strut = (kit, b, mat, a, c, r, sides = 10) => b.add(kit.tube([V(...a), V(...c)], r, { sides }), mat);

// ---- mars-rover ---------------------------------------------------------------------------------
// Perseverance's idiom. The marks, in the order they carry the identification: SIX open
// aluminium wheels on a ROCKER-BOGIE (the rocker runs from the body to the front wheel and to a
// bogie pivot; the bogie carries the middle and rear wheels -- that articulated silhouette is a
// Mars rover and nothing else); the MAST with its wide two-eyed head; the ARM folded forward
// with a fat turret; and the finned RTG canted off the tail.
// The long axis is X (front = +X, RTG at -X), exactly as the original builds it.
function wheel(kit, b, P, cx, cy, cz, R, W, seed) {
  const rand = seededRandom(seed);
  // the tyre: a thin crowned aluminium shell, open inside
  b.add(kit.lathe([[R * 0.86, -W / 2], [R * 0.95, -W / 2], [R * 0.99, -W * 0.3], [R, 0], [R * 0.99, W * 0.3], [R * 0.95, W / 2], [R * 0.86, W / 2]], { sides: 56, tile: 2 }), P.alu, { pos: [cx, cy, cz], rot: [Math.PI / 2, 0, 0] });
  // grousers: 28 raised cleats, each a shallow chevron made of two canted bars
  const N = 28; const a0 = rand() * 6.283;
  for (let i = 0; i < N; i++) {
    const a = a0 + (i / N) * Math.PI * 2;
    for (const s of [-1, 1]) {
      b.add(kit.box(0.075, 0.09, W * 0.52, { bevel: 0.012 }), P.aluDull, {
        pos: [cx + Math.cos(a + s * 0.035) * (R + 0.022), cy + Math.sin(a + s * 0.035) * (R + 0.022), cz + s * W * 0.235], rot: [0, 0, a],
      });
    }
  }
  // flexure spokes: six curved titanium leaves from hub to rim
  for (let i = 0; i < 6; i++) {
    const a = a0 + (i / 6) * Math.PI * 2; const pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6; const r = 0.2 + (R * 0.9 - 0.2) * t; const aa = a + Math.sin(t * Math.PI) * 0.55; pts.push(V(cx + Math.cos(aa) * r, cy + Math.sin(aa) * r, cz)); }
    b.add(kit.tube(pts, 0.04, { sides: 6 }), P.alu, { scale: [1, 1, 1] });
  }
  b.add(kit.cyl(0.24, 0.24, W * 0.62, { sides: 20 }), P.dark, { pos: [cx, cy, cz], rot: [Math.PI / 2, 0, 0] });
  b.add(kit.cyl(0.13, 0.13, W * 0.7, { sides: 14 }), P.alu, { pos: [cx, cy, cz], rot: [Math.PI / 2, 0, 0] });
}

function marsRover(kit, { length = 10 } = {}) {
  const P = palette(kit); const b = kit.builder('mars-rover'); const L = length;
  const R = 0.85; const W = 1.3; const track = 4.6; const deckY = R + 1.5;
  const bw = track * 0.82; // body width, as the original

  // the warm electronics box: chassis, belly pan, top deck, and the clutter that lives on it
  b.add(kit.box(L * 0.66, 1.5, bw, { bevel: 0.1 }), P.hull, { pos: [0, deckY - 0.1, 0] });
  b.add(kit.box(L * 0.62, 0.3, bw * 0.92, { bevel: 0.08 }), P.dark, { pos: [0, deckY - 0.98, 0] });
  b.add(kit.box(L * 0.7, 0.2, track * 0.86, { bevel: 0.05 }), P.dark, { pos: [0, deckY + 0.78, 0] });
  b.add(kit.box(L * 0.3, 0.46, track * 0.7, { bevel: 0.06 }), P.hull, { pos: [-L * 0.16, deckY + 1.08, 0] });
  for (const [x, z, w, d, h] of [[1.2, 0.9, 1.1, 0.8, 0.3], [2.4, -0.2, 0.9, 1.2, 0.24], [0.3, -1.1, 0.7, 0.7, 0.36], [2.6, 1.2, 0.5, 0.5, 0.5]]) {
    b.add(kit.box(w, h, d, { bevel: 0.04 }), P.aluDull, { pos: [x, deckY + 0.88 + h / 2, z] });
  }
  // heat-rejection tubing looped along both flanks
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) strut(kit, b, P.copper, [-L * 0.3, deckY - 0.5 + k * 0.32, s * (bw / 2 + 0.04)], [L * 0.3, deckY - 0.5 + k * 0.32, s * (bw / 2 + 0.04)], 0.035, 6);

  // ROCKER-BOGIE, one per side
  const wx = [L * 0.34, 0, -L * 0.34];
  for (const s of [-1, 1]) {
    const zs = s * (bw / 2 + 0.22); const zw = s * track / 2;
    const pivot = [L * 0.06, deckY - 0.35, zs]; const bogie = [-L * 0.17, R + 0.95, zs];
    const front = [wx[0], R * 2 + 0.42, zs]; const mid = [wx[1] + 0.05, R * 2 + 0.3, zs]; const rear = [wx[2], R * 2 + 0.42, zs];
    b.add(kit.cyl(0.3, 0.3, 0.5, { sides: 20 }), P.dark, { pos: pivot, rot: [Math.PI / 2, 0, 0] });
    b.add(kit.tube(kit.curve([pivot, [L * 0.2, deckY - 0.1, zs], front], 10), 0.11, { sides: 10 }), P.alu);
    strut(kit, b, P.alu, pivot, bogie, 0.11);
    b.add(kit.cyl(0.2, 0.2, 0.4, { sides: 16 }), P.dark, { pos: bogie, rot: [Math.PI / 2, 0, 0] });
    b.add(kit.tube(kit.curve([mid, [bogie[0] + 0.5, bogie[1] + 0.12, zs], bogie, [bogie[0] - 0.7, bogie[1] + 0.2, zs], rear], 12), 0.1, { sides: 10 }), P.alu);
    wx.forEach((x, i) => {
      wheel(kit, b, P, x, R, zw, R, W, 11 + i * 7 + (s > 0 ? 3 : 0));
      const top = [front, mid, rear][i];
      // corner wheels steer: an actuator can above the wheel, then a fork leg down to the hub
      if (i !== 1) b.add(kit.cyl(0.2, 0.2, 0.46, { sides: 16 }), P.dark, { pos: [x, top[1] - 0.05, zs] });
      const inboard = zw - s * (W / 2 + 0.16);
      b.add(kit.tube(kit.curve([[x, top[1] - 0.2, zs], [x, top[1] - 0.35, inboard], [x, R + 0.1, inboard], [x, R, inboard]], 8), 0.085, { sides: 8 }), P.alu);
      strut(kit, b, P.dark, [x, R, inboard - s * 0.05], [x, R, zw], 0.12, 10);
      strut(kit, b, P.cable, [x, top[1] - 0.2, zs + s * 0.1], [x, R + 0.2, inboard + s * 0.1], 0.025, 5);
    });
    // the differential bar's link, up from the rocker pivot to the deck
    strut(kit, b, P.aluDull, [pivot[0], pivot[1] + 0.2, zs], [pivot[0] - 0.4, deckY + 0.9, s * bw * 0.42], 0.05, 6);
  }
  strut(kit, b, P.aluDull, [L * 0.06 - 0.4, deckY + 0.92, -bw * 0.42], [L * 0.06 - 0.4, deckY + 0.92, bw * 0.42], 0.06, 8);

  // REMOTE SENSING MAST, head looking out to +Z as the original's eyes do
  const mx = -L * 0.24; const mz = 1.2; const mBase = deckY + 0.88; const mTop = deckY + 1.2 + 4.2;
  b.add(kit.cyl(0.3, 0.36, 0.4, { sides: 20 }), P.dark, { pos: [mx, mBase + 0.2, mz] });
  b.add(kit.cyl(0.15, 0.19, mTop - mBase, { sides: 18 }), P.hull, { pos: [mx, (mTop + mBase) / 2, mz] });
  strut(kit, b, P.cable, [mx + 0.17, mBase + 0.3, mz], [mx + 0.14, mTop - 0.1, mz], 0.03, 5);
  b.add(kit.cyl(0.24, 0.24, 0.34, { sides: 18 }), P.dark, { pos: [mx, mTop + 0.02, mz] });
  b.add(kit.box(2.1, 0.85, 0.75, { bevel: 0.09 }), P.hull, { pos: [mx, mTop + 0.4, mz] });
  b.add(kit.box(0.5, 0.3, 0.4, { bevel: 0.04 }), P.dark, { pos: [mx, mTop + 0.95, mz] });
  // SuperCam's big aperture, the two Mastcam eyes, the two small Navcams
  for (const [ex, ey, er] of [[-0.62, 0.42, 0.26], [0.2, 0.46, 0.17], [0.62, 0.46, 0.17], [-0.16, 0.2, 0.08], [0.9, 0.2, 0.08]]) {
    b.add(kit.cyl(er * 1.18, er * 1.18, 0.3, { sides: 24 }), P.dark, { pos: [mx + ex, mTop + ey, mz + 0.42], rot: [Math.PI / 2, 0, 0] });
    b.add(kit.cyl(er, er, 0.06, { sides: 24 }), P.lens, { pos: [mx + ex, mTop + ey, mz + 0.575], rot: [Math.PI / 2, 0, 0] });
  }

  // ROBOTIC ARM, stowed forward: shoulder, upper arm, elbow, forearm, wrist, turret
  const sx = L * 0.3; const az = 1.0; const ay = deckY - 0.15;
  b.add(kit.cyl(0.32, 0.32, 0.76, { sides: 20 }), P.dark, { pos: [sx, ay, az] });
  const elbow = [sx + 2.55, ay - 0.95, az]; const wrist = [sx + 3.55, ay - 1.12, az];
  b.add(kit.tube([V(sx, ay - 0.1, az), V(...elbow)], 0.17, { sides: 14 }), P.hull);
  b.add(kit.cyl(0.26, 0.26, 0.56, { sides: 18 }), P.dark, { pos: elbow, rot: [Math.PI / 2, 0, 0] });
  b.add(kit.tube([V(...elbow), V(...wrist)], 0.14, { sides: 14 }), P.hull);
  strut(kit, b, P.cable, [sx, ay + 0.1, az + 0.2], [elbow[0], elbow[1] + 0.12, az + 0.2], 0.03, 5);
  b.add(kit.cyl(0.46, 0.46, 0.62, { sides: 24 }), P.dark, { pos: [wrist[0] + 0.05, wrist[1] - 0.06, az] });
  for (let i = 0; i < 5; i++) { // the turret's instruments, ranged round it
    const a = (i / 5) * 6.283 + 0.4;
    b.add(kit.box(0.36, 0.46, 0.3, { bevel: 0.04 }), i % 2 ? P.aluDull : P.hull, { pos: [wrist[0] + 0.05 + Math.cos(a) * 0.52, wrist[1] - 0.06, az + Math.sin(a) * 0.52], rot: [0, -a, 0] });
  }
  b.add(kit.cyl(0.07, 0.05, 0.6, { sides: 12 }), P.alu, { pos: [wrist[0] + 0.05, wrist[1] - 0.62, az] }); // the drill

  // RTG: a finned can off the tail, on its mounting frame, with its heat-exchanger plumbing
  const rx = -L * 0.44; const ry = deckY + 0.6;
  b.add(kit.box(0.9, 0.5, 1.5, { bevel: 0.06 }), P.hull, { pos: [-L * 0.34, ry, 0] });
  b.add(kit.cyl(0.62, 0.62, 2.6, { sides: 28 }), P.aluDull, { pos: [rx, ry, 0], rot: [0, 0, Math.PI / 2] });
  for (const e of [-1, 1]) b.add(kit.sphere(0.62, { segments: 16, sx: 0.35 }), P.aluDull, { pos: [rx + e * 1.3, ry, 0] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(kit.box(2.3, 0.05, 0.62, { bevel: 0.01 }), P.alu, { pos: [rx, ry + Math.sin(a) * 0.86, Math.cos(a) * 0.86], rot: [a + Math.PI / 2, 0, 0] });
  }
  for (const s of [-1, 1]) b.add(kit.tube(kit.curve([[rx + 0.9, ry + 0.5, s * 0.5], [rx + 1.2, ry + 0.9, s * 0.7], [-L * 0.3, deckY + 0.9, s * 0.9]], 8), 0.04, { sides: 6 }), P.copper);

  // HIGH-GAIN ANTENNA: the hexagonal plate on its gimbal; plus the UHF helix and a low-gain stub
  b.add(kit.cyl(0.1, 0.12, 0.9, { sides: 12 }), P.hull, { pos: [L * 0.12, deckY + 1.4, -1.1] });
  b.add(kit.sphere(0.17, { segments: 14 }), P.dark, { pos: [L * 0.12, deckY + 1.84, -1.1] });
  b.add(kit.cyl(1.05, 1.05, 0.09, { sides: 6 }), P.hull, { pos: [L * 0.12, deckY + 1.96, -1.1], rot: [-0.35, 0.4, 0] });
  b.add(kit.cyl(0.98, 0.98, 0.02, { sides: 6 }), P.aluDull, { pos: [L * 0.12 + 0.02, deckY + 2.02, -1.12], rot: [-0.35, 0.4, 0] });
  b.add(kit.cyl(0.13, 0.13, 1.1, { sides: 14 }), P.aluDull, { pos: [-L * 0.29, deckY + 1.85, -1.3] });
  b.add(kit.cyl(0.04, 0.04, 0.8, { sides: 8 }), P.alu, { pos: [-L * 0.1, deckY + 1.7, -1.5] });
  // hazard cameras under the front lip
  for (const s of [-1, 1]) { b.add(kit.box(0.26, 0.2, 0.22, { bevel: 0.03 }), P.dark, { pos: [L * 0.335, deckY - 0.55, s * 0.9] }); b.add(kit.cyl(0.07, 0.07, 0.05, { sides: 12 }), P.lens, { pos: [L * 0.335 + 0.14, deckY - 0.55, s * 0.9], rot: [0, 0, Math.PI / 2] }); }
  return b.finish();
}

// ---- mars-helicopter ---------------------------------------------------------------------------------
// Ingenuity: a tissue-box fuselage under a mast, four long carbon legs splayed from the TOP of
// the box, two coaxial rotors turning opposite ways, a solar panel as the hat. It stands on the
// original's painted "H" pad, and its rotors turn.
function marsHelicopter(kit, { rotorSpan = 4 } = {}) {
  const P = palette(kit); const b = kit.builder('mars-helicopter');
  const pad = document.createElement('canvas'); pad.width = pad.height = 512;
  const ctx = pad.getContext('2d');
  ctx.fillStyle = '#5c5852'; ctx.fillRect(0, 0, 512, 512);
  const rand = seededRandom(3);
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${150 + rand() * 60},${90 + rand() * 40},${60 + rand() * 30},${rand() * 0.2})`; ctx.fillRect(rand() * 512, rand() * 512, 2 + rand() * 5, 2 + rand() * 5); }
  ctx.strokeStyle = '#e8e2d6'; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(256, 256, 205, 0, 6.283); ctx.stroke();
  ctx.fillStyle = '#e8e2d6'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 190px "Helvetica Neue", Arial, sans-serif'; ctx.fillText('H', 256, 268);
  b.add(kit.cyl(4.4, 4.5, 0.1, { sides: 56 }), kit.flat(0x55504a, { rough: 0.95 }), { pos: [0, 0.0, 0] });
  // a DISC, not a plane: the pad is round, and a square of painted concrete shows its corners
  b.add(kit.disc(4.4, { sides: 64 }), kit.canvasMat('helipad', pad, { emissive: 0, rough: 0.95, alpha: false }), { pos: [0, 0.06, 0] });

  const bodyY = 1.15;
  b.add(kit.box(0.9, 0.7, 0.55, { bevel: 0.05 }), P.foil, { pos: [0, bodyY + 0.35, 0] });
  b.add(kit.box(0.5, 0.12, 0.4, { bevel: 0.03 }), P.dark, { pos: [0, bodyY - 0.04, 0] });
  b.add(kit.cyl(0.05, 0.05, 0.04, { sides: 12 }), P.lens, { pos: [0.2, bodyY - 0.11, 0.1] });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2; const c = Math.cos(a); const s = Math.sin(a);
    b.add(kit.tube(kit.curve([[c * 0.2, bodyY + 0.78, s * 0.2], [c * 0.75, bodyY + 0.62, s * 0.75], [c * 1.35, 0.5, s * 1.35], [c * 1.5, 0.12, s * 1.5]], 10), [0.04, 0.035, 0.03, 0.028], { sides: 8 }), P.carbon);
    b.add(kit.sphere(0.08, { segments: 10, sy: 0.6 }), P.dark, { pos: [c * 1.5, 0.12, s * 1.5] });
  }
  b.add(kit.cyl(0.045, 0.06, 1.5, { sides: 12 }), P.carbon, { pos: [0, bodyY + 1.3, 0] });
  b.add(kit.cyl(0.13, 0.13, 0.3, { sides: 16 }), P.dark, { pos: [0, bodyY + 0.95, 0] });
  b.add(kit.box(1.5, 0.05, 0.9, { bevel: 0.015 }), P.cell, { pos: [0, bodyY + 2.15, 0] });
  b.add(kit.box(1.56, 0.03, 0.96, { bevel: 0.01 }), P.carbon, { pos: [0, bodyY + 2.115, 0] });
  b.add(kit.cyl(0.012, 0.012, 0.5, { sides: 5 }), P.alu, { pos: [0.5, bodyY + 2.42, 0.2] });
  const root = b.finish();

  // Rotors are their own nodes so they can TURN: one counter-clockwise, one clockwise.
  const spin = [];
  [[bodyY + 1.72, 0, 1], [bodyY + 2.0, Math.PI / 2, -1]].forEach(([y, phase, dir], i) => {
    const rb = kit.builder(`mars-helicopter:rotor${i}`);
    for (const s of [-1, 1]) {
      // a blade: a swept tube squashed flat, so its planform tapers and its tip is rounded
      rb.add(kit.tube([V(s * 0.12, 0, 0), V(s * rotorSpan * 0.18, 0, 0), V(s * rotorSpan * 0.36, 0, 0), V(s * rotorSpan * 0.5, 0, 0)], [0.07, 0.19, 0.15, 0.05], { sides: 12 }), P.carbon, { scale: [1, 0.11, 1], rot: [s * 0.12, 0, 0] });
    }
    rb.add(kit.cyl(0.14, 0.14, 0.2, { sides: 16 }), P.dark, { pos: [0, 0, 0] });
    const rotor = rb.finish();
    rotor.parent = root; rotor.position.y = y; rotor.rotation.y = phase;
    root.metadata.casters.push(...rotor.metadata.casters);
    spin.push([rotor, dir]);
  });
  root.metadata.tick = (dt) => { for (const [rotor, dir] of spin) rotor.rotation.y += dir * dt * 9; };
  root.metadata.instanceable = false;
  return root;
}

// ---- mars-lander -----------------------------------------------------------------------------------------
// A descent stage, still standing where it came down: a foil-wrapped octagonal deck on four
// A-frame legs with dished footpads, descent engines and propellant tanks slung under it, a
// cargo ramp to the ground on +Z, deck boxes, and a solar wing either side.
function marsLander(kit, { deckHeight = 7, deckRadius = 7 } = {}) {
  const P = palette(kit); const b = kit.builder('mars-lander'); const H = deckHeight; const Rr = deckRadius;
  b.add(kit.cyl(Rr, Rr, 1.1, { sides: 8, tile: 1.6 }), P.foil, { pos: [0, H, 0] });
  b.add(kit.cyl(Rr * 0.9, Rr * 0.62, 1.0, { sides: 8, tile: 1.6 }), P.foil, { pos: [0, H - 1.05, 0] });
  b.add(kit.cyl(Rr * 1.02, Rr * 1.02, 0.28, { sides: 8 }), P.dark, { pos: [0, H + 0.6, 0] });
  b.add(kit.cyl(Rr * 0.97, Rr * 0.97, 0.06, { sides: 8 }), P.hull, { pos: [0, H + 0.76, 0] });

  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2; const dx = Math.cos(a); const dz = Math.sin(a);
    const pad = [dx * (Rr + 3.4), 0.4, dz * (Rr + 3.4)];
    // primary strut (with its telescoping crush section) and the two splayed secondaries
    const top = [dx * Rr * 0.7, H - 0.3, dz * Rr * 0.7];
    const midp = [(pad[0] + top[0]) / 2, (pad[1] + top[1]) / 2, (pad[2] + top[2]) / 2];
    strut(kit, b, P.hull, top, midp, 0.26, 16); strut(kit, b, P.alu, midp, pad, 0.17, 16);
    b.add(kit.sphere(0.3, { segments: 14 }), P.dark, { pos: midp });
    for (const s of [-1, 1]) {
      const at = [Math.cos(a + s * 0.62) * Rr * 0.86, H - 1.4, Math.sin(a + s * 0.62) * Rr * 0.86];
      strut(kit, b, P.alu, at, [pad[0] * 0.93, 1.1, pad[2] * 0.93], 0.1, 10);
    }
    b.add(kit.lathe([[0, 0.34], [0.5, 0.34], [1.3, 0.2], [1.45, 0.3], [1.5, 0.22], [1.2, 0], [0, 0]], { sides: 32 }), P.alu, { pos: [pad[0], 0, pad[2]] });
    b.add(kit.sphere(0.26, { segments: 12 }), P.dark, { pos: [pad[0], 0.42, pad[2]] });
  }
  // descent engines: real bells, throats up inside the stage
  const bell = [[0.22, 1.7], [0.3, 1.5], [0.42, 1.15], [0.66, 0.7], [0.92, 0.3], [1.08, 0], [1.02, 0], [0.86, 0.32], [0.6, 0.72], [0.36, 1.16], [0.24, 1.5], [0.16, 1.7]];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2; const x = Math.cos(a) * 3.2; const z = Math.sin(a) * 3.2;
    b.add(kit.lathe(bell, { sides: 36 }), P.dark, { pos: [x, H - 2.15 - 0.85, z] });
    // and between them, a propellant tank in its own foil
    const t = a + Math.PI / 4;
    b.add(kit.sphere(1.25, { segments: 22 }), P.foil, { pos: [Math.cos(t) * 3.9, H - 2.0, Math.sin(t) * 3.9] });
  }
  // the ramp: two channel rails, a tread plate with cleats, hinged off the deck edge on +Z
  const run = 9; const len = Math.hypot(H, run); const pitch = Math.atan2(H, run);
  b.add(kit.box(5.6, 0.16, len, { bevel: 0.03 }), P.aluDull, { pos: [0, H / 2, Rr + 4.0], rot: [pitch, 0, 0] });
  for (const s of [-1, 1]) b.add(kit.box(0.3, 0.55, len, { bevel: 0.05 }), P.hull, { pos: [s * 2.9, H / 2 + 0.16, Rr + 4.0], rot: [pitch, 0, 0] });
  for (let i = 1; i < 14; i++) {
    const f = i / 14 - 0.5;
    b.add(kit.box(5.4, 0.09, 0.16, { bevel: 0.02 }), P.dark, { pos: [0, H / 2 - f * H + 0.13 * Math.cos(pitch), Rr + 4.0 + f * run + 0.13 * Math.sin(pitch)], rot: [pitch, 0, 0] });
  }
  // deck cargo, as the original places it
  b.add(kit.box(3.0, 2.6, 3.0, { bevel: 0.12 }), P.hull, { pos: [-2.2, H + 1.9, -1.4] });
  b.add(kit.box(2.2, 2.0, 2.4, { bevel: 0.1 }), P.trim, { pos: [1.8, H + 1.6, 1.6] });
  b.add(kit.box(2.6, 1.6, 2.6, { bevel: 0.1 }), P.hull, { pos: [2.4, H + 1.4, -2.2] });
  for (const [x, z] of [[-2.2, -1.4], [2.4, -2.2]]) for (const s of [-1, 1]) b.add(kit.box(0.12, 0.5, 0.5, { bevel: 0.02 }), P.dark, { pos: [x + s * 0.6, H + 3.0, z + 1.4] });
  b.add(kit.cyl(0.06, 0.08, 3.4, { sides: 10 }), P.alu, { pos: [-3.4, H + 2.4, 2.6] });
  b.add(kit.lathe([[0, 0], [0.5, 0.06], [0.85, 0.26], [0.9, 0.3], [0.8, 0.27], [0.45, 0.1], [0, 0.05]], { sides: 28 }), P.hull, { pos: [-3.4, H + 4.05, 2.6], rot: [0.5, 0, 0] });
  // solar wings, on booms, framed
  for (const s of [-1, 1]) {
    const cx = s * (Rr + 3.2); const cy = H + 2.6;
    b.add(kit.box(6.5, 0.1, 4.2, { bevel: 0.02 }), P.cell, { pos: [cx, cy, 0], rot: [0, 0, s * 0.3] });
    b.add(kit.box(6.62, 0.06, 4.32, { bevel: 0.02 }), P.aluDull, { pos: [cx + s * 0.02, cy - 0.07, 0], rot: [0, 0, s * 0.3] });
    strut(kit, b, P.alu, [s * Rr * 0.8, H + 0.8, 0], [cx - s * 1.0, cy - 0.45, 0], 0.09, 10);
    for (const zz of [-1.6, 1.6]) strut(kit, b, P.alu, [s * Rr * 0.8, H + 0.8, zz * 0.4], [cx, cy - 0.12, zz], 0.05, 8);
  }
  return b.finish();
}


// A tapering four-legged lattice mast: legs from a square base to a square head, a horizontal
// frame at every level, and a diagonal across every bay. `half` is the base half-width.
function lattice(kit, b, mat, height, half, topHalf, levels, legR = 0.13) {
  const at = (t, sx, sz) => { const h = half + (topHalf - half) * t; return [sx * h, t * height, sz * h]; };
  const C = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of C) strut(kit, b, mat, at(0, sx, sz), at(1, sx, sz), legR, 10);
  for (let i = 1; i <= levels; i++) {
    const t = i / (levels + 1); const t0 = (i - 1) / (levels + 1);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = C[k]; const [bx, bz] = C[(k + 1) % 4];
      strut(kit, b, mat, at(t, ax, az), at(t, bx, bz), legR * 0.55, 6);
      strut(kit, b, mat, at(t0, ax, az), at(t, bx, bz), legR * 0.4, 5);
    }
  }
  for (let k = 0; k < 4; k++) { const [ax, az] = C[k]; const [bx, bz] = C[(k + 1) % 4]; strut(kit, b, mat, at(levels / (levels + 1), ax, az), at(1, bx, bz), legR * 0.4, 5); }
  for (const [sx, sz] of C) b.add(kit.box(0.7, 0.16, 0.7, { bevel: 0.04 }), mat, { pos: [sx * half, 0.08, sz * half] });
}

// ---- comms-relay --------------------------------------------------------------------------------------------
// The marks: a TRUE shallow parabola (deep, it is a bowl on a stick), opening up and toward the
// walk-up on +Z, with its feed held at the focus on a tripod -- f = r^2 / 4d, so the horn is
// where the geometry says the signal converges -- and back-ribs, because a dish that size is a
// structure. The vertex sits exactly on the mount, as the original's cap does.
function commsRelay(kit, { height = 18 } = {}) {
  const P = palette(kit); const b = kit.builder('comms-relay'); const H = height;
  lattice(kit, b, P.aluDull, H, 1.9, 0.32, 5, 0.12);
  b.add(kit.cyl(0.4, 0.52, 1.6, { sides: 24 }), P.hull, { pos: [0, H + 0.3, 0] });
  b.add(kit.sphere(0.5, { segments: 18 }), P.dark, { pos: [0, H + 1.0, 0] });

  const db = kit.builder('comms-relay:dish');
  const r = 7 * Math.sin(Math.PI / 5); const d = 7 * (1 - Math.cos(Math.PI / 5)); const f = (r * r) / (4 * d);
  const prof = []; const back = [];
  for (let i = 0; i <= 14; i++) { const x = (i / 14) * r; prof.push([x, d * (x / r) ** 2]); back.unshift([x, d * (x / r) ** 2 - 0.09]); }
  db.add(kit.lathe([...prof, [r + 0.06, d + 0.03], [r + 0.06, d - 0.12], ...back], { sides: 72 }), P.hull);
  db.add(kit.torus(r + 0.02, 0.16, { sides: 40 }), P.aluDull, { pos: [0, d - 0.03, 0] });
  for (let i = 0; i < 12; i++) { // back ribs, from the hub out to the rim
    const a = (i / 12) * 6.283; const pts = [];
    for (let k = 1; k <= 6; k++) { const x = (k / 6) * r; pts.push(V(Math.cos(a) * x, d * (x / r) ** 2 - 0.2, Math.sin(a) * x)); }
    db.add(kit.tube(pts, [0.09, 0.08, 0.07, 0.06, 0.05, 0.04], { sides: 6 }), P.aluDull);
  }
  db.add(kit.cyl(0.7, 0.45, 0.5, { sides: 24 }), P.dark, { pos: [0, -0.3, 0] });
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283 + 0.5; strut(kit, db, P.alu, [Math.cos(a) * r * 0.92, d * 0.85, Math.sin(a) * r * 0.92], [Math.cos(a) * 0.2, f + 0.1, Math.sin(a) * 0.2], 0.055, 8); }
  db.add(kit.lathe([[0, 0.5], [0.16, 0.5], [0.2, 0.2], [0.42, 0], [0.4, 0], [0.16, 0.18], [0, 0.18]], { sides: 24 }), P.dark, { pos: [0, f - 0.35, 0] });
  db.add(kit.cyl(0.42, 0.42, 0.34, { sides: 24 }), P.dark, { pos: [0, f + 0.32, 0] });
  const dish = db.finish();
  dish.position.set(0, H + 1.0, 0); dish.rotation.set(0.55, 0, 0.15);

  // the equipment shelter and its readout
  b.add(kit.box(3.4, 2.6, 2.2, { bevel: 0.12 }), P.hull, { pos: [3.4, 1.3, 0] });
  b.add(kit.box(3.6, 0.14, 2.4, { bevel: 0.04 }), P.dark, { pos: [3.4, 2.67, 0] });
  for (let i = 0; i < 6; i++) b.add(kit.box(0.05, 1.5, 0.12, { bevel: 0.01 }), P.dark, { pos: [5.11, 1.4, -0.8 + i * 0.32] });
  b.add(kit.box(2.62, 1.72, 0.08, { bevel: 0.03 }), P.dark, { pos: [3.4, 1.6, 1.09] });
  techPanel(kit, b, 'Deep space link', ['TARGET       EARTH', 'DELAY        12 m 43 s', 'DOWNLINK     2.1 Mbps', 'STATUS       LOCKED'], { w: 2.4, h: 1.5, pos: [3.4, 1.6, 1.14], accent: '#5fc4e8' });
  b.add(kit.tube(kit.curve([[1.7, 2.2, 0], [1.2, 1.2, 0.3], [1.6, 0.15, 0.6], [1.9, 0.1, 1.9]], 10), 0.06, { sides: 8 }), P.cable);
  const beacon = kit.flat(0xffb0a0, { rough: 0.3, emissive: 0xff3b2f, emissiveIntensity: 3 });
  b.add(kit.sphere(0.24, { segments: 14 }), beacon, { pos: [0.75, H + 0.9, 0] });
  b.add(kit.cyl(0.04, 0.04, 0.7, { sides: 8 }), P.dark, { pos: [0.75, H + 0.5, 0] });
  const root = b.finish();
  dish.parent = root; root.metadata.casters.push(...dish.metadata.casters);
  root.metadata.lights = [{ pos: [0.75, H + 0.9, 0], color: 0xff5040, intensity: 22, range: 26, always: 0.5 }];
  root.metadata.instanceable = false;
  return root;
}

// ---- weather-mast ---------------------------------------------------------------------------------------------
// A cup anemometer that TURNS, a wind vane, a louvred instrument housing, and a solar panel.
function weatherMast(kit, { height = 12 } = {}) {
  const P = palette(kit); const b = kit.builder('weather-mast'); const H = height;
  b.add(kit.lathe([[0, 0], [1.1, 0], [1.1, 0.12], [0.9, 0.5], [0.3, 0.5], [0.24, 0.9], [0, 0.9]], { sides: 32 }), P.dark);
  b.add(kit.cyl(0.14, 0.2, H, { sides: 20 }), P.hull, { pos: [0, H / 2, 0] });
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283 + 0.5; strut(kit, b, P.alu, [Math.cos(a) * 3.2, 0.05, Math.sin(a) * 3.2], [Math.cos(a) * 0.15, H * 0.62, Math.sin(a) * 0.15], 0.022, 5); }
  b.add(kit.box(0.08, 1.1, 1.8, { bevel: 0.03 }), P.trim, { pos: [0, H - 2.2, 1.3] });
  b.add(kit.box(0.06, 0.1, 2.6, { bevel: 0.02 }), P.hull, { pos: [0, H - 2.2, 0.4] });
  b.add(kit.lathe([[0, 0], [0.07, 0.1], [0.1, 0.4], [0, 0.55]], { sides: 12 }), P.trim, { pos: [0, H - 2.2, -0.95], rot: [-Math.PI / 2, 0, 0] });
  // the instrument housing: a louvred radiation shield over a box, screen to the front
  b.add(kit.box(2.2, 2.0, 1.4, { bevel: 0.1 }), P.dark, { pos: [0, 1.6, 0.9] });
  for (let i = 0; i < 6; i++) b.add(kit.lathe([[0, 0.12], [0.3, 0.12], [0.42, 0], [0.4, 0], [0.28, 0.08], [0, 0.08]], { sides: 24 }), P.hull, { pos: [-0.7, H * 0.45 + i * 0.17, 0] });
  techPanel(kit, b, 'Weather', ['TEMP     −67 °F', 'WIND      19 mph', 'PRESSURE  0.09 psi', 'DUST      MODERATE'], { w: 1.8, h: 1.2, pos: [0, 1.7, 1.625], accent: '#5fc4e8' });
  b.add(kit.box(2.4, 0.1, 1.6, { bevel: 0.02 }), P.cell, { pos: [0, H - 4.2, 0.9], rot: [-0.5, 0, 0] });
  b.add(kit.box(2.5, 0.06, 1.7, { bevel: 0.02 }), P.aluDull, { pos: [0, H - 4.26, 0.87], rot: [-0.5, 0, 0] });
  strut(kit, b, P.alu, [0, H - 4.6, 0.1], [0, H - 4.25, 0.8], 0.05, 8);
  const root = b.finish();

  const cb = kit.builder('weather-mast:cups');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 6.283; const c = Math.cos(a); const s = Math.sin(a);
    strut(kit, cb, P.alu, [0, 0, 0], [c * 1.5, 0, s * 1.5], 0.035, 8);
    // a cup: an open hemisphere, mouth tangential so the wind has something to catch
    cb.add(kit.lathe([[0, 0], [0.2, 0.05], [0.31, 0.2], [0.34, 0.34], [0.31, 0.34], [0.28, 0.2], [0.18, 0.08], [0, 0.04]], { sides: 20 }), P.hull, { pos: [c * 1.5, 0, s * 1.5], rot: [Math.PI / 2, -a, 0] });
  }
  cb.add(kit.cyl(0.2, 0.2, 0.4, { sides: 16 }), P.aluDull);
  const cups = cb.finish();
  cups.parent = root; cups.position.y = H;
  root.metadata.casters.push(...cups.metadata.casters);
  root.metadata.tick = (dt) => { cups.rotation.y -= dt * 2.6; };
  root.metadata.instanceable = false;
  return root;
}

// ---- ice-drill-rig -----------------------------------------------------------------------------------------------
function iceDrillRig(kit, { height = 16 } = {}) {
  const P = palette(kit); const b = kit.builder('ice-drill-rig'); const H = height;
  lattice(kit, b, P.aluDull, H, 3.4, 1.0, 4, 0.16);
  b.add(kit.box(3.0, 0.5, 3.0, { bevel: 0.08 }), P.dark, { pos: [0, H + 0.25, 0] });
  b.add(kit.cyl(0.7, 0.7, 0.3, { sides: 24 }), P.trim, { pos: [0, H + 0.62, 0], rot: [0, 0, Math.PI / 2] }); // crown sheave
  // top drive riding the string, the string itself in jointed lengths, and the bit at the collar
  b.add(kit.box(1.5, 1.7, 1.5, { bevel: 0.1 }), P.trim, { pos: [0, H - 3.2, 0] });
  b.add(kit.cyl(0.5, 0.5, 0.8, { sides: 20 }), P.dark, { pos: [0, H - 4.4, 0] });
  for (const sx of [-1, 1]) strut(kit, b, P.alu, [sx * 0.95, 1.5, 0], [sx * 0.95, H - 0.2, 0], 0.07, 8);
  strut(kit, b, P.cable, [0, H + 0.3, 0], [0, H - 2.3, 0], 0.05, 6);
  b.add(kit.cyl(0.26, 0.26, H - 5.6, { sides: 20 }), P.alu, { pos: [0, (H - 4.8 + 0.8) / 2 + 0.4, 0] });
  for (let y = 3; y < H - 5; y += 2.6) b.add(kit.cyl(0.34, 0.34, 0.36, { sides: 20 }), P.dark, { pos: [0, y, 0] });
  b.add(kit.lathe([[0, 0], [0.42, 0], [0.5, 0.3], [0.62, 0.9], [0.62, 1.6], [0.3, 1.6], [0.3, 1.9], [0, 1.9]], { sides: 28 }), P.trim);
  b.add(kit.cyl(1.5, 1.7, 0.3, { sides: 32 }), P.dark, { pos: [0, 0.15, 0] });
  // spoil heap: what came up the hole, the colour of the ground with darker damp streaks
  b.add(kit.rock(3.4, 17, { segments: 30, squash: 0.3, rough: 0.34 }), P.dustyRock, { pos: [5.2, 0.35, 2.6] });
  b.add(kit.rock(1.5, 19, { segments: 20, squash: 0.35, rough: 0.34 }), P.dustyRock, { pos: [7.6, 0.2, 0.4] });
  // ice cores racked for the lab: pale, glassy, in a steel cradle
  const ice = kit.flat(0xcfe9f5, { rough: 0.08, clearcoat: 0.9, emissive: 0x9fd0e8, emissiveIntensity: 0.18 });
  for (let i = 0; i < 6; i++) {
    b.add(kit.cyl(0.2, 0.2, 3.4, { sides: 20 }), ice, { pos: [-4.6 + i * 0.55, 1.9, -2.8], rot: [0, 0, 0.22] });
    b.add(kit.cyl(0.22, 0.22, 0.12, { sides: 20 }), P.aluDull, { pos: [-4.6 + i * 0.55 + 0.37, 0.25, -2.8], rot: [0, 0, 0.22] });
  }
  b.add(kit.box(4.4, 0.3, 1.0, { bevel: 0.05 }), P.aluDull, { pos: [-3.2, 0.4, -2.8] });
  for (const x of [-5.1, -1.3]) strut(kit, b, P.alu, [x, 0.5, -2.8], [x - 0.45, 3.0, -2.8], 0.06, 8);
  strut(kit, b, P.alu, [-5.55, 3.0, -2.8], [-1.75, 3.0, -2.8], 0.05, 8);
  // water tank: domed ends, straps, a sight glass, and the hose back to the rig
  b.add(kit.cyl(2.0, 2.0, 3.3, { sides: 40 }), P.hull, { pos: [-6.5, 1.85, 3.0] });
  b.add(kit.sphere(2.0, { segments: 28, sy: 0.3 }), P.hull, { pos: [-6.5, 3.5, 3.0] });
  b.add(kit.cyl(2.12, 2.12, 0.3, { sides: 40 }), P.dark, { pos: [-6.5, 0.15, 3.0] });
  for (const y of [1.1, 2.7]) b.add(kit.torus(2.02, 0.09, { sides: 40 }), P.aluDull, { pos: [-6.5, y, 3.0] });
  b.add(kit.tube(kit.curve([[-4.5, 0.7, 3.0], [-3.2, 0.25, 2.2], [-1.6, 0.2, 1.0], [-0.9, 0.5, 0.3]], 12), 0.1, { sides: 10 }), P.cable);
  b.add(kit.box(3.2, 2.1, 0.08, { bevel: 0.03 }), P.dark, { pos: [-6.5, 2.4, 5.02] });
  techPanel(kit, b, 'Ice extraction', ['DEPTH        18 ft', 'CORE TEMP    −58 °F', 'YIELD        41 L / sol', 'PURITY       98 %'], { w: 3.0, h: 1.9, pos: [-6.5, 2.4, 5.07], accent: '#5fc4e8' });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

// ---- greenhouse-tunnel ---------------------------------------------------------------------------------------------
// A pressurised polytunnel, `length` along Z, open to walk into through the ring on +Z. The
// glazing is alpha < 1, so the Builder never makes it a shadow caster and the sun reaches the beds.
function greenhouseTunnel(kit, { length = 26, radius = 7, seed = 9 } = {}) {
  const P = palette(kit); const rand = seededRandom(seed); const b = kit.builder('greenhouse-tunnel'); const L = length; const R = radius;
  const glass = cached(kit, 'tunnel-glass', (name) => {
    const m = new PBRMaterial(name, kit.scene);
    m.albedoColor = linear(0xcfeaf2); m.metallic = 0; m.roughness = 0.08; m.alpha = 0.2; m.backFaceCulling = false;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; m.emissiveColor = linear(0x2f5f6e).scale(0.25);
    m.metadata = { flat: true };
    return m;
  });
  const arc = (r, z, n = 28) => { const pts = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push(V(Math.cos(a) * r, Math.sin(a) * r, z)); } return pts; };
  // the skin, as strips between hoops, each strip a run of flat panes -- which is what ETFE
  // film stretched over hoops actually looks like
  const N = 28;
  const panes = [];
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI; const a1 = ((i + 1) / N) * Math.PI;
    panes.push([V(Math.cos(a0) * R, Math.sin(a0) * R, -L / 2), V(Math.cos(a1) * R, Math.sin(a1) * R, -L / 2), V(Math.cos(a1) * R, Math.sin(a1) * R, L / 2), V(Math.cos(a0) * R, Math.sin(a0) * R, L / 2)]);
  }
  b.add(kit.poly(panes, V(0, 0, 0)), glass);
  for (let i = 0; i <= 5; i++) b.add(kit.tube(arc(R, -L / 2 + (i * L) / 5), 0.12, { sides: 8 }), P.aluDull);
  for (const a of [0.5, Math.PI / 2, Math.PI - 0.5]) strut(kit, b, P.aluDull, [Math.cos(a) * R, Math.sin(a) * R, -L / 2], [Math.cos(a) * R, Math.sin(a) * R, L / 2], 0.07, 6);
  // end walls: a solid bulkhead at the back, a ring with the doorway at the front
  const half = (r) => { const o = []; for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI; o.push([Math.cos(a) * r, Math.sin(a) * r]); } return o; };
  b.add(kit.prism(half(R), 0.25), P.hull, { pos: [0, 0, -L / 2] });
  const door = 3.2;
  for (let i = 0; i < 20; i++) {
    const a0 = (i / 20) * Math.PI; const a1 = ((i + 1) / 20) * Math.PI;
    b.add(kit.prism([[Math.cos(a0) * door, Math.sin(a0) * door], [Math.cos(a0) * R, Math.sin(a0) * R], [Math.cos(a1) * R, Math.sin(a1) * R], [Math.cos(a1) * door, Math.sin(a1) * door]], 0.25), P.hull, { pos: [0, 0, L / 2] });
  }
  b.add(kit.tube(arc(door, L / 2 + 0.05, 24), 0.22, { sides: 12 }), P.trim);
  b.add(kit.box(door * 2 + 0.6, 0.12, 0.7, { bevel: 0.03 }), P.dark, { pos: [0, 0.06, L / 2] });
  b.add(kit.box(2.6, 0.1, L - 1.5, { bevel: 0.02 }), P.aluDull, { pos: [0, 0.06, 0] }); // the aisle's tread plate

  // grow beds, soil, drip lines, grow lights -- and crops that are plants
  const soil = kit.mat('Ground068', { tint: 0x6a4c38, tile: 3 });
  const lamp = kit.flat(0xffd6f0, { rough: 0.3, emissive: 0xff7ad0, emissiveIntensity: 1.6 });
  const cards = new Cards();
  for (const sx of [-1, 1]) {
    b.add(kit.box(3.2, 1.5, L - 3, { bevel: 0.08 }), P.hull, { pos: [sx * 3.0, 0.75, 0] });
    b.add(kit.box(2.8, 0.4, L - 3.4, { bevel: 0.03 }), soil, { pos: [sx * 3.0, 1.5, 0] });
    for (const off of [-0.75, 0.75]) strut(kit, b, P.cable, [sx * 3.0 + off, 1.74, -(L - 4) / 2], [sx * 3.0 + off, 1.74, (L - 4) / 2], 0.03, 5);
    strut(kit, b, lamp, [sx * 3.0, 4.6, -(L - 5) / 2], [sx * 3.0, 4.6, (L - 5) / 2], 0.07, 8);
    for (let z = -(L - 6) / 2; z <= (L - 6) / 2; z += (L - 6) / 4) strut(kit, b, P.alu, [sx * 3.0, 4.6, z], [sx * 4.2, 5.55, z], 0.025, 5);
    const rows = Math.floor((L - 4) / 1.3);
    for (let i = 0; i < rows; i++) {
      const z = -(L - 4) / 2 + i * 1.3;
      for (const off of [-0.75, 0.75]) {
        const c = V(sx * 3.0 + off, 1.72, z); const size = 0.32 + rand() * 0.22;
        cluster(cards, rand, c.add(V(0, size * 0.8, 0)), size, c, 5, size * 2.1);
      }
    }
  }
  const root = b.finish();
  const crops = cards.toMesh('greenhouse-tunnel:crops', kit.scene);
  crops.material = foliageMaterial(kit, 'hedge'); crops.parent = root; crops.receiveShadows = true;
  root.metadata.lights = [{ pos: [0, 4.4, 0], color: 0xff9ad8, intensity: 40, range: 24, always: 0.35 }];
  root.metadata.instanceable = false;
  return root;
}

// ---- phobos-in-sky -----------------------------------------------------------------------------------------------
// A captured asteroid, not a moon-shaped moon: lumpy, 27 x 22 x 18 km in life, with Stickney
// taking a bite out of one end. Centred on its own origin; the layout hangs it at an absolute Y.
function phobosInSky(kit, { radius = 9 } = {}) {
  const b = kit.builder('phobos-in-sky');
  const rock = kit.rock(radius, 23, { segments: 56, squash: 0.78, rough: 0.26 });
  const pos = rock.getVerticesData(VertexBuffer.PositionKind);
  const axis = V(0.82, 0.24, 0.52).normalize(); const rand = seededRandom(29);
  const pits = []; for (let i = 0; i < 26; i++) { const y = rand() * 2 - 1; const a = rand() * 6.283; const r = Math.sqrt(1 - y * y); pits.push([V(Math.cos(a) * r, y, Math.sin(a) * r), 0.05 + rand() * 0.13]); }
  for (let i = 0; i < pos.length; i += 3) {
    const p = V(pos[i], pos[i + 1], pos[i + 2]); const dir = p.clone().normalize();
    let k = 1 - 0.3 * Math.pow(Math.max(0, Vector3.Dot(dir, axis)), 6); // Stickney
    for (const [c, size] of pits) { const dd = 1 - Vector3.Dot(dir, c); if (dd < size * size * 2) k -= 0.05 * (1 - dd / (size * size * 2)) * (size / 0.18); }
    pos[i] *= k; pos[i + 1] *= k; pos[i + 2] *= k;
  }
  rock.setVerticesData(VertexBuffer.PositionKind, pos);
  const nrm = []; VertexData.ComputeNormals(pos, rock.getIndices(), nrm); rock.setVerticesData(VertexBuffer.NormalKind, nrm);
  // fog off: it hangs 270ft out in the dust haze and would otherwise dissolve into the sky
  const mat = kit.mat('Rock030', { tint: 0xc4b6a6, gain: 1.9, tile: 6.66, bump: 1.6 });
  mat.fogEnabled = false; mat.emissiveColor = linear(0x3a332c);
  b.add(rock, mat, { rot: [0.3, -0.7, 0.15] });
  const root = b.finish({ castShadows: false, receiveShadows: false });
  root.metadata.instanceable = false;
  return root;
}

export const MARTIAN_NATIVE = {
  'mars-rover': marsRover,
  'mars-helicopter': marsHelicopter,
  'mars-lander': marsLander,
  'comms-relay': commsRelay,
  'weather-mast': weatherMast,
  'ice-drill-rig': iceDrillRig,
  'greenhouse-tunnel': greenhouseTunnel,
  'phobos-in-sky': phobosInSky,
};

// (kept referenced so tree-shaking and linting leave the imports other builders below use)
export const _martianInternals = { Cards, cluster, foliageMaterial, VertexBuffer, VertexData, MeshBuilder, Mesh, TransformNode };
