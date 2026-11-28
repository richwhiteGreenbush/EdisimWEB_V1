// future-school: a round school about 62ft across. A ring of six classroom wings, each its own
// colour of the rainbow, round a courtyard with a tree; a white entrance block under a giant curved
// screen; a green roof of garden beds with a little solar canopy; and a glass robotics lab whose robot
// arm swings and nods by itself.

import * as THREE from 'three';
import { FUTURE } from './TownKit.js';
import { reducedMotion } from '../../Settings.js';
import { FKit, Mover, polarG, latheG, ballG, rodG, boxG, ringG, tubeG, glassTint, times, drawStar } from './FutureCivicKit.js';

const DEG = Math.PI / 180;
const R_IN = 14;
const R_OUT = 23;
const FLOOR = 0.5;
const ROOF = 14.4;
const PLINTH = 31;
const ENTRY = 24 * DEG; // the entrance block spans -ENTRY..ENTRY

const WINGS = [
  { color: 0xe8503f, glow: 'red', name: 'ART' },
  { color: 0xff8c2e, glow: 'orange', name: 'MUSIC' },
  { color: 0xffc93d, glow: 'yellow', name: 'MATH' },
  { color: 0x7cc943, glow: 'lime', name: 'NATURE' },
  { color: 0x3f8ff0, glow: 'blue', name: 'CODING' },
  { color: 0x8d5cf0, glow: 'violet', name: 'SPACE' },
];
const LAB_A = 50 * DEG;
const LAB_R = 27.2;
const LAB_DOME = 6.2;

const PEARL = FUTURE.pearl;
const WHITE = FUTURE.white;

export function schoolBuild() {
  const K = new FKit({ seed: 611, atlasW: 1024, atlasH: 1024 });

  // --- the plinth, with a glowing edge --------------------------------------------------------
  K.add('body', latheG([[0, -0.4], [PLINTH, -0.4], [PLINTH, 0.32], [PLINTH - 0.3, FLOOR], [0, FLOOR]], 96), 0xc9ccd3);
  K.glowPolar('cyan', PLINTH - 0.9, PLINTH - 0.55, FLOOR - 0.05, FLOOR + 0.06, 0, Math.PI * 2, { segs: 96 });
  // a path of coloured stepping tiles up to the door
  for (let i = 0; i < 5; i++) {
    const z = PLINTH - 2.2 - i * 1.7;
    K.add('paint', boxG(-3.2, 3.2, FLOOR, FLOOR + 0.06, z - 0.6, z + 0.6), WINGS[i % 6].color);
  }

  // --- six classroom wings --------------------------------------------------------------------
  const span = (Math.PI * 2 - ENTRY * 2) / WINGS.length;
  WINGS.forEach((w, k) => {
    const a0 = ENTRY + k * span; const a1 = a0 + span;
    const c = w.color;
    const shade = times(c, 0.72);
    // the wing itself: a solid, its top under the green roof
    K.polar('body', c, R_IN, R_OUT, FLOOR, ROOF, a0, a1);
    // a darker base course
    K.polar('body', shade, R_OUT, R_OUT + 0.35, FLOOR, 1.7, a0, a1);
    // windows in bays, built forward of the coloured wall, each in a white frame, with a lighter
    // fin of the wing's colour between bays
    const light = times(c, 1.18);
    const arc = (a1 - a0) * R_OUT;
    const bays = Math.max(3, Math.round(arc / 5.4));
    const da = (a1 - a0) / bays;
    const fw = 0.28 / R_OUT;
    for (let b = 0; b < bays; b++) {
      const mid = a0 + (b + 0.5) * da;
      const hw = da * 0.31;
      if (k === 0 && Math.abs(mid - LAB_A) < 9 * DEG) {
        // the lab's door into the wing
        K.polar('glass', 0x23405a, R_OUT, R_OUT + 0.08, FLOOR, 8.5, mid - hw, mid + hw, { segs: 3, tint: glassTint(FLOOR, 8.5, 0x23405a, 0x3c6a8a) });
        continue;
      }
      K.polar('glass', FUTURE.glass, R_OUT, R_OUT + 0.08, 3.4, 10.6, mid - hw, mid + hw, { segs: 3, tint: glassTint(3.4, 10.6) });
      K.polar('body', WHITE, R_OUT, R_OUT + 0.5, 3.1, 3.4, mid - hw - fw, mid + hw + fw, { segs: 3 }); // sill
      K.polar('body', WHITE, R_OUT, R_OUT + 0.2, 10.6, 10.9, mid - hw - fw, mid + hw + fw, { segs: 3 }); // head
      for (const s of [-1, 1]) K.polar('body', WHITE, R_OUT, R_OUT + 0.2, 3.4, 10.6, mid + s * hw - (s > 0 ? 0 : fw), mid + s * hw + (s > 0 ? fw : 0), { segs: 1 }); // jambs
      K.polar('body', light, R_OUT, R_OUT + 0.45, 1.7, 11.8, a0 + b * da - fw, a0 + b * da + fw, { segs: 1 }); // fin
    }
    // a curved sunshade over the windows in the wing's colour, and glowing lines above it
    K.polar('body', light, R_OUT, R_OUT + 2.1, 11.8, 12.3, a0, a1);
    K.glowPolar(w.glow, R_OUT + 2.1, R_OUT + 2.2, 11.85, 12.25, a0, a1, { segs: 10 });
    K.glowPolar(w.glow, R_OUT, R_OUT + 0.1, 13.0, 13.35, a0, a1, { segs: 10 });
    // inside face: a band of glass onto the courtyard
    K.polar('glass', FUTURE.glass, R_IN - 0.08, R_IN, 2.9, 11.3, a0 + 0.02, a1 - 0.02, { tint: glassTint(2.9, 11.3) });
    // a nameplate on the parapet
    const label = K.textRect(w.name, 9, 1.6, { bg: '#' + new THREE.Color(c).getHexString(), fg: '#ffffff', size: 0.74, pxPerFt: 48 });
    K.polarScreen(label, R_OUT + 0.4, R_OUT + 0.52, ROOF + 0.25, ROOF + 1.85, (a0 + a1) / 2, 9 / (R_OUT + 0.5), { segs: 8 });
  });
  // round white columns where two wings meet
  for (let k = 0; k <= WINGS.length; k++) {
    const a = ENTRY + k * span;
    const x = (R_OUT + 0.2) * Math.sin(a); const z = (R_OUT + 0.2) * Math.cos(a);
    K.add('body', latheG([[0, FLOOR], [0.95, FLOOR], [0.95, ROOF + 2.5], [0.7, ROOF + 2.85], [0, ROOF + 2.85]], 14).translate(x, 0, z), WHITE);
    K.glow('cyan', ballG(x, ROOF + 3.05, z, 0.42, { w: 8, h: 6 }));
  }

  // --- the parapets and the green roof --------------------------------------------------------
  K.polar('body', WHITE, R_OUT - 0.4, R_OUT + 0.4, ROOF, ROOF + 2.1, ENTRY, Math.PI * 2 - ENTRY, { segs: 90 });
  K.polar('body', WHITE, R_IN - 0.3, R_IN + 0.4, ROOF, ROOF + 1.0, 0, Math.PI * 2, { segs: 72 });
  K.polar('paint', 0x5fae45, R_IN + 0.4, R_OUT - 0.4, ROOF, ROOF + 0.45, 0, Math.PI * 2, { segs: 90, tint: (x, y, z, out) => {
    const n = Math.sin(x * 0.9) * Math.cos(z * 0.7) * 0.06;
    out[0] *= 1 + n; out[1] *= 1 + n * 0.6; out[2] *= 1 + n;
  } });
  // garden beds: raised timber planters with soil and plants, all the way round
  const PLANT = [0x3fa34d, 0x56b84a, 0x2f8f45];
  const FLOWER = [0xff6f91, 0xffc23d, 0xb48cff, 0xff8a3d, 0xffffff];
  const bedRs = [[15.6, 18.0], [19.2, 21.6]];
  for (let i = 0; i < 14; i++) {
    const ac = i * (Math.PI * 2 / 14) + 0.11;
    if (Math.abs(Math.atan2(Math.sin(ac - Math.PI), Math.cos(ac - Math.PI))) < 0.5) continue; // the solar canopy's spot
    const [r0, r1] = bedRs[i % 2];
    const half = 2.3 / ((r0 + r1) / 2);
    K.polar('paint', 0xb57a48, r0, r1, ROOF + 0.45, ROOF + 1.3, ac - half, ac + half, { segs: 4 });
    K.polar('paint', 0x6b4a2e, r0 + 0.2, r1 - 0.2, ROOF + 1.3, ROOF + 1.36, ac - half + 0.012, ac + half - 0.012, { segs: 4 });
    for (let p = 0; p < 3; p++) {
      const a = ac - half * 0.65 + (p / 2) * half * 1.3;
      const rr = (r0 + r1) / 2 + (K.rng() - 0.5) * 0.9;
      const x = rr * Math.sin(a); const z = rr * Math.cos(a);
      const s = 0.45 + K.rng() * 0.25;
      K.add('paint', ballG(x, ROOF + 1.4 + s * 0.6, z, s, { w: 7, h: 5, sy: 1.25 }), PLANT[(i + p) % 3]);
      if ((i + p) % 2 === 0) K.ball('paint', FLOWER[(i * 3 + p) % FLOWER.length], x + 0.2, ROOF + 1.6 + s * 1.3, z, 0.22, { w: 6, h: 4 });
    }
  }
  // the solar canopy at the back of the roof: four posts and a tilted array of panels
  {
    const cz = -(R_IN + R_OUT) / 2; const w = 11; const d = 6.5; const y = ROOF + 4.2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.rod('paint', 0xdfe4ea, [sx * (w / 2 - 0.6), ROOF + 0.45, cz + sz * (d / 2 - 0.6)], [sx * (w / 2 - 0.6), y + (sz > 0 ? 0.7 : -0.7), cz + sz * (d / 2 - 0.6)], 0.14, { sides: 8 });
    const tilt = new THREE.Matrix4().makeRotationX(-0.22).setPosition(0, y, cz);
    K.within(tilt, () => {
      K.box('paint', 0xdfe4ea, -w / 2, w / 2, -0.14, 0.02, -d / 2, d / 2);
      for (let ix = 0; ix < 4; ix++) for (let iz = 0; iz < 2; iz++) {
        const x0 = -w / 2 + 0.2 + ix * ((w - 0.4) / 4); const x1 = x0 + (w - 0.4) / 4 - 0.15;
        const z0 = -d / 2 + 0.2 + iz * ((d - 0.4) / 2); const z1 = z0 + (d - 0.4) / 2 - 0.15;
        K.box('glass', 0x27408c, x0, x1, 0.02, 0.08, z0, z1, { tint: (x, yy, z, out) => { const k = 0.85 + 0.3 * (((Math.floor(x * 2.5) + Math.floor(z * 2.5)) & 1)); out[0] *= k; out[1] *= k; out[2] *= k; } });
      }
      K.glowBox('cyan', -w / 2, w / 2, -0.14, 0.0, d / 2 - 0.08, d / 2);
    });
  }

  // --- the courtyard: a lawn and a tree whose crown rises over the roof -----------------------
  K.polar('paint', 0x6fbf4a, 0, R_IN - 0.1, FLOOR, FLOOR + 0.08, 0, Math.PI * 2, { segs: 48 });
  K.add('paint', tubeG([[0, FLOOR, 0], [0.2, 5, 0.1], [-0.1, 10, 0], [0, 14, 0.2]], [1.0, 0.8, 0.6, 0.45], { sides: 10, round: 0 }), 0x7a5536);
  const CROWN = [[0, 19.8, 0, 4.4], [3.6, 17.6, 1.0, 3.2], [-3.4, 18.0, -1.2, 3.3], [1.2, 17.4, -3.5, 3.1], [-1.6, 17.2, 3.3, 3.2], [2.6, 21.0, -1.8, 2.8], [-2.4, 21.4, 1.8, 2.7], [0.3, 23.4, 0.2, 2.6]];
  const leafTint = (px, py, pz, out) => { const k = 0.82 + 0.3 * Math.max(0, Math.min(1, (py - 15) / 10)); out[0] *= k; out[1] *= k; out[2] *= k; };
  CROWN.forEach(([x, y, z, r], i) => K.add('paint', ballG(x, y, z, r, { w: 12, h: 8 }), [0x4ea84a, 0x3f9a44, 0x5bb54e][i % 3], { tint: leafTint }));
  // blossoms dotted over the crown, sat into its surface
  for (let i = 0; i < 16; i++) {
    const [x, y, z, r] = CROWN[i % CROWN.length];
    const th = K.rng() * Math.PI * 2; const ph = 0.15 + K.rng() * 1.1;
    const d = r * 0.97;
    K.ball('paint', [0xff7eb6, 0xffd166, 0xffffff][i % 3], x + Math.cos(th) * Math.cos(ph) * d, y + Math.sin(ph) * d, z + Math.sin(th) * Math.cos(ph) * d, 0.42, { w: 6, h: 4 });
  }

  // --- the entrance block, its door, and the giant screen over it ----------------------------
  const ER = R_OUT + 1.0;
  K.polar('body', PEARL, R_IN, ER, FLOOR, 17, -ENTRY, ENTRY, { segs: 24 });
  K.polar('body', WHITE, ER - 0.3, ER + 0.3, 16.6, 17.4, -ENTRY - 0.01, ENTRY + 0.01, { segs: 24 });
  K.polar('body', times(PEARL, 0.8), ER, ER + 0.3, FLOOR, 1.5, -ENTRY, ENTRY, { segs: 24 });
  // doors: two glass leaves in a glowing frame, built forward of the wall
  const DW = 5.2 / ER; const DH = 9.2;
  K.polar('body', 0x2c3550, ER, ER + 0.18, FLOOR, DH + 0.5, -DW - 0.03, DW + 0.03, { segs: 6 });
  K.polar('glass', 0x2b5876, ER + 0.18, ER + 0.26, FLOOR, DH, -DW + 0.004, -0.006, { segs: 3, tint: glassTint(FLOOR, DH, 0x2b5876, 0x7cb5d8) });
  K.polar('glass', 0x2b5876, ER + 0.18, ER + 0.26, FLOOR, DH, 0.006, DW - 0.004, { segs: 3, tint: glassTint(FLOOR, DH, 0x2b5876, 0x7cb5d8) });
  K.glowPolar('cyan', ER + 0.18, ER + 0.34, FLOOR, DH + 0.35, -DW - 0.012, -DW + 0.004, { segs: 1 });
  K.glowPolar('cyan', ER + 0.18, ER + 0.34, FLOOR, DH + 0.35, DW - 0.004, DW + 0.012, { segs: 1 });
  K.glowPolar('cyan', ER + 0.18, ER + 0.34, DH, DH + 0.35, -DW - 0.012, DW + 0.012, { segs: 6 });
  for (const s of [-1, 1]) K.rod('paint', 0xdfe4ea, [s * 0.9 * Math.sin(0.03), 4.2, ER + 0.42], [s * 0.9 * Math.sin(0.03) + s * 0.01, 5.8, ER + 0.42], 0.08, { sides: 8 }); // handles
  // a curved canopy over the door on two slim posts
  K.polar('body', WHITE, ER, ER + 4.6, DH + 1.3, DH + 1.85, -DW - 0.12, DW + 0.12, { segs: 10 });
  K.glowPolar('aqua', ER + 0.5, ER + 4.4, DH + 1.25, DH + 1.3, -DW - 0.06, DW + 0.06, { segs: 10 });
  for (const s of [-1, 1]) {
    const a = s * (DW + 0.06); const r = ER + 4.2;
    K.rod('paint', 0xdfe4ea, [r * Math.sin(a), FLOOR, r * Math.cos(a)], [r * Math.sin(a), DH + 1.3, r * Math.cos(a)], 0.16, { sides: 10 });
  }
  // tall windows either side of the door
  for (const s of [-1, 1]) {
    for (let j = 0; j < 2; j++) {
      const b0 = DW + 0.05 + j * 0.13; const b1 = b0 + 0.11;
      const lo = s > 0 ? b0 : -b1; const hi = s > 0 ? b1 : -b0;
      K.polar('glass', FUTURE.glass, ER, ER + 0.08, 2.4, 15.2, lo, hi, { segs: 3, tint: glassTint(2.4, 15.2) });
      K.polar('body', WHITE, ER, ER + 0.45, 2.1, 2.4, lo - 0.004, hi + 0.004, { segs: 3 });
    }
  }
  // the screen: a dark frame on two legs, a curved face, glowing pink rails
  const SA = 21 * DEG; const SR = ER - 0.2; const SY0 = 17.8; const SY1 = 26.4;
  K.polar('body', 0x8a94c8, SR - 0.6, SR, SY0 - 0.5, SY1 + 0.5, -SA - 0.02, SA + 0.02, { segs: 24 });
  for (const s of [-1, 1]) K.polar('body', 0x8a94c8, SR - 0.9, SR - 0.3, 17, SY0, s * SA * 0.55 - 0.03, s * SA * 0.55 + 0.03, { segs: 1 });
  const screen = K.rect(860, 380, (c, x, y, w, h) => {
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#1b1f5c'); g.addColorStop(1, '#3a1458');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    // a few twinkling stars and planets, drawn
    const stars = [[0.06, 0.2, 10, '#fff06a'], [0.93, 0.18, 9, '#5cf2ff'], [0.1, 0.8, 7, '#ff5ccf'], [0.9, 0.78, 8, '#b6ff5c'], [0.5, 0.1, 6, '#ffffff'], [0.3, 0.88, 5, '#ffd166'], [0.72, 0.9, 6, '#5cf2ff']];
    for (const [sx, sy, r, col] of stars) drawStar(c, x + sx * w, y + sy * h, r * 1.6, col);
    c.fillStyle = '#ffa04a'; c.beginPath(); c.arc(x + w * 0.955, y + h * 0.5, h * 0.07, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ffd166'; c.lineWidth = 3; c.beginPath(); c.ellipse(x + w * 0.955, y + h * 0.5, h * 0.12, h * 0.035, -0.4, 0, Math.PI * 2); c.stroke();
    c.fillStyle = '#4d9dff'; c.beginPath(); c.arc(x + w * 0.045, y + h * 0.5, h * 0.055, 0, Math.PI * 2); c.fill();
    // the title in rainbow letters, two lines, each fitted to the width
    const colours = ['#ff5a50', '#ffa04a', '#fff06a', '#b6ff5c', '#5cf2ff', '#5aa8ff', '#b98cff', '#ff5ccf'];
    const fam = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
    let k = 0;
    for (const [word, yy] of [['FUTURE', 0.27], ['SCHOOL', 0.6]]) {
      let px = Math.floor(h * 0.34);
      c.font = `bold ${px}px ${fam}`;
      const room = w * 0.72;
      if (c.measureText(word).width > room) { px = Math.floor(px * room / c.measureText(word).width); c.font = `bold ${px}px ${fam}`; }
      const total = c.measureText(word).width + (word.length - 1) * px * 0.06;
      let cx = x + (w - total) / 2;
      c.textBaseline = 'middle'; c.textAlign = 'left';
      c.shadowColor = '#ffffff'; c.shadowBlur = h * 0.03;
      for (const ch of word) {
        c.fillStyle = colours[k++ % colours.length];
        c.fillText(ch, cx, y + h * yy);
        cx += c.measureText(ch).width + px * 0.06;
      }
    }
    c.shadowBlur = 0;
    let p2 = Math.floor(h * 0.11);
    c.font = `bold ${p2}px ${fam}`;
    const sub = 'LEARN   BUILD   DREAM';
    if (c.measureText(sub).width > w * 0.7) { p2 = Math.floor(p2 * w * 0.7 / c.measureText(sub).width); c.font = `bold ${p2}px ${fam}`; }
    c.fillStyle = '#e8f6ff'; c.textAlign = 'center';
    c.fillText(sub, x + w / 2, y + h * 0.87);
  });
  K.polarScreen(screen, SR, SR + 0.12, SY0, SY1, 0, SA * 2, { segs: 30 });
  K.glowPolar('pink', SR, SR + 0.2, SY1 + 0.15, SY1 + 0.5, -SA - 0.02, SA + 0.02, { segs: 24 });
  K.glowPolar('pink', SR, SR + 0.2, SY0 - 0.5, SY0 - 0.15, -SA - 0.02, SA + 0.02, { segs: 24 });

  // --- the glass robotics lab -------------------------------------------------------------------
  const LX = LAB_R * Math.sin(LAB_A); const LZ = LAB_R * Math.cos(LAB_A);
  K.add('body', latheG([[0, -0.4], [LAB_DOME + 0.6, -0.4], [LAB_DOME + 0.6, 0.62], [0, 0.62]], 48).translate(LX, 0, LZ), 0xc9ccd3);
  K.add('paint', latheG([[0, 0.62], [LAB_DOME + 0.3, 0.62], [LAB_DOME + 0.3, 1.5], [LAB_DOME - 0.2, 1.5], [LAB_DOME - 0.2, 0.7], [0, 0.7]], 48).translate(LX, 0, LZ), WHITE);
  K.glow('cyan', ringG(LAB_DOME + 0.05, 0.12, 1.55, { x: LX, z: LZ, radial: 6, tubular: 48 }));
  // the floor of the lab: a glowing grid circle
  const grid = K.rect(256, 256, (c, x, y, w, h) => {
    c.fillStyle = '#1a2660'; c.fillRect(x, y, w, h);
    c.strokeStyle = '#5cf2ff'; c.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(x + i * w / 8, y); c.lineTo(x + i * w / 8, y + h); c.stroke(); c.beginPath(); c.moveTo(x, y + i * h / 8); c.lineTo(x + w, y + i * h / 8); c.stroke(); }
    c.strokeStyle = '#ff5ccf'; c.lineWidth = 6; c.beginPath(); c.arc(x + w / 2, y + h / 2, w * 0.3, 0, Math.PI * 2); c.stroke();
  });
  {
    const g = new THREE.CylinderGeometry(LAB_DOME - 0.25, LAB_DOME - 0.25, 0.06, 40);
    g.translate(LX, 0.73, LZ);
    const P = g.attributes.position; const UV = g.attributes.uv; const N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      if (N.getY(i) > 0.9) UV.setXY(i, grid.u0 + ((P.getX(i) - LX) / (2 * LAB_DOME) + 0.5) * (grid.u1 - grid.u0), grid.v0 + (0.5 - (P.getZ(i) - LZ) / (2 * LAB_DOME)) * (grid.v1 - grid.v0));
      else { const [u, v] = K.swatchUV('cyan'); UV.setXY(i, u, v); }
    }
    K.add('glow', g, 0xffffff);
  }
  // the dome itself, clear, with six white ribs
  const DH2 = LAB_DOME * 1.05;
  const domeProfile = [];
  for (let i = 0; i <= 14; i++) { const t = (i / 14) * (Math.PI / 2); domeProfile.push([Math.cos(t) * LAB_DOME, 1.5 + Math.sin(t) * DH2]); }
  domeProfile.unshift([0, 1.5]);
  K.add('clear', latheG(domeProfile, 32).translate(LX, 0, LZ), 0xbfefff);
  for (let k = 0; k < 6; k++) {
    const yaw = (k / 6) * Math.PI;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = -Math.PI / 2 + (i / 12) * Math.PI;
      const rr = Math.sin(t) * (LAB_DOME + 0.06);
      pts.push([LX + rr * Math.cos(yaw), 1.5 + Math.cos(t) * (DH2 + 0.06), LZ + rr * Math.sin(yaw)]);
    }
    K.add('paint', tubeG(pts, 0.12, { sides: 6, round: 0, steps: 14 }), WHITE);
  }
  K.add('paint', latheG([[0, 1.5 + DH2 - 0.1], [0.9, 1.5 + DH2 - 0.1], [0.6, 1.5 + DH2 + 0.35], [0, 1.5 + DH2 + 0.45]], 16).translate(LX, 0, LZ), WHITE);
  K.glow('pink', ballG(LX, 1.5 + DH2 + 0.6, LZ, 0.3, { w: 10, h: 6 }));
  // a workbench with a little rover robot, and a small humanoid helper with a glowing face
  const ux = Math.cos(LAB_A); const uz = -Math.sin(LAB_A); // along the lab, left to right seen from outside
  const fx = Math.sin(LAB_A); const fz = Math.cos(LAB_A); // out of the lab, toward the viewer
  const at = (s, f) => [LX + ux * s + fx * f, LZ + uz * s + fz * f];
  {
    const [bx, bz] = at(-2.6, -1.8);
    const m = new THREE.Matrix4().makeRotationY(LAB_A).setPosition(bx, 0, bz);
    K.within(m, () => {
      K.box('paint', 0x3a4a6e, -1.6, 1.6, 2.6, 2.85, -0.9, 0.9);
      for (const sx of [-1.4, 1.4]) for (const sz of [-0.7, 0.7]) K.box('paint', 0xdfe4ea, sx - 0.08, sx + 0.08, 0.73, 2.6, sz - 0.08, sz + 0.08);
      // the rover: a round cyan body on four wheels, with a glowing visor
      K.ball('paint', 0x22b5a8, 0, 3.45, 0, 0.55, { sy: 0.7, w: 14, h: 9 });
      for (const sx of [-0.45, 0.45]) for (const sz of [-0.35, 0.35]) K.add('paint', new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12).rotateZ(Math.PI / 2).translate(sx, 3.05, sz), 0x2a2d33);
      K.glowBox('cyan', -0.3, 0.3, 3.45, 3.62, 0.36, 0.5);
      K.box('paint', 0xffc23d, 0.7, 1.4, 2.85, 3.3, -0.3, 0.4); // a box of parts
    });
  }
  {
    const [hx, hz] = at(3.2, -1.8);
    const m = new THREE.Matrix4().makeRotationY(LAB_A - 0.25).setPosition(hx, 0, hz);
    K.within(m, () => {
      K.add('paint', latheG([[0, 0.73], [0.7, 0.73], [0.75, 1.0], [0.5, 2.6], [0.62, 3.2], [0.4, 3.5], [0, 3.55]], 20), WHITE);
      K.ball('paint', WHITE, 0, 4.25, 0, 0.75, { sy: 0.9, w: 16, h: 10 });
      K.ball('glass', 0x1c2650, 0, 4.25, 0.12, 0.66, { sy: 0.72, sz: 0.95, w: 16, h: 10 });
      K.glow('cyan', ballG(-0.25, 4.3, 0.72, 0.12, { w: 8, h: 6 }));
      K.glow('cyan', ballG(0.25, 4.3, 0.72, 0.12, { w: 8, h: 6 }));
      for (const s of [-1, 1]) K.add('paint', tubeG([[s * 0.55, 3.1, 0], [s * 0.85, 2.5, 0.2], [s * 0.9, 1.9, 0.35]], 0.14, { sides: 8 }), 0xff7a59);
      K.glowBox('pink', -0.3, 0.3, 2.6, 2.9, 0.48, 0.58);
    });
  }

  const { group } = K.finish();

  // --- the robot arm: one mesh in its own group, posed by rewriting its vertices ----------------
  const [ax, az] = at(0.2, 1.0);
  const BASE = new THREE.Vector3(ax, 0.73, az);
  const SH = new THREE.Vector3(ax, 2.5, az);
  const EL = new THREE.Vector3(ax, 2.5 + 2.6, az);
  const mv = new Mover();
  const pBase = mv.part(); const pUpper = mv.part(); const pFore = mv.part();
  const ORANGE = 0xff7a28;
  mv.add(pBase, latheG([[0, 0.73], [0.85, 0.73], [0.85, 1.05], [0.55, 1.2], [0.55, 2.0], [0, 2.05]], 20).translate(ax, 0, az), 0x3a4a6e);
  mv.add(pUpper, latheG([[0, 2.0], [0.58, 2.0], [0.58, 2.35], [0, 2.4]], 18).translate(ax, 0, az), ORANGE);
  mv.add(pUpper, ballG(SH.x, SH.y, SH.z, 0.48, { w: 14, h: 9 }), WHITE);
  mv.add(pUpper, rodG([SH.x, SH.y, SH.z], [EL.x, EL.y, EL.z], 0.3, { r2: 0.24, sides: 12 }), ORANGE);
  mv.add(pFore, ballG(EL.x, EL.y, EL.z, 0.38, { w: 12, h: 8 }), WHITE);
  const TIP = new THREE.Vector3(ax + ux * 2.2, EL.y - 0.25, az + uz * 2.2);
  mv.add(pFore, rodG([EL.x, EL.y, EL.z], [TIP.x, TIP.y, TIP.z], 0.22, { r2: 0.18, sides: 10 }), ORANGE);
  mv.add(pFore, ballG(TIP.x, TIP.y, TIP.z, 0.26, { w: 10, h: 7 }), 0x3a4a6e);
  for (const s of [-1, 1]) mv.add(pFore, boxG(-0.07, 0.07, -0.55, 0, -0.06, 0.06).translate(TIP.x + fx * s * 0.17, TIP.y - 0.15, TIP.z + fz * s * 0.17), 0xdfe4ea);
  const armMesh = mv.finish(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12 }), new THREE.Sphere(new THREE.Vector3(ax, 3.2, az), 4.6));
  const arm = new THREE.Group();
  arm.add(armMesh);
  group.add(arm);

  const about = (axis, angle, p) => new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const Y = new THREE.Vector3(0, 1, 0);
  let clock = 0;
  const pose = (t) => {
    const yaw = Math.sin(t * 0.7) * 1.1;
    const side = new THREE.Vector3(fx, 0, fz).applyAxisAngle(Y, yaw);
    const sh = -0.25 + Math.sin(t * 1.3) * 0.3;
    const el = -0.35 + Math.sin(t * 1.3 + 1.2) * 0.4;
    mv.mats[pBase].identity();
    const mYaw = about(Y, yaw, BASE);
    mv.mats[pUpper].copy(mYaw).multiply(about(new THREE.Vector3(fx, 0, fz), sh, SH));
    const elbowAt = EL.clone().applyMatrix4(mv.mats[pUpper]);
    mv.mats[pFore].copy(about(side, el, elbowAt)).multiply(mv.mats[pUpper]);
    mv.write();
  };
  pose(0);
  group.userData.tick = {
    update(dt) {
      if (reducedMotion()) return;
      clock += Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      pose(clock);
    },
    dispose() {},
  };
  return group;
}
