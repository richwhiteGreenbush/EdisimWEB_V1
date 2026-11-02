import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  Batch, signs, addBroadleaf, addPalm, blobGeometry, seededRandom,
  mixc, shade, clamp01, sstep, mix, noise2, fbm, TAU,
} from '../geo/GeoKit.js';
import { mesh, standard, canvasTexture } from '../../PropKit.js';
import { tube, lathe, outward, lin } from '../ModelKit.js';
import { reducedMotion } from '../../Settings.js';

// The Great Barrier Reef, as a museum diorama. One idea carries it: A REEF IS A THIN LIVING SKIN ON
// ROCK ITS ANCESTORS BUILT. So the block runs the way the real shelf does, from the Queensland coast
// across a lagoon to a ribbon reef and the drop into the Coral Sea, and its front is opened like a
// display case: corals and fish in the room above, and the limestone in section below them.
//
// From above it reads like a map, which is how everyone knows this place, though the stretch is made
// up and the plate says so. The reef mosaic and the surf are painted on the water from the same bed the mesh is built from. From the front it is a place. The
// two scales cannot agree, and the card says so.
//
// Six meshes whatever the coral count: ground, water, coral, fish, scenery, labels. Authored in feet,
// origin at the base centre, front toward +Z. West, the coast, is at -X.

const W = 18; const D = 11;
const X0 = -W / 2; const Z0 = -D / 2; const ZF = D / 2;
const PLINTH = 0.3;
export const REEF = { SEA: 3.3, LAGOON: 1.3, CREST: 3.14, DEEP: 0.5 };
const { SEA, LAGOON, CREST, DEEP } = REEF;
const NX = 120; const NZ = 66;
// The back of the opened room sits exactly on a row of the ground's grid, so the wall behind it and
// the floor share their stations and no crack can open between them.
const ZB = Z0 + (40 / NZ) * D;
const FONT = 'Arial, Helvetica, sans-serif';

// ---------------------------------------------------------------------------------------------
// One description of the sea bed. The mesh, the map on the water and the cut face all read it.
// ---------------------------------------------------------------------------------------------
const coast = (z) => -5.7 + 0.55 * Math.sin(z * 0.6 + 1) + 0.25 * Math.sin(z * 1.7);
export const reefCentre = (z) => 4.3 + 0.55 * Math.sin(z * 0.33 + 0.6);
// The gaps in a ribbon reef, which are what make it a ribbon rather than a wall. None across the room.
const gap = (z) => clamp01(1 - 0.92 * (Math.exp(-(((z + 1.2) / 0.34) ** 2)) + Math.exp(-(((z + 4.1) / 0.28) ** 2))));

const PATCHES = [
  [-2.5, -3.7, 1.15, 0.72], [0.65, -1.35, 1.05, 1.25], [-3.7, -0.6, 0.62, 0.86], [-0.8, -4.65, 0.85, 0.5], [1.9, -4.1, 0.6, 0.85], [-4.1, -3.05, 0.42, 0.55],
];
// Coral heads on the room's floor. They stop well short of the surface, so fish can pass over them.
const BOMMIES = [[-1.55, 3.45, 0.95, 0.75, 2.05], [-3.75, 2.1, 0.75, 0.62, 1.95], [0.55, 2.2, 0.7, 0.6, 2.05]];
const CAY = [0.65, -1.35, 0.5, 0.74];
export const HEART = [-1.35, -1.0, 0.62];

// The classic implicit heart, in a unit square, with its point toward the viewer.
function heartAt(x, z) {
  const u = (x - HEART[0]) / HEART[2]; const v = -(z - HEART[1]) / HEART[2] + 0.1;
  const a = u * u + v * v - 1;
  return a * a * a - u * u * v * v * v;
}

export function bed(x, z) {
  const c = coast(z);
  if (x < c) {
    const t = c - x;
    const back = 0.55 + 0.45 * sstep(-z, -2, 4);
    return SEA + 0.26 * sstep(t, 0, 0.55) + 3.5 * back * sstep(t, 0.7, 3.6) + 0.34 * sstep(t, 0.4, 1.5) * (fbm(x * 0.8, z * 0.8, 3, 41) + 0.4);
  }
  const lagoon = LAGOON + 0.13 * fbm(x * 0.5, z * 0.5, 3, 3);
  let y = mix(SEA - 0.03, lagoon, sstep(x - c, 0, 1.5));
  const R = reefCentre(z);
  const open = gap(z);
  const crest = mix(2.15, CREST + 0.03 * noise2(x * 1.3, z * 1.3, 8), open);
  y = mix(y, crest, sstep(x, R - 2.6, R - 0.7));
  if (x > R + 0.55) y = mix(crest, DEEP + 0.05 * fbm(x * 0.8, z * 0.8, 2, 6), clamp01((x - R - 0.55) / 1.9) ** 0.72);
  for (const [px, pz, rx, rz] of PATCHES) {
    const q = Math.hypot((x - px) / rx, (z - pz) / rz) + 0.1 * noise2(x * 2.1, z * 2.1, 11);
    if (q < 1.25) y = Math.max(y, mix(CREST - 0.02, y, sstep(q, 0.62, 1.25)));
  }
  for (const [px, pz, rx, rz, top] of BOMMIES) {
    const q = Math.hypot((x - px) / rx, (z - pz) / rz);
    if (q < 1) y = Math.max(y, mix(top, y, sstep(q, 0.2, 1)));
  }
  if (z < ZB - 0.2) {
    if (heartAt(x, z) < 0) y = Math.max(y, CREST);
    const q = Math.hypot((x - CAY[0]) / CAY[2], (z - CAY[1]) / CAY[3]) + 0.08 * noise2(x * 3, z * 3, 7);
    if (q < 1) y = Math.max(y, SEA - 0.03 + 0.26 * Math.sqrt(1 - q * q));
  }
  return y;
}

// A caustic web: a MIN of wave trains, because a sum is combed and this closes into cells.
function caustic(x, z) {
  const a = Math.abs(Math.sin(x * 5.1 + 1.7 * Math.sin(z * 2.3)));
  const b = Math.abs(Math.sin(z * 4.7 + 1.9 * Math.sin(x * 2.9)));
  const c = Math.abs(Math.sin((x + z) * 3.7 + 1.3 * Math.sin((x - z) * 2.1)));
  const m = 1 - Math.min(a, b, c);
  return m * m * m * m;
}

// Water takes the red out of the light first, so anything deep is bluer. Colours are sRGB bytes.
const deepen = (c, y) => {
  const k = clamp01((SEA - y) / 2.9);
  return [c[0] * (1 - 0.52 * k), c[1] * (1 - 0.2 * k), c[2] * (1 + 0.04 * k)];
};

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

function fitLabel(ctx, text, x, y, size, maxWidth, { dark = true } = {}) {
  ctx.save();
  let s = size;
  ctx.font = `700 ${s}px ${FONT}`;
  const tw = ctx.measureText(text).width;
  if (tw > maxWidth) { s *= maxWidth / tw; ctx.font = `700 ${s}px ${FONT}`; }
  const width = Math.min(tw, maxWidth);
  const pad = s * 0.42;
  if (dark) {
    ctx.fillStyle = 'rgba(16,22,30,0.78)';
    ctx.fillRect(x - width / 2 - pad, y - s * 0.74, width + pad * 2, s * 1.48);
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + s * 0.03);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// The ground: its top and its cut face, on one atlas
// ---------------------------------------------------------------------------------------------
function buildGround() {
  let topY = 0;
  for (let i = 0; i <= NX; i++) topY = Math.max(topY, bed(X0 + (i / NX) * W, ZF));
  const TW = 1600; const TH = Math.round(TW * D / W); const FH = Math.round(TW * (topY - PLINTH) / W);
  const AH = TH + FH;
  const pxPerFoot = TW / W;
  const rng = seededRandom(2300);
  const map = canvasTexture(TW, AH, (ctx) => {
    paintRegion(ctx, 0, 0, TW, TH, (px, py) => {
      const x = X0 + ((px + 0.5) / TW) * W; const z = Z0 + ((py + 0.5) / TH) * D;
      // Under the painted sea behind the room nothing can ever see this, so it is not even worked out.
      if (z < ZB - 0.3 && x > coast(z) + 0.2 && Math.hypot((x - CAY[0]) / CAY[2], (z - CAY[1]) / CAY[3]) > 1.2) return [120, 150, 150];
      const h = bed(x, z);
      const n = fbm(x * 2.6, z * 2.6, 3, 21) * 0.5 + 0.5;
      if (h > SEA - 0.035) {
        const a = h - SEA;
        const sand = mixc([240, 228, 190], [214, 198, 156], n);
        if (x > -3) return mixc(sand, mixc([70, 116, 52], [104, 136, 60], n), sstep(a, 0.12, 0.2));
        const forest = mixc([24, 74, 38], [58, 112, 46], fbm(x * 5.2, z * 5.2, 3, 23) * 0.5 + 0.5);
        const scrub = mixc([62, 86, 46], [92, 110, 58], n);
        return mixc(mixc(sand, scrub, sstep(a, 0.06, 0.16)), forest, sstep(a, 0.16, 0.44));
      }
      // The room's floor: pale sand on the lagoon, broken coral rock on the reef, with pink crust.
      const ripple = 1 + 0.05 * Math.sin(x * 8.5 + z * 2.4 + 3 * noise2(x * 0.8, z * 0.8, 5));
      const sand = shade(mixc([232, 220, 182], [206, 192, 152], n), ripple);
      const rocky = sstep(h, LAGOON + 0.3, LAGOON + 0.72) * sstep(x - coast(z), 1.4, 1.75);
      const rock = mixc([146, 124, 104], [192, 128, 138], sstep(fbm(x * 3.4, z * 3.4, 3, 27), -0.1, 0.4));
      const c = deepen(mixc(sand, rock, rocky), h);
      const k = 1 + caustic(x, z) * 0.34 * (1 - clamp01((SEA - h) / 3.4) * 0.5);
      return [c[0] * k, c[1] * k, c[2] * k];
    });
    // The cut face. What the whole model is for: how little of a reef is alive.
    const yOf = (py) => topY - ((py + 0.5) / FH) * (topY - PLINTH);
    const oldTop = (x) => 0.92 + 0.11 * fbm(x * 0.7, 3.1, 3, 31);
    paintRegion(ctx, 0, TH, TW, FH, (px, py) => {
      const x = X0 + ((px + 0.5) / TW) * W; const y = yOf(py);
      const g = bed(x, ZF);
      const under = g - y;
      if (under < 0) return [36, 66, 90];
      const grain = noise2(x * 24, y * 24, 12) * 0.5 + noise2(x * 57, y * 57, 13) * 0.5;
      let c;
      if (x < coast(ZF)) {
        const band = Math.sin((y + 0.14 * fbm(x * 0.8, y * 0.5, 2, 33)) * 12);
        c = mixc([106, 82, 60], [134, 106, 78], band * 0.5 + 0.5);
        if (under < 0.16) c = [52, 42, 30];
      } else if (y < oldTop(x)) {
        c = mixc([104, 98, 90], [128, 120, 108], Math.sin((y + 0.1 * noise2(x, y, 3)) * 34) * 0.5 + 0.5);
      } else {
        const reef = sstep(g, LAGOON + 0.42, LAGOON + 0.95) * sstep(x - coast(ZF), 1.4, 1.75);
        const sediment = mixc([184, 164, 126], [158, 138, 102], Math.sin((y + 0.06 * noise2(x * 2, y, 9)) * 26) * 0.5 + 0.5);
        const lime = mixc([226, 214, 182], [204, 190, 156], fbm(x * 3.2, y * 3.2, 3, 35) * 0.5 + 0.5);
        c = mixc(sediment, lime, reef);
        // The living skin, an inch of colour over all that stone.
        const skin = reef * (1 - sstep(under, 0.05 + 0.02 * noise2(x * 6, 1, 4), 0.1));
        c = mixc(c, mixc([196, 82, 118], [224, 136, 74], noise2(x * 4, 2, 5) * 0.5 + 0.5), skin);
      }
      return shade(c, 1 + grain * 0.1);
    });
    // Old corals turned to stone, in the limestone only, sized so they read as shapes.
    const fx = (x) => ((x - X0) / W) * TW;
    const fy = (y) => TH + ((topY - y) / (topY - PLINTH)) * FH;
    for (let i = 0; i < 210; i++) {
      const x = 1.2 + rng() * 6.6;
      const g = bed(x, ZF);
      const y = oldTop(x) + 0.08 + rng() * Math.max(0.05, g - oldTop(x) - 0.2);
      const v = rng();
      if (y > g - 0.14 || g < LAGOON + 0.7 || v > 0.92) continue;
      const tone = 150 + rng() * 34;
      ctx.strokeStyle = `rgba(${tone},${tone * 0.9},${tone * 0.72},0.7)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (rng() > 0.5) {
        // A dome, as a massive coral grew.
        const r = 7 + rng() * 15;
        ctx.arc(fx(x), fy(y), r, Math.PI, 0);
        ctx.arc(fx(x), fy(y) + 3, r * 0.64, 0, Math.PI, true);
      } else {
        // A branching coral, as a few forks.
        let a = -Math.PI / 2 + (rng() - 0.5);
        const x0 = fx(x); const y0 = fy(y);
        for (let k = 0; k < 4; k++) {
          ctx.moveTo(x0, y0);
          a += (rng() - 0.5) * 1.1;
          const l = 7 + rng() * 10;
          const xa = x0 + Math.cos(a) * l; const ya = y0 + Math.sin(a) * l;
          ctx.lineTo(xa, ya);
          ctx.lineTo(xa + Math.cos(a + 0.6) * l * 0.6, ya + Math.sin(a + 0.6) * l * 0.6);
        }
      }
      ctx.stroke();
    }
    // The line where the old reef stops and today's begins.
    ctx.strokeStyle = 'rgba(58,44,34,0.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let px = fx(coast(ZF)) + 8; px < TW; px += 6) {
      const x = X0 + (px / TW) * W;
      const yy = fy(oldTop(x));
      if (px < fx(coast(ZF)) + 14) ctx.moveTo(px, yy); else ctx.lineTo(px, yy);
    }
    ctx.stroke();

    const at = (x, y) => [fx(x), fy(y)];
    const L = (text, x, y, feet, room) => { const [a, b] = at(x, y); fitLabel(ctx, text, a, b, feet * pxPerFoot, room * pxPerFoot); };
    const land = (coast(ZF) + X0) / 2;
    L('Great Barrier Reef', land, 2.55, 0.4, 2.55);
    L('Queensland, Australia', land, 2.03, 0.26, 2.4);
    L('A made-up stretch of reef:', land, 1.4, 0.18, 2.55);
    L('depths squeezed, animals enlarged', land, 1.1, 0.18, 2.55);
    L('Living coral: a thin skin', 4.4, 2.78, 0.19, 1.95);
    L('Limestone built by the', 4.32, 2.2, 0.2, 2.5);
    L('skeletons of corals that', 4.32, 1.9, 0.2, 2.8);
    L('lived here before', 4.32, 1.6, 0.2, 2.8);
    L('Sand and mud on the lagoon floor', -1.9, 1.08, 0.2, 5);
    L('Older reef rock from before the last ice age, when this shelf was dry land', 1.1, 0.55, 0.22, 13);
  });

  const ring = NX + 1;
  const pos = new Float32Array(ring * (NZ + 1) * 3); const uvs = new Float32Array(ring * (NZ + 1) * 2);
  const H = new Float32Array(ring * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) {
      const k = i + j * ring;
      const x = X0 + (i / NX) * W; const z = Z0 + (j / NZ) * D;
      H[k] = bed(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      uvs[k * 2] = i / NX; uvs[k * 2 + 1] = 1 - ((j / NZ) * TH) / AH;
    }
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = i + j * ring; const b = a + 1; const c = a + ring; const e = c + 1;
      // Everything under the sea behind the room is hidden by the painted water, so it is left out.
      if (j < 40 && Math.max(H[a], H[b], H[c], H[e]) < SEA - 0.05) continue;
      idx.push(a, c, b, b, c, e);
    }
  }
  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  land.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  land.setIndex(idx);
  land.computeVertexNormals();

  // The front: one polygon whose top edge is the bed. The texture carries all of its detail.
  const pts = [new THREE.Vector2(X0, PLINTH), new THREE.Vector2(-X0, PLINTH)];
  for (let i = NX; i >= 0; i--) { const x = X0 + (i / NX) * W; pts.push(new THREE.Vector2(x, bed(x, ZF))); }
  const shaped = new THREE.ShapeGeometry(new THREE.Shape(pts));
  const face = shaped.index ? shaped.toNonIndexed() : shaped;
  const p = face.attributes.position;
  const fuv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    fuv[i * 2] = (p.getX(i) - X0) / W;
    fuv[i * 2 + 1] = 1 - (TH + ((topY - p.getY(i)) / (topY - PLINTH)) * FH) / AH;
    p.setZ(i, ZF);
  }
  face.setAttribute('uv', new THREE.BufferAttribute(fuv, 2));
  face.deleteAttribute('color');
  const g = mergeGeometries([land.toNonIndexed(), face], false);
  return mesh(g, standard({ map, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
}

// ---------------------------------------------------------------------------------------------
// The water: the map on top, the underside of the surface, the room's back wall, the outer walls.
// None of it casts a shadow, or the sun could never reach the corals in the room.
// ---------------------------------------------------------------------------------------------
function seaMap(x, z) {
  const h = bed(x, z);
  const d = SEA - h;
  const R = reefCentre(z);
  const n = fbm(x * 1.5, z * 1.5, 3, 12) * 0.5 + 0.5;
  const mottle = fbm(x * 7, z * 7, 3, 14) * 0.5 + 0.5;
  let c;
  const out = x - (R + 0.55);
  if (out > 0) {
    // Beyond the reef the shelf ends and the colour goes with it, very quickly.
    c = mixc(mixc([44, 176, 192], [16, 92, 150], sstep(out, 0, 0.9)), [8, 42, 100], sstep(out, 0.8, 2.4));
  } else {
    c = mixc([92, 216, 206], [32, 160, 186], sstep(d, 0.4, 1.5) * (0.62 + 0.38 * n));
    if (x < coast(z) + 1.7) c = mixc([200, 228, 192], c, sstep(d, 0.03, 0.7));
  }
  // A reef from the air: bright sand behind it, a darker mosaic of living coral along its edges.
  if (d < 0.95) {
    const shallow = 1 - sstep(d, 0.3, 0.95);
    const flat = mixc([226, 244, 222], [176, 230, 208], n);
    const coral = mixc(mixc([86, 104, 70], [134, 122, 76], mottle), [150, 92, 104], sstep(fbm(x * 11, z * 11, 2, 15), 0.18, 0.5));
    const living = sstep(d, 0.2, 0.3) * (1 - sstep(d, 0.55, 0.9));
    const edge = out > -0.75 && out < 0 ? sstep(out, -0.75, -0.25) : 0;
    const patchy = sstep(mottle, 0.4, 0.62) * 0.8;
    c = mixc(c, mixc(flat, coral, clamp01(Math.max(living * (0.5 + mottle) * 1.1, edge * (0.5 + mottle) * 1.1, patchy))), shallow * 0.94);
  }
  // Surf stands along the seaward edge of the ribbon, and not across the gaps.
  const surfAt = 0.05 * Math.sin(z * 9) + 0.03 * Math.sin(z * 23 + 1);
  const surf = (1 - sstep(Math.abs(out - 0.06 - surfAt), 0.015, 0.13 + 0.05 * mottle)) * (0.6 + 0.4 * Math.sin(z * 31 + x * 8)) * gap(z);
  c = mixc(c, [250, 252, 252], clamp01(surf));
  const ripple = (fbm(x * 3.2, z * 5.5, 3, 7)) * 7;
  return [c[0] + ripple, c[1] + ripple, c[2] + ripple];
}

function buildWater() {
  const AW = 1200; const TH = Math.round(AW * D / W);
  const BH = 170; const CH = Math.round(AW * (ZF - ZB) / W); const SH = 270;
  const AH = TH + BH + CH + SH;
  let wallTop = SEA;
  for (let j = 0; j <= NZ; j++) wallTop = Math.max(wallTop, bed(X0, Z0 + (j / NZ) * D));
  for (let i = 0; i <= NX; i++) wallTop = Math.max(wallTop, bed(X0 + (i / NX) * W, Z0));
  const BY = TH; const CY = TH + BH; const SY = TH + BH + CH;
  const map = canvasTexture(AW, AH, (ctx) => {
    paintRegion(ctx, 0, 0, AW, TH, (px, py) => seaMap(X0 + ((px + 0.5) / AW) * W, Z0 + ((py + 0.5) / TH) * D));
    // The room's back wall: water, with the far reef fading into it and light falling through.
    paintRegion(ctx, 0, BY, AW, BH, (px, py) => {
      const x = X0 + ((px + 0.5) / AW) * W; const y = SEA - ((py + 0.5) / BH) * (SEA - DEEP + 0.3);
      const k = clamp01((SEA - y) / 2.9);
      let c = mixc([116, 218, 226], [14, 82, 136], k ** 0.8);
      c = mixc(c, [10, 56, 112], sstep(x, 4, 8) * 0.55);
      const ray = Math.sin((x + y * 0.42) * 2.3 + 2 * noise2(x * 0.3, 1, 2)) * 0.5 + 0.5;
      const shaft = (ray ** 5) * 0.34 * (1 - k * 0.7);
      c = mixc(c, [214, 246, 240], shaft);
      // The far reef, as a soft dark band whose top wanders.
      const far = bed(x, ZB) + 0.42 + 0.3 * fbm(x * 1.7, 2, 3, 15);
      return mixc(c, shade(c, 0.66), 1 - sstep(y, far - 0.2, far));
    });
    // The underside of the surface, from below.
    paintRegion(ctx, 0, CY, AW, CH, (px, py) => {
      const x = X0 + ((px + 0.5) / AW) * W; const z = ZB + ((py + 0.5) / CH) * (ZF - ZB);
      const v = caustic(x * 0.8, z * 0.8);
      return mixc(mixc([86, 196, 210], [46, 140, 182], sstep(x, 3, 8)), [226, 252, 248], v * 0.9);
    });
    // The block's outside walls, read as a section: blue over rock.
    const wallRow = (w, row) => paintRegion(ctx, 0, SY + row * (SH / 3), AW, SH / 3, (px, py) => {
      const t = (px + 0.5) / AW;
      const y = wallTop - ((py + 0.5) / (SH / 3)) * (wallTop - PLINTH);
      const x = mix(w[0][0], w[1][0], t); const z = mix(w[0][1], w[1][1], t);
      const g = bed(x, z);
      const land = g > SEA - 0.03;
      if (y > g + (land ? 0.2 : 0)) { const k = clamp01((SEA - y) / 2.9); return mixc([52, 150, 186], [14, 62, 112], k); }
      if (land && y > g - 0.14) return [52, 42, 30];
      if (land) return mixc([106, 82, 60], [134, 106, 78], Math.sin(y * 12 + fbm(x, z, 2, 2) * 2) * 0.5 + 0.5);
      return mixc([196, 180, 146], [150, 134, 104], sstep(g - y, 0, 0.8));
    });
    WALLS.forEach((w, i) => wallRow(w, i));
  });

  const pieces = [];
  const quad = (a, b, c, e, uvA, uvB, uvC, uvE) => {
    pieces.push(...a, ...b, ...c, ...a, ...c, ...e);
    uvp.push(...uvA, ...uvB, ...uvC, ...uvA, ...uvC, ...uvE);
  };
  const uvp = [];
  const vOf = (py) => 1 - py / AH;
  const uvT = (x, z) => [(x - X0) / W, vOf(((z - Z0) / D) * TH)];
  // The surface, wound to face up.
  quad([X0, SEA, Z0], [X0, SEA, ZF], [-X0, SEA, ZF], [-X0, SEA, Z0], uvT(X0, Z0), uvT(X0, ZF), uvT(-X0, ZF), uvT(-X0, Z0));
  // Its underside, a hair below so the two cannot fight, wound to face down.
  const under = SEA - 0.02;
  const uvC = (x, z) => [(x - X0) / W, vOf(CY + ((z - ZB) / (ZF - ZB)) * CH)];
  quad([X0, under, ZB], [-X0, under, ZB], [-X0, under, ZF], [X0, under, ZF], uvC(X0, ZB), uvC(-X0, ZB), uvC(-X0, ZF), uvC(X0, ZF));
  // A short lip along the front, so the surface has an edge rather than a line.
  const lipFrom = coast(ZF);
  quad([lipFrom, SEA - 0.07, ZF], [-X0, SEA - 0.07, ZF], [-X0, SEA, ZF], [lipFrom, SEA, ZF], uvT(lipFrom, ZF - 0.1), uvT(-X0, ZF - 0.1), uvT(-X0, ZF - 0.1), uvT(lipFrom, ZF - 0.1));
  // The room's back wall, at the same stations as the floor it stands on.
  const uvB = (x, y) => [(x - X0) / W, vOf(BY + ((SEA - y) / (SEA - DEEP + 0.3)) * BH)];
  for (let i = 0; i < NX; i++) {
    const x0 = X0 + (i / NX) * W; const x1 = X0 + ((i + 1) / NX) * W;
    const b0 = bed(x0, ZB); const b1 = bed(x1, ZB);
    if (b0 >= under && b1 >= under) continue;
    quad([x0, Math.min(b0, under), ZB], [x1, Math.min(b1, under), ZB], [x1, under, ZB], [x0, under, ZB], uvB(x0, Math.min(b0, under)), uvB(x1, Math.min(b1, under)), uvB(x1, under), uvB(x0, under));
  }
  // The three outside walls. Back and sides only: the front is the ground's own cut face.
  const uvW = (row, t, y) => [t, vOf(SY + (row + ((wallTop - y) / (wallTop - PLINTH))) * (SH / 3))];
  WALLS.forEach((w, row) => {
    const n = w[2];
    for (let i = 0; i < n; i++) {
      const t0 = i / n; const t1 = (i + 1) / n;
      const x0 = mix(w[0][0], w[1][0], t0); const z0 = mix(w[0][1], w[1][1], t0);
      const x1 = mix(w[0][0], w[1][0], t1); const z1 = mix(w[0][1], w[1][1], t1);
      const top0 = Math.max(bed(x0, z0), SEA); const top1 = Math.max(bed(x1, z1), SEA);
      quad([x0, PLINTH, z0], [x1, PLINTH, z1], [x1, top1, z1], [x0, top0, z0], uvW(row, t0, PLINTH), uvW(row, t1, PLINTH), uvW(row, t1, top1), uvW(row, t0, top0));
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pieces, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvp, 2));
  g.computeVertexNormals();
  const m = mesh(g, standard({ map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.16, roughness: 0.42, metalness: 0, side: THREE.DoubleSide }));
  m.castShadow = false;
  return m;
}
const WALLS = [
  [[-X0, Z0], [X0, Z0], NX], // back, seen from behind
  [[-X0, ZF], [-X0, Z0], NZ], // right
  [[X0, Z0], [X0, ZF], NZ], // left
];

// ---------------------------------------------------------------------------------------------
// Coral. One map: pores on the left half and a brain coral's grooves on the right, near-white so it
// carries pattern and the vertex colour carries the hue.
// ---------------------------------------------------------------------------------------------
function coralMap() {
  const rng = seededRandom(77);
  const S = 1024; const Hh = 512;
  return canvasTexture(S, Hh, (ctx) => {
    ctx.fillStyle = '#f4f2ea';
    ctx.fillRect(0, 0, S, Hh);
    for (let i = 0; i < 5200; i++) {
      const x = rng() * 508; const y = rng() * Hh;
      const r = 1.1 + rng() * 1.9;
      const v = 150 + rng() * 60;
      ctx.fillStyle = `rgba(${v},${v},${v * 0.96},0.86)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    // Meandering ridges: stripes through a warped field, which is what a brain coral's valleys are.
    paintRegion(ctx, 512, 0, 512, Hh, (px, py) => {
      const x = px / 512; const y = py / 512;
      const warp = 2.6 * fbm(x * 3.2, y * 3.2, 3, 51) + 0.9 * fbm(x * 8, y * 8, 2, 53);
      const f = Math.sin((x * 1.2 + y * 0.8 + warp) * 26);
      const groove = 1 - sstep(f, -0.75, -0.2);
      const v = 240 - groove * 148;
      return [v, v, v * 0.97];
    });
  });
}

// The mirrored repeat lands a large surface on a tile with no seam, and pores do not care which way
// round they are. It keeps every part inside the left half of the map.
const mirror = (v) => { const t = ((v % 2) + 2) % 2; return t > 1 ? 2 - t : t; };
function poreUV(g, scale = 0.7) {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = 0.006 + 0.484 * mirror((p.getX(i) + p.getY(i) * 0.62) * scale);
    uv[i * 2 + 1] = 0.006 + 0.988 * mirror((p.getZ(i) + p.getY(i) * 0.8) * scale);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function paint(g, fn) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const rgb = fn(p.getX(i), p.getY(i), p.getZ(i));
    c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// The vertex colours are linear, so the same red-first absorption is applied here.
const under = (rgb, y) => { const k = clamp01((SEA - y) / 2.9); return [rgb[0] * (1 - 0.68 * k), rgb[1] * (1 - 0.32 * k), rgb[2] * (1 + 0.06 * k)]; };

function finish(list, g, fn, scale) {
  const n = g.index ? g.toNonIndexed() : g;
  list.push(paint(n.attributes.uv && scale === null ? n : poreUV(n, scale ?? 0.7), fn));
}

// A solid of revolution whose radius is multiplied by a function of bearing and height, closed on the
// axis at both ends. Every coral that is not a branch is one of these.
function polarSolid(profile, segments, radial) {
  const pos = []; const idx = [];
  const rows = profile.length;
  for (let j = 0; j < rows; j++) {
    const [r, y] = profile[j];
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * TAU;
      const k = radial ? radial(a, j / (rows - 1), r, y) : 1;
      pos.push(Math.cos(a) * r * k, y, Math.sin(a) * r * k);
    }
  }
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * segments + i; const b = j * segments + ((i + 1) % segments);
      const c = (j + 1) * segments + i; const e = (j + 1) * segments + ((i + 1) % segments);
      idx.push(a, b, e, a, e, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return outward(g);
}

// Staghorn: every branch forks from the tube before it, pale at the growing tip.
function branching(list, rng, x, y, z, size, base, tipColor, { stems = 3, levels = 3, thin = 0.05 } = {}) {
  const B = lin(base); const T = lin(tipColor);
  const grow = (a, dir, len, r, level) => {
    const b = [a[0] + dir[0] * len, a[1] + dir[1] * len, a[2] + dir[2] * len];
    const mid = [(a[0] + b[0]) / 2 + (rng() - 0.5) * len * 0.14, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2 + (rng() - 0.5) * len * 0.14];
    const g = tube([a, mid, b], [r, r * 0.84, r * (level === levels ? 0.42 : 0.68)], { sides: 5, steps: level === levels ? 1 : 2, round: 1 });
    const l2 = len * len;
    finish(list, g, (px, py, pz) => {
      const along = clamp01(((px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1]) + (pz - a[2]) * (b[2] - a[2])) / l2);
      const t = clamp01((level - 1 + along) / levels);
      return under([mix(B[0], T[0], t ** 1.6), mix(B[1], T[1], t ** 1.6), mix(B[2], T[2], t ** 1.6)], py);
    }, 3);
    if (level >= levels) return;
    const kids = level === 1 ? 2 + Math.floor(rng() * 2) : 2;
    for (let k = 0; k < kids; k++) {
      const yaw = rng() * TAU; const lean = 0.34 + rng() * 0.36;
      const d = [dir[0] + Math.cos(yaw) * lean, dir[1] * 0.98 + 0.08, dir[2] + Math.sin(yaw) * lean];
      const dl = Math.hypot(d[0], d[1], d[2]);
      grow(b, [d[0] / dl, d[1] / dl, d[2] / dl], len * (0.68 + rng() * 0.14), r * 0.72, level + 1);
    }
  };
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * TAU + rng();
    const lean = 0.18 + rng() * 0.3;
    const d = [Math.cos(a) * lean, 1, Math.sin(a) * lean];
    const dl = Math.hypot(d[0], d[1], d[2]);
    grow([x + Math.cos(a) * size * 0.09, y - 0.05, z + Math.sin(a) * size * 0.09], [d[0] / dl, d[1] / dl, d[2] / dl], size * 0.42, Math.max(thin, size * 0.052), 1);
  }
}

// A table coral: a broad flat plate with a scalloped rim on one short stalk.
function tableCoral(list, rng, x, y, z, R, hex, tilt = 0) {
  const stalkH = R * 0.5;
  const phase = rng() * 9;
  const g = polarSolid(
    [[0, stalkH + R * 0.15], [R * 0.34, stalkH + R * 0.14], [R * 0.72, stalkH + R * 0.11], [R * 0.97, stalkH + R * 0.1], [R, stalkH + R * 0.065], [R * 0.86, stalkH + R * 0.02], [R * 0.42, stalkH - R * 0.04], [R * 0.17, stalkH * 0.62], [R * 0.12, 0], [R * 0.2, -0.08], [0, -0.08]],
    28,
    (a, t, r) => (r > R * 0.3 ? 1 + 0.07 * Math.sin(a * 5 + phase) + 0.05 * Math.sin(a * 11 + phase * 2) : 1),
  );
  g.rotateZ(tilt);
  g.translate(x, y, z);
  const C = lin(hex);
  finish(list, g, (px, py, pz) => {
    const rad = Math.hypot(px - x, pz - z) / R;
    const under2 = py < y + stalkH + R * 0.02 ? 0.42 : 1;
    const rim = 0.86 + 0.34 * sstep(rad, 0.55, 1);
    return under([C[0] * rim * under2, C[1] * rim * under2, C[2] * rim * under2], py);
  }, 1.1);
}

// A massive coral: a dome, its base buried. `brain` lands it on the right half of the map, projected
// from above, which is why a brain coral here stays low and wide.
function domeCoral(list, rng, x, y, z, Rx, Ry, Rz, hex, { brain = false, lumps = 0 } = {}) {
  const rows = [];
  const small = Math.max(Rx, Rz) < 0.5;
  const R = small ? 6 : 10;
  for (let j = 0; j <= R; j++) {
    const phi = (j / R) * (Math.PI / 2);
    rows.push([Math.sin(phi), Math.cos(phi) * Ry]);
  }
  rows.push([1.02, -0.12], [0, -0.12]);
  const seed = rng() * 40;
  const g = polarSolid(rows, small ? 16 : 24, (a, t, r, yy) => {
    if (!lumps) return 1;
    const cx = Math.cos(a) * r; const cz = Math.sin(a) * r;
    return 1 + lumps * fbm(cx * 3.4 + seed, cz * 3.4 + yy * 2.6, 2, 61);
  });
  g.scale(Rx, 1, Rz);
  g.computeVertexNormals();
  g.translate(x, y, z);
  const n = g.toNonIndexed();
  const C = lin(hex);
  const P = n.attributes.position;
  if (brain) {
    const u2 = new Float32Array(P.count * 2);
    for (let i = 0; i < P.count; i++) {
      u2[i * 2] = 0.75 + ((P.getX(i) - x) / Rx) * 0.24;
      u2[i * 2 + 1] = 0.5 + ((P.getZ(i) - z) / Rz) * 0.48;
    }
    n.setAttribute('uv', new THREE.BufferAttribute(u2, 2));
  } else {
    poreUV(n, 0.9);
  }
  const paintFn = (px, py) => {
    const k = 0.72 + 0.34 * sstep(py - y, 0, Ry);
    return under([C[0] * k, C[1] * k, C[2] * k], py);
  };
  list.push(paint(n, paintFn));
}

// A sea fan: one flat net, which a recursion alone cannot draw because its branches rejoin.
function seaFan(list, rng, x, y, z, size, yaw, hex) {
  const C = lin(hex);
  const nodes = [];
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const place = (u, v) => [x + u * c, y + v, z - u * s];
  const stick = (a, b, r) => {
    finish(list, tube([a, b], [r, r * 0.8], { sides: 4, steps: 1, round: 0, straight: true }), (px, py) => under(C, py), 3);
  };
  const walk = (u, v, a, len, r, level) => {
    const u2 = u + Math.cos(a) * len; const v2 = v + Math.sin(a) * len;
    stick(place(u, v), place(u2, v2), r);
    nodes.push([u2, v2]);
    if (level <= 0) return;
    for (const off of [-0.42 - rng() * 0.25, 0.42 + rng() * 0.25]) walk(u2, v2, a + off, len * 0.74, r * 0.8, level - 1);
  };
  walk(0, -0.06, Math.PI / 2, size * 0.28, Math.max(0.024, size * 0.028), 4);
  for (let i = nodes.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [nodes[i], nodes[j]] = [nodes[j], nodes[i]]; }
  let links = 0;
  for (let i = 0; i < nodes.length && links < 34; i++) {
    for (let j = i + 1; j < nodes.length && links < 34; j++) {
      const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (d > 0.03 && d < size * 0.15) { stick(place(...nodes[i]), place(...nodes[j]), 0.011); links += 1; break; }
    }
  }
}

function sponge(list, rng, x, y, z, h, hex) {
  const r = h * 0.2;
  const C = lin(hex);
  const g = lathe([[0, -0.06], [r * 0.9, -0.06], [r, h * 0.3], [r * 1.14, h * 0.7], [r * 1.2, h * 0.97], [r * 1.05, h], [r * 0.82, h * 0.94], [r * 0.66, h * 0.62], [r * 0.5, h * 0.4], [0, h * 0.36]], 12);
  g.translate(x, y, z);
  finish(list, g, (px, py) => under(C, py), 3);
}

function anemone(list, rng, x, y, z, R, count, hex, tipHex) {
  const C = lin(hex); const T = lin(tipHex);
  const base = polarSolid([[0, -0.08], [R * 0.72, -0.08], [R * 0.8, R * 0.2], [R * 0.86, R * 0.32], [R * 0.3, R * 0.3], [0, R * 0.24]], 16);
  base.translate(x, y, z);
  finish(list, base, (px, py) => under(shadeL(C, 0.82), py), 2);
  for (let i = 0; i < count; i++) {
    const a = i * 2.39996; const q = Math.sqrt((i + 0.5) / count);
    const bx = x + Math.cos(a) * q * R * 0.74; const bz = z + Math.sin(a) * q * R * 0.74; const by = y + R * 0.27;
    const L = R * (0.62 + rng() * 0.3);
    const sway = 0.18 + q * 0.4;
    const pts = [[bx, by, bz], [bx + Math.cos(a) * L * sway * 0.5, by + L * 0.6, bz + Math.sin(a) * L * sway * 0.5], [bx + Math.cos(a) * L * sway + (rng() - 0.5) * 0.06, by + L, bz + Math.sin(a) * L * sway + (rng() - 0.5) * 0.06]];
    finish(list, tube(pts, [R * 0.07, R * 0.058, R * 0.05], { sides: 4, steps: 1, round: 1 }), (px, py) => {
      const t = clamp01((py - by) / L);
      return under([mix(C[0], T[0], t ** 2), mix(C[1], T[1], t ** 2), mix(C[2], T[2], t ** 2)], py);
    }, 3);
  }
}
const shadeL = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// A giant clam, which is one closed solid: ribbed shell below, and the bright mantle between two wavy
// lips along the top. Nothing there to open a gap.
function giantClam(list, x, y, z, S, yaw) {
  const rows = [];
  const R = 12;
  for (let j = 0; j <= R; j++) { const p = (j / R) * Math.PI; rows.push([Math.sin(p), -Math.cos(p)]); }
  const g = polarSolid(rows, 30);
  const P = g.attributes.position;
  const c = Math.cos(yaw); const s = Math.sin(yaw);
  const band = (u) => 0.26 + 0.07 * Math.sin(u * 15);
  for (let i = 0; i < P.count; i++) {
    let px = P.getX(i); let py = P.getY(i); let pz = P.getZ(i);
    // Long axis on x, narrow across z, and a flattened top where the mantle lies.
    const lip = Math.abs(pz) < band(px) ? 0 : 1;
    if (py > 0.2) py = 0.2 + (py - 0.2) * (lip ? 0.72 : 0.3);
    const rib = 1 + 0.05 * Math.abs(Math.sin(px * 12));
    px *= S; py = (py * 0.62 * S + S * 0.42); pz = pz * 0.66 * S * rib;
    P.setXYZ(i, x + px * c + pz * s, y + py, z - px * s + pz * c);
  }
  g.computeVertexNormals();
  const SH = lin(0xcfc6a8); const M = lin(0x2aa5c6); const M2 = lin(0x6cd6a0); const D2 = lin(0x16323e);
  finish(list, g, (wx, wy, wz) => {
    const dx = wx - x; const dz = wz - z;
    const lx = (dx * c - dz * s) / S; const lz = (dx * s + dz * c) / (0.66 * S);
    const top = wy > y + S * 0.42 + 0.12 * S;
    const inMantle = Math.abs(lz) < band(lx) && top;
    if (inMantle) {
      if (Math.abs(lz) < 0.05 && Math.abs(lx) < 0.72) return under(D2, wy);
      const spot = Math.sin(lx * 31) * Math.sin(lz * 37) > 0.42;
      return under(spot ? M2 : M, wy);
    }
    const k = 0.74 + 0.4 * Math.abs(Math.sin(lx * 12));
    return under([SH[0] * k, SH[1] * k, SH[2] * k], wy);
  }, 2);
}

function seaStar(list, x, y, z, R, hex, yaw) {
  const C = lin(hex);
  const g = polarSolid([[0, R * 0.17], [R * 0.3, R * 0.15], [R * 0.72, R * 0.09], [R, R * 0.025], [R * 0.98, -0.01], [0, -0.01]], 40, (a) => 0.3 + 0.7 * Math.abs(Math.cos(a * 2.5 + yaw)) ** 1.5);
  g.translate(x, y, z);
  finish(list, g, (px, py) => under(C, py), 3);
}

function buildCoral() {
  const list = [];
  const rng = seededRandom(1981);
  const on = (x, z) => bed(x, z);
  const room = (x, z) => SEA - on(x, z);

  // --- The named heroes along the front. Their x positions are where the hanging labels are. ---
  anemone(list, rng, -3.85, on(-3.85, 4.75), 4.75, 0.62, 38, 0xc23a7e, 0xf0a8c8);
  domeCoral(list, rng, -2.35, on(-2.35, 4.45), 4.45, 0.95, 0.66, 0.88, 0xb9a24a, { brain: true });
  giantClam(list, -0.85, on(-0.85, 4.85), 4.85, 0.72, 0.5);
  branching(list, rng, 0.95, on(0.95, 4.4), 4.4, 1.42, 0x7b5a8e, 0xe4b6f0, { stems: 4 });
  tableCoral(list, rng, 2.55, on(2.55, 4.5), 4.5, 0.82, 0x3f9a8a);
  seaFan(list, rng, 6.05, on(6.05, 4.3), 4.3, 2.0, 0.25, 0xc4385c);

  // Clusters of staghorn are most of what a healthy back reef is.
  for (const [x, z, s, b, t] of [
    [0.2, 3.3, 1.25, 0x8a6a3a, 0xf0e0a0], [1.15, 2.2, 1.45, 0x3f7f7a, 0xa8f0dc], [2.2, 3.1, 1.15, 0x8a4a62, 0xf2b4c6], [-2.75, 3.1, 1.05, 0x6a7a3a, 0xe4ecA0], [2.75, 1.85, 1.05, 0x4a6ea0, 0xc0dcff], [-0.45, 2.55, 1.2, 0x9a5a3a, 0xf6c49a], [-4.55, 3.3, 0.8, 0x7a5a82, 0xe2c0f2],
  ]) branching(list, rng, x, on(x, z), z, Math.min(s, room(x, z) * 0.82), b, t);

  // Tables along the upper reef, both sides of the crest, where the light is.
  for (const [x, z, R, hex, tilt] of [[2.55, 2.0, 0.62, 0x6a9a4a, 0], [3.3, 2.75, 0.5, 0xa88a4a, 0.04], [3.55, 3.6, 0.42, 0x4a8aa0, 0], [5.85, 3.0, 0.62, 0x5a8a7a, -0.12], [6.1, 2.05, 0.5, 0x8a6aa0, -0.1], [5.65, 5.0, 0.44, 0x9a7a5a, -0.1]]) {
    if (room(x, z) > R * 0.72) tableCoral(list, rng, x, on(x, z), z, R, hex, tilt);
  }

  // Massive corals: they crown the bommies and pave the crest.
  for (const [x, z, a, b, hex, lumps, brain] of [
    [-3.75, 2.15, 0.62, 0.42, 0xb06a4a, 0.14, false], [0.55, 2.25, 0.56, 0.38, 0x7a8a4a, 0.14, false], [-1.0, 2.9, 0.34, 0.24, 0x8a6a9a, 0.1, false],
    [3.95, 4.5, 0.42, 0.13, 0xa87a4a, 0.08, false], [4.4, 3.5, 0.5, 0.12, 0x7a9a5a, 0.08, false], [4.85, 2.4, 0.46, 0.12, 0xb45a6a, 0.08, false], [4.05, 2.0, 0.38, 0.12, 0x9a8a4a, 0, true], [5.1, 4.65, 0.34, 0.1, 0x5a8a8a, 0.08, false],
    [5.6, 3.9, 0.46, 0.3, 0xb48a4a, 0.14, false], [6.3, 3.2, 0.5, 0.34, 0x6a5a8a, 0.14, false], [6.75, 4.6, 0.46, 0.32, 0x9a5a5a, 0.12, false], [7.1, 2.3, 0.56, 0.36, 0x5a7a8a, 0.14, false],
  ]) domeCoral(list, rng, x, on(x, z), z, a, b, a * (0.86 + rng() * 0.2), hex, { lumps, brain });

  // The wall: fans and sponges, which take the deeper, dimmer water.
  seaFan(list, rng, 6.75, on(6.75, 2.75), 2.75, 1.7, -0.3, 0xd06a2a);
  seaFan(list, rng, 7.45, on(7.45, 3.9), 3.9, 1.5, 0.5, 0x9a3a9a);
  seaFan(list, rng, 8.05, on(8.05, 2.0), 2.0, 1.3, 0.1, 0xc4385c);
  for (const [x, z, h, hex] of [[6.35, 4.85, 0.8, 0xe0b02a], [6.6, 5.0, 0.56, 0xe0b02a], [5.75, 2.25, 0.5, 0xd0702a], [7.0, 3.6, 0.72, 0x8a4ac0], [7.2, 3.8, 0.5, 0x8a4ac0], [7.75, 4.75, 0.78, 0xd8c02a], [8.25, 3.3, 0.66, 0xc05a3a], [1.45, 1.75, 0.46, 0xd8b02a]]) sponge(list, rng, x, on(x, z), z, h, hex);

  // Small life on the sand, where a student looks down at it.
  seaStar(list, -2.9, on(-2.9, 5.15) + 0.02, 5.15, 0.4, 0x2a62d8, 0.4);
  seaStar(list, -0.65, on(-0.65, 3.35) + 0.02, 3.35, 0.32, 0xd05a2a, 1.1);
  seaStar(list, 0.95, on(0.95, 5.2) + 0.02, 5.2, 0.28, 0x2a62d8, 2);
  giantClam(list, -2.35, on(-2.35, 2.0), 2.0, 0.48, -0.6);
  anemone(list, rng, 8.45, on(8.45, 4.9), 4.9, 0.36, 16, 0xd8a03a, 0xf6e0a0);
  // A few broken bits of old coral.
  for (let i = 0; i < 16; i++) {
    const x = -5 + rng() * 7; const z = ZB + 0.3 + rng() * (ZF - ZB - 0.45);
    const b = blobGeometry(rng, 0, 0.3);
    const s = 0.05 + rng() * 0.08;
    b.scale(s * 1.4, s * 0.7, s);
    b.translate(x, on(x, z) + s * 0.3, z);
    const v = 0.5 + rng() * 0.3;
    list.push(paint(poreUV(b.index ? b.toNonIndexed() : b, 2), (px, py) => under([v, v * 0.92, v * 0.78], py)));
  }

  for (const g of list) {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  }
  const map = coralMap();
  return mesh(mergeGeometries(list, false), standard({ vertexColors: true, map, bumpMap: map, bumpScale: 0.45, roughness: 0.74, metalness: 0 }));
}

// ---------------------------------------------------------------------------------------------
// Fish. All of them are in one mesh, because a school as inner groups is the wrong side of the six
// mesh budget: each animal's part of the buffer is rewritten every frame from its own path. A body's
// wave runs back along it and grows toward the tail, which is what makes it swim rather than slide.
// ---------------------------------------------------------------------------------------------
function fishBody({ len, H, Wd, rings, sides, color }) {
  const pos = []; const idx = []; const col = [];
  const ring = (t) => {
    const z = len / 2 - t * len;
    const h = H(t); const w = Wd(t);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * TAU;
      const s = Math.sin(a);
      pos.push(Math.cos(a) * w, s * h, z);
      col.push(...color(t, s));
    }
  };
  pos.push(0, 0, len / 2); col.push(...color(0, 0));
  for (let r = 1; r <= rings; r++) ring(r / (rings + 1));
  pos.push(0, 0, -len / 2); col.push(...color(1, 0));
  const last = 1 + rings * sides;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    idx.push(0, 1 + i, 1 + j);
    idx.push(last, 1 + (rings - 1) * sides + j, 1 + (rings - 1) * sides + i);
    for (let r = 0; r < rings - 1; r++) {
      const a = 1 + r * sides + i; const b = 1 + r * sides + j;
      const c = 1 + (r + 1) * sides + i; const e = 1 + (r + 1) * sides + j;
      idx.push(a, c, e, a, e, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const out = outward(g);
  return out.toNonIndexed();
}

// A fin is a thin closed plate in the fish's own z-y plane, or laid flat with `flat`.
function fin(points, thick, hex, { flat = false, x = 0 } = {}) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(thick / 2 + x, 0, 0);
  if (flat) g.rotateZ(Math.PI / 2);
  const n = g.index ? g.toNonIndexed() : g;
  const C = typeof hex === 'function' ? null : lin(hex);
  paint(n, (px, py, pz) => (C ?? hex(px, py, pz)));
  return n;
}

function eyes(r, x, y, z) {
  const out = [];
  for (const side of [-1, 1]) {
    const ball = new THREE.SphereGeometry(r, 6, 4).toNonIndexed();
    ball.translate(side * x, y, z);
    paint(ball, () => lin(0x0c0c10));
    const ringG = new THREE.SphereGeometry(r * 1.3, 6, 4).toNonIndexed();
    ringG.scale(0.7, 1, 1);
    ringG.translate(side * (x - r * 0.24), y, z);
    paint(ringG, () => lin(0xe8dcae));
    out.push(ball, ringG);
  }
  return out;
}

function template(parts, { wag = 0.1, freq = 10, len = 1 } = {}) {
  const clean = parts.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  const g = mergeGeometries(clean, false);
  const p = g.attributes.position.array;
  const count = g.attributes.position.count;
  const swayS = new Float32Array(count); const swayC = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const z = p[i * 3 + 2];
    const k = clamp01((len * 0.3 - z) / len);
    const amp = wag * k * k * 2.2;
    swayS[i] = amp * Math.cos((z * 6) / len);
    swayC[i] = amp * Math.sin((z * 6) / len);
  }
  return { p, n: g.attributes.normal.array, c: g.attributes.color.array, count, wag, freq, len, swayS, swayC };
}

const elliptic = (peak, at = 0.36, tail = 0.08) => (t) => {
  const a = t < at ? Math.sqrt(1 - ((at - t) / at) ** 2) : 1 - ((t - at) / (1 - at)) ** 1.5 * (1 - tail);
  return peak * Math.max(0.02, a);
};

function fishTemplates() {
  // Clownfish: orange with three white bars edged in black, which is the whole identification.
  const clown = () => {
    const O = lin(0xf06a10); const Wt = lin(0xf6f2ea); const K = lin(0x101010);
    const bar = (t, c, w) => Math.abs(t - c) < w;
    const edge = (t, c, w) => Math.abs(t - c) < w + 0.018;
    const L = 0.5;
    return template([
      fishBody({ len: L, H: elliptic(0.13), Wd: elliptic(0.058), rings: 22, sides: 10, color: (t) => {
        for (const [c, w] of [[0.26, 0.042], [0.54, 0.05], [0.86, 0.034]]) { if (bar(t, c, w)) return Wt; if (edge(t, c, w)) return K; }
        return O;
      } }),
      fin([[-0.26, -0.03], [-0.42, -0.11], [-0.42, 0.11], [-0.26, 0.03]], 0.012, 0xf06a10),
      fin([[-0.1, 0.1], [-0.05, 0.19], [0.1, 0.16], [0.14, 0.09]], 0.012, 0xe85a10),
      fin([[-0.05, -0.1], [-0.02, -0.18], [0.1, -0.14], [0.08, -0.08]], 0.012, 0xe85a10),
      ...eyes(0.022, 0.05, 0.035, 0.17),
    ], { wag: 0.05, freq: 15, len: L });
  };
  // Regal blue tang: royal blue, a black scribble along the flank and a yellow tail.
  const tang = () => {
    const B = lin(0x1a4fd8); const Y = lin(0xf0c810); const K = lin(0x0c1020);
    const L = 0.72;
    return template([
      fishBody({ len: L, H: elliptic(0.22, 0.42, 0.1), Wd: elliptic(0.056, 0.42), rings: 18, sides: 10, color: (t, s) => {
        if (t > 0.86) return Y;
        const line = 0.5 * Math.sin(t * 6.2 + 0.4);
        return Math.abs(s - line) < 0.2 && t > 0.14 && t < 0.8 ? K : B;
      } }),
      fin([[-0.34, -0.03], [-0.52, -0.15], [-0.47, 0], [-0.52, 0.15], [-0.34, 0.03]], 0.012, 0xf0c810),
      fin([[-0.26, 0.15], [-0.2, 0.25], [0.14, 0.24], [0.2, 0.17]], 0.012, 0x1038a8),
      fin([[-0.26, -0.15], [-0.2, -0.24], [0.1, -0.23], [0.16, -0.17]], 0.012, 0x1038a8),
      ...eyes(0.024, 0.04, 0.05, 0.22),
    ], { wag: 0.05, freq: 13, len: L });
  };
  // Butterflyfish: a tall yellow disc with a black band through the eye.
  const butterfly = () => {
    const Y = lin(0xf2d21a); const K = lin(0x101014); const Wt = lin(0xf2eedc);
    const L = 0.66;
    return template([
      fishBody({ len: L, H: elliptic(0.25, 0.46, 0.16), Wd: elliptic(0.045, 0.46), rings: 16, sides: 10, color: (t) => {
        if (t > 0.16 && t < 0.27) return K;
        if (t < 0.16) return t < 0.05 ? K : Wt;
        return Y;
      } }),
      fin([[-0.32, -0.04], [-0.46, -0.11], [-0.46, 0.11], [-0.32, 0.04]], 0.012, 0xf2d21a),
      fin([[-0.27, 0.15], [-0.22, 0.27], [0.08, 0.27], [0.14, 0.19]], 0.012, 0xe8c410),
      fin([[-0.27, -0.15], [-0.22, -0.25], [0.04, -0.25], [0.1, -0.19]], 0.012, 0xe8c410),
    ], { wag: 0.04, freq: 12, len: L });
  };
  // Parrotfish: a big blunt body in blue-green and pink, with a beak of a mouth.
  const parrot = () => {
    const G = lin(0x1fb09a); const P = lin(0xe8689a); const B = lin(0xcfe6d0);
    const L = 1.25;
    return template([
      fishBody({ len: L, H: elliptic(0.27, 0.3, 0.14), Wd: elliptic(0.15, 0.3), rings: 18, sides: 12, color: (t, s) => {
        if (t < 0.04) return B;
        const scale = Math.sin(t * 60) > 0.2 ? 1 : 0.86;
        const c = s < -0.5 ? P : G;
        return t > 0.84 ? P : [c[0] * scale, c[1] * scale, c[2] * scale];
      } }),
      fin([[-0.6, -0.08], [-0.84, -0.24], [-0.76, 0], [-0.84, 0.24], [-0.6, 0.08]], 0.02, 0xe8689a),
      fin([[-0.48, 0.2], [-0.44, 0.33], [0.22, 0.34], [0.3, 0.24]], 0.02, 0x10907e),
      ...eyes(0.04, 0.115, 0.075, 0.38),
    ], { wag: 0.06, freq: 8, len: L });
  };
  // Anthias: small, orange, and many. Cheap enough to be a swarm.
  const anthias = () => {
    const O = lin(0xf0763a); const K = lin(0xf4a040);
    const L = 0.34;
    return template([
      fishBody({ len: L, H: elliptic(0.07), Wd: elliptic(0.028), rings: 7, sides: 6, color: (t, s) => (s > 0.4 ? O : K) }),
      fin([[-0.17, -0.01], [-0.27, -0.07], [-0.27, 0.07], [-0.17, 0.01]], 0.008, 0xe05a2a),
    ], { wag: 0.035, freq: 18, len: L });
  };
  // A whitetip reef shark: countershaded, with a big first dorsal, and a long upper tail lobe.
  const shark = () => {
    const T = lin(0x6e7c86); const Wt = lin(0xe8ecea);
    const L = 2.9;
    const tip = (px, py) => (py > 0.46 ? Wt : T);
    return template([
      fishBody({ len: L, H: elliptic(0.25, 0.34, 0.07), Wd: elliptic(0.23, 0.34, 0.06), rings: 22, sides: 12, color: (t, s) => (s < -0.2 ? Wt : T) }),
      fin([[-0.05, 0.2], [-0.22, 0.56], [-0.34, 0.54], [-0.3, 0.2]], 0.03, tip),
      fin([[-1.45, 0.02], [-1.92, 0.5], [-1.74, 0.02], [-1.8, -0.22], [-1.45, -0.03]], 0.03, 0x66747e),
      fin([[-0.86, 0.1], [-1.06, 0.26], [-1.1, 0.1]], 0.02, 0x66747e),
      fin([[0.34, 0], [-0.08, -0.04], [-0.22, -0.56], [0.1, -0.46]], 0.026, 0x66747e, { flat: true }),
      fin([[0.34, 0], [-0.08, -0.04], [-0.22, -0.56], [0.1, -0.46]], 0.026, 0x66747e, { flat: true }).rotateZ(Math.PI),
      ...eyes(0.03, 0.15, 0.06, 0.92),
    ], { wag: 0.12, freq: 5, len: L });
  };
  return { clown, tang, butterfly, parrot, anthias, shark };
}

// The turtle's flippers each carry their own hinge, so it has a template of its own.
function turtleTemplate() {
  const Sh = lin(0x6a5a2c); const Sh2 = lin(0x3a3a1a); const Bl = lin(0xd8c88a); const Sk = lin(0x5a6a3a);
  const L = 1.8;
  const shell = fishBody({ len: L, H: (t) => 0.3 * Math.sqrt(Math.max(0.002, 1 - (2 * t - 1) ** 2)), Wd: (t) => 0.72 * Math.sqrt(Math.max(0.002, 1 - (2 * t - 1) ** 2)), rings: 20, sides: 16, color: (t, s) => {
    if (s < -0.2) return Bl;
    const scute = Math.sin(t * 16) * Math.sin((s + t) * 9) > 0;
    return scute ? Sh : Sh2;
  } });
  const head = new THREE.SphereGeometry(0.2, 10, 8).toNonIndexed();
  head.scale(0.9, 0.82, 1.2);
  head.translate(0, 0.02, L / 2 + 0.12);
  paint(head, (px, py) => (py > 0.02 ? lin(0x4a5a30) : lin(0xc4b880)));
  const flipper = (points, thick, hexFn) => {
    const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, steps: 1 });
    g.rotateX(Math.PI / 2);
    const n = g.index ? g.toNonIndexed() : g;
    paint(n, hexFn);
    return n;
  };
  const front = [[0, 0.16], [0.42, 0.2], [0.92, 0.08], [1.26, -0.28], [1.18, -0.42], [0.72, -0.2], [0.3, -0.12], [0, -0.14]];
  const back = [[0, 0.11], [0.3, 0.14], [0.5, 0], [0.42, -0.2], [0.18, -0.2], [0, -0.12]];
  const parts = [shell, head, ...eyes(0.026, 0.13, 0.05, L / 2 + 0.16)];
  const baseCount = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  const hinges = [];
  const add = (points, side, z, x, y) => {
    const g = flipper(points.map((p) => [p[0] * side, p[1]]), 0.05, () => Sk);
    if (side < 0) flipSides(g);
    g.translate(x * side, y, z);
    hinges.push({ start: 0, count: g.attributes.position.count, side, x: x * side, y, rear: Math.abs(z) > 0.2 && z < 0 });
    parts.push(g);
  };
  add(front, 1, 0.42, 0.42, -0.02);
  add(front, -1, 0.42, 0.42, -0.02);
  add(back, 1, -0.72, 0.28, -0.02);
  add(back, -1, -0.72, 0.28, -0.02);
  const tpl = template(parts, { wag: 0, freq: 0, len: L });
  let at = baseCount;
  for (const h of hinges) { h.start = at; at += h.count; }
  tpl.hinges = hinges;
  return tpl;
}

// Mirroring an outline by x reverses its winding, so its triangles have to be turned back.
function flipSides(g) {
  const P = g.attributes.position; const N = g.attributes.normal; const C = g.attributes.color; const U = g.attributes.uv;
  for (let i = 0; i < P.count; i += 3) {
    for (const a of [P, N, C, U]) {
      if (!a) continue;
      const s = a.itemSize;
      for (let k = 0; k < s; k++) {
        const v = a.array[(i + 1) * s + k];
        a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
        a.array[(i + 2) * s + k] = v;
      }
    }
  }
  g.computeVertexNormals();
}

// Paths. Each stays inside the room, and above what is on the floor beneath it.
const orbit = (cx, cy, cz, rx, rz, speed, phase, { bob = 0.05, dir = 1, offset = [0, 0, 0] } = {}) => (t) => {
  const a = phase + dir * speed * t;
  const tilt = Math.sin(a * 2 + phase);
  return [cx + Math.cos(a) * rx + offset[0], cy + tilt * bob + offset[1], cz + Math.sin(a) * rz + offset[2]];
};

function buildFish() {
  const T = fishTemplates();
  const rng = seededRandom(88);
  const list = [];
  const add = (tpl, path, seed = rng() * TAU) => list.push({ tpl, path, seed });
  const school = (make, n, cx, cy, cz, rx, rz, speed, spread) => {
    const tpl = make();
    for (let i = 0; i < n; i++) {
      add(tpl, orbit(cx, cy, cz, rx, rz, speed, (i / n) * 1.6 + rng() * 0.2, {
        offset: [(rng() - 0.5) * spread, (rng() - 0.5) * spread * 0.55, (rng() - 0.5) * spread],
      }));
    }
  };
  // Three clownfish, never far from the anemone they live in.
  const clown = T.clown();
  add(clown, orbit(-3.85, 2.42, 4.72, 0.42, 0.34, 0.9, 0.3, { bob: 0.04 }));
  add(clown, orbit(-3.81, 2.2, 4.7, 0.34, 0.3, -1.1, 2.1, { bob: 0.03, dir: 1 }));
  add(clown, orbit(-3.91, 2.56, 4.76, 0.5, 0.3, 0.7, 4.2, { bob: 0.05 }));
  school(T.tang, 7, -1.0, 2.62, 3.15, 2.6, 1.15, 0.26, 0.5);
  school(T.butterfly, 4, 0.7, 2.74, 3.3, 1.0, 0.85, -0.34, 0.5);
  school(T.anthias, 26, 6.15, 2.82, 3.45, 0.95, 1.2, 0.5, 1.0);
  const parrot = T.parrot();
  add(parrot, orbit(1.2, 2.86, 3.4, 1.15, 0.9, 0.22, 3.3, { bob: 0.04 }));
  add(parrot, orbit(-2.6, 2.74, 2.6, 0.9, 0.7, -0.2, 0.8, { bob: 0.04 }));
  // The shark takes the deep end, on a circle a little longer than it is.
  add(T.shark(), orbit(7.6, 1.42, 3.4, 0.82, 1.45, 0.3, 0.9, { bob: 0.06 }));
  // The turtle crosses the whole lagoon, slowly.
  const turtlePath = orbit(-1.1, 2.68, 3.3, 3.0, 1.2, 0.09, 1.2, { bob: 0.08 });
  const turtle = turtleTemplate();
  add(turtle, turtlePath);

  let total = 0;
  for (const f of list) { f.at = total; total += f.tpl.count; }
  const P = new Float32Array(total * 3); const N = new Float32Array(total * 3); const C = new Float32Array(total * 3);
  for (const f of list) C.set(f.tpl.c, f.at * 3);

  // Half the animals each frame, in turn. At these speeds nobody can tell, and it is half the work.
  const write = (time, turn = -1) => {
    for (let which = 0; which < list.length; which++) {
      if (turn >= 0 && which % 2 !== turn) continue;
      const f = list[which];
      const tpl = f.tpl;
      const a = f.path(time); const b = f.path(time + 0.04);
      let dx = b[0] - a[0]; const dy = b[1] - a[1]; let dz = b[2] - a[2];
      const flat = Math.hypot(dx, dz) || 1e-4;
      dx /= flat; dz /= flat;
      const pitch = clamp01(Math.abs(dy / flat)) * Math.sign(dy) * 0.5;
      const cp = Math.cos(pitch); const sp = Math.sin(pitch);
      const w = time * tpl.freq + f.seed;
      const flap = tpl.hinges ? Math.sin(time * 1.5 + f.seed) : 0;
      const sw = Math.sin(w); const cw = Math.cos(w);
      let o = f.at * 3;
      const src = tpl.p; const nor = tpl.n;
      let hi = 0;
      for (let i = 0; i < tpl.count; i++) {
        let x = src[i * 3]; let y = src[i * 3 + 1]; const z = src[i * 3 + 2];
        let nx = nor[i * 3]; let ny = nor[i * 3 + 1]; const nz = nor[i * 3 + 2];
        if (tpl.hinges) {
          while (hi < tpl.hinges.length && i >= tpl.hinges[hi].start + tpl.hinges[hi].count) hi++;
          const h = tpl.hinges[hi];
          if (h && i >= h.start) {
            // A sea turtle flies: the front flippers row, and the back ones only trim.
            const ang = (h.rear ? 0.14 : 0.52) * flap * h.side + (h.rear ? 0 : -0.1 * h.side);
            const c = Math.cos(ang); const s = Math.sin(ang);
            const rx = x - h.x; const ry = y - h.y;
            x = h.x + rx * c - ry * s; y = h.y + rx * s + ry * c;
            const nx2 = nx * c - ny * s; ny = nx * s + ny * c; nx = nx2;
          }
        } else if (tpl.wag) {
          x += tpl.swayS[i] * sw - tpl.swayC[i] * cw;
        }
        // Pitch about local x, then heading about y. +Z is forward.
        const y1 = y * cp - z * sp; const z1 = y * sp + z * cp;
        const ny1 = ny * cp - nz * sp; const nz1 = ny * sp + nz * cp;
        P[o] = a[0] + x * dz + z1 * dx; P[o + 1] = a[1] + y1; P[o + 2] = a[2] - x * dx + z1 * dz;
        N[o] = nx * dz + nz1 * dx; N[o + 1] = ny1; N[o + 2] = -nx * dx + nz1 * dz;
        o += 3;
      }
    }
  };
  write(0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(1.6, 2.2, 3.4), 11);
  const m = mesh(g, standard({ vertexColors: true, roughness: 0.46, metalness: 0 }));
  let turn = 0;
  m.update = (time) => {
    turn = 1 - turn;
    write(time, turn);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  };
  return m;
}

// ---------------------------------------------------------------------------------------------
// What stands on top
// ---------------------------------------------------------------------------------------------
function buildScenery(root) {
  const batch = new Batch();
  const rng = seededRandom(1770);
  const low = new THREE.BoxGeometry(W + 0.6, PLINTH * 0.62, D + 0.6);
  batch.add(low, 0x3b2a1c, { position: [0, PLINTH * 0.31, 0] });
  batch.add(new THREE.BoxGeometry(W + 0.3, PLINTH * 0.38, D + 0.3), 0x4a3524, { position: [0, PLINTH * 0.81, 0] });

  // The rainforest comes down to the coast here, which is why it is worth a hill.
  const greens = [0x1f6a33, 0x2f7d38, 0x17562a, 0x3f8a3c];
  let trees = 0;
  for (let attempt = 0; attempt < 900 && trees < 13; attempt++) {
    const z = Z0 + 0.3 + rng() * (D - 0.5); const x = X0 + 0.25 + rng() * 3.9;
    const t = coast(z) - x;
    if (t < 0.5) continue;
    const y = bed(x, z);
    if (z > 3.7 && rng() > 0.25) continue;
    addBroadleaf(batch, x, y - 0.03, z, 0.8 + rng() * 0.6, rng, greens, { detail: 1 });
    trees += 1;
  }
  // Mangroves along the waterline, low and dark, where the land stops being land.
  for (let i = 0; i < 34; i++) {
    const z = Z0 + 0.15 + rng() * (D - 0.25);
    const x = coast(z) - 0.1 + rng() * 0.22;
    const s = 0.1 + rng() * 0.1;
    batch.add(blobGeometry(rng, 0, 0.2), [0.03 + rng() * 0.03, 0.14 + rng() * 0.05, 0.05], { position: [x, Math.max(SEA, bed(x, z)) + s * 0.65, z], scale: [s * 1.25, s * 0.8, s * 1.25] });
  }
  // The cay: sand, a little low green, and the birds that nest on it.
  for (const [x, z, h] of [[0.55, -1.5, 0.52], [0.72, -1.2, 0.6], [0.6, -1.05, 0.44]]) addPalm(batch, x, bed(x, z) - 0.02, z, h, rng, { fronds: 6, frond: 0x2f8a3c });
  for (const [x, z, s] of [[0.48, -1.2, 0.13], [0.8, -1.5, 0.11], [0.7, -0.92, 0.1], [0.5, -1.7, 0.09]]) {
    batch.add(blobGeometry(rng, 1, 0.2), 0x4a8a3c, { position: [x, bed(x, z) + s * 0.5, z], scale: [s * 1.2, s * 0.8, s * 1.2] });
  }
  // A dive boat moored off the reef, which is how most people ever see it.
  {
    const bx = 2.5; const bz = -0.4; const yaw = 0.7;
    const hull = new THREE.SphereGeometry(1, 14, 8);
    batch.add(hull, 0xf0f0ea, { position: [bx, SEA + 0.03, bz], scale: [0.2, 0.09, 0.56], rotation: [0, yaw, 0] });
    batch.add(new THREE.BoxGeometry(0.24, 0.14, 0.34), 0xe8e4d8, { position: [bx - 0.04, SEA + 0.15, bz + 0.0], rotation: [0, yaw, 0] });
    batch.add(new THREE.BoxGeometry(0.26, 0.03, 0.4), 0x1f5a90, { position: [bx - 0.04, SEA + 0.235, bz], rotation: [0, yaw, 0] });
  }

  const sea = (text, x, z, lift = 0.7) => ({ text, x, z, y: SEA + lift, ground: Math.max(SEA, bed(x, z)) });
  // Tags hanging from the surface along the open front, each over the thing it names.
  const tag = (text, x) => ({ text, x, z: ZF - 0.02, y: SEA - 0.36, ground: SEA });
  signs(root, batch, [
    sea('Queensland rainforest', -6.6, -3.9, 3.2),
    sea('Lagoon', -3.0, 0.55),
    sea('Coral cay', 0.75, -1.35, 0.95),
    sea('Heart Reef', HEART[0], HEART[1] - 0.2, 0.62),
    sea('Ribbon reef', reefCentre(-2.6) + 0.1, -2.6),
    sea('Gap in the reef', reefCentre(-4.1), -4.1, 1.3),
    sea('Coral Sea', 7.7, -1.2),
    tag('Clownfish', -3.85),
    tag('Brain coral', -2.35),
    tag('Giant clam', -0.85),
    tag('Staghorn coral', 0.95),
    tag('Table coral', 2.57),
    tag('Sea fan', 6.05),
    tag('Reef shark', 7.9),
  ], { plate: 0.3 });
  root.add(batch.mesh());
}

function buildReef() {
  const root = new THREE.Group();
  root.name = 'great-barrier-reef';
  root.add(buildGround());
  root.add(buildWater());
  root.add(buildCoral());
  const fish = buildFish();
  root.add(fish);
  buildScenery(root);
  if (!reducedMotion()) {
    let t = 0;
    root.userData.tick = { update(dt) { t += dt; fish.update(t); } };
  }
  return root;
}

export const BUILDERS = {
  'great-barrier-reef': () => buildReef(),
};
