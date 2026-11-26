// City Dioramas: Venice, the sixth. See src/models/city/CityKit.js for how a city is put together.
//
// ITS ONE IDEA: A CITY BUILT ON WATER. Where every other city on a walnut base is land with a river
// through it, this one is water with land in it: more than a hundred small islands, cut apart by
// canals that do the job streets do elsewhere, standing on wooden piles driven into the mud of a
// lagoon. So three things carry the model, in order:
//
//   1. THE ISLANDS ARE REALLY ISLANDS. The canals are not painted on the land: every island is its
//      own piece of land with its own quay wall, standing proud of the water, so the water is visible
//      down every canal. They come out of one field (below), so a canal can never be a painted line
//      that a building then stands across.
//   2. THE FRONT OF THE BASE IS CUT THROUGH GIUDECCA, and the cut face shows what the city stands on:
//      the water, the soft mud of the lagoon, the firmer clay under it (the caranto), and the wooden
//      piles driven down through the mud into it, with stone and brick built on top. Where the cut
//      crosses a canal, the section shows water there instead, read from the same field as the plan.
//   3. A GONDOLA working the Grand Canal is the one thing that moves.
//
// ONE DESCRIPTION, USED THREE TIMES, AGAIN. The outlines, the canals and the basins are combined into
// one signed field on a grid (land where it is positive). Its zero contour, traced and simplified,
// becomes the island outlines handed to City.land(), which paints them, masks them for the filler
// and walls them with quays. The section on the front face reads the same field along the cut. The
// minor canals are the boundaries of a jittered Voronoi diagram, which is what guarantees every one
// of them reaches another canal or the lagoon: a cell boundary never stops in mid-island.
//
// Everything is placed from a real latitude and longitude, north at the back. Coastlines were traced
// by hand from approximate coordinates, not from map data; only the main canals are real, and the
// minor canals are a pattern of the right size and density, not the real ones. The canals, the
// landmarks and the section's depths are all far bigger than the map scale, and the base says so.

import * as THREE from 'three';
import { City, TAU, LAND_Y, WATER_Y } from '../city/CityKit.js';
import { seededRandom } from '../../PropKit.js';

const PLAN_W = 16;
const PLAN_D = 12.5;
const RIM = 0.32; // CityKit's rim, which the front face sits outside of
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

// ---------------------------------------------------------------------------------------------
// The geography, in [lat, lon]. Traced by eye.
// ---------------------------------------------------------------------------------------------
const MAIN = [
  [45.4398, 12.3160], [45.4418, 12.3172], [45.4436, 12.3188], [45.4452, 12.3212], [45.4462, 12.3245],
  [45.4468, 12.3285], [45.4466, 12.3320], [45.4459, 12.3343], [45.4452, 12.3360], [45.4446, 12.3384],
  [45.4436, 12.3405], [45.4420, 12.3432], [45.4402, 12.3458], [45.4390, 12.3487], [45.4386, 12.3520],
  [45.4380, 12.3555], [45.4364, 12.3585], [45.4342, 12.3606], [45.4318, 12.3628], [45.4302, 12.3652],
  [45.4290, 12.3672], [45.4274, 12.3667], [45.4268, 12.3632], [45.4276, 12.3592], [45.4291, 12.3556],
  [45.4308, 12.3522], [45.4321, 12.3487], [45.4329, 12.3452], [45.4333, 12.3422], [45.4332, 12.3402],
  [45.4331, 12.3384], [45.4327, 12.3366],
  [45.4304, 12.3372], [45.4298, 12.3342], [45.4294, 12.3300], [45.4293, 12.3252], [45.4296, 12.3212],
  [45.4300, 12.3182], [45.4306, 12.3150], [45.4318, 12.3126], [45.4335, 12.3112], [45.4352, 12.3120],
  [45.4368, 12.3138], [45.4383, 12.3150],
];
const GIUDECCA = [
  [45.4282, 12.3178], [45.4280, 12.3230], [45.4275, 12.3290], [45.4268, 12.3335], [45.4266, 12.3380],
  [45.4262, 12.3402], [45.4246, 12.3404], [45.4230, 12.3385], [45.4224, 12.3300], [45.4226, 12.3220],
  [45.4234, 12.3182], [45.4258, 12.3172],
];
const SACCA_FISOLA = [[45.4287, 12.3108], [45.4286, 12.3160], [45.4262, 12.3162], [45.4238, 12.3150], [45.4240, 12.3110], [45.4262, 12.3100]];
const SAN_GIORGIO = [[45.4306, 12.3416], [45.4304, 12.3452], [45.4290, 12.3463], [45.4279, 12.3447], [45.4282, 12.3418]];
const SAN_MICHELE = [[45.4489, 12.3444], [45.4493, 12.3492], [45.4458, 12.3502], [45.4452, 12.3456]];
const MURANO = [
  [45.4521, 12.3468], [45.4544, 12.3444], [45.4580, 12.3438], [45.4610, 12.3458], [45.4630, 12.3500],
  [45.4630, 12.3560], [45.4602, 12.3614], [45.4570, 12.3632], [45.4540, 12.3604], [45.4523, 12.3548],
];
const TRONCHETTO = [[45.4430, 12.3022], [45.4432, 12.3098], [45.4398, 12.3108], [45.4392, 12.3032]];

// The Grand Canal, a backward S, run out past both ends so it really opens to the lagoon.
const GRAND_CANAL = [
  [45.4404, 12.3140], [45.4404, 12.3172], [45.4409, 12.3200], [45.4413, 12.3222], [45.4420, 12.3245],
  [45.4426, 12.3264], [45.4429, 12.3287], [45.4424, 12.3311], [45.4411, 12.3334], [45.4395, 12.3352],
  [45.4381, 12.3360], [45.4368, 12.3353], [45.4359, 12.3331], [45.4353, 12.3302], [45.4343, 12.3274],
  [45.4331, 12.3271], [45.4320, 12.3286], [45.4316, 12.3312], [45.4316, 12.3338], [45.4317, 12.3362],
  [45.4318, 12.3392],
];
// The big real canals, each [path, width in feet].
const MAJOR = [
  [[[45.4426, 12.3264], [45.4440, 12.3240], [45.4456, 12.3214], [45.4472, 12.3196]], 0.1], // Cannaregio Canal
  [[[45.4380, 12.3152], [45.4370, 12.3195], [45.4360, 12.3232], [45.4350, 12.3262], [45.4343, 12.3274]], 0.08], // Rio Nuovo
  [[[45.4327, 12.3276], [45.4312, 12.3268], [45.4290, 12.3262]], 0.07], // Rio di San Trovaso
  [[[45.4439, 12.3250], [45.4442, 12.3290], [45.4446, 12.3325], [45.4462, 12.3352]], 0.07], // Rio della Misericordia
  [[[45.4452, 12.3232], [45.4455, 12.3275], [45.4458, 12.3312], [45.4466, 12.3350]], 0.07], // Rio della Sensa
  [[[45.4459, 12.3262], [45.4447, 12.3266], [45.4432, 12.3270]], 0.06],
  [[[45.4466, 12.3300], [45.4449, 12.3304], [45.4430, 12.3300]], 0.06],
  [[[45.4466, 12.3334], [45.4446, 12.3342], [45.4420, 12.3330]], 0.06],
  [[[45.4362, 12.3502], [45.4342, 12.3496], [45.4322, 12.3488]], 0.07], // Rio dell'Arsenale
  [[[45.4374, 12.3530], [45.4398, 12.3532]], 0.08], // the Arsenale's way out to the north lagoon
  [[[45.4392, 12.3105], [45.4390, 12.3145], [45.4380, 12.3150]], 0.08], // past Santa Chiara
  // Giudecca's own canals, cut across it from the Giudecca Canal to the south. The section sees them.
  [[[45.4290, 12.3232], [45.4250, 12.3236], [45.4210, 12.3238]], 0.08],
  [[[45.4290, 12.3292], [45.4250, 12.3290], [45.4210, 12.3293]], 0.07],
  [[[45.4285, 12.3350], [45.4250, 12.3352], [45.4210, 12.3356]], 0.07],
  // Murano's Grand Canal and the Rio dei Vetrai.
  [[[45.4508, 12.3508], [45.4545, 12.3512], [45.4582, 12.3518], [45.4580, 12.3560], [45.4566, 12.3600], [45.4552, 12.3650]], 0.09],
  [[[45.4562, 12.3428], [45.4558, 12.3470], [45.4555, 12.3514]], 0.06],
  [[[45.4604, 12.3518], [45.4618, 12.3522], [45.4640, 12.3530]], 0.06],
];
// The Arsenale's basins: the shipyard was a harbour inside the city.
const ARSENALE_BASIN = [[45.4377, 12.3500], [45.4378, 12.3546], [45.4366, 12.3556], [45.4353, 12.3540], [45.4356, 12.3504]];
// North Cannaregio is cut by long straight canals, not by a tangle, so the pattern stops there.
const STRAIGHT_RII = ([la, lo]) => la > 45.4434 && lo > 12.3235 && lo < 12.3375;

// ---------------------------------------------------------------------------------------------
// The field: land where it is positive, in feet. Traced into islands.
// ---------------------------------------------------------------------------------------------
class WaterField {
  constructor(w, d, h = 0.02, R = 0.12) {
    Object.assign(this, { w, d, h, R });
    this.x0 = -w / 2 - 2 * h; this.z0 = -d / 2 - 2 * h;
    this.nx = Math.round((w + 4 * h) / h) + 1; this.nz = Math.round((d + 4 * h) / h) + 1;
    const N = this.nx * this.nz;
    this.inside = new Uint8Array(N);
    this.main = new Uint8Array(N);
    this.edge = new Float32Array(N).fill(R);
    this.canal = new Float32Array(N).fill(R);
    this.f = new Float32Array(N);
  }

  X(i) { return this.x0 + i * this.h; }

  Z(j) { return this.z0 + j * this.h; }

  scanFill(poly, mask) {
    let minZ = Infinity; let maxZ = -Infinity;
    for (const p of poly) { minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    const j0 = Math.max(0, Math.floor((minZ - this.z0) / this.h)); const j1 = Math.min(this.nz - 1, Math.ceil((maxZ - this.z0) / this.h));
    for (let j = j0; j <= j1; j += 1) {
      const z = this.Z(j);
      const cross = [];
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a, a += 1) {
        const [xa, za] = poly[a]; const [xb, zb] = poly[b];
        if (za > z !== zb > z) cross.push(xa + ((z - za) / (zb - za)) * (xb - xa));
      }
      cross.sort((p, q) => p - q);
      for (let c = 0; c + 1 < cross.length; c += 2) {
        const i0 = Math.max(0, Math.ceil((cross[c] - this.x0) / this.h)); const i1 = Math.min(this.nx - 1, Math.floor((cross[c + 1] - this.x0) / this.h));
        for (let i = i0; i <= i1; i += 1) mask[i + j * this.nx] = 1;
      }
    }
  }

  // arr = min(arr, distance to the path - hw), only near the path.
  stamp(path, closed, arr, hw) {
    const { h, R, x0, z0, nx, nz } = this;
    const n = closed ? path.length : path.length - 1;
    for (let s = 0; s < n; s += 1) {
      const [ax, az] = path[s]; const [bx, bz] = path[(s + 1) % path.length];
      const m = hw + R;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - m - x0) / h)); const i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + m - x0) / h));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - m - z0) / h)); const j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz) + m - z0) / h));
      const dx = bx - ax; const dz = bz - az; const L2 = dx * dx + dz * dz || 1e-9;
      for (let j = j0; j <= j1; j += 1) {
        const z = z0 + j * h;
        for (let i = i0; i <= i1; i += 1) {
          const x = x0 + i * h;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          const v = Math.hypot(x - ax - dx * t, z - az - dz * t) - hw;
          const k = i + j * nx;
          if (v < arr[k]) arr[k] = v;
        }
      }
    }
  }

  outline(poly, main = false) {
    this.scanFill(poly, this.inside);
    if (main) this.scanFill(poly, this.main);
    this.stamp(poly, true, this.edge, 0);
  }

  canalPath(path, width) { this.stamp(path, false, this.canal, width / 2); }

  basin(poly) {
    const inside = new Uint8Array(this.nx * this.nz);
    const dist = new Float32Array(this.nx * this.nz).fill(this.R);
    this.scanFill(poly, inside);
    this.stamp(poly, true, dist, 0);
    for (let k = 0; k < dist.length; k += 1) {
      const v = inside[k] ? -dist[k] : dist[k];
      if (v < this.canal[k]) this.canal[k] = v;
    }
  }

  // Minor canals: the boundaries of a Voronoi diagram, `hw` either side of them.
  voronoi(seeds, spacing, hw, allowed) {
    const { nx, nz, R } = this;
    const grid = new Map();
    const key = (gi, gj) => `${gi},${gj}`;
    seeds.forEach((s, n) => {
      const k = key(Math.floor(s[0] / spacing), Math.floor(s[1] / spacing));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(n);
    });
    this.seeds = seeds; this.seedGrid = grid; this.spacing = spacing;
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = i + j * nx;
        if (!this.main[k] && this.edge[k] >= R) continue;
        const x = this.X(i); const z = this.Z(j);
        if (!allowed(x, z)) continue;
        const near = this.nearestTwo(x, z);
        if (!near) continue;
        const v = near.bisector - hw;
        if (v < this.canal[k]) this.canal[k] = v;
      }
    }
  }

  nearestTwo(x, z) {
    const { seeds, seedGrid, spacing } = this;
    const gi = Math.floor(x / spacing); const gj = Math.floor(z / spacing);
    let a = -1; let b = -1; let da = Infinity; let db = Infinity;
    for (let dj = -2; dj <= 2; dj += 1) {
      for (let di = -2; di <= 2; di += 1) {
        const list = seedGrid.get(`${gi + di},${gj + dj}`);
        if (!list) continue;
        for (const n of list) {
          const s = seeds[n];
          const d2 = (s[0] - x) ** 2 + (s[1] - z) ** 2;
          if (d2 < da) { db = da; b = a; da = d2; a = n; } else if (d2 < db) { db = d2; b = n; }
        }
      }
    }
    if (b < 0) return null;
    const sa = seeds[a]; const sb = seeds[b];
    return { a, b, bisector: (db - da) / (2 * Math.hypot(sb[0] - sa[0], sb[1] - sa[1])) };
  }

  finish() {
    const { nx, nz, w, d } = this;
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const k = i + j * nx;
        const x = this.X(i); const z = this.Z(j);
        if (Math.abs(x) > w / 2 + 1e-6 || Math.abs(z) > d / 2 + 1e-6) { this.f[k] = -this.R; continue; }
        const sd = this.inside[k] ? this.edge[k] : -this.edge[k];
        this.f[k] = Math.max(-this.R, Math.min(this.R, sd, this.canal[k]));
      }
    }
  }

  at(x, z) {
    const fi = (x - this.x0) / this.h; const fj = (z - this.z0) / this.h;
    const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fi))); const j = Math.max(0, Math.min(this.nz - 2, Math.floor(fj)));
    const u = fi - i; const v = fj - j;
    const F = this.f; const n = this.nx;
    return (F[i + j * n] * (1 - u) + F[i + 1 + j * n] * u) * (1 - v) + (F[i + (j + 1) * n] * (1 - u) + F[i + 1 + (j + 1) * n] * u) * v;
  }

  // Marching squares, then the segments joined into loops. Only loops with land inside them are
  // islands; a loop with water inside it would be a pond, and there are none by construction.
  islands({ tolerance = 0.007, minArea = 0.01 } = {}) {
    const { nx, nz, f } = this;
    const point = (key) => {
      const k = key >> 1; const i = k % nx; const j = (k - i) / nx;
      const a = f[k];
      if ((key & 1) === 0) { const b = f[k + 1]; const t = a / (a - b); return [this.X(i) + t * this.h, this.Z(j)]; }
      const b = f[k + nx]; const t = a / (a - b); return [this.X(i), this.Z(j) + t * this.h];
    };
    const segA = []; const segB = [];
    const hk = (i, j) => 2 * (j * nx + i); const vk = (i, j) => 2 * (j * nx + i) + 1;
    for (let j = 0; j < nz - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const a = f[i + j * nx]; const b = f[i + 1 + j * nx]; const c = f[i + 1 + (j + 1) * nx]; const dd = f[i + (j + 1) * nx];
        const idx = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (dd > 0 ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        const E = [hk(i, j), vk(i + 1, j), hk(i, j + 1), vk(i, j)];
        const add = (p, q) => { segA.push(E[p]); segB.push(E[q]); };
        if (idx === 5 || idx === 10) {
          const centre = (a + b + c + dd) / 4 > 0;
          if ((idx === 5) === centre) { add(0, 1); add(2, 3); } else { add(3, 0); add(1, 2); }
          continue;
        }
        const crossing = [];
        if ((a > 0) !== (b > 0)) crossing.push(0);
        if ((b > 0) !== (c > 0)) crossing.push(1);
        if ((dd > 0) !== (c > 0)) crossing.push(2);
        if ((a > 0) !== (dd > 0)) crossing.push(3);
        add(crossing[0], crossing[1]);
      }
    }
    const byKey = new Map();
    const link = (key, s) => { const list = byKey.get(key); if (list) list.push(s); else byKey.set(key, [s]); };
    for (let s = 0; s < segA.length; s += 1) { link(segA[s], s); link(segB[s], s); }
    const used = new Uint8Array(segA.length);
    const loops = [];
    for (let s0 = 0; s0 < segA.length; s0 += 1) {
      if (used[s0]) continue;
      used[s0] = 1;
      const keys = [segA[s0]];
      let cur = segB[s0];
      for (let guard = 0; guard < 1e6; guard += 1) {
        if (cur === keys[0]) break;
        keys.push(cur);
        const next = (byKey.get(cur) || []).find((s) => !used[s]);
        if (next === undefined) break;
        used[next] = 1;
        cur = segA[next] === cur ? segB[next] : segA[next];
      }
      if (keys.length < 4) continue;
      loops.push(keys.map(point));
    }
    const clamp = (p) => [Math.max(-this.w / 2, Math.min(this.w / 2, p[0])), Math.max(-this.d / 2, Math.min(this.d / 2, p[1]))];
    const out = [];
    for (const raw of loops) {
      const loop = simplifyClosed(raw.map(clamp), tolerance);
      if (loop.length < 3) continue;
      const area = signedArea(loop);
      if (Math.abs(area) < minArea) continue;
      // Which side of the loop is land? Step off the middle of its longest edge and ask the field.
      let best = 0; let bestLen = 0;
      for (let n = 0; n < raw.length; n += 1) {
        const p = raw[n]; const q = raw[(n + 1) % raw.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L > bestLen) { bestLen = L; best = n; }
      }
      const p = raw[best]; const q = raw[(best + 1) % raw.length];
      const dx = (q[0] - p[0]) / (bestLen || 1); const dz = (q[1] - p[1]) / (bestLen || 1);
      const sgn = signedArea(raw) > 0 ? 1 : -1;
      const ix = (p[0] + q[0]) / 2 - dz * sgn * 0.012; const iz = (p[1] + q[1]) / 2 + dx * sgn * 0.012;
      if (this.at(ix, iz) <= 0) continue;
      out.push(loop);
    }
    return out;
  }
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, z0] = poly[i]; const [x1, z1] = poly[(i + 1) % poly.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = points[a]; const [bx, bz] = points[b];
    const dx = bx - ax; const dz = bz - az; const L = Math.hypot(dx, dz) || 1e-9;
    let worst = -1; let far = 0;
    for (let i = a + 1; i < b; i += 1) {
      const dist = Math.abs((points[i][0] - ax) * dz - (points[i][1] - az) * dx) / L;
      if (dist > far) { far = dist; worst = i; }
    }
    if (far > tol) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

function simplifyClosed(loop, tol) {
  let far = 0; let m = 0;
  for (let i = 1; i < loop.length; i += 1) {
    const dd = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (dd > far) { far = dd; m = i; }
  }
  const a = simplify(loop.slice(0, m + 1), tol);
  const b = simplify([...loop.slice(m), loop[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

// Nearest point on a path, and the direction of the path there.
function nearestOnPath(path, x, z) {
  let best = { d: Infinity };
  for (let i = 0; i + 1 < path.length; i += 1) {
    const [ax, az] = path[i]; const [bx, bz] = path[i + 1];
    const dx = bx - ax; const dz = bz - az; const L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const px = ax + dx * t; const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) { const L = Math.sqrt(L2); best = { d, x: px, z: pz, tx: dx / L, tz: dz / L }; }
  }
  return best;
}

// A sub-path between two points' nearest stations, for a boat to work.
function stretch(path, from, to) {
  const near = (p) => {
    let k = 0; let dd = Infinity;
    path.forEach((q, i) => { const e = Math.hypot(q[0] - p[0], q[1] - p[1]); if (e < dd) { dd = e; k = i; } });
    return k;
  };
  const a = near(from); const b = near(to);
  return a <= b ? path.slice(a, b + 1) : path.slice(b, a + 1).reverse();
}

// ---------------------------------------------------------------------------------------------
// Landmarks. Each is enlarged and built in its own frame; windows: false on all of them.
// ---------------------------------------------------------------------------------------------
const STONE = 0xe6dfcf; const BRICK = 0xa8573f; const LEAD = 0x8d9893; const TERRACOTTA = 0xa9553a; const DARK = 0x3a3128; const GOLD = 0xd9b04a;

function stMarks(c, x, z) {
  // The west front faces the Piazza, which is -x on the plan; the frame's +Z is that front.
  const f = c.frame(x, z, { yaw: -Math.PI / 2, s: 1.45 }).reserve(0.4, 0.4, 0.02);
  const stone = 0xdcccae; const marble = 0xe9dfca;
  // A Greek cross under five domes: the plan of a Byzantine church, not of a Gothic one.
  f.block(0, 0, -0.02, 0.14, 0.15, 0.34, stone, { windows: false, roof: LEAD });
  f.block(0, 0, -0.04, 0.34, 0.15, 0.14, stone, { windows: false, roof: LEAD });
  f.block(0, 0, -0.04, 0.24, 0.13, 0.24, stone, { windows: false, roof: LEAD });
  // The narthex and its five great arches across the west front.
  f.block(0, 0, 0.17, 0.36, 0.17, 0.07, marble, { windows: false, roof: LEAD });
  for (let i = 0; i < 5; i += 1) {
    const lx = -0.144 + i * 0.072;
    f.box(lx, 0.0, 0.206, 0.05, 0.09, 0.004, DARK);
    f.box(lx, 0.11, 0.206, 0.05, 0.045, 0.004, GOLD); // the mosaics in the upper lunettes
    f.cone(lx, 0.17, 0.19, 0.016, 0.05, marble, 5);
  }
  for (const [lx, lz, r] of [[0, -0.04, 0.062], [0, 0.08, 0.05], [0, -0.16, 0.05], [0.12, -0.04, 0.05], [-0.12, -0.04, 0.05]]) {
    f.cyl(lx, 0.15, lz, r * 0.92, r * 0.92, 0.03, stone, 12);
    f.dome(lx, 0.18, lz, r, r * 1.25, LEAD, 14, 0.12);
    f.cyl(lx, 0.18 + r * 1.25, lz, 0.008, 0.012, 0.03, stone, 6);
    f.ball(lx, 0.22 + r * 1.25, lz, 0.009, GOLD, 6);
  }
}

function campanile(c, x, z) {
  const f = c.frame(x, z, { yaw: 0, s: 1.45 }).reserve(0.1, 0.1, 0.02);
  // Brick shaft, pale belfry, then the green spire with the angel: the tallest thing in Venice.
  f.block(0, 0, 0, 0.085, 0.58, 0.085, BRICK, { windows: false, roof: BRICK });
  for (const [ox, oz, w, dd] of [[0, 0.0435, 0.012, 0.004], [0, -0.0435, 0.012, 0.004], [0.0435, 0, 0.004, 0.012], [-0.0435, 0, 0.004, 0.012]]) {
    for (const lx of [-0.024, 0, 0.024]) f.box(ox ? ox : lx, 0.04, oz ? oz : lx, w, 0.52, dd, 0x8e4733);
  }
  f.block(0, 0.58, 0, 0.09, 0.075, 0.09, STONE, { windows: false });
  for (const [ox, oz, w, dd] of [[0, 0.046, 0.06, 0.004], [0, -0.046, 0.06, 0.004], [0.046, 0, 0.004, 0.06], [-0.046, 0, 0.004, 0.06]]) f.box(ox, 0.592, oz, w, 0.05, dd, DARK);
  f.block(0, 0.655, 0, 0.08, 0.07, 0.08, 0xd8c6a6, { windows: false });
  f.cone(0, 0.725, 0, 0.058, 0.2, 0x6f9a7c, 4);
  f.ball(0, 0.935, 0, 0.012, GOLD, 6);
}

function dogesPalace(c, x, z) {
  // The long front faces the water (+z on the plan), and the west front the Piazzetta.
  const f = c.frame(x, z, { yaw: 0, s: 1.3 }).reserve(0.34, 0.27, 0.02);
  const pink = 0xe8c4b2; const white = 0xf0ebe0;
  f.block(0, 0, 0, 0.32, 0.17, 0.25, pink, { windows: false, roof: 0xb07a5e });
  // Two storeys of open white arcades along the bottom, the pink wall standing on them: the building
  // looks upside down, heavy above and light below, and that is what everybody remembers about it.
  for (const [faceX, faceZ, len, along] of [[0, 0.1255, 0.32, 'x'], [-0.1605, 0, 0.25, 'z']]) {
    f.box(faceX, 0, faceZ, along === 'x' ? len : 0.004, 0.09, along === 'x' ? 0.004 : len, white);
    const n = along === 'x' ? 11 : 9;
    for (let i = 0; i < n; i += 1) {
      const t = -len / 2 + (len / n) * (i + 0.5);
      const lx = along === 'x' ? t : faceX - 0.002; const lz = along === 'x' ? faceZ + 0.002 : t;
      f.box(lx, 0.006, lz, along === 'x' ? len / n * 0.6 : 0.004, 0.035, along === 'x' ? 0.004 : len / n * 0.6, DARK);
      f.box(lx, 0.05, lz, along === 'x' ? len / n * 0.34 : 0.004, 0.03, along === 'x' ? 0.004 : len / n * 0.34, DARK);
    }
    // The few large windows in the pink upper wall.
    for (let i = 0; i < 5; i += 1) {
      const t = -len / 2 + (len / 5) * (i + 0.5);
      f.box(along === 'x' ? t : faceX - 0.003, 0.11, along === 'x' ? faceZ + 0.003 : t, along === 'x' ? 0.025 : 0.004, 0.035, along === 'x' ? 0.004 : 0.025, DARK);
    }
  }
  // Crenellations, a row of small white teeth along the top.
  for (let i = 0; i < 14; i += 1) f.box(-0.15 + i * 0.023, 0.17, 0.122, 0.009, 0.014, 0.008, white);
}

function rialto(c, a, b) {
  // A single stone arch with two rows of shops on it and a portico at the top. a and b are the two
  // banks; the frame's +Z runs from one to the other.
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2;
  const f = c.frame(mx, mz, { yaw, s: 1 });
  const stone = 0xeae3d4; const shade = 0xc9c0ae;
  const W = 0.17; const SEG = 14;
  const rise = 0.075;
  const deckY = (t) => 0.005 + rise * Math.sin(Math.PI * t);
  for (let i = 0; i < SEG; i += 1) {
    const t0 = i / SEG; const t1 = (i + 1) / SEG;
    const z0 = -L / 2 + L * t0; const z1 = -L / 2 + L * t1;
    const y0 = deckY(t0); const y1 = deckY(t1);
    const zm = (z0 + z1) / 2; const ym = Math.min(y0, y1);
    // The arch barrel under the deck: deep at the banks, thin at the crown.
    const under = (WATER_Y - LAND_Y) + 0.02 + 0.13 * Math.sin(Math.PI * ((t0 + t1) / 2)) ** 0.6;
    f.box(0, under, zm, W, ym + 0.012 - under, (z1 - z0) + 0.002, stone);
    // The stepped ramps, in two lanes either side of the shops.
    f.box(0, ym + 0.012, zm, W, Math.abs(y1 - y0) + 0.008, (z1 - z0) + 0.002, shade);
  }
  // Balustrades along both outer edges.
  for (const side of [-1, 1]) {
    for (let i = 0; i < SEG; i += 1) {
      const t = (i + 0.5) / SEG;
      f.box(side * (W / 2 - 0.006), deckY(t) + 0.02, -L / 2 + L * t, 0.01, 0.022, L / SEG + 0.002, stone);
    }
  }
  // Two rows of shops under red roofs, one on each half, and the central arched portico.
  for (const half of [-1, 1]) {
    for (let k = 0; k < 3; k += 1) {
      const t = 0.5 + half * (0.12 + k * 0.11);
      const lz = -L / 2 + L * t; const y = deckY(t) + 0.02;
      for (const side of [-1, 1]) {
        f.block(side * 0.035, y, lz, 0.04, 0.045, L * 0.1, 0xefe6d2, { windows: false, roof: TERRACOTTA });
        f.gable(side * 0.035, y + 0.045, lz, 0.046, L * 0.1, 0.02, TERRACOTTA, 0xefe6d2);
        f.box(side * 0.056, y + 0.006, lz, 0.003, 0.025, L * 0.06, DARK);
      }
    }
  }
  const top = deckY(0.5) + 0.02;
  f.block(0, top, 0, W * 0.72, 0.07, 0.07, stone, { windows: false, roof: TERRACOTTA });
  f.gable(0, top + 0.07, 0, 0.075, W * 0.76, 0.03, TERRACOTTA, stone, Math.PI / 2);
  for (const side of [-1, 1]) f.box(0, top + 0.005, side * 0.0355, 0.05, 0.05, 0.003, DARK);
}

function salute(c, x, z) {
  // An octagon under a great dome, its entrance facing the Grand Canal (north, -z): the frame's +Z.
  const f = c.frame(x, z, { yaw: Math.PI, s: 1 });
  c.reserveCircle(x, z, 0.2);
  const white = 0xf2ede1;
  f.cyl(0, 0, 0, 0.15, 0.16, 0.13, white, 8);
  f.cyl(0, 0.13, 0, 0.11, 0.13, 0.03, white, 8);
  // The scrolls round the drum, the 'ears', that make its outline unlike any other dome.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * TAU + Math.PI / 8;
    f.ball(Math.sin(a) * 0.115, 0.165, Math.cos(a) * 0.115, 0.03, white, 8, 0.9);
  }
  f.cyl(0, 0.16, 0, 0.095, 0.1, 0.07, white, 16);
  f.dome(0, 0.23, 0, 0.1, 0.13, 0x9ca3a1, 18);
  f.cyl(0, 0.36, 0, 0.022, 0.028, 0.04, white, 8);
  f.dome(0, 0.4, 0, 0.024, 0.03, 0x9ca3a1, 8);
  f.ball(0, 0.435, 0, 0.008, GOLD, 6);
  // The entrance: a temple front up a flight of steps.
  f.block(0, 0, 0.155, 0.11, 0.1, 0.04, white, { windows: false });
  f.gable(0, 0.1, 0.155, 0.12, 0.045, 0.03, white, white);
  f.box(0, 0, 0.176, 0.045, 0.06, 0.004, DARK);
  // The second, smaller dome over the sanctuary behind, and its two bell towers.
  f.block(0, 0, -0.2, 0.15, 0.11, 0.1, white, { windows: false });
  f.cyl(0, 0.11, -0.2, 0.05, 0.055, 0.035, white, 12);
  f.dome(0, 0.145, -0.2, 0.05, 0.07, 0x9ca3a1, 12);
  for (const side of [-1, 1]) {
    f.block(side * 0.085, 0, -0.26, 0.04, 0.2, 0.04, white, { windows: false });
    f.dome(side * 0.085, 0.2, -0.26, 0.022, 0.04, 0x9ca3a1, 8);
  }
}

function sanGiorgio(c, x, z) {
  // Palladio's church, its white temple front facing across the water to St Mark's (north, -z).
  const f = c.frame(x, z, { yaw: Math.PI, s: 1.15 }).reserve(0.4, 0.5, 0.02);
  const white = 0xf0ece2;
  f.block(0, 0, 0, 0.13, 0.14, 0.34, white, { windows: false, roof: LEAD });
  f.gable(0, 0.14, 0, 0.14, 0.34, 0.05, LEAD, white);
  f.block(0, 0, -0.02, 0.3, 0.11, 0.11, white, { windows: false, roof: LEAD });
  f.block(0, 0, 0.175, 0.2, 0.12, 0.02, white, { windows: false });
  f.block(0, 0, 0.18, 0.12, 0.19, 0.03, white, { windows: false });
  f.gable(0, 0.19, 0.18, 0.13, 0.03, 0.045, white, white);
  for (const lx of [-0.045, -0.015, 0.015, 0.045]) f.cyl(lx, 0, 0.2, 0.006, 0.006, 0.17, 0xfbf8f0, 6);
  f.box(0, 0, 0.196, 0.03, 0.07, 0.004, DARK);
  f.cyl(0, 0.14, -0.02, 0.055, 0.06, 0.04, white, 14);
  f.dome(0, 0.18, -0.02, 0.058, 0.08, LEAD, 14);
  f.cyl(0, 0.26, -0.02, 0.01, 0.014, 0.03, white, 6);
  // The campanile, slender with a pointed green spire, standing behind the church.
  f.block(0.09, 0, -0.2, 0.05, 0.44, 0.05, 0xe2d6c0, { windows: false });
  f.block(0.09, 0.44, -0.2, 0.055, 0.05, 0.055, white, { windows: false });
  for (const [ox, oz, w, dd] of [[0, 0.028, 0.035, 0.003], [0, -0.028, 0.035, 0.003], [0.028, 0, 0.003, 0.035], [-0.028, 0, 0.003, 0.035]]) f.box(0.09 + ox, 0.45, -0.2 + oz, w, 0.03, dd, DARK);
  f.cone(0.09, 0.49, -0.2, 0.034, 0.13, 0x6f9a7c, 8);
  // The monastery round its cloisters, behind.
  f.block(-0.06, 0, -0.33, 0.22, 0.09, 0.12, 0xe6dccb, { windows: false, roof: TERRACOTTA });
  f.gable(-0.06, 0.09, -0.33, 0.13, 0.23, 0.03, TERRACOTTA, 0xe6dccb, Math.PI / 2);
}

function arsenale(c, gate, sheds) {
  // The two square towers either side of the water gate, where ships came in and out.
  const [gx, gz] = gate;
  for (const side of [-1, 1]) {
    const T = c.frame(gx + side * 0.085, gz, { s: 1.1 }).reserve(0.08, 0.08, 0.01);
    T.block(0, 0, 0, 0.065, 0.17, 0.065, BRICK, { windows: false, roof: BRICK });
    for (const [ox, oz] of [[-0.024, -0.024], [0.024, -0.024], [-0.024, 0.024], [0.024, 0.024], [0, 0.024], [0, -0.024], [0.024, 0], [-0.024, 0]]) T.box(ox, 0.17, oz, 0.013, 0.016, 0.013, BRICK);
    T.box(0, 0.08, 0.0335, 0.016, 0.045, 0.003, DARK);
  }
  // The long brick sheds round the basin, where galleys were built one after another like an
  // assembly line, centuries before factories.
  for (const [x, z, w, dd] of sheds) {
    const S = c.frame(x, z).reserve(w, dd, 0.01);
    S.block(0, 0, 0, w, 0.08, dd, 0xb36a4e, { windows: false, roof: TERRACOTTA });
    // The ridge runs along the shed's length: Frame.gable's ridge is its own local Z.
    if (w > dd) S.gable(0, 0.08, 0, dd * 1.06, w * 1.02, 0.045, TERRACOTTA, 0xb36a4e, Math.PI / 2);
    else S.gable(0, 0.08, 0, w * 1.06, dd * 1.02, 0.045, TERRACOTTA, 0xb36a4e);
  }
}

function sanMichele(c, poly) {
  // The cemetery island: a brick wall round dark cypresses, and a small white church at one corner.
  c.park(poly, { trees: 0, color: '#6d8a52' });
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    c.frame((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) }).box(0, 0, 0, 0.025, 0.05, L, 0xb56c50);
  }
  let cx = 0; let cz = 0;
  for (const p of poly) { cx += p[0]; cz += p[1]; }
  cx /= poly.length; cz /= poly.length;
  const rng = seededRandom(4);
  for (let i = 0; i < 46; i += 1) {
    const x = cx + (rng() - 0.5) * 1.05; const z = cz + (rng() - 0.5) * 0.85;
    if (!inside(poly, x, z, 0.08)) continue;
    const h = 0.12 + rng() * 0.06;
    c.b.add(new THREE.ConeGeometry(0.025, h, 5), pick(rng, [0x2f4f2a, 0x36592f, 0x2a4626]), { position: [x, LAND_Y + h / 2 + 0.02, z] });
    c.b.add(new THREE.CylinderGeometry(0.004, 0.004, 0.02, 3), 0x5a4430, { position: [x, LAND_Y + 0.01, z] });
  }
  const [sx, sz] = poly[3];
  const ch = c.frame(sx + 0.16, sz - 0.12, { yaw: Math.PI });
  ch.block(0, 0, 0, 0.1, 0.09, 0.14, 0xf0ece2, { windows: false, roof: LEAD });
  ch.gable(0, 0.09, 0.065, 0.1, 0.015, 0.03, 0xf0ece2, 0xf0ece2);
  ch.dome(0, 0.09, -0.03, 0.03, 0.04, LEAD, 10);
}

const inside = (poly, x, z, margin = 0) => {
  let isIn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, zi] = poly[i]; const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) isIn = !isIn;
  }
  if (!isIn || !margin) return isIn;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0]; const dz = b[1] - a[1]; const L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < margin) return false;
  }
  return true;
};

// A small hump-backed stone bridge over a minor canal: two ramps up to a short crown.
function footbridge(c, a, b) {
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const mx = (a[0] + b[0]) / 2; const mz = (a[1] + b[1]) / 2;
  const ux = (b[0] - a[0]) / L; const uz = (b[1] - a[1]) / L;
  const tilt = 0.32; const ramp = L * 0.36; const rise = Math.sin(tilt) * ramp;
  const stone = 0xd8cdb6;
  c.b.add(new THREE.BoxGeometry(0.042, 0.014, L * 0.3), 0xe1d8c4, { position: [mx, LAND_Y + rise, mz], rotation: [0, yaw, 0] });
  for (const side of [-1, 1]) {
    const k = side * (L * 0.15 + ramp * Math.cos(tilt) / 2);
    c.b.add(new THREE.BoxGeometry(0.042, 0.014, ramp), stone, { position: [mx + ux * k, LAND_Y + rise / 2, mz + uz * k], rotation: [side * tilt, yaw, 0] });
  }
}

// ---------------------------------------------------------------------------------------------
// The gondola: black, long and lopsided, with the steel ferro at the bow and the gondolier standing
// at the stern on the left, rowing on the right. A generic figure, nobody in particular.
// ---------------------------------------------------------------------------------------------
function gondola(frame) {
  // Drawn at 0.8: a gondola at the map's own scale would be a speck, and at the size the other cities'
  // boats are drawn it would fill the Grand Canal from bank to bank.
  const f = frame.city.frame(0, 0, { y: 0, s: 0.8 });
  const L = 0.42; const N = 16;
  const black = 0x15161a;
  for (let i = 0; i < N; i += 1) {
    const t = (i + 0.5) / N;
    const lz = -L / 2 + L * t;
    const wid = 0.064 * Math.sin(Math.PI * t) ** 0.55 + 0.004;
    const curl = Math.abs(2 * t - 1) ** 3.2;
    const y0 = 0.004 + 0.055 * curl;
    // The hull is built bent to one side, which is what lets one oar on one side drive it straight.
    const lean = 0.008 * Math.sin(Math.PI * t);
    f.box(lean, y0, lz, wid, 0.026 - 0.012 * curl, L / N + 0.002, black);
  }
  // The ferro: a steel blade at the bow with its six teeth.
  f.box(0, 0.05, L / 2 - 0.004, 0.004, 0.05, 0.016, 0xc9cdd2);
  for (let i = 0; i < 6; i += 1) f.box(0, 0.052 + i * 0.007, L / 2 + 0.006, 0.003, 0.003, 0.012, 0xc9cdd2);
  // A red cushioned seat amidships.
  f.box(0.004, 0.026, 0.02, 0.04, 0.012, 0.06, 0x9c2a2a);
  f.box(0.004, 0.026, 0.06, 0.04, 0.03, 0.008, 0x6b3a22);
  // The gondolier: legs, a striped top, a straw hat.
  const gz = -L * 0.36; const gx = -0.014;
  for (const side of [-1, 1]) f.cyl(gx + side * 0.006, 0.026, gz, 0.004, 0.005, 0.034, 0x1d2230, 5);
  for (let i = 0; i < 4; i += 1) f.cyl(gx, 0.06 + i * 0.007, gz, 0.0105, 0.011, 0.007, i % 2 ? 0x1f2f6a : 0xf4f2ec, 8);
  f.ball(gx, 0.1, gz, 0.009, 0xc8a080, 8);
  f.cyl(gx, 0.106, gz, 0.016, 0.016, 0.002, 0xd8c07a, 10);
  f.cyl(gx, 0.108, gz, 0.008, 0.009, 0.008, 0xd8c07a, 8);
  f.cyl(gx, 0.108, gz, 0.0092, 0.0092, 0.0025, 0xa02a2a, 8);
  // The oar, held from the forcola on the right and reaching down into the water ahead.
  f.box(0.03, 0.03, gz + 0.012, 0.008, 0.03, 0.008, 0x6b4a2a);
  f.bar([gx + 0.006, 0.082, gz], [0.075, -0.01, gz + 0.13], 0.0028, 0xb08a58, 4);
}

// ---------------------------------------------------------------------------------------------
// The cut face on the front of the base.
// ---------------------------------------------------------------------------------------------
const SECTION = {
  sandTop: 0.31, carantoTop: 0.42, bed: 0.6, fillTop: 0.66, raftTop: 0.7, stoneTop: 0.8, top: LAND_Y + 0.05,
  pileTip: 0.34,
};

function section(c, field) {
  const { w, d } = c;
  const FZ = d / 2 + RIM; // the base's front face
  const hw = w / 2 + RIM;
  const zf = FZ + 0.006; // the face of the section
  const slab = (x0, x1, y0, y1, color, depth = 0.012, proud = 0) => {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4) return;
    c.b.add(new THREE.BoxGeometry(x1 - x0, y1 - y0, depth), color, { position: [(x0 + x1) / 2, (y0 + y1) / 2, zf - depth / 2 + proud] });
  };
  // Runs of land and water along the cut, read off the plan's own field just inside the front edge.
  const runs = [];
  const step = 0.01;
  let start = -w / 2; let wet = field.at(-w / 2 + 0.005, d / 2 - 0.03) <= 0;
  for (let x = -w / 2 + step; x <= w / 2 + 1e-6; x += step) {
    const nowWet = field.at(Math.min(w / 2 - 0.005, x), d / 2 - 0.03) <= 0;
    if (nowWet !== wet || x >= w / 2 - 1e-6) { runs.push({ x0: start, x1: Math.min(w / 2, x), wet }); start = x; wet = nowWet; }
  }
  // The rim's own width past the plan on each side is lagoon, so the strata run edge to edge.
  runs[0].x0 = -hw; runs[runs.length - 1].x1 = hw;
  const S = SECTION;
  const rng = seededRandom(1591);
  // Deep silt and sand, then the caranto, the same everywhere.
  slab(-hw, hw, 0.16, S.sandTop, 0x8b7a5c);
  slab(-hw, hw, S.sandTop, S.carantoTop, 0xb88c4c);
  // A few strata lines and mottling, so the layers read as ground rather than as stripes of paint.
  for (let i = 0; i < 70; i += 1) {
    const x = -hw + rng() * hw * 2; const y = 0.17 + rng() * (S.carantoTop - 0.18); const len = 0.2 + rng() * 0.7;
    slab(x, Math.min(hw, x + len), y, y + 0.006 + rng() * 0.006, y > S.sandTop ? 0xcaa063 : 0x7b6c51, 0.012, 0.001);
  }
  for (const run of runs) {
    if (run.wet) {
      slab(run.x0, run.x1, S.carantoTop, S.bed, 0x5d5547);
      slab(run.x0, run.x1, S.bed, WATER_Y, 0x3d7c8a);
      slab(run.x0, run.x1, WATER_Y - 0.004, WATER_Y, 0x9cc6cf, 0.012, 0.0005);
      continue;
    }
    // Under an island: mud round the piles, the piles themselves, the larch raft laid across their
    // heads, Istrian stone through the waterline where the tide comes and goes, and brick above it.
    slab(run.x0, run.x1, S.carantoTop, S.fillTop, 0x5d5547);
    slab(run.x0, run.x1, S.fillTop, S.raftTop, 0x8a6638);
    for (let x = run.x0 + 0.03; x < run.x1 - 0.02; x += 0.1) slab(x, x + 0.003, S.fillTop, S.raftTop, 0x5e4426, 0.012, 0.001);
    slab(run.x0, run.x1, S.raftTop, S.stoneTop, 0xe9e3d3);
    for (let y = S.raftTop + 0.033; y < S.stoneTop; y += 0.033) slab(run.x0, run.x1, y, y + 0.003, 0xb9b2a3, 0.012, 0.001);
    slab(run.x0, run.x1, S.stoneTop, S.top - 0.03, 0xa9573f);
    for (let y = S.stoneTop + 0.02; y < S.top - 0.03; y += 0.02) slab(run.x0, run.x1, y, y + 0.0025, 0x7a3a2a, 0.012, 0.001);
    slab(run.x0, run.x1, S.top - 0.03, S.top, 0x9a958b);
    // The piles: close together, as they are, and driven right through the mud into the clay.
    const r = 0.0105;
    for (let x = run.x0 + 0.03; x < run.x1 - 0.02; x += 0.034) {
      const lean = (rng() - 0.5) * 0.004;
      const tip = S.pileTip + (rng() - 0.5) * 0.03;
      const g = new THREE.CylinderGeometry(r, r * 0.92, S.fillTop - tip - 0.02, 6, 1, true);
      c.b.add(g, rng() < 0.5 ? 0x9b7546 : 0x8c6a3f, { position: [x + lean, (S.fillTop + tip + 0.02) / 2, zf - 0.003], rotation: [0, rng() * TAU, 0] });
      c.b.add(new THREE.ConeGeometry(r * 0.92, 0.024, 6), 0x6f5532, { position: [x + lean, tip + 0.008, zf - 0.003], rotation: [Math.PI, 0, 0] });
    }
  }
  return { runs, zf };
}

// ---------------------------------------------------------------------------------------------
// Venice
// ---------------------------------------------------------------------------------------------
export function venice() {
  const c = new City({
    w: PLAN_W, d: PLAN_D, lat: 45.4433, lon: 12.335, km: 0.3415, seed: 1591,
    landColor: '#c2b9a6', waterColor: '#4f8f8f', waterDeep: '#3f7c80',
    tile: { feet: [0.15, 0.07], cols: 5, rows: 2, lit: 0.05, winW: 0.4, winH: 0.66, win: '#4a4440', wall: '#f7f1e6', band: 0.18 },
  });
  const P = (la, lo) => c.at(la, lo);
  const G = (list) => c.geo(list, 4);
  const field = new WaterField(c.w, c.d);

  // --- The field: every outline, every canal, the Arsenale's basin, then the pattern of rii.
  const main = G(MAIN);
  field.outline(main, true);
  const giudecca = G(GIUDECCA); const fisola = G(SACCA_FISOLA); const sanGiorgioPoly = G(SAN_GIORGIO);
  const sanMichelePoly = c.geo(SAN_MICHELE); const murano = G(MURANO);
  for (const poly of [giudecca, fisola, sanGiorgioPoly, sanMichelePoly, murano]) field.outline(poly);
  const grand = c.geo(GRAND_CANAL, 6);
  // Widened where it is widest, at the bends and the mouth, so it reads as the city's main street.
  const GC_W = 0.24;
  for (let i = 0; i + 1 < grand.length; i += 1) {
    const t = i / (grand.length - 2);
    const width = GC_W * (0.9 + 0.25 * Math.exp(-(((t - 0.97) / 0.08) ** 2)));
    field.canalPath([grand[i], grand[i + 1]], width);
  }
  for (const [path, width] of MAJOR) field.canalPath(G(path), width);
  field.basin(c.geo(ARSENALE_BASIN));
  // The pattern of minor canals: one cell for an island of the right size, a little under 0.7 ft
  // across here, which is about 230 yards.
  const rng = seededRandom(118);
  const SPACING = 0.68;
  const seeds = [];
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of main) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
  for (let gz = Math.floor(minZ / SPACING) - 1; gz <= Math.ceil(maxZ / SPACING); gz += 1) {
    for (let gx = Math.floor(minX / SPACING) - 1; gx <= Math.ceil(maxX / SPACING); gx += 1) {
      seeds.push([(gx + 0.15 + rng() * 0.7) * SPACING, (gz + 0.15 + rng() * 0.7) * SPACING]);
    }
  }
  const latLonOf = (x, z) => [c.lat - z / c.latK, c.lon + x / c.lonK];
  const [sbX, sbZ] = P(45.4350, 12.3395);
  const patterned = (x, z) => !STRAIGHT_RII(latLonOf(x, z)) && Math.hypot(x - sbX - 0.05, z - sbZ - 0.2) > 0.55;
  field.voronoi(seeds, SPACING, 0.032, patterned);
  field.finish();

  // --- The islands.
  const islands = field.islands();
  for (const poly of islands) c.land(poly);

  // --- Squares, gardens, and the car-park island.
  const tron = c.geo(TRONCHETTO);
  c.land(tron);
  c.plaza(tron, '#a9a59c');
  // It is a car park and a bus station: the end of the road, and the reason it was built.
  c.paintOver((ctx) => {
    ctx.save();
    ctx.beginPath(); tron.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip();
    ctx.strokeStyle = 'rgba(245,242,232,0.7)'; ctx.lineWidth = 0.012;
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const [x, z] of tron) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let z = z0 + 0.12; z < z1; z += 0.2) for (let x = x0; x < x1; x += 0.05) { ctx.beginPath(); ctx.moveTo(x, z); ctx.lineTo(x, z + 0.07); ctx.stroke(); }
    ctx.restore();
  });
  c.plaza(c.geo([[45.4338, 12.3374], [45.4348, 12.3374], [45.4352, 12.3390], [45.4336, 12.3390]]), '#ddd3bf'); // the Piazza
  c.plaza(c.geo([[45.4331, 12.3388], [45.4342, 12.3388], [45.4342, 12.3398], [45.4331, 12.3398]]), '#ddd3bf'); // the Piazzetta
  for (const [la, lo, r] of [[45.4335, 12.3297, 0.1], [45.4377, 12.3290, 0.1], [45.4337, 12.3235, 0.09], [45.4398, 12.3410, 0.08], [45.4357, 12.3448, 0.08]]) {
    const [x, z] = P(la, lo);
    if (field.at(x, z) > 0.03) c.plaza(circle(x, z, r, 10), '#d6ccb8');
  }
  c.park(c.geo([[45.4300, 12.3548], [45.4304, 12.3586], [45.4287, 12.3604], [45.4281, 12.3574]]), { trees: 14, treeH: 0.15, color: '#7da858' });
  c.park(c.geo([[45.4292, 12.3626], [45.4290, 12.3656], [45.4279, 12.3660], [45.4277, 12.3632]]), { trees: 9, treeH: 0.15, color: '#7da858' });

  // --- Landmarks.
  stMarks(c, sbX, sbZ);
  const [cmX, cmZ] = P(45.4342, 12.3388); campanile(c, cmX - 0.2, cmZ + 0.08);
  const [dpX, dpZ] = P(45.4336, 12.3405); dogesPalace(c, dpX + 0.04, dpZ + 0.03);
  // The Rialto crosses where it really does; the other three Grand Canal bridges are plain decks.
  const across = (la, lo, extra = 0.12) => {
    const [x, z] = P(la, lo);
    const n = nearestOnPath(grand, x, z);
    const half = GC_W / 2 + extra;
    return [[n.x + n.tz * half, n.z - n.tx * half], [n.x - n.tz * half, n.z + n.tx * half], n];
  };
  const [rA, rB] = across(45.4381, 12.3360, 0.09);
  c.reserveCircle((rA[0] + rB[0]) / 2, (rA[1] + rB[1]) / 2, 0.24);
  rialto(c, rA, rB);
  const [slX, slZ] = P(45.4306, 12.3346); salute(c, slX, slZ);
  const [sgX, sgZ] = P(45.4294, 12.3436); sanGiorgio(c, sgX, sgZ);
  const [gtX, gtZ] = P(45.4352, 12.3497);
  const [abX, abZ] = P(45.4367, 12.3528);
  const shed = (la0, lo0, la1, lo1, depth) => {
    const [x0, z0] = P(la0, lo0); const [x1, z1] = P(la1, lo1);
    return [(x0 + x1) / 2, (z0 + z1) / 2, Math.max(depth, Math.abs(x1 - x0)), Math.max(depth, Math.abs(z1 - z0))];
  };
  arsenale(c, [gtX - 0.04, gtZ + 0.02], [
    shed(45.4382, 12.3503, 45.4382, 12.3526, 0.1), shed(45.4374, 12.3492, 45.4363, 12.3492, 0.1),
    shed(45.4376, 12.3563, 45.4362, 12.3563, 0.1),
  ].filter(([x, z]) => field.at(x, z) > 0.04));
  sanMichele(c, sanMichelePoly);
  for (const [la, lo, color, deck] of [[45.4316, 12.3287, 0x8a6a48, 0x6e5238], [45.4413, 12.3222, 0xd8d0be, 0xb8b0a0], [45.4405, 12.3182, 0xcfd2d0, 0xaeb1af]]) {
    const [a, b] = across(la, lo, 0.07);
    c.bridge(a, b, { width: 0.09, piers: 0, rise: 0.05, color, deck, seg: 6 });
  }

  // --- The causeway to the mainland: a road bridge and a railway bridge side by side.
  const land0 = P(45.4413, 12.3166); const towards = P(45.4530, 12.2996);
  const dir = [towards[0] - land0[0], towards[1] - land0[1]];
  const tEdge = (-c.w / 2 + 0.02 - land0[0]) / dir[0];
  const far = [land0[0] + dir[0] * tEdge, land0[1] + dir[1] * tEdge];
  const nLen = Math.hypot(dir[0], dir[1]); const nx = -dir[1] / nLen; const nz = dir[0] / nLen;
  for (const [off, deck] of [[0.055, 0x8a8578], [-0.055, 0x6e665e]]) {
    c.bridge([land0[0] + nx * off, land0[1] + nz * off], [far[0] + nx * off, far[1] + nz * off], { width: 0.1, piers: 14, rise: 0, color: 0xc9bfa9, deck, seg: 10 });
  }

  // --- Footbridges over the minor canals: Venice has hundreds; a few dozen say so.
  const seen = new Set();
  const spans = [];
  seeds.forEach((s, i) => {
    seeds.forEach((t, j) => {
      if (j <= i) return;
      const dd = Math.hypot(t[0] - s[0], t[1] - s[1]);
      if (dd > SPACING * 1.7) return;
      const m = [(s[0] + t[0]) / 2, (s[1] + t[1]) / 2];
      const near = field.nearestTwo(m[0], m[1]);
      if (!near || !((near.a === i && near.b === j) || (near.a === j && near.b === i))) return;
      const ux = (t[0] - s[0]) / dd; const uz = (t[1] - s[1]) / dd;
      const reach = 0.032 + 0.045;
      const a = [m[0] - ux * reach, m[1] - uz * reach]; const b = [m[0] + ux * reach, m[1] + uz * reach];
      if (field.at(m[0], m[1]) > -0.01) return;
      if (field.at(a[0], a[1]) < 0.025 || field.at(b[0], b[1]) < 0.025) return;
      const k = `${i},${j}`;
      if (seen.has(k)) return;
      seen.add(k);
      spans.push([a, b]);
    });
  });
  const bridgeRng = seededRandom(400);
  for (const [a, b] of spans) {
    if (bridgeRng() > 0.55) continue;
    footbridge(c, a, b);
    c.reserveCircle(a[0], a[1], 0.05); c.reserveCircle(b[0], b[1], 0.05);
  }

  // --- The city itself: low, dense, stucco in ochre, pink and cream under terracotta roofs. Each
  // island is filled on its own grid, squared to its own longest side, because a Venetian block is
  // built out to the canals round it rather than laid on one grid across the whole city.
  const stucco = [0xd9a95e, 0xdba08a, 0xe8d9b5, 0xc97a55, 0xe2b48a, 0xd8cdb8, 0xc9925c, 0xe6c2a4, 0xb9614a];
  const roofs = [0xa9553a, 0xb8643f, 0x9a4b33, 0xb05a3e, 0x8f4a35];
  fillIslands(c, [...islands], seededRandom(77), { stucco, roofs });

  // --- The gondola, the one thing that moves.
  const route = stretch(grand, P(45.4400, 12.3348), P(45.4318, 12.3290));
  c.mover(gondola, route, { speed: 0.11 });

  // --- Words: ten landmarks, three waters.
  c.waterText_('GRAND CANAL', G([[45.4419, 12.3240], [45.4428, 12.3272], [45.4427, 12.3298]]), 0.11);
  c.waterText_('GIUDECCA CANAL', G([[45.4285, 12.3195], [45.4282, 12.3250], [45.4277, 12.3300]]), 0.17);
  c.waterText_('THE VENETIAN LAGOON', [[-6.2, -3.4], [-1.6, -3.4]], 0.36);
  c.label("St Mark's Basilica", sbX + 0.3, sbZ - 0.42, 0.82);
  c.label('Campanile', cmX - 0.5, cmZ + 0.14, 1.48);
  c.label("Doge's Palace", dpX + 0.42, dpZ + 0.25, 0.5);
  c.label('Rialto Bridge', Math.min(rA[0], rB[0]) - 0.3, (rA[1] + rB[1]) / 2 + 0.15, 0.42);
  c.label('Santa Maria della Salute', slX - 0.45, slZ + 0.2, 0.66);
  c.label('San Giorgio Maggiore', sgX + 0.5, sgZ + 0.25, 0.72);
  c.label('Arsenale', abX, abZ + 0.15, 0.4);
  c.label('Giudecca', ...P(45.4255, 12.3260), 0.36);
  c.label('San Michele', sanMichelePoly[3][0] - 0.25, sanMichelePoly[3][1] + 0.1, 0.3);
  c.label('Murano', ...P(45.4560, 12.3550), 0.42);
  c.label('To the mainland', far[0] + 0.9, far[1] + 0.25, 0.25);

  // --- The cut face, and the words on the front of the base.
  const cut = section(c, field);
  const flush = (text, x, y, size) => c.labels.push({ text, x, z: cut.zf + 0.01, y, size, flush: true });
  const wetRuns = cut.runs.filter((r) => r.wet && r.x1 - r.x0 > 0.4);
  const west = wetRuns[0]; const east = wetRuns[wetRuns.length - 1];
  const tagX = (west.x0 + west.x1) / 2 + 0.25;
  flush('Water', tagX, 0.665, 0.055);
  flush('Lagoon mud', tagX, 0.5, 0.055);
  flush('Caranto: firm clay', tagX, 0.35, 0.055);
  flush('Sand and silt', tagX, 0.21, 0.055);
  const land = cut.runs.filter((r) => !r.wet).sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0];
  const lx = (land.x0 + land.x1) / 2;
  flush('Wooden piles', lx, 0.5, 0.055);
  flush('Larch boards, then stone, then brick', lx, 0.715, 0.05);
  const titleX = Math.min(c.w / 2 + RIM - 2.4, Math.max(east.x0 + 2.2, 4.8));
  flush('VENICE', titleX, 0.58, 0.28);
  flush('North is at the back.  Map scale: 1 foot = about a fifth of a mile.', titleX, 0.46, 0.075);
  flush('Canals and landmarks are much bigger than the map scale.', titleX, 0.37, 0.075);
  flush('The cut edge shows what the city stands on. Its depths are stretched.', titleX, 0.28, 0.075);

  return c.finish();
}

// Buildings on one island, on a grid squared to the island's longest side. It uses the kit's own
// occupancy test and building, so a landmark, a square or a bridge end is passed over as it is by
// City.fill(); only the grid is the island's own.
function fillIslands(c, islands, rng, { stucco, roofs, lot = [0.18, 0.14], gap = 0.01, street = 0.026, every = [3, 2] }) {
  const rect = (x, z, w, d, yaw) => {
    const cs = Math.cos(yaw); const sn = Math.sin(yaw);
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => [x + cs * lx + sn * lz, z - sn * lx + cs * lz]);
  };
  for (const poly of islands) {
    let best = 0; let yaw = 0; let cx = 0; let cz = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i]; const b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L > best) { best = L; yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]); }
      cx += a[0]; cz += a[1];
    }
    cx /= poly.length; cz /= poly.length;
    const cs = Math.cos(yaw); const sn = Math.sin(yaw);
    let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
    for (const [x, z] of poly) {
      const u = (x - cx) * cs - (z - cz) * sn; const v = (x - cx) * sn + (z - cz) * cs;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const su = lot[0] + gap; const sv = lot[1] + gap;
    const offU = rng() * su; const offV = rng() * sv;
    for (let iv = 0, v = v0 + offV - sv; v < v1 + sv; iv += 1, v += sv + (iv % every[1] === 0 ? street : 0)) {
      for (let iu = 0, u = u0 + offU - su; u < u1 + su; iu += 1, u += su + (iu % every[0] === 0 ? street : 0)) {
        const r0 = rng(); const r1 = rng(); const r2 = rng();
        if (r0 < 0.05) continue;
        const bw = lot[0] * (0.9 + r1 * 0.1); const bd = lot[1] * (0.9 + r2 * 0.1);
        const x = cx + cs * u + sn * v; const z = cz - sn * u + cs * v;
        if (!rect(x, z, bw * 0.9, bd * 0.9, yaw).every(([px, pz]) => inside(poly, px, pz))) continue;
        if (!c._free(x, z, bw, bd, yaw)) continue;
        const h = 0.095 + rng() * 0.07 + (rng() < 0.06 ? 0.05 : 0);
        const col = new THREE.Color(pick(rng, stucco));
        const tone = 0.9 + rng() * 0.2;
        const style = rng() < 0.68 ? 'hip' : rng() < 0.6 ? 'gable' : 'flat';
        c.building(x, z, bw, bd, yaw, h, style, [col.r * tone, col.g * tone, col.b * tone], pick(rng, roofs));
        const out = rect(x, z, bw, bd, yaw);
        c.reservePoly(out);
        c.halos.push(out);
      }
    }
    // Then smaller houses into whatever the grid left at the island's ragged edges, which is
    // where a city this crowded is most crowded.
    let area = 0;
    for (let i = 0; i < poly.length; i += 1) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const tries = Math.round(Math.abs(area / 2) / 0.004);
    for (let n = 0; n < tries; n += 1) {
      const u = u0 + rng() * (u1 - u0); const v = v0 + rng() * (v1 - v0);
      const bw = 0.075 + rng() * 0.05; const bd = 0.065 + rng() * 0.04;
      const x = cx + cs * u + sn * v; const z = cz - sn * u + cs * v;
      if (!rect(x, z, bw * 0.9, bd * 0.9, yaw).every(([px, pz]) => inside(poly, px, pz))) continue;
      if (!c._free(x, z, bw, bd, yaw)) continue;
      const col = new THREE.Color(pick(rng, stucco)); const tone = 0.88 + rng() * 0.2;
      c.building(x, z, bw, bd, yaw, 0.08 + rng() * 0.05, rng() < 0.7 ? 'hip' : 'flat', [col.r * tone, col.g * tone, col.b * tone], pick(rng, roofs));
      const out = rect(x, z, bw, bd, yaw);
      c.reservePoly(out);
      c.halos.push(out);
    }
  }
}

function circle(x, z, r, n = 16) {
  const out = [];
  for (let i = 0; i < n; i += 1) out.push([x + Math.cos((i / n) * TAU) * r, z + Math.sin((i / n) * TAU) * r]);
  return out;
}

export const BUILDERS = {
  'venice-diorama': venice,
};
