// spaceport-pad: a round pad 60ft across and 3ft high, with a flame trench cut through it toward the
// street, a lattice launch tower with a crew-access arm reaching to the capsule, and a reusable rocket
// about 90ft tall standing on four landing legs.
//
// The rocket is an inner group flown by root.userData.tick. When its program has set `height` to a
// positive number (the starter program sets 60), it waits, the crew arm swings clear, it climbs that
// many feet on a glowing plume, hovers, comes back down and lands on its legs, rests, and does it
// again. With no program it stands on the pad. Under reduced motion it stays on the pad.

import * as THREE from 'three';
import { FUTURE } from './TownKit.js';
import { reducedMotion } from '../../Settings.js';
import { FKit, latheG, ballG, polarG, extrudeG, glassTint } from './FutureCivicKit.js';

const DEG = Math.PI / 180;
const PAD_R = 30; const PAD_TOP = 3.0;
const TRENCH_W = 4.5; const TRENCH_BACK = -4; const TRENCH_FLOOR = 0.2;
const TOWER_X = -16; const TOWER_HALF = 3.5; const TOWER_TOP = 88;
const RB = 4.2; // rocket body radius
const ENGINE_EXIT = PAD_TOP + 1.4;
const HATCH_Y = 73.2; const ARM_Y0 = 72.6; const ARM_Y1 = 78.6;
const LEG_R = 10.2;
const WHITE = FUTURE.white; const VIOLET = 0x7a52e0; const AQUA = 0x45c8e8; const CORAL = 0xff7a59; const DARK = 0x4a5570;

// The rocket's outline from the engines up, with a duplicated row at every paint line so each band
// has a sharp edge.
const BANDS = [
  [9.5, 11.2, VIOLET], [11.2, 12.0, AQUA], [44, 46, AQUA], [46, 49.5, VIOLET],
  [66.5, 67.4, CORAL], [83.5, 99, CORAL],
];
function rocketProfile() {
  const p = [[0, ENGINE_EXIT + 2.0], [3.9, ENGINE_EXIT + 2.0], [RB, ENGINE_EXIT + 2.5]];
  const ys = new Set();
  for (const [a, b] of BANDS) { ys.add(a); ys.add(b); }
  const cuts = [...ys].filter((y) => y < 78).sort((a, b) => a - b);
  for (const y of cuts) { p.push([RB, y - 0.02]); p.push([RB, y + 0.02]); }
  p.push([RB, 78], [3.95, 80], [3.1, 83.48], [3.1, 83.52], [2.1, 86.5], [1.1, 89.2], [0.45, 91], [0, 92]);
  return p;
}
function bandColor(y) {
  for (const [a, b, c] of BANDS) if (y >= a && y <= b) return c;
  return WHITE;
}

export function spaceportBuild() {
  const K = new FKit({ seed: 977, atlasW: 1024, atlasH: 512 });

  // --- the pad: a disc with a slot for the trench, so the trench is a real channel ------------
  const zc = Math.sqrt(PAD_R * PAD_R - TRENCH_W * TRENCH_W);
  const a0 = Math.atan2(TRENCH_W, zc);
  const plan = [];
  for (let i = 0; i <= 96; i++) {
    const a = a0 + (i / 96) * (Math.PI * 2 - a0 * 2);
    plan.push([PAD_R * Math.sin(a), PAD_R * Math.cos(a)]);
  }
  plan.push([-TRENCH_W, TRENCH_BACK], [TRENCH_W, TRENCH_BACK]);
  // shape points are (x, -z); extruded along local z, then laid down so local z is up
  const pad = extrudeG(plan.map(([x, z]) => [x, -z]), -0.4, PAD_TOP, { curve: 1 }).rotateX(-Math.PI / 2);
  K.add('body', pad, 0xb3b8c4, { tint: (x, y, z, out, nx, ny, nz) => {
    // the trench's walls are scorched dark
    if (Math.abs(ny) < 0.5 && Math.abs(x) < TRENCH_W + 0.05 && z > TRENCH_BACK - 0.05) {
      const k = 0.42 + 0.25 * Math.min(1, Math.max(0, (z - 4) / 26)); out[0] *= k; out[1] *= k * 0.96; out[2] *= k * 0.94;
    }
  } });
  // a coloured band round the pad's side
  K.polar('body', VIOLET, PAD_R, PAD_R + 0.15, 0.9, 1.9, a0 + 0.004, Math.PI * 2 - a0 - 0.004, { segs: 90 });
  K.glowPolar('pink', PAD_R, PAD_R + 0.17, 2.3, 2.55, a0 + 0.004, Math.PI * 2 - a0 - 0.004, { segs: 90 });
  // the trench: its floor, and the flame deflector that turns the exhaust toward the street
  K.box('body', 0x5b5e66, -TRENCH_W, TRENCH_W, -0.4, TRENCH_FLOOR, TRENCH_BACK, zc + 0.3);
  K.add('body', extrudeG([[TRENCH_BACK, PAD_TOP - 0.05], [TRENCH_BACK, TRENCH_FLOOR], [7, TRENCH_FLOOR]].map(([z, y]) => [-z, y]), -TRENCH_W, TRENCH_W, { curve: 1 }).rotateY(Math.PI / 2), 0x8a7e76, {
    tint: (x, y, z, out) => { const k = Math.max(0, 1 - Math.abs(z - 1) / 5); out[0] += k * 0.18; out[1] += k * 0.05; },
  });
  for (const s of [-1, 1]) K.glowBox('orange', s * TRENCH_W - 0.1, s * TRENCH_W + 0.1, TRENCH_FLOOR + 0.6, TRENCH_FLOOR + 0.85, 6, zc);
  // on top: hazard tiles round the rim, a landing target, glowing rings
  for (let i = 0; i < 44; i++) {
    const t0 = a0 + 0.03 + (i / 44) * (Math.PI * 2 - a0 * 2 - 0.06); const t1 = t0 + (Math.PI * 2 - a0 * 2 - 0.06) / 44 * 0.55;
    K.polar('body', i % 2 ? 0x3a3f4c : 0xffc23d, PAD_R - 2.4, PAD_R - 0.6, PAD_TOP, PAD_TOP + 0.04, t0, t1, { segs: 1 });
  }
  const ringGap = (r) => Math.asin(Math.min(1, (TRENCH_W + 0.3) / r));
  for (const [r, w, name] of [[LEG_R + 1.6, 0.35, 'cyan'], [17.5, 0.3, 'pink'], [21, 0.25, 'violet']]) {
    const g = ringGap(r);
    K.glowPolar(name, r - w / 2, r + w / 2, PAD_TOP, PAD_TOP + 0.05, g, Math.PI * 2 - g, { segs: 72 });
  }
  for (let k = 0; k < 4; k++) {
    // four big landing-leg targets: a circle for each foot
    const a = (45 + k * 90) * DEG;
    const x = LEG_R * Math.sin(a); const z = LEG_R * Math.cos(a);
    K.glow('yellow', polarG(1.5, 1.85, PAD_TOP, PAD_TOP + 0.06, 0, Math.PI * 2, { segs: 28 }).translate(x, 0, z));
    K.add('body', new THREE.CylinderGeometry(1.5, 1.5, 0.04, 28).translate(x, PAD_TOP + 0.02, z), 0x8c93a3);
  }
  // the parts of the landing rings over the trench are gone; mark its edges with lights instead
  for (let z = TRENCH_BACK + 1; z < zc; z += 4) for (const s of [-1, 1]) K.glow('orange', ballG(s * (TRENCH_W + 0.45), PAD_TOP + 0.1, z, 0.25, { w: 8, h: 5, sy: 0.5 }));

  // --- the launch tower ---------------------------------------------------------------------
  const tx = TOWER_X; const h = TOWER_HALF; const yb = PAD_TOP;
  const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [cx, cz] of corners) K.box('body', VIOLET, tx + cx - 0.35, tx + cx + 0.35, yb, TOWER_TOP, cz - 0.35, cz + 0.35);
  const step = 6;
  for (let y = yb + step; y <= TOWER_TOP - 2; y += step) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]; const [bx, bz] = corners[(i + 1) % 4];
      K.rod('body', 0xd9dcf0, [tx + ax, y, az], [tx + bx, y, bz], 0.17, { sides: 6 });
      K.rod('body', 0xd9dcf0, [tx + ax, y - step, az], [tx + bx, y, bz], 0.12, { sides: 5 });
    }
  }
  // a glowing line up each front column, and the lift car partway up
  for (const cx of [-h, h]) K.glowBox('cyan', tx + cx - 0.08, tx + cx + 0.08, yb + 1, TOWER_TOP - 1, h + 0.35, h + 0.45);
  K.box('body', 0xdfe4ea, tx - 1.6, tx + 1.6, 38, 45, -1.6, 1.6);
  K.glowBox('warm', tx - 1.2, tx + 1.2, 40, 43.6, 1.6, 1.68);
  // the base, and a room at the top with the sign round it
  K.box('body', 0x8c93a3, tx - h - 1, tx + h + 1, yb, yb + 1.2, -h - 1, h + 1);
  K.box('body', WHITE, tx - h - 0.6, tx + h + 0.6, TOWER_TOP, TOWER_TOP + 4.6, -h - 0.6, h + 0.6);
  const sign = K.textRect('SPACEPORT', 7.6, 2.0, { bg: '#1b1150', fg: '#ffffff', glowText: '#5cf2ff', size: 0.7 });
  K.screen(sign, tx, TOWER_TOP + 2.3, 7.4, 2.4, h + 0.6, h + 0.72);
  const m = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(tx + h + 0.6, 0, 0);
  K.within(m, () => K.screen(sign, 0, TOWER_TOP + 2.3, 7.4, 2.4, 0, 0.12));
  K.glowBox('pink', tx - h - 0.7, tx + h + 0.7, TOWER_TOP + 4.6, TOWER_TOP + 4.9, -h - 0.7, h + 0.7);
  K.rod('body', 0xdfe4ea, [tx, TOWER_TOP + 4.9, 0], [tx, TOWER_TOP + 12, 0], 0.18, { r2: 0.06, sides: 8 });
  K.glow('red', ballG(tx, TOWER_TOP + 12.2, 0, 0.38, { w: 10, h: 6 }));
  // the hinge post the crew arm turns on
  K.box('body', 0x8c93a3, tx + h + 0.3, tx + h + 1.2, ARM_Y0 - 1.2, ARM_Y1 + 1.2, -1.2, 1.2);

  const { group } = K.finish();

  // --- the crew-access arm: a walkway to the capsule hatch, turning on a post at the tower ---
  const hingeX = tx + h + 0.75;
  const A = new FKit({ seed: 978, atlasW: 64, atlasH: 32 });
  const reach = -RB - 0.25 - hingeX; // from the hinge to the capsule
  A.box('paint', WHITE, 0.4, reach - 2.4, ARM_Y0, ARM_Y0 + 0.5, -2.0, 2.0);
  A.box('paint', WHITE, 0.4, reach - 2.4, ARM_Y1 - 0.4, ARM_Y1, -2.0, 2.0);
  for (const s of [-1, 1]) {
    A.box('paint', 0xdfe4ea, 0.4, reach - 2.4, ARM_Y0 + 0.5, ARM_Y1 - 0.4, s * 2.0 - 0.15, s * 2.0 + 0.15);
    A.box('paint', 0x26394a, 0.8, reach - 2.8, ARM_Y0 + 2.4, ARM_Y1 - 1.2, s * 2.05 - 0.05, s * 2.05 + 0.05, { tint: glassTint(ARM_Y0 + 2.4, ARM_Y1 - 1.2, 0x23405a, 0x5a8fb5) });
    A.box('paint', AQUA, 0.4, reach - 2.4, ARM_Y0 + 0.5, ARM_Y0 + 1.0, s * 2.1 - 0.06, s * 2.1 + 0.06);
  }
  // the white room at its end, which seals round the hatch
  A.box('paint', 0xf1f4f8, reach - 2.4, reach, ARM_Y0 - 0.4, ARM_Y1 + 0.4, -2.4, 2.4);
  A.box('paint', VIOLET, reach - 2.5, reach - 2.35, ARM_Y0 - 0.45, ARM_Y1 + 0.45, -2.45, 2.45);
  A.box('paint', 0x6f7b93, -0.6, 0.9, ARM_Y0 - 0.6, ARM_Y1 + 0.6, -1.0, 1.0);
  const armBits = A.finish().group;
  const arm = new THREE.Group();
  arm.position.set(hingeX, 0, 0);
  for (const c of [...armBits.children]) arm.add(c);
  group.add(arm);

  // --- the rocket --------------------------------------------------------------------------------
  const R = new FKit({ seed: 979, atlasW: 512, atlasH: 700 });
  R.add('paint', latheG(rocketProfile(), 36), WHITE, { tint: (x, y, z, out) => { const c = new THREE.Color(bandColor(y)); out[0] = c.r; out[1] = c.g; out[2] = c.b; } });
  // engines: five bells under a heat shield
  R.add('paint', latheG([[0, ENGINE_EXIT + 1.6], [3.7, ENGINE_EXIT + 1.6], [3.9, ENGINE_EXIT + 2.05], [0, ENGINE_EXIT + 2.05]], 28), DARK);
  for (const [ex, ez] of [[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]]) {
    R.add('paint', latheG([[0, ENGINE_EXIT], [1.0, ENGINE_EXIT], [0.92, ENGINE_EXIT + 0.4], [0.5, ENGINE_EXIT + 1.35], [0.55, ENGINE_EXIT + 1.7], [0, ENGINE_EXIT + 1.7]], 14).translate(ex, 0, ez), 0x6b7080);
    R.glow('orange', new THREE.CylinderGeometry(0.78, 0.78, 0.06, 14).translate(ex, ENGINE_EXIT + 0.08, ez));
  }
  // four landing legs: a strut, a brace and a foot on each, the feet standing on the pad
  for (let k = 0; k < 4; k++) {
    const a = (45 + k * 90) * DEG; const sx = Math.sin(a); const sz = Math.cos(a);
    const foot = [LEG_R * sx, PAD_TOP + 0.4, LEG_R * sz];
    const top = [(RB - 0.15) * sx, 24, (RB - 0.15) * sz];
    const low = [(RB - 0.15) * sx, 9.5, (RB - 0.15) * sz];
    R.rod('paint', DARK, top, foot, 0.42, { r2: 0.32, sides: 10 });
    R.rod('paint', 0x8c93a3, low, [foot[0] * 0.82, PAD_TOP + 2.0, foot[2] * 0.82], 0.3, { sides: 8 });
    R.ball('paint', DARK, ...top, 0.55, { w: 10, h: 7 });
    R.add('paint', latheG([[0, PAD_TOP], [1.25, PAD_TOP], [1.25, PAD_TOP + 0.2], [0.7, PAD_TOP + 0.55], [0, PAD_TOP + 0.6]], 16).translate(foot[0], 0, foot[2]), 0x3a3f4c);
    // a fold-out fin near the top of the booster: a grid fin
    const gy = 64;
    const gm = new THREE.Matrix4().makeRotationY(a).setPosition(sx * (RB + 0.9), gy, sz * (RB + 0.9));
    R.within(gm, () => {
      R.box('paint', 0x6b7080, -1.0, 1.0, -0.9, 0.9, -0.9, 0.9);
      R.box('paint', 0x9aa0ae, -1.05, 1.05, -0.95, 0.95, -0.95, -0.75);
    });
  }
  // the capsule: lit windows and a hatch facing the tower
  for (let k = 0; k < 6; k++) {
    const a = (k - 2.5) * 0.4;
    const gm = new THREE.Matrix4().makeRotationY(a).setPosition(RB * Math.sin(a), 75.6, RB * Math.cos(a));
    R.within(gm, () => R.glow('warm', ballG(0, 0, 0, 0.55, { sx: 1, sy: 1.3, sz: 0.35, w: 12, h: 8 })));
  }
  {
    const gm = new THREE.Matrix4().makeRotationY(-Math.PI / 2).setPosition(-RB, HATCH_Y + 1.8, 0);
    R.within(gm, () => {
      R.box('paint', 0x5a6488, -1.2, 1.2, -1.9, 1.9, -0.25, 0.08);
      R.glowBox('cyan', -1.35, 1.35, 2.0, 2.15, -0.2, 0.1);
    });
  }
  // a name down the side, in light
  const name = R.rect(96, 640, (c, x, y, w, h) => {
    c.fillStyle = '#1b1150'; c.fillRect(x, y, w, h);
    c.save(); c.translate(x + w / 2, y + h / 2); c.rotate(-Math.PI / 2);
    const fam = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
    let px = Math.floor(w * 0.72);
    c.font = `bold ${px}px ${fam}`;
    const word = 'NOVA 7';
    if (c.measureText(word).width > h * 0.84) { px = Math.floor(px * h * 0.84 / c.measureText(word).width); c.font = `bold ${px}px ${fam}`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#5cf2ff'; c.shadowBlur = 10;
    c.fillStyle = '#c9fbff'; c.fillText(word, 0, w * 0.04);
    c.restore();
  });
  R.polarScreen(name, RB - 0.02, RB + 0.06, 24, 40, 0, 2.3 / RB, { segs: 6 });
  const rocketBits = R.finish().group;
  const rocket = new THREE.Group();
  rocket.name = 'rocket';
  for (const c of [...rocketBits.children]) rocket.add(c);

  // --- the plume: a cone of light hanging from the engines, shown only in flight ---------------
  const plumeG = latheG([[0, -16], [0.7, -13], [1.8, -8], [2.7, -3], [2.5, -0.6], [0, 0]], 24);
  {
    const P = plumeG.attributes.position;
    const col = new Float32Array(P.count * 3);
    const hot = new THREE.Color(0xfff0a8); const mid = new THREE.Color(0xff9a2e); const tail = new THREE.Color(0xff3f86);
    const c = new THREE.Color();
    for (let i = 0; i < P.count; i++) {
      const t = -P.getY(i) / 16;
      if (t < 0.35) c.copy(hot).lerp(mid, t / 0.35); else c.copy(mid).lerp(tail, (t - 0.35) / 0.65);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    plumeG.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const plumeMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.86, depthWrite: false });
  const plume = new THREE.Mesh(plumeG, plumeMat);
  plume.castShadow = false; plume.receiveShadow = false;
  plume.position.set(0, ENGINE_EXIT, 0);
  plume.visible = false;
  rocket.add(plume);
  group.add(rocket);

  // --- the flight --------------------------------------------------------------------------------
  const WAIT = 2; const UP = 4; const HOVER = 1; const DOWN = 4; const REST = 3;
  const CYCLE = WAIT + UP + HOVER + DOWN + REST;
  const ease = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
  let t = 0; let running = false; let height = 0; let clock = 0;
  // At rest the plume is folded flat into the engine bells as well as hidden, so it never reaches
  // below the pad: the model's lowest point stays the foundation.
  const rest = () => { rocket.position.y = 0; plume.visible = false; plume.scale.set(1, 0.001, 1); arm.rotation.y = 0; };
  rest();
  group.userData.tick = {
    update(dt) {
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      clock += step;
      const raw = Number(group.userData.programVars?.get?.('height'));
      const wanted = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1000) : 0;
      if (reducedMotion()) { running = false; t = 0; rest(); return; }
      if (!running) {
        if (!wanted) { rest(); return; }
        running = true; t = 0; height = wanted;
      }
      t += step;
      if (t >= CYCLE) {
        // a cycle has ended on the pad: start another only if the program still wants one
        t -= CYCLE;
        if (!wanted) { running = false; t = 0; rest(); return; }
      }
      if (t < WAIT) height = wanted || height; // a new height is taken while the rocket sits on the pad
      let y = 0;
      if (t < WAIT) y = 0;
      else if (t < WAIT + UP) y = height * ease((t - WAIT) / UP);
      else if (t < WAIT + UP + HOVER) y = height;
      else if (t < WAIT + UP + HOVER + DOWN) y = height * (1 - ease((t - WAIT - UP - HOVER) / DOWN));
      rocket.position.y = y;
      const flying = t >= WAIT - 0.25 && t < WAIT + UP + HOVER + DOWN;
      plume.visible = flying;
      if (!flying) plume.scale.set(1, 0.001, 1);
      if (flying) {
        const L = Math.min(22, Math.max(3.5, y + ENGINE_EXIT - TRENCH_FLOOR));
        const flick = 1 + 0.06 * Math.sin(clock * 37) + 0.04 * Math.sin(clock * 23.3);
        const ramp = Math.min(1, (t - (WAIT - 0.25)) / 0.5);
        plume.scale.set(1.45 * flick * (0.6 + 0.4 * ramp), (L / 16) * flick * ramp, 1.45 * flick * (0.6 + 0.4 * ramp));
      }
      // the crew arm swings clear before lift-off and back after landing
      const out = t < WAIT ? ease((t - 0.1) / 1.6) : t < WAIT + UP + HOVER + DOWN ? 1 : 1 - ease((t - WAIT - UP - HOVER - DOWN - 0.4) / 1.8);
      arm.rotation.y = out * 1.75;
    },
    dispose() {},
  };
  return group;
}
