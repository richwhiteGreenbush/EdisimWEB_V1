// zero-waste-center: a recycling plant 50ft long and 30ft tall under a barrel-vault roof, with its
// whole front glazed so the sorting floor can be watched from the street. A tilted belt carries mixed
// recycling up into a hopper; it drops onto the sorting belt; three robot arms, one per material, lift
// bottles, cans and paper off it and swing them into their own coloured bins. The arms and every item
// on the belts are ONE mesh, rewritten each frame (see Mover in FutureCivicKit.js).

import * as THREE from 'three';
import { FUTURE } from './TownKit.js';
import { reducedMotion } from '../../Settings.js';
import { FKit, Mover, latheG, ballG, rodG, boxG, ringG, extrudeG, pillG, glassTint, times, drawRecycle } from './FutureCivicKit.js';

const HX = 25; const HZ = 15;
const EAVE = 20; const RISE = 10; // the vault: 20ft walls, 30ft at the ridge
const FLOOR = 0.5;
const BELT_Z = -3; const BELT_TOP = 3.4; const BELT_HW = 1.5; const BELT_X0 = -17; const BELT_X1 = 16;
const ARM_Z = 0.9; const BIN_Z = 4.7; const REACH = 3.75;
const INC_S = new THREE.Vector3(-17.4, 11.4, -10); // the incline's top, inside the hopper
const INC_E = new THREE.Vector3(-2.5, 1.5, -10); // its foot

const TEAL = 0x1fa89c; const CORAL = 0xff7a59; const LIME = 0x86cf45; const VIOLET = 0x7d55e6;
const WHITE = FUTURE.white; const SLATE = 0x4a5570; const SAFETY = 0xffb52e;
const BINS = [
  { name: 'PAPER', color: 0x3f8ff0, glow: 'blue', items: [0xf2f4f7, 0x9fd0ff, 0xd9b98a] },
  { name: 'BOTTLES', color: 0xf2b21b, glow: 'gold', items: [0x45c8e8, 0x6fd38a, 0x9fe6ff] },
  { name: 'CANS', color: 0xe0473c, glow: 'red', items: [0xc7ccd3, 0xe0473c, 0xa9b4c0] },
];
const ARM_X = [-9.5, 0, 9.5];

const vaultY = (z) => EAVE + RISE * Math.sqrt(Math.max(0, 1 - (z / HZ) ** 2));

// Item geometries, centred on their own middle, lying down the way they ride a belt.
const ITEM_SCALE = 1.3;
function bottleG() {
  return latheG([[0, -0.55], [0.22, -0.55], [0.24, -0.45], [0.24, 0.1], [0.12, 0.33], [0.09, 0.42], [0.1, 0.52], [0, 0.52]], 10).rotateZ(Math.PI / 2).scale(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE);
}
function canG() { const g = new THREE.CylinderGeometry(0.2, 0.2, 0.55, 10); g.rotateX(Math.PI / 2); g.scale(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE); return g; }
function paperG() { return boxG(-0.42, 0.42, -0.07, 0.07, -0.33, 0.33).scale(ITEM_SCALE, ITEM_SCALE, ITEM_SCALE); }
const ITEM = [paperG, bottleG, canG];

export function wasteBuild() {
  const K = new FKit({ seed: 733, atlasW: 1024, atlasH: 1024 });
  const rng = K.rng;

  // --- slab, floor and walls ------------------------------------------------------------------
  K.box('body', 0xb9bec8, -HX - 1, HX + 1, -0.4, FLOOR, -HZ - 1, HZ + 1.6);
  K.glowBox('lime', -HX - 1, HX + 1, FLOOR - 0.12, FLOOR - 0.02, HZ + 1.6, HZ + 1.68);
  K.box('paint', 0xd7dbe2, -HX + 0.8, HX - 0.8, FLOOR, FLOOR + 0.04, -HZ + 0.8, HZ - 0.4);
  // safety lines on the sorting floor
  for (const z of [BELT_Z - 2.6, BELT_Z + 2.6 + 0.3]) K.box('paint', SAFETY, -HX + 1.5, HX - 1.5, FLOOR + 0.04, FLOOR + 0.07, z - 0.15, z + 0.15);
  // back wall, teal outside and pale inside
  K.box('body', TEAL, -HX, HX, -0.4, EAVE, -HZ, -HZ + 0.7, { segs: [1, 1, 1] });
  K.box('body', 0xdfe5ec, -HX + 0.8, HX - 0.8, FLOOR, EAVE, -HZ + 0.7, -HZ + 0.8);
  // the two gable ends: the wall rises into the vault's half ellipse
  const gable = [];
  for (let i = 0; i <= 24; i++) {
    const z = -HZ + (i / 24) * HZ * 2;
    gable.push([-z, vaultY(z)]);
  }
  const outline = [[-HZ, -0.4], [HZ, -0.4], ...gable];
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -HX : HX - 0.8;
    const g = extrudeG(outline, x0, x0 + 0.8, { curve: 1 }).rotateY(Math.PI / 2);
    // rotateY(pi/2) took local x to world -z and local z to world x; the outline was written in -z
    K.add('body', g, CORAL);
    // a rainbow of arches on the gable, built proud of it
    const xo = s < 0 ? -HX - 0.12 : HX;
    [0xffc23d, 0x86cf45, 0x45c8e8, 0x8a5cf0].forEach((col, j) => {
      const ao = 12.6 - j * 1.6; const bo = 8.4 - j * 1.6; const ai = ao - 1.3; const bi = bo - 1.3;
      const band = [];
      for (let i = 0; i <= 28; i++) { const t = Math.PI - (i / 28) * Math.PI; band.push([Math.cos(t) * ao, EAVE - 3 + Math.sin(t) * bo]); }
      for (let i = 28; i >= 0; i--) { const t = Math.PI - (i / 28) * Math.PI; band.push([Math.cos(t) * ai, EAVE - 3 + Math.sin(t) * bi]); }
      K.add('body', extrudeG(band, xo, xo + 0.12, { curve: 1 }).rotateY(Math.PI / 2).translate(0, 0, 0), col);
    });
    K.box('body', 0xdfe5ec, s < 0 ? -HX + 0.8 : HX - 0.9, s < 0 ? -HX + 0.9 : HX - 0.8, FLOOR, EAVE - 0.2, -HZ + 0.8, HZ - 0.6);
  }
  // a truck door in the right-hand gable, built forward of it, with a glowing frame
  K.box('body', 0x6f7b93, HX, HX + 0.16, FLOOR, 12, -9, 1);
  for (let y = FLOOR + 0.9; y < 12; y += 0.9) K.box('body', 0x8893aa, HX + 0.16, HX + 0.22, y - 0.08, y, -9, 1);
  K.glowBox('lime', HX, HX + 0.3, 12, 12.35, -9.35, 1.35);
  for (const z of [-9.35, 1]) K.glowBox('lime', HX, HX + 0.3, FLOOR, 12, z, z + 0.35);

  // --- the vault: a crescent of roof swept along X, lime green, with solar panels on its back --
  const outer = []; const inner = [];
  for (let i = 0; i <= 40; i++) {
    const z = HZ + 0.6 - (i / 40) * (HZ + 0.6) * 2;
    const k = Math.sqrt(Math.max(0, 1 - (z / (HZ + 0.6)) ** 2));
    outer.push([-z, EAVE + (RISE + 0.6) * k]);
  }
  for (let i = 40; i >= 0; i--) {
    const z = HZ - (i / 40) * HZ * 2;
    inner.push([-z, vaultY(z) - 0.05]);
  }
  const crescent = [...outer, ...inner];
  K.add('body', extrudeG(crescent, -HX - 0.6, HX + 0.6, { curve: 1 }).rotateY(Math.PI / 2), LIME, { tint: (x, y, z, out, nx, ny, nz) => {
    if (ny < -0.2) { out[0] = 0.78; out[1] = 0.8; out[2] = 0.84; } // the ceiling is pale
  } });
  // eave fascia across the front, violet, with the sign on it
  K.box('body', VIOLET, -HX - 0.6, HX + 0.6, 16.4, EAVE + 0.6, HZ - 0.6, HZ + 0.5);
  K.box('body', times(VIOLET, 0.8), -HX - 0.6, HX + 0.6, 16.1, 16.4, HZ - 0.6, HZ + 0.7);
  const sign = K.rect(900, 150, (c, x, y, w, h) => {
    c.fillStyle = '#132a52'; c.fillRect(x, y, w, h);
    const fam = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
    let px = Math.floor(h * 0.7);
    c.font = `bold ${px}px ${fam}`;
    const word = 'ZERO WASTE';
    const room = w * 0.86;
    if (c.measureText(word).width > room) { px = Math.floor(px * room / c.measureText(word).width); c.font = `bold ${px}px ${fam}`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#b6ff5c'; c.shadowBlur = h * 0.12;
    c.fillStyle = '#d8ff9e'; c.fillText(word, x + w / 2, y + h * 0.55);
    c.shadowBlur = 0;
    for (const sx of [0.04, 0.96]) { c.fillStyle = '#b6ff5c'; c.beginPath(); c.arc(x + w * sx, y + h / 2, h * 0.14, 0, Math.PI * 2); c.fill(); }
  });
  K.screen(sign, 0, 18.3, 21, 3.5, HZ + 0.5, HZ + 0.62);
  // the recycling emblem: a glowing disc standing on the vault above the sign
  const emblem = K.rect(300, 300, (c, x, y, w, h) => {
    const g = c.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w / 2);
    g.addColorStop(0, '#1d4f3a'); g.addColorStop(1, '#0f2a3a');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.shadowColor = '#b6ff5c'; c.shadowBlur = 14;
    drawRecycle(c, x + w / 2, y + h / 2 + w * 0.03, w * 0.36, '#b6ff5c', w * 0.075);
    c.shadowBlur = 0;
  });
  {
    const ER = 3.7; const EY = EAVE + 0.6 + ER + 0.75; const EZ = HZ + 0.15;
    const disc = new THREE.CylinderGeometry(ER, ER, 0.3, 48);
    disc.rotateX(Math.PI / 2);
    disc.translate(0, EY, EZ);
    K.decal(disc, emblem, { edge: 'lime' });
    K.add('paint', new THREE.TorusGeometry(ER + 0.25, 0.32, 10, 48).translate(0, EY, EZ - 0.05), WHITE);
    K.glow('lime', new THREE.TorusGeometry(ER + 0.62, 0.1, 6, 48).translate(0, EY, EZ - 0.05));
    for (const s of [-1, 1]) K.add('paint', pillG(0.7, 1.6, 0.9, 0.3, 0.06).translate(s * 1.7, EAVE + 0.6 + 0.6, EZ - 0.15), WHITE);
  }
  // solar panels in two strips over the back of the vault
  for (let i = 0; i < 9; i++) {
    const x0 = -HX + 1.6 + i * 5.4; const x1 = x0 + 4.9;
    for (let j = 0; j < 3; j++) {
      const z0 = -3 - j * 3.6; const z1 = z0 - 3.2;
      const y0 = vaultY(z0) + 0.65; const y1 = vaultY(z1) + 0.65;
      const ang = Math.atan2(y0 - y1, z0 - z1);
      const m = new THREE.Matrix4().makeRotationX(-ang).setPosition(0, (y0 + y1) / 2 + 0.05, (z0 + z1) / 2);
      K.within(m, () => {
        const len = Math.hypot(y0 - y1, z0 - z1);
        K.box('glass', 0x2a4590, x0, x1, -0.05, 0.08, -len / 2, len / 2, { tint: (x, y, z, out) => { const k = 0.85 + 0.28 * ((Math.floor(x * 1.6) + Math.floor(z * 1.6)) & 1); out[0] *= k; out[1] *= k; out[2] *= k; } });
      });
    }
  }
  K.glow('lime', new THREE.CylinderGeometry(0.16, 0.16, HX * 2 + 1.2, 8).rotateZ(Math.PI / 2).translate(0, EAVE + RISE + 0.62, 0));

  // --- the glass front: clear panes in a white grid ------------------------------------------
  K.box('clear', 0x9fdcf0, -HX + 0.1, HX - 0.1, FLOOR, 16.1, HZ - 0.32, HZ - 0.24);
  for (let x = -HX; x <= HX + 0.01; x += 5) K.box('paint', WHITE, x - (Math.abs(x) > HX - 0.1 ? 0.3 : 0.11), x + (Math.abs(x) > HX - 0.1 ? 0.3 : 0.11), FLOOR, 16.1, HZ - 0.45, HZ - 0.15);
  for (const y of [FLOOR + 0.2, 10.4, 16.0]) K.box('paint', WHITE, -HX, HX, y - 0.12, y + 0.12, HZ - 0.45, HZ - 0.15);
  // a pair of glass doors at the right end, glowing frame
  for (const x of [17.5, 22.5]) K.glowBox('lime', x - 0.2, x + 0.2, FLOOR, 8, HZ - 0.08, HZ);
  K.glowBox('lime', 17.3, 22.7, 8, 8.3, HZ - 0.08, HZ);

  // --- inside: ceiling lights, a big screen on the back wall --------------------------------
  for (const z of [-7, 0, 7]) {
    const y = vaultY(z) - 2.2;
    K.glowBox('white', -18, 18, y, y + 0.3, z - 0.35, z + 0.35);
    for (const x of [-12, 0, 12]) K.rod('paint', SLATE, [x, y + 0.3, z], [x, vaultY(z) - 0.1, z], 0.05, { sides: 6 });
  }
  const board = K.rect(640, 200, (c, x, y, w, h) => {
    c.fillStyle = '#10204a'; c.fillRect(x, y, w, h);
    const fam = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#ffffff'; c.font = `bold ${Math.floor(h * 0.2)}px ${fam}`;
    c.fillText('SAVED TODAY', x + w * 0.05, y + h * 0.2);
    const bars = [['PAPER', 0.92, '#5aa8ff'], ['BOTTLES', 0.81, '#ffd166'], ['CANS', 0.97, '#ff5a50']];
    bars.forEach(([name, v, col], i) => {
      const yy = y + h * (0.44 + i * 0.2);
      c.fillStyle = '#e8f6ff'; c.font = `bold ${Math.floor(h * 0.13)}px ${fam}`;
      c.fillText(name, x + w * 0.05, yy);
      c.fillStyle = '#26335e'; c.fillRect(x + w * 0.3, yy - h * 0.06, w * 0.62, h * 0.12);
      c.fillStyle = col; c.fillRect(x + w * 0.3, yy - h * 0.06, w * 0.62 * v, h * 0.12);
    });
  });
  K.screen(board, 4, 12.5, 16, 5, -HZ + 0.8, -HZ + 0.95);

  // --- the sorting belt -------------------------------------------------------------------------
  const BX0 = BELT_X0 - 1; const BX1 = BELT_X1 + 0.5;
  K.box('paint', SAFETY, BX0, BX1, BELT_TOP - 0.7, BELT_TOP - 0.05, BELT_Z - BELT_HW - 0.3, BELT_Z - BELT_HW);
  K.box('paint', SAFETY, BX0, BX1, BELT_TOP - 0.7, BELT_TOP - 0.05, BELT_Z + BELT_HW, BELT_Z + BELT_HW + 0.3);
  K.box('paint', 0x2f3238, BX0, BX1, BELT_TOP - 0.45, BELT_TOP, BELT_Z - BELT_HW, BELT_Z + BELT_HW, { tint: (x, y, z, out) => { if (Math.abs(((x + 100) % 1.2) - 0.6) < 0.05) { out[0] *= 1.6; out[1] *= 1.6; out[2] *= 1.6; } } });
  K.glowBox('cyan', BX0, BX1, BELT_TOP - 0.3, BELT_TOP - 0.15, BELT_Z + BELT_HW + 0.3, BELT_Z + BELT_HW + 0.36);
  for (let x = BX0 + 1; x < BX1; x += 4.5) for (const s of [-1, 1]) K.box('paint', SLATE, x - 0.2, x + 0.2, FLOOR, BELT_TOP - 0.7, BELT_Z + s * (BELT_HW + 0.15) - 0.2, BELT_Z + s * (BELT_HW + 0.15) + 0.2);
  // the hopper at its head, fed by the incline
  {
    const hx = -18.4; const hz = BELT_Z;
    K.add('paint', latheG([[0, 4.3], [1.4, 4.3], [1.4, 5.4], [3.6, 9.6], [3.6, 12.6], [3.2, 12.6], [3.2, 12.2], [0, 12.2]], 28).translate(hx, 0, hz), VIOLET);
    K.glow('pink', ringG(3.62, 0.1, 9.8, { x: hx, z: hz, radial: 6, tubular: 40 }));
    for (const [sx, sz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) K.rod('paint', SLATE, [hx + sx, FLOOR, hz + sz], [hx + sx * 1.05, 8.2, hz + sz * 1.05], 0.2, { sides: 8 });
    const label = K.textRect('MIXED', 4, 1.1, { bg: '#4b2a9c', fg: '#ffffff', size: 0.75 });
    const m = new THREE.Matrix4().makeRotationX(-0.42).setPosition(hx, 8.2, hz + 2.85);
    K.within(m, () => K.screen(label, 0, 0, 3.4, 0.95, 0, 0.1));
  }
  // the sorter at its tail
  {
    const g = pillG(6, 8.5, 6.2, 1.2, 0.15); g.translate(19.5, FLOOR + 4.25, BELT_Z - 0.4);
    K.add('paint', g, 0xe04fb4);
    const label = K.textRect('SORTER 3000', 5, 1.2, { bg: '#2a1240', fg: '#ff9fe0' });
    K.screen(label, 19.5, 7.0, 4.6, 1.1, BELT_Z + 2.7, BELT_Z + 2.82);
    const eye = K.rect(128, 128, (c, x, y, w, h) => {
      c.fillStyle = '#2a1240'; c.fillRect(x, y, w, h);
      c.fillStyle = '#5cf2ff'; c.beginPath(); c.arc(x + w * 0.32, y + h / 2, w * 0.14, 0, Math.PI * 2); c.arc(x + w * 0.68, y + h / 2, w * 0.14, 0, Math.PI * 2); c.fill();
    });
    K.screen(eye, 19.5, 4.9, 2.6, 2.0, BELT_Z + 2.7, BELT_Z + 2.82);
    K.glowBox('cyan', 16.42, 16.5, BELT_TOP - 0.2, BELT_TOP + 1.6, BELT_Z - BELT_HW, BELT_Z + BELT_HW);
  }
  // the incline belt up into the hopper, and the tipping bin at its foot
  const incDir = INC_E.clone().sub(INC_S);
  const incLen = incDir.length();
  const incAng = Math.atan2(incDir.y, incDir.x);
  const incM = new THREE.Matrix4().makeRotationZ(incAng).setPosition(INC_S.x, INC_S.y, INC_S.z);
  K.within(incM, () => {
    K.box('paint', 0x2f3238, 0, incLen + 0.6, -0.4, 0, -1.3, 1.3);
    for (const s of [-1, 1]) K.box('paint', 0x45c8e8, 0, incLen + 0.6, -0.6, 0.35, s * 1.3, s * 1.6);
  });
  for (const t of [0.22, 0.52, 0.8]) {
    const p = INC_S.clone().lerp(INC_E, t);
    for (const s of [-1, 1]) K.rod('paint', SLATE, [p.x, FLOOR, p.z + s * 1.1], [p.x, p.y - 0.6, p.z + s * 1.1], 0.16, { sides: 8 });
  }
  {
    const g = pillG(3.6, 2.6, 3.8, 0.5, 0.1); g.translate(-0.4, FLOOR + 1.3, -10);
    K.add('paint', g, 0x45c8e8);
    const label = K.textRect('DROP OFF', 3.4, 0.8, { bg: '#0d5a6a', fg: '#ffffff' });
    K.screen(label, -0.4, FLOOR + 1.5, 3.2, 0.75, -10 + 1.9, -10 + 2.0);
  }

  // --- the three bins, each under its arm, labelled in light, with a heap of its material ----
  BINS.forEach((b, i) => {
    const x = ARM_X[i]; const z = BIN_Z;
    const w = 5.2; const d = 3.8; const h = 3.3; const t = 0.25;
    K.box('paint', b.color, x - w / 2, x + w / 2, FLOOR, FLOOR + 0.3, z - d / 2, z + d / 2);
    K.box('paint', b.color, x - w / 2, x + w / 2, FLOOR, FLOOR + h, z + d / 2 - t, z + d / 2);
    K.box('paint', b.color, x - w / 2, x + w / 2, FLOOR, FLOOR + h, z - d / 2, z - d / 2 + t);
    for (const s of [-1, 1]) K.box('paint', b.color, x + s * w / 2 - (s > 0 ? t : 0), x + s * w / 2 + (s > 0 ? 0 : t), FLOOR, FLOOR + h, z - d / 2, z + d / 2);
    K.box('paint', times(b.color, 0.75), x - w / 2 - 0.08, x + w / 2 + 0.08, FLOOR + h - 0.25, FLOOR + h + 0.08, z - d / 2 - 0.08, z + d / 2 + 0.08);
    // the heap: a mound of the bin's colour with a few items lying on it
    K.add('paint', ballG(x, FLOOR + h - 0.9, z, 2.1, { sx: 1.1, sy: 0.4, sz: 0.75, w: 14, h: 8 }), times(b.items[0], 0.85));
    for (let k = 0; k < 6; k++) {
      const g = ITEM[i]();
      g.rotateY(rng() * Math.PI);
      g.translate(x + (rng() - 0.5) * 3.2, FLOOR + h - 0.25 + rng() * 0.25, z + (rng() - 0.5) * 2.0);
      K.add('paint', g, b.items[k % 3]);
    }
    const label = K.textRect(b.name, 4.4, 1.0, { bg: '#' + new THREE.Color(b.color).multiplyScalar(0.32).getHexString(), fg: '#ffffff', size: 0.72 });
    K.screen(label, x, FLOOR + 1.6, 4.0, 0.95, z + d / 2, z + d / 2 + 0.08);
    K.glowBox(b.glow, x - w / 2, x + w / 2, FLOOR + h + 0.08, FLOOR + h + 0.18, z + d / 2 - 0.02, z + d / 2 + 0.1);
    // the arm's pedestal
    K.add('paint', latheG([[0, FLOOR], [1.15, FLOOR], [1.15, FLOOR + 0.45], [0.7, FLOOR + 0.7], [0.7, 2.25], [0, 2.25]], 20).translate(x, 0, ARM_Z), SLATE);
  });

  const { group } = K.finish();

  // --- everything that moves: one mesh --------------------------------------------------------
  const mv = new Mover();
  const arms = BINS.map((b, i) => {
    const x = ARM_X[i];
    const p = mv.part();
    const col = b.color;
    const sh = [x, 3.3, ARM_Z]; const el = [x, 6.6, ARM_Z - 1.4]; const wr = [x, 5.2, ARM_Z - REACH];
    mv.add(p, latheG([[0, 2.25], [0.78, 2.25], [0.78, 2.95], [0, 2.95]], 18).translate(x, 0, ARM_Z), col);
    mv.add(p, ballG(...sh, 0.66, { w: 14, h: 9 }), WHITE);
    mv.add(p, rodG(sh, el, 0.44, { r2: 0.36, sides: 12 }), col);
    mv.add(p, ballG(...el, 0.52, { w: 12, h: 8 }), WHITE);
    mv.add(p, rodG(el, wr, 0.34, { r2: 0.28, sides: 12 }), col);
    mv.add(p, ballG(...wr, 0.32, { w: 10, h: 7 }), SLATE);
    for (const s of [-1, 1]) mv.add(p, boxG(x + s * 0.2 - 0.06, x + s * 0.2 + 0.06, wr[1] - 0.75, wr[1] - 0.1, wr[2] - 0.07, wr[2] + 0.07), 0xdfe4ea);
    // what it is carrying, held between the fingers
    const g = ITEM[i](); g.rotateY(Math.PI / 2); g.translate(x, wr[1] - 0.72, wr[2]);
    mv.add(p, g, b.items[1]);
    return { p, x, phase: i * 2.1, speed: 0.55 + i * 0.07 };
  });
  // items riding the two belts
  const riders = [];
  for (let k = 0; k < 15; k++) {
    const kind = k % 3; const p = mv.part();
    mv.add(p, ITEM[kind](), BINS[kind].items[(k * 7) % 3]);
    riders.push({ p, belt: 'sort', s: k / 15, kind, dz: (rng() - 0.5) * 1.4, yaw: rng() * Math.PI });
  }
  for (let k = 0; k < 9; k++) {
    const kind = (k + 1) % 3; const p = mv.part();
    mv.add(p, ITEM[kind](), BINS[kind].items[(k * 5) % 3]);
    riders.push({ p, belt: 'up', s: k / 9, kind, dz: (rng() - 0.5) * 1.2, yaw: rng() * Math.PI });
  }
  const moving = mv.finish(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12 }), new THREE.Sphere(new THREE.Vector3(0, 6, -3), 30));
  const movers = new THREE.Group();
  movers.add(moving);
  group.add(movers);

  const Y = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion(); const one = new THREE.Vector3(1, 1, 1); const v = new THREE.Vector3();
  const qy = new THREE.Quaternion(); const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), incAng);
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const pose = (t) => {
    for (const a of arms) {
      const yaw = Math.PI * (0.5 - 0.5 * Math.cos(t * a.speed + a.phase));
      const lift = 0.7 * Math.sin(yaw);
      mv.mats[a.p].copy(T(a.x, lift, ARM_Z)).multiply(new THREE.Matrix4().makeRotationAxis(Y, yaw)).multiply(T(-a.x, 0, -ARM_Z));
    }
    const sortLen = BELT_X1 - BELT_X0;
    for (const r of riders) {
      const s = (r.s + t * (r.belt === 'sort' ? 1.5 / sortLen : 1.3 / incLen)) % 1;
      qy.setFromAxisAngle(Y, r.yaw);
      if (r.belt === 'sort') {
        const lie = (r.kind === 0 ? 0.07 : r.kind === 1 ? 0.24 : 0.2) * ITEM_SCALE;
        v.set(BELT_X0 + s * sortLen, BELT_TOP + lie, BELT_Z + r.dz);
        q.copy(qy);
      } else {
        const lie = (r.kind === 0 ? 0.07 : 0.22) * ITEM_SCALE;
        v.copy(INC_E).lerp(INC_S, s);
        v.y += lie / Math.cos(incAng); v.z += r.dz;
        q.copy(qz).multiply(qy);
      }
      mv.mats[r.p].compose(v, q, one);
    }
    mv.write();
  };
  let clock = 0;
  pose(0);
  group.userData.tick = {
    update(dt) {
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      clock += reducedMotion() ? step * 0.12 : step;
      pose(clock);
    },
    dispose() {},
  };
  return group;
}
