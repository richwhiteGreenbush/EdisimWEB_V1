import * as THREE from 'three';
import { reducedMotion } from '../../Settings.js';
import { tube, lathe } from '../ModelKit.js';
import { FUTURE } from '../town/TownKit.js';
import {
  boxAt, cylY, rod, bar, ball, ring, tone, mixHex, feetUV, rect, fitFont, glowText, roundRect, HEAVY,
  bodyMat, glowMat, signMat, meshOf, atlasPlate, atlasDisc, spinMesh, roundedLoft, blob,
  seededRandom, canvasTexture, mergeParts, mix, outward,
} from '../town/FutureWorksKit.js';
import { mesh, standard } from '../../PropKit.js';

// Build a Future City's works: the pieces that keep a city of a hundred years from now running.
//
//   drone-port          a 31ft teal column carrying four staggered round landing pads, each with its
//                       own glowing rim and a lit H mark; battery-swap lockers round its foot, a glass
//                       parcel chute spiralling down to a pickup box, a drone parked on the lowest pad
//                       and a second one that circles the tower by itself, rotors turning.
//   wind-tree           a 25ft pearl-white steel tree whose leaves are 39 little green vertical-axis
//                       turbines, every one turning at its own speed.
//   air-cleaning-tower  a 46ft tower of six big turning fans in a colourful frame, glowing honeycomb
//                       filter panels on its sides, CLEAN AIR at its foot, and a crown of plants on top
//                       breathing out slow ribbons of fresh air.
//   hologram-kiosk      a 10ft sidewalk kiosk with a touch panel, projecting a slowly turning, glowing
//                       hologram map of a little city between its lens and a ring emitter overhead.
//   rain-garden-plaza   exactly 40 x 40: permeable paving with real gaps, a sunken rain garden of
//                       flowers and reeds, a pond with stepping stones fed by a runnel, two benches and
//                       three solar-flower lamps.
//
// Real life size in feet, origin at the base centre, front is +Z, fresh materials per build,
// seededRandom only, at most six meshes. Everything that moves is an inner part; the root never does.

const BASE = -0.4;
const TAU = Math.PI * 2;
const polar = (a, r, y) => [Math.sin(a) * r, y, Math.cos(a) * r];
const deg = (d) => (d * Math.PI) / 180;

function tickOf(fn) {
  return {
    update(dt) {
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      if (step > 0 && !reducedMotion()) fn(step);
    },
    dispose() {},
  };
}

const hexCss = (hex) => `#${new THREE.Color(hex).getHexString()}`;

// ---------------------------------------------------------------------------------------------
// A little quad-copter, about 3.4ft across, origin under its skids, nose at +Z.
//   body/glow: part lists to push into; rotors: one list of parts per rotor with its hub, so a
//   caller can either merge them (parked) or hand them to spinMesh (flying).
// ---------------------------------------------------------------------------------------------
function drone({ shell = FUTURE.coral, guard = FUTURE.sky, parcel = false } = {}) {
  const body = []; const glow = []; const rotors = [];
  const PEARL = FUTURE.pearl;
  const DARK = 0x3b4452;
  // The fuselage: a flattened pod with a pearl canopy dome.
  body.push({ geometry: ball([0, 0.55, 0], 1, 18, 12), color: shell, scale: [0.62, 0.27, 0.8], about: [0, 0.55, 0] });
  body.push({ geometry: ball([0, 0.66, -0.05], 1, 16, 10), color: PEARL, scale: [0.44, 0.22, 0.56], about: [0, 0.66, -0.05] });
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const hub = [sx * 1.12, 0.6, sz * 1.12];
    body.push({ geometry: rod([sx * 0.3, 0.57, sz * 0.36], hub, 0.07, 8), color: PEARL });
    body.push({ geometry: cylY(0.15, 0.13, 0.5, 0.78, hub[0], hub[2], 12), color: DARK });
    // A guard ring round each rotor, on two little struts.
    body.push({ geometry: ring(0.6, 0.045, [hub[0], 0.74, hub[2]], 'y', 6, 28), color: guard });
    for (const s of [-1, 1]) {
      const a = Math.atan2(sz, sx) + s * Math.PI / 2;
      body.push({ geometry: rod([hub[0], 0.68, hub[2]], [hub[0] + Math.cos(a) * 0.6, 0.74, hub[2] + Math.sin(a) * 0.6], 0.03, 5), color: guard });
    }
    const blades = [];
    for (const yaw of [0.4 * sx * sz, 0.4 * sx * sz + Math.PI]) {
      const g = new THREE.BoxGeometry(0.5, 0.025, 0.12);
      g.translate(0.27, 0, 0);
      g.rotateY(yaw);
      g.translate(hub[0], 0.81, hub[2]);
      blades.push({ geometry: g, color: 0xf0f2f5 });
    }
    blades.push({ geometry: cylY(0.06, 0.04, 0.78, 0.86, hub[0], hub[2], 8), color: DARK });
    rotors.push({ parts: blades, pivot: hub, axis: [0, 1, 0] });
    glow.push({ geometry: ball([hub[0] + sx * 0.0, 0.55, hub[2] + sz * 0.16], 0.05, 6, 4), color: sz > 0 ? FUTURE.glowCyan : FUTURE.glowPink });
  }
  // Skids.
  for (const sx of [-1, 1]) {
    body.push({ geometry: rod([sx * 0.26, 0.42, 0.28], [sx * 0.38, 0.05, 0.3], 0.04, 6), color: DARK });
    body.push({ geometry: rod([sx * 0.26, 0.42, -0.28], [sx * 0.38, 0.05, -0.3], 0.04, 6), color: DARK });
    body.push({ geometry: rod([sx * 0.38, 0.05, -0.55], [sx * 0.38, 0.05, 0.55], 0.045, 6), color: DARK });
  }
  // Two bright eyes at the nose and a light bar round the tail.
  for (const sx of [-1, 1]) glow.push({ geometry: ball([sx * 0.17, 0.58, 0.76], 0.075, 8, 6), color: FUTURE.glowCyan });
  glow.push({ geometry: ball([0, 0.56, -0.79], 0.06, 8, 6), color: FUTURE.glowPink, scale: [3, 1, 1], about: [0, 0.56, -0.79] });
  if (parcel) {
    body.push({ geometry: roundedLoft([{ y: -0.42, hw: 0.3, hd: 0.3, r: 0.05 }, { y: 0.12, hw: 0.3, hd: 0.3, r: 0.05 }], 2), color: FUTURE.sun });
    body.push({ geometry: boxAt(0.62, 0.08, 0.1, 0, -0.15, 0), color: tone(FUTURE.sun, 0.7) });
    body.push({ geometry: rod([0, 0.08, 0], [0, 0.4, 0], 0.05, 6), color: DARK });
  }
  return { body, glow, rotors };
}

function placeParts(list, m) {
  return list.map((p) => {
    const g = mergeParts([p]);
    g.applyMatrix4(m);
    return { geometry: g, keepColor: true };
  });
}

// ---------------------------------------------------------------------------------------------
// DRONE PORT
// ---------------------------------------------------------------------------------------------
const DP_PADS = [
  { a: deg(60), y: 7.0, r: 6.2, R: 4.2, color: FUTURE.violet, glow: FUTURE.glowCyan, n: 1 },
  { a: deg(180), y: 13.5, r: 6.2, R: 4.2, color: FUTURE.magenta, glow: FUTURE.glowLime, n: 2 },
  { a: deg(-60), y: 20.0, r: 6.2, R: 4.2, color: FUTURE.coral, glow: FUTURE.glowGold, n: 3 },
  { a: 0, y: 27.2, r: 0, R: 4.6, color: FUTURE.sky, glow: FUTURE.glowPink, n: 4 },
];

function dronePortAtlas() {
  const W = 512; const H = 768;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#101826';
    ctx.fillRect(0, 0, W, H);
    // Four landing marks, one per pad, each in its own pad's colours.
    DP_PADS.forEach((p, i) => {
      const ox = (i % 2) * 256; const oy = Math.floor(i / 2) * 256;
      const cx = ox + 128; const cy = oy + 128;
      const bg = tone(p.color, 0.5);
      ctx.fillStyle = `#${bg.getHexString()}`;
      ctx.fillRect(ox, oy, 256, 256);
      // A dashed glowing ring at the edge.
      ctx.strokeStyle = hexCss(p.glow);
      ctx.lineWidth = 10;
      ctx.shadowColor = hexCss(p.glow); ctx.shadowBlur = 12;
      for (let k = 0; k < 16; k++) {
        ctx.beginPath();
        ctx.arc(cx, cy, 112, (k / 16) * TAU + 0.05, ((k + 0.62) / 16) * TAU);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // The landing circle and the H.
      ctx.strokeStyle = '#f2f4f8'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(cx, cy, 84, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff6d8';
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 10;
      ctx.fillRect(cx - 42, cy - 50, 20, 100);
      ctx.fillRect(cx + 22, cy - 50, 20, 100);
      ctx.fillRect(cx - 22, cy - 9, 44, 18);
      ctx.shadowBlur = 0;
      ctx.fillStyle = hexCss(p.glow);
      fitFont(ctx, `PAD ${p.n}`, 70, 22, HEAVY);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`PAD ${p.n}`, cx, cy + 68);
    });
    // DRONE PORT, on a dark panel with a cyan edge.
    ctx.fillStyle = '#16213d';
    roundRect(ctx, 6, 518, 500, 116, 26); ctx.fill();
    ctx.strokeStyle = '#5cf2ff'; ctx.lineWidth = 6; ctx.stroke();
    glowText(ctx, 'DRONE PORT', 256, 578, 450, 76, '#bdfbff', '#5cf2ff');
    // BATTERY SWAP and PARCELS labels.
    ctx.fillStyle = '#1b2b20';
    roundRect(ctx, 4, 644, 248, 56, 14); ctx.fill();
    glowText(ctx, 'BATTERY SWAP', 128, 673, 220, 34, '#dcffb0', '#b6ff5c');
    ctx.fillStyle = '#3a1f2d';
    roundRect(ctx, 260, 644, 248, 56, 14); ctx.fill();
    glowText(ctx, 'PARCELS', 384, 673, 210, 38, '#ffe0f4', '#ff5ccf');
    // A plain dark texel for the edges of every plate.
    ctx.fillStyle = '#1a2232';
    ctx.fillRect(0, 712, 64, 56);
  });
  return {
    tex,
    pad: (i) => rect((i % 2) * 256, Math.floor(i / 2) * 256, 256, 256, W, H),
    sign: rect(6, 518, 500, 116, W, H),
    battery: rect(4, 644, 248, 56, W, H),
    parcels: rect(260, 644, 248, 56, W, H),
    edge: rect(8, 720, 40, 40, W, H),
  };
}

// The column's radius at height y, so anything mounted on it can find its surface.
const DP_COLUMN = [[0, 0.2], [2.8, 0.2], [2.8, 1.0], [2.3, 3.0], [1.9, 9.0], [1.75, 20.0], [1.8, 26.4], [2.25, 26.8], [0, 26.8]];
function columnR(y) {
  for (let i = 1; i < DP_COLUMN.length - 2; i++) {
    const [r0, y0] = DP_COLUMN[i]; const [r1, y1] = DP_COLUMN[i + 1];
    if (y >= y0 && y <= y1) return mix(r0, r1, (y - y0) / Math.max(1e-6, y1 - y0));
  }
  return 1.8;
}

function dronePort() {
  const body = []; const glow = []; const signs = []; const glass = [];
  const atlas = dronePortAtlas();
  const PEARL = FUTURE.pearl;
  const WHITE = 0xdfe5ec;

  // The plinth: a rounded square pad, foundation to -0.4, with a glowing strip round its edge.
  body.push({ geometry: roundedLoft([{ y: BASE, hw: 9.6, hd: 9.6, r: 3 }, { y: 0.3, hw: 9.6, hd: 9.6, r: 3 }]), color: PEARL });
  glow.push({ geometry: roundedLoft([{ y: 0.12, hw: 9.66, hd: 9.66, r: 3.05 }, { y: 0.2, hw: 9.66, hd: 9.66, r: 3.05 }]), color: FUTURE.glowCyan });
  // Painted guide circle round the tower's foot.
  body.push({ geometry: lathe([[0, 0.28], [8.2, 0.28], [8.2, 0.33], [7.7, 0.33], [7.7, 0.31], [0, 0.31]], 48), color: tone(FUTURE.aqua, 0.85) });

  // The column, teal at the foot fading to sky blue at the top.
  const col = lathe(DP_COLUMN, 36);
  body.push({ geometry: col, keepColor: true, tint: (p) => { const c = mixHex(FUTURE.teal, FUTURE.sky, Math.min(1, p.y / 26)); return [c.r, c.g, c.b]; } });
  // Four light lines running up it, and glowing rings where the pads meet it.
  for (let k = 0; k < 4; k++) {
    const a = deg(45 + k * 90);
    const pts = [];
    for (let y = 5.6; y <= 26.2; y += 2.06) pts.push(polar(a, columnR(y) + 0.02, y));
    glow.push({ geometry: tube(pts, 0.08, { sides: 5, round: 1, steps: 20 }), color: k % 2 ? FUTURE.glowCyan : FUTURE.glowPink });
  }

  // The pads.
  DP_PADS.forEach((p, i) => {
    const [cx, , cz] = polar(p.a, p.r, 0);
    const y = p.y;
    const pad = lathe([[0, y - 0.75], [p.R - 0.7, y - 0.75], [p.R, y - 0.3], [p.R, y - 0.3], [p.R, y], [p.R, y], [0, y]], 48).translate(cx, 0, cz);
    body.push({ geometry: pad, color: p.color });
    // The landing mark, a hair proud of the deck.
    const decal = atlasDisc(p.R - 0.35, y - 0.02, y + 0.035, atlas.pad(i), atlas.edge, 48).rotateY(p.a + Math.PI).translate(cx, 0, cz);
    signs.push({ geometry: decal });
    // The glowing rim and eight landing lights.
    glow.push({ geometry: ring(p.R, 0.12, [cx, y - 0.3, cz], 'y', 5, 44), color: p.glow });
    for (let k = 0; k < 8; k++) {
      const b = (k / 8) * TAU + 0.2;
      glow.push({ geometry: ball([cx + Math.sin(b) * (p.R - 0.18), y + 0.04, cz + Math.cos(b) * (p.R - 0.18)], 0.09, 6, 4), color: 0xffffff, scale: [1, 0.6, 1], about: [cx + Math.sin(b) * (p.R - 0.18), y + 0.04, cz + Math.cos(b) * (p.R - 0.18)] });
    }
    if (p.r > 0) {
      // A beam out from the column under the deck, and a curved brace below it.
      const r0 = columnR(y - 0.8) - 0.3;
      body.push({ geometry: bar(polar(p.a, r0, y - 1.05), polar(p.a, p.r + 1.4, y - 0.95), 1.0, 0.55), color: WHITE });
      body.push({ geometry: tube([polar(p.a, columnR(y - 3.4) - 0.2, y - 3.4), polar(p.a, 2.9, y - 2.1), polar(p.a, 4.6, y - 1.25), polar(p.a, 5.8, y - 0.9)], [0.32, 0.27, 0.22, 0.2], { sides: 10, round: 1, steps: 12 }), color: WHITE });
      glow.push({ geometry: ring(columnR(y - 3.4) + 0.02, 0.07, [0, y - 3.4, 0], 'y', 5, 36), color: p.glow });
    }
  });
  // A light mast at the back of the top pad, with a gold beacon.
  const top = DP_PADS[3];
  body.push({ geometry: rod([0, top.y - 0.1, -3.9], [0, top.y + 3.2, -3.9], 0.11, 10), color: WHITE });
  body.push({ geometry: ring(0.34, 0.05, [0, top.y + 3.1, -3.9], 'y', 5, 20), color: WHITE });
  glow.push({ geometry: ball([0, top.y + 3.45, -3.9], 0.32, 14, 10), color: FUTURE.glowGold });

  // BATTERY-SWAP LOCKERS round the foot, the open front left for the sign and the pickup box.
  const doorColors = [FUTURE.lime, FUTURE.aqua, FUTURE.sun];
  for (let k = 0; k < 8; k++) {
    const a = deg(75 + k * 30);
    const M = new THREE.Matrix4().makeRotationY(a);
    const unit = [];
    const uGlow = [];
    unit.push({ geometry: boxAt(2.3, 4.6, 1.95, 0, 0.25 + 2.3, 3.42), color: 0xd9dee6 });
    for (let row = 0; row < 3; row++) {
      const y0 = 0.5 + row * 1.42;
      unit.push({ geometry: boxAt(1.72, 1.26, 0.08, 0, y0 + 0.63, 4.42), color: doorColors[(k + row) % 3] });
      unit.push({ geometry: boxAt(0.08, 0.36, 0.1, 0.5, y0 + 0.63, 4.5), color: 0x5a6270 });
      uGlow.push({ geometry: ball([-0.48, y0 + 1.04, 4.47], 0.07, 6, 4), color: (k * 3 + row) % 4 === 1 ? FUTURE.glowGold : FUTURE.glowLime });
      // A battery icon: a body and a tip.
      uGlow.push({ geometry: boxAt(0.42, 0.18, 0.04, -0.05, y0 + 0.42, 4.47), color: FUTURE.glowLime });
      uGlow.push({ geometry: boxAt(0.06, 0.08, 0.04, 0.2, y0 + 0.42, 4.47), color: FUTURE.glowLime });
    }
    for (const p of unit) body.push({ geometry: p.geometry.applyMatrix4(M), color: p.color });
    for (const p of uGlow) glow.push({ geometry: p.geometry.applyMatrix4(M), color: p.color });
  }
  // The lockers' shared roof ring, sun yellow, closing the gap to the column.
  body.push({ geometry: lathe([[0, 4.85], [4.62, 4.85], [4.62, 4.85], [4.62, 5.2], [4.62, 5.2], [0, 5.2]], 48), color: FUTURE.sun });
  glow.push({ geometry: ring(4.64, 0.06, [0, 5.02, 0], 'y', 5, 64), color: FUTURE.glowLime });
  // BATTERY SWAP label on the locker roof's front edge, facing the side the lockers start on.
  for (const a of [deg(120), deg(210)]) {
    const plate = atlasPlate(2.9, 0.62, 0.06, atlas.battery, atlas.edge).translate(0, 5.62, 4.62);
    plate.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
    signs.push({ geometry: plate });
    body.push({ geometry: boxAt(3.1, 0.8, 0.12, 0, 5.62, 4.53).applyMatrix4(new THREE.Matrix4().makeRotationY(a)), color: 0x2b3448 });
  }

  // DRONE PORT sign on the column's front, above the lockers.
  const sy = 9.6;
  const sz = columnR(sy) + 0.25;
  body.push({ geometry: roundedLoft([{ y: sy - 0.85, hw: 2.85, hd: 0.18, r: 0.15, cz: sz - 0.1 }, { y: sy + 0.85, hw: 2.85, hd: 0.18, r: 0.15, cz: sz - 0.1 }], 2), color: 0x2b3448 });
  signs.push({ geometry: atlasPlate(5.4, 1.25, 0.06, atlas.sign, atlas.edge).translate(0, sy, sz + 0.1) });
  body.push({ geometry: bar([0, sy, columnR(sy) - 0.3], [0, sy, sz - 0.2], 1.2, 0.6), color: 0x2b3448 });

  // THE PARCEL CHUTE: a funnel at the lowest pad's edge, a glass tube spiralling down round the
  // tower with parcels sliding in it, and a pickup box at the front.
  const CHUTE_R = 7.7;
  const chuteAt = (t) => { const a = deg(26 - 386 * t); return polar(a, CHUTE_R, mix(6.0, 2.3, t)); };
  const cPts = [];
  for (let i = 0; i <= 24; i++) cPts.push(chuteAt(i / 24));
  glass.push({ geometry: tube(cPts, 0.55, { sides: 12, steps: 72, round: 1 }), color: 0x7fe3ff });
  // A glowing guide line along its floor, so the spiral reads from across the street.
  glow.push({ geometry: tube(cPts.map((p) => [p[0], p[1] - 0.5, p[2]]), 0.06, { sides: 4, steps: 60, round: 0 }), color: FUTURE.glowCyan });
  // Collars every so often, holding it up on thin posts.
  for (let i = 1; i < 12; i += 2) {
    const t = i / 12; const p = chuteAt(t);
    const q = chuteAt(t + 0.01);
    const dir = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
    const g2 = ring(0.6, 0.09, [0, 0, 0], 'z', 6, 20);
    g2.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)));
    g2.translate(p[0], p[1], p[2]);
    body.push({ geometry: g2, color: FUTURE.sun });
    body.push({ geometry: rod([p[0], 0.25, p[2]], [p[0], p[1] - 0.6, p[2]], 0.08, 8), color: 0xdfe5ec });
  }
  // Parcels inside the glass, resting on its floor.
  for (const [t, c] of [[0.12, FUTURE.sun], [0.3, FUTURE.coral], [0.52, FUTURE.lime], [0.74, FUTURE.aqua], [0.9, FUTURE.magenta]]) {
    const p = chuteAt(t); const q = chuteAt(t + 0.01);
    const yaw = Math.atan2(q[0] - p[0], q[2] - p[2]);
    const g = roundedLoft([{ y: -0.19, hw: 0.24, hd: 0.3, r: 0.05 }, { y: 0.19, hw: 0.24, hd: 0.3, r: 0.05 }], 2);
    g.rotateY(yaw); g.translate(p[0], p[1] - 0.3, p[2]);
    body.push({ geometry: g, color: c });
  }
  // The funnel, attached to the rim of pad 1.
  const f0 = chuteAt(0);
  body.push({ geometry: lathe([[0, -0.5], [0.62, -0.5], [0.66, 0.1], [1.05, 0.9], [1.12, 0.95], [1.0, 0.95], [0.58, 0.2], [0, 0.2]], 24).translate(f0[0], f0[1] + 0.35, f0[2]), color: FUTURE.sun });
  glow.push({ geometry: ring(1.08, 0.06, [f0[0], f0[1] + 1.3, f0[2]], 'y', 5, 28), color: FUTURE.glowPink });
  // The pickup box at the front, its glowing hatch facing the street.
  const bz = CHUTE_R - 0.1;
  body.push({ geometry: roundedLoft([{ y: 0.2, hw: 1.5, hd: 1.15, r: 0.4, cz: bz }, { y: 2.7, hw: 1.5, hd: 1.15, r: 0.4, cz: bz }, { y: 3.0, hw: 1.3, hd: 0.95, r: 0.35, cz: bz }], 3), color: FUTURE.coral });
  body.push({ geometry: boxAt(1.9, 1.1, 0.06, 0, 1.25, bz + 1.16), color: 0x1d2433 });
  glow.push({ geometry: boxAt(2.1, 0.09, 0.08, 0, 1.85, bz + 1.17), color: FUTURE.glowPink });
  glow.push({ geometry: boxAt(2.1, 0.09, 0.08, 0, 0.66, bz + 1.17), color: FUTURE.glowPink });
  glow.push({ geometry: boxAt(1.7, 0.7, 0.03, 0, 1.25, bz + 1.2), color: tone(FUTURE.glowPink, 0.35) });
  signs.push({ geometry: atlasPlate(2.5, 0.56, 0.05, atlas.parcels, atlas.edge).translate(0, 2.32, bz + 1.17) });

  // A drone parked on pad 1, facing out.
  const p1 = DP_PADS[0];
  const parked = drone({ shell: FUTURE.lime, guard: FUTURE.magenta });
  const Mp = new THREE.Matrix4().compose(new THREE.Vector3(...polar(p1.a, p1.r, p1.y + 0.03)), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p1.a - 0.5), new THREE.Vector3(1, 1, 1));
  body.push(...placeParts(parked.body, Mp));
  for (const r of parked.rotors) body.push(...placeParts(r.parts, Mp));
  glow.push(...placeParts(parked.glow, Mp));

  const group = new THREE.Group();
  group.add(meshOf(body, bodyMat({ roughness: 0.45, metalness: 0.15 })));
  group.add(meshOf(glow, glowMat(), { cast: false, receive: false }));
  group.add(meshOf(signs, signMat(atlas.tex, 0.75), { cast: false }));
  const glassMesh = meshOf(glass, standard({ vertexColors: true, transparent: true, opacity: 0.42, roughness: 0.1, metalness: 0, depthWrite: false }), { cast: false, receive: false });
  group.add(glassMesh);

  // THE CIRCLING DRONE: an orbit group turning about the tower's axis, the drone bobbing on it,
  // its four rotors spinning in their own mesh.
  const flyer = drone({ shell: FUTURE.coral, guard: FUTURE.aqua, parcel: true });
  const orbit = new THREE.Group();
  const craft = new THREE.Group();
  const ORBIT_R = 12.4; const ORBIT_Y = 16.4;
  // The craft's geometry is lifted a foot so none of it sits below its own origin: a seated
  // piece's foundation rule carries every vertex below -0.33 down to the skirt, in each mesh's
  // OWN space, so a parcel hanging under a craft at its origin would be dragged to the ground.
  const LIFT = 1;
  const up = new THREE.Matrix4().makeTranslation(0, LIFT, 0);
  craft.position.set(ORBIT_R, ORBIT_Y - LIFT, 0);
  craft.rotation.set(0, Math.PI, 0.14); // nose along the direction of travel, banked into the turn
  // One mesh for the craft's shell AND its rotors: the shell is a unit that never turns.
  const spin = spinMesh([
    { parts: placeParts(flyer.body, up), pivot: [0, 0, 0], axis: [0, 1, 0], speed: 0 },
    ...flyer.rotors.map((r, i) => ({ parts: placeParts(r.parts, up), pivot: [r.pivot[0], r.pivot[1] + LIFT, r.pivot[2]], axis: r.axis, speed: 28 + i * 1.7, phase: i * 0.7 })),
  ], bodyMat({ roughness: 0.4, metalness: 0.15 }));
  craft.add(spin.mesh);
  craft.add(meshOf(placeParts(flyer.glow, up), glowMat(), { cast: false, receive: false }));
  orbit.add(craft);
  orbit.rotation.y = -0.96;
  group.add(orbit);
  let t = 0;
  group.userData.tick = tickOf((dt) => {
    t += dt;
    orbit.rotation.y += dt * 0.32;
    craft.position.y = ORBIT_Y - LIFT + Math.sin(t * 1.3) * 0.5;
    spin.update(dt);
  });
  return group;
}

// ---------------------------------------------------------------------------------------------
// WIND TREE
// ---------------------------------------------------------------------------------------------
const WT_TIPS = 32;

// One leaf turbine about its own vertical axis, standing on (0,0,0): a thin spindle and two
// cupped, twisted leaf blades. Coloured per vertex, lighter toward the top like a new leaf.
function leafTurbine(base, rng) {
  const parts = [];
  const H = 2.1;
  parts.push({ geometry: new THREE.CylinderGeometry(0.035, 0.035, H + 0.12, 4, 1).translate(0, (H + 0.12) / 2, 0), color: 0xcfd6de });
  const twist = 0.55 + rng() * 0.25;
  for (const side of [0, Math.PI]) {
    const g = new THREE.SphereGeometry(1, 6, 5);
    const P = g.attributes.position;
    const col = new Float32Array(P.count * 3);
    const c0 = tone(base, 0.78); const c1 = tone(base, 1.18);
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i);
      let x = P.getX(i) * 0.4 * (1 - 0.25 * y * y) + 0.38; // radial, off the spindle
      let z = P.getZ(i) * 0.05 + 0.14 * ((x - 0.38) / 0.4) ** 2; // thin, and cupped
      const a = twist * y + side;
      const ca = Math.cos(a); const sa = Math.sin(a);
      const nx = x * ca + z * sa; const nz = -x * sa + z * ca;
      x = nx; z = nz;
      P.setXYZ(i, x, H / 2 + 0.06 + y * (H / 2 - 0.04), z);
      const t = clampT((y + 1) / 2);
      col[i * 3] = mix(c0.r, c1.r, t); col[i * 3 + 1] = mix(c0.g, c1.g, t); col[i * 3 + 2] = mix(c0.b, c1.b, t);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push({ geometry: g, keepColor: true });
  }
  return parts;
}
const clampT = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

function windTree() {
  const rng = seededRandom(4471);
  const steel = []; const glow = [];
  const STEEL = 0xd2d9e2;
  // The plinth: a low round base with a teal band and a glowing ring.
  steel.push({ geometry: lathe([[0, BASE], [3.4, BASE], [3.4, 0.2], [3.4, 0.2], [3.15, 0.5], [3.15, 0.5], [0, 0.5]], 28), color: 0x9fb0c0 });
  steel.push({ geometry: lathe([[0, 0.48], [2.6, 0.48], [2.6, 0.58], [0, 0.58]], 28), color: FUTURE.teal });
  glow.push({ geometry: ring(3.3, 0.07, [0, 0.33, 0], 'y', 4, 32), color: FUTURE.glowLime });
  // The trunk, flared at its foot.
  steel.push({ geometry: lathe([[0, 0.4], [1.15, 0.4], [0.82, 0.95], [0.6, 2.0], [0, 2.3]], 18), color: STEEL });
  const T = [0, 9.2, 0];
  const trunkPts = [[0, 0.6, 0], [0.18, 3.2, 0.06], [-0.12, 6.2, -0.06], T];
  steel.push({ geometry: tube(trunkPts, [0.62, 0.55, 0.48, 0.42], { sides: 12, steps: 12, round: 0 }), color: STEEL });
  steel.push({ geometry: ball(T, 0.47, 12, 8), color: STEEL });
  // A glowing spiral climbing the trunk, riding its own curve so it never sinks into it.
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPts.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  const sp = [];
  for (let i = 0; i <= 40; i++) {
    const t = mix(0.1, 0.94, i / 40);
    const c = trunkCurve.getPoint(t);
    const r = mix(0.62, 0.42, t) + 0.03;
    const a = t * TAU * 2.4;
    sp.push([c.x + Math.sin(a) * r, c.y, c.z + Math.cos(a) * r]);
  }
  glow.push({ geometry: tube(sp, 0.045, { sides: 4, steps: 48, round: 0 }), color: FUTURE.glowLime });

  // Three limbs, each splitting in three.
  const sec = [];
  for (let i = 0; i < 3; i++) {
    const a = deg(i * 120 + 20);
    const L = polar(a, 2.3, 13.0);
    steel.push({ geometry: tube([T, polar(a + 0.1, 0.9, 10.9), L], [0.4, 0.33, 0.29], { sides: 8, steps: 6, round: 0 }), color: STEEL });
    steel.push({ geometry: ball(L, 0.32, 10, 8), color: STEEL });
    for (const [j, d] of [-38, 0, 38].entries()) {
      const b = a + deg(d);
      const S = polar(b, 4.5, j === 1 ? 17.0 : 15.9);
      steel.push({ geometry: tube([L, polar(b, 3.3, (L[1] + S[1]) / 2 + 0.6), S], [0.28, 0.22, 0.19], { sides: 6, steps: 4, round: 0 }), color: STEEL });
      steel.push({ geometry: ball(S, 0.21, 7, 5), color: STEEL });
      sec.push(S);
    }
  }

  // The leaf turbines, spread evenly over a dome by a golden-angle spiral, each on a twig from the
  // nearest branch end.
  const units = [];
  const C = [0, 14.6, 0]; const R = 7.6;
  const hues = [FUTURE.lime, FUTURE.leaf, 0x63c24a, 0x9ad94a, 0x34b57a, 0x7ccf3c];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < WT_TIPS; k++) {
    const f = (k + 0.5) / WT_TIPS;
    const theta = deg(12 + 66 * Math.sqrt(f)) + (rng() - 0.5) * 0.06;
    const phi = k * golden;
    const tip = [C[0] + Math.sin(theta) * Math.sin(phi) * R, C[1] + Math.cos(theta) * R, C[2] + Math.sin(theta) * Math.cos(phi) * R];
    let S = sec[0]; let best = 1e9;
    for (const s2 of sec) {
      const d = (s2[0] - tip[0]) ** 2 + (s2[1] - tip[1]) ** 2 + (s2[2] - tip[2]) ** 2;
      if (d < best) { best = d; S = s2; }
    }
    const mid = [mix(S[0], tip[0], 0.55), mix(S[1], tip[1], 0.55) - 0.35, mix(S[2], tip[2], 0.55)];
    steel.push({ geometry: tube([S, mid, [tip[0], tip[1] - 0.5, tip[2]], tip], [0.15, 0.12, 0.1, 0.1], { sides: 4, steps: 3, round: 0 }), color: STEEL });
    const parts = leafTurbine(hues[k % hues.length], rng).map((p) => ({ ...p, geometry: p.geometry.translate(tip[0], tip[1], tip[2]) }));
    units.push({ parts, pivot: tip, axis: [0, 1, 0], speed: 1.1 + rng() * 1.5, phase: rng() * TAU });
    glow.push({ geometry: ball([tip[0], tip[1] + 2.24, tip[2]], 0.07, 4, 2), color: k % 3 ? FUTURE.glowLime : FUTURE.glowCyan });
  }

  const group = new THREE.Group();
  group.add(meshOf(steel, bodyMat({ roughness: 0.32, metalness: 0.35 })));
  group.add(meshOf(glow, glowMat(), { cast: false, receive: false }));
  const leaves = spinMesh(units, bodyMat({ roughness: 0.45, metalness: 0.05 }));
  group.add(leaves.mesh);
  group.userData.tick = tickOf((dt) => leaves.update(dt));
  return group;
}

// ---------------------------------------------------------------------------------------------
// AIR-CLEANING TOWER
// ---------------------------------------------------------------------------------------------
const AC_LEVELS = [
  { y0: 4.2, y1: 14.8, band: FUTURE.sun, shroud: FUTURE.magenta },
  { y0: 14.8, y1: 25.4, band: FUTURE.magenta, shroud: FUTURE.sun },
  { y0: 25.4, y1: 36.0, band: FUTURE.teal, shroud: FUTURE.coral },
];
const AC_CORE = 5.6; // half width of the tower's core
const AC_FAN_R = 4.2;

function airTowerAtlas() {
  const W = 512; const H = 512;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#0d2326';
    ctx.fillRect(0, 0, W, H);
    // A honeycomb filter, glowing aqua at the bottom fading to lime at the top.
    const r = 26; const hx = r * Math.sqrt(3);
    for (let row = -1; row < 16; row++) {
      for (let col = -1; col < 12; col++) {
        const cx = col * hx + (row % 2 ? hx / 2 : 0); const cy = row * r * 1.5;
        if (cy > 384 + r) continue;
        const t = Math.min(1, Math.max(0, cy / 384));
        const c = mixHex(FUTURE.glowLime, FUTURE.glowCyan, t);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const x = cx + Math.cos(a) * (r - 3); const y = cy + Math.sin(a) * (r - 3);
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${Math.round(c.r * 120)},${Math.round(c.g * 150)},${Math.round(c.b * 120)},0.55)`;
        ctx.fill();
        ctx.strokeStyle = `#${c.getHexString()}`;
        ctx.lineWidth = 3;
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    // Clear the band under the honeycomb for the sign.
    ctx.fillStyle = '#122033';
    ctx.fillRect(0, 392, W, 120);
    roundRect(ctx, 6, 398, 500, 100, 24);
    ctx.strokeStyle = '#b6ff5c'; ctx.lineWidth = 5; ctx.stroke();
    // A leaf, drawn as a path, before the words.
    ctx.save();
    ctx.translate(70, 448); ctx.rotate(-0.6);
    ctx.fillStyle = '#b6ff5c'; ctx.shadowColor = '#b6ff5c'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(0, -34); ctx.quadraticCurveTo(26, 0, 0, 34); ctx.quadraticCurveTo(-26, 0, 0, -34); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#1d3a1d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(0, 30); ctx.stroke();
    ctx.restore();
    glowText(ctx, 'CLEAN AIR', 285, 450, 360, 74, '#eaffd0', '#b6ff5c');
    ctx.fillStyle = '#1a2a38';
    ctx.fillRect(480, 0, 32, 32);
  });
  return { tex, filter: rect(0, 0, 512, 384, W, H), sign: rect(6, 398, 500, 100, W, H), edge: rect(484, 4, 24, 24, W, H) };
}

// One fan facing +Z, centred on the origin: six twisted blades round a hub.
function fanParts() {
  const parts = [];
  parts.push({ geometry: lathe([[0, -0.2], [0.95, -0.2], [0.95, 0.2], [0.7, 0.75], [0.3, 1.0], [0, 1.05]], 20).rotateX(Math.PI / 2), color: 0xf0f2f5 });
  for (let k = 0; k < 6; k++) {
    const g = new THREE.SphereGeometry(1, 8, 5);
    g.scale(0.62, 1.75, 0.08); // width, radial length, thickness
    g.rotateY(0.42); // the pitch that makes it push air
    g.translate(0, 2.35, 0.15);
    g.rotateZ((k / 6) * TAU);
    const P = g.attributes.position;
    const col = new Float32Array(P.count * 3);
    for (let i = 0; i < P.count; i++) {
      const rr = Math.hypot(P.getX(i), P.getY(i));
      const c = rr > 3.4 ? new THREE.Color(FUTURE.aqua) : new THREE.Color(0xe6eaf0);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push({ geometry: g, keepColor: true });
  }
  return parts;
}

function airCleaningTower() {
  const body = []; const glow = []; const signs = []; const plants = []; const units = [];
  const atlas = airTowerAtlas();
  const rng = seededRandom(5521);
  const PEARL = FUTURE.pearl;
  const CORE = 0x41597a;

  body.push({ geometry: roundedLoft([{ y: BASE, hw: 9.6, hd: 9.6, r: 3 }, { y: 0.3, hw: 9.6, hd: 9.6, r: 3 }]), color: PEARL });
  glow.push({ geometry: roundedLoft([{ y: 0.12, hw: 9.66, hd: 9.66, r: 3.05 }, { y: 0.2, hw: 9.66, hd: 9.66, r: 3.05 }]), color: FUTURE.glowLime });
  // The intake base, violet, with glowing slots on three sides.
  body.push({ geometry: roundedLoft([{ y: 0.2, hw: 6.8, hd: 6.8, r: 1.4 }, { y: 4.3, hw: 6.8, hd: 6.8, r: 1.4 }]), color: FUTURE.violet });
  for (const [ax, az] of [[1, 0], [-1, 0], [0, -1]]) {
    for (let k = 0; k < 4; k++) {
      const y = 1.0 + k * 0.82;
      const g = ax ? boxAt(0.08, 0.16, 10.0, ax * 6.82, y, 0) : boxAt(10.0, 0.16, 0.08, 0, y, az * 6.82);
      glow.push({ geometry: g, color: k % 2 ? FUTURE.glowCyan : FUTURE.glowLime });
      const d = ax ? boxAt(0.12, 0.42, 10.2, ax * 6.8, y + 0.32, 0) : boxAt(10.2, 0.42, 0.12, 0, y + 0.32, az * 6.8);
      body.push({ geometry: d, color: tone(FUTURE.violet, 0.75) });
    }
  }
  // CLEAN AIR across the front.
  body.push({ geometry: boxAt(10.4, 2.0, 0.16, 0, 2.3, 6.84), color: 0x1d2840 });
  signs.push({ geometry: atlasPlate(10.0, 1.7, 0.06, atlas.sign, atlas.edge).translate(0, 2.3, 6.95) });

  // The core, the four corner columns and the coloured bands between levels.
  body.push({ geometry: roundedLoft([{ y: 4.0, hw: AC_CORE, hd: AC_CORE, r: 0.8 }, { y: 36.2, hw: AC_CORE, hd: AC_CORE, r: 0.8 }], 3), color: CORE });
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    body.push({ geometry: roundedLoft([{ y: 4.0, hw: 0.7, hd: 0.7, r: 0.3, cx: sx * 5.85, cz: sz * 5.85 }, { y: 36.4, hw: 0.7, hd: 0.7, r: 0.3, cx: sx * 5.85, cz: sz * 5.85 }], 3), color: FUTURE.coral });
    glow.push({ geometry: boxAt(0.1, 31.6, 0.1, sx * 6.57, 20.2, sz * 6.0), color: FUTURE.glowPink });
  }
  const bandAt = (y, color) => {
    body.push({ geometry: roundedLoft([{ y: y - 0.42, hw: 6.55, hd: 6.55, r: 0.9 }, { y: y + 0.42, hw: 6.55, hd: 6.55, r: 0.9 }], 3), color });
    glow.push({ geometry: roundedLoft([{ y: y - 0.05, hw: 6.6, hd: 6.6, r: 0.92 }, { y: y + 0.05, hw: 6.6, hd: 6.6, r: 0.92 }], 3), color: FUTURE.glowCyan });
  };
  AC_LEVELS.forEach((L, i) => {
    bandAt(L.y1, i === 2 ? FUTURE.lime : AC_LEVELS[i + 1].band);
    const yc = (L.y0 + L.y1) / 2;
    for (const side of [1, -1]) {
      const M = new THREE.Matrix4().makeRotationY(side > 0 ? 0 : Math.PI);
      const put = (g) => g.applyMatrix4(M);
      // The duct, dark, standing just proud of the core, and the shroud round it.
      body.push({ geometry: put(cylY(AC_FAN_R + 0.3, AC_FAN_R + 0.3, -0.25, 0.25, 0, 0, 40).rotateX(Math.PI / 2).translate(0, yc, AC_CORE + 0.2)), color: 0x152030 });
      body.push({ geometry: put(lathe([[0, -0.4], [0.9, -0.4], [0.9, 0.2], [0, 0.2]], 16).rotateX(Math.PI / 2).translate(0, yc, AC_CORE + 0.35)), color: 0x2a3446 });
      body.push({ geometry: put(ring(AC_FAN_R + 0.42, 0.36, [0, yc, AC_CORE + 0.55], 'z', 8, 48)), color: L.shroud });
      // Four struts holding the hub, behind the blades.
      for (let k = 0; k < 4; k++) {
        const a = deg(45 + k * 90);
        body.push({ geometry: put(bar([0, yc, AC_CORE + 0.5], [Math.cos(a) * (AC_FAN_R + 0.2), yc + Math.sin(a) * (AC_FAN_R + 0.2), AC_CORE + 0.5], 0.18, 0.18, [0, 0, 1])), color: 0x2a3446 });
      }
      glow.push({ geometry: put(ring(AC_FAN_R + 0.02, 0.06, [0, yc, AC_CORE + 0.52], 'z', 4, 48)), color: FUTURE.glowCyan });
      glow.push({ geometry: put(ring(0.55, 0.06, [0, yc, AC_CORE + 1.62], 'z', 4, 20)), color: FUTURE.glowLime });
      const fan = fanParts().map((p) => ({ ...p, geometry: put(p.geometry.translate(0, yc, AC_CORE + 0.65)) }));
      units.push({ parts: fan, pivot: [0, yc, side * (AC_CORE + 0.65)], axis: [0, 0, side], speed: 1.6 + i * 0.25 + rng() * 0.3, phase: rng() * TAU });
    }
    // Glowing filter panels on both sides.
    for (const side of [1, -1]) {
      const g = atlasPlate(9.0, 9.4, 0.08, atlas.filter, atlas.edge).translate(0, yc, AC_CORE + 0.04);
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(side * Math.PI / 2));
      signs.push({ geometry: g });
    }
  });
  bandAt(4.3, FUTURE.sun);

  // THE CROWN: a planter bowl with a glowing rim, three small trees and a ring of flowering shrubs.
  body.push({ geometry: lathe([[0, 36.0], [6.0, 36.0], [7.4, 37.0], [7.9, 38.3], [7.9, 38.3], [7.55, 38.5], [7.55, 38.5], [0, 38.5]], 48), color: FUTURE.teal });
  glow.push({ geometry: ring(7.85, 0.09, [0, 38.25, 0], 'y', 5, 64), color: FUTURE.glowLime });
  body.push({ geometry: cylY(7.5, 7.5, 38.3, 38.62, 0, 0, 40), color: 0x6b4b33 });
  for (const [i, a] of [deg(35), deg(155), deg(275)].entries()) {
    const [x, , z] = polar(a, 3.2, 0);
    const h = 3.4 + i * 0.45;
    plants.push({ geometry: tube([[x, 38.4, z], [x + 0.1, 38.6 + h * 0.5, z - 0.1], [x, 38.6 + h, z]], [0.32, 0.24, 0.18], { sides: 7, steps: 5, round: 0 }), color: 0x6e5038 });
    plants.push({ geometry: blob([x, 38.6 + h + 0.8, z], 2.0, 0.85, 2, rng, [FUTURE.leaf, 0x4bb35a, 0x3a9a48][i]), keepColor: true });
    plants.push({ geometry: blob([x + 0.9, 38.6 + h - 0.2, z + 0.5], 1.3, 0.85, 1, rng, 0x58b84d), keepColor: true });
  }
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * TAU + 0.2;
    const [x, , z] = polar(a, 6.1, 0);
    plants.push({ geometry: blob([x, 39.1, z], 0.95 + rng() * 0.35, 0.8, 1, rng, k % 2 ? 0x4fae46 : 0x6cc24a), keepColor: true });
    for (let f = 0; f < 3; f++) {
      const b = a + (f - 1) * 0.18;
      plants.push({ geometry: ball(polar(b, 6.1 + (rng() - 0.3) * 0.8, 39.7 + rng() * 0.4), 0.2, 6, 4), color: [FUTURE.magenta, FUTURE.sun, FUTURE.coral, FUTURE.violet][(k + f) % 4] });
    }
  }

  // THE BREATH: three pale ribbons of fresh air spiralling up out of the crown, turning slowly.
  const breath = [];
  for (let k = 0; k < 3; k++) {
    const pos = []; const col = []; const idx = [];
    const N = 48;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = (k / 3) * TAU + t * TAU * 0.9;
      const r = mix(5.4, 7.2, t);
      const y = mix(40.2, 47.6, t);
      const w = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.1));
      const fade = Math.sin(Math.PI * t) ** 0.7;
      for (const s2 of [-1, 1]) {
        pos.push(Math.sin(a) * r, y + s2 * w, Math.cos(a) * r);
        const c = new THREE.Color(0xa8f4ff).multiplyScalar(0.9 * fade);
        col.push(c.r, c.g, c.b);
      }
      if (i < N) { const b = i * 2; idx.push(b, b + 1, b + 3, b, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    breath.push({ geometry: g, keepColor: true });
  }

  const group = new THREE.Group();
  group.add(meshOf(body, bodyMat({ roughness: 0.48, metalness: 0.15 })));
  group.add(meshOf(glow, glowMat(), { cast: false, receive: false }));
  group.add(meshOf(signs, signMat(atlas.tex, 0.8), { cast: false }));
  group.add(meshOf(plants, bodyMat({ roughness: 0.75, metalness: 0 })));
  const fans = spinMesh(units, bodyMat({ roughness: 0.4, metalness: 0.2 }));
  group.add(fans.mesh);
  const swirl = new THREE.Group();
  swirl.add(meshOf(breath, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), { cast: false, receive: false }));
  group.add(swirl);
  group.userData.tick = tickOf((dt) => {
    fans.update(dt);
    swirl.rotation.y += dt * 0.35;
  });
  return group;
}

// ---------------------------------------------------------------------------------------------
// HOLOGRAM KIOSK
// ---------------------------------------------------------------------------------------------
const HK_DISC_Y = 5.6; // the hologram's floor
const HK_DISC_R = 2.7;

function kioskAtlas() {
  const W = 512; const H = 384;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#0f1a33';
    ctx.fillRect(0, 0, W, H);
    // The screen: a header, a little map, and four big buttons.
    const sx = 0; const sy = 0; const sw = 512; const sh = 344;
    ctx.fillStyle = '#132447';
    roundRect(ctx, sx + 6, sy + 6, sw - 12, sh - 12, 22); ctx.fill();
    ctx.strokeStyle = '#5cf2ff'; ctx.lineWidth = 4; ctx.stroke();
    glowText(ctx, 'CITY GUIDE', 256, 42, 300, 40, '#d6fbff', '#5cf2ff');
    // The map.
    ctx.fillStyle = '#0b3a4a';
    roundRect(ctx, 22, 72, 250, 250, 14); ctx.fill();
    ctx.strokeStyle = '#2a7f95'; ctx.lineWidth = 9;
    for (const x of [72, 150, 226]) { ctx.beginPath(); ctx.moveTo(x, 78); ctx.lineTo(x, 316); ctx.stroke(); }
    for (const y of [124, 200, 276]) { ctx.beginPath(); ctx.moveTo(28, y); ctx.lineTo(266, y); ctx.stroke(); }
    ctx.fillStyle = '#3fa34d';
    roundRect(ctx, 160, 210, 56, 56, 8); ctx.fill();
    ctx.strokeStyle = '#ff5ccf'; ctx.lineWidth = 6; ctx.shadowColor = '#ff5ccf'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(72, 300); ctx.lineTo(72, 200); ctx.lineTo(150, 200); ctx.lineTo(150, 124); ctx.lineTo(226, 124); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(72, 300, 11, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff5ccf';
    ctx.beginPath(); ctx.arc(226, 124, 13, 0, TAU); ctx.fill();
    // Buttons.
    const btn = (y, label, c) => {
      ctx.fillStyle = c;
      roundRect(ctx, 290, y, 200, 52, 16); ctx.fill();
      ctx.fillStyle = '#0f1a33';
      fitFont(ctx, label, 176, 28, HEAVY);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 390, y + 27);
    };
    btn(74, 'WHERE TO?', '#5cf2ff');
    btn(136, 'FOOD', '#ffd166');
    btn(198, 'PARKS', '#b6ff5c');
    btn(260, 'TRAINS', '#ff8fdc');
    ctx.fillStyle = '#1a2232';
    ctx.fillRect(0, 352, 32, 32);
  });
  return { tex, screen: rect(0, 0, 512, 344, W, H), edge: rect(4, 356, 24, 24, W, H) };
}

function hologramKiosk() {
  const body = []; const glow = []; const signs = []; const holo = []; const lines = [];
  const atlas = kioskAtlas();
  const rng = seededRandom(7310);
  const PEARL = 0xdfe4ec;

  // The base disc and the pedestal, pearl with a violet waist.
  body.push({ geometry: lathe([[0, -0.2], [2.1, -0.2], [2.1, 0.08], [2.1, 0.08], [1.95, 0.18], [1.95, 0.18], [0, 0.18]], 40), color: 0xb7c2cf });
  glow.push({ geometry: ring(2.06, 0.05, [0, 0.03, 0], 'y', 4, 40), color: FUTURE.glowCyan });
  const ped = lathe([[0, 0.1], [1.55, 0.1], [1.4, 0.4], [1.12, 1.2], [1.06, 1.6], [1.06, 1.601], [1.03, 2.1], [1.0, 2.899], [1.0, 2.9], [1.12, 3.5], [1.4, 4.0], [1.62, 4.3], [1.62, 4.3], [1.62, 4.5], [1.62, 4.5], [0, 4.5]], 40);
  body.push({ geometry: ped, keepColor: true, tint: (p) => { const c = new THREE.Color(p.y > 1.6005 && p.y < 2.8995 ? FUTURE.violet : PEARL); return [c.r, c.g, c.b]; } });
  glow.push({ geometry: ring(1.62, 0.07, [0, 4.4, 0], 'y', 5, 44), color: FUTURE.glowCyan });
  glow.push({ geometry: ring(1.08, 0.05, [0, 1.62, 0], 'y', 4, 36), color: FUTURE.glowPink });
  glow.push({ geometry: ring(1.02, 0.05, [0, 2.88, 0], 'y', 4, 36), color: FUTURE.glowPink });
  // The projector lens on top.
  body.push({ geometry: lathe([[0, 4.45], [0.9, 4.45], [0.9, 4.62], [0, 4.62]], 28), color: 0x34405a });
  glow.push({ geometry: lathe([[0, 4.55], [0.6, 4.55], [0.55, 4.72], [0.3, 4.8], [0, 4.82]], 24), color: FUTURE.glowCyan });
  // An "i" badge on each side.
  for (const sx of [-1, 1]) {
    const x = sx * 1.07;
    glow.push({ geometry: ring(0.32, 0.04, [x, 2.25, 0], 'x', 4, 24), color: FUTURE.glowGold });
    glow.push({ geometry: boxAt(0.05, 0.26, 0.08, x, 2.17, 0), color: FUTURE.glowGold });
    glow.push({ geometry: ball([x, 2.4, 0], 0.05, 6, 4), color: FUTURE.glowGold });
  }

  // The arm, from the pedestal's back up and over to a ring emitter above the hologram.
  const armPts = [[0, 3.3, -0.75], [0, 4.2, -2.5], [0, 6.5, -3.45], [0, 8.8, -3.1], [0, 9.85, -1.9], [0, 10.0, -1.05]];
  body.push({ geometry: tube(armPts, [0.24, 0.22, 0.19, 0.17, 0.15, 0.15], { sides: 12, steps: 40, round: 1 }), color: PEARL });
  glow.push({ geometry: tube(armPts.slice(1, 5).map((p) => [p[0], p[1], p[2] - 0.19]), 0.04, { sides: 4, steps: 30, round: 0 }), color: FUTURE.glowCyan });
  body.push({ geometry: ring(1.0, 0.17, [0, 10.0, 0], 'y', 8, 40), color: PEARL });
  body.push({ geometry: lathe([[0, 9.95], [0.88, 9.95], [0.88, 10.12], [0, 10.12]], 28), color: 0x34405a });
  glow.push({ geometry: cylY(0.7, 0.7, 9.9, 9.96, 0, 0, 28), color: FUTURE.glowCyan });

  // The touch panel, tilted back toward a reader on the sidewalk.
  const tilt = new THREE.Matrix4().compose(new THREE.Vector3(0, 3.55, 1.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg(-38)), new THREE.Vector3(1, 1, 1));
  body.push({ geometry: roundedLoft([{ y: -0.8, hw: 1.2, hd: 0.14, r: 0.12, cz: -0.02 }, { y: 0.8, hw: 1.2, hd: 0.14, r: 0.12, cz: -0.02 }], 3).applyMatrix4(tilt), color: PEARL });
  signs.push({ geometry: atlasPlate(2.18, 1.46, 0.04, atlas.screen, atlas.edge).translate(0, 0, 0.13).applyMatrix4(tilt) });
  body.push({ geometry: bar([0, 3.0, 0.6], [0, 3.35, 1.35], 0.55, 0.4), color: PEARL });
  glow.push({ geometry: boxAt(2.3, 0.05, 0.05, 0, -0.82, 0.08).applyMatrix4(tilt), color: FUTURE.glowCyan });

  // THE HOLOGRAM: a lit floor, a little city of translucent blocks with glowing edges, two routes
  // and a YOU ARE HERE pin, and the faint cone of light it is projected along.
  const CYAN = new THREE.Color(0x36c8e8);
  const dim = (k) => CYAN.clone().multiplyScalar(k);
  holo.push({ geometry: lathe([[0, 4.82], [0.48, 4.82], [HK_DISC_R - 0.1, HK_DISC_Y - 0.03], [0, HK_DISC_Y - 0.03]], 32), color: dim(0.16) });
  holo.push({ geometry: cylY(HK_DISC_R, HK_DISC_R, HK_DISC_Y - 0.02, HK_DISC_Y + 0.03, 0, 0, 48), color: dim(0.35) });
  lines.push({ geometry: ring(HK_DISC_R, 0.035, [0, HK_DISC_Y + 0.03, 0], 'y', 4, 64), color: FUTURE.glowCyan });
  lines.push({ geometry: ring(HK_DISC_R - 0.35, 0.02, [0, HK_DISC_Y + 0.03, 0], 'y', 3, 56), color: tone(FUTURE.glowCyan, 0.6) });
  const cells = [-1.5, -0.55, 0.4, 1.35];
  let tallest = null;
  for (const cx of cells) {
    for (const cz of cells) {
      const x = cx + 0.08; const z = cz + 0.08;
      if (Math.hypot(x, z) > 2.05) continue;
      if (x > 0 && x < 1 && z > 0 && z < 1) continue; // a little park, left open
      const w = 0.62; const d = 0.62;
      const h = 0.35 + rng() * 1.3 + (Math.abs(x) < 1 && Math.abs(z) < 1 ? 0.6 : 0);
      const y0 = HK_DISC_Y + 0.04;
      holo.push({ geometry: boxAt(w, h, d, x, y0 + h / 2, z), color: dim(0.5) });
      const e = 0.03;
      for (const [ex, ez] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        lines.push({ geometry: boxAt(e, h, e, x + ex * w / 2, y0 + h / 2, z + ez * d / 2), color: FUTURE.glowCyan });
      }
      lines.push({ geometry: boxAt(w + e, e, e, x, y0 + h, z - d / 2), color: FUTURE.glowCyan });
      lines.push({ geometry: boxAt(w + e, e, e, x, y0 + h, z + d / 2), color: FUTURE.glowCyan });
      lines.push({ geometry: boxAt(e, e, d + e, x - w / 2, y0 + h, z), color: FUTURE.glowCyan });
      lines.push({ geometry: boxAt(e, e, d + e, x + w / 2, y0 + h, z), color: FUTURE.glowCyan });
      if (!tallest || h > tallest.h) tallest = { x, z, h };
    }
  }
  // A park: a green glowing square with three little trees.
  lines.push({ geometry: boxAt(0.62, 0.03, 0.62, 0.48, HK_DISC_Y + 0.05, 0.48), color: tone(FUTURE.glowLime, 0.7) });
  for (const [x, z] of [[0.33, 0.35], [0.62, 0.42], [0.45, 0.66]]) lines.push({ geometry: ball([x, HK_DISC_Y + 0.22, z], 0.12, 6, 4), color: FUTURE.glowLime });
  // Two routes along the streets, raised a hair off the floor.
  const ry = HK_DISC_Y + 0.07;
  const street = (pts, color) => { for (let i = 0; i < pts.length - 1; i++) lines.push({ geometry: bar([pts[i][0], ry, pts[i][1]], [pts[i + 1][0], ry, pts[i + 1][1]], 0.07, 0.04), color }); };
  street([[-2.2, -0.08], [-0.08, -0.08], [-0.08, 0.95], [0.95, 0.95], [0.95, 2.0]], FUTURE.glowPink);
  street([[-1.03, -2.0], [-1.03, 1.9]], FUTURE.glowGold);
  street([[1.9, -1.03], [0.0, -1.03]], FUTURE.glowGold);
  // YOU ARE HERE: a pin over the route's end, and a pin on the tallest tower.
  for (const [x, z, y, c] of [[0.95, 1.9, ry, FUTURE.glowPink], [tallest.x, tallest.z, HK_DISC_Y + 0.04 + tallest.h, FUTURE.glowGold]]) {
    const cone = new THREE.ConeGeometry(0.12, 0.42, 10, 1); cone.rotateX(Math.PI); cone.translate(x, y + 0.24, z);
    lines.push({ geometry: cone, color: c });
    lines.push({ geometry: ball([x, y + 0.5, z], 0.15, 10, 7), color: c });
  }

  const group = new THREE.Group();
  group.add(meshOf(body, bodyMat({ roughness: 0.35, metalness: 0.2 })));
  group.add(meshOf(glow, glowMat(), { cast: false, receive: false }));
  group.add(meshOf(signs, signMat(atlas.tex, 0.85), { cast: false }));
  const spin = new THREE.Group();
  spin.add(meshOf(lines, glowMat(), { cast: false, receive: false }));
  spin.add(meshOf(holo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }), { cast: false, receive: false }));
  spin.rotation.y = 0.5;
  group.add(spin);
  group.userData.tick = tickOf((dt) => { spin.rotation.y += dt * 0.3; });
  return group;
}

// ---------------------------------------------------------------------------------------------
// RAIN GARDEN PLAZA
// ---------------------------------------------------------------------------------------------
const RG = 20; // half size: exactly 40 x 40
const RG_GRAVEL = 0.2;
const RG_PAVER_TOP = 0.28;
const RG_WATER_TOP = 0.24;
// The rain garden and the pond, each an organic outline: d(x, z) < 1 inside, 1 on the edge.
const RG_GARDEN = { cx: -8, cz: -5, rx: 8.5, rz: 7.2, w: [0.07, 3, 0.4, 0.05, 5, 1.3] };
const RG_POND = { cx: 8.2, cz: 6.2, rx: 6.0, rz: 4.4, w: [0.06, 2, 1.1, 0.04, 4, 0.2] };
function blobD(b, x, z) {
  const dx = (x - b.cx) / b.rx; const dz = (z - b.cz) / b.rz;
  const a = Math.atan2(dz, dx);
  const k = 1 + b.w[0] * Math.sin(b.w[1] * a + b.w[2]) + b.w[3] * Math.cos(b.w[4] * a + b.w[5]);
  return Math.sqrt(dx * dx + dz * dz) / k;
}
// A point on a blob's outline at angle a (in the blob's own stretched frame), d times out.
function blobAt(b, a, d = 1) {
  const k = 1 + b.w[0] * Math.sin(b.w[1] * a + b.w[2]) + b.w[3] * Math.cos(b.w[4] * a + b.w[5]);
  return [b.cx + Math.cos(a) * b.rx * k * d, b.cz + Math.sin(a) * b.rz * k * d];
}
const sstep = (x, a, b) => { const t = clampT((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// The runnel, from an inlet at the back edge down past the garden into the pond.
const RG_RUNNEL = new THREE.CatmullRomCurve3([[5.2, 0, -20.0], [5.2, 0, -14], [3.9, 0, -7], [4.1, 0, -1.5], [5.0, 0, 1.6], [5.6, 0, 3.0]].map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
const RG_RUNNEL_PTS = RG_RUNNEL.getSpacedPoints(70);
function runnelDist(x, z) {
  let best = 1e9;
  for (const p of RG_RUNNEL_PTS) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
  return Math.sqrt(best);
}
function rgHeight(x, z) {
  let h = RG_GRAVEL;
  const dg = blobD(RG_GARDEN, x, z);
  if (dg < 1) h -= 0.34 * sstep(1 - dg, 0, 0.35);
  const dp = blobD(RG_POND, x, z);
  if (dp < 1) h -= 0.44 * sstep(1 - dp, 0, 0.3);
  return h;
}

// A closed solid swept along a path in plan: `outline` is [side, up] around the path, up being +Y.
// Each triangle is oriented by its known outward direction, so a winding cannot come out wrong.
function sweepPlan(pts, outline, closed = false) {
  const n = pts.length; const m = outline.length;
  let area = 0;
  for (let j = 0; j < m; j++) { const [a0, b0] = outline[j]; const [a1, b1] = outline[(j + 1) % m]; area += a0 * b1 - a1 * b0; }
  const ccw = area > 0;
  const Y = new THREE.Vector3(0, 1, 0);
  const rings = []; const frames = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const T = next.clone().sub(prev).setY(0).normalize();
    const S = new THREE.Vector3().crossVectors(T, Y).normalize();
    frames.push({ T, S });
    rings.push(outline.map(([a, b]) => pts[i].clone().addScaledVector(S, a).add(new THREE.Vector3(0, b, 0))));
  }
  const pos = [];
  const tri = (a, b, c, want) => {
    const nrm = b.clone().sub(a).cross(c.clone().sub(a));
    if (nrm.dot(want) < 0) pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
    else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const i2 = (i + 1) % n;
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const [s0, t0] = outline[j]; const [s1, t1] = outline[j2];
      const o = ccw ? [t1 - t0, -(s1 - s0)] : [-(t1 - t0), s1 - s0];
      const want = frames[i].S.clone().multiplyScalar(o[0]).add(new THREE.Vector3(0, o[1], 0));
      tri(rings[i][j], rings[i][j2], rings[i2][j2], want); tri(rings[i][j], rings[i2][j2], rings[i2][j], want);
    }
  }
  if (!closed) {
    const tris = THREE.ShapeUtils.triangulateShape(outline.map(([a, b]) => new THREE.Vector2(a, b)), []);
    for (const [i, sign] of [[0, -1], [n - 1, 1]]) {
      const want = frames[i].T.clone().multiplyScalar(sign);
      for (const [a, b, c] of tris) tri(rings[i][a], rings[i][b], rings[i][c], want);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const merged = mergeVerticesKeep(g);
  merged.computeVertexNormals();
  return merged;
}
// Welds a soup by position so a swept solid shades smoothly round its section.
function mergeVerticesKeep(g) {
  const P = g.attributes.position;
  const map = new Map(); const pos = []; const index = [];
  for (let i = 0; i < P.count; i++) {
    const key = `${Math.round(P.getX(i) * 1000)},${Math.round(P.getY(i) * 1000)},${Math.round(P.getZ(i) * 1000)}`;
    let k = map.get(key);
    if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(P.getX(i), P.getY(i), P.getZ(i)); }
    index.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(index);
  return out;
}

// The ground: one closed slab, its top a height field (gravel, the garden's dip, the pond's bed),
// its sides and its bottom at the foundation.
function rgGround() {
  const N = 32; const step = (2 * RG) / N;
  const pos = []; const col = []; const uv = []; const index = [];
  const gravel = new THREE.Color(0x9fb487); const mulch = new THREE.Color(0x8c6140); const bed = new THREE.Color(0x3d524c);
  const c = new THREE.Color();
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = -RG + i * step; const z = -RG + j * step;
      pos.push(x, rgHeight(x, z), z);
      const dg = blobD(RG_GARDEN, x, z); const dp = blobD(RG_POND, x, z);
      c.copy(gravel).lerp(mulch, sstep(1.02 - dg, 0, 0.08)).lerp(bed, sstep(1.0 - dp, 0, 0.1));
      col.push(c.r, c.g, c.b);
      uv.push(x / 3, z / 3);
    }
  }
  const at = (i, j) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = at(i, j); const b = at(i + 1, j); const cc = at(i + 1, j + 1); const d = at(i, j + 1);
      index.push(a, d, b, b, d, cc);
    }
  }
  // The skirt: walk the perimeter once, anticlockwise seen from above.
  const perim = [];
  for (let i = 0; i < N; i++) perim.push([i, 0]);
  for (let j = 0; j < N; j++) perim.push([N, j]);
  for (let i = N; i > 0; i--) perim.push([i, N]);
  for (let j = N; j > 0; j--) perim.push([0, j]);
  const base = pos.length / 3;
  for (const [i, j] of perim) {
    const t = at(i, j);
    pos.push(pos[t * 3], pos[t * 3 + 1], pos[t * 3 + 2]); col.push(gravel.r, gravel.g, gravel.b); uv.push(0, 0);
    pos.push(pos[t * 3], BASE, pos[t * 3 + 2]); col.push(gravel.r, gravel.g, gravel.b); uv.push(0, 0);
  }
  const P = perim.length;
  for (let k = 0; k < P; k++) {
    const k2 = (k + 1) % P;
    const t0 = base + k * 2; const b0 = t0 + 1; const t1 = base + k2 * 2; const b1 = t1 + 1;
    index.push(t0, b1, b0, t0, t1, b1);
  }
  const centre = pos.length / 3;
  pos.push(0, BASE, 0); col.push(gravel.r, gravel.g, gravel.b); uv.push(0, 0);
  for (let k = 0; k < P; k++) index.push(centre, base + k * 2 + 1, base + ((k + 1) % P) * 2 + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function plazaAtlas() {
  const W = 512; const H = 384;
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#16233a';
    ctx.fillRect(0, 0, W, H);
    // Solar cells for the flower lamps' petals.
    ctx.fillStyle = '#1d3f86';
    ctx.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 4; c++) {
        const g = ctx.createLinearGradient(c * 64, r * 32, c * 64 + 64, r * 32 + 32);
        g.addColorStop(0, '#2a59b8'); g.addColorStop(1, '#173a80');
        ctx.fillStyle = g;
        ctx.fillRect(c * 64 + 4, r * 32 + 3, 56, 26);
      }
    }
    ctx.strokeStyle = '#9fd0ff'; ctx.lineWidth = 1.5;
    for (let c = 0; c < 4; c++) { ctx.beginPath(); ctx.moveTo(c * 64 + 32, 0); ctx.lineTo(c * 64 + 32, 256); ctx.stroke(); }
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, 248, 248);
    // RAIN GARDEN, with a drop drawn as a path.
    ctx.fillStyle = '#123245';
    roundRect(ctx, 6, 270, 500, 100, 24); ctx.fill();
    ctx.strokeStyle = '#5cf2ff'; ctx.lineWidth = 5; ctx.stroke();
    ctx.save();
    ctx.translate(64, 322);
    ctx.fillStyle = '#5cf2ff'; ctx.shadowColor = '#5cf2ff'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(0, -36); ctx.bezierCurveTo(22, -8, 26, 8, 0, 30); ctx.bezierCurveTo(-26, 8, -22, -8, 0, -36); ctx.fill();
    ctx.restore();
    glowText(ctx, 'RAIN GARDEN', 290, 322, 380, 70, '#dcfbff', '#5cf2ff');
    ctx.fillStyle = '#1a2232';
    ctx.fillRect(480, 0, 32, 32);
  });
  return { tex, solar: rect(0, 0, 256, 256, W, H), sign: rect(6, 270, 500, 100, W, H), edge: rect(484, 4, 24, 24, W, H) };
}

// A curved future bench facing +Z in its own frame, seat 1.5ft up, with a glowing strip under it.
function plazaBench(body, glow, M, back) {
  const B = []; const G = [];
  const arc = [];
  for (let i = 0; i <= 14; i++) { const a = deg(-34 + (68 * i) / 14); arc.push(new THREE.Vector3(Math.sin(a) * 7, 0, Math.cos(a) * 7 - 7)); }
  // Seat, a pearl shell with a warm wooden top.
  B.push({ geometry: sweepPlan(arc, [[-0.75, 1.15], [0.75, 1.15], [0.82, 1.32], [0.75, 1.48], [-0.75, 1.48], [-0.82, 1.32]]), color: 0xd8dee6 });
  B.push({ geometry: sweepPlan(arc, [[-0.7, 1.46], [0.7, 1.46], [0.7, 1.56], [-0.7, 1.56]]), color: 0xb98454 });
  // Backrest along the outer edge.
  B.push({ geometry: sweepPlan(arc, [[-0.82, 1.4], [-0.6, 1.4], [-0.66, 3.0], [-0.92, 3.05]]), color: back });
  G.push({ geometry: sweepPlan(arc, [[-0.93, 3.0], [-0.65, 2.96], [-0.645, 3.04], [-0.93, 3.08]]), color: FUTURE.glowPink });
  for (const t of [0.18, 0.82]) {
    const p = arc[Math.round(t * 14)];
    B.push({ geometry: lathe([[0, 0.1], [0.55, 0.1], [0.42, 0.3], [0.3, 1.2], [0, 1.25]], 16).translate(p.x, 0, p.z), color: FUTURE.teal });
  }
  G.push({ geometry: sweepPlan(arc, [[-0.5, 1.1], [0.5, 1.1], [0.5, 1.16], [-0.5, 1.16]]), color: FUTURE.glowCyan });
  for (const p of B) body.push({ geometry: p.geometry.applyMatrix4(M), color: p.color });
  for (const p of G) glow.push({ geometry: p.geometry.applyMatrix4(M), color: p.color });
}

// A solar-flower lamp: a curving stem, six solar petals tilted to the sky, a glowing heart.
function flowerLamp(body, glow, signs, atlas, x, z, seed, petalColor) {
  const rng = seededRandom(seed);
  const H = 9.0 + rng() * 1.2;
  const lean = rng() * TAU;
  const top = [x + Math.cos(lean) * 0.6, H, z + Math.sin(lean) * 0.6];
  body.push({ geometry: lathe([[0, 0.12], [0.9, 0.12], [0.9, 0.32], [0.9, 0.32], [0.55, 0.45], [0, 0.48]], 20).translate(x, 0, z), color: 0xc4ccd6 });
  glow.push({ geometry: ring(0.9, 0.05, [x, 0.25, z], 'y', 4, 24), color: FUTURE.glowLime });
  body.push({ geometry: tube([[x, 0.3, z], [x, H * 0.45, z], [x + Math.cos(lean) * 0.4, H * 0.85, z + Math.sin(lean) * 0.4], top], [0.2, 0.16, 0.13, 0.12], { sides: 8, steps: 12, round: 0 }), color: FUTURE.teal });
  // A leaf on the stem.
  const la = lean + 2.2;
  body.push({ geometry: ball([x + Math.cos(la) * 0.8, H * 0.4, z + Math.sin(la) * 0.8], 1, 10, 6), color: FUTURE.lime, scale: [0.9, 0.12, 0.35], rotation: [0, -la, 0.5], about: [x + Math.cos(la) * 0.8, H * 0.4, z + Math.sin(la) * 0.8] });
  // The flower head.
  body.push({ geometry: lathe([[0, -0.5], [0.45, -0.45], [0.7, -0.1], [0.7, 0.05], [0, 0.1]], 18).translate(...top), color: petalColor });
  glow.push({ geometry: ball([top[0], top[1] + 0.12, top[2]], 0.48, 12, 7), color: FUTURE.glowGold });
  glow.push({ geometry: ring(0.55, 0.06, [top[0], top[1] - 0.25, top[2]], 'y', 5, 24), color: FUTURE.glowGold });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + rng() * 0.2;
    const M = new THREE.Matrix4().compose(new THREE.Vector3(...top), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), new THREE.Vector3(1, 1, 1));
    const tilt = new THREE.Matrix4().makeRotationX(deg(22));
    const plate = atlasPlate(0.95, 1.7, 0.05, atlas.solar, atlas.edge);
    plate.rotateX(-Math.PI / 2); plate.translate(0, 0.04, -1.45);
    plate.applyMatrix4(tilt).applyMatrix4(M);
    signs.push({ geometry: plate });
    const rim = boxAt(1.05, 0.06, 1.8, 0, -0.02, -1.45);
    rim.applyMatrix4(tilt).applyMatrix4(M);
    body.push({ geometry: rim, color: petalColor });
  }
}

function rainGardenPlaza() {
  const body = []; const plants = []; const water = []; const glow = []; const signs = [];
  const atlas = plazaAtlas();
  const rng = seededRandom(8822);

  body.push({ geometry: rgGround(), keepColor: true });

  // PERMEABLE PAVERS: 1.75ft slabs on a 2ft pitch, so the mossy gravel shows in every joint.
  const tints = [0xd8c8a6, 0xd6a89b, 0xc8ced6, 0xaec4a2, 0xe0c27e];
  const clearOf = (x, z) => blobD(RG_GARDEN, x, z) > 1.1 && blobD(RG_POND, x, z) > 1.12 && runnelDist(x, z) > 0.85
    && !(x > -6 && x < 0 && z > 17);
  let lit = 0;
  const paver = (cx, cz, size, pick) => {
    const g = new THREE.BoxGeometry(size, RG_PAVER_TOP - 0.12, size);
    g.translate(cx, (RG_PAVER_TOP + 0.12) / 2, cz);
    body.push({ geometry: feetUV(g, 3), color: tone(pick, 0.93 + rng() * 0.12) });
  };
  const fits = (cx, cz, h) => [[-h, -h], [h, -h], [h, h], [-h, h], [0, 0]].every(([dx, dz]) => clearOf(cx + dx, cz + dz));
  for (let gx = -RG + 1; gx < RG; gx += 2) {
    for (let gz = -RG + 1; gz < RG; gz += 2) {
      const wave = Math.sin(gx * 0.31 + gz * 0.22) + Math.cos(gz * 0.27 - gx * 0.12);
      const pick = tints[Math.abs(Math.floor(wave * 1.6 + 7)) % tints.length];
      if (!fits(gx, gz, 0.875)) {
        // Near a curve the big slab will not fit, so smaller ones fill in round it.
        for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
          if (fits(gx + dx, gz + dz, 0.4)) paver(gx + dx, gz + dz, 0.8, pick);
        }
        continue;
      }
      paver(gx, gz, 1.75, pick);
      // A few pavers carry a glowing rain-sensor dot.
      if ((gx * 7 + gz * 13 + 400) % 23 === 0 && lit < 9) {
        lit += 1;
        glow.push({ geometry: cylY(0.22, 0.22, RG_PAVER_TOP - 0.01, RG_PAVER_TOP + 0.015, gx, gz, 10), color: FUTURE.glowCyan });
      }
    }
  }

  // The rain garden's kerb: a smooth pearl ring with a glowing inset, just below the paving's top.
  const gOut = []; for (let i = 0; i < 76; i++) { const [x, z] = blobAt(RG_GARDEN, (i / 76) * TAU, 1.04); gOut.push(new THREE.Vector3(x, 0, z)); }
  body.push({ geometry: sweepPlan(gOut, [[-0.32, 0.0], [0.32, 0.0], [0.32, 0.25], [0.26, 0.3], [-0.26, 0.3], [-0.32, 0.25]], true), color: 0xd2d8de });
  glow.push({ geometry: sweepPlan(gOut, [[-0.07, 0.25], [0.07, 0.25], [0.07, 0.305], [-0.07, 0.305]], true), color: FUTURE.glowCyan });

  // THE POND: water a flat slab, cobbles round its rim, stepping stones across it.
  const pOut = []; for (let i = 0; i < 64; i++) { const [x, z] = blobAt(RG_POND, (i / 64) * TAU, 0.97); pOut.push(new THREE.Vector2(x, -z)); }
  const pShape = new THREE.Shape(pOut);
  const pondG = new THREE.ExtrudeGeometry(pShape, { depth: RG_WATER_TOP + 0.04, bevelEnabled: false, curveSegments: 4 });
  pondG.rotateX(-Math.PI / 2); pondG.translate(0, -0.04, 0);
  water.push({ geometry: pondG, color: 0x2f9cc0 });
  const perim = 2 * Math.PI * Math.sqrt((RG_POND.rx ** 2 + RG_POND.rz ** 2) / 2);
  const nCob = Math.round(perim / 0.82);
  for (let i = 0; i < nCob; i++) {
    const [x, z] = blobAt(RG_POND, (i / nCob) * TAU + rng() * 0.03, 1.02);
    const r = 0.42 + rng() * 0.12;
    body.push({ geometry: ball([x, 0.07, z], 1, 6, 4), color: tone([0x9a9488, 0xa8a196, 0x8c877c][i % 3], 0.95 + rng() * 0.1), scale: [r, 0.23 / 1, r * 0.9], rotation: [0, rng() * 3, 0], about: [x, 0.07, z] });
  }
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.5) / 5;
    const x = mix(3.4, 13.2, t) + (rng() - 0.5) * 0.5; const z = mix(8.9, 3.4, t) + (k % 2 ? 0.4 : -0.4);
    body.push({ geometry: lathe([[0, -0.05], [0.95, -0.05], [1.0, 0.2], [0.85, 0.3], [0, 0.3]], 14).translate(x, 0, z), color: tone(0xb7b0a2, 0.9 + rng() * 0.15), scale: [1, 1, 0.82], about: [x, 0, z] });
  }
  // Lily pads and one pink flower.
  for (const [x, z, r] of [[11.6, 8.4, 0.75], [12.4, 7.4, 0.55], [5.4, 4.4, 0.65], [10.0, 9.4, 0.5]]) {
    const pad = lathe([[0, RG_WATER_TOP - 0.01], [r, RG_WATER_TOP - 0.01], [r, RG_WATER_TOP + 0.03], [0, RG_WATER_TOP + 0.03]], 16);
    plants.push({ geometry: pad.translate(x, 0, z), color: 0x3f9a4a });
  }
  plants.push({ geometry: ball([11.6, RG_WATER_TOP + 0.2, 8.4], 0.26, 8, 6), color: FUTURE.glowPink });

  // THE RUNNEL: two stone kerbs and a ribbon of water between them, LED dots along both sides.
  const rPts = RG_RUNNEL.getSpacedPoints(48);
  for (const s of [-1, 1]) {
    body.push({ geometry: sweepPlan(rPts, [[s * 0.42, 0.08], [s * 0.7, 0.08], [s * 0.7, 0.3], [s * 0.42, 0.3]]), color: 0xbfc5cc });
  }
  water.push({ geometry: sweepPlan(rPts.slice(0, 46), [[-0.44, 0.1], [0.44, 0.1], [0.44, 0.23], [-0.44, 0.23]]), color: 0x3aa8cc });
  for (let i = 2; i < 46; i += 4) {
    const p = rPts[i]; const q = rPts[i + 1];
    const side = new THREE.Vector3(q.z - p.z, 0, -(q.x - p.x)).normalize();
    for (const s of [-1, 1]) glow.push({ geometry: ball([p.x + side.x * s * 0.56, 0.31, p.z + side.z * s * 0.56], 0.06, 6, 3), color: FUTURE.glowCyan });
  }
  // The inlet at the back edge, where water off the street comes in.
  body.push({ geometry: roundedLoft([{ y: BASE, hw: 1.2, hd: 0.55, r: 0.2, cx: 5.2, cz: -19.4 }, { y: 0.55, hw: 1.2, hd: 0.55, r: 0.2, cx: 5.2, cz: -19.4 }], 2), color: 0x9aa3ad });
  body.push({ geometry: boxAt(1.0, 0.2, 0.12, 5.2, 0.3, -18.86), color: 0x2a3446 });

  // THE RAIN GARDEN: reeds, flowers, low shrubs and one small tree, down in the dip.
  const reedClump = (x, z, n, hgt) => {
    for (let k = 0; k < n; k++) {
      const a = rng() * TAU; const r = rng() * 0.5;
      const bx = x + Math.cos(a) * r; const bz = z + Math.sin(a) * r;
      const h = hgt * (0.7 + rng() * 0.4);
      const lean = [(rng() - 0.5) * 0.5, (rng() - 0.5) * 0.5];
      const by = rgHeight(bx, bz) - 0.02;
      plants.push({ geometry: tube([[bx, by, bz], [bx + lean[0] * 0.4, by + h * 0.5, bz + lean[1] * 0.4], [bx + lean[0], by + h, bz + lean[1]]], [0.07, 0.05, 0], { sides: 3, steps: 3, round: 0 }), color: tone(k % 3 ? 0x5f9a3c : 0x86a843, 0.9 + rng() * 0.2) });
      if (k % 4 === 0) {
        const top = [bx + lean[0] * 0.8, by + h * 0.82, bz + lean[1] * 0.8];
        plants.push({ geometry: cylY(0.1, 0.1, top[1] - 0.35, top[1] + 0.35, top[0], top[2], 6), color: 0x7a4e2c });
      }
    }
  };
  const flower = (x, z, color, hgt) => {
    const by = rgHeight(x, z) - 0.04;
    const h = hgt * (0.8 + rng() * 0.4);
    plants.push({ geometry: rod([x, by, z], [x + (rng() - 0.5) * 0.3, by + h, z + (rng() - 0.5) * 0.3], 0.04, 3), color: 0x4f8c37 });
    const head = [x, by + h, z];
    plants.push({ geometry: ball(head, 0.42, 6, 3), color, scale: [1, 0.5, 1], about: head });
  };
  const fColors = [FUTURE.magenta, FUTURE.violet, FUTURE.sun, FUTURE.coral, 0xf3f0f7, 0xe86fd0];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + rng() * 0.3;
    const [x, z] = blobAt(RG_GARDEN, a, 0.55 + rng() * 0.25);
    reedClump(x, z, 7, 3.4 + rng() * 1.2);
  }
  for (let k = 0; k < 54; k++) {
    const a = rng() * TAU;
    const [x, z] = blobAt(RG_GARDEN, a, 0.2 + Math.sqrt(rng()) * 0.68);
    flower(x, z, fColors[k % fColors.length], 1.5 + rng() * 1.3);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.5;
    const [x, z] = blobAt(RG_GARDEN, a, 0.82);
    const R = 0.9 + rng() * 0.4;
    plants.push({ geometry: blob([x, rgHeight(x, z) + R * 0.78 - 0.15, z], R, 0.75, 1, rng, k % 2 ? 0x4c9a45 : 0x5fae4a), keepColor: true });
  }
  // Low ground cover between the plants, so the dip reads as planted rather than as bare mulch.
  for (let k = 0; k < 12; k++) {
    const a = rng() * TAU;
    const [x, z] = blobAt(RG_GARDEN, a, 0.15 + rng() * 0.6);
    const R = 1.1 + rng() * 0.5;
    plants.push({ geometry: blob([x, rgHeight(x, z) + R * 0.3 - 0.12, z], R, 0.32, 1, rng, [0x5a9e3e, 0x6fb04a, 0x4d8f3a][k % 3]), keepColor: true });
  }
  // A small serviceberry in the garden's middle.
  const tx = RG_GARDEN.cx - 1.2; const tz = RG_GARDEN.cz - 0.8;
  const ty = rgHeight(tx, tz) - 0.04;
  plants.push({ geometry: tube([[tx, ty, tz], [tx + 0.2, ty + 4, tz], [tx - 0.1, ty + 7.2, tz + 0.2]], [0.3, 0.22, 0.16], { sides: 8, steps: 6, round: 0 }), color: 0x6b4c34 });
  plants.push({ geometry: blob([tx, ty + 9.4, tz + 0.2], 3.2, 0.78, 2, rng, 0x4f9e44), keepColor: true });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    plants.push({ geometry: blob([tx + Math.cos(a) * 2.2, ty + 8.4 + rng(), tz + Math.sin(a) * 2.2], 1.7, 0.8, 1, rng, k % 2 ? 0x5aa84a : 0x6fbb50), keepColor: true });
  }

  // Two benches facing the water, three solar-flower lamps, and the sign at the front.
  const face = (x, z, tx2, tz2) => new THREE.Matrix4().compose(new THREE.Vector3(x, RG_PAVER_TOP - 0.18, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(tx2 - x, tz2 - z)), new THREE.Vector3(1, 1, 1));
  plazaBench(body, glow, face(-1.4, 7.4, 8, 6.6), FUTURE.coral);
  plazaBench(body, glow, face(16.0, -6.5, 9, 3), FUTURE.sky);
  flowerLamp(body, glow, signs, atlas, -15.5, 15.5, 31, FUTURE.magenta);
  flowerLamp(body, glow, signs, atlas, 16.5, 15.8, 32, FUTURE.sun);
  flowerLamp(body, glow, signs, atlas, -1.8, -14.5, 33, FUTURE.violet);
  // RAIN GARDEN sign, on a low stand by the front edge.
  const sx = -3; const sz = 18.6;
  body.push({ geometry: roundedLoft([{ y: 0.1, hw: 2.45, hd: 0.2, r: 0.15, cx: sx, cz: sz }, { y: 1.9, hw: 2.45, hd: 0.2, r: 0.15, cx: sx, cz: sz }], 3), color: 0xd2d8de });
  signs.push({ geometry: atlasPlate(4.6, 0.95, 0.05, atlas.sign, atlas.edge).translate(sx, 1.3, sz + 0.22) });
  glow.push({ geometry: boxAt(4.6, 0.06, 0.06, sx, 0.55, sz + 0.22), color: FUTURE.glowCyan });

  const group = new THREE.Group();
  const speck = speckleTexture(7712);
  group.add(meshOf(body, bodyMat({ roughness: 0.75, metalness: 0.05, map: speck })));
  group.add(meshOf(plants, bodyMat({ roughness: 0.7, metalness: 0 })));
  group.add(meshOf(water, bodyMat({ roughness: 0.08, metalness: 0.1 }), { cast: false }));
  group.add(meshOf(glow, glowMat(), { cast: false, receive: false }));
  group.add(meshOf(signs, signMat(atlas.tex, 0.55), { cast: false }));
  return group;
}

// Speckle: concrete aggregate and grit, near white, multiplied by each part's colour.
function speckleTexture(seed, size = 256) {
  const rng = seededRandom(seed);
  const t = canvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#f1efe9';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * w; const y = rng() * h; const r = 0.6 + rng() * 1.4;
      ctx.fillStyle = rng() < 0.6 ? `rgba(80,76,70,${0.12 + rng() * 0.3})` : `rgba(255,255,255,${0.3 + rng() * 0.4})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const BUILDERS = {
  'drone-port': dronePort,
  'wind-tree': windTree,
  'air-cleaning-tower': airCleaningTower,
  'hologram-kiosk': hologramKiosk,
  'rain-garden-plaza': rainGardenPlaza,
};
