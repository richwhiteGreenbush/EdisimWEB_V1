// Props shared by every world: benches, lamp posts, signage, planters.

import { Vector3 } from '@babylonjs/core';
import { shrub } from './Trees.js';
import { linear } from './Kit.js';

// ---- text -------------------------------------------------------------------------------
export function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Shrinks a font until `text` fits `maxWidth` on one line. Every sign in the main app that
// drew type at a fixed size eventually clipped a long line; here it is the only way to draw.
function fitFont(ctx, text, weight, family, start, maxWidth, min = 12) {
  let size = start;
  do { ctx.font = `${weight} ${size}px ${family}`; size -= 2; } while (ctx.measureText(text).width > maxWidth && size > min);
  return size + 2;
}

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Avenir Next", "Segoe UI", Helvetica, Arial, sans-serif';

export function cardCanvas({ eyebrow, title, body, accent = '#8c6b3f' }, w = 704, h = 1024) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const paper = ctx.createLinearGradient(0, 0, 0, h);
  paper.addColorStop(0, '#fbf6e9'); paper.addColorStop(1, '#efe6d0');
  ctx.fillStyle = paper; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, w, 26);
  ctx.strokeStyle = 'rgba(60,40,20,0.35)'; ctx.lineWidth = 3; ctx.strokeRect(18, 44, w - 36, h - 62);
  const pad = 56; let y = 108;
  ctx.textBaseline = 'alphabetic';
  if (eyebrow) {
    ctx.fillStyle = accent; ctx.font = `700 30px ${SANS}`;
    ctx.fillText(eyebrow.toUpperCase().split('').join(' '), pad, y); y += 26;
    ctx.fillRect(pad, y, 90, 5); y += 66;
  }
  ctx.fillStyle = '#2a2017';
  let ts = 64; let titleLines;
  do { ctx.font = `700 ${ts}px ${SERIF}`; titleLines = wrapLines(ctx, title ?? '', w - pad * 2); ts -= 4; } while (titleLines.length > 3 && ts > 34);
  for (const l of titleLines) { ctx.fillText(l, pad, y); y += (ts + 4) * 1.12; }
  y += 22;
  // Fit the body to whatever room the title left.
  let bs = 40; let bodyLines;
  do { ctx.font = `400 ${bs}px ${SERIF}`; bodyLines = wrapLines(ctx, body ?? '', w - pad * 2); bs -= 2; } while (bodyLines.length * (bs + 2) * 1.42 > h - y - 50 && bs > 20);
  ctx.fillStyle = '#3d3226';
  for (const l of bodyLines) { ctx.fillText(l, pad, y + bs); y += (bs + 2) * 1.42; }
  return c;
}

// ---- furniture ----------------------------------------------------------------------------
export function bench(kit, { length = 5 } = {}) {
  const b = kit.builder('bench');
  const wood = kit.mat('Planks012', { tint: 0xf2d6b0, tile: 3.2 });
  const iron = kit.flat(0x1c1f22, { rough: 0.42, metal: 0.9 });
  const L = length;
  // seat slats and back slats, each its own chamfered board with a visible gap between
  for (let i = 0; i < 4; i++) b.add(kit.box(L, 0.11, 0.34, { bevel: 0.025 }), wood, { pos: [0, 1.5, -0.62 + i * 0.4] });
  for (let i = 0; i < 3; i++) b.add(kit.box(L, 0.36, 0.1, { bevel: 0.025 }), wood, { pos: [0, 1.95 + i * 0.44, -0.86 - i * 0.1], rot: [-0.22, 0, 0] });
  // cast-iron end frames: leg, curved arm, back upright
  for (const sx of [-1, 1]) {
    const x = sx * (L / 2 - 0.35);
    b.add(kit.tube(kit.curve([[x, 0, 0.75], [x, 0.9, 0.62], [x, 1.42, 0.7]], 8), 0.07, { sides: 8 }), iron);
    b.add(kit.tube(kit.curve([[x, 0, -0.95], [x, 1.0, -0.8], [x, 2.2, -0.98], [x, 3.25, -1.22]], 12), 0.07, { sides: 8 }), iron);
    b.add(kit.tube(kit.curve([[x, 1.42, 0.7], [x, 2.25, 0.78], [x, 2.42, 0.2], [x, 2.3, -0.92]], 12), 0.06, { sides: 8 }), iron);
    b.add(kit.box(0.14, 0.1, 1.7, { bevel: 0.02 }), iron, { pos: [x, 1.4, -0.1] });
    b.add(kit.box(0.36, 0.06, 0.36, { bevel: 0.02 }), iron, { pos: [x, 0.03, 0.75] });
    b.add(kit.box(0.36, 0.06, 0.36, { bevel: 0.02 }), iron, { pos: [x, 0.03, -0.95] });
  }
  return b.finish();
}

export function lampPost(kit, { height = 11, color = 0xffd9a0, lit = true } = {}) {
  const b = kit.builder('lamp-post');
  const iron = kit.flat(0x15181b, { rough: 0.4, metal: 0.92 });
  const glass = kit.flat(0xfff1cf, { rough: 0.25, emissive: color, emissiveIntensity: 0.0001 });
  const H = height;
  b.add(kit.lathe([[0, 0], [0.62, 0], [0.62, 0.12], [0.5, 0.22], [0.44, 0.9], [0.3, 1.05], [0.26, 1.7], [0.2, 1.85], [0.16, 2.1],
    [0.13, H - 2.2], [0.2, H - 2.05], [0.2, H - 1.9], [0.12, H - 1.75], [0.1, H - 1.45], [0, H - 1.45]], { sides: 20 }), iron);
  // fluting rings
  for (const y of [2.4, H * 0.5, H - 2.6]) b.add(kit.torus(0.17, 0.06, { sides: 16 }), iron, { pos: [0, y, 0] });
  // lantern: cage, glass, cap, finial
  const y0 = H - 1.45;
  b.add(kit.lathe([[0, 0], [0.34, 0], [0.4, 0.08], [0.2, 0.16], [0, 0.16]], { sides: 8 }), iron, { pos: [0, y0, 0] });
  b.add(kit.cyl(0.46, 0.3, 1.05, { sides: 8 }), glass, { pos: [0, y0 + 0.68, 0] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add(kit.tube([[Math.cos(a) * 0.31, y0 + 0.15, Math.sin(a) * 0.31], [Math.cos(a) * 0.47, y0 + 1.2, Math.sin(a) * 0.47]], 0.022, { sides: 5 }), iron);
  }
  b.add(kit.lathe([[0, 0], [0.62, 0], [0.56, 0.08], [0.2, 0.42], [0.08, 0.5], [0.08, 0.62], [0.13, 0.7], [0, 0.86]], { sides: 8 }), iron, { pos: [0, y0 + 1.2, 0] });
  const root = b.finish();
  if (lit) {
    root.metadata.lights = [{ pos: [0, y0 + 0.7, 0], color, intensity: 95, range: 46 }];
    const glow = linear(color);
    root.metadata.nightLights = [(dusk) => { glass.emissiveColor = glow.scale(0.03 + dusk * 5.5); }];
  }
  return root;
}

export function infoPlacard(kit, { title, body, eyebrow, accent = '#8c6b3f', height = 3.2, width = 2.2 } = {}) {
  const b = kit.builder('info-placard');
  const wood = kit.mat('Wood049', { tint: 0xe0bd98, tile: 2.2 });
  const iron = kit.flat(0x1c1f22, { rough: 0.45, metal: 0.9 });
  const face = kit.canvasMat(`placard-${title}`, cardCanvas({ eyebrow, title, body, accent }), { emissive: 0.06 });
  // A lectern: one post, a raked panel at reading height.
  b.add(kit.box(0.28, height * 0.9, 0.28, { bevel: 0.03 }), wood, { pos: [0, height * 0.45, -0.05] });
  b.add(kit.box(0.8, 0.12, 0.8, { bevel: 0.03 }), iron, { pos: [0, 0.06, -0.05] });
  const panelH = width * (1024 / 704);
  const tilt = -0.5;
  const cy = height + 0.35;
  b.add(kit.box(width + 0.22, panelH + 0.22, 0.14, { bevel: 0.03 }), wood, { pos: [0, cy, 0], rot: [tilt, 0, 0] });
  const plane = kit.plane(width, panelH);
  b.add(plane, face, { pos: [0, cy + Math.cos(tilt) * 0 + 0.075 * Math.sin(-tilt), 0.075 * Math.cos(tilt)], rot: [tilt, 0, 0] });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

export function standingSign(kit, { lines = ['SIGN'], subtitle, width = 8, height = 2.4, postHeight = 6.5, face = '#1d3b2a', accent = '#e8c46a' } = {}) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * (height / width));
  const ctx = c.getContext('2d');
  ctx.fillStyle = face; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = accent; ctx.lineWidth = 8; ctx.strokeRect(16, 16, c.width - 32, c.height - 32);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const rows = lines.length + (subtitle ? 0.62 : 0);
  const rowH = (c.height - 70) / rows;
  let y = 35 + rowH / 2;
  ctx.fillStyle = '#fbf3df';
  for (const l of lines) { fitFont(ctx, l, 700, SERIF, rowH * 0.78, c.width - 90); ctx.fillText(l, c.width / 2, y); y += rowH; }
  if (subtitle) { ctx.fillStyle = accent; fitFont(ctx, subtitle, 600, SANS, rowH * 0.36, c.width - 90); ctx.fillText(subtitle, c.width / 2, y - rowH * 0.2); }

  const b = kit.builder('standing-sign');
  const wood = kit.mat('Wood049', { tint: 0xdcb892, tile: 2.4 });
  const faceMat = kit.canvasMat(`sign-${lines.join('-')}`, c, { emissive: 0.22 });
  const cy = postHeight - height / 2;
  for (const sx of [-1, 1]) {
    b.add(kit.box(0.34, postHeight + 0.3, 0.34, { bevel: 0.04 }), wood, { pos: [sx * (width / 2 + 0.22), (postHeight + 0.3) / 2, 0] });
    b.add(kit.lathe([[0, 0], [0.26, 0], [0.2, 0.18], [0, 0.34]], { sides: 4 }), wood, { pos: [sx * (width / 2 + 0.22), postHeight + 0.3, 0], rot: [0, Math.PI / 4, 0] });
  }
  b.add(kit.box(width + 0.1, height + 0.24, 0.2, { bevel: 0.04 }), wood, { pos: [0, cy, 0] });
  b.add(kit.plane(width - 0.1, height), faceMat, { pos: [0, cy, 0.105] });
  b.add(kit.plane(width - 0.1, height), faceMat, { pos: [0, cy, -0.105], rot: [0, Math.PI, 0] });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

export function planter(kit, { size = 3, seed = 3 } = {}) {
  const b = kit.builder('planter');
  const stone = kit.mat('Concrete034', { tint: 0xd9d2c4, tile: 5 });
  const soil = kit.mat('Ground068', { tint: 0x6b5a48, tile: 4 });
  const s = size;
  b.add(kit.box(s, 1.5, s, { bevel: 0.08 }), stone, { pos: [0, 0.75, 0] });
  b.add(kit.box(s + 0.3, 0.22, s + 0.3, { bevel: 0.06 }), stone, { pos: [0, 1.55, 0] });
  b.add(kit.box(s + 0.2, 0.18, s + 0.2, { bevel: 0.05 }), stone, { pos: [0, 0.09, 0] });
  b.add(kit.box(s - 0.5, 0.1, s - 0.5, { bevel: 0.01 }), soil, { pos: [0, 1.64, 0] });
  const root = b.finish();
  const bush = shrub(kit, { radius: s * 0.62, seed });
  bush.parent = root; bush.position.y = 1.5;
  root.metadata.casters.push(...bush.metadata.casters);
  return root;
}

export function trailSign(kit, { arms = [], height = 8 } = {}) {
  const b = kit.builder('trail-sign');
  const wood = kit.mat('Wood049', { tint: 0xdcb892, tile: 2.2 });
  b.add(kit.cyl(0.2, 0.24, height, { sides: 12, tile: 2.2 }), wood, { pos: [0, height / 2, 0] });
  b.add(kit.lathe([[0, 0], [0.3, 0], [0.2, 0.25], [0, 0.45]], { sides: 12 }), wood, { pos: [0, height, 0] });
  arms.forEach((arm, i) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#2f5a3a'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#f3e6c4'; ctx.lineWidth = 6; ctx.strokeRect(9, 9, 494, 110);
    ctx.fillStyle = '#fbf3df'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitFont(ctx, `${arm.label}  →`, 700, SANS, 64, 450);
    ctx.fillText(`${arm.label}  →`, 256, 66);
    const mat = kit.canvasMat(`arm-${arm.label}`, c, { emissive: 0.2 });
    const y = height - 0.9 - i * 0.85;
    // arm.angle is the main app's: the bearing the arm points along, from +X toward -Z.
    const yaw = arm.angle;
    const dir = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    b.add(kit.box(3.0, 0.7, 0.12, { bevel: 0.03 }), wood, { pos: [dir.x * 1.6, y, dir.z * 1.6], rot: [0, yaw, 0] });
    b.add(kit.plane(2.9, 0.62), mat, { pos: [dir.x * 1.6 - dir.z * 0.066, y, dir.z * 1.6 + dir.x * 0.066], rot: [0, yaw, 0] });
  });
  const root = b.finish();
  root.metadata.instanceable = false;
  return root;
}

export function drinkingFountain(kit) {
  const b = kit.builder('drinking-fountain');
  const stone = kit.mat('Concrete034', { tint: 0xcfc9bd, tile: 4 });
  const chrome = kit.flat(0xd8dde2, { rough: 0.18, metal: 1 });
  b.add(kit.lathe([[0, 0], [0.85, 0], [0.85, 0.16], [0.5, 0.3], [0.42, 2.6], [0.75, 2.95], [0.9, 3.15], [0.82, 3.25], [0.3, 3.05], [0, 3.05]], { sides: 28 }), stone);
  b.add(kit.tube(kit.curve([[0.35, 3.1, 0], [0.35, 3.5, 0], [0.12, 3.62, 0], [0, 3.45, 0]], 10), 0.035, { sides: 8 }), chrome);
  b.add(kit.cyl(0.07, 0.07, 0.12, { sides: 10 }), chrome, { pos: [0.62, 3.2, 0], rot: [0, 0, Math.PI / 2] });
  return b.finish();
}

// A glowing sphere on nothing: the app's own fill light.
export function lightOrb(kit, { color = 0xffe2b0 } = {}) {
  const b = kit.builder('light-orb');
  const core = kit.flat(0xffffff, { rough: 0.3, emissive: color, emissiveIntensity: 3.2 });
  b.add(kit.sphere(0.38, { segments: 14 }), core);
  const root = b.finish({ castShadows: false });
  root.metadata.lights = [{ pos: [0, 0, 0], color, intensity: 42, range: 30, always: 0.12 }];
  return root;
}
