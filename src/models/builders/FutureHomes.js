// Build a Future City: the homes and towers. Vertical farm, forest apartment tower, 3D-printed dome
// home, floating home, sun-tracking skyscraper, biodome garden.
//
// Every one is IMAGINED, real life size on the kit's 10ft grid (src/models/town/TownKit.js), origin
// at the base centre, front toward +Z, with its foundation running down to y = -0.4. The parts come
// from src/models/town/FutureHomesKit.js: one bag per material, near-white tiles multiplied by
// vertex colour, and an unlit glow mesh that holds every light in the model in its own colour.
//
// What moves by itself, each under an inner group so the root never moves, and each held nearly
// still when Settings asks for reduced motion:
//   vertical-farm-tower  the rooftop wind turbine turns
//   printed-dome-home    the printer's head slides along its beam, laying the garden wall
//   floating-home        the house and its platform bob very gently on the canal
//   solar-skyscraper     the solar petals turn to face the scene's own sun (Time of Day moves it)

import * as THREE from 'three';
import { FUTURE } from '../town/TownKit.js';
import { reducedMotion } from '../../Settings.js';
import { seededRandom } from '../../PropKit.js';
import { outward } from '../ModelKit.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Kit, col, shade, blend, roundRect, polar, squircle, blob, addColored } from '../town/FutureHomesKit.js';

const BASE = -0.4;
const clampDt = (dt) => Math.min(Math.max(Number(dt) || 0, 0), 0.1);

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// =============================================================================================
// vertical-farm-tower
// =============================================================================================
// Ten glass floors of stacked growing racks. The crops are a painted canvas (four tiling bands:
// lettuce, tomatoes, strawberries, kale) on low lumpy strips, because a tray of a hundred plants
// as geometry would be the whole budget on one floor. The grow lights are the glow mesh: every
// tray has a bar of pink-violet or blue LEDs under the one above it, and the floors alternate.

const CROP_BANDS = 4; // bands of 112px from the top of a 512px canvas; the last 64px are white
const BAND_PX = 112;
function cropCanvas(seed) {
  const rng = seededRandom(seed);
  const W = 512; const H = 512; const cv = canvas(W, H); const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const wrap = (x, fn) => { for (const dx of [-W, 0, W]) fn(x + dx); };
  for (let b = 0; b < CROP_BANDS; b++) {
    const y0 = b * BAND_PX; const h = BAND_PX;
    ctx.save(); ctx.beginPath(); ctx.rect(0, y0, W, h); ctx.clip();
    // stems and shade at the bottom of the band, leaves above
    const g = ctx.createLinearGradient(0, y0 + h, 0, y0);
    g.addColorStop(0, '#2f5a22'); g.addColorStop(0.5, '#4c8a2e'); g.addColorStop(1, '#79b844');
    ctx.fillStyle = g; ctx.fillRect(0, y0, W, h);
    const leaf = (x, y, r, c, a = 0) => wrap(x, (xx) => { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(xx, y, r, r * 0.55, a, 0, Math.PI * 2); ctx.fill(); });
    const dot = (x, y, r, c) => wrap(x, (xx) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(xx, y, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(xx - r * 0.3, y - r * 0.3, r * 0.3, 0, Math.PI * 2); ctx.fill(); });
    const pitch = W / 8; // 8 plants over the 4ft tile: one every 6 inches
    for (let p = 0; p < 8; p++) {
      const cx = p * pitch + pitch / 2 + (rng() - 0.5) * 8;
      if (b === 0) { // lettuce: a rosette of round leaves, some red-leaf
        const red = p % 3 === 1;
        for (let k = 0; k < 14; k++) {
          const a = rng() * Math.PI * 2; const rr = rng() * 22;
          const c = red ? `rgb(${150 + rng() * 40},${60 + rng() * 30},${90 + rng() * 30})` : `rgb(${110 + rng() * 60},${190 + rng() * 50},${70 + rng() * 40})`;
          leaf(cx + Math.cos(a) * rr, y0 + h * 0.42 + Math.sin(a) * rr * 0.6, 14 + rng() * 8, c, a);
        }
      } else if (b === 1) { // tomatoes: vines with red fruit
        for (let k = 0; k < 10; k++) leaf(cx + (rng() - 0.5) * 50, y0 + h * (0.2 + rng() * 0.7), 10 + rng() * 6, `rgb(${60 + rng() * 40},${130 + rng() * 50},${50 + rng() * 30})`, rng() * 3);
        for (let k = 0; k < 4; k++) dot(cx + (rng() - 0.5) * 44, y0 + h * (0.3 + rng() * 0.55), 7 + rng() * 4, `rgb(${215 + rng() * 40},${40 + rng() * 40},${35})`);
      } else if (b === 2) { // strawberries: low leaves, berries hanging below
        for (let k = 0; k < 8; k++) leaf(cx + (rng() - 0.5) * 46, y0 + h * (0.25 + rng() * 0.35), 12 + rng() * 5, `rgb(${70 + rng() * 40},${150 + rng() * 50},${60 + rng() * 30})`, rng() * 3);
        for (let k = 0; k < 4; k++) {
          const x = cx + (rng() - 0.5) * 46; const y = y0 + h * (0.62 + rng() * 0.3);
          wrap(x, (xx) => {
            ctx.fillStyle = '#e8263c'; ctx.beginPath(); ctx.moveTo(xx - 6, y - 4); ctx.quadraticCurveTo(xx, y + 14, xx + 6, y - 4); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#ffe36a'; for (let s = 0; s < 3; s++) ctx.fillRect(xx - 3 + s * 2, y + s, 1.2, 1.2);
          });
        }
        for (let k = 0; k < 2; k++) leaf(cx + (rng() - 0.5) * 30, y0 + h * 0.5, 4, '#fff4f4');
      } else { // kale and basil: dark, crinkled
        for (let k = 0; k < 14; k++) {
          const a = rng() * Math.PI * 2; const rr = rng() * 24;
          leaf(cx + Math.cos(a) * rr, y0 + h * 0.45 + Math.sin(a) * rr * 0.6, 10 + rng() * 9, `rgb(${40 + rng() * 40},${110 + rng() * 60},${60 + rng() * 50})`, a);
        }
      }
    }
    ctx.restore();
  }
  return cv;
}
// v range of a band (three's v runs up from the canvas bottom)
const bandV = (b) => [1 - ((b + 1) * BAND_PX - 4) / 512, 1 - (b * BAND_PX + 4) / 512];
const CROP_FLAT = [0.5, 30 / 512];

// A lumpy closed strip of crop along X: a rounded section whose height jitters every segment,
// painted with band `band`. Returns a geometry with uv and colour.
function cropStrip(x0, x1, y, z, depth, h, band, rng, tint) {
  const n = Math.max(2, Math.round((x1 - x0) / 3.0));
  const prof = [[-1, 0], [-0.82, 0.92], [0.82, 0.92], [1, 0]];
  const fr = [0, 1, 1, 0]; // fraction up the band
  const m = prof.length;
  const [v0, v1] = bandV(band);
  const pos = []; const uv = []; const idx = [];
  const hs = []; for (let i = 0; i <= n; i++) hs.push(i === 0 || i === n ? 0.7 : 0.82 + rng() * 0.36);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    for (let k = 0; k < m; k++) {
      pos.push(x, y + prof[k][1] * h * hs[i], z + prof[k][0] * depth * 0.5);
      uv.push(x / 4, v0 + (v1 - v0) * fr[k]);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m - 1; k++) {
      const a = i * m + k; const b = (i + 1) * m + k;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    // the bottom
    idx.push(i * m + m - 1, (i + 1) * m + m - 1, (i + 1) * m, i * m + m - 1, (i + 1) * m, i * m);
  }
  // end caps, a fan from the section's middle, with their own vertices
  for (const [i, s] of [[0, -1], [n, 1]]) {
    const c = pos.length / 3;
    const x = x0 + ((x1 - x0) * i) / n;
    pos.push(x, y + h * hs[i] * 0.45, z); uv.push(x / 4 + 0.1, v0 + (v1 - v0) * 0.55);
    for (let k = 0; k < m; k++) { pos.push(x, y + prof[k][1] * h * hs[i], z + prof[k][0] * depth * 0.5); uv.push(x / 4 + 0.1 + prof[k][0] * 0.08, v0 + (v1 - v0) * fr[k]); }
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      if (s < 0) idx.push(c, c + 1 + k2, c + 1 + k); else idx.push(c, c + 1 + k, c + 1 + k2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const cArr = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < pos.length / 3; i++) { cArr[i * 3] = tint[0]; cArr[i * 3 + 1] = tint[1]; cArr[i * 3 + 2] = tint[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
  return outward(g);
}

function verticalFarmTower() {
  const K = new Kit(41);
  const rng = K.rng;
  const FLOORS = 10; const H = 8.6; const L0 = 0.5;
  const level = (i) => L0 + i * H;
  const ROOF = level(FLOORS);
  const HALF = 20; const R = 6;
  const slabPlan = roundRect(HALF, HALF, R, 6);
  const white = 0xd9dfe7;
  const GLOW = [[0xff4fd2, 0xb46bff], [0x4f8cff, 0x8a6bff]]; // pink-violet, blue
  const paint = K.bag('paint');
  K.flatUV.paint = CROP_FLAT;

  // ---- foundation, slabs, glass -----------------------------------------------------------
  K.slab('body', white, roundRect(HALF + 0.4, HALF + 0.4, R + 0.4, 6), BASE, L0, { feet: [4, 4] });
  for (let i = 1; i <= FLOORS; i++) {
    const y = level(i);
    K.slab('body', white, slabPlan, y - 0.9, y, { feet: [4, 4] });
    // the LED edge strip on every slab, alternating with the floor beneath it
    const gc = GLOW[(i - 1) % 2][0];
    K.slab('glow', blend(gc, 0xffffff, 0.12), roundRect(HALF + 0.06, HALF + 0.06, R + 0.06, 6), y - 0.7, y - 0.25, { holes: [roundRect(HALF - 0.3, HALF - 0.3, R - 0.3, 6)] });
  }
  // the parapet and its cap
  K.slab('body', white, slabPlan, ROOF, ROOF + 2.6, { holes: [roundRect(HALF - 0.8, HALF - 0.8, R - 0.8, 6)], feet: [4, 4] });
  K.slab('body', shade(white, 1.04), roundRect(HALF + 0.25, HALF + 0.25, R + 0.25, 6), ROOF + 2.6, ROOF + 2.9, { holes: [roundRect(HALF - 1.0, HALF - 1.0, R - 1.0, 6)] });
  K.slab('body', 0x9aa6b2, roundRect(HALF - 0.8, HALF - 0.8, R - 0.8, 6), ROOF, ROOF + 0.25);

  const GH = 19.25;
  for (let i = 0; i < FLOORS; i++) {
    const y0 = level(i); const y1 = level(i + 1) - 0.9;
    K.slab('clear', 0x8fd8f4, roundRect(GH, GH, R - 0.75, 6), y0, y1, { holes: [roundRect(GH - 0.15, GH - 0.15, R - 0.9, 6)] });
  }
  // fins: full-height white mullions round the plan, sunk into every slab
  const fins = [];
  for (let s = -15; s <= 15; s += 5) { fins.push([s, GH + 0.25, 0]); fins.push([s, -GH - 0.25, 0]); fins.push([GH + 0.25, s, Math.PI / 2]); fins.push([-GH - 0.25, s, Math.PI / 2]); }
  const cc = HALF - R; const cr = R - 0.5;
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) fins.push([sx * (cc + cr * Math.SQRT1_2), sz * (cc + cr * Math.SQRT1_2), sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4]);
  for (const [x, z, a] of fins) {
    const g = new THREE.BoxGeometry(0.35, ROOF - L0, 0.7);
    g.rotateY(a); g.translate(x, (ROOF + L0) / 2, z);
    if (Math.abs(x) < 0.1 && z > 0) continue; // the entrance
    K.add('body', g, shade(white, 0.97), { feet: [4, 4] });
  }

  // ---- racks and crops --------------------------------------------------------------------
  // Four racks per floor stand just inside the glass, one along each face, so from any side a
  // student sees the long face of a rack packed with crops; a fifth runs down the middle.
  const tiers = [0.7, 3.1, 5.5];
  const cropOrder = [0, 1, 2, 3, 0, 2, 1, 3, 0, 1];
  const RZ = 16.1; const RL = 12.2;
  const bx = (bag, color, x0, x1, y0, y1, z0, z1, m) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return K.add(bag, g, color, { matrix: m });
  };
  for (let i = 0; i < FLOORS; i++) {
    const L = level(i);
    const glowPair = GLOW[i % 2];
    const lit = i % 2 === 0 ? [1.1, 0.84, 1.06] : [0.86, 0.95, 1.14]; // the crops take the light's colour
    // the whole ceiling of the floor glows in its light's colour, which is what a grow floor looks like at dusk
    K.slab('glow', blend(glowPair[0], 0xffffff, 0.28), roundRect(GH - 0.4, GH - 0.4, R - 1.1, 6), level(i + 1) - 0.96, level(i + 1) - 0.9);
    const racks = [[0, RZ], [Math.PI, RZ], [Math.PI / 2, RZ], [-Math.PI / 2, RZ], [0, 0]];
    for (const [ri, [a, z]] of racks.entries()) {
      if (i === 0 && ri === 0) continue; // the lobby's shop front
      const m = new THREE.Matrix4().makeRotationY(a);
      const len = ri === 4 ? 10.5 : RL;
      const x0 = -len; const x1 = len;
      for (const x of [x0, 0, x1]) for (const dz of [-1.12, 1.12]) bx('paint', 0xc9d3dd, x - 0.12, x + 0.12, L, L + 7.6, z + dz - 0.12, z + dz + 0.12, m);
      for (const [ti, ty] of tiers.entries()) {
        const band = (cropOrder[i] + ri + ti) % CROP_BANDS;
        bx('paint', 0xf0f4f8, x0 - 0.2, x1 + 0.2, L + ty - 0.22, L + ty, z - 1.3, z + 1.3, m);
        bx('paint', glowPair[ti % 2] === glowPair[0] ? 0x8a52e0 : 0x4a7ae0, x0 - 0.2, x1 + 0.2, L + ty - 0.34, L + ty - 0.2, z + 1.2, z + 1.36, m);
        const tint = [lit[0] * (0.95 + rng() * 0.1), lit[1], lit[2]];
        const g = cropStrip(x0, x1, L + ty - 0.02, z, 2.2, 1.15 + (band === 1 ? 0.35 : 0), band, rng, tint);
        g.applyMatrix4(m);
        paint.push({ geometry: g, keepColor: true });
        // the grow light over this tray: hung under the next tray up, or under the ceiling
        const ly = ti < tiers.length - 1 ? L + tiers[ti + 1] - 0.36 : L + 7.45;
        bx('glow', glowPair[ti % 2], x0 + 0.3, x1 - 0.3, ly - 0.16, ly, z - 0.9, z + 0.9, m);
      }
    }
  }

  // ---- the lobby, the entrance and the sign --------------------------------------------
  // a market counter of crates behind the doors
  for (let k = 0; k < 4; k++) {
    const x = -9 + k * 6;
    K.box('paint', 0xc98b4e, x - 2.2, x + 2.2, L0, L0 + 2.6, 9.5, 12.5);
    K.box('paint', [0xe8263c, 0x7fd04a, 0xffb02e, 0xe04fb4][k], x - 2.0, x + 2.0, L0 + 2.6, L0 + 3.0, 9.7, 12.3);
  }
  // sliding doors in a glowing frame, built forward of the glass
  K.box('paint', 0x2b5876, -4, 4, L0, L0 + 7.6, GH - 0.1, GH + 0.05);
  K.box('paint', 0x5f7e94, -0.08, 0.08, L0, L0 + 7.6, GH, GH + 0.12);
  for (const x of [-4.35, 4.35]) K.box('body', white, x - 0.35, x + 0.35, L0, L0 + 8.2, GH - 0.2, GH + 0.45);
  K.box('body', white, -4.7, 4.7, L0 + 7.6, L0 + 8.4, GH - 0.2, GH + 0.45);
  K.box('glow', FUTURE.glowCyan, -4.0, 4.0, L0 + 7.62, L0 + 7.82, GH + 0.45, GH + 0.5);
  // a curved canopy over the doors
  {
    const pts = []; const n = 14;
    for (let k = 0; k <= n; k++) { const a = Math.PI * (k / n); pts.push([Math.cos(a) * 8, Math.sin(a) * 5]); }
    const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.45, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(Math.PI / 2); g.translate(0, L0 + 9.4, GH);
    K.add('body', g, FUTURE.lime);
    const gg = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x * 0.9, z * 0.85))), { depth: 0.05, bevelEnabled: false, curveSegments: 1 });
    gg.rotateX(Math.PI / 2); gg.translate(0, L0 + 8.93, GH + 0.2);
    K.add('glow', gg, 0xfff0a0);
  }
  // the big sign across the parapet, front and back
  const signRect = K.atlas.sign('SKYFARM 7', 6, { px: 70, bg: '#132a4a', fg: '#7bf6ff', fill: 0.66 });
  for (const s of [1, -1]) {
    const g = new THREE.BoxGeometry(24, 3.6, 0.3);
    if (s < 0) g.rotateY(Math.PI);
    g.translate(0, ROOF + 1.25, s * (HALF + 0.1));
    K.add('glow', g, 0xffffff, { sign: signRect, signAxis: [0, 0, s] });
  }
  const leafRect = K.atlas.paint(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#132a4a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b6ff5c';
    ctx.beginPath(); ctx.moveTo(w * 0.22, h * 0.8);
    ctx.bezierCurveTo(w * 0.1, h * 0.3, w * 0.55, h * 0.1, w * 0.85, h * 0.14);
    ctx.bezierCurveTo(w * 0.85, h * 0.5, w * 0.6, h * 0.85, w * 0.22, h * 0.8); ctx.fill();
    ctx.strokeStyle = '#132a4a'; ctx.lineWidth = w * 0.05;
    ctx.beginPath(); ctx.moveTo(w * 0.14, h * 0.9); ctx.quadraticCurveTo(w * 0.45, h * 0.55, w * 0.78, h * 0.22); ctx.stroke();
  });
  for (const s of [1, -1]) {
    const g = new THREE.BoxGeometry(3.6, 3.6, 0.3);
    if (s < 0) g.rotateY(Math.PI);
    g.translate(s * -14.6, ROOF + 1.25, s * (HALF + 0.1));
    K.add('glow', g, 0xffffff, { sign: leafRect, signAxis: [0, 0, s] });
  }

  // ---- the roof: a water tank and a wind turbine -----------------------------------------
  const RT = ROOF + 0.25;
  // rainwater tank: an aqua capsule on legs, with a glowing level gauge
  const tx = -9; const tz = -8;
  for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) K.box('paint', 0x8a96a3, tx + dx - 0.25, tx + dx + 0.25, RT, RT + 3.2, tz + dz - 0.25, tz + dz + 0.25);
  K.turned('paint', FUTURE.aqua, [[0, 0], [4.6, 0.0], [5.0, 0.6], [5.0, 6.6], [4.4, 7.6], [2.2, 8.3], [0, 8.4]], tx, RT + 3.0, tz, { sides: 20 });
  K.box('glow', FUTURE.glowCyan, tx - 0.4, tx + 0.4, RT + 4.2, RT + 9.0, tz + 4.92, tz + 5.12);
  K.cyl('paint', 0x8a96a3, tx, tz, RT + 11.2, RT + 11.9, 1.0, { sides: 12 });
  // solar panels on frames, tilted to the south (+Z)
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = -14 + c * 5.4; const z = 6 + r * 6;
      const m = new THREE.Matrix4().makeTranslation(x, RT + 1.6, z).multiply(new THREE.Matrix4().makeRotationX(0.42));
      const pg = new THREE.BoxGeometry(5, 0.18, 3.6); K.add('paint', pg, 0x2d4f96, { matrix: m });
      for (let k = -2; k <= 2; k++) { const lg = new THREE.BoxGeometry(0.06, 0.04, 3.5); lg.translate(k * 1.0, 0.1, 0); K.add('paint', lg, 0xb9c6d6, { matrix: m }); }
      const lg = new THREE.BoxGeometry(4.9, 0.04, 0.06); lg.translate(0, 0.1, 0); K.add('paint', lg, 0xb9c6d6, { matrix: m });
      for (const dz of [-1.2, 1.2]) K.box('paint', 0x8a96a3, x - 0.12, x + 0.12, RT, RT + 1.6 - dz * 0.45, z + dz - 0.12, z + dz + 0.12);
    }
  }
  // the turbine mast
  const wx = 8; const wz = 6;
  K.turned('body', 0xc7cfd8, [[0, 0], [2.4, 0], [2.4, 0.6], [0.9, 1.4], [0.55, 4.5], [0, 4.6]], wx, RT, wz, { sides: 20 });
  K.cyl('glow', FUTURE.glowPink, wx, wz, RT + 1.5, RT + 1.8, 1.6, { sides: 20, r2: 1.2 });

  const group = new THREE.Group();
  group.add(K.mesh('body', { tile: 'panel', rough: 0.5, bump: 0.25 }));
  const pm = K.mesh('paint', { rough: 0.62 });
  pm.material.map = new THREE.CanvasTexture(cropCanvas(7));
  pm.material.map.colorSpace = THREE.SRGBColorSpace; pm.material.map.wrapS = THREE.RepeatWrapping; pm.material.map.anisotropy = 8;
  group.add(pm);
  group.add(K.mesh('clear', { clear: true, opacity: 0.17, rough: 0.08, metal: 0.1 }));
  group.add(K.mesh('glow', { glow: true }));

  // a vertical-axis wind turbine: three twisted blades round a shaft, turning about +Y
  const rotor = new THREE.Group();
  rotor.position.set(wx, RT + 4.5, wz);
  const RK = new Kit(43);
  RK.cyl('rotor', 0xdfe6ee, 0, 0, 0, 9.0, 0.35, { sides: 12 });
  for (let b = 0; b < 3; b++) {
    const pts = []; const radii = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10; const a = (b * Math.PI * 2) / 3 + t * Math.PI * 0.75;
      const r = 3.0 * Math.sin(Math.PI * (0.12 + t * 0.76));
      pts.push([Math.cos(a) * r, 0.6 + t * 8.2, Math.sin(a) * r]); radii.push(0.42);
    }
    RK.tube('rotor', b === 0 ? FUTURE.magenta : b === 1 ? FUTURE.sky : FUTURE.lime, pts, radii, { sides: 8, steps: 18, round: 1, section: () => [1, 0.22], frame: (t, p) => [p[0], 0, p[2]] });
    const a0 = (b * Math.PI * 2) / 3; const a1 = a0 + Math.PI * 0.75;
    for (const [a, y] of [[a0 + 0.17, 1.6], [a1 - 0.17, 8.0]]) RK.rod('rotor', 0xdfe6ee, [0, y, 0], [Math.cos(a) * 1.5, y, Math.sin(a) * 1.5], 0.09, { sides: 6 });
  }
  RK.ball('rotor', 0xffffff, 0, 9.1, 0, 0.55, { w: 10, h: 6 });
  rotor.add(RK.mesh('rotor', { rough: 0.45 }));
  group.add(rotor);
  group.userData.tick = {
    update(dt) { rotor.rotation.y += clampDt(dt) * (reducedMotion() ? 0.08 : 1.1); },
    dispose() {},
  };
  return group;
}


// =============================================================================================
// forest-tower
// =============================================================================================
// Eleven storeys of flats round a glass core, every floor wrapped in a white balcony whose plan
// swells into two lobes. The lobes turn a quarter turn from one floor to the next, so the
// balconies step in and out up the tower and a tree on a lobe has open air above it: the floor
// over it is pulled back at exactly that bearing. Trees stand only on lobes; the corners take
// shrubs, which fit under the floor above.

function forestTower() {
  const K = new Kit(52);
  const rng = K.rng;
  const FLOORS = 11; const H = 8.9; const L0 = 0.5;
  const LOBBY = 4.2; // the ground floor is that much taller than the rest
  const level = (i) => (i === 0 ? L0 : L0 + LOBBY + i * H);
  const ROOF = level(FLOORS);
  const N = 32;
  const CORE = 12;
  const core = (a) => squircle(a, CORE, 4);
  const phase = (i) => (i % 2 === 0 ? 0 : Math.PI); // lobes on +-X, then on +-Z
  const edge = (i) => (a) => Math.min(squircle(a, 19.0, 8), core(a) + 2.6 + 4.4 * Math.pow((1 + Math.cos(2 * a + phase(i))) / 2, 2));
  const white = 0xdfe4ea;
  const leaf = K.bag('leaf');
  const LEAVES = [0x3fa34d, 0x4fb548, 0x2f8f4a, 0x6cc04a, 0x3a9a5c];
  const BLOOMS = [FUTURE.magenta, FUTURE.sun, FUTURE.coral, 0xb07cf0];
  // A round-crowned tree. Its crown leans in toward the tower's axis by `inward` feet, so a tree
  // on the very edge of a balcony still keeps its crown inside the 40ft footprint.
  const tree = (x, y, z, s, inward = 0) => {
    const r = Math.hypot(x, z) || 1; const ix = (-x / r) * inward; const iz = (-z / r) * inward;
    const cx = x + ix; const cz = z + iz;
    K.tube('paint', 0x6b4a33, [[x, y - 0.3, z], [x + ix * 0.3, y + 2.4 * s, z + iz * 0.3], [cx, y + 4.8 * s, cz]], [0.36 * s, 0.26 * s, 0.2 * s], { sides: 5, steps: 4, round: 0 });
    const c = LEAVES[Math.floor(rng() * LEAVES.length)];
    addColored(K, 'leaf', blob([cx, y + 6.5 * s, cz], 2.5 * s, { squash: 0.85, detail: 1, ph: rng() * 9, base: c }));
    addColored(K, 'leaf', blob([cx + (rng() - 0.5) * 1.4, y + 5.1 * s, cz + (rng() - 0.5) * 1.4], 1.8 * s, { squash: 0.8, detail: 1, ph: rng() * 9, base: shade(c, 1.12) }));
  };
  // a small tree that stays under the balcony above
  const sapling = (x, y, z, s) => {
    K.tube('paint', 0x6b4a33, [[x, y - 0.3, z], [x, y + 2.2 * s, z]], [0.2 * s, 0.14 * s], { sides: 5, steps: 1, round: 0 });
    const c = LEAVES[Math.floor(rng() * LEAVES.length)];
    addColored(K, 'leaf', blob([x, y + 3.3 * s, z], 1.5 * s, { squash: 0.9, detail: 1, ph: rng() * 9, base: shade(c, 1.05) }));
  };
  const shrub = (x, y, z, s, bloom) => {
    const c = bloom ? BLOOMS[Math.floor(rng() * BLOOMS.length)] : LEAVES[Math.floor(rng() * LEAVES.length)];
    addColored(K, 'leaf', blob([x, y + 0.55 * s, z], 1.0 * s, { squash: 0.75, detail: 1, ph: rng() * 9, base: c, under: 0.7 }));
  };
  // A planter's whole run of low planting as one lumpy hedge that follows the balcony round,
  // spotted with flowers, with trailing plants spilling over the lip.
  const hedge = (fn, y, ph) => {
    const pts = []; const radii = []; const M = 26;
    for (let k = 0; k <= M; k++) {
      const a = (k / M) * Math.PI * 2; const r = fn(a) - 0.95;
      pts.push([Math.cos(a) * r, y + 0.35, Math.sin(a) * r]);
      radii.push(1.08 + 0.3 * Math.sin(k * 2.7 + ph) * Math.sin(k * 1.3));
    }
    const bloomAt = (x, z) => { const a = Math.atan2(z, x); return Math.sin(a * 7 + ph) * Math.sin(a * 3 - ph); };
    K.tube('leaf', 0x4fae48, pts, radii, { sides: 6, steps: 54, round: 0, section: () => [0.85, 1.1], feet: [3, 3], tint: (x, yy, z, out, nx, ny) => {
      const b = bloomAt(x, z); const up = Math.max(0, ny);
      const g = 0.78 + 0.3 * up + 0.08 * Math.sin(x * 2.1 + z * 1.7);
      if (b > 0.55 && up > 0.3) { const c = col(BLOOMS[Math.floor((b * 13 + ph) % BLOOMS.length)]); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; } else { out[0] *= g; out[1] *= g; out[2] *= g; }
    } });
  };

  // ---- foundation and ground floor -------------------------------------------------------
  K.slab('body', white, polar(N, (a) => Math.min(squircle(a, 19.9, 8), core(a) + 3.2)), BASE, L0, { feet: [4, 4] });
  for (let i = 0; i <= FLOORS; i++) {
    const y = level(i);
    const plan = polar(N, edge(i));
    if (i > 0) {
      K.slab('body', white, plan, y - 0.9, y, { feet: [4, 4] });
      // a warm light line under the balcony's edge
      K.slab('glow', 0xffcf7a, polar(N, (a) => edge(i)(a) + 0.03), y - 0.85, y - 0.62, { holes: [polar(N, (a) => edge(i)(a) - 0.25)] });
    }
    if (i === 0 || i === FLOORS) continue;
    // the planter: a white lip and a band of soil, all the way round
    K.slab('body', white, plan, y, y + 2.6, { holes: [polar(N, (a) => edge(i)(a) - 1.9)], feet: [4, 4] });
    // a big tree on each lobe, which has open air above it, and saplings and a hedge everywhere else
    hedge(edge(i), y + 2.4, i * 1.7);
    for (const side of [0, 1]) {
      const a = (phase(i) === 0 ? 0 : Math.PI / 2) + side * Math.PI;
      const r = edge(i)(a) - 1.05;
      tree(Math.cos(a) * r, y + 2.4, Math.sin(a) * r, 1.05 + rng() * 0.15, 1.2);
      for (const d of [-0.62, 0.62]) {
        const b = a + d + (rng() - 0.5) * 0.1; const rb = edge(i)(b) - 1.1;
        sapling(Math.cos(b) * rb, y + 2.4, Math.sin(b) * rb, 0.95 + rng() * 0.2);
      }
    }
  }

  // ---- the core: glass bands between white floor edges, with fins ------------------------
  const corePlan = polar(N, core);
  for (let i = 0; i < FLOORS; i++) {
    const y0 = level(i); const y1 = level(i + 1) - 0.9;
    K.slab('glass', i === 0 ? 0x4f7f9c : 0x2f5f80, corePlan, y0, y1, { tint: (x, y, z, out) => { const k = 0.78 + 0.5 * Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); out[0] *= k; out[1] *= k; out[2] *= k * 1.05; } });
  }
  // fins every 22.5 degrees, and lit windows between some of them
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const r = core(a) + 0.12;
    const g = new THREE.BoxGeometry(0.34, ROOF - L0, 0.55);
    g.rotateY(-a + Math.PI / 2); g.translate(Math.cos(a) * r, (ROOF + L0) / 2, Math.sin(a) * r);
    K.add('body', g, shade(white, 0.96), { feet: [4, 4] });
  }
  for (let i = 1; i < FLOORS; i++) {
    for (let k = 0; k < 16; k++) {
      if (rng() > 0.3) continue;
      const a = ((k + 0.5) / 16) * Math.PI * 2;
      const r = core(a) + 0.04;
      const w = r * Math.PI * 2 / 16 * 0.62;
      const g = new THREE.BoxGeometry(w, 5.6, 0.1);
      g.rotateY(-a + Math.PI / 2); g.translate(Math.cos(a) * r, level(i) + 3.5, Math.sin(a) * r);
      K.add('glow', g, rng() < 0.5 ? 0xffd889 : 0xffe9b8);
    }
  }

  // ---- the entrance, front (+Z) ----------------------------------------------------------
  const FZ = core(Math.PI / 2);
  K.box('paint', 0x23465f, -3.4, 3.4, L0, L0 + 8.4, FZ - 0.1, FZ + 0.12);
  K.box('paint', 0xe8edf2, -0.07, 0.07, L0, L0 + 8.4, FZ, FZ + 0.18);
  for (const x of [-3.75, 3.75]) K.box('body', white, x - 0.35, x + 0.35, L0, L0 + 9.0, FZ - 0.2, FZ + 0.4);
  K.box('glow', FUTURE.glowLime, -3.4, 3.4, L0 + 8.4, L0 + 8.6, FZ + 0.12, FZ + 0.4);
  const signRect = K.atlas.sign('GREENWOOD', 5, { px: 70, bg: '#1d4a2e', fg: '#c9ff8a', fill: 0.62 });
  {
    const g = new THREE.BoxGeometry(11, 2.2, 0.3); g.translate(0, L0 + 10.3, FZ + 0.3);
    K.add('glow', g, 0xffffff, { sign: signRect });
  }
  // ground-floor planters either side of the door
  for (const sx of [-1, 1]) {
    K.box('body', white, sx * 6 - 1.8, sx * 6 + 1.8, L0, L0 + 2.2, FZ + 0.8, FZ + 3.6, { feet: [4, 4] });
    K.box('paint', 0x5a3e2b, sx * 6 - 1.6, sx * 6 + 1.6, L0 + 2.0, L0 + 2.3, FZ + 1.0, FZ + 3.4);
    shrub(sx * 6, L0 + 2.1, FZ + 2.2, 1.3, true);
  }

  // round planters at the four corners of the plinth, each with a sapling and flowers
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2; const r = 16.2;
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    K.turned('body', white, [[0, 0], [2.3, 0], [2.5, 3.2], [2.2, 3.4], [0, 3.4]], x, BASE, z, { sides: 18, feet: [4, 4] });
    sapling(x, L0 + 2.2, z, 1.2);
    shrub(x + Math.cos(a + 1.6) * 1.2, L0 + 2.0, z + Math.sin(a + 1.6) * 1.2, 0.8, true);
    shrub(x + Math.cos(a - 1.6) * 1.2, L0 + 2.0, z + Math.sin(a - 1.6) * 1.2, 0.8, true);
  }

  // ---- the roof garden -------------------------------------------------------------------
  const RP = polar(N, edge(FLOORS));
  K.slab('body', white, RP, ROOF - 0.9, ROOF, { feet: [4, 4] });
  K.slab('body', white, RP, ROOF, ROOF + 2.4, { holes: [polar(N, (a) => edge(FLOORS)(a) - 0.4)], feet: [4, 4] });
  K.slab('paint', 0x6cb84a, polar(N, (a) => edge(FLOORS)(a) - 0.38), ROOF, ROOF + 0.9);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    tree(Math.cos(a) * 10.5, ROOF + 0.8, Math.sin(a) * 10.5, 1.0);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const r = edge(FLOORS)(a) - 1.6;
    shrub(Math.cos(a) * r, ROOF + 0.8, Math.sin(a) * r, 1.0, k % 2 === 0);
  }
  // a round pergola in the middle, hung with lights
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    K.cyl('paint', 0xf2f4f6, Math.cos(a) * 4.2, Math.sin(a) * 4.2, ROOF + 0.8, ROOF + 8.2, 0.22, { sides: 8 });
  }
  K.slab('paint', 0xf2f4f6, polar(24, () => 4.8), ROOF + 8.2, ROOF + 8.7, { holes: [polar(24, () => 3.6)] });
  K.slab('glow', 0xffd166, polar(24, () => 4.84), ROOF + 8.0, ROOF + 8.2, { holes: [polar(24, () => 3.56)] });
  K.cyl('paint', 0x8a5e3a, 0, 0, ROOF + 0.8, ROOF + 2.4, 1.6, { sides: 14 });

  const group = new THREE.Group();
  group.add(K.mesh('body', { tile: 'panel', rough: 0.5, bump: 0.2 }));
  group.add(K.mesh('glass', { rough: 0.15, metal: 0.3 }));
  group.add(K.mesh('paint', { rough: 0.8 }));
  group.add(K.mesh('leaf', { tile: 'leaf', rough: 0.85, bump: 0.8 }));
  group.add(K.mesh('glow', { glow: true }));
  return group;
}


// =============================================================================================
// printed-dome-home
// =============================================================================================
// Two printed domes joined into one home, the giant gantry printer that made them still standing
// at the front, printing a wavy garden wall. Every printed surface carries the same bead tile (an
// inch a layer) with its UVs wrapped round the dome's own axis, so the ridges run level all the way
// round and close into rings over the top, which is how a printed dome really looks.

// A dome's profile: a straight wall to `yb`, then an ellipse to the crown. Bottom-up, axis to axis.
function domeProfile(R, H, yb, rows = 16) {
  const p = [[0, BASE], [R + 0.1, BASE], [R, 0]];
  for (let k = 1; k <= rows; k++) {
    const t = k / rows;
    const y = yb + (H - yb) * Math.sin((t * Math.PI) / 2);
    const r = R * Math.sqrt(Math.max(0, 1 - ((y - yb) / (H - yb)) ** 2));
    if (k === 1) p.push([R, yb * 0.5]);
    p.push([k === rows ? 0 : r, y]);
  }
  return p;
}
const domeR = (R, H, yb, y) => (y <= yb ? R : R * Math.sqrt(Math.max(0, 1 - ((y - yb) / (H - yb)) ** 2)));

const PRINT_WALL = { x0: 1.85, x1: 13.85, z: 8.4, h: 2.5 };
const wallZ = (x) => PRINT_WALL.z + 0.9 * Math.sin((x - PRINT_WALL.x0) * 0.62);

function printedDomeHome() {
  const K = new Kit(63);
  const D1 = { x: -7.75, z: -4.8, R: 9.5, H: 14, yb: 4.5, color: 0xe6b98f };
  const D2 = { x: 3.65, z: -3.0, R: 5.8, H: 9.2, yb: 3.2, color: 0x9fd6c3 };
  const glass = 0x26475e;

  // ---- the two domes, printed ------------------------------------------------------------
  for (const d of [D1, D2]) {
    // 96 sides: a layer line is a polygon round a faceted dome, and fewer sides show it kinked
    const geo = new THREE.LatheGeometry(domeProfile(d.R, d.H, d.yb).map(([r, y]) => new THREE.Vector2(r, y)), 96);
    geo.translate(d.x, 0, d.z);
    // u from the lathe's own unwrapped angle, so the seam column does not run from one end of the
    // tile to the other (atan2 would, and the mip spike draws a line down the back of the dome)
    { const U = geo.attributes.uv; const P = geo.attributes.position; const span = Math.round((Math.PI * 2 * d.R) / 0.6667);
      for (let i = 0; i < U.count; i++) U.setXY(i, U.getX(i) * span, P.getY(i) / 2); }
    K.add('body', geo, d.color, { keepUV: true, tint: (x, y, z, out) => {
      // a little darker at the foot, where the printer started and the rain splashes
      const k = 0.86 + 0.14 * Math.min(1, Math.max(0, (y + 0.4) / 3)); out[0] *= k; out[1] *= k; out[2] *= k;
    } });
  }
  // a skylight on the big dome's crown, and a glowing ring round it
  K.turned('paint', glass, [[0, 0], [2.0, 0], [1.9, 0.6], [1.3, 1.15], [0, 1.4]], D1.x, D1.H - 0.35, D1.z, { sides: 24 });
  K.turned('glow', FUTURE.glowCyan, [[0, 0], [2.25, 0], [2.25, 0.18], [0, 0.18]], D1.x, D1.H - 0.4, D1.z, { sides: 24 });

  // ---- round windows, built forward of the curved wall -----------------------------------
  const porthole = (d, az, y, r, ringColor) => {
    const rr = domeR(d.R, d.H, d.yb, y);
    // the normal of the profile at this height: horizontal on the wall, tipping up on the crown
    const dy = y <= d.yb ? 0 : ((y - d.yb) / (d.H - d.yb)) * (d.R / (d.H - d.yb));
    const n = new THREE.Vector3(Math.sin(az), dy, Math.cos(az)).normalize();
    const p = new THREE.Vector3(d.x + Math.sin(az) * rr, y, d.z + Math.cos(az) * rr);
    const a = p.clone().addScaledVector(n, -0.6); const b = p.clone().addScaledVector(n, 1);
    const { m } = (() => {
      const dir = b.clone().sub(a).normalize();
      let up = new THREE.Vector3(0, 1, 0); if (Math.abs(up.dot(dir)) > 0.95) up = new THREE.Vector3(1, 0, 0);
      const side = new THREE.Vector3().crossVectors(up, dir).normalize(); const up2 = new THREE.Vector3().crossVectors(dir, side);
      const mm = new THREE.Matrix4().makeBasis(side, up2, dir); mm.setPosition(a); return { m: mm };
    })();
    // frame: a thick printed collar, then the pane, then a glowing bezel
    const frame = new THREE.LatheGeometry([[0, 0], [r + 0.55, 0], [r + 0.6, 0.62], [r + 0.42, 0.95], [r + 0.05, 0.95], [r, 0.7], [0, 0.7]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
    frame.rotateX(Math.PI / 2);
    K.add('paint', frame, ringColor, { matrix: m });
    const pane = new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.1, 28); pane.rotateX(Math.PI / 2); pane.translate(0, 0, 0.74);
    K.add('paint', pane, glass, { matrix: m, tint: (x, yy, z, out) => { const k = 0.85 + 0.45 * Math.max(0, (yy - (y - r)) / (2 * r)); out[0] *= k; out[1] *= k; out[2] *= k; } });
    const bezel = new THREE.TorusGeometry(r + 0.2, 0.07, 6, 28); bezel.translate(0, 0, 0.93);
    K.add('glow', bezel, FUTURE.glowGold, { matrix: m });
  };
  const deg = Math.PI / 180;
  porthole(D1, -52 * deg, 5.0, 1.35, FUTURE.coral);
  porthole(D1, 42 * deg, 5.2, 1.0, FUTURE.sun);
  porthole(D1, -110 * deg, 5.0, 1.35, FUTURE.coral);
  porthole(D1, 175 * deg, 5.0, 1.35, FUTURE.coral);
  porthole(D1, -140 * deg, 9.6, 0.85, FUTURE.sky);
  porthole(D1, -25 * deg, 9.8, 0.85, FUTURE.sky);
  porthole(D2, 20 * deg, 4.0, 1.1, FUTURE.violet);
  porthole(D2, 95 * deg, 4.0, 1.1, FUTURE.violet);
  porthole(D2, 150 * deg, 4.0, 1.1, FUTURE.violet);

  // ---- the front door, in a printed arch -----------------------------------------------
  const DZ = D1.z + D1.R; const DX = D1.x + 1.0;
  const arch = (w, h, n = 12) => {
    const pts = [[-w / 2, 0], [w / 2, 0]];
    for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI; pts.push([Math.cos(a) * (w / 2), h - w / 2 + Math.sin(a) * (w / 2)]); }
    return pts;
  };
  {
    // the collar: a thick printed arch, standing out from the dome
    const outer = arch(6.2, 9.4, 28); const inner = arch(4.2, 7.9, 28);
    const shape = new THREE.Shape(outer.slice(1).map(([x, y]) => new THREE.Vector2(x, y)));
    shape.lineTo(-3.1, 0); shape.lineTo(-2.1, 0);
    for (const [x, y] of inner.slice(2).reverse()) shape.lineTo(x, y);
    shape.lineTo(2.1, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false, curveSegments: 1 });
    g.translate(DX, -0.4, DZ - 1.2);
    K.cylUV(g, [0.6667, 2], DX, DZ - 6, 6);
    K.add('body', g, shade(D1.color, 0.97), { keepUV: true });
    // the back of the porch, dark, then the door
    
    const leaf = arch(3.7, 7.6, 16);
    K.prism('paint', FUTURE.sun, leaf, DZ - 0.2, DZ + 0.3, { matrix: new THREE.Matrix4().makeTranslation(DX, 0.05, 0) });
    // the door's own round window and its handle
    const win = new THREE.CylinderGeometry(0.7, 0.7, 0.12, 24); win.rotateX(Math.PI / 2); win.translate(DX, 5.4, DZ + 0.33);
    K.add('paint', win, glass);
    const ring2 = new THREE.TorusGeometry(0.78, 0.08, 6, 24); ring2.translate(DX, 5.4, DZ + 0.36);
    K.add('paint', ring2, FUTURE.coral);
    K.ball('paint', 0xe8edf2, DX + 1.25, 3.4, DZ + 0.36, 0.16, { w: 10, h: 6 });
    // a glowing line round the inside of the arch
    K.tube('glow', FUTURE.glowCyan, arch(4.4, 8.05, 16).slice(2).map(([x, y]) => [DX + x, y, DZ + 0.9]), 0.08, { sides: 6, steps: 40, round: 1 });
    // a step and a round welcome mat
    K.cyl('body', shade(D1.color, 0.9), DX, DZ + 1.3, BASE, 0.22, 2.3, { sides: 28, feet: [2, 2] });
    K.cyl('paint', FUTURE.teal, DX, DZ + 1.4, 0.22, 0.27, 1.4, { sides: 24 });
  }
  // the house number, glowing, on the collar
  const num = K.atlas.sign('No. 3D', 2.4, { px: 60, bg: '#173040', fg: '#ffd166', fill: 0.6 });
  { const g = new THREE.BoxGeometry(2.2, 0.9, 0.12); g.translate(DX, 8.55, DZ + 1.02); K.add('glow', g, 0xffffff, { sign: num }); }

  // ---- the garden wall being printed --------------------------------------------------
  {
    const n = 40; const t = 0.75; const { x0, x1, h } = PRINT_WALL;
    const pos = []; const idx = [];
    // a closed band: for each station, four corners of the section (in, out at bottom and top)
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n; const z = wallZ(x);
      const dz = 0.9 * 0.62 * Math.cos((x - x0) * 0.62); const len = Math.hypot(1, dz); const nx = -dz / len; const nz = 1 / len;
      for (const [s, y] of [[-1, BASE], [-1, h], [1, h], [1, BASE]]) pos.push(x + nx * s * t / 2, y, z + nz * s * t / 2);
    }
    for (let k = 0; k < n; k++) for (let j = 0; j < 4; j++) {
      const a = k * 4 + j; const b = k * 4 + ((j + 1) % 4); const c = (k + 1) * 4 + ((j + 1) % 4); const d = (k + 1) * 4 + j;
      idx.push(a, b, c, a, c, d);
    }
    idx.push(0, 2, 1, 0, 3, 2); const e = n * 4; idx.push(e, e + 1, e + 2, e, e + 2, e + 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const ng = g.toNonIndexed(); ng.computeVertexNormals();
    const P = ng.attributes.position; const uv = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) { uv[i * 2] = P.getX(i) / 0.6667; uv[i * 2 + 1] = P.getY(i) / 2; }
    ng.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    K.add('body', ng, 0xd6c2a6, { keepUV: true });
  }

  // ---- the gantry printer --------------------------------------------------------------
  const ORANGE = 0xff8a2a; const STEEL = 0x8d9298;
  const GX0 = 0.05; const GX1 = 15.65; const GZ = PRINT_WALL.z; const BEAM = 8.6;
  for (const x of [GX0, GX1]) {
    // a rail on sleepers, the length of the wall's run
    K.box('paint', STEEL, x - 0.35, x + 0.35, 0.0, 0.45, GZ - 6, GZ + 6);
    for (let z = GZ - 5.5; z <= GZ + 5.6; z += 1.4) K.box('paint', 0x6b5a4a, x - 0.8, x + 0.8, BASE, 0.08, z - 0.22, z + 0.22);
    // a wheeled foot, an A-frame and its cross brace
    K.box('paint', 0x3d4248, x - 0.6, x + 0.6, 0.35, 1.2, GZ - 2.2, GZ + 2.2);
    for (const dz of [-1.7, 1.7]) {
      K.cyl('paint', 0x2a2d31, x, GZ + dz, 0.25, 0.95, 0.55, { sides: 14, matrix: null });
      K.bar('paint', ORANGE, [x, 1.1, GZ + dz], [x, BEAM, GZ + dz * 0.25], 0.45, 0.45);
    }
    K.bar('paint', ORANGE, [x, 4.2, GZ - 1.2], [x, 4.2, GZ + 1.2], 0.3, 0.3);
  }
  K.bar('paint', ORANGE, [GX0 - 0.5, BEAM + 0.3, GZ], [GX1 + 0.5, BEAM + 0.3, GZ], 0.9, 1.0);
  K.bar('paint', 0xffc23d, [GX0 - 0.45, BEAM - 0.25, GZ], [GX1 + 0.45, BEAM - 0.25, GZ], 0.6, 0.12);
  // the control cabinet on the right leg, with a glowing screen
  K.box('paint', 0xe8edf2, GX1 + 0.4, GX1 + 1.6, 1.2, 4.2, GZ + 1.6, GZ + 3.0);
  K.box('glow', 0x5cf2ff, GX1 + 1.6, GX1 + 1.66, 2.6, 3.8, GZ + 1.8, GZ + 2.8);
  K.box('glow', 0xb6ff5c, GX1 + 1.6, GX1 + 1.66, 1.8, 2.1, GZ + 1.9, GZ + 2.2);
  K.box('glow', 0xff5ccf, GX1 + 1.6, GX1 + 1.66, 1.8, 2.1, GZ + 2.4, GZ + 2.7);
  // a sign on the beam
  const pr = K.atlas.sign('PRINTBOT', 5, { px: 60, bg: '#2a2d31', fg: '#ffc23d', fill: 0.62 });
  { const g = new THREE.BoxGeometry(5.0, 1.0, 0.1); g.translate(GX1 - 3.4, BEAM + 0.3, GZ + 0.5); K.add('glow', g, 0xffffff, { sign: pr }); }
  // a hopper of printing mix on the left leg, with its hose up to the beam
  K.turned('paint', 0x2fa3d8, [[0, 0], [0.5, 0], [1.4, 1.4], [1.4, 3.0], [0, 3.0]], GX0 - 1.8, 0.0, GZ - 2.6, { sides: 18 });
  K.tube('paint', 0x2a2d31, [[GX0 - 1.8, 3.0, GZ - 2.6], [GX0 - 1.5, 6.5, GZ - 1.5], [GX0 - 0.6, BEAM + 0.9, GZ - 0.6], [GX0 + 1.5, BEAM + 0.85, GZ - 0.55]], 0.16, { sides: 6, steps: 16 });

  const group = new THREE.Group();
  group.add(K.mesh('body', { tile: 'layer', rough: 0.85, bump: 1.4 }));
  group.add(K.mesh('paint', { rough: 0.5, metal: 0.2 }));
  group.add(K.mesh('glow', { glow: true }));

  // the print head: a carriage on the beam, a ram down to the nozzle, and a hot glowing tip
  const head = new THREE.Group();
  const HK = new Kit(64);
  HK.box('head', 0xe8edf2, -0.9, 0.9, BEAM - 0.8, BEAM + 1.2, -0.9, 0.9);
  HK.box('head', 0x2a2d31, -0.95, 0.95, BEAM - 0.5, BEAM - 0.3, -0.95, 0.95);
  HK.cyl('head', 0x8d9298, 0, 0, PRINT_WALL.h + 0.8, BEAM - 0.7, 0.28, { sides: 12 });
  HK.turned('head', 0x3d4248, [[0, 0], [0.18, 0], [0.55, 0.6], [0.6, 1.1], [0, 1.1]], 0, PRINT_WALL.h + 0.25, 0, { sides: 14 });
  HK.ball('hglow', 0xff7a2e, 0, PRINT_WALL.h + 0.22, 0, 0.2, { w: 10, h: 6 });
  HK.box('hglow', 0x5cf2ff, -0.92, 0.92, BEAM + 0.3, BEAM + 0.5, 0.9, 0.95);
  head.add(HK.mesh('head', { rough: 0.45, metal: 0.25 }));
  head.add(HK.mesh('hglow', { glow: true }));
  group.add(head);
  let t = 0;
  const place = () => {
    const u = 0.5 - 0.5 * Math.cos(t * 0.32); // there and back, easing at each end
    const x = PRINT_WALL.x0 + 0.4 + (PRINT_WALL.x1 - PRINT_WALL.x0 - 0.8) * u;
    head.position.set(x, 0, wallZ(x));
  };
  place();
  group.userData.tick = {
    update(dt) { t += clampDt(dt) * (reducedMotion() ? 0.08 : 1); place(); },
    dispose() {},
  };
  return group;
}


// =============================================================================================
// floating-home
// =============================================================================================
// A canal 30ft square with a stone edge, and a two-storey home on a hollow pontoon floating in it.
// The house, its deck and its pontoon are one inner group that bobs a few hundredths of a foot;
// the canal, the dock and the kayak stay put. A glowing strip at the pontoon's waterline marks
// how deep it floats, which is what the card's question is about.

function floatingHome() {
  const K = new Kit(74);
  const F = new Kit(75); // what floats
  const rng = K.rng;
  const HALF = 15; const IN = 12.4; const WATER = 0.25; const COPE = 0.6;

  // ---- the canal ---------------------------------------------------------------------------
  K.slab('stone', 0xc9bfae, roundRect(HALF, HALF, 1.2, 3), BASE, COPE, { holes: [roundRect(IN, IN, 0.6, 3)], feet: [2, 2] });
  K.slab('stone', 0xb3a996, roundRect(HALF + 0.2, HALF + 0.2, 1.3, 3), COPE, COPE + 0.12, { holes: [roundRect(IN - 0.25, IN - 0.25, 0.5, 3)], feet: [2, 2] });
  K.slab('water', 0x2b8fb0, roundRect(IN + 0.1, IN + 0.1, 0.7, 3), BASE, WATER, { feet: [7, 7], tint: (x, y, z, out) => {
    // deeper colour in the middle of the canal, lighter at the edges where the stone shows through
    const e = Math.max(Math.abs(x), Math.abs(z)) / IN; const k = 0.8 + 0.35 * e * e; out[0] *= k; out[1] *= k * 1.02; out[2] *= k;
  } });
  // a few lily pads in the corner
  for (const [x, z, r] of [[-10.2, 9.6, 0.9], [-9.0, 10.6, 0.7], [-10.8, 7.9, 0.6], [10.4, -10.1, 0.8]]) {
    K.cyl('paint', 0x4fae48, x, z, WATER - 0.02, WATER + 0.05, r, { sides: 14 });
    if (r > 0.75) K.ball('paint', FUTURE.magenta, x + 0.2, WATER + 0.15, z - 0.1, 0.22, { w: 8, h: 6 });
  }

  // ---- the dock: a timber walk from the front coping to the pontoon -------------------------
  const WOOD = 0xb07a4a;
  const DOCK_Y = 1.05; const DX0 = 2.0; const DX1 = 6.0;
  for (let z = 7.0; z < HALF - 0.1; z += 0.62) K.box('paint', WOOD * 1 === WOOD ? (Math.floor(z * 3) % 2 ? 0xb07a4a : 0xa06e42) : WOOD, DX0, DX1, DOCK_Y - 0.18, DOCK_Y, z, z + 0.56);
  for (const x of [DX0 + 0.15, DX1 - 0.15]) {
    K.box('paint', 0x8a5e3a, x - 0.14, x + 0.14, DOCK_Y - 0.5, DOCK_Y - 0.18, 7.0, HALF - 0.1);
    for (const z of [7.4, 11.0]) K.cyl('paint', 0x7a5234, x, z, BASE, DOCK_Y + 2.6, 0.22, { sides: 10 });
  }
  // rope rails, and two lamp posts with glowing heads
  for (const x of [DX0 + 0.15, DX1 - 0.15]) K.tube('paint', 0xe6d3a8, [[x, DOCK_Y + 2.3, 7.4], [x, DOCK_Y + 1.9, 9.2], [x, DOCK_Y + 2.3, 11.0]], 0.05, { sides: 5, steps: 8 });
  for (const x of [DX0 - 0.35, DX1 + 0.35]) {
    K.cyl('paint', 0x2a3a46, x, HALF - 1.0, COPE, COPE + 6.0, 0.12, { sides: 8 });
    K.ball('glow', FUTURE.glowGold, x, COPE + 6.3, HALF - 1.0, 0.36, { w: 12, h: 8 });
  }
  // the kayak, moored beside the dock: a lofted hull with a dark cockpit and a paddle across it
  {
    const pts = []; const radii = [];
    for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push([10.9 + (t - 0.5) * 0.3, WATER + 0.22, 10.8 - t * 10.4]); radii.push(0.02 + 0.98 * Math.sin(Math.PI * t) ** 0.7); }
    K.tube('paint', FUTURE.coral, pts, radii, { sides: 12, steps: 30, round: 0, section: () => [0.5, 1], frame: () => [0, 1, 0], tint: (x, y, z, out) => { if (y > WATER + 0.3) { const c = col(FUTURE.sun); out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; } } });
    K.ball('paint', 0x23323f, 10.9, WATER + 0.62, 5.6, 0.55, { w: 14, h: 8, scale: [1, 0.22, 2.2] });
    K.rod('paint', 0x2a3a46, [9.0, WATER + 0.85, 4.2], [12.0, WATER + 0.85, 4.9], 0.05, { sides: 6 });
    for (const [x, z] of [[9.0, 4.2], [12.0, 4.9]]) K.ball('paint', FUTURE.sky, x, WATER + 0.85, z, 0.32, { w: 10, h: 6, scale: [1, 0.25, 0.6] });
  }

  // ---- the pontoon (floats) -------------------------------------------------------------
  const PX = 9.4; const PZ0 = -9.8; const PZ1 = 6.6; const PTOP = 1.05; const PBOT = -0.25;
  F.slab('fp', 0x3c5468, roundRect(PX, (PZ1 - PZ0) / 2, 1.2, 3).map(([x, z]) => [x, z + (PZ0 + PZ1) / 2]), PBOT, PTOP - 0.3);
  F.slab('fglow', FUTURE.glowCyan, roundRect(PX + 0.04, (PZ1 - PZ0) / 2 + 0.04, 1.24, 3).map(([x, z]) => [x, z + (PZ0 + PZ1) / 2]), WATER + 0.06, WATER + 0.22, { holes: [roundRect(PX - 0.3, (PZ1 - PZ0) / 2 - 0.3, 0.9, 3).map(([x, z]) => [x, z + (PZ0 + PZ1) / 2])] });
  // deck boards
  for (let x = -PX + 0.3; x < PX - 0.3; x += 0.62) F.box('fp', Math.floor(x * 1.6) % 2 ? 0xc48a55 : 0xb47c4a, x, x + 0.56, PTOP - 0.3, PTOP, PZ0 + 0.3, PZ1 - 0.3);

  // ---- the house (floats) ---------------------------------------------------------------
  const G0 = PTOP; const G1 = G0 + 9.2; const U1 = G1 + 8.6;
  const lower = roundRect(6.2, 4.8, 1.6, 4).map(([x, z]) => [x - 1.8, z - 3.6]);
  const upper = roundRect(6.8, 4.6, 1.6, 4).map(([x, z]) => [x + 0.6, z - 3.0]);
  const glass = 0x26475e; const frame = 0xf2f4f6;
  F.slab('fp', 0x2fb7a9, lower, G0, G1, { feet: [4, 4] });
  F.slab('fp', 0xf2f4f6, upper.map(([x, z]) => [x * 1.03, z * 1.03 - 0.0]), G1 - 0.1, G1 + 0.6);
  F.slab('fp', FUTURE.coral, upper, G1 + 0.6, U1, { feet: [4, 4] });
  F.slab('fp', 0xf2f4f6, upper.map(([x, z]) => [x * 1.03, z * 1.03]), U1, U1 + 0.45);
  // a window built forward of a wall facing `dir` (+z, -z, +x, -x) at wall coordinate w
  const win = (dir, wall, u0, u1, y0, y1, lit = false) => {
    const m = new THREE.Matrix4().makeRotationY({ z: 0, nz: Math.PI, x: Math.PI / 2, nx: -Math.PI / 2 }[dir]);
    m.setPosition(dir === 'z' ? 0 : dir === 'nz' ? 0 : wall, 0, dir === 'z' ? wall : dir === 'nz' ? wall : 0);
    const b = (bag, c, a0, a1, b0, b1, n0, n1, tint) => { const g = new THREE.BoxGeometry(a1 - a0, b1 - b0, n1 - n0); g.translate((a0 + a1) / 2, (b0 + b1) / 2, (n0 + n1) / 2); F.add(bag, g, c, { matrix: m, tint }); };
    const sky = (x, y, z, out) => { const k = 0.8 + 0.6 * Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); out[0] *= k; out[1] *= k; out[2] *= k * 1.05; };
    b(lit ? 'fglow' : 'fp', lit ? 0xffc96b : glass, u0, u1, y0, y1, -0.1, 0.06, lit ? null : sky);
    for (const [a0, a1, b0, b1] of [[u0 - 0.25, u0, y0, y1], [u1, u1 + 0.25, y0, y1], [u0 - 0.25, u1 + 0.25, y1, y1 + 0.25], [u0 - 0.35, u1 + 0.35, y0 - 0.25, y0]]) b('fp', frame, a0, a1, b0, b1, -0.1, 0.2);
    const mid = (u0 + u1) / 2; if (u1 - u0 > 4) b('fp', frame, mid - 0.08, mid + 0.08, y0, y1, -0.05, 0.14);
  };
  // the front (+Z): a big window and the door below; a long window above, behind the balcony
  const LF = 1.2; const UF = 1.6; // front walls of the two storeys
  win('z', LF, -7.0, -2.0, G0 + 2.2, G0 + 7.6, true);
  win('z', UF, -4.8, 6.0, G1 + 2.0, G1 + 7.4);
  win('nz', -8.4, -4.5, 3.5, G0 + 2.6, G0 + 7.4);
  win('nz', -7.6, -6.5, 3.0, G1 + 2.6, G1 + 7.0, true);
  win('x', 7.4, -1.5, 3.5, G1 + 2.6, G1 + 7.0);
  win('nx', -8.0, -2.5, 2.0, G0 + 2.6, G0 + 7.0);
  // the front door, yellow, with a round window and a canopy
  F.box('fp', FUTURE.sun, -0.2, 3.2, G0, G0 + 7.4, LF - 0.05, LF + 0.16);
  F.box('fp', frame, -0.45, 3.45, G0 + 7.4, G0 + 7.7, LF - 0.05, LF + 0.3);
  { const g = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20); g.rotateX(Math.PI / 2); g.translate(1.5, G0 + 5.4, LF + 0.2); F.add('fp', g, glass); }
  F.ball('fp', 0xf2f4f6, 2.75, G0 + 3.4, LF + 0.25, 0.13, { w: 8, h: 6 });
  F.box('fp', 0xf2f4f6, -0.8, 3.8, G0 + 8.3, G0 + 8.55, LF - 0.05, LF + 2.4);
  F.box('fglow', 0xfff0b0, -0.6, 3.6, G0 + 8.26, G0 + 8.31, LF + 0.2, LF + 2.2);
  // the upper floor's balcony over the deck, with a white rail
  F.box('fp', 0xf2f4f6, -5.6, 7.0, G1 + 0.1, G1 + 0.6, UF, UF + 3.4);
  F.box('fglow', FUTURE.glowCyan, -5.6, 7.0, G1 + 0.12, G1 + 0.32, UF + 3.4, UF + 3.46);
  for (const [a, b] of [[[-5.5, UF + 3.3], [6.9, UF + 3.3]], [[-5.5, UF], [-5.5, UF + 3.3]], [[6.9, UF], [6.9, UF + 3.3]]]) {
    F.bar('fp', 0xf2f4f6, [a[0], G1 + 3.9, a[1]], [b[0], G1 + 3.9, b[1]], 0.18, 0.14);
    const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.9));
    for (let k = 0; k <= n; k++) { const t = k / n; const x = a[0] + (b[0] - a[0]) * t; const z = a[1] + (b[1] - a[1]) * t; F.box('fp', 0xf2f4f6, x - 0.05, x + 0.05, G1 + 0.6, G1 + 3.9, z - 0.05, z + 0.05); }
  }
  // the roof: a frame tipped to the south carrying solar panels
  const RY = U1 + 0.45;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 2; r++) {
      const x = -4.6 + c * 3.4; const z = -5.5 + r * 4.2;
      const m = new THREE.Matrix4().makeTranslation(x, RY + 1.2 + r * 0.0, z).multiply(new THREE.Matrix4().makeRotationX(0.32));
      F.add('fp', new THREE.BoxGeometry(3.2, 0.16, 4.0), 0x2d4f96, { matrix: m });
      for (let k = -1; k <= 1; k++) { const g = new THREE.BoxGeometry(0.05, 0.04, 3.9); g.translate(k * 0.8, 0.09, 0); F.add('fp', g, 0xbfcbdb, { matrix: m }); }
      for (let k = -1; k <= 1; k++) { const g = new THREE.BoxGeometry(3.1, 0.04, 0.05); g.translate(0, 0.09, k * 1.0); F.add('fp', g, 0xbfcbdb, { matrix: m }); }
      for (const dz of [-1.5, 1.5]) F.box('fp', 0x8a96a3, x - 0.08, x + 0.08, RY, RY + 1.2 - dz * 0.33, z + dz - 0.08, z + dz + 0.08);
    }
  }
  // deck life: two planters, a pair of chairs, a round table and a string of lights
  for (const [x, z, c] of [[-8.0, 4.6, FUTURE.magenta], [8.2, -8.6, FUTURE.sun]]) {
    F.turned('fp', 0xf2f4f6, [[0, 0], [0.8, 0], [1.0, 1.5], [0, 1.5]], x, PTOP, z, { sides: 14 });
    const g = blob([x, PTOP + 2.1, z], 1.0, { squash: 0.9, detail: 1, ph: rng() * 9, base: 0x4fae48 }); addColored(F, 'fp', g);
    F.ball('fp', c, x + 0.4, PTOP + 2.6, z + 0.5, 0.3, { w: 8, h: 6 }); F.ball('fp', c, x - 0.5, PTOP + 2.3, z + 0.3, 0.26, { w: 8, h: 6 });
  }
  for (const [x, c] of [[-6.2, FUTURE.sky], [-3.4, FUTURE.lime]]) {
    F.box('fp', c, x - 0.9, x + 0.9, PTOP + 1.4, PTOP + 1.6, 3.6, 5.2);
    F.box('fp', c, x - 0.9, x + 0.9, PTOP + 1.6, PTOP + 3.4, 5.0, 5.25);
    for (const dx of [-0.8, 0.8]) for (const dz of [3.7, 5.1]) F.box('fp', 0xf2f4f6, x + dx - 0.06, x + dx + 0.06, PTOP, PTOP + 1.45, dz - 0.06, dz + 0.06);
  }
  F.cyl('fp', 0xf2f4f6, -4.8, 3.2, PTOP, PTOP + 2.5, 0.12, { sides: 8 });
  F.cyl('fp', 0xf2f4f6, -4.8, 3.2, PTOP + 2.5, PTOP + 2.65, 1.1, { sides: 18 });
  for (let k = 0; k <= 8; k++) {
    const t = k / 8; const x = -8.8 + t * 8.0; const y = G1 - 0.6 - Math.sin(Math.PI * t) * 1.1;
    F.ball('fglow', [FUTURE.glowGold, FUTURE.glowPink, FUTURE.glowCyan][k % 3], x, y, 6.2, 0.18, { w: 8, h: 6 });
  }
  F.tube('fp', 0x2a3a46, Array.from({ length: 9 }, (_, k) => { const t = k / 8; return [-8.8 + t * 8.0, G1 - 0.45 - Math.sin(Math.PI * t) * 1.1, 6.2]; }), 0.03, { sides: 4, steps: 16 });
  for (const x of [-8.8, -0.8]) F.cyl('fp', 0x2a3a46, x, 6.2, PTOP, G1 - 0.3, 0.08, { sides: 6 });

  const group = new THREE.Group();
  group.add(K.mesh('stone', { tile: 'paver', rough: 0.9, bump: 0.5 }));
  group.add(K.mesh('water', { tile: 'ripple', rough: 0.12, metal: 0.1, bump: 0.3 }));
  group.add(K.mesh('paint', { rough: 0.7 }));
  group.add(K.mesh('glow', { glow: true }));
  const float = new THREE.Group();
  float.add(F.mesh('fp', { rough: 0.6, tile: 'panel', bump: 0.15 }));
  float.add(F.mesh('fglow', { glow: true }));
  group.add(float);
  let t = 0;
  group.userData.tick = {
    update(dt) {
      t += clampDt(dt) * (reducedMotion() ? 0.1 : 1);
      float.position.y = Math.sin(t * 1.3) * 0.05;
      float.rotation.x = Math.sin(t * 0.9 + 1) * 0.004;
      float.rotation.z = Math.sin(t * 1.1) * 0.003;
    },
    dispose() {},
  };
  return group;
}


// =============================================================================================
// solar-skyscraper
// =============================================================================================
// Fourteen storeys of coloured glass on a rounded-square plan that turns a quarter turn on its
// way up, with a white floor band at every storey and a glowing line under each band. On top a
// flower of eight solar petals stands on a mast. The flower turns to face the SCENE'S OWN SUN: its
// tick finds the directional light and points the petals at it, so moving Time of Day in Look
// Around swings them round (the card's question). With no sun to find it turns slowly instead.

const SKY_FLOORS = 14; const SKY_H = 10.2; const SKY_L0 = 0.5;
const SKY_TOP = SKY_L0 + SKY_FLOORS * SKY_H;
const SKY_HALF = 17; const SKY_TWIST = Math.PI / 2;
const skyTwist = (y) => (Math.max(0, y - SKY_L0) / (SKY_TOP - SKY_L0)) * SKY_TWIST;
const skyPlan = (half, y, n = 48) => polar(n, (a) => squircle(a - skyTwist(y), half, 3.2));

function solarSkyscraper() {
  const K = new Kit(85);
  const white = 0xdde3ea;
  const BANDS = [0x22b5a8, 0x45c8e8, 0x4d8ff0, 0x7a6cf0, 0xa45cf0, 0xe04fb4, 0xff6f73, 0xff9a4d, 0xffc23d];
  const bandAt = (f) => { const t = (f / (SKY_FLOORS - 1)) * (BANDS.length - 1); const i = Math.min(BANDS.length - 2, Math.floor(t)); return blend(BANDS[i], BANDS[i + 1], t - i); };

  // ---- the twisting glass skin: one closed loft, a ring at every floor line and mid-floor ----
  {
    const N = 64; const rows = [];
    for (let f = 0; f < SKY_FLOORS; f++) { const y0 = SKY_L0 + f * SKY_H; rows.push(y0, y0 + SKY_H * 0.5); }
    rows.push(SKY_TOP);
    const pos = []; const colArr = []; const idx = [];
    for (const y of rows) {
      const f = Math.min(SKY_FLOORS - 1, Math.floor((y - SKY_L0) / SKY_H + 1e-6));
      const c = bandAt(f); const fr = ((y - SKY_L0) / SKY_H) - f;
      const k = 0.75 + 0.5 * Math.min(1, fr); // lighter toward the head of each storey, the sky in it
      for (let j = 0; j <= N; j++) {
        const a = (j / N) * Math.PI * 2; const r = squircle(a - skyTwist(y), SKY_HALF - 0.6, 3.2);
        pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
        colArr.push(c[0] * k, c[1] * k, c[2] * k);
      }
    }
    const W = N + 1;
    for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < N; j++) { const a = i * W + j; const b = a + 1; const cc = a + W + 1; const d = a + W; idx.push(a, cc, b, a, d, cc); }
    // caps
    for (const [i, top] of [[0, false], [rows.length - 1, true]]) {
      const c = pos.length / 3; pos.push(0, rows[i], 0); colArr.push(0.3, 0.3, 0.3);
      for (let j = 0; j < N; j++) { const a = i * W + j; if (top) idx.push(c, a + 1, a); else idx.push(c, a, a + 1); }
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    g = outward(g);
    K._flatUV(g, 'glass'); g.setAttribute('color', new THREE.Float32BufferAttribute(colArr.slice(0, g.attributes.position.count * 3), 3));
    // the merge keeps a part's own colour when keepColor is set
    K.bag('glass').push({ geometry: g, keepColor: true });
  }
  // mullions: white ribs that twist with the skin
  for (let m = 0; m < 16; m++) {
    const a0 = (m / 16) * Math.PI * 2; const pts = [];
    for (let k = 0; k <= 12; k++) {
      const y = SKY_L0 + ((SKY_TOP - SKY_L0) * k) / 12; const a = a0 + skyTwist(y);
      const r = squircle(a0, SKY_HALF - 0.45, 3.2);
      pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    K.tube('body', white, pts, 0.2, { sides: 4, steps: 36, round: 0 });
  }
  // floor bands, and a glowing line under each in the colour of the storey above
  for (let f = 0; f <= SKY_FLOORS; f++) {
    const y = SKY_L0 + f * SKY_H;
    const half = f === SKY_FLOORS ? SKY_HALF + 0.3 : SKY_HALF;
    K.slab('body', white, skyPlan(half, y), y - 0.7, y + 0.5, { feet: [4, 4] });
    if (f > 0 && f < SKY_FLOORS) {
      const c = blend(bandAt(f), 0xffffff, 0.4);
      K.slab('glow', c, skyPlan(SKY_HALF + 0.04, y), y - 0.95, y - 0.7, { holes: [skyPlan(SKY_HALF - 0.4, y)] });
    }
  }
  // the plinth, to the foundation line
  K.slab('body', shade(white, 0.95), skyPlan(SKY_HALF + 1.6, 0), BASE, SKY_L0 - 0.69, { feet: [4, 4] });

  // ---- the entrance (+Z), where the plan has not yet turned --------------------------------
  const FZ = SKY_HALF - 0.6;
  // a glass porch standing a foot proud of the skin, so the twisting ribs pass behind it
  K.box('glass', 0x2b5876, -4.2, 4.2, SKY_L0, SKY_L0 + 9.2, FZ - 0.6, FZ + 1.1, { tint: (x, y, z, out) => { const k = 0.8 + 0.6 * Math.max(0, (y - SKY_L0) / 9.2); out[0] *= k; out[1] *= k; out[2] *= k; } });
  K.box('body', 0xe8edf2, -0.08, 0.08, SKY_L0, SKY_L0 + 9.2, FZ + 1.0, FZ + 1.25);
  for (const x of [-4.55, 4.55]) K.box('body', white, x - 0.35, x + 0.35, SKY_L0, SKY_L0 + 9.8, FZ - 0.6, FZ + 1.5);
  K.box('body', white, -6, 6, SKY_L0 + 9.8, SKY_L0 + 10.3, FZ - 0.3, FZ + 5.0);
  K.box('glow', FUTURE.glowGold, -5.6, 5.6, SKY_L0 + 9.74, SKY_L0 + 9.8, FZ + 0.4, FZ + 4.6);
  const sign = K.atlas.sign('SUNSPIRE', 5, { px: 70, bg: '#2a1f4a', fg: '#ffd166', fill: 0.64 });
  { const g = new THREE.BoxGeometry(10, 2, 0.3); g.translate(0, SKY_L0 + 11.2, FZ + 4.85); K.add('glow', g, 0xffffff, { sign }); }

  // ---- the crown: a terrace ring, a mast and the flower's hub -----------------------------
  const TOP = SKY_TOP + 0.5;
  K.slab('body', white, skyPlan(SKY_HALF + 0.3, SKY_TOP), TOP, TOP + 2.8, { holes: [skyPlan(SKY_HALF - 0.6, SKY_TOP)], feet: [4, 4] });
  K.turned('body', white, [[0, 0], [3.4, 0], [3.4, 0.8], [1.4, 2.2], [0.9, 7.8], [1.5, 8.6], [0, 9.0]], 0, TOP, 0, { sides: 24 });
  K.cyl('glow', FUTURE.glowGold, 0, 0, TOP + 3.2, TOP + 3.6, 1.32, { sides: 20 });
  const PIVOT = TOP + 9.3;

  const group = new THREE.Group();
  group.add(K.mesh('glass', { rough: 0.14, metal: 0.35 }));
  group.add(K.mesh('body', { tile: 'panel', rough: 0.45, bump: 0.15 }));
  group.add(K.mesh('glow', { glow: true }));

  // ---- the flower: yaw, then tilt, then a slow spin about its own face ---------------------
  const yaw = new THREE.Group(); yaw.position.set(0, PIVOT, 0);
  const tilt = new THREE.Group(); yaw.add(tilt);
  const spin = new THREE.Group(); tilt.add(spin);
  const P = new Kit(86);
  P.turned('petal', 0xf2f4f6, [[0, -1.0], [1.4, -1.0], [2.6, -0.3], [2.6, 0.4], [1.6, 1.0], [0, 1.1]], 0, 0, 0, { sides: 28 });
  P.turned('pglow', FUTURE.glowGold, [[0, 0], [1.2, 0], [1.2, 0.2], [0, 0.2]], 0, 1.05, 0, { sides: 24 });
  const PETALS = 8; const L = 15.5; const CUP = 0.34;
  const outline = []; const n = 18;
  for (let k = 0; k <= n; k++) { const t = k / n; const w = 3.9 * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.25 * t); outline.push([w, t * L]); }
  for (let k = n - 1; k > 0; k--) outline.push([-outline[k][0], outline[k][1]]);
  const PET_COLORS = [FUTURE.coral, FUTURE.sun, FUTURE.magenta, FUTURE.lime];
  for (let i = 0; i < PETALS; i++) {
    const a = (i / PETALS) * Math.PI * 2;
    // petal frame: in its own (u across, v out, w up) frame, cupped up by CUP
    const m = new THREE.Matrix4().makeRotationY(-a).multiply(new THREE.Matrix4().makeTranslation(0, 0, 0)).multiply(new THREE.Matrix4().makeRotationX(CUP));
    const place = (geo) => { geo.rotateX(-Math.PI / 2); geo.translate(0, 0, -2.2); return geo; }; // outline +y -> out along -z, depth up
    // rim (coloured back) and the solar face on top
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
    const rim = place(new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false, curveSegments: 1 })); rim.translate(0, -0.1, 0);
    P.add('petal', rim, PET_COLORS[i % PET_COLORS.length], { matrix: m });
    const inner = outline.map(([x, y]) => [x * 0.82, 0.9 + y * 0.9]);
    const cell = place(new THREE.ExtrudeGeometry(new THREE.Shape(inner.map(([x, y]) => new THREE.Vector2(x, y))), { depth: 0.12, bevelEnabled: false, curveSegments: 1 }));
    cell.translate(0, 0.22, 0);
    P.add('petal', cell, 0x243f86, { matrix: m, tint: (x, y, z, out) => { const k = 0.85 + 0.3 * Math.sin(x * 3.1) * Math.sin(z * 2.3); out[0] *= k; out[1] *= k; out[2] *= k; } });
    // glowing gold veins down the cells, and a cross line every 2ft
    const vm = m.clone();
    const vb = (x0, x1, z0, z1) => { const g = new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0); g.translate((x0 + x1) / 2, 0.36, -2.2 - (z0 + z1) / 2); P.add('pglow', g, FUTURE.glowGold, { matrix: vm }); };
    vb(-0.06, 0.06, 1.4, L * 0.84);
    for (let zz = 2.4; zz < L * 0.8; zz += 2.2) {
      const y = (zz - 0.9) / 0.9; const tt = y / L;
      const w = 0.82 * 3.9 * Math.sin(Math.PI * Math.pow(tt, 0.8)) * (1 - 0.25 * tt) * 0.92;
      vb(-w, w, zz - 0.05, zz + 0.05);
    }
  }
  spin.add(P.mesh('petal', { rough: 0.35, metal: 0.25 }));
  spin.add(P.mesh('pglow', { glow: true }));
  group.add(yaw);

  // ---- following the sun -------------------------------------------------------------------
  let sun = null; let look = 0; let t = 0;
  const wp = new THREE.Vector3(); const wt = new THREE.Vector3(); const q = new THREE.Quaternion();
  const findSun = () => {
    let root = group; while (root.parent) root = root.parent;
    let found = null;
    root.traverse((o) => { if (!found && o.isDirectionalLight) found = o; });
    return found;
  };
  let yawNow = 0; let tiltNow = 0.25;
  group.userData.tick = {
    update(dt) {
      const step = clampDt(dt); t += step; look -= step;
      if ((!sun || !sun.parent) && look <= 0) { sun = findSun(); look = 2; }
      let wantYaw = yawNow + step * 0.05; let wantTilt = 0.25;
      if (sun) {
        sun.getWorldPosition(wp); sun.target.getWorldPosition(wt);
        const d = wp.sub(wt).normalize();
        group.getWorldQuaternion(q); d.applyQuaternion(q.invert());
        wantYaw = Math.atan2(d.x, d.z);
        wantTilt = Math.min(0.5, Math.max(0, Math.PI / 2 - Math.asin(Math.max(-1, Math.min(1, d.y)))));
      }
      // ease toward the sun, by the shorter way round
      let dy = wantYaw - yawNow; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const rate = reducedMotion() ? 0.15 : 0.8;
      yawNow += dy * Math.min(1, step * rate);
      tiltNow += (wantTilt - tiltNow) * Math.min(1, step * rate);
      yaw.rotation.y = yawNow; tilt.rotation.x = tiltNow;
      if (!reducedMotion()) spin.rotation.y += step * 0.05;
    },
    dispose() { sun = null; },
  };
  yaw.rotation.y = 0; tilt.rotation.x = tiltNow;
  return group;
}


// =============================================================================================
// biodome-garden
// =============================================================================================
// A 4-frequency geodesic hemisphere, 40ft across and 20ft high: white struts and hub nodes over
// ONE transparent glass mesh, the only see-through mesh in the model. A 4V icosahedral sphere
// stood on a vertex splits exactly at its equator, which is why this frequency makes a true
// half-dome with a flat ring of hubs on the ground. Inside, at ground level, a tropical garden:
// palms, big-leaved plants and flowers, a rock pile with a glowing waterfall into a pool, and a
// path from the doorway, which is a real opening in the frame.

function biodomeGarden() {
  const K = new Kit(96);
  const rng = K.rng;
  const R = 20; const RING = 0.6;
  const garden = K.bag('garden');

  // ---- the geodesic hemisphere ------------------------------------------------------------
  const ico = new THREE.IcosahedronGeometry(1, 3);
  const tg = (1 + Math.sqrt(5)) / 2;
  ico.rotateX(-Math.atan2(tg, 1)); // a vertex straight up
  // the icosahedron's vertex (0, 1, t) is now on +Y; turn it so a pentagon edge faces the door
  ico.rotateY(Math.PI / 10);
  const P = ico.attributes.position;
  const key = (v) => `${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
  const faces = [];
  for (let i = 0; i < P.count; i += 3) {
    const tri = [0, 1, 2].map((k) => new THREE.Vector3(P.getX(i + k), P.getY(i + k), P.getZ(i + k)));
    for (const v of tri) { if (Math.abs(v.y) < 0.02) v.y = 0; }
    const c = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3);
    if (c.y <= 0.01) continue;
    faces.push({ tri, c });
  }
  // the doorway: faces low on the +Z side come out, and a portal frames the hole
  const DOOR_W = 7.5; const DOOR_H = 10.5;
  const inDoor = (c) => c.z > 0 && Math.abs(c.x * R) < DOOR_W * 0.5 && c.y * R < DOOR_H * 0.92;
  const kept = faces.filter((f) => !inDoor(f.c));
  const removed = faces.filter((f) => inDoor(f.c));
  let holeX = 0; let holeY = 0; let holeZ = R;
  for (const f of removed) for (const v of f.tri) { holeX = Math.max(holeX, Math.abs(v.x * R)); holeY = Math.max(holeY, v.y * R); holeZ = Math.min(holeZ, v.z * R); }
  // the portal's size, and the volume it fills: nothing of the dome may stand inside it
  const PW = Math.max(holeX + 0.8, DOOR_W / 2 + 2.0); const PH = Math.max(holeY + 0.8, DOOR_H + 2.2);
  const PZ0 = holeZ - 1.0; const PZ1 = R + 2.2;
  const inPortal = (x, y, z) => z > PZ0 - 0.2 && Math.abs(x) < PW + 0.2 && y < PH - PW + Math.sqrt(Math.max(0, PW * PW - x * x)) + 0.2;
  for (let i = kept.length - 1; i >= 0; i--) { const c = kept[i].c; if (inPortal(c.x * R, c.y * R + RING, c.z * R)) kept.splice(i, 1); }
  const lift = (v, r = R) => new THREE.Vector3(v.x * r, v.y * r + RING, v.z * r);

  // glass: one panel per face, a hair inside the struts, a few of them stained
  {
    const pos = []; const colArr = [];
    const STAIN = [0x7fe0ff, 0xb6ff8a, 0xffd36b, 0xff8fd8, 0xb79bff];
    for (const f of kept) {
      const tint = rng() < 0.22 ? col(STAIN[Math.floor(rng() * STAIN.length)]) : col(0xc9f4ff);
      for (const v of f.tri) { const p = lift(v, R - 0.08); pos.push(p.x, p.y, p.z); colArr.push(tint[0], tint[1], tint[2]); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const fixed = outward(g);
    fixed.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
    K._flatUV(fixed, 'clear');
    K.bag('clear').push({ geometry: fixed, keepColor: true });
  }
  // struts on every edge of a kept face, hubs on every vertex
  const edges = new Map(); const hubs = new Map();
  for (const f of kept) {
    for (let k = 0; k < 3; k++) {
      const a = f.tri[k]; const b = f.tri[(k + 1) % 3];
      const ka = key(a); const kb = key(b);
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!edges.has(ek)) edges.set(ek, [a, b]);
      hubs.set(ka, a);
    }
  }
  const white = 0xeef1f4;
  for (const [a, b] of edges.values()) {
    const A = lift(a, R + 0.04); const B = lift(b, R + 0.04);
    if (A.y < RING + 0.05 && B.y < RING + 0.05) continue; // the base ring does this job
    const M = A.clone().add(B).multiplyScalar(0.5);
    if (inPortal(M.x, M.y, M.z)) continue;
    K.bar('frame', white, [A.x, A.y, A.z], [B.x, B.y, B.z], 0.3, 0.3, { up: [A.x, A.y - RING, A.z] });
  }
  for (const v of hubs.values()) { const p = lift(v, R + 0.06); if (inPortal(p.x, p.y, p.z)) continue; K.ball('frame', 0xd9dee4, p.x, p.y, p.z, 0.42, { detail: 0 }); }
  // the base ring: a low white kerb all the way round, open at the door, with a glowing line
  const arcPts = (r, a0, a1, n) => { const out = []; for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; out.push([Math.sin(a) * r, Math.cos(a) * r]); } return out; };
  const gap = Math.asin(Math.min(0.99, (holeX + 0.6) / R));
  {
    const outer = arcPts(R + 0.6, gap, Math.PI * 2 - gap, 72); const inner = arcPts(R - 0.6, Math.PI * 2 - gap, gap, 72);
    K.slab('frame', 0xd2d8de, [...outer, ...inner], BASE, RING, { feet: [4, 4] });
    const go = arcPts(R + 0.64, gap, Math.PI * 2 - gap, 72); const gi = arcPts(R + 0.5, Math.PI * 2 - gap, gap, 72);
    K.slab('glow', FUTURE.glowCyan, [...go, ...gi], RING - 0.32, RING - 0.12);
  }

  // ---- the portal --------------------------------------------------------------------------
  const archPts = (hw, h, n = 14, flat = 0) => {
    const pts = [[hw, 0]];
    const rr = hw;
    for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI; pts.push([Math.cos(a) * rr, h - rr + flat + Math.sin(a) * rr]); }
    pts.push([-hw, 0]);
    return pts;
  };
  {
    const o = archPts(PW, PH); const i = archPts(DOOR_W / 2, DOOR_H).reverse();
    const shape = new THREE.Shape(o.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const [x, y] of i) shape.lineTo(x, y);
    const z0 = PZ0; const z1 = PZ1;
    // a floor through the portal, level with the garden's
    K.box('rock', 0xcfc6b5, -DOOR_W / 2 - 0.1, DOOR_W / 2 + 0.1, BASE, 0.1, z0, z1, { feet: [2, 2] });
    const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, BASE, z0);
    K.add('frame', g, white, { feet: [4, 4] });
    // a glowing line round the doorway, front and back
    for (const z of [z1 + 0.06, z0 - 0.06]) {
      K.tube('glow', FUTURE.glowLime, archPts(DOOR_W / 2 + 0.2, DOOR_H + 0.2, 20).slice(1, -1).map(([x, y]) => [x, y + BASE, z]), 0.1, { sides: 6, steps: 40, round: 1 });
    }
    const sign = K.atlas.sign('BIODOME', 4.2, { px: 64, bg: '#173a2a', fg: '#b6ff5c', fill: 0.62 });
    const sg = new THREE.BoxGeometry(7.5, 1.8, 0.2); sg.translate(0, PH - PW * 0.32, z1 + 0.12);
    K.add('glow', sg, 0xffffff, { sign });
  }

  // ---- the floor: soil and moss, with a pale path ----------------------------------------
  {
    // a closed lathe with a ring of vertices every 1.5ft across its top, so the paint has a mesh
    const prof = [[0, BASE], [R - 0.5, BASE], [R - 0.5, 0.1]];
    for (let r = R - 2; r > 0.5; r -= 1.5) prof.push([r, 0.1]);
    prof.push([0, 0.1]);
    const thick = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 64);
    // moss and ground cover, with patches of dark soil showing through
    const moss = col(0x5a9a3c); const soil = col(0x6f5a3e);
    K.add('rock', thick, 0x5a9a3c, { tint: (x, y, z, out) => {
      const n = Math.sin(x * 0.55 + 1.3) * Math.cos(z * 0.47) + 0.6 * Math.sin(x * 1.3 - z * 1.1);
      const t = Math.max(0, Math.min(1, 0.5 + n * 0.6)); const k = 0.9 + 0.15 * Math.sin(x * 2.1 + z * 1.7);
      for (let c = 0; c < 3; c++) out[c] = (soil[c] + (moss[c] - soil[c]) * t) * k;
    } });
  }
  // the path: stepping pavers from the door to the pool and round it
  const pathPts = []; for (let k = 0; k <= 26; k++) { const t = k / 26; pathPts.push([Math.sin(t * 2.6) * 3.2 * (1 - t) - t * 5.5, R + 1.6 - t * 18.5]); }
  for (const [x, z] of pathPts) K.cyl('rock', 0xcfc6b5, x + (rng() - 0.5) * 0.3, z, -0.1, 0.12, 1.25 + rng() * 0.25, { sides: 9 });

  // ---- rocks, the waterfall and the pool -------------------------------------------------
  const rock = (x, y, z, r, sq = 0.75) => {
    let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
    const Q = g.attributes.position; const ph = rng() * 9;
    for (let i = 0; i < Q.count; i++) { const d = new THREE.Vector3(Q.getX(i), Q.getY(i), Q.getZ(i)).normalize(); const k = 1 + 0.22 * Math.sin(d.x * 4 + ph) * Math.cos(d.z * 3.4 - ph); Q.setXYZ(i, x + d.x * r * k, y + d.y * r * k * sq, z + d.z * r * k); }
    g.computeVertexNormals();
    const shadeC = 0.85 + rng() * 0.25;
    K.add('rock', g, shade(0x8d877e, shadeC), { tint: (px, py, pz, out, nx, ny) => { if (ny > 0.55) { const m = col(0x5b8f3c); out[0] = m[0]; out[1] = m[1]; out[2] = m[2]; } } });
  };
  const WX = 1.5; const WZ = -8.5; // the waterfall's foot
  // the rock pile behind the pool, stepping up to the lip the water falls from
  for (const [dx, y, dz, r] of [[-5, 1.2, -2.5, 3.0], [5.2, 1.2, -2.2, 3.2], [-2.6, 1.8, -4.2, 3.4], [2.8, 2.0, -4.4, 3.4], [0, 3.8, -5.4, 3.6], [-3.6, 4.4, -4.6, 2.4], [3.8, 4.6, -4.8, 2.4], [0, 7.0, -5.4, 2.8], [-1.8, 8.8, -5.6, 2.0], [1.9, 9.0, -5.5, 2.0], [-4.4, 0.6, 0.2, 1.5], [4.8, 0.6, 0.6, 1.6]]) rock(WX + dx, y, WZ + dz, r);
  // the pool, rimmed with stones
  K.cyl('water', 0x2f9fc4, WX, WZ + 2.2, -0.1, 0.14, 5.2, { sides: 40, tint: (x, y, z, out) => { const d = Math.hypot(x - WX, z - WZ - 2.2) / 5.2; const k = 0.7 + 0.45 * d; out[0] *= k; out[1] *= k; out[2] *= k; } });
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; if (Math.sin(a) < -0.6) continue; rock(WX + Math.cos(a) * 5.6, 0.2, WZ + 2.2 + Math.sin(a) * 5.6, 0.75 + rng() * 0.3, 0.6); }
  // the falling water: a ribbon from the lip to the pool, glowing aqua to white, and foam below
  {
    const pts = [[WX, 10.2, WZ - 4.4], [WX, 9.7, WZ - 3.2], [WX, 6.8, WZ - 2.3], [WX, 3.5, WZ - 1.7], [WX, 0.3, WZ - 1.2]];
    K.tube('glow', 0x8ff3ff, pts, [0.5, 0.55, 0.62, 0.7, 0.75], { sides: 8, steps: 20, round: 0, section: () => [0.35, 2.4], frame: () => [0, 0, 1], tint: (x, y, z, out) => { const k = 0.5 + 0.5 * Math.sin(y * 3.1 + x * 4); out[0] += (1 - out[0]) * k * 0.6; out[1] += (1 - out[1]) * k * 0.5; out[2] += (1 - out[2]) * k * 0.3; } });
    for (let k = 0; k < 7; k++) K.ball('glow', 0xe8ffff, WX + (rng() - 0.5) * 3.2, 0.25, WZ - 0.8 + rng() * 1.4, 0.4 + rng() * 0.3, { w: 8, h: 5, scale: [1, 0.45, 1] });
  }

  // ---- the plants ------------------------------------------------------------------------
  const palm = (x, z, h, lean, ph) => {
    const lx = Math.cos(ph) * lean; const lz = Math.sin(ph) * lean;
    const top = [x + lx, h, z + lz];
    K.tube('garden', 0x8a6a48, [[x, -0.1, z], [x + lx * 0.2, h * 0.4, z + lz * 0.2], [x + lx * 0.6, h * 0.75, z + lz * 0.6], top], [0.6, 0.48, 0.4, 0.34], { sides: 8, steps: 14, round: 0, feet: [3, 3], tint: (px, py, pz, out) => { const k = 0.78 + 0.22 * (Math.sin(py * 5.5) > 0.3 ? 1 : 0); out[0] *= k; out[1] *= k; out[2] *= k; } });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + ph; const len = 5.5 + rng() * 1.5;
      const p0 = top; const ca = Math.cos(a); const sa = Math.sin(a);
      const pts = [p0, [p0[0] + ca * len * 0.35, p0[1] + 1.1, p0[2] + sa * len * 0.35], [p0[0] + ca * len * 0.7, p0[1] + 0.4, p0[2] + sa * len * 0.7], [p0[0] + ca * len, p0[1] - 1.6, p0[2] + sa * len]];
      K.tube('garden', k % 2 ? 0x3fa34d : 0x52b748, pts, [0.25, 0.85, 0.7, 0.05], { sides: 6, steps: 10, round: 0, section: () => [0.18, 1], frame: () => [0, 1, 0], feet: [2, 2] });
    }
    for (let k = 0; k < 4; k++) K.ball('garden', 0x7a5a2e, top[0] + Math.cos(k * 1.6) * 0.45, top[1] - 0.35, top[2] + Math.sin(k * 1.6) * 0.45, 0.32, { detail: 0 });
  };
  palm(-9.5, -4.5, 16.5, 1.8, 0.4);
  palm(8.5, -6.0, 15.0, 1.6, 2.6);
  palm(-6.0, 7.0, 13.0, 1.4, 4.2);
  palm(10.5, 6.0, 12.0, 1.4, 5.4);
  // big-leaved plants: broad leaves on stems, cupped up
  const bigLeaf = (x, z, s, ph, c = 0x2f9a48) => {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + ph; const ca = Math.cos(a); const sa = Math.sin(a);
      const L = (2.6 + rng() * 0.8) * s; const h = (2.4 + rng()) * s;
      K.tube('garden', 0x4f8f34, [[x, 0, z], [x + ca * L * 0.25, h * 0.8, z + sa * L * 0.25], [x + ca * L * 0.45, h, z + sa * L * 0.45]], [0.1 * s, 0.08 * s], { sides: 4, steps: 4, round: 0 });
      const leaf = blob([x + ca * L * 0.85, h + 0.1 * s, z + sa * L * 0.85], 1.4 * s, { squash: 0.16, detail: 1, ph: rng() * 9, base: shade(c, 0.9 + rng() * 0.3), rough: 0.05, under: 0.8 });
      // stretch it along the stem's direction: a broad oval leaf, not a disc
      const Q = leaf.attributes.position; const cx = x + ca * L * 0.85; const cz = z + sa * L * 0.85;
      for (let i = 0; i < Q.count; i++) { const dx = Q.getX(i) - cx; const dz = Q.getZ(i) - cz; const along = dx * ca + dz * sa; const across = -dx * sa + dz * ca; const a2 = along * 1.45; Q.setX(i, cx + a2 * ca - across * sa); Q.setZ(i, cz + a2 * sa + across * ca); Q.setY(i, Q.getY(i) - along * 0.18); }
      leaf.computeVertexNormals();
      addColored(K, 'garden', leaf, [2, 2]);
    }
  };
  for (const [x, z, s, c] of [[-13, 2, 1.1, 0x2f9a48], [13.5, -1.5, 1.0, 0x37a85a], [-3.5, -2, 0.9, 0x2a8f50], [6.5, 12.5, 0.85, 0x2f9a48], [-12, -10, 1.0, 0x3aa848], [12, -11, 0.9, 0x2f9a48]]) bigLeaf(x, z, s, rng() * 6, c);
  // flowering shrubs and bright blooms, the colour of a glasshouse
  const BLOOM = [FUTURE.magenta, FUTURE.coral, FUTURE.sun, 0xff4f6d, 0xb07cf0];
  for (let k = 0; k < 16; k++) {
    const a = rng() * Math.PI * 2; const r = 6 + rng() * 11;
    const x = Math.cos(a) * r; const z = Math.sin(a) * r;
    if (z > 12 && Math.abs(x) < 6) continue; // the path in
    if (Math.hypot(x - WX, z - WZ - 1) < 8) continue; // the pool and the rocks
    addColored(K, 'garden', blob([x, 0.7, z], 1.1 + rng() * 0.6, { squash: 0.75, detail: 1, ph: rng() * 9, base: rng() < 0.5 ? 0x3fa34d : 0x2f8f4a, under: 0.7 }), [2, 2]);
    const c = BLOOM[k % BLOOM.length];
    for (let j = 0; j < 5; j++) { const b = rng() * Math.PI * 2; K.ball('garden', c, x + Math.cos(b) * 0.9, 1.3 + rng() * 0.6, z + Math.sin(b) * 0.9, 0.28, { detail: 0 }); }
  }
  // glowing path lights, little mushrooms along the way in
  for (const [i, sd] of [[3, 1], [7, -1], [11, 1], [15, -1], [19, 1]]) {
    const [x, z] = pathPts[i];
    K.cyl('frame', 0xd9dee4, x + sd * 2.0, z, -0.1, 1.2, 0.12, { sides: 8 });
    K.turned('glow', [FUTURE.glowCyan, FUTURE.glowPink, FUTURE.glowLime][i % 3], [[0, 0], [0.42, 0], [0.4, 0.18], [0.2, 0.36], [0, 0.4]], x + sd * 2.0, 1.15, z, { sides: 12 });
  }

  const group = new THREE.Group();
  group.add(K.mesh('frame', { tile: 'panel', rough: 0.4, metal: 0.2, bump: 0.1 }));
  group.add(K.mesh('garden', { tile: 'leaf', rough: 0.8, bump: 0.6 }));
  group.add(K.mesh('rock', { rough: 0.9 }));
  group.add(K.mesh('water', { rough: 0.1, metal: 0.15 }));
  group.add(K.mesh('glow', { glow: true }));
  group.add(K.mesh('clear', { clear: true, opacity: 0.2, rough: 0.05, metal: 0.1 }));
  return group;
}

export const BUILDERS = {
  'vertical-farm-tower': verticalFarmTower,
  'forest-tower': forestTower,
  'printed-dome-home': printedDomeHome,
  'floating-home': floatingHome,
  'solar-skyscraper': solarSkyscraper,
  'biodome-garden': biodomeGarden,
};

