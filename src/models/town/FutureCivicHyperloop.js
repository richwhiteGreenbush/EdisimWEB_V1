// hyperloop-station: a station 50ft long. A podium holds two raised platforms either side of a
// glowing guideway; a sleek pod waits on it with its door slid open; a curved glass canopy arches over
// both platforms; and at the +X end the guideway enters the tube through a lit portal.
//
// THE TUBE STUB MEETS THE HYPERLOOP TUBE PIECE: its centre line is at y = 12, z = 0, its outer
// diameter is 10ft, it runs along X, and it ends flush at x = +25, the station's +X edge. A Hyperloop
// Tube placed 45ft along +X from the station (its own x = -20 end on x = +25) carries on from it.

import * as THREE from 'three';
import { FUTURE } from './TownKit.js';
import { FKit, latheG, boxG, ringG, extrudeG, polarG, tubeG, glassTint, times } from './FutureCivicKit.js';

const DEG = Math.PI / 180;
const TUBE_Y = 12; const TUBE_R = 5; const TUBE_X0 = 10; const TUBE_X1 = 25;
const X0 = -25; const XP = 9.5; // the podium and the canopy run X0..XP
const HZ = 14;
const DECK = 8.0; const PLAT = 9.6; const EDGE = 4.4;
const POD_R = 3.8; const POD_X0 = -16.6; const POD_LEN = 26;
const WHITE = FUTURE.white; const PEARL = FUTURE.pearl; const VIOLET = 0x7a52e0; const AQUA = 0x22b5a8; const CORAL = 0xff7a59; const SKY = 0x4d8ff0;

// Everything round the guideway's axis is written as if the axis were Y and then laid along X:
// a polar angle a then points (0, -sin a, cos a), so a = 0 faces the front platform and a < 0 is up.
const ALONG_X = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
const onAxis = (x0) => new THREE.Matrix4().makeTranslation(x0, TUBE_Y, 0).multiply(ALONG_X);

export function hyperloopBuild() {
  const K = new FKit({ seed: 1201, atlasW: 1024, atlasH: 1024 });

  // --- the podium -------------------------------------------------------------------------------
  K.box('body', 0x9fa7bb, X0, XP + 0.5, -0.4, DECK, -HZ, HZ);
  // a violet base band and a glowing line all the way round
  K.box('body', VIOLET, X0 - 0.15, XP + 0.65, -0.4, 0.6, -HZ - 0.15, HZ + 0.15);
  K.glowBox('cyan', X0 - 0.15, XP + 0.65, 7.05, 7.25, -HZ - 0.15, HZ + 0.15);
  // the front: tall glass, a wide glowing doorway, and the name in light above
  K.box('body', times(VIOLET, 1.15), X0 - 0.15, XP + 0.65, 7.25, PLAT, HZ, HZ + 0.25);
  for (let k = 0; k < 6; k++) {
    const x0 = X0 + 1.2 + k * 5.6; const x1 = x0 + 4.6;
    if (k === 2 || k === 3) continue;
    K.box('glass', FUTURE.glass, x0, x1, 0.95, 6.7, HZ, HZ + 0.08, { tint: glassTint(0.95, 6.7) });
    K.box('body', WHITE, x0 - 0.15, x1 + 0.15, 0.6, 0.95, HZ, HZ + 0.4);
  }
  K.box('body', 0x2c3550, -13.6, -2.6, 0.6, 7.0, HZ, HZ + 0.12);
  for (const [a, b] of [[-13.3, -8.2], [-8.0, -2.9]]) K.box('glass', 0x2b5876, a, b, 0.6, 6.7, HZ + 0.12, HZ + 0.2, { tint: glassTint(0.6, 6.7, 0x2b5876, 0x7cb5d8) });
  K.glowBox('aqua', -13.8, -2.4, 6.7, 7.0, HZ + 0.12, HZ + 0.3);
  for (const x of [-13.8, -2.6]) K.glowBox('aqua', x, x + 0.2, 0.6, 7.0, HZ + 0.12, HZ + 0.3);
  // the end walls carry the same glass
  for (const sx of [-1, 1]) {
    const x = sx < 0 ? X0 : XP + 0.5;
    for (let k = 0; k < 4; k++) {
      const z0 = -HZ + 1.5 + k * 6.8; const z1 = z0 + 5.2;
      K.box('glass', FUTURE.glass, x + (sx < 0 ? -0.08 : 0), x + (sx < 0 ? 0 : 0.08), 0.95, 6.7, z0, z1, { tint: glassTint(0.95, 6.7) });
    }
  }
  const sign = K.rect(900, 120, (c, x, y, w, h) => {
    const g = c.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, '#16204a'); g.addColorStop(1, '#2a1656');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    const fam = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
    let px = Math.floor(h * 0.62); c.font = `bold ${px}px ${fam}`;
    const word = 'LOOP LINE   STATION';
    if (c.measureText(word).width > w * 0.7) { px = Math.floor(px * w * 0.7 / c.measureText(word).width); c.font = `bold ${px}px ${fam}`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#5cf2ff'; c.shadowBlur = h * 0.15;
    c.fillStyle = '#d7fbff'; c.fillText(word, x + w / 2, y + h * 0.55);
    c.shadowBlur = 0;
    // a drawn pod-in-a-ring logo at each end
    for (const sx of [0.07, 0.93]) {
      const cx = x + w * sx; const cy = y + h / 2;
      c.strokeStyle = '#5cf2ff'; c.lineWidth = 5; c.beginPath(); c.arc(cx, cy, h * 0.36, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#ff5ccf'; c.beginPath(); c.ellipse(cx, cy, h * 0.26, h * 0.11, 0, 0, Math.PI * 2); c.fill();
    }
  });
  K.screen(sign, -7.5, 8.42, 26, 1.95, HZ + 0.25, HZ + 0.36);

  // --- the platforms and the guideway between them ------------------------------------------
  for (const s of [-1, 1]) {
    const z0 = s > 0 ? EDGE : -HZ; const z1 = s > 0 ? HZ : -EDGE;
    K.box('body', 0xd9dde6, X0, XP, DECK, PLAT, z0, z1);
    const ez = s * EDGE;
    K.box('paint', 0xffc23d, X0, XP, PLAT, PLAT + 0.03, ez - (s > 0 ? 0 : 0.9) + (s > 0 ? 0.25 : 0), ez + (s > 0 ? 0.9 : 0) - (s > 0 ? 0 : 0.25));
    K.glowBox('cyan', X0, XP, PLAT - 0.35, PLAT - 0.15, ez - 0.05, ez + 0.05);
    // a low glass screen along the platform edge with gaps at the doors would be modern; here, posts
    for (let x = X0 + 3; x < XP - 1; x += 6) K.ball('paint', SKY, x, PLAT + 0.25, s * (EDGE + 1.6), 0.28, { w: 10, h: 6, sy: 0.9 });
  }
  K.box('paint', 0x3b4260, X0, TUBE_X0, DECK - 0.1, DECK + 0.25, -1.2, 1.2);
  K.glowBox('aqua', X0, TUBE_X0, DECK + 0.25, DECK + 0.4, -0.35, 0.35);
  for (const s of [-1, 1]) K.glowBox('violet', X0, TUBE_X0, DECK + 0.02, DECK + 0.08, s * 2.4 - 0.08, s * 2.4 + 0.08);
  // benches and a departures board on the front platform
  for (const x of [-21, 3.5]) {
    K.add('paint', boxG(-2.4, 2.4, 0, 0.3, -0.7, 0.7).translate(x, PLAT + 1.4, 10.2), CORAL);
    K.add('paint', boxG(-2.4, 2.4, 0, 1.4, -0.12, 0.12).translate(x, PLAT + 1.7, 10.85), CORAL);
    for (const sx of [-1.8, 1.8]) K.box('paint', 0x5a6488, x + sx - 0.12, x + sx + 0.12, PLAT, PLAT + 1.4, 9.8, 10.6);
  }
  const board = K.rect(512, 200, (c, x, y, w, h) => {
    c.fillStyle = '#0d1430'; c.fillRect(x, y, w, h);
    const fam = '"Trebuchet MS", Arial, sans-serif';
    c.textAlign = 'left'; c.textBaseline = 'middle';
    c.fillStyle = '#ffd166'; c.font = `bold ${Math.floor(h * 0.17)}px ${fam}`;
    c.fillText('NEXT POD', x + w * 0.05, y + h * 0.18);
    const rows = [['NEO CITY', 'NOW'], ['LAKE TOWN', '6 MIN'], ['SKY HARBOR', '12 MIN']];
    rows.forEach(([to, when], i) => {
      const yy = y + h * (0.43 + i * 0.2);
      c.fillStyle = i === 0 ? '#b6ff5c' : '#e8f6ff'; c.font = `bold ${Math.floor(h * 0.14)}px ${fam}`;
      c.fillText(to, x + w * 0.05, yy);
      c.textAlign = 'right'; c.fillText(when, x + w * 0.95, yy); c.textAlign = 'left';
    });
  });
  K.rod('paint', 0x5a6488, [-13, PLAT, 12.6], [-13, PLAT + 7.8, 12.6], 0.18, { sides: 10 });
  K.box('paint', 0x2c3550, -16.3, -9.7, PLAT + 6.8, PLAT + 9.6, 12.35, 12.85);
  K.screen(board, -13, PLAT + 8.2, 6.2, 2.5, 12.85, 12.95);

  // --- the pod ---------------------------------------------------------------------------------
  const prof = [[0, 0], [1.6, 0.25], [2.8, 0.9], [3.55, 2.1], [POD_R, 3.6], [POD_R, 19.5], [3.6, 21.6], [3.0, 23.3], [2.1, 24.6], [1.0, 25.6], [0, 26]];
  K.within(onAxis(POD_X0), () => {
    K.add('paint', latheG(prof, 40), WHITE, { tint: (x, y, z, out) => {
      // in world terms: an aqua stripe round its waist, a coral nose
      const lx = x - POD_X0;
      if (lx > 23.2) { const c = new THREE.Color(CORAL); out[0] = c.r; out[1] = c.g; out[2] = c.b; }
    } });
  });
  // windows: a ribbon of dark glass along each side, a little above the waist; the door on the
  // front side is open, its leaf slid back along the body
  const DOOR = [6.4, 10.0]; // along the pod, from its tail
  const WIN_A = [-0.62, -0.08];
  K.within(onAxis(POD_X0), () => {
    // an aqua stripe along each flank, below the windows
    for (const [a0, a1] of [[0.16, 0.3], [Math.PI - 0.3, Math.PI - 0.16]]) K.add('paint', polarG(POD_R - 0.04, POD_R + 0.05, 3.4, 23.2, a0, a1, { segs: 3 }), AQUA);
    for (const side of [0, Math.PI]) {
      const segs = side === 0 ? [[3.6, DOOR[0] - 0.3], [DOOR[1] + 4.0, 21.2]] : [[3.6, 21.2]];
      for (const [l0, l1] of segs) {
        // a polar part here takes its y as the distance along the pod
        const a0 = side + (side === 0 ? WIN_A[0] : -WIN_A[1]); const a1 = side + (side === 0 ? WIN_A[1] : -WIN_A[0]);
        K.add('glass', polarG(POD_R - 0.05, POD_R + 0.06, l0, l1, a0, a1, { segs: 6 }), 0x223a5a, { tint: glassTint(-99, 99) });
      }
    }
    // the open doorway: the lit cabin inside, painted
    // painted turned a quarter, since the screen's u runs down the pod's side and its v along it
    const cabin = K.rect(300, 240, (c, x, y, w, h) => {
      c.save(); c.translate(x, y + h); c.rotate(-Math.PI / 2);
      const W = h; const H = w; // the picture as a person on the platform sees it
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#fff4d6'); g.addColorStop(1, '#ffd79a');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = '#5cf2ff'; c.fillRect(0, H * 0.05, W, H * 0.05);
      for (let i = 0; i < 3; i++) {
        const sx = W * (0.06 + i * 0.32);
        c.fillStyle = ['#ff7a59', '#8a5cf0', '#22b5a8'][i];
        c.fillRect(sx, H * 0.5, W * 0.24, H * 0.26);
        c.fillRect(sx + W * 0.02, H * 0.3, W * 0.2, H * 0.24);
      }
      c.fillStyle = '#c9b48f'; c.fillRect(0, H * 0.86, W, H * 0.14);
      c.restore();
    });
    K.polarScreen(cabin, POD_R - 0.1, POD_R + 0.04, DOOR[0], DOOR[1], 0.02, 1.25, { segs: 10 });
  });
  {
    const frame = (l0, l1, a0, a1) => K.glow('cyan', polarG(POD_R, POD_R + 0.1, l0, l1, a0, a1, { segs: 8 }).applyMatrix4(onAxis(POD_X0)));
    frame(DOOR[0] - 0.25, DOOR[0], -0.62, 0.66);
    frame(DOOR[1], DOOR[1] + 0.25, -0.62, 0.66);
    frame(DOOR[0] - 0.25, DOOR[1] + 0.25, -0.7, -0.62);
    K.within(onAxis(POD_X0), () => {
      K.add('paint', polarG(POD_R + 0.08, POD_R + 0.22, DOOR[1] + 0.35, DOOR[1] + 3.85, -0.6, 0.62, { segs: 8 }), WHITE);
      K.add('glass', polarG(POD_R + 0.22, POD_R + 0.28, DOOR[1] + 0.9, DOOR[1] + 3.3, -0.55, -0.1, { segs: 6 }), 0x223a5a, { tint: glassTint(-99, 99) });
    });
  }
  // a little bridge from the platform to the door sill
  K.box('paint', 0xdfe4ea, POD_X0 + DOOR[0], POD_X0 + DOOR[1], PLAT - 0.1, PLAT + 0.02, 2.9, EDGE + 0.2);
  K.glowBox('yellow', POD_X0 + DOOR[0], POD_X0 + DOOR[1], PLAT - 0.08, PLAT + 0.04, 2.85, 2.95);
  // lights: a glowing band round the nose and a red one at the tail
  K.glow('cyan', ringG(3.05, 0.1, 0, { radial: 4, tubular: 32 }).rotateZ(Math.PI / 2).translate(POD_X0 + 23.3, TUBE_Y, 0));
  K.glow('red', ringG(2.85, 0.1, 0, { radial: 4, tubular: 32 }).rotateZ(Math.PI / 2).translate(POD_X0 + 0.9, TUBE_Y, 0));

  // --- the tube stub and its portal ---------------------------------------------------------
  // a cylinder rather than a lathe, so its end caps are flat faces and not a shaded dome
  K.add('body', new THREE.CylinderGeometry(TUBE_R, TUBE_R, TUBE_X1 - TUBE_X0, 48, 1).rotateZ(Math.PI / 2).translate((TUBE_X0 + TUBE_X1) / 2, TUBE_Y, 0), WHITE);
  for (const x of [16, 21.5]) K.glow('aqua', ringG(TUBE_R + 0.02, 0.12, 0, { radial: 4, tubular: 48 }).rotateZ(Math.PI / 2).translate(x, TUBE_Y, 0));
  // the mouth: a dark disc with rings of light going into the distance
  const mouth = K.rect(300, 300, (c, x, y, w, h) => {
    const g = c.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w / 2);
    g.addColorStop(0, '#05081c'); g.addColorStop(1, '#1d2a5c');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    for (let i = 1; i <= 5; i++) {
      c.strokeStyle = i % 2 ? '#5cf2ff' : '#b98cff';
      c.globalAlpha = 0.35 + i * 0.12; c.lineWidth = 2 + i;
      c.beginPath(); c.arc(x + w / 2, y + h / 2, (w / 2) * (i / 5.6), 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
  });
  {
    const disc = new THREE.CylinderGeometry(TUBE_R - 0.4, TUBE_R - 0.4, 0.2, 40);
    disc.rotateZ(Math.PI / 2); // its top cap now faces -X... and its +y cap faces +X
    disc.translate(TUBE_X0 - 0.05, TUBE_Y, 0);
    K.decal(disc, mouth, { edge: 'dark', faceTest: (nx) => nx < -0.9 });
  }
  K.add('paint', ringG(TUBE_R + 0.5, 0.9, 0, { radial: 12, tubular: 48 }).rotateZ(Math.PI / 2).translate(TUBE_X0 + 0.3, TUBE_Y, 0), VIOLET);
  K.glow('cyan', ringG(TUBE_R - 0.25, 0.16, 0, { radial: 6, tubular: 48 }).rotateZ(Math.PI / 2).translate(TUBE_X0 - 0.25, TUBE_Y, 0));
  // a pylon under the stub, the same white as the tube, with a saddle
  K.add('body', latheG([[0, -0.4], [1.8, -0.4], [1.8, 0.4], [1.2, 1.0], [1.0, 6.0], [0, 6.0]], 20).translate(21, 0, 0), WHITE);
  K.add('body', boxG(-1.2, 1.2, 0, 1.6, -3.2, 3.2).translate(21, 5.8, 0), 0xd9dde6);
  K.glow('aqua', ringG(1.12, 0.1, 3.2, { radial: 4, tubular: 24, x: 21 }));

  // --- the glass canopy: a vault over both platforms, with white ribs and a glowing ridge ------
  const CR = 14.4; const RISE = 14.6;
  const arcPt = (t, r = CR, rise = RISE) => [Math.cos(t) * r, PLAT + Math.sin(t) * rise];
  {
    const outer = []; const inner = [];
    for (let i = 0; i <= 32; i++) { const t = (i / 32) * Math.PI; outer.push(arcPt(t, CR + 0.15, RISE + 0.15)); }
    for (let i = 32; i >= 0; i--) { const t = (i / 32) * Math.PI; inner.push(arcPt(t)); }
    const shell = extrudeG([...outer, ...inner].map(([z, y]) => [-z, y]), X0 + 0.5, XP, { curve: 1 }).rotateY(Math.PI / 2);
    K.add('clear', shell, 0xbfefff);
  }
  for (let x = X0 + 0.5; x <= XP + 0.01; x += (XP - X0 - 0.5) / 6) {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const [z, y] = arcPt((i / 20) * Math.PI, CR + 0.1, RISE + 0.1); pts.push([x, y, z]); }
    K.add('paint', tubeG(pts, 0.22, { sides: 6, steps: 28, round: 0 }), WHITE);
    for (const s of [-1, 1]) K.ball('paint', WHITE, x, PLAT + 0.1, s * (CR + 0.1), 0.42, { w: 10, h: 6 });
  }
  K.glowBox('cyan', X0 + 0.5, XP, PLAT + RISE + 0.05, PLAT + RISE + 0.35, -0.2, 0.2);
  for (const s of [-1, 1]) K.glowBox('pink', X0 + 0.5, XP, PLAT + 0.15, PLAT + 0.3, s * (CR + 0.15) - 0.1, s * (CR + 0.15) + 0.1);

  return K.finish({ paint: { side: THREE.FrontSide } }).group;
}
