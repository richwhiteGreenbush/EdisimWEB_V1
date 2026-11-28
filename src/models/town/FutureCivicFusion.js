// fusion-power-plant: a round hall 60ft across with its roof cut away and its front wall cut down to
// a low parapet, like a museum's cutaway model, so the machine inside can be seen from the street. The
// machine is a tokamak: a ring-shaped vacuum vessel with a D-shaped cross-section, ringed by D-shaped
// magnet coils round a central solenoid, with a gap in its front where the plasma glows purple and
// pink. The plasma ring turns and breathes by itself. Every cut surface is painted coral, the way a
// cutaway model marks what has been sliced.

import * as THREE from 'three';
import { FUTURE } from './TownKit.js';
import { reducedMotion } from '../../Settings.js';
import { FKit, latheG, sweepLoopG, ringG, rodG, tubeG, pillG, ballG, glassTint, times } from './FutureCivicKit.js';

const DEG = Math.PI / 180;
const FLOOR = 0.5;
const R_IN = 26; const R_OUT = 28; const WALL_H = 24; const LOW = 3.2;
const CUT_A = 58 * DEG; // the front cutaway spans -CUT_A..CUT_A
const PLINTH = 30;
// the tokamak
const R0 = 9; const Y0 = 9.2;
const GAP = 42 * DEG; // the vessel is opened over -GAP..GAP
const CUT = 0xff7a59; const CUT_DARK = 0xd9573c;
const WHITE = FUTURE.white; const PEARL = FUTURE.pearl; const VIOLET = 0x7a52e0;

// A D-shaped loop in (r, y): the tokamak's own cross-section. a is the minor radius, kappa the
// elongation, delta the triangularity that pushes the top and bottom toward the axis.
function dLoop(a, kappa = 1.45, delta = 0.38, n = 30) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([R0 + a * Math.cos(t + delta * Math.sin(t)), Y0 + kappa * a * Math.sin(t)]);
  }
  return pts;
}

// Paints the faces a cutaway slices: the top of a cut-down wall and the ends of a cut sector.
function cutTint(top) {
  const c = new THREE.Color(CUT); const d = new THREE.Color(CUT_DARK);
  return (x, y, z, out, nx, ny, nz) => {
    const r = Math.hypot(x, z) || 1;
    const radial = Math.abs((nx * x + nz * z) / r);
    if ((ny > 0.9 && y > top - 0.02) || (radial < 0.35 && Math.abs(ny) < 0.35)) {
      const k = ((Math.floor((x + z + y) * 1.4) & 1) === 0) ? c : d; // hatching only shows where the mesh has the rows
      out[0] = k.r; out[1] = k.g; out[2] = k.b;
    }
  };
}

export function fusionBuild() {
  const K = new FKit({ seed: 881, atlasW: 1024, atlasH: 1024 });

  // --- plinth and floor ----------------------------------------------------------------------
  K.add('body', latheG([[0, -0.4], [PLINTH, -0.4], [PLINTH, 0.3], [PLINTH - 0.3, FLOOR], [0, FLOOR]], 96), 0xb9bfd0);
  K.glowPolar('violet', PLINTH - 0.8, PLINTH - 0.5, FLOOR - 0.05, FLOOR + 0.06, 0, Math.PI * 2, { segs: 72 });
  K.polar('paint', 0x3d4478, 0, R_IN - 0.05, FLOOR, FLOOR + 0.05, 0, Math.PI * 2, { segs: 72 });
  for (const r of [14.5, 19, 23]) K.glowPolar(r === 14.5 ? 'pink' : 'cyan', r - 0.12, r + 0.12, FLOOR + 0.05, FLOOR + 0.09, 0, Math.PI * 2, { segs: 48 });

  // --- the drum: back wall full height, front cut down to a parapet ----------------------------
  K.polar('body', PEARL, R_IN, R_OUT, -0.4, WALL_H, CUT_A, Math.PI * 2 - CUT_A, { segs: 70, tint: cutTint(WALL_H) });
  K.polar('body', PEARL, R_IN, R_OUT, -0.4, LOW, -CUT_A, CUT_A, { segs: 30, tint: cutTint(LOW) });
  // outside: a violet base band, a glowing line high up, porthole windows round the back
  K.polar('body', VIOLET, R_OUT, R_OUT + 0.25, FLOOR, 2.6, CUT_A + 0.004, Math.PI * 2 - CUT_A - 0.004, { segs: 70 });
  K.polar('body', VIOLET, R_OUT, R_OUT + 0.25, FLOOR, 2.6, -CUT_A + 0.004, CUT_A - 0.004, { segs: 30 });
  K.glowPolar('aqua', R_OUT, R_OUT + 0.12, 20.8, 21.2, CUT_A + 0.004, Math.PI * 2 - CUT_A - 0.004, { segs: 50 });
  K.glowPolar('pink', R_OUT, R_OUT + 0.12, 4.0, 4.3, CUT_A + 0.004, Math.PI * 2 - CUT_A - 0.004, { segs: 50 });
  for (let k = 0; k < 14; k++) {
    const a = CUT_A + 0.12 + (k / 13) * (Math.PI * 2 - CUT_A * 2 - 0.24);
    const x = (R_OUT + 0.05) * Math.sin(a); const z = (R_OUT + 0.05) * Math.cos(a);
    const m = new THREE.Matrix4().makeRotationY(a).setPosition(x, 12.5, z);
    K.within(m, () => {
      K.add('body', new THREE.CylinderGeometry(1.7, 1.7, 0.3, 18).rotateX(Math.PI / 2), WHITE);
      K.glow(k % 2 ? 'cyan' : 'pink', new THREE.CylinderGeometry(1.35, 1.35, 0.4, 18).rotateX(Math.PI / 2));
    });
  }
  // inside: a pale lining, vertical light strips, a control-room window band at the back
  K.polar('body', 0xc4cadf, R_IN - 0.1, R_IN, FLOOR, WALL_H - 0.4, CUT_A + 0.02, Math.PI * 2 - CUT_A - 0.02, { segs: 70 });
  for (let k = 0; k < 12; k++) {
    const a = CUT_A + 0.25 + (k / 11) * (Math.PI * 2 - CUT_A * 2 - 0.5);
    if (Math.abs(a - Math.PI) < 0.5) continue;
    K.glowPolar('cyan', R_IN - 0.2, R_IN - 0.1, 2, WALL_H - 3, a - 0.006, a + 0.006, { segs: 1 });
  }
  const CA = 26 * DEG;
  K.polar('body', 0x5a6488, R_IN - 0.5, R_IN - 0.1, 2.6, 9.2, Math.PI - CA - 0.02, Math.PI + CA + 0.02, { segs: 20 });
  for (let k = 0; k < 6; k++) {
    const a0 = Math.PI - CA + (k / 6) * CA * 2 + 0.008; const a1 = a0 + (CA * 2) / 6 - 0.016;
    K.polar('glass', 0x2b5876, R_IN - 0.58, R_IN - 0.5, 3.0, 8.8, a0, a1, { segs: 3, tint: glassTint(3, 8.8, 0x23466a, 0x5a8fb5) });
  }
  K.polar('body', 0xdfe4ea, R_IN - 1.6, R_IN - 0.1, 2.6, 2.9, Math.PI - CA - 0.02, Math.PI + CA + 0.02, { segs: 20 });
  // the sign, on the inside of the back wall, facing the street through the cutaway
  const SGA = 30 * DEG;
  const sign = K.rect(900, 180, (c, x, y, w, h) => {
    const g = c.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, '#2a0f5c'); g.addColorStop(0.5, '#4a1470'); g.addColorStop(1, '#2a0f5c');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    const fam = '"Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif';
    let px = Math.floor(h * 0.62);
    c.font = `bold ${px}px ${fam}`;
    const word = 'FUSION POWER';
    if (c.measureText(word).width > w * 0.8) { px = Math.floor(px * w * 0.8 / c.measureText(word).width); c.font = `bold ${px}px ${fam}`; }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#ff5ccf'; c.shadowBlur = h * 0.16;
    c.fillStyle = '#ffd6f4'; c.fillText(word, x + w / 2, y + h * 0.55);
    c.shadowBlur = 0;
    // a little atom at each end, drawn
    for (const sx of [0.065, 0.935]) {
      const cx = x + w * sx; const cy = y + h / 2;
      c.strokeStyle = '#5cf2ff'; c.lineWidth = 4;
      for (let k = 0; k < 3; k++) { c.beginPath(); c.ellipse(cx, cy, h * 0.36, h * 0.13, (k * Math.PI) / 3, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = '#ffd166'; c.beginPath(); c.arc(cx, cy, h * 0.08, 0, Math.PI * 2); c.fill();
    }
  });
  K.polarScreen(sign, R_IN - 0.35, R_IN - 0.1, 14.2, 19.6, Math.PI, SGA * 2, { inward: true, segs: 30 });
  K.glowPolar('pink', R_IN - 0.4, R_IN - 0.1, 19.6, 19.9, Math.PI - SGA, Math.PI + SGA, { segs: 24 });
  K.glowPolar('pink', R_IN - 0.4, R_IN - 0.1, 13.9, 14.2, Math.PI - SGA, Math.PI + SGA, { segs: 24 });
  // a plaque on the front parapet for the street
  const plaque = K.textRect('FUSION POWER PLANT', 13, 1.6, { bg: '#2a0f5c', fg: '#ffffff', size: 0.62, glowText: '#ff5ccf' });
  K.polarScreen(plaque, R_OUT + 0.25, R_OUT + 0.37, FLOOR + 0.45, FLOOR + 2.0, 0, 13 / (R_OUT + 0.3), { segs: 16 });

  // --- the roof, cut away: a ring of slab left on the back wall and the stubs of its beams ----
  K.polar('body', 0xdfe4ea, R_IN - 2.4, R_OUT + 0.5, WALL_H, WALL_H + 1.2, CUT_A + 0.05, Math.PI * 2 - CUT_A - 0.05, { segs: 70, tint: cutTint(99) });
  K.glowPolar('aqua', R_OUT + 0.5, R_OUT + 0.62, WALL_H + 0.35, WALL_H + 0.85, CUT_A + 0.05, Math.PI * 2 - CUT_A - 0.05, { segs: 70 });
  for (let k = 0; k < 7; k++) {
    const a = Math.PI + (k - 3) * 0.42;
    const len = 4.5 + (k % 2) * 2.5;
    K.polar('body', 0xdfe4ea, R_IN - 2.4 - len, R_IN - 2.4, WALL_H - 0.6, WALL_H + 1.2, a - 0.02, a + 0.02, { segs: 1, tint: (x, y, z, out, nx, ny, nz) => {
      const r = Math.hypot(x, z);
      if (r < R_IN - 2.45 - len + 0.05 && Math.abs(nx * x + nz * z) / r > 0.8) { const c = new THREE.Color(CUT); out[0] = c.r; out[1] = c.g; out[2] = c.b; }
    } });
  }

  // --- the tokamak -----------------------------------------------------------------------------
  // a ring of support legs and a pedestal
  K.add('paint', latheG([[0, FLOOR], [13.4, FLOOR], [13.4, 1.4], [12.6, 2.0], [0, 2.0]], 64), 0x6d7594);
  K.glow('cyan', ringG(13.42, 0.1, 1.2, { radial: 4, tubular: 48 }));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.31;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < GAP) continue;
    for (const r of [7.0, 11.4]) K.rod('paint', 0x8d95b2, [r * Math.sin(a), 2.0, r * Math.cos(a)], [r * Math.sin(a), Y0 - 3.6, r * Math.cos(a)], 0.35, { sides: 10 });
  }
  // the vacuum vessel, opened at the front; its cut ends are coral
  const vessel = sweepLoopG(dLoop(3.4, 1.45, 0.38, 24), GAP, Math.PI * 2 - GAP, 40);
  K.add('paint', vessel, 0xb3b6d8, { tint: (x, y, z, out, nx, ny, nz) => {
    const r = Math.hypot(x, z) || 1;
    const radial = (nx * x + nz * z) / r;
    if (Math.abs(radial) < 0.3 && Math.abs(ny) < 0.3 && Math.abs(Math.atan2(x, z)) < GAP + 0.02) { const c = new THREE.Color(CUT); out[0] = c.r; out[1] = c.g; out[2] = c.b; }
  } });
  // twelve D-shaped magnet coils, skipping the opening
  const outerD = dLoop(4.75, 1.4, 0.38, 22); const innerD = dLoop(3.85, 1.4, 0.38, 22);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < GAP - 0.05) continue;
    const s = new THREE.Shape(outerD.map(([r, y]) => new THREE.Vector2(r, y)));
    s.holes.push(new THREE.Path([...innerD].reverse().map(([r, y]) => new THREE.Vector2(r, y))));
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.2, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 1, curveSegments: 1 });
    g.translate(0, 0, -0.6);
    g.rotateY(Math.PI / 2 - a);
    g.clearGroups();
    K.add('paint', g, 0xff8a3d, { tint: (x, y, z, out) => { if (Math.abs(y - Y0) < 0.6) { out[0] = 0.9; out[1] = 0.9; out[2] = 0.93; } } });
  }
  // the central solenoid, and the flat poloidal coils above and below
  K.add('paint', latheG([[0, 2.0], [3.0, 2.0], [3.0, 17.2], [2.4, 17.8], [0, 17.8]], 32), 0x3f8ff0);
  for (const y of [5, 9.2, 13.4]) K.glow('cyan', ringG(3.04, 0.12, y, { radial: 4, tubular: 24 }));
  for (const [R, y, r] of [[13.6, Y0 + 6.6, 0.55], [13.6, Y0 - 6.0, 0.55], [6.2, Y0 + 7.4, 0.45]]) K.add('paint', ringG(R, r, y, { radial: 8, tubular: 48 }), 0x22b5a8);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
    K.rod('paint', 0x8d95b2, [13.6 * Math.sin(a), Y0 - 6.0, 13.6 * Math.cos(a)], [13.6 * Math.sin(a), FLOOR, 13.6 * Math.cos(a)], 0.22, { sides: 8 });
  }

  // --- heat to electricity: a heat exchanger and a generator at the back, joined by pipes ------
  {
    const hx = 12; const hz = -17;
    K.add('paint', latheG([[0, FLOOR], [3.0, FLOOR], [3.2, 1.2], [3.2, 12], [2.2, 13.5], [0, 13.6]], 28).translate(hx, 0, hz), 0x22b5a8);
    for (const y of [4, 8]) K.glow('aqua', ringG(3.22, 0.1, y, { x: hx, z: hz, radial: 4, tubular: 24 }));
    K.add('paint', tubeG([[9.8, 12.2, -6.8], [11, 13.6, -11], [12, 12.6, -15]], 0.7, { sides: 10, steps: 16 }), 0xdfe4ea);
    const gx = -12; const gz = -17.5;
    const g = pillG(9, 5.2, 5.2, 2.2, 0.15).rotateY(Math.PI / 2 - 0.55).translate(gx, FLOOR + 2.6, gz);
    K.add('paint', g, 0x86cf45);
    K.add('paint', tubeG([[hx - 2.8, 3.5, hz], [0, 3.0, -21.6], [gx + 3, 3.4, gz + 1]], 0.55, { sides: 10, steps: 18 }), 0xdfe4ea);
    K.glow('lime', ringG(2.7, 0.14, 0, { radial: 6, tubular: 32 }).rotateX(Math.PI / 2).rotateY(Math.PI / 2 - 0.55).translate(gx, FLOOR + 2.6, gz));
    // a cable from the generator out through the wall: where the electricity leaves
    K.add('paint', tubeG([[gx - 2, 1.2, gz - 2.4], [-14, 1.0, -21], [-15.5, 1.0, -21.3]], 0.3, { sides: 8 }), 0xffc23d);
    const hl = K.textRect('HEAT', 3.6, 1.0, { bg: '#0c4a4a', fg: '#ffffff' });
    K.screen(hl, hx, 6.2, 3.2, 0.9, hz + 3.18, hz + 3.3);
    const gl = K.textRect('GENERATOR', 5.2, 1.0, { bg: '#2c5a12', fg: '#ffffff' });
    const m = new THREE.Matrix4().makeRotationY(-0.55 + 0.0).setPosition(gx + 1.4, FLOOR + 3.2, gz + 2.75);
    K.within(m, () => K.screen(gl, 0, 0, 4.6, 0.9, 0, 0.1));
  }

  const { group } = K.finish();

  // --- the plasma: its own mesh, so it can turn and breathe --------------------------------------
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#a33cf0'); g.addColorStop(0.3, '#f070ff'); g.addColorStop(0.5, '#fff0fd'); g.addColorStop(0.7, '#ff7ad8'); g.addColorStop(1, '#a33cf0');
    x.fillStyle = g; x.fillRect(0, 0, 512, 64);
    // bright filaments running round the ring, so its turning can be seen
    for (let i = 0; i < 26; i++) {
      const u = (i * 97) % 512; const v = 8 + ((i * 37) % 48); const L = 40 + ((i * 53) % 90);
      x.strokeStyle = i % 3 ? 'rgba(255,240,255,0.55)' : 'rgba(120,230,255,0.5)';
      x.lineWidth = 2 + (i % 3);
      x.beginPath(); x.moveTo(u, v); x.bezierCurveTo(u + L * 0.3, v - 6, u + L * 0.7, v + 6, u + L, v); x.stroke();
      if (u + L > 512) { x.beginPath(); x.moveTo(u - 512, v); x.bezierCurveTo(u - 512 + L * 0.3, v - 6, u - 512 + L * 0.7, v + 6, u - 512 + L, v); x.stroke(); }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  })();
  const pg = new THREE.TorusGeometry(R0, 2.05, 12, 64);
  pg.rotateX(Math.PI / 2);
  pg.scale(1, 1.45, 1);
  pg.translate(0, Y0, 0);
  const plasmaMat = new THREE.MeshStandardMaterial({ color: 0x1a0628, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.25, roughness: 0.6, metalness: 0 });
  const plasma = new THREE.Mesh(pg, plasmaMat);
  plasma.castShadow = false;
  plasma.receiveShadow = false;
  // a soft pink halo round it: the model's one see-through mesh
  const hg = new THREE.TorusGeometry(R0, 2.75, 10, 48);
  hg.rotateX(Math.PI / 2); hg.scale(1, 1.4, 1); hg.translate(0, Y0, 0);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xff7ae0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const halo = new THREE.Mesh(hg, haloMat);
  halo.castShadow = false; halo.receiveShadow = false;
  const spin = new THREE.Group();
  spin.add(plasma);
  spin.add(halo);
  group.add(spin);

  let clock = 0;
  group.userData.tick = {
    update(dt) {
      if (reducedMotion()) { plasmaMat.emissiveIntensity = 1.25; haloMat.opacity = 0.22; return; }
      const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      clock += step;
      spin.rotation.y = (spin.rotation.y + step * 0.9) % (Math.PI * 2);
      plasmaMat.emissiveIntensity = 1.25 + 0.3 * Math.sin(clock * 2.4) + 0.08 * Math.sin(clock * 7.1);
      haloMat.opacity = 0.22 + 0.1 * Math.sin(clock * 2.4);
      const s = 1 + 0.015 * Math.sin(clock * 2.4);
      plasma.scale.set(s, s, s);
    },
    dispose() {},
  };
  return group;
}
