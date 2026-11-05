import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Batch, signs, addPine, blobGeometry, seededRandom,
  mixc, shade, clamp01, sstep, mix, noise2, fbm, smoothPath, pathDistance, sampledField, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';
import { tube } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// A beaver dam, as a museum diorama. One idea carries it: AN ANIMAL THAT ENGINEERS ITS OWN
// LANDSCAPE. So the block is a short stretch of mountain valley and its front is cut ALONG the
// stream: from the left, the pond the beavers made, their lodge cut in half with its dry room and
// underwater doors, their dam in section, and the meadow below it, where the soil is painted wet up
// to the water table the dam has raised. A dashed line shows where that water table was before.
//
// Two water levels, which is why this does not use terrainBlock: the pond stands above the dam and
// the stream runs on below it. One description of the valley is used three times, as the mesh, as
// the painting on top and as the painting of the cut faces, so the section cannot disagree with
// what stands above it.
//
// Six meshes: ground (top, cut faces and outer walls on one atlas), water, the lodge's room, the
// scenery batch, the signs, and the one beaver that moves. Authored in feet, origin at the base
// centre, front toward +Z. Upstream is -X.

const W = 17; const D = 10;
const X0 = -W / 2; const X1 = W / 2; const Z0 = -D / 2; const ZF = D / 2;
const PLINTH = 0.3;
const NX = 128; const NZ = 76;
const FONT = 'Arial, Helvetica, sans-serif';

// --- the valley, in one place ---------------------------------------------------------------
export const BEAVER = {
  POND: 2.62, // the pond's surface, held up by the dam
  CREST: 2.74,
  LODGE_X: -4.1,
  LODGE_TOP: 3.36,
};
const PW = BEAVER.POND;
const CREST = BEAVER.CREST;
const LX = BEAVER.LODGE_X; const LR = 1.3; const LTOP = BEAVER.LODGE_TOP;
// The room inside the lodge: its floor a hand above the water, which is the whole point of it.
const CF = PW + 0.08; const CRX = 0.55; const CRY = 0.42; const CRZ = 0.5;
const CACHE = [-6.4, ZF - 0.42];
const NOTCH_Z = 0.1;

// The valley floor before the beavers came, falling gently downstream, and the water table under
// it, about half a foot down. Both are lines in x, because the cut face runs along x.
const oldFloor = (x) => 1.95 - 0.06 * x;
const oldWT = (x) => oldFloor(x) - 0.5;
// The stream below the dam, a little under the meadow.
const swl = (x) => oldFloor(x) - 0.1;
// The dam bows upstream in the middle, as most do.
const damX = (z) => -0.3 - 0.22 * (1 - ((z - 1.6) / 3.6) ** 2);
const smax = (a, b, k) => { const h = clamp01(0.5 + (a - b) / (2 * k)); return mix(b, a, h) + k * h * (1 - h); };

// The hillside at the back.
function hill(x, z) {
  // The foot of the hill wanders, so the far shore of the pond is not a ruled line.
  const t = sstep(-z + 0.45 * Math.sin(x * 0.62 + 1.0) + 0.22 * Math.sin(x * 1.45 + 0.3), 0.9, 5.0);
  const ridge = 1.55 + 0.25 * Math.sin(x * 0.37 + 1.1) + 0.12 * Math.sin(x * 0.9 + 0.4);
  return ridge * t ** 1.25 + 0.1 * t * fbm(x * 0.45, z * 0.45, 3, 4);
}

// The stream winds away from the low point in the dam, where the water goes over.
const STREAM = smoothPath([[0.35, NOTCH_Z], [1.8, 0.45], [3.3, 1.45], [5.0, 0.95], [6.7, 1.65], [8.9, 1.3]], 140);
const POOLS = [[1.35, 2.75, 0.5, 0.32], [2.75, 3.45, 0.38, 0.26], [2.05, 1.75, 0.3, 0.22], [3.9, 2.65, 0.3, 0.2], [0.95, 3.85, 0.3, 0.2]];
const CANALS = [[[LX - 0.2, ZF - 0.9], CACHE], [[LX + 0.4, ZF - 1.0], [-1.6, 2.4]]];
const STUMPS = [[-5.05, -3.05, 0.085], [-3.45, -3.25, 0.075], [-6.15, -2.95, 0.07], [-2.5, -3.35, 0.08]];
const FELLED = { stump: [-7.15, -3.15], tip: [-6.35, -1.25] };
const GNAWING = [-4.35, -3.55];

let fields = null;
function getFields() {
  if (fields) return fields;
  const stream = sampledField(W, D, 170, 100, (x, z) => pathDistance(STREAM, x, z).d);
  fields = { stream };
  return fields;
}

function segDist(x, z, a, b) {
  const dx = b[0] - a[0]; const dz = b[1] - a[1];
  const t = clamp01(((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

// The ground with neither dam nor lodge: what the water would sit on.
function base(x, z) {
  let y = oldFloor(x) + hill(x, z) + 0.025 * fbm(x * 0.9, z * 0.9, 2, 9);
  const dx = x - damX(z);
  if (dx < 0) {
    // Under the pond: silt settles and flattens the bottom, and beavers keep their paths deep.
    const wet = sstep(PW + 0.02 - y, 0, 0.18);
    let canal = 0;
    for (const [a, b] of CANALS) canal = Math.max(canal, 0.2 * Math.exp(-((segDist(x, z, a, b) / 0.42) ** 2)));
    y -= wet * (0.06 + canal);
  } else {
    const d = getFields().stream(x, z);
    y -= 0.22 * (1 - sstep(d, 0.12, 0.3)) * sstep(dx, 0.35, 0.95);
    for (const [px, pz, rx, rz] of POOLS) {
      const q = Math.hypot((x - px) / rx, (z - pz) / rz) + 0.12 * noise2(x * 3, z * 3, 14);
      y -= 0.17 * (1 - sstep(q, 0.55, 1.0));
    }
  }
  return y;
}

function damH(x, z) {
  const s = x - damX(z);
  let crest = CREST + 0.03 * noise2(z * 3.1, 1.7, 21);
  crest = mix(crest, PW - 0.02, Math.exp(-(((z - NOTCH_Z) / 0.3) ** 2)));
  if (s < -0.12) return crest - (-s - 0.12) * 1.15;
  if (s > 0.14) return crest - (s - 0.14) * 0.78;
  return crest;
}

function lodgeH(x, z, floor) {
  const q = Math.hypot((x - LX) / LR, (z - ZF) / (LR * 0.95));
  if (q >= 1) return -Infinity;
  const bump = 0.03 * noise2(x * 6, z * 6, 31) + 0.02 * noise2(x * 13, z * 13, 32);
  return floor + (LTOP - floor) * (1 - q * q) ** 0.55 + bump * (1 - q);
}

function ground(x, z) {
  const b = base(x, z);
  return Math.max(b, damH(x, z), lodgeH(x, z, b));
}

// Where the water stands at a point, if anywhere.
const waterAt = (x, z) => (x < damX(z) ? PW : swl(x));

// The water table now: the pond's own level behind the dam, falling through it, then held just under
// the meadow for a long way downstream before it sinks back to where it was.
function wtNow(x) {
  const dx = x - damX(ZF);
  if (dx <= 0) return PW;
  const meadow = mix(oldFloor(x) - 0.07, oldWT(x) + 0.1, sstep(x, 4.4, 8.8));
  return smax(PW - 0.02 - 0.9 * dx, meadow, 0.08);
}
// Away from the front it rises a little under the hill, as it does in any valley.
const wtAt = (x, z) => {
  const dx = x - damX(z);
  if (dx <= 0) return PW;
  return smax(PW - 0.02 - 0.9 * dx, wtNow(x) + 0.3 * hill(x, z) / 1.55, 0.08);
};
const oldWTAt = (x, z) => oldWT(x) + 0.3 * hill(x, z) / 1.55;

// ---------------------------------------------------------------------------------------------
// Painting helpers
// ---------------------------------------------------------------------------------------------
function paintRegion(ctx, x0, y0, w, h, fn) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fn(x, y);
      d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
}

function fitLabel(ctx, text, x, y, size, maxWidth, { dark = true, color = '#ffffff', weight = 700 } = {}) {
  ctx.save();
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  if (tw > maxWidth) { s *= maxWidth / tw; ctx.font = `${weight} ${s}px ${FONT}`; }
  const width = Math.min(tw, maxWidth);
  const pad = s * 0.38;
  if (dark) {
    ctx.fillStyle = 'rgba(16,20,24,0.78)';
    ctx.fillRect(x - width / 2 - pad, y - s * 0.72, width + pad * 2, s * 1.44);
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + s * 0.03);
  ctx.restore();
}

// The soil, from the surface down. `top` is the ground the water would sit on, `wt` the water table
// now and `was` the water table before the dam.
function soilColor(x, y, top, pond, wt, was) {
  const below = top - y;
  const rockTop = 0.66 + 0.07 * Math.sin(x * 0.7 + 0.4) + 0.04 * noise2(x * 1.3, 2.2, 5);
  const gravelTop = oldFloor(x) - 0.64 + 0.04 * Math.sin(x * 1.1);
  const grain = noise2(x * 26, y * 26, 12) * 0.5 + noise2(x * 61, y * 61, 13) * 0.5;
  let c;
  if (y < rockTop) {
    const band = Math.sin((y + 0.05 * noise2(x * 0.8, y * 2, 4)) * 22) * 0.5 + 0.5;
    // Rock is rock, wet or dry.
    return shade(mixc([104, 102, 100], [126, 122, 118], band), 1 + grain * 0.08);
  } else if (y < gravelTop && y > gravelTop - 0.2) {
    c = mixc([150, 136, 112], [118, 104, 84], sstep(noise2(x * 18, y * 18, 7), -0.2, 0.4));
  } else if (pond && below < 0.07) {
    c = [44, 36, 28]; // the muck that settles on a pond floor
  } else if (!pond && below < 0.11) {
    c = mixc([58, 42, 28], [74, 54, 36], noise2(x * 9, y * 9, 3) * 0.5 + 0.5);
  } else {
    c = mixc([150, 122, 88], [136, 110, 78], sstep(Math.sin((y + 0.04 * noise2(x, y * 3, 9)) * 26), -0.8, 0.8));
  }
  c = shade(c, 1 + grain * 0.1);
  // Below the old water table the ground was always soaked. Between the two lines it is soaked
  // NOW, because of the dam, and that band is painted to stand out: it is the whole lesson.
  if (y < was) c = [c[0] * 0.74, c[1] * 0.8, c[2] * 0.9 + 10];
  else if (y < wt) c = [c[0] * 0.5 + 18, c[1] * 0.66 + 34, c[2] * 0.8 + 66];
  return c;
}

const pondWater = (depth) => mixc([70, 112, 116], [26, 58, 74], sstep(depth, 0, 0.75));

// ---------------------------------------------------------------------------------------------
// The ground: top, front cut face and the three outer walls, on one atlas
// ---------------------------------------------------------------------------------------------
function buildGround() {
  const frontTop = (x) => Math.max(ground(x, ZF), waterAt(x, ZF));
  let FTOP = 0;
  for (let i = 0; i <= NX; i++) FTOP = Math.max(FTOP, frontTop(X0 + (i / NX) * W));
  FTOP += 0.01;
  const WALLS = [
    { from: [X0, ZF], to: [X0, Z0], n: NZ, len: D }, // left, upstream end
    { from: [X1, Z0], to: [X1, ZF], n: NZ, len: D }, // right, downstream end
    { from: [X1, Z0], to: [X0, Z0], n: NX, len: W }, // back
  ];
  let WTOP = 0;
  for (const wall of WALLS) {
    wall.tops = [];
    for (let i = 0; i <= wall.n; i++) {
      const t = i / wall.n;
      const x = mix(wall.from[0], wall.to[0], t); const z = mix(wall.from[1], wall.to[1], t);
      const top = Math.max(ground(x, z), waterAt(x, z));
      wall.tops.push(top);
      WTOP = Math.max(WTOP, top);
    }
  }
  WTOP += 0.01;

  const AW = 2048;
  const TW = 1300; const TH = Math.round(TW * D / W);
  const FW = AW; const FH = Math.round(FW * (FTOP - PLINTH) / W);
  const SW = AW - TW; const SH = Math.round(SW * (WTOP - PLINTH) / D);
  const BW = TW; const BH = Math.round(BW * (WTOP - PLINTH) / W);
  WALLS[0].at = [TW, 0, SW, SH];
  WALLS[1].at = [TW, SH, SW, SH];
  WALLS[2].at = [0, TH + FH, BW, BH];
  const AH = TH + FH + BH;

  // Cheap, smooth copies of the expensive functions, for painting the top.
  const G = sampledField(W, D, 340, 200, ground);
  const B = sampledField(W, D, 340, 200, base);
  const WT = sampledField(W, D, 340, 200, wtAt);
  const rng = seededRandom(5150);

  const map = canvasTexture(AW, AH, (ctx) => {
    // --- the top ---
    const cell = W / TW;
    paintRegion(ctx, 0, 0, TW, TH, (px, py) => {
      const x = X0 + ((px + 0.5) / TW) * W; const z = Z0 + ((py + 0.5) / TH) * D;
      const y = G(x, z);
      const dx = x - damX(z);
      const n = noise2(x * 3.1, z * 3.1, 21) * 0.5 + 0.5;
      const n2 = noise2(x * 11, z * 11, 22) * 0.5 + 0.5;
      let c;
      // Under water nobody sees it.
      if (dx < 0 && y < PW - 0.006) return [70, 60, 46];
      const bb = B(x, z);
      const lodge = lodgeH(x, z, bb);
      const dam = damH(x, z);
      const b = Math.max(bb, lodge);
      if (lodge > -Infinity && lodge >= bb + 0.01) {
        c = mixc([92, 74, 52], [120, 98, 70], n2);
      } else if (dam > b + 0.004) {
        // The dam: mud packed on its crest and its upstream face, sticks below it.
        // A jumble of sticks, not a deck of planks: two crossing sets, each bent by noise.
        const s1 = Math.sin(x * 33 + z * 11 + 5 * noise2(x * 1.7, z * 1.7, 9));
        const s2 = Math.sin(x * 8 - z * 31 + 5 * noise2(x * 1.9, z * 1.9, 10));
        const sticks = sstep(Math.max(s1, s2), 0.55, 0.95);
        c = mixc([78, 62, 46], [128, 108, 82], sticks * (0.6 + 0.4 * n2));
        // The water going over the low place, as white as it is in life.
        const spill = Math.exp(-(((z - NOTCH_Z) / 0.16) ** 2)) * sstep(x - damX(z), 0.05, 0.25);
        c = mixc(c, mixc([196, 214, 212], [230, 240, 236], n2), spill * 0.85);
      } else if (dx < 0 && y < PW + 0.07) {
        c = mixc([78, 64, 46], [96, 80, 58], n); // wet mud at the pond's edge
      } else {
        const wt = WT(x, z);
        const wet = 1 - sstep(y - wt, 0.03, 0.32);
        const forest = sstep(-z, 1.4, 2.4);
        const sedge = shade(mixc([62, 104, 46], [94, 134, 58], n), 0.92 + 0.16 * n2);
        const dry = mixc([150, 144, 86], [176, 160, 98], n);
        const meadow = mixc(dry, sedge, wet);
        const litter = mixc([98, 108, 58], [176, 146, 68], sstep(noise2(x * 1.6, z * 1.6, 25), -0.1, 0.5));
        c = mixc(meadow, litter, forest);
        if (dx > 0) {
          const d = getFields().stream(x, z);
          c = mixc(c, mixc([104, 92, 70], [132, 122, 100], n2), (1 - sstep(d, 0.22, 0.38)) * sstep(dx, 0.4, 1));
        }
        // Mud slides where the beavers drag branches down to the water.
        let drag = 0;
        for (const [sx, sz] of [...STUMPS, FELLED.stump]) {
          const dd = segDist(x, z, [sx, sz], [sx + 0.25, -1.4]);
          drag = Math.max(drag, 1 - sstep(dd, 0.06, 0.13));
        }
        c = mixc(c, [104, 84, 60], drag * 0.85);
      }
      // Baked light from the upper left carries the small forms the mesh cannot.
      const sx = (G(x + cell * 2, z) - G(x - cell * 2, z)) / (cell * 4);
      const sz = (G(x, z + cell * 2) - G(x, z - cell * 2)) / (cell * 4);
      const lit = Math.max(0.72, 0.94 + (-sx * 0.5 - sz * 0.4) * 0.6);
      return shade(c, lit);
    });
    // Wood chips round every stump, which is how you know who did it.
    const tx = (x) => ((x - X0) / W) * TW; const tz = (z) => ((z - Z0) / D) * TH;
    for (const [sx, sz] of [...STUMPS, FELLED.stump, GNAWING]) {
      for (let k = 0; k < 26; k++) {
        const a = rng() * TAU; const r = 0.06 + rng() * 0.3;
        ctx.fillStyle = `rgb(${220 + rng() * 25 | 0},${190 + rng() * 25 | 0},${140 + rng() * 25 | 0})`;
        ctx.save();
        ctx.translate(tx(sx + Math.cos(a) * r), tz(sz + Math.sin(a) * r));
        ctx.rotate(rng() * TAU);
        ctx.fillRect(-2.5, -1, 5, 2);
        ctx.restore();
      }
    }

    // --- the front cut face: what the whole model is for ---
    const OY = TH;
    const fx = (x) => ((x - X0) / W) * FW;
    const fy = (y) => OY + ((FTOP - y) / (FTOP - PLINTH)) * FH;
    const pxPerFoot = FW / W;
    const cols = [];
    const DXF = damX(ZF);
    for (let px = 0; px < FW; px++) {
      const x = X0 + ((px + 0.5) / FW) * W;
      const b = base(x, ZF);
      cols.push({ x, b, dam: damH(x, ZF), lodge: lodgeH(x, ZF, b), wt: wtNow(x), was: oldWT(x), water: waterAt(x, ZF), pond: x < DXF });
    }
    paintRegion(ctx, 0, OY, FW, FH, (px, py) => {
      const col = cols[px];
      const y = FTOP - ((py + 0.5) / FH) * (FTOP - PLINTH);
      const g = Math.max(col.b, col.dam, col.lodge);
      if (y > g) {
        if (y <= col.water) {
          const c = pondWater(col.water - y);
          const ray = (Math.sin((col.x * 2.1 + y * 0.9) * 3.3 + 2 * noise2(col.x * 0.4, 1, 2)) * 0.5 + 0.5) ** 6;
          return mixc(c, [120, 160, 150], ray * 0.18 * (1 - sstep(col.water - y, 0, 0.6)));
        }
        return [40, 40, 40];
      }
      if (col.lodge > col.b && y > col.b) return mixc([62, 48, 34], [78, 60, 42], noise2(col.x * 14, y * 14, 41) * 0.5 + 0.5);
      if (col.dam > col.b && y > col.b) return mixc([66, 54, 40], [84, 68, 50], noise2(col.x * 14, y * 14, 42) * 0.5 + 0.5);
      return soilColor(col.x, y, col.b, col.pond, col.wt, col.was);
    });

    const P = (x, y) => [fx(x), fy(y)];
    // A clip to a region of the section, from its top and bottom profiles.
    const clipTo = (xa, xb, topFn, botFn) => {
      ctx.beginPath();
      const steps = 80;
      for (let i = 0; i <= steps; i++) { const x = mix(xa, xb, i / steps); const [a, b] = P(x, topFn(x)); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }
      for (let i = steps; i >= 0; i--) { const x = mix(xa, xb, i / steps); const [a, b] = P(x, botFn(x)); ctx.lineTo(a, b); }
      ctx.closePath();
      ctx.clip();
    };
    const stick = (x0, y0, x1, y1, r, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, r * 2 * pxPerFoot);
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(...P(x0, y0)); ctx.lineTo(...P(x1, y1)); ctx.stroke();
    };
    const stickTones = ['#7d6a52', '#6a5844', '#927c60', '#d8c49c', '#55463a', '#a88f6c'];

    // The dam, in section: sticks laid with the flow, butt ends upstream, packed with mud and stones.
    const damA = DXF - 0.12 - (CREST + 0.05 - (oldFloor(DXF) - 0.2)) / 1.15;
    const damB = DXF + 0.14 + (CREST + 0.05 - (oldFloor(DXF) - 0.2)) / 0.78;
    ctx.save();
    clipTo(damA, damB, (x) => damH(x, ZF), (x) => base(x, ZF));
    for (let k = 0; k < 160; k++) {
      const x = mix(damA, damB, rng());
      const top = damH(x, ZF); const bot = base(x, ZF);
      if (top <= bot) continue;
      const y = mix(bot, top, rng());
      const len = 0.25 + rng() * 0.55;
      const tilt = (rng() - 0.5) * 0.5 + (x > DXF ? -0.5 : 0.35);
      stick(x - len / 2, y - Math.sin(tilt) * len / 2, x + len / 2, y + Math.sin(tilt) * len / 2, 0.012 + rng() * 0.018, stickTones[Math.floor(rng() * stickTones.length)]);
    }
    // Mud plastered on the upstream face, which is what makes a pile of sticks hold water.
    ctx.strokeStyle = '#3a2e22'; ctx.lineWidth = 0.07 * pxPerFoot; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const x = mix(damA, DXF - 0.12, i / 40);
      const [a, b] = P(x + 0.03, damH(x, ZF) - 0.03);
      if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b);
    }
    ctx.stroke();
    // Stones at the foot of it.
    for (let k = 0; k < 16; k++) {
      const x = mix(damA + 0.1, DXF + 0.3, rng()); const y = base(x, ZF) + 0.04 + rng() * 0.1;
      const [a, b] = P(x, y);
      const r = (0.03 + rng() * 0.04) * pxPerFoot;
      const tone = 120 + rng() * 40;
      ctx.fillStyle = `rgb(${tone},${tone * 0.97},${tone * 0.94})`;
      ctx.beginPath(); ctx.ellipse(a, b, r * 1.3, r, rng() * 3, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // The lodge, in section: a heap of sticks and mud with a room in the top and doors under the water.
    const lodgeTop = (x) => lodgeH(x, ZF, base(x, ZF));
    ctx.save();
    clipTo(LX - LR + 0.01, LX + LR - 0.01, (x) => Math.max(base(x, ZF), lodgeTop(x)), (x) => base(x, ZF));
    for (let k = 0; k < 240; k++) {
      const x = LX + (rng() * 2 - 1) * LR;
      const top = lodgeTop(x); const bot = base(x, ZF);
      if (!(top > bot)) continue;
      const y = mix(bot, top, rng());
      const len = 0.18 + rng() * 0.4;
      const slope = (lodgeTop(x + 0.05) - lodgeTop(x - 0.05)) / 0.1;
      const a = Math.atan(slope) * 0.7 + (rng() - 0.5) * 1.2;
      stick(x - Math.cos(a) * len / 2, y - Math.sin(a) * len / 2, x + Math.cos(a) * len / 2, y + Math.sin(a) * len / 2, 0.01 + rng() * 0.014, stickTones[Math.floor(rng() * stickTones.length)]);
    }
    // Two tunnels from the room down through the floor of the heap and out under the water.
    const tunnel = (pts) => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const [a, b] = P(x, y); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1c1612'; ctx.lineWidth = 0.21 * pxPerFoot; ctx.stroke();
      ctx.strokeStyle = 'rgb(30,62,80)'; ctx.lineWidth = 0.15 * pxPerFoot; ctx.stroke();
      // Above the water line the tunnel holds air, not water.
      ctx.save();
      ctx.beginPath(); ctx.rect(0, OY, FW, fy(PW) - OY); ctx.clip();
      ctx.beginPath();
      pts.forEach(([x, y], i) => { const [a, b] = P(x, y); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
      ctx.strokeStyle = '#231b14'; ctx.lineWidth = 0.15 * pxPerFoot; ctx.stroke();
      ctx.restore();
    };
    tunnel([[LX + 0.3, CF + 0.02], [LX + 0.55, PW - 0.1], [LX + 0.82, base(LX + 0.82, ZF) + 0.1], [LX + 1.25, base(LX + 1.25, ZF) + 0.08]]);
    tunnel([[LX - 0.32, CF + 0.02], [LX - 0.6, PW - 0.14], [LX - 0.95, base(LX - 0.95, ZF) + 0.1], [LX - 1.3, base(LX - 1.3, ZF) + 0.07]]);
    ctx.restore();
    // The room's own edge, dark, so the opening reads as a room and not as a hole in a picture.
    ctx.strokeStyle = '#1a140f'; ctx.lineWidth = 0.05 * pxPerFoot;
    ctx.beginPath(); ctx.ellipse(fx(LX), fy(CF), CRX * pxPerFoot, CRY * (FH / (FTOP - PLINTH)), 0, Math.PI, TAU); ctx.lineTo(fx(LX - CRX), fy(CF)); ctx.stroke();

    // The food cache: branches pushed into the mud, mostly under the water so ice cannot lock them in.
    for (let k = 0; k < 34; k++) {
      const x = CACHE[0] + (rng() - 0.5) * 0.9;
      const bot = base(x, ZF) + 0.02;
      const top = PW + 0.05 + rng() * 0.12;
      const lean = (rng() - 0.5) * 0.5;
      stick(x, bot, x + lean, mix(bot, top, 0.6 + rng() * 0.4), 0.009 + rng() * 0.012, stickTones[Math.floor(rng() * 3)]);
    }

    // Roots under the meadow.
    ctx.strokeStyle = 'rgba(40,30,20,0.55)'; ctx.lineWidth = 1.4;
    for (let k = 0; k < 120; k++) {
      const x = mix(DXF + 1.1, X1, rng()); const top = base(x, ZF);
      ctx.beginPath(); ctx.moveTo(...P(x, top - 0.01));
      ctx.lineTo(...P(x + (rng() - 0.5) * 0.08, top - 0.08 - rng() * 0.18)); ctx.stroke();
    }
    // Pebbles in the old stream gravel.
    for (let k = 0; k < 220; k++) {
      const x = mix(X0, X1, rng());
      const gt = oldFloor(x) - 0.64 + 0.04 * Math.sin(x * 1.1);
      const [a, b] = P(x, gt - 0.02 - rng() * 0.16);
      const tone = 150 + rng() * 50;
      ctx.fillStyle = `rgba(${tone},${tone * 0.94},${tone * 0.86},0.8)`;
      ctx.beginPath(); ctx.ellipse(a, b, 2 + rng() * 4, 1.5 + rng() * 2.5, rng() * 3, 0, TAU); ctx.fill();
    }

    // The two water tables. The solid line is now; the dashed one is before the dam.
    const line = (fn, xa, xb, color, dash) => {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= 300; i++) { const x = mix(xa, xb, i / 300); const [a, b] = P(x, fn(x)); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.strokeStyle = 'rgba(10,16,24,0.9)'; ctx.lineWidth = 0.075 * pxPerFoot; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 0.042 * pxPerFoot; ctx.stroke();
      ctx.restore();
    };
    line(oldWT, X0 + 0.05, X1 - 0.05, '#ffe28a', [0.18 * pxPerFoot, 0.12 * pxPerFoot]);
    line(wtNow, damA + 0.05, X1 - 0.05, '#3fb4ff', []);

    // Water seeping through and under the dam into the meadow.
    ctx.strokeStyle = '#9fdcff'; ctx.fillStyle = '#9fdcff'; ctx.lineWidth = 0.03 * pxPerFoot; ctx.setLineDash([]);
    for (const [xa, ya, xb, yb] of [[DXF - 0.75, 1.72, DXF + 0.45, 1.6], [DXF + 0.25, 1.86, DXF + 1.35, 1.72], [DXF - 0.4, 1.5, DXF + 0.9, 1.4]]) {
      const [a, b] = P(xa, ya); const [c2, d2] = P(xb, yb);
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c2, d2); ctx.stroke();
      const ang = Math.atan2(d2 - b, c2 - a); const hl = 0.09 * pxPerFoot;
      ctx.beginPath(); ctx.moveTo(c2, d2);
      ctx.lineTo(c2 - Math.cos(ang - 0.45) * hl, d2 - Math.sin(ang - 0.45) * hl);
      ctx.lineTo(c2 - Math.cos(ang + 0.45) * hl, d2 - Math.sin(ang + 0.45) * hl);
      ctx.closePath(); ctx.fill();
    }

    const L = (text, x, y, feet, room, opts) => { const [a, b] = P(x, y); fitLabel(ctx, text, a, b, feet * pxPerFoot, room * pxPerFoot, opts); };
    L('BEAVER POND', -1.75, 2.4, 0.13, 1.05);
    L('FOOD CACHE', CACHE[0], 2.2, 0.1, 1.1);
    L('LODGE', LX, 2.12, 0.12, 0.9);
    L('UNDERWATER DOOR', LX + 1.6, 2.2, 0.085, 1.1);
    L('DAM', DXF + 0.3, 2.3, 0.13, 0.7);
    L('sticks, mud and stones', DXF + 0.3, 2.1, 0.075, 1.25);
    L('Pond water soaks through the dam and into the ground', DXF + 0.5, 1.3, 0.095, 3.6);
    L('WATER TABLE NOW', 3.0, wtNow(3.0) - 0.13, 0.13, 2.6);
    L('WATER TABLE BEFORE THE DAM', 3.0, oldWT(3.0) + 0.13, 0.13, 3.8);
    L('Wet now, dry before the dam', 6.4, (wtNow(6.4) + oldWT(6.4)) / 2, 0.1, 2.6);
    L('Pond mud', -7.2, base(-7.2, ZF) - 0.06, 0.07, 1.2);
    L('Old stream gravel', -2.9, oldFloor(-2.9) - 0.74, 0.075, 1.6);
    L('Bedrock', -6.4, 0.46, 0.085, 1.2);
    L('BEAVER DAM AND LODGE', 5.6, 0.93, 0.2, 5.2);
    L('An animal that engineers its own landscape', 5.6, 0.7, 0.12, 5.2);
    L('Cut open along the stream. Depths exaggerated; beavers and lodge enlarged.', 5.6, 0.5, 0.075, 5.4);

    // --- the outer walls, as sections too ---
    for (const wall of WALLS) {
      const [ox, oy, ww, wh] = wall.at;
      const wc = [];
      for (let px = 0; px < ww; px++) {
        const t = (px + 0.5) / ww;
        const x = mix(wall.from[0], wall.to[0], t); const z = mix(wall.from[1], wall.to[1], t);
        const b = base(x, z);
        wc.push({ x, b, g: Math.max(b, damH(x, z)), water: waterAt(x, z), pond: x < damX(z), wt: wtAt(x, z), was: oldWTAt(x, z) });
      }
      paintRegion(ctx, ox, oy, ww, wh, (px, py) => {
        const c = wc[px];
        const y = WTOP - ((py + 0.5) / wh) * (WTOP - PLINTH);
        if (y > c.g) return pondWater(c.water - y);
        return soilColor(c.x, y, c.b, c.pond, c.wt, c.was);
      });
    }
  });

  // --- the top, a grid ---
  const ring = NX + 1;
  const pos = new Float32Array(ring * (NZ + 1) * 3); const uvs = new Float32Array(ring * (NZ + 1) * 2);
  const H = new Float32Array(ring * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const k = i + j * ring;
      const x = X0 + (i / NX) * W; const z = Z0 + (j / NZ) * D;
      H[k] = ground(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      uvs[k * 2] = ((i / NX) * TW) / AW; uvs[k * 2 + 1] = 1 - ((j / NZ) * TH) / AH;
    }
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const e = c + 1;
      if (Math.abs(H[a] - H[e]) < Math.abs(H[b] - H[c])) idx.push(a, c, e, a, e, b);
      else idx.push(a, c, b, b, c, e);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  land.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  land.setIndex(idx);
  land.computeVertexNormals();

  // --- the front: one polygon whose top edge is the ground or the water, with the room cut out ---
  const pts = [new THREE.Vector2(X0, PLINTH), new THREE.Vector2(X1, PLINTH)];
  for (let i = NX; i >= 0; i--) { const x = X0 + (i / NX) * W; pts.push(new THREE.Vector2(x, frontTop(x))); }
  const shape = new THREE.Shape(pts);
  const hole = new THREE.Path();
  // The same sixteen stations the room's shell has along its rim, so the two meet exactly.
  for (let k = 0; k <= 16; k++) {
    const a = (Math.PI * k) / 16;
    const p = [LX + CRX * Math.cos(a), CF + CRY * Math.sin(a)];
    if (k) hole.lineTo(p[0], p[1]); else hole.moveTo(p[0], p[1]);
  }
  hole.closePath();
  shape.holes.push(hole);
  const shaped = new THREE.ShapeGeometry(shape);
  const face = shaped.index ? shaped.toNonIndexed() : shaped;
  const fp = face.attributes.position;
  const fuv = new Float32Array(fp.count * 2);
  for (let i = 0; i < fp.count; i++) {
    fuv[i * 2] = (fp.getX(i) - X0) / W * (FW / AW);
    fuv[i * 2 + 1] = 1 - (TH + ((FTOP - fp.getY(i)) / (FTOP - PLINTH)) * FH) / AH;
    fp.setZ(i, ZF);
  }
  face.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
  face.computeVertexNormals();

  // --- the outer walls, at the same stations as the grid's edges ---
  const wp = []; const wu = [];
  for (const wall of WALLS) {
    const [ox, oy, ww, wh] = wall.at;
    const uvOf = (t, y) => [(ox + t * ww) / AW, 1 - (oy + ((WTOP - y) / (WTOP - PLINTH)) * wh) / AH];
    for (let i = 0; i < wall.n; i++) {
      const t0 = i / wall.n; const t1 = (i + 1) / wall.n;
      const a = [mix(wall.from[0], wall.to[0], t0), mix(wall.from[1], wall.to[1], t0)];
      const b = [mix(wall.from[0], wall.to[0], t1), mix(wall.from[1], wall.to[1], t1)];
      const quad = [[a, PLINTH, t0], [b, PLINTH, t1], [b, wall.tops[i + 1], t1], [a, PLINTH, t0], [b, wall.tops[i + 1], t1], [a, wall.tops[i], t0]];
      for (const [p, y, t] of quad) { wp.push(p[0], y, p[1]); wu.push(...uvOf(t, y)); }
    }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2));
  walls.computeVertexNormals();

  const g = mergeGeometries([land.toNonIndexed(), face, walls], false);
  return mesh(g, standard({ map, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }));
}

// ---------------------------------------------------------------------------------------------
// The water: the pond above the dam and the stream below it, two planes on one map.
// ---------------------------------------------------------------------------------------------
function buildWater() {
  const CW = 960; const CH = Math.round(CW * D / W);
  const G = sampledField(W, D, 240, 140, ground);
  const rng = seededRandom(707);
  const map = canvasTexture(CW, CH, (ctx) => {
    paintRegion(ctx, 0, 0, CW, CH, (px, py) => {
      const x = X0 + ((px + 0.5) / CW) * W; const z = Z0 + ((py + 0.5) / CH) * D;
      const n = noise2(x * 2.2, z * 2.2, 3) * 0.5 + 0.5;
      if (x < damX(z)) {
        const depth = PW - G(x, z);
        // A beaver pond is tea-dark, with the sky lying on it and weed showing through the shallows.
        let c = mixc([96, 120, 92], pondWater(depth), sstep(depth, 0.02, 0.22));
        const sky = sstep(-z, -2, 3) * 0.22;
        c = mixc(c, [150, 184, 196], sky + 0.05 * n);
        return c;
      }
      const ripple = Math.sin(x * 14 + 4 * noise2(x, z * 2, 5)) * 0.5 + 0.5;
      return mixc([96, 138, 140], [150, 186, 184], ripple * 0.5 + n * 0.2);
    });
    // Lily pads in the shallows, away from the beavers' lanes.
    const px = (x) => ((x - X0) / W) * CW; const pz = (z) => ((z - Z0) / D) * CH;
    for (let k = 0; k < 60; k++) {
      const x = X0 + 0.2 + rng() * 6.5; const z = -2.2 + rng() * 5.5;
      if (x > damX(z) - 0.4) continue;
      const depth = PW - G(x, z);
      if (depth < 0.06 || depth > 0.36) continue;
      if (Math.hypot(x - LX, z - ZF) < LR + 0.3) continue;
      const r = (0.06 + rng() * 0.06) * (CW / W);
      ctx.fillStyle = `rgb(${60 + rng() * 30 | 0},${104 + rng() * 30 | 0},${48 + rng() * 16 | 0})`;
      const a = rng() * TAU;
      ctx.beginPath(); ctx.moveTo(px(x), pz(z)); ctx.arc(px(x), pz(z), r, a + 0.35, a + TAU - 0.35); ctx.closePath(); ctx.fill();
      if (rng() > 0.82) { ctx.fillStyle = '#f4f0e8'; ctx.beginPath(); ctx.arc(px(x) + r * 0.2, pz(z) - r * 0.2, r * 0.35, 0, TAU); ctx.fill(); }
    }
  });

  const P = []; const U = [];
  const uvOf = (x, z) => [(x - X0) / W, 1 - (z - Z0) / D];
  const push = (a, b, c) => {
    // Wind each triangle to face up.
    const ux = b[0] - a[0]; const uz = b[2] - a[2]; const vx = c[0] - a[0]; const vz = c[2] - a[2];
    const up = uz * vx - ux * vz;
    for (const p of up >= 0 ? [a, b, c] : [a, c, b]) { P.push(...p); U.push(...uvOf(p[0], p[2])); }
  };
  const rows = 40;
  for (let j = 0; j < rows; j++) {
    const za = Z0 + (j / rows) * D; const zb = Z0 + ((j + 1) / rows) * D;
    const xa = damX(za) + 0.02; const xb = damX(zb) + 0.02;
    // The pond, flat.
    push([X0, PW, za], [xa, PW, za], [xb, PW, zb]);
    push([X0, PW, za], [xb, PW, zb], [X0, PW, zb]);
    // The stream, which falls with the valley, so its plane tilts in x.
    const sa = damX(za) - 0.02; const sb = damX(zb) - 0.02;
    push([sa, swl(sa), za], [X1, swl(X1), za], [X1, swl(X1), zb]);
    push([sa, swl(sa), za], [X1, swl(X1), zb], [sb, swl(sb), zb]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.computeVertexNormals();
  const m = mesh(g, standard({ map, roughness: 0.22, metalness: 0.04, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.12 }));
  m.castShadow = false;
  return m;
}

// ---------------------------------------------------------------------------------------------
// A beaver, as parts in its own frame: +Z forward, belly on y = 0, about 0.77ft nose to tail.
// ---------------------------------------------------------------------------------------------
function beaverParts() {
  const fur = 0x5b3b23; const dark = 0x3a2616; const muzzle = 0x76553a; const tail = 0x2b2622; const black = 0x0b0b0b;
  const parts = [];
  const sph = (w = 12) => new THREE.SphereGeometry(1, w, Math.max(4, Math.round(w * 0.66)));
  const add = (g, color, position, scale = [1, 1, 1]) => parts.push({ g, color, position, scale });
  add(sph(13), fur, [0, 0.086, -0.01], [0.105, 0.088, 0.19]);
  add(sph(11), fur, [0, 0.094, -0.1], [0.114, 0.093, 0.12]);
  add(sph(12), fur, [0, 0.124, 0.17], [0.072, 0.066, 0.085]);
  add(sph(10), muzzle, [0, 0.108, 0.235], [0.05, 0.042, 0.052]);
  add(sph(6), black, [0, 0.124, 0.283], [0.018, 0.014, 0.012]);
  add(new THREE.BoxGeometry(0.026, 0.03, 0.012), 0xd9822b, [0, 0.083, 0.27]);
  for (const sx of [-1, 1]) {
    add(sph(6), black, [sx * 0.046, 0.152, 0.214], [0.012, 0.012, 0.01]);
    add(sph(6), dark, [sx * 0.05, 0.18, 0.15], [0.018, 0.016, 0.011]);
    add(sph(6), dark, [sx * 0.07, 0.03, 0.1], [0.03, 0.022, 0.035]);
    add(sph(7), dark, [sx * 0.086, 0.018, -0.12], [0.04, 0.016, 0.076]);
  }
  // The tail: broad, flat and leathery, which is the one thing nobody mistakes.
  add(sph(12), tail, [0, 0.036, -0.32], [0.072, 0.018, 0.13]);
  return parts;
}

function addBeaver(batch, x, y, z, yaw, s = 1) {
  const c = Math.cos(yaw); const sn = Math.sin(yaw);
  for (const p of beaverParts()) {
    const lx = p.position[0] * s; const lz = p.position[2] * s;
    batch.add(p.g, p.color, {
      position: [x + lx * c + lz * sn, y + p.position[1] * s, z - lx * sn + lz * c],
      rotation: [0, yaw, 0], scale: p.scale.map((v) => v * s),
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The room inside the lodge: a shell, a floor of shredded wood, and the family. Its own mesh, so the
// sun the lodge keeps out does not throw the lodge's shadow over the one place a student looks into.
// ---------------------------------------------------------------------------------------------
function buildRoom() {
  const rng = seededRandom(404);
  const map = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#4a3828'; ctx.fillRect(0, 0, 256, 128);
    for (let k = 0; k < 160; k++) {
      ctx.strokeStyle = ['#6e5840', '#3a2a1c', '#8a7050', '#5a4430'][k % 4];
      ctx.lineWidth = 2 + rng() * 4; ctx.lineCap = 'round';
      const x = rng() * 256; const y = rng() * 128; const a = (rng() - 0.5) * 1.4; const l = 20 + rng() * 50;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.fillStyle = '#a8865c'; ctx.fillRect(0, 128, 256, 128);
    for (let k = 0; k < 260; k++) {
      ctx.strokeStyle = ['#c8a878', '#8a6a44', '#d8bc90'][k % 3];
      ctx.lineWidth = 1 + rng() * 1.5;
      const x = rng() * 256; const y = 128 + rng() * 128; const a = rng() * TAU; const l = 4 + rng() * 10;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(240, 240, 16, 16);
  });
  const geos = [];
  const setColor = (g, c) => {
    const n = g.attributes.position.count; const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  };
  // The shell: the back quarter of an ellipsoid. Its rim at z = ZF is the hole cut in the front face.
  const shell = new THREE.SphereGeometry(1, 16, 8, Math.PI, Math.PI, 0, Math.PI / 2).toNonIndexed();
  shell.scale(CRX, CRY, CRZ); shell.translate(LX, CF, ZF);
  const su = shell.attributes.uv;
  for (let i = 0; i < su.count; i++) su.setY(i, 0.5 + su.getY(i) * 0.5);
  setColor(shell, [1, 1, 1]);
  geos.push(shell);
  const floor = new THREE.CircleGeometry(1, 16, 0, Math.PI).toNonIndexed();
  floor.rotateX(-Math.PI / 2); floor.scale(CRX, 1, CRZ); floor.translate(LX, CF, ZF);
  const fu = floor.attributes.uv;
  for (let i = 0; i < fu.count; i++) fu.setY(i, fu.getY(i) * 0.5);
  setColor(floor, [1, 1, 1]);
  geos.push(floor);
  // The family: a parent and two kits, out of the water and dry.
  const fam = [[LX - 0.16, ZF - 0.24, 1.75, 0.92], [LX + 0.24, ZF - 0.18, -2.3, 0.56], [LX + 0.12, ZF - 0.36, 0.4, 0.5]];
  for (const [x, z, yaw, s] of fam) {
    const c = Math.cos(yaw); const sn = Math.sin(yaw);
    for (const p of beaverParts()) {
      const g = p.g.toNonIndexed ? (p.g.index ? p.g.toNonIndexed() : p.g.clone()) : p.g;
      g.scale(p.scale[0] * s, p.scale[1] * s, p.scale[2] * s);
      g.rotateY(yaw);
      const lx = p.position[0] * s; const lz = p.position[2] * s;
      g.translate(x + lx * c + lz * sn, CF + p.position[1] * s, z - lx * sn + lz * c);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.97, 0.03);
      const col = new THREE.Color(p.color);
      setColor(g, [col.r, col.g, col.b]);
      geos.push(g);
    }
  }
  const g = mergeGeometries(geos, false);
  const m = mesh(g, standard({ map, vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, emissive: 0x8a6440, emissiveMap: map, emissiveIntensity: 0.3 }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------------------------------------
// The one that moves: a beaver swimming its rounds of the pond, with the V it draws on the water.
// ---------------------------------------------------------------------------------------------
function buildSwimmer() {
  const tp = []; const tn = []; const tc = [];
  for (const p of beaverParts()) {
    const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
    g.scale(...p.scale); g.translate(...p.position);
    const pa = g.attributes.position; const na = g.attributes.normal;
    const col = new THREE.Color(p.color);
    for (let i = 0; i < pa.count; i++) {
      tp.push(pa.getX(i), pa.getY(i), pa.getZ(i)); tn.push(na.getX(i), na.getY(i), na.getZ(i)); tc.push(col.r, col.g, col.b);
    }
  }
  // The wake: two arms opening behind the head, fading back into the water's colour.
  const SINK = 0.074; // how far the body rides below the surface
  const wy = SINK + 0.004;
  const foam = [0.72, 0.8, 0.78]; const pondLin = [0.05, 0.11, 0.12];
  for (const side of [-1, 1]) {
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs; const t1 = (i + 1) / segs;
      const at = (t) => [side * (0.04 + 0.48 * t), 0.24 - 1.15 * t];
      const wid = (t) => 0.055 * (1 - t * 0.6);
      const [ax, az] = at(t0); const [bx, bz] = at(t1);
      const nx = side * 0.92; const nz = 0.38;
      const a1 = [ax - nx * wid(t0) * 0.5, wy, az - nz * wid(t0) * 0.5]; const a2 = [ax + nx * wid(t0) * 0.5, wy, az + nz * wid(t0) * 0.5];
      const b1 = [bx - nx * wid(t1) * 0.5, wy, bz - nz * wid(t1) * 0.5]; const b2 = [bx + nx * wid(t1) * 0.5, wy, bz + nz * wid(t1) * 0.5];
      const ca = mixc(foam, pondLin, t0 ** 0.8); const cb = mixc(foam, pondLin, t1 ** 0.8);
      const tri = (p, q, r, cp, cq, cr) => {
        const ux = q[0] - p[0]; const uz = q[2] - p[2]; const vx = r[0] - p[0]; const vz = r[2] - p[2];
        const list = (uz * vx - ux * vz) >= 0 ? [[p, cp], [q, cq], [r, cr]] : [[p, cp], [r, cr], [q, cq]];
        for (const [pt, cc] of list) { tp.push(...pt); tn.push(0, 1, 0); tc.push(...cc); }
      };
      tri(a1, a2, b2, ca, ca, cb); tri(a1, b2, b1, ca, cb, cb);
    }
  }
  const count = tp.length / 3;
  const src = new Float32Array(tp); const nor = new Float32Array(tn);
  const P = new Float32Array(count * 3); const N = new Float32Array(count * 3);

  // Its rounds: a loop of the open pond, clear of the lodge, the cache and the fallen tree.
  const path = (t) => {
    const a = t * 0.2 + 1.2;
    return [-5.9 + 1.9 * Math.cos(a) + 0.2 * Math.sin(a * 2), PW - SINK, 1.05 + 1.2 * Math.sin(a) + 0.22 * Math.sin(a * 2 + 0.7)];
  };
  const write = (time) => {
    const a = path(time); const b = path(time + 0.05);
    let dx = b[0] - a[0]; let dz = b[2] - a[2];
    const flat = Math.hypot(dx, dz) || 1e-4; dx /= flat; dz /= flat;
    for (let i = 0; i < count; i++) {
      const x = src[i * 3]; const y = src[i * 3 + 1]; const z = src[i * 3 + 2];
      const nx = nor[i * 3]; const ny = nor[i * 3 + 1]; const nz = nor[i * 3 + 2];
      P[i * 3] = a[0] + x * dz + z * dx; P[i * 3 + 1] = a[1] + y; P[i * 3 + 2] = a[2] - x * dx + z * dz;
      N[i * 3] = nx * dz + nz * dx; N[i * 3 + 1] = ny; N[i * 3 + 2] = -nx * dx + nz * dz;
    }
  };
  write(0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tc), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(-5.9, PW, 1.05), 2.8);
  const m = mesh(g, standard({ vertexColors: true, roughness: 0.6, metalness: 0 }));
  m.update = (time) => {
    write(time);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  };
  return m;
}

// ---------------------------------------------------------------------------------------------
// What stands on top
// ---------------------------------------------------------------------------------------------
function addAspen(batch, x, y, z, h, rng, { gnawed = false } = {}) {
  const bark = (px, py) => {
    // Pale aspen bark with the dark marks it carries.
    const mark = Math.sin(py * 23 + px * 7) > 0.86 ? 0.45 : 1;
    return [0.62 * mark, 0.6 * mark, 0.52 * mark];
  };
  const r = h * 0.03;
  if (gnawed) {
    // The beaver's hourglass, cut from both sides, pale where the wood shows.
    batch.add(new THREE.CylinderGeometry(r, r * 1.1, 0.07, 8), bark, { position: [x, y + 0.035 - 0.02, z] });
    batch.add(new THREE.CylinderGeometry(r * 0.3, r, 0.08, 8), 0xe2c696, { position: [x, y + 0.09, z] });
    batch.add(new THREE.CylinderGeometry(r, r * 0.3, 0.08, 8), 0xe2c696, { position: [x, y + 0.17, z] });
    batch.add(new THREE.CylinderGeometry(r * 0.75, r, h * 0.7, 8), bark, { position: [x, y + 0.21 + h * 0.35, z] });
  } else {
    batch.add(new THREE.CylinderGeometry(r * 0.7, r * 1.05, h * 0.82, 8), bark, { position: [x, y + h * 0.41 - 0.03, z] });
  }
  const golds = [0xd8b236, 0xc9c03e, 0x9db642, 0xe0a432, 0x86a83c];
  const crownY = y + h * 0.78;
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU; const q = rng() * 0.6;
    const s = h * (0.1 + rng() * 0.06);
    batch.add(blobGeometry(rng, 1, 0.2), golds[Math.floor(rng() * golds.length)], {
      position: [x + Math.cos(a) * q * h * 0.12, crownY + (rng() - 0.3) * h * 0.22, z + Math.sin(a) * q * h * 0.12],
      scale: [s, s * 1.5, s], rotation: [0, rng() * TAU, 0],
    });
  }
}

function addWillow(batch, x, y, z, s, rng) {
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU; const lean = 0.08 + rng() * 0.12;
    batch.add(tube([[x, y - 0.02, z], [x + Math.cos(a) * lean * s, y + s * 0.5, z + Math.sin(a) * lean * s], [x + Math.cos(a) * lean * s * 2, y + s * (0.85 + rng() * 0.2), z + Math.sin(a) * lean * s * 2]], 0.012 * s, { sides: 3, steps: 2 }), 0x7a4a2a);
  }
  const greens = [0x8aa05a, 0x7d9a4e, 0x9aae66, 0x6f8e48];
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU; const q = rng() * 0.25 * s;
    const w = s * (0.22 + rng() * 0.1);
    batch.add(blobGeometry(rng, 1, 0.22), greens[Math.floor(rng() * greens.length)], {
      position: [x + Math.cos(a) * q, y + s * (0.55 + rng() * 0.35), z + Math.sin(a) * q], scale: [w, w * 1.25, w],
    });
  }
}

function addSedge(batch, x, y, z, rng) {
  const greens = [0x5f8a3e, 0x74983f, 0x8aa54a, 0x4f7a36];
  const c = greens[Math.floor(rng() * greens.length)];
  for (let i = 0; i < 4; i++) {
    const h = 0.14 + rng() * 0.12;
    batch.add(new THREE.ConeGeometry(0.012, h, 3, 1, true), c, {
      position: [x + (rng() - 0.5) * 0.05, y + h * 0.45, z + (rng() - 0.5) * 0.05],
      rotation: [(rng() - 0.5) * 0.6, rng() * TAU, (rng() - 0.5) * 0.6],
    });
  }
}

function addCattail(batch, x, y, z, rng) {
  const h = 0.32 + rng() * 0.16;
  const lean = (rng() - 0.5) * 0.12;
  batch.add(new THREE.CylinderGeometry(0.005, 0.007, h, 4), 0x6a8a44, { position: [x, y + h / 2, z], rotation: [lean, 0, lean] });
  batch.add(new THREE.CylinderGeometry(0.017, 0.017, 0.085, 6), 0x5a3a22, { position: [x + lean * h * 0.4, y + h * 0.82, z - lean * h * 0.4], rotation: [lean, 0, lean] });
  batch.add(new THREE.ConeGeometry(0.01, h * 0.8, 3), 0x7a9a4a, { position: [x + 0.02, y + h * 0.35, z], rotation: [0.15, rng() * 3, 0.1] });
}

function buildScenery(root) {
  const batch = new Batch();
  const rng = seededRandom(1907);
  // The base.
  batch.add(new THREE.BoxGeometry(W + 0.6, PLINTH * 0.62, D + 0.6), 0x3b2a1c, { position: [0, PLINTH * 0.31, 0] });
  batch.add(new THREE.BoxGeometry(W + 0.3, PLINTH * 0.38, D + 0.3), 0x4a3524, { position: [0, PLINTH * 0.81, 0] });

  const stickColors = [0x7d6a52, 0x6a5844, 0x927c60, 0xd8c49c, 0x5a4a3a, 0xa88f6c];
  const pick = () => stickColors[Math.floor(rng() * stickColors.length)];
  const lay = (pts, r, color, sides = 4) => batch.add(tube(pts, r, { sides, steps: Math.max(1, pts.length - 1), round: 0 }), color);

  // The dam's sticks, laid with the stream: most of what you see of a dam is the downstream face.
  let laid = 0;
  for (let k = 0; k < 900 && laid < 130; k++) {
    const z = -3.0 + rng() * (ZF - 0.12 + 3.0);
    const dx0 = -0.2 + rng() * 0.95; const len = 0.35 + rng() * 0.6;
    const a = rng() > 0.45 ? (rng() - 0.5) * 0.8 : (rng() - 0.5) * 2.6;
    const x0 = damX(z) + dx0; const z0 = z;
    const x1 = x0 + Math.cos(a) * len; const z1 = z0 + Math.sin(a) * len;
    if (Math.max(z0, z1) > ZF - 0.05) continue;
    const ya = damH(x0, z0); const yb = damH(x1, z1);
    const ba = base(x0, z0); const bb = base(x1, z1);
    if (ya < ba + 0.03 || yb < bb + 0.03) continue;
    const r = 0.014 + rng() * 0.016;
    const xm = (x0 + x1) / 2; const zm = (z0 + z1) / 2;
    lay([[x0, ya + r * 0.4, z0], [xm, Math.max(damH(xm, zm), base(xm, zm)) + r * 0.6, zm], [x1, yb + r * 0.4, z1]], r, pick(), 5);
    laid += 1;
  }
  // The lodge's sticks: a heap, with a bare patch on top where the air gets in.
  laid = 0;
  for (let k = 0; k < 1200 && laid < 120; k++) {
    const a = rng() * TAU; const q = Math.sqrt(rng()) * 0.95;
    const x = LX + Math.cos(a) * q * LR; const z = ZF + Math.sin(a) * q * LR * 0.95;
    if (z > ZF - 0.08) continue;
    const dir = rng() * Math.PI; const len = 0.3 + rng() * 0.5;
    const pa = [x - Math.cos(dir) * len / 2, z - Math.sin(dir) * len / 2];
    const pb = [x + Math.cos(dir) * len / 2, z + Math.sin(dir) * len / 2];
    if (Math.max(pa[1], pb[1]) > ZF - 0.04) continue;
    const top = (px, pz) => { const b = base(px, pz); return Math.max(b, lodgeH(px, pz, b)); };
    const r = 0.012 + rng() * 0.013;
    lay([[pa[0], top(pa[0], pa[1]) + r * 0.3, pa[1]], [x, top(x, z) + r * 0.7, z], [pb[0], top(pb[0], pb[1]) + r * 0.3, pb[1]]], r, pick(), 5);
    laid += 1;
  }
  // The food cache: branches standing up out of the water, some still in leaf.
  // A raft of branches on the surface with the ends of the rest poking up through it, leaning every way.
  for (let k = 0; k < 22; k++) {
    const a = rng() * TAU; const r = Math.sqrt(rng()) * 0.42;
    const x = CACHE[0] + Math.cos(a) * r; const z = CACHE[1] - 0.25 + Math.sin(a) * r * 0.7;
    const lean = rng() * TAU; const tilt = 0.25 + rng() * 0.5;
    const len = 0.22 + rng() * 0.25;
    const tip = [x + Math.cos(lean) * tilt * len, PW + len * (1 - tilt * 0.6), Math.min(ZF - 0.04, z + Math.sin(lean) * tilt * len)];
    lay([[x, PW - 0.12, z], tip], 0.008 + rng() * 0.009, pick());
    if (rng() > 0.7) batch.add(blobGeometry(rng, 0, 0.2), rng() > 0.5 ? 0xa89038 : 0x7f8f3c, { position: tip, scale: [0.03, 0.022, 0.03] });
  }
  for (let k = 0; k < 12; k++) {
    const a = rng() * Math.PI; const len = 0.4 + rng() * 0.4;
    const cx = CACHE[0] + (rng() - 0.5) * 0.6; const cz = CACHE[1] - 0.3 + (rng() - 0.5) * 0.4;
    const p0 = [cx - Math.cos(a) * len / 2, PW + 0.01, cz - Math.sin(a) * len / 2];
    const p1 = [cx + Math.cos(a) * len / 2, PW + 0.02, Math.min(ZF - 0.05, cz + Math.sin(a) * len / 2)];
    lay([p0, p1], 0.011 + rng() * 0.008, pick());
  }

  // Gnawed stumps, pencil-pointed, and the aspen the beavers are still working on.
  for (const [x, z, r] of STUMPS) {
    const y = ground(x, z);
    batch.add(new THREE.CylinderGeometry(r, r * 1.12, 0.14, 9), 0xb4ae9e, { position: [x, y + 0.05, z] });
    batch.add(new THREE.ConeGeometry(r, 0.13, 9), 0xe2c696, { position: [x, y + 0.185, z] });
  }
  {
    const [sx, sz] = FELLED.stump; const y = ground(sx, sz);
    batch.add(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 9), 0xb4ae9e, { position: [sx, y + 0.04, sz] });
    batch.add(new THREE.ConeGeometry(0.075, 0.1, 9), 0xe2c696, { position: [sx, y + 0.15, sz] });
    // The tree it was, down and reaching into the pond: food, and building, both.
    const [tx, tz] = FELLED.tip;
    const mid = [(sx + tx) / 2, 0, (sz + tz) / 2];
    mid[1] = Math.max(ground(mid[0], mid[2]), PW) + 0.07;
    lay([[sx + 0.05, y + 0.12, sz + 0.08], mid, [tx, PW + 0.06, tz]], [0.062, 0.05, 0.034], 0xc8c2b0);
    for (let i = 0; i < 5; i++) {
      const t = 0.6 + i * 0.09;
      const p = [mix(sx, tx, t), mix(y + 0.12, PW + 0.06, t) + 0.02, mix(sz, tz, t)];
      const a = (i % 2 ? 1 : -1) * (0.5 + rng() * 0.5);
      const q = [p[0] + Math.cos(a) * 0.32, p[1] + 0.12, p[2] + Math.sin(a) * 0.32 + 0.1];
      lay([p, q], 0.014, 0xb8b2a0);
      batch.add(blobGeometry(rng, 1, 0.2), [0xd8b236, 0xc9c03e, 0x9db642][i % 3], { position: q, scale: [0.12, 0.09, 0.12] });
    }
  }
  addAspen(batch, GNAWING[0], ground(...GNAWING), GNAWING[1], 2.1, rng, { gnawed: true });

  // Aspen and spruce on the hillside, aspen nearest the water because that is what beavers eat.
  const placed = [];
  const clear = (x, z, r) => placed.every(([px, pz]) => Math.hypot(px - x, pz - z) > r)
    && [...STUMPS, FELLED.stump, GNAWING].every(([px, pz]) => Math.hypot(px - x, pz - z) > 0.55);
  for (let k = 0; k < 800 && placed.length < 15; k++) {
    const x = X0 + 0.4 + rng() * (W - 0.8); const z = Z0 + 0.3 + rng() * 2.6;
    const y = ground(x, z);
    if (x < damX(z) && y < PW + 0.25) continue;
    if (!clear(x, z, 0.75)) continue;
    addAspen(batch, x, y, z, 1.7 + rng() * 0.7, rng);
    placed.push([x, z]);
  }
  for (let k = 0; k < 600 && placed.length < 23; k++) {
    const x = X0 + 0.4 + rng() * (W - 0.8); const z = Z0 + 0.25 + rng() * 1.2;
    if (!clear(x, z, 0.7)) continue;
    addPine(batch, x, ground(x, z) - 0.02, z, 1.9 + rng() * 0.8, rng, 0x2c4d33);
    placed.push([x, z]);
  }

  // Willow along the stream, sedge and pools over the wet meadow, cattails round the pond.
  for (let k = 0; k < 400 && placed.length < 32; k++) {
    const t = rng();
    const p = STREAM[Math.floor(t * (STREAM.length - 1))];
    const side = rng() > 0.5 ? 1 : -1;
    const x = p[0] + (rng() - 0.5) * 0.4; const z = p[1] + side * (0.42 + rng() * 0.3);
    if (x < damX(z) + 1.2 || z > ZF - 0.4) continue;
    if (!clear(x, z, 0.75)) continue;
    addWillow(batch, x, ground(x, z), z, 0.55 + rng() * 0.3, rng);
    placed.push([x, z]);
  }
  let tufts = 0;
  for (let k = 0; k < 3000 && tufts < 150; k++) {
    const x = damX(0) + 1.1 + rng() * (X1 - damX(0) - 1.3); const z = -1.6 + rng() * (ZF - 1.6 - 0.15);
    const y = ground(x, z);
    if (y < swl(x) + 0.01) continue;
    if (y - wtAt(x, z) > 0.18 && rng() > 0.15) continue;
    addSedge(batch, x, y, z, rng);
    tufts += 1;
  }
  let tails = 0;
  for (let k = 0; k < 4000 && tails < 34; k++) {
    const x = X0 + 0.2 + rng() * 7.6; const z = -2.8 + rng() * 7.6;
    if (x > damX(z) - 0.35 || z > ZF - 0.12) continue;
    const y = ground(x, z);
    const depth = PW - y;
    if (depth < -0.03 || depth > 0.12) continue;
    if (Math.hypot(x - LX, z - ZF) < LR + 0.25) continue;
    addCattail(batch, x, Math.max(y, PW - 0.02), z, rng);
    tails += 1;
  }

  // A beaver on the dam with a stick, mending it: dams leak, and a family works on one all year.
  {
    const z = 2.6; const x = damX(z) + 0.02;
    addBeaver(batch, x, damH(x, z) - 0.01, z, -2.3, 1);
    const yaw = -2.3; const c = Math.cos(yaw); const s = Math.sin(yaw);
    const hx = x + 0.27 * s; const hz = z + 0.27 * c; const hy = damH(x, z) + 0.09;
    lay([[hx - c * 0.3, hy + 0.02, hz + s * 0.3], [hx + c * 0.3, hy - 0.01, hz - s * 0.3]], 0.012, 0xd8c49c);
  }

  const onWater = (text, x, z, lift = 0.5) => ({ text, x, z, y: PW + lift, ground: PW });
  const onLand = (text, x, z, lift = 0.5) => ({ text, x, z, y: ground(x, z) + lift, ground: ground(x, z) });
  signs(root, batch, [
    onWater('Beaver pond', -7.0, 0.4, 0.62),
    onWater('Lodge', LX + 0.15, ZF - 1.75, 0.95),
    onWater('Food cache', CACHE[0] - 0.55, CACHE[1] - 0.8, 0.55),
    onLand('Dam', damX(1.6) + 0.42, 1.6, 0.45),
    onLand('Gnawed aspen', -4.0, -3.05, 0.42),
    onLand('Wet meadow', 2.7, 2.2, 0.5),
    onLand('Drier ground', 7.5, 3.6, 0.5),
    onLand('Stream', 6.15, 1.35, 0.55),
  ], { plate: 0.26 });
  root.add(batch.mesh());
}

function buildBeaverDam() {
  const root = new THREE.Group();
  root.name = 'beaver-dam';
  root.add(buildGround());
  root.add(buildWater());
  root.add(buildRoom());
  const swimmer = buildSwimmer();
  root.add(swimmer);
  buildScenery(root);
  if (!reducedMotion()) {
    let t = 0;
    root.userData.tick = { update(dt) { t += dt; swimmer.update(t); } };
  }
  return root;
}

export const BUILDERS = {
  'beaver-dam': () => buildBeaverDam(),
};
